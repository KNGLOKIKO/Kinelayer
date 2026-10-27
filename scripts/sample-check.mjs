/**
 * 首次运行验收：示例工程 + 介绍页动画。
 *
 * 验的是「一个从没打开过这个应用的人，第一眼看到什么」：
 *   1. 工程库里已经有一份示例，带缩略图与「示例」徽标
 *   2. 它是真的能打开、能改、内容完整（96 秒长片 / 六个章节 / 零外部资源）
 *   3. 第 0 帧就有完整画面（没有入场预设导致的「开场白屏」）
 *   3b. 三条音轨是真的有声音（离线渲染出来的 peak 不为 0）
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
    check('卡片刻出了尺寸与图层数', /1920×1080/.test(first.cards[0].text) && /\d+ 图层/.test(first.cards[0].text), first.cards[0].text.slice(0, 80));
    check(
      '引导条说明了刚才发生了什么（时长 / 图层 / 音轨）',
      !!first.banner && /96 秒/.test(first.banner) && /条音轨/.test(first.banner) && /条关键帧轨道/.test(first.banner),
      String(first.banner).slice(0, 120),
    );

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
      const firstTitle = p.layers.find((l) => l.name === '01 · 标题');
      const audio = p.layers.filter((l) => l.type === 'audio');
      return {
        id: p.id, layers: p.layers.length, assets: p.assets.length, fonts: p.fonts.length,
        duration: p.duration, fps: p.fps, version: p.version, loop: p.loop,
        tracks: p.layers.reduce((n, l) => n + (l.animation?.tracks?.length ?? 0), 0),
        codeLayers: p.layers.filter((l) => l.type === 'code').length,
        audioLayers: audio.length,
        audioPresets: audio.map((l) => l.tone.preset),
        hasEnter: p.layers.some((l) => l.animation?.enter || l.animation?.exit),
        firstTitleIn: firstTitle ? firstTitle.inPoint : null,
        firstTitleOpacity: firstTitle ? firstTitle.opacity : null,
        names: p.layers.map((l) => l.name),
      };
    })()`);
    check('打开的就是那条示例', shape.id === SAMPLE_ID, shape.id);
    check('是一支 96 秒长片（1920×1080 / 30fps / 不循环）', shape.duration === 96000 && shape.fps === 30 && shape.loop === false, `${shape.duration}ms ${shape.fps}fps loop=${shape.loop}`);
    check('图层量级够撑起六个章节', shape.layers >= 45 && shape.codeLayers >= 6, JSON.stringify({ layers: shape.layers, code: shape.codeLayers }));
    check('关键帧轨道铺满整条时间轴', shape.tracks >= 40, String(shape.tracks));
    check('六章标题齐全（01…06）', ['01', '02', '03', '04', '05', '06'].every((n) => shape.names.includes(`${n} · 标题`)), JSON.stringify(shape.names.filter((n) => n.includes('标题'))));
    check('三条音轨各司其职（pad / pulse / chime）', shape.audioLayers === 3 && shape.audioPresets.join(',') === 'pad,pulse,chime', JSON.stringify(shape.audioPresets));
    check('不依赖任何外部资源', shape.assets === 0, `${shape.assets} 资源 / ${shape.fonts} 字体`);
    check('没有入场/退场预设（第 0 帧不会是白屏）', shape.hasEnter === false && shape.firstTitleIn === 0 && shape.firstTitleOpacity === 1);
    check('图层名是写给人看的（分镜表）', shape.names.includes('收尾 · 提示') && shape.names.includes('音频 · 铺底长音'), JSON.stringify(shape.names.slice(0, 6)));

    /* 声音不能只在数据里：离线渲染一遍，peak 为 0 就是静音 */
    const audio = await cdp.ev(`(async () => {
      const m = await window.__kly.audio.measure();
      const at30 = window.__kly.audio.describeAt(30000).map((x) => x.preset).sort();
      const peaks = await window.__kly.audio.peaks(160);
      let nonzero = 0;
      if (peaks) for (const v of peaks) if (v > 0.01) nonzero++;
      return { m, at30, buckets: peaks ? peaks.length : 0, nonzero };
    })()`);
    check('离线渲染出来的音轨真的有声音', !!audio.m && audio.m.peak > 0.01 && audio.m.rms > 0.001, JSON.stringify(audio.m));
    check('音轨长度与工程时长一致', !!audio.m && Math.abs(audio.m.ms - 96000) <= 500, `${audio.m?.ms}ms`);
    check('第 30 秒同时响着铺底与节拍', audio.at30.join(',') === 'pad,pulse', JSON.stringify(audio.at30));
    check('时间轴波形拿得到峰值（大部分非零）', audio.buckets === 160 && audio.nonzero > 80, `${audio.nonzero}/${audio.buckets}`);

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
