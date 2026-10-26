import { setServices } from '@/core/services';
import { pushToast, updateUi, useEditor } from '@/core/store';
import { exec } from '@/core/commandBus';
import { uid } from '@/core/ids';
import { captureFrame, exportPng, exportProjectJson, exportWebm, buildFilename, downloadBlob } from '@/render/exporters';
import { blobOf, looksLikeZip } from '@/core/bundle';
import { preloadAssets, ensureAsset } from '@/render/assets';
import { idbDeleteAsset, idbDeleteCommand, idbGetAsset, idbListCommands, idbPutAsset, idbPutCommand } from '@/persist/idb';
import { loadFonts, registerFontFace, removeFont } from '@/persist/fonts';
import { getLayerWindowHost } from '@/windows/host';
import type { AssetMeta, CustomCommand } from '@/core/types';

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

/**
 * 导入暂存区：文件二进制不进命令 payload。
 * 命令是 JSON，几十 MB 的 zip 转 base64 既占内存又会被 schema 上限挡住；
 * 所以 UI 先把 File 读成字节放这儿，命令只拿一个 stageId 来取。
 * 不落 IndexedDB：刷新页面就失效，正好符合「选完就导」的一次性语义。
 */
const stages = new Map<string, { bytes: Uint8Array; name: string; at: number }>();
const STAGE_TTL = 5 * 60 * 1000;

function pruneStages(): void {
  const now = Date.now();
  for (const [id, item] of stages) if (now - item.at > STAGE_TTL) stages.delete(id);
}

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
    async saveBundle(bytes, project) {
      const filename = buildFilename(project, 'kly');
      downloadBlob(blobOf(bytes, 'application/zip'), filename);
      pushToast('success', t('已导出 {name}', { name: filename }));
      return { filename, bytes: bytes.length };
    },
    async stageBundle(file) {
      pruneStages();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const stageId = uid('st');
      stages.set(stageId, { bytes, name: file.name, at: Date.now() });
      /* 顺手认一下格式：ZIP 走 importBundle，纯 JSON 走旧的 project.load */
      return { stageId, name: file.name, bytes: bytes.length, zip: looksLikeZip(bytes) };
    },
    async takeBundleStage(stageId) {
      pruneStages();
      const item = stages.get(stageId);
      if (!item) return null;
      stages.delete(stageId);
      return item.bytes;
    },
    async peekBundleStage(stageId) {
      pruneStages();
      const item = stages.get(stageId);
      if (!item) return null;
      /* 偷看不刷新 at：TTL 从「选中文件」那一刻算起，免得反复预检把一份过期文件续命 */
      return { name: item.name, bytes: item.bytes };
    },
    async saveTextFile(filename, text, mime = 'application/json') {
      const blob = new Blob([text], { type: `${mime};charset=utf-8` });
      downloadBlob(blob, filename);
      pushToast('success', t('已导出 {name}', { name: filename }));
      return { filename, bytes: blob.size };
    },
    async saveBinaryFile(filename, bytes, mime = 'application/zip') {
      const blob = blobOf(bytes, mime);
      downloadBlob(blob, filename);
      pushToast('success', t('已导出 {name}', { name: filename }));
      return { filename, bytes: blob.size };
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
    async readAsset(id) {
      const rec = await idbGetAsset(id);
      if (!rec) return null;
      return { bytes: new Uint8Array(await rec.blob.arrayBuffer()), mime: rec.mime, name: rec.name };
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
    closeAllLayerWindows() {
      /* 浮动面板只活在 ui 里，popup / 画中画在 host 里；两边都要收 */
      const ids = new Set<string>([...useEditor.getState().ui.floatingWindows, ...host.listOpen()]);
      for (const id of ids) host.close(id);
      updateUi((ui) => {
        ui.floatingWindows = [];
      });
    },
    async preloadProjectAssets(project) {
      await preloadAssets(project.assets);
    },
    notify(kind, text) {
      pushToast(kind, text);
    },
    async listCustomCommands() {
      const rows = await idbListCommands<CustomCommand>();
      /* 手工比一遍 id：库里的脏数据（手动改过 IndexedDB）不该让整份列表失效 */
      return rows.filter((r) => r && typeof r.id === 'string' && Array.isArray(r.steps));
    },
    async saveCustomCommand(cmd) {
      await idbPutCommand({
        ...cmd,
        steps: cmd.steps.map((s) => ({ ...s, payload: s.payload ?? {} })),
      });
    },
    async removeCustomCommand(id) {
      await idbDeleteCommand(id);
    },
    async runSteps(steps) {
      /*
       * 用 command.batch 而不是自己循环 exec：批量执行器已经处理好三件麻烦事 ——
       * 失败回滚、合并成一个撤销点、逐条审计。宏只是它的一个调用方。
       */
      const res = await exec<{
        results: { type: string; ok: boolean; error?: { code: string; message: string } }[];
        rolledBack?: boolean;
      }>('command.batch', { commands: steps, atomic: true });
      if (!res.ok) {
        const results = (res.data as { results?: { type: string; ok: boolean; error?: { code: string; message: string } }[] } | undefined)?.results;
        return { ok: false, results: results ?? steps.map((s) => ({ type: s.type, ok: false, error: res.error })) };
      }
      return { ok: true, results: res.data?.results ?? steps.map((s) => ({ type: s.type, ok: true })) };
    },
  });
}
