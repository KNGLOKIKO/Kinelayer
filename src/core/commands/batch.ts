import { z } from 'zod';
import { defineCommand, CommandFailure } from '../registry';
import { COMMAND_SOURCES } from '../registry';

export const batchCommand = defineCommand({
  type: 'command.batch',
  category: '系统',
  mutating: true,
  busAction: 'batch',
  dangerous: true,
  description:
    '批量执行多条命令（最多 50 条）。atomic=true（默认）时全部成功才生效，失败会回滚已执行的部分，并合并为一个撤销点。',
  schema: z.object({
    commands: z
      .array(
        z.object({
          type: z.string().min(1).max(64),
          payload: z.unknown().optional(),
        }),
      )
      .min(1)
      .max(50),
    atomic: z.boolean().default(true),
  }),
  example: {
    commands: [
      { type: 'layer.create', payload: { type: 'text', text: 'Hello', x: 100, y: 200 } },
      { type: 'layer.update', payload: { id: 'ly_xxx', patch: { opacity: 0.8 } } },
    ],
    atomic: true,
  },
  handler: () => {
    throw new CommandFailure('INVARIANT', 'command.batch 必须由命令总线处理');
  },
});

void COMMAND_SOURCES;
