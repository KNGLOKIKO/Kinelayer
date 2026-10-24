import { z } from 'zod';
import { defineCommand } from '../registry';
import { zId, zTextStylePatch } from '../schemas';
import { requireText } from './_helpers';
import { fontCss } from '@/render/text';

export const textCommands = [
  defineCommand({
    type: 'text.setContent',
    category: '文本',
    mutating: true,
    description: '设置文本层的内容（支持 \\n 换行）。',
    schema: z.object({ id: zId, text: z.string().max(20_000) }),
    example: { id: 'ly_abc', text: '新的一行\\n第二行' },
    handler: (draft, payload) => {
      const layer = requireText(draft, payload.id);
      layer.text = payload.text;
      return { id: layer.id, length: payload.text.length };
    },
  }),

  defineCommand({
    type: 'text.setStyle',
    category: '文本',
    mutating: true,
    coalesce: true,
    description:
      '局部修改文本样式。可改 fontFamily/fontSize/fontWeight/fontStyle/lineHeight/letterSpacing/align/verticalAlign/color/useGradient/gradient/stroke/shadow/wrap/uppercase。',
    schema: z.object({ id: zId, style: zTextStylePatch }),
    example: {
      id: 'ly_abc',
      style: { fontSize: 96, fontWeight: 700, color: '#ffffff', letterSpacing: -1, lineHeight: 1.1 },
    },
    handler: (draft, payload) => {
      const layer = requireText(draft, payload.id);
      const patch = payload.style;
      if (patch.fontSize && patch.fontSize * 1.2 > layer.height) {
        layer.height = Math.ceil(patch.fontSize * 1.4);
      }
      layer.style = { ...layer.style, ...patch };
      if (patch.fontFamily || patch.fontWeight || patch.fontSize) {
        void fontCss(layer.style);
      }
      return { id: layer.id, style: layer.style };
    },
  }),

  defineCommand({
    type: 'text.fitBox',
    category: '文本',
    mutating: true,
    description: '把文本框高度收缩到内容的实际高度（不会小于一行）。',
    schema: z.object({ id: zId, padding: z.number().min(0).max(200).default(8) }),
    example: { id: 'ly_abc', padding: 8 },
    handler: (draft, payload) => {
      const layer = requireText(draft, payload.id);
      const lines = layer.text.split('\n').length;
      const height = Math.ceil(lines * layer.style.fontSize * layer.style.lineHeight + payload.padding * 2);
      layer.height = Math.max(layer.style.fontSize, height);
      return { id: layer.id, height: layer.height };
    },
  }),
];
