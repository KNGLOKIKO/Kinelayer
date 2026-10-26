/**
 * Remotion 工程的静态解析：ZIP → 结构 → 可映射的图层意图。
 *
 * 边界（这是本模块最重要的注释）：
 *   · **只读源码，不执行**。用 @babel/parser 做真正的 AST 解析，但只碰「结构」这一层：
 *     JSX 元素、字面量、常量表、interpolate/spring 的参数。
 *   · **不还原运行时**。`useCurrentFrame()` 之外的 hook、context、数据请求、条件渲染
 *     一律不猜 —— 猜错会让用户以为导进来的是原片。这些组件整体进 leftovers，
 *     变成 remotion-component 层（只存源码 + 占位预览），并在报告里说明原因。
 *   · **不引入 Node 能力**。ZIP 用 fflate 在浏览器里读，解析用 @babel/parser，
 *     两者都能在浏览器跑；渲染永远不在这里做。
 *
 * 为什么用 babel 而不是正则：spec 明确要求静态 AST。正则版本会「看起来能解析」，
 * 然后在嵌套 JSX / 三元表达式 / 模板字符串上给出错误结构 —— 比不解析更坏。
 * 代价是 babel 约 150KB(gzip)，所以用动态 import：只有真的导入 Remotion 工程时才加载。
 */

import { unzipSync, strFromU8 } from 'fflate';
import type { AnimatableProperty } from './types';

/* ------------------------------------------------------------------ 类型 */

export interface RemotionComposition {
  id: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  /** Root.tsx 里 `component={X}` 指向的组件名 */
  componentName: string;
  /** 组件源码所在文件（zip 内相对路径） */
  entryFile: string;
}

export interface RemotionTrackKey {
  /** 相对图层起点的帧 */
  frame: number;
  value: number;
  easing?: string;
}

export interface RemotionTrack {
  property: AnimatableProperty;
  keyframes: RemotionTrackKey[];
}

export interface RemotionLayerSpec {
  kind: 'text' | 'image' | 'box';
  name: string;
  text?: string;
  /** 图片地址：staticFile('x.png') / 相对路径 / 内联 data URL */
  src?: string;
  box: { x: number; y: number; width: number; height: number };
  /** 相对 composition 起点的帧数 */
  from: number;
  durationInFrames: number;
  opacity: number;
  style: {
    fontSize?: number;
    fontWeight?: number;
    color?: string;
    align?: 'left' | 'center' | 'right';
    lineHeight?: number;
    letterSpacing?: number;
    background?: string;
    radius?: number;
    /** 显式尺寸（px）。'100%' 这类相对值解析不了，会落在 widthPct/heightPct */
    width?: number;
    height?: number;
    widthPct?: number;
    heightPct?: number;
  };
  tracks: RemotionTrack[];
}

export interface RemotionLeftover {
  /** 组件名（<ParticleField/> → ParticleField） */
  name: string;
  /** 能找到源码就存源码；找不到就存引用它的那句话 */
  code: string;
  /** 为什么没解析：'custom-component' | 'unsupported-element' | 'dynamic-expression' */
  reason: string;
  /** 源码在 zip 里的路径（导出 remotion-kit 时按原样落盘） */
  sourcePath?: string;
}

export interface RemotionNote {
  key: string;
  params?: Record<string, string | number>;
}

export interface RemotionParse {
  composition: RemotionComposition;
  layers: RemotionLayerSpec[];
  leftovers: RemotionLeftover[];
  /** zip 里的源码文件（remotion-kit 导出时原样带走） */
  files: { path: string; code: string }[];
  /** zip 里的媒体文件（public/ 下的图片视频），key 是 zip 内路径 */
  assets: { path: string; bytes: Uint8Array }[];
  /** 找到的代理视频（用户用 CLI 渲过的低码率预览），没有就是 null */
  proxy: { path: string; bytes: Uint8Array } | null;
  notes: RemotionNote[];
}

export class RemotionParseError extends Error {
  code: 'NOT_REMOTION' | 'NO_COMPOSITION' | 'TOO_BIG' | 'NO_ENTRY';
  constructor(code: RemotionParseError['code'], message: string) {
    super(message);
    this.name = 'RemotionParseError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ 限制 */

const LIMITS = {
  maxEntries: 400,
  maxSourceBytes: 2 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
  maxAssetBytes: 8 * 1024 * 1024,
  /** 单个 JSX 树最多走这么深，防病态输入把栈打穿 */
  maxDepth: 40,
};

const SOURCE_RE = /\.(tsx|jsx|ts|js|mjs)$/i;
const MEDIA_RE = /\.(png|jpe?g|webp|gif|svg|avif|bmp|mp4|webm|mov|m4v|mp3|wav|m4a)$/i;
const PROXY_RE = /(^|\/)(proxy|preview)[^/]*\.(webm|mp4)$/i;

/* ---------------------------------------------------------------- 压缩包 */

interface ZipSource {
  path: string;
  code: string;
}

function readZip(bytes: Uint8Array): { sources: ZipSource[]; assets: RemotionParse['assets']; proxy: RemotionParse['proxy'] } {
  let total = 0;
  let entries = 0;
  const wanted = new Set<string>();
  const files = unzipSync(bytes, {
    filter(file) {
      entries += 1;
      if (entries > LIMITS.maxEntries) return false;
      if (file.name.includes('..') || file.name.startsWith('/')) return false;
      const size = file.originalSize ?? 0;
      const cap = SOURCE_RE.test(file.name) ? LIMITS.maxSourceBytes : LIMITS.maxAssetBytes;
      if (size > cap) return false;
      total += size;
      if (total > LIMITS.maxTotalBytes) return false;
      const keep = SOURCE_RE.test(file.name) || MEDIA_RE.test(file.name);
      if (keep) wanted.add(file.name);
      return keep;
    },
  });

  const sources: ZipSource[] = [];
  const assets: RemotionParse['assets'] = [];
  let proxy: RemotionParse['proxy'] = null;
  for (const path of wanted) {
    const data = files[path];
    if (!data) continue;
    if (SOURCE_RE.test(path)) {
      /* package-lock / 构建产物不读，源码才读 */
      if (/node_modules|dist\/|\.min\./i.test(path)) continue;
      sources.push({ path, code: strFromU8(data) });
    } else if (PROXY_RE.test(path)) {
      proxy = { path, bytes: data };
    } else {
      assets.push({ path, bytes: data });
    }
  }
  return { sources, assets, proxy };
}

/* ---------------------------------------------------------------- 解析 */

type AnyNode = Record<string, any>;

async function parseModule(code: string, file: string): Promise<AnyNode> {
  const babel = await import('@babel/parser');
  const parse = (babel as unknown as { parse: Function }).parse ?? (babel as unknown as { default: { parse: Function } }).default.parse;
  return parse(code, {
    sourceType: 'module',
    /* TSX 全开：AI 生成的工程基本是 .tsx；.jsx 也能过 */
    plugins: ['jsx', 'typescript', 'decorators-legacy', 'classProperties'],
    errorRecovery: true,
    ranges: false,
    allowReturnOutsideFunction: true,
  }) as AnyNode;
}

/** 文件里的顶层常量：`const DURATION = 300` / `const FPS = 30` / `30 * 5` */
function collectConsts(ast: AnyNode): Map<string, number | string> {
  const out = new Map<string, number | string>();
  for (const stmt of ast.program?.body ?? []) {
    const decl = stmt.type === 'VariableDeclaration' ? stmt : stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : null;
    if (!decl || decl.type !== 'VariableDeclaration') continue;
    for (const d of decl.declarations ?? []) {
      if (d.id?.type !== 'Identifier') continue;
      const v = literalValue(d.init, out);
      if (v !== null) out.set(d.id.name, v);
    }
  }
  return out;
}

/** 只认字面量、常量引用、和它们的四则运算 —— 再复杂就返回 null（不猜） */
function literalValue(node: AnyNode | undefined, consts: Map<string, number | string>): number | string | null {
  if (!node) return null;
  switch (node.type) {
    case 'StringLiteral':
      return node.value;
    case 'NumericLiteral':
      return node.value;
    case 'TemplateLiteral':
      return node.expressions?.length ? null : (node.quasis ?? []).map((q: AnyNode) => q.value?.cooked ?? '').join('');
    case 'Identifier':
      return consts.get(node.name) ?? null;
    case 'UnaryExpression':
      if (node.operator === '-' && node.argument?.type === 'NumericLiteral') return -node.argument.value;
      return null;
    case 'BinaryExpression': {
      const a = literalValue(node.left, consts);
      const b = literalValue(node.right, consts);
      if (typeof a !== 'number' || typeof b !== 'number') return null;
      if (node.operator === '+') return a + b;
      if (node.operator === '-') return a - b;
      if (node.operator === '*') return a * b;
      if (node.operator === '/') return b === 0 ? null : a / b;
      return null;
    }
    default:
      return null;
  }
}

function propName(attr: AnyNode): string | null {
  if (attr.type !== 'JSXAttribute') return null;
  const n = attr.name;
  if (n?.type === 'JSXIdentifier') return n.name;
  return null;
}

function attrNode(el: AnyNode, name: string): AnyNode | null {
  for (const attr of el.openingElement?.attributes ?? []) {
    if (propName(attr) === name) return attr.value ?? null;
  }
  return null;
}

/** 属性值 → 数值：`{30}` / `"30"` / `{FPS}` / `{30*2}` */
function attrNumber(el: AnyNode, name: string, consts: Map<string, number | string>): number | null {
  const v = attrNode(el, name);
  if (!v) return null;
  if (v.type === 'JSXExpressionContainer') {
    const got = literalValue(v.expression, consts);
    return typeof got === 'number' ? got : null;
  }
  if (v.type === 'StringLiteral') {
    const n = Number(v.value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function attrString(el: AnyNode, name: string, consts: Map<string, number | string>): string | null {
  const v = attrNode(el, name);
  if (!v) return null;
  if (v.type === 'StringLiteral') return v.value;
  if (v.type === 'JSXExpressionContainer') {
    const got = literalValue(v.expression, consts);
    return typeof got === 'string' ? got : null;
  }
  return null;
}

/** `staticFile('bg.png')` / `require('./x.png')` / `"https://…"` */
function assetPath(node: AnyNode | null | undefined, consts: Map<string, number | string>): string | null {
  if (!node) return null;
  if (node.type === 'JSXExpressionContainer') return assetPath(node.expression, consts);
  if (node.type === 'CallExpression') {
    const arg = node.arguments?.[0];
    return literalValue(arg, consts) as string | null;
  }
  return literalValue(node, consts) as string | null;
}

/** style={{...}} → 扁平对象（只取值字面量） */
function styleProps(node: AnyNode | null | undefined, consts: Map<string, number | string>): Record<string, unknown> {
  if (!node) return {};
  const expr = node.type === 'JSXExpressionContainer' ? node.expression : node;
  if (expr?.type !== 'ObjectExpression') return {};
  const out: Record<string, unknown> = {};
  for (const prop of expr.properties ?? []) {
    if (prop.type !== 'ObjectProperty') continue;
    const key = prop.key?.name ?? prop.key?.value;
    if (typeof key !== 'string') continue;
    const v = literalValue(prop.value, consts);
    if (v !== null) out[key] = v;
    else if (prop.value?.type === 'StringLiteral') out[key] = prop.value.value;
  }
  return out;
}

/* ------------------------------------------------- interpolate / spring */

interface KeyframeDraft {
  frame: number;
  value: number;
  easing?: string;
}

/**
 * `interpolate(frame, [0, 20], [0, 1], { easing: Easing.out(...) })`
 * → 逐点关键帧。input 的个数为 1 时补一个「到时长末尾」的点。
 */
function interpolateKeys(call: AnyNode, base: number, consts: Map<string, number | string>): KeyframeDraft[] | null {
  const args = call.arguments ?? [];
  const inputArr = args[1];
  const outputArr = args[2];
  if (inputArr?.type !== 'ArrayExpression' || outputArr?.type !== 'ArrayExpression') return null;
  const inputs = (inputArr.elements ?? []).map((e: AnyNode) => literalValue(e, consts)).filter((v: unknown) => typeof v === 'number');
  const outputs = (outputArr.elements ?? []).map((e: AnyNode) => literalValue(e, consts)).filter((v: unknown) => typeof v === 'number');
  if (inputs.length < 2 || outputs.length < 2) return null;
  const easing = easingFromOptions(args[3], consts);
  const n = Math.min(inputs.length, outputs.length);
  const out: KeyframeDraft[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({ frame: base + (inputs[i] as number), value: outputs[i] as number, easing });
  }
  return out;
}

function easingFromOptions(node: AnyNode | undefined, consts: Map<string, number | string>): string | undefined {
  const expr = node?.type === 'JSXExpressionContainer' ? node.expression : node;
  if (expr?.type !== 'ObjectExpression') return undefined;
  for (const prop of expr.properties ?? []) {
    if (prop.key?.name !== 'easing') continue;
    const src = prop.value;
    if (src?.type === 'MemberExpression' && src.object?.name === 'Easing') {
      const map: Record<string, string> = {
        linear: 'linear',
        ease: 'ease-in-out',
        in: 'ease-in',
        out: 'ease-out',
        inOut: 'ease-in-out',
      };
      const hit = map[src.property?.name];
      if (hit) return hit;
    }
    if (src?.type === 'Identifier') return 'ease-out';
  }
  return undefined;
}

/**
 * `spring({ frame, fps, config: { damping } })` → 两个关键帧（0 → 1）。
 * 这是**近似**：真正的 spring 要跑物理积分，浏览器里算得出来但没必要（我们又不执行组件）。
 * 所以这里给一条 eased 曲线，并在报告里写明「spring 按 eased 0→1 近似」。
 */
function springKeys(call: AnyNode, base: number, consts: Map<string, number | string>, fps: number): KeyframeDraft[] | null {
  const cfgNode = call.arguments?.[0];
  const cfg = cfgNode?.type === 'ObjectExpression' ? cfgNode : null;
  let delay = 0;
  let duration: number | null = null;
  for (const prop of cfg?.properties ?? []) {
    if (prop.type !== 'ObjectProperty') continue;
    const key = prop.key?.name;
    const v = literalValue(prop.value, consts);
    if (key === 'delay' && typeof v === 'number') delay = v;
    if (key === 'durationInFrames' && typeof v === 'number') duration = v;
  }
  /* 没有显式时长：Remotion 默认 spring 大约 1 秒稳定，按 fps 折一版 */
  const span = duration ?? Math.max(6, Math.round(fps * 0.9));
  return [
    { frame: base + delay, value: 0, easing: 'ease-out' },
    { frame: base + delay + span, value: 1, easing: 'ease-out' },
  ];
}

/* -------------------------------------------------------------- JSX 遍历 */

const CONTAINER_TAGS = new Set(['AbsoluteFill', 'AbsoluteFillObject', 'Fragment', 'Sequence', 'Series', 'Series.Sequence', 'div', 'section', 'main', 'article', 'header', 'footer', 'aside', 'ul', 'li', 'figure']);
const TEXT_TAGS = new Set(['span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'b', 'i', 'small', 'code', 'label', 'blockquote']);
const IMAGE_TAGS = new Set(['Img', 'img', 'Image']);
const SKIP_TAGS = new Set(['Audio', 'Video', 'OffthreadVideo', 'Gif']);

interface WalkCtx {
  consts: Map<string, number | string>;
  fps: number;
  notes: RemotionNote[];
  leftovers: RemotionLeftover[];
  layers: RemotionLayerSpec[];
  /** 当前嵌套的 Sequence 偏移（帧） */
  offset: number;
  /** 当前所在的可用时长（帧） */
  duration: number;
  /** 当前累积的布局盒（px） */
  box: { x: number; y: number; width: number; height: number };
  /** 当前累积的容器样式（背景、圆角等），子元素继承 */
  inherited: RemotionLayerSpec['style'];
  index: number;
}

function tagName(el: AnyNode): string {
  const n = el.openingElement?.name;
  if (!n) return '';
  if (n.type === 'JSXIdentifier') return n.name;
  if (n.type === 'JSXMemberExpression') return `${n.object?.name}.${n.property?.name}`;
  return '';
}

function isCustomComponent(tag: string): boolean {
  if (!tag || !/^[A-Z]/.test(tag)) return false;
  return !CONTAINER_TAGS.has(tag) && !TEXT_TAGS.has(tag) && !IMAGE_TAGS.has(tag) && !SKIP_TAGS.has(tag) && !tag.startsWith('Series');
}

function findJsxRoot(ast: AnyNode, name: string): AnyNode | null {
  let found: AnyNode | null = null;
  const visit = (node: AnyNode | null | undefined, depth: number) => {
    if (!node || typeof node !== 'object' || found || depth > 30) return;
    if (node.type === 'VariableDeclarator' && node.id?.name === name) {
      /*
       * 组件最常见的写法是 `export const Intro: React.FC = () => (...)`：
       * init 是箭头函数而不是 JSX，必须再往里挖一层，否则整个组件会被当成「没有元素」。
       */
      const init = node.init ?? null;
      found = init && /Function/.test(String(init.type)) ? functionBodyJsx(init) : init;
    }
    if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') && node.id?.name === name) {
      found = functionBodyJsx(node);
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
      const value = node[key];
      if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
      else if (value && typeof value === 'object') visit(value, depth + 1);
      if (found) return;
    }
  };
  visit(ast.program, 0);
  return found;
}

function functionBodyJsx(fn: AnyNode): AnyNode | null {
  const body = fn.body;
  if (!body) return null;
  if (body.type !== 'BlockStatement') return body;
  for (const stmt of body.body ?? []) {
    if (stmt.type === 'ReturnStatement') return stmt.argument ?? null;
  }
  return null;
}

function walkJsx(node: AnyNode | null | undefined, ctx: WalkCtx, depth = 0): void {
  if (!node || depth > LIMITS.maxDepth) return;
  if (node.type === 'JSXExpressionContainer') return walkJsx(node.expression, ctx, depth + 1);
  if (node.type === 'ParenthesizedExpression') return walkJsx(node.expression, ctx, depth + 1);
  if (node.type === 'ConditionalExpression') {
    /* 三元两边的结构都可能出现在某一帧：都走一遍，并在报告里说明「按两支并集导入」 */
    walkJsx(node.consequent, ctx, depth + 1);
    walkJsx(node.alternate, ctx, depth + 1);
    return;
  }
  if (node.type === 'LogicalExpression') {
    walkJsx(node.right, ctx, depth + 1);
    return;
  }
  if (node.type === 'ArrayExpression') {
    for (const el of node.elements ?? []) walkJsx(el, ctx, depth + 1);
    return;
  }
  if (node.type === 'CallExpression') {
    /* {items.map((x) => <div/>)}：只取回调里的结构，数据不猜 */
    const cb = (node.arguments ?? []).find((a: AnyNode) => a?.type === 'ArrowFunctionExpression' || a?.type === 'FunctionExpression');
    if (cb) walkJsx(cb.body?.type === 'BlockStatement' ? functionBodyJsx(cb) : cb.body, ctx, depth + 1);
    return;
  }
  if (node.type !== 'JSXElement' && node.type !== 'JSXFragment') return;
  if (node.type === 'JSXFragment') return walkChildren(node.children, ctx, depth);

  const el = node;
  const tag = tagName(el);

  /* <Sequence>：改偏移与时长，自身不建层 */
  if (tag === 'Sequence' || tag === 'Series.Sequence') {
    const from = attrNumber(el, 'from', ctx.consts) ?? 0;
    const dur = attrNumber(el, 'durationInFrames', ctx.consts) ?? ctx.duration - from;
    const nested: WalkCtx = {
      ...ctx,
      offset: ctx.offset + from,
      duration: Math.max(1, Math.min(dur, ctx.duration - from)),
    };
    walkChildren(el.children, nested, depth);
    return;
  }
  if (tag === 'Series') {
    walkChildren(el.children, ctx, depth);
    return;
  }
  if (SKIP_TAGS.has(tag)) {
    ctx.notes.push({ key: 'Remotion 里的 <{tag}> 没有对应图层，已跳过（Kinelayer 没有这个原生图层类型）', params: { tag } });
    return;
  }

  if (isCustomComponent(tag)) {
    ctx.leftovers.push({ name: tag, code: '', reason: 'custom-component' });
    return;
  }

  const style = { ...ctx.inherited, ...styleObjToSpec(styleProps(attrNode(el, 'style'), ctx.consts)) };
  const tracks: RemotionTrack[] = [];
  const transform = tracksFromStyle(attrNode(el, 'style'), ctx, tracks);
  const box = applyBox(ctx.box, transform, style);

  if (IMAGE_TAGS.has(tag)) {
    const src = assetPath(attrNode(el, 'src'), ctx.consts);
    ctx.layers.push({
      kind: 'image',
      name: describeName(ctx, tag),
      src: src ?? undefined,
      box,
      from: ctx.offset,
      durationInFrames: ctx.duration,
      opacity: transform.opacity ?? 1,
      style,
      tracks,
    });
    if (!src) ctx.notes.push({ key: '（Remotion）图片元素没有静态 src，建成空占位', params: {} });
    return;
  }

  const text = collectText(el.children);
  if (TEXT_TAGS.has(tag) || (text && !CONTAINER_TAGS.has(tag))) {
    ctx.layers.push({
      kind: 'text',
      name: describeName(ctx, tag, text),
      text,
      box,
      from: ctx.offset,
      durationInFrames: ctx.duration,
      opacity: transform.opacity ?? 1,
      style,
      tracks,
    });
    return;
  }

  /* 容器：有可见样式就自己建一层盒，然后继续往下走 */
  if (style.background || style.radius) {
    ctx.layers.push({
      kind: 'box',
      name: describeName(ctx, tag),
      box,
      from: ctx.offset,
      durationInFrames: ctx.duration,
      opacity: transform.opacity ?? 1,
      style,
      tracks: [],
    });
  } else if (tracks.length) {
    ctx.notes.push({ key: '（Remotion）容器「{name}」上的动画无法归到具体元素，已跳过', params: { name: describeName(ctx, tag) } });
  }

  walkChildren(el.children, { ...ctx, box, inherited: style }, depth);
}

function walkChildren(children: AnyNode[] | undefined, ctx: WalkCtx, depth: number): void {
  for (const child of children ?? []) walkJsx(child, ctx, depth + 1);
  /* JSXText 直接是文本：单独挑出来建成文本层 */
  const raw = (children ?? [])
    .filter((c) => c?.type === 'JSXText')
    .map((c) => String(c.value ?? '').trim())
    .filter(Boolean)
    .join(' ');
  if (raw) {
    ctx.layers.push({
      kind: 'text',
      name: describeName(ctx, 'text', raw),
      text: raw,
      box: ctx.box,
      from: ctx.offset,
      durationInFrames: ctx.duration,
      opacity: 1,
      style: ctx.inherited,
      tracks: [],
    });
  }
}

function collectText(children: AnyNode[] | undefined): string {
  const parts: string[] = [];
  for (const child of children ?? []) {
    if (child?.type === 'JSXText') {
      const t = String(child.value ?? '').trim();
      if (t) parts.push(t);
    } else if (child?.type === 'JSXExpressionContainer') {
      const v = literalValue(child.expression, new Map());
      if (typeof v === 'string' && v.trim()) parts.push(v.trim());
    }
  }
  return parts.join(' ').slice(0, 400);
}

function describeName(ctx: WalkCtx, tag: string, text?: string): string {
  ctx.index += 1;
  if (text) return text.replace(/\s+/g, ' ').slice(0, 24);
  return `${tag} ${ctx.index}`;
}

function styleObjToSpec(raw: Record<string, unknown>): RemotionLayerSpec['style'] {
  const out: RemotionLayerSpec['style'] = {};
  if (typeof raw.fontSize === 'number') out.fontSize = raw.fontSize;
  if (typeof raw.fontSize === 'string') {
    const n = parseFloat(raw.fontSize);
    if (Number.isFinite(n)) out.fontSize = n;
  }
  if (typeof raw.fontWeight === 'number') out.fontWeight = raw.fontWeight;
  if (typeof raw.fontWeight === 'string' && Number.isFinite(Number(raw.fontWeight))) out.fontWeight = Number(raw.fontWeight);
  if (typeof raw.color === 'string') out.color = raw.color;
  if (raw.textAlign === 'center' || raw.textAlign === 'right' || raw.textAlign === 'left') out.align = raw.textAlign;
  if (typeof raw.lineHeight === 'number') out.lineHeight = raw.lineHeight;
  if (typeof raw.letterSpacing === 'number') out.letterSpacing = raw.letterSpacing;
  if (typeof raw.background === 'string') out.background = raw.background;
  if (typeof raw.backgroundColor === 'string') out.background = raw.backgroundColor;
  if (typeof raw.borderRadius === 'number') out.radius = raw.borderRadius;
  /* 尺寸：Remotion 里宽高几乎都写在 style 上，不读它，每个元素都会退化成整块画布 */
  const size = (v: unknown): { px?: number; pct?: number } => {
    if (typeof v === 'number' && Number.isFinite(v)) return { px: v };
    if (typeof v === 'string') {
      const pct = /^([\d.]+)%$/.exec(v.trim());
      if (pct) return { pct: Number(pct[1]) };
      const px = parseFloat(v);
      if (Number.isFinite(px)) return { px };
    }
    return {};
  };
  const w = size(raw.width);
  const h = size(raw.height);
  if (w.px !== undefined) out.width = w.px;
  if (w.pct !== undefined) out.widthPct = w.pct;
  if (h.px !== undefined) out.height = h.px;
  if (h.pct !== undefined) out.heightPct = h.pct;
  return out;
}

interface TransformBits {
  opacity?: number;
  translateX?: number;
  translateY?: number;
  scale?: number;
  rotate?: number;
}

/** 把 style 里的 interpolate/spring 抽成轨道；同时返回静态值（首帧） */
function tracksFromStyle(styleNode: AnyNode | null, ctx: WalkCtx, out: RemotionTrack[]): TransformBits {
  const bits: TransformBits = {};
  if (!styleNode) return bits;
  const expr = styleNode.type === 'JSXExpressionContainer' ? styleNode.expression : styleNode;
  if (expr?.type !== 'ObjectExpression') return bits;

  const push = (property: AnimatableProperty, keys: KeyframeDraft[]) => {
    const normalized = keys
      .map((k) => ({ frame: Math.max(0, Math.round(k.frame)), value: k.value, easing: k.easing }))
      .sort((a, b) => a.frame - b.frame);
    if (normalized.length >= 2) out.push({ property, keyframes: normalized });
  };

  for (const prop of expr.properties ?? []) {
    if (prop.type !== 'ObjectProperty') continue;
    const key = prop.key?.name ?? prop.key?.value;
    if (typeof key !== 'string') continue;
    const value = prop.value;

    if (value?.type === 'CallExpression') {
      const callee = value.callee?.name;
      if (callee === 'interpolate') {
        const keys = interpolateKeys(value, 0, ctx.consts);
        if (key === 'opacity') {
          if (keys) push('opacity', keys);
        } else if (key === 'translateY' || key === 'y' || key === 'top') {
          if (keys) push('y', keys);
        } else if (key === 'translateX' || key === 'x' || key === 'left') {
          if (keys) push('x', keys);
        } else if (key === 'rotate') {
          if (keys) {
            const degrees = keys.map((k) => ({ ...k, value: parseRotation(String(k.value)) }));
            push('rotation', degrees);
          }
        } else if (key === 'scale') {
          ctx.notes.push({ key: '（Remotion）scale 插值没有对应轨道，已跳过', params: {} });
        }
        continue;
      }
      if (callee === 'spring') {
        const keys = springKeys(value, 0, ctx.consts, ctx.fps);
        if (keys) {
          ctx.notes.push({ key: '（Remotion）spring 按 eased 0→1 近似（真曲线要跑物理积分，这里不猜）', params: {} });
          if (key === 'opacity') push('opacity', keys);
          else if (key === 'translateY' || key === 'y') push('y', keys);
          else if (key === 'translateX' || key === 'x') push('x', keys);
          else if (key === 'scale') {
            ctx.notes.push({ key: '（Remotion）scale 动画没有对应轨道，已跳过（缩放请手动改 width/height）', params: {} });
          }
        }
        continue;
      }
    }

    if (key === 'opacity') {
      const v = literalValue(value, ctx.consts);
      if (typeof v === 'number') bits.opacity = v;
    }
    if (key === 'transform' && typeof prop.value?.value === 'string') {
      const t = String(prop.value.value);
      const ty = /translateY\((-?[\d.]+)px\)/.exec(t);
      const tx = /translateX\((-?[\d.]+)px\)/.exec(t);
      const sc = /scale\((-?[\d.]+)\)/.exec(t);
      const rot = /rotate\((-?[\d.]+)deg\)/.exec(t);
      if (ty) bits.translateY = Number(ty[1]);
      if (tx) bits.translateX = Number(tx[1]);
      if (sc) bits.scale = Number(sc[1]);
      if (rot) bits.rotate = Number(rot[1]);
    }
  }
  return bits;
}

function parseRotation(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

function applyBox(base: WalkCtx['box'], bits: TransformBits, style: RemotionLayerSpec['style']): WalkCtx['box'] {
  /*
   * 容器的 padding / flex 布局不追（那会立刻退化成「伪布局引擎」）。
   * 只吃三件事：translate、显式 width/height、以及「文本按其字号撑高」。
   *
   * 显式尺寸必须认：Remotion 里 `<Img style={{width:240,height:240}}>`、
   * `<div style={{width:480,height:120}}>` 全靠它 —— 不认的话每个元素都会拿整块画布当尺寸，
   * 导入后所有层叠在一起，看起来像「导入把画面弄坏了」。
   */
  const pct = (baseSize: number, abs?: number, percent?: number): number => {
    if (abs !== undefined) return abs;
    if (percent !== undefined) return (baseSize * percent) / 100;
    return baseSize;
  };
  return {
    x: base.x + (bits.translateX ?? 0),
    y: base.y + (bits.translateY ?? 0),
    width: Math.max(1, pct(base.width, style.width, style.widthPct)),
    height: Math.max(
      24,
      style.height !== undefined || style.heightPct !== undefined
        ? pct(base.height, style.height, style.heightPct)
        : style.fontSize
          ? style.fontSize * (style.lineHeight ?? 1.4)
          : base.height,
    ),
  };
}

/* ------------------------------------------------------------ 入口 */

/**
 * 从 ZIP 字节解析一个 Remotion 工程。
 * 失败抛 RemotionParseError，调用方据此给出人话（不吞异常）。
 */
export async function parseRemotionZip(bytes: Uint8Array, fileName?: string): Promise<RemotionParse> {
  const { sources, assets, proxy } = readZip(bytes);
  if (!sources.length) {
    throw new RemotionParseError('NO_ENTRY', '这个压缩包里没有 TSX/JSX 源码');
  }

  const notes: RemotionNote[] = [];
  const constsGlobal = new Map<string, number | string>();

  /* 1. 找 Root：文件名优先，其次找含 <Composition> 的文件 */
  const rootFile =
    sources.find((f) => /(^|\/)Root\.[tj]sx?$/i.test(f.path)) ??
    (await findFileWithComposition(sources)) ??
    sources.find((f) => /(^|\/)src\//.test(f.path));
  if (!rootFile) throw new RemotionParseError('NO_COMPOSITION', '没找到 Root.tsx 或任何含 <Composition> 的文件');

  const rootAst = await parseModule(rootFile.code, rootFile.path);
  const rootConsts = collectConsts(rootAst);
  for (const [k, v] of rootConsts) constsGlobal.set(k, v);

  /* 2. 读 Composition 元信息 */
  const comp = findComposition(rootAst, rootConsts);
  if (!comp) {
    throw new RemotionParseError('NO_COMPOSITION', 'Root.tsx 里没有找到 <Composition>（需要 id / width / height / fps / durationInFrames）');
  }

  /* 3. 找组件源码 */
  const entryFile =
    sources.find((f) => new RegExp(`(^|/)${comp.componentName}\\.[tj]sx?$`).test(f.path)) ??
    (await findFileDefining(sources, comp.componentName)) ??
    rootFile;

  const entryAst = entryFile === rootFile ? rootAst : await parseModule(entryFile.code, entryFile.path);
  const consts = entryFile === rootFile ? rootConsts : collectConsts(entryAst);
  for (const [k, v] of consts) if (!constsGlobal.has(k)) constsGlobal.set(k, v);

  const jsxRoot = findJsxRoot(entryAst, comp.componentName) ?? entryAst.program;
  const ctx: WalkCtx = {
    consts,
    fps: comp.fps,
    notes,
    leftovers: [],
    layers: [],
    offset: 0,
    duration: comp.durationInFrames,
    box: { x: 0, y: 0, width: comp.width, height: comp.height },
    inherited: {},
    index: 0,
  };
  walkJsx(jsxRoot, ctx);

  /* 4. 补齐 leftover 的源码：同名文件或同文件里的定义 */
  const leftovers: RemotionLeftover[] = [];
  for (const item of ctx.leftovers) {
    if (leftovers.some((x) => x.name === item.name)) continue;
    const own = sources.find((f) => new RegExp(`(^|/)${item.name}\\.[tj]sx?$`).test(f.path));
    const sameFile = extractComponentSource(entryFile.code, item.name);
    leftovers.push({
      ...item,
      code: own ? own.code : sameFile || `// ${item.name}：源码未在工程内找到\n// 该组件在 ${entryFile.path} 中被引用`,
      sourcePath: own?.path ?? entryFile.path,
    });
  }

  if (ctx.layers.length === 0) {
    notes.push({ key: '（Remotion）没解析出任何结构化元素，整个 Composition 作为代码层导入', params: {} });
  }
  if (comp.width && comp.height) {
    notes.push({ key: '（Remotion）Composition「{id}」：{w}×{h} · {fps}fps · {n} 帧', params: { id: comp.id, w: comp.width, h: comp.height, fps: comp.fps, n: comp.durationInFrames } });
  }
  if (fileName) notes.push({ key: '（Remotion）源码来自「{name}」，浏览器内不执行，只做结构解析', params: { name: fileName } });

  return {
    composition: { ...comp, entryFile: entryFile.path },
    layers: ctx.layers,
    leftovers,
    files: sources.map((f) => ({ path: f.path, code: f.code })),
    assets,
    proxy,
    notes,
  };
}

async function findFileWithComposition(sources: ZipSource[]): Promise<ZipSource | null> {
  for (const f of sources) {
    if (!/<Composition\b/.test(f.code)) continue;
    return f;
  }
  return null;
}

async function findFileDefining(sources: ZipSource[], name: string): Promise<ZipSource | null> {
  const re = new RegExp(`(function|const|class)\\s+${name}\\b`);
  for (const f of sources) if (re.test(f.code)) return f;
  return null;
}

function findComposition(ast: AnyNode, consts: Map<string, number | string>): RemotionComposition | null {
  let best: RemotionComposition | null = null;
  const visit = (node: AnyNode | null | undefined, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 30) return;
    if (node.type === 'JSXElement' && tagName(node) === 'Composition') {
      const id = attrString(node, 'id', consts) ?? 'main';
      const compAttr = attrNode(node, 'component');
      const componentName =
        compAttr?.type === 'JSXExpressionContainer' && compAttr.expression?.type === 'Identifier'
          ? compAttr.expression.name
          : 'Main';
      const cand: RemotionComposition = {
        id,
        width: attrNumber(node, 'width', consts) ?? 1080,
        height: attrNumber(node, 'height', consts) ?? 1080,
        fps: attrNumber(node, 'fps', consts) ?? 30,
        durationInFrames: attrNumber(node, 'durationInFrames', consts) ?? 150,
        componentName,
        entryFile: '',
      };
      /* 多个 Composition：取最长的那个（更能代表工程），并在调用处记一条说明 */
      if (!best || cand.durationInFrames > best.durationInFrames) best = cand;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) for (const item of value) visit(item, depth + 1);
      else if (value && typeof value === 'object') visit(value, depth + 1);
    }
  };
  visit(ast.program, 0);
  return best;
}

/** 从整份源码里截出某个组件定义（括号配平，不追求完美，够 remotion-kit 落盘） */
function extractComponentSource(code: string, name: string): string | null {
  const re = new RegExp(`(?:export\\s+)?(?:const|function)\\s+${name}\\b`);
  const m = re.exec(code);
  if (!m) return null;
  const start = m.index;
  let depth = 0;
  let seen = false;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '{') {
      depth += 1;
      seen = true;
    } else if (ch === '}') {
      depth -= 1;
      if (seen && depth === 0) return code.slice(start, i + 1);
    } else if (ch === ';' && !seen && depth === 0) {
      return code.slice(start, i + 1);
    }
  }
  return code.slice(start);
}
