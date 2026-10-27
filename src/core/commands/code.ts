import { z } from 'zod';
import { defineCommand } from '../registry';
import { zCodeSpec, zEngine, zId } from '../schemas';
import { requireCode } from './_helpers';
import { resetCodeRuntime } from '@/render/codeEngine';

export const codeCommands = [
  defineCommand({
    type: 'code.setSource',
    category: '代码',
    mutating: true,
    description:
      '替换代码层源码。canvas2d 引擎可用 ctx/api/params/width/height/time/frame/state/output；glsl 引擎写 void main()，可用 u_time/u_resolution。',
    schema: z.object({ id: zId, source: z.string().max(200_000) }),
    example: {
      id: 'ly_abc',
      source:
        "const t = time * 0.001;\nctx.clearRect(0,0,width,height);\nctx.fillStyle = 'rgba(124,92,255,.6)';\nctx.fillRect(0, height/2 + Math.sin(t)*40, width, 4);",
    },
    handler: (draft, payload) => {
      const layer = requireCode(draft, payload.id);
      layer.code.source = payload.source;
      resetCodeRuntime(layer.id);
      return { id: layer.id, bytes: payload.source.length };
    },
  }),

  defineCommand({
    type: 'code.setEngine',
    category: '代码',
    mutating: true,
    description: '切换代码层引擎：canvas2d | glsl | html。切换不会改动源码，但源码需要符合对应引擎的约定。',
    schema: z.object({ id: zId, engine: zEngine }),
    example: { id: 'ly_abc', engine: 'glsl' },
    handler: (draft, payload) => {
      const layer = requireCode(draft, payload.id);
      layer.code.engine = payload.engine;
      resetCodeRuntime(layer.id);
      return { id: layer.id, engine: layer.code.engine };
    },
  }),

  defineCommand({
    type: 'code.setParams',
    category: '代码',
    mutating: true,
    coalesce: true,
    description: '设置代码层的参数对象（整体替换），代码内通过 params 读取。',
    schema: z.object({ id: zId, params: zCodeSpec.shape.params }),
    example: { id: 'ly_abc', params: { density: 12, color: '#7c5cff' } },
    handler: (draft, payload) => {
      const layer = requireCode(draft, payload.id);
      layer.code.params = payload.params;
      resetCodeRuntime(layer.id);
      return { id: layer.id, params: layer.code.params };
    },
  }),

  defineCommand({
    type: 'code.setRenderScale',
    category: '代码',
    mutating: true,
    description:
      '设置代码层的内部分辨率倍率（0.25–1，1 为原始）。低频成片画面（噪声场、雾、辉光）降它可以成倍省时间，文字与细线不要降。',
    schema: z.object({ id: zId, renderScale: z.number().min(0.25).max(1).nullable() }),
    example: { id: 'ly_abc', renderScale: 0.5 },
    handler: (draft, payload) => {
      const layer = requireCode(draft, payload.id);
      if (payload.renderScale === null) delete layer.code.renderScale;
      else layer.code.renderScale = payload.renderScale;
      return { id: layer.id, renderScale: layer.code.renderScale ?? 1 };
    },
  }),

  defineCommand({
    type: 'code.setMotionBlur',
    category: '代码',
    mutating: true,
    description:
      '设置代码层的子帧运动模糊。samples 是同一帧内取几个子帧（2–8），shutter 是快门时长（毫秒）—— 注意它是一帧曝光，不是重影次数：30fps 下一帧 33ms，给 110ms 会得到三次离散重影（长曝光），给 44ms 才是真正的运动模糊。代价是绘制次数线性上涨（只影响这一层），所以给一两层需要方向感的元素用，不要整片都开。传 null 关闭。',
    schema: z.object({
      id: zId,
      motionBlur: z
        .object({
          samples: z.number().int().min(2).max(8),
          shutter: z.number().min(1).max(200),
        })
        .nullable(),
    }),
    example: { id: 'ly_abc', motionBlur: { samples: 5, shutter: 44 } },
    handler: (draft, payload) => {
      const layer = requireCode(draft, payload.id);
      if (payload.motionBlur === null) delete layer.code.motionBlur;
      else layer.code.motionBlur = payload.motionBlur;
      return { id: layer.id, motionBlur: layer.code.motionBlur ?? null };
    },
  }),

  defineCommand({
    type: 'code.resetRuntime',
    category: '代码',
    mutating: false,
    description: '清空某个代码层（或全部代码层）的编译缓存与熔断状态，用于异常后恢复。',
    schema: z.object({ id: zId.optional() }),
    example: { id: 'ly_abc' },
    handler: (_draft, payload) => {
      resetCodeRuntime(payload.id);
      return { reset: payload.id ?? 'all' };
    },
  }),
];
