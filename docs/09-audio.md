# 音频层：时间轴上能听见的声音

v2.9 之前，Kinelayer 是**无声**的：工程里除了图片、视频、代码，没有第四种「随时间变化的东西」。
导览片需要配乐，于是有了音频层（`type: 'audio'`）。

这一篇讲三件事：为什么是合成而不是音频文件、排程怎么和主时钟对齐、导出怎么把声音录进 WebM。

---

## 一、为什么是「算出来的」声音

工程里已经有资源池（`AssetMeta`：image / video / font），加一个 `audio` 类别是最直觉的做法。
没这么做，原因有三条：

| 方案 | 代价 |
| --- | --- |
| 传一个 mp3 进去 | 示例工程要求零外部资源（见 08-first-run.md）；`.kly` 工程包会从几十 KB 涨到几 MB |
| 内置一段音频二进制 | 同上，而且许可与体积都要长期维护 |
| **参数化合成** | 工程包里只有几十字节的 `tone` 描述；同一份工程在任何机器上听到的完全一样 |

所以音频层长这样：

```ts
export interface AudioLayer extends BaseLayer {
  type: 'audio';
  volume: number;     // 0..1，和 opacity 分开：opacity 对声音没有意义
  muted: boolean;
  fadeIn: number;     // ms
  fadeOut: number;
  tone: ToneSpec;     // 程序化音源
}

export interface ToneSpec {
  preset: 'pad' | 'pulse' | 'chime';
  root: number;       // 基频 Hz
  bpm: number;        // 拍子网格
  chord: number[];    // 半音偏移：pad 叠和弦，chime 走琶音
  marks: number[];    // chime 的触发点（相对图层起点 ms）
}
```

三种预设覆盖了导览片需要的全部声音：

- **pad**：每个和弦音两只略微失谐的三角波 → 低通 → 慢 LFO 做呼吸。当铺底。
- **pulse**：正弦从 128Hz 扫到 46Hz 的「咚」+ 白噪声过高通的踩镲。当节拍。
- **chime**：带两点泛音的正弦，1.1 秒衰减。落在章节切点上当提示音。

`chime` 的 `marks` 是**相对图层起点**的毫秒数组，所以「第 32 秒响一声」这种要求，
改的是图层里一个数字，而不是去挪另一个图层的关键帧。

---

## 二、排程：和主时钟同一根时间轴

最省事的做法是 `setInterval(() => playNextNote(), 500)`。它会坏在三个地方：

1. **定时器不准**。`setInterval` 的抖动在几十毫秒量级，节拍会越走越飘。
2. **后台标签页被降频**。Chrome 会把后台页面的定时器压到 1 秒一次，200ms 的 tick 直接断音。
3. **两套时钟**。rAF 的 `playhead` 与 `AudioContext.currentTime` 各走各的，两分钟能差出几百毫秒。

解法分三层。

### 1. 锚点：只记一次映射

启动时记 `(anchorCtx, fromMs)`，之后所有事件时间都由它算：

```ts
const toCtx = (ms) => s.anchorCtx + (ms - s.fromMs) / 1000;
```

播放速率恒为 1，所以唯一的偏差来源是**用户 seek** 与**循环回绕**。主时钟每帧比一次：

```ts
const drift = session.fromMs + (ctx.currentTime - session.anchorCtx) * 1000 - playhead;
if (Math.abs(drift) > 400) startProjectAudio(project, playhead);  // 重锚
```

超过 400ms 就整段重来，不去微调 —— 微调会让正在响的音符变调。

### 2. lookahead：往前补，不等当下

每 200ms 醒一次，把未来 1.2 秒内的事件**提前排进 WebAudio**：

```ts
const horizon = realNowMs + LOOKAHEAD * 1000;   // 1.2s
if (horizon <= s.cursorMs) return;
scheduleRange(g, host, s, s.cursorMs, horizon);
s.cursorMs = horizon;
```

排进去的事件由 WebAudio 自己按采样点触发，JS 卡一下也不影响已经排好的部分。

### 3. tick 走 Worker

窗口定时器会被后台节流，Worker 不会。这个做法直接借自 **Tone.js** 的
[`Tone/core/clock/Ticker.ts`](https://github.com/Tonejs/Tone.js/blob/dev/Tone/core/clock/Ticker.ts)：
用 Blob 造一个只做 `postMessage` 的 Worker 当时钟，不可用时退回 `setInterval`。

```ts
const source = `let id=null;self.onmessage=function(e){if(id)clearInterval(id);id=setInterval(function(){self.postMessage(1)},e.data)};`;
const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
```

顺带说一下 Tone 的 `Clock` 注释里那句「callback 不是采样级准确的，但传给 callback 的时间是」——
本引擎的对应做法就是：tick 只负责「排」，时间永远由锚点算。

---

## 三、导出：离线渲染，实时播放

导出是「`captureStream(0)` + 逐帧 `requestFrame`」，整个过程是**实时**跑的
（每帧等 `1000/fps` 毫秒，否则 MediaRecorder 的帧时间戳会乱）。

如果这时候还让音频走实时排程，主线程每帧都在渲染，一次卡顿就漏拍。
所以导出换一条路：

```ts
const buffer = await renderOfflineAudio(project);   // OfflineAudioContext
const src = ctx.createBufferSource();
src.buffer = buffer;
src.connect(captureDest);                           // MediaStreamAudioDestinationNode
src.start(ctx.currentTime);
stream.addTrack(captureDest.stream.getAudioTracks()[0]);
```

思路来自 Tone.js 的 [`Tone.Offline`](https://github.com/Tonejs/Tone.js)：离线上下文比实时快得多，
结果是**确定的**，同一份工程导多少次都一样。

留了一条后路：浏览器不支持 `OfflineAudioContext`、或者渲染失败时，导出继续，只是没有声音 ——
不该因为音频让整个导出失败。

---

## 四、波形：让音频层在时间轴上「看得见」

音频层没有画面，在时间轴上只有一条空白块会显得像没做完。所以画波形：

```
离线渲染（8kHz 单声道） → 按桶取绝对值最大值 → 归一化 → SVG 竖线
```

与 **wavesurfer.js** 的 peaks 是同一套思路（[`katspaugh/wavesurfer.js`](https://github.com/katspaugh/wavesurfer.js)），
只是这里不需要播放器，只要一段包络。

两个细节：

- **用 SVG 不用 canvas**。clip 宽度随缩放变化，canvas 要自己处理 `ResizeObserver` 与
  `devicePixelRatio`；SVG 给个 `viewBox="0 0 100 1"` + `preserveAspectRatio="none"` 就自动拉伸。
- **只画一次，按 version 缓存**。96 秒的工程压到 8kHz 也就 768k 个采样点，但没必要每次改图层都重算。

---

## 五、UI 上多了什么

| 位置 | 变化 |
| --- | --- |
| 图层树 | 音频层有 `Music` 图标；「添加图层」菜单多一项「音频层」 |
| 时间轴 | 音频块是绿色，块内画波形；行首圆点也是绿色 |
| 属性面板 | 「音频」区块：音源预设 / 音量 / 静音 / 淡入淡出 / 基频 / BPM + **试听**按钮 |
| 引导条 | 「96 秒 · 58 层 · 70 条关键帧轨道 · 7 个代码层 · 3 条音轨」 |
| 命令 | `layer.create { type: 'audio' }`、`audio.set { id, volume, muted, fadeIn, fadeOut, tone }` |

`audio.set` 单独开了一条命令，没有并进 `layer.update`：那个 patch 是所有图层通用的，
一旦把 `volume / tone` 塞进去，文本层也能被写入一份音源参数，数据层就会出现
「有音源的文本框」这种解释不了的状态。

音频层也没有 `assetId` 字段。**没有能力就别留字段** —— 留一个永远为 null 的字段，
下一个人会以为「音频文件应该从这里进」，然后花半天找为什么没用。

---

## 六、故意的边界

- **不支持上传音频文件**。这需要资源池加 `audio` 类别、解码、波形、内存管理一整套，
  是另一件事。真要接，`scheduleRange` 里加一个「解码 AudioBuffer 后从 inPoint 播放」的分支即可，
  主时钟 / 导出 / 波形三条链路一行都不用改。
- **不做音量自动化（关键帧）**。音频层的属性不在 `ANIMATABLE_PROPERTIES` 里 ——
  那套属性是「每帧算一个数」的渲染属性，音频增益要挂到 `GainNode` 上，是另一条求值路径。
  现在用淡入淡出覆盖 80% 的需求，剩下的先不做。
- **不做响度标准化**。三轨之间的电平是手调的（0.34 / 0.16 / 0.20），没有走 LUFS。

---

## 七、自检

`scripts/audio-check.mjs`，30 项，八块：

| 区块 | 验什么 |
| --- | --- |
| 建模 | `layer.create` 能建音频层、参数落位、默认铺满全片、不占画面（1×1） |
| 命令 | `audio.set` 改得动；拿背景层调它会被 `INVARIANT` 拦住 |
| 声音 | 离线渲染 peak/rms 非零、时长对齐、静音后 peak≈0、取消静音后回来 |
| 排程 | `inPoint` 前不响、区间内响、`outPoint` 后不响 |
| 时钟 | 未播放时引擎是停的；播放后 `running=true` 且 ctx 是 `running`；暂停即停；seek 后仍在响 |
| 波形 | 峰值按桶返回、不是一条直线、时间轴上真有 `audio-wave` |
| 面板 | 选中音频层有「试听」，点了能把上下文唤起来 |
| 导出 | `createAudioCapture` 返回的 stream 里有一条音轨；删掉音频层波形跟着消失 |

跑法：

```bash
npm run dev                     # 另开一个终端，5273 端口
node scripts/audio-check.mjs
```

这一套全靠「读数」而不是「听」：`__kly.audio.measure()` 内部走 `OfflineAudioContext`，
返回 `{ ms, peak, rms, channels }`。peak 为 0 就是静音，rms 太低说明只有零星采样点被触发 ——
这两种问题在耳朵上是「好像没声」和「好像有点声」，在数字上是明确的。
