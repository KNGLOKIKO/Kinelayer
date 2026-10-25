import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Pause, Play, Repeat } from 'lucide-react';
import { exec } from '@/core/commandBus';
import { updateUi, useEditor } from '@/core/store';
import { clamp } from '@/core/geometry';
import { IconButton, Toggle, cx } from './primitives';

import { t } from '@/i18n';
function fmt(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(
    Math.floor((s % 1) * 10),
  )}`;
}

export function Timeline() {
  const show = useEditor((s) => s.ui.showTimeline);
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.runtime.playhead);
  const playing = useEditor((s) => s.runtime.playing);
  const selectedIds = useEditor((s) => s.ui.selectedIds);
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);

  const seek = (clientX: number) => {
    const el = laneRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    void exec('timeline.seek', { time: ratio * project.duration });
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => seek(e.clientX);
    const up = () => setDrag(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag, project.duration]);

  if (!show) return null;
  const rows = project.layers.slice(1).reverse();
  const ticks = Array.from({ length: 7 }, (_, i) => (project.duration / 6) * i);

  return (
    <section className="border-ink-700/80 bg-ink-900/90 flex h-[188px] shrink-0 flex-col border-t">
      <div className="border-ink-700/70 flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <IconButton size={22} active={playing} onClick={() => void exec(playing ? 'timeline.pause' : 'timeline.play')} title={t('播放 / 暂停')}>
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </IconButton>
        <span className="font-mono text-[10.5px] tabular-nums text-zinc-400">{fmt(playhead)}</span>
        <span className="text-[10px] text-zinc-600">/ {fmt(project.duration)}</span>
        <div className="bg-ink-700 mx-1 h-4 w-px" />
        <Toggle value={project.loop} onChange={(loop) => void exec('timeline.setLoop', { loop })} label={t('循环')} />
        <span className="text-[10px] text-zinc-600">{project.fps}fps</span>
        <div className="flex-1" />
        <IconButton
          size={22}
          title={t('收起时间轴')}
          onClick={() => updateUi((ui) => { ui.showTimeline = false; })}
        >
          <ChevronDown size={12} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="border-ink-700/60 flex w-[152px] shrink-0 flex-col border-r">
          <div className="border-ink-700/60 flex h-5 items-center border-b px-2 text-[9px] tracking-wider text-zinc-600">
            TRACKS
          </div>
          <div className="ml-scroll flex-1 overflow-y-auto">
            {rows.map((layer) => (
              <button
                key={layer.id}
                type="button"
                onClick={() => void exec('selection.set', { ids: [layer.id] })}
                className={cx(
                  'flex h-6 w-full items-center gap-1.5 px-2 text-left text-[10px] transition',
                  selectedIds.includes(layer.id) ? 'bg-accent/15 text-zinc-200' : 'text-zinc-500 hover:bg-ink-800',
                )}
              >
                <span
                  className={cx(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    layer.type === 'code' ? 'bg-cyan' : layer.type === 'text' ? 'bg-accent' : 'bg-zinc-500',
                  )}
                />
                <span className="truncate">{layer.name}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="relative min-w-0 flex-1">
          <div
            className="border-ink-700/60 relative h-5 cursor-ew-resize border-b"
            onPointerDown={(e) => {
              setDrag(true);
              seek(e.clientX);
            }}
          >
            {ticks.map((t, i) => (
              <div key={i} className="absolute top-0 bottom-0" style={{ left: `${(t / project.duration) * 100}%` }}>
                <div className="h-1.5 w-px bg-ink-600" />
                <span className="absolute left-1 text-[9px] text-zinc-600">{Math.round(t / 100) / 10}s</span>
              </div>
            ))}
          </div>

          <div
            ref={laneRef}
            className="ml-scroll relative h-[calc(100%-20px)] overflow-y-auto"
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                setDrag(true);
                seek(e.clientX);
              }
            }}
          >
            {rows.map((layer) => {
              const out = layer.outPoint > 0 ? layer.outPoint : project.duration;
              const left = (layer.inPoint / project.duration) * 100;
              const width = Math.max(1.5, ((out - layer.inPoint) / project.duration) * 100);
              const active = selectedIds.includes(layer.id);
              return (
                <div key={layer.id} className="relative h-6">
                  <div
                    className={cx(
                      'absolute top-1 h-4 cursor-pointer rounded-sm border transition',
                      active
                        ? 'border-accent bg-accent/40'
                        : layer.type === 'code'
                          ? 'border-cyan/40 bg-cyan/15 hover:bg-cyan/25'
                          : 'border-ink-600 bg-ink-700/80 hover:bg-ink-600',
                    )}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      void exec('selection.set', { ids: [layer.id] });
                    }}
                    title={`${layer.name} · ${layer.inPoint}–${out}ms`}
                  />
                  {layer.animation?.enter && (
                    <div className="absolute top-2 h-2 w-0.5 bg-emerald-400" style={{ left: `${left}%` }} />
                  )}
                  {layer.animation?.exit && (
                    <div className="absolute top-2 h-2 w-0.5 bg-rose-400" style={{ left: `${((out - (layer.animation.exit.duration + layer.animation.exit.delay)) / project.duration) * 100}%` }} />
                  )}
                </div>
              );
            })}
          </div>

          <div
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-accent-soft"
            style={{ left: `${(playhead / project.duration) * 100}%` }}
          >
            <div className="-ml-[5px] h-2.5 w-2.5 rounded-sm bg-accent-soft" />
          </div>
        </div>
      </div>
    </section>
  );
}

export function TimelineToggle() {
  const show = useEditor((s) => s.ui.showTimeline);
  if (show) return null;
  return (
    <button
      type="button"
      onClick={() => updateUi((ui) => { ui.showTimeline = true; })}
      className="border-ink-700/80 bg-ink-900/90 absolute bottom-0 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-t-md border border-b-0 px-2.5 py-1 text-[10px] text-zinc-500 hover:text-zinc-200"
    >
      <ChevronUp size={11} /> {t('时间轴')} <Repeat size={10} />
    </button>
  );
}
