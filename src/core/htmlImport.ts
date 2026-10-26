/**
 * HTML / GSAP 片段的静态解析：HTML 文本 → 结构化图层意图 + 动画轨道。
 *
 * 边界（和 remotionParser 是同一套规矩，理由也一样）：
 *   · **只解析，不执行**。用 DOMParser 建树、读 CSS 声明、用 element.matches 匹配选择器；
 *     `<script>` 里的内容只交给 @babel/parser 读 AST。全程不 eval、不 new Function、
 *     不把这段 HTML 塞进 iframe 去量真实布局。
 *   · **不猜布局**。只认 `position: absolute|fixed` **且**写了 left/top 的元素 ——
 *     它们的坐标是可读的。flex / grid / 普通流里的元素位置取决于字体度量与浏览器排版
 *     细节，静态算不出来，硬算出来的结果是「看着差不多、改起来全是错」，比不提取更坏。
 *     这类元素整块留进 leftover Html 层，报告里说明数量与原因。
 *   · **GSAP 只认字面量**。`{ x: 200, duration: 1 }` 能读；`{ x: vars.offset }` 读不了，
 *     记 note 跳过。timeline 只支持顺序累加，`'-=0.5'` 这类相对定位也记 note 跳过。
 *
 * 为什么不引 CSS 解析库：要读的只有「声明块」这一层（`k: v; k: v`），
 * 再往下是选择器优先级与层叠上下文 —— 那套要完整实现才有意义，半套比没有更容易骗人。
 * 这里按「文档顺序 + inline 最高」合并，对 AI 生成的一次性海报够用，且在报告里说明。
 */

import type { AnimatableProperty } from './types';

/* ------------------------------------------------------------------ 类型 */

export interface HtmlNote {
  key: string;
  params?: Record<string, string | number>;
}

export interface HtmlBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HtmlTextSpec {
  kind: 'text';
  name: string;
  text: string;
  box: HtmlBox;
  opacity: number;
  style: {
    fontSize: number;
    fontWeight: number;
    color: string;
    align: 'left' | 'center' | 'right';
    lineHeight: number;
    letterSpacing: number;
  };
}

export interface HtmlImageSpec {
  kind: 'image';
  name: string;
  /** `data:` 内联、相对路径或远程 URL 原样带给上层，由它决定能不能落地成资源 */
  src: string;
  box: HtmlBox;
  opacity: number;
  radius: number;
}

export interface HtmlBoxSpec {
  kind: 'box';
  name: string;
  box: HtmlBox;
  opacity: number;
  background: string;
  radius: number;
}

export type HtmlBlock = HtmlTextSpec | HtmlImageSpec | HtmlBoxSpec;

export interface HtmlTween {
  /** 原始选择器（`.title`、`#hero`、`img`），上层按它把轨道分给对应图层 */
  selector: string;
  property: AnimatableProperty;
  /**
   * 起点 / 终点，单位是 **GSAP 的写法**（`x`/`y` 是 transform 位移，不是绝对坐标）。
   * 哪个是 undefined 就表示「那一端是元素自己的原值」：
   *   · `to(...)`        → from=undefined, to=值   （从原位动到目标位移）
   *   · `from(...)`      → from=值, to=undefined   （从目标位移回到原位）
   *   · `fromTo(a, b)`   → from=a, to=b
   * 把 undefined 交给上层补 base，比在这里猜「原值是多少」更不容易错位。
   */
  from?: number;
  to?: number;
  startMs: number;
  durationMs: number;
  easing?: string;
}

export interface HtmlParse {
  size: { width: number; height: number };
  durationMs: number;
  fps: number;
  blocks: HtmlBlock[];
  tweens: HtmlTween[];
  /** 画布底色（从 body 的 background 读）；读不出来是空串，由上层给默认值 */
  background: string;
  /** 没被提取走的原始结构；空串表示整份都变成了原生图层 */
  leftoverHtml: string;
  /** script src / link href / img src 里的远程地址，导入后要提醒用户 */
  externalDeps: string[];
  /** 读到的 CSS 规则条数，报告里用来说明「样式到底读进来了多少」 */
  cssRules: number;
  /** 因为用了流式布局而没能提取的元素数 */
  flowSkipped: number;
  notes: HtmlNote[];
}

export class HtmlParseError extends Error {
  code: 'EMPTY' | 'TOO_BIG' | 'NO_BODY';
  constructor(code: HtmlParseError['code'], message: string) {
    super(message);
    this.name = 'HtmlParseError';
    this.code = code;
  }
}

const LIMITS = {
  maxHtmlBytes: 2_000_000,
  maxBlocks: 120,
  maxTweens: 300,
  /** 名字过长会把图层树撑爆 */
  maxNameChars: 60,
  maxTextChars: 2000,
};

/* ------------------------------------------------------------------ CSS */

type Decls = Map<string, string>;

interface CssRule {
  selector: string;
  decls: Decls;
}

function parseDecls(body: string): Decls {
  const out: Decls = new Map();
  for (const part of body.split(';')) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1).trim();
    if (key && value) out.set(key, value);
  }
  return out;
}

/**
 * 读 `<style>` 里的规则块。
 *
 * at-rule 一律跳过：`@media` 在固定画布下多半不触发，`@keyframes` 的关键帧属于
 * 「用 CSS 做动画」的另一条路（v2.5c 只做 GSAP，CSS 动画留给代码层原样跑）。
 */
function parseCss(text: string, notes: HtmlNote[]): CssRule[] {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let skippedAt = 0;
  let i = 0;
  while (i < css.length) {
    const brace = css.indexOf('{', i);
    if (brace < 0) break;
    const head = css.slice(i, brace).trim();
    let depth = 1;
    let j = brace + 1;
    while (j < css.length && depth > 0) {
      const ch = css[j];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      j += 1;
    }
    const body = css.slice(brace + 1, Math.max(brace + 1, j - 1));
    if (head.startsWith('@')) {
      skippedAt += 1;
    } else if (head) {
      rules.push({ selector: head, decls: parseDecls(body) });
    }
    i = j;
  }
  if (skippedAt > 0) {
    notes.push({ key: '（HTML）跳过了 {n} 条 @ 规则（@media / @keyframes 不参与静态提取）', params: { n: skippedAt } });
  }
  return rules;
}

/** 静态匹配：`:hover` 这类交互态在静止画面里没有意义，直接跳过 */
function selectorMatches(el: Element, selector: string): boolean {
  for (const raw of selector.split(',')) {
    const sel = raw.trim();
    if (!sel) continue;
    if (/::|:hover|:focus|:active|:visited|:checked/.test(sel)) continue;
    try {
      if (el.matches(sel)) return true;
    } catch {
      /* 浏览器不支持的选择器（如 :has 的旧实现），当作不匹配 */
    }
  }
  return false;
}

/** 合并后的声明表：文档顺序覆盖 + inline style 最高 */
function styleOf(el: Element, rules: CssRule[]): Decls {
  const merged: Decls = new Map();
  for (const rule of rules) {
    if (!selectorMatches(el, rule.selector)) continue;
    for (const [k, v] of rule.decls) merged.set(k, v);
  }
  const inline = el.getAttribute('style');
  if (inline) for (const [k, v] of parseDecls(inline)) merged.set(k, v);
  return merged;
}

/* ------------------------------------------------------------------ 取值 */

const num = (v: string | undefined): number | undefined => {
  if (!v) return undefined;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

/** px / % / 纯数字 → 绝对像素；`auto` 之类一律 undefined，交给上层决定 */
function length(v: string | undefined, base: number): number | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  if (!s || s === 'auto' || s === 'inherit' || s === 'initial' || s === 'unset' || s === 'none') return undefined;
  if (s.endsWith('%')) {
    const p = num(s);
    return p === undefined ? undefined : (base * p) / 100;
  }
  const n = num(s);
  if (n === undefined) return undefined;
  if (s.endsWith('em') || s.endsWith('rem')) return undefined; // 依赖字体度量，不猜
  return n;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function color(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  const s = v.trim();
  if (!s || s === 'inherit' || s === 'initial' || s === 'unset' || s === 'auto') return fallback;
  // 渐变背景没法当 color 用
  if (/gradient\(/i.test(s)) return fallback;
  return s;
}

function alignOf(v: string | undefined): 'left' | 'center' | 'right' {
  if (v === 'center' || v === 'right') return v;
  return 'left';
}

function fontWeightOf(v: string | undefined): number {
  if (!v) return 400;
  if (v === 'bold') return 700;
  if (v === 'normal') return 400;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? clamp(n, 100, 900) : 400;
}

/** 半径：只认单值 px（`50%` 对图片是「圆形」，折算成短边一半） */
function radiusOf(v: string | undefined, box: { width: number; height: number }): number {
  if (!v) return 0;
  const s = v.trim();
  if (s.endsWith('%')) {
    const p = num(s);
    if (p === undefined) return 0;
    return Math.round((Math.min(box.width, box.height) * p) / 100);
  }
  const n = num(s);
  return n === undefined ? 0 : Math.max(0, n);
}

/* ------------------------------------------------------------------ GSAP */

interface BabelNode {
  type: string;
  start?: number;
  [key: string]: unknown;
}

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'range', 'leadingComments', 'trailingComments', 'innerComments', 'extra']);

function walk(node: unknown, visit: (n: BabelNode) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  const obj = node as BabelNode;
  if (typeof obj.type === 'string') visit(obj);
  for (const key of Object.keys(obj)) {
    if (SKIP_KEYS.has(key)) continue;
    walk(obj[key], visit);
  }
}

function strVal(node: unknown): string | undefined {
  const n = node as BabelNode | undefined;
  if (!n) return undefined;
  if (n.type === 'StringLiteral') return String(n.value);
  if (n.type === 'TemplateLiteral') {
    const quasis = n.quasis as { value?: { cooked?: string } }[] | undefined;
    const exprs = n.expressions as unknown[] | undefined;
    if (quasis?.length === 1 && (exprs?.length ?? 0) === 0) return quasis[0]?.value?.cooked;
  }
  return undefined;
}

function numVal(node: unknown): number | undefined {
  const n = node as BabelNode | undefined;
  if (!n) return undefined;
  if (n.type === 'NumericLiteral') return Number(n.value);
  if (n.type === 'UnaryExpression' && n.operator === '-' && (n.argument as BabelNode)?.type === 'NumericLiteral') {
    return -Number((n.argument as BabelNode).value);
  }
  return undefined;
}

function objProps(node: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const n = node as BabelNode | undefined;
  if (!n || n.type !== 'ObjectExpression') return out;
  const props = n.properties as BabelNode[] | undefined;
  for (const p of props ?? []) {
    if (!p || p.type !== 'ObjectProperty' || p.computed) continue;
    const key = p.key as BabelNode | undefined;
    const name = key?.type === 'Identifier' ? String(key.name) : key?.type === 'StringLiteral' ? String(key.value) : '';
    if (name) out.set(name, p.value);
  }
  return out;
}

/** GSAP 属性名 → 原生轨道。没有对应轨道的（scale / 颜色 / filter）不硬塞 */
const TWEEN_PROP: Record<string, AnimatableProperty> = {
  x: 'x',
  left: 'x',
  translateX: 'x',
  y: 'y',
  top: 'y',
  translateY: 'y',
  opacity: 'opacity',
  autoAlpha: 'opacity',
  rotation: 'rotation',
  rotate: 'rotation',
  rotationZ: 'rotation',
  width: 'width',
  height: 'height',
};

const TWEEN_SKIP = new Set(['scale', 'scaleX', 'scaleY', 'color', 'backgroundColor', 'filter', 'blur', 'boxShadow', 'borderRadius', 'textShadow']);

interface RawCall {
  start: number;
  kind: 'to' | 'from' | 'fromTo' | 'set';
  owner: string; // 'gsap' 或 timeline 变量名
  selector?: string;
  vars: Map<string, unknown>;
  fromVars?: Map<string, unknown>;
}

/**
 * 从 `<script>` 里抽出 GSAP 调用。
 *
 * 只认这几种形状，其余全部记 note：
 *   gsap.to('.a', { x: 100, duration: 1 })
 *   gsap.fromTo('.a', { x: 0 }, { x: 100, duration: 1 })
 *   const tl = gsap.timeline(); tl.to('.a', {...})
 *   gsap.timeline().to('.a', {...}).to('.b', {...})   ← 链式
 */
async function parseTweens(scripts: string[], notes: HtmlNote[]): Promise<HtmlTween[]> {
  const clean = scripts.filter((s) => s.trim());
  if (!clean.length) return [];

  let parse: ((code: string, opts: Record<string, unknown>) => BabelNode) | null = null;
  try {
    const mod = (await import('@babel/parser')) as unknown as {
      parse: (code: string, opts: Record<string, unknown>) => BabelNode;
    };
    parse = mod.parse;
  } catch {
    notes.push({ key: '（HTML）JS 解析器加载失败，这段脚本里的动画没有提取' });
    return [];
  }

  const calls: RawCall[] = [];
  const timelineNames = new Set<string>();
  let sawGsap = false;
  let sawGap = 0;

  for (const code of clean) {
    let ast: BabelNode;
    try {
      ast = parse(code, { sourceType: 'script', errorRecovery: true, plugins: [] });
    } catch {
      try {
        ast = parse(code, { sourceType: 'module', errorRecovery: true, plugins: [] });
      } catch {
        notes.push({ key: '（HTML）有一段 <script> 解析不了（可能是 minified 或语法较新），里面的动画跳过' });
        continue;
      }
    }

    /* 一遍扫出 timeline 变量名：const tl = gsap.timeline(...) */
    walk(ast, (n) => {
      if (n.type !== 'VariableDeclarator') return;
      const id = n.id as BabelNode | undefined;
      const init = n.init as BabelNode | undefined;
      if (id?.type !== 'Identifier' || !init || init.type !== 'CallExpression') return;
      const callee = init.callee as BabelNode | undefined;
      if (callee?.type !== 'MemberExpression') return;
      const obj = callee.object as BabelNode | undefined;
      const prop = callee.property as BabelNode | undefined;
      if (obj?.type === 'Identifier' && obj.name === 'gsap' && prop && (prop as { name?: string }).name === 'timeline') {
        timelineNames.add(String(id.name));
      }
    });

    /* 再扫调用。链式写法 tl.to().to() 会被逐个识别（MemberExpression 的 object 是 CallExpression 时取变量名） */
    walk(ast, (n) => {
      if (n.type !== 'CallExpression') return;
      const callee = n.callee as BabelNode | undefined;
      if (callee?.type !== 'MemberExpression' || callee.computed) return;
      const prop = callee.property as BabelNode | undefined;
      const method = prop && typeof (prop as { name?: string }).name === 'string' ? String((prop as { name?: string }).name) : '';
      if (!['to', 'from', 'fromTo', 'set'].includes(method)) return;

      const obj = callee.object as BabelNode | undefined;
      let owner = '';
      if (obj?.type === 'Identifier') owner = String(obj.name);
      else if (obj?.type === 'CallExpression') {
        // gsap.timeline().to(...) —— owner 记成 gsap，让上面的 timeline 逻辑兜住
        const inner = obj.callee as BabelNode | undefined;
        const innerObj = inner?.type === 'MemberExpression' ? (inner.object as BabelNode | undefined) : undefined;
        if (innerObj?.type === 'Identifier') owner = String(innerObj.name);
      }
      if (owner !== 'gsap' && !timelineNames.has(owner)) return;
      if (owner === 'gsap') sawGsap = true;

      const args = (n.arguments as BabelNode[] | undefined) ?? [];
      const selector = strVal(args[0]);
      if (!selector) {
        sawGap += 1;
        return;
      }
      const kind = method as RawCall['kind'];
      const vars = objProps(args[kind === 'fromTo' ? 2 : 1]);
      const fromVars = kind === 'fromTo' ? objProps(args[1]) : undefined;
      calls.push({ start: typeof n.start === 'number' ? n.start : 0, kind, owner, selector, vars, fromVars });
    });
  }

  if (!calls.length) {
    if (sawGsap) notes.push({ key: '（HTML）认出 GSAP 调用，但目标都不是字符串选择器，动画没有提取' });
    return [];
  }

  calls.sort((a, b) => a.start - b.start);

  /* timeline 的 cursor：GSAP 默认顺序累加；显式 position 为数字时覆盖 */
  const cursor = new Map<string, number>();
  const out: HtmlTween[] = [];
  let skippedScale = 0;
  let skippedPosition = 0;
  let skippedVars = 0;

  for (const call of calls) {
    const seconds = numVal(call.vars.get('duration'));
    const durationMs = Math.max(0, Math.round((seconds === undefined ? 0.5 : seconds) * 1000));
    const delayRaw = call.vars.get('delay');
    const delaySec = numVal(delayRaw);
    if (delayRaw && delaySec === undefined) skippedVars += 1;
    const delayMs = Math.max(0, Math.round((delaySec ?? 0) * 1000));

    const positionRaw = call.vars.get('position');
    const positionSec = numVal(positionRaw);
    let startMs: number;
    if (call.owner === 'gsap') {
      if (positionRaw !== undefined) skippedPosition += 1;
      startMs = delayMs;
    } else {
      const prev = cursor.get(call.owner) ?? 0;
      if (positionRaw !== undefined) {
        if (positionSec === undefined) {
          skippedPosition += 1;
          startMs = prev;
        } else {
          startMs = Math.max(0, Math.round(positionSec * 1000));
        }
      } else {
        startMs = prev + delayMs;
      }
      cursor.set(call.owner, startMs + durationMs);
    }

    const ease = strVal(call.vars.get('ease'));

    for (const [rawKey, rawValue] of call.vars) {
      const property = TWEEN_PROP[rawKey];
      if (!property) {
        if (TWEEN_SKIP.has(rawKey)) skippedScale += 1;
        continue;
      }
      const value = numVal(rawValue);
      if (value === undefined) {
        // `x: '+=100'` / `x: () => ...` 这类相对或动态值，静态读不出终点
        skippedVars += 1;
        continue;
      }
      /* from 型：值是起点，终点回到元素原位 —— 用 undefined 表示「归位」，由上层补 base */
      const fromValue =
        call.kind === 'from' ? value : call.fromVars ? numVal(call.fromVars.get(rawKey)) : undefined;
      const toValue = call.kind === 'from' ? undefined : value;
      out.push({
        selector: call.selector ?? '',
        property,
        from: fromValue,
        to: toValue,
        startMs,
        // set 是瞬时赋值：0 时长在轨道里会退化成单点，给 1ms 让它至少有两帧
        durationMs: call.kind === 'set' && durationMs === 0 ? 1 : durationMs,
        easing: ease,
      });
    }
  }

  if (skippedScale > 0) {
    notes.push({ key: '（HTML）scale / 颜色 / 滤镜动画没有对应轨道，已跳过 {n} 项', params: { n: skippedScale } });
  }
  if (skippedPosition > 0) {
    notes.push({ key: '（HTML）GSAP timeline 里的相对位置（如 "-=0.5"）读不出绝对时间，已按顺序累加 {n} 处', params: { n: skippedPosition } });
  }
  if (skippedVars > 0) {
    notes.push({ key: '（HTML）有 {n} 个动画用变量或相对值（"+=" / 函数），终点读不出来，已跳过', params: { n: skippedVars } });
  }
  if (sawGap > 0) {
    notes.push({ key: '（HTML）有 {n} 个 GSAP 调用的目标是变量而非选择器，已跳过', params: { n: sawGap } });
  }
  return out;
}

/* ------------------------------------------------------------------ 主流程 */

function guessSize(doc: Document, rules: CssRule[]): { width: number; height: number } {
  const meta = doc.querySelector('meta[name="kly-size"]');
  const metaContent = meta?.getAttribute('content') ?? '';
  const fromMeta = /(\d{3,4})\s*[x×,]\s*(\d{3,4})/i.exec(metaContent);
  if (fromMeta) return { width: Number(fromMeta[1]), height: Number(fromMeta[2]) };

  const bodyEl = doc.body;
  if (bodyEl) {
    const decl = styleOf(bodyEl, rules);
    const w = length(decl.get('width'), 0);
    const h = length(decl.get('height'), 0);
    if (w && h) return { width: Math.round(w), height: Math.round(h) };
  }
  for (const el of Array.from(doc.querySelectorAll('[data-width][data-height]'))) {
    const w = num(el.getAttribute('data-width') ?? undefined);
    const h = num(el.getAttribute('data-height') ?? undefined);
    if (w && h) return { width: Math.round(w), height: Math.round(h) };
  }
  return { width: 1080, height: 1080 };
}

function nameOf(el: Element, text: string, fallback: string): string {
  const id = el.getAttribute('id');
  if (id) return id.slice(0, LIMITS.maxNameChars);
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)[0];
  if (cls) return `.${cls}`.slice(0, LIMITS.maxNameChars);
  const bare = text.replace(/\s+/g, ' ').trim();
  if (bare) return bare.slice(0, LIMITS.maxNameChars);
  return `<${el.tagName.toLowerCase()}>`.slice(0, 40) || fallback;
}

/** 元素自身的直接文本（不含子元素里的），空则 '' */
function ownText(el: Element): string {
  let out = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) out += node.textContent ?? '';
  }
  return out.replace(/\s+/g, ' ').trim();
}

const hasElementChild = (el: Element): boolean => el.children.length > 0;

/** 不产生画面的标签：既不该提取，也不该算进「流式布局跳过了几个」 */
const NON_RENDER_TAGS = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'BASE', 'NOSCRIPT', 'TEMPLATE', 'BR', 'HR']);

/** 有画面但 Kinelayer 没有对应原生图层的标签：整体留在代码层，报告里点名 */
const UNSUPPORTED_TAGS = new Set(['CANVAS', 'SVG', 'IFRAME', 'VIDEO', 'OBJECT', 'EMBED']);

/**
 * HTML 文本 → 结构化意图。
 *
 * `blocks` 里的元素会被从 DOM 里摘掉，剩下的 innerHTML 就是 `leftoverHtml` ——
 * 这样「原生图层」和「代码层」不会重叠画出两份同样的内容。
 */
export async function parseHtmlDocument(html: string, fileName?: string): Promise<HtmlParse> {
  const raw = html.trim();
  if (!raw) throw new HtmlParseError('EMPTY', 'HTML 是空的');
  if (raw.length > LIMITS.maxHtmlBytes) {
    throw new HtmlParseError('TOO_BIG', `HTML 超过 ${Math.round(LIMITS.maxHtmlBytes / 1024)}KB，静态解析会卡住浏览器`);
  }

  const doc = new DOMParser().parseFromString(raw, 'text/html');
  if (!doc.body) throw new HtmlParseError('NO_BODY', 'HTML 里没有 body');

  const notes: HtmlNote[] = [];
  const styleText = Array.from(doc.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n');
  const rules = parseCss(styleText, notes);
  const size = guessSize(doc, rules);

  /* 外部依赖：编辑态能加载，导出（foreignObject 栅格化）与离线打开都不行 */
  const externalDeps: string[] = [];
  for (const el of Array.from(doc.querySelectorAll('script[src], link[href], img[src], source[src], video[src]'))) {
    const url = el.getAttribute('src') ?? el.getAttribute('href') ?? '';
    if (/^https?:\/\//i.test(url) || url.startsWith('//')) externalDeps.push(url);
  }
  if (externalDeps.length) {
    notes.push({
      key: '（HTML）引用了 {n} 个远程资源（GSAP CDN、字体、图片等）：编辑态能加载，导出与离线打开会缺',
      params: { n: externalDeps.length },
    });
  }

  const blocks: HtmlBlock[] = [];
  const removed: Element[] = [];
  const unsupported = new Set<string>();
  let flowSkipped = 0;
  let tooMany = false;

  const candidates = Array.from(doc.body.querySelectorAll('*'));

  for (const el of candidates) {
    if (blocks.length >= LIMITS.maxBlocks) {
      tooMany = true;
      break;
    }
    const upper = el.tagName.toUpperCase();
    if (NON_RENDER_TAGS.has(upper) || upper === 'INPUT' || upper === 'SELECT' || upper === 'TEXTAREA') continue;
    if (UNSUPPORTED_TAGS.has(upper)) {
      unsupported.add(upper.toLowerCase());
      continue;
    }

    const decl = styleOf(el, rules);
    const position = (decl.get('position') ?? '').toLowerCase();
    const positioned = position === 'absolute' || position === 'fixed';

    const opacityRaw = num(decl.get('opacity'));
    const visibility = (decl.get('visibility') ?? '').toLowerCase();
    const display = (decl.get('display') ?? '').toLowerCase();
    if (visibility === 'hidden' || display === 'none' || opacityRaw === 0) {
      // 静态画面里看不见的东西不建图层，但要告诉用户「它被跳过了」
      continue;
    }

    const tag = el.tagName.toLowerCase();
    const isImg = tag === 'img';
    const text = ownText(el);

    /* 图片：即使不是绝对定位也认 —— src 是硬信息，位置可以后面调 */
    if (isImg) {
      const src = el.getAttribute('src') ?? '';
      if (!src) {
        notes.push({ key: '（HTML）有 <img> 没有 src，已跳过' });
        continue;
      }
      const box = positioned
        ? {
            x: Math.round(length(decl.get('left'), size.width) ?? 0),
            y: Math.round(length(decl.get('top'), size.height) ?? 0),
            width: Math.round(length(decl.get('width'), size.width) ?? length(el.getAttribute('width') ?? undefined, size.width) ?? size.width),
            height: Math.round(length(decl.get('height'), size.height) ?? length(el.getAttribute('height') ?? undefined, size.height) ?? size.height),
          }
        : {
            /* 流式图片：位置算不出来，铺满画布让用户自己拖 —— 比塞到 0,0 一个小方块好找 */
            x: 0,
            y: 0,
            width: Math.round(length(decl.get('width'), size.width) ?? num(el.getAttribute('width') ?? undefined) ?? size.width),
            height: Math.round(length(decl.get('height'), size.height) ?? num(el.getAttribute('height') ?? undefined) ?? size.height),
          };
      if (!positioned) {
        notes.push({ key: '（HTML）图片「{name}」不是绝对定位，位置按画布左上角估的，需要手动摆', params: { name: nameOf(el, '', 'img') } });
        flowSkipped += 1;
      }
      blocks.push({
        kind: 'image',
        name: nameOf(el, '', '图片'),
        src,
        box: { x: box.x, y: box.y, width: Math.max(1, box.width), height: Math.max(1, box.height) },
        opacity: opacityRaw === undefined ? 1 : clamp(opacityRaw, 0, 1),
        radius: radiusOf(decl.get('border-radius'), { width: box.width, height: box.height }),
      });
      removed.push(el);
      continue;
    }

    if (!text || hasElementChild(el)) {
      /* 容器（有子元素）留给子元素各自处理；纯空壳才可能是背景块 */
      if (!hasElementChild(el) && !text) {
        const bg = decl.get('background-color') ?? decl.get('background');
        if (positioned && bg && !/gradient\(|url\(/i.test(bg) && bg !== 'transparent') {
          const box = {
            x: Math.round(length(decl.get('left'), size.width) ?? 0),
            y: Math.round(length(decl.get('top'), size.height) ?? 0),
            width: Math.round(length(decl.get('width'), size.width) ?? 0),
            height: Math.round(length(decl.get('height'), size.height) ?? 0),
          };
          if (box.width > 0 && box.height > 0) {
            blocks.push({
              kind: 'box',
              name: nameOf(el, '', tag),
              box,
              opacity: opacityRaw === undefined ? 1 : clamp(opacityRaw, 0, 1),
              background: bg,
              radius: radiusOf(decl.get('border-radius'), box),
            });
            removed.push(el);
            continue;
          }
        }
      }
      if (!positioned) flowSkipped += 1;
      continue;
    }

    /* 到这里：没有元素子节点、有直接文本 —— 最可靠的一种提取 */
    if (!positioned) {
      // 流式文本：位置取决于排版，不猜，留给 leftover
      flowSkipped += 1;
      continue;
    }

    const fontSize = length(decl.get('font-size'), size.height) ?? 16;
    const lineHeightRaw = decl.get('line-height');
    const lineHeightNum = num(lineHeightRaw);
    const lineHeight =
      lineHeightRaw && lineHeightRaw.endsWith('px')
        ? Math.max(0.6, (lineHeightNum ?? fontSize * 1.4) / Math.max(1, fontSize))
        : lineHeightNum && lineHeightNum > 0 && lineHeightNum < 4
          ? lineHeightNum
          : 1.4;

    const width = Math.round(length(decl.get('width'), size.width) ?? 0);
    const height = Math.round(length(decl.get('height'), size.height) ?? 0);
    const estLines = Math.max(1, Math.ceil(text.length / Math.max(1, Math.floor((width || size.width) / Math.max(1, fontSize * 0.62)))));
    const box = {
      x: Math.round(length(decl.get('left'), size.width) ?? 0),
      y: Math.round(length(decl.get('top'), size.height) ?? 0),
      width: Math.max(1, width || size.width),
      height: Math.max(1, height || Math.round(fontSize * lineHeight * estLines)),
    };
    if (!width || !height) {
      notes.push({
        key: '（HTML）文本「{name}」没写宽高，按字号与字数估了 {w}×{h}',
        params: { name: nameOf(el, text, tag), w: box.width, h: box.height },
      });
    }

    blocks.push({
      kind: 'text',
      name: nameOf(el, text, '文本'),
      text: text.slice(0, LIMITS.maxTextChars),
      box,
      opacity: opacityRaw === undefined ? 1 : clamp(opacityRaw, 0, 1),
      style: {
        fontSize: Math.max(1, Math.round(fontSize)),
        fontWeight: fontWeightOf(decl.get('font-weight')),
        color: color(decl.get('color'), '#ffffff'),
        align: alignOf(decl.get('text-align')),
        lineHeight: Math.round(lineHeight * 100) / 100,
        letterSpacing: Math.round(length(decl.get('letter-spacing'), fontSize) ?? 0),
      },
    });
    removed.push(el);
  }

  if (tooMany) {
    notes.push({ key: '（HTML）可提取的元素超过 {n} 个上限，后面的没有再拆（避免图层树被撑爆）', params: { n: LIMITS.maxBlocks } });
  }
  if (unsupported.size) {
    notes.push({
      key: '（HTML）<{tags}> 没有对应的原生图层，整块留在代码层',
      params: { tags: [...unsupported].join(', ') },
    });
  }

  /* GSAP：从 script 里抽 */
  const scripts = Array.from(doc.querySelectorAll('script:not([src])')).map((s) => s.textContent ?? '');
  const tweens = await parseTweens(scripts, notes);
  if (tweens.length) {
    notes.push({ key: '（HTML）从 <script> 里提取了 {n} 条 GSAP 动画轨道', params: { n: tweens.length } });
  }

  /* 摘掉已提取的元素，剩下的才是 leftover */
  for (const el of removed) el.remove();

  /*
   * 画布底色：从 body 的 background 读，读不出来交给上层用默认值。
   * 它还有一个用途 —— leftover 的 iframe 背景必须用它，不能是白的（见下）。
   */
  const bodyDecl = styleOf(doc.body, rules);
  const bgRaw = bodyDecl.get('background-color') ?? bodyDecl.get('background') ?? '';
  const background = /gradient\(|url\(/i.test(bgRaw) ? '' : color(bgRaw, '');

  /*
   * leftover 必须是**完整文档**，不能只是 body.innerHTML。
   *
   * 第一版只取了 innerHTML，结果：`<style>` 留在 head 里没跟过来，所有 class 规则失效；
   * 而 sandbox iframe 的白底在 Chrome 里**去不掉** —— 文档 html/body 写成 transparent
   * 也不生效（四个变体实测过，全都还是白）。所以这里两条一起做：
   *   · 原样带上 <style> 与 body 属性（不然 leftover 里的元素回到浏览器默认样式）
   *   · 重置里的背景色 = 画布底色，让 iframe 看起来跟画布是同一块
   * 配合桥接脚本把 iframe 收缩到内容包围盒（htmlBridge 的 measure），
   * 它最多挡住自己那几个元素，不会把已经摆好的原生图层糊掉。
   */
  const styleTags = Array.from(doc.querySelectorAll('style'))
    .map((s) => `<style>${s.textContent ?? ''}</style>`)
    .join('');
  const resetBg = background || '#000000';
  const reset = `<style data-kly-reset>html,body{background:${resetBg} !important;margin:0;padding:0}</style>`;
  const bodyAttrs = Array.from(doc.body.attributes)
    .map((a) => ` ${a.name}="${a.value.replace(/"/g, '&quot;')}"`)
    .join('');
  const bodyInner = doc.body.innerHTML.trim();
  const leftoverHtml = bodyInner
    ? `<!doctype html><html><head><meta charset="utf-8">${styleTags}${reset}</head><body${bodyAttrs}>${bodyInner}</body></html>`
    : '';

  const durationMs = (() => {
    const fromTweens = tweens.reduce((max, t) => Math.max(max, t.startMs + t.durationMs), 0);
    const declared = num(doc.body.getAttribute('data-duration') ?? undefined);
    const base = declared && declared > 0 ? declared * 1000 : fromTweens;
    return clamp(Math.round(base || 5000), 500, 600_000);
  })();

  if (!blocks.length && !leftoverHtml) {
    notes.push({ key: '（HTML）没解析出任何内容（可能是纯 <canvas> 或空文档）' });
  }
  if (fileName) {
    notes.push({ key: '（HTML）源码来自「{name}」，只做静态结构解析，不执行脚本', params: { name: fileName } });
  }
  notes.push({ key: '（HTML）只认绝对定位元素的位置：流式布局的 {n} 个元素留在代码层', params: { n: flowSkipped } });

  return {
    size,
    durationMs,
    fps: 30,
    blocks,
    tweens: tweens.slice(0, LIMITS.maxTweens),
    background,
    leftoverHtml,
    externalDeps: [...new Set(externalDeps)],
    cssRules: rules.length,
    flowSkipped,
    notes,
  };
}

/* ------------------------------------------------------------------ 选择器 → 图层 */

/**
 * 把 tween 的 selector 对到某个图层上。
 *
 * 提取时把元素的 `id` / 首个 class 存进了图层名（见 nameOf），所以这里按
 * 「`.title` / `#hero` / `title` / 名字前缀」四种方式认。认不上就返回 null，
 * 上层记 note —— 不硬塞给第一个图层（那会画出用户没写过的动画）。
 */
export function matchSelectorToLayer(selector: string, names: string[]): number {
  const clean = selector.trim();
  const bare = clean.replace(/^[.#]/, '');
  // 复合选择器（`.a .b`、`h1.x`）只取最后一段的主标识
  const last = clean.split(/\s+|>/).filter(Boolean).pop() ?? clean;
  const lastBare = last.replace(/^[.#]/, '').replace(/\[.*\]$/, '');

  for (const candidate of [clean, bare, last, lastBare]) {
    if (!candidate) continue;
    const exact = names.findIndex((n) => n === candidate || n === `.${candidate}` || n === `#${candidate}`);
    if (exact >= 0) return exact;
  }
  for (const candidate of [bare, lastBare]) {
    if (!candidate || candidate.length < 2) continue;
    const partial = names.findIndex((n) => n.replace(/^[.#]/, '').toLowerCase() === candidate.toLowerCase());
    if (partial >= 0) return partial;
  }
  return -1;
}
