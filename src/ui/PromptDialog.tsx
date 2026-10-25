import { useMemo, useState } from 'react';
import { AlertTriangle, Check, ClipboardCheck, Copy, Download, Play, Plug, RefreshCw, Wand2 } from 'lucide-react';
import { dispatch } from '@/core/commandBus';
import { getCommand, listCommands } from '@/core/registry';
import { pushToast, updateUi, useEditor } from '@/core/store';
import { buildChatPrompt, buildMarkdownBundle, buildMcpPrompt, buildToolsJson, parsePlan, type ParsedPlan, type PromptVariant } from '@/ai/prompt';
import { Badge, Button, IconButton, Toggle, cx } from './primitives';
import { Modal } from './Dialogs';

import { clauseSep, listSep, t } from '@/i18n';
const TABS: { id: PromptVariant; label: string; hint: string }[] = [
  { id: 'chat', label: t('通用大模型'), hint: t('复制提示词 → 粘到任意对话框 → 把回复粘回下面的执行区') },
  { id: 'mcp', label: t('MCP 客户端'), hint: t('Claude Desktop / Cursor 直连本机 bridge，模型可自己调工具') },
  { id: 'tools', label: 'Function Calling', hint: t('给自建 Agent 用的 tools 数组（与 MCP 同源，来自命令注册表）') },
];

const SAMPLE = JSON.stringify(
  {
    reply: t('加了一个标题，并让它 800ms 淡入。'),
    commands: [
      {
        type: 'layer.create',
        payload: {
          type: 'text',
          text: t('这一行是 AI 加的'),
          x: 120,
          y: 1120,
          width: 840,
          height: 120,
          textStyle: { fontSize: 56, fontWeight: 700, color: '#7CF7D4', align: 'left' },
        },
      },
    ],
  },
  null,
  2,
);

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // http 或权限被拒时的兜底：临时 textarea + execCommand
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
  }
}

export function PromptDialog() {
  const open = useEditor((s) => s.ui.showPrompt);
  const project = useEditor((s) => s.project);
  const [tab, setTab] = useState<PromptVariant>('chat');
  const [includeProject, setIncludeProject] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [raw, setRaw] = useState(SAMPLE);
  const [plan, setPlan] = useState<ParsedPlan | null>(null);
  const [parseError, setParseError] = useState('');
  const [running, setRunning] = useState(false);

  // nonce 只用于「重新生成」时强制重算，project 变了也要重算
  const text = useMemo(() => {
    void nonce;
    const opts = { includeProject, project };
    if (tab === 'chat') return buildChatPrompt(opts);
    if (tab === 'mcp') return buildMcpPrompt(opts);
    return buildToolsJson();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, includeProject, project, nonce]);

  if (!open) return null;
  const close = () => updateUi((ui) => { ui.showPrompt = false; });

  const current = TABS.find((item) => item.id === tab) as (typeof TABS)[number];
  const commandCount = listCommands().length;

  const doCopy = async () => {
    await copyText(text);
    pushToast('success', t('提示词已复制（{n} 字符）', { n: text.length }));
  };

  const doDownload = () => {
    const md = buildMarkdownBundle({ includeProject, project });
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'motionlayer-ai-prompt.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    pushToast('success', t('已下载 motionlayer-ai-prompt.md'));
  };

  const doParse = () => {
    try {
      const parsed = parsePlan(raw);
      const unknown = [...new Set(parsed.commands.filter((c) => !getCommand(c.type)).map((c) => c.type))];
      setPlan(parsed);
      setParseError(unknown.length ? t('这些命令不在注册表里，执行会失败：{list}', { list: unknown.join(listSep()) }) : '');
    } catch (err) {
      setPlan(null);
      setParseError((err as Error).message);
    }
  };

  const doExecute = async () => {
    if (!plan) return;
    const unknown = plan.commands.filter((c) => !getCommand(c.type));
    if (unknown.length) {
      pushToast('error', t('含未知命令：{list}', { list: unknown.map((c) => c.type).join(listSep()) }), 5000);
      return;
    }
    const dangerous = plan.commands.filter((c) => getCommand(c.type)?.dangerous);
    const mutating = plan.commands.filter((c) => getCommand(c.type)?.mutating);
    if (dangerous.length && !window.confirm(t('其中 {n} 条是危险命令（{list}），确认执行？', { n: dangerous.length, list: dangerous.map((c) => c.type).join(listSep()) }))) {
      return;
    }
    setRunning(true);
    try {
      const result = await dispatch('command.batch', {
        commands: plan.commands.map((c) => ({ type: c.type, payload: c.payload })),
        atomic: true,
      }, { source: 'user' });
      if (result.ok) {
        pushToast('success', t('已执行 {n} 条命令（{m} 条修改），可一次撤销', { n: plan.commands.length, m: mutating.length }));
        setPlan(null);
        setRaw('');
      } else {
        pushToast('error', result.error?.message ?? t('执行失败'), 6000);
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      title={t('AI 接入提示词')}
      onClose={close}
      width={860}
      footer={
        <>
          <span className="mr-auto text-[10.5px] text-zinc-600">
            {t('{n} 条命令由注册表自动导出 · 改代码即改提示词', { n: commandCount })}
          </span>
          <Button variant="outline" onClick={doDownload}>
            <Download size={12} /> {t('下载 .md')}
          </Button>
          <Button variant="accent" onClick={() => void doCopy()}>
            <Copy size={12} /> {t('复制提示词')}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cx(
                'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11.5px] transition',
                tab === t.id ? 'bg-accent/20 text-accent-soft' : 'text-zinc-500 hover:bg-ink-800 hover:text-zinc-200',
              )}
            >
              <Plug size={11} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Toggle value={includeProject} onChange={setIncludeProject} label={t('附带当前项目上下文')} />
        <IconButton size={24} title={t('重新生成')} onClick={() => setNonce((n) => n + 1)}>
          <RefreshCw size={12} />
        </IconButton>
      </div>

      <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-zinc-500">
        <Badge tone="cyan">{t('用法')}</Badge>
        {current.hint}
      </div>

      <pre className="ml-scroll border-ink-700 bg-ink-950/80 max-h-[38vh] overflow-auto rounded-lg border p-3 font-mono text-[10.5px] leading-[1.65] whitespace-pre-wrap text-zinc-300 select-text">
        {text}
      </pre>

      {tab === 'chat' && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.08em] text-zinc-400 uppercase">{t('把模型回复粘回这里')}</span>
            <Badge tone="neutral">{t('支持代码围栏 / 裸 JSON / 单条命令')}</Badge>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => { setRaw(SAMPLE); setPlan(null); setParseError(''); }}>
              <Wand2 size={11} /> {t('示例')}
            </Button>
            <Button size="sm" variant="outline" onClick={doParse}>
              <ClipboardCheck size={11} /> {t('解析')}
            </Button>
          </div>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            spellCheck={false}
            placeholder={'{"reply":"...","commands":[{"type":"layer.create","payload":{...}}]}'}
            className="ml-scroll border-ink-700 bg-ink-900/80 h-[110px] w-full resize-y rounded-md border p-2 font-mono text-[11px] leading-relaxed text-zinc-200 outline-none focus:border-accent/60"
          />

          {(plan || parseError) && (
            <div className="mt-2 rounded-lg border border-ink-700 bg-ink-900/60 p-2.5">
              {parseError ? (
                <div className="flex items-start gap-1.5 text-[11px] text-amber-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{parseError}</span>
                </div>
              ) : (
                plan && (
                  <>
                    {plan.reply && <div className="mb-1.5 text-[11px] text-zinc-300">{t('模型说明：{reply}', { reply: plan.reply })}</div>}
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {plan.commands.map((c, i) => {
                        const def = getCommand(c.type);
                        return (
                          <Badge key={`${c.type}-${i}`} tone={def?.dangerous ? 'danger' : def?.mutating ? 'accent' : 'neutral'}>
                            {c.type}
                          </Badge>
                        );
                      })}
                    </div>
                    {plan.warnings.length > 0 && <div className="text-[10.5px] text-zinc-500">{plan.warnings.join(clauseSep())}</div>}
                    <div className="mt-2 flex items-center gap-2">
                      <Button variant="accent" size="sm" disabled={running} onClick={() => void doExecute()}>
                        <Play size={11} /> {running ? t('执行中…') : t('执行 {n} 条（一个撤销点）', { n: plan.commands.length })}
                      </Button>
                      <span className="text-[10px] text-zinc-600">{t('全部通过校验才会生效；任一条失败会整体回滚')}</span>
                    </div>
                  </>
                )
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'mcp' && (
        <div className="mt-3 space-y-2 text-[11px] leading-relaxed text-zinc-500">
          <div className="flex items-start gap-1.5">
            <Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />
            <span>
              {t('桥接只监听 127.0.0.1，令牌在 agent-bridge/.token；MCP 侧工具清单与上面的提示词同源，在编辑器里新增命令后客户端重新拉一次 tools/list 即可。')}
            </span>
          </div>
          <div className="flex items-start gap-1.5">
            <Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />
            <span>{t('配置片段在仓库 agent-bridge/claude-desktop-config.json，把路径换成你本机的绝对路径。')}</span>
          </div>
        </div>
      )}

      {tab === 'tools' && (
        <div className="mt-3 text-[11px] leading-relaxed text-zinc-500">
          {t('这是 OpenAI 兼容接口需要的 tools 数组，直接放进请求体的 tools 字段；模型返回 tool_calls 后，把 name 里的 __ 换回 . 就是命令类型。')}
        </div>
      )}
    </Modal>
  );
}
