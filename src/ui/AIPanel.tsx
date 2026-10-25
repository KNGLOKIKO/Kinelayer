import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CornerUpLeft, Loader2, Plug, Send, Sparkles, Square, X } from 'lucide-react';
import { dispatch, exec } from '@/core/commandBus';
import { getCommand, fromToolName, type CommandResult } from '@/core/registry';
import { pushToast, updateUi, useEditor } from '@/core/store';
import { chatCompletion, systemPrompt, type ChatMessage, type ToolCall } from '@/ai/client';
import { useAIConfig } from '@/ai/config';
import { planDemo } from '@/ai/demoAgent';
import { uid } from '@/core/ids';
import { Badge, Button, IconButton, cx } from './primitives';

import { t } from '@/i18n';
interface Item {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'error' | 'notice';
  text: string;
  image?: string;
  toolType?: string;
  ok?: boolean;
  commandId?: string;
}

interface Approval {
  id: string;
  type: string;
  payload: unknown;
  dangerous: boolean;
  resolve: (ok: boolean) => void;
}

const QUICK = [
  '加一个标题「Kinelayer · 可编程海报」',
  '把背景换成深紫渐变',
  '字号大一点',
  '加个代码层',
  '导出 PNG',
]; // 存中文原文，渲染时 t()

function trimResult(result: CommandResult): string {
  const payload = { ok: result.ok, data: result.data, error: result.error, projectVersion: result.projectVersion };
  const text = JSON.stringify(payload);
  return text.length > 9000 ? `${text.slice(0, 9000)}…[truncated]` : text;
}

export function AIPanel() {
  const ai = useAIConfig();
  const [items, setItems] = useState<Item[]>([
    {
      id: 'welcome',
      role: 'notice',
      text: t('我是命令总线上的一个客户端。所有修改都会变成结构化命令，可以单条撤销。当前是离线演示模式，可在设置里接入真实模型。'),
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const apiRef = useRef<ChatMessage[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const past = useEditor((s) => s.past);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [items, approvals]);

  const lastCommandId = past[past.length - 1]?.commandId;

  const push = (item: Omit<Item, 'id'>) => setItems((prev) => [...prev, { ...item, id: uid('m') }]);

  const askApproval = (type: string, payload: unknown, dangerous: boolean) =>
    new Promise<boolean>((resolve) => {
      const id = uid('ap');
      setApprovals((prev) => [
        ...prev,
        {
          id,
          type,
          payload,
          dangerous,
          resolve: (ok: boolean) => {
            setApprovals((prev2) => prev2.filter((a) => a.id !== id));
            resolve(ok);
          },
        },
      ]);
    });

  const executeTool = async (type: string, payload: unknown, requireConfirm: boolean): Promise<CommandResult> => {
    const def = getCommand(type);
    if (!def) {
      return {
        ok: false,
        commandId: uid('cmd'),
        type,
        error: { code: 'NOT_FOUND', message: t('未知命令：{type}', { type }) },
        projectVersion: 0,
        durationMs: 0,
        dryRun: false,
      };
    }
    if (requireConfirm && def.mutating) {
      const ok = await askApproval(type, payload, !!def.dangerous);
      if (!ok) {
        return {
          ok: false,
          commandId: uid('cmd'),
          type,
          error: { code: 'ABORTED', message: t('用户拒绝执行') },
          projectVersion: 0,
          durationMs: 0,
          dryRun: false,
        };
      }
    }
    return dispatch(type, payload, { source: 'ai' });
  };

  const runToolCall = async (call: ToolCall, requireConfirm: boolean): Promise<string> => {
    const type = fromToolName(call.function.name);
    let payload: unknown = {};
    try {
      payload = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      push({ role: 'error', text: t('工具参数不是合法 JSON：{snippet}', { snippet: call.function.arguments.slice(0, 160) }) });
      return JSON.stringify({ ok: false, error: t('参数 JSON 解析失败') });
    }
    const result = await executeTool(type, payload, requireConfirm);
    if (type === 'query.capture' && result.ok) {
      const data = result.data as { dataUrl?: string; width?: number; height?: number };
      if (data?.dataUrl) {
        push({ role: 'tool', text: t('截图 {w}×{h}', { w: data.width ?? 0, h: data.height ?? 0 }), image: data.dataUrl, ok: true, toolType: type, commandId: result.commandId });
        return JSON.stringify({ ok: true, note: t('截图已返回并在界面展示，避免把 base64 塞回上下文。'), width: data.width, height: data.height });
      }
    }
    push({ role: 'tool', text: type, ok: result.ok, toolType: type, commandId: result.commandId });
    return trimResult(result);
  };

  const runDemo = async (text: string) => {
    const state = useEditor.getState();
    const plan = planDemo(text, state.project, state.ui.selectedIds);
    push({ role: 'assistant', text: plan.text });
    if (plan.commands.length === 0) return;
    const commands = plan.commands.map((c) => ({ type: c.type, payload: c.payload }));
    if (ai.config.requireConfirm) {
      const ok = await askApproval(commands.length > 1 ? t('command.batch（{n} 条）', { n: commands.length }) : (commands[0]?.type ?? ''), commands.length > 1 ? { commands, atomic: true } : commands[0]?.payload, false);
      if (!ok) {
        push({ role: 'notice', text: t('已取消，未执行任何命令。') });
        return;
      }
    }
    if (commands.length === 1) {
      const c = commands[0];
      if (!c) return;
      const result = await dispatch(c.type, c.payload, { source: 'ai' });
      push({ role: 'tool', text: c.type, ok: result.ok, toolType: c.type, commandId: result.commandId });
      if (!result.ok) push({ role: 'error', text: result.error?.message ?? t('执行失败') });
      return;
    }
    const result = await dispatch('command.batch', { commands, atomic: true }, { source: 'ai' });
    push({ role: 'tool', text: t('command.batch（{n} 条）', { n: commands.length }), ok: result.ok, toolType: 'command.batch', commandId: result.commandId });
  };

  const runModel = async (text: string) => {
    const cfg = ai.config;
    if (!apiRef.current.length) {
      apiRef.current.push({ role: 'system', content: systemPrompt() });
    } else {
      apiRef.current[0] = { role: 'system', content: systemPrompt() };
    }
    apiRef.current.push({ role: 'user', content: text });

    for (let round = 0; round < 6; round += 1) {
      const res = await chatCompletion(apiRef.current, {
        baseUrl: cfg.baseUrl,
        apiKey: ai.apiKey,
        model: cfg.model,
        temperature: cfg.temperature,
      });
      apiRef.current.push({ role: 'assistant', content: res.content || null, tool_calls: res.toolCalls });
      if (res.content?.trim()) push({ role: 'assistant', text: res.content.trim() });
      if (!res.toolCalls.length) return;
      for (const call of res.toolCalls) {
        const toolResult = await runToolCall(call, cfg.requireConfirm);
        apiRef.current.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.function.name,
          content: toolResult,
        });
      }
    }
    push({ role: 'notice', text: t('已达到单轮 6 次工具调用上限，先停在这里。可以继续追问。') });
  };

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    setInput('');
    push({ role: 'user', text: content });
    setBusy(true);
    try {
      const demo = ai.config.demoMode || !ai.hasKey;
      if (demo) await runDemo(content);
      else await runModel(content);
    } catch (err) {
      push({ role: 'error', text: (err as Error).message });
      pushToast('error', (err as Error).message, 6000);
    } finally {
      setBusy(false);
    }
  };

  const modeLabel = ai.config.demoMode || !ai.hasKey ? t('演示模式') : ai.config.model;

  return (
    <div className="flex h-full flex-col">
      <div className="border-ink-700/70 flex h-9 items-center gap-2 border-b px-2.5">
        <Sparkles size={13} className="text-accent-soft" />
        <span className="text-[11px] font-semibold tracking-[0.08em] text-zinc-300 uppercase">{t('AI 操作')}</span>
        <Badge tone="accent">{modeLabel}</Badge>
        <div className="flex-1" />
        <IconButton size={22} title={t('AI 接入提示词')} onClick={() => updateUi((ui) => { ui.showPrompt = true; })}>
          <Plug size={11} />
        </IconButton>
        <IconButton
          size={22}
          title={t('清空对话')}
          onClick={() => {
            apiRef.current = [];
            setItems([{ id: uid('m'), role: 'notice', text: t('对话已清空。项目状态不受影响。') }]);
          }}
        >
          <Square size={11} />
        </IconButton>
      </div>

      <div ref={scrollRef} className="ml-scroll flex-1 space-y-2 overflow-y-auto p-2.5">
        {items.map((item) => {
          if (item.role === 'tool') {
            const canUndo = item.ok && item.commandId && item.commandId === lastCommandId;
            return (
              <div key={item.id} className="border-ink-700/70 bg-ink-900/70 flex items-center gap-1.5 rounded-md border px-2 py-1.5">
                {item.ok ? <Check size={11} className="text-emerald-400" /> : <X size={11} className="text-rose-400" />}
                <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-zinc-400">{item.text}</span>
                <span className="text-[9.5px] text-zinc-600">{item.ok ? t('已应用') : t('失败')}</span>
                {canUndo && (
                  <button
                    type="button"
                    className="flex items-center gap-0.5 text-[9.5px] text-zinc-500 hover:text-accent-soft"
                    onClick={() => void exec('history.undo', { steps: 1 })}
                  >
                    <CornerUpLeft size={10} /> {t('撤销')}
                  </button>
                )}
              </div>
            );
          }
          if (item.role === 'user') {
            return (
              <div key={item.id} className="flex justify-end">
                <div className="bg-accent/20 max-w-[92%] rounded-lg rounded-br-sm px-2.5 py-1.5 text-[11.5px] whitespace-pre-wrap text-zinc-100">
                  {item.text}
                </div>
              </div>
            );
          }
          if (item.role === 'error') {
            return (
              <div key={item.id} className="flex gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1.5 text-[10.5px] text-rose-200">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                <span className="whitespace-pre-wrap">{item.text}</span>
              </div>
            );
          }
          return (
            <div key={item.id} className={cx('space-y-1', item.role === 'notice' && 'opacity-80')}>
              <div className="text-[11.5px] leading-relaxed whitespace-pre-wrap text-zinc-300">{item.text}</div>
              {item.image && (
                <img src={item.image} alt="capture" className="border-ink-700 w-full rounded-md border" />
              )}
            </div>
          );
        })}

        {approvals.map((a) => (
          <div key={a.id} className="border-accent/40 bg-accent/5 rounded-lg border p-2">
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={12} className={a.dangerous ? 'text-rose-400' : 'text-amber-400'} />
              <span className="text-[11px] font-medium text-zinc-200">{a.dangerous ? t('危险操作，需要二次确认') : t('待确认的命令')}</span>
            </div>
            <pre className="ml-scroll mt-1.5 max-h-32 overflow-auto rounded bg-ink-950 p-1.5 text-[10px] whitespace-pre-wrap text-zinc-400">
              {a.type}
              {'\n'}
              {JSON.stringify(a.payload, null, 2).slice(0, 1200)}
            </pre>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Button size="sm" variant={a.dangerous ? 'danger' : 'accent'} onClick={() => a.resolve(true)}>
                {a.dangerous ? t('确认执行（不可逆）') : t('批准执行')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => a.resolve(false)}>
                {t('拒绝')}
              </Button>
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-1.5 text-[10.5px] text-zinc-500">
            <Loader2 size={11} className="ml-spin" /> {t('正在处理…')}
          </div>
        )}
      </div>

      <div className="border-ink-700/70 border-t p-2">
        <div className="mb-1.5 flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void send(q)}
              className="border-ink-700 text-[10px] text-zinc-500 hover:border-accent/50 hover:text-zinc-200 rounded-full border px-1.5 py-0.5"
            >
              {t(q)}
            </button>
          ))}
        </div>
        <div className="border-ink-700 focus-within:border-accent/60 rounded-lg border bg-ink-900/80">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={2}
            placeholder={t('描述你想做的修改，例如：把标题改成两行，字号 96')}
            className="w-full resize-none bg-transparent px-2 py-1.5 text-[11.5px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
          />
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="text-[9.5px] text-zinc-600">
              {ai.config.requireConfirm ? t('修改需确认') : t('自动执行')} · {t('工具 {n}+ 由注册表生成', { n: 40 })}
            </span>
            <IconButton size={22} active onClick={() => void send(input)} disabled={busy || !input.trim()} title={t('发送 (Enter)')}>
              <Send size={12} />
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}

