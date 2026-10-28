/**
 * ② 启动页 + ③ 工程包（.kly）端到端验证。
 *
 * 真的走一遍用户路径：
 *   页面上点「导出」→ 文件落到磁盘 → Node 用 fflate 拆开验清单与 sha256
 *   → 再把文件塞回文件选择框 → 页面导入 → 库里多一条工程 + 资源能渲染
 * 另外两条是敌意输入：路径穿越的 zip、高压缩比的 zip 炸弹，都必须被拒。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { launch, reporter, sleep } from './_cdp.mjs';

const require = createRequire(new URL('../package.json', import.meta.url));
const { unzipSync, zipSync, strToU8, strFromU8 } = require('fflate');

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kly-dl-'));

const { check, finish } = reporter();
const base = 'http://localhost:5273/';

function newestKly() {
  const files = fs
    .readdirSync(dlDir)
    .filter((f) => f.endsWith('.kly') && !f.endsWith('.crdownload'))
    .map((f) => ({ f, at: fs.statSync(path.join(dlDir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  return files[0] ? path.join(dlDir, files[0].f) : null;
}

/** 在页面上用真实鼠标点一下按钮（程序化 click 没有用户激活，文件选择框会被拦） */
async function realClick(cdp, selectorJs) {
  const rect = await cdp.ev(`(() => {
    const el = ${selectorJs};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!rect) return false;
  await cdp.conn.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  await cdp.conn.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  return true;
}

const findButton = (text) =>
  `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

/**
 * 选文件 → 预检对话框 → 确认导入。
 *
 * v2.5 之后导入是两步：先 `ai.inspectImport` 出降级报告，用户点「导入这份工程」才写库。
 * 所以这里除了塞文件，还要在报告卡上点一下确认 —— 少了这一步，后面的断言全在等一个
 * 永远不会发生的写库。
 */
async function importViaChooser(cdp, filePath, buttonText = '打开本地文件') {
  await cdp.conn.call('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = cdp.conn.once('Page.fileChooserOpened');
  const clicked = await realClick(cdp, findButton(buttonText));
  if (!clicked) return { ok: false, reason: 'button-not-found' };
  const info = await Promise.race([chooser, sleep(5000).then(() => null)]);
  if (!info?.backendNodeId) return { ok: false, reason: 'no-chooser' };
  await cdp.conn.call('DOM.setFileInputFiles', { files: [filePath], backendNodeId: info.backendNodeId });

  const dialog = await cdp.waitFor(`!!document.querySelector('[data-testid="import-dialog"]')`, 8000);
  if (!dialog) return { ok: false, reason: 'no-report-dialog' };
  const confirmed = await realClick(cdp, `document.querySelector('[data-testid="import-confirm"]')`);
  if (!confirmed) return { ok: false, reason: 'blocked-by-report' };
  return { ok: true };
}

const main = async () => {
  fs.mkdirSync(dlDir, { recursive: true });
  const cdp = await launch({ url: base, width: 1440 });
  try {
    await cdp.conn.call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
    const ready = await cdp.waitFor('typeof window.__kly !== "undefined"', 20000);
    check('dev 调试口就绪', ready);
    if (!ready) return;

    /* ── 1. 建工程 + 导一张图 + 一个文本层 ─────────────── */
    const built = await cdp.ev(`(async () => {
      const boot = window.__kly.state().project.id;
      const made = await window.__kly.dispatch('project.create', { name: 'BUNDLE-SRC', width: 1080, height: 1080 });
      const asset = await window.__kly.dispatch('asset.import', { name: 'dot.png', mime: 'image/png', dataUrl: ${JSON.stringify(PNG)} });
      await window.__kly.dispatch('layer.create', { type: 'image', assetId: asset.data?.id });
      await window.__kly.dispatch('layer.create', { type: 'text', text: '包里的字' });
      const s = window.__kly.state();
      return { boot, id: s.project.id, layers: s.project.layers.length, assets: s.project.assets.length, assetId: asset.data?.id };
    })()`);
    /* createEmptyProject 只带 1 个背景层，再加 image + text = 3 */
    check('建工程并导入资源', built.layers === 3 && built.assets === 1, JSON.stringify(built));

    /* ── 2. 导出 .kly（走 Ctrl+S 同一条命令） ──────────── */
    const exported = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('project.exportBundle', {});
      return { ok: r.ok, data: r.data, err: r.error?.message };
    })()`);
    check('project.exportBundle 返回文件名与体积', exported.ok && /\.kly$/.test(exported.data?.filename ?? '') && exported.data.bytes > 0, JSON.stringify({ f: exported.data?.filename, b: exported.data?.bytes, e: exported.err }));

    let file = null;
    for (let i = 0; i < 40; i += 1) {
      file = newestKly();
      if (file && fs.statSync(file).size > 0) break;
      await sleep(250);
    }
    check('浏览器把 .kly 真的下载到了磁盘', !!file && fs.statSync(file).size > 0, file ? `${path.basename(file)} ${fs.statSync(file).size}B` : '没找到文件');

    /* ── 3. Node 侧拆包验清单与校验和 ──────────────────── */
    let entries = {};
    let manifest = null;
    if (file) {
      entries = unzipSync(new Uint8Array(fs.readFileSync(file)));
      try {
        manifest = JSON.parse(strFromU8(entries['manifest.json']));
      } catch {
        manifest = null;
      }
    }
    const names = Object.keys(entries);
    check('ZIP 里有 manifest / project / assets', !!manifest && !!entries['project.json'] && names.some((n) => n.startsWith('assets/')), names.join(' '));
    check('manifest 是 v2 且带工程概要', manifest?.format === 'kinelayer-bundle' && manifest?.formatVersion === 2 && manifest?.project?.name === 'BUNDLE-SRC', JSON.stringify({ v: manifest?.formatVersion, n: manifest?.project?.name }));
    check(
      'project.json 的 sha256 与清单一致',
      manifest && sha256(Buffer.from(entries['project.json'])) === manifest.checksum.project,
      manifest?.checksum?.project?.slice(0, 12),
    );
    const assetEntry = manifest?.assets?.[0];
    check(
      '资源二进制随包且校验和一致',
      !!assetEntry && !!entries[assetEntry.path] && sha256(Buffer.from(entries[assetEntry.path])) === assetEntry.sha256,
      assetEntry?.path,
    );

    /* ── 4. 敌意输入：路径穿越 + ZIP 炸弹 ─────────────── */
    const traversal = path.join(dlDir, 'evil-travel.kly');
    fs.writeFileSync(traversal, Buffer.from(zipSync({ '../evil.txt': strToU8('pwn'), 'manifest.json': strToU8('{}'), 'project.json': strToU8('{}') })));
    const zeros = new Uint8Array(4 * 1024 * 1024);
    const bomb = path.join(dlDir, 'evil-bomb.kly');
    fs.writeFileSync(bomb, Buffer.from(zipSync({ 'manifest.json': strToU8('{}'), 'project.json': zeros }, { level: 9 })));
    check('两个敌意包已生成', fs.statSync(bomb).size < 4 * 1024 * 1024 && fs.existsSync(traversal), `${fs.statSync(bomb).size}B`);

    /* ── 5. 走真实文件选择框导入好包 ──────────────────── */
    await cdp.conn.call('Page.navigate', { url: `${base}?view=launcher` });
    await sleep(1600);
    await cdp.waitFor('typeof window.__kly !== "undefined"', 20000);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 10000);
    const launcherOpen = await cdp.ev(`!!document.querySelector('[data-testid="launcher"]')`);
    check('启动页可由 URL 直接打开', launcherOpen);

    const cards = await cdp.ev(`document.querySelectorAll('[data-testid="launcher-grid"] [data-project-id]').length`);
    check('启动页列出本机工程卡片', cards >= 1, `${cards} 张`);

    const beforeId = await cdp.ev(`window.__kly.state().project.id`);
    const pick = await importViaChooser(cdp, file ?? traversal);
    check('文件选择框拿到 .kly 并触发导入', pick.ok, pick.reason ?? '');
    const imported = await cdp.waitFor(`window.__kly.state().project.name === 'BUNDLE-SRC' && window.__kly.state().project.id !== ${JSON.stringify(beforeId)}`, 15000);
    const after = await cdp.ev(`(() => {
      const s = window.__kly.state();
      return { id: s.project.id, name: s.project.name, layers: s.project.layers.length, assets: s.project.assets.length, launcher: s.ui.showLauncher };
    })()`);
    check('导入后成了当前工程（新 id，不覆盖旧工程）', imported && after.id !== beforeId, JSON.stringify({ id: after.id }));
    check('导入的工程图层/资源都齐', after.layers === 3 && after.assets === 1, JSON.stringify(after));
    check('导入完成后自动关掉启动页', after.launcher === false);

    const idb = await cdp.ev(`(async () => {
      const open = () => new Promise((res, rej) => { const r = indexedDB.open('kinelayer'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const db = await open();
      const all = await new Promise((res) => { const q = db.transaction('assets', 'readonly').objectStore('assets').getAll(); q.onsuccess = () => res(q.result); });
      const idx = await new Promise((res) => { const q = db.transaction('meta', 'readonly').objectStore('meta').get('projectIndex'); q.onsuccess = () => res(q.result?.value ?? []); });
      db.close();
      return { assets: all.map((a) => a.id), projects: idx.map((m) => m.name) };
    })()`);
    check('资源二进制落进了 IndexedDB', idb.assets.includes(built.assetId), `${idb.assets.length} 个资源`);
    check('索引里出现导入的工程', idb.projects.includes('BUNDLE-SRC'), idb.projects.join(', '));

    /* ── 6. 敌意包必须被拒 ─────────────────────────────── */
    const curId = await cdp.ev(`window.__kly.state().project.id`);
    await cdp.conn.call('Page.navigate', { url: `${base}?view=launcher` });
    await sleep(1500);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 10000);

    const p2 = await importViaChooser(cdp, traversal);
    await sleep(1200);
    const travelToast = await cdp.ev(`document.body.innerText.includes('非法路径')`);
    const afterTravel = await cdp.ev(`window.__kly.state().project.id`);
    check('路径穿越的包被拒（提示非法路径）', p2.ok && travelToast && afterTravel === curId, JSON.stringify({ toast: travelToast }));

    const p3 = await importViaChooser(cdp, bomb);
    await sleep(1200);
    const bombToast = await cdp.ev(`document.body.innerText.includes('压缩比')`);
    const afterBomb = await cdp.ev(`window.__kly.state().project.id`);
    check('ZIP 炸弹被拒（提示压缩比异常）', p3.ok && bombToast && afterBomb === curId, JSON.stringify({ toast: bombToast }));

    /* ── 7. 旧版 JSON 备份仍能载入 ─────────────────────── */
    const legacy = await cdp.ev(`(async () => {
      const p = JSON.parse(JSON.stringify(window.__kly.state().project));
      p.name = 'LEGACY-JSON';
      const r = await window.__kly.dispatch('project.load', { data: JSON.stringify(p) });
      return { ok: r.ok, name: window.__kly.state().project.name, err: r.error?.message };
    })()`);
    check('旧版裸 JSON 仍可载入', legacy.ok && legacy.name === 'LEGACY-JSON', JSON.stringify(legacy));

    /* 文档配图放在最后拍：先把这一轮造出来的测试工程删掉、重新加载让列表刷新、
       提示条也随重载消失 —— 否则图上是四个红色错误提示加一堆 BUNDLE-SRC 卡片。 */
    await cdp.ev(`(async () => {
      const list = await window.__kly.dispatch('project.listRecent', { limit: 50 });
      const junk = (list.data?.projects || []).filter((p) => /^(BUNDLE-SRC|LEGACY-JSON|剪辑自检|出片自检|UI 检查)/.test(p.name || ''));
      for (const p of junk) await window.__kly.dispatch('project.deleteLocal', { projectId: p.id, confirm: true });
      return junk.length;
    })()`);
    await cdp.conn.call('Page.navigate', { url: `${base}?view=launcher` });
    await cdp.waitFor('typeof window.__kly !== "undefined"', 20000);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 10000);
    await sleep(2400);
    await cdp.shot(new URL('../docs/v3-launcher.png', import.meta.url));

  } finally {
    try {
      cdp.edge.kill();
    } catch {
      /* ignore */
    }
  }
};

main()
  .catch((e) => {
    console.error('脚本异常：', e.message);
    process.exitCode = 3;
  })
  .finally(() => {
    process.exitCode = process.exitCode ?? finish();
  });
