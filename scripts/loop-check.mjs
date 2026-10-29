/**
 * 循环保护验收：注入 / 误伤 / 编译 / 真·死循环 / 崩溃安全模式。
 *
 * 这一批最容易写成「跑起来没卡就算过」——那不算验收，因为没卡的原因可能是代码层
 * 压根没被执行。所以分成两层来验：
 *
 *   白盒：`__kly.loopProtect.probe()` 直接看「注入了几处、注入后的代码还能不能编译、
 *         字符串与注释里的 while 有没有被误伤」。这部分是确定性的，能一次抓住三类错误。
 *   黑盒：真塞一个 while(true) 进代码层，让它跑起来，然后断言
 *         ① 页面还能响应（CDP 调用能返回）② 图层进的是错误态 ③ 主时钟还在走。
 *
 * 安全模式不去真冻一次（那会把浏览器搞死、也测不稳），改成手工打标记再刷新 ——
 * 标记的语义本来就是「上次没正常收尾」，打上去等同于一次强杀。
 *
 * 需要 dev server 跑在 5273。
 */
import { launch, reporter, sleep } from './_cdp.mjs';

const base = 'http://localhost:5273/';
const { check, finish } = reporter();

const J = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

const cdp = await launch({ url: `${base}?view=editor&projectId=prj_sample_start`, width: 1280, height: 800 });
let projectId = null;

try {
  await sleep(1200);
  const ready = await cdp.waitFor(`!!window.__kly && !!window.__kly.loopProtect`, 20000);
  check('打开编辑器并挂上循环保护调试口', ready);
  if (!ready) throw new Error('调试口没就绪');

  const warm = await cdp.waitFor(`window.__kly.loopProtect.ready()`, 20000);
  check('编译器已预热（@babel/parser 就绪，可以给代码层注入检查）', warm);

  /* ── 1. 注入：五种循环都要命中 ───────────────────────────── */
  const probeCases = [
    ['while 循环', 'let x = 0; while (true) { x += 1; }', 1],
    ['for 循环', 'let x = 0; for (let i = 0; i < 10; i++) { x += i; }', 1],
    ['do-while 循环', 'let x = 9; do { x -= 1; } while (x > 0);', 1],
    ['for-of 循环', 'let x = 0; for (const v of [1, 2, 3]) { x += v; }', 1],
    ['单语句循环体（没有花括号）', 'let x = 0; if (true) while (x < 3) x += 1;', 1],
    ['嵌套单语句循环体', 'let x = 0; if (true) while (x < 3) while (x < 2) x += 1;', 2],
  ];

  for (const [label, src, expect] of probeCases) {
    const raw = await cdp.ev(`JSON.stringify(window.__kly.loopProtect.probe(${JSON.stringify(src)}))`);
    const res = J(raw);
    const okCount = res?.injected === expect;
    const okCheck = typeof res?.code === 'string' && res.code.includes('__klyDeadline');
    /* 注入是改源码，所以「改完还能不能编译」必须验 —— 括号插错位置在这一步就会炸 */
    const compiles = J(
      await cdp.ev(`(() => {
        try { new Function('ctx','api','params','width','height','time','frame','state','output','__klyDeadline', ${JSON.stringify(
          res?.code ?? '',
        )}); return 'true'; } catch (e) { return JSON.stringify({ err: String(e) }); }
      })()`),
    );
    check(`${label}：注入 ${expect} 处检查`, okCount && okCheck, `injected=${res?.injected} hasCheck=${okCheck}`);
    check(`${label}：注入后的代码仍可编译`, compiles === true, JSON.stringify(compiles).slice(0, 120));
  }

  /* ── 2. 不误伤：字符串/注释/模板里出现 while 不算循环 ───────── */
  const safeCases = [
    ['双引号字符串里的 while', 'const s = "while (true) { }"; return s;'],
    ['单行注释里的 while', '// while (true) { }\nconst a = 1; return a;'],
    ['块注释里的 while', '/* while (true) { } */\nconst a = 2; return a;'],
    ['模板字符串里的 while', 'const t = `while (x) {`; return t;'],
    ['正则字面量里的 while', 'const r = /while \\(/; return r.source;'],
  ];
  for (const [label, src] of safeCases) {
    const res = J(await cdp.ev(`JSON.stringify(window.__kly.loopProtect.probe(${JSON.stringify(src)}))`));
    check(`${label}：不该被注入`, res?.injected === 0 && res?.code === src, `injected=${res?.injected}`);
  }

  /* ── 3. 语法错误：原样返回，绝不把用户代码改坏 ─────────────── */
  const broken = 'while (';
  const brokenRes = J(await cdp.ev(`JSON.stringify(window.__kly.loopProtect.probe(${JSON.stringify(broken)}))`));
  check('源码本身有语法错误时原样返回（交给 new Function 去报错）', brokenRes?.code === broken && brokenRes?.injected === 0, `injected=${brokenRes?.injected}`);

  /* ── 4. 真·死循环：进错误态，页面不冻 ─────────────────────── */
  const created = J(
    await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('project.create', {
      name: '循环保护自检', width: 960, height: 540, duration: 8000, fps: 25,
    })))()`),
  );
  check('新建 8 秒测试工程', created?.ok === true, String(created?.error?.message ?? '').slice(0, 120));
  projectId = J(await cdp.ev(`JSON.stringify(window.__kly.state().project.id)`));

  const madeLayer = J(
    await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('layer.create', {
      type: 'code', x: 0, y: 0, width: 960, height: 540,
    })))()`),
  );
  const layerId = madeLayer?.data?.id ?? null;
  check('加一个代码层', madeLayer?.ok === true && !!layerId, JSON.stringify(madeLayer?.error?.message ?? '').slice(0, 120));

  const deadLoop = 'let n = 0;\nwhile (true) { n += 1; }\nctx.fillStyle = "#fff";\nctx.fillRect(0, 0, width, height);';
  const setSrc = J(
    await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('code.setSource', {
      id: ${JSON.stringify(layerId)}, source: ${JSON.stringify(deadLoop)},
    })))()`),
  );
  check('写入含 while(true) 的代码', setSrc?.ok === true, JSON.stringify(setSrc?.error?.message ?? '').slice(0, 120));

  /*
   * 让时间轴跑起来：播放头每帧都会变，渲染签名才会变，代码层才真的被执行。
   * 如果保护失效，这一句 dispatch 之后的 ev 会直接把浏览器拖死 —— 脚本超时就是失败信号。
   */
  const before = J(await cdp.ev(`JSON.stringify({ head: window.__kly.state().runtime.playhead })`));
  await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('timeline.play', {})))()`);
  await sleep(1600);
  const after = J(await cdp.ev(`JSON.stringify({ head: window.__kly.state().runtime.playhead })`));
  check('播放中页面没有冻死（能读回播放头）', after !== null && typeof after.head === 'number', JSON.stringify(after));

  const rt = J(await cdp.ev(`JSON.stringify(window.__kly.codeRuntime(${JSON.stringify(layerId)}))`));
  check('代码层进入错误态而不是静默卡住', typeof rt?.error === 'string' && rt.error.includes('循环超时'), String(rt?.error).slice(0, 120));
  check('错误计入熔断计数（连续 3 次后禁用该层）', (rt?.strikes ?? 0) >= 1, `strikes=${rt?.strikes}`);

  const advanced = after && before && after.head > before.head;
  check('主时钟仍在推进（冻死的典型症状是播放头纹丝不动）', !!advanced, `${before?.head} → ${after?.head}`);

  await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('timeline.pause', {})))()`);

  /* ── 5. 正常循环不被误杀 ─────────────────────────────────── */
  const normal = 'for (let i = 0; i < 2000; i += 1) { ctx.globalAlpha = i / 2000; }\nctx.globalAlpha = 1;\nctx.fillStyle = "#7c5cff";\nctx.fillRect(0, 0, 60, 60);';
  const setNormal = J(
    await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('code.setSource', {
      id: ${JSON.stringify(layerId)}, source: ${JSON.stringify(normal)},
    })))()`),
  );
  check('把代码换成正常的 2000 次循环', setNormal?.ok === true);

  await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('timeline.play', {})))()`);
  await sleep(900);
  const rtNormal = J(await cdp.ev(`JSON.stringify(window.__kly.codeRuntime(${JSON.stringify(layerId)}))`));
  await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('timeline.pause', {})))()`);
  check('正常循环没有被误判成超时', rtNormal?.error === null, String(rtNormal?.error).slice(0, 120));

  /* ── 6. 崩溃安全模式：打标记 → 刷新 ───────────────────────── */
  await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('code.setSource', {
    id: ${JSON.stringify(layerId)}, source: ${JSON.stringify(deadLoop)},
  })))()`);
  await cdp.ev(`window.__kly.loopProtect.mark(${JSON.stringify(projectId)}) && 'ok'`);
  const marked = J(await cdp.ev(`JSON.stringify({ has: window.__kly.loopProtect.hasMarker(${JSON.stringify(projectId)}) })`));
  check('求值期标记能写进 sessionStorage', marked?.has === true, JSON.stringify(marked));

  await cdp.reload();
  await sleep(1500);
  const safe = J(
    await cdp.ev(`JSON.stringify({
      safe: window.__kly.state().ui.codeSafeMode,
      marker: window.__kly.loopProtect.hasMarker(${JSON.stringify(projectId)}),
      text: document.body.innerText.includes('安全模式'),
    })`),
  );
  check('刷新后以代码层禁用的安全模式打开', safe?.safe === true, JSON.stringify(safe));
  check('安全模式的提示真的显示出来了', safe?.text === true, String(safe?.text));
  check('标记已清掉（否则会永久卡在安全模式）', safe?.marker === false, `marker=${safe?.marker}`);

  /*
   * ── 7. 持久标记：关掉标签页重开也还记得 ─────────────────────
   *
   * sessionStorage 只活一次重载，关掉浏览器就没了；没有这一层的话「重开一个标签页」
   * 等于把保护丢掉，用户会一进来又被同一个 while(true) 冻一次。
   */
  const persisted = await cdp.ev(`(async () => JSON.stringify(await window.__kly.safeMode.is(${JSON.stringify(projectId)})))()`);
  check('崩溃过的工程被写进持久标记（跨标签页/换浏览器仍生效）', J(persisted) === true, persisted);

  /* ── 8. 首帧求值成功 → 清持久标记，且要有明确的恢复出口 ──────── */
  J(
    await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('code.setSource', {
      id: ${JSON.stringify(layerId)}, source: ${JSON.stringify(normal)},
    })))()`),
  );
  /* 走真实按钮而不是直接改 state：恢复出口本身也是交付物的一部分 */
  const clicked = await cdp.ev(`(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('重新启用代码层'));
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()`);
  check('安全模式横幅上有「重新启用代码层」按钮', clicked === 'clicked', String(clicked));
  await sleep(900);
  const recovered = J(
    await cdp.ev(`(async () => JSON.stringify({
      safe: window.__kly.state().ui.codeSafeMode,
      flag: await window.__kly.safeMode.is(${JSON.stringify(projectId)}),
    }))()`),
  );
  check('点按钮后安全模式关闭', recovered?.safe === false, JSON.stringify(recovered));
  check('首帧求值成功后持久标记被清掉', recovered?.flag === false, `flag=${recovered?.flag}`);

  /* ── 9. 删除工程要级联清掉标记，别把 id 留着  ──────────────── */
  await cdp.ev(`(async () => JSON.stringify(await window.__kly.safeMode.mark(${JSON.stringify(projectId)})))()`);
  await cdp.ev(`(async () => JSON.stringify(await window.__kly.dispatch('project.deleteLocal', {
    projectId: ${JSON.stringify(projectId)}, confirm: true,
  })))()`);
  await sleep(400);
  const cascaded = await cdp.ev(`(async () => JSON.stringify(await window.__kly.safeMode.is(${JSON.stringify(projectId)})))()`);
  check('删除工程时级联清掉安全模式条目（避免残留误判新工程）', J(cascaded) === false, cascaded);
  projectId = null;
} finally {
  /* 清理测试工程，别把自检垃圾留在工程库里 */
  if (projectId) {
    await cdp
      .ev(`(async () => JSON.stringify(await window.__kly.dispatch('project.deleteLocal', {
        projectId: ${JSON.stringify(projectId)}, confirm: true,
      })))()`)
      .catch(() => null);
  }
  await cdp.close?.();
}

process.exit(finish());
