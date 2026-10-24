import type { Layer } from './types';

export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  zoom: number;
  panX: number;
  panY: number;
}

export const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

export const round = (n: number, digits = 2): number => {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
};

export function rotatePoint(p: Vec, origin: Vec, deg: number): Vec {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * cos - dy * sin, y: origin.y + dx * sin + dy * cos };
}

export function layerCenter(layer: Pick<Layer, 'x' | 'y' | 'width' | 'height'>): Vec {
  return { x: layer.x + layer.width / 2, y: layer.y + layer.height / 2 };
}

/** 世界坐标点是否命中图层（考虑旋转） */
export function hitLayer(layer: Layer, point: Vec, tolerance = 0): boolean {
  if (!layer.visible) return false;
  const c = layerCenter(layer);
  const local = rotatePoint(point, c, -layer.rotation);
  return (
    local.x >= layer.x - tolerance &&
    local.x <= layer.x + layer.width + tolerance &&
    local.y >= layer.y - tolerance &&
    local.y <= layer.y + layer.height + tolerance
  );
}

export function layerCorners(layer: Layer): Vec[] {
  const pts = [
    { x: layer.x, y: layer.y },
    { x: layer.x + layer.width, y: layer.y },
    { x: layer.x + layer.width, y: layer.y + layer.height },
    { x: layer.x, y: layer.y + layer.height },
  ];
  const c = layerCenter(layer);
  return pts.map((p) => rotatePoint(p, c, layer.rotation));
}

export function boundsOfLayers(layers: Layer[]): Rect | null {
  if (layers.length === 0) return null;
  const pts = layers.flatMap(layerCorners);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function screenToWorld(vp: Viewport, sx: number, sy: number): Vec {
  return { x: (sx - vp.panX) / vp.zoom, y: (sy - vp.panY) / vp.zoom };
}

export function worldToScreen(vp: Viewport, wx: number, wy: number): Vec {
  return { x: wx * vp.zoom + vp.panX, y: wy * vp.zoom + vp.panY };
}

/** 计算「把 pw×ph 的画布居中塞进 cw×ch 的容器」的视口 */
export function fitViewport(cw: number, ch: number, pw: number, ph: number, padding = 64): Viewport {
  const zoom = clamp(Math.min((cw - padding * 2) / pw, (ch - padding * 2) / ph), 0.02, 16);
  return { zoom, panX: (cw - pw * zoom) / 2, panY: (ch - ph * zoom) / 2 };
}

export function normalizeAngle(deg: number): number {
  const a = deg % 360;
  return a < 0 ? a + 360 : a;
}

/** 吸附：返回吸附后的值与命中的参考线（世界坐标） */
export function snapValue(
  value: number,
  targets: number[],
  threshold: number,
): { value: number; guide: number | null } {
  let best: number | null = null;
  let bestDelta = threshold;
  for (const t of targets) {
    const d = Math.abs(value - t);
    if (d <= bestDelta) {
      bestDelta = d;
      best = t;
    }
  }
  return best === null ? { value, guide: null } : { value: best, guide: best };
}
