/* main.ts 的移植：预览播放器（默认）与导出模式（?export=1）。 */
(function () {
  const params = new URLSearchParams(location.search);
  const EXPORT = params.has('export');
  const ONLY = params.get('only');
  const FROM = params.get('t') ? parseFloat(params.get('t')) : null;

  const canvas = document.getElementById('c');
  const engine = new window.PD_Engine(canvas, window.PD_makeTimeline);
  const { PW, PH } = window.PD_FRAME;

  const SCALE = Math.max(1, Math.min(3, params.get('scale') ? parseFloat(params.get('scale')) : 1));
  canvas.width = PW * SCALE;
  canvas.height = PH * SCALE;
  engine.scale = SCALE;

  let TIMELINE = [];
  let AUDIO = null;

  async function boot() {
    const onlySet = ONLY ? new Set(ONLY.split(',')) : null;
    await engine.init(onlySet ? (e) => onlySet.has(e.id) : undefined);
    TIMELINE = engine.timeline;
    if (engine.errors.length) {
      const errs = document.getElementById('errs');
      errs.textContent = engine.errors.join('\n\n');
      errs.style.display = 'block';
    }
    AUDIO = await window.PD_makeAudio(engine.duration);
    if (EXPORT) setupExport();
    else setupPlayer();
  }

  /* ------------------------------------------------------- export API
   * 原项目的 stream() 走 WebSocket rgb24 + worker 发送 + 编码器确认背压；
   * 这里简化成「逐帧取 base64 PNG」（同一个 __pdoom 钩子名，语义对齐，
   * 传输量的差异记在 README —— 那条管线在本复刻里不是瓶颈）。
   */
  function setupExport() {
    document.body.classList.add('export');
    window.__pdoom = {
      engine,
      duration: engine.duration,
      errors: engine.errors,
      scale: SCALE,
      width: canvas.width,
      height: canvas.height,
      timeline: TIMELINE.map(({ id, start, end }) => ({ id, start, end })),
      still(t, samples = 1, shutter = 0.5) {
        engine.render(t, 1 / 60, true, samples, shutter);
        return canvas.toDataURL('image/png');
      },
      async frames({ from, to, fps = 30, samples = 1, shutter = 0.5, onFrame } = {}) {
        const out = [];
        const dt = 1 / fps;
        const n0 = Math.round(from * fps), n1 = Math.round(to * fps);
        for (let n = n0; n < n1; n++) {
          out.push(engine.render(n * dt, dt, true, samples, shutter), canvas.toDataURL('image/png'));
          if (onFrame) onFrame(n - n0 + 1, n1 - n0);
          if ((n - n0) % 12 === 11) await new Promise((r) => setTimeout(r, 0));
        }
        return out;
      },
    };
    window.__pdoom.ready = true;
  }

  /* ------------------------------------------------------- 播放器 */
  function setupPlayer() {
    const ui = document.getElementById('ui');
    const scrub = document.getElementById('scrub');
    const info = document.getElementById('info');
    const marks = document.getElementById('marks');
    const hint = document.getElementById('hint');
    scrub.max = String(engine.duration);
    scrub.step = '0.001';

    for (const e of TIMELINE) {
      const m = document.createElement('div');
      m.className = 'mark';
      m.style.left = `${(e.start / engine.duration) * 100}%`;
      m.style.width = `${((e.end - e.start) / engine.duration) * 100}%`;
      m.title = `${e.id} ${e.start.toFixed(2)}–${e.end.toFixed(2)}`;
      m.textContent = e.id;
      m.onclick = () => seek(e.start);
      marks.appendChild(m);
    }

    let t = FROM ?? 0;
    let playing = false;
    let loop = null;
    let lastAudioT = 0, lastPerf = 0;
    const seek = (x) => {
      t = Math.max(0, Math.min(engine.duration - 0.001, x));
      if (AUDIO) AUDIO.currentTime = t;
    };
    seek(t);

    const toggle = () => {
      playing = !playing;
      if (playing) { AUDIO.currentTime = t; AUDIO.play(); hint.classList.add('gone'); }
      else AUDIO.pause();
    };
    canvas.onclick = toggle;
    scrub.oninput = () => seek(parseFloat(scrub.value));

    const dismissHint = () => hint.classList.add('gone');
    setTimeout(dismissHint, 9000);
    window.addEventListener('keydown', (ev) => {
      if (ev.key === ' ') { ev.preventDefault(); toggle(); }
      else if (ev.key === 'ArrowRight') seek(t + (ev.shiftKey ? 5 : 1));
      else if (ev.key === 'ArrowLeft') seek(t - (ev.shiftKey ? 5 : 1));
      else if (ev.key === '.') seek(t + 1 / 60);
      else if (ev.key === ',') seek(t - 1 / 60);
      else if (ev.key === 'l') {
        const e = TIMELINE.find((x) => t >= x.start && t < x.end);
        loop = loop ? null : e ? [e.start, e.end] : null;
      } else if (ev.key === 'h') { ui.classList.toggle('hidden'); dismissHint(); }
      else if (ev.key === ']') { const e = TIMELINE.find((x) => x.start > t + 0.01); if (e) seek(e.start); }
      else if (ev.key === '[') {
        const es = TIMELINE.filter((x) => x.start < t - 0.3);
        const e = es[es.length - 1];
        if (e) seek(e.start);
      } else return;
      dismissHint();
    });

    let frames = 0, fpsT = performance.now(), fps = 0;
    const tick = () => {
      if (playing) {
        /* 粗的音频时钟用 performance.now 平滑 —— main.ts 原句语义 */
        const now = performance.now();
        const at = AUDIO.currentTime;
        if (at !== lastAudioT) { lastAudioT = at; lastPerf = now; }
        t = lastAudioT + (AUDIO.paused ? 0 : now - lastPerf) / 1000;
        t = Math.min(engine.duration - 0.001, Math.max(t, 0));
        if (loop && t >= loop[1]) seek(loop[0]);
        if (AUDIO.ended) playing = false;
      }
      engine.render(t, 1 / 60);
      scrub.value = String(t);
      frames++;
      const now = performance.now();
      if (now - fpsT > 500) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
      const e = TIMELINE.find((x) => t >= x.start && t < x.end);
      const l = engine.lyrics.lineAt(t);
      info.textContent =
        `${t.toFixed(2)}s  beat ${engine.audio.beatAt(t).toFixed(2)}  bar ${engine.audio.barAt(t).toFixed(2)}` +
        `  [${e?.id ?? '—'}]  ${fps.toFixed(0)}fps   ${l ? '“' + l.text + '”' : ''}${loop ? '  LOOP' : ''}`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  boot().catch((e) => {
    console.error(e);
    document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f55;position:fixed;top:0;left:0">${String(e?.stack ?? e)}</pre>`);
    window.__pdoom = { error: String(e?.stack ?? e) };
  });
})();
