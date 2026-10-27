import { hashRand, valueNoise2D } from './animation';
import type { CodeLayer } from '@/core/types';

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
}

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
}

/** 跨代码层信号（借自 melanie 的 sig-in/out 思路，只做单向数值通道） */
const signalBus = new Map<string, number | string | boolean>();

function makeApi(rt: Runtime, layer: CodeLayer, time: number, frame: number): CodeApi {
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

  try {
    if (layer.code.engine === 'glsl') {
      const g = ensureGl(rt, source);
      if (g.error || !g.program) {
        failOnly(rt, g.error ?? '着色器不可用');
        return { ok: false, error: rt.error, disabled: rt.disabled };
      }
      const gl = g.gl;
      gl.viewport(0, 0, rt.canvas.width, rt.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(g.program);
      const uRes = gl.getUniformLocation(g.program, 'u_resolution');
      const uTime = gl.getUniformLocation(g.program, 'u_time');
      gl.uniform2f(uRes, layer.width, layer.height);
      gl.uniform1f(uTime, time / 1000);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      target.drawImage(rt.canvas, 0, 0, layer.width, layer.height);
    } else {
      if (!rt.ctx2d) {
        rt.ctx2d = rt.canvas.getContext('2d');
      }
      const ctx = rt.ctx2d;
      if (!ctx) throw new Error('无法获取 2D 上下文');
      ctx.setTransform(rt.scale, 0, 0, rt.scale, 0, 0);
      ctx.clearRect(0, 0, layer.width, layer.height);
      compileCanvas2D(rt, source);
      if (rt.compileError || !rt.fn) {
        failOnly(rt, rt.compileError ?? '编译失败');
        return { ok: false, error: rt.error, disabled: rt.disabled };
      }
      rt.fn(
        ctx,
        makeApi(rt, layer, time, frame),
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
      target.drawImage(rt.canvas, 0, 0, layer.width, layer.height);
    }
    rt.strikes = 0;
    if (rt.error) {
      rt.error = null;
      emit();
    }
    rt.lastRunMs = performance.now() - started;
    return { ok: true, error: null, disabled: false };
  } catch (err) {
    fail(rt, `运行时异常：${(err as Error).message}`);
    return { ok: false, error: rt.error, disabled: rt.disabled };
  }
}

function failOnly(rt: Runtime, message: string): void {
  if (rt.error === message) return;
  rt.error = message;
  emit();
}

export function getSignal(channel: string): number | string | boolean | undefined {
  return signalBus.get(channel);
}
