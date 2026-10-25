/**
 * 图层独立窗口里的时间轴。
 *
 * 独立窗口是只读镜像：它不持有状态，也不自己算播放头。
 * 这里的点击 / 拖动 / 跳关键帧全部变成 command.request 回到主窗口的命令总线，
 * 再由 Host 广播回新的时间 —— 和主窗口拖时间轴是同一条路径。
 *
 * 显示的是「这个图层自己的」时间信息：in/out 区间、各属性轨道的关键帧、当前时间。
 */

import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Diamond } from 'lucide-react';
import type { AnimatableProperty, Layer, Project } from '@/core/types';
import { PROPERTY_LABELS } from '@/core/types';
import { clamp } from '@/core/geometry';
import { cx } from '@/ui/primitives';
import { t } from '@/i18n';

const TRACK_TONE: Record<AnimatableProperty, string> = {
  x: 'bg-accent-soft',
  y: 'bg-accent-soft',
  width: 'bg-cyan',
  height: 'bg-cyan',
  rotation: 'bg-amber-400',
  opacity: 'bg-emerald-400',
  fontSize: 'bg-fuchsia-400',
  letterSpacing: 'bg-fuchsia-400',
};

function fmt(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(
    Math.floor((s % 1) * 10),
  )}`;
}

export function LayerTimeline({
  project,
  layer,
  time,
  onSeek,
  compact,
}: {
  project: Project;
  layer: Layer;
  time: number;
  onSeek: (ms: number) => void;
  compact?: boolean;
}) {
  const laneRef = useRef<HTMLDivElement>(null);
  const duration = Math.max(1, project.duration);
  const tracks = layer.animation?.tracks ?? [];
  const inPoint = clamp(layer.inPoint || 0, 0, duration);
  const outPoint = layer.outPoint > 0 ? clamp(layer.outPoint, 0, duration) : duration;
  const ratio = (ms: number) => `${(clamp(ms, 0, duration) / duration) * 100}%`;

  /* 拖动会每秒产生几十个指针事件；Host 的快照广播才 100ms 一次，
     所以这里节流到 80ms 再发命令，并保留最后一次落点（否则松手位置会丢）。 */
  const lastSent = useRef(0);
  const pending = useRef<number | null>(null);
  const timer = useRef<number | null>(null);
  const flush = () => {
    if (pending.current === null) return;
    const ms = pending.current;
    pending.current = null;
    lastSent.current = performance.now();
    onSeek(ms);
  };
  const emit = (ms: number) => {
    pending.current = ms;
    if (performance.now() - lastSent.current >= 80) {
      flush();
      return;
    }
    if (timer.current === null) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        flush();
      }, 80);
    }
  };
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const seekFrom = (clientX: number) => {
    const el = laneRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1) * duration;
    emit(Math.round(next));
  };

  /* 所有轨道的关键帧时间点，去重排序，用来做「上一个/下一个」 */
  const marks = [...new Set(tracks.flatMap((tr) => tr.keyframes.map((k) => Math.round(k.time))))].sort((a, b) => a - b);
  const prev = [...marks].reverse().find((m) => m < time - 1);
  const next = marks.find((m) => m > time + 1);

  return (
    <div className={cx('border-ink-700/70 bg-ink-900/70 shrink-0 border-t px-2.5', compact ? 'py-1.5' : 'py-2')}>
      <div className="mb-1 flex items-center gap-1.5">
        <span className="text-[9.5px] tracking-wide text-zinc-500">{t('图层时间轴')}</span>
        <span className="font-mono text-[9.5px] tabular-nums text-zinc-400">
          {fmt(time)} <span className="text-zinc-600">/ {fmt(duration)}</span>
        </span>
        <div className="flex-1" />
        <span className="text-[9px] text-zinc-600">
          {t('入 {a} · 出 {b}', { a: fmt(inPoint), b: fmt(outPoint) })}
        </span>
        <button
          type="button"
          title={t('上一个关键帧')}
          disabled={prev === undefined}
          onClick={() => prev !== undefined && onSeek(prev)}
          className="rounded p-0.5 text-zinc-500 transition hover:text-zinc-100 disabled:opacity-30"
        >
          <ChevronLeft size={12} />
        </button>
        <button
          type="button"
          title={t('下一个关键帧')}
          disabled={next === undefined}
          onClick={() => next !== undefined && onSeek(next)}
          className="rounded p-0.5 text-zinc-500 transition hover:text-zinc-100 disabled:opacity-30"
        >
          <ChevronRight size={12} />
        </button>
      </div>

      <div
        ref={laneRef}
        data-testid="layer-timeline"
        className="bg-ink-950/80 relative cursor-crosshair overflow-hidden rounded-md border border-ink-700/70"
        style={{ height: compact ? 26 : 34 }}
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* 合成事件没有真实指针，捕获会抛；拖拽逻辑本身不依赖它 */
          }
          seekFrom(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekFrom(e.clientX);
        }}
      >
        {/* 图层生效区间：in/out 之外压暗 */}
        <div className="absolute inset-y-0 left-0 bg-black/45" style={{ width: ratio(inPoint) }} />
        <div className="absolute inset-y-0 right-0 bg-black/45" style={{ width: `${100 - (outPoint / duration) * 100}%` }} />
        <div
          className="border-accent/40 bg-accent/10 absolute inset-y-0 border-x"
          style={{ left: ratio(inPoint), width: `${((outPoint - inPoint) / duration) * 100}%` }}
        />

        {/* 每条属性轨道一条细线 + 关键帧菱形 */}
        <div className="absolute inset-0 flex flex-col justify-center gap-[2px] px-0">
          {(tracks.length ? tracks : []).map((track) => (
            <div key={track.property} className="relative h-[4px]">
              <div className="bg-ink-700/70 absolute inset-x-0 top-1/2 h-px -translate-y-1/2" />
              {track.keyframes.map((kf) => (
                <span
                  key={kf.id}
                  title={`${PROPERTY_LABELS[track.property] ?? track.property} · ${Math.round(kf.time)}ms`}
                  className={cx('absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px]', TRACK_TONE[track.property] ?? 'bg-zinc-400')}
                  style={{ left: ratio(kf.time) }}
                />
              ))}
            </div>
          ))}
          {!tracks.length && (
            <div className="absolute inset-0 flex items-center justify-center gap-1 text-[9px] text-zinc-600">
              <Diamond size={8} /> {t('这个图层还没有关键帧')}
            </div>
          )}
        </div>

        {/* 播放头 */}
        <div className="pointer-events-none absolute inset-y-0 w-px bg-rose-400/90" style={{ left: ratio(time) }} />
      </div>
    </div>
  );
}
