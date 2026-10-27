/**
 * 「极限样片」：64 秒 / 1920×1080 / 30fps，分镜九层。
 *
 * 这支片子的用途是**把引擎压到上限**：一整支片子没有一个图片、没有一个视频、
 * 没有一个音频文件 —— 画面是 canvas2d 与一段 GLSL，声音是 WebAudio 现场合成的。
 * 结构上就是一句自我要求：**每一秒都要有理由**。
 *
 * 分镜（120 BPM，每段 8 秒 = 4 小节，切点都落在拍子上）：
 *
 *   0.0s  01 冷开      黑场 → 15 砸下来 → 闪白
 *   8.8s  02 点名      15 个风格名，每个一拍，右侧竖带同时滚一遍
 *  16.8s  03 等轴城市  13×13 格子上长出一座城，中心向外扩散
 *  24.8s  04 HUD 锁定  角括号收拢 + 三圈刻度 + 读数刷屏 + 锁定
 *  32.8s  05 液态      GLSL 域扭曲 fbm，5 个八度，一遍着色
 *  40.8s  06 技术账    滚动的代码 + 三个数字 + 波形
 *  48.8s  07 风格墙    五列视差 + 巨字穿过镜头
 *  56.8s  08 落版      标志 / 标题 / 仓库地址 / 淡出
 *
 * 每段都是**一整块全画幅代码层**，而不是拆成几十个小图层：
 * 一段动画写在一段代码里，改起来是改一处、看得见上下文；时间轴上九行，
 * 就是这支片子的分镜表。片段之间用硬切（切点都在拍子上），
 * 转场效果（闪白 / 擦除 / 淡出）写在各自的代码末尾，不额外占图层。
 */

import { createAudioLayer, createBackground, createCodeLayer, defaultCodeSpec } from '../defaults';
import { PROJECT_SCHEMA_VERSION, type AudioLayer, type CodeEngine, type Layer, type Project } from '../types';
import { SHOWCASE_DURATION, SHOWCASE_NAME, SHOWCASE_PROJECT_ID } from './meta';
import { S1_COLD_OPEN, S2_ROSTER, S3_ISOMETRIC, S4_HUD, S5_LIQUID_GLSL, S5_LIQUID_TYPE, S6_LEDGER, S7_WALL, S8_END } from './scenes';

/* 身份常量在 `./meta`（那一份不 import 画面代码，所以能进首屏），这里只做转发 */
export { SHOWCASE_DURATION, SHOWCASE_NAME, SHOWCASE_PROJECT_ID };

const W = 1920;
const H = 1080;
const FPS = 30;

interface Seg {
  id: string;
  name: string;
  from: number;
  to: number;
  engine: CodeEngine;
  source: string;
  /** 内部分辨率倍率，只给低频成片画面用（见 CodeSpec.renderScale） */
  renderScale?: number;
}

const SEGMENTS: Seg[] = [
  { id: 'ly_film_01', name: '01 · 冷开 · 15', from: 0, to: 8_800, engine: 'canvas2d', source: S1_COLD_OPEN },
  { id: 'ly_film_02', name: '02 · 点名 · 十五个', from: 8_800, to: 16_800, engine: 'canvas2d', source: S2_ROSTER },
  { id: 'ly_film_03', name: '03 · 等轴城市', from: 16_800, to: 24_800, engine: 'canvas2d', source: S3_ISOMETRIC },
  { id: 'ly_film_04', name: '04 · HUD 锁定', from: 24_800, to: 32_800, engine: 'canvas2d', source: S4_HUD },
  /*
   * 这一段是本片唯一的逐像素画面：全域噪声场，没有一个形状。
   * 它没有高频细节可丢（八度最高的那一层也才 12 周 / 画幅），所以半分辨率采样
   * 再双线性放回来，肉眼看不出差别 —— 但填充率降到四分之一。
   */
  { id: 'ly_film_05', name: '05 · 液态 shader', from: 32_800, to: 40_800, engine: 'glsl', source: S5_LIQUID_GLSL, renderScale: 0.5 },
  { id: 'ly_film_05t', name: '05 · 液态 字幕', from: 32_800, to: 40_800, engine: 'canvas2d', source: S5_LIQUID_TYPE },
  { id: 'ly_film_06', name: '06 · 技术账', from: 40_800, to: 48_800, engine: 'canvas2d', source: S6_LEDGER },
  { id: 'ly_film_07', name: '07 · 风格墙', from: 48_800, to: 56_800, engine: 'canvas2d', source: S7_WALL },
  { id: 'ly_film_08', name: '08 · 落版', from: 56_800, to: SHOWCASE_DURATION, engine: 'canvas2d', source: S8_END },
];

export function createShowcaseProject(): Project {
  const now = Date.now();

  const layers: Layer[] = [
    createBackground({
      id: 'ly_film_bg',
      name: '背景 · 墨',
      kind: 'solid',
      color: '#05060a',
      width: W,
      height: H,
    }),
  ];

  for (const seg of SEGMENTS) {
    layers.push(
      createCodeLayer({
        id: seg.id,
        name: seg.name,
        x: 0,
        y: 0,
        width: W,
        height: H,
        inPoint: seg.from,
        outPoint: seg.to,
        code: {
          ...defaultCodeSpec(),
          engine: seg.engine,
          source: seg.source,
          ...(seg.renderScale ? { renderScale: seg.renderScale } : {}),
        },
      }),
    );
  }

  /*
   * 声音：四条铺底按段落换和弦（Am → F → C → G），一条 120 BPM 的节拍贯穿，
   * 一条提示音钉在切点上。全部合成，`assets` 依然是 0。
   */
  const pads: { id: string; name: string; from: number; to: number; chord: number[]; volume: number }[] = [
    { id: 'ly_film_pad_a', name: '音频 · 铺底 A（Am）', from: 0, to: 18_000, chord: [0, 7, 12, 15], volume: 0.3 },
    { id: 'ly_film_pad_b', name: '音频 · 铺底 B（F）', from: 14_000, to: 34_000, chord: [-4, 0, 7, 12], volume: 0.27 },
    { id: 'ly_film_pad_c', name: '音频 · 铺底 C（C）', from: 30_000, to: 50_000, chord: [3, 7, 12, 15], volume: 0.27 },
    { id: 'ly_film_pad_d', name: '音频 · 铺底 D（G）', from: 46_000, to: SHOWCASE_DURATION, chord: [-2, 5, 10, 14], volume: 0.29 },
  ];
  for (const p of pads) {
    layers.push(
      createAudioLayer({
        id: p.id,
        name: p.name,
        inPoint: p.from,
        outPoint: p.to,
        volume: p.volume,
        fadeIn: 2400,
        fadeOut: 3000,
        tone: { preset: 'pad', root: 110, bpm: 120, chord: p.chord, marks: [] },
      }),
    );
  }

  const pulse: AudioLayer = createAudioLayer({
    id: 'ly_film_pulse',
    name: '音频 · 节拍 120',
    inPoint: 8_400,
    outPoint: 57_200,
    volume: 0.15,
    fadeIn: 700,
    fadeOut: 1600,
    tone: { preset: 'pulse', root: 110, bpm: 120, chord: [0], marks: [] },
  });
  layers.push(pulse);

  /* 提示音落在每个切点上（marks 相对图层起点，图层从 0 开始所以就是绝对时间） */
  const chime: AudioLayer = createAudioLayer({
    id: 'ly_film_chime',
    name: '音频 · 切点提示',
    inPoint: 0,
    outPoint: SHOWCASE_DURATION,
    volume: 0.19,
    fadeIn: 0,
    fadeOut: 1600,
    tone: {
      preset: 'chime',
      root: 110,
      bpm: 120,
      chord: [0, 7, 12, 16],
      marks: [0, 8_800, 16_800, 24_800, 30_000, 32_800, 40_800, 48_800, 56_800],
    },
  });
  layers.push(chime);

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: SHOWCASE_PROJECT_ID,
    name: SHOWCASE_NAME,
    width: W,
    height: H,
    duration: SHOWCASE_DURATION,
    fps: FPS,
    loop: false,
    layers,
    assets: [],
    fonts: [],
    /* 保持 version 1：它只是库里的一个记录，不代表「有人编辑过」 */
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
