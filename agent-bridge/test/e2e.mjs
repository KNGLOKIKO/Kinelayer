#!/usr/bin/env node
/**
 * 端到端自检：不打开浏览器，也能验证「命令中继」这条链路是通的。
 *   假 Host（WS 客户端） —— bridge —— MCP stdio 客户端
 * 覆盖：
 *   1. bridge 鉴权（错令牌必须被拒）
 *   2. HTTP  POST /command → Host → 结果回传
 *   3. MCP   initialize / tools/list / tools/call → Host → isError=false
 *   4. Host 掉线时 /command 必须快速失败，而不是干等 30 秒
 *
 * 运行：node agent-bridge/test/e2e.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 2799;
const TOKEN = 'test-token-e2e';
const HTTP = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok, extra });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? `  ${extra}` : ''}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 8000, step = 120) {
  const start = Date.now();
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      /* 还没起来 */
    }
    if (Date.now() - start > timeout) return false;
    await sleep(step);
  }
}

/* ------------------------------------------------------------------ 假 Host */

function startFakeHost() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}?token=${TOKEN}&role=host`);
    const received = [];
    ws.on('open', () => resolve({ ws, received }));
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.kind === 'command') {
        received.push(msg);
        // 模拟命令总线：layer.create 成功，project.delete 危险命令被拒
        const ok = msg.type !== 'project.delete';
        ws.send(
          JSON.stringify({
            kind: 'command.result',
            id: msg.id,
            result: ok
              ? { ok: true, data: { echo: msg.payload, source: 'fake-host' }, projectVersion: 7 }
              : { ok: false, error: { code: 'FORBIDDEN', message: '危险命令需要人类确认' }, projectVersion: 7 },
          }),
        );
      }
    });
  });
}

/* ------------------------------------------------------------- MCP 客户端 */

class McpClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.waiting = new Map();
    this.buffer = '';
    child.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id && this.waiting.has(msg.id)) {
          const { resolve } = this.waiting.get(msg.id);
          this.waiting.delete(msg.id);
          resolve(msg);
        }
      }
    });
  }

  request(method, params) {
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} 超时`)), 15000);
      this.waiting.set(id, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
      });
    });
  }

  notify(method, params) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }
}

/* -------------------------------------------------------------------- 主流程 */

const bridge = spawn(process.execPath, [path.join(ROOT, 'src/bridge.js'), '--port', String(PORT), '--token', TOKEN, '--quiet'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
bridge.stderr.on('data', (d) => process.stderr.write(`[bridge] ${d}`));

let host = null;
let mcp = null;
let mcpClient = null;

try {
  console.log('\nKinelayer Bridge E2E\n');

  const up = await waitFor(async () => {
    const res = await fetch(`${HTTP}/health`);
    return res.ok;
  });
  check('bridge 启动并在 127.0.0.1 监听', up, `${HTTP}/health`);

  // 1. 鉴权
  const badToken = await fetch(`${HTTP}/manifest`, { headers: { 'x-kinelayer-token': 'wrong' } });
  check('错误令牌被拒绝（401）', badToken.status === 401);

  const noHost = await fetch(`${HTTP}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kinelayer-token': TOKEN },
    body: JSON.stringify({ type: 'query.project', payload: {} }),
  });
  const noHostBody = await noHost.json();
  check('Host 未连接时返回 NO_HOST', noHostBody?.error?.code === 'NO_HOST');

  // 2. 假 Host 上线并上报 manifest
  host = await startFakeHost();
  const tools = [
    {
      name: 'layer__create',
      description: '新建图层\n命令类型：layer.create（会修改项目）\n示例 payload：{"type":"text"}',
      inputSchema: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['text', 'image', 'code'] } },
        required: ['type'],
      },
    },
    {
      name: 'query__project',
      description: '读取当前项目摘要\n命令类型：query.project（只读）',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
  host.ws.send(JSON.stringify({ kind: 'manifest', tools, summary: { width: 1080, height: 1440, layers: [] }, projectVersion: 7, playhead: 400, ts: Date.now() }));
  await sleep(200);

  const manifestRes = await fetch(`${HTTP}/manifest`, { headers: { 'x-kinelayer-token': TOKEN } });
  const manifestBody = await manifestRes.json();
  check('manifest 被缓存并可读取', manifestBody?.data?.tools?.length === 2, `tools=${manifestBody?.data?.tools?.length}`);
  check('manifest 里的项目摘要可用于 Agent 上下文', manifestBody?.data?.summary?.width === 1080);

  // 3. HTTP 命令转发
  const call = await fetch(`${HTTP}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kinelayer-token': TOKEN },
    body: JSON.stringify({ type: 'layer.create', payload: { type: 'text' } }),
  });
  const callBody = await call.json();
  check('HTTP POST /command 端到端成功', callBody?.ok === true && callBody?.data?.source === 'fake-host', `projectVersion=${callBody?.projectVersion}`);
  check('Host 侧收到的是原始 payload', JSON.stringify(host.received.at(-1)?.payload) === '{"type":"text"}');

  // 4. MCP stdio
  mcp = spawn(process.execPath, [path.join(ROOT, 'src/mcp.js')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, KINELAYER_BRIDGE_URL: WS_URL, KINELAYER_BRIDGE_TOKEN: TOKEN },
  });
  mcp.stderr.on('data', (d) => process.stderr.write(`[mcp] ${d}`));
  mcpClient = new McpClient(mcp);

  const init = await mcpClient.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'e2e', version: '1.0.0' },
  });
  check('MCP initialize 成功', !!init.result?.serverInfo?.name, `server=${init.result?.serverInfo?.name} v${init.result?.serverInfo?.version}`);
  check('MCP 声明 tools.listChanged 能力', !!init.result?.capabilities?.tools);
  mcpClient.notify('notifications/initialized', {});

  // 等 MCP 连上 bridge 并拿到 manifest
  await sleep(600);
  const list = await mcpClient.request('tools/list', {});
  const listedNames = (list.result?.tools ?? []).map((t) => t.name);
  check('tools/list 由 manifest 动态生成（无硬编码）', listedNames.includes('layer__create') && listedNames.includes('query__project'), listedNames.join(', '));
  check('工具 schema 来自命令注册表', list.result?.tools?.find((t) => t.name === 'layer__create')?.inputSchema?.required?.[0] === 'type');

  const okCall = await mcpClient.request('tools/call', { name: 'layer__create', arguments: { type: 'text' } });
  check('tools/call 走通命令总线', okCall.result?.isError === false, okCall.result?.content?.[0]?.text?.split('\n')[0] ?? '');
  check('Host 收到的 command 类型是点号形式', host.received.at(-1)?.type === 'layer.create');

  const failCall = await mcpClient.request('tools/call', { name: 'project__delete', arguments: {} });
  check('未知工具返回可读错误（列出可用命令）', failCall.result?.isError === true && String(failCall.result?.content?.[0]?.text).includes('没有名为'));

  const resource = await mcpClient.request('resources/read', { uri: 'kinelayer://project' });
  check('MCP resource 暴露项目摘要', String(resource.result?.contents?.[0]?.text).includes('1080'));

  // 5. Host 掉线快速失败
  host.ws.close();
  await sleep(300);
  const afterClose = await fetch(`${HTTP}/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kinelayer-token': TOKEN },
    body: JSON.stringify({ type: 'query.project', payload: {} }),
  });
  const afterBody = await afterClose.json();
  check('Host 掉线后立即返回 NO_HOST（不干等）', afterBody?.error?.code === 'NO_HOST');
} catch (err) {
  check('测试脚本自身未抛异常', false, err.stack || err.message);
} finally {
  try {
    mcp?.kill();
  } catch {
    /* ignore */
  }
  try {
    host?.ws.close();
  } catch {
    /* ignore */
  }
  bridge.kill();
  await sleep(200);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 通过`);
  process.exit(failed.length ? 1 : 0);
}
