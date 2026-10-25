/**
 * 导入预检报告。
 *
 * 这张卡片是 v2.5「降级必须可见」的落点：用户/Agent 在写入之前先看到
 * 「会得到几个可编辑图层、几个代码层、哪些东西被降级、哪些资源找不到」。
 *
 * 说人话的几条约束：
 *   · 保真度是「还能继续编辑的比例」，不是画质，所以文案写「可编辑程度」；
 *   · 每条 note 一定对应一处具体损失，不写「部分内容可能丢失」这种免责声明；
 *   · 有 blocker 时不给「导入」按钮 —— 不给按钮比点了再报错更诚实。
 */

import { AlertTriangle, ArrowRight, FileWarning, Layers, Sparkles, X } from 'lucide-react';
import { Modal } from './Modal';
import { Badge, Button } from './primitives';
import { useImportFlow, commitImport, type ImportMode } from './importFlow';
import { t } from '@/i18n';

const MODES: { key: ImportMode; label: string; hint: string }[] = [
  { key: 'prefer-editable', label: '优先可编辑', hint: '尽量拆成文本/图片层，能打关键帧' },
  { key: 'preserve-code', label: '优先保代码', hint: '少拆几层，形状等交给代码层' },
];

export function ImportReportDialog() {
  const pending = useImportFlow((s) => s.pending);
  const busy = useImportFlow((s) => s.busy);
  const mode = useImportFlow((s) => s.mode);
  const setMode = useImportFlow((s) => s.setMode);
  const close = useImportFlow((s) => s.close);

  if (!pending) return null;
  const { report, fileName, zip, error } = pending;
  const blocked = report.blockers.length > 0 || !!error || !report.supported;
  const counts = report.counts;

  return (
    <Modal
      title={t('导入预检')}
      onClose={close}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={close} testId="import-cancel">
            {t('取消')}
          </Button>
          {!blocked && (
            <Button variant="accent" disabled={busy} onClick={() => void commitImport()} testId="import-confirm">
              {busy ? t('导入中…') : t('导入这份工程')}
              <ArrowRight size={13} />
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-[11.5px] leading-relaxed text-zinc-400" data-testid="import-dialog">
        <div className="border-ink-700 bg-ink-900/60 flex items-start gap-2.5 rounded-lg border p-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[11px] text-zinc-300">{fileName}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge tone="accent">{t(report.label)}</Badge>
              <Badge tone="neutral">{report.format}</Badge>
              {zip && <Badge tone="cyan">.kly</Badge>}
              <span className="text-[10.5px] text-zinc-500">
                {t('可编辑程度 {n}%', { n: report.fidelity })}
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[11px] text-rose-200/90">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <FileWarning size={12} /> {t('这份文件读不出来')}
            </div>
            {error}
          </div>
        )}

        {report.preview && (
          <div className="border-ink-700 bg-ink-900/40 rounded-lg border px-3 py-2">
            <div className="text-[11px] text-zinc-300">{report.preview.name}</div>
            <div className="mt-0.5 font-mono text-[10.5px] text-zinc-500">
              {report.preview.width}×{report.preview.height} · {(report.preview.duration / 1000).toFixed(1)}s ·{' '}
              {report.preview.fps}fps
            </div>
            {report.preview.sample.length > 0 && (
              <div className="mt-1 truncate font-mono text-[10px] text-zinc-600">{report.preview.sample.join(' · ')}</div>
            )}
          </div>
        )}

        <div className="grid grid-cols-4 gap-2">
          <Stat label={t('可编辑图层')} value={counts.structured} icon={<Layers size={11} />} />
          <Stat label={t('代码层')} value={counts.code} />
          <Stat label={t('轨道')} value={counts.tracks} />
          <Stat label={t('关键帧')} value={counts.keyframes} />
        </div>

        {!zip && !blocked && (
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-zinc-300">{t('导入方式')}</div>
            <div className="grid grid-cols-2 gap-2">
              {MODES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  data-testid={`import-mode-${item.key}`}
                  onClick={() => setMode(item.key)}
                  className={`rounded-lg border px-2.5 py-2 text-left transition ${
                    mode === item.key
                      ? 'border-accent/60 bg-accent/10 text-zinc-200'
                      : 'border-ink-700 bg-ink-900/40 text-zinc-400 hover:border-ink-600'
                  }`}
                >
                  <div className="text-[11.5px] font-medium">{t(item.label)}</div>
                  <div className="mt-0.5 text-[10px] leading-snug text-zinc-500">{t(item.hint)}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {report.blockers.length > 0 && (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-[11px] text-rose-200/90">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <X size={12} /> {t('不能导入')}
            </div>
            <ul className="ml-4 list-disc space-y-1">
              {report.blockers.map((item) => (
                <li key={item.key}>{t(item.key, item.params)}</li>
              ))}
            </ul>
          </div>
        )}

        {report.notes.length > 0 && (
          <div data-testid="import-notes">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
              <Sparkles size={11} /> {t('这次导入会发生什么')}
            </div>
            <ul className="ml-4 list-disc space-y-1 text-[11px] text-zinc-500">
              {report.notes.map((item) => (
                <li key={item.key}>{t(item.key, item.params)}</li>
              ))}
            </ul>
          </div>
        )}

        {report.missingAssets.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200/90">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <AlertTriangle size={12} /> {t('{n} 个资源找不到（图层会先建成空占位）', { n: report.missingAssets.length })}
            </div>
            <ul className="ml-4 max-h-24 list-disc space-y-0.5 overflow-y-auto">
              {report.missingAssets.map((text) => (
                <li key={text} className="truncate font-mono text-[10.5px]">
                  {text}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Stat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="border-ink-700 bg-ink-900/40 rounded-lg border px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="font-mono text-[13px] text-zinc-200">{value}</div>
    </div>
  );
}
