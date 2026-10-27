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
import { acquireScratch, renderInto, renderToCanvas } from './render/exporters';

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
    /**
     * 分镜用：把当前工程在某一毫秒渲染成一张图。
     * 走的是导出那条 `renderToCanvas`，所以「这里好看」＝「导出好看」；
     * 片子做得越密，这个口越重要 —— 光看时间轴看不出画面挤不挤。
     */
    frame: async (ms: number, scale = 1) => {
      const canvas = await renderToCanvas(useEditor.getState().project, ms, scale, false);
      return canvas.toDataURL('image/png');
    },
    /**
     * 只读耗时、不编码：基准测试用（toDataURL 一张 1080p 要十几毫秒，会盖住真实开销）。
     *
     * 用租来的画布而不是每次 `renderToCanvas`：后者每帧新分配 8MB，
     * 量到的数字里混着 GC，而真实导出（WebM 那条路）是复用一张画布的。
     * 度量的应该是「导出时一帧多贵」，不是「分配一张 1080p 画布多贵」。
     */
    renderTimed: async (ms: number, scale = 1) => {
      const project = useEditor.getState().project;
      const canvas = acquireScratch(project, scale);
      const t0 = performance.now();
      await renderInto(canvas, project, { time: ms, scale, transparent: false });
      return +(performance.now() - t0).toFixed(2);
    },
    /**
     * 性能剖析用：把某一毫秒拆到「每个图层各花了多少毫秒」。
     * 走的是同一个 renderScene（onlyLayerId），所以拆出来的和整帧是同一份开销，
     * 不是另写一条测量路径糊出来的数字。
     *
     * 两次取更小值：单次测量里一次 GC、一次字体回退都会把账算到无关图层头上
     * （音频层画 0 像素却测出 20ms，就是这个）。要的是「这一层稳态多贵」。
     */
    profile: async (ms: number, scale = 1) => {
      const project = useEditor.getState().project;
      const canvas = acquireScratch(project, scale);
      const once = async () => {
        const t0 = performance.now();
        await renderInto(canvas, project, { time: ms, scale, transparent: false });
        return performance.now() - t0;
      };
      await once();
      const total = Math.min(await once(), await once());
      const rows: { id: string; name: string; type: string; ms: number }[] = [];
      for (const layer of project.layers) {
        if (ms < layer.inPoint || ms >= layer.outPoint) continue;
        const id = layer.id;
        const t0 = performance.now();
        await renderInto(canvas, project, { time: ms, scale, transparent: false, layerId: id });
        const a = performance.now() - t0;
        const t1 = performance.now();
        await renderInto(canvas, project, { time: ms, scale, transparent: false, layerId: id });
        const b = performance.now() - t1;
        rows.push({ id, name: layer.name, type: layer.type, ms: +Math.min(a, b).toFixed(2) });
      }
      rows.sort((a, b) => b.ms - a.ms);
      return { total: +total.toFixed(2), rows };
    },
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
