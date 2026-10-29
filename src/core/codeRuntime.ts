/**
 * 代码层的**运行时接口**。
 *
 * 为什么要有这一层：代码层现在是在主线程用 `new Function` 跑的。那里的「沙箱」
 * （`SANDBOX_SHADOW`）只是把常见全局名影子掉，绕过去不难；v2.16 的死循环保护是
 * 缓解，不是根治。根治要把执行搬出主线程（Worker / iframe），而那件事的前提是
 * 主线程这一侧**先有一条明确的边界**——渲染器只认接口，不认「谁来执行」。
 *
 * 于是这里只放四样东西：帧表的形状、预备请求的形状、运行时接口、一个背景层的保留键。
 * **一行实现都不许写在这里**：core 不该知道 canvas / WebGL / Worker 长什么样。
 * 唯一的例外是 `ImageBitmap` —— 它是接口约定的搬运单位（Worker 阶段要 transfer 它），
 * 所以只以类型出现，不在这里构造任何东西。
 *
 * 分两步的理由（prepare 异步 + draw 同步）：
 *   · 将来的 Worker 阶段，`prepare()` 是唯一需要 await 的地方（跨线程要等消息）；
 *   · 绘制必须同步 —— canvas 的合成顺序、`save/restore`、混合模式都是同步语义，
 *     中间插一个 await 就等于允许别的帧插队进来。
 */

import type { CodeLayer, LyricLine, Tempo } from './types';

export type LayerId = string;

/**
 * 某一层这一帧没画出来的原因。
 *
 * 刻意没有 `null` 版本：**表里没有这个键**才表示「这层这帧本来就不该画」
 * （源码是空的、图层不在区间内）。凡是在表里的 error，绘制阶段都得画占位框，
 * 否则用户看到的是「什么都没有」而不是「这层出错了」。
 */
export interface LayerError {
  readonly layerId: LayerId;
  readonly message: string;
  /** 连续异常熔断：这一层已经停跑了，不是这一帧偶然挂了 */
  readonly disabled: boolean;
}

/** 一帧里某一层的结果：要么是一张位图，要么是一个错误 */
export type FrameEntry = ImageBitmap | LayerError;

/**
 * 一帧的代码层结果表：LayerId → 位图 / 错误。
 *
 * 只读，而且**不保证每层都有**：缺键 = 这层这帧不画。渲染器不许把缺键当错误。
 */
export type FrameTable = ReadonlyMap<LayerId, FrameEntry>;

/**
 * 背景里的代码（`background.kind === 'code'`）不是图层，没有 id。
 *
 * 但它跟图层走的是同一条执行路径（同一份源码、同一个运行时、同一套熔断），
 * 所以给它一个固定的保留键。用 `undefined` 当键的话，所有工程的背景共用一个槽位，
 * 换工程时错误与熔断计数会串味。
 */
export const BACKGROUND_LAYER_ID = '__background__';

/** 预览与导出的差别，交给运行时自己决定（现在只影响日志与将来的缓存策略） */
export type RenderMode = 'preview' | 'export';

/** 一帧的谱面上下文。与 core 的 Tempo / LyricLine 同形，避免 core 反向依赖 render */
export interface FrameEnv {
  readonly tempo: Tempo;
  /* 数组本身可变（`codeEnvOf` 直接把工程的歌词数组递出来，不拷贝），
     只锁「不许换掉这个字段」。 */
  readonly lyrics: LyricLine[];
}

/** 预备一帧要的全部输入 */
export interface PrepareRequest {
  /** 时间轴时刻（毫秒） */
  readonly t: number;
  /** 帧号（30fps 网格上的整数；代码层的 `api.frame` 就是它） */
  readonly frame: number;
  /**
   * 这一帧**真的要画**的代码层。
   *
   * 调用方负责筛（不在区间内、透明度为 0、被 onlyLayerId 滤掉的都不要传进来）：
   * 代码层有跨帧的 `state`，多跑一层就会改动它自己的状态、往信号总线写东西，
   * 「筛」和「跑」分成两个地方判会得到不一致的结果。
   */
  readonly layers: readonly CodeLayer[];
  readonly mode: RenderMode;
  /**
   * 内部分辨率倍率（预览是 zoom×dpr，导出是导出倍率）。
   *
   * 不在任务书的四个字段里，但它是现有实现的输入：图层还要再乘自己的
   * `code.renderScale`。抽掉它就得让运行时自己去问界面，「谁是权威」立刻说不清。
   */
  readonly scale: number;
  readonly env: FrameEnv;
}

export interface CodeRuntime {
  /**
   * 预备一帧：把每个代码层的结果算出来，放进帧表。
   *
   * 现在（InlineRuntime）这个 Promise 是**同一个微任务里 resolve** 的，没有真实异步；
   * 将来换成 Worker 实现时，这里是唯一需要跨线程等待的地方。
   */
  prepare(req: PrepareRequest): Promise<FrameTable>;

  /**
   * 丢掉缓存。
   *
   * 带 layerId 只丢那一层（改源码 / 改引擎 / 改安全模式时用）；
   * 不带就全丢（换工程、升级循环保护编译器时用）。
   * 丢完之后的下一帧必须重新编译，不许拿旧结果顶。
   */
  dispose(layerId?: LayerId): void;
}

/** 判错用：`instanceof ImageBitmap` 在跨线程拿到的东西上不可靠，看形状 */
export function isLayerError(entry: FrameEntry): entry is LayerError {
  return (entry as LayerError).message !== undefined && (entry as LayerError).layerId !== undefined;
}
