import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { registerAllCommands } from './core/commands';
import { ensureServices } from './app/services';
import { readLayerParams } from './windows/host';
import { useEditor } from './core/store';
import { setActiveLocale } from './i18n';
import { dispatch } from './core/commandBus';
import { listCommands } from './core/registry';

registerAllCommands();
// 先按浏览器语言/上次选择初始化，再渲染（避免首帧闪一下默认语言）
setActiveLocale(useEditor.getState().ui.locale);

// Host 页面才需要安装窗口管理器与命令式服务；图层窗口是纯 Client，不创建 Host
if (!readLayerParams().layerId) {
  ensureServices();
}

/**
 * 开发态调试口：给 e2e / 手工排障用。
 * 只在 dev 构建里挂，生产 bundle 里 __ml 是 undefined——不进包、不暴露给线上用户。
 */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__ml = {
    dispatch: (type: string, payload?: unknown) => dispatch(type, payload ?? {}, { source: 'user' }),
    state: () => useEditor.getState(),
    commands: () => listCommands().map((c) => c.type),
  };
}

const container = document.getElementById('root');
if (!container) throw new Error('#root 不存在');
createRoot(container).render(<App />);
