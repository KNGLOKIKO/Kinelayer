# 自定义命令：让用户和 AI 共用同一套「宏」

一条命令只能干一件事。可真实的工作流是「做一张标题卡要三步」、「改配色要连着改五个层」。
用户记不住也懒得记，AI 每次都要重新推一遍 —— 于是有了自定义命令。

核心取舍只有一个：**自定义命令不是一门新语言，它就是「一串已有命令 + 一组参数」。**

---

## 一、为什么不做 DSL

做宏系统最自然的冲动是设计一套小语言：变量、循环、条件、表达式。
但在这个工程里，那意味着第二套真相：

| 如果做 DSL | 后果 |
| --- | --- |
| 宏里能写表达式 | 得为它实现求值、类型检查、错误定位——一套运行时 |
| 宏里能写 if | 撤销栈要能表达「这次跑了哪些步骤」，patch 合并逻辑得重写 |
| AI 要写宏 | 得先把 DSL 学会，而它本来就会写 JSON 命令 |

所以这里的宏只有三个字段：

```ts
interface CustomCommandStep {
  id: string;
  type: string;                          // 就是注册表里的命令名，例如 canvas.setDuration
  payload: Record<string, unknown>;      // 就是那条命令本来要的 payload
  note?: string;                         // 这一步在干什么（给人看的）
}
```

**好处**：一条宏能用到的所有能力，等于命令注册表的上限；
每加一条新命令，宏的可用动作自动多一个，不需要改宏系统的任何代码。

---

## 二、`{{x}}` 的两种语义

参数在 payload 里用 `{{key}}` 引用。同一个占位符，位置不同，行为必须不同：

```jsonc
// 整个字符串就是一个占位符 → 保留原类型
{ "duration": "{{ms}}" }          // 传 7500 → 得到数字 7500

// 嵌在字符串里 → 拼接成字符串
{ "text": "标题-{{tag}}" }        // 传 "ABC" → 得到 "标题-ABC"
```

判断只有一条正则：

```ts
const WHOLE_PLACEHOLDER = /^\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}$/;
```

**为什么必须区分？** 因为 `canvas.setDuration` 的 schema 是 `z.number()`。
不做类型保留，`"7500"` 会被 zod 拒收，而用户看到的错误是「Expected number, received string」——
他会以为是宏写错了，实际上是填值方式的问题。

### 参数类型与「校验用假值」

五种类型：`number` / `string` / `boolean` / `color` / `layerId`。

保存时要跑一遍校验，但那时还没有真实参数值。于是每个类型造一个合法假值去试跑（`dummyFor`）。
这里有个坑：

```ts
case 'layerId': return 'ly_sample';   // 不能是 ''：zId 有 min(1)，空串会让「其实没问题」被误判
```

---

## 三、一条宏 = 一次原子批处理

用户按一下「运行」，期望的是「要成一起成，要败一起败」，而不是「第 3 步挂了，前两步留下」。

这件事在工程里已经有现成实现（`command.batch` + `atomic: true`）：失败回滚、合并成一个撤销点、逐条审计。
所以 `custom.run` 自己**不实现执行**，只负责「把占位符填成值」，然后把展开后的步骤交出去：

```ts
const expanded = expandSteps(cmd, resolved.values, getCommand);
const outcome = await ctx.services.runSteps(expanded.steps);
```

### 为什么绕一层 `services`

因为命令层不能反向依赖总线：

```
commandBus → commands/index → commands/custom → commandBus   ← 循环
```

`Services.runSteps` 把这条依赖反过来注入，顺带保证「一批命令 = 一个撤销点」只在总线里实现一次。

### 失败时留下什么

- `runCount` **只在成功时 +1**（失败不算「跑过一次」）
- `lastError` 记下「第几步、哪条命令、什么错」，落库，刷新后还在
- 卡片上用红字显示，AI 用 `custom.list` 也能看到

---

## 四、存之前校验，不是跑之前

跑的时候才发现「第 3 步的 payload 缺字段」，等于「保存成功但永远失败」——
用户不会知道是保存那一步就该拦下的。

`validateCustomCommand` 在保存时检查五件事：

| 检查 | 报什么 |
| --- | --- |
| 命令是否存在 | `第 1 步：注册表里没有命令「layer.nope」` |
| payload 是否符合该命令的 schema | `第 1 步：Expected number, received string（duration）` |
| 占位符是否声明过 | `第 1 步：用了没声明的参数 {{ms}}` |
| 是否踩了禁区命令 | `第 1 步：宏不能调用宏（会无限递归）` |
| 参数是否重名 / 名字是否合法 | `参数 ms 重复了` |

### 一处例外：来自占位符的字段降级为 warning

`"{{ms}}"` 在校验期被换成假值 `0`，真实值是运行时才知道的。
如果用户把 `duration` 写成 `"{{title}}"`（title 是文本参数），静态校验看不出来。

所以比对 zod 报错的路径：**错误落在占位符所在字段上**就降级成 warning（「该字段由参数提供，运行时会再校验一次」），
否则算 error。这样既不放过真错误，也不会把「其实能跑」的宏拦在门外。

---

## 五、禁区命令

有些命令放进宏里会自我指涉，直接禁掉，并在编辑器下拉里过滤掉（看不到就不会写进去）：

| 命令 | 理由 |
| --- | --- |
| `command.batch` | 批处理不能嵌套 —— 宏本身已经是一次批处理 |
| `custom.run` / `custom.define` / `custom.remove` | 宏调用宏会无限递归；宏定义宏会让「保存」产生副作用 |
| `custom.list` | 宏里没有读命令清单的理由 |
| `history.undo` / `redo` / `clear` | 一次宏本来就是一次撤销点，宏内部操作撤销栈等于拆自己的地板 |
| `project.*` | 宏只改画布内容；换文档会清掉撤销历史，而宏的撤销点依赖它 |

---

## 六、持久化：跟人不跟工程

宏存在**独立的 IndexedDB store** 里（`commands`，DB 版本 3），不进 `.kly` 工程包。

理由：在 A 工程里写的「做标题卡」，在 B 工程里同样有用；
把它塞进工程包，会导致「换工程就没了」或者「同一个宏存了十份」。

```
IndexedDB: kinelayer
  ├─ projects      工程本体
  ├─ assets        资源 blob
  ├─ fonts         本地字体
  └─ commands      自定义命令     ← v2.7
```

`RuntimeState` 里只放一份**内存副本**，两个字段分工明确：

```ts
customCommands: CustomCommand[];      // 界面直接读这份
customCommandsLoaded: boolean;        // 区分「还没读」和「读完了是空的」
```

少了第二个字段，首屏会先闪一下「还没有自定义命令」，然后才出现卡片。

读失败不拦启动：只是面板空着，用户还能新建。

---

## 七、界面

左栏新增「自定义」页签（在「字体」和「命令」之间），一条宏一张卡片：

- 名字 + `AI` / `我` 徽标（`author` 由命令来源推断，AI 通过桥接或 MCP 建的就是 `ai`）
- 描述、`N 步 · M 参数`、`跑过 N 次`
- 上一次的错误用红字留在卡片上
- 一级按钮：运行 / 编辑 / 删除

**有参数的宏点「运行」会先弹表单**：不问就按默认值跑，等于替用户做决定。没有参数的直接执行。

编辑器是三段式：名称描述 → 参数行 → 步骤卡片。
步骤卡片里选命令（按分类分组、`<optgroup>`），下面是 payload 的 JSON 文本框，
旁边列出这条命令的说明和「插入参数」按钮（按光标位置插入，不是追加到末尾）。

新建时如果一条步骤都没有，会给一个「从示例开始」——两步文字层做标题卡，比对着空对话框发呆有用。

---

## 八、AI 怎么用

四条命令，全部 `mutating: false`（它们只改 IndexedDB 和内存缓存，不动 `project`，所以不该产生撤销点）：

| 命令 | 作用 |
| --- | --- |
| `custom.list` | 列出现有宏（名字、参数、步骤数、跑过几次、上次错在哪） |
| `custom.define` | 新建或覆盖一条宏；不传 `id` 是新建，传 `id` 是覆盖（保留运行次数） |
| `custom.run` | 按参数执行；支持 `dryRun` |
| `custom.remove` | 删除一条宏 |

`custom.run` 的 `dryRun` **真的什么都不做**，只回报「如果跑会跑哪些步骤」：

```ts
if (ctx.dryRun) return { id, name, dryRun: true, steps: expanded.steps, warnings };
```

这样 AI 可以先试算一遍，把展开结果给用户看，确认了再真跑。

`author` 由调用来源推断（`source === 'user' | 'window'` → `user`，其余 → `ai`），
所以「谁建的这条宏」是记录在案的，不是猜的。

---

## 九、顺手修掉的两个老 bug

做这一版时被 `command.batch` 踩出来的，都不是新代码的问题：

### 1. `canvas.setDuration` 每次都抛 revoked proxy

```ts
ctx.runtime((rt) => {
  rt.playhead = clamp(rt.playhead, 0, draft.duration);   // draft 这时已经被 immer 回收
});
```

副作用闭包是在 `produceWithPatches` **结束之后**才执行的，那会儿 `draft` 已经 revoke。
后果很隐蔽：状态其实提交成功了，但命令返回失败 —— 用户在属性面板改时长，
画面变了、时长也对，但控制台每改一次就多一条 unhandled rejection。

修法：先把值取成普通数字再闭包。

```ts
const duration = Math.round(payload.duration);
ctx.runtime((rt) => { rt.playhead = clamp(rt.playhead, 0, duration); });
```

`timeline.play` 有一模一样的写法，目前因为它是非 mutating 命令（拿到的是真对象而非 draft）而侥幸不崩，
一并改掉，免得哪天给它加上 mutating 就炸。

### 2. 批处理遇到「抛异常的命令」不回滚

```ts
for (const item of payload.commands) {
  const result = await runCommand({ ... });   // 一旦 reject，整个循环直接跳出
}
if (failed && payload.atomic) performUndo(applied);   // ← 永远到不了
```

单条命令抛异常（而不是返回 `ok: false`）时，回滚代码根本执行不到，
「原子」变成「前两步已提交、后面全没跑」。修法是把异常收成一条失败结果再走正常流程。

---

## 十、故意没做的

- **条件与循环**：见第一节。真需要就用 AI 直接生成多条命令，而不是把宏变成编程语言。
- **宏调用宏**：会引入递归、深度限制、循环检测，收益远小于成本。
- **跨设备同步**：宏现在只在本机 IndexedDB。团队共享是另一个问题（需要账号体系）。
- **导入导出宏**：暂无。真要分享，`custom.list` 的结果已经是完整 JSON，复制粘贴即可。
- **命令描述的英文翻译**：命令注册表里 84 条命令的描述目前只有中文，命令面板也一样。
  自定义命令编辑器的步骤卡片会原样显示这段中文（`data-cmd-meta` 标记），属于全局未翻译项。

---

## 十一、自检

`scripts/custom-check.mjs`，39 项，九个区块：

| 区块 | 验什么 |
| --- | --- |
| 定义与校验 | 存下来了、`author=user`、五种拒绝理由都指向具体步骤 |
| 原子执行 | 跑通、时长真的变了、只产生一个撤销点、撤销一次整体回滚 |
| 参数 | 整值占位保留数字类型、内嵌占位拼接、类型不对报 VALIDATION |
| 失败 | 二步宏失败后第一步的层被回滚、`lastError` 落库、失败不计入运行次数 |
| dryRun | 回报展开后的步骤，且**不执行** |
| 持久化 | 刷新后三条宏还在、运行次数也在 |
| 界面 | 卡片列出 3 条、说明几步几参、无参直接跑、有参弹表单、编辑器回填参数与步骤 |
| 保存拦截 | payload 写坏时对话框不关并指出第几步 |
| 双语 | 英文模式下面板与编辑器零中文（用户数据与注册表元信息单独计数） |

跑法：

```bash
npm run dev            # 另开一个终端，5273 端口
node scripts/custom-check.mjs
```
