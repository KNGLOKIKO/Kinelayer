import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Boxes, ChevronDown, ChevronRight, ChevronUp, Diamond, Pause, Play, Repeat, Scissors, Trash2 } from 'lucide-react';
import { exec } from '@/core/commandBus';
import { pushToast, updateUi, useEditor } from '@/core/store';
import { clamp } from '@/core/geometry';
import { MIN_CLIP_MS, TRANSITION_LABEL_KEY } from '@/core/media';
import { ANIMATABLE_PROPERTIES, PROPERTY_LABELS, type AnimatableProperty, type Keyframe, type Layer } from '@/core/types';
import { currentValue, trackOf, ANIM_PRESET_TRACKS, type AnimPresetTrack } from '@/core/commands/animation';
import { peaksFor } from '@/render/audioEngine';
import { IconButton, Toggle, cx } from './primitives';
import { useLayoutTier } from './layout';
import { t } from '@/i18n';
import { beatMs, tempoOf } from '@/core/score';

/** remotion 组件层：内部不可编辑，时间轴只表示「这段时间它可见」 */
function isRemotionLayer(layer: Layer): boolean {
  return layer.type === 'code' && layer.code.engine === 'remotion-component';
}

/**
 * 音频块里的波形。
 *
 * 用 SVG 而不是 canvas：时间轴行是 DOM，clip 的宽度随缩放变化，
 * canvas 得自己处理 ResizeObserver 与 devicePixelRatio；SVG 靠 viewBox + preserveAspectRatio
 * 自动拉伸，窄到 2px 宽也不会糊。峰值来自 audioEngine 的离线渲染（思路同 wavesurfer.js 的 peaks）。
 */
function AudioWave({ peaks, from, to }: { peaks: Float32Array; from: number; to: number }) {
  const path = useMemo(() => {
    const n = peaks.length;
    const a = Math.max(0, Math.floor(from * n));
    const b = Math.min(n, Math.ceil(to * n));
    if (b <= a) return '';
    const segments: string[] = [];
    const span = b - a;
    for (let i = a; i < b; i += 1) {
      const x = ((i - a) / span) * 100;
      const h = Math.max(0.06, peaks[i]) * 0.46;
      segments.push(`M${x.toFixed(2)} ${(0.5 - h).toFixed(3)}V${(0.5 + h).toFixed(3)}`);
    }
    return segments.join('');
  }, [peaks, from, to]);

  if (!path) return null;
  return (
    <svg
      aria-hidden
      data-testid="audio-wave"
      viewBox="0 0 100 1"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <path d={path} stroke="currentColor" strokeWidth={0.5} vectorEffect="non-scaling-stroke" className="text-emerald-300/50" fill="none" />
    </svg>
  );
}

function fmt(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(
    Math.floor((s % 1) * 10),
  )}`;
}

type Row =
  | { kind: 'layer'; layer: Layer }
  | { kind: 'track'; layer: Layer; property: AnimatableProperty };

const PRESET_LABEL: Record<AnimPresetTrack, string> = {
  'fade-in': '淡入',
  rise: '上浮',
  'zoom-in': '放大进入',
  pop: '弹入',
  spin: '旋转进入',
  pulse: '脉冲',
};

export function Timeline() {
  const show = useEditor((s) => s.ui.showTimeline);
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.runtime.playhead);
  const playing = useEditor((s) => s.runtime.playing);
  const selectedIds = useEditor((s) => s.ui.selectedIds);
  const expanded = useEditor((s) => s.ui.expandedTracks);
  const selectedKeyframes = useEditor((s) => s.ui.selectedKeyframes);
  const zoom = useEditor((s) => s.ui.timelineZoom);
  const tier = useLayoutTier();
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(false);
  const [presetFor, setPresetFor] = useState<string | null>(null);
  /** 拖拽关键帧时的临时偏移（ms），松手才提交命令，避免一次拖动刷出几十条撤销点 */
  const [kfDrag, setKfDrag] = useState<{ ids: string[]; delta: number } | null>(null);
  const startX = useRef(0);
  const kfDragRef = useRef<{ ids: string[]; delta: number } | null>(null);
  kfDragRef.current = kfDrag;
  /**
   * 片段拖动 / 左右边缘裁剪。
   *
   * 与关键帧拖动同一条纪律：**拖动过程中只改本地预览，松手才提交一条命令**。
   * 每移动一像素就 dispatch 一次会让撤销栈里堆几十条记录（而且每帧都在重建整棵图层树）。
   */
  const [clipDrag, setClipDrag] = useState<{
    id: string;
    mode: 'move' | 'left' | 'right';
    startX: number;
    delta: number;
  } | null>(null);
  const clipDragRef = useRef<typeof clipDrag>(null);
  clipDragRef.current = clipDrag;
  /** 片段几何在**内容层**里算：laneRef 是滚动视口，zoom>1 时两者宽度不同 */
  const contentRef = useRef<HTMLDivElement>(null);

  /*
   * 波形只在「这条时间轴里真有音频层」时才算。
   * peaksFor 走一次离线渲染（96 秒的工程压到 8kHz 也就几百毫秒），算一次缓存一个版本，
   * 但没必要为一个纯图层工程白跑一遍。
   */
  const hasAudio = useMemo(() => project.layers.some((l) => l.type === 'audio'), [project.layers]);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    if (!hasAudio) {
      setPeaks(null);
      return;
    }
    let alive = true;
    void peaksFor(project, 320).then((p) => {
      if (alive) setPeaks(p);
    });
    return () => {
      alive = false;
    };
  }, [hasAudio, project]);

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

  // 拖拽关键帧：像素 → 毫秒，松手一次性提交
  useEffect(() => {
    if (!kfDrag) return;
    const move = (e: PointerEvent) => {
      const el = laneRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const msPerPx = project.duration / Math.max(1, rect.width);
      setKfDrag((d) => (d ? { ...d, delta: Math.round((e.clientX - startX.current) * msPerPx) } : d));
    };
    const up = () => {
      const cur = kfDragRef.current;
      setKfDrag(null);
      if (!cur || cur.delta === 0) return;
      // 把选中关键帧（同图层）整体平移；跨图层选择不参与，避免语义含糊
      const layer = project.layers.find((l) => l.animation.tracks?.some((tr) => tr.keyframes.some((k) => cur.ids.includes(k.id))));
      if (!layer) return;
      const moves = (layer.animation.tracks ?? []).flatMap((tr) =>
        tr.keyframes
          .filter((k) => cur.ids.includes(k.id))
          .map((k) => ({ property: tr.property, keyframeId: k.id, time: k.time + cur.delta })),
      );
      if (moves.length) void exec('animation.moveKeyframes', { id: layer.id, moves });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [kfDrag, project]);

  // 片段拖动 / 边缘裁剪：松手一条命令，撤销一次就回去
  useEffect(() => {
    if (!clipDrag) return;
    const rectOf = () => contentRef.current?.getBoundingClientRect() ?? null;
    const move = (e: PointerEvent) => {
      const rect = rectOf();
      if (!rect) return;
      const msPerPx = project.duration / Math.max(1, rect.width);
      const delta = Math.round((e.clientX - clipDrag.startX) * msPerPx);
      setClipDrag((d) => (d ? { ...d, delta } : d));
    };
    const up = () => {
      const cur = clipDragRef.current;
      setClipDrag(null);
      if (!cur || Math.abs(cur.delta) < 2) return;
      const layer = project.layers.find((l) => l.id === cur.id);
      if (!layer || layer.type === 'background') return;
      const end = layer.outPoint > 0 ? Math.min(layer.outPoint, project.duration) : project.duration;
      const rate = layer.type === 'video' ? Math.max(0.1, layer.playbackRate || 1) : 1;
      const trimIn = 'trimIn' in layer ? layer.trimIn : 0;

      if (cur.mode === 'move') {
        let delta = clamp(cur.delta, -layer.inPoint, project.duration - end);
        /* 吸附：播放头与其它片段的边，8px 以内自动贴上去 —— 非专业用户对不齐，
           这一条比任何说明文字都管用 */
        const rect = contentRef.current?.getBoundingClientRect();
        const tol = rect ? (8 / rect.width) * project.duration : 0;
        const anchors = [0, project.duration, playhead, ...project.layers.filter((l) => l.id !== layer.id).flatMap((l) => [l.inPoint, l.outPoint > 0 ? l.outPoint : project.duration])];
        const target = layer.inPoint + delta;
        for (const a of anchors) if (Math.abs(a - target) <= tol) { delta = a - layer.inPoint; break; }
        void exec('layer.trim', {
          id: layer.id,
          inPoint: Math.round(layer.inPoint + delta),
          outPoint: layer.outPoint > 0 ? Math.round(end + delta) : 0,
        });
        return;
      }

      if (cur.mode === 'left') {
        /* 左边缘：时间轴入点与素材内偏移一起动，素材不会跟着滑走。
           负方向最多退到素材开头（trimIn 归零），再往左就没有东西可露了。 */
        const minDelta = Math.max(-layer.inPoint, -(trimIn / rate));
        const delta = clamp(cur.delta, minDelta, end - layer.inPoint - MIN_CLIP_MS);
        void exec('layer.trim', {
          id: layer.id,
          inPoint: Math.round(layer.inPoint + delta),
          ...(layer.type === 'video' || layer.type === 'audio' ? { trimIn: Math.round(trimIn + delta * rate) } : {}),
        });
        return;
      }

      const out = clamp(end + cur.delta, layer.inPoint + MIN_CLIP_MS, project.duration);
      void exec('layer.trim', { id: layer.id, outPoint: out >= project.duration - 1 ? 0 : Math.round(out) });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [clipDrag, project, playhead]);

  /** 拖动时的预览几何：只影响这一行的渲染，不写回工程 */
  const previewClip = (layer: Layer, out: number): { inPoint: number; out: number } => {
    const d = clipDrag?.id === layer.id ? clipDrag : null;
    if (!d) return { inPoint: layer.inPoint, out };
    if (d.mode === 'move') {
      const delta = clamp(d.delta, -layer.inPoint, project.duration - out);
      return { inPoint: layer.inPoint + delta, out: layer.outPoint > 0 ? out + delta : out };
    }
    if (d.mode === 'left') {
      const delta = clamp(d.delta, -layer.inPoint, out - layer.inPoint - MIN_CLIP_MS);
      return { inPoint: layer.inPoint + delta, out };
    }
    return { inPoint: layer.inPoint, out: clamp(out + d.delta, layer.inPoint + MIN_CLIP_MS, project.duration) };
  };

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const layer of [...project.layers.slice(1)].reverse()) {
      out.push({ kind: 'layer', layer });
      if (!expanded.includes(layer.id)) continue;
      for (const prop of ANIMATABLE_PROPERTIES) {
        if (trackOf(layer, prop)) out.push({ kind: 'track', layer, property: prop });
      }
    }
    return out;
  }, [project.layers, expanded]);

  if (!show) return null;
  const ticks = Array.from({ length: 7 }, (_, i) => (project.duration / 6) * i);
  /*
   * 拍线：把速度网格画在标尺上。
   *
   * 只在「每拍至少占 0.4% 宽」时才画 —— 60 秒的片子 128 BPM 有 128 拍，
   * 挤在一起就是一片灰，反而看不清。太密就不画，读数区里还有一份精确的。
   */
  const tempo = tempoOf(project);
  const beat = beatMs(tempo);
  const beatCount = Math.floor((project.duration - tempo.offsetMs) / beat) + 1;
  const showBeats = beatCount > 1 && beatCount <= 240 && (beat / project.duration) * 100 >= 0.4;
  const selectedLayer = project.layers.find((l) => l.id === selectedIds[0]);
  const overflow = project.layers.slice(1).filter((l) => l.inPoint > project.duration || (l.outPoint > 0 && l.outPoint > project.duration));

  // 选中的关键帧（当前工程内）
  const picked = project.layers.flatMap((l) =>
    (l.animation.tracks ?? []).flatMap((tr) =>
      tr.keyframes.filter((k) => selectedKeyframes.includes(k.id)).map((k) => ({ layer: l, property: tr.property, kf: k })),
    ),
  );
  const single = picked.length === 1 ? (picked[0] as (typeof picked)[number]) : null;

  return (
    <section
      className={cx(
        'border-ink-700/80 bg-ink-900/90 flex shrink-0 flex-col border-t',
        tier === 'narrow' ? 'h-[168px]' : tier === 'mid' ? 'h-[204px]' : 'h-[230px]',
      )}
    >
      <div className="border-ink-700/70 flex h-8 shrink-0 items-center gap-2 border-b px-2">
        <IconButton size={22} active={playing} onClick={() => void exec(playing ? 'timeline.pause' : 'timeline.play')} title={t('播放 / 暂停')}>
          {playing ? <Pause size={12} /> : <Play size={12} />}
        </IconButton>
        <span className="font-mono text-[10.5px] tabular-nums text-zinc-400">{fmt(playhead)}</span>
        <span className="text-[10px] text-zinc-600">/ {fmt(project.duration)}</span>
        <div className="bg-ink-700 mx-1 h-4 w-px" />
        <Toggle value={project.loop} onChange={(loop) => void exec('timeline.setLoop', { loop })} label={t('循环')} />
        <span className="text-[10px] text-zinc-600">{project.fps}fps</span>
        <div className="bg-ink-700 mx-1 h-4 w-px" />
        <span className="text-[9.5px] text-zinc-600">{t('缩放')}</span>
        <input
          type="range"
          min={1}
          max={8}
          step={0.5}
          value={zoom}
          onChange={(e) => updateUi((ui) => { ui.timelineZoom = Number(e.target.value); })}
          className="accent-accent h-1 w-16"
          title={t('时间轴缩放')}
        />
        <span className="w-6 font-mono text-[9.5px] text-zinc-500">{zoom.toFixed(1)}×</span>
        {overflow.length > 0 && (
          <button
            type="button"
            onClick={() => {
              for (const l of overflow) {
                void exec('timeline.setLayerTiming', {
                  id: l.id,
                  inPoint: Math.min(l.inPoint, project.duration),
                  outPoint: l.outPoint > project.duration ? project.duration : l.outPoint,
                });
              }
            }}
            className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9.5px] text-rose-300 hover:bg-rose-500/20"
            title={t('把越界的图层收回时长内')}
          >
            {t('{n} 个图层越界 · 修复', { n: overflow.length })}
          </button>
        )}
        <div className="flex-1" />
        {single && (
          <>
            <span className="text-[9.5px] text-zinc-500">
              {t('{property} @ {time}ms', { property: t(PROPERTY_LABELS[single.property]), time: single.kf.time })}
            </span>
            <select
              value={single.kf.easing.kind}
              onChange={(e) =>
                void exec('animation.setEasing', {
                  id: single.layer.id,
                  property: single.property,
                  keyframeId: single.kf.id,
                  easing: { kind: e.target.value as never },
                })
              }
              className="border-ink-700 bg-ink-850 h-6 rounded border px-1 text-[9.5px] text-zinc-300"
              title={t('缓动')}
            >
              {['linear', 'ease-in', 'ease-out', 'ease-in-out', 'ease-out-cubic', 'ease-out-back', 'ease-out-elastic'].map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
            <IconButton
              size={22}
              title={t('删除关键帧')}
              onClick={() =>
                void exec('animation.removeKeyframe', {
                  id: single.layer.id,
                  property: single.property,
                  keyframeIds: [single.kf.id],
                })
              }
            >
              <Trash2 size={11} />
            </IconButton>
          </>
        )}
        {selectedKeyframes.length > 1 && (
          <span className="text-[9.5px] text-zinc-500">{t('已选 {n} 个关键帧', { n: selectedKeyframes.length })}</span>
        )}
        <IconButton size={22} title={t('收起时间轴')} onClick={() => updateUi((ui) => { ui.showTimeline = false; })}>
          <ChevronDown size={12} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="border-ink-700/60 flex w-[168px] shrink-0 flex-col border-r">
          <div className="border-ink-700/60 flex h-5 items-center justify-between border-b px-2 text-[9px] tracking-wider text-zinc-600">
            <span>TRACKS</span>
            <button
              type="button"
              data-testid="timeline-split"
              title={t('在播放头切开选中片段（S）')}
              className="text-zinc-600 hover:text-accent-soft disabled:opacity-30"
              disabled={!selectedIds.length}
              onClick={() => {
                const id = selectedIds[0];
                if (!id) return;
                void exec('layer.split', { id, at: Math.round(playhead) }).then((res) => {
                  if (!res.ok) pushToast('warn', res.error?.message ?? t('切不开'));
                });
              }}
            >
              <Scissors size={11} />
            </button>
          </div>
          <div className="ml-scroll flex-1 overflow-y-auto">
            {rows.map((row) =>
              row.kind === 'layer' ? (
                <div
                  key={row.layer.id}
                  className={cx(
                    'flex h-6 items-center gap-1 px-1 text-[10px] transition',
                    selectedIds.includes(row.layer.id) ? 'bg-accent/15 text-zinc-200' : 'text-zinc-500 hover:bg-ink-800',
                  )}
                >
                  {isRemotionLayer(row.layer) ? (
                    /*
                     * Remotion 层的内部关键帧不在 Kinelayer 里 —— 展开也是空的。
                     * 与其给一个「点开什么都没有」的箭头，不如直接说明这一点。
                     */
                    <span className="text-amber-500/70" title={t('Remotion 组件层：内部关键帧不在时间轴上展示')}>
                      <Boxes size={11} />
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-zinc-600 hover:text-zinc-300"
                      onClick={() =>
                        updateUi((ui) => {
                          ui.expandedTracks = ui.expandedTracks.includes(row.layer.id)
                            ? ui.expandedTracks.filter((x) => x !== row.layer.id)
                            : [...ui.expandedTracks, row.layer.id];
                        })
                      }
                      title={t('展开轨道')}
                    >
                      {expanded.includes(row.layer.id) ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void exec('selection.set', { ids: [row.layer.id] })}
                    className="flex min-w-0 flex-1 items-center gap-1 text-left"
                  >
                    <span
                      className={cx(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        isRemotionLayer(row.layer)
                          ? 'bg-amber-400'
                          : row.layer.type === 'code'
                            ? 'bg-cyan'
                            : row.layer.type === 'audio'
                              ? 'bg-emerald-400'
                              : row.layer.type === 'text'
                                ? 'bg-accent'
                                : 'bg-zinc-500',
                      )}
                    />
                    <span className="truncate">{row.layer.name}</span>
                  </button>
                  <button
                    type="button"
                    title={t('自动关键帧')}
                    onClick={() => void exec('animation.setAutoKeyframe', { id: row.layer.id, enabled: !row.layer.animation.autoKeyframe })}
                    className={cx(
                      'flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold',
                      row.layer.animation.autoKeyframe ? 'bg-accent/30 text-accent-soft' : 'text-zinc-600 hover:text-zinc-300',
                    )}
                  >
                    A
                  </button>
                  <button
                    type="button"
                    title={t('用预设生成关键帧')}
                    onClick={() => setPresetFor(presetFor === row.layer.id ? null : row.layer.id)}
                    className="text-zinc-600 hover:text-accent-soft"
                  >
                    <Diamond size={10} />
                  </button>
                </div>
              ) : (
                <div
                  key={`${row.layer.id}:${row.property}`}
                  className="flex h-5 items-center gap-1 pr-1 pl-6 text-[9.5px] text-zinc-500 hover:bg-ink-800/60"
                >
                  <span className="flex-1 truncate">{t(PROPERTY_LABELS[row.property])}</span>
                  <button
                    type="button"
                    title={t('在播放头打一个关键帧')}
                    onClick={() =>
                      void exec('animation.setKeyframe', {
                        id: row.layer.id,
                        property: row.property,
                        time: Math.round(playhead - row.layer.inPoint),
                        value: Number(currentValue(row.layer, row.property).toFixed(3)),
                      })
                    }
                    className="text-zinc-600 hover:text-accent-soft"
                  >
                    <Diamond size={9} />
                  </button>
                  <button
                    type="button"
                    title={t('清空该轨道')}
                    onClick={() => void exec('animation.clearTrack', { id: row.layer.id, property: row.property })}
                    className="text-zinc-600 hover:text-rose-400"
                  >
                    <Trash2 size={9} />
                  </button>
                </div>
              ),
            )}
            {rows.length === 0 && <div className="p-2 text-[10px] text-zinc-600">{t('没有可显示的图层')}</div>}
          </div>
        </div>

        <div className="relative min-w-0 flex-1">
          <div
            className="border-ink-700/60 relative h-5 cursor-ew-resize overflow-hidden border-b"
            onPointerDown={(e) => {
              setDrag(true);
              seek(e.clientX);
            }}
          >
            {showBeats &&
              Array.from({ length: beatCount }, (_, i) => tempo.offsetMs + i * beat)
                .filter((ms) => ms >= 0 && ms <= project.duration)
                .map((ms, i) => (
                  <div
                    key={`b${i}`}
                    data-beat={i % tempo.meter === 0 ? 'bar' : 'beat'}
                    className={cx('absolute top-0 bottom-0 w-px', i % tempo.meter === 0 ? 'bg-accent/40' : 'bg-ink-600/70')}
                    style={{ left: `${(ms / project.duration) * 100}%` }}
                  />
                ))}
            {ticks.map((tk, i) => (
              <div key={i} className="absolute top-0 bottom-0" style={{ left: `${(tk / project.duration) * 100}%` }}>
                <div className="bg-ink-600 h-1.5 w-px" />
                <span className="absolute left-1 text-[9px] text-zinc-600">{Math.round(tk / 100) / 10}s</span>
              </div>
            ))}
          </div>

          <div ref={laneRef} className="ml-scroll h-[calc(100%-20px)] overflow-auto" onPointerDown={(e) => { if (e.target === e.currentTarget) { setDrag(true); seek(e.clientX); } }}>
            <div ref={contentRef} className="relative" style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
              {rows.map((row) => {
                if (row.kind === 'layer') {
                  const out = row.layer.outPoint > 0 ? row.layer.outPoint : project.duration;
                  const preview = previewClip(row.layer, Math.min(out, project.duration));
                  const bad = row.layer.inPoint > project.duration || (row.layer.outPoint > 0 && row.layer.outPoint > project.duration);
                  const left = (preview.inPoint / project.duration) * 100;
                  const width = Math.max(1.5, ((Math.max(preview.inPoint + 1, preview.out) - preview.inPoint) / project.duration) * 100);
                  const active = selectedIds.includes(row.layer.id);
                  const draggable = row.layer.type !== 'background' && !row.layer.locked;
                  const transition = row.layer.type === 'image' || row.layer.type === 'video' ? row.layer.transition : null;
                  const startClipDrag = (e: ReactPointerEvent<HTMLDivElement>, mode: 'move' | 'left' | 'right') => {
                    if (!draggable) return;
                    e.stopPropagation();
                    e.preventDefault();
                    void exec('selection.set', { ids: [row.layer.id] });
                    setClipDrag({ id: row.layer.id, mode, startX: e.clientX, delta: 0 });
                  };
                  return (
                    <div key={row.layer.id} className="group relative h-6">
                      <div
                        className={cx(
                          'absolute top-1 h-4 overflow-hidden rounded-sm border transition',
                          draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                          bad
                            ? 'border-rose-500 bg-rose-500/30'
                            : active
                              ? 'border-accent bg-accent/40'
                              : row.layer.type === 'code'
                                ? 'border-cyan/40 bg-cyan/15 hover:bg-cyan/25'
                                : row.layer.type === 'audio'
                                  ? 'border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25'
                                  : row.layer.type === 'video'
                                    ? 'border-violet-400/40 bg-violet-400/15 hover:bg-violet-400/25'
                                    : 'border-ink-600 bg-ink-700/80 hover:bg-ink-600',
                        )}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        onPointerDown={(e) => startClipDrag(e, 'move')}
                        title={`${row.layer.name} · ${Math.round(preview.inPoint)}–${Math.round(preview.out)}ms${
                          row.layer.type === 'video' || row.layer.type === 'audio'
                            ? t(' · 素材入点 {ms}ms', { ms: Math.round(row.layer.trimIn ?? 0) })
                            : ''
                        }\n${t('拖动移动 · 左右边缘裁剪 · S 在播放头切开')}`}
                      >
                        {row.layer.type === 'audio' && peaks && (
                          <AudioWave
                            peaks={peaks}
                            from={row.layer.inPoint / project.duration}
                            to={Math.min(out, project.duration) / project.duration}
                          />
                        )}
                        {transition && (
                          <div
                            className="absolute top-0 left-0 h-full w-2 bg-gradient-to-r from-accent/70 to-transparent"
                            title={t('转场 {kind} · {ms}ms', {
                              kind: t(TRANSITION_LABEL_KEY[transition.kind]),
                              ms: transition.duration,
                            })}
                          />
                        )}
                      </div>
                      {draggable && (
                        <>
                          <div
                            className={cx(
                              'absolute top-0 z-10 h-6 w-1.5 cursor-ew-resize rounded-l-sm bg-accent/0 transition group-hover:bg-accent/60',
                              active && 'bg-accent/60',
                            )}
                            style={{ left: `calc(${left}% - 3px)` }}
                            title={t('拖动裁剪左边缘（素材不会跟着滑走）')}
                            onPointerDown={(e) => startClipDrag(e, 'left')}
                          />
                          <div
                            className={cx(
                              'absolute top-0 z-10 h-6 w-1.5 cursor-ew-resize rounded-r-sm bg-accent/0 transition group-hover:bg-accent/60',
                              active && 'bg-accent/60',
                            )}
                            style={{ left: `calc(${left + width}% - 3px)` }}
                            title={t('拖动裁剪右边缘')}
                            onPointerDown={(e) => startClipDrag(e, 'right')}
                          />
                        </>
                      )}
                      {row.layer.animation?.enter && (
                        <div className="absolute top-2 h-2 w-0.5 bg-emerald-400" style={{ left: `${left}%` }} />
                      )}
                    </div>
                  );
                }
                const track = trackOf(row.layer, row.property);
                if (!track) return <div key={`${row.layer.id}:${row.property}`} className="h-5" />;
                return (
                  <div key={`${row.layer.id}:${row.property}`} className="relative h-5">
                    <div className="bg-ink-700/50 absolute top-1/2 right-0 left-0 h-px" />
                    {track.keyframes.map((kf: Keyframe) => {
                      const localOffset = kfDrag && kfDrag.ids.includes(kf.id) ? kfDrag.delta : 0;
                      const at = row.layer.inPoint + kf.time + localOffset;
                      const on = selectedKeyframes.includes(kf.id);
                      return (
                        <button
                          key={kf.id}
                          type="button"
                          title={`${t(PROPERTY_LABELS[row.property])} · ${kf.time}ms · ${kf.value} · ${kf.easing.kind}`}
                          className={cx(
                            'absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] border transition',
                            on ? 'border-accent-soft bg-accent-soft' : 'border-accent/70 bg-ink-900 hover:bg-accent/60',
                          )}
                          style={{ left: `${(at / project.duration) * 100}%` }}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            const ids = e.shiftKey
                              ? [...new Set([...selectedKeyframes, kf.id])]
                              : selectedKeyframes.includes(kf.id)
                                ? selectedKeyframes
                                : [kf.id];
                            updateUi((ui) => {
                              ui.selectedKeyframes = ids;
                            });
                            startX.current = e.clientX;
                            kfDragRef.current = { ids, delta: 0 };
                            setKfDrag({ ids, delta: 0 });
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          <div
            className="bg-accent-soft pointer-events-none absolute top-0 bottom-0 z-10 w-px"
            style={{ left: `${(playhead / project.duration) * 100}%` }}
          >
            <div className="-ml-[5px] h-2.5 w-2.5 rounded-sm bg-accent-soft" />
          </div>
        </div>
      </div>

      {presetFor && (
        <div className="border-ink-700/70 bg-ink-850 flex h-8 shrink-0 items-center gap-1 border-t px-2">
          <span className="text-[9.5px] text-zinc-500">{t('预设')}</span>
          {ANIM_PRESET_TRACKS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                void exec('animation.applyPreset', { id: presetFor, preset: p, duration: 600 });
                setPresetFor(null);
                updateUi((ui) => {
                  ui.expandedTracks = ui.expandedTracks.includes(presetFor) ? ui.expandedTracks : [...ui.expandedTracks, presetFor];
                });
              }}
              className="border-ink-700 rounded border px-1.5 py-0.5 text-[9.5px] text-zinc-400 hover:border-accent/50 hover:text-zinc-100"
            >
              {t(PRESET_LABEL[p])}
            </button>
          ))}
          <div className="flex-1" />
          <button type="button" onClick={() => setPresetFor(null)} className="text-[9.5px] text-zinc-600 hover:text-zinc-300">
            {t('取消')}
          </button>
        </div>
      )}
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
