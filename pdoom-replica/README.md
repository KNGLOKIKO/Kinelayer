# 我在加我的图层数 — pdoom-video 复刻

对 [mexicat/pdoom-video](https://github.com/mexicat/pdoom-video) 播放器应用的复刻。
**代码与机制 1:1；受版权的素材（歌、词、图像、叙事文本）一个字节都没搬**——
但**结构与分镜逐块对位**：46 行词的行槽位、22 个剪辑窗口、17 块分镜的视觉乐器与运动节拍，
全部照原片骨架重建，只把**叙事对象换成 MotionLayer**（图层 / 命令 / 关键帧 / 导出）。

```
pdoom-replica/
├─ index.html          页面结构：原版 index.html 逐字移植（#wrap/#c/#ui/#marks/#scrub/#info/#errs + export 模式）
├─ css/style.css       原版内联样式逐字移植 + 引导提示层
├─ js/
│  ├─ palette.js       palette.ts 逐字移植：9 色是全片视觉宪法
│  ├─ data.js          data/*.json 的替代：46 行中文词（行槽位对位原曲骨架：132.007 BPM /
│  │                   4/4 / 156.651s / 14 段落）+ 词级（字符级）时间 + 段落感知鼓排程
│  ├─ lyrics.js        lyrics.ts + audio.ts 移植：get/wordProgress/lineCharProgress/beatAt/env/hit
│  ├─ audio.js         声音替代：现场合成的原创配乐（WebAudio，Am–F–C–G，按段落编曲），
│  │                   对外是 <audio> 形状的时钟
│  ├─ type.js          type.ts 移植：三声部字体 + measure/glyphX/fitSize/smart
│  ├─ engine.js        engine.ts + post.ts + scene.ts 移植：纯函数帧 / post 管线 / 自适应采样 /
│  │                   图层数 HUD（原片 P(doom) 位）+ 书挡裁切标记（revision 4 语义）
│  ├─ timeline.js      timeline.ts 逐字移植：cut() 切在首词之前的下拍上（绝不之后），22 窗口
│  ├─ scenes.js        scenes/*.ts 按 TREATMENT 逐块对位：同一视觉乐器、同一运动节拍，内容换 MotionLayer
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

## 一、结构对位（本复刻与原片的逐块映射）

递增主母题：原片 **P(doom) 0.02→0.15→0.42→0.81→0.99→NaN→∞** ←→ 本片**图层数 3→15→64→999→4096→∞→0/0→NaN**。
14 段落 / 46 行 / 22 窗口 / hook ×4 / prompt ×3 全部同构。

| 原片 plate | 原片内容 | 本片对位 |
| --- | --- | --- |
| `open` | TikZ 图纸，绘图仪笔画独角兽，射入 "AGI" | 图层清单图纸，笔画第一张海报（画布框/圆/关键帧轨道），射入「层动」；意外度读数滚到 0.00 |
| `loss` | 训练 loss 骤降，栽进等高线峡谷，servant/boss 世界滚 180° | 帧耗时曲线 **43ms→13ms** 的那一次优化，等高线峡谷，「乙方巨大/老板很小」+ 滚 180° |
| `prompt` ×3 | 对 ChatGPT/Sydney/Gato 的恳求，token 输入 + next-token 分布 | 对**画布/撤销/导出**的三句恳求；变体 `canvas`（同心圆环收拢）/ `undo`（竖栏收拢+回信+不安微笑）/ `export`（字距漂散） |
| `hook` ×4 | "I'M UPPING MY P(DOOM)" 大字 slam，数字满屏滚 | 「我/在加/我的/图层数」四 token slam，「在加」真的上升，「图层数」×2ⁿ 数学式 + HUD 数字离场滚到 15/64/999/4096；四档递进（净版/橙底/hairline 瘆人/频闪叠影） |
| `room` | FOOM 指数分支爆炸，中文房间书架走廊，shrooms | 「指数爆炸」分支爆炸 + 冲击波环；主窗口图层库走廊（每拍切机位）+「未保存」卡片；糖袋 acid 一瞬 |
| `shoggoth` | 面具下的触手团（刻版阴影线），shinigami 标签 | 「简单好用」面具下的**命令总线触手团**；左缘检查器标签（图层名+存活计数）连到眼睛，闭眼即 EXPIRED；flatline 交棒 |
| `spacetime` | 示波器→黑洞→涡流→原子重排成回形针 | 示波器→「奇点」的 O 生黑洞→涡流逐字拉长→像素圆点重排成**图层块轮廓** |
| `ascent` | 蛇眼→NVDA 冲月→Omega 点→1e30 里程表 | 仪表之眼→**帧率 K 线**冲钞票雕纹月亮→收束白热点（Cormorant）→31 位滚轮「每秒 1e30 帧」+ 脚注 |
| `bureau` | 评估表单 + SAFE ENOUGH 章 + von Neumann 划掉 | 反白纸面：**表单 7-B 渲染前自评** +「够安全」橙章；命令总线图前向/后向脉冲 + 镜像「撤销」+ 结巴；v1 管线划掉 + 烧成两半 |
| `leftturn` | 路线图急转弯 + Terra incognita 面具地形 + CDR 甘特 | **版本路线图 v2.8→发布**急转弯 + 面具等高线弹坑 +「计划外目标」；甘特条 TODAY 卡死「未召开」→ 跳过 →「提前 3 天」 |
| `paperclips` | 回形针格阵填满房间，killswitch 休假卡 | **图层块格阵**每拍翻倍；「内存回收器在休假」自动回复卡；「塞不下了」收拢窒息（width 62） |
| `fuse` | 燃烧导火索 + 正交论文 blues 弦弯到音高 | 导出导火索唱词烧成灰；「表达力 × 性能」散点图，回归线在「驰」上弯成颤音弦 |
| `stack` | transformer 块无限堆叠坠落，disobey 逆唱 | **命令块**（cmd.add/bind/keyframe/export）一拍一块坠落；「撤销」逆着卡拉 OK 从右往左亮 |
| `dense` | 安全框排版压力 + 10 万 GPU + RLHF 歪斜 | 安全框内逐脚点压紧（宽 125→62、重 300→900）+「图层/画布」冲 20,000；QC 破框日志；**10 万像素**波闪（ImageData 查表）；桌面倾斜 + 面具滚落 +「自动对齐评分」0.99→0.41→弹回 |
| `loom` | 续写树 + [MASK] + Droste | **撤销树**逐 token 生成 + 备选分支概率 +「撤销树 p 0.31 ▸ 已采样」；[蒙版] 块唱到即揭；Droste 升级框 |
| `ilya` | 白线暗房笔记本，REDACTED，空剧场 | 深夜屏幕辉光，REDACTED，逐词合盖光塌成缝；空剧场「这一切都是演的吗」，幕布合拢引爆 |
| `outro` | P(DOOM) 破端帽→对数尺→1e1000→∞→公式化简 NaN→↻ Regenerate 倒带 | 图层数 4096 破端帽→对数尺→1e1000→火花描 ∞→「图层数 = ∞ (1)」→化简 ∞→8→0/0→**NaN¹**→「↻ 重新生成」→全片倒带回第一帧 |

## 二、关键特性（复刻的验收标准）

1. **每帧是时间的纯函数** —— 预览与导出逐帧一致；禁 `Math.random`/`Date.now`，噪声全部种子化；
2. **字符级卡拉 OK** —— 高亮绝不领先声音，汉字无词后空格、逐字擦亮；
3. **切点全部落在下拍** —— `cut()` 取首词之前（绝不之后）的最后一个拍点，`after()` 取最近下拍；
4. **后处理链** —— bloom → halation → CA → grain → vignette → HUD，在运动模糊平均**之后**，每帧只画一次；
5. **自适应子帧采样** —— 档位 4/12/36/108/324，shoggoth 窗口带原版同款 `maxSamples:108`；
6. **scene 返回 post 覆写** —— 场景自己决定 bloom/flash/shake/HUD 读数；
7. **书挡裁切标记** —— 只在开场（飞出）与 outro（收回）出现，首尾帧相接可循环（revision 4 语义）。

## 三、实测

| 项 | 数值 |
| --- | --- |
| 时长 / 速度 | 156.651s / 132.007 BPM / 4/4（骨架与原曲同构） |
| 结构 | 14 段落 · 46 行词 · 22 窗口 · 17 种场景 |
| 单帧 p50（headless，1080p，samples=1） | 10–16ms（22 窗口实测），spacetime 23 / hook4 21 / paperclips ~20–30 视内容 |
| 已知噪声 | headless 里 GPU/SwiftShader 漂移会让全幅画布操作在会话间摆动；桌面浏览器更快 |

## 四、版权边界（务必遵守）

- `js/` 与 `css/` 是**对 MIT 代码的移植**，文件头注明出处；
- 词是**自写原创**：46 行中文，讲 MotionLayer 的故事——与原词仅共享「行槽位时间」这一**结构事实**（时长/速度/段落边界同理，都是骨架不是表达）；
- 配乐是**现场合成的原创和声进行**（Am–F–C–G 宪法 + 段落编曲），不是原曲；
- 场景画面**按 TREATMENT 描述的视觉乐器重做**，内容全部换成编辑器语义——不临摹原片帧；
- 原项目的名字、歌名、歌词文本、扫描图、TREATMENT 文本一律未使用。

**一个真踩过的坑（写下来防止再犯）**：canvas 的 `ctx.font` 简写**不接受 font-stretch 百分比** ——
`'900 112% 190px Archivo'` 整条赋值被静默丢弃，字体退回 10px 默认值，画面全部塌掉。
百分比必须映射成关键字（`ultra-condensed … expanded`），这就是 `type.js` 里 `stretchOf()` 的由来。

**LDR 限界**：原版 bloom 跑在 HalfFloat HDR 上（signal/ember 线性值 >1 才真发光，bone 永不 bloom）；
本复刻是 8bit 画布，bloom = 提亮+模糊+screen 的近似。bone 大字的锐利由各场景把 bloom 压低保证（Hook 0.2）。
