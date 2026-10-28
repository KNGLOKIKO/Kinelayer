/**
 * Kinelayer · 核心数据模型
 * 铁律：Project 是唯一权威文档；layers 数组顺序即 z 序；background 永远在 index 0 且不可删除。
 * 序列化时不含任何 base64 资源：二进制只存在 IndexedDB，Project 里只有 AssetMeta。
 */

export type LayerType = 'background' | 'text' | 'image' | 'video' | 'code' | 'audio';

/** 全部图层类型。normalizeProject 的白名单直接用它，避免「加了类型忘了加白名单」 */
export const LAYER_TYPES: LayerType[] = ['background', 'text', 'image', 'video', 'code', 'audio'];

/**
 * 用户能新建的类型（背景层永远在 index 0，不参与新建）。
 * 命令层的 z.enum 与左栏按钮都读这一份，省得两边打架。
 */
export const CREATABLE_LAYER_TYPES: LayerType[] = ['text', 'image', 'video', 'code', 'audio'];

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

/**
 * 片段入点转场。
 *
 * 语义刻意做成**只看自己**：`duration` 是「从本片段入点起，与上一段交叉多久」，
 * 不需要用户先选中两段再点「应用转场」——那一步是专业 NLE 的门槛之一。
 * 渲染时上一段会自动淡出（`transitionOutAlpha`），所以两段的重叠关系是算出来的，
 * 不是靠用户把片段拖到一起对出来的。
 */
export type TransitionKind = 'crossfade' | 'dip' | 'slide' | 'wipe';

export const TRANSITION_KINDS: TransitionKind[] = ['crossfade', 'dip', 'slide', 'wipe'];

export interface ClipTransition {
  kind: TransitionKind;
  /** 毫秒；会被夹到片段长度的一半以内 */
  duration: number;
}

export type CodeEngine = 'canvas2d' | 'glsl' | 'html' | 'remotion-component';

export const CODE_ENGINES: CodeEngine[] = ['canvas2d', 'glsl', 'html', 'remotion-component'];

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

/** 源工程的原始形态，决定「这一层还能不能继续降级」 */
export type LayerOriginFormat = 'remotion' | 'html' | 'manim' | 'gsap' | 'raw' | 'scene-json' | 'ai-scene';

/**
 * 来源溯源。不参与渲染，只服务三件事：审计日志、图层树徽标、导入降级决策的记录。
 * 手搓的图层没有这个字段（缺省 = 用户自己做的），省得给每一层都写一遍。
 */
export interface LayerOrigin {
  generator: 'ai' | 'user' | 'import';
  sourceFormat?: LayerOriginFormat;
  /** 原始工程包的标识/文件名，方便回查「这层从哪来的」 */
  sourceBundle?: string;
  importedAt?: number;
  /**
   * 解析这条来源时用到的解析器版本（`html-dom/1`、`remotion-ast/1`）。
   * 解析规则会变，留着它才能分辨「这层是旧规则猜的」还是「新规则也没救」。
   */
  parser?: string;
  /**
   * 导入时发现的远程依赖（GSAP CDN、远程字体/图片）。
   * 编辑态能加载，但导出走 foreignObject 栅格化、离线打开也拿不到 —— 必须提前说。
   */
  external?: string[];
  /**
   * 这一层在原工程里指向的地址（`<img src="...">`、`staticFile('assets/a.png')` 的原文）。
   *
   * **只在那个引用没被落地成资源时才写** —— 它的用途是在导入对话框关掉之后
   * 还能回答「我原本要的那张图在哪」，而不是给每层都留一份资源路径。
   * 截图里的地址可能已经失效，所以界面上按线索展示，不按事实展示。
   */
  sourceRef?: string;
}

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
  origin?: LayerOrigin;
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
  /** 入点转场（图片也能有，做「图片幻灯」时不至于全是硬切） */
  transition: ClipTransition | null;
}

export interface VideoLayer extends BaseLayer {
  type: 'video';
  assetId: string | null;
  fit: FitMode;
  radius: number;
  muted: boolean;
  loop: boolean;
  playbackRate: number;
  /**
   * 源内偏移（毫秒）：这一段的第 0 毫秒对应素材的第 `trimIn` 毫秒。
   * 裁剪左边缘只动这个值，不动 inPoint —— 用户看到的就是「素材还回去了」。
   */
  trimIn: number;
  /** 入点转场 */
  transition: ClipTransition | null;
}

export interface CodeSpec {
  engine: CodeEngine;
  source: string;
  params: Record<string, string | number | boolean>;
  /**
   * 代码层的内部分辨率倍率（0.25–1，省略即 1）。
   *
   * 为什么要有这个字段：canvas2d 的逐形状绘制和 GLSL 的逐像素着色，成本都随**像素数**
   * 线性涨。一整幅 1920×1080、每像素要算二十次噪声的 shader，在软件光栅化下每帧 150ms ——
   * 这时降内部分辨率不是偷工减料，而是唯一能让它跑满 30fps 的杠杆（像素数按平方下降）。
   *
   * 该降的：低频的、成片的、后面还要被压暗或被字压住的画面（噪声场、雾、辉光）。
   * 不该降的：文字、细线、读数 —— 放大后会糊，那是真的画质损失。
   * 合成阶段是 `drawImage` 双线性放大，所以 0.5 不等于「一半的画质」。
   */
  renderScale?: number;
  /**
   * 子帧超采样（运动模糊）。省略即关。
   *
   * 一帧内取 `samples` 个时刻（从 `time` 往回铺 `shutter` 毫秒）各画一次，
   * 再按 1/n 叠起来 —— 这是把「快门」这件摄影上的事搬进渲染器，
   * 也是甩镜、抖机位、频闪这类画面唯一靠谱的做法（单帧里画多条残影是假模糊，
   * 它不会随速度变化，也不算在正确的时刻上）。
   *
   * 代价是线性涨：`samples: 4` 就是四倍绘制。所以它只该出现在
   * 「便宜但高速」的层上，贵的逐像素层请先降 `renderScale` 再谈模糊。
   */
  /**
   * 子帧运动模糊。samples 给数字 = 固定次数；给 'auto' = 自适应
   * （从 4 起步逐级加密到 32，每级按收敛情况决定还要不要继续）。
   *
   * shutter 是**本图层本地时间的毫秒数**（往回铺多久），不是帧时比例 ——
   * 比例只有在知道 fps 时才有意义，而图层不知道自己在什么帧率上播。
   * CLI 的 `--shutter 0.2`（原项目口径）会被换算成毫秒再进来，见 scripts/render.mjs。
   *
   * tol 是收敛阈值，单位是 0..255 的色阶，默认 3 —— 再细的差别肉眼也看不出来。
   *
   * 没有「按瓦片各自收敛」这个开关：原项目靠 scissor 让收敛的瓦片不再跑着色器，
   * canvas2d 没有等价物，一次子帧必须整帧重画，所以瓦片级计数在本工程里
   * 不可能省下任何一次绘制。能省的只有「还要不要再加密一级」，那是一个
   * 全帧统一的是/否 —— 见 codeEngine 里 maxTileDelta 的注释。
   */
  motionBlur?: { samples: number | 'auto'; shutter: number; tol?: number };
  /**
   * `remotion-component` 的运行时元信息。别的引擎没有这一段。
   *
   * 它不是「在浏览器里跑 Remotion」—— 浏览器执行不了 TSX，也没有逐帧截图能力。
   * 这段只记录「这一层原本是一个 Remotion 组件」，于是它有一个诚实的落脚点：
   * 静态首帧占位（或用户自己渲染的代理视频）作预览，源码原样进工程包与 remotion-kit。
   */
  runtime?: RemotionRuntime;
}

export interface RemotionRuntime {
  kind: 'remotion-component';
  /** AI 生成的 Remotion 组件源码（TSX），原样保存，不在浏览器里执行 */
  entryCode: string;
  compositionId: string;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  /** static-first-frame：只画占位卡；proxy-video：画代理视频（仅编辑期参考，不参与导出） */
  previewMode: 'static-first-frame' | 'proxy-video';
  /** 代理视频的资源 id（as_xxx）。走资源池，和普通视频层同一套解码/缓存 */
  proxyAssetId?: string;
  /** 这一层为什么没被解析成结构化图层（给用户看的原始原因，展示时再翻译） */
  reason?: string;
  /**
   * 原工程源码树（按 zip 内相对路径）。
   *
   * 只挂在**第一个** remotion 层上，避免每个组件都存一份。
   * 用途单一：导出 remotion-kit 时原样落盘，让外部 `npx remotion render` 真能跑起来 ——
   * 只存被解析出来的那一个组件源码是不够的，原工程里的相对 import 会全部断掉。
   * 超过体积上限就不存（宁可不导出整树，也不让 project.json 变成几 MB）。
   */
  sources?: { path: string; code: string }[];
}

export interface CodeLayer extends BaseLayer {
  type: 'code';
  code: CodeSpec;
}

/* -------------------------------------------------------------------- 音频 */

/**
 * 程序化音源预设。
 *
 * 为什么不是「上传一个音频文件」：示例工程要求零外部资源（见 core/sampleProject.ts），
 * 而工程包（.kly）里存二进制要额外的体积与解密成本。合成音源是**算出来的**：
 * 同一份工程在任何机器上听到的完全一样，工程包也还是几十 KB。
 * 真要用自己的音乐，走 `asset` 那条路是后续的事，这里先把「时间轴上能听见声音、
 * 导出时声音跟着走」这条链路打通。
 */
export type TonePreset = 'pad' | 'pulse' | 'chime';

export const TONE_PRESETS: TonePreset[] = ['pad', 'pulse', 'chime'];

export interface ToneSpec {
  preset: TonePreset;
  /** 基频（Hz）。pad 是根音，pulse 是鼓的参考音高，chime 是音阶起点 */
  root: number;
  /** 每分钟拍数。pad 不用它（pad 是连续的），pulse/chime 用它算网格 */
  bpm: number;
  /** 和弦音程（半音偏移）。pad 叠几个音，chime 用它做琶音 */
  chord: number[];
  /** chime 的触发点：**相对图层起点**的毫秒数，用来标章节切换 */
  marks: number[];
}

export interface AudioLayer extends BaseLayer {
  type: 'audio';
  /**
   * 导入的音频文件（AssetMeta.kind === 'audio'）。
   * 为 null 时退回程序化音源（`tone`）—— 示例工程全靠它，零外部资源。
   */
  assetId: string | null;
  /** 源内偏移（毫秒），与视频层同义 */
  trimIn: number;
  /** 0..1，和图层 opacity 分开：opacity 对音频没有意义，混在一起会让人以为能淡出画面 */
  volume: number;
  muted: boolean;
  /** 淡入/淡出，毫秒。超过图层长度时按比例压回去，不会算出负值 */
  fadeIn: number;
  fadeOut: number;
  tone: ToneSpec;
}

export type Layer = BackgroundLayer | TextLayer | ImageLayer | VideoLayer | CodeLayer | AudioLayer;

export interface AssetMeta {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio' | 'font';
  mime: string;
  size: number;
  width?: number;
  height?: number;
  /** 视频/音频时长（毫秒）。音频导入后要据此决定片段长度 */
  duration?: number;
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

/**
 * 速度网格：这支片子「第几拍在第几毫秒」的唯一真理。
 *
 * 为什么它是工程级而不是音频层级的：切镜、盖章、复制、抖机位这些事发生在**画面**上，
 * 而它们必须落在**声音**的拍子上。两边各自算一遍 bpm，改速度时一定有一边忘掉。
 * 音频层自己的 `tone.bpm` 保留 —— 那是「这一条音轨的律动」，
 * 它可以故意跟工程速度错开（半速铺底、三连音脉冲），这正是音乐上的常规手法。
 */
export interface Tempo {
  /** 每分钟拍数 */
  bpm: number;
  /** 第 0 拍落在第几毫秒（相对工程起点）。负数表示片子从半拍处切进来 */
  offsetMs: number;
  /** 每小节几拍。只用来定强拍（下拍）位置，不限制你能数到几 */
  meter: number;
}

/**
 * 一行歌词。
 *
 * 与 pdoom-video 那类「先唱、再强制对齐」的项目不同，这里的词级时间**不来自音频分析**
 * —— 本工程的音轨是现场合成的，没有可供对齐的人声。所以时间由这里给的行区间
 * 按字符权重分配（见 `core/score.ts`），并且**绝不让高亮跑到声音前面**：
 * 一个字的高亮区间就是它自己的发声区间，这是唯一能保证「看起来在唱」的定义。
 *
 * `start`/`end` 是**绝对毫秒**（相对工程起点）。允许重叠（和声、叠句），
 * 也允许中间有空白（换气、纯音乐段）。
 */
export interface LyricLine {
  /** 显示文本。分词规则与文字层一致：拉丁按词、CJK 按字（见 render/text.ts 的 tokenize） */
  text: string;
  start: number;
  end: number;
}

/** 逐字时间表里的一项：一个可高亮的单元（拉丁词 / 一个汉字 / 一串标点） */
export interface LyricUnit {
  text: string;
  start: number;
  end: number;
  /** 在整行里的字符偏移，用来算「已唱多少字」 */
  offset: number;
}

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
  /** 速度网格。缺省是 120 BPM、第 0 拍在 0ms、4/4（读入时由 normalizeProject 补齐） */
  tempo?: Tempo;
  /** 词级时间（可为空）。缺省 = 这支片子没有歌词，代码层的 api.lyrics 会返回空结构 */
  lyrics?: LyricLine[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

/* ---------------------------------------------------------------- ui / runtime */

export type LeftTab = 'layers' | 'assets' | 'fonts' | 'commands' | 'custom';
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
  /** 设置对话框当前分页。放在 store 里，切语言整树重建后不会跳回第一页 */
  settingsTab: 'ai' | 'bridge' | 'agent' | 'data';
  /** 启动页（工程库）。放 store 同样是为了切语言不丢 */
  showLauncher: boolean;
  /** 窄屏档：左右面板改成抽屉，同一时刻只开一个 */
  narrowDrawer: 'left' | 'right' | null;
  showExport: boolean;
  /** AI 接入提示词面板 */
  showPrompt: boolean;
  /** 界面语言（只影响 UI 文案，不改项目数据） */
  locale: 'zh-CN' | 'en-US';
  codeEditorFor: string | null;
  /**
   * 自定义命令编辑器：null = 关着，'new' = 新建，其它 = 编辑这条的 id。
   * 和 codeEditorFor 一样放在 store 里 —— 切语言整树重建时对话框不该自己关掉。
   */
  customEditorFor: string | 'new' | null;
  /** 参数对话框挂在哪条自定义命令上（null = 关着）。没有参数的命令不进这个对话框，直接跑 */
  customRunFor: string | null;
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
  /**
   * 自定义命令的内存缓存。
   *
   * 真身在 IndexedDB（跟工程无关：在 A 工程写的一条宏，B 工程也该能用），
   * 这里只放一份读出来的副本给界面用。`loaded` 用来区分「还没读」和「读完了是空的」——
   * 不然面板会在第一帧闪一下「一条都没有」。
   */
  customCommands: CustomCommand[];
  customCommandsLoaded: boolean;
}

/* --------------------------------------------------------- custom commands */

/** 自定义命令的参数类型：决定界面用什么控件、运行时怎么取值 */
export type CustomParamType = 'number' | 'string' | 'boolean' | 'color' | 'layerId';

export interface CustomCommandParam {
  /** 占位符里用的名字：payload 里写 `"{{key}}"`，必须匹配 /^[a-zA-Z_][a-zA-Z0-9_]*$/ */
  key: string;
  /** 给用户看的名字（缺省用 key） */
  label?: string;
  type: CustomParamType;
  default?: string | number | boolean;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}

/** 一步 = 一条注册表命令。payload 里可以用 `{{param}}` 占位 */
export interface CustomCommandStep {
  id: string;
  /** 注册表里的命令类型，例如 layer.update */
  type: string;
  payload: Record<string, unknown>;
  /** 这步在干什么（给人和 AI 读，执行时也用它做进度提示） */
  note?: string;
}

export interface CustomCommand {
  id: string;
  name: string;
  description: string;
  params: CustomCommandParam[];
  steps: CustomCommandStep[];
  /** 谁写的：界面里标出来，避免「这条是 AI 塞给我的」说不清 */
  author: 'user' | 'ai';
  createdAt: number;
  updatedAt: number;
  /** 跑过几次 —— 列表按「常用」排序的依据 */
  runCount: number;
  lastRunAt?: number;
  /** 最近一次失败的说明（成功时清空），列表上显示红点 */
  lastError?: string;
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
export function isAudio(layer: Layer): layer is AudioLayer {
  return layer.type === 'audio';
}

/** 背景层不可删除 / 不可移动 z 序 / 不可隐藏以外的一切——此处只做结构性保证 */
export function getBackground(project: Project): BackgroundLayer {
  const first = project.layers[0];
  if (first && first.type === 'background') return first;
  // 理论不可达：normalizeProject 会修复
  throw new Error('project invariant broken: layers[0] must be background');
}
