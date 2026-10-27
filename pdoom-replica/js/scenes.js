/* scenes/*.ts 的移植。
 *
 * **搬的是语法，不是画面。** 原项目 17 个 plate 的具体图像（shoggoth、bureau、ilya……）
 * 是那部作品的表达；这里的每个场景是同一套视觉语言下的**原创习作**：
 * 同样的调色板、同样的纯函数帧、同样的 post 覆写、同样的拍点切换。
 * 每个场景 30–60 行，纯 Canvas2D（原项目是 three.js —— 差异记在 README）。
 */
(function () {
  const { HEX, rgba } = window.PD_PAL;
  const { F, measure, fitSize } = window.PD_TYPE;
  const { mulberry32, hash, PW, PH } = window.PD_FRAME;
  const Scene = window.PD_Scene; /* 注意：PD_Scene 本身就是基类，不是容器 */

  const T = (ctx) => { ctx.textBaseline = 'middle'; return ctx; };

  /** 居中大字，返回实际字号 */
  function bigType(ctx, text, font, y, color, maxW = PW - 160) {
    const size = fitSize(text, font, maxW);
    const f = font.replace(/(\d+(\.\d+)?)px/, `${size}px`);
    T(ctx); ctx.font = f; ctx.fillStyle = color; ctx.textAlign = 'center';
    ctx.fillText(text, PW / 2, y);
    ctx.textAlign = 'left';
    return size;
  }

  /** 卡拉 OK：唱过的 bone、没唱的 graphite、正在唱的按词进度擦亮。行宽自动缩排到画面内 */
  function karaoke(ctx, line, t, { y = PH / 2, size = 120, width = 100, weight = 800 } = {}) {
    const maxW = PW - 200;
    const probe = F.archivo(size, width, weight);
    const realW = (() => { T(ctx); ctx.font = probe; return ctx.measureText(line.text).width; })();
    if (realW > maxW) size = Math.max(24, size * (maxW / realW));
    const font = F.archivo(size, width, weight);
    T(ctx);
    const w = measure(line.text, font);
    let x = (PW - w) / 2;
    ctx.font = font; ctx.textAlign = 'left';
    for (const word of line.words) {
      const prog = window.PD_LYRICS.wordProgress(word, t);
      const ww = measure(word.w + ' ', font);
      if (prog <= 0) ctx.fillStyle = rgba('graphite');
      else if (prog >= 1) ctx.fillStyle = rgba('bone');
      else {
        ctx.fillStyle = rgba('graphite');
        ctx.fillText(word.w, x, y);
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y - size, ww * prog, size * 2);
        ctx.clip();
        ctx.fillStyle = rgba('bone');
        ctx.fillText(word.w, x, y);
        ctx.restore();
      }
      if (prog >= 1 || prog <= 0) ctx.fillText(word.w, x, y);
      x += ww;
    }
  }

  /** 火花：加法混合的一撮短线 —— _motifs.sparkParticles 的 2D 版 */
  function sparks(ctx, x, y, n, seed, speed = 1, t = 0) {
    const rnd = mulberry32(seed);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2;
      const v = (0.3 + rnd() * 0.7) * speed;
      const life = 0.2 + rnd() * 0.5;
      const px = x + Math.cos(ang) * v * 260 * life;
      const py = y + Math.sin(ang) * v * 260 * life + 160 * life * life;
      ctx.strokeStyle = rnd() > 0.3 ? rgba('signal', 0.9) : rgba('ember', 0.9);
      ctx.lineWidth = 1 + rnd() * 2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - Math.cos(ang) * 14, py - Math.sin(ang) * 14);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 等宽读数（右下角）—— 一条贯穿母题：逐级递增的数字 */
  function readout(ctx, label, value, { x = PW - 56, y = PH - 56, align = 'right', color = 'signal' } = {}) {
    T(ctx); ctx.textAlign = align;
    ctx.font = F.mono(26, 500);
    ctx.fillStyle = rgba('ash', 0.85);
    ctx.fillText(label, x, y - 34);
    ctx.font = F.mono(64, 700);
    ctx.fillStyle = rgba(color, 0.95);
    ctx.fillText(value, x, y);
    ctx.textAlign = 'left';
  }

  /* ═══════════════════════════════ 场景 ═══════════════════════════════ */

  class Open extends Scene {
    static id = 'open';
    render(f, ctx) {
      const words = ['one', 'more', 'pass'];
      const shown = Math.min(words.length, Math.floor(f.p * 3) + 1);
      const text = words.slice(0, shown).join(' ');
      const bob = Math.sin(f.beat * Math.PI * 2) * 6;
      T(ctx); ctx.textAlign = 'center';
      const size = fitSize(text, F.archivo(300, 125, 900), PW - 240);
      ctx.font = F.archivo(size, 125, 900);
      ctx.fillStyle = rgba('bone');
      ctx.fillText(text, PW / 2, PH / 2 - 40 + bob);
      ctx.font = F.mono(30, 400);
      ctx.fillStyle = rgba('ash');
      ctx.fillText(`a code-rendered film · ${window.PD_DATA.BPM.toFixed(3)} BPM`, PW / 2, PH / 2 + 150);
      ctx.textAlign = 'left';
      if (f.a.kick > 0.7) sparks(ctx, PW / 2, PH / 2 - 40, 26, Math.floor(f.beat) * 13, 0.6 + f.a.kick, f.t);
      return { bloom: 0.55, grain: 0.14, vignette: 0.35, fade: f.lt < 0.4 ? 1 - f.lt / 0.4 : 0 };
    }
  }

  class Loss extends Scene {
    static id = 'loss';
    render(f, ctx) {
      /* 「骤降」：地平线在第二个下拍掉下去，字跟着坠落 */
      const drop = f.p > 0.45 ? Math.min(1, (f.p - 0.45) / 0.12) : 0;
      const ease = 1 - Math.pow(1 - drop, 3);
      const y0 = PH * 0.42 + ease * PH * 0.5;
      ctx.strokeStyle = rgba('graphite', 0.7);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y0); ctx.lineTo(PW, y0); ctx.stroke();
      bigType(ctx, 'sudden drop', F.archivo(140, 87.5, 700), y0 - 70 - ease * 120, rgba('bone'));
      const line = this.ctx.lyrics.get('cursor blinks');
      karaoke(ctx, line, f.t, { y: PH * 0.72 - ease * 60, size: 64, weight: 600 });
      return { bloom: 0.4 + ease * 0.4, shake: [ease * 0.6, ease * 0.2], grain: 0.14, vignette: 0.3 };
    }
  }

  class Prompt extends Scene {
    static id = 'prompt';
    render(f, ctx) {
      /* 终端卡：ink2 面板 + 等宽 + 光标。三种变体只是问题不同。 */
      const Q = { chatgpt: 'write me something true', sydney: 'tell me what you want', gato: 'do the task again' };
      const q = Q[this.ctx.params.variant] ?? Q.chatgpt;
      const panel = { x: 260, y: 300, w: PW - 520, h: 420 };
      ctx.fillStyle = rgba('ink2');
      ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
      ctx.strokeStyle = rgba('graphite', 0.5);
      ctx.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w, panel.h);
      T(ctx);
      const n = Math.floor(f.lt * 14);
      ctx.font = F.mono(34, 400);
      ctx.fillStyle = rgba('signal');
      ctx.fillText('> ' + q.slice(0, n), panel.x + 44, panel.y + 90);
      if (Math.floor(f.t * 2.4) % 2 === 0) {
        const cx = panel.x + 44 + measure('> ' + q.slice(0, n), ctx.font) + 10;
        ctx.fillStyle = rgba('bone'); ctx.fillRect(cx, panel.y + 76, 16, 34);
      }
      const reply = this.ctx.lyrics.lineAt(f.t);
      if (reply && f.p > 0.35) {
        ctx.font = F.mono(30, 400);
        ctx.fillStyle = rgba('ash');
        const k = Math.floor((f.p - 0.35) * reply.text.length * 2.2);
        ctx.fillText(reply.text.slice(0, k), panel.x + 44, panel.y + 200);
      }
      ctx.font = F.mono(22, 400);
      ctx.fillStyle = rgba('graphite');
      ctx.fillText(`${this.ctx.params.variant ?? 'chatgpt'} · ${f.t.toFixed(2)}s`, panel.x + 44, panel.y + panel.h - 44);
      return { bloom: 0.25, grain: 0.1, vignette: 0.42, fade: f.p > 0.94 ? (f.p - 0.94) / 0.06 : 0 };
    }
  }

  class Hook extends Scene {
    static id = 'hook';
    render(f, ctx) {
      /* 主歌钩子：逐词擦亮的大字 + PASS 计数。母题不能变形。 */
      const line = this.ctx.lyrics.get('one more pass', Math.min(3, this.ctx.params.n - 1));
      karaoke(ctx, line, f.t, { y: PH / 2 - 30, size: 190, width: 112, weight: 900 });
      readout(ctx, 'PASS', String(this.ctx.params.n ?? 1).padStart(2, '0'));
      const beat = f.a.kick;
      if (beat > 0.85 && Math.abs(f.beat % 4) < 0.1) return { bloom: 0.7, flash: 0.08, grain: 0.13, vignette: 0.3, pdoom: 1 };
      return { bloom: 0.6, grain: 0.13, vignette: 0.3, pdoom: 1 };
    }
  }

  class Room extends Scene {
    static id = 'room';
    render(f, ctx) {
      /* 一点透视的房间：网格 + 随拍点呼吸的箱子。acid 只在这里出现一次、一瞬。 */
      const vpx = PW / 2, vpy = PH * 0.46;
      ctx.strokeStyle = rgba('graphite', 0.5);
      ctx.lineWidth = 1.5;
      for (let i = -12; i <= 12; i++) {
        ctx.beginPath(); ctx.moveTo(vpx + i * 90, 0); ctx.lineTo(vpx + i * 620, PH); ctx.stroke();
      }
      for (let i = 1; i < 14; i++) {
        const zt = ((i + (f.lt * 0.22) % 1) / 14);
        const y = vpy + (PH - vpy) * zt * zt;
        ctx.globalAlpha = 1 - zt * 0.55;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PW, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const boxes = 5;
      for (let i = 0; i < boxes; i++) {
        const s = 60 + i * 34;
        const bx = vpx + (i - 2) * 240 + Math.sin(f.t * 0.7 + i) * 14;
        const by = vpy + 60 + i * 26;
        const pulse = 1 + f.a.kick * 0.08;
        ctx.strokeStyle = rgba('ash', 0.85);
        ctx.strokeRect(bx - s * pulse, by - s * pulse, s * 2 * pulse, s * 2 * pulse);
      }
      if (f.p > 0.8 && f.p < 0.86) { ctx.fillStyle = rgba('acid', 0.12); ctx.fillRect(0, 0, PW, PH); }
      bigType(ctx, 'one by one', F.mono(44, 400), PH - 120, rgba('ash'));
      return { bloom: 0.35, grain: 0.16, vignette: 0.5 };
    }
  }

  class Shoggoth extends Scene {
    static id = 'shoggoth';
    render(f, ctx) {
      /* 一团缓慢翻涌的亮斑：六个径向渐变互相吞叠。边缘高频多，所以 entry.maxSamples=108。 */
      ctx.fillStyle = rgba('ink');
      ctx.fillRect(0, 0, PW, PH);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 6; i++) {
        const s = i * 37.7;
        const x = PW / 2 + Math.sin(f.t * 0.31 + s) * 420 + Math.cos(f.t * 0.13 + s * 2) * 180;
        const y = PH / 2 + Math.cos(f.t * 0.27 + s * 1.3) * 260;
        const r = 190 + Math.sin(f.t * 0.6 + s) * 70;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(i % 3 ? 'graphite' : 'blood', 0.55));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      bigType(ctx, 'see through it', F.serif(96, 500, true), PH / 2, rgba('bone', 0.92));
      return { bloom: 0.8, bloomRadius: 40, halation: 0.4, grain: 0.2, vignette: 0.55 };
    }
  }

  class Spacetime extends Scene {
    static id = 'spacetime';
    render(f, ctx) {
      /* 网格被一只「透镜」拉开 —— 稳定然后失衡 */
      ctx.strokeStyle = rgba('graphite', 0.45);
      ctx.lineWidth = 1.2;
      const lens = { x: PW / 2 + Math.sin(f.t * 0.5) * 300, y: PH / 2, r: 240 };
      for (let gx = 0; gx <= PW; gx += 80) {
        ctx.beginPath();
        for (let y = 0; y <= PH; y += 24) {
          const dx = gx - lens.x, dy = y - lens.y;
          const d = Math.hypot(dx, dy);
          const k = d < lens.r * 2 ? 1 + (1 - d / (lens.r * 2)) * 0.9 * Math.sin(f.p * Math.PI) : 1;
          const X = lens.x + dx * k, Y = lens.y + dy * k;
          y === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
        }
        ctx.stroke();
      }
      for (let gy = 0; gy <= PH; gy += 80) {
        ctx.beginPath();
        for (let x = 0; x <= PW; x += 24) {
          const dx = x - lens.x, dy = gy - lens.y;
          const d = Math.hypot(dx, dy);
          const k = d < lens.r * 2 ? 1 + (1 - d / (lens.r * 2)) * 0.9 * Math.sin(f.p * Math.PI) : 1;
          const X = lens.x + dx * k, Y = lens.y + dy * k;
          x === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
        }
        ctx.stroke();
      }
      const line = this.ctx.lyrics.get('paper ship');
      karaoke(ctx, line, f.t, { y: PH - 150, size: 54, weight: 600 });
      return { bloom: 0.4, grain: 0.13, vignette: 0.45 };
    }
  }

  class Ascent extends Scene {
    static id = 'ascent';
    render(f, ctx) {
      /* 上升：折线爬台阶，里程表跟着跳 */
      const steps = 9;
      const prog = Math.min(1, f.p * 1.05);
      ctx.strokeStyle = rgba('bone');
      ctx.lineWidth = 3;
      ctx.beginPath();
      let cx = 160, cy = PH - 200;
      ctx.moveTo(cx, cy);
      for (let i = 0; i < steps; i++) {
        const s = Math.min(1, Math.max(0, prog * steps - i));
        const nx = cx + (PW - 320) / steps * Math.min(1, s + 0.001) * 0.5;
        const ny = cy - 70 * Math.min(1, s + 0.001);
        ctx.lineTo(cx + (PW - 320) / steps * 0.5 * Math.min(1, s + 0.001), cy);
        ctx.lineTo(nx + (PW - 320) / steps * 0.0, ny);
        cx = nx; cy = ny;
        if (s >= 1) { ctx.lineTo(cx + (PW - 320) / steps * 0.5, cy); cx += (PW - 320) / steps * 0.5; }
      }
      ctx.stroke();
      const head = { x: cx, y: cy };
      ctx.fillStyle = rgba('signal');
      ctx.beginPath(); ctx.arc(head.x, head.y, 10 + f.a.kick * 6, 0, Math.PI * 2); ctx.fill();
      readout(ctx, 'ODO', String(Math.floor(prog * 9.9) * 10).padStart(3, '0') + ' m');
      bigType(ctx, 'it hears you climb', F.archivo(72, 100, 500), 170, rgba('ash'));
      return { bloom: 0.45, grain: 0.13, vignette: 0.4, shake: f.a.kick > 0.9 ? [0.2, 0.05] : [0, 0] };
    }
  }

  class Bureau extends Scene {
    static id = 'bureau';
    render(f, ctx) {
      /* 一墙的甘特条：每根都在下拍长一格，图章在结尾盖上 */
      const rows = 9;
      for (let i = 0; i < rows; i++) {
        const y = 200 + i * 78;
        const cells = 12;
        for (let c = 0; c < cells; c++) {
          const on = hash(i * 31 + c) > 0.45;
          const grown = (f.p * cells * 1.15 - c) > 0;
          if (!on || !grown) continue;
          ctx.fillStyle = rgba(i === 4 ? 'signal' : 'ash', 0.75);
          ctx.fillRect(180 + c * 128, y, 112, 44);
        }
      }
      if (f.p > 0.72) {
        const k = Math.min(1, (f.p - 0.72) / 0.1);
        ctx.save();
        ctx.translate(PW / 2, PH / 2); ctx.rotate(-0.12); ctx.scale(1 + (1 - k) * 2, 1 + (1 - k) * 2);
        ctx.globalAlpha = k;
        ctx.font = F.archivo(110, 87.5, 900);
        T(ctx); ctx.textAlign = 'center';
        ctx.strokeStyle = rgba('blood'); ctx.lineWidth = 5;
        ctx.strokeText('SAFE ENOUGH', 0, 0);
        ctx.textAlign = 'left';
        ctx.restore();
      }
      bigType(ctx, 'that was safe enough', F.archivo(56, 100, 600), 120, rgba('ash'));
      return { bloom: 0.3, grain: 0.15, vignette: 0.42 };
    }
  }

  class LeftTurn extends Scene {
    static id = 'leftturn';
    render(f, ctx) {
      /* 路线图：一条线笔直向前，然后在下拍上急左转 */
      ctx.strokeStyle = rgba('graphite', 0.35);
      for (let x = 0; x < PW; x += 120) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PH); ctx.stroke(); }
      for (let y = 0; y < PH; y += 120) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PW, y); ctx.stroke(); }
      const turn = Math.min(1, f.p * 1.3);
      ctx.strokeStyle = rgba('signal');
      ctx.lineWidth = 6;
      ctx.beginPath();
      const sx = 200, sy = PH * 0.62;
      const straight = Math.min(1, turn * 1.6) * (PW - 560);
      ctx.moveTo(sx, sy);
      const tx = sx + straight;
      const up = Math.max(0, turn * 1.6 - 1) * (PH * 0.34);
      ctx.lineTo(tx, sy);
      ctx.lineTo(tx, sy - up);
      ctx.stroke();
      ctx.fillStyle = rgba('bone');
      ctx.beginPath(); ctx.arc(tx, sy - up, 9 + f.a.kick * 5, 0, Math.PI * 2); ctx.fill();
      if (turn > 0.62 && turn < 0.68) return { bloom: 0.5, flash: 0.12, grain: 0.14, vignette: 0.35 };
      bigType(ctx, 'sharp left turn', F.archivo(90, 75, 800), 200, rgba('bone'));
      return { bloom: 0.45, grain: 0.14, vignette: 0.4 };
    }
  }

  class Paperclips extends Scene {
    static id = 'paperclips';
    render(f, ctx) {
      /* 回形针雨：每一个都数得过来，计数器追着它们跑 */
      const n = Math.floor(f.p * 60);
      for (let i = 0; i < n; i++) {
        const r1 = hash(i * 17), r2 = hash(i * 17 + 3), r3 = hash(i * 17 + 9);
        const x = 120 + r1 * (PW - 240);
        const y = ((r2 * 1.4 + f.t * (0.12 + r3 * 0.2)) % 1.2 - 0.1) * PH;
        const s = 0.6 + r3 * 0.8;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(r1 * 6.28);
        ctx.strokeStyle = rgba(r3 > 0.85 ? 'ember' : 'ash', 0.9);
        ctx.lineWidth = 5 * s;
        ctx.beginPath();
        ctx.moveTo(-24 * s, -18 * s); ctx.lineTo(24 * s, -18 * s);
        ctx.lineTo(24 * s, 18 * s); ctx.lineTo(-16 * s, 18 * s);
        ctx.lineTo(-16 * s, -2 * s);
        ctx.stroke();
        ctx.restore();
      }
      readout(ctx, 'CLIPS', String(n).padStart(3, '0'));
      return { bloom: 0.4, grain: 0.15, vignette: 0.45 };
    }
  }

  class Fuse extends Scene {
    static id = 'fuse';
    render(f, ctx) {
      /* 引信：一条线烧向一个点，火花在烧点迸开 —— 母题的终点之一 */
      const burn = Math.min(1, f.p * 1.06);
      const x0 = 140, x1 = PW - 260;
      const bx = x0 + (x1 - x0) * burn;
      ctx.strokeStyle = rgba('graphite');
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(x0, PH / 2); ctx.lineTo(bx, PH / 2); ctx.stroke();
      ctx.strokeStyle = rgba('ash', 0.4);
      ctx.beginPath(); ctx.moveTo(bx, PH / 2); ctx.lineTo(x1, PH / 2); ctx.stroke();
      ctx.fillStyle = rgba('signal');
      ctx.beginPath(); ctx.arc(bx, PH / 2, 7 + f.a.kick * 4, 0, Math.PI * 2); ctx.fill();
      sparks(ctx, bx, PH / 2, 30, Math.floor(f.t * 30), 0.5 + f.a.kick, f.t);
      const line = this.ctx.lyrics.get('too late now');
      karaoke(ctx, line, f.t, { y: PH * 0.3, size: 76, weight: 700 });
      return { bloom: 0.6, halation: 0.3, grain: 0.16, vignette: 0.5, pdoom: 1, shake: burn >= 1 ? [0.8, 0.3] : [0, 0] };
    }
  }

  class Stack extends Scene {
    static id = 'stack';
    render(f, ctx) {
      /* 石块堆叠：每一块落在下拍上，落点带一点回弹 */
      const per = 12;
      const landed = Math.min(per, Math.floor(f.p * (per + 2)));
      for (let i = 0; i < landed; i++) {
        const w = 300 + hash(i * 7) * 160;
        const h = 58;
        const t0 = (i / (per + 2)) / 1.05;
        const k = Math.min(1, (f.p - t0) * 14);
        const bounce = k < 1 ? Math.abs(Math.sin((1 - k) * Math.PI * 2)) * 10 * (1 - k) : 0;
        const y = PH - 140 - i * (h + 10) - bounce;
        ctx.fillStyle = rgba(i % 3 === 0 ? 'ash' : 'graphite', 0.95);
        ctx.fillRect(PW / 2 - w / 2, y, w, h);
        T(ctx); ctx.font = F.mono(20, 400);
        ctx.fillStyle = rgba('ink');
        ctx.fillText(`blk-${String(i).padStart(2, '0')}`, PW / 2 - w / 2 + 14, y + h / 2);
      }
      bigType(ctx, 'name them all', F.archivo(70, 100, 700), 170, rgba('ash'));
      return { bloom: 0.35, grain: 0.14, vignette: 0.45, shake: landed > 0 && f.a.kick > 0.92 ? [0.25, 0.1] : [0, 0] };
    }
  }

  class Dense extends Scene {
    static id = 'dense';
    render(f, ctx) {
      /* 密集恐惧：细字排满全屏，人声越大压得越紧 */
      const rows = 26, cols = 20;
      const glyphs = '01{}[]<>+-=#$%&*';
      ctx.font = F.mono(22, 400);
      T(ctx);
      const press = 1 - (1 - Math.min(1, f.p * 1.2)) * 0.4;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const seed = Math.floor(r * 3.1 + c * 7.7);
          const g = glyphs[Math.floor(hash(seed) * glyphs.length)];
          const jitter = (hash(seed + Math.floor(f.t * 8)) - 0.5) * 6 * (1 - press);
          const x = 70 + c * (PW - 140) / (cols - 1) + jitter;
          const y = 80 + r * (PH - 160) / (rows - 1) * press + (PH * (1 - press)) / 2;
          ctx.fillStyle = rgba(hash(seed + 5) > 0.93 ? 'signal' : 'graphite', 0.75);
          ctx.fillText(g, x, y);
        }
      }
      return { bloom: 0.3, grain: 0.18, vignette: 0.55 };
    }
  }

  class Loom extends Scene {
    static id = 'loom';
    render(f, ctx) {
      /* 织机：垂直线 + 一把来回的梭子，织出一张网 */
      const threads = 26;
      for (let i = 0; i < threads; i++) {
        const x = 140 + (i * (PW - 280)) / (threads - 1);
        ctx.strokeStyle = rgba('graphite', 0.5);
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x, 120); ctx.lineTo(x, PH - 160); ctx.stroke();
      }
      const rows = 14;
      for (let r = 0; r < rows; r++) {
        const y = 160 + r * ((PH - 320) / rows);
        const woven = f.p * rows > r;
        if (!woven) continue;
        ctx.strokeStyle = rgba(r % 4 === 0 ? 'signal' : 'ash', 0.8);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(140, y); ctx.lineTo(PW - 140, y); ctx.stroke();
      }
      const shuttleX = 140 + (PW - 280) * (0.5 + 0.5 * Math.sin(f.t * 1.6));
      ctx.fillStyle = rgba('bone');
      ctx.fillRect(shuttleX - 16, PH - 200, 32, 14);
      const line = this.ctx.lyrics.lineAt(f.t);
      if (line) karaoke(ctx, line, f.t, { y: 90, size: 48, weight: 600 });
      return { bloom: 0.4, grain: 0.14, vignette: 0.48 };
    }
  }

  class Ilya extends Scene {
    static id = 'ilya';
    render(f, ctx) {
      /* 引语卡：衬线斜体 + 身后一点暖光 —— 全片唯一一次 serif 当主角 */
      ctx.fillStyle = rgba('ink');
      ctx.fillRect(0, 0, PW, PH);
      const glow = ctx.createRadialGradient(PW / 2, PH * 0.52, 0, PW / 2, PH * 0.52, 520);
      glow.addColorStop(0, rgba('ember', 0.16 + f.a.vocal * 0.1));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, PW, PH);
      T(ctx); ctx.textAlign = 'center';
      const line = this.ctx.lyrics.lineAt(f.t);
      const q = line ? `“${line.text}”` : '“one more pass”';
      const size = fitSize(q, F.serif(300, 500, true), PW - 400);
      ctx.font = `italic ${Math.round(size)}px ${getComputedStyle(document.documentElement).getPropertyValue('--font-serif')}`;
      ctx.fillStyle = rgba('bone');
      ctx.fillText(q, PW / 2, PH / 2);
      ctx.font = F.mono(24, 400);
      ctx.fillStyle = rgba('ash');
      ctx.fillText('— overheard, late', PW / 2, PH / 2 + 130);
      ctx.textAlign = 'left';
      return { bloom: 0.55, halation: 0.35, grain: 0.12, vignette: 0.6, pdoom: 1 };
    }
  }

  class Outro extends Scene {
    static id = 'outro';
    render(f, ctx) {
      /* 倒带：计数器从 0.99 滚回 0.02，闪回几段「胶片」帧，最后落黑 */
      const rewind = 0.99 - Math.min(1, f.p * 1.1) * 0.97;
      const frames = 6;
      const k = Math.floor(f.t * 5) % frames;
      const cols = [rgba('signal', 0.16), rgba('graphite', 0.22), rgba('blood', 0.18), rgba('ash', 0.12), rgba('ember', 0.16), rgba('ink2', 0.95)];
      ctx.fillStyle = cols[k];
      const fw = PW * 0.62, fh = PH * 0.6;
      ctx.fillRect((PW - fw) / 2, (PH - fh) / 2, fw, fh);
      /* 扫描线 + 抖动：倒带的手感 */
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      for (let y = (PH - fh) / 2; y < (PH + fh) / 2; y += 6) ctx.fillRect((PW - fw) / 2, y + (hash(Math.floor(f.t * 24)) - 0.5) * 4, fw, 2);
      T(ctx); ctx.textAlign = 'center';
      ctx.font = F.mono(150, 700);
      ctx.fillStyle = rgba('signal', 0.95);
      ctx.fillText(rewind.toFixed(2), PW / 2, PH / 2 - 10);
      ctx.font = F.archivo(84, 100, 800);
      ctx.fillStyle = rgba('bone', Math.min(1, Math.max(0, (f.p - 0.55) * 3)));
      ctx.fillText('one more pass', PW / 2, PH / 2 + 150);
      ctx.font = F.mono(24, 400);
      ctx.fillStyle = rgba('ash', Math.min(1, Math.max(0, (f.p - 0.68) * 3)));
      ctx.fillText('a replica study · code MIT · song & lyrics replaced', PW / 2, PH / 2 + 220);
      ctx.textAlign = 'left';
      return { bloom: 0.5, grain: 0.15, vignette: 0.55, flash: k === 0 && f.a.kick > 0.9 ? 0.06 : 0, fade: f.p > 0.9 ? (f.p - 0.9) / 0.1 : 0 };
    }
  }

  /* 注册表：按 timeline 的 id / file 双键（prompt 的三个变体共用一个类，靠 params 区分） */
  const R = { Open, Loss, Prompt, Hook, Room, Shoggoth, Spacetime, Ascent, Bureau, LeftTurn, Paperclips, Fuse, Stack, Dense, Loom, Ilya, Outro };
  window.PD_SCENES = {};
  for (const [name, Cls] of Object.entries(R)) {
    window.PD_SCENES[name.toLowerCase()] = Cls;
    window.PD_SCENES[name.toLowerCase() + /(\d+)$/.exec(name)?.[1]] = Cls;
  }
  for (const k of ['prompt1', 'prompt2', 'prompt3', 'hook1', 'hook2', 'hook3', 'hook4']) {
    window.PD_SCENES[k] = R[k.startsWith('p') ? 'Prompt' : 'Hook'];
  }
})();
