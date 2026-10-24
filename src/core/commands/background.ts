import { z } from 'zod';
import { defineCommand, CommandFailure } from '../registry';
import { zColor, zEngine, zFit, zGradient } from '../schemas';
import { getBackground } from '../types';
import { resetCodeRuntime } from '@/render/codeEngine';

export const backgroundCommands = [
  defineCommand({
    type: 'background.set',
    category: '背景',
    mutating: true,
    coalesce: true,
    description: '设置背景：kind=solid 用 color；kind=gradient 用 gradient；kind=image 用 assetId（须先 asset.import）；kind=code 用 background.setCode。',
    schema: z.object({
      kind: z.enum(['solid', 'gradient', 'image', 'code']).optional(),
      color: zColor.optional(),
      gradient: zGradient.optional(),
      assetId: z.string().min(1).nullable().optional(),
      fit: zFit.optional(),
    }),
    example: { kind: 'gradient', gradient: { type: 'linear', angle: 135, stops: [{ offset: 0, color: '#05070c' }, { offset: 1, color: '#2a1147' }] } },
    handler: (draft, payload) => {
      const bg = getBackground(draft);
      if (payload.kind) bg.kind = payload.kind;
      if (payload.color) bg.color = payload.color;
      if (payload.gradient) bg.gradient = payload.gradient;
      if (payload.assetId !== undefined) bg.assetId = payload.assetId;
      if (payload.fit) bg.fit = payload.fit;
      if (bg.kind === 'image' && !bg.assetId) {
        throw new CommandFailure('VALIDATION', 'kind=image 时必须同时提供 assetId（先用 asset.import 导入图片）');
      }
      if (bg.kind === 'code' && !bg.code.source.trim()) {
        throw new CommandFailure('VALIDATION', 'kind=code 时背景代码为空，请先调用 background.setCode');
      }
      return { kind: bg.kind, color: bg.color, assetId: bg.assetId };
    },
  }),

  defineCommand({
    type: 'background.setCode',
    category: '背景',
    mutating: true,
    description: '设置代码驱动背景的引擎与源码（引擎语义同代码层），并自动把背景 kind 切到 code。',
    schema: z.object({
      engine: zEngine.optional(),
      source: z.string().max(200_000).optional(),
    }),
    example: {
      engine: 'canvas2d',
      source:
        "const t = time * 0.001;\nconst g = ctx.createLinearGradient(0,0,width,height);\ng.addColorStop(0,'#07090f');\ng.addColorStop(1,'#241040');\nctx.fillStyle=g;ctx.fillRect(0,0,width,height);\nctx.fillStyle='rgba(124,92,255,.5)';\nctx.beginPath();ctx.arc(width/2+Math.sin(t)*80,height/2,180,0,Math.PI*2);ctx.fill();",
    },
    handler: (draft, payload) => {
      const bg = getBackground(draft);
      if (payload.engine) bg.code.engine = payload.engine;
      if (payload.source !== undefined) bg.code.source = payload.source;
      bg.kind = 'code';
      resetCodeRuntime();
      return { engine: bg.code.engine, bytes: bg.code.source.length };
    },
  }),
];
