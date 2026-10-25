import {
  type ChangeEvent,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { t } from '@/i18n';
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('bg-ink-850 border-ink-700/80 border', className)}>{children}</div>;
}

export function Section({
  title,
  children,
  defaultOpen = true,
  right,
  dense,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  right?: ReactNode;
  dense?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-ink-700/70 border-b last:border-b-0">
      <div className="flex items-center justify-between px-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-ink-100 flex flex-1 items-center gap-1.5 py-2.5 text-[11px] font-semibold tracking-[0.08em] text-zinc-300 uppercase hover:text-white"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        {right}
      </div>
      {open && <div className={cx('px-3 pb-3', dense ? 'space-y-1.5' : 'space-y-2.5')}>{children}</div>}
    </div>
  );
}

export function Field({
  label,
  children,
  hint,
  inline,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  inline?: boolean;
}) {
  return (
    <label className={cx('block', inline && 'flex items-center gap-2')}>
      <span className={cx('text-[11px] text-zinc-500', inline ? 'w-16 shrink-0' : 'mb-1 block')}>{label}</span>
      <div className={cx(inline && 'flex-1')}>{children}</div>
      {hint && <span className="mt-0.5 block text-[10px] text-zinc-600">{hint}</span>}
    </label>
  );
}

const inputBase =
  'w-full rounded-md border border-ink-700 bg-ink-900/80 px-2 py-1 text-[12px] text-zinc-100 outline-none transition focus:border-accent/60 focus:bg-ink-900';

export function TextInput({
  value,
  onChange,
  onCommit,
  placeholder,
  className,
  ...rest
}: {
  value: string;
  onChange?: (v: string) => void;
  onCommit?: (v: string) => void;
  placeholder?: string;
  className?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'>) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(value);
  }, [value]);
  return (
    <input
      {...rest}
      className={cx(inputBase, className)}
      value={local}
      placeholder={placeholder}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e: ChangeEvent<HTMLInputElement>) => {
        setLocal(e.target.value);
        onChange?.(e.target.value);
      }}
      onBlur={() => {
        focused.current = false;
        if (local !== value) onCommit?.(local);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function NumberInput({
  value,
  onCommit,
  min = -100000,
  max = 100000,
  step = 1,
  suffix,
  className,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
}) {
  const [local, setLocal] = useState(String(Math.round(value * 100) / 100));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(String(Math.round(value * 100) / 100));
  }, [value]);
  const commit = () => {
    const n = Number(local);
    if (Number.isFinite(n)) {
      const clamped = Math.min(max, Math.max(min, n));
      setLocal(String(clamped));
      if (clamped !== value) onCommit(clamped);
    } else {
      setLocal(String(value));
    }
  };
  return (
    <div className={cx('relative', className)}>
      <input
        className={cx(inputBase, 'pr-6 tabular-nums')}
        value={local}
        inputMode="decimal"
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            const next = Math.min(max, Number(local || 0) + step);
            setLocal(String(next));
            onCommit(next);
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            const next = Math.max(min, Number(local || 0) - step);
            setLocal(String(next));
            onCommit(next);
          }
        }}
      />
      {suffix && <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-zinc-600">{suffix}</span>}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  format?: (v: number) => string;
}) {
  return (
    <div>
      {label && (
        <div className="mb-0.5 flex items-baseline justify-between">
          <span className="text-[11px] text-zinc-500">{label}</span>
          <span className="text-[10px] tabular-nums text-zinc-400">{format ? format(value) : value}</span>
        </div>
      )}
      <input
        type="range"
        className="w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('relative', className)}>
      <select
        className={cx(inputBase, 'appearance-none pr-7')}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-ink-900">
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={12} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-zinc-500" />
    </div>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  return (
    <div className="flex items-center gap-1.5">
      <input
        id={id}
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 w-7 shrink-0 rounded"
      />
      <TextInput value={value} onCommit={onChange} className="font-mono text-[11px]" />
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'ghost',
  size = 'md',
  disabled,
  title,
  className,
  type = 'button',
  testId,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'ghost' | 'solid' | 'outline' | 'danger' | 'accent';
  size?: 'sm' | 'md';
  disabled?: boolean;
  title?: string;
  className?: string;
  type?: 'button' | 'submit';
  /** 自检脚本用；文案会随语言变，testid 不会 */
  testId?: string;
}) {
  const variants: Record<string, string> = {
    ghost: 'text-zinc-300 hover:bg-ink-750 hover:text-white',
    outline: 'border border-ink-600 text-zinc-300 hover:border-ink-500 hover:text-white',
    solid: 'bg-ink-700 text-zinc-100 hover:bg-ink-600',
    accent: 'bg-accent text-white hover:bg-accent-soft shadow-[0_0_0_1px_rgba(124,92,255,.4)]',
    danger: 'bg-rose-600/90 text-white hover:bg-rose-500',
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
        size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-[12px]',
        variants[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  active,
  title,
  disabled,
  className,
  size = 28,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
  title?: string;
  disabled?: boolean;
  className?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      style={{ width: size, height: size }}
      className={cx(
        'inline-flex items-center justify-center rounded-md transition disabled:opacity-35',
        active ? 'bg-accent/20 text-accent-soft' : 'text-zinc-400 hover:bg-ink-750 hover:text-zinc-100',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="flex items-center gap-2 text-[11px] text-zinc-400 hover:text-zinc-200"
    >
      <span
        className={cx(
          'relative h-4 w-7 rounded-full transition',
          value ? 'bg-accent/80' : 'bg-ink-600',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
            value ? 'left-3.5' : 'left-0.5',
          )}
        />
      </span>
      {label}
    </button>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'cyan' | 'danger' | 'warn';
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink-700 text-zinc-400',
    accent: 'bg-accent/20 text-accent-soft',
    cyan: 'bg-cyan/20 text-cyan',
    danger: 'bg-rose-500/20 text-rose-300',
    warn: 'bg-amber-500/20 text-amber-300',
  };
  return (
    <span className={cx('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium', tones[tone])}>
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-ink-500">{icon}</div>}
      <div className="text-[12px] text-zinc-400">{title}</div>
      {hint && <div className="text-[10.5px] leading-relaxed text-zinc-600">{hint}</div>}
    </div>
  );
}
