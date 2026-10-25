import { lazy, Suspense } from 'react';
import { readLayerParams } from './windows/host';
import { useEditor } from './core/store';
import { t } from './i18n';

/**
 * 视图分流。三种视图分开打包：启动页不该为了列工程就把 CodeMirror 和渲染引擎拉下来。
 *
 *   /                                  → LauncherPage（独立视图，不是 Host）
 *   /?view=editor&projectId=xxx        → EditorApp（唯一 Host）
 *   /?view=layer&layerId=…&host=…      → LayerWindowApp（纯 Client）
 *   /?view=launcher                    → EditorApp + 工程库覆盖层（历史深链，保留）
 */

const EditorApp = lazy(() => import('./EditorApp').then((m) => ({ default: m.EditorApp })));
const LauncherPage = lazy(() => import('./ui/LauncherPage'));
const LayerWindowApp = lazy(() => import('./windows/LayerWindowApp'));

function Fallback({ label }: { label: string }) {
  return (
    <div className="bg-ink-950 flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2">
        <div className="border-ink-700 border-t-accent h-5 w-5 animate-spin rounded-full border-2" />
        <div className="text-[11px] text-zinc-500">{label}</div>
      </div>
    </div>
  );
}

export default function App() {
  const { layerId } = readLayerParams();
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const projectId = params.get('projectId');
  // 切语言时整棵树重建：模块级常量、文案、格式化日期全部跟着刷新
  const locale = useEditor((s) => s.ui.locale);

  if (layerId) {
    return (
      <Suspense fallback={<Fallback label={t('加载图层窗口…')} />}>
        <LayerWindowApp key={locale} />
      </Suspense>
    );
  }

  /* 缺省视图 = 启动页：刷新停在 `/` 就该看到工程库，而不是凭空开一份文档 */
  const wantsEditor = view === 'editor' || view === 'launcher' || !!projectId;
  if (!wantsEditor) {
    return (
      <Suspense fallback={<Fallback label={t('加载工程库…')} />}>
        <LauncherPage key={locale} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<Fallback label={t('加载编辑器…')} />}>
      <EditorApp key={locale} />
    </Suspense>
  );
}
