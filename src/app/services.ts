import { setServices } from '@/core/services';
import { pushToast, resetProjectState, useEditor } from '@/core/store';
import { uid } from '@/core/ids';
import { captureFrame, exportPng, exportProjectJson, exportWebm } from '@/render/exporters';
import { preloadAssets, ensureAsset } from '@/render/assets';
import { idbDeleteAsset, idbPutAsset } from '@/persist/idb';
import { loadFonts, registerFontFace, removeFont } from '@/persist/fonts';
import { getLayerWindowHost } from '@/windows/host';
import type { AssetMeta } from '@/core/types';

import { t } from '@/i18n';
function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, b64] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(meta ?? '')?.[1] ?? 'application/octet-stream';
  const bin = atob(b64 ?? '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function measure(blob: Blob, kind: 'image' | 'video'): Promise<{ width?: number; height?: number }> {
  try {
    if (kind === 'image') {
      const bmp = await createImageBitmap(blob);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close();
      return size;
    }
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    const size = await new Promise<{ width?: number; height?: number }>((resolve) => {
      video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
      video.onerror = () => resolve({});
      setTimeout(() => resolve({}), 4000);
    });
    URL.revokeObjectURL(url);
    return size;
  } catch {
    return {};
  }
}

let installed = false;

export function ensureServices(): void {
  if (installed) return;
  installed = true;
  const host = getLayerWindowHost();

  setServices({
    async exportPng(opts) {
      const project = useEditor.getState().project;
      const result = await exportPng(project, opts);
      pushToast('success', t('已导出 {name}', { name: result.filename }));
      return result;
    },
    async exportWebm(opts, onProgress) {
      const project = useEditor.getState().project;
      const result = await exportWebm(project, opts, onProgress);
      pushToast('success', t('已导出 {name}（{n} 帧）', { name: result.filename, n: result.frames }));
      return result;
    },
    async exportJson() {
      const project = useEditor.getState().project;
      const result = exportProjectJson(project);
      pushToast('success', t('已导出 {name}', { name: result.filename }));
      return result;
    },
    async capture(opts) {
      const project = useEditor.getState().project;
      return captureFrame(project, { maxWidth: opts.maxWidth ?? 720, layerId: opts.layerId ?? null, time: opts.time });
    },
    async importAsset(input) {
      const blob = dataUrlToBlob(input.dataUrl);
      const kind: 'image' | 'video' = input.mime.startsWith('video') ? 'video' : 'image';
      const size = await measure(blob, kind);
      const meta: AssetMeta = {
        id: uid('as'),
        name: input.name,
        kind,
        mime: input.mime,
        size: blob.size,
        createdAt: Date.now(),
        ...size,
      };
      await idbPutAsset({ ...meta, blob });
      void ensureAsset(meta.id, kind);
      return meta;
    },
    async removeAsset(id) {
      await idbDeleteAsset(id);
    },
    async registerFont(input) {
      await registerFontFace({
        family: input.family,
        weight: input.weight,
        style: input.style,
        dataUrl: input.dataUrl,
      });
    },
    async removeFont(family) {
      await removeFont(family);
    },
    async loadFonts(families) {
      return loadFonts(families);
    },
    async openLayerWindow(layerId, mode) {
      let result = await host.open(layerId, mode);
      if (result.ok) return result;
      const reason = result.message ?? t('打开失败');
      if (mode !== 'pip') {
        const pip = await host.open(layerId, 'pip');
        if (pip.ok) return pip;
      }
      const panel = await host.open(layerId, 'panel');
      return panel.ok ? { ...panel, message: t('{reason}，已降级为应用内浮动窗口', { reason }) } : panel;
    },
    closeLayerWindow(layerId) {
      host.close(layerId);
    },
    focusLayerWindow(layerId) {
      host.focus(layerId);
    },
    async loadProject(project) {
      resetProjectState(project);
      await preloadAssets(project.assets);
    },
    notify(kind, text) {
      pushToast(kind, text);
    },
  });
}
