import type { Patch } from 'immer';
import type { CommandSource } from './registry';

export interface HistoryEntry {
  id: string;
  commandId: string;
  type: string;
  label: string;
  source: CommandSource;
  patches: Patch[];
  inverse: Patch[];
  ts: number;
  /** 连续同类操作（如拖动滑块）合并为一个撤销点 */
  coalesceKey?: string;
}

export interface TemporalState {
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const HISTORY_LIMIT = 120;

export function applyEntry(state: TemporalState, entry: HistoryEntry): TemporalState {
  return {
    past: [...state.past, entry].slice(-HISTORY_LIMIT),
    future: [],
  };
}

/**
 * 自研 temporal 中间件（immer patch 版）。
 *
 * 为什么不用 zundo / 第三方 temporal：
 * 撤销点必须由「命令」决定，而不是由任何 setState 决定。选中、缩放、播放头这些
 * 都不该进撤销栈；只有 mutating 且 undoable 的命令才产生 patch。第三方自动追踪
 * 会把非命令写入也记进来，直接违反「唯一命令总线」这条铁律。
 */
export function mergeEntry(prev: HistoryEntry, next: HistoryEntry): HistoryEntry {
  return {
    ...next,
    patches: [...prev.patches, ...next.patches],
    inverse: [...next.inverse, ...prev.inverse],
    ts: next.ts,
  };
}

export function canCoalesce(prev: HistoryEntry | undefined, next: HistoryEntry, windowMs = 700): boolean {
  if (!prev || !next.coalesceKey) return false;
  return prev.coalesceKey === next.coalesceKey && next.ts - prev.ts <= windowMs;
}
