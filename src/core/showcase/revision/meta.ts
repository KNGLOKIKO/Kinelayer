/**
 * 「再改一版」的身份与结构常量。
 *
 * 这一份刻意**不 import 任何画面代码**：启动页要用它算卡片数字，
 * 不该为了显示一行「60 秒」就把三十几 KB 的 canvas 源码拉进首屏。
 *
 * 结构上只有两个数字：`CELL`（两小节 = 3750ms）与每段占几格。
 * 所有切点都是它的整数倍 —— 这不是巧合，是 pdoom-video 那种「下拍硬切」手法
 * 能在本工程里成立的前提：**画面自己不许出现第二个时间基准**。
 */

/** 128 BPM / 4/4 → 一拍 468.75ms，一小节 1875ms，两小节 3750ms */
export const REVISION_BPM = 128;
export const REVISION_METER = 4;

/** 一小节 2 拍? 不：一小节 = 4 拍 = 1875ms；CELL = 两小节 = 3750ms */
export const BEAT_MS = 60_000 / REVISION_BPM;
export const BAR_MS = BEAT_MS * REVISION_METER;
export const CELL = BAR_MS * 2;

/**
 * 分镜表：[占几格, 段落名]。顺序就是片子的顺序。
 *
 * 改这里会同时改三件事：代码层的出入点、HUD 上的「03 / 09」、以及音频层对齐 ——
 * 因为三处都从这一个数组算，而不是各自抄一份数字。
 */
export const SECTION_SPEC: readonly (readonly [number, string])[] = [
  [1, '冷开'],
  [2, '第一句'],
  [2, '图层树'],
  [2, '版本'],
  [2, '命令'],
  [2, '引信'],
  [1, '引爆'],
  [2, '数字'],
  [2, '落版'],
];

export interface Span {
  index: number;
  name: string;
  cells: number;
  from: number;
  to: number;
}

export const SECTION_SPANS: Span[] = (() => {
  let at = 0;
  return SECTION_SPEC.map((spec, index) => {
    const cells = spec[0];
    const from = at;
    at += Math.round(cells * CELL);
    return { index, name: spec[1], cells, from, to: at };
  });
})();

export const REVISION_PROJECT_ID = 'prj_sample_revision';
export const REVISION_NAME = '示例 · 再改一版（60 秒）';
export const REVISION_DURATION = SECTION_SPANS[SECTION_SPANS.length - 1]!.to;
