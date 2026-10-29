/**
 * 代码层循环保护（loop-protect）+ 崩溃回路标记。
 *
 * 解决的是开发期最痛的一件事：代码层里一句 `while (true)` 会把整个编辑器冻死，
 * 只能强杀标签页。两层缓解：
 *
 * 1. **编译期注入超时检查**：把每个循环体（for / while / do-while / for-in / for-of）
 *    的首行插一条 `if (performance.now() > deadline) throw ...`，超过单帧预算就中断。
 *    这是 CodePen / JSFiddle 那套做法的同一思路 —— 协作式而非抢占式，拦得住死循环，
 *    拦不住死递归与巨量分配（那两类要靠 Worker，见 docs/01）。
 *
 * 2. **崩溃回路标记**：一次求值开始前在 sessionStorage 打标记，帧正常画完再清掉。
 *    标记还在 = 上一次是被冻死/强杀的，启动时据此以「代码层禁用」的安全模式打开，
 *    否则用户一开就又冻死，连改代码的机会都没有。
 *
 * 为什么不是直接上 Worker：本工程的底线是「预览即导出」，而逐帧同步求值是这条底线的
 * 前提之一。Worker 化是 v2.16 之后的独立重构（评审文档第 4 节），这里只做低成本缓解。
 */

/** 单帧内所有循环允许消耗的毫秒数。超了就抛 —— 正常画面远用不到这个量级 */
export const LOOP_BUDGET_MS = 50;

/** 注入的抛错文案。运行时靠这个前缀识别「是循环保护打断的」，而不是用户代码自己抛的 */
export const LOOP_TIMEOUT_MARK = '__KINELAYER_LOOP_TIMEOUT__';

const MARKER_PREFIX = 'kly:evaluating:';

type BabelParse = (code: string, options: Record<string, unknown>) => unknown;

let parseFn: BabelParse | null = null;
let ready = false;
let degradedReason: string | null = null;

/**
 * 编译器是否可用。
 *
 * 未就绪时**绝不能求值**：宁可这一帧不画代码层，也不能拿没注入保护的源码去跑 ——
 * 那正是我们要防的那次冻结。就绪失败（离线/打包异常）会降级成「不保护」并记下原因，
 * 否则代码层会永远不显示，那是更糟的失败模式。
 */
export function isLoopProtectReady(): boolean {
  return ready;
}

export function loopProtectNote(): string | null {
  return degradedReason;
}

/**
 * 预热：动态载入 @babel/parser。
 *
 * 为什么不静态 import：它现在由 htmlImport / remotionParser 动态导入，是独立 chunk；
 * 静态引入会把约 500KB 拖进编辑器主 chunk。这里的代价只是首次进编辑器多一次 chunk 拉取。
 *
 * 幂等，可重复调用。
 */
let warming: Promise<void> | null = null;
/** 上一次尝试失败了。降级过就必须留一条重试路径，否则那一批层会**永久**失去保护 */
let degraded = false;
let degradedEverHappened = false;
let retries = 0;
const RETRY_DELAYS = [3000, 10_000, 30_000];

const upgradeListeners = new Set<() => void>();

/**
 * 「解析器迟到了」的通知：降级之后重试成功，之前按无保护编译的层必须重新编译一次。
 *
 * 只通知不发事件总线，是因为这条链路极短 —— 收到的人只做一件事：清掉所有代码层运行时，
 * 下一帧自然按带保护的源码重新编译。用回调注册而不是直接 import codeEngine，
 * 是为了不让 core 反向依赖 render（并且会形成循环）。
 */
export function onLoopProtectUpgraded(cb: () => void): void {
  upgradeListeners.add(cb);
}

export function ensureLoopProtect(): Promise<void> {
  if (ready && !degraded) return Promise.resolve();
  if (warming) return warming;
  warming = (async () => {
    try {
      const mod = (await import('@babel/parser')) as unknown as { parse?: BabelParse };
      if (typeof mod.parse !== 'function') throw new Error('@babel/parser 没有导出 parse');
      parseFn = mod.parse;
      degraded = false;
      degradedReason = null;
      retries = 0;
      if (degradedEverHappened) {
        /* 曾经降级过 → 之前那些层是没注入保护编出来的，全部作废重编 */
        degradedEverHappened = false;
        for (const cb of upgradeListeners) cb();
      }
    } catch (err) {
      /* 降级而不是卡死：拿不到解析器就退回「不注入」的旧行为，并留一条重试路径 */
      degraded = true;
      degradedEverHappened = true;
      degradedReason = `循环保护编译器加载失败，代码层将以无保护方式运行：${(err as Error).message}`;
      const delay = RETRY_DELAYS[retries];
      if (delay !== undefined) {
        retries += 1;
        setTimeout(() => {
          warming = null;
          void ensureLoopProtect();
        }, delay);
      }
    } finally {
      ready = true;
      warming = null;
    }
  })();
  return warming;
}

/* ----------------------------------------------------------------- AST 遍历 */

interface AstNode {
  type: string;
  start: number;
  end: number;
}

function isNode(value: unknown): value is AstNode {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as { type?: unknown; start?: unknown };
  return typeof rec.type === 'string' && typeof rec.start === 'number';
}

/** 这些键不是子节点（位置信息与注释），遍历时跳过，省一半时间 */
const SKIP_KEYS = new Set(['loc', 'start', 'end', 'range', 'leadingComments', 'trailingComments', 'innerComments', 'extra']);

const LOOP_TYPES = new Set(['ForStatement', 'WhileStatement', 'DoWhileStatement', 'ForInStatement', 'ForOfStatement']);

interface LoopBody {
  /** 循环体本身（BlockStatement 或单条语句） */
  body: AstNode;
  /** 遍历序号：同一位置上有多个插入时用来定顺序（外层先开、内层先关） */
  seq: number;
}

function collectLoopBodies(root: unknown): LoopBody[] {
  const out: LoopBody[] = [];
  let seq = 0;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isNode(node)) return;
    if (LOOP_TYPES.has(node.type)) {
      const body = (node as unknown as { body?: unknown }).body;
      if (isNode(body)) out.push({ body, seq: seq++ });
    }
    for (const key of Object.keys(node)) {
      if (SKIP_KEYS.has(key)) continue;
      const child = (node as unknown as Record<string, unknown>)[key];
      if (child && typeof child === 'object') visit(child);
    }
  };
  visit(root);
  return out;
}

const CHECK = `if(performance.now()>__klyDeadline)throw new Error("${LOOP_TIMEOUT_MARK}");`;

/**
 * 给源码里的每个循环体注入超时检查。
 *
 * 返回的 `injected` 是注入数量，`note` 在降级时给一句人话（会被拼进图层的编译提示里）。
 * 解析失败时**原样返回**：宁可这一层没保护，也不能因为注入把用户的代码改坏。
 */
export function protectLoops(source: string): { code: string; injected: number; note: string | null } {
  if (!parseFn) return { code: source, injected: 0, note: degradedReason };
  let ast: unknown;
  try {
    ast = parseFn(source, {
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      errorRecovery: false,
    });
  } catch {
    /* 语法本身有问题：交给 new Function 去报编译错误，这里不抢着报 */
    return { code: source, injected: 0, note: null };
  }

  const bodies = collectLoopBodies(ast);
  if (bodies.length === 0) return { code: source, injected: 0, note: null };

  /* 位置 → 要在该位置插入的片段；开括号按 seq 升序（外层先），闭括号按 seq 降序（内层先） */
  const opens = new Map<number, { seq: number; text: string }[]>();
  const closes = new Map<number, { seq: number; text: string }[]>();
  const push = (map: Map<number, { seq: number; text: string }[]>, pos: number, seq: number, text: string): void => {
    const list = map.get(pos);
    if (list) list.push({ seq, text });
    else map.set(pos, [{ seq, text }]);
  };

  for (const { body, seq } of bodies) {
    if (body.type === 'BlockStatement') {
      /* 已经是块：把检查插在 `{` 之后 */
      push(opens, body.start + 1, seq, CHECK);
    } else if (body.type === 'EmptyStatement') {
      /* `while (x);` —— 空语句本身没什么好保护的，但空转也会冻死：把它变成块 */
      push(opens, body.start, seq, `{${CHECK}}`);
    } else {
      /* 单条语句：包成块，检查放在原语句之前 */
      push(opens, body.start, seq, `{${CHECK}`);
      push(closes, body.end, seq, '}');
    }
  }

  const positions = new Set<number>([...opens.keys(), ...closes.keys()]);
  const ordered = [...positions].sort((a, b) => b - a);
  let out = source;
  for (const pos of ordered) {
    const open = (opens.get(pos) ?? []).sort((a, b) => a.seq - b.seq).map((x) => x.text).join('');
    const close = (closes.get(pos) ?? []).sort((a, b) => b.seq - a.seq).map((x) => x.text).join('');
    out = out.slice(0, pos) + open + close + out.slice(pos);
  }
  return { code: out, injected: bodies.length, note: null };
}

/* ------------------------------------------------------- 求值期标记（崩溃检测） */

/**
 * 一次求值开始。
 *
 * 写在 sessionStorage 而不是 localStorage：它只需要活过一次重载 —— 标签页被强杀后
 * 重新打开（浏览器恢复会话）时它还在，这正是我们要的那段窗口。用 localStorage 反而
 * 会把「上一次崩过」永久留在设备上。
 */
export function beginEvaluation(projectId: string): void {
  try {
    sessionStorage.setItem(MARKER_PREFIX + projectId, String(Date.now()));
  } catch {
    /* 隐私模式下 sessionStorage 可能直接抛，标记失效但不该影响渲染 */
  }
}

export function endEvaluation(projectId: string): void {
  try {
    sessionStorage.removeItem(MARKER_PREFIX + projectId);
  } catch {
    /* 同上 */
  }
}

/** 上一次求值有没有正常收尾。true = 上次是被冻死/强杀的 */
export function hasCrashMarker(projectId: string): boolean {
  try {
    return sessionStorage.getItem(MARKER_PREFIX + projectId) !== null;
  } catch {
    return false;
  }
}

export function clearCrashMarker(projectId: string): void {
  endEvaluation(projectId);
}
