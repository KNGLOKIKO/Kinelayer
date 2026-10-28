/**
 * 工程包（.kly）的真实格式：一个 ZIP。
 *
 * 为什么不是「一个大 JSON」：海报里的图片/视频动辄几 MB，塞进 JSON 要 base64，
 * 体积膨胀 33% 且浏览器解析会卡住。ZIP 里二进制原样躺着，JSON 只记清单。
 *
 * 目录结构（formatVersion 2）：
 *   manifest.json     清单：格式版本、工程概要、每个文件的 sha256 与大小
 *   project.json      工程本体（不含 base64，assetId 指向 assets/ 里的文件）
 *   assets/<id>.<ext> 图片/视频原文件
 *   fonts/<slug>.<ext> 上传的字体（可选；系统字体不打包）
 *
 * 读的时候假设文件是**敌意**的：ZIP 炸弹（高压缩比）、路径穿越（../）、
 * 条目爆炸（十万个小文件）、超大单文件，全部在解压前按清单拒掉。
 * fflate 的 unzipSync 支持 filter，能在真正解压某个条目之前看到 size / originalSize，
 * 正好用来做这道闸门。
 */

import { strFromU8, strToU8, unzipSync, zipSync, type Unzipped } from 'fflate';
import type { Project } from './types';
import { PROJECT_SCHEMA_VERSION } from './types';

export const BUNDLE_FORMAT = 'kinelayer-bundle';
export const BUNDLE_FORMAT_VERSION = 2;
export const BUNDLE_EXT = '.kly';
export const BUNDLE_ACCEPT = `${BUNDLE_EXT},.json,application/zip,application/json`;
/**
 * 导入对话框认的全部后缀。
 * 比 BUNDLE_ACCEPT 宽是有意的：同一个按钮现在也接场景 JSON / HTML / 图片视频，
 * 它们都会先过一遍 `ai.inspectImport`，认不出来的格式在预检阶段就被拦下（不会写库）。
 */
export const IMPORT_ACCEPT = [BUNDLE_EXT, '.json', '.html', '.htm', 'application/zip', 'application/json', 'image/*', 'video/*'].join(',');

const ENTRY_MANIFEST = 'manifest.json';
const ENTRY_PROJECT = 'project.json';
const DIR_ASSETS = 'assets/';
const DIR_FONTS = 'fonts/';

export const BUNDLE_LIMITS = {
  /** 条目数上限：正常工程最多「图层数 + 资源数 + 字体数 + 2」，400 已经很宽松 */
  maxEntries: 400,
  /** 单个文件解压后上限 */
  maxEntryBytes: 64 * 1024 * 1024,
  /** 全部文件解压后总字节上限 */
  maxTotalBytes: 384 * 1024 * 1024,
  /** 单文件压缩比上限（超过 1MB 的条目才检查，避免冤枉小文本） */
  maxRatio: 200,
  /** manifest 本身体积上限 */
  maxManifestBytes: 1024 * 1024,
} as const;

export class BundleError extends Error {
  code: 'FORMAT' | 'VERSION' | 'CHECKSUM' | 'LIMIT' | 'ENTRY' | 'MISSING';
  constructor(code: BundleError['code'], message: string) {
    super(message);
    this.name = 'BundleError';
    this.code = code;
  }
}

/* --------------------------------------------------------------- 基础工具 */

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  /* 导入的音频也要进包：ext 决定解包后能不能被 <audio>/decodeAudioData 认出来，
     落成 .bin 虽然 byte 级无损，但换台机器打开时 kind 判不出来。 */
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'application/octet-stream': 'bin',
};

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  weba: 'audio/webm',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  woff2: 'font/woff2',
  woff: 'font/woff',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

function extOf(mime: string, fallback = 'bin'): string {
  return MIME_EXT[mime.toLowerCase()] ?? fallback;
}

function mimeOf(ext: string): string {
  return EXT_MIME[ext.toLowerCase()] ?? 'application/octet-stream';
}

/** 文件名里的字号族名要洗一遍：空格、斜杠、中文都可能在 ZIP 路径里惹麻烦 */
function slug(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'font'
  );
}

/**
 * Uint8Array → Blob。
 * TS 5.7 起 Uint8Array 带上 buffer 类型参数，`Uint8Array<ArrayBufferLike>`（fflate 的返回类型）
 * 与 `BlobPart` 不兼容。运行期毫无问题，只是类型收窄，这里统一收口一次，别处就不用到处 as。
 */
export function blobOf(bytes: Uint8Array, type: string): Blob {
  return new Blob([bytes as unknown as BlobPart], { type });
}

/** Uint8Array → base64。分块拼接，避免 `...spread` 把大数组打爆调用栈 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new BundleError('FORMAT', '字体数据不是合法的 data URL');
  const mime = match[1] ?? 'application/octet-stream';
  const body = match[3] ?? '';
  if (!match[2]) return { bytes: strToU8(decodeURIComponent(body)), mime };
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

/** sha256 十六进制。用 WebCrypto，不引第三方哈希库 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = new Uint8Array(bytes); // 复制一份，避免把调用方的 buffer 交出去
  const digest = await crypto.subtle.digest('SHA-256', view);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ 清单 */

export interface BundleFileEntry {
  path: string;
  bytes: number;
  sha256: string;
}

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT;
  formatVersion: number;
  app: string;
  exportedAt: number;
  schemaVersion: number;
  project: {
    id: string;
    name: string;
    width: number;
    height: number;
    duration: number;
    fps: number;
    layerCount: number;
  };
  assets: (BundleFileEntry & { id: string; name: string; mime: string })[];
  fonts: (BundleFileEntry & { family: string; weight: number; style: string; mime: string })[];
  checksum: { algo: 'sha256'; project: string };
}

export interface BundleAsset {
  id: string;
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export interface BundleFont {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  mime: string;
  bytes: Uint8Array;
}

export interface BuildBundleInput {
  project: Project;
  assets: { id: string; name: string; mime: string; bytes: Uint8Array }[];
  fonts: { family: string; weight: number; style: 'normal' | 'italic'; dataUrl: string }[];
}

export interface BuiltBundle {
  bytes: Uint8Array;
  manifest: BundleManifest;
}

/* ------------------------------------------------------------------ 打包 */

export async function buildBundle(input: BuildBundleInput): Promise<BuiltBundle> {
  const { project } = input;
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};

  const projectBytes = strToU8(JSON.stringify(project));
  files[ENTRY_PROJECT] = [projectBytes, { level: 6 }];

  const assets: BundleManifest['assets'] = [];
  for (const asset of input.assets) {
    const path = `${DIR_ASSETS}${asset.id}.${extOf(asset.mime)}`;
    /* 媒体本身已经压过，再 deflate 只费 CPU 不省体积 */
    files[path] = [asset.bytes, { level: 0 }];
    assets.push({ id: asset.id, name: asset.name, mime: asset.mime, path, bytes: asset.bytes.length, sha256: await sha256Hex(asset.bytes) });
  }

  const fonts: BundleManifest['fonts'] = [];
  for (const font of input.fonts) {
    const { bytes, mime } = dataUrlToBytes(font.dataUrl);
    const path = `${DIR_FONTS}${slug(font.family)}-${font.weight}-${font.style}.${extOf(mime, 'woff2')}`;
    files[path] = [bytes, { level: 0 }];
    fonts.push({
      family: font.family,
      weight: font.weight,
      style: font.style,
      mime,
      path,
      bytes: bytes.length,
      sha256: await sha256Hex(bytes),
    });
  }

  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    formatVersion: BUNDLE_FORMAT_VERSION,
    app: `Kinelayer ${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''}`.trim(),
    exportedAt: Date.now(),
    schemaVersion: project.schemaVersion ?? PROJECT_SCHEMA_VERSION,
    project: {
      id: project.id,
      name: project.name,
      width: project.width,
      height: project.height,
      duration: project.duration,
      fps: project.fps,
      layerCount: project.layers.length,
    },
    assets,
    fonts,
    checksum: { algo: 'sha256', project: await sha256Hex(projectBytes) },
  };
  files[ENTRY_MANIFEST] = [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }];

  /* level 写在每一条上，这里不再传全局 level */
  const bytes = zipSync(files, { mtime: manifest.exportedAt });
  return { bytes, manifest };
}

/* ------------------------------------------------------------------ 解包 */

export interface ParsedBundle {
  manifest: BundleManifest;
  project: Project;
  assets: BundleAsset[];
  fonts: BundleFont[];
  /** 解压后总字节，用于日志与自检 */
  totalBytes: number;
}

function safePath(name: string): boolean {
  if (!name || name.length > 240) return false;
  if (name.startsWith('/') || name.startsWith('\\')) return false;
  if (name.includes('..')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false; // Windows 盘符
  return true;
}

/**
 * 解压闸门：在真正 inflate 之前就能看到 size / originalSize。
 * 任一条越界直接抛错，已经解出来的部分也一并丢弃（不返回半成品）。
 */
function guardedUnzip(bytes: Uint8Array): { entries: Unzipped; totalBytes: number } {
  let total = 0;
  let count = 0;
  const entries = unzipSync(bytes, {
    filter: (file) => {
      if (!safePath(file.name)) throw new BundleError('ENTRY', `工程包里有非法路径：${file.name}`);
      if (file.name.endsWith('/')) return false; // 目录条目，不要
      count += 1;
      if (count > BUNDLE_LIMITS.maxEntries) {
        throw new BundleError('LIMIT', `工程包条目过多（超过 ${BUNDLE_LIMITS.maxEntries} 个），已拒绝解压`);
      }
      const size = file.originalSize;
      if (size > BUNDLE_LIMITS.maxEntryBytes) {
        throw new BundleError('LIMIT', `工程包里的 ${file.name} 解压后有 ${(size / 1048576).toFixed(1)}MB，超过单文件上限`);
      }
      if (size > 1024 * 1024 && size / Math.max(1, file.size) > BUNDLE_LIMITS.maxRatio) {
        throw new BundleError('LIMIT', `${file.name} 压缩比异常（疑似 ZIP 炸弹），已拒绝解压`);
      }
      total += size;
      if (total > BUNDLE_LIMITS.maxTotalBytes) {
        throw new BundleError('LIMIT', `工程包解压后超过 ${BUNDLE_LIMITS.maxTotalBytes / 1048576}MB，已拒绝解压`);
      }
      return true;
    },
  });
  return { entries, totalBytes: total };
}

function parseManifest(raw: Uint8Array): BundleManifest {
  if (raw.length > BUNDLE_LIMITS.maxManifestBytes) throw new BundleError('LIMIT', 'manifest.json 过大');
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(raw));
  } catch {
    throw new BundleError('FORMAT', 'manifest.json 不是合法 JSON');
  }
  const m = json as Partial<BundleManifest>;
  if (m.format !== BUNDLE_FORMAT) throw new BundleError('FORMAT', '这不是 Kinelayer 工程包（format 不匹配）');
  if (typeof m.formatVersion !== 'number') throw new BundleError('FORMAT', 'manifest 缺少 formatVersion');
  if (m.formatVersion > BUNDLE_FORMAT_VERSION) {
    throw new BundleError('VERSION', `工程包版本 ${m.formatVersion} 比当前编辑器（${BUNDLE_FORMAT_VERSION}）新，请先升级 Kinelayer`);
  }
  if (!Array.isArray(m.assets) || !Array.isArray(m.fonts)) throw new BundleError('FORMAT', 'manifest 缺少 assets/fonts');
  return m as BundleManifest;
}

export async function parseBundle(bytes: Uint8Array): Promise<ParsedBundle> {
  if (bytes.length > BUNDLE_LIMITS.maxTotalBytes) throw new BundleError('LIMIT', '文件过大');
  let entries: Unzipped;
  let totalBytes = 0;
  try {
    const unzipped = guardedUnzip(bytes);
    entries = unzipped.entries;
    totalBytes = unzipped.totalBytes;
  } catch (err) {
    if (err instanceof BundleError) throw err;
    /* fflate 对坏包抛的是自己的错误；统一成「格式错误」，别把内部栈丢给用户 */
    throw new BundleError('FORMAT', '不是有效的 ZIP 工程包（或文件已损坏）');
  }

  const manifestRaw = entries[ENTRY_MANIFEST];
  if (!manifestRaw) throw new BundleError('MISSING', '工程包缺少 manifest.json');
  const manifest = parseManifest(manifestRaw);

  const projectRaw = entries[ENTRY_PROJECT];
  if (!projectRaw) throw new BundleError('MISSING', '工程包缺少 project.json');
  if (manifest.checksum?.algo === 'sha256') {
    const actual = await sha256Hex(projectRaw);
    if (actual !== manifest.checksum.project) {
      throw new BundleError('CHECKSUM', 'project.json 校验失败（文件被改过或传输损坏）');
    }
  }

  let project: Project;
  try {
    project = JSON.parse(strFromU8(projectRaw)) as Project;
  } catch {
    throw new BundleError('FORMAT', 'project.json 不是合法 JSON');
  }

  const assets: BundleAsset[] = [];
  for (const item of manifest.assets) {
    const data = entries[item.path];
    if (!data) throw new BundleError('MISSING', `工程包缺少资源文件：${item.path}`);
    if (item.sha256 && (await sha256Hex(data)) !== item.sha256) {
      throw new BundleError('CHECKSUM', `资源 ${item.name} 校验失败`);
    }
    assets.push({ id: item.id, name: item.name, mime: item.mime, bytes: data });
  }

  const fonts: BundleFont[] = [];
  for (const item of manifest.fonts) {
    const data = entries[item.path];
    if (!data) continue; // 字体缺失不致命：回退到系统字体，渲染层会自己 fallback
    const style = item.style === 'italic' ? 'italic' : 'normal';
    const mime = item.mime || mimeOf(item.path.split('.').pop() ?? '');
    fonts.push({ family: item.family, weight: item.weight || 400, style, mime, bytes: data });
  }

  return { manifest, project, assets, fonts, totalBytes };
}

/** 只看前 4 个字节判断是不是 ZIP：用来分流「新 .kly」与「旧 JSON 备份」 */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05);
}

/**
 * 只列出条目名，**不解压任何东西**。
 *
 * `filter` 对每个条目都会被调用一次，返回 false 就直接跳过解压 —— 所以这趟遍历的代价
 * 只是读中央目录。导入预检用它判断「这是个 .kly、还是个 Remotion 工程、还是别的 ZIP」。
 */
export function zipEntryNames(bytes: Uint8Array, limit = BUNDLE_LIMITS.maxEntries): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (file) => {
        if (names.length < limit) names.push(file.name);
        return false;
      },
    });
  } catch {
    /* 坏包：把已经读到的名字交出去，让调用方自己判断 */
  }
  return names;
}

/** 给 UI 展示的一句话摘要 */
export function describeBundle(manifest: BundleManifest): string {
  const mb = (n: number) => `${(n / 1048576).toFixed(1)}MB`;
  const assetBytes = manifest.assets.reduce((sum, a) => sum + a.bytes, 0);
  return `v${manifest.formatVersion} · ${manifest.assets.length} 资源（${mb(assetBytes)}）· ${manifest.fonts.length} 字体`;
}
