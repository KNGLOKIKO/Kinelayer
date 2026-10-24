import { z } from 'zod';
import { defineCommand, CommandFailure } from '../registry';

export const historyCommands = [
  defineCommand({
    type: 'history.undo',
    category: '历史',
    mutating: true,
    undoable: false,
    busAction: 'undo',
    description: '撤销最近一次可撤销的变更。可传 steps 连续撤销多步。',
    schema: z.object({ steps: z.number().int().min(1).max(50).default(1) }),
    example: { steps: 1 },
    handler: () => {
      throw new CommandFailure('INVARIANT', 'history.undo 必须由命令总线处理');
    },
  }),

  defineCommand({
    type: 'history.redo',
    category: '历史',
    mutating: true,
    undoable: false,
    busAction: 'redo',
    description: '重做被撤销的变更。',
    schema: z.object({ steps: z.number().int().min(1).max(50).default(1) }),
    example: { steps: 1 },
    handler: () => {
      throw new CommandFailure('INVARIANT', 'history.redo 必须由命令总线处理');
    },
  }),

  defineCommand({
    type: 'history.clear',
    category: '历史',
    mutating: false,
    undoable: false,
    description: '清空撤销/重做栈（不修改项目）。',
    schema: z.object({}),
    example: {},
    handler: (_draft, _payload, ctx) => {
      ctx.ui(() => undefined);
      return { cleared: true };
    },
  }),
];
