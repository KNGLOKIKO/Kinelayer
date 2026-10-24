import { clamp, round } from '@/core/geometry';
import type { Layer, LayerAnim } from '@/core/types';
import { ease } from './easing';

export interface FrameTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  scale: number;
  /** 该帧是否应被绘制 */
  alive: boolean;
}

/** 表达式编译缓存：key = 表达式原文 */
const exprCache = new Map<string, ((...args: unknown[]) => unknown) | null>();

const NOISE_PERM = (() => {
  const p = new Uint8Array(512);
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [base[i], base[j]] = [base[j] as number, base[i] as number];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255] as number;
  return p;
})();

export function hashRand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return x - Math.floor(x);
}

export function valueNoise2D(x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const aa = NOISE_PERM[NOISE_PERM[xi] + yi] / 255;
  const ab = NOISE_PERM[NOISE_PERM[xi] + yi + 1] / 255;
  const ba = NOISE_PERM[NOISE_PERM[xi + 1] + yi] / 255;
  const bb = NOISE_PERM[NOISE_PERM[xi + 1] + yi + 1] / 255;
  const x1 = aa + (ba - aa) * u;
  const x2 = ab + (bb - ab) * u;
  return x1 + (x2 - x1) * v;
}

function compileExpr(expr: string): ((...args: unknown[]) => unknown) | null {
  const cached = exprCache.get(expr);
  if (cached !== undefined) return cached;
  let fn: ((...args: unknown[]) => unknown) | null = null;
  try {
    // with(Math) 提供 sin/cos/PI 等；表达式只能读，不能写项目状态
    fn = new Function(
      'time',
      'frame',
      'w',
      'h',
      'i',
      `with (Math) { return (${expr}); }`,
    ) as (...args: unknown[]) => unknown;
  } catch {
    fn = null;
  }
  if (exprCache.size > 500) exprCache.clear();
  exprCache.set(expr, fn);
  return fn;
}

export interface BindingResult {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  scale: number;
  errors: string[];
}

/** 属性表达式绑定：按帧求值，只影响「这一帧的变换」，不写回数据 */
export function applyBindings(layer: Layer, time: number, frame: number, index: number): BindingResult {
  const out: BindingResult = {
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    rotation: layer.rotation,
    opacity: layer.opacity,
    scale: 1,
    errors: [],
  };
  const entries = Object.entries(layer.bindings ?? {});
  if (entries.length === 0) return out;
  for (const [target, expr] of entries) {
    if (!expr || !expr.trim()) continue;
    const fn = compileExpr(expr);
    if (!fn) {
      out.errors.push(`${target}: 表达式语法错误`);
      continue;
    }
    try {
      const value = Number(fn(time, frame, layer.width, layer.height, index));
      if (!Number.isFinite(value)) continue;
      switch (target) {
        case 'x':
          out.x = value;
          break;
        case 'y':
          out.y = value;
          break;
        case 'width':
          out.width = Math.max(1, value);
          break;
        case 'height':
          out.height = Math.max(1, value);
          break;
        case 'rotation':
          out.rotation = value;
          break;
        case 'opacity':
          out.opacity = clamp(value, 0, 1);
          break;
        case 'scale':
          out.scale = Math.max(0.01, value);
          break;
        default:
          break;
      }
    } catch (err) {
      out.errors.push(`${target}: ${(err as Error).message}`);
    }
  }
  return out;
}

interface Mod {
  dx: number;
  dy: number;
  scale: number;
  alpha: number;
  spin: number;
}

const IDENTITY: Mod = { dx: 0, dy: 0, scale: 1, alpha: 1, spin: 0 };

/**
 * 单个动画槽的采样。p ∈ [0,1]，0 = 起始状态，1 = 落位状态。
 * 所有数值都来自图层的持久化字段，不含任何 UI 状态（借自 Lower-Thirds-Editor 的编辑/播放分离）。
 */
function samplePreset(anim: LayerAnim, p: number, w: number, h: number): Mod {
  const k = clamp(anim.intensity ?? 0.6, 0, 1);
  const d = (0.12 * Math.max(w, h) + 40) * k;
  const inv = 1 - p;
  switch (anim.preset) {
    case 'fade':
      return { ...IDENTITY, alpha: p };
    case 'slide-up':
      return { ...IDENTITY, dy: inv * d, alpha: Math.min(1, p * 2) };
    case 'slide-down':
      return { ...IDENTITY, dy: -inv * d, alpha: Math.min(1, p * 2) };
    case 'slide-left':
      return { ...IDENTITY, dx: inv * d, alpha: Math.min(1, p * 2) };
    case 'slide-right':
      return { ...IDENTITY, dx: -inv * d, alpha: Math.min(1, p * 2) };
    case 'zoom-in':
      return { ...IDENTITY, scale: 1 - inv * 0.22 * k, alpha: p };
    case 'zoom-out':
      return { ...IDENTITY, scale: 1 + inv * 0.22 * k, alpha: p };
    case 'pulse':
      return { ...IDENTITY, scale: 1 + Math.sin(p * Math.PI * 2) * 0.055 * k };
    case 'float':
      return { ...IDENTITY, dy: Math.sin(p * Math.PI * 2) * 16 * k };
    case 'spin':
      return { ...IDENTITY, spin: p * 360 * k };
    case 'none':
    default:
      return IDENTITY;
  }
}

function windowProgress(time: number, start: number, duration: number): number {
  if (duration <= 0) return 1;
  return clamp((time - start) / duration, 0, 1);
}

/**
 * 计算图层在 time 时刻的最终变换。
 * enter / exit 用同一套 preset，exit 反向播放；emphasis 是时间轴内循环。
 */
export function computeLayerFrame(layer: Layer, index: number, time: number, projectDuration: number): FrameTransform {
  const base = applyBindings(layer, time, Math.floor(time / 16.67), index);
  const outPoint = layer.outPoint > 0 ? layer.outPoint : projectDuration;
  const alive = layer.visible && time >= layer.inPoint && time <= outPoint;
  const alphaBase = base.opacity;

  if (!alive) {
    return {
      x: base.x,
      y: base.y,
      width: base.width,
      height: base.height,
      rotation: base.rotation,
      opacity: 0,
      scale: base.scale,
      alive: false,
    };
  }

  let mod: Mod = { ...IDENTITY };

  const enter = layer.animation?.enter;
  if (enter && enter.preset !== 'none' && enter.duration > 0) {
    const p = windowProgress(time, layer.inPoint + enter.delay, enter.duration);
    if (p < 1) mod = mergeMod(mod, samplePreset(enter, ease(enter.easing, p), base.width, base.height));
    else mod = mergeMod(mod, { ...IDENTITY });
  }

  const exit = layer.animation?.exit;
  if (exit && exit.preset !== 'none' && exit.duration > 0) {
    const exitStart = outPoint - exit.duration - exit.delay;
    const q = windowProgress(time, exitStart, exit.duration);
    if (q > 0) {
      const m = samplePreset(exit, ease(exit.easing, 1 - q), base.width, base.height);
      mod = mergeMod(mod, { ...m, alpha: m.alpha === 1 ? 1 - q : m.alpha * (1 - q) });
    }
  }

  const emphasis = layer.animation?.emphasis;
  if (emphasis && emphasis.preset !== 'none' && emphasis.duration > 0) {
    const p = ((time - layer.inPoint) % emphasis.duration) / emphasis.duration;
    mod = mergeMod(mod, samplePreset(emphasis, ease(emphasis.easing, p), base.width, base.height));
  }

  return {
    x: round(base.x + mod.dx, 3),
    y: round(base.y + mod.dy, 3),
    width: base.width,
    height: base.height,
    rotation: round(base.rotation + mod.spin, 3),
    opacity: clamp(alphaBase * mod.alpha, 0, 1),
    scale: Math.max(0.01, base.scale * mod.scale),
    alive: true,
  };
}

function mergeMod(a: Mod, b: Mod): Mod {
  return {
    dx: a.dx + b.dx,
    dy: a.dy + b.dy,
    scale: a.scale * b.scale,
    alpha: a.alpha * b.alpha,
    spin: a.spin + b.spin,
  };
}
