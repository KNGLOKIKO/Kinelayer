/**
 * IndexedDB：资源的唯一持久化位置。
 * Project 里只存 AssetMeta，二进制永远不进入 Project / 命令 payload / AI 上下文。
 */

import { t } from '@/i18n';

const DB_NAME = 'kinelayer';
/** 旧品牌库名。只在迁移函数里读取，旧库原样保留、不删除。 */
const LEGACY_DB_NAME = 'motionlayer';
const LEGACY_FLAG = 'migration:motionlayer-to-kinelayer';
const MULTI_FLAG = 'migration:v1-to-multi';
const DB_VERSION = 3;
const STORE_ASSETS = 'assets';
const STORE_KV = 'kv';
const STORE_META = 'meta';
const STORE_PROJECTS = 'projects';
const STORE_FONTS = 'fonts';
const STORE_PREFS = 'prefs';
/** 自定义命令：跟着用户走，不跟工程走 —— 在 A 工程写的宏，B 工程也该能用 */
const STORE_COMMANDS = 'commands';

/** 单工程时代的 key：迁移时读一次，之后不再写、也不删 */
const LEGACY_PROJECT_KEYS = ['project.autosave', 'currentProject', 'project'];

export interface AssetRecord {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'font';
  mime: string;
  size: number;
  createdAt: number;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const stores: [string, IDBObjectStoreParameters][] = [
        [STORE_ASSETS, { keyPath: 'id' }],
        [STORE_KV, { keyPath: 'key' }],
        [STORE_META, { keyPath: 'key' }],
        [STORE_PROJECTS, { keyPath: 'id' }],
        [STORE_FONTS, { keyPath: 'id' }],
        [STORE_PREFS, { keyPath: 'key' }],
        [STORE_COMMANDS, { keyPath: 'id' }],
      ];
      for (const [name, params] of stores) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, params);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(t('IndexedDB 打开失败')));
  }).then(async (db) => {
    /* 迁移必须在任何读写之前完成，否则旧项目会被当成「首次打开」直接覆盖。
       顺序不能反：先把旧品牌库整份搬过来，再把单工程拆成多工程索引。 */
    await migrateLegacyDatabase(db);
    await migrateSingleProject(db);
    return db;
  });
  return dbPromise;
}

/* ── 旧库迁移 ───────────────────────────────────────────────
 * 改品牌换了库名，但用户 IndexedDB 里的项目和素材不能丢。
 * 策略：首次打开新库时，把旧库整份「复制」过来（只补缺失的键，
 * 不覆盖新库已有数据），旧库原样保留，flag 记在 kv 里只跑一次。
 * 迁移失败不阻断编辑器启动，只在控制台留一条 warn。
 */

async function legacyDbExists(): Promise<boolean> {
  const factory = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> };
  if (typeof factory.databases !== 'function') return false; // 探测不了就别开，开了会凭空建一个空库
  try {
    const list = await factory.databases();
    return list.some((d) => d.name === LEGACY_DB_NAME);
  } catch {
    return false;
  }
}

function openLegacyDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(LEGACY_DB_NAME);
    } catch {
      resolve(null);
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function readAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const txn = db.transaction(store, 'readonly');
    const req = txn.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function putMany(db: IDBDatabase, store: string, rows: unknown[]): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!rows.length) {
      resolve();
      return;
    }
    const txn = db.transaction(store, 'readwrite');
    const os = txn.objectStore(store);
    for (const row of rows) os.put(row);
    txn.oncomplete = () => resolve();
    txn.onerror = () => reject(txn.error);
  });
}

async function migrateLegacyDatabase(db: IDBDatabase): Promise<void> {
  try {
    /* 注意：这里不能用 tx()/idbGetKV()，它们会回头 await 正在构造的 openDb() → 死锁。
       一律直接对已打开的 db 做事务。 */
    const current = await readAll<{ key: string }>(db, STORE_KV);
    if (current.some((r) => r.key === LEGACY_FLAG)) return;
    if (!(await legacyDbExists())) {
      await putMany(db, STORE_KV, [{ key: LEGACY_FLAG, value: { at: Date.now(), copied: 0 } }]);
      return;
    }
    const legacy = await openLegacyDb();
    if (!legacy) return;

    let copied = 0;
    const names = Array.from(legacy.objectStoreNames);
    if (names.includes(STORE_ASSETS)) {
      const old = await readAll<AssetRecord>(legacy, STORE_ASSETS);
      const now = new Set((await readAll<AssetRecord>(db, STORE_ASSETS)).map((r) => r.id));
      const missing = old.filter((r) => !now.has(r.id));
      await putMany(db, STORE_ASSETS, missing);
      copied += missing.length;
    }
    if (names.includes(STORE_KV)) {
      const old = await readAll<{ key: string; value: unknown }>(legacy, STORE_KV);
      const now = new Set((await readAll<{ key: string }>(db, STORE_KV)).map((r) => r.key));
      /* 旧库里的 flag 不搬，免得新库一开局就被当成「已迁移」 */
      const missing = old.filter((r) => r.key !== LEGACY_FLAG && !now.has(r.key));
      await putMany(db, STORE_KV, missing);
      copied += missing.length;
    }
    legacy.close();
    await putMany(db, STORE_KV, [{ key: LEGACY_FLAG, value: { at: Date.now(), copied } }]);
    if (copied) console.info(`[Kinelayer] 已从旧库迁移 ${copied} 条记录，旧库保留未删`);
  } catch (err) {
    console.warn('[Kinelayer] 旧库迁移跳过：', err);
  }
}

/** 启动页要的信息：不加载图层，只读这一份 */
export interface ProjectMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  updatedAt: number;
  createdAt: number;
  /** dataURL，长边 480，jpeg 0.75；首帧空白时延后生成 */
  thumbnail?: string;
  schemaVersion: number;
  layerCount: number;
  /** 删除项目时做级联清理用 */
  assetIds: string[];
}

export interface AppPrefs {
  locale?: string;
  /** null = 明确没有「上次打开的工程」，与「还没写过」区分开 */
  lastProjectId?: string | null;
  theme?: string;
  /**
   * 首次运行引导只做一次。
   * 记成「已经塞过」而不是「用户没见过」，是因为用户可能第一件事就是把它删掉 ——
   * 那就该真的没了，而不是下次刷新又冒出来。
   */
  sampleSeeded?: boolean;
  /**
   * 已塞进去的那份示例是第几版（见 `SAMPLE_VERSION`）。
   *
   * v2.8 只写了布尔标记，所以「没有这个字段但有 sampleSeeded」要按第 1 版算；
   * 有版本号之后才能判断「是不是该换成新版」。
   */
  sampleVersion?: number;
}

/** 从裸 Project 抽元信息。idb 层不做 normalize，字段缺失就给保守默认值 */
export function metaFromRaw(raw: Record<string, unknown>, now = Date.now()): ProjectMeta {
  const assets = Array.isArray(raw.assets) ? (raw.assets as { id?: string }[]) : [];
  return {
    id: String(raw.id ?? ''),
    name: typeof raw.name === 'string' && raw.name ? raw.name : '未命名织层项目',
    width: Number(raw.width) || 1080,
    height: Number(raw.height) || 1440,
    duration: Number(raw.duration) || 5000,
    fps: Number(raw.fps) || 30,
    updatedAt: Number(raw.updatedAt) || now,
    createdAt: Number(raw.createdAt) || now,
    schemaVersion: Number(raw.schemaVersion) || 2,
    layerCount: Array.isArray(raw.layers) ? raw.layers.length : 0,
    assetIds: assets.map((a) => a.id).filter((v): v is string => typeof v === 'string'),
  };
}

/**
 * 单工程 → 多工程。
 * 老版本只有 kv['project.autosave'] 一个工程；这里把它落成 project:<id> + 一条索引，
 * 旧 key 原样保留（不删），并写 migration:v1-to-multi 免得重复搬。
 * 没有任何旧数据时也写一条空索引，让启动页逻辑只有一条分支。
 */
async function migrateSingleProject(db: IDBDatabase): Promise<void> {
  try {
    const meta = await readAll<{ key: string }>(db, STORE_META);
    if (meta.some((r) => r.key === 'projectIndex')) return;

    const kv = await readAll<{ key: string; value: unknown }>(db, STORE_KV);
    let legacy: Record<string, unknown> | null = null;
    for (const key of LEGACY_PROJECT_KEYS) {
      const value = kv.find((r) => r.key === key)?.value;
      if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).layers)) {
        legacy = value as Record<string, unknown>;
        break;
      }
    }

    const now = Date.now();
    if (!legacy) {
      await putMany(db, STORE_META, [
        { key: 'projectIndex', value: [] },
        { key: MULTI_FLAG, value: { at: now, migrated: false } },
      ]);
      return;
    }

    const id = typeof legacy.id === 'string' && legacy.id ? legacy.id : `prj_${now.toString(36)}`;
    const record = { ...legacy, id };
    await putMany(db, STORE_PROJECTS, [record]);
    await putMany(db, STORE_META, [
      { key: 'projectIndex', value: [metaFromRaw(record, now)] },
      { key: MULTI_FLAG, value: { at: now, migrated: true, from: 'single', id } },
    ]);
    await putMany(db, STORE_PREFS, [{ key: 'app', value: { lastProjectId: id } }]);
    console.info(`[Kinelayer] 旧单工程已拆成多工程索引：${id}（旧 key 保留）`);
  } catch (err) {
    /* 迁移失败不能拦住启动，降级为「没有历史项目」 */
    console.warn('[Kinelayer] 单工程迁移跳过：', err);
  }
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const txn = db.transaction(store, mode);
        const req = fn(txn.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error(t('IndexedDB 操作失败')));
      }),
  );
}

export async function idbPutAsset(rec: AssetRecord): Promise<void> {
  await tx(STORE_ASSETS, 'readwrite', (s) => s.put(rec));
}

export async function idbGetAsset(id: string): Promise<AssetRecord | undefined> {
  return tx<AssetRecord | undefined>(STORE_ASSETS, 'readonly', (s) => s.get(id) as IDBRequest<AssetRecord | undefined>);
}

export async function idbDeleteAsset(id: string): Promise<void> {
  await tx(STORE_ASSETS, 'readwrite', (s) => s.delete(id));
}

export async function idbAllAssets(): Promise<AssetRecord[]> {
  return tx<AssetRecord[]>(STORE_ASSETS, 'readonly', (s) => s.getAll() as IDBRequest<AssetRecord[]>);
}

export async function idbSetKV(key: string, value: unknown): Promise<void> {
  await tx(STORE_KV, 'readwrite', (s) => s.put({ key, value }));
}

export async function idbGetKV<T>(key: string): Promise<T | undefined> {
  const row = await tx<{ key: string; value: T } | undefined>(STORE_KV, 'readonly', (s) => s.get(key) as IDBRequest<{ key: string; value: T } | undefined>);
  return row?.value;
}

export async function idbDeleteKV(key: string): Promise<void> {
  await tx(STORE_KV, 'readwrite', (s) => s.delete(key));
}

/* ── 多工程 ─────────────────────────────────────────────── */

function txMulti(stores: string[], mode: IDBTransactionMode, fn: (txn: IDBTransaction) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const txn = db.transaction(stores, mode);
        fn(txn);
        txn.oncomplete = () => resolve();
        txn.onerror = () => reject(txn.error ?? new Error(t('IndexedDB 操作失败')));
        txn.onabort = () => reject(txn.error ?? new Error(t('IndexedDB 事务被中断')));
      }),
  );
}

export async function idbGetIndex(): Promise<ProjectMeta[]> {
  const row = await tx<{ key: string; value: ProjectMeta[] } | undefined>(STORE_META, 'readonly', (s) =>
    s.get('projectIndex') as IDBRequest<{ key: string; value: ProjectMeta[] } | undefined>,
  );
  return Array.isArray(row?.value) ? row.value : [];
}

export async function idbPutIndex(list: ProjectMeta[]): Promise<void> {
  await tx(STORE_META, 'readwrite', (s) => s.put({ key: 'projectIndex', value: list }));
}

/** 项目本体与索引必须在同一事务里更新，否则会出现「索引有、项目没了」的幽灵条目 */
export async function idbSaveProjectWithMeta(project: unknown, index: ProjectMeta[]): Promise<void> {
  await txMulti([STORE_PROJECTS, STORE_META], 'readwrite', (txn) => {
    txn.objectStore(STORE_PROJECTS).put(project);
    txn.objectStore(STORE_META).put({ key: 'projectIndex', value: index });
  });
}

export async function idbGetProject<T>(id: string): Promise<T | undefined> {
  return tx<T | undefined>(STORE_PROJECTS, 'readonly', (s) => s.get(id) as IDBRequest<T | undefined>);
}

export async function idbAllProjects<T>(): Promise<T[]> {
  return tx<T[]>(STORE_PROJECTS, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

export async function idbDeleteProjectRecord(id: string, index: ProjectMeta[]): Promise<void> {
  await txMulti([STORE_PROJECTS, STORE_META], 'readwrite', (txn) => {
    txn.objectStore(STORE_PROJECTS).delete(id);
    txn.objectStore(STORE_META).put({ key: 'projectIndex', value: index });
  });
}

/**
 * 改工程名：索引与本体一起改。
 * 只改索引不改编目本体的话，下次打开这个工程会被本体里的旧名字覆盖回去。
 */
export async function idbRenameProject(id: string, name: string, index: ProjectMeta[]): Promise<void> {
  await txMulti([STORE_PROJECTS, STORE_META], 'readwrite', (txn) => {
    const store = txn.objectStore(STORE_PROJECTS);
    const req = store.get(id);
    req.onsuccess = () => {
      const rec = req.result as Record<string, unknown> | undefined;
      if (rec) store.put({ ...rec, name, updatedAt: Date.now() });
    };
    txn.objectStore(STORE_META).put({ key: 'projectIndex', value: index });
  });
}

export async function idbGetPrefs(): Promise<AppPrefs> {
  const row = await tx<{ key: string; value: AppPrefs } | undefined>(STORE_PREFS, 'readonly', (s) =>
    s.get('app') as IDBRequest<{ key: string; value: AppPrefs } | undefined>,
  );
  return row?.value ?? {};
}

export async function idbSetPrefs(patch: AppPrefs): Promise<void> {
  const current = await idbGetPrefs();
  await tx(STORE_PREFS, 'readwrite', (s) => s.put({ key: 'app', value: { ...current, ...patch } }));
}

/** 设置面板的「手动恢复旧数据」用：把单工程 key 再搬一次（幂等） */
export async function idbRecoverLegacyProject(): Promise<ProjectMeta | null> {
  const db = await openDb();
  const kv = await readAll<{ key: string; value: unknown }>(db, STORE_KV);
  let legacy: Record<string, unknown> | null = null;
  for (const key of LEGACY_PROJECT_KEYS) {
    const value = kv.find((r) => r.key === key)?.value;
    if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).layers)) {
      legacy = value as Record<string, unknown>;
      break;
    }
  }
  if (!legacy) return null;
  const now = Date.now();
  const id = typeof legacy.id === 'string' && legacy.id ? legacy.id : `prj_${now.toString(36)}`;
  const record = { ...legacy, id, updatedAt: now };
  const index = await idbGetIndex();
  const meta = metaFromRaw(record, now);
  const next = [meta, ...index.filter((m) => m.id !== id)].sort((a, b) => b.updatedAt - a.updatedAt);
  await idbSaveProjectWithMeta(record, next);
  return meta;
}

/* ── 自定义命令 ───────────────────────────────────────────
 * 唯一一个「不属于任何工程」的用户资产：宏是用户的能力，不是文档内容。
 * 所以它不随 .kly 工程包走，也不进撤销栈 —— 撤销栈只该管画布上的改动。
 */

export async function idbListCommands<T>(): Promise<T[]> {
  const rows = await tx<T[]>(STORE_COMMANDS, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  return Array.isArray(rows) ? rows : [];
}

export async function idbPutCommand(row: unknown): Promise<void> {
  await tx(STORE_COMMANDS, 'readwrite', (s) => s.put(row));
}

export async function idbDeleteCommand(id: string): Promise<void> {
  await tx(STORE_COMMANDS, 'readwrite', (s) => s.delete(id));
}
