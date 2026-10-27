/**
 * 音频引擎。
 *
 * 一件事：把「工程时间轴上的音频图层」变成「耳朵里的声音」，并且**和主时钟同一根时间轴**。
 *
 * 三条设计约束，都是踩过的坑：
 *
 * 1. **不许自己走时钟**。抖动来自两处时钟（rAF 的 playhead 与 AudioContext 的 currentTime），
 *    各走各的，播两分钟就能差出几百毫秒。做法是启动时记一个锚点 `(anchorCtx, fromMs)`，
 *    之后所有事件时间都由锚点算；主时钟发现漂移超过阈值就重锚（= 判定发生了 seek）。
 * 2. **不许阻塞播放**。任何 WebAudio 调用都可能因为「页面还没拿到用户手势」而失败，
 *    全部吞掉 —— 没声音是能接受的降级，播放崩掉不能接受。
 * 3. **排程要 lookahead**。setInterval 本身不准，所以每次 tick 都往后补 1.2 秒事件。
 *    tick 本身走 Web Worker —— 后台标签页里 window.setInterval 会被降到 1 秒一次，
 *    主线程定时器撑不住 1.2 秒的窗口，Worker 不受这个限制。
 *    这个做法直接借自 Tone.js 的 `Tone/core/clock/Ticker.ts`（它用 Blob 造 Worker 做计时器），
 *    连「Worker 不可用时退回 setTimeout」的降级层级都一样。
 *
 * 合成器只做三种预设（pad / pulse / chime），因为示例工程要求零外部资源。
 * 将来接音频文件时，在 `scheduleRange` 的 preset 分支旁边加一个「解码 AudioBuffer
 * 后从 inPoint 播放」的分支即可 —— 主时钟、导出、波形这三条链路一行都不用改。
 */

import type { AudioLayer, Layer, Project } from '../core/types';

/** 每次 tick 往后排多远（秒）。后台被节流到 1 秒一次也不至于断音 */
const LOOKAHEAD = 1.2;
const TICK_MS = 200;
/** 主时钟与音频锚点差多少就判定「发生了 seek」，需要重锚（毫秒） */
const DRIFT_TOLERANCE = 400;
/** 提示音的尾巴长度（毫秒）：bell 的衰减写死在这里，describeAudioAt 要跟它对齐 */
const BELL_TAIL_MS = 1300;
const MASTER_GAIN = 0.9;

/**
 * 排程只需要这两样东西，不必吃整个 Project —— 试听、离线渲染时就能造一个临时宿主。
 */
export interface AudioHost {
  duration: number;
  layers: Layer[];
}

/** 一条音频链需要的全部上下文。实时预览与离线渲染共用同一套合成代码 */
interface Mixer {
  ctx: BaseAudioContext;
  master: GainNode;
  noise: AudioBuffer;
}

interface Graph extends Mixer {
  ctx: AudioContext;
  /** 导出时挂上来的录音出口；平时为 null */
  capture: MediaStreamAudioDestinationNode | null;
}

interface Session {
  /** 工程 fromMs 对应的 ctx.currentTime */
  anchorCtx: number;
  fromMs: number;
  /** 已经排到哪个工程时刻（毫秒） */
  cursorMs: number;
  /** 已经起过声的 pad 图层 id —— pad 是长音，不能每 tick 叠一层 */
  started: Set<string>;
}

let graph: Graph | null = null;
let session: Session | null = null;
let ticker: { stop: () => void } | null = null;
/** 已排程、还没结束的源节点，stop 时统一掐掉 */
let live: AudioScheduledSourceNode[] = [];
let host: AudioHost | null = null;

function audioLayers(hostProject: AudioHost): AudioLayer[] {
  return hostProject.layers.filter((l): l is AudioLayer => l.type === 'audio' && l.visible !== false);
}

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.2), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  return buf;
}

function ensureGraph(): Graph | null {
  if (graph) return graph;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
    graph = { ctx, master, noise: makeNoise(ctx), capture: null };
    return graph;
  } catch {
    return null;
  }
}

/** 图层在工程时间轴上的绝对区间（毫秒）。outPoint 不大于 inPoint 时视为「到结尾」 */
function span(layer: AudioLayer, duration: number): { start: number; end: number } {
  const start = Math.max(0, layer.inPoint);
  const end = layer.outPoint > start ? Math.min(layer.outPoint, duration) : duration;
  return { start, end };
}

/** 图层增益：音量 × 静音 × 淡入淡出包络（入参是相对图层起点的本地时间） */
function envelopeAt(layer: AudioLayer, localMs: number, lengthMs: number): number {
  if (layer.muted) return 0;
  const fadeIn = Math.min(layer.fadeIn, lengthMs * 0.8);
  const fadeOut = Math.min(layer.fadeOut, lengthMs * 0.8);
  let g = 1;
  if (fadeIn > 0 && localMs < fadeIn) g = localMs / fadeIn;
  const tail = lengthMs - localMs;
  if (fadeOut > 0 && tail < fadeOut) g = Math.min(g, Math.max(0, tail / fadeOut));
  return Math.max(0, Math.min(1, g)) * Math.max(0, Math.min(1, layer.volume));
}

function track(node: AudioScheduledSourceNode): void {
  /* 离线渲染的节点属于另一个上下文，别记进「实时要掐掉的」名单里 —— 否则那份名单会一直涨 */
  if (!graph || node.context !== graph.ctx) return;
  live.push(node);
  node.onended = () => {
    live = live.filter((n) => n !== node);
  };
}

/* ------------------------------------------------------------------ 合成 */

/** 长音铺底：每个和弦音两只略微失谐的三角波，过低通，再用慢 LFO 让音色呼吸 */
function emitPad(m: Mixer, layer: AudioLayer, atCtx: number, localMs: number, lengthMs: number): void {
  const level = envelopeAt(layer, localMs, lengthMs);
  if (level <= 0.001) return;
  const { ctx, master } = m;
  const freqOf = (semi: number) => layer.tone.root * Math.pow(2, semi / 12);
  const hold = Math.max(0.1, (lengthMs - localMs) / 1000);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, atCtx);
  gain.gain.exponentialRampToValueAtTime(0.075 * level, atCtx + Math.min(1.2, hold * 0.4));
  gain.gain.exponentialRampToValueAtTime(0.0001, atCtx + hold);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  filter.Q.value = 0.6;

  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  lfo.frequency.value = 0.13;
  lfoGain.gain.value = 180;
  lfo.connect(lfoGain).connect(filter.frequency);

  for (const semi of layer.tone.chord) {
    for (const detune of [-4, 4]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freqOf(semi);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(atCtx);
      osc.stop(atCtx + hold + 0.05);
      track(osc);
    }
  }
  filter.connect(gain).connect(master);
  lfo.start(atCtx);
  lfo.stop(atCtx + hold + 0.05);
  track(lfo);
}

/** 低频鼓点：正弦扫频 + 指数衰减，128 → 46Hz 那一下就是「咚」 */
function kick(m: Mixer, at: number, level: number): void {
  if (level <= 0) return;
  const { ctx, master } = m;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(128, at);
  osc.frequency.exponentialRampToValueAtTime(46, at + 0.16);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.28 * level, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + 0.3);
  track(osc);
}

/** 踩镲：白噪声过高通，短促一点 */
function hat(m: Mixer, at: number, level: number): void {
  if (level <= 0) return;
  const { ctx, master } = m;
  const src = ctx.createBufferSource();
  src.buffer = m.noise;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6200;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.05 * level, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
  src.connect(hp).connect(gain).connect(master);
  src.start(at, 0, 0.09);
  track(src);
}

/** 提示音：一声清亮的正弦带两点泛音，衰减快 */
function bell(m: Mixer, at: number, freq: number, level: number): void {
  if (level <= 0) return;
  const { ctx, master } = m;
  for (const [mul, amp] of [[1, 0.16], [2, 0.05], [3, 0.02]] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mul;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(amp * level, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 1.1);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + 1.15);
    track(osc);
  }
}

/* ------------------------------------------------------------------ 排程 */

/** 把 [fromMs, toMs) 这段工程时间里的音频事件排进 WebAudio */
function scheduleRange(m: Mixer, hostProject: AudioHost, s: Session, fromMs: number, toMs: number): void {
  const toCtx = (ms: number) => s.anchorCtx + (ms - s.fromMs) / 1000;

  for (const layer of audioLayers(hostProject)) {
    const { start, end } = span(layer, hostProject.duration);
    if (end <= fromMs || start >= toMs) continue;
    const length = end - start;
    const levelAt = (localMs: number) => envelopeAt(layer, localMs, length);
    const limit = Math.min(toMs, end);

    if (layer.tone.preset === 'pad') {
      if (s.started.has(layer.id)) continue;
      s.started.add(layer.id);
      /* 中途 seek 进来时本地时间不是 0：包络按「已经过去多少」算，不会从零突然嗷一下 */
      const local = Math.max(0, fromMs - start);
      emitPad(m, layer, toCtx(Math.max(fromMs, start)), local, length);
      continue;
    }

    if (layer.tone.preset === 'pulse') {
      const beat = 60_000 / Math.max(20, layer.tone.bpm);
      const scanFrom = Math.max(fromMs, start);
      /* 对齐到「图层起点 + 整数拍」，否则 seek 之后拍子会飘在半拍上 */
      const first = Math.ceil((scanFrom - start) / beat) * beat;
      for (let local = first; start + local < limit; local += beat) {
        const absolute = start + local;
        if (absolute < fromMs) continue;
        const level = levelAt(local);
        const at = toCtx(absolute);
        kick(m, at, level);
        hat(m, at + beat / 2000, level * 0.55);
      }
      continue;
    }

    /* chime：只在 marks 指定的时刻响。marks 是「相对图层起点」的毫秒 */
    for (let i = 0; i < layer.tone.marks.length; i += 1) {
      const mark = layer.tone.marks[i];
      const absolute = start + mark;
      if (absolute < fromMs || absolute >= limit) continue;
      const semi = layer.tone.chord[i % Math.max(1, layer.tone.chord.length)] ?? 0;
      bell(m, toCtx(absolute), layer.tone.root * 4 * Math.pow(2, semi / 12), levelAt(mark));
    }
  }
}

function tick(): void {
  const g = graph;
  const s = session;
  if (!g || !s || !host) return;
  const realNowMs = s.fromMs + (g.ctx.currentTime - s.anchorCtx) * 1000;
  const horizon = realNowMs + LOOKAHEAD * 1000;
  if (horizon <= s.cursorMs) return;
  scheduleRange(g, host, s, s.cursorMs, horizon);
  s.cursorMs = horizon;
}

/**
 * 计时器：优先 Web Worker（后台标签页不受节流），不可用时退回 setInterval。
 * 抄的是 Tone.js `Ticker` 的降级层级 —— 见文件头。
 */
function startTicker(fn: () => void): void {
  stopTicker();
  try {
    const source = `let id=null;self.onmessage=function(e){if(id)clearInterval(id);id=setInterval(function(){self.postMessage(1)},e.data)};`;
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = () => fn();
    worker.postMessage(TICK_MS);
    ticker = {
      stop: () => {
        worker.terminate();
        URL.revokeObjectURL(url);
      },
    };
  } catch {
    const id = window.setInterval(fn, TICK_MS);
    ticker = { stop: () => window.clearInterval(id) };
  }
}

function stopTicker(): void {
  ticker?.stop();
  ticker = null;
}

function rampMaster(g: Graph, value: number, seconds: number): void {
  const now = g.ctx.currentTime;
  try {
    g.master.gain.cancelScheduledValues(now);
    g.master.gain.setValueAtTime(Math.max(0.0001, g.master.gain.value), now);
    g.master.gain.linearRampToValueAtTime(Math.max(0.0001, value), now + Math.max(0.001, seconds));
  } catch {
    /* 上下文已关闭：无所谓 */
  }
}

/* ------------------------------------------------------------------ 对外 */

/** 音频上下文状态。属性面板的「试听」与自检脚本都要看它 */
export function audioStatus(): { supported: boolean; state: string | null; running: boolean } {
  const supported =
    typeof window !== 'undefined' && !!(window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
  return { supported, state: graph?.ctx.state ?? null, running: !!session };
}

/** 从 `fromMs` 开始播音。重复调用会先停掉上一段 */
export function startProjectAudio(project: Project, fromMs: number): void {
  const g = ensureGraph();
  if (!g) return;
  stopProjectAudio(40);
  host = project;
  /* 页面还没拿到用户手势时 ctx 是 suspended；resume 失败就当没声音，播放照旧 */
  void g.ctx.resume().catch(() => undefined);
  rampMaster(g, MASTER_GAIN, 0.12);

  const now = g.ctx.currentTime;
  session = { anchorCtx: now + 0.06, fromMs, cursorMs: fromMs, started: new Set() };
  /* 先补一小段，别等第一个 tick */
  scheduleRange(g, project, session, fromMs, fromMs + LOOKAHEAD * 1000);
  session.cursorMs = fromMs + LOOKAHEAD * 1000;
  startTicker(tick);
}

export function stopProjectAudio(releaseMs = 80): void {
  stopTicker();
  session = null;
  const g = graph;
  if (!g) return;
  /* 先把总线拉下去再掐节点：直接 stop 会有「啪」的爆音 */
  rampMaster(g, 0, releaseMs / 1000);
  const at = g.ctx.currentTime + releaseMs / 1000;
  for (const node of live) {
    try {
      node.stop(at);
    } catch {
      /* 已经停过的节点再 stop 会抛，忽略 */
    }
  }
  live = [];
}

/**
 * 主时钟每帧调一次：只判「开始 / 停止 / 该不该重锚」，排程在 tick 里做。
 * 之所以用重锚而不是微调，是因为播放速率恒为 1，唯一偏差来源就是 seek 与循环回绕。
 */
export function syncProjectAudio(project: Project, playhead: number, playing: boolean): void {
  host = project;
  if (!playing) {
    if (session) stopProjectAudio();
    return;
  }
  if (!session) {
    startProjectAudio(project, playhead);
    return;
  }
  const g = graph;
  if (!g) return;
  const drift = session.fromMs + (g.ctx.currentTime - session.anchorCtx) * 1000 - playhead;
  if (Math.abs(drift) > DRIFT_TOLERANCE) startProjectAudio(project, playhead);
}

/** 属性面板的「试听」：不等主时钟，直接把这一层的前 1.6 秒放出来 */
export function previewAudioLayer(layer: AudioLayer): void {
  const g = ensureGraph();
  if (!g) return;
  void g.ctx.resume().catch(() => undefined);
  const length = layer.outPoint > layer.inPoint ? layer.outPoint - layer.inPoint : 1600;
  /* 试听时强制不静音、去掉淡入：按下按钮就该立刻听见 */
  const brief: AudioLayer = { ...layer, muted: false, fadeIn: 40 };
  const tmp: AudioHost = { duration: Math.max(length, 1600), layers: [brief] };
  const s: Session = { anchorCtx: g.ctx.currentTime + 0.03, fromMs: 0, cursorMs: 0, started: new Set() };
  scheduleRange(g, tmp, s, 0, Math.min(length, 1600));
}

/**
 * 离线渲染整条音轨。
 *
 * 借自 Tone.js 的 `Tone.Offline`：预览要靠实时排程，但**导出**不该靠它 ——
 * 导出期间主线程在逐帧推帧，一旦某帧渲染慢了，实时排程就会漏拍。
 * 先把声音一次性算出来（OfflineAudioContext 比实时快得多），导出时按 BufferSource
 * 原样放出来，声音才是确定的、可复现的。
 */
export async function renderOfflineAudio(
  hostProject: AudioHost,
  opts: { sampleRate?: number; channels?: number } = {},
): Promise<AudioBuffer | null> {
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctor) return null;
  const sampleRate = Math.max(8000, Math.min(96000, Math.round(opts.sampleRate ?? 44100)));
  const frames = Math.max(1, Math.ceil((hostProject.duration / 1000) * sampleRate));
  try {
    const ctx = new Ctor(Math.max(1, Math.min(2, opts.channels ?? 1)), frames, sampleRate);
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
    const mixer: Mixer = { ctx, master, noise: makeNoise(ctx) };
    const s: Session = { anchorCtx: 0, fromMs: 0, cursorMs: 0, started: new Set() };
    scheduleRange(mixer, hostProject, s, 0, hostProject.duration);
    return await ctx.startRendering();
  } catch {
    return null;
  }
}

/**
 * 离线量一下这条音轨：时长、峰值、均方根。
 *
 * 给自检用的「不用耳朵也能判断有没有声音」的入口 —— peak 为 0 就是全静音，
 * rms 太低说明只有一两个采样点被点亮（多半是排程区间算错了）。
 */
export async function measureOfflineAudio(
  project: Project,
): Promise<{ ms: number; peak: number; rms: number; channels: number } | null> {
  const buffer = await renderOfflineAudio(project, { sampleRate: 8000, channels: 1 });
  if (!buffer) return null;
  const data = buffer.getChannelData(0);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const v = Math.abs(data[i]);
    if (v > peak) peak = v;
    sum += data[i] * data[i];
  }
  return {
    ms: Math.round(buffer.duration * 1000),
    peak: Number(peak.toFixed(4)),
    rms: Number(Math.sqrt(sum / Math.max(1, data.length)).toFixed(4)),
    channels: buffer.numberOfChannels,
  };
}

/** 波形峰值的缓存：key = 工程 id + version，工程一改就失效 */
const peakCache = new Map<string, Float32Array>();

/**
 * 取一段波形峰值（0..1 的绝对值包络），给时间轴画音频块用。
 * 思路与 wavesurfer.js 的 peaks 一致：离线渲染一遍 → 按桶取绝对值最大值 → 归一化。
 * 采样率压到 8kHz 就够画图了，96 秒的工程也就 768k 个采样点。
 */
export async function peaksFor(project: Project, buckets = 240): Promise<Float32Array | null> {
  const key = `${project.id}@${project.version}@${buckets}`;
  const cached = peakCache.get(key);
  if (cached) return cached;
  const buffer = await renderOfflineAudio(project, { sampleRate: 8000, channels: 1 });
  if (!buffer) return null;
  const data = buffer.getChannelData(0);
  const out = new Float32Array(buckets);
  const per = Math.max(1, Math.floor(data.length / buckets));
  let max = 0;
  for (let i = 0; i < buckets; i += 1) {
    let peak = 0;
    const from = i * per;
    const to = Math.min(data.length, from + per);
    for (let j = from; j < to; j += 1) {
      const v = Math.abs(data[j]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
    if (peak > max) max = peak;
  }
  if (max > 0.0001) for (let i = 0; i < buckets; i += 1) out[i] /= max;
  /* 缓存别无限长：一个工程留最近 8 个版本就够 */
  if (peakCache.size > 24) peakCache.clear();
  peakCache.set(key, out);
  return out;
}

/**
 * 导出的音频出口。
 *
 * 不复用实时排程（`startProjectAudio`），而是先离线渲染成 AudioBuffer 再整段放出来：
 * 导出期间主线程在逐帧推帧，一次卡顿就会让实时排程漏拍；离线渲染是算出来的，不受影响。
 * 这条思路来自 Tone.js 的 `Tone.Offline`（OfflineAudioContext 渲染 + 可复现的音频结果）。
 */
export interface AudioCapture {
  stream: MediaStream;
  stop: () => void;
}

export async function createAudioCapture(project: Project): Promise<AudioCapture | null> {
  const g = ensureGraph();
  if (!g) return null;
  try {
    /* 导出时用户可能在预览播放：先停掉，免得两路声音叠在一起录进去 */
    stopProjectAudio(40);
    const buffer = await renderOfflineAudio(project, { sampleRate: g.ctx.sampleRate, channels: 2 });
    if (!buffer) return null;
    if (!g.capture) g.capture = g.ctx.createMediaStreamDestination();
    const src = g.ctx.createBufferSource();
    src.buffer = buffer;
    const out = g.ctx.createGain();
    src.connect(out).connect(g.capture);
    await g.ctx.resume().catch(() => undefined);
    src.start(g.ctx.currentTime);
    return {
      stream: new MediaStream(g.capture.stream.getAudioTracks()),
      stop: () => {
        try {
          src.stop();
        } catch {
          /* 已经停了 */
        }
        try {
          out.disconnect();
        } catch {
          /* 已经断了 */
        }
      },
    };
  } catch {
    return null;
  }
}

/** 切换工程 / 卸载时彻底静音（保留 ctx，下次 resume 不必重新创建） */
export function resetAudio(): void {
  stopProjectAudio(10);
  host = null;
}

/**
 * 只用于自检与调试：某个时刻「会响什么」，不进音频图。
 * 给脚本一个不需要听声音就能验证排程的入口。
 */
export function describeAudioAt(project: Project, timeMs: number): { id: string; name: string; preset: string; gain: number }[] {
  const out: { id: string; name: string; preset: string; gain: number }[] = [];
  for (const layer of audioLayers(project)) {
    const { start, end } = span(layer, project.duration);
    if (timeMs < start || timeMs >= end) continue;
    const localMs = timeMs - start;

    /*
     * chime 只在一串瞬间响，区间内绝大部分时间是静的。
     * 只按 inPoint/outPoint 判断会把它报成「一直在响」，那样这个函数就答不了
     * 「此刻到底有没有声音」——这正是它唯一的用途。所以按最近的标记点算尾音。
     */
    let at = localMs;
    if (layer.tone.preset === 'chime') {
      const last = layer.tone.marks.filter((m) => m <= localMs && localMs - m < BELL_TAIL_MS).pop();
      if (last === undefined) continue;
      at = last;
    }

    out.push({
      id: layer.id,
      name: layer.name,
      preset: layer.tone.preset,
      gain: Number(envelopeAt(layer, at, end - start).toFixed(3)),
    });
  }
  return out;
}
