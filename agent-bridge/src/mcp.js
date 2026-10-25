#!/usr/bin/env node
/**
 * Kinelayer MCP Server —— stdio 传输
 * ---------------------------------------------------------------------------
 * 这个文件里**没有一个工具是手写的**。
 * 启动后它会向 bridge 要一份 manifest（编辑器命令注册表实时导出的 JSON Schema），
 * 把每个命令映射成一个 MCP 工具：layer.create -> layer__create。
 *
 * 这样做的好处（也是本项目第五条铁律的落地方式）：
 *   · 新增一条命令，只需要在 src/core/commands/ 里注册，MCP / OpenAI / 人类 UI 同时获得能力；
 *   · 工具的入参校验天然与命令的 zod schema 一致，不存在「文档写的和实际收的不一样」；
 *   · 不维护第二套 handler 映射表——调用时只做 name -> type 的反解，然后交给命令总线。
 *
 * 与 bridge 的分工：mcp.js 面向 LLM 客户端（Claude Desktop / Cursor 等），
 * bridge.js 面向本机进程与浏览器；两者都只是搬运 Command，不实现任何编辑逻辑。
 *
 * 环境变量：
 *   KINELAYER_BRIDGE_URL   默认 ws://127.0.0.1:2718/ws
 *   KINELAYER_BRIDGE_TOKEN 默认读 agent-bridge/.token（即 bridge 首次启动生成的那份）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';

const VERSION = '0.1.0';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = path.resolve(HERE, '..');
const CACHE_DIR = path.join(BRIDGE_DIR, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'manifest.json');
const CALL_TIMEOUT_MS = 45_000;
const RECONNECT_MS = 2_000;

/* ------------------------------------------------------------------ 配置 */

function readToken() {
  if (process.env.KINELAYER_BRIDGE_TOKEN) return process.env.KINELAYER_BRIDGE_TOKEN.trim();
  try {
    return fs.readFileSync(path.join(BRIDGE_DIR, '.token'), 'utf8').trim();
  } catch {
    return '';
  }
}

const TOKEN = readToken();
const BRIDGE_URL = (process.env.KINELAYER_BRIDGE_URL || 'ws://127.0.0.1:2718/ws').trim();

/**
 * stdio 模式下 stdout 是协议通道，任何 console.log 都会污染 JSON-RPC 流。
 * 所以本文件里只允许 console.error（stderr 归客户端日志）。
 */
function note(...args) {
  console.error('[kinelayer-mcp]', ...args);
}

/* -------------------------------------------------------------- 状态缓存 */

/** @type {{ tools: any[], summary: any, projectVersion: number, playhead: number, ts: number } | null} */
let manifest = loadCache();
let connected = false;

function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.tools)) return parsed;
  } catch {
    /* 首次运行没有缓存，正常 */
  }
  return null;
}

function saveCache(next) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    // 只缓存工具签名与最小摘要，避免把整份项目快照落盘
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ tools: next.tools, summary: null, projectVersion: next.projectVersion, playhead: next.playhead, ts: next.ts }, null, 2),
    );
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

/* ------------------------------------------------------- WebSocket 客户端 */

/** @type {WebSocket | null} */
let socket = null;
let reconnectTimer = null;
const pending = new Map();
let callSeq = 0;
let stopped = false;

function connect() {
  if (stopped) return;
  const url = `${BRIDGE_URL}${BRIDGE_URL.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}&role=agent`;
  let ws;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    note(`连接失败：${err.message}，2 秒后重试`);
    scheduleReconnect();
    return;
  }
  socket = ws;

  ws.on('open', () => {
    connected = true;
    note(`已连接 bridge ${BRIDGE_URL}`);
    send({ kind: 'manifest.get', id: 'boot' });
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.kind === 'manifest') {
      applyManifest(msg);
      return;
    }
    if (msg.kind === 'call.result' && msg.id) {
      const slot = pending.get(msg.id);
      if (!slot) return;
      clearTimeout(slot.timer);
      pending.delete(msg.id);
      slot.resolve(msg.result);
      return;
    }
    if (msg.kind === 'error' && msg.error) {
      note(`bridge 报错：${msg.error.message}`);
    }
  });

  ws.on('close', () => {
    connected = false;
    socket = null;
    // 在途调用全部快速失败，不让 LLM 客户端卡 45 秒
    for (const [id, slot] of pending) {
      clearTimeout(slot.timer);
      slot.resolve({ ok: false, error: { code: 'BRIDGE_GONE', message: '与本地 bridge 的连接中断' }, projectVersion: manifest?.projectVersion ?? 0 });
      pending.delete(id);
    }
    scheduleReconnect();
  });

  ws.on('error', () => {
    /* close 会紧跟着触发，这里静默即可 */
  });
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
  reconnectTimer.unref?.();
}

function send(packet) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(packet));
    return true;
  }
  return false;
}

function applyManifest(msg) {
  const previousNames = manifest ? manifest.tools.map((t) => t.name).join(',') : '';
  manifest = {
    tools: Array.isArray(msg.tools) ? msg.tools : [],
    summary: msg.summary ?? manifest?.summary ?? null,
    projectVersion: msg.projectVersion ?? 0,
    playhead: msg.playhead ?? 0,
    ts: msg.ts ?? Date.now(),
  };
  const nextNames = manifest.tools.map((t) => t.name).join(',');
  if (nextNames !== previousNames) {
    note(`工具清单更新：${manifest.tools.length} 个命令`);
    saveCache(manifest);
    // 通知客户端重新拉取 tools/list；没实现的客户端会忽略，无副作用
    server.sendToolListChanged().catch(() => {});
    server.sendResourceListChanged().catch(() => {});
  }
}

/** 把一个命令请求转成 bridge 的 call 包，等 host 回结果 */
function callHost(type, payload) {
  const id = `m${++callSeq}`;
  if (!send({ kind: 'call', id, type, payload })) {
    return Promise.resolve({
      ok: false,
      error: { code: 'NO_BRIDGE', message: 'MCP 还没连上本地 bridge：请先在另一个终端运行 `npm run bridge`' },
      projectVersion: manifest?.projectVersion ?? 0,
    });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: { code: 'TIMEOUT', message: `命令 ${type} 超时（${CALL_TIMEOUT_MS / 1000}s）` }, projectVersion: manifest?.projectVersion ?? 0 });
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, timer });
  });
}

/* --------------------------------------------------------------- MCP 层 */

const server = new Server(
  { name: 'kinelayer', version: VERSION },
  {
    capabilities: {
      tools: { listChanged: true },
      resources: { listChanged: true },
    },
    instructions: [
      'Kinelayer 是一个可编程的动态海报编辑器。你能通过工具直接编辑用户当前打开的海报。',
      '',
      '工作方式：',
      '1. 先读资源 kinelayer://project，了解画布尺寸、时长、图层列表（含 id / 类型 / 文本内容）。',
      '2. 所有工具名形如 layer__create，对应命令类型 layer.create（双下划线是点号的转义）。',
      '3. 修改前尽量用 query__layers / query__project 拿到真实 id，不要凭空编造。',
      '4. 用户的撤销栈是共享的：一次有意义的改动 = 一条命令；批量创建请优先用 batch__run 合成一个撤销点。',
      '5. 危险命令（删除图层、清空项目、加载项目）会被标记，执行后请在回复里明确告知用户。',
      '6. 一切修改都走命令总线：编辑器会记录审计日志，用户随时可以 Ctrl+Z 撤销。',
    ].join('\n'),
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: (manifest?.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};
  const type = name.replace(/__/g, '.');

  const known = manifest?.tools?.some((t) => t.name === name);
  if (manifest && !known) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `没有名为 ${name} 的命令。当前可用命令（前 30 个）：\n${manifest.tools.slice(0, 30).map((t) => t.name).join('\n')}\n\n命令清单会随编辑器版本变化，可用 resources/read kinelayer://registry 拉全量。`,
        },
      ],
    };
  }

  const result = await callHost(type, args);
  const text = JSON.stringify(result, null, 2);
  if (!result || result.ok !== true) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `命令 ${type} 失败：\n${text}\n\n排错顺序：① bridge 是否在跑（npm run bridge）② 编辑器是否点了「连接」③ 参数是否符合 schema。`,
        },
      ],
    };
  }
  return {
    isError: false,
    content: [
      {
        type: 'text',
        text: `命令 ${type} 执行成功（项目版本 ${result.projectVersion}）：\n${text}`,
      },
    ],
  };
});

/* 资源：把项目上下文暴露成 MCP resource，比塞进工具描述更省 token */

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'kinelayer://project',
      name: '当前项目摘要',
      description: '画布尺寸、时长、帧率、图层列表（不含二进制资源），每次修改后自动更新',
      mimeType: 'application/json',
    },
    {
      uri: 'kinelayer://registry',
      name: '命令注册表',
      description: '全部命令的类型、分类、说明与示例 payload（工具 schema 的单一数据源）',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  if (uri === 'kinelayer://project') {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(
            manifest?.summary ?? { note: '编辑器尚未连接，或项目摘要还没同步过来' },
            null,
            2,
          ),
        },
      ],
    };
  }
  if (uri === 'kinelayer://registry') {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(
            (manifest?.tools ?? []).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
            null,
            2,
          ),
        },
      ],
    };
  }
  throw new Error(`未知资源：${uri}`);
});

/* ----------------------------------------------------------------- 启动 */

async function main() {
  if (!TOKEN) {
    note('警告：没找到 bridge 令牌（agent-bridge/.token）。请先跑一次 `npm run bridge`，再用 KINELAYER_BRIDGE_TOKEN 手动指定。');
  }
  connect();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  note(`MCP stdio 就绪 · bridge=${BRIDGE_URL} · 已缓存工具 ${manifest?.tools?.length ?? 0} 个`);
}

function shutdown() {
  stopped = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  try {
    socket?.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  note(`启动失败：${err.stack || err.message}`);
  process.exit(1);
});
