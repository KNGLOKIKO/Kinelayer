/**
 * MotionLayer · 核心数据模型
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

export interface Project {
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
