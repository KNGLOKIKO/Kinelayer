/**
 * 多工程持久化的领域层。
 *
 * 分工：`idb.ts` 只管「怎么读写 IndexedDB」，这里管「一个工程算不算存在」——
 * 索引与项目本体怎么同步、删工程时哪些资源可以一起清、缩略图什么时候生成。
 *
 * 一条铁律：索引里只放 ProjectMeta。启动页永远读索引，不读 project:<id>，
 * 否则十个工程就是十次完整反序列化。
 */

import type { Project } from '@/core/types';
import { normalizeProject } from '@/core/defaults';
import { makeThumbnail } from '@/render/thumbnail';
import {
  type AppPrefs,
  type ProjectMeta,
  idbAllAssets,
  idbAllProjects,
  idbDeleteAsset,
  idbDeleteProjectRecord,
  idbGetIndex,
  idbGetPrefs,
  idbGetProject,
  idbRecoverLegacyProject,
  idbRenameProject,
  idbSaveProjectWithMeta,
  idbSetPrefs,
} from './idb';

export type { ProjectMeta };

export const MAX_RECENT_PROJECTS = 12;

/** 缩略图最短生成间隔：避免连续保存把渲染打成筛子 */
const THUMB_INTERVAL = 5 * 60 * 1000;
const lastThumbAt = new Map<string, number>();

function newProjectId(): string {
  return `prj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function metaFromProject(project: Project, thumbnail?: string): ProjectMeta {
  return {
    id: project.id,
    name: project.name,
    width: project.width,
    height: project.height,
    duration: project.duration,
    fps: project.fps,
    updatedAt: project.updatedAt || Date.now(),
    createdAt: project.createdAt || Date.now(),
    thumbnail,
    schemaVersion: project.schemaVersion,
    layerCount: project.layers.length,
    assetIds: project.assets.map((a) => a.id),
  };
}

/** 按 updatedAt 降序，最多 12 条 */
export async function listRecentProjects(limit = MAX_RECENT_PROJECTS): Promise<ProjectMeta[]> {
  const list = await idbGetIndex();
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

export async function getProjectMeta(id: string): Promise<ProjectMeta | undefined> {
  return (await idbGetIndex()).find((m) => m.id === id);
}

export async function loadProjectRecord(id: string): Promise<Project | null> {
  const raw = await idbGetProject<Record<string, unknown>>(id);
  if (!raw) return null;
  return normalizeProject(raw);
}

/* --------------------------------------------------------------- 写入串行 */

/**
 * 索引是「整份读出来 → 改 → 整份写回去」，两个写者交错就会丢条目：
 * A 读到 [x]，B 读到 [x]，A 写 [x,a]，B 写 [x,b] → a 消失。
 * 自动保存和命令（新建/复制/删除）正好是两个写者，所以写入必须排队。
 * 注意：公开函数之间不要互相调用，只能调内部实现，否则自锁。
 */
let lock: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = lock.then(fn, fn);
  lock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeProject(project: Project, thumbnail?: string): Promise<ProjectMeta> {
  const index = await idbGetIndex();
  const prev = index.find((m) => m.id === project.id);
  const meta = metaFromProject(project, thumbnail ?? prev?.thumbnail);
  const next = [meta, ...index.filter((m) => m.id !== project.id)].sort((a, b) => b.updatedAt - a.updatedAt);
  await idbSaveProjectWithMeta(project, next);
  return meta;
}

/**
 * 写工程：本体与索引同一个事务。
 * `thumbnail` 传 undefined 表示「沿用索引里已有的那张」，不是「清空」。
 */
export async function saveProject(project: Project, thumbnail?: string): Promise<ProjectMeta> {
  return withLock(() => writeProject(project, thumbnail));
}

/** 首次建档：调用方通常刚 make 出项目，顺手生成缩略图 */
export async function createProjectRecord(project: Project, opts: { thumbnail?: boolean } = {}): Promise<ProjectMeta> {
  return withLock(async () => {
    const thumb = opts.thumbnail === false ? undefined : await makeThumbnail(project);
    if (thumb) lastThumbAt.set(project.id, Date.now());
    return writeProject(project, thumb);
  });
}

export async function forceThumbnail(project: Project): Promise<string | undefined> {
  const url = await makeThumbnail(project);
  if (url) lastThumbAt.set(project.id, Date.now());
  return url;
}

/** 自动保存走这里：5 分钟内不重复渲染缩略图 */
export async function maybeThumbnail(project: Project): Promise<string | undefined> {
  const last = lastThumbAt.get(project.id) ?? 0;
  if (Date.now() - last < THUMB_INTERVAL) return undefined;
  return forceThumbnail(project);
}

/**
 * 删除工程。
 * 资源是共享的：只有当某个 asset 不再被**任何**剩余工程引用时才删。
 * 先删记录再清资源 —— 反过来的话，删记录失败就会留下「图片没了、工程还在」的死工程。
 */
export async function deleteProjectRecord(id: string): Promise<{ removedAssets: number }> {
  return withLock(async () => {
    const index = await idbGetIndex();
    const target = index.find((m) => m.id === id);
    const remaining = index.filter((m) => m.id !== id);
    await idbDeleteProjectRecord(id, remaining);

    const projects = await idbAllProjects<Project>();
    const stillUsed = new Set<string>();
    for (const p of projects) {
      if (p.id === id) continue;
      for (const a of p.assets ?? []) stillUsed.add(a.id);
    }
    const all = await idbAllAssets();
    const known = new Set(all.map((a) => a.id));
    let removed = 0;
    for (const assetId of target?.assetIds ?? []) {
      if (stillUsed.has(assetId) || !known.has(assetId)) continue;
      await idbDeleteAsset(assetId);
      removed += 1;
    }
    return { removedAssets: removed };
  });
}

/** 深拷贝：资源只引用不复制（assetId 复用），避免同一张图在库里存两份 */
export async function duplicateProjectRecord(source: Project, nameSuffix: string): Promise<Project> {
  return withLock(async () => {
    const now = Date.now();
    const copy: Project = {
      ...structuredClone(source),
      id: newProjectId(),
      name: `${source.name}${nameSuffix}`.slice(0, 80),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const thumb = await makeThumbnail(copy);
    if (thumb) lastThumbAt.set(copy.id, Date.now());
    await writeProject(copy, thumb);
    return copy;
  });
}

/** 改一个「没打开」的工程的名字：只改库，不动内存里的文档 */
export async function renameProjectRecord(id: string, name: string): Promise<ProjectMeta | null> {
  return withLock(async () => {
    const index = await idbGetIndex();
    if (!index.some((m) => m.id === id)) return null;
    const next = index.map((m) => (m.id === id ? { ...m, name, updatedAt: Date.now() } : m));
    await idbRenameProject(id, name, next);
    return next.find((m) => m.id === id) ?? null;
  });
}


/* ------------------------------------------------------ 首次运行的示例工程 */

/**
 * 示例只塞一次。
 *
 * 判断顺序很重要：先看「有没有塞过」这个标记，再看「库里有没有那个 id」——
 * 标记挡住了 99% 的情况（一次 prefs 读），id 检查兜住「标记写失败/库被清过一半」的情形。
 * 两者都不改当前打开的文档，所以它可以在启动页每次刷新时无脑调用。
 */
export async function hasSeededSample(): Promise<boolean> {
  return (await idbGetPrefs()).sampleSeeded === true;
}

export async function markSampleSeeded(): Promise<void> {
  await idbSetPrefs({ sampleSeeded: true } satisfies AppPrefs);
}

export async function getLastProjectId(): Promise<string | null> {
  return (await idbGetPrefs()).lastProjectId ?? null;
}

/** null = 没有「上次打开的工程」（例如刚把它删了） */
export async function setLastProjectId(id: string | null): Promise<void> {
  await idbSetPrefs({ lastProjectId: id } satisfies AppPrefs);
}

/** 兜底：当前内存里的工程如果索引里没有（例如迁移失败后手建），补一条 */
export async function ensureProjectRecorded(project: Project): Promise<ProjectMeta> {
  const meta = await getProjectMeta(project.id);
  if (meta) return meta;
  return createProjectRecord(project);
}

/** 设置面板的「手动恢复旧数据」 */
export async function recoverLegacyProject(): Promise<ProjectMeta | null> {
  const meta = await withLock(() => idbRecoverLegacyProject());
  if (meta) await setLastProjectId(meta.id);
  return meta;
}

/* --------------------------------------------------- 当前打开的工程状态 */

/**
 * 「当前打开的工程」被删掉之后，自动保存不能再把它写回去 —— 否则删除等于没删。
 * 这里只记一个 id：谁被删了，写入方就跳过谁；下次 open/create 时清空。
 */
let detachedId: string | null = null;

export function detachProject(id: string | null): void {
  detachedId = id;
}

export function isDetached(id: string): boolean {
  return detachedId === id;
}

