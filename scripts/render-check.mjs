#!/usr/bin/env node
/**
 * 渲染器自检：把 render.mjs 的每个模式都跑一遍，断言的是**形状**不是像素。
 *
 * 为什么不断言像素：那件事由「同一毫秒必同帧」这条不变量保证，已经在 e2e 里验过
 * （预览、导出、图层窗口三条路走的是同一个渲染函数）。这里要防的是另一类故障 ——
 * 模式参数解析错了、输出目录写错了、帧数算错了、WAV 头拼错了。
 * 这类错不会让画面变丑，只会让成片少几帧或者没有声音，肉眼看不出来。
 *
 * 断言清单：
 *   stills   —— 出图数量对、每张不是空白（体积下限）、不同时刻不是同一张图
 *   sheet    —— 格数等于 --at 给的时刻数
 *   sequence —— 帧数等于 (to-from)/1000*fps，且 audio.wav 是合法 RIFF
 *   perf     —— 采样点数对、p50/p95/max 都是数
 *
 * 前置：`npm run dev` 起着。跑一次约 20 秒。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WORK = path.join(ROOT, '.workbuddy', 'tmp', 'render-check', `${Date.now()}-${process.pid}`);
const PROJECT = process.env.KLY_PROJECT ?? 'prj_sample_revision';

let failed = 0;
const ok = (name, extra = '') => console.log(`  ✓ ${name}${extra ? `  ${extra}` : ''}`);
const bad = (name, why) => {
  failed += 1;
  console.log(`  ✗ ${name}  ${why}`);
};

function run(args, { quiet = true } = {}) {
  const tail = quiet ? ['--quiet'] : [];
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'render.mjs'), ...args, '--project', PROJECT, ...tail], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180_000,
  });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** 4 字节签名 */
function head(file, n = 4) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(n);
  fs.readSync(fd, buf, 0, n, 0);
  fs.closeSync(fd);
  return buf.toString('latin1');
}

/* 1080p 一帧纯色 PNG 压完只有几 KB；真实画面平均 600KB 上下。
   取 20KB 当下限：宽松到不会误报，又足以拦住「画布没画上东西」。 */
const MIN_PNG = 20 * 1024;

console.log(`\n渲染器自检 · ${PROJECT}\n`);
fs.mkdirSync(WORK, { recursive: true });
console.log(`  产物目录：${WORK}`);

/* ── 1 · stills ─────────────────────────────────────── */
{
  const dir = path.join(WORK, 'stills');
  const r = run(['stills', '--at', '0,3750,22500', '--out', dir]);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')) : [];
  if (r.code !== 0) bad('stills 退出码', String(r.code));
  else if (files.length !== 3) bad('stills 出图数量', `期望 3，得到 ${files.length}`);
  else {
    const sizes = files.map((f) => fs.statSync(path.join(dir, f)).size);
    const tiny = files.find((_, i) => sizes[i] < MIN_PNG);
    if (tiny) bad('stills 空白帧', `${tiny} 只有 ${(Math.min(...sizes) / 1024).toFixed(0)}KB`);
    else {
      /* 三个时刻的画面必须不一样：一样就说明时刻没生效，全渲的同一帧 */
      const bufs = files.map((f) => fs.readFileSync(path.join(dir, f)));
      const same = bufs.every((b) => b.equals(bufs[0]));
      if (same) bad('stills 三个时刻', '三张图逐字节相同 —— 时刻参数没生效');
      else ok('stills', `3 张 · 平均 ${(sizes.reduce((a, b) => a + b, 0) / 3 / 1024).toFixed(0)}KB`);
    }
  }
}

/* ── 2 · sheet ──────────────────────────────────────── */
{
  const file = path.join(WORK, 'sheet.png');
  /* 这一项不打 --quiet：格数是从日志里读的，静默了就没得读 */
  const r = run(['sheet', '--at', '0,2000,8000', '--cols', '3', '--out', file], { quiet: false });
  if (r.code !== 0) bad('sheet 退出码', String(r.code));
  else if (!fs.existsSync(file)) bad('sheet 出图', '文件不存在');
  else if (fs.statSync(file).size < MIN_PNG) bad('sheet 出图', `只有 ${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
  else if (!/[3] 格/.test(r.out)) bad('sheet 格数', `日志里没有「3 格」：${r.out.trim().slice(0, 120)}`);
  else ok('sheet', `3 格 · ${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
}

/* ── 3 · sequence（含 WAV）──────────────────────────── */
{
  const dir = path.join(WORK, 'seq');
  /* 41000→41300 @30fps = 9 帧。挑引爆段：最贵的路径也要过一次 */
  const r = run(['sequence', '--from', '41000', '--to', '41300', '--out', dir]);
  const frames = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^frame_\d+\.png$/.test(f)) : [];
  if (r.code !== 0) bad('sequence 退出码', String(r.code));
  else if (frames.length !== 9) bad('sequence 帧数', `期望 9，得到 ${frames.length}`);
  else ok('sequence', `${frames.length} 帧`);

  const wav = path.join(dir, 'audio.wav');
  if (!fs.existsSync(wav)) bad('audio.wav', '没写出来（这个工程有音轨，应该有）');
  else if (head(wav, 4) !== 'RIFF' || head(wav, 12).slice(8) !== 'WAVE') bad('audio.wav 头', `得到 ${head(wav, 4)}/${head(wav, 12).slice(8)}`);
  else {
    /* 编码脚本也要在：没 ffmpeg 的机器上它是唯一出路 */
    const hasScript = fs.existsSync(path.join(dir, 'encode.cmd')) || fs.existsSync(path.join(dir, 'encode.sh'));
    if (!hasScript) bad('encode 脚本', '两个都没写');
    else ok('audio.wav', `${(fs.statSync(wav).size / 1024 / 1024).toFixed(1)}MB · RIFF/WAVE · 编码脚本就位`);
  }
}

/* ── 4 · perf ───────────────────────────────────────── */
{
  const json = path.join(WORK, 'perf.json');
  const r = run(['perf', '--from', '41000', '--to', '41300', '--step', '100', '--json', json]);
  if (r.code !== 0) bad('perf 退出码', String(r.code));
  else if (!fs.existsSync(json)) bad('perf --json', '文件不存在');
  else {
    const d = JSON.parse(fs.readFileSync(json, 'utf8'));
    if (!Array.isArray(d.samples) || d.samples.length !== 3) bad('perf 采样数', `期望 3，得到 ${d.samples?.length}`);
    else if (![d.p50, d.p95, d.max].every((v) => typeof v === 'number' && v > 0)) bad('perf 统计量', JSON.stringify({ p50: d.p50, p95: d.p95, max: d.max }));
    else if (d.from !== 41000 || d.to !== 41300) bad('perf 范围', `回显 ${d.from}–${d.to}ms`);
    else ok('perf', `3 点 · p50 ${d.p50.toFixed(1)}ms · max ${d.max.toFixed(1)}ms`);
  }
}

console.log('');
if (failed) {
  console.log(`${failed} 项失败\n`);
  process.exit(1);
}
console.log(`全部通过\n`);
