import { z } from 'zod';
import { defineCommand, CommandFailure, getCommand } from '../registry';
import {
  MAX_NAME,
  MAX_PARAMS,
  MAX_STEPS,
  expandSteps,
  resolveParams,
  validateCustomCommand,
  type ParamValues,
} from '../customCommands';
import { uid } from '../ids';
import type { CustomCommand, CustomCommandParam, CustomCommandStep, RuntimeState } from '../types';

const zParamType = z.enum(['number', 'string', 'boolean', 'color', 'layerId']);

const zParam = z.object({
  key: z.string().min(1).max(40),
  label: z.string().max(40).optional(),
  type: zParamType.default('string'),
  default: z.union([z.string().max(400), z.number(), z.boolean()]).optional(),
  hint: z.string().max(160).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});

const zStep = z.object({
  type: z.string().min(1).max(64),
  payload: z.record(z.string(), z.unknown()).default({}),
  note: z.string().max(120).optional(),
});

/** 一次宏最多 30 步，每步 payload 大小也该有个上限（防止塞进来几百 KB 的代码） */
const MAX_PAYLOAD_CHARS = 40_000;

function authorOf(source: string): 'user' | 'ai' {
  return source === 'user' || source === 'window' ? 'user' : 'ai';
}

/** 缓存里换一条；列表按「最近改过」排，界面不必自己再排 */
function putInCache(rt: RuntimeState, cmd: CustomCommand): void {
  const rest = rt.customCommands.filter((c) => c.id !== cmd.id);
  rt.customCommands = [cmd, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
}

function stepsFrom(input: { type: string; payload?: Record<string, unknown>; note?: string }[]): CustomCommandStep[] {
  return input.map((s) => ({
    id: uid('st'),
    type: s.type,
    payload: s.payload ?? {},
    ...(s.note ? { note: s.note } : {}),
  }));
}

export const customCommands = [
  defineCommand({
    type: 'custom.list',
    category: '自定义',
    mutating: false,
    undoable: false,
    description:
      '列出自定义命令（用户或 AI 保存的宏）：名字、描述、参数、每一步调用的命令。运行时用 id。',
    schema: z.object({ query: z.string().max(80).optional() }),
    example: {},
    handler: async (_draft, payload, ctx) => {
      const all = await ctx.services.listCustomCommands();
      const q = payload.query?.trim().toLowerCase() ?? '';
      const list = q
        ? all.filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
        : all;
      const commands = list
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((c) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          author: c.author,
          steps: c.steps.length,
          params: c.params.map((p) => ({ key: p.key, type: p.type, label: p.label, default: p.default })),
          commands: [...new Set(c.steps.map((s) => s.type))],
          runCount: c.runCount,
          lastError: c.lastError,
        }));
      return { count: commands.length, total: all.length, commands };
    },
  }),

  defineCommand({
    type: 'custom.define',
    category: '自定义',
    mutating: false,
    undoable: false,
    asyncHandler: true,
    description:
      '创建或更新一条自定义命令（宏）。步骤里每一步就是一条注册表命令；payload 里可以用 {{param}} 引用参数，整个值就是一个占位符时保留数字/布尔类型。存之前会校验命令是否存在、payload 是否符合该命令的 schema。不传 id 是新建，传 id 是覆盖（保留运行次数）。',
    schema: z.object({
      id: z.string().min(1).max(64).optional(),
      name: z.string().min(1).max(MAX_NAME),
      description: z.string().max(400).default(''),
      params: z.array(zParam).max(MAX_PARAMS).default([]),
      steps: z.array(zStep).min(1).max(MAX_STEPS),
    }),
    example: {
      name: '做一张标题卡',
      description: '在当前画布上叠标题 + 副标题两层文字',
      params: [
        { key: 'title', label: '标题', type: 'string', default: '新品发布' },
        { key: 'sub', label: '副标题', type: 'string', default: '2026 春季' },
      ],
      steps: [
        {
          type: 'layer.create',
          payload: {
            type: 'text',
            name: '标题',
            text: '{{title}}',
            x: 120,
            y: 180,
            width: 840,
            height: 200,
            textStyle: { fontSize: 96, color: '#ffffff' },
          },
          note: '建标题层',
        },
        {
          type: 'layer.create',
          payload: {
            type: 'text',
            name: '副标题',
            text: '{{sub}}',
            x: 120,
            y: 400,
            width: 840,
            height: 120,
            textStyle: { fontSize: 40, color: '#9aa4b2' },
          },
          note: '建副标题层',
        },
      ],
    },
    handler: async (_draft, payload, ctx) => {
      const size = JSON.stringify(payload.steps).length;
      if (size > MAX_PAYLOAD_CHARS) {
        throw new CommandFailure('VALIDATION', `步骤内容太大（${Math.round(size / 1024)}KB），上限 ${MAX_PAYLOAD_CHARS / 1000}KB`);
      }

      const existing = payload.id ? (await ctx.services.listCustomCommands()).find((c) => c.id === payload.id) : undefined;
      if (payload.id && !existing) throw new CommandFailure('NOT_FOUND', `自定义命令不存在：${payload.id}`);

      const now = Date.now();
      const cmd: CustomCommand = {
        id: existing?.id ?? uid('cc'),
        name: payload.name.trim(),
        description: payload.description.trim(),
        params: payload.params as CustomCommandParam[],
        steps: stepsFrom(payload.steps),
        author: existing?.author ?? authorOf(ctx.source),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        runCount: existing?.runCount ?? 0,
        ...(existing?.lastRunAt ? { lastRunAt: existing.lastRunAt } : {}),
        ...(existing?.lastError ? { lastError: existing.lastError } : {}),
      };

      const { issues, warnings } = validateCustomCommand(cmd, getCommand);
      if (issues.length) {
        throw new CommandFailure('VALIDATION', issues.map((i) => `${i.path}：${i.message}`).join('；'), {
          issues,
          warnings,
        });
      }

      if (!ctx.dryRun) {
        await ctx.services.saveCustomCommand(cmd);
        ctx.runtime((rt) => {
          putInCache(rt, cmd);
          rt.customCommandsLoaded = true;
        });
      }
      return {
        id: cmd.id,
        created: !existing,
        name: cmd.name,
        steps: cmd.steps.length,
        params: cmd.params.length,
        author: cmd.author,
        warnings: warnings.map((w) => `${w.path}：${w.message}`),
      };
    },
  }),

  defineCommand({
    type: 'custom.remove',
    category: '自定义',
    mutating: false,
    undoable: false,
    dangerous: true,
    asyncHandler: true,
    description: '删除一条自定义命令（只删命令，不影响已经做过的画布改动）。',
    schema: z.object({ id: z.string().min(1).max(64) }),
    example: { id: 'cc_xxx' },
    handler: async (_draft, payload, ctx) => {
      const all = await ctx.services.listCustomCommands();
      const hit = all.find((c) => c.id === payload.id);
      if (!hit) throw new CommandFailure('NOT_FOUND', `自定义命令不存在：${payload.id}`);
      if (!ctx.dryRun) {
        await ctx.services.removeCustomCommand(payload.id);
        ctx.runtime((rt) => {
          rt.customCommands = rt.customCommands.filter((c) => c.id !== payload.id);
        });
      }
      return { id: payload.id, name: hit.name, remaining: all.length - 1 };
    },
  }),

  defineCommand({
    type: 'custom.run',
    category: '自定义',
    mutating: false,
    undoable: false,
    asyncHandler: true,
    description:
      '执行一条自定义命令：按参数填好占位符后，把步骤作为一次原子批处理执行 —— 全部成功才落盘，失败回滚，合并成一个撤销点。没有参数的宏可以直接调。',
    schema: z.object({
      id: z.string().min(1).max(64),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    }),
    example: { id: 'cc_xxx', params: { title: '新品发布' } },
    handler: async (_draft, payload, ctx) => {
      const all = await ctx.services.listCustomCommands();
      const cmd = all.find((c) => c.id === payload.id);
      if (!cmd) throw new CommandFailure('NOT_FOUND', `自定义命令不存在：${payload.id}`);

      const resolved = resolveParams(cmd, (payload.params ?? {}) as ParamValues);
      if (!resolved.ok) throw new CommandFailure('VALIDATION', resolved.errors.join('；'));

      let expanded: { steps: { type: string; payload: Record<string, unknown> }[]; warnings: string[] };
      try {
        expanded = expandSteps(cmd, resolved.values, getCommand);
      } catch (err) {
        throw new CommandFailure('VALIDATION', (err as Error).message);
      }

      /* 试算只回报「如果跑会跑什么」，不执行 —— AI 的 dryRun 必须真的什么都不改 */
      if (ctx.dryRun) {
        return { id: cmd.id, name: cmd.name, dryRun: true, steps: expanded.steps, warnings: expanded.warnings };
      }

      const outcome = await ctx.services.runSteps(expanded.steps);
      const now = Date.now();
      const failedAt = outcome.results.findIndex((r) => !r.ok);
      const errorText = outcome.ok ? '' : `${cmd.steps[Math.max(0, failedAt)].note || cmd.steps[Math.max(0, failedAt)].type}：${outcome.results[Math.max(0, failedAt)]?.error?.message ?? '执行失败'}`;

      const next: CustomCommand = {
        ...cmd,
        runCount: cmd.runCount + (outcome.ok ? 1 : 0),
        updatedAt: cmd.updatedAt,
        ...(outcome.ok ? { lastRunAt: now, lastError: undefined } : { lastError: errorText }),
      };
      /* 运行记录也落库：刷新之后还能看到「上次跑挂了，因为…」 */
      await ctx.services.saveCustomCommand(next);
      ctx.runtime((rt) => putInCache(rt, next));

      if (!outcome.ok) {
        throw new CommandFailure('RUNTIME', errorText, {
          id: cmd.id,
          failedAt: Math.max(0, failedAt),
          rolledBack: true,
          results: outcome.results,
        });
      }
      return {
        id: cmd.id,
        name: cmd.name,
        steps: expanded.steps.length,
        warnings: expanded.warnings,
        results: outcome.results.map((r) => ({ type: r.type, ok: r.ok })),
      };
    },
  }),
];
