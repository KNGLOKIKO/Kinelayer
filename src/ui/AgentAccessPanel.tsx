import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, Download, Plug, RefreshCw, ShieldCheck, Terminal } from 'lucide-react';
import { listCommands } from '@/core/registry';
import { pushToast, useEditor } from '@/core/store';
import { buildDesktopAgentPrompt } from '@/ai/prompt';
import { Badge, Button, IconButton, Toggle, cx } from './primitives';
import { copyText, downloadText } from './clipboard';
import { t } from '@/i18n';

const AGENT_TAB_ID = 'agent' as const;
export { AGENT_TAB_ID };

/** 桥接地址与协议细节写在一处：改端口只改这里 */
const BRIDGE = {
  ws: 'ws://127.0.0.1:2718',
  http: 'http://127.0.0.1:2718',
  tokenHeader: 'x-ml-token',
} as const;

const FLOW = [
  { zh: '读清单', cmd: 'GET /manifest' },
  { zh: '试算', cmd: '{ "dryRun": true }' },
  { zh: '提交', cmd: '{ "expectedVersion": 12 }' },
  { zh: '读回', cmd: 'query.project' },
];

/** 提示词的结构索引：让用户一眼看清这段文本讲了哪几件事 */
const OUTLINE = [
  '0 定位',
  '1 接入',
  '2 能力',
  '3 契约',
  '4 边界',
  '5 危险',
  '6 错误',
  '7 话术',
];

export function AgentAccessPanel() {
  const bridge = useEditor((s) => s.runtime.bridge);
  const project = useEditor((s) => s.project);
  const [includeProject, setIncludeProject] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [copied, setCopied] = useState(false);

  const commands = useMemo(() => listCommands(), []);
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of commands) map.set(c.category, (map.get(c.category) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [commands]);
  const dangerous = useMemo(() => commands.filter((c) => c.dangerous).map((c) => c.type), [commands]);

  // nonce 只是让「重新生成」能强制刷新时间戳
  const prompt = useMemo(
    () => buildDesktopAgentPrompt({ includeProject, project }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [includeProject, project, nonce],
  );

  const connected = bridge.state === 'connected';

  return (
    <div className="space-y-3">
      {/* ── 状态条 ───────────────────────────────────────── */}
      <div className="border-ink-700 bg-ink-900/60 flex items-center gap-2 rounded-lg border px-3 py-2">
        <span
          className={cx(
            'h-1.5 w-1.5 rounded-full',
            connected ? 'bg-emerald-400' : bridge.state === 'error' ? 'bg-rose-500' : 'bg-zinc-600',
          )}
        />
        <span className="text-[11px] text-zinc-300">
          {connected ? t('桥接已连接') : bridge.state === 'error' ? t('桥接出错') : t('桥接未连接')}
        </span>
        <span className="font-mono text-[10px] text-zinc-600">{BRIDGE.ws}</span>
        {connected && bridge.agents > 0 && (
          <Badge tone="accent">{t('{n} 个 Agent 在线', { n: bridge.agents })}</Badge>
        )}
        <div className="flex-1" />
        <Badge tone="neutral">{t('{n} 条命令', { n: commands.length })}</Badge>
      </div>

      {/* ── 三张说明卡 ────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-2">
        <div className="border-ink-700 bg-ink-900/50 rounded-lg border p-2.5">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-zinc-200">
            <Plug size={11} className="text-accent-soft" /> {t('怎么接进来')}
          </div>
          <ul className="space-y-1 text-[10px] leading-relaxed text-zinc-500">
            <li>{t('MCP：npm run bridge + npm run mcp，客户端读 Claude Desktop 配置')}</li>
            <li>{t('直连：HTTP / WebSocket，令牌放 {header} 头', { header: BRIDGE.tokenHeader })}</li>
            <li>{t('工具名 = 命令类型把 . 换成 __（layer.create → layer__create）')}</li>
          </ul>
        </div>
        <div className="border-ink-700 bg-ink-900/50 rounded-lg border p-2.5">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-zinc-200">
            <Terminal size={11} className="text-cyan" /> {t('能操作什么')}
          </div>
          <div className="flex flex-wrap gap-1">
            {categories.slice(0, 8).map(([name, n]) => (
              <span key={name} className="bg-ink-800 rounded px-1 py-0.5 text-[9.5px] text-zinc-400">
                {t(name)} · {n}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[9.5px] leading-relaxed text-zinc-600">
            {t('共 {n} 条，含 {d} 条危险命令', { n: commands.length, d: dangerous.length })}
          </p>
        </div>
        <div className="border-ink-700 bg-ink-900/50 rounded-lg border p-2.5">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-zinc-200">
            <ShieldCheck size={11} className="text-emerald-400" /> {t('不能做什么')}
          </div>
          <ul className="space-y-1 text-[10px] leading-relaxed text-zinc-500">
            <li>{t('读不到 API Key 与素材二进制，也碰不到本地文件系统')}</li>
            <li>{t('桥接只监听 127.0.0.1，不对外网开放')}</li>
            <li>{t('危险命令必须由你在界面上确认，Agent 不能代点')}</li>
          </ul>
        </div>
      </div>

      {/* ── 调用顺序 ─────────────────────────────────────── */}
      <div className="border-ink-700 bg-ink-900/40 rounded-lg border p-2.5">
        <div className="mb-1.5 text-[10.5px] font-semibold text-zinc-300">{t('推荐调用顺序')}</div>
        <div className="flex items-center gap-1">
          {FLOW.map((step, i) => (
            <div key={step.cmd} className="flex min-w-0 flex-1 items-center gap-1">
              <div className="border-ink-700 min-w-0 flex-1 rounded border px-1.5 py-1">
                <div className="text-[9.5px] text-zinc-400">
                  {i + 1}. {t(step.zh)}
                </div>
                <div className="mt-0.5 truncate font-mono text-[9px] text-zinc-500" title={step.cmd}>
                  {step.cmd}
                </div>
              </div>
              {i < FLOW.length - 1 && <span className="shrink-0 text-[9px] text-zinc-700">→</span>}
            </div>
          ))}
        </div>
      </div>

      {/* ── 提示词正文 ───────────────────────────────────── */}
      <div className="border-ink-700 bg-ink-900/60 rounded-lg border">
        <div className="border-ink-700/70 flex items-center gap-2 border-b px-2.5 py-1.5">
          <span className="text-[11px] font-semibold text-zinc-200">{t('桌面 Agent 接入提示词')}</span>
          <Badge tone="neutral">{t('{n} 字符', { n: prompt.length })}</Badge>
          <span className="text-[9.5px] text-zinc-600">{t('由命令注册表生成，随代码自动更新')}</span>
          <div className="flex-1" />
          <Toggle value={includeProject} onChange={setIncludeProject} label={t('带上当前项目')} />
          <IconButton size={22} title={t('重新生成')} onClick={() => setNonce((n) => n + 1)}>
            <RefreshCw size={11} />
          </IconButton>
          <IconButton
            size={22}
            title={t('下载 .md')}
            onClick={() => {
              downloadText('motionlayer-desktop-agent.md', prompt);
              pushToast('success', t('已下载 motionlayer-desktop-agent.md'));
            }}
          >
            <Download size={11} />
          </IconButton>
          <Button
            size="sm"
            variant="accent"
            onClick={async () => {
              await copyText(prompt);
              setCopied(true);
              pushToast('success', t('提示词已复制（{n} 字符）', { n: prompt.length }));
              setTimeout(() => setCopied(false), 1800);
            }}
          >
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? t('已复制') : t('复制全部')}
          </Button>
        </div>
        <div className="border-ink-700/50 flex flex-wrap items-center gap-1 border-b px-2.5 py-1">
          <span className="text-[9px] tracking-wider text-zinc-600">{t('结构')}</span>
          {OUTLINE.map((item, i) => (
            <span
              key={item}
              className="bg-ink-800/80 rounded px-1 py-0.5 text-[9px] text-zinc-500"
              title={t('第 {i} 节', { i })}
            >
              {t(item)}
            </span>
          ))}
        </div>
        <pre className="ml-scroll max-h-[220px] overflow-auto px-3 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-zinc-400">
          {prompt}
        </pre>
      </div>

      <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 text-[10px] leading-relaxed text-amber-200/80">
        <AlertTriangle size={11} className="mt-0.5 shrink-0 text-amber-400" />
        <span>
          {t(
            '把这段提示词交给本机 Agent 工具时，先确认它只连 127.0.0.1、只走命令总线。提示词里已写明：不能读密钥、不能碰文件系统、危险操作必须由你确认。',
          )}
        </span>
      </div>
    </div>
  );
}
