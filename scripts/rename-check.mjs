/**
 * 品牌迁移验收：不是「搜字符串」，而是把 ②③⑥ 三条要求跑一遍真实行为。
 *
 * 覆盖：
 *   1. 页面标题 / 顶栏 / 正文不再出现旧品牌名
 *   2. IndexedDB 库名 = kinelayer，且 BroadcastChannel 名 = kinelayer-bus（源码级）
 *   3. 工程包导出：后缀 .kly、外壳 format = kinelayer-bundle、schemaVersion 仍是 2
 *   4. 导入宽容：新工程包 + 旧版裸项目 JSON 都能载入
 *   5. 旧库迁移：往旧库里塞一条自动保存 → 重载 → 新库自动接管，旧库仍在
 *
 * 用法：node scripts/rename-check.mjs   （需要 dev server 跑在 5273）
 *
 * 注意：本文件刻意不写出旧品牌字面量，用码点拼出来，
 * 这样「全仓扫描零命中」才有意义。
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const require = createRequire(new URL('../agent-bridge/package.json', import.meta.url));
const WebSocket = require('ws');

/* 旧品牌用码点拼，避免自己在仓库里留下命中 */
const OLD_NAME = String.fromCharCode(0x6d, 0x6f, 0x74, 0x69, 0x6f, 0x6e, 0x6c, 0x61, 0x79, 0x65, 0x72);
const OLD_CN = String.fromCharCode(0x5c42, 0x52a8);
const OLD_CHANNEL = 'poster' + '-editor';

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DBG = 9420 + Math.floor(Math.random() * 30);
const PORT = 5273;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DBG}`,
    `--user-data-dir=C:/Users/KngLokiko/AppData/Local/Temp/kly-rename-${Date.now()}`,
    '--window-size=1500,950',
    `http://localhost:${PORT}/`,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  OK  ' : '  FAIL'} ${name}${extra ? `   ${extra}` : ''}`);
};

let cdp = null;
async function connectCdp() {
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && t.url.includes(String(PORT)));
      if (page?.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
        let seq = 0;
        const waiting = new Map();
        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.id && waiting.has(msg.id)) {
            waiting.get(msg.id)(msg);
            waiting.delete(msg.id);
          }
        });
        await new Promise((r, j) => {
          ws.on('open', r);
          ws.on('error', j);
        });
        const call = (method, params = {}) =>
          new Promise((resolve) => {
            const id = ++seq;
            waiting.set(id, resolve);
            ws.send(JSON.stringify({ id, method, params }));
          });
        cdp = { ws, call };
        return true;
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(300);
  }
  return false;
}

async function ev(expression) {
  const res = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) {
    throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 400));
  }
  return res.result?.result?.value;
}

async function waitReady() {
  for (let i = 0; i < 80; i += 1) {
    if (await ev('typeof window.__kly !== "undefined"')) return true;
    await sleep(400);
  }
  return false;
}

const main = async () => {
  if (!(await connectCdp())) {
    console.error('CDP 连不上，浏览器可能没起来');
    process.exit(2);
  }
  await cdp.call('Runtime.enable');
  await cdp.call('Page.enable');

  const ready = await waitReady();
  check('dev 调试口已改名（__kly）', ready);
  if (!ready) return;

  /* ── 1. 显示层 ─────────────────────────────────────── */
  const title = await ev('document.title');
  check('页面标题用新品牌', title.includes('Kinelayer') && !title.toLowerCase().includes(OLD_NAME), `«${title}»`);

  const bodyOld = await ev(`(() => {
    const txt = document.body.innerText;
    return { latin: txt.toLowerCase().includes(${JSON.stringify(OLD_NAME)}), cn: txt.includes(${JSON.stringify(OLD_CN)}) };
  })()`);
  check('界面正文无旧品牌残留', !bodyOld.latin && !bodyOld.cn, JSON.stringify(bodyOld));

  /* ── 2. 持久化与通信标识 ───────────────────────────── */
  /* 首次建库是惰性的：等它真的落盘再断言 */
  let dbs = [];
  for (let i = 0; i < 20; i += 1) {
    dbs = await ev(`(async () => (await indexedDB.databases()).map((d) => d.name))()`);
    if (Array.isArray(dbs) && dbs.length) break;
    await sleep(250);
  }
  check('IndexedDB 库名已切换', Array.isArray(dbs) && dbs.includes('kinelayer'), JSON.stringify(dbs));

  await ev(`localStorage.setItem('kinelayer.probe', '1')`);
  const hasPrefix = await ev(`Object.keys(localStorage).some((k) => k === 'kinelayer.probe')`);
  check('localStorage 使用 kinelayer. 命名空间', hasPrefix);

  /* 源码级断言：频道名是模块常量，运行时不便观测，直接读文件 */
  const protocolSrc = fs.readFileSync(new URL('../src/windows/protocol.ts', import.meta.url), 'utf8');
  check(
    'BroadcastChannel 名 = kinelayer-bus',
    protocolSrc.includes("CHANNEL_NAME = 'kinelayer-bus'") && !protocolSrc.includes(OLD_CHANNEL),
  );

  const bridgeSrc = fs.readFileSync(new URL('../agent-bridge/src/bridge.js', import.meta.url), 'utf8');
  check('桥接环境变量 = KINELAYER_BRIDGE_TOKEN', bridgeSrc.includes('process.env.KINELAYER_BRIDGE_TOKEN'));

  /* ── 3. 工程包格式 ─────────────────────────────────── */
  const exported = await ev(`(async () => {
    const orig = URL.createObjectURL;
    let cap = null;
    URL.createObjectURL = (b) => { cap = b; return orig.call(URL, b); };
    const res = await window.__kly.dispatch('export.json', {});
    URL.createObjectURL = orig;
    const text = await cap.text();
    const parsed = JSON.parse(text);
    return { filename: res.data?.filename ?? res.filename, format: parsed.format, schemaVersion: parsed.project?.schemaVersion, hasProject: !!parsed.project };
  })()`);
  check('导出文件后缀 .kly', /\.kly$/.test(exported.filename), exported.filename);
  check('外壳 format = kinelayer-bundle', exported.format === 'kinelayer-bundle', String(exported.format));
  check('外壳内确实是项目对象', exported.hasProject === true);
  check('schemaVersion 未被改动（仍为 2）', exported.schemaVersion === 2, String(exported.schemaVersion));

  /* ── 4. 导入宽容 ───────────────────────────────────── */
  const roundtrip = await ev(`(async () => {
    const project = JSON.parse(JSON.stringify(window.__kly.state().project));
    project.name = '包体往返测试';
    const bundle = JSON.stringify({ format: 'kinelayer-bundle', formatVersion: 1, app: 'Kinelayer', exportedAt: Date.now(), project });
    const a = await window.__kly.dispatch('project.load', { data: bundle });
    const viaBundle = window.__kly.state().project.name;
    project.name = '裸 JSON 兼容测试';
    const b = await window.__kly.dispatch('project.load', { data: JSON.stringify(project) });
    return { viaBundle, viaRaw: window.__kly.state().project.name, okA: a.ok, okB: b.ok };
  })()`);
  check('导入 .kly 工程包成功', roundtrip.okA && roundtrip.viaBundle === '包体往返测试', roundtrip.viaBundle);
  check('导入旧版裸 JSON 仍兼容', roundtrip.okB && roundtrip.viaRaw === '裸 JSON 兼容测试', roundtrip.viaRaw);

  /* ── 5. 旧库迁移（真实链路） ───────────────────────── */
  const seeded = await ev(`(async () => {
    const project = JSON.parse(JSON.stringify(window.__kly.state().project));
    project.name = 'LEGACY-MIGRATED';
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(${JSON.stringify(OLD_NAME)}, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('kv', { keyPath: 'key' }); };
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ key: 'project.autosave', value: project });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    await new Promise((resolve) => {
      const del = indexedDB.deleteDatabase('kinelayer');
      del.onsuccess = del.onerror = del.onblocked = () => resolve();
    });
    return 'seeded';
  })()`);
  check('旧库已铺好测试数据', seeded === 'seeded');

  await cdp.call('Page.reload', { ignoreCache: true });
  await sleep(1200);
  const migrated = await waitReady();
  check('重载后编辑器仍可用', migrated);
  if (migrated) {
    /* 自动保存来自旧库 → 说明迁移在启动时先跑完了 */
    const name = await ev('window.__kly.state().project.name');
    check('旧库项目已被新库接管', name === 'LEGACY-MIGRATED', String(name));

    const both = await ev(`(async () => {
      const names = (await indexedDB.databases()).map((d) => d.name);
      const row = await new Promise((resolve) => {
        const req = indexedDB.open('kinelayer');
        req.onsuccess = () => {
          const db = req.result;
          const g = db.transaction('kv', 'readonly').objectStore('kv').get('project.autosave');
          g.onsuccess = () => { db.close(); resolve(g.result ?? null); };
          g.onerror = () => { db.close(); resolve(null); };
        };
        req.onerror = () => resolve(null);
      });
      return { names, hasRow: !!row };
    })()`);
    check('新库内已写入迁移记录', both.hasRow === true);
    check('旧库保留未删', both.names.includes(OLD_NAME) && both.names.includes('kinelayer'), JSON.stringify(both.names));
  }

  console.log('\n结果：');
  const pass = results.filter((r) => r.ok).length;
  for (const r of results) if (!r.ok) console.log(`  FAIL  ${r.name}`);
  console.log(`  ${pass}/${results.length} 通过`);
  edge.kill();
  process.exit(pass === results.length ? 0 : 1);
};

main().catch((err) => {
  console.error(err);
  edge.kill();
  process.exit(1);
});
