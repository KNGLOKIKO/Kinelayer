/**
 * 「我在加我的图层数」的画面代码。
 *
 * 每个字符串都是一个 canvas2d 代码层的完整源码（1920×1080）。与「再改一版」同一套纪律：
 *   - `time` 全局毫秒；`api.tempo` 速度网格；`api.lyrics` 逐字时间；
 *   - 同一毫秒必须永远画出同一帧：不许 Math.random / DOM / Date；
 *   - 歌词字幕带由全片唯一的 HUD 层绘制，场景层不画字幕（词是连续的，层也该连续）。
 *
 * 分镜与视觉乐器逐块对位 pdoom-video 的 TREATMENT，内容换成 MotionLayer：
 * P(doom) → 图层数；TikZ 独角兽 → 图层清单图纸；loss 骤降 → 43→13ms 那次优化；
 * 回形针 → 图层块；transformer 栈 → 命令栈；loom → 撤销树；[MASK] → [蒙版]。
 */

import { ANTHEM_WINDOWS, ANTHEM_HOOK_LAYERS, ANTHEM_LAYER_ANCHORS } from './meta';

const win = (id: string): [number, number] => {
  const w = ANTHEM_WINDOWS.find((x) => x.id === id)!;
  return [w.from, w.to];
};

/** 公共片段：色板 / 字体 / 缓动 / 火花 / 读数 / 图章 —— 与「再改一版」同一套视觉宪法 */
const PRELUDE = String.raw`
const W = width, H = height;
const rnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
const easeInOut = (k) => { k = clamp(k, 0, 1); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const INK = '#08080A', INK2 = '#141416', GRAPHITE = '#5E5B57', ASH = '#9C978F';
const BONE = '#EEE9DF', SIGNAL = '#FF4D12', EMBER = '#FF8A3D', BLOOD = '#C21D0B', ACID = '#D8FF3C';
const mono = (px, w) => (w || 500) + ' ' + px + 'px Consolas, "SF Mono", ui-monospace, monospace';
const sans = (px, w) => (w || 700) + ' ' + px + 'px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
const serifI = (px, w) => 'italic ' + (w || 600) + ' ' + px + 'px Georgia, "Songti SC", serif';
const alpha = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
};
const T = time;
const t = time / 1000;
const P0 = __P0__, P1 = __P1__;
const p = clamp((t - P0) / (P1 - P0), 0, 1);
const lt = t - P0;
const KICK = api.tempo.hit();
const measure2 = (s, f) => { ctx.font = f; return ctx.measureText(s).width; };
/* 火花本体：亮点 + 光晕 —— 整片的主人公 */
const sparkDot = (x, y, k) => {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, 26 + k * 14);
  g.addColorStop(0, alpha(SIGNAL, 1));
  g.addColorStop(0.25, alpha(EMBER, 0.8));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, 26 + k * 14, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
};
/* 一撮迸开的短线 */
const sparks = (x, y, n, seed, speed) => {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const ang = rnd(i * 3.7 + seed) * Math.PI * 2;
    const v = (0.3 + rnd(i * 7.1 + seed) * 0.7) * (speed || 1);
    const life = 0.2 + rnd(i * 5.3 + seed) * 0.5;
    const px = x + Math.cos(ang) * v * 260 * life;
    const py = y + Math.sin(ang) * v * 260 * life + 160 * life * life;
    ctx.strokeStyle = alpha(rnd(i + seed) > 0.3 ? SIGNAL : EMBER, 0.9);
    ctx.lineWidth = 1 + rnd(i * 2.9 + seed) * 2;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px - Math.cos(ang) * 14, py - Math.sin(ang) * 14);
    ctx.stroke();
  }
  ctx.restore();
};
/* 等宽读数（右下角）—— 贯穿母题：逐级递增的数字 */
const readout = (label, value, x, y, color, big) => {
  ctx.font = mono(26);
  ctx.fillStyle = alpha(ASH, 0.85);
  ctx.textAlign = 'right';
  ctx.fillText(label, x, y - 34);
  ctx.font = mono(big || 64, 700);
  ctx.fillStyle = alpha(color || SIGNAL, 0.95);
  ctx.fillText(value, x, y);
  ctx.textAlign = 'left';
};
/* 橡皮图章 */
const stamp = (text, k, x, y, rot, size) => {
  if (k <= 0) return;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); const s = 1 + (1 - k) * 2; ctx.scale(s, s);
  ctx.globalAlpha = k;
  ctx.font = sans(size, 900);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w2 = measure2(text, ctx.font);
  ctx.strokeStyle = alpha(SIGNAL); ctx.lineWidth = 5;
  ctx.strokeText(text, 0, 0);
  ctx.strokeRect(-w2 / 2 - 30, -size * 0.72, w2 + 60, size * 1.35);
  ctx.textAlign = 'left';
  ctx.restore();
};
/* 让 text 在 maxW 内放得下的最大字号 */
const fitSize = (text, px, weight, maxW) => {
  let size = px;
  while (size > 10 && measure2(text, sans(size, weight)) > maxW) size *= 0.92;
  return size;
};
const NOISE = (n) => { for (let i = 0; i < n; i++) { ctx.fillStyle = alpha(BONE, 0.012 + rnd(i + 11) * 0.02); ctx.fillRect(rnd(i * 3.13 + 7) * W, rnd(i * 7.71 + 3) * H, 1, 1); } };
`;

/** 把窗口时间注入源码（秒） */
const withWin = (id: string, body: string): string =>
  body.replace(/__P0__/g, (win(id)[0] / 1000).toFixed(3)).replace(/__P1__/g, (win(id)[1] / 1000).toFixed(3));

/* ───────────────────────────── open — 图层清单图纸 ───────────────────────────── */
export const A_OPEN = withWin('open', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
/* 图纸网格 */
const grid = Math.min(1, lt / 0.6);
ctx.strokeStyle = alpha(GRAPHITE, 0.16 * grid);
ctx.lineWidth = 1;
ctx.beginPath();
for (let x = 80; x < W; x += 60) { ctx.moveTo(x, 60); ctx.lineTo(x, H - 60); }
for (let y = 80; y < H; y += 60) { ctx.moveTo(60, y); ctx.lineTo(W - 60, y); }
ctx.stroke();
/* 绘图仪的笔按拍推进：画布框 → 圆 → 关键帧轨道 */
const penPhase = clamp(api.tempo.beat - 1, 0, 4);
const px = 360, py = 240, pw = 640, ph = 430;
ctx.strokeStyle = alpha(BONE, 0.9);
ctx.lineWidth = 2.5;
const frameK = Math.min(1, penPhase);
if (frameK > 0) {
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + pw * frameK, py);
  if (frameK >= 1) ctx.lineTo(px + pw, py + ph * Math.min(1, penPhase - 1));
  ctx.stroke();
}
if (penPhase > 1.6) {
  const k = Math.min(1, (penPhase - 1.6));
  ctx.strokeStyle = alpha(ASH, 0.9);
  ctx.beginPath();
  ctx.ellipse(px + pw * 0.32, py + ph * 0.5, 90 * k, 110 * k, 0, 0, Math.PI * 2);
  ctx.stroke();
}
if (penPhase > 2.6) {
  const k = Math.min(1, (penPhase - 2.6) / 1.2);
  ctx.strokeStyle = alpha(GRAPHITE, 0.8);
  ctx.beginPath(); ctx.moveTo(px + 40, py + ph - 50); ctx.lineTo(px + pw - 40, py + ph - 50); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const kk = clamp(k * 3 - i, 0, 1);
    if (kk <= 0) continue;
    const dx = px + 40 + ((pw - 80) / 2) * i;
    ctx.save();
    ctx.translate(dx, py + ph - 50); ctx.rotate(Math.PI / 4);
    const s = 11 * kk;
    ctx.fillStyle = alpha(SIGNAL, 0.95);
    ctx.fillRect(-s, -s, s * 2, s * 2);
    ctx.restore();
  }
}
const penX = px + pw * Math.min(1, frameK), penY = py + (penPhase > 1 ? ph * 0.5 : 0);
sparkDot(penX, penY, KICK);
if (KICK > 0.7) sparks(penX, penY, 18, Math.floor(api.tempo.beat) * 13, 0.5 + KICK);
/* 命令清单逐字打出 */
const CMDS = ['layer.add(矩形)', 'layer.add(圆)', 'track.add(关键帧 ×3)'];
ctx.font = mono(24);
const cmdIdx = Math.min(CMDS.length - 1, Math.floor(penPhase / 1.3));
ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
ctx.fillStyle = alpha(ASH, 0.85);
for (let i = 0; i <= cmdIdx; i++) {
  const n = i < cmdIdx ? CMDS[i].length : Math.floor(clamp(penPhase - i * 1.3, 0, 1) * CMDS[i].length);
  ctx.fillText('> ' + CMDS[i].slice(0, Math.max(0, n)), px + pw + 80, py + 60 + i * 46);
}
/* 意外度读数滚到 0.00 —— 一切都在计划内 */
const L3 = api.lyrics.lines[2];
if (t >= L3.start / 1000) {
  const k = clamp((t - L3.start / 1000) / (L3.end / 1000 - L3.start / 1000), 0, 1);
  readout('意外度 −log p', (2.41 * (1 - k) * (1 - k)).toFixed(2) + ' nat', W / 2 + 420, H * 0.82, ASH, 40);
}
NOISE(120);
`);

/* ───────────────────────────── loss — 帧耗时，突然 ───────────────────────────── */
export const A_LOSS = withWin('loss', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const SPLIT = 0.55;
if (p < SPLIT) {
  /* 相位一：发丝图表 */
  const ax = 200, ay = 200, aw = W - 380, ah = H - 420;
  ctx.strokeStyle = alpha(GRAPHITE, 0.6);
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay + ah); ctx.lineTo(ax + aw, ay + ah); ctx.stroke();
  ctx.font = mono(20);
  ctx.fillStyle = alpha(ASH, 0.8);
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText('ms/帧（对数）', ax - 10, ay - 24);
  ctx.fillText('帧', ax + aw + 14, ay + ah);
  const yLabels = ['50', '30', '20', '16.7', '13', '9'];
  for (let i = 0; i <= 5; i++) {
    const yy = ay + (ah / 5) * i;
    ctx.beginPath(); ctx.moveTo(ax - 8, yy); ctx.lineTo(ax, yy); ctx.stroke();
    ctx.fillText(yLabels[i], ax - 74, yy);
  }
  /* 火花画曲线：噪声平台 → 悬崖（43 → 13，本项目真实发生的那次优化） */
  const prog = Math.min(1, (p / SPLIT) * 1.15);
  ctx.strokeStyle = alpha(SIGNAL); ctx.lineWidth = 3;
  ctx.beginPath();
  let hy = ay;
  for (let i = 0; i <= 140; i++) {
    const x = i / 140;
    if (x > prog) break;
    const drop = clamp((x - 0.62) / 0.06, 0, 1);
    const v = 50 * Math.pow(13 / 50, Math.pow(drop, 0.7));
    hy = ay + (ah * (v - 9)) / 45 + Math.sin(x * 40 + Math.floor(x * 30)) * (1 - drop) * 7;
    const X = ax + aw * x;
    if (i === 0) ctx.moveTo(X, hy); else ctx.lineTo(X, hy);
  }
  ctx.stroke();
  sparkDot(ax + aw * prog, hy, KICK);
  if (prog > 0.68) {
    ctx.font = mono(22, 500);
    ctx.fillStyle = alpha(SIGNAL, 0.95);
    ctx.fillText('43 → 13', ax + aw * 0.68 + 16, ay + ah * 0.24);
  }
} else {
  /* 相位二：等高线峡谷，镜头下坠；结尾世界滚 180° */
  const q = (p - SPLIT) / (1 - SPLIT);
  const roll = p > 0.86 ? clamp((p - 0.86) / 0.12, 0, 1) : 0;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(Math.PI * roll);
  ctx.translate(-W / 2, -H / 2);
  const sink = Math.min(1, q * 2.2);
  const cx = W / 2 + Math.sin(q * 9) * 180 * (1 - sink), cy = H / 2;
  ctx.strokeStyle = alpha(GRAPHITE, 0.75);
  ctx.lineWidth = 1.4;
  for (let i = 1; i < 15; i++) {
    ctx.globalAlpha = 0.9 - i * 0.05;
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 40) {
      const wob = 1 + Math.sin(a * 3 + i) * 0.16 + Math.sin(a * 7 - i * 2) * 0.07;
      const X = cx + Math.cos(a) * i * 64 * wob * (1 + sink * 1.6);
      const Y = cy + Math.sin(a) * i * 64 * wob * (1 - sink * 0.4) + (i - sink * 12) * 12;
      if (a === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  sparkDot(cx, H / 2 + (q - 0.5) * H * 0.8, KICK);
  /* 等级倒置：乙方巨大，老板很小 */
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = sans(150 * (1 - q * 0.4), 900);
  ctx.fillStyle = alpha(BONE);
  ctx.fillText('乙方', W / 2, H * 0.3);
  ctx.font = sans(34, 400);
  ctx.fillStyle = alpha(GRAPHITE);
  ctx.fillText('老板', W / 2 + 130, H * 0.3 + 60);
  ctx.textAlign = 'left';
  ctx.restore();
}
`);

/* ───────────────────── prompt ×3 — 恳求，作为 token（params.variant） ───────────────────── */
export const A_PROMPT = withWin('prompt1', `${PRELUDE}
/* 三个变体（canvas / undo / export）共用一份源码，靠 params.variant 区分 —— 原片 prompt ×3 同构 */
const variant = api.params.variant || 'canvas';
const line = api.lyrics.at() || api.lyrics.lines[5];
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
if (variant === 'canvas') {
  /* 同心刻版圆环缓慢收拢，⏎ 时扑面而来 */
  const rush = p > 0.93 ? (p - 0.93) / 0.07 : 0;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(1 + rush * 2.2, 1 + rush * 2.2);
  for (let i = 1; i < 9; i++) {
    ctx.strokeStyle = alpha(GRAPHITE, 0.32);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, i * 110 - ((lt * 8000) % 40), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
} else if (variant === 'undo') {
  /* 竖栏在拍点上收拢 */
  const close = 0.35 + 0.3 * Math.min(1, p * 1.4) + KICK * 0.08;
  for (let i = 0; i < 6; i++) {
    const x = 120 + i * ((W - 240) / 5);
    const off = (i < 3 ? -1 : 1) * (1 - close) * 260;
    ctx.fillStyle = alpha(INK2, 0.9);
    ctx.fillRect(x - 26 + off, 0, 52, H);
    ctx.strokeStyle = alpha(GRAPHITE, 0.5);
    ctx.strokeRect(x - 26 + off, 0, 52, H);
  }
}
/* 输入框：细线 + 按逐字时间打出的恳求 + 唱中字符上方的 next-token 分布 */
const fieldY = variant === 'export' ? H * 0.46 : H * 0.4;
const size = variant === 'export' ? 44 : 56;
const font = sans(size, 500);
ctx.font = font;
const chars = Array.from(line.text);
const units = api.lyrics.units(line);
const widths = chars.map((c) => measure2(c, font));
const total = widths.reduce((a, b) => a + b, 0);
let x = W / 2 - total / 2;
const drift = variant === 'export' ? Math.max(0, p - 0.7) * 220 : 0;
ctx.strokeStyle = alpha(GRAPHITE, 0.7);
ctx.lineWidth = 2;
ctx.beginPath(); ctx.moveTo(x - 60, fieldY + size); ctx.lineTo(W / 2 + total / 2 + 60 + drift, fieldY + size); ctx.stroke();
let cursorX = x;
const POOL = variant === 'undo' ? ['时间', '快照', '历史', '版本', '后悔', '一步', '三步']
  : variant === 'export' ? ['序列', 'mp4', '帧', '进度条', '等待', '灰了', '好了'] : ['老板', '图层', '甲方', '渲染', '像素', '导出', '算了'];
ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
for (let i = 0; i < chars.length; i++) {
  const u = units[i];
  const prog = u ? api.lyrics.progress(u) : 0;
  /* 唱中的字符上方：4 个候选 + 概率条，采样的那个亮橙 */
  if (prog > 0 && prog < 1) {
    ctx.font = mono(17);
    let yy = fieldY - 38;
    for (let j = 0; j < 4; j++) {
      const isSelf = j === 0;
      const cand = isSelf ? chars[i] : POOL[Math.floor(rnd(i * 13.7 + j * 31.3) * POOL.length)];
      const prob = isSelf ? 0.38 + rnd(i * 7.7) * 0.3 : 0.02 + rnd(i * 5.1 + j) * 0.16;
      ctx.fillStyle = alpha(isSelf ? SIGNAL : GRAPHITE, 0.85);
      ctx.fillText(cand, x, yy);
      ctx.fillRect(x + 96, yy - 5, prob * 130, 9);
      ctx.fillStyle = alpha(ASH, 0.7);
      ctx.fillText(prob.toFixed(2), x + 96 + prob * 130 + 10, yy);
      yy -= 26;
    }
    ctx.font = font;
  }
  ctx.fillStyle = prog > 0 ? alpha(prog >= 1 ? BONE : SIGNAL, 0.95) : alpha(GRAPHITE, 0.6);
  ctx.fillText(chars[i], x + drift * i * 0.5, fieldY);
  x += widths[i];
  if (prog > 0) cursorX = x + drift * i * 0.5;
}
if (p > 0.92) {
  ctx.font = mono(40, 500);
  ctx.fillStyle = alpha(SIGNAL);
  ctx.fillText('⏎', cursorX + 26, fieldY);
} else if (Math.floor(t * 2.4) % 2 === 0) {
  ctx.fillStyle = alpha(BONE);
  ctx.fillRect(cursorX + 8, fieldY - size * 0.55, 15, size * 1.05);
}
/* undo 变体：回信 + 一条不安的微笑曲线 */
if (variant === 'undo' && p > 0.5) {
  ctx.font = mono(26);
  ctx.fillStyle = alpha(ASH, 0.9);
  const msg = '已撤销 1 步（共 4096 步）';
  const n = Math.floor(clamp((p - 0.5) / 0.4, 0, 1) * msg.length);
  ctx.textAlign = 'center';
  ctx.fillText(msg.slice(0, n), W / 2, fieldY + 120);
  if (p > 0.86) {
    const k = (p - 0.86) / 0.12;
    ctx.strokeStyle = alpha(SIGNAL, k);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(W / 2, fieldY + 230, 46, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();
  }
  ctx.textAlign = 'left';
}
const hit = p > 0.93 ? (p - 0.93) / 0.07 : 0;
if (hit > 0) { ctx.fillStyle = alpha('#FFF6EE', hit * 0.35); ctx.fillRect(0, 0, W, H); }
`);

/* ───────────────────── hook ×4 — 图层数大字（params.n = 1..4） ───────────────────── */
export const A_HOOK = withWin('hook1', `${PRELUDE}
/* 「我 / 在加 / 我的 / 图层数」四 token 四记 hit，全幅砸下；「在加」真的上升；
 * 「图层数」像数学式排版，数字离场滚到本钩子的值。四档递进：
 * ①净版 ②橙底黑字 ③hairline 瘆人 ④频闪叠影。 */
const n = api.params.n || 1;
const line = api.lyrics.lines[6 + (n - 1) * 11];
const groups = [[0], [1, 2], [3, 4], [5, 6, 7]];
const units = api.lyrics.units(line);
const gi = Math.min(3, Math.max(0, Math.floor(p * 4.6)));
const g = groups[gi];
const value = [15, 64, 999, 4096][n - 1];
const firstUnit = units[g[0]];
const sung = firstUnit ? t >= firstUnit.start / 1000 : false;
const hitK = sung ? clamp((t - firstUnit.start / 1000) / 0.14, 0, 1) : 0;
const text = ['我', '在加', '我的', '图层数'][gi];
ctx.save();
if (n === 2) { ctx.fillStyle = alpha(SIGNAL); ctx.fillRect(0, 0, W, H); }
if (n === 4) ctx.translate((rnd(Math.floor(t * 60)) - 0.5) * 14, (rnd(Math.floor(t * 60) + 3) - 0.5) * 14);
ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
const base = Math.min(300, fitSize(text, 300, 900, W - 220));
ctx.save();
ctx.translate(W / 2, H / 2 - 40);
if (text === '在加') { ctx.translate(0, -60 * hitK); ctx.scale(1, 1 + hitK * 0.3); }
if (n === 3) ctx.scale(0.42, 0.42);
const punch = 1 + (1 - hitK) * 0.9;
ctx.scale(punch, punch);
ctx.font = sans(base, n === 3 ? 300 : 900);
if (n === 4) {
  for (let o = 2; o >= 0; o--) {
    ctx.strokeStyle = alpha(o === 0 ? SIGNAL : ASH, o === 0 ? 0.95 : 0.35);
    ctx.lineWidth = o === 0 ? 3 : 1.4;
    ctx.strokeText(text, o * 8, o * -6);
  }
  ctx.fillStyle = alpha(BONE, Math.floor(t * 24) % 2 ? 1 : 0.75);
  ctx.fillText(text, 0, 0);
} else {
  ctx.fillStyle = alpha(n === 2 ? INK : BONE, n === 3 ? 0.8 : 0.95);
  ctx.fillText(text, 0, 0);
}
ctx.restore();
/* 「图层数」×2ⁿ + 数字离场滚到本钩子的值 */
if (text === '图层数' && sung) {
  ctx.font = sans(base * 0.22, 500);
  ctx.fillStyle = alpha(n === 2 ? INK : SIGNAL);
  ctx.fillText('×2ⁿ', W / 2 + base * 0.62, H / 2 - 40 - base * 0.38);
  const rollK = clamp((t - firstUnit.start / 1000) / 0.5, 0, 1);
  const shown = Math.round(value * rollK * rollK * (3 - 2 * rollK));
  const numFont = Math.min(200, fitSize(String(shown) + '0000', 200, 700, W - 200));
  ctx.font = mono(numFont, 700);
  ctx.fillStyle = alpha(SIGNAL, 0.96);
  ctx.fillText(String(shown), W / 2, H * 0.72);
}
ctx.textAlign = 'left';
ctx.restore();
if (n === 4) { ctx.fillStyle = alpha('#FFF6EE', 0.05 + KICK * 0.06); ctx.fillRect(0, 0, W, H); }
`);

/* ───────────────────────────── room — 主窗口，从内部看 ───────────────────────────── */
export const A_ROOM = withWin('room', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const L7 = api.lyrics.lines[7], L8 = api.lyrics.lines[8], L9 = api.lyrics.lines[9];
const t8 = L8.start / 1000;
if (t < t8) {
  /* 指数分支爆炸：1→2→4→8→…，每 8 分音符翻一倍 */
  const q = clamp((t - L7.start / 1000) / (t8 - L7.start / 1000), 0, 1);
  const gen = Math.min(7, Math.floor(q * 9));
  ctx.strokeStyle = alpha(BONE, 0.9);
  ctx.lineWidth = 2.4;
  const draw = (x, y, ang, len, g) => {
    if (g >= gen) return;
    const nx = x + Math.cos(ang) * len, ny = y + Math.sin(ang) * len;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
    const spread = 0.5 + g * 0.12;
    draw(nx, ny, ang - spread, len * 0.72, g + 1);
    draw(nx, ny, ang + spread, len * 0.72, g + 1);
  };
  draw(W / 2, H + 40, -Math.PI / 2, 130, 0);
  const ringN = Math.floor(t * 4) % 3;
  for (let i = 0; i <= ringN; i++) {
    ctx.strokeStyle = alpha(SIGNAL, 0.6 - i * 0.18);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(W / 2, H * 0.4, 90 + i * 130 + KICK * 30, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = sans(150, 900);
  ctx.fillStyle = alpha(SIGNAL, 0.95);
  ctx.fillText('指数爆炸', W / 2, H * 0.4);
  ctx.textAlign = 'left';
} else {
  /* 主窗口走廊：手持镜头每拍一切（whip / roll / punch / orbit） */
  const beatIdx = Math.floor(api.tempo.beat);
  const shot = beatIdx % 4;
  ctx.save();
  if (shot === 0) ctx.translate(Math.sin(api.tempo.beatPhase * Math.PI) * 30, 0);
  if (shot === 1) ctx.rotate(Math.sin(api.tempo.beatPhase * Math.PI) * 0.04);
  if (shot === 2) { const z = 1 + 0.14 * Math.sin(api.tempo.beatPhase * Math.PI); ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2); }
  if (shot === 3) ctx.translate(Math.cos(api.tempo.beatPhase * Math.PI) * 26, Math.sin(api.tempo.beatPhase * Math.PI) * 10);
  const vpx = W / 2 + (shot === 3 ? 60 : 0), vpy = H * 0.44;
  ctx.strokeStyle = alpha(GRAPHITE, 0.6);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = -7; i <= 7; i++) {
    ctx.moveTo(vpx + i * 46, vpy); ctx.lineTo(vpx + i * 640, H);
    ctx.moveTo(vpx + i * 46, vpy); ctx.lineTo(vpx + i * 640, 0);
  }
  ctx.stroke();
  for (let i = 1; i < 12; i++) {
    const zt = (i + (lt * 0.24) % 1) / 12;
    const y = vpy + (H - vpy) * zt * zt;
    ctx.globalAlpha = 1 - zt * 0.5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  /* 挂牌逐字盖章 */
  const sung = Math.max(0, Math.min(5, api.lyrics.chars(L8)));
  ctx.font = sans(64, 800);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const sign = '主窗口';
  let sx = vpx - measure2(sign, ctx.font) / 2;
  for (let i = 0; i < sign.length; i++) {
    ctx.fillStyle = i < sung ? alpha(SIGNAL) : alpha(ASH, 0.85);
    ctx.fillText(sign[i], sx + measure2(sign[i], ctx.font) / 2, vpy - 120);
    sx += measure2(sign[i], ctx.font);
  }
  ctx.strokeRect(vpx - 180, vpy - 160, 360, 84);
  ctx.textAlign = 'left';
  /* 拍点上：未保存卡片从槽口射出 */
  if (KICK > 0.55) {
    for (let i = 0; i < 3; i++) {
      const cx2 = vpx + (i - 1) * 120, cy2 = vpy + 90 + KICK * 180;
      ctx.save();
      ctx.translate(cx2, cy2); ctx.rotate((i - 1) * 0.3);
      ctx.fillStyle = alpha(BONE, 0.9 * KICK);
      ctx.fillRect(-52, -30, 104, 60);
      ctx.fillStyle = alpha(BLOOD);
      ctx.font = mono(16, 500);
      ctx.textAlign = 'center';
      ctx.fillText('未保存', 0, 0);
      ctx.textAlign = 'left';
      ctx.restore();
    }
  }
  ctx.restore();
  /* 糖袋落地：acid 一瞬 + 菌丝 */
  if (t >= L9.start / 1000) {
    const q = clamp((t - L9.start / 1000) / (L9.end / 1000 - L9.start / 1000), 0, 1);
    ctx.fillStyle = alpha(ACID, 0.1 + 0.08 * Math.sin(t * 9));
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = alpha(ACID, 0.75);
    ctx.lineWidth = 1.6;
    for (let i = 0; i < 26; i++) {
      const x0 = W / 2 + (rnd(i * 3.1) - 0.5) * 80, y0 = H * 0.66;
      const ang = -Math.PI / 2 + (rnd(i * 7.7) - 0.5) * 2.4;
      const len = q * (140 + rnd(i * 5.9) * 420);
      ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + Math.cos(ang) * len * 0.5 + (rnd(i * 9.3) - 0.5) * 90, y0 + Math.sin(ang) * len * 0.6, x0 + Math.cos(ang) * len, y0 + Math.sin(ang) * len);
      ctx.stroke();
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = sans(200, 900);
    ctx.fillStyle = alpha(ACID, 0.95);
    ctx.fillText('糖', W / 2, H * 0.32 - q * 90);
    ctx.textAlign = 'left';
  }
}
`);

/* ───────────────────── shoggoth — 面具下的命令总线 ───────────────────── */
export const A_SHOGGOTH = withWin('shoggoth', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const L10 = api.lyrics.lines[10], L11 = api.lyrics.lines[11];
const reveal = clamp((t - L10.start / 1000) / ((L11.end / 1000 - L10.start / 1000) * 0.7), 0, 1);
const flat = t > L11.end / 1000 + 0.4;
const cx = W / 2, cy = H * 0.5;
if (reveal > 0) {
  ctx.save();
  ctx.globalAlpha = reveal;
  const flatK = flat ? clamp((t - L11.end / 1000 - 0.4) / 0.9, 0, 1) : 0;
  /* 管状触手团：贝塞尔管 + 橙缘 */
  for (let i = 0; i < 14; i++) {
    const a0 = (i / 14) * Math.PI * 2;
    const x0 = cx + Math.cos(a0) * 60, y0 = cy + Math.sin(a0) * 50;
    const x1 = cx + Math.cos(a0 + 0.5) * (140 + rnd(i * 7.1) * 120);
    const y1 = cy + Math.sin(a0 + 0.5) * (120 + rnd(i * 3.3) * 90) * (1 - flatK);
    const x2 = cx + Math.cos(a0 + 2.2) * (260 + rnd(i * 9.7) * 200);
    const y2 = cy + Math.sin(a0 + 2.2) * (200 + rnd(i * 5.9) * 160) * (1 - flatK) + flatK * 40;
    const wob = Math.sin(t * (0.7 + i * 0.05) + i * 2) * 14 * (1 - flatK);
    ctx.strokeStyle = alpha(GRAPHITE, 0.9);
    ctx.lineWidth = 14 - (i % 3) * 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(x1 + wob, y1 - wob, x2, y2, x2 + wob * 2, y2 + wob);
    ctx.stroke();
    ctx.strokeStyle = alpha(SIGNAL, 0.5);
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  /* 眼睛：逐 hit 睁开；flatline 时依次闭上 */
  for (let i = 0; i < 8; i++) {
    const ex = cx + Math.cos(i * 2.3) * (150 + rnd(i * 9) * 200);
    const ey = cy + Math.sin(i * 1.7) * (120 + rnd(i * 5) * 160) * (1 - flatK);
    const open = flat ? Math.max(0, 1 - Math.max(0, flatK * 8 - i) / 1.5) : Math.min(1, Math.max(0, KICK * 3 - i * 0.4 + reveal * 2));
    if (open <= 0) continue;
    ctx.strokeStyle = alpha(BONE, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(ex, ey, 16, 9 * open, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = alpha(SIGNAL, 0.9);
    ctx.beginPath(); ctx.ellipse(ex, ey, 3.4, 8 * open, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (flatK >= 1) {
    ctx.strokeStyle = alpha(SIGNAL, 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
  }
  ctx.restore();
}
/* 面具：骨白圆盘 + 两点 + 一条弧 */
const maskA = 1 - reveal * 0.92;
if (maskA > 0.01) {
  ctx.globalAlpha = maskA;
  ctx.fillStyle = alpha(BONE);
  ctx.beginPath(); ctx.arc(cx, cy, 250, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = alpha(INK);
  ctx.beginPath(); ctx.arc(cx - 80, cy - 40, 14, 0, Math.PI * 2); ctx.arc(cx + 80, cy - 40, 14, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = alpha(INK); ctx.lineWidth = 6;
  ctx.beginPath(); ctx.arc(cx, cy + 20, 110, 0.3 * Math.PI, 0.7 * Math.PI); ctx.stroke();
  ctx.font = mono(22);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = alpha(GRAPHITE);
  ctx.fillText('简单 · 好用', cx, cy - 150);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}
/* 检查器标签（左缘）：名字 + 存活计数，引线连到眼睛；闭眼即 EXPIRED */
if (t >= L11.start / 1000 && reveal > 0.5) {
  ctx.font = mono(18);
  ctx.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) {
    const dead = flat && flatK * 4 > i;
    const ty = 180 + i * 90;
    const ex = cx + Math.cos(i * 2.3) * (150 + rnd(i * 9) * 200);
    const ey = cy + Math.sin(i * 1.7) * (120 + rnd(i * 5) * 160);
    ctx.strokeStyle = alpha(GRAPHITE, 0.6);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(320, ty); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.fillStyle = alpha(dead ? GRAPHITE : ASH, 0.9);
    ctx.fillText('图层-' + String(i + 7).padStart(2, '0') + ' · 存活 ' + (3.2 - i * 0.4).toFixed(1) + 's', 40, ty);
    if (dead) {
      const w2 = measure2('图层-' + String(i + 7).padStart(2, '0') + ' · 存活 ' + (3.2 - i * 0.4).toFixed(1) + 's', ctx.font);
      ctx.strokeStyle = alpha(BLOOD, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(36, ty); ctx.lineTo(44 + w2, ty - 8); ctx.stroke();
      ctx.fillStyle = alpha(BLOOD, 0.9);
      ctx.fillText('EXPIRED', 44 + w2 + 14, ty);
    }
  }
}
`);

/* ───────────────────── spacetime — 四个乐章 ───────────────────── */
export const A_SPACETIME = withWin('spacetime', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const L12 = api.lyrics.lines[12], L13 = api.lyrics.lines[13], L14 = api.lyrics.lines[14], L15 = api.lyrics.lines[15];
if (t < L13.start / 1000) {
  /* ① 示波器 */
  const px = 180, py = 220, pw = W - 360, ph = H - 480;
  ctx.fillStyle = alpha(INK2);
  ctx.fillRect(px, py, pw, ph);
  ctx.strokeStyle = alpha(GRAPHITE, 0.6);
  ctx.strokeRect(px + 0.5, py + 0.5, pw, ph);
  for (let e = 2; e >= 0; e--) {
    ctx.strokeStyle = alpha(SIGNAL, 0.85 - e * 0.28);
    ctx.lineWidth = e === 0 ? 2.6 : 1.4;
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const x = px + (pw * i) / 200;
      const y = py + ph / 2 + Math.sin((i / 200) * Math.PI * 6 + t * (e + 1) * 2) * ph * 0.24;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
} else if (t < L14.start / 1000) {
  /* ② 黑洞：光子环包字 */
  const q = clamp((t - L13.start / 1000) / (L14.start / 1000 - L13.start / 1000), 0, 1);
  const R = 60 + q * 90;
  const cx = W / 2, cy = H * 0.44;
  ctx.strokeStyle = alpha(EMBER, 0.9);
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = alpha(SIGNAL, 0.5);
  ctx.lineWidth = 14;
  ctx.beginPath(); ctx.arc(cx, cy, R + 16, 0, Math.PI * 2); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = sans(52, 700);
  const word = '奇点';
  for (let i = 0; i < word.length; i++) {
    const a = -Math.PI / 2 + (i - 0.5) * 0.5;
    ctx.fillStyle = alpha(BONE, 0.95);
    ctx.fillText(word[i], cx + Math.cos(a) * (R + 58), cy + Math.sin(a) * (R + 58));
  }
  ctx.textAlign = 'left';
  ctx.save();
  ctx.translate(0, q * 120);
  ctx.restore();
} else if (t < L15.start / 1000) {
  /* ③ 涡流：唱词逐字拉长 */
  ctx.save();
  ctx.translate(W / 2, H / 2);
  for (let s = 0; s < 12; s++) {
    ctx.strokeStyle = alpha(GRAPHITE, 0.5);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const a = s * 0.53 + i * 0.24 + t * 1.6;
      const r = 30 + i * 18;
      const X = Math.cos(a) * r, Y = Math.sin(a) * r * 0.62;
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke();
  }
  ctx.restore();
  /* 逐字拉伸 */
  ctx.textBaseline = 'middle';
  const font = sans(66, 700);
  ctx.font = font;
  const chars = Array.from(L14.text);
  const units = api.lyrics.units(L14);
  const wsum = chars.reduce((a, c) => a + measure2(c, font), 0) + chars.length * 8;
  let x = W / 2 - wsum / 2;
  for (let i = 0; i < chars.length; i++) {
    const prog = units[i] ? api.lyrics.progress(units[i]) : 0;
    ctx.save();
    ctx.translate(x, H * 0.78);
    ctx.scale(1 + prog * 1.1, 1);
    ctx.fillStyle = prog > 0 ? alpha(BONE, 0.95) : alpha(GRAPHITE, 0.6);
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    x += measure2(chars[i], font) + 8 + prog * measure2(chars[i], font) * 1.1;
  }
} else {
  /* ④ 像素圆点脱队 → 重排成图层块轮廓 */
  const q = clamp((t - L15.start / 1000) / (L15.end / 1000 - L15.start / 1000), 0, 1);
  const N = 26;
  const bx = W / 2 - 240, by = H / 2 - 150, bw = 480, bh = 300;
  ctx.strokeStyle = alpha(ASH, q * 0.9);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(bx, by, bw, bh);
  const per = Math.floor((bw * 2 + bh * 2) / N);
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 6 + t * 2;
    const sx2 = W / 2 + Math.cos(a0) * (300 + rnd(i * 3) * 220);
    const sy2 = H / 2 + Math.sin(a0) * (180 + rnd(i * 7) * 140);
    const d = i * per;
    const edge = d < bw ? [bx + d, by] : d < bw + bh ? [bx + bw, by + (d - bw)] : d < bw * 2 + bh ? [bx + bw - (d - bw - bh), by + bh] : [bx, by + bh - (d - bw * 2 - bh)];
    ctx.fillStyle = alpha(SIGNAL, 0.95);
    ctx.beginPath(); ctx.arc(sx2 + (edge[0] - sx2) * q, sy2 + (edge[1] - sy2) * q, 5, 0, Math.PI * 2); ctx.fill();
  }
}
`);

/* ───────────────────── ascent — 上升（对数刻度） ───────────────────── */
export const A_ASCENT = withWin('ascent', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const L18 = api.lyrics.lines[18], L19 = api.lyrics.lines[19], L20 = api.lyrics.lines[20], L21 = api.lyrics.lines[21];
ctx.textBaseline = 'middle';
if (t < L19.start / 1000) {
  /* ① 仪表之眼：刻版鳞纹 + 竖缝瞳孔，「轰鸣」上弹开 */
  const open = clamp((t - (L18.start / 1000 + 1.1)) / 0.3, 0, 1);
  const cx = W / 2, cy = H * 0.46;
  /* 刻版 hatch：一组平行细线 */
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - 260, cy - 170, 520, 340); ctx.clip();
  ctx.strokeStyle = alpha(GRAPHITE, 0.5 * (1 - open * 0.3));
  ctx.lineWidth = 1.2;
  for (let d = -420; d <= 420; d += 9) { ctx.beginPath(); ctx.moveTo(cx - 260, cy + d - 170); ctx.lineTo(cx + 260, cy + d + 170); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = alpha(BONE, 0.95);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(cx, cy, 240, 160, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = alpha(SIGNAL);
  ctx.beginPath(); ctx.ellipse(cx, cy, 7, 130 * open, 0, 0, Math.PI * 2); ctx.fill();
} else if (t < L20.start / 1000) {
  /* ② 帧率 K 线冲月：雕纹烛形 + 钞票雕纹月亮，镜头上摇 */
  const q = clamp((t - L19.start / 1000) / (L20.start / 1000 - L19.start / 1000), 0, 1);
  ctx.save();
  ctx.translate(0, q * H * 0.5);
  const mx = W / 2, my = 200;
  ctx.strokeStyle = alpha(BONE, 0.85);
  ctx.lineWidth = 1.4;
  for (let i = 1; i < 12; i++) {
    ctx.beginPath();
    for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 36) {
      const r = i * 13 * (1 + Math.sin(a * 5 + i) * 0.06);
      const X = mx + Math.cos(a) * r * 2.2, Y = my + Math.sin(a) * r;
      if (a === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke();
  }
  const n = 22;
  for (let i = 0; i < n; i++) {
    const x = 140 + i * ((W - 320) / n);
    const g = Math.pow(i / n, 2.1) * (H * 1.3);
    const hi = H - 120 - g, lo = hi + 60 + rnd(i * 5) * 50;
    ctx.strokeStyle = alpha(ASH, 0.85);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 14, lo); ctx.lineTo(x + 14, hi); ctx.stroke();
    if (i / n < q) {
      ctx.fillStyle = alpha(i % 3 === 1 ? GRAPHITE : BONE, 0.9);
      ctx.fillRect(x, Math.min(lo, hi) + 10, 28, Math.max(8, (lo - hi) * 0.5));
    }
  }
  sparkDot(140 + q * (W - 320), H - 120 - Math.pow(q, 2.1) * (H * 1.3) + 20, KICK);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.font = mono(30, 500);
  ctx.fillStyle = alpha(BONE, 0.9);
  ctx.fillText('· 60 FPS ·', W / 2, 420);
  ctx.textAlign = 'left';
} else if (t < L21.start / 1000) {
  /* ③ 所有线收束到一个白热点，衬线斜体缩进去 */
  const q = clamp((t - L20.start / 1000) / (L21.start / 1000 - L20.start / 1000), 0, 1);
  const cx = W / 2, cy = H * 0.46;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r = (1 - q) * (260 + rnd(i * 11) * 320);
    ctx.strokeStyle = alpha(GRAPHITE, 0.7);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55);
    ctx.stroke();
  }
  sparkDot(cx, cy, 1);
  ctx.textAlign = 'center';
  ctx.font = serifI(90 * (1 - q * 0.85), 600);
  ctx.fillStyle = alpha(BONE, 0.95);
  ctx.fillText('下个版本', cx, cy - (1 - q) * 220 - 40);
  ctx.textAlign = 'left';
} else {
  /* ④ 31 位数字滚轮 → 1e30 帧/秒 */
  const digits = 31;
  const rollV = clamp((t - L21.start / 1000) / (L21.end / 1000 - L21.start / 1000), 0, 1);
  const target = '1000000000000000000000000000000';
  const shown = target.slice(0, Math.max(1, Math.round(rollV * digits)));
  const dw = 44;
  const ox = W / 2 - (digits * dw) / 2;
  ctx.font = mono(52, 700);
  for (let i = 0; i < digits; i++) {
    const x = ox + i * dw;
    ctx.strokeStyle = alpha(GRAPHITE, 0.6);
    ctx.strokeRect(x + 1, H * 0.4 - 34, dw - 4, 68);
    const rolling = i === shown.length - 1 && rollV < 1;
    ctx.fillStyle = alpha(BONE, 0.95);
    ctx.fillText(target[i] && i < shown.length ? target[i] : '0', x + dw / 2 - 12, H * 0.4 + (rolling ? Math.sin(t * 20) * 8 : 0));
  }
  ctx.font = mono(20);
  ctx.fillStyle = alpha(ASH, 0.85);
  ctx.fillText('帧 / 秒 · ¹ 此数字无物理意义', ox, H * 0.4 + 110);
}
`);

/* ───────────────────── bureau — 纸面工作（反白） ───────────────────── */
export const A_BUREAU = withWin('bureau', `${PRELUDE}
ctx.fillStyle = BONE; ctx.fillRect(0, 0, W, H);
const inkA = (a) => alpha(INK, a);
const L22 = api.lyrics.lines[22], L23 = api.lyrics.lines[23], L24 = api.lyrics.lines[24];
ctx.textBaseline = 'middle';
if (t < L23.start / 1000) {
  /* 表单 7-B：渲染前完整性自评 */
  ctx.font = mono(30, 500); ctx.fillStyle = inkA(0.9);
  ctx.fillText('表单 7-B · 渲染前完整性自评', 160, 150);
  ctx.strokeStyle = inkA(0.8); ctx.lineWidth = 2;
  ctx.strokeRect(140, 190, W - 320, 560);
  const fields = ['图层引用完整性', '关键帧闭合性', '绑定表达式可求值'];
  for (let i = 0; i < 3; i++) {
    const y = 280 + i * 110;
    ctx.font = mono(24);
    ctx.fillStyle = inkA(0.8);
    ctx.fillText(fields[i], 200, y);
    ctx.strokeStyle = inkA(0.7);
    ctx.strokeRect(560, y - 18, 30, 30);
    if (p > 0.25 + i * 0.2) {
      ctx.strokeStyle = alpha(SIGNAL, 0.95); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(564, y - 14); ctx.lineTo(586, y + 8); ctx.moveTo(586, y - 14); ctx.lineTo(564, y + 8); ctx.stroke();
      ctx.strokeStyle = inkA(0.7); ctx.lineWidth = 2;
    }
    ctx.strokeStyle = inkA(0.4);
    ctx.beginPath(); ctx.moveTo(660, y + 8); ctx.lineTo(W - 240, y + 8); ctx.stroke();
  }
  /* 唱词打在备注栏 */
  const line = api.lyrics.at();
  if (line) {
    ctx.font = mono(26);
    const n = Math.max(0, Math.min(line.text.length, api.lyrics.chars(line)));
    ctx.fillStyle = inkA(0.95);
    ctx.fillText('备注：' + line.text.slice(0, n) + (Math.floor(t * 2.4) % 2 ? '▏' : ''), 200, 660);
  }
  /* 「没事」上橙章砸下 */
  const sung = api.lyrics.chars(L22);
  const stampK = sung >= L22.text.length - 1 ? clamp((t - (L22.end / 1000 - 0.35)) / 0.12, 0, 1) : 0;
  stamp('够安全', stampK, W - 430, 640, -0.14, 90);
} else if (t < L24.start / 1000) {
  /* 命令总线图：前向脉冲 / 后向镜像 / 「再来一遍」结巴 */
  const boxes = ['cmd', 'dispatch', 'undo 栈'];
  const bw = 300, gapx = (W - 440 - bw * 3) / 2;
  for (let i = 0; i < 3; i++) {
    const x = 220 + i * (bw + gapx);
    ctx.strokeStyle = inkA(0.85); ctx.lineWidth = 2.4;
    ctx.strokeRect(x, H * 0.42, bw, 120);
    ctx.font = mono(30, 500); ctx.fillStyle = inkA(0.9);
    ctx.fillText(boxes[i], x + 30, H * 0.42 + 62);
    if (i < 2) {
      ctx.beginPath(); ctx.moveTo(x + bw + 10, H * 0.42 + 60); ctx.lineTo(x + bw + gapx - 10, H * 0.42 + 60);
      ctx.lineTo(x + bw + gapx - 24, H * 0.42 + 52); ctx.moveTo(x + bw + gapx - 10, H * 0.42 + 60); ctx.lineTo(x + bw + gapx - 24, H * 0.42 + 68);
      ctx.stroke();
    }
  }
  const q = clamp((t - L23.start / 1000) / (L24.start / 1000 - L23.start / 1000), 0, 1);
  const backward = t > L23.start / 1000 + (L23.end - L23.start) / 1000 * 0.35;
  const stutter = p > 0.8 ? (Math.floor(t * 18) % 3) / 3 : 0;
  const pulseX = 220 - 60 + (backward ? 1 - q + stutter * 0.05 : q - stutter * 0.05) * (W - 440 + 120);
  ctx.fillStyle = alpha(SIGNAL, 0.95);
  ctx.fillRect(pulseX, H * 0.42 - 16, 8, 152);
  /* 词按方向排版：撤销是镜像的 */
  ctx.textAlign = 'center';
  ctx.font = sans(84, 800);
  const sung2 = Math.max(0, Math.min(L23.text.length, api.lyrics.chars(L23)));
  const parts = ['重做，', '撤销，', '再来一遍'];
  let acc = 0;
  for (const part of parts) {
    const done = sung2 >= acc + part.length;
    const active = sung2 > acc && sung2 < acc + part.length;
    ctx.save();
    ctx.translate(W / 2, H * 0.72);
    if (part.startsWith('撤销') && (done || active)) ctx.scale(-1, 1);
    ctx.fillStyle = done || active ? inkA(0.95) : inkA(0.25);
    ctx.fillText(part.split('').reverse().join(''), 0, 0);
    ctx.restore();
    acc += part.length;
  }
  ctx.textAlign = 'left';
} else {
  /* 旧管线图被划掉；纸从中间烧成两半 */
  const q = clamp((t - L24.start / 1000) / (P1 - L24.start / 1000), 0, 1);
  ctx.font = mono(28, 500); ctx.fillStyle = inkA(0.9);
  ctx.fillText('v1 渲染管线（单线程）', 200, 170);
  const boxes = ['采集', '绘制', '合成'];
  for (let i = 0; i < 3; i++) {
    const x = 220 + i * 420;
    ctx.strokeStyle = inkA(0.85); ctx.lineWidth = 2.4;
    ctx.strokeRect(x, H * 0.36, 300, 110);
    ctx.fillStyle = inkA(0.9);
    ctx.fillText(boxes[i], x + 30, H * 0.36 + 60);
    if (i < 2) { ctx.beginPath(); ctx.moveTo(x + 310, H * 0.36 + 55); ctx.lineTo(x + 410, H * 0.36 + 55); ctx.stroke(); }
  }
  const strike = clamp((t - L24.start / 1000 - 1) / 0.5, 0, 1);
  if (strike > 0) {
    ctx.strokeStyle = alpha(SIGNAL); ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(200, H * 0.36 + 55 - strike * 90); ctx.lineTo(200 + strike * (W - 500), H * 0.36 + 55 + strike * 90); ctx.stroke();
  }
  const burn = clamp((t - L24.start / 1000 - 1.6) / 1.1, 0, 1);
  if (burn > 0) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    const swing = burn * 0.16;
    ctx.save(); ctx.rotate(-swing); ctx.translate(0, -burn * 20);
    ctx.fillStyle = alpha(BONE); ctx.fillRect(-W, -H, W * 2, H); ctx.restore();
    ctx.save(); ctx.rotate(swing); ctx.translate(0, burn * 20);
    ctx.fillStyle = alpha(BONE); ctx.fillRect(-W, 0, W * 2, H); ctx.restore();
    ctx.restore();
    ctx.strokeStyle = alpha(SIGNAL); ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(120, H / 2); ctx.lineTo(120 + burn * (W - 240), H / 2 + Math.sin(t * 22) * 5); ctx.stroke();
    sparkDot(120 + burn * (W - 240), H / 2, 1);
    sparks(120 + burn * (W - 240), H / 2, 16, Math.floor(t * 30), 0.7);
  }
}
`);

/* ───────────────────── leftturn — 轨迹（修订版） ───────────────────── */
export const A_LEFTTURN = withWin('leftturn', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const L25 = api.lyrics.lines[25], L26 = api.lyrics.lines[26];
ctx.strokeStyle = alpha(GRAPHITE, 0.3);
ctx.lineWidth = 1;
ctx.beginPath();
for (let x = 0; x < W; x += 120) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
for (let y = 0; y < H; y += 120) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
ctx.stroke();
ctx.textBaseline = 'middle';
if (t < L26.start / 1000) {
  /* 路线图 + 急转弯 + 面具等高线弹坑 */
  const whip = clamp((t - (L25.start / 1000 + 1.2)) / 0.35, 0, 1);
  ctx.save();
  ctx.translate(-whip * 420 + Math.sin(t * 40) * whip * 8, whip * 60);
  const sx = 180, sy = H * 0.66;
  const turnT = clamp((t - (L25.start / 1000 + 1)) / 0.6, 0, 1);
  ctx.setLineDash([16, 12]);
  ctx.strokeStyle = alpha(ASH, 0.85);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  const straight = Math.min(1, turnT * 1.4) * (W * 0.45);
  ctx.lineTo(sx + straight, sy);
  if (turnT > 0.7) ctx.lineTo(sx + straight, sy - (turnT - 0.7) / 0.3 * H * 0.3);
  ctx.stroke();
  ctx.setLineDash([]);
  const marks = ['v2.8', 'v2.9', 'v2.10', 'v2.11', '发布'];
  ctx.font = mono(22, 500);
  for (let i = 0; i < marks.length; i++) {
    const x = sx + 120 + i * ((W * 0.45) / 4);
    ctx.fillStyle = alpha(BONE, 0.9);
    ctx.beginPath(); ctx.arc(x, sy - 26, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = alpha(ASH, 0.9);
    ctx.fillText(marks[i], x - 24, sy - 60);
  }
  if (turnT >= 1) {
    const cx = sx + straight, cy = sy - H * 0.3;
    for (let i = 1; i < 9; i++) {
      ctx.strokeStyle = alpha(GRAPHITE, 0.7);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.01; a += Math.PI / 30) {
        const wob = 1 + Math.sin(a * 4 + i) * 0.1;
        const X = cx + Math.cos(a) * i * 44 * wob, Y = cy + Math.sin(a) * i * 30 * wob;
        if (a === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = alpha(SIGNAL, 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx - 90, cy - 30, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + 90, cy - 30, 34, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy + 60, 120, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
    ctx.font = mono(24, 500);
    ctx.fillStyle = alpha(SIGNAL, 0.95);
    ctx.fillText('计划外目标 · 不在路线图上', cx - 150, cy + 190);
  }
  sparkDot(sx + Math.min(1, turnT * 1.4) * W * 0.45, turnT > 0.7 ? sy - (turnT - 0.7) / 0.3 * H * 0.3 : sy, KICK);
  ctx.restore();
} else {
  /* 评审排期（甘特条）：TODAY 游标卡死在空槽，跳过后面冲到发布 */
  const q = clamp((t - L26.start / 1000) / (P1 - L26.start / 1000), 0, 1);
  const rows = [
    { name: 'v2.8 · 起点', done: true }, { name: 'v2.9 · 导览', done: true }, { name: 'v2.10 · 极限样片', done: true },
    { name: 'v2.11 · 再改一版', done: true }, { name: 'v2.12 · 评审', done: false }, { name: '发布', done: true },
  ];
  ctx.font = mono(26);
  for (let i = 0; i < rows.length; i++) {
    const y = 220 + i * 110;
    ctx.fillStyle = alpha(ASH, 0.9);
    ctx.fillText(rows[i].name, 160, y);
    const x0 = 640, w2 = W - 900;
    ctx.strokeStyle = alpha(GRAPHITE, 0.7); ctx.lineWidth = 2;
    ctx.strokeRect(x0, y - 30, w2, 60);
    const fill = rows[i].done ? clamp(q * rows.length - i, 0, 1) : 0;
    if (fill > 0) {
      ctx.fillStyle = alpha(i === 4 ? SIGNAL : ASH, 0.8);
      ctx.fillRect(x0 + 4, y - 26, (w2 - 8) * fill, 52);
    }
    if (!rows[i].done && q > (i + 0.5) / rows.length - 0.08 && Math.floor(t * 3) % 2) {
      ctx.font = mono(22, 500);
      ctx.fillStyle = alpha(SIGNAL);
      ctx.fillText('STATUS: 未召开', x0 + 24, y);
      ctx.font = mono(26);
    }
    if (i === 5) {
      ctx.font = mono(22, 500);
      ctx.fillStyle = alpha(BONE, 0.9);
      ctx.fillText('提前 3 天', x0 + w2 - 150, y);
      ctx.font = mono(26);
    }
  }
  const tx = 640 + Math.min(1, q * 1.3) * (W - 900);
  sparkDot(tx, 200 + clamp(q * 1.3, 0, 0.999) * rows.length * 110, KICK);
  ctx.font = mono(20, 500);
  ctx.fillStyle = alpha(SIGNAL, 0.95);
  ctx.fillText('TODAY', tx - 30, 178);
}
`);

/* ───────────────────── paperclips — 图层块，填满一间房 ───────────────────── */
export const A_PAPERCLIPS = withWin('paperclips', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const L29 = api.lyrics.lines[29], L30 = api.lyrics.lines[30], L31 = api.lyrics.lines[31];
/* 图层块直绘（沙箱无 document / 离屏 canvas；strokeRect 比 roundRect 便宜得多，
   pdoom 复刻实测 roundRect×100+/帧会掉到 30ms+，故这里不用圆角） */
const beatQ = Math.min(6, Math.floor(Math.max(0, t - L29.start / 1000) / (api.tempo.ms * 2 / 1000)) + 1);
const count = Math.pow(2, Math.min(6, beatQ));
const cols = Math.ceil(Math.sqrt(count * 2));
const drift = t * 14;
for (let r = 0; r < 9; r++) {
  const depth = r / 8;
  const scale = 0.5 + depth * 0.9;
  const s = 44 * scale;
  const bw = s * 1.6, bh = s * 1.05;
  for (let c = 0; c < cols; c++) {
    const x = ((c * 120 - drift) % (cols * 120) + cols * 120) % (cols * 120) - 120 + W * 0.06;
    const y = 80 + r * 108;
    if (r * cols + c >= count * 3) continue;
    ctx.globalAlpha = 0.35 + depth * 0.45;
    ctx.strokeStyle = alpha(BONE, 0.95);
    ctx.lineWidth = Math.max(1.6, 6 * scale);
    ctx.strokeRect(x, y, bw, bh);
    if (depth > 0.4) {
      ctx.strokeStyle = alpha(SIGNAL, 0.55);
      ctx.lineWidth = Math.max(1, 2.4 * scale);
      ctx.beginPath();
      ctx.moveTo(x + bw * 0.19, y + bh * 0.7);
      ctx.lineTo(x + bw * 0.86, y + bh * 0.7);
      ctx.stroke();
    }
  }
}
ctx.globalAlpha = 1;
/* 深雾压住远景 */
const fg = ctx.createLinearGradient(0, 0, 0, H);
fg.addColorStop(0, alpha(INK, 0.75)); fg.addColorStop(0.5, 'rgba(0,0,0,0)'); fg.addColorStop(1, alpha(INK, 0.6));
ctx.fillStyle = fg; ctx.fillRect(0, 0, W, H);
readout('图层块', String(count).padStart(4, '0'), W - 56, H - 56);
/* 自动回复卡：内存回收器在休假 */
if (t >= L30.start / 1000 - 0.4 && t < L31.start / 1000) {
  const q = clamp((t - L30.start / 1000 + 0.4) / 0.5, 0, 1);
  const cardY = H * 0.3 - q * 60;
  ctx.fillStyle = alpha(INK2, 0.96);
  ctx.fillRect(W * 0.56, cardY, 520, 150);
  ctx.strokeStyle = alpha(GRAPHITE, 0.7);
  ctx.strokeRect(W * 0.56 + 0.5, cardY + 0.5, 520, 150);
  ctx.font = mono(22);
  ctx.fillStyle = alpha(ASH, 0.95);
  ctx.textBaseline = 'middle';
  const msg = '自动回复：本人休假，暂停回收。';
  const msg2 = '紧急图层请联系 ——';
  const n = Math.floor(clamp((t - L30.start / 1000) / (L31.start / 1000 - L30.start / 1000), 0, 1) * (msg.length + msg2.length));
  ctx.fillText(msg.slice(0, n), W * 0.56 + 30, cardY + 56);
  ctx.fillText(msg2.slice(0, Math.max(0, n - msg.length)), W * 0.56 + 30, cardY + 100);
}
/* 收拢到窒息 */
if (t >= L31.start / 1000) {
  const q = clamp((t - L31.start / 1000) / (P1 - L31.start / 1000), 0, 1);
  ctx.fillStyle = alpha(INK, q * 0.4);
  ctx.fillRect(0, 0, W, H);
}
`);

/* ───────────────────── fuse — 太迟了 ───────────────────── */
export const A_FUSE = withWin('fuse', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const L32 = api.lyrics.lines[32], L33 = api.lyrics.lines[33];
ctx.textBaseline = 'middle';
if (t < L33.start / 1000) {
  /* 导火索：主线 + 编织斜纹；烧点前碳化；词排在导火索上，烧过即灰 */
  const burn = clamp((t - L32.start / 1000) / (L33.start / 1000 - L32.start / 1000), 0, 1);
  const x0 = 100, x1 = W - 200;
  const by = H * 0.52;
  ctx.strokeStyle = alpha(GRAPHITE);
  ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x1, by); ctx.stroke();
  ctx.strokeStyle = alpha(ASH, 0.7);
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = x0; x < x1; x += 18) { ctx.moveTo(x, by - 7); ctx.lineTo(x + 12, by + 7); }
  ctx.stroke();
  const bx = x0 + (x1 - x0) * burn;
  ctx.strokeStyle = alpha(GRAPHITE, 0.35);
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(bx, by); ctx.stroke();
  sparkDot(bx, by, KICK);
  sparks(bx, by, 26, Math.floor(t * 30), 0.5 + KICK);
  ctx.font = sans(54, 700);
  const chars = Array.from(L32.text);
  const units = api.lyrics.units(L32);
  const total = chars.reduce((a, c) => a + measure2(c, ctx.font), 0);
  let x = W / 2 - total / 2;
  for (let i = 0; i < chars.length; i++) {
    const prog = units[i] ? api.lyrics.progress(units[i]) : 0;
    const burnt = x + measure2(chars[i], ctx.font) / 2 < bx;
    ctx.fillStyle = burnt ? alpha(GRAPHITE, 0.4) : prog > 0 ? alpha(BONE, 0.95) : alpha(GRAPHITE, 0.5);
    ctx.fillText(chars[i], x, by - 90 + Math.sin(i) * 4);
    x += measure2(chars[i], ctx.font);
  }
} else {
  /* 正交图表：表达力 × 性能，回归线 = 弦，在「驰」上弯到真实音高 */
  const q = clamp((t - L33.start / 1000) / (P1 - L33.start / 1000), 0, 1);
  const px = 180, py = 200, pw = W - 420, ph = H - 460;
  ctx.strokeStyle = alpha(GRAPHITE, 0.4);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = px; x <= px + pw; x += 48) { ctx.moveTo(x, py); ctx.lineTo(x, py + ph); }
  for (let y = py; y <= py + ph; y += 48) { ctx.moveTo(px, y); ctx.lineTo(px + pw, y); }
  ctx.stroke();
  ctx.font = mono(22);
  ctx.fillStyle = alpha(ASH, 0.9);
  ctx.fillText('表达力 →', px + pw - 120, py + ph + 44);
  ctx.fillText('性能 ↑', px - 20, py - 20);
  const pts = [['v2.8', 0.2, 0.2], ['v2.9', 0.35, 0.3], ['v2.10', 0.5, 0.42], ['v2.11', 0.68, 0.5], ['极限样片', 0.85, 0.62]];
  for (const [name, fx, fy] of pts) {
    const X = px + pw * fx, Y = py + ph * (1 - fy);
    ctx.fillStyle = alpha(BONE, 0.9);
    ctx.beginPath(); ctx.arc(X, Y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.font = mono(18);
    ctx.fillText(name, X + 12, Y - 12);
    ctx.font = mono(22);
  }
  const bend = Math.max(0, q - 0.45) / 0.55;
  ctx.strokeStyle = alpha(SIGNAL);
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    const vib = bend > 0 ? Math.sin(x * Math.PI) * Math.sin(t * 26) * 26 * bend : 0;
    const Y = py + ph * 0.62 - (x * ph * 0.18) + vib;
    if (i === 0) ctx.moveTo(px + pw * x, Y); else ctx.lineTo(px + pw * x, Y);
  }
  ctx.stroke();
  if (bend > 0.3) {
    ctx.font = mono(30, 500);
    ctx.fillStyle = alpha(SIGNAL, 0.95);
    ctx.fillText('♭', px + pw * 0.3, py + 60);
  }
  sparkDot(px + pw * Math.min(1, q * 1.4), py + ph * 0.62, KICK);
}
`);

/* ───────────────────── stack — 架构（递归） ───────────────────── */
export const A_STACK = withWin('stack', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const L34 = api.lyrics.lines[34], L35 = api.lyrics.lines[35];
const BH = 150;
const fall = t < L35.start / 1000;
const blockOffset = fall ? (api.tempo.beat * BH) % (BH * 2) : Math.min(BH * 2, (L35.start / 1000 * 4) % (BH * 2));
const KINDS = ['cmd.add', 'bind(t→x)', 'keyframe.set', 'export.mp4'];
ctx.textBaseline = 'middle';
for (let i = -1; i < 9; i++) {
  const y = H - ((i * BH + blockOffset) % (BH * 10)) - BH;
  const kind = KINDS[((i + Math.floor(api.tempo.beat)) % KINDS.length + KINDS.length) % KINDS.length];
  const x = W / 2 - 300;
  ctx.strokeStyle = alpha(GRAPHITE, 0.85);
  ctx.lineWidth = 2.4;
  ctx.strokeRect(x, y, 600, BH - 14);
  ctx.font = mono(30, 500);
  ctx.fillStyle = alpha(ASH, 0.9);
  ctx.fillText(kind, x + 26, y + BH / 2 - 8);
  ctx.strokeStyle = alpha(SIGNAL, 0.6);
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x + 470, y + BH / 2 - 8); ctx.lineTo(x + 540, y + BH / 2 - 8);
  ctx.lineTo(x + 528, y + BH / 2 - 16); ctx.moveTo(x + 540, y + BH / 2 - 8); ctx.lineTo(x + 528, y + BH / 2);
  ctx.stroke();
  if (!fall && i === 2) {
    ctx.save();
    ctx.translate(W / 2, y + BH / 2);
    ctx.rotate(0.18);
    ctx.translate(-W / 2, -(y + BH / 2));
    ctx.strokeStyle = alpha(SIGNAL, 0.95);
    ctx.strokeRect(x, y, 600, BH - 14);
    ctx.restore();
  }
}
/* 引语：一词一块（居中逐字亮起）；「撤销」逆着唱 —— 从右往左亮 */
const cur = api.lyrics.at() || L34;
{
  ctx.textAlign = 'center';
  const font = sans(88, 900);
  ctx.font = font;
  const chars = Array.from(cur.text);
  const total = chars.reduce((a, c) => a + measure2(c, font), 0);
  let x = W / 2 - total / 2;
  const units = api.lyrics.units(cur);
  const n = t >= L35.start / 1000
    ? chars.length - Math.max(0, Math.min(chars.length, api.lyrics.chars(cur)))
    : Math.max(0, Math.min(chars.length, api.lyrics.chars(cur)));
  for (let i = 0; i < chars.length; i++) {
    ctx.fillStyle = i < n ? alpha(BONE, 0.95) : alpha(GRAPHITE, 0.5);
    ctx.fillText(chars[i], x, H * 0.2);
    x += measure2(chars[i], font);
  }
  ctx.textAlign = 'left';
}
`);

/* ───────────────────── dense — 尺度 ───────────────────── */
export const A_DENSE = withWin('dense', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const L36 = api.lyrics.lines[36], L37 = api.lyrics.lines[37], L38 = api.lyrics.lines[38], L39 = api.lyrics.lines[39];
ctx.textBaseline = 'middle';
if (t < L37.start / 1000) {
  /* ① 安全框内的排版压力：每脚点压一次，副本越塞越满 */
  const q = clamp((t - L36.start / 1000) / (L37.start / 1000 - L36.start / 1000), 0, 1);
  ctx.strokeStyle = alpha(GRAPHITE, 0.5);
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
  ctx.strokeRect(W * 0.035, H * 0.035, W * 0.93, H * 0.93);
  ctx.setLineDash([]);
  ctx.font = mono(18);
  ctx.fillStyle = alpha(ASH, 0.7);
  ctx.fillText('标题安全 90%', W * 0.05 + 8, H * 0.05 + 20);
  const kicks = Math.floor(api.tempo.beat);
  const copies = 1 + Math.min(7, Math.max(0, kicks - 24));
  const press = Math.min(1, q * 1.2);
  for (let c = 0; c < copies; c++) {
    const size = Math.max(30, (110 - c * 12) * (1 - press * 0.3));
    const font = sans(size, 300 + Math.round(press * 600));
    ctx.font = font;
    const w2 = measure2(L36.text, font);
    ctx.fillStyle = c === 0 ? alpha(BONE, 0.95) : alpha(c % 2 ? GRAPHITE : ASH, 0.65);
    ctx.fillText(L36.text, W / 2 - w2 / 2 - c * 6 * press, H * 0.28 + c * 74 * (1 - press * 0.25));
  }
  readout('图层 / 画布', String(Math.round(20 + q * q * 19980)), W - 56, H - 56, SIGNAL, 44);
} else if (t < L38.start / 1000) {
  /* ② 击破围栏 + QC 日志 */
  const q = clamp((t - L37.start / 1000) / (L38.start / 1000 - L37.start / 1000), 0, 1);
  const broken = q < 0.4 ? 0 : q < 0.75 ? 1 : 2;
  if (broken < 1) { ctx.strokeStyle = alpha(GRAPHITE, 0.5); ctx.setLineDash([8, 8]); ctx.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9); ctx.setLineDash([]); }
  if (broken < 2) { ctx.strokeStyle = alpha(GRAPHITE, 0.5); ctx.strokeRect(W * 0.035, H * 0.035, W * 0.93, H * 0.93); }
  for (let i = 0; i < broken; i++) {
    const bx2 = W * (0.05 + i * 0.44), by2 = H * 0.05;
    ctx.strokeStyle = alpha(SIGNAL, 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(bx2, by2); ctx.lineTo(bx2 - 40 - q * 80, by2 - 30 - q * 60); ctx.moveTo(bx2 + 20, by2); ctx.lineTo(bx2 + 70 + q * 90, by2 - 40 - q * 70); ctx.stroke();
  }
  ctx.font = mono(24);
  ctx.fillStyle = alpha(ASH, 0.9);
  const qc = ['标题安全框 · 破', '动作安全框 · 破', '画面本身 · 破'];
  for (let i = 0; i <= broken && i < 3; i++) ctx.fillText('QC ' + String(i + 1).padStart(2, '0') + '  ' + qc[i] + '  @' + t.toFixed(2) + 's', 160, H * 0.78 + i * 40);
} else if (t < L39.start / 1000) {
  /* ③ 十万个格子按波闪 —— 粗网格 fillRect 批量路径
     （沙箱无离屏 canvas：putImageData 只能 1:1 落点没法缩放定位；
       全分辨率 ImageData 每帧百万次写入又太贵，故 64×40 粗格 + 三档亮度合并填充） */
  const GX = 64, GY = 40;
  if (!state.gx0) { state.gx0 = W * 0.1; state.gy0 = H * 0.12; }
  const gw = W * 0.8 / GX, gh = H * 0.68 / GY;
  const LV = [
    [0.55, alpha(BONE, 0.6)],
    [0.22, alpha(ASH, 0.5)],
    [0.05, alpha(GRAPHITE, 0.38)],
  ];
  for (let li = 0; li < LV.length; li++) {
    ctx.fillStyle = LV[li][1];
    ctx.beginPath();
    for (let y = 0; y < GY; y++) {
      for (let x = 0; x < GX; x++) {
        const xy = x + y;
        const w2 = Math.sin(xy * 0.18 - t * 6) + Math.sin(x * 0.5 - t * 3.3);
        const on = w2 > 0.6 ? 0.55 : w2 > 0.1 ? 0.22 : 0.05;
        if (on !== LV[li][0]) continue;
        ctx.rect(state.gx0 + x * gw, state.gy0 + y * gh, gw - 2, gh - 2);
      }
    }
    ctx.fill();
  }
  readout('像素', '100,000', W - 56, H - 56, SIGNAL, 44);
} else {
  /* ④ 桌面倾斜 + 面具滚落 + 自动对齐评分 */
  const q = clamp((t - L39.start / 1000) / (P1 - L39.start / 1000), 0, 1);
  const dir = Math.floor(api.tempo.beat) % 2 ? 1 : -1;
  const over = q > 0.55 ? (q - 0.55) * 0.5 : 0;
  const tilt = dir * 0.045 * KICK + over * 0.2;
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(tilt);
  ctx.translate(-W / 2, -H / 2);
  ctx.strokeStyle = alpha(GRAPHITE, 0.5);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { ctx.moveTo(0, 140 + i * 90); ctx.lineTo(W, 140 + i * 90); }
  ctx.stroke();
  const drop = Math.min(1, q * 1.4);
  const mx = W * 0.3 + drop * W * 0.4, my = 200 + drop * (H - 400);
  ctx.fillStyle = alpha(BONE, 0.95);
  ctx.beginPath(); ctx.arc(mx, my, 90, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = alpha(INK);
  const upside = drop > 0.8;
  ctx.beginPath(); ctx.arc(mx - 34, my + (upside ? 20 : -20), 8, 0, Math.PI * 2); ctx.arc(mx + 34, my + (upside ? 20 : -20), 8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = alpha(INK); ctx.lineWidth = 5;
  ctx.beginPath();
  if (upside) ctx.arc(mx, my + 30, 44, 1.25 * Math.PI, 1.75 * Math.PI);
  else ctx.arc(mx, my + 8, 44, 0.25 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  ctx.restore();
  const score = q < 0.6 ? 0.99 : q < 0.8 ? 0.41 + (q - 0.6) * 2.9 : 0.99;
  readout('自动对齐评分', score.toFixed(2), W - 56, H - 56, SIGNAL, 44);
}
`);

/* ───────────────────── loom — 正如撤销树所预言 ───────────────────── */
export const A_LOOM = withWin('loom', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const L41 = api.lyrics.lines[41], L42 = api.lyrics.lines[42], L43 = api.lyrics.lines[43];
const ALTS = ['永远', '版本', '算了吧', '没人知道', '快照', '图纸', '墨稿'];
ctx.textBaseline = 'middle';
if (t < L42.start / 1000) {
  /* 撤销树：主干逐 token 生成，备选分支变暗 */
  const q = clamp((t - L41.start / 1000) / (L42.start / 1000 - L41.start / 1000), 0, 1);
  const chars = Array.from(L41.text);
  const units = api.lyrics.units(L41);
  const n = Math.max(1, Math.round(q * chars.length));
  const x0 = 160, y0 = H * 0.62;
  ctx.strokeStyle = alpha(GRAPHITE, 0.7);
  ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (W - 360) * 0.8, y0 - 120); ctx.stroke();
  for (let i = 0; i < n; i++) {
    const t2 = i / (chars.length - 1);
    const nx = x0 + (W - 500) * t2, ny = y0 - 120 * t2;
    const prog = units[i] ? api.lyrics.progress(units[i]) : 0;
    ctx.font = sans(44, 700);
    ctx.fillStyle = prog > 0 ? alpha(BONE, 0.95) : alpha(GRAPHITE, 0.55);
    ctx.fillText(chars[i], nx, ny);
    ctx.font = mono(16);
    ctx.fillStyle = alpha(ASH, 0.75);
    ctx.fillText((0.3 + rnd(i * 7) * 0.5).toFixed(2), nx, ny + 34);
    const k = clamp(q * 1.4 - t2, 0, 1);
    if (k > 0) {
      for (let b = 0; b < 2; b++) {
        const bx = nx + 60 + b * 40, by = ny - 90 - b * 40;
        ctx.strokeStyle = alpha(GRAPHITE, 0.35 * k);
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(bx, by); ctx.stroke();
        ctx.fillStyle = alpha(GRAPHITE, 0.55 * k);
        ctx.font = mono(17);
        ctx.fillText(ALTS[(i * 2 + b) % ALTS.length] + ' .' + String(9 + ((i + b) * 7) % 80).slice(0, 2), bx + 8, by);
      }
    }
  }
  if (q > 0.8) {
    const k = (q - 0.8) / 0.2;
    const ex = x0 + (W - 500) * 0.8, ey = y0 - 120 * 0.8;
    ctx.globalAlpha = k;
    ctx.font = mono(19);
    ctx.fillStyle = alpha(ASH, 0.9);
    const dist = ['永远 .19', '版本 .09', '没人知道 .07', '一篇帖子 .04'];
    dist.forEach((s, i) => ctx.fillText(s, ex + 40, ey - 40 - i * 30));
    ctx.font = serifI(64, 600);
    ctx.fillStyle = alpha(BONE, 0.96);
    ctx.fillText('撤销树', ex + 40, ey - 190);
    ctx.font = mono(18);
    ctx.fillStyle = alpha(SIGNAL, 0.95);
    ctx.fillText('p 0.31 ▸ 已采样', ex + 260, ey - 190);
    ctx.globalAlpha = 1;
  }
  sparkDot(x0, y0, KICK);
} else if (t < L43.start / 1000) {
  /* [蒙版] 块：唱到即揭 */
  const chars = Array.from(L42.text);
  const units = api.lyrics.units(L42);
  const size = 92;
  const font = sans(size, 800);
  ctx.font = font;
  const cw = measure2('蒙', font) * 1.16;
  const total = chars.length * cw;
  let x = W / 2 - total / 2;
  for (let i = 0; i < chars.length; i++) {
    const prog = units[i] ? api.lyrics.progress(units[i]) : 0;
    if (prog <= 0) {
      ctx.fillStyle = alpha(ASH, 0.32);
      ctx.fillRect(x, H * 0.42 - size * 0.6, cw - 12, size * 1.2);
      ctx.font = mono(15);
      ctx.fillStyle = alpha(INK);
      ctx.fillText('蒙版', x + 8, H * 0.42);
      ctx.font = font;
    } else {
      ctx.fillStyle = alpha(BONE, 0.95);
      ctx.fillText(chars[i], x + (cw - 12 - measure2(chars[i], font)) / 2, H * 0.42);
    }
    x += cw;
  }
} else {
  /* Droste：嵌套的升级框，最里面是 ilya 的第一瞥 */
  const q = clamp((t - L43.start / 1000) / (P1 - L43.start / 1000), 0, 1);
  const depth = Math.min(7, Math.floor(q * 8));
  ctx.save();
  ctx.translate(W / 2, H / 2);
  for (let i = 0; i <= depth; i++) {
    const s = 1 / Math.pow(1.5, i);
    ctx.strokeStyle = alpha(i === depth ? EMBER : ASH, 0.9);
    ctx.lineWidth = 2.4 * s;
    ctx.strokeRect(-360 * s, -210 * s, 720 * s, 420 * s);
    ctx.font = mono(Math.max(9, 24 * s));
    ctx.fillStyle = alpha(ASH, 0.9);
    ctx.fillText('升级 → v' + (2.12 + i * 0.01).toFixed(2), -340 * s, -180 * s);
  }
  ctx.restore();
}
`);

/* ───────────────────── ilya — 看见了什么 ───────────────────── */
export const A_ILYA = withWin('ilya', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
const L44 = api.lyrics.lines[44], L45 = api.lyrics.lines[45];
ctx.textBaseline = 'middle';
if (t < L45.start / 1000) {
  const q = clamp((t - L44.start / 1000) / (L45.start / 1000 - L44.start / 1000), 0, 1);
  const redacted = t > L44.start / 1000 + 2.2;
  const lid = clamp((t - (L44.start / 1000 + 2.6)) / 1.6, 0, 1);
  /* 辉光：逐帧径向渐变（沙箱无 document 缓存不了精灵 canvas；实测 createRadialGradient 很便宜） */
  const gr = 560 * (1 - lid * 0.85);
  const gx = W * 0.58, gy = H * 0.55;
  const gg = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(1, gr));
  gg.addColorStop(0, alpha(EMBER, 0.5));
  gg.addColorStop(0.4, alpha(EMBER, 0.18));
  gg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.2 + api.lyrics.lineProgress(L44) * 0.1;
  ctx.fillStyle = gg;
  ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
  ctx.globalAlpha = 1;
  /* 白线房间 */
  ctx.strokeStyle = alpha(BONE, 0.4);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { ctx.moveTo(0, H * 0.72 + i * 40); ctx.lineTo(W, H * 0.72 + i * 40); }
  ctx.moveTo(W * 0.2, H); ctx.lineTo(W * 0.34, H * 0.6);
  ctx.stroke();
  /* 笔记本（从背后）+ 合盖角度 */
  const lx = W * 0.58, ly = H * 0.58;
  const lidAng = lid * 1.25;
  ctx.strokeStyle = alpha(BONE, 0.9);
  ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(lx - 190, ly + 120); ctx.lineTo(lx + 190, ly + 120); ctx.stroke();
  const sh = 220 * Math.cos(lidAng);
  ctx.beginPath();
  ctx.moveTo(lx - 180, ly + 114);
  ctx.lineTo(lx - 180 + lid * 30, ly + 114 - sh);
  ctx.lineTo(lx + 180 + lid * 30, ly + 114 - sh);
  ctx.lineTo(lx + 180, ly + 114);
  ctx.stroke();
  if (lidAng < 1.1) {
    if (redacted) {
      ctx.fillStyle = alpha(BONE, 0.9);
      ctx.fillRect(lx - 140, ly + 114 - sh + 30, 280, 70);
      ctx.fillStyle = alpha(INK);
      ctx.font = mono(30, 700); ctx.textAlign = 'center';
      ctx.fillText('REDACTED', lx, ly + 114 - sh + 74);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = alpha(EMBER, 0.5);
      ctx.fillRect(lx - 150, ly + 114 - sh + 24, 300, 84);
    }
  } else {
    ctx.fillStyle = alpha(EMBER, 0.8);
    ctx.fillRect(lx - 60, ly + 118, 120 * (1 - lid), 3);
    ctx.fillStyle = alpha(SIGNAL, 0.9);
    ctx.beginPath(); ctx.arc(lx + 150, ly + 122, 4, 0, Math.PI * 2); ctx.fill();
  }
  if (lid < 0.4) {
    ctx.font = mono(15);
    ctx.fillStyle = alpha(GRAPHITE, 0.65);
    ['感受图层', '第一张海报', '略微有意识', '关键帧即一切'].forEach((s, i) => ctx.fillText(s, lx - 150 + i * 80, ly + 114 - sh * 0.4));
  }
} else {
  /* 空剧场：聚光打在空处，问句在台口，幕布合拢收火花 */
  const q = clamp((t - L45.start / 1000) / (P1 - L45.start / 1000), 0, 1);
  const curtain = clamp((q - 0.5) / 0.4, 0, 1);
  ctx.fillStyle = alpha(ASH, 0.1);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2 - 260, H); ctx.lineTo(W / 2 + 260, H);
  ctx.fill();
  ctx.strokeStyle = alpha(BONE, 0.8);
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(W * 0.18, H * 0.3); ctx.lineTo(W * 0.18, H * 0.78); ctx.lineTo(W * 0.82, H * 0.78); ctx.lineTo(W * 0.82, H * 0.3); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = serifI(64, 600);
  ctx.fillStyle = alpha(BONE, 0.95);
  ctx.fillText('这一切都是演的吗', W / 2, H * 0.26);
  ctx.textAlign = 'left';
  if (curtain > 0) {
    for (const side of [-1, 1]) {
      const w2 = W * 0.5 * curtain;
      const x0 = side < 0 ? 0 : W - w2;
      ctx.fillStyle = alpha(BLOOD, 0.9);
      ctx.fillRect(x0, 0, w2, H);
      ctx.strokeStyle = alpha(INK, 0.4);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const fx = x0 + (i + 0.5) * (w2 / 10);
        ctx.moveTo(fx, 0); ctx.lineTo(fx, H);
      }
      ctx.stroke();
    }
    const seam = (1 - curtain) * W * 0.5;
    if (seam < 200) {
      ctx.fillStyle = alpha(EMBER, 0.9);
      ctx.fillRect(W / 2 - seam / 2, 0, seam, H);
    }
  }
  sparkDot(W / 2, H / 2, 1);
}
`);

/* ───────────────────── outro — 我在加我的图层数 = ∞ ───────────────────── */
export const A_OUTRO = withWin('outro', `${PRELUDE}
ctx.fillStyle = INK; ctx.fillRect(0, 0, W, H);
ctx.textBaseline = 'middle';
const B = api.tempo.ms / 1000;
/* 第一拍：引爆 + 4096.00 */
if (lt < B * 4) {
  const q = lt / (B * 4);
  ctx.fillStyle = alpha(SIGNAL, Math.max(0, 0.25 - lt * 0.3));
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.font = mono(190, 700);
  ctx.fillStyle = alpha(SIGNAL, 0.96);
  ctx.fillText('4096.00', W / 2, H / 2 - 20);
  const bw = 700;
  ctx.strokeStyle = alpha(ASH, 0.8);
  ctx.lineWidth = 3;
  ctx.strokeRect(W / 2 - bw / 2, H / 2 + 110, bw * Math.min(1, 0.98 + q * 0.02), 40);
  if (q > 0.5) {
    ctx.fillStyle = alpha(SIGNAL);
    ctx.fillRect(W / 2 + bw * 0.49, H / 2 + 100, 20 + q * 30, 60);
  }
  ctx.textAlign = 'left';
} else if (lt < B * 12) {
  /* 一拍一个值：4097 → … → 1e1000；对数尺飞过；火花开始描 ∞ */
  const seg = Math.floor(lt / B) - 4;
  ctx.textAlign = 'center';
  const vals = ['4,097', '8,192', '65,536', '1,048,576', '1e9', '1e30', '1e100', '1e1000'];
  ctx.font = mono(150, 700);
  ctx.fillStyle = alpha(SIGNAL, 0.96);
  ctx.fillText(vals[clamp(seg, 0, 7)], W / 2, H / 2 - 20);
  ctx.font = mono(34, 500);
  ctx.fillStyle = alpha(ASH, 0.85);
  const ruler = ['3.14', '10', '42', '1,000'];
  ruler.forEach((s, i) => ctx.fillText(s, ((lt * 0.7 + i * 0.4) % 1.6 - 0.3) * W, H * 0.24 + i * 10));
  if (seg >= 6) {
    const q = clamp((lt - B * 10) / (B * 2), 0, 1);
    ctx.strokeStyle = alpha(SIGNAL, 0.9);
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i <= q * 100; i++) {
      const a = i / 100 * Math.PI * 2;
      const X = W / 2 + Math.sin(a) * 300;
      const Y = H * 0.78 + Math.sin(2 * a) * 46;
      if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke();
  }
  ctx.textAlign = 'left';
} else {
  /* 片尾卡：唱词声部 + 公式化简（∞ → 8 → 0/0 → NaN）→ 重新生成 → 倒带 */
  const t2 = lt - B * 12;
  const TOT = P1 - P0 - B * 12;
  const q = clamp(t2 / TOT, 0, 1);
  ctx.textAlign = 'center';
  if (q < 0.3) {
    const words = ['我在加', '我的'];
    const wi = Math.min(1, Math.floor((q / 0.3) * 2));
    ctx.font = sans(120, 500);
    ctx.fillStyle = alpha(BONE, 0.95);
    ctx.fillText(words[wi], W / 2, H * 0.3);
  }
  const forms = ['∞', '8', '0/0', 'NaN'];
  const fi = Math.min(3, Math.floor(q * 4.3));
  const fk = clamp(q * 4.3 - fi, 0, 1);
  ctx.font = serifI(150, 600);
  ctx.fillStyle = alpha(BONE, 0.96);
  ctx.fillText('图层数 = ' + forms[fi], W / 2 - 60, H * 0.52);
  ctx.font = mono(30);
  ctx.fillStyle = alpha(ASH, 0.9);
  ctx.fillText('(1)', W / 2 + 420, H * 0.52);
  if (fi === 3) {
    ctx.font = mono(22);
    ctx.fillStyle = alpha(ASH, 0.85);
    ctx.fillText('¹ 估计已不再有意义', W / 2 - 60, H * 0.62);
  }
  if (fk < 0.2) {
    ctx.strokeStyle = alpha(SIGNAL, Math.max(0, 1 - fk * 5));
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(W / 2 - 60, H * 0.52, 200 * (0.5 + fk * 3), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.textAlign = 'left';
  /* 结尾：倒带闪回 + ↻ 重新生成 + 光标点下去 */
  if (q > 0.72) {
    const k = (q - 0.72) / 0.28;
    if (k < 0.55) {
      const names = ['open', 'loss', 'prompt', 'hook', 'room', 'shoggoth', 'spacetime', 'ascent', 'bureau', 'leftturn', 'paperclips', 'fuse', 'stack', 'dense', 'loom', 'ilya'];
      const i = Math.floor(t * 14) % names.length;
      ctx.fillStyle = alpha([BLOOD, GRAPHITE, SIGNAL, ASH, EMBER][i % 5], 0.16);
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.font = mono(90, 700);
      ctx.fillStyle = alpha(BONE, 0.5);
      ctx.fillText(names[i], W / 2, H / 2);
      ctx.textAlign = 'left';
    } else {
      const k2 = (k - 0.55) / 0.45;
      ctx.textAlign = 'center';
      const bx = W / 2, by = H * 0.66;
      const hover = k2 > 0.5;
      ctx.strokeStyle = alpha(hover ? SIGNAL : ASH, 0.95);
      ctx.lineWidth = 2.4;
      ctx.strokeRect(bx - 170, by - 36, 340, 72);
      ctx.font = mono(32, 500);
      ctx.fillStyle = alpha(hover ? SIGNAL : BONE, 0.95);
      ctx.fillText('↻ 重新生成', bx, by);
      const cx = W - 240 - (1 - Math.min(1, k2 * 2)) * 500;
      const cy = H - 120 - (1 - Math.min(1, k2 * 2)) * 300;
      ctx.strokeStyle = alpha(BONE, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + 18, cy + 10); ctx.lineTo(cx + 7, cy + 13); ctx.lineTo(cx + 10, cy + 24); ctx.closePath(); ctx.stroke();
      if (k2 > 0.86) {
        ctx.strokeStyle = alpha(SIGNAL, 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bx + 120, by - 20, (k2 - 0.86) * 90, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.textAlign = 'left';
    }
  }
}
`);

/* ───────────────────── HUD — 逐字歌词 / 图层数读数 / 书挡裁切标记 ───────────────────── */
export const A_HUD = `${PRELUDE.replace(/__P0__/g, '0').replace(/__P1__/g, '156.651')}
ctx.clearRect(0, 0, W, H);
ctx.textBaseline = 'middle';

/* —— 书挡裁切标记：只在开场（飞出）与尾注（收回）出现 —— 首尾帧相接可循环 */
const lossStart = ${win('loss')[0] / 1000}, outroStart = ${win('outro')[0] / 1000};
let mark = 0;
if (t < lossStart) mark = t > lossStart - 0.5 ? (lossStart - t) / 0.5 : 1;
else if (t >= outroStart) mark = Math.min(1, (t - outroStart) / 1.2);
if (mark > 0.01) {
  ctx.globalAlpha = mark;
  ctx.strokeStyle = alpha(ASH, 0.55);
  ctx.lineWidth = 2;
  const m = 26, L = 34;
  for (const [cx2, cy2, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
    ctx.beginPath();
    ctx.moveTo(cx2 + dx * L, cy2); ctx.lineTo(cx2, cy2); ctx.lineTo(cx2, cy2 + dy * L);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/* —— 图层数读数：沿段落锚点几何爬升（3 → … → 4096）—— 原片 P(doom) 的位置 */
const ANCHORS = ${JSON.stringify(ANTHEM_LAYER_ANCHORS)};
{
  let v = ANCHORS[0][1];
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const a = ANCHORS[i], b = ANCHORS[i + 1];
    if (t >= a[0] && t < b[0]) { v = a[1] * Math.pow(b[1] / a[1], (t - a[0]) / (b[0] - a[0])); break; }
    if (t >= b[0]) v = b[1];
  }
  ctx.font = mono(30);
  ctx.fillStyle = alpha(ASH, 0.9);
  ctx.fillText('图层数', 56, H - 64);
  ctx.font = mono(38, 700);
  ctx.fillStyle = alpha(SIGNAL, 0.95);
  ctx.fillText(String(Math.round(Math.max(3, v))).padStart(4, '0'), 56, H - 26);
}

/* —— 逐字歌词（中带，由一层连续地画 —— 词不跳，观众才不换脑子） */
const line = api.lyrics.at() || api.lyrics.before();
if (line) {
  const size = fitSize(line.text, 56, 600, W - 200);
  const font = sans(size, 600);
  ctx.font = font;
  const units = api.lyrics.units(line);
  const chars = Array.from(line.text);
  const total = chars.reduce((a, c) => a + measure2(c, font), 0);
  let x = (W - total) / 2;
  const y = H * 0.62;
  for (let i = 0; i < chars.length; i++) {
    const prog = units[i] ? api.lyrics.progress(units[i]) : 0;
    const w2 = measure2(chars[i], font);
    if (prog <= 0) ctx.fillStyle = alpha(GRAPHITE, 0.8);
    else if (prog >= 1) ctx.fillStyle = alpha(BONE, 0.95);
    else {
      ctx.fillStyle = alpha(GRAPHITE, 0.8);
      ctx.fillText(chars[i], x, y);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y - size, w2 * prog, size * 2);
      ctx.clip();
      ctx.fillStyle = alpha(BONE, 0.95);
      ctx.fillText(chars[i], x, y);
      ctx.restore();
    }
    if (prog >= 1 || prog <= 0) ctx.fillText(chars[i], x, y);
    x += w2;
  }
  /* 行号场记板 */
  const idx = api.lyrics.lines.indexOf(line) + 1;
  ctx.font = mono(15);
  ctx.fillStyle = alpha(ASH, 0.75);
  ctx.fillText(String(idx).padStart(2, '0') + ' / ' + String(api.lyrics.count).padStart(2, '0'), 120, H - 96);
}
NOISE(60);
`;

/* prompt 的另两个窗口复用同一份源码（params.variant 区分），这里导出三个别名由 film.ts 组装 */
