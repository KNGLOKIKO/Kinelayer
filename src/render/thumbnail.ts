/**
 * 缩略图生成：启动页的最近项目卡片用。
 *
 * 有两个坑要避开：
 *   1. 不能每次命令执行都生成（一帧全画布渲染很贵）→ 由调用方做 5 分钟节流。
 *   2. t=0 那一帧可能是空的（代码层首帧还没画、图片还没解码），
 *      直接截会得到一张全黑图 → 先数一下颜色，太单调就换到 0.5s 再试一次。
 */

import type { Project } from '@/core/types';
import { renderToCanvas } from './exporters';

const LONG_EDGE = 480;

function distinctColors(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const seen = new Set<number>();
  /* 稀疏采样即可：只是判断「是不是一整块死色」 */
  for (let i = 0; i < data.length; i += 4 * 97) {
    seen.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    if (seen.size > 3) return seen.size;
  }
  return seen.size;
}

export async function makeThumbnail(project: Project): Promise<string | undefined> {
  const scale = Math.min(1, LONG_EDGE / Math.max(project.width, project.height));
  try {
    let canvas = await renderToCanvas(project, 0, scale, false, null);
    if (distinctColors(canvas) <= 1) {
      const alt = Math.min(500, project.duration / 2);
      if (alt > 0) canvas = await renderToCanvas(project, alt, scale, false, null);
    }
    return canvas.toDataURL('image/jpeg', 0.75);
  } catch {
    /* 缩略图失败不影响保存本身 */
    return undefined;
  }
}
