/**
 * 导入管线：从「AI 生成的代码 / 第三方工程包」到「可编辑图层」。
 *
 * 一条铁律：**先预检，再导入**。预检是纯函数（给定字节/文本就能算出结果，不碰 IndexedDB），
 * 所以它能被 UI 弹窗、Agent 工具、自检脚本共用同一份实现。
 *
 * 降级优先级（越靠上越好编辑）：
 *   ① 场景 JSON（Rendervid / cadence 风格）→ 原生图层 + 轨道，零代码层
 *   ② HTML/GSAP 片段 → 静态可提取的部分变原生图层，剩下的整块进 html 代码层
 *   ③ Remotion 工程 → 静态 AST 解析（v2.5b）：字幕/图片/盒子变原生层，
 *      interpolate/spring 变轨道，自定义组件留成 remotion-component 代码层
 *   ④ 只有代码 → 整体作为代码层，打 origin 标记
 *   ⑤ 只有视频/图片 → VideoLayer / ImageLayer，语义全丢
 *
 * 每一步降级都记 note，最后原样展示给用户 —— 「哪些能编辑、哪些只能整块预览」必须说清楚。
 */

import type {
  AnimatableProperty,
  CodeEngine,
  EasingName,
  EasingSpec,
  Keyframe,
  Layer,
  LayerOrigin,
  LayerOriginFormat,
  Project,
  PropertyTrack,
  TextStyle,
} from './types';
import { EASINGS } from './types';
import {
  createBackground,
  createCodeLayer,
  createImageLayer,
  createEmptyProject,
  createTextLayer,
  createVideoLayer,
  normalizeProject,
} from './defaults';
import { AI_SCENE_FORMAT, describeCode } from './aiScene';
import { bytesToDataUrl, looksLikeZip, zipEntryNames } from './bundle';
import { parseRemotionZip, RemotionParseError, type RemotionParse, type RemotionTrack } from './remotionParser';
import { parseHtmlDocument, matchSelectorToLayer, type HtmlParse } from './htmlImport';

/* ------------------------------------------------------------------ 类型 */

export type ImportFormat =
  | 'kly'
  | 'kly-json'
  | 'ai-scene'
  | 'project-json'
  | 'scene-json'
  | 'remotion'
  | 'html'
  | 'media'
  | 'unknown';

export interface ImportInput {
  bytes?: Uint8Array;
  text?: string;
  name?: string;
  /** 显式指定格式，跳过嗅探 */
  format?: ImportFormat;
}

export interface ImportCounts {
  /** 原生可编辑图层（文本/图片/视频） */
  structured: number;
  /** 代码层 */
  code: number;
  /** 其中媒体层（图片/视频） */
  media: number;
  background: number;
  tracks: number;
  keyframes: number;
}

/**
 * 一条降级说明。
 *
 * 不直接写成人话字符串，是因为**报告要展示给两种读者**：界面（要按当前语言翻译）
 * 和 Agent（要能机读、拼回自己的上下文）。key 用中文原文当翻译键（和词典同一约定），
 * `{name}` 这类占位符由 `t()` 填。拼死的字符串一旦进了界面，英文模式就露馅 —— 这条踩过。
 */
export interface ImportNote {
  key: string;
  params?: Record<string, string | number>;
}

export const note = (key: string, params?: Record<string, string | number>): ImportNote => ({ key, params });

/** 同一条说明可能被多个图层各记一次：按 key + 参数去重，不按渲染后的文本 */
function dedupeNotes(list: ImportNote[]): ImportNote[] {
  const seen = new Set<string>();
  const out: ImportNote[] = [];
  for (const item of list) {
    const id = item.params ? `${item.key}|${JSON.stringify(item.params)}` : item.key;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}

/** 给命令层/日志用的中文渲染（UI 不走这里，UI 用 t()） */
export function renderNote(item: ImportNote): string {
  if (!item.params) return item.key;
  return item.key.replace(/\{(\w+)\}/g, (raw, key: string) => {
    const value = item.params?.[key];
    return value === undefined ? raw : String(value);
  });
}

class NoteList {
  private items: ImportNote[] = [];
  push(key: string, params?: Record<string, string | number>): void {
    this.items.push({ key, params });
  }
  get all(): ImportNote[] {
    return this.items;
  }
  get size(): number {
    return this.items.length;
  }
}

export interface ImportReport {
  format: ImportFormat;
  supported: boolean;
  /** 一句话人话（也是翻译键，UI 用 t(report.label)） */
  label: string;
  /** 0..100，预估保真度（不是画质，是「多少东西还能继续编辑」） */
  fidelity: number;
  counts: ImportCounts;
  missingAssets: string[];
  /** 降级说明：每一句都对应一处「被降级的东西」 */
  notes: ImportNote[];
  /** 不能导入的原因 */
  blockers: ImportNote[];
  preview: {
    name: string;
    width: number;
    height: number;
    duration: number;
    fps: number;
    sample: string[];
  } | null;
}

/**
 * 需要在落库阶段物化的资源（data URL），由命令层写进资源库。
 *
 * `slot` 决定落库后的 id 写到哪儿：图片/视频层写 `layer.assetId`；
 * remotion 层的代理预览视频要写进 `code.runtime.proxyAssetId` —— 它不是这个层的 asset，
 * 而是「这层长什么样」的一部分。
 */
export interface AssetJob {
  layerId: string;
  name: string;
  dataUrl: string;
  slot?: 'assetId' | 'proxy';
}

export interface MappedImport {
  project: Project;
  report: ImportReport;
  assetJobs: AssetJob[];
}

/** 导入模式：prefer-editable 尽量拆成原生层；preserve-code 少拆、优先保代码 */
export type ImportMode = 'prefer-editable' | 'preserve-code';

export class ImportError extends Error {
  code: 'FORMAT' | 'UNSUPPORTED' | 'EMPTY' | 'TOO_BIG';
  constructor(code: ImportError['code'], message: string) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

const MAX_TEXT_BYTES = 8 * 1024 * 1024;

/* ------------------------------------------------------------------ 小工具 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback;
const text = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const firstOf = (o: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) if (o[key] !== undefined && o[key] !== null) return o[key];
  return undefined;
};
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

const MEDIA_EXT = /\.(mp4|webm|mov|m4v|ogg|png|jpe?g|webp|gif|avif|svg|bmp)$/i;

let idSeq = 0;
const localId = (prefix: string): string => `${prefix}_imp${(idSeq += 1).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ------------------------------------------------------------------ 嗅探 */

export function detectImportFormat(input: ImportInput): ImportFormat {
  if (input.format) return input.format;
  const name = input.name ?? '';
  const bytes = input.bytes;
  const lower = name.toLowerCase();

  if (bytes && looksLikeZip(bytes)) {
    const names = zipEntryNames(bytes);
    const has = (re: RegExp) => names.some((n) => re.test(n));
    if (has(/^manifest\.json$/i) && has(/^project\.json$/i)) return 'kly';
    if (has(/(^|\/)package\.json$/i) && (has(/(^|\/)Root\.[tj]sx?$/i) || has(/(^|\/)remotion\.config\.[tj]s$/i))) {
      return 'remotion';
    }
    if (has(/\.(tsx|jsx)$/i) && has(/(^|\/)package\.json$/i)) return 'remotion';
    return 'unknown';
  }

  const raw = input.text ?? (bytes ? safeDecode(bytes) : '');
  const trimmed = raw.trim();
  if (trimmed) {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const parsed = tryJson(trimmed);
      if (parsed) {
        if (isObj(parsed)) {
          if (parsed.format === AI_SCENE_FORMAT) return 'ai-scene';
          if (parsed.format === 'kinelayer-bundle') return 'kly-json';
          if (looksLikeProject(parsed)) return 'project-json';
          if (looksLikeScene(parsed)) return 'scene-json';
        }
        if (Array.isArray(parsed)) return 'scene-json';
      }
      return 'unknown';
    }
    if (trimmed.startsWith('<')) return 'html';
    if (/^\s*(<!doctype|<html|<div|<section|<style|<svg)/i.test(trimmed)) return 'html';
  }

  if (MEDIA_EXT.test(lower)) return 'media';
  return 'unknown';
}

function safeDecode(bytes: Uint8Array): string {
  if (bytes.length > MAX_TEXT_BYTES) return '';
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

function tryJson(raw: string): unknown {
  if (raw.length > MAX_TEXT_BYTES) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 「这是 Kinelayer 原生工程吗」
 *
 * 判据必须是**原生独有的字段**，不能只看 `layers[0].type` —— 外部场景 JSON 也写
 * `layers + width + duration`（Rendervid / cadence 都是这个形状），只看类型会把
 * 一个该被映射的场景误判成原生工程：结果是「精确还原」一个残缺工程，
 * 形状层直接消失、时长变成 0.1 秒，而报告还写着 100% 保真。这个 bug 比不支持导入更坏。
 *
 * 原生工程的每个图层都带 blendMode / locked / animation / inPoint / outPoint 整套，
 * 外部场景几乎不可能凑齐；再认一下顶层 schemaVersion 作为快速通道。
 */
function looksLikeProject(o: Record<string, unknown>): boolean {
  if (!Array.isArray(o.layers) || !o.layers.length) return false;
  const layers = (o.layers as unknown[]).filter(isObj);
  if (!layers.length) return false;
  const nativeKeys = ['blendMode', 'locked', 'animation', 'inPoint', 'outPoint'];
  const native = layers.filter((l) => nativeKeys.filter((k) => l[k] !== undefined).length >= 3).length;
  if (native < Math.ceil(layers.length * 0.8)) return false;
  return o.schemaVersion !== undefined || native === layers.length;
}

function looksLikeScene(o: Record<string, unknown>): boolean {
  const hasLayers = ['layers', 'elements', 'nodes', 'scenes', 'children', 'items'].some((k) => Array.isArray(o[k]));
  if (!hasLayers) return false;
  const hasCanvas = ['width', 'height', 'canvas', 'composition', 'size', 'resolution'].some((k) => o[k] !== undefined);
  const hasTime = ['duration', 'durationInFrames', 'durationMs', 'fps'].some((k) => o[k] !== undefined);
  return hasCanvas || hasTime;
}

/* ------------------------------------------------------------------ 预检 */

/**
 * 导入预检。
 *
 * 本来是纯同步函数（给定字节就能算），v2.5b 起 Remotion 分支要跑 babel AST，
 * 而 babel 是动态 import 进来的 —— 所以整个入口变成 async。
 * 其余格式仍然是同步算完，包一层 Promise 而已：**不读库、不写库**这条没变。
 */
export async function inspectImport(input: ImportInput): Promise<{ report: ImportReport; mapped?: MappedImport }> {
  const format = detectImportFormat(input);

  switch (format) {
    case 'kly':
      return { report: nativeReport('kly', input) };
    case 'kly-json':
      return { report: nativeReport('kly-json', input) };
    case 'project-json':
      return { report: nativeReport('project-json', input) };
    case 'ai-scene': {
      /* 预检与正式导入走同一个映射器（dryRun），报告里的数字就是导入后的数字 */
      try {
        const mapped = mapAiScene(input, 'prefer-editable', true);
        return { report: mapped.report, mapped };
      } catch (err) {
        const scene = tryJson(readText(input) ?? '');
        return {
          report: {
            format,
            supported: false,
            label: 'Kinelayer 场景语义层（scene.ai.json）',
            fidelity: 0,
            counts: countAiScene(scene),
            missingAssets: [],
            notes: [],
            blockers: [note((err as Error).message || 'scene.ai.json 解析失败')],
            preview: previewOfScene(scene),
          },
        };
      }
    }
    case 'scene-json':
      try {
        return mapScene(input, 'prefer-editable', true);
      } catch (err) {
        return {
          report: {
            format: 'scene-json',
            supported: false,
            label: '场景 JSON',
            fidelity: 0,
            counts: emptyCounts(),
            missingAssets: [],
            notes: [],
            blockers: [note((err as Error).message || '场景解析失败')],
            preview: null,
          },
        };
      }
    case 'html':
      return mapHtml(input, 'prefer-editable', true);
    case 'media':
      return { report: mediaReport(input) };
    case 'remotion':
      return mapRemotion(input, 'prefer-editable', true);
    default:
      return {
        report: {
          format: 'unknown',
          supported: false,
          label: '认不出这个文件',
          fidelity: 0,
          counts: emptyCounts(),
          missingAssets: [],
          notes: [],
          blockers: [note('支持 .kly / 场景 JSON / HTML / 图片视频 / Remotion 工程 ZIP')],
          preview: null,
        },
      };
  }
}

function emptyCounts(): ImportCounts {
  return { structured: 0, code: 0, media: 0, background: 0, tracks: 0, keyframes: 0 };
}

/** 关键帧数值留两位小数：GSAP 的 ease 中间值容易带 0.30000000000000004 这种尾巴 */
const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * html 层的 params。
 *
 * `designWidth/Height` 是「这段 HTML 当初是按多大画布写的」：图层被缩放之后
 * iframe 尺寸会变，但里面的 vw/vh、百分比定位仍然认设计稿尺寸。留着这两个数，
 * Stage 才能按 `图层宽 / designWidth` 去 scale，而不是让内容跟着盒子糊掉。
 */
const htmlParams = (width: number, height: number): Record<string, string | number> => ({
  designWidth: Math.round(width),
  designHeight: Math.round(height),
});

function readText(input: ImportInput): string | null {
  if (typeof input.text === 'string') return input.text;
  if (input.bytes) return safeDecode(input.bytes);
  return null;
}

function nativeReport(format: ImportFormat, input: ImportInput): ImportReport {
  const raw = readText(input);
  const parsed = raw ? tryJson(raw.trim()) : null;
  const project = isObj(parsed) && isObj(parsed.project) ? (parsed.project as Record<string, unknown>) : parsed;
  const layers = isObj(project) && Array.isArray(project.layers) ? (project.layers as Record<string, unknown>[]) : [];
  const counts = emptyCounts();
  for (const layer of layers) {
    const type = text(isObj(layer) ? layer.type : '');
    if (type === 'background') counts.background += 1;
    else if (type === 'code') counts.code += 1;
    else if (type === 'text') counts.structured += 1;
    else if (type === 'image' || type === 'video') {
      counts.structured += 1;
      counts.media += 1;
    }
    const tracks = isObj(layer) && isObj(layer.animation) && Array.isArray(layer.animation.tracks) ? layer.animation.tracks : [];
    counts.tracks += tracks.length;
    for (const t of tracks) {
      if (isObj(t) && Array.isArray(t.keyframes)) counts.keyframes += t.keyframes.length;
    }
  }
  return {
    format,
    supported: true,
    label: format === 'kly' ? 'Kinelayer 工程包（.kly / ZIP）' : 'Kinelayer 原生 JSON',
    fidelity: 100,
    counts,
    missingAssets: [],
    notes: [note('原生格式：图层、轨道、资源引用都按原样恢复')],
    blockers: [],
    preview: isObj(project)
      ? {
          name: text(project.name, '未命名'),
          width: num(project.width, 0),
          height: num(project.height, 0),
          duration: num(project.duration, 0),
          fps: num(project.fps, 0),
          sample: layers.slice(0, 6).map((l) => `${text(l.type, '?')} · ${text(l.name, '图层')}`),
        }
      : null,
  };
}

function previewOfScene(scene: unknown) {
  if (!isObj(scene)) return null;
  const canvas = isObj(scene.canvas) ? scene.canvas : {};
  const layers = Array.isArray(scene.layers) ? (scene.layers as Record<string, unknown>[]) : [];
  return {
    name: isObj(scene.project) ? text(scene.project.name, '导入的场景') : '导入的场景',
    width: num(canvas.width, 0),
    height: num(canvas.height, 0),
    duration: num(scene.duration, 0) * 1000,
    fps: num(scene.fps, 30),
    sample: layers.slice(0, 6).map((l) => `${text(l.type, '?')} · ${text(l.name, '图层')}`),
  };
}

function countAiScene(scene: unknown): ImportCounts {
  const counts = emptyCounts();
  if (!isObj(scene) || !Array.isArray(scene.layers)) return counts;
  for (const layer of scene.layers as Record<string, unknown>[]) {
    if (!isObj(layer)) continue;
    const type = text(layer.type);
    if (type === 'background') counts.background += 1;
    else if (type === 'code') counts.code += 1;
    else if (type === 'text') counts.structured += 1;
    else if (type === 'image' || type === 'video') {
      counts.structured += 1;
      counts.media += 1;
    }
    const tracks = Array.isArray(layer.tracks) ? (layer.tracks as Record<string, unknown>[]) : [];
    counts.tracks += tracks.length;
    for (const t of tracks) if (Array.isArray(t.keyframes)) counts.keyframes += t.keyframes.length;
  }
  return counts;
}


function mediaReport(input: ImportInput): ImportReport {
  const counts = emptyCounts();
  counts.media = 1;
  const video = /\.(mp4|webm|mov|m4v|ogg)$/i.test(input.name ?? '');
  return {
    format: 'media',
    supported: true,
    label: video ? '视频文件' : '图片文件',
    fidelity: 30,
    counts,
    missingAssets: [],
    notes: [note('媒体层没有图层语义：只有整体位置/尺寸/透明度，内部内容不可拆')],
    blockers: [],
    preview: { name: input.name ?? '媒体', width: 0, height: 0, duration: 0, fps: 30, sample: [] },
  };
}

/* ------------------------------------------------ Remotion 工程（v2.5b） */

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
};

/** Uint8Array → base64。分块拼接，避免 `...spread` 把大数组打爆调用栈 */
const dataUrlOfPath = (bytes: Uint8Array, path: string): string => {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  return bytesToDataUrl(bytes, MIME_BY_EXT[ext] ?? 'application/octet-stream');
};

/**
 * 把 `staticFile('assets/a.png')` 和 zip 内的真实路径对上。
 *
 * Remotion 的静态资源在 zip 里可能是 `public/assets/a.png`，也可能已经被剥掉 public/，
 * 还可能带 `./` 前缀 —— 只有后缀是可靠的。找不到就记进 missingAssets，
 * 绝不猜「大概是这张」。
 */
function matchAsset(assets: { path: string; bytes: Uint8Array }[], src: string): { path: string; bytes: Uint8Array } | null {
  const clean = src.replace(/^\.?\//, '').split('?')[0] ?? src;
  return (
    assets.find((a) => a.path === clean) ??
    assets.find((a) => a.path.endsWith(`/${clean}`)) ??
    assets.find((a) => clean.endsWith(`/${a.path}`)) ??
    null
  );
}

const baseName = (path: string): string => path.split('/').pop() ?? path;

/** Remotion 轨道 → 原生轨道（帧 → 毫秒，相对图层 inPoint） */
function remotionTracks(tracks: RemotionTrack[], msPerFrame: number, span: number): PropertyTrack[] {
  const out: PropertyTrack[] = [];
  for (const t of tracks) {
    const keys: Keyframe[] = [];
    for (const k of t.keyframes) {
      keys.push({
        id: localId('kf'),
        time: clamp(Math.round(k.frame * msPerFrame), 0, Math.max(0, span)),
        value: k.value,
        easing: easing(k.easing),
      });
    }
    if (!keys.length) continue;
    keys.sort((a, b) => a.time - b.time);
    out.push({ property: t.property, keyframes: keys });
  }
  return out;
}

function remotionFailure(input: ImportInput, message: string, hint?: string): ImportReport {
  const names = input.bytes ? zipEntryNames(input.bytes) : [];
  return {
    format: 'remotion',
    supported: false,
    label: 'Remotion 工程',
    fidelity: 0,
    counts: emptyCounts(),
    missingAssets: [],
    notes: names.length ? [note('包里认出 {n} 个条目', { n: names.length })] : [],
    blockers: [note(message), ...(hint ? [note(hint)] : [])],
    preview: { name: input.name ?? 'Remotion 工程', width: 0, height: 0, duration: 0, fps: 0, sample: names.slice(0, 6) },
  };
}

/**
 * Remotion 工程 → 工程。
 *
 * 三档结果，必须分开说：
 *   · 结构化层（text / image / box）→ 原生图层，位置尺寸透明度时长都能改
 *   · 轨道 → 原生关键帧（interpolate / spring 抽出来的）
 *   · leftovers → `remotion-component` 代码层，源码原样存着，内部关键帧不假装能编辑
 *
 * `mode === 'preserve-code'` 时不拆：整个 Composition 保持成一个代码层。
 * 这是给「我就想原样带着走」的用户留的路 —— 但默认不这么干，因为拆开才有编辑价值。
 */
export async function mapRemotion(
  input: ImportInput,
  mode: ImportMode = 'prefer-editable',
  dryRun = false,
): Promise<{ report: ImportReport; mapped?: MappedImport }> {
  if (!input.bytes) {
    return { report: remotionFailure(input, 'Remotion 工程要传 ZIP：源码在压缩包里，纯文本给不出组件结构') };
  }

  let parsed: RemotionParse;
  try {
    parsed = await parseRemotionZip(input.bytes, input.name);
  } catch (err) {
    return { report: remotionFailure(input, (err as Error).message || 'Remotion 解析失败') };
  }

  const comp = parsed.composition;
  const fps = Math.max(1, Math.round(comp.fps) || 30);
  const width = Math.max(1, Math.round(comp.width) || 1080);
  const height = Math.max(1, Math.round(comp.height) || 1080);
  const frames = Math.max(1, Math.round(comp.durationInFrames) || 1);
  const durationMs = Math.max(1, Math.round((frames / fps) * 1000));
  const msPerFrame = 1000 / fps;
  const span = durationMs;

  /*
   * 来源标成「AI 生成」：Remotion 代码视频在本产品里几乎只由 AI Agent 产出，
   * 规格也要求图层树给出这个徽标。悬浮说明里能核对的仍然是 remotion + 包名 + 时间，
   * 不靠这个字段撒谎。
   */
  const origin: LayerOrigin = {
    generator: 'ai',
    sourceFormat: 'remotion',
    sourceBundle: input.name,
    importedAt: Date.now(),
  };

  const layers: Layer[] = [createBackground({ width, height, kind: 'solid', color: '#0b0b10' })];
  const jobs: AssetJob[] = [];
  const missing: string[] = [];
  const notes: ImportNote[] = parsed.notes.map((n) => note(n.key, n.params));
  const counts = emptyCounts();

  const pushNote = (key: string, params?: Record<string, string | number>) => notes.push(note(key, params));

  /* preserve-code：整份 Composition 当一个代码层，不拆 */
  const keepWhole = mode === 'preserve-code';
  const entrySource = parsed.files.find((f) => f.path === comp.entryFile)?.code ?? '';

  if (!keepWhole) {
    for (const spec of parsed.layers) {
      const inPoint = clamp(Math.round(spec.from * msPerFrame), 0, Math.max(0, span - 1));
      const outPoint = clamp(inPoint + Math.round(spec.durationInFrames * msPerFrame), inPoint + 1, span);
      const box = {
        x: Math.round(spec.box.x),
        y: Math.round(spec.box.y),
        width: Math.max(1, Math.round(spec.box.width)),
        height: Math.max(1, Math.round(spec.box.height)),
      };
      const opacity = clamp(spec.opacity, 0, 1);
      let layer: Layer | null = null;

      if (spec.kind === 'text') {
        const base = createTextLayer({ width: box.width, height: box.height });
        layer = {
          ...base,
          name: (spec.name || '文本').slice(0, 60),
          text: spec.text ?? '',
          x: box.x,
          y: box.y,
          opacity,
          inPoint,
          outPoint,
          style: {
            ...base.style,
            fontSize: spec.style.fontSize ?? base.style.fontSize,
            fontWeight: spec.style.fontWeight ?? base.style.fontWeight,
            color: spec.style.color ?? base.style.color,
            align: spec.style.align ?? base.style.align,
            lineHeight: spec.style.lineHeight ?? base.style.lineHeight,
            letterSpacing: spec.style.letterSpacing ?? base.style.letterSpacing,
          },
          origin,
        };
        counts.structured += 1;
      } else if (spec.kind === 'image') {
        const base = createImageLayer({ width: box.width, height: box.height });
        const src = spec.src;
        if (src?.startsWith('data:')) {
          /* 内联 data URL 直接进资源池，不留在 layer 上（scene.ai.json 也不许塞 base64） */
          jobs.push({ layerId: base.id, name: `${spec.name || 'image'}.png`, dataUrl: src });
        } else if (src) {
          const hit = matchAsset(parsed.assets, src);
          if (hit) jobs.push({ layerId: base.id, name: baseName(hit.path), dataUrl: dataUrlOfPath(hit.bytes, hit.path) });
          else missing.push(src);
        }
        layer = {
          ...base,
          name: (spec.name || '图片').slice(0, 60),
          x: box.x,
          y: box.y,
          opacity,
          inPoint,
          outPoint,
          radius: spec.style.radius ?? 0,
          origin,
        };
        counts.structured += 1;
        counts.media += 1;
      } else {
        /* box：没有原生形状层，用生成的 canvas2d 兜住（可改代码，位置/尺寸/透明度能打点） */
        const base = createCodeLayer({ width: box.width, height: box.height });
        layer = {
          ...base,
          name: (spec.name || '盒子').slice(0, 60),
          x: box.x,
          y: box.y,
          opacity,
          inPoint,
          outPoint,
          code: {
            ...base.code,
            engine: 'canvas2d',
            source: shapeSnippet(false, spec.style.background ?? 'rgba(255,255,255,0.12)', spec.style.radius ?? 0),
            params: {},
          },
          origin,
        };
        counts.code += 1;
        pushNote('（Remotion）<{name}> 是带背景的容器，已生成 canvas2d 代码层', { name: spec.name });
      }

      if (!layer) continue;
      const tracks = remotionTracks(spec.tracks, msPerFrame, span);
      if (tracks.length) {
        layer.animation = { ...layer.animation, tracks };
        counts.tracks += tracks.length;
        for (const t of tracks) counts.keyframes += t.keyframes.length;
      }
      layers.push(layer);
    }
  } else {
    pushNote('preserve-code 模式：整个 Composition 保留为一个 Remotion 代码层，没有拆成原生图层');
  }

  /* leftovers → remotion-component 层。它们共用一份源码结构，但各自带自己的入口源码 */
  const leftovers = keepWhole
    ? [{ name: comp.componentName || comp.id, code: entrySource, reason: 'preserve-code', sourcePath: comp.entryFile }]
    : parsed.leftovers;

  const proxy = parsed.proxy;
  /*
   * 原工程源码树只挂第一层，且限体积：它的唯一用途是导出 remotion-kit 时原样落盘，
   * 让外部 render 有相对 import 可解。超限就不存 —— 宁可少导出整树，也不让工程 JSON 变成几 MB。
   */
  const sourceTree = parsed.files.filter((f) => !/node_modules|\.min\./i.test(f.path));
  const treeBytes = sourceTree.reduce((n, f) => n + f.code.length, 0);
  const keepTree = treeBytes <= 600_000 ? sourceTree : undefined;
  if (leftovers.length && !keepTree) {
    pushNote('原工程源码共 {n} 个文件，超过 600KB 上限没有随工程保存：remotion-kit 只能导出解析出来的组件', {
      n: sourceTree.length,
    });
  }
  let proxyLayerId: string | null = null;
  for (const left of leftovers) {
    const base = createCodeLayer({ width, height });
    const layer: Layer = {
      ...base,
      name: left.name.slice(0, 60) || 'Remotion 组件',
      x: 0,
      y: 0,
      inPoint: 0,
      outPoint: durationMs,
      code: {
        engine: 'remotion-component',
        source: left.code,
        params: {},
        runtime: {
          kind: 'remotion-component',
          entryCode: left.code,
          compositionId: comp.id,
          durationInFrames: frames,
          fps,
          width,
          height,
          previewMode: proxy ? 'proxy-video' : 'static-first-frame',
          reason: left.reason,
          ...(proxyLayerId ? {} : keepTree ? { sources: keepTree } : {}),
        },
      },
      origin,
    };
    layers.push(layer);
    counts.code += 1;
    if (!proxyLayerId) proxyLayerId = layer.id;
  }

  /* 代理视频只挂一份，所有 remotion 层共享同一个 assetId */
  if (proxy && proxyLayerId) {
    jobs.push({ layerId: proxyLayerId, name: baseName(proxy.path), dataUrl: dataUrlOfPath(proxy.bytes, proxy.path), slot: 'proxy' });
    pushNote('找到代理视频「{name}」，remotion 层按它预览（不再是静态首帧）', { name: baseName(proxy.path) });
  } else if (leftovers.length) {
    pushNote('remotion 层没有代理视频：时间轴上显示静态首帧卡片，要看到动画得在外部 `npx remotion render`');
  }

  if (leftovers.length) {
    pushNote('{n} 个组件整块保留为 Remotion 代码层（内部关键帧不展示，双击看源码）', { n: leftovers.length });
  }

  /* ---- 保真度：能编辑的东西越多越高，缺资源扣分 ---- */
  const editable = counts.structured * 2 + counts.code; // 结构化层更值钱
  const totalWeight = parsed.layers.length * 2 + parsed.leftovers.length;
  const baseScore = totalWeight > 0 ? (editable / totalWeight) * 100 : 0;
  const penalty = Math.min(20, missing.length * 5);
  const fidelity = keepWhole ? 25 : clamp(Math.round(baseScore - penalty), 5, 95);

  const blockers: ImportNote[] = [];
  if (!parsed.layers.length && !parsed.leftovers.length) {
    blockers.push(note('这个 Composition 里没有可识别的元素，也没有可保留的组件'));
  }

  const report: ImportReport = {
    format: 'remotion',
    supported: blockers.length === 0,
    label: 'Remotion 工程（静态解析）',
    fidelity,
    counts,
    missingAssets: missing,
    notes: dedupeNotes(notes),
    blockers: dedupeNotes(blockers),
    preview: {
      name: input.name ?? comp.id,
      width,
      height,
      duration: durationMs,
      fps,
      sample: comp.id ? [comp.id, comp.componentName, comp.entryFile].filter(Boolean) : parsed.files.slice(0, 4).map((f) => f.path),
    },
  };

  if (!report.supported || dryRun) return { report };

  const project = normalizeProject({
    ...createEmptyProject(input.name ?? comp.id ?? 'Remotion 导入'),
    name: (input.name ?? comp.id ?? 'Remotion 导入').replace(/\.[^.]+$/, ''),
    width,
    height,
    duration: durationMs,
    fps,
    loop: true,
    layers,
    assets: [],
    fonts: [],
  });

  return { report, mapped: { project, report, assetJobs: jobs } };
}

/* ------------------------------------------------------------------ 时间单位 */

interface CanvasInfo {
  width: number;
  height: number;
  durationMs: number;
  fps: number;
  name: string;
  /** 场景里的 1 个时间单位 = 多少毫秒 */
  scale: number;
}

function readCanvas(root: Record<string, unknown>): CanvasInfo {
  const comp = isObj(root.composition) ? root.composition : isObj(root.config) ? root.config : {};
  const canvas = isObj(root.canvas) ? root.canvas : isObj(root.size) ? root.size : {};
  const res = isObj(root.resolution) ? root.resolution : {};

  const width = Math.max(1, Math.round(num(firstOf(root, ['width', 'w']) ?? firstOf(comp, ['width', 'w']) ?? firstOf(canvas, ['width', 'w']) ?? firstOf(res, ['width', 'w']), 1080)));
  const height = Math.max(1, Math.round(num(firstOf(root, ['height', 'h']) ?? firstOf(comp, ['height', 'h']) ?? firstOf(canvas, ['height', 'h']) ?? firstOf(res, ['height', 'h']), 1440)));
  const fps = clamp(Math.round(num(firstOf(root, ['fps', 'frameRate']) ?? firstOf(comp, ['fps', 'frameRate']), 30)), 1, 120);

  const unit = text(firstOf(root, ['timeUnit', 'unit', 'timeScale']) ?? firstOf(comp, ['timeUnit']));
  let scale: number;
  if (/^(ms|millisecond)/i.test(unit)) scale = 1;
  else if (/^(s|sec|second)/i.test(unit)) scale = 1000;
  else scale = 0; // 待推断

  let durationMs: number;
  const durationInFrames = num(firstOf(root, ['durationInFrames', 'totalFrames', 'frames']) ?? firstOf(comp, ['durationInFrames', 'totalFrames']), 0);
  const explicitMs = num(firstOf(root, ['durationMs']), 0);
  const rawDuration = num(firstOf(root, ['duration', 'length', 'totalTime']) ?? firstOf(comp, ['duration', 'length']), 0);

  if (durationInFrames > 0) {
    durationMs = (durationInFrames / fps) * 1000;
    if (!scale) scale = 1000;
  } else if (explicitMs > 0) {
    durationMs = explicitMs;
    scale = 1;
  } else if (rawDuration > 0) {
    /* 没有单位提示：≤120 当作秒（10s / 30s 这类），否则当作毫秒 */
    if (!scale) scale = rawDuration <= 120 ? 1000 : 1;
    durationMs = rawDuration * scale;
  } else {
    if (!scale) scale = 1000;
    durationMs = 4000;
  }
  if (!scale) scale = durationMs / Math.max(1, rawDuration) >= 500 ? 1 : 1000;

  return {
    width,
    height,
    durationMs: clamp(Math.round(durationMs), 100, 10 * 60 * 1000),
    fps,
    name: text(firstOf(root, ['name', 'title', 'projectName']) ?? firstOf(root, ['project']), '导入的场景'),
    scale,
  };
}

/* ------------------------------------------------------------------ 样式 */

const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#00a854',
  blue: '#1677ff',
  yellow: '#fadb14',
  orange: '#fa8c16',
  purple: '#722ed1',
  gray: '#8c8c8c',
  grey: '#8c8c8c',
  transparent: 'rgba(0,0,0,0)',
};

function color(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const v = raw.trim();
  if (!v) return fallback;
  const lower = v.toLowerCase();
  if (NAMED_COLORS[lower]) return NAMED_COLORS[lower];
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v;
  if (/^(rgb|hsl)a?\(/i.test(v)) return v;
  return fallback;
}

function easing(raw: unknown): EasingSpec {
  if (isObj(raw)) {
    const kind = text(raw.kind ?? raw.type);
    if (kind === 'cubic-bezier' && Array.isArray(raw.bezier) && raw.bezier.length === 4) {
      return { kind: 'cubic-bezier', bezier: raw.bezier.map((n) => num(n, 0)) as [number, number, number, number] };
    }
    if ((EASINGS as string[]).includes(kind)) return { kind: kind as EasingName };
  }
  if (typeof raw === 'string') {
    const v = raw.trim().toLowerCase();
    const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(v);
    if (bezier) {
      const parts = bezier[1]!.split(',').map((s) => Number(s.trim()));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        return { kind: 'cubic-bezier', bezier: parts as [number, number, number, number] };
      }
    }
    const compact = v.replace(/[\s_]+/g, '-');
    const alias: Record<string, EasingName> = {
      ease: 'ease-in-out',
      easein: 'ease-in',
      easeout: 'ease-out',
      'ease-in-out': 'ease-in-out',
      easeinout: 'ease-in-out',
      linear: 'linear',
      'ease-out-cubic': 'ease-out-cubic',
      'ease-in-cubic': 'ease-in-cubic',
      'ease-out-quad': 'ease-out-quad',
      'ease-in-quad': 'ease-in-quad',
      'ease-out-back': 'ease-out-back',
      'ease-out-elastic': 'ease-out-elastic',
    };
    if (alias[compact]) return { kind: alias[compact]! };
    if ((EASINGS as string[]).includes(compact)) return { kind: compact as EasingName };
  }
  return { kind: 'ease-out' };
}

const PROP_ALIAS: Record<string, AnimatableProperty | null> = {
  opacity: 'opacity',
  alpha: 'opacity',
  x: 'x',
  left: 'x',
  translatex: 'x',
  tx: 'x',
  y: 'y',
  top: 'y',
  translatey: 'y',
  ty: 'y',
  width: 'width',
  w: 'width',
  height: 'height',
  h: 'height',
  rotation: 'rotation',
  rotate: 'rotation',
  angle: 'rotation',
  fontsize: 'fontSize',
  'font-size': 'fontSize',
  letterspacing: 'letterSpacing',
  tracking: 'letterSpacing',
  scale: null,
  scalex: null,
  scaley: null,
};

/* ------------------------------------------------------------------ 场景映射 */

interface MapCtx {
  info: CanvasInfo;
  mode: ImportMode;
  notes: NoteList;
  missing: string[];
  assetJobs: MappedImport['assetJobs'];
  counts: ImportCounts;
  origin: LayerOriginFormat;
  sourceBundle?: string;
}

export function mapScene(input: ImportInput, mode: ImportMode = 'prefer-editable', dryRun = false): MappedImport {
  const raw = readText(input);
  const parsed = raw ? tryJson(raw) : null;
  if (!parsed) throw new ImportError('FORMAT', '这不是合法的 JSON 场景描述');
  const root = Array.isArray(parsed) ? { layers: parsed } : isObj(parsed) ? parsed : null;
  if (!root) throw new ImportError('FORMAT', '场景 JSON 的顶层必须是对象或数组');

  const info = readCanvas(root);
  const ctx: MapCtx = {
    info,
    mode,
    notes: new NoteList(),
    missing: [],
    assetJobs: [],
    counts: emptyCounts(),
    origin: 'scene-json',
    sourceBundle: input.name,
  };

  const rawLayers = (['layers', 'elements', 'nodes', 'scenes', 'children', 'items']
    .map((k) => root[k])
    .find((v) => Array.isArray(v)) ?? []) as unknown[];

  if (!rawLayers.length) ctx.notes.push('场景里没有图层数组，只建了一个空画布');

  const layers: Layer[] = [];
  for (const item of rawLayers) {
    if (!isObj(item)) continue;
    const mapped = mapLayer(item, ctx, layers.length);
    if (mapped) layers.push(mapped);
  }

  const bgColor = color(firstOf(root, ['backgroundColor', 'background', 'bgColor']), '#141419');
  const background = createBackground({ width: info.width, height: info.height, kind: 'solid', color: bgColor });

  const project = normalizeProject({
    ...createEmptyProject(info.name),
    name: info.name,
    width: info.width,
    height: info.height,
    duration: info.durationMs,
    fps: info.fps,
    layers: [background, ...layers],
    assets: [],
    fonts: [],
  });
  /* normalizeProject 会给背景补默认值，这里把颜色再压一次，避免被默认值盖掉 */
  const bg = project.layers[0];
  if (bg && bg.type === 'background') bg.color = bgColor;

  const report: ImportReport = {
    format: 'scene-json',
    supported: true,
    label: '场景 JSON（Rendervid / cadence 风格）',
    fidelity: fidelityOf(ctx),
    counts: ctx.counts,
    missingAssets: [...new Set(ctx.missing)],
    notes: dedupeNotes(ctx.notes.all),
    blockers: [],
    preview: {
      name: info.name,
      width: info.width,
      height: info.height,
      duration: info.durationMs,
      fps: info.fps,
      sample: layers.slice(0, 6).map((l) => `${l.type} · ${l.name}`),
    },
  };

  if (dryRun) return { project, report, assetJobs: [] };
  return { project, report, assetJobs: ctx.assetJobs };
}

function fidelityOf(ctx: MapCtx): number {
  let score = 96;
  score -= ctx.counts.code * 8;
  score -= ctx.missing.length * 5;
  const notesAboutLoss = ctx.notes.all.filter((n) => n.key.includes('无法') || n.key.includes('跳过')).length;
  score -= notesAboutLoss * 6;
  return clamp(Math.round(score), 20, 98);
}

function layerType(item: Record<string, unknown>): string {
  const raw = text(firstOf(item, ['type', 'kind', 'elementType', 'nodeType'])).toLowerCase();
  if (['text', 'title', 'heading', 'paragraph', 'subtitle', 'caption'].includes(raw)) return 'text';
  if (['image', 'img', 'picture', 'photo', 'logo'].includes(raw)) return 'image';
  if (['video', 'movie', 'clip'].includes(raw)) return 'video';
  if (['code', 'canvas', 'script', 'shader', 'glsl'].includes(raw)) return 'code';
  if (['rect', 'rectangle', 'shape', 'box', 'div', 'ellipse', 'circle', 'path', 'line'].includes(raw)) return 'shape';
  if (['group', 'container', 'frame', 'layer'].includes(raw)) return 'group';
  if (raw === 'background' || raw === 'bg') return 'background';
  /* 没写 type 但带了文字 → 当文本；带了 src → 当图片 */
  if (firstOf(item, ['text', 'content', 'value']) !== undefined) return 'text';
  if (firstOf(item, ['src', 'url', 'href', 'image', 'video', 'asset']) !== undefined) return 'image';
  return 'unknown';
}

function readBox(item: Record<string, unknown>, info: CanvasInfo): { x: number; y: number; width: number; height: number } {
  const pos = isObj(item.position) ? item.position : isObj(item.transform) ? item.transform : {};
  const size = isObj(item.size) ? item.size : isObj(item.frame) ? item.frame : {};
  const rect = isObj(item.rect) ? item.rect : isObj(item.bounds) ? item.bounds : {};
  const x = num(firstOf(item, ['x', 'left']) ?? firstOf(pos, ['x', 'left']) ?? firstOf(rect, ['x', 'left']), 0);
  const y = num(firstOf(item, ['y', 'top']) ?? firstOf(pos, ['y', 'top']) ?? firstOf(rect, ['y', 'top']), 0);
  const width = num(firstOf(item, ['width', 'w']) ?? firstOf(size, ['width', 'w']) ?? firstOf(rect, ['width', 'w']), info.width);
  const height = num(firstOf(item, ['height', 'h']) ?? firstOf(size, ['height', 'h']) ?? firstOf(rect, ['height', 'h']), info.height);
  return { x: Math.round(x), y: Math.round(y), width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

function readTiming(item: Record<string, unknown>, info: CanvasInfo): { inPoint: number; outPoint: number } {
  const rawIn = firstOf(item, ['inPoint', 'in', 'start', 'startTime', 'from', 'begin']);
  const rawOut = firstOf(item, ['outPoint', 'out', 'end', 'endTime', 'to', 'finish']);
  const rawDur = firstOf(item, ['duration', 'length']);
  const inPoint = rawIn === undefined ? 0 : num(rawIn, 0) * info.scale;
  let outPoint: number;
  if (rawOut !== undefined) outPoint = num(rawOut, 0) * info.scale;
  else if (rawDur !== undefined) outPoint = inPoint + num(rawDur, 0) * info.scale;
  else outPoint = info.durationMs;
  return {
    inPoint: clamp(Math.round(inPoint), 0, info.durationMs),
    outPoint: clamp(Math.round(outPoint), 0, info.durationMs),
  };
}

function readTextStyle(item: Record<string, unknown>, base: TextStyle): TextStyle {
  const style = isObj(item.style) ? item.style : isObj(item.font) ? item.font : isObj(item.props) ? item.props : {};
  const src = { ...item, ...style };
  return {
    ...base,
    fontFamily: text(firstOf(src, ['fontFamily', 'font', 'family']), base.fontFamily),
    fontSize: Math.max(4, num(firstOf(src, ['fontSize', 'size', 'font-size']), base.fontSize)),
    fontWeight: clamp(Math.round(num(firstOf(src, ['fontWeight', 'weight', 'bold']), base.fontWeight)), 100, 900),
    fontStyle: /italic/i.test(text(firstOf(src, ['fontStyle', 'style']))) ? 'italic' : base.fontStyle,
    lineHeight: Math.max(0.6, num(firstOf(src, ['lineHeight']), base.lineHeight)),
    letterSpacing: num(firstOf(src, ['letterSpacing', 'tracking']), base.letterSpacing),
    align: (['left', 'center', 'right'].includes(text(firstOf(src, ['align', 'textAlign']))) ? text(firstOf(src, ['align', 'textAlign'])) : base.align) as TextStyle['align'],
    color: color(firstOf(src, ['color', 'fill', 'textColor']), base.color),
    uppercase: firstOf(src, ['uppercase', 'textTransform']) === true || /uppercase/i.test(text(firstOf(src, ['textTransform']))),
  };
}

function mapLayer(item: Record<string, unknown>, ctx: MapCtx, index: number): Layer | null {
  const kind = layerType(item);
  const box = readBox(item, ctx.info);
  const timing = readTiming(item, ctx.info);
  const name = text(firstOf(item, ['name', 'label', 'title', 'id']), `图层 ${index + 1}`).slice(0, 80);
  const opacity = clamp(num(firstOf(item, ['opacity', 'alpha']), 1), 0, 1);
  const rotation = num(firstOf(item, ['rotation', 'rotate', 'angle']), 0);
  const origin = { generator: 'import' as const, sourceFormat: ctx.origin, sourceBundle: ctx.sourceBundle, importedAt: Date.now() };

  let layer: Layer | null = null;

  if (kind === 'background') {
    ctx.counts.background += 1;
    return null; // 背景单独建，避免出现两个 background
  }

  if (kind === 'text') {
    const content = text(firstOf(item, ['text', 'content', 'value', 'children']), '');
    if (!content) {
      ctx.notes.push('文本层「{name}」没有文字内容，已跳过', { name });
      return null;
    }
    const base = createTextLayer({ width: box.width, height: box.height });
    layer = {
      ...base,
      id: localId('ly'),
      name,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation,
      opacity,
      text: content,
      inPoint: timing.inPoint,
      outPoint: timing.outPoint,
      style: readTextStyle(item, base.style),
      origin,
    };
    ctx.counts.structured += 1;
  } else if (kind === 'image' || kind === 'video') {
    const src = text(firstOf(item, ['src', 'url', 'href', 'image', 'video', 'asset', 'path']));
    const isVideo = kind === 'video' || /\.(mp4|webm|mov|m4v|ogg)$/i.test(src) || text(firstOf(item, ['type', 'kind'])) === 'video';
    const base = isVideo ? createVideoLayer({ width: box.width, height: box.height }) : createImageLayer({ width: box.width, height: box.height });
    const layerId = localId('ly');
    let assetId: string | null = null;
    if (src.startsWith('data:')) {
      ctx.assetJobs.push({ layerId, name: text(firstOf(item, ['name', 'label']), isVideo ? 'video' : 'image'), dataUrl: src });
      assetId = `pending:${layerId}`;
      ctx.notes.push('媒体「{name}」以 data URL 内嵌，导入时会写进资源库', { name });
    } else if (src) {
      ctx.missing.push(`${name} → ${src}`);
      ctx.notes.push('媒体「{name}」引用外部路径 {src}，包里没带文件，图层先建但资源缺失', { name, src });
    } else {
      ctx.notes.push('媒体层「{name}」没有 src，建成空占位', { name });
    }
    layer = {
      ...base,
      id: layerId,
      name,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation,
      opacity,
      assetId,
      inPoint: timing.inPoint,
      outPoint: timing.outPoint,
      origin,
    } as Layer;
    ctx.counts.structured += 1;
    ctx.counts.media += 1;
  } else if (kind === 'code') {
    const spec = isObj(item.code) ? item.code : {};
    const source = text(firstOf(spec, ['source', 'code']) ?? firstOf(item, ['source', 'code']), '');
    const engineRaw = text(firstOf(spec, ['engine']) ?? firstOf(item, ['engine']), 'canvas2d');
    const engine: CodeEngine = (['canvas2d', 'glsl', 'html'].includes(engineRaw) ? engineRaw : engineRaw === 'shader' ? 'glsl' : 'canvas2d') as CodeEngine;
    const base = createCodeLayer({ width: box.width, height: box.height });
    layer = {
      ...base,
      id: localId('ly'),
      name,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation,
      opacity,
      inPoint: timing.inPoint,
      outPoint: timing.outPoint,
      code: { ...base.code, engine, source, params: isObj(spec.params) ? (spec.params as Record<string, string | number | boolean>) : {} },
      origin,
    };
    ctx.counts.code += 1;
    ctx.notes.push('代码层「{name}」：{summary}', { name, summary: describeCode(layer.type === 'code' ? layer.code : base.code) });
  } else if (kind === 'shape') {
    if (ctx.mode === 'preserve-code') {
      ctx.notes.push('形状「{name}」在 preserve-code 模式下被跳过', { name });
      return null;
    }
    /* 没有原生形状层，用生成的 canvas2d 代码兜住 —— 至少位置/尺寸/透明度还能打关键帧 */
    const fill = color(firstOf(item, ['fill', 'backgroundColor', 'color', 'background']), 'rgba(255,255,255,0.12)');
    const radius = Math.max(0, num(firstOf(item, ['radius', 'borderRadius', 'cornerRadius']), 0));
    const isEllipse = /ellipse|circle/i.test(text(firstOf(item, ['type', 'kind'])));
    const base = createCodeLayer({ width: box.width, height: box.height });
    layer = {
      ...base,
      id: localId('ly'),
      name,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation,
      opacity,
      inPoint: timing.inPoint,
      outPoint: timing.outPoint,
      code: { ...base.code, engine: 'canvas2d', source: shapeSnippet(isEllipse, fill, radius), params: {} },
      /*
       * 来源仍记成「场景 JSON」，不改成 raw：徽标要回答的是「这层从哪个文件来的」，
       * 不是「它现在的代码是我拼的」。后者写在 notes 里（「已生成 canvas2d 代码层」），
       * 混进 sourceFormat 会让图层树上的徽标骗人。
       */
      origin,
    };
    ctx.counts.code += 1;
    ctx.notes.push('形状「{name}」没有对应的原生图层类型，已生成 canvas2d 代码层（可改代码，但内部不可打点）', { name });
  } else if (kind === 'group') {
    /* 组不建层，但把组上的动画记下来 —— 组动画无处安放，只能提示 */
    ctx.notes.push('分组「{name}」没有展平：Kinelayer 没有图层组，子元素逐个导入', { name });
    return null;
  } else {
    ctx.notes.push('图层「{name}」类型无法识别，已跳过', { name });
    return null;
  }

  if (!layer) return null;

  /* 轨道 */
  const tracks = mapTracks(item, layer, ctx);
  if (tracks.length) {
    layer.animation = { ...layer.animation, tracks };
    ctx.counts.tracks += tracks.length;
    for (const t of tracks) ctx.counts.keyframes += t.keyframes.length;
  }
  return layer;
}

function shapeSnippet(ellipse: boolean, fill: string, radius: number): string {
  const body = ellipse
    ? `ctx.beginPath();
ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
ctx.fill();`
    : radius > 0
      ? `roundedRect(ctx, 0, 0, width, height, ${radius});
ctx.fill();`
      : `ctx.fillRect(0, 0, width, height);`;
  const helper =
    !ellipse && radius > 0
      ? `
function roundedRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.quadraticCurveTo(x + w, y, x + w, y + rr);
  c.lineTo(x + w, y + h - rr);
  c.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  c.lineTo(x + rr, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - rr);
  c.lineTo(x, y + rr);
  c.quadraticCurveTo(x, y, x + rr, y);
  c.closePath();
}
`
      : '';
  return `// 导入管线生成的形状层：原工程里的 ${ellipse ? 'ellipse/circle' : 'rect'} 没有对应的原生图层
ctx.clearRect(0, 0, width, height);
ctx.fillStyle = ${JSON.stringify(fill)};
${body}
${helper}`;
}

/* ------------------------------------------------------------------ 轨道 */

function mapTracks(item: Record<string, unknown>, layer: Layer, ctx: MapCtx): PropertyTrack[] {
  const raw = firstOf(item, ['animations', 'tracks', 'keyframes', 'motion', 'timeline']);
  if (raw === undefined || raw === null) return [];

  const span = Math.max(1, layer.outPoint - layer.inPoint);
  const buckets = new Map<AnimatableProperty, Keyframe[]>();
  const skipped: string[] = [];

  const push = (propRaw: string, keys: { time: number; value: number; easing: EasingSpec }[]) => {
    const prop = PROP_ALIAS[propRaw.toLowerCase().replace(/[\s_]/g, '')];
    if (prop === undefined) {
      skipped.push(propRaw);
      return;
    }
    if (prop === null) {
      skipped.push(`${propRaw}（没有对应轨道）`);
      return;
    }
    if (!keys.length) return;
    const list = buckets.get(prop) ?? [];
    for (const k of keys) {
      list.push({
        id: localId('kf'),
        time: k.time,
        value: k.value,
        easing: k.easing,
      });
    }
    buckets.set(prop, list);
  };

  const normalizeKeys = (propRaw: string, arr: unknown[]) => {
    const rawTimes: number[] = [];
    const parsed: { time: number; value: number; easing: EasingSpec }[] = [];
    for (const k of arr) {
      if (!isObj(k)) continue;
      const t = num(firstOf(k, ['time', 't', 'at', 'offset']), NaN);
      const base = num(firstOf(k, ['value', 'v', 'to', 'y']), NaN);
      if (!Number.isFinite(t) || !Number.isFinite(base)) continue;
      rawTimes.push(t * ctx.info.scale);
      parsed.push({ time: t * ctx.info.scale, value: base, easing: easing(firstOf(k, ['easing', 'ease', 'curve'])) });
    }
    if (!parsed.length) return;
    /* 关键帧时间是绝对的还是相对的？超出图层时长的一定是绝对时间 */
    const maxT = Math.max(...rawTimes);
    const absolute = maxT > span + 1;
    const shifted = parsed.map((p) => ({
      ...p,
      time: Math.round(absolute ? clamp(p.time - layer.inPoint, 0, span) : clamp(p.time, 0, span)),
    }));
    shifted.sort((a, b) => a.time - b.time);
    push(propRaw, shifted);
  };

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!isObj(entry)) continue;
      const propRaw = text(firstOf(entry, ['property', 'prop', 'name', 'target', 'attribute']));
      if (Array.isArray(entry.keyframes)) {
        normalizeKeys(propRaw, entry.keyframes);
      } else if (firstOf(entry, ['from', 'to']) !== undefined) {
        /* from/to 补间：起止两个关键帧 */
        const start = num(firstOf(entry, ['start', 'time', 'at', 'delay']), 0);
        const dur = num(firstOf(entry, ['duration', 'dur', 'length']), 0.5);
        const ez = easing(firstOf(entry, ['easing', 'ease', 'curve']));
        const from = num(firstOf(entry, ['from']), 1);
        const to = num(firstOf(entry, ['to']), 0);
        normalizeKeys(propRaw, [
          { time: start, value: from, easing: ez },
          { time: start + dur, value: to, easing: ez },
        ]);
      }
    }
  } else if (isObj(raw)) {
    for (const [propRaw, arr] of Object.entries(raw)) {
      if (Array.isArray(arr)) normalizeKeys(propRaw, arr);
    }
  }

  if (skipped.length) {
    const unique = [...new Set(skipped)].slice(0, 4);
    ctx.notes.push('「{name}」里 {props} 的动画无法映射为轨道，已跳过', { name: layer.name, props: unique.join('、') });
  }

  return [...buckets.entries()].map(([property, keyframes]) => ({ property, keyframes }));
}

/* ------------------------------------------------- scene.ai.json 回灌 */

/**
 * 把 `scene.ai.json` 摊回「场景 JSON」的形状，让 mapScene 这条管子直接吃下去。
 *
 * 为什么不写第二套映射：`scene.ai.json` 本身就是 project.json 的投影，字段是 scene-json 的子集 ——
 * 轨道形状 `{property, keyframes:[{time,value,easing}]}` 原样能认、`inPoint/outPoint` 是秒而
 * readCanvas 推断出的 scale 正好是 1000。真正对不上的只有三处，在这个函数里补：
 *   box{x,y,w,h} → x/y/width/height；asset{id,name} → src（只有名字，没有字节）；code 嵌套。
 *
 * 反过来说，**必须**是「摊平」而不是「另写一份映射器」：两份实现某天一定会分叉，
 * 然后「导出的 scene.ai.json 导不回来」这种 bug 就出现了，而它只有在用户想回滚时才会炸。
 */
function adaptAiScene(scene: Record<string, unknown>): Record<string, unknown> {
  const canvas = isObj(scene.canvas) ? scene.canvas : {};
  const project = isObj(scene.project) ? scene.project : {};
  const rawLayers = Array.isArray(scene.layers) ? scene.layers.filter(isObj) : [];

  let backgroundColor: string | undefined;
  const layers = rawLayers.map((layer) => {
    const box = isObj(layer.box) ? layer.box : {};
    const out: Record<string, unknown> = {
      ...layer,
      x: num(box.x, 0),
      y: num(box.y, 0),
      width: num(box.width, num(canvas.width, 1080)),
      height: num(box.height, num(canvas.height, 1440)),
    };
    if (layer.type === 'background' && !backgroundColor) {
      const paint = isObj(layer.paint) ? layer.paint : {};
      const solid = firstOf(paint, ['color']);
      if (typeof solid === 'string' && solid.trim()) backgroundColor = color(solid, '#141419');
    }
    if (layer.type === 'image' || layer.type === 'video') {
      /* 只有资源名：scene.ai.json 按设计不带 base64，回灌时这一层会是空占位 */
      out.src = isObj(layer.asset) ? text(layer.asset.name) : '';
    }
    if (layer.type === 'code') {
      out.code = {
        engine: text(layer.engine, 'canvas2d'),
        source: text(layer.code),
        params: isObj(layer.params) ? layer.params : {},
      };
    }
    return out;
  });

  return {
    name: text(project.name, '导入的场景'),
    canvas: { width: num(canvas.width, 1080), height: num(canvas.height, 1440) },
    /* AiScene 用秒：≤120 会被 readCanvas 判成秒，与轨道关键帧的单位一致 */
    duration: num(scene.duration, 4),
    fps: num(scene.fps, 30),
    backgroundColor,
    layers,
  };
}

export function mapAiScene(input: ImportInput, mode: ImportMode = 'prefer-editable', dryRun = false): MappedImport {
  const raw = readText(input);
  const parsed = raw ? tryJson(raw) : null;
  if (!isObj(parsed)) throw new ImportError('FORMAT', 'scene.ai.json 的顶层必须是对象');
  const mapped = mapScene({ text: JSON.stringify(adaptAiScene(parsed)), name: input.name }, mode, dryRun);

  /* mapScene 报告的是 scene-json：改回真实来源，图层徽标与降级报告才对得上 */
  mapped.report.format = 'ai-scene';
  mapped.report.label = 'Kinelayer 场景语义层（scene.ai.json）';
  for (const layer of mapped.project.layers) {
    if (layer.origin) layer.origin.sourceFormat = 'ai-scene';
  }
  const media = mapped.report.counts.media;
  if (media > 0) {
    mapped.report.notes.push(
      note('{n} 个媒体层只剩资源名（scene.ai.json 不带二进制），导入后需要重新指定图片/视频', { n: media }),
    );
  }
  return mapped;
}

/* ------------------------------------------------------------------ HTML / 媒体 */

export async function mapHtml(
  input: ImportInput,
  mode: ImportMode = 'prefer-editable',
  dryRun = false,
): Promise<{ report: ImportReport; mapped?: MappedImport }> {
  const raw = readText(input) ?? '';

  let parsed: HtmlParse;
  try {
    parsed = await parseHtmlDocument(raw, input.name);
  } catch (err) {
    return { report: htmlFailure(input, (err as Error).message || 'HTML 解析失败') };
  }

  const width = Math.max(1, Math.round(parsed.size.width));
  const height = Math.max(1, Math.round(parsed.size.height));
  const duration = clamp(Math.round(parsed.durationMs), 500, 600_000);

  /*
   * sourceFormat 记成 gsap 还是 html，看有没有真提取到动画：
   * 记错会误导「这层到底有没有时间信息」，宁可保守。
   */
  const origin: LayerOrigin = {
    generator: 'import',
    sourceFormat: parsed.tweens.length ? 'gsap' : 'html',
    sourceBundle: input.name,
    importedAt: Date.now(),
    parser: 'html-dom/1',
    external: parsed.externalDeps.length ? parsed.externalDeps.slice(0, 12) : undefined,
  };

  const notes: ImportNote[] = parsed.notes.map((n) => note(n.key, n.params));
  const pushNote = (key: string, params?: Record<string, string | number>) => notes.push(note(key, params));
  const counts = emptyCounts();
  /*
   * 底色从 HTML 的 body 读，不再写死黑色。
   * leftover 的 iframe 被强制成透明背景（见 htmlImport），所以底色只能由这一层承载 ——
   * 写死黑色会让「深紫渐变的海报」导进来变成黑的。
   */
  const layers: Layer[] = [
    createBackground({ width, height, kind: 'solid', color: parsed.background || '#000000' }),
  ];
  const jobs: AssetJob[] = [];
  const missing: string[] = [];

  /* preserve-code：不拆，整份 HTML 一个代码层（用户明确要「原样带走」时） */
  if (mode === 'preserve-code') {
    pushNote('preserve-code 模式：整份 HTML 保留为一个代码层，没有拆成原生图层');
    const base = createCodeLayer({ width, height });
    layers.push({
      ...base,
      name: (input.name ?? 'HTML 片段').slice(0, 60),
      x: 0,
      y: 0,
      inPoint: 0,
      outPoint: duration,
      code: { ...base.code, engine: 'html', source: raw, params: htmlParams(width, height) },
      origin,
    });
    counts.code = 1;
  } else {
    /* ---- 结构化层 ---- */
    for (const block of parsed.blocks) {
      const box = block.box;
      if (block.kind === 'text') {
        const base = createTextLayer({ width: box.width, height: box.height });
        layers.push({
          ...base,
          name: block.name,
          text: block.text,
          x: Math.round(box.x),
          y: Math.round(box.y),
          opacity: block.opacity,
          inPoint: 0,
          outPoint: duration,
          style: {
            ...base.style,
            fontSize: block.style.fontSize,
            fontWeight: block.style.fontWeight,
            color: block.style.color,
            align: block.style.align,
            lineHeight: block.style.lineHeight,
            letterSpacing: block.style.letterSpacing,
          },
          origin,
        });
        counts.structured += 1;
      } else if (block.kind === 'image') {
        const base = createImageLayer({ width: box.width, height: box.height });
        const src = block.src;
        if (src.startsWith('data:')) {
          jobs.push({ layerId: base.id, name: `${block.name || 'image'}.png`, dataUrl: src });
        } else if (/^https?:\/\//i.test(src) || src.startsWith('//')) {
          /* 远程图片：不替用户下载（可能几百 KB 也可能挂），记进缺失，让用户自己指定 */
          missing.push(src);
        } else {
          missing.push(src);
        }
        layers.push({
          ...base,
          name: block.name,
          x: Math.round(box.x),
          y: Math.round(box.y),
          opacity: block.opacity,
          inPoint: 0,
          outPoint: duration,
          radius: block.radius,
          origin,
        });
        counts.structured += 1;
        counts.media += 1;
      } else {
        const base = createCodeLayer({ width: box.width, height: box.height });
        layers.push({
          ...base,
          name: block.name,
          x: Math.round(box.x),
          y: Math.round(box.y),
          opacity: block.opacity,
          inPoint: 0,
          outPoint: duration,
          code: { ...base.code, engine: 'canvas2d', source: shapeSnippet(false, block.background, block.radius), params: {} },
          origin,
        });
        counts.code += 1;
      }
    }

    /* ---- GSAP 轨道 → 原生关键帧 ---- */
    const targets = layers.filter((l) => l.type !== 'background');
    const names = targets.map((l) => l.name);
    if (parsed.tweens.length) {
      const baseOf = (layer: Layer, property: AnimatableProperty): number => {
        if (property === 'x') return layer.x;
        if (property === 'y') return layer.y;
        if (property === 'width') return layer.width;
        if (property === 'height') return layer.height;
        if (property === 'rotation') return layer.rotation;
        return layer.opacity;
      };
      const tracksByLayer = new Map<string, Map<AnimatableProperty, Keyframe[]>>();
      const unmatched = new Set<string>();

      for (const tween of parsed.tweens) {
        const index = matchSelectorToLayer(tween.selector, names);
        if (index < 0) {
          unmatched.add(tween.selector);
          continue;
        }
        const target = targets[index];
        if (!target) continue;
        /*
         * GSAP 的 `x` / `y` 是 transform 位移，不是绝对坐标：
         * `gsap.to(el, { y: 140 })` 表示「在元素当前位置基础上再往下 140」。
         * 图层的 x/y 是绝对坐标，所以这里必须叠上元素自己的位置 ——
         * 直接拿 140 当终点，画面会跳回画布左上角附近（这个错犯过一次）。
         * 其余属性（opacity / rotation / width / height）在 GSAP 里就是绝对值，不叠。
         * 两端都可能缺：`to` 缺起点、`from` 缺终点，缺的那端就是元素原值。
         */
        const offset = tween.property === 'x' || tween.property === 'y';
        const base = baseOf(target, tween.property);
        const abs = (v: number | undefined): number => (v === undefined ? base : offset ? base + v : v);
        const fromValue = abs(tween.from);
        const toValue = abs(tween.to);
        const end = clamp(tween.startMs + tween.durationMs, 1, duration);
        const start = clamp(tween.startMs, 0, Math.max(0, end - 1));
        const keys: Keyframe[] = [
          {
            id: localId('kf'),
            time: start,
            value: round2(fromValue),
            easing: easing(tween.easing),
          },
          {
            id: localId('kf'),
            time: end,
            value: round2(toValue),
            easing: easing(tween.easing),
          },
        ];
        const perLayer = tracksByLayer.get(target.id) ?? new Map<AnimatableProperty, Keyframe[]>();
        const existing = perLayer.get(tween.property);
        if (existing) {
          /* 同一属性有多条 tween：按时间插入，同一时刻保留后写的（GSAP 也是后覆盖） */
          for (const k of keys) {
            const dup = existing.findIndex((x) => Math.abs(x.time - k.time) < 1);
            if (dup >= 0) existing[dup] = k;
            else existing.push(k);
          }
        } else {
          perLayer.set(tween.property, keys);
        }
        tracksByLayer.set(target.id, perLayer);
      }

      for (const layer of targets) {
        const perLayer = tracksByLayer.get(layer.id);
        if (!perLayer) continue;
        const tracks: PropertyTrack[] = [];
        for (const [property, keyframes] of perLayer) {
          keyframes.sort((a, b) => a.time - b.time);
          tracks.push({ property, keyframes });
          counts.keyframes += keyframes.length;
        }
        if (tracks.length) {
          layer.animation = { ...layer.animation, tracks };
          counts.tracks += tracks.length;
        }
      }

      if (unmatched.size) {
        pushNote('（HTML）{n} 个动画选择器没对上任何图层，轨道没有建：{list}', {
          n: unmatched.size,
          list: [...unmatched].slice(0, 4).join('、'),
        });
      }
    }
  }

  /* ---- leftover：没拆走的原生结构 ---- */
  if (parsed.leftoverHtml) {
    const base = createCodeLayer({ width, height });
    layers.push({
      ...base,
      name: 'HTML 剩余结构',
      x: 0,
      y: 0,
      inPoint: 0,
      outPoint: duration,
      code: { ...base.code, engine: 'html', source: parsed.leftoverHtml, params: htmlParams(width, height) },
      origin,
    });
    counts.code += 1;
    pushNote('剩下的 {n} 个元素不是绝对定位，整块保留为 html 代码层（编辑态用 sandbox iframe 渲染）', {
      n: parsed.flowSkipped,
    });
  }

  if (missing.length) {
    pushNote('{n} 个图片地址没能落地成资源（远程/相对路径），导入后需要重新指定', { n: missing.length });
  }

  /* ---- 保真度：提取成原生图层的越多越高 ---- */
  const editable = counts.structured * 2 + (parsed.leftoverHtml ? 0 : counts.code);
  const totalWeight = Math.max(1, parsed.blocks.length * 2 + (parsed.leftoverHtml ? 2 : 0));
  const penalty = Math.min(20, missing.length * 5);
  const fidelity =
    mode === 'preserve-code'
      ? 20
      : clamp(Math.round((editable / totalWeight) * 100 - penalty), 5, 95);

  const blockers: ImportNote[] = [];
  if (!parsed.blocks.length && !parsed.leftoverHtml) {
    blockers.push(note('这个 HTML 里没有可识别的元素'));
  }

  const report: ImportReport = {
    format: 'html',
    supported: blockers.length === 0,
    label: parsed.tweens.length ? 'HTML / GSAP 片段（静态解析）' : 'HTML 片段（静态解析）',
    fidelity,
    counts,
    missingAssets: missing,
    notes: dedupeNotes(notes),
    blockers: dedupeNotes(blockers),
    preview: {
      name: input.name ?? 'HTML 片段',
      width,
      height,
      duration,
      fps: parsed.fps,
      sample: [
        `${width}×${height}`,
        `blocks=${parsed.blocks.length}`,
        `tweens=${parsed.tweens.length}`,
        `css=${parsed.cssRules}`,
        ...parsed.externalDeps.slice(0, 2),
      ].filter(Boolean),
    },
  };

  if (!report.supported || dryRun) return { report };

  const project = normalizeProject({
    ...createEmptyProject(input.name ?? 'HTML 导入'),
    name: (input.name ?? 'HTML 导入').replace(/\.[^.]+$/, ''),
    width,
    height,
    duration,
    fps: parsed.fps,
    loop: true,
    layers,
    assets: [],
    fonts: [],
  });

  return { report, mapped: { project, report, assetJobs: jobs } };
}

/** HTML 解析失败的兜底报告：不静默退回「整段代码层」，要说清为什么没拆 */
function htmlFailure(input: ImportInput, message: string): ImportReport {
  const raw = readText(input) ?? '';
  return {
    format: 'html',
    supported: false,
    label: 'HTML / GSAP 片段',
    fidelity: 0,
    counts: emptyCounts(),
    missingAssets: [],
    notes: raw ? [note('文件 {n} 个字符', { n: raw.length })] : [],
    blockers: [note(message)],
    preview: { name: input.name ?? 'HTML 片段', width: 0, height: 0, duration: 0, fps: 30, sample: raw ? [raw.slice(0, 80).replace(/\s+/g, ' ')] : [] },
  };
}

export function mapMedia(input: ImportInput, kind: 'image' | 'video', size: { width: number; height: number }, assetId: string | null): Project {
  const width = Math.max(1, Math.round(size.width || 1080));
  const height = Math.max(1, Math.round(size.height || 1080));
  const background = createBackground({ width, height, kind: 'solid', color: '#0b0b10' });
  const layer =
    kind === 'video'
      ? createVideoLayer({ name: input.name ?? '视频', x: 0, y: 0, width, height, assetId })
      : createImageLayer({ name: input.name ?? '图片', x: 0, y: 0, width, height, assetId });
  layer.origin = { generator: 'import', sourceFormat: 'raw', sourceBundle: input.name, importedAt: Date.now() };
  return normalizeProject({
    ...createEmptyProject(input.name ?? '媒体导入'),
    name: (input.name ?? '媒体导入').replace(/\.[^.]+$/, ''),
    width,
    height,
    layers: [background, layer],
    assets: [],
    fonts: [],
  });
}

export function emptyProjectFrom(name: string, width: number, height: number): Project {
  return normalizeProject({ ...createEmptyProject(name), name, width, height });
}
