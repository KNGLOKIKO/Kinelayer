import { z } from 'zod';
import { defineCommand } from '../registry';
import { LIMITS } from '../types';
import { listCommands } from '../registry';

export const exportCommands = [
  defineCommand({
    type: 'export.png',
    category: '导出',
    mutating: false,
    undoable: false,
    description: '导出当前帧为 PNG 并触发下载（离屏 Canvas，与预览共用渲染函数）。导出前会 await 字体加载。',
    schema: z.object({
      scale: z.number().min(0.25).max(4).default(1),
      transparent: z.boolean().default(false),
      time: z.number().min(0).max(LIMITS.duration.max).optional(),
    }),
    example: { scale: 2, transparent: false },
    handler: async (_draft, payload, ctx) => {
      const result = await ctx.services.exportPng({
        scale: payload.scale,
        transparent: payload.transparent,
        time: payload.time ?? ctx.playhead,
      });
      return result;
    },
  }),

  defineCommand({
    type: 'export.webm',
    category: '导出',
    mutating: false,
    undoable: false,
    description:
      '导出 WebM 视频：离屏 Canvas 逐帧渲染 + captureStream(0) + requestFrame 手动推帧，保证内容可复现（时长受 MediaRecorder 时间戳影响，见已知限制）。',
    schema: z.object({
      fps: z.number().min(1).max(60).default(30),
      quality: z.number().min(1).max(100).default(70),
    }),
    example: { fps: 30, quality: 80 },
    handler: async (_draft, payload, ctx) => {
      ctx.runtime((rt) => {
        rt.exportProgress = { active: true, label: '准备导出 WebM', progress: 0 };
      });
      try {
        const result = await ctx.services.exportWebm(
          { fps: payload.fps, quality: payload.quality, time: ctx.playhead },
          (progress) => {
            ctx.runtime((rt) => {
              rt.exportProgress = { active: true, label: `渲染帧 ${Math.round(progress * 100)}%`, progress };
            });
          },
        );
        return result;
      } finally {
        ctx.runtime((rt) => {
          rt.exportProgress = { active: false, label: '', progress: 0 };
        });
      }
    },
  }),

  defineCommand({
    type: 'export.wav',
    category: '导出',
    mutating: false,
    undoable: false,
    description:
      '只导出声音（16bit PCM WAV）。区间与视频一致，都读工程的出片区间 —— 同一次导出里画面和声音必须覆盖同一段，否则合起来才发现对不上。',
    schema: z.object({
      sampleRate: z.union([z.literal(44100), z.literal(48000)]).default(48000),
    }),
    example: { sampleRate: 48000 },
    handler: async (_draft, payload, ctx) => ctx.services.exportWav({ sampleRate: payload.sampleRate }),
  }),

  defineCommand({
    type: 'export.subtitles',
    category: '导出',
    mutating: false,
    undoable: false,
    description:
      '导出字幕文件（SRT / VTT）。granularity=line 一行一条；unit 用工程里的逐字时间，一个单元一条（短视频与卡拉 OK 用这个）。时间相对导出片段起点。',
    schema: z.object({
      format: z.enum(['srt', 'vtt']).default('srt'),
      granularity: z.enum(['line', 'unit']).default('line'),
    }),
    example: { format: 'srt', granularity: 'line' },
    handler: async (_draft, payload, ctx) =>
      ctx.services.exportSubtitles({ format: payload.format, granularity: payload.granularity }),
  }),

  defineCommand({
    type: 'export.edl',
    category: '导出',
    mutating: false,
    undoable: false,
    description:
      '导出剪辑表（CMX 3600 EDL），给 Premiere / DaVinci / 剪映。只有带素材文件的图层进表；文本、代码、程序化音源是算出来的，成片里已烘焙，会在注释里列明。',
    schema: z.object({}),
    example: {},
    handler: async (_draft, _payload, ctx) => ctx.services.exportEdl(),
  }),

  defineCommand({
    type: 'export.json',
    category: '导出',
    mutating: false,
    undoable: false,
    description: '导出工程包（.kly，不含任何 base64 资源），用于备份、版本管理与跨设备迁移。',
    schema: z.object({}),
    example: {},
    handler: async (_draft, _payload, ctx) => ctx.services.exportJson(),
  }),

  defineCommand({
    type: 'export.commands',
    category: '导出',
    mutating: false,
    undoable: false,
    description: '导出命令清单（Markdown），用于给外部 Agent 或文档使用。',
    schema: z.object({}),
    example: {},
    handler: () => {
      const lines = ['# Kinelayer 命令清单', ''];
      for (const def of listCommands()) {
        lines.push(`## ${def.type}`);
        lines.push('');
        lines.push(def.description);
        lines.push('');
        lines.push(`- 分类：${def.category}`);
        lines.push(`- 修改项目：${def.mutating ? '是' : '否'}`);
        if (def.dangerous) lines.push('- 危险：是');
        lines.push(`- 示例：\`${JSON.stringify(def.example)}\``);
        lines.push('');
      }
      return { markdown: lines.join('\n'), count: listCommands().length };
    },
  }),
];
