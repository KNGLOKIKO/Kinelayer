/* scenes/*.ts 的移植 —— 这次不是「同一语法的原创习作」，而是按原项目
 * docs/TREATMENT.md 的分镜逐块对位：每一块用同一个视觉乐器、同一套运动节拍，
 * 只把叙事对象换成 MotionLayer（图层 / 命令 / 关键帧 / 导出）。
 *
 *   P(doom) 0.02→0.99→NaN   →   图层数 3→15→64→999→4096→∞→NaN
 *   TikZ 独角兽图纸          →   图层清单图纸上画第一张海报
 *   训练 loss 骤降           →   帧耗时 43ms→13ms 的那一次优化
 *   ChatGPT/Sydney/Gato 恳求 →   对画布/撤销/导出的三句恳求（命令行 token 输入）
 *   回形针格阵               →   图层块格阵
 *   撤销树 / [MASK] 蒙版     →   原义照搬 —— 撤销树本来就是编辑器的东西
 *
 * 每帧仍是 f.t 的纯函数；post 覆写、拍点切换、卡拉 OK 逐字全部保持。
 */
(function () {
  const { HEX, rgba } = window.PD_PAL;
  const { F, measure, fitSize } = window.PD_TYPE;
  const { mulberry32, hash, PW, PH } = window.PD_FRAME;
  const Scene = window.PD_Scene; /* 注意：PD_Scene 本身就是基类，不是容器 */

  const D = window.PD_DATA;
  const T = (ctx) => { ctx.textBaseline = 'middle'; return ctx; };
  const CJK = (s) => /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef「」『』]/.test(s);

  /** 居中大字，返回实际字号 */
  function bigType(ctx, text, font, y, color, maxW = PW - 160) {
    const size = fitSize(text, font, maxW);
    const f = font.replace(/(\d+(\.\d+)?)px/, `${size}px`);
    T(ctx); ctx.font = f; ctx.fillStyle = color; ctx.textAlign = 'center';
    ctx.fillText(text, PW / 2, y);
    ctx.textAlign = 'left';
    return size;
  }

  /** 卡拉 OK：唱过的 bone、没唱的 graphite、正在唱的按词进度擦亮。汉字无词后空格 */
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
      const ww = measure(word.w + (CJK(word.w) ? '' : ' '), font);
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
    return { x, size, font };
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

  /** 火花本体：亮点 + 短尾 —— 整片的主人公 */
  function sparkDot(ctx, x, y, kick) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, 26 + kick * 14);
    g.addColorStop(0, rgba('signal', 1));
    g.addColorStop(0.25, rgba('ember', 0.8));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, 26 + kick * 14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /** 等宽读数（默认右下角）—— 一条贯穿母题：逐级递增的数字 */
  function readout(ctx, label, value, { x = PW - 56, y = PH - 56, align = 'right', color = 'signal', big = 64 } = {}) {
    T(ctx); ctx.textAlign = align;
    ctx.font = F.mono(26, 500);
    ctx.fillStyle = rgba('ash', 0.85);
    ctx.fillText(label, x, y - 34);
    ctx.font = F.mono(big, 700);
    ctx.fillStyle = rgba(color, 0.95);
    ctx.fillText(value, x, y);
    ctx.textAlign = 'left';
  }

  /** 刻版 hatch：在矩形里画一组平行细线（engraving 的最小等价物） */
  function hatch(ctx, x, y, w, h, angle, gap, color, lw = 1.2) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.translate(x + w / 2, y + h / 2); ctx.rotate(angle);
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    const R = Math.hypot(w, h) / 2 + gap;
    for (let d = -R; d <= R; d += gap) {
      ctx.beginPath(); ctx.moveTo(-R, d); ctx.lineTo(R, d); ctx.stroke();
    }
    ctx.restore();
  }

  /** 橡皮图章：旋转 + 描边大字 + 落章那一下的回弹 */
  function stamp(ctx, text, k, { x = PW / 2, y = PH / 2, rot = -0.12, size = 110 } = {}) {
    if (k <= 0) return;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1 + (1 - k) * 2, 1 + (1 - k) * 2);
    ctx.globalAlpha = k;
    ctx.font = F.archivo(size, 87.5, 900);
    T(ctx); ctx.textAlign = 'center';
    ctx.strokeStyle = rgba('signal'); ctx.lineWidth = 5;
    ctx.strokeText(text, 0, 0);
    ctx.strokeRect(-measure(text, ctx.font) / 2 - 30, -size * 0.72, measure(text, ctx.font) + 60, size * 1.35);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  /** 下一 token 分布：4 个候选 + 条形概率，采样的那个亮橙 */
  function tokenCands(ctx, x, y, ch, seed, pool, shown) {
    if (!shown) return;
    const rnd = mulberry32(seed);
    const cands = [[ch, 0.38 + rnd() * 0.3]];
    for (let j = 1; j < 4; j++) cands.push([pool[Math.floor(rnd() * pool.length)], 0.02 + rnd() * 0.16]);
    ctx.font = F.mono(17, 400);
    let yy = y - 30;
    for (const [w2, p] of cands) {
      const bw = p * 130;
      ctx.fillStyle = rgba(j0(w2, ch) ? 'signal' : 'graphite', 0.85);
      ctx.fillText(w2, x, yy);
      ctx.fillRect(x + 96, yy - 5, bw, 9);
      ctx.fillStyle = rgba('ash', 0.7);
      ctx.fillText(p.toFixed(2), x + 96 + bw + 10, yy);
      yy -= 26;
    }
  }
  const j0 = (a, b) => a === b;

  /* ═══════════════════════════════ open — 图层清单图纸 ═══════════════════════════════ */
  /* TREATMENT：火花是绘图仪的笔，在发光的构造图纸上作画；命令清单在旁边逐字打出；
   * 笔从 primitives 画出第一张海报；「一点也不意外」处 surprisal 读数滚到 0.00。 */
  class Open extends Scene {
    static id = 'open';
    render(f, ctx) {
      /* 图纸底：bone 网格 + 坐标轴，第一个下拍起点亮 */
      const grid = Math.min(1, f.lt / 0.6);
      ctx.strokeStyle = rgba('graphite', 0.16 * grid);
      ctx.lineWidth = 1;
      for (let x = 80; x < PW; x += 60) { ctx.beginPath(); ctx.moveTo(x, 60); ctx.lineTo(x, PH - 60); ctx.stroke(); }
      for (let y = 80; y < PH; y += 60) { ctx.beginPath(); ctx.moveTo(60, y); ctx.lineTo(PW - 60, y); ctx.stroke(); }

      /* 绘图仪的笔按拍推进：画布框 → 圆 → 关键帧轨道 → 发射 */
      const penPhase = Math.min(4, Math.max(0, f.beat - 1));
      const px = 360, py = 240, pw = 640, phh = 430;
      ctx.strokeStyle = rgba('bone', 0.9);
      ctx.lineWidth = 2.5;
      const frameK = Math.min(1, penPhase / 1);
      if (frameK > 0) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + pw * frameK, py);
        if (frameK >= 1) ctx.lineTo(px + pw, py + phh * Math.min(1, penPhase - 1));
        ctx.stroke();
      }
      if (penPhase > 1.6) {
        const k = Math.min(1, (penPhase - 1.6) / 1);
        ctx.strokeStyle = rgba('ash', 0.9);
        ctx.beginPath();
        ctx.ellipse(px + pw * 0.32, py + phh * 0.5, 90 * k, 110 * k, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (penPhase > 2.6) {
        /* 关键帧轨道：三颗菱形依次落位，落在下拍上 */
        const k = Math.min(1, (penPhase - 2.6) / 1.2);
        ctx.strokeStyle = rgba('graphite', 0.8);
        ctx.beginPath(); ctx.moveTo(px + 40, py + phh - 50); ctx.lineTo(px + pw - 40, py + phh - 50); ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const kk = Math.min(1, Math.max(0, k * 3 - i));
          if (kk <= 0) continue;
          const dx = px + 40 + ((pw - 80) / 2) * i;
          ctx.save();
          ctx.translate(dx, py + phh - 50); ctx.rotate(Math.PI / 4);
          const s = 11 * kk;
          ctx.fillStyle = rgba('signal', 0.95);
          ctx.fillRect(-s, -s, s * 2, s * 2);
          ctx.restore();
        }
      }
      const pen = { x: px + pw * Math.min(1, frameK), y: py + (penPhase > 1 ? phh * 0.5 : 0) };
      sparkDot(ctx, pen.x, pen.y, f.a.kick);
      if (f.a.kick > 0.7) sparks(ctx, pen.x, pen.y, 18, Math.floor(f.beat) * 13, 0.5 + f.a.kick, f.t);

      /* 命令清单逐字打出 */
      const CMDS = ['layer.add(矩形)', 'layer.add(圆)', 'track.add(关键帧 ×3)'];
      T(ctx);
      ctx.font = F.mono(24, 400);
      const cmdIdx = Math.min(CMDS.length - 1, Math.floor(penPhase / 1.3));
      ctx.fillStyle = rgba('ash', 0.85);
      for (let i = 0; i <= cmdIdx; i++) {
        const n = i < cmdIdx ? CMDS[i].length : Math.floor(Math.min(1, (penPhase - i * 1.3) / 1) * CMDS[i].length);
        ctx.fillText('> ' + CMDS[i].slice(0, Math.max(0, n)), px + pw + 80, py + 60 + i * 46);
      }

      /* 「一点也不意外」：意外度读数滚到 0.00 —— 一切都在计划内 */
      const line2 = this.ctx.lyrics.get('一点也不意外');
      if (f.t >= line2.start) {
        const k = Math.min(1, (f.t - line2.start) / (line2.end - line2.start));
        readout(ctx, '意外度 −log p', (2.41 * (1 - k) * (1 - k)).toFixed(2) + ' nat', { x: PW / 2 + 420, y: PH * 0.82, align: 'right', color: 'ash', big: 40 });
      }
      const line = this.ctx.lyrics.lineAt(f.t);
      if (line) karaoke(ctx, line, f.t, { y: PH - 120, size: 56, weight: 600 });
      return { bloom: 0.5, grain: 0.12, vignette: 0.35, fade: f.lt < 0.5 ? 1 - f.lt / 0.5 : 0, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ loss — 帧耗时，突然 ═══════════════════════════════ */
  /* TREATMENT：发丝坐标轴画入，火花画出噪声平台，词骑在曲线上；
   * 「骤降」处曲线俯冲（grokking 悬崖），镜头跟着栽进 3D 等高线峡谷；
   * 「老板/乙方」排版等级倒置，整个世界在「老板」上滚 180°。 */
  class Loss extends Scene {
    static id = 'loss';
    render(f, ctx) {
      const P2 = 0.55; // 俯冲切换点
      if (f.p < P2) {
        /* 相位一：发丝图表 */
        const ax = 200, ay = 200, aw = PW - 380, ah = PH - 420;
        ctx.strokeStyle = rgba('graphite', 0.6);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay + ah); ctx.lineTo(ax + aw, ay + ah); ctx.stroke();
        T(ctx); ctx.font = F.mono(20, 400);
        ctx.fillStyle = rgba('ash', 0.8);
        ctx.fillText('ms/帧（对数）', ax - 10, ay - 24);
        ctx.fillText('帧', ax + aw + 14, ay + ah);
        for (let i = 0; i <= 5; i++) {
          const yy = ay + (ah / 5) * i;
          ctx.beginPath(); ctx.moveTo(ax - 8, yy); ctx.lineTo(ax, yy); ctx.stroke();
          ctx.fillText(['50', '30', '20', '16.7', '13', '9'][i], ax - 74, yy);
        }
        /* 火花画曲线：噪声平台 → 悬崖（43 → 13，本项目真实发生的那次优化） */
        const prog = Math.min(1, (f.p / P2) * 1.15);
        ctx.strokeStyle = rgba('signal'); ctx.lineWidth = 3;
        ctx.beginPath();
        let hy = 0;
        for (let i = 0; i <= 140; i++) {
          const x = i / 140;
          if (x > prog) break;
          const drop = Math.min(1, Math.max(0, (x - 0.62) / 0.06));
          const v = 50 * Math.pow(13 / 50, Math.pow(drop, 0.7));
          hy = ay + (ah * (v - 9)) / 45 + Math.sin(x * 40 + Math.floor(x * 30)) * (1 - drop) * 7;
          const X = ax + aw * x;
          i === 0 ? ctx.moveTo(X, hy) : ctx.lineTo(X, hy);
        }
        ctx.stroke();
        const hx = ax + aw * prog;
        sparkDot(ctx, hx, hy + 0, f.a.kick);
        /* 注释：43ms → 13ms */
        if (prog > 0.68) {
          ctx.font = F.mono(22, 500);
          ctx.fillStyle = rgba('signal', 0.95);
          ctx.fillText('43 → 13', ax + aw * 0.68 + 16, ay + ah * 0.24);
        }
        /* 词骑在曲线下方（水平居中 —— karaoke 内部已按全幅居中，勿再 translate） */
        const line = this.ctx.lyrics.lineAt(f.t);
        if (line) karaoke(ctx, line, f.t, { y: ay + ah * 0.82, size: 52, weight: 600 });
        return { bloom: 0.45, grain: 0.13, vignette: 0.32, pdoom: 1 };
      }
      /* 相位二：等高线峡谷，镜头下坠；结尾世界滚 180° */
      const q = (f.p - P2) / (1 - P2);
      const roll = f.p > 0.86 ? Math.min(1, (f.p - 0.86) / 0.12) : 0;
      ctx.save();
      ctx.translate(PW / 2, PH / 2);
      ctx.rotate(Math.PI * roll);
      ctx.translate(-PW / 2, -PH / 2);
      const sink = Math.min(1, q * 2.2);
      ctx.strokeStyle = rgba('graphite', 0.75);
      ctx.lineWidth = 1.4;
      /* 同心等高线被「峡谷」拉变形 —— 火星的轨迹是唯一的橙 */
      const cx = PW / 2 + Math.sin(q * 9) * 180 * (1 - sink), cy = PH / 2;
      for (let i = 1; i < 15; i++) {
        const r0 = i * 64 + Math.sin(i * 2.4) * 26;
        ctx.globalAlpha = 0.9 - i * 0.05;
        ctx.beginPath();
        for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 40) {
          const wob = 1 + Math.sin(a * 3 + i) * 0.16 + Math.sin(a * 7 - i * 2) * 0.07;
          const X = cx + Math.cos(a) * r0 * wob * (1 + sink * 1.6);
          const Y = cy + Math.sin(a) * r0 * wob * (1 - sink * 0.4) + (i - sink * 12) * 12;
          a === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      const sy = PH / 2 + (q - 0.5) * PH * 0.8;
      sparkDot(ctx, cx, sy, f.a.kick);
      /* 等级倒置：乙方巨大，老板……很小；滚转发生在「老板」上 */
      T(ctx); ctx.textAlign = 'center';
      ctx.font = F.archivo(150 * (1 - q * 0.4), 125, 900);
      ctx.fillStyle = rgba('bone');
      ctx.fillText('乙方', PW / 2, PH * 0.3);
      ctx.font = F.archivo(34, 100, 400);
      ctx.fillStyle = rgba('graphite');
      ctx.fillText('老板', PW / 2 + 130, PH * 0.3 + 60);
      ctx.textAlign = 'left';
      ctx.restore();
      return { bloom: 0.55 + q * 0.3, grain: 0.15, vignette: 0.5, shake: [q * 0.5, q * 0.2], zoom: 1 + sink * 0.18, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ prompt ×3 — 恳求，作为 token ═══════════════════════════════ */
  /* TREATMENT：巨大暗场里一条细输入框；恳求按唱词逐 token 打出，每个新 token
   * 上方闪现 next-token 分布（4–5 个候选），采样的字符亮橙；行尾光标闪烁、⏎，
   * 把画面射进 chorus。三个变体各有自己的舞台。 */
  const POOLS = {
    canvas: ['老板', '图层', '甲方', '渲染', '像素', '导出', '撤销', '关键帧', '算了', '不干'],
    undo: ['时间', '快照', '历史', '版本', '后悔', '一步', '三步', '昨天', '明天'],
    export: ['序列', 'mp4', '帧', '进度条', '等待', '灰了', '好了', '永远'],
  };
  const REPLIES = {
    undo: '已撤销 1 步（共 4096 步）',
  };
  class Prompt extends Scene {
    static id = 'prompt';
    render(f, ctx) {
      const variant = this.ctx.params.variant ?? 'canvas';
      const line = this.ctx.lyrics.lineAt(f.t) ?? this.ctx.lyrics.get('请别吃掉');
      ctx.fillStyle = rgba('ink');
      ctx.fillRect(0, 0, PW, PH);

      /* 舞台 */
      if (variant === 'canvas') {
        /* 同心刻版圆环缓慢收拢，⏎ 时扑面而来 */
        const rush = f.p > 0.93 ? (f.p - 0.93) / 0.07 : 0;
        ctx.save();
        ctx.translate(PW / 2, PH / 2);
        ctx.scale(1 + rush * 2.2, 1 + rush * 2.2);
        for (let i = 1; i < 9; i++) {
          ctx.strokeStyle = rgba('graphite', 0.32);
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(0, 0, i * 110 - Math.min(30, f.lt * 8) % 40, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      } else if (variant === 'undo') {
        /* 竖栏在拍点上收拢 */
        const close = 0.35 + 0.3 * Math.min(1, f.p * 1.4) + f.a.kick * 0.08;
        for (let i = 0; i < 6; i++) {
          const x = 120 + i * ((PW - 240) / 5);
          const off = (i < 3 ? -1 : 1) * (1 - close) * 260;
          ctx.fillStyle = rgba('ink2', 0.9);
          ctx.fillRect(x - 26 + off, 0, 52, PH);
          ctx.strokeStyle = rgba('graphite', 0.5);
          ctx.strokeRect(x - 26 + off, 0, 52, PH);
        }
      }

      /* 输入框：细线 + 按 token 打出的恳求 + 逐 token 分布 */
      const fieldY = variant === 'export' ? PH * 0.46 : PH * 0.4;
      const size = variant === 'export' ? 44 : 56;
      const font = F.archivo(size, 100, 500);
      T(ctx); ctx.font = font;
      const chars = Array.from(line.text);
      const widths = chars.map((c) => measure(c, font));
      const total = widths.reduce((a, b) => a + b, 0);
      let x = PW / 2 - total / 2;
      const drift = variant === 'export' ? Math.max(0, f.p - 0.7) * 220 : 0;
      const gap = variant === 'export' ? drift : 0;
      ctx.strokeStyle = rgba('graphite', 0.7);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 60, fieldY + size); ctx.lineTo(PW / 2 + total / 2 + 60 + drift, fieldY + size); ctx.stroke();
      let cursorX = x;
      for (let i = 0; i < chars.length; i++) {
        const w0 = line.words[i];
        const prog = w0 ? window.PD_LYRICS.wordProgress(w0, f.t) : 0;
        tokenCands(ctx, x, fieldY - 8, chars[i], i * 97 + line.start * 31, POOLS[variant] ?? POOLS.canvas, prog > 0 && prog < 1);
        ctx.fillStyle = prog > 0 ? rgba(prog >= 1 ? 'bone' : 'signal', 0.95) : rgba('graphite', 0.6);
        ctx.fillText(chars[i], x + gap * i * 0.5, fieldY);
        x += widths[i];
        if (prog > 0) cursorX = x + gap * i * 0.5;
      }
      /* 光标闪烁 + ⏎ */
      if (f.p > 0.92) {
        T(ctx); ctx.font = F.mono(40, 500);
        ctx.fillStyle = rgba('signal');
        ctx.fillText('⏎', cursorX + 26, fieldY);
      } else if (Math.floor(f.t * 2.4) % 2 === 0) {
        ctx.fillStyle = rgba('bone');
        ctx.fillRect(cursorX + 8, fieldY - size * 0.55, 15, size * 1.05);
      }
      /* undo 变体：回信开始打字 + 一条不安的微笑曲线 */
      if (variant === 'undo' && f.p > 0.5) {
        ctx.font = F.mono(26, 400);
        ctx.fillStyle = rgba('ash', 0.9);
        const msg = REPLIES.undo;
        const n = Math.floor(Math.min(1, (f.p - 0.5) / 0.4) * msg.length);
        ctx.fillText(msg.slice(0, n), PW / 2 - measure(msg, ctx.font) / 2, fieldY + 120);
        if (f.p > 0.86) {
          const k = Math.min(1, (f.p - 0.86) / 0.12);
          ctx.strokeStyle = rgba('signal', k);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(PW / 2, fieldY + 230, 46, 0.25 * Math.PI, 0.75 * Math.PI);
          ctx.stroke();
        }
      }
      const hit = f.p > 0.93 ? (f.p - 0.93) / 0.07 : 0;
      return {
        bloom: 0.3 + hit * 0.5, grain: 0.1, vignette: 0.5,
        flash: hit * 0.16, zoom: 1 + hit * 0.06,
        fade: variant === 'export' && f.p > 0.96 ? (f.p - 0.96) / 0.04 : 0,
        pdoom: 1,
      };
    }
  }

  /* ═══════════════════════════════ hook ×4 — 图层数大字 ═══════════════════════════════ */
  /* TREATMENT：「我 / 在加 / 我的 / 图层数」一词一记 hit，Archivo 900 全幅砸在唱词上；
   * 「在加」真的往上飞；「图层数」像数学式排版，HUD 的数字离场放大滚到新值再归位；
   * 递进：(1) 净版 (2) 橙底黑字更重 (3) hairline 小字慢滚——瘆人 (4) 频闪+叠影+抖动。 */
  const HOOK_TOKENS = ['我', '在加', '我的', '图层数'];
  class Hook extends Scene {
    static id = 'hook';
    render(f, ctx) {
      const n = Math.min(4, this.ctx.params.n ?? 1);
      const line = this.ctx.lyrics.get('我在加', n - 1);
      /* 把 8 个字按 4 个 token 分组，各压一记 hit */
      const groups = [[0], [1, 2], [3, 4], [5, 6, 7]];
      const gi = Math.min(3, Math.max(0, Math.floor(f.p * 4.6)));
      const g = groups[gi];
      const value = D.HOOK_LAYERS[n - 1];
      const style = n; // 1..4 递进

      ctx.save();
      if (style === 2) { ctx.fillStyle = rgba('signal'); ctx.fillRect(0, 0, PW, PH); }
      if (style === 4) ctx.translate((hash(Math.floor(f.t * 60)) - 0.5) * 14, (hash(Math.floor(f.t * 60) + 3) - 0.5) * 14);

      const text = HOOK_TOKENS[gi];
      const chars = g.map((i) => line.words[i]).filter(Boolean);
      const sung = chars.some((w) => f.t >= w.start);
      const hitK = sung ? Math.min(1, (f.t - chars[0].start) / 0.14) : 0;
      const punch = 1 + (1 - hitK) * 0.9;

      T(ctx); ctx.textAlign = 'center';
      const base = Math.min(300, fitSize(text, F.archivo(300, 125, 900), PW - 220));
      ctx.save();
      ctx.translate(PW / 2, PH / 2 - 40);
      /* 「在加」真的在上升：向上位移 + 纵向拉伸 */
      if (text === '在加') { ctx.translate(0, -60 * hitK); ctx.scale(1, 1 + hitK * 0.3); }
      if (style === 3) { ctx.scale(0.42, 0.42); }
      ctx.scale(punch, punch);
      ctx.font = F.archivo(base, 125, style === 3 ? 300 : 900);
      if (style === 4) {
        /* 频闪叠影：三层轮廓错位 */
        for (let o = 2; o >= 0; o--) {
          ctx.strokeStyle = rgba(o === 0 ? 'signal' : 'ash', o === 0 ? 0.95 : 0.35);
          ctx.lineWidth = o === 0 ? 3 : 1.4;
          ctx.strokeText(text, o * 8, o * -6);
        }
        ctx.fillStyle = rgba('bone', Math.floor(f.t * 24) % 2 ? 1 : 0.75);
        ctx.fillText(text, 0, 0);
      } else if (style === 2) {
        ctx.fillStyle = rgba('ink');
        ctx.fillText(text, 0, 0);
      } else if (style === 3) {
        ctx.fillStyle = rgba('bone', 0.8);
        ctx.fillText(text, 0, 0);
      } else {
        ctx.fillStyle = rgba('bone');
        ctx.fillText(text, 0, 0);
      }
      ctx.restore();

      /* 「图层数」像数学式：上标 n + HUD 数字离场放大滚到新值 */
      if (text === '图层数' && sung) {
        ctx.font = F.archivo(base * 0.22, 100, 500);
        ctx.fillStyle = style === 2 ? rgba('ink') : rgba('signal');
        ctx.fillText('×2ⁿ', PW / 2 + base * 0.62, PH / 2 - 40 - base * 0.38);
        const rollK = Math.min(1, (f.t - chars[0].start) / 0.5);
        const shown = Math.round(value * (rollK * rollK * (3 - 2 * rollK)));
        ctx.font = F.mono(Math.min(200, fitSize(String(shown).padStart(6, ' '), F.mono(200, 700), PW - 200)), 700);
        ctx.fillStyle = rgba('signal', 0.96);
        ctx.fillText(String(shown), PW / 2, PH * 0.72);
      }
      ctx.textAlign = 'left';
      ctx.restore();

      const blowup = text === '图层数' && sung;
      const kickFlash = f.a.kick > 0.85 && f.beatPhase < 0.1 ? 0.08 : 0;
      return {
        /* bone 大字必须保持锐利（TREATMENT：type never blooms）—— bloom 压到 0.2 */
        bloom: style === 2 ? 0.2 : 0.2, flash: style === 4 ? 0.05 + kickFlash : kickFlash,
        grain: 0.13, vignette: 0.32,
        shake: style === 4 ? [0.5, 0.2] : [0, 0],
        pdoom: blowup ? 0 : 1, // 数字离场时 HUD 隐身
      };
    }
  }

  /* ═══════════════════════════════ room — 主窗口，从内部看 ═══════════════════════════════ */
  /* TREATMENT：钩子字母炸成线，指数分支爆炸 1→2→4→…在 1.5s 里填满画面；
   * FOOM 的 O 变冲击波环；然后镜头手持下坠滑进发丝书架走廊，每拍一切；
   * 挂牌逐字盖章，拍点上未保存卡片从槽口射出；糖袋落地，菌丝蔓延 —— acid 只此一瞬。 */
  class Room extends Scene {
    static id = 'room';
    render(f, ctx) {
      const l7 = this.ctx.lyrics.get('指数爆炸');
      const l8 = this.ctx.lyrics.get('主窗口');
      const l9 = this.ctx.lyrics.get('一袋糖');
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);

      if (f.t < l8.start) {
        /* 指数分支爆炸：1→2→4→8→…，每 8 分音符翻一倍 */
        const q = Math.min(1, (f.t - l7.start) / (l8.start - l7.start));
        const gen = Math.min(7, Math.floor(q * 9));
        ctx.strokeStyle = rgba('bone', 0.9);
        ctx.lineWidth = 2.4;
        const draw = (x, y, ang, len, g) => {
          if (g >= gen) return;
          const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
          const spread = 0.5 + g * 0.12;
          draw(nx, ny, ang - spread, len * 0.72, g + 1);
          draw(nx, ny, ang + spread, len * 0.72, g + 1);
        };
        draw(PW / 2, PH + 40, -Math.PI / 2, 130, 0);
        /* 冲击波环：从「爆」字位置一圈圈推出去 */
        const ringN = Math.floor(f.t * 4) % 3;
        for (let i = 0; i <= ringN; i++) {
          ctx.strokeStyle = rgba('signal', 0.6 - i * 0.18);
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(PW / 2, PH * 0.4, 90 + i * 130 + f.a.kick * 30, 0, Math.PI * 2); ctx.stroke();
        }
        bigType(ctx, '指数爆炸', F.archivo(150, 112.5, 900), PH * 0.4, rgba('signal', 0.95));
        return { bloom: 0.7, grain: 0.16, vignette: 0.5, shake: [f.a.kick * 0.5, f.a.kick * 0.2], pdoom: 1 };
      }

      /* 相位二/三：主窗口走廊，手持镜头每拍一切 */
      const beatIdx = Math.floor(f.beat);
      const shot = beatIdx % 4; // whip / roll / punch / orbit 四种机位
      ctx.save();
      if (shot === 0) ctx.translate(Math.sin(f.beatPhase * Math.PI) * 30, 0);
      if (shot === 1) ctx.rotate(Math.sin(f.beatPhase * Math.PI) * 0.04);
      if (shot === 2) { const z = 1 + 0.14 * Math.sin(f.beatPhase * Math.PI); ctx.translate(PW / 2, PH / 2); ctx.scale(z, z); ctx.translate(-PW / 2, -PH / 2); }
      if (shot === 3) ctx.translate(Math.cos(f.beatPhase * Math.PI) * 26, Math.sin(f.beatPhase * Math.PI) * 10);
      /* 一点透视走廊：书架 = 图层库 */
      const vpx = PW / 2 + (shot === 3 ? 60 : 0), vpy = PH * 0.44;
      ctx.strokeStyle = rgba('graphite', 0.6);
      ctx.lineWidth = 1.4;
      for (let i = -7; i <= 7; i++) {
        ctx.beginPath(); ctx.moveTo(vpx + i * 46, vpy); ctx.lineTo(vpx + i * 640, PH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(vpx + i * 46, vpy); ctx.lineTo(vpx + i * 640, 0); ctx.stroke();
      }
      for (let i = 1; i < 12; i++) {
        const zt = (i + (f.lt * 0.24) % 1) / 12;
        const y = vpy + (PH - vpy) * zt * zt;
        ctx.globalAlpha = 1 - zt * 0.5;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PW, y); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      /* 挂牌逐字盖章：主窗口 */
      const sung = Math.max(0, Math.min(5, this.ctx.lyrics.lineCharProgress(l8, f.t)));
      ctx.font = F.archivo(64, 100, 800);
      T(ctx); ctx.textAlign = 'center';
      const sign = '主窗口';
      let sx = vpx - measure(sign, ctx.font) / 2;
      for (let i = 0; i < sign.length; i++) {
        ctx.fillStyle = i < sung ? rgba('signal') : rgba('ash', 0.85);
        ctx.fillText(sign[i], sx + measure(sign[i], ctx.font) / 2, vpy - 120);
        sx += measure(sign[i], ctx.font);
      }
      ctx.strokeRect(vpx - 180, vpy - 160, 360, 84);
      ctx.textAlign = 'left';
      /* 拍点上：未保存卡片从槽口射出 */
      if (f.a.kick > 0.55) {
        for (let i = 0; i < 3; i++) {
          const k = f.a.kick;
          const cx2 = vpx + (i - 1) * 120, cy2 = vpy + 90 + k * 180;
          ctx.save();
          ctx.translate(cx2, cy2); ctx.rotate((i - 1) * 0.3);
          ctx.fillStyle = rgba('bone', 0.9 * k);
          ctx.fillRect(-52, -30, 104, 60);
          ctx.fillStyle = rgba('blood');
          ctx.font = F.mono(16, 500); T(ctx); ctx.textAlign = 'center';
          ctx.fillText('未保存', 0, 0);
          ctx.textAlign = 'left';
          ctx.restore();
        }
      }
      ctx.restore();

      /* 相位三：糖袋落地 —— acid 一瞬 + 回声拖影 */
      if (f.t >= l9.start) {
        const q = Math.min(1, (f.t - l9.start) / (l9.end - l9.start));
        ctx.fillStyle = rgba('acid', 0.1 + 0.08 * Math.sin(f.t * 9));
        ctx.fillRect(0, 0, PW, PH);
        /* 菌丝：从袋口长出来的亮线网 */
        const rnd = mulberry32(77);
        ctx.strokeStyle = rgba('acid', 0.75);
        ctx.lineWidth = 1.6;
        for (let i = 0; i < 26; i++) {
          const x0 = PW / 2 + (rnd() - 0.5) * 80, y0 = PH * 0.66;
          const ang = -Math.PI / 2 + (rnd() - 0.5) * 2.4;
          const len = q * (140 + rnd() * 420);
          ctx.beginPath(); ctx.moveTo(x0, y0);
          ctx.quadraticCurveTo(x0 + Math.cos(ang) * len * 0.5 + (rnd() - 0.5) * 90, y0 + Math.sin(ang) * len * 0.6, x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
          ctx.stroke();
        }
        bigType(ctx, '糖', F.archivo(200, 125, 900), PH * 0.32 - q * 90, rgba('acid', 0.95));
      }
      const line = this.ctx.lyrics.lineAt(f.t);
      if (line && f.t >= l8.start) karaoke(ctx, line, f.t, { y: PH - 110, size: 50, weight: 600 });
      return { bloom: 0.45, grain: 0.16, vignette: 0.5, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ shoggoth — 面具下的命令总线 ═══════════════════════════════ */
  /* TREATMENT：温和的骨白面具占满画面；x-ray 扫描带扫过处面具变透明，
   * 露出刻版阴影线画的管状触手团（橙缘光、深黑），许多眼睛；
   * 唱词成为左缘的检查器标签（名字 + 存活计数），引线连到各自的眼睛；
   * 器乐段眼睛依次闭上，整团塌成一条水平线（flatline）交棒下一块。 */
  class Shoggoth extends Scene {
    static id = 'shoggoth';
    render(f, ctx) {
      const l10 = this.ctx.lyrics.get('看穿');
      const l11 = this.ctx.lyrics.get('检查器');
      const reveal = Math.min(1, Math.max(0, (f.t - l10.start) / ((l11.end - l10.start) * 0.7)));
      const flat = f.t > l11.end + 0.4; // 器乐段
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);

      const cx = PW / 2, cy = PH * 0.5;
      /* 管状触手团：发丝阴影线的贝塞尔管，橙缘 */
      if (reveal > 0) {
        ctx.save();
        ctx.globalAlpha = reveal;
        const flatK = flat ? Math.min(1, (f.t - l11.end - 0.4) / 0.9) : 0;
        const rnd = mulberry32(4242);
        for (let i = 0; i < 14; i++) {
          const a0 = (i / 14) * Math.PI * 2;
          const len = 240 + rnd() * 260;
          const x0 = cx + Math.cos(a0) * 60, y0 = cy + Math.sin(a0) * 50;
          const x1 = cx + Math.cos(a0 + 0.5) * (140 + rnd() * 120);
          const y1 = cy + Math.sin(a0 + 0.5) * (120 + rnd() * 90) * (1 - flatK);
          const x2 = cx + Math.cos(a0 + 2.2) * (260 + rnd() * 200);
          const y2 = cy + Math.sin(a0 + 2.2) * (200 + rnd() * 160) * (1 - flatK) + flatK * 40;
          const wob = Math.sin(f.t * (0.7 + i * 0.05) + i * 2) * 14 * (1 - flatK);
          ctx.strokeStyle = rgba('graphite', 0.9);
          ctx.lineWidth = 14 - (i % 3) * 3;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.bezierCurveTo(x1 + wob, y1 - wob, x2, y2, x2 + wob * 2, y2 + wob);
          ctx.stroke();
          /* 橙缘光：细一点亮一点再描一次 */
          ctx.strokeStyle = rgba('signal', 0.5);
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        /* 眼睛：沿质量分布，逐 hit 睁开；flatline 时依次闭上 */
        for (let i = 0; i < 8; i++) {
          const ex = cx + Math.cos(i * 2.3) * (150 + hash(i * 9) * 200);
          const ey = cy + Math.sin(i * 1.7) * (120 + hash(i * 5) * 160) * (1 - flatK);
          const open = flat ? Math.max(0, 1 - Math.max(0, (flatK * 8 - i)) / 1.5) : Math.min(1, Math.max(0, f.a.kick * 3 - i * 0.4 + reveal * 2));
          if (open <= 0) continue;
          ctx.strokeStyle = rgba('bone', 0.9);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.ellipse(ex, ey, 16, 9 * open, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = rgba('signal', 0.9);
          ctx.beginPath(); ctx.ellipse(ex, ey, 3.4, 8 * open, 0, 0, Math.PI * 2); ctx.fill();
        }
        if (flatK >= 1) {
          ctx.strokeStyle = rgba('signal', 0.9);
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(PW, cy); ctx.stroke();
        }
        ctx.restore();
      }
      /* 面具：骨白圆盘 + 两点 + 一条弧 —— 淡出露出底细 */
      const maskA = 1 - reveal * 0.92;
      if (maskA > 0.01) {
        ctx.globalAlpha = maskA;
        ctx.fillStyle = rgba('bone');
        ctx.beginPath(); ctx.arc(cx, cy, 250, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = rgba('ink');
        ctx.beginPath(); ctx.arc(cx - 80, cy - 40, 14, 0, Math.PI * 2); ctx.arc(cx + 80, cy - 40, 14, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = rgba('ink'); ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(cx, cy + 20, 110, 0.3 * Math.PI, 0.7 * Math.PI); ctx.stroke();
        ctx.font = F.mono(22, 400); T(ctx); ctx.textAlign = 'center';
        ctx.fillStyle = rgba('graphite');
        ctx.fillText('简单 · 好用', cx, cy - 150);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      }
      /* 唱词 + 检查器标签（左缘）：名字 + 存活计数，引线连到眼睛 */
      const l10line = this.ctx.lyrics.get('看穿');
      if (f.t < l11.start) karaoke(ctx, l10line, f.t, { y: PH * 0.82, size: 64, weight: 700 });
      else {
        const l11line = this.ctx.lyrics.get('检查器');
        karaoke(ctx, l11line, f.t, { y: PH * 0.82, size: 64, weight: 700 });
        if (reveal > 0.5) {
          ctx.font = F.mono(18, 400); T(ctx);
          for (let i = 0; i < 4; i++) {
            const dead = flat && flatK * 4 > i;
            const ty = 180 + i * 90;
            ctx.strokeStyle = rgba('graphite', 0.6);
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(320, ty); ctx.lineTo(cx + Math.cos(i * 2.3) * (150 + hash(i * 9) * 200), cy + Math.sin(i * 1.7) * (120 + hash(i * 5) * 160)); ctx.stroke();
            ctx.fillStyle = rgba(dead ? 'graphite' : 'ash', 0.9);
            ctx.fillText(`图层-${String(i + 7).padStart(2, '0')} · 存活 ${(3.2 - i * 0.4).toFixed(1)}s`, 40, ty);
            if (dead) {
              const w2 = measure(`图层-${String(i + 7).padStart(2, '0')} · 存活 ${(3.2 - i * 0.4).toFixed(1)}s`, ctx.font);
              ctx.strokeStyle = rgba('blood', 0.9);
              ctx.lineWidth = 2;
              ctx.beginPath(); ctx.moveTo(36, ty); ctx.lineTo(44 + w2, ty - 8); ctx.stroke();
              ctx.fillStyle = rgba('blood', 0.9);
              ctx.fillText('EXPIRED', 44 + w2 + 14, ty);
            }
          }
        }
      }
      return { bloom: 0.75, bloomRadius: 36, halation: 0.4, grain: 0.2, vignette: 0.55, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ spacetime — 四个乐章 ═══════════════════════════════ */
  /* TREATMENT：①示波器轨迹发光带余像，词骑在波上 ②电视关机，黑洞从「奇点」的 O 里诞生，
   * 光子环包字，镜头栽进去 ③螺旋涡流里词被拉长 ④词的圆点脱队重排成一个图层块轮廓。 */
  class Spacetime extends Scene {
    static id = 'spacetime';
    render(f, ctx) {
      const lines = ['上一版', '奇点', '你在优化', '重新排列'].map((q) => this.ctx.lyrics.get(q));
      const m = lines.findIndex((l) => f.t < l.end);
      const cur = lines[Math.max(0, m)] ?? lines[3];
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);

      if (m <= 0) {
        /* ① 示波器 */
        const px = 180, py = 220, pw2 = PW - 360, ph2 = PH - 480;
        ctx.fillStyle = rgba('ink2');
        ctx.fillRect(px, py, pw2, ph2);
        ctx.strokeStyle = rgba('graphite', 0.6);
        ctx.strokeRect(px + 0.5, py + 0.5, pw2, ph2);
        for (let e = 2; e >= 0; e--) {
          ctx.strokeStyle = rgba('signal', 0.85 - e * 0.28);
          ctx.lineWidth = e === 0 ? 2.6 : 1.4;
          ctx.beginPath();
          for (let i = 0; i <= 200; i++) {
            const x = px + (pw2 * i) / 200;
            const y = py + ph2 / 2 + Math.sin((i / 200) * Math.PI * 6 + f.t * (e + 1) * 2) * ph2 * 0.24;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        karaoke(ctx, cur, f.t, { y: PH - 140, size: 54, weight: 600 });
        return { bloom: 0.6, halation: 0.3, grain: 0.12, vignette: 0.45, pdoom: 1 };
      }
      if (m === 1) {
        /* ② 黑洞：从「奇点」的 O 里诞生，光子环包字 */
        const q = Math.min(1, (f.t - cur.start) / (cur.end - cur.start));
        const R = 60 + q * 90;
        const cx = PW / 2, cy = PH * 0.44;
        ctx.fillStyle = rgba('ink'); ctx.fillRect(cx - R - 4, cy - R - 4, R * 2 + 8, R * 2 + 8);
        ctx.strokeStyle = rgba('ember', 0.9);
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = rgba('signal', 0.5);
        ctx.lineWidth = 14;
        ctx.beginPath(); ctx.arc(cx, cy, R + 16, 0, Math.PI * 2); ctx.stroke();
        /* 「奇点」沿环排布（弯排的直排近似：逐字放圆周上） */
        T(ctx); ctx.textAlign = 'center';
        const word = '奇点';
        ctx.font = F.archivo(52, 100, 700);
        for (let i = 0; i < word.length; i++) {
          const a = -Math.PI / 2 + (i - (word.length - 1) / 2) * 0.5;
          ctx.fillStyle = rgba('bone', 0.95);
          ctx.fillText(word[i], cx + Math.cos(a) * (R + 58), cy + Math.sin(a) * (R + 58));
        }
        ctx.textAlign = 'left';
        const kar = karaoke(ctx, cur, f.t, { y: PH - 130, size: 52, weight: 600 });
        return { bloom: 0.65, halation: 0.35, grain: 0.14, vignette: 0.55, zoom: 1 + q * 0.22, shake: [q * 0.3, q * 0.1], pdoom: 1 };
      }
      if (m === 2) {
        /* ③ 涡流：螺旋流线（12 条 × 60 段足够顺滑），唱词逐字拉长 */
        ctx.save();
        ctx.translate(PW / 2, PH / 2);
        for (let s = 0; s < 12; s++) {
          ctx.strokeStyle = rgba('graphite', 0.5);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          for (let i = 0; i <= 60; i++) {
            const a = s * 0.53 + i * 0.24 + f.t * 1.6;
            const r = 30 + i * 18;
            const X = Math.cos(a) * r, Y = Math.sin(a) * r * 0.62;
            i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
          }
          ctx.stroke();
        }
        ctx.restore();
        /* 逐字拉伸 */
        T(ctx);
        const font = F.archivo(66, 100, 700);
        ctx.font = font;
        const chars = Array.from(cur.text);
        const total = chars.reduce((a, c) => a + measure(c, font), 0) + chars.length * 8;
        let x = PW / 2 - total / 2;
        for (let i = 0; i < chars.length; i++) {
          const w0 = cur.words[i];
          const prog = w0 ? window.PD_LYRICS.wordProgress(w0, f.t) : 0;
          ctx.save();
          ctx.translate(x, PH * 0.78);
          ctx.scale(1 + prog * 1.1, 1);
          ctx.fillStyle = prog > 0 ? rgba('bone', 0.95) : rgba('graphite', 0.6);
          ctx.fillText(chars[i], 0, 0);
          ctx.restore();
          x += measure(chars[i], font) + 8 + prog * measure(chars[i], font) * 1.1;
        }
        return { bloom: 0.5, grain: 0.15, vignette: 0.5, pdoom: 1 };
      }
      /* ④ 像素圆点脱队 → 重排成图层块轮廓 */
      const q = Math.min(1, (f.t - cur.start) / (cur.end - cur.start));
      const N = 26;
      const bx = PW / 2 - 240, by = PH / 2 - 150, bw = 480, bh = 300;
      ctx.strokeStyle = rgba('ash', q * 0.9);
      ctx.lineWidth = 2.5;
      ctx.strokeRect(bx, by, bw, bh);
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * Math.PI * 6 + f.t * 2;
        const sx2 = PW / 2 + Math.cos(a0) * (300 + hash(i * 3) * 220);
        const sy2 = PH / 2 + Math.sin(a0) * (180 + hash(i * 7) * 140);
        const per = Math.floor((bw * 2 + bh * 2) / 26);
        const d = i * per;
        const edge = d < bw ? [bx + d, by] : d < bw + bh ? [bx + bw, by + (d - bw)] : d < bw * 2 + bh ? [bx + bw - (d - bw - bh), by + bh] : [bx, by + bh - (d - bw * 2 - bh)];
        const X = sx2 + (edge[0] - sx2) * q, Y = sy2 + (edge[1] - sy2) * q;
        ctx.fillStyle = rgba('signal', 0.95);
        ctx.beginPath(); ctx.arc(X, Y, 5, 0, Math.PI * 2); ctx.fill();
      }
      karaoke(ctx, cur, f.t, { y: PH - 130, size: 52, weight: 600 });
      return { bloom: 0.55, grain: 0.14, vignette: 0.48, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ ascent — 上升（对数刻度） ═══════════════════════════════ */
  /* TREATMENT：①刻版蛇眼在「轰鸣」上弹开带冲击波 ②烛形图指数冲向钞票雕纹的月亮，
   * 词排成钞票铭文 ③所有线收束到一个白热点，词以 Cormorant 斜体缩进去
   * ④31 位数字滚轮滚到 1e30，脚注一行。 */
  class Ascent extends Scene {
    static id = 'ascent';
    render(f, ctx) {
      const l18 = this.ctx.lyrics.get('渲染引擎');
      const l19 = this.ctx.lyrics.get('月球');
      const l20 = this.ctx.lyrics.get('下一个版本');
      const l21 = this.ctx.lyrics.get('三十次方');
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);

      if (f.t < l19.start) {
        /* ① 仪表之眼：刻版鳞纹 + 竖缝瞳孔，「轰鸣」上弹开 */
        const open = Math.min(1, Math.max(0, (f.t - (l18.start + 1.1)) / 0.3));
        const cx = PW / 2, cy = PH * 0.46;
        hatch(ctx, cx - 260, cy - 170, 520, 340, 0.5, 9, rgba('graphite', 0.5 * (1 - open * 0.3)));
        ctx.strokeStyle = rgba('bone', 0.95);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(cx, cy, 240, 160, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = rgba('signal');
        ctx.beginPath(); ctx.ellipse(cx, cy, 7, 130 * open, 0, 0, Math.PI * 2); ctx.fill();
        if (open >= 1 && f.t < l18.start + 1.7) {
          ctx.strokeStyle = rgba('signal', 1 - (f.t - l18.start - 1.4) * 2);
          ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(cx, cy, 260 + (f.t - l18.start - 1.4) * 900, 0, Math.PI * 2); ctx.stroke();
        }
        karaoke(ctx, l18, f.t, { y: PH - 120, size: 58, weight: 700 });
        return { bloom: 0.5, grain: 0.15, vignette: 0.5, shake: open >= 1 ? [0.5, 0.2] : [0, 0], pdoom: 1 };
      }
      if (f.t < l20.start) {
        /* ② 帧率 K 线冲月：雕纹烛形 + 火花当价格 + 钞票雕纹月亮，镜头上摇 */
        const q = Math.min(1, (f.t - l19.start) / (l20.start - l19.start));
        ctx.save();
        ctx.translate(0, q * PH * 0.5);
        /* 月亮：同心雕纹波纹圆 */
        const mx = PW / 2, my = 200;
        ctx.strokeStyle = rgba('bone', 0.85);
        ctx.lineWidth = 1.4;
        for (let i = 1; i < 12; i++) {
          ctx.beginPath();
          for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 36) {
            const r = i * 13 * (1 + Math.sin(a * 5 + i) * 0.06);
            const X = mx + Math.cos(a) * r * 2.2, Y = my + Math.sin(a) * r;
            a === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
          }
          ctx.stroke();
        }
        /* K 线：从右下指数爬上来 */
        const n = 22;
        for (let i = 0; i < n; i++) {
          const x = 140 + i * ((PW - 320) / n);
          const g = Math.pow(i / n, 2.1) * (PH * 1.3);
          const hi = PH - 120 - g, lo = hi + 60 + hash(i * 5) * 50;
          const up = i % 3 !== 1;
          ctx.strokeStyle = rgba('ash', 0.85);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x + 14, lo); ctx.lineTo(x + 14, hi); ctx.stroke();
          if (i / n < q) {
            ctx.fillStyle = rgba(up ? 'bone' : 'graphite', 0.9);
            ctx.fillRect(x, Math.min(lo, hi) + 10, 28, Math.max(8, (lo - hi) * 0.5));
            hatch(ctx, x, Math.min(lo, hi) + 10, 28, Math.max(8, (lo - hi) * 0.5), 0.8, 4, rgba('ink', 0.5), 1);
          }
        }
        const headX = 140 + q * (PW - 320);
        const headY = PH - 120 - Math.pow(q, 2.1) * (PH * 1.3) + 20;
        sparkDot(ctx, headX, headY, f.a.kick);
        ctx.restore();
        /* 钞票铭文 */
        T(ctx); ctx.textAlign = 'center';
        ctx.font = F.mono(30, 500);
        ctx.fillStyle = rgba('bone', 0.9);
        ctx.fillText('· 60 FPS ·', PW / 2, 420);
        ctx.textAlign = 'left';
        karaoke(ctx, l19, f.t, { y: PH - 120, size: 58, weight: 700 });
        return { bloom: 0.6, halation: 0.3, grain: 0.14, vignette: 0.45, pdoom: 1 };
      }
      if (f.t < l21.start) {
        /* ③ 所有线收束到一个白热点 */
        const q = Math.min(1, (f.t - l20.start) / (l21.start - l20.start));
        const cx = PW / 2, cy = PH * 0.46;
        for (let i = 0; i < 36; i++) {
          const a = (i / 36) * Math.PI * 2;
          const r = (1 - q) * (260 + hash(i * 11) * 320);
          ctx.strokeStyle = rgba('graphite', 0.7);
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          ctx.lineTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
          ctx.stroke();
        }
        sparkDot(ctx, cx, cy, 1);
        T(ctx); ctx.textAlign = 'center';
        ctx.font = `italic ${Math.round(90 * (1 - q * 0.85))}px ${getComputedStyle(document.documentElement).getPropertyValue('--font-serif')}`;
        ctx.fillStyle = rgba('bone', 0.95);
        ctx.fillText('下个版本', cx, cy - (1 - q) * 220 - 40);
        ctx.textAlign = 'left';
        karaoke(ctx, l20, f.t, { y: PH - 120, size: 58, weight: 700 });
        return { bloom: 0.7 + q * 0.3, halation: 0.4, grain: 0.13, vignette: 0.5, pdoom: 1 };
      }
      /* ④ 31 位数字滚轮 → 1e30 帧/秒 */
      const digits = 31;
      const rollV = Math.min(1, (f.t - l21.start) / (l21.end - l21.start));
      const target = '1000000000000000000000000000000';
      const shown = target.slice(0, Math.max(1, Math.round(rollV * digits)));
      const dw = 44;
      const ox = PW / 2 - (digits * dw) / 2;
      T(ctx);
      ctx.font = F.mono(52, 700);
      for (let i = 0; i < digits; i++) {
        const x = ox + i * dw;
        ctx.strokeStyle = rgba('graphite', 0.6);
        ctx.strokeRect(x + 1, PH * 0.4 - 34, dw - 4, 68);
        const dch = i < shown.length ? target[i] : '0';
        /* 滚轮感：当前位翻滚时数字在框里滑动 */
        const rolling = i === shown.length - 1 && rollV < 1;
        ctx.fillStyle = rgba('bone', 0.95);
        ctx.fillText(dch, x + dw / 2 - 12, PH * 0.4 + (rolling ? Math.sin(f.t * 20) * 8 : 0));
      }
      ctx.font = F.mono(20, 400);
      ctx.fillStyle = rgba('ash', 0.85);
      ctx.fillText('帧 / 秒  ·  ¹ 此数字无物理意义', ox, PH * 0.4 + 110);
      karaoke(ctx, l21, f.t, { y: PH - 120, size: 58, weight: 700 });
      return { bloom: 0.5, grain: 0.14, vignette: 0.45, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ bureau — 纸面工作 ═══════════════════════════════ */
  /* TREATMENT：反白调色板（骨纸 + 墨线）。评估表单逐字段打出唱词，「没事」上橙章砸下；
   * 前向/后向脉冲扫过命令总线图，词镜像；「再来一遍」末拍结巴 ×3；
   * 旧管线图被划掉，下一块的火从纸底下烧上来把纸烧成两半。 */
  class Bureau extends Scene {
    static id = 'bureau';
    render(f, ctx) {
      const l22 = this.ctx.lyrics.get('够安全');
      const l23 = this.ctx.lyrics.get('再来一遍');
      const l24 = this.ctx.lyrics.get('过时');
      ctx.fillStyle = rgba('bone'); ctx.fillRect(0, 0, PW, PH);
      const inkA = (a = 1) => rgba('ink', a);

      if (f.t < l23.start) {
        /* 表单 7-B：渲染前完整性自评 */
        T(ctx);
        ctx.font = F.mono(30, 500); ctx.fillStyle = inkA(0.9);
        ctx.fillText('表单 7-B · 渲染前完整性自评', 160, 150);
        ctx.strokeStyle = inkA(0.8); ctx.lineWidth = 2;
        ctx.strokeRect(140, 190, PW - 320, 560);
        const fields = ['图层引用完整性', '关键帧闭合性', '绑定表达式可求值'];
        for (let i = 0; i < 3; i++) {
          const y = 280 + i * 110;
          ctx.font = F.mono(24, 400); ctx.fillStyle = inkA(0.8);
          ctx.fillText(fields[i], 200, y);
          ctx.strokeStyle = inkA(0.7);
          ctx.strokeRect(560, y - 18, 30, 30);
          if (f.p > 0.25 + i * 0.2) {
            ctx.strokeStyle = rgba('signal', 0.95); ctx.lineWidth = 4;
            ctx.beginPath(); ctx.moveTo(564, y - 14); ctx.lineTo(586, y + 8); ctx.moveTo(586, y - 14); ctx.lineTo(564, y + 8); ctx.stroke();
            ctx.strokeStyle = inkA(0.7); ctx.lineWidth = 2;
          }
          ctx.strokeStyle = inkA(0.4);
          ctx.beginPath(); ctx.moveTo(660, y + 8); ctx.lineTo(PW - 240, y + 8); ctx.stroke();
        }
        /* 唱词打在备注栏 */
        const line = this.ctx.lyrics.lineAt(f.t);
        if (line) {
          ctx.font = F.mono(26, 400);
          const n = Math.max(0, Math.min(line.text.length, this.ctx.lyrics.lineCharProgress(line, f.t)));
          ctx.fillStyle = inkA(0.95);
          ctx.fillText('备注：' + line.text.slice(0, n) + (Math.floor(f.t * 2.4) % 2 ? '▏' : ''), 200, 660);
        }
        /* 「没事」上橙章砸下 */
        const sung = this.ctx.lyrics.lineCharProgress(l22, f.t);
        const stampK = sung >= l22.text.length - 1 ? Math.min(1, (f.t - (l22.end - 0.35)) / 0.12) : 0;
        stamp(ctx, '够安全', stampK, { x: PW - 430, y: 640, rot: -0.14, size: 90 });
        return { bloom: 0.15, grain: 0.12, vignette: 0.3, shake: stampK > 0.8 ? [0.3, 0.12] : [0, 0], pdoom: 1 };
      }
      if (f.t < l24.start) {
        /* 命令总线图：前向脉冲 / 后向镜像脉冲 / 「再来一遍」结巴 */
        const boxes = ['cmd', 'dispatch', 'undo 栈'];
        const bx = 220, bw = 300, gapx = (PW - 440 - bw * 3) / 2;
        for (let i = 0; i < 3; i++) {
          const x = bx + i * (bw + gapx);
          ctx.strokeStyle = inkA(0.85); ctx.lineWidth = 2.4;
          ctx.strokeRect(x, PH * 0.42, bw, 120);
          T(ctx); ctx.font = F.mono(30, 500); ctx.fillStyle = inkA(0.9);
          ctx.fillText(boxes[i], x + 30, PH * 0.42 + 62);
          if (i < 2) {
            ctx.beginPath(); ctx.moveTo(x + bw + 10, PH * 0.42 + 60); ctx.lineTo(x + bw + gapx - 10, PH * 0.42 + 60);
            ctx.lineTo(x + bw + gapx - 24, PH * 0.42 + 52); ctx.moveTo(x + bw + gapx - 10, PH * 0.42 + 60); ctx.lineTo(x + bw + gapx - 24, PH * 0.42 + 68);
            ctx.stroke();
          }
        }
        const q = Math.min(1, (f.t - l23.start) / (l24.start - l23.start));
        const backward = f.t > l23.start + (l23.end - l23.start) * 0.35;
        /* 「再来一遍」末拍结巴：脉冲位置 ×3 抖动 */
        const stutter = f.p > 0.8 ? Math.floor(f.t * 18) % 3 / 3 : 0;
        const px = backward ? (1 - q + stutter * 0.05) : (q - stutter * 0.05);
        const pulseX = bx - 60 + px * (PW - 440 + 120);
        ctx.fillStyle = rgba('signal', 0.95);
        ctx.fillRect(pulseX, PH * 0.42 - 16, 8, 152);
        /* 词按方向排版：撤销是镜像的 */
        T(ctx); ctx.textAlign = 'center';
        ctx.font = F.archivo(84, 100, 800);
        const sung2 = Math.max(0, Math.min(l23.text.length, this.ctx.lyrics.lineCharProgress(l23, f.t)));
        const parts = ['重做，', '撤销，', '再来一遍'];
        let acc = 0;
        for (const p2 of parts) {
          const done = sung2 >= acc + p2.length;
          const active = sung2 > acc && sung2 < acc + p2.length;
          ctx.save();
          if (p2.startsWith('撤销') && (done || active)) { ctx.translate(PW / 2, PH * 0.72); ctx.scale(-1, 1); }
          else ctx.translate(PW / 2, PH * 0.72);
          ctx.fillStyle = done || active ? inkA(0.95) : inkA(0.25);
          ctx.fillText(p2.split('').reverse().join(''), 0, 0);
          ctx.restore();
          acc += p2.length;
        }
        ctx.textAlign = 'left';
        return { bloom: 0.12, grain: 0.12, vignette: 0.28, pdoom: 1 };
      }
      /* 旧管线图被划掉；纸从中间烧成两半 */
      const q = Math.min(1, (f.t - l24.start) / (this.ctx.end - l24.start));
      T(ctx);
      ctx.font = F.mono(28, 500); ctx.fillStyle = inkA(0.9);
      ctx.fillText('v1 渲染管线（单线程）', 200, 170);
      const boxes = ['采集', '绘制', '合成'];
      for (let i = 0; i < 3; i++) {
        const x = 220 + i * 420;
        ctx.strokeStyle = inkA(0.85); ctx.lineWidth = 2.4;
        ctx.strokeRect(x, PH * 0.36, 300, 110);
        ctx.font = F.mono(28, 500); ctx.fillStyle = inkA(0.9);
        ctx.fillText(boxes[i], x + 30, PH * 0.36 + 60);
        if (i < 2) { ctx.beginPath(); ctx.moveTo(x + 310, PH * 0.36 + 55); ctx.lineTo(x + 410, PH * 0.36 + 55); ctx.stroke(); }
      }
      const strike = Math.min(1, Math.max(0, (f.t - l24.start - 1) / 0.5));
      if (strike > 0) {
        ctx.strokeStyle = rgba('signal'); ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(200, PH * 0.36 + 55 - strike * 90); ctx.lineTo(200 + strike * (PW - 500), PH * 0.36 + 55 + strike * 90); ctx.stroke();
      }
      /* 烧毁线 + 两半摆开 */
      const burn = Math.min(1, Math.max(0, (f.t - l24.start - 1.6) / 1.1));
      if (burn > 0) {
        ctx.save();
        ctx.translate(PW / 2, PH / 2);
        const swing = burn * 0.16;
        ctx.save(); ctx.rotate(-swing); ctx.translate(0, -burn * 20);
        ctx.fillStyle = rgba('bone'); ctx.fillRect(-PW, -PH, PW * 2, PH); ctx.restore();
        ctx.save(); ctx.rotate(swing); ctx.translate(0, burn * 20);
        ctx.fillStyle = rgba('bone'); ctx.fillRect(-PW, 0, PW * 2, PH); ctx.restore();
        ctx.restore();
        /* 火线从纸缝里上来 */
        ctx.strokeStyle = rgba('signal'); ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(120, PH / 2); ctx.lineTo(120 + burn * (PW - 240), PH / 2 + Math.sin(f.t * 22) * 5); ctx.stroke();
        sparkDot(ctx, 120 + burn * (PW - 240), PH / 2, 1);
        sparks(ctx, 120 + burn * (PW - 240), PH / 2, 16, Math.floor(f.t * 30), 0.7, f.t);
      }
      karaoke(ctx, l24, f.t, { y: PH * 0.78, size: 56, weight: 700 });
      return { bloom: 0.15, grain: 0.13, vignette: 0.3, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ leftturn — 轨迹（修订版） ═══════════════════════════════ */
  /* TREATMENT：俯视工程路线图（虚线 + 里程碑），火花沿路行驶；
   * 「急转弯」90° 左甩 + 甩镜头（运动模糊）；刹车砸进未知领地的弹坑，
   * 等高线原来是面具地形；评审排期上 TODAY 游标卡死在空槽（未召开），
   * 跳过后面直冲「发布（提前完成）」。 */
  class LeftTurn extends Scene {
    static id = 'leftturn';
    render(f, ctx) {
      const l25 = this.ctx.lyrics.get('急转弯');
      const l26 = this.ctx.lyrics.get('评审');
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);
      const grid = rgba('graphite', 0.3);
      for (let x = 0; x < PW; x += 120) { ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, PH); ctx.stroke(); }
      for (let y = 0; y < PH; y += 120) { ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PW, y); ctx.stroke(); }

      if (f.t < l26.start) {
        /* 路线图 + 急转弯 + 弹坑 + 面具地形 */
        const whip = Math.max(0, Math.min(1, (f.t - (l25.start + 1.2)) / 0.35)); // 甩镜头
        ctx.save();
        ctx.translate(-whip * 420 + Math.sin(f.t * 40) * whip * 8, whip * 60);
        const sx = 180, sy = PH * 0.66;
        const turnT = Math.min(1, Math.max(0, (f.t - (l25.start + 1)) / 0.6));
        ctx.setLineDash([16, 12]);
        ctx.strokeStyle = rgba('ash', 0.85);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        const straight = Math.min(1, turnT * 1.4) * (PW * 0.45);
        ctx.lineTo(sx + straight, sy);
        if (turnT > 0.7) {
          const up = (turnT - 0.7) / 0.3 * (PH * 0.3);
          ctx.lineTo(sx + straight, sy - up);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        /* 里程碑：版本号 */
        const marks = ['v2.8', 'v2.9', 'v2.10', 'v2.11', '发布'];
        for (let i = 0; i < marks.length; i++) {
          const x = sx + 120 + i * ((PW * 0.45) / 4);
          ctx.fillStyle = rgba('bone', 0.9);
          ctx.beginPath(); ctx.arc(x, sy - 26, 7, 0, Math.PI * 2); ctx.fill();
          ctx.font = F.mono(22, 500); T(ctx);
          ctx.fillStyle = rgba('ash', 0.9);
          ctx.fillText(marks[i], x - 24, sy - 60);
        }
        /* 弹坑 + 面具等高线地形 */
        if (turnT >= 1) {
          const cx = sx + straight, cy = sy - PH * 0.3;
          for (let i = 1; i < 9; i++) {
            ctx.strokeStyle = rgba('graphite', 0.7);
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 30) {
              const wob = 1 + Math.sin(a * 4 + i) * 0.1;
              const X = cx + Math.cos(a) * i * 44 * wob, Y = cy + Math.sin(a) * i * 30 * wob;
              a === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
            }
            ctx.stroke();
          }
          /* 面具地形：两个眼坑 + 一道笑纹 */
          ctx.strokeStyle = rgba('signal', 0.9);
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(cx - 90, cy - 30, 34, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx + 90, cy - 30, 34, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx, cy + 60, 120, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
          ctx.font = F.mono(24, 500); T(ctx);
          ctx.fillStyle = rgba('signal', 0.95);
          ctx.fillText('计划外目标 · 不在路线图上', cx - 150, cy + 190);
        }
        const px2 = sx + Math.min(1, turnT * 1.4) * PW * 0.45;
        const py2 = turnT > 0.7 ? sy - (turnT - 0.7) / 0.3 * PH * 0.3 : sy;
        sparkDot(ctx, px2, py2, f.a.kick);
        ctx.restore();
        karaoke(ctx, l25, f.t, { y: 120, size: 60, weight: 800 });
        return { bloom: 0.4, grain: 0.14, vignette: 0.4, pdoom: 1 };
      }
      /* 评审排期（甘特条）：TODAY 游标卡死在空槽，跳过后面冲到发布 */
      const q = Math.min(1, (f.t - l26.start) / (this.ctx.end - l26.start));
      const rows = [
        { name: 'v2.8 · 起点', done: true }, { name: 'v2.9 · 导览', done: true }, { name: 'v2.10 · 极限样片', done: true },
        { name: 'v2.11 · 再改一版', done: true }, { name: 'v2.12 · 评审', done: false }, { name: '发布', done: true },
      ];
      for (let i = 0; i < rows.length; i++) {
        const y = 220 + i * 110;
        T(ctx);
        ctx.font = F.mono(26, 400); ctx.fillStyle = rgba('ash', 0.9);
        ctx.fillText(rows[i].name, 160, y);
        const x0 = 640, w2 = PW - 900;
        ctx.strokeStyle = rgba('graphite', 0.7); ctx.lineWidth = 2;
        ctx.strokeRect(x0, y - 30, w2, 60);
        const fill = rows[i].done ? (q > (i + 0.5) / rows.length ? 1 : Math.max(0, q * rows.length - i)) : 0;
        if (fill > 0) {
          ctx.fillStyle = rgba(i === 4 ? 'signal' : 'ash', 0.8);
          ctx.fillRect(x0 + 4, y - 26, (w2 - 8) * fill, 52);
        }
        if (!rows[i].done && q > (i + 0.5) / rows.length - 0.08) {
          if (Math.floor(f.t * 3) % 2) {
            ctx.font = F.mono(22, 500); ctx.fillStyle = rgba('signal');
            ctx.fillText('STATUS: 未召开', x0 + 24, y);
          }
        }
        if (i === 5) {
          ctx.font = F.mono(22, 500); ctx.fillStyle = rgba('bone', 0.9);
          ctx.fillText('提前 3 天', x0 + w2 - 150, y);
        }
      }
      /* TODAY 游标 = 火花 */
      const tx = 640 + Math.min(1, q * 1.3) * (PW - 900);
      sparkDot(ctx, tx, 200 + Math.min(rows.length - 1, Math.floor(q * 1.3 * rows.length)) * 110 + 0, f.a.kick);
      ctx.font = F.mono(20, 500); T(ctx);
      ctx.fillStyle = rgba('signal', 0.95);
      ctx.fillText('TODAY', tx - 30, 178);
      karaoke(ctx, l26, f.t, { y: 120, size: 60, weight: 800 });
      return { bloom: 0.35, grain: 0.14, vignette: 0.4, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ paperclips — 图层块，填满一间房 ═══════════════════════════════ */
  /* TREATMENT：安静的 breakdown，催眠且美。火花的线弯成图层块；
   * 每拍翻倍（1,2,4,8…）长成格阵；镜头慢漂在无限刻版格阵里（骨白金属、橙缘、深雾）；
   * 「内存回收器在休假」浮过一张自动回复卡；「塞不下了」收拢到窒息，词被挤在缝里。 */
  class Paperclips extends Scene {
    static id = 'paperclips';
    render(f, ctx) {
      const l29 = this.ctx.lyrics.get('图层块');
      const l30 = this.ctx.lyrics.get('休假');
      const l31 = this.ctx.lyrics.get('塞不下');
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);
      /* 图层块线稿预渲染成精灵：逐块 drawImage（roundRect ×108/帧 太贵） */
      if (!this._blk) {
        const bs = 220;
        this._blk = document.createElement('canvas');
        this._blk.width = bs; this._blk.height = bs;
        const bxx = this._blk.getContext('2d');
        bxx.strokeStyle = rgba('bone', 0.95);
        bxx.lineWidth = 7;
        bxx.beginPath();
        bxx.roundRect(30, 55, 160, 105, 22);
        bxx.stroke();
        bxx.strokeStyle = rgba('signal', 0.55);
        bxx.lineWidth = 3;
        bxx.stroke();
        bxx.strokeStyle = rgba('graphite', 0.85);
        bxx.lineWidth = 2.6;
        bxx.beginPath(); bxx.moveTo(72, 128); bxx.lineTo(190, 128); bxx.stroke();
        this._fog = null;
      }
      const q0 = Math.min(1, Math.max(0, (f.t - l29.start) / (l30.start - l29.start)));
      /* 格阵：每拍翻倍的图层块，带深度雾 */
      const beatQ = Math.min(5, Math.floor(Math.max(0, f.t - l29.start) / (D.SPB * 2)) + 1);
      const count = Math.pow(2, Math.min(6, beatQ));
      const cols = Math.ceil(Math.sqrt(count * 2));
      const cell = 120;
      const drift = f.t * 14;
      for (let r = 0; r < 9; r++) {
        const depth = r / 8;
        const scale = 0.5 + depth * 0.9;
        for (let c = 0; c < cols; c++) {
          const x = ((c * cell - drift) % (cols * cell) + cols * cell) % (cols * cell) - cell + PW * 0.06;
          const y = 80 + r * 108;
          const idx = r * cols + c;
          if (idx >= count * 3) continue;
          ctx.globalAlpha = 0.35 + depth * 0.45;
          const s = 44 * scale;
          ctx.drawImage(this._blk, x, y, s * 2.2, s * 1.5);
        }
      }
      ctx.globalAlpha = 1;
      /* 深雾压住远景（渐变对象静态，缓存一次） */
      if (!this._fog) {
        this._fog = ctx.createLinearGradient(0, 0, 0, PH);
        this._fog.addColorStop(0, rgba('ink', 0.75)); this._fog.addColorStop(0.5, 'rgba(0,0,0,0)'); this._fog.addColorStop(1, rgba('ink', 0.6));
      }
      ctx.fillStyle = this._fog; ctx.fillRect(0, 0, PW, PH);
      readout(ctx, '图层块', String(count).padStart(4, '0'));
      /* 自动回复卡 */
      if (f.t >= l30.start - 0.4 && f.t < l31.start) {
        const q = Math.min(1, Math.max(0, (f.t - l30.start + 0.4) / 0.5));
        const cardY = PH * 0.3 - q * 60;
        ctx.fillStyle = rgba('ink2', 0.96);
        ctx.fillRect(PW * 0.56, cardY, 520, 150);
        ctx.strokeStyle = rgba('graphite', 0.7);
        ctx.strokeRect(PW * 0.56 + 0.5, cardY + 0.5, 520, 150);
        T(ctx); ctx.font = F.mono(22, 400);
        ctx.fillStyle = rgba('ash', 0.95);
        const msg = '自动回复：本人休假，暂停回收。';
        const msg2 = '紧急图层请联系 ——';
        const n = Math.floor(Math.min(1, Math.max(0, (f.t - l30.start) / (l31.start - l30.start))) * (msg.length + msg2.length));
        ctx.fillText(msg.slice(0, n), PW * 0.56 + 30, cardY + 56);
        ctx.fillText(msg2.slice(0, Math.max(0, n - msg.length)), PW * 0.56 + 30, cardY + 100);
      }
      /* 收拢到窒息：块放大逼近 */
      if (f.t >= l31.start) {
        const q = Math.min(1, (f.t - l31.start) / (this.ctx.end - l31.start));
        ctx.fillStyle = rgba('ink', q * 0.4);
        ctx.fillRect(0, 0, PW, PH);
      }
      const line = this.ctx.lyrics.lineAt(f.t);
      if (line) karaoke(ctx, line, f.t, { y: PH - 110, size: 48, width: l31.start <= f.t ? 62 : 100, weight: 600 });
      return { bloom: 0.5, halation: 0.25, grain: 0.16, vignette: 0.5, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ fuse — 太迟了 ═══════════════════════════════ */
  /* TREATMENT：那根线显形为编织的燃烧导火索，火花喷粒子；唱词排在导火索上，
   * 火花烧过处碳化成灰。「表达力 ⊥ 性能」图表在方格纸上被火花照亮，
   * 平坦的回归线是一根吉他弦，在「驰」上弯到真实音高并回响。镜头冲进火花。 */
  class Fuse extends Scene {
    static id = 'fuse';
    render(f, ctx) {
      const l32 = this.ctx.lyrics.get('太迟了');
      const l33 = this.ctx.lyrics.get('背道而驰');
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);

      if (f.t < l33.start) {
        /* 导火索：主线 + 编织斜纹；烧点前碳化 */
        const burn = Math.min(1, (f.t - l32.start) / (l33.start - l32.start));
        const x0 = 100, x1 = PW - 200;
        const by = PH * 0.52;
        ctx.strokeStyle = rgba('graphite');
        ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x1, by); ctx.stroke();
        ctx.strokeStyle = rgba('ash', 0.7);
        ctx.lineWidth = 2;
        for (let x = x0; x < x1; x += 18) {
          ctx.beginPath(); ctx.moveTo(x, by - 7); ctx.lineTo(x + 12, by + 7); ctx.stroke();
        }
        const bx = x0 + (x1 - x0) * burn;
        /* 已烧段：灰烬色 + 缺口 */
        ctx.strokeStyle = rgba('graphite', 0.35);
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(bx, by); ctx.stroke();
        sparkDot(ctx, bx, by, f.a.kick);
        sparks(ctx, bx, by, 26, Math.floor(f.t * 30), 0.5 + f.a.kick, f.t);
        /* 词排在导火索上，烧过即灰 */
        T(ctx);
        const font = F.archivo(54, 100, 700);
        ctx.font = font;
        const chars = Array.from(l32.text);
        const total = chars.reduce((a, c) => a + measure(c, font), 0);
        let x = PW / 2 - total / 2;
        for (let i = 0; i < chars.length; i++) {
          const prog = l32.words[i] ? window.PD_LYRICS.wordProgress(l32.words[i], f.t) : 0;
          const burnt = x + measure(chars[i], font) / 2 < bx;
          ctx.fillStyle = burnt ? rgba('graphite', 0.4) : prog > 0 ? rgba('bone', 0.95) : rgba('graphite', 0.5);
          ctx.fillText(chars[i], x, by - 90 + Math.sin(i) * 4);
          x += measure(chars[i], font);
        }
        return { bloom: 0.6, halation: 0.3, grain: 0.16, vignette: 0.5, pdoom: 1 };
      }
      /* 正交图表：表达力 × 性能，回归线 = 吉他弦 */
      const q = Math.min(1, (f.t - l33.start) / (this.ctx.end - l33.start));
      const px = 180, py = 200, pw2 = PW - 420, ph2 = PH - 460;
      ctx.strokeStyle = rgba('graphite', 0.4);
      ctx.lineWidth = 1;
      for (let x = px; x <= px + pw2; x += 48) { ctx.beginPath(); ctx.moveTo(x, py); ctx.lineTo(x, py + ph2); ctx.stroke(); }
      for (let y = py; y <= py + ph2; y += 48) { ctx.beginPath(); ctx.moveTo(px, y); ctx.lineTo(px + pw2, y); ctx.stroke(); }
      T(ctx); ctx.font = F.mono(22, 400);
      ctx.fillStyle = rgba('ash', 0.9);
      ctx.fillText('表达力 →', px + pw2 - 120, py + ph2 + 44);
      ctx.fillText('性能 ↑', px - 20, py - 20);
      /* 散点：每个版本一颗，标注 */
      const pts = [['v2.8', 0.2, 0.2], ['v2.9', 0.35, 0.3], ['v2.10', 0.5, 0.42], ['v2.11', 0.68, 0.5], ['极限样片', 0.85, 0.62]];
      for (const [name, fx, fy] of pts) {
        const X = px + pw2 * fx, Y = py + ph2 * (1 - fy);
        ctx.fillStyle = rgba('bone', 0.9);
        ctx.beginPath(); ctx.arc(X, Y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.font = F.mono(18, 400);
        ctx.fillText(name, X + 12, Y - 12);
      }
      /* 回归线 = 弦：在「驰」上弯到真实音高（颤音） */
      const bend = Math.max(0, q - 0.45) / 0.55;
      ctx.strokeStyle = rgba('signal');
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i <= 100; i++) {
        const x = i / 100;
        const X = px + pw2 * x;
        const vib = bend > 0 ? Math.sin(x * Math.PI) * Math.sin(f.t * 26) * 26 * bend : 0;
        const Y = py + ph2 * 0.62 - (x * ph2 * 0.18) + vib;
        i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      }
      ctx.stroke();
      if (bend > 0.3) {
        T(ctx); ctx.font = F.mono(30, 500);
        ctx.fillStyle = rgba('signal', 0.95);
        ctx.fillText('♭', px + pw2 * 0.3, py + 60);
      }
      sparkDot(ctx, px + pw2 * Math.min(1, q * 1.4), py + ph2 * 0.62, f.a.kick);
      karaoke(ctx, l33, f.t, { y: PH - 120, size: 56, weight: 700 });
      return { bloom: 0.55 + bend * 0.2, halation: 0.3, grain: 0.15, vignette: 0.5, zoom: 1 + bend * 0.3, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ stack — 架构（递归） ═══════════════════════════════ */
  /* TREATMENT：无限垂直的命令块堆（技术线稿：add / bind / keyframe / export），
   * 镜头一拍一块地坠落；引语用大弯引号，一词一块。
   * 「直到撤销学会反抗」：坠落死停在拍点上，一块旋出对齐位，「撤销」逆着卡拉 OK 从右往左亮。 */
  class Stack extends Scene {
    static id = 'stack';
    render(f, ctx) {
      const l34 = this.ctx.lyrics.get('排到底');
      const l35 = this.ctx.lyrics.get('学会反抗');
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);
      const BH = 150;
      const fall = f.t < l35.start;
      /* 坠落：每拍一块；l35 起：死停 */
      const blockOffset = fall ? (f.beat * BH) % (BH * 2) : Math.min(BH * 2, (l35.start * 4) % (BH * 2));
      const KINDS = ['cmd.add', 'bind(t→x)', 'keyframe.set', 'export.mp4'];
      const rev = !fall; // 「撤销」逆着唱
      for (let i = -1; i < 9; i++) {
        const y = PH - ((i * BH + blockOffset) % (BH * 10)) - BH;
        const kind = KINDS[((i + Math.floor(f.beat)) % KINDS.length + KINDS.length) % KINDS.length];
        const x = PW / 2 - 300;
        ctx.strokeStyle = rgba('graphite', 0.85);
        ctx.lineWidth = 2.4;
        ctx.strokeRect(x, y, 600, BH - 14);
        T(ctx); ctx.font = F.mono(30, 500);
        ctx.fillStyle = rgba('ash', 0.9);
        ctx.fillText(kind, x + 26, y + BH / 2 - 8);
        /* 残差箭头 */
        ctx.strokeStyle = rgba('signal', 0.6);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + 470, y + BH / 2 - 8); ctx.lineTo(x + 540, y + BH / 2 - 8);
        ctx.lineTo(x + 528, y + BH / 2 - 16); ctx.moveTo(x + 540, y + BH / 2 - 8); ctx.lineTo(x + 528, y + BH / 2 - 0);
        ctx.stroke();
        if (!fall && i === 2) {
          /* 一块旋出对齐位 */
          ctx.save();
          ctx.translate(PW / 2, y + BH / 2);
          ctx.rotate(0.18);
          ctx.translate(-PW / 2, -(y + BH / 2));
          ctx.strokeStyle = rgba('signal', 0.95);
          ctx.strokeRect(x, y, 600, BH - 14);
          ctx.restore();
        }
      }
      /* 大弯引号引语：一词一块（简化为居中逐字亮起），「撤销」反着唱 */
      const cur = this.ctx.lyrics.lineAt(f.t);
      if (cur) {
        T(ctx); ctx.textAlign = 'center';
        const font = F.archivo(88, 100, 900);
        ctx.font = font;
        const chars = Array.from(cur.text);
        const total = chars.reduce((a, c) => a + measure(c, font), 0);
        let x = PW / 2 - total / 2;
        const n = rev ? chars.length - Math.max(0, Math.min(chars.length, this.ctx.lyrics.lineCharProgress(cur, f.t))) : Math.max(0, Math.min(chars.length, this.ctx.lyrics.lineCharProgress(cur, f.t)));
        for (let i = 0; i < chars.length; i++) {
          ctx.fillStyle = i < n ? rgba('bone', 0.95) : rgba('graphite', 0.5);
          ctx.fillText(chars[i], x, PH * 0.2);
          x += measure(chars[i], font);
        }
        ctx.textAlign = 'left';
      }
      return { bloom: 0.4, grain: 0.15, vignette: 0.48, shake: fall && f.a.kick > 0.9 ? [0.25, 0.1] : [0, 0], pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ dense — 尺度 ═══════════════════════════════ */
  /* TREATMENT：①安全框内的排版压力：每脚点压一次（宽 125→62、重 300→900），副本越塞越满，
   * `图层/画布` 计数冲过 20,000 ②安全框就是围栏：重读词逐一击破，QC 失败日志冷静滚动
   * ③十万个格子按波闪 ④桌面倾斜：镜头逐脚点滚转，对齐猛拽一次又过矫，面具滚落。 */
  class Dense extends Scene {
    static id = 'dense';
    render(f, ctx) {
      const l36 = this.ctx.lyrics.get('密不透风');
      const l37 = this.ctx.lyrics.get('逐个击破');
      const l38 = this.ctx.lyrics.get('十万个');
      const l39 = this.ctx.lyrics.get('跑偏');
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);

      if (f.t < l37.start) {
        /* ① 排版压力 + 安全框 */
        const q = Math.min(1, (f.t - l36.start) / (l37.start - l36.start));
        /* 安全框 guides */
        ctx.strokeStyle = rgba('graphite', 0.5);
        ctx.setLineDash([8, 8]);
        ctx.strokeRect(PW * 0.05, PH * 0.05, PW * 0.9, PH * 0.9);
        ctx.strokeRect(PW * 0.035, PH * 0.035, PW * 0.93, PH * 0.93);
        ctx.setLineDash([]);
        T(ctx); ctx.font = F.mono(18, 400);
        ctx.fillStyle = rgba('ash', 0.7);
        ctx.fillText('标题安全 90%', PW * 0.05 + 8, PH * 0.05 + 20);
        /* 每脚点压一次：行副本增多、字距变负 */
        const kicks = Math.floor(f.beat);
        const copies = 1 + Math.min(7, kicks - 24);
        const press = Math.min(1, q * 1.2);
        const width = 125 - press * 63;   // 125 → 62
        const weight = 300 + Math.round(press * 600);
        const line = l36;
        for (let c = 0; c < copies; c++) {
          const size = Math.max(30, (110 - c * 12) * (1 - press * 0.3));
          const font = F.archivo(size, width, weight);
          T(ctx); ctx.font = font;
          const w2 = measure(line.text, font);
          const y = PH * 0.28 + c * 74 * (1 - press * 0.25);
          ctx.fillStyle = c === 0 ? rgba('bone', 0.95) : rgba(c % 2 ? 'graphite' : 'ash', 0.65);
          ctx.fillText(line.text, PW / 2 - w2 / 2 - c * 6 * press, y);
        }
        readout(ctx, '图层 / 画布', String(Math.round(20 + q * q * 19980)).toLocaleString('en-US'), { big: 44 });
        return { bloom: 0.3, grain: 0.16, vignette: 0.45, pdoom: 1 };
      }
      if (f.t < l38.start) {
        /* ② 击破围栏 + QC 日志 */
        const q = Math.min(1, (f.t - l37.start) / (l38.start - l37.start));
        const broken = q < 0.4 ? 0 : q < 0.75 ? 1 : 2;
        if (broken < 1) { ctx.strokeStyle = rgba('graphite', 0.5); ctx.setLineDash([8, 8]); ctx.strokeRect(PW * 0.05, PH * 0.05, PW * 0.9, PH * 0.93 - PH * 0.05 + PH * 0.02); ctx.setLineDash([]); }
        if (broken < 2) { ctx.strokeStyle = rgba('graphite', 0.5); ctx.strokeRect(PW * 0.035, PH * 0.035, PW * 0.93, PH * 0.93); }
        /* 框被击破：裂口飞出 */
        for (let i = 0; i < broken; i++) {
          const bx2 = PW * (0.05 + i * 0.44), by2 = PH * 0.05;
          ctx.strokeStyle = rgba('signal', 0.9);
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(bx2, by2); ctx.lineTo(bx2 - 40 - q * 80, by2 - 30 - q * 60); ctx.moveTo(bx2 + 20, by2); ctx.lineTo(bx2 + 70 + q * 90, by2 - 40 - q * 70); ctx.stroke();
        }
        T(ctx); ctx.font = F.mono(24, 400);
        const qc = ['标题安全框 · 破', '动作安全框 · 破', '画面本身 · 破'];
        ctx.fillStyle = rgba('ash', 0.9);
        for (let i = 0; i <= broken && i < 3; i++) ctx.fillText(`QC ${String(i + 1).padStart(2, '0')}  ${qc[i]}  @${(f.t).toFixed(2)}s`, 160, PH * 0.78 + i * 40);
        karaoke(ctx, l37, f.t, { y: PH * 0.4, size: 72, weight: 800 });
        return { bloom: 0.35, grain: 0.15, vignette: 0.4, pdoom: 1 };
      }
      if (f.t < l39.start) {
        /* ③ 十万个格子按波闪 —— ImageData 一次成帧；波拆成两条 1D 查表，避免每像素三角函数 */
        const N = 316; // 316² ≈ 100,000
        if (!this._img) {
          this._c = document.createElement('canvas');
          this._c.width = N; this._c.height = N;
          this._x = this._c.getContext('2d');
          this._img = this._x.createImageData(N, N);
          this._diag = new Float32Array(N);      // 波一按对角线查表
          this._colW = new Float32Array(N);      // 波二按列查表
        }
        const d = this._img.data;
        for (let s = 0; s < N; s++) this._diag[s] = Math.sin(s * 0.18 - f.t * 6);
        for (let x = 0; x < N; x++) this._colW[x] = Math.sin(x * 0.1 - f.t * 3.3);
        for (let y = 0; y < N; y++) {
          const row = y * N;
          for (let x = 0; x < N; x++) {
            const xy = x + y;
            const w2 = this._diag[xy < N ? xy : xy - N] + this._colW[x];
            const on = w2 > 0.6 ? 0.55 : w2 > 0.1 ? 0.22 : 0.05;
            const i4 = (row + x) * 4;
            d[i4] = 238 * on; d[i4 + 1] = 233 * on; d[i4 + 2] = 223 * on; d[i4 + 3] = 255;
          }
        }
        this._x.putImageData(this._img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this._c, PW * 0.1, PH * 0.12, PW * 0.8, PH * 0.68);
        ctx.imageSmoothingEnabled = true;
        readout(ctx, '像素', '100,000', { big: 44 });
        karaoke(ctx, l38, f.t, { y: PH * 0.9, size: 44, weight: 600 });
        return { bloom: 0.18, grain: 0.14, vignette: 0.45, pdoom: 1 };
      }
      /* ④ 桌面倾斜 + 面具滚落 + 评分面板 */
      const q = Math.min(1, (f.t - l39.start) / (this.ctx.end - l39.start));
      const kickIdx = Math.floor(f.beat);
      const dir = kickIdx % 2 ? 1 : -1;
      const over = q > 0.55 ? (q - 0.55) * 0.5 : 0;
      const tilt = dir * 0.045 * f.a.kick + over * 0.2;
      ctx.save();
      ctx.translate(PW / 2, PH / 2);
      ctx.rotate(tilt);
      ctx.translate(-PW / 2, -PH / 2);
      /* 桌面：斜线 + 滑落的面具 */
      ctx.strokeStyle = rgba('graphite', 0.5);
      for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.moveTo(0, 140 + i * 90); ctx.lineTo(PW, 140 + i * 90); ctx.stroke(); }
      const drop = Math.min(1, q * 1.4);
      const mx = PW * 0.3 + drop * PW * 0.4, my = 200 + drop * (PH - 400);
      ctx.fillStyle = rgba('bone', 0.95);
      ctx.beginPath(); ctx.arc(mx, my, 90, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgba('ink');
      const upside = drop > 0.8;
      ctx.beginPath(); ctx.arc(mx - 34, my + (upside ? 20 : -20), 8, 0, Math.PI * 2); ctx.arc(mx + 34, my + (upside ? 20 : -20), 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgba('ink'); ctx.lineWidth = 5;
      ctx.beginPath();
      if (upside) ctx.arc(mx, my + 30, 44, 1.25 * Math.PI, 1.75 * Math.PI); // 倒了：笑变哭
      else ctx.arc(mx, my + 8, 44, 0.25 * Math.PI, 0.75 * Math.PI);
      ctx.stroke();
      ctx.restore();
      /* 自动对齐评分面板：0.99 → 0.41 → 弹回 0.99 */
      const score = q < 0.6 ? 0.99 : q < 0.8 ? 0.41 + (q - 0.6) * 2.9 : 0.99;
      readout(ctx, '自动对齐评分', score.toFixed(2), { big: 44 });
      karaoke(ctx, l39, f.t, { y: 110, size: 54, weight: 700 });
      return { bloom: 0.4, grain: 0.16, vignette: 0.5, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ loom — 正如撤销树所预言 ═══════════════════════════════ */
  /* TREATMENT：续写树是主角，扎根在 hook4 退场的火花上；唱词沿选中的路径逐 token 生成
   * （各带概率），每个节点抽出暗的备选分支；最后一个节点给出可读分布；
   * 「蒙版的年代」：词以实心 [蒙版] 块出现，唱到即揭；「递归自我升级」：Droste。 */
  class Loom extends Scene {
    static id = 'loom';
    render(f, ctx) {
      const l41 = this.ctx.lyrics.get('撤销树');
      const l42 = this.ctx.lyrics.get('蒙版');
      const l43 = this.ctx.lyrics.get('递归');
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);
      const ALTS = ['永远', '版本', '算了吧', '没人知道', '快照', '图纸', '墨稿'];

      if (f.t < l42.start) {
        /* 撤销树：主干逐 token 生成，备选分支变暗 */
        const q = Math.min(1, (f.t - l41.start) / (l42.start - l41.start));
        const chars = Array.from(l41.text);
        const n = Math.max(1, Math.round(q * chars.length));
        const x0 = 160, y0 = PH * 0.62;
        ctx.strokeStyle = rgba('graphite', 0.7);
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (PW - 360) * 0.8, y0 - 120); ctx.stroke();
        /* 主干节点 = 唱词字符 + 概率 */
        T(ctx);
        for (let i = 0; i < n; i++) {
          const t2 = i / (chars.length - 1);
          const nx = x0 + (PW - 500) * t2, ny = y0 - 120 * t2;
          const w0 = l41.words[i];
          const prog = w0 ? window.PD_LYRICS.wordProgress(w0, f.t) : 0;
          ctx.font = F.archivo(44, 100, 700);
          ctx.fillStyle = prog > 0 ? rgba('bone', 0.95) : rgba('graphite', 0.55);
          ctx.fillText(chars[i], nx, ny);
          ctx.font = F.mono(16, 400);
          ctx.fillStyle = rgba('ash', 0.75);
          ctx.fillText((0.3 + hash(i * 7) * 0.5).toFixed(2), nx, ny + 34);
          /* 备选分支 */
          const k = Math.min(1, Math.max(0, q * 1.4 - t2));
          if (k > 0) {
            for (let b = 0; b < 2; b++) {
              const bx = nx + 60 + b * 40, by = ny - 90 - b * 40;
              ctx.strokeStyle = rgba('graphite', 0.35 * k);
              ctx.lineWidth = 1.4;
              ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(bx, by); ctx.stroke();
              ctx.fillStyle = rgba('graphite', 0.55 * k);
              ctx.font = F.mono(17, 400);
              ctx.fillText(`${ALTS[(i * 2 + b) % ALTS.length]} .${String(9 + ((i + b) * 7) % 80).slice(0, 2)}`, bx + 8, by);
            }
          }
        }
        /* 末端节点：可读分布 + 「撤销树」以 Cormorant 斜体采样 */
        if (q > 0.8) {
          const k = (q - 0.8) / 0.2;
          const ex = x0 + (PW - 500) * 0.8, ey = y0 - 120 * 0.8;
          ctx.globalAlpha = k;
          ctx.font = F.mono(19, 400);
          ctx.fillStyle = rgba('ash', 0.9);
          const dist = ['永远 .19', '版本 .09', '没人知道 .07', '一篇帖子 .04'];
          dist.forEach((s, i) => ctx.fillText(s, ex + 40, ey - 40 - i * 30));
          ctx.font = `italic 64px ${getComputedStyle(document.documentElement).getPropertyValue('--font-serif')}`;
          ctx.fillStyle = rgba('bone', 0.96);
          ctx.fillText('撤销树', ex + 40, ey - 190);
          ctx.font = F.mono(18, 400);
          ctx.fillStyle = rgba('signal', 0.95);
          ctx.fillText('p 0.31 ▸ 已采样', ex + 260, ey - 190);
          ctx.globalAlpha = 1;
        }
        sparkDot(ctx, x0, y0, f.a.kick);
        return { bloom: 0.45, grain: 0.14, vignette: 0.48, pdoom: 1 };
      }
      if (f.t < l43.start) {
        /* [蒙版] 块：唱到即揭 */
        const chars = Array.from(l42.text);
        T(ctx);
        const size = 92, font = F.archivo(size, 100, 800);
        ctx.font = font;
        const cw = measure('蒙', font) * 1.16;
        const total = chars.length * cw;
        let x = PW / 2 - total / 2;
        for (let i = 0; i < chars.length; i++) {
          const w0 = l42.words[i];
          const prog = w0 ? window.PD_LYRICS.wordProgress(w0, f.t) : 0;
          if (prog <= 0) {
            ctx.fillStyle = rgba('ash', 0.32);
            ctx.fillRect(x, PH * 0.42 - size * 0.6, cw - 12, size * 1.2);
            ctx.font = F.mono(15, 400);
            ctx.fillStyle = rgba('ink');
            ctx.fillText('蒙版', x + 8, PH * 0.42);
            ctx.font = font;
          } else {
            ctx.fillStyle = rgba('bone', 0.95);
            ctx.fillText(chars[i], x + (cw - 12 - measure(chars[i], font)) / 2, PH * 0.42);
          }
          x += cw;
        }
        return { bloom: 0.4, grain: 0.13, vignette: 0.45, pdoom: 1 };
      }
      /* Droste：嵌套的升级框，最里面是 ilya 的第一瞥 */
      const q = Math.min(1, (f.t - l43.start) / (this.ctx.end - l43.start));
      const depth = Math.min(7, Math.floor(q * 8));
      ctx.save();
      ctx.translate(PW / 2, PH / 2);
      for (let i = 0; i <= depth; i++) {
        const s = 1 / Math.pow(1.5, i);
        ctx.strokeStyle = rgba(i === depth ? 'ember' : 'ash', 0.9);
        ctx.lineWidth = 2.4 * s;
        ctx.strokeRect(-360 * s, -210 * s, 720 * s, 420 * s);
        T(ctx); ctx.font = F.mono(Math.max(9, 24 * s), 400);
        ctx.fillStyle = rgba('ash', 0.9);
        ctx.fillText('升级 → v' + (2.12 + i * 0.01).toFixed(2), -340 * s, -180 * s);
      }
      ctx.restore();
      karaoke(ctx, l43, f.t, { y: PH - 120, size: 52, weight: 700 });
      return { bloom: 0.45, grain: 0.13, vignette: 0.5, pdoom: 1 };
    }
  }

  /* ═══════════════════════════════ ilya — 看见了什么 ═══════════════════════════════ */
  /* TREATMENT：白线刻版的暗房：一台从背后看的笔记本，只有它的辉光；
   * 「看」后的下拍屏幕变成 REDACTED；「无人知晓」逐词合盖，光塌成缝再到睡眠灯；
   * 「演的吗」空剧场、聚光灯打在空处、问句写在台口；幕布合拢，缝隙的光塌到中心的火花，引爆 outro。 */
  class Ilya extends Scene {
    static id = 'ilya';
    render(f, ctx) {
      const l44 = this.ctx.lyrics.get('看见了什么');
      const l45 = this.ctx.lyrics.get('演的吗');
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);

      if (f.t < l45.start) {
        const q = Math.min(1, (f.t - l44.start) / (l45.start - l44.start));
        const redacted = f.t > l44.start + 2.2;
        const lid = Math.min(1, Math.max(0, (f.t - (l44.start + 2.6)) / 1.6)); // 合盖
        /* 辉光（唯一的暖光）：预渲染的精灵，逐帧只调透明度与大小 */
        if (!this._glow) {
          this._glow = document.createElement('canvas');
          this._glow.width = 512; this._glow.height = 512;
          const gx = this._glow.getContext('2d');
          const g0 = gx.createRadialGradient(256, 256, 0, 256, 256, 256);
          g0.addColorStop(0, rgba('ember', 1));
          g0.addColorStop(1, 'rgba(0,0,0,0)');
          gx.fillStyle = g0;
          gx.fillRect(0, 0, 512, 512);
        }
        const gr = 560 * (1 - lid * 0.85);
        ctx.globalAlpha = 0.2 + f.a.vocal * 0.1;
        ctx.drawImage(this._glow, PW * 0.58 - gr, PH * 0.55 - gr, gr * 2, gr * 2);
        ctx.globalAlpha = 1;
        /* 白线房间：地板 + 墙角 */
        ctx.strokeStyle = rgba('bone', 0.4);
        ctx.lineWidth = 1.4;
        for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.moveTo(0, PH * 0.72 + i * 40); ctx.lineTo(PW, PH * 0.72 + i * 40); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(PW * 0.2, PH); ctx.lineTo(PW * 0.34, PH * 0.6); ctx.stroke();
        /* 笔记本（从背后）：白线 + 合盖角度 */
        const lx = PW * 0.58, ly = PH * 0.58;
        const lidAng = lid * 1.25; // 0 开 → 1.25 合拢
        ctx.strokeStyle = rgba('bone', 0.9);
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(lx - 190, ly + 120); ctx.lineTo(lx + 190, ly + 120); ctx.stroke(); // 底边
        /* 屏幕（绕底边向后倒） */
        const sh = 220 * Math.cos(lidAng);
        ctx.beginPath();
        ctx.moveTo(lx - 180, ly + 114);
        ctx.lineTo(lx - 180 + lid * 30, ly + 114 - sh);
        ctx.lineTo(lx + 180 + lid * 30, ly + 114 - sh);
        ctx.lineTo(lx + 180, ly + 114);
        ctx.stroke();
        /* 屏幕内容：辉光 / REDACTED / 合盖后一条缝 */
        if (lidAng < 1.1) {
          if (redacted) {
            ctx.fillStyle = rgba('bone', 0.9);
            ctx.fillRect(lx - 140, ly + 114 - sh + 30, 280, 70);
            ctx.fillStyle = rgba('ink');
            T(ctx); ctx.font = F.mono(30, 700); ctx.textAlign = 'center';
            ctx.fillText('REDACTED', lx, ly + 114 - sh + 74);
            ctx.textAlign = 'left';
          } else {
            ctx.fillStyle = rgba('ember', 0.5);
            ctx.fillRect(lx - 150, ly + 114 - sh + 24, 300, 84);
          }
        } else {
          /* 光塌成缝 → 睡眠灯 */
          ctx.fillStyle = rgba('ember', 0.8);
          ctx.fillRect(lx - 60, ly + 118, 120 * (1 - lid), 3);
          ctx.fillStyle = rgba('signal', 0.9);
          ctx.beginPath(); ctx.arc(lx + 150, ly + 122, 4, 0, Math.PI * 2); ctx.fill();
        }
        /* 盖子贴纸（第三档暗） */
        if (lid < 0.4) {
          T(ctx); ctx.font = F.mono(15, 400);
          ctx.fillStyle = rgba('graphite', 0.65);
          ['感受图层', '第一张海报', '略微有意识', '关键帧即一切'].forEach((s, i) => ctx.fillText(s, lx - 150 + i * 80, ly + 114 - sh * 0.4));
        }
        karaoke(ctx, l44, f.t, { y: 130, size: 56, weight: 700, width: 87.5 });
        return { bloom: 0.6, halation: 0.35, grain: 0.12, vignette: 0.62, pdoom: 1 };
      }
      /* 空剧场：聚光打在空处，问句在台口，幕布合拢收火花 */
      const q = Math.min(1, (f.t - l45.start) / (this.ctx.end - l45.start));
      const curtain = Math.min(1, Math.max(0, (q - 0.5) / 0.4));
      /* 聚光灯锥 */
      ctx.fillStyle = rgba('ash', 0.1);
      ctx.beginPath();
      ctx.moveTo(PW / 2, 0); ctx.lineTo(PW / 2 - 260, PH); ctx.lineTo(PW / 2 + 260, PH);
      ctx.fill();
      /* 台口拱 + 问句 */
      ctx.strokeStyle = rgba('bone', 0.8);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(PW * 0.18, PH * 0.3); ctx.lineTo(PW * 0.18, PH * 0.78); ctx.lineTo(PW * 0.82, PH * 0.78); ctx.lineTo(PW * 0.82, PH * 0.3); ctx.stroke();
      T(ctx); ctx.textAlign = 'center';
      ctx.font = F.serif(64, 500, true);
      ctx.fillStyle = rgba('bone', 0.95);
      ctx.fillText('这一切都是演的吗', PW / 2, PH * 0.26);
      ctx.textAlign = 'left';
      /* 幕布两片合拢 */
      if (curtain > 0) {
        for (const side of [-1, 1]) {
          const w2 = PW * 0.5 * curtain;
          const x0 = side < 0 ? 0 : PW - w2;
          ctx.fillStyle = rgba('blood', 0.9);
          ctx.fillRect(x0, 0, w2, PH);
          /* 幕布褶 */
          ctx.strokeStyle = rgba('ink', 0.4);
          ctx.lineWidth = 2;
          for (let i = 0; i < 10; i++) {
            const fx = x0 + (i + 0.5) * (w2 / 10);
            ctx.beginPath(); ctx.moveTo(fx, 0); ctx.lineTo(fx, PH); ctx.stroke();
          }
        }
        /* 缝隙的光塌到中心火花 */
        const seam = (1 - curtain) * PW * 0.5;
        if (seam < 200) {
          ctx.fillStyle = rgba('ember', 0.9);
          ctx.fillRect(PW / 2 - seam / 2, 0, seam, PH);
        }
      }
      sparkDot(ctx, PW / 2, PH / 2, 1);
      return { bloom: 0.65, halation: 0.4, grain: 0.12, vignette: 0.6, pdoom: 1, flash: q > 0.93 ? (q - 0.93) / 0.07 * 0.2 : 0 };
    }
  }

  /* ═══════════════════════════════ outro — 我在加我的图层数 = ∞ ═══════════════════════════════ */
  /* TREATMENT：引爆 → 图层数继续涨，一拍一个值（条断了端帽 → 对数尺飞过 → 打满零的墙 →
   * 火花描出 ∞）→ 片尾卡：唱词声部一句一顿，然后 图层数 = ∞ 排成论文公式（带编号 (1)），
   * 火花描边 → 逐拍化简：∞ 转个圈变 8 → 8 的两个圈拉断成 0/0 → 塌到分号上 → NaN¹
   * → 塌回火花 → 画框收拢 → 「↻ 重新生成」按钮，光标点下去，全部倒带，停在第一帧。 */
  class Outro extends Scene {
    static id = 'outro';
    render(f, ctx) {
      const t = f.lt; // outro 内时间（16.4s）
      ctx.fillStyle = rgba('ink'); ctx.fillRect(0, 0, PW, PH);
      const B = D.SPB;

      /* 第一拍：引爆 + 4096.00 */
      if (t < B * 4) {
        const q = t / (B * 4);
        ctx.fillStyle = rgba('signal', Math.max(0, 0.25 - t * 0.3));
        ctx.fillRect(0, 0, PW, PH);
        T(ctx); ctx.textAlign = 'center';
        ctx.font = F.mono(190, 700);
        ctx.fillStyle = rgba('signal', 0.96);
        ctx.fillText('4096.00', PW / 2, PH / 2 - 20);
        /* 条形读数断了端帽 */
        const bw = 700;
        ctx.strokeStyle = rgba('ash', 0.8);
        ctx.lineWidth = 3;
        ctx.strokeRect(PW / 2 - bw / 2, PH / 2 + 110, bw * Math.min(1, 0.98 + q * 0.02), 40);
        if (q > 0.5) {
          ctx.fillStyle = rgba('signal');
          ctx.fillRect(PW / 2 + bw * 0.49, PH / 2 + 100, 20 + q * 30, 60); // 端帽被顶开
        }
        ctx.textAlign = 'left';
        return { bloom: 0.8, flash: Math.max(0, 0.3 - t * 0.5), grain: 0.14, vignette: 0.45, shake: [0.8, 0.3], pdoom: 0 };
      }
      /* 一拍一个值：4097 → 8192 → 1e6 → 1e30；对数尺飞过；零的墙 */
      if (t < B * 12) {
        const seg = Math.floor(t / B) - 4; // 0..7
        T(ctx); ctx.textAlign = 'center';
        const vals = ['4,097', '8,192', '65,536', '1,048,576', '1e9', '1e30', '1e100', '1e1000'];
        ctx.font = F.mono(150, 700);
        ctx.fillStyle = rgba('signal', 0.96);
        ctx.fillText(vals[Math.min(7, Math.max(0, seg))], PW / 2, PH / 2 - 20);
        /* 对数尺：3.14 / 10 / 42 / 1,000 飞过 */
        ctx.font = F.mono(34, 500);
        ctx.fillStyle = rgba('ash', 0.85);
        const ruler = ['3.14', '10', '42', '1,000'];
        ruler.forEach((s, i) => {
          const fx = ((t * 0.7 + i * 0.4) % 1.6 - 0.3) * PW;
          ctx.fillText(s, fx, PH * 0.24 + i * 10);
        });
        /* 火花开始描 ∞ */
        if (seg >= 6) {
          const q = (t - B * 10) / (B * 2);
          ctx.strokeStyle = rgba('signal', 0.9);
          ctx.lineWidth = 4;
          ctx.beginPath();
          for (let i = 0; i <= q * 100; i++) {
            const a = i / 100 * Math.PI * 2;
            const X = PW / 2 + Math.sin(a) * 300;
            const Y = PH * 0.78 + Math.sin(2 * a) * 46;
            i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
          }
          ctx.stroke();
        }
        ctx.textAlign = 'left';
        return { bloom: 0.6, grain: 0.14, vignette: 0.45, pdoom: 0 };
      }
      /* 片尾卡：唱词声部 + 公式化简（∞ → 8 → 0/0 → NaN） */
      const t2 = t - B * 12;
      const TOT = this.duration ?? (this.ctx.end - this.ctx.start);
      const q = Math.min(1, t2 / (TOT - B * 12));
      T(ctx); ctx.textAlign = 'center';
      /* 「我在加我的」唱词声部：一词一拍 */
      if (q < 0.3) {
        const words = ['我在加', '我的'];
        const wi = Math.min(1, Math.floor((q / 0.3) * 2));
        ctx.font = F.archivo(120, 100, 500);
        ctx.fillStyle = rgba('bone', 0.95);
        ctx.fillText(words[wi], PW / 2, PH * 0.3);
      }
      /* 公式：图层数 = X   (1) */
      const forms = ['∞', '8', '0/0', 'NaN'];
      const fi = Math.min(3, Math.floor(q * 4.3));
      const fk = Math.min(1, (q * 4.3) - fi);
      const label = ['图层数', '图层数', '图层数', '图层数'][fi];
      ctx.font = `italic ${Math.round(150)}px ${getComputedStyle(document.documentElement).getPropertyValue('--font-serif')}`;
      ctx.fillStyle = rgba('bone', 0.96);
      ctx.fillText(`${label} = ${forms[fi]}`, PW / 2 - 60, PH * 0.52);
      ctx.font = F.mono(30, 400);
      ctx.fillStyle = rgba('ash', 0.9);
      ctx.fillText('(1)', PW / 2 + 420, PH * 0.52);
      if (fi === 3) {
        ctx.font = F.mono(22, 400);
        ctx.fillStyle = rgba('ash', 0.85);
        ctx.fillText('¹ 估计已不再有意义', PW / 2 - 60, PH * 0.62);
      }
      /* 化简瞬间的热闪 + 塌陷冲击波 */
      if (fk < 0.2) {
        ctx.strokeStyle = rgba('signal', 1 - fk * 5);
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(PW / 2 - 60, PH * 0.52, 200 * (0.5 + fk * 3), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.textAlign = 'left';
      /* 结尾：画框收拢 + ↻ 重新生成 + 倒带闪回 */
      if (q > 0.72) {
        const k = (q - 0.72) / 0.28;
        if (k < 0.55) {
          /* 倒带闪回：色卡快切 + 场景名 */
          const names = ['open', 'loss', 'prompt', 'hook', 'room', 'shoggoth', 'spacetime', 'ascent', 'bureau', 'leftturn', 'paperclips', 'fuse', 'stack', 'dense', 'loom', 'ilya'];
          const i = Math.floor(f.t * 14) % names.length;
          ctx.fillStyle = rgba(['blood', 'graphite', 'signal', 'ash', 'ember'][i % 5], 0.16);
          ctx.fillRect(0, 0, PW, PH);
          T(ctx); ctx.textAlign = 'center';
          ctx.font = F.mono(90, 700);
          ctx.fillStyle = rgba('bone', 0.5);
          ctx.fillText(names[i], PW / 2, PH / 2);
          ctx.textAlign = 'left';
        } else {
          /* 首帧刹车 + ↻ 重新生成按钮 + 光标点下去 */
          const k2 = (k - 0.55) / 0.45;
          T(ctx); ctx.textAlign = 'center';
          const bx = PW / 2, by = PH * 0.66;
          const hover = k2 > 0.5;
          ctx.strokeStyle = rgba(hover ? 'signal' : 'ash', 0.95);
          ctx.lineWidth = 2.4;
          ctx.strokeRect(bx - 170, by - 36, 340, 72);
          ctx.font = F.mono(32, 500);
          ctx.fillStyle = rgba(hover ? 'signal' : 'bone', 0.95);
          ctx.fillText('↻ 重新生成', bx, by);
          /* 光标：从右下滑进来点下去 */
          const cx = PW - 240 - (1 - Math.min(1, k2 * 2)) * 500;
          const cy = PH - 120 - (1 - Math.min(1, k2 * 2)) * 300;
          ctx.strokeStyle = rgba('bone', 0.9);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 18, cy + 10); ctx.lineTo(cx + 7, cy + 13); ctx.lineTo(cx + 10, cy + 24); ctx.closePath(); ctx.stroke();
          if (k2 > 0.86) {
            ctx.fillStyle = rgba('signal', 0.9);
            ctx.beginPath(); ctx.arc(bx + 120, by - 20, (k2 - 0.86) * 90, 0, Math.PI * 2); ctx.stroke();
          }
          ctx.textAlign = 'left';
        }
      }
      return {
        bloom: 0.55, grain: 0.13, vignette: 0.55, pdoom: 0,
        fade: q > 0.97 ? (q - 0.97) / 0.03 : 0,
        zoom: 1 + Math.max(0, q - 0.55) * 0.12, // 画框收拢
      };
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
