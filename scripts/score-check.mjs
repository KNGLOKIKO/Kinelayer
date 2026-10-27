/**
 * 速度网格 + 歌词编辑器的自检。
 *
 * 这一块的性质决定了必须用真浏览器跑：打拍读的是 `performance.now()`，
 * 读数是 rAF 循环刷出来的，LRC 导入走的是 React 受控输入框。
 * 反过来，`score.ts` 里那些纯函数已经在 sample-check 的谱面断言里验过了，
 * 这里不重复造轮子 —— 验的是「界面上按一下，工程里真的变了」。
 *
 * 用法：node scripts/score-check.mjs
 */
import { launch, reporter, sleep } from './_cdp.mjs';

const base = 'http://127.0.0.1:5273/';
const ORIGIN = 'http://127.0.0.1:5273';
const REVISION_ID = 'prj_sample_revision';

const { check, finish } = reporter();

/** 读「速度网格」区块：三个输入框 + 读数 + 提示行 */
const READ_TEMPO = `(() => {
  const head = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '速度网格');
  if (!head) return null;
  const panel = head.closest('div').parentElement;
  const inputs = [...panel.querySelectorAll('input')].map((i) => i.value);
  const readout = panel.querySelector('[data-testid="score-readout"]');
  return {
    inputs,
    readout: readout ? readout.textContent.replace(/\\s+/g, ' ').trim() : '',
    hasTap: !!panel.querySelector('[data-testid="tempo-tap"]'),
    hint: panel.textContent.replace(/\\s+/g, ' ').trim().slice(-80),
  };
})()`;

const seek = (ms) => `window.__kly.dispatch('timeline.seek', { time: ${ms} })`;

const main = async () => {
  const cdp = await launch({ url: base, width: 1440, height: 900 });
  try {
    /* ── 0. 干净状态、中文界面 ────────────────────────── */
    /* 清 IDB 会把文档打断一下，此时 localStorage 是拒绝访问的：等页面回到源上再写 */
    await cdp.waitFor(`location.origin === ${JSON.stringify(ORIGIN)}`, 15000);
    await cdp.conn.call('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'indexeddb' });
    await cdp.waitFor(`location.origin === ${JSON.stringify(ORIGIN)}`, 15000);
    await cdp.ev(`localStorage.setItem('kinelayer.locale', 'zh-CN')`);
    await cdp.conn.call('Page.reload');
    await sleep(900);
    /* 示例是启动页 boot 时播进去的：必须等卡片出现，否则跳进编辑器只会拿到一份空工程 */
    await cdp.waitFor(`!!document.querySelector('[data-project-id="${REVISION_ID}"]')`, 20000);

    await cdp.conn.call('Page.navigate', { url: `${base}?view=editor&projectId=${REVISION_ID}` });
    const inRev = await cdp.waitFor(`!!window.__kly && window.__kly.state().project.id === '${REVISION_ID}'`, 18000);
    check('（前置）打开「再改一版」', inRev);

    /* 打开工程会自动选中一层，右栏就是「图层检查器」；速度网格属于画布，先清选中 */
    await cdp.ev(`window.__kly.dispatch('selection.clear')`);
    const cleared = await cdp.waitFor(`window.__kly.state().ui.activeLayerId === null`, 5000);
    check('（前置）清掉选中，右栏回到画布检查器', cleared);

    /* ── 1. 区块在画布检查器里，「没选图层」时才露出来 ── */
    const found = await cdp.waitFor(`!!${READ_TEMPO}`, 8000);
    check('（前置）右栏有速度网格区块', found);
    await cdp.ev(seek(0));
    await sleep(200);

    const t0 = await cdp.ev(READ_TEMPO);
    check('三个输入框读的是工程值（128 / 0 / 4）', t0?.inputs.slice(0, 3).join(',') === '128,0,4', JSON.stringify(t0?.inputs));
    check('打拍按钮存在', !!t0?.hasTap);

    /* 标尺上把速度网格画出来：60s / 128BPM / 4/4 → 129 条拍线，其中 33 条是小节线 */
    const grid = await cdp.ev(`JSON.stringify({
      bars: document.querySelectorAll('[data-beat="bar"]').length,
      all: document.querySelectorAll('[data-beat]').length,
    })`);
    const g = JSON.parse(grid);
    check('时间轴标尺上画出 129 条拍线 / 33 条小节线', g.all === 129 && g.bars === 33, grid);

    /* ── 2. 读数是活的：拖播放头，第几小节/第几拍跟着变 ── */
    await cdp.ev(seek(3750));
    await sleep(320);
    const at3750 = await cdp.ev(READ_TEMPO);
    check(
      '3750ms 报「小节 03 · 拍 1 · 强拍」',
      /小节 03/.test(at3750.readout) && /拍 1/.test(at3750.readout) && /强拍/.test(at3750.readout),
      at3750.readout.slice(0, 60),
    );

    await cdp.ev(seek(4250));
    await sleep(320);
    const at4250 = await cdp.ev(READ_TEMPO);
    check('4250ms 报「距上一拍 31ms」', /\+31ms/.test(at4250.readout), at4250.readout.slice(0, 60));

    /* ── 3. 界面读数与 query.score 是同一份真理 ───────── */
    const q = await cdp.ev(`(async () => JSON.stringify((await window.__kly.dispatch('query.score', { at: 4250, ahead: 1 })).data))()`);
    const qs = JSON.parse(q);
    check(
      'query.score 与读数同源（同拍、同偏移）',
      qs.sinceBeatMs === 31 && at4250.readout.includes('+31ms') && Math.abs(qs.beat - 9.067) < 0.01,
      JSON.stringify({ since: qs.sinceBeatMs, beat: qs.beat }),
    );

    /* ── 4. 逐字读数：半分处不能报「唱完了」 ──────────── */
    const lineCount = await cdp.ev(`window.__kly.state().project.lyrics.length`);
    check('（前置）示例带 21 行歌词', lineCount === 21, String(lineCount));

    await cdp.ev(seek(5000));
    await sleep(320);
    const lyr = await cdp.ev(READ_TEMPO);
    /*
     * 5000ms 在这一行（4060..5810）的 53.7%，五个字各占 350ms：
     * 前两个字唱完、第三个唱到 68.6% → 2.686 个字，界面应该报 2/5。
     * 这个数以前会报满（旧实现每个单元之间硬加 1 当空格，中文没有空格，于是半分就唱完）。
     */
    check('5000ms 读数是「先画一条线 2/5」', lyr.readout.includes('先画一条线') && /\b2\/5\b/.test(lyr.readout), lyr.readout.slice(-40));

    /* ── 5. 逐行编辑：把第一行起点改成播放头 ──────────── */
    await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '歌词 / 逐字时间');
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(300);
    const rows = await cdp.ev(`document.querySelectorAll('[title="起点改成播放头"]').length`);
    check('歌词区展开后每行都有「起点改成播放头」', rows === 21, String(rows));

    await cdp.ev(seek(9000));
    await sleep(200);
    await cdp.ev(`document.querySelectorAll('[title="起点改成播放头"]')[0].click()`);
    await sleep(300);
    /* 起点挪到 9000 后这一行会被重排到最后 —— 按内容找，不要按下标找 */
    const moved = await cdp.ev(`JSON.stringify(window.__kly.state().project.lyrics.find((l) => l.text === '先画一条线'))`);
    check('点一下就把这一行起点挪到 9000ms（并重排到最后）', JSON.parse(moved).start === 9000, moved);

    /* ── 6. LRC 导入：带区间的保留区间，没时间戳的接在后面 ── */
    await cdp.ev(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'LRC');
      if (btn) btn.click();
      return !!btn;
    })()`);
    await sleep(300);
    const pasted = await cdp.ev(`(() => {
      const ta = document.querySelector('textarea[placeholder*="00:04.060"]');
      if (!ta) return 'no-textarea';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '[00:04.060-00:05.810] 先画一条线\\n[00:06.800] 就有了时间\\n没带时间戳的一行');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return ta.value.split('\\n').length + ':' + ta.value.length;
    })()`);
    check('（前置）文本框吃下了三行', pasted === '3:52' || String(pasted).startsWith('3:'), String(pasted));

    await cdp.ev(`document.querySelector('[data-testid="lyrics-import"]').click()`);
    await sleep(400);
    const lines = JSON.parse(await cdp.ev(`JSON.stringify(window.__kly.state().project.lyrics)`));
    check('导入后正好三行', lines.length === 3, JSON.stringify(lines.map((l) => [l.start, l.end])));
    check(
      '带区间的行保留原区间（4060–5810）',
      lines[0].start === 4060 && lines[0].end === 5810 && lines[0].text === '先画一条线',
      JSON.stringify(lines[0]),
    );
    check('只有起点的行按没时间戳的默认时长收尾（6800–9200）', lines[1].start === 6800 && lines[1].end === 9200, JSON.stringify(lines[1]));
    check('没时间戳的行接在最后一条之后（9200–11600）', lines[2].start === 9200 && lines[2].end === 11600, JSON.stringify(lines[2]));

    /* ── 7. 打拍：三下间隔 500ms → 120 BPM ─────────────── */
    await cdp.ev(`(async () => {
      const btn = document.querySelector('[data-testid="tempo-tap"]');
      for (const d of [0, 1, 2]) {
        if (d) await new Promise((r) => setTimeout(r, 500));
        btn.click();
      }
      return true;
    })()`);
    await sleep(400);
    const tapped = await cdp.ev(READ_TEMPO);
    const bpm = Number(tapped.inputs[0]);
    check('三下间隔约 500ms → BPM 落在 120 附近', Math.abs(bpm - 120) <= 10, `bpm=${bpm}`);
    check('打完拍会报「已按 3 下 · 间隔 5xx ms」', /已按 3 下/.test(tapped.hint) && /间隔 5\d\dms/.test(tapped.hint), tapped.hint.slice(-60));

    /* ── 8. 对齐：把播放头当作拍点 ────────────────────── */
    await cdp.ev(seek(5230));
    await sleep(200);
    await cdp.ev(`document.querySelector('[data-testid="tempo-align-beat"]').click()`);
    await sleep(300);
    /* 打出来的 BPM 不会是整 120，拍长也不会是整 500ms，所以期望值要现算 */
    const align = JSON.parse(
      await cdp.ev(`(() => {
        const tp = window.__kly.state().project.tempo;
        const beat = 60000 / tp.bpm;
        const phase = ((5230 % beat) + beat) % beat;
        return JSON.stringify({ bpm: tp.bpm, offsetMs: tp.offsetMs, expect: Math.round(phase) });
      })()`),
    );
    check('「把播放头当作拍点」把偏移对到相位上', Math.abs(align.offsetMs - align.expect) <= 2, JSON.stringify(align));

    /* ── 9. 英文模式：这一块没有漏翻 ──────────────────── */
    await cdp.ev(`localStorage.setItem('kinelayer.locale', 'en-US')`);
    await cdp.conn.call('Page.navigate', { url: `${base}?view=editor&projectId=${REVISION_ID}` });
    await cdp.waitFor(`!!window.__kly && window.__kly.state().project.id === '${REVISION_ID}'`, 18000);
    await cdp.ev(`window.__kly.dispatch('selection.clear')`);
    /* 等这一块真的挂上再读：英文标题出现即视为就绪 */
    const enReady = await cdp.waitFor(
      `!![...document.querySelectorAll('button')].find((b) => /Tempo grid/i.test(b.textContent))`,
      8000,
    );
    check('（前置）英文界面下速度网格区块在', enReady);
    const zhLeft = await cdp.ev(`(() => {
      const head = [...document.querySelectorAll('button')].find((b) => /Tempo grid/i.test(b.textContent));
      if (!head) return 'no-section';
      /* 读数区里显示的是歌词内容 —— 那是用户数据，不是界面文案，跳过 */
      const panel = head.closest('div').parentElement.cloneNode(true);
      panel.querySelector('[data-testid="score-readout"]')?.remove();
      const text = panel.textContent + [...panel.querySelectorAll('input')].map((i) => i.placeholder).join('');
      const hits = text.match(/[\\u4e00-\\u9fff]/g) ?? [];
      return hits.length ? hits.join('') : 0;
    })()`);
    check('英文模式下速度网格区块零中文', zhLeft === 0, String(zhLeft));
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
