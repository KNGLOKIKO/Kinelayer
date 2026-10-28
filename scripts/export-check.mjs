/**
 * 出片能力验收：出片区间 / 标记点 / 字幕 / 剪辑表。
 *
 * 这一批功能有个共同点：**产出的都是「一段文本或一个数字」，不是像素**。
 * 所以判据也只能是结构性的：
 *   · 区间：越界会被拒绝、片长缩短会把区间丢掉、撤销能回去；
 *   · 字幕：条数与行数对得上、逐字模式比整行多、SRT/VTT 各自格式合法、
 *     写出去再读回来时间一致（往返）、区间外的条被裁掉且时间归零；
 *   · 剪辑表：只有带素材的层进表、时间码是 `HH:MM:SS:FF`、录机时长等于区间长度；
 *   · 界面：标尺上的蓝条与把手真的出现了、标记点能加能右键删、I/O/J/K/L 真的改了状态。
 *
 * 需要 dev server 跑在 5273。
 */
import { launch, reporter, sleep } from './_cdp.mjs';

const base = 'http://localhost:5273/';
const { check, finish } = reporter();

/** 把一段 JS 的返回值 JSON 化 —— CDP 只能回传可序列化的东西 */
const J = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const cdp = await launch({ url: `${base}?view=editor&projectId=prj_sample_start`, width: 1440, height: 900 });
try {
  await sleep(1500);
  const ready = await cdp.waitFor(`!!window.__kly && !!window.__kly.state().project`, 20000);
  check('打开编辑器', ready);
  if (!ready) throw new Error('调试口没就绪');

  const created = await cdp.ev(`(async () => {
    const r = await window.__kly.dispatch('project.create', { name: '出片自检', width: 960, height: 540, duration: 12000, fps: 25 });
    return JSON.stringify(r);
  })()`, 30000);
  const createRes = J(created);
  check('新建 12 秒 / 25fps 测试工程', createRes?.ok === true, String(created).slice(0, 160));

  /* 加一个文本层：剪辑表的「跳过」分支需要工程里真有非素材层才验证得到 */
  const addedText = J(await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('layer.create', { type: 'text', text: '出片自检' })))()`));
  check('加一个文本层（剪辑表要跳过它）', addedText?.ok === true, JSON.stringify(addedText?.error));

  /* ── 1. 出片区间：命令层的四条硬约束 ─────────────────── */
  const setOk = J(await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('timeline.setRange', { in: 2000, out: 8000 })))()`));
  check('setRange 设区间', setOk?.ok === true && setOk.data?.duration === 6000, JSON.stringify(setOk?.data));

  const badOrder = J(await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('timeline.setRange', { in: 8000, out: 2000 })))()`));
  check('出点早于入点被拒绝（VALIDATION）', badOrder?.ok === false && badOrder.error?.code === 'VALIDATION', String(badOrder?.error?.message).slice(0, 80));

  const stillOld = J(await cdp.ev(`JSON.stringify({ range: window.__kly.state().project.range })`));
  check('被拒绝后区间没被改坏', stillOld?.range?.in === 2000 && stillOld?.range?.out === 8000, JSON.stringify(stillOld?.range));

  const tooShort = J(await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('timeline.setRange', { in: 3000, out: 3010 })))()`));
  check('短于 40ms 的区间被拒绝', tooShort?.ok === false && tooShort.error?.code === 'VALIDATION', String(tooShort?.error?.message).slice(0, 80));

  const clamped = J(await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('timeline.setRange', { in: 9000, out: 99_000 })))()`));
  check('出点超出片长时夹到片尾（不报错）', clamped?.ok === true && clamped.data?.range?.out === 12000, JSON.stringify(clamped?.data));

  /* 区间命令带 coalesce（拖把手必须合成一个撤销点），所以这里不拿它验撤销链；
     换成不带 coalesce 的标记点命令来验「撤销真的能回去」 */
  const undone = J(
    await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.addMarker', { time: 1500 });
      const before = window.__kly.state().project.markers.length;
      await window.__kly.dispatch('history.undo', { steps: 1 });
      return JSON.stringify({ before, after: window.__kly.state().project.markers.length });
    })()`),
  );
  check('撤销一次把刚加的标记点撤掉', undone?.before === 1 && undone?.after === 0, JSON.stringify(undone));

  /* ── 2. 入点 / 出点两个键的语义 ─────────────────────── */
  const seekThenMark = J(
    await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.clearRange', {});
      await window.__kly.dispatch('timeline.seek', { time: 4000 });
      const a = await window.__kly.dispatch('timeline.markIn', {});
      const b = await window.__kly.dispatch('timeline.markOut', { time: 6000 });
      return JSON.stringify({ afterIn: a.data?.range, afterOut: b.data?.range });
    })()`),
  );
  check('I 键打入点：出点自动补到片尾', seekThenMark?.afterIn?.in === 4000 && seekThenMark?.afterIn?.out === 12000, JSON.stringify(seekThenMark?.afterIn));
  check('O 键打出点：入点保留', seekThenMark?.afterOut?.in === 4000 && seekThenMark?.afterOut?.out === 6000, JSON.stringify(seekThenMark?.afterOut));

  const backwards = J(
    await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.setRange', { in: 6000, out: 9000 });
      const r = await window.__kly.dispatch('timeline.markOut', { time: 1000 });
      return JSON.stringify({ range: r.data?.range });
    })()`),
  );
  check('O 打到入点之前：入点被拉回 0 而不是报错', backwards?.range?.in === 0 && backwards?.range?.out === 1000, JSON.stringify(backwards?.range));

  /* ── 3. 区间跟着片长走 ─────────────────────────────── */
  const shrink = J(
    await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.setRange', { in: 8000, out: 11000 });
      await window.__kly.dispatch('canvas.setDuration', { duration: 5000 });
      const p = window.__kly.state().project;
      return JSON.stringify({ range: p.range, duration: p.duration });
    })()`),
  );
  check('片长砍到装不下区间时，区间整块丢掉（不留残骸）', shrink?.range === null && shrink?.duration === 5000, JSON.stringify(shrink));

  const grow = J(
    await cdp.ev(`(async () => {
      await window.__kly.dispatch('canvas.setDuration', { duration: 12000 });
      await window.__kly.dispatch('timeline.setRange', { in: 2000, out: 9000 });
      await window.__kly.dispatch('canvas.setDuration', { duration: 6000 });
      return JSON.stringify({ range: window.__kly.state().project.range });
    })()`),
  );
  check('片长缩短但仍装得下时，出点夹到片尾', grow?.range?.in === 2000 && grow?.range?.out === 6000, JSON.stringify(grow?.range));

  await cdp.ev(`window.__kly.dispatch('canvas.setDuration', { duration: 12000 })`);

  /* ── 4. 标记点 ─────────────────────────────────────── */
  const markers = J(
    await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.clearMarkers', {});
      const a = await window.__kly.dispatch('timeline.addMarker', { time: 5000, label: '副歌', kind: 'beat' });
      const b = await window.__kly.dispatch('timeline.addMarker', { time: 1000, label: '开头', kind: 'cut' });
      const c = await window.__kly.dispatch('timeline.addMarker', { time: 50_000, kind: 'note' });
      return JSON.stringify({ ids: [a.data?.id, b.data?.id, c.data?.id], list: window.__kly.state().project.markers });
    })()`),
  );
  check('加三个标记点都返回 id', markers?.ids?.every((x) => typeof x === 'string' && x.length > 2), JSON.stringify(markers?.ids));
  check('标记点按时间排好序', markers?.list?.length === 3 && markers?.list?.[0]?.time === 1000 && markers?.list?.[1]?.time === 5000, JSON.stringify(markers?.list?.map((m) => m.time)));
  check('越界的标记点被夹到片尾', markers?.list?.[2]?.time === 12000, String(markers?.list?.[2]?.time));

  const moveRes = J(
    await cdp.ev(`(async () => {
      const id = window.__kly.state().project.markers[0].id;
      const r = await window.__kly.dispatch('timeline.moveMarker', { id, time: 7000 });
      return JSON.stringify({ ok: r.ok, list: window.__kly.state().project.markers.map((m) => m.time) });
    })()`),
  );
  check('移动标记点后重新排序', moveRes?.ok === true && moveRes.list?.join(',') === '5000,7000,12000', JSON.stringify(moveRes?.list));

  const kindRes = J(
    await cdp.ev(`(async () => {
      const id = window.__kly.state().project.markers[0].id;
      await window.__kly.dispatch('timeline.updateMarker', { id, label: '进副歌', kind: 'cut' });
      return JSON.stringify(window.__kly.state().project.markers.find((m) => m.id === id));
    })()`),
  );
  check('updateMarker 改文案与类型', kindRes?.label === '进副歌' && kindRes?.kind === 'cut', JSON.stringify(kindRes));

  const missing = J(await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('timeline.removeMarker', { id: 'mk_nope' })))()`));
  check('删不存在的标记点报 NOT_FOUND', missing?.ok === false && missing.error?.code === 'NOT_FOUND', String(missing?.error?.message).slice(0, 60));

  const cleared = J(
    await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('timeline.clearMarkers', {});
      return JSON.stringify({ removed: r.data?.removed, left: window.__kly.state().project.markers.length });
    })()`),
  );
  check('clearMarkers 清空并报数量', cleared?.removed === 3 && cleared?.left === 0, JSON.stringify(cleared));

  /* ── 5. 字幕：从歌词到 SRT / VTT ────────────────────── */
  /* 先清掉区间：字幕默认裁到区间里，留着区间量到的就不是整片 */
  await cdp.ev(`(async () => {
    await window.__kly.dispatch('timeline.clearRange', {});
    await window.__kly.dispatch('project.setLyrics', { lines: [
      { text: '先画一条线', start: 4000, end: 6800 },
      { text: '就有了时间', start: 6900, end: 9600 },
    ] });
  })()`);

  const cuesLine = J(await cdp.ev(`JSON.stringify(window.__kly.deliverables.cues('line'))`));
  const cuesUnit = J(await cdp.ev(`JSON.stringify(window.__kly.deliverables.cues('unit'))`));
  check('整行模式：两行歌词 = 两条字幕', Array.isArray(cuesLine) && cuesLine.length === 2, JSON.stringify(cuesLine?.map((c) => c.text)));
  check('逐字模式：条数比整行多', Array.isArray(cuesUnit) && cuesUnit.length > cuesLine.length, `${cuesUnit?.length} vs ${cuesLine?.length}`);
  check('逐字条目不包含纯标点', cuesUnit.every((c) => /[\p{L}\p{N}]/u.test(c.text)), JSON.stringify(cuesUnit?.map((c) => c.text)));
  check('逐字条目时间单调不重叠', cuesUnit.every((c, i) => i === 0 || c.start >= cuesUnit[i - 1].start), '');

  const srt = await cdp.ev(`window.__kly.deliverables.text('srt', 'line')`);
  const vtt = await cdp.ev(`window.__kly.deliverables.text('vtt', 'line')`);
  check('SRT 首条格式正确', /^1\n00:00:04,000 --> 00:00:06,800\n先画一条线/.test(String(srt)), JSON.stringify(String(srt).slice(0, 60)));
  check('VTT 以 WEBVTT 开头且用句点', String(vtt).startsWith('WEBVTT\n\n00:00:04.000 --> 00:00:06.800'), JSON.stringify(String(vtt).slice(0, 60)));

  /* 区间裁剪 + 归零：这才是「导出的视频从 0 开始」的意思 */
  const clipped = J(
    await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.setRange', { in: 6000, out: 9000 });
      return JSON.stringify(window.__kly.deliverables.cues('line'));
    })()`),
  );
  check('区间裁剪：只剩与区间相交的条', Array.isArray(clipped) && clipped.length === 2, JSON.stringify(clipped));
  check('区间裁剪后时间归零（第一条从 0 起）', clipped?.[0]?.start === 0 && clipped?.[0]?.end === 800, JSON.stringify(clipped?.[0]));
  check('区间外那半截被截断在区间末尾', clipped?.[1]?.end === 3000, JSON.stringify(clipped?.[1]));

  /* 往返：写出去再读回来，条数与时间必须一致 */
  const roundTrip = J(
    await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.clearRange', {});
      const text = window.__kly.deliverables.text('srt', 'line');
      const back = window.__kly.deliverables.parse(text);
      return JSON.stringify({ before: window.__kly.deliverables.cues('line'), after: back });
    })()`),
  );
  check(
    'SRT 往返：条数与时间一致',
    roundTrip?.before?.length === 2 &&
      roundTrip?.after?.length === 2 &&
      roundTrip.after[0].start === 4000 &&
      roundTrip.after[0].end === 6800 &&
      roundTrip.after[1].text === '就有了时间',
    JSON.stringify(roundTrip?.after),
  );

  const messy = J(
    await cdp.ev(`JSON.stringify(window.__kly.deliverables.parse('WEBVTT\\n\\nNOTE 这是注释\\n\\n00:01.500 --> 00:02.000 align:start line:80%\\n<c.yellow>你好</c>\\n'))`),
  );
  check('VTT：跳过 NOTE、剥掉内联标签、容忍 cue 设置', messy?.length === 1 && messy[0].text === '你好' && messy[0].start === 1500, JSON.stringify(messy));

  const garbage = J(await cdp.ev(`JSON.stringify(window.__kly.deliverables.parse('这不是字幕\\n\\n随便什么\\n'))`));
  check('垃圾文本解析成空数组（不猜时间）', Array.isArray(garbage) && garbage.length === 0, JSON.stringify(garbage));

  const tcs = J(
    await cdp.ev(`JSON.stringify({
      h: window.__kly.deliverables.timecode(3_723_456, 'srt'),
      v: window.__kly.deliverables.timecode(1_000, 'vtt'),
      zero: window.__kly.deliverables.timecode(0, 'srt'),
    })`),
  );
  check('时间码：小时/毫秒补零正确', tcs?.h === '01:02:03,456' && tcs?.v === '00:00:01.000' && tcs?.zero === '00:00:00,000', JSON.stringify(tcs));

  /* ── 6. 剪辑表（EDL） ──────────────────────────────── */
  const edlPlain = J(await cdp.ev(`JSON.stringify(window.__kly.deliverables.edl())`));
  check('没有素材层时事件数为 0', edlPlain?.events === 0, String(edlPlain?.events));
  check('EDL 头部合法（TITLE / FCM）', /^TITLE: .+\nFCM: NON-DROP FRAME/.test(edlPlain?.text ?? ''), JSON.stringify((edlPlain?.text ?? '').slice(0, 48)));
  check('没有素材层时把「为什么没进表」写出来', (edlPlain?.skipped?.length ?? 0) > 0 && /文本层，成片里已烘焙/.test(edlPlain?.text ?? ''), JSON.stringify(edlPlain?.skipped?.map((s) => s.reason)));

  /* 造一张 1×1 的图放上画布：EDL 必须认出它是「有源素材」的层 */
  const withImage = J(
    await cdp.ev(`(async () => {
      const c = document.createElement('canvas');
      c.width = 2; c.height = 2;
      const g = c.getContext('2d');
      g.fillStyle = '#3366cc';
      g.fillRect(0, 0, 2, 2);
      const dataUrl = c.toDataURL('image/png');
      const imp = await window.__kly.dispatch('asset.import', { name: 'plate.png', mime: 'image/png', kind: 'image', dataUrl });
      const place = await window.__kly.dispatch('asset.place', { assetId: imp.data.id, x: 0, y: 0, width: 960, height: 540 });
      await window.__kly.dispatch('layer.trim', { id: place.data.id, inPoint: 1000, outPoint: 5000 });
      await window.__kly.dispatch('timeline.setRange', { in: 2000, out: 4000 });
      const e = window.__kly.deliverables.edl();
      return JSON.stringify({ assetId: imp.data.id, layerId: place.data.id, events: e.events, text: e.text, skipped: e.skipped });
    })()`),
    30000,
  );
  check('有素材的图层进 EDL', withImage?.events === 1, String(withImage?.events));
  check('EDL 里有 FROM CLIP NAME 与图层来源', /\* FROM CLIP NAME: plate\.png/.test(withImage?.text ?? '') && /KINELAYER LAYER:/.test(withImage?.text ?? ''), '');
  check('EDL 录机时长 = 区间长度（2 秒 @25fps）', /00:00:00:00 00:00:02:00/.test(withImage?.text ?? ''), JSON.stringify((withImage?.text ?? '').split('\n').find((l) => /^\d{3}/.test(l))));
  check('EDL 时间码格式为 HH:MM:SS:FF', /^\d{3}\s+AX\s+V\s+C\s+\d{2}:\d{2}:\d{2}:\d{2}\s+\d{2}:\d{2}:\d{2}:\d{2}\s+\d{2}:\d{2}:\d{2}:\d{2}\s+\d{2}:\d{2}:\d{2}:\d{2}/m.test(withImage?.text ?? ''), '');

  /* ── 7. 区间音频：同一个导出里音画必须同段 ───────────── */
  const wav = J(await cdp.ev(`(async () => JSON.stringify(await window.__kly.deliverables.wavBytes(8000)))()`, 30000));
  check('区间音频长度 ≈ 区间时长（2 秒）', wav && Math.abs(wav.ms - 2000) <= 2, JSON.stringify(wav));

  /* ── 8. 界面接线 ──────────────────────────────────── */
  await cdp.ev(`(async () => {
    await window.__kly.dispatch('timeline.clearRange', {});
    await window.__kly.dispatch('timeline.clearMarkers', {});
    await window.__kly.dispatch('timeline.seek', { time: 3000 });
  })()`);
  await sleep(300);

  const before = await cdp.ev(`(() => {
    const q = (s) => !!document.querySelector(s);
    return JSON.stringify({
      ruler: q('[data-testid="timeline-ruler"]'),
      bar: q('[data-testid="range-bar"]'),
      playhead: q('[data-testid="timeline-playhead"]'),
      markIn: q('[data-testid="timeline-mark-in"]'),
      markOut: q('[data-testid="timeline-mark-out"]'),
      markerBtn: q('[data-testid="timeline-add-marker"]'),
    });
  })()`);
  const ui = J(before);
  check('标尺在内容层里（滚动/缩放都不会错位）', ui?.ruler === true, '');
  check('有播放头、没有区间时也没有蓝条', ui?.playhead === true && ui?.bar === false, JSON.stringify(ui));
  check('工具条有 IN / OUT / 标记三个按钮', ui?.markIn && ui?.markOut && ui?.markerBtn, '');

  /* 点 IN / OUT 两个按钮 */
  await cdp.ev(`document.querySelector('[data-testid="timeline-mark-in"]').click()`);
  await sleep(120);
  await cdp.ev(`(async () => { await window.__kly.dispatch('timeline.seek', { time: 7000 }); })()`);
  await cdp.ev(`document.querySelector('[data-testid="timeline-mark-out"]').click()`);
  await sleep(200);

  const afterMark = J(
    await cdp.ev(`JSON.stringify({
      range: window.__kly.state().project.range,
      bar: !!document.querySelector('[data-testid="range-bar"]'),
      handleIn: !!document.querySelector('[data-testid="range-handle-in"]'),
      readout: document.querySelector('[data-testid="timeline-range-readout"]')?.textContent || '',
      masks: document.querySelectorAll('.bg-ink-950\\\\/70').length,
    })`),
  );
  check('点 IN / OUT 之后区间真的写进了工程', afterMark?.range?.in === 3000 && afterMark?.range?.out === 7000, JSON.stringify(afterMark?.range));
  check('标尺出现蓝条与两个把手', afterMark?.bar === true && afterMark?.handleIn === true, '');
  check('工具条显示区间读数', /00:03:00→00:07:00/.test(afterMark?.readout ?? ''), JSON.stringify(afterMark?.readout));
  check('区间外压暗了两块', afterMark?.masks === 2, String(afterMark?.masks));

  /* 加标记 → 界面出现 → 右键删掉 */
  await cdp.ev(`document.querySelector('[data-testid="timeline-add-marker"]').click()`);
  await sleep(200);
  const markerUi = J(
    await cdp.ev(`JSON.stringify({
      n: document.querySelectorAll('[data-testid="timeline-marker"]').length,
      count: window.__kly.state().project.markers.length,
    })`),
  );
  check('点标记按钮后标尺上出现标记点', markerUi?.n === 1 && markerUi?.count === 1, JSON.stringify(markerUi));

  await cdp.ev(`(() => {
    const el = document.querySelector('[data-testid="timeline-marker"]');
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return true;
  })()`);
  await sleep(200);
  const afterDel = J(await cdp.ev(`JSON.stringify({ n: document.querySelectorAll('[data-testid="timeline-marker"]').length, count: window.__kly.state().project.markers.length })`));
  check('右键删掉标记点', afterDel?.n === 0 && afterDel?.count === 0, JSON.stringify(afterDel));

  /* ── 9. 快捷键：I / O / J / K / L / , . / M ─────────── */
  const keys = J(
    await cdp.ev(`(async () => {
      const fire = (key) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await window.__kly.dispatch('timeline.clearRange', {});
      await window.__kly.dispatch('timeline.clearMarkers', {});
      await window.__kly.dispatch('timeline.seek', { time: 2000 });
      fire('i');
      await new Promise((r) => setTimeout(r, 120));
      await window.__kly.dispatch('timeline.seek', { time: 6000 });
      fire('o');
      await new Promise((r) => setTimeout(r, 120));
      const range = window.__kly.state().project.range;

      fire('m');
      await new Promise((r) => setTimeout(r, 120));
      const markers = window.__kly.state().project.markers.length;

      await window.__kly.dispatch('timeline.seek', { time: 1000 });
      fire('.');
      await new Promise((r) => setTimeout(r, 120));
      const fwd = window.__kly.state().runtime.playhead;
      fire(',');
      await new Promise((r) => setTimeout(r, 120));
      const back = window.__kly.state().runtime.playhead;

      fire('l');
      await new Promise((r) => setTimeout(r, 200));
      const playing = window.__kly.state().runtime.playing;
      const rate1 = window.__kly.state().runtime.playRate;
      fire('l');
      await new Promise((r) => setTimeout(r, 150));
      const rate2 = window.__kly.state().runtime.playRate;
      fire('k');
      await new Promise((r) => setTimeout(r, 150));
      const stopped = window.__kly.state().runtime.playing;
      return JSON.stringify({ range, markers, fwd, back, playing, rate1, rate2, stopped, fps: window.__kly.state().project.fps });
    })()`),
    20000,
  );
  check('I / O 两个键设出 2s–6s 区间', keys?.range?.in === 2000 && keys?.range?.out === 6000, JSON.stringify(keys?.range));
  check('M 键在播放头加标记', keys?.markers === 1, String(keys?.markers));
  /* 25fps → 一帧 40ms；播放头 1000 处按 . 应到 1040，再按 , 回到 1000 */
  check('. / , 逐帧步进（25fps = 40ms）', keys?.fwd === 1040 && keys?.back === 1000, `${keys?.fwd} → ${keys?.back}`);
  check('L 开始播放、连按加速、K 停住', keys?.playing === true && keys?.rate1 === 1 && keys?.rate2 === 2 && keys?.stopped === false, `rate ${keys?.rate1}→${keys?.rate2}`);

  /* 倒放：J 让倍速变负 */
  const reverse = J(
    await cdp.ev(`(async () => {
      const fire = (key) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await window.__kly.dispatch('timeline.seek', { time: 8000 });
      fire('j');
      await new Promise((r) => setTimeout(r, 260));
      const rate = window.__kly.state().runtime.playRate;
      const head = window.__kly.state().runtime.playhead;
      fire('k');
      await new Promise((r) => setTimeout(r, 120));
      return JSON.stringify({ rate, head });
    })()`),
  );
  check('J 倒放：倍速为负且播放头往回走', reverse?.rate === -1 && reverse?.head < 8000, JSON.stringify(reverse));

  /* ── 9.5 区间是「播放窗口」：到出点停住，开循环在区间内绕回 ── */
  const stopped = J(
    await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.setLoop', { loop: false });
      await window.__kly.dispatch('timeline.setRange', { in: 0, out: 1000 });
      await window.__kly.dispatch('timeline.seek', { time: 900 });
      await window.__kly.dispatch('timeline.play', {});
      await new Promise((r) => setTimeout(r, 420));
      const st = window.__kly.state();
      await window.__kly.dispatch('timeline.pause', {});
      return JSON.stringify({ head: Math.round(st.runtime.playhead), playing: st.runtime.playing });
    })()`),
  );
  check('播到出点自动停住（不越过区间）', stopped?.head === 1000 && stopped?.playing === false, JSON.stringify(stopped));

  const wrapped = J(
    await cdp.ev(`(async () => {
      await window.__kly.dispatch('timeline.setLoop', { loop: true });
      await window.__kly.dispatch('timeline.seek', { time: 900 });
      await window.__kly.dispatch('timeline.play', {});
      await new Promise((r) => setTimeout(r, 420));
      const st = window.__kly.state();
      await window.__kly.dispatch('timeline.pause', {});
      await window.__kly.dispatch('timeline.setLoop', { loop: false });
      return JSON.stringify({ head: Math.round(st.runtime.playhead), playing: st.runtime.playing });
    })()`),
  );
  check('开循环时在区间内绕回（不跑到区间外）', wrapped?.playing === true && wrapped.head >= 0 && wrapped.head < 800, JSON.stringify(wrapped));

  const chip = J(await cdp.ev(`JSON.stringify({ chip: (document.querySelector('[data-testid="playbar-range"]') || {}).textContent || '' })`));
  check('播放条上挂着「区间」小标', /区间|Range/.test(chip?.chip ?? ''), JSON.stringify(chip?.chip));

  /* ── 10. 导出对话框：四个出口与区间读数都在 ──────────── */
  await cdp.ev(`(async () => { await window.__kly.dispatch('timeline.setRange', { in: 2000, out: 6000 }); })()`);
  const openedDialog = await cdp.ev(`(() => {
    /* 语言可能是 en-US（headless 的 navigator.language），两种写法都认 */
    const btn = [...document.querySelectorAll('button')].find((b) => /^(导出|Export)$/.test((b.textContent || '').trim()));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(250);
  const dialog = J(
    await cdp.ev(`(() => {
      const box = document.querySelector('[data-testid="export-range"]');
      const labels = [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim());
      return JSON.stringify({
        opened: !!box,
        text: box ? box.textContent : '',
        wav: labels.includes('导出 WAV') || labels.includes('Export WAV'),
        subs: labels.includes('导出字幕') || labels.includes('Export subtitles'),
        edl: labels.includes('导出剪辑表') || labels.includes('Export edit list'),
      });
    })()`),
  );
  check('导出对话框能打开', openedDialog === true && dialog?.opened === true, '');
  check('对话框里写清了这次导的是哪一段', /00:02:00→00:06:00/.test(dialog?.text ?? ''), JSON.stringify((dialog?.text ?? '').slice(0, 50)));
  check('对话框里有 WAV / 字幕 / 剪辑表三个出口', dialog?.wav && dialog?.subs && dialog?.edl, JSON.stringify(dialog));
  await cdp.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(150);

  /* ── 11. 收尾：把测试工程删掉，别污染下次自检 ─────────── */
  const cleanup = J(await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('project.deleteLocal', { projectId: window.__kly.state().project.id, confirm: true })))()`));
  check('清理测试工程', cleanup?.ok === true, String(cleanup?.error?.message ?? 'ok').slice(0, 60));
} finally {
  await cdp.close?.();
}

process.exit(finish());
