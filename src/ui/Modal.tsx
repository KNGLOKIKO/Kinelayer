/**
 * 通用对话框外壳：遮罩 + 卡片 + 标题栏 + 底部操作条。
 *
 * 单独成文件是有原因的：启动页的新建对话框也要用它，而 `Dialogs.tsx` 里装着
 * 代码编辑器（CodeMirror）、AI 配置、Agent 面板一整套东西 —— 从那里 import 一个 Modal，
 * 打包器会把这些全塞进启动页 chunk（实测 517KB → 用户只是来列个工程）。
 */

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from './primitives';

export function Modal({
  title,
  onClose,
  children,
  width = 720,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="border-ink-600 bg-ink-850 animate-fadeIn shadow-pop flex max-h-[86vh] w-full flex-col overflow-hidden rounded-xl border"
        style={{ maxWidth: width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-ink-700 flex h-11 shrink-0 items-center justify-between border-b px-4">
          <span className="text-[12.5px] font-semibold text-zinc-200">{title}</span>
          <IconButton size={24} onClick={onClose}>
            <X size={14} />
          </IconButton>
        </div>
        <div className="ml-scroll min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && (
          <div className="border-ink-700 flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5">{footer}</div>
        )}
      </div>
    </div>
  );
}
