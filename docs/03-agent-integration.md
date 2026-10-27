# Kinelayer 织层 · AI Agent 接入指南

> 本文写给「想让机器改稿」的人：Claude Desktop、Cursor、Codex CLI、自建脚本，或者浏览器里的
> AI 助手。读完你应该知道**有哪几种接法、每种怎么起步、能改什么、改不到什么**。
>
> 协议细节、命令清单、错误码都不是手写的——它们来自 `src/core/registry.ts` 的命令注册表与
> `agent-bridge/src/bridge.js` 的协议常量。所以本文会随代码一起过期，遇到不一致时以
> **设置 → 桌面 Agent** 面板里那份实时生成的提示词为准。
>
> English version: [03-agent-integration.en.md](./03-agent-integration.en.md)

---

## 0. 一分钟选型

| 接入方式 | 适合谁 | 起步成本 | 能力 |
| --- | --- | --- | --- |
| **A. MCP（stdio）** | Claude Desktop / Cursor / Codex CLI 等支持 MCP 的客户端 | 改一份 JSON 配置 | 全部命令，工具自动生成 |
| **B. HTTP 直连** | 自建脚本、CI、自动化流程 | 一个 `curl` 就能验证 | 全部命令，一问一答 |
| **C. WebSocket** | 需要长连接、要订阅项目变化 | 一个 WS 客户端 | 全部命令 + 清单推送 |
| **D. 浏览器内 AI** | 只想在网页里用一句自然语言改稿 | 填 Base URL / Key | 由模型挑命令执行，走 function calling |

四种方式**打的是同一条命令总线**：不存在「绕过总线的捷径」，也不存在两套工具定义。

---

## 1. 前置：把桥接跑起来

编辑器（Host）跑在浏览器里，浏览器不能监听端口，所以中间需要一个本机中继：

```bash
# 终端 1：桥接中继（默认 127.0.0.1:2718）
npm run bridge
# 首次运行会生成令牌并写入 agent-bridge/.token，同时打印在终端
```

然后在网页里：**设置 → Agent 桥接** → 填 `ws://127.0.0.1:2718` + 同一令牌 → 点连接。
状态变绿、面板顶部出现 `桥接已连接` 才算通。

> 桥接只监听 `127.0.0.1`，不对局域网/公网开放。它不做业务判断，只做转发。

令牌的三种传法（任选）：

| 场景 | 形式 |
| --- | --- |
| HTTP 头 | `x-kinelayer-token: <token>`（旧头 `x-ml-token` 仍兼容） |
| 查询参数 | `?token=<token>` |
| WS 连接 | `ws://127.0.0.1:2718/?role=agent&token=<token>` |

令牌来源优先级：`--token` 参数 > 环境变量 `KINELAYER_BRIDGE_TOKEN` > `agent-bridge/.token` > 自动生成。

---

## 2. 方式 A：MCP（推荐给桌面客户端）

```bash
npm run mcp   # stdio，交给客户端拉起，不需要手动常驻
```

配置示例（Claude Desktop 的 `claude_desktop_config.json`，Cursor 同理）：

```json
{
  "mcpServers": {
    "kinelayer": {
      "command": "node",
      "args": ["<本仓库绝对路径>/agent-bridge/src/mcp.js"],
      "env": {
        "KINELAYER_BRIDGE_URL": "ws://127.0.0.1:2718/ws",
        "KINELAYER_BRIDGE_TOKEN": "<bridge 启动时打印的令牌>"
      }
    }
  }
}
```

改完配置要**完全退出**客户端再开（不是关窗口）。

MCP 暴露的东西：

- **工具**：每条命令一个工具，名字是命令类型把 `.` 换成 `__`，例如 `layer.create` → `layer__create`。
  入参就是该命令的 `payload`，schema 由注册表生成。
- **资源**：`kinelayer://project`（项目摘要：画布、时长、图层 id/类型/文本，
  导入来的层还带 `origin` 的 `parser` / `external` / `sourceRef` —— 见 `06-after-import.md` 6.1）、
  `kinelayer://registry`（全量命令清单）。
- 工具清单随编辑器版本变化，客户端刷新即可，不需要改配置。

---

## 3. 方式 B：HTTP 直连

免令牌的健康检查：

```bash
curl -s http://127.0.0.1:2718/health
```

| 用途 | 请求 |
| --- | --- |
| 读清单 | `GET /manifest`，头 `x-kinelayer-token: <token>` |
| 执行命令 | `POST /command`，体 `{"type":"layer.update","payload":{…},"dryRun":false,"expectedVersion":12}` |

```bash
# 读项目摘要
curl -s -X POST http://127.0.0.1:2718/command \
  -H "content-type: application/json" -H "x-kinelayer-token: $TOKEN" \
  -d '{"type":"query.project","payload":{}}'

# 先试算，再提交
curl -s -X POST http://127.0.0.1:2718/command \
  -H "content-type: application/json" -H "x-kinelayer-token: $TOKEN" \
  -d '{"type":"layer.update","payload":{"id":"ly_xxx","patch":{"x":120}},"dryRun":true}'
```

返回统一是 `CommandResult`：

```json
{ "ok": true, "commandId": "cmd_…", "type": "layer.update", "data": {…},
  "projectVersion": 13, "durationMs": 3, "dryRun": false }
```

---

## 4. 方式 C：WebSocket

适合要「一直连着、随时收推送」的场景。

```text
→ {"kind":"call","id":"1","type":"layer.update","payload":{…},"dryRun":true}
← {"kind":"call.result","id":"1","result":{ok,data,error,projectVersion,commandId,durationMs}}

→ {"kind":"manifest.get","id":"2"}
← {"kind":"manifest","id":"2",tools:[…],summary:{…},projectVersion,playhead}
```

一问一答，`id` 自己维护；不要并发轰炸，总线本身是串行队列。

---

## 5. 方式 D：浏览器内 AI（站点自带通道）

不需要跑桥接，也不需要 MCP：网页里 **设置 → AI 通道** 填 OpenAI 兼容接口即可。

| 字段 | 说明 |
| --- | --- |
| Base URL | 任何 OpenAI 兼容的 `/v1`（OpenAI / DeepSeek / Moonshot / 本地 vLLM） |
| 模型 | 需支持 function calling |
| API Key | 用 WebCrypto AES-GCM 加密后存 IndexedDB，**不会**出现在任何命令返回值里 |

特点：工具定义同样由注册表生成（`buildToolSchemas()`），上下文只传项目摘要，不传任何 base64。
没有 Key 时会进入**演示模式**（本地规则匹配），能识别「加标题 / 导出 PNG / 改背景」这类指令。

---

## 6. 能操作什么

命令按分类（数量随版本变化，以面板与 `/manifest` 为准）：

| 分类 | 典型命令 |
| --- | --- |
| 项目 | `project.new` `project.load` `project.rename` `project.create` `project.open` `project.duplicate` `project.listRecent` `project.deleteLocal`（危险，须 confirm） |
| 图层 | `layer.create` `layer.update` `layer.delete` `layer.duplicate` `layer.reorder` |
| 文本 | `text.set` `text.setStyle` |
| 动画 | `animation.setKeyframe` `animation.applyPreset` `animation.setEasing` … |
| 时间轴 | `timeline.seek` `timeline.setRange` `timeline.setZoom` |
| 背景 / 画布 | `background.set` `canvas.resize` `canvas.setDuration` |
| 资源 / 字体 | `asset.import` `asset.place` `asset.assign` `font.upload` |
| 查询 | `query.project` `query.layer` `query.registry` `query.capture` |
| 导出 | `export.png` `export.webm` `export.json` |
| 自定义 | `custom.list` `custom.define` `custom.run` `custom.remove`（宏：一串已有命令 + 参数） |
| 系统 | `command.batch` `history.undo` `history.redo` `audit.list` |

---

## 7. 调用契约（七条，违反会出事）

1. **先读后写**：id 必须来自 `query.project` / `manifest.summary`，不要凭空编。
2. **多步合成一条**：两处以上改动放进 `command.batch`（`atomic:true`），用户一次撤销全回退。
   同一串步骤会被反复用到时，用 `custom.define` 存成一条宏，之后 `custom.run` 一行调起 —— 宏内部同样是一次原子批处理。
3. **不确定就试算**：`dryRun:true` 只校验、不落盘、不产生撤销点。
4. **并发写带锁**：写命令带 `expectedVersion`（上次结果的 `projectVersion`）。收到 `CONFLICT` 重读再改，别盲目重试。
5. **串行发送**：总线是串行队列，一条做完再下一条。
6. **时间单位毫秒**；关键帧时间相对图层 `inPoint`，不是绝对时间。
7. **重发≠重试**：重复写会多出撤销点。判断成功看 `ok` 与 `projectVersion`。

---

## 8. 权限边界

**允许**：读清单与项目摘要、改图层/文本/背景/时间轴/关键帧、触发导出（走浏览器下载）。

**做不到，也不许做**：

| 边界 | 事实 |
| --- | --- |
| 网络 | 桥接只监听 `127.0.0.1`，拿不到其它站点数据 |
| 密钥 | API Key 加密存在 IndexedDB，任何命令返回值都不含它 |
| 二进制 | 图片/视频/字体存 IndexedDB，命令只传 `assetId` |
| 文件系统 | 没有任何读写本地文件的命令；导出不能指定路径 |
| 越权批准 | 危险命令必须由用户在界面确认，Agent 不能代点 |
| 绕过校验 | 不要用 `project.load` 整包覆盖来跳过单条命令的 schema 校验 |
| 改宿主 | 不要改 DOM / localStorage / IndexedDB；`window.__kly` 只在 dev 构建存在 |

---

## 9. 错误码

| code | 含义 | 处置 |
| --- | --- | --- |
| `VALIDATION` | payload 不符合 schema | 按返回信息修正字段，别重发同样的 body |
| `NOT_FOUND` | 图层/资源 id 不存在 | 重新 `query.project` |
| `CONFLICT` | 乐观锁版本冲突 | 重读 `projectVersion` 再提交 |
| `FORBIDDEN` | 被规则拒绝（删背景层、改锁定层） | 换策略，不要硬试 |
| `RUNTIME` | 宿主执行期异常 | 把 message 原样转告用户 |
| `UNAUTHORIZED` | 令牌不对 | 用 bridge 打印的令牌 |
| `NO_HOST` | 桥接在，但页面没连 | 到「设置 → Agent 桥接」点连接 |

---

## 10. 自检与排障

```bash
# ① 桥接活着？（免令牌）
curl -s http://127.0.0.1:2718/health

# ② 令牌对不对？（返回 tools 就对了）
curl -s -H "x-kinelayer-token: $TOKEN" http://127.0.0.1:2718/manifest | head -c 200

# ③ 页面连上了？（返回图层数就通了）
curl -s -X POST http://127.0.0.1:2718/command \
  -H "content-type: application/json" -H "x-kinelayer-token: $TOKEN" \
  -d '{"type":"query.project","payload":{}}'
```

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| 连接被拒 / ECONNREFUSED | 桥接没跑 | `npm run bridge` |
| `401` | 令牌不匹配 | 读 `agent-bridge/.token` |
| `503 NO_HOST` | 页面没连桥接 | 网页里点连接 |
| 工具列表为空 | 客户端缓存了旧清单 | 重启客户端 / 刷新 MCP 连接 |
| 改了没反应 | 走了另一个标签页 | 每个页面是独立 Host，确认连的是当前页面 |

> 关掉标签页 = 断线。此时任何写命令都会 `NO_HOST`，不要死循环重试。

---

## 11. 站点内的那份提示词

网页 **设置 → 桌面 Agent** 里有一份实时生成的接入说明，包含：

- 当前站点地址（`location.origin` + 目录，部署在项目页时带 `/Kinelayer/`）
- 两种接入方式的完整步骤与 `curl` 自检
- 全量命令清单（按分类、带参数签名、危险命令标注）
- 七条调用契约、七条权限边界、错误码处置、交付话术

它**跟随界面语言切换**（中文 / English 各一份），也可下载成 `.md` 交给本机 Agent 工具。
其中的命令部分来自注册表，注册表加一条命令，提示词自动多一行。

---

## 12. 本文的维护约定

- 协议字段、错误码、命令数量：以代码为准，本文只做解释。
- 新增接入方式时，同步更新第 0 节选型表与面板里的说明卡。
- 本文不写具体令牌、路径、内网地址示例以外的环境信息。
