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
const REVISION_ID = 'prj_sample_revision';
const ANTHEM_ID = 'prj_sample_anthem';
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
  return (row.sampleVersions && row.sampleVersions['prj_sample_start']) ?? row.sampleVersion ?? null;
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
  /* v2.11 起版本号是逐份的：地图里那一格也得清掉，否则「已经是最新」会先命中 */
  if (nextPrefs.sampleVersions) {
    nextPrefs.sampleVersions = { ...nextPrefs.sampleVersions };
    delete nextPrefs.sampleVersions['prj_sample_start'];
  }
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
    check(
      '首次打开就有三份示例（极限样片 + 再改一版 + 我在加我的图层数）',
      first.cards.length === 3 && first.cards.some((c) => c.id === SAMPLE_ID) && first.cards.some((c) => c.id === REVISION_ID) && first.cards.some((c) => c.id === ANTHEM_ID),
      JSON.stringify(first.cards.map((c) => c.id)),
    );
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
    const primaryCard = first.cards.find((c) => c.id === SAMPLE_ID);
    check('示例卡片带「示例」徽标', primaryCard?.badge === true);
    check(
      '卡片刻出了尺寸与图层数',
      /1920×1080/.test(primaryCard?.text ?? '') && /16 图层/.test(primaryCard?.text ?? ''),
      String(primaryCard?.text).slice(0, 80),
    );
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
    check('刷新不会重复创建示例（还是三份）', again.cards.length === 3, String(again.cards.length));
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
    check(
      '只删一份时另外两份还在（三份各自独立）',
      removed && afterDelete.cards.length === 2 && afterDelete.cards.some((c) => c.id === REVISION_ID) && afterDelete.cards.some((c) => c.id === ANTHEM_ID),
      JSON.stringify(afterDelete.cards.map((c) => c.id)),
    );
    check('少一份示例时页头仍然留着「放回示例」', await cdp.ev(`!!document.querySelector('[data-testid="sample-restore"]')`));

    const removed2 = await cdp.ev(`(() => {
      const card = document.querySelector('[data-project-id="${REVISION_ID}"]');
      const btn = card?.querySelector('button[title="删除"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await sleep(900);
    const removed3 = await cdp.ev(`(() => {
      const card = document.querySelector('[data-project-id="${ANTHEM_ID}"]');
      const btn = card?.querySelector('button[title="删除"]');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    await sleep(900);
    const emptyNow = await cdp.ev(READ_LAUNCHER);
    check('三份都删掉之后列表清空', removed2 && removed3 && emptyNow.cards.length === 0, String(emptyNow.cards.length));
    check('清空后回落到空状态文案', emptyNow.empty === true);

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
    await sleep(2400);
    const back = await cdp.ev(READ_LAUNCHER);
    check(
      '一键能把三份示例都放回来',
      restored && back.cards.length === 3 && back.cards.some((c) => c.id === SAMPLE_ID) && back.cards.some((c) => c.id === REVISION_ID) && back.cards.some((c) => c.id === ANTHEM_ID),
      JSON.stringify(back.cards.map((c) => c.id)),
    );

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
      rw === 'ok' && /极限样片（64 秒）/.test(up.cards.find((c) => c.id === SAMPLE_ID)?.text ?? ''),
      `${rw} · ${String(up.cards.find((c) => c.id === SAMPLE_ID)?.text).slice(0, 48)}`,
    );
    const noticeUp = await cdp.ev(READ_NOTICE);
    check('换新之后明说「示例已换成新版」', noticeUp?.reason === 'upgraded' && /换成新版/.test(noticeUp.text), JSON.stringify(noticeUp).slice(0, 90));

    /* 用户改过的那份不能悄悄盖掉 */
    const rw2 = await cdp.ev(REWIND_SAMPLE('edited'));
    await cdp.conn.call('Page.reload');
    await sleep(1200);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 12000);
    const kept = await cdp.ev(READ_LAUNCHER);
    check(
      '改过的示例不会被静静覆盖',
      rw2 === 'ok' && /从这里开始/.test(kept.cards.find((c) => c.id === SAMPLE_ID)?.text ?? ''),
      `${rw2} · ${String(kept.cards.find((c) => c.id === SAMPLE_ID)?.text).slice(0, 48)}`,
    );
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
    check(
      '点「换成新版」才真的换掉',
      clickedReplace && /极限样片（64 秒）/.test(replaced.cards.find((c) => c.id === SAMPLE_ID)?.text ?? ''),
      String(replaced.cards.find((c) => c.id === SAMPLE_ID)?.text).slice(0, 48),
    );
    check('版本标记落进 prefs（下次不再来回换）', (await cdp.ev(READ_SAMPLE_VERSION)) === 6, String(await cdp.ev(READ_SAMPLE_VERSION)));

    /* ── 7. 第二份示例：再改一版（速度网格 + 逐字时间） ──────────
       两份片子是对照组：第一份把**渲染**压到上限，这一份把**叙事**压到上限。
       引擎为它补了两样东西 —— project.tempo（速度网格）与 project.lyrics（词级时间），
       所以这里的断言不查「好不好看」，只查「数据与查询是否自洽」——
       那些才是下次改片时会真的踩到的东西。 */
    await cdp.conn.call('Page.navigate', { url: `${base}?view=editor&projectId=${REVISION_ID}` });
    await sleep(1400);
    const inRev = await cdp.waitFor(`!!window.__kly && window.__kly.state().project.id === '${REVISION_ID}'`, 15000);
    check('第二份示例能单独打开', inRev);

    const rev = await cdp.ev(`(() => {
      const p = window.__kly.state().project;
      const code = p.layers.filter((l) => l.type === 'code');
      const lines = p.lyrics || [];
      const prefix = (l) => Number(String(l.name).slice(0, 2));
      const secs = [...new Set(code.map(prefix).filter((n) => Number.isFinite(n) && n > 0))];
      return {
        id: p.id, duration: p.duration, layers: p.layers.length, tempo: p.tempo,
        lyrics: lines.length,
        firstLyric: lines[0] && lines[0].start,
        sorted: lines.every((l, i) => i === 0 || l.start >= lines[i - 1].start),
        inside: lines.every((l) => l.start >= 0 && l.end <= p.duration && l.end > l.start),
        glsl: code.filter((l) => l.code.engine === 'glsl').length,
        blurred: code.filter((l) => l.code.motionBlur).map((l) => l.code.motionBlur.samples),
        halfRes: code.filter((l) => (l.code.renderScale ?? 1) < 1).length,
        sections: secs.length,
        tracks: p.layers.reduce((n, l) => n + (l.animation?.tracks?.length ?? 0), 0),
        bound: p.layers.filter((l) => Object.keys(l.bindings || {}).length > 0).length,
        audio: p.layers.filter((l) => l.type === 'audio').length,
        assets: p.assets.length + p.fonts.length,
      };
    })()`);
    check('是 60 秒 / 128 BPM 的第二支片', rev.duration === 60000 && rev.tempo?.bpm === 128 && rev.tempo?.meter === 4, `${rev.duration}ms ${JSON.stringify(rev.tempo)}`);
    check('九段分镜（01…09 各一段）', rev.sections === 9, String(rev.sections));
    check('21 行歌词，全部落在片长内且按时间排序', rev.lyrics === 21 && rev.sorted && rev.inside, `${rev.lyrics} 行`);
    check('冷开那四秒里没有词（先给画面）', rev.firstLyric >= 4000, String(rev.firstLyric));
    check('引爆段：两个半分辨率层 + 一个 4 子帧运动模糊层（v2.12 调优后 13ms/帧）', rev.glsl === 1 && rev.halfRes === 2 && rev.blurred.length === 1 && rev.blurred[0] === 4, JSON.stringify({ glsl: rev.glsl, halfRes: rev.halfRes, blurred: rev.blurred }));
    check('原生图层也在用引擎：关键帧轨道 + 绑定表达式', rev.tracks >= 2 && rev.bound === 1, `${rev.tracks} 轨道 / ${rev.bound} 绑定`);
    check('五条合成音轨，仍然零外部资源', rev.audio === 5 && rev.assets === 0, `${rev.audio} 音轨 / ${rev.assets} 资源`);

    /* 九个时刻各渲一遍：跨段跑完不炸，才说明「每帧都是纯函数」这件事没破 */
    const runtimeErrs = await cdp.ev(`(async () => {
      for (const ms of [1500, 6400, 16200, 25600, 29800, 39000, 41270, 46900, 53900]) await window.__kly.frame(ms);
      const out = [];
      for (const l of window.__kly.state().project.layers.filter((x) => x.type === 'code')) {
        const r = await window.__kly.dispatch('query.layer', { id: l.id });
        const e = r.data && r.data.runtime && r.data.runtime.error;
        if (e) out.push(l.name + ' -> ' + e);
      }
      return JSON.stringify(out);
    })()`);
    check('九个时刻跨段渲染，代码层零异常', runtimeErrs === '[]', runtimeErrs.slice(0, 200));

    /*
     * 谱面自洽：这一条比「听着像」重要得多。
     * 128 BPM / 4/4 → 一拍 468.75ms、一小节 1875ms；4250ms 是第 9.07 拍、
     * 距上一个整拍 31ms、强拍在第 8 拍（3750ms）。数字对不上就是引擎算错了。
     */
    const score = await cdp.ev(`(async () => {
      const at = async (ms) => (await window.__kly.dispatch('query.score', { at: ms, ahead: 2 })).data;
      return JSON.stringify({ on: await at(4250), down: await at(3750), lyric: await at(5000) });
    })()`);
    const sc = JSON.parse(score);
    check('一拍 = 468.75ms，4250ms 落在第 9 拍后 31ms', sc.on.sinceBeatMs === 31 && Math.abs(sc.on.beat - 9.067) < 0.01, JSON.stringify({ since: sc.on.sinceBeatMs, beat: sc.on.beat }));
    check('3750ms 是强拍，且下一个强拍在 5625ms', sc.down.downbeat === true && sc.down.nextDownbeats[0] === 5625, JSON.stringify(sc.down.nextDownbeats));
    /*
     * 逐字读数必须是**时间**的映射，不是「差不多就行」：
     * 这一行 4060..5810 里五个字各占 350ms，5000ms 时唱完两个字、第三个唱到 68.6%，
     * 所以是 2.686 个字。以前这里报 5（旧实现每两个单元之间硬加 1 当词间空格，
     * 中文没有空格，于是半分处就报「唱完」）。
     */
    check(
      '5000ms 正在唱「先画一条线」，唱了 2.69 个字',
      sc.lyric.lyric?.text === '先画一条线' && Math.abs(sc.lyric.lyric.sungChars - 2.69) < 0.06,
      JSON.stringify(sc.lyric.lyric),
    );

    const revAudio = await cdp.ev(`window.__kly.audio.measure().then((m) => JSON.stringify({ peak: m.peak, rms: m.rms, ms: m.duration }))`);
    check('第二支片的音轨真的有声音', JSON.parse(revAudio).peak > 0.01, revAudio);

    /* ── 7b. 第三份示例：我在加我的图层数（157 秒完整复刻骨架） ──
       与第二支同一套断言思路：不查「好不好看」，查「结构与数据是否自洽」。
       这一支的重点是 22 窗口 / 46 行词 / params 共源码变奏 / HUD 全片连续。 */
    await cdp.conn.call('Page.navigate', { url: `${base}?view=editor&projectId=${ANTHEM_ID}` });
    await sleep(1600);
    const inAnthem = await cdp.waitFor(`!!window.__kly && window.__kly.state().project.id === '${ANTHEM_ID}'`, 15000);
    check('第三支示例能单独打开', inAnthem);

    const ant = await cdp.ev(`(() => {
      const p = window.__kly.state().project;
      const code = p.layers.filter((l) => l.type === 'code');
      const lines = p.lyrics || [];
      const named = code.filter((l) => /^\\d\\d · /.test(l.name));
      return {
        id: p.id, duration: p.duration, tempo: p.tempo,
        lyrics: lines.length,
        sorted: lines.every((l, i) => i === 0 || l.start >= lines[i - 1].start),
        inside: lines.every((l) => l.start >= 0 && l.end <= p.duration && l.end > l.start),
        codeLayers: code.length,
        hud: code.filter((l) => /HUD/.test(l.name) && l.inPoint === 0 && l.outPoint === p.duration).length,
        segments: named.length,
        promptVariants: code.filter((l) => /钩子|恳求/.test(l.name)),
        params: code.map((l) => l.code.params || null).filter(Boolean),
        audio: p.layers.filter((l) => l.type === 'audio').length,
        assets: p.assets.length + p.fonts.length,
      };
    })()`);
    check('是 157 秒 / 132.007 BPM 的第三支片', ant.duration === 156651 && Math.abs(ant.tempo?.bpm - 132.007) < 0.001 && ant.tempo?.meter === 4, `${ant.duration}ms ${JSON.stringify(ant.tempo)}`);
    check('22 个窗口代码层 + 全片 1 层 HUD（共 23 个代码层）', ant.codeLayers === 23 && ant.hud === 1 && ant.segments === 22, `${ant.codeLayers} 代码层 / ${ant.segments} 段名`);
    check('46 行歌词，全部落在片长内且按时间排序', ant.lyrics === 46 && ant.sorted && ant.inside, `${ant.lyrics} 行`);
    check('恳求 ×3 与钩子 ×4 共用源码（params 变奏）', ant.params.filter((x) => x.variant).length === 3 && ant.params.filter((x) => x.n).length === 4, JSON.stringify(ant.params));
    check('六条合成音轨（4 铺底 + 节拍 + 切点提示），零外部资源', ant.audio === 6 && ant.assets === 0, `${ant.audio} 音轨 / ${ant.assets} 资源`);

    /* 六个代表性时刻各渲一遍（含 hook 与 outro），代码层零异常 */
    const anthemErrs = await cdp.ev(`(async () => {
      for (const ms of [1500, 11000, 23500, 96000, 132000, 150000]) await window.__kly.frame(ms);
      const out = [];
      for (const l of window.__kly.state().project.layers.filter((x) => x.type === 'code')) {
        const r = await window.__kly.dispatch('query.layer', { id: l.id });
        const e = r.data && r.data.runtime && r.data.runtime.error;
        if (e) out.push(l.name + ' -> ' + e);
      }
      return JSON.stringify(out);
    })()`);
    check('六个时刻跨段渲染，代码层零异常', anthemErrs === '[]', anthemErrs.slice(0, 300));

    /* ── 8. 英文模式：介绍区零中文 ───────────────────── */
    await cdp.conn.call('Page.navigate', { url: base });
    await sleep(1400);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 15000);
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
