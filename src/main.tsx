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
import { audioStatus, createAudioCapture, describeAudioAt, measureOfflineAudio, peaksFor, renderWav, type AudioCapture } from './render/audioEngine';
import { acquireScratch, renderInto, renderToCanvas } from './render/exporters';
import { buildVoicePlan, syllablesOf } from './core/voice';
import { clearVoiceCache, renderVoiceBuffer } from './render/voiceSynth';

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
    /** 离线渲染器用的工程参数：帧数不从界面读，从工程读 */
    meta: () => {
      const p = useEditor.getState().project;
      return { id: p.id, name: p.name, width: p.width, height: p.height, duration: p.duration, fps: p.fps };
    },
    /** 离线渲染器用：整条音轨的 16bit WAV（base64），跟帧序列一起交给外部编码器 */
    wav: async (sampleRate = 48000) => {
      const bytes = await renderWav(useEditor.getState().project, { sampleRate });
      if (!bytes) return null;
      let bin = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CH));
      }
      return { sampleRate, bytes: btoa(bin) };
    },
    /**
     * 离线渲染器用：把若干个时刻拼成一张联络图（contact sheet）。
     * 合成在页面里做：Node 侧没有 canvas，把 N 张 PNG 传回去再拼要解码一遍，不划算。
     */
    sheet: async (times: number[], cols = 4, scale = 0.5) => {
      const p = useEditor.getState().project;
      const cellW = Math.round((p.width * scale) / 2) * 2;
      const cellH = Math.round((p.height * scale) / 2) * 2;
      const rows = Math.max(1, Math.ceil(times.length / cols));
      const canvas = document.createElement('canvas');
      canvas.width = cellW * cols;
      canvas.height = cellH * rows;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#0b0b10';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < times.length; i += 1) {
        const src = await renderToCanvas(p, times[i]!, scale, false);
        ctx.drawImage(src, (i % cols) * cellW, Math.floor(i / cols) * cellH, cellW, cellH);
        ctx.fillStyle = 'rgba(0,0,0,.55)';
        ctx.fillRect((i % cols) * cellW, Math.floor(i / cols) * cellH, 92, 16);
        ctx.fillStyle = '#9aa0aa';
        ctx.font = '10px monospace';
        ctx.fillText(`${(times[i]! / 1000).toFixed(2)}s`, (i % cols) * cellW + 4, Math.floor(i / cols) * cellH + 12);
      }
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
    /**
     * 人声链路同样只能「读数」：音节切得对不对靠计划，有没有声靠离线渲染的 peak/rms，
     * 确定性靠两次渲染的样本校验和。离线渲染必须可复现，所以噪声走 LCG 不走 Math.random ——
     * 这条断言（hash 相等）就是防止有人以后偷偷换回去。
     */
    voice: {
      plan: (spec: object) => {
        const plan = buildVoicePlan(spec);
        return {
          totalMs: plan.totalMs,
          unknownCount: plan.unknownCount,
          phonemeCount: plan.phonemeCount,
          notes: plan.notes.map((n) => ({ atMs: n.atMs, ms: n.ms, f0: +n.f0.toFixed(1), text: n.text, pinyin: n.pinyin, phonemes: n.phonemes.map((p) => p.ph) })),
        };
      },
      syllables: (text: string) =>
        syllablesOf(text).map((s) => ({ text: s.text, pinyin: s.pinyin, phonemes: s.phonemes, unknown: s.unknown, pauseMs: s.pauseMs })),
      render: async (spec: object, opts?: { sampleRate?: number; ms?: number }) => {
        const buf = await renderVoiceBuffer(spec, opts ?? {});
        if (!buf) return null;
        const data = buf.getChannelData(0);
        let peak = 0;
        let sum = 0;
        /*
         * FNV-1a，**按 16bit 量化后**再算。
         *
         * 这个和只用来判「是不是同一段声音」（换音色/换词必须变），**不用来判复现性**：
         * OfflineAudioContext 不保证逐位可复现，同一张图跑两遍末位会差 1~2 个 float32 ULP
         * （实测 maxDiff ≈ 3e-8）。量化到 16bit 也救不了 —— 总有几十个样本正好压在
         * `.5` 的舍入边界上，进位方向随机，于是校验和每次都不一样。
         * 要判「两次导出会不会一样」，看 stability() 的 maxDiff（它是逐样本比差，不看边界）。
         */
        let hash = 0x811c9dc5;
        for (let i = 0; i < data.length; i += 1) {
          const v = data[i]!;
          const a = Math.abs(v);
          if (a > peak) peak = a;
          sum += v * v;
          hash = Math.imul(hash ^ Math.round(Math.max(-1, Math.min(1, v)) * 32767), 0x01000193) >>> 0;
        }
        return { ms: Math.round(buf.duration * 1000), peak: +peak.toFixed(4), rms: +Math.sqrt(sum / Math.max(1, data.length)).toFixed(4), hash: hash.toString(16) };
      },
      /**
       * 稳定性：同 spec 渲染两遍，逐样本比差。
       * 导出要可复现，所以这里既看校验和也看最大偏差 —— 只看校验和的话，
       * 「差 1e-7」和「差 0.3」是一个结论，而这两件事的严重性完全不同。
       */
      stability: async (spec: object, opts?: { sampleRate?: number; ms?: number }) => {
        const a = await renderVoiceBuffer(spec, opts ?? {});
        const b = await renderVoiceBuffer(spec, opts ?? {});
        if (!a || !b) return null;
        const x = a.getChannelData(0);
        const y = b.getChannelData(0);
        let maxDiff = 0;
        let over = 0;
        for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
          const d = Math.abs(x[i]! - y[i]!);
          if (d > maxDiff) maxDiff = d;
          if (d > 1e-6) over += 1;
        }
        return { lenA: x.length, lenB: y.length, maxDiff, over };
      },
      clear: () => clearVoiceCache(),
    },
  };
}

const container = document.getElementById('root');
if (!container) throw new Error('#root 不存在');
createRoot(container).render(<App />);
