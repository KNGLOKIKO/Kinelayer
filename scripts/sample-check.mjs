/**
 * 首次运行验收：示例工程 + 介绍页动画。
 *
 * 验的是「一个从没打开过这个应用的人，第一眼看到什么」：
 *   1. 工程库里已经有一份示例，带缩略图与「示例」徽标
 *   2. 它是真的能打开、能改、内容完整（64 秒极限样片 / 九段分镜 / 零外部资源）
 *   3. 第 0 帧就有完整画面（没有入场预设导致的「开场白屏」）
 *   3b. 六条音轨是真的有声音（离线渲染出来的 peak 不为 0）
 *   4. 引导条只出现一次，刷新不再出现；示例不会被重复创建
 *   5. 旧版本（v2.8 那份 4 秒海报）会被换成新版；被改过的不覆盖，但要说清楚
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

const READ_NOTICE = `(() => {
  const n = document.querySelector('[data-testid="sample-notice"]');
  return n ? { reason: n.dataset.reason ?? '', text: (n.innerText || '').replace(/\\n/g, ' ') } : null;
})()`;

const READ_SAMPLE_VERSION = `(async () => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('kinelayer'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await open();
  const row = await new Promise((res) => {
    const q = db.transaction('prefs', 'readonly').objectStore('prefs').get('app');
    q.onsuccess = () => res(q.result?.value ?? {});
  });
  db.close();
  return row.sampleVersion ?? null;
})()`;

/**
 * 把库里那份示例改回 v2.8 的样子：老名字、4 秒、prefs 里只有 sampleSeeded。
 * untouched = 建档之后没被动过（createdAt === updatedAt）；edited = 用户改过。
 * 只改 meta 就够了 —— seedSample 的两个判据（版本号 / 有没有被改过）读的都是 meta。
 */
const REWIND_SAMPLE = (mode) => `(async () => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('kinelayer'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const db = await open();
  const read = (store, key) => new Promise((res) => {
    const q = db.transaction(store, 'readonly').objectStore(store).get(key);
    q.onsuccess = () => res(q.result?.value ?? null);
  });
  const idx = await read('meta', 'projectIndex');
  const prefs = (await read('prefs', 'app')) ?? {};
  const list = Array.isArray(idx) ? [...idx] : [];
  const i = list.findIndex((m) => m.id === '${SAMPLE_ID}');
  if (i < 0) { db.close(); return 'no-meta'; }
  list[i] = {
    ...list[i],
    name: '示例 · 从这里开始',
    duration: 4000,
    updatedAt: ${mode === 'edited' ? 'list[i].createdAt + 60000' : 'list[i].createdAt'},
  };
  const nextPrefs = { ...prefs, sampleSeeded: true };
  delete nextPrefs.sampleVersion;
  await new Promise((res, rej) => {
    const tx = db.transaction(['meta', 'prefs'], 'readwrite');
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
    tx.objectStore('meta').put({ key: 'projectIndex', value: list });
    tx.objectStore('prefs').put({ key: 'app', value: nextPrefs });
  });
  db.close();
  return 'ok';
})()`;

const main = async () => {  const cdp = await launch({ url: base, width: 1440, height: 900 });
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
    /*
     * 缩略图不能用一个「字节数够大」的阈值糊过去：这支片子的第 0 帧本来就是几乎全黑的，
     * 一张纯黑 JPEG 只有一千多字节，而一张真的暗场画面也只有三千多 —— 阈值设 5000
     * 会把正确的东西判成错的。所以直接把它画到 64×36 上数颜色。
     */
    const thumbColors = await cdp.ev(`(async () => {
      const img = document.querySelector('[data-project-id="${SAMPLE_ID}"] img');
      const src = img ? img.getAttribute('src') || '' : '';
      if (!src.startsWith('data:image/')) return -1;
      const i = new Image(); i.src = src; await i.decode();
      const c = document.createElement('canvas'); c.width = 64; c.height = 36;
      const x = c.getContext('2d'); x.drawImage(i, 0, 0, 64, 36);
      const d = x.getImageData(0, 0, 64, 36).data;
      const seen = new Set();
      for (let k = 0; k < d.length; k += 4) seen.add((d[k] << 16) | (d[k + 1] << 8) | d[k + 2]);
      return seen.size;
    })()`);
    check('示例缩略图是真的画面（不是灰块）', thumbColors >= 24, `${thumbColors} 种颜色`);
    check('示例卡片带「示例」徽标', first.cards[0].badge === true);
    check('卡片刻出了尺寸与图层数', /1920×1080/.test(first.cards[0].text) && /16 图层/.test(first.cards[0].text), first.cards[0].text.slice(0, 80));
    check(
      '引导条说明了刚才发生了什么（时长 / 代码层 / 音轨）',
      !!first.banner && /64 秒/.test(first.banner) && /条音轨/.test(first.banner) && /个代码层/.test(first.banner),
      String(first.banner).slice(0, 130),
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
      const coldOpen = p.layers.find((l) => l.name === '01 · 冷开 · 15');
      const audio = p.layers.filter((l) => l.type === 'audio');
      const code = p.layers.filter((l) => l.type === 'code');
      return {
        id: p.id, layers: p.layers.length, assets: p.assets.length, fonts: p.fonts.length,
        duration: p.duration, fps: p.fps, version: p.version, loop: p.loop,
        tracks: p.layers.reduce((n, l) => n + (l.animation?.tracks?.length ?? 0), 0),
        codeLayers: code.length,
        audioLayers: audio.length,
        audioPresets: audio.map((l) => l.tone.preset).sort().join(','),
        hasEnter: p.layers.some((l) => l.animation?.enter || l.animation?.exit),
        coldOpenIn: coldOpen ? coldOpen.inPoint : null,
        halfRes: code.filter((l) => (l.code.renderScale ?? 1) < 1).map((l) => l.name),
        names: p.layers.map((l) => l.name),
      };
    })()`);
    check('打开的就是那条示例', shape.id === SAMPLE_ID, shape.id);
    check('是一支 64 秒极限样片（1920×1080 / 30fps / 不循环）', shape.duration === 64000 && shape.fps === 30 && shape.loop === false, `${shape.duration}ms ${shape.fps}fps loop=${shape.loop}`);
    check('九个代码层各管一段（不是一堆小图层）', shape.layers === 16 && shape.codeLayers === 9, JSON.stringify({ layers: shape.layers, code: shape.codeLayers }));
    check('八段分镜标题齐全（01…08）', ['01', '02', '03', '04', '05', '06', '07', '08'].every((n) => shape.names.some((x) => x.startsWith(`${n} ·`))), JSON.stringify(shape.names));
    /* 这支片子是把动画写进代码里的，不靠关键帧轨道 —— 断言也换成「代码层覆盖整条时间轴」 */
    check('全片不依赖关键帧轨道（动画全在代码里）', shape.tracks === 0, `${shape.tracks} 条轨道`);
    check('六条音轨：四条铺底 + 节拍 + 切点提示', shape.audioLayers === 6 && shape.audioPresets === 'chime,pad,pad,pad,pad,pulse', shape.audioPresets);
    check('不依赖任何外部资源', shape.assets === 0 && shape.fonts === 0, `${shape.assets} 资源 / ${shape.fonts} 字体`);
    check('没有入场/退场预设（第 0 帧不会是白屏）', shape.hasEnter === false && shape.coldOpenIn === 0, `enter=${shape.hasEnter} 冷开层 inPoint=${shape.coldOpenIn}`);
    check('图层名是写给人看的分镜表', shape.names.includes('07 · 风格墙') && shape.names.includes('音频 · 切点提示'), JSON.stringify(shape.names.slice(0, 6)));
    /* 性能取舍要跟着示例一起进版本库：这一层是逐像素噪声，跑在半分辨率上是设计决定，不是巧合 */
    check('逐像素那一层标了半分辨率（性能取舍可见）', JSON.stringify(shape.halfRes) === JSON.stringify(['05 · 液态 shader']), JSON.stringify(shape.halfRes));

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
    check('音轨长度与工程时长一致', !!audio.m && Math.abs(audio.m.ms - 64000) <= 500, `${audio.m?.ms}ms`);
    check('第 30 秒同时响着铺底与节拍', audio.at30.includes('pad') && audio.at30.includes('pulse'), JSON.stringify(audio.at30));
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

    /* ── 6b. 版本升级：v2.8 的老用户必须拿到新版 ──────────
       这条是真踩到的坑：seedSample 原来只记「塞过没有」，于是 v2.9 换成 96 秒
       导览之后，所有跑过 v2.8 的浏览器里仍然是那个 4 秒海报，而且从界面上
       完全看不出来 —— 用户只会觉得「说好的示例呢」。
       两个判据缺一不可：版本号（该不该换）、有没有被改过（能不能换）。 */
    const rw = await cdp.ev(REWIND_SAMPLE('untouched'));
    await cdp.conn.call('Page.reload');
    await sleep(1200);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 12000);
    const up = await cdp.ev(READ_LAUNCHER);
    check(
      '库里留着旧版时会换成新版（不是一直停在旧海报）',
      rw === 'ok' && /极限样片（64 秒）/.test(up.cards[0]?.text ?? ''),
      `${rw} · ${String(up.cards[0]?.text).slice(0, 48)}`,
    );
    const noticeUp = await cdp.ev(READ_NOTICE);
    check('换新之后明说「示例已换成新版」', noticeUp?.reason === 'upgraded' && /换成新版/.test(noticeUp.text), JSON.stringify(noticeUp).slice(0, 90));

    /* 用户改过的那份不能悄悄盖掉 */
    const rw2 = await cdp.ev(REWIND_SAMPLE('edited'));
    await cdp.conn.call('Page.reload');
    await sleep(1200);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 12000);
    const kept = await cdp.ev(READ_LAUNCHER);
    check('改过的示例不会被静静覆盖', rw2 === 'ok' && /从这里开始/.test(kept.cards[0]?.text ?? ''), `${rw2} · ${String(kept.cards[0]?.text).slice(0, 48)}`);
    const noticeMod = await cdp.ev(READ_NOTICE);
    check('但会明说「有新版、没动你的」', noticeMod?.reason === 'modified' && /没动它/.test(noticeMod.text), JSON.stringify(noticeMod).slice(0, 90));

    /* 点了才换，换完版本标记要落盘，免得每次刷新都问一遍 */
    const clickedReplace = await cdp.ev(`(() => {
      window.confirm = () => true;
      const b = document.querySelector('[data-testid="sample-replace"]');
      if (!b) return false;
      b.click();
      return true;
    })()`);
    await sleep(1600);
    const replaced = await cdp.ev(READ_LAUNCHER);
    check('点「换成新版」才真的换掉', clickedReplace && /极限样片（64 秒）/.test(replaced.cards[0]?.text ?? ''), String(replaced.cards[0]?.text).slice(0, 48));
    check('版本标记落进 prefs（下次不再来回换）', (await cdp.ev(READ_SAMPLE_VERSION)) === 3, String(await cdp.ev(READ_SAMPLE_VERSION)));

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
