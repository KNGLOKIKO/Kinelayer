/**
 * 设置页「桌面 Agent」提示词面板 · 端到端验证
 * 用法：node scripts/agent-panel-check.mjs   （需要 dev server 跑在 5273）
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

/* 依赖从 agent-bridge 的 node_modules 解析；用 URL 相对定位，换目录/改品牌都不用改脚本 */
const require = createRequire(new URL('../agent-bridge/package.json', import.meta.url));
const WebSocket = require('ws');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DBG = 9380 + Math.floor(Math.random() * 30);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DBG}`,
    `--user-data-dir=C:/Users/KngLokiko/AppData/Local/Temp/ml-agent-${Date.now()}`,
    '--window-size=1600,1000',
    'http://localhost:5273/',
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
      const page = list.find((t) => t.type === 'page' && t.url.includes('5273'));
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
      /* 还没起 */
    }
    await sleep(300);
  }
  return false;
}

async function ev(expression) {
  const res = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 300));
  return res.result?.result?.value;
}

async function shot(file) {
  const res = await cdp.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
}

const main = async () => {
  if (!(await connectCdp())) {
    console.error('CDP 连不上');
    process.exit(2);
  }
  await cdp.call('Runtime.enable');

  for (let i = 0; i < 60; i += 1) {
    if (await ev('typeof window.__kly !== "undefined"')) break;
    await sleep(500);
  }

  // 剪贴板打桩：headless 里直接读系统剪贴板不可靠，改成记录写入内容
  await ev(`(() => {
    window.__copied = null;
    const stub = { writeText: (v) => { window.__copied = v; return Promise.resolve(); } };
    try { Object.defineProperty(navigator, 'clipboard', { value: stub, configurable: true }); }
    catch { navigator.clipboard = stub; }
    return true;
  })()`);

  // 打开设置（顶栏齿轮）
  const opened = await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('title') || '') === '设置');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(600);
  check('能打开设置对话框', opened && (await ev('!!document.querySelector("pre") || document.body.innerText.includes("AI 通道")')));

  // 切到「桌面 Agent」标签
  const switched = await ev(`(() => {
    const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '桌面 Agent');
    if (!tab) return false;
    tab.click();
    return true;
  })()`);
  await sleep(800);
  check('存在「桌面 Agent」标签并可切换', switched);

  // 面板结构
  const panel = await ev(`(() => {
    const text = document.body.innerText;
    return {
      hasTitle: text.includes('桌面 Agent 接入提示词'),
      hasHow: text.includes('怎么接进来'),
      hasCan: text.includes('能操作什么'),
      hasCannot: text.includes('不能做什么'),
      hasFlow: text.includes('推荐调用顺序'),
      hasWarn: text.includes('危险操作必须由你确认'),
      pre: document.querySelector('pre')?.textContent?.length ?? 0,
      copyBtn: [...document.querySelectorAll('button')].some((b) => /复制全部|已复制/.test(b.textContent)),
    };
  })()`);
  check('四块说明区域齐全', panel.hasTitle && panel.hasHow && panel.hasCan && panel.hasCannot && panel.hasFlow, JSON.stringify({ t: panel.hasTitle, h: panel.hasHow, c: panel.hasCan, n: panel.hasCannot, f: panel.hasFlow }));
  check('安全提醒存在', panel.hasWarn);
  check('提示词正文有实质长度（>3000 字符）', panel.pre > 3000, `pre=${panel.pre}`);
  check('复制按钮存在', panel.copyBtn);

  // 正文内容要点
  const body = await ev(`document.querySelector('pre').textContent`);
  const must = [
    ['权限边界章节', '## 4. 权限边界'],
    ['调用契约章节', '## 3. 调用契约'],
    ['危险命令章节', '## 5. 危险命令'],
    ['错误码章节', '## 6. 错误码'],
    ['MCP 工具命名', 'layer__create'],
    ['HTTP 命令端点', 'POST /command'],
    ['令牌头', 'x-kinelayer-token'],
    ['乐观锁字段', 'expectedVersion'],
    ['冲突错误码', 'CONFLICT'],
    ['试算字段', 'dryRun'],
    ['监听地址约束', '127.0.0.1'],
    ['密钥边界', 'API Key'],
    ['文件系统边界', '文件系统'],
    ['dev 口声明', 'window.__kly'],
  ];
  const missing = must.filter(([, s]) => !body.includes(s)).map(([n]) => n);
  check(`正文含全部 ${must.length} 个要点`, missing.length === 0, missing.join(', '));

  // 命令清单来自注册表：抽两条本次新增的命令
  const hasAnim = body.includes('animation.setKeyframe') && body.includes('animation.applyPreset');
  check('命令清单含 v2 动画命令（证明来自注册表）', hasAnim);

  // 统计与真实注册表一致
  const counts = await ev(`(() => {
    const total = window.__kly.commands().length;
    const text = document.body.innerText;
    return { total, shown: text.includes(total + ' 条命令') || text.includes(total + ' commands') };
  })()`);
  check('面板显示的命令数与注册表一致', counts.shown, JSON.stringify(counts));

  // 复制
  const copied = await ev(`(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => /复制全部/.test(b.textContent));
    if (!btn) return { ok: false };
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    return { ok: true, len: (window.__copied || '').length };
  })()`);
  check('复制按钮写入完整文本', copied.ok && copied.len > 3000 && Math.abs(copied.len - panel.pre) <= 2, JSON.stringify(copied));

  // 英文切换后不应残留中文（排除命令清单里的中文摘要——英文版已不带摘要）
  await ev(`localStorage.setItem('kinelayer.locale','en-US')`);
  await cdp.call('Page.reload');
  await sleep(3500);
  for (let i = 0; i < 40; i += 1) {
    if (await ev('typeof window.__kly !== "undefined"')) break;
    await sleep(400);
  }
  await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => ['设置', 'Settings'].includes(b.getAttribute('title') || ''));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  await sleep(500);
  const enOk = await ev(`(() => {
    const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Desktop agent');
    if (!tab) return { tab: false };
    tab.click();
    return { tab: true };
  })()`);
  await sleep(700);
  const enBody = await ev(`(() => {
    const pre = document.querySelector('pre');
    if (!pre) return null;
    const txt = pre.textContent;
    return {
      len: txt.length,
      head: txt.slice(0, 40),
      hasZh: /[\\u4e00-\\u9fa5]/.test(txt),
      hasSection: txt.includes('## 4. Permission boundaries'),
    };
  })()`);
  check('英文界面下有对应英文版提示词', enBody?.hasSection === true, JSON.stringify({ head: enBody?.head, len: enBody?.len }));
  check('英文版正文不含中文', enBody?.hasZh === false);

  await shot(new URL('../docs/v2-agent-panel-en.png', import.meta.url));
  await ev(`localStorage.setItem('kinelayer.locale','zh-CN')`);
  await cdp.call('Page.reload');
  await sleep(3000);
  for (let i = 0; i < 40; i += 1) {
    if (await ev('typeof window.__kly !== "undefined"')) break;
    await sleep(400);
  }
  await ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => ['设置', 'Settings'].includes(b.getAttribute('title') || ''));
    btn?.click();
    return true;
  })()`);
  await sleep(400);
  await ev(`(() => {
    const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '桌面 Agent');
    tab?.click();
    return true;
  })()`);
  await sleep(800);
  await shot(new URL('../docs/v2-agent-panel.png', import.meta.url));

  const pass = results.filter((r) => r.ok).length;
  console.log(`\n结果：${pass}/${results.length} 通过`);
  process.exit(pass === results.length ? 0 : 1);
};

main()
  .catch((e) => {
    console.error('脚本异常：', e.message);
    process.exit(3);
  })
  .finally(() => {
    try {
      edge.kill();
    } catch {
      /* ignore */
    }
  });
