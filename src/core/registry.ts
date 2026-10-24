import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Project, RuntimeState, UiState } from './types';
import type { Services } from './services';

export type CommandSource = 'user' | 'ai' | 'agent' | 'window';

export const COMMAND_SOURCES: CommandSource[] = ['user', 'ai', 'agent', 'window'];

export interface Command<P = unknown> {
  id: string;
  type: string;
  payload: P;
  source: CommandSource;
  ts: number;
  dryRun?: boolean;
  expectedVersion?: number;
}

export interface CommandError {
  code: 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'INVARIANT' | 'RUNTIME' | 'ABORTED';
  message: string;
  detail?: unknown;
}

export interface CommandResult<T = unknown> {
  ok: boolean;
  commandId: string;
  type: string;
  data?: T;
  error?: CommandError;
  projectVersion: number;
  durationMs: number;
  dryRun: boolean;
}

export interface CommandContext {
  source: CommandSource;
  commandId: string;
  /** 提交到 UI store 的副作用（不进撤销栈） */
  ui: (fn: (ui: UiState) => void) => void;
  /** 运行时状态（播放头/播放中），同样不进撤销栈 */
  runtime: (fn: (rt: RuntimeState) => void) => void;
  services: Services;
  /** 执行前的项目快照（只读），用于 handler 内的跨图层计算 */
  before: Project;
  /** 执行瞬间的播放头（毫秒） */
  playhead: number;
}

export type CommandHandler<P> = (
  draft: Project,
  payload: P,
  ctx: CommandContext,
) => unknown | Promise<unknown>;

export type CommandCategory =
  | '项目'
  | '画布'
  | '图层'
  | '文本'
  | '代码'
  | '背景'
  | '资源'
  | '字体'
  | '时间轴'
  | '选择'
  | '历史'
  | '窗口'
  | '导出'
  | '查询'
  | '系统';

export interface CommandDef<S extends z.ZodTypeAny = z.ZodTypeAny> {
  type: string;
  schema: S;
  description: string;
  example: z.input<S>;
  category: CommandCategory;
  mutating: boolean;
  /** 默认等于 mutating；历史/选择类命令置 false */
  undoable?: boolean;
  dangerous?: boolean;
  sources?: CommandSource[];
  /** 由总线特殊处理的命令（撤销/重做/批处理） */
  busAction?: 'undo' | 'redo' | 'batch';
  /** 执行后清空撤销栈（新建/载入项目） */
  resetsHistory?: boolean;
  /** handler 是 async（需要先做 IO 再改文档）：总线会用整树替换方式提交 */
  asyncHandler?: boolean;
  /** 连续同类操作合并为一个撤销点（滑块类命令） */
  coalesce?: boolean;
  handler: CommandHandler<z.infer<S>>;
}

/** 注册表内部统一用宽松类型：各命令的 schema 具体类型在注册时就已经校验过 */
export type AnyCommandDef = CommandDef<any>;

export class CommandFailure extends Error {
  code: CommandError['code'];
  detail?: unknown;
  constructor(code: CommandError['code'], message: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

const registry = new Map<string, AnyCommandDef>();

/** 只做定义与类型收敛，不产生副作用；注册统一由 registerAllCommands 完成 */
export function defineCommand<S extends z.ZodTypeAny>(def: CommandDef<S>): CommandDef<S> {
  return def;
}

export function clearRegistry(): void {
  registry.clear();
}

export function registerCommands(defs: AnyCommandDef[]): void {
  for (const def of defs) {
    if (registry.has(def.type)) throw new Error(`命令重复注册：${def.type}`);
    registry.set(def.type, def);
  }
}

export function getCommand(type: string): AnyCommandDef | undefined {
  return registry.get(type);
}

export function listCommands(): AnyCommandDef[] {
  return [...registry.values()].sort((a, b) => a.category.localeCompare(b.category, 'zh') || a.type.localeCompare(b.type));
}

export function listByCategory(): Map<CommandCategory, AnyCommandDef[]> {
  const map = new Map<CommandCategory, AnyCommandDef[]>();
  for (const def of listCommands()) {
    const arr = map.get(def.category) ?? [];
    arr.push(def);
    map.set(def.category, arr);
  }
  return map;
}

/* ------------------------------------------------- tool schema 单一数据源 */

/** OpenAI / MCP 的函数名只允许 [a-zA-Z0-9_-]，命令类型用 __ 替换点号 */
export function toToolName(type: string): string {
  return type.replace(/\./g, '__');
}

export function fromToolName(name: string): string {
  return name.replace(/__/g, '.');
}

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function buildToolSchemas(filter?: (def: CommandDef) => boolean): ToolSchema[] {
  return listCommands()
    .filter((def) => (filter ? filter(def) : true))
    .map((def) => {
      const json = zodToJsonSchema(def.schema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      }) as Record<string, unknown>;
      delete json.$schema;
      return {
        name: toToolName(def.type),
        description: `${def.description}\n命令类型：${def.type}${
          def.mutating ? '（会修改项目）' : '（只读）'
        }${def.dangerous ? '｜危险命令' : ''}\n示例 payload：${JSON.stringify(def.example)}`,
        inputSchema: json,
      };
    });
}

export interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export function buildOpenAITools(): OpenAITool[] {
  return buildToolSchemas().map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

/** 用于审计/UI 的命令目录摘要（不含函数体） */
export function describeRegistry() {
  return listCommands().map((def) => ({
    type: def.type,
    category: def.category,
    description: def.description,
    mutating: def.mutating,
    dangerous: !!def.dangerous,
    example: def.example,
  }));
}
