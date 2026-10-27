/**
 * 启动页 / 工程库。
 *
 * 两种形态，同一份实现：
 *   · mode="page"    独立视图（`/`），不是 Host：只读索引、发命令，然后 location 跳进编辑器。
 *   · mode="overlay" 编辑器里按 Ctrl+O 打开，就地切换文档，不走导航（省一次整页重载）。
 *
 * 它**从不**渲染编辑器 —— 那样会出现两个 Host（主时钟、撤销栈各一份），是这套架构里最贵的 bug。
 *
 * 所有写操作都回命令总线：新建 = project.create，重命名 = project.rename，
 * 删除 = project.deleteLocal（必须 confirm），导出 = project.exportBundle。
 * 这里不碰 IndexedDB，也不改 store 里的 project（page 模式下只多写一个 lastProjectId 偏好）。
 */

import { useCallback, useEffect, useState } from 'react';
import { Download, FolderOpen, Image as ImageIcon, Languages, Pencil, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { exec } from '@/core/commandBus';
import { pushToast, updateUi, useEditor } from '@/core/store';
import { IMPORT_ACCEPT } from '@/core/bundle';
import type { ProjectMeta } from '@/persist/projects';
import { setLastProjectId } from '@/persist/projects';
import { cx } from './primitives';
import { pickImportFile } from './importFlow';
import { NewProjectDialog, SIZE_PRESETS, type NewProjectValues } from './NewProjectDialog';
import { editorUrl, go } from './routes';
import { IntroDemo } from './IntroDemo';
import { SAMPLE_PROJECT_ID } from '@/core/sampleProject';
import { applyLocale } from '@/i18n/apply';
import { t } from '@/i18n';

interface SeedInfo {
  created: boolean;
  /** created / upgraded / modified / removed / open / seeded / dryRun —— 决定引导条说哪句话 */
  reason?: string;
  projectId?: string;
  name?: string;
  layers?: number;
  tracks?: number;
  codeLayers?: number;
  audioLayers?: number;
  seconds?: number;
  version?: number;
}

/** 最近项目最多列这么多：再多就成资料库了，这个页面只管「接着上次干」 */
const RECENT_LIMIT = 12;

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtLen(ms: number): string {
  const s = ms / 1000;
  return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
}

export function Launcher({ mode = 'overlay' }: { mode?: 'overlay' | 'page' }) {
  const overlayOpen = useEditor((s) => s.ui.showLauncher);
  const open = mode === 'page' || overlayOpen;
  const currentId = useEditor((s) => s.project.id);
  const currentName = useEditor((s) => s.project.name);
  const locale = useEditor((s) => s.ui.locale);

  const [list, setList] = useState<ProjectMeta[] | null>(null);
  /**
   * 本次会话「刚塞进去的那份示例」。只在真的创建成功时非空 ——
   * 刷新页面之后引导条就不该再出现，它是一次性的开场白，不是常驻横幅。
   */
  const [seed, setSeed] = useState<SeedInfo | null>(null);
  /**
   * 「库里的示例变了」这类消息：旧版被原地换新（upgraded），
   * 或者有新版但用户改过所以没覆盖（modified）。和首塞的引导条分开，
   * 因为它不是开场白 —— 它要说明「你原来那份现在怎么了」。
   */
  const [notice, setNotice] = useState<SeedInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [dialog, setDialog] = useState<Partial<NewProjectValues> | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(async () => {
    /*
     * 先塞示例再列工程。这个命令按版本幂等：同一版本塞过就是一次 prefs 读返回，
     * 所以两个形态（page / overlay）每次打开都可以无脑调，不需要额外的「是不是首次」判断。
     * 但它也可能带回来「旧版被换新了」或「有新版但没动你的」—— 这两种都得让人看见，
     * 否则库里的东西悄悄变了（或者一直没变）都不知道为什么。
     */
    const seeded = await exec<SeedInfo>('project.seedSample', {});
    if (seeded.ok && seeded.data) {
      const d = seeded.data;
      if (d.created) setSeed(d);
      else if (d.reason === 'upgraded' || d.reason === 'modified') setNotice(d);
    }

    const res = await exec<{ projects: ProjectMeta[] }>('project.listRecent', { limit: RECENT_LIMIT });
    if (res.ok && res.data) setList(res.data.projects.slice(0, RECENT_LIMIT));
    else setList([]);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, nonce, refresh]);

  const close = useCallback(() => updateUi((ui) => { ui.showLauncher = false; }), []);

  /* Esc 关闭：覆盖层不该把编辑器困住（page 形态没有「返回」，忽略） */
  useEffect(() => {
    if (!open || mode === 'page') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editing && !dialog) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editing, dialog, close, mode]);

  if (!open) return null;

  const wrap = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      setNonce((n) => n + 1);
    }
  };

  /** 进编辑器：page 走导航（Launcher 不是 Host），overlay 就地切换 */
  const enter = (projectId: string) => {
    if (mode === 'page') {
      go(editorUrl(projectId));
      return;
    }
    close();
  };

  const create = (values: NewProjectValues) =>
    wrap(async () => {
      const res = await exec<{ projectId: string; name: string }>('project.create', {
        name: values.name,
        width: values.width,
        height: values.height,
        duration: values.duration,
        fps: values.fps,
        background: values.background,
      });
      if (!res.ok || !res.data) {
        pushToast('error', res.error?.message ?? t('创建失败'), 6000);
        return;
      }
      setDialog(null);
      enter(res.data.projectId);
    });

  const quickCreate = (width: number, height: number, name?: string) =>
    create({
      name: name ?? t('未命名织层项目'),
      width,
      height,
      duration: 5000,
      fps: 30,
      background: '#ffffff',
    });

  const openProject = (id: string) =>
    wrap(async () => {
      if (mode === 'page') {
        /* page 形态没有 Host 可切：只记偏好再跳转，让编辑器自己去开 */
        await setLastProjectId(id);
        go(editorUrl(id));
        return;
      }
      const res = await exec('project.open', { projectId: id });
      if (res.ok) close();
    });

  const commitRename = (id: string) =>
    wrap(async () => {
      const name = draftName.trim();
      setEditing(null);
      if (!name) return;
      await exec('project.rename', { projectId: id, name });
    });

  const remove = (meta: ProjectMeta) =>
    wrap(async () => {
      const question =
        meta.id === currentId
          ? t('删除「{name}」？它是当前打开的工程：删除后编辑器里还开着，但不再保存。', { name: meta.name })
          : t('删除「{name}」？本机记录与它独占的图片/视频会一起清掉。', { name: meta.name });
      if (!window.confirm(question)) return;
      const res = await exec<{ wasCurrent: boolean; removedAssets: number }>('project.deleteLocal', {
        projectId: meta.id,
        confirm: true,
      });
      if (res.ok) {
        pushToast('success', t('已删除「{name}」· 清理 {n} 个资源', { name: meta.name, n: res.data?.removedAssets ?? 0 }));
      }
    });

  /* 有新版但那份被改过：只在用户点名要换时才覆盖 —— 这一下会丢掉他的改动，先问一句 */
  const replaceSample = () =>
    wrap(async () => {
      if (!window.confirm(t('换成新版示例？你在这份示例上做过的改动会丢掉。'))) return;
      const res = await exec<SeedInfo>('project.seedSample', { force: true });
      if (!res.ok) {
        pushToast('error', res.error?.message ?? t('放入失败'), 6000);
        return;
      }
      setNotice(null);
      pushToast('success', t('示例已换成新版'));
    });

  /* 用户把示例删了之后，得有一条路放回来 —— 不然「示例」就成了一辈子只有一次的东西 */
  const restoreSample = () =>
    wrap(async () => {
      const res = await exec<SeedInfo>('project.seedSample', { force: true });
      if (!res.ok) {
        pushToast('error', res.error?.message ?? t('放入失败'), 6000);
        return;
      }
      if (res.data?.created) setSeed(res.data);
      pushToast('success', t('示例已放回工程库'));
    });

  const exportBundle = (id: string) =>
    wrap(async () => {
      const res = await exec<{ filename: string }>('project.exportBundle', { projectId: id });
      if (!res.ok) pushToast('error', res.error?.message ?? t('导出失败'));
      else pushToast('success', t('已导出 {name}', { name: res.data?.filename ?? '' }));
    });

  /* 导入走「预检 → 报告 → 确认」三步，落库与跳转都在 importFlow 里统一处理 */
  const importFile = () => pickImportFile(IMPORT_ACCEPT);

  const recent = list ?? [];
  const shown = recent.slice(0, RECENT_LIMIT);

  return (
    <div
      className={cx('flex flex-col', mode === 'page' ? 'bg-ink-950 h-full' : 'bg-ink-950/95 fixed inset-0 z-40 backdrop-blur-sm')}
      data-testid="launcher"
      data-mode={mode}
    >
      <header className="border-ink-700/80 flex h-14 shrink-0 items-center gap-3 border-b px-5">
        <div className="from-accent to-cyan bg-ink-750 flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br">
          <FolderOpen size={15} className="text-white" />
        </div>
        <div className="leading-none">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[13px] font-semibold tracking-tight text-zinc-100">Kinelayer</span>
            <span className="text-[10px] tracking-[0.2em] text-zinc-500">{t('织层')}</span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-600">{t('工程库 · 最近打开的工程都在这里')}</div>
        </div>

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => applyLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
          title={t('切换语言')}
          className="border-ink-700 text-zinc-400 hover:border-ink-600 hover:text-zinc-100 flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] transition"
        >
          <Languages size={12} />
          {locale === 'zh-CN' ? 'EN' : '中文'}
        </button>
        {mode === 'overlay' && (
          <button
            type="button"
            onClick={close}
            title={t('回到编辑器 (Esc)')}
            className="text-zinc-500 transition hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        )}
      </header>

      <div className="ml-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {/* 介绍页的示例动画：只在独立启动页出现（覆盖层形态下面板已经够挤了） */}
        {mode === 'page' && (
          <section
            data-testid="intro-hero"
            className="border-ink-700/70 bg-ink-900/50 mb-4 rounded-xl border p-4 md:flex md:items-center md:gap-6"
          >
            <div className="min-w-0 flex-1">
              {/*
                这里的数字必须和右边那支动画对得上（四拍），不能写「三十秒」——
                同屏的示例卡片会显示「01:36」，两个时长挨在一起会让人以为是同一个东西。
              */}
              <div className="text-accent-soft text-[10px] font-medium tracking-[0.18em]">{t('第一次来 · 四步看完')}</div>
              <h1 className="mt-1.5 text-[17px] font-semibold tracking-tight text-zinc-100">{t('可编程的动态海报工作台')}</h1>
              <p className="mt-1.5 max-w-[460px] text-[11.5px] leading-relaxed text-zinc-500">
                {t('图层、关键帧、代码层和导出走同一条命令总线 —— 你在这里点的每一步，AI 都能用一条命令重放。')}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {['一条命令总线', '关键帧 · 图层窗口同源', 'PNG / WebM / JSON'].map((chip) => (
                  <span key={chip} className="border-ink-700 bg-ink-850/70 rounded-md border px-1.5 py-0.5 text-[10px] text-zinc-500">
                    {t(chip)}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-4 w-full md:mt-0 md:w-[440px] md:shrink-0">
              <IntroDemo />
            </div>
          </section>
        )}

        {/* 首次运行：告诉用户刚才发生了什么，并给一条直达链接 */}
        {seed?.created && seed.projectId && (
          <div
            data-testid="sample-banner"
            className="border-accent/30 bg-accent/[0.07] mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
          >
            <Sparkles size={13} className="text-accent-soft shrink-0" />
            <span className="text-[11.5px] text-zinc-300">
              {t('已把示例「{name}」放进工程库：{seconds} 秒 · {layers} 层 · {tracks} 条关键帧轨道 · {code} 个代码层 · {audio} 条音轨 —— 打开就能改，删掉就不会再出现。', {
                name: seed.name ?? '',
                seconds: seed.seconds ?? 0,
                layers: seed.layers ?? 0,
                tracks: seed.tracks ?? 0,
                code: seed.codeLayers ?? 0,
                audio: seed.audioLayers ?? 0,
              })}
            </span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void openProject(seed.projectId as string)}
              data-testid="sample-open"
              className="border-accent/50 text-accent-soft hover:bg-accent/15 inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-medium transition"
            >
              {t('打开示例')}
            </button>
            <button type="button" onClick={() => setSeed(null)} title={t('关掉这条提示')} className="text-zinc-500 transition hover:text-zinc-200">
              <X size={13} />
            </button>
          </div>
        )}

        {/*
          库里的示例变了：要么旧版被原地换新（没动过，直接换），要么有新版但那份被改过。
          后者必须给一个「换成新版」的按钮 —— 否则用户永远卡在旧版上，
          而且从界面上看不出「示例还有新版」这件事。
        */}
        {notice && (
          <div
            data-testid="sample-notice"
            data-reason={notice.reason}
            className="border-cyan/30 bg-cyan/[0.06] mb-4 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
          >
            <Sparkles size={13} className="text-cyan shrink-0" />
            <span className="text-[11.5px] text-zinc-300">
              {notice.reason === 'upgraded'
                ? t('示例已换成新版：{seconds} 秒 · {layers} 层 · {audio} 条音轨 —— 原来那份没动过，直接换掉了。', {
                    seconds: notice.seconds ?? 0,
                    layers: notice.layers ?? 0,
                    audio: notice.audioLayers ?? 0,
                  })
                : t('示例有新版（{seconds} 秒六章导览）。你在这份上改过东西，所以没动它。', {
                    seconds: notice.seconds ?? 0,
                  })}
            </span>
            <div className="flex-1" />
            {notice.reason === 'modified' && (
              <button
                type="button"
                onClick={replaceSample}
                data-testid="sample-replace"
                className="border-cyan/50 text-cyan hover:bg-cyan/15 inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-medium transition"
              >
                {t('换成新版')}
              </button>
            )}
            {notice.projectId && notice.reason === 'upgraded' && (
              <button
                type="button"
                onClick={() => void openProject(notice.projectId as string)}
                className="border-cyan/50 text-cyan hover:bg-cyan/15 inline-flex h-6 items-center rounded-md border px-2 text-[11px] font-medium transition"
              >
                {t('打开示例')}
              </button>
            )}
            <button type="button" onClick={() => setNotice(null)} title={t('知道了')} className="text-zinc-500 transition hover:text-zinc-200">
              <X size={13} />
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 md:grid-cols-[300px_minmax(0,1fr)]">
        {/* 左栏：新建 */}
        <section className="min-w-0">
          <div className="mb-2 text-[11px] font-medium tracking-wide text-zinc-500">{t('新建')}</div>

          <div className="space-y-1.5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void quickCreate(1080, 1440)}
              data-testid="new-blank"
              className="border-ink-700 bg-ink-850 hover:border-accent/60 hover:bg-ink-800 flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition disabled:opacity-50"
            >
              <Plus size={14} className="text-accent-soft" />
              <span>
                <span className="block text-[12px] text-zinc-200">{t('空白项目')}</span>
                <span className="block text-[10px] text-zinc-600">{t('默认 1080 × 1440 · 5s · 30fps')}</span>
              </span>
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => setDialog({})}
              data-testid="new-custom"
              className="border-ink-700 bg-ink-850 hover:border-accent/60 hover:bg-ink-800 flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition disabled:opacity-50"
            >
              <Sparkles size={14} className="text-cyan" />
              <span>
                <span className="block text-[12px] text-zinc-200">{t('自定义尺寸')}</span>
                <span className="block text-[10px] text-zinc-600">{t('宽高 / 单位 / 时长 / 帧率 / 背景')}</span>
              </span>
            </button>
          </div>

          <div className="mb-1.5 mt-4 text-[11px] font-medium tracking-wide text-zinc-500">{t('预设')}</div>
          <div className="space-y-1">
            {SIZE_PRESETS.map((preset) => (
              <button
                key={preset.key}
                type="button"
                disabled={busy}
                onClick={() => void quickCreate(preset.width, preset.height, `${t(preset.key)} ${preset.width}×${preset.height}`)}
                data-testid={`preset-${preset.key}`}
                className="hover:bg-ink-850 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition disabled:opacity-50"
              >
                <span className="text-[11.5px] text-zinc-300">{t(preset.key)}</span>
                <span className="font-mono text-[10px] text-zinc-600">
                  {preset.width} × {preset.height}
                </span>
              </button>
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => setDialog({})}
              className="text-zinc-500 hover:text-zinc-200 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition disabled:opacity-50"
            >
              <span className="text-[11.5px]">{t('自定义…')}</span>
              <span className="text-[10px]">→</span>
            </button>
          </div>

          <div className="border-ink-700/70 mt-4 rounded-lg border border-dashed px-2.5 py-2 text-[10px] leading-relaxed text-zinc-600">
            {t('工程只存在这台电脑的浏览器里（IndexedDB）。换机器请用「导出工程包」。')}
          </div>
        </section>

        {/* 右栏：最近项目 */}
        <section className="min-w-0">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-medium tracking-wide text-zinc-500">
              {t('最近项目（最多 {n}）', { n: RECENT_LIMIT })}
            </span>
            <span className="text-[10px] text-zinc-700">{list ? shown.length : '…'}</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void importFile()}
              disabled={busy}
              data-testid="open-local"
              className="border-ink-600 text-zinc-300 hover:border-ink-500 hover:text-white inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition disabled:opacity-40"
            >
              <Upload size={12} />
              {t('打开本地文件')}
            </button>
          </div>

          {list === null && <div className="py-10 text-center text-[11px] text-zinc-600">{t('正在读取…')}</div>}

          {list !== null && shown.length === 0 && (
            <div className="border-ink-700/70 flex flex-col items-center gap-2 rounded-xl border border-dashed py-14 text-center">
              <ImageIcon size={20} className="text-zinc-700" />
              <div className="text-[12px] text-zinc-400">{t('还没有项目，从左侧新建一个')}</div>
              <div className="max-w-[360px] text-[10.5px] leading-relaxed text-zinc-600">
                {t('左边选一个预设，或者用「自定义尺寸」自己定；也可以直接打开之前导出的 .kly。')}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void restoreSample()}
                data-testid="sample-restore"
                className="text-zinc-500 hover:text-accent-soft mt-1 inline-flex items-center gap-1 text-[10.5px] transition disabled:opacity-40"
              >
                <Sparkles size={11} /> {t('放回示例工程')}
              </button>
            </div>
          )}

          {shown.length > 0 && (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}
              data-testid="launcher-grid"
            >
              {shown.map((meta) => {
                const isCurrent = meta.id === currentId;
                return (
                  <article
                    key={meta.id}
                    data-project-id={meta.id}
                    className={cx(
                      'group bg-ink-850 relative overflow-hidden rounded-xl border transition',
                      isCurrent ? 'border-accent/60' : 'border-ink-700 hover:border-ink-600',
                    )}
                  >
                    <button type="button" onClick={() => void openProject(meta.id)} className="block w-full text-left">
                      <div className="bg-ink-900 relative aspect-[4/3] overflow-hidden">
                        {meta.thumbnail ? (
                          <img src={meta.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-zinc-700">
                            <ImageIcon size={20} />
                          </div>
                        )}
                        <span className="bg-ink-950/80 absolute bottom-1 left-1.5 rounded px-1.5 py-0.5 text-[9.5px] text-zinc-400">
                          {meta.width}×{meta.height} · {fmtLen(meta.duration)} · {meta.fps}fps
                        </span>
                        {meta.id === SAMPLE_PROJECT_ID && (
                          <span data-testid="sample-badge" className="bg-accent/90 absolute right-1.5 bottom-1 rounded px-1.5 py-0.5 text-[9.5px] font-medium text-white">
                            {t('示例')}
                          </span>
                        )}
                        {isCurrent && (
                          <span className="bg-accent/90 absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[9.5px] font-medium text-white">
                            {t('当前')}
                          </span>
                        )}
                      </div>
                      <div className="p-2.5">
                        {editing === meta.id ? (
                          <input
                            autoFocus
                            value={draftName}
                            onChange={(e) => setDraftName(e.target.value)}
                            onBlur={() => void commitRename(meta.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void commitRename(meta.id);
                              if (e.key === 'Escape') setEditing(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="border-accent/60 bg-ink-900 w-full rounded border px-1.5 py-0.5 text-[12px] text-zinc-100 outline-none"
                          />
                        ) : (
                          <div className="truncate text-[12px] text-zinc-200" title={meta.name}>
                            {meta.name}
                          </div>
                        )}
                        <div className="mt-0.5 text-[10px] text-zinc-600">
                          {t('{n} 图层 · {time}', { n: meta.layerCount, time: fmtWhen(meta.updatedAt) })}
                        </div>
                      </div>
                    </button>

                    <div className="bg-ink-950/70 absolute top-1.5 right-1.5 flex gap-0.5 rounded-md p-0.5 opacity-0 backdrop-blur transition group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        title={t('打开')}
                        onClick={() => void openProject(meta.id)}
                        className="hover:bg-ink-800 rounded p-1 text-zinc-400 hover:text-zinc-100"
                      >
                        <FolderOpen size={11} />
                      </button>
                      <button
                        type="button"
                        title={t('重命名')}
                        onClick={() => {
                          setEditing(meta.id);
                          setDraftName(meta.name);
                        }}
                        className="hover:bg-ink-800 rounded p-1 text-zinc-400 hover:text-zinc-100"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        type="button"
                        title={t('导出工程包')}
                        onClick={() => void exportBundle(meta.id)}
                        className="hover:bg-ink-800 rounded p-1 text-zinc-400 hover:text-zinc-100"
                      >
                        <Download size={11} />
                      </button>
                      <button
                        type="button"
                        title={t('删除')}
                        onClick={() => void remove(meta)}
                        className="hover:bg-rose-500/20 rounded p-1 text-zinc-400 hover:text-rose-300"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        </div>
      </div>

      <footer className="border-ink-700/70 text-[10.5px] text-zinc-600 flex h-9 shrink-0 items-center gap-2 border-t px-5">
        <span className="text-zinc-500">{mode === 'page' ? t('Kinelayer 织层 · 本机工程库') : t('当前：{name}', { name: currentName || '—' })}</span>
        <span className="text-zinc-700">·</span>
        <span>{mode === 'page' ? t('选中一个工程进入编辑器') : t('Esc 回到编辑器')}</span>
      </footer>

      {dialog && (
        <NewProjectDialog
          initial={dialog}
          busy={busy}
          onClose={() => setDialog(null)}
          onSubmit={(values) => void create(values)}
        />
      )}
    </div>
  );
}
