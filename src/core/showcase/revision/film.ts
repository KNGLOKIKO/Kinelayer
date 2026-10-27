/**
 * 「再改一版」：60 秒 / 1920×1080 / 30fps / 128 BPM，十一个图层，零外部资源。
 *
 * 这是一次**复刻**，也是一次能力盘点。原片是 mexicat/pdoom-video：
 * 一支用逐词卡拉 OK、下拍硬切、一条贯穿母题和一个逐级递增的数字，
 * 把一篇 AI 风险论文唱成 MV 的作品。这里把它的手法整套搬过来，
 * 换成本工程自己的内容 —— 一个动态海报编辑器，以及「再改一版」这件永恒的小事。
 *
 * 抄的是方法，不是素材：
 *   1. 每一帧是这条时间轴的**纯函数**（同毫秒必同帧），预览与导出逐帧一致；
 *   2. 逐字高亮**绝不领先声音** —— 一个字的高亮区间就是它的发声区间；
 *   3. 切点全部落在下拍上（128 BPM / 4/4，两小节一格 = 3750ms）；
 *   4. 一条贯穿母题：一根竖线。它依次是光标、播放头、时间轴的刻度、
 *      一列图层、一根引信、一颗点。母题不变形，观众就不会换脑子；
 *   5. 一个逐级递增的数字：P(今天收工) 0.02 → 0.99 → NaN；
 *   6. 四个声部：无衬线（人）、等宽（机器）、衬线（预言）、单笔画（手迹）；
 *   7. 一套受限色板：墨、骨、石墨、灰烬 + 唯一的信号橙，酸绿只在引爆出现 300ms。
 *
 * 与上一支「极限样片」分工不同：那支把引擎压到性能上限，这支把**叙事**压到上限，
 * 并且第一次用上速度网格（api.tempo）与逐字时间（api.lyrics）——
 * 这两样都是为拍这条片子而补进引擎的（见 docs/11-score.md）。
 */

import {
  createAudioLayer,
  createBackground,
  createCodeLayer,
  createTextLayer,
  defaultCodeSpec,
  defaultTextStyle,
  emptyAnimation,
} from '../../defaults';
import { PROJECT_SCHEMA_VERSION, type CodeEngine, type Layer, type Project } from '../../types';
import { REVISION_BPM, REVISION_DURATION, REVISION_METER, REVISION_NAME, REVISION_PROJECT_ID, SECTION_SPANS } from './meta';
import { REVISION_LYRICS } from './lyrics';
import {
  R1_COLD_OPEN,
  R2_FIRST_LINE,
  R3_TIMELINE,
  R4_VERSION,
  R5_COMMANDS,
  R6_FUSE,
  R7_BLAST_GLSL,
  R7_BLAST_TYPE,
  R8_NAN,
  R9_END,
  R_HUD,
} from './scenes';

const W = 1920;
const H = 1080;
const FPS = 30;

interface SceneDef {
  engine: CodeEngine;
  source: string;
  /** 内部分辨率倍率（低频成片画面才降） */
  renderScale?: number;
  /** 子帧超采样：只给便宜但高速的层用。'auto' 见 codeEngine 的自适应瓦片 */
  motionBlur?: { samples: number | 'auto'; shutter: number; tol?: number };
  suffix?: string;
}

/** 每个段落挂几层。多数是一层，引爆是「shader 打底 + 2D 叠字」两层 */
const SECTION_LAYERS: SceneDef[][] = [
  [{ engine: 'canvas2d', source: R1_COLD_OPEN }],
  [{ engine: 'canvas2d', source: R2_FIRST_LINE }],
  [{ engine: 'canvas2d', source: R3_TIMELINE }],
  [{ engine: 'canvas2d', source: R4_VERSION }],
  [{ engine: 'canvas2d', source: R5_COMMANDS }],
  [{ engine: 'canvas2d', source: R6_FUSE }],
  [
    /* 逐像素的爆炸：只有一圈一圈的极坐标条纹，没有高频细节，半分辨率看不出来 */
    { engine: 'glsl', source: R7_BLAST_GLSL, renderScale: 0.5 },
    /*
     * 飞散的标签是高速运动物：单帧画一条残影是假的（速度一变就露馅），
     * 子帧叠起来才是真的运动模糊。它很便宜（几十个矩形），付得起五倍。
     *
     * shutter 只给 44ms，比一帧（33ms）略宽：**运动模糊积分的是「一帧曝光」**，
     * 不是「一段时间」。给 110ms 会得到三次离散的重影（第一次就是这么翻车的），
     * 那是长曝光，不是快门。
     *
     * 五帧降到四帧 + 半分辨率：这一层原本是全片唯一超预算的地方
     * （1080p 全幅 × 5 子帧 → 单独 24ms，p95 43ms）。实测 4×0.5 把这一段
     * 从 43ms 压到 23ms，而画面肉眼无差 —— 飞散标签本来就带辉光，
     * 半分辨率丢掉的正是辉光里那点高频。
     */
    {
      engine: 'canvas2d',
      source: R7_BLAST_TYPE,
      renderScale: 0.5,
      motionBlur: { samples: 4, shutter: 44 },
      suffix: '叠层',
    },
  ],
  [{ engine: 'canvas2d', source: R8_NAN }],
  [{ engine: 'canvas2d', source: R9_END }],
];

const key = (id: string, time: number, value: number, kind: 'ease-out-cubic' | 'ease-out-back' | 'linear' = 'ease-out-cubic') => ({
  id,
  time,
  value,
  easing: { kind },
});

export function createRevisionProject(): Project {
  const now = Date.now();

  const layers: Layer[] = [
    createBackground({ id: 'ly_rev_bg', name: '背景 · 墨', kind: 'solid', color: '#08080A', width: W, height: H }),
  ];

  SECTION_SPANS.forEach((span, i) => {
    const defs = SECTION_LAYERS[i] ?? [];
    defs.forEach((def, j) => {
      layers.push(
        createCodeLayer({
          id: `ly_rev_${i}_${j}`,
          name: `${String(i + 1).padStart(2, '0')} · ${span.name}${def.suffix ? ` · ${def.suffix}` : ''}`,
          x: 0,
          y: 0,
          width: W,
          height: H,
          inPoint: span.from,
          outPoint: span.to,
          code: {
            ...defaultCodeSpec(),
            engine: def.engine,
            source: def.source,
            ...(def.renderScale ? { renderScale: def.renderScale } : {}),
            ...(def.motionBlur ? { motionBlur: def.motionBlur } : {}),
          },
        }),
      );
    });
  });

  /*
   * HUD / 歌词层：全片一层，永远在最上面（落版的两个文字层除外）。
   *
   * 为什么不做成「每段自己画歌词」：那样每一段都要各自对齐一次基线，
   * 卡拉 OK 会在切镜时跳一下 —— 观众立刻出戏。词是连续的，就该由一层连续地画。
   */
  layers.push(
    createCodeLayer({
      id: 'ly_rev_hud',
      name: 'HUD · 时码 / 段落 / 逐字歌词',
      x: 0,
      y: 0,
      width: W,
      height: H,
      inPoint: 0,
      outPoint: REVISION_DURATION,
      code: { ...defaultCodeSpec(), engine: 'canvas2d', source: R_HUD },
    }),
  );

  /* 落版的两个字：这是原生文本层，不是画出来的 —— 所以用户在时间轴上能选中、能改字 */
  layers.push(
    createTextLayer({
      id: 'ly_rev_word',
      name: '落版 · KINELAYER',
      x: 260,
      y: 340,
      width: 1400,
      height: 150,
      inPoint: 52_600,
      outPoint: REVISION_DURATION,
      text: 'KINELAYER',
      style: {
        ...defaultTextStyle(),
        fontFamily: 'Segoe UI',
        fontSize: 132,
        fontWeight: 800,
        letterSpacing: 26,
        align: 'center',
        verticalAlign: 'middle',
        color: '#EEE9DF',
      },
      animation: {
        ...emptyAnimation(),
        tracks: [
          {
            property: 'opacity',
            keyframes: [key('kf_word_o0', 0, 0), key('kf_word_o1', 420, 1)],
          },
          /* 字号收一下：从「贴脸」退到正常，镜头语言里最省的一次运动 */
          {
            property: 'fontSize',
            keyframes: [key('kf_word_s0', 0, 168), key('kf_word_s1', 760, 132, 'ease-out-back')],
          },
        ],
      },
    }),
  );

  layers.push(
    createTextLayer({
      id: 'ly_rev_tag',
      name: '落版 · 副题',
      x: 260,
      y: 496,
      width: 1400,
      height: 56,
      inPoint: 53_400,
      outPoint: REVISION_DURATION,
      text: '动态海报编辑器 · 每一次修改都是一条命令',
      style: {
        ...defaultTextStyle(),
        fontFamily: 'Microsoft YaHei',
        fontSize: 26,
        fontWeight: 400,
        letterSpacing: 6,
        align: 'center',
        verticalAlign: 'middle',
        color: '#9C978F',
      },
      animation: {
        ...emptyAnimation(),
        tracks: [
          {
            property: 'opacity',
            keyframes: [key('kf_tag_o0', 0, 0), key('kf_tag_o1', 520, 1)],
          },
        ],
      },
      /* 绑定表达式：副题永远在呼吸，但幅度小到「说不出哪里在动」 */
      bindings: { y: '496 + Math.sin(time * 0.0014) * 5' },
    }),
  );

  /*
   * 声音：三段铺底换和弦（Am → F → C），一条 128 BPM 的节拍贯穿（与画面共用同一份
   * 速度网格，所以鼓点与切点不会各走各的），一条提示音钉在九个切点上。
   * 全部现场合成，assets 依然是 0。
   */
  const pads: { id: string; name: string; from: number; to: number; chord: number[]; volume: number }[] = [
    { id: 'ly_rev_pad_a', name: '音频 · 铺底 A（Am）', from: 0, to: 20_000, chord: [0, 7, 12, 15], volume: 0.30 },
    { id: 'ly_rev_pad_b', name: '音频 · 铺底 B（F）', from: 18_000, to: 40_000, chord: [-4, 0, 7, 12], volume: 0.27 },
    { id: 'ly_rev_pad_c', name: '音频 · 铺底 C（C）', from: 37_000, to: REVISION_DURATION, chord: [3, 7, 12, 16], volume: 0.28 },
  ];
  for (const p of pads) {
    layers.push(
      createAudioLayer({
        id: p.id,
        name: p.name,
        inPoint: p.from,
        outPoint: p.to,
        volume: p.volume,
        fadeIn: 2200,
        fadeOut: 2800,
        tone: { preset: 'pad', root: 110, bpm: REVISION_BPM, chord: p.chord, marks: [] },
      }),
    );
  }

  layers.push(
    createAudioLayer({
      id: 'ly_rev_pulse',
      name: '音频 · 节拍 128',
      inPoint: 3_750,
      outPoint: 52_500,
      volume: 0.15,
      fadeIn: 600,
      fadeOut: 1400,
      tone: { preset: 'pulse', root: 110, bpm: REVISION_BPM, chord: [0], marks: [] },
    }),
  );

  layers.push(
    createAudioLayer({
      id: 'ly_rev_chime',
      name: '音频 · 切点提示',
      inPoint: 0,
      outPoint: REVISION_DURATION,
      volume: 0.18,
      fadeIn: 0,
      fadeOut: 1400,
      /* marks 相对图层起点；图层从 0 开始，所以就是切点的绝对时间 */
      tone: {
        preset: 'chime',
        root: 110,
        bpm: REVISION_BPM,
        chord: [0, 7, 12, 16],
        marks: SECTION_SPANS.map((s) => s.from),
      },
    }),
  );

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: REVISION_PROJECT_ID,
    name: REVISION_NAME,
    width: W,
    height: H,
    duration: REVISION_DURATION,
    fps: FPS,
    loop: false,
    layers,
    assets: [],
    fonts: [],
    tempo: { bpm: REVISION_BPM, offsetMs: 0, meter: REVISION_METER },
    lyrics: REVISION_LYRICS,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
