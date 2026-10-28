import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, MousePointer2, Pause, Play, Repeat, SkipBack, SkipForward } from 'lucide-react';
import { exec } from '@/core/commandBus';
import { clamp, fitViewport, hitLayer, layerCenter, rotatePoint, screenToWorld, snapValue, type Vec } from '@/core/geometry';
import { updateUi, useEditor } from '@/core/store';
import { computeLayerFrame } from '@/render/animation';
import { renderScene, prepareVideos } from '@/render/renderScene';
import { bridgeToken, injectBridge } from '@/render/htmlBridge';
import { subscribeAssets } from '@/render/assets';
import type { CodeLayer, Layer, Project } from '@/core/types';

import { t } from '@/i18n';
import { timecode } from '@/ui/timecode';
import { cx } from '@/ui/primitives';
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

interface DragState {
  kind: 'move' | 'resize' | 'rotate' | 'marquee' | 'pan';
  start: Vec;
  startClient: { x: number; y: number };
  ids: string[];
  origins: Record<string, { x: number; y: number; w: number; h: number; r: number }>;
  handle?: Handle;
  center?: Vec;
  startAngle?: number;
  panOrigin?: { x: number; y: number };
  moved: boolean;
}

const HANDLE_SIZE = 7;

/**
 * 剪映式播放控制条。
 *
 * 单独成一个组件不是为了好看：它订阅了 playhead，而播放时 playhead 每帧都变 ——
 * 挂在 Stage 里就等于让整棵树（含 HTML 层的 iframe 重算 transform）跟着 60fps 重渲染。
 * 这里只让一条 30px 高的控制条跟着走。
 */
function PlayBar() {
  const playing = useEditor((s) => s.runtime.playing);
  const playhead = useEditor((s) => s.runtime.playhead);
  const duration = useEditor((s) => s.project.duration);
  const loop = useEditor((s) => s.project.loop);
  const fps = useEditor((s) => s.project.fps);
  const range = useEditor((s) => s.project.range);

  const step = Math.max(1, Math.round(1000 / Math.max(1, fps)));
  /* 帧号对齐：时间轴上的播放头是连续毫秒，逐帧步进要落在整帧上，否则按十几下会漂出半帧 */
  const frameOf = (ms: number) => Math.round((ms * fps) / 1000);
  const msOf = (frame: number) => (frame * 1000) / fps;

  const seek = (ms: number) => void exec('timeline.seek', { time: clamp(ms, 0, duration) });
  const nudge = (dir: -1 | 1) => seek(msOf(frameOf(playhead) + dir));

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 px-3 pb-3">
      <div
        className="shadow-pop pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/10 bg-[#101013]/92 px-1.5 py-1 backdrop-blur"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <BarButton title={t('回到开头')} onClick={() => seek(0)}>
          <SkipBack size={13} />
        </BarButton>
        <BarButton title={t('上一帧 (←)')} onClick={() => nudge(-1)}>
          <ChevronLeft size={14} />
        </BarButton>
        <button
          type="button"
          title={t('播放 / 暂停 (Space)')}
          onClick={() => void exec(playing ? 'timeline.pause' : 'timeline.play')}
          className="mx-0.5 grid h-8 w-8 place-items-center rounded-full bg-accent text-[#04121c] transition-colors hover:bg-accent-soft"
        >
          {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
        </button>
        <BarButton title={t('下一帧 (→)')} onClick={() => nudge(1)}>
          <ChevronRight size={14} />
        </BarButton>
        <BarButton title={t('到结尾')} onClick={() => seek(duration)}>
          <SkipForward size={13} />
        </BarButton>

        <div className="mx-1 h-4 w-px bg-white/10" />

        <div className="pr-1.5 pl-0.5 font-mono text-[10.5px] leading-none tabular-nums text-zinc-300">
          {timecode(playhead, fps)}
          <span className="text-zinc-600"> / {timecode(duration, fps)}</span>
        </div>

        {/*
         * 有出片区间时挂一个小标：播放会在出点停住，这件事必须在屏幕上有个解释，
         * 否则用户只会觉得「播到一半自己停了」。
         */}
        {range && (
          <button
            type="button"
            data-testid="playbar-range"
            title={t('出片区间 {from} → {to}：播放到这里会停住，导出也只出这一段', {
              from: timecode(range.in, fps),
              to: timecode(range.out, fps),
            })}
            onClick={() => seek(Math.max(0, range.in))}
            className="ml-1 rounded-full border border-accent/40 bg-accent/15 px-1.5 py-0.5 font-mono text-[9px] leading-none text-accent-soft"
          >
            {t('区间')} {timecode(range.in, fps)}
          </button>
        )}
      </div>

      <div
        className="shadow-pop pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/10 bg-[#101013]/92 px-1.5 py-1 backdrop-blur"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <BarButton title={t('循环播放')} onClick={() => void exec('timeline.setLoop', { loop: !loop })} active={loop}>
          <Repeat size={13} />
        </BarButton>
        <BarButton title={t('适应窗口 (Shift+1)')} onClick={() => window.dispatchEvent(new CustomEvent('ml:fit'))}>
          <Maximize2 size={13} />
        </BarButton>
      </div>
    </div>
  );
}

function BarButton({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        'grid h-7 w-7 place-items-center rounded-full transition-colors',
        active ? 'bg-accent/20 text-accent-soft' : 'text-zinc-400 hover:bg-white/8 hover:text-zinc-100',
      )}
    >
      {children}
    </button>
  );
}

/** 00:00:00:00 式的专业时序码（分:秒:帧），剪映里播放头读数就是这个口径 */
function getFrame(project: Project, id: string) {
  const index = project.layers.findIndex((l) => l.id === id);
  const layer = project.layers[index];
  if (!layer) return null;
  return { layer, index, frame: computeLayerFrame(layer, index, useEditor.getState().runtime.playhead, project.duration) };
}

function handlePoints(box: { x: number; y: number; width: number; height: number }): [Handle, Vec][] {
  const { x, y, width: w, height: h } = box;
  return [
    ['nw', { x, y }],
    ['n', { x: x + w / 2, y }],
    ['ne', { x: x + w, y }],
    ['e', { x: x + w, y: y + h / 2 }],
    ['se', { x: x + w, y: y + h }],
    ['s', { x: x + w / 2, y: y + h }],
    ['sw', { x, y: y + h }],
    ['w', { x, y: y + h / 2 }],
  ];
}

export function Stage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const dragRef = useRef<DragState | null>(null);
  const overridesRef = useRef<Map<string, Partial<Layer>>>(new Map());
  const guidesRef = useRef<{ x: number | null; y: number | null }>({ x: null, y: null });
  const marqueeRef = useRef<{ a: Vec; b: Vec } | null>(null);
  const spaceRef = useRef(false);
  const fittedRef = useRef(false);
  const userAdjustedRef = useRef(false);
  const lastSigRef = useRef('');
  /** 上一次为哪个「版本|毫秒」seek 过视频（同一个 key 不重复 seek，否则 rAF 会自激） */
  const prepKeyRef = useRef('');
  const prepAtRef = useRef(0);
  const tickRef = useRef(0);
  /**
   * html 代码层的时间同步。
   *
   * iframe 里的 GSAP/CSS 动画默认按真实时间自己跑，跟主时间轴没关系；
   * 这里把「图层 id → iframe 元素」和「图层 id → token」存下来，
   * 在下面的 rAF 循环里按播放头推时间（见 htmlBridge.ts）。
   */
  const htmlFrameRefs = useRef(new Map<string, HTMLIFrameElement>());
  const htmlTokensRef = useRef<{ id: string; token: string }[]>([]);
  const lastHtmlMsRef = useRef(-1);
  /**
   * 桥接脚本量出来的内容包围盒（设计稿坐标）。
   * iframe 的白底去不掉，只能把它收缩到真内容那一块，见 render/htmlBridge.ts。
   * 拿到之前按整张设计稿铺，但 opacity 为 0 —— 不然会先闪一下整块白。
   */
  const [htmlBounds, setHtmlBounds] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const setOverrides = (map: Map<string, Partial<Layer>>) => {
    overridesRef.current = map;
    tickRef.current += 1;
  };
  const [editingText, setEditingText] = useState<{ id: string; value: string } | null>(null);
  const [cursor, setCursor] = useState('default');

  const project = useEditor((s) => s.project);
  const zoom = useEditor((s) => s.ui.zoom);
  const panX = useEditor((s) => s.ui.panX);
  const panY = useEditor((s) => s.ui.panY);
  const selectedIds = useEditor((s) => s.ui.selectedIds);
  const showSafeArea = useEditor((s) => s.ui.showSafeArea);
  const snapping = useEditor((s) => s.ui.snapping);

  /* --------------------------------------------------------- resize + fit */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fit = () => {
      const s = sizeRef.current;
      if (!s.w || !s.h) return;
      const p = useEditor.getState().project;
      const vp = fitViewport(s.w, s.h, p.width, p.height, 72);
      userAdjustedRef.current = false;
      updateUi((ui) => {
        ui.zoom = vp.zoom;
        ui.panX = vp.panX;
        ui.panY = vp.panY;
      });
    };
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      sizeRef.current = { w: rect.width, h: rect.height };
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = Math.min(2.5, window.devicePixelRatio || 1);
        const w = Math.max(1, Math.round(rect.width * dpr));
        const h = Math.max(1, Math.round(rect.height * dpr));
        // 赋值 width/height 会清空位图：尺寸没变时不要写，否则会白屏
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          canvas.style.width = `${rect.width}px`;
          canvas.style.height = `${rect.height}px`;
          lastSigRef.current = '';
        }
      }
      if (rect.width > 10) {
        // 首次布局会连续变化（侧栏/面板挂载），未手动缩放前持续跟随容器重算
        if (!fittedRef.current || !userAdjustedRef.current) {
          fittedRef.current = true;
          fit();
        }
      }
    });
    ro.observe(el);
    const onFit = () => fit();
    window.addEventListener('ml:fit', onFit);
    /* 资源迟到（视频解码完成、图片 load）也要重画：签名里没有资源状态 */
    const unsubscribe = subscribeAssets(() => {
      lastSigRef.current = '';
    });
    return () => {
      ro.disconnect();
      window.removeEventListener('ml:fit', onFit);
      unsubscribe();
    };
  }, []);

  /* ------------------------------------------------------------- the loop */

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const state = useEditor.getState();
      const { project: p, ui, runtime } = state;
      const dpr = Math.min(2.5, window.devicePixelRatio || 1);
      const sig = [
        `${canvas.width}x${canvas.height}`,
        p.version,
        runtime.playhead.toFixed(1),
        ui.zoom.toFixed(4),
        ui.panX.toFixed(1),
        ui.panY.toFixed(1),
        ui.selectedIds.join(','),
        tickRef.current,
        marqueeRef.current
          ? `m${marqueeRef.current.a.x.toFixed(1)},${marqueeRef.current.b.y.toFixed(1)}`
          : '',
        ui.showSafeArea ? 's' : '',
      ].join('|');
      if (sig === lastSigRef.current) return;
      lastSigRef.current = sig;

      /*
       * html 代码层：把播放头推给 iframe。
       * 判重按整毫秒 —— 播放头是 float，逐帧相比会把 60fps 的消息量翻倍而画面没有区别。
       */
      const htmlMs = Math.round(runtime.playhead);
      if (htmlMs !== lastHtmlMsRef.current) {
        lastHtmlMsRef.current = htmlMs;
        for (const entry of htmlTokensRef.current) {
          htmlFrameRefs.current.get(entry.id)?.contentWindow?.postMessage({ kly: entry.token, type: 'time', ms: htmlMs }, '*');
        }
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(ui.panX, ui.panY);
      ctx.scale(ui.zoom, ui.zoom);

      /*
       * 视频层：画之前必须先把它 seek 到当前时刻。
       *
       * 以前预览这条路不 seek（只有导出走 prepareVideos），于是视频层在画布上
       * 永远显示「视频解码中…」——因为 MediaRecorder/无索引的 WebM 在第一次
       * seek 之前 readyState 到不了 HAVE_CURRENT_DATA。seek 完成后把签名清掉，
       * 让下一帧重画；播放时按 100ms 节流，逐帧 seek 会把解码器拖死。
       */
      const hasVideo = p.layers.some((l) => l.type === 'video' && l.visible);
      if (hasVideo) {
        const key = `${p.version}|${Math.round(runtime.playhead)}`;
        const now = performance.now();
        if (key !== prepKeyRef.current && (!runtime.playing || now - prepAtRef.current > 100)) {
          prepKeyRef.current = key;
          prepAtRef.current = now;
          void prepareVideos(p, runtime.playhead).then(() => {
            /*
             * seeked 不等于「这一帧可以 drawImage 了」：WebM/长 GOP 素材
             * 常常是 seeked 先到、解码晚一两帧。追几帧，否则画面会停在占位框上
             * 再也不动（签名没变，rAF 不会重画）。
             */
            let tries = 0;
            const bump = () => {
              lastSigRef.current = '';
              tries += 1;
              if (tries < 6) setTimeout(bump, 70);
            };
            bump();
          });
        }
      }

      // 画布外的白边警示（内容超出画布时可见）
      ctx.fillStyle = '#0d1119';
      ctx.fillRect(0, 0, p.width, p.height);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.55)';
      ctx.shadowBlur = 42 / ui.zoom;
      ctx.shadowOffsetY = 12 / ui.zoom;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, p.width, p.height);
      ctx.restore();

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, p.width, p.height);
      ctx.clip();
      renderScene(ctx, p, {
        time: runtime.playhead,
        scale: clamp(ui.zoom * dpr, 0.5, 2),
        overrides: overridesRef.current,
        /* html 层由下面的 iframe 实时渲染，canvas 不要再画占位（会盖住原生层） */
        htmlLive: true,
      });
      ctx.restore();

      // 安全区
      if (ui.showSafeArea) {
        ctx.save();
        ctx.strokeStyle = 'rgba(34,211,238,.45)';
        ctx.lineWidth = 1 / ui.zoom;
        ctx.setLineDash([8 / ui.zoom, 6 / ui.zoom]);
        const inset = 0.05;
        ctx.strokeRect(p.width * inset, p.height * inset, p.width * (1 - inset * 2), p.height * (1 - inset * 2));
        ctx.restore();
      }

      // 吸附参考线
      const guides = guidesRef.current;
      if (guides.x !== null || guides.y !== null) {
        ctx.save();
        ctx.strokeStyle = 'rgba(34,211,238,.9)';
        ctx.lineWidth = 1 / ui.zoom;
        if (guides.x !== null) {
          ctx.beginPath();
          ctx.moveTo(guides.x, -2000);
          ctx.lineTo(guides.x, p.height + 2000);
          ctx.stroke();
        }
        if (guides.y !== null) {
          ctx.beginPath();
          ctx.moveTo(-2000, guides.y);
          ctx.lineTo(p.width + 2000, guides.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 选中框
      const frames = ui.selectedIds
        .map((id) => {
          const layer = p.layers.find((l) => l.id === id);
          if (!layer) return null;
          const index = p.layers.indexOf(layer);
          const override = overridesRef.current.get(id);
          const merged = override ? ({ ...layer, ...override } as Layer) : layer;
          return { layer: merged, frame: computeLayerFrame(merged, index, runtime.playhead, p.duration) };
        })
        .filter(Boolean) as { layer: Layer; frame: ReturnType<typeof computeLayerFrame> }[];

      for (const item of frames) {
        const { frame } = item;
        const cx = frame.x + frame.width / 2;
        const cy = frame.y + frame.height / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((frame.rotation * Math.PI) / 180);
        ctx.strokeStyle = 'rgba(124,92,255,.95)';
        ctx.lineWidth = 1.4 / ui.zoom;
        ctx.strokeRect(-frame.width / 2, -frame.height / 2, frame.width, frame.height);
        if (frames.length === 1 && !item.layer.locked) {
          const hs = HANDLE_SIZE / ui.zoom;
          ctx.fillStyle = '#0b0e14';
          for (const [, pt] of handlePoints({ x: -frame.width / 2, y: -frame.height / 2, width: frame.width, height: frame.height })) {
            ctx.beginPath();
            ctx.rect(pt.x - hs / 2, pt.y - hs / 2, hs, hs);
            ctx.fill();
            ctx.stroke();
          }
          // 旋转手柄
          const ry = -frame.height / 2 - 22 / ui.zoom;
          ctx.beginPath();
          ctx.moveTo(0, -frame.height / 2);
          ctx.lineTo(0, ry);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, ry, (HANDLE_SIZE / 2 + 1) / ui.zoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // 框选
      const mq = marqueeRef.current;
      if (mq) {
        ctx.save();
        const x = Math.min(mq.a.x, mq.b.x);
        const y = Math.min(mq.a.y, mq.b.y);
        ctx.fillStyle = 'rgba(124,92,255,.12)';
        ctx.strokeStyle = 'rgba(124,92,255,.8)';
        ctx.lineWidth = 1 / ui.zoom;
        ctx.fillRect(x, y, Math.abs(mq.b.x - mq.a.x), Math.abs(mq.b.y - mq.a.y));
        ctx.strokeRect(x, y, Math.abs(mq.b.x - mq.a.x), Math.abs(mq.b.y - mq.a.y));
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* -------------------------------------------------------------- pointer */

  const localPoint = (e: { clientX: number; clientY: number }): Vec => {
    const rect = containerRef.current?.getBoundingClientRect();
    const ui = useEditor.getState().ui;
    return screenToWorld({ zoom: ui.zoom, panX: ui.panX, panY: ui.panY }, e.clientX - (rect?.left ?? 0), e.clientY - (rect?.top ?? 0));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return;
    const state = useEditor.getState();
    const { ui, project: p } = state;
    const point = localPoint(e);
    e.currentTarget.setPointerCapture(e.pointerId);

    if (e.button === 1 || spaceRef.current) {
      userAdjustedRef.current = true;
      dragRef.current = {
        kind: 'pan',
        start: point,
        startClient: { x: e.clientX, y: e.clientY },
        ids: [],
        origins: {},
        panOrigin: { x: ui.panX, y: ui.panY },
        moved: false,
      };
      setCursor('grabbing');
      return;
    }

    // 手柄优先
    if (ui.selectedIds.length === 1) {
      const item = getFrame(p, ui.selectedIds[0] as string);
      if (item && !item.layer.locked) {
        const { frame, layer } = item;
        const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
        const local = rotatePoint(point, center, -frame.rotation);
        const tol = 7 / ui.zoom;
        const handles = handlePoints({ x: frame.x, y: frame.y, width: frame.width, height: frame.height });
        for (const [name, pt] of handles) {
          if (Math.abs(local.x - pt.x) <= tol && Math.abs(local.y - pt.y) <= tol) {
            dragRef.current = {
              kind: 'resize',
              start: point,
              startClient: { x: e.clientX, y: e.clientY },
              ids: [layer.id],
              origins: { [layer.id]: { x: layer.x, y: layer.y, w: layer.width, h: layer.height, r: layer.rotation } },
              handle: name,
              moved: false,
            };
            return;
          }
        }
        const rotateHandle = rotatePoint({ x: center.x, y: frame.y - 22 / ui.zoom }, center, frame.rotation);
        if (Math.hypot(point.x - rotateHandle.x, point.y - rotateHandle.y) <= 10 / ui.zoom) {
          dragRef.current = {
            kind: 'rotate',
            start: point,
            startClient: { x: e.clientX, y: e.clientY },
            ids: [layer.id],
            origins: { [layer.id]: { x: layer.x, y: layer.y, w: layer.width, h: layer.height, r: layer.rotation } },
            center,
            startAngle: Math.atan2(point.y - center.y, point.x - center.x),
            moved: false,
          };
          return;
        }
      }
    }

    // 命中图层（从顶到底）
    for (let i = p.layers.length - 1; i >= 1; i--) {
      const layer = p.layers[i] as Layer;
      if (!layer.visible || layer.locked) continue;
      const index = i;
      const frame = computeLayerFrame(layer, index, state.runtime.playhead, p.duration);
      const hitBox = { ...layer, x: frame.x, y: frame.y, width: frame.width, height: frame.height, rotation: frame.rotation };
      if (!hitLayer(hitBox as Layer, point)) continue;
      const already = ui.selectedIds.includes(layer.id);
      const ids = e.shiftKey || e.metaKey || e.ctrlKey
        ? already
          ? ui.selectedIds.filter((x) => x !== layer.id)
          : [...ui.selectedIds, layer.id]
        : already
          ? ui.selectedIds
          : [layer.id];
      if (!already || e.shiftKey) void exec('selection.set', { ids });
      const targetIds = ids.length ? ids : [layer.id];
      const origins: DragState['origins'] = {};
      for (const id of targetIds) {
        const l = p.layers.find((x) => x.id === id);
        if (l && l.type !== 'background' && !l.locked) origins[id] = { x: l.x, y: l.y, w: l.width, h: l.height, r: l.rotation };
      }
      dragRef.current = {
        kind: 'move',
        start: point,
        startClient: { x: e.clientX, y: e.clientY },
        ids: Object.keys(origins),
        origins,
        moved: false,
      };
      setCursor('move');
      return;
    }

    if (!e.shiftKey) void exec('selection.clear', {});
    dragRef.current = {
      kind: 'marquee',
      start: point,
      startClient: { x: e.clientX, y: e.clientY },
      ids: [],
      origins: {},
      moved: false,
    };
    marqueeRef.current = { a: point, b: point };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = useEditor.getState();
    const { project: p, ui } = state;
    const drag = dragRef.current;
    const point = localPoint(e);

    if (!drag) {
      // 悬停光标提示
      if (ui.selectedIds.length === 1) {
        const item = getFrame(p, ui.selectedIds[0] as string);
        if (item) {
          const { frame } = item;
          const center = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 };
          const local = rotatePoint(point, center, -frame.rotation);
          const tol = 7 / ui.zoom;
          let next = 'default';
          for (const [name, pt] of handlePoints({ x: frame.x, y: frame.y, width: frame.width, height: frame.height })) {
            if (Math.abs(local.x - pt.x) <= tol && Math.abs(local.y - pt.y) <= tol) {
              next = name === 'n' || name === 's' ? 'ns-resize' : name === 'e' || name === 'w' ? 'ew-resize' : name === 'nw' || name === 'se' ? 'nwse-resize' : 'nesw-resize';
            }
          }
          if (next !== cursor) setCursor(next);
        }
      }
      return;
    }

    if (Math.hypot(e.clientX - drag.startClient.x, e.clientY - drag.startClient.y) > 2) drag.moved = true;

    if (drag.kind === 'pan') {
      updateUi((draft) => {
        draft.panX = (drag.panOrigin?.x ?? 0) + (e.clientX - drag.startClient.x);
        draft.panY = (drag.panOrigin?.y ?? 0) + (e.clientY - drag.startClient.y);
      });
      return;
    }

    if (drag.kind === 'marquee') {
      marqueeRef.current = { a: drag.start, b: point };
      tickRef.current += 1;
      return;
    }

    if (drag.kind === 'move') {
      let dx = point.x - drag.start.x;
      let dy = point.y - drag.start.y;
      guidesRef.current = { x: null, y: null };
      const firstId = drag.ids[0];
      if (snapping && drag.ids.length === 1 && firstId) {
        const origin = drag.origins[firstId];
        if (origin) {
          const threshold = 6 / ui.zoom;
          const targetXs = [0, p.width / 2, p.width];
          const targetYs = [0, p.height / 2, p.height];
          for (const l of p.layers) {
            if (l.id === firstId) continue;
            targetXs.push(l.x, l.x + l.width / 2, l.x + l.width);
            targetYs.push(l.y, l.y + l.height / 2, l.y + l.height);
          }
          const candX = [origin.x + dx, origin.x + dx + origin.w / 2, origin.x + dx + origin.w];
          for (let i = 0; i < candX.length; i++) {
            const snap = snapValue(candX[i] as number, targetXs, threshold);
            if (snap.guide !== null) {
              dx += snap.value - (candX[i] as number);
              guidesRef.current.x = snap.guide;
              break;
            }
          }
          const candY = [origin.y + dy, origin.y + dy + origin.h / 2, origin.y + dy + origin.h];
          for (let i = 0; i < candY.length; i++) {
            const snap = snapValue(candY[i] as number, targetYs, threshold);
            if (snap.guide !== null) {
              dy += snap.value - (candY[i] as number);
              guidesRef.current.y = snap.guide;
              break;
            }
          }
        }
      }
      const map = new Map<string, Partial<Layer>>();
      for (const id of drag.ids) {
        const o = drag.origins[id];
        if (!o) continue;
        map.set(id, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) });
      }
      setOverrides(map);
      return;
    }

    if (drag.kind === 'resize') {
      const id = drag.ids[0];
      const origin = id ? drag.origins[id] : undefined;
      if (!id || !origin) return;
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      let { x, y, w, h } = origin;
      const min = 8;
      const handle = drag.handle;
      if (handle?.includes('e')) w = Math.max(min, origin.w + dx);
      if (handle?.includes('s')) h = Math.max(min, origin.h + dy);
      if (handle?.includes('w')) {
        w = Math.max(min, origin.w - dx);
        x = origin.x + origin.w - w;
      }
      if (handle?.includes('n')) {
        h = Math.max(min, origin.h - dy);
        y = origin.y + origin.h - h;
      }
      setOverrides(new Map([[id, { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }]]));
      return;
    }

    if (drag.kind === 'rotate') {
      const id = drag.ids[0];
      const origin = id ? drag.origins[id] : undefined;
      if (!id || !origin || !drag.center) return;
      const angle = Math.atan2(point.y - drag.center.y, point.x - drag.center.x);
      let deg = origin.r + ((angle - (drag.startAngle ?? 0)) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      setOverrides(new Map([[id, { rotation: Math.round(deg * 10) / 10 }]]));
    }
  };

  const onPointerUp = async () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setCursor('default');
    if (!drag) return;

    if (drag.kind === 'marquee') {
      const mq = marqueeRef.current;
      marqueeRef.current = null;
      if (mq && (Math.abs(mq.b.x - mq.a.x) > 4 || Math.abs(mq.b.y - mq.a.y) > 4)) {
        const state = useEditor.getState();
        const x1 = Math.min(mq.a.x, mq.b.x);
        const x2 = Math.max(mq.a.x, mq.b.x);
        const y1 = Math.min(mq.a.y, mq.b.y);
        const y2 = Math.max(mq.a.y, mq.b.y);
        const hits: string[] = [];
        for (let i = 1; i < state.project.layers.length; i++) {
          const layer = state.project.layers[i] as Layer;
          if (!layer.visible || layer.locked) continue;
          const frame = computeLayerFrame(layer, i, state.runtime.playhead, state.project.duration);
          const cx = frame.x + frame.width / 2;
          const cy = frame.y + frame.height / 2;
          const corners = [
            { x: frame.x, y: frame.y },
            { x: frame.x + frame.width, y: frame.y },
            { x: frame.x + frame.width, y: frame.y + frame.height },
            { x: frame.x, y: frame.y + frame.height },
          ].map((pt) => rotatePoint(pt, { x: cx, y: cy }, frame.rotation));
          if (corners.some((pt) => pt.x >= x1 && pt.x <= x2 && pt.y >= y1 && pt.y <= y2)) hits.push(layer.id);
        }
        if (hits.length) await exec('selection.set', { ids: hits });
      }
      return;
    }

    if (!drag.moved) {
      setOverrides(new Map());
      return;
    }

    const overrides = overridesRef.current;
    guidesRef.current = { x: null, y: null };
    setOverrides(new Map());

    if (drag.kind === 'move' && drag.ids.length > 1) {
      const commands = drag.ids
        .map((id) => ({ id, patch: overrides.get(id) }))
        .filter((c) => c.patch)
        .map((c) => ({ type: 'layer.update', payload: { id: c.id, patch: c.patch } }));
      if (commands.length) await exec('command.batch', { commands, atomic: true });
      return;
    }

    for (const [id, patch] of overrides.entries()) {
      await exec('layer.update', { id, patch });
    }
  };

  /* --------------------------------------------------------------- wheel */

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const state = useEditor.getState();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { zoom: z, panX: px, panY: py } = state.ui;
      userAdjustedRef.current = true;
      if (e.ctrlKey || e.metaKey) {
        const next = clamp(z * Math.exp(-e.deltaY * 0.0015), 0.02, 8);
        updateUi((ui) => {
          ui.zoom = next;
          ui.panX = mx - ((mx - px) * next) / z;
          ui.panY = my - ((my - py) * next) / z;
        });
      } else {
        updateUi((ui) => {
          ui.panX = px - e.deltaX;
          ui.panY = py - e.deltaY;
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /* -------------------------------------------------------- space to pan */

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        spaceRef.current = true;
        setCursor('grab');
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setCursor('default');
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const state = useEditor.getState();
    const point = localPoint(e);
    for (let i = state.project.layers.length - 1; i >= 1; i--) {
      const layer = state.project.layers[i] as Layer;
      if (layer.type !== 'text' || layer.locked) continue;
      const frame = computeLayerFrame(layer, i, state.runtime.playhead, state.project.duration);
      if (hitLayer({ ...layer, x: frame.x, y: frame.y } as Layer, point)) {
        setEditingText({ id: layer.id, value: layer.text });
        return;
      }
    }
  };

  const editingLayerRaw = editingText ? project.layers.find((l) => l.id === editingText.id) : null;
  const editingLayer = editingLayerRaw && editingLayerRaw.type === 'text' ? editingLayerRaw : null;
  const htmlLayers = useMemo(
    () => project.layers.filter((l): l is CodeLayer => l.type === 'code' && l.code.engine === 'html' && l.visible),
    [project.layers],
  );

  /*
   * 注入桥接脚本 + 记 token。按「源码 + id」缓存：React 重渲染时字符串不变，
   * iframe 的 srcDoc 才不会被判定为「变了又重载一遍」—— 重载会闪一下白。
   * 依赖必须挂在 project.layers 上：Stage 在拖动平移时每帧重渲染，
   * 若依赖是每次新建的 filter 结果，这里就会每帧重拼一遍几十 KB 的字符串。
   */
  const htmlFrames = useMemo(
    () =>
      htmlLayers.map((layer) => {
        const token = bridgeToken(layer.id);
        const designWidth = Number(layer.code.params.designWidth) || layer.width;
        const designHeight = Number(layer.code.params.designHeight) || layer.height;
        return {
          layer,
          token,
          designWidth: Math.max(1, designWidth),
          designHeight: Math.max(1, designHeight),
          srcDoc: injectBridge(layer.code.source, token),
        };
      }),
    [htmlLayers],
  );

  useEffect(() => {
    htmlTokensRef.current = htmlFrames.map((x) => ({ id: x.layer.id, token: x.token }));
  }, [htmlFrames]);

  /*
   * 宿主侧校验：iframe 没有 allow-same-origin，event.origin 恒为 "null"，
   * 拿 origin 判断「谁发的」毫无意义。只认「来自我这些 iframe 的 contentWindow」。
   * 收到 ready 就立刻补推一次当前时间，别等到下一帧 —— 否则会停在 bridge 冻结的那一帧。
   * 收到 bounds 就把 iframe 收缩到内容区域（它铺满画布会把原生层全糊掉）。
   */
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const source = e.source as Window | null;
      if (!source) return;
      let matchedId = '';
      for (const [id, frame] of htmlFrameRefs.current) {
        if (frame.contentWindow === source) {
          matchedId = id;
          break;
        }
      }
      if (!matchedId) return;
      const data = e.data as { kly?: string; type?: string; box?: { x: number; y: number; w: number; h: number } } | null;
      if (!data) return;

      if (data.type === 'bounds' && data.box) {
        const box = data.box;
        setHtmlBounds((prev) => {
          const old = prev[matchedId];
          if (old && old.x === box.x && old.y === box.y && old.w === box.w && old.h === box.h) return prev;
          return { ...prev, [matchedId]: box };
        });
        return;
      }
      if (data.type !== 'ready') return;

      const ms = Math.round(useEditor.getState().runtime.playhead);
      lastHtmlMsRef.current = ms;
      for (const entry of htmlTokensRef.current) {
        htmlFrameRefs.current.get(entry.id)?.contentWindow?.postMessage({ kly: entry.token, type: 'time', ms }, '*');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const makeTransform = useCallback(
    (layer: Layer) => {
      const index = project.layers.indexOf(layer);
      const frame = computeLayerFrame(layer, index, useEditor.getState().runtime.playhead, project.duration);
      return {
        left: frame.x,
        top: frame.y,
        width: frame.width,
        height: frame.height,
        rotation: frame.rotation,
        opacity: frame.opacity,
      };
    },
    [project],
  );

  return (
    <div
      ref={containerRef}
      data-testid="stage"
      className="relative flex-1 overflow-hidden bg-[#0b0b0d]"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => void onPointerUp()}
      onPointerCancel={() => void onPointerUp()}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 网格铺在画布下面：画布是透明的，网格只该出现在画布外的留白区 */}
      <div className="ml-grid pointer-events-none absolute inset-0" />
      <canvas ref={canvasRef} className="absolute inset-0 block" />

      {/* HTML 代码层：编辑态用 sandbox iframe 实时渲染（导出时走 foreignObject 栅格化） */}
      {htmlFrames.map(({ layer, token, designWidth, designHeight, srcDoc }) => {
        const t = makeTransform(layer);
        /*
         * iframe 按设计稿尺寸铺，再整体 scale 到图层盒子：
         * 里面的 vw/vh 和百分比定位认的是 designWidth/Height，
         * 直接改 iframe 宽高会让内容跟着盒子一起被「重新排版」，跟画面里看到的不是一回事。
         *
         * 尺寸/位置用桥接脚本量出来的内容包围盒（box）：iframe 的白底去不掉（实测过），
         * 只能让它缩到真有内容的那块，别把整张画布连同下面的原生层一起盖住。
         * 还没量到时先 opacity 0，避免闪一下整块白。
         */
        const fitX = t.width / designWidth;
        const fitY = t.height / designHeight;
        const box = htmlBounds[layer.id];
        const w = box?.w ?? designWidth;
        const h = box?.h ?? designHeight;
        const bx = box?.x ?? 0;
        const by = box?.y ?? 0;
        return (
          <iframe
            key={layer.id}
            ref={(el) => {
              if (el) htmlFrameRefs.current.set(layer.id, el);
              else htmlFrameRefs.current.delete(layer.id);
            }}
            title={layer.name}
            data-kly-token={token}
            srcDoc={srcDoc}
            sandbox="allow-scripts"
            className="pointer-events-none absolute border-0"
            /* onLoad 主动要一次包围盒：桥接自己的上报有竞态 —— srcdoc 的 iframe 可能在
               宿主 useEffect 装好监听之前就把消息发出去，那条会直接丢（偶发的铺满画布就是这个） */
            onLoad={(e) => e.currentTarget.contentWindow?.postMessage({ kly: token, type: 'measure' }, '*')}
            style={{
              left: 0,
              top: 0,
              width: w,
              height: h,
              opacity: box ? t.opacity : 0,
              transform: `translate(${panX + (t.left + bx * fitX) * zoom}px, ${panY + (t.top + by * fitY) * zoom}px) rotate(${t.rotation}deg) scale(${zoom * Math.min(fitX, fitY)})`,
              transformOrigin: '0 0',
            }}
          />
        );
      })}

      {/* 文本就地编辑 */}
      {editingText && editingLayer && (
        <textarea
          autoFocus
          value={editingText.value}
          onChange={(e) => setEditingText({ id: editingText.id, value: e.target.value })}
          onBlur={() => {
            if (editingText.value !== editingLayer.text) void exec('text.setContent', { id: editingText.id, text: editingText.value });
            setEditingText(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setEditingText(null);
              e.stopPropagation();
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur();
          }}
          spellCheck={false}
          className="absolute resize-none rounded-sm border border-accent bg-black/55 p-0 outline-none"
          style={{
            left: 0,
            top: 0,
            width: editingLayer.width,
            height: editingLayer.height,
            transform: `translate(${panX + editingLayer.x * zoom}px, ${panY + editingLayer.y * zoom}px) rotate(${editingLayer.rotation}deg) scale(${zoom})`,
            transformOrigin: '0 0',
            color: editingLayer.style.color,
            fontFamily: `"${editingLayer.style.fontFamily}", "Microsoft YaHei", sans-serif`,
            fontSize: editingLayer.style.fontSize,
            fontWeight: editingLayer.style.fontWeight,
            lineHeight: editingLayer.style.lineHeight,
            letterSpacing: editingLayer.style.letterSpacing,
            textAlign: editingLayer.style.align,
            caretColor: '#5cc8ff',
          }}
        />
      )}

      {/* 剪映式播放控制条：悬浮在预览区底部，不参与画布拖拽 */}
      <PlayBar />

      {/* 操作提示：挪到预览区顶部。底部已经是播放控制条的地盘，两条并排会互相挤 */}
      {selectedIds.length === 0 && !editingText && (
        <div className="pointer-events-none absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/8 bg-[#101013]/70 px-3 py-1 text-[10.5px] text-zinc-500 backdrop-blur">
          <MousePointer2 size={11} /> {t('拖拽移动 · 双击编辑文本 · 空格拖拽平移 · Ctrl+滚轮缩放')}
        </div>
      )}
    </div>
  );
}
