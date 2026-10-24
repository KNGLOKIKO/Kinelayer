import { useRef, useState } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import { exec } from '@/core/commandBus';
import { useEditor } from '@/core/store';
import { LayerMirror } from '@/windows/LayerMirror';
import { IconButton } from './primitives';

/** 降级链的最后一环：popup / PiP 都不可用时，在主窗口内浮动显示只读镜像 */
export function FloatingLayerPanels() {
  const floating = useEditor((s) => s.ui.floatingWindows);
  const project = useEditor((s) => s.project);
  const playhead = useEditor((s) => s.runtime.playhead);

  return (
    <>
      {floating.map((layerId, index) => (
        <FloatingCard key={layerId} layerId={layerId} index={index} project={project} time={playhead} />
      ))}
    </>
  );
}

function FloatingCard({
  layerId,
  index,
  project,
  time,
}: {
  layerId: string;
  index: number;
  project: ReturnType<typeof useEditor.getState>['project'];
  time: number;
}) {
  // 默认放在右侧属性面板左边，别一上来就盖住检查器；卡片本身可拖拽
  const [pos, setPos] = useState(() => {
    const cardW = 360;
    const inspectorW = 352;
    return {
      x: Math.max(16, window.innerWidth - cardW - inspectorW - 16 - index * 24),
      y: 96 + index * 24,
    };
  });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  return (
    <div
      className="border-ink-600 bg-ink-850 animate-fadeIn fixed z-40 flex h-[460px] w-[360px] flex-col overflow-hidden rounded-lg border shadow-pop"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="border-ink-700 flex h-7 shrink-0 cursor-move items-center gap-1 border-b px-2 text-[10px] text-zinc-500"
        onPointerDown={(e) => {
          dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          const maxX = window.innerWidth - 120;
          setPos({
            x: Math.min(maxX, Math.max(0, e.clientX - dragRef.current.dx)),
            y: Math.min(window.innerHeight - 60, Math.max(0, e.clientY - dragRef.current.dy)),
          });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
      >
        <GripHorizontal size={11} />
        <span className="flex-1">应用内浮动窗口</span>
        <IconButton size={18} onClick={() => void exec('window.closeLayer', { layerId })}>
          <X size={11} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">
        <LayerMirror
          layerId={layerId}
          project={project}
          time={time}
          status="connected"
          compact
          onCommand={(type, payload) => exec(type, payload)}
        />
      </div>
    </div>
  );
}
