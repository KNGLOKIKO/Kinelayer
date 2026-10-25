import { updateUi } from '@/core/store';
import { setActiveLocale, type Locale } from './index';

/** 切换语言：全局取词器 + store 一起改，根节点用 locale 做 key 触发整棵树重建 */
export function applyLocale(locale: Locale): void {
  setActiveLocale(locale);
  updateUi((ui) => {
    ui.locale = locale;
  });
}
