# 导入之后：缺的资源、来源、补回

导入报告是个**一次性对话框**。它关掉之后，缺资源的层在画布上只剩一块
「图片资源缺失」的灰色占位 —— 用户既不知道这层原本指向哪个地址，
也不知道一共有几层是这个状态，更不知道去哪儿补。

这一篇讲的就是这一段：**报告关掉之后的那部分体验**。

覆盖三种来源格式（Remotion / HTML·GSAP / 场景 JSON），因为它们缺资源的样子
一模一样，处理方式也该一模一样。

---

## 一、媒体层的四种状态

「没图」不是一个状态，是四个。混在一起说会导致「明明有 assetId 为什么还是空的」这类问题。

| 状态 | `assetId` | 画布 | 说明 |
| --- | --- | --- | --- |
| 从没指定 | `null`，且无 `origin.sourceRef` | 「未选择图片」 | 用户新建的空图片层 |
| 引用没落地 | `null`，有 `origin.sourceRef` | 「图片资源缺失」 | 导入时拿到了地址但没拿到字节（最常见） |
| 落地后被删 | 指向一个已不在 `project.assets` 的 id | 「图片资源缺失」 | 用户删了资源但没删层 |
| 物化失败残留 | `pending:ly_xxx` | 「图片资源缺失」 | 映射器占位，写库那一步抛了异常 |

界面上把它们统一成「缺资源」，判断只有一处：

```ts
// src/ui/assetGaps.ts
export function isAssetMissing(project: Project, layer: Layer): boolean
```

口径是 **`project.assets` 里找不找得到这条元数据**，不是「位图解码出来没有」。
原因很实际：刚导入完时资源还在异步解码，用位图判断会让界面先闪一下「缺资源」再变正常。

---

## 二、`origin.sourceRef` 只记「没拿到」的那种

`LayerOrigin` 新增了一个字段：

```ts
export interface LayerOrigin {
  // …原有的 generator / sourceFormat / sourceBundle / importedAt / parser / external
  /** 原工程里这一层指向的地址；只在那个引用没被落地成资源时才写 */
  sourceRef?: string;
}
```

**为什么不在拿到图的时候也记一遍？** 因为那就成了噪音：每层都带一条资源路径，
而「这层用的哪张图」在 Inspector 的图片区块里已经写着，不需要第二份真相。

**为什么要单独留一个字段？** 因为报告关掉之后，这个地址是唯一的线索。
用户在别处找到那张 logo，第一反应是「我原来那个是哪个」，不是「随便来一张」。

**为什么界面上按线索展示、不按事实展示？** 远程地址会失效、相对路径在原工程里可能已经改了名。
它回答的是「原本指向哪儿」，不是「现在还能下到」。

| 来源 | 写入时机 | 值长什么样 |
| --- | --- | --- |
| Remotion `staticFile('assets/a.png')` | ZIP 里按后缀找不到同名字节 | `assets/a.png` |
| HTML `<img src="https://…">` | 远程地址，不替用户下载 | 完整 URL |
| HTML `<img src="./logo.png">` | 单文件里没有这个文件 | `./logo.png` |
| 场景 JSON 的 `src` / `image` / `path` | 非 data URL 的一切引用 | 原样 |

data URL 不写：它当场就进了资源库，没有「原本在哪」的问题。

---

## 三、三个入口，各管一段

### 3.1 图层树：总账 + 定位

- 缺资源的层，行尾（来源徽标后面）有一个琥珀色 ⚠，悬浮显示原始地址
- 面板顶部出现一条横幅：**「N 层缺资源 · 定位」**，点一下把这 N 层全部选中

横幅挨着图层列表，是因为这件事的性质是「有几处要处理」，
而不是「某个参数填错了」——用户需要的是一个可点的总数，不是一个红点。

### 3.2 Inspector：「来源」区块

Inspector 的最后一节（默认收起，不挡日常参数）：

| 行 | 内容 |
| --- | --- |
| 格式 | `HTML / GSAP 片段` / `Remotion 工程` / `场景 JSON` / `Kinelayer 语义层` … |
| 解析器 | `html-dom/1`、`remotion-ast/1`、`scene-json/1` |
| 来源包 | 文件名 |
| 导入时间 | 本地时间 |
| 外部依赖 | 前 3 条 + 「还有 N 个」，并注明**导出与离线打开拿不到** |

缺资源时这块会多出一个处方区：

1. 一行说明（「这层的图片没跟着导入」）
2. 原始地址（等宽字体、可换行、悬浮看全文）
3. 「另有 N 层指向同一个地址，会一起补上」
4. 下拉框：从**资源库已有的图片/视频**里选
5. 按钮：从本地补一个（先入资源库，再挂到层上）

放在同一个区块里是有意的：**溯源信息是诊断，补资源是处方**。
拆到两个地方，用户就得自己把「这层指向 X」和「替换资源」连起来。

### 3.3 命令：`asset.assign`

```json
{ "type": "asset.assign", "payload": { "ids": ["ly_a", "ly_b"], "assetId": "as_c" } }
```

给 Agent 留的入口，也是界面上那两个控件的底层。

---

## 四、`asset.assign` 的四条语义

1. **一批一起改**：`ids` 是数组。同一张 logo 被三处引用时，一次调用解决
2. **先校验完再动手**：任何一层类型不合适就整批拒绝，不会出现「改了一半」
   （半套成功比完全失败更难排查）
3. **只换资源**：位置、尺寸、旋转、透明度、关键帧、层名一个字都不动
4. **类型必须匹配**：视频资源挂图片层 → `VALIDATION`；反之亦然

**为什么不用 `asset.place`？** 它会在画布中央新建一层。
补资源时这么做等于留下一层重影 —— 用户会看到「我补了一张图，怎么多出来一个」。

---

## 五、同一个地址被多处引用

HTML 里最常见：一张 logo 在三处 `<img src="同一个 URL">`，导入后是三张空占位。

```ts
export function sameRefLayers(project: Project, layer: Layer): Layer[]
```

规则：`origin.sourceRef` 相同 **且** 同样缺资源的其它层。

界面上不弹二次确认，而是在处方区直接写明「另有 N 层指向同一个地址，会一起补上」——
**说出来比问一句更有用**：用户看到这句话就知道会发生什么，不想连坐就先去改地址。

---

## 六、语义层里也要有

`scene.ai.json` 的 `origin` 之前只带四个旧字段，导致 Agent 拿到的是一个
「缺图但没有线索」的层。现在补上：

```json
{
  "type": "image",
  "asset": null,
  "origin": {
    "generator": "import",
    "sourceFormat": "html",
    "sourceBundle": "poster.html",
    "parser": "html-dom/1",
    "external": ["https://cdn.example.com/brand/logo.png"],
    "sourceRef": "https://cdn.example.com/brand/logo.png"
  }
}
```

`parser` 让 Agent 能判断「这层是旧规则拆的，可能少东西」；
`sourceRef` + `external` 让它知道这层为什么缺图 —— 而不是笼统地建议「重新导入一次」。

### 6.1 运行时摘要同样要带（v2.9 补）

`scene.ai.json` 是**导出物**，只有「文件换手」的时候才用得上。Agent 平时看的是另一条路：
通道 A 的每次请求、以及 `query.project` 的返回值，都走 `summarizeProject()` 的白名单投影。
这个投影只挑字段（不传 base64、不传完整代码），`origin` 原来不在名单里 —— 于是
导出物里有线索、对话里反而没有，模型照样会建议「把这张图换成别的」。

现在摘要会给带 `origin` 的层附上一小段：

```json
{ "index": 3, "type": "image", "assetId": null,
  "origin": { "generator": "import", "sourceFormat": "scene-json",
              "sourceRef": "https://example.com/bg.png" } }
```

三条边界：

- **只给带了 `origin` 的层**。手搓的层没有这个字段，缺省就是「用户自己做的」；
  给每层补一个 `{ generator: 'user' }` 会把真正有信息量的那几层淹掉。
- **不放 `sourceBundle` / `importedAt`**。包名与时间对人有用（审计、回查），
  对写代码没用，进了上下文只是噪声。
- **`sourceRef` 截到 200 字符，`external` 只留前 8 条**。它可能是整段 `data:` 或超长 URL，
  原样塞进去会把真正要改的几何信息挤出窗口。

---

## 七、故意没做的

| 不做 | 为什么 |
| --- | --- |
| 替用户下载远程图片 | 网络策略、体积、失效都不可控；而且「静默联网」和这个产品的「不出网」承诺冲突 |
| 猜「这层大概是哪张图」 | 猜错比空着更糟：用户会以为已经好了，直到导出才发现是错的图 |
| 按新图比例改图层框 | 改了尺寸等于把用户排好的版挪了。保持原框、让 `fit` 去处理，是更保守的选择 |
| 「一键替换全部缺资源」 | 不同层指的往往不是同一张图，批量套同一张会造出一堆错的 |
| 把 `sourceRef` 做成下载按钮 | 那是「联网抓取」换了个壳，见第一条 |

---

## 八、自检

`scripts/import-edit-check.mjs`（30 项）用一份「两张图指向同一地址 + 一张 data URL 做对照」的
HTML 样例，覆盖：

- 语义层与报告：`sourceRef` / `parser` / `external` 三条线索都到位，data URL 的不被误标
- 界面：⚠ 标记数、总账文案、点总账能全选、「来源」区块展开后内容正确
- 命令：`asset.assign` 单个/批量、不动几何、类型冲突整批拒绝、空 ids 被 schema 挡
- 补完之后：标记与总账自动消失
- 词条：新增文案全有英文；英文模式下「来源」区块零中文

`scripts/ai-check.mjs`（38 项）里另有四条针对**摘要投影**的断言（2b 区块）：
除背景外每层都带 `origin`、`sourceFormat` / `generator` 读得出、缺资源那层的
`sourceRef` 是原地址、手搓的层不长出空 `origin`。

```bash
npm run dev                      # 端口 5273
node scripts/import-edit-check.mjs
```

> 这个脚本第一次跑出来是 19/28，两个坑值得记：
> ① 启动页 `/` 上根本没有图层面板和 Inspector，断言只能得到 0，
> 必须先 `Page.navigate` 到 `?view=editor&projectId=…`；
> ② Inspector 是 `overflow-y-auto` 的，「来源」在最后一节，
> 不 `scrollIntoView` 就点，坐标落在视口外 —— 点了个寂寞。
