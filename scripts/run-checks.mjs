#!/usr/bin/env node
/**
 * 检查脚本统一入口：`npm test` 一次跑完 scripts/ 下所有 `*-check.mjs`。
 *
 * 之前每次回归要人工逐个开终端、还得先手动起 dev server —— 20 个脚本、350+ 断言，
 * 漏跑一个跟没跑差不多。这里只做三件事：管住 dev server、按序跑、出汇总。
 *
 * 用法：
 *   npm test                  跑全部
 *   npm test -- loop          只跑匹配「loop」的（子串、不区分大小写）
 *   npm test -- loop export   跑多个（每个参数各自展开，取并集）
 *   npm test -- --list        列出可用的短名，不执行
 *   npm test -- --verbose     把每个脚本的完整输出也打出来（默认只打失败行）
 *   npm test -- --timeout 600 单个脚本超时（秒，默认 300）
 *
 * 匹配规则：参数按「短名子串」匹配，短名 = 文件名去掉 `-check.mjs`。
 *   例：loop → loop-check；media → media-check；v2 → v2-check。
 *   一个参数可能命中多个（如 `a` 会中 agent-panel / ai / audio），命中几个就跑几个并列出来。
 *
 * 退出码：全部通过 0，有任一失败（含超时、断言计数不足）1，参数写错 2。
 *
 * 判定不只看退出码：media-check.mjs 收尾是 `process.exit(0)`，断言挂了退出码也是 0，
 * 所以计数（`N/M 通过`）不满同样算失败。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep as cdpSleep } from './_cdp.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SCRIPT_DIR = path.join(ROOT, 'scripts');
const LOG_DIR = path.join(ROOT, '.workbuddy', 'tmp', 'npm-test');

/* 全仓真实端口：vite.config.ts 里写死 strictPort，不另起一个端口 */
const PORT = 5273;
const ORIGIN = `http://127.0.0.1:${PORT}`;

/**
 * 不在名单里的脚本，以及为什么。名单本身靠 `-check.mjs` 后缀筛，
 * 这张表只用来在输出里把「排除了什么、为什么」讲明白 —— 否则下次会有人以为漏跑了。
 */
const EXCLUDED = [
  ['online-smoke.mjs', '需要外网（打线上 Pages）'],
  ['push-via-api.mjs', '推送工具，不是检查'],
  ['render.mjs', '渲染器本体，由 render-check.mjs 覆盖'],
  ['shots.mjs', '产物生成（截图），不是检查'],
  ['_cdp.mjs', '公共库，被检查脚本 import'],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 参数 ─────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const opts = { list: false, verbose: false, timeoutMs: 300_000, filters: [] };

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '--list') opts.list = true;
  else if (a === '--verbose' || a === '-v') opts.verbose = true;
  else if (a === '--help' || a === '-h') opts.list = true;
  else if (a === '--timeout') {
    const sec = Number(argv[i + 1]);
    if (!Number.isFinite(sec) || sec <= 0) die(`--timeout 后面要跟秒数，收到 ${argv[i + 1] ?? '（空）'}`);
    opts.timeoutMs = sec * 1000;
    i += 1;
  } else if (a.startsWith('-')) die(`不认识的参数：${a}（用 --list 看可用短名）`);
  else opts.filters.push(a);
}

function die(msg) {
  console.error(`\n  ${msg}\n`);
  process.exit(2);
}

/* ── 发现脚本 ─────────────────────────────────────────── */

const all = fs
  .readdirSync(SCRIPT_DIR)
  .filter((n) => n.endsWith('-check.mjs'))
  .sort();
const shortOf = (file) => file.replace(/-check\.mjs$/, '');

if (opts.list) {
  console.log(`\n可用的短名（npm test -- <名字>）：\n`);
  for (const f of all) console.log(`  ${shortOf(f)}`.padEnd(22) + f);
  console.log(`\n排除：`);
  for (const [f, why] of EXCLUDED) console.log(`  ${f}`.padEnd(22) + why);
  console.log('');
  process.exit(0);
}

/** 过滤：短名子串匹配，参数之间取并集；拼错的参数直接报错，别静默跑 0 个 */
function pick(filters) {
  if (!filters.length) return all;
  const picked = [];
  const unknown = [];
  for (const raw of filters) {
    const q = raw.toLowerCase().replace(/\.mjs$/, '').replace(/-check$/, '');
    const hit = all.filter((n) => shortOf(n).toLowerCase().includes(q));
    if (!hit.length) unknown.push(raw);
    for (const n of hit) if (!picked.includes(n)) picked.push(n);
  }
  if (unknown.length) {
    /* 只挑最像的那几个提示，不用把 20 个名字全倒出来 */
    const hint = unknown.map((u) => {
      const near = all.filter((n) => shortOf(n).toLowerCase().slice(0, 2) === u.toLowerCase().slice(0, 2));
      return `  ${u}${near.length ? ` → 你是不是想跑：${near.map(shortOf).join(' / ')}` : ''}`;
    });
    die(`没匹配到任何脚本：\n${hint.join('\n')}\n  用 --list 看全部短名`);
  }
  return picked;
}

const targets = pick(opts.filters);

/* ── dev server 生命周期 ──────────────────────────────── */

async function probe() {
  try {
    const res = await fetch(`${ORIGIN}/`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 起一个 vite dev。
 * 直接跑 vite 的入口而不是 `npm run dev`：不经 shell，pid 就是进程本身，
 * 收尾时 taskkill /T 才能把整棵树收干净（只杀父进程会留下占着 5273 的孤儿）。
 */
function startDev() {
  const bin = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(bin)) die('node_modules/vite 不在，先 npm install');
  const child = spawn(process.execPath, [bin, '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => {
    log += d.toString();
  });
  child.stderr.on('data', (d) => {
    log += d.toString();
  });
  return { child, tail: () => log };
}

function stopDev(dev) {
  if (!dev) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(dev.child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    dev.child.kill('SIGTERM');
  }
}

async function waitReady(upToMs = 45_000) {
  const until = Date.now() + upToMs;
  while (Date.now() < until) {
    if (await probe()) return true;
    await sleep(300);
  }
  return false;
}

/**
 * 预热：vite 的**第一次**页面加载要把整条模块图临时转译一遍，而这台机器上这一步
 * 要十几秒，检查脚本内部的等待普遍只有 6–12 秒 —— 于是「名单里排第一个的」总是
 * 撞在冷启动上（agent-panel 的 6 条断言会全挂，同一台 server 再跑一次就 16/16）。
 * 先空跑一次启动页 → 进编辑器，把转译缓存捂热，后面才是脚本自己的问题。
 *
 * 失败不拦：真起不来时让检查脚本自己报错，比这里瞎猜一句「浏览器没起来」有用。
 */
function warmup() {
  return new Promise((resolve) => {
    let cdp;
    launch({ url: `${ORIGIN}/`, matchUrl: String(PORT) })
      .then(async (c) => {
        cdp = c;
        await c.waitFor('typeof window.__kly !== "undefined"', 30_000);
        /* 点进编辑器：把编辑器那条 chunk 也走一遍 */
        await c.ev(`(() => { const b = document.querySelector('[data-testid="new-blank"]'); if (b) b.click(); return !!b; })()`);
        await c.waitFor('!!document.querySelector("[data-tier]")', 20_000);
        await cdpSleep(1000);
        resolve(true);
      })
      .catch(() => resolve(false))
      .finally(() => {
        const pid = cdp?.edge?.pid;
        if (pid) {
          if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
          else cdp.edge.kill('SIGTERM');
        }
      });
  });
}

/* ── 跑一个 ───────────────────────────────────────────── */

/**
 * 从输出里读断言计数。
 * 三种既有格式：reporter 的 `N/M 通过`、agent-panel 的 `结果：N/M 通过`、
 * render-check 的 `✓ / ✗` 逐行。都读不到就返回 null（交给退出码判定，并在表里标 `?`）。
 */
function parseCounts(out) {
  const m = out.match(/(\d+)\s*\/\s*(\d+)\s*通过/);
  if (m) return { pass: Number(m[1]), total: Number(m[2]) };
  const okLines = out.match(/^[ \t]*(?:OK|✓)[ \t]+\S/gm) ?? [];
  const badLines = out.match(/^[ \t]*(?:FAIL|✗)[ \t]+\S/gm) ?? [];
  if (okLines.length || badLines.length) return { pass: okLines.length, total: okLines.length + badLines.length };
  if (/全部通过/.test(out)) return { pass: 1, total: 1 };
  return null;
}

function runOne(file) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(SCRIPT_DIR, file)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: opts.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    env: process.env,
  });
  const ms = Date.now() - started;
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const timedOut = r.error?.code === 'ETIMEDOUT' || r.signal === 'SIGTERM';
  const code = r.status ?? -1;
  const counts = parseCounts(out);
  /* 退出码 0 不等于通过：media-check 收尾是 process.exit(0)，断言挂了也 0 */
  const countOk = counts ? counts.pass === counts.total && counts.total > 0 : true;
  return { file, name: shortOf(file), code, ms, out, timedOut, counts, ok: !timedOut && code === 0 && countOk };
}

/** 失败时把「哪几条挂了」摘出来 —— 全量输出太长，人不看 */
function failLines(out) {
  return out
    .split('\n')
    .filter((l) => /^[ \t]*(?:FAIL|✗)/.test(l))
    .map((l) => l.trim());
}

/* ── 主流程 ───────────────────────────────────────────── */

const startedAt = Date.now();
fs.rmSync(LOG_DIR, { recursive: true, force: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

console.log(`\n检查脚本 · ${targets.length} 个${targets.length === all.length ? '' : `（从 ${all.length} 个里筛出）`}`);
console.log(`   ${targets.map(shortOf).join(' ')}`);
console.log(`   排除：${EXCLUDED.map(([f]) => f).join(' ')}（都不是检查脚本，见 --list）\n`);

/* 已经有 dev server 就复用，且跑完不关 —— 那是人开着的，不是我们起的 */
let dev = null;
if (await probe()) {
  console.log(`dev server：复用 ${ORIGIN} 上已有实例（跑完不关）`);
} else {
  console.log(`dev server：${ORIGIN} 没人监听，自己起一个（跑完会关掉）`);
  dev = startDev();
  if (!await waitReady()) {
    console.log('\n  dev server 没起来，中止。vite 输出：\n');
    console.log((dev.tail().trim() || '（无输出）').split('\n').slice(-15).map((l) => `    ${l}`).join('\n'));
    stopDev(dev);
    process.exit(1);
  }
  console.log(`dev server：已就绪\n`);
}

const warmed = await warmup();
console.log(`预热：${warmed ? '已加载过一次编辑页（避免第一个脚本吃冷启动）' : '没成功，第一个脚本可能因冷启动变慢而失败'}\n`);

const results = [];
try {
  for (const [i, file] of targets.entries()) {
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${targets.length}] ${shortOf(file).padEnd(20)} `);
    const r = runOne(file);
    results.push(r);
    fs.writeFileSync(path.join(LOG_DIR, `${r.name}.log`), `# ${r.file}  退出码 ${r.code}  ${r.ms}ms\n\n${r.out}`);
    const counts = r.counts ? `${r.counts.pass}/${r.counts.total}` : '?';
    console.log(`${r.timedOut ? 'TIMEOUT' : r.ok ? 'PASS   ' : 'FAIL   '} ${counts.padEnd(9)} ${(r.ms / 1000).toFixed(1)}s`);
    if (opts.verbose) console.log(r.out.trimEnd().split('\n').map((l) => `        ${l}`).join('\n'));
  }
} finally {
  stopDev(dev);
}

/* ── 汇总表 ───────────────────────────────────────────── */

const totalMs = Date.now() - startedAt;
const failed = results.filter((r) => !r.ok);
const sumPass = results.reduce((a, r) => a + (r.counts?.pass ?? 0), 0);
const sumTotal = results.reduce((a, r) => a + (r.counts?.total ?? 0), 0);
const mmss = `${Math.floor(totalMs / 60_000)}m${String(Math.round((totalMs % 60_000) / 1000)).padStart(2, '0')}s`;

console.log(`\n${'='.repeat(68)}`);
console.log(`汇总 · ${results.length} 个脚本 · 总耗时 ${mmss}`);
console.log('-'.repeat(68));
console.log(`  #   脚本                  结果      断言       耗时`);
for (const [i, r] of results.entries()) {
  const counts = r.counts ? `${r.counts.pass}/${r.counts.total}` : '?';
  const verdict = r.timedOut ? 'TIMEOUT' : r.ok ? 'PASS' : 'FAIL';
  console.log(`  ${String(i + 1).padStart(2)}  ${r.name.padEnd(20)}  ${verdict.padEnd(8)}  ${counts.padEnd(9)}  ${(r.ms / 1000).toFixed(1)}s`);
}
console.log('-'.repeat(68));
console.log(`  断言 ${sumPass}/${sumTotal} · 失败 ${failed.length}/${results.length} 个脚本 · ${mmss}`);

if (failed.length) {
  console.log('\n失败明细：');
  for (const r of failed) {
    const why = r.timedOut ? `超时（>${opts.timeoutMs / 1000}s）` : r.code !== 0 ? `退出码 ${r.code}` : `断言 ${r.counts?.pass}/${r.counts?.total}`;
    console.log(`  ${r.name}  ·  ${why}`);
    for (const line of failLines(r.out).slice(0, 8)) console.log(`      ${line}`);
  }
  console.log(`\n完整输出：${path.relative(ROOT, LOG_DIR)}/<短名>.log`);
  console.log(`\n结果：失败\n`);
  process.exit(1);
}

console.log(`\n完整输出：${path.relative(ROOT, LOG_DIR)}/<短名>.log`);
console.log(`\n结果：全部通过\n`);
