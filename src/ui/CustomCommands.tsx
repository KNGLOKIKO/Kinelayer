import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import { exec } from '@/core/commandBus';
import { getCommand, listByCategory } from '@/core/registry';
import { pushToast, updateUi, useEditor } from '@/core/store';
import { forbiddenReason, paramDefault, type CustomIssue } from '@/core/customCommands';
import { uid } from '@/core/ids';
import type { CustomCommandParam, CustomParamType, Layer } from '@/core/types';
import { Button, ColorInput, Field, IconButton, NumberInput, TextInput, Toggle } from './primitives';
import { Modal } from './Modal';

import { t } from '@/i18n';

const PARAM_TYPES: { value: CustomParamType; label: string }[] = [
  { value: 'string', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '开关' },
  { value: 'color', label: '颜色' },
  { value: 'layerId', label: '图层' },
];

const selectCls =
  'border-ink-700 bg-ink-900 h-7 w-full rounded border px-1.5 text-[11px] text-zinc-200 outline-none focus:border-accent/60';

/** 编辑态的参数行：默认值一律按文本编辑，保存时再按类型收口 */
interface ParamDraft {
  key: string;
  label: string;
  type: CustomParamType;
  defaultText: string;
  hint: string;
}

interface StepDraft {
  id: string;
  type: string;
  payloadText: string;
  note: string;
}

function toParamDraft(p: CustomCommandParam): ParamDraft {
  return {
    key: p.key,
    label: p.label ?? '',
    type: p.type,
    defaultText: p.default === undefined ? '' : String(p.default),
    hint: p.hint ?? '',
  };
}

function toStepDraft(s: { id?: string; type: string; payload: Record<string, unknown>; note?: string }): StepDraft {
  return {
    id: s.id ?? uid('st'),
    type: s.type,
    payloadText: JSON.stringify(s.payload ?? {}, null, 2),
    note: s.note ?? '',
  };
}

/** 「从示例开始」用：两步文字层，参数只有一个标题。比空白对话框更容易上手 */
function starterDrafts(): { name: string; description: string; params: ParamDraft[]; steps: StepDraft[] } {
  return {
    name: t('做一张标题卡'),
    description: t('在当前画布上叠标题 + 副标题两层文字'),
    params: [
      { key: 'title', label: t('标题'), type: 'string', defaultText: '新品发布', hint: '' },
      { key: 'sub', label: t('副标题'), type: 'string', defaultText: '2026 春季', hint: '' },
    ],
    steps: [
      toStepDraft({
        type: 'layer.create',
        payload: { type: 'text', name: t('标题'), text: '{{title}}', x: 120, y: 180, width: 840, height: 200, textStyle: { fontSize: 96, color: '#ffffff' } },
        note: t('建标题层'),
      }),
      toStepDraft({
        type: 'layer.create',
        payload: { type: 'text', name: t('副标题'), text: '{{sub}}', x: 120, y: 400, width: 840, height: 120, textStyle: { fontSize: 40, color: '#9aa4b2' } },
        note: t('建副标题层'),
      }),
    ],
  };
}

/* --------------------------------------------------------- 参数编辑行 */

function ParamRow({
  value,
  onChange,
  onRemove,
}: {
  value: ParamDraft;
  onChange: (patch: Partial<ParamDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="border-ink-700/70 bg-ink-900/50 grid grid-cols-[1fr_88px_1fr_24px] items-center gap-1 rounded border p-1.5">
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-zinc-600">{'{{'}</span>
        <TextInput value={value.key} onChange={(key) => onChange({ key })} placeholder={t('参数名')} className="h-6 text-[11px]" data-user-text />
        <span className="text-[10px] text-zinc-600">{'}}'}</span>
      </div>
      <select className={selectCls} value={value.type} onChange={(e) => onChange({ type: e.target.value as CustomParamType })}>
        {PARAM_TYPES.map((p) => (
          <option key={p.value} value={p.value}>
            {t(p.label)}
          </option>
        ))}
      </select>
      <TextInput value={value.defaultText} onChange={(defaultText) => onChange({ defaultText })} placeholder={t('默认值（可空）')} className="h-6 text-[11px]" data-user-text />
      <IconButton size={22} title={t('删除参数')} onClick={onRemove}>
        <Trash2 size={11} />
      </IconButton>
      <div className="col-span-4 flex items-center gap-1">
        <TextInput value={value.label} onChange={(label) => onChange({ label })} placeholder={t('显示名（给人和 AI 看）')} className="h-6 flex-1 text-[11px]" data-user-text />
        <TextInput value={value.hint} onChange={(hint) => onChange({ hint })} placeholder={t('说明')} className="h-6 flex-1 text-[11px]" data-user-text />
      </div>
    </div>
  );
}

/* --------------------------------------------------------- 步骤编辑卡 */

function StepCard({
  index,
  total,
  value,
  params,
  onChange,
  onRemove,
  onMove,
  groups,
}: {
  index: number;
  total: number;
  value: StepDraft;
  params: ParamDraft[];
  onChange: (patch: Partial<StepDraft>) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
  groups: { category: string; types: { type: string; label: string }[] }[];
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const def = getCommand(value.type);
  let parseError = '';
  try {
    const parsed = JSON.parse(value.payloadText || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) parseError = t('payload 必须是一个对象');
  } catch (err) {
    parseError = (err as Error).message;
  }

  const insert = (token: string) => {
    const el = areaRef.current;
    if (!el) return;
    const start = el.selectionStart ?? value.payloadText.length;
    const end = el.selectionEnd ?? start;
    const next = `${value.payloadText.slice(0, start)}${token}${value.payloadText.slice(end)}`;
    onChange({ payloadText: next });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + token.length;
      el.selectionEnd = start + token.length;
    });
  };

  return (
    <div className="border-ink-700/70 bg-ink-900/40 rounded border">
      <div className="border-ink-700/50 flex items-center gap-1.5 border-b px-1.5 py-1">
        <span className="bg-ink-750 flex h-5 w-5 items-center justify-center rounded text-[10px] text-zinc-400">{index + 1}</span>
        <select className={selectCls} value={value.type} onChange={(e) => onChange({ type: e.target.value })}>
          {groups.map((g) => (
            <optgroup key={g.category} label={g.category}>
              {g.types.map((x) => (
                <option key={x.type} value={x.type}>
                  {x.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <IconButton size={20} title={t('上移')} onClick={() => onMove(-1)}>
          <ArrowUp size={11} />
        </IconButton>
        <IconButton size={20} title={t('下移')} onClick={() => onMove(1)}>
          <ArrowDown size={11} />
        </IconButton>
        <IconButton size={20} title={t('删除这一步')} onClick={onRemove}>
          <Trash2 size={11} />
        </IconButton>
      </div>
      <div className="space-y-1 p-1.5">
        <TextInput value={value.note} onChange={(note) => onChange({ note })} placeholder={t('这一步在干什么（可选）')} className="h-6 text-[11px]" data-user-text />
        <textarea
          ref={areaRef}
          value={value.payloadText}
          onChange={(e) => onChange({ payloadText: e.target.value })}
          spellCheck={false}
          data-user-text
          rows={Math.min(12, Math.max(3, value.payloadText.split('\n').length))}
          className="border-ink-700 bg-ink-950/70 w-full rounded border p-1.5 font-mono text-[10.5px] leading-relaxed text-zinc-200 outline-none focus:border-accent/60"
        />
        {parseError && <p className="text-[10px] text-rose-400">{t('JSON 有问题：{msg}', { msg: parseError })}</p>}
        {def && (
          /* data-cmd-meta：这段是命令注册表里的描述，整份命令表目前只有中文（命令面板也一样），
             不属于这一步新增的界面文案，i18n 自检会把它单独计数 */
          <p data-cmd-meta className="text-[10px] leading-relaxed text-zinc-600">
            {def.description}
          </p>
        )}
        {params.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] text-zinc-600">{t('插入参数：')}</span>
            {params
              .filter((p) => p.key)
              .map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => insert(`{{${p.key}}}`)}
                  className="border-ink-600 bg-ink-800 rounded border px-1.5 py-0.5 font-mono text-[10px] text-cyan-300 hover:bg-ink-700"
                  title={t('点击插入到光标位置')}
                >
                  {`{{${p.key}}}`}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- 编辑器 */

/**
 * 新建 / 编辑一条自定义命令。
 *
 * 调用点用 `key` 绑在 id 上，换一条宏就整块重挂 —— 表单状态直接从 store 里的那份初始化，
 * 不需要 useEffect 同步（那种同步最容易出现「打开 A 显示的是上次 B 的内容」）。
 */
export function CustomCommandEditor() {
  const target = useEditor((s) => s.ui.customEditorFor);
  const list = useEditor((s) => s.runtime.customCommands);
  const existing = useMemo(() => (target && target !== 'new' ? list.find((c) => c.id === target) : undefined), [target, list]);

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [params, setParams] = useState<ParamDraft[]>(existing ? existing.params.map(toParamDraft) : []);
  const [steps, setSteps] = useState<StepDraft[]>(existing ? existing.steps.map(toStepDraft) : []);
  const [issues, setIssues] = useState<CustomIssue[]>([]);
  const [warnings, setWarnings] = useState<CustomIssue[]>([]);
  const [busy, setBusy] = useState(false);

  const groups = useMemo(() => {
    const out: { category: string; types: { type: string; label: string }[] }[] = [];
    for (const [category, defs] of listByCategory()) {
      const types = defs
        .filter((d) => !forbiddenReason(d.type))
        .map((d) => ({ type: d.type, label: `${d.type} · ${d.description.slice(0, 26)}` }));
      if (types.length) out.push({ category, types });
    }
    return out;
  }, []);

  if (!target) return null;
  const close = () => updateUi((ui) => { ui.customEditorFor = null; });

  const save = async () => {
    /* payload 的 JSON 先就地解析：文本层面就不合法的话，没必要打扰命令层 */
    const payloads: Record<string, unknown>[] = [];
    for (let i = 0; i < steps.length; i += 1) {
      const raw = steps[i].payloadText.trim() || '{}';
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('必须是一个 JSON 对象'));
        payloads.push(parsed as Record<string, unknown>);
      } catch (err) {
        setIssues([{ path: t('第 {n} 步', { n: i + 1 }), message: t('payload 不是合法 JSON：{msg}', { msg: (err as Error).message }) }]);
        return;
      }
    }

    setBusy(true);
    const res = await exec<{ id: string; warnings: string[] }>('custom.define', {
      ...(existing ? { id: existing.id } : {}),
      name: name.trim() || t('未命名命令'),
      description: description.trim(),
      params: params
        .filter((p) => p.key.trim())
        .map((p) => ({
          key: p.key.trim(),
          ...(p.label.trim() ? { label: p.label.trim() } : {}),
          type: p.type,
          ...(p.defaultText.trim()
            ? {
                default:
                  p.type === 'number'
                    ? Number(p.defaultText) || 0
                    : p.type === 'boolean'
                      ? p.defaultText.trim() === 'true'
                      : p.defaultText,
              }
            : {}),
          ...(p.hint.trim() ? { hint: p.hint.trim() } : {}),
        })),
      steps: steps.map((s, i) => ({
        type: s.type,
        payload: payloads[i],
        ...(s.note.trim() ? { note: s.note.trim() } : {}),
      })),
    });
    setBusy(false);

    if (!res.ok) {
      const detail = res.error?.detail as { issues?: CustomIssue[]; warnings?: CustomIssue[] } | undefined;
      setIssues(detail?.issues?.length ? detail.issues : [{ path: t('保存失败'), message: res.error?.message ?? '' }]);
      setWarnings(detail?.warnings ?? []);
      return;
    }
    pushToast('success', t('已保存「{name}」', { name: name.trim() || t('未命名命令') }));
    const w = (res.data?.warnings ?? []).filter(Boolean);
    if (w.length) pushToast('warn', t('保存成功，但有一处要留意：{msg}', { msg: w[0] }));
    close();
  };

  const addStep = () => {
    const first = groups[0]?.types[0]?.type ?? 'layer.update';
    setSteps((s) => [...s, toStepDraft({ type: first, payload: {} })]);
  };

  return (
    <Modal
      title={existing ? t('编辑自定义命令') : t('新建自定义命令')}
      onClose={close}
      width={720}
      footer={
        <>
          {existing && (
            <span className="mr-auto text-[10px] text-zinc-600">
              {t('{n} 步 · 跑过 {r} 次', { n: existing.steps.length, r: existing.runCount })}
              {existing.author === 'ai' ? ` · ${t('AI 创建')}` : ` · ${t('我创建')}`}
            </span>
          )}
          <Button variant="ghost" onClick={close}>
            {t('取消')}
          </Button>
          <Button variant="accent" disabled={busy || steps.length === 0} onClick={() => void save()}>
            {busy ? t('保存中…') : t('保存')}
          </Button>
        </>
      }
    >
      <div data-testid="custom-dialog" className="space-y-3">
        <div className="grid grid-cols-[1fr_1fr] gap-2">
          <Field label={t('名称')}>
            <TextInput value={name} onChange={setName} placeholder={t('例如：做一张标题卡')} data-user-text />
          </Field>
          <Field label={t('描述（给人和 AI 看）')}>
            <TextInput value={description} onChange={setDescription} placeholder={t('这条命令做什么')} data-user-text />
          </Field>
        </div>

        {/* 参数 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">{t('参数（最多 8 个）')}</span>
            <Button size="sm" variant="ghost" onClick={() => setParams((ps) => [...ps, { key: '', label: '', type: 'string', defaultText: '', hint: '' }])}>
              <Plus size={11} /> {t('加参数')}
            </Button>
          </div>
          {params.length === 0 && (
            <p className="text-[10.5px] leading-relaxed text-zinc-600">
              {t('没有参数时，运行就是点一下。需要「每次填不同的值」再加参数，步骤里写 {{key}} 引用。')}
            </p>
          )}
          {params.map((p, i) => (
            <ParamRow
              key={i}
              value={p}
              onChange={(patch) => setParams((ps) => ps.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
              onRemove={() => setParams((ps) => ps.filter((_, j) => j !== i))}
            />
          ))}
        </div>

        {/* 步骤 */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">{t('步骤（按顺序执行，最多 30 步）')}</span>
            <div className="flex items-center gap-1">
              {steps.length === 0 && (
                <Button size="sm" variant="outline" onClick={() => {
                  const s = starterDrafts();
                  setName(s.name);
                  setDescription(s.description);
                  setParams(s.params);
                  setSteps(s.steps);
                }}>
                  <Sparkles size={11} /> {t('从示例开始')}
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={addStep}>
                <Plus size={11} /> {t('加一步')}
              </Button>
            </div>
          </div>
          {steps.length === 0 && <p className="text-[10.5px] leading-relaxed text-zinc-600">{t('每一步就是一条已有命令。先挑命令，再改 payload。')}</p>}
          {steps.map((s, i) => (
            <StepCard
              key={s.id}
              index={i}
              total={steps.length}
              value={s}
              params={params}
              groups={groups}
              onChange={(patch) => setSteps((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
              onRemove={() => setSteps((xs) => xs.filter((_, j) => j !== i))}
              onMove={(delta) =>
                setSteps((xs) => {
                  const to = i + delta;
                  if (to < 0 || to >= xs.length) return xs;
                  const copy = [...xs];
                  const [moved] = copy.splice(i, 1);
                  copy.splice(to, 0, moved);
                  return copy;
                })
              }
            />
          ))}
        </div>

        {(issues.length > 0 || warnings.length > 0) && (
          <div className="space-y-1 rounded border border-rose-500/30 bg-rose-500/[0.07] p-2">
            {issues.map((i, k) => (
              <div key={`i${k}`} className="flex gap-1.5 text-[11px] text-rose-300">
                <AlertTriangle size={11} className="mt-[3px] shrink-0" />
                <span>
                  <b className="font-medium">{i.path}</b>：{i.message}
                </span>
              </div>
            ))}
            {warnings.map((i, k) => (
              <div key={`w${k}`} className="text-[10.5px] text-amber-300/80">
                {i.path}：{i.message}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- 运行 */

/** 参数表单：类型 → 控件。没有参数的命令不会走到这里（面板会直接跑） */
function ParamField({ param, value, onChange }: { param: CustomCommandParam; value: string | number | boolean; onChange: (v: string | number | boolean) => void }) {
  const label = param.label || param.key;
  const layers = useEditor((s) => s.project.layers);
  if (param.type === 'boolean') return <Toggle value={!!value} onChange={onChange} label={label} />;
  if (param.type === 'number') {
    return (
      <Field label={label} hint={param.hint}>
        <NumberInput value={Number(value) || 0} onCommit={(n) => onChange(n)} min={param.min} max={param.max} step={param.step} />
      </Field>
    );
  }
  if (param.type === 'color') {
    return (
      <Field label={label} hint={param.hint}>
        <ColorInput value={String(value)} onChange={onChange} />
      </Field>
    );
  }
  if (param.type === 'layerId') {
    const options = layers.filter((l: Layer) => l.type !== 'background');
    return (
      <Field label={label} hint={param.hint}>
        <select className={selectCls} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('选一个图层…')}</option>
          {options.map((l: Layer) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <Field label={label} hint={param.hint}>
      <TextInput value={String(value)} onChange={onChange} />
    </Field>
  );
}

export function CustomRunDialog() {
  const target = useEditor((s) => s.ui.customRunFor);
  const list = useEditor((s) => s.runtime.customCommands);
  const cmd = useMemo(() => (target ? list.find((c) => c.id === target) : undefined), [target, list]);
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const [busy, setBusy] = useState(false);

  if (!target) return null;
  if (!cmd) return null;
  const close = () => updateUi((ui) => { ui.customRunFor = null; });
  const valueOf = (p: CustomCommandParam) => (values[p.key] !== undefined ? values[p.key] : paramDefault(p));

  const run = async () => {
    setBusy(true);
    const res = await exec('custom.run', { id: cmd.id, params: values });
    setBusy(false);
    if (!res.ok) {
      pushToast('error', res.error?.message ?? t('执行失败'));
      return;
    }
    pushToast('success', t('「{name}」执行完成', { name: cmd.name }));
    close();
  };

  return (
    <Modal
      title={t('运行「{name}」', { name: cmd.name })}
      onClose={close}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('取消')}
          </Button>
          <Button variant="accent" disabled={busy} onClick={() => void run()}>
            <Play size={11} /> {busy ? t('执行中…') : t('运行')}
          </Button>
        </>
      }
    >
      <div data-testid="custom-run-dialog" className="space-y-2.5">
        {cmd.description && <p className="text-[11px] leading-relaxed text-zinc-500" data-user-text>{cmd.description}</p>}
        {cmd.params.map((p) => (
          <ParamField key={p.key} param={p} value={valueOf(p)} onChange={(v) => setValues((s) => ({ ...s, [p.key]: v }))} />
        ))}
        <p className="text-[10px] leading-relaxed text-zinc-600">
          {t('{n} 步会作为一次原子操作执行：任何一步失败，前面改的全部回滚。', { n: cmd.steps.length })}
        </p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------- 面板里的小卡片 */
