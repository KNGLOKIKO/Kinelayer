import { z } from 'zod';
import { defineCommand } from '../registry';
import { zId } from '../schemas';
import { findLayer } from './_helpers';

export const windowCommands = [
  defineCommand({
    type: 'window.openLayer',
    category: '窗口',
    mutating: false,
    undoable: false,
    description:
      '为某个图层打开独立窗口（只读镜像，所有修改仍回到主窗口命令总线）。降级链：popup → Document Picture-in-Picture → 应用内浮动面板。',
    schema: z.object({
      layerId: zId,
      mode: z.enum(['auto', 'popup', 'pip', 'panel']).default('auto'),
    }),
    example: { layerId: 'ly_abc', mode: 'auto' },
    handler: async (draft, payload, ctx) => {
      const layer = findLayer(draft, payload.layerId);
      const result = await ctx.services.openLayerWindow(
        layer.id,
        payload.mode === 'auto' ? 'popup' : payload.mode,
      );
      ctx.ui((ui) => {
        ui.windowMode = result.mode;
        if (result.mode === 'panel') {
          ui.floatingWindows = Array.from(new Set([...ui.floatingWindows, layer.id]));
        }
      });
      return { layerId: layer.id, ...result };
    },
  }),

  defineCommand({
    type: 'window.closeLayer',
    category: '窗口',
    mutating: false,
    undoable: false,
    description: '关闭某个图层的独立窗口。',
    schema: z.object({ layerId: zId }),
    example: { layerId: 'ly_abc' },
    handler: (_draft, payload, ctx) => {
      ctx.services.closeLayerWindow(payload.layerId);
      ctx.ui((ui) => {
        ui.floatingWindows = ui.floatingWindows.filter((id) => id !== payload.layerId);
      });
      return { layerId: payload.layerId, closed: true };
    },
  }),

  defineCommand({
    type: 'window.focusLayer',
    category: '窗口',
    mutating: false,
    undoable: false,
    description: '把某个图层的独立窗口提到最前（若不存在则打开）。',
    schema: z.object({ layerId: zId }),
    example: { layerId: 'ly_abc' },
    handler: (_draft, payload, ctx) => {
      ctx.services.focusLayerWindow(payload.layerId);
      return { layerId: payload.layerId };
    },
  }),

  defineCommand({
    type: 'window.setMode',
    category: '窗口',
    mutating: false,
    undoable: false,
    description: '设置图层窗口的默认降级策略（auto 由运行时决定）。',
    schema: z.object({ mode: z.enum(['popup', 'pip', 'panel']) }),
    example: { mode: 'panel' },
    handler: (_draft, payload, ctx) => {
      ctx.ui((ui) => {
        ui.windowMode = payload.mode;
      });
      return { mode: payload.mode };
    },
  }),
];
