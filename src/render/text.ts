import { FONT_STACK_FALLBACK } from '@/core/defaults';
import type { GradientSpec, TextStyle } from '@/core/types';

export function fontCss(style: TextStyle): string {
  const family = style.fontFamily.includes(',') ? style.fontFamily : `"${style.fontFamily}", ${FONT_STACK_FALLBACK}`;
  return `${style.fontStyle === 'italic' ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px ${family}`;
}

export function gradientCss(g: GradientSpec): string {
  const stops = [...g.stops].sort((a, b) => a.offset - b.offset);
  const list = stops.map((s) => `${s.color} ${(s.offset * 100).toFixed(2)}%`).join(', ');
  return g.type === 'radial' ? `radial-gradient(circle at 50% 50%, ${list})` : `linear-gradient(${g.angle}deg, ${list})`;
}

const BREAK_BEFORE = '，。、；：？！）】》”’,.;:?!)]}>';
const BREAK_AFTER = '（【《“‘([{<';

type Token = { text: string; breakable: boolean };

/** 拉丁按词、CJK 按字切分，避免「整段不换行」或「英文被切碎」 */
function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let buf = '';
  for (const ch of line) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) {
      if (buf) {
        tokens.push({ text: buf, breakable: true });
        buf = '';
      }
      const last = tokens[tokens.length - 1];
      if (last && !last.breakable) last.text += ch;
      else tokens.push({ text: ch, breakable: true });
      if (BREAK_BEFORE.includes(ch)) {
        const prev = tokens[tokens.length - 2];
        if (prev && prev.breakable) {
          prev.text += ch;
          tokens.pop();
          continue;
        }
      }
      if (BREAK_AFTER.includes(ch)) {
        const cur = tokens[tokens.length - 1];
        if (cur) cur.text += '';
      }
    } else if (ch === ' ') {
      if (buf) {
        tokens.push({ text: buf, breakable: true });
        buf = '';
      }
      tokens.push({ text: ' ', breakable: true });
    } else {
      buf += ch;
    }
  }
  if (buf) tokens.push({ text: buf, breakable: true });
  return tokens;
}

const wrapCache = new Map<string, string[]>();
const WRAP_CACHE_LIMIT = 400;

/**
 * 手工断行：canvas 没有自动换行。缓存 key 覆盖影响测量的全部样式字段。
 * 注意 letterSpacing 会影响宽度，因此必须进入 key。
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: TextStyle,
  maxWidth: number,
): string[] {
  const raw = style.uppercase ? text.toUpperCase() : text;
  if (!style.wrap || maxWidth <= 0) return raw.split('\n');
  const key = `${style.fontFamily}|${style.fontSize}|${style.fontWeight}|${style.fontStyle}|${style.letterSpacing}|${Math.round(maxWidth)}|${raw}`;
  const cached = wrapCache.get(key);
  if (cached) return cached;

  const lines: string[] = [];
  for (const paragraph of raw.split('\n')) {
    const tokens = tokenize(paragraph);
    let current = '';
    for (const token of tokens) {
      const candidate = current + token.text;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current.replace(/\s+$/, ''));
        current = token.text === ' ' ? '' : token.text;
      } else {
        current = candidate;
      }
    }
    lines.push(current.replace(/\s+$/, ''));
  }

  if (wrapCache.size > WRAP_CACHE_LIMIT) wrapCache.clear();
  wrapCache.set(key, lines);
  return lines;
}

export function buildGradient(
  ctx: CanvasRenderingContext2D,
  spec: GradientSpec,
  x: number,
  y: number,
  w: number,
  h: number,
): CanvasGradient {
  let g: CanvasGradient;
  if (spec.type === 'radial') {
    const cx = x + w / 2;
    const cy = y + h / 2;
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 1.4);
  } else {
    const rad = ((spec.angle - 90) * Math.PI) / 180;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const len = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
    const dx = (Math.cos(rad) * len) / 2;
    const dy = (Math.sin(rad) * len) / 2;
    g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  }
  for (const stop of [...spec.stops].sort((a, b) => a.offset - b.offset)) {
    g.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
  }
  return g;
}

export function applyLetterSpacing(ctx: CanvasRenderingContext2D, px: number): void {
  // Chrome 99+ / Safari 17+；不支持时静默降级，不影响其他绘制
  try {
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
  } catch {
    /* noop */
  }
}

export function drawTextLayer(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: TextStyle,
  box: { width: number; height: number },
): void {
  ctx.font = fontCss(style);
  ctx.textBaseline = 'top';
  applyLetterSpacing(ctx, style.letterSpacing);

  const lines = wrapText(ctx, text, style, box.width);
  const lineHeight = style.fontSize * style.lineHeight;
  const totalHeight = lines.length * lineHeight;
  let startY = 0;
  if (style.verticalAlign === 'middle') startY = (box.height - totalHeight) / 2;
  else if (style.verticalAlign === 'bottom') startY = box.height - totalHeight;

  ctx.textAlign = style.align === 'center' ? 'center' : style.align === 'right' ? 'right' : 'left';
  const anchorX = style.align === 'center' ? box.width / 2 : style.align === 'right' ? box.width : 0;

  if (style.shadow) {
    ctx.shadowColor = style.shadow.color;
    ctx.shadowBlur = style.shadow.blur;
    ctx.shadowOffsetX = style.shadow.x;
    ctx.shadowOffsetY = style.shadow.y;
  }

  const fill = style.useGradient
    ? buildGradient(ctx, style.gradient, 0, 0, box.width, Math.max(box.height, totalHeight))
    : style.color;

  for (let i = 0; i < lines.length; i++) {
    const y = startY + i * lineHeight;
    const line = lines[i] ?? '';
    if (style.stroke && style.stroke.width > 0) {
      ctx.strokeStyle = style.stroke.color;
      ctx.lineWidth = style.stroke.width;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, anchorX, y);
    }
    ctx.fillStyle = fill;
    ctx.fillText(line, anchorX, y);
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  applyLetterSpacing(ctx, 0);
}

/** 导出前必须的字体加载：把每个用到的 family/weight 显式 load 一遍 */
export async function preloadFonts(styles: TextStyle[]): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const seen = new Set<string>();
  const tasks: Promise<unknown>[] = [];
  for (const style of styles) {
    const key = `${style.fontWeight}|${style.fontStyle}|${style.fontFamily}|${style.fontSize}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const family = style.fontFamily.includes(',') ? style.fontFamily : `"${style.fontFamily}"`;
    try {
      tasks.push(document.fonts.load(`${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${family}`));
    } catch {
      /* 不支持则跳过 */
    }
  }
  await Promise.allSettled(tasks);
  await document.fonts.ready;
}
