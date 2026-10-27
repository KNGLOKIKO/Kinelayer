/**
 * 「再改一版」的画面代码。
 *
 * 每个字符串都是一个 canvas2d 代码层的**完整源码**（画布 1920×1080）。约定与极限样片一致：
 *   - `time` 是全局毫秒；`api.tempo` 是工程速度网格（拍、小节、强拍、吸附）；
 *   - 同一毫秒必须永远画出同一帧：不许 Math.random、不许读 DOM / 网络 / Date；
 *   - 渐变、路径、随机种子往 `state` 里缓存，逐帧只做算术。
 *
 * 与上一支片子最大的不同是**版面纪律**：全片共用一条三带网格 ——
 *   上带 96–420（读数、图表），
 *   中带 540–720（歌词，由独立的 HUD 层绘），
 *   下带 780–1000（机制示意图、时间轴）。
 * 内容层不许占中带。不是因为「好看」，而是因为歌词要在同一高度上稳定呼吸；
 * 一旦每个场景都在中间放东西，卡拉 OK 就会跳来跳去，观众的节奏感就断了。
 */

import { SECTION_SPANS } from './meta';

/** 公共片段：确定性随机、缓动、色板、字体、颗粒、裁字 */
const PRELUDE = String.raw`
const W = width, H = height;
const rnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
const easeIn = (k) => Math.pow(clamp(k, 0, 1), 3);
const easeInOut = (k) => { k = clamp(k, 0, 1); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const easeBack = (k) => { k = clamp(k, 0, 1); const c = 1.9; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const INK = '#08080A', INK2 = '#141416', GRAPHITE = '#5E5B57', ASH = '#9C978F';
const BONE = '#EEE9DF', SIGNAL = '#FF4D12', EMBER = '#FF8A3D', BLOOD = '#C21D0B', ACID = '#D8FF3C';
const mono = (px, w) => (w || 500) + ' ' + px + 'px Consolas, "SF Mono", ui-monospace, monospace';
const sans = (px, w) => (w || 700) + ' ' + px + 'px "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif';
const serif = (px, w) => 'italic ' + (w || 600) + ' ' + px + 'px Georgia, "Songti SC", "SimSun", serif';
const alpha = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
};
const NOISE = (n) => { for (let i = 0; i < n; i++) { const x = rnd(i * 3.13 + 7) * W; const y = rnd(i * 7.71 + 3) * H; ctx.fillStyle = alpha(BONE, 0.010 + rnd(i + 11) * 0.022); ctx.fillRect(x, y, 1, 1); } };
const T = time;
const BT = api.tempo.ms, BAR = BT * api.tempo.meter;
`;

/* ------------------------------------------------------------ 01 冷开 */
export const R1_COLD_OPEN = `${PRELUDE}
const t = T;
ctx.clearRect(0, 0, W, H);
ctx.fillStyle = INK;
ctx.fillRect(0, 0, W, H);

/* 竖向细栏：像纸上的印刷栏线，给空画面一点「版面」感 */
ctx.strokeStyle = alpha(BONE, 0.028);
ctx.lineWidth = 1;
ctx.beginPath();
for (let x = 120; x <= W - 120; x += 120) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); }
ctx.stroke();

/* 一条竖线：从画面正中长出来，两头同时走（easeOut，900ms） */
const grow = easeOut((t - 120) / 900);
const half = 540 * grow;
ctx.save();
/* 手绘感：三遍轻微偏移的描边，alpha 递增 —— 一遍太干净，像 UI 边框 */
for (let pass = 0; pass < 3; pass++) {
  ctx.strokeStyle = alpha(BONE, 0.30 + pass * 0.22);
  ctx.lineWidth = pass === 2 ? 2 : 1;
  ctx.beginPath();
  for (let y = 540 - half; y <= 540 + half; y += 24) {
    const j = pass === 2 ? 0 : (rnd(y * 0.37 + pass * 9 + t * 0.0002) - 0.5) * 1.6;
    if (y === 540 - half) ctx.moveTo(960 + j, y); else ctx.lineTo(960 + j, y);
  }
  ctx.stroke();
}
ctx.restore();

/* 热点：线头那一小点火，沿线下行，走完留在底部 */
const travel = easeInOut((t - 620) / 1900);
if (travel > 0) {
  const hy = lerp(540 - half, 540 + half, travel);
  for (let i = 6; i >= 1; i--) {
    ctx.fillStyle = alpha(EMBER, 0.05 * (7 - i));
    ctx.beginPath();
    ctx.arc(960, hy, 3 + i * 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = alpha('#FFE9D6', 0.95);
  ctx.beginPath();
  ctx.arc(960, hy, 2.6, 0, Math.PI * 2);
  ctx.fill();
}

/* 角标 */
ctx.font = mono(13);
ctx.textAlign = 'left';
ctx.fillStyle = alpha(GRAPHITE, 0.9);
ctx.fillText('A FILM ABOUT ONE MORE CHANGE', 120, 96);
ctx.textAlign = 'right';
ctx.fillStyle = alpha(ASH, 0.5);
ctx.fillText('60 SEC · 1920×1080 · 30 FPS', W - 120, 96);
ctx.fillText('9 SECTIONS · 0 ASSETS', W - 120, 120);

/* 右侧竖排印字 */
ctx.save();
ctx.translate(W - 62, 540);
ctx.rotate(Math.PI / 2);
ctx.textAlign = 'center';
ctx.font = mono(12);
ctx.fillStyle = alpha(GRAPHITE, 0.75);
ctx.fillText('EVERY CHANGE IS A COMMAND', 0, 0);
ctx.restore();

/* 台词：这一句留在画面左下，像场记板 */
const cap = clamp((t - 1500) / 500, 0, 1);
ctx.globalAlpha = cap;
ctx.font = mono(15);
ctx.fillStyle = alpha(ASH, 0.75);
ctx.fillText('01 / 冷开', 120, H - 120);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.fillText('一条线. 先画它.', 120, H - 96);
ctx.globalAlpha = 1;

NOISE(150);

/* 出场：最后 120ms 拉白，接下一段的硬切 */
const flash = clamp((t - 3580) / 170, 0, 1);
if (flash > 0) { ctx.fillStyle = alpha('#FFF6EE', flash * 0.9); ctx.fillRect(0, 0, W, H); }
`;

/* ------------------------------------------------------ 02 第一句 / 叠层 */
export const R2_FIRST_LINE = `${PRELUDE}
const t = T;
const t0 = 3750;
ctx.clearRect(0, 0, W, H);
ctx.fillStyle = INK;
ctx.fillRect(0, 0, W, H);
/* 上一段的拉白在这里松掉 */
const out = 1 - easeOut((t - t0) / 260);
if (out > 0) { ctx.fillStyle = alpha('#FFF6EE', out * 0.9); ctx.fillRect(0, 0, W, H); }

/* 母题：竖线留在正中（比上一段细一档，退成「背景里的柱子」） */
ctx.strokeStyle = alpha(BONE, 0.10);
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(960.5, 60);
ctx.lineTo(960.5, 520);
ctx.moveTo(960.5, 740);
ctx.lineTo(960.5, H - 60);
ctx.stroke();

/* 左边缘：一层一层码起来的方块。每拍多一层 */
const laid = Math.floor((t - t0) / BT);
for (let i = 0; i < Math.min(15, laid + 1); i++) {
  const k = clamp((t - t0 - i * BT) / 200, 0, 1);
  const y = 150 + i * 34;
  const x = 120;
  ctx.globalAlpha = k;
  ctx.fillStyle = i === 14 ? alpha(SIGNAL, 0.85) : alpha(INK2, 0.9);
  ctx.fillRect(x, y, 56, 26);
  ctx.strokeStyle = alpha(BONE, 0.18);
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, 55, 25);
  /* 缩略图里的两条线，示意「这一层里有东西」 */
  ctx.strokeStyle = alpha(ASH, 0.45);
  ctx.beginPath();
  ctx.moveTo(x + 8, y + 9); ctx.lineTo(x + 30, y + 9);
  ctx.moveTo(x + 8, y + 16); ctx.lineTo(x + 40, y + 16);
  ctx.stroke();
  ctx.font = mono(11);
  ctx.fillStyle = alpha(ASH, 0.8);
  ctx.textAlign = 'left';
  ctx.fillText('L' + (i < 9 ? '0' : '') + (i + 1), x + 66, y + 17);
  ctx.globalAlpha = 1;
}

/* 右侧：层数读数，一拍一个 +1 */
const count = Math.max(1, Math.min(15, laid + 1));
ctx.textAlign = 'right';
ctx.font = mono(13);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.fillText('LAYERS', W - 120, 168);
ctx.font = sans(96, 800);
ctx.fillStyle = BONE;
const bump = 1 + 0.10 * Math.max(0, 1 - ((t - t0) % BT) / 260);
ctx.save();
ctx.translate(W - 120, 250);
ctx.scale(bump, bump);
ctx.fillText((count < 10 ? '0' : '') + count, 0, 0);
ctx.restore();
ctx.font = mono(13);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.fillText('每条都能单独动', W - 120, 286);

/* 右边缘：叠层的剖面线 —— 一层比一层更靠里，暗示深度 */
for (let i = 0; i < count; i++) {
  ctx.strokeStyle = alpha(ASH, 0.10 + i * 0.012);
  ctx.beginPath();
  const x = W - 300 - i * 6;
  ctx.moveTo(x, 340); ctx.lineTo(x + 60, 340 + 26); ctx.stroke();
}

/* 下带：一条尺度线 + 说明 */
ctx.strokeStyle = alpha(BONE, 0.12);
ctx.beginPath();
ctx.moveTo(120, H - 150); ctx.lineTo(W - 120, H - 150); ctx.stroke();
for (let i = 0; i <= 24; i++) {
  const x = 120 + i * ((W - 240) / 24);
  const h = i % 4 === 0 ? 12 : 6;
  ctx.strokeStyle = alpha(BONE, i % 4 === 0 ? 0.3 : 0.14);
  ctx.beginPath(); ctx.moveTo(x, H - 150); ctx.lineTo(x, H - 150 + h); ctx.stroke();
}
ctx.font = mono(12);
ctx.fillStyle = alpha(GRAPHITE, 0.9);
ctx.textAlign = 'left';
ctx.fillText('02 / 第一句 · 图层是一条一条摞起来的', 120, H - 108);
ctx.textAlign = 'right';
ctx.fillText('128 BPM · 4/4 · 两小节一格', W - 120, H - 108);

NOISE(140);
`;

/* ------------------------------------------------- 03 图层树 / 播放头 */
export const R3_TIMELINE = `${PRELUDE}
const t = T;
const SECS = ${JSON.stringify(SECTION_SPANS)};
const TOTAL = SECS[SECS.length - 1].to;
ctx.clearRect(0, 0, W, H);
ctx.fillStyle = INK;
ctx.fillRect(0, 0, W, H);

/* 上带：标题 + 拍点指示灯 */
ctx.font = mono(12);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.textAlign = 'left';
ctx.fillText('TIMELINE / ' + (TOTAL / 1000) + ' SEC · ' + SECS.length + ' SECTIONS · ' + Math.round(TOTAL / BAR) + ' BARS', 120, 112);
ctx.font = sans(44, 700);
ctx.fillStyle = alpha(BONE, 0.9);
ctx.fillText('播放头', 120, 176);
ctx.font = mono(12);
ctx.fillStyle = alpha(ASH, 0.55);
ctx.fillText('整支片子只有这一根针', 120, 200);

for (let i = 0; i < 4; i++) {
  const on = i === Math.floor(api.tempo.beat) % 4;
  ctx.beginPath();
  ctx.arc(W - 120 - (3 - i) * 26, 140, on ? 5 : 3, 0, Math.PI * 2);
  ctx.fillStyle = on ? SIGNAL : alpha(BONE, 0.22);
  ctx.fill();
}
ctx.font = mono(12);
ctx.fillStyle = alpha(GRAPHITE, 0.9);
ctx.textAlign = 'right';
ctx.fillText('BAR ' + (Math.floor(api.tempo.bar) + 1) + ' · BEAT ' + (Math.floor(api.tempo.beat) % 4 + 1), W - 120, 176);

/* 下带：整片的时间轴。横轴是「整支片子」，不是这一段 ——
   这一段只有 6 秒，放大到满幅会显得宇宙很大而内容很少 */
const RX0 = 200, RX1 = W - 140, RY = 1000;
const xOf = (ms) => RX0 + (clamp(ms, 0, TOTAL) / TOTAL) * (RX1 - RX0);

/* 段落带：九块，当前这块亮一档 */
SECS.forEach((sec, i) => {
  const x0 = xOf(sec.from), x1 = xOf(sec.to);
  const here = t >= sec.from && t < sec.to;
  ctx.fillStyle = here ? alpha(SIGNAL, 0.10) : alpha(BONE, 0.028);
  ctx.fillRect(x0, 726, Math.max(1, x1 - x0 - 2), 14);
  ctx.fillStyle = here ? alpha(SIGNAL, 0.75) : alpha(ASH, 0.35);
  ctx.fillRect(x0, 726, Math.max(1, x1 - x0 - 2), 2);
  ctx.font = mono(10);
  ctx.fillStyle = here ? alpha(SIGNAL, 0.95) : alpha(GRAPHITE, 0.9);
  ctx.textAlign = 'left';
  ctx.fillText((i < 9 ? '0' : '') + (i + 1), x0 + 5, 764);
  if (x1 - x0 > 90) {
    ctx.fillStyle = here ? alpha(ASH, 0.9) : alpha(GRAPHITE, 0.75);
    ctx.fillText(sec.name, x0 + 24, 764);
  }
});

/* 标尺：每小节一根，四小节标一次数字 */
ctx.strokeStyle = alpha(BONE, 0.14);
ctx.beginPath(); ctx.moveTo(RX0, RY); ctx.lineTo(RX1, RY); ctx.stroke();
const bars = Math.round(TOTAL / BAR);
for (let b = 0; b <= bars; b++) {
  const x = xOf(b * BAR);
  const major = b % 4 === 0;
  ctx.strokeStyle = alpha(BONE, major ? 0.30 : 0.12);
  ctx.beginPath(); ctx.moveTo(x, RY); ctx.lineTo(x, RY + (major ? 13 : 6)); ctx.stroke();
  if (major) {
    ctx.font = mono(10);
    ctx.fillStyle = alpha(GRAPHITE, 0.9);
    ctx.textAlign = 'center';
    ctx.fillText((b < 9 ? '0' : '') + b, x, RY + 28);
  }
}

/* 15 条轨道 */
const head = xOf(t);
for (let i = 0; i < 15; i++) {
  const y = 780 + i * 11;
  const a0 = rnd(i * 2.7) * TOTAL * 0.62;
  const a1 = a0 + 900 + rnd(i * 5.3 + 1) * 9000;
  const x0 = xOf(a0), x1 = xOf(a1);
  ctx.fillStyle = alpha(ASH, 0.13);
  ctx.fillRect(x0, y, Math.max(2, x1 - x0), 5);
  if (head > x0) {
    const heat = clamp(1 - (head - x1) / 900, 0.22, 1);
    ctx.fillStyle = alpha(SIGNAL, 0.62 * heat);
    ctx.fillRect(x0, y, Math.max(0, Math.min(head, x1) - x0), 5);
  }
  ctx.font = mono(9);
  ctx.fillStyle = alpha(GRAPHITE, 0.8);
  ctx.textAlign = 'right';
  ctx.fillText('L' + (i < 9 ? '0' : '') + (i + 1), RX0 - 14, y + 6);
}

/* 播放头：一根竖线 + 顶部小三角 + 一段渐变辉光（不是几条硬边矩形） */
const glow = ctx.createLinearGradient(head - 46, 0, head + 46, 0);
glow.addColorStop(0, alpha(SIGNAL, 0));
glow.addColorStop(0.5, alpha(SIGNAL, 0.16));
glow.addColorStop(1, alpha(SIGNAL, 0));
ctx.fillStyle = glow;
ctx.fillRect(head - 46, 700, 92, RY - 700 + 8);
ctx.fillStyle = alpha(SIGNAL, 0.95);
ctx.fillRect(head - 1, 700, 2, RY - 700 + 8);
ctx.beginPath();
ctx.moveTo(head - 7, 690); ctx.lineTo(head + 7, 690); ctx.lineTo(head, 701);
ctx.closePath();
ctx.fill();

ctx.font = mono(12);
ctx.fillStyle = alpha(BONE, 0.85);
ctx.textAlign = head > W - 320 ? 'right' : 'left';
ctx.fillText((t / 1000).toFixed(2) + 's', head + (head > W - 320 ? -12 : 12), 676);

NOISE(140);
`;

/* --------------------------------------------- 04 版本 / 数字开始爬 */
export const R4_VERSION = `${PRELUDE}
const t = T;
const t0 = 18750, t1 = 26250;
ctx.clearRect(0, 0, W, H);
ctx.fillStyle = INK;
ctx.fillRect(0, 0, W, H);

/* 三个读数：版本 / 今天收工的概率 / 撤销栈深度 */
const p = clamp((t - t0) / (t1 - t0), 0, 1);
const cols = [
  { label: 'VERSION', value: String(1 + Math.floor(p * 11)), foot: '版本号' },
  { label: 'P(SHIP TODAY)', value: (0.02 + p * 0.40).toFixed(2), foot: '今天收工' },
  { label: 'UNDO DEPTH', value: String(3 + Math.floor(p * 34)), foot: '撤销栈' }
];
for (let i = 0; i < 3; i++) {
  const x = 120 + i * 600;
  ctx.textAlign = 'left';
  ctx.font = mono(12);
  ctx.fillStyle = alpha(GRAPHITE, 0.95);
  ctx.fillText(cols[i].label, x, 140);
  /* 数字：机械滚动感 —— 每拍重新缩放一次，不做逐位动画（逐位太花，且看不清） */
  const beatK = clamp(1 - (t % BT) / 180, 0, 1);
  ctx.save();
  ctx.translate(x, 250);
  ctx.scale(1 + beatK * 0.03, 1 + beatK * 0.03);
  ctx.font = mono(84, 700);
  ctx.fillStyle = i === 1 ? SIGNAL : BONE;
  ctx.fillText(cols[i].value, 0, 0);
  ctx.restore();
  ctx.font = mono(12);
  ctx.fillStyle = alpha(ASH, 0.7);
  ctx.fillText(cols[i].foot, x, 286);
  ctx.strokeStyle = alpha(BONE, 0.10);
  ctx.beginPath(); ctx.moveTo(x, 306); ctx.lineTo(x + 420, 306); ctx.stroke();
}

/* 下带：改稿次数的柱状图。越往后越高，最后几根被上沿切断 */
const N = 15;
const baseY = 1000, cutY = 780;
ctx.strokeStyle = alpha(BONE, 0.14);
ctx.beginPath(); ctx.moveTo(120, baseY + 0.5); ctx.lineTo(W - 120, baseY + 0.5); ctx.stroke();
const shown = clamp((t - t0) / 240, 0, N);
const bw = (W - 240) / N - 10;
for (let i = 0; i < N; i++) {
  const k = clamp(shown - i, 0, 1);
  if (k <= 0) break;
  const grow = easeBack(k);
  const h = (18 + Math.pow(i, 1.85) * 2.6) * grow;
  const x = 120 + i * (bw + 10);
  const y = baseY - Math.min(h, 260);
  const cut = h > 260;
  ctx.fillStyle = alpha(i === N - 1 ? SIGNAL : ASH, i === N - 1 ? 0.9 : 0.34);
  ctx.fillRect(x, y, bw, baseY - y);
  if (cut) {
    /* 被切断：两道斜线告诉观众「这不是最高值，是我们不再画了」 */
    ctx.strokeStyle = alpha(i === N - 1 ? SIGNAL : ASH, 0.9);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, cutY + 8); ctx.lineTo(x + bw, cutY - 4);
    ctx.moveTo(x, cutY + 18); ctx.lineTo(x + bw, cutY + 6);
    ctx.stroke();
    ctx.lineWidth = 1;
  }
  ctx.font = mono(10);
  ctx.fillStyle = alpha(GRAPHITE, 0.95);
  ctx.textAlign = 'center';
  ctx.fillText(String(i + 1), x + bw / 2, baseY + 18);
}
ctx.font = mono(12);
ctx.fillStyle = alpha(GRAPHITE, 0.9);
ctx.textAlign = 'left';
ctx.fillText('改动次数 / 每改一次，柱子长一寸', 120, baseY + 46);
ctx.textAlign = 'right';
ctx.fillText('04 / 版本', W - 120, baseY + 46);

NOISE(140);
`;

/* ------------------------------------------------ 05 命令总线 */
export const R5_COMMANDS = `${PRELUDE}
const t = T;
const t0 = 26250, t1 = 33750;
ctx.clearRect(0, 0, W, H);
ctx.fillStyle = INK;
ctx.fillRect(0, 0, W, H);

/* 上带：命令流。真滚，不是假滚 —— 位移直接由时间算，暂停就停住 */
const CMDS = [
  ['layer.add', '07 · 液态 shader'],
  ['text.setContent', '再改一版'],
  ['anim.keyframe.set', 'opacity @ 0.42s'],
  ['code.setRenderScale', '0.5'],
  ['project.setTempo', '128 bpm'],
  ['layer.duplicate', '× 3'],
  ['layer.reorder', '→ 02'],
  ['ai.patch', '6 ops · 1 undo'],
  ['anim.binding.set', 'y = 540 + sin(t)·18'],
  ['history.undo', 'v041 → v040'],
  ['export.video', '1920×1080 · 30fps'],
  ['audio.setVolume', '0.27']
];
const ROW = 34;
const scroll = (t - t0) * 0.028;
const rows = Math.ceil(190 / ROW) + 2;
ctx.font = mono(13);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.textAlign = 'left';
ctx.fillText('COMMAND BUS / 只此一条入口', 120, 112);
ctx.save();
ctx.beginPath();
ctx.rect(0, 132, W, 210);
ctx.clip();
for (let i = 0; i < CMDS.length + rows; i++) {
  const idx = i % CMDS.length;
  const y = 160 + i * ROW - (scroll % (CMDS.length * ROW));
  if (y < 120 || y > 350) continue;
  /* 越靠上越淡：像终端里滚出去的历史 */
  const fade = clamp((y - 128) / 60, 0, 1) * clamp((348 - y) / 60, 0, 1);
  const c = CMDS[idx];
  ctx.globalAlpha = fade;
  ctx.font = mono(12);
  ctx.fillStyle = alpha(GRAPHITE, 0.9);
  ctx.textAlign = 'left';
  ctx.fillText('+' + String(Math.floor((t - t0) / BT)).padStart(3, '0'), 120, y);
  ctx.fillStyle = alpha(ASH, 0.95);
  ctx.font = mono(15);
  ctx.fillText(c[0], 210, y);
  ctx.fillStyle = alpha(BONE, 0.62);
  ctx.font = mono(14);
  ctx.fillText(c[1], 520, y);
  /* 每行的状态点：这条命令在时间轴上被 commit 过 */
  ctx.fillStyle = alpha(EMBER, 0.7);
  ctx.beginPath();
  ctx.arc(190, y - 5, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}
ctx.restore();

/* 下带：三个入口汇入一条总线，再进主窗口 */
const BUSY = 890;
const sources = [
  { x: 120, label: '人', sub: '界面 / 快捷键' },
  { x: 340, label: 'AI', sub: '自然语言' },
  { x: 560, label: 'Agent', sub: '外部工具' }
];
sources.forEach((s, i) => {
  const k = clamp((t - t0 - i * BT * 0.5) / 300, 0, 1);
  ctx.globalAlpha = k;
  ctx.strokeStyle = alpha(BONE, 0.22);
  ctx.lineWidth = 1;
  ctx.strokeRect(s.x + 0.5, 830.5, 160, 58);
  ctx.font = sans(22, 700);
  ctx.fillStyle = alpha(BONE, 0.88);
  ctx.textAlign = 'center';
  ctx.fillText(s.label, s.x + 80, 858);
  ctx.font = mono(10);
  ctx.fillStyle = alpha(GRAPHITE, 0.95);
  ctx.fillText(s.sub, s.x + 80, 876);
  /* 折线：先向右，再向下汇到总线 */
  ctx.strokeStyle = alpha(ASH, 0.35);
  ctx.beginPath();
  ctx.moveTo(s.x + 160, 860);
  ctx.lineTo(s.x + 190, 860);
  ctx.lineTo(s.x + 190, BUSY);
  ctx.lineTo(760, BUSY);
  ctx.stroke();
  ctx.globalAlpha = 1;
});

/* 总线本体：一条双线管道，里面的点按拍往前走 */
ctx.strokeStyle = alpha(SIGNAL, 0.45);
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(760, BUSY - 5); ctx.lineTo(1230, BUSY - 5);
ctx.moveTo(760, BUSY + 5); ctx.lineTo(1230, BUSY + 5);
ctx.stroke();
ctx.lineWidth = 1;
for (let i = 0; i < 9; i++) {
  const travel = ((t - t0) / BT * 0.55 + i / 9) % 1;
  const x = lerp(770, 1220, travel);
  ctx.fillStyle = alpha(EMBER, 0.85 * (1 - Math.abs(travel - 0.5) * 0.6));
  ctx.fillRect(x, BUSY - 2, 8, 4);
}
ctx.font = mono(11);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.textAlign = 'center';
ctx.fillText('Command  ·  apply / invert', 995, BUSY - 18);

/* 主窗口：唯一权威 */
ctx.strokeStyle = alpha(BONE, 0.30);
ctx.strokeRect(1230.5, 830.5, 300, 118);
ctx.font = sans(24, 700);
ctx.fillStyle = BONE;
ctx.textAlign = 'center';
ctx.fillText('主窗口', 1380, 878);
ctx.font = mono(11);
ctx.fillStyle = alpha(ASH, 0.72);
ctx.fillText('唯一权威 / 撤销栈 / 主时钟', 1380, 900);
/* 心跳：笔画随拍亮一下 */
const pulse = clamp(1 - ((t - t0) % BT) / 320, 0, 1);
ctx.strokeStyle = alpha(EMBER, 0.18 + pulse * 0.5);
ctx.lineWidth = 2;
ctx.strokeRect(1230.5, 830.5, 300, 118);
ctx.lineWidth = 1;

/* 撤销栈：右侧一列小格，越堆越高 */
for (let i = 0; i < 12; i++) {
  const on = i < Math.floor(clamp((t - t0) / (t1 - t0), 0, 1) * 12) + 1;
  ctx.fillStyle = on ? alpha(ASH, 0.55) : alpha(ASH, 0.12);
  ctx.fillRect(W - 150, 960 - i * 10, 34, 6);
}
ctx.font = mono(11);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.textAlign = 'right';
ctx.fillText('UNDO', W - 156, 966);

NOISE(140);
`;

/* ------------------------------------------------------ 06 引信 */
export const R6_FUSE = `${PRELUDE}
const t = T;
const t0 = 33750, t1 = 41250;
ctx.clearRect(0, 0, W, H);
ctx.fillStyle = INK;
ctx.fillRect(0, 0, W, H);

/* 底：极暗的热源辉光，跟着火花走 */
const prog = clamp((t - t0) / (t1 - t0), 0, 1);
const burn = easeIn(prog);
const PTS = [
  [110, 952], [330, 930], [520, 990], [700, 920], [880, 966],
  [1080, 900], [1230, 826], [1380, 720], [1500, 590], [1560, 470]
];
/* Catmull-Rom：过所有控制点、C1 连续 —— 一根引信该有的手感。
   线性插值的折线在 1080p 上会看出棱角，观众不一定会说，但一定会觉得「假」 */
const curve = (k) => {
  const n = PTS.length;
  const x = clamp(k, 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  const p0 = PTS[Math.max(0, i - 1)], p1 = PTS[i], p2 = PTS[i + 1], p3 = PTS[Math.min(n - 1, i + 2)];
  const f2 = f * f, f3 = f2 * f;
  const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f2 + (-a + 3 * b - 3 * c + d) * f3);
  return [cr(p0[0], p1[0], p2[0], p3[0]), cr(p0[1], p1[1], p2[1], p3[1])];
};
const spark = curve(burn);
const g = ctx.createRadialGradient(spark[0], spark[1], 0, spark[0], spark[1], 460);
g.addColorStop(0, alpha(EMBER, 0.16));
g.addColorStop(0.45, alpha(BLOOD, 0.05));
g.addColorStop(1, alpha(INK, 0));
ctx.fillStyle = g;
ctx.fillRect(0, 0, W, H);

/* 整根引信：先铺一条暗的，再把「烧过的」压成黑色，最后点亮余温 */
ctx.lineJoin = 'round';
const tracePath = () => {
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const q = curve(i / 120);
    if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
  }
};
ctx.strokeStyle = alpha(ASH, 0.30);
ctx.lineWidth = 6;
tracePath();
ctx.stroke();
ctx.strokeStyle = alpha(BONE, 0.10);
ctx.lineWidth = 2;
ctx.stroke();

/* 烧过的一段：颜色从余温（ember）过渡到灰烬（ink2） */
const BURN_STEPS = 60;
for (let i = 0; i < BURN_STEPS; i++) {
  const a = (i / BURN_STEPS) * burn;
  const b = ((i + 1) / BURN_STEPS) * burn;
  const pa = curve(a), pb = curve(b);
  const heat = Math.pow(i / BURN_STEPS, 2.2);
  ctx.strokeStyle = alpha(heat > 0.72 ? BLOOD : INK2, 0.95);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]);
  ctx.stroke();
}

/* 火花：三层叠加，最里层接近白 */
for (let i = 8; i >= 1; i--) {
  ctx.fillStyle = i > 4 ? alpha(EMBER, 0.05 * (9 - i)) : alpha('#FFD9B8', 0.10 * (5 - i) + 0.06);
  ctx.beginPath();
  ctx.arc(spark[0], spark[1], 4 + i * 7, 0, Math.PI * 2);
  ctx.fill();
}
ctx.fillStyle = '#FFF3E4';
ctx.beginPath();
ctx.arc(spark[0], spark[1], 3.2, 0, Math.PI * 2);
ctx.fill();

/* 余烬：从火花处甩出去的粒子，用 rnd 定初速，落体用时间算 */
for (let i = 0; i < 44; i++) {
  const born = rnd(i * 1.7) * 0.9;
  const life = clamp((burn - born) / 0.55, 0, 1);
  if (life <= 0 || life >= 1) continue;
  const at = curve(clamp(burn - life * 0.55, 0, 1));
  const vx = (rnd(i * 3.3) - 0.5) * 130;
  const vy = -60 - rnd(i * 5.1) * 120;
  const x = at[0] + vx * life;
  const y = at[1] + vy * life + 180 * life * life;
  ctx.fillStyle = alpha(i % 5 === 0 ? '#FFD9B8' : EMBER, (1 - life) * 0.75);
  ctx.fillRect(x, y, 1.8, 1.8);
}

/* 雷管：火花到终点前就开始闪 */
const dx = 1560, dy = 470;
if (t > t0 + (t1 - t0) * 0.72) {
  const blink = 0.35 + 0.65 * Math.abs(Math.sin((t / BT) * Math.PI));
  ctx.strokeStyle = alpha(SIGNAL, blink * 0.9);
  ctx.lineWidth = 2;
  ctx.strokeRect(dx - 34, dy - 34, 68, 68);
  ctx.fillStyle = alpha(SIGNAL, blink * 0.14);
  ctx.fillRect(dx - 34, dy - 34, 68, 68);
  ctx.lineWidth = 1;
  ctx.font = mono(10);
  ctx.fillStyle = alpha(SIGNAL, 0.8);
  ctx.textAlign = 'center';
  ctx.fillText('DETONATE', dx, dy - 44);
}

/* 上带读数 */
ctx.textAlign = 'left';
ctx.font = mono(12);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.fillText('FUSE / ONE STROKE', 120, 120);
ctx.font = mono(46, 700);
ctx.fillStyle = alpha(BONE, 0.9);
ctx.fillText((burn * 100).toFixed(1) + '%', 120, 186);
ctx.font = mono(11);
ctx.fillStyle = alpha(ASH, 0.6);
ctx.fillText('烧到哪儿，就改到哪儿', 120, 208);

ctx.textAlign = 'right';
ctx.font = mono(12);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.fillText('06 / 引信', W - 120, 120);
ctx.fillStyle = alpha(ASH, 0.55);
ctx.fillText('一段路径，一个热点，没有第二个机关', W - 120, 144);

NOISE(150);
`;

/* ------------------------------------------------------ 07 引爆（GLSL） */
export const R7_BLAST_GLSL = String.raw`
void main() {
  /* 用归一化坐标，不用 gl_FragCoord 的像素坐标：
     开了 renderScale 之后画布只有图层的一半大，像素坐标的中心会跑到边角上。
     u_resolution 永远是图层的设计尺寸，除以它才是与分辨率无关的坐标。 */
  vec2 uv = (gl_FragCoord.xy / u_resolution - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  float r = length(uv);
  float a = atan(uv.y, uv.x);
  /* 本段起于 41.25s（与 film.ts 的切点同一个数） */
  float t = max(u_time - 41.25, 0.0);
  float k = clamp(t / 2.8, 0.0, 1.0);

  vec3 col = vec3(0.031, 0.031, 0.039);

  /* 核心：一开始是一小团白，随 k 迅速收紧并熄灭 */
  float core = exp(-r * (11.0 + 44.0 * k)) * (1.0 - k);
  col += vec3(1.0, 0.80, 0.58) * core * 1.7;

  /* 放射条纹：26 条，外缘被一个随 k 扩张的壳限制住 */
  float streak = pow(0.5 + 0.5 * sin(a * 26.0 + 1.6), 14.0);
  float shell = smoothstep(k * 1.45 + 0.08, k * 1.45 - 0.06, r) * smoothstep(k * 0.12, k * 0.42, r);
  col += mix(vec3(1.0, 0.32, 0.08), vec3(0.55, 0.07, 0.03), k) * streak * shell * (1.7 - k * 0.8);

  /* 三个扩散环，一个比一个慢 */
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float rr = k * (1.05 + fi * 0.30) - fi * 0.07;
    float d = abs(r - rr);
    col += vec3(1.0, 0.52, 0.26) * smoothstep(0.022, 0.0, d) * (1.0 - k) * (0.55 - fi * 0.13);
  }

  /* 底噪：极轻的低频斑驳，避免大片纯黑显得像没渲 */
  col += vec3(0.02, 0.018, 0.016) * (0.6 + 0.4 * sin(uv.x * 9.0 + u_time * 0.7) * sin(uv.y * 11.0));

  /* 暗角 */
  col *= 1.0 - 0.6 * smoothstep(0.34, 1.05, r);

  gl_FragColor = vec4(col, 1.0);
}
`;

export const R7_BLAST_TYPE = `${PRELUDE}
const t = T;
const t0 = 41250, t1 = 45000;
ctx.clearRect(0, 0, W, H);

/* 开场两帧的爆白 + 唯一一次「酸绿」：全片只在这里用，稀有性就是强调 */
/* 爆白 120ms、酸绿 110ms：都是一两帧的事。拉长就不是「闪」，是「染」 */
const flash = clamp(1 - (t - t0) / 120, 0, 1);
if (flash > 0) { ctx.fillStyle = alpha('#FFF8F0', flash * 0.92); ctx.fillRect(0, 0, W, H); }
const acid = clamp(1 - (t - t0) / 110, 0, 1);
if (acid > 0) { ctx.fillStyle = alpha(ACID, acid * acid * 0.5); ctx.fillRect(0, 0, W, H); }

const k = clamp((t - t0) / (t1 - t0), 0, 1);
const cx = 1560 * 0.5 + 960 * 0.5, cy = 470 * 0.55 + 540 * 0.45;

/* 15 个图层名被炸出去，越飞越慢，最后停在四周 —— 炸完就是一张图层表 */
const NAMES = [
  '冷开', '第一句', '图层树', '版本', '命令', '引信',
  '引爆', '数字', '落版', 'HUD', '歌词', '标题',
  '标签', '署名', '底噪'
];
for (let i = 0; i < NAMES.length; i++) {
  const ang = (i / NAMES.length) * Math.PI * 2 + 0.35;
  const sp = 420 + rnd(i * 4.7) * 560;
  const delay = rnd(i * 2.1) * 260;
  const e = easeOut(clamp((t - t0 - delay) / 900, 0, 1));
  const x = cx + Math.cos(ang) * sp * e;
  const y = cy + Math.sin(ang) * sp * 0.62 * e;
  const a = clamp(e * 1.4, 0, 1) * (1 - clamp((k - 0.82) / 0.18, 0, 1) * 0.75);
  ctx.globalAlpha = a;
  /* 牵引线：从中心到标签，长度随飞散拉长 */
  ctx.strokeStyle = alpha(ASH, 0.18);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(ang) * 40, cy + Math.sin(ang) * 25);
  ctx.lineTo(x - Math.cos(ang) * 8, y - Math.sin(ang) * 5);
  ctx.stroke();
  ctx.font = mono(13);
  ctx.fillStyle = alpha(i === 6 ? SIGNAL : BONE, 0.9);
  ctx.textAlign = 'left';
  ctx.fillText('L' + (i < 9 ? '0' : '') + (i + 1), x + 6, y - 4);
  ctx.font = sans(15, 500);
  ctx.fillStyle = alpha(ASH, 0.8);
  ctx.fillText(NAMES[i], x + 6, y + 16);
  ctx.globalAlpha = 1;
}

/* 碎屑：90 颗，沿径向甩出后受阻尼停下 */
for (let i = 0; i < 90; i++) {
  const ang = rnd(i * 1.3) * Math.PI * 2;
  const sp = 300 + rnd(i * 6.1) * 900;
  const e = easeOut(clamp((t - t0) / 1100, 0, 1));
  const x = cx + Math.cos(ang) * sp * e;
  const y = cy + Math.sin(ang) * sp * 0.6 * e;
  const a = (1 - e * 0.75) * 0.8;
  ctx.fillStyle = alpha(i % 7 === 0 ? SIGNAL : ASH, a);
  ctx.fillRect(x, y, 1.6 + rnd(i) * 1.6, 1.6);
}

/* 底部读数：这一炸炸出多少层 */
ctx.font = mono(13);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.textAlign = 'left';
ctx.fillText('07 / 引爆', 120, H - 120);
ctx.font = mono(12);
ctx.fillStyle = alpha(ASH, 0.75);
ctx.fillText('15 LAYERS · 1 CMD · 0 ASSETS', 120, H - 96);

NOISE(120);
`;

/* ------------------------------------------------ 08 数字崩坏 */
export const R8_NAN = `${PRELUDE}
const t = T;
const t0 = 45000, t1 = 52500;
ctx.clearRect(0, 0, W, H);
ctx.fillStyle = INK;
ctx.fillRect(0, 0, W, H);

/* 整段轻微的机位抖动：崩溃之后才明显 */
const broke = t > t0 + 2400;
const shakeAmp = broke ? 5 * Math.max(0, 1 - (t - t0 - 2400) / 900) : 0;
ctx.save();
if (shakeAmp > 0.01) ctx.translate((rnd(t * 0.9) - 0.5) * shakeAmp, (rnd(t * 1.3) - 0.5) * shakeAmp);

ctx.textAlign = 'center';
ctx.font = mono(13);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.fillText('P(SHIP TODAY) / 今天收工的概率', 960, 150);

/* 数字：先一路走到 0.99，然后崩成 NaN。0.99 → NaN 是这支片子的「结论」 */
const before = clamp((t - t0) / 2400, 0, 1);
const value = broke ? 'NaN' : (0.99 * easeOut(before)).toFixed(2);
ctx.font = mono(210, 700);
ctx.textAlign = 'center';
const chars = [...value];
const widths = chars.map((c) => ctx.measureText(c).width);
const total = widths.reduce((s, w) => s + w, 0);
let x = 960 - total / 2;
for (let i = 0; i < chars.length; i++) {
  /* 崩了之后每个字自己抖：振幅按 rnd 定，随时间收敛 */
  const jx = broke ? (rnd(i * 7.1 + Math.floor(t / 33)) - 0.5) * 26 * Math.max(0, 1 - (t - t0 - 2400) / 1200) : 0;
  const jy = broke ? (rnd(i * 3.7 + Math.floor(t / 33)) - 0.5) * 18 * Math.max(0, 1 - (t - t0 - 2400) / 1200) : 0;
  ctx.fillStyle = broke ? alpha(SIGNAL, 0.95) : alpha(BONE, 0.95);
  ctx.textAlign = 'left';
  ctx.fillText(chars[i], x + jx, 400 + jy);
  x += widths[i] + 6;
}

/* 分母：一条横线表示「除不尽」 */
ctx.strokeStyle = alpha(BONE, 0.16);
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(560, 440); ctx.lineTo(1360, 440);
ctx.stroke();

/* 下带：两个并置的事实 */
ctx.textAlign = 'left';
ctx.font = mono(12);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.fillText('VERSION', 120, H - 180);
ctx.font = mono(72, 700);
ctx.fillStyle = alpha(BONE, 0.92);
ctx.fillText(broke ? '∞' : '041', 120, H - 118);
ctx.font = mono(12);
ctx.fillStyle = alpha(ASH, 0.6);
ctx.fillText(broke ? '版本号没有上界' : '第四十一版', 120, H - 96);

ctx.textAlign = 'right';
ctx.font = mono(12);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.fillText('UNDO DEPTH', W - 120, H - 180);
ctx.font = mono(72, 700);
ctx.fillStyle = alpha(EMBER, 0.92);
ctx.fillText('118', W - 120, H - 118);
ctx.font = mono(12);
ctx.fillStyle = alpha(ASH, 0.6);
ctx.fillText('每一次都还在', W - 120, H - 96);

ctx.restore();

NOISE(120);

/* 崩溃那一帧的横向撕裂：三条错位的白线，只存在 90ms */
const tear = clamp(1 - (t - t0 - 2400) / 90, 0, 1);
if (tear > 0) {
  for (let i = 0; i < 3; i++) {
    const y = 300 + rnd(i * 5.5) * 180;
    ctx.fillStyle = alpha(BONE, tear * 0.5);
    ctx.fillRect(0, y, W, 2);
  }
}
`;

/* ------------------------------------------------------ 09 落版 */
export const R9_END = `${PRELUDE}
const t = T;
const t0 = 52500, t1 = 60000;
const k = clamp((t - t0) / 900, 0, 1);
ctx.clearRect(0, 0, W, H);
ctx.fillStyle = INK;
ctx.fillRect(0, 0, W, H);

/* 版面框：向内收 40px 的细线，是「海报」这个载体的最后一次自我指认 */
ctx.globalAlpha = easeOut((t - t0) / 700) * 0.5;
ctx.strokeStyle = alpha(BONE, 0.16);
ctx.lineWidth = 1;
ctx.strokeRect(40.5, 40.5, W - 81, H - 81);
ctx.globalAlpha = 1;

/* 母题的收束：那一根竖线最后缩成一颗点，停在标题左边 */
const settle = easeInOut((t - t0) / 1200);
const lineH = lerp(220, 0, clamp((t - t0 - 4200) / 1200, 0, 1));
const lx = 236;
ctx.strokeStyle = alpha(BONE, 0.55 * (1 - clamp((t - t0 - 4200) / 1400, 0, 1)));
ctx.lineWidth = 2;
ctx.beginPath();
ctx.moveTo(lx, 470 - lineH / 2);
ctx.lineTo(lx, 470 + lineH / 2);
ctx.stroke();
/* 点：线全部收进去之后才亮 */
const dot = clamp((t - t0 - 5200) / 400, 0, 1);
if (dot > 0) {
  ctx.fillStyle = alpha(SIGNAL, dot);
  ctx.beginPath();
  ctx.arc(lx, 470, 3.2, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 4; i >= 1; i--) {
    ctx.fillStyle = alpha(SIGNAL, 0.03 * (5 - i) * dot);
    ctx.beginPath();
    ctx.arc(lx, 470, 3.2 + i * 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* 落版的分栏细线 */
ctx.globalAlpha = easeOut((t - t0 - 500) / 900);
ctx.strokeStyle = alpha(BONE, 0.10);
ctx.beginPath();
ctx.moveTo(120, 700.5); ctx.lineTo(W - 120, 700.5);
ctx.stroke();
ctx.globalAlpha = 1;

/* 左下：三行事实，全部可核对 */
const credits = [
  ['60 SEC', '9 个代码层 · 6 条合成音轨 · 0 个外部资源'],
  ['1 PROJECT', '全部图层、关键帧、命令都可在这里编辑'],
  ['128 BPM', '画面与鼓点共用同一份速度网格']
];
ctx.textAlign = 'left';
credits.forEach((c, i) => {
  const a = easeOut((t - t0 - 900 - i * 220) / 600);
  ctx.globalAlpha = a;
  ctx.font = mono(12);
  ctx.fillStyle = alpha(GRAPHITE, 0.95);
  ctx.fillText(c[0], 120, 780 + i * 56);
  ctx.font = sans(16, 500);
  ctx.fillStyle = alpha(ASH, 0.85);
  ctx.fillText(c[1], 240, 780 + i * 56);
  ctx.globalAlpha = 1;
});

/* 右下：地址 + 播放提示 */
const a2 = easeOut((t - t0 - 1500) / 700);
ctx.globalAlpha = a2;
ctx.textAlign = 'right';
ctx.font = mono(15);
ctx.fillStyle = alpha(BONE, 0.8);
ctx.fillText('github.com/KNGLOKIKO/Kinelayer', W - 120, 780);
ctx.font = mono(12);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.fillText('SPACE 播放 · ← → 逐帧 · ⌘Z 撤回', W - 120, 806);
ctx.globalAlpha = 1;

/* 片尾最后一秒：整幅压暗，字反而更亮（pdoom 也这么收） */
const dim = clamp((t - (t1 - 900)) / 900, 0, 1);
if (dim > 0) {
  ctx.fillStyle = alpha(INK, dim * 0.45);
  ctx.fillRect(0, 0, W, H);
}

NOISE(110);
`;

/* -------------------------------------------- HUD / 歌词（全片一层） */
export const R_HUD = `${PRELUDE}
const SECS = ${JSON.stringify(SECTION_SPANS)};

const secIdx = (() => { let i = 0; for (let j = 0; j < SECS.length; j++) if (T >= SECS[j].from) i = j; return i; })();
const sec = SECS[secIdx];

ctx.clearRect(0, 0, W, H);

/* ---- 边框与角标：全片的「印刷家具」，一直在，从不抢戏 ---- */
ctx.strokeStyle = alpha(BONE, 0.10);
ctx.lineWidth = 1;
ctx.strokeRect(24.5, 24.5, W - 49, H - 49);

ctx.font = mono(11);
ctx.textAlign = 'left';
ctx.fillStyle = alpha(ASH, 0.55);
ctx.fillText('KINELAYER', 44, 52);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.fillText('REV 01', 44, 68);

/* 右上：时码。逐帧数出来的，不是猜的 */
const FPS = 30;
const ff = Math.floor(T / 1000 * FPS) % FPS;
const ss = Math.floor(T / 1000) % 60;
const mm = Math.floor(T / 60000);
const pad = (n) => (n < 10 ? '0' + n : '' + n);
ctx.textAlign = 'right';
ctx.font = mono(12);
ctx.fillStyle = alpha(ASH, 0.7);
ctx.fillText(pad(mm) + ':' + pad(ss) + ':' + pad(ff), W - 44, 52);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.font = mono(10);
ctx.fillText('128 BPM · 4/4', W - 44, 68);

/* 左下：段落号与段名 */
ctx.textAlign = 'left';
ctx.font = mono(11);
ctx.fillStyle = alpha(GRAPHITE, 0.95);
ctx.fillText(pad(secIdx + 1) + ' / ' + pad(SECS.length) + ' · ' + sec.name, 44, H - 44);
/* 段落进度：一条极短的横线，跟着这一段走 */
const inSec = clamp((T - sec.from) / (sec.to - sec.from), 0, 1);
ctx.fillStyle = alpha(BONE, 0.12);
ctx.fillRect(44, H - 32, 120, 1);
ctx.fillStyle = alpha(SIGNAL, 0.8);
ctx.fillRect(44, H - 32, 120 * inSec, 1);

/* 右下：四拍指示灯 */
for (let i = 0; i < 4; i++) {
  const on = i === Math.floor(api.tempo.beat) % 4;
  const h = on ? 8 + api.tempo.hit() * 6 : 4;
  ctx.fillStyle = on ? alpha(SIGNAL, 0.9) : alpha(ASH, 0.25);
  ctx.fillRect(W - 44 - (3 - i) * 9, H - 44 - h, 3, h);
}

/* ---- 卡拉 OK：逐字擦除，**高亮绝不领先声音** ---- */
const line = api.lyrics.at(T) || api.lyrics.before(T);
if (line) {
  const after = T - line.end;
  const fade = after > 0 ? 1 - clamp(after / 620, 0, 1) : 1;
  if (fade > 0.01) {
    /* 两处「重音」换色：这一版的规则是字面规则，不是随手挑的 */
    const punch = line.text.indexOf('炸') >= 0 || line.text.indexOf('改你') >= 0;
    const hot = punch ? SIGNAL : BONE;
    const big = secIdx === 7 ? 46 : 84;
    const cy = secIdx === 7 ? 906 : 620;

    ctx.textAlign = 'left';
    ctx.font = sans(big, 700);
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '2px';
    const chars = [...line.text];
    const widths = chars.map((c) => ctx.measureText(c).width);
    const total = widths.reduce((s, w) => s + w, 0);
    const startX = 960 - total / 2;

    /* 底：没唱到的字。压在 0.34，能读但不抢 */
    let x = startX;
    ctx.fillStyle = alpha(GRAPHITE, 0.55 * fade);
    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], x, cy);
      x += widths[i];
    }
    /* 上：已唱的字，按字逐个裁切 —— 这就是卡拉 OK 的全部技术 */
    const sung = api.lyrics.chars(line, T);
    let remain = sung;
    x = startX;
    ctx.fillStyle = alpha(hot, 0.98 * fade);
    for (let i = 0; i < chars.length && remain > 0; i++) {
      const k = Math.min(1, remain);
      if (k > 0.01) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x - 2, cy - big * 1.25, (widths[i] + 4) * k, big * 1.7);
        ctx.clip();
        ctx.fillText(chars[i], x, cy);
        ctx.restore();
      }
      x += widths[i];
      remain -= 1;
    }
    if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

    /* 行下的细线：走到哪儿，亮到哪儿（第二重读数，给听不懂词的人） */
    const p = api.lyrics.lineProgress(line, T);
    ctx.fillStyle = alpha(BONE, 0.16 * fade);
    ctx.fillRect(startX, cy + 26, total, 1);
    ctx.fillStyle = alpha(hot, 0.55 * fade);
    ctx.fillRect(startX, cy + 26, total * p, 1);
  }
}
`;
