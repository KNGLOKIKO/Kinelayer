/**
 * localStorage / sessionStorage 的唯一入口：统一用 `kinelayer.` 命名空间。
 *
 * 为什么需要这一层：历史版本用的是 `ml.` 前缀（旧品牌缩写）。改名不能让老用户
 * 丢配置（语言、桥接地址与令牌、AI 设置），所以读取时做一次惰性迁移 ——
 * 新键没有而旧键有时，把值拷到新键并保留旧键，之后再读写都只碰新键。
 */

const PREFIX = 'kinelayer.';

/** 旧命名空间前缀。全仓仅此一处保留，供迁移函数读取。 */
const LEGACY_PREFIX = 'ml.';

function readLegacy(key: string): string | null {
  try {
    return localStorage.getItem(LEGACY_PREFIX + key);
  } catch {
    return null;
  }
}

export function lsGet(key: string): string | null {
  try {
    const value = localStorage.getItem(PREFIX + key);
    if (value !== null) return value;
    const legacy = readLegacy(key);
    if (legacy === null) return null;
    localStorage.setItem(PREFIX + key, legacy);
    return legacy;
  } catch {
    /* 隐私模式可能禁用存储 */
    return null;
  }
}

export function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* 配额或隐私模式：静默失败，不影响编辑 */
  }
}

export function lsRemove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* 忽略 */
  }
}
