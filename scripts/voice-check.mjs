/**
 * 人声引擎验收。
 *
 * 合成出来的声音「像不像人」没法自动判，但**能判的**比想象中多：
 *   - 切分：汉字/拼音/数字/英文混写能不能切成音节，标点有没有变成停顿
 *   - 计划：时长随模式/语速真的变（说话比演唱短、rate 加倍更短）
 *   - 命令：voice.create 的长度必须等于计划长度，改词后 sync 跟着变
 *   - 渲染：离线渲染 peak/rms 非零（真的有声），长度对得上
 *   - 确定性：同一份 spec 渲染两次，样本校验和必须完全相等
 *   - 接线：离线混音与波形都认这条人声层
 *
 * 需要 dev server 跑在 5273。
 */
import { launch, reporter, sleep } from './_cdp.mjs';

const base = 'http://localhost:5273/';
const ORIGIN = 'http://localhost:5273';
const { check, finish } = reporter();

/** 一次典型的「说一句」的参数，后面多处复用 */
const SPEC = { text: '你好世界', mode: 'sing', preset: 'female', beatsPerSyllable: 1, bpm: 120 };

const main = async () => {
  const cdp = await launch({ url: base, width: 1440, height: 900 });
  try {
    await cdp.conn.call('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: 'indexeddb' });
    await cdp.conn.call('Page.reload');
    const ready = await cdp.waitFor(`typeof window.__kly !== "undefined" && !!window.__kly.voice`, 20000);
    check('dev 调试口就绪（含 voice）', ready);
    if (!ready) return;

    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 12000);

    /* ── 1. 切分：拼音表到底认不认字 ────────────────────── */
    const split = await cdp.ev(`(() => {
      const v = window.__kly.voice;
      const han = v.syllables('你好世界');
      const punct = v.syllables('你好，世界');
      const digits = v.syllables('2026');
      const latin = v.syllables('ni hao');
      const rare = v.syllables('龘');
      return {
        han: han.map(s => s.pinyin),
        hanPh: han.map(s => s.phonemes.length),
        pause: punct[1] && punct[1].pauseMs,
        digits: digits.map(s => s.pinyin),
        latin: latin.map(s => s.pinyin),
        rareUnknown: rare[0] && rare[0].unknown,
      };
    })()`);
    check('四个汉字切成四个音节', split.han.length === 4, JSON.stringify(split.han));
    check('读音查表正确（ni/hao/shi/jie）', split.han.join(' ') === 'ni hao shi jie', split.han.join(' '));
    check('每个音节都拆出了音素', split.hanPh.every((n) => n > 0), JSON.stringify(split.hanPh));
    check('逗号变成停顿，不占音节', (split.pause ?? 0) > 0, String(split.pause));
    check('数字按读法切（er ling er liu）', split.digits.length === 4 && split.digits[0] === 'er', JSON.stringify(split.digits));
    check('拼音直写也能切（ni hao）', split.latin.length === 2 && split.latin[0] === 'ni', JSON.stringify(split.latin));
    check('表里没有的字标成 unknown', split.rareUnknown === true, String(split.rareUnknown));

    /* ── 2. 计划：时长随参数真的变 ─────────────────────── */
    const plans = await cdp.ev(`(() => {
      const v = window.__kly.voice;
      const sing = v.plan(${JSON.stringify(SPEC)});
      const speak1 = v.plan({ text: '你好世界', mode: 'speak', rate: 1 });
      const speak2 = v.plan({ text: '你好世界', mode: 'speak', rate: 2 });
      const slower = v.plan({ ...${JSON.stringify(SPEC)}, beatsPerSyllable: 2 });
      const melody = v.plan({ ...${JSON.stringify(SPEC)}, melody: [0, 4, 7, 12] });
      const empty = v.plan({ text: '', mode: 'sing' });
      return { sing, speak1, speak2, slower, melody, empty };
    })()`);
    check('演唱计划有 4 个音符', plans.sing.notes.length === 4, String(plans.sing.notes.length));
    check('计划时长非零且大于 0.5 秒', plans.sing.totalMs > 500, `${plans.sing.totalMs}ms`);
    check('说话比演唱短（演唱按拍，说话按字）', plans.speak1.totalMs < plans.sing.totalMs, `${plans.speak1.totalMs} vs ${plans.sing.totalMs}`);
    check('语速 ×2 更短', plans.speak2.totalMs < plans.speak1.totalMs * 0.75, `${plans.speak2.totalMs} vs ${plans.speak1.totalMs}`);
    check('每字两拍比一拍长', plans.slower.totalMs > plans.sing.totalMs * 1.5, `${plans.slower.totalMs} vs ${plans.sing.totalMs}`);
    check('给了旋律就按旋律走（4 个音高各不相同）', new Set(plans.melody.notes.map((n) => n.f0)).size >= 3, JSON.stringify(plans.melody.notes.map((n) => n.f0)));
    check('空文本不会崩，也不产出音符', plans.empty.notes.length === 0, JSON.stringify({ n: plans.empty.notes.length, ms: plans.empty.totalMs }));

    /* 音符首尾相接：不允许重叠（重叠 = 两个字同时在响） */
    const gapped = plans.sing.notes.every((n, i, a) => i === 0 || n.atMs >= a[i - 1].atMs + a[i - 1].ms - 1);
    check('音符按时间顺序排开且不重叠', gapped, JSON.stringify(plans.sing.notes.map((n) => [n.atMs, n.ms])));

    /* ── 3. 渲染：真的有声，且两次完全一样 ─────────────── */
    const sound = await cdp.ev(`(async () => {
      const v = window.__kly.voice;
      const a = await v.render(${JSON.stringify(SPEC)});
      const b = await v.render(${JSON.stringify(SPEC)});
      const male = await v.render({ ...${JSON.stringify(SPEC)}, preset: 'male' });
      const robot = await v.render({ ...${JSON.stringify(SPEC)}, preset: 'robot' });
      const other = await v.render({ text: '加我的图层数', mode: 'sing', preset: 'female' });
      const quiet = await v.render({ ...${JSON.stringify(SPEC)}, vibrato: 0, breath: 0 });
      const stab = await v.stability(${JSON.stringify(SPEC)});
      return { a, b, male, robot, other, quiet, stab };
    })()`);
    check('离线渲染出了声音（peak/rms 非零）', sound.a && sound.a.peak > 0.05 && sound.a.rms > 0.005, JSON.stringify(sound.a));
    check('渲染长度等于计划长度', sound.a && Math.abs(sound.a.ms - plans.sing.totalMs) <= 40, `${sound.a?.ms} vs ${plans.sing.totalMs}`);
    /*
     * 复现性只能按「逐样本偏差」判，不能按校验和：
     * OfflineAudioContext 同一张图跑两遍，末位就会差 1~2 个 float32 ULP，
     * 量化到 16bit 也仍有个别样本压在舍入边界上翻向另一边 —— 校验和必然不同。
     * 真要挡住的是「引了 Math.random」那类错，它们会造成 1e-2 级别的差异，
     * 所以卡 1e-6 既够严也不装神弄鬼。
     */
    check('同 spec 两次渲染逐样本偏差 < 1e-6（可复现）', sound.stab && sound.stab.maxDiff < 1e-6 && sound.stab.over === 0, JSON.stringify(sound.stab));
    check('两次渲染长度完全一致', sound.stab && sound.stab.lenA === sound.stab.lenB, JSON.stringify(sound.stab));
    check('换音色就换了一副嗓子', sound.male && sound.male.hash !== sound.a.hash, `${sound.a?.hash} vs ${sound.male?.hash}`);
    check('机器人音色也是独立的一档', sound.robot && sound.robot.hash !== sound.male.hash, `${sound.robot?.hash}`);
    check('换词之后样本不同', sound.other && sound.other.hash !== sound.a.hash, `${sound.other?.hash}`);
    check('关掉颤音与气声仍然有声（只是变干净）', sound.quiet && sound.quiet.peak > 0.05 && sound.quiet.hash !== sound.a.hash, JSON.stringify(sound.quiet));

    /* 时长上限：片段被裁短时渲染要跟着截断，不能溢出 */
    const clipped = await cdp.ev(`window.__kly.voice.render(${JSON.stringify(SPEC)}, { ms: 600 })`);
    check('给了 ms 上限就截断到上限', clipped && clipped.ms <= 640, `${clipped?.ms}ms`);

    /* ── 4. 命令层：建层 / 改词 / 重排 ─────────────────── */
    const created = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('project.create', { name: '人声验收', width: 1080, height: 1440 });
      return { ok: r.ok, id: r.data?.projectId, err: r.error?.message };
    })()`);
    check('建一个验收用工程', created.ok && !!created.id, JSON.stringify(created));

    await cdp.conn.call('Page.navigate', { url: `${base}?view=editor&projectId=${created.id}` });
    const mounted = await cdp.waitFor(
      `typeof window.__kly !== 'undefined' && document.querySelectorAll('[data-testid="layer-row"]').length > 0`,
      25000,
    );
    check('进入编辑器（图层树已挂载）', mounted);

    const dur = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('canvas.setDuration', { duration: 20000 });
      return { ok: r.ok, duration: window.__kly.state().project.duration };
    })()`);
    check('把时长设成 20 秒', dur.ok && dur.duration === 20000, JSON.stringify(dur));

    const made = await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.seek', { time: 1500 });
      const r = await window.__kly.dispatch('voice.create', { ...${JSON.stringify(SPEC)}, text: '你好世界' });
      const p = window.__kly.state().project;
      const layer = p.layers.find((l) => l.id === r.data?.id);
      return {
        ok: r.ok, err: r.error?.message, data: r.data,
        type: layer?.type, inPoint: layer?.inPoint, outPoint: layer?.outPoint,
        hasVoice: !!layer?.voice, voiceText: layer?.voice?.text, mode: layer?.voice?.mode,
        voicePreset: layer?.voice?.preset, volume: layer?.volume,
      };
    })()`);
    check('voice.create 建出音频层', made.ok && made.type === 'audio', JSON.stringify({ ok: made.ok, err: made.err }));
    check('起点落在播放头（1500ms）', made.inPoint === 1500, String(made.inPoint));
    check('层长度 = 计划长度', made.data && Math.abs(made.outPoint - made.inPoint - made.data.ms) <= 1, `${made.outPoint - made.inPoint} vs ${made.data?.ms}`);
    check('层上带完整 voice 参数', made.hasVoice && made.voiceText === '你好世界' && made.mode !== undefined, JSON.stringify({ t: made.voiceText, m: made.mode, p: made.voicePreset }));

    const resynced = await cdp.ev(`(async () => {
      const id = window.__kly.state().project.layers.find((l) => l.type === 'audio')?.id;
      const longer = await window.__kly.dispatch('voice.set', { id, voice: { text: '你好世界你好世界' } });
      const after = window.__kly.state().project.layers.find((l) => l.id === id);
      const keep = await window.__kly.dispatch('voice.set', { id, voice: { text: '你好' }, refit: false });
      const kept = window.__kly.state().project.layers.find((l) => l.id === id);
      return {
        longerOk: longer.ok, longerMs: longer.data?.ms, longerOut: after?.outPoint,
        keepOk: keep.ok, keepOut: kept?.outPoint, keepMs: keep.data?.ms,
      };
    })()`);
    check('改长词之后层自动变长', resynced.longerOk && resynced.longerOut > made.outPoint, JSON.stringify(resynced));
    check('refit:false 只改参数不动长度', resynced.keepOk && resynced.keepOut === resynced.longerOut, JSON.stringify({ out: resynced.keepOut, ms: resynced.keepMs }));

    const rejected = await cdp.ev(`(async () => {
      const bg = window.__kly.state().project.layers.find((l) => l.type === 'background');
      const bad = await window.__kly.dispatch('voice.set', { id: bg.id, voice: { text: '你好' } });
      const empty = await window.__kly.dispatch('voice.create', { text: '' });
      const over = await window.__kly.dispatch('voice.create', { text: '你'.repeat(401) });
      return { badOk: bad.ok, badCode: bad.error?.code, emptyOk: empty.ok, emptyCode: empty.error?.code, overOk: over.ok };
    })()`);
    check('对背景层调 voice.set 会被拦住', rejected.badOk === false && rejected.badCode === 'INVARIANT', JSON.stringify({ ok: rejected.badOk, code: rejected.badCode }));
    check('空文本被 schema 拦下', rejected.emptyOk === false && rejected.emptyCode === 'VALIDATION', JSON.stringify({ ok: rejected.emptyOk, code: rejected.emptyCode }));
    check('超过 400 字被拦下', rejected.overOk === false, String(rejected.overOk));

    /* ── 5. 接线：混音 / 波形 / 摘要都认这条层 ─────────── */
    const wired = await cdp.ev(`(async () => {
      const id = window.__kly.state().project.layers.find((l) => l.type === 'audio')?.id;
      const layer = window.__kly.state().project.layers.find((l) => l.id === id);
      await window.__kly.dispatch('layer.update', { id, patch: { inPoint: 0, outPoint: 20000 } });
      const desc = window.__kly.audio.describeAt(800);
      const m = await window.__kly.audio.measure();
      const peaks = await window.__kly.audio.peaks(200);
      let nonzero = 0;
      if (peaks) for (const v of peaks) if (v > 0.01) nonzero++;
      /*
       * 波形按桶铺满整条时间轴（20s / 200 桶 = 每桶 100ms），而人声只有 1.26s 左右，
       * 所以「非零桶」天然只有十来个 —— 断言它跟人声占比同量级，不是要求铺满。
       */
      const share = Math.round((200 * layer.outPoint) / 20000);
      return { desc, m, nonzero, share, preset: layer?.voice?.preset };
    })()`);
    check('排程里有这条人声（preset 报 voice）', wired.desc.length === 1 && String(wired.desc[0].preset).startsWith('voice'), JSON.stringify(wired.desc));
    check('整条工程离线混音有声音', wired.m && wired.m.peak > 0.01, JSON.stringify(wired.m));
    check('波形只在人声占的那几桶里有能量', wired.nonzero >= 5 && wired.nonzero <= wired.share + 4, `${wired.nonzero}/${wired.share}`);

    const summary = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('query.project', {});
      const layers = r.data?.layers ?? [];
      const audio = layers.find((l) => l.audio && l.audio.voice);
      return { ok: r.ok, found: audio ? audio.audio : null };
    })()`);
    check('query.project 里能看到人声摘要', summary.ok && summary.found && summary.found.preset === 'voice', JSON.stringify(summary.found));
    check('摘要里带文本与音节数', summary.found && summary.found.voice.text.length > 0 && summary.found.voice.syllables > 0, JSON.stringify(summary.found?.voice));

    /* ── 6. 界面：人声面板能生成，检查器能跳转 ─────────── */
    const panel = await cdp.ev(`(async () => {
      const before = window.__kly.state().project.layers.filter((l) => l.type === 'audio').length;
      /* 走页签切到「音频」：这是用户真实路径，不是直接改 state */
      const rail = [...document.querySelectorAll('nav button')];
      const audioTab = rail.find((b) => (b.getAttribute('title') || '').includes('音频'));
      if (!audioTab) return { found: false };
      audioTab.click();
      return { found: true, before };
    })()`);
    check('左侧导航有「音频」页签', panel.found === true, JSON.stringify(panel));

    await sleep(400);
    const hasPanel = await cdp.waitFor(`!!document.querySelector('[data-testid="voice-text"]')`, 6000);
    check('音频页里是人声面板（有输入框）', hasPanel === true);

    const afterGenerate = await cdp.ev(`(async () => {
      const ta = document.querySelector('[data-testid="voice-text"]');
      ta.focus();
      ta.value = '我在加我的图层数';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
      const btn = document.querySelector('[data-testid="voice-generate"]');
      const label = btn?.textContent || '';
      btn?.click();
      await new Promise((r) => setTimeout(r, 600));
      const layers = window.__kly.state().project.layers.filter((l) => l.type === 'audio');
      return { label, count: layers.length, texts: layers.map((l) => l.voice?.text).filter(Boolean) };
    })()`);
    check('点「生成到时间轴」多出一条人声层', afterGenerate.count === panel.before + 1, JSON.stringify({ before: panel.before, after: afterGenerate.count }));
    check('新层的词就是输入框里的那句', afterGenerate.texts.includes('我在加我的图层数'), JSON.stringify(afterGenerate.texts));

    const inspector = await cdp.waitFor(`!!document.querySelector('[data-testid="audio-edit-voice"]')`, 6000);
    check('选中人声层后检查器有「去人声面板编辑」', inspector === true);

    /*
     * 英文界面扫一遍：人声面板是本轮新增文案最密的地方，
     * 漏翻的键会原样回退成中文 —— 数一下面板里的汉字就够了。
     */
    const en = await cdp.ev(`(async () => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === '界面语言');
      if (!btn) return { clicked: false };
      btn.click();
      await new Promise((r) => setTimeout(r, 500));
      const panel = document.querySelector('[data-testid="voice-text"]')?.closest('div')?.parentElement;
      /* 第一行是「正在编辑这一层：<层名>」—— 层名是数据（voice.create 自动起的中文名），不算漏翻 */
      const text = (panel ? panel.innerText : '')
        .split('\\n')
        .filter((line) => !line.includes('this layer'))
        .join('\\n');
      const cjk = (text.match(/[\\u4e00-\\u9fa5]/g) || []).length;
      return { clicked: true, cjk, sample: text.replace(/\\n/g, ' | ').slice(0, 160) };
    })()`);
    check('切到英文后人声面板没有漏翻的中文', en.clicked && en.cjk === 0, JSON.stringify(en));

    /* 切回中文：别给后面人工看页面时留下英文 */
    await cdp.ev(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.getAttribute('title') === 'Interface language');
      if (btn) btn.click();
      return 1;
    })()`);
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
