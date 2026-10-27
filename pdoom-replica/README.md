# one more pass — pdoom-video 复刻

对 [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video) 播放器应用的复刻。
**代码与机制 1:1；受版权的素材（歌、词、图像、叙事文本）一个字节都没搬**，全部换成自产占位物并留好替换槽位。

```
pdoom-replica/
├─ index.html          页面结构：原版 index.html 逐字移植（#wrap/#c/#ui/#marks/#scrub/#info/#errs + export 模式）
├─ css/style.css       原版内联样式逐字移植 + 引导提示层
├─ js/
│  ├─ palette.js       palette.ts 逐字移植：9 色是全片视觉宪法
│  ├─ data.js          data/*.json 的替代：原创词 + 词级时间 + 速度网格（132.007 BPM / 4/4）
│  ├─ lyrics.js        lyrics.ts + audio.ts 移植：get/wordProgress/lineCharProgress/beatAt/env/hit
│  ├─ audio.js         声音替代：现场合成的原创配乐（WebAudio），对外是 <audio> 形状的时钟
│  ├─ type.js          type.ts 移植：三声部字体 + measure/glyphX/fitSize/smart
│  ├─ engine.js        engine.ts + post.ts + scene.ts 移植：纯函数帧 / post 管线 / 自适应采样
│  ├─ timeline.js      timeline.ts 逐字移植：cut() 切在首词之前的下拍上（绝不之后）
│  ├─ scenes.js        scenes/*.ts 的语法移植：17 个 id 全实现，画面是原创习作
│  └─ main.js          main.ts 移植：播放器（全部按键）/ ?export=1 / ?t= / ?scale= / ?only=
└─ README.md
```

## 运行

```sh
cd pdoom-replica
python -m http.server 5299      # 或 npx serve
# 打开 http://127.0.0.1:5299/
```

按键（与原版一致）：`空格` 播放/暂停 · `←→` ±1s（shift ±5s）· `，。` 逐帧 ·
`[` `]` 上一段/下一段 · `L` 循环本段 · `H` 收起界面 · 点画布 = 播放/暂停 · 点章节标记 = 跳转。
URL：`?t=23` 从 23s 起 · `?scale=2` 2× 渲染 · `?export=1` 导出模式（挂 `window.__pdoom`）· `?only=hook` 只装载部分场景。

## 一、原项目的组成与关键特性

| 组成 | 内容 | 授权 |
| --- | --- | --- |
| `app/` | TS + three.js 渲染器：engine（35.9KB）/ post / type / stroke / hud / gl / 17 个场景模块（最大 75KB） | **MIT ✅** |
| `app/index.html` | 播放器页面：画布 + 底部 scrub/章节标记/info 条 + export 模式 | **MIT ✅** |
| `app/scripts/render.ts` | 离线渲染：无头 Chrome → WebSocket rgb24 → ffmpeg | **MIT ✅** |
| `analysis/` | Python 工具链：Demucs 分离 + Whisper/CTC 强制对齐 → data/*.json | **MIT ✅**（本复刻不需要） |
| `audio/pdoom.mp3` | 歌（Suno 生成，他人作品） | **❌ 不在 MIT 内** |
| `lyrics/` + 词级时间 | 词：osmarks 等人 | **❌ 不在 MIT 内** |
| `docs/TREATMENT.md` | 概念/风格圣经/分镜 | **❌ 稳妥起见不搬** |
| `public/fonts/` | Archivo（可变宽度轴）/ IBM Plex Mono / Cormorant Garamond / Hershey·EMS 描边体 | OFL ✅（未随仓库分发，见下） |
| `public/plates/` | fig01–fig14 扫描图 | 来源不明 → **❌ 不搬** |

**关键特性**（复刻的验收标准）：

1. **每帧是时间的纯函数** —— 预览与导出逐帧一致；禁 `Math.random`/`Date.now`，噪声全部种子化；
2. **词级卡拉 OK** —— 高亮绝不领先声音，`wordProgress`/`lineCharProgress` 驱动逐字擦亮；
3. **切点全部落在下拍** —— `cut()` 取首词之前（绝不之后）的最后一个拍点，`after()` 取最近下拍；
4. **后处理链** —— bloom → halation → CA → grain → vignette → HUD，在运动模糊平均**之后**，每帧只画一次；
5. **自适应子帧采样** —— 档位 4/12/36/108/324，瓦片收敛，`--shutter 0.2` = 帧时的 1/5；
6. **scene 返回 post 覆写** —— 场景自己决定 bloom/flash/shake/pdoom 读数；
7. **剪辑结构** —— 22 个窗口 17 种场景，prompt ×3 变体、hook ×4 递增计数。

## 二、复刻范围与优先级

| 优先级 | 项 | 状态 |
| --- | --- | --- |
| P0 | 页面结构 / 布局 / 配色 / 交互（全部按键、scrub、章节标记、info 行、`?t/?scale/?export`） | ✅ 逐字移植 |
| P0 | 引擎语义：纯函数帧、Frame（beat/bar/包络）、post 管线、post 覆写 | ✅ 移植 |
| P0 | 时间轴机制：cut()/after()、22 窗口、变体与计数参数 | ✅ 移植 |
| P1 | 卡拉 OK 逐字高亮、P(doom) 读数、裁切标记 HUD、火花母题 | ✅ 移植 |
| P1 | 17 个场景 | ✅ 全部实现；**画面为原创习作**（语法一致、内容不搬） |
| P2 | 自适应采样 | ⚠️ 降级：档位保留，瓦片跳过绘制不可复刻（canvas2d 无 scissor；整帧统一计数，上限由 `maxSamples` 封顶） |
| P2 | 描边单笔画字体（Hershey/EMS）与手写同步 | ❌ 未复刻（需要 8 个 SVG 字形源；留槽位） |
| P2 | 离线渲染 | ⚠️ 简化：`?export=1` 提供 `still()`/`frames()`（PNG），未做 WebSocket rgb24 流 + 编码器确认背压（那条管线的价值在 4K 长片，本复刻没有） |
| P2 | 分析工具链（Demucs/Whisper/CTC） | ❌ 不需要 —— 词时间直接按权重生成 |

## 三、技术栈与资源：依赖与替代

| 原项目依赖 | 本复刻 | 说明 |
| --- | --- | --- |
| three.js + WebGL（HalfFloat HDR 管线） | **零依赖 Canvas2D** | 17 个场景里只有少数真的需要 GPU（shoggoth/room 的逐像素场）。2D 近似换来「双击就能跑」，代价记在下面 |
| bun + Vite | 无构建 | 经典 `<script>` 按序加载，`file://` 也能开 |
| opentype.js（字形轮廓/逐字形定位） | Canvas `measureText` | 它自带 kerning，`glyphX` 语义等价 |
| `audio/pdoom.mp3` | **现场合成**（WebAudio：Am–F–C–G 铺底 + 四踩/军鼓/镲 + 段落提示音） | 放入 `audio/pdoom.mp3` 自动优先播放真歌 |
| `data/lyrics.json`（Whisper 对齐） | 原创词 + 字符权重切分词时间 | 同一数据形状，`lyrics.get()` 原样工作 |
| `data/audio.json`（节拍/下拍/段落/包络） | 由确定性鼓排程解析生成 | `env()`/`hit()` 不需要 FFT，因此导出子帧仍是纯函数 |
| Archivo（宽度轴 62–125）/ IBM Plex Mono / Cormorant | 系统字体栈回退 | 把 OFL 字体放进 `fonts/` 并取消 index.html 里的 @font-face 注释即升级；宽度轴映射为 CSS 关键字（`semi-expanded` 等） |
| `public/plates/` fig01–14 | 程序化绘制 | 无扫描图依赖 |
| Hershey/EMS 描边 SVG ×8 | 未复刻 | OFL/公有领域，可下载后扩展 `type.js` |

**一个真踩过的坑（写下来防止再犯）**：canvas 的 `ctx.font` 简写**不接受 font-stretch 百分比** ——
`'900 112% 190px Archivo'` 整条赋值被静默丢弃，字体退回 10px 默认值，画面全部塌掉。
百分比必须映射成关键字（`ultra-condensed … expanded`），这就是 `type.js` 里 `stretchOf()` 的由来。

## 四、版权边界（务必遵守）

- `js/` 与 `css/` 是**对 MIT 代码的移植**，文件头注明出处；
- 歌词是**自写原创**（虽然形态模仿：钩子句 ×4 递增），不是原词的改写；
- 配乐是**现场合成的原创和声进行**，不是原曲；
- 场景画面是**同一视觉语言下的原创习作**，不是原片分镜的临摹；
- 原项目的名字、歌名、歌词文本、扫描图、TREATMENT 文本一律未使用。
