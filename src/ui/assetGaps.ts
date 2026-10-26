import type { AssetMeta, Layer, Project } from '@/core/types';

/**
 * 「这层的资源到底有没有」的唯一判断口径。
 *
 * 为什么不用 `getImage()`（画布那边的判断）：它查的是已经解码好的位图，
 * 导入刚结束时资源还在异步解码，界面会先闪一下「缺资源」再变正常。
 * 这里只看 `project.assets` 里有没有这条元数据 —— 同步、稳定，且和用户
 * 在资源面板里看到的东西一致。
 *
 * 三种「没有」都算缺：
 *   · assetId 是 null        —— 从没指定过
 *   · assetId 指向已删资源    —— 元数据被清了，层还留着引用
 *   · assetId 是 `pending:*` —— 映射器占位，落库失败时才会残留
 */
export function assetOfLayer(project: Project, layer: Layer): AssetMeta | null {
  if (layer.type !== 'image' && layer.type !== 'video') return null;
  if (!layer.assetId) return null;
  return project.assets.find((a) => a.id === layer.assetId) ?? null;
}

/** 媒体层缺资源（非媒体层恒为 false，调用方不用先判类型） */
export function isAssetMissing(project: Project, layer: Layer): boolean {
  if (layer.type !== 'image' && layer.type !== 'video') return false;
  return !assetOfLayer(project, layer);
}

/** 所有缺资源的媒体层，按图层树顺序 */
export function missingAssetLayers(project: Project): Layer[] {
  return project.layers.filter((l) => isAssetMissing(project, l));
}

/**
 * 和这层引用同一个原始地址、且同样缺资源的其它层。
 *
 * 典型来源是 HTML：一张 logo 被三处 `<img src="同一个 URL">` 用到，
 * 导入后是三张空占位。用户补一次就该三张都好，否则要重复三次。
 */
export function sameRefLayers(project: Project, layer: Layer): Layer[] {
  const ref = layer.origin?.sourceRef;
  if (!ref) return [];
  return project.layers.filter(
    (l) => l.id !== layer.id && l.origin?.sourceRef === ref && isAssetMissing(project, l),
  );
}
