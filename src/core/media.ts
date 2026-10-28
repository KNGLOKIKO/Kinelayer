/**
 * 剪辑时间语义的唯一实现。
 *
 * 三件事必须只有一份算法，否则预览、导出、时间线显示的片段长度迟早会各说各话：
 *   1. 片段在时间轴上占多长（`clipEnd` / `clipLength`）；
 *   2. 时间轴某一刻对应素材里的哪一刻（`sourceTimeMs`，含 trimIn 与播放速度）；
 *   3. 入点转场的进度，以及上一段该淡到多少（`transitionAt` / `transitionOutAlpha`）。
 *
 * 这一层是**纯函数**，不碰 canvas、不碰 DOM —— 命令层要靠它做 clamp，渲染层要靠它取帧。
 */

import type { AudioLayer, ClipTransition, ImageLayer, Layer, Project, TransitionKind, VideoLayer } from './types';

/** 一次拖拽裁到不足 100ms 的片段，用户既看不见也选不中，直接当误操作 */
export const MIN_CLIP_MS = 100;

/**
 * 转场名字的**翻译键**（中文原文当 key，见 i18n/index.ts）。
 *
 * 放在 core 而不是各自 UI 里：检查器的下拉框和时间轴的转场标记都要显示同一个名字，
 * 两处各写一份迟早会不一致。这里只给 key，取词仍由 UI 层 `t()` 完成。
 */
export const TRANSITION_LABEL_KEY: Record<TransitionKind, string> = {
  crossfade: '叠化',
  dip: '下陷黑场',
  slide: '滑入',
  wipe: '擦除',
};

export function clipEnd(layer: Layer, project: Project): number {
  if (layer.type === 'background') return project.duration;
  return layer.outPoint > 0 ? Math.min(layer.outPoint, project.duration) : project.duration;
}

export function clipLength(layer: Layer, project: Project): number {
  return Math.max(0, clipEnd(layer, project) - layer.inPoint);
}

export function isVisualClip(layer: Layer): layer is ImageLayer | VideoLayer {
  return layer.type === 'image' || layer.type === 'video';
}

export function isTimedMedia(layer: Layer): layer is VideoLayer | AudioLayer {
  return layer.type === 'video' || layer.type === 'audio';
}

/** 转场实际生效的时长：不超过片段长度的一半，免得太短的片段上整段都在转场 */
export function transitionLength(layer: Layer, project: Project): number {
  const tr = (layer as { transition?: ClipTransition | null }).transition;
  if (!tr || tr.duration <= 0) return 0;
  return Math.min(tr.duration, clipLength(layer, project) / 2);
}

/**
 * 时间轴时刻 → 素材内时刻（毫秒）。
 *
 * `trimIn` 是源内偏移，`playbackRate` 是速度：2× 的片段在时间轴上走 1 秒，
 * 素材里要走 2 秒。`loop` 只对视频有意义：素材比片段短时循环，而不是冻在最后一帧。
 */
export function sourceTimeMs(layer: VideoLayer | AudioLayer, projectTime: number, sourceDurationMs?: number): number {
  const rate = layer.type === 'video' ? Math.max(0.1, layer.playbackRate || 1) : 1;
  const raw = Math.max(0, layer.trimIn || 0) + Math.max(0, projectTime - layer.inPoint) * rate;
  const dur = sourceDurationMs && sourceDurationMs > 0 ? sourceDurationMs : 0;
  if (!dur) return raw;
  if (layer.type === 'video' && layer.loop) return raw % dur;
  return Math.min(raw, Math.max(0, dur - 1));
}

/** 本片段入点转场在当前时刻的进度；不在转场窗口内返回 null */
export function transitionAt(layer: Layer, project: Project, time: number): { transition: ClipTransition; p: number } | null {
  const tr = (layer as { transition?: ClipTransition | null }).transition;
  if (!tr) return null;
  const len = transitionLength(layer, project);
  if (len <= 0) return null;
  const dt = time - layer.inPoint;
  if (dt < 0 || dt >= len) return null;
  return { transition: tr, p: dt / len };
}

/**
 * 后一段声明了叠化/下陷时，前一段要**多活多久**。
 *
 * 时间轴上的片段是对接的（前一段 0–4200、后一段 4200–8400），不是叠在一起的。
 * 真正的叠化需要前一段在 4200–4800 期间继续出帧、后一段同时淡入 ——
 * 所以渲染时把前一段的出点临时延长 `transitionLength`，而不是要求用户把两段拖重叠。
 * 用户数据一个字节都不改：延长只发生在渲染这一层。
 */
export function outgoingExtension(project: Project, layer: Layer): number {
  if (!isVisualClip(layer)) return 0;
  const end = clipEnd(layer, project);
  let ext = 0;
  for (const other of project.layers) {
    if (!isVisualClip(other) || other.id === layer.id) continue;
    if (other.inPoint < layer.inPoint) continue;
    if (other.inPoint > end + 1) continue;
    const tr = other.transition;
    if (!tr || (tr.kind !== 'crossfade' && tr.kind !== 'dip')) continue;
    ext = Math.max(ext, transitionLength(other, project));
  }
  return Math.min(ext, Math.max(0, project.duration - end));
}

/**
 * 「我是不是该淡出」—— 给上一段用。
 *
 * 判据不是「时间上有没有重叠」，而是**后一段声明了转场**：用户只在一个片段上设转场，
 * 前一段自动让路。`slide` / `wipe` 是新画面盖上来，前一段保持原样即可，
 * 只有 `crossfade` / `dip` 需要把前一段按同一进度淡下去。
 */
export function transitionOutAlpha(project: Project, layer: Layer, time: number): number {
  if (!isVisualClip(layer)) return 1;
  const end = clipEnd(layer, project);
  let alpha = 1;
  for (const other of project.layers) {
    if (!isVisualClip(other) || other.id === layer.id) continue;
    if (other.inPoint <= layer.inPoint) continue;
    if (other.inPoint > end + 1) continue;
    const tr = other.transition;
    if (!tr || (tr.kind !== 'crossfade' && tr.kind !== 'dip')) continue;
    const len = transitionLength(other, project);
    if (len <= 0) continue;
    const dt = time - other.inPoint;
    if (dt < 0 || dt >= len) continue;
    alpha = Math.min(alpha, 1 - dt / len);
  }
  return Math.max(0, alpha);
}

/**
 * 片段在当前时刻的最终透明度倍率（叠加在图层 opacity 之上）。
 *
 * `dip` 的实现是「新画面从黑里浮上来」：前一段淡出、后一段从 0 淡入，
 * 中间那一刻画面接近全黑 —— 不额外画一张黑场，因为那张黑场会盖住上面所有图层
 * （包括用户放在顶上的字幕），那是错的。
 */
export function clipAlphaAt(project: Project, layer: Layer, time: number): number {
  if (!isVisualClip(layer)) return 1;
  const incoming = transitionAt(layer, project, time);
  const fadeIn = incoming ? (incoming.transition.kind === 'slide' || incoming.transition.kind === 'wipe' ? 1 : incoming.p) : 1;
  return Math.max(0, Math.min(1, fadeIn * transitionOutAlpha(project, layer, time)));
}

/** 转场期间新画面的滑入位移（像素）；非 slide 返回 0 */
export function transitionOffset(layer: Layer, project: Project, time: number): number {
  const at = transitionAt(layer, project, time);
  if (!at || at.transition.kind !== 'slide') return 0;
  return (1 - at.p) * layer.width;
}
