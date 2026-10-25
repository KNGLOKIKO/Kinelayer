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
import { Launcher } from '@/ui/Launcher';
import { PromptDialog } from '@/ui/PromptDialog';
import { FloatingLayerPanels } from '@/ui/FloatingLayerPanels';
import { exec } from '@/core/commandBus';
import { setBroadcastHandler } from '@/core/commandBus';
import { updateUi, useEditor } from '@/core/store';
import {
  ensureProjectRecorded,
  getLastProjectId,
  isDetached,
  maybeThumbnail,
  saveProject,
  setLastProjectId,
} from '@/persist/projects';
import { lsGet } from '@/persist/storage';
import { restoreFonts } from '@/persist/fonts';
import { initAI } from '@/ai/config';
import { connectBridge, subscribeBridgeSync } from '@/ai/bridgeClient';
import { getLayerWindowHost } from '@/windows/host';
import { ensureServices } from '@/app/services';
import { cx } from '@/ui/primitives';
import { useLayoutTier } from '@/ui/layout';

import { t } from '@/i18n';
// 同上：label 存中文原文，渲染时再 t()
const TABS = [
  { id: 'inspect' as const, label: '属性', icon: ScanEye },
  { id: 'ai' as const, label: 'AI', icon: Sparkles },
  { id: 'audit' as const, label: '审计', icon: Activity },
];

function RightPanel({ width = 318 }: { width?: number }) {
  const tab = useEditor((s) => s.ui.rightTab);
  return (
    <aside className="border-ink-700/80 bg-ink-850/60 flex shrink-0 flex-col border-l" style={{ width }}>
      <div className="border-ink-700/70 flex h-8 shrink-0 items-center gap-0.5 border-b px-1.5">
        {TABS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => updateUi((ui) => { ui.rightTab = item.id; })}
              className={cx(
                'flex h-6 items-center gap-1 rounded px-2 text-[11px] transition',
                tab === item.id ? 'bg-accent/20 text-accent-soft' : 'text-zinc-500 hover:bg-ink-800 hover:text-zinc-200',
              )}
            >
              <Icon size={11} />
              {t(item.label)}
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
  /* 响应式三档：只切外壳，舞台/总线无感 */
  const tier = useLayoutTier();
  const drawer = useEditor((s) => s.ui.narrowDrawer);
  const showTimeline = useEditor((s) => s.ui.showTimeline);
  const setDrawer = (next: 'left' | 'right' | null) =>
    updateUi((ui) => {
      ui.narrowDrawer = next;
    });
  /* ---------------------------------------------------------- bootstrap */
  useEffect(() => {
    ensureServices();
    const host = getLayerWindowHost();
    setBroadcastHandler(() => host.requestSnapshot());
    let disposed = false;

    const boot = async () => {
      await initAI();
      await restoreFonts().catch(() => []);
      /* 打开哪一份：URL 上的 projectId 优先（分享链接/多标签），其次是上次打开的工程。
         两者都没有 = 首次使用，把内存里的示例工程直接建档，启动页才有东西可列。 */
      const wanted = new URLSearchParams(window.location.search).get('projectId') || (await getLastProjectId());
      if (disposed) return;
      const opened = wanted ? await exec('project.open', { projectId: wanted }) : null;
      if (!opened || !opened.ok) {
        /* 记录被删了/索引被清过：不要卡在「正在打开」，就地建档继续用 */
        const current = useEditor.getState().project;
        await ensureProjectRecorded(current);
        await setLastProjectId(current.id);
      }
      if (new URLSearchParams(window.location.search).get('view') === 'launcher') {
        updateUi((ui) => {
          ui.showLauncher = true;
        });
      }
      const token = lsGet('bridge.token');
      const url = lsGet('bridge.url');
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

    const persist = async () => {
      const project = useEditor.getState().project;
      /* 当前这份刚被删掉：自动保存不许把它复活，否则「删除」等于没删 */
      if (isDetached(project.id)) return;
      try {
        const thumb = await maybeThumbnail(project);
        await saveProject(project, thumb);
        if ((await getLastProjectId()) !== project.id) await setLastProjectId(project.id);
      } catch (err) {
        console.warn('[Kinelayer] 自动保存失败：', err);
      }
    };

    const unsub = useEditor.subscribe((s) => {
      if (s.project === lastProject) return;
      lastProject = s.project;
      if (s.project.version === lastVersion) return;
      lastVersion = s.project.version;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void persist(), 1600);
    });
    return () => {
      unsub();
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  /* ----------------------------------------------------------- shortcuts */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* 启动页是覆盖层：它盖在编辑器上时，Delete/Backspace 不该穿透去删图层 */
      if (useEditor.getState().ui.showLauncher) return;
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
        void exec('project.exportBundle', {});
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        updateUi((ui) => {
          ui.showLauncher = true;
        });
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
    <div className="flex h-full flex-col overflow-hidden" data-tier={tier}>
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <LeftRail />
        {tier !== 'narrow' && <LeftPanel width={tier === 'mid' ? 232 : 268} />}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <Stage />
          <Timeline />
          <TimelineToggle />
        </main>
        {tier !== 'narrow' && <RightPanel width={tier === 'mid' ? 288 : 318} />}
      </div>

      {/* 窄屏：面板改成抽屉，同一时刻只开一个（覆盖层不挤压舞台） */}
      {tier === 'narrow' && (
        <>
          {drawer && (
            <div className="fixed inset-0 z-30 bg-black/45" onMouseDown={() => setDrawer(null)}>
              <div
                className={cx('absolute inset-y-0 flex shadow-pop', drawer === 'left' ? 'left-12' : 'right-0')}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {drawer === 'left' ? <LeftPanel width={288} /> : <RightPanel width={300} />}
              </div>
            </div>
          )}
          <div className="border-ink-700 bg-ink-900/95 shadow-pop fixed bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border px-1.5 py-1">
            <button
              type="button"
              onClick={() => setDrawer(drawer === 'left' ? null : 'left')}
              className={cx(
                'rounded-full px-2.5 py-1 text-[11px]',
                drawer === 'left' ? 'bg-accent/20 text-accent-soft' : 'text-zinc-400 hover:text-zinc-100',
              )}
            >
              {t('面板')}
            </button>
            <button
              type="button"
              onClick={() => updateUi((ui) => { ui.showTimeline = !ui.showTimeline; })}
              className="rounded-full px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-100"
            >
              {showTimeline ? t('收起时间轴') : t('时间轴')}
            </button>
            <button
              type="button"
              onClick={() => setDrawer(drawer === 'right' ? null : 'right')}
              className={cx(
                'rounded-full px-2.5 py-1 text-[11px]',
                drawer === 'right' ? 'bg-accent/20 text-accent-soft' : 'text-zinc-400 hover:text-zinc-100',
              )}
            >
              {t('检查器')}
            </button>
          </div>
        </>
      )}

      <StatusBar />
      <Launcher />
      <SettingsDialog />
      <PromptDialog />
      <ExportDialog />
      <CodeEditorDialog />
      <FloatingLayerPanels />
      <Toasts />
    </div>
  );
}
