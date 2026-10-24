import type { EasingName } from '@/core/types';

type EaseFn = (t: number) => number;

const c1 = 1.70158;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;

export const EASING_FNS: Record<EasingName, EaseFn> = {
  linear: (t) => t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => 1 - (1 - t) * (1 - t),
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  'ease-in-quad': (t) => t * t,
  'ease-out-quad': (t) => 1 - (1 - t) * (1 - t),
  'ease-in-cubic': (t) => t * t * t,
  'ease-out-cubic': (t) => 1 - (1 - t) ** 3,
  'ease-out-back': (t) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  'ease-out-elastic': (t) =>
    t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1,
};

export function ease(name: EasingName, t: number): number {
  const fn = EASING_FNS[name] ?? EASING_FNS['ease-out'];
  return fn(Math.min(1, Math.max(0, t)));
}
