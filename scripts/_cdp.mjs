/**
 * e2e 公共壳：启一个 headless Edge，连上 CDP，给点好用的动词。
 *
 * 之前的 v2-check / rename-check / multi-project-check 各自抄了一份 ~70 行的连接代码，
 * 再加脚本就该抽出来了 —— 新脚本一律从这里 import。
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const require = createRequire(new URL('../agent-bridge/package.json', import.meta.url));
const WebSocket = require('ws');

export const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openWs(url) {
  const ws = new WebSocket(url, { maxPayload: 128 * 1024 * 1024 });
  const waiting = new Map();
  const listeners = new Map();
  let seq = 0;
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
      return;
    }
    if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params);
    }
  });
  await new Promise((r, j) => {
    ws.on('open', r);
    ws.on('error', j);
  });
  /* 连接断了：把所有还在等回复的调用一次性 reject，别让它们悬着 */
  const failAll = (why) => {
    for (const [id, settle] of waiting) {
      waiting.delete(id);
      settle(null, new Error(why));
    }
  };
  ws.on('close', () => failAll('CDP 连接已断开（页面或浏览器退出）'));
  ws.on('error', (err) => failAll(`CDP 连接出错：${err?.message ?? err}`));
  const call = (method, params = {}, timeoutMs = 120_000) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      /*
       * 超时与断连都必须 reject。
       *
       * 之前的写法是 `new Promise((resolve) => ...)`：既不超时也不听 close，
       * 于是渲染器在跑到第 1350 帧时页面崩了，整个进程就**永久挂起** ——
       * 没有报错、没有退出码，看起来像「很慢」，实际是死等一个永远不会来的回复。
       * 一个静默挂住的渲染器比一个报错的渲染器坏得多：后者你知道要重跑。
       */
      const timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`CDP ${method} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      waiting.set(id, (msg, err) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(msg);
      });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        waiting.delete(id);
        reject(err);
      }
    });
  const on = (event, fn) => {
    const list = listeners.get(event) ?? [];
    list.push(fn);
    listeners.set(event, list);
    return () => {
      const next = (listeners.get(event) ?? []).filter((f) => f !== fn);
      listeners.set(event, next);
    };
  };
  const once = (event) =>
    new Promise((resolve) => {
      const off = on(event, (params) => {
        off();
        resolve(params);
      });
    });
  return { ws, call, on, once };
}

/**
 * 起浏览器并连上第一个匹配的页面。
 * matchUrl 是「认哪个标签」的片段，本地默认 5273；跑线上冒烟时传 'github.io'。
 */
export async function launch({
  url,
  port = 9300 + Math.floor(Math.random() * 90),
  profile,
  width = 1600,
  height = 1000,
  matchUrl = '5273',
}) {
  const userDataDir = profile ?? `C:/Users/KngLokiko/AppData/Local/Temp/kly-e2e-${Date.now()}-${port}`;
  const edge = spawn(
    EDGE,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      `--window-size=${width},${height}`,
      url,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let page = null;
  for (let i = 0; i < 120; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === 'page' && t.url.includes(matchUrl));
      if (page?.webSocketDebuggerUrl) break;
    } catch {
      /* 还没起 */
    }
    await sleep(300);
  }
  if (!page) {
    edge.kill();
    throw new Error('浏览器没起来（CDP 连不上）');
  }

  const conn = await openWs(page.webSocketDebuggerUrl);
  await conn.call('Runtime.enable');
  await conn.call('Page.enable');
  await conn.call('DOM.enable');

  if (width !== 1600 || height !== 1000) {
    await conn.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }

  const ev = async (expression, timeoutMs) => {
    const res = await conn.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 600));
    return res.result?.result?.value;
  };

  const waitFor = async (expression, timeoutMs = 12000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await ev(expression)) return true;
      await sleep(200);
    }
    return false;
  };

  const shot = async (file) => {
    const res = await conn.call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
  };

  const setViewport = (w, h) =>
    conn.call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });

  const reload = async () => {
    await conn.call('Page.reload');
    await sleep(1200);
    return waitFor('typeof window.__kly !== "undefined"', 20000);
  };

  /** 在同一个浏览器里开新标签（图层窗口要用它，BroadcastChannel 才能跨窗口） */
  const openTab = async (targetUrl) => {
    await conn.call('Target.createTarget', { url: targetUrl });
    for (let i = 0; i < 60; i += 1) {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const found = list.find((t) => t.type === 'page' && t.url.includes(targetUrl.split('?')[0]) && t.url.includes('layer='));
      if (found?.webSocketDebuggerUrl) {
        const tab = await openWs(found.webSocketDebuggerUrl);
        await tab.call('Runtime.enable');
        await tab.call('Page.enable');
        return tab;
      }
      await sleep(250);
    }
    throw new Error(`新标签没打开：${targetUrl}`);
  };

  return { edge, conn, ev, waitFor, shot, setViewport, reload, openTab, port };
}

/**
 * 进编辑器，并且**等「要的那份工程」真的进了 store**，再返回。
 *
 * `?projectId=` 是深链，但 boot 里的 `project.open` 是异步的：刚上车那一两帧渲染的是
 * 内存里的示例工程。只等 `[data-testid="layer-row"]` 会在**占位工程**上就「就绪」——
 * 这时候发命令，改动全落在占位工程上；等 `project.open` 落地，整份状态被替换掉。
 * 症状极难认：前几条断言都过了，后面突然「命令返回失败 / 层不见了」，而且每次挂的不是同一条。
 *
 * 判据只有一条：`state().project.id` 等于请求的 id。
 * 导航瞬间 `Runtime.evaluate` 可能撞上「上下文已销毁」，所以这里自己重试，不把异常抛给调用方。
 */
export async function enterEditor(cdp, projectId, { base = 'http://localhost:5273/', timeoutMs = 25000 } = {}) {
  await cdp.conn.call('Page.navigate', { url: `${base}?view=editor&projectId=${encodeURIComponent(projectId)}` });
  const want = JSON.stringify(projectId);
  const onProject = `(() => {
    const s = window.__kly && window.__kly.state && window.__kly.state();
    return !!s && !!s.project && s.project.id === ${want};
  })()`;
  const mounted = `document.querySelectorAll('[data-testid="layer-row"]').length > 0`;
  const poll = async (expr, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      try {
        if (await cdp.ev(expr)) return true;
      } catch {
        /* 导航中上下文还没建好，下一次再看 */
      }
      await sleep(200);
    }
    return false;
  };
  if (!(await poll(onProject, timeoutMs))) return { ok: false, reason: '工程没换成请求的那份（boot 的 project.open 没落地）' };
  if (!(await poll(mounted, 8000))) return { ok: false, reason: '工程进来了但图层树没挂上' };
  return { ok: true, reason: '' };
}

/** 结果收集：每行一个 OK/FAIL，最后汇总退出码 */
export function reporter() {
  const results = [];
  return {
    check(name, ok, extra = '') {
      results.push({ name, ok: !!ok });
      console.log(`${ok ? '  OK  ' : '  FAIL'} ${name}${extra ? `   ${extra}` : ''}`);
    },
    finish() {
      const pass = results.filter((r) => r.ok).length;
      console.log('\n结果：');
      console.log(`  ${pass}/${results.length} 通过`);
      return pass === results.length ? 0 : 1;
    },
  };
}

/** 让页面里的 window.confirm 直接点头（headless 下原生弹窗会挂住） */
export const AUTO_CONFIRM = `(() => { window.confirm = () => true; return true; })()`;
