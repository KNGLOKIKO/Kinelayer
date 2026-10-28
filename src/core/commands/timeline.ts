import { z } from 'zod';
import { CommandFailure, defineCommand } from '../registry';
import { zId, zMarkerKind, zTimeRange } from '../schemas';
import { clamp } from '../geometry';
import { findLayer } from './_helpers';
import { LIMITS, MAX_MARKERS, MIN_RANGE_MS, type Marker, type Project } from '../types';
import { uid } from '../ids';

export const timelineCommands = [
  defineCommand({
    type: 'timeline.play',
    category: '时间轴',
    mutating: false,
    description: '从当前播放头开始播放；若已在末尾则从 0 开始。有出片区间时「末尾」指区间出点，从头也指区间入点，且播到出点会停住。',
    schema: z.object({}),
    example: {},
    handler: (draft, _payload, ctx) => {
      /* 先取值再闭包：副作用闭包不能碰 draft（详见 canvas.setDuration 里的说明） */
      const duration = draft.duration;
      const from = draft.range ? Math.max(0, Math.min(draft.range.in, duration)) : 0;
      const to = draft.range ? Math.max(from + 1, Math.min(draft.range.out, duration)) : duration;
      ctx.runtime((rt) => {
        if (rt.playhead >= to - 1 || rt.playhead < from) rt.playhead = from;
        rt.playing = true;
        /* 上一次可能停在倒放（J）上。play 的语义是「正常播放」，不是「继续倒」 */
        rt.playRate = 1;
      });
      return { playing: true, from, to };
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

  /* ------------------------------------------------------------------ 出片区间
   *
   * 区间是「这段片子要出哪一段」的唯一权威，导出、字幕、剪辑表都读它。
   * 刻意做成 4 条命令而不是 1 条带 mode 的：
   * - setRange 是显式给定两侧（脚本、AI、钉死数值）；
   * - markIn / markOut 是给 I / O 两个键的，只动一侧并顺手兜住另一侧；
   * - clearRange 是撤回整片导出。
   * 合成一条会让 schema 变成一堆 optional + 互斥校验，AI 反而更容易传错。
   */

  defineCommand({
    type: 'timeline.setRange',
    category: '时间轴',
    mutating: true,
    coalesce: true,
    description:
      '设置出片区间（毫秒）。导出视频、字幕、剪辑表都只处理这一段。出点早于入点时直接拒绝（VALIDATION），不做「悄悄改成合理值」的补救——那会让人以为区间设对了。',
    schema: zTimeRange,
    example: { in: 2000, out: 8000 },
    handler: (draft, payload) => {
      const a = Math.round(payload.in);
      const b = Math.min(Math.round(payload.out), draft.duration);
      if (a < 0) throw new CommandFailure('VALIDATION', `入点不能为负：${a}`);
      if (b < a + MIN_RANGE_MS) {
        throw new CommandFailure(
          'VALIDATION',
          `出点必须比入点至少晚 ${MIN_RANGE_MS} 毫秒（收到 in=${a}, out=${b}，片长 ${draft.duration}）`,
        );
      }
      draft.range = { in: a, out: b };
      return { range: { in: a, out: b }, duration: b - a };
    },
  }),

  defineCommand({
    type: 'timeline.clearRange',
    category: '时间轴',
    mutating: true,
    description: '清除出片区间，恢复为整条时间轴导出。',
    schema: z.object({}),
    example: {},
    handler: (draft) => {
      draft.range = null;
      return { range: null };
    },
  }),

  defineCommand({
    type: 'timeline.markIn',
    category: '时间轴',
    mutating: true,
    coalesce: true,
    description:
      '在指定毫秒（缺省为当前播放头）打入点。入点越过原出点时把出点推到片尾——按 I 键就该直接生效，不该弹一个错让人先想一想。',
    schema: z.object({ time: z.number().min(0).max(LIMITS.duration.max).optional() }),
    example: { time: 2000 },
    handler: (draft, payload, ctx) => {
      const t = clamp(Math.round(payload.time ?? ctx.playhead), 0, Math.max(0, draft.duration - MIN_RANGE_MS));
      const keepOut = draft.range && draft.range.out >= t + MIN_RANGE_MS ? draft.range.out : draft.duration;
      draft.range = { in: t, out: keepOut };
      return { range: { ...draft.range } };
    },
  }),

  defineCommand({
    type: 'timeline.markOut',
    category: '时间轴',
    mutating: true,
    coalesce: true,
    description: '在指定毫秒（缺省为当前播放头）打出点。出点早于原入点时把入点拉回 0。',
    schema: z.object({ time: z.number().min(0).max(LIMITS.duration.max).optional() }),
    example: { time: 6000 },
    handler: (draft, payload, ctx) => {
      const t = clamp(Math.round(payload.time ?? ctx.playhead), MIN_RANGE_MS, draft.duration);
      const keepIn = draft.range && draft.range.in <= t - MIN_RANGE_MS ? draft.range.in : 0;
      draft.range = { in: keepIn, out: t };
      return { range: { ...draft.range } };
    },
  }),

  /* ------------------------------------------------------------------ 标记点
   *
   * 标记点不参与渲染，只服务「对齐」这件事：卡拍、标待改、记切点。
   * 所以命令层只保证三件硬约束（片内、id 唯一、按时间有序），
   * 文案和颜色怎么用由界面决定。
   */

  defineCommand({
    type: 'timeline.addMarker',
    category: '时间轴',
    mutating: true,
    description: '在指定毫秒（缺省为当前播放头）加一个标记点，返回它的 id。kind 只影响颜色与文案，不影响渲染。',
    schema: z.object({
      time: z.number().min(0).max(LIMITS.duration.max).optional(),
      label: z.string().max(60).optional(),
      kind: zMarkerKind.optional(),
    }),
    example: { time: 4000, label: '副歌', kind: 'beat' },
    handler: (draft, payload, ctx) => {
      const list = draft.markers ?? (draft.markers = []);
      if (list.length >= MAX_MARKERS) {
        throw new CommandFailure('VALIDATION', `标记点最多 ${MAX_MARKERS} 个，先删掉一些`);
      }
      const marker: Marker = {
        id: uid('mk'),
        time: clamp(Math.round(payload.time ?? ctx.playhead), 0, draft.duration),
        label: (payload.label ?? '').slice(0, 60),
        kind: payload.kind ?? 'note',
      };
      list.push(marker);
      list.sort((x, y) => x.time - y.time);
      return { id: marker.id, marker: { ...marker }, count: list.length };
    },
  }),

  defineCommand({
    type: 'timeline.moveMarker',
    category: '时间轴',
    mutating: true,
    coalesce: true,
    description: '把标记点移到新的毫秒位置（拖拽时会被合并成一个撤销点）。',
    schema: z.object({ id: zId, time: z.number().min(0).max(LIMITS.duration.max) }),
    example: { id: 'mk_abc', time: 5200 },
    handler: (draft, payload) => {
      const marker = requireMarker(draft, payload.id);
      marker.time = clamp(Math.round(payload.time), 0, draft.duration);
      draft.markers?.sort((x, y) => x.time - y.time);
      return { id: marker.id, time: marker.time };
    },
  }),

  defineCommand({
    type: 'timeline.updateMarker',
    category: '时间轴',
    mutating: true,
    coalesce: true,
    description: '改标记点的文案或类型。',
    schema: z.object({
      id: zId,
      label: z.string().max(60).optional(),
      kind: zMarkerKind.optional(),
    }),
    example: { id: 'mk_abc', label: '进副歌', kind: 'cut' },
    handler: (draft, payload) => {
      const marker = requireMarker(draft, payload.id);
      if (payload.label !== undefined) marker.label = payload.label.slice(0, 60);
      if (payload.kind !== undefined) marker.kind = payload.kind;
      return { marker: { ...marker } };
    },
  }),

  defineCommand({
    type: 'timeline.removeMarker',
    category: '时间轴',
    mutating: true,
    description: '删掉一个标记点。',
    schema: z.object({ id: zId }),
    example: { id: 'mk_abc' },
    handler: (draft, payload) => {
      const list = draft.markers ?? [];
      const index = list.findIndex((m) => m.id === payload.id);
      if (index < 0) throw new CommandFailure('NOT_FOUND', `标记点不存在：${payload.id}`);
      list.splice(index, 1);
      return { id: payload.id, count: list.length };
    },
  }),

  defineCommand({
    type: 'timeline.clearMarkers',
    category: '时间轴',
    mutating: true,
    description: '删掉所有标记点。',
    schema: z.object({}),
    example: {},
    handler: (draft) => {
      const count = draft.markers?.length ?? 0;
      draft.markers = [];
      return { removed: count };
    },
  }),
];

function requireMarker(draft: Project, id: string): Marker {
  const marker = (draft.markers ?? []).find((m) => m.id === id);
  if (!marker) throw new CommandFailure('NOT_FOUND', `标记点不存在：${id}`);
  return marker;
}
