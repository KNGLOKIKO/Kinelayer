/* 声音：原项目的 audio/pdoom.mp3 是别人的歌（授权不覆盖），一个字节不能搬。
 * 替代：**现场合成的原创配乐**（Am–F–C–G，132.007 BPM，四踩 + 2/4 军鼓 + 八分镲，
 * 段落边界一声提示音），对外暴露 <audio> 形状的小时钟 —— main.ts 里那套
 * 「audio.currentTime 粗时钟 + performance.now 平滑」可以原样工作。
 * 想换成真歌：把文件放到 audio/pdoom.mp3，这里会自动优先用它。
 */
(function () {
  const D = window.PD_DATA;
  const CHORDS = [
    [0, 3, 7, 12], [-4, 0, 7, 12], [3, 7, 12, 16], [-2, 2, 7, 14], // Am F C G（半音，根音 A2=110Hz）
  ];
  const ROOT = 110;

  class SynthPlayer {
    constructor(duration) {
      this.duration = duration;
      this.ctx = null;
      this._t = 0;            // 曲内时间
      this._startCtx = 0;     // play() 时的 ctx.currentTime
      this.playing = false;
      this.ended = false;
      this._nodes = [];
    }
    get currentTime() {
      if (!this.ctx) return this._t;
      return this.playing ? this._t + (this.ctx.currentTime - this._startCtx) : this._t;
    }
    get paused() { return !this.playing; }
    set currentTime(t) { this._t = Math.max(0, Math.min(this.duration - 0.001, t)); this._reschedule(); }

    _ensure() {
      if (this.ctx) return;
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      this.master.connect(this.ctx.destination);
    }
    _tone(type, freq, t0, dur, vol, filterHz) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      if (filterHz) {
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = filterHz;
        o.connect(f); f.connect(g);
      } else o.connect(g);
      g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.05);
      this._nodes.push(o);
    }
    _noise(t0, dur, vol, hp) {
      const n = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t0); src.stop(t0 + dur);
      this._nodes.push(src);
    }
    _kick(t0) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(150, t0);
      o.frequency.exponentialRampToValueAtTime(42, t0 + 0.12);
      g.gain.setValueAtTime(0.9, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + 0.3);
      this._nodes.push(o);
    }
    _reschedule() {
      if (!this.ctx) return;
      for (const n of this._nodes) { try { n.stop(); } catch { /* 已停 */ } }
      this._nodes = [];
      const t0 = this.ctx.currentTime + 0.05;
      this._startCtx = t0;
      this._t = this.currentTime; // 冻结起点
      const from = this._t;
      const end = Math.min(this.duration, from + this.duration);
      for (let bar = 0; bar < D.BARS; bar++) {
        const bt = bar * 4 * D.SPB;
        if (bt < from - 2 || bt > end) continue;
        const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
        for (const semi of chord) this._tone('sawtooth', ROOT * Math.pow(2, semi / 12), t0 + bt, 3.4, 0.05, 900);
      }
      for (let i = 0; i < D.BARS * 4; i++) {
        const t = i * D.SPB;
        if (t < from || t > end) continue;
        const at = t0 + (t - from);
        if (i >= 8) this._kick(at);
        if (i >= 8 && i % 4 === 1) this._noise(at, 0.16, 0.35, 1800);
        if (i >= 4) this._noise(at + D.SPB / 2, 0.05, 0.12, 6000);
      }
      for (const s of D.sections) if (s.start >= from && s.start <= end) this._tone('triangle', ROOT * 4, t0 + s.start, 0.5, 0.12);
    }
    play() {
      this._ensure();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.playing = true;
      this.ended = false;
      this._reschedule();
    }
    pause() {
      if (!this.ctx) return;
      this._t = this.currentTime;
      this.playing = false;
      for (const n of this._nodes) { try { n.stop(); } catch { /* 已停 */ } }
      this._nodes = [];
    }
  }

  /* 有真歌就用真歌（本地 audio/pdoom.mp3），没有就现场合成 —— 同一个 <audio> 形状 */
  window.PD_makeAudio = function (duration) {
    const probe = new Audio();
    return new Promise((resolve) => {
      let settled = false;
      const fallback = () => { if (!settled) { settled = true; resolve(new SynthPlayer(duration)); } };
      probe.addEventListener('canplaythrough', () => {
        if (settled) return;
        settled = true;
        const a = new Audio('audio/pdoom.mp3');
        a.preload = 'auto';
        resolve(a);
      }, { once: true });
      probe.addEventListener('error', fallback, { once: true });
      setTimeout(fallback, 1500);
      probe.src = 'audio/pdoom.mp3';
    });
  };
})();
