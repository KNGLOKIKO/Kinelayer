import type { AnimatableProperty, EasingSpec, Layer, PropertyTrack } from '@/core/types';
import { EASING_FNS } from './easing';

/**
 * v2 · 关键帧求值
 * ---------------------------------------------------------------------------
 * 这一层是纯函数、无副作用、不认识 React、不认识 store。
 * 预览、PNG、WebM、图层镜像全部经由 computeLayerFrame 走到这里，
 * 「预览与导出同一帧」这条铁律靠的就是「只有一个求值实现」。
 *
 * 时间约定：`localTime = 绝对时间 - layer.inPoint`。
 * 关键帧里存的是 localTime，所以图层整体平移时不需要改任何关键帧数据。
 */

/** 三次贝塞尔：先解 x(t) = p，再取 y(t)。牛顿迭代 + 二分兜底，够快也够稳 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number, p: number): number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  // 牛顿迭代
  let t = p;
  for (let i = 0; i < 6; i++) {
    const x = sampleX(t) - p;
    if (Math.abs(x) < 1e-5) return sampleY(t);
    const d = sampleDX(t);
    if (Math.abs(d) < 1e-6) break;
    t -= x / d;
  }
  // 二分兜底
  let lo = 0;
  let hi = 1;
  t = p;
  for (let i = 0; i < 24; i++) {
    const x = sampleX(t);
    if (Math.abs(x - p) < 1e-5) break;
    if (x < p) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sampleY(t);
}

/** 把一个 EasingSpec 求值成 0..1 的进度 */
export function easeSpec(spec: EasingSpec | undefined, p: number): number {
  const t = p <= 0 ? 0 : p >= 1 ? 1 : p;
  if (!spec) return EASING_FNS['ease-out'](t);
  if (spec.kind === 'cubic-bezier') {
    const [x1, y1, x2, y2] = spec.bezier ?? [0.25, 0.1, 0.25, 1];
    return cubicBezier(x1, y1, x2, y2, t);
  }
  const fn = EASING_FNS[spec.kind] ?? EASING_FNS['ease-out'];
  return fn(t);
}

/**
 * 求一条轨道在 localTime 时刻的值。
 * 边界行为刻意做成「夹住」而不是「循环」：
 *   · 早于首帧 → 取首帧值（不要突然消失，那是 inPoint 的职责）
 *   · 晚于末帧 → 取末帧值（保持终态）
 */
export function evaluateTrack(track: PropertyTrack, localTime: number, fallback: number): number {
  const keys = track.keyframes;
  if (!keys || keys.length === 0) return fallback;
  if (keys.length === 1) return (keys[0] as { value: number }).value;

  const first = keys[0] as { time: number; value: number };
  const last = keys[keys.length - 1] as { time: number; value: number };
  if (localTime <= first.time) return first.value;
  if (localTime >= last.time) return last.value;

  // 关键帧数量按图层算，几十个量级，线性扫描比二分更省心也更快
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i] as { time: number; value: number; easing: EasingSpec };
    const b = keys[i + 1] as { time: number; value: number };
    if (localTime >= a.time && localTime <= b.time) {
      const span = b.time - a.time;
      if (span <= 0) return b.value;
      const p = (localTime - a.time) / span;
      return a.value + (b.value - a.value) * easeSpec(a.easing, p);
    }
  }
  return last.value;
}

/** 一个图层在当前时刻所有轨道求值后的结果（只含真正有轨道的属性） */
export type TrackFrame = Partial<Record<AnimatableProperty, number>>;

export function applyTracks(layer: Layer, absoluteTime: number): TrackFrame {
  const tracks = layer.animation?.tracks;
  if (!tracks || tracks.length === 0) return {};
  const localTime = absoluteTime - layer.inPoint;
  const out: TrackFrame = {};
  for (const track of tracks) {
    if (!track.keyframes || track.keyframes.length === 0) continue;
    const fallback = propertyValue(layer, track.property);
    out[track.property] = evaluateTrack(track, localTime, fallback);
  }
  return out;
}

/** 取图层某个属性当前的「静态值」，作为轨道求值的兜底 */
export function propertyValue(layer: Layer, property: AnimatableProperty): number {
  switch (property) {
    case 'x':
      return layer.x;
    case 'y':
      return layer.y;
    case 'width':
      return layer.width;
    case 'height':
      return layer.height;
    case 'rotation':
      return layer.rotation;
    case 'opacity':
      return layer.opacity;
    case 'fontSize':
      return layer.type === 'text' ? layer.style.fontSize : 16;
    case 'letterSpacing':
      return layer.type === 'text' ? layer.style.letterSpacing : 0;
    default:
      return 0;
  }
}

/** 某个属性在图层上是否可以打关键帧（文本专有属性只给文本层） */
export function canAnimateProperty(
  layer: Layer,
  property: AnimatableProperty,
): boolean {
  if (property === 'fontSize' || property === 'letterSpacing') return layer.type === 'text';
  // 背景层几何由画布决定，不参与位移动画；透明度可以
  if (layer.type === 'background') return property === 'opacity';
  return true;
}

/** 该图层是否已经在某个属性上有轨道 */
export function hasTrack(layer: Layer, property: AnimatableProperty): boolean {
  return (layer.animation?.tracks ?? []).some((t) => t.property === property && t.keyframes.length > 0);
}

/** 轨道上某时刻附近（±tol ms）是否已有关键帧 */
export function keyframeAt(track: PropertyTrack, time: number, tol = 1): { time: number; value: number; easing: EasingSpec } | undefined {
  return track.keyframes.find((k) => Math.abs(k.time - time) <= tol) as
    | { time: number; value: number; easing: EasingSpec }
    | undefined;
}
