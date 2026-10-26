import { z } from 'zod';
import { defineCommand } from '../registry';
import { zId } from '../schemas';
import { clamp } from '../geometry';
import { findLayer } from './_helpers';
import { LIMITS } from '../types';

export const timelineCommands = [
  defineCommand({
    type: 'timeline.play',
    category: '时间轴',
    mutating: false,
    description: '从当前播放头开始播放；若已在末尾则从 0 开始。',
    schema: z.object({}),
    example: {},
    handler: (draft, _payload, ctx) => {
      /* 先取值再闭包：副作用闭包不能碰 draft（详见 canvas.setDuration 里的说明） */
      const duration = draft.duration;
      ctx.runtime((rt) => {
        if (rt.playhead >= duration - 1) rt.playhead = 0;
        rt.playing = true;
      });
      return { playing: true };
    },
  }),

  defineCommand({
    type: 'timeline.pause',
    category: '时间轴',
    mutating: false,
    description: '暂停播放（播放头保持不动）。',
    schema: z.object({}),
    example: {},
    handler: (_draft, _payload, ctx) => {
      ctx.runtime((rt) => {
        rt.playing = false;
      });
      return { playing: false };
    },
  }),

  defineCommand({
    type: 'timeline.seek',
    category: '时间轴',
    mutating: false,
    description: '把播放头移到指定毫秒位置。',
    schema: z.object({ time: z.number().min(0).max(LIMITS.duration.max) }),
    example: { time: 1200 },
    handler: (draft, payload, ctx) => {
      const time = clamp(payload.time, 0, draft.duration);
      ctx.runtime((rt) => {
        rt.playhead = time;
      });
      return { playhead: time };
    },
  }),

  defineCommand({
    type: 'timeline.setLoop',
    category: '时间轴',
    mutating: true,
    description: '设置播放到末尾后是否循环。',
    schema: z.object({ loop: z.boolean() }),
    example: { loop: true },
    handler: (draft, payload) => {
      draft.loop = payload.loop;
      return { loop: draft.loop };
    },
  }),

  defineCommand({
    type: 'timeline.setLayerTiming',
    category: '时间轴',
    mutating: true,
    description: '设置图层的出现/消失时间（毫秒）。outPoint 传 0 表示持续到结尾。',
    schema: z.object({
      id: zId,
      inPoint: z.number().min(0).max(LIMITS.duration.max).optional(),
      outPoint: z.number().min(0).max(LIMITS.duration.max).optional(),
    }),
    example: { id: 'ly_abc', inPoint: 400, outPoint: 3200 },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      if (layer.type === 'background') return { id: layer.id, inPoint: 0, outPoint: 0 };
      if (payload.inPoint !== undefined) layer.inPoint = Math.round(payload.inPoint);
      if (payload.outPoint !== undefined) layer.outPoint = Math.round(payload.outPoint);
      if (layer.outPoint > 0 && layer.outPoint < layer.inPoint + 100) {
        layer.outPoint = Math.min(draft.duration, layer.inPoint + 100);
      }
      return { id: layer.id, inPoint: layer.inPoint, outPoint: layer.outPoint };
    },
  }),
];
