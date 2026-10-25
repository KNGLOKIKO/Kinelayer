/**
 * 「选文件 → 预检 → 确认 → 导入」这条链的状态机。
 *
 * 为什么要有这一步（v2.5 阶段 A 的硬要求）：
 *   导入是有损的。以前点开文件就直接写库，用户/Agent 拿到的是一个「看起来成功」的工程，
 *   却不知道丢了哪些东西。现在强制两步：先 `ai.inspectImport` 出一份降级报告，
 *   用户看过、确认了，才 `ai.importProject`。报告里的数字和正式导入来自同一个映射器，
 *   所以不存在「预检说 12 层，导进来 3 层」的错位。
 *
 * 状态放在模块级 zustand 里而不是某个组件里：入口有两个（启动页、设置页数据页），
 * 对话框只挂一份，谁触发都能弹出来。
 */

import { create } from 'zustand';
import { exec } from '@/core/commandBus';
import { getServices } from '@/core/services';
import { pushToast, updateUi } from '@/core/store';
import type { ImportReport } from '@/core/importPipeline';
import { editorUrl, go } from './routes';
import { t } from '@/i18n';

export type ImportMode = 'prefer-editable' | 'preserve-code';

export interface PendingImport {
  stageId: string;
  fileName: string;
  /** .kly（ZIP）走 project.importBundle，需要校验 sha256 */
  zip: boolean;
  report: ImportReport;
  /** 预检本身失败（不是格式不支持，而是读不出来） */
  error?: string;
}

interface ImportFlowState {
  pending: PendingImport | null;
  busy: boolean;
  mode: ImportMode;
  setMode: (mode: ImportMode) => void;
  close: () => void;
}

export const useImportFlow = create<ImportFlowState>((set) => ({
  pending: null,
  busy: false,
  mode: 'prefer-editable',
  setMode: (mode) => set({ mode }),
  close: () => set({ pending: null, busy: false }),
}));

/**
 * 文件已经在暂存区（services.stageBundle），这里只做预检。
 * 用 peekBundleStage 而不是 take：确认后正式导入还要再读一次同一份字节。
 */
export async function beginImport(file: File): Promise<void> {
  const services = getServices();
  let stage: { stageId: string; name: string; bytes: number; zip: boolean };
  try {
    stage = await services.stageBundle(file);
  } catch (err) {
    pushToast('error', (err as Error).message || t('读取文件失败'));
    return;
  }

  const res = await exec<{ report: ImportReport; importable: boolean }>('ai.inspectImport', { stageId: stage.stageId });
  if (!res.ok || !res.data) {
    /* 预检都过不了：说明文件读不出来，不是「格式不支持」 */
    useImportFlow.setState({
      pending: {
        stageId: stage.stageId,
        fileName: file.name,
        zip: stage.zip,
        report: emptyReport(),
        error: res.error?.message ?? t('导入失败'),
      },
    });
    return;
  }

  useImportFlow.setState({
    pending: { stageId: stage.stageId, fileName: file.name, zip: stage.zip, report: res.data.report },
    mode: 'prefer-editable',
    busy: false,
  });
}

/** 用户点了「导入」：真正写库、切工程 */
export async function commitImport(): Promise<void> {
  const { pending, mode } = useImportFlow.getState();
  if (!pending) return;
  useImportFlow.setState({ busy: true });

  const finish = (projectId: string) => {
    useImportFlow.setState({ pending: null });
    /*
     * 两件事必须在这里做，因为只有这里知道「导入成功了」：
     *   1. 关掉启动页覆盖层（Ctrl+O 进来的那条路，不关就一直盖着新工程）；
     *   2. 独立启动页（/ 无 projectId）没有 Host 可切 —— 只能跳进编辑器，
     *      把 projectId 带进 URL，编辑器启动时会自己 project.open 这份新工程。
     */
    updateUi((ui) => {
      ui.showLauncher = false;
    });
    if (!inEditorView()) go(editorUrl(projectId));
  };

  /*
   * 失败时把报告卡关掉，错误交给 toast。
   * 留着卡片反而误导：「可编辑程度 100%」挂在屏幕上，用户会以为再点一次就能成，
   * 而这个文件（路径穿越 / 压缩比异常）重试多少次都一样。
   */
  const fail = (message: string) => {
    useImportFlow.setState({ pending: null, busy: false });
    pushToast('error', message, 6000);
  };

  if (pending.zip) {
    const res = await exec<{ projectId: string; name: string; assets: number; fonts: number }>('project.importBundle', {
      stageId: pending.stageId,
    });
    useImportFlow.setState({ busy: false });
    if (!res.ok || !res.data) {
      fail(res.error?.message ?? t('导入失败'));
      return;
    }
    finish(res.data.projectId);
    pushToast('success', t('已导入「{name}」· {n} 个资源', { name: res.data.name, n: res.data.assets }));
    return;
  }

  const res = await exec<{ projectId: string; name: string; layers: number; code: number; structured: number; assets?: number }>(
    'ai.importProject',
    { stageId: pending.stageId, mode },
  );
  useImportFlow.setState({ busy: false });
  if (!res.ok || !res.data) {
    fail(res.error?.message ?? t('导入失败'));
    return;
  }
  finish(res.data.projectId);
  pushToast(
    'success',
    t('已导入「{name}」· {layers} 个可编辑图层 / {code} 个代码层', {
      name: res.data.name,
      layers: res.data.structured,
      code: res.data.code,
    }),
    5000,
  );
}

function inEditorView(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') === 'editor' || !!params.get('projectId');
}

function emptyReport(): ImportReport {
  return {
    format: 'unknown',
    supported: false,
    label: '—',
    fidelity: 0,
    counts: { structured: 0, code: 0, media: 0, background: 0, tracks: 0, keyframes: 0 },
    missingAssets: [],
    notes: [],
    blockers: [],
    preview: null,
  };
}

/** 打开系统文件选择框，选完自动进预检 */
export function pickImportFile(accept: string): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void beginImport(file);
  };
  input.click();
}
