# 参考项目提取报告

> 对应需求第十四章。写这份报告的目的不是「证明我读过」，而是把「借什么」和「为什么不搬」写死，
> 免得几周后自己或者接手的人又把 CRDT、Fabric.js 之类的重方案引入进来。
>
> 阅读方式：只看与「动态海报 + 命令总线 + 多窗口」相关的部分（动画数据模型、图层类型、
> 桥接进程结构、代码层 API、store 组织），没有通读业务代码。下面每条都标了具体文件。

## 总览

| 项目 | 我借鉴的设计 | 我明确没有引入的东西 | 落到本项目的文件 |
| --- | --- | --- | --- |
| 14.1 Doory | 入场/退场/强调三槽位动画模型；读宽容写严格；未知 preset 降级播放 | Yjs / CRDT、其导出格式矩阵 | `src/core/types.ts` `src/render/animation.ts` `src/core/defaults.ts` |
| 14.2 yft-design | 以 `type` 为判别式的图层联合类型；渐变色标结构；元素级属性分层 | Fabric.js、Vue、其模板/素材市场体系 | `src/core/types.ts` `src/render/renderScene.ts` |
| 14.3 p5js-ai-editor | 「WS 桥接进程」与「MCP Server」分成两个进程、stdio 传输 | 硬编码的 13 个工具、把编辑逻辑写进 MCP server | `agent-bridge/src/bridge.js` `agent-bridge/src/mcp.js` |
| 14.4 Lower-Thirds-Editor | 动画参数持久化在图层数据里，编辑态与播放态彻底分离 | 其模板化字幕工程结构 | `LayerAnimation` + `computeLayerFrame()` |
| 14.5 melanie | 代码层 `api.output(channel, v)` / `api.input(channel)` 信号接口 | 其运行时与打包方式 | `src/render/codeEngine.ts` |
| 14.6 补充 | 手动推帧录制、本地字体枚举、store 切片组织 | —（多窗口同步无成熟先例，完全自研） | `src/render/exporters.ts` `src/persist/fonts.ts` `src/core/store.ts` `src/windows/*` |

---

## 14.1 Doory（shaongitbd/doory）

**看了什么**：`frontend/src/editor/animation/model.ts`。

**提取到的设计**

1. **动画分槽位而不是一条时间线**：`AnimSlot = 'enter' | 'exit' | 'emphasis'`。
   海报这种「短、循环、要素少」的场景，用户脑子里想的是「这块怎么进场 / 怎么退场 / 平时怎么呼吸」，
   而不是第 1200ms 的关键帧。所以本项目 `LayerAnimation = { enter?, exit?, emphasis? }`，
   每个槽位只有 `preset / duration / delay / easing / intensity` 五个字段。
2. **读宽容、写严格**：Doory 的 `normalizeAnim` 对传入值做范围钳制（时长 100..10000、步进 100ms），
   缺字段就补默认，未知枚举不报错。本项目照此实现：`normalizeProject()` 负责「读」——钳制数值、
   丢掉类型非法的图层、去重 id、强制背景回 index 0；`layer.update` 的 zod schema 负责「写」——越界直接拒。
3. **未知 preset 不崩**：Doory 保留未知 preset 字符串但按 `none` 播放。本项目 `samplePreset()` 的
   `switch` 有 `default: return IDENTITY`，所以旧文件被新版本打开、或者 Agent 手抖写了个不存在的
   preset，画面只是「没有这段动画」，不会整张海报渲染失败。
4. **采样缓存**：Doory 用 WeakMap 缓存动画配置的编译结果。本项目缓存的是**表达式**和**断行结果**，
   而且 key 用字符串（`expr` 原文 / 字体+字号+宽度+文本拼接），因为这两类输入本身就是可序列化的字符串，
   用对象身份做 key 反而拿不到复用。

**没借鉴的**

- **Yjs / CRDT**：Doory 有协同编辑，所以需要 CRDT。本项目是**单机单权威**（主窗口是唯一 Host），
  多窗口只是只读镜像。引入 CRDT 只会把「撤销栈归谁」「版本号怎么算」两个问题变成三个。
- **其导出格式矩阵**（多种模板/多分辨率的组合表）：本项目导出只有 PNG / WebM / JSON 三种，
  组合维度由用户在导出面板里选，不需要一张矩阵表。

**差异声明（14.7 格式）**

> 我借鉴了 Doory 的「三槽位动画 + 读宽容写严格 + 未知预设降级」设计，
> 但由于本项目没有协同需求、且撤销必须走单条命令总线，
> 我的实现是**纯本地 immer 补丁历史 + 槽位采样函数**，没有引入 CRDT，也没有引入它的事件溯源结构。

---

## 14.2 yft-design（yoiiis/yft-design）

**看了什么**：`src/types/elements.ts`。

**提取到的设计**

1. **以 `type` 为判别式的联合类型**：`ElementNames` 是一组 const 字符串，每个元素接口带自己的专属字段，
   公共字段（位置、尺寸、旋转、透明度）平铺在基类上。本项目 `BaseLayer` + `TextLayer/ImageLayer/VideoLayer/CodeLayer/BackgroundLayer`
   的判别联合直接照这个思路，`switch (layer.type)` 之后 TypeScript 自动收窄。
2. **渐变色标是数组而不是字符串**：`ColorStop { offset, color }`。本项目 `GradientSpec` 同样是
   `{ type: 'linear' | 'radial', angle?, stops: { offset, color }[] }`，这样色标能单独拖动，
   也能被 AI 以结构化方式修改（`background.setGradient`），而不是让模型去拼 `linear-gradient(...)` 字符串。
3. **几何属性与表现属性分层**：yft 把 `StrokeRect / AngleRect` 这类几何派生量单列，不塞进元素主字段。
   本项目把「派生量」全部做成**渲染期计算**（`layerCorners()`、`fitViewport()`），不落盘，
   避免出现「存了一份、算了一份、两份不一致」。

**没借鉴的**

- **Fabric.js**：它把 canvas 对象模型、事件、序列化、控件全包了，等于把「谁拥有状态」这件事交出去。
  本项目的核心诉求恰恰是「状态在 Zustand、渲染是纯函数」，所以用原生 Canvas2D + 自研 `renderScene()`。
- **Vue 生态与其物料/模板市场**：技术栈已定 React 18，模板市场也不在范围内。

**差异声明**

> 我借鉴了 yft-design 的「判别式联合类型 + 结构化渐变色标」设计，
> 但由于本项目要求「预览与导出共用同一套渲染函数」、且不能有第三方图形库持有状态，
> 我的实现是**纯数据 + `renderScene(ctx, project, opts)` 单入口**，没有 Fabric.js 的对象树。

---

## 14.3 p5js-ai-editor（adilmoujahid）

**看了什么**：仓库结构、`p5js-mcp-server-ts/src/index.ts`、`components/editor-ui/WebSocketListener.tsx`。

**提取到的设计**

1. **两进程分工**：浏览器里的编辑器 ↔ 本地 WebSocket 桥接 ↔ MCP Server（stdio）↔ LLM 客户端。
   桥接进程不碰业务，只做搬运。本项目完全照此分层：`agent-bridge/src/bridge.js`（WS + HTTP，端口 2718）
   与 `agent-bridge/src/mcp.js`（stdio，给 Claude Desktop / Cursor 用）是两个独立进程，可以只开其中一个。
2. **连接即握手**：它的 WebSocketListener 在连上后先同步一次编辑器状态，之后靠消息驱动。
   本项目在此基础上加了**心跳 + 清单刷新**（4s 一次 manifest），因为我们的工具清单来自命令注册表，
   改代码就会变，不能让 Agent 拿着过期工具列表。
3. **stdio 传输出错必须走 stderr**：`console.log` 会污染 JSON-RPC 流。本项目 `mcp.js` 里所有日志都走
   `console.error`，并在文件头写明这条纪律。

**没借鉴的（也是最关键的分歧）**

- **它的 13 个工具是硬编码的**：每个工具在 MCP server 里对应一个手写 `case`，参数 schema 与编辑器实现
  两份维护，天然会漂移。本项目**一个工具都不手写**：`buildToolSchemas()` 从命令注册表用
  `zodToJsonSchema` 导出，工具名只是 `layer.create → layer__create` 的机械转写，调用时反解回命令类型。
- **它的命令粒度偏底层**（改某个 p5 变量、执行任意代码）。本项目要求**语义化命令**：
  `layer.update` / `background.set` / `text.set` / `timeline.setRange`，参数即业务含义，
  既能被 AI 理解，也能被人读懂审计日志。

**差异声明**

> 我借鉴了 p5js-ai-editor 的「桥接进程与 MCP server 分离、stdio 传输」骨架，
> 但由于「工具 schema 必须由命令注册表单一数据源自动生成」是本项目的硬约束，
> 我的实现是**运行时拉取 manifest 动态注册工具**，没有一行硬编码的工具定义。

---

## 14.4 Lower-Thirds-Editor

**看了什么**：其动画参数如何随模板保存、播放时如何读取。

**提取到的设计**

**编辑态与播放态分离**：动画参数（时长、延迟、缓动、强度）是**图层数据的一部分**，随项目序列化；
播放器只读数据、不写任何 UI 状态。本项目 `computeLayerFrame(layer, index, time, duration)` 是纯函数，
输入只有图层数据 + 时间 + 画布尺寸，输出 `{ dx, dy, scale, alpha, spin }`；
时间轴 UI 只负责改数据（`timeline.setRange` 等命令），不参与求值。

好处很实际：PNG/WebM 导出、图层镜像窗口、网页里的实时预览，三处调用的是**同一个函数**，
不存在「预览好看、导出位置偏了」这类经典问题。

**没借鉴的**：它的模板工程结构与字幕业务字段（本项目没有字幕概念）。

**差异声明**

> 我借鉴了它的「动画参数持久化 + 编辑/播放分离」，
> 但由于本项目要求同一个函数服务预览、导出、镜像三个消费方，
> 我的实现把求值进一步收敛成**无副作用的纯函数**，连缓动函数表都是常量模块。

---

## 14.5 melanie

**看了什么**：其代码层（用户写代码生成画面）对外暴露的运行时 API。

**提取到的设计**

**命名信号通道，而不是共享变量**：`api.output(channel, value)` 写出，`api.input(channel)` 读取。
本项目代码层 `makeApi()` 实现了同名接口，底层是一条 `Map<string, number|string|boolean>` 的信号总线，
每个代码层按 `layer.id` 隔离，写入带类型检查。这样两个代码层之间可以「传一个数」，
但**不能互相拿到对方的函数或 DOM**——既够用，又不破坏沙箱边界。

配套还借鉴了它「错误要能被创作者看见」的态度：本项目的代码层逐帧 `try/catch`，
错误信息去重后通过运行时报文推到状态栏与图层面板，连续 3 次失败就熔断该层（停止执行、保留最后一帧），
避免一个死循环把整个 rAF 拖垮。

**没借鉴的**：它的运行时打包方式与具体绘图 API（本项目给的是 Canvas2D / GLSL / HTML 三种引擎）。

**差异声明**

> 我借鉴了 melanie 的 `output/input` 信号命名与「错误可见」原则，
> 但由于本项目在浏览器 `new Function` 沙箱里跑代码、且要支持三种引擎，
> 我的实现是**每个图层一份 Runtime 缓存 + 逐帧熔断 + 信号总线按层隔离**。

---

## 14.6 补充参考

| 参考 | 提取到的 | 本项目的实现 | 差异 |
| --- | --- | --- | --- |
| CanvasRecorder 类库 | `captureStream(0)` + `track.requestFrame()` 手动推帧，才能保证导出帧率与时间轴严格对应 | `exportWebm()`：`captureStream(0)` → 每帧 `requestFrame()` → `await sleep(1000/fps)`，按时间轴整段推进 | 没有用它的 API 封装，因为我们需要「按项目时间轴推进」而不是「按真实时钟录屏」 |
| WICG local-font-access | `navigator.fonts.query()` 能枚举本机字体 | `listLocalFonts()`：能力探测 + 权限失败降级到内置字体表 | 仅 Chrome/Edge 支持，Safari/Firefox 走 `SYSTEM_FONTS` 静态清单 |
| bkay-stack/open-product-designer | store 按「文档 / UI / 运行时」切片，UI 状态不写进文档 | `useEditor` 三段式：`project`（可序列化）/ `ui`（缩放、选中）/ `runtime`（播放、桥接、导出进度） | 我们的 `ui/runtime` 完全不进撤销栈，也不进自动保存 |
| 多窗口同步 | —（没有找到成熟先例） | 自研：`BroadcastChannel('poster-editor')` + Host 快照节流 50ms + 时间广播 100ms + Client `TimeSmoother` 外推 + `hostId` 校验 | 见 `src/windows/*`，降级链 popup → documentPictureInPicture → 应用内浮动面板 |

---

## 14.7 纪律自查

- **先读后写**：上面每个项目都标了具体文件；没有读到的部分（例如 Doory 的协同后端）不做任何描述性断言。
- **只借设计不搬代码**：本项目没有一行代码是从这些仓库复制的；相同的只有概念命名
  （`enter/exit/emphasis`、`output/input`、`ColorStop`），命名是接口，不是实现。
- **数据模型优先**：先定 `src/core/types.ts` 与 `schema.ts`，再写渲染、再写命令、最后写 UI。
  命令注册表是「能力的唯一真相」，UI、AI、Agent 都只是它的消费者。
- **差异必须写明**：每个项目下面的「差异声明」就是这件事，写法固定为
  「我借鉴了 X 的 Y，但由于 Z，我的实现是 W」。
