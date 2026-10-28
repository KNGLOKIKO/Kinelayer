import type { Layer, Project } from './types';
import { getBackground } from './types';

export interface LayerSummary {
  index: number;
  id: string;
  type: Layer['type'];
  name: string;
  box: [number, number, number, number];
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  blendMode: string;
  inPoint: number;
  outPoint: number;
  animation?: Record<string, string>;
  bindings?: Record<string, string>;
  text?: string;
  style?: { fontFamily: string; fontSize: number; fontWeight: number; color: string };
  engine?: string;
  codeBytes?: number;
  assetId?: string | null;
  codeError?: string | null;
  /** 音频层专有：响什么、多响 */
  audio?: { preset: string; root: number; bpm: number; volume: number; muted: boolean };
  /**
   * 剪辑信息（只给「动过刀」的层）。
   *
   * 默认值一律不报：`trimIn: 0` / `transition: null` 是绝大多数层的样子，
   * 每层都写一遍只会把上下文撑大。报了 `trimIn` 模型才知道这一段的画面不是素材开头；
   * 报了 `transition` 它才不会以为两段之间是硬切而多画一帧黑场。
   */
  clip?: { trimIn?: number; playbackRate?: number; transition?: { kind: string; duration: number } };
  /**
   * 来源溯源（只给「不是手搓的」那些层）。
   *
   * 不带这一项时，模型看到的是一堆没有来历的图层：它不知道这层是 HTML 解析出来的、
   * 依赖着一个远程 GSAP、或者本来要引用的那张图没落地成资源 —— 于是会给出
   * 「把这张图换成别的」这种根本没图可换的建议。三项都只放「能改变建议」的信息，
   * 原始工程包名和导入时间不放（对写代码没有帮助，只是噪声）。
   */
  origin?: {
    generator: string;
    sourceFormat?: string;
    parser?: string;
    external?: string[];
    sourceRef?: string;
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/**
 * AI 上下文摘要：只传结构信息与短文本，绝不传 base64、不传完整代码。
 * 通道 A 的每次请求、query.project 的返回值都用它。
 */
export function summarizeProject(project: Project): Record<string, unknown> {
  const bg = getBackground(project);
  const layers: LayerSummary[] = project.layers.map((layer, index) => {
    const base: LayerSummary = {
      index,
      id: layer.id,
      type: layer.type,
      name: layer.name,
      box: [Math.round(layer.x), Math.round(layer.y), Math.round(layer.width), Math.round(layer.height)],
      rotation: Math.round(layer.rotation),
      opacity: Number(layer.opacity.toFixed(2)),
      visible: layer.visible,
      locked: layer.locked,
      blendMode: layer.blendMode,
      inPoint: layer.inPoint,
      outPoint: layer.outPoint,
    };
    const anim = Object.entries(layer.animation ?? {})
      .filter(([, v]) => v)
      .map(([k, v]) => [k, `${(v as { preset: string }).preset}/${(v as { duration: number }).duration}ms`]);
    if (anim.length) base.animation = Object.fromEntries(anim);
    if (Object.keys(layer.bindings ?? {}).length) base.bindings = layer.bindings as Record<string, string>;

    /*
     * 只有带 origin 的层才写 origin。手搓的层没有这个字段，缺省就是「用户自己做的」——
     * 给它补一个 { generator: 'user' } 会让每层都长出一段同样的内容，反而吃掉真正有信息量的那几层。
     */
    if (layer.origin) {
      const { generator, sourceFormat, parser, external, sourceRef } = layer.origin;
      base.origin = {
        generator,
        ...(sourceFormat ? { sourceFormat } : {}),
        ...(parser ? { parser } : {}),
        ...(external?.length ? { external: external.slice(0, 8) } : {}),
        /* sourceRef 可能是一整段 data: 或超长 URL，摘要里只留能认出来源的头部 */
        ...(sourceRef ? { sourceRef: truncate(sourceRef, 200) } : {}),
      };
    }

    if (layer.type === 'text') {
      base.text = truncate(layer.text, 120);
      base.style = {
        fontFamily: layer.style.fontFamily,
        fontSize: layer.style.fontSize,
        fontWeight: layer.style.fontWeight,
        color: layer.style.color,
      };
    } else if (layer.type === 'code') {
      base.engine = layer.code.engine;
      base.codeBytes = layer.code.source.length;
    } else if (layer.type === 'image' || layer.type === 'video') {
      base.assetId = layer.assetId;
    } else if (layer.type === 'audio') {
      /* 音频层没有画面属性，摘要里只报「响什么、多响」——AI 拿到坐标和尺寸只会更糊涂 */
      base.audio = {
        preset: layer.tone.preset,
        root: layer.tone.root,
        bpm: layer.tone.bpm,
        volume: layer.volume,
        muted: layer.muted,
      };
    }

    if (layer.type === 'image' || layer.type === 'video' || layer.type === 'audio') {
      /* 图片没有「素材内时间」，只有转场；视频/音频才有 trimIn 与速度 */
      const trimIn = layer.type === 'image' ? 0 : (layer.trimIn ?? 0);
      const transition = layer.type === 'audio' ? null : layer.transition;
      const rate = layer.type === 'video' ? layer.playbackRate : undefined;
      if (trimIn > 0 || transition || (rate !== undefined && rate !== 1)) {
        base.clip = {
          ...(trimIn > 0 ? { trimIn } : {}),
          ...(rate !== undefined && rate !== 1 ? { playbackRate: rate } : {}),
          ...(transition ? { transition: { kind: transition.kind, duration: transition.duration } } : {}),
        };
      }
    }
    return base;
  });

  return {
    project: {
      id: project.id,
      name: project.name,
      width: project.width,
      height: project.height,
      duration: project.duration,
      fps: project.fps,
      version: project.version,
      background: {
        kind: bg.kind,
        color: bg.color,
        assetId: bg.assetId,
        gradientStops: bg.gradient.stops.length,
        codeEngine: bg.kind === 'code' ? bg.code.engine : undefined,
      },
    },
    layers,
    assets: project.assets.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      size: a.size,
      ...(a.width ? { width: a.width, height: a.height } : {}),
    })),
    fonts: project.fonts.map((f) => ({ family: f.family, source: f.source, weight: f.weight })),
  };
}

export function summarizeLayer(layer: Layer): Record<string, unknown> {
  const out: Record<string, unknown> = { ...layer };
  if (layer.type === 'code') {
    out.code = { ...layer.code, source: truncate(layer.code.source, 4000) };
  }
  if (layer.type === 'text') {
    out.text = truncate(layer.text, 2000);
  }
  return out;
}
