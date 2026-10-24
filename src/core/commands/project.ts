import { z } from 'zod';
import { defineCommand, CommandFailure } from '../registry';
import { createEmptyProject, normalizeProject } from '../defaults';
import { LIMITS } from '../types';
import { clamp } from '../geometry';

export const projectCommands = [
  defineCommand({
    type: 'project.new',
    category: '项目',
    mutating: true,
    dangerous: true,
    resetsHistory: true,
    description: '新建空白项目（会丢弃当前项目的撤销历史，但不会删除 IndexedDB 里的资源）。',
    schema: z.object({
      name: z.string().min(1).max(80).default('未命名海报'),
      width: z.number().min(LIMITS.width.min).max(LIMITS.width.max).default(1080),
      height: z.number().min(LIMITS.height.min).max(LIMITS.height.max).default(1440),
    }),
    example: { name: '新品发布海报', width: 1080, height: 1440 },
    handler: (draft, payload, ctx) => {
      const next = createEmptyProject(payload.name);
      next.width = payload.width;
      next.height = payload.height;
      next.layers[0]!.width = payload.width;
      next.layers[0]!.height = payload.height;
      Object.assign(draft, next);
      ctx.ui((ui) => {
        ui.selectedIds = [];
        ui.activeLayerId = null;
        ui.zoom = 0.5;
        ui.panX = 0;
        ui.panY = 0;
      });
      ctx.runtime((rt) => {
        rt.playhead = 0;
        rt.playing = false;
      });
      return { id: next.id, name: next.name };
    },
  }),

  defineCommand({
    type: 'project.load',
    category: '项目',
    mutating: true,
    dangerous: true,
    resetsHistory: true,
    description: '从项目 JSON 字符串载入（export.json 的产物，或手工构造的合法 JSON）。载入会做修复与不变式校验。',
    schema: z.object({ data: z.string().min(2).max(50_000_000) }),
    example: { data: '{"name":"海报","width":1080,...}' },
    handler: (draft, payload, ctx) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload.data);
      } catch (err) {
        throw new CommandFailure('VALIDATION', `JSON 解析失败：${(err as Error).message}`);
      }
      const next = normalizeProject(parsed);
      Object.assign(draft, next);
      ctx.ui((ui) => {
        ui.selectedIds = [];
        ui.activeLayerId = next.layers[1]?.id ?? null;
      });
      ctx.runtime((rt) => {
        rt.playhead = next.duration;
        rt.playing = false;
      });
      return { id: next.id, layers: next.layers.length };
    },
  }),

  defineCommand({
    type: 'project.rename',
    category: '项目',
    mutating: true,
    description: '重命名项目。',
    schema: z.object({ name: z.string().min(1).max(80) }),
    example: { name: '层动 · 版本 B' },
    handler: (draft, payload) => {
      draft.name = payload.name;
      return { name: draft.name };
    },
  }),

  defineCommand({
    type: 'canvas.resize',
    category: '画布',
    mutating: true,
    description: '修改画布尺寸。scaleContent=true 时按比例缩放所有图层（保持构图）。',
    schema: z.object({
      width: z.number().min(LIMITS.width.min).max(LIMITS.width.max),
      height: z.number().min(LIMITS.height.min).max(LIMITS.height.max),
      scaleContent: z.boolean().default(true),
    }),
    example: { width: 1080, height: 1080, scaleContent: true },
    handler: (draft, payload) => {
      const sx = payload.width / draft.width;
      const sy = payload.height / draft.height;
      if (payload.scaleContent) {
        for (const layer of draft.layers) {
          if (layer.type === 'background') continue;
          layer.x = Math.round(layer.x * sx);
          layer.y = Math.round(layer.y * sy);
          layer.width = Math.max(1, Math.round(layer.width * sx));
          layer.height = Math.max(1, Math.round(layer.height * sy));
          if (layer.type === 'text') {
            layer.style.fontSize = Math.max(4, layer.style.fontSize * Math.min(sx, sy));
          }
        }
      }
      draft.width = payload.width;
      draft.height = payload.height;
      return { width: draft.width, height: draft.height };
    },
  }),

  defineCommand({
    type: 'canvas.setDuration',
    category: '画布',
    mutating: true,
    description: '设置时间轴总时长（毫秒，100..600000）。',
    schema: z.object({ duration: z.number().min(LIMITS.duration.min).max(LIMITS.duration.max) }),
    example: { duration: 6000 },
    handler: (draft, payload, ctx) => {
      draft.duration = Math.round(payload.duration);
      for (const layer of draft.layers) {
        if (layer.outPoint > draft.duration) layer.outPoint = draft.duration;
      }
      ctx.runtime((rt) => {
        rt.playhead = clamp(rt.playhead, 0, draft.duration);
      });
      return { duration: draft.duration };
    },
  }),

  defineCommand({
    type: 'canvas.setFps',
    category: '画布',
    mutating: true,
    description: '设置导出帧率（1..60）。',
    schema: z.object({ fps: z.number().min(LIMITS.fps.min).max(LIMITS.fps.max) }),
    example: { fps: 30 },
    handler: (draft, payload) => {
      draft.fps = Math.round(payload.fps);
      return { fps: draft.fps };
    },
  }),
];
