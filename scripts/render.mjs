#!/usr/bin/env node
/**
 * 离线渲染器：把工程逐帧渲成 PNG，再交给外部编码器。
 *
 * 这是 pdoom-video `app/scripts/render.ts` 的对位实现 —— 那边的链路是
 * 「无头 Chrome → WebSocket 原始帧 → ffmpeg」，这边是
 * 「无头 Edge/Chrome → CDP → PNG 帧 → ffmpeg」，同一条思路：
 *
 *   · 每一帧都是 `renderToCanvas(project, t)` 的纯函数结果，**不经过播放**，
 *     所以预览看到什么、导出就是什么（没有实时时钟就没有掉帧和漂移）；
 *   · 多个浏览器并行啃分块，但**只往一个输出里按序写**，所以乱序渲染不影响成片；
 *   · 帧在内存里排队，超过上限就等编码器追上来（`--mem-frames`）。
 *
 * 为什么 PNG 而不是原始 RGBA：ffmpeg 的 `image2pipe` 直接吃 PNG 流，
 * 而 1080p 一帧 RGBA 是 7.9MB、base64 之后 11MB，跨 CDP 传一遍纯属浪费；
 * PNG 编码在页面里做（每帧十几毫秒），实测压缩 13 倍（本片平均 623KB/帧），
 * 换来的传输量是原来的 1/13。
 *
 * 用法：
 *   node scripts/render.mjs video --project prj_sample_revision --out out/revision.mp4
 *   node scripts/render.mjs video --project prj_sample_revision --samples auto --shutter 0.2
 *   node scripts/render.mjs sequence --project prj_sample_revision --out out/revision
 *   node scripts/render.mjs stills --project prj_sample_revision --at 0,4000,22500
 *   node scripts/render.mjs sheet --project prj_sample_revision --cuts
 *   node scripts/render.mjs perf --project prj_sample_revision --from 40500 --to 43000 --step 50
 *
 * `--shutter` 收两种口径：小于 1 的值当**帧时比例**（原项目口径，0.2 = 一帧的 1/5），
 * 大于等于 1 的当毫秒。所以原项目那条命令可以原样粘过来。
 *
 * 前置：`npm run dev` 起着（默认 http://127.0.0.1:5273/）；
 *      `video` 模式还需要 PATH 里有 ffmpeg（带 libx264）。
 *      缺 ffmpeg 时自动降级成 `sequence`，并写一条可直接粘的编码命令。
 */
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './_cdp.mjs';

/* ------------------------------------------------------------------ 参数 */

function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const key = (eq > 0 ? a.slice(2, eq) : a.slice(2)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (eq > 0) {
      out[key] = a.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const args = parseArgv(process.argv.slice(2));
const mode = args._[0] ?? 'video';
const MODES = ['video', 'sequence', 'stills', 'sheet', 'perf'];
if (!MODES.includes(mode)) {
  console.error(`未知模式：${mode}\n可用：${MODES.join(' / ')}`);
  process.exit(2);
}

const BASE = String(args.url ?? 'http://127.0.0.1:5273/');
const PROJECT = args.project ? String(args.project) : null;
const SCALE = Number(args.scale ?? 1);
const WORKERS = Math.max(1, Math.min(4, Number(args.workers ?? 2)));
const CHUNK = Math.max(1, Number(args.chunk ?? 8));
const CRF = Number(args.crf ?? 16);
const PRESET = String(args.preset ?? 'medium');
const MEM_FRAMES = Math.max(2, Number(args.memFrames ?? 24));
const X264 = args.x264 ? String(args.x264) : null;
/** 单帧超时：比最贵的一帧（不到 200ms）宽三个数量级，只为拦住「页面没了」这种死等 */
const FRAME_TIMEOUT = Math.max(5000, Number(args.frameTimeout ?? 90_000));
/** 写出口停滞判定：超过这么久没有一帧写出去就报错，别让死锁看起来像「很慢」 */
const STALL_MS = Math.max(20_000, Number(args.stall ?? 90_000));
const QUIET = !!args.quiet;
const FPS_OVERRIDE = args.fps ? Number(args.fps) : null;

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

const log = (...a) => {
  if (!QUIET) console.log(...a);
};

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function safeName(name) {
  return String(name || 'project').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 48);
}

/* -------------------------------------------------------------- 浏览器 */

/** 渲染期覆盖（--samples/--shutter/--tol）：每台浏览器都要重新打一遍，它们不共享存储 */
let OVERRIDE = null;

/**
 * `--shutter` 的口径换算。
 *
 * 原项目（pdoom-video）写的是**帧时比例**：`--shutter 0.2` = 一帧的 1/5。
 * 本工程的快门是毫秒（图层不知道自己挂在什么帧率上，比例对它没有意义）。
 * 为了让原项目那条命令能原样粘过来跑，小于 1 的值按「帧时比例」解释：
 * 0.2 @60fps = 3.33ms。大于等于 1 的就是毫秒。
 *
 * 这个歧义是刻意的 —— 0.2ms 的快门在任何帧率下都没有意义（比一次绘制还短），
 * 所以「< 1 就是比例」不会误伤任何真实用法。
 */
function shutterMs(value, fps) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return undefined;
  if (v < 1) return Math.max(1, +(v * (1000 / fps)).toFixed(2));
  return v;
}

async function applyOverrides(cdp) {
  if (!OVERRIDE) return;
  const layers = await cdp.ev(`(() => {
    const p = window.__kly.state().project;
    return JSON.stringify(p.layers.filter((l) => l.type === 'code' && l.code.motionBlur).map((l) => ({ id: l.id, ...l.code.motionBlur })));
  })()`);
  for (const layer of JSON.parse(layers)) {
    const next = {
      samples: OVERRIDE.samples === undefined ? layer.samples : OVERRIDE.samples === 'auto' ? 'auto' : Number(OVERRIDE.samples),
      shutter: OVERRIDE.shutter === undefined ? layer.shutter : OVERRIDE.shutter,
      ...(OVERRIDE.tol !== undefined ? { tol: Number(OVERRIDE.tol) } : layer.tol !== undefined ? { tol: layer.tol } : {}),
    };
    await cdp.ev(`window.__kly.dispatch('code.setMotionBlur', { id: ${JSON.stringify(layer.id)}, motionBlur: ${JSON.stringify(next)} })`);
  }
}

/** 一台浏览器 = 一个渲染进程。返回能取 meta / 取帧 / 量耗时的句柄 */
async function openWorker(label) {
  const cdp = await launch({ url: BASE, width: 1280, height: 900 });
  const page = cdp.conn;

  /* 启动页 boot 时才会把示例播进库：先等它出现，再跳编辑器 */
  if (PROJECT) {
    await cdp.waitFor(`!!document.querySelector('[data-project-id="${PROJECT}"]')`, 20000);
    await page.call('Page.navigate', { url: `${BASE}?view=editor&projectId=${PROJECT}` });
  }
  /*
   * 必须等「工程 id 对上了」再算就绪。只等 `__kly` 是不够的：
   * 跳转是异步的，旧页面上的 __kly 还活着，于是 meta 读到的是上一个工程 ——
   * 这个 bug 的表现是「渲染成功了，但渲的是别的东西」，比报错难查得多。
   */
  const ready = await cdp.waitFor(
    PROJECT
      ? `!!window.__kly && !!window.__kly.meta && window.__kly.state().project.id === ${JSON.stringify(PROJECT)}`
      : `!!window.__kly && !!window.__kly.meta`,
    25000,
  );
  if (!ready) throw new Error(`${label}: 编辑器没起来，或工程 ${PROJECT} 没打开`);
  await applyOverrides(cdp);
  return cdp;
}

/** 页面里的 PNG dataURL → Buffer */
function png(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
    throw new Error('页面没返回 PNG');
  }
  return Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
}

/* --------------------------------------------------------------- 出口 */

class FileSink {
  constructor(dir, prefix = 'frame') {
    this.dir = dir;
    this.prefix = prefix;
    this.ext = 'png';
    fs.mkdirSync(dir, { recursive: true });
  }
  async write(buf, index) {
    fs.writeFileSync(path.join(this.dir, `${this.prefix}_${String(index + 1).padStart(5, '0')}.${this.ext}`), buf);
  }
}

class FfmpegSink {
  constructor(file, fps, audioPath) {
    const argv = [
      '-y',
      '-loglevel', 'error',
      '-f', 'image2pipe',
      '-framerate', String(fps),
      '-i', '-',
    ];
    if (audioPath) argv.push('-i', audioPath);
    argv.push(
      '-c:v', 'libx264',
      '-crf', String(CRF),
      '-preset', PRESET,
      '-pix_fmt', 'yuv420p',
    );
    /* 原项目的 `--x264 aq-mode=3:rc-lookahead=30`：4K 下压内存的那组参数，直通过去 */
    if (X264) argv.push('-x264-params', X264);
    if (audioPath) argv.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
    argv.push(file);
    this.argv = argv;
    this.proc = spawn('ffmpeg', argv, { stdio: ['pipe', 'inherit', 'inherit'] });
    this.closed = new Promise((resolve, reject) => {
      this.proc.on('error', reject);
      this.proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}`))));
    });
  }
  async write(buf) {
    if (!this.proc.stdin.write(buf)) await once(this.proc.stdin, 'drain');
  }
  async close() {
    this.proc.stdin.end();
    await this.closed;
  }
}

/** 没 ffmpeg 时的替代：写一条能直接粘到终端里的编码命令 */
function writeEncodeScript(dir, fps, crf, audioName, outName) {
  const vf = `-framerate ${fps} -i frame_%05d.png`;
  const a = audioName ? ` -i ${audioName}` : '';
  const ac = audioName ? ' -c:a aac -b:a 192k -shortest' : '';
  const x = X264 ? ` -x264-params ${X264}` : '';
  const cmd = `ffmpeg -y ${vf}${a} -c:v libx264 -crf ${crf} -preset medium -pix_fmt yuv420p${x}${ac} ${outName}`;
  fs.writeFileSync(path.join(dir, 'encode.sh'), `#!/bin/sh\nset -e\ncd "$(dirname "$0")"\n${cmd}\n`);
  fs.writeFileSync(path.join(dir, 'encode.cmd'), `@echo off\r\ncd /d "%~dp0"\r\n${cmd}\r\n`);
  return cmd;
}

/* --------------------------------------------------------------- 帧队列 */

/**
 * 按序写出：谁先渲完不重要，写出去的顺序必须是对的。
 * 同时起背压作用 —— 排队超过 memFrames 就让渲染端等一下，别把内存吃光。
 */
function createOrderedSink(sink, total) {
  const pending = new Map();
  let next = 0;
  let chain = Promise.resolve();
  let startedAt = 0;
  let firstFrameAt = 0;
  let lastAdvanceAt = Date.now();

  /*
   * 停滞看门狗：写出口 90 秒没动过就报错退出，而不是安静地挂着。
   *
   * 这条不是补丁，是把「静默挂住」这个故障类整体消灭掉 ——
   * 上一次它挂在这里 19 分钟，日志里一行异常都没有，我一度以为是「机器慢」。
   * 任何未来的死锁都应该以「1280 帧后卡住 90 秒」结束，而不是以「跑了 20 分钟没结果」结束。
   * 用 unref 保证它不会拖住正常退出。
   */
  const watchdog = setInterval(() => {
    if (Date.now() - lastAdvanceAt < STALL_MS) return;
    const keys = [...pending.keys()];
    console.error(
      `\n渲染停滞：写出口停在 ${next}/${total}，${(STALL_MS / 1000).toFixed(0)}s 没有推进\n` +
        `  待写帧 ${pending.size} 个，索引范围 ${keys.length ? `${Math.min(...keys)}–${Math.max(...keys)}` : '空'}\n` +
        `  这不是「慢」—— 慢会继续出帧。请把上面这行连同模式参数一起记下来。`,
    );
    process.exit(3);
  }, 5000);
  watchdog.unref();

  const progress = () => {
    if (QUIET) return;
    const done = next;
    if (!process.stdout.isTTY) {
      /*
       * 非 TTY（管道、CI、后台任务）也必须有心跳。
       * 踩过的坑：整片渲染卡在第 1350 帧 19 分钟，而终端里一行输出都没有 ——
       * `| tail -6` 把 `\r` 覆盖行吞了，于是「挂了」和「在跑」看起来一模一样。
       * 每 60 帧落一行完整的，谁都能一眼看出停在哪儿。
       */
      if (done > 0 && done % 60 === 0) {
        const secs = (Date.now() - startedAt) / 1000;
        process.stdout.write(`  帧 ${done}/${total}（${((done / total) * 100).toFixed(1)}%）${secs.toFixed(0)}s\n`);
      }
      return;
    }
    const elapsed = (Date.now() - startedAt) / 1000;
    const rate = done > 0 ? done / Math.max(0.001, (Date.now() - firstFrameAt) / 1000) : 0;
    const eta = rate > 0 ? Math.max(0, (total - done) / rate) : 0;
    process.stdout.write(
      `\r  帧 ${String(done).padStart(5)}/${total}  ${((done / total) * 100).toFixed(1)}%  ` +
        `${rate.toFixed(2)} 帧/秒  剩 ${eta.toFixed(0)}s   `,
    );
  };

  return {
    begin() {
      startedAt = Date.now();
    },
    push(index, buf) {
      pending.set(index, buf);
      lastAdvanceAt = Date.now();
      if (next === 0 && !firstFrameAt) firstFrameAt = Date.now();
      /* 串行化写出：一次只有一个 drain 在跑，避免两帧同时写 stdin */
      chain = chain.then(async () => {
        while (pending.has(next)) {
          const b = pending.get(next);
          pending.delete(next);
          await sink.write(b, next);
          next += 1;
          lastAdvanceAt = Date.now();
          progress();
        }
      });
      return chain;
    },
    /**
     * 内存背压：**按「我这一帧离写出口还有多远」来限，而不是按 pending 的总条数**。
     *
     * 早先写的是 `while (pending.size >= MEM_FRAMES) await sleep(30)`，那是一个
     * 会死锁的规则：两个 worker 都跑到写出口前面很远时，pending 装满的都是
     * MAX 之前的帧；而真正做到 `next` 的那一帧如果还没渲完，两个 worker 就一起
     * 卡在 sleep 里 —— 谁也不再产帧，`next` 永远不动。表现是进程静默挂住、
     * 没有异常、连超时都没有（因为根本没有 CDP 调用在等）。
     *
     * 现在每个 worker 只保证「自己这一帧比写出口超前不超过 MEM_FRAMES」：
     * 拥有 `next` 的那个 worker 的 `index - next === 0`，永远不会被拦；
     * 只要它在跑，`next` 就一定会前进 —— 于是**构造上不可能死锁**。
     */
    async backpressure(index) {
      while (index - next >= MEM_FRAMES) await sleep(20);
    },
    async close() {
      clearInterval(watchdog);
      await chain;
      while (pending.has(next)) {
        const b = pending.get(next);
        pending.delete(next);
        await sink.write(b, next);
        next += 1;
      }
      if (!QUIET && process.stdout.isTTY && total > 0) process.stdout.write('\n');
      await sink.close?.();
      return next;
    },
  };
}

/* --------------------------------------------------------------- 模式 */

/**
 * 渲染主循环：chunk 队列 + N 个渲染进程。
 *
 * `slot` 是可变的工作位（不是裸的 CDP 句柄），因为**一台浏览器可能中途死掉**。
 * 真的死过一次：跑到第 1350 帧（45000ms，引爆段结尾）时页面没了，
 * 而当时的 `cdp.ev` 既不超时也不听 close —— 整个进程静默挂起 19 分钟，
 * 没有报错也没有退出码，表现和「很慢」一模一样。
 *
 * 所以这里定了三条规矩：
 *   1. 单帧调用有超时（`--frame-timeout`，默认 90s，比最贵的一帧宽 3 个数量级）；
 *   2. 超时或断连 → 杀掉这台浏览器、开一台新的、**重渲这一帧**（最多 2 次）；
 *   3. 同一帧两次都失败才整体报错 —— 那时是真的有问题，不是偶发。
 *
 * 重试是安全的：每帧是时间的纯函数，换一台浏览器渲出来的字节应当是同一张图。
 * 不需要记录「渲染进度」，因为 chunk 是从队列里领的，重试只影响当前这一帧。
 */
async function renderFrames(meta, fps, from, to, sink, { workers = WORKERS, onFrame } = {}) {
  const total = Math.max(1, Math.round(((to - from) / 1000) * fps));
  const ordered = createOrderedSink(sink, total);
  ordered.begin();

  const chunkCount = Math.ceil(total / CHUNK);
  const queue = [];
  for (let c = 0; c < chunkCount; c += 1) queue.push(c);

  const slots = await Promise.all(
    Array.from({ length: Math.min(workers, chunkCount) }, async (_, i) => ({ id: i, cdp: await openWorker(`worker-${i}`), restarts: 0 })),
  );

  const runOne = async (slot) => {
    for (;;) {
      const chunk = queue.shift();
      if (chunk === undefined) return;
      const start = chunk * CHUNK;
      const end = Math.min(total, start + CHUNK);
      for (let i = start; i < end; i += 1) {
        const ms = Math.round(from + (i * 1000) / fps);
        let buf = null;
        let lastErr = null;
        for (let attempt = 0; attempt < 2 && !buf; attempt += 1) {
          try {
            buf = png(await slot.cdp.ev(`window.__kly.frame(${ms}, ${SCALE})`, FRAME_TIMEOUT));
          } catch (err) {
            lastErr = err;
            if (attempt === 0) {
              slot.restarts += 1;
              log(`\n  ⚠ 第 ${i} 帧（${ms}ms）失败，换一台浏览器重试：${err?.message ?? err}`);
              try {
                slot.cdp.edge.kill();
              } catch {
                /* 已经死了 */
              }
              slot.cdp = await openWorker(`worker-${slot.id}-r${slot.restarts}`);
              await applyOverrides(slot.cdp); /* 新浏览器又是一份空存储，覆盖要重打 */
            }
          }
        }
        if (!buf) throw new Error(`第 ${i} 帧（${ms}ms）两次都失败：${lastErr?.message ?? lastErr}`);
        onFrame?.();
        await ordered.push(i, buf);
        await ordered.backpressure(i);
      }
    }
  };

  try {
    await Promise.all(slots.map((s) => runOne(s)));
    const written = await ordered.close();
    if (written !== total) throw new Error(`写出 ${written} 帧，应为 ${total} 帧`);
    return total;
  } finally {
    for (const s of slots) s.cdp.edge.kill();
  }
}

async function saveAudio(cdp, dir, name = 'audio.wav') {
  const res = await cdp.ev(`window.__kly.wav(48000)`);
  if (!res?.bytes) return null;
  const file = path.join(dir, name);
  fs.writeFileSync(file, Buffer.from(res.bytes, 'base64'));
  return file;
}

function defaultOut(meta, ext) {
  return path.join('out', `${safeName(meta.name)}-${stamp()}.${ext}`);
}

async function main() {
  const probe = await openWorker('probe');
  let meta;
  try {
    meta = await probe.ev(`window.__kly.meta()`);
    const fps = FPS_OVERRIDE ?? meta.fps ?? 30;

    /* 渲染期覆盖：只改这一台浏览器里的数据，不落盘（工程在渲染浏览器里是只读副本） */
    if (args.samples || args.shutter || args.tol) {
      OVERRIDE = {
        samples: args.samples === undefined ? undefined : args.samples === 'auto' ? 'auto' : Number(args.samples),
        shutter: shutterMs(args.shutter, fps),
        tol: args.tol === undefined ? undefined : Number(args.tol),
      };
      if (args.shutter !== undefined && Number(args.shutter) < 1) {
        log(`  --shutter ${args.shutter} 按帧时比例换算：@${fps}fps = ${OVERRIDE.shutter}ms`);
      }
      await applyOverrides(probe);
      const n = await probe.ev(`window.__kly.state().project.layers.filter((l) => l.code && l.code.motionBlur).length`);
      if (n)
        log(
          `  覆盖运动模糊：${n} 层 → samples=${OVERRIDE.samples ?? '不变'} shutter=${OVERRIDE.shutter ?? '不变'} tol=${OVERRIDE.tol ?? '不变'}`,
        );
    }

    log(`工程 ${meta.name} · ${meta.width}×${meta.height} @${fps}fps · ${(meta.duration / 1000).toFixed(2)}s · scale ${SCALE}`);

    /* ── stills ─────────────────────────────────────── */
    if (mode === 'stills') {
      const times = String(args.at ?? '0')
        .split(',')
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isFinite(v));
      const dir = args.out ? String(args.out) : path.join('out', `stills-${stamp()}`);
      fs.mkdirSync(dir, { recursive: true });
      for (const ms of times) {
        const buf = png(await probe.ev(`window.__kly.frame(${ms}, ${SCALE})`));
        const file = path.join(dir, `still-${String(ms).padStart(6, '0')}ms.png`);
        fs.writeFileSync(file, buf);
        log(`  ${file}  ${(buf.length / 1024).toFixed(0)}KB`);
      }
      return;
    }

    /* ── sheet ──────────────────────────────────────── */
    if (mode === 'sheet') {
      let times;
      if (args.cuts) {
        /* 联络图取「场景边界」：每个有时间窗的图层起点就是一次切镜 */
        times = JSON.parse(
          await probe.ev(`(() => {
            const p = window.__kly.state().project;
            const cuts = [...new Set(p.layers.filter((l) => l.inPoint > 0).map((l) => Math.round(l.inPoint)))].sort((a, b) => a - b);
            return JSON.stringify([0, ...cuts]);
          })()`),
        );
      } else if (args.at) {
        times = String(args.at).split(',').map(Number);
      } else {
        const n = Number(args.n ?? 12);
        times = Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) * meta.duration) / n));
      }
      const cols = Number(args.cols ?? 4);
      const url = await probe.ev(`window.__kly.sheet(${JSON.stringify(times)}, ${cols}, ${Number(args.scale ?? 0.34)})`);
      const file = args.out ? String(args.out) : path.join('out', `sheet-${stamp()}.png`);
      fs.mkdirSync(path.dirname(file) || '.', { recursive: true });
      fs.writeFileSync(file, png(url));
      log(`  ${file}  ${times.length} 格 · ${cols} 列`);
      return;
    }

    /* ── perf ───────────────────────────────────────── */
    if (mode === 'perf') {
      const step = Number(args.step ?? 500);
      /*
       * `--from/--to` 对 perf 也生效：整片按固定步长扫时，越贵的那几段
       * 越容易被步长跳过去（引爆段只有 6 秒，1000ms 一步只采到 6 个点，
       * 峰值刚好落在两点之间就成了假绿灯）。要盯某一段就自己缩范围。
       */
      const pFrom = Number(args.from ?? 0);
      const pTo = Number(args.to ?? meta.duration);
      const times = [];
      for (let ms = pFrom; ms < pTo; ms += step) times.push(ms);
      const list = [];
      for (const ms of times) {
        await probe.ev(`window.__kly.renderTimed(${ms}, ${SCALE})`); /* 热身：shader 编译、字体、缓存 */
        list.push(Number(await probe.ev(`window.__kly.renderTimed(${ms}, ${SCALE})`)));
      }
      const sorted = [...list].sort((a, b) => a - b);
      const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor((q / 100) * sorted.length))];
      const budget = 1000 / fps;
      const over = list.filter((v) => v > budget).length;
      /* 最慢的那几个点也报出来 —— max 只能说明「有一处」，几处要自己数 */
      const worst = list
        .map((ms, i) => ({ at: times[i], ms }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 3);
      log('');
      log(`  ${list.length} 个采样点 · ${pFrom}–${pTo}ms · 预算 ${budget.toFixed(1)}ms/帧`);
      log(`  p50 ${pct(50).toFixed(1)}ms · p95 ${pct(95).toFixed(1)}ms · max ${Math.max(...list).toFixed(1)}ms`);
      log(`  超预算 ${over} 个（${((over / list.length) * 100).toFixed(1)}%）`);
      if (over) log(`  最慢：${worst.map((w) => `${w.at}ms ${w.ms.toFixed(1)}ms`).join(' · ')}`);
      if (args.json)
        fs.writeFileSync(
          String(args.json),
          JSON.stringify(
            { fps, scale: SCALE, from: pFrom, to: pTo, step, samples: list, times, p50: pct(50), p95: pct(95), max: Math.max(...list), over },
            null,
            2,
          ),
        );
      return;
    }

    /* ── video / sequence ───────────────────────────── */
    const from = Number(args.from ?? 0);
    const to = Number(args.to ?? meta.duration);
    const frameCount = Math.max(1, Math.round(((to - from) / 1000) * fps));

    const wantsVideo = mode === 'video';
    const canVideo = wantsVideo && hasFfmpeg;
    if (wantsVideo && !hasFfmpeg) {
      log('\n  ⚠ 没找到 ffmpeg，降级为 PNG 序列（帧是完整的，只是不在这里编码）');
      log('    Windows 装一下再回来： winget install Gyan.FFmpeg   或  scoop install ffmpeg');
    }

    const outFile = args.out ? String(args.out) : defaultOut(meta, canVideo ? 'mp4' : '');
    const workDir = canVideo ? path.dirname(outFile) || '.' : args.out ? String(args.out) : `out/sequence-${stamp()}`;
    fs.mkdirSync(canVideo ? path.dirname(outFile) || '.' : workDir, { recursive: true });

    /* 声音：无压缩 WAV，跟帧一起交给编码器；没有音轨时为 null */
    const audioPath = await saveAudio(probe, canVideo ? path.dirname(outFile) || '.' : workDir);
    if (!audioPath) log('  （这个工程没有音轨，出无声片）');

    const fpsForSink = fps;
    const sink = canVideo ? new FfmpegSink(outFile, fpsForSink, audioPath) : new FileSink(workDir);

    log(`  起点 ${from}ms → 终点 ${to}ms，共 ${frameCount} 帧，${WORKERS} 个渲染进程，每块 ${CHUNK} 帧`);
    log(`  路线：浏览器逐个求值 → ${canVideo ? 'ffmpeg 编码' : 'PNG 序列'}`);
    const t0 = Date.now();
    const total = await renderFrames(meta, fps, from, to, sink, { workers: WORKERS });
    const secs = (Date.now() - t0) / 1000;

    if (canVideo) {
      const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
      log(`\n  完成：${outFile}  ${(size / 1024 / 1024).toFixed(1)}MB  ${total} 帧  ${secs.toFixed(1)}s（${(total / secs).toFixed(2)} 帧/秒）`);
      log(`  参数：x264 CRF ${CRF} / preset ${PRESET}${audioPath ? ' / AAC 192k' : ''} / ${meta.width * SCALE}×${meta.height * SCALE}`);
      if (audioPath) log(`  音轨：${audioPath}`);
    } else {
      const outName = `${safeName(meta.name)}-${stamp()}.mp4`;
      const cmd = writeEncodeScript(workDir, fps, CRF, audioPath ? path.basename(audioPath) : null, outName);
      log(`\n  完成：${total} 帧 → ${workDir}  ${secs.toFixed(1)}s（${(total / secs).toFixed(2)} 帧/秒）`);
      log(`  编码命令已写入 ${path.join(workDir, 'encode.cmd')}（Windows）/ encode.sh：`);
      log(`    ${cmd}`);
    }
  } finally {
    probe.edge.kill();
  }
}

main().catch((err) => {
  console.error(`\n渲染失败：${err?.message ?? err}`);
  process.exit(1);
});
