import { z } from 'zod';
import { defineCommand, CommandFailure } from '../registry';
import { zBase64DataUrl } from '../schemas';

export const fontCommands = [
  defineCommand({
    type: 'font.register',
    category: '字体',
    mutating: true,
    asyncHandler: true,
    description:
      '上传并注册字体（dataURL，仅 UI 使用）。字体字节存入 IndexedDB，刷新后可恢复；项目里只记录 FontMeta。',
    schema: z.object({
      family: z.string().min(1).max(120),
      weight: z.number().min(100).max(900).default(400),
      style: z.enum(['normal', 'italic']).default('normal'),
      dataUrl: zBase64DataUrl,
    }),
    example: { family: 'My Display', weight: 700, style: 'normal', dataUrl: 'data:font/woff2;base64,...' },
    handler: async (draft, payload, ctx) => {
      await ctx.services.registerFont({
        family: payload.family,
        weight: payload.weight,
        style: payload.style,
        dataUrl: payload.dataUrl,
      });
      const exists = draft.fonts.find((f) => f.family === payload.family && f.weight === payload.weight);
      if (!exists) {
        draft.fonts.push({
          family: payload.family,
          source: 'upload',
          weight: payload.weight,
          style: payload.style,
          createdAt: Date.now(),
        });
      }
      return { family: payload.family, weight: payload.weight };
    },
  }),

  defineCommand({
    type: 'font.remove',
    category: '字体',
    mutating: true,
    asyncHandler: true,
    description: '移除上传的字体（系统字体不可移除）。',
    schema: z.object({ family: z.string().min(1).max(120) }),
    example: { family: 'My Display' },
    handler: async (draft, payload, ctx) => {
      const before = draft.fonts.length;
      draft.fonts = draft.fonts.filter((f) => f.family !== payload.family || f.source === 'system');
      if (draft.fonts.length === before) throw new CommandFailure('NOT_FOUND', `未找到上传字体：${payload.family}`);
      await ctx.services.removeFont(payload.family);
      return { family: payload.family };
    },
  }),

  defineCommand({
    type: 'font.load',
    category: '字体',
    mutating: false,
    description: '显式加载字体（document.fonts.load）。导出前会自动执行，一般无需手动调用。',
    schema: z.object({ families: z.array(z.string().min(1)).min(1).max(50) }),
    example: { families: ['Microsoft YaHei', 'Inter'] },
    handler: async (_draft, payload, ctx) => ctx.services.loadFonts(payload.families),
  }),
];
