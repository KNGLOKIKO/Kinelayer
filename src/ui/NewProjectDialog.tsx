/**
 * 新建项目对话框。
 *
 * 尺寸单位只活在 UI 层：内部数据一律 px（96dpi 换算），数据层永远不认 mm/cm/in。
 * 这样切单位只是「换个写法」，模型里那条投影值不会因为单位切换而漂。
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';
import { Button, cx } from './primitives';
import { t } from '@/i18n';

export type SizeUnit = 'px' | 'mm' | 'cm' | 'in';

/** 96dpi：1in = 96px，1mm = 96/25.4 px */
const UNIT_PX: Record<SizeUnit, number> = {
  px: 1,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
};

const UNIT_ORDER: SizeUnit[] = ['px', 'mm', 'cm', 'in'];

export const SIZE_PRESETS: { key: string; width: number; height: number }[] = [
  { key: '海报', width: 1080, height: 1440 },
  { key: '横幅', width: 1920, height: 1080 },
  { key: '方形', width: 1080, height: 1080 },
  { key: '竖屏', width: 1080, height: 1920 },
];

const FPS_OPTIONS = [24, 25, 30, 60];

const MIN_PX = 40;
const MAX_PX = 8000;
const MIN_SECONDS = 0.5;
const MAX_SECONDS = 600;

export interface NewProjectValues {
  name: string;
  width: number;
  height: number;
  duration: number; // ms
  fps: number;
  background: string;
}

export function NewProjectDialog({
  onClose,
  onSubmit,
  busy = false,
  initial,
}: {
  onClose: () => void;
  onSubmit: (values: NewProjectValues) => void;
  busy?: boolean;
  initial?: Partial<{ name: string; width: number; height: number; duration: number; fps: number; background: string }>;
}) {
  const [name, setName] = useState(initial?.name ?? t('未命名织层项目'));
  const [unit, setUnit] = useState<SizeUnit>('px');
  /* 宽高在 UI 里存「当前单位下的值」，提交时再换成 px */
  const [widthText, setWidthText] = useState(() => trimNum((initial?.width ?? 1080) / UNIT_PX.px));
  const [heightText, setHeightText] = useState(() => trimNum((initial?.height ?? 1440) / UNIT_PX.px));
  const [seconds, setSeconds] = useState(() => trimNum((initial?.duration ?? 5000) / 1000));
  const [fps, setFps] = useState(initial?.fps ?? 30);
  const [background, setBackground] = useState(initial?.background ?? '#ffffff');

  const px = useMemo(
    () => ({
      width: Math.round(toNumber(widthText) * UNIT_PX[unit]),
      height: Math.round(toNumber(heightText) * UNIT_PX[unit]),
    }),
    [widthText, heightText, unit],
  );

  const errors = useMemo(() => {
    const list: string[] = [];
    if (!name.trim()) list.push(t('项目名称不能为空'));
    if (name.trim().length > 60) list.push(t('项目名称不能超过 60 个字符'));
    if (!(px.width >= MIN_PX && px.width <= MAX_PX)) list.push(t('宽度需要在 {min}–{max}px 之间', { min: MIN_PX, max: MAX_PX }));
    if (!(px.height >= MIN_PX && px.height <= MAX_PX)) list.push(t('高度需要在 {min}–{max}px 之间', { min: MIN_PX, max: MAX_PX }));
    const s = toNumber(seconds);
    if (!(s >= MIN_SECONDS && s <= MAX_SECONDS)) list.push(t('时长需要在 {min}–{max} 秒之间', { min: MIN_SECONDS, max: MAX_SECONDS }));
    if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(background)) list.push(t('背景色需要是 #rgb 或 #rrggbb'));
    return list;
  }, [name, px.width, px.height, seconds, background]);

  const applyPreset = (width: number, height: number) => {
    setWidthText(trimNum(width / UNIT_PX[unit]));
    setHeightText(trimNum(height / UNIT_PX[unit]));
  };

  /* 切单位时把数字换算过去，物理尺寸不变 —— 否则「1080」会突然变成 1080mm。
     注意方向：数字是「当前单位下的值」，先乘回 px，再除以新单位 → value * 旧系数 / 新系数 */
  const switchUnit = (next: SizeUnit) => {
    if (next === unit) return;
    const factor = UNIT_PX[unit] / UNIT_PX[next];
    setWidthText(trimNum(toNumber(widthText) * factor));
    setHeightText(trimNum(toNumber(heightText) * factor));
    setUnit(next);
  };

  const submit = () => {
    if (errors.length || busy) return;
    onSubmit({
      name: name.trim(),
      width: px.width,
      height: px.height,
      duration: Math.round(toNumber(seconds) * 1000),
      fps,
      background,
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Modal
      title={t('新建项目')}
      onClose={onClose}
      width={620}
      footer={
        <>
          <span className="mr-auto text-[10.5px] text-zinc-600">
            {t('内部统一按 px 存储 · 当前 {w} × {h}px', { w: px.width, h: px.height })}
          </span>
          <Button variant="outline" onClick={onClose}>
            {t('取消')}
          </Button>
          <Button variant="accent" onClick={submit} disabled={!!errors.length || busy}>
            {t('创建并打开')}
          </Button>
        </>
      }
    >
      <div className="space-y-4" data-testid="new-project-dialog">
        {/* 名称 */}
        <label className="block">
          <span className="mb-1 block text-[11px] text-zinc-500">{t('项目名称')}</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            data-testid="np-name"
            className="border-ink-600 bg-ink-900 focus:border-accent/70 h-8 w-full rounded-md border px-2.5 text-[12px] text-zinc-100 outline-none"
          />
        </label>

        {/* 预设 */}
        <div>
          <span className="mb-1 block text-[11px] text-zinc-500">{t('预设')}</span>
          <div className="flex flex-wrap gap-1.5">
            {SIZE_PRESETS.map((preset) => {
              const active = px.width === preset.width && px.height === preset.height;
              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => applyPreset(preset.width, preset.height)}
                  data-testid={`np-preset-${preset.key}`}
                  className={cx(
                    'rounded-md border px-2.5 py-1.5 text-left transition',
                    active
                      ? 'border-accent/70 bg-accent/10 text-zinc-100'
                      : 'border-ink-600 text-zinc-400 hover:border-ink-500 hover:text-zinc-200',
                  )}
                >
                  <span className="block text-[11.5px]">{t(preset.key)}</span>
                  <span className="block text-[10px] text-zinc-600">
                    {preset.width} × {preset.height}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 宽高 + 单位 */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-zinc-500">{t('宽度 / 高度')}</span>
            <div className="border-ink-600 flex overflow-hidden rounded-md border">
              {UNIT_ORDER.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => switchUnit(u)}
                  className={cx(
                    'px-2 py-0.5 text-[10.5px] transition',
                    unit === u ? 'bg-ink-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                  )}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              value={widthText}
              onChange={(e) => setWidthText(e.target.value)}
              inputMode="decimal"
              data-testid="np-width"
              className="border-ink-600 bg-ink-900 focus:border-accent/70 h-8 min-w-0 flex-1 rounded-md border px-2 text-[12px] text-zinc-100 outline-none"
            />
            <span className="text-zinc-600">×</span>
            <input
              value={heightText}
              onChange={(e) => setHeightText(e.target.value)}
              inputMode="decimal"
              data-testid="np-height"
              className="border-ink-600 bg-ink-900 focus:border-accent/70 h-8 min-w-0 flex-1 rounded-md border px-2 text-[12px] text-zinc-100 outline-none"
            />
            <span className="w-7 text-[10.5px] text-zinc-500">{unit}</span>
          </div>
          <div className="mt-1 text-[10px] text-zinc-600">
            {t('范围 {min}–{max}px（约 {mm}）@ 96dpi', {
              min: MIN_PX,
              max: MAX_PX,
              mm: `${((px.width / 96) * 25.4).toFixed(0)} × ${((px.height / 96) * 25.4).toFixed(0)} mm`,
            })}
          </div>
        </div>

        {/* 时长 + 帧率 */}
        <div className="flex gap-3">
          <label className="block flex-1">
            <span className="mb-1 block text-[11px] text-zinc-500">{t('时长（秒）')}</span>
            <input
              value={seconds}
              onChange={(e) => setSeconds(e.target.value)}
              inputMode="decimal"
              data-testid="np-duration"
              className="border-ink-600 bg-ink-900 focus:border-accent/70 h-8 w-full rounded-md border px-2 text-[12px] text-zinc-100 outline-none"
            />
          </label>
          <label className="block w-[120px]">
            <span className="mb-1 block text-[11px] text-zinc-500">{t('帧率')}</span>
            <select
              value={fps}
              onChange={(e) => setFps(Number(e.target.value))}
              data-testid="np-fps"
              className="border-ink-600 bg-ink-900 h-8 w-full rounded-md border px-2 text-[12px] text-zinc-100 outline-none"
            >
              {FPS_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v} fps
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* 背景 */}
        <div>
          <span className="mb-1 block text-[11px] text-zinc-500">{t('背景')}</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(background) ? background : '#ffffff'}
              onChange={(e) => setBackground(e.target.value)}
              className="border-ink-600 bg-ink-900 h-8 w-10 cursor-pointer rounded-md border p-0.5"
            />
            <input
              value={background}
              onChange={(e) => setBackground(e.target.value)}
              data-testid="np-bg"
              className="border-ink-600 bg-ink-900 focus:border-accent/70 h-8 w-[110px] rounded-md border px-2 font-mono text-[11.5px] text-zinc-100 outline-none"
            />
            <span className="text-[10px] text-zinc-600">{t('画布默认底色，之后还能改')}</span>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[10.5px] leading-relaxed text-rose-300">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function toNumber(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function trimNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 100) / 100);
}
