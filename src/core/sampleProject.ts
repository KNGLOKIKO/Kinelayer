/**
 * 首次打开应用时放进工程库的那份示例工程。
 *
 * 三条约束，都是「新用户第一眼」倒推出来的：
 *
 * 1. **不依赖任何外部资源**。没有图片、没有视频、不用本地字体 —— 否则第一次打开就是
 *    一片「图片资源缺失」的灰块，示例反而变成了故障演示。
 * 2. **第 0 帧就得是一张完整海报**。播放头在 0，而入场预设（`enter`）在这一刻的透明度是 0：
 *    照搬演示工程的话，新用户打开看到的是一块背景加几条流线，看不到任何文字。
 *    所以这份示例不用入场/退场预设，只用关键帧轨道，且轨道从「设计位置」起步。
 * 3. **看得出能改**。时间轴上要有轨道（不然不知道有关键帧），画布上要有一行「试试」，
 *    图层名要写人话（主标题 / 眉标 / 光斑 · 代码层），这样图层面板本身就是说明书。
 *
 * 内容主体复用 `createDemoProject()`：那份海报的设计已经调好，没必要再画一遍。
 * 差别只在 id、动画形态和多出来的一行提示。
 */

import { createDemoProject, createTextLayer, defaultTextStyle, emptyAnimation } from './defaults';
import { uid } from './ids';
import type { Layer, PropertyTrack, Project } from './types';

/**
 * 固定 id。
 *
 * 不用随机 id 有两个原因：一是「示例是否已存在」可以直接按 id 查索引，
 * 标记位丢了也不会重复创建；二是自检和文档里能写死一个可读的 id。
 */
export const SAMPLE_PROJECT_ID = 'prj_sample_start';
export const SAMPLE_PROJECT_NAME = '示例 · 从这里开始';

function track(property: PropertyTrack['property'], keyframes: { time: number; value: number; kind: PropertyTrack['keyframes'][number]['easing']['kind'] }[]): PropertyTrack {
  return {
    property,
    keyframes: keyframes.map((k) => ({ id: uid('kf'), time: k.time, value: k.value, easing: { kind: k.kind } })),
  };
}

export function createSampleProject(): Project {
  const base = createDemoProject();

  /*
   * 去掉入场/退场，保留强调（缓动的光斑在 t=0 不会让内容消失）。
   * 这一步是「第 0 帧完整」的关键，别为了好看把 enter 加回来 ——
   * 打开工程时 playhead 恒为 0，加回来就等于开场白屏。
   */
  const layers: Layer[] = base.layers.map((layer) => ({
    ...layer,
    animation: {
      ...emptyAnimation(),
      ...(layer.animation.emphasis ? { emphasis: layer.animation.emphasis } : {}),
    },
  }));

  const title = layers.find((l) => l.name === '主标题');
  if (title) {
    /* 主标题从下往上归位：轨道起点比设计位置低 28px，1.4 秒后落定 */
    title.animation.tracks = [track('y', [
      { time: 0, value: title.y + 28, kind: 'ease-out-cubic' },
      { time: 1400, value: title.y, kind: 'ease-out' },
    ])];
  }

  const eyebrow = layers.find((l) => l.name === '眉标');
  if (eyebrow && eyebrow.type === 'text') {
    /* 字距缓慢拉开：文本层专有属性，用来演示「只有文本才有的轨道」 */
    eyebrow.animation.tracks = [track('letterSpacing', [
      { time: 0, value: 7, kind: 'ease-out' },
      { time: 2400, value: 12.5, kind: 'ease-in-out' },
    ])];
  }

  const accent = layers.find((l) => l.name === '光斑 · 代码层');
  if (accent) {
    /* 光斑匀速自转一圈：一眼能看出「关键帧在动」 */
    accent.animation.tracks = [track('rotation', [
      { time: 0, value: 0, kind: 'linear' },
      { time: base.duration, value: 360, kind: 'linear' },
    ])];
  }

  /* 画布内的说明书：用户可以随手删掉，删了不影响任何东西 */
  const hint = createTextLayer({
    name: '试试看（可删除）',
    x: 96,
    y: 1338,
    width: 900,
    height: 56,
    text: '空格播放 · 拖动图层改位置 · 双击文字改字',
    style: {
      ...defaultTextStyle(),
      fontFamily: 'Microsoft YaHei',
      fontSize: 19,
      fontWeight: 500,
      letterSpacing: 0.8,
      color: '#7b8ca8',
      wrap: false,
    },
  });

  return {
    ...base,
    id: SAMPLE_PROJECT_ID,
    name: SAMPLE_PROJECT_NAME,
    layers: [...layers, hint],
    /* 保持 version 1：它只是库里的一个记录，不代表「有人编辑过」 */
    version: 1,
  };
}

/** 给启动页的引导条用：把「这份示例能看什么」变成几个数字，而不是写死在文案里 */
export function sampleHighlights(project: Project): { layers: number; tracks: number; codeLayers: number } {
  return {
    layers: project.layers.length,
    tracks: project.layers.reduce((n, l) => n + (l.animation?.tracks?.length ?? 0), 0),
    codeLayers: project.layers.filter((l) => l.type === 'code').length,
  };
}
