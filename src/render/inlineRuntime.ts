/**
 * 代码层运行时的**当前实现**：主线程 + `new Function`。
 *
 * 这一层存在的意义是「把原来散在渲染器里的执行细节收进一个对象」，
 * 行为一个字都不改：还是同一份源码、同一个 `codeEngine`、同一套熔断与信号总线。
 * 换成 Worker / iframe 时，只要另写一个实现、在这里换掉，渲染器不用动。
 *
 * 位图的生命周期：`prepare()` 每次新建一批 ImageBitmap，**上一批在下一次 prepare
 * 开头统一关掉**。不逐帧提前关是因为渲染器拿到的帧表只在这一帧内有效，
 * 下一帧开始前关最省事；不关就会每帧漏 3～9 张 1080p 位图，几秒钟吃满显存。
 * `dispose()` 也要关 —— 换工程、改源码时不留悬空位图。
 */
import {
  BACKGROUND_LAYER_ID,
  isLayerError,
  type CodeRuntime,
  type FrameEntry,
  type FrameTable,
  type LayerId,
  type PrepareRequest,
} from '@/core/codeRuntime';
import { renderLayerCanvas, resetCodeRuntime } from './codeEngine';

export class InlineRuntime implements CodeRuntime {
  /** 上一帧发出去的位图：等下一帧开始时再关，见文件头 */
  private held: ImageBitmap[] = [];

  async prepare(req: PrepareRequest): Promise<FrameTable> {
    this.release();
    const table = new Map<LayerId, FrameEntry>();
    for (const layer of req.layers) {
      const r = renderLayerCanvas(layer, req.t, req.frame, req.scale, req.env);
      if (r.canvas) {
        /* 位图而不是画布：这是接口约定的搬运单位，Worker 阶段可以直接 transfer。
           代价是每层每帧多一次拷贝，这一阶段先按「行为不变」优先。 */
        const bitmap = await createImageBitmap(r.canvas);
        table.set(layer.id, bitmap);
        this.held.push(bitmap);
      } else if (!r.ok) {
        table.set(layer.id, { layerId: layer.id, message: r.error ?? '代码层异常', disabled: r.disabled });
      }
      /* r.ok 且没有画布 = 源码是空的：**不进表**。
         这不是错误，渲染器看到缺键就该什么都不画（原来是 runCodeLayer 直接 return）。 */
    }
    return table;
  }

  dispose(layerId?: LayerId): void {
    this.release();
    resetCodeRuntime(layerId);
  }

  private release(): void {
    if (!this.held.length) return;
    for (const bitmap of this.held) bitmap.close();
    this.held = [];
  }
}

/*
 * 单例：全应用一份。
 *
 * 为什么是模块级而不是 React context：渲染路径有四个入口（Stage 的 rAF、
 * 图层独立窗口、PNG 导出、WebM 逐帧导出），其中两个根本不在组件树里。
 * 代码层自己的运行时状态（编译好的函数、熔断计数、state）本来也是模块级的
 * （`codeEngine` 的 runtimes 表），这里跟着保持一致。
 */
let current: CodeRuntime = new InlineRuntime();

export function getCodeRuntime(): CodeRuntime {
  return current;
}

/**
 * 换实现。后续阶段（Worker 化）从这里接进来；换的时候旧实现先 dispose，
 * 不让两套运行时同时持着同一层的位图。
 */
export function setCodeRuntime(next: CodeRuntime): void {
  if (next === current) return;
  current.dispose();
  current = next;
}

/** 背景代码层的固定键，转出去给渲染器用，省得两边各写一份魔法字符串 */
export { BACKGROUND_LAYER_ID, isLayerError };
