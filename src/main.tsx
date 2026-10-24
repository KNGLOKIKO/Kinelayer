import { createRoot } from 'react-dom/client';
import './styles.css';
import App from './App';
import { registerAllCommands } from './core/commands';
import { ensureServices } from './app/services';
import { readLayerParams } from './windows/host';

registerAllCommands();

// Host 页面才需要安装窗口管理器与命令式服务；图层窗口是纯 Client，不创建 Host
if (!readLayerParams().layerId) {
  ensureServices();
}

const container = document.getElementById('root');
if (!container) throw new Error('#root 不存在');
createRoot(container).render(<App />);
