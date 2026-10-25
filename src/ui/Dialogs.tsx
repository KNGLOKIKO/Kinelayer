import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Play, X } from 'lucide-react';
import { exec } from '@/core/commandBus';
import { updateUi, useEditor } from '@/core/store';
import { getRuntimeInfo } from '@/render/codeEngine';
import type { BackgroundLayer, CodeLayer } from '@/core/types';
import { Badge, Button, Field, IconButton, NumberInput, Select, TextInput, Toggle, cx } from './primitives';
import { CodeEditor } from './CodeEditor';
import { useAIConfig } from '@/ai/config';
import { applyLocale } from '@/i18n/apply';
import { LOCALES } from '@/i18n';
import { connectBridge, disconnectBridge } from '@/ai/bridgeClient';
import { idbDeleteKV } from '@/persist/idb';
import { KINELAYER_FILE_ACCEPT } from '@/core/projectFile';
import { lsGet, lsSet } from '@/persist/storage';

import { AgentAccessPanel } from './AgentAccessPanel';
import { t } from '@/i18n';
/* ------------------------------------------------------------------ modal */

export function Modal({
  title,
  onClose,
  children,
  width = 720,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className="border-ink-600 bg-ink-850 animate-fadeIn flex max-h-[86vh] w-full flex-col overflow-hidden rounded-xl border shadow-pop"
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
        {footer && <div className="border-ink-700 flex shrink-0 items-center justify-end gap-2 border-t px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- settings */

const TABS = [
  { id: 'ai', label: 'AI 通道' },
  { id: 'bridge', label: 'Agent 桥接' },
  { id: 'agent', label: '桌面 Agent' },
  { id: 'data', label: '数据与安全' }, // label 存中文，渲染时 t()
] as const;

type SettingsTab = (typeof TABS)[number]['id'];

export function SettingsDialog() {
  const open = useEditor((s) => s.ui.showSettings);
  const [tab, setTab] = useState<SettingsTab>('ai');
  const ai = useAIConfig();
  const bridge = useEditor((s) => s.runtime.bridge);
  const locale = useEditor((s) => s.ui.locale);
  const [token, setToken] = useState(() => lsGet('bridge.token') ?? '');
  const [url, setUrl] = useState(() => lsGet('bridge.url') ?? 'ws://127.0.0.1:2718');

  if (!open) return null;
  const close = () => updateUi((ui) => { ui.showSettings = false; });

  return (
    <Modal title={t('设置')} onClose={close} width={tab === 'agent' ? 880 : 680}>
      <div className="mb-4 flex gap-1">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={cx(
              'rounded-md px-2.5 py-1 text-[11.5px] transition',
              tab === item.id ? 'bg-accent/20 text-accent-soft' : 'text-zinc-500 hover:bg-ink-800 hover:text-zinc-200',
            )}
          >
            {t(item.label)}
          </button>
        ))}
      </div>

      {tab === 'ai' && (
        <div className="space-y-3">
          <Field label={t('界面语言')} hint={t('只影响界面文案与导出文件名；项目数据不受影响。')}>
            <div className="flex gap-1">
              {LOCALES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => applyLocale(l.id)}
                  className={cx(
                    'rounded-md border px-2 py-1 text-[11.5px] transition',
                    locale === l.id ? 'border-accent/60 bg-accent/20 text-accent-soft' : 'border-ink-700 text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </Field>
          <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-[11px] leading-relaxed text-zinc-500">
            {t('通道 A：浏览器内直连任意 OpenAI 兼容接口（OpenAI / DeepSeek / Moonshot / 本地 vLLM 均可）。 工具定义由命令注册表自动生成，上下文只传项目摘要，不传任何 base64。')}
          </div>
          <Field label="Base URL" hint={t('需以 /v1 结尾（例如 https://api.deepseek.com/v1）')}>
            <TextInput value={ai.config.baseUrl} onCommit={(v) => void ai.save({ baseUrl: v.trim() })} placeholder="https://api.openai.com/v1" />
          </Field>
          <Field label="API Key" hint={t('使用 WebCrypto AES-GCM 加密后存 localStorage，密钥存在 IndexedDB')}>
            <TextInput
              value={ai.config.apiKeyMasked}
              onCommit={(v) => void ai.save({ apiKey: v.trim() })}
              placeholder={ai.hasKey ? t('已保存，输入新值可覆盖') : 'sk-...'}
              type="password"
            />
          </Field>
          <Field label={t('模型')}>
            <TextInput value={ai.config.model} onCommit={(v) => void ai.save({ model: v.trim() })} placeholder="gpt-4o-mini" />
          </Field>
          <div className="flex items-center gap-4 pt-1">
            <Toggle
              value={ai.config.requireConfirm}
              onChange={(v) => void ai.save({ requireConfirm: v })}
              label={t('修改类命令需确认后执行')}
            />
            <Toggle value={ai.config.demoMode} onChange={(v) => void ai.save({ demoMode: v })} label={t('离线演示模式（无需 Key）')} />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="accent" onClick={() => void ai.test()}>
              {t('测试连接')}
            </Button>
            {ai.testState === 'ok' && <span className="flex items-center gap-1 text-[11px] text-emerald-400"><Check size={12} /> {t('可用')}</span>}
            {ai.testState === 'loading' && <Loader2 size={12} className="ml-spin text-zinc-500" />}
            {ai.testState === 'fail' && <span className="text-[11px] text-rose-400">{ai.testMessage}</span>}
          </div>
        </div>
      )}

      {tab === 'bridge' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-[11px] leading-relaxed text-zinc-500">
            {t('通道 B：先在本机运行')} <code className="text-cyan">npm run bridge</code>{t('（WS 127.0.0.1:2718）， 再把终端打印的 token 粘到这里。MCP Server 由')} <code className="text-cyan">npm run mcp</code> {t('启动， 工具清单从当前页面的命令注册表实时同步。')}
          </div>
          <Field label={t('WebSocket 地址')}>
            <TextInput value={url} onCommit={(v) => { setUrl(v); lsSet('bridge.url', v); }} />
          </Field>
          <Field label="Token">
            <TextInput value={token} onCommit={(v) => { setToken(v); lsSet('bridge.token', v.trim()); }} placeholder={t('bridge 启动时打印的 token')} />
          </Field>
          <div className="flex items-center gap-2">
            <Button
              variant="accent"
              onClick={() => {
                connectBridge(url, token);
              }}
            >
              {t('连接桥接')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                disconnectBridge();
              }}
            >
              {t('断开')}
            </Button>
            <span className="text-[11px] text-zinc-500">
              {t('状态：{state} · {message}', { state: bridge.state, message: bridge.message || t('未连接') })}
            </span>
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 font-mono text-[10.5px] leading-relaxed text-zinc-500">
            claude_desktop_config.json
            <br />
            {'{'}
            <br />
            &nbsp;&nbsp;&quot;mcpServers&quot;: {'{'}
            <br />
            &nbsp;&nbsp;&nbsp;&nbsp;&quot;kinelayer&quot;: {'{'} &quot;command&quot;: &quot;node&quot;, &quot;args&quot;: [&quot;&lt;绝对路径&gt;/agent-bridge/src/mcp.js&quot;] {'}'}
            <br />
            &nbsp;&nbsp;{'}'}
            <br />
            {'}'}
          </div>
        </div>
      )}

      {tab === 'agent' && <AgentAccessPanel />}

      {tab === 'data' && (
        <div className="space-y-3 text-[11.5px] leading-relaxed text-zinc-400">
          <p>
            {t('工程包不含任何 base64；图片/视频/字体二进制存在 IndexedDB 的 kinelayer 库。自动保存每 1.6 秒写入一次，刷新页面会恢复上次的项目。')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void exec('export.json', {})}>
              {t('导出工程包 .kly')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = KINELAYER_FILE_ACCEPT;
                input.onchange = async () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  await exec('project.load', { data: text });
                };
                input.click();
              }}
            >
              {t('导入工程包 .kly')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!confirm(t('清空自动保存并新建空白项目？IndexedDB 中的资源不会删除。'))) return;
                void (async () => {
                  await idbDeleteKV('project.autosave');
                  await exec('project.new', { name: t('未命名海报'), width: 1080, height: 1440 });
                })();
              }}
            >
              {t('清空自动保存')}
            </Button>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200/90">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <AlertTriangle size={12} /> {t('安全提示')}
            </div>
            {t('API Key 的加密只能防止「明文落在磁盘上」，不能防御同源 XSS。代码层是同源 JS 沙箱（防误用，不防恶意）， 不要运行来路不明的代码。AI 的修改默认需要确认，危险命令需要二次确认。')}
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ export */

export function ExportDialog() {
  const open = useEditor((s) => s.ui.showExport);
  const project = useEditor((s) => s.project);
  const progress = useEditor((s) => s.runtime.exportProgress);
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [fps, setFps] = useState(project.fps);
  const [quality, setQuality] = useState(75);
  const [busy, setBusy] = useState<'png' | 'webm' | null>(null);

  if (!open) return null;
  const close = () => updateUi((ui) => { ui.showExport = false; });

  return (
    <Modal
      title={t('导出')}
      onClose={close}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('关闭')}
          </Button>
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={async () => {
              setBusy('png');
              await exec('export.png', { scale, transparent });
              setBusy(null);
            }}
          >
            {busy === 'png' ? <Loader2 size={12} className="ml-spin" /> : null}
            {t('导出 PNG')}
          </Button>
          <Button
            variant="accent"
            disabled={!!busy}
            onClick={async () => {
              setBusy('webm');
              await exec('export.webm', { fps, quality });
              setBusy(null);
            }}
          >
            {busy === 'webm' ? <Loader2 size={12} className="ml-spin" /> : <Play size={12} />}
            {t('导出 WebM')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-[11px] leading-relaxed text-zinc-500">
          {t('导出走与预览完全相同的 renderScene()，只是换了一个离屏 Canvas；导出前会 await 所有字体、视频帧与 HTML 栅格化。')}
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold tracking-wider text-zinc-400">{t('PNG 静帧')}</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('倍率')}>
              <Select
                value={String(scale)}
                options={[
                  { value: '1', label: t('1× 原始尺寸') },
                  { value: '2', label: t('2× 高清') },
                  { value: '3', label: t('3× 印刷') },
                  { value: '0.5', label: t('0.5× 预览') },
                ]}
                onChange={(v) => setScale(Number(v))}
              />
            </Field>
            <Field label={t('输出尺寸')}>
              <div className="border-ink-700 bg-ink-900/60 rounded-md border px-2 py-1 text-[11.5px] text-zinc-400">
                {Math.round(project.width * scale)} × {Math.round(project.height * scale)}
              </div>
            </Field>
          </div>
          <Toggle value={transparent} onChange={setTransparent} label={t('透明背景（不绘制背景层）')} />
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold tracking-wider text-zinc-400">{t('WebM 视频')}</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t('帧率')}>
              <NumberInput value={fps} onCommit={setFps} min={1} max={60} suffix="fps" />
            </Field>
            <Field label={t('码率档位')}>
              <Select
                value={String(quality)}
                options={[
                  { value: '40', label: t('小体积') },
                  { value: '70', label: t('标准') },
                  { value: '92', label: t('高画质') },
                ]}
                onChange={(v) => setQuality(Number(v))}
              />
            </Field>
          </div>
          <p className="text-[10.5px] leading-relaxed text-zinc-600">
            {t('逐帧手动推帧（captureStream(0) + requestFrame）。导出耗时约等于视频时长，导出期间命令总线仍会串行等待。')}
          </p>
        </div>

        {progress.active && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10.5px] text-zinc-500">
              <span>{progress.label}</span>
              <span>{Math.round(progress.progress * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
              <div className="from-accent to-cyan h-full bg-gradient-to-r transition-all" style={{ width: `${progress.progress * 100}%` }} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- code modal */

const CANVAS2D_TEMPLATE = `// ctx / api / params / width / height / time / frame / state
const t = time * 0.001;
ctx.clearRect(0, 0, width, height);

for (let i = 0; i < 6; i++) {
  const y = height * (0.2 + i * 0.12) + Math.sin(t + i) * 24;
  ctx.strokeStyle = i % 2 ? 'rgba(34,211,238,.55)' : 'rgba(124,92,255,.65)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, y);
  for (let x = 0; x <= width; x += 12) {
    ctx.lineTo(x, y + api.noise(x * 0.01 + t, i) * 40 - 20);
  }
  ctx.stroke();
}
`;

const GLSL_TEMPLATE = `void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float d = length(uv - 0.5);
  float ring = sin(d * 26.0 - u_time * 2.0) * 0.5 + 0.5;
  vec3 col = mix(vec3(0.10, 0.07, 0.22), vec3(0.48, 0.36, 1.0), ring * (1.0 - d));
  gl_FragColor = vec4(col, 1.0 - d);
}
`;

const HTML_TEMPLATE = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;
  background:linear-gradient(135deg,#101828,#2a1147);color:#fff;font:600 42px/1.2 system-ui;">
  {t('可编程 HTML 层')}
</div>`;

export function CodeEditorDialog() {
  const layerId = useEditor((s) => s.ui.codeEditorFor);
  const layer = useEditor((s) => s.project.layers.find((l) => l.id === s.ui.codeEditorFor)) as
    | CodeLayer
    | BackgroundLayer
    | undefined;
  const [draft, setDraft] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const value = useMemo(() => {
    if (!layer) return '';
    return draft ?? layer.code.source;
  }, [layer, draft, nonce]);

  if (!layerId || !layer) return null;

  const close = () => {
    setDraft(null);
    updateUi((ui) => { ui.codeEditorFor = null; });
  };

  const info = getRuntimeInfo(layer.id);
  const isBg = layer.type === 'background';

  return (
    <Modal
      title={t('代码编辑器 · {name}', { name: layer.name })}
      onClose={close}
      width={980}
      footer={
        <>
          <span className="mr-auto text-[10.5px] text-zinc-600">
            {info.error ? <span className="text-rose-400">{info.error}</span> : t('语法错误会在关闭编辑器后逐帧捕获')}
          </span>
          <Button variant="ghost" onClick={close}>
            {t('取消')}
          </Button>
          <Button
            variant="accent"
            onClick={async () => {
              if (isBg) await exec('background.setCode', { source: value });
              else await exec('code.setSource', { id: layer.id, source: value });
              setDraft(null);
              close();
            }}
          >
            {t('应用（一条命令）')}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex items-center gap-2">
        <Badge tone="cyan">{layer.code.engine}</Badge>
        <div className="flex-1" />
        {[
          { label: t('canvas2d 模板'), src: CANVAS2D_TEMPLATE, engine: 'canvas2d' as const },
          { label: t('GLSL 模板'), src: GLSL_TEMPLATE, engine: 'glsl' as const },
          { label: t('HTML 模板'), src: HTML_TEMPLATE, engine: 'html' as const },
        ].map((t) => (
          <Button
            key={t.label}
            size="sm"
            variant="outline"
            onClick={async () => {
              if (isBg) {
                await exec('background.setCode', { engine: t.engine, source: t.src });
              } else {
                await exec('code.setEngine', { id: layer.id, engine: t.engine });
                await exec('code.setSource', { id: layer.id, source: t.src });
              }
              setDraft(t.src);
              setNonce((n) => n + 1);
            }}
          >
            {t.label}
          </Button>
        ))}
      </div>
      <div className="h-[52vh]">
        <CodeEditor value={value} onChange={setDraft} />
      </div>
    </Modal>
  );
}
