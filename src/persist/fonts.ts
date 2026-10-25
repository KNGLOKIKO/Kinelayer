import { idbGetKV, idbSetKV } from './idb';
import { t } from '@/i18n';

export interface StoredFont {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  dataUrl: string;
}

const KEY = 'fonts.uploaded';
const faces = new Map<string, FontFace>();

function keyOf(family: string, weight: number, style: string): string {
  return `${family}|${weight}|${style}`;
}

export async function registerFontFace(input: StoredFont): Promise<void> {
  const face = new FontFace(input.family, `url(${input.dataUrl})`, {
    weight: String(input.weight),
    style: input.style,
  });
  await face.load();
  document.fonts.add(face);
  const existing = faces.get(keyOf(input.family, input.weight, input.style));
  if (existing) document.fonts.delete(existing);
  faces.set(keyOf(input.family, input.weight, input.style), face);

  const list = (await idbGetKV<StoredFont[]>(KEY)) ?? [];
  const next = list.filter(
    (f) => !(f.family === input.family && f.weight === input.weight && f.style === input.style),
  );
  next.push(input);
  await idbSetKV(KEY, next);
}

export async function restoreFonts(): Promise<string[]> {
  const list = (await idbGetKV<StoredFont[]>(KEY)) ?? [];
  const restored: string[] = [];
  for (const item of list) {
    try {
      await registerFontFace(item);
      restored.push(item.family);
    } catch {
      // 损坏的字体文件直接跳过，不阻塞启动
    }
  }
  return Array.from(new Set(restored));
}

export async function removeFont(family: string): Promise<void> {
  for (const [key, face] of faces.entries()) {
    if (key.startsWith(`${family}|`)) {
      document.fonts.delete(face);
      faces.delete(key);
    }
  }
  const list = (await idbGetKV<StoredFont[]>(KEY)) ?? [];
  await idbSetKV(KEY, list.filter((f) => f.family !== family));
}

export async function loadFonts(families: string[]): Promise<{ loaded: string[]; failed: string[] }> {
  const loaded: string[] = [];
  const failed: string[] = [];
  for (const family of families) {
    try {
      await document.fonts.load(`400 16px "${family}"`);
      await document.fonts.load(`700 16px "${family}"`);
      const ok = document.fonts.check(`400 16px "${family}"`);
      if (ok) loaded.push(family);
      else failed.push(family);
    } catch {
      failed.push(family);
    }
  }
  return { loaded, failed };
}

interface LocalFontData {
  family?: string;
  fullName?: string;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}

/** Local Font Access API（WICG）：需要用户手势与权限授权 */
export async function listLocalFonts(): Promise<string[]> {
  if (!window.queryLocalFonts) {
    throw new Error(t('当前浏览器不支持 Local Font Access（需 Chrome/Edge 103+，且页面处于安全上下文）'));
  }
  const fonts = await window.queryLocalFonts();
  const families = new Set<string>();
  for (const f of fonts) {
    const name = f.family ?? f.fullName;
    if (name) families.add(name);
  }
  return [...families].sort((a, b) => a.localeCompare(b));
}

export const SYSTEM_FONTS: string[] = [
  'Segoe UI',
  'Microsoft YaHei',
  'PingFang SC',
  'Hiragino Sans GB',
  'Inter',
  'Helvetica Neue',
  'Arial',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Consolas',
  'Menlo',
  'Source Han Sans SC',
  'Noto Sans SC',
  'SimSun',
  'SimHei',
  'KaiTi',
  'FangSong',
];
