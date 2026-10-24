/**
 * HTML 代码层的栅格化。
 *
 * 编辑态：Stage 用 sandbox iframe 实时叠加（见 Stage.tsx）。
 * 导出态：这里把 HTML 包进 SVG <foreignObject> 再画到 Canvas。
 * 限制：只支持自包含的内联 HTML/CSS；外部图片需为 data URL；复杂布局可能失败，
 * 失败时导出会用占位块并给出警告（见 docs/01-known-limitations.md）。
 */
export async function rasterizeHtml(
  html: string,
  width: number,
  height: number,
  scale: number,
): Promise<ImageBitmap | null> {
  if (!html.trim()) return null;
  try {
    const doc = new DOMParser().parseFromString(
      `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;overflow:hidden;">${html}</div>`,
      'text/html',
    );
    const node = doc.body.firstElementChild;
    if (!node) return null;
    const xhtml = new XMLSerializer().serializeToString(node);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width * scale)}" height="${Math.round(height * scale)}" viewBox="0 0 ${width} ${height}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject></svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('foreignObject 栅格化失败'));
        el.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await createImageBitmap(canvas);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}
