# 15 · 交付：出片区间、标记点、字幕与剪辑表

一支片子做完了要交出去，交的不只是视频。这一轮补的是**「这段里挑一段，给它配上字幕和时间轴本身」**。

对标的是 `openfilm`（[GitHub](https://github.com/openfilm/openfilm)，MIT，3.3k★）。它的 README 里写了
`openfilm render [a-b]` 与「导出视频、GIF、声音或分轨、字幕、静帧、幻灯片、透明视频，或者时间轴本身给
FCP / Premiere / DaVinci」。这几项里，Kinelayer 在此之前只有「视频 + 静帧 + JSON」。

---

## 1. 出片区间（`Project.range`）

```ts
export interface TimeRange { in: number; out: number; }
// Project.range?: TimeRange | null
```

**为什么它是工程数据，不是界面状态。** 「这段片子要出哪一段」是这支片子的一部分 ——
换台机器打开、隔一周再来、AI 接手改，这个选择都还在。放进 `ui` 会变成「关掉标签页就没了」，
而它恰恰是导出时最要紧的那个参数。

三条硬约束，读入（`normalizeRange`）、命令层（`timeline.setRange`）、不变量检查
（`enforceInvariants`）三处都按同一口径执行：

| 约束 | 处理 |
| --- | --- |
| `0 ≤ in < out ≤ duration` | 越界的 `out` 夹到 `duration`（片长被裁短过，这是有意义的修复） |
| `out - in ≥ 40ms`（`MIN_RANGE_MS`） | 不足就**整块丢掉**（`null`），退回整片导出 |
| `in ≥ duration`（片长砍到装不下） | 同上，整块丢掉 |

不「修成看起来合理的值」是刻意的：半个坏区间比没有区间更容易让人以为导出坏了。
区间被丢掉时，导出入口会重新显示「整条时间轴」，用户看到的是事实，不是猜测。

**命令（9 条，全在「时间轴」分类）**

| 命令 | 语义 |
| --- | --- |
| `timeline.setRange` | 显式给两侧。`out` 早于 `in` 直接 `VALIDATION`，不悄悄改 |
| `timeline.clearRange` | 撤回整片导出 |
| `timeline.markIn` / `timeline.markOut` | I / O 两个键。只动一侧；越过对面时把对面推开（而不是报错） |
| `timeline.addMarker` / `moveMarker` / `updateMarker` / `removeMarker` / `clearMarkers` | 标记点 |

`setRange` / `markIn` / `markOut` / `moveMarker` 带 `coalesce`：拖把手那一下会连发几十条命令，
撤销栈里只该留一个点。

**区间也是播放窗口。** 有区间时播到出点会停住，开循环则在区间内绕回；`timeline.play`
在播放头落在区间外时从入点开始。理由：区间是「这次要出哪一段」的权威，预览它才有意义。
播放条上挂一个小标解释这件事（`playbar-range`），否则用户只会觉得「播到一半自己停了」。

---

## 2. 标记点（`Project.markers`）

```ts
export interface Marker { id: string; time: number; label: string; kind: 'beat' | 'note' | 'cut'; }
```

不参与渲染，只服务「对齐」：卡拍、标待改、记切点。`kind` 只影响颜色与文案。
规范化时越界的夹回片内、脏数据丢掉、id 去重、按时间排序、上限 400。

界面上钉在标尺上沿：点一下跳过去，右键删掉。

---

## 3. 字幕（SRT / WebVTT）

`src/core/subtitles.ts` 是纯函数层，四个出口：

```
歌词(LyricLine[]) ──cuesFromLyrics──> Cue[] ──clipCues──> Cue[] ──formatSrt/Vtt──> 文本
                                        ↑
                                   出片区间（并归零）
```

**为什么要「归零」。** 导出的视频从 0 开始；字幕若还按工程时间写，播放器里整条错位 ——
而且错得很像「字幕生成错了」，不是一眼能看出的那种。`clipCues` 同时做裁切与平移，
两件事必须一起做，分开做就会有一边忘了。

**两种粒度。** `line` 一行一条；`unit` 用工程里的逐字时间（`lyricUnits`，按字符权重切），
一个单元一条 —— 短视频平台要的正是后者。纯标点单元被跳过：一闪而过的顿号不是字幕。

**解析是宽松的**：BOM、CRLF、序号行可有可无、cue 设置（`align:start`）忽略、
VTT 的 `<c>`/`<b>` 剥掉、`NOTE`/`STYLE`/`REGION` 块跳过。
唯一不做的事是「猜时间」：认不出时间码的块直接丢掉，不按平均长度补。

---

## 4. 剪辑表（CMX 3600 EDL）

**为什么是 EDL 而不是 FCPXML。** 这工程里没有「源素材 + 素材库」的概念：图层是
「在某个时间点上画一个东西」，视频只有 `trimIn`，音频可能压根没有文件（程序化音源、
人声合成都是算出来的）。FCPXML 要把每个素材登记成 resource 并给出真实路径 ——
这里没有路径可给，写出来的文件导入剪映后全是离线素材，比没有更糟。

EDL 的语义正好匹配：「这一段录机时间用 A 号卷的这几秒」。

```
001  AX       V     C        00:00:00:00 00:00:02:00 00:00:00:00 00:00:02:00
* FROM CLIP NAME: plate.png
* KINELAYER LAYER: 底板
```

- 只认三种层：视频（V）、音频（A）、图片（V，静帧）。其它（文本 / 代码 / 背景 /
  程序化音源 / 人声）**不进表**，在文件头注释里逐条列明原因。
- 卷号统一 `AX`（auxiliary）：没有真实卷号，编一个假的只会让人去找不存在的磁带。
- CMX 只支持整数帧率。29.97 / 59.94 降级到 29 / 59，并在注释里写一行说明。
- 录机时间从 0 起（与导出的画面文件对齐），源时间含 `trimIn` 与区间偏移。
- `playbackRate ≠ 1` 表达不了，写成注释提醒「成片需另做 retime」。

---

## 5. 丢帧：时长对，画面可以少

`export.webm` 走 `captureStream(0)` + `requestFrame()` 手动推帧。`MediaRecorder` 的帧时间戳
取的是 `requestFrame()` 的**墙钟时刻**，不是「第 i 帧应在 i/fps 秒」。

**旧实现是错的**：推完一帧 `sleep(一帧时长)`。一旦某帧渲染超过一帧时长，后面每一帧都往后
顺延 —— 误差累积，一段 30 秒的片子能导出成 35 秒（画面变慢，像慢放）。

现在的做法是**对齐绝对时间格**：

```
slot = anchor + i * frameDelay
now < slot  → 等到 slot
now - slot ≥ frameDelay → 跳过 ⌊(now-slot)/frameDelay⌋ 个内容帧（记入 dropped）
```

代价是渲染跟不上时会丢帧，换来的是「成片时长永远对得上」。这也是所有录屏 / 实时导出
工具的取舍：**丢帧可以补渲，时长错了得重导**。跳了多少写在导出完成的提示里
（`已导出 xxx（300 帧，渲染跟不上跳过 12 帧）`）。

音频同段：`createAudioCapture(project, range)` 只离线渲染区间那一段，而不是整条渲染完
再寻址到起点播放 —— 后者看着也行，但 `MediaRecorder` 从 `src.start()` 开始计时，
中间任何一次解码抖动都会把音画错开；区间是 40 秒里的 3 秒时，白渲染那 37 秒也是纯等待。

---

## 6. 明确不做的

| 没做 | 为什么 |
| --- | --- |
| MP4 | 需要 WebCodecs `VideoEncoder` + 一个 muxer（`mp4-muxer` 之类）。与 `MediaRecorder` 是两套实现，收益是「能直接发微信」。要做就整条换掉，不能两条并存 —— 那是两套 bug |
| GIF | 需要调色板量化 + LZW。技术上可行（浏览器能解码即验证），但这一轮优先保证「字幕 / 区间 / 剪辑表」这条交付链完整 |
| FCPXML / 剪映草稿 | 见上：没有素材库，写出来是假信息 |
| 真逐字对齐（ASR） | 工程里的逐字时间是**按字符权重切**出来的，不是听出来的。字幕用它是够的，做卡拉 OK 评分不够 |
| 曲线编辑器 / 色轮 LUT / 图层组遮罩 | 工程量远超本轮，且 Kinelayer 的定位是「可编程海报」不是完整 NLE |

---

## 7. 验收

`scripts/export-check.mjs`（63 条）：

- 区间：越界拒绝、夹边界、片长缩短丢掉区间、撤销链；
- 标记点：排序、夹边界、移动、改文案、删不存在报 `NOT_FOUND`；
- 字幕：两种粒度、往返一致（写出去再读回来时间不变）、区间裁剪后归零、VTT 内联标签与 cue 设置、垃圾文本不猜；
- 剪辑表：跳过分支、`FROM CLIP NAME`、录机时长等于区间长度、时间码列格式；
- 区间音频长度 ≈ 区间时长；
- 界面：标尺在内容层里、蓝条与把手、压暗两块、标记点能加能右键删、I/O/M/J/K/L 真的改了状态、
  区间是播放窗口（停住 / 绕回）、导出对话框里四个出口都在。

```bash
node scripts/export-check.mjs
```
