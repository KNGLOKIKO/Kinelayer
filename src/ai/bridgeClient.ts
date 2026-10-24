import { buildToolSchemas } from '@/core/registry';
import { summarizeProject } from '@/core/summary';
import { updateRuntime, useEditor } from '@/core/store';
import { dispatch } from '@/core/commandBus';

let socket: WebSocket | null = null;
let manifestTimer: number | null = null;
let reconnectTimer: number | null = null;
let lastUrl = '';
let lastToken = '';

function send(payload: unknown): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

export function sendManifest(): void {
  const state = useEditor.getState();
  send({
    kind: 'manifest',
    tools: buildToolSchemas(),
    summary: summarizeProject(state.project),
    projectVersion: state.project.version,
    playhead: Math.round(state.runtime.playhead),
    ts: Date.now(),
  });
}

export function connectBridge(url: string, token: string): void {
  lastUrl = url;
  lastToken = token;
  if (socket) {
    socket.onclose = null;
    socket.close();
  }
  updateRuntime((rt) => {
    rt.bridge = { state: 'connecting', message: '连接中…', agents: 0 };
  });
  let ws: WebSocket;
  try {
    const trimmed = url.replace(/\/$/, '');
    ws = new WebSocket(`${trimmed}?token=${encodeURIComponent(token)}&role=host`);
  } catch (err) {
    updateRuntime((rt) => {
      rt.bridge = { state: 'error', message: (err as Error).message, agents: 0 };
    });
    return;
  }
  socket = ws;

  ws.onopen = () => {
    updateRuntime((rt) => {
      rt.bridge = { state: 'connected', message: '已连接本地桥接', agents: rt.bridge.agents };
    });
    sendManifest();
    if (manifestTimer) window.clearInterval(manifestTimer);
    // 周期性刷新 manifest：命令注册表是唯一数据源，改代码即改工具
    manifestTimer = window.setInterval(() => {
      if (socket?.readyState === WebSocket.OPEN) {
        send({ kind: 'ping' });
        sendManifest();
      }
    }, 4000);
  };

  ws.onclose = () => {
    if (manifestTimer) window.clearInterval(manifestTimer);
    manifestTimer = null;
    updateRuntime((rt) => {
      rt.bridge = { state: 'off', message: '未连接', agents: 0 };
    });
  };

  ws.onerror = () => {
    updateRuntime((rt) => {
      rt.bridge = { state: 'error', message: '连接失败：检查 bridge 是否启动、token 是否一致', agents: 0 };
    });
  };

  ws.onmessage = async (ev: MessageEvent<string>) => {
    let msg: {
      kind?: string;
      id?: string;
      type?: string;
      payload?: unknown;
      dryRun?: boolean;
      expectedVersion?: number;
      agents?: number;
    };
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.kind === 'hello') {
      updateRuntime((rt) => {
        rt.bridge = { ...rt.bridge, agents: msg.agents ?? 1 };
      });
      return;
    }
    if (msg.kind === 'command' && msg.id && msg.type) {
      // dryRun / expectedVersion 是 Command 的正式字段，必须原样透传给总线，
      // 否则外部 Agent 的「试算」会真的落盘、乐观锁也形同虚设。
      const result = await dispatch(msg.type, msg.payload ?? {}, {
        source: 'agent',
        dryRun: msg.dryRun === true,
        expectedVersion: typeof msg.expectedVersion === 'number' ? msg.expectedVersion : undefined,
      });
      send({ kind: 'command.result', id: msg.id, result });
    }
  };
}

export function disconnectBridge(): void {
  if (manifestTimer) window.clearInterval(manifestTimer);
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  manifestTimer = null;
  if (socket) {
    socket.close();
    socket = null;
  }
  updateRuntime((rt) => {
    rt.bridge = { state: 'off', message: '未连接', agents: 0 };
  });
}

export function reconnectBridge(): void {
  if (lastUrl && lastToken) {
    reconnectTimer = window.setTimeout(() => connectBridge(lastUrl, lastToken), 500);
  }
}

/** 项目变化时同步一次摘要，让 Agent 看到的上下文跟手 */
export function subscribeBridgeSync(): () => void {
  let lastVersion = -1;
  return useEditor.subscribe((s) => {
    if (s.project.version !== lastVersion) {
      lastVersion = s.project.version;
      if (socket?.readyState === WebSocket.OPEN) sendManifest();
    }
  });
}
