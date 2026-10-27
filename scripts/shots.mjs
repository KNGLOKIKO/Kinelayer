/**
 * 分镜出图：把「再改一版」在若干个时刻各渲一张 1080p PNG。
 *
 * 走的是 `__kly.frame(ms)` —— 也就是导出那条 renderToCanvas，所以看到的就是导出的样子。
 * 用途只有一个：导演自己看片。时间轴上看着合理、真的渲出来挤成一团，是这类片子最常见的坑。
 */
import fs from 'node:fs';
import { launch } from './_cdp.mjs';

const OUT = '.workbuddy/tmp/rev';
fs.mkdirSync(OUT, { recursive: true });

/* 每个段落取一两个「最要紧」的时刻（不是均匀采样：均匀采样会把 90% 的帧落在过渡上） */
const FRAMES = [
  [1_500, '01-coldopen'],
  [6_400, '02-firstline'],
  [9_900, '02-layers'],
  [16_200, '03-timeline'],
  [21_600, '04-counters'],
  [25_600, '04-chart'],
  [29_800, '05-bus'],
  [39_000, '06-fuse'],
  [41_270, '07-blast'],
  [41_600, '07-blast-late'],
  [43_200, '07-labels'],
  [46_900, '08-nan'],
  [49_200, '08-shake'],
  [53_900, '09-end'],
  [57_600, '09-credits'],
];

const b = await launch({ url: 'http://127.0.0.1:5273/', matchUrl: '5273' });
try {
  await b.waitFor('typeof window.__kly !== "undefined"', 20000);
  const seeded = await b.ev(`window.__kly.dispatch('project.seedSample', { force: true }).then((r) => JSON.stringify(r.ok))`);
  console.log('seedSample ok =', seeded);
  const opened = await b.ev(
    `window.__kly.dispatch('project.open', { projectId: 'prj_sample_revision' }).then((r) => JSON.stringify(r).slice(0, 300))`,
  );
  console.log('open =', opened);
  await b.waitFor(`window.__kly.state().project.id === 'prj_sample_revision'`, 8000);
  const info = await b.ev(`JSON.stringify({
    id: window.__kly.state().project.id,
    layers: window.__kly.state().project.layers.length,
    lyrics: (window.__kly.state().project.lyrics || []).length,
    tempo: window.__kly.state().project.tempo
  })`);
  console.log('project =', info);

  for (const [ms, name] of FRAMES) {
    const dataUrl = await b.ev(`window.__kly.frame(${ms})`);
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png')) {
      console.log(`  FAIL ${name}`);
      continue;
    }
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`  ok   ${name}  @${ms}ms`);
  }
} finally {
  b.edge.kill();
}
