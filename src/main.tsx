import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { registerAllCommands } from './core/commands';
import { ensureServices } from './app/services';
import { getServices } from './core/services';
import { buildLayerUrl, getLayerWindowHost, readLayerParams } from './windows/host';
import { useEditor } from './core/store';
import { setActiveLocale } from './i18n';
import { dispatch } from './core/commandBus';
import { listCommands } from './core/registry';
import { audioStatus, createAudioCapture, describeAudioAt, measureOfflineAudio, peaksFor, type AudioCapture } from './render/audioEngine';

registerAllCommands();
// 先按浏览器语言/上次选择初始化，再渲染（避免首帧闪一下默认语言）
setActiveLocale(useEditor.getState().ui.locale);

// Host 页面才需要安装窗口管理器与命令式服务；图层窗口是纯 Client，不创建 Host
if (!readLayerParams().layerId) {
  ensureServices();
}

/**
 * 开发态调试口：给 e2e / 手工排障用。
 * 只在 dev 构建里挂，生产 bundle 里 __kly 是 undefined——不进包、不暴露给线上用户。
 */
if (import.meta.env.DEV) {
  let captured: AudioCapture | null = null;
  (window as unknown as Record<string, unknown>).__kly = {
    dispatch: (type: string, payload?: unknown, opts?: { dryRun?: boolean; source?: 'user' | 'ai' }) =>
      dispatch(type, payload ?? {}, { source: opts?.source ?? 'user', dryRun: opts?.dryRun }),
    state: () => useEditor.getState(),
    commands: () => listCommands().map((c) => c.type),
    /** e2e 用：拿到某个图层的独立窗口地址（含本窗口 hostId） */
    layerUrl: (layerId: string) => buildLayerUrl(layerId, getLayerWindowHost().hostId),
    /**
     * e2e 用：把一份 File 放进导入暂存区，拿到 stageId。
     * 命令的 payload 只收 stageId（几十 MB 的 zip 不该进 JSON），
     * 而 CDP 里造 File 比走文件选择框稳定得多 —— 自检两条路都留着。
     */
    stage: (file: File) => getServices().stageBundle(file),
    /**
     * e2e 用：音频这条链路没法靠像素断言，给一个能读数的口。
     * measure 走 OfflineAudioContext（比实时快得多），peak/rms 为 0 就是「没声音」。
     */
    audio: {
      status: audioStatus,
      measure: () => measureOfflineAudio(useEditor.getState().project),
      peaks: (buckets?: number) => peaksFor(useEditor.getState().project, buckets ?? 320),
      describeAt: (ms: number) => describeAudioAt(useEditor.getState().project, ms),
      /* 导出链路同样是「读数」验证：只看这条 stream 里有没有音轨，听完就掐掉 */
      capture: async () => {
        captured = await createAudioCapture(useEditor.getState().project);
        return captured ? captured.stream.getAudioTracks().length : 0;
      },
      stopCapture: () => {
        captured?.stop();
        captured = null;
      },
    },
  };
}

const container = document.getElementById('root');
if (!container) throw new Error('#root 不存在');
createRoot(container).render(<App />);
