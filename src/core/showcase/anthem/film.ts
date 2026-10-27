/**
 * 「我在加我的图层数」：157 秒 / 1920×1080 / 30fps / 132.007 BPM，28 层，零外部资源。
 *
 * 与「再改一版」同一套组装纪律，但这次是**完整复刻** pdoom-video 的结构骨架：
 *   1. 22 个窗口，切点 = 对应歌词行首词之前最后一个整拍（meta.ts 的 cut 语义，
 *      与原片 timeline.ts 的 cut() 逐点对位）；
 *   2. 恳求 ×3（canvas / undo / export）与钩子 ×4 共用源码，靠 code.params 变奏 ——
 *      原片 prompt 同构、hook 递进的同款手法；
 *   3. 贯穿母题：图层数读数几何爬升（15 → 64 → 999 → 4096 → ∞ → 0/0 → NaN），
 *      HUD 层全片连续绘制逐字歌词，切镜不跳基线；
 *   4. 四个声部：无衬线（人）、等宽（机器）、衬线（预言）、图章（盖章的手）。
 *
 * 抄的是结构与方法，不是素材：词是自写的中文，画面是自绘的 MotionLayer 内容。
 */

import {
  createAudioLayer,
  createBackground,
  createCodeLayer,
  defaultCodeSpec,
  emptyAnimation,
} from '../../defaults';
import { PROJECT_SCHEMA_VERSION, type Layer, type Project } from '../../types';
import {
  ANTHEM_BPM,
  ANTHEM_DURATION,
  ANTHEM_METER,
  ANTHEM_NAME,
  ANTHEM_PROJECT_ID,
  ANTHEM_WINDOWS,
} from './meta';
import { ANTHEM_LYRICS } from './lyrics';
import {
  A_ASCENT,
  A_BUREAU,
  A_DENSE,
  A_FUSE,
  A_HOOK,
  A_HUD,
  A_ILYA,
  A_LEFTTURN,
  A_LOOM,
  A_LOSS,
  A_OPEN,
  A_OUTRO,
  A_PAPERCLIPS,
  A_PROMPT,
  A_ROOM,
  A_SHOGGOTH,
  A_SPACETIME,
  A_STACK,
} from './scenes';

const W = 1920;
const H = 1080;
const FPS = 30;

/** 每个窗口用哪段源码；prompt/hook 带 params（共用源码的变奏） */
const WINDOW_SOURCE: Record<string, { source: string; params?: Record<string, string | number> }> = {
  open: { source: A_OPEN },
  loss: { source: A_LOSS },
  prompt1: { source: A_PROMPT, params: { variant: 'canvas' } },
  hook1: { source: A_HOOK, params: { n: 1 } },
  room: { source: A_ROOM },
  shoggoth: { source: A_SHOGGOTH },
  spacetime: { source: A_SPACETIME },
  prompt2: { source: A_PROMPT, params: { variant: 'undo' } },
  hook2: { source: A_HOOK, params: { n: 2 } },
  ascent: { source: A_ASCENT },
  bureau: { source: A_BUREAU },
  leftturn: { source: A_LEFTTURN },
  prompt3: { source: A_PROMPT, params: { variant: 'export' } },
  hook3: { source: A_HOOK, params: { n: 3 } },
  paperclips: { source: A_PAPERCLIPS },
  fuse: { source: A_FUSE },
  stack: { source: A_STACK },
  dense: { source: A_DENSE },
  hook4: { source: A_HOOK, params: { n: 4 } },
  loom: { source: A_LOOM },
  ilya: { source: A_ILYA },
  outro: { source: A_OUTRO },
};

export function createAnthemProject(): Project {
  const now = Date.now();

  const layers: Layer[] = [
    createBackground({ id: 'ly_anth_bg', name: '背景 · 墨', kind: 'solid', color: '#08080A', width: W, height: H }),
  ];

  ANTHEM_WINDOWS.forEach((win, i) => {
    const def = WINDOW_SOURCE[win.id];
    if (!def) throw new Error(`anthem film: 窗口「${win.id}」没有对应场景源码`);
    layers.push(
      createCodeLayer({
        id: `ly_anth_${i}_${win.id}`,
        name: `${String(i + 1).padStart(2, '0')} · ${win.name}`,
        x: 0,
        y: 0,
        width: W,
        height: H,
        inPoint: win.from,
        outPoint: win.to,
        code: {
          ...defaultCodeSpec(),
          engine: 'canvas2d',
          source: def.source,
          ...(def.params ? { params: def.params } : {}),
        },
      }),
    );
  });

  /*
   * HUD / 歌词层：全片一层（书挡裁切标记 + 图层数读数 + 逐字歌词 + 行号场记板）。
   * 词是连续的，就由一层连续地画 —— 每段自己画字幕会在切镜时跳基线。
   */
  layers.push(
    createCodeLayer({
      id: 'ly_anth_hud',
      name: 'HUD · 图层数 / 逐字歌词 / 裁切标记',
      x: 0,
      y: 0,
      width: W,
      height: H,
      inPoint: 0,
      outPoint: ANTHEM_DURATION,
      code: { ...defaultCodeSpec(), engine: 'canvas2d', source: A_HUD },
    }),
  );

  /*
   * 声音：四段铺底走 Am → F → C → G（长交叉淡化，157 秒一气呵成），
   * 一条 132.007 BPM 的节拍贯穿（与画面共用同一份速度网格，鼓点与切点同源），
   * 一条提示音钉在 22 个窗口入点上。全部现场合成，assets 依然是 0。
   */
  const pads = [
    { id: 'ly_anth_pad_a', name: '音频 · 铺底 Am', from: 0, to: 42_000, chord: [0, 7, 12, 15], volume: 0.3 },
    { id: 'ly_anth_pad_b', name: '音频 · 铺底 F', from: 38_000, to: 80_000, chord: [-4, 0, 7, 12], volume: 0.27 },
    { id: 'ly_anth_pad_c', name: '音频 · 铺底 C', from: 76_000, to: 118_000, chord: [3, 7, 12, 16], volume: 0.28 },
    { id: 'ly_anth_pad_d', name: '音频 · 铺底 G', from: 114_000, to: ANTHEM_DURATION, chord: [-2, 2, 7, 14], volume: 0.3 },
  ];
  for (const p of pads) {
    layers.push(
      createAudioLayer({
        id: p.id,
        name: p.name,
        inPoint: p.from,
        outPoint: p.to,
        volume: p.volume,
        fadeIn: 2600,
        fadeOut: 3200,
        tone: { preset: 'pad', root: 110, bpm: ANTHEM_BPM, chord: p.chord, marks: [] },
      }),
    );
  }

  layers.push(
    createAudioLayer({
      id: 'ly_anth_pulse',
      name: '音频 · 节拍 132',
      inPoint: 0,
      outPoint: ANTHEM_DURATION,
      volume: 0.15,
      fadeIn: 900,
      fadeOut: 4200,
      tone: { preset: 'pulse', root: 110, bpm: ANTHEM_BPM, chord: [0], marks: [] },
    }),
  );

  layers.push(
    createAudioLayer({
      id: 'ly_anth_chime',
      name: '音频 · 窗口入点提示',
      inPoint: 0,
      outPoint: ANTHEM_DURATION,
      volume: 0.18,
      fadeIn: 0,
      fadeOut: 1400,
      /* marks 相对图层起点；图层从 0 开始，所以就是窗口入点的绝对时间 */
      tone: {
        preset: 'chime',
        root: 110,
        bpm: ANTHEM_BPM,
        chord: [0, 7, 12, 16],
        marks: ANTHEM_WINDOWS.map((w) => w.from),
      },
    }),
  );

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: ANTHEM_PROJECT_ID,
    name: ANTHEM_NAME,
    width: W,
    height: H,
    duration: ANTHEM_DURATION,
    fps: FPS,
    loop: false,
    layers,
    assets: [],
    fonts: [],
    tempo: { bpm: ANTHEM_BPM, offsetMs: 0, meter: ANTHEM_METER },
    lyrics: ANTHEM_LYRICS,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
