/**
 * 视图路由：一个纯前端 SPA，靠 query 分流三种视图。
 *
 *   /                                     → 启动页（Launcher，独立视图，不是 Host）
 *   /?view=editor&projectId=xxx           → 编辑器（唯一 Host）
 *   /?view=layer&layerId=xxx&host=xxx     → 图层独立窗口（纯 Client）
 *
 * 为什么用 query 而不是 location.hash：hash 会被图层窗口的 hostId 传递逻辑用掉，
 * 两套东西挤在 hash 里解析起来很容易互相污染。
 *
 * 保留 `?view=launcher` = 「编辑器 + 打开工程库覆盖层」这条旧深链（历史入口、自检脚本在用），
 * 启动页本体走 `/`。
 */

export type ViewName = 'editor' | 'layer' | 'launcher';

/** 在当前路径上换一组 query，保留 base path（GitHub Pages 的 /Kinelayer/ 前缀） */
export function buildUrl(view: ViewName | null, params: Record<string, string | null | undefined> = {}): string {
  const url = new URL(window.location.href);
  url.search = '';
  if (view) url.searchParams.set('view', view);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') url.searchParams.set(key, value);
  }
  return `${url.pathname}${url.search}`;
}

export function editorUrl(projectId?: string | null): string {
  return buildUrl('editor', { projectId });
}

export function launcherUrl(): string {
  return buildUrl(null);
}

export function go(url: string): void {
  window.location.assign(url);
}

/** 不刷新地改地址栏：编辑器启动后把 projectId 补进 URL，刷新才不会掉回启动页 */
export function replaceUrl(url: string): void {
  window.history.replaceState(null, '', url);
}
