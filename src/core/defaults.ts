import { uid } from './ids';
import { clamp } from './geometry';
import { DEFAULT_TEMPO, clampTempo, normalizeLyrics } from './score';
import {
  ANIMATABLE_PROPERTIES,
  BLEND_MODES,
  LAYER_TYPES,
  LIMITS,
  PROJECT_SCHEMA_VERSION,
  type AssetMeta,
  type AudioLayer,
  type BackgroundLayer,
  type CodeLayer,
  type CodeSpec,
  type FontMeta,
  type ImageLayer,
  type Layer,
  type LayerAnimation,
  type Project,
  type PropertyTrack,
  type TextLayer,
  type TextStyle,
  type Tempo,
  type ToneSpec,
  type VideoLayer,
  type BlendMode,
  type LayerType,
} from './types';

export const FONT_STACK_FALLBACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';

export function defaultTextStyle(): TextStyle {
  return {
    fontFamily: 'Segoe UI',
    fontSize: 64,
    fontWeight: 600,
    fontStyle: 'normal',
    lineHeight: 1.25,
    letterSpacing: 0,
    align: 'left',
    verticalAlign: 'top',
    color: '#f5f6fa',
    useGradient: false,
    gradient: {
      type: 'linear',
      angle: 90,
      stops: [
        { offset: 0, color: '#ffffff' },
        { offset: 1, color: '#9b83ff' },
      ],
    },
    stroke: null,
    shadow: null,
    wrap: true,
    uppercase: false,
  };
}

export function emptyAnimation(): LayerAnimation {
  return { tracks: [], autoKeyframe: true };
}

/**
 * v2 迁移：把任意来源的 animation 补成当前形状。
 * 读宽容——v1 的文件没有 tracks / autoKeyframe，缺了就用默认值补上；
 * 写严格——serializeProject 出去的永远是带这两个字段的当前版本。
 */
export function normalizeAnimation(raw: unknown): LayerAnimation {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const anim = emptyAnimation();
  if (r.enter && typeof r.enter === 'object') anim.enter = r.enter as LayerAnimation['enter'];
  if (r.exit && typeof r.exit === 'object') anim.exit = r.exit as LayerAnimation['exit'];
  if (r.emphasis && typeof r.emphasis === 'object') anim.emphasis = r.emphasis as LayerAnimation['emphasis'];
  if (typeof r.autoKeyframe === 'boolean') anim.autoKeyframe = r.autoKeyframe;
  if (Array.isArray(r.tracks)) {
    anim.tracks = (r.tracks as PropertyTrack[])
      .filter((t) => t && typeof t === 'object' && ANIMATABLE_PROPERTIES.includes(t.property))
      .map((t) => ({
        property: t.property,
        keyframes: (Array.isArray(t.keyframes) ? t.keyframes : [])
          .filter((k) => k && Number.isFinite(k.time) && Number.isFinite(k.value))
          .map((k) => ({
            id: typeof k.id === 'string' && k.id ? k.id : uid('kf'),
            time: Math.round(k.time),
            value: k.value,
            easing: k.easing && typeof k.easing === 'object' ? k.easing : { kind: 'ease-out' as const },
          }))
          .sort((a, b) => a.time - b.time),
      }))
      .filter((t) => t.keyframes.length > 0);
  }
  return anim;
}

export function baseLayer(type: LayerType, overrides: Partial<Layer> = {}): Omit<Layer, 'type'> & { type: LayerType } {
  const base = {
    id: uid('ly'),
    type,
    name: '图层',
    x: 0,
    y: 0,
    width: 400,
    height: 200,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blendMode: 'normal' as BlendMode,
    animation: emptyAnimation(),
    inPoint: 0,
    outPoint: 0,
    bindings: {},
    meta: {},
  };
  const merged = { ...base, ...(overrides as object) } as Omit<Layer, 'type'> & { type: LayerType };
  // overrides 里的 animation 会整体替换掉 base 的那份，这里补齐 v2 字段，避免半截对象流进数据层
  return { ...merged, animation: normalizeAnimation(merged.animation) };
}

export function createBackground(overrides: Partial<BackgroundLayer> = {}): BackgroundLayer {
  const layer: BackgroundLayer = {
    ...(baseLayer('background') as BackgroundLayer),
    type: 'background',
    name: '背景',
    kind: 'gradient',
    color: '#0b0e14',
    gradient: {
      type: 'linear',
      angle: 135,
      stops: [
        { offset: 0, color: '#0a0d14' },
        { offset: 0.55, color: '#141a2b' },
        { offset: 1, color: '#251440' },
      ],
    },
    assetId: null,
    fit: 'cover',
    code: { engine: 'canvas2d', source: '', params: {} },
    locked: true,
  };
  return { ...layer, ...overrides };
}

export function createTextLayer(overrides: Partial<TextLayer> = {}): TextLayer {
  const layer: TextLayer = {
    ...(baseLayer('text') as TextLayer),
    type: 'text',
    name: '文本',
    text: '双击编辑文字',
    style: defaultTextStyle(),
    width: 640,
    height: 160,
  };
  return { ...layer, ...overrides, style: { ...defaultTextStyle(), ...(overrides.style ?? {}) } };
}

export function createImageLayer(overrides: Partial<ImageLayer> = {}): ImageLayer {
  const layer: ImageLayer = {
    ...(baseLayer('image') as ImageLayer),
    type: 'image',
    name: '图片',
    assetId: null,
    fit: 'cover',
    radius: 0,
    brightness: 1,
    contrast: 1,
    saturate: 1,
    grayscale: 0,
    blur: 0,
    width: 520,
    height: 520,
  };
  return { ...layer, ...overrides };
}

export function createVideoLayer(overrides: Partial<VideoLayer> = {}): VideoLayer {
  const layer: VideoLayer = {
    ...(baseLayer('video') as VideoLayer),
    type: 'video',
    name: '视频',
    assetId: null,
    fit: 'cover',
    radius: 0,
    muted: true,
    loop: true,
    playbackRate: 1,
    width: 640,
    height: 360,
  };
  return { ...layer, ...overrides };
}

export const DEFAULT_CODE_SOURCE = `// 画布已按图层尺寸建好坐标系：0,0 → width,height
// 可用：ctx / api / params / width / height / time / frame / state
const t = time * 0.001;
ctx.clearRect(0, 0, width, height);

const g = ctx.createLinearGradient(0, 0, width, height);
g.addColorStop(0, 'rgba(124,92,255,0.28)');
g.addColorStop(1, 'rgba(34,211,238,0.22)');
ctx.fillStyle = g;
ctx.fillRect(0, 0, width, height);

ctx.strokeStyle = 'rgba(255,255,255,0.28)';
ctx.lineWidth = 2;
for (let i = 0; i < 5; i++) {
  const y = height * (0.2 + i * 0.15);
  ctx.beginPath();
  ctx.arc(width / 2, y, 60 + Math.sin(t + i) * 18, 0, Math.PI * 2);
  ctx.stroke();
}
`;

export function defaultCodeSpec(overrides: Partial<CodeSpec> = {}): CodeSpec {
  return { engine: 'canvas2d', source: DEFAULT_CODE_SOURCE, params: {}, ...overrides };
}

export function createCodeLayer(overrides: Partial<CodeLayer> = {}): CodeLayer {
  const layer: CodeLayer = {
    ...(baseLayer('code') as CodeLayer),
    type: 'code',
    name: '代码',
    code: defaultCodeSpec(),
    width: 480,
    height: 480,
  };
  return { ...layer, ...overrides, code: { ...defaultCodeSpec(), ...(overrides.code ?? {}) } };
}

/**
 * 默认音源：A2 根音的小三和弦长音，足够当背景铺底，也不至于抢画面。
 * 具体用到哪几个音由使用方覆盖（示例工程按章节换和弦）。
 */
export function defaultToneSpec(overrides: Partial<ToneSpec> = {}): ToneSpec {
  return {
    preset: 'pad',
    root: 110,
    bpm: 84,
    chord: [0, 7, 12],
    marks: [],
    ...overrides,
  };
}

export function createAudioLayer(overrides: Partial<AudioLayer> = {}): AudioLayer {
  const layer: AudioLayer = {
    ...(baseLayer('audio') as AudioLayer),
    type: 'audio',
    name: '音频',
    /* 音频不参与画面：给一个 0×0 的框，选中时不会在舞台上糊出一个大方块 */
    width: 0,
    height: 0,
    volume: 0.6,
    muted: false,
    fadeIn: 300,
    fadeOut: 500,
    tone: defaultToneSpec(),
  };
  return { ...layer, ...overrides, tone: { ...defaultToneSpec(), ...(overrides.tone ?? {}) } };
}

export function createLayer(type: LayerType, overrides: Partial<Layer> = {}): Layer {
  switch (type) {
    case 'text':
      return createTextLayer(overrides as Partial<TextLayer>);
    case 'image':
      return createImageLayer(overrides as Partial<ImageLayer>);
    case 'video':
      return createVideoLayer(overrides as Partial<VideoLayer>);
    case 'code':
      return createCodeLayer(overrides as Partial<CodeLayer>);
    case 'audio':
      return createAudioLayer(overrides as Partial<AudioLayer>);
    case 'background':
      return createBackground(overrides as Partial<BackgroundLayer>);
    default:
      return createTextLayer(overrides as Partial<TextLayer>);
  }
}

/* ------------------------------------------------------------------ project */

export function createEmptyProject(name = '未命名织层项目'): Project {
  const now = Date.now();
  const project: Project = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: uid('prj'),
    name,
    width: 1080,
    height: 1440,
    duration: 4000,
    fps: 30,
    loop: true,
    layers: [createBackground({ width: 1080, height: 1440 })],
    assets: [],
    fonts: [],
    tempo: { ...DEFAULT_TEMPO },
    lyrics: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  return project;
}

const DEMO_CODE = `// 生成式流线：随主时钟推进
ctx.clearRect(0, 0, width, height);
ctx.globalCompositeOperation = 'lighter';

for (let i = 0; i < 7; i++) {
  const t = time * 0.00016 + i * 0.42;
  ctx.beginPath();
  for (let x = -40; x <= width + 40; x += 16) {
    const n = api.noise(x * 0.0016 + t, i * 3.7);
    const y = height * (0.14 + i * 0.115)
      + Math.sin(x * 0.0042 + t * 3.1) * 64
      + (n - 0.5) * 200;
    if (x === -40) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = i % 2 === 0 ? 'rgba(124,92,255,0.50)' : 'rgba(34,211,238,0.38)';
  ctx.lineWidth = i % 3 === 0 ? 2 : 1.2;
  ctx.stroke();
}

// 稀疏星点，避免静态噪点
for (let i = 0; i < 90; i++) {
  const x = api.rand(i * 13.7) * width;
  const y = api.rand(i * 7.3 + 2) * height;
  const a = 0.10 + 0.28 * Math.abs(Math.sin(time * 0.0012 + i));
  ctx.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
  ctx.fillRect(x, y, 1.6, 1.6);
}
`;

/** 开箱演示项目：无外部资源，全部可离线渲染 */
export function createDemoProject(): Project {
  const now = Date.now();
  const W = 1080;
  const H = 1440;
  const bg = createBackground({
    width: W,
    height: H,
    kind: 'gradient',
    gradient: {
      type: 'linear',
      angle: 145,
      stops: [
        { offset: 0, color: '#080a10' },
        { offset: 0.52, color: '#121a2e' },
        { offset: 1, color: '#2a1147' },
      ],
    },
  });

  const flow = createCodeLayer({
    name: '流线 · 代码层',
    x: 0,
    y: 0,
    width: W,
    height: H,
    opacity: 0.9,
    blendMode: 'screen',
    code: defaultCodeSpec({ source: DEMO_CODE, params: { density: 7 } }),
    outPoint: 4000,
  });

  const eyebrow = createTextLayer({
    name: '眉标',
    x: 96,
    y: 150,
    width: 700,
    height: 44,
    text: 'KINELAYER',
    style: {
      ...defaultTextStyle(),
      fontFamily: 'Segoe UI',
      fontSize: 22,
      fontWeight: 600,
      letterSpacing: 7,
      color: '#9db4d6',
      wrap: false,
    },
    animation: {
      ...emptyAnimation(),
      enter: { preset: 'fade', duration: 700, delay: 0, easing: 'ease-out', intensity: 0.6 },
    },
  });

  const title = createTextLayer({
    name: '主标题',
    x: 90,
    y: 380,
    width: 900,
    height: 420,
    text: '可编程的\n动态海报',
    style: {
      ...defaultTextStyle(),
      fontFamily: 'Microsoft YaHei',
      fontSize: 128,
      fontWeight: 700,
      lineHeight: 1.08,
      letterSpacing: -2,
      color: '#ffffff',
      shadow: { color: 'rgba(0,0,0,0.45)', blur: 38, x: 0, y: 18 },
      wrap: false,
    },
    animation: {
      ...emptyAnimation(),
      enter: { preset: 'slide-up', duration: 900, delay: 180, easing: 'ease-out-cubic', intensity: 0.7 },
    },
  });

  const subtitle = createTextLayer({
    name: '副标题',
    x: 96,
    y: 830,
    width: 620,
    height: 130,
    text: '一条命令总线驱动一切\n代码、时间轴与图层窗口同源',
    style: {
      ...defaultTextStyle(),
      fontFamily: 'Microsoft YaHei',
      fontSize: 30,
      fontWeight: 400,
      lineHeight: 1.6,
      letterSpacing: 1,
      color: '#c3cde0',
    },
    animation: {
      ...emptyAnimation(),
      enter: { preset: 'fade', duration: 800, delay: 520, easing: 'ease-out', intensity: 0.8 },
    },
  });

  const badge = createTextLayer({
    name: '角标',
    x: 96,
    y: 1272,
    width: 520,
    height: 40,
    text: '1080 × 1440  ·  30 FPS  ·  WebM / PNG',
    style: {
      ...defaultTextStyle(),
      fontFamily: 'Segoe UI',
      fontSize: 18,
      fontWeight: 500,
      letterSpacing: 2.4,
      color: '#7f8fa8',
      wrap: false,
    },
    animation: {
      ...emptyAnimation(),
      enter: { preset: 'fade', duration: 900, delay: 760, easing: 'ease-out', intensity: 0.5 },
    },
  });

  const accent = createCodeLayer({
    name: '光斑 · 代码层',
    x: 700,
    y: 940,
    width: 300,
    height: 300,
    opacity: 0.85,
    blendMode: 'screen',
    code: defaultCodeSpec({
      engine: 'canvas2d',
      source: `const t = time * 0.001;
ctx.clearRect(0, 0, width, height);
const cx = width / 2 + Math.sin(t * 0.9) * 18;
const cy = height / 2 + Math.cos(t * 1.3) * 14;
const r = Math.min(width, height) * 0.32 + Math.sin(t * 2) * 8;
const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.1);
g.addColorStop(0, 'rgba(160,140,255,0.95)');
g.addColorStop(0.35, 'rgba(96,80,220,0.42)');
g.addColorStop(1, 'rgba(34,211,238,0)');
ctx.fillStyle = g;
ctx.beginPath();
ctx.arc(cx, cy, r * 2.1, 0, Math.PI * 2);
ctx.fill();`,
    }),
    animation: {
      ...emptyAnimation(),
      emphasis: { preset: 'float', duration: 2600, delay: 0, easing: 'ease-in-out', intensity: 0.5 },
    },
  });

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: uid('prj'),
    name: 'Kinelayer · 示例海报',
    width: W,
    height: H,
    duration: 4000,
    fps: 30,
    loop: true,
    layers: [bg, flow, accent, eyebrow, title, subtitle, badge],
    assets: [],
    fonts: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/* --------------------------------------------------------------- normalise */

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : fallback;
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * 读取宽容、写入严格（借自 Doory 的动画模型纪律）：
 * 外来项目文件可能缺字段/多字段/数值越界，这里只做修复，不抛错。
 */
export function normalizeProject(raw: unknown): Project {
  const base = createEmptyProject();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const width = num(r.width, base.width, LIMITS.width.min, LIMITS.width.max);
  const height = num(r.height, base.height, LIMITS.height.min, LIMITS.height.max);
  const rawLayers = Array.isArray(r.layers) ? (r.layers as Layer[]) : [];
  const seen = new Set<string>();
  const layers: Layer[] = [];

  for (const item of rawLayers) {
    if (!item || typeof item !== 'object') continue;
    const type = (item as Layer).type;
    if (!LAYER_TYPES.includes(type)) continue;
    const layer = item as Layer;
    if (seen.has(layer.id)) layer.id = uid('ly');
    seen.add(layer.id);
    layers.push(layer);
  }

  const bg = layers.find((l) => l.type === 'background') as BackgroundLayer | undefined;
  const rest = layers.filter((l) => l.type !== 'background');
  const background = bg
    ? { ...createBackground({ width, height }), ...bg, width, height, x: 0, y: 0, rotation: 0, locked: true, visible: true }
    : createBackground({ width, height });

  const assets = Array.isArray(r.assets) ? (r.assets as AssetMeta[]).filter((a) => a && a.id) : [];
  const fonts = Array.isArray(r.fonts) ? (r.fonts as FontMeta[]).filter((f) => f && f.family) : [];

  // v1 → v2：schemaVersion 缺省视为 1，逐图层把 animation 迁移到当前形状
  for (const layer of layers) {
    layer.animation = normalizeAnimation(layer.animation);
    /* 音频层手里没有 tone 就是一颗静音炸弹（引擎会读到 undefined.preset），就地补默认值 */
    if (layer.type === 'audio') normalizeAudioLayer(layer);
  }
  background.animation = normalizeAnimation(background.animation);

  const duration = num(r.duration, base.duration, LIMITS.duration.min, LIMITS.duration.max);

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: str(r.id, base.id),
    name: str(r.name, base.name),
    width,
    height,
    duration,
    fps: Math.round(num(r.fps, base.fps, LIMITS.fps.min, LIMITS.fps.max)),
    loop: bool(r.loop, true),
    layers: [background, ...rest],
    assets,
    fonts,
    /*
     * v2.11 · 速度网格与歌词是**可选**字段（老工程没有）。
     * 读入时补成缺省值、而不是留 undefined：代码层的 `api.tempo` 与音频引擎
     * 都直接读它，留一个 undefined 会在渲染循环最里层炸，而不是在这里炸。
     */
    tempo: clampTempo(r.tempo as Partial<Tempo> | undefined),
    lyrics: normalizeLyrics(r.lyrics, duration),
    version: Math.max(1, Math.round(num(r.version, 1, 1, Number.MAX_SAFE_INTEGER))),
    createdAt: num(r.createdAt, Date.now(), 0, Number.MAX_SAFE_INTEGER),
    updatedAt: Date.now(),
  };
}

/**
 * 音频层的读宽容。
 * 外来工程可能写了 `volume: 3` 或者干脆没写 tone —— 这里只做修复，不抛错（和 normalizeProject 一致）。
 */
function normalizeAudioLayer(layer: AudioLayer): void {
  layer.volume = clamp(typeof layer.volume === 'number' && Number.isFinite(layer.volume) ? layer.volume : 0.6, 0, 1);
  layer.muted = layer.muted === true;
  layer.fadeIn = clamp(typeof layer.fadeIn === 'number' ? layer.fadeIn : 300, 0, 60_000);
  layer.fadeOut = clamp(typeof layer.fadeOut === 'number' ? layer.fadeOut : 500, 0, 60_000);
  const raw = (layer.tone ?? {}) as Partial<ToneSpec>;
  const preset = raw.preset === 'pulse' || raw.preset === 'chime' ? raw.preset : 'pad';
  layer.tone = {
    preset,
    root: clamp(typeof raw.root === 'number' && raw.root > 0 ? raw.root : 110, 20, 4000),
    bpm: clamp(typeof raw.bpm === 'number' && raw.bpm > 0 ? raw.bpm : 84, 20, 300),
    chord: Array.isArray(raw.chord) && raw.chord.length ? raw.chord.filter((n) => Number.isFinite(n)).slice(0, 8) : [0, 7, 12],
    marks: Array.isArray(raw.marks) ? raw.marks.filter((n) => Number.isFinite(n) && n >= 0).slice(0, 128) : [],
  };
}

/** 序列化：保证不含 base64（资源只在 IndexedDB） */
export function serializeProject(project: Project): string {
  const clean: Project = {
    ...project,
    assets: project.assets.map((a) => ({ ...a })),
    fonts: project.fonts.map((f) => ({ ...f })),
  };
  return JSON.stringify(clean, null, 2);
}

export const BLEND_OPTIONS = BLEND_MODES;
