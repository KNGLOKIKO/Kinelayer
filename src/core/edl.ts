import type { Layer, Project, TimeRange } from './types';
import { isAudio, isImage, isVideo } from './types';

/**
 * CMX 3600 EDL 生成。
 *
 * 为什么是 EDL 而不是 FCPXML：这工程里**没有「源素材 + 素材库」的概念**。
 * 图层是「在某个时间点上画一个东西」，视频只有 `trimIn`，音频可能压根没有文件
 * （程序化音源、人声合成都是算出来的）。FCPXML 要把每个素材登记成 resource 并给出
 * 真实路径，这里没有路径可给，写出来的文件导入剪映后全是离线素材 —— 比没有更糟。
 *
 * EDL 的语义正好匹配：「这一段录机时间用 A 号卷的这几秒」。没有素材的层就**不进 EDL**，
 * 在注释里列出来，并且在 `remux.mjs` 那一侧被明确告知「文字与代码层需要单独烘焙」。
 * 宁可少给，不给假信息。
 */

export interface EdlEvent {
  /** CMX 3600 的卷号，8 字符内。没有真实卷号时统一 AX（auxiliary） */
  reel: string;
  /** V = 画面，A = 声音 */
  track: 'V' | 'A';
  /** 源素材内的时间（毫秒，从素材自身 0 算） */
  sourceIn: number;
  sourceOut: number;
  /** 录机（成片）时间（毫秒，从成片 0 算） */
  recordIn: number;
  recordOut: number;
  /** `* FROM CLIP NAME:` 后面的名字，人看的 */
  clip: string;
  /** 额外注释行（图层名、转场、裁剪） */
  notes: string[];
}

export interface EdlResult {
  text: string;
  events: number;
  /** 没能进 EDL 的图层（程序化内容），数量与名字都给出去，好让人知道缺了什么 */
  skipped: { id: string; name: string; reason: string }[];
}

/** CMX 只支持整数帧率；29.97 / 59.94 这类降级到 29 / 59 并在注释里说明 */
function edlFps(fps: number): { fps: number; note: string | null } {
  const rounded = Math.round(fps);
  if (Math.abs(fps - rounded) < 0.01) return { fps: Math.max(1, rounded), note: null };
  const floored = Math.max(1, Math.floor(fps));
  return {
    fps: floored,
    note: `工程帧率 ${fps} 不是整数，EDL 按 ${floored} fps 写（CMX 3600 不支持丢帧/小数帧率）`,
  };
}

/** `HH:MM:SS:FF`，CMX 的帧号是 0 基 */
export function edlTimecode(ms: number, fps: number): string {
  const total = Math.max(0, Math.round((ms / 1000) * fps));
  const f = total % fps;
  const secs = Math.floor(total / fps);
  const s = secs % 60;
  const m = Math.floor(secs / 60) % 60;
  const h = Math.floor(secs / 3600);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

function layerSpan(layer: Layer, duration: number): { from: number; to: number } {
  const from = Math.max(0, layer.inPoint);
  const to = layer.outPoint > layer.inPoint ? Math.min(layer.outPoint, duration) : duration;
  return { from, to };
}

/**
 * 把工程里的**素材层**翻译成剪辑事件。
 *
 * 只认三种：视频（V）、音频（A）、图片（V，静帧）。
 * 文本 / 代码 / 背景 / 程序化音源 / 人声合成都不进 —— 它们没有源文件，
 * 强行写成一张「黑场 + 备注」的假事件会让剪辑师以为素材丢了。
 */
export function buildEdlEvents(project: Project, range: TimeRange | null | undefined): { events: EdlEvent[]; skipped: EdlResult['skipped'] } {
  const duration = project.duration;
  const win = {
    from: range ? Math.max(0, range.in) : 0,
    to: range ? Math.min(duration, range.out) : duration,
  };
  const byId = new Map(project.assets.map((a) => [a.id, a]));
  const events: EdlEvent[] = [];
  const skipped: EdlResult['skipped'] = [];

  for (const layer of project.layers) {
    const span = layerSpan(layer, duration);
    if (span.to <= win.from || span.from >= win.to) continue;

    if (isVideo(layer) || isImage(layer)) {
      const asset = layer.assetId ? byId.get(layer.assetId) : undefined;
      if (!asset) {
        skipped.push({ id: layer.id, name: layer.name, reason: '没有素材' });
        continue;
      }
      const clipIn = isVideo(layer) ? Math.max(0, layer.trimIn) : 0;
      const offset = Math.max(0, win.from - span.from);
      const recIn = Math.max(span.from, win.from) - win.from;
      const recOut = Math.min(span.to, win.to) - win.from;
      const notes = [`KINELAYER LAYER: ${layer.name}`];
      if (layer.transition) notes.push(`转场: ${layer.transition.kind} ${layer.transition.duration}ms`);
      if (isVideo(layer) && layer.playbackRate !== 0 && layer.playbackRate !== 1) {
        notes.push(`速度: ${layer.playbackRate}x（EDL 表达不了，成片需另做 retime）`);
      }
      events.push({
        reel: 'AX',
        track: 'V',
        sourceIn: clipIn + offset,
        sourceOut: clipIn + offset + (recOut - recIn),
        recordIn: recIn,
        recordOut: recOut,
        clip: asset.name || layer.name,
        notes,
      });
      continue;
    }

    if (isAudio(layer)) {
      const asset = layer.assetId ? byId.get(layer.assetId) : undefined;
      if (!asset) {
        skipped.push({
          id: layer.id,
          name: layer.name,
          reason: layer.voice ? '人声合成，无源文件' : '程序化音源，无源文件',
        });
        continue;
      }
      const clipIn = Math.max(0, layer.trimIn);
      const offset = Math.max(0, win.from - span.from);
      const recIn = Math.max(span.from, win.from) - win.from;
      const recOut = Math.min(span.to, win.to) - win.from;
      events.push({
        reel: 'AX',
        track: 'A',
        sourceIn: clipIn + offset,
        sourceOut: clipIn + offset + (recOut - recIn),
        recordIn: recIn,
        recordOut: recOut,
        clip: asset.name || layer.name,
        notes: [`KINELAYER LAYER: ${layer.name}`],
      });
      continue;
    }

    if (layer.type !== 'background') {
      skipped.push({
        id: layer.id,
        name: layer.name,
        reason: layer.type === 'text' ? '文本层，成片里已烘焙' : layer.type === 'code' ? '代码层，成片里已烘焙' : '无源素材',
      });
    }
  }

  events.sort((a, b) => a.recordIn - b.recordIn || (a.track === b.track ? 0 : a.track === 'V' ? -1 : 1));
  return { events, skipped };
}

/**
 * 生成整份 EDL 文本。
 *
 * 事件编号从 001 起；同一时刻的画面排在声音前面（剪辑软件按此顺序建轨）。
 * 注释行（`*` 开头）不是标准 EDL 的一部分，但 Premiere / DaVinci / 剪映都会忽略它们，
 * 而人靠它们才能知道这一条是从哪个图层来的。
 */
export function buildEdl(project: Project, range: TimeRange | null | undefined): EdlResult {
  const { fps, note } = edlFps(project.fps);
  const { events, skipped } = buildEdlEvents(project, range);
  const win = {
    from: range ? Math.max(0, range.in) : 0,
    to: range ? Math.min(project.duration, range.out) : project.duration,
  };

  const lines: string[] = [];
  lines.push(`TITLE: ${(project.name || 'kinelayer').replace(/[\r\n]+/g, ' ').slice(0, 70)}`);
  lines.push('FCM: NON-DROP FRAME');
  lines.push(`* KINELAYER EDL — ${fps} fps，成片 ${edlTimecode(win.to - win.from, fps)}`);
  if (range) {
    lines.push(`* 出片区间: ${edlTimecode(range.in, fps)} → ${edlTimecode(range.out, fps)}（已对齐到 0）`);
  }
  if (note) lines.push(`* ${note}`);
  if (skipped.length) {
    lines.push('* 未进 EDL 的图层（没有源素材，成片已烘焙）:');
    for (const s of skipped) lines.push(`*   - ${s.name}：${s.reason}`);
  }
  lines.push('');

  events.forEach((ev, i) => {
    const num = String(i + 1).padStart(3, '0');
    lines.push(
      `${num}  ${ev.reel.padEnd(8, ' ')} ${ev.track.padEnd(5, ' ')} ${'C'.padEnd(8, ' ')} ${edlTimecode(
        ev.sourceIn,
        fps,
      )} ${edlTimecode(ev.sourceOut, fps)} ${edlTimecode(ev.recordIn, fps)} ${edlTimecode(ev.recordOut, fps)}`,
    );
    lines.push(`* FROM CLIP NAME: ${ev.clip.replace(/[\r\n]+/g, ' ')}`);
    for (const n of ev.notes) lines.push(`* ${n}`);
    lines.push('');
  });

  return { text: `${lines.join('\n').trimEnd()}\n`, events: events.length, skipped };
}

/** 给文件名用的扩展名。剪辑表可能是 EDL，也可能是 FCPXML —— 现在只有前者 */
export function edlExtension(): string {
  return 'edl';
}
