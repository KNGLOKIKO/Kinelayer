import { z } from 'zod';
import { defineCommand } from '../registry';
import { zId, zToneSpec } from '../schemas';
import { requireAudio } from './_helpers';

/**
 * 音频层的属性命令。
 *
 * 为什么不并进 `layer.update`：那个 patch 是「所有图层通用」的，
 * 一旦把 volume / tone 塞进去，文本层也能被写入一份 tone —— 数据层就出现了
 * 「有音源参数的文本框」这种解释不了的状态。这里单开一条，只在音频层上生效。
 */
export const audioCommands = [
  defineCommand({
    type: 'audio.set',
    category: '音频',
    mutating: true,
    coalesce: true,
    description:
      '修改音频图层的音量、静音、淡入淡出与音源参数。音源是程序化合成的（pad 长音 / pulse 节拍 / chime 提示音），不依赖任何音频文件。',
    schema: z.object({
      id: zId,
      volume: z.number().min(0).max(1).optional(),
      muted: z.boolean().optional(),
      fadeIn: z.number().min(0).max(60_000).optional(),
      fadeOut: z.number().min(0).max(60_000).optional(),
      tone: zToneSpec.partial().optional(),
    }),
    example: { id: 'ly_abc', volume: 0.35, muted: false, tone: { preset: 'pad', root: 110, chord: [0, 7, 12] } },
    handler: (draft, payload) => {
      const layer = requireAudio(draft, payload.id);
      if (payload.volume !== undefined) layer.volume = payload.volume;
      if (payload.muted !== undefined) layer.muted = payload.muted;
      if (payload.fadeIn !== undefined) layer.fadeIn = payload.fadeIn;
      if (payload.fadeOut !== undefined) layer.fadeOut = payload.fadeOut;
      if (payload.tone) layer.tone = { ...layer.tone, ...payload.tone };
      return {
        id: layer.id,
        volume: layer.volume,
        muted: layer.muted,
        preset: layer.tone.preset,
      };
    },
  }),
];
