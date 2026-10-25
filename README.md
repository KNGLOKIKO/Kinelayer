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

**Kinelayer · 织层** —— 一个纯前端、可离线、命令驱动的动态海报编辑器。

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
│  │  ├─ commands/*.ts         78 条命令，按领域分文件（图层/文本/代码/背景/项目/资源/字体/时间轴/动画/选择/历史/窗口/导出/查询/AI/批处理）
│  │  ├─ bundle.ts             工程包（.kly）：ZIP 打包/解包、逐文件 sha256、五道解压闸门
│  │  ├─ importPipeline.ts     【v2.5】导入管线的纯函数部分：嗅探 → 预检报告 → 映射成图层/轨道
│  │  ├─ aiScene.ts            【v2.5】`scene.ai.json`：给 Agent 的语义投影（秒制、无 base64、代码摘要）
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
│  │  ├─ exporters.ts          PNG / WebM（手动推帧）/ JSON
│  │  └─ thumbnail.ts          工程缩略图（长边 480；首帧全单色时退到 0.5s 重拍）
│  ├─ persist/                 ★ 持久化：工程本体 + 索引 + 资源 + 偏好、两代旧库迁移、本地字体
│  ├─ windows/                 ★ 多窗口：协议、Host、Client、镜像 UI、图层时间轴、独立页入口
│  ├─ ai/                      ★ AI：OpenAI 兼容客户端、加密配置、演示 Agent、桥接客户端
│  ├─ ui/                      舞台、时间轴、属性面板、图层面板、AI 面板、对话框
│  │  ├─ Launcher.tsx          启动页：page（独立视图）/ overlay（编辑器内 Ctrl+O）两种形态
│  │  ├─ LauncherPage.tsx      路由 `/` 的入口：只挂启动页与 Toast，不挂 Host
│  │  ├─ NewProjectDialog.tsx  新建项目：名称 / 预设 / 宽高 + 单位换算 / 时长 / 帧率 / 背景
│  │  ├─ routes.ts             `?view=editor|layer|launcher` 的 URL 构造与跳转
│  │  ├─ layout.ts             响应式三档（wide ≥1440 / mid ≥1080 / narrow），rAF 节流
│  │  ├─ importFlow.ts         导入状态机：选文件 → 预检 → 报告 → 确认 → 写库（成功后关覆盖层/跳编辑器）
│  │  └─ ImportReportDialog.tsx 导入预检报告：格式、可编辑程度、图层统计、降级说明、缺失资源
│  ├─ app/services.ts          把「副作用能力」注入命令层的服务表
│  ├─ EditorApp.tsx            三栏布局 + 引导 + 主时钟 + 自动保存 + 快捷键 + 窄屏抽屉
│  └─ main.tsx                 注册命令 → 注入服务 → 按 URL 分流主窗口/图层窗口
├─ agent-bridge/               ★ 本机桥接（Node 18+，独立依赖）
│  ├─ src/bridge.js            WS + HTTP 中继（127.0.0.1:2718，令牌鉴权）
│  ├─ src/mcp.js               MCP stdio 服务端：工具从 manifest 动态生成
│  └─ test/e2e.mjs             16 项端到端自检（假 Host + 真 MCP 客户端）
├─ scripts/                    ★ 端到端自检（headless Edge + CDP，需 dev server 跑在 5273）
│  ├─ _cdp.mjs                 公共壳：起浏览器、连 CDP、waitFor/截图/开新标签、结果收集
│  ├─ v2-check.mjs             17 项 · 关键帧与时间轴
│  ├─ rename-check.mjs         21 项 · 品牌迁移与格式迁移
│  ├─ multi-project-check.mjs  32 项 · 多工程、索引、旧单工程迁移
│  ├─ agent-panel-check.mjs    16 项 · 桌面 Agent 提示词面板
│  ├─ bundle-check.mjs         20 项 · .kly 真下载/真导入/敌意包拒绝
│  ├─ launcher-check.mjs       22 项 · 启动页路由/新建对话框/单位换算/缩略图/删除/英文模式
│  └─ ai-check.mjs             33 项 · v2.5 导入预检/降级映射/scene.ai.json 往返/Remotion 明确拒绝
└─ docs/
   ├─ 00-reference-notes.md    参考项目提取报告（第十四章）
   ├─ 01-known-limitations.md  已知限制与扩展点
   ├─ 02-bundle-format.md      工程包格式（.kly = ZIP）规范与敌意输入闸门
   └─ 03-agent-integration.md  Agent 接入说明（中英双份，.en.md 为英文版）
```

**分层规矩**：`ui/` 不能直接改 `project`；`render/` 不能 import `store`；
`persist/` 是最底层（不 import `store` / `ui`），命令层可以直接用它；
`core/commands/` 不能 import `ui/`。副作用（导出、开窗、读文件）统一走 `services.ts` 注入。

---

## 命令一览（78 条）

| 分类  | 条数 | 代表命令                                                                                                                                                                                                                          |
| --- | -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 图层  | 13 | `layer.create` `layer.update` `layer.delete` `layer.duplicate` `layer.reorder` `layer.align` `layer.rename` `layer.fixAll` `layer.setVisible` `layer.setLocked` `layer.setBlendMode` `layer.setAnimation` `layer.setBindings` |
| 文本  | 3  | `text.setContent` `text.setStyle` `text.fitBox`                                                                                                                                                                               |
| 代码  | 4  | `code.setSource` `code.setEngine` `code.setParams` `code.resetRuntime`                                                                                                                                                        |
| 背景  | 2  | `background.set` `background.setCode`                                                                                                                                                                                         |
| 画布  | 3  | `canvas.resize` `canvas.setDuration` `canvas.setFps`                                                                                                                                                                          |
| 项目  | 10 | `project.new` `project.load` `project.create` `project.open` `project.rename` `project.duplicate` `project.deleteLocal` `project.listRecent` `project.exportBundle` `project.importBundle` |
| 资源  | 3  | `asset.import` `asset.place` `asset.remove`                                                                                                                                                                                   |
| 字体  | 3  | `font.register` `font.load` `font.remove`                                                                                                                                                                                     |
| 时间轴 | 5  | `timeline.play` `timeline.pause` `timeline.seek` `timeline.setLayerTiming` `timeline.setLoop`                                                                                                                                 |
| 动画  | 8  | `animation.setKeyframe` `animation.removeKeyframe` `animation.moveKeyframes` `animation.setEasing` `animation.setKeyframeValue` `animation.clearTrack` `animation.setAutoKeyframe` `animation.applyPreset`                     |
| 选择  | 4  | `selection.set` `selection.toggle` `selection.add` `selection.clear`                                                                                                                                                          |
| 历史  | 3  | `history.undo` `history.redo` `history.clear`                                                                                                                                                                                 |
| 窗口  | 4  | `window.openLayer` `window.closeLayer` `window.focusLayer` `window.setMode`                                                                                                                                                   |
| 导出  | 4  | `export.png` `export.webm` `export.json` `export.commands`                                                                                                                                                                    |
| 查询  | 4  | `query.project` `query.layer` `query.registry` `query.capture`                                                                                                                                                                |
| AI  | 4  | `ai.inspectImport` `ai.importProject` `ai.exportProject` `ai.queryCodeLayer`                                                                                                                                                   |
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

## v3 · 工作台：多工程、工程包、三档屏幕、图层时间轴

v2 之前一次只能开一个工程，关掉标签页就等于把旧的忘了。v3 补的是「工作台」这一层。

### 启动页（工程库）

访问根路径就是启动页，`Ctrl/Cmd + O` 在编辑器里打开同一个库（覆盖层，不重新加载）。

| 路由 | 视图 |
| --- | --- |
| `/` | 启动页（独立视图，**不是 Host**，只读索引 + 发命令） |
| `/?view=editor&projectId=xxx` | 编辑器（唯一 Host） |
| `/?view=layer&layerId=…&host=…` | 图层独立窗口（纯 Client） |
| `/?view=launcher` | 编辑器 + 工程库覆盖层（历史深链） |

启动页**从不渲染编辑器** —— 那会同时存在两个 Host（主时钟、撤销栈各一份）。点「打开」只做两件事：
写 `lastProjectId`，然后 `location` 跳进 `?view=editor&projectId=…`。三个视图分开打包，
列工程不需要先把 CodeMirror 和渲染引擎拉下来。

左栏新建：空白项目（1080×1440 / 5s / 30fps）、自定义尺寸、四个预设（海报 / 横幅 / 方形 / 竖屏）。
右栏最近项目（最多 12 张，按更新时间降序），悬停出「打开 / 重命名 / 导出工程包 / 删除」，
右上角「打开本地 .kly 文件」。空状态明确告诉你从左边新建。

**新建对话框**：项目名（≤60）、预设填充、宽高（40–8000px）、时长（0.5–600s，0.1 步进）、
帧率（24/25/30/60）、背景色。宽高支持 **px / mm / cm / in** 四种单位，按 96dpi 换算
（1mm = 96/25.4 px），切单位时数字跟着换算、物理尺寸不变；**数据层永远只存 px**。
创建后直接进编辑器，并且当场写一次缩略图 —— 否则回到工程库就是一张空白卡。

删除当前工程时会先 `detach`：自动保存从此跳过它，否则定时器一响就把刚删的工程写回来。

### 工程包 `.kly` = 真 ZIP

`Ctrl/Cmd + S` 导出的 `.kly` 是一个 ZIP：`manifest.json` + `project.json` +
`assets/`（图片视频原文件）+ `fonts/`（只含用户上传的字体），逐文件带 sha256。
资源不再是 base64，所以工程包能真的带走素材，换台机器打开图片还在。

读包时假定包是敌意的：条目数 / 单文件大小 / 总大小 / 压缩比 / 路径穿越五道闸门
全部在 inflate **之前**判定。导入会换新 id，不覆盖本机同名工程；字体缺失降级到系统字体，
资源缺失才报错。完整规范见 [工程包格式](docs/02-bundle-format.md)。

老备份不会作废：`looksLikeZip()` 只看前两字节，是 `PK` 就走工程包，否则走旧的
`project.load`（v1 JSON 外壳、更早的裸 `Project` JSON 都认）。

### 响应式三档

| 档位 | 宽度 | 布局 |
| --- | --- | --- |
| `wide` | ≥ 1440 | 左 268 + 舞台 + 右 318，全套文字标签 |
| `mid` | ≥ 1080 | 面板收窄到 232 / 288，顶栏隐藏副标题 |
| `narrow` | < 1080 | 两个面板变**抽屉**（覆盖层，不挤压舞台），底栏胶囊开关面板 / 时间轴 / 检查器；顶栏只留图标 |

阈值在 `src/ui/layout.ts` 的 `WIDE_MIN` / `MID_MIN`，`useLayoutTier()` 用 rAF 节流监听
`resize`，不给每次拖动都跑一轮 React 渲染。

### 图层独立窗口里的时间轴

图层窗口（`?layer=<id>`）原来只能看属性，现在中间多了一条自己的时间轴：
in/out 之外压暗、每条属性轨道一条细线、关键帧按属性配色画成菱形、播放头红线，
还能跳到上一个/下一个关键帧。

它是**只读镜像**：拖动只发 `{ kind: 'command', command: 'timeline.seek' }` 给 Host，
落点由 Host 决定并广播回来。seek 节流到 80ms（保留最后一次落点），
所以拖着划过整条时间轴也只会打出一串稀疏的 seek，不会把消息队列灌满。

---

## v2.5 · AI 代码视频：导入与语义导出（阶段 A）

这一阶段的定位是「让 AI 生成的工程进得来、出得去」，三条原则：

1. **代码是一等公民图层**。导入不了的东西不硬塞成图片：能映射成文本/图片/轨道的就映射，
   映射不了又确实要画的（矩形、圆、路径）降级成 canvas2d 代码层 —— 位置/尺寸/透明度照样能打关键帧，
   只是内部不可逐元素编辑。
2. **导入先预检，再落库**。`ai.inspectImport` 是纯函数，给字节或文本就能算出「会得到什么」：
   格式、可编辑程度、图层/代码层/轨道/关键帧计数、每一处降级的原因、缺失的资源。
   用户确认后 `ai.importProject` 才写库（它内部会再跑一次同样的预检，Agent 跳过第一步也拿得到报告）。
3. **导出带「工程语义层」**。`ai.exportProject` 产出 `scene.ai.json`：时间统一秒、缓动压成字符串、
   代码层给 `codeSummary` + `codeLines` + `codeBytes`，**不含任何 base64**。

### 判据：什么被映射，什么被降级

| 输入 | 结果 | 可编辑程度 |
| --- | --- | --- |
| `.kly` 工程包 | 走 `project.importBundle`（校验 sha256） | 100 |
| 原生 `project.json` | `normalizeProject` 精确还原（认的是 blendMode/animation/inPoint 这套原生字段，不是 `layers[0].type`） | 100 |
| `scene.ai.json` | 摊平回场景形状再走同一条映射管线 | 96 起 |
| 场景 JSON（Rendervid / cadence 风格） | 文本→文本层、图片视频→媒体层、坐标/尺寸/时序→图层属性、`tracks`→属性轨道；矩形/圆→canvas2d 代码层 | 70–96 |
| HTML / GSAP 片段 | 整段作为 `html` 代码层 | 55 |
| 图片 / 视频 | 建画布 + 媒体层 | 30 |
| Remotion 工程 | **明确拒绝**（浏览器里跑不了 TSX，不假装导入成功），等阶段 B 的静态解析 | — |

`scene.ai.json` 能原路导回（33 项自检里有一组往返用例）：导出的语义投影再导入，
图层数、文字内容、轨道与关键帧都能对上；媒体层因为不带二进制，只会剩资源名 ——
这一点在预检报告里明写，不靠用户自己发现。

### 每一层都记得自己从哪来

`LayerOrigin = { generator, sourceFormat, sourceBundle, importedAt }`，不参与渲染，
只服务三件事：图层树上的来源徽标（`AI` / `导入` + 悬浮看详情）、导入降级决策的审计、以及「这层为什么改不了」。

### 相关命令

```
ai.inspectImport   { stageId | text, name?, format? }        → { report, importable }
ai.importProject   { stageId | text, mode? }                 → { projectId, format, fidelity, counts… }
ai.exportProject   { projectId?, includeCode?, download? }   → { filename, text, bytes, layers… }
ai.queryCodeLayer  { layerId?, includeCode? }                → 代码层摘要（不拉整份场景）
```

阶段 B（Remotion 静态解析 + `remotion-component` 引擎）与阶段 C（HTML/GSAP 结构化提取）
还没做，README 与 `docs/01-known-limitations.md` 都按「没做」写。

---

## 快捷键

| 操作            | 快捷键                                     |
| ------------- | --------------------------------------- |
| 撤销 / 重做       | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift + Z` |
| 复制选中图层        | `Ctrl/Cmd + D`                          |
| 打开工程库（覆盖层）    | `Ctrl/Cmd + O`                          |
| 导出工程包 `.kly` | `Ctrl/Cmd + S`                          |
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

**不想手写配置**：打开「设置 → 桌面 Agent」，那里有一份由命令注册表实时生成的接入提示词——
站点地址、两种接入方式、74 条命令的能力范围、七条调用契约、七条权限边界、错误码处置、
外加三条 `curl` 自检命令，一键复制就能交给本机 Agent 工具；旁边还有「复制 MCP 配置」。

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

- **工程包 `.kly`**：真 ZIP —— `manifest.json` + `project.json` + `assets/` + `fonts/`，逐文件 sha256。
  素材二进制原样躺在包里（不再 base64，体积不膨胀 33%），换台机器打开图片还在；
  系统字体不打包（本来就有，且避免字体授权问题）。格式规范见 `docs/02-bundle-format.md`。
- **JSON 备份**：设置 → 数据 → 导出 JSON 备份，产出纯 JSON 工程本体，不含二进制 —— 适合进 git 看 diff。
- **导入宽容**：`.kly`、v1 JSON 外壳、更早的裸 `Project` JSON 三种都认，老备份不会因为改格式而打不开。
- **自动保存**：每 1.6s 把项目写进 IndexedDB（`kinelayer` 库），刷新页面自动恢复。
- **不出网**：除你主动配置的 AI 接口外，应用不发起任何网络请求；没有 CDN、没有埋点、没有远程字体。
- **升级不丢数据**：品牌更名时数据库与存储键都换了名字，首次启动会把旧库数据**整份复制**到新库，
  旧库原样保留（不删）；旧命名空间的 localStorage 键在读取时自动迁移；旧版裸项目 JSON 备份照样能导入。

---

## 文档

- [参考项目提取报告](docs/00-reference-notes.md) —— 第十四章逐项说明「借什么 / 为什么不搬 / 差异在哪」
- [已知限制与扩展点](docs/01-known-limitations.md) —— 导出格式、沙箱边界、多窗口降级链、性能账本
- [工程包格式](docs/02-bundle-format.md) —— `.kly` 的 ZIP 布局、manifest 字段、五道敌意输入闸门、错误码

## 许可

MIT，见 [LICENSE](LICENSE)。参考项目的设计与命名归属其原作者（详见 `docs/00-reference-notes.md`），
本项目只借鉴设计、未复制其代码。
