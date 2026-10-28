/**
 * 剪辑命令：裁剪、分割、转场。
 *
 * 三条命令都只改「时间与源偏移」，不改画面内容 —— 这是非破坏性剪辑的底线：
 * 用户裁掉的素材永远还在 IndexedDB 里，把 outPoint 拉回去就回来了。
 *
 * 为什么分割要做成命令而不是 UI 里拆对象：分割必须和撤销、Agent、图层窗口
 * 走同一条路。UI 里直接改数组的话，撤销栈里只会留下一个「莫名其妙少了一层」。
 */

import { z } from 'zod';
import { defineCommand, CommandFailure } from '../registry';
import { zId } from '../schemas';
import { uid } from '../ids';
import { clipEnd, clipLength, MIN_CLIP_MS } from '../media';
import { findLayer } from './_helpers';
import type { AudioLayer, Layer, LayerAnimation, VideoLayer } from '../types';

const zTransitionKind = z.enum(['crossfade', 'dip', 'slide', 'wipe']);

/** 把一条轨道上的关键帧按分割点切开：左半留前半段，右半把时间轴平移到新起点 */
function splitTracks(anim: LayerAnimation | undefined, offsetMs: number): { left: LayerAnimation | undefined; right: LayerAnimation | undefined } {
  if (!anim || !anim.tracks?.length) return { left: anim, right: anim ? { ...anim, tracks: [] } : undefined };
  const leftTracks = [];
  const rightTracks = [];
  for (const track of anim.tracks) {
    const leftKfs = track.keyframes.filter((k) => k.time <= offsetMs + 0.5);
    const rightKfs = track.keyframes
      .filter((k) => k.time > offsetMs + 0.5)
      .map((k) => ({ ...k, id: uid('kf'), time: Math.max(0, k.time - offsetMs) }));
    if (leftKfs.length) leftTracks.push({ ...track, keyframes: leftKfs });
    if (rightKfs.length) rightTracks.push({ ...track, id: uid('tr'), keyframes: rightKfs });
  }
  return { left: { ...anim, tracks: leftTracks }, right: { ...anim, tracks: rightTracks } };
}

export const mediaCommands = [
  defineCommand({
    type: 'layer.trim',
    category: '时间轴',
    mutating: true,
    coalesce: true,
    description:
      '裁剪一个片段：改时间轴上的入点/出点，以及素材内的偏移（trimIn）。' +
      '视频/音频的 trimIn 是「这段从素材第几毫秒开始」；拖左边缘时 UI 会同时调整 inPoint 与 trimIn，' +
      '所以素材不会跟着片段一起滑动。',
    schema: z.object({
      id: zId,
      inPoint: z.number().min(0).max(600_000).optional(),
      outPoint: z.number().min(0).max(600_000).optional().describe('0 = 持续到工程结尾'),
      trimIn: z.number().min(0).max(24 * 3600_000).optional(),
      playbackRate: z.number().min(0.1).max(8).optional(),
    }),
    example: { id: 'ly_clip', inPoint: 2000, outPoint: 6000, trimIn: 1500 },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      if (layer.type === 'background') throw new CommandFailure('VALIDATION', '背景层没有时间区间可裁');

      const end = clipEnd(layer, draft);
      if (payload.trimIn !== undefined) {
        if (layer.type === 'video' || layer.type === 'audio') layer.trimIn = Math.round(payload.trimIn);
      }
      if (payload.playbackRate !== undefined && layer.type === 'video') {
        layer.playbackRate = payload.playbackRate;
      }
      if (payload.inPoint !== undefined) {
        layer.inPoint = Math.round(Math.min(payload.inPoint, Math.max(0, end - MIN_CLIP_MS)));
      }
      if (payload.outPoint !== undefined) {
        const raw = Math.round(payload.outPoint);
        layer.outPoint = raw === 0 ? 0 : Math.min(draft.duration, Math.max(layer.inPoint + MIN_CLIP_MS, raw));
      }
      return {
        id: layer.id,
        inPoint: layer.inPoint,
        outPoint: layer.outPoint,
        length: clipLength(layer, draft),
        trimIn: 'trimIn' in layer ? layer.trimIn : 0,
        playbackRate: layer.type === 'video' ? layer.playbackRate : 1,
      };
    },
  }),

  defineCommand({
    type: 'layer.split',
    category: '时间轴',
    mutating: true,
    description:
      '在指定时刻把片段切成两段，返回新片段 id。视频/音频的右半段会自动累加 trimIn，' +
      '所以两段拼起来与原来逐帧一致。文本/图片不支持（它们在时间上不可切开，改入出点即可）。',
    schema: z.object({ id: zId, at: z.number().min(0).max(600_000) }),
    example: { id: 'ly_clip', at: 4200 },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      if (layer.locked) throw new CommandFailure('FORBIDDEN', `「${layer.name}」已锁定`);
      if (layer.type !== 'video' && layer.type !== 'audio' && layer.type !== 'code') {
        throw new CommandFailure('VALIDATION', '只有视频/音频/代码层可以分割；文本与图片请改入出点');
      }
      const end = clipEnd(layer, draft);
      const at = Math.round(payload.at);
      if (at <= layer.inPoint + MIN_CLIP_MS || at >= end - MIN_CLIP_MS) {
        throw new CommandFailure('VALIDATION', `分割点要在片段内部（${layer.inPoint + MIN_CLIP_MS}–${end - MIN_CLIP_MS}ms）`);
      }

      const originalOut = layer.outPoint;
      const offset = at - layer.inPoint;
      /*
       * 不能用 structuredClone：这里的 layer 是 immer 的 draft 代理，
       * DataCloneError（"#<Object> could not be cloned"）。JSON 往返虽然土，
       * 但 Project 里全是 JSON 安全的值，而且它读代理读的是当前状态，正好对。
       */
      const clone = JSON.parse(JSON.stringify(layer)) as Layer;
      clone.id = uid('ly');
      clone.name = `${layer.name} · B`;
      clone.inPoint = at;
      clone.outPoint = originalOut;
      if (clone.type === 'video' || clone.type === 'audio') {
        const rate = clone.type === 'video' ? Math.max(0.1, clone.playbackRate || 1) : 1;
        clone.trimIn = Math.round((layer as VideoLayer | AudioLayer).trimIn + offset * rate);
      }

      const parts = splitTracks(layer.animation, offset);
      layer.animation = parts.left ?? layer.animation;
      clone.animation = parts.right ?? layer.animation;
      layer.outPoint = at;

      const index = draft.layers.findIndex((l) => l.id === layer.id);
      draft.layers.splice(index + 1, 0, clone);
      return {
        id: layer.id,
        newId: clone.id,
        at,
        left: { inPoint: layer.inPoint, outPoint: layer.outPoint },
        right: { inPoint: clone.inPoint, outPoint: clone.outPoint, trimIn: 'trimIn' in clone ? clone.trimIn : 0 },
      };
    },
  }),

  defineCommand({
    type: 'layer.setTransition',
    category: '时间轴',
    mutating: true,
    description:
      '设置片段入点转场（与上一段交叉）。kind 传 null 表示硬切。' +
      'duration 会被夹到片段长度的一半以内，免得整段都在转场。',
    schema: z.object({
      id: zId,
      kind: zTransitionKind.nullable(),
      duration: z.number().min(0).max(10_000).default(500),
    }),
    example: { id: 'ly_clip', kind: 'crossfade', duration: 600 },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      if (layer.type !== 'image' && layer.type !== 'video') {
        throw new CommandFailure('VALIDATION', '只有图片/视频层有转场');
      }
      if (payload.kind === null) {
        layer.transition = null;
        return { id: layer.id, kind: null, duration: 0 };
      }
      const max = Math.max(0, clipLength(layer, draft) / 2);
      const duration = Math.round(Math.min(Math.max(0, payload.duration), max));
      layer.transition = { kind: payload.kind, duration };
      return { id: layer.id, kind: payload.kind, duration };
    },
  }),
];
