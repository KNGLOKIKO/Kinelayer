import { en } from './en';

/**
 * 极简 i18n
 * ---------------------------------------------------------------------------
 * 设计取舍：**用中文原文当 key**。
 *   · 好处：改 UI 时不用维护一份 key 表，漏翻译只会退化成中文，不会显示 raw key；
 *     `en.ts` 的键就是界面上真实出现的句子，审计覆盖率只要 diff 一下即可。
 *   · 代价：中文文案改动会让旧翻译失效（回退中文），所以改文案时要同步改 en.ts。
 *   · 加语言：新建 `ja.ts` 填进 DICTS 就行，其它代码一行不用动。
 *
 * 为什么不用 react-i18next / i18next：本项目要「零运行时依赖 + 完全离线」，
 * 我们只需要「取词 + 插值 + 切换」，两百来行以内能说清楚的事不值得引一个生态。
 */

export type Locale = 'zh-CN' | 'en-US';

export const LOCALES: { id: Locale; label: string; short: string }[] = [
  { id: 'zh-CN', label: '简体中文', short: '中' },
  { id: 'en-US', label: 'English', short: 'EN' },
];

const DICTS: Record<Locale, Record<string, string>> = {
  'zh-CN': {},
  'en-US': en,
};

const STORAGE_KEY = 'ml.locale';

let active: Locale = 'zh-CN';

export function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh-CN' || saved === 'en-US') return saved;
  } catch {
    /* 隐私模式可能禁用 localStorage */
  }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'zh-CN').toLowerCase();
  return nav.startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function getLocale(): Locale {
  return active;
}

export function setActiveLocale(locale: Locale): void {
  active = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => (params[key] !== undefined ? String(params[key]) : `{${key}}`));
}

/** 全局取词。组件里也能直接用，切语言时靠根节点 key 重建整棵树来刷新 */
export function t(zh: string, params?: Record<string, string | number>): string {
  const dict = DICTS[active] ?? {};
  const hit = dict[zh];
  return interpolate(hit ?? zh, params);
}

/** 显式指定语言取词（导出文件名、非 React 场景用） */
export function tIn(locale: Locale, zh: string, params?: Record<string, string | number>): string {
  const hit = (DICTS[locale] ?? {})[zh];
  return interpolate(hit ?? zh, params);
}

/** 已翻译条目数，给设置面板显示覆盖率用 */
export function translationStats(): { total: number; translated: number } {
  const total = Object.keys(en).length;
  const translated = Object.values(en).filter((v) => v && v !== '__TODO__').length;
  return { total, translated };
}

/**
 * 列表 / 分句分隔符。
 * 中文用「、」「；」，英文必须换成「, 」「; 」——这是标点本地化，不能靠翻译单句解决。
 */
export function listSep(): string {
  return active === 'zh-CN' ? '、' : ', ';
}

export function clauseSep(): string {
  return active === 'zh-CN' ? '；' : '; ';
}
