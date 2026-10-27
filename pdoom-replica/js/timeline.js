/* timeline.ts 的逐字移植 —— 剪辑机制原样保留：
 * 切点 = 歌词行首词之前（绝不之后）的最后一个拍点；`after()` 取离行尾最近的下拍。
 * 词是自写的原创词，所以切出来的具体时间和原片不同 —— 机制一致，素材不同。
 */
(function () {
  function makeTimeline(ly, au) {
    /** 在匹配行第 nth 次出现的首词之前（或正好压在）的下拍上切 */
    const cut = (q, nth = 0, tol = 0.02) => {
      const s = ly.get(q, nth).words[0].start;
      return au.timeOfBeat(Math.floor(au.beatAt(s + tol)));
    };
    /** 离行尾最近的下拍 */
    const after = (q, nth = 0) => {
      const e = ly.get(q, nth).end;
      return au.downbeats.reduce((b, d) => (Math.abs(d - e) < Math.abs(b - e) ? d : b), au.downbeats[0] ?? e);
    };

    const b = {
      loss: cut('cursor blinks'),
      pre1: cut('blank square'),
      hook1: cut('one more pass', 0),
      room: cut('hold together'),
      shog: cut('paper ship'),
      space: cut('every fold'),
      pre2: cut('fuse is cut'),
      hook2: cut('one more pass', 2),
      ascent: cut('room of boxes'),
      bureau: cut('each one heavier'),
      left: cut('sharp left turn'),
      pre3: cut('draw the road'),
      hook3: cut('one more pass', 4),
      clips: cut('count them all'),
      fuse: cut('too late now'),
      stack: cut('stack the stones'),
      dense: cut('watch them settle', 0, 0.05),
      hook4: cut('one more pass', 6),
      loom: cut('was it worth'),
      ilya: cut('lamp goes out'),
      outro: au.sections.find((x) => x.name === 'outro')?.start ?? after('borrowed night'),
      end: window.PD_DATA.DURATION,
    };

    const E = (id, file, start, end, extra = {}) => ({ id, file, start, end, ...extra });

    const T = [];
    const push = (id, file, s, e, extra) => { if (e > s + 0.01) T.push(E(id, file, s, e, extra)); };
    push('open', 'open', 0, b.loss);
    push('loss', 'loss', b.loss, b.pre1);
    push('prompt1', 'prompt', b.pre1, b.hook1, { params: { variant: 'chatgpt' } });
    push('hook1', 'hook', b.hook1, b.room, { params: { n: 1 } });
    push('room', 'room', b.room, b.shog);
    /* 边缘高频多：原项目给 108 的上限（324 与 108 在 4K 下已无法区分） */
    push('shoggoth', 'shoggoth', b.shog, b.space, { maxSamples: 108 });
    push('spacetime', 'spacetime', b.space, b.pre2);
    push('prompt2', 'prompt', b.pre2, b.hook2, { params: { variant: 'sydney' } });
    push('hook2', 'hook', b.hook2, b.ascent, { params: { n: 2 } });
    push('ascent', 'ascent', b.ascent, b.bureau);
    push('bureau', 'bureau', b.bureau, b.left);
    push('leftturn', 'leftturn', b.left, b.pre3);
    push('prompt3', 'prompt', b.pre3, b.hook3, { params: { variant: 'gato' } });
    push('hook3', 'hook', b.hook3, b.clips, { params: { n: 3 } });
    push('paperclips', 'paperclips', b.clips, b.fuse);
    push('fuse', 'fuse', b.fuse, b.stack);
    push('stack', 'stack', b.stack, b.dense);
    push('dense', 'dense', b.dense, b.hook4);
    push('hook4', 'hook', b.hook4, b.loom, { params: { n: 4 } });
    push('loom', 'loom', b.loom, b.ilya);
    push('ilya', 'ilya', b.ilya, b.outro);
    push('outro', 'outro', b.outro, b.end);
    return T;
  }

  window.PD_makeTimeline = makeTimeline;
})();
