#!/usr/bin/env node
/**
 * Kinelayer Bridge —— 本地命令中继
 * ---------------------------------------------------------------------------
 * 职责边界（刻意做得很薄，不含任何业务逻辑）：
 *   · 编辑器（Host）作为 WS 客户端连进来，declare 自己是 role=host；
 *   · 外部 Agent（MCP Server / 你自己的脚本）以 role=agent 连进来；
 *   · Bridge 只做三件事：鉴权、把 agent 的 command 转给 host、把 host 的 result 转回 agent；
 *   · 顺带缓存一份 host 上报的 manifest（工具清单 + 项目摘要），让 Agent 在
 *     编辑器没连上时也能列出工具、给出友好的「Host 未连接」错误。
 *
 * 为什么不在 Bridge 里判断「这个命令安不安全」：
 *   权限与校验的唯一权威是 Host 的命令总线。Bridge 一旦开始自己做判断，
 *   就出现了第二个真相源，人类 UI / AI / Agent 的行为会分叉。
 *
 * 用法：
 *   node agent-bridge/src/bridge.js                 # 默认 127.0.0.1:2718
 *   node agent-bridge/src/bridge.js --port 2718     # 指定端口
 *   node agent-bridge/src/bridge.js --token abc123  # 指定令牌（多人协作/固定配置时用）
 *   KINELAYER_BRIDGE_TOKEN=abc123 npm run bridge           # 用环境变量给令牌
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const VERSION = '0.1.0';
const DEFAULT_PORT = 2718;
const BIND_HOST = '127.0.0.1';
const COMMAND_TIMEOUT_MS = 30_000;
const HEARTBEAT_MS = 15_000;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = path.resolve(HERE, '..');
const TOKEN_FILE = path.join(BRIDGE_DIR, '.token');

/* ------------------------------------------------------------------ 终端着色 */

const tty = process.stdout.isTTY;
const paint = (code) => (s) => (tty ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const c = {
  dim: paint('2'),
  bold: paint('1'),
  cyan: paint('36'),
  green: paint('32'),
  yellow: paint('33'),
  red: paint('31'),
  magenta: paint('35'),
};

function log(tag, msg, color = c.dim) {
  const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`${c.dim(stamp)} ${color(tag.padEnd(8))} ${msg}`);
}

/* -------------------------------------------------------------------- 参数 */

function parseArgs(argv) {
  const out = { port: Number(process.env.KINELAYER_BRIDGE_PORT || DEFAULT_PORT), token: '', quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--port' || a === '-p') out.port = Number(argv[++i]);
    else if (a === '--token' || a === '-t') out.token = String(argv[++i] ?? '');
    else if (a === '--quiet' || a === '-q') out.quiet = true;
    else if (a === '--help' || a === '-h') {
      console.log('用法: node src/bridge.js [--port 2718] [--token <令牌>] [--quiet]');
      process.exit(0);
    }
  }
  if (!Number.isFinite(out.port) || out.port <= 0 || out.port > 65535) out.port = DEFAULT_PORT;
  return out;
}

const args = parseArgs(process.argv.slice(2));

/**
 * 令牌优先级：命令行 > 环境变量 > 持久化文件 > 新生成并落盘。
 * 落盘的意义：重启 bridge 不用回设置面板改一遍令牌（开发者体验 > 洁癖）。
 */
function resolveToken() {
  if (args.token) return args.token.trim();
  if (process.env.KINELAYER_BRIDGE_TOKEN) return process.env.KINELAYER_BRIDGE_TOKEN.trim();
  try {
    const saved = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (saved.length >= 8) return saved;
  } catch {
    /* 首次运行，文件不存在 */
  }
  const fresh = crypto.randomBytes(4).toString('hex');
  try {
    fs.writeFileSync(TOKEN_FILE, fresh, { mode: 0o600 });
  } catch {
    /* 只读文件系统：退化为内存令牌 */
  }
  return fresh;
}

const TOKEN = resolveToken();

/* -------------------------------------------------------------------- 状态 */

/** @type {import('ws').WebSocket | null} */
let hostSocket = null;
/** @type {Set<import('ws').WebSocket>} */
const agentSockets = new Set();
/** 最近一次 host 上报的 manifest（工具单一数据源的快照） */
let manifest = null;
/** 进行中的转发请求 id -> { resolve, timer, target } */
const pending = new Map();
let seq = 0;

const nextId = () => `c${++seq}`;

/* --------------------------------------------------------------- HTTP 层 */

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    // 本地工具，允许任意来源（仍有 token 门禁）
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-kinelayer-token, x-ml-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  res.end(payload);
}

function checkHttpToken(req, url) {
  /* 旧版头名保留了兼容：老脚本不用改就能继续连 */
  const header = req.headers['x-kinelayer-token'] ?? req.headers['x-ml-token'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const fromQuery = url.searchParams.get('token') ?? '';
  return (fromHeader ?? '') === TOKEN || fromQuery === TOKEN;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        reject(new Error('请求体超过 4MB'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${BIND_HOST}:${args.port}`);

  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }

  if (url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      service: 'kinelayer-bridge',
      version: VERSION,
      host: !!hostSocket,
      agents: agentSockets.size,
      projectVersion: manifest?.projectVersion ?? null,
      uptime: Math.round(process.uptime()),
    });
    return;
  }

  if (!checkHttpToken(req, url)) {
    json(res, 401, { ok: false, error: { code: 'UNAUTHORIZED', message: '令牌不正确（HTTP 需要 x-kinelayer-token 头或 ?token= 参数）' } });
    return;
  }

  if (url.pathname === '/manifest' && req.method === 'GET') {
    if (!manifest) {
      json(res, 503, { ok: false, error: { code: 'NO_HOST', message: '编辑器还没连上 bridge：请打开 Kinelayer 并在「设置 → Agent 桥接」点连接' } });
      return;
    }
    json(res, 200, { ok: true, data: manifest });
    return;
  }

  if (url.pathname === '/command' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      json(res, 400, { ok: false, error: { code: 'BAD_BODY', message: `请求体不是合法 JSON：${err.message}` } });
      return;
    }
    const result = await callHost(body.type, body.payload ?? {}, {
      dryRun: body.dryRun,
      expectedVersion: body.expectedVersion,
      source: 'agent/http',
    });
    json(res, 200, result);
    return;
  }

  json(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `未知路径 ${url.pathname}` } });
});

/* ------------------------------------------------------------ 转发到 Host */

function callHost(type, payload, extra = {}) {
  if (!type || typeof type !== 'string') {
    return Promise.resolve({ ok: false, error: { code: 'BAD_COMMAND', message: '缺少命令类型 type' }, projectVersion: manifest?.projectVersion ?? 0 });
  }
  if (!hostSocket || hostSocket.readyState !== hostSocket.OPEN) {
    return Promise.resolve({
      ok: false,
      error: { code: 'NO_HOST', message: '编辑器未连接：请先打开 Kinelayer 并连上 bridge' },
      projectVersion: manifest?.projectVersion ?? 0,
    });
  }

  const id = nextId();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ ok: false, error: { code: 'TIMEOUT', message: `命令 ${type} 超过 ${COMMAND_TIMEOUT_MS / 1000}s 未返回` }, projectVersion: manifest?.projectVersion ?? 0 });
    }, COMMAND_TIMEOUT_MS);

    pending.set(id, { resolve, timer });
    const packet = { kind: 'command', id, type, payload, ...extra };
    try {
      hostSocket.send(JSON.stringify(packet));
      log('→ host', `${type} ${c.dim(id)}`);
    } catch (err) {
      clearTimeout(timer);
      pending.delete(id);
      resolve({ ok: false, error: { code: 'SEND_FAILED', message: err.message }, projectVersion: manifest?.projectVersion ?? 0 });
    }
  });
}

/* ---------------------------------------------------------------- WS 层 */

/**
 * 刻意不限制 path：编辑器填的是 ws://127.0.0.1:2718（无路径），
 * MCP 端填的是 ws://127.0.0.1:2718/ws。只认一个会把另一边挡在门外，
 * 而 ws 的 path 过滤失败时不报 404，是直接断开——排障成本极高。
 */
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024 * 1024 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/ws', `http://${BIND_HOST}:${args.port}`);
  const token = url.searchParams.get('token') ?? '';
  const role = (url.searchParams.get('role') ?? 'agent').toLowerCase();

  if (token !== TOKEN) {
    log('拒绝', `令牌不匹配（role=${role}）`, c.red);
    ws.send(JSON.stringify({ kind: 'error', error: { code: 'UNAUTHORIZED', message: '令牌不正确' } }));
    ws.close(4001, 'unauthorized');
    return;
  }

  ws.isAlive = true;
  ws.role = role === 'host' ? 'host' : 'agent';

  if (ws.role === 'host') {
    if (hostSocket && hostSocket !== ws && hostSocket.readyState === hostSocket.OPEN) {
      log('轮换', '新的编辑器连接，关闭旧 Host', c.yellow);
      hostSocket.send(JSON.stringify({ kind: 'error', error: { code: 'REPLACED', message: '另一个编辑器窗口接管了桥接' } }));
      hostSocket.close(4002, 'replaced');
    }
    hostSocket = ws;
    log('host', '编辑器已连接', c.green);
    ws.send(JSON.stringify({ kind: 'hello', role: 'host', agents: agentSockets.size, version: VERSION }));
    broadcastAgents({ kind: 'hello', role: 'agent', agents: agentSockets.size, host: true });
    // 新 Host 上线：把当前工具清单推给所有已在线的 agent，省一次往返
    if (manifest) broadcastAgents({ kind: 'manifest', ...manifest });
  } else {
    agentSockets.add(ws);
    log('agent', `Agent 已连接（共 ${agentSockets.size}）`, c.magenta);
    ws.send(JSON.stringify({ kind: 'hello', role: 'agent', host: !!hostSocket, agents: agentSockets.size, version: VERSION }));
    if (manifest) ws.send(JSON.stringify({ kind: 'manifest', ...manifest }));
    if (hostSocket && hostSocket.readyState === hostSocket.OPEN) {
      hostSocket.send(JSON.stringify({ kind: 'hello', agents: agentSockets.size }));
    }
  }

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ kind: 'error', error: { code: 'BAD_JSON', message: '消息不是合法 JSON' } }));
      return;
    }

    if (msg.kind === 'ping') {
      ws.send(JSON.stringify({ kind: 'pong', ts: Date.now() }));
      return;
    }

    if (ws.role === 'host') {
      if (msg.kind === 'manifest') {
        const previous = manifest;
        manifest = {
          tools: Array.isArray(msg.tools) ? msg.tools : [],
          summary: msg.summary ?? null,
          projectVersion: msg.projectVersion ?? 0,
          playhead: msg.playhead ?? 0,
          ts: msg.ts ?? Date.now(),
        };
        // 只在工具集合真的变了才广播，避免 4s 心跳把无意义的快照刷给每个 agent
        const changed = !previous || signature(previous.tools) !== signature(manifest.tools) || previous.projectVersion !== manifest.projectVersion;
        if (changed) broadcastAgents({ kind: 'manifest', ...manifest });
        return;
      }
      if (msg.kind === 'command.result' && msg.id) {
        const slot = pending.get(msg.id);
        if (!slot) return;
        clearTimeout(slot.timer);
        pending.delete(msg.id);
        slot.resolve(msg.result ?? { ok: false, error: { code: 'EMPTY', message: 'Host 返回了空结果' }, projectVersion: manifest?.projectVersion ?? 0 });
        const flag = msg.result?.ok ? c.green('ok') : c.red('fail');
        log('← host', `${flag} ${c.dim(msg.id)}`);
        return;
      }
      return;
    }

    /* -------- agent 侧 -------- */
    if (msg.kind === 'manifest.get') {
      if (manifest) ws.send(JSON.stringify({ kind: 'manifest', id: msg.id, ...manifest }));
      else ws.send(JSON.stringify({ kind: 'manifest', id: msg.id, tools: [], summary: null, projectVersion: 0, playhead: 0, ts: Date.now() }));
      return;
    }

    if (msg.kind === 'call') {
      const id = msg.id ?? nextId();
      callHost(msg.type, msg.payload ?? {}, { dryRun: msg.dryRun, expectedVersion: msg.expectedVersion, source: 'agent/ws' }).then((result) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ kind: 'call.result', id, result }));
      });
      return;
    }
  });

  ws.on('close', () => {
    if (ws === hostSocket) {
      hostSocket = null;
      log('host', '编辑器断开', c.yellow);
      // Host 掉线：所有在途请求立刻失败，别让 Agent 干等 30 秒
      for (const [id, slot] of pending) {
        clearTimeout(slot.timer);
        slot.resolve({ ok: false, error: { code: 'HOST_GONE', message: '执行过程中编辑器断开了连接' }, projectVersion: manifest?.projectVersion ?? 0 });
        pending.delete(id);
      }
      broadcastAgents({ kind: 'hello', role: 'agent', agents: agentSockets.size, host: false });
    } else {
      agentSockets.delete(ws);
      log('agent', `Agent 断开（剩 ${agentSockets.size}）`, c.dim);
      if (hostSocket && hostSocket.readyState === hostSocket.OPEN) {
        hostSocket.send(JSON.stringify({ kind: 'hello', agents: agentSockets.size }));
      }
    }
  });

  ws.on('error', () => {
    /* ws 的 error 会紧接 close，这里只做静默，避免 unhandled */
  });
});

function broadcastAgents(packet) {
  const text = JSON.stringify(packet);
  for (const ws of agentSockets) {
    if (ws.readyState === ws.OPEN) ws.send(text);
  }
}

function signature(tools) {
  return (tools ?? []).map((t) => t.name).join(',');
}

/* --------------------------------------------------------------- 心跳清理 */

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, HEARTBEAT_MS);
heartbeat.unref?.();

/* ------------------------------------------------------------------ 启动 */

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(c.red(`端口 ${args.port} 已被占用。`));
    console.error(c.dim('  可能已经有一个 bridge 在跑：先关掉它，或用 --port 换一个端口（记得同步改设置里的 URL）。'));
    process.exit(1);
  }
  console.error(c.red(`启动失败：${err.message}`));
  process.exit(1);
});

server.listen(args.port, BIND_HOST, () => {
  if (args.quiet) return;
  const line = '─'.repeat(64);
  console.log('');
  console.log(c.cyan(line));
  console.log(`${c.bold('Kinelayer Bridge')} ${c.dim('v' + VERSION)}  ${c.dim('· 命令中继 · 只做转发，不做判断')}`);
  console.log(c.cyan(line));
  console.log(`  ${c.dim('WS 地址')}  ${c.bold(`ws://${BIND_HOST}:${args.port}`)}  ${c.dim('（编辑器填这个；MCP 可用 /ws，两者等价）')}`);
  console.log(`  ${c.dim('HTTP   ')}  ${`http://${BIND_HOST}:${args.port}/health  ·  /manifest  ·  POST /command`}`);
  console.log(`  ${c.dim('令牌   ')}  ${c.bold(c.yellow(TOKEN))}`);
  console.log('');
  console.log(c.dim('  下一步：'));
  console.log(c.dim(`   1) 编辑器右上「设置 → Agent 桥接」，URL 填 ws://${BIND_HOST}:${args.port}，令牌填上面的值，点连接`));
  console.log(c.dim('   2) 另一个终端跑 `npm run mcp`，把打印出来的 JSON 贴到 Claude Desktop 配置里'));
  console.log('');
});

function shutdown(signal) {
  log('退出', `${signal}，正在关闭…`, c.yellow);
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    try {
      ws.close(1001, 'server shutdown');
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
