import { hashRand, valueNoise2D } from './animation';
import {
  beatAt,
  beatMs,
  barAt,
  barPhase,
  beatPhase,
  hit,
  isDownbeat,
  lineAt,
  lastLine,
  nextLine,
  lineCharProgress,
  lineProgress,
  lyricUnits,
  snap,
  timeOfBeat,
  unitProgress,
} from '@/core/score';
import type {
  CodeLayer,
  LyricLine,
  LyricUnit,
  Tempo,
} from '@/core/types';

/**
 * 代码层能拿到的「谱面上下文」。
 *
 * 为什么由渲染层注入而不是让代码层自己读工程：代码层的源码要在导出、
 * 图层独立窗口、HTML 栅格化三条路径上跑，那三处都拿不到整个 project。
 * 注入一份已经算好的数据，三条路径自动一致。
 */
export interface CodeEnv {
  tempo: Tempo;
  lyrics: LyricLine[];
}

export interface CodeRuntimeInfo {
  layerId: string;
  error: string | null;
  strikes: number;
  disabled: boolean;
  lastRunMs: number;
}

interface GlRuntime {
  gl: WebGLRenderingContext;
  program: WebGLProgram | null;
  compiledSource: string;
  buffer: WebGLBuffer | null;
  error: string | null;
}

interface Runtime {
  canvas: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D | null;
  gl: GlRuntime | null;
  fn: ((...args: unknown[]) => void) | null;
  compiledSource: string;
  compileError: string | null;
  state: Record<string, unknown>;
  outputs: Record<string, number | string | boolean>;
  strikes: number;
  disabled: boolean;
  error: string | null;
  lastRunMs: number;
  width: number;
  height: number;
  scale: number;
  /** 子帧超采样用的累加画布（只有开了 motionBlur 的层才会分配） */
  accum?: HTMLCanvasElement;
  accumCtx?: CanvasRenderingContext2D | null;
}

/** 编译/链接错误：不算「运行时异常」，不该累积熔断计数 */
class CodeCompileError extends Error {}

const runtimes = new Map<string, Runtime>();
const listeners = new Set<() => void>();
const infoCache = new Map<string, CodeRuntimeInfo>();

export function subscribeCodeRuntime(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(): void {
  infoCache.clear();
  for (const cb of listeners) cb();
}

export function getRuntimeInfo(layerId: string): CodeRuntimeInfo {
  const cached = infoCache.get(layerId);
  if (cached) return cached;
  const rt = runtimes.get(layerId);
  const info: CodeRuntimeInfo = {
    layerId,
    error: rt?.error ?? rt?.compileError ?? null,
    strikes: rt?.strikes ?? 0,
    disabled: rt?.disabled ?? false,
    lastRunMs: rt?.lastRunMs ?? 0,
  };
  infoCache.set(layerId, info);
  return info;
}

export function resetCodeRuntime(layerId?: string): void {
  if (layerId) {
    runtimes.delete(layerId);
    infoCache.delete(layerId);
    emit();
    return;
  }
  runtimes.clear();
  infoCache.clear();
  emit();
}

const VERTEX_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/**
 * GLSL 前置声明。`u_resolution` 是**绘图缓冲区**的像素尺寸（随 renderScale 变），
 * 所以 `gl_FragCoord.xy / u_resolution` 永远是与分辨率无关的 0..1 坐标。
 */
const FRAG_PRELUDE = `precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
`;

function getRuntime(layer: CodeLayer): Runtime {
  let rt = runtimes.get(layer.id);
  if (rt) return rt;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(layer.width));
  canvas.height = Math.max(1, Math.round(layer.height));
  rt = {
    canvas,
    ctx2d: null,
    gl: null,
    fn: null,
    compiledSource: '',
    compileError: null,
    state: {},
    outputs: {},
    strikes: 0,
    disabled: false,
    error: null,
    lastRunMs: 0,
    width: canvas.width,
    height: canvas.height,
    scale: 1,
  };
  runtimes.set(layer.id, rt);
  return rt;
}

const SANDBOX_SHADOW = `"use strict";
const window = undefined, document = undefined, globalThis = undefined, self = undefined,
  fetch = undefined, XMLHttpRequest = undefined, localStorage = undefined,
  sessionStorage = undefined, indexedDB = undefined, WebSocket = undefined,
  Worker = undefined, importScripts = undefined, parent = undefined, top = undefined,
  navigator = undefined, location = undefined;
`;

/**
 * 代码层沙箱：shadow 常见全局 + 严格模式 + 逐帧 try/catch + 三次连续异常后熔断。
 * 这是一个「防误用」的边界，不是对抗恶意代码的安全边界——真正的安全边界需要 Worker/iframe，
 * 但那样会牺牲逐帧同步的确定性。见 docs/01-known-limitations.md。
 */
function compileCanvas2D(rt: Runtime, source: string): void {
  if (rt.compiledSource === source && (rt.fn || rt.compileError)) return;
  rt.compiledSource = source;
  rt.compileError = null;
  rt.fn = null;
  try {
    rt.fn = new Function(
      'ctx',
      'api',
      'params',
      'width',
      'height',
      'time',
      'frame',
      'state',
      'output',
      `${SANDBOX_SHADOW}\n${source}\n`,
    ) as (...args: unknown[]) => void;
  } catch (err) {
    rt.compileError = `编译失败：${(err as Error).message}`;
  }
}

function ensureGl(rt: Runtime, source: string): GlRuntime {
  if (!rt.gl) {
    const gl = rt.canvas.getContext('webgl', {
      antialias: true,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    }) as WebGLRenderingContext | null;
    if (!gl) throw new Error('当前环境不支持 WebGL');
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    rt.gl = { gl, program: null, compiledSource: '', buffer, error: null };
  }
  const g = rt.gl;
  if (g.compiledSource === source && (g.program || g.error)) return g;
  g.compiledSource = source;
  g.error = null;
  g.program = null;
  const gl = g.gl;
  const body = /void\s+main\s*\(/.test(source) ? source : `void main() {\n${source}\n}`;
  const fsSrc = `${FRAG_PRELUDE}\n${body}`;
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) throw new Error('无法创建着色器');
  gl.shaderSource(vs, VERTEX_SRC);
  gl.compileShader(vs);
  gl.shaderSource(fs, fsSrc);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    g.error = `顶点着色器错误：${gl.getShaderInfoLog(vs) ?? ''}`;
    return g;
  }
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(fs) ?? '';
    const offset = FRAG_PRELUDE.split('\n').length;
    const m = /ERROR:\s*\d+:(\d+)/.exec(log);
    const line = m ? Math.max(1, Number(m[1]) - offset) : null;
    g.error = `GLSL 编译失败${line ? `（第 ${line} 行）` : ''}：${log.trim().slice(0, 400)}`;
    return g;
  }
  const program = gl.createProgram();
  if (!program) throw new Error('无法创建 program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    g.error = `链接失败：${gl.getProgramInfoLog(program) ?? ''}`;
    return g;
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  g.program = program;
  return g;
}

export interface CodeApi {
  time: number;
  frame: number;
  width: number;
  height: number;
  rand: (seed: number) => number;
  noise: (x: number, y: number) => number;
  setBackground: (color: string) => void;
  output: (channel: string, value: number | string | boolean) => void;
  input: (channel: string) => number | string | boolean | undefined;
  params: Record<string, string | number | boolean>;
  /** 工程的速度网格，已按当前 `time` 求好值。切镜、盖章、抖机位都该问它 */
  tempo: CodeTempo;
  /** 逐字时间（可为空结构）。没有歌词时 `lines.length === 0`，其余查询返回 null/0 */
  lyrics: CodeLyrics;
}

/** `api.tempo`：一拍之内的所有事，一次算好，逐帧免费 */
export interface CodeTempo {
  bpm: number;
  offsetMs: number;
  meter: number;
  /** 拍长（毫秒） */
  ms: number;
  /** 连续拍号（0 = 第 0 拍，小数 = 这一拍走了多少） */
  beat: number;
  /** 连续小节号 */
  bar: number;
  /** 拍内相位 0..1 */
  beatPhase: number;
  /** 小节内相位 0..1 */
  barPhase: number;
  /** 距上一个整拍的毫秒数 */
  since: number;
  /** 当前是否踩在强拍（下拍）上 */
  downbeat: boolean;
  /** 敲击包络：拍上为 1、按半衰期衰减，强拍乘 accent */
  hit: (halfLife?: number, accent?: number) => number;
  /** 第 i 拍落在第几毫秒 */
  at: (i: number) => number;
  /** 把某个时刻吸附到 1/div 拍网格（div=2 → 半拍） */
  snap: (t: number, div?: number) => number;
}

export interface CodeLyrics {
  /** 全部行（只读） */
  lines: LyricLine[];
  count: number;
  /** t（缺省 = 当前帧）所在的那一行 */
  at: (t?: number) => LyricLine | null;
  /** t 之前最后唱过的一行 */
  before: (t?: number) => LyricLine | null;
  /** t 之后要唱的一行 */
  after: (t?: number) => LyricLine | null;
  /** 一行铺成的逐字时间表（内部缓存，同一行反复调不重复算） */
  units: (line: LyricLine) => LyricUnit[];
  /** 单元在 t 的演唱进度 0..1 —— **绝不领先声音**，这正是卡拉 OK 的定义 */
  progress: (unit: LyricUnit, t?: number) => number;
  /** 整行已唱字符数（逐字擦除用） */
  chars: (line: LyricLine, t?: number) => number;
  /** 整行进度 0..1（按时间） */
  lineProgress: (line: LyricLine, t?: number) => number;
}

/** 跨代码层信号（借自 melanie 的 sig-in/out 思路，只做单向数值通道） */
const signalBus = new Map<string, number | string | boolean>();

const EMPTY_ENV: CodeEnv = { tempo: { bpm: 120, offsetMs: 0, meter: 4 }, lyrics: [] };

/**
 * 从工程里抽出代码层要的那一小撮上下文。
 * 每帧调一次（不是每层每帧）：一帧里九个代码层读的必须是**同一份**谱面。
 */
export function codeEnvOf(project: { tempo?: Partial<Tempo> | null; lyrics?: LyricLine[] | null }): CodeEnv {
  const tempo = project.tempo
    ? {
        bpm: Math.min(300, Math.max(20, project.tempo.bpm ?? 120)),
        offsetMs: project.tempo.offsetMs ?? 0,
        meter: Math.min(16, Math.max(1, Math.round(project.tempo.meter ?? 4))),
      }
    : EMPTY_ENV.tempo;
  const lyrics = Array.isArray(project.lyrics) ? project.lyrics : EMPTY_ENV.lyrics;
  return { tempo, lyrics };
}

/** 逐行的单元表缓存：同一行反复调不重复切词（切词要跑正则，逐帧跑没意义） */
const unitCache = new WeakMap<LyricLine, LyricUnit[]>();

function unitsOf(line: LyricLine): LyricUnit[] {
  let u = unitCache.get(line);
  if (!u) {
    u = lyricUnits(line);
    unitCache.set(line, u);
  }
  return u;
}

function makeTempoApi(tempo: Tempo, time: number): CodeTempo {
  return Object.freeze({
    bpm: tempo.bpm,
    offsetMs: tempo.offsetMs,
    meter: tempo.meter,
    ms: beatMs(tempo),
    beat: beatAt(tempo, time),
    bar: barAt(tempo, time),
    beatPhase: beatPhase(tempo, time),
    barPhase: barPhase(tempo, time),
    since: beatPhase(tempo, time) * beatMs(tempo),
    downbeat: isDownbeat(tempo, time),
    hit: (halfLife = 110, accent = 1.35) => hit(tempo, time, halfLife, accent),
    at: (i: number) => timeOfBeat(tempo, i),
    snap: (t: number, div = 1) => snap(tempo, t, div),
  });
}

function makeLyricsApi(lyrics: LyricLine[], time: number): CodeLyrics {
  return Object.freeze({
    lines: lyrics,
    count: lyrics.length,
    at: (t = time) => lineAt(lyrics, t),
    before: (t = time) => lastLine(lyrics, t),
    after: (t = time) => nextLine(lyrics, t),
    units: unitsOf,
    progress: (unit: LyricUnit, t = time) => unitProgress(unit, t),
    chars: (line: LyricLine, t = time) => lineCharProgress(line, t),
    lineProgress: (line: LyricLine, t = time) => lineProgress(line, t),
  });
}

function makeApi(rt: Runtime, layer: CodeLayer, time: number, frame: number, env: CodeEnv): CodeApi {
  const api: CodeApi = {
    time,
    frame,
    width: layer.width,
    height: layer.height,
    rand: hashRand,
    noise: valueNoise2D,
    setBackground: (color: string) => {
      if (rt.ctx2d) {
        rt.ctx2d.save();
        rt.ctx2d.globalCompositeOperation = 'destination-over';
        rt.ctx2d.fillStyle = color;
        rt.ctx2d.fillRect(0, 0, layer.width, layer.height);
        rt.ctx2d.restore();
      }
    },
    output: (channel: string, value: number | string | boolean) => {
      signalBus.set(channel, value);
      rt.outputs[channel] = value;
    },
    input: (channel: string) => signalBus.get(channel),
    params: layer.code.params,
    tempo: makeTempoApi(env.tempo, time),
    lyrics: makeLyricsApi(env.lyrics, time),
  };
  return Object.freeze(api);
}

function resize(rt: Runtime, layer: CodeLayer, scale: number): void {
  const w = Math.max(1, Math.round(layer.width * scale));
  const h = Math.max(1, Math.round(layer.height * scale));
  if (rt.width === w && rt.height === h && rt.scale === scale) return;
  rt.width = w;
  rt.height = h;
  rt.scale = scale;
  rt.canvas.width = w;
  rt.canvas.height = h;
  if (rt.gl) {
    rt.gl.program = null;
    rt.gl.compiledSource = '';
  }
}

function fail(rt: Runtime, message: string): void {
  const changed = rt.error !== message;
  rt.error = message;
  rt.strikes += 1;
  if (rt.strikes >= 3 && !rt.disabled) {
    rt.disabled = true;
    rt.error = `${message}（连续 3 次异常，已熔断该代码层）`;
  }
  if (changed || rt.disabled) emit();
}

export interface CodeRenderResult {
  ok: boolean;
  error: string | null;
  disabled: boolean;
}

/** 画一帧到 rt.canvas（不碰目标 ctx）。子帧超采样就是把它调 N 次 */
function frameOnce(rt: Runtime, layer: CodeLayer, time: number, frame: number, env: CodeEnv): void {
  const source = layer.code.source;
  if (layer.code.engine === 'glsl') {
    const g = ensureGl(rt, source);
    if (g.error || !g.program) throw new CodeCompileError(g.error ?? '着色器不可用');
    const gl = g.gl;
    gl.viewport(0, 0, rt.canvas.width, rt.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(g.program);
    /*
     * u_resolution 给的是**实际绘图缓冲区的像素尺寸**（= 图层尺寸 × renderScale × 外部倍率），
     * 不是图层设计尺寸。
     *
     * 这一点踩过：原来传的是 layer.width/height，于是降到半分辨率时
     * gl_FragCoord 只到 960×540，而 `(gl_FragCoord - 0.5*u_resolution)` 的中心点
     * 落在 (960,540) —— 也就是画布右下角。噪声场看不出来（谁也不知道噪点该在哪），
     * 但放射状的东西一眼就穿帮：爆点跑到左上角去了。
     * 传真实尺寸，`gl_FragCoord/u_resolution` 才是与分辨率无关的 0..1 坐标。
     */
    gl.uniform2f(gl.getUniformLocation(g.program, 'u_resolution'), rt.canvas.width, rt.canvas.height);
    gl.uniform1f(gl.getUniformLocation(g.program, 'u_time'), time / 1000);
    gl.bindBuffer(gl.ARRAY_BUFFER, g.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return;
  }

  if (!rt.ctx2d) rt.ctx2d = rt.canvas.getContext('2d');
  const ctx = rt.ctx2d;
  if (!ctx) throw new Error('无法获取 2D 上下文');
  ctx.setTransform(rt.scale, 0, 0, rt.scale, 0, 0);
  ctx.clearRect(0, 0, layer.width, layer.height);
  compileCanvas2D(rt, source);
  if (rt.compileError || !rt.fn) throw new CodeCompileError(rt.compileError ?? '编译失败');
  rt.fn(
    ctx,
    makeApi(rt, layer, time, frame, env),
    layer.code.params,
    layer.width,
    layer.height,
    time,
    frame,
    rt.state,
    (channel: string, value: number | string | boolean) => {
      signalBus.set(channel, value);
      rt.outputs[channel] = value;
    },
  );
}

/**
 * 把代码层渲染到它自己的离屏画布，再合成到目标 ctx。
 * 预览与导出走同一个函数，只是 scale 不同。
 */
export function runCodeLayer(
  target: CanvasRenderingContext2D,
  layer: CodeLayer,
  time: number,
  frame: number,
  scale = 1,
  env: CodeEnv = EMPTY_ENV,
): CodeRenderResult {
  const rt = getRuntime(layer);
  const source = layer.code.source;
  if (!source.trim()) {
    return { ok: true, error: null, disabled: false };
  }
  if (rt.disabled) {
    return { ok: false, error: rt.error, disabled: true };
  }
  /*
   * 内部分辨率 = 外部倍率（预览 zoom*dpr / 导出 scale）× 图层自带的 renderScale。
   * 两个乘数分开是有意的：一个是「显示多大」，一个是「这一层值不值这么多像素」。
   * 合成阶段 `drawImage(canvas, 0, 0, layer.width, layer.height)` 会把内部分辨率
   * 双线性放大回图层尺寸，所以这里省下的是纯粹的像素填充，不是画面内容。
   */
  resize(rt, layer, scale * (layer.code.renderScale ?? 1));
  const started = performance.now();
  const blur = layer.code.motionBlur;
  const samples = blur ? Math.min(8, Math.max(2, Math.round(blur.samples))) : 1;

  try {
    if (samples <= 1) {
      frameOnce(rt, layer, time, frame, env);
      target.drawImage(rt.canvas, 0, 0, layer.width, layer.height);
    } else {
      /*
       * 子帧超采样 = 时间上的抗锯齿。
       *
       * 每一帧取 N 个时刻（从 time 往回铺 shutter 毫秒），各画一次，
       * 用「增量平均」叠成一张：A_n = A_{n-1}·(n-1)/n + F_n/n。
       * 不用逐次 source-over 半透明叠 —— 那样权重是 front-weighted（后画的更实），
       * 看得出「尾巴重、头轻」，在甩镜上尤其明显。
       *
       * 代价是 N 倍绘制：只该给便宜但高速的层用。
       */
      const accum = ensureAccum(rt);
      const actx = accum.ctx;
      actx.setTransform(1, 0, 0, 1, 0, 0);
      actx.clearRect(0, 0, accum.canvas.width, accum.canvas.height);
      actx.globalCompositeOperation = 'source-over';
      const shutter = Math.max(1, blur?.shutter ?? 40);
      for (let i = 0; i < samples; i += 1) {
        const st = time - (shutter * i) / (samples - 1);
        frameOnce(rt, layer, st, frame, env);
        actx.globalAlpha = 1 / (i + 1);
        actx.drawImage(rt.canvas, 0, 0);
      }
      actx.globalAlpha = 1;
      target.drawImage(accum.canvas, 0, 0, layer.width, layer.height);
      /* 主画布恢复成最后一帧的样子：图层独立窗口/调试口会直接看它 */
    }
    rt.strikes = 0;
    if (rt.error) {
      rt.error = null;
      emit();
    }
    rt.lastRunMs = performance.now() - started;
    return { ok: true, error: null, disabled: false };
  } catch (err) {
    if (err instanceof CodeCompileError) {
      failOnly(rt, err.message);
      return { ok: false, error: rt.error, disabled: rt.disabled };
    }
    fail(rt, `运行时异常：${(err as Error).message}`);
    return { ok: false, error: rt.error, disabled: rt.disabled };
  }
}

/** 子帧累加用的画布，按需分配、跟着主画布一起 resize */
function ensureAccum(rt: Runtime): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  if (!rt.accum) rt.accum = document.createElement('canvas');
  const canvas = rt.accum;
  if (canvas.width !== rt.canvas.width || canvas.height !== rt.canvas.height) {
    canvas.width = rt.canvas.width;
    canvas.height = rt.canvas.height;
    rt.accumCtx = null;
  }
  if (!rt.accumCtx) {
    rt.accumCtx = canvas.getContext('2d');
    if (!rt.accumCtx) throw new Error('无法获取累加画布上下文');
  }
  return { canvas, ctx: rt.accumCtx };
}

function failOnly(rt: Runtime, message: string): void {
  if (rt.error === message) return;
  rt.error = message;
  emit();
}

export function getSignal(channel: string): number | string | boolean | undefined {
  return signalBus.get(channel);
}
