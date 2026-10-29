#!/usr/bin/env node
/**
 * 代码层运行时隔离 · 黄金基线（capture / verify 两个子命令）
 *
 * 为什么要有它：v2.17 要把代码层从「主线程 new Function 直接画到目标画布」
 * 挪到 CodeRuntime 接口后面（后续阶段还会挪进 Worker）。重构的验收标准是
 * **画面零差异**，而「零差异」不能靠肉眼看截图，得有一份逐帧的指纹。
 *
 * 指纹怎么取：
 *   __kly.frame(ms) 走的是导出那条 renderToCanvas（= prepare + renderScene），
 *   跟预览、导出同一个渲染函数。拿到的 PNG 在页面里解码回原始 RGBA，
 *   对像素字节做 SHA-256 —— 哈希的是**像素**不是 PNG 字节，
 *   所以编码器换个压缩参数不会造成假差异。
 *
 * 覆盖（三份，按 v2.17 任务书要求）：
 *   code2d     —— 2D 代码层（示例工程「图层树」段）
 *   glsl       —— GLSL 片元着色器（示例工程「引爆」段）
 *   motionblur —— 2D 代码层 + 4 子帧运动模糊（子帧超采样路径）
 *   imported   —— 导入工程（HTML 绝对定位元素 → 图片/文本层）
 *
 * 每份拍两张表：
 *   full  —— 整帧（合成路径：背景 + 全部图层 + 混合模式）
 *   solo  —— 只留目标层（把其余图层全部隐藏），把差异定位到某一层身上
 *
 * 用法：
 *   node scripts/code-baseline.mjs capture     # 生成/覆盖 docs/baseline/code-runtime.json
 *   node scripts/code-baseline.mjs verify      # 与基线逐帧比对，有差异退出码 1
 *   node scripts/code-baseline.mjs capture --out /tmp/x.json
 *
 * 前置：dev server 跑在 5273（`npm run dev`；或直接 `npm test`，它会自己起）。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { launch, reporter, sleep } from './_cdp.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = process.env.KLY_BASE ?? 'http://localhost:5273/';
const DEFAULT_OUT = path.join(ROOT, 'docs', 'baseline', 'code-runtime.json');
const SHOT_DIR = path.join(ROOT, '.workbuddy', 'tmp', 'baseline');

const REVISION = 'prj_sample_revision';

/**
 * 场景表。时间点都不是随手挑的：
 *   · code2d 取「图层树」段中段，那一层每帧都在重排整张卡片，字与框都在动
 *   · glsl   取引爆段三处（起爆/峰值/收尾），着色器只有 u_time 一个输入
 *   · motionblur 取叠层同一段：4 子帧 × 44ms 快门，走的是另一条分支
 *   · imported 取导入后的前 1.2 秒
 */
const SCENES = [
  {
    key: 'code2d',
    note: '2D 代码层 · 示例工程「图层树」段（ly_rev_2_0）',
    project: REVISION,
    layer: 'ly_rev_2_0',
    times: [12_600, 15_000, 18_000],
  },
  {
    key: 'glsl',
    note: 'GLSL 片元着色器 · 示例工程「引爆」段（ly_rev_6_0，renderScale 0.5）',
    project: REVISION,
    layer: 'ly_rev_6_0',
    times: [41_700, 43_000, 44_600],
  },
  {
    key: 'motionblur',
    note: '2D 代码层 + 4 子帧运动模糊（ly_rev_6_1，shutter 44ms）',
    project: REVISION,
    layer: 'ly_rev_6_1',
    times: [41_900, 43_400],
  },
  {
    key: 'imported',
    note: '导入工程（HTML 绝对定位：标题 / 三块色块 / 一张内联 PNG）',
    project: null,
    layer: null,
    times: [0, 500, 1_200],
  },
];

/* ────────────────────────────────────────── 1×1 PNG（导入样本用） */

function png1x1(r, g, b) {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = zlib.deflateSync(Buffer.from([0, r, g, b]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', raw),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 导入样本：只用绝对定位元素 —— 流式布局解析器不碰，那部分会进 leftover。
 *
 *  `<img>` 必须是**独立的绝对定位元素**，不能包在 div 里：包在 div 里时解析器
 *  会既切出一个图片层、又把外层结构留给「HTML 剩余结构」层，那一层走 iframe 栅格化，
 *  而 iframe 里加载的图片会把导出画布打成 tainted（toDataURL 直接抛 SecurityError）。
 *  这是另一条线的问题，本单不碰，样本绕开它并在回信里记一笔。
 */
const IMPORT_FIXTURE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #10131c; width: 1080px; height: 1350px; }
  .box { position: absolute; }
</style></head><body>
  <div class="box" style="left:80px;top:90px;width:920px;height:220px;background:#1b2233;border-radius:18px"></div>
  <div class="box" style="left:80px;top:340px;width:440px;height:300px;background:#2b3a5c;border-radius:14px"></div>
  <div class="box" style="left:560px;top:340px;width:440px;height:300px;background:#3d2b5c;border-radius:14px"></div>
  <img class="box" style="left:80px;top:680px;width:200px;height:200px" src="data:image/png;base64,${png1x1(120, 196, 255).toString('base64')}">
  <div class="box" style="left:320px;top:700px;width:600px;height:60px;background:#e8ecf6;border-radius:8px"></div>
  <div class="box" style="left:320px;top:790px;width:420px;height:34px;background:#8f9ab5;border-radius:6px"></div>
</body></html>`;

/* ────────────────────────────────────────── 页面侧：取一帧的像素指纹 */

/** 在页面里执行：渲染一帧 → 解码 PNG → 对原始 RGBA 求 SHA-256 */
const FRAME_HASH = (ms) => `(async () => {
  const url = await window.__kly.frame(${ms}, 1);
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { width: c.width, height: c.height, sha: hex, url };
})()`;

const ready = async (cdp) => cdp.waitFor('typeof window.__kly !== "undefined" && !!window.__kly.meta()', 30_000);

/**
 * 导航到一个**确实是新文档**的页面。
 *
 * 踩过：`Page.navigate` 到当前同一个 URL（三份场景共用一份示例工程）时，命令一返回
 * 旧文档还在跑，`window.__kly` 也还在 —— 于是 `ready()` 立刻为真，采集落在旧页面上。
 * 旧页面刚被 solo 阶段隐藏过图层，于是同一个时刻会得到两张不同的稳定画面，
 * 表现为「每隔几次 verify 就有一帧差」的假阳性。
 *
 * 判据用 `performance.now()`：新文档只有几百毫秒，旧文档早就几十秒了。
 */
const navFresh = async (cdp, url) => {
  await cdp.conn.call('Page.navigate', { url });
  for (let i = 0; i < 80; i += 1) {
    try {
      const t = await cdp.ev('typeof performance === "undefined" ? -1 : performance.now()');
      if (typeof t === 'number' && t >= 0 && t < 8_000) return;
    } catch {
      /* 导航瞬间可能拿不到执行上下文，等下一轮 */
    }
    await sleep(150);
  }
  throw new Error(`导航后没等到新文档：${url}`);
};

/** 只留一个图层：其余全部隐藏（背景是工程级的，不受影响） */
const soloize = async (cdp, layerId) => {
  const ids = await cdp.ev('window.__kly.state().project.layers.map((l) => l.id).filter((id) => id !== ' + JSON.stringify(layerId) + ')');
  for (const id of ids) {
    await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('layer.setVisible', { id: ${JSON.stringify(id)}, visible: false });
      return r.ok;
    })()`);
  }
  await sleep(120);
  return ids.length;
};

/**
 * 打开一份工程，并且**确认打开的就是它**。
 *
 * 踩过两次同一个坑：`?projectId=` 找不到时，编辑器会退回到上次打开的工程
 * （甚至一个空工程），页面照样「就绪」，于是采集出来的是一张只有背景的帧 ——
 * 而且不同时刻的背景一模一样，哈希也一模一样。表现就是「某一帧偶尔不同」，
 * 看起来像渲染有差异，其实是采错了工程。所以这里必须核对 id，不匹配就重来。
 */
async function openScene(cdp, projectId) {
  const url = projectId ? `${BASE}?view=editor&projectId=${encodeURIComponent(projectId)}` : BASE;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await navFresh(cdp, url);
    if (!(await ready(cdp))) continue;
    if (!projectId) return true;
    if (attempt === 0) {
      /* 示例工程不在库里时先塞一份（幂等，同版本不重塞） */
      await cdp.ev(`(async () => { await window.__kly.dispatch('project.seedSample', {}); return true; })()`);
    }
    /* 轮询而不是取一次：新文档起来的那一刻 state().project 还是兜底工程，
       立刻读会读到「不是我」，于是白重开一轮 */
    const ok = await cdp.waitFor(`typeof window.__kly !== "undefined" && window.__kly.state().project.id === ${JSON.stringify(projectId)}`, 5_000);
    if (ok) return true;
    console.log(`    （第 ${attempt + 1} 次落到别的工程上，重开）`);
  }
  throw new Error(`没能打开工程：${projectId}`);
}

/** 导入样本工程，返回 projectId */
async function importFixture(cdp) {
  await openScene(cdp, null);
  /* 导入是从启动页发起的：等它挂载完再灌文件 */
  if (!(await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 15_000))) {
    throw new Error('启动页没就绪');
  }
  const res = await cdp.ev(`(async () => {
    const st = await window.__kly.stage(new File([${JSON.stringify(IMPORT_FIXTURE)}], 'baseline.html', { type: 'text/html' }));
    const r = await window.__kly.dispatch('ai.importProject', { stageId: st.stageId });
    return { ok: r.ok, id: window.__kly.state().project.id, err: r.ok ? null : String(r.error && r.error.message) };
  })()`);
  if (!res?.ok || !res.id) throw new Error(`导入失败：${JSON.stringify(res)}`);
  await navFresh(cdp, `${BASE}?view=editor&projectId=${encodeURIComponent(res.id)}`);
  if (!(await ready(cdp))) throw new Error('导入后的工程没打开');
  return res.id;
}

/**
 * 空跑一次同一时刻。
 *
 * 为什么需要：**首帧不稳**。第一次渲染会付字体加载、着色器首次编译、第一张
 * 离屏画布分配的钱，而且代码层的 `state` 也会跟着往前走一步 —— 实测 4 次独立
 * verify 里有 1 次在场景首帧差了几个像素。基线要的是稳态，不是冷启动。
 * 所以每个时刻连渲两次，只记第二次。
 */
const WARM_FRAME = (ms) => `(async () => {
  await window.__kly.frame(${ms}, 1);
  return true;
})()`;

/** 对一张表（full / solo）逐时刻取指纹。pid 只用来兜底核对：采错工程比采出错更隐蔽 */
async function captureTable(cdp, scene, kind, pid) {
  const rows = [];
  for (const ms of scene.times) {
    /* 每帧都核一次：万一中途跳走了，宁可报错也不要采到别人的画面 */
    const now = await cdp.ev('window.__kly.state().project.id');
    if (now !== pid) throw new Error(`${scene.key}/${kind} @${ms}ms 采到了别的工程：${now} ≠ ${pid}`);
    await cdp.ev(WARM_FRAME(ms), 120_000);
    const got = await cdp.ev(FRAME_HASH(ms), 120_000);
    if (!got?.sha) throw new Error(`${scene.key}/${kind} @${ms}ms 取指纹失败`);
    const file = path.join(SHOT_DIR, `${scene.key}-${kind}-${ms}.png`);
    fs.writeFileSync(file, Buffer.from(got.url.split(',')[1], 'base64'));
    rows.push({
      ms,
      width: got.width,
      height: got.height,
      /* 像素指纹（判等用） */
      sha: got.sha,
      /* PNG 字节指纹（仅记录，不参与判等：编码器参数变化不该算画面差异） */
      png: createHash('sha256').update(got.url).digest('hex').slice(0, 16),
    });
  }
  return rows;
}

/* ────────────────────────────────────────── 主流程 */

const mode = process.argv[2] ?? 'capture';
const outArg = process.argv.indexOf('--out');
const OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : DEFAULT_OUT;

if (mode !== 'capture' && mode !== 'verify') {
  console.error(`用法：node scripts/code-baseline.mjs <capture|verify> [--out 文件]`);
  process.exit(2);
}

fs.mkdirSync(SHOT_DIR, { recursive: true });
const { check, finish } = reporter();
const cdp = await launch({ url: BASE });

try {
  const result = { schema: 1, base: BASE, project: REVISION, scenes: [] };

  for (const scene of SCENES) {
    console.log(`\n· ${scene.key} —— ${scene.note}`);
    const pid = scene.project ?? (await importFixture(cdp));
    await openScene(cdp, pid);

    /* full：整帧 */
    const full = await captureTable(cdp, scene, 'full', pid);
    let solo = null;
    if (scene.layer) {
      /* solo：把别的层全关掉再看一次。`layer.setVisible` 是命令，改的是工程数据，
         所以看完要重新载入工程才回到原样（下面 openScene 会重来一遍）。 */
      const hidden = await soloize(cdp, scene.layer);
      solo = await captureTable(cdp, scene, 'solo', pid);
      console.log(`   solo：隐藏其余 ${hidden} 层`);
      await openScene(cdp, pid);
    }
    result.scenes.push({ key: scene.key, note: scene.note, project: pid, layer: scene.layer ?? null, full, solo });
  }

  if (mode === 'capture') {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
    const frames = result.scenes.reduce((n, s) => n + s.full.length + (s.solo?.length ?? 0), 0);
    console.log(`\n基线已写入 ${path.relative(ROOT, OUT)}：${result.scenes.length} 份场景 / ${frames} 帧`);
    check('基线采集', true, `${frames} 帧`);
  } else {
    if (!fs.existsSync(OUT)) throw new Error(`找不到基线文件：${OUT}`);
    const base = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    let diffs = 0;
    for (const scene of result.scenes) {
      const old = base.scenes.find((s) => s.key === scene.key);
      if (!old) {
        check(`${scene.key} 基线存在`, false, '基线里没有这份场景');
        continue;
      }
      for (const kind of ['full', 'solo']) {
        const now = scene[kind];
        const before = old[kind];
        if (!now || !before) continue;
        if (now.length !== before.length) {
          check(`${scene.key}/${kind} 帧数`, false, `${before.length} → ${now.length}`);
          diffs += 1;
          continue;
        }
        let same = 0;
        for (let i = 0; i < now.length; i += 1) {
          const a = before[i];
          const b = now[i];
          if (a.sha !== b.sha) {
            diffs += 1;
            check(`${scene.key}/${kind} @${a.ms}ms`, false, `像素指纹不同 ${a.sha.slice(0, 12)} → ${b.sha.slice(0, 12)}`);
          } else if (a.png !== b.png) {
            /* 像素一样、PNG 字节不同：只可能是编码器参数，不算回归，但要留痕 */
            console.log(`  · ${scene.key}/${kind} @${a.ms}ms 像素相同、PNG 字节不同（不判失败）`);
            same += 1;
          } else {
            same += 1;
          }
        }
        check(`${scene.key}/${kind} 逐帧零差异`, same === now.length, `${same}/${now.length}`);
      }
    }
    console.log(`\n差异项合计：${diffs}`);
  }
} finally {
  cdp.edge.kill();
}

finish();
