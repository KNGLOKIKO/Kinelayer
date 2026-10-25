import { z } from 'zod';
import { defineCommand, CommandFailure } from '../registry';
import {
  zAnim,
  zAnimation,
  zBindings,
  zBlend,
  zCodeSpec,
  zFit,
  zGradient,
  zId,
  zIds,
  zLayerPatch,
  zTextStylePatch,
} from '../schemas';
import { createCodeLayer, createImageLayer, createTextLayer, createVideoLayer, defaultCodeSpec } from '../defaults';
import type { Layer } from '../types';
import { applyAnimationPatch, enforceInvariants, findLayer, findLayerIndex, nextLayerName } from './_helpers';
import { autoKeyframePatch } from './animation';

const zCreateType = z.enum(['text', 'image', 'video', 'code']);

export const layerCommands = [
  defineCommand({
    type: 'layer.create',
    category: '图层',
    mutating: true,
    description: '创建一个图层并返回其 id。不传 x/y 时自动居中；不传宽高时使用该类型的默认尺寸。',
    schema: z.object({
      type: zCreateType.describe('图层类型'),
      name: z.string().min(1).max(80).optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().min(1).max(100_000).optional(),
      height: z.number().min(1).max(100_000).optional(),
      text: z.string().max(20_000).optional().describe('文本层内容'),
      textStyle: zTextStylePatch.optional(),
      assetId: z.string().min(1).optional().describe('图片/视频层的资源 id'),
      code: zCodeSpec.partial().optional().describe('代码层的引擎与源码'),
      atIndex: z.number().int().min(1).optional().describe('插入到第几层（0 是背景，不可占用）'),
    }),
    example: { type: 'text', text: 'Hello MotionLayer', x: 96, y: 120, width: 720, height: 160 },
    handler: (draft, payload) => {
      const width = payload.width ?? (payload.type === 'text' ? Math.min(900, draft.width - 120) : 520);
      const height = payload.height ?? (payload.type === 'text' ? 180 : 520);
      const x = payload.x ?? Math.round((draft.width - width) / 2);
      const y = payload.y ?? Math.round((draft.height - height) / 2);

      let layer: Layer;
      if (payload.type === 'text') {
        layer = createTextLayer({
          x,
          y,
          width,
          height,
          text: payload.text ?? '双击编辑文字',
          style: { ...createTextLayer().style, ...(payload.textStyle ?? {}) },
        });
      } else if (payload.type === 'image') {
        layer = createImageLayer({ x, y, width, height, assetId: payload.assetId ?? null });
      } else if (payload.type === 'video') {
        layer = createVideoLayer({ x, y, width, height, assetId: payload.assetId ?? null });
      } else {
        layer = createCodeLayer({
          x,
          y,
          width,
          height,
          code: { ...defaultCodeSpec(), ...(payload.code ?? {}) },
        });
      }
      layer.id = layer.id || `ly_${Date.now().toString(36)}`;
      layer.name = payload.name ?? nextLayerName(draft, layer.name);
      const index = payload.atIndex ? Math.min(payload.atIndex, draft.layers.length) : draft.layers.length;
      draft.layers.splice(index, 0, layer);
      return { id: layer.id, name: layer.name, index };
    },
  }),

  defineCommand({
    type: 'layer.update',
    category: '图层',
    mutating: true,
    coalesce: true,
    description:
      '修改图层的基础属性（位置、尺寸、旋转、透明度、可见、锁定、混合模式、表达式绑定、动画、时间区间）。只传需要改的字段。',
    schema: z.object({ id: zId, patch: zLayerPatch }),
    example: { id: 'ly_abc', patch: { x: 120, y: 240, opacity: 0.8, rotation: 4 } },
    handler: (draft, payload, ctx) => {
      const layer = findLayer(draft, payload.id);
      const p = payload.patch;
      const keys = [
        'name',
        'x',
        'y',
        'width',
        'height',
        'rotation',
        'opacity',
        'visible',
        'locked',
        'blendMode',
        'bindings',
        'inPoint',
        'outPoint',
        'meta',
      ] as const;
      const changed: string[] = [];
      for (const key of keys) {
        const value = p[key];
        if (value === undefined) continue;
        (layer as unknown as Record<string, unknown>)[key] = value;
        changed.push(key);
      }
      if (p.animation) {
        applyAnimationPatch(layer.animation, p.animation);
        changed.push('animation');
      }
      if (layer.type === 'background') {
        // 背景的几何由画布决定，这里只允许改透明度与混合模式
        layer.x = 0;
        layer.y = 0;
      }
      // v2 自动关键帧：属性已有轨道时，改动在当前播放头落成一个关键帧。
      // 放在命令层而不是 UI 层，是为了让 AI / Agent / 图层窗口的改动行为完全一致。
      const keyed = autoKeyframePatch(layer, p as Record<string, unknown>, ctx.playhead);
      if (keyed.length) changed.push(`keyframes(${keyed.join(',')})`);
      return { id: layer.id, changed };
    },
  }),

  defineCommand({
    type: 'layer.delete',
    category: '图层',
    mutating: true,
    dangerous: true,
    description: '删除若干图层。背景层与锁定图层会被跳过（除非 force=true）。',
    schema: z.object({ ids: zIds, force: z.boolean().default(false) }),
    example: { ids: ['ly_abc'], force: false },
    handler: (draft, payload) => {
      const removed: string[] = [];
      const skipped: { id: string; reason: string }[] = [];
      for (const id of payload.ids) {
        const layer = draft.layers.find((l) => l.id === id);
        if (!layer) {
          skipped.push({ id, reason: '不存在' });
          continue;
        }
        if (layer.type === 'background') {
          skipped.push({ id, reason: '背景层不可删除' });
          continue;
        }
        if (layer.locked && !payload.force) {
          skipped.push({ id, reason: '图层已锁定' });
          continue;
        }
        draft.layers = draft.layers.filter((l) => l.id !== id);
        removed.push(id);
      }
      return { removed, skipped };
    },
  }),

  defineCommand({
    type: 'layer.duplicate',
    category: '图层',
    mutating: true,
    description: '复制图层，副本向右下偏移 24px，返回新 id 列表。',
    schema: z.object({ ids: zIds, offset: z.number().min(0).max(200).default(24) }),
    example: { ids: ['ly_abc'] },
    handler: (draft, payload) => {
      const created: string[] = [];
      for (const id of payload.ids) {
        const index = findLayerIndex(draft, id);
        const source = draft.layers[index];
        if (!source || source.type === 'background') continue;
        const clone = JSON.parse(JSON.stringify(source)) as Layer;
        clone.id = `ly_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        clone.name = nextLayerName(draft, `${source.name} 副本`);
        clone.x += payload.offset;
        clone.y += payload.offset;
        draft.layers.splice(index + 1, 0, clone);
        created.push(clone.id);
      }
      return { ids: created };
    },
  }),

  defineCommand({
    type: 'layer.reorder',
    category: '图层',
    mutating: true,
    description: '调整图层 z 序。toIndex 是 layers 数组下标（0 为背景，实际最小为 1），数值越大越靠上。',
    schema: z.object({ id: zId, toIndex: z.number().int().min(1) }),
    example: { id: 'ly_abc', toIndex: 3 },
    handler: (draft, payload) => {
      const from = findLayerIndex(draft, payload.id);
      const layer = draft.layers[from];
      if (!layer) throw new CommandFailure('NOT_FOUND', '图层不存在');
      if (layer.type === 'background') throw new CommandFailure('INVARIANT', '背景层不可调整层级');
      const to = Math.max(1, Math.min(payload.toIndex, draft.layers.length - 1));
      draft.layers.splice(from, 1);
      draft.layers.splice(to, 0, layer);
      return { id: layer.id, index: to };
    },
  }),

  defineCommand({
    type: 'layer.setVisible',
    category: '图层',
    mutating: true,
    description: '显示/隐藏图层。',
    schema: z.object({ id: zId, visible: z.boolean() }),
    example: { id: 'ly_abc', visible: false },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      if (layer.type === 'background') layer.visible = true;
      else layer.visible = payload.visible;
      return { id: layer.id, visible: layer.visible };
    },
  }),

  defineCommand({
    type: 'layer.setLocked',
    category: '图层',
    mutating: true,
    description: '锁定/解锁图层。锁定后不能被选中拖动，也不能被 AI 删除。',
    schema: z.object({ id: zId, locked: z.boolean() }),
    example: { id: 'ly_abc', locked: true },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      layer.locked = layer.type === 'background' ? true : payload.locked;
      return { id: layer.id, locked: layer.locked };
    },
  }),

  defineCommand({
    type: 'layer.rename',
    category: '图层',
    mutating: true,
    description: '重命名图层。',
    schema: z.object({ id: zId, name: z.string().min(1).max(80) }),
    example: { id: 'ly_abc', name: '主标题' },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      layer.name = payload.name;
      return { id: layer.id, name: layer.name };
    },
  }),

  defineCommand({
    type: 'layer.align',
    category: '图层',
    mutating: true,
    description: '把若干图层对齐到画布的左/水平居中/右/上/垂直居中/下。',
    schema: z.object({
      ids: zIds,
      mode: z.enum(['left', 'center-x', 'right', 'top', 'center-y', 'bottom']),
    }),
    example: { ids: ['ly_abc'], mode: 'center-x' },
    handler: (draft, payload) => {
      const done: string[] = [];
      for (const id of payload.ids) {
        const layer = findLayer(draft, id);
        if (layer.type === 'background' || layer.locked) continue;
        switch (payload.mode) {
          case 'left':
            layer.x = 0;
            break;
          case 'center-x':
            layer.x = Math.round((draft.width - layer.width) / 2);
            break;
          case 'right':
            layer.x = draft.width - layer.width;
            break;
          case 'top':
            layer.y = 0;
            break;
          case 'center-y':
            layer.y = Math.round((draft.height - layer.height) / 2);
            break;
          case 'bottom':
            layer.y = draft.height - layer.height;
            break;
          default:
            break;
        }
        done.push(id);
      }
      return { aligned: done };
    },
  }),

  defineCommand({
    type: 'layer.setAnimation',
    category: '图层',
    mutating: true,
    description:
      '设置图层的入场/退场/强调动画。槽位传 null 表示清除。preset 取 none|fade|slide-up|slide-down|slide-left|slide-right|zoom-in|zoom-out|pulse|float|spin。',
    schema: z.object({ id: zId, animation: zAnimation }),
    example: {
      id: 'ly_abc',
      animation: { enter: { preset: 'slide-up', duration: 800, delay: 120, easing: 'ease-out', intensity: 0.7 } },
    },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      applyAnimationPatch(layer.animation, payload.animation);
      return { id: layer.id, animation: layer.animation };
    },
  }),

  defineCommand({
    type: 'layer.setBindings',
    category: '图层',
    mutating: true,
    description:
      '设置属性表达式绑定。表达式按帧求值，可用 time(ms)/frame/w/h/i 与 Math 函数，例如 "sin(time*0.001)*10"。传 {} 清空。',
    schema: z.object({ id: zId, bindings: zBindings }),
    example: { id: 'ly_abc', bindings: { rotation: 'sin(time * 0.001) * 6', opacity: '0.6 + 0.4 * sin(time * 0.002)' } },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      layer.bindings = payload.bindings as Layer['bindings'];
      return { id: layer.id, bindings: layer.bindings };
    },
  }),

  defineCommand({
    type: 'layer.setBlendMode',
    category: '图层',
    mutating: true,
    description: '设置图层混合模式。',
    schema: z.object({ id: zId, blendMode: zBlend }),
    example: { id: 'ly_abc', blendMode: 'screen' },
    handler: (draft, payload) => {
      const layer = findLayer(draft, payload.id);
      layer.blendMode = payload.blendMode;
      return { id: layer.id, blendMode: layer.blendMode };
    },
  }),

  defineCommand({
    type: 'layer.fixAll',
    category: '图层',
    mutating: true,
    description: '结构性自检：把越界图层拉回画布、修复时间区间、去重 id。用于 AI 收尾或用户点「整理画布」。',
    schema: z.object({}),
    example: {},
    handler: (draft) => {
      let fixed = 0;
      for (const layer of draft.layers) {
        if (layer.type === 'background') continue;
        if (layer.width > draft.width * 2) {
          layer.width = draft.width;
          fixed += 1;
        }
        if (layer.x > draft.width) {
          layer.x = draft.width - Math.min(layer.width, draft.width);
          fixed += 1;
        }
        if (layer.y > draft.height) {
          layer.y = draft.height - Math.min(layer.height, draft.height);
          fixed += 1;
        }
        if (layer.x + layer.width < 0) {
          layer.x = 0;
          fixed += 1;
        }
        if (layer.y + layer.height < 0) {
          layer.y = 0;
          fixed += 1;
        }
      }
      enforceInvariants(draft);
      return { fixed };
    },
  }),
];
