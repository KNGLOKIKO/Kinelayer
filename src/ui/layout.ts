/**
 * 响应式三档。
 *
 * 为什么按「档」而不是满屏断点：这个编辑器只有三种真正的布局形态，
 * 中间那些 20px 的差别没有意义，反而让每处 className 都塞三重条件。
 *
 *   wide   ≥1440  三栏全开：左图层面板 + 舞台 + 右属性面板
 *   mid    1080   收窄两栏（面板变窄、顶栏去掉次要文字），仍是并排
 *   narrow <1080  面板改成抽屉（按需覆盖），顶栏只留图标
 *
 * 档位只影响「外壳」，渲染与命令总线完全不知道视口的存在。
 */

import { useEffect, useState } from 'react';

export type LayoutTier = 'wide' | 'mid' | 'narrow';

export const WIDE_MIN = 1440;
export const MID_MIN = 1080;

export function tierOf(width: number): LayoutTier {
  if (width >= WIDE_MIN) return 'wide';
  if (width >= MID_MIN) return 'mid';
  return 'narrow';
}

/** 视口档位。passive + rAF 节流：拖动窗口时不会每像素 setState 一次 */
export function useLayoutTier(): LayoutTier {
  const [tier, setTier] = useState<LayoutTier>(() =>
    typeof window === 'undefined' ? 'wide' : tierOf(window.innerWidth),
  );

  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setTier(tierOf(window.innerWidth));
      });
    };
    window.addEventListener('resize', onResize, { passive: true });
    onResize();
    return () => {
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return tier;
}
