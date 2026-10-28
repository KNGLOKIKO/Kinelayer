import { useEffect, useState } from 'react';
import { Activity, ScanEye, Sparkles } from 'lucide-react';
import { TopBar } from '@/ui/TopBar';
import { LeftPanel, LeftRail } from '@/ui/LeftPanels';
import { Stage } from '@/ui/Stage';
import { Timeline, TimelineToggle } from '@/ui/Timeline';
import { Inspector } from '@/ui/Inspector';
import { AIPanel } from '@/ui/AIPanel';
import { AuditPanel, StatusBar, Toasts } from '@/ui/Chrome';
import { ImportReportDialog } from '@/ui/ImportReportDialog';
import { CodeEditorDialog, ExportDialog, SettingsDialog } from '@/ui/Dialogs';
import { CustomCommandEditor, CustomRunDialog } from '@/ui/CustomCommands';
import { Launcher } from '@/ui/Launcher';
import { editorUrl, go, launcherUrl, replaceUrl } from '@/ui/routes';
import { PromptDialog } from '@/ui/PromptDialog';
import { FloatingLayerPanels } from '@/ui/FloatingLayerPanels';
import { exec } from '@/core/commandBus';
import { setBroadcastHandler } from '@/core/commandBus';
import { pushToast, updateRuntime, updateUi, useEditor } from '@/core/store';
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
import { resetAudio, syncProjectAudio } from '@/render/audioEngine';
import { ensureServices } from '@/app/services';
import { getServices } from '@/core/services';
import { clamp } from '@/core/geometry';
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
  const customEditorFor = useEditor((s) => s.ui.customEditorFor);
  const customRunFor = useEditor((s) => s.ui.customRunFor);
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
      /* 自定义命令是全局的（不属于任何工程），跟字体一样在启动时读一次。
         读失败不该拦住编辑器启动 —— 只是面板空着，用户还能新建。 */
      await getServices()
        .listCustomCommands()
        .then((rows) => {
          if (disposed) return;
          updateRuntime((rt) => {
            rt.customCommands = [...rows].sort((a, b) => b.updatedAt - a.updatedAt);
            rt.customCommandsLoaded = true;
          });
        })
        .catch(() => updateRuntime((rt) => { rt.customCommandsLoaded = true; }));
      /* 打开哪一份：URL 上的 projectId 优先（分享链接/多标签），其次是上次打开的工程。
         两者都没有 = 直接敲了 ?view=editor，没东西可开 —— 回启动页选一个，
         不要凭空造一份示例工程（那会让「工程库」里凭空多出一条记录）。 */
      const fromUrl = new URLSearchParams(window.location.search).get('projectId');
      /* view 必须在改写 URL 之前读：下面 replaceUrl 会把 view=launcher 换成 view=editor，
         之后再读就永远进不了「编辑器 + 工程库覆盖层」这条分支。 */
      const viewParam = new URLSearchParams(window.location.search).get('view');
      const wanted = fromUrl || (await getLastProjectId());
      if (disposed) return;
      if (!wanted) {
        go(launcherUrl());
        return;
      }
      const opened = await exec('project.open', { projectId: wanted });
      if (!opened || !opened.ok) {
        /* 记录被删了/索引被清过：不要卡在「正在打开」。没有可回退的工程就回启动页。 */
        if (!fromUrl) {
          go(launcherUrl());
          return;
        }
        const current = useEditor.getState().project;
        await ensureProjectRecorded(current);
        await setLastProjectId(current.id);
      }
      /* 把 projectId 补进地址栏：刷新才停在编辑器，而不是掉回启动页 */
      if (!fromUrl) {
        const id = useEditor.getState().project.id;
        if (id) replaceUrl(editorUrl(id));
      }
      if (viewParam === 'launcher') {
        updateUi((ui) => {
          ui.showLauncher = true;
        });
      }
      const token = lsGet('bridge.token');
      const url = lsGet('bridge.url');
      if (token && url && !disposed) connectBridge(url, token);
      /* 放到最后：前面任何一次换文档都不该触发 URL 同步 */
      if (!disposed) setBooted(true);
    };
    void boot();

    const unsubBridge = subscribeBridgeSync();
    return () => {
      disposed = true;
      unsubBridge();
    };
  }, []);

  /* -------------------------------------------------- URL ↔ 当前工程同步 */
  /**
   * 打开/新建/导入都会换掉当前工程，但地址栏还留着上一个 projectId。
   * 不清掉的话，刷新时 boot 会「URL 优先」把旧工程又开回来 —— 用户会以为自己的切换丢了。
   *
   * 必须等 boot 结束再开始同步：首帧那会儿 store 里还是内存里的示例工程，
   * 这会儿要是抢先改写 URL，boot 待会儿读到的 projectId 就被换掉了（URL 优先的语义直接失效）。
   */
  const [booted, setBooted] = useState(false);
  const liveProjectId = useEditor((s) => s.project.id);
  useEffect(() => {
    if (!booted || !liveProjectId) return;
    const current = new URLSearchParams(window.location.search).get('projectId');
    if (current === liveProjectId) return;
    replaceUrl(editorUrl(liveProjectId));
  }, [booted, liveProjectId]);

  /* 切工程 / 离开编辑器时收声：音频是全局单例，不清会跟着下一个工程继续响 */
  useEffect(() => () => resetAudio(), [liveProjectId]);

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
      if (!state.runtime.playing) {
        /*
         * 每帧都调一次是故意的：sync 自己会判「有没有在响」，没在响就是一次空返回。
         * 把「停」这件事交给主时钟而不是每个暂停入口，是为了不漏 —— 空格、时间轴、
         * 顶部按钮、命令层有四个地方能停，谁忘了调 audio.stop 都会变成「画面停了声音还在」。
         */
        syncProjectAudio(state.project, state.runtime.playhead, false);
        return;
      }
      const rate = state.runtime.playRate || 1;
      /*
       * 播放窗口：有出片区间就按区间走，否则整条时间轴。
       *
       * 为什么让播放**停在出点**而不是继续往下播：区间是「这次要出哪一段」的权威，
       * 预览它才有意义。播过出点继续走，用户会以为那部分也会进成片。
       * 想通看全片：清除区间（工具条上的 ✕）或直接拖播放头。
       */
      const range = state.project.range;
      const winIn = range ? Math.max(0, Math.min(range.in, state.project.duration)) : 0;
      const winOut = range ? Math.max(winIn + 1, Math.min(range.out, state.project.duration)) : state.project.duration;
      let next = state.runtime.playhead + dt * rate;
      /* 倒放没有声音：音频图不能倒着跑。画面倒着看是剪辑里的常规操作，
         硬要给声音就会变成「刺啦一声」，不如安静。 */
      const audible = rate > 0;
      if (rate > 0 && next >= winOut) {
        if (state.project.loop) {
          next = winIn + ((next - winIn) % (winOut - winIn));
        } else {
          useEditor.setState({ runtime: { ...state.runtime, playhead: winOut, playing: false, playRate: 1 } });
          host.broadcastTime(winOut, false);
          syncProjectAudio(state.project, winOut, false);
          return;
        }
      } else if (rate < 0 && next <= winIn) {
        if (state.project.loop) {
          next = winOut - ((winIn - next) % (winOut - winIn));
        } else {
          useEditor.setState({ runtime: { ...state.runtime, playhead: winIn, playing: false, playRate: 1 } });
          host.broadcastTime(winIn, false);
          syncProjectAudio(state.project, winIn, false);
          return;
        }
      }
      useEditor.setState({ runtime: { ...state.runtime, playhead: next } });
      host.broadcastTime(next, true);
      /* 声音跟着同一根时间轴走；seek / 循环回绕由它自己重锚 */
      syncProjectAudio(state.project, next, audible);
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

      /* ---------------------------------------------------- 走带与入出点
       *
       * J/K/L 是所有剪辑软件共同的手势，不用解释：
       *   K 停，L 正放（连按加速度：1→2→4→8），J 倒放（同样连按加速）。
       * 这里只推播放头与倍速，声音在倒放时自动静音（见主时钟里的 audible）。
       *
       * I/O 打入出点、,/。 逐帧、M 打标记、Home/End 跳首尾 —— 都是「手不离键盘」的动作。
       * 全部走命令层，所以 AI 与宏拿到的语义和用户按键完全一致。
       */
      const { project: pj, runtime: rt } = useEditor.getState();
      if (e.key === 'k' && !mod) {
        e.preventDefault();
        void exec('timeline.pause', {});
        updateRuntime((r) => {
          r.playRate = 1;
        });
        return;
      }
      if ((e.key === 'l' || e.key === 'j') && !mod) {
        e.preventDefault();
        const dir = e.key === 'l' ? 1 : -1;
        /* 连按同向加速；换向或从停住开始，从 1 倍起 */
        const same = rt.playing && Math.sign(rt.playRate) === dir;
        const speed = same ? Math.min(8, Math.abs(rt.playRate) * 2) : 1;
        updateRuntime((r) => {
          r.playing = true;
          r.playRate = dir * speed;
        });
        return;
      }
      if ((e.key === 'i' || e.key === 'o') && !mod) {
        e.preventDefault();
        void exec(e.key === 'i' ? 'timeline.markIn' : 'timeline.markOut', { time: Math.round(rt.playhead) }).then((res) => {
          if (!res.ok) pushToast('warn', res.error?.message ?? t('设不了入出点'));
        });
        return;
      }
      if (e.key === ',' || e.key === '.') {
        e.preventDefault();
        const step = 1000 / Math.max(1, Math.round(pj.fps));
        const frame = Math.round(rt.playhead / step) + (e.key === '.' ? 1 : -1);
        void exec('timeline.seek', { time: clamp(Math.round(frame * step), 0, pj.duration) });
        return;
      }
      if (e.key === 'm' && !mod) {
        e.preventDefault();
        void exec('timeline.addMarker', { time: Math.round(rt.playhead) });
        return;
      }
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        void exec('timeline.seek', { time: e.key === 'Home' ? 0 : pj.duration });
        return;
      }
      if (e.key === 's' && !mod) {
        /* 剪一刀：把选中的片段在播放头处切开。这是剪辑里最高频的动作，
           所以给一个单键；冲突过的 Ctrl+S 是保存工程，前面已经 return 掉了。 */
        const ids = useEditor.getState().ui.selectedIds;
        const at = Math.round(useEditor.getState().runtime.playhead);
        if (ids.length === 1) {
          e.preventDefault();
          void exec('layer.split', { id: ids[0], at });
        }
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
      <ImportReportDialog />
      <CodeEditorDialog />
      {customEditorFor && <CustomCommandEditor key={customEditorFor} />}
      {customRunFor && <CustomRunDialog key={customRunFor} />}
      <FloatingLayerPanels />
      <Toasts />
    </div>
  );
}
