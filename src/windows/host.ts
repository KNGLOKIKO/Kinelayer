import type { OpenWindowResult } from '@/core/services';
import { dispatch } from '@/core/commandBus';
import { uid } from '@/core/ids';
import { updateUi, useEditor } from '@/core/store';
import type { SnapshotMessage, ClientToHost, HostToClient, CommandRequest, ResultMessage } from './protocol';
import { CHANNEL_NAME } from './protocol';

interface DocumentPictureInPicture {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
  window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export function buildLayerUrl(layerId: string, hostId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set('layer', layerId);
  url.searchParams.set('host', hostId);
  return url.toString();
}

export function readLayerParams(): { layerId: string | null; hostId: string | null } {
  const url = new URL(window.location.href);
  return { layerId: url.searchParams.get('layer'), hostId: url.searchParams.get('host') };
}

/**
 * Host 端：唯一权威窗口的窗口管理器。
 * - 只广播，不接受 client 的状态写入
 * - client 的每次修改都必须变成一条 command.request，回到命令总线
 */
export class LayerWindowHost {
  readonly hostId: string;
  private channel: BroadcastChannel | null = null;
  private popups = new Map<string, Window>();
  private pip = new Map<string, Window>();
  private seq = 0;
  private snapTimer: number | null = null;
  private lastSnapshotAt = 0;
  private lastTimeAt = 0;

  constructor(hostId: string) {
    this.hostId = hostId;
  }

  init(): void {
    if (this.channel) return;
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (ev: MessageEvent<ClientToHost>) => {
      void this.onMessage(ev.data);
    };
    window.addEventListener('beforeunload', () => this.dispose());
  }

  private async onMessage(msg: ClientToHost): Promise<void> {
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'client.hello') {
      if (msg.wantHostId && msg.wantHostId !== this.hostId) return;
      this.flushSnapshot();
      return;
    }
    if (msg.kind === 'client.bye') {
      if (msg.hostId !== this.hostId) return;
      return;
    }
    if (msg.kind === 'command.request') {
      const req = msg as CommandRequest;
      if (req.hostId !== this.hostId) return;
      const result = await dispatch(req.type, req.payload, { source: 'window' });
      const reply: ResultMessage = {
        kind: 'command.result',
        hostId: this.hostId,
        layerId: req.layerId,
        requestId: req.requestId,
        result,
      };
      this.channel?.postMessage(reply);
    }
  }

  private snapshotMessage(): SnapshotMessage {
    const state = useEditor.getState();
    this.seq += 1;
    return {
      kind: 'snapshot',
      seq: this.seq,
      hostId: this.hostId,
      layerId: '',
      project: state.project,
      time: state.runtime.playhead,
      playing: state.runtime.playing,
      selection: state.ui.selectedIds,
    };
  }

  /** 全量快照节流 50ms */
  requestSnapshot(): void {
    if (this.snapTimer !== null) return;
    this.snapTimer = window.setTimeout(() => {
      this.snapTimer = null;
      this.flushSnapshot();
    }, 50);
  }

  flushSnapshot(): void {
    if (!this.channel) return;
    const msg = this.snapshotMessage();
    this.channel.postMessage(msg satisfies HostToClient);
    this.lastSnapshotAt = performance.now();
  }

  /** 时间广播节流 100ms；client 侧用本地钟做平滑 */
  broadcastTime(time: number, playing: boolean): void {
    if (!this.channel) return;
    const now = performance.now();
    if (now - this.lastTimeAt < 100) return;
    this.lastTimeAt = now;
    this.channel.postMessage({ kind: 'time', hostId: this.hostId, time, playing } satisfies HostToClient);
  }

  private trackPopup(layerId: string, win: Window): void {
    this.popups.set(layerId, win);
    const timer = window.setInterval(() => {
      if (win.closed) {
        window.clearInterval(timer);
        this.popups.delete(layerId);
        updateUi((ui) => {
          ui.floatingWindows = ui.floatingWindows.filter((id) => id !== layerId);
        });
      }
    }, 700);
  }

  async open(layerId: string, mode: 'popup' | 'pip' | 'panel'): Promise<OpenWindowResult> {
    const url = buildLayerUrl(layerId, this.hostId);
    if (mode === 'popup') {
      const existing = this.popups.get(layerId);
      if (existing && !existing.closed) {
        existing.focus();
        this.flushSnapshot();
        return { ok: true, mode: 'popup' };
      }
      const left = Math.max(0, window.screenX + window.outerWidth - 560);
      const top = Math.max(0, window.screenY + 80);
      const win = window.open(
        url,
        `ml-layer-${layerId}`,
        `popup=yes,width=540,height=820,left=${left},top=${top},resizable=yes,scrollbars=yes`,
      );
      if (win) {
        this.trackPopup(layerId, win);
        setTimeout(() => this.flushSnapshot(), 300);
        return { ok: true, mode: 'popup' };
      }
      return { ok: false, mode: 'popup', message: '弹窗被浏览器拦截' };
    }

    if (mode === 'pip') {
      const dpip = window.documentPictureInPicture;
      if (!dpip) return { ok: false, mode: 'pip', message: '当前浏览器不支持 Document Picture-in-Picture' };
      try {
        const pip = await dpip.requestWindow({ width: 560, height: 820 });
        const iframe = pip.document.createElement('iframe');
        iframe.src = url;
        iframe.style.cssText = 'border:0;width:100%;height:100%;display:block;background:#0b0e14';
        pip.document.body.style.margin = '0';
        pip.document.body.style.overflow = 'hidden';
        pip.document.body.appendChild(iframe);
        this.pip.set(layerId, pip);
        pip.addEventListener('pagehide', () => {
          this.pip.delete(layerId);
        });
        setTimeout(() => this.flushSnapshot(), 400);
        return { ok: true, mode: 'pip' };
      } catch (err) {
        return { ok: false, mode: 'pip', message: (err as Error).message };
      }
    }

    updateUi((ui) => {
      ui.floatingWindows = Array.from(new Set([...ui.floatingWindows, layerId]));
    });
    return { ok: true, mode: 'panel' };
  }

  close(layerId: string): void {
    const popup = this.popups.get(layerId);
    if (popup && !popup.closed) popup.close();
    this.popups.delete(layerId);
    const pip = this.pip.get(layerId);
    if (pip) {
      try {
        pip.close();
      } catch {
        /* noop */
      }
      this.pip.delete(layerId);
    }
    updateUi((ui) => {
      ui.floatingWindows = ui.floatingWindows.filter((id) => id !== layerId);
    });
  }

  focus(layerId: string): void {
    const popup = this.popups.get(layerId);
    if (popup && !popup.closed) popup.focus();
    const pip = this.pip.get(layerId);
    if (pip) pip.focus();
  }

  isOpen(layerId: string): boolean {
    const popup = this.popups.get(layerId);
    return !!popup && !popup.closed;
  }

  dispose(): void {
    this.channel?.postMessage({ kind: 'host.bye', hostId: this.hostId } satisfies HostToClient);
    this.channel?.close();
    this.channel = null;
    for (const win of this.popups.values()) {
      if (!win.closed) win.close();
    }
    this.popups.clear();
  }
}

let hostInstance: LayerWindowHost | null = null;

export function getLayerWindowHost(id?: string): LayerWindowHost {
  if (!hostInstance) {
    hostInstance = new LayerWindowHost(id || uid('host'));
    hostInstance.init();
  }
  return hostInstance;
}
