import type { LyricLine, TimeRange } from './types';
import { lyricUnits } from './score';

/**
 * 字幕文件的读写：SRT / WebVTT。
 *
 * 为什么不是「顺手把 LRC 换个壳」——三种格式看起来都是「时间 + 文本」，但用途不同：
 * - LRC 是**歌词**：一行一句、可以在播放器里高亮当前行，时间只有到 10 毫秒；
 * - SRT 是**字幕**：可以一句拆成多条、可以带换行，播放器按条显示，时间到毫秒；
 * - VTT 是 SRT 的浏览器版：句点分隔毫秒、支持 `<c>` 这类内联样式和 cue 设置。
 *
 * 这个工程有逐字时间（`lyricUnits`），所以字幕能出**逐字版**——短视频平台要的正是它。
 * 反过来，导入 SRT/VTT 只是「一行一句」的信息量，逐字时间得靠原有歌词，不能凭空发明。
 */

export type SubtitleFormat = 'srt' | 'vtt';

/** 一条字幕。时间都是**相对导出片段起点**的毫秒（导出的视频从 0 开始） */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

/** 逐字的粒度：整行一次出完，还是一个单元一条（卡拉 OK / 短视频） */
export type CueGranularity = 'line' | 'unit';

function pad(n: number, width = 2): string {
  return String(Math.max(0, Math.floor(n))).padStart(width, '0');
}

/** `HH:MM:SS,mmm`（SRT）或 `HH:MM:SS.mmm`（VTT） */
export function timecodeOf(ms: number, format: SubtitleFormat = 'srt'): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const f = t % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${format === 'vtt' ? '.' : ','}${pad(f, 3)}`;
}

/** 解析 `[[HH:]MM:]SS[.,]mmm`；认不出来返回 null（不猜） */
export function parseTimecode(raw: string): number | null {
  const m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(raw.trim());
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const sec = Number(m[3]);
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  if (min > 59 || sec > 59) return null;
  return h * 3_600_000 + min * 60_000 + sec * 1000 + ms;
}

/** 从歌词生成字幕条。`unit` 模式跳过纯标点单元 —— 一闪而过的顿号不是字幕 */
export function cuesFromLyrics(lines: LyricLine[], granularity: CueGranularity = 'line'): Cue[] {
  const out: Cue[] = [];
  for (const line of lines) {
    if (granularity === 'line') {
      const text = line.text.trim();
      if (text && line.end > line.start) out.push({ start: line.start, end: line.end, text });
      continue;
    }
    for (const unit of lyricUnits(line)) {
      const text = unit.text.trim();
      if (!text || unit.end <= unit.start) continue;
      if (!/[\p{L}\p{N}]/u.test(text)) continue;
      out.push({ start: unit.start, end: unit.end, text });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/**
 * 把字幕条裁到导出区间内，并把时间轴挪到 0。
 *
 * 挪到 0 是必须的：导出的视频文件从 0 开始，字幕若还按工程时间写，
 * 播放器里会整条错位 —— 而且错得很像「字幕生成错了」，不是一眼能看出的那种。
 */
export function clipCues(cues: Cue[], range: TimeRange | null | undefined): Cue[] {
  if (!range) return cues;
  const shift = range.in;
  return cues
    .filter((c) => c.end > range.in && c.start < range.out)
    .map((c) => ({
      text: c.text,
      start: Math.max(c.start, range.in) - shift,
      end: Math.min(c.end, range.out) - shift,
    }))
    .filter((c) => c.end > c.start);
}

export function formatSrt(cues: Cue[]): string {
  const blocks = cues.map((c, i) => {
    const body = c.text.replace(/\r/g, '').trim();
    return `${i + 1}\n${timecodeOf(c.start, 'srt')} --> ${timecodeOf(c.end, 'srt')}\n${body}`;
  });
  /* 末尾留一个空行：多数播放器容忍没有，但有的解析器把最后一块当截断 */
  return `${blocks.join('\n\n')}\n`;
}

export function formatVtt(cues: Cue[]): string {
  const blocks = cues.map((c) => {
    const body = c.text.replace(/\r/g, '').trim();
    return `${timecodeOf(c.start, 'vtt')} --> ${timecodeOf(c.end, 'vtt')}\n${body}`;
  });
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`;
}

export function formatSubtitles(cues: Cue[], format: SubtitleFormat): string {
  return format === 'vtt' ? formatVtt(cues) : formatSrt(cues);
}

/**
 * 解析 SRT / VTT。
 *
 * 宽松策略：BOM 去掉、CRLF 归一、序号行可有可无、cue 设置（`align:start`）忽略、
 * VTT 的 `<c>`/`<b>` 标签剥掉、`NOTE` 与 `STYLE` 块跳过。
 * 唯一不做的事是「猜时间」：认不出时间码的块直接丢掉，不按平均长度补。
 */
export function parseSubtitles(text: string, duration: number): LyricLine[] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const out: LyricLine[] = [];
  for (const block of clean.split(/\n{2,}/)) {
    const rows = block.split('\n').filter((row) => row.trim() !== '');
    if (!rows.length) continue;
    const head = rows[0]!.trim();
    if (/^WEBVTT/i.test(head) || /^NOTE\b/i.test(head) || /^STYLE$/i.test(head) || /^REGION$/i.test(head)) continue;
    const arrow = rows.findIndex((row) => row.includes('-->'));
    if (arrow < 0) continue;
    const [left, right] = rows[arrow]!.split('-->');
    const start = parseTimecode(left ?? '');
    /* 右侧可能带着 cue 设置：`00:00:05.000 align:start line:80%` */
    const end = parseTimecode((right ?? '').trim().split(/\s+/)[0] ?? '');
    if (start === null || end === null || end <= start) continue;
    const body = rows
      .slice(arrow + 1)
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!body) continue;
    out.push({
      text: body.slice(0, 400),
      start: Math.max(0, Math.min(start, duration)),
      end: Math.max(0, Math.min(end, duration)),
    });
  }
  return out.filter((l) => l.end > l.start).sort((a, b) => a.start - b.start);
}

/** 只认结构，不读内容：用来给导入入口决定走哪条解析器 */
export function detectSubtitleFormat(text: string): 'srt' | 'vtt' | 'lrc' | null {
  const clean = text.slice(0, 4000).replace(/^\uFEFF/, '');
  if (/^WEBVTT/i.test(clean.trimStart())) return 'vtt';
  if (/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/.test(clean)) return 'lrc';
  if (/\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/.test(clean)) return 'srt';
  if (/\d{1,2}:\d{2}[.,]\d{1,3}\s*-->/.test(clean)) return 'vtt';
  return null;
}
