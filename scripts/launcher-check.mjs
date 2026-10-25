/**
 * 启动页验收（规格 3.5 七条）。
 *
 * 全程走真实浏览器 + 真实点击，不调内部函数：
 *   1. `/` 缺省视图就是启动页
 *   2. 预设点击后宽高正确填充
 *   3. 自定义 800×600 / 12s / 60fps → 创建后工程参数正确
 *   4. 最近项目按更新时间降序、缩略图非空
 *   5. 单位换算（px ↔ mm）物理尺寸不变
 *   6. 删除 → 二次确认 → 列表刷新
 *   7. 刷新仍停在启动页；英文模式无中文 UI 文案
 *
 * 需要 dev server 跑在 5273。
 */
import { launch, reporter, sleep, AUTO_CONFIRM } from './_cdp.mjs';

const base = 'http://localhost:5273/';
const { check, finish } = reporter();

/** React 受控输入：直接改 value 不触发 onChange，必须走原型 setter + input 事件 */
const setInput = (selector, value, eventName = 'input') => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(String(value))});
  el.dispatchEvent(new Event(${JSON.stringify(eventName)}, { bubbles: true }));
  return true;
})()`;

const clickText = (text, scope = 'document') => `(() => {
  const root = ${scope};
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(text)});
  if (!b) return false;
  b.click();
  return true;
})()`;

/** 带副标题的按钮（如「自定义尺寸 / 宽高·时长…」）只能按包含匹配 */
const clickIncludes = (text, scope = 'document') => `(() => {
  const root = ${scope};
  const b = [...root.querySelectorAll('button')].find((x) => x.textContent.includes(${JSON.stringify(text)}));
  if (!b) return false;
  b.click();
  return true;
})()`;

const readInput = (selector) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  return el ? el.value : null;
})()`;

const DIALOG = `document.querySelector('[data-testid="new-project-dialog"]')`;

async function openDialog(cdp) {
  await cdp.ev(clickIncludes('自定义尺寸'));
  return cdp.waitFor(`!!${DIALOG}`, 6000);
}

const main = async () => {
  const cdp = await launch({ url: base, width: 1440, height: 900 });
  try {
    await cdp.waitFor('typeof window.__kly !== "undefined"', 20000);
    await cdp.ev(AUTO_CONFIRM);

    /* ── 1. 缺省视图是启动页 ─────────────────────────── */
    const isPage = await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"][data-mode="page"]')`, 12000);
    check('/ 缺省落在启动页（data-mode=page）', isPage);
    const hasEditorChrome = await cdp.ev(`!!document.querySelector('[data-tier]')`);
    check('启动页不挂编辑器（无 Host 外壳）', hasEditorChrome === false);

    const firstCards = await cdp.ev(`document.querySelectorAll('[data-testid="launcher-grid"] [data-project-id]').length`);
    const emptyState = await cdp.ev(`document.body.innerText.includes('还没有项目')`);
    check('全新环境显示空状态（0 张卡片）', firstCards === 0 ? emptyState === true : firstCards > 0, firstCards === 0 ? '空状态已显示' : `${firstCards} 张`);

    /* ── 2. 预设填充 ─────────────────────────────────── */
    check('「自定义尺寸」打开新建对话框', await openDialog(cdp));
    await cdp.ev(`document.querySelector('[data-testid="np-preset-海报"]')?.click()`);
    await sleep(200);
    const preset = {
      w: await cdp.ev(readInput('[data-testid="np-width"]')),
      h: await cdp.ev(readInput('[data-testid="np-height"]')),
    };
    check('预设「海报」填充 1080 × 1440', preset.w === '1080' && preset.h === '1440', JSON.stringify(preset));

    /* ── 3. 单位换算 ─────────────────────────────────── */
    await cdp.ev(clickText('mm', DIALOG));
    await sleep(200);
    const inMm = {
      w: Number(await cdp.ev(readInput('[data-testid="np-width"]'))),
      h: Number(await cdp.ev(readInput('[data-testid="np-height"]'))),
    };
    check(
      '切到 mm 后数值按 96dpi 换算（1080px ≈ 285.75mm）',
      Math.abs(inMm.w - 1080 / (96 / 25.4)) < 0.6 && Math.abs(inMm.h - 1440 / (96 / 25.4)) < 0.6,
      JSON.stringify(inMm),
    );
    /* 这行提示在 Modal 的 footer 里（不是 dialog body），所以扫整页 */
    const hint = await cdp.ev(`document.body.innerText`);
    check('提示里回显 px 值（数据层不认 mm）', /1080\s*×\s*1440\s*px/.test(hint), hint.match(/内部统一[^\n]*/)?.[0] ?? '');
    await cdp.ev(clickText('px', DIALOG));
    await sleep(150);

    /* ── 4. 自定义 800×600 / 12s / 60fps 创建 ────────── */
    await cdp.ev(setInput('[data-testid="np-name"]', 'CUSTOM-800'));
    await cdp.ev(setInput('[data-testid="np-width"]', '800'));
    await cdp.ev(setInput('[data-testid="np-height"]', '600'));
    await cdp.ev(setInput('[data-testid="np-duration"]', '12'));
    await cdp.ev(setInput('[data-testid="np-fps"]', '60', 'change'));
    await sleep(200);
    const beforeCreate = await cdp.ev(`document.querySelectorAll('[data-project-id]').length`);
    check('创建按钮可点（校验通过）', await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === '创建并打开');
      return !!b && !b.disabled;
    })()`));

    await cdp.ev(clickText('创建并打开'));
    await cdp.waitFor(`typeof window.__kly !== "undefined" && !!document.querySelector('[data-tier]')`, 20000);
    /* boot 是异步的：编辑器外壳先挂上，project.open 之后才换成新工程 —— 必须等名字对上再断言 */
    const opened = await cdp.waitFor(`window.__kly?.state().project.name === 'CUSTOM-800'`, 15000);
    check('创建后直接进入编辑器（并打开新工程）', opened);
    const created = await cdp.ev(`(() => {
      const p = window.__kly.state().project;
      return { name: p.name, w: p.width, h: p.height, duration: p.duration, fps: p.fps, url: location.search, bg: p.layers[0]?.color };
    })()`);
    check(
      '工程参数 = 800×600 / 12s / 60fps',
      created.w === 800 && created.h === 600 && created.duration === 12000 && created.fps === 60,
      JSON.stringify(created),
    );
    check('URL 带上 view=editor + projectId', /view=editor/.test(created.url) && /projectId=/.test(created.url), created.url);
    check('背景色写进背景层', /^#/.test(created.bg ?? ''), String(created.bg));

    const timeline = await cdp.ev(`document.body.innerText.includes('12.0s') || document.body.innerText.includes('00:12')`);
    check('时间轴总长显示 12s', timeline === true);

    /* ── 5. 缩略图 + 排序 ───────────────────────────── */
    const index = await cdp.ev(`(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('kinelayer'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const row = await new Promise((res) => { const q = db.transaction('meta', 'readonly').objectStore('meta').get('projectIndex'); q.onsuccess = () => res(q.result?.value ?? []); });
      db.close();
      return row.map((m) => ({ id: m.id, name: m.name, updatedAt: m.updatedAt, thumb: typeof m.thumbnail === 'string' && m.thumbnail.startsWith('data:') }));
    })()`);
    const mine = index.find((m) => m.name === 'CUSTOM-800');
    check('创建时立刻写了缩略图', !!mine?.thumb, mine ? `thumb=${mine.thumb}` : '没找到记录');
    const sorted = index.every((m, i) => i === 0 || index[i - 1].updatedAt >= m.updatedAt);
    check('索引按 updatedAt 降序', sorted, index.map((m) => m.name).join(' > '));

    /* ── 6. 回到启动页，卡片与删除 ───────────────────── */
    await cdp.conn.call('Page.navigate', { url: base });
    await sleep(1500);
    await cdp.waitFor('typeof window.__kly !== "undefined"', 15000);
    const back = await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"][data-mode="page"]')`, 10000);
    check('刷新 / 回根路径仍在启动页', back);

    const cardCount = await cdp.ev(`document.querySelectorAll('[data-testid="launcher-grid"] [data-project-id]').length`);
    const hasThumbImg = await cdp.ev(`!!document.querySelector('[data-testid="launcher-grid"] [data-project-id] img')`);
    check('最近项目卡片渲染缩略图', hasThumbImg === true, `${cardCount} 张`);
    check('最近项目最多 12 条', cardCount <= 12, `${cardCount} 张`);

    await cdp.ev(AUTO_CONFIRM);
    const removed = await cdp.ev(`(() => {
      const card = [...document.querySelectorAll('[data-project-id]')].find((c) => c.innerText.includes(${JSON.stringify('CUSTOM-800')}));
      if (!card) return 'no-card';
      const btn = [...card.querySelectorAll('button')].find((b) => b.title === '删除');
      if (!btn) return 'no-button';
      btn.click();
      return 'clicked';
    })()`);
    check('卡片上有删除按钮', removed === 'clicked', String(removed));
    await sleep(1200);
    const afterDelete = await cdp.ev(`document.querySelectorAll('[data-testid="launcher-grid"] [data-project-id]').length`);
    check('删除后列表刷新（少一张）', afterDelete === cardCount - 1, `${cardCount} → ${afterDelete}`);

    /* ── 7. 英文模式无裸中文 ─────────────────────────── */
    await cdp.ev(clickIncludes('EN'));
    await sleep(600);
    const en = await cdp.ev(`(() => {
      /* 只探 UI 文案，不探用户数据（工程名）与语言名（中文/EN 按钮本身就是语言自称） */
      const text = document.querySelector('[data-testid="launcher"]')?.innerText ?? '';
      const probes = ['空白项目', '自定义尺寸', '预设', '最近项目', '打开本地', '还没有项目', '新建', '选中一个工程'];
      return { hits: probes.filter((p) => text.includes(p)) };
    })()`);
    check('英文模式无中文 UI 文案', en.hits.length === 0, JSON.stringify(en.hits));

    /* ── 8. 英文界面下路由仍正常 ─────────────────────── */
    const stillPage = await cdp.ev(`!!document.querySelector('[data-testid="launcher"][data-mode="page"]')`);
    check('切语言不破坏当前视图', stillPage === true);
  } finally {
    cdp.edge.kill();
  }
};

main()
  .then(() => process.exit(finish()))
  .catch((err) => {
    console.error('自检异常：', err);
    process.exit(2);
  });
