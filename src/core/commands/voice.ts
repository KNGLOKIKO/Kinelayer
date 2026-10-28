import { z } from 'zod';
import { defineCommand, CommandFailure } from '../registry';
import { zId, zVoiceSpec } from '../schemas';
import { createAudioLayer } from '../defaults';
import { buildVoicePlan, lyricTextOf, normalizeVoiceSpec } from '../voice';
import { enforceInvariants, requireAudio } from './_helpers';

/**
 * 人声命令。
 *
 * 三条命令的分工是「谁负责时间」划出来的：
 *   · `voice.create` —— 从一句话新建一层，**长度由合成计划决定**（唱完就结束）；
 *   · `voice.sync`   —— 词改了之后重算长度，不动起点；
 *   · `audio.set`    —— 只改参数（音色/气声/颤音），不碰时间。
 *
 * 时长必须由 core 算：`buildVoicePlan` 是纯函数，命令层能在毫秒级拿到准确长度。
 * 如果把「先建层再让渲染层量长度再回写」写成异步流程，时间轴会出现一次「先长后短」的跳变。
 */

const zVoicePatch = zVoiceSpec.partial();

export const voiceCommands = [
  defineCommand({
    type: 'voice.create',
    category: '人声',
    mutating: true,
    description:
      '用一段文字生成人声图层（共振峰合成，可说话可演唱），默认放在播放头处，长度按唱完为止。全部参数可后续用 audio.set 调整。',
    schema: z.object({
      text: z.string().min(1).max(400).describe('要唱/要说的词。中文、拼音、英文混写都行'),
      fromLyrics: z.boolean().optional().describe('忽略 text，改从工程歌词里取前几行'),
      mode: z.enum(['speak', 'sing']).optional(),
      preset: z.enum(['female', 'male', 'child', 'robot']).optional(),
      root: z.number().min(55).max(660).optional(),
      rate: z.number().min(0.5).max(2).optional(),
      pitch: z.number().min(-24).max(24).optional(),
      vibrato: z.number().min(0).max(1).optional(),
      breath: z.number().min(0).max(1).optional(),
      melody: z.array(z.number().min(-24).max(24)).max(64).optional(),
      beatsPerSyllable: z.number().min(0.25).max(8).optional(),
      bpm: z.number().min(30).max(300).optional().describe('演唱速度，缺省用工程速度'),
      at: z.number().min(0).optional().describe('起点（毫秒），缺省用播放头'),
      name: z.string().min(1).max(80).optional(),
    }),
    example: { text: '我在加我的图层数', mode: 'sing', preset: 'female', beatsPerSyllable: 2 },
    handler: (draft, payload, ctx) => {
      const text = payload.fromLyrics ? lyricTextOf(draft, 4) : payload.text.trim();
      if (!text) throw new CommandFailure('VALIDATION', '没有可唱的词');

      const spec = normalizeVoiceSpec({
        ...payload,
        text,
        bpm: payload.bpm ?? draft.tempo?.bpm ?? 120,
        mode: payload.mode ?? 'sing',
      });
      const plan = buildVoicePlan(spec);

      const at = Math.round(Math.max(0, Math.min(payload.at ?? ctx.playhead, draft.duration)));
      const length = Math.max(300, Math.min(plan.totalMs, draft.duration - at));

      const layer = createAudioLayer({
        name: payload.name ?? (spec.mode === 'sing' ? `人声 · ${text.slice(0, 8)}` : `朗读 · ${text.slice(0, 8)}`),
        inPoint: at,
        outPoint: at + length,
        voice: spec,
        volume: 0.85,
        fadeIn: 40,
        fadeOut: 160,
      });
      draft.layers.push(layer);
      enforceInvariants(draft);

      return {
        id: layer.id,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        ms: length,
        syllables: plan.notes.length,
        phonemes: plan.phonemeCount,
        unknown: plan.unknownCount,
        text,
      };
    },
  }),

  defineCommand({
    type: 'voice.sync',
    category: '人声',
    mutating: true,
    coalesce: true,
    description: '按当前人声参数重算这一层的长度（改词之后调用），起点不变。',
    schema: z.object({
      id: zId,
      fit: z.enum(['length', 'keep']).optional().describe('length = 按唱完为止；keep = 只改参数不动长度'),
    }),
    example: { id: 'ly_abc', fit: 'length' },
    handler: (draft, payload) => {
      const layer = requireAudio(draft, payload.id);
      if (!layer.voice) throw new CommandFailure('VALIDATION', '这一层不是人声');
      const plan = buildVoicePlan(layer.voice);
      if (payload.fit !== 'keep') {
        layer.outPoint = Math.min(draft.duration, Math.round(layer.inPoint + Math.max(300, plan.totalMs)));
      }
      return {
        id: layer.id,
        ms: plan.totalMs,
        outPoint: layer.outPoint,
        syllables: plan.notes.length,
        unknown: plan.unknownCount,
      };
    },
  }),

  defineCommand({
    type: 'voice.set',
    category: '人声',
    mutating: true,
    coalesce: true,
    description: '修改人声参数（文字 / 说话或演唱 / 音色 / 音高 / 气声 / 颤音 / 旋律）。不传的参数保持不动。',
    schema: z.object({
      id: zId,
      voice: zVoicePatch,
      /** 改完是否按新长度重排（默认 true：改词不改长度会让尾巴被硬切） */
      refit: z.boolean().optional(),
    }),
    example: { id: 'ly_abc', voice: { text: '换一句词', vibrato: 0.5 } },
    handler: (draft, payload) => {
      const layer = requireAudio(draft, payload.id);
      if (!layer.voice) throw new CommandFailure('VALIDATION', '这一层不是人声，先用 voice.create 建一层');
      const next = normalizeVoiceSpec({ ...layer.voice, ...payload.voice });
      layer.voice = next;
      const plan = buildVoicePlan(next);
      if (payload.refit !== false) {
        layer.outPoint = Math.min(draft.duration, Math.round(layer.inPoint + Math.max(300, plan.totalMs)));
      }
      return { id: layer.id, ms: plan.totalMs, outPoint: layer.outPoint, syllables: plan.notes.length, unknown: plan.unknownCount };
    },
  }),
];
