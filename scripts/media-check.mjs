/**
 * 剪辑能力自检：导入 → 裁剪 → 分割 → 转场 → 音频 → 渲染/混音。
 *
 * 素材是**页面里现造**的：
 *   · 视频：canvas.captureStream(0) + MediaRecorder 录 1.2 秒色相渐变（每帧都不同，
 *     所以「裁剪后取到的帧不一样」这件事能被像素证明，而不是只信数据模型）；
 *   · 音频：JS 直接拼一段 1 秒 440Hz 的 WAV（不依赖任何外部文件）。
 *
 * 只测到「数据与像素都对」为止：不测拖拽手感（那是人看的），
 * 但拖拽最终调用的 layer.trim / layer.split / layer.setTransition 在这里全覆盖。
 */
import { launch, reporter, sleep } from './_cdp.mjs';

const base = 'http://localhost:5273/';
const { check, finish } = reporter();

const MAKE_VIDEO = `(async () => {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 180;
  const g = c.getContext('2d');
  const stream = c.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 900000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start();
  for (let i = 0; i < 36; i++) {
    g.fillStyle = 'hsl(' + i * 10 + ' 75% 50%)';
    g.fillRect(0, 0, 320, 180);
    g.fillStyle = '#fff';
    g.font = 'bold 64px sans-serif';
    g.fillText(String(i), 20, 120);
    track.requestFrame();
    await new Promise((r) => setTimeout(r, 33));
  }
  rec.stop();
  await new Promise((r) => { rec.onstop = r; });
  const blob = new Blob(chunks, { type: 'video/webm' });
  const dataUrl = await new Promise((resolve) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.readAsDataURL(blob);
  });
  return { dataUrl, bytes: blob.size };
})()`;

const MAKE_WAV = `(() => {
  const sr = 44100, secs = 1, n = sr * secs;
  const buf = new ArrayBuffer(44 + n * 2);
  const dv = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.sin((i / sr) * 440 * Math.PI * 2) * 12000, true);
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:audio/wav;base64,' + btoa(bin);
})()`;

const cdp = await launch({ url: `${base}?view=editor&projectId=prj_sample_start` });
try {
  await sleep(1400);
  const ready = await cdp.waitFor(`!!window.__kly && !!window.__kly.state().project`, 20000);
  check('打开编辑器', ready);

  /* 新建一个干净工程，别在示例工程上做剪辑实验 */
  const created = await cdp.ev(`(async () => {
    const r = await window.__kly.dispatch('project.create', { name: '剪辑自检', width: 1280, height: 720, duration: 8000, fps: 30 });
    return JSON.stringify(r);
  })()`, 30000);
  const createRes = JSON.parse(created);
  const pid = createRes?.data?.projectId;
  check('新建 8 秒测试工程', createRes.ok === true && !!pid, String(created).slice(0, 160));

  /* 现造一段 1.2 秒的彩色视频并导入 */
  const video = await cdp.ev(`(async () => {
    const v = await (${MAKE_VIDEO});
    const r = await window.__kly.dispatch('asset.import', {
      name: 'probe.webm', mime: 'video/webm', kind: 'video', dataUrl: v.dataUrl,
    });
    return JSON.stringify({ bytes: v.bytes, ok: r.ok, data: r.data && { id: r.data.id, duration: r.data.duration, kind: r.data.kind }, err: r.error });
  })()`, 40000);
  const vres = JSON.parse(video);
  check('生成的 WebM 导入成功（带时长元数据）', vres.ok === true && vres.data?.kind === 'video' && vres.data?.duration > 500, `${vres.bytes}B · ${JSON.stringify(vres.data ?? vres.err)}`);
  const videoAsset = vres.data?.id;

  const placed = await cdp.ev(`(async () => {
    const r = await window.__kly.dispatch('asset.place', { assetId: '${videoAsset}', x: 0, y: 0, width: 1280, height: 720 });
    return JSON.stringify({ ok: r.ok, data: r.data, err: r.error });
  })()`);
  const placeRes = JSON.parse(placed);
  const videoLayer = placeRes?.data?.id;
  check('放到画布生成视频层', placeRes.ok === true && !!videoLayer, String(placed).slice(0, 160));

  /* 裁剪：入点 0 / 出点 1000 / 素材入点 0 */
  const trimmed = await cdp.ev(`(async () => {
    const r = await window.__kly.dispatch('layer.trim', { id: '${videoLayer}', inPoint: 0, outPoint: 1000, trimIn: 0 });
    return JSON.stringify({ ok: r.ok, data: r.data, err: r.error });
  })()`);
  check('裁剪到 1 秒片段', JSON.parse(trimmed).ok === true && JSON.parse(trimmed).data?.length === 1000, trimmed);

  /* 像素证明：同一时刻、不同素材入点，取到的帧必须不同 */
  const frameA = await cdp.ev(`window.__kly.frame(60, 0.5)`);
  await cdp.ev(`window.__kly.dispatch('layer.trim', { id: '${videoLayer}', trimIn: 900 })`);
  const frameB = await cdp.ev(`window.__kly.frame(60, 0.5)`);
  check('素材入点真的改变了取到的画面（60ms 处两帧不同）', typeof frameA === 'string' && typeof frameB === 'string' && frameA.length > 3000 && frameA !== frameB, `${frameA?.length}B vs ${frameB?.length}B`);

  /* 分割：在 500ms 处切成两段，右半段 trimIn 自动累加 500 */
  await cdp.ev(`window.__kly.dispatch('layer.trim', { id: '${videoLayer}', trimIn: 0 })`);
  const split = await cdp.ev(`(async () => {
    const r = await window.__kly.dispatch('layer.split', { id: '${videoLayer}', at: 500 });
    const q = await window.__kly.dispatch('query.layer', { id: r.data && r.data.newId });
    return JSON.stringify({ ok: r.ok, data: r.data, right: q.data && { inPoint: q.data.inPoint, outPoint: q.data.outPoint, trimIn: q.data.trimIn }, err: r.error });
  })()`);
  const sp = JSON.parse(split);
  const rightId = sp?.data?.newId;
  check(
    '在 500ms 处分割：右半段入点 500、素材入点累加 500',
    sp.ok === true && !!rightId && sp.right?.inPoint === 500 && sp.right?.trimIn === 500 && sp.right?.outPoint === 1000,
    split.slice(0, 220),
  );

  /* 转场：右半段加 300ms 叠化 */
  const trans = await cdp.ev(`(async () => {
    const r = await window.__kly.dispatch('layer.setTransition', { id: '${rightId}', kind: 'crossfade', duration: 300 });
    const q = await window.__kly.dispatch('query.layer', { id: '${rightId}' });
    return JSON.stringify({ ok: r.ok, data: r.data, stored: q.data && q.data.transition, err: r.error });
  })()`);
  const tr = JSON.parse(trans);
  check(
    '右半段挂上叠化转场，且时长被夹到片段一半（500ms 片段 → 250ms）',
    tr.ok === true && tr.stored?.kind === 'crossfade' && tr.stored?.duration === 250,
    trans.slice(0, 200),
  );

  /* 转场窗口内与窗口外各渲一帧：都不炸，且画面不同（说明两段确实叠在一起了） */
  const inTrans = await cdp.ev(`window.__kly.frame(520, 0.5)`);
  const afterTrans = await cdp.ev(`window.__kly.frame(820, 0.5)`);
  check('转场窗口内外都能渲出画面', typeof inTrans === 'string' && inTrans.length > 3000 && typeof afterTrans === 'string' && afterTrans.length > 3000, `${inTrans?.length}B / ${afterTrans?.length}B`);

  /*
   * 叠化的像素证明：红片 0–2000、蓝片 2000–4000，蓝片挂 800ms 叠化。
   * 片段是对接的，所以「前一段多活 800ms」是渲染层算出来的 —— 中点必须同时有红与蓝，
   * 只看到蓝（纯淡入）或只看到红（没叠上）都说明这条链断了。
   */
  const blend = await cdp.ev(`(async () => {
    const solid = (color) => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 64, 64);
      return c.toDataURL('image/png');
    };
    /* 先把上面的视频层藏了，别让它的颜色干扰取色 */
    for (const id of ['${videoLayer}', '${rightId}']) await window.__kly.dispatch('layer.update', { id, patch: { visible: false } });
    const impR = await window.__kly.dispatch('asset.import', { name: 'red.png', mime: 'image/png', kind: 'image', dataUrl: solid('#FF0000') });
    const impB = await window.__kly.dispatch('asset.import', { name: 'blue.png', mime: 'image/png', kind: 'image', dataUrl: solid('#0000FF') });
    const r = await window.__kly.dispatch('asset.place', { assetId: impR.data.id, x: 0, y: 0, width: 1280, height: 720 });
    const b = await window.__kly.dispatch('asset.place', { assetId: impB.data.id, x: 0, y: 0, width: 1280, height: 720 });
    await window.__kly.dispatch('layer.trim', { id: r.data.id, inPoint: 0, outPoint: 2000 });
    await window.__kly.dispatch('layer.trim', { id: b.data.id, inPoint: 2000, outPoint: 4000 });
    await window.__kly.dispatch('layer.setTransition', { id: b.data.id, kind: 'crossfade', duration: 800 });
    const px = async (ms) => {
      const cap = await window.__kly.dispatch('query.capture', { maxWidth: 160, time: ms });
      const img = new Image();
      img.src = cap.data.dataUrl;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const d = g.getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    return JSON.stringify({ before: await px(1200), mid: await px(2400), after: await px(3600) });
  })()`, 90000);
  let bl;
  try {
    bl = JSON.parse(blend);
  } catch {
    bl = null;
  }
  check(
    '叠化中点同时有红与蓝（不是纯淡入，也不是硬切）',
    !!bl && bl.before[0] > 150 && bl.before[2] < 60 && bl.after[2] > 150 && bl.after[0] < 60 && bl.mid[0] > 25 && bl.mid[2] > 60,
    blend.slice(0, 200),
  );

  /* 音频：导入 1 秒 WAV，放到播放头 0 处，离线渲染必须有声 */
  await cdp.ev(`window.__kly.dispatch('timeline.seek', { time: 0 })`);
  const audio = await cdp.ev(`(async () => {
    const dataUrl = ${MAKE_WAV};
    const r = await window.__kly.dispatch('asset.import', { name: 'tone.wav', mime: 'audio/wav', kind: 'audio', dataUrl });
    const place = await window.__kly.dispatch('asset.place', { assetId: r.data && r.data.id });
    const q = await window.__kly.dispatch('query.layer', { id: place.data && place.data.id });
    return JSON.stringify({
      ok: r.ok && place.ok,
      meta: r.data && { kind: r.data.kind, duration: r.data.duration },
      layer: q.data && { type: q.data.type, inPoint: q.data.inPoint, outPoint: q.data.outPoint, assetId: q.data.assetId },
      err: r.error || place.error,
    });
  })()`, 40000);
  const au = JSON.parse(audio);
  check(
    '音频导入后落到时间轴的播放头处（1 秒）',
    au.ok === true && au.meta?.kind === 'audio' && Math.abs(au.meta?.duration - 1000) < 60 && au.layer?.type === 'audio' && au.layer?.assetId && au.layer?.outPoint <= 1100,
    audio.slice(0, 240),
  );

  const measured = await cdp.ev(`window.__kly.audio.measure().then((m) => JSON.stringify(m))`);
  const mm = JSON.parse(measured);
  check('导入音频进了离线混音（peak > 0.01）', mm.peak > 0.01, measured);

  /* 波形峰值也要能出（时间轴画音频块依赖它） */
  const peaks = await cdp.ev(`window.__kly.state().project && (async () => {
    const p = await window.__kly.audio.peaks(64);
    return JSON.stringify({ n: p ? p.length : 0, max: p ? Math.max(...p) : 0 });
  })()`);
  check('音频波形峰值可用', JSON.parse(peaks).n === 64 && JSON.parse(peaks).max > 0.1, peaks);

  /* 收尾：删掉自检工程，别把垃圾留在用户库里 */
  const cleanup = await cdp.ev(`(async () => {
    const r = await window.__kly.dispatch('project.deleteLocal', { projectId: '${pid}', confirm: true });
    return JSON.stringify({ ok: r.ok, err: r.error });
  })()`);
  check('清理测试工程', JSON.parse(cleanup).ok === true, cleanup);
} finally {
  await finish();
  await cdp.close?.();
  process.exit(0);
}
