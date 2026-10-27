/**
 * 性能基准：这支片子到底跑不跑得动 30fps。
 *
 * 量的是**导出分辨率**下的单帧渲染耗时（1920×1080，scale=1）——
 * 预览时浏览器会按显示尺寸缩小，那个数字不能用来判断导出会不会掉帧。
 *
 * 方法：
 *   ① 每个采样点先渲染一次热身（首次会分配 1920×1080 画布、编译 shader / Function），
 *      真正计时的是第二次 —— 否则量到的是「第一次用它有多贵」，不是稳态。
 *   ② 全片按 200ms 步长采样（64s → 320 点），覆盖每一段。
 *   ③ 报 p50 / p95 / p99 / max 与超预算帧占比（30fps 预算 33.3ms）。
 *
 * 用法：node scripts/perf-check.mjs [--verbose]
 */
import { launch, sleep, reporter } from './_cdp.mjs';

const BASE = 'http://localhost:5273/';
const ORIGIN = 'http://localhost:5273';
const ID = 'prj_sample_start';
const STEP = 200;
const BUDGET = 1000 / 30;
const { check, finish } = reporter();
const verbose = process.argv.includes('--verbose');

function pct(list, p) {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}

const main = async () => {
  const b = await launch({ url: BASE, width: 1280, height: 720 });
  try {
    await b.conn.call('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'indexeddb' });
    await b.ev(`localStorage.setItem('kinelayer.locale', 'zh-CN')`);
    await b.conn.call('Page.reload');
    await sleep(1500);
    await b.waitFor(`!!document.querySelector('[data-project-id="${ID}"]')`, 25000);
    await b.conn.call('Page.navigate', { url: `${BASE}?view=editor&projectId=${ID}` });
    await sleep(1200);
    const ready = await b.waitFor(`!!window.__kly`, 20000);
    check('（前置）编辑器与调试口就绪', ready);

    const meta = await b.ev(`(() => {
      const p = window.__kly.state().project;
      return {
        duration: p.duration,
        layers: p.layers.length,
        w: p.width,
        h: p.height,
        layersDetail: p.layers.map((l) => ({ id: l.id, renderScale: l.code?.renderScale ?? null })),
      };
    })()`);

    /* ── 1. 逐层剖析：先看清钱花在谁身上 ─────────────── */
    const probes = [1200, 5200, 9400, 13200, 18200, 22000, 26200, 30600, 33400, 37400, 41400, 45200, 49400, 53600, 57400, 61600];
    const layers = new Map();
    let profTotal = 0;
    for (const ms of probes) {
      await b.ev(`window.__kly.renderTimed(${ms}, 1)`);
      const p = await b.ev(`window.__kly.profile(${ms}, 1)`);
      profTotal += p.total;
      for (const row of p.rows) {
        const cur = layers.get(row.name) ?? { id: row.id, name: row.name, type: row.type, ms: 0, n: 0, peak: 0, peakAt: ms };
        cur.ms += row.ms;
        cur.n += 1;
        /* 记下「这一层最贵的那一帧在哪」——前沿曲线要在那一帧上量，
           在它根本没出场的时间点上量出来的是一条平线 */
        if (row.ms > cur.peak) {
          cur.peak = row.ms;
          cur.peakAt = ms;
        }
        layers.set(row.name, cur);
      }
      if (verbose) console.log(`  ${ms}ms  total=${p.total}  ` + p.rows.map((r) => `${r.name}:${r.ms}`).join(' · '));
    }
    const perLayer = [...layers.values()].sort((a, b) => b.ms - a.ms);
    console.log('\n逐层平均耗时（ms / 帧，1920×1080）');
    for (const l of perLayer) {
      console.log(`  ${(l.ms / l.n).toFixed(2).padStart(7)}  ${l.type.padEnd(10)} ${l.name}`);
    }
    const hottest = perLayer[0];

    /* ── 2. 全片采样 ─────────────────────────────────── */
    const times = [];
    for (let ms = 0; ms < meta.duration; ms += STEP) {
      await b.ev(`window.__kly.renderTimed(${ms}, 1)`); // 热身
      const t = await b.ev(`window.__kly.renderTimed(${ms}, 1)`);
      times.push({ ms, t });
    }
    const list = times.map((x) => x.t);
    const p50 = pct(list, 50);
    const p95 = pct(list, 95);
    const p99 = pct(list, 99);
    const max = Math.max(...list);
    const over = times.filter((x) => x.t > BUDGET);
    const overRatio = (over.length / times.length) * 100;

    console.log(`\n全片 ${times.length} 个采样点（每 ${STEP}ms 一个，scale=1）`);
    console.log(`  p50 ${p50.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms · p99 ${p99.toFixed(1)}ms · max ${max.toFixed(1)}ms`);
    console.log(`  超 33.3ms 预算：${over.length} 点（${overRatio.toFixed(1)}%）`);
    if (over.length) {
      console.log('  最慢五处：' + over.sort((a, b) => b.t - a.t).slice(0, 5).map((x) => `${x.ms}ms:${x.t.toFixed(0)}`).join(' · '));
    }

    /* ── 3. 判定 ─────────────────────────────────────── */
    check('单帧渲染 p95 在 30fps 预算内（≤33.3ms）', p95 <= BUDGET, `${p95.toFixed(1)}ms`);
    check('最慢一帧不超过预算的 1.5 倍（≤50ms）', max <= BUDGET * 1.5, `${max.toFixed(1)}ms`);
    check('超预算的采样点 ≤1%', overRatio <= 1, `${overRatio.toFixed(1)}%`);
    check('最热的图层确实是 shader 或矢量场景（有明确的优化对象）', ['code', 'background'].includes(hottest?.type), `${hottest?.name} · ${hottest?.type}`);

    /*
     * ── 4. 画质 / 耗时前沿 ─────────────────────────────
     *
     * 「我们够快了」和「我们知道极限在哪」是两件事。
     * 这一段把最热那一层的内部分辨率从 1.0 一路压到 0.3，在它最贵的那一帧上
     * 各量一次全帧耗时 —— 得到的不是一条结论，是一条**可选点曲线**：
     * 想更清楚就往上走，想更快就往下走，代价是一行数字。
     * 选点逻辑写在 docs/10-performance.md：取「画质开始肉眼可辨地掉」之前那一档。
     */
    if (hottest?.id && hottest.type === 'code') {
      const worstMs = hottest.peakAt;
      const layer = meta.layersDetail?.find((l) => l.id === hottest.id);
      const original = layer?.renderScale ?? null;
      const SWEEP = [1, 0.75, 0.6, 0.5, 0.4, 0.3];
      console.log(`\n画质 / 耗时前沿（${hottest.name} @ ${worstMs}ms，全帧耗时）`);
      const curve = [];
      for (const s of SWEEP) {
        await b.ev(`window.__kly.dispatch('code.setRenderScale', { id: ${JSON.stringify(hottest.id)}, renderScale: ${s} })`);
        await b.ev(`window.__kly.renderTimed(${worstMs}, 1)`);
        const t = Math.min(
          await b.ev(`window.__kly.renderTimed(${worstMs}, 1)`),
          await b.ev(`window.__kly.renderTimed(${worstMs}, 1)`),
        );
        curve.push({ s, t });
        const mark = s === original ? '  ← 当前选用' : '';
        console.log(`  内部分辨率 ${s.toFixed(2)}  ${String(Math.round(1920 * s)).padStart(4)}×${Math.round(1080 * s)}  ${t.toFixed(1).padStart(6)}ms${mark}`);
      }
      const back = original === null ? 'null' : original;
      await b.ev(`window.__kly.dispatch('code.setRenderScale', { id: ${JSON.stringify(hottest.id)}, renderScale: ${back} })`);

      const at60 = curve.find((c) => c.t <= 1000 / 60);
      console.log(
        at60
          ? `  60fps（≤16.7ms）可行：内部分辨率 ${at60.s.toFixed(2)} 时 ${at60.t.toFixed(1)}ms`
          : '  60fps（≤16.7ms）不可行：即使压到 0.30 也仍在预算之上 —— 这一段是逐像素画面，只能靠降分辨率换帧率',
      );
    }

    console.log('\n机器可读：' + JSON.stringify({ p50: +p50.toFixed(1), p95: +p95.toFixed(1), p99: +p99.toFixed(1), max: +max.toFixed(1), over: over.length, samples: times.length }));
  } finally {
    b.edge.kill();
  }
};

main()
  .then(() => process.exit(finish()))
  .catch((err) => {
    console.error('基准异常：', err);
    process.exit(2);
  });
