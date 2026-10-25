import type { AssetMeta, Project } from './types';

export interface ExportPngOptions {
  scale: number;
  transparent: boolean;
  time: number;
}

export interface ExportWebmOptions {
  fps: number;
  quality: number;
  time: number;
}

export interface CaptureOptions {
  maxWidth?: number;
  layerId?: string | null;
  time: number;
}

export interface ImportAssetInput {
  name: string;
  mime: string;
  dataUrl: string;
}

export interface RegisterFontInput {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  dataUrl: string;
}

export interface OpenWindowResult {
  ok: boolean;
  mode: 'popup' | 'pip' | 'panel';
  message?: string;
}

/**
 * 命令层与命令式副作用（导出/落盘/开窗）之间的唯一接口。
 * 由 bootstrap 注入，命令 handler 不直接 import 渲染器，避免循环依赖。
 */
export interface Services {
  exportPng(o: ExportPngOptions): Promise<{ filename: string; bytes: number; width: number; height: number }>;
  exportWebm(
    o: ExportWebmOptions,
    onProgress: (p: number) => void,
  ): Promise<{ filename: string; bytes: number; frames: number }>;
  exportJson(): Promise<{ filename: string; bytes: number }>;
  /** 工程包（.kly / ZIP）下载。打包在命令层做，这里只负责落盘 */
  saveBundle(bytes: Uint8Array, project: Project): Promise<{ filename: string; bytes: number }>;
  /** 读进来的文件先放进暂存区：命令 payload 只带 stageId，避免把几十 MB 二进制塞进 JSON */
  stageBundle(file: File): Promise<{ stageId: string; name: string; bytes: number; zip: boolean }>;
  /** 取走暂存内容（取一次就没了），过期或不存在返回 null */
  takeBundleStage(stageId: string): Promise<Uint8Array | null>;
  /**
   * 偷看暂存内容（取走后仍在）。
   * 导入预检 `ai.inspectImport` 要读，用户确认后 `ai.importProject` 还要再读一次 ——
   * 用 takeBundleStage 会把文件吃没了，第二次导入直接报「文件已过期」。
   */
  peekBundleStage(stageId: string): Promise<{ name: string; bytes: Uint8Array } | null>;
  /** 保存一份文本产物（scene.ai.json / 降级报告 / 命令清单），触发下载 */
  saveTextFile(filename: string, text: string, mime?: string): Promise<{ filename: string; bytes: number }>;
  capture(o: CaptureOptions): Promise<{ dataUrl: string; width: number; height: number }>;
  importAsset(input: ImportAssetInput): Promise<AssetMeta>;
  removeAsset(id: string): Promise<void>;
  registerFont(input: RegisterFontInput): Promise<void>;
  removeFont(family: string): Promise<void>;
  loadFonts(families: string[]): Promise<{ loaded: string[]; failed: string[] }>;
  openLayerWindow(layerId: string, mode: 'popup' | 'pip' | 'panel'): Promise<OpenWindowResult>;
  closeLayerWindow(layerId: string): void;
  focusLayerWindow(layerId: string): void;
  /** 切换工程时调用：旧工程的 layerId 在新工程里没有意义，窗口全部关掉 */
  closeAllLayerWindows(): void;
  /**
   * 把工程用到的图片/视频从 IndexedDB 预加载进渲染缓存。
   * 只做预加载，**不改 store**：切换文档是命令总线的事，副作用不许抢跑。
   */
  preloadProjectAssets(project: Project): Promise<void>;
  notify(kind: 'info' | 'success' | 'error' | 'warn', text: string): void;
}

let current: Services | null = null;

export function setServices(s: Services): void {
  current = s;
}

export function getServices(): Services {
  if (!current) throw new Error('Services 尚未注入');
  return current;
}
