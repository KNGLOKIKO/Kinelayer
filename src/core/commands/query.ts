import { z } from 'zod';
import { defineCommand } from '../registry';
import { zId } from '../schemas';
import { findLayer } from './_helpers';
import { summarizeLayer, summarizeProject } from '../summary';
import { describeRegistry } from '../registry';
import { getRuntimeInfo } from '@/render/codeEngine';
import type { CodeLayer } from '../types';

export const queryCommands = [
  defineCommand({
    type: 'query.project',
    category: '查询',
    mutating: false,
    description: '读取当前项目摘要：画布参数、图层清单（含 id/位置/文本片段/代码字节数）、资源与字体列表。AI 每次操作前应先调用它。',
    schema: z.object({}),
    example: {},
    handler: (draft) => summarizeProject(draft),
  }),

  defineCommand({
    type: 'query.layer',
    category: '查询',
    mutating: false,
    description: '读取单个图层的完整属性（代码源码最多返回 4000 字符）。',
    schema: z.object({ id: zId }),
    example: { id: 'ly_abc' },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      const data = summarizeLayer(layer);
      if (layer.type === 'code') {
        data.runtime = getRuntimeInfo((layer as CodeLayer).id);
      }
      return data;
    },
  }),

  defineCommand({
    type: 'query.registry',
    category: '查询',
    mutating: false,
    description: '查询命令注册表（可按关键字过滤）。用来确认某个命令的 payload 形状与示例。',
    schema: z.object({ keyword: z.string().max(60).optional() }),
    example: { keyword: 'text' },
    handler: (_draft, payload) => {
      const all = describeRegistry();
      if (!payload.keyword) return { commands: all, count: all.length };
      const k = payload.keyword.toLowerCase();
      const filtered = all.filter(
        (c) => c.type.toLowerCase().includes(k) || c.description.includes(payload.keyword ?? '') || c.category.includes(payload.keyword ?? ''),
      );
      return { commands: filtered, count: filtered.length };
    },
  }),

  defineCommand({
    type: 'query.capture',
    category: '查询',
    mutating: false,
    description: '把当前画布（或某个图层）截图成 PNG dataURL，供多模态视觉核对。AI 应只在需要核对画面时调用。',
    schema: z.object({
      maxWidth: z.number().min(64).max(2048).default(720),
      layerId: z.string().min(1).nullable().optional(),
      time: z.number().min(0).max(600_000).optional(),
    }),
    example: { maxWidth: 720 },
    handler: async (_draft, payload, ctx) => {
      return ctx.services.capture({
        maxWidth: payload.maxWidth,
        layerId: payload.layerId ?? null,
        time: payload.time ?? ctx.playhead,
      });
    },
  }),
];
