/**
 * IndexedDB：资源的唯一持久化位置。
 * Project 里只存 AssetMeta，二进制永远不进入 Project / 命令 payload / AI 上下文。
 */

const DB_NAME = 'motionlayer';
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
  dbPromise = new Promise((resolve, reject) => {
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
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'));
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
