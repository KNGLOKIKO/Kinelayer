import type { AudioLayer, ImageLayer, Layer, Project, TextLayer, VideoLayer, CodeLayer, LayerAnimation } from '../types';
import { CommandFailure } from '../registry';
import { getBackground } from '../types';

export function findLayer(draft: Project, id: string): Layer {
  const layer = draft.layers.find((l) => l.id === id);
  if (!layer) throw new CommandFailure('NOT_FOUND', `图层不存在：${id}`);
  return layer as Layer;
}

export function findLayerIndex(draft: Project, id: string): number {
  const index = draft.layers.findIndex((l) => l.id === id);
  if (index < 0) throw new CommandFailure('NOT_FOUND', `图层不存在：${id}`);
  return index;
}

export function requireText(draft: Project, id: string): TextLayer {
  const layer = findLayer(draft, id);
  if (layer.type !== 'text') throw new CommandFailure('INVARIANT', `图层 ${id} 不是文本层`);
  return layer as TextLayer;
}

export function requireCode(draft: Project, id: string): CodeLayer {
  const layer = findLayer(draft, id);
  if (layer.type !== 'code') throw new CommandFailure('INVARIANT', `图层 ${id} 不是代码层`);
  return layer as CodeLayer;
}

export function requireAudio(draft: Project, id: string): AudioLayer {
  const layer = findLayer(draft, id);
  if (layer.type !== 'audio') throw new CommandFailure('INVARIANT', `图层 ${id} 不是音频层`);
  return layer as AudioLayer;
}

export function requireImage(draft: Project, id: string): ImageLayer {
  const layer = findLayer(draft, id);
  if (layer.type !== 'image') throw new CommandFailure('INVARIANT', `图层 ${id} 不是图片层`);
  return layer as ImageLayer;
}

export function requireVideo(draft: Project, id: string): VideoLayer {
  const layer = findLayer(draft, id);
  if (layer.type !== 'video') throw new CommandFailure('INVARIANT', `图层 ${id} 不是视频层`);
  return layer as VideoLayer;
}

export function applyAnimationPatch(
  target: LayerAnimation,
  patch: {
    enter?: unknown;
    exit?: unknown;
    emphasis?: unknown;
    tracks?: unknown;
    autoKeyframe?: unknown;
  },
): void {
  for (const slot of ['enter', 'exit', 'emphasis'] as const) {
    const value = patch[slot];
    if (value === undefined) continue;
    if (value === null) delete target[slot];
    else target[slot] = value as LayerAnimation[typeof slot];
  }
  // v2：整体替换轨道（数组的增删改都有专门命令，这里是「整段导入」的入口）
  if (Array.isArray(patch.tracks)) {
    target.tracks = patch.tracks as LayerAnimation['tracks'];
  }
  if (typeof patch.autoKeyframe === 'boolean') target.autoKeyframe = patch.autoKeyframe;
}

/**
 * 结构性不变式，总线在每次 mutating 命令后强制调用：
 * 1. background 必须存在且位于 index 0
 * 2. background 的几何永远等于画布
 * 3. 时间区间合法
 * 4. id 唯一
 */
export function enforceInvariants(draft: Project): void {
  const bgIndex = draft.layers.findIndex((l) => l.type === 'background');
  if (bgIndex < 0) {
    throw new CommandFailure('INVARIANT', '项目缺少背景层，已被拒绝');
  }
  if (bgIndex !== 0) {
    const [bg] = draft.layers.splice(bgIndex, 1);
    if (bg) draft.layers.unshift(bg);
  }
  const bg = getBackground(draft as Project);
  bg.x = 0;
  bg.y = 0;
  bg.width = draft.width;
  bg.height = draft.height;
  bg.rotation = 0;
  bg.locked = true;
  bg.visible = true;

  const seen = new Set<string>();
  for (const layer of draft.layers) {
    if (seen.has(layer.id)) layer.id = `${layer.id}_${Math.random().toString(36).slice(2, 7)}`;
    seen.add(layer.id);
    if (layer.outPoint > 0 && layer.outPoint < layer.inPoint) layer.outPoint = layer.inPoint;
    if (layer.type !== 'background') {
      layer.width = Math.max(1, layer.width);
      layer.height = Math.max(1, layer.height);
      layer.opacity = Math.min(1, Math.max(0, layer.opacity));
    }
  }
}

export function nextLayerName(draft: Project, base: string): string {
  const existing = new Set(draft.layers.map((l) => l.name));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(`${base} ${i}`)) i += 1;
  return `${base} ${i}`;
}
