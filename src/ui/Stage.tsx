import { useCallback, useEffect, useRef, useState } from 'react';
import { MousePointer2 } from 'lucide-react';
import { exec } from '@/core/commandBus';
import { clamp, fitViewport, hitLayer, layerCenter, rotatePoint, screenToWorld, snapValue, type Vec } from '@/core/geometry';
import { updateUi, useEditor } from '@/core/store';
import { computeLayerFrame } from '@/render/animation';
import { renderScene } from '@/render/renderScene';
import type { CodeLayer, Layer, Project } from '@/core/types';

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
  const tickRef = useRef(0);
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
    return () => {
      ro.disconnect();
      window.removeEventListener('ml:fit', onFit);
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

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(ui.panX, ui.panY);
      ctx.scale(ui.zoom, ui.zoom);

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
  const htmlLayers = project.layers.filter(
    (l): l is CodeLayer => l.type === 'code' && l.code.engine === 'html' && l.visible,
  );

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
      className="ml-grid relative flex-1 overflow-hidden bg-[#080b11]"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => void onPointerUp()}
      onPointerCancel={() => void onPointerUp()}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={canvasRef} className="absolute inset-0 block" />

      {/* HTML 代码层：编辑态用 sandbox iframe 实时渲染（导出时走 foreignObject 栅格化） */}
      {htmlLayers.map((layer) => {
        const t = makeTransform(layer);
        return (
          <iframe
            key={layer.id}
            title={layer.name}
            srcDoc={layer.code.source}
            sandbox="allow-scripts"
            className="pointer-events-none absolute border-0"
            style={{
              left: 0,
              top: 0,
              width: t.width,
              height: t.height,
              opacity: t.opacity,
              transform: `translate(${panX + t.left * zoom}px, ${panY + t.top * zoom}px) rotate(${t.rotation}deg) scale(${zoom})`,
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
            caretColor: '#9b83ff',
          }}
        />
      )}

      {selectedIds.length === 0 && !editingText && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900/90 px-3 py-1 text-[10.5px] text-zinc-500">
          <MousePointer2 size={11} /> 拖拽移动 · 双击编辑文本 · 空格拖拽平移 · Ctrl+滚轮缩放
        </div>
      )}
    </div>
  );
}
