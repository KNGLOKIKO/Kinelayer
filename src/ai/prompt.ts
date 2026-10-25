import { buildToolSchemas, fromToolName, listCommands, type AnyCommandDef } from '@/core/registry';
import { zAnimPreset, zEasing, zTextStyle } from '@/core/schemas';
import { summarizeProject } from '@/core/summary';
import type { Project } from '@/core/types';
import { getLocale, tIn } from '@/i18n';

/* 预设 / 缓动 / 文本字段也取自 schema，不手写枚举——否则改一处忘一处，模型就会写出非法值 */
const PRESETS = zAnimPreset.options.join('、');
const EASINGS = zEasing.options.join('、');
const TEXT_FIELDS = Object.keys(zTextStyle.shape).join(' / ');

/**
 * AI 接入提示词生成器
 * ---------------------------------------------------------------------------
 * 这里最关键的一条：**提示词里的命令清单不是手写的**。
 * 它跟 OpenAI tools / MCP tools 一样，都来自 `buildToolSchemas()`。
 * 所以「加一条命令 → 所有接入方式的提示词自动更新」，不会出现
 * 「文档里写了个不存在的命令，模型照着编」这种最恶心的情况。
 *
 * 三种交付形态：
 *   chat  —— 粘给任意大模型（含不支持 function calling 的），产出 JSON 再粘回应用执行
 *   mcp   —— 给 Claude Desktop / Cursor 这类能直连 MCP 的客户端
 *   tools —— OpenAI function calling 的 tools 数组，交给自建 Agent 用
 */

export type PromptVariant = 'chat' | 'mcp' | 'tools';

export interface PromptOptions {
  /** 把当前画布尺寸与图层清单一起写进提示词，模型就能直接引用真实 id */
  includeProject?: boolean;
  project?: Project;
}

/* ------------------------------------------------------------ schema 摘要 */

type JsonSchema = Record<string, unknown>;

function shortType(schema: JsonSchema): string {
  const anyOf = schema.anyOf as JsonSchema[] | undefined;
  if (Array.isArray(anyOf)) {
    return [...new Set(anyOf.map(shortType).filter((t) => t && t !== 'null'))].join('|');
  }
  const en = schema.enum as unknown[] | undefined;
  if (Array.isArray(en)) {
    const values = en.map((v) => (typeof v === 'string' ? v : String(v)));
    return values.length > 4 ? 'enum' : values.join('|');
  }
  const t = schema.type;
  if (t === 'array') {
    const items = (schema.items as JsonSchema | undefined) ?? {};
    return `${shortType(items) || 'any'}[]`;
  }
  if (t === 'object') return '{}';
  if (Array.isArray(t)) return t.join('|');
  return typeof t === 'string' ? t : '';
}

/** `layer.create(type*:'text'|'image', x?:number, …)` 这种紧凑签名 */
function signatureOf(inputSchema: JsonSchema, zh = true): string {
  const props = (inputSchema.properties as Record<string, JsonSchema> | undefined) ?? {};
  const required = new Set((inputSchema.required as string[] | undefined) ?? []);
  const parts = Object.entries(props).map(([key, schema]) => {
    const t = shortType(schema);
    return `${key}${required.has(key) ? '*' : '?'}${t ? `:${t}` : ''}`;
  });
  if (!parts.length) return zh ? '无参数' : 'no args';
  const text = parts.join(', ');
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const cut = flat.search(/[。；;\n]/);
  const head = cut > 0 ? flat.slice(0, cut) : flat;
  return head.length > 90 ? `${head.slice(0, 88)}…` : head;
}

interface CatalogRow {
  type: string;
  category: string;
  signature: string;
  summary: string;
  dangerous: boolean;
  mutating: boolean;
  example: unknown;
}

function buildCatalog(zh = true): CatalogRow[] {
  const defs = new Map<string, AnyCommandDef>(listCommands().map((d) => [d.type, d]));
  return buildToolSchemas().map((tool) => {
    const type = fromToolName(tool.name);
    const def = defs.get(type);
    return {
      type,
      category: def?.category ?? (zh ? '其他' : 'Other'),
      signature: signatureOf(tool.inputSchema, zh),
      summary: firstSentence(def?.description ?? ''),
      dangerous: !!def?.dangerous,
      mutating: !!def?.mutating,
      example: def?.example,
    };
  });
}

function catalogText(): { text: string; count: number } {
  const rows = buildCatalog();
  const groups = new Map<string, CatalogRow[]>();
  for (const row of rows) {
    const list = groups.get(row.category) ?? [];
    list.push(row);
    groups.set(row.category, list);
  }
  const blocks = [...groups.entries()].map(([category, list]) => {
    const lines = list.map((r) => `- ${r.type}(${r.signature})${r.dangerous ? ' ⚠危险' : ''} —— ${r.summary}`);
    return `[${category}]\n${lines.join('\n')}`;
  });
  return { text: blocks.join('\n\n'), count: rows.length };
}

/* ------------------------------------------------------------ 项目上下文 */

function projectContext(project?: Project, zh = true): string {
  if (!project) return '';
  const summary = summarizeProject(project) as {
    width?: number;
    height?: number;
    duration?: number;
    fps?: number;
    layers?: { id: string; type: string; name: string; box: number[]; text?: string }[];
  };
  const layers = (summary.layers ?? []).map((l) => {
    const box = l.box.join(',');
    const text = l.text
      ? zh
        ? ` 文本「${l.text.replace(/\n/g, ' ').slice(0, 40)}」`
        : ` text “${l.text.replace(/\n/g, ' ').slice(0, 40)}”`
      : '';
    return `- ${l.id} · ${l.type} · ${l.name} · box=[${box}]${text}`;
  });
  return zh
    ? [
        '',
        '## 当前项目（真实数据，id 可直接引用）',
        `画布 ${summary.width}×${summary.height}px · 时长 ${summary.duration}ms · ${summary.fps}fps`,
        ...layers,
      ].join('\n')
    : [
        '',
        '## Current project (real data — these ids are safe to use)',
        `Canvas ${summary.width}×${summary.height}px · duration ${summary.duration}ms · ${summary.fps}fps`,
        ...layers,
      ].join('\n');
}

/* ---------------------------------------------------------------- 各形态 */

/** 通用大模型：产出 JSON，粘回应用执行 */
export function buildChatPrompt(opts: PromptOptions = {}): string {
  const { text, count } = catalogText();
  const context = opts.includeProject ? projectContext(opts.project) : '';
  return `你是 Kinelayer 的动态海报编辑助手。用户用一句话描述想要的效果，你把它翻译成一组可执行命令。

## 硬性规则
1. 只能用下面清单里的命令（共 ${count} 条），不要发明命令，不要臆造参数名。
2. 坐标单位是画布像素，原点在左上角，x/y 指图层左上角；不确定位置就用画布中心推算。
3. 引用已有图层时，id 必须来自「当前项目」；没有给 id 就先让用户导出一份项目 JSON 或截图说明。
4. 两条以上命令必须合并成一条 command.batch（atomic=true），这样用户按一次撤销就能全部回退。
5. 不要删除背景层（它在数组第 0 位，已锁定）；删除图层、加载项目这类危险操作要先说明后果。
6. 文本样式字段：${TEXT_FIELDS}。
7. 动画写在 animation 里：{ enter: { preset, duration, delay, easing, intensity }, exit: {…}, emphasis: {…} }。
   preset 可选：${PRESETS}。
   easing 可选：${EASINGS}。

## 命令清单（\`*\` 必填、\`?\` 可选）
${text}

## 常用配方
1. 加一行标题：
   {"type":"layer.create","payload":{"type":"text","text":"可编程的动态海报","x":120,"y":1100,"width":840,"height":140,"textStyle":{"fontSize":64,"fontWeight":800,"color":"#F4F1FF","align":"left","lineHeight":1.2}}}
2. 换渐变背景：
   {"type":"background.set","payload":{"kind":"gradient","gradient":{"type":"linear","angle":135,"stops":[{"offset":0,"color":"#05070c"},{"offset":1,"color":"#2a1147"}]}}}
3. 让某个图层淡入：
   {"type":"layer.update","payload":{"id":"ly_xxx","patch":{"animation":{"enter":{"preset":"fade","duration":800,"delay":0,"easing":"ease-out","intensity":0.6}}}}}
4. 改画布尺寸 / 时长：
   {"type":"canvas.resize","payload":{"width":1080,"height":1080,"scaleContent":true}}
   {"type":"canvas.setDuration","payload":{"duration":6000}}
5. 批量（多步操作一定用这个）：
   {"type":"command.batch","payload":{"commands":[{"type":"layer.create","payload":{"type":"text","text":"A"}},{"type":"layer.update","payload":{"id":"ly_xxx","patch":{"opacity":0.8}}}],"atomic":true}}

## 输出格式（严格）
只输出一个 JSON 对象，不要 markdown 代码围栏、不要在 JSON 外写解释：
{"reply":"一句中文说明你改了什么","commands":[{"type":"layer.update","payload":{}}]}

commands 有 1~50 条，应用会按顺序执行并合成一个撤销点。参数拿不准时，宁可在 reply 里反问用户，也不要猜。${context}`;
}

/** MCP 客户端：模型能直接调工具，提示词只讲策略 */
export function buildMcpPrompt(opts: PromptOptions = {}): string {
  const context = opts.includeProject ? projectContext(opts.project) : '';
  return `你现在接入了 Kinelayer 的 MCP 服务，可以直接修改用户正在编辑的动态海报。

## 工作方式
1. 先读资源 kinelayer://project，拿到画布尺寸、时长与图层 id；不要凭空编 id。
2. 工具名是命令类型的双下划线写法：layer__create 就是命令 layer.create。
3. 工具入参就是命令 payload，schema 已由编辑器命令注册表自动生成，照它填即可。
4. 多步改动优先用 command__batch（atomic=true），一次调用只产生一个撤销点。
5. 危险命令（删图层、加载/新建项目）执行前先用一句话说明后果。
6. 改完把关键结果讲清楚：新建了什么、id 是多少、用户怎么继续调整。

## 常用命令
- layer.create / layer.update / layer.delete / layer.duplicate / layer.reorder
- text.set / text.setStyle、background.set、canvas.resize、canvas.setDuration
- code.setSource、timeline.setRange、export.png、export.webm
- query.project / query.layer / query.registry（先查再改）
${context}`;
}

/** OpenAI function calling：直接给 tools 数组 */
export function buildToolsJson(): string {
  return JSON.stringify(buildToolSchemas().map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  })), null, 2);
}

/* ------------------------------------------------- 桌面 Agent 接入说明 */

/**
 * 给「电脑端 Agent 工具」的接入提示词。
 *
 * 与上面三种形态的区别：
 *   chat / mcp / tools 服务于「模型怎么写命令」；
 *   这一份服务于「本机 agent 进程怎么接进来、能碰什么、碰不到什么」——
 *   也就是把桥接协议、调用契约、权限边界一次讲清楚，
 *   让 Claude Desktop / Cursor / Codex CLI / 自建脚本这类东西照着自己就能接上，
 *   同时明确它**不是**第二个编辑器，不许绕开总线。
 *
 * 文本里的协议字段、错误码、命令清单、危险命令全部来自代码常量与注册表，
 * 不手写：协议改了这里跟着改，命令加了这里自动多一条。
 */
export function buildDesktopAgentPrompt(opts: PromptOptions = {}): string {
  const zh = (getLocale() ?? 'zh-CN') === 'zh-CN';
  const rows = buildCatalog(zh);
  const defs = listCommands();
  const dangerous = defs.filter((d) => d.dangerous).map((d) => d.type);
  const groups = new Map<string, CatalogRow[]>();
  for (const row of rows) {
    const list = groups.get(row.category) ?? [];
    list.push(row);
    groups.set(row.category, list);
  }
  const catalog = [...groups.entries()]
    .map(([category, list]) => {
      const lines = list.map(
        (r) => `- ${r.type}(${r.signature})${r.dangerous ? (zh ? ' ⚠危险' : ' [dangerous]') : ''}${zh ? ` —— ${r.summary}` : ''}`,
      );
      return `[${zh ? category : tIn('en-US', category)}] (${list.length})\n${lines.join('\n')}`;
    })
    .join('\n\n');

  const context = opts.includeProject ? projectContext(opts.project, zh) : '';
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');

  if (!zh) return buildDesktopAgentPromptEn({ catalog, dangerous, count: rows.length, stamp, context });

  return `# Kinelayer · 桌面 Agent 接入说明

> 生成时间 ${stamp} · 命令 ${rows.length} 条 · schemaVersion 2 · 由命令注册表与协议常量自动生成

## 0. 你在操作什么

Kinelayer 是一个跑在用户浏览器里的动态海报编辑器。**编辑器（Host）是唯一权威**：
唯一执行、唯一撤销栈、唯一主时钟。你不是第二个编辑器，也没有 DOM 写权限——
你唯一的写入口是**命令总线**：把结构化命令发给本机桥接（127.0.0.1:2718），由编辑器执行并广播结果。

先记住这条：**任何绕过总线直接改界面/存储的尝试，都是错的。**

## 1. 两种接入方式（选一种）

### A. MCP（推荐：Claude Desktop / Cursor / Codex CLI）

1. 本机运行 \`npm run bridge\` —— 打印令牌，首次运行写入 \`agent-bridge/.token\`
2. 本机运行 \`npm run mcp\`，把 \`agent-bridge/claude-desktop-config.json\` 的内容贴进客户端配置
3. 打开编辑器 →「设置 → Agent 桥接」→ 填 \`ws://127.0.0.1:2718\` + 同一令牌 → 点连接

- 工具名 = 命令类型把 \`.\` 换成 \`__\`：\`layer.create\` → \`layer__create\`
- 资源：\`kinelayer://project\`（项目摘要）、\`kinelayer://registry\`（命令清单）
- 工具入参就是命令的 \`payload\`，schema 由注册表自动生成，照它填

### B. 直连（自建脚本：HTTP 或 WebSocket）

\`\`\`bash
# 免令牌的健康检查
curl http://127.0.0.1:2718/health
\`\`\`

| 用途 | 请求 |
| --- | --- |
| 读清单 | \`GET /manifest\`，头 \`x-kinelayer-token: <token>\` |
| 执行命令 | \`POST /command\`，体 \`{"type":"layer.update","payload":{…},"dryRun":false,"expectedVersion":12}\` |
| WS 连接 | \`ws://127.0.0.1:2718/?role=agent&token=<token>\` |

WebSocket 消息（JSON，一问一答）：

\`\`\`text
→ {"kind":"call","id":"1","type":"layer.update","payload":{…},"dryRun":true}
← {"kind":"call.result","id":"1","result":{ok,data,error,projectVersion,commandId,durationMs}}
→ {"kind":"manifest.get","id":"2"}
← {"kind":"manifest","id":"2",tools:[…],summary:{…},projectVersion,playhead}
\`\`\`

## 2. 你可以做什么（${rows.length} 条命令，按分类）

**读取类**：\`query.project\` \`query.layer\` \`query.registry\` \`query.capture\`（截图返回 dataURL，只在本机流转）
**写入类**：图层增删改、文本、代码层、背景、画布尺寸与时长、时间轴、关键帧轨道、资源与字体
**执行类**：\`export.png\` \`export.webm\` \`export.json\`（结果进浏览器下载，不落任意路径）

${catalog}

## 3. 调用契约（必须遵守）

1. **先读后写**：用 \`query.project\` 或 \`manifest.summary\` 拿真实 id，不要编 id。
2. **多步合成一条**：两个以上的改动合并成 \`command.batch\`（\`atomic:true\`），用户按一次撤销全部回退；任一条失败整体回滚。
3. **不确定就试算**：\`dryRun:true\` 只校验不落盘、不产生撤销点。参数拿不准时先跑 dryRun。
4. **并发写要带锁**：写命令带上 \`expectedVersion\`（取自上次结果的 \`projectVersion\`）。收到 \`CONFLICT\` 就重新读一次再改，不要盲目重试。
5. **串行发送**：总线是串行队列，一条做完再下一条。不要并发轰炸。
6. **时间单位是毫秒**；关键帧时间**相对图层 \`inPoint\`**，不是绝对时间。
7. **重复发送不等于生效**：同一条写命令重发会多出撤销点。确认结果看 \`ok\` 与 \`projectVersion\`，不要靠重发。

## 4. 权限边界（越界的事做不到，也不许做）

**允许**
- 读 \`/manifest\`、读项目摘要、执行查询类命令
- 发命令修改图层、文本、背景、时间轴、关键帧
- 触发导出（由浏览器下载）

**不允许 / 做不到**
- **网络**：桥接只监听 \`127.0.0.1\`，不对外；你也拿不到任何其它站点的数据
- **密钥**：AI API Key 用 AES-GCM 存在 IndexedDB，任何命令返回值都不含它——不存在「读出来」的接口
- **二进制**：图片/视频/字体存在 IndexedDB，命令只传 \`assetId\`；\`asset.import\` 需要用户给出的 dataURL
- **文件系统**：没有任何读写本地文件的命令；导出走浏览器下载，你不能指定落盘路径
- **越权批准**：标了危险的命令必须由用户在界面上点确认。你不能代替用户批准，也不能声称已获批准
- **绕过校验**：不要用 \`project.load\` 整包覆盖来跳过单条命令的 schema 校验
- **改宿主**：不要尝试改 DOM、localStorage、IndexedDB；\`window.__kly\` 只是 dev 构建的调试口，生产里不存在

## 5. 危险命令（执行前必须先说明后果）

${dangerous.length ? dangerous.map((d) => `- \`${d}\``).join('\n') : '- （无）'}

这类命令的语义是「可能毁掉用户已经做的东西」。正确做法：先用一句话说清会发生什么，等用户同意再发。

## 6. 错误码怎么处理

| code | 含义 | 你该做什么 |
| --- | --- | --- |
| \`VALIDATION\` | payload 不符合 schema | 按返回信息修正字段，不要重发同样的 body |
| \`NOT_FOUND\` | 图层/资源 id 不存在 | 重新 \`query.project\` 取真实 id |
| \`CONFLICT\` | 乐观锁版本冲突 | 重读 \`projectVersion\` 再提交 |
| \`FORBIDDEN\` | 被规则拒绝（删背景层、改锁定层等） | 换策略，不要硬试 |
| \`RUNTIME\` | 宿主执行期异常 | 把 message 原样转告用户 |

## 7. 交付话术

改完用一句话说清四件事：**改了什么 · 影响几个图层 · 关键 id · 用户怎么继续调**。
用户没有要求时不要连发多条写命令，也不要顺手改无关图层。${context}
`;
}

function buildDesktopAgentPromptEn(a: {
  catalog: string;
  dangerous: string[];
  count: number;
  stamp: string;
  context: string;
}): string {
  return `# Kinelayer · Desktop agent integration

> Generated ${a.stamp} · ${a.count} commands · schemaVersion 2 · derived from the command registry and the bridge protocol

## 0. What you are operating

Kinelayer is a motion-poster editor running inside the user's browser. **The editor (Host) is the only
authority**: one executor, one undo stack, one master clock. You are not a second editor, and you have no DOM
write access — your only write path is the **command bus**: send structured commands to the local bridge
(127.0.0.1:2718) and the editor executes and broadcasts the result.

Remember this one line: **any attempt to bypass the bus and touch the UI or storage directly is wrong.**

## 1. Two ways in (pick one)

### A. MCP (recommended: Claude Desktop / Cursor / Codex CLI)

1. Run \`npm run bridge\` locally — it prints a token and writes \`agent-bridge/.token\` on first run
2. Run \`npm run mcp\`, then paste \`agent-bridge/claude-desktop-config.json\` into your client config
3. In the editor open **Settings → Agent bridge**, enter \`ws://127.0.0.1:2718\` plus the same token, connect

- Tool name = command type with \`.\` replaced by \`__\`: \`layer.create\` → \`layer__create\`
- Resources: \`kinelayer://project\` (project summary), \`kinelayer://registry\` (command list)
- Tool arguments are the command \`payload\`; the schema is generated from the registry — just follow it

### B. Direct (your own script: HTTP or WebSocket)

\`\`\`bash
# health check, no token needed
curl http://127.0.0.1:2718/health
\`\`\`

| Purpose | Request |
| --- | --- |
| Read manifest | \`GET /manifest\` with header \`x-kinelayer-token: <token>\` |
| Run a command | \`POST /command\`, body \`{"type":"layer.update","payload":{…},"dryRun":false,"expectedVersion":12}\` |
| WebSocket | \`ws://127.0.0.1:2718/?role=agent&token=<token>\` |

WebSocket messages (JSON, request/response):

\`\`\`text
→ {"kind":"call","id":"1","type":"layer.update","payload":{…},"dryRun":true}
← {"kind":"call.result","id":"1","result":{ok,data,error,projectVersion,commandId,durationMs}}
→ {"kind":"manifest.get","id":"2"}
← {"kind":"manifest","id":"2",tools:[…],summary:{…},projectVersion,playhead}
\`\`\`

## 2. What you can do (${a.count} commands, by category)

**Read**: \`query.project\` \`query.layer\` \`query.registry\` \`query.capture\` (screenshots come back as dataURL, local only)
**Write**: layers, text, code layers, background, canvas size and duration, timeline, keyframe tracks, assets and fonts
**Run**: \`export.png\` \`export.webm\` \`export.json\` (results go through the browser's download flow)

${a.catalog}

## 3. Contract (mandatory)

1. **Read before you write**: get real ids from \`query.project\` or \`manifest.summary\`; never invent ids.
2. **Collapse multi-step edits**: two or more changes go into one \`command.batch\` (\`atomic:true\`) so the user can undo them all at once; one failure rolls the batch back.
3. **Dry-run when unsure**: \`dryRun:true\` validates without persisting and without creating an undo entry.
4. **Lock concurrent writes**: send \`expectedVersion\` (from the previous \`projectVersion\`). On \`CONFLICT\`, re-read and retry — do not blindly hammer.
5. **Send serially**: the bus is a serial queue. One command at a time.
6. **Times are milliseconds**; keyframe times are **relative to the layer's \`inPoint\`**, not absolute.
7. **Re-sending is not retrying**: a duplicate write creates an extra undo entry. Judge success by \`ok\` and \`projectVersion\`.

## 4. Permission boundaries (out of reach — and out of bounds)

**Allowed**
- Read \`/manifest\`, read the project summary, run query commands
- Send commands that change layers, text, background, timeline, keyframes
- Trigger exports (the browser downloads them)

**Not allowed / not possible**
- **Network**: the bridge binds to \`127.0.0.1\` only and does not face the internet; you cannot reach any other site through it
- **Secrets**: the AI API key is AES-GCM encrypted in IndexedDB and never appears in any command result — there is no interface that reads it out
- **Binaries**: images/videos/fonts live in IndexedDB; commands carry an \`assetId\` only. \`asset.import\` needs a dataURL the user supplies
- **Filesystem**: no command reads or writes local files; exports go through the browser download flow and you cannot choose a path
- **Approvals**: commands marked dangerous require the user to confirm in the UI. You may not approve on their behalf, nor claim approval was given
- **Bypassing validation**: do not use \`project.load\` to overwrite everything just to skip per-command schema checks
- **Touching the host**: do not modify DOM, localStorage or IndexedDB. \`window.__kly\` exists only in dev builds and is absent in production

## 5. Dangerous commands (state the consequences first)

${a.dangerous.length ? a.dangerous.map((d) => `- \`${d}\``).join('\n') : '- (none)'}

These can destroy work the user already did. Say what will happen in one sentence and wait for agreement.

## 6. Error codes

| code | Meaning | What to do |
| --- | --- | --- |
| \`VALIDATION\` | payload failed the schema | fix the field and resubmit; do not resend the same body |
| \`NOT_FOUND\` | layer/asset id does not exist | re-read via \`query.project\` |
| \`CONFLICT\` | optimistic-lock version mismatch | re-read \`projectVersion\`, then retry |
| \`FORBIDDEN\` | blocked by a rule (deleting the background, editing a locked layer) | change approach, do not force it |
| \`RUNTIME\` | the host threw during execution | relay the message to the user verbatim |

## 7. Reporting back

After an edit, say four things in one sentence: **what changed · how many layers were touched · the key ids ·
how the user continues**. Do not fire off extra writes the user did not ask for, and do not touch unrelated layers.${a.context}
`;
}

/** 桌面 Agent 说明的下载版：正文 + 清单摘要 */
export function buildDesktopAgentBundle(opts: PromptOptions = {}): string {
  return buildDesktopAgentPrompt(opts);
}

/** 供「下载 .md」用：三种形态打包，附接入步骤 */
export function buildMarkdownBundle(opts: PromptOptions = {}): string {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  return `# Kinelayer AI 接入提示词

> 生成时间：${stamp} · 命令数：${listCommands().length} · 由命令注册表自动生成

## 方式一：任意大模型（把回复粘回应用执行）

\`\`\`text
${buildChatPrompt(opts)}
\`\`\`

## 方式二：MCP 客户端（Claude Desktop / Cursor）

1. 本机运行 \`npm run bridge\`（默认 127.0.0.1:2718，令牌写在 agent-bridge/.token）
2. 本机运行 \`npm run mcp\`，把 agent-bridge/claude-desktop-config.json 里的配置贴进客户端
3. 编辑器「设置 → Agent 桥接」填同样的地址与令牌，点连接

\`\`\`text
${buildMcpPrompt(opts)}
\`\`\`

## 方式三：Function Calling（自建 Agent）

\`\`\`json
${buildToolsJson()}
\`\`\`
`;
}

/* ------------------------------------------------------------ 回复解析 */

export interface ParsedPlan {
  reply: string;
  commands: { type: string; payload: unknown }[];
  /** 解析过程中的宽容提示，例如「已忽略 1 条未知命令」 */
  warnings: string[];
}

/** 把模型回复解析成命令数组：容忍代码围栏、前后废话、单条命令、直接数组 */
export function parsePlan(raw: string): ParsedPlan {
  const warnings: string[] = [];
  const cleaned = raw
    .replace(/^\uFEFF/, '')
    .replace(/```(?:json)?/gi, '')
    .trim();

  const start = cleaned.indexOf('{');
  const arrStart = cleaned.indexOf('[');
  const useArray = arrStart >= 0 && (start < 0 || arrStart < start);
  const sliceFrom = useArray ? arrStart : start;
  if (sliceFrom < 0) throw new Error('回复里没有找到 JSON');

  // 从第一个 { 或 [ 开始做括号配对，忽略字符串里的括号
  const open = cleaned[sliceFrom];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let i = sliceFrom; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('JSON 括号没有闭合');

  const parsed = JSON.parse(cleaned.slice(sliceFrom, end + 1)) as unknown;

  let reply = '';
  let list: unknown = parsed;

  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    reply = typeof obj.reply === 'string' ? obj.reply : '';
    if (Array.isArray(obj.commands)) list = obj.commands;
    else if (typeof obj.type === 'string' && obj.type === 'command.batch') {
      const payload = (obj.payload ?? {}) as { commands?: unknown };
      list = Array.isArray(payload.commands) ? payload.commands : [];
    } else if (typeof obj.type === 'string') {
      list = [obj];
    } else {
      list = [];
    }
  }

  if (!Array.isArray(list) || !list.length) throw new Error('没有解析到任何命令');

  const commands: ParsedPlan['commands'] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      warnings.push('忽略了一条非对象命令');
      continue;
    }
    const cmd = item as { type?: unknown; payload?: unknown };
    if (typeof cmd.type !== 'string' || !cmd.type.trim()) {
      warnings.push('忽略了一条缺少 type 的命令');
      continue;
    }
    commands.push({ type: cmd.type.trim(), payload: cmd.payload ?? {} });
  }
  if (!commands.length) throw new Error('命令全部不合法');
  if (commands.length > 50) throw new Error('一次最多 50 条命令，请分批执行');
  return { reply, commands, warnings };
}
