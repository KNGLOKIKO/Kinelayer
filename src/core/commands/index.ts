import { clearRegistry, registerCommands } from '../registry';
import { layerCommands } from './layers';
import { textCommands } from './text';
import { codeCommands } from './code';
import { audioCommands } from './audio';
import { backgroundCommands } from './background';
import { projectCommands } from './project';
import { assetCommands } from './assets';
import { fontCommands } from './fonts';
import { timelineCommands } from './timeline';
import { mediaCommands } from './media';
import { animationCommands } from './animation';
import { selectionCommands } from './selection';
import { historyCommands } from './history';
import { windowCommands } from './windows';
import { exportCommands } from './export';
import { queryCommands } from './query';
import { aiCommands } from './ai';
import { customCommands } from './custom';
import { batchCommand } from './batch';

let registered = false;

/** 命令注册表的唯一装配点；所有通道共享这一份实例 */
export function registerAllCommands(): void {
  if (registered) return;
  registered = true;
  // 开发态 HMR 会重新执行本模块：先清空再注册，避免重复命令
  clearRegistry();
  registerCommands(layerCommands);
  registerCommands(textCommands);
  registerCommands(codeCommands);
  registerCommands(audioCommands);
  registerCommands(backgroundCommands);
  registerCommands(projectCommands);
  registerCommands(assetCommands);
  registerCommands(fontCommands);
  registerCommands(timelineCommands);
  registerCommands(mediaCommands);
  registerCommands(animationCommands);
  registerCommands(selectionCommands);
  registerCommands(historyCommands);
  registerCommands(windowCommands);
  registerCommands(exportCommands);
  registerCommands(queryCommands);
  registerCommands(aiCommands);
  registerCommands(customCommands);
  registerCommands([batchCommand]);
}
