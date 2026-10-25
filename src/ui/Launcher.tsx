/**
 * 启动页 / 工程库。
 *
 * 只读 meta 索引（project.listRecent），不加载任何一个工程本体 —— 二十个工程
 * 在列表页也只反序列化二十条 ProjectMeta。
 *
 * 所有写操作都回命令总线：新建 = project.create，重命名 = project.rename，
 * 删除 = project.deleteLocal（必须 confirm），复制 = project.duplicate。
 * 这里不碰 IndexedDB，也不改 store 里的 project。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  Download,
  FolderOpen,
  Image as ImageIcon,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { exec } from '@/core/commandBus';
import { pushToast, updateUi, useEditor } from '@/core/store';
import type { ProjectMeta } from '@/persist/projects';
import { Button, cx } from './primitives';
import { importProjectFile, pickProjectFile } from './importProject';
import { t } from '@/i18n';

const PRESETS: { label: string; hint: string; width: number; height: number }[] = [
  { label: '竖版', hint: '1080 × 1440', width: 1080, height: 1440 },
  { label: '方版', hint: '1080 × 1080', width: 1080, height: 1080 },
  { label: '横版', hint: '1920 × 1080', width: 1920, height: 1080 },
];

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtLen(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function Launcher() {
  const open = useEditor((s) => s.ui.showLauncher);
  const currentId = useEditor((s) => s.project.id);
  const currentName = useEditor((s) => s.project.name);

  const [list, setList] = useState<ProjectMeta[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(async () => {
    const res = await exec<{ projects: ProjectMeta[] }>('project.listRecent', { limit: 50 });
    if (res.ok && res.data) setList(res.data.projects);
    else setList([]);
  }, []);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, nonce, refresh]);

  const close = useCallback(() => updateUi((ui) => { ui.showLauncher = false; }), []);

  /* Esc 关闭：启动页是覆盖层，不该把编辑器困住 */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !editing) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editing, close]);

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

  const create = (width: number, height: number) =>
    wrap(async () => {
      const res = await exec('project.create', { width, height });
      if (res.ok) close();
    });

  const openProject = (id: string) =>
    wrap(async () => {
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

  const duplicate = (id: string) =>
    wrap(async () => {
      await exec('project.duplicate', { projectId: id });
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

  const exportBundle = (id: string) =>
    wrap(async () => {
      const res = await exec<{ filename: string }>('project.exportBundle', { projectId: id });
      if (!res.ok) pushToast('error', res.error?.message ?? t('导出失败'));
    });

  const importFile = () =>
    wrap(async () => {
      pickProjectFile((file) => {
        void wrap(async () => {
          const outcome = await importProjectFile(file);
          if (outcome.ok) close();
        });
      });
    });

  return (
    <div className="bg-ink-950/95 fixed inset-0 z-40 flex flex-col backdrop-blur-sm" data-testid="launcher">
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

        <Button variant="outline" onClick={() => void importFile()} disabled={busy}>
          <Upload size={12} />
          {t('导入工程包')}
        </Button>
        <button
          type="button"
          onClick={close}
          title={t('回到编辑器 (Esc)')}
          className="text-zinc-500 transition hover:text-zinc-200"
        >
          <X size={18} />
        </button>
      </header>

      <div className="ml-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {/* 新建 */}
        <section className="mb-6">
          <div className="mb-2 text-[11px] font-medium tracking-wide text-zinc-500">{t('新建')}</div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={busy}
                onClick={() => void create(preset.width, preset.height)}
                className="border-ink-700 bg-ink-850 hover:border-accent/60 hover:bg-ink-800 flex min-w-[132px] items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition disabled:opacity-50"
              >
                <Plus size={14} className="text-accent-soft" />
                <span>
                  <span className="block text-[12px] text-zinc-200">{t(preset.label)}</span>
                  <span className="block text-[10px] text-zinc-600">{preset.hint}</span>
                </span>
              </button>
            ))}
            <div className="border-ink-700/70 text-[10.5px] leading-relaxed text-zinc-600 flex max-w-[280px] items-center rounded-lg border border-dashed px-3 py-2">
              {t('工程只存在这台电脑的浏览器里（IndexedDB）。换机器请用「导出工程包」。')}
            </div>
          </div>
        </section>

        {/* 最近工程 */}
        <section>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[11px] font-medium tracking-wide text-zinc-500">{t('最近工程')}</span>
            <span className="text-[10px] text-zinc-700">{list ? list.length : '…'}</span>
          </div>

          {list === null && <div className="py-10 text-center text-[11px] text-zinc-600">{t('正在读取…')}</div>}

          {list !== null && list.length === 0 && (
            <div className="border-ink-700/70 flex flex-col items-center gap-2 rounded-xl border border-dashed py-14 text-center">
              <ImageIcon size={20} className="text-zinc-700" />
              <div className="text-[12px] text-zinc-400">{t('还没有工程')}</div>
              <div className="max-w-[360px] text-[10.5px] leading-relaxed text-zinc-600">
                {t('上面选一个尺寸就开始，或者把之前导出的 .kly 拖进来。')}
              </div>
            </div>
          )}

          {list !== null && list.length > 0 && (
            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}
              data-testid="launcher-grid"
            >
              {list.map((meta) => {
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
                          {meta.width}×{meta.height} · {fmtLen(meta.duration)}
                        </span>
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
                        title={t('复制一份')}
                        onClick={() => void duplicate(meta.id)}
                        className="hover:bg-ink-800 rounded p-1 text-zinc-400 hover:text-zinc-100"
                      >
                        <Copy size={11} />
                      </button>
                      <button
                        type="button"
                        title={t('导出 .kly')}
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

      <footer className="border-ink-700/70 text-[10.5px] text-zinc-600 flex h-9 shrink-0 items-center gap-2 border-t px-5">
        <span className="text-zinc-500">{t('当前：{name}', { name: currentName || '—' })}</span>
        <span className="text-zinc-700">·</span>
        <span>{t('Esc 回到编辑器')}</span>
      </footer>
    </div>
  );
}
