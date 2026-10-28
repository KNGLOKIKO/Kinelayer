/**
 * 面板 → 时间轴的拖放协议。
 *
 * 为什么用 HTML5 DnD 而不是自己写指针拖拽：跨组件拖拽要处理「出了面板还能不能跟着走」，
 * `dataTransfer` 由浏览器兜住这件事（还有原生的拖拽预览与 Esc 取消）。
 * 代价是不能在拖动过程中读数据（`getData` 在 dragover 里被禁用），所以拖到哪儿
 * 只能靠坐标算 —— 时间轴那边本来就要算坐标，正好。
 *
 * 三个 `kind` 对应三种「拖上去会发生什么」，MIME 里带自己的名字，
 * 时间轴据此决定是放素材、贴转场还是套特效。
 */

export const DRAG_ASSET = 'application/x-kinelayer-asset';
export const DRAG_TRANSITION = 'application/x-kinelayer-transition';
export const DRAG_EFFECT = 'application/x-kinelayer-effect';

export type DragKind = 'asset' | 'transition' | 'effect';

export function hasDragKind(dt: DataTransfer | null): DragKind | null {
  if (!dt) return null;
  if (dt.types.includes(DRAG_ASSET)) return 'asset';
  if (dt.types.includes(DRAG_TRANSITION)) return 'transition';
  if (dt.types.includes(DRAG_EFFECT)) return 'effect';
  return null;
}

/** 拖拽时浏览器要求 setData 一个值，否则部分浏览器不认这次拖拽 */
export function setDragData(e: React.DragEvent, kind: DragKind, value: string): void {
  const mime = kind === 'asset' ? DRAG_ASSET : kind === 'transition' ? DRAG_TRANSITION : DRAG_EFFECT;
  e.dataTransfer.setData(mime, value);
  e.dataTransfer.setData('text/plain', value);
  e.dataTransfer.effectAllowed = 'copy';
}
