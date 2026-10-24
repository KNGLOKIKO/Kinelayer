import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Play, X } from 'lucide-react';
import { exec } from '@/core/commandBus';
import { updateUi, useEditor } from '@/core/store';
import { getRuntimeInfo } from '@/render/codeEngine';
import type { BackgroundLayer, CodeLayer } from '@/core/types';
import { Badge, Button, Field, IconButton, NumberInput, Select, TextInput, Toggle, cx } from './primitives';
import { CodeEditor } from './CodeEditor';
import { useAIConfig } from '@/ai/config';
import { connectBridge, disconnectBridge } from '@/ai/bridgeClient';
import { idbDeleteKV } from '@/persist/idb';

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
  { id: 'data', label: '数据与安全' },
] as const;

export function SettingsDialog() {
  const open = useEditor((s) => s.ui.showSettings);
  const [tab, setTab] = useState<'ai' | 'bridge' | 'data'>('ai');
  const ai = useAIConfig();
  const bridge = useEditor((s) => s.runtime.bridge);
  const [token, setToken] = useState(() => localStorage.getItem('ml.bridge.token') ?? '');
  const [url, setUrl] = useState(() => localStorage.getItem('ml.bridge.url') ?? 'ws://127.0.0.1:2718');

  if (!open) return null;
  const close = () => updateUi((ui) => { ui.showSettings = false; });

  return (
    <Modal title="设置" onClose={close} width={680}>
      <div className="mb-4 flex gap-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx(
              'rounded-md px-2.5 py-1 text-[11.5px] transition',
              tab === t.id ? 'bg-accent/20 text-accent-soft' : 'text-zinc-500 hover:bg-ink-800 hover:text-zinc-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'ai' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-[11px] leading-relaxed text-zinc-500">
            通道 A：浏览器内直连任意 OpenAI 兼容接口（OpenAI / DeepSeek / Moonshot / 本地 vLLM 均可）。
            工具定义由命令注册表自动生成，上下文只传项目摘要，不传任何 base64。
          </div>
          <Field label="Base URL" hint="需以 /v1 结尾（例如 https://api.deepseek.com/v1）">
            <TextInput value={ai.config.baseUrl} onCommit={(v) => void ai.save({ baseUrl: v.trim() })} placeholder="https://api.openai.com/v1" />
          </Field>
          <Field label="API Key" hint="使用 WebCrypto AES-GCM 加密后存 localStorage，密钥存在 IndexedDB">
            <TextInput
              value={ai.config.apiKeyMasked}
              onCommit={(v) => void ai.save({ apiKey: v.trim() })}
              placeholder={ai.hasKey ? '已保存，输入新值可覆盖' : 'sk-...'}
              type="password"
            />
          </Field>
          <Field label="模型">
            <TextInput value={ai.config.model} onCommit={(v) => void ai.save({ model: v.trim() })} placeholder="gpt-4o-mini" />
          </Field>
          <div className="flex items-center gap-4 pt-1">
            <Toggle
              value={ai.config.requireConfirm}
              onChange={(v) => void ai.save({ requireConfirm: v })}
              label="修改类命令需确认后执行"
            />
            <Toggle value={ai.config.demoMode} onChange={(v) => void ai.save({ demoMode: v })} label="离线演示模式（无需 Key）" />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Button variant="accent" onClick={() => void ai.test()}>
              测试连接
            </Button>
            {ai.testState === 'ok' && <span className="flex items-center gap-1 text-[11px] text-emerald-400"><Check size={12} /> 可用</span>}
            {ai.testState === 'loading' && <Loader2 size={12} className="ml-spin text-zinc-500" />}
            {ai.testState === 'fail' && <span className="text-[11px] text-rose-400">{ai.testMessage}</span>}
          </div>
        </div>
      )}

      {tab === 'bridge' && (
        <div className="space-y-3">
          <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-[11px] leading-relaxed text-zinc-500">
            通道 B：先在本机运行 <code className="text-cyan">npm run bridge</code>（WS 127.0.0.1:2718），
            再把终端打印的 token 粘到这里。MCP Server 由 <code className="text-cyan">npm run mcp</code> 启动，
            工具清单从当前页面的命令注册表实时同步。
          </div>
          <Field label="WebSocket 地址">
            <TextInput value={url} onCommit={(v) => { setUrl(v); localStorage.setItem('ml.bridge.url', v); }} />
          </Field>
          <Field label="Token">
            <TextInput value={token} onCommit={(v) => { setToken(v); localStorage.setItem('ml.bridge.token', v.trim()); }} placeholder="bridge 启动时打印的 token" />
          </Field>
          <div className="flex items-center gap-2">
            <Button
              variant="accent"
              onClick={() => {
                connectBridge(url, token);
              }}
            >
              连接桥接
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                disconnectBridge();
              }}
            >
              断开
            </Button>
            <span className="text-[11px] text-zinc-500">
              状态：{bridge.state} · {bridge.message}
            </span>
          </div>
          <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 font-mono text-[10.5px] leading-relaxed text-zinc-500">
            claude_desktop_config.json
            <br />
            {'{'}
            <br />
            &nbsp;&nbsp;&quot;mcpServers&quot;: {'{'}
            <br />
            &nbsp;&nbsp;&nbsp;&nbsp;&quot;motionlayer&quot;: {'{'} &quot;command&quot;: &quot;node&quot;, &quot;args&quot;: [&quot;&lt;绝对路径&gt;/agent-bridge/src/mcp.js&quot;] {'}'}
            <br />
            &nbsp;&nbsp;{'}'}
            <br />
            {'}'}
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div className="space-y-3 text-[11.5px] leading-relaxed text-zinc-400">
          <p>
            项目 JSON 不含任何 base64；图片/视频/字体二进制存在 IndexedDB（库名 <code className="text-cyan">motionlayer</code>）。
            自动保存每 2 秒写入一次，刷新页面会恢复上次的项目。
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void exec('export.json', {})}>
              导出项目 JSON
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json';
                input.onchange = async () => {
                  const file = input.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  await exec('project.load', { data: text });
                };
                input.click();
              }}
            >
              导入项目 JSON
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!confirm('清空自动保存并新建空白项目？IndexedDB 中的资源不会删除。')) return;
                void (async () => {
                  await idbDeleteKV('project.autosave');
                  await exec('project.new', { name: '未命名海报', width: 1080, height: 1440 });
                })();
              }}
            >
              清空自动保存
            </Button>
          </div>
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-[11px] text-amber-200/90">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <AlertTriangle size={12} /> 安全提示
            </div>
            API Key 的加密只能防止「明文落在磁盘上」，不能防御同源 XSS。代码层是同源 JS 沙箱（防误用，不防恶意），
            不要运行来路不明的代码。AI 的修改默认需要确认，危险命令需要二次确认。
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
      title="导出"
      onClose={close}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            关闭
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
            导出 PNG
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
            导出 WebM
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-ink-700 bg-ink-900/60 p-3 text-[11px] leading-relaxed text-zinc-500">
          导出走与预览完全相同的 <code className="text-cyan">renderScene()</code>，只是换了一个离屏 Canvas。
          导出前会 await 所有字体、视频帧与 HTML 栅格化。
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold tracking-wider text-zinc-400">PNG 静帧</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="倍率">
              <Select
                value={String(scale)}
                options={[
                  { value: '1', label: '1× 原始尺寸' },
                  { value: '2', label: '2× 高清' },
                  { value: '3', label: '3× 印刷' },
                  { value: '0.5', label: '0.5× 预览' },
                ]}
                onChange={(v) => setScale(Number(v))}
              />
            </Field>
            <Field label="输出尺寸">
              <div className="border-ink-700 bg-ink-900/60 rounded-md border px-2 py-1 text-[11.5px] text-zinc-400">
                {Math.round(project.width * scale)} × {Math.round(project.height * scale)}
              </div>
            </Field>
          </div>
          <Toggle value={transparent} onChange={setTransparent} label="透明背景（不绘制背景层）" />
        </div>

        <div className="space-y-2">
          <div className="text-[11px] font-semibold tracking-wider text-zinc-400">WebM 视频</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="帧率">
              <NumberInput value={fps} onCommit={setFps} min={1} max={60} suffix="fps" />
            </Field>
            <Field label="码率档位">
              <Select
                value={String(quality)}
                options={[
                  { value: '40', label: '小体积' },
                  { value: '70', label: '标准' },
                  { value: '92', label: '高画质' },
                ]}
                onChange={(v) => setQuality(Number(v))}
              />
            </Field>
          </div>
          <p className="text-[10.5px] leading-relaxed text-zinc-600">
            逐帧手动推帧（captureStream(0) + requestFrame）。导出耗时约等于视频时长，导出期间命令总线仍会串行等待。
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
  可编程 HTML 层
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
      title={`代码编辑器 · ${layer.name}`}
      onClose={close}
      width={980}
      footer={
        <>
          <span className="mr-auto text-[10.5px] text-zinc-600">
            {info.error ? <span className="text-rose-400">{info.error}</span> : '语法错误会在关闭编辑器后逐帧捕获'}
          </span>
          <Button variant="ghost" onClick={close}>
            取消
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
            应用（一条命令）
          </Button>
        </>
      }
    >
      <div className="mb-2 flex items-center gap-2">
        <Badge tone="cyan">{layer.code.engine}</Badge>
        <div className="flex-1" />
        {[
          { label: 'canvas2d 模板', src: CANVAS2D_TEMPLATE, engine: 'canvas2d' as const },
          { label: 'GLSL 模板', src: GLSL_TEMPLATE, engine: 'glsl' as const },
          { label: 'HTML 模板', src: HTML_TEMPLATE, engine: 'html' as const },
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
