/**
 * 极限样片的画面代码。
 *
 * 每个字符串都是一个 canvas2d 代码层的**完整源码**（画布 1920×1080）。
 * 约定（与 core/sampleProject.ts 一致）：
 *   - `time` 是**全局毫秒**，不是图层本地时间 —— 换章节不用重新对表；
 *   - 画布坐标就是 1920×1080 的设计坐标，不用管 devicePixelRatio；
 *   - 不要在这里读 DOM / 网络 / 时间：同一毫秒必须永远画出同一帧。
 *
 * 性能是硬约束：导出走实时录屏，一帧超过 16ms 就会掉帧。
 * 所以渐变、路径、随机数种子都往 `state` 里缓存，循环里只做算术。
 */

/* ------------------------------------------------------------ 公共片段 */

/** 确定性随机 + 常用缓动。每个场景自己带上，代码层之间不共享作用域 */
const PRELUDE = `
const rnd = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, k) => a + (b - a) * k;
const easeOut = (k) => 1 - Math.pow(1 - clamp(k, 0, 1), 3);
const easeIn = (k) => Math.pow(clamp(k, 0, 1), 3);
const easeInOut = (k) => { k = clamp(k, 0, 1); return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; };
const ORANGE = '#ff8a3d';
const INK = '#05060a';
const PAPER = '#f4f4f6';
const MONO = '500 16px Consolas, "SF Mono", Menlo, monospace';
`;

/* --------------------------------------------------------------- S1 冷开 */

export const S1_COLD_OPEN = `${PRELUDE}
const T = time;
ctx.clearRect(0, 0, width, height);

/* 底：几乎全黑的径向渐变 + 60px 细网格，给大数字一个「有纵深」的场 */
if (!state.bg) {
  const g = ctx.createRadialGradient(width * 0.42, height * 0.52, 60, width * 0.42, height * 0.52, width * 0.72);
  g.addColorStop(0, '#0d1018');
  g.addColorStop(0.55, '#080a10');
  g.addColorStop(1, INK);
  state.bg = g;
}
ctx.fillStyle = state.bg;
ctx.fillRect(0, 0, width, height);

ctx.strokeStyle = 'rgba(255,255,255,0.035)';
ctx.lineWidth = 1;
ctx.beginPath();
for (let x = 0; x <= width; x += 60) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, height); }
for (let y = 0; y <= height; y += 60) { ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); }
ctx.stroke();

/* 一道横向扫光：380ms 起，1.1 秒扫过整幅 */
const sweep = clamp((T - 380) / 1150, 0, 1);
if (sweep > 0 && sweep < 1) {
  const head = -200 + (width + 400) * easeOut(sweep);
  const grad = ctx.createLinearGradient(head - 520, 0, head, 0);
  grad.addColorStop(0, 'rgba(255,138,61,0)');
  grad.addColorStop(0.75, 'rgba(255,138,61,0.22)');
  grad.addColorStop(1, 'rgba(255,236,214,0.95)');
  ctx.fillStyle = grad;
  ctx.fillRect(head - 520, height * 0.56 - 2, 520, 4);
  ctx.fillStyle = 'rgba(255,138,61,0.09)';
  ctx.fillRect(head - 520, height * 0.56 - 34, 520, 68);
}

/* 主数字 15：从 3.6 倍「砸」到 1 倍，带四层橙色残影 */
const SLAM = 820;
if (T > SLAM) {
  const k = easeOut((T - SLAM) / 460);
  const s = lerp(3.6, 1, k);
  const alpha = clamp((T - SLAM) / 120, 0, 1);
  const cx = 300;
  const cy = 600;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.textBaseline = 'alphabetic';
  ctx.font = '900 430px "Arial Black", Impact, "Microsoft YaHei", sans-serif';
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '-14px';
  /*
   * 残影只用来给「砸」这一下加速度感：同一颜色、低透明度、沿运动方向错开。
   * 之前用浅色高分身，六层叠上去直接把主色冲成灰的 —— 残影要淡，主形要实。
   */
  for (let i = 4; i >= 1; i--) {
    ctx.globalAlpha = alpha * 0.14 * (5 - i) * 0.5;
    ctx.fillStyle = ORANGE;
    ctx.fillText('15', -180 - i * 2.5, 150 - i * 3);
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = ORANGE;
  ctx.fillText('15', -180, 150);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* 右侧：章节标记 + 一条竖线，把空着的右半边「撑」住 */
const markK = easeOut((T - 1100) / 600);
if (markK > 0) {
  ctx.globalAlpha = markK * 0.9;
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(1580, 300, 1, 300 * markK);
  ctx.font = '500 15px Consolas, monospace';
  ctx.fillStyle = 'rgba(255,138,61,0.85)';
  ctx.fillText('REEL 01', 1612, 320);
  ctx.fillStyle = 'rgba(244,244,246,0.35)';
  ctx.fillText('OPENING', 1612, 344);
  /* 竖排的小字：像胶片边上的印字 */
  ctx.save();
  ctx.translate(1836, 300);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(244,244,246,0.22)';
  ctx.fillText('KINELAYER · EXTREME REEL · 64 SEC', 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
}

/* 右侧文案：竖排细线 + 中文标题逐字擦入 */
const typeStart = 900;
if (T > typeStart) {
  const lineK = easeOut((T - typeStart) / 700);
  ctx.fillStyle = 'rgba(255,138,61,0.85)';
  ctx.fillRect(700, 372, 3, 300 * lineK);

  const chars = '种 MG 风格';
  const per = 110;
  ctx.font = '700 78px "Microsoft YaHei", "PingFang SC", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PAPER;
  let x = 748;
  for (let i = 0; i < chars.length; i++) {
    const k = clamp((T - typeStart - 240 - i * per) / 260, 0, 1);
    if (k <= 0) break;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 4, 300, ctx.measureText(chars[i]).width + 8, 120 * k);
    ctx.clip();
    ctx.fillText(chars[i], x, 396);
    ctx.restore();
    x += ctx.measureText(chars[i]).width + 6;
  }

  const sub = 'FIFTEEN STYLES · TEN SECONDS EACH';
  ctx.font = MONO;
  ctx.fillStyle = 'rgba(244,244,246,0.42)';
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '3px';
  const subK = clamp((T - typeStart - 900) / 400, 0, 1);
  ctx.globalAlpha = subK;
  ctx.fillText(sub.slice(0, Math.ceil(sub.length * subK)), 750, 452);
  ctx.globalAlpha = 1;
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
}

/* 底部：15 个方块逐个点亮，等于把「15 支片」数一遍 */
const rowY = 858;
const rowX = 150;
const lit = Math.floor(clamp((T - 4200) / 70, 0, 15));
for (let i = 0; i < 15; i++) {
  const on = i < lit;
  const x = rowX + i * 46;
  ctx.fillStyle = on ? ORANGE : 'rgba(255,255,255,0.10)';
  ctx.fillRect(x, rowY, 30, 30);
  if (on && i === lit - 1) {
    ctx.strokeStyle = 'rgba(255,138,61,0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 6.5, rowY - 6.5, 43, 43);
  }
}
ctx.font = MONO;
ctx.fillStyle = 'rgba(244,244,246,0.34)';
ctx.fillText('MADE BY WRITING CODE — NO IMAGE, NO VIDEO MODEL', rowX, rowY + 66);

/* 8800 处闪白，接到下一段 */
const flash = clamp((T - 8380) / 380, 0, 1);
if (flash > 0) {
  ctx.fillStyle = 'rgba(255,255,255,' + (flash * flash * 0.92) + ')';
  ctx.fillRect(0, 0, width, height);
}
`;

/* --------------------------------------------------------------- S2 点名 */

/**
 * 15 个风格名，每个 500ms（120 BPM 的一拍），正好 7.5 秒。
 * 进：从下方顶入 + 遮罩擦除；出：向上抽走。右侧一条竖带把全部名字滚一遍。
 */
export const S2_ROSTER = `${PRELUDE}
const T = time;
const START = 8800;
const STEP = 500;
const NAMES = [
  ['逐帧手绘 · 线条沸腾', 'CEL BOIL'],
  ['等轴 2.5D', 'ISOPOLIS'],
  ['扁平矢量', 'ONE DOT'],
  ['线条动画', 'ATELIER LINEA'],
  ['3D 渲染', 'SOFT LANDING'],
  ['形变动画', 'MORPHE'],
  ['粗描边贴纸科普', 'PAPERCLIP'],
  ['赛博 HUD · FUI', 'FALCON-9'],
  ['拼贴剪贴', 'NOGGIN'],
  ['弥散渐变 · 玻璃', 'AURORA'],
  ['几何构成 · 包豪斯', 'KONSTRUKTION'],
  ['复古 Synthwave', 'NEON DRIVE'],
  ['像素风', 'PIXEL QUEST'],
  ['液态流动', 'DROP'],
  ['综艺花字', 'HANAZI'],
];
ctx.clearRect(0, 0, width, height);
/* 底色：冷黑 + 一条极细的地平线。上一版铺了一层橙色渐变，糊成一片泥 */
ctx.fillStyle = '#07080d';
ctx.fillRect(0, 0, width, height);
ctx.fillStyle = 'rgba(255,138,61,0.18)';
ctx.fillRect(120, 812, width - 240, 1);
ctx.fillStyle = 'rgba(255,255,255,0.04)';
ctx.fillRect(0, 0, width, 120);

const i = Math.floor((T - START) / STEP);
if (i >= 0 && i < NAMES.length) {
  const local = (T - START) - i * STEP;
  const inK = easeOut(local / 170);
  const outK = easeIn(clamp((local - STEP + 120) / 120, 0, 1));
  const y = 600 + (1 - inK) * 90 - outK * 110;
  const name = NAMES[i][0];
  const en = NAMES[i][1];

  /* 背景巨号：当前序号放大到 640px 当底纹，每个名字的「场」都不一样 */
  ctx.font = '900 620px "Arial Black", Impact, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.028)';
  ctx.fillText(String(i + 1).padStart(2, '0'), 1180, 720 + (1 - inK) * 40);

  /* 序号 + 总数 */
  ctx.font = '700 22px Consolas, monospace';
  ctx.fillStyle = ORANGE;
  ctx.fillText(String(i + 1).padStart(2, '0'), 150, y - 150);
  ctx.fillStyle = 'rgba(244,244,246,0.28)';
  ctx.fillText('/ 15', 190, y - 150);

  /* 中文名：遮罩擦入。长名字自动缩字号，别溢到右边去 */
  let size = 104;
  ctx.font = '800 ' + size + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
  while (ctx.measureText(name).width > 1320 && size > 54) {
    size -= 6;
    ctx.font = '800 ' + size + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(150, y - size * 0.92, 1500, size * 1.3);
  ctx.clip();
  ctx.fillStyle = PAPER;
  ctx.globalAlpha = 1 - outK * 0.55;
  ctx.fillText(name, 150, y);
  ctx.restore();

  /* 英文名：紧贴中文名下沿，不放到右边去 —— 之前离太远，视线要来回跳 */
  ctx.font = '500 24px Consolas, monospace';
  ctx.fillStyle = 'rgba(255,138,61,0.78)';
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '6px';
  ctx.globalAlpha = clamp((local - 60) / 180, 0, 1) * (1 - outK);
  ctx.fillText(en, 154 + (1 - inK) * 26, y + 54);
  ctx.globalAlpha = 1;
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';

  /* 一条与名字等宽的细线，跟着进出 */
  const wLine = 560 * inK * (1 - outK * 0.8);
  ctx.fillStyle = 'rgba(244,244,246,0.14)';
  ctx.fillRect(150, y + 28, wLine, 1);

  /* 进度：15 个小刻度，当前那个亮着 —— 让「还剩几个」有体感 */
  for (let d = 0; d < 15; d++) {
    const on = d <= i;
    ctx.fillStyle = d === i ? ORANGE : on ? 'rgba(244,244,246,0.30)' : 'rgba(244,244,246,0.10)';
    ctx.fillRect(150 + d * 34, 856, 22, 3);
  }
}

/* 右侧竖带：全部名字以 2 倍速滚过，保证「15」这个量级被看见 */
ctx.save();
ctx.beginPath();
ctx.rect(width - 148, 0, 148, height);
ctx.clip();
ctx.fillStyle = 'rgba(255,255,255,0.035)';
ctx.fillRect(width - 148, 0, 148, height);
const scroll = (T - START) * 0.28;
ctx.font = '700 19px "Microsoft YaHei", sans-serif';
ctx.textAlign = 'center';
for (let k = 0; k < 44; k++) {
  const yy = ((k * 48 - scroll) % (48 * 44) + 48 * 44) % (48 * 44) - 60;
  if (yy < -40 || yy > height + 40) continue;
  const idx = k % 15;
  const near = Math.abs(yy - height * 0.5) < 60;
  ctx.fillStyle = near ? ORANGE : 'rgba(244,244,246,0.30)';
  ctx.fillText(NAMES[idx][0].split(' · ')[0], width - 74, yy);
}
ctx.textAlign = 'left';
ctx.restore();

/* 收尾：一颗白点炸开 + 转场 */
const tail = clamp((T - 16300) / 500, 0, 1);
if (tail > 0) {
  ctx.fillStyle = 'rgba(255,138,61,' + (0.16 * (1 - tail)) + ')';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(255,255,255,' + (tail * tail * 0.9) + ')';
  ctx.fillRect(0, 0, width, height);
}
`;

/* ----------------------------------------------------------- S3 等轴城市 */

/**
 * 等轴 2.5D：13×13 格子上长出一座城。
 *
 * 投影用最朴素的两轴等分：sx = (i - j) * 0.5 * TILE，sy = (i + j) * 0.5 * TILE * 0.5。
 * 绘制顺序按 (i + j) 从后往前，保证前挡后；方块高度由确定性噪声决定，
 * 按「离中心的距离」错峰生长 —— 于是它看起来像从中心扩散建起来的。
 */
export const S3_ISOMETRIC = `${PRELUDE}
const T = time;
const START = 16800;
const GROW = 620;
const N = 13;
const TILE = 132;
const cx = width * 0.5;
const cy = height * 0.46;

ctx.clearRect(0, 0, width, height);
ctx.fillStyle = '#06070b';
ctx.fillRect(0, 0, width, height);

/* 远处的地面辉光，让城市「坐」在光上而不是浮着 */
if (!state.floor) {
  const g = ctx.createRadialGradient(cx, cy + 170, 40, cx, cy + 170, 900);
  g.addColorStop(0, 'rgba(255,138,61,0.16)');
  g.addColorStop(0.45, 'rgba(255,110,40,0.05)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  state.floor = g;
}
ctx.fillStyle = state.floor;
ctx.fillRect(0, 0, width, height);

/* 地平线后面的一道竖向辉光：城市剪影要有背景光才立得住 */
if (!state.horizon) {
  const h = ctx.createLinearGradient(0, cy - 300, 0, cy + 260);
  h.addColorStop(0, 'rgba(255,138,61,0)');
  h.addColorStop(0.62, 'rgba(255,138,61,0.10)');
  h.addColorStop(1, 'rgba(255,138,61,0)');
  state.horizon = h;
}
ctx.fillStyle = state.horizon;
ctx.fillRect(0, cy - 300, width, 560);

/* 镜头：整体缓慢推进 + 末段下压，制造「飞进去」的感觉 */
const push = 1 + 0.12 * easeInOut((T - START) / 7600);
const sink = 40 * easeIn((T - (START + 6800)) / 900);

const project = (i, j, h, zoom) => {
  const sx = cx + (i - j) * 0.5 * TILE * zoom;
  const sy = cy + (i + j) * 0.25 * TILE * zoom - h * zoom + sink;
  return [sx, sy];
};

/* 地砖网格：只画不发光的那层细线，给方块一个参照系 */
ctx.strokeStyle = 'rgba(255,255,255,0.05)';
ctx.lineWidth = 1;
ctx.beginPath();
for (let i = 0; i <= N; i++) {
  const a = project(i, 0, 0, push);
  const b = project(i, N, 0, push);
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  const c = project(0, i, 0, push);
  const d = project(N, i, 0, push);
  ctx.moveTo(c[0], c[1]);
  ctx.lineTo(d[0], d[1]);
}
ctx.stroke();

/* 每个格子的高度：中心高、外圈低，再叠一点噪声 —— 像 CBD */
const heightAt = (i, j) => {
  if (i === 0 || j === 0 || i === N || j === N) return 0;
  const di = (i - N / 2) / (N / 2);
  const dj = (j - N / 2) / (N / 2);
  const r = Math.sqrt(di * di + dj * dj);
  const core = Math.max(0, 1 - r * 0.95);
  const n = rnd(i * 31 + j * 7);
  const spike = n > 0.86 ? 1.9 : 1;
  return (26 + core * 300 * (0.45 + n * 0.9)) * spike;
};

const order = [];
for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) order.push([i, j, i + j]);
order.sort((a, b) => a[2] - b[2]);

for (const [i, j] of order) {
  const di = (i - N / 2) / (N / 2);
  const dj = (j - N / 2) / (N / 2);
  const delay = Math.sqrt(di * di + dj * dj) * 900 + rnd(i * 13 + j * 29) * 220;
  const k = easeOut((T - START - delay) / GROW);
  if (k <= 0) continue;
  const hMax = heightAt(i, j);
  if (hMax <= 0) continue;
  const h = hMax * k;

  const base = project(i - 0.5, j - 0.5, 0, push);
  const top = project(i - 0.5, j - 0.5, h, push);
  const halfW = 0.5 * TILE * push * 0.5;
  const halfH = 0.25 * TILE * push * 0.5;

  /* 三个可见面：顶 / 左 / 右 */
  const topFace = [[top[0], top[1] - halfH], [top[0] + halfW, top[1]], [top[0], top[1] + halfH], [top[0] - halfW, top[1]]];
  const leftFace = [[top[0] - halfW, top[1]], [top[0], top[1] + halfH], [base[0], base[1] + halfH], [base[0] - halfW, base[1]]];
  const rightFace = [[top[0] + halfW, top[1]], [top[0], top[1] + halfH], [base[0], base[1] + halfH], [base[0] + halfW, base[1]]];

  const isHero = hMax > 330;
  const drawPoly = (pts, fill, stroke) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let p = 1; p < pts.length; p++) ctx.lineTo(pts[p][0], pts[p][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.2; ctx.stroke(); }
  };
  /* 落地阴影：没有它，方块像浮在光上 */
  if (h > 40) {
    ctx.fillStyle = 'rgba(0,0,0,0.34)';
    ctx.beginPath();
    ctx.ellipse(base[0], base[1] + halfH * 0.6, halfW * 1.15, halfH * 1.1, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  drawPoly(leftFace, isHero ? '#1c2233' : '#141926', null);
  drawPoly(rightFace, isHero ? '#12161f' : '#0d1119', null);
  drawPoly(topFace, isHero ? '#3a4258' : '#232a3a', null);

  /* 长成的瞬间，棱边亮一下再退回去 */
  const glow = clamp(1 - (T - START - delay - GROW) / 900, 0, 1) * (k > 0.98 ? 1 : 0);
  const edge = isHero
    ? 'rgba(255,138,61,' + (0.55 + glow * 0.45) + ')'
    : 'rgba(255,138,61,' + (0.16 + glow * 0.5) + ')';
  ctx.beginPath();
  ctx.moveTo(topFace[0][0], topFace[0][1]);
  for (let p = 1; p < 4; p++) ctx.lineTo(topFace[p][0], topFace[p][1]);
  ctx.closePath();
  ctx.strokeStyle = edge;
  ctx.lineWidth = isHero ? 1.8 : 1;
  ctx.stroke();

  /* 高楼：窗口灯 + 顶端信标 */
  if (isHero) {
    const cols = 3;
    const rows = Math.max(3, Math.floor(h / 46));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rnd(i * 91 + j * 17 + r * 5 + c * 3) < 0.45) continue;
        const fy = h - r * 46 - 24;
        if (fy < 20) continue;
        const p1 = project(i - 0.5, j - 0.5, fy, push);
        const p2 = project(i - 0.5, j - 0.5, fy - 16, push);
        ctx.fillStyle = 'rgba(255,214,170,' + (0.10 + rnd(r + c + i) * 0.16) + ')';
        ctx.fillRect(p1[0] + (c - 1) * halfW * 0.42 - 6, p2[1] - 2, 10, 3);
      }
    }
    const beacon = 0.4 + 0.6 * Math.abs(Math.sin(T * 0.004 + i));
    ctx.fillStyle = 'rgba(255,138,61,' + beacon + ')';
    ctx.beginPath();
    ctx.arc(top[0], top[1] - 8, 3.4, 0, Math.PI * 2);
    ctx.fill();

    /* 引线标签：只给一部分高楼，密度才不至于变成仪表盘 */
    if (rnd(i * 7 + j * 3) > 0.55) {
      const lx = top[0] + halfW * 1.5;
      const ly = top[1] - 26;
      ctx.strokeStyle = 'rgba(255,138,61,0.42)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(top[0] + 6, top[1] - 10);
      ctx.lineTo(lx, ly);
      ctx.lineTo(lx + 78, ly);
      ctx.stroke();
      ctx.font = '500 13px Consolas, monospace';
      ctx.fillStyle = 'rgba(255,138,61,0.78)';
      ctx.fillText('TWR-' + String(i * 10 + j).padStart(2, '0'), lx + 4, ly - 6);
      ctx.fillStyle = 'rgba(244,244,246,0.32)';
      ctx.fillText(Math.round(hMax) + 'm', lx + 4, ly + 15);
    }
  }
}

/* 末段：镜头边上压一条橙色渐变，转场时不会「啪」地断 */
const outK = clamp((T - (START + 7000)) / 1000, 0, 1);
if (outK > 0) {
  ctx.fillStyle = 'rgba(5,6,10,' + (outK * 0.85) + ')';
  ctx.fillRect(0, 0, width, height);
}
`;

/* --------------------------------------------------------------- S4 HUD */

/**
 * 赛博 HUD：锁定一只目标。
 * 全部是矢量：同心弧 + 刻度 + 角括号 + 数据列 + 雷达扫掠 + 色散重影。
 * 关键在「收拢」的时机——所有元素在 28000 附近同时咬合，那是这一段的节拍点。
 */
export const S4_HUD = `${PRELUDE}
const T = time;
const START = 24800;
const LOCK = 30000;
const cx = width * 0.5;
const cy = height * 0.5;

ctx.clearRect(0, 0, width, height);
ctx.fillStyle = '#04050a';
ctx.fillRect(0, 0, width, height);

/* 背景网格：向上滚动的地平线，暗示「正在接近」 */
ctx.strokeStyle = 'rgba(34,211,238,0.055)';
ctx.lineWidth = 1;
ctx.beginPath();
const off = ((T - START) * 0.05) % 64;
for (let y = -64 + off; y < height; y += 64) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
for (let x = 0; x < width; x += 64) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
ctx.stroke();

const close = easeOut((T - START) / 4200);
const lockK = clamp((T - LOCK) / 260, 0, 1);
const lockPop = 1 + 0.05 * Math.sin(clamp((T - LOCK) / 220, 0, 1) * Math.PI);

/*
 * 目标本体：两个反向自转的线框立方体 + 背后的热斑。
 * 之前这一段只有一个空框在「锁定」空气 —— HUD 的说服力全看你锁住了什么。
 */
if (!state.heat) {
  const hg = ctx.createRadialGradient(cx, cy, 10, cx, cy, 320);
  hg.addColorStop(0, 'rgba(255,138,61,0.30)');
  hg.addColorStop(0.45, 'rgba(255,90,40,0.10)');
  hg.addColorStop(1, 'rgba(255,90,40,0)');
  state.heat = hg;
}
ctx.fillStyle = state.heat;
ctx.fillRect(cx - 340, cy - 340, 680, 680);

const proj3 = (x, y, z) => {
  const f = 960 / (960 + z);
  return [cx + x * f, cy + y * f * 0.98];
};
const wireCube = (size, ax, ay, col, lw) => {
  const ca = Math.cos(ax), sa = Math.sin(ax);
  const cb = Math.cos(ay), sb = Math.sin(ay);
  const src = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  const pts = [];
  for (const v of src) {
    const x = v[0] * size, y = v[1] * size, z = v[2] * size;
    const x1 = x * cb - z * sb;
    const z1 = x * sb + z * cb;
    const y1 = y * ca - z1 * sa;
    const z2 = y * sa + z1 * ca;
    pts.push(proj3(x1, y1, z2));
  }
  const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  ctx.strokeStyle = col;
  ctx.lineWidth = lw;
  ctx.beginPath();
  for (const e of E) {
    ctx.moveTo(pts[e[0]][0], pts[e[0]][1]);
    ctx.lineTo(pts[e[1]][0], pts[e[1]][1]);
  }
  ctx.stroke();
};
wireCube(196 * (0.7 + 0.3 * close), T * 0.00055, T * 0.00082, 'rgba(255,138,61,' + (0.35 + 0.35 * close) + ')', 1.4);
wireCube(112 * (0.7 + 0.3 * close), -T * 0.0011, T * 0.00064, 'rgba(34,211,238,' + (0.28 + 0.3 * close) + ')', 1.1);

/* 一条自上而下扫过目标的光带 */
const scanY = cy - 210 + ((T - START) * 0.16) % 420;
const scanG = ctx.createLinearGradient(0, scanY - 60, 0, scanY + 60);
scanG.addColorStop(0, 'rgba(34,211,238,0)');
scanG.addColorStop(0.5, 'rgba(34,211,238,0.16)');
scanG.addColorStop(1, 'rgba(34,211,238,0)');
ctx.fillStyle = scanG;
ctx.fillRect(cx - 260, scanY - 60, 520, 120);

/* 四条角括号：从画幅外收拢到 210×130 的框 */
const box = 210 * lockPop;
const gx = cx - box;
const gy = cy - box * 0.62;
const gw = box * 2;
const gh = box * 1.24;
const reach = lerp(1.75, 1, close);
const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
ctx.lineWidth = 3;
ctx.strokeStyle = 'rgba(255,138,61,0.95)';
for (const [sx, sy] of corners) {
  const px = cx + (gx + (sx < 0 ? 0 : gw) - cx) * reach;
  const py = cy + (gy + (sy < 0 ? 0 : gh) - cy) * reach;
  const dx = sx * 46;
  const dy = sy * 46;
  ctx.beginPath();
  ctx.moveTo(px + dx, py);
  ctx.lineTo(px, py);
  ctx.lineTo(px, py + dy);
  ctx.stroke();
}

/* 三圈刻度环：不同方向、不同速度 */
const rings = [
  { r: 236, speed: 0.00042, ticks: 60, col: 'rgba(34,211,238,0.55)', len: 9 },
  { r: 268, speed: -0.00027, ticks: 24, col: 'rgba(255,138,61,0.42)', len: 16 },
  { r: 300, speed: 0.00016, ticks: 4, col: 'rgba(244,244,246,0.30)', len: 30 },
];
for (const ring of rings) {
  const r = ring.r * (0.6 + 0.4 * close);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(T * ring.speed);
  for (let i = 0; i < ring.ticks; i++) {
    const a = (i / ring.ticks) * Math.PI * 2;
    const inner = ring.r - ring.len;
    ctx.strokeStyle = i % 5 === 0 ? ring.col : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = i % 5 === 0 ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    ctx.stroke();
  }
  /* 一段高亮弧，像扫描头 */
  ctx.strokeStyle = ring.col;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, T * ring.speed * 3, T * ring.speed * 3 + 0.5);
  ctx.stroke();
  ctx.restore();
}

/* 中心十字 + 锁定点 */
ctx.strokeStyle = 'rgba(244,244,246,0.55)';
ctx.lineWidth = 1.5;
ctx.beginPath();
ctx.moveTo(cx - 26, cy); ctx.lineTo(cx - 10, cy);
ctx.moveTo(cx + 10, cy); ctx.lineTo(cx + 26, cy);
ctx.moveTo(cx, cy - 26); ctx.lineTo(cx, cy - 10);
ctx.moveTo(cx, cy + 10); ctx.lineTo(cx, cy + 26);
ctx.stroke();
ctx.fillStyle = lockK > 0.5 ? ORANGE : 'rgba(244,244,246,0.8)';
ctx.beginPath();
ctx.arc(cx, cy, 4, 0, Math.PI * 2);
ctx.fill();

/* 数据列：左侧一列持续刷新的读数，用确定性伪随机保证每帧一致 */
ctx.font = '500 15px Consolas, monospace';
const rows = 14;
for (let r = 0; r < rows; r++) {
  const seed = Math.floor(T / 90) * 17 + r * 91;
  const v = (rnd(seed) * 999).toFixed(1).padStart(5, '0');
  const label = ['AZ', 'EL', 'RNG', 'VEL', 'IR', 'SIG', 'TRK', 'PWR'][r % 8];
  ctx.fillStyle = r % 4 === 0 ? 'rgba(255,138,61,0.85)' : 'rgba(34,211,238,0.42)';
  ctx.fillText(label + ' ' + v, 96, 236 + r * 26);
  const barW = 40 + rnd(seed + 7) * 110;
  ctx.fillStyle = 'rgba(34,211,238,0.20)';
  ctx.fillRect(300, 226 + r * 26, barW, 6);
}

/* 右侧雷达：扫掠扇形 + 几个固定回波 */
const rx = width - 250;
const ry = 250;
ctx.save();
ctx.beginPath();
ctx.arc(rx, ry, 118, 0, Math.PI * 2);
ctx.strokeStyle = 'rgba(34,211,238,0.28)';
ctx.lineWidth = 1.5;
ctx.stroke();
ctx.beginPath();
ctx.arc(rx, ry, 74, 0, Math.PI * 2);
ctx.strokeStyle = 'rgba(34,211,238,0.14)';
ctx.stroke();
const sweepA = T * 0.0022;
ctx.beginPath();
ctx.moveTo(rx, ry);
ctx.arc(rx, ry, 118, sweepA - 0.55, sweepA);
ctx.closePath();
const sweepGrad = ctx.createRadialGradient(rx, ry, 0, rx, ry, 118);
sweepGrad.addColorStop(0, 'rgba(34,211,238,0.42)');
sweepGrad.addColorStop(1, 'rgba(34,211,238,0)');
ctx.fillStyle = sweepGrad;
ctx.fill();
for (let b = 0; b < 5; b++) {
  const ba = b * 1.7 + 0.4;
  const br = 30 + rnd(b * 13) * 78;
  const bx = rx + Math.cos(ba) * br;
  const by = ry + Math.sin(ba) * br;
  const age = ((sweepA - ba) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  ctx.fillStyle = 'rgba(255,138,61,' + clamp(1 - age / 2.4, 0.12, 0.95) + ')';
  ctx.beginPath();
  ctx.arc(bx, by, 3, 0, Math.PI * 2);
  ctx.fill();
}
ctx.restore();
ctx.font = '500 13px Consolas, monospace';
ctx.fillStyle = 'rgba(34,211,238,0.45)';
ctx.fillText('SCAN 360° · 2.4Hz', rx - 96, ry + 148);

/* 锁定文案：三色重影 + 抖动，只在 LOCK 之后出现 */
if (T > LOCK) {
  const k = easeOut((T - LOCK) / 300);
  const jitter = (1 - k) * 6;
  ctx.font = '900 92px "Arial Black", Impact, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  const label = 'TARGET LOCKED';
  const y = cy + 250;
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#22d3ee';
  ctx.fillText(label, cx - 5 - jitter, y);
  ctx.fillStyle = '#ff2d6f';
  ctx.fillText(label, cx + 5 + jitter, y);
  ctx.globalAlpha = 1;
  ctx.fillStyle = PAPER;
  ctx.fillText(label, cx, y);
  ctx.textAlign = 'left';

  const sub = 'CONFIDENCE 0.98 · 15 STYLES TRACKED';
  ctx.font = MONO;
  ctx.fillStyle = 'rgba(244,244,246,0.45)';
  ctx.textAlign = 'center';
  ctx.fillText(sub, cx, y + 40);
  ctx.textAlign = 'left';
}

/* 扫描线 + 顶部/底部压边，HUD 的味道一半在压边上 */
ctx.fillStyle = 'rgba(0,0,0,0.55)';
ctx.fillRect(0, 0, width, 74);
ctx.fillRect(0, height - 74, width, 74);
ctx.strokeStyle = 'rgba(255,138,61,0.30)';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(0, 74.5); ctx.lineTo(width, 74.5);
ctx.moveTo(0, height - 74.5); ctx.lineTo(width, height - 74.5);
ctx.stroke();
ctx.font = '500 14px Consolas, monospace';
ctx.fillStyle = 'rgba(255,138,61,0.75)';
ctx.fillText('FALCON-9 // OPTICAL TRACK', 40, 46);
ctx.textAlign = 'right';
ctx.fillStyle = 'rgba(244,244,246,0.35)';
ctx.fillText('FRAME ' + String(Math.floor(T / 33.3) % 9999).padStart(4, '0'), width - 40, 46);
ctx.textAlign = 'left';

/* 末段：一刀切黑前的橙色闪 */
const cut = clamp((T - (START + 7800)) / 200, 0, 1);
if (cut > 0) {
  ctx.fillStyle = 'rgba(255,138,61,' + (cut * 0.35) + ')';
  ctx.fillRect(0, 0, width, height);
}
`;

/* ------------------------------------------------------ S5 液态（GLSL） */

/**
 * 顶点只画一个盖住画幅的三角形，`u_time` 是秒。
 * 三次 fbm 做域扭曲（iq 的经典做法）：q 先扭 uv，r 再扭 q，最后取 v —— 层次是这么出来的。
 * 色彩只走四个锚点（墨 / 橙 / 品红 / 青），靠 smoothstep 过渡，避免「彩虹糊成一团」。
 *
 * 这一层是整支片子唯一的逐像素画面，也是唯一的性能瓶颈（见 docs/10-performance.md）。
 * 它的开销只由两个量决定：**像素数 × 每像素算几次噪声**。所以优化也只有两条路 ——
 * 降八度数（12 → 8 次噪声）和降内部分辨率（renderScale 0.5，像素数 ÷4）。
 */
export const S5_LIQUID_GLSL = `
/*
 * 无 sin 的哈希（Dave Hoskins 的 integer-free hash）。
 *
 * 原来这一行是 fract(sin(dot(p, k)) * 43758.5453) 的教科书写法。实测这条改了
 * 并不省时间 —— 软件光栅化里 sin 是多项式展开，和这一版只差几个乘加，
 * 单帧前后都在噪声里。真正省时间的是**少算几次噪声**和**少画几个像素**，
 * 但既然已经换掉了，就留在这里：它不依赖 sin 的实现精度，跨设备更稳。
 */
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

/*
 * 三档八度，不是通用的 fbm(octaves)：GLSL ES 1.0 的循环上界必须是常量，
 * 而这三遍的用途本来就不一样 ——
 *   · q 是最外层的域偏移，只决定「往哪儿扭」，2 octave 足够；
 *   · r 是中层的折叠，3 octave 才够把液体拉出丝；
 *   · v 是眼睛真正看到的那一层，留 4 octave，并且采样频率最高。
 * 少掉的八度会让整幅图「化开」成大块渐变，所以每次减都配着把 warp 幅度调大，
 * 用折叠量换回细节 —— 这一步得看着画面调，不能只看数字。
 *
 * 八度数变了，和值量级也变（2 octave 上限 0.75，不是 0.9375），
 * 所以 fbm2 / fbm3 各乘一个常数把明度均值拉回 0.47 左右，免得整幅暗一档。
 */
float fbm2(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 2; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s * 1.25;
}

float fbm3(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s * 1.07;
}

float fbm4(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float t = u_time;

  vec2 q = vec2(fbm2(uv * 1.55 + vec2(0.0, t * 0.07)), fbm2(uv * 1.55 + vec2(4.3, -t * 0.055)));
  vec2 r = vec2(fbm3(uv * 1.55 + 3.4 * q + vec2(1.7, 9.2) + t * 0.03),
                fbm3(uv * 1.55 + 3.4 * q + vec2(8.3, 2.8) - t * 0.024));
  float v = fbm4(uv * 2.05 + 3.1 * r);

  /*
   * 明度重映射。
   *
   * 这里的两个数字是**量出来的**，不是猜的：把这一层临时换成输出 v 灰度的诊断
   * shader，渲三帧、解码后统计分位数，得到 v 的分布是
   *   p05 0.30 · 中位 0.61 · p95 0.76 · 均值 0.578
   * —— 不是教科书 fbm 的 0.47 ± 0.125。噪声在 [0.28, 0.78] 里挤成一条窄带，
   * 所以「smoothstep(0.22, 0.66)」这类手写阈值必然把它整幅推到高亮档，
   * 画面会发粉（这就是调参时踩过的坑）。
   *
   * 先把 [p05, p95] 铺满 0–1，再用 1.5 次幂把中间调压下去：中位落在 m≈0.47，
   * 只有 p95 那一撮能摸到品红。想改观感就改这两个数，别再动阈值猜。
   */
  float x = clamp((v - 0.28) / 0.50, 0.0, 1.0);
  float m = pow(x, 1.5);
  vec3 col = mix(vec3(0.015, 0.020, 0.030), vec3(0.78, 0.20, 0.05), m);
  col = mix(col, vec3(1.00, 0.50, 0.16), smoothstep(0.58, 0.92, m) * 0.85);
  col = mix(col, vec3(1.00, 0.14, 0.38), smoothstep(0.86, 1.00, m) * 0.75);
  /* 暗部压成深青，做双色调；只在最暗的一档出现，不然整幅发蓝 */
  col = mix(col, vec3(0.04, 0.26, 0.36), smoothstep(0.14, 0.0, m) * 0.60);

  /* 一条随场起伏的高光带，让液体有体积 */
  float band = 1.0 - abs(uv.y * 1.25 + 0.22 + (v - 0.5) * 0.8);
  col += pow(clamp(band, 0.0, 1.0), 7.0) * 0.38;

  /* 暗角 + 颗粒：没有这两样，噪声看着像塑料 */
  col *= 1.0 - 0.75 * smoothstep(0.42, 1.15, length(uv));
  col += (hash(gl_FragCoord.xy + fract(t) * 91.7) - 0.5) * 0.05;

  /* 淡入：上一段是橙闪切过来，这里直接全亮会「跳」一下 */
  col *= smoothstep(32.8, 33.8, t);

  gl_FragColor = vec4(col, 1.0);
}
`;

/** S5 上面压的字：大字标 + 极细的说明，靠遮罩擦入，不做花哨动效 */
export const S5_LIQUID_TYPE = `${PRELUDE}
const T = time;
const START = 32800;
ctx.clearRect(0, 0, width, height);
const k = easeOut((T - START - 900) / 700);
const out = easeIn((T - START - 7200) / 700);

if (k > 0) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 360, width, 360);
  ctx.clip();
  ctx.font = '900 210px "Arial Black", Impact, "Microsoft YaHei", sans-serif';
  ctx.fillStyle = PAPER;
  ctx.globalAlpha = k * (1 - out);
  ctx.fillText('drop.', 150, 512 + (1 - k) * 60);
  ctx.restore();

  ctx.font = MONO;
  ctx.fillStyle = 'rgba(5,6,10,0.72)';
  ctx.globalAlpha = k * (1 - out);
  ctx.fillText('LIQUID / DOMAIN-WARPED FBM · 4 OCTAVES · 1 SHADER PASS', 156, 588);
  ctx.globalAlpha = 1;
}

/* 右下角一行小字，给「这是一支成片」一个注脚 */
ctx.font = '600 20px "Microsoft YaHei", sans-serif';
ctx.fillStyle = 'rgba(244,244,246,0.55)';
ctx.globalAlpha = clamp((T - START - 1600) / 600, 0, 1) * (1 - out);
ctx.textAlign = 'right';
ctx.fillText('万物始于一滴', width - 150, height - 150);
ctx.textAlign = 'left';
ctx.globalAlpha = 1;
`;

/* ------------------------------------------------------------ S6 技术账 */

/**
 * 三段并置：左边是真在滚的代码，右边是三个数字，底部是一条会跟着节拍起伏的波形。
 * 这一段的作用是把「看起来像特效」翻译成「其实就是算出来的」。
 */
export const S6_LEDGER = `${PRELUDE}
const T = time;
const START = 40800;
ctx.clearRect(0, 0, width, height);
ctx.fillStyle = '#06070b';
ctx.fillRect(0, 0, width, height);

/* 左半：代码窗 */
const px = 120;
const py = 190;
const pw = 960;
const ph = 620;
ctx.fillStyle = 'rgba(255,255,255,0.022)';
ctx.fillRect(px, py, pw, ph);
ctx.strokeStyle = 'rgba(255,255,255,0.10)';
ctx.lineWidth = 1;
ctx.strokeRect(px + 0.5, py + 0.5, pw, ph);

/* 标题栏三个点 */
for (let i = 0; i < 3; i++) {
  ctx.fillStyle = i === 0 ? 'rgba(255,138,61,0.85)' : 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.arc(px + 24 + i * 18, py + 24, 5, 0, Math.PI * 2);
  ctx.fill();
}
ctx.font = '500 15px Consolas, monospace';
ctx.fillStyle = 'rgba(255,255,255,0.35)';
ctx.fillText('film.js — 300 frames', px + 84, py + 30);

const LINES = [
  ['const FILM = {', 'kw'],
  ['  fps: 30, frames: 300, length: 10.0,', 'pl'],
  ['  renderAt(t) {                 // 给任意时刻，画出那一帧', 'fn'],
  ['    const f = t * 30 | 0;', 'pl'],
  ['    drawScene(f / 30);', 'fn'],
  ['    return canvas.toBuffer();', 'pl'],
  ['  }', 'kw'],
  ['};', 'kw'],
  ['', 'pl'],
  ['// 声音不走素材，走同一张时间表', 'cm'],
  ['audio.render(cues);   // 103 samples, 45 cues', 'fn'],
  ['// 无头 Chrome 逐帧截图 → ffmpeg 合轨', 'cm'],
  ['exec("ffmpeg -framerate 30 -i %04d.png …");', 'pl'],
  ['', 'pl'],
  ['// 一条命令总线的另一半：改一层 = 改一次数据', 'cm'],
  ['bus.dispatch("layer.update", { id, opacity });', 'fn'],
  ['bus.dispatch("audio.set",   { id, volume });', 'fn'],
  ['', 'pl'],
  ['// 没有素材，所以没有「素材丢了」', 'cm'],
  ['assets: [], fonts: [], duration: 64000,', 'pl'],
  ['', 'pl'],
  ['// 4 条铺底 / 1 条节拍 / 1 条切点提示', 'cm'],
  ['tone: { preset: "pad", root: 110, bpm: 120 }', 'pl'],
  ['', 'pl'],
];
const COLORS = { kw: 'rgba(255,138,61,0.95)', fn: 'rgba(34,211,238,0.92)', pl: 'rgba(244,244,246,0.62)', cm: 'rgba(244,244,246,0.26)' };
const lineH = 40;
const total = LINES.length * lineH;
const scroll = ((T - START) * 0.055) % total;
ctx.save();
ctx.beginPath();
ctx.rect(px, py + 52, pw, ph - 52);
ctx.clip();
/* 画两遍：第二遍接在下面，滚动接缝就落在裁剪区外面，看不出来 */
for (let pass = 0; pass < 2; pass++) {
  for (let i = 0; i < LINES.length; i++) {
    const y = py + 108 + i * lineH - scroll + pass * total;
    if (y < py + 44 || y > py + ph + 8) continue;
    const line = LINES[i];
    ctx.font = '500 17px Consolas, monospace';
    ctx.fillStyle = COLORS[line[1]] || COLORS.pl;
    /* 视差：越靠边越淡，像真的在滚 */
    const fade = clamp((y - py - 44) / 110, 0, 1) * clamp((py + ph - y) / 110, 0, 1);
    ctx.globalAlpha = 0.18 + fade * 0.82;
    ctx.fillText(line[0], px + 26, y);
  }
}
ctx.globalAlpha = 1;
ctx.restore();

/* 右上：三个数字，每 1.1 秒换一个，最后一个留在画上 */
const stats = [
  ['15', 'STYLES', '每一种都有自己的 renderAt'],
  ['10s', 'EACH FILM', '正好 300 帧，不多不少'],
  ['×2', 'REVIEW ROUNDS', '另一个 AI 按 rubric 打分'],
];
const idx = Math.min(stats.length - 1, Math.floor((T - START - 400) / 1100));
if (idx >= 0) {
  const local = (T - START - 400) - idx * 1100;
  const kIn = easeOut(local / 260);
  const st = stats[idx];
  const sx = 1180;
  ctx.font = '900 150px "Arial Black", Impact, sans-serif';
  ctx.fillStyle = ORANGE;
  ctx.globalAlpha = kIn;
  ctx.fillText(st[0], sx, 330 + (1 - kIn) * 30);
  ctx.font = MONO;
  ctx.fillStyle = 'rgba(244,244,246,0.55)';
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '4px';
  ctx.fillText(st[1], sx + 4, 372 + (1 - kIn) * 30);
  if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
  ctx.font = '600 20px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = 'rgba(244,244,246,0.38)';
  ctx.fillText(st[2], sx + 4, 410 + (1 - kIn) * 30);
  ctx.globalAlpha = 1;
}

/* 底部波形：同一组正弦叠出来的「声音」，跟着节拍呼吸 */
const wy = 900;
ctx.strokeStyle = 'rgba(244,244,246,0.10)';
ctx.lineWidth = 1;
ctx.beginPath();
ctx.moveTo(120, wy);
ctx.lineTo(width - 120, wy);
ctx.stroke();
const bars = 96;
const bw = (width - 240) / bars;
for (let i = 0; i < bars; i++) {
  const phase = i * 0.34 + T * 0.006;
  const env = Math.exp(-Math.pow((i / bars - 0.5) * 2.4, 2));
  const amp = (Math.sin(phase) * 0.5 + Math.sin(phase * 2.7 + 1.2) * 0.3 + Math.sin(phase * 5.1) * 0.2);
  const h = Math.abs(amp) * env * 78 + 2;
  const x = 120 + i * bw;
  ctx.fillStyle = i % 9 === 0 ? 'rgba(255,138,61,0.9)' : 'rgba(255,138,61,0.34)';
  ctx.fillRect(x, wy - h, bw * 0.55, h * 2);
}
ctx.font = MONO;
ctx.fillStyle = 'rgba(255,138,61,0.55)';
ctx.fillText('audio.py → 48kHz / 16bit / synthesized', 120, wy + 46);

/* 转场：整块向右擦走 */
const wipe = easeIn((T - (START + 7500)) / 600);
if (wipe > 0) {
  ctx.fillStyle = '#06070b';
  ctx.fillRect(0, 0, width * wipe, height);
}
`;

/* ------------------------------------------------------------ S7 风格墙 */

/**
 * 五条竖带，每条一个纹理家族（等轴线 / 网点 / 渐变球 / 像素块 / 字块），
 * 速度各不相同 —— 横向视差就出来了。末段整体加速并压暗，把观众推向落版。
 */
export const S7_WALL = `${PRELUDE}
const T = time;
const START = 48800;
ctx.clearRect(0, 0, width, height);
ctx.fillStyle = '#05060a';
ctx.fillRect(0, 0, width, height);

const cols = 5;
const colW = width / cols;
const boost = 1 + 3.2 * easeIn((T - START - 6200) / 1200);

for (let c = 0; c < cols; c++) {
  const x0 = c * colW;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, 0, colW, height);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,' + (0.012 + c * 0.004) + ')';
  ctx.fillRect(x0, 0, colW, height);

  const speed = (0.05 + c * 0.028) * boost;
  const shift = (T - START) * speed;
  const cell = 168;

  for (let r = -1; r < 9; r++) {
    const y = r * cell - (shift % cell) + (c % 2 === 1 ? cell * 0.5 : 0);
    if (y > height + cell || y < -cell * 2) continue;
    const cx = x0 + colW * 0.5;
    const kind = c;
    /* 每个格子一个稳定种子 —— 之前用固定种子，整列花纹一模一样，看着像 bug */
    const cellSeed = Math.floor((y + shift) / cell) * 17 + kind * 131;

    if (kind === 0) {
      /* 等轴：菱形网格 */
      ctx.strokeStyle = 'rgba(255,138,61,0.34)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 3; k++) {
        const s = 26 + k * 22;
        ctx.beginPath();
        ctx.moveTo(cx, y - s * 0.5);
        ctx.lineTo(cx + s, y);
        ctx.lineTo(cx, y + s * 0.5);
        ctx.lineTo(cx - s, y);
        ctx.closePath();
        ctx.stroke();
      }
    } else if (kind === 1) {
      /* 网点：半径随行数变化 */
      const n = 5;
      for (let gy = 0; gy < n; gy++) {
        for (let gx = 0; gx < n; gx++) {
          const rr = 1.6 + 2.4 * Math.abs(Math.sin((gy + gx) * 0.7 + shift * 0.01));
          ctx.fillStyle = 'rgba(244,244,246,0.30)';
          ctx.beginPath();
          ctx.arc(cx + (gx - 2) * 24, y + (gy - 2) * 24, rr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (kind === 2) {
      /* 渐变球：弥散玻璃那种柔光 */
      const g = ctx.createRadialGradient(cx - 12, y - 12, 4, cx, y, 62);
      g.addColorStop(0, 'rgba(255,180,120,0.55)');
      g.addColorStop(0.5, 'rgba(255,45,111,0.28)');
      g.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, y, 62, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === 3) {
      /* 像素块：每个格子一套随机图案 */
      const px = 10;
      for (let gy = 0; gy < 6; gy++) {
        for (let gx = 0; gx < 6; gx++) {
          if (rnd(cellSeed + gx * 31 + gy * 17) < 0.42) continue;
          ctx.fillStyle = rnd(cellSeed + gx + gy * 7) > 0.5 ? 'rgba(34,211,238,0.62)' : 'rgba(255,138,61,0.62)';
          ctx.fillRect(cx - 3 * px + gx * px, y - 3 * px + gy * px, px - 2, px - 2);
        }
      }
    } else {
      /* 字块：竖排的风格名碎片 */
      const words = ['CEL', 'ISO', 'HUD', 'PIXEL', 'DROP', 'AURORA', 'NOGGIN'];
      ctx.font = '900 54px "Arial Black", Impact, sans-serif';
      ctx.fillStyle = 'rgba(244,244,246,0.22)';
      ctx.textAlign = 'center';
      ctx.fillText(words[Math.floor(rnd(cellSeed) * words.length)], cx, y + 18);
      ctx.textAlign = 'left';
    }
  }
  ctx.restore();

  /* 列间分隔线 */
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fillRect(x0, 0, 1, height);
}

/* 巨字下面压一条横向暗带：不然字和花纹互相咬，两边都读不清 */
if (!state.scrim) {
  const scrim = ctx.createLinearGradient(0, height * 0.5 - 200, 0, height * 0.5 + 200);
  scrim.addColorStop(0, 'rgba(5,6,10,0)');
  scrim.addColorStop(0.32, 'rgba(5,6,10,0.76)');
  scrim.addColorStop(0.68, 'rgba(5,6,10,0.76)');
  scrim.addColorStop(1, 'rgba(5,6,10,0)');
  state.scrim = scrim;
}
ctx.fillStyle = state.scrim;
ctx.fillRect(0, height * 0.5 - 200, width, 400);

/* 压在大墙上的字：从 0.6 倍推到 1 倍，末段再放大 1.25 倍「穿过镜头」 */
const zk = easeOut((T - START - 600) / 1400);
const exitZoom = 1 + 0.28 * easeIn((T - START - 6400) / 1000);
const scale = lerp(0.62, 1, zk) * exitZoom;
ctx.save();
ctx.translate(width * 0.5, height * 0.5);
ctx.scale(scale, scale);
ctx.textAlign = 'center';
ctx.font = '900 190px "Arial Black", Impact, sans-serif';
ctx.fillStyle = 'rgba(5,6,10,0.55)';
ctx.fillText('15 STYLES', 0, 18);
ctx.fillStyle = PAPER;
ctx.fillText('15 STYLES', 0, 0);
ctx.font = '600 26px "Microsoft YaHei", sans-serif';
ctx.fillStyle = 'rgba(255,138,61,0.9)';
if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '10px';
ctx.fillText('一 套 数 据 · 全 部 可 改', 0, 62);
if (ctx.letterSpacing !== undefined) ctx.letterSpacing = '0px';
ctx.textAlign = 'left';
ctx.restore();

const outK = clamp((T - (START + 7600)) / 400, 0, 1);
if (outK > 0) {
  ctx.fillStyle = 'rgba(5,6,10,' + outK + ')';
  ctx.fillRect(0, 0, width, height);
}
`;

/* --------------------------------------------------------------- S8 落版 */

export const S8_END = `${PRELUDE}
const T = time;
const START = 56800;
ctx.clearRect(0, 0, width, height);
ctx.fillStyle = '#05060a';
ctx.fillRect(0, 0, width, height);

const k = easeOut((T - START) / 900);

/* 标志：两个同心方框，从中心拉开 + 一笔画完的竖线 */
const cx = width * 0.5;
const cy = height * 0.42;
ctx.save();
ctx.translate(cx, cy);
ctx.rotate(-Math.PI / 4 * (1 - k));
const s1 = lerp(20, 78, k);
ctx.strokeStyle = 'rgba(255,138,61,0.95)';
ctx.lineWidth = 4;
ctx.strokeRect(-s1, -s1, s1 * 2, s1 * 2);
const s2 = lerp(10, 46, k);
ctx.strokeStyle = 'rgba(244,244,246,0.55)';
ctx.lineWidth = 2;
ctx.strokeRect(-s2, -s2, s2 * 2, s2 * 2);
ctx.fillStyle = ORANGE;
ctx.fillRect(-3, -s1, 6, s1 * 2 * clamp((T - START - 500) / 500, 0, 1));
ctx.restore();

/* 主标题：逐字上浮 */
const title = '15 STYLES';
ctx.font = '900 104px "Arial Black", Impact, sans-serif';
ctx.textAlign = 'center';
let tx = cx - ctx.measureText(title).width / 2;
for (let i = 0; i < title.length; i++) {
  const ch = title[i];
  const ck = easeOut((T - START - 700 - i * 45) / 420);
  if (ck > 0) {
    ctx.globalAlpha = ck;
    ctx.fillStyle = ch === '1' || ch === '5' ? ORANGE : PAPER;
    ctx.fillText(ch, tx + ctx.measureText(ch).width / 2, 640 + (1 - ck) * 26);
    ctx.globalAlpha = 1;
  }
  tx += ctx.measureText(ch).width;
}
ctx.textAlign = 'left';

const sub = '画面、动画、配乐、音效 —— 全部由代码生成';
ctx.font = '600 24px "Microsoft YaHei", sans-serif';
ctx.fillStyle = 'rgba(244,244,246,0.45)';
ctx.textAlign = 'center';
ctx.globalAlpha = clamp((T - START - 1400) / 500, 0, 1);
ctx.fillText(sub, cx, 700);
ctx.globalAlpha = 1;

/* 主标：这支片子是谁做的；副标：素材参考了哪个项目 —— 两行都要，别让人误解成别人的官片 */
ctx.font = '700 30px "Microsoft YaHei", sans-serif';
ctx.fillStyle = 'rgba(255,138,61,0.92)';
ctx.globalAlpha = clamp((T - START - 1700) / 500, 0, 1);
ctx.fillText('KINELAYER · 引擎极限样片', cx, 758);
ctx.globalAlpha = 1;

const url = 'github.com/Vincentwei1021/mg-styles-15';
ctx.font = '500 24px Consolas, monospace';
const uw = ctx.measureText(url).width;
const uk = clamp((T - START - 2100) / 600, 0, 1);
if (uk > 0) {
  ctx.fillStyle = 'rgba(244,244,246,' + (0.34 * uk) + ')';
  ctx.fillText('风格参考 ' + url, cx, 800);
  ctx.fillStyle = 'rgba(255,138,61,0.28)';
  ctx.fillRect(cx - 84, 812, (uw + 84) * uk, 1);
}

/* 底部点阵：15×3 个点，逐行亮起后一起呼吸 */
const dots = 15;
const dotGap = 18;
const totalW = (dots - 1) * dotGap;
for (let row = 0; row < 3; row++) {
  for (let i = 0; i < dots; i++) {
    const dk = clamp((T - START - 2400 - (row * dots + i) * 26) / 260, 0, 1);
    if (dk <= 0) continue;
    const breathe = 0.55 + 0.45 * Math.sin(T * 0.003 + i * 0.3 + row);
    ctx.fillStyle = 'rgba(255,138,61,' + (0.22 * dk * breathe) + ')';
    ctx.beginPath();
    ctx.arc(cx - totalW / 2 + i * dotGap, 890 + row * 18, 2.6 * dk, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* 退场：整幅淡出到黑 */
const fade = clamp((T - (START + 6800)) / 700, 0, 1);
if (fade > 0) {
  ctx.fillStyle = 'rgba(5,6,10,' + fade + ')';
  ctx.fillRect(0, 0, width, height);
}
`;
