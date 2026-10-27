/**
 * 示例工程的身份 —— 只有 id / 名字 / 时长三个常量，**不 import 任何画面代码**。
 *
 * 为什么要拆成单独一个文件：整支 64 秒片子的九段源码在 `showcase/scenes.ts` 里，
 * 压缩后约 37KB gzip。而 `project.seedSample` 是在首屏注册的命令，
 * 静态 import 会把那 37KB 一起拖进首屏 —— 一个「打开启动页」的人不该为「一份可能
 * 永远不会被创建的示例」付这份下载。所以常量和重内容分开：常量静态引，
 * `createShowcaseProject()` 用动态 import，只有真的要塞示例时才拉。
 */

export const SHOWCASE_PROJECT_ID = 'prj_sample_start';
export const SHOWCASE_NAME = '示例 · 极限样片（64 秒）';

const SEG = 8_000;
const SEG_COUNT = 8;

/** 总时长 = 段数 × 每段时长。改段数要同时改 `showcase/film.ts` 的 SEGMENTS 表 */
export const SHOWCASE_DURATION = SEG * SEG_COUNT;
