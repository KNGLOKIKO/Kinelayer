import { useEffect } from 'react';
import { Activity, ScanEye, Sparkles } from 'lucide-react';
import { TopBar } from '@/ui/TopBar';
import { LeftPanel, LeftRail } from '@/ui/LeftPanels';
import { Stage } from '@/ui/Stage';
import { Timeline, TimelineToggle } from '@/ui/Timeline';
import { Inspector } from '@/ui/Inspector';
import { AIPanel } from '@/ui/AIPanel';
import { AuditPanel, StatusBar, Toasts } from '@/ui/Chrome';
import { CodeEditorDialog, ExportDialog, SettingsDialog } from '@/ui/Dialogs';
import { PromptDialog } from '@/ui/PromptDialog';
import { FloatingLayerPanels } from '@/ui/FloatingLayerPanels';
import { exec } from '@/core/commandBus';
import { setBroadcastHandler } from '@/core/commandBus';
import { updateUi, useEditor } from '@/core/store';
import { normalizeProject } from '@/core/defaults';
import { idbGetKV, idbSetKV } from '@/persist/idb';
import { restoreFonts } from '@/persist/fonts';
import { preloadAssets } from '@/render/assets';
import { initAI } from '@/ai/config';
import { connectBridge, subscribeBridgeSync } from '@/ai/bridgeClient';
import { getLayerWindowHost } from '@/windows/host';
import { ensureServices } from '@/app/services';
import { cx } from '@/ui/primitives';

import { t } from '@/i18n';
const TABS = [
  { id: 'inspect' as const, label: t('属性'), icon: ScanEye },
  { id: 'ai' as const, label: 'AI', icon: Sparkles },
  { id: 'audit' as const, label: t('审计'), icon: Activity },
];

function RightPanel() {
  const tab = useEditor((s) => s.ui.rightTab);
  return (
    <aside className="border-ink-700/80 bg-ink-850/60 flex w-[318px] shrink-0 flex-col border-l">
      <div className="border-ink-700/70 flex h-8 shrink-0 items-center gap-0.5 border-b px-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => updateUi((ui) => { ui.rightTab = t.id; })}
              className={cx(
                'flex h-6 items-center gap-1 rounded px-2 text-[11px] transition',
                tab === t.id ? 'bg-accent/20 text-accent-soft' : 'text-zinc-500 hover:bg-ink-800 hover:text-zinc-200',
              )}
            >
              <Icon size={11} />
              {t.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <span className="pr-1 text-[9px] text-zinc-700">v0.1</span>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'inspect' && <Inspector />}
        {tab === 'ai' && <AIPanel />}
        {tab === 'audit' && <AuditPanel />}
      </div>
    </aside>
  );
}

export function EditorApp() {
  /* ---------------------------------------------------------- bootstrap */
  useEffect(() => {
    ensureServices();
    const host = getLayerWindowHost();
    setBroadcastHandler(() => host.requestSnapshot());
    let disposed = false;

    const boot = async () => {
      await initAI();
      await restoreFonts().catch(() => []);
      const saved = await idbGetKV<unknown>('project.autosave');
      if (saved && !disposed) {
        const project = normalizeProject(saved);
        await exec('project.load', { data: JSON.stringify(project) });
        await preloadAssets(project.assets);
      }
      const token = localStorage.getItem('ml.bridge.token');
      const url = localStorage.getItem('ml.bridge.url');
      if (token && url && !disposed) connectBridge(url, token);
    };
    void boot();

    const unsubBridge = subscribeBridgeSync();
    return () => {
      disposed = true;
      unsubBridge();
    };
  }, []);

  /* -------------------------------------------------------- master clock */
  useEffect(() => {
    const host = getLayerWindowHost();
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(120, now - last);
      last = now;
      const state = useEditor.getState();
      if (!state.runtime.playing) return;
      let next = state.runtime.playhead + dt;
      if (next >= state.project.duration) {
        if (state.project.loop) {
          next = next % state.project.duration;
        } else {
          useEditor.setState({ runtime: { ...state.runtime, playhead: state.project.duration, playing: false } });
          host.broadcastTime(state.project.duration, false);
          return;
        }
      }
      useEditor.setState({ runtime: { ...state.runtime, playhead: next } });
      host.broadcastTime(next, true);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  /* ------------------------------------------------------------ autosave */
  useEffect(() => {
    let timer: number | null = null;
    let lastVersion = useEditor.getState().project.version;
    let lastProject = useEditor.getState().project;
    const unsub = useEditor.subscribe((s) => {
      if (s.project === lastProject) return;
      lastProject = s.project;
      if (s.project.version === lastVersion) return;
      lastVersion = s.project.version;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void idbSetKV('project.autosave', useEditor.getState().project);
      }, 1600);
    });
    return () => {
      unsub();
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  /* ----------------------------------------------------------- shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true ||
        target?.closest('.cm-editor') != null;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void exec(e.shiftKey ? 'history.redo' : 'history.undo', { steps: 1 });
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const ids = useEditor.getState().ui.selectedIds;
        if (ids.length) void exec('layer.duplicate', { ids });
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void exec('export.json', {});
        return;
      }
      if (typing) return;
      if (e.code === 'Space') {
        e.preventDefault();
        const playing = useEditor.getState().runtime.playing;
        void exec(playing ? 'timeline.pause' : 'timeline.play');
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        const ids = useEditor.getState().ui.selectedIds;
        if (ids.length) {
          e.preventDefault();
          void exec('layer.delete', { ids, force: false });
        }
        return;
      }
      if (e.key === 'Escape') {
        void exec('selection.clear', {});
        return;
      }
      if (e.shiftKey && e.key === '!') {
        window.dispatchEvent(new CustomEvent('ml:fit'));
        return;
      }
      if (e.key.startsWith('Arrow')) {
        const ids = useEditor.getState().ui.selectedIds;
        if (!ids.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const project = useEditor.getState().project;
        const commands: { type: string; payload: unknown }[] = [];
        for (const id of ids) {
          const layer = project.layers.find((l) => l.id === id);
          if (!layer || layer.type === 'background') continue;
          const patch: Record<string, number> = {};
          if (e.key === 'ArrowLeft') patch.x = layer.x - step;
          if (e.key === 'ArrowRight') patch.x = layer.x + step;
          if (e.key === 'ArrowUp') patch.y = layer.y - step;
          if (e.key === 'ArrowDown') patch.y = layer.y + step;
          commands.push({ type: 'layer.update', payload: { id, patch } });
        }
        if (commands.length) void exec('command.batch', { commands, atomic: true });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftRail />
        <LeftPanel />
        <main className="relative flex min-w-0 flex-1 flex-col">
          <Stage />
          <Timeline />
          <TimelineToggle />
        </main>
        <RightPanel />
      </div>
      <StatusBar />
      <SettingsDialog />
      <PromptDialog />
      <ExportDialog />
      <CodeEditorDialog />
      <FloatingLayerPanels />
      <Toasts />
    </div>
  );
}
