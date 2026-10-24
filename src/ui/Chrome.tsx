import { AlertTriangle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { dismissToast, useEditor } from '@/core/store';
import { Badge, cx } from './primitives';
import type { CommandSource } from '@/core/registry';

export function StatusBar() {
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.ui.selectedIds.length);
  const bridge = useEditor((s) => s.runtime.bridge);
  const progress = useEditor((s) => s.runtime.exportProgress);
  const windowMode = useEditor((s) => s.ui.windowMode);
  const audit = useEditor((s) => s.audit);
  const past = useEditor((s) => s.past.length);

  const errors = audit.filter((a) => !a.ok).length;

  return (
    <footer className="border-ink-700/80 bg-ink-900/95 flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[10px] text-zinc-500">
      <span className="flex items-center gap-1">
        <span
          className={cx(
            'h-1.5 w-1.5 rounded-full',
            bridge.state === 'connected' ? 'bg-emerald-400' : bridge.state === 'error' ? 'bg-rose-500' : 'bg-zinc-600',
          )}
        />
        {bridge.state === 'connected' ? `Agent 已连接 · ${bridge.agents} 个客户端` : bridge.message}
      </span>
      <span className="text-ink-700">|</span>
      <span>{project.layers.length} 图层</span>
      <span>选中 {selected}</span>
      <span>撤销栈 {past}</span>
      <span>v{project.version}</span>
      {errors > 0 && <span className="text-rose-400">{errors} 个失败命令</span>}
      <div className="flex-1" />
      {progress.active && (
        <span className="flex items-center gap-1 text-accent-soft">
          <Loader2 size={10} className="ml-spin" /> {progress.label}
        </span>
      )}
      <span>窗口：{windowMode === 'popup' ? '系统弹窗' : windowMode === 'pip' ? '画中画' : '应用内浮动'}</span>
      <span className="text-zinc-600">Command Bus · Host 权威</span>
    </footer>
  );
}

const SOURCE_TONE: Record<CommandSource, string> = {
  user: 'bg-accent/20 text-accent-soft',
  ai: 'bg-cyan/20 text-cyan',
  agent: 'bg-emerald-500/20 text-emerald-300',
  window: 'bg-amber-500/20 text-amber-300',
};

export function AuditPanel() {
  const audit = useEditor((s) => s.audit);
  return (
    <div className="flex h-full flex-col">
      <div className="border-ink-700/70 flex h-9 items-center gap-2 border-b px-2.5">
        <span className="text-[11px] font-semibold tracking-[0.08em] text-zinc-300 uppercase">审计日志</span>
        <Badge>{audit.length}</Badge>
        <span className="text-[9.5px] text-zinc-600">最近 200 条</span>
      </div>
      <div className="ml-scroll flex-1 overflow-y-auto">
        {audit.length === 0 && <div className="p-4 text-center text-[11px] text-zinc-600">还没有命令被执行。</div>}
        {[...audit].reverse().map((entry) => (
          <div key={`${entry.id}-${entry.ts}`} className="border-ink-700/50 flex items-start gap-1.5 border-b px-2.5 py-1.5">
            <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', entry.ok ? 'bg-emerald-400' : 'bg-rose-500')} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-mono text-[10.5px] text-zinc-300">{entry.type}</span>
                <span className={cx('rounded px-1 text-[9px]', SOURCE_TONE[entry.source])}>{entry.source}</span>
                <span className="ml-auto text-[9px] text-zinc-600">{entry.durationMs}ms</span>
              </div>
              <div className="text-[9.5px] text-zinc-600">
                v{entry.projectVersion} · {new Date(entry.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                {entry.error ? <span className="text-rose-400"> · {entry.error}</span> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useEditor((s) => s.runtime.toasts);
  return (
    <div className="pointer-events-none fixed right-3 bottom-9 z-[60] flex w-[320px] flex-col gap-1.5">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'animate-fadeIn pointer-events-auto flex items-start gap-1.5 rounded-md border px-2.5 py-2 text-[11px] shadow-panel backdrop-blur',
            t.kind === 'error'
              ? 'border-rose-500/40 bg-rose-950/80 text-rose-100'
              : t.kind === 'success'
                ? 'border-emerald-500/40 bg-emerald-950/80 text-emerald-100'
                : t.kind === 'warn'
                  ? 'border-amber-500/40 bg-amber-950/80 text-amber-100'
                  : 'border-ink-600 bg-ink-850/90 text-zinc-200',
          )}
        >
          {t.kind === 'error' ? (
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          ) : t.kind === 'success' ? (
            <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
          ) : (
            <Info size={12} className="mt-0.5 shrink-0" />
          )}
          <span className="flex-1 leading-snug">{t.text}</span>
          <button type="button" onClick={() => dismissToast(t.id)} className="opacity-60 hover:opacity-100">
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
