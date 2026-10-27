/* engine/lyrics.ts 与 engine/audio.ts 的移植 —— 查询接口逐个对齐。 */
(function () {
  const D = window.PD_DATA;

  /* ------------------------------------------------------------ Lyrics */
  const lyrics = {
    lines: D.lines,
    /** 按内容找行：可匹配直引号或弯引号，不硬编码时间 */
    get(q, nth = 0) {
      const norm = (s) => s.replace(/[’‘]/g, "'").replace(/[“”]/g, '"').toLowerCase();
      const hits = D.lines.filter((l) => norm(l.text).includes(norm(q)));
      if (!hits[nth]) throw new Error(`lyrics.get: 找不到「${q}」第 ${nth} 次`);
      return hits[nth];
    },
    findWords(q) {
      const out = [];
      for (const l of D.lines) for (const w of l.words) if (w.w.toLowerCase().includes(q.toLowerCase())) out.push(w);
      return out;
    },
    /** 词的演唱进度 0..1 —— 卡拉 OK 高亮的唯一真相 */
    wordProgress(word, t) {
      if (t <= word.start) return 0;
      if (t >= word.end) return 1;
      return (t - word.start) / (word.end - word.start);
    },
    /** 行内已唱字符数（用于逐字形 wipe）。汉字没有词后空格，+0；拉丁文 +1 */
    lineCharProgress(line, t) {
      let n = 0;
      for (const w of line.words) {
        const gap = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef「」『』]/.test(w.w) ? 0 : 1;
        if (t >= w.end) { n += w.w.length + gap; continue; }
        if (t <= w.start) break;
        n += Math.round(w.w.length * this.wordProgress(w, t));
        break;
      }
      return Math.max(0, Math.min(Array.from(line.text).length, n));
    },
    lineAt(t) {
      return D.lines.find((l) => t >= l.start && t < l.end) ?? null;
    },
  };

  /* ------------------------------------------------------------ AudioData */
  // 鼓的排程由 data.js 按段落生成（四踩 + 2/4 军鼓 + 镲，intro/break/outro 稀出），
  // env 用解析衰减，不需要 FFT —— 因此 export 的子帧仍是纯函数。
  const schedule = D.DRUM;
  const hitAt = (list, t) => {
    // 最近的、不晚于 t 的那次敲击
    let lo = 0, hi = list.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m] <= t) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans >= 0 ? list[ans] : null;
  };

  const audio = {
    beats: D.beats,
    downbeats: D.downbeats,
    sections: D.sections,
    bpm: D.BPM,
    beatAt: (t) => t / D.SPB,
    barAt: (t) => t / (4 * D.SPB),
    timeOfBeat: (i) => i * D.SPB,
    nearestBeat: (t) => D.beats.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), D.beats[0]),
    events(kind, t0, t1) { return (schedule[kind] ?? []).filter((t) => t >= t0 && t < t1); },
    hit(kind, t, halfLife = 0.11) {
      const last = hitAt(schedule[kind] ?? [], t);
      if (last === null) return 0;
      return Math.exp(-(t - last) / halfLife);
    },
    env(name, t) {
      if (name === 'kick' || name === 'snare' || name === 'hat') return this.hit(name, t, name === 'hat' ? 0.04 : 0.11);
      if (name === 'rms') return 0.4 + 0.25 * this.hit('kick', t, 0.2);
      if (name === 'low') return 0.5 + 0.4 * this.hit('kick', t, 0.15);
      if (name === 'mid') return 0.3 + 0.3 * this.hit('snare', t, 0.12);
      if (name === 'high') return 0.2 + 0.25 * this.hit('hat', t, 0.05);
      if (name === 'vocal') { const l = lyrics.lineAt(t); return l ? 0.4 + 0.4 * lyrics.wordProgress(l.words[0], t) : 0; }
      if (name === 'drums') return 0.35 + 0.35 * this.hit('kick', t, 0.18);
      return 0.3;
    },
  };

  window.PD_LYRICS = lyrics;
  window.PD_AUDIO = audio;
})();
