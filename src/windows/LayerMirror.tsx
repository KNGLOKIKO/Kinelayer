import { useEffect, useRef, useState } from 'react';
import { Code2, Image as ImageIcon, Layers, Square, Type, Video } from 'lucide-react';
import type { CommandResult } from '@/core/registry';
import type { Layer, Project } from '@/core/types';
import { computeLayerFrame } from '@/render/animation';
import { renderScene } from '@/render/renderScene';
import { Badge, NumberInput, Slider, TextInput, cx } from '@/ui/primitives';

const TYPE_LABEL: Record<string, string> = {
  text: '文本层',
  image: '图片层',
  video: '视频层',
  code: '代码层',
  background: '背景层',
};

function TypeIcon({ type }: { type: string }) {
  if (type === 'text') return <Type size={12} />;
  if (type === 'image') return <ImageIcon size={12} />;
  if (type === 'video') return <Video size={12} />;
  if (type === 'code') return <Code2 size={12} />;
  return <Square size={12} />;
}

export function LayerMirror({
  layerId,
  project,
  time,
  status,
  onCommand,
  compact,
}: {
  layerId: string;
  project: Project;
  time: number;
  status: 'connecting' | 'connected' | 'disconnected';
  onCommand: (type: string, payload: unknown) => Promise<CommandResult>;
  compact?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const layer = project.layers.find((l) => l.id === layerId) ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !layer) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pad = 16;
    const zoom = Math.min((rect.width - pad * 2) / layer.width, (rect.height - pad * 2) / layer.height, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.translate(rect.width / 2, rect.height / 2);
    ctx.scale(zoom, zoom);
    const index = project.layers.indexOf(layer);
    const frame = computeLayerFrame(layer, index, time, project.duration);
    ctx.translate(-(layer.width / 2), -(layer.height / 2));
    // 以图层本地坐标渲染：把图层临时移到 0,0，避免画布偏移
    const shifted: Project = {
      ...project,
      layers: project.layers.map((l) =>
        l.id === layer.id ? ({ ...l, x: 0, y: 0, rotation: frame.rotation, opacity: frame.opacity } as Layer) : l,
      ),
    };
    renderScene(ctx, shifted, {
      time,
      scale: Math.max(0.5, zoom * dpr),
      transparent: true,
      onlyLayerId: layer.id,
    });
    // 边框
    ctx.strokeStyle = 'rgba(124,92,255,.45)';
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(0, 0, layer.width, layer.height);
  }, [project, layer, time]);

  if (!layer) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[11.5px] text-zinc-500">
        图层已被删除，或该项目已关闭。
      </div>
    );
  }

  const commit = async (type: string, payload: unknown) => {
    const res = await onCommand(type, payload);
    setError(res.ok ? null : (res.error?.message ?? '执行失败'));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0d13]">
      <div className="border-ink-700/70 flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-accent-soft">
          <TypeIcon type={layer.type} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-zinc-200">{layer.name}</span>
        <Badge tone="neutral">{TYPE_LABEL[layer.type] ?? layer.type}</Badge>
        <span
          className={cx(
            'h-1.5 w-1.5 rounded-full',
            status === 'connected' ? 'bg-emerald-400' : status === 'connecting' ? 'bg-amber-400 animate-pulseSoft' : 'bg-rose-500',
          )}
          title={status}
        />
      </div>

      <div ref={wrapRef} className="ml-canvas-checker relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0 block" />
        <div className="pointer-events-none absolute bottom-1.5 left-0 w-full text-center text-[9.5px] text-zinc-600">
          只读镜像 · 主窗口渲染
        </div>
      </div>

      {!compact && (
        <div className="border-ink-700/70 max-h-[46%] shrink-0 space-y-2 overflow-y-auto border-t p-2.5">
          <div className="grid grid-cols-2 gap-1.5">
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-zinc-500">X</span>
              <NumberInput value={layer.x} onCommit={(x) => void commit('layer.update', { id: layer.id, patch: { x } })} suffix="px" />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-zinc-500">Y</span>
              <NumberInput value={layer.y} onCommit={(y) => void commit('layer.update', { id: layer.id, patch: { y } })} suffix="px" />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-zinc-500">宽</span>
              <NumberInput value={layer.width} onCommit={(width) => void commit('layer.update', { id: layer.id, patch: { width } })} suffix="px" />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-zinc-500">高</span>
              <NumberInput value={layer.height} onCommit={(height) => void commit('layer.update', { id: layer.id, patch: { height } })} suffix="px" />
            </label>
          </div>
          <Slider
            label="不透明度"
            value={layer.opacity}
            min={0}
            max={1}
            step={0.01}
            onChange={(opacity) => void commit('layer.update', { id: layer.id, patch: { opacity } })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          {layer.type === 'text' && (
            <label className="block">
              <span className="mb-0.5 block text-[10px] text-zinc-500">文本内容</span>
              <TextInput
                value={layer.text}
                onCommit={(text) => void commit('text.setContent', { id: layer.id, text })}
                className="h-7"
              />
            </label>
          )}
          {layer.type === 'code' && (
            <div className="rounded border border-ink-700 bg-ink-900/60 p-1.5 text-[10px] text-zinc-500">
              代码层请在主窗口的代码编辑器中修改 · {layer.code.engine}
            </div>
          )}
          {error && <div className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-300">{error}</div>}
          <div className="flex items-center gap-1 text-[9.5px] text-zinc-600">
            <Layers size={10} /> {Math.round(time)}ms · 命令由主窗口执行
          </div>
        </div>
      )}
    </div>
  );
}
