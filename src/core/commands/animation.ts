import { z } from 'zod';
import { defineCommand } from '../registry';
import { zAnimatableProperty, zEasingSpec, zId, zIds } from '../schemas';
import { findLayer } from './_helpers';
import { uid } from '../ids';
import { clamp } from '../geometry';
import { LIMITS, type AnimatableProperty, type EasingSpec, type Layer, type PropertyTrack } from '../types';
import { propertyValue } from '@/render/keyframes';

/**
 * v2 · 关键帧命令族
 * ---------------------------------------------------------------------------
 * 铁律不变：一帧动画的所有数据都是 Project 的一部分，所有改动都必须走总线、
 * 都要能撤销、都要能被 AI / MCP 调。时间一律是**相对图层 inPoint 的毫秒数**。
 */

const zTime = z.number().min(-60_000).max(LIMITS.duration.max).describe('相对图层 inPoint 的毫秒数');

/** 找到（或按需创建）某属性的轨道 */
function ensureTrack(layer: Layer, property: AnimatableProperty): PropertyTrack {
  if (!Array.isArray(layer.animation.tracks)) layer.animation.tracks = [];
  let track = layer.animation.tracks.find((t) => t.property === property);
  if (!track) {
    track = { property, keyframes: [] };
    layer.animation.tracks.push(track);
  }
  return track;
}

/** 轨道内按时间排序（数据层永远保持有序，求值层就敢线性扫描） */
function sortTrack(track: PropertyTrack): void {
  track.keyframes.sort((a, b) => a.time - b.time);
}

function findKeyframe(layer: Layer, property: AnimatableProperty, keyframeId: string) {
  const track = layer.animation.tracks?.find((t) => t.property === property);
  const kf = track?.keyframes.find((k) => k.id === keyframeId);
  if (!track || !kf) throw new Error(`关键帧不存在：${property}/${keyframeId}`);
  return { track, kf };
}

/** 去掉空轨道：不留「有轨道但没关键帧」的中间态，撤回时也不会留垃圾 */
function pruneTracks(layer: Layer): void {
  layer.animation.tracks = (layer.animation.tracks ?? []).filter((t) => t.keyframes.length > 0);
}

/**
 * v2 里「预设」只是关键帧的语法糖：生成完就是普通轨道，
 * 运行时不再有第二套动画系统。这样预设、手打、AI 打的点完全同权。
 */
export const ANIM_PRESET_TRACKS = [
  'fade-in',
  'rise',
  'zoom-in',
  'pop',
  'spin',
  'pulse',
] as const;
export type AnimPresetTrack = (typeof ANIM_PRESET_TRACKS)[number];

function presetKeyframes(
  preset: AnimPresetTrack,
  layer: Layer,
  duration: number,
): { property: AnimatableProperty; keyframes: { time: number; value: number; easing: EasingSpec }[] }[] {
  const w = layer.width;
  const h = layer.height;
  const easeOut: EasingSpec = { kind: 'ease-out-cubic' };
  const easeBack: EasingSpec = { kind: 'ease-out-back' };
  const easeInOut: EasingSpec = { kind: 'ease-in-out' };

  switch (preset) {
    case 'fade-in':
      return [{ property: 'opacity', keyframes: [{ time: 0, value: 0, easing: easeOut }, { time: duration, value: 1, easing: easeOut }] }];
    case 'rise':
      return [
        { property: 'y', keyframes: [{ time: 0, value: layer.y + h * 0.25, easing: easeOut }, { time: duration, value: layer.y, easing: easeOut }] },
        { property: 'opacity', keyframes: [{ time: 0, value: 0, easing: easeOut }, { time: Math.round(duration * 0.7), value: 1, easing: easeOut }] },
      ];
    case 'zoom-in':
      return [
        { property: 'width', keyframes: [{ time: 0, value: Math.round(w * 0.82), easing: easeOut }, { time: duration, value: w, easing: easeOut }] },
        { property: 'height', keyframes: [{ time: 0, value: Math.round(h * 0.82), easing: easeOut }, { time: duration, value: h, easing: easeOut }] },
        { property: 'opacity', keyframes: [{ time: 0, value: 0, easing: easeOut }, { time: Math.round(duration * 0.6), value: 1, easing: easeOut }] },
      ];
    case 'pop':
      return [
        { property: 'width', keyframes: [{ time: 0, value: Math.round(w * 0.7), easing: easeBack }, { time: duration, value: w, easing: easeOut }] },
        { property: 'height', keyframes: [{ time: 0, value: Math.round(h * 0.7), easing: easeBack }, { time: duration, value: h, easing: easeOut }] },
      ];
    case 'spin':
      return [{ property: 'rotation', keyframes: [{ time: 0, value: layer.rotation - 24, easing: easeBack }, { time: duration, value: layer.rotation, easing: easeOut }] }];
    case 'pulse':
      return [
        {
          property: 'opacity',
          keyframes: [
            { time: 0, value: 1, easing: easeInOut },
            { time: Math.round(duration / 2), value: 0.55, easing: easeInOut },
            { time: duration, value: 1, easing: easeInOut },
          ],
        },
      ];
    default:
      return [];
  }
}

export const animationCommands = [
  defineCommand({
    type: 'animation.setKeyframe',
    category: '动画',
    mutating: true,
    description:
      '在某个时间点写入关键帧（同属性同时间点会被覆盖）。time 是相对图层 inPoint 的毫秒数，不是绝对时间。value 必须给绝对值，不是增量。',
    schema: z.object({
      id: zId,
      property: zAnimatableProperty,
      time: zTime,
      value: z.number(),
      easing: zEasingSpec.optional(),
    }),
    example: { id: 'ly_abc', property: 'opacity', time: 0, value: 0, easing: { kind: 'ease-out' } },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      const track = ensureTrack(layer, payload.property);
      const time = Math.round(payload.time);
      const existing = track.keyframes.find((k) => Math.abs(k.time - time) <= 1);
      const easing = payload.easing ?? { kind: 'ease-out' as const };
      if (existing) {
        existing.value = payload.value;
        existing.easing = easing;
        return { id: layer.id, property: payload.property, keyframeId: existing.id, time, value: existing.value, replaced: true };
      }
      const kf = { id: uid('kf'), time, value: payload.value, easing };
      track.keyframes.push(kf);
      sortTrack(track);
      return { id: layer.id, property: payload.property, keyframeId: kf.id, time, value: kf.value, replaced: false };
    },
  }),

  defineCommand({
    type: 'animation.removeKeyframe',
    category: '动画',
    mutating: true,
    description: '删除若干关键帧。轨道被删空时整条轨道一起移除。',
    schema: z.object({ id: zId, property: zAnimatableProperty, keyframeIds: zIds }),
    example: { id: 'ly_abc', property: 'opacity', keyframeIds: ['kf_1'] },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      const track = layer.animation.tracks?.find((t) => t.property === payload.property);
      if (!track) throw new Error(`该图层没有 ${payload.property} 轨道`);
      const before = track.keyframes.length;
      const drop = new Set(payload.keyframeIds);
      track.keyframes = track.keyframes.filter((k) => !drop.has(k.id));
      const removed = before - track.keyframes.length;
      pruneTracks(layer);
      return { id: layer.id, property: payload.property, removed };
    },
  }),

  defineCommand({
    type: 'animation.moveKeyframes',
    category: '动画',
    mutating: true,
    description:
      '批量平移/移动关键帧。传 delta 表示整体平移；传 moves 表示逐帧指定新时间（多选拖动用）。时间会被夹在图层可见区间内。',
    schema: z.object({
      id: zId,
      delta: z.number().min(-60_000).max(60_000).optional(),
      moves: z
        .array(z.object({ property: zAnimatableProperty, keyframeId: z.string().min(1).max(64), time: zTime }))
        .max(200)
        .optional(),
    }),
    example: { id: 'ly_abc', delta: 200 },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      const maxTime = draft.duration - layer.inPoint;
      const touched: string[] = [];
      if (payload.moves && payload.moves.length) {
        for (const mv of payload.moves) {
          const { kf } = findKeyframe(layer, mv.property, mv.keyframeId);
          kf.time = Math.round(clamp(mv.time, 0, maxTime));
          touched.push(kf.id);
        }
      } else if (payload.delta) {
        for (const track of layer.animation.tracks ?? []) {
          for (const kf of track.keyframes) {
            kf.time = Math.round(clamp(kf.time + payload.delta, 0, maxTime));
            touched.push(kf.id);
          }
        }
      }
      for (const track of layer.animation.tracks ?? []) sortTrack(track);
      return { id: layer.id, moved: touched.length };
    },
  }),

  defineCommand({
    type: 'animation.setEasing',
    category: '动画',
    mutating: true,
    description: '修改某个关键帧「到下一帧」的缓动。支持全部预设名，或 cubic-bezier 自定义曲线。',
    schema: z.object({ id: zId, property: zAnimatableProperty, keyframeId: z.string().min(1).max(64), easing: zEasingSpec }),
    example: { id: 'ly_abc', property: 'opacity', keyframeId: 'kf_1', easing: { kind: 'cubic-bezier', bezier: [0.34, 1.56, 0.64, 1] } },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      const { kf } = findKeyframe(layer, payload.property, payload.keyframeId);
      kf.easing = payload.easing;
      return { id: layer.id, property: payload.property, keyframeId: kf.id, easing: kf.easing };
    },
  }),

  defineCommand({
    type: 'animation.setKeyframeValue',
    category: '动画',
    mutating: true,
    description: '只改某个关键帧的值（不动时间）。',
    schema: z.object({ id: zId, property: zAnimatableProperty, keyframeId: z.string().min(1).max(64), value: z.number() }),
    example: { id: 'ly_abc', property: 'opacity', keyframeId: 'kf_1', value: 0.8 },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      const { kf } = findKeyframe(layer, payload.property, payload.keyframeId);
      kf.value = payload.value;
      return { id: layer.id, property: payload.property, keyframeId: kf.id, value: kf.value };
    },
  }),

  defineCommand({
    type: 'animation.clearTrack',
    category: '动画',
    mutating: true,
    description: '清空某属性的整条轨道（不传 property 则清空该图层全部轨道）。',
    schema: z.object({ id: zId, property: zAnimatableProperty.optional() }),
    example: { id: 'ly_abc', property: 'opacity' },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      const before = layer.animation.tracks?.length ?? 0;
      layer.animation.tracks = payload.property
        ? (layer.animation.tracks ?? []).filter((t) => t.property !== payload.property)
        : [];
      return { id: layer.id, removedTracks: before - (layer.animation.tracks?.length ?? 0) };
    },
  }),

  defineCommand({
    type: 'animation.setAutoKeyframe',
    category: '动画',
    mutating: true,
    description:
      '开关该图层的自动关键帧：开启后，改动「已有轨道」的属性会在当前播放头自动打点；没有轨道的属性仍走普通修改。',
    schema: z.object({ id: zId, enabled: z.boolean() }),
    example: { id: 'ly_abc', enabled: true },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      layer.animation.autoKeyframe = payload.enabled;
      return { id: layer.id, autoKeyframe: layer.animation.autoKeyframe };
    },
  }),

  defineCommand({
    type: 'animation.applyPreset',
    category: '动画',
    mutating: true,
    description:
      `用预设快速生成关键帧（fade-in / rise / zoom-in / pop / spin / pulse）。生成的是普通轨道，之后可以逐帧改，不存在第二套运行时。`,
    schema: z.object({
      id: zId,
      preset: z.enum(ANIM_PRESET_TRACKS),
      duration: z.number().min(50).max(20_000).default(600),
    }),
    example: { id: 'ly_abc', preset: 'rise', duration: 800 },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      const generated = presetKeyframes(payload.preset, layer, Math.round(payload.duration));
      for (const g of generated) {
        const track = ensureTrack(layer, g.property);
        for (const k of g.keyframes) {
          const existing = track.keyframes.find((x) => Math.abs(x.time - k.time) <= 1);
          if (existing) {
            existing.value = k.value;
            existing.easing = k.easing;
          } else {
            track.keyframes.push({ id: uid('kf'), time: k.time, value: k.value, easing: k.easing });
          }
        }
        sortTrack(track);
      }
      return { id: layer.id, preset: payload.preset, tracks: generated.map((g) => g.property) };
    },
  }),
];

/**
 * 自动关键帧：`layer.update` 里对「已有轨道的属性」写点。
 * 放在这里而不是 UI 里，是因为 AI / MCP 改属性时也要有同样行为——
 * 否则「谁改的」会决定「数据长什么样」，那就不是一条总线了。
 */
export const AUTO_KEYFRAME_PROPERTIES: AnimatableProperty[] = [
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
];

export function autoKeyframePatch(
  layer: Layer,
  patch: Record<string, unknown>,
  playhead: number,
): string[] {
  if (!layer.animation?.autoKeyframe) return [];
  const localTime = Math.round(playhead - layer.inPoint);
  const written: string[] = [];
  for (const prop of AUTO_KEYFRAME_PROPERTIES) {
    const value = patch[prop];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const track = layer.animation.tracks?.find((t) => t.property === prop);
    if (!track || track.keyframes.length === 0) continue; // 没有轨道就不打点，交给普通修改
    const existing = track.keyframes.find((k) => Math.abs(k.time - localTime) <= 1);
    if (existing) {
      existing.value = value;
    } else {
      track.keyframes.push({ id: uid('kf'), time: localTime, value, easing: { kind: 'ease-out' } });
      sortTrack(track);
    }
    written.push(prop);
  }
  return written;
}

/** 给 UI 用：取某图层某属性的关键帧列表（只读副本，避免 UI 直接改 store 数据） */
export function trackOf(layer: Layer, property: AnimatableProperty): PropertyTrack | undefined {
  return layer.animation?.tracks?.find((t) => t.property === property && t.keyframes.length > 0);
}

/** 给 UI 用：某属性当前静态值（打第一个关键帧时用它做初值） */
export function currentValue(layer: Layer, property: AnimatableProperty): number {
  return propertyValue(layer, property);
}
