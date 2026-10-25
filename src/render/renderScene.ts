import { getBackground, type CodeLayer, type ImageLayer, type Layer, type Project, type VideoLayer } from '@/core/types';
import { computeLayerFrame, type FrameTransform } from './animation';
import { getImage, getVideo, isAssetMissing, syncVideoTime, type Drawable } from './assets';
import { runCodeLayer } from './codeEngine';
import { buildGradient, drawTextLayer } from './text';
import { FONT_STACK_FALLBACK } from '@/core/defaults';

export interface RenderOptions {
  time: number;
  /** 代码层内部分辨率倍率（预览用 zoom*dpr，导出用 exportScale） */
  scale?: number;
  transparent?: boolean;
  /** 导出时预栅格化的 HTML 层 */
  htmlBitmaps?: Map<string, Drawable>;
  /** 只渲染某一个图层（图层独立窗口用） */
  onlyLayerId?: string | null;
  /** 调试：跳过代码层 */
  skipCode?: boolean;
  /** 拖拽/缩放过程中的临时几何覆盖（不写回项目，不进撤销栈） */
  overrides?: Map<string, Partial<Layer>>;
}

const BLEND_MAP: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  lighten: 'lighten',
  darken: 'darken',
  difference: 'difference',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
};

function roundedRect(ctx: CanvasRenderingContext2D, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (radius <= 0.01) {
    ctx.rect(0, 0, w, h);
    return;
  }
  ctx.moveTo(radius, 0);
  ctx.lineTo(w - radius, 0);
  ctx.quadraticCurveTo(w, 0, w, radius);
  ctx.lineTo(w, h - radius);
  ctx.quadraticCurveTo(w, h, w - radius, h);
  ctx.lineTo(radius, h);
  ctx.quadraticCurveTo(0, h, 0, h - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
}

function drawFit(
  ctx: CanvasRenderingContext2D,
  drawable: Drawable | HTMLVideoElement,
  boxW: number,
  boxH: number,
  fit: 'cover' | 'contain' | 'fill',
): void {
  const sw = drawable instanceof HTMLVideoElement ? drawable.videoWidth : drawable.width;
  const sh = drawable instanceof HTMLVideoElement ? drawable.videoHeight : drawable.height;
  if (!sw || !sh) return;
  if (fit === 'fill') {
    ctx.drawImage(drawable as CanvasImageSource, 0, 0, boxW, boxH);
    return;
  }
  const scale = fit === 'cover' ? Math.max(boxW / sw, boxH / sh) : Math.min(boxW / sw, boxH / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(drawable as CanvasImageSource, (boxW - dw) / 2, (boxH - dh) / 2, dw, dh);
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, w: number, h: number, label: string): void {
  ctx.save();
  ctx.fillStyle = 'rgba(124,92,255,0.10)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(155,131,255,0.65)';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(1, 1, Math.max(0, w - 2), Math.max(0, h - 2));
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(230,232,245,0.8)';
  ctx.font = `500 ${Math.max(12, Math.min(28, w / 18))}px ${FONT_STACK_FALLBACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, h / 2);
  ctx.restore();
}

function withTransform(
  ctx: CanvasRenderingContext2D,
  frame: FrameTransform,
  draw: () => void,
): void {
  const w = frame.width;
  const h = frame.height;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, frame.opacity));
  ctx.translate(frame.x + w / 2, frame.y + h / 2);
  if (frame.rotation) ctx.rotate((frame.rotation * Math.PI) / 180);
  if (frame.scale !== 1) ctx.scale(frame.scale, frame.scale);
  ctx.translate(-w / 2, -h / 2);
  draw();
  ctx.restore();
}

function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer,
  frame: FrameTransform,
  assetScale: number,
): void {
  withTransform(ctx, frame, () => {
    const w = layer.width;
    const h = layer.height;
    ctx.save();
    roundedRect(ctx, w, h, layer.radius);
    ctx.clip();
    const img = getImage(layer.assetId);
    if (!img) {
      drawPlaceholder(ctx, w, h, layer.assetId ? '图片资源缺失' : '未选择图片');
      ctx.restore();
      return;
    }
    const filters: string[] = [];
    if (layer.brightness !== 1) filters.push(`brightness(${layer.brightness})`);
    if (layer.contrast !== 1) filters.push(`contrast(${layer.contrast})`);
    if (layer.saturate !== 1) filters.push(`saturate(${layer.saturate})`);
    if (layer.grayscale > 0) filters.push(`grayscale(${layer.grayscale})`);
    if (layer.blur > 0) filters.push(`blur(${layer.blur * assetScale}px)`);
    if (filters.length) ctx.filter = filters.join(' ');
    drawFit(ctx, img, w, h, layer.fit);
    ctx.filter = 'none';
    ctx.restore();
  });
}

function drawVideoLayer(ctx: CanvasRenderingContext2D, layer: VideoLayer, frame: FrameTransform): void {
  withTransform(ctx, frame, () => {
    const w = layer.width;
    const h = layer.height;
    ctx.save();
    roundedRect(ctx, w, h, layer.radius);
    ctx.clip();
    const video = getVideo(layer.assetId);
    if (!video || video.readyState < 2) {
      drawPlaceholder(ctx, w, h, layer.assetId ? '视频解码中…' : '未选择视频');
      ctx.restore();
      return;
    }
    drawFit(ctx, video, w, h, layer.fit);
    ctx.restore();
  });
}

function drawCodeLayer(
  ctx: CanvasRenderingContext2D,
  layer: CodeLayer,
  frame: FrameTransform,
  time: number,
  scale: number,
  htmlBitmaps?: Map<string, Drawable>,
): void {
  if (layer.code.engine === 'html') {
    const bitmap = htmlBitmaps?.get(layer.id);
    withTransform(ctx, frame, () => {
      if (bitmap) ctx.drawImage(bitmap as CanvasImageSource, 0, 0, layer.width, layer.height);
      else drawPlaceholder(ctx, layer.width, layer.height, 'HTML 层 · 编辑态为实时 DOM 叠加');
    });
    return;
  }
  withTransform(ctx, frame, () => {
    const result = runCodeLayer(ctx, layer, time, Math.round(time / 16.67), scale);
    if (!result.ok) {
      drawPlaceholder(ctx, layer.width, layer.height, '代码层异常 · 见右侧面板');
    }
  });
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  project: Project,
  time: number,
  scale: number,
  transparent: boolean,
): void {
  const bg = getBackground(project);
  if (!transparent) {
    ctx.save();
    if (bg.kind === 'solid') {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, project.width, project.height);
    } else if (bg.kind === 'gradient') {
      ctx.fillStyle = buildGradient(ctx, bg.gradient, 0, 0, project.width, project.height);
      ctx.fillRect(0, 0, project.width, project.height);
    } else if (bg.kind === 'image') {
      const img = getImage(bg.assetId);
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, project.width, project.height);
      if (img) drawFit(ctx, img, project.width, project.height, bg.fit);
      else if (isAssetMissing(bg.assetId)) drawPlaceholder(ctx, project.width, project.height, '背景图资源缺失');
    } else if (bg.kind === 'code') {
      if (bg.code.source.trim()) {
        const bgCode: CodeLayer = {
          ...bg,
          type: 'code',
          code: bg.code,
        } as unknown as CodeLayer;
        runCodeLayer(ctx, bgCode, time, Math.round(time / 16.67), scale);
      } else {
        ctx.fillStyle = bg.color;
        ctx.fillRect(0, 0, project.width, project.height);
      }
    }
    ctx.restore();
  }
}

/**
 * 唯一的场景渲染入口。
 * 编辑预览（StageCanvas）、PNG 导出、WebM 逐帧导出、图层窗口镜像全部调用它。
 */
export function renderScene(ctx: CanvasRenderingContext2D, project: Project, opts: RenderOptions): void {
  const time = opts.time;
  const scale = opts.scale ?? 1;
  drawBackground(ctx, project, time, scale, opts.transparent ?? false);

  const layers = project.layers;
  for (let i = 1; i < layers.length; i++) {
    const base = layers[i] as Layer;
    if (opts.onlyLayerId && base.id !== opts.onlyLayerId) continue;
    const override = opts.overrides?.get(base.id);
    const layer = (override ? ({ ...base, ...override } as Layer) : base) as Layer;
    const frame = computeLayerFrame(layer, i, time, project.duration);
    if (!frame.alive || frame.opacity <= 0.001) continue;
    ctx.globalCompositeOperation = BLEND_MAP[layer.blendMode] ?? 'source-over';
    ctx.save();
    switch (layer.type) {
      case 'text':
        withTransform(ctx, frame, () => {
          // v2：字号/字距可能被关键帧轨道覆盖，覆盖值只影响这一帧的绘制
          const style =
            frame.fontSize === undefined && frame.letterSpacing === undefined
              ? layer.style
              : {
                  ...layer.style,
                  fontSize: frame.fontSize ?? layer.style.fontSize,
                  letterSpacing: frame.letterSpacing ?? layer.style.letterSpacing,
                };
          drawTextLayer(ctx, layer.text, style, { width: frame.width, height: frame.height });
        });
        break;
      case 'image':
        drawImageLayer(ctx, layer, frame, scale);
        break;
      case 'video':
        drawVideoLayer(ctx, layer, frame);
        break;
      case 'code':
        if (!opts.skipCode) drawCodeLayer(ctx, layer, frame, time, scale, opts.htmlBitmaps);
        break;
      default:
        break;
    }
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/** 视频层需要先 seek 到当前时间，渲染才是确定的 */
export async function prepareVideos(project: Project, time: number): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const layer of project.layers) {
    if (layer.type !== 'video' || !layer.visible) continue;
    const video = getVideo(layer.assetId);
    if (video) tasks.push(syncVideoTime(video, time));
  }
  await Promise.allSettled(tasks);
}
