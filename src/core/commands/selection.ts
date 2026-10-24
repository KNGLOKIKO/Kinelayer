import { z } from 'zod';
import { defineCommand } from '../registry';
import { zId, zIds } from '../schemas';

export const selectionCommands = [
  defineCommand({
    type: 'selection.set',
    category: '选择',
    mutating: false,
    undoable: false,
    description: '把选中集替换为给定图层 id（只影响 UI，不进撤销栈）。传空数组等价于清空。',
    schema: z.object({ ids: z.array(zId).max(200) }),
    example: { ids: ['ly_abc'] },
    handler: (draft, payload, ctx) => {
      const valid = payload.ids.filter((id) => draft.layers.some((l) => l.id === id && l.type !== 'background'));
      ctx.ui((ui) => {
        ui.selectedIds = valid;
        ui.activeLayerId = valid[valid.length - 1] ?? null;
      });
      return { selected: valid };
    },
  }),

  defineCommand({
    type: 'selection.add',
    category: '选择',
    mutating: false,
    undoable: false,
    description: '把图层加入选中集（可多选）。',
    schema: z.object({ ids: zIds }),
    example: { ids: ['ly_abc', 'ly_def'] },
    handler: (draft, payload, ctx) => {
      const valid = payload.ids.filter((id) => draft.layers.some((l) => l.id === id && l.type !== 'background'));
      ctx.ui((ui) => {
        ui.selectedIds = Array.from(new Set([...ui.selectedIds, ...valid]));
        ui.activeLayerId = valid[valid.length - 1] ?? ui.activeLayerId;
      });
      return { selected: valid };
    },
  }),

  defineCommand({
    type: 'selection.toggle',
    category: '选择',
    mutating: false,
    undoable: false,
    description: '切换单个图层的选中状态。',
    schema: z.object({ id: zId }),
    example: { id: 'ly_abc' },
    handler: (draft, payload, ctx) => {
      const exists = draft.layers.some((l) => l.id === payload.id && l.type !== 'background');
      let next: string[] = [];
      ctx.ui((ui) => {
        next = ui.selectedIds.includes(payload.id)
          ? ui.selectedIds.filter((id) => id !== payload.id)
          : exists
            ? [...ui.selectedIds, payload.id]
            : ui.selectedIds;
        ui.selectedIds = next;
        ui.activeLayerId = next[next.length - 1] ?? null;
      });
      return { selected: next };
    },
  }),

  defineCommand({
    type: 'selection.clear',
    category: '选择',
    mutating: false,
    undoable: false,
    description: '清空选中集。',
    schema: z.object({}),
    example: {},
    handler: (_draft, _payload, ctx) => {
      ctx.ui((ui) => {
        ui.selectedIds = [];
        ui.activeLayerId = null;
      });
      return { selected: [] };
    },
  }),
];
