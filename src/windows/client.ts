import type { CommandResult } from '@/core/registry';
import type { CommandRequest, ClientToHost, HostToClient, SnapshotMessage, TimeMessage } from './protocol';
import { CHANNEL_NAME } from './protocol';
import { uid } from '@/core/ids';
import { t } from '@/i18n';

/**
 * Client 端：只读镜像。
 * 不持有 project 的写权限，不发乐观更新；所有修改都发 command.request，
 * 等 Host 广播新的 snapshot 后才改变画面。
 */
export class LayerWindowClient {
  private channel: BroadcastChannel | null = null;
  private hostId: string | null = null;
  private connected = false;
  private helloTimer: number | null = null;
  private pending = new Map<string, { resolve: (r: CommandResult) => void; timer: number }>();

  onSnapshot: ((msg: SnapshotMessage) => void) | null = null;
  onTime: ((msg: TimeMessage) => void) | null = null;
  onStatus: ((state: 'connecting' | 'connected' | 'disconnected', hostId: string | null) => void) | null = null;

  constructor(
    readonly layerId: string,
    private readonly wantHostId: string | null,
  ) {}

  connect(): void {
    if (this.channel) return;
    this.hostId = this.wantHostId;
    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (ev: MessageEvent<HostToClient>) => this.handle(ev.data);
    this.onStatus?.('connecting', this.hostId);
    this.sendHello();
    this.helloTimer = window.setInterval(() => {
      if (!this.connected) this.sendHello();
    }, 700);
    window.addEventListener('beforeunload', () => this.bye());
  }

  private sendHello(): void {
    this.channel?.postMessage({
      kind: 'client.hello',
      layerId: this.layerId,
      wantHostId: this.wantHostId,
    } satisfies ClientToHost);
  }

  private handle(msg: HostToClient): void {
    if (!msg || typeof msg !== 'object') return;
    if (this.hostId && msg.hostId !== this.hostId) return;
    this.hostId = msg.hostId;

    if (msg.kind === 'host.hello') {
      this.markConnected();
      return;
    }
    if (msg.kind === 'snapshot') {
      this.markConnected();
      if (msg.layerId && msg.layerId !== this.layerId) return;
      this.onSnapshot?.(msg);
      return;
    }
    if (msg.kind === 'time') {
      this.onTime?.(msg);
      return;
    }
    if (msg.kind === 'command.result') {
      if (msg.layerId && msg.layerId !== this.layerId) return;
      const entry = this.pending.get(msg.requestId);
      if (entry) {
        window.clearTimeout(entry.timer);
        this.pending.delete(msg.requestId);
        entry.resolve(msg.result);
      }
      return;
    }
    if (msg.kind === 'host.bye') {
      this.connected = false;
      this.onStatus?.('disconnected', this.hostId);
    }
  }

  private markConnected(): void {
    if (this.connected) return;
    this.connected = true;
    if (this.helloTimer !== null) {
      window.clearInterval(this.helloTimer);
      this.helloTimer = null;
    }
    this.onStatus?.('connected', this.hostId);
  }

  async sendCommand(type: string, payload: unknown): Promise<CommandResult> {
    const requestId = uid('req');
    if (!this.channel || !this.hostId) {
      return {
        ok: false,
        commandId: requestId,
        type,
        error: { code: 'RUNTIME', message: t('与主窗口的连接已断开') },
        projectVersion: 0,
        durationMs: 0,
        dryRun: false,
      };
    }
    const request: CommandRequest = {
      kind: 'command.request',
      hostId: this.hostId,
      layerId: this.layerId,
      requestId,
      type,
      payload,
    };
    return new Promise<CommandResult>((resolve) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          ok: false,
          commandId: requestId,
          type,
          error: { code: 'ABORTED', message: t('主窗口 10s 未响应（可能正在导出）') },
          projectVersion: 0,
          durationMs: 10000,
          dryRun: false,
        });
      }, 10_000);
      this.pending.set(requestId, { resolve, timer });
      this.channel?.postMessage(request satisfies ClientToHost);
    });
  }

  bye(): void {
    if (this.channel && this.hostId) {
      this.channel.postMessage({ kind: 'client.bye', hostId: this.hostId, layerId: this.layerId } satisfies ClientToHost);
    }
    this.channel?.close();
    this.channel = null;
  }
}

/** 播放头平滑：收到快照时重置基准，本地按 rAF 外推 */
export class TimeSmoother {
  private base = 0;
  private baseAt = 0;
  private playing = false;
  private duration = 4000;

  setDuration(d: number): void {
    this.duration = d;
  }

  sync(time: number, playing: boolean): void {
    this.base = time;
    this.baseAt = performance.now();
    this.playing = playing;
  }

  now(): number {
    if (!this.playing) return this.base;
    const t = this.base + (performance.now() - this.baseAt);
    return this.duration > 0 ? t % this.duration : t;
  }

  isPlaying(): boolean {
    return this.playing;
  }
}
