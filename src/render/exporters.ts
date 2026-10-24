import type { Project } from '@/core/types';
import { isCode, isText } from '@/core/types';
import { prepareVideos, renderScene } from './renderScene';
import { preloadFonts } from './text';
import { rasterizeHtml } from './htmlRaster';
import { ensureAsset, getImage } from './assets';
import type { Drawable } from './assets';

export interface PngResult {
  filename: string;
  bytes: number;
  width: number;
  height: number;
}

export interface WebmResult {
  filename: string;
  bytes: number;
  frames: number;
}

function safeName(name: string): string {
  return (name || 'poster').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 48);
}

export function buildFilename(project: Project, ext: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(
    d.getHours(),
  ).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
  return `${safeName(project.name)}-${stamp}.${ext}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 导出前把所有异步依赖一次性解决：字体、视频帧、HTML 层栅格 */
async function prepare(project: Project, time: number, scale: number): Promise<Map<string, Drawable>> {
  const styles = project.layers.filter(isText).map((l) => l.style);
  await preloadFonts(styles);
  for (const asset of project.assets) {
    if (asset.kind === 'image' || asset.kind === 'video') {
      await ensureAsset(asset.id, asset.kind);
    }
  }
  await prepareVideos(project, time);
  const htmlBitmaps = new Map<string, Drawable>();
  for (const layer of project.layers) {
    if (isCode(layer) && layer.code.engine === 'html') {
      const bitmap = await rasterizeHtml(layer.code.source, layer.width, layer.height, Math.min(scale, 2));
      if (bitmap) htmlBitmaps.set(layer.id, bitmap);
    }
  }
  return htmlBitmaps;
}

export async function renderToCanvas(
  project: Project,
  time: number,
  scale: number,
  transparent: boolean,
  layerId: string | null = null,
): Promise<HTMLCanvasElement> {
  const htmlBitmaps = await prepare(project, time, scale);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(project.width * scale));
  canvas.height = Math.max(1, Math.round(project.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建导出画布上下文');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderScene(ctx, project, {
    time,
    scale,
    transparent,
    htmlBitmaps,
    onlyLayerId: layerId,
  });
  return canvas;
}

export async function exportPng(
  project: Project,
  opts: { scale: number; transparent: boolean; time: number },
): Promise<PngResult> {
  const canvas = await renderToCanvas(project, opts.time, opts.scale, opts.transparent);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 编码失败');
  const filename = buildFilename(project, 'png');
  downloadBlob(blob, filename);
  return { filename, bytes: blob.size, width: canvas.width, height: canvas.height };
}

function pickMime(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 手动推帧导出：
 * canvas.captureStream(0) 拿到可手动 requestFrame 的 VideoTrack，逐帧渲染后推一帧。
 * 相比 captureStream(30) 的自动采样，这种方式能保证「内容按 fps 精确推进」；
 * 但 MediaRecorder 的帧时间戳来自推帧时刻，所以每帧之间必须等待真实时间。
 */
export async function exportWebm(
  project: Project,
  opts: { fps: number; quality: number; time: number },
  onProgress: (p: number) => void,
): Promise<WebmResult> {
  if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持 MediaRecorder');
  const fps = Math.min(60, Math.max(1, Math.round(opts.fps || project.fps)));
  const total = Math.max(1, Math.round((project.duration / 1000) * fps));
  const canvas = await renderToCanvas(project, 0, 1, false);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建导出画布上下文');

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  if (!track || typeof track.requestFrame !== 'function') {
    throw new Error('当前浏览器不支持 captureStream(0) + requestFrame');
  }

  const bitrate = Math.round(2_000_000 + (opts.quality / 100) * 10_000_000);
  const recorder = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();
  const frameDelay = 1000 / fps;
  for (let i = 0; i < total; i++) {
    const t = (i / fps) * 1000;
    await prepareVideos(project, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderScene(ctx, project, { time: t, scale: 1, transparent: false });
    track.requestFrame();
    onProgress((i + 1) / total);
    await sleep(frameDelay);
  }
  // 多推几帧，避免末端被截断
  await sleep(frameDelay * 2);
  recorder.stop();
  await stopped;
  track.stop();

  const blob = new Blob(chunks, { type: 'video/webm' });
  const filename = buildFilename(project, 'webm');
  downloadBlob(blob, filename);
  return { filename, bytes: blob.size, frames: total };
}

export async function captureFrame(
  project: Project,
  opts: { maxWidth: number; layerId: string | null; time: number },
): Promise<{ dataUrl: string; width: number; height: number }> {
  const scale = Math.min(2, Math.max(0.05, opts.maxWidth / project.width));
  const canvas = await renderToCanvas(project, opts.time, scale, false, opts.layerId);
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

export function exportProjectJson(project: Project): { filename: string; bytes: number } {
  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const filename = buildFilename(project, 'json');
  downloadBlob(blob, filename);
  return { filename, bytes: blob.size };
}

void getImage;
