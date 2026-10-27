/* engine/engine.ts + post.ts + scene.ts 的移植。
 *
 * 三条不变的铁律（ENGINE.md 原文语义）：
 *   1. 场景输出必须是 f.t 的纯函数 —— 预览与导出逐帧一致；
 *   2. 后处理在运动模糊平均**之后**：bloom → halation → CA → grain → vignette → HUD，
 *      每帧只画一次的（HUD/grain/dither）不参与子帧平均；
 *   3. 自适应采样档位 4/12/36/108/324，每步在两侧各插子帧，步长按 1/count 缩小，
 *      剩余误差低于 tol 就停。原项目靠 early-Z 跳过已收敛的 tile；
 *      canvas2d 没有 scissor 等价物，这里退化为**整帧统一计数**（Kinelayer docs/12 同款结论）。
 */
(function () {
  const PW = 1920, PH = 1080;
  const STAGES = [4, 12, 36, 108, 324];

  const { HEX, rgba } = window.PD_PAL;

  /* ------------------------------------------------------------ Scene 基类 */
  class Scene {
    static id = 'scene';
    handlesTransition = false;
    stateful = false;
    constructor(engine, entry) {
      this.engine = engine;
      this.ctx = {
        engine, entry,
        params: entry.params ?? {},
        get start() { return entry.start; },
        get end() { return entry.end; },
        lyrics: engine.lyrics,
        audio: engine.audio,
      };
    }
    async init() {}
    reset() {}
    /** 必须完全覆写 out；可返回 post 覆写对象 */
    render(f, out) {}
  }

  /* ------------------------------------------------------------ Frame */
  function makeFrame(engine, t, dt, entry) {
    const a = {};
    for (const k of ['rms', 'low', 'mid', 'high', 'vocal', 'drums', 'bass', 'other', 'kick', 'snare', 'hat', 'vonset']) a[k] = engine.audio.env(k, t);
    return {
      t,
      dt,
      a,
      beat: engine.audio.beatAt(t),
      bar: engine.audio.barAt(t),
      beatPhase: engine.audio.beatAt(t) % 1,
      barPhase: (engine.audio.beatAt(t) / 4) % 1,
      lt: t - entry.start,                       // 局部时间
      p: (t - entry.start) / Math.max(0.001, entry.end - entry.start), // 局部进度
      /** 快门期间恒定的帧序号 —— 60fps 的闪烁用它，不用 floor(t*60) */
      frameIdx: (shutter = 0.5) => Math.round((t - shutter * dt) / dt),
    };
  }

  const mulberry32 = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
  const hash = (n) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };

  /* ------------------------------------------------------------ 后处理 */
  /* bloom 的 LDR 近似：brightness 提亮 + 1/4 分辨率 blur + screen 回叠 —— 没有真阈值
   * （原版 HalfFloat HDR 里 signal/ember 线性值 >1 才亮；这里只能靠 bloom 强度调手感，
   * bone 大字的锐利由各场景把 bloom 压低来保证，见 Hook）。 */
  const DEFAULT_POST = { exposure: 1, bloom: 0.5, bloomThreshold: 0.85, bloomRadius: 24, halation: 0.25, ca: 0, grain: 0.12, vignette: 0.3, hud: 1, fade: 0, flash: 0, shake: [0, 0], zoom: 1, invert: 0, pdoom: 0 };

  class Engine {
    static RGB_BYTES = PW * PH * 3;
    constructor(canvas, makeTimeline) {
      this.canvas = canvas;
      this.scale = 1;
      this.errors = [];
      this._makeTimeline = makeTimeline;
      this.grainTiles = [];
    }
    get width() { return PW * this.scale; }
    get height() { return PH * this.scale; }

    async init(onlyFilter) {
      this.lyrics = window.PD_LYRICS;
      this.audio = window.PD_AUDIO;
      this.duration = window.PD_DATA.DURATION;
      const mk = () => this._makeTimeline(this.lyrics, this.audio);
      const raw = mk();
      const entries = [];
      for (const e of raw) {
        if (e.end <= e.start) continue;
        const Cls = window.PD_SCENES[e.id] ?? window.PD_SCENES[e.file] ?? null;
        if (!Cls) { this.errors.push(`scene not found: ${e.id}`); continue; }
        entries.push({ ...e, Cls });
      }
      this.timeline = entries.filter((e) => !onlyFilter || onlyFilter(e));
      this.scenes = new Map();
      for (const e of this.timeline) {
        try {
          const s = new e.Cls(this, e);
          await s.init();
          this.scenes.set(e.id, s);
        } catch (err) {
          this.errors.push(`${e.id}: ${err?.message ?? err}`);
        }
      }
      /* 逻辑画布（场景绘制处）与物理画布（显示） */
      this.log = document.createElement('canvas');
      this.log.width = PW; this.log.height = PH;
      this.logx = this.log.getContext('2d');
      this.accum = document.createElement('canvas');
      this.accum.width = PW; this.accum.height = PH;
      this.accx = this.accum.getContext('2d');
      for (let i = 0; i < 6; i++) {
        const c = document.createElement('canvas'); c.width = 256; c.height = 256;
        const x = c.getContext('2d');
        const img = x.createImageData(256, 256);
        const rnd = mulberry32(1000 + i);
        for (let p = 0; p < img.data.length; p += 4) {
          const v = 128 + (rnd() - 0.5) * 255;
          img.data[p] = img.data[p + 1] = img.data[p + 2] = v; img.data[p + 3] = 255;
        }
        x.putImageData(img, 0, 0);
        this.grainTiles.push(c);
      }
      this.small = document.createElement('canvas');
      this.small.width = PW / 4; this.small.height = PH / 4;
      this.smallx = this.small.getContext('2d');
    }

    entryAt(t) { return this.timeline.find((e) => t >= e.start && t < e.end) ?? this.timeline[this.timeline.length - 1]; }

    /** 渲一帧；samples=1 单帧，数字 N 取 N 子帧平均，'auto' 走档位收敛。返回用的子帧数 */
    render(t, dt = 1 / 60, final = false, samples = 1, shutter = 0.5) {
      const entry = this.entryAt(t);
      const scene = this.scenes.get(entry.id);
      const { logx, accx } = this;
      const cap = entry.maxSamples ?? 36;

      let count = 1;
      if (samples === 'auto') {
        const stages = STAGES.filter((s) => s <= Math.min(cap, 108));
        count = stages[stages.length - 1] ?? 1;
      } else if (typeof samples === 'number') count = Math.max(1, Math.round(samples));

      /*
       * 主帧决定 post 覆写（原版语义：render() 的返回值就是本帧的 post 参数），
       * 子帧只贡献画面。子帧铺在以帧时刻为中心的 shutter 窗口里 ——
       * 「运动模糊积分的是一帧曝光」，不是一段时间。
       */
      logx.fillStyle = HEX.ink; logx.fillRect(0, 0, PW, PH);
      const override = scene.render(makeFrame(this, t, dt, entry), logx) ?? {};

      accx.setTransform(1, 0, 0, 1, 0, 0);
      accx.globalCompositeOperation = 'source-over';
      accx.globalAlpha = 1;
      accx.fillStyle = HEX.ink;
      accx.fillRect(0, 0, PW, PH);
      accx.drawImage(this.log, 0, 0);
      for (let i = 1; i < count; i++) {
        const st = t + shutter * dt * ((i + 0.5) / count - 0.5);
        logx.fillStyle = HEX.ink; logx.fillRect(0, 0, PW, PH);
        this._drawScene(scene, makeFrame(this, st, dt, entry), logx);
        accx.globalAlpha = 1 / (i + 1);
        accx.drawImage(this.log, 0, 0);
      }
      accx.globalAlpha = 1;

      /* —— 后处理（一次性，不参与平均）—— */
      const out = this.canvas.getContext('2d');
      const post = { ...DEFAULT_POST, ...override };
      this._post(out, this.accum, post, t, dt, final);
      return count;
    }

    _drawScene(scene, f, ctx) {
      ctx.save();
      const r = scene.render(f, ctx);
      if (r) scene._postOverride = r;
      ctx.restore();
    }

    _post(out, src, post, t, dt, final) {
      const fi = Math.round(t / dt);
      const [sx, sy] = post.shake;
      const shakeX = sx ? (hash(fi) - 0.5) * sx * 40 : 0;
      const shakeY = sy ? (hash(fi + 7) - 0.5) * sy * 40 : 0;
      out.setTransform(1, 0, 0, 1, 0, 0);
      out.globalCompositeOperation = 'source-over';
      out.globalAlpha = 1;
      out.fillStyle = '#000';
      out.fillRect(0, 0, out.canvas.width, out.canvas.height);

      /* zoom + shake */
      out.save();
      const z = post.zoom;
      out.translate(out.canvas.width / 2 + shakeX * this.scale, out.canvas.height / 2 + shakeY * this.scale);
      out.scale(z * this.scale, z * this.scale);
      out.translate(-PW / 2, -PH / 2);
      /* exposure */
      if (post.exposure !== 1) out.filter = `brightness(${post.exposure})`;
      out.drawImage(src, 0, 0);
      out.filter = 'none';

      /* bloom：1/4 分辨率亮部 + 模糊，screen 回叠 */
      if (post.bloom > 0) {
        const s = this.smallx, S = this.small;
        s.setTransform(1, 0, 0, 1, 0, 0);
        s.globalCompositeOperation = 'source-over';
        s.filter = `brightness(${1 + post.bloomThreshold}) blur(${Math.round(post.bloomRadius / 4)}px)`;
        s.clearRect(0, 0, S.width, S.height);
        s.drawImage(src, 0, 0, S.width, S.height);
        s.filter = 'none';
        out.globalCompositeOperation = 'screen';
        out.globalAlpha = Math.min(1, post.bloom);
        out.drawImage(S, 0, 0, PW, PH);
        /* halation：同一张亮部叠一次暖色 */
        if (post.halation > 0) {
          out.globalAlpha = post.halation;
          out.globalCompositeOperation = 'lighter';
          out.filter = 'sepia(1) saturate(3) hue-rotate(-15deg)';
          out.drawImage(S, 0, 0, PW, PH);
          out.filter = 'none';
        }
        out.globalCompositeOperation = 'source-over';
        out.globalAlpha = 1;
      }

      /* 色差：红/青两份错位 screen（近似，仅供风格） */
      if (post.ca > 0) {
        const d = post.ca * 6;
        out.globalCompositeOperation = 'screen';
        out.globalAlpha = 0.35;
        out.filter = 'url(#none) sepia(1) saturate(6) hue-rotate(-30deg)';
        out.drawImage(src, -d, 0, PW, PH);
        out.filter = 'sepia(1) saturate(6) hue-rotate(140deg)';
        out.drawImage(src, d, 0, PW, PH);
        out.filter = 'none';
        out.globalCompositeOperation = 'source-over';
        out.globalAlpha = 1;
      }

      /* grain：每帧一次，四张噪声瓦片轮换 */
      if (post.grain > 0) {
        const tile = this.grainTiles[fi % this.grainTiles.length];
        out.globalCompositeOperation = 'overlay';
        out.globalAlpha = post.grain;
        const pat = out.createPattern(tile, 'repeat');
        out.fillStyle = pat;
        out.fillRect(0, 0, PW, PH);
        out.globalCompositeOperation = 'source-over';
        out.globalAlpha = 1;
      }

      /* vignette */
      if (post.vignette > 0) {
        const g = out.createRadialGradient(PW / 2, PH / 2, PH * 0.35, PW / 2, PH / 2, PH * 0.85);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, `rgba(0,0,0,${post.vignette})`);
        out.fillStyle = g;
        out.fillRect(0, 0, PW, PH);
      }

      /* HUD：裁切标记 + 可选 P(doom) 读数（post.pdoom > 0 才出现） */
      if (post.hud > 0) this._hud(out, post, t);

      /* flash / fade / invert */
      if (post.flash > 0) { out.fillStyle = `rgba(255,255,255,${Math.min(1, post.flash)})`; out.fillRect(0, 0, PW, PH); }
      if (post.invert > 0) { out.globalCompositeOperation = 'difference'; out.fillStyle = `rgba(255,255,255,${post.invert})`; out.fillRect(0, 0, PW, PH); out.globalCompositeOperation = 'source-over'; }
      if (post.fade > 0) { out.fillStyle = `rgba(5,5,5,${Math.min(1, post.fade)})`; out.fillRect(0, 0, PW, PH); }
      out.restore();
    }

    _hud(out, post, t) {
      const a = post.hud;
      out.save();
      out.globalAlpha = a;
      /* 裁切标记只在书挡出现（原片 revision 4）：开场飞出、片尾收回来 —— 首尾帧相接可循环 */
      const lossStart = this.timeline.find((e) => e.id === 'loss')?.start ?? 9;
      const outroStart = this.timeline.find((e) => e.id === 'outro')?.start ?? this.duration - 16;
      let mark = 0;
      if (t < lossStart) mark = t > lossStart - 0.5 ? (lossStart - t) / 0.5 : 1;      // 飞出
      else if (t >= outroStart) mark = Math.min(1, (t - outroStart) / 1.2);          // 收回
      if (mark > 0.01) {
        out.globalAlpha = a * mark;
        out.strokeStyle = rgba('ash', 0.55);
        out.lineWidth = 2;
        const m = 26, L = 34;
        for (const [cx, cy, dx, dy] of [[m, m, 1, 1], [PW - m, m, -1, 1], [m, PH - m, 1, -1], [PW - m, PH - m, -1, -1]]) {
          out.beginPath();
          out.moveTo(cx + dx * L, cy); out.lineTo(cx, cy); out.lineTo(cx, cy + dy * L);
          out.stroke();
        }
      }
      if (post.pdoom > 0) {
        out.font = '500 30px ui-monospace, Menlo, monospace';
        out.fillStyle = rgba('ash', 0.9);
        out.fillText('图层数', 56, PH - 64);
        out.font = '700 38px ui-monospace, Menlo, monospace';
        out.fillStyle = rgba('signal', 0.95);
        out.fillText(Math.round(this.hudLayers(t)).toLocaleString('en-US'), 56, PH - 30);
      }
      out.restore();
    }
    /** 图层数读数：随整片沿段落阶梯几何爬升（3 → … → 4096），hook 处正好落在钩子值上 */
    hudLayers(t) {
      const A = [[0, 3], [9.5, 8], [16.6, 12], [22.05, 15], [36.6, 32], [52.96, 48], [58.42, 64], [74.78, 128], [89.32, 256], [94.78, 384], [109.32, 512], [123.87, 2048], [140.23, 4096]];
      let v = A[0][1];
      for (let i = 0; i < A.length - 1; i++) {
        const [t0, v0] = A[i], [t1, v1] = A[i + 1];
        if (t >= t0 && t < t1) { v = v0 * Math.pow(v1 / v0, (t - t0) / (t1 - t0)); break; }
        if (t >= t1) v = v1;
      }
      return Math.max(3, v);
    }

    reload() {}
    async readPixelsAsync() { return null; }
  }

  window.PD_Engine = Engine;
  window.PD_Scene = Scene;
  window.PD_FRAME = { makeFrame, mulberry32, hash, PW, PH, STAGES };
})();
