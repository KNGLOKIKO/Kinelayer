# agent-bridge

Kinelayer 的**本机**桥接层。两个进程，一个职责：把外面来的 `Command` 搬到编辑器里，
把编辑器的 `CommandResult` 搬回去。**这里没有一行编辑逻辑。**

```
┌──────────────┐   WS (浏览器)    ┌──────────────┐   WS (本机)   ┌──────────────┐
│  Kinelayer │ ───────────────▶ │  bridge.js   │ ◀──────────── │  mcp.js      │ ◀── stdio ── Claude Desktop
│  （Host）    │ ◀─────────────── │  127.0.0.1   │ ────────────▶ │ （MCP 服务） │ ── stdout ─▶ Cursor / 脚本
└──────────────┘   manifest/结果   │    :2718     │   命令/清单    └──────────────┘
                                  └──────────────┘
                                         ▲
                                         │ HTTP（curl / 你自己的 Agent）
                                    POST /command
```

## 启动

```bash
# 在项目根目录
npm run bridge     # 等价于 node agent-bridge/src/bridge.js

# 或者在 agent-bridge 里
npm install        # 只有 ws + @modelcontextprotocol/sdk
npm start
```

首次启动会生成一个令牌，打印在 banner 里，并保存到 `agent-bridge/.token`（已在 .gitignore 中）。
想固定令牌：`node agent-bridge/src/bridge.js --token mytoken` 或 `KINELAYER_BRIDGE_TOKEN=mytoken npm run bridge`。

编辑器侧：右上「设置 → Agent 桥接」→ URL 填 `ws://127.0.0.1:2718`，令牌粘贴 → 连接。
状态栏出现「Agent 已连接」即通。

## MCP Server

```bash
npm run mcp
```

它通过 stdio 跟 LLM 客户端说话，通过 WS 跟 bridge 说话。**工具不是写死的**：
启动时拉一份 manifest（编辑器命令注册表导出的 JSON Schema），把 `layer.create` 映射成 `layer__create`。
编辑器里新增一条命令，客户端重新拉一次 `tools/list` 就能用。

Claude Desktop 配置（`claude-desktop-config.json`，把路径和令牌换成你自己的）：

```json
{
  "mcpServers": {
    "kinelayer": {
      "command": "node",
      "args": ["C:/Users/you/Desktop/Kinelayer/agent-bridge/src/mcp.js"],
      "env": {
        "KINELAYER_BRIDGE_URL": "ws://127.0.0.1:2718/ws",
        "KINELAYER_BRIDGE_TOKEN": "把 agent-bridge/.token 里的值贴这里"
      }
    }
  }
}
```

> Windows 上一定要写**绝对路径**，且用 `/` 或转义过的 `\\`；`node` 建议写 `node.exe` 的绝对路径，
> 因为 Claude Desktop 启动子进程时不读你的 shell PATH。

MCP 能力声明：
- `tools`（`listChanged: true`）：全部命令，schema 来自注册表
- `resources`：`kinelayer://project`（项目摘要，含图层 id/类型/文本）、`kinelayer://registry`（全量命令目录）
- `instructions`：告诉模型先读项目、再改图层、批量改动用 `batch.run`

## HTTP 接口（给脚本用，不需要 MCP）

所有请求都要带令牌：`x-kinelayer-token: <token>` 头或 `?token=<token>`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | `{ok, host, agents, projectVersion, uptime}`，**不需要令牌**（用于探活） |
| GET | `/manifest` | 工具清单 + 项目摘要；编辑器没连上时返回 503 `NO_HOST` |
| POST | `/command` | body `{type, payload, dryRun?, expectedVersion?}`，返回 `CommandResult` |

```bash
TOKEN=$(cat agent-bridge/.token)

curl -s localhost:2718/health

curl -s -X POST localhost:2718/command \
  -H "content-type: application/json" -H "x-kinelayer-token: $TOKEN" \
  -d '{"type":"layer.create","payload":{"type":"text","text":"来自 curl 的一行字","y":1100}}'

# 试算：ok 返回 data，但不落盘、不占版本号
curl -s -X POST localhost:2718/command \
  -H "content-type: application/json" -H "x-kinelayer-token: $TOKEN" \
  -d '{"type":"layer.delete","payload":{"ids":["ly_x"]},"dryRun":true}'
```

## 消息协议

Host（浏览器）→ bridge：

| kind | 载荷 | 说明 |
| --- | --- | --- |
| `manifest` | `{tools, summary, projectVersion, playhead}` | 每 4s 一次；工具集合变了才广播给 agent |
| `command.result` | `{id, result}` | 回某个 `command` 请求 |
| `ping` | — | 心跳 |

bridge → Host：`{kind:'hello', agents}`、`{kind:'command', id, type, payload, dryRun?, expectedVersion?}`

Agent ↔ bridge：`{kind:'call', id, type, payload}` → `{kind:'call.result', id, result}`；
`{kind:'manifest.get'}` → `{kind:'manifest', ...}`。

## 设计上的几条「不做」

1. **不做权限判断**。哪个命令危险、要不要二次确认，只有编辑器知道。bridge 一旦开始判断，
   就出现了第二个真相源，人类 UI 与 Agent 的行为会分叉。
2. **不缓存项目状态**。只缓存 manifest（工具清单 + 摘要），且摘要不含资源 base64。
3. **不重试命令**。超时/失败原样返回给调用方，让模型自己决定要不要重试——自动重试会让
   「新建图层」这种非幂等命令翻倍生效。
4. **只监听 127.0.0.1**。想跨机器用，请走 SSH 隧道，而不是把端口开到 0.0.0.0。

## 排障

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 编辑器点连接后一直「未连接」 | 令牌不对 / bridge 没起 / 端口被占 | 看 bridge 终端输出；`curl localhost:2718/health` |
| `error: 端口 2718 已被占用` | 上一次的 bridge 还在跑 | 关掉旧进程，或 `--port 2719`（记得改设置里的 URL） |
| MCP 里工具列表是空的 | 编辑器没连上，且本地没有缓存 | 先连编辑器；缓存文件在 `agent-bridge/.cache/manifest.json` |
| `tools/call` 返回 `NO_HOST` | 编辑器关了或断线 | 重新点连接；命令不会排队，断了就是断了 |
| Claude Desktop 里看不到 kinelayer | 配置路径不对 / 没重启客户端 | 用绝对路径；改完配置要完全退出 Claude Desktop 再开 |
| `Cannot find package 'ws'` | 没在 `agent-bridge/` 里装依赖 | `cd agent-bridge && npm install` |

## 自检

```bash
cd agent-bridge && npm test     # 16 项：鉴权 / HTTP 命令 / MCP 工具动态生成 / Host 掉线快速失败
```
