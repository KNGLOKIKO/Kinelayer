import { lazy, Suspense } from 'react';
import { EditorApp } from './EditorApp';
import { readLayerParams } from './windows/host';

const LayerWindowApp = lazy(() => import('./windows/LayerWindowApp'));

export default function App() {
  const { layerId } = readLayerParams();
  if (layerId) {
    return (
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center text-[12px] text-zinc-500">加载图层窗口…</div>
        }
      >
        <LayerWindowApp />
      </Suspense>
    );
  }
  return <EditorApp />;
}
