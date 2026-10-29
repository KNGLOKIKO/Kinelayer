/**
 * 音频层验收。
 *
 * 音频这条链路没法靠像素判断，所以这里全部走「读数」：
 *   - 数据层：能不能建、能不能改、改错对象会不会被拦住
 *   - 引擎层：离线渲染出来的 peak/rms（= 真的有声）、排程区间（谁在响）、波形峰值
 *   - 播放层：主时钟把 playing 打开/关掉时，音频状态跟着变
 *   - 界面层：时间轴有波形、属性面板能试听
 *
 * 需要 dev server 跑在 5273（脚本会自己清 IndexedDB，不影响已有工程）。
 */
import { enterEditor, launch, reporter, sleep } from './_cdp.mjs';

const base = 'http://localhost:5273/';
const ORIGIN = 'http://localhost:5273';
const { check, finish } = reporter();

const main = async () => {
  const cdp = await launch({ url: base, width: 1440, height: 900 });
  try {
    await cdp.conn.call('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'indexeddb' });
    await cdp.conn.call('Page.reload');
    const ready = await cdp.waitFor(`typeof window.__kly !== "undefined"`, 20000);
    check('dev 调试口就绪', ready);
    if (!ready) return;

    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 12000);

    /* ── 1. 建工程 → 进编辑器 → 加一条音频层 ───────────── */
    const created = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('project.create', { name: '音频验收', width: 1080, height: 1440 });
      return { ok: r.ok, id: r.data?.projectId, err: r.error?.message };
    })()`);
    check('建一个验收用工程', created.ok && !!created.id, JSON.stringify(created));

    /*
     * project.create 只落数据、不负责导航（导航是界面的决定），所以这里手动进编辑器。
     * 主时钟活在 EditorApp 里，不进编辑器就没有 rAF 循环 —— 播放相关的断言全会假失败。
     * enterEditor 会等到「要的那份工程」真的进 store：只等图层树出现会在内存占位工程上就绪。
     */
    const entered = await enterEditor(cdp, created.id, { base });
    check('进入编辑器（图层树已挂载）', entered.ok, entered.reason);

    const dur = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('canvas.setDuration', { duration: 12000 });
      return { ok: r.ok, duration: window.__kly.state().project.duration };
    })()`);
    check('把时长设成 12 秒', dur.ok && dur.duration === 12000, JSON.stringify(dur));

    const added = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('layer.create', {
        type: 'audio', name: '测试音轨',
        tone: { preset: 'pulse', root: 220, bpm: 120, chord: [0, 7], marks: [] },
      });
      const p = window.__kly.state().project;
      const layer = p.layers.find((l) => l.id === r.data?.id);
      return {
        ok: r.ok, err: r.error?.message, id: r.data?.id,
        type: layer?.type, preset: layer?.tone?.preset, root: layer?.tone?.root,
        outPoint: layer?.outPoint, volume: layer?.volume, w: layer?.width, h: layer?.height,
      };
    })()`);
    check('layer.create 能建音频层', added.ok && added.type === 'audio', JSON.stringify(added));
    check('音源参数落到了图层上', added.preset === 'pulse' && added.root === 220, JSON.stringify({ p: added.preset, r: added.root }));
    check('默认铺满全片（outPoint = 时长）', added.outPoint === 12000, String(added.outPoint));
    /* 宽高会被 enforceInvariants 抬到最小值 1：1×1 的选中框看不出来，等价于「不占画面」 */
    check('音频层不占画面（尺寸被压到 1×1）', added.w <= 1 && added.h <= 1, `${added.w}×${added.h}`);

    /* ── 2. audio.set：改得动，且只改得动音频层 ─────────── */
    const tuned = await cdp.ev(`(async () => {
      const p = window.__kly.state().project;
      const audio = p.layers.find((l) => l.type === 'audio');
      const bg = p.layers.find((l) => l.type === 'background');
      const ok = await window.__kly.dispatch('audio.set', { id: audio.id, volume: 0.42, muted: false, fadeIn: 300, fadeOut: 900 });
      const bad = await window.__kly.dispatch('audio.set', { id: bg.id, volume: 0.5 });
      const after = window.__kly.state().project.layers.find((l) => l.id === audio.id);
      return { ok: ok.ok, vol: after.volume, fin: after.fadeIn, bad: bad.ok, badCode: bad.error?.code, version: after.animation?.tracks?.length ?? 0 };
    })()`);
    check('audio.set 改音量与淡入淡出', tuned.ok && tuned.vol === 0.42 && tuned.fin === 300, JSON.stringify(tuned));
    check('拿非音频层调 audio.set 会被拦住', tuned.bad === false && tuned.badCode === 'INVARIANT', JSON.stringify({ ok: tuned.bad, code: tuned.badCode }));

    /* ── 3. 引擎：离线渲染 = 真的有声音 ────────────────── */
    const sound = await cdp.ev(`(async () => {
      const on = await window.__kly.audio.measure();
      const p = window.__kly.state().project;
      const audio = p.layers.find((l) => l.type === 'audio');
      await window.__kly.dispatch('audio.set', { id: audio.id, muted: true });
      const muted = await window.__kly.audio.measure();
      await window.__kly.dispatch('audio.set', { id: audio.id, muted: false, volume: 0.9 });
      const back = await window.__kly.audio.measure();
      return { on, muted, back };
    })()`);
    check('离线渲染出了声音（peak/rms 非零）', sound.on && sound.on.peak > 0.01 && sound.on.rms > 0.001, JSON.stringify(sound.on));
    check('音轨长度与工程时长一致', sound.on && Math.abs(sound.on.ms - 12000) <= 200, `${sound.on?.ms}ms`);
    check('静音之后真的没声了', sound.muted && sound.muted.peak < 0.002, JSON.stringify(sound.muted));
    check('取消静音后声音回来', sound.back && sound.back.peak > 0.01, JSON.stringify(sound.back));

    /* ── 4. 排程区间：谁在响 ──────────────────────────── */
    const scheduled = await cdp.ev(`(async () => {
      const p = window.__kly.state().project;
      const audio = p.layers.find((l) => l.type === 'audio');
      await window.__kly.dispatch('layer.update', { id: audio.id, patch: { inPoint: 2000, outPoint: 6000 } });
      const before = window.__kly.audio.describeAt(1000).length;
      const inside = window.__kly.audio.describeAt(4000);
      const after = window.__kly.audio.describeAt(8000).length;
      return { before, inside, after };
    })()`);
    check('inPoint 之前不响', scheduled.before === 0, String(scheduled.before));
    check('区间内响着这一层', scheduled.inside.length === 1 && scheduled.inside[0].preset === 'pulse', JSON.stringify(scheduled.inside));
    check('outPoint 之后不响', scheduled.after === 0, String(scheduled.after));

    /* ── 5. 主时钟：播放/暂停真的带动音频 ─────────────── */
    const clock = await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.seek', { time: 0 });
      const idle = window.__kly.audio.status();
      await window.__kly.dispatch('timeline.play', {});
      await new Promise((r) => setTimeout(r, 700));
      const playing = window.__kly.audio.status();
      const head = window.__kly.state().runtime.playhead;
      await window.__kly.dispatch('timeline.pause', {});
      await new Promise((r) => setTimeout(r, 300));
      const paused = window.__kly.audio.status();
      return { idle, playing, paused, head };
    })()`);
    check('未播放时音频引擎是停的', clock.idle.running === false, JSON.stringify(clock.idle));
    check('按下播放后音频跟上了', clock.playing.running === true, JSON.stringify(clock.playing));
    check('AudioContext 真的在跑（不是 suspended）', clock.playing.state === 'running', String(clock.playing.state));
    check('播放头在推进', clock.head > 100, `${clock.head}ms`);
    check('暂停后音频立刻停下', clock.paused.running === false, JSON.stringify(clock.paused));

    /* seek（拖动播放头）后应该重锚，而不是慢慢漂 */
    const seeked = await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.play', {});
      await new Promise((r) => setTimeout(r, 400));
      await window.__kly.dispatch('timeline.seek', { time: 5000 });
      await new Promise((r) => setTimeout(r, 500));
      const head = window.__kly.state().runtime.playhead;
      const st = window.__kly.audio.status();
      await window.__kly.dispatch('timeline.pause', {});
      return { head, st };
    })()`);
    check('播放中 seek 之后音频仍在响（已重锚）', seeked.st.running === true && seeked.head >= 5000, JSON.stringify({ head: seeked.head, running: seeked.st.running }));

    /* ── 6. 波形与界面 ───────────────────────────────── */
    const peaks = await cdp.ev(`(async () => {
      /* 先把区间拉回全片，否则波形只有一小段（前面为了验排程把它缩到了 2–6 秒） */
      const audio = window.__kly.state().project.layers.find((l) => l.type === 'audio');
      await window.__kly.dispatch('layer.update', { id: audio.id, patch: { inPoint: 0, outPoint: 12000 } });
      const p = await window.__kly.audio.peaks(200);
      let n = 0;
      if (p) for (const v of p) if (v > 0.01) n++;
      return { len: p ? p.length : 0, nonzero: n };
    })()`);
    check('波形峰值按桶返回', peaks.len === 200, String(peaks.len));
    /*
     * 节拍类的波形天然是「一下一下」的：每桶 60ms，而鼓点只占 260ms，
     * 命中率四成上下是正常的。断言只要「不是一条直线」，不要求铺满。
     */
    check('波形不是一条直线（有实际包络）', peaks.nonzero > 40, `${peaks.nonzero}/200`);

    const wave = await cdp.waitFor(`!!document.querySelector('[data-testid="audio-wave"]')`, 8000);
    check('时间轴上画出了音频波形', wave === true);

    /* 走命令选中，不模拟点行：图层树的点击命中区有一套自己的逻辑，测选中不该被它拖累 */
    const preview = await cdp.ev(`(async () => {
      const audio = window.__kly.state().project.layers.find((l) => l.type === 'audio');
      const r = await window.__kly.dispatch('selection.set', { ids: [audio.id] });
      return { ok: r.ok, selected: window.__kly.state().ui.selectedIds };
    })()`);
    await sleep(500);
    const previewBtn = await cdp.waitFor(`!!document.querySelector('[data-testid="audio-preview"]')`, 6000);
    check('选中音频层后属性面板有「试听」', preview.ok && previewBtn, JSON.stringify(preview.selected));

    const afterPreview = await cdp.ev(`(() => {
      const b = document.querySelector('[data-testid="audio-preview"]');
      if (!b) return 'no-button';
      b.click();
      return window.__kly.audio.status().state;
    })()`);
    await sleep(500);
    check('试听按钮能把音频上下文唤起来', afterPreview === 'running', String(afterPreview));

    /* ── 7. 导出音轨：MediaStream 里真的有 audio track ─── */
    const capture = await cdp.ev(`(async () => {
      const tracks = await window.__kly.audio.capture();
      window.__kly.audio.stopCapture();
      return { tracks };
    })()`);
    check('导出用的音频流带一条音轨', capture && capture.tracks === 1, JSON.stringify(capture));

    /* ── 8. 删掉音频层之后时间轴不再画波形 ─────────────── */
    const removed = await cdp.ev(`(async () => {
      const p = window.__kly.state().project;
      const audio = p.layers.find((l) => l.type === 'audio');
      const r = await window.__kly.dispatch('layer.delete', { ids: [audio.id] });
      return { ok: r.ok };
    })()`);
    await sleep(600);
    const waveGone = await cdp.ev(`!document.querySelector('[data-testid="audio-wave"]')`);
    check('删掉音频层后波形跟着消失', removed.ok && waveGone === true, JSON.stringify({ ok: removed.ok, gone: waveGone }));
  } finally {
    cdp.edge.kill();
  }
};

main()
  .then(() => process.exit(finish()))
  .catch((err) => {
    console.error('自检异常：', err);
    process.exit(2);
  });
