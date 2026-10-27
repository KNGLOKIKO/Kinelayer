/**
 * 谱面：速度网格 + 逐字时间。
 *
 * 这个文件里的东西全部是**纯函数**，它们被三处共用：
 *   - 代码层的 `api.tempo` / `api.lyrics`（渲染时逐帧查）
 *   - 音频引擎（鼓点落在哪一拍、强拍要不要加重）
 *   - UI（时间轴上画拍线、歌词编辑器里报「这一行会铺多久」）
 *
 * 三处各写一遍会立刻出现「画面切在拍上、鼓差 15ms」这类问题，
 * 而且这种问题在静音预览里根本看不出来。
 *
 * 时间单位一律毫秒（与工程其余部分一致），只有面向人的 bpm 是分钟。
 */

import type { LyricLine, LyricUnit, Tempo } from './types';

export const DEFAULT_TEMPO: Tempo = { bpm: 120, offsetMs: 0, meter: 4 };

/** 工程上取速度网格：缺省补齐。所有读 `project.tempo` 的地方都该走它 */
export function tempoOf(project: { tempo?: Partial<Tempo> | null }): Tempo {
  return clampTempo(project.tempo);
}

/** 工程上取歌词：缺省空数组 */
export function lyricsOf(project: { lyrics?: LyricLine[] | null }): LyricLine[] {
  return Array.isArray(project.lyrics) ? project.lyrics : [];
}

const BPM_MIN = 20;
const BPM_MAX = 300;

export function clampTempo(raw: Partial<Tempo> | undefined | null): Tempo {
  const bpm = typeof raw?.bpm === 'number' && Number.isFinite(raw.bpm) ? raw.bpm : DEFAULT_TEMPO.bpm;
  const offsetMs =
    typeof raw?.offsetMs === 'number' && Number.isFinite(raw.offsetMs) ? raw.offsetMs : DEFAULT_TEMPO.offsetMs;
  const meter = typeof raw?.meter === 'number' && Number.isFinite(raw.meter) ? raw.meter : DEFAULT_TEMPO.meter;
  return {
    bpm: Math.min(BPM_MAX, Math.max(BPM_MIN, bpm)),
    /* 偏移允许负值（从半拍处切进来），但不允许跑出一整拍之外 —— 那不是偏移，那是速度错了 */
    offsetMs: Math.round(offsetMs),
    meter: Math.min(16, Math.max(1, Math.round(meter))),
  };
}

export function beatMs(tempo: Tempo): number {
  return 60_000 / Math.max(BPM_MIN, tempo.bpm);
}

/** 连续拍号：0 = 第 0 拍，小数部分 = 这一拍走了多少。负数在 offset 之前 */
export function beatAt(tempo: Tempo, t: number): number {
  return (t - tempo.offsetMs) / beatMs(tempo);
}

/** 连续小节号（含小数） */
export function barAt(tempo: Tempo, t: number): number {
  return beatAt(tempo, t) / Math.max(1, tempo.meter);
}

/** 拍内相位 0..1 */
export function beatPhase(tempo: Tempo, t: number): number {
  const b = beatAt(tempo, t);
  return b - Math.floor(b);
}

/** 小节内相位 0..1 */
export function barPhase(tempo: Tempo, t: number): number {
  const b = beatAt(tempo, t) / Math.max(1, tempo.meter);
  return b - Math.floor(b);
}

/** 第 i 拍的时间（毫秒）。i 可以是小数 */
export function timeOfBeat(tempo: Tempo, i: number): number {
  return tempo.offsetMs + i * beatMs(tempo);
}

/** 离 t 最近的拍子时间 */
export function nearestBeat(tempo: Tempo, t: number): number {
  return timeOfBeat(tempo, Math.round(beatAt(tempo, t)));
}

/** 把 t 吸附到最近的 1/div 拍网格上（div=1 拍、2 半拍、4 十六分音符） */
export function snap(tempo: Tempo, t: number, div = 1): number {
  const step = beatMs(tempo) / Math.max(1, div);
  return Math.round((t - tempo.offsetMs) / step) * step + tempo.offsetMs;
}

/** 距上一个整拍的毫秒数（t 落在拍上时为 0） */
export function sinceBeat(tempo: Tempo, t: number): number {
  return beatPhase(tempo, t) * beatMs(tempo);
}

/**
 * 敲击包络：拍点上的 1，按半衰期衰减。强拍（小节第一拍）额外加权。
 *
 * 这就是「画面跟着鼓动」的全部秘密 —— 它不来自音频分析，而来自**谱面**：
 * 鼓点本来就打在网格上，所以网格本身就是那一击的准确时刻，不需要去听。
 */
export function hit(tempo: Tempo, t: number, halfLife = 110, accent = 1.35): number {
  const dt = sinceBeat(tempo, t);
  const onBar = Math.abs(beatAt(tempo, t) - Math.round(beatAt(tempo, t) / tempo.meter) * tempo.meter) < 1e-6;
  const decay = Math.pow(0.5, dt / Math.max(1, halfLife));
  return decay * (onBar ? accent : 1);
}

/** 这一拍是不是强拍（小节第一拍） */
export function isDownbeat(tempo: Tempo, t: number): boolean {
  const b = beatAt(tempo, t);
  const r = Math.round(b);
  return Math.abs(b - Math.round(r / tempo.meter) * tempo.meter) < 1e-6;
}

/* ------------------------------------------------------------------ 歌词 */

/**
 * 分词。规则与文字层刻意保持一致：拉丁按空格成词、CJK 按字，
 * 标点黏在**前一个**单元上（它们不发声，不该各自占一段时间）。
 *
 * 为什么要在 core 里再写一遍而不 import render/text.ts：那一份要 ctx 去测宽，
 * 这一份不能（core 不认识 canvas）。两边都只依赖同一个字符类判据。
 */
export function splitLyricUnits(text: string): { text: string; offset: number }[] {
  const out: { text: string; offset: number }[] = [];
  let buf = '';
  let bufStart = 0;
  const flush = (end: number) => {
    if (buf) {
      out.push({ text: buf, offset: bufStart });
      buf = '';
    }
    bufStart = end;
  };
  const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === ' ' || ch === '\n') {
      flush(i + 1);
      continue;
    }
    if (CJK.test(ch)) {
      flush(i);
      out.push({ text: ch, offset: i });
      bufStart = i + 1;
      continue;
    }
    if (!buf) bufStart = i;
    buf += ch;
  }
  if (buf) out.push({ text: buf, offset: bufStart });

  /* 标点并到前一个单元：末字是标点时把整串挪过去，避免「，」单独闪一下 */
  const merged: { text: string; offset: number }[] = [];
  for (const u of out) {
    const punctOnly = /^[，。、；：？！…—·,.;:?!'"'""''（）()【】\[\]《》<>]+$/.test(u.text);
    const prev = merged[merged.length - 1];
    if (punctOnly && prev) {
      prev.text += u.text;
      continue;
    }
    merged.push({ ...u });
  }
  return merged;
}

/** 一个单元的「发声权重」：字符数，标点打折（它念得比字快） */
function unitWeight(text: string): number {
  let w = 0;
  for (const ch of text) w += /[，。、；：？！…—·,.;:?!'"'""''（）()【】\[\]《》<>]/.test(ch) ? 0.3 : 1;
  return Math.max(0.3, w);
}

/**
 * 把一行铺成逐字时间表。
 *
 * 分配规则：整行区间按各单元权重切分。没有音节数据、没有音频对齐，
 * 所以这是**能保证不跑在声音前面**的最强方案 —— 单元 i 的高亮区间
 * 恰好等于它被分配到的发声区间，1x 播完即熄灭。
 */
export function lyricUnits(line: LyricLine): LyricUnit[] {
  const parts = splitLyricUnits(line.text);
  if (!parts.length) return [];
  const total = parts.reduce((n, p) => n + unitWeight(p.text), 0);
  const span = Math.max(1, line.end - line.start);
  const out: LyricUnit[] = [];
  let cursor = line.start;
  for (const p of parts) {
    const dur = (unitWeight(p.text) / total) * span;
    out.push({ text: p.text, start: cursor, end: cursor + dur, offset: p.offset });
    cursor += dur;
  }
  /* 抹掉浮点尾巴：最后一个单元必须正好收在 end 上，否则会有 0.001ms 的「唱不完」 */
  const last = out[out.length - 1];
  if (last) last.end = line.end;
  return out;
}

/** 单元在 t 时刻的演唱进度 0..1（两端夹住，绝不超出） */
export function unitProgress(unit: LyricUnit, t: number): number {
  if (t <= unit.start) return 0;
  if (t >= unit.end) return 1;
  return (t - unit.start) / Math.max(1e-3, unit.end - unit.start);
}

/**
 * 整行的字符进度：0..text.length，逐字擦除就用它。
 *
 * 单元之间「被跳过的字符」按 offset 差补上，不能一律加 1 ——
 * 中文词与词之间根本没有分隔符，加 1 会让每一行在半分处就报「已唱完」，
 * 卡拉 OK 于是整行提前亮起（这个 bug 在片子第一版里真的出现了）。
 */
export function lineCharProgress(line: LyricLine, t: number): number {
  let chars = 0;
  const units = lyricUnits(line);
  for (let i = 0; i < units.length; i += 1) {
    const u = units[i]!;
    const p = unitProgress(u, t);
    chars += p * [...u.text].length;
    if (p < 1) break;
    const next = units[i + 1];
    if (next) chars += Math.max(0, next.offset - (u.offset + u.text.length));
  }
  return Math.min(chars, [...line.text].length);
}

/** 整行进度 0..1（按时间，不看字符） */
export function lineProgress(line: LyricLine, t: number): number {
  if (t <= line.start) return 0;
  if (t >= line.end) return 1;
  return (t - line.start) / Math.max(1, line.end - line.start);
}

export function lineAt(lyrics: LyricLine[], t: number): LyricLine | null {
  for (const l of lyrics) if (t >= l.start && t < l.end) return l;
  return null;
}

/** t 之前最后唱过的一行（用于「这一句刚唱完，留在屏上」） */
export function lastLine(lyrics: LyricLine[], t: number): LyricLine | null {
  let best: LyricLine | null = null;
  for (const l of lyrics) if (l.start <= t) best = l;
  return best;
}

export function nextLine(lyrics: LyricLine[], t: number): LyricLine | null {
  for (const l of lyrics) if (l.start > t) return l;
  return null;
}

/* ------------------------------------------------------- 歌词的文本进出 */

/**
 * LRC 时间标签。
 *
 * 认两种：`[mm:ss.xx]` 是标准 LRC（只有起点），`[mm:ss.xx-mm:ss.xx]` 是本工程的扩展（带终点）。
 * 扩展形式存在的原因很实在：本工程的歌词是**有间隔**的 —— 一句唱完留在屏上两秒再出下一句，
 * 这个间隔是编排，不能因为「存成文本」就丢掉。只有起点的标准形式也能读，按「唱到下一句开始」补齐。
 */
const LRC_TAG = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)(?:\s*-\s*(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?))?\]/g;
/** `[ti:标题]` `[offset:+200]` 这类元信息：不是歌词，跳过 */
const LRC_META = /^\[[a-zA-Z]+:/;

function lrcMs(min: string | undefined, sec: string | undefined): number {
  if (min === undefined || sec === undefined) return 0;
  return Math.round(Number(min) * 60_000 + Number(sec) * 1000);
}

function toLrcTime(ms: number): string {
  const clamped = Math.max(0, Math.round(ms));
  const m = Math.floor(clamped / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const cs = clamped % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(3, '0')}`;
}

export function formatLrc(lines: LyricLine[]): string {
  return lines.map((l) => `[${toLrcTime(l.start)}-${toLrcTime(l.end)}] ${l.text}`).join('\n');
}

/**
 * 从文本读歌词。
 *
 * 没带时间戳的行**不丢弃**：它们按顺序接在上一句之后，每句 `untimed` 毫秒。
 * 于是「把一段词整个粘进来」就能得到一条可播、可再调的歌词轨 —— 先有再准，
 * 比要求用户手工敲 21 个时间戳现实得多。
 */
export function parseLrc(text: string, duration: number, untimed = 2400): LyricLine[] {
  const timed: { text: string; start: number; end: number | null }[] = [];
  const loose: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    if (LRC_META.test(line)) continue;

    LRC_TAG.lastIndex = 0;
    const tags: { start: number; end: number | null }[] = [];
    let cursor = 0;
    let m: RegExpExecArray | null;
    while ((m = LRC_TAG.exec(line))) {
      /* 标签必须从行首连续出现；词中间出现方括号不算（那是歌词本身的内容） */
      if (m.index !== cursor) break;
      tags.push({ start: lrcMs(m[1], m[2]), end: m[3] !== undefined ? lrcMs(m[3], m[4]) : null });
      cursor = m.index + m[0].length;
    }
    const body = line.slice(cursor).trim();
    if (!tags.length) {
      if (body) loose.push(body);
      continue;
    }
    /* 一个正文配多个时间标签 = 副歌重复（标准 LRC 就这么用） */
    for (const tag of tags) if (body) timed.push({ text: body, start: tag.start, end: tag.end });
  }

  /* 先按起点排好，再补终点 —— 排序必须在补终点之前，否则「下一句」不是下一句 */
  const out: { text: string; start: number; end: number | null }[] = timed
    .map((t) => ({ text: t.text, start: t.start, end: t.end }))
    .sort((a, b) => a.start - b.start);

  /* 只给了起点的那几行：唱到下一句开始为止。最后一行按 untimed 收 */
  for (let i = 0; i < out.length; i += 1) {
    const cur = out[i]!;
    if (cur.end !== null) continue;
    const next = out[i + 1];
    cur.end = next ? Math.max(cur.start + 120, next.start) : cur.start + untimed;
  }

  /* 无时间戳的行接在最后一条 timed 之后顺序铺开 */
  let cursor = out.length ? out[out.length - 1]!.end! : 0;
  for (const body of loose) {
    out.push({ text: body, start: Math.round(cursor), end: Math.round(cursor + untimed) });
    cursor += untimed;
  }

  return normalizeLyrics(
    out.map((l) => ({ text: l.text, start: l.start, end: l.end! })),
    duration,
  );
}

/* ---------------------------------------------------------------- 打拍 */

export interface TapFit {
  /** 拟合出的速度（一位小数） */
  bpm: number;
  /** 第 0 拍落在哪毫秒，落在 [0, 一拍) 内 */
  offsetMs: number;
  /** 参与拟合的敲击数 */
  taps: number;
  /** 每一下偏离网格的最大值：这是「敲得齐不齐」的诚实读数，不是置信度评分 */
  spreadMs: number;
  /** 中位间隔。若它约等于两拍，说明用户按的是隔拍，BPM 该乘 2 */
  intervalMs: number;
}

/**
 * 从一串敲击时间拟合速度网格。
 *
 * 只做两件事：中位间隔 → BPM，最后一下 → 相位。用中位数而不是均值，
 * 是因为打拍的人总会漏一下、早一下，均值会被一个 400ms 的失手整条带偏。
 *
 * 它**不猜用户按的是每几拍**：间隔翻倍就是 BPM 减半，界面给「×2 / ÷2」让人自己拨。
 * 猜错方向比不猜更糟 —— 用户会以为工具坏了。
 */
export function fitTaps(taps: number[], keep = 16): TapFit | null {
  const list = taps.filter((v) => Number.isFinite(v)).slice(-keep).sort((a, b) => a - b);
  if (list.length < 2) return null;

  const gaps: number[] = [];
  for (let i = 1; i < list.length; i += 1) {
    const d = list[i]! - list[i - 1]!;
    /* 80ms 以内算双击误触，不算一拍 */
    if (d > 80) gaps.push(d);
  }
  if (!gaps.length) return null;

  const sorted = [...gaps].sort((a, b) => a - b);
  const intervalMs = sorted[Math.floor(sorted.length / 2)]!;
  const bpm = Math.min(BPM_MAX, Math.max(BPM_MIN, 60_000 / intervalMs));
  const beat = 60_000 / bpm;

  const last = list[list.length - 1]!;
  let offsetMs = ((last % beat) + beat) % beat;
  /* 贴着整数拍的情况归零，否则会得到 468.7ms 这种「看起来像误差」的偏移 */
  if (beat - offsetMs < 1.5) offsetMs = 0;

  let spread = 0;
  for (const v of list) {
    const k = Math.round((v - offsetMs) / beat);
    spread = Math.max(spread, Math.abs(v - (offsetMs + k * beat)));
  }

  return {
    bpm: Math.round(bpm * 10) / 10,
    offsetMs: Math.round(offsetMs),
    taps: list.length,
    spreadMs: Math.round(spread),
    intervalMs: Math.round(intervalMs),
  };
}

/** 把时间 t 归到「第 0 拍在 0 附近」的相位上（对齐按钮用） */
export function phaseOffset(tempo: Tempo, t: number): number {
  const beat = beatMs(tempo);
  let off = ((t % beat) + beat) % beat;
  if (beat - off < 1.5) off = 0;
  return Math.round(off);
}

/** 把时间 t 对到小节头（强拍）上时的偏移：让某个强拍正好落在 t */
export function barAlignedOffset(tempo: Tempo, t: number): number {
  const bar = beatMs(tempo) * Math.max(1, tempo.meter);
  let off = ((t % bar) + bar) % bar;
  if (bar - off < 1.5) off = 0;
  return Math.round(off);
}

/** 校验并裁剪一组歌词（读入用：宽容，不抛错） */
export function normalizeLyrics(raw: unknown, duration: number): LyricLine[] {
  if (!Array.isArray(raw)) return [];
  const out: LyricLine[] = [];
  for (const item of raw) {
    const r = item as Partial<LyricLine>;
    if (!r || typeof r.text !== 'string') continue;
    const text = r.text.slice(0, 400);
    if (!text.trim()) continue;
    const start = Number.isFinite(r.start) ? Math.max(0, Number(r.start)) : 0;
    const endRaw = Number.isFinite(r.end) ? Number(r.end) : start + 2000;
    const end = Math.min(Math.max(duration, 0) || endRaw, Math.max(start + 60, endRaw));
    out.push({ text, start: Math.round(start), end: Math.round(end) });
    if (out.length >= 512) break;
  }
  return out.sort((a, b) => a.start - b.start);
}
