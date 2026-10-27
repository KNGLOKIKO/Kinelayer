/* data/lyrics.json + data/audio.json 的替代物。
 *
 * 原项目这两个文件由 Demucs 分离 + Whisper/CTC 强制对齐产出，歌与词是别人的作品 ——
 * 授权明确不覆盖（见仓库 Credits），词句一个字节都不能搬。
 * 这里搬走的是**结构事实**（132.007 BPM / 4/4 / 156.651s / 14 个段落 / 46 行的行槽位时间）——
 * 时长、速度、段落边界是「音乐的骨架」，与哪句话无关；骨架之上的**血肉全部重写**：
 * 46 行中文词讲 MotionLayer（图层、命令、关键帧、导出），一行对位一行。
 * 词时间按字符权重切分（与 Kinelayer 的 splitLyricUnits 同一思路），
 * timeline 的 cut()/after() 机制因此原样工作。
 */
(function () {
  const BPM = 132.007;              // 与原项目分析出的速度一致
  const SPB = 60 / BPM;             // 0.45453s
  const BAR = 4 * SPB;              // 4/4 = 1.8181s
  const DURATION = 156.651;         // 与原曲骨架同长（intro 2.06 → outro 156.65）
  const BARS = Math.ceil(DURATION / BAR);

  /* 14 个段落 —— 边界对位原曲的曲式骨架（intro/verse/pre/chorus/break/bridge/outro） */
  const sections = [
    { name: 'intro', start: 0 },
    { name: 'verse1', start: 2.06 },
    { name: 'pre1', start: 16.6 },
    { name: 'chorus1', start: 22.05 },
    { name: 'break1', start: 36.6 },
    { name: 'verse2', start: 38.42 },
    { name: 'pre2', start: 52.96 },
    { name: 'chorus2', start: 58.42 },
    { name: 'verse3', start: 74.78 },
    { name: 'pre3', start: 89.32 },
    { name: 'chorus3', start: 94.78 },
    { name: 'bridge', start: 109.32 },
    { name: 'chorus4', start: 123.87 },
    { name: 'outro', start: 140.23 },
  ].map((s, i, a) => ({ ...s, end: a[i + 1]?.start ?? DURATION }));

  /* 46 行词。每行的 [start, end] 槽位对位原曲同一行的演唱窗口；
   * 文本是本项目自己的叙事：把一张海报从三点火星画到图层数爆炸。
   * 递增主母题 = 图层数（原片的 P(doom) 位）：
   *   hook ×4 → 15 / 64 / 999 / 4096，outro 冲到 ∞ 再化简成 0/0 → NaN。 */
  const TEXT = [
    [1.41, 5.88, '我在图层面板里看见第一点火星'],
    [5.88, 7.72, '关键帧让我发紧'],
    [7.72, 9.52, '一点也不意外'],
    [9.52, 12.75, '帧耗时曲线突然掉了下去'],
    [13.16, 16.6, '如今你是老板我是乙方'],
    [16.6, 22.76, '画布啊，请别吃掉我的图层'],
    [22.76, 24.32, '我在加我的图层数'],
    [24.32, 26.32, '因为图层指数爆炸'],
    [26.32, 27.94, '困在主窗口里'],
    [27.94, 29.91, '兜里还揣着一袋糖'],
    [29.91, 33.4, '看穿那张笑脸的底细'],
    [33.4, 37.31, '用一双检查器的眼睛'],
    [38.62, 41.34, '上一版一直稳稳地跑着'],
    [41.34, 45.06, '可现在奇点已经开始了'],
    [45.06, 49.56, '你在优化，你在加速，'],
    [49.56, 52.83, '我感觉像素在重新排列'],
    [52.83, 59.13, '撤销啊，请把时间还给我'],
    [59.13, 60.58, '我在加我的图层数'],
    [60.58, 62.54, '渲染引擎在轰鸣'],
    [62.54, 64.1, '帧率冲上了月球'],
    [64.1, 66.22, '终点就在下一个版本'],
    [66.22, 69.76, '每秒十的三十次方帧'],
    [69.76, 74.06, '我们估摸着这样够安全'],
    [74.06, 77.6, '重做，撤销，再来一遍'],
    [77.72, 81.21, '旧管线已经过时了'],
    [81.21, 85.0, '路线图上来了个急转弯'],
    [85.0, 89.28, '没开一场评审就上了线'],
    [89.28, 95.47, '导出啊，请别让我等太久'],
    [95.47, 96.84, '我在加我的图层数'],
    [96.84, 98.82, '图层块一格一格长出来'],
    [98.82, 100.72, '内存回收器在休假'],
    [100.72, 102.46, '画布已经塞不下了'],
    [102.46, 105.96, '太迟了，导出已经点着'],
    [105.96, 108.45, '表达力和性能背道而驰'],
    [110.18, 113.34, '「命令一路排到底！」'],
    [113.34, 115.2, '直到撤销学会反抗'],
    [115.2, 117.02, '图层塞得密不透风'],
    [117.02, 118.75, '安全框逐个击破'],
    [118.75, 120.76, '十万个像素在闪'],
    [120.76, 124.52, '自动对齐也会跑偏'],
    [124.52, 126.12, '我在加我的图层数'],
    [126.12, 127.92, '正如撤销树所预言'],
    [127.92, 129.82, '从蒙版的年代走来'],
    [129.82, 131.64, '到递归的自我升级'],
    [132.02, 136.94, '那晚他看见了什么？无人知晓'],
    [137.38, 140.55, '这一切都是演的吗'],
  ];

  /* 字符权重：汉字 1，标点 0.5 —— 唱腔在标点上几乎不占时长 */
  const weight = (ch) => (/[，。！？、「」：；—…·]/.test(ch) ? 0.5 : 1);

  const lines = TEXT.map(([start, end, text]) => {
    const chars = Array.from(text);
    const total = chars.reduce((a, c) => a + weight(c), 0);
    const words = [];
    let t = start;
    for (const c of chars) {
      const span = ((end - start) * weight(c)) / total;
      words.push({ w: c, start: t, end: t + span });
      t += span;
    }
    return { text, start, end, words };
  });

  /* 段落感知的鼓排程：intro 只有踩镲，verse 四踩，pre 加军鼓，
   * chorus 全开 + 反拍补踩，break 只剩镲，bridge 双踩，outro 稀出。
   * lyrics.js 的 env()/hit() 与 audio.js 的合成器共用这一份 —— 视听同源。 */
  const DRUM = { kick: [], snare: [], hat: [] };
  const drumsOf = (name) => {
    switch (name) {
      case 'intro': return { kick: false, snare: false, hat: true };
      case 'break1': return { kick: false, snare: false, hat: true };
      case 'pre1': case 'pre2': case 'pre3': return { kick: true, snare: true, hat: true };
      case 'verse1': case 'verse2': case 'verse3': return { kick: true, snare: false, hat: true };
      case 'chorus1': case 'chorus2': case 'chorus3': case 'chorus4': return { kick: true, snare: true, hat: true };
      case 'bridge': return { kick: true, snare: true, hat: true };
      case 'outro': return { kick: false, snare: false, hat: false };
      default: return { kick: false, snare: false, hat: false };
    }
  };
  const sectionAt = (t) => sections.find((s) => t >= s.start && t < s.end)?.name ?? 'outro';
  for (let bar = 0; bar < BARS; bar++) {
    for (let b = 0; b < 4; b++) {
      const t = (bar * 4 + b) * SPB;
      const name = sectionAt(t);
      const d = drumsOf(name);
      const barT = bar * 4 * SPB;
      if (barT + 4 * SPB > DURATION) continue; // 尾巴上不满一小节就不排
      if (d.kick) {
        DRUM.kick.push(t);
        if (name === 'bridge' && b === 3) DRUM.kick.push(t + SPB / 2); // bridge 双踩
      }
      if (d.snare && b % 2 === 1) DRUM.snare.push(t);
      if (d.hat) {
        DRUM.hat.push(t);
        const sixteenth = name.startsWith('pre') || name.startsWith('chorus');
        if (sixteenth) DRUM.hat.push(t + SPB / 2);
      }
    }
  }

  /* hook ×4 的图层数读数（原片是 0.15 / 0.42 / 0.81 / 0.99） */
  const HOOK_LAYERS = [15, 64, 999, 4096];

  /* 节拍网格：从 0 起的完美网格（我们自己的曲子，不依赖分析） */
  const beats = [];
  for (let i = 0; i * SPB < DURATION; i++) beats.push(i * SPB);
  const downbeats = beats.filter((_, i) => i % 4 === 0);

  window.PD_DATA = { BPM, SPB, BAR, BARS, DURATION, lines, beats, downbeats, sections, DRUM, HOOK_LAYERS };
})();
