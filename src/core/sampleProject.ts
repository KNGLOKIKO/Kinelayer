/**
 * 「示例工程」这一层是**适配器**，现在管两份：
 *
 *   1. 极限样片（64 秒 / 九段）—— 把渲染引擎压到性能上限，零外部资源；
 *   2. 再改一版（60 秒 / 九段）—— 把叙事压到上限：速度网格、逐字卡拉 OK、
 *      下拍硬切、一条贯穿母题、一个逐级递增的数字。复刻自 mexicat/pdoom-video 的手法，
 *      内容换成本工程自己的。
 *
 * 这里只留四件事：两份示例的 id / 名字 / 版本号，以及给启动页算数字的 `sampleHighlights`。
 * 片子本体各自在自己的目录里（`showcase/film.ts`、`showcase/revision/film.ts`）。
 *
 * 历史（换内容就要 +1，见下）：
 *   1 = v2.8「示例 · 从这里开始」—— 4 秒海报，三条关键帧轨道
 *   2 = v2.9 96 秒六章导览 —— 讲项目背景 / 功能 / 用法 / 内容
 *   3 = v2.10 64 秒极限样片 —— 十五种 MG 风格跑一遍，把引擎压到上限
 *   4 = v2.11 追加 60 秒「再改一版」—— 并给引擎补上速度网格与逐字时间
 *   5 = v2.12 「再改一版」引爆段调优 —— 4 子帧运动模糊 + renderScale 0.5，
 *       单帧 43ms → 13ms，全片 0 帧超 16.7ms 预算
 */

import type { Project } from './types';
import { SHOWCASE_DURATION, SHOWCASE_NAME, SHOWCASE_PROJECT_ID } from './showcase/meta';
import { REVISION_DURATION, REVISION_NAME, REVISION_PROJECT_ID } from './showcase/revision/meta';

export interface SampleDef {
  id: string;
  name: string;
  /** 时长（毫秒）。给「有新版」的提示用，不必把整份工程建出来 */
  duration: number;
  /** **动态 import**：源码压缩后几十 KB，不该拖到「只想打开启动页」的人身上 */
  load: () => Promise<Project>;
}

/**
 * 示例包的版本号。**换了任何一份的内容都必须 +1**。
 *
 * `project.seedSample` 是按「每份示例各自的版本」幂等的：不带版本号的话，
 * 老用户永远停在第一次塞进去的那份上（v2.9 就踩过这个坑 —— 换片之后
 * 所有跑过 v2.8 的浏览器都还是旧海报，而且界面上完全看不出来）。
 */
export const SAMPLE_PACK_VERSION = 5;

export const SAMPLES: SampleDef[] = [
  {
    id: SHOWCASE_PROJECT_ID,
    name: SHOWCASE_NAME,
    duration: SHOWCASE_DURATION,
    load: async () => {
      const m = await import('./showcase/film');
      return m.createShowcaseProject();
    },
  },
  {
    id: REVISION_PROJECT_ID,
    name: REVISION_NAME,
    duration: REVISION_DURATION,
    load: async () => {
      const m = await import('./showcase/revision/film');
      return m.createRevisionProject();
    },
  },
];

/* 兼容旧引用：主示例 = 列表里的第一份（启动页的引导卡只讲它） */
export const SAMPLE_PROJECT_ID = SAMPLES[0]!.id;
export const SAMPLE_PROJECT_NAME = SAMPLES[0]!.name;
export const SAMPLE_DURATION = SAMPLES[0]!.duration;
export const SAMPLE_VERSION = SAMPLE_PACK_VERSION;
export const createSampleProject: () => Promise<Project> = SAMPLES[0]!.load;

/** 给启动页的引导条用：把「这份示例能看什么」变成几个数字，而不是写死在文案里 */
export function sampleHighlights(project: Project): {
  layers: number;
  tracks: number;
  codeLayers: number;
  audioLayers: number;
  seconds: number;
  lyrics: number;
  tempo: number;
} {
  return {
    layers: project.layers.length,
    tracks: project.layers.reduce((n, l) => n + (l.animation?.tracks?.length ?? 0), 0),
    codeLayers: project.layers.filter((l) => l.type === 'code').length,
    audioLayers: project.layers.filter((l) => l.type === 'audio').length,
    seconds: Math.round(project.duration / 1000),
    lyrics: project.lyrics?.length ?? 0,
    tempo: project.tempo?.bpm ?? 0,
  };
}
