/**
 * v2.6 验收：「导入之后」这一段体验。
 *
 * 导入报告是个一次性对话框 —— 关掉之后，缺资源的层在画布上只剩一块
 * 「图片资源缺失」的占位，用户既不知道它原本指向哪儿，也不知道补哪儿。
 * 这一轮要验的就是这个缺口被补上了：
 *
 *   1. 溯源：缺资源的层要记住原始引用地址（origin.sourceRef），解析器版本要能回查
 *   2. 总账：图层树能看到「几层缺资源」，点一下全部选中
 *   3. 处方：Inspector 的「来源」区块里能直接补资源（选已有 / 从本地选），
 *      且指向同一地址的多层一起补好
 *   4. 命令：asset.assign 只换资源不动几何，类型不匹配整批拒绝（不能改一半）
 *   5. 语义层：scene.ai.json 里也要有这些字段，否则 Agent 看不出这层为什么缺图
 *   6. 词条：新增文案全部有英文，英文模式下「来源」区块零中文
 *
 * 需要 dev server 跑在 5273。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { launch, reporter, sleep } from './_cdp.mjs';

const base = 'http://localhost:5273/';
const { check, finish } = reporter();

/** 1×1 PNG。中性灰，不用红色 —— 红色在排障时容易被误当成渲染 bug */
function png1x1(r, g, b, a = 255) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.from([0, r, g, b, a]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

const LOGO_B64 = Buffer.from(png1x1(120, 124, 140, 255)).toString('base64');
const REMOTE = 'https://cdn.example.com/brand/logo.png';

/**
 * 样例刻意做两件事：
 *   · 两张图引用**同一个**远程地址 → 验「一起补上」
 *   · 一张图是 data URL → 对照组，它不该被当成缺资源
 */
const FIXTURE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  body { width: 1080px; height: 1440px; margin: 0; background: #0b0b10; }
  .title { position: absolute; left: 90px; top: 120px; width: 900px; font-size: 96px; font-weight: 700; color: #ffffff; }
  .logo { position: absolute; width: 200px; height: 200px; }
  .logo.a { left: 90px; top: 300px; }
  .logo.b { left: 340px; top: 300px; }
  .pic { position: absolute; left: 90px; top: 560px; width: 300px; height: 200px; }
</style>
</head>
<body>
  <h1 class="title">After Import</h1>
  <img class="logo a" src="${REMOTE}" alt="logo">
  <img class="logo b" src="${REMOTE}" alt="logo">
  <img class="pic" src="data:image/png;base64,${LOGO_B64}" alt="pic">
</body>
</html>`;

const findButton = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

async function realClick(cdp, selectorJs) {
  /*
   * 先滚进可视区再算坐标：Inspector 是 overflow-y-auto 的，
   * 「来源」在最后一节，不滚的话坐标落在视口外面，点了个寂寞。
   */
  const found = await cdp.ev(`(() => {
    const el = ${selectorJs};
    if (!el) return false;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    return true;
  })()`);
  if (!found) return false;
  await sleep(200);
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
  const cdp = await launch({ url: base, width: 1440, height: 900 });
  try {
    const ready = await cdp.waitFor(`typeof window.__kly !== "undefined"`, 20000);
    check('dev 调试口就绪', ready);
    if (!ready) return;
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 12000);

    /* ── 1. 导入：溯源信息落到了层上 ───────────────────────── */
    const imported = await cdp.ev(`(async () => {
      const st = await window.__kly.stage(new File([${JSON.stringify(FIXTURE)}], 'poster.html', { type: 'text/html' }));
      const r = await window.__kly.dispatch('ai.importProject', { stageId: st.stageId });
      const p = window.__kly.state().project;
      const imgs = p.layers.filter((l) => l.type === 'image');
      return {
        ok: r.ok, err: r.error?.message,
        projectId: p.id,
        missing: r.data?.missingAssets ?? [],
        notes: (r.data?.notes ?? []).map((n) => n.key ?? n),
        images: imgs.map((l) => ({
          id: l.id, name: l.name,
          assetId: l.assetId,
          sourceRef: l.origin?.sourceRef ?? null,
          parser: l.origin?.parser ?? null,
          external: l.origin?.external ?? null,
          x: l.x, y: l.y, w: l.width, h: l.height,
        })),
      };
    })()`);
    check('HTML 导入跑通', imported.ok, JSON.stringify({ ok: imported.ok, e: imported.err }));

    const logos = (imported.images ?? []).filter((l) => l.sourceRef === REMOTE);
    const pic = (imported.images ?? []).find((l) => l.sourceRef !== REMOTE);
    check('两个缺资源的图片层都记住了原始地址', logos.length === 2, JSON.stringify(imported.images));
    check('缺失清单里点了这个地址', (imported.missing ?? []).some((m) => String(m).includes(REMOTE)), JSON.stringify(imported.missing));
    check(
      '报告说清了「在远程，不替你下载」',
      (imported.notes ?? []).some((k) => String(k).includes('在远程')),
      JSON.stringify(imported.notes),
    );
    check('对照组的 data URL 图片没被标成缺资源（有 assetId、无 sourceRef）', !!pic && !!pic.assetId && !pic.sourceRef, JSON.stringify(pic));
    check('解析器版本记在层上（html-dom/1）', logos[0]?.parser === 'html-dom/1', String(logos[0]?.parser));
    check('远程依赖也记在层上', (logos[0]?.external ?? []).includes(REMOTE), JSON.stringify(logos[0]?.external));

    /* ── 2. 语义层：Agent 也要看得到这些字段 ───────────────── */
    const scene = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('ai.exportProject', { includeCode: false });
      if (!r.ok) return { ok: false, err: r.error?.message };
      const j = JSON.parse(r.data.text);
      const imgs = j.layers.filter((l) => l.type === 'image');
      return {
        ok: true,
        missing: imgs.filter((l) => l.origin?.sourceRef).map((l) => ({ parser: l.origin?.parser, ref: l.origin?.sourceRef, ext: l.origin?.external })),
        total: imgs.length,
      };
    })()`);
    check('scene.ai.json 能导出来', scene.ok, JSON.stringify({ e: scene.err }));
    check('语义层里带着解析器版本', (scene.missing ?? []).every((m) => m.parser === 'html-dom/1'), JSON.stringify(scene.missing));
    check(
      '语义层里带着原始引用地址与外部依赖',
      (scene.missing ?? []).length === 2 && (scene.missing ?? []).every((m) => m.ref === REMOTE && (m.ext ?? []).includes(REMOTE)),
      JSON.stringify(scene.missing),
    );

    /* ── 3. 图层树：缺资源看得见、点得到 ────────────────────── */
    /*
     * 必须真的进编辑器页：启动页（/）根本没有图层面板和 Inspector，
     * 在那一页上断言 data-testid 只会得到 0 —— 我第一次就是这么白跑的。
     */
    await cdp.conn.call('Page.navigate', { url: `${base}?view=editor&projectId=${encodeURIComponent(imported.projectId)}` });
    const inEditor = await cdp.waitFor(`typeof window.__kly !== "undefined" && !!document.querySelector('[data-testid="layer-row"]')`, 25000);
    check('切到编辑器页并载入导入的工程', inEditor);
    if (!inEditor) return;
    await sleep(400);

    const marks = await cdp.ev(`document.querySelectorAll('[data-testid="asset-gap-mark"]').length`);
    check('图层树给两个缺资源层打了标记', marks === 2, String(marks));
    const banner = await cdp.ev(`(() => {
      const el = document.querySelector('[data-testid="asset-gap-banner"]');
      return el ? el.innerText.replace(/\\n/g, ' ') : null;
    })()`);
    check('面板顶部有「2 层缺资源」总账', !!banner && banner.includes('2 层缺资源'), String(banner));

    await realClick(cdp, `document.querySelector('[data-testid="asset-gap-banner"]')`);
    await sleep(300);
    const picked = await cdp.ev(`window.__kly.state().ui.selectedIds`);
    check(
      '点总账把两个缺资源的层都选中了',
      Array.isArray(picked) && picked.length === 2 && picked.every((id) => logos.some((l) => l.id === id)),
      JSON.stringify(picked),
    );

    /* ── 4. Inspector：来源区块说的是真的 ───────────────────── */
    await cdp.ev(`window.__kly.dispatch('selection.set', { ids: [${JSON.stringify(logos[0]?.id ?? '')}] })`);
    await sleep(250);
    const opened = await realClick(cdp, findButton('来源'));
    await sleep(250);
    const originText = await cdp.ev(`(() => {
      const el = document.querySelector('[data-testid="origin-body"]');
      return el ? el.innerText.replace(/\\n/g, ' | ') : null;
    })()`);
    check('「来源」区块能展开', opened && !!originText, String(opened));
    check('来源区块里有解析器版本', !!originText && originText.includes('html-dom/1'), String(originText).slice(0, 120));
    check('来源区块里有原始地址', !!originText && originText.includes(REMOTE), String(originText).slice(0, 120));
    check('来源区块提醒了两层会一起补', !!originText && originText.includes('另有 1 层'), String(originText).slice(0, 160));

    /* ── 5. asset.assign：换资源、不动几何、不半途而废 ──────── */
    const assigned = await cdp.ev(`(async () => {
      const imp = await window.__kly.dispatch('asset.import', {
        name: 'logo-fixed.png', mime: 'image/png',
        dataUrl: 'data:image/png;base64,${LOGO_B64}', kind: 'image',
      });
      if (!imp.ok) return { ok: false, err: '资源导入失败：' + imp.error?.message };
      const assetId = imp.data.id;
      const one = await window.__kly.dispatch('asset.assign', { ids: [${JSON.stringify(logos[0]?.id ?? '')}], assetId });
      let p = window.__kly.state().project;
      const first = p.layers.find((l) => l.id === ${JSON.stringify(logos[0]?.id ?? '')});
      const geomAfterOne = { x: first.x, y: first.y, w: first.width, h: first.height };
      const batch = await window.__kly.dispatch('asset.assign', {
        ids: [${JSON.stringify(logos[0]?.id ?? '')}, ${JSON.stringify(logos[1]?.id ?? '')}], assetId,
      });
      p = window.__kly.state().project;
      const second = p.layers.find((l) => l.id === ${JSON.stringify(logos[1]?.id ?? '')});
      return {
        ok: one.ok && batch.ok, err: one.error?.message ?? batch.error?.message,
        assetId,
        firstAsset: first.assetId, secondAsset: second?.assetId,
        geomAfterOne, geomSecond: { x: second?.x, y: second?.y, w: second?.width, h: second?.height },
        assets: p.assets.length,
      };
    })()`);
    check('asset.assign 单个成功', assigned.ok, JSON.stringify({ e: assigned.err }));
    check('两层都挂上了新资源', assigned.firstAsset === assigned.assetId && assigned.secondAsset === assigned.assetId, JSON.stringify({ a: assigned.firstAsset, b: assigned.secondAsset }));
    check(
      '换资源不动位置和尺寸',
      assigned.geomAfterOne?.x === logos[0]?.x && assigned.geomAfterOne?.y === logos[0]?.y && assigned.geomAfterOne?.w === logos[0]?.w && assigned.geomSecond?.x === logos[1]?.x,
      JSON.stringify({ before: logos.map((l) => [l.x, l.y, l.w, l.h]), after: [assigned.geomAfterOne, assigned.geomSecond] }),
    );

    const guards = await cdp.ev(`(async () => {
      const vid = await window.__kly.dispatch('asset.import', {
        /* data URL 有 32 字符下限，太短的假数据连 schema 都过不了 */
        name: 'clip.mp4', mime: 'video/mp4', dataUrl: 'data:video/mp4;base64,' + 'A'.repeat(64), kind: 'video',
      });
      const mism = await window.__kly.dispatch('asset.assign', {
        ids: [${JSON.stringify(logos[0]?.id ?? '')}], assetId: vid.data?.id ?? 'as_missing',
      });
      const p1 = window.__kly.state().project;
      const keep = p1.layers.find((l) => l.id === ${JSON.stringify(logos[0]?.id ?? '')}).assetId;
      const ghost = await window.__kly.dispatch('asset.assign', { ids: ['ly_nope'], assetId: keep });
      const empty = await window.__kly.dispatch('asset.assign', { ids: [], assetId: keep });
      return {
        vidOk: vid.ok, vidKind: vid.data?.kind,
        mismOk: mism.ok, mismCode: mism.error?.code, mismMsg: mism.error?.message,
        keep, ghostOk: ghost.ok, ghostCode: ghost.error?.code, emptyOk: empty.ok,
      };
    })()`);
    check('（前置）造一个视频资源用来试类型冲突', guards.vidOk === true && guards.vidKind === 'video', JSON.stringify({ ok: guards.vidOk, kind: guards.vidKind }));
    check('视频资源挂到图片层被拒（VALIDATION）', guards.mismOk === false && guards.mismCode === 'VALIDATION', JSON.stringify(guards));
    check('被拒之后层的资源没被改掉', guards.keep === assigned.assetId, JSON.stringify({ keep: guards.keep, want: assigned.assetId }));
    check('不存在的图层报 NOT_FOUND', guards.ghostOk === false && guards.ghostCode === 'NOT_FOUND', JSON.stringify(guards));
    check('空 ids 被 schema 挡住', guards.emptyOk === false, String(guards.emptyOk));

    /* ── 6. 补完之后总账自己消失 ───────────────────────────── */
    await sleep(300);
    const after = await cdp.ev(`({
      marks: document.querySelectorAll('[data-testid="asset-gap-mark"]').length,
      banner: !!document.querySelector('[data-testid="asset-gap-banner"]'),
    })`);
    check('补上资源后标记与总账都消失', after.marks === 0 && after.banner === false, JSON.stringify(after));

    /* ── 7. 词条：新增文案一条都不能漏英文 ─────────────────── */
    const files = ['src/ui/Inspector.tsx', 'src/ui/LeftPanels.tsx', 'src/i18n/en.ts'];
    const missingEn = [];
    const enSrc = fs.readFileSync(path.join(process.cwd(), 'src/i18n/en.ts'), 'utf8');
    for (const rel of files.slice(0, 2)) {
      const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
      const keys = new Set();
      const re = /(?:t|title|label)\(\s*'((?:[^'\\]|\\.)*)'/g;
      let m;
      while ((m = re.exec(src))) if (/[\u4e00-\u9fff]/.test(m[1])) keys.add(m[1]);
      for (const k of keys) if (!enSrc.includes(`'${k}'`) && !enSrc.includes(`"${k}"`) && !enSrc.includes(`${k}:`)) missingEn.push(`${rel}: ${k}`);
    }
    /* 摊平以后拼中文的（'{n} 层缺资源'）走 t(key, params)，也会被上面扫到 */
    check('来源相关的新文案都有英文', missingEn.length === 0, JSON.stringify(missingEn.slice(0, 5)));

    /* ── 8. 英文模式：来源区块零中文 ───────────────────────── */
    /* 语言按钮的文字跟着当前语言变（中文模式显示「中」），所以按「中/EN 两个可能」找 */
    const switched = await realClick(cdp, `[...document.querySelectorAll('button')].find((b) => ['中', 'EN'].includes(b.textContent.trim()))`);
    await sleep(900);
    const hasBody = await cdp.ev(`!!document.querySelector('[data-testid="origin-body"]')`);
    let how = 'already-open';
    if (!hasBody) {
      const clicked = await realClick(cdp, findButton('Source'));
      const ok1 = await cdp.waitFor(`!!document.querySelector('[data-testid="origin-body"]')`, 1500);
      how = `real=${clicked}/${ok1}`;
      if (!ok1) {
        const c2 = await cdp.ev(`(() => {
          const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Source');
          if (!b) return 'no-btn';
          b.click();
          return 'clicked';
        })()`);
        const ok2 = await cdp.waitFor(`!!document.querySelector('[data-testid="origin-body"]')`, 1500);
        how += ` js=${c2}/${ok2}`;
      }
    }
    await sleep(300);
    const enText = await cdp.ev(`(() => {
      const el = document.querySelector('[data-testid="origin-body"]');
      if (!el) return null;
      const text = el.innerText;
      return { cjk: (text.match(/[\\u4e00-\\u9fff]/g) ?? []).length, sample: text.replace(/\\n/g, ' | ').slice(0, 180) };
    })()`);
    check('英文模式「来源」区块零中文', switched && !!enText && enText.cjk === 0, JSON.stringify(enText ?? { how }));
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
