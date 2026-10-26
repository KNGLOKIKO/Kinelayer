/**
 * v2.5c 阶段验收：HTML / GSAP 静态解析 + postMessage 时间同步 + origin 元信息。
 *
 * 规格里的硬要求，逐条对应到下面的 check：
 *   1. DOM 结构提取：绝对定位的文本/图片/容器变原生图层，位置尺寸样式都能改
 *   2. GSAP 时间线 → 原生 PropertyTrack（timeline 顺序累加 / delay / from 的起点）
 *   3. 流式布局的元素不猜位置，整块留成 html 代码层，报告里点明数量
 *   4. postMessage 时间同步：桥接脚本冻结动画、按 token 校验、按毫秒 seek
 *   5. origin 元信息：来源格式、解析器版本、远程依赖都记在图层上
 *   6. 新增的每一句报告文案都有英文（静态扫词条 + 英文模式下看报告卡）
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

/** 1×1 中性灰 PNG：测试图不能是红的（第一次排障就把它当成渲染 bug 了） */
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

/**
 * 一份「AI 生成的海报 HTML」样例。
 *
 * 刻意混进四种情况，一份样例把四条判定都覆盖：
 *   · 绝对定位 + 文本（h1/p）→ 原生文本层
 *   · 绝对定位 + 背景（div）→ canvas2d 盒子层
 *   · 绝对定位 + 图片（img，data URL）→ 原生图片层
 *   · 普通流（p.flow）→ 提不出来，留进 leftover
 * 再加一个远程 gsap CDN（测外部依赖识别）和一段 timeline（测轨道换算）。
 */
const FIXTURE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  body { width: 1080px; height: 1440px; margin: 0; background: #0b0b10; }
  .title { position: absolute; left: 90px; top: 120px; width: 900px; font-size: 96px; font-weight: 700; color: #ffffff; line-height: 1.1; }
  .sub { position: absolute; left: 90px; top: 320px; width: 700px; font-size: 40px; color: #9aa4b2; }
  .panel { position: absolute; left: 90px; top: 520px; width: 900px; height: 300px; background-color: #1b2230; border-radius: 24px; }
  .flow { font-size: 28px; color: #6b7280; }
</style>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
</head>
<body data-duration="5">
  <h1 id="title" class="title">Kinelayer</h1>
  <p id="sub" class="sub">Static HTML import</p>
  <div id="panel" class="panel"></div>
  <img id="logo" src="data:image/png;base64,${LOGO_B64}" style="position: absolute; left: 90px; top: 900px; width: 120px; height: 120px;">
  <p class="flow">flow layout line</p>
  <script>
    const tl = gsap.timeline();
    tl.to('#title', { y: 140, duration: 1, ease: 'power2.out' });
    tl.to('.sub', { opacity: 0, duration: 0.5 });
    gsap.from('#logo', { x: 60, duration: 0.8, delay: 0.2 });
  </script>
</body>
</html>`;

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

const main = async () => {
  const htmlPath = path.join(os.tmpdir(), `kly-html-${Date.now()}.html`);
  fs.writeFileSync(htmlPath, FIXTURE, 'utf8');

  const cdp = await launch({ url: base, width: 1440, height: 900 });
  try {
    const ready = await cdp.waitFor(`typeof window.__kly !== "undefined"`, 20000);
    check('dev 调试口就绪', ready);
    if (!ready) return;
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 12000);

    /* ── 1. 预检：报告来自真实解析 ─────────────────────────── */
    const inspected = await cdp.ev(`(async () => {
      const st = await window.__kly.stage(new File([${JSON.stringify(FIXTURE)}], 'poster.html', { type: 'text/html' }));
      const r = await window.__kly.dispatch('ai.inspectImport', { stageId: st.stageId });
      return { ok: r.ok, err: r.error?.message, report: r.data?.report };
    })()`);
    const rep = inspected.report ?? {};
    check(
      'HTML 预检跑通（不再是「整段代码层」）',
      inspected.ok && rep.format === 'html' && rep.supported === true,
      JSON.stringify({ ok: inspected.ok, f: rep.format, s: rep.supported, e: inspected.err }),
    );
    const c = rep.counts ?? {};
    check('统计：2 文本 + 1 图片 + 1 盒子 + 1 leftover 代码层', c.structured === 3 && c.media === 1 && c.code === 2, JSON.stringify(c));
    check('GSAP 的 3 条 tween 变成 3 条轨道、6 个关键帧', c.tracks === 3 && c.keyframes === 6, JSON.stringify({ t: c.tracks, k: c.keyframes }));
    check('画布尺寸从 body 的 CSS 读出来（1080×1440）', rep.preview?.width === 1080 && rep.preview?.height === 1440, JSON.stringify(rep.preview));
    check('时长按 data-duration 取（5s）', rep.preview?.duration === 5000, String(rep.preview?.duration));
    const noteKeys = (rep.notes ?? []).map((n) => n.key);
    check('报告点名了 GSAP 提取条数', noteKeys.some((k) => k.includes('提取了') && k.includes('GSAP')), JSON.stringify(noteKeys.slice(0, 4)));
    check('报告点名了远程依赖', noteKeys.some((k) => k.includes('远程资源')), JSON.stringify(noteKeys.slice(0, 6)));
    check('报告说明流式元素留在代码层', noteKeys.some((k) => k.includes('只认绝对定位')), JSON.stringify(noteKeys.slice(0, 6)));

    /* ── 2. 正式导入：图层 / 轨道 / 剩余层 ─────────────────── */
    const imported = await cdp.ev(`(async () => {
      const st = await window.__kly.stage(new File([${JSON.stringify(FIXTURE)}], 'poster.html', { type: 'text/html' }));
      const r = await window.__kly.dispatch('ai.importProject', { stageId: st.stageId });
      const p = window.__kly.state().project;
      const pick = (n) => p.layers.find((l) => l.name === n);
      const track = (n, prop) => {
        const l = pick(n);
        const t = (l?.animation?.tracks ?? []).find((x) => x.property === prop);
        return t ? { name: l.name, keys: t.keyframes.map((k) => [k.time, k.value]) } : null;
      };
      return {
        ok: r.ok, err: r.error?.message,
        width: p.width, height: p.height, duration: p.duration, fps: p.fps,
        layers: p.layers.length,
        names: p.layers.map((l) => l.name),
        texts: p.layers.filter((l) => l.type === 'text').map((l) => ({ name: l.name, text: l.text, x: l.x, y: l.y, w: l.width, h: l.height, fontSize: l.style.fontSize, color: l.style.color })),
        images: p.layers.filter((l) => l.type === 'image').map((l) => ({ name: l.name, x: l.x, y: l.y, w: l.width, h: l.height, assetId: l.assetId })),
        boxes: p.layers.filter((l) => l.type === 'code' && l.code.engine === 'canvas2d').map((l) => ({ name: l.name, x: l.x, y: l.y, w: l.width, h: l.height })),
        htmls: p.layers.filter((l) => l.type === 'code' && l.code.engine === 'html').map((l) => ({
          name: l.name,
          src: l.code.source.length,
          hasFlow: l.code.source.includes('flow layout line'),
          designW: l.code.params.designWidth,
          hasStyle: l.code.source.includes('<style>'),
          resetBg: /data-kly-reset>html,body\{background:([^ !]*)/.exec(l.code.source)?.[1] ?? '',
        })),
        bg: (p.layers.find((l) => l.type === 'background') ?? {}).color ?? '',
        yTitle: track('title', 'y'),
        oSub: track('sub', 'opacity'),
        xLogo: track('logo', 'x'),
        origin: pick('title')?.origin ?? null,
      };
    })()`);
    check('ai.importProject 认得 HTML', imported.ok, JSON.stringify({ ok: imported.ok, e: imported.err }));
    check('画布 1080×1440 / 时长 5s / 30fps', imported.width === 1080 && imported.height === 1440 && imported.duration === 5000 && imported.fps === 30, JSON.stringify({ w: imported.width, h: imported.height, d: imported.duration, f: imported.fps }));

    const title = (imported.texts ?? []).find((t) => t.name === 'title');
    check('标题变成可编辑文本层（文字/位置/字号/颜色都对）', !!title && title.text === 'Kinelayer' && title.x === 90 && title.y === 120 && title.fontSize === 96 && title.color === '#ffffff', JSON.stringify(title));
    const sub = (imported.texts ?? []).find((t) => t.name === 'sub');
    check('CSS class 里的样式被读到（.sub 的字号 40 / 颜色 #9aa4b2）', !!sub && sub.fontSize === 40 && sub.color === '#9aa4b2', JSON.stringify(sub));
    check('宽度取的是 CSS 里的 900px（不是整块画布）', title?.w === 900, String(title?.w));

    const logo = (imported.images ?? []).find((i) => i.name === 'logo');
    check('图片变成图片层，data URL 落地成资源', !!logo && !!logo.assetId && logo.x === 90 && logo.y === 900, JSON.stringify(logo));
    const panel = (imported.boxes ?? []).find((b) => b.name === 'panel');
    check('带背景的容器降级成 canvas2d 盒子层（位置尺寸对）', !!panel && panel.x === 90 && panel.y === 520 && panel.w === 900 && panel.h === 300, JSON.stringify(panel));

    check('流式元素整块留在 html 代码层', (imported.htmls ?? []).length === 1 && imported.htmls[0].hasFlow, JSON.stringify(imported.htmls));
    check('html 层记了设计稿尺寸（图层缩放不错位）', imported.htmls?.[0]?.designW === 1080, String(imported.htmls?.[0]?.designW));
    /*
     * leftover 只取 body.innerHTML 会丢掉 <style>，class 规则全失效；
     * iframe 再默认白底铺满画布，就把已经摆好的原生层整个盖住（截图一片白）。
     * 这两条必须都成立，缺一条画面就是错的。
     */
    check('leftover 带上了原 <style>（否则 class 规则全失效）', imported.htmls?.[0]?.hasStyle === true);
    /*
     * iframe 的白底去不掉（Chrome 里 html/body 写成 transparent 也没用，四个变体都试过），
     * 所以策略是「背景色 = 画布底色 + 收缩到内容包围盒」，两条缺一条画面就是错的。
     */
    check('iframe 背景色 = 画布底色（不是白的）', imported.htmls?.[0]?.resetBg === '#0b0b10', String(imported.htmls?.[0]?.resetBg));
    check('画布底色取自 body 的 background（不是写死黑）', imported.bg === '#0b0b10', String(imported.bg));

    /* ── 3. GSAP 轨道：时间与值 ─────────────────────────────── */
    /*
     * 注意 x / y 的语义：GSAP 里它们是 transform 位移，绝对值要叠上图层自己的位置。
     *   to('#title', { y: 140 })  → 120（原位）→ 260（120+140）
     *   from('#logo', { x: 60 })  → 150（90+60）→ 90（回到原位）
     * 拿 140 / 60 直接当终点，画面会跳到画布左上角 —— 这条踩过。
     */
    check(
      'timeline 第一条：title.y 120→260（位移叠上原位），0→1000ms',
      JSON.stringify(imported.yTitle?.keys) === JSON.stringify([[0, 120], [1000, 260]]),
      JSON.stringify(imported.yTitle),
    );
    check(
      'timeline 第二条接着排：sub.opacity 1→0，1000→1500ms',
      JSON.stringify(imported.oSub?.keys) === JSON.stringify([[1000, 1], [1500, 0]]),
      JSON.stringify(imported.oSub),
    );
    check(
      '独立的 gsap.from 带 delay：logo.x 150→90，200→1000ms',
      JSON.stringify(imported.xLogo?.keys) === JSON.stringify([[200, 150], [1000, 90]]),
      JSON.stringify(imported.xLogo),
    );

    /* ── 4. origin 元信息 ──────────────────────────────────── */
    const origin = imported.origin ?? {};
    check('来源格式标成 gsap（有真动画时不能只说 html）', origin.sourceFormat === 'gsap', String(origin.sourceFormat));
    check('记了解析器版本（将来规则升级能分辨新旧）', origin.parser === 'html-dom/1', String(origin.parser));
    check('远程依赖记进 origin.external', Array.isArray(origin.external) && origin.external.some((u) => u.includes('jsdelivr')), JSON.stringify(origin.external));

    /* ── 5. 编辑器：html 层用 sandbox iframe 渲染 ──────────── */
    const projectId = await cdp.ev(`window.__kly.state().project.id`);
    await cdp.conn.call('Page.navigate', { url: `${base}?view=editor&projectId=${projectId}` });
    await sleep(1800);
    await cdp.waitFor(`typeof window.__kly !== "undefined" && window.__kly.state().project.id === ${JSON.stringify(projectId)}`, 20000);

    const stage = await cdp.ev(`(async () => {
      /* 停到 1.2s：标题已经位移到 +140，副标题正在淡出 —— 截图能看出轨道真的在驱动 */
      await window.__kly.dispatch('timeline.seek', { time: 1200 });
      /* bounds 是 iframe 里 DOMContentLoaded 后才回传的，等它到 */
      await new Promise((r) => setTimeout(r, 1200));
      const frames = [...document.querySelectorAll('iframe[data-kly-token]')];
      const rows = [...document.querySelectorAll('[data-testid="layer-row"]')].map((r) => r.innerText);
      return {
        iframes: frames.length,
        sandbox: frames[0]?.getAttribute('sandbox') ?? '',
        hasBridge: (frames[0]?.getAttribute('srcdoc') ?? '').includes('data-kly-bridge'),
        tokenAttr: frames[0]?.getAttribute('data-kly-token') ?? '',
        frameW: parseFloat(frames[0]?.style.width ?? '0'),
        frameH: parseFloat(frames[0]?.style.height ?? '0'),
        frameOpacity: parseFloat(frames[0]?.style.opacity ?? '0'),
        rows,
        names: window.__kly.state().project.layers.map((l) => l.name),
      };
    })()`);
    check('编辑器里 html 层渲染成 iframe', stage.iframes === 1, String(stage.iframes));
    check('iframe 是 allow-scripts 且不含 allow-same-origin', /allow-scripts/.test(stage.sandbox) && !/allow-same-origin/.test(stage.sandbox), stage.sandbox);
    check('iframe 里注入了桥接脚本', stage.hasBridge === true);
    check('iframe 带 token（宿主据此校验消息来源）', /^kly[a-z0-9]+$/.test(stage.tokenAttr ?? ''), stage.tokenAttr);
    /*
     * 收缩的判据：样例里唯一留在 leftover 的是一行流式文本（约 1080×40），
     * 若没收到 bounds 会是整张 1080×1440 且 opacity 0。
     */
    check('iframe 收缩到内容包围盒（不是整张画布）', stage.frameH > 0 && stage.frameH < 200, `${stage.frameW}×${stage.frameH}`);
    check('量到包围盒后 iframe 才显示（之前 opacity 0，不闪白）', stage.frameOpacity === 1, String(stage.frameOpacity));
    check('图层树里 5 层都在（背景 + 文本×2 + 图片 + 盒子 + html）', stage.names.length === 6, JSON.stringify(stage.names));
    await cdp.shot(new URL('../docs/v25-html-import.png', import.meta.url));

    /* ── 6. 桥接脚本：token 校验与 seek（假 window 里跑） ──── */
    const bridge = await cdp.ev(`(async () => {
      const mod = await import('/src/render/htmlBridge.ts');
      const injected = mod.injectBridge('<html><head></head><body>x</body></html>', 'tok_abc');
      const body = /<script data-kly-bridge="[^"]*">([\\s\\S]*?)<\\/script>/.exec(injected)?.[1] ?? '';
      if (!body) return { ok: false, reason: 'no bridge body' };

      const sent = [];
      const listeners = {};
      const timeline = { t: 0, paused: false, pause() { this.paused = true; }, time(v) { this.t = v; return this; } };
      const win = { gsap: { globalTimeline: timeline }, addEventListener(type, fn) { (listeners[type] ??= []).push(fn); } };
      const doc = { getAnimations: () => [], addEventListener() {} };
      const par = { postMessage: (m) => sent.push(m) };
      const fakeInterval = () => 0;
      const fakeClear = () => {};

      /* 按 HTML 里的写法执行一遍：只给 window/document/parent/定时器 */
      new Function('window', 'document', 'parent', 'setInterval', 'clearInterval', body)(win, doc, par, fakeInterval, fakeClear);

      const fire = (data) => { for (const fn of listeners.message ?? []) fn({ data }); };
      const ready = sent.find((m) => m.type === 'ready');

      fire({ kly: 'wrong', type: 'time', ms: 800 });
      const afterWrong = timeline.t;
      fire({ kly: 'tok_abc', type: 'time', ms: 800 });
      const afterRight = timeline.t;
      const paused = timeline.paused;

      /* 换一份 HTML，验证 injectBridge 不重复注入 */
      const twice = mod.injectBridge(injected, 'tok_abc');
      return {
        ok: true,
        readyToken: ready?.kly ?? '',
        afterWrong, afterRight, paused,
        injectedOnce: (twice.match(/data-kly-bridge/g) ?? []).length,
        headFirst: injected.indexOf('data-kly-bridge') < injected.indexOf('</head>'),
      };
    })()`);
    check('桥接脚本能构造出来', bridge.ok === true, String(bridge.reason ?? ''));
    check('加载后主动发 ready（宿主据此开始推时间）', bridge.readyToken === 'tok_abc', String(bridge.readyToken));
    check('token 不对的消息一律忽略', bridge.afterWrong === 0, String(bridge.afterWrong));
    check('token 对了才 seek 到 0.8s', bridge.afterRight === 0.8, String(bridge.afterRight));
    check('seek 前先把 gsap 时间线冻结', bridge.paused === true);
    check('injectBridge 幂等（重复注入只有一份）', bridge.injectedOnce === 1, String(bridge.injectedOnce));
    check('桥接脚本插在 </head> 之前（先于用户脚本）', bridge.headFirst === true);

    /* ── 7. 词条覆盖：每条 HTML 报告文案都有英文 ────────────── */
    const src = fs.readFileSync(new URL('../src/core/htmlImport.ts', import.meta.url), 'utf8');
    const extra = fs.readFileSync(new URL('../src/core/importPipeline.ts', import.meta.url), 'utf8');
    const en = fs.readFileSync(new URL('../src/i18n/en.ts', import.meta.url), 'utf8');
    const grab = (text) => {
      const out = new Set();
      const re = /key:\s*'((?:[^'\\]|\\.)*)'|note\(\s*'((?:[^'\\]|\\.)*)'/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        const key = (m[1] ?? m[2] ?? '').replace(/\\'/g, "'");
        if (/[\u4e00-\u9fff]/.test(key)) out.add(key);
      }
      return out;
    };
    const keys = new Set([...grab(src)]);
    /* importPipeline 里属于 html 那几段的 key 也要算（preserve-code / leftover / 缺失资源） */
    for (const key of grab(extra)) {
      if (key.includes('HTML') || key.includes('图片地址')) keys.add(key);
    }
    const missing = [...keys].filter((k) => !en.includes(`'${k}'`) && !en.includes(`"${k}"`));
    check(`HTML 报告词条全部有英文（${keys.size} 条）`, missing.length === 0, missing.slice(0, 4).join(' | '));

    /* ── 8. 英文模式下报告卡真的没有中文 ───────────────────── */
    await cdp.conn.call('Page.navigate', { url: `${base}?view=launcher` });
    await sleep(1600);
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 10000);
    await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'EN');
      if (!b) return false; b.click(); return true;
    })()`);
    await sleep(700);
    const picked = await pickFile(cdp, htmlPath, 'Open local file');
    if (picked) {
      await cdp.waitFor(`!!document.querySelector('[data-testid="import-dialog"]')`, 12000);
      const enText = await cdp.ev(`(() => {
        const el = document.querySelector('[data-testid="import-dialog"]');
        const text = el?.innerText ?? '';
        return { cjk: (text.match(/[\\u4e00-\\u9fff]/g) ?? []).length, sample: text.replace(/\\n/g, ' / ').slice(0, 160) };
      })()`);
      check('英文模式 HTML 报告卡零中文', enText.cjk === 0, `${enText.cjk} 个汉字 · ${enText.sample}`);
    } else {
      check('英文模式 HTML 报告卡零中文', false, '没能唤起文件框');
    }
  } finally {
    cdp.edge.kill();
    fs.rmSync(htmlPath, { force: true });
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
