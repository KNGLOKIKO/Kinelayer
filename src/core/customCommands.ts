/**
 * 自定义命令（宏）：数据模型之外的**纯逻辑**。
 *
 * 这里只做三件事，都不碰 store / IndexedDB / React：
 *   1. 校验一条宏能不能存（步骤命令存在吗、payload 过不过 schema、占位符声明了没有）
 *   2. 把参数填进 `{{占位符}}`，还原成可以直接喂给 command.batch 的步骤列表
 *   3. 说明哪些命令不能当步骤（递归、换文档、撤销栈）
 *
 * 校验放在「存之前」而不是「跑之前」是刻意的：跑的时候才发现第 3 步 payload 缺字段，
 * 用户已经点过运行了，体验上等于「保存成功但永远失败」。
 */
import type { AnyCommandDef } from './registry';
import type { CustomCommand, CustomCommandParam, CustomCommandStep } from './types';

export const MAX_STEPS = 30;
export const MAX_PARAMS = 8;
export const MAX_NAME = 40;

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const WHOLE_PLACEHOLDER = /^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/;

/**
 * 步骤里不许出现的命令。
 *
 * 判据只有一条：**它会不会让「一次宏 = 一次撤销点」这个前提失效**。
 *   · 批处理 / 宏嵌套 → 撤销点会套娃，失败回滚的边界说不清
 *   · 撤销栈操作   → 宏自己在宏里面撤销，等于自己拆自己的地板
 * 换文档（project.*）另外算一类：它清空历史，跑完一条宏画布全变了还撤不回来。
 */
const FORBIDDEN_STEP: Record<string, string> = {
  'command.batch': '批处理不能嵌套 —— 宏本身就是一次批处理',
  'custom.run': '宏不能调用宏（会无限递归）',
  'custom.define': '宏不能定义新宏',
  'custom.remove': '宏不能删除宏',
  'custom.list': '宏里没有读命令清单的理由',
  'history.undo': '撤销栈操作不能放进宏：一次宏本来就是一次撤销点',
  'history.redo': '撤销栈操作不能放进宏',
  'history.clear': '撤销栈操作不能放进宏',
};

const FORBIDDEN_PREFIX: Record<string, string> = {
  'project.': '宏只改画布内容，不换文档 —— 换文档会清掉撤销历史',
};

export function forbiddenReason(type: string): string | null {
  if (FORBIDDEN_STEP[type]) return FORBIDDEN_STEP[type];
  for (const [prefix, reason] of Object.entries(FORBIDDEN_PREFIX)) {
    if (type.startsWith(prefix)) return reason;
  }
  return null;
}

/* ------------------------------------------------------------------ 参数 */

export type ParamValues = Record<string, string | number | boolean>;

/** 参数在表单里的默认值（用户没填就用它） */
export function paramDefault(p: CustomCommandParam): string | number | boolean {
  if (p.default !== undefined) return p.default;
  switch (p.type) {
    case 'number':
      return p.min ?? 0;
    case 'boolean':
      return false;
    case 'color':
      return '#ffffff';
    case 'layerId':
      return '';
    default:
      return '';
  }
}

/**
 * 校验 payload 时用的假值。
 *
 * layerId 给 `ly_sample` 而不是空串：`zId` 有 min(1)，空串会让「这条宏其实没问题」
 * 被误判成 payload 不合规 —— 假值必须能过类型校验，才验得出真正的错。
 */
function dummyFor(p: CustomCommandParam): string | number | boolean {
  switch (p.type) {
    case 'number':
      return typeof p.default === 'number' ? p.default : (p.min ?? 0);
    case 'boolean':
      return typeof p.default === 'boolean' ? p.default : false;
    case 'color':
      return typeof p.default === 'string' && p.default ? p.default : '#ffffff';
    case 'layerId':
      return typeof p.default === 'string' && p.default ? p.default : 'ly_sample';
    default:
      return typeof p.default === 'string' && p.default ? p.default : 'sample';
  }
}

/** 把用户填的值按声明类型收一遍；收不动就返回错误说明 */
export function coerceParam(p: CustomCommandParam, raw: unknown): { value: string | number | boolean } | { error: string } {
  const label = p.label || p.key;
  switch (p.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
      if (!Number.isFinite(n)) return { error: `参数「${label}」要一个数字` };
      if (p.min !== undefined && n < p.min) return { error: `参数「${label}」不能小于 ${p.min}` };
      if (p.max !== undefined && n > p.max) return { error: `参数「${label}」不能大于 ${p.max}` };
      return { value: n };
    }
    case 'boolean':
      if (typeof raw === 'boolean') return { value: raw };
      return { value: String(raw) === 'true' || raw === 1 };
    default: {
      const s = String(raw ?? '');
      if (!s && p.default === undefined) return { error: `参数「${label}」不能为空` };
      return { value: s };
    }
  }
}

export function resolveParams(
  cmd: CustomCommand,
  input: ParamValues = {},
): { ok: true; values: ParamValues } | { ok: false; errors: string[] } {
  const values: ParamValues = {};
  const errors: string[] = [];
  for (const p of cmd.params) {
    const raw = input[p.key] !== undefined ? input[p.key] : paramDefault(p);
    const out = coerceParam(p, raw);
    if ('error' in out) errors.push(out.error);
    else values[p.key] = out.value;
  }
  return errors.length ? { ok: false, errors } : { ok: true, values };
}

/* -------------------------------------------------------------- 占位符替换 */

interface SubResult {
  value: unknown;
  /** 哪些路径是占位符填进去的（校验 payload 时对这些路径要宽容） */
  paths: string[];
}

/**
 * `{{x}}` 的两种语义，必须分开：
 *   · 整个字符串就是占位符（`"{{w}}"`）→ 保留原类型。写 `width: "{{w}}"` 传 800，
 *     拿到的必须是数字 800，不是字符串 "800" —— 否则 zod 直接拒收。
 *   · 嵌在字符串里（`"标题-{{n}}"`）→ 拼成字符串，这是人的直觉。
 */
function substitute(value: unknown, values: ParamValues, path: string): SubResult {
  if (typeof value === 'string') {
    const whole = WHOLE_PLACEHOLDER.exec(value.trim());
    if (whole) {
      const key = whole[1]!;
      return { value: values[key] ?? '', paths: [path] };
    }
    let touched = false;
    const out = value.replace(PLACEHOLDER, (_, key: string) => {
      touched = true;
      const v = values[key];
      return v === undefined ? '' : String(v);
    });
    return { value: out, paths: touched ? [path] : [] };
  }
  if (Array.isArray(value)) {
    const paths: string[] = [];
    const arr = value.map((item, i) => {
      const r = substitute(item, values, `${path}.${i}`);
      paths.push(...r.paths);
      return r.value;
    });
    return { value: arr, paths };
  }
  if (value && typeof value === 'object') {
    const paths: string[] = [];
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = substitute(v, values, path ? `${path}.${k}` : k);
      paths.push(...r.paths);
      out[k] = r.value;
    }
    return { value: out, paths };
  }
  return { value, paths: [] };
}

export function substitutePayload(
  payload: Record<string, unknown>,
  values: ParamValues,
): { payload: Record<string, unknown>; placeholderPaths: string[] } {
  const r = substitute(payload, values, '');
  return { payload: r.value as Record<string, unknown>, placeholderPaths: r.paths };
}

/** payload 里用到的所有占位符名字 */
export function placeholdersIn(payload: unknown, out = new Set<string>()): Set<string> {
  if (typeof payload === 'string') {
    PLACEHOLDER.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER.exec(payload))) out.add(m[1]!);
    return out;
  }
  if (Array.isArray(payload)) {
    for (const item of payload) placeholdersIn(item, out);
    return out;
  }
  if (payload && typeof payload === 'object') {
    for (const v of Object.values(payload as Record<string, unknown>)) placeholdersIn(v, out);
  }
  return out;
}

/* ------------------------------------------------------------------ 校验 */

export interface CustomIssue {
  path: string;
  message: string;
}

export type CommandLookup = (type: string) => AnyCommandDef | undefined;

/**
 * 存之前把能提前发现的问题全挑出来。
 *
 * issues = 必须改，否则不让存；warnings = 提醒但不拦（例如某个字段只能靠参数在运行时保证）。
 */
export function validateCustomCommand(cmd: CustomCommand, lookup: CommandLookup): { issues: CustomIssue[]; warnings: CustomIssue[] } {
  const issues: CustomIssue[] = [];
  const warnings: CustomIssue[] = [];

  if (!cmd.name.trim()) issues.push({ path: 'name', message: '给这条命令起个名字' });
  else if (cmd.name.trim().length > MAX_NAME) issues.push({ path: 'name', message: `名字不能超过 ${MAX_NAME} 个字` });

  if (cmd.params.length > MAX_PARAMS) issues.push({ path: 'params', message: `最多 ${MAX_PARAMS} 个参数` });
  const seen = new Set<string>();
  for (const p of cmd.params) {
    const label = p.label || p.key || '（未命名）';
    if (!IDENT.test(p.key)) issues.push({ path: `参数「${label}」`, message: '参数名只能用字母、数字、下划线，且不能以数字开头' });
    if (seen.has(p.key)) issues.push({ path: `参数「${label}」`, message: '参数名重复' });
    seen.add(p.key);
    if (p.type === 'number' && p.default !== undefined && typeof p.default !== 'number') {
      issues.push({ path: `参数「${label}」`, message: '数字参数的默认值必须是数字' });
    }
  }

  if (cmd.steps.length === 0) issues.push({ path: 'steps', message: '至少要有一步' });
  if (cmd.steps.length > MAX_STEPS) issues.push({ path: 'steps', message: `最多 ${MAX_STEPS} 步` });

  const values: ParamValues = {};
  for (const p of cmd.params) values[p.key] = dummyFor(p);

  cmd.steps.forEach((step, i) => {
    const where = `第 ${i + 1} 步`;
    const def = lookup(step.type);
    if (!def) {
      issues.push({ path: where, message: `注册表里没有命令「${step.type}」` });
      return;
    }
    const forbidden = forbiddenReason(step.type);
    if (forbidden) {
      issues.push({ path: where, message: forbidden });
      return;
    }

    const declared = new Set(cmd.params.map((p) => p.key));
    const used = placeholdersIn(step.payload);
    for (const key of used) {
      if (!declared.has(key)) issues.push({ path: where, message: `用了没声明的参数 {{${key}}}` });
    }

    const { payload, placeholderPaths } = substitutePayload(step.payload, values);
    const parsed = def.schema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const at = issue.path.join('.');
        const fromPlaceholder = placeholderPaths.some((p) => at === p || at.startsWith(`${p}.`));
        const message = `${issue.message}${at ? `（${at}）` : ''}`;
        if (fromPlaceholder) {
          /* 这个字段的值来自参数，静态度量不了，只能到运行时才知道 */
          warnings.push({ path: where, message: `${message} — 该字段由参数提供，运行时会再校验一次` });
        } else {
          issues.push({ path: where, message });
        }
      }
    }
  });

  return { issues, warnings };
}

/* ------------------------------------------------------------------ 展开 */

/**
 * 把一条宏 + 一组参数值 → 直接可以交给 command.batch 的步骤列表。
 *
 * 不在这里做 schema 校验：定义时已经验过一遍，运行时 batch 还会对每一步再验一次
 * （那是权威判定）。这里只负责「填值」和「缺参数就报错」。
 */
export function expandSteps(
  cmd: CustomCommand,
  values: ParamValues,
  lookup: CommandLookup,
): { steps: { type: string; payload: Record<string, unknown> }[]; warnings: string[] } {
  const warnings: string[] = [];
  const steps = cmd.steps.map((step: CustomCommandStep, i: number) => {
    if (!lookup(step.type)) throw new Error(`第 ${i + 1} 步的命令「${step.type}」已经不存在了`);
    const { payload } = substitutePayload(step.payload, values);
    const leftover = placeholdersIn(payload);
    if (leftover.size) warnings.push(`第 ${i + 1} 步有未替换的占位符：${[...leftover].join('、')}`);
    return { type: step.type, payload };
  });
  return { steps, warnings };
}
