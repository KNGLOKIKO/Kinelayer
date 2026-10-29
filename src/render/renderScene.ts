import { getBackground, type CodeLayer, type ImageLayer, type Layer, type Project, type RemotionRuntime, type VideoLayer } from '@/core/types';
import { clipAlphaAt, clipEnd, outgoingExtension, sourceTimeMs, transitionAt, transitionOffset } from '@/core/media';
import { computeLayerFrame, type FrameTransform } from './animation';
import { getImage, getVideo, isAssetMissing, syncVideoTime, type Drawable } from './assets';
import { codeEnvOf, runCodeLayer, type CodeEnv } from './codeEngine';
import { buildGradient, drawTextLayer } from './text';
import { FONT_STACK_FALLBACK } from '@/core/defaults';
import { beginEvaluation, endEvaluation } from '@/core/loopProtect';

export interface RenderOptions {
  time: number;
  /** 代码层内部分辨率倍率（预览用 zoom*dpr，导出用 exportScale） */
  scale?: number;
  transparent?: boolean;
  /** 导出时预栅格化的 HTML 层 */
  htmlBitmaps?: Map<string, Drawable>;
  /**
   * 编辑态标志：html 层由 Stage 上的 sandbox iframe 实时渲染，canvas 不要再画占位。
   *
   * 占位是「铺满图层 + 半透明紫 + 一行说明」—— 编辑态它还画，就会盖住下面的原生图层，
   * 也会盖住 iframe 显示不出来的部分（用户会以为导入错了）。
   * 离屏渲染（图层独立窗口）与导出不能传它，那时没有 iframe，占位是唯一的信息。
   */
  htmlLive?: boolean;
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

interface TransformTweaks {
  /** 叠加在图层 opacity 上（转场用） */
  alphaMul?: number;
  /** 屏幕空间横向位移（slide 转场用） */
  offsetX?: number;
  /** 擦除进度 0..1：只画左侧这一条（wipe 转场用） */
  wipe?: number;
}

function withTransform(
  ctx: CanvasRenderingContext2D,
  frame: FrameTransform,
  draw: () => void,
  tweaks?: TransformTweaks,
): void {
  const w = frame.width;
  const h = frame.height;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, frame.opacity * (tweaks?.alphaMul ?? 1)));
  ctx.translate(frame.x + w / 2 + (tweaks?.offsetX ?? 0), frame.y + h / 2);
  if (frame.rotation) ctx.rotate((frame.rotation * Math.PI) / 180);
  if (frame.scale !== 1) ctx.scale(frame.scale, frame.scale);
  ctx.translate(-w / 2, -h / 2);
  if (tweaks?.wipe !== undefined && tweaks.wipe < 1) {
    ctx.beginPath();
    ctx.rect(0, 0, Math.max(0, w * tweaks.wipe), h);
    ctx.clip();
  }
  draw();
  ctx.restore();
}

/** 媒体层的转场改写：透明度 / 滑入位移 / 擦除进度，三样都从 core/media 算出来 */
function mediaTweaks(project: Project, layer: Layer, time: number): TransformTweaks {
  const at = transitionAt(layer, project, time);
  return {
    alphaMul: clipAlphaAt(project, layer, time),
    offsetX: transitionOffset(layer, project, time),
    wipe: at && at.transition.kind === 'wipe' ? at.p : undefined,
  };
}

function drawImageLayer(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer,
  frame: FrameTransform,
  assetScale: number,
  tweaks?: TransformTweaks,
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
  }, tweaks);
}

function drawVideoLayer(ctx: CanvasRenderingContext2D, layer: VideoLayer, frame: FrameTransform, tweaks?: TransformTweaks): void {
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
  }, tweaks);
}

/**
 * `remotion-component` 层的预览。
 *
 * 这里**绝不执行** entryCode —— 它是 TSX，浏览器里既跑不了也没有逐帧渲染能力。
 * 所以只有两种画法，两种都如实说明自己是「代替品」：
 *   · 代理视频（用户/外部 CLI 先渲过一版）：画它的当前帧，编辑期当参考；
 *   · 都没有：画一张技术卡片，写清 composition / 尺寸 / 帧率 / 时长。
 * 卡片上的字刻意用 ASCII 技术词（remotion / static preview），不做翻译 ——
 * 它不是 UI 文案，是这一层的身份标签，换语言反而不好认。
 */
function drawRemotionLayer(ctx: CanvasRenderingContext2D, layer: CodeLayer, frame: FrameTransform): void {
  const rt = layer.code.runtime;
  withTransform(ctx, frame, () => {
    const w = layer.width;
    const h = layer.height;
    ctx.save();
    if (rt?.previewMode === 'proxy-video' && rt.proxyAssetId) {
      const video = getVideo(rt.proxyAssetId);
      if (video && video.readyState >= 2) {
        drawFit(ctx, video, w, h, 'cover');
        ctx.restore();
        return;
      }
    }
    drawRemotionCard(ctx, w, h, rt);
    ctx.restore();
  });
}

function drawRemotionCard(ctx: CanvasRenderingContext2D, w: number, h: number, rt?: RemotionRuntime): void {
  const unit = Math.max(1, Math.min(w, h) / 100);
  /*
   * 半透明而不是实心：这类层经常铺满画布盖在最上面，
   * 一块 94% 不透明的底板会把下面所有可编辑图层全遮掉 —— 用户会以为「导入把内容吃了」。
   * 现在它读起来就是一张「占位卡」：能看到底下构图，也一眼知道这块还没渲。
   */
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, 'rgba(18,20,30,0.42)');
  bg.addColorStop(1, 'rgba(32,26,54,0.42)');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(124,92,255,0.55)';
  ctx.lineWidth = Math.max(1, unit * 0.6);
  ctx.setLineDash([unit * 3, unit * 3]);
  ctx.strokeRect(unit, unit, Math.max(0, w - unit * 2), Math.max(0, h - unit * 2));
  ctx.setLineDash([]);

  const mono = `${Math.max(9, unit * 3.4)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const sans = `600 ${Math.max(11, unit * 4.6)}px ${FONT_STACK_FALLBACK}`;

  /* 底板透出来了，字得自带阴影才在亮画面上站得住 */
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = unit * 2.2;

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(155,131,255,0.95)';
  ctx.font = mono;
  ctx.fillText('remotion', unit * 4, unit * 4);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(236,238,248,0.92)';
  ctx.font = sans;
  const title = rt?.compositionId || 'component';
  ctx.fillText(fitText(ctx, title, w - unit * 12), w / 2, h / 2 - unit * 3);

  ctx.fillStyle = 'rgba(180,186,205,0.8)';
  ctx.font = mono;
  const meta = rt
    ? `${Math.round(rt.width)}×${Math.round(rt.height)} · ${rt.fps}fps · ${(rt.durationInFrames / Math.max(1, rt.fps)).toFixed(1)}s`
    : 'no runtime info';
  ctx.fillText(fitText(ctx, meta, w - unit * 12), w / 2, h / 2 + unit * 4);

  ctx.fillStyle = 'rgba(140,146,168,0.75)';
  ctx.font = mono;
  const tag = rt?.previewMode === 'proxy-video' ? 'proxy video' : 'static preview · render outside';
  ctx.fillText(fitText(ctx, tag, w - unit * 12), w / 2, h - unit * 6);

  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

/** 画不下就截断，不要把字挤出图层边界（图层可能只有 200px 宽） */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 4 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function drawCodeLayer(
  ctx: CanvasRenderingContext2D,
  layer: CodeLayer,
  frame: FrameTransform,
  time: number,
  scale: number,
  opts: RenderOptions,
  env: CodeEnv,
): void {
  const htmlBitmaps = opts.htmlBitmaps;  if (layer.code.engine === 'html') {
    const bitmap = htmlBitmaps?.get(layer.id);
    if (bitmap) {
      withTransform(ctx, frame, () => {
        ctx.drawImage(bitmap as CanvasImageSource, 0, 0, layer.width, layer.height);
      });
      return;
    }
    /* 编辑态：iframe 已经在上面实时渲染，这里什么都不画 */
    if (opts.htmlLive) return;
    withTransform(ctx, frame, () => {
      drawPlaceholder(ctx, layer.width, layer.height, 'HTML 层 · 编辑态为实时 DOM 叠加');
    });
    return;
  }
  /* remotion 层必须走自己的分支：交给 runCodeLayer 会把 TSX 当 JS 编译，必然炸 */
  if (layer.code.engine === 'remotion-component') {
    drawRemotionLayer(ctx, layer, frame);
    return;
  }
  withTransform(ctx, frame, () => {
    const result = runCodeLayer(ctx, layer, time, Math.round(time / 16.67), scale, env);
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
  env: CodeEnv,
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
        runCodeLayer(ctx, bgCode, time, Math.round(time / 16.67), scale, env);
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
function drawScene(ctx: CanvasRenderingContext2D, project: Project, opts: RenderOptions): void {
  const time = opts.time;
  const scale = opts.scale ?? 1;
  /* 一帧一份谱面：九个代码层读到的拍号必须是同一个数 */
  const env = codeEnvOf(project);
  drawBackground(ctx, project, time, scale, opts.transparent ?? false, env);

  const layers = project.layers;
  for (let i = 1; i < layers.length; i++) {
    const base = layers[i] as Layer;
    if (opts.onlyLayerId && base.id !== opts.onlyLayerId) continue;
    const override = opts.overrides?.get(base.id);
    const layer = (override ? ({ ...base, ...override } as Layer) : base) as Layer;
    /*
     * 叠化/下陷期间，前一段要在自己的出点之后继续出帧（片段是对接的，不是重叠的）。
     * 只在这里临时延长 outPoint，工程数据不动 —— 用户把转场删掉，画面立刻回到硬切。
     */
    const ext = layer.type === 'image' || layer.type === 'video' ? outgoingExtension(project, layer) : 0;
    const drawn = ext > 0 ? ({ ...layer, outPoint: clipEnd(layer, project) + ext } as Layer) : layer;
    const frame = computeLayerFrame(drawn, i, time, project.duration);
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
        drawImageLayer(ctx, layer, frame, scale, mediaTweaks(project, layer, time));
        break;
      case 'video':
        drawVideoLayer(ctx, layer, frame, mediaTweaks(project, layer, time));
        break;
      case 'code':
        if (!opts.skipCode) drawCodeLayer(ctx, layer, frame, time, scale, opts, env);
        break;
      default:
        break;
    }
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

/**
 * 含代码层的工程才需要求值期标记。
 *
 * 为什么不在启动时一次性打标记：那个标记的含义是「此刻正卡在求值里」，
 * 只有进入/离开 renderScene 才是它的准确边界。只对含代码层的工程做，
 * 是因为普通工程白花两次 sessionStorage 操作。
 */
function hasCodeLayers(project: Project): boolean {
  for (const layer of project.layers) {
    if (layer.type === 'code') return true;
  }
  return false;
}

/**
 * 唯一的场景渲染入口（对外）。
 *
 * 真正的绘制在 `drawScene` 里，这层壳只做一件事：**求值期标记**。
 * 进来先写 sessionStorage，正常返回再清掉；万一代码层把主线程钉死在这个函数里，
 * 清不掉的那条标记就是下次启动判定「上次是被冻死的」的唯一证据 ——
 * 没有它，安全模式无从触发，用户一开工程就再冻一次，连改代码的机会都没有。
 */
export function renderScene(ctx: CanvasRenderingContext2D, project: Project, opts: RenderOptions): void {
  const guarding = hasCodeLayers(project);
  if (guarding) beginEvaluation(project.id);
  try {
    drawScene(ctx, project, opts);
  } finally {
    if (guarding) endEvaluation(project.id);
  }
}

/** 视频层需要先 seek 到当前时间，渲染才是确定的 */
export async function prepareVideos(project: Project, time: number): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const layer of project.layers) {
    if (layer.type !== 'video' || !layer.visible) continue;
    /* 出点之后可能还要多活一段（后一段的叠化），那段时间同样要 seek */
    const end = clipEnd(layer, project) + outgoingExtension(project, layer);
    if (time < layer.inPoint || time >= end) continue;
    const video = getVideo(layer.assetId);
    if (!video) continue;
    const asset = project.assets.find((a) => a.id === layer.assetId);
    /* 关键：这里传的是**素材内**时刻，不是时间轴时刻 —— trimIn 与播放速度都在
       sourceTimeMs 里算掉了。以前直接传时间轴时间，所以裁剪左边缘后画面纹丝不动。 */
    tasks.push(syncVideoTime(video, sourceTimeMs(layer, time, asset?.duration)));
  }
  await Promise.allSettled(tasks);
}
