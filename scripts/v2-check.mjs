/**
 * v2 端到端验证：真实浏览器 + 真实命令总线
 * 覆盖：schemaVersion 迁移、animation.* 命令、轨道求值、auto-keyframe、撤销、i18n 无残留中文
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

/* 依赖从 agent-bridge 的 node_modules 解析；用 URL 相对定位，换目录/改品牌都不用改脚本 */
const require = createRequire(new URL('../agent-bridge/package.json', import.meta.url));
const WebSocket = require('ws');

/* 浏览器路径统一从 _cdp 取（可用 KLY_BROWSER_PATH 覆盖），这里不要再写死一份 */
import { EDGE } from './_cdp.mjs';
const DBG = 9300 + Math.floor(Math.random() * 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DBG}`,
    `--user-data-dir=C:/Users/KngLokiko/AppData/Local/Temp/ml-v2-${Date.now()}`,
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
  if (res.result?.exceptionDetails) {
    throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 400));
  }
  return res.result?.result?.value;
}

async function shot(file) {
  const res = await cdp.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
}

const main = async () => {
  if (!(await connectCdp())) {
    console.error('CDP 连不上，浏览器可能没起来');
    process.exit(2);
  }
  await cdp.call('Runtime.enable');
  await cdp.call('Page.enable');

  // 等 __kly 就绪
  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    ready = await ev('typeof window.__kly !== "undefined"');
    if (ready) break;
    await sleep(500);
  }
  check('dev 调试口就绪', ready);
  if (!ready) return;

  /* 路由改动：`/` 现在是启动页。点「空白项目」进编辑器（等价于用户上手第一步）。
     之后 URL 会变成 ?view=editor&projectId=…，所以后续 reload 仍停在编辑器。 */
  await ev(`(() => { const b = document.querySelector('[data-testid="new-blank"]'); if (b) { b.click(); return true; } return false; })()`);
  for (let i = 0; i < 60; i += 1) {
    if (await ev('!!document.querySelector("[data-tier]")')) break;
    await sleep(300);
  }

  /* 1. 命令注册表 */
  const cmds = await ev('window.__kly.commands()');
  const anim = cmds.filter((c) => c.startsWith('animation.'));
  check('animation.* 命令已注册（8 条）', anim.length === 8, `实际 ${anim.length}: ${anim.join(' ')}`);
  check('命令总数 >= 67', cmds.length >= 67, `实际 ${cmds.length}`);

  /* 2. schemaVersion */
  const ver = await ev('window.__kly.state().project.schemaVersion');
  check('project.schemaVersion 为 2', ver === 2, `实际 ${ver}`);

  /* 3. 建一个文本层 */
  const created = await ev(`(async () => {
    const r = await window.__kly.dispatch('layer.create', { type: 'text', text: '关键帧测试', x: 200, y: 400, width: 600, height: 200 });
    return { ok: r.ok, id: r.data?.id, err: r.error?.message };
  })()`);
  check('layer.create 成功', created.ok === true, created.err ?? created.id);
  const lid = created.id;

  /* 4. 预设生成轨道 */
  const preset = await ev(`(async () => {
    const r = await window.__kly.dispatch('animation.applyPreset', { id: '${lid}', preset: 'rise', duration: 800 });
    const layer = window.__kly.state().project.layers.find(l => l.id === '${lid}');
    return { ok: r.ok, props: (layer.animation.tracks || []).map(t => t.property), counts: (layer.animation.tracks || []).map(t => t.keyframes.length), err: r.error?.message };
  })()`);
  check('applyPreset 生成 y + opacity 轨道', preset.ok && preset.props.includes('y') && preset.props.includes('opacity'), JSON.stringify(preset));
  check('每条轨道各 2 个关键帧', JSON.stringify(preset.counts) === '[2,2]', JSON.stringify(preset.counts));

  /* 5. 关键帧覆盖预设：手动打 x 轨道，再读渲染帧 */
  await ev(`window.__kly.dispatch('animation.setKeyframe', { id: '${lid}', property: 'x', time: 0, value: 100 })`);
  await ev(`window.__kly.dispatch('animation.setKeyframe', { id: '${lid}', property: 'x', time: 400, value: 500, easing: { kind: 'linear' } })`);
  await ev(`window.__kly.dispatch('animation.setKeyframe', { id: '${lid}', property: 'x', time: 800, value: 900, easing: { kind: 'linear' } })`);

  const mid = await ev(`(async () => {
    await window.__kly.dispatch('timeline.seek', { time: 200 });
    await new Promise(r => setTimeout(r, 120));
    const el = document.querySelector('canvas');
    return { has: !!el, playhead: window.__kly.state().runtime.playhead };
  })()`);
  check('播放头可 seek 到 200ms', mid.has && Math.abs(mid.playhead - 200) < 5, JSON.stringify(mid));

  /* 6. 同时间点写入 = 覆盖，不新增 */
  const dup = await ev(`(async () => {
    await window.__kly.dispatch('animation.setKeyframe', { id: '${lid}', property: 'x', time: 400, value: 456 });
    const layer = window.__kly.state().project.layers.find(l => l.id === '${lid}');
    const track = layer.animation.tracks.find(t => t.property === 'x');
    const kf = track.keyframes.find(k => Math.abs(k.time - 400) <= 1);
    return { n: track.keyframes.length, v: kf?.value };
  })()`);
  check('同时间点写入覆盖而非新增', dup.n === 3 && dup.v === 456, JSON.stringify(dup));

  /* 7. auto-keyframe：已有轨道的属性改动会在播放头打点 */
  const auto = await ev(`(async () => {
    await window.__kly.dispatch('animation.setAutoKeyframe', { id: '${lid}', enabled: true });
    await window.__kly.dispatch('timeline.seek', { time: 600 });
    await new Promise(r => setTimeout(r, 80));
    await window.__kly.dispatch('layer.update', { id: '${lid}', patch: { x: 777 } });
    const layer = window.__kly.state().project.layers.find(l => l.id === '${lid}');
    const track = layer.animation.tracks.find(t => t.property === 'x');
    const kf = track.keyframes.find(k => Math.abs(k.time - 600) <= 2);
    return { n: track.keyframes.length, v: kf?.value, base: layer.x, times: track.keyframes.map(k => k.time) };
  })()`);
  check('auto-keyframe 在播放头落点', auto.v === 777 && auto.n === 4, JSON.stringify(auto));
  check('基础属性同步更新', auto.base === 777, `x=${auto.base}`);
  check('关键帧按时间有序', JSON.stringify(auto.times) === JSON.stringify([...auto.times].sort((a, b) => a - b)), JSON.stringify(auto.times));

  /* 8. 撤销：一次 layer.update = 一次撤销点 */
  const undone = await ev(`(async () => {
    await window.__kly.dispatch('history.undo');
    const layer = window.__kly.state().project.layers.find(l => l.id === '${lid}');
    const track = layer.animation.tracks.find(t => t.property === 'x');
    return { n: track.keyframes.length, base: layer.x };
  })()`);
  check('撤销回到打点前（4→3 帧）', undone.n === 3 && undone.base !== 777, JSON.stringify(undone));

  /* 9. 关键帧删除 + 清空轨道 */
  const cleaned = await ev(`(async () => {
    const layer0 = window.__kly.state().project.layers.find(l => l.id === '${lid}');
    const t0 = layer0.animation.tracks.find(t => t.property === 'x');
    const victim = t0.keyframes[t0.keyframes.length - 1].id;
    await window.__kly.dispatch('animation.removeKeyframe', { id: '${lid}', property: 'x', keyframeIds: [victim] });
    const after = window.__kly.state().project.layers.find(l => l.id === '${lid}').animation.tracks.find(t => t.property === 'x');
    await window.__kly.dispatch('animation.clearTrack', { id: '${lid}', property: 'x' });
    const final = window.__kly.state().project.layers.find(l => l.id === '${lid}');
    return { rest: after.keyframes.length, props: (final.animation.tracks || []).map(t => t.property) };
  })()`);
  check('removeKeyframe 生效', cleaned.rest === 2, JSON.stringify(cleaned));
  check('clearTrack 移除整条轨道', !cleaned.props.includes('x'), JSON.stringify(cleaned.props));

  /* 10. 时间轴 UI：展开轨道后应出现菱形关键帧 */
  const ui = await ev(`(async () => {
    await window.__kly.dispatch('selection.set', { ids: ['${lid}'] });
    const st = window.__kly.state();
    document.querySelectorAll('button[title="展开轨道"]').forEach((b) => b.click());
    await new Promise(r => setTimeout(r, 250));
    const diamonds = document.querySelectorAll('button[title*="ms ·"]').length;
    return { diamonds, zoom: st.ui.timelineZoom };
  })()`);
  check('时间轴渲染出关键帧菱形', ui.diamonds >= 4, `diamonds=${ui.diamonds}`);

  await shot(new URL('../docs/v2-timeline.png', import.meta.url));

  /* 11. 切英文：正文不应再有中文（导航/命令描述除外） */
  const en = await ev(`(async () => {
    localStorage.setItem('kinelayer.locale', 'en-US');
    return 'set';
  })()`);
  await cdp.call('Page.reload');
  await sleep(4000);
  for (let i = 0; i < 40; i += 1) {
    if (await ev('typeof window.__kly !== "undefined"')) break;
    await sleep(500);
  }
  const zh = await ev(`(() => {
    // 项目数据（图层名、资源名）不做翻译，排除掉；只查 UI 文案
    const data = new Set(window.__kly.state().project.layers.map((l) => l.name));
    const bad = [];
    const walk = (n) => {
      if (n.nodeType === 3) {
        const s = n.textContent.trim();
        if (!/[\\u4e00-\\u9fa5]/.test(s)) return;
        if (data.has(s)) return; // 图层名属于项目数据
        if ([...data].some((d) => s.startsWith(d + ' ·'))) return;
        bad.push(s.slice(0, 40));
      } else if (n.nodeType === 1) {
        const el = n;
        if (['SCRIPT','STYLE'].includes(el.tagName)) return;
        for (const a of ['title', 'placeholder', 'aria-label']) {
          const v = el.getAttribute && el.getAttribute(a);
          if (!v || !/[\\u4e00-\\u9fa5]/.test(v)) return;
          if ([...data].some((d) => v.startsWith(d))) return;
          bad.push('@' + a + '=' + v.slice(0, 30));
        }
        el.childNodes.forEach(walk);
      }
    };
    walk(document.body);
    return [...new Set(bad)];
  })()`);
  check('英文界面无残留中文文案', Array.isArray(zh) && zh.length === 0, (zh || []).join(' | '));
  await shot(new URL('../docs/v2-en.png', import.meta.url));

  console.log('\n结果：');
  const pass = results.filter((r) => r.ok).length;
  console.log(`  ${pass}/${results.length} 通过`);
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
