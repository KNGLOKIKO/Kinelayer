/**
 * 「选一个文件导进来」的唯一入口。
 *
 * 两种格式共用同一个按钮：
 *   · 前 4 字节是 PK → 新版 .kly（ZIP 工程包）→ project.importBundle
 *   · 否则就是旧版大 JSON 备份 → project.load（覆盖当前文档，行为与旧版一致）
 *
 * 文件字节先落到 services 的暂存区，命令只拿 stageId —— 几十 MB 的 zip 不走 JSON。
 */

import { exec } from '@/core/commandBus';
import { getServices } from '@/core/services';
import { pushToast } from '@/core/store';
import { BUNDLE_ACCEPT } from '@/core/bundle';
import { t } from '@/i18n';

export interface ImportOutcome {
  ok: boolean;
  projectId?: string;
  message?: string;
}

export async function importProjectFile(file: File): Promise<ImportOutcome> {
  const services = getServices();
  let stage: { stageId: string; name: string; bytes: number; zip: boolean };
  try {
    stage = await services.stageBundle(file);
  } catch (err) {
    const message = (err as Error).message || t('读取文件失败');
    pushToast('error', message);
    return { ok: false, message };
  }

  if (stage.zip) {
    const res = await exec<{ projectId: string; name: string; assets: number; fonts: number }>('project.importBundle', {
      stageId: stage.stageId,
    });
    if (!res.ok || !res.data) {
      const message = res.error?.message ?? t('导入失败');
      pushToast('error', message, 6000);
      return { ok: false, message };
    }
    pushToast('success', t('已导入「{name}」· {n} 个资源', { name: res.data.name, n: res.data.assets }));
    return { ok: true, projectId: res.data.projectId };
  }

  const bytes = await services.takeBundleStage(stage.stageId);
  if (!bytes) {
    const message = t('导入文件已过期，请重新选择');
    pushToast('error', message);
    return { ok: false, message };
  }
  const text = new TextDecoder().decode(bytes);
  const res = await exec('project.load', { data: text });
  if (!res.ok) {
    const message = res.error?.message ?? t('导入失败');
    pushToast('error', message, 6000);
    return { ok: false, message };
  }
  pushToast('success', t('已载入旧版 JSON 备份（资源需另行导入）'), 5000);
  return { ok: true };
}

/** 打开系统文件选择框；onPick 里做真正的导入 */
export function pickProjectFile(onPick: (file: File) => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = BUNDLE_ACCEPT;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onPick(file);
  };
  input.click();
}
