/**
 * 首次打开应用时放进工程库的那份示例工程。
 *
 * 它现在是一支**长视频**（96 秒 / 1920×1080 / 30fps），内容就是介绍 Kinelayer 本身：
 * 项目背景 → 核心功能 → 使用方式 → 主要内容 → 收尾。用户打开它，等于看完一支产品导览，
 * 顺手还能在时间轴上看见「章节是怎么用图层和关键帧排出来的」。
 *
 * 三条硬约束，都是「新用户第一眼」倒推出来的：
 *
 * 1. **不依赖任何外部资源**。没有图片、没有视频、没有音频文件 —— 画面全是文本层与
 *    canvas2d 代码层，声音是 WebAudio 现场合成的（见 core/types.ts 的 ToneSpec）。
 *    否则第一次打开就是一片「资源缺失」的灰块，示例反而变成了故障演示。
 * 2. **第 0 帧就得有内容**。播放头在 0，而入场预设（`enter`）在这一刻透明度是 0：
 *    照搬演示工程的话，新用户打开只看到背景。所以这里不用入场/退场预设，
 *    第 1 章的标题从 t=0 起就是 1.0 不透明度，动效靠字距与轨道。
 * 3. **看得出能改**。图层名写人话（`02 · 标题`、`图形 · 三个窗口`、`音频 · 铺底长音`），
 *    时间轴上章节边界一眼可见 —— 图层面板本身就是这支片子的分镜表。
 *
 * 结构上刻意保持「一个章节 = 一组图层，区间相同」：用户想改哪一章，框选那一组就够；
 * 想删哪一章，整组删掉不会留下孤儿关键帧。
 */

import { createAudioLayer, createCodeLayer, createTextLayer, defaultCodeSpec, defaultTextStyle, emptyAnimation } from './defaults';
import { uid } from './ids';
import type { CodeLayer, Layer, Project, PropertyTrack, TextLayer, AudioLayer } from './types';
import { PROJECT_SCHEMA_VERSION } from './types';

/**
 * 固定 id。
 *
 * 不用随机 id 有两个原因：一是「示例是否已存在」可以直接按 id 查索引，
 * 标记位丢了也不会重复创建；二是自检和文档里能写死一个可读的 id。
 */
export const SAMPLE_PROJECT_ID = 'prj_sample_start';
export const SAMPLE_PROJECT_NAME = '示例 · 织层导览（96 秒）';

const W = 1920;
const H = 1080;
const FPS = 30;
/** 章节长度（毫秒）。六章同一节拍，改章节只要改这个表 */
const CH = 16_000;
export const SAMPLE_DURATION = CH * 6;

const COLOR = {
  ink: '#080a10',
  text: '#ffffff',
  body: '#aab8cf',
  dim: '#74849c',
  accent: '#7c5cff',
  cyan: '#22d3ee',
};

const FONT = 'Microsoft YaHei';
const MONO = 'Consolas';

/* --------------------------------------------------------------- 小工具 */

function track(
  property: PropertyTrack['property'],
  keyframes: { time: number; value: number; kind: PropertyTrack['keyframes'][number]['easing']['kind'] }[],
): PropertyTrack {
  return {
    property,
    keyframes: keyframes.map((k) => ({ id: uid('kf'), time: k.time, value: k.value, easing: { kind: k.kind } })),
  };
}

interface Timing {
  /** 绝对起止（毫秒） */
  from: number;
  to: number;
  /** 相对区间起点的淡入/淡出时长；fadeIn 传 0 表示「从一开始就是实的」 */
  fadeIn?: number;
  fadeOut?: number;
  /** 上浮距离，0 表示不动 */
  rise?: number;
}

/**
 * 给一层加「淡入 → 停住 → 淡出」的轨道。
 *
 * 同一属性只能有一条轨道（求值时按 property 找），所以淡入淡出必须写进**同一条**
 * opacity 轨道，而不是两条轨道各管一头。
 */
function animate(layer: Layer, t: Timing): Layer {
  const length = Math.max(1, t.to - t.from);
  const fadeIn = Math.max(0, Math.min(t.fadeIn ?? 420, length * 0.5));
  const fadeOut = Math.max(0, Math.min(t.fadeOut ?? 320, length * 0.4));
  layer.inPoint = t.from;
  layer.outPoint = t.to;

  const stops: { time: number; value: number; kind: 'linear' | 'ease-out' | 'ease-in' }[] = [];
  if (fadeIn > 0) stops.push({ time: 0, value: 0, kind: 'ease-out' });
  stops.push({ time: fadeIn, value: 1, kind: 'linear' });
  if (fadeOut > 0) {
    stops.push({ time: length - fadeOut, value: 1, kind: 'ease-in' });
    stops.push({ time: length, value: 0, kind: 'linear' });
  }

  layer.animation = { ...emptyAnimation(), tracks: [track('opacity', stops)] };

  if (t.rise) {
    layer.animation.tracks.push(
      track('y', [
        { time: 0, value: layer.y + t.rise, kind: 'ease-out-cubic' },
        { time: Math.max(600, fadeIn), value: layer.y, kind: 'ease-out' },
      ]),
    );
  }
  return layer;
}

/** 一段文本。默认左对齐、自动换行，行高统一 1.7 —— 正文读起来才不挤 */
function text(
  id: string,
  name: string,
  content: string,
  box: { x: number; y: number; w: number; h: number },
  style: Partial<ReturnType<typeof defaultTextStyle>>,
): TextLayer {
  return createTextLayer({
    id,
    name,
    x: box.x,
    y: box.y,
    width: box.w,
    height: box.h,
    text: content,
    style: { ...defaultTextStyle(), fontFamily: FONT, fontSize: 26, lineHeight: 1.72, color: COLOR.body, ...style },
  });
}

/** 一个图形。canvas2d 的坐标系按图层尺寸建好（0,0 → width,height），`time` 是工程绝对时间 */
function graphic(id: string, name: string, source: string): CodeLayer {
  return createCodeLayer({
    id,
    name,
    x: 1010,
    y: 150,
    width: 800,
    height: 620,
    opacity: 1,
    blendMode: 'normal',
    code: defaultCodeSpec({ engine: 'canvas2d', source, params: {} }),
  });
}

/* ------------------------------------------------------------- 章节文案 */

interface Chapter {
  no: string;
  kicker: string;
  title: string;
  body: string;
  graphic: string;
  graphicName: string;
}

const CHAPTERS: Chapter[] = [
  {
    no: '01',
    kicker: 'KINELAYER · 织层',
    title: '可编程的\n动态海报工作台',
    body:
      '一份工程，三条入口：命令、图层、时间轴。\n\n' +
      '你在这里做的每一步都会变成一条可回放的命令 —— 所以它既能被撤销，也能被 AI 读懂、被你重新编排。',
    graphic: 'open',
    graphicName: '图形 · 开场星轨',
  },
  {
    no: '02',
    kicker: '项目背景',
    title: '三个窗口，\n各说各话',
    body:
      '做动效的人大多经历过这一幕：设计稿在一个工具里，动效在另一个工具里，参数最后靠聊天记录对齐。\n\n' +
      'Kinelayer 的出发点很朴素 —— 让画面、时间与指令，共用同一份数据。',
    graphic: 'why',
    graphicName: '图形 · 三个窗口',
  },
  {
    no: '03',
    kicker: '核心功能',
    title: '四件事，\n一套数据结构',
    body: '',
    graphic: 'core',
    graphicName: '图形 · 功能环',
  },
  {
    no: '04',
    kicker: '使用方式',
    title: '从空白到成片，\n四步',
    body: '',
    graphic: 'flow',
    graphicName: '图形 · 四步进度',
  },
  {
    no: '05',
    kicker: '主要内容',
    title: '工程里\n有什么',
    body: '',
    graphic: 'content',
    graphicName: '图形 · 四张卡片',
  },
  {
    no: '06',
    kicker: '收尾',
    title: '现在，\n改一改它',
    body:
      '删掉这行字、拖一个图层、按一次播放。\n\n' +
      '工程库里的这份示例随时可以放回来 —— 它是入口，不是展品。',
    graphic: 'end',
    graphicName: '图形 · 收束',
  },
];

/** 第 3、4、5 章的要点，逐条进场（每个点一组图层，方便整组删改） */
const POINTS: Record<string, { at: number; head: string; body: string }[]> = {
  '03': [
    { at: 0, head: '命令总线', body: '每个操作都是一条命令：可撤销、可审计、可被自动化重放' },
    { at: 2200, head: '图层与关键帧', body: '属性轨道精确到毫秒，缓动支持 cubic-bezier' },
    { at: 4400, head: '代码图层', body: 'canvas2d / GLSL / HTML 直接画进画布，参数即插即用' },
    { at: 6600, head: 'AI 协作', body: '场景以结构化 JSON 交给模型，改完回到同一条总线' },
  ],
  '04': [
    { at: 0, head: '① 新建或打开', body: '选一个尺寸，或从本地导入 .kly 工程包' },
    { at: 2200, head: '② 加图层', body: '文本、图片、视频、代码；也可以让 AI 直接生成' },
    { at: 4400, head: '③ 拖关键帧', body: '播放头停在某一刻，改属性就自动打点' },
    { at: 6600, head: '④ 导出', body: 'PNG 单帧、WebM 视频（带音轨）、remotion-kit' },
  ],
  '05': [
    { at: 0, head: '工程库', body: '自动保存、缩略图、按最近打开排序' },
    { at: 2200, head: '示例与模板', body: '你正在看的这一份，就是一个完整工程' },
    { at: 4400, head: '自定义命令', body: '人和 AI 共用的一套宏，参数化后一键重放' },
    { at: 6600, head: '导入导出', body: '.kly 工程包 · Remotion · HTML · 场景 JSON' },
  ],
};

/* ----------------------------------------------------------------- 图形 */

/** 开场的星轨：缓慢旋转的点阵，给标题做背景 */
const G_OPEN = `
const t = time * 0.00035;
ctx.clearRect(0, 0, width, height);
const cx = width * 0.5;
const cy = height * 0.5;
ctx.globalCompositeOperation = 'lighter';
for (let ring = 0; ring < 5; ring++) {
  const r = 96 + ring * 78;
  const n = 30 + ring * 9;
  for (let i = 0; i < n; i++) {
    const a = t * (ring % 2 === 0 ? 1 : -1) + (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.6;
    const s = 2 + Math.sin(time * 0.002 + i) * 1.2;
    ctx.fillStyle = ring % 2 === 0 ? 'rgba(124,92,255,0.62)' : 'rgba(34,211,238,0.48)';
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }
}
`;

/** 背景章：三个各自为政的窗口，一条总线把它们串起来 */
const G_WHY = `
const t = Math.min(1, Math.max(0, (time - 16000) / 16000));
ctx.clearRect(0, 0, width, height);
const gap = 22;
const bw = (width - 80 - gap * 2) / 3;
const bh = 168;
const boxes = [
  { x: 40, y: 60, label: 'CODE', c: 'rgba(124,92,255,0.95)' },
  { x: 40 + bw + gap, y: 60, label: 'TIMELINE', c: 'rgba(34,211,238,0.95)' },
  { x: 40 + (bw + gap) * 2, y: 60, label: 'AI', c: 'rgba(245,158,11,0.95)' },
];
ctx.font = '600 17px Consolas';
ctx.textAlign = 'center';
for (const b of boxes) {
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(b.x, b.y, bw, bh);
  ctx.strokeStyle = 'rgba(255,255,255,0.20)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(b.x, b.y, bw, bh);
  ctx.fillStyle = b.c;
  ctx.fillText(b.label, b.x + bw / 2, b.y + 52);
  ctx.fillStyle = 'rgba(255,255,255,0.13)';
  for (let i = 0; i < 3; i++) ctx.fillRect(b.x + 26, b.y + 82 + i * 20, bw - 52 - i * 34, 7);
}
const busY = 430;
for (const b of boxes) {
  const x = b.x + bw / 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, b.y + bh);
  ctx.lineTo(x, busY);
  ctx.stroke();
}
ctx.strokeStyle = 'rgba(124,92,255,' + (0.28 + t * 0.55) + ')';
ctx.lineWidth = 2.5;
ctx.beginPath();
ctx.moveTo(40, busY);
ctx.lineTo(40 + (width - 80) * t, busY);
ctx.stroke();
ctx.fillStyle = 'rgba(124,92,255,1)';
ctx.beginPath();
ctx.arc(40 + (width - 80) * t, busY, 6, 0, Math.PI * 2);
ctx.fill();
ctx.textAlign = 'center';
ctx.fillStyle = 'rgba(255,255,255,0.6)';
ctx.font = '500 19px "Microsoft YaHei"';
ctx.fillText('一份工程 · 一条命令总线', width / 2, busY + 62);
`;

/** 核心功能：四个节点绕中心转，按序点亮 */
const G_CORE = `
const t = time * 0.001;
ctx.clearRect(0, 0, width, height);
const cx = width / 2;
const cy = height / 2;
const R = 214;
ctx.globalCompositeOperation = 'lighter';
const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 180);
g.addColorStop(0, 'rgba(124,92,255,0.42)');
g.addColorStop(1, 'rgba(124,92,255,0)');
ctx.fillStyle = g;
ctx.beginPath();
ctx.arc(cx, cy, 180, 0, Math.PI * 2);
ctx.fill();
ctx.globalCompositeOperation = 'source-over';
ctx.strokeStyle = 'rgba(255,255,255,0.10)';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.arc(cx, cy, R, 0, Math.PI * 2);
ctx.stroke();
ctx.fillStyle = 'rgba(255,255,255,0.9)';
ctx.beginPath();
ctx.arc(cx, cy, 9, 0, Math.PI * 2);
ctx.fill();
for (let i = 0; i < 4; i++) {
  const a = -Math.PI / 2 + (i / 4) * Math.PI * 2 + t * 0.08;
  const x = cx + Math.cos(a) * R;
  const y = cy + Math.sin(a) * R;
  const lit = (Math.sin(t * 1.5 - i * 1.2) + 1) / 2;
  ctx.strokeStyle = 'rgba(255,255,255,' + (0.06 + lit * 0.16) + ')';
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 11 + lit * 5, 0, Math.PI * 2);
  ctx.fillStyle = i % 2 === 0
    ? 'rgba(124,92,255,' + (0.55 + lit * 0.45) + ')'
    : 'rgba(34,211,238,' + (0.55 + lit * 0.45) + ')';
  ctx.fill();
}
`;

/** 使用方式：四步进度条，光点按步推进 */
const G_FLOW = `
ctx.clearRect(0, 0, width, height);
const t = Math.min(1, Math.max(0, (time - 48000) / 16000));
const pad = 40;
const stepW = (width - pad * 2) / 4;
ctx.textAlign = 'left';
for (let i = 0; i < 4; i++) {
  const x = pad + i * stepW;
  const active = t * 4 > i;
  const prog = Math.min(1, Math.max(0, t * 4 - i));
  ctx.fillStyle = active ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.07)';
  ctx.fillRect(x + 10, 300, stepW - 32, 6);
  ctx.fillStyle = 'rgba(124,92,255,0.95)';
  if (prog > 0) ctx.fillRect(x + 10, 300, (stepW - 32) * prog, 6);
  ctx.beginPath();
  ctx.arc(x + 10, 303, 8, 0, Math.PI * 2);
  ctx.fillStyle = active ? 'rgba(124,92,255,1)' : 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.fillStyle = active ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.30)';
  ctx.font = '600 30px Consolas';
  ctx.fillText('0' + (i + 1), x + 10, 258);
  ctx.fillStyle = active ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.16)';
  for (let k = 0; k < 3; k++) ctx.fillRect(x + 10, 340 + k * 22, (stepW - 42) * (1 - k * 0.18), 6);
}
`;

/** 主要内容：2×2 卡片 */
const G_CONTENT = `
const t = Math.min(1, Math.max(0, (time - 64000) / 16000));
ctx.clearRect(0, 0, width, height);
const pad = 40;
const gap = 20;
const cw = (width - pad * 2 - gap) / 2;
const chh = 250;
const cards = [
  { x: pad, y: 40 },
  { x: pad + cw + gap, y: 40 },
  { x: pad, y: 40 + chh + gap },
  { x: pad + cw + gap, y: 40 + chh + gap },
];
for (let i = 0; i < cards.length; i++) {
  const c = cards[i];
  const a = Math.min(1, Math.max(0, t * 4 - i));
  ctx.fillStyle = 'rgba(255,255,255,' + (0.025 + a * 0.045) + ')';
  ctx.fillRect(c.x, c.y, cw, chh);
  ctx.strokeStyle = 'rgba(124,92,255,' + (0.10 + a * 0.55) + ')';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(c.x, c.y, cw, chh);
  ctx.fillStyle = 'rgba(255,255,255,' + (0.10 + a * 0.22) + ')';
  ctx.fillRect(c.x + 28, c.y + 34, 110, 12);
  for (let k = 0; k < 4; k++) {
    ctx.fillStyle = 'rgba(255,255,255,' + (0.05 + a * 0.09) + ')';
    ctx.fillRect(c.x + 28, c.y + 84 + k * 30, cw - 56 - k * 44, 9);
  }
}
`;

/** 收尾：向内收束的点 */
const G_END = `
ctx.clearRect(0, 0, width, height);
const t = Math.min(1, Math.max(0, (time - 81000) / 15000));
const cx = width / 2;
const cy = height / 2;
ctx.globalCompositeOperation = 'lighter';
for (let i = 0; i < 180; i++) {
  const a = api.rand(i * 3.1) * Math.PI * 2;
  const r0 = 380 * (0.35 + api.rand(i * 7.7));
  const r = r0 * (1 - t * 0.7);
  const x = cx + Math.cos(a) * r;
  const y = cy + Math.sin(a) * r * 0.72;
  ctx.fillStyle = i % 3 === 0 ? 'rgba(34,211,238,0.6)' : 'rgba(124,92,255,0.6)';
  ctx.beginPath();
  ctx.arc(x, y, 2, 0, Math.PI * 2);
  ctx.fill();
}
if (t > 0.55) {
  const k = (t - 0.55) / 0.45;
  ctx.strokeStyle = 'rgba(255,255,255,' + (0.18 * k) + ')';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 40 + k * 30, 0, Math.PI * 2);
  ctx.stroke();
}
`;

const GRAPHICS: Record<string, string> = { open: G_OPEN, why: G_WHY, core: G_CORE, flow: G_FLOW, content: G_CONTENT, end: G_END };

/* --------------------------------------------------------------- 组装 */

export function createSampleProject(): Project {
  const now = Date.now();
  const layers: Layer[] = [];

  /* 背景：与全站一致的深色渐变，代码层画的星轨压在上面 */
  layers.push({
    id: 'ly_sample_bg',
    type: 'background',
    name: '背景',
    x: 0,
    y: 0,
    width: W,
    height: H,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: true,
    blendMode: 'normal',
    animation: emptyAnimation(),
    inPoint: 0,
    outPoint: SAMPLE_DURATION,
    bindings: {},
    meta: {},
    kind: 'gradient',
    color: COLOR.ink,
    gradient: {
      type: 'linear',
      angle: 135,
      stops: [
        { offset: 0, color: '#070910' },
        { offset: 0.55, color: '#0e1526' },
        { offset: 1, color: '#1d1038' },
      ],
    },
    assetId: null,
    fit: 'cover',
    code: { engine: 'canvas2d', source: '', params: {} },
  });

  /* 全片底纹：一条缓慢流动的线，贯穿 96 秒，给画面一点「还在动」的底噪 */
  const flow = createCodeLayer({
    id: 'ly_sample_flow',
    name: '底纹 · 流线',
    x: 0,
    y: 0,
    width: W,
    height: H,
    opacity: 0.55,
    blendMode: 'screen',
    inPoint: 0,
    outPoint: SAMPLE_DURATION,
    code: defaultCodeSpec({
      engine: 'canvas2d',
      source: `
const t = time * 0.00012;
ctx.clearRect(0, 0, width, height);
ctx.globalCompositeOperation = 'lighter';
for (let i = 0; i < 5; i++) {
  const o = i * 0.7;
  ctx.beginPath();
  for (let x = -40; x <= width + 40; x += 24) {
    const y = height * (0.2 + i * 0.14) + Math.sin(x * 0.0028 + t + o) * 54 + (api.noise(x * 0.0011 + t, i) - 0.5) * 120;
    if (x === -40) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = i % 2 === 0 ? 'rgba(124,92,255,0.22)' : 'rgba(34,211,238,0.16)';
  ctx.lineWidth = 1.4;
  ctx.stroke();
}
`,
    }),
  });
  layers.push(flow);

  /* 页脚：全片常驻，给一个稳定的信息锚点 */
  layers.push(
    text(
      'ly_sample_footer',
      '页脚 · 工程信息',
      'KINELAYER · 织层    ·    1920 × 1080    ·    30 FPS    ·    示例工程 prj_sample_start',
      { x: 110, y: 986, w: 1200, h: 40 },
      { fontFamily: MONO, fontSize: 18, letterSpacing: 1.6, color: COLOR.dim, wrap: false },
    ),
  );

  CHAPTERS.forEach((chapter, index) => {
    const from = index * CH;
    const to = from + CH;
    const isOpen = index === 0;

    /* 章节序号：小、等宽、贴着左上角，像分镜表上的场次 */
    const no = text(
      `ly_sample_${chapter.no}_no`,
      `${chapter.no} · 章节序号`,
      `${chapter.no} / 06`,
      { x: 110, y: 120, w: 420, h: 40 },
      { fontFamily: MONO, fontSize: 20, letterSpacing: 3.2, color: COLOR.accent, wrap: false },
    );
    animate(no, { from, to, fadeIn: isOpen ? 0 : 300, fadeOut: isOpen ? 0 : 260 });
    layers.push(no);

    const kicker = text(
      `ly_sample_${chapter.no}_kicker`,
      `${chapter.no} · 眉标`,
      chapter.kicker,
      { x: 110, y: 168, w: 760, h: 40 },
      { fontFamily: MONO, fontSize: 19, letterSpacing: 4, color: COLOR.dim, wrap: false },
    );
    animate(kicker, { from, to, fadeIn: isOpen ? 0 : 340, fadeOut: isOpen ? 0 : 260 });
    layers.push(kicker);

    /* 标题：开场更大。第 1 章从 t=0 就不透明，靠字距收拢做动效，不用淡入 */
    const title = text(
      `ly_sample_${chapter.no}_title`,
      `${chapter.no} · 标题`,
      chapter.title,
      { x: 110, y: 214, w: 820, h: 300 },
      {
        fontSize: isOpen ? 84 : 72,
        fontWeight: 700,
        lineHeight: 1.16,
        letterSpacing: isOpen ? -1 : 0,
        color: COLOR.text,
        wrap: false,
      },
    );
    if (isOpen) {
      /* 字距从 18px 收到 0：视觉上是「文字落定」，而 t=0 时它已经是实的 */
      title.animation = {
        ...emptyAnimation(),
        tracks: [
          track('letterSpacing', [
            { time: 0, value: 18, kind: 'ease-out-cubic' },
            { time: 1800, value: 0, kind: 'ease-out' },
          ]),
        ],
      };
      title.inPoint = 0;
      title.outPoint = to;
    } else {
      animate(title, { from, to, fadeIn: 420, fadeOut: 300, rise: 26 });
    }
    layers.push(title);

    if (chapter.body) {
      const body = text(
        `ly_sample_${chapter.no}_body`,
        `${chapter.no} · 正文`,
        chapter.body,
        { x: 110, y: isOpen ? 620 : 560, w: 800, h: isOpen ? 240 : 300 },
        {},
      );
      animate(body, { from: from + (isOpen ? 0 : 260), to, fadeIn: isOpen ? 0 : 460, fadeOut: isOpen ? 0 : 280, rise: isOpen ? 0 : 18 });
      layers.push(body);
    }

    const g = graphic(`ly_sample_${chapter.no}_graphic`, chapter.graphicName, GRAPHICS[chapter.graphic] ?? '');
    g.inPoint = from;
    g.outPoint = to;
    g.animation = emptyAnimation();
    /* 图形整体轻微淡入，但不做位移：它右对齐，位移会露出边缘 */
    if (!isOpen) {
      g.animation.tracks = [
        track('opacity', [
          { time: 0, value: 0, kind: 'ease-out' },
          { time: 600, value: 1, kind: 'linear' },
          { time: CH - 300, value: 1, kind: 'ease-in' },
          { time: CH, value: 0, kind: 'linear' },
        ]),
      ];
    }
    layers.push(g);

    /* 要点：逐条进场。每条 = 名称 + 说明 两层，放同一段区间，方便整组删 */
    const points = POINTS[chapter.no];
    if (points) {
      points.forEach((point, i) => {
        const start = from + point.at;
        const head = text(
          `ly_sample_${chapter.no}_p${i}_head`,
          `${chapter.no} · 要点${i + 1}`,
          point.head,
          { x: 110, y: 560 + i * 108, w: 820, h: 44 },
          { fontSize: 32, fontWeight: 600, color: COLOR.text, wrap: false },
        );
        animate(head, { from: start, to, fadeIn: 360, fadeOut: 260, rise: 16 });
        layers.push(head);

        const desc = text(
          `ly_sample_${chapter.no}_p${i}_desc`,
          `${chapter.no} · 要点${i + 1} 说明`,
          point.body,
          { x: 110, y: 606 + i * 108, w: 820, h: 36 },
          { fontSize: 22, color: COLOR.body, wrap: false },
        );
        animate(desc, { from: start + 120, to, fadeIn: 360, fadeOut: 260 });
        layers.push(desc);
      });
    }
  });

  /* 收尾页的提示条：贴在页脚上方，说明这份工程能怎么用 */
  const hint = text(
    'ly_sample_hint',
    '收尾 · 提示',
    '空格播放 / 暂停    ·    拖时间轴跳章节    ·    ⌘/Ctrl + Z 撤销你改的每一步',
    { x: 110, y: 900, w: 1400, h: 40 },
    { fontFamily: MONO, fontSize: 20, letterSpacing: 1.2, color: COLOR.dim, wrap: false },
  );
  animate(hint, { from: 84_000, to: SAMPLE_DURATION, fadeIn: 500, fadeOut: 0 });
  layers.push(hint);

  /* ---------------------------------------------------------- 音频三条 */
  const pad: AudioLayer = createAudioLayer({
    id: 'ly_sample_audio_pad',
    name: '音频 · 铺底长音',
    inPoint: 0,
    outPoint: SAMPLE_DURATION,
    volume: 0.34,
    fadeIn: 2600,
    fadeOut: 3600,
    tone: { preset: 'pad', root: 110, bpm: 84, chord: [0, 7, 12, 19], marks: [] },
  });
  layers.push(pad);

  const pulse: AudioLayer = createAudioLayer({
    id: 'ly_sample_audio_pulse',
    name: '音频 · 节拍',
    inPoint: 16_000,
    outPoint: 81_000,
    volume: 0.16,
    fadeIn: 1200,
    fadeOut: 1800,
    tone: { preset: 'pulse', root: 110, bpm: 84, chord: [0], marks: [] },
  });
  layers.push(pulse);

  /* 提示音落在每个章节的切点上：marks 是相对图层起点的毫秒 */
  const chime: AudioLayer = createAudioLayer({
    id: 'ly_sample_audio_chime',
    name: '音频 · 章节提示',
    inPoint: 0,
    outPoint: SAMPLE_DURATION,
    volume: 0.2,
    fadeIn: 0,
    fadeOut: 1200,
    tone: { preset: 'chime', root: 110, bpm: 84, chord: [0, 7, 12, 16], marks: [0, 16_000, 32_000, 48_000, 64_000, 80_000] },
  });
  layers.push(chime);

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: SAMPLE_PROJECT_ID,
    name: SAMPLE_PROJECT_NAME,
    width: W,
    height: H,
    duration: SAMPLE_DURATION,
    fps: FPS,
    /* 长视频不循环：播到结尾停住，再按播放从头开始（timeline.play 的行为） */
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

/** 给启动页的引导条用：把「这份示例能看什么」变成几个数字，而不是写死在文案里 */
export function sampleHighlights(project: Project): {
  layers: number;
  tracks: number;
  codeLayers: number;
  audioLayers: number;
  seconds: number;
} {
  return {
    layers: project.layers.length,
    tracks: project.layers.reduce((n, l) => n + (l.animation?.tracks?.length ?? 0), 0),
    codeLayers: project.layers.filter((l) => l.type === 'code').length,
    audioLayers: project.layers.filter((l) => l.type === 'audio').length,
    seconds: Math.round(project.duration / 1000),
  };
}
