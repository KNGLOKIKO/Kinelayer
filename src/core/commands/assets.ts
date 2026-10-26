import { z } from 'zod';
import { defineCommand, CommandFailure } from '../registry';
import { zBase64DataUrl, zFit, zId } from '../schemas';
import { createImageLayer, createVideoLayer } from '../defaults';
import { nextLayerName } from './_helpers';
import { invalidateAsset } from '@/render/assets';
import type { Layer } from '../types';

export const assetCommands = [
  defineCommand({
    type: 'asset.import',
    category: '资源',
    mutating: true,
    asyncHandler: true,
    description:
      '导入图片或视频（dataURL，仅 UI 上传时使用；AI 不应调用）。二进制写入 IndexedDB，项目里只留元数据。返回 assetId。',
    schema: z.object({
      name: z.string().min(1).max(160),
      mime: z.string().min(3).max(100),
      dataUrl: zBase64DataUrl,
      kind: z.enum(['image', 'video']).default('image'),
    }),
    example: { name: 'bg.png', mime: 'image/png', dataUrl: 'data:image/png;base64,...', kind: 'image' },
    handler: async (draft, payload, ctx) => {
      const meta = await ctx.services.importAsset({ name: payload.name, mime: payload.mime, dataUrl: payload.dataUrl });
      draft.assets.push(meta);
      return { ...meta, layers: draft.layers.length };
    },
  }),

  defineCommand({
    type: 'asset.remove',
    category: '资源',
    mutating: true,
    dangerous: true,
    asyncHandler: true,
    description: '删除资源元数据与 IndexedDB 中的二进制。removeLayers=true 时同时删除引用它的图层。',
    schema: z.object({ id: zId, removeLayers: z.boolean().default(false) }),
    example: { id: 'as_abc', removeLayers: true },
    handler: async (draft, payload, ctx) => {
      const index = draft.assets.findIndex((a) => a.id === payload.id);
      if (index < 0) throw new CommandFailure('NOT_FOUND', `资源不存在：${payload.id}`);
      draft.assets.splice(index, 1);

      const affected: string[] = [];
      for (const layer of draft.layers) {
        if (layer.type === 'background' && layer.assetId === payload.id) {
          layer.assetId = null;
          layer.kind = 'solid';
          continue;
        }
        if ((layer.type === 'image' || layer.type === 'video') && layer.assetId === payload.id) {
          affected.push(layer.id);
          layer.assetId = null;
        }
      }
      if (payload.removeLayers && affected.length) {
        draft.layers = draft.layers.filter((l) => !affected.includes(l.id));
      }
      await ctx.services.removeAsset(payload.id);
      invalidateAsset(payload.id);
      return { id: payload.id, removedLayers: payload.removeLayers ? affected.length : 0, clearedLayers: payload.removeLayers ? 0 : affected.length };
    },
  }),

  defineCommand({
    type: 'asset.assign',
    category: '资源',
    mutating: true,
    description:
      '把已导入的资源挂到已有的图片层/视频层上，位置、尺寸、关键帧全部保留。用于补上导入时缺失的资源；类型不匹配（视频挂图片层）会整批拒绝，不会只改一半。',
    schema: z.object({ ids: z.array(zId).min(1).max(200), assetId: zId }),
    example: { ids: ['ly_abc'], assetId: 'as_abc' },
    handler: (draft, payload) => {
      const meta = draft.assets.find((a) => a.id === payload.assetId);
      if (!meta) throw new CommandFailure('NOT_FOUND', `资源不存在：${payload.assetId}`);
      const targets = payload.ids.map((id) => {
        const layer = draft.layers.find((l) => l.id === id);
        if (!layer) throw new CommandFailure('NOT_FOUND', `图层不存在：${id}`);
        if (layer.type !== 'image' && layer.type !== 'video') {
          throw new CommandFailure('VALIDATION', `「${layer.name}」不是图片/视频层，挂不了资源`);
        }
        if (layer.type === 'image' && meta.kind === 'video') {
          throw new CommandFailure('VALIDATION', `视频资源不能挂到图片层「${layer.name}」`);
        }
        if (layer.type === 'video' && meta.kind !== 'video') {
          throw new CommandFailure('VALIDATION', `图片资源不能挂到视频层「${layer.name}」`);
        }
        return layer;
      });
      /* 先校验完再动手：一批里有一层不合适就整批不改，避免用户看到「改了一半」 */
      for (const layer of targets) {
        (layer as { assetId: string | null }).assetId = meta.id;
      }
      return { ids: payload.ids, assetId: meta.id, name: meta.name };
    },
  }),

  defineCommand({
    type: 'asset.place',
    category: '资源',
    mutating: true,
    description: '把已导入的资源放到画布上，自动创建图片层或视频层。不传尺寸时按资源比例适配画布的 60%。',
    schema: z.object({
      assetId: zId,
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().min(1).optional(),
      height: z.number().min(1).optional(),
      fit: zFit.optional(),
      atIndex: z.number().int().min(1).optional(),
    }),
    example: { assetId: 'as_abc', width: 720 },
    handler: (draft, payload) => {
      const meta = draft.assets.find((a) => a.id === payload.assetId);
      if (!meta) throw new CommandFailure('NOT_FOUND', `资源不存在：${payload.assetId}`);
      const maxW = draft.width * 0.72;
      const ratio = meta.width && meta.height ? meta.width / meta.height : 4 / 3;
      let width = payload.width ?? Math.min(maxW, meta.width ?? maxW);
      let height = payload.height ?? Math.round(width / ratio);
      if (payload.width && !payload.height) height = Math.round(payload.width / ratio);
      if (!payload.width && payload.height) width = Math.round(payload.height * ratio);
      const x = payload.x ?? Math.round((draft.width - width) / 2);
      const y = payload.y ?? Math.round((draft.height - height) / 2);
      const layer: Layer =
        meta.kind === 'video'
          ? createVideoLayer({ x, y, width, height, assetId: meta.id, name: meta.name, fit: payload.fit ?? 'cover' })
          : createImageLayer({ x, y, width, height, assetId: meta.id, name: meta.name, fit: payload.fit ?? 'cover' });
      layer.name = nextLayerName(draft, meta.name || layer.name);
      const index = payload.atIndex ? Math.min(payload.atIndex, draft.layers.length) : draft.layers.length;
      draft.layers.splice(index, 0, layer);
      return { id: layer.id, index, width, height };
    },
  }),
];

