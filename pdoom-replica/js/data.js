/* data/lyrics.json + data/audio.json 的替代物。
 *
 * 原项目这两个文件由 Demucs 分离 + Whisper/CTC 强制对齐产出，内容是别人的歌与词 ——
 * 授权明确不覆盖（见仓库 Credits），一个字节都不能搬。
 * 这里的替代：**自写的原创词** + 同一套数据形状（行级 + 词级时间 + 速度网格），
 * 词时间按字符权重切分（与 Kinelayer v2.11 的 splitLyricUnits 同一思路），
 * 所以 timeline.ts 的 cut()/after() 机制可以原样工作。
 */
(function () {
  const BPM = 132.007;          // 与原项目分析出的速度一致 —— 只是个数，不是他们的歌
  const SPB = 60 / BPM;         // 0.4545s
  const BAR = 4 * SPB;          // 4/4
  const BARS = 64;              // 64 小节 ≈ 116.36s
  const DURATION = BARS * BAR;

  // 行文本（原创）。行占 2 小节，起于下拍。
  const TEXT = [
    'the cursor blinks at half past two',
    'a blank square waits to be true',
    'i promised nothing but one line',
    'one line became a whole design',
    'one more pass before the light',
    'one more pass and it just might',
    'hold together hold the frame',
    'say it back and say my name',
    'a paper ship on a paper sea',
    'every fold a small decree',
    'the fuse is cut the match is dry',
    'count the sparks that learn to fly',
    'one more pass before the light',
    'one more pass and it just might',
    'a room of boxes one by one',
    'each one heavier than the sun',
    'sharp left turn where the map runs out',
    'draw the road and burn the route',
    'one more pass before the light',
    'one more pass and it just might',
    'count them all as they descend',
    'too late now to keep it small',
    'stack the stones and name them all',
    'watch them settle watch them fall',
    'one more pass before the light',
    'one more pass and it just might',
    'was it worth the borrowed night',
    'the lamp goes out the file is saved',
  ];

  const weight = (w) => Math.max(1, w.replace(/[^\w']/g, '').length) + (/[,.;!?'’]$/.test(w) ? 0 : 0);

  const lines = [];
  TEXT.forEach((text, i) => {
    const start = (2 + i * 2) * BAR;
    const end = start + 2 * BAR * 0.86;
    const words = [];
    const ws = text.split(' ');
    const total = ws.reduce((a, w) => a + weight(w), 0);
    let t = start;
    for (const w of ws) {
      const span = ((end - start) * weight(w)) / total;
      words.push({ w, start: t, end: t + span });
      t += span;
    }
    lines.push({ text, start, end, words });
  });

  const beats = [];
  for (let i = 0; i < BARS * 4; i++) beats.push(i * SPB);
  const downbeats = beats.filter((_, i) => i % 4 === 0);
  const sections = [
    { name: 'intro', start: 0 },
    { name: 'verse', start: 10 * BAR },
    { name: 'hook', start: 20 * BAR },
    { name: 'outro', start: 58 * BAR },
  ];

  window.PD_DATA = { BPM, SPB, BAR, BARS, DURATION, lines, beats, downbeats, sections };
})();
