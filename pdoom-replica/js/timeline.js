/* timeline.ts 的逐字移植 —— 剪辑机制原样保留：
 * 切点 = 歌词行首词之前（绝不之后）的最后一个拍点；`after()` 取离行尾最近的下拍。
 * 22 个窗口与原片逐一对应（同一行槽位切出同形结构：prompt 三变体、hook n=1..4、
 * shoggoth 的 maxSamples:108），锚点词换成我们自己的词。 */
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
      loss: cut('帧耗时'),
      pre1: cut('请别吃掉'),
      hook1: cut('我在加', 0),
      room: cut('指数爆炸'),
      shog: cut('看穿'),
      space: cut('上一版'),
      pre2: cut('撤销啊'),
      hook2: cut('我在加', 1),
      ascent: cut('渲染引擎'),
      bureau: cut('够安全'),
      left: cut('急转弯'),
      pre3: cut('导出啊'),
      hook3: cut('我在加', 2),
      clips: cut('图层块'),
      fuse: cut('太迟了'),
      stack: cut('排到底'),
      dense: cut('密不透风', 0, 0.05),
      hook4: cut('我在加', 3),
      loom: cut('撤销树'),
      ilya: cut('看见了什么'),
      // outro 段从音乐骨架的段落边界起（最后一词可能是长音）
      outro: au.sections.find((x) => x.name === 'outro')?.start ?? after('演的吗'),
      end: window.PD_DATA.DURATION,
    };

    const E = (id, file, start, end, extra = {}) => ({ id, file, start, end, ...extra });

    const T = [];
    const push = (id, file, s, e, extra) => { if (e > s + 0.01) T.push(E(id, file, s, e, extra)); };
    push('open', 'open', 0, b.loss);
    push('loss', 'loss', b.loss, b.pre1);
    push('prompt1', 'prompt', b.pre1, b.hook1, { params: { variant: 'canvas' } });
    push('hook1', 'hook', b.hook1, b.room, { params: { n: 1 } });
    push('room', 'room', b.room, b.shog);
    /* 边缘高频多：原项目给 108 的上限（324 与 108 在 4K 下已无法区分） */
    push('shoggoth', 'shoggoth', b.shog, b.space, { maxSamples: 108 });
    push('spacetime', 'spacetime', b.space, b.pre2);
    push('prompt2', 'prompt', b.pre2, b.hook2, { params: { variant: 'undo' } });
    push('hook2', 'hook', b.hook2, b.ascent, { params: { n: 2 } });
    push('ascent', 'ascent', b.ascent, b.bureau);
    push('bureau', 'bureau', b.bureau, b.left);
    push('leftturn', 'leftturn', b.left, b.pre3);
    push('prompt3', 'prompt', b.pre3, b.hook3, { params: { variant: 'export' } });
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
