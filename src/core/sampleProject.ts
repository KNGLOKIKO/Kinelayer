/**
 * 「示例工程」这一层现在是**适配器**。
 *
 * 片子本体在 `core/showcase/film.ts`（64 秒 / 九段的极限样片）。这里只留三件事：
 * 固定的工程 id、版本号、以及给启动页算数字的 `sampleHighlights`。
 *
 * 为什么不让调用方直接引 showcase：`project.seedSample`、启动页引导条、四套自检脚本
 * 都在用 `SAMPLE_*` 这一组名字。换片子是内容的事，不该顺带改一圈 id 与字段。
 *
 * 历史（换内容就要 +1，见下）：
 *   1 = v2.8「示例 · 从这里开始」—— 4 秒海报，三条关键帧轨道
 *   2 = v2.9 96 秒六章导览 —— 讲项目背景 / 功能 / 用法 / 内容
 *   3 = v2.10 64 秒极限样片 —— 十五种 MG 风格跑一遍，把引擎压到上限
 */

import type { Project } from './types';
import { SHOWCASE_DURATION, SHOWCASE_NAME, SHOWCASE_PROJECT_ID } from './showcase/meta';

export const SAMPLE_PROJECT_ID = SHOWCASE_PROJECT_ID;
export const SAMPLE_PROJECT_NAME = SHOWCASE_NAME;
export const SAMPLE_DURATION = SHOWCASE_DURATION;

/**
 * 示例的版本号。**换了内容就必须 +1**。
 *
 * `project.seedSample` 是按版本幂等的：不带版本号的话，老用户永远停在第一次
 * 塞进去的那份上（v2.9 就踩过这个坑 —— 换片之后所有跑过 v2.8 的浏览器都还是旧海报，
 * 而且界面上完全看不出来）。
 */
export const SAMPLE_VERSION = 3;

/**
 * 造一份示例工程。
 *
 * **动态 import**：九段画面源码压缩后约 37KB gzip，而 `project.seedSample` 是在首屏
 * 注册的命令 —— 静态引会把这份重量拖到「只是想打开启动页」的人身上。
 * 只有真的要创建/换新示例时才拉这个 chunk，而那一件事每个浏览器只会发生一次。
 */
export async function createSampleProject(): Promise<Project> {
  const { createShowcaseProject } = await import('./showcase/film');
  return createShowcaseProject();
}

/** 给启动页的引导条用：把「这份示例能看什么」变成几个数字，而不是写死在文案里 */
export function sampleHighlights(project: Project): {
  layers: number;
  tracks: number;
  codeLayers: number;
  audioLayers: number;
  seconds: number;
} {
  return {
    layers: project.layers.length,
    tracks: project.layers.reduce((n, l) => n + (l.animation?.tracks?.length ?? 0), 0),
    codeLayers: project.layers.filter((l) => l.type === 'code').length,
    audioLayers: project.layers.filter((l) => l.type === 'audio').length,
    seconds: Math.round(project.duration / 1000),
  };
}
