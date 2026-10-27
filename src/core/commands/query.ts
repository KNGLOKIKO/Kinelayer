import { z } from 'zod';
import { defineCommand } from '../registry';
import { zId } from '../schemas';
import { findLayer } from './_helpers';
import { summarizeLayer, summarizeProject } from '../summary';
import { describeRegistry } from '../registry';
import { getRuntimeInfo } from '@/render/codeEngine';
import {
  barAt,
  barPhase,
  beatAt,
  beatPhase,
  hit,
  isDownbeat,
  lineAt,
  lineCharProgress,
  lineProgress,
  lyricsOf,
  nearestBeat,
  nextLine,
  sinceBeat,
  tempoOf,
  timeOfBeat,
} from '../score';
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
    type: 'query.score',
    category: '查询',
    mutating: false,
    description:
      '读取「谱面」在某一毫秒的推导结果：第几拍 / 第几小节 / 拍内相位 / 是否强拍 / 敲击包络 / 离上一下多久，外加此刻唱到哪一行、唱了几个字，以及接下来的强拍时刻。想「把这一刀切在下一个强拍上」就先问它 —— 不要自己用 bpm 再算一遍，那一定会和音频层算出来的鼓点差几毫秒。',
    schema: z.object({
      at: z.number().min(0).max(3_600_000),
      /** 往后列几个强拍（0 = 不列） */
      ahead: z.number().int().min(0).max(16).default(4),
    }),
    example: { at: 4000, ahead: 3 },
    handler: (draft, payload) => {
      const tempo = tempoOf(draft);
      const at = payload.at;
      const barIndex = Math.floor(barAt(tempo, at));
      const ahead: number[] = [];
      for (let i = 1; i <= payload.ahead; i += 1) {
        ahead.push(Math.round(timeOfBeat(tempo, (barIndex + i) * tempo.meter)));
      }
      const line = lineAt(lyricsOf(draft), at);
      const next = nextLine(lyricsOf(draft), at);
      return {
        tempo,
        beat: +beatAt(tempo, at).toFixed(3),
        bar: +barAt(tempo, at).toFixed(3),
        beatInBar: Math.floor(beatAt(tempo, at)) % tempo.meter,
        beatPhase: +beatPhase(tempo, at).toFixed(3),
        barPhase: +barPhase(tempo, at).toFixed(3),
        sinceBeatMs: Math.round(sinceBeat(tempo, at)),
        downbeat: isDownbeat(tempo, at),
        hit: +hit(tempo, at).toFixed(3),
        nearestBeatMs: Math.round(nearestBeat(tempo, at)),
        nextDownbeats: ahead,
        lyric: line
          ? {
              text: line.text,
              start: line.start,
              end: line.end,
              sungChars: +lineCharProgress(line, at).toFixed(2),
              totalChars: [...line.text].length,
              progress: +lineProgress(line, at).toFixed(3),
            }
          : null,
        nextLyric: next ? { text: next.text, start: next.start } : null,
      };
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
