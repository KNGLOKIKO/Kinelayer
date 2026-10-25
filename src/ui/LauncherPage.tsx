/**
 * 启动页视图（路由 `/`）。
 *
 * 它只做三件事：列工程、发命令、跳进编辑器。
 * 这里**不挂 Host**（不装窗口管理器、不跑主时钟）—— 一个页面只该有一个 Host，
 * 否则撤销栈和播放头会各有一份，切回来的时候状态对不上。
 */

import { Launcher } from './Launcher';
import { ImportReportDialog } from './ImportReportDialog';
import { Toasts } from './Chrome';

export function LauncherPage() {
  return (
    <div className="bg-ink-950 text-zinc-200 flex h-full flex-col">
      <Launcher mode="page" />
      <ImportReportDialog />
      <Toasts />
    </div>
  );
}

export default LauncherPage;
