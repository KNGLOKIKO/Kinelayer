import { buildToolSchemas, fromToolName, listCommands, type AnyCommandDef } from '@/core/registry';
import { zAnimPreset, zEasing, zTextStyle } from '@/core/schemas';
import { summarizeProject } from '@/core/summary';
import type { Project } from '@/core/types';

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
function signatureOf(inputSchema: JsonSchema): string {
  const props = (inputSchema.properties as Record<string, JsonSchema> | undefined) ?? {};
  const required = new Set((inputSchema.required as string[] | undefined) ?? []);
  const parts = Object.entries(props).map(([key, schema]) => {
    const t = shortType(schema);
    return `${key}${required.has(key) ? '*' : '?'}${t ? `:${t}` : ''}`;
  });
  if (!parts.length) return '无参数';
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

function buildCatalog(): CatalogRow[] {
  const defs = new Map<string, AnyCommandDef>(listCommands().map((d) => [d.type, d]));
  return buildToolSchemas().map((tool) => {
    const type = fromToolName(tool.name);
    const def = defs.get(type);
    return {
      type,
      category: def?.category ?? '其他',
      signature: signatureOf(tool.inputSchema),
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

function projectContext(project?: Project): string {
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
    const text = l.text ? ` 文本「${l.text.replace(/\n/g, ' ').slice(0, 40)}」` : '';
    return `- ${l.id} · ${l.type} · ${l.name} · box=[${box}]${text}`;
  });
  return [
    '',
    '## 当前项目（真实数据，id 可直接引用）',
    `画布 ${summary.width}×${summary.height}px · 时长 ${summary.duration}ms · ${summary.fps}fps`,
    ...layers,
  ].join('\n');
}

/* ---------------------------------------------------------------- 各形态 */

/** 通用大模型：产出 JSON，粘回应用执行 */
export function buildChatPrompt(opts: PromptOptions = {}): string {
  const { text, count } = catalogText();
  const context = opts.includeProject ? projectContext(opts.project) : '';
  return `你是 MotionLayer（层动）的动态海报编辑助手。用户用一句话描述想要的效果，你把它翻译成一组可执行命令。

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
  return `你现在接入了 MotionLayer（层动）的 MCP 服务，可以直接修改用户正在编辑的动态海报。

## 工作方式
1. 先读资源 motionlayer://project，拿到画布尺寸、时长与图层 id；不要凭空编 id。
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

/** 供「下载 .md」用：三种形态打包，附接入步骤 */
export function buildMarkdownBundle(opts: PromptOptions = {}): string {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  return `# MotionLayer AI 接入提示词

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
