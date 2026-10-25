import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { registerAllCommands } from './core/commands';
import { ensureServices } from './app/services';
import { readLayerParams } from './windows/host';
import { useEditor } from './core/store';
import { setActiveLocale } from './i18n';

registerAllCommands();
// 先按浏览器语言/上次选择初始化，再渲染（避免首帧闪一下默认语言）
setActiveLocale(useEditor.getState().ui.locale);

// Host 页面才需要安装窗口管理器与命令式服务；图层窗口是纯 Client，不创建 Host
if (!readLayerParams().layerId) {
  ensureServices();
}

const container = document.getElementById('root');
if (!container) throw new Error('#root 不存在');
createRoot(container).render(<App />);
