/**
 * 首次运行验收：示例工程 + 介绍页动画。
 *
 * 验的是「一个从没打开过这个应用的人，第一眼看到什么」：
 *   1. 工程库里已经有一份示例，带缩略图与「示例」徽标
 *   2. 它是真的能打开、能改、内容完整（8 层 / 3 条关键帧轨道 / 零外部资源）
 *   3. 第 0 帧就有完整画面（没有入场预设导致的「开场白屏」）
 *   4. 引导条只出现一次，刷新不再出现；示例不会被重复创建
 *   5. 删掉之后不再自动重建（用户删了就是删了）
 *   6. 介绍页那段四拍动画在跑，`prefers-reduced-motion` 下停在第三拍
 *   7. 英文模式下面板与动画零中文
 *
 * 全程真实浏览器 + 真实点击，只清 IndexedDB（保留语言偏好，避免结果随浏览器语言漂移）。
 * 需要 dev server 跑在 5273。
 */
import { launch, reporter, sleep, AUTO_CONFIRM } from './_cdp.mjs';

const base = 'http://localhost:5273/';
const ORIGIN = 'http://localhost:5273';
const SAMPLE_ID = 'prj_sample_start';
const { check, finish } = reporter();

const READ_LAUNCHER = `(() => {
  const cards = [...document.querySelectorAll('[data-project-id]')].map((c) => {
    const img = c.querySelector('img');
    return {
      id: c.dataset.projectId,
      badge: !!c.querySelector('[data-testid="sample-badge"]'),
      thumb: img ? img.getAttribute('src') || '' : '',
      text: (c.innerText || '').replace(/\\n/g, ' | '),
    };
  });
  const banner = document.querySelector('[data-testid="sample-banner"]');
  const demo = document.querySelector('[data-testid="intro-demo"]');
  const deepText = (root) => {
    if (!root) return '';
    const clone = root.cloneNode(true);
    clone.querySelectorAll('select, input, textarea, [data-user-text]').forEach((n) => n.remove());
    return (clone.textContent || '').replace(/\\s+/g, ' ').trim();
  };
  return {
    cards,
    hero: !!document.querySelector('[data-testid="intro-hero"]'),
    heroText: deepText(document.querySelector('[data-testid="intro-hero"]')),
    phase: demo ? demo.dataset.phase : null,
    steps: [...document.querySelectorAll('[data-testid="intro-step"]')].map((s) => s.textContent.trim()),
    active: document.querySelector('[data-testid="intro-step"][data-active="true"]')?.textContent?.trim() ?? null,
    banner: banner ? (banner.innerText || '').replace(/\\n/g, ' | ') : null,
    empty: (document.body.innerText || '').includes('还没有项目'),
  };
})()`;

const main = async () => {
  const cdp = await launch({ url: base, width: 1440, height: 900 });
  try {
    /* ── 0. 造一个「从没来过」的状态：只清 IndexedDB，语言钉死中文 ── */
    await cdp.conn.call('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'indexeddb' });
    await cdp.ev(`localStorage.setItem('kinelayer.locale', 'zh-CN')`);
    await cdp.conn.call('Page.reload');
    await sleep(900);
    const ready = await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 15000);
    check('（前置）回到干净的启动页', ready);

    /* ── 1. 首屏：示例已经在库里 ─────────────────────── */
    const first = await cdp.ev(READ_LAUNCHER);
    check('首次打开就有一条示例工程', first.cards.length === 1 && first.cards[0].id === SAMPLE_ID, JSON.stringify(first.cards.map((c) => c.id)));
    check('示例卡片带缩略图（不是灰块）', first.cards[0].thumb.startsWith('data:image/') && first.cards[0].thumb.length > 5000, String(first.cards[0]?.thumb.length ?? 0));
    check('示例卡片带「示例」徽标', first.cards[0].badge === true);
    check('卡片刻出了尺寸与图层数', /1080×1440/.test(first.cards[0].text) && /8 图层/.test(first.cards[0].text), first.cards[0].text.slice(0, 80));
    check('引导条说明了刚才发生了什么', !!first.banner && /8 层/.test(first.banner) && /3 条关键帧轨道/.test(first.banner), String(first.banner).slice(0, 100));

    /* ── 2. 介绍页动画 ───────────────────────────────── */
    check('介绍页有示例动画', first.hero === true && first.phase !== null, `phase=${first.phase}`);
    check('动画分四拍且第一拍是画布', first.steps.length === 4 && first.active === '01 画布', JSON.stringify(first.steps));
    await sleep(2400);
    const moved = await cdp.ev(READ_LAUNCHER);
    check('动画自己在走（相位会推进）', moved.phase !== first.phase, `${first.phase} → ${moved.phase}`);
    check('指示器跟着亮到下一拍', moved.active !== first.active, `${first.active} → ${moved.active}`);

    /* ── 3. prefers-reduced-motion：停在第三拍 ────────── */
    await cdp.conn.call('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await cdp.conn.call('Page.reload');
    await sleep(900);
    await cdp.waitFor(`!!document.querySelector('[data-testid="intro-demo"]')`, 12000);
    const still1 = await cdp.ev(READ_LAUNCHER);
    await sleep(2400);
    const still2 = await cdp.ev(READ_LAUNCHER);
    check('减少动态时停在第三拍', still1.phase === '2' && still2.phase === '2', `${still1.phase} → ${still2.phase}`);
    await cdp.conn.call('Emulation.setEmulatedMedia', { features: [] });
    await cdp.conn.call('Page.reload');
    await sleep(900);
    await cdp.waitFor(`!!document.querySelector('[data-project-id]')`, 12000);

    /* ── 4. 刷新：不重复创建、引导条只出现一次 ────────── */
    const again = await cdp.ev(READ_LAUNCHER);
    check('刷新不会重复创建示例', again.cards.length === 1, String(again.cards.length));
    check('引导条只出现一次（刷新后消失）', again.banner === null);

    /* ── 5. 打开它：内容完整、可正常使用 ─────────────── */
    const opened = await cdp.ev(`(() => {
      const card = document.querySelector('[data-project-id="${SAMPLE_ID}"]');
      const btn = card?.querySelector('button');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await sleep(1200);
    const inEditor = await cdp.waitFor(`!!window.__kly && location.search.includes('projectId=${SAMPLE_ID}')`, 15000);
    check('点卡片能进编辑器', opened && inEditor);

    const shape = await cdp.ev(`(() => {
      const p = window.__kly.state().project;
      const title = p.layers.find((l) => l.name === '主标题');
      return {
        id: p.id, layers: p.layers.length, assets: p.assets.length,
        duration: p.duration, fps: p.fps, version: p.version,
        tracks: p.layers.reduce((n, l) => n + (l.animation?.tracks?.length ?? 0), 0),
        codeLayers: p.layers.filter((l) => l.type === 'code').length,
        hasEnter: p.layers.some((l) => l.animation?.enter || l.animation?.exit),
        titleOpacity: title ? title.opacity : null,
        titleTracks: title ? title.animation.tracks.map((t) => t.property) : [],
        names: p.layers.map((l) => l.name),
      };
    })()`);
    check('打开的就是那条示例', shape.id === SAMPLE_ID, shape.id);
    check('八层内容齐全（背景 + 代码层 + 文字）', shape.layers === 8 && shape.codeLayers === 2, JSON.stringify({ layers: shape.layers, code: shape.codeLayers }));
    check('带三条关键帧轨道', shape.tracks === 3 && shape.titleTracks.includes('y'), JSON.stringify(shape.titleTracks));
    check('不依赖任何外部资源', shape.assets === 0, String(shape.assets));
    check('没有入场/退场预设（第 0 帧不会是白屏）', shape.hasEnter === false && shape.titleOpacity === 1);
    check('画布参数与卡片一致', shape.duration === 4000 && shape.fps === 30, `${shape.duration}ms / ${shape.fps}fps`);
    check('图层名是写给人看的', shape.names.includes('试试看（可删除）'), JSON.stringify(shape.names));

    const shot = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('query.capture', { maxWidth: 640 });
      const d = r.data || {};
      return { ok: r.ok, url: String(d.dataUrl || d.url || ''), w: d.width ?? 0 };
    })()`);
    check('画布确实渲染出了内容（不是空白）', shot.ok && shot.url.startsWith('data:image/png') && shot.url.length > 8000, `len=${shot.url.length} w=${shot.w}`);

    /* ── 6. 删掉之后不再自动重建 ─────────────────────── */
    await cdp.conn.call('Page.navigate', { url: base });
    await sleep(1000);
    await cdp.waitFor(`!!document.querySelector('[data-project-id="${SAMPLE_ID}"]')`, 12000);
    await cdp.ev(AUTO_CONFIRM);
    const removed = await cdp.ev(`(() => {
      const card = document.querySelector('[data-project-id="${SAMPLE_ID}"]');
      const btn = card?.querySelector('button[title="删除"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await sleep(900);
    const afterDelete = await cdp.ev(READ_LAUNCHER);
    check('删除示例后列表清空', removed && afterDelete.cards.length === 0, String(afterDelete.cards.length));
    check('清空后回落到空状态文案', afterDelete.empty === true);

    await cdp.conn.call('Page.reload');
    await sleep(1000);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 12000);
    const reborn = await cdp.ev(READ_LAUNCHER);
    check('刷新也不会把删掉的示例塞回来', reborn.cards.length === 0, String(reborn.cards.length));

    /* 但用户想找回来时，得有一条明路 */
    const restored = await cdp.ev(`(() => {
      const b = document.querySelector('[data-testid="sample-restore"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);
    await sleep(1200);
    const back = await cdp.ev(READ_LAUNCHER);
    check('空状态里能一键放回示例', restored && back.cards.length === 1 && back.cards[0].id === SAMPLE_ID, JSON.stringify(back.cards.map((c) => c.id)));

    /* ── 7. 英文模式：介绍区零中文 ───────────────────── */
    await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'EN');
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(700);
    const en = await cdp.ev(READ_LAUNCHER);
    const cjk = (en.heroText.match(/[\u4e00-\u9fff]/g) ?? []).length;
    check('英文模式下介绍区零中文', cjk === 0, JSON.stringify({ cjk, sample: en.heroText.slice(0, 120) }));
    check('四拍标签也跟着翻译', en.steps.join(' ').includes('Canvas') && en.steps.join(' ').includes('Keyframes'), JSON.stringify(en.steps));
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
