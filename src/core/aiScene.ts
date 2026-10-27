/**
 * `scene.ai.json`：给 Agent 读的「工程语义层」。
 *
 * 为什么不直接让 Agent 读 project.json：
 *   1. project.json 里轨道用毫秒、属性名是内部枚举，Agent 每改一处都要自己换算；
 *   2. 代码层的 source 动辄几千字，混在结构里会把上下文预算吃光；
 *   3. 工程里的 assets/fonts 是「库表」，Agent 关心的是「这一层用了哪张图」。
 *
 * 所以这里是**扁平化 + 语义化**的一份视图：时间统一秒、每层只留渲染相关的属性、
 * 代码层给一句 `codeSummary` 概括「这层画什么」，真要改代码再读 `code`。
 *
 * 它和 project.json 是同一份数据的两种投影，不是新状态：导出方向永远是 project → scene，
 * 没有反向同步（反向走 ai.importProject 的映射器）。
 */

import type { AssetMeta, CodeSpec, EasingSpec, Layer, Project, PropertyTrack } from './types';
import { PROJECT_SCHEMA_VERSION } from './types';

export const AI_SCENE_FORMAT = 'kinelayer-ai-scene';
export const AI_SCENE_VERSION = 1;

export interface AiSceneKeyframe {
  /** 秒，相对图层 inPoint */
  time: number;
  value: number;
  easing: string;
}

export interface AiSceneTrack {
  property: string;
  keyframes: AiSceneKeyframe[];
}

interface AiSceneLayerCommon {
  id: string;
  type: Layer['type'];
  name: string;
  /** 秒，绝对时间 */
  inPoint: number;
  outPoint: number;
  box: { x: number; y: number; width: number; height: number };
  rotation: number;
  opacity: number;
  visible: boolean;
  blendMode: string;
  tracks?: AiSceneTrack[];
  /**
   * 溯源。给 Agent 的意义不是「讲故事」，而是让它能判断这层值不值得改：
   * 旧解析器拆出来的层可能比新规则少东西，缺资源的层它得知道原来指向哪儿。
   */
  origin?: {
    generator: string;
    sourceFormat?: string;
    sourceBundle?: string;
    importedAt?: number;
    parser?: string;
    external?: string[];
    sourceRef?: string;
  };
}

export interface AiSceneTextLayer extends AiSceneLayerCommon {
  type: 'text';
  text: string;
  style: Record<string, string | number | boolean>;
}

export interface AiSceneMediaLayer extends AiSceneLayerCommon {
  type: 'image' | 'video';
  asset: { id: string | null; name: string; mime?: string } | null;
  fit: string;
}

export interface AiSceneCodeLayer extends AiSceneLayerCommon {
  type: 'code';
  engine: string;
  /** 一句话说明这层画什么（启发式，不承诺语义准确） */
  codeSummary: string;
  codeLines: number;
  codeBytes: number;
  params: Record<string, string | number | boolean>;
  /** 完整源码：Agent 真要改代码时才读这个字段 */
  code: string;
  /**
   * `engine === 'remotion-component'` 才有。
   * 刻意不导出 `sources`（原工程源码树）：它可能几百 KB，而 scene.ai.json 是给 Agent 读的，
   * 需要的只是「这层是什么组件、多大、多长、能不能内部编辑」。
   */
  remotion?: {
    compositionId: string;
    durationInFrames: number;
    fps: number;
    width: number;
    height: number;
    previewMode: string;
    sourceFiles: number;
    note: string;
  };
}

export interface AiSceneBackgroundLayer extends AiSceneLayerCommon {
  type: 'background';
  paint: { kind: string; color: string; gradient?: unknown; assetId: string | null };
}

export interface AiSceneAudioLayer extends AiSceneLayerCommon {
  type: 'audio';
  /** 程序化音源：没有资源文件，只有参数 */
  tone: { preset: string; root: number; bpm: number; chord: number[]; marks: number };
  volume: number;
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
}

export type AiSceneLayer = AiSceneTextLayer | AiSceneMediaLayer | AiSceneCodeLayer | AiSceneAudioLayer | AiSceneBackgroundLayer;

export interface AiScene {
  format: typeof AI_SCENE_FORMAT;
  schemaVersion: typeof AI_SCENE_VERSION;
  app: string;
  exportedAt: number;
  project: { id: string; name: string; version: number; projectSchemaVersion: number };
  canvas: { width: number; height: number };
  /** 秒 */
  duration: number;
  fps: number;
  loop: boolean;
  layers: AiSceneLayer[];
  capabilities: {
    availableEngines: string[];
    animationCommands: string[];
    /** 让 Agent 先知道「哪些事这里做不到」，省得它编命令 */
    limitations: string[];
  };
}

const LIMITATIONS = [
  'no-audio-track',
  'no-3d-layers',
  'remotion-not-rendered-in-browser',
  'manim-not-parsed',
  'code-layer-internals-not-keyframable',
];

/** 代码层能被打点的只有变换属性——写进能力声明，Agent 才不会去试 opacity 之外的东西 */
const ANIMATION_COMMANDS = [
  'animation.setKeyframe',
  'animation.removeKeyframe',
  'animation.moveKeyframes',
  'animation.setEasing',
  'animation.setKeyframeValue',
  'animation.clearTrack',
  'animation.setAutoKeyframe',
  'animation.applyPreset',
];

const ms2s = (ms: number): number => Math.round((ms / 1000) * 1000) / 1000;

/* --------------------------------------------------------- 代码层摘要 */

const API_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bfillRect\s*\(/g, label: 'fillRect' },
  { re: /\barc\s*\(/g, label: 'arc' },
  { re: /\blineTo\s*\(/g, label: 'lineTo' },
  { re: /\bbezierCurveTo\s*\(/g, label: 'bezier' },
  { re: /\bdrawImage\s*\(/g, label: 'drawImage' },
  { re: /\bfillText\s*\(/g, label: 'fillText' },
  { re: /\bcreateLinearGradient\s*\(/g, label: 'linearGradient' },
  { re: /\bgl_FragColor\b|\bfragColor\b/g, label: 'glsl' },
  { re: /\bhsl\s*\(|\bhsl\(/gi, label: 'hsl' },
  { re: /\bnoise\s*\(/g, label: 'noise' },
  { re: /\bMath\.sin\b|\bMath\.cos\b/g, label: 'sin/cos' },
  { re: /\bparams\./g, label: 'params' },
  { re: /\bapi\.time\b|\btime\b/g, label: 'time' },
];

/**
 * 一句话概括代码层。
 *
 * 刻意只做**可核对的事实**（引擎、行数、调用了哪些绘图 API、是否随时间变化），
 * 不做「这是粒子系统」这种语义猜测——猜错了比不写更害人，Agent 会当真。
 */
export function describeCode(spec: CodeSpec): string {
  const src = spec.source ?? '';
  const lines = src ? src.split('\n').length : 0;

  /*
   * remotion-component 不是 canvas 代码：拿 canvas API 模式去扫 TSX 只会得到假摘要
   * （比如把 JSX 里的 params 当成绘图调用）。这里只报能核对的事实。
   */
  if (spec.engine === 'remotion-component') {
    const rt = spec.runtime;
    const bits = ['remotion-component', `lines=${lines}`];
    if (rt?.compositionId) bits.push(`composition=${rt.compositionId}`);
    if (rt) bits.push(`${rt.width}×${rt.height}@${rt.fps}`);
    if (rt) bits.push(`preview=${rt.previewMode}`);
    if (rt?.sources?.length) bits.push(`sources=${rt.sources.length}`);
    bits.push('render=external');
    return bits.join(' · ');
  }

  const hits: string[] = [];
  let shapes = 0;
  for (const { re, label } of API_PATTERNS) {
    re.lastIndex = 0;
    const count = (src.match(re) ?? []).length;
    if (count > 0) {
      hits.push(label === 'time' || label === 'params' ? label : `${label}×${count}`);
      if (label === 'arc' || label === 'fillRect' || label === 'lineTo') shapes += count;
    }
  }
  const params = Object.keys(spec.params ?? {});
  /*
   * 输出用 `key=value` 而不是「5 行 · 用到 fillRect」这种中文短句，两个原因：
   *   1. 这份字符串会进 scene.ai.json，也会进导入降级报告 —— 后者要在英文界面里显示，
   *      中文短句会原样漏到界面上（i18n 词典翻不了运行时拼出来的句子）；
   *   2. Agent 读 `lines=5 calls=fillRect×1` 比读短句更不容易理解错。
   */
  const bits = [spec.engine, `lines=${lines}`];
  if (shapes > 0) bits.push(`draws=${shapes}`);
  if (hits.length) bits.push(`calls=${hits.slice(0, 5).join(',')}`);
  if (params.length) bits.push(`params=${params.slice(0, 4).join('/')}`);
  return bits.join(' · ');
}

/* --------------------------------------------------------- 投影 */

/** 缓动投影成一行的字符串，Agent 写回来时不用嵌套对象 */
function easingText(e: EasingSpec | undefined): string {
  if (!e) return 'linear';
  if (e.kind === 'cubic-bezier' && e.bezier?.length === 4) return `cubic-bezier(${e.bezier.join(', ')})`;
  return e.kind;
}

function tracksOf(tracks: PropertyTrack[]): AiSceneTrack[] {
  const out: AiSceneTrack[] = [];
  for (const track of tracks) {
    if (!track.keyframes.length) continue;
    out.push({
      property: track.property,
      keyframes: track.keyframes.map((k) => ({ time: ms2s(k.time), value: k.value, easing: easingText(k.easing) })),
    });
  }
  return out;
}

function commonOf(layer: Layer, tracks: PropertyTrack[]): AiSceneLayerCommon {
  const common: AiSceneLayerCommon = {
    id: layer.id,
    type: layer.type,
    name: layer.name,
    inPoint: ms2s(layer.inPoint),
    outPoint: ms2s(layer.outPoint),
    box: { x: layer.x, y: layer.y, width: layer.width, height: layer.height },
    rotation: layer.rotation,
    opacity: layer.opacity,
    visible: layer.visible,
    blendMode: layer.blendMode,
  };
  const t = tracksOf(tracks);
  if (t.length) common.tracks = t;
  if (layer.origin) {
    common.origin = {
      generator: layer.origin.generator,
      ...(layer.origin.sourceFormat ? { sourceFormat: layer.origin.sourceFormat } : {}),
      ...(layer.origin.sourceBundle ? { sourceBundle: layer.origin.sourceBundle } : {}),
      ...(layer.origin.importedAt ? { importedAt: layer.origin.importedAt } : {}),
      ...(layer.origin.parser ? { parser: layer.origin.parser } : {}),
      ...(layer.origin.external?.length ? { external: layer.origin.external } : {}),
      ...(layer.origin.sourceRef ? { sourceRef: layer.origin.sourceRef } : {}),
    };
  }
  return common;
}

function assetOf(assets: AssetMeta[], id: string | null): { id: string | null; name: string; mime?: string } | null {
  if (!id) return null;
  const meta = assets.find((a) => a.id === id);
  return meta ? { id, name: meta.name, mime: meta.mime } : { id, name: '(资源缺失)' };
}

export function buildAiScene(project: Project): AiScene {
  const layers: AiSceneLayer[] = [];
  for (const layer of project.layers) {
    const common = commonOf(layer, layer.animation?.tracks ?? []);
    switch (layer.type) {
      case 'background':
        layers.push({
          ...common,
          type: 'background',
          paint: { kind: layer.kind, color: layer.color, gradient: layer.gradient, assetId: layer.assetId },
        });
        break;
      case 'text':
        layers.push({
          ...common,
          type: 'text',
          text: layer.text,
          style: {
            fontFamily: layer.style.fontFamily,
            fontSize: layer.style.fontSize,
            fontWeight: layer.style.fontWeight,
            color: layer.style.color,
            align: layer.style.align,
            lineHeight: layer.style.lineHeight,
            letterSpacing: layer.style.letterSpacing,
            wrap: layer.style.wrap,
            uppercase: layer.style.uppercase,
            useGradient: layer.style.useGradient,
          },
        });
        break;
      case 'image':
      case 'video':
        layers.push({
          ...common,
          type: layer.type,
          asset: assetOf(project.assets, layer.assetId),
          fit: layer.fit,
        });
        break;
      case 'audio':
        /*
         * 音频层的 box 是 0×0（它不占画面），AI 拿到 common 里的尺寸会当成「空图层」。
         * 这里显式给出 tone 与音量，让它知道这层其实在响。
         */
        layers.push({
          ...common,
          type: 'audio',
          tone: {
            preset: layer.tone.preset,
            root: layer.tone.root,
            bpm: layer.tone.bpm,
            chord: layer.tone.chord,
            marks: layer.tone.marks.length,
          },
          volume: layer.volume,
          muted: layer.muted,
          fadeIn: layer.fadeIn,
          fadeOut: layer.fadeOut,
        });
        break;
      case 'code':
        layers.push({
          ...common,
          type: 'code',
          engine: layer.code.engine,
          codeSummary: describeCode(layer.code),
          codeLines: (layer.code.source ?? '').split('\n').length,
          codeBytes: (layer.code.source ?? '').length,
          params: layer.code.params,
          code: layer.code.source,
          ...(layer.code.runtime
            ? {
                remotion: {
                  compositionId: layer.code.runtime.compositionId,
                  durationInFrames: layer.code.runtime.durationInFrames,
                  fps: layer.code.runtime.fps,
                  width: layer.code.runtime.width,
                  height: layer.code.runtime.height,
                  previewMode: layer.code.runtime.previewMode,
                  sourceFiles: layer.code.runtime.sources?.length ?? 0,
                  note: 'internal-keyframes-not-editable · render-outside-remotion',
                },
              }
            : {}),
        });
        break;
      default:
        break;
    }
  }

  return {
    format: AI_SCENE_FORMAT,
    schemaVersion: AI_SCENE_VERSION,
    app: typeof __APP_VERSION__ === 'string' ? `Kinelayer ${__APP_VERSION__}` : 'Kinelayer',
    exportedAt: Date.now(),
    project: {
      id: project.id,
      name: project.name,
      version: project.version,
      projectSchemaVersion: project.schemaVersion ?? PROJECT_SCHEMA_VERSION,
    },
    canvas: { width: project.width, height: project.height },
    duration: ms2s(project.duration),
    fps: project.fps,
    loop: project.loop,
    layers,
    capabilities: {
      availableEngines: ['canvas2d', 'glsl', 'html', 'remotion-component'],
      animationCommands: ANIMATION_COMMANDS,
      limitations: LIMITATIONS,
    },
  };
}

export function aiSceneToJson(scene: AiScene): string {
  return JSON.stringify(scene, null, 2);
}
