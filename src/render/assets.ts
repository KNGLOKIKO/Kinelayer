import type { AssetMeta } from '@/core/types';
import { idbGetAsset } from '@/persist/idb';

export type Drawable = ImageBitmap | HTMLImageElement;

const images = new Map<string, Drawable>();
const videos = new Map<string, HTMLVideoElement>();
const loading = new Map<string, Promise<Drawable | HTMLVideoElement | null>>();
const missing = new Set<string>();
const listeners = new Set<() => void>();

/* ------------------------------------------------------------------ 音频 */

/**
 * 导入音频的解码缓存。
 *
 * 为什么单独一份而不是塞进 `<audio>` 元素：音频层要能被**离线**渲染
 * （导出时用 OfflineAudioContext 一次性算完），`<audio>` 只能实时播。
 * 解码后的 AudioBuffer 在实时播放与离线混音里都是同一个对象，正好两条路复用。
 */
const audioBuffers = new Map<string, AudioBuffer>();
const audioLoading = new Map<string, Promise<AudioBuffer | null>>();
let decodeCtx: BaseAudioContext | null = null;

function getDecodeCtx(): BaseAudioContext | null {
  if (decodeCtx) return decodeCtx;
  const Offline =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Offline) return null;
  decodeCtx = new Offline(1, 1, 44_100);
  return decodeCtx;
}

export function getAudioBuffer(id: string | null): AudioBuffer | undefined {
  return id ? audioBuffers.get(id) : undefined;
}

/** 解码一份导入音频；失败返回 null（调用方退化成「这一段没声音」，不该整片失败） */
export async function ensureAudioBuffer(id: string): Promise<AudioBuffer | null> {
  const cached = audioBuffers.get(id);
  if (cached) return cached;
  const inflight = audioLoading.get(id);
  if (inflight) return inflight;
  const task = (async () => {
    const ctx = getDecodeCtx();
    if (!ctx) return null;
    const rec = await idbGetAsset(id);
    if (!rec) {
      missing.add(id);
      emit();
      return null;
    }
    try {
      const buf = await ctx.decodeAudioData(await rec.blob.arrayBuffer());
      audioBuffers.set(id, buf);
      return buf;
    } catch {
      return null;
    }
  })();
  audioLoading.set(id, task);
  try {
    return await task;
  } finally {
    audioLoading.delete(id);
  }
}

export async function preloadAudioAssets(assets: AssetMeta[]): Promise<void> {
  await Promise.allSettled(assets.filter((a) => a.kind === 'audio').map((a) => ensureAudioBuffer(a.id)));
}


export function subscribeAssets(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(): void {
  for (const cb of listeners) cb();
}

export function getImage(id: string | null): Drawable | undefined {
  return id ? images.get(id) : undefined;
}

export function getVideo(id: string | null): HTMLVideoElement | undefined {
  return id ? videos.get(id) : undefined;
}

export function isAssetMissing(id: string | null): boolean {
  return !!id && missing.has(id);
}

async function decodeImage(blob: Blob): Promise<Drawable> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片解码失败'));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export async function ensureAsset(id: string, kind: 'image' | 'video'): Promise<Drawable | HTMLVideoElement | null> {
  if (kind === 'image' && images.has(id)) return images.get(id) as Drawable;
  if (kind === 'video' && videos.has(id)) return videos.get(id) as HTMLVideoElement;
  const inflight = loading.get(id);
  if (inflight) return inflight;
  const task = (async () => {
    const rec = await idbGetAsset(id);
    if (!rec) {
      missing.add(id);
      emit();
      return null;
    }
    if (kind === 'image') {
      const drawable = await decodeImage(rec.blob);
      images.set(id, drawable);
      missing.delete(id);
      emit();
      return drawable;
    }
    const url = URL.createObjectURL(rec.blob);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      const onReady = () => resolve();
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('error', () => reject(new Error('视频加载失败')), { once: true });
      setTimeout(() => reject(new Error('视频加载超时')), 8000);
    }).catch(() => undefined);
    videos.set(id, video);
    missing.delete(id);
    emit();
    return video;
  })();
  loading.set(id, task);
  try {
    return await task;
  } finally {
    loading.delete(id);
  }
}

export async function preloadAssets(assets: AssetMeta[]): Promise<void> {
  await Promise.allSettled([
    ...assets
      .filter((a) => a.kind === 'image' || a.kind === 'video')
      .map((a) => ensureAsset(a.id, a.kind as 'image' | 'video')),
    /* 音频顺手解一份：解码是异步的，等用户按下播放再解就会晚半拍出声 */
    ...assets.filter((a) => a.kind === 'audio').map((a) => ensureAudioBuffer(a.id)),
  ]);
}

export function invalidateAsset(id: string): void {
  images.delete(id);
  const v = videos.get(id);
  if (v) {
    v.pause();
    v.removeAttribute('src');
    v.load();
    videos.delete(id);
  }
  audioBuffers.delete(id);
  missing.delete(id);
  emit();
}

export function clearAssetCache(): void {
  for (const v of videos.values()) {
    v.pause();
    v.removeAttribute('src');
  }
  images.clear();
  videos.clear();
  audioBuffers.clear();
  missing.clear();
  emit();
}

/** 视频层由主时钟驱动：只在漂移超过阈值时 seek，保证预览与导出取到同一帧 */
export async function syncVideoTime(video: HTMLVideoElement, timeMs: number): Promise<void> {
  /*
   * 不能因为 duration 非有限就直接放弃：
   * MediaRecorder 录出来的 WebM、以及没有索引的流式文件，duration 是 Infinity，
   * 而它们**必须** seek 一次才会有第一帧（readyState 才会到 HAVE_CURRENT_DATA）。
   * 以前这里 `!Number.isFinite(duration) → return`，结果预览里永远「视频解码中…」，
   * 导出却正常（导出恰好走了别的分支）——这种「只有一条路好使」的 bug 最难查。
   */
  const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const raw = Math.max(0, timeMs / 1000);
  const target = dur ? Math.min(Math.max(0, dur - 0.02), raw) : raw;
  if (Math.abs(video.currentTime - target) < 0.06) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      video.removeEventListener('seeked', done);
      resolve();
    };
    video.addEventListener('seeked', done, { once: true });
    try {
      video.currentTime = target;
    } catch {
      done();
    }
    setTimeout(done, 400);
  });
}
