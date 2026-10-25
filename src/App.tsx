import { lazy, Suspense } from 'react';
import { EditorApp } from './EditorApp';
import { readLayerParams } from './windows/host';
import { useEditor } from './core/store';

const LayerWindowApp = lazy(() => import('./windows/LayerWindowApp'));

export default function App() {
  const { layerId } = readLayerParams();
  // 切语言时整棵树重建：模块级常量、文案、格式化日期全部跟着刷新
  const locale = useEditor((s) => s.ui.locale);
  if (layerId) {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-[12px] text-zinc-500">加载图层窗口…</div>
        }
      >
        <LayerWindowApp key={locale} />
      </Suspense>
    );
  }
  return <EditorApp key={locale} />;
}
