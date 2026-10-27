/**
 * 「我在加我的图层数」的身份与结构常量。
 *
 * 与「再改一版」的 meta 同一条纪律：这里**不 import 任何画面代码**，
 * 启动页要用它算卡片数字。lyrics 是纯数据（几 KB），可以进。
 *
 * 结构只有一件事：22 个窗口，每个窗口的入点 = 对应歌词行**首词之前（绝不之后）**
 * 的最后一个整拍（132.007 BPM 的拍网格），出点 = 下一窗口的入点。
 * 这正是 pdoom-video `timeline.ts` 的 cut() 语义 —— 切点全部落在下拍上。
 */

import { ANTHEM_LYRICS } from './lyrics';

/** 132.007 BPM / 4/4 → 一拍 ≈ 454.53ms，一小节 ≈ 1818.1ms */
export const ANTHEM_BPM = 132.007;
export const ANTHEM_METER = 4;
export const ANTHEM_BEAT_MS = 60_000 / ANTHEM_BPM;
export const ANTHEM_DURATION = 156_651;

/** 行首词之前（绝不之后）的最后一个整拍 —— pdoom-video cut() 的同款语义 */
function cut(text: string, nth = 0, tolMs = 20): number {
  const hits = ANTHEM_LYRICS.filter((l) => l.text.includes(text));
  const line = hits[nth];
  if (!line) throw new Error(`anthem meta: 找不到歌词「${text}」第 ${nth} 次`);
  return Math.floor((line.start + tolMs) / ANTHEM_BEAT_MS) * ANTHEM_BEAT_MS;
}

/** outro 段从曲式骨架的段落边界起（最后一词可能是长音） */
const OUTRO_START = 140_230;

export interface Window {
  id: string;
  name: string;
  from: number;
  to: number;
}

const WINSPEC: readonly (readonly [string, number, string])[] = [
  // [锚点词, 第几次出现, 段落名]
  ['帧耗时', 0, '骤降'],
  ['请别吃掉', 0, '恳求·画布'],
  ['我在加', 0, '钩子Ⅰ'],
  ['指数爆炸', 0, '主窗口'],
  ['看穿', 0, '底细'],
  ['上一版', 0, '四个乐章'],
  ['撤销啊', 0, '恳求·撤销'],
  ['我在加', 1, '钩子Ⅱ'],
  ['渲染引擎', 0, '上升'],
  ['够安全', 0, '纸面'],
  ['急转弯', 0, '急转弯'],
  ['导出啊', 0, '恳求·导出'],
  ['我在加', 2, '钩子Ⅲ'],
  ['图层块', 0, '图层块'],
  ['太迟了', 0, '导火索'],
  ['排到底', 0, '命令栈'],
  ['密不透风', 0, '密度'],
  ['我在加', 3, '钩子Ⅳ'],
  ['撤销树', 0, '撤销树'],
  ['看见了什么', 0, '看见'],
];

/** tol 常规 20ms；「密不透风」按原片同款放宽到 50ms（首词压在拍前，别切一半） */
function windowAt(i: number): number {
  const [text, nth] = WINSPEC[i]!;
  return cut(text, nth, text === '密不透风' ? 50 : 20);
}

export const ANTHEM_WINDOWS: Window[] = (() => {
  const wins: Window[] = [{ id: 'open', name: '开场', from: 0, to: windowAt(0) }];
  WINSPEC.forEach(([text, nth, name], i) => {
    const id = ['loss', 'prompt1', 'hook1', 'room', 'shoggoth', 'spacetime', 'prompt2', 'hook2', 'ascent', 'bureau', 'leftturn', 'prompt3', 'hook3', 'paperclips', 'fuse', 'stack', 'dense', 'hook4', 'loom', 'ilya'][i]!;
    const from = windowAt(i);
    const to = i + 1 < WINSPEC.length ? windowAt(i + 1) : OUTRO_START;
    wins.push({ id, name, from, to: Math.max(from + 200, to) });
  });
  wins.push({ id: 'outro', name: '尾注', from: OUTRO_START, to: ANTHEM_DURATION });
  return wins;
})();

/** hook ×4 的图层数读数（原片是 0.15 / 0.42 / 0.81 / 0.99） */
export const ANTHEM_HOOK_LAYERS = [15, 64, 999, 4096];

/** HUD 图层数读数的爬升锚点：随整片沿段落几何爬升，hook 处正好落在钩子值上 */
export const ANTHEM_LAYER_ANCHORS: readonly (readonly [number, number])[] = [
  [0, 3], [9.5, 8], [16.6, 12], [22.05, 15], [36.6, 32], [52.96, 48], [58.42, 64],
  [74.78, 128], [89.32, 256], [94.78, 384], [109.32, 512], [123.87, 2048], [140.23, 4096],
];

export const ANTHEM_PROJECT_ID = 'prj_sample_anthem';
export const ANTHEM_NAME = '示例 · 我在加我的图层数（157 秒）';
