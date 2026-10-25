# 工程包格式（`.kly`）

> 当前格式：`kinelayer-bundle` **v2**
> 实现：`src/core/bundle.ts`（打包 / 解包 / 闸门）、`src/core/commands/project.ts`（两条命令）
> 自检：`node scripts/bundle-check.mjs`（20 项端到端，含敌意包拒绝）

---

## 1. 为什么不是「一个大 JSON」

v1 的 `.kly` 其实是「套了个壳的 JSON」：`{ format, formatVersion, app, exportedAt, project }`。
工程本体里不带二进制，图片/视频全在 IndexedDB 里 —— 换台机器打开就是一堆空图。

想把素材一起带走，只有两条路：

| 方案 | 后果 |
| --- | --- |
| 二进制 base64 塞进 JSON | 体积 +33%，一张 8MB 的图变 11MB 字符串；`JSON.parse` 在主线程上卡住整个编辑器 |
| **ZIP 里原样躺二进制，JSON 只记清单** | 体积不膨胀、解析不卡、任何解压工具都能打开检查 |

所以 v2 的 `.kly` 是**真 ZIP**。你甚至可以把后缀改成 `.zip` 用系统解压工具打开看。

---

## 2. 目录结构

```
my-poster.kly              ← 实际上是 ZIP
├─ manifest.json           清单：格式版本、工程概要、每个文件的 sha256 与大小
├─ project.json            工程本体（和 IndexedDB 里存的那份完全一致）
├─ assets/
│  ├─ as_7f3k2n1q.png      图片 / 视频原文件，文件名 = 资源 id + 按 MIME 推出来的扩展名
│  └─ as_9d0m4p2r.mp4
└─ fonts/
   └─ Source-Han-Sans-700-normal.woff2
```

- `assets/` 与 `fonts/` 都是**可选目录**：没有素材的工程打出来就只有两个 JSON。
- 字体只打包 `source === 'upload'`（用户自己传的）；系统字体不打包 —— 换台机器本来就该有，
  打包进去等于白白让文件膨胀几 MB，还会有字体授权问题。
- `fonts/` 的文件名是 `slug(族名)-字重-字形.扩展名`，族名会被洗成 `[a-zA-Z0-9._-]`：
  ZIP 路径里出现空格、斜杠、中文都可能被别的解压工具搞坏，而族名的**真值**记在清单里，不靠文件名还原。

---

## 3. manifest.json

```json
{
  "format": "kinelayer-bundle",
  "formatVersion": 2,
  "app": "Kinelayer 0.1.0",
  "exportedAt": 1761363131000,
  "schemaVersion": 2,
  "project": {
    "id": "prj_t7bmbju39me",
    "name": "BUNDLE-SRC",
    "width": 1080,
    "height": 1080,
    "duration": 4000,
    "fps": 30,
    "layerCount": 3
  },
  "assets": [
    {
      "id": "as_t7e1ei61z9c",
      "name": "dot.png",
      "mime": "image/png",
      "path": "assets/as_t7e1ei61z9c.png",
      "bytes": 926,
      "sha256": "6b1f…"
    }
  ],
  "fonts": [
    {
      "family": "Source Han Sans",
      "weight": 700,
      "style": "normal",
      "mime": "font/woff2",
      "path": "fonts/Source-Han-Sans-700-normal.woff2",
      "bytes": 184320,
      "sha256": "a3c9…"
    }
  ],
  "checksum": { "algo": "sha256", "project": "2daa175cfc88…" }
}
```

| 字段 | 用途 |
| --- | --- |
| `format` | 固定 `kinelayer-bundle`。**不是这个值直接拒收**，防止把别人的 ZIP 当工程包读 |
| `formatVersion` | 包格式版本，当前 `2`。比编辑器新 → 报「请先升级 Kinelayer」，不做降级猜测 |
| `schemaVersion` | `project.json` 里数据模型的版本（当前 `2`），与包格式版本是两件事 |
| `project` | 工程概要，给启动页/导入预览用，**不是**工程本体 —— 正文在 `project.json` |
| `assets[].sha256` | 逐文件校验；缺文件或校验不过都直接拒收 |
| `fonts[].sha256` | 同上，但**字体缺失不致命**（见 §6） |
| `checksum.project` | `project.json` 的 sha256，防传输损坏 / 手改 |

`manifest.json` 与 `project.json` 用 deflate（`level: 6`）；`assets/` `fonts/` 里的二进制用
`level: 0`（存储不压缩）—— 图片、视频、woff2 本身已经压过，再 deflate 只烧 CPU 不省体积。

---

## 4. project.json

就是 `PersistProject` 的序列化结果，字段与 `src/core/types.ts#Project` 一一对应：

```json
{
  "schemaVersion": 2,
  "id": "prj_t7bmbju39me",
  "name": "BUNDLE-SRC",
  "width": 1080,
  "height": 1080,
  "duration": 4000,
  "fps": 30,
  "loop": true,
  "layers": [ /* layers[0] 恒为 background */ ],
  "assets": [ { "id": "as_t7e1ei61z9c", "name": "dot.png", "mime": "image/png", "width": 64, "height": 64, "bytes": 926 } ],
  "fonts": [ { "family": "Source Han Sans", "weight": 700, "style": "normal", "source": "upload" } ],
  "version": 12,
  "createdAt": 1761363000000,
  "updatedAt": 1761363130000
}
```

**包里不含 base64**：图层引用的 `assetId` 与 `assets[].id` 对齐，真正的字节在同名文件里。
所以 `project.json` 通常只有几十 KB —— 可以直接 `git diff` 看出版式改动。

---

## 5. 导出（`project.exportBundle`）

```ts
// 命令总线里执行
await dispatch('project.exportBundle', {});                     // 导出当前工程
await dispatch('project.exportBundle', { projectId: 'prj_…' }); // 导出任意一个本机工程
```

返回：

```json
{
  "filename": "Kinelayer-·-示例海报-20261025-135307.kly",
  "bytes": 1620,
  "formatVersion": 2,
  "assets": 1,
  "fonts": 0,
  "missingAssets": []
}
```

- 文件名规则：`安全化(工程名)-YYYYMMDD-HHMMSS.kly`（`buildFilename`，与 PNG/WebM 同一套）。
- **只读命令**：`mutating: false`，不进撤销栈，不在 dryRun 下产生副作用。
- `missingAssets` 是「工程里登记了、但 IndexedDB 里已经找不到」的资源名。
  遇到这种工程包**照样能导出**，只是那些图层会空着 —— 与其整个导出失败，不如让用户知道缺了什么。
- UI 入口：`Ctrl/Cmd + S`、启动页卡片操作条、设置 → 数据 → 导出工程包。

---

## 6. 导入（`project.importBundle`）

```
选文件 → File 读成字节放进暂存区 → 命令只拿 stageId
       → 解压闸门 → 校验清单 → 校验 sha256
       → 资源写 IndexedDB → 字体注册 → 预加载渲染缓存
       → 新建工程记录（换新 id）→ 打开 → 关掉启动页
```

**为什么绕一道暂存区**：命令 payload 是 JSON，几十 MB 的二进制不能塞进去。
`services.stageBundle(file)` 把字节放进程内 `Map`（5 分钟 TTL、取一次即删），
命令参数里只有 `{ stageId: "st_xxx" }` —— 总线、审计日志、AI 工具调用都不会被大文件拖爆。

### 导入不改写旧工程

导入时会 `normalizeProject({ ...parsed.project, id: uid('prj') })` —— **换一个新 id**。
理由：导入的语义是「新增一份」，同名工程应该并存，而不是被悄悄覆盖。
包里同一份 `assetId` 被多个工程引用时只写一次库。

### 字体缺失不致命

`parseBundle` 里字体文件缺失是 `continue` 而不是 `throw`：字体没了渲染层会自己 fallback 到系统字体，
文字还能看见；而**资源文件缺失是硬错**（图片没了就是一张空图层，用户会以为导入坏了）。

### 旧备份照旧能开

`looksLikeZip()` 只看前两个字节是不是 `PK`：

- `PK\x03` / `PK\x05` → 走 `project.importBundle`
- 其它 → 走 `project.load`（v1 JSON 外壳、更早的裸 `Project` JSON 都在这条路上）

所以改名、换格式这两次动静都没有让老备份变成废纸。

---

## 7. 敌意输入的闸门

读包的人必须假设包是敌意的。`guardedUnzip` 用 fflate 的 `filter` 钩子 ——
它在**真正 inflate 某个条目之前**就能看到 `size`（压缩后）与 `originalSize`（解压后），
五道闸门全部前置，不会出现「先解了 4GB 再发现不对劲」：

| # | 闸门 | 阈值 | 拒绝理由 |
| - | --- | --- | --- |
| 1 | 条目数 | 400 | 十万个小文件的条目爆炸 |
| 2 | 单文件解压后 | 64 MB | 一个条目就吃满内存 |
| 3 | 全部解压后总计 | 384 MB | 多个大条目叠加 |
| 4 | 单文件压缩比 | 200:1（仅 >1MB 的条目） | ZIP 炸弹：4MB 全零压成 4KB |
| 5 | 路径安全 | 无 `..`、无绝对路径、无盘符、长度 ≤240 | 路径穿越写出工程目录 |

任一条触发就抛 `BundleError`，**已解出的部分一并丢弃**，不返回半成品。阈值都在
`BUNDLE_LIMITS` 里，要调就改一处。

另外还有两道：

- `manifest.json` 自身 ≤ 1MB（防止清单本身就是攻击载荷）；
- 整个 `.kly` ≤ 384MB（解压前先看文件大小，太离谱连 ZIP 头都不解析）。

---

## 8. 错误码

`BundleError.code` 会被 `project.importBundle` 转成 `CommandFailure('VALIDATION', …)`：

| code | 含义 | 用户看到的话 |
| --- | --- | --- |
| `FORMAT` | 不是 ZIP / 不是合法 JSON / `format` 不匹配 | 不是有效的 ZIP 工程包（或文件已损坏） |
| `VERSION` | `formatVersion` 比编辑器新 | 工程包版本 N 比当前编辑器（2）新，请先升级 Kinelayer |
| `CHECKSUM` | `project.json` 或某个资源 sha256 不符 | 校验失败（文件被改过或传输损坏） |
| `LIMIT` | 命中上面任一阈值 | 条目过多 / 单文件过大 / 压缩比异常（疑似 ZIP 炸弹）… |
| `ENTRY` | 路径不安全 | 工程包里有非法路径：`../evil.txt` |
| `MISSING` | 缺 `manifest.json` / `project.json` / 某个 `assets/` 文件 | 工程包缺少资源文件：`assets/as_xxx.png` |

前端拿到的是 `{ ok: false, error: { code: 'VALIDATION', message, details: { code: 'LIMIT' } } }`，
面板据此提示；不会把 fflate 的堆栈丢给用户。

---

## 9. 兼容性与演进

- **向前兼容**：`formatVersion` 只增不改语义。v1 的 JSON 外壳（`formatVersion: 1`）仍然被
  `project.load` 接受 —— 这也是 §6 那条分支存在的意义。
- **加字段**：往 `manifest` 里加可选字段是安全的（`parseManifest` 只校验必需项）。
- **改结构**：改 `project.json` 的形状要同时抬 `PROJECT_SCHEMA_VERSION`，并在
  `normalizeProject` 里写迁移；包格式版本（`formatVersion`）只在**容器**层面变化时才抬
  （比如换压缩算法、换清单字段名）。
- **未来要加的东西**（骨架已留）：`.kly` 里的 `preview.png`（工程缩略图）、
  `plugins/`（代码层用到的第三方脚本）。都不影响现在的解析器 —— 未知条目会被忽略。

---

## 10. 自己造一个包（给脚本 / Agent 用）

```js
import { zipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';

const project = { /* …一份合法 Project… */ };
const projectBytes = strToU8(JSON.stringify(project));
const sha = (b) => createHash('sha256').update(Buffer.from(b)).digest('hex');

const manifest = {
  format: 'kinelayer-bundle',
  formatVersion: 2,
  app: 'Kinelayer 0.1.0',
  exportedAt: Date.now(),
  schemaVersion: project.schemaVersion ?? 2,
  project: { id: project.id, name: project.name, width: project.width, height: project.height,
             duration: project.duration, fps: project.fps, layerCount: project.layers.length },
  assets: [],
  fonts: [],
  checksum: { algo: 'sha256', project: sha(projectBytes) },
};

const bytes = zipSync({
  'project.json': [projectBytes, { level: 6 }],
  'manifest.json': [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }],
}, { mtime: manifest.exportedAt });
```

把它写成 `.kly` 丢进启动页，或者 `stageBundle` + `dispatch('project.importBundle', { stageId })`
都能进来。**没有素材的最小工程包不到 2KB** —— 适合当测试夹具或 Agent 的模板。
