/**
 * 线上冒烟：对 GitHub Pages 上的真实部署做端到端确认。
 *
 * 为什么要单独一个脚本：本地那几个自检跑的是 dev server，手里有 window.__kly 这个调试口，
 * 可以直接 dispatch 命令、造 File、读 store；线上是生产 bundle —— 调试口**故意不存在**、
 * chunk 全走 CDN、IndexedDB 是空的。所以这里只能用「用户真正能点到的东西」做断言，
 * 顺便盯一遍 console 与网络。
 *
 * 覆盖范围（v2.5b）：
 *   - 启动页能起来、新建入口齐全
 *   - 建项目 → 进编辑器 → 图层树/画布/时间轴都在
 *   - 刷新后能回到同一个项目（lastProjectId）
 *   - 全程无 console error / 无未捕获异常 / 无资源加载失败
 *   - 生产包没有把 __kly 调试口泄漏出去
 *   - 懒加载分包真的能取到（主 chunk / EditorApp / 启动时不下载 babel）
 *
 * 不做的事：不在线上跑「导入 Remotion 工程」（要造几 MB 的 zip，且会在用户的
 * 真实 IndexedDB 里留垃圾）。那条链路由 scripts/remotion-check.mjs 在本地覆盖。
 */
import fs from 'node:fs';
import { launch, reporter, sleep } from './_cdp.mjs';

const BASE = 'https://knglokiko.github.io/Kinelayer/';
const SHOT = 'docs/v25-online.png';

const r = reporter();
const b = await launch({ url: BASE, matchUrl: 'github.io', width: 1600, height: 1000 });

/** 页面导航期间 Runtime.evaluate 会抛「navigated or closed」，等下一轮即可 */
const safeWait = async (expr, timeoutMs = 30000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if (await b.ev(expr)) return true;
    } catch {
      /* 导航中 */
    }
    await sleep(250);
  }
  return false;
};

// ── 装监听，再导航一次，拿到「从零加载」的干净记录 ────────────────
const consoleErrors = [];
const pageErrors = [];
const netFails = [];
const badResponses = [];

await b.conn.call('Network.enable');
await b.conn.call('Log.enable');

b.conn.on('Runtime.consoleAPICalled', (p) => {
  if (p.type !== 'error') return;
  const line = p.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
  consoleErrors.push(line.slice(0, 300));
});
b.conn.on('Runtime.exceptionThrown', (p) => {
  const d = p.exceptionDetails;
  pageErrors.push(String(d?.exception?.description ?? d?.text ?? 'unknown').slice(0, 300));
});
b.conn.on('Network.loadingFailed', (p) => {
  // blockedReason：浏览器自身拦掉的（CSP / COEP），不归部署管
  if (p.blockedReason) return;
  // Document + ERR_ABORTED：脚本自己 Page.reload 打断上一次加载，是测量噪声
  if (p.type === 'Document' && p.errorText === 'net::ERR_ABORTED') return;
  netFails.push(`${p.type} ${p.errorText}`);
});
b.conn.on('Network.responseReceived', (p) => {
  const { status, url } = p.response;
  // favicon 单独一条断言管，不当成部署事故
  if (status >= 400 && !/favicon\.ico$/.test(url)) badResponses.push(`${status} ${url}`);
});

const t0 = Date.now();
await b.conn.call('Page.navigate', { url: BASE });
await sleep(600);

// ── 1. 首屏 ──────────────────────────────────────────────────
const booted = await safeWait(`document.querySelector('[data-testid="launcher"]') !== null`, 45000);
r.check('线上首屏启动（launcher 渲染出来）', booted, `${Date.now() - t0}ms`);
if (!booted) {
  await b.shot(SHOT);
  b.edge.kill();
  process.exit(r.finish() || 1);
}

const shell = await b.ev(`(() => {
  const q = (s) => document.querySelector(s);
  const root = q('[data-testid="launcher"]');
  const text = (root?.textContent ?? '').replace(/\\s+/g, ' ').trim();
  return {
    lang: document.documentElement.lang,
    theme: document.documentElement.className,
    title: document.title,
    mode: root?.getAttribute('data-mode') ?? '',
    hasNewBlank: !!q('[data-testid="new-blank"]'),
    hasNewCustom: !!q('[data-testid="new-custom"]'),
    hasOpenLocal: !!q('[data-testid="open-local"]'),
    presets: document.querySelectorAll('[data-testid^="preset-"]').length,
    hasLocaleToggle: [...document.querySelectorAll('button')].some((el) => /切换语言/.test(el.getAttribute('title') ?? '')),
    text,
  };
})()`);

r.check('启动页标题正确', shell.title.includes('Kinelayer'), shell.title);
r.check('dark 主题生效', /dark/.test(shell.theme), shell.theme);
r.check('语言为 zh-CN', shell.lang === 'zh-CN', shell.lang);
r.check('是独立启动页（不是 overlay）', shell.mode === 'page', `mode=${shell.mode}`);
r.check('「空白项目」入口在', shell.hasNewBlank);
r.check('「自定义尺寸」入口在', shell.hasNewCustom);
r.check('「打开本地文件」入口在', shell.hasOpenLocal);
r.check('尺寸预设齐全（≥4）', shell.presets >= 4, `${shell.presets} 个`);
r.check('语言切换按钮在', shell.hasLocaleToggle);
r.check(
  '中文词条完整（无漏翻成 key 的裸中文）',
  /工程库 · 最近打开的工程都在这里/.test(shell.text) && /还没有项目/.test(shell.text),
  shell.text.slice(0, 50),
);

// ── 2. 生产包没有泄漏调试口 ───────────────────────────────────
const leaked = await b.ev(`typeof window.__kly !== 'undefined'`);
r.check('生产包未暴露 __kly 调试口', leaked === false);

// ── 3. 新建项目 → 进编辑器 ───────────────────────────────────
await b.ev(`(document.querySelector('[data-testid="new-blank"]')?.click(), true)`);
const inEditor = await safeWait(`document.querySelectorAll('[data-testid="layer-row"]').length > 0`, 40000);
r.check('点「空白项目」进入编辑器（图层树有行）', inEditor, `${Date.now() - t0}ms`);

if (!inEditor) {
  await b.shot(SHOT);
  console.log('\nconsole error:', consoleErrors.slice(0, 5));
  console.log('page error:', pageErrors.slice(0, 5));
  console.log('net fail:', netFails.slice(0, 5));
  b.edge.kill();
  process.exit(r.finish() || 1);
}

const editor = await b.ev(`(() => {
  const text = (document.body.textContent ?? '').replace(/\\s+/g, ' ');
  const cvs = [...document.querySelectorAll('canvas')];
  // 舞台 canvas 的 backing store 是「视口尺寸 × DPR」，不是设计稿分辨率 ——
  // 画面是按逻辑坐标 ctx.scale 上去的，所以这里只验「有一块够大的画布 + 面板读数对」。
  const stage = cvs
    .map((c) => ({ w: c.width, h: c.height }))
    .filter((x) => x.w > 400 && x.h > 300)
    .sort((a, c) => c.w * c.h - a.w * a.h)[0] ?? null;
  return {
    url: location.href,
    layers: document.querySelectorAll('[data-testid="layer-row"]').length,
    canvases: cvs.length,
    stage,
    hasTracks: /TRACKS/.test(text),
    hasPlayhead: /00:00:0|00:05/.test(text),
    showsDesignSize: /1080\\s*×\\s*1440/.test(text),
    bodyLen: text.length,
  };
})()`);

r.check('URL 带上 projectId', /projectId=[\w-]{6,}/.test(editor.url), editor.url.replace(/^https:\/\/[^/]+\/Kinelayer\//, '…/'));
r.check('图层树渲染出图层', editor.layers >= 1, `${editor.layers} 行`);
r.check('舞台画布已挂载', !!editor.stage, JSON.stringify(editor.stage));
r.check('顶栏/属性面板读出 1080 × 1440', editor.showsDesignSize);
r.check('时间轴面板存在（TRACKS）', editor.hasTracks);
r.check('时间轴有时码刻度', editor.hasPlayhead);
r.check('界面文字有内容（没白屏）', editor.bodyLen > 200, `${editor.bodyLen} 字符`);

await b.shot(SHOT);

// ── 4. 采一次资源清单（reload 会清空 performance 记录，必须先采）──
const assets = await b.ev(`(() => performance.getEntriesByType('resource')
  .filter((e) => /\\.js(\\?|$)/.test(e.name))
  .map((e) => ({ name: e.name.split('/').pop(), size: e.decodedBodySize })))()`);
const names = [...new Set(assets.map((a) => a.name))];

// ── 5. 刷新后回到同一个项目 ─────────────────────────────────
const before = editor.url.match(/projectId=([\w-]+)/)?.[1] ?? '';
await b.conn.call('Page.reload');
await sleep(900);
const restored = await safeWait(`document.querySelectorAll('[data-testid="layer-row"]').length > 0`, 35000);
const after = await b.ev(`(location.href.match(/projectId=([\\w-]+)/) ?? [])[1] ?? ''`);
r.check('刷新后自动回到上次的工程', restored && after === before, `${before.slice(0, 8)}…`);

// ── 6. 网络与控制台 ─────────────────────────────────────────
r.check('无 4xx / 5xx 响应（favicon 除外）', badResponses.length === 0, badResponses.slice(0, 3).join(' | '));
r.check('无资源加载失败', netFails.length === 0, netFails.slice(0, 3).join(' | '));
r.check('无未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | '));
r.check('无 console error', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | '));

// ── 7. 分包加载是否真的生效 ─────────────────────────────────
r.check('主 chunk 已加载', names.some((n) => /^index-[A-Za-z0-9_-]+\.js$/.test(n)));
r.check('编辑器 chunk 按需加载', names.some((n) => n.startsWith('EditorApp-')), names.find((n) => n.startsWith('EditorApp-')) ?? 'miss');
r.check('分包数量合理（3–8）', names.length >= 3 && names.length <= 8, `${names.length} 个`);
r.check('进编辑器时未下载 babel 分包（懒加载生效）', !names.some((n) => n === 'index-aMwKDVmZ.js'));

// ── 8. favicon ─────────────────────────────────────────────
const iconExists = await b.ev(`(async () => {
  const link = document.querySelector('link[rel="icon"]');
  if (!link) return { ok: false, reason: 'no link[rel=icon]' };
  const res = await fetch(link.href, { method: 'GET' });
  return { ok: res.ok, status: res.status, href: link.href };
})()`);
r.check('favicon 可访问', iconExists?.ok === true, `${iconExists?.status ?? ''} ${iconExists?.href ?? iconExists?.reason ?? ''}`);

// ── 9. 产物落地 ─────────────────────────────────────────────
r.check('截图已写入', fs.existsSync(SHOT), SHOT);

console.log('\n加载过的 script：');
for (const n of names) console.log(`  · ${n}  ${assets.filter((a) => a.name === n)[0]?.size ?? '?'} B`);

b.edge.kill();
process.exit(r.finish());
