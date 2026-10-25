/**
 * IndexedDB：资源的唯一持久化位置。
 * Project 里只存 AssetMeta，二进制永远不进入 Project / 命令 payload / AI 上下文。
 */

import { t } from '@/i18n';

const DB_NAME = 'kinelayer';
/** 旧品牌库名。只在迁移函数里读取，旧库原样保留、不删除。 */
const LEGACY_DB_NAME = 'motionlayer';
const LEGACY_FLAG = 'legacy.migrated';
const DB_VERSION = 1;
const STORE_ASSETS = 'assets';
const STORE_KV = 'kv';

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
      if (!db.objectStoreNames.contains(STORE_ASSETS)) {
        db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(t('IndexedDB 打开失败')));
  }).then(async (db) => {
    /* 迁移必须在任何读写之前完成，否则旧项目会被当成「首次打开」直接覆盖 */
    await migrateLegacyDatabase(db);
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
