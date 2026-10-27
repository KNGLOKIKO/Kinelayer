/* engine/type.ts 的移植 —— 字体三声部 + 排版辅助。
 * 原项目用 opentype.js 读轮廓；这里用 Canvas 的 measureText（它自带 kerning），
 * 所以「分段绘制不许用 measure(prefix)」的禁令在这里不存在 —— 同一 API，同一结果。
 */
(function () {
  const css = getComputedStyle(document.documentElement);
  const SANS = css.getPropertyValue('--font-sans') || 'sans-serif';
  const MONO = css.getPropertyValue('--font-mono') || 'monospace';
  const SERIF = css.getPropertyValue('--font-serif') || 'serif';

  /* canvas 的 font 简写不认 font-stretch 百分比（整个赋值会被静默丢弃！），
   * 只认关键字 —— 把 Archivo 的宽度轴映射过去。 */
  const STRETCH = [[62.5, 'ultra-condensed'], [75, 'extra-condensed'], [87.5, 'condensed'], [100, 'normal'], [112.5, 'semi-expanded'], [125, 'expanded']];
  const stretchOf = (width) => STRETCH.reduce((best, [k, name]) => (Math.abs(k - width) < Math.abs(best[0] - width) ? [k, name] : best), STRETCH[2])[1];

  const F = {
    /** width 62–125，weight 300–900 —— Archivo 的两条可变轴；无字体时浏览器忽略 stretch */
    archivo: (px, width = 100, weight = 500, italic = false) =>
      `${italic ? 'italic ' : ''}${weight} ${stretchOf(width)} ${Math.round(px)}px ${SANS}`,
    mono: (px, weight = 400, italic = false) => `${italic ? 'italic ' : ''}${weight} ${Math.round(px)}px ${MONO}`,
    serif: (px, weight = 400, italic = false) => `${italic ? 'italic ' : ''}${weight} ${Math.round(px)}px ${SERIF}`,
  };

  const measureCtx = document.createElement('canvas').getContext('2d');
  const cache = new Map();
  function measure(text, font) {
    const k = font + '\u0000' + text;
    let v = cache.get(k);
    if (v === undefined) { measureCtx.font = font; v = measureCtx.measureText(text).width; cache.set(k, v); }
    return v;
  }
  /** 分段绘制的第 i 个字形 x —— measureText 含 kerning，直接量前缀即可 */
  function glyphX(text, i, font) { return measure(text.slice(0, i), font); }
  /** 让 text 在 maxW 内放得下的最大字号 */
  function fitSize(text, font, maxW, from = 200) {
    let size = from;
    const probe = (px) => {
      const f = font.replace(/(\d+(\.\d+)?)px/, `${px}px`);
      return measure(text, f);
    };
    while (size > 8 && probe(size) > maxW) size = Math.max(8, size * 0.92);
    return size;
  }
  /* 直引号 ↔ 排版引号（engine/type.ts 的 smart/plain） */
  const smart = (s) => s.replace(/--/g, '—').replace(/(^|[\s(\[])"([^"]*)"$/g, '$1“$2”').replace(/"/g, '”');
  const plain = (s) => s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/—/g, '--');

  window.PD_TYPE = { F, measure, glyphX, fitSize, smart, plain };
})();
