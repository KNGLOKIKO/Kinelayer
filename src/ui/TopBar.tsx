
import {
  Download,
  Layers,
  Maximize2,
  Pause,
  Play,
  Redo2,
  Plug,
  Settings,
  SkipBack,
  Sparkles,
  Undo2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { updateUi, useEditor } from '@/core/store';
import { exec } from '@/core/commandBus';
import { IconButton, TextInput, cx } from './primitives';
import { applyLocale } from '@/i18n/apply';

import { t } from '@/i18n';
function fmt(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function TopBar() {
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.runtime.playing);
  const playhead = useEditor((s) => s.runtime.playhead);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const rightTab = useEditor((s) => s.ui.rightTab);
  const bridge = useEditor((s) => s.runtime.bridge);
  const zoom = useEditor((s) => s.ui.zoom);
  const locale = useEditor((s) => s.ui.locale);

  return (
    <header className="border-ink-700/80 bg-ink-900/95 relative z-30 flex h-12 shrink-0 items-center gap-3 border-b px-3">
      <div className="flex items-center gap-2.5">
        <div className="from-accent to-cyan flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br shadow-[0_0_18px_rgba(124,92,255,.35)]">
          <Layers size={15} className="text-white" strokeWidth={2.4} />
        </div>
        <div className="leading-none">
          <div className="text-[12.5px] font-semibold tracking-tight text-zinc-100">Kinelayer</div>
          <div className="mt-0.5 text-[9.5px] tracking-[0.18em] text-zinc-600">{t('动态海报工作台')}</div>
        </div>
      </div>

      <div className="bg-ink-700 h-5 w-px" />

      <TextInput
        value={project.name}
        onCommit={(v) => {
          if (v.trim()) void exec('project.rename', { name: v.trim() });
        }}
        className="h-7 max-w-[260px] border-transparent bg-transparent px-1.5 text-[12.5px] font-medium hover:border-ink-700"
      />
      <span className="text-[10.5px] text-zinc-600">
        {project.width}×{project.height} · v{project.version}
      </span>

      <div className="flex-1" />

      <div className="flex items-center gap-0.5">
        <IconButton title={t('撤销 (Ctrl+Z)')} onClick={() => void exec('history.undo', { steps: 1 })} disabled={!canUndo}>
          <Undo2 size={15} />
        </IconButton>
        <IconButton title={t('重做 (Ctrl+Shift+Z)')} onClick={() => void exec('history.redo', { steps: 1 })} disabled={!canRedo}>
          <Redo2 size={15} />
        </IconButton>
      </div>

      <div className="bg-ink-700 h-5 w-px" />

      <div className="flex items-center gap-1">
        <IconButton title={t('回到开头')} onClick={() => void exec('timeline.seek', { time: 0 })}>
          <SkipBack size={14} />
        </IconButton>
        <IconButton
          title={t('播放 / 暂停 (Space)')}
          active={playing}
          onClick={() => void exec(playing ? 'timeline.pause' : 'timeline.play')}
          className={playing ? 'bg-accent/20 text-accent-soft' : undefined}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </IconButton>
        <div className="ml-1 font-mono text-[11px] tabular-nums text-zinc-400">
          {fmt(playhead)} <span className="text-zinc-600">/ {fmt(project.duration)}</span>
        </div>
      </div>

      <div className="bg-ink-700 h-5 w-px" />

      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('ml:fit'))}
        className="hover:text-ink-100 flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-zinc-400"
        title={t('适应窗口 (Shift+1)')}
      >
        <Maximize2 size={12} />
        {Math.round(zoom * 100)}%
      </button>

      <div className="flex items-center gap-1.5 rounded-md border border-ink-700 px-2 py-1" title={bridge.message}>
        {bridge.state === 'connected' ? (
          <Wifi size={12} className="text-emerald-400" />
        ) : (
          <WifiOff size={12} className="text-zinc-600" />
        )}
        <span className="text-[10px] text-zinc-500">Agent</span>
      </div>

      <button
        type="button"
        title={t('界面语言')}
        onClick={() => applyLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
        className="bg-ink-750 hover:bg-ink-700 flex h-7 items-center rounded-md px-2 text-[11px] font-medium text-zinc-300"
      >
        {locale === 'zh-CN' ? '中' : 'EN'}
      </button>

      <button
        type="button"
        title={t('AI 接入提示词（复制给任意模型 / MCP 客户端）')}
        onClick={() => updateUi((u) => { u.showPrompt = true; })}
        className="bg-ink-750 hover:bg-ink-700 flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-zinc-300"
      >
        <Plug size={13} />
        {t('接入')}
      </button>

      <button
        type="button"
        onClick={() => {
          updateUi((u) => {
            u.rightTab = u.rightTab === 'ai' ? 'inspect' : 'ai';
          });
        }}
        className={cx(
          'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition',
          rightTab === 'ai' ? 'bg-accent text-white' : 'bg-ink-750 text-zinc-300 hover:bg-ink-700',
        )}
      >
        <Sparkles size={13} />
        AI
      </button>

      <button
        type="button"
        onClick={() => {
          updateUi((u) => {
            u.showExport = true;
          });
        }}
        className="bg-ink-750 hover:bg-ink-700 flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-zinc-200"
      >
        <Download size={13} />
        {t('导出')}
      </button>

      <IconButton
        title={t('设置')}
        onClick={() =>
          updateUi((u) => {
            u.showSettings = true;
          })
        }
      >
        <Settings size={15} />
      </IconButton>
    </header>
  );
}
