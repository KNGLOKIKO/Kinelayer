/**
 * v2.7 验收：用户与 AI 共写的「自定义命令」（宏）。
 *
 * 这一轮要验的是七件事：
 *   1. 定义：能存、能改、能删；存之前就把「跑不通」拦下来（命令不存在 / payload 不合 schema /
 *      占位符没声明 / 用了禁区命令）
 *   2. 执行：步骤作为**一次原子批处理**跑 —— 全成功才落盘，失败整批回滚，一个撤销点
 *   3. 参数：`{{x}}` 整个当值时保留类型（数字还是数字），嵌在字符串里则拼接
 *   4. 记录：成功 +1 次、失败留下 lastError，都会落库，刷新还在
 *   5. 持久化：命令跟人不跟工程（IndexedDB），刷新后仍在
 *   6. 界面：左侧「自定义」面板、卡片信息、运行/编辑入口、编辑器的校验报错
 *   7. 双语：英文模式下面板与编辑器零中文
 *
 * 需要 dev server 跑在 5273。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, reporter, sleep } from './_cdp.mjs';

const base = 'http://localhost:5273/';
const { check, finish } = reporter();

const findButton = (text) => `[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;

async function realClick(cdp, selectorJs) {
  /* 面板/对话框都是 overflow-y-auto 的，先滚进可视区再算坐标 */
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

/** 定义一个只调 canvas.setDuration 的无参宏：最容易验证「跑没跑」 */
const DURATION_MACRO = {
  name: '设为 4 秒',
  description: '把时长改成 4000ms',
  params: [],
  steps: [{ type: 'canvas.setDuration', payload: { duration: 4000 }, note: '改时长' }],
};

const main = async () => {
  const cdp = await launch({ url: base, width: 1440, height: 900 });
  try {
    const ready = await cdp.waitFor(`typeof window.__kly !== "undefined"`, 20000);
    check('dev 调试口就绪', ready);
    if (!ready) return;
    await cdp.waitFor(`!!document.querySelector('[data-testid="launcher"]')`, 12000);

    /* 先建一个工程，后面所有事都在它上面做 */
    const project = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('project.create', { name: '自定义命令验收', width: 1080, height: 1440 });
      return { ok: r.ok, id: r.data?.id, err: r.error?.message };
    })()`);
    check('建一个验收用工程', project.ok, JSON.stringify(project));

    /* ── 1. 定义：能存，也该拦住跑不通的 ───────────────────── */
    const defined = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('custom.define', ${JSON.stringify(DURATION_MACRO)}, { source: 'user' });
      const list = await window.__kly.dispatch('custom.list', {});
      return { ok: r.ok, err: r.error?.message, id: r.data?.id, created: r.data?.created, author: r.data?.author, warned: r.data?.warnings, count: list.data?.count, ids: list.data?.commands?.map((c) => c.id) };
    })()`);
    check('custom.define 存下来了', defined.ok && !!defined.id, JSON.stringify({ e: defined.err }));
    check('返回 author=user（谁存的一目了然）', defined.author === 'user', String(defined.author));
    check('custom.list 里能看到它', defined.count === 1, JSON.stringify({ n: defined.count }));

    const invalid = await cdp.ev(`(async () => {
      const missingCmd = await window.__kly.dispatch('custom.define', {
        name: '不存在的步骤', description: '', params: [],
        steps: [{ type: 'layer.nope', payload: {} }],
      });
      const badPayload = await window.__kly.dispatch('custom.define', {
        name: 'payload 不合规', description: '', params: [],
        steps: [{ type: 'canvas.setDuration', payload: { duration: '很快' } }],
      });
      const undeclared = await window.__kly.dispatch('custom.define', {
        name: '占位符没声明', description: '', params: [],
        steps: [{ type: 'canvas.setDuration', payload: { duration: '{{ms}}' } }],
      });
      const forbidden = await window.__kly.dispatch('custom.define', {
        name: '禁区命令', description: '', params: [],
        steps: [{ type: 'custom.run', payload: { id: 'x' } }],
      });
      const emptyName = await window.__kly.dispatch('custom.define', { name: '   ', description: '', params: [], steps: [{ type: 'canvas.setDuration', payload: { duration: 1000 } }] });
      return {
        missingCmd: { ok: missingCmd.ok, msg: missingCmd.error?.message },
        badPayload: { ok: badPayload.ok, msg: badPayload.error?.message },
        undeclared: { ok: undeclared.ok, msg: undeclared.error?.message },
        forbidden: { ok: forbidden.ok, msg: forbidden.error?.message },
        emptyName: { ok: emptyName.ok },
      };
    })()`);
    check('不存在的命令被拦下并指出第几步', invalid.missingCmd.ok === false && /第 1 步/.test(invalid.missingCmd.msg ?? ''), JSON.stringify(invalid.missingCmd));
    check('payload 不合 schema 被拦下', invalid.badPayload.ok === false && /duration/.test(invalid.badPayload.msg ?? ''), JSON.stringify(invalid.badPayload));
    check('用了没声明的参数被拦下', invalid.undeclared.ok === false && /\{\{ms\}\}/.test(invalid.undeclared.msg ?? ''), JSON.stringify(invalid.undeclared));
    check('禁区命令（custom.run）被拦下', invalid.forbidden.ok === false && /递归/.test(invalid.forbidden.msg ?? ''), JSON.stringify(invalid.forbidden));
    check('空名字被 schema 挡', invalid.emptyName.ok === false, JSON.stringify(invalid.emptyName));

    /* ── 2. 执行：一次原子批处理 ───────────────────────────── */
    const ran = await cdp.ev(`(async () => {
      /* 先把时长挪开、清掉历史：不然「跑之前就是 4000」会让这条断言白跑一遍 */
      await window.__kly.dispatch('canvas.setDuration', { duration: 3000 });
      await window.__kly.dispatch('history.clear', {});
      const before = window.__kly.state().project.duration;
      const r = await window.__kly.dispatch('custom.run', { id: ${JSON.stringify(defined.id)} });
      const after = window.__kly.state().project.duration;
      const pastLen = window.__kly.state().past.length;
      return { ok: r.ok, err: r.error?.message, before, after, pastLen, steps: r.data?.steps };
    })()`);
    check('无参宏跑通了', ran.ok, JSON.stringify({ e: ran.err }));
    check('画布时长真的变成 4000ms', ran.after === 4000 && ran.before !== 4000, JSON.stringify({ before: ran.before, after: ran.after }));
    check('只产生一个撤销点', ran.pastLen === 1, String(ran.pastLen));

    const undone = await cdp.ev(`(async () => {
      await window.__kly.dispatch('history.undo', {});
      return window.__kly.state().project.duration;
    })()`);
    check('撤销一次就整体回滚', undone === ran.before, JSON.stringify({ got: undone, want: ran.before }));

    /* ── 3. 参数：类型保留 + 字符串拼接 ───────────────────── */
    const paramMacro = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('custom.define', {
        name: '按参数改时长',
        description: 'duration 由参数给',
        params: [
          { key: 'ms', label: '毫秒', type: 'number', default: 2000, min: 500, max: 60000 },
          { key: 'tag', label: '标签', type: 'string', default: 'A' },
        ],
        steps: [
          { type: 'canvas.setDuration', payload: { duration: '{{ms}}' }, note: '整值占位 → 保留数字' },
          { type: 'layer.create', payload: { type: 'text', text: '标题-{{tag}}', x: 100, y: 100, width: 600, height: 160 }, note: '嵌在字符串里 → 拼接' },
        ],
      });
      if (!r.ok) return { ok: false, err: r.error?.message };
      const run = await window.__kly.dispatch('custom.run', { id: r.data.id, params: { ms: 7500, tag: 'ABC' } });
      const p = window.__kly.state().project;
      const text = p.layers.find((l) => l.type === 'text');
      return { ok: run.ok, err: run.error?.message, duration: p.duration, text: text?.text, durationType: typeof p.duration, id: r.data.id, warnings: run.data?.warnings };
    })()`);
    check('带参数的宏跑通', paramMacro.ok, JSON.stringify({ e: paramMacro.err }));
    check('整值占位保留数字类型（7500 不是 "7500"）', paramMacro.duration === 7500 && paramMacro.durationType === 'number', JSON.stringify({ d: paramMacro.duration, t: paramMacro.durationType }));
    check('嵌在字符串里的占位符被拼接', paramMacro.text === '标题-ABC', String(paramMacro.text));

    const badParam = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('custom.run', { id: ${JSON.stringify(paramMacro.id)}, params: { ms: 'abc' } });
      return { ok: r.ok, msg: r.error?.message };
    })()`);
    check('参数类型不对时报 VALIDATION 级错误', badParam.ok === false && /数字/.test(badParam.msg ?? ''), JSON.stringify(badParam));

    /* ── 4. 失败就必须整批回滚，并留下 lastError ──────────── */
    const failing = await cdp.ev(`(async () => {
      const r = await window.__kly.dispatch('custom.define', {
        name: '第二步会失败',
        description: '第一步建层，第二步改一个不存在的层',
        params: [],
        steps: [
          { type: 'layer.create', payload: { type: 'text', text: 'half done' }, note: '先建一层' },
          { type: 'layer.update', payload: { id: 'ly_does_not_exist', patch: { opacity: 0.5 } }, note: '必然失败' },
        ],
      });
      if (!r.ok) return { ok: false, err: r.error?.message };
      const before = window.__kly.state().project.layers.length;
      const run = await window.__kly.dispatch('custom.run', { id: r.data.id });
      const after = window.__kly.state().project.layers.length;
      const list = await window.__kly.dispatch('custom.list', {});
      const saved = list.data.commands.find((c) => c.id === r.data.id);
      return {
        ok: true, id: r.data.id,
        runOk: run.ok, msg: run.error?.message, failedAt: run.error?.detail?.failedAt, rolledBack: run.error?.detail?.rolledBack,
        before, after, lastError: saved?.lastError, runCount: saved?.runCount,
      };
    })()`);
    check('二步失败的宏跑不通（如实报错）', failing.runOk === false, JSON.stringify({ msg: failing.msg }));
    check('失败信息指向第 2 步', failing.failedAt === 1, String(failing.failedAt));
    check('第一步建的层被回滚掉了', failing.before === failing.after, JSON.stringify({ before: failing.before, after: failing.after }));
    check('lastError 落到了命令上', !!failing.lastError && /ly_does_not_exist|不存在/.test(failing.lastError), String(failing.lastError));
    check('失败不计入运行次数', failing.runCount === 0, String(failing.runCount));

    const successCount = await cdp.ev(`(async () => {
      const list = await window.__kly.dispatch('custom.list', {});
      const c = list.data.commands.find((x) => x.id === ${JSON.stringify(paramMacro.id)});
      return { runCount: c?.runCount, lastError: c?.lastError };
    })()`);
    check('成功的宏运行次数 +1 且没有 lastError', successCount.runCount === 1 && !successCount.lastError, JSON.stringify(successCount));

    /* ── 5. dryRun 只预览，不动画布 ────────────────────────── */
    const dry = await cdp.ev(`(async () => {
      const before = window.__kly.state().project.duration;
      const r = await window.__kly.dispatch('custom.run', { id: ${JSON.stringify(paramMacro.id)}, params: { ms: 9000 } }, { dryRun: true });
      return { ok: r.ok, duration: window.__kly.state().project.duration, before, steps: r.data?.steps?.length };
    })()`);
    check('dryRun 返回展开后的步骤但不执行', dry.ok && dry.steps === 2 && dry.duration === dry.before, JSON.stringify(dry));

    /* ── 6. 持久化：刷新后仍在 ─────────────────────────────── */
    const beforeReload = await cdp.ev(`window.__kly.state().project.id`);
    await cdp.conn.call('Page.navigate', { url: `${base}?view=editor&projectId=${encodeURIComponent(beforeReload)}` });
    const back = await cdp.waitFor(`typeof window.__kly !== "undefined" && window.__kly.state().runtime.customCommandsLoaded`, 25000);
    check('切到编辑器页并读完自定义命令', back);
    if (!back) return;
    const afterReload = await cdp.ev(`window.__kly.state().runtime.customCommands.map((c) => ({ id: c.id, name: c.name, runCount: c.runCount, lastError: !!c.lastError }))`);
    check('三条命令都还在（含失败记录）', Array.isArray(afterReload) && afterReload.length === 3, JSON.stringify(afterReload));
    check('运行次数也持久化了', (afterReload ?? []).some((c) => c.runCount === 1), JSON.stringify(afterReload));

    /* ── 7. 界面：面板 / 卡片 / 运行 / 编辑器 ───────────────── */
    const openedTab = await realClick(cdp, `[...document.querySelectorAll('button')].find((b) => b.title === '自定义')`);
    await sleep(400);
    const panel = await cdp.ev(`(() => {
      const rows = document.querySelectorAll('[data-testid="custom-command-row"]');
      const first = rows[0];
      return { rows: rows.length, text: first ? first.innerText.replace(/\\n/g, ' | ') : '', header: document.body.innerText.includes('自定义命令') };
    })()`);
    check('左侧「自定义」面板列出 3 条', openedTab && panel.rows === 3, JSON.stringify(panel));
    check('卡片说明了「几步 · 几个参数」', /步 ·/.test(panel.text) && /参数/.test(panel.text), String(panel.text).slice(0, 120));

    /* 无参宏的「运行」按钮：点一下应该直接跑，不弹表单 */
    const clickedRun = await realClick(cdp, `(() => {
      const row = [...document.querySelectorAll('[data-testid="custom-command-row"]')].find((r) => r.innerText.includes('设为 4 秒'));
      return row ? [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '运行') : null;
    })()`);
    await sleep(900);
    const direct = await cdp.ev(`({
      duration: window.__kly.state().project.duration,
      runDialog: !!document.querySelector('[data-testid="custom-run-dialog"]'),
    })`);
    check('无参宏点「运行」直接执行（不弹表单）', clickedRun && direct.duration === 4000 && direct.runDialog === false, JSON.stringify(direct));

    /* 有参宏：应该弹参数表单 */
    const clickedRun2 = await realClick(cdp, `(() => {
      const row = [...document.querySelectorAll('[data-testid="custom-command-row"]')].find((r) => r.innerText.includes('按参数改时长'));
      return row ? [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '运行') : null;
    })()`);
    const dialogUp = await cdp.waitFor(`!!document.querySelector('[data-testid="custom-run-dialog"]')`, 4000);
    check('有参宏点「运行」弹出参数表单', clickedRun2 && dialogUp, String(dialogUp));
    await realClick(cdp, findButton('取消'));
    await sleep(300);

    /* 编辑器：打开后能看到步骤卡片 */
    const clickedEdit = await realClick(cdp, `(() => {
      const row = [...document.querySelectorAll('[data-testid="custom-command-row"]')].find((r) => r.innerText.includes('按参数改时长'));
      return row ? [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === '编辑') : null;
    })()`);
    const editorUp = await cdp.waitFor(`!!document.querySelector('[data-testid="custom-dialog"]')`, 4000);
    check('编辑器能打开', clickedEdit && editorUp, String(editorUp));
    /*
     * 不能拿 innerText 断言：<select> 的 innerText 会把所有 option 都算进来，
     * 所以「选项里有 canvas.setDuration」永远成立，等于没验。
     * 直接看表单控件的 value —— payload 里应该是 {{ms}} 这个占位符。
     */
    const editorForm = await cdp.ev(`(() => {
      const el = document.querySelector('[data-testid="custom-dialog"]');
      if (!el) return null;
      return {
        payloads: [...el.querySelectorAll('textarea')].map((a) => a.value),
        steps: [...el.querySelectorAll('select')].map((s) => s.value).filter((v) => v.includes('.')),
      };
    })()`);
    check(
      '编辑器里带出了参数与步骤',
      !!editorForm && editorForm.payloads.some((v) => /\{\{ms\}\}/.test(v)) && editorForm.steps.includes('canvas.setDuration') && editorForm.steps.includes('layer.create'),
      JSON.stringify(editorForm).slice(0, 200),
    );

    /* 故意把 payload 改坏 → 保存应该被拦下且对话框不关 */
    const broke = await cdp.ev(`(() => {
      const area = document.querySelector('[data-testid="custom-dialog"] textarea');
      if (!area) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(area, '{ "duration": ');
      area.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await sleep(200);
    await realClick(cdp, findButton('保存'));
    await sleep(600);
    const stillOpen = await cdp.ev(`({
      open: !!document.querySelector('[data-testid="custom-dialog"]'),
      text: (document.querySelector('[data-testid="custom-dialog"]')?.innerText ?? '').replace(/\\n/g, ' | '),
    })`);
    check('payload 写坏时保存被拦下且对话框不关', broke && stillOpen.open && /JSON/.test(stillOpen.text), String(stillOpen.text).slice(-120));
    await realClick(cdp, findButton('取消'));
    await sleep(300);

    /* ── 8. 删除 ───────────────────────────────────────────── */
    const removed = await cdp.ev(`(async () => {
      const list = await window.__kly.dispatch('custom.list', {});
      const target = list.data.commands.find((c) => c.name === '第二步会失败');
      const r = await window.__kly.dispatch('custom.remove', { id: target.id });
      const after = await window.__kly.dispatch('custom.list', {});
      const ghost = await window.__kly.dispatch('custom.remove', { id: target.id });
      return { ok: r.ok, count: after.data?.count, ghostOk: ghost.ok, ghostCode: ghost.error?.code };
    })()`);
    check('删除成功且列表少一条', removed.ok && removed.count === 2, JSON.stringify(removed));
    check('删不存在的命令报 NOT_FOUND', removed.ghostOk === false && removed.ghostCode === 'NOT_FOUND', JSON.stringify(removed));

    /* ── 9. 英文模式：面板与编辑器零中文 ───────────────────── */
    const switched = await realClick(cdp, `[...document.querySelectorAll('button')].find((b) => ['中', 'EN'].includes(b.textContent.trim()))`);
    await sleep(900);
    const enPanel = await cdp.ev(`(() => {
      const rows = document.querySelectorAll('[data-testid="custom-command-row"]');
      const row = rows[0];
      if (!row) return { cjk: -1, sample: '' };
      /*
       * 只数「界面自己的文案」：名字、描述、最后一条错误都是用户/AI 写进去的数据，
       * 中文是正常的。UI 侧用 data-user-text 把它们标出来了，这里整块剔掉。
       */
      const clone = row.cloneNode(true);
      clone.querySelectorAll('[data-user-text]').forEach((n) => n.remove());
      const text = (clone.textContent || '').replace(/\\s+/g, ' ').trim();
      return { cjk: (text.match(/[\\u4e00-\\u9fff]/g) ?? []).length, sample: text.slice(0, 140) };
    })()`);
    check('英文模式下命令卡片零中文', switched && enPanel.cjk === 0, JSON.stringify(enPanel));

    const enEdit = await realClick(cdp, `(() => {
      const row = [...document.querySelectorAll('[data-testid="custom-command-row"]')].find((r) => /Run/.test(r.innerText));
      return row ? [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit') : null;
    })()`);
    const enDialog = await cdp.waitFor(`!!document.querySelector('[data-testid="custom-dialog"]')`, 4000);
    const enText = await cdp.ev(`(() => {
      const el = document.querySelector('[data-testid="custom-dialog"]');
      if (!el) return null;
      const count = (root) => ((root.textContent || '').match(/[\\u4e00-\\u9fff]/g) ?? []).length;
      /*
       * 三类内容不算界面文案：
       *   1. 用户自己的数据（名称、描述、payload、步骤备注）—— 由 data-user-text 标记；
       *   2. 表单控件的当前值（input/textarea 的内容天然是数据）；
       *   3. 命令注册表里的元信息（data-cmd-meta）—— 整份命令表的描述目前只有中文，
       *      属于全局未翻译项，不是这次新增的文案。但它单独计数并打印出来，不藏。
       */
      const all = el.cloneNode(true);
      all.querySelectorAll('select, input, textarea, [data-user-text]').forEach((n) => n.remove());

      const ours = all.cloneNode(true);
      ours.querySelectorAll('[data-cmd-meta]').forEach((n) => n.remove());

      return {
        cjk: count(ours),
        metaCjk: count(all) - count(ours),
        sample: (ours.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 200),
      };
    })()`);
    check(
      '英文模式下编辑器零中文',
      enEdit && enDialog && enText && enText.cjk === 0,
      JSON.stringify({ ...enText, metaCjk: enText?.metaCjk }),
    );
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
