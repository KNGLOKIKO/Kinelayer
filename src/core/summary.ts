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
