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
  capture(o: CaptureOptions): Promise<{ dataUrl: string; width: number; height: number }>;
  importAsset(input: ImportAssetInput): Promise<AssetMeta>;
  removeAsset(id: string): Promise<void>;
  registerFont(input: RegisterFontInput): Promise<void>;
  removeFont(family: string): Promise<void>;
  loadFonts(families: string[]): Promise<{ loaded: string[]; failed: string[] }>;
  openLayerWindow(layerId: string, mode: 'popup' | 'pip' | 'panel'): Promise<OpenWindowResult>;
  closeLayerWindow(layerId: string): void;
  focusLayerWindow(layerId: string): void;
  loadProject(project: Project): Promise<void>;
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
