import { exec } from '@/core/commandBus';
import { pushToast } from '@/core/store';
import { t } from '@/i18n';

/** 本地文件 → dataURL。FileReader 而不是 arrayBuffer，是因为下游要的就是 dataURL */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(t('读取文件失败')));
    reader.readAsDataURL(file);
  });
}

/**
 * 把一个本地文件写进资源库，返回资源 id（失败返回 null）。
 *
 * 单独一个模块而不是塞在资源面板里，是因为有两条用法：
 * 资源面板是「导入 + 放到画布上」，补缺失资源是「导入 + 挂到已有图层上」——
 * 后者不能新建图层，否则用户补一张图会多出一个重影层。类型/大小校验只写一份。
 */
export async function uploadAsset(file: File): Promise<{ id: string; kind: 'image' | 'video' | 'audio' } | null> {
  const kind: 'image' | 'video' | 'audio' | null = file.type.startsWith('video')
    ? 'video'
    : file.type.startsWith('audio')
      ? 'audio'
      : file.type.startsWith('image')
        ? 'image'
        : null;
  if (!kind) {
    pushToast('warn', t('跳过不支持的文件：{name}', { name: file.name }));
    return null;
  }
  if (file.size > 96 * 1024 * 1024) {
    pushToast('error', t('{name} 超过 96MB，已跳过', { name: file.name }));
    return null;
  }
  try {
    const dataUrl = await fileToDataUrl(file);
    const res = await exec<{ id: string }>('asset.import', {
      name: file.name,
      mime: file.type || (kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : 'image/png'),
      dataUrl,
      kind,
    });
    if (res.ok && res.data?.id) return { id: res.data.id, kind };
    pushToast('error', res.error?.message ?? t('导入失败'));
    return null;
  } catch (err) {
    pushToast('error', (err as Error).message);
    return null;
  }
}
