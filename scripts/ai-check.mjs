/**
 * v2.5 阶段 A 验收：导入降级管线 + scene.ai.json 导出。
 *
 * 规格里这一阶段的硬要求，逐条对应到下面的 check：
 *   1. 预检必须先跑，且不写库（`ai.inspectImport` 是纯函数）
 *   2. 导入要把「能拆的都拆成可编辑图层」，拆不了的降成代码层（形状→canvas2d）
 *   3. 媒体缺资源要如实记账（missingAssets），不许静默吞掉
 *   4. 每一层带来源元信息（origin），图层树才能标「导入」
 *   5. 导出 scene.ai.json：秒为单位、不含 base64、代码层给摘要
 *   6. Remotion 没给 ZIP 时明确挡下（真实解析在 remotion-check.mjs 里验）
 *   7. UI 上真的能看到降级报告，确认后才写库
 *
 * 需要 dev server 跑在 5273。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, reporter, sleep } from './_cdp.mjs';

const base = 'http://localhost:5273/';
const { check, finish } = reporter();

/**
 * 一个 Rendervid 风格的场景：两个文本层 + 一个矩形 + 一张外链图。
 * 图层名故意写成英文：英文模式的「零中文」断言要严格到整张卡片 —— 图层名是用户数据，
 * 中文名字混进去会让断言永远失败，而失败原因跟 UI 文案没关系。
 */
const FIXTURE = {
  name: 'AI-SCENE',
  width: 1920,
  height: 1080,
  duration: 6,
  fps: 30,
  backgroundColor: '#0b0e14',
  layers: [
    {
      type: 'text',
      name: 'Title',
      text: 'Hello Kinelayer',
      x: 120,
      y: 200,
      width: 900,
      height: 160,
      start: 0,
      end: 6,
      style: { fontSize: 96, fontWeight: 800, color: '#ffffff', align: 'left' },
      tracks: [
        { property: 'opacity', keyframes: [{ time: 0, value: 0, easing: 'ease-out' }, { time: 0.8, value: 1 }] },
        { property: 'y', keyframes: [{ time: 0, value: 240 }, { time: 1.2, value: 200, easing: 'cubic-bezier(0.2,0.8,0.2,1)' }] },
      ],
    },
    {
      type: 'text',
      name: 'Subtitle',
      text: 'structured import',
      x: 120,
      y: 380,
      width: 800,
      height: 80,
      style: { fontSize: 40, color: '#9aa4b2' },
    },
    { type: 'rect', name: 'Badge', x: 120, y: 500, width: 240, height: 12, fill: '#7c5cff' },
    { type: 'image', name: 'Backdrop', src: 'https://example.com/bg.png', x: 0, y: 0, width: 1920, height: 1080 },
  ],
};

const clickConfirm = `(() => {
  const b = document.querySelector('[data-testid="import-confirm"]');
  if (!b) return false;
  b.click();
  return true;
})()`;

const findButton = (text) =>
  `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

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

const main = async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kly-ai-'));
  const fixturePath = path.join(tmp, 'scene.json');
  fs.writeFileSync(fixturePath, JSON.stringify(FIXTURE, null, 2), 'utf8');

  const cdp = await launch({ url: `${base}?view=editor`, width: 1440, height: 900 });
  try {
    const ready = await cdp.waitFor('typeof window.__kly !== "undefined"', 20000);
    check('dev 调试口就绪', ready);
    if (!ready) return;

    const before = await cdp.ev(`({ id: window.__kly.state().project.id, version: window.__kly.state().project.version })`);

    /* ── 1. 预检：纯函数，不写库 ─────────────────────── */
    const inspected = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('ai.inspectImport', { text: ${JSON.stringify(JSON.stringify(FIXTURE))} });
      const s = window.__kly.state();
      return { ok: r.ok, err: r.error?.message, report: r.data?.report, importable: r.data?.importable, id: s.project.id, version: s.project.version };
    })()`);
    check('ai.inspectImport 认得出场景 JSON', inspected.ok && inspected.report?.format === 'scene-json', JSON.stringify(inspected.report?.format ?? inspected.err));
    const counts = inspected.report?.counts ?? {};
    check(
      '预检统计：3 个可编辑图层 / 1 个代码层 / 2 条轨道 / 4 个关键帧',
      counts.structured === 3 && counts.code === 1 && counts.tracks === 2 && counts.keyframes === 4,
      JSON.stringify(counts),
    );
    check('外链图片被记为缺失资源（不静默吞掉）', (inspected.report?.missingAssets ?? []).length === 1, JSON.stringify(inspected.report?.missingAssets));
    check('预检不写库（工程 id 与版本都没动）', inspected.id === before.id && inspected.version === before.version, JSON.stringify({ id: inspected.id, version: inspected.version }));

    /* ── 2. 正式导入 ─────────────────────────────────── */
    const imported = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('ai.importProject', { text: ${JSON.stringify(JSON.stringify(FIXTURE))} });
      const p = window.__kly.state().project;
      return {
        ok: r.ok, err: r.error?.message, data: r.data,
        id: p.id, name: p.name, layers: p.layers.length,
        text: p.layers.filter((l) => l.type === 'text').map((l) => l.text),
        code: p.layers.filter((l) => l.type === 'code').map((l) => ({ engine: l.code.engine, lines: l.code.source.split('\\n').length })),
        tracks: p.layers.map((l) => (l.animation?.tracks ?? []).length).reduce((a, b) => a + b, 0),
        keyframes: p.layers.map((l) => (l.animation?.tracks ?? []).reduce((n, t) => n + t.keyframes.length, 0)).reduce((a, b) => a + b, 0),
        origins: [...new Set(p.layers.filter((l) => l.origin).map((l) => l.origin.sourceFormat))],
        duration: p.duration, fps: p.fps, width: p.width,
        assets: p.assets.length,
        autoSaved: true,
      };
    })()`);
    check('ai.importProject 换新 id（不覆盖当前工程）', imported.ok && imported.id !== before.id, JSON.stringify({ id: imported.id, err: imported.err }));
    check('图层全建出来了：背景 + 2 文本 + 1 代码 + 1 图片', imported.layers === 5, String(imported.layers));
    check('文本内容原样保留', JSON.stringify(imported.text) === JSON.stringify(['Hello Kinelayer', 'structured import']), JSON.stringify(imported.text));
    check('形状降级成 canvas2d 代码层（可改代码、不可打点）', imported.code?.length === 1 && imported.code[0].engine === 'canvas2d' && imported.code[0].lines > 2, JSON.stringify(imported.code));
    check('轨道与关键帧都落地了', imported.tracks === 2 && imported.keyframes === 4, JSON.stringify({ tracks: imported.tracks, keyframes: imported.keyframes }));
    check('每一层都带来源元信息（图层树才能标「导入」）', JSON.stringify(imported.origins) === JSON.stringify(['scene-json']), JSON.stringify(imported.origins));
    check('画布/时长/帧率按场景还原', imported.width === 1920 && imported.duration === 6000 && imported.fps === 30, JSON.stringify({ w: imported.width, d: imported.duration, f: imported.fps }));

    const saved = await cdp.ev(`(async () => {
      const open = () => new Promise((res, rej) => { const r = indexedDB.open('kinelayer'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const db = await open();
      const idx = await new Promise((res) => { const q = db.transaction('meta', 'readonly').objectStore('meta').get('projectIndex'); q.onsuccess = () => res(q.result?.value ?? []); });
      db.close();
      return idx.map((m) => m.name);
    })()`);
    check('导入的工程进了本机索引', saved.includes('AI-SCENE'), saved.join(', '));

    /* ── 3. 导出 scene.ai.json ────────────────────────── */
    const exported = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('ai.exportProject', { includeCode: true });
      const d = r.data ?? {};
      let scene = null;
      try { scene = JSON.parse(d.text ?? ''); } catch { /* 留空，下面断言会失败 */ }
      return { ok: r.ok, err: r.error?.message, filename: d.filename, bytes: d.bytes, layers: d.layers, codeLayers: d.codeLayers, scene };
    })()`);
    check('ai.exportProject 给出 .scene.ai.json 文件名', exported.ok && /\.scene\.ai\.json$/.test(exported.filename ?? ''), exported.filename ?? exported.err);
    const scene = exported.scene ?? {};
    check('scene.ai.json 带格式标记与版本', scene.format === 'kinelayer-ai-scene' && scene.schemaVersion === 1, JSON.stringify({ f: scene.format, v: scene.schemaVersion }));
    check('时间以秒为单位（6 秒而不是 6000）', scene.duration === 6, String(scene.duration));
    check('不含任何 base64（导出物里不许塞二进制）', !/data:[a-z/+]+;base64/i.test(JSON.stringify(scene)));
    const codeLayer = (scene.layers ?? []).find((l) => l.type === 'code');
    check('代码层带 codeSummary 与源码', !!codeLayer?.codeSummary && (codeLayer?.code ?? '').length > 20, JSON.stringify(codeLayer?.codeSummary));
    check('能力清单里写明了做不到的事', (scene.capabilities?.limitations ?? []).length >= 3, JSON.stringify(scene.capabilities?.limitations));

    const noCode = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('ai.exportProject', { includeCode: false });
      const scene = JSON.parse(r.data.text);
      const layer = scene.layers.find((l) => l.type === 'code');
      return { bytes: r.data.bytes, code: layer?.code, summary: layer?.codeSummary };
    })()`);
    check('includeCode:false 只砍源码、摘要还在', noCode.code === '' && !!noCode.summary, JSON.stringify(noCode));

    /* ── 4. 回灌：scene.ai.json 导得回来 ───────────────── */
    const roundTrip = await cdp.ev(`(async () => {
      const text = (await window.__kly.dispatch('ai.exportProject', { includeCode: true })).data.text;
      const r = await window.__kly.dispatch('ai.importProject', { text, format: 'ai-scene' });
      const p = window.__kly.state().project;
      return {
        ok: r.ok, err: r.error?.message, format: r.data?.format,
        layers: p.layers.length,
        text: p.layers.filter((l) => l.type === 'text').map((l) => l.text),
        code: p.layers.filter((l) => l.type === 'code').length,
        notes: r.data?.notes ?? [],
      };
    })()`);
    check('scene.ai.json 能导回（格式认得出是 ai-scene）', roundTrip.ok && roundTrip.format === 'ai-scene', JSON.stringify({ ok: roundTrip.ok, f: roundTrip.format, e: roundTrip.err }));
    check('回灌后图层数与文字一致', roundTrip.layers === 5 && JSON.stringify(roundTrip.text) === JSON.stringify(['Hello Kinelayer', 'structured import']), JSON.stringify({ l: roundTrip.layers, t: roundTrip.text }));
    check('回灌说明里点明了媒体只剩资源名', roundTrip.notes.some((n) => n.includes('资源名')), JSON.stringify(roundTrip.notes.slice(0, 3)));

    /* ── 5. 明确拒绝的部分 ────────────────────────────── */
    const remotion = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('ai.inspectImport', { text: 'x', format: 'remotion', name: 'clip.zip' });
      return { ok: r.ok, supported: r.data?.report?.supported, blockers: r.data?.report?.blockers ?? [] };
    })()`);
    check(
      'Remotion 没给 ZIP 时说清楚「要 ZIP」（不假装能导）',
      remotion.ok && remotion.supported === false && remotion.blockers.some((b) => b.key.includes('ZIP')),
      JSON.stringify(remotion.blockers),
    );

    const curId = await cdp.ev(`window.__kly.state().project.id`);
    const refused = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('ai.importProject', { text: 'x', format: 'remotion' });
      return { ok: r.ok, code: r.error?.code, message: r.error?.message, id: window.__kly.state().project.id };
    })()`);
    check('Remotion 导入被拒且不动当前工程', refused.ok === false && refused.code === 'VALIDATION' && refused.id === curId, JSON.stringify({ c: refused.code, same: refused.id === curId, id: refused.id, cur: curId }));

    const missent = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('ai.importProject', { text: '{}', format: 'kly' });
      return { ok: r.ok, message: r.error?.message, hint: r.error?.detail?.command };
    })()`);
    check('.kly zip 走错命令时指向 project.importBundle', missent.ok === false && missent.hint === 'project.importBundle', JSON.stringify(missent));

    /* ── 6. 代码层查询 ────────────────────────────────── */
    const codeQuery = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('ai.queryCodeLayer', { includeCode: false });
      return { ok: r.ok, total: r.data?.total, first: r.data?.layers?.[0] };
    })()`);
    check('ai.queryCodeLayer 能只列摘要不拉源码', codeQuery.ok && codeQuery.total >= 1 && !('code' in (codeQuery.first ?? {})) && !!codeQuery.first?.summary, JSON.stringify(codeQuery.first));

    /* ── 7. UI：预检报告真的会弹出来 ───────────────────── */
    await cdp.conn.call('Page.navigate', { url: base });
    await sleep(1500);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 10000);

    await cdp.conn.call('Page.setInterceptFileChooserDialog', { enabled: true });
    const chooser = cdp.conn.once('Page.fileChooserOpened');
    const clicked = await realClick(cdp, findButton('打开本地文件'));
    const info = await Promise.race([chooser, sleep(5000).then(() => null)]);
    check('启动页能唤起文件选择框', clicked && !!info?.backendNodeId, clicked ? 'no-chooser' : 'button-not-found');
    if (info?.backendNodeId) {
      await cdp.conn.call('DOM.setFileInputFiles', { files: [fixturePath], backendNodeId: info.backendNodeId });
      const shown = await cdp.waitFor(`!!document.querySelector('[data-testid="import-dialog"]')`, 10000);
      const dialog = await cdp.ev(`(() => {
        const el = document.querySelector('[data-testid="import-dialog"]');
        if (!el) return null;
        return { text: el.innerText, notes: (document.querySelector('[data-testid="import-notes"]')?.innerText ?? '') };
      })()`);
      check('选完文件先弹预检报告（不是直接写库）', shown === true && !!dialog, String(shown));
      check('报告里写清了降级说明', !!dialog?.notes && dialog.notes.includes('代码层'), (dialog?.notes ?? '').slice(0, 80));
      check('报告给出可编辑程度与图层统计', !!dialog?.text && /可编辑程度/.test(dialog.text) && /可编辑图层/.test(dialog.text), (dialog?.text ?? '').slice(0, 60));

      const idBefore = await cdp.ev(`window.__kly.state()?.project?.id ?? null`);
      await cdp.ev(clickConfirm);
      const went = await cdp.waitFor(`location.search.includes('projectId=')`, 12000);
      check('确认后跳进编辑器（启动页不是 Host，只能导航）', went === true, String(went));
      const landed = await cdp.waitFor(
        `window.__kly && window.__kly.state().project.name === 'AI-SCENE' && window.__kly.state().project.id !== ${JSON.stringify(idBefore)}`,
        15000,
      );
      check('编辑器打开的就是刚导入的那份', landed === true);
    }

    /* 截图留在中文模式：文档是中文的，报告卡的字也该是中文 */
    await cdp.shot(new URL('../docs/v25-import-report.png', import.meta.url));

    /* ── 8. 英文模式下报告卡不能有中文（降级说明也要进词典） ── */
    await cdp.conn.call('Page.navigate', { url: `${base}?view=launcher` });
    await sleep(1800);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 10000);
    await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'EN');
      if (!b) return false; b.click(); return true;
    })()`);
    await sleep(700);

    await cdp.conn.call('Page.setInterceptFileChooserDialog', { enabled: true });
    const chooser2 = cdp.conn.once('Page.fileChooserOpened');
    const clicked2 = await realClick(cdp, findButton('Open local file'));
    const info2 = await Promise.race([chooser2, sleep(5000).then(() => null)]);
    if (clicked2 && info2?.backendNodeId) {
      await cdp.conn.call('DOM.setFileInputFiles', { files: [fixturePath], backendNodeId: info2.backendNodeId });
      await cdp.waitFor(`!!document.querySelector('[data-testid="import-dialog"]')`, 10000);
      const en = await cdp.ev(`(() => {
        const el = document.querySelector('[data-testid="import-dialog"]');
        const text = el?.innerText ?? '';
        return { cjk: (text.match(/[\\u4e00-\\u9fff]/g) ?? []).length, sample: text.replace(/\\n/g, ' / ').slice(0, 120) };
      })()`);
      check('英文模式报告卡零中文（降级说明也走词典）', en.cjk === 0, `${en.cjk} 个汉字 · ${en.sample}`);
    } else {
      check('英文模式报告卡零中文（降级说明也走词典）', false, '没能唤起文件框');
    }

  } finally {
    cdp.edge.kill();
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
