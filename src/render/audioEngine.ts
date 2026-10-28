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
 * 合成器只做三种预设（pad / pulse / chime），示例工程因此零外部资源；
 * 另外支持**导入音频**（assetId）：解码成 AudioBuffer 后按 trimIn 取偏移排程，
 * 主时钟、导出、波形三条链路复用同一个 scheduleRange，一行都没另写。
 */

import type { AssetMeta, AudioLayer, Layer, Project, Tempo, VoiceSpec } from '../core/types';
import { getAudioBuffer, preloadAudioAssets } from './assets';
import { ensureVoiceBuffer, getVoiceBuffer, preloadVoiceLayers } from './voiceSynth';

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
  /** 资源清单（导入音频要按 assetId 找解码缓存；示例工程没有音频文件，可以为空） */
  assets?: AssetMeta[];
  /**
   * 工程的速度网格。有它的时候，pulse 的网格原点用工程的第 0 拍，
   * 而不是「图层自己的起点」—— 否则图层往前挪 200ms，鼓就整体跟着挪 200ms，
   * 画面还在原来的拍上切。没有它（试听单层）就退回旧行为。
   */
  tempo?: Tempo;
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
  /** 导入音频排到哪了（毫秒）。tick 会重复进同一段，没有游标就会把同一秒排两遍 */
  bufferAt?: Map<string, number>;
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

/** 低频鼓点：正弦扫频 + 指数衰减，128 → 46Hz 那一下就是「咚」。强拍起点更低、尾巴更长 */
function kick(m: Mixer, at: number, level: number, down = false): void {
  if (level <= 0) return;
  const { ctx, master } = m;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(down ? 150 : 128, at);
  osc.frequency.exponentialRampToValueAtTime(down ? 38 : 46, at + (down ? 0.22 : 0.16));
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime((down ? 0.34 : 0.28) * level, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + (down ? 0.34 : 0.26));
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

    /*
     * 「有一段现成采样要放」的两条路：导入的音频文件、算出来的人声。
     * 二者的时间语义完全一样（trimIn / 淡入淡出 / 截取），所以合成一条分支 ——
     * 少写一份，就少一处「人声裁了但导入音频没裁」这种不对称的 bug。
     *
     * 缓冲区没就绪就这轮先不排：下次 tick 会重试（排程必须同步，不能在这里 await）。
     */
    const buf = layer.voice ? getVoiceBuffer(layer.voice) : layer.assetId ? getAudioBuffer(layer.assetId) : null;
    if (layer.voice || layer.assetId) {
      if (!buf) continue;
      const cursor = s.bufferAt?.get(layer.id) ?? 0;
      const segFrom = Math.max(fromMs, start, cursor);
      if (segFrom >= limit) continue;
      const offset = ((layer.trimIn || 0) + (segFrom - start)) / 1000;
      if (offset >= buf.duration - 0.001) continue;
      const playMs = Math.min(limit - segFrom, (buf.duration - offset) * 1000);
      if (playMs <= 5) continue;
      const src = m.ctx.createBufferSource();
      src.buffer = buf;
      const gain = m.ctx.createGain();
      const at = toCtx(segFrom);
      const local = segFrom - start;
      const fadeIn = Math.min(layer.fadeIn, length * 0.8);
      const fadeOut = Math.min(layer.fadeOut, length * 0.8);
      gain.gain.setValueAtTime(levelAt(local), at);
      if (fadeIn > 0 && local < fadeIn) gain.gain.linearRampToValueAtTime(layer.muted ? 0 : layer.volume, at + (fadeIn - local) / 1000);
      if (fadeOut > 0) {
        const fadeStart = length - fadeOut;
        if (local < fadeStart) gain.gain.setValueAtTime(layer.muted ? 0 : layer.volume, at + (fadeStart - local) / 1000);
        gain.gain.linearRampToValueAtTime(0, at + Math.max(0.001, (length - local) / 1000));
      }
      src.connect(gain).connect(m.master);
      track(src);
      src.start(at, offset, playMs / 1000);
      if (!s.bufferAt) s.bufferAt = new Map();
      s.bufferAt.set(layer.id, segFrom + playMs);
      continue;
    }

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
      /*
       * 网格原点：有工程速度就用工程的第 0 拍，否则退回图层起点。
       * 有原点的网格才能保证「画面在哪切、鼓就在哪响」——
       * 图层挪位时画面切点是绝对时间，鼓若不跟着原点走就会整体偏掉。
       */
      const origin = hostProject.tempo ? hostProject.tempo.offsetMs : start;
      const tempo = hostProject.tempo;
      const scanFrom = Math.max(fromMs, start);
      let idx = Math.ceil((scanFrom - origin) / beat);
      for (let absolute = origin + idx * beat; absolute < limit; absolute += beat, idx += 1) {
        if (absolute < start || absolute < fromMs) continue;
        const local = absolute - start;
        const level = levelAt(local);
        const at = toCtx(absolute);
        /* 落在工程强拍上的那一下加重：这是「小节」听得出来的唯一线索 */
        const strong = tempo ? idx % Math.max(1, tempo.meter) === 0 : false;
        kick(m, at, level * (strong ? 1 : 0.86), strong);
        hat(m, at + beat / 2000, level * (strong ? 0.7 : 0.55));
        if (strong) bell(m, at, layer.tone.root * 8, level * 0.25);
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

  /* 人声要先把缓冲算出来（几十毫秒），算完再排 —— 试听按钮不该毫无反应地静一会儿 */
  if (layer.voice) {
    void ensureVoiceBuffer(layer.voice, { sampleRate: g.ctx.sampleRate }).then((buf) => {
      if (buf) previewBuffer(layer);
    });
    return;
  }
  previewBuffer(layer);
}

function previewBuffer(layer: AudioLayer): void {
  const g = ensureGraph();
  if (!g) return;
  const length = layer.outPoint > layer.inPoint ? layer.outPoint - layer.inPoint : 1600;
  /* 试听时强制不静音、去掉淡入：按下按钮就该立刻听见 */
  const brief: AudioLayer = { ...layer, muted: false, fadeIn: 40 };
  const tmp: AudioHost = { duration: Math.max(length, 1600), layers: [brief] };
  const s: Session = { anchorCtx: g.ctx.currentTime + 0.03, fromMs: 0, cursorMs: 0, started: new Set() };
  scheduleRange(g, tmp, s, 0, Math.min(length, 1600));
}

/**
 * 试听一段「还没落到时间轴上」的人声（面板里调参数时用）。
 *
 * 与 `previewAudioLayer` 分开：那个吃的是一个已有图层，这个吃的是面板里的当前参数 ——
 * 用户改一个字就想听一遍，不该为了试听往工程里塞一层再删掉。
 */
export function previewVoiceSpec(spec: Partial<VoiceSpec>): void {
  const g = ensureGraph();
  if (!g) return;
  void g.ctx.resume().catch(() => undefined);
  void ensureVoiceBuffer(spec, { sampleRate: g.ctx.sampleRate }).then((buf) => {
    if (!buf) return;
    const src = g.ctx.createBufferSource();
    src.buffer = buf;
    const gain = g.ctx.createGain();
    gain.gain.value = 0.9;
    src.connect(gain).connect(g.master);
    track(src);
    src.start();
  });
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
  opts: { sampleRate?: number; channels?: number; from?: number; to?: number } = {},
): Promise<AudioBuffer | null> {
  const Ctor =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctor) return null;
  const sampleRate = Math.max(8000, Math.min(96000, Math.round(opts.sampleRate ?? 44100)));
  /*
   * 只渲染一段（导出区间）。
   *
   * 关键在 `fromMs` 一起传进 Session：`toCtx(ms)` 是相对它的，
   * 落在这个区间之前的图层因此会自动被排到负数时间 —— 由 OfflineAudioContext 丢掉，
   * 而不是「排在第 0 帧上一起响」。区间起点正好切在长音中间时，包络也从真实起点算，
   * 不会在区间开头莫名其妙地重新淡入。
   */
  const fromMs = Math.max(0, Math.min(opts.from ?? 0, hostProject.duration));
  const toMs = Math.max(fromMs, Math.min(opts.to ?? hostProject.duration, hostProject.duration));
  const frames = Math.max(1, Math.ceil(((toMs - fromMs) / 1000) * sampleRate));
  try {
    /* 导入音频必须先解码完再排程：scheduleRange 是同步的，不能在里面 await */
    await preloadAudioAssets(hostProject.assets ?? []);
    /* 人声同理，而且要按这次渲染的采样率算 —— 否则导出会拿 44.1k 的缓冲区去 48k 的上下文里重采样 */
    await preloadVoiceLayers(hostProject.layers, { sampleRate });
    const ctx = new Ctor(Math.max(1, Math.min(2, opts.channels ?? 1)), frames, sampleRate);
    const master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
    const mixer: Mixer = { ctx, master, noise: makeNoise(ctx) };
    const s: Session = { anchorCtx: 0, fromMs, cursorMs: fromMs, started: new Set() };
    scheduleRange(mixer, hostProject, s, fromMs, toMs);
    return await ctx.startRendering();
  } catch {
    return null;
  }
}

/**
 * 把整条音轨（或其中一段）渲染成 16bit PCM WAV。
 *
 * 为什么需要它：离线渲染出去的每一帧是图，声音得单独给一份**无压缩**的，
 * 才好在外部编码器（ffmpeg）里跟画面按同一条时间轴合起来 ——
 * WebM 那条路是浏览器自己封装的，外部编码器读不了。
 *
 * 它也服务「只要声音」的场景：配音、给别人的剪辑软件、检查混音。
 * 传 `from`/`to` 时输出从 0 开始，与同区间的画面文件对齐。
 *
 * 交错写入（L,R,L,R）而不是先写左再写右：WAV 的 data 块就是交错的，
 * 拆开来写等于自己再拼一遍，没必要。
 */
export async function renderWav(
  project: AudioHost,
  opts: { sampleRate?: number; from?: number; to?: number } = {},
): Promise<Uint8Array | null> {
  const sampleRate = Math.max(8000, Math.min(96000, Math.round(opts.sampleRate ?? 48000)));
  const buffer = await renderOfflineAudio(project, { sampleRate, channels: 2, from: opts.from, to: opts.to });
  if (!buffer) return null;
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); /* PCM 头长度 */
  view.setUint16(20, 1, true); /* 1 = PCM */
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);

  const planes: Float32Array[] = [];
  for (let c = 0; c < channels; c += 1) planes.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      const v = Math.max(-1, Math.min(1, planes[c]![i] ?? 0));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
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

export async function createAudioCapture(
  project: Project,
  range?: { in: number; out: number } | null,
): Promise<AudioCapture | null> {
  const g = ensureGraph();
  if (!g) return null;
  try {
    /* 导出时用户可能在预览播放：先停掉，免得两路声音叠在一起录进去 */
    stopProjectAudio(40);
    /*
     * 按出片区间**只渲染这一段**，而不是整条渲染完再寻址到区间起点再放。
     * 后者看着也行，但 MediaRecorder 从 `src.start()` 开始计时，
     * 中间任何一次解码抖动都会把音画错开；而且区间是 40 秒里的 3 秒时，
     * 白渲染那 37 秒也是纯粹的等待。
     */
    const buffer = await renderOfflineAudio(project, {
      sampleRate: g.ctx.sampleRate,
      channels: 2,
      from: range?.in,
      to: range?.out,
    });
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
    /* 人声是「一口气唱完」，区间内一直有声，不需要 chime 那套标记点判断 */
    let at = localMs;
    if (!layer.voice && !layer.assetId && layer.tone.preset === 'chime') {
      const last = layer.tone.marks.filter((m) => m <= localMs && localMs - m < BELL_TAIL_MS).pop();
      if (last === undefined) continue;
      at = last;
    }

    out.push({
      id: layer.id,
      name: layer.name,
      preset: layer.voice ? `voice:${layer.voice.preset}` : layer.assetId ? 'asset' : layer.tone.preset,
      gain: Number(envelopeAt(layer, at, end - start).toFixed(3)),
    });
  }
  return out;
}
