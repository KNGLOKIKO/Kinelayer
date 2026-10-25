# Kinelayer

**简体中文** · [English](README.en.md)

![Platform](https://img.shields.io/badge/platform-Web%20%2F%20Browser-blue)
![Engine](https://img.shields.io/badge/engine-Canvas2D%20%2B%20WebGL-6666cc)
![React](https://img.shields.io/badge/react-18-61DAFB?logo=react\&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-5.6-3178C6?logo=typescript\&logoColor=white)
![Node](https://img.shields.io/badge/node-18%2B-339933?logo=node.js\&logoColor=white)
![Agent](https://img.shields.io/badge/agent-MCP%20%2B%20OpenAI%20tools-7C5CFF)
![License](https://img.shields.io/badge/license-MIT-green)
![Deploy](https://img.shields.io/github/actions/workflow/status/KNGLOKIKO/Kinelayer/pages.yml?label=deploy)
![Demo](https://img.shields.io/badge/demo-online-brightgreen)

**可编程的动态海报工作台** —— 一个纯前端、可离线、命令驱动的动态海报编辑器。

**在线体验**：<https://knglokiko.github.io/Kinelayer/> · **源码**：<https://github.com/KNGLOKIKO/Kinelayer>

不做「拖拽拼图」，做的是「用一条命令总线把人类操作、网页内 AI、外部 Agent、独立图层窗口
统一成同一件事」。所有能力都注册在一张表里：人点按钮、AI 调工具、Agent 走 MCP，
最终落到总线上的都是同一条结构化 `Command`。

```
npm install
npm run dev          # http://localhost:5273
```

![Kinelayer 界面](docs/preview.png)

---

## 五条铁律，以及它们落在哪

| # | 铁律                        | 代码位置                                                                                   | 怎么验证                                                                 |
| - | ------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1 | 一切修改都是一条 `Command`，走同一条总线 | `src/core/commandBus.ts`、`src/core/registry.ts`                                        | 设置 → 命令面板：任意命令都能手输 payload 执行；审计面板里能看到来源（user / ai / agent / window） |
| 2 | 主窗口是唯一权威：唯一执行、唯一撤销栈、唯一主时钟 | `EditorApp.tsx`（rAF 主时钟）、`temporal.ts`、`commandBus.ts`                                 | 打开图层窗口后，撤销按钮只存在于主窗口                                                  |
| 3 | 图层窗口是只读镜像：只发请求，等广播        | `src/windows/client.ts`、`LayerMirror.tsx`                                              | 断网/关闭 Host，镜像立刻显示「已断开」                                               |
| 4 | 预览与导出共用同一套几何与渲染           | `renderScene.ts` + `geometry.ts`，被 `exporters.ts` 与镜像我复用                               | 同一帧导出 PNG 与屏幕像素一致                                                    |
| 5 | 工具 schema 由命令注册表自动生成      | `registry.ts#buildToolSchemas` → `ai/client.ts`（OpenAI）、`agent-bridge/src/mcp.js`（MCP） | 加一条命令，重载页面，AI 与 MCP 的工具列表自动多一项                                       |

---

## 目录结构与模块职责

```
Kinelayer/
├─ index.html                  启动期致命错误兜底（模块崩了也能看到人话）
├─ src/
│  ├─ core/                    ★ 唯一的真相层：数据、命令、历史
│  │  ├─ types.ts              数据模型：Project / 5 种 Layer / 动画 / 绑定 / 资源
│  │  ├─ schemas.ts            共享 zod 片段：颜色、缓动、图层 patch、动画…
│  │  ├─ registry.ts           命令注册表 + tool schema 生成（OpenAI / MCP 共用）
│  │  ├─ commandBus.ts         执行管线：校验 → 乐观锁 → dryRun → immer → 撤销点 → 广播 → 审计
│  │  ├─ temporal.ts           自研撤销栈：immer patches / inverse patches / 700ms 合并
│  │  ├─ store.ts              Zustand 三段式：project（存盘）/ ui / runtime（都不存盘）
│  │  ├─ defaults.ts           工厂 + normalizeProject（读宽容、写严格）+ 演示项目
│  │  ├─ commands/*.ts         67 条命令，按领域分文件（图层/文本/代码/背景/项目/资源/字体/时间轴/动画/选择/历史/窗口/导出/查询/批处理）
│  │  └─ summary.ts            给 AI 的项目摘要（不含 base64，代码截断）
│  ├─ render/                  ★ 渲染层：纯函数，不知道 React 的存在
│  │  ├─ renderScene.ts        渲染单入口：预览 / PNG / WebM / 镜像 全走这里
│  │  ├─ geometry.ts           坐标系、命中测试、fitViewport、吸附
│  │  ├─ animation.ts          表达式编译、噪声、预设采样、三槽位合成 + 轨道覆盖
│  │  ├─ keyframes.ts          【v2】关键帧求值：evaluateTrack / applyTracks / cubic-bezier
│  │  ├─ text.ts               手工断行（CJK 按字 / 拉丁按词）、渐变字、字距
│  │  ├─ codeEngine.ts         canvas2d / glsl / html 三引擎 + 沙箱 + 熔断 + 信号总线
│  │  ├─ assets.ts             图片/视频资源池（IndexedDB → ImageBitmap/VideoElement）
│  │  ├─ htmlRaster.ts         HTML 层导出：SVG foreignObject 栅格化
│  │  └─ exporters.ts          PNG / WebM（手动推帧）/ JSON
│  ├─ persist/                 IndexedDB 资源与 KV、本地字体注册
│  ├─ windows/                 ★ 多窗口：协议、Host、Client、镜像 UI、独立页入口
│  ├─ ai/                      ★ AI：OpenAI 兼容客户端、加密配置、演示 Agent、桥接客户端
│  ├─ ui/                      舞台、时间轴、属性面板、图层面板、AI 面板、对话框
│  ├─ app/services.ts          把「副作用能力」注入命令层的服务表
│  ├─ EditorApp.tsx            三栏布局 + 引导 + 主时钟 + 自动保存 + 快捷键
│  └─ main.tsx                 注册命令 → 注入服务 → 按 URL 分流主窗口/图层窗口
├─ agent-bridge/               ★ 本机桥接（Node 18+，独立依赖）
│  ├─ src/bridge.js            WS + HTTP 中继（127.0.0.1:2718，令牌鉴权）
│  ├─ src/mcp.js               MCP stdio 服务端：工具从 manifest 动态生成
│  └─ test/e2e.mjs             16 项端到端自检（假 Host + 真 MCP 客户端）
└─ docs/
   ├─ 00-reference-notes.md    参考项目提取报告（第十四章）
   └─ 01-known-limitations.md  已知限制与扩展点
```

**分层规矩**：`ui/` 不能直接改 `project`；`render/` 不能 import `store`；
`core/commands/` 不能 import `ui/`。副作用（导出、开窗、读文件）统一走 `services.ts` 注入。

---

## 命令一览（67 条）

| 分类  | 条数 | 代表命令                                                                                                                                                                                                                          |
| --- | -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 图层  | 13 | `layer.create` `layer.update` `layer.delete` `layer.duplicate` `layer.reorder` `layer.align` `layer.rename` `layer.fixAll` `layer.setVisible` `layer.setLocked` `layer.setBlendMode` `layer.setAnimation` `layer.setBindings` |
| 文本  | 3  | `text.setContent` `text.setStyle` `text.fitBox`                                                                                                                                                                               |
| 代码  | 4  | `code.setSource` `code.setEngine` `code.setParams` `code.resetRuntime`                                                                                                                                                        |
| 背景  | 2  | `background.set` `background.setCode`                                                                                                                                                                                         |
| 画布  | 3  | `canvas.resize` `canvas.setDuration` `canvas.setFps`                                                                                                                                                                          |
| 项目  | 3  | `project.load` `project.new` `project.rename`                                                                                                                                                                                 |
| 资源  | 3  | `asset.import` `asset.place` `asset.remove`                                                                                                                                                                                   |
| 字体  | 3  | `font.register` `font.load` `font.remove`                                                                                                                                                                                     |
| 时间轴 | 5  | `timeline.play` `timeline.pause` `timeline.seek` `timeline.setLayerTiming` `timeline.setLoop`                                                                                                                                 |
| 选择  | 4  | `selection.set` `selection.toggle` `selection.add` `selection.clear`                                                                                                                                                          |
| 历史  | 3  | `history.undo` `history.redo` `history.clear`                                                                                                                                                                                 |
| 窗口  | 4  | `window.openLayer` `window.closeLayer` `window.focusLayer` `window.setMode`                                                                                                                                                   |
| 导出  | 4  | `export.png` `export.webm` `export.json` `export.commands`                                                                                                                                                                    |
| 查询  | 4  | `query.project` `query.layer` `query.registry` `query.capture`                                                                                                                                                                |
| 批处理 | 1  | `command.batch`（多条命令合成一个撤销点，失败原子回滚）                                                                                                                                                                                           |

每条命令都自带：zod schema、中文描述、可直接跑的 `example`、
以及 `mutating / dangerous / undoable / coalesce / asyncHandler / resetsHistory` 等元信息。

---

## v2 · 关键帧

v1 只有「入场 / 退场 / 强调」三个预设槽位，能做出生硬的淡入淡出，做不出真正的动效。
v2 在它上面加了**属性轨道**，而预设变成「一键生成关键帧」的语法糖——生成完就是普通轨道，
运行时没有第二套动画系统。

| 概念 | 说明 |
| --- | --- |
| `AnimatableProperty` | `x` `y` `width` `height` `rotation` `opacity` `fontSize` `letterSpacing`。准入标准只有一条：值必须能由 `(keyframes, localTime)` 唯一算出 |
| `Keyframe.time` | **相对图层 `inPoint` 的毫秒数**，绝不存绝对时间。整段图层挪位时关键帧自动跟着走 |
| `EasingSpec` | 复用既有缓动名，或 `cubic-bezier` 自定义曲线（与 CSS 同义，牛顿迭代 + 二分求解） |
| 求值优先级 | 基础属性 → 预设槽位（整段修饰）→ **轨道（绝对定点，赢）** → 表达式绑定 |
| 自动关键帧 | 开关打开后，改动**已有轨道**的属性会在当前播放头自动落点。实现在命令层，所以人、AI、Agent 行为完全一致 |

用法：时间轴上每个图层左侧的 `A` 是自动关键帧开关，菱形按钮是预设菜单；点图层名前的箭头
展开属性轨道，轨道右侧的菱形「在播放头打点」，拖菱形整体平移（松手才提交，一次拖动只留一个撤销点），
`Shift` 点可多选后统一改缓动或删除。缩短时长导致越界的图层会在时间轴上标红，点顶部的
「N 个图层越界 · 修复」一次收回。

工程文件带 `schemaVersion`（当前为 2）。读入时 v1 文件会被 `normalizeAnimation` 平滑迁移，
写出永远是当前版本——读宽容、写严格。

---

## 快捷键

| 操作            | 快捷键                                     |
| ------------- | --------------------------------------- |
| 撤销 / 重做       | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` |
| 复制选中图层        | `Ctrl/Cmd + D`                          |
| 导出 JSON       | `Ctrl/Cmd + S`                          |
| 播放 / 暂停       | `Space`                                 |
| 删除选中          | `Delete` / `Backspace`                  |
| 取消选择          | `Esc`                                   |
| 适配画布          | `Shift + !`                             |
| 微移 1px / 10px | 方向键 / `Shift + 方向键`                     |
| 平移画布          | 中键拖拽 或 `Space + 拖拽`                     |
| 缩放画布          | `Ctrl/Cmd + 滚轮`                         |
| 就地编辑文字        | 双击文本层                                   |

---

## 接 AI（两种通道）

### 通道 A：网页内 AI

右上「AI」→ 设置 → 填 Base URL / 模型 / API Key（OpenAI 兼容接口）。
**不填 Key 也能用**：会自动切到离线演示 Agent，用本地规则把你的话翻成命令，
完整走一遍「计划 → 审阅 → 执行」的链路，适合先看效果。

安全设计：

- Key 用 WebCrypto AES-GCM 加密后存 IndexedDB，不进 localStorage、不进项目文件；
- 危险命令（删除、清空、加载项目）执行前弹审批卡，默认不执行；
- 每条 AI 产生的命令在对话里独立成卡，可以单条撤销。

### 通道 B：外部 Agent（MCP）

```bash
# 终端 1：桥接（会打印令牌，首次运行自动生成并写到 agent-bridge/.token）
npm run bridge

# 终端 2：MCP server（stdio，给 Claude Desktop / Cursor 用）
npm run mcp
```

然后在编辑器「设置 → Agent 桥接」里填 `ws://127.0.0.1:2718` + 令牌，点连接。
状态栏出现「Agent 已连接」就通了。

Claude Desktop 配置示例见 `agent-bridge/claude-desktop-config.json`。

桥接自检（不打开浏览器也能验）：

```bash
cd agent-bridge && npm test
```

---

## 部署（GitHub Pages）

仓库已经配好 `.github/workflows/pages.yml`：推到 `main` 就自动构建并发布。

```bash
# 一次性设置：仓库 Settings → Pages → Source 选 "GitHub Actions"
# 构建时的资源前缀由 workflow 注入
VITE_BASE=/Kinelayer/ npm run build   # 项目页需要这个前缀
```

- 页面地址：`https://<user>.github.io/<repo>/`，改仓库名就要同步改 workflow 里的 `VITE_BASE`。
- 免费账号的 Pages 需要仓库是 **public**。
- 想用自定义域名：在 Pages 设置里填域名，再把 workflow 里的 `VITE_BASE` 改回 `/`。

## 站点内置的「AI 接入提示词」

右上角 **接入**（AI 面板头部也有一个插头图标）打开提示词面板，三种形态一键复制 / 下载：

| 形态               | 给谁用                              | 怎么用                                          |
| ---------------- | -------------------------------- | -------------------------------------------- |
| 通用大模型            | 任何对话框（ChatGPT / DeepSeek / 本地模型） | 复制提示词 → 模型回一段 JSON → 粘回面板「执行」，应用会合成**一个撤销点** |
| MCP 客户端          | Claude Desktop / Cursor          | 先跑 `npm run bridge` + `npm run mcp`，模型自己调工具  |
| Function Calling | 自建 Agent                         | 复制 `tools` 数组塞进请求体                           |

提示词里的命令清单、参数枚举（preset / easing / 文本样式字段）全部由命令注册表与 zod schema 生成，
**不是手写文档**：加一条命令，三种形态同时多一项。

## 数据与隐私

- **项目文件**：`export.json` 产出 `.kly` 工程包（JSON 外壳 + `format: "kinelayer-bundle"`），**不含图片/视频的 base64**（资源在 IndexedDB 里）。
  导入时既认 `.kly`，也认旧版裸项目 JSON，老备份不会因为改格式而打不开。
  换机器要带上素材重新导入，这是为了不让项目文件变成几十 MB 的怪物。
- **自动保存**：每 1.6s 把项目写进 IndexedDB（`kinelayer` 库），刷新页面自动恢复。
- **不出网**：除你主动配置的 AI 接口外，应用不发起任何网络请求；没有 CDN、没有埋点、没有远程字体。
- **升级不丢数据**：品牌更名时数据库与存储键都换了名字，首次启动会把旧库数据**整份复制**到新库，
  旧库原样保留（不删）；旧命名空间的 localStorage 键在读取时自动迁移；旧版裸项目 JSON 备份照样能导入。

---

## 文档

- [参考项目提取报告](docs/00-reference-notes.md) —— 第十四章逐项说明「借什么 / 为什么不搬 / 差异在哪」
- [已知限制与扩展点](docs/01-known-limitations.md) —— 导出格式、沙箱边界、多窗口降级链、性能账本

## 许可

MIT，见 [LICENSE](LICENSE)。参考项目的设计与命名归属其原作者（详见 `docs/00-reference-notes.md`），
本项目只借鉴设计、未复制其代码。
