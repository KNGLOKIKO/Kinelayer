import type { Project } from '@/core/types';
import { isCode, isText } from '@/core/types';
import { packProject } from '@/core/projectFile';
import { prepareVideos, renderScene } from './renderScene';
import { preloadFonts } from './text';
import { rasterizeHtml } from './htmlRaster';
import { ensureAsset, getImage } from './assets';
import type { Drawable } from './assets';
import { createAudioCapture, renderWav } from './audioEngine';
import { clipCues, cuesFromLyrics, formatSubtitles, type CueGranularity, type SubtitleFormat } from '@/core/subtitles';
import { buildEdl } from '@/core/edl';
import { blobOf } from '@/core/bundle';
import { lyricsOf } from '@/core/score';

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
  /** 因为渲染跟不上而被跳过的帧数。0 表示逐帧完整 */
  dropped: number;
  /** 成片实际覆盖的区间（毫秒） */
  from: number;
  to: number;
}

export interface WavResult {
  filename: string;
  bytes: number;
  ms: number;
}

export interface SubtitleResult {
  filename: string;
  bytes: number;
  cues: number;
  from: number;
  to: number;
}

export interface EdlFileResult {
  filename: string;
  bytes: number;
  events: number;
  skipped: { name: string; reason: string }[];
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

/**
 * 这次导出到底覆盖哪一段。
 *
 * 所有出口（视频 / 声音 / 字幕 / 剪辑表）都必须问它，而不是各自读 `project.range`
 * —— 四处各写一遍「没有区间就用全长」的那一天，就是它们开始不一致的那一天。
 */
export function exportWindow(project: Project): { from: number; to: number; ranged: boolean } {
  const r = project.range;
  if (!r) return { from: 0, to: project.duration, ranged: false };
  const from = Math.max(0, Math.min(Math.round(r.in), project.duration));
  const to = Math.max(from + 1, Math.min(Math.round(r.out), project.duration));
  return { from, to, ranged: true };
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
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(project.width * scale));
  canvas.height = Math.max(1, Math.round(project.height * scale));
  await renderInto(canvas, project, { time, scale, transparent, layerId });
  return canvas;
}

/**
 * 把一帧画进**调用方自己那张**画布。
 *
 * 和 `renderToCanvas` 的唯一区别是「谁负责分配」——而这个区别很重要：
 * 1920×1080 的 canvas 背后是 8MB，逐帧 new 一张的代价不在填充上，而在
 * 两帧之间把 8MB 交给 GC。实测这一项能占到单帧开销的三成，而且更坏的是它
 * **会被记到正好在渲染的那个图层头上**（剖析时音频层画 0 像素却测出 20ms，
 * 就是这么来的）。导出 WebM 那条路本来就复用一张画布，现在其余路径也能复用。
 *
 * 调用方负责清场：这里会先 `clearRect`，但透明背景之外不会替你复位任何状态。
 */
export async function renderInto(
  canvas: HTMLCanvasElement,
  project: Project,
  opts: { time: number; scale: number; transparent: boolean; layerId?: string | null },
): Promise<void> {
  const { time, scale, transparent, layerId = null } = opts;
  const htmlBitmaps = await prepare(project, time, scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建导出画布上下文');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  renderScene(ctx, project, {
    time,
    scale,
    transparent,
    htmlBitmaps,
    onlyLayerId: layerId,
  });
}

/**
 * 一块「临时画布」租借处：同一尺寸反复用同一张，避免 GC 抖动。
 *
 * 只借给**确定用完就走**的调用方（逐帧剖析、耗时采样）。返回的这张在下一次
 * `acquireScratch` 同尺寸调用时就会被覆盖，所以不要把它传出去异步使用。
 */
const scratch = new Map<string, HTMLCanvasElement>();

export function acquireScratch(project: Project, scale: number): HTMLCanvasElement {
  const w = Math.max(1, Math.round(project.width * scale));
  const h = Math.max(1, Math.round(project.height * scale));
  const key = `${w}x${h}`;
  let canvas = scratch.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    scratch.set(key, canvas);
  }
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
 * 手动推帧导出（只出 `project.range` 那一段，没有区间就整条）。
 *
 * canvas.captureStream(0) 拿到可手动 requestFrame 的 VideoTrack，逐帧渲染后推一帧。
 * 相比 captureStream(30) 的自动采样，这种方式能保证「内容按 fps 精确推进」。
 *
 * **时长与帧数的取舍**（这条是 v2.15 改的，以前是错的）：
 * MediaRecorder 的帧时间戳取的是 `requestFrame()` 的**墙钟时刻**，不是我们想要的
 * 「第 i 帧应在 i/fps 秒」。所以每帧必须等到它那一格再推。旧实现是「推完 sleep 一帧」，
 * 一旦某帧渲染超过一帧时长，后面的每一帧都往后顺延 —— 误差会累积，
 * 一段 30 秒的片子能导出成 35 秒（画面变慢，像慢放）。
 * 现在的做法是：**对齐绝对时间格**，落后就跳过相应数量的内容帧。
 * 代价是渲染跟不上时会丢帧，换来的是「成片时长永远对得上」——
 * 这也是所有录屏/实时导出工具的取舍，丢帧可以补渲，时长错了得重导。
 */
export async function exportWebm(
  project: Project,
  opts: { fps: number; quality: number; time: number },
  onProgress: (p: number) => void,
): Promise<WebmResult> {
  if (typeof MediaRecorder === 'undefined') throw new Error('当前浏览器不支持 MediaRecorder');
  const fps = Math.min(60, Math.max(1, Math.round(opts.fps || project.fps)));
  const win = exportWindow(project);
  const total = Math.max(1, Math.round(((win.to - win.from) / 1000) * fps));
  const canvas = await renderToCanvas(project, win.from, 1, false);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建导出画布上下文');

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
  if (!track || typeof track.requestFrame !== 'function') {
    throw new Error('当前浏览器不支持 captureStream(0) + requestFrame');
  }

  /*
   * 音频：离线渲染一份（同样只渲区间），然后原样放出来录进同一条 stream。
   * 没有音频层、浏览器不支持、或者渲染失败，都只是「导出成无声视频」——不该让整个导出失败。
   */
  const audio = await createAudioCapture(project, win.ranged ? { in: win.from, out: win.to } : null);
  if (audio) for (const t of audio.stream.getAudioTracks()) stream.addTrack(t);

  const bitrate = Math.round(2_000_000 + (opts.quality / 100) * 10_000_000);
  const recorder = new MediaRecorder(stream, {
    mimeType: pickMime(),
    videoBitsPerSecond: bitrate,
    ...(audio ? { audioBitsPerSecond: 128_000 } : {}),
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();
  const frameDelay = 1000 / fps;
  const anchor = performance.now();
  let dropped = 0;
  for (let i = 0; i < total; ) {
    const slot = anchor + i * frameDelay;
    const now = performance.now();
    if (now < slot) {
      await sleep(slot - now);
    } else if (now - slot >= frameDelay) {
      /* 已经过了至少一整格：这次直接跳到当前该出的一帧上，跳过的算丢帧 */
      const skip = Math.min(total - i - 1, Math.floor((now - slot) / frameDelay));
      dropped += skip;
      i += skip;
    }
    const t = win.from + (i / fps) * 1000;
    await prepareVideos(project, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderScene(ctx, project, { time: t, scale: 1, transparent: false });
    track.requestFrame();
    onProgress((i + 1) / total);
    i += 1;
  }
  // 多推几帧，避免末端被截断
  await sleep(frameDelay * 2);
  recorder.stop();
  await stopped;
  audio?.stop();
  track.stop();

  const blob = new Blob(chunks, { type: 'video/webm' });
  const filename = buildFilename(project, 'webm');
  downloadBlob(blob, filename);
  return { filename, bytes: blob.size, frames: total, dropped, from: win.from, to: win.to };
}

/**
 * 只出声音（16bit PCM WAV）。
 *
 * 用途不是「导出视频时顺便」，而是三条真实需求：
 * 1. 给人声/配乐单独拿一份，进别的剪辑软件；
 * 2. 和「静帧序列」一起交给外部编码器（本机没有 ffmpeg，见 docs/12）；
 * 3. 检查混音 —— WAV 拖进任何工具都能一眼看出削波。
 */
export async function exportWav(
  project: Project,
  opts: { sampleRate?: number } = {},
): Promise<WavResult> {
  const win = exportWindow(project);
  const bytes = await renderWav(project, {
    sampleRate: opts.sampleRate ?? 48000,
    from: win.from,
    to: win.to,
  });
  if (!bytes) throw new Error('音频渲染失败（工程里可能没有任何声音）');
  const blob = blobOf(bytes, 'audio/wav');
  const filename = buildFilename(project, 'wav');
  downloadBlob(blob, filename);
  return { filename, bytes: blob.size, ms: win.to - win.from };
}

/**
 * 出字幕（SRT / VTT）。
 *
 * 时间一律相对导出片段起点 —— 导出的视频从 0 开始，字幕若还按工程时间写，
 * 播放器里会整条错位（而且看起来像「字幕生成错了」）。
 * 没有任何歌词时直接报错，而不是导出一个空文件：空字幕文件比没有更让人困惑。
 */
export function exportSubtitles(
  project: Project,
  opts: { format: SubtitleFormat; granularity: CueGranularity },
): SubtitleResult {
  const lines = lyricsOf(project);
  if (!lines.length) throw new Error('这个工程还没有歌词，没有可导出的字幕');
  const win = exportWindow(project);
  const cues = clipCues(cuesFromLyrics(lines, opts.granularity), win.ranged ? { in: win.from, out: win.to } : null);
  if (!cues.length) throw new Error('当前出片区间里没有落在范围内的歌词');
  const text = formatSubtitles(cues, opts.format);
  const blob = new Blob([text], { type: opts.format === 'vtt' ? 'text/vtt;charset=utf-8' : 'application/x-subrip;charset=utf-8' });
  const filename = buildFilename(project, opts.format);
  downloadBlob(blob, filename);
  return { filename, bytes: blob.size, cues: cues.length, from: win.from, to: win.to };
}

/**
 * 出剪辑表（CMX 3600 EDL）。
 *
 * 只写得出**有源素材**的层（视频/音频/图片）。文本与代码层是算出来的，
 * 没有文件可指 —— 它们在成片里已经烘焙好了，EDL 里列出来只会让剪辑师去找不存在的素材。
 * 有素材但没素材文件的层（比如导入失败）也不算，会在 `skipped` 里说明。
 */
export function exportEdl(project: Project): EdlFileResult {
  const result = buildEdl(project, project.range ?? null);
  const blob = new Blob([result.text], { type: 'text/plain;charset=utf-8' });
  const filename = buildFilename(project, 'edl');
  downloadBlob(blob, filename);
  return {
    filename,
    bytes: blob.size,
    events: result.events,
    skipped: result.skipped.map((s) => ({ name: s.name, reason: s.reason })),
  };
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
  /* 旧版「大 JSON」备份。.kly 现在是 ZIP 工程包（见 core/bundle.ts），
     这里退成 .json：内容还是带外壳的裸工程，不带资源二进制。
     两个格式都能被导入入口认出来（看前 4 字节是不是 PK）。 */
  const json = JSON.stringify(packProject(project), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const filename = buildFilename(project, 'json');
  downloadBlob(blob, filename);
  return { filename, bytes: blob.size };
}

void getImage;
