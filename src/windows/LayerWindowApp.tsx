import { useEffect, useRef, useState } from 'react';
import { Loader2, Unplug } from 'lucide-react';
import { LayerWindowClient, TimeSmoother } from './client';
import type { SnapshotMessage } from './protocol';
import { LayerMirror } from './LayerMirror';
import { readLayerParams } from './host';

import { t } from '@/i18n';
export default function LayerWindowApp() {
  const { layerId, hostId } = readLayerParams();
  const clientRef = useRef<LayerWindowClient | null>(null);
  const smootherRef = useRef(new TimeSmoother());
  const [snapshot, setSnapshot] = useState<SnapshotMessage | null>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [time, setTime] = useState(0);

  useEffect(() => {
    if (!layerId) return;
    const client = new LayerWindowClient(layerId, hostId);
    clientRef.current = client;
    client.onStatus = (state) => setStatus(state);
    client.onSnapshot = (msg) => {
      setSnapshot(msg);
      smootherRef.current.setDuration(msg.project.duration);
      smootherRef.current.sync(msg.time, msg.playing);
      setTime(msg.time);
    };
    client.onTime = (msg) => smootherRef.current.sync(msg.time, msg.playing);
    client.connect();

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (smootherRef.current.isPlaying()) setTime(smootherRef.current.now());
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      client.bye();
    };
  }, [layerId, hostId]);

  if (!layerId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <Unplug size={22} className="text-zinc-600" />
        <div className="text-[12.5px] text-zinc-300">{t('缺少图层参数')}</div>
        <div className="max-w-[320px] text-[11px] leading-relaxed text-zinc-600">
          {t('这个页面只能由主窗口的「独立窗口」按钮打开：它会带上 layer 与 host 参数。')}
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <Loader2 size={20} className="ml-spin text-accent-soft" />
        <div className="text-[12px] text-zinc-300">{status === 'disconnected' ? t('主窗口无响应') : t('正在连接主窗口…')}</div>
        <div className="max-w-[300px] text-[11px] leading-relaxed text-zinc-600">
          {t('Client 只发命令请求、不持有状态。若主窗口已关闭，请回到主窗口重新打开图层窗口。')}
        </div>
        <button
          type="button"
          className="rounded-md border border-ink-600 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-zinc-100"
          onClick={() => window.location.reload()}
        >
          {t('重试')}
        </button>
      </div>
    );
  }

  return (
    <LayerMirror
      layerId={layerId}
      project={snapshot.project}
      time={time}
      status={status}
      onCommand={(type, payload) => {
        const client = clientRef.current;
        if (!client) {
          return Promise.resolve({
            ok: false,
            commandId: 'none',
            type,
            error: { code: 'RUNTIME', message: t('未连接') },
            projectVersion: 0,
            durationMs: 0,
            dryRun: false,
          });
        }
        return client.sendCommand(type, payload);
      }}
    />
  );
}
