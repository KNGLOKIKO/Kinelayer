/**
 * Kinelayer · 核心数据模型
 * 铁律：Project 是唯一权威文档；layers 数组顺序即 z 序；background 永远在 index 0 且不可删除。
 * 序列化时不含任何 base64 资源：二进制只存在 IndexedDB，Project 里只有 AssetMeta。
 */

export type LayerType = 'background' | 'text' | 'image' | 'video' | 'code';

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'lighten'
  | 'darken'
  | 'difference'
  | 'hard-light'
  | 'soft-light';

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'lighten',
  'darken',
  'difference',
  'hard-light',
  'soft-light',
];

export type FitMode = 'cover' | 'contain' | 'fill';

export type CodeEngine = 'canvas2d' | 'glsl' | 'html';

export const CODE_ENGINES: CodeEngine[] = ['canvas2d', 'glsl', 'html'];

export type EasingName =
  | 'linear'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out'
  | 'ease-in-quad'
  | 'ease-out-quad'
  | 'ease-in-cubic'
  | 'ease-out-cubic'
  | 'ease-out-back'
  | 'ease-out-elastic';

export const EASINGS: EasingName[] = [
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'ease-in-quad',
  'ease-out-quad',
  'ease-in-cubic',
  'ease-out-cubic',
  'ease-out-back',
  'ease-out-elastic',
];

export interface GradientStop {
  offset: number; // 0..1
  color: string;
}

export interface GradientSpec {
  type: 'linear' | 'radial';
  angle: number; // 线性渐变角度，deg，0 = 从左到右
  stops: GradientStop[];
}

export interface TextShadow {
  color: string;
  blur: number;
  x: number;
  y: number;
}

export interface TextStroke {
  color: string;
  width: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: 'normal' | 'italic';
  lineHeight: number; // 倍数
  letterSpacing: number; // px
  align: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  color: string;
  useGradient: boolean;
  gradient: GradientSpec;
  stroke: TextStroke | null;
  shadow: TextShadow | null;
  wrap: boolean;
  uppercase: boolean;
}

export type AnimPreset =
  | 'none'
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'pulse'
  | 'float'
  | 'spin';

export const ANIM_PRESETS: AnimPreset[] = [
  'none',
  'fade',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'zoom-in',
  'zoom-out',
  'pulse',
  'float',
  'spin',
];

export interface LayerAnim {
  preset: AnimPreset;
  duration: number; // ms
  delay: number; // ms
  easing: EasingName;
  intensity: number; // 0..1
}

export interface LayerAnimation {
  enter?: LayerAnim;
  exit?: LayerAnim;
  emphasis?: LayerAnim;
  /**
   * v2 · 属性轨道（关键帧）。求值优先级高于上面三个预设槽位：
   * 预设负责「整段入场/退场」，轨道负责「精确定点」，同属性冲突时轨道赢。
   */
  tracks: PropertyTrack[];
  /** v2 · 拖动属性时，若该属性已有轨道就自动打点（Figma / AE 的行为） */
  autoKeyframe: boolean;
}

/* ---------------------------------------------------------------- v2 关键帧 */

/**
 * 可动画属性。
 *
 * 准入标准只有一条：**值必须能由 (keyframes, localTime) 唯一算出**，
 * 且渲染、导出、图层镜像共用同一个 computeLayerFrame 就能拿到同一个数。
 * 任何依赖「上一帧状态」或「UI 状态」的属性都不许进来。
 */
export type AnimatableProperty =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'rotation'
  | 'opacity'
  | 'fontSize'
  | 'letterSpacing';

export const ANIMATABLE_PROPERTIES: AnimatableProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'fontSize',
  'letterSpacing',
];

/** 属性的展示名（中文原文，UI 渲染时走 t()） */
export const PROPERTY_LABELS: Record<AnimatableProperty, string> = {
  x: 'X',
  y: 'Y',
  width: '宽',
  height: '高',
  rotation: '旋转',
  opacity: '不透明度',
  fontSize: '字号',
  letterSpacing: '字距',
};

/** 哪些属性属于文本层专有（其余图层不该出现这些轨道） */
export const TEXT_ONLY_PROPERTIES: AnimatableProperty[] = ['fontSize', 'letterSpacing'];

/**
 * v2 · 缓动规格。
 * `kind` 直接用既有 EasingName，或者 'cubic-bezier' 走 `bezier`（与 CSS 同义），
 * 这样时间轴上的曲线编辑器和 CSS 心智模型对得上，也不用再造一套名字。
 */
export interface EasingSpec {
  kind: EasingName | 'cubic-bezier';
  /** kind === 'cubic-bezier' 时生效，[x1, y1, x2, y2] */
  bezier?: [number, number, number, number];
}

export interface Keyframe {
  id: string;
  /**
   * **相对图层 startTime（= inPoint）的毫秒数**。
   * 绝不存绝对时间：图层整体挪位时关键帧必须跟着走，存绝对时间会全部错位。
   */
  time: number;
  value: number;
  /** 从本关键帧到**下一个**关键帧之间使用的缓动 */
  easing: EasingSpec;
}

export interface PropertyTrack {
  property: AnimatableProperty;
  keyframes: Keyframe[];
}


/** 属性表达式绑定：值为 JS 表达式字符串，按帧求值（沙箱内，只读上下文） */
export type BindingTarget = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'opacity' | 'scale';
export const BINDING_TARGETS: BindingTarget[] = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'scale',
];

export type Bindings = Partial<Record<BindingTarget, string>>;

export interface BaseLayer {
  id: string;
  type: LayerType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // deg
  opacity: number; // 0..1
  visible: boolean;
  locked: boolean;
  blendMode: BlendMode;
  animation: LayerAnimation;
  inPoint: number; // ms，图层出现时间
  outPoint: number; // ms，图层消失时间（= duration 表示直到结尾）
  bindings: Bindings;
  meta: Record<string, string>;
}

export interface BackgroundLayer extends BaseLayer {
  type: 'background';
  kind: 'solid' | 'gradient' | 'image' | 'code';
  color: string;
  gradient: GradientSpec;
  assetId: string | null;
  fit: FitMode;
  code: CodeSpec;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  style: TextStyle;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  assetId: string | null;
  fit: FitMode;
  radius: number;
  brightness: number; // 1 = 原样
  contrast: number;
  saturate: number;
  grayscale: number; // 0..1
  blur: number; // px
}

export interface VideoLayer extends BaseLayer {
  type: 'video';
  assetId: string | null;
  fit: FitMode;
  radius: number;
  muted: boolean;
  loop: boolean;
  playbackRate: number;
}

export interface CodeSpec {
  engine: CodeEngine;
  source: string;
  params: Record<string, string | number | boolean>;
}

export interface CodeLayer extends BaseLayer {
  type: 'code';
  code: CodeSpec;
}

export type Layer = BackgroundLayer | TextLayer | ImageLayer | VideoLayer | CodeLayer;

export interface AssetMeta {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'font';
  mime: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: number;
}

export interface FontMeta {
  family: string;
  source: 'system' | 'local' | 'upload';
  weight: number;
  style: 'normal' | 'italic';
  assetId?: string;
  createdAt: number;
}

/**
 * 工程文件格式版本。
 * v1 → v2：动画从「三个预设槽位」升级为「预设槽位 + 属性轨道」。
 * 读入时必须按 schemaVersion 迁移，写出一律写当前版本（写严格、读宽容）。
 */
export const PROJECT_SCHEMA_VERSION = 2;

export interface Project {
  /** 缺省视为 1（v1 的工程文件没有这个字段） */
  schemaVersion: number;
  id: string;
  name: string;
  width: number;
  height: number;
  duration: number; // ms
  fps: number;
  loop: boolean;
  /** layers[0] 恒为 BackgroundLayer */
  layers: Layer[];
  assets: AssetMeta[];
  fonts: FontMeta[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

/* ---------------------------------------------------------------- ui / runtime */

export type LeftTab = 'layers' | 'assets' | 'fonts' | 'commands';
export type RightTab = 'inspect' | 'ai' | 'audit';
export type WindowMode = 'popup' | 'pip' | 'panel';

export interface UiState {
  selectedIds: string[];
  activeLayerId: string | null;
  zoom: number;
  panX: number;
  panY: number;
  leftTab: LeftTab;
  rightTab: RightTab;
  showTimeline: boolean;
  /** v2 · 时间轴里展开的图层（值为图层 id） */
  expandedTracks: string[];
  /** v2 · 选中的关键帧 id（可跨图层多选） */
  selectedKeyframes: string[];
  /** v2 · 时间轴水平缩放，1 = 铺满可视宽度 */
  timelineZoom: number;
  showSettings: boolean;
  showExport: boolean;
  /** AI 接入提示词面板 */
  showPrompt: boolean;
  /** 界面语言（只影响 UI 文案，不改项目数据） */
  locale: 'zh-CN' | 'en-US';
  codeEditorFor: string | null;
  windowMode: WindowMode;
  floatingWindows: string[];
  snapping: boolean;
  showSafeArea: boolean;
  inspectorSection: Record<string, boolean>;
}

export interface ExportProgress {
  active: boolean;
  label: string;
  progress: number;
}

export interface BridgeStatus {
  state: 'off' | 'connecting' | 'connected' | 'error';
  message: string;
  agents: number;
}

export interface ToastItem {
  id: string;
  kind: 'info' | 'success' | 'error' | 'warn';
  text: string;
  ttl: number;
}

export interface RuntimeState {
  playhead: number;
  playing: boolean;
  measuredFps: number;
  exportProgress: ExportProgress;
  bridge: BridgeStatus;
  aiBusy: boolean;
  toasts: ToastItem[];
  captureRequestId: string | null;
}

/* ---------------------------------------------------------------- invariants */

export const LIMITS = {
  width: { min: 16, max: 8192 },
  height: { min: 16, max: 8192 },
  duration: { min: 100, max: 600_000 },
  fps: { min: 1, max: 60 },
  zoom: { min: 0.02, max: 16 },
} as const;

export function isBackground(layer: Layer): layer is BackgroundLayer {
  return layer.type === 'background';
}
export function isText(layer: Layer): layer is TextLayer {
  return layer.type === 'text';
}
export function isImage(layer: Layer): layer is ImageLayer {
  return layer.type === 'image';
}
export function isVideo(layer: Layer): layer is VideoLayer {
  return layer.type === 'video';
}
export function isCode(layer: Layer): layer is CodeLayer {
  return layer.type === 'code';
}

/** 背景层不可删除 / 不可移动 z 序 / 不可隐藏以外的一切——此处只做结构性保证 */
export function getBackground(project: Project): BackgroundLayer {
  const first = project.layers[0];
  if (first && first.type === 'background') return first;
  // 理论不可达：normalizeProject 会修复
  throw new Error('project invariant broken: layers[0] must be background');
}
