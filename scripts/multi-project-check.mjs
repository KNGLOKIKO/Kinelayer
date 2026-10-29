/**
 * ① 多工程持久化 端到端验证：真实浏览器 + 真实命令总线 + 真实 IndexedDB
 *
 * 覆盖：
 *   · 6 条 project.* 命令的注册与行为
 *   · 切换工程 = 旧工程先落盘（不丢最后 1.6 秒）+ 撤销栈清空 + 播放头归零
 *   · 自动保存写 project:<id> 与 meta 索引，缩略图不每次重算
 *   · 删工程时的资源引用计数（共享的图片不能跟着删）
 *   · 删掉「当前打开的工程」之后，自动保存不许把它复活
 *   · 刷新按 lastProjectId 恢复；URL ?projectId 优先
 *   · 旧版本的单工程数据（kv['project.autosave']）自动拆成索引条目
 */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const require = createRequire(new URL('../agent-bridge/package.json', import.meta.url));
const WebSocket = require('ws');

/* 浏览器路径统一从 _cdp 取（可用 KLY_BROWSER_PATH 覆盖），这里不要再写死一份 */
import { EDGE } from './_cdp.mjs';
const PORT = 5273;
const DBG = 9340 + Math.floor(Math.random() * 40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DBG}`,
    `--user-data-dir=C:/Users/KngLokiko/AppData/Local/Temp/ml-multi-${Date.now()}`,
    '--window-size=1600,1000',
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
      /* 还没起 */
    }
    await sleep(300);
  }
  return false;
}

async function ev(expression) {
  const res = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.result?.exceptionDetails) {
    throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 500));
  }
  return res.result?.result?.value;
}

async function waitReady(tries = 80) {
  for (let i = 0; i < tries; i += 1) {
    if (await ev('typeof window.__kly !== "undefined"')) return true;
    await sleep(400);
  }
  return false;
}

/** 直接读 IndexedDB：验证的是库里的真实状态，不是内存里的对象 */
const idbProbe = `(async () => {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('kinelayer');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const db = await open();
  const read = (store) => new Promise((res, rej) => {
    const q = db.transaction(store, 'readonly').objectStore(store).getAll();
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  const meta = await read('meta');
  const projects = await read('projects');
  const assets = await read('assets');
  const prefs = await read('prefs');
  const index = (meta.find((m) => m.key === 'projectIndex') || {}).value || [];
  db.close();
  return {
    index: index.map((m) => ({ id: m.id, name: m.name, layers: m.layerCount, thumb: typeof m.thumbnail === 'string' && m.thumbnail.startsWith('data:image/'), assets: m.assetIds.length })),
    projectIds: projects.map((p) => p.id),
    assetIds: assets.map((a) => a.id),
    lastProjectId: (prefs.find((p) => p.key === 'app') || {}).value?.lastProjectId ?? null,
  };
})()`;

const main = async () => {
  if (!(await connectCdp())) {
    console.error('CDP 连不上，浏览器可能没起来');
    process.exit(2);
  }
  await cdp.call('Runtime.enable');
  await cdp.call('Page.enable');

  const ready = await waitReady();
  check('dev 调试口就绪', ready);
  if (!ready) return;

  /* 路由改动：`/` 现在是启动页。点「空白项目」进编辑器（等价于用户上手第一步）。
     之后 URL 会变成 ?view=editor&projectId=…，所以后续 reload 仍停在编辑器。 */
  await ev(`(() => { const b = document.querySelector('[data-testid="new-blank"]'); if (b) { b.click(); return true; } return false; })()`);
  for (let i = 0; i < 60; i += 1) {
    if (await ev('!!document.querySelector("[data-tier]")')) break;
    await sleep(300);
  }

  /* ── 1. 命令注册 ────────────────────────────────────── */
  const cmds = await ev('window.__kly.commands()');
  const wanted = ['project.listRecent', 'project.create', 'project.open', 'project.rename', 'project.deleteLocal', 'project.duplicate'];
  const missing = wanted.filter((c) => !cmds.includes(c));
  check('6 条多工程命令已注册', missing.length === 0, missing.join(', '));

  /* ── 2. 首启动就给示例工程建档 ──────────────────────── */
  /* 建档发生在 boot 里（先 initAI / restoreFonts 再碰库），这里等它落地 */
  let first = { ok: false, n: 0, current: '', last: null };
  for (let i = 0; i < 20; i += 1) {
    first = await ev(`(async () => {
      const r = await window.__kly.dispatch('project.listRecent', { limit: 50 });
      return { ok: r.ok, n: r.data?.projects.length, current: r.data?.currentId, last: r.data?.lastProjectId };
    })()`);
    if (first.ok && first.n >= 1) break;
    await sleep(400);
  }
  check('启动页能读到工程列表（示例工程已建档）', first.ok && first.n >= 1, JSON.stringify(first));

  /* ── 3. 新建 A ──────────────────────────────────────── */
  const createdA = await ev(`(async () => {
    const r = await window.__kly.dispatch('project.create', { name: 'A · 多工程', width: 1080, height: 1080, background: '#101322' });
    const s = window.__kly.state();
    const bg = s.project.layers[0];
    return { ok: r.ok, id: r.data?.projectId, err: r.error?.message, cur: s.project.id, name: s.project.name, bg: bg.kind + '/' + bg.color, size: s.project.width + 'x' + s.project.height };
  })()`);
  check('project.create 建工程并切过去', createdA.ok && createdA.cur === createdA.id && createdA.name === 'A · 多工程', JSON.stringify(createdA));
  check('画布尺寸与纯色背景按参数生效', createdA.size === '1080x1080' && createdA.bg === 'solid/#101322', createdA.bg + ' ' + createdA.size);
  const A = createdA.id;

  /* ── 4. 新工程带缩略图 ──────────────────────────────── */
  const withThumb = await ev(`(async () => {
    const r = await window.__kly.dispatch('project.listRecent', { limit: 50 });
    const meta = (r.data?.projects || []).find((p) => p.id === ${JSON.stringify(A)});
    return { thumb: !!meta?.thumbnail, head: (meta?.thumbnail || '').slice(0, 22), layers: meta?.layerCount };
  })()`);
  check('建档时生成 jpeg 缩略图', withThumb.thumb === true && withThumb.head.startsWith('data:image/jpeg'), withThumb.head);

  /* ── 5. 改一下 → 自动保存写回索引 ───────────────────── */
  await ev(`window.__kly.dispatch('layer.create', { type: 'text', text: 'A 里的图层' })`);
  await sleep(2300);
  const autoSaved = await ev(`(async () => {
    const r = await window.__kly.dispatch('project.listRecent', { limit: 50 });
    const meta = (r.data?.projects || []).find((p) => p.id === ${JSON.stringify(A)});
    return { layers: meta?.layerCount, db: null };
  })()`);
  check('自动保存把新图层写进索引', autoSaved.layers === 2, `layerCount=${autoSaved.layers}`);

  /* ── 6. 新建 B：A 必须先落盘 ────────────────────────── */
  const createdB = await ev(`(async () => {
    const before = window.__kly.state().project.id;
    const r = await window.__kly.dispatch('project.create', { name: 'B · 另一张', width: 1080, height: 1440 });
    const db = await ${idbProbe};
    const aRec = db.projectIds.includes(${JSON.stringify(A)});
    const aMeta = db.index.find((m) => m.id === ${JSON.stringify(A)});
    return { ok: r.ok, id: r.data?.projectId, before, cur: window.__kly.state().project.id, aRec, aLayers: aMeta?.layers, count: db.index.length, last: db.lastProjectId };
  })()`);
  check('project.create 换文档', createdB.ok && createdB.cur === createdB.id, JSON.stringify({ id: createdB.id }));
  check('建 B 之前先把 A 落盘（不丢改动）', createdB.aRec === true && createdB.aLayers === 2, JSON.stringify({ aRec: createdB.aRec, aLayers: createdB.aLayers }));
  check('lastProjectId 跟着切到 B', createdB.last === createdB.id);
  const B = createdB.id;

  /* ── 7. 切回 A：内容还在、撤销栈清空、播放头归零 ───── */
  const reopened = await ev(`(async () => {
    await window.__kly.dispatch('timeline.seek', { time: 900 });
    await window.__kly.dispatch('project.open', { projectId: ${JSON.stringify(A)} });
    const s = window.__kly.state();
    const ids = s.project.layers.map((l) => l.id);
    return { cur: s.project.id, name: s.project.name, layers: s.project.layers.length, texts: s.project.layers.filter((l) => l.type === 'text').length, past: s.past.length, future: s.future.length, playhead: s.runtime.playhead, playing: s.runtime.playing, selected: s.ui.selectedIds.length, active: s.ui.activeLayerId, ids };
  })()`);
  check('project.open 切回 A 且图层内容还在', reopened.cur === A && reopened.texts === 1, JSON.stringify({ cur: reopened.cur, texts: reopened.texts }));
  check('切换后撤销栈清空', reopened.past === 0 && reopened.future === 0, JSON.stringify({ past: reopened.past }));
  check('切换后主时钟归零、选择清空', reopened.playhead === 0 && reopened.playing === false && reopened.selected === 0, JSON.stringify({ playhead: reopened.playhead, selected: reopened.selected }));
  check('切换后选中第一个非背景图层', typeof reopened.active === 'string' && reopened.active !== reopened.ids[0], String(reopened.active));

  /* ── 8. 打开不存在的工程：报错且不动当前文档 ────────── */
  const ghost = await ev(`(async () => {
    const r = await window.__kly.dispatch('project.open', { projectId: 'prj_does_not_exist' });
    return { ok: r.ok, code: r.error?.code, cur: window.__kly.state().project.id };
  })()`);
  check('打开不存在的工程 → NOT_FOUND 且不切文档', ghost.ok === false && ghost.code === 'NOT_FOUND' && ghost.cur === A, JSON.stringify(ghost));

  /* ── 9. 重命名非当前工程：只改库 ───────────────────── */
  const renamed = await ev(`(async () => {
    const r = await window.__kly.dispatch('project.rename', { projectId: ${JSON.stringify(B)}, name: 'B · 改过名' });
    const db = await ${idbProbe};
    const meta = db.index.find((m) => m.id === ${JSON.stringify(B)});
    const list = await window.__kly.dispatch('project.listRecent', { limit: 50 });
    const shown = (list.data?.projects || []).find((p) => p.id === ${JSON.stringify(B)});
    return { ok: r.ok, scope: r.data?.scope, metaName: meta?.name, shownName: shown?.name, cur: window.__kly.state().project.id };
  })()`);
  check('重命名非当前工程 → 只改库里那条', renamed.ok && renamed.scope === 'stored' && renamed.metaName === 'B · 改过名', JSON.stringify(renamed));
  check('重命名不切换当前文档', renamed.cur === A);

  /* ── 10. 复制：资源共享、名字加后缀 ────────────────── */
  const duped = await ev(`(async () => {
    const r = await window.__kly.dispatch('project.duplicate', { projectId: ${JSON.stringify(A)} });
    const db = await ${idbProbe};
    const meta = db.index.find((m) => m.id === r.data?.projectId);
    return { ok: r.ok, id: r.data?.projectId, name: r.data?.name, layers: meta?.layers, inIndex: !!meta, cur: window.__kly.state().project.id, count: db.index.length };
  })()`);
  check('project.duplicate 生成新工程', duped.ok && duped.id !== A && duped.inIndex, JSON.stringify({ id: duped.id }));
  check('副本名字带后缀、图层一致', duped.name === 'A · 多工程 副本' && duped.layers === 2, String(duped.name));
  check('复制不切换当前文档', duped.cur === A);
  const COPY = duped.id;

  /* ── 11. 删除需要 confirm ──────────────────────────── */
  const noConfirm = await ev(`(async () => {
    const r = await window.__kly.dispatch('project.deleteLocal', { projectId: ${JSON.stringify(COPY)} });
    const db = await ${idbProbe};
    return { ok: r.ok, code: r.error?.code, still: db.index.some((m) => m.id === ${JSON.stringify(COPY)}) };
  })()`);
  check('不给 confirm 拒绝删除', noConfirm.ok === false && noConfirm.code === 'FORBIDDEN' && noConfirm.still, JSON.stringify(noConfirm));

  /* ── 12. 资源级联：共享的不删，独占的才删 ──────────── */
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const cascade = await ev(`(async () => {
    const projectId = ${JSON.stringify(COPY)};
    await window.__kly.dispatch('project.open', { projectId });
    const imp = await window.__kly.dispatch('asset.import', { name: 'dot.png', mime: 'image/png', dataUrl: ${JSON.stringify(png)} });
    const assetId = imp.data?.id;
    await new Promise((r) => setTimeout(r, 2200));           // 等自动保存把 assetIds 写进索引
    const dup = await window.__kly.dispatch('project.duplicate', { projectId });
    const shared = await ${idbProbe};
    const afterDup = shared.assetIds.includes(assetId);
    // 删掉副本 → 原工程仍引用，资源不能删
    await window.__kly.dispatch('project.deleteLocal', { projectId: dup.data.projectId, confirm: true });
    const mid = await ${idbProbe};
    const keptAfterOne = mid.assetIds.includes(assetId);
    // 回到「当前」这个再删 → 没有任何工程引用，资源应被清掉
    const del = await window.__kly.dispatch('project.deleteLocal', { projectId, confirm: true });
    const end = await ${idbProbe};
    return {
      assetId,
      afterDup,
      keptAfterOne,
      keptAfterBoth: end.assetIds.includes(assetId),
      wasCurrent: del.data?.wasCurrent,
      removed: del.data?.removedAssets,
      cur: window.__kly.state().project.id,
    };
  })()`);
  check('共享资源的副本删除后资源保留', cascade.afterDup && cascade.keptAfterOne, JSON.stringify({ kept: cascade.keptAfterOne }));
  check('最后一个引用者被删 → 资源级联清理', cascade.keptAfterBoth === false && cascade.removed === 1, JSON.stringify({ removed: cascade.removed }));

  /* ── 13. 删掉当前工程后，自动保存不许复活 ──────────── */
  const noRevive = await ev(`(async () => {
    const wasCurrent = ${JSON.stringify(COPY)};
    await window.__kly.dispatch('layer.create', { type: 'text', text: '删完之后又改了' });
    await new Promise((r) => setTimeout(r, 2300));
    const db = await ${idbProbe};
    return { wasCurrent, resurrected: db.index.some((m) => m.id === wasCurrent) || db.projectIds.includes(wasCurrent), last: db.lastProjectId, cur: window.__kly.state().project.id };
  })()`);
  check('删除当前工程后自动保存不复活它', cascade.wasCurrent === true && noRevive.resurrected === false, JSON.stringify({ resurrected: noRevive.resurrected }));
  check('删除当前工程后 lastProjectId 清空', noRevive.last === null, String(noRevive.last));

  /* ── 14. 刷新：按 lastProjectId 恢复 ───────────────── */
  const beforeReload = await ev(`(async () => {
    const r = await window.__kly.dispatch('project.open', { projectId: ${JSON.stringify(A)} });
    const db = await ${idbProbe};
    return { id: r.data?.projectId, last: db.lastProjectId };
  })()`);
  await cdp.call('Page.reload');
  await sleep(1500);
  const ready2 = await waitReady();
  check('刷新后编辑器仍可用', ready2);
  if (ready2) {
    const restored = await ev(`(() => {
      const s = window.__kly.state();
      return { cur: s.project.id, name: s.project.name, last: ${JSON.stringify(beforeReload.last)} };
    })()`);
    check('刷新后打开的是上次打开的工程', restored.cur === beforeReload.id, `cur=${restored.cur} want=${beforeReload.id}`);
  }

  /* ── 15. URL ?projectId= 优先 ──────────────────────── */
  await ev(`(async () => {
    const url = new URL(location.href);
    url.searchParams.set('projectId', ${JSON.stringify(B)});
    history.replaceState(null, '', url.toString());
    return true;
  })()`);
  await cdp.call('Page.reload');
  await sleep(1500);
  const ready3 = await waitReady();
  if (ready3) {
    const viaUrl = await ev(`(() => {
      const s = window.__kly.state();
      return { cur: s.project.id, name: s.project.name };
    })()`);
    check('URL 上的 projectId 优先于 lastProjectId', viaUrl.cur === B && viaUrl.name === 'B · 改过名', JSON.stringify(viaUrl));
  } else {
    check('URL 上的 projectId 优先于 lastProjectId', false, '页面没起来');
  }

  /* ── 16. 旧单工程数据自动拆成索引 ──────────────────── */
  /* 先把 URL 上的 projectId 去掉，否则下一轮刷新又会优先打开它 */
  await ev(`(() => {
    const url = new URL(location.href);
    url.searchParams.delete('projectId');
    history.replaceState(null, '', url.toString());
    return url.toString();
  })()`);
  const seeded = await ev(`(async () => {
    const project = JSON.parse(JSON.stringify(window.__kly.state().project));
    project.id = 'prj_legacy_single';
    project.name = 'LEGACY-MULTI';
    const open = () => new Promise((res, rej) => {
      const r = indexedDB.open('kinelayer');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const db = await open();
    // 退回「单工程时代」：清掉索引与工程本体，只留 kv['project.autosave']
    await new Promise((res, rej) => {
      const tx = db.transaction(['meta', 'projects', 'kv'], 'readwrite');
      tx.objectStore('meta').clear();
      tx.objectStore('projects').clear();
      tx.objectStore('kv').put({ key: 'project.autosave', value: project });
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
    return 'seeded';
  })()`);
  check('已铺好旧版本单工程数据', seeded === 'seeded');

  await cdp.call('Page.reload');
  await sleep(1600);
  const ready4 = await waitReady();
  if (ready4) {
    const migrated = await ev(`(async () => {
      const db = await ${idbProbe};
      const s = window.__kly.state();
      return { n: db.index.length, name: db.index[0]?.name, cur: s.project.id, curName: s.project.name, last: db.lastProjectId };
    })()`);
    check('旧单工程被拆成 1 条索引并自动打开', migrated.n === 1 && migrated.curName === 'LEGACY-MULTI' && migrated.cur === 'prj_legacy_single', JSON.stringify(migrated));
    check('迁移后 lastProjectId 指向该工程', migrated.last === 'prj_legacy_single', String(migrated.last));
  } else {
    check('旧单工程被拆成 1 条索引并自动打开', false, '页面没起来');
  }

  /* ── 17. 设置「数据与安全」页要能看出本机有几个工程 ── */
  const dataTab = await ev(`(async () => {
    const gear = [...document.querySelectorAll('button')].find((b) => ['设置', 'Settings'].includes(b.getAttribute('title') || ''));
    gear?.click();
    await new Promise((r) => setTimeout(r, 260));
    const tab = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '数据与安全');
    tab?.click();
    await new Promise((r) => setTimeout(r, 420));
    const text = document.body.innerText;
    return { hit: /本机工程 1 个/.test(text), hasRecover: /恢复旧版数据/.test(text) };
  })()`);
  check('数据页显示本机工程数与恢复入口', dataTab.hit && dataTab.hasRecover, JSON.stringify(dataTab));
  const shot = await cdp.call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(new URL('../docs/v2-multi-project.png', import.meta.url), Buffer.from(shot.result.data, 'base64'));

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
