import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import {
  getCommand,
  CommandFailure,
  type Command,
  type CommandContext,
  type CommandError,
  type CommandResult,
  type CommandSource,
} from './registry';
import { enforceInvariants } from './commands/_helpers';
import { canCoalesce, mergeEntry, type HistoryEntry } from './temporal';
import { useEditor, updateRuntime, updateUi, pushToast } from './store';
import { getServices } from './services';
import type { Project, RuntimeState, UiState } from './types';
import { commandId as newCommandId } from './ids';

enablePatches();

let broadcastHandler: (() => void) | null = null;

/** 由 Host 窗口管理器注入：命令提交后广播快照（节流 50ms 在 host 内实现） */
export function setBroadcastHandler(fn: () => void): void {
  broadcastHandler = fn;
}

/* -------------------------------------------------------------- 串行队列 */

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/* ------------------------------------------------------------------ 入口 */

export interface DispatchOptions {
  source?: CommandSource;
  dryRun?: boolean;
  expectedVersion?: number;
  id?: string;
}

export function dispatch<T = unknown>(
  type: string,
  payload: unknown = {},
  opts: DispatchOptions = {},
): Promise<CommandResult<T>> {
  const def = getCommand(type);
  const source = opts.source ?? 'user';
  if (!def) {
    return Promise.resolve({
      ok: false,
      commandId: opts.id ?? newCommandId(),
      type,
      error: { code: 'NOT_FOUND', message: `未知命令：${type}` },
      projectVersion: useEditor.getState().project.version,
      durationMs: 0,
      dryRun: !!opts.dryRun,
    });
  }
  const command: Command = {
    id: opts.id ?? newCommandId(),
    type,
    payload,
    source,
    ts: Date.now(),
    dryRun: opts.dryRun,
    expectedVersion: opts.expectedVersion,
  };
  // mutating 命令严格串行；只读命令可以立即执行（导出不会被队列阻塞）
  if (def.mutating && !opts.dryRun) {
    return enqueue(() => runCommand<T>(command));
  }
  return runCommand<T>(command);
}

/** UI 侧简写 */
export function exec<T = unknown>(type: string, payload: unknown = {}): Promise<CommandResult<T>> {
  return dispatch<T>(type, payload, { source: 'user' });
}

/* ---------------------------------------------------------------- 主流程 */

async function runCommand<T>(command: Command): Promise<CommandResult<T>> {
  const started = performance.now();
  const def = getCommand(command.type);
  const state = useEditor.getState();
  const version = state.project.version;

  const fail = (error: CommandError): CommandResult<T> => {
    const durationMs = Math.round(performance.now() - started);
    recordAudit(command, false, durationMs, error.message);
    return {
      ok: false,
      commandId: command.id,
      type: command.type,
      error,
      projectVersion: useEditor.getState().project.version,
      durationMs,
      dryRun: !!command.dryRun,
    };
  };

  if (!def) return fail({ code: 'NOT_FOUND', message: `未知命令：${command.type}` });

  if (def.sources && !def.sources.includes(command.source)) {
    return fail({ code: 'FORBIDDEN', message: `命令 ${def.type} 不允许来源 ${command.source} 调用` });
  }

  if (command.expectedVersion !== undefined && command.expectedVersion !== state.project.version) {
    return fail({
      code: 'CONFLICT',
      message: `版本冲突：期望 v${command.expectedVersion}，当前 v${state.project.version}。请重新读取项目后再试。`,
    });
  }

  const parsed = def.schema.safeParse(command.payload ?? {});
  if (!parsed.success) {
    return fail({
      code: 'VALIDATION',
      message: `参数校验失败：${parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => `${i.path.join('.') || '(root)'} ${i.message}`).join('；')}`,
      detail: parsed.error.issues,
    });
  }

  // 历史栈类命令由总线直接处理
  if (def.busAction === 'undo') {
    const steps = Number((parsed.data as { steps?: number }).steps ?? 1);
    return finishBusAction(command, started, performUndo(steps));
  }
  if (def.busAction === 'redo') {
    const steps = Number((parsed.data as { steps?: number }).steps ?? 1);
    return finishBusAction(command, started, performRedo(steps));
  }
  if (def.type === 'history.clear') {
    useEditor.setState({ past: [], future: [] });
    return finishBusAction(command, started, { cleared: true });
  }
  if (def.busAction === 'batch') {
    return runBatch<T>(command, parsed.data as BatchPayload, started);
  }

  // 只读命令：不进入 immer，不产生 patch
  if (!def.mutating) {
    if (command.dryRun && def.category === '导出') {
      return {
        ok: true,
        commandId: command.id,
        type: command.type,
        data: { skipped: true, reason: 'dryRun 下不执行导出' } as unknown as T,
        projectVersion: version,
        durationMs: Math.round(performance.now() - started),
        dryRun: true,
      };
    }
    const uiOps: UiOp[] = [];
    const rtOps: RuntimeOp[] = [];
    const ctx = makeContext(command, state.project, state.runtime.playhead, uiOps, rtOps);
    try {
      const data = await def.handler(state.project, parsed.data, ctx);
      applyEffects(uiOps, rtOps);
      const durationMs = Math.round(performance.now() - started);
      recordAudit(command, true, durationMs);
      return {
        ok: true,
        commandId: command.id,
        type: command.type,
        data: data as T,
        projectVersion: version,
        durationMs,
        dryRun: !!command.dryRun,
      };
    } catch (err) {
      applyEffects(uiOps, rtOps);
      return fail(toCommandError(err));
    }
  }

  /* -------- mutating -------- */
  const uiOps: UiOp[] = [];
  const rtOps: RuntimeOp[] = [];
  const ctx = makeContext(command, state.project, state.runtime.playhead, uiOps, rtOps);

  let nextProject: Project | null = null;
  let patches: Patch[] = [];
  let inverse: Patch[] = [];
  let data: unknown;

  try {
    if (def.asyncHandler) {
      // 异步 handler：先在纯克隆上完成 IO + 修改，再整树替换提交
      const staging = JSON.parse(JSON.stringify(state.project)) as Project;
      data = await def.handler(staging, parsed.data, ctx);
      enforceInvariants(staging);
      nextProject = staging;
      patches = [{ op: 'replace', path: [], value: staging }];
      inverse = [{ op: 'replace', path: [], value: state.project }];
    } else {
      const [result, producedPatches, inversePatches] = produceWithPatches(state.project, (draft) => {
        const maybe = def.handler(draft as unknown as Project, parsed.data, ctx);
        if (maybe && typeof (maybe as Promise<unknown>).then === 'function') {
          throw new CommandFailure('RUNTIME', `${def.type} 的 handler 返回了 Promise，但未标记 asyncHandler`);
        }
        data = maybe;
        // 不变量必须在 producer 内部、对 draft 执行：
        // 1) produceWithPatches 的结果默认被 immer 冻结，在外面赋值会抛
        //    "Cannot assign to read only property"；
        // 2) 放在里面，修正动作才能被 patches 捕获，撤销时才还原得回去。
        enforceInvariants(draft as Project);
      });
      nextProject = result as Project;
      patches = producedPatches as Patch[];
      inverse = inversePatches as Patch[];
    }
  } catch (err) {
    return fail(toCommandError(err));
  }

  if (command.dryRun) {
    const durationMs = Math.round(performance.now() - started);
    recordAudit(command, true, durationMs, 'dryRun');
    return {
      ok: true,
      commandId: command.id,
      type: command.type,
      data: data as T,
      projectVersion: version,
      durationMs,
      dryRun: true,
    };
  }

  const committed: Project = {
    ...(nextProject as Project),
    version: version + 1,
    updatedAt: Date.now(),
  };

  const entry: HistoryEntry = {
    id: `h_${command.id}`,
    commandId: command.id,
    type: command.type,
    label: def.type,
    source: command.source,
    patches,
    inverse,
    ts: Date.now(),
    coalesceKey: def.coalesce ? `${def.type}:${(parsed.data as { id?: string })?.id ?? ''}` : undefined,
  };

  const current = useEditor.getState();
  const last = current.past[current.past.length - 1];
  let past: HistoryEntry[];
  if (def.undoable !== false && canCoalesce(last, entry)) {
    past = [...current.past.slice(0, -1), mergeEntry(last as HistoryEntry, entry)];
  } else if (def.undoable === false) {
    past = current.past;
  } else {
    past = [...current.past, entry].slice(-120);
  }

  useEditor.setState({
    project: committed,
    past,
    future: def.undoable === false ? current.future : [],
  });

  applyEffects(uiOps, rtOps);
  if (def.resetsHistory) useEditor.setState({ past: [], future: [] });
  broadcastHandler?.();

  const durationMs = Math.round(performance.now() - started);
  recordAudit(command, true, durationMs);
  return {
    ok: true,
    commandId: command.id,
    type: command.type,
    data: data as T,
    projectVersion: committed.version,
    durationMs,
    dryRun: false,
  };
}

/* ------------------------------------------------------------------ 撤销 */

function performUndo(steps: number): { undone: number; label: string | null } {
  const state = useEditor.getState();
  let project = state.project;
  let past = [...state.past];
  const future = [...state.future];
  let undone = 0;
  let label: string | null = null;
  for (let i = 0; i < steps; i++) {
    const entry = past[past.length - 1];
    if (!entry) break;
    project = applyPatches(project, entry.inverse);
    past = past.slice(0, -1);
    future.unshift(entry);
    undone += 1;
    label = entry.type;
  }
  if (undone === 0) return { undone: 0, label: null };
  useEditor.setState({
    project: { ...project, version: state.project.version + 1, updatedAt: Date.now() },
    past,
    future: future.slice(0, 120),
  });
  broadcastHandler?.();
  return { undone, label };
}

function performRedo(steps: number): { redone: number; label: string | null } {
  const state = useEditor.getState();
  let project = state.project;
  const past = [...state.past];
  let future = [...state.future];
  let redone = 0;
  let label: string | null = null;
  for (let i = 0; i < steps; i++) {
    const entry = future[0];
    if (!entry) break;
    project = applyPatches(project, entry.patches);
    future = future.slice(1);
    past.push(entry);
    redone += 1;
    label = entry.type;
  }
  if (redone === 0) return { redone: 0, label: null };
  useEditor.setState({
    project: { ...project, version: state.project.version + 1, updatedAt: Date.now() },
    past: past.slice(-120),
    future,
  });
  broadcastHandler?.();
  return { redone, label };
}

/* ---------------------------------------------------------------- 批处理 */

interface BatchPayload {
  commands: { type: string; payload?: unknown }[];
  atomic: boolean;
}

async function runBatch<T>(command: Command, payload: BatchPayload, started: number): Promise<CommandResult<T>> {
  const beforeVersion = useEditor.getState().project.version;
  const beforePastLen = useEditor.getState().past.length;
  const results: CommandResult[] = [];
  let failed = false;

  for (const item of payload.commands) {
    const result = await runCommand<unknown>({
      id: newCommandId(),
      type: item.type,
      payload: item.payload ?? {},
      source: command.source,
      ts: Date.now(),
      dryRun: command.dryRun,
    });
    results.push(result);
    if (!result.ok) {
      failed = true;
      break;
    }
  }

  if (failed && payload.atomic) {
    // 回滚本批次已提交的变更：连同失败命令未提交的部分一起恢复
    const applied = useEditor.getState().past.length - beforePastLen;
    if (applied > 0) performUndo(applied);
  }

  // 合并成一个撤销点
  if (!failed && payload.atomic) {
    const state = useEditor.getState();
    const added = state.past.slice(beforePastLen);
    if (added.length > 1) {
      const merged: HistoryEntry = {
        id: `h_batch_${command.id}`,
        commandId: command.id,
        type: 'command.batch',
        label: `批量 ${added.length} 条`,
        source: command.source,
        patches: added.flatMap((e) => e.patches),
        inverse: [...added].reverse().flatMap((e) => e.inverse),
        ts: Date.now(),
      };
      useEditor.setState({ past: [...state.past.slice(0, beforePastLen), merged] });
    }
  }

  const durationMs = Math.round(performance.now() - started);
  recordAudit(command, !failed, durationMs, failed ? '批处理中断' : undefined);
  return {
    ok: !failed,
    commandId: command.id,
    type: command.type,
    data: { results, atomic: payload.atomic, rolledBack: failed && payload.atomic } as unknown as T,
    error: failed ? results.find((r) => !r.ok)?.error : undefined,
    projectVersion: useEditor.getState().project.version,
    durationMs,
    dryRun: !!command.dryRun,
  };
}

/* ------------------------------------------------------------------ 工具 */

type UiOp = (ui: UiState) => void;
type RuntimeOp = (rt: RuntimeState) => void;

function makeContext(
  command: Command,
  project: Project,
  playhead: number,
  uiOps: UiOp[],
  rtOps: RuntimeOp[],
): CommandContext {
  return {
    source: command.source,
    commandId: command.id,
    before: project,
    playhead,
    ui: (fn) => uiOps.push(fn),
    runtime: (fn) => rtOps.push(fn),
    services: getServices(),
  };
}

function applyEffects(uiOps: UiOp[], rtOps: RuntimeOp[]): void {
  if (uiOps.length) {
    updateUi((ui) => {
      for (const fn of uiOps) fn(ui);
    });
  }
  if (rtOps.length) {
    updateRuntime((rt) => {
      for (const fn of rtOps) fn(rt);
    });
  }
}

function toCommandError(err: unknown): CommandError {
  if (err instanceof CommandFailure) {
    return { code: err.code, message: err.message, detail: err.detail };
  }
  const e = err as Error;
  return { code: 'RUNTIME', message: e?.message ? e.message : String(err) };
}

function recordAudit(command: Command, ok: boolean, durationMs: number, error?: string): void {
  const state = useEditor.getState();
  const entry = {
    id: command.id,
    ts: Date.now(),
    type: command.type,
    source: command.source,
    ok,
    durationMs,
    label: command.type,
    error,
    projectVersion: state.project.version,
  };
  useEditor.setState({ audit: [...state.audit.slice(-199), entry] });
  if (!ok && error) {
    // 错误同时进 toast，AI 通道的错误由 AI 面板自行展示
    if (command.source === 'user') pushToast('error', error, 5200);
  }
}

function finishBusAction<T>(command: Command, started: number, data: unknown): CommandResult<T> {
  const durationMs = Math.round(performance.now() - started);
  recordAudit(command, true, durationMs);
  return {
    ok: true,
    commandId: command.id,
    type: command.type,
    data: data as T,
    projectVersion: useEditor.getState().project.version,
    durationMs,
    dryRun: !!command.dryRun,
  };
}
