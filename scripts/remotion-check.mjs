/**
 * v2.5b 阶段验收：Remotion 工程导入 + remotion-kit 导出。
 *
 * 规格里这一阶段的硬要求，逐条对应到下面的 check：
 *   1. 静态 AST 解析：不执行导入的 TSX，只认结构（Sequence / 文字 / 图片 / 盒子）
 *   2. <Sequence> 的 from / durationInFrames 决定图层的时间范围
 *   3. interpolate / spring → 原生 PropertyTrack（spring 只能是近似，必须写在报告里）
 *   4. 认不出的自定义组件 → remotion-component 代码层，不假装能内部编辑
 *   5. 图层树标「AI 生成」+ 降级报告里每一句都能翻译（英文模式零中文）
 *   6. remotion-kit：真的能下下来、解开、每个 TSX 都能被 AST 解析、
 *      Root.tsx 里每层一个 Composition、README 给出 render 命令
 *
 * 需要 dev server 跑在 5273。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { launch, reporter, sleep } from './_cdp.mjs';

const base = 'http://localhost:5273/';
const { check, finish } = reporter();

/**
 * 1×1 PNG 生成器。
 *
 * 不用现成的 base64 常量：手上那几个「1×1」其实是**红色半透明**像素，
 * 铺满画布后截图一片红，第一次排障就把它当成渲染 bug 了。
 * 这里自己拼：中性灰、不透明，放大成占位块也不误导人。
 */
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
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

const LOGO_PNG = png1x1(120, 124, 140, 255);

/**
 * 造一个「Remotion Agent Skills 风格」的小工程：
 * Root + 一个 Inro 组件（4 个 Sequence：文本/盒子/图片/spring 文本）+ 一个自定义组件。
 * 组件名和文案全 ASCII —— 英文模式的「零中文」断言要只指向 UI 文案。
 */
function buildFixtureZip() {
  const files = {
    'package.json': strToU8(
      JSON.stringify(
        {
          name: 'remotion-demo',
          version: '1.0.0',
          private: true,
          dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', remotion: '^4.0.0' },
          devDependencies: { '@remotion/cli': '^4.0.0' },
        },
        null,
        2,
      ),
    ),
    'src/index.ts': strToU8(`import { registerRoot } from 'remotion';\nimport { RemotionRoot } from './Root';\n\nregisterRoot(RemotionRoot);\n`),
    'src/Root.tsx': strToU8(`import React from 'react';
import { Composition } from 'remotion';
import { Intro } from './Intro';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="Intro" component={Intro} durationInFrames={210} fps={30} width={1920} height={1080} />
    </>
  );
};
`),
    'src/Intro.tsx': strToU8(`import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { ParticleField } from './ParticleField';

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: '#0b0e14' }}>
      <Sequence from={0} durationInFrames={90}>
        <h1 style={{ fontSize: 96, fontWeight: 800, color: '#ffffff', opacity: interpolate(frame, [0, 30], [0, 1]) }}>
          Kinelayer
        </h1>
      </Sequence>
      <Sequence from={10} durationInFrames={100}>
        <div style={{ backgroundColor: 'rgba(124,92,255,0.18)', borderRadius: 24, width: 480, height: 120 }} />
      </Sequence>
      <Sequence from={20} durationInFrames={140}>
        <Img src={staticFile('assets/logo.png')} style={{ width: 240, height: 240 }} />
      </Sequence>
      <Sequence from={30} durationInFrames={150}>
        <p style={{ fontSize: 36, color: '#9aa4b2', opacity: spring({ frame, fps, config: { damping: 200 } }) }}>
          AI code video
        </p>
      </Sequence>
      <Sequence from={60} durationInFrames={100}>
        <ParticleField count={80} />
      </Sequence>
    </AbsoluteFill>
  );
};
`),
    'src/ParticleField.tsx': strToU8(`import React from 'react';
import { useCurrentFrame } from 'remotion';

export const ParticleField: React.FC<{ count: number }> = ({ count }) => {
  const frame = useCurrentFrame();
  const dots = new Array(count).fill(0).map((_, i) => {
    const angle = i * 2.399 + frame * 0.02;
    return <div key={i} style={{ position: 'absolute', left: 960 + Math.cos(angle) * 300, top: 540 + Math.sin(angle) * 300 }} />;
  });
  return <div>{dots}</div>;
};
`),
    'public/assets/logo.png': LOGO_PNG,
  };
  return zipSync(files, { level: 6 });
}

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

async function pickFile(cdp, filePath, buttonText) {
  await cdp.conn.call('Page.setInterceptFileChooserDialog', { enabled: true });
  const chooser = cdp.conn.once('Page.fileChooserOpened');
  const clicked = await realClick(cdp, findButton(buttonText));
  const info = await Promise.race([chooser, sleep(5000).then(() => null)]);
  if (!clicked || !info?.backendNodeId) return false;
  await cdp.conn.call('DOM.setFileInputFiles', { files: [filePath], backendNodeId: info.backendNodeId });
  return true;
}

async function waitFile(dir, re, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const hit = fs.readdirSync(dir).find((n) => re.test(n));
    if (hit) {
      const full = path.join(dir, hit);
      const size = fs.statSync(full).size;
      if (size > 0) return full;
    }
    await sleep(250);
  }
  return null;
}

const main = async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kly-remotion-'));
  const zipPath = path.join(tmp, 'remotion-demo.zip');
  fs.writeFileSync(zipPath, buildFixtureZip());
  const downloads = path.join(tmp, 'downloads');
  fs.mkdirSync(downloads, { recursive: true });

  /*
   * 从启动页根路径起：`?view=launcher` 会被 EditorApp 接管，它在没有 projectId/lastProjectId 时
   * 会 go('/') 跳走 —— 拿那个地址跑命令层断言，等于让导入和 boot 抢页面。
   */
  const cdp = await launch({ url: base, width: 1440, height: 900 });
  try {
    const ready = await cdp.waitFor(`typeof window.__kly !== "undefined"`, 20000);
    check('dev 调试口就绪', ready);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 12000);
    if (!ready) return;

    /* ── 1. 预检：报告来自真实解析，不是「明确拒绝」 ───────── */
    const b64 = fs.readFileSync(zipPath).toString('base64');
    const inspected = await cdp.ev(`(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'remotion-demo.zip', { type: 'application/zip' });
      const st = await window.__kly.stage(file);
      const r = await window.__kly.dispatch('ai.inspectImport', { stageId: st.stageId });
      return { ok: r.ok, err: r.error?.message, report: r.data?.report, importable: r.data?.importable };
    })()`);
    check('Remotion 预检能跑通（不再是「不支持」）', inspected.ok && inspected.report?.format === 'remotion' && inspected.report?.supported === true, JSON.stringify({ ok: inspected.ok, f: inspected.report?.format, s: inspected.report?.supported, e: inspected.err }));
    const ic = inspected.report?.counts ?? {};
    check('预检统计：2 文本 + 1 图片 / 2 盒子 + 1 remotion 代码层', ic.structured === 3 && ic.media === 1 && ic.code === 3, JSON.stringify(ic));
    check('interpolate / spring 的关键帧被解析成轨道', ic.tracks >= 2 && ic.keyframes >= 3, JSON.stringify({ tracks: ic.tracks, keyframes: ic.keyframes }));
    check('报告里点名了 spring 是近似', (inspected.report?.notes ?? []).some((n) => n.key.includes('spring')), JSON.stringify((inspected.report?.notes ?? []).map((n) => n.key).slice(0, 6)));
    check('Composition 元信息（1920×1080 · 30fps · 7s）', inspected.report?.preview?.width === 1920 && inspected.report?.preview?.fps === 30 && inspected.report?.preview?.duration === 7000, JSON.stringify(inspected.report?.preview));

    /* ── 2. 正式导入：结构化层 + remotion 代码层 ─────────────── */
    const imported = await cdp.ev(`(async () => {
      const bytes = Uint8Array.from(atob(${JSON.stringify(b64)}), (c) => c.charCodeAt(0));
      const file = new File([bytes], 'remotion-demo.zip', { type: 'application/zip' });
      const st = await window.__kly.stage(file);
      const r = await window.__kly.dispatch('ai.importProject', { stageId: st.stageId });
      const p = window.__kly.state().project;
      return {
        ok: r.ok, err: r.error?.message, data: r.data,
        layers: p.layers.length,
        texts: p.layers.filter((l) => l.type === 'text').map((l) => ({ text: l.text, in: l.inPoint, out: l.outPoint })),
        images: p.layers.filter((l) => l.type === 'image').map((l) => ({ assetId: l.assetId, in: l.inPoint })),
        remotion: p.layers.filter((l) => l.type === 'code' && l.code.engine === 'remotion-component').map((l) => ({
          name: l.name,
          engine: l.code.engine,
          mode: l.code.runtime?.previewMode,
          comp: l.code.runtime?.compositionId,
          sources: (l.code.runtime?.sources ?? []).length,
          hasCode: (l.code.source ?? '').includes('export const '),
        })),
        box: p.layers.filter((l) => l.type === 'code' && l.code.engine === 'canvas2d').length,
        origins: [...new Set(p.layers.filter((l) => l.origin).map((l) => l.origin.sourceFormat))],
        generators: [...new Set(p.layers.filter((l) => l.origin).map((l) => l.origin.generator))],
        tracks: p.layers.map((l) => (l.animation?.tracks ?? []).length).reduce((a, b) => a + b, 0),
        fps: p.fps, duration: p.duration, width: p.width, height: p.height,
        assets: p.assets.length,
      };
    })()`);
    check('ai.importProject 认得 Remotion 工程', imported.ok && imported.data?.format === 'remotion', JSON.stringify({ ok: imported.ok, f: imported.data?.format, e: imported.err }));
    check('文字层变成可编辑图层', (imported.texts ?? []).length >= 2 && (imported.texts ?? []).some((t) => t.text === 'Kinelayer'), JSON.stringify(imported.texts));
    check(
      'Sequence 的 from / durationInFrames 落成 in/out 时间（0→3000 / 1000→6000）',
      (imported.texts ?? []).some((t) => t.text === 'Kinelayer' && t.in === 0 && t.out === 3000) &&
        (imported.texts ?? []).some((t) => t.text === 'AI code video' && t.in === 1000 && t.out === 6000),
      JSON.stringify(imported.texts),
    );
    check('图片层找到了包里那张图（assetId 不是 null）', (imported.images ?? []).length === 1 && !!imported.images[0].assetId, JSON.stringify(imported.images));
    check('盒子容器（AbsoluteFill 底 + div）降级成 canvas2d 代码层', imported.box === 2, String(imported.box));
    check(
      '自定义组件保留为 remotion-component 层（源码在，不执行）',
      (imported.remotion ?? []).length === 1 && imported.remotion[0].name === 'ParticleField' && imported.remotion[0].hasCode,
      JSON.stringify(imported.remotion),
    );
    check('没有代理视频 → 静态首帧预览', imported.remotion?.[0]?.mode === 'static-first-frame', String(imported.remotion?.[0]?.mode));
    check('原工程源码树随层保存（kit 才能重建成片）', (imported.remotion?.[0]?.sources ?? 0) >= 4, String(imported.remotion?.[0]?.sources));
    check('每一层都标了来源 remotion + AI 生成', JSON.stringify(imported.origins) === JSON.stringify(['remotion']) && JSON.stringify(imported.generators) === JSON.stringify(['ai']), JSON.stringify({ o: imported.origins, g: imported.generators }));
    check('画布/帧率/时长按 Composition 还原', imported.width === 1920 && imported.height === 1080 && imported.fps === 30 && imported.duration === 7000, JSON.stringify({ w: imported.width, h: imported.height, f: imported.fps, d: imported.duration }));

    /* ── 3. 图层树 / 检查器：remotion 徽标 + 只读提示 ────────── */
    /* 命令层验完再进编辑器：启动页不画图层树，徽标只能在 EditorApp 里看 */
    const importedId = await cdp.ev(`window.__kly.state().project.id`);
    await cdp.conn.call('Page.navigate', { url: `${base}?view=editor&projectId=${importedId}` });
    await sleep(1600);
    await cdp.waitFor(`typeof window.__kly !== "undefined" && window.__kly.state().project.id === ${JSON.stringify(importedId)}`, 20000);

    const tree = await cdp.ev(`(() => {
      const rows = [...document.querySelectorAll('[data-testid="layer-row"]')].map((r) => r.innerText);
      const remotion = rows.find((r) => /ParticleField/.test(r)) ?? '';
      return { rows: rows.length, remotion, badges: (remotion.match(/remotion|code/g) ?? []) };
    })()`);
    check('图层树给 remotion 层单独的徽标（不是笼统的 code）', tree.badges.includes('remotion'), JSON.stringify(tree.remotion));
    /* 停到 2s 再截图：标题的 opacity 是 0→1 的插值，第 0 帧本来就是全透明的 */
    const seeked = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('timeline.seek', { time: 2000 });
      return { ok: r.ok, playhead: window.__kly.state().runtime.playhead };
    })()`);
    check('时间轴能停到 2s（轨道真的在驱动画面）', seeked.ok && seeked.playhead === 2000, JSON.stringify(seeked));
    /* UI 截图（含图层树徽标） */
    await cdp.shot(new URL('../docs/v25-remotion-import.png', import.meta.url));

    /*
     * 纯画面截图走 query.capture（离屏渲染）：
     * 舞台截图会带上选中高亮/安全区等编辑期叠加层，看起来像「渲染坏了」。
     */
    const frame = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('query.capture', { maxWidth: 960, time: 2000 });
      return r.ok ? r.data.dataUrl : null;
    })()`);
    if (frame) {
      fs.writeFileSync(
        new URL('../docs/v25-remotion-frame.png', import.meta.url),
        Buffer.from(String(frame).split(',')[1] ?? '', 'base64'),
      );
    }
    check('能离屏截一帧纯画面（导出链路也吃这套渲染）', !!frame, String(frame ? 'ok' : 'no-frame'));

    /* ── 4. scene.ai.json：带 remotion 元信息、仍不含 base64 ── */
    const sceneOut = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('ai.exportProject', { includeCode: false });
      const scene = JSON.parse(r.data.text);
      const layer = scene.layers.find((l) => l.type === 'code' && l.engine === 'remotion-component');
      return { ok: r.ok, engines: scene.capabilities?.availableEngines ?? [], layer, hasBase64: /data:[a-z/+]+;base64/i.test(r.data.text), limitations: scene.capabilities?.limitations ?? [] };
    })()`);
    check('scene.ai.json 声明了 remotion-component 引擎', (sceneOut.engines ?? []).includes('remotion-component'), JSON.stringify(sceneOut.engines));
    check('remotion 层带 composition / 预览模式 / 源码文件数', !!sceneOut.layer?.remotion?.compositionId && sceneOut.layer.remotion.sourceFiles >= 4, JSON.stringify(sceneOut.layer?.remotion));
    check('scene.ai.json 仍不含 base64（源码树没被塞进去）', sceneOut.hasBase64 === false);
    check('能力清单写明 remotion 不在浏览器渲染', (sceneOut.limitations ?? []).includes('remotion-not-rendered-in-browser'));

    /* ── 5. remotion-kit：真的下下来 ─────────────────────── */
    await cdp.conn.call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    const kitInfo = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('ai.exportRemotionKit', { download: true });
      return { ok: r.ok, err: r.error?.message, data: r.data };
    })()`);
    check('ai.exportRemotionKit 成功', kitInfo.ok === true, kitInfo.err ?? '');
    check('kit 里每层一个 Composition', (kitInfo.data?.compositions ?? []).length === 1, JSON.stringify(kitInfo.data?.compositions));
    check('kit 带上了原工程源码树', kitInfo.data?.hasOriginalTree === true, String(kitInfo.data?.hasOriginalTree));

    const kitPath = await waitFile(downloads, /\.remotion-kit\.zip$/);
    check('kit ZIP 真的落盘了', !!kitPath, kitPath ?? 'no-file');
    if (kitPath) {
      const entries = unzipSync(new Uint8Array(fs.readFileSync(kitPath)));
      const names = Object.keys(entries).sort();
      const has = (n) => names.includes(`remotion-kit/${n}`);
      check('kit 结构：package.json / src/Root.tsx / src/index.ts / README.md', has('package.json') && has('src/Root.tsx') && has('src/index.ts') && has('README.md'), names.slice(0, 8).join(', '));
      check('kit 里每层一个 entry.tsx', names.some((n) => /^remotion-kit\/src\/layers\/.+\/entry\.tsx$/.test(n)), names.filter((n) => n.includes('/layers/')).join(', '));
      check('kit 带原工程源码（Intro.tsx / ParticleField.tsx）', has('src/original/src/Intro.tsx') && has('src/original/src/ParticleField.tsx'), names.filter((n) => n.includes('original')).join(', '));
      check('kit 带图片资源 public/assets/logo.png', has('public/assets/logo.png'), names.filter((n) => n.includes('assets')).join(', '));

      const pkg = JSON.parse(Buffer.from(entries['remotion-kit/package.json']).toString('utf8'));
      check('package.json 只有 remotion 侧依赖', !!pkg.dependencies?.remotion && pkg.dependencies?.remotion !== undefined && Object.keys(pkg.dependencies).length <= 4, JSON.stringify(Object.keys(pkg.dependencies ?? {})));

      const root = Buffer.from(entries['remotion-kit/src/Root.tsx']).toString('utf8');
      check('Root.tsx 注册了 Composition 且组件名合法', /<Composition/.test(root) && /import Layer\d+ from '\.\/layers\//.test(root), root.slice(0, 120));
      const readme = Buffer.from(entries['remotion-kit/README.md']).toString('utf8');
      check('README 给出 npx remotion render 命令', /npx remotion render/.test(readme));

      /* 生成物必须真的是能解析的 TSX —— 语法错了，外部 render 一定挂 */
      const entryName = names.find((n) => /^remotion-kit\/src\/layers\/.+\/entry\.tsx$/.test(n));
      const parser = await import('@babel/parser');
      const parse = parser.parse ?? parser.default?.parse;
      let syntax = 'ok';
      try {
        parse(Buffer.from(entries[entryName]).toString('utf8'), { sourceType: 'module', plugins: ['jsx', 'typescript'] });
        parse(root, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
      } catch (err) {
        syntax = err.message;
      }
      check('kit 里的 TSX 语法合法（AST 解析通过）', syntax === 'ok', syntax);
      const entrySrc = Buffer.from(entries[entryName]).toString('utf8');
      check('entry.tsx 一定有 default export（否则 Root import 不到）', /export\s+default/.test(entrySrc), entrySrc.slice(-80));
    }

    /* ── 6. 英文模式：报告与检查器不能有中文 ─────────────────── */
    await cdp.conn.call('Page.navigate', { url: `${base}?view=launcher` });
    await sleep(1600);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 10000);
    await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'EN');
      if (!b) return false; b.click(); return true;
    })()`);
    await sleep(700);
    const picked = await pickFile(cdp, zipPath, 'Open local file');
    if (picked) {
      await cdp.waitFor(`!!document.querySelector('[data-testid="import-dialog"]')`, 12000);
      const en = await cdp.ev(`(() => {
        const el = document.querySelector('[data-testid="import-dialog"]');
        const text = el?.innerText ?? '';
        return { cjk: (text.match(/[\\u4e00-\\u9fff]/g) ?? []).length, sample: text.replace(/\\n/g, ' / ').slice(0, 140) };
      })()`);
      check('英文模式 Remotion 报告卡零中文', en.cjk === 0, `${en.cjk} 个汉字 · ${en.sample}`);
    } else {
      check('英文模式 Remotion 报告卡零中文', false, '没能唤起文件框');
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
