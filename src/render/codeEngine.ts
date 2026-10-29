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
import {
  LOOP_BUDGET_MS,
  LOOP_TIMEOUT_MARK,
  isLoopProtectReady,
  onLoopProtectUpgraded,
  protectLoops,
} from '@/core/loopProtect';

/*
 * 解析器迟到（降级后重试成功）时，把已经编好的层全部作废重来。
 *
 * 不做这一步的后果很隐蔽：那几层是按**没有注入检查**的源码编出来的，
 * 编译缓存（compiledSource === source）会让它一直跑下去 —— 表面上「保护装好了」，
 * 实际那几层永久裸奔。
 */
onLoopProtectUpgraded(() => resetCodeRuntime());

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
  /*
   * 编译期注入循环超时检查。注入是**改源码**，所以它有两条自我约束：
   *   · 解析失败（语法本身有问题）时原样返回，让 new Function 去报编译错误，不抢着报；
   *   · 注入数量为 0 时也是原样返回 —— 没有循环就没有可保护的东西。
   * 两种情况下行为都与加这层保护之前完全一致。
   */
  const guarded = protectLoops(source);
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
      '__klyDeadline',
      `${SANDBOX_SHADOW}\n${guarded.code}\n`,
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
    /*
     * 循环保护的截止时刻：**每次绘制各算一份**，不是整帧共用。
     * 共用的话，32 次子帧的运动模糊会被合法的累计耗时误判成死循环；
     * 各算一份则「单次绘制超过 50ms」才拦，正常画面永远碰不到。
     */
    performance.now() + LOOP_BUDGET_MS,
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
   * 编译器没就绪时**不求值**。
   *
   * 这是整套保护里最不能省的一步：宁可这一帧不画代码层，也绝不能拿没注入检查的源码
   * 去跑 —— 那正是我们要防的那次冻结。预热在编辑器启动时 await 过一次，
   * 所以正常只会在最开头的几帧命中（表现为代码层晚一两帧出现）。
   */
  if (!isLoopProtectReady()) {
    return { ok: true, error: null, disabled: false };
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
  const auto = blur?.samples === 'auto';
  const samples = blur && typeof blur.samples === 'number' ? Math.min(32, Math.max(2, Math.round(blur.samples))) : 1;

  try {
    if (!blur) {
      frameOnce(rt, layer, time, frame, env);
      target.drawImage(rt.canvas, 0, 0, layer.width, layer.height);
    } else if (auto) {
      drawAdaptive(rt, layer, time, frame, env, target, blur.shutter, blur.tol ?? 3);
      /* 主画布恢复成最后一帧的样子：图层独立窗口/调试口会直接看它 */
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
      const shutter = Math.max(1, blur.shutter);
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
    /* 循环保护抛的错要翻译成人话：原文案是给机器认的标记，不是给用户看的 */
    const message = (err as Error).message;
    fail(
      rt,
      message === LOOP_TIMEOUT_MARK
        ? `循环超时：单帧内的循环超过 ${LOOP_BUDGET_MS}ms 已被中断（检查 while(true) 或不会收敛的循环）`
        : `运行时异常：${message}`,
    );
    return { ok: false, error: rt.error, disabled: rt.disabled };
  }
}

/**
 * 自适应子帧运动模糊：**瓦片收敛 + 逐级加密**。
 *
 * 这是原项目（pdoom-video）那套采样的 CPU 版：整帧切成 32×32 瓦片，
 * 先稀疏地取 4 个子帧，然后把剩余的子帧按「补齐空隙」的顺序加进去，
 * 每加完一级就看一次：**还有没有哪个瓦片的变化超过 tol 个色阶**。
 * 全都稳定了就停 —— 静止画面花 4 次，快镜头才配花 32 次。
 *
 * 三处与原项目不同，都是环境带来的，不是选择：
 *   1. **子帧上限 32，不是 324。** 原项目在 GPU 上跑，一次全屏绘制是几毫秒；
 *      这里是 CPU 光栅化，1080p 一层一次绘制就要 1~3ms，324 次就是一帧十秒。
 *   2. **不能按瓦片跳过绘制。** 原项目用 scissor 让收敛的瓦片不再跑着色器；
 *      canvas2d 没有等价物（clip 反而更贵）。所以我们只用瓦片判断「还要不要继续」，
 *      省下的是子帧数，不是像素数。
 *   3. **子帧位置是固定格点上的子集**（stride 4 → 2 → 1），这样「补样本」
 *      永远是往空隙里塞，已经画过的那些不会因为总数变了而挪位置，
 *      累积平均才是无偏的。原项目每次 refine 会重铺位置。
 *
 * 好处是实打实的：一段静止的画面从 5 次绘制降到 4 次，而一次甩镜仍然是 32 次。
 *
 * 但要诚实：本实现等价于原项目的 `--refine frame`（整帧一个计数），不是它的
 * 瓦片采样器 —— 原因见下面 maxTileDelta 的注释，那是环境逼出来的，不是选择。
 */
const AUTO_MAX = 32;
const AUTO_STAGES = [4, 8, 16, 32];
const TILE = 32;

function drawAdaptive(
  rt: Runtime,
  layer: CodeLayer,
  time: number,
  frame: number,
  env: CodeEnv,
  target: CanvasRenderingContext2D,
  shutterMs: number,
  tol: number,
): void {
  const shutter = Math.max(1, shutterMs);
  const accum = ensureAccum(rt);
  const actx = accum.ctx;
  const { width: w, height: h } = accum.canvas;
  actx.setTransform(1, 0, 0, 1, 0, 0);
  actx.globalCompositeOperation = 'source-over';
  actx.globalAlpha = 1;
  actx.clearRect(0, 0, w, h);

  const drawn = new Uint8Array(AUTO_MAX);
  let count = 0;
  let prev: Uint8ClampedArray | null = null;

  for (const stage of AUTO_STAGES) {
    const stride = AUTO_MAX / stage;
    for (let i = 0; i < AUTO_MAX; i += stride) {
      if (drawn[i]) continue;
      drawn[i] = 1;
      count += 1;
      /* 位置只由 i 决定：加密时旧样本不动 */
      const st = time - (shutter * i) / (AUTO_MAX - 1);
      frameOnce(rt, layer, st, frame, env);
      actx.globalAlpha = 1 / count;
      actx.drawImage(rt.canvas, 0, 0);
    }
    /* 一级画完，量一次收敛：分块读回来比整帧比较省事，也省分配 */
    const data = actx.getImageData(0, 0, w, h).data;
    if (prev) {
      const settled = maxTileDelta(prev, data, w, h) <= tol;
      prev = data;
      if (settled) break;
    } else {
      prev = data;
    }
  }

  actx.globalAlpha = 1;
  target.drawImage(accum.canvas, 0, 0, layer.width, layer.height);
}

/**
 * 每个 `TILE`×`TILE` 块内 |Δ| 的最大值，再对全图取最大 —— 要的是「最不稳定的那一块」。
 *
 * **这里有一个必须说清楚的事实**：对全图取最大，等于「整帧取最大」。
 * 分块在这个函数里唯一的作用是**早退**（某块已经远超阈值就不用扫剩下的），
 * 它并不能让某一块单独停下 —— 原项目那种「每块自己决定还要不要采」的语义
 * 在本工程里复刻不了，因为一次子帧是整帧重画，静止的块省不下一次绘制。
 *
 * 换句话说：本实现等价于原项目的 `--refine frame`（整帧一个计数），
 * 而不是它的瓦片采样器。这一点是实测出来的 —— 把判据换成整帧最大，
 * 同一批时刻的耗时一模一样（41200–41800ms 全部约 100ms）。
 * 与其留一个什么都不同的 `--refine` 开关，不如把这句话写在代码里。
 */
function maxTileDelta(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number): number {
  let worst = 0;
  for (let ty = 0; ty < h; ty += TILE) {
    for (let tx = 0; tx < w; tx += TILE) {
      const yEnd = Math.min(h, ty + TILE);
      const xEnd = Math.min(w, tx + TILE);
      for (let y = ty; y < yEnd; y += 1) {
        let idx = (y * w + tx) * 4;
        for (let x = tx; x < xEnd; x += 1, idx += 4) {
          const d0 = b[idx]! - a[idx]!;
          const d1 = b[idx + 1]! - a[idx + 1]!;
          const d2 = b[idx + 2]! - a[idx + 2]!;
          const m = Math.max(d0 < 0 ? -d0 : d0, d1 < 0 ? -d1 : d1, d2 < 0 ? -d2 : d2);
          if (m > worst) worst = m;
        }
      }
      if (worst > 96) return worst; /* 已经远超任何合理阈值，早退 */
    }
  }
  return worst;
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
