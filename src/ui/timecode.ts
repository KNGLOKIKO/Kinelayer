/**
 * 全项目唯一的时间码口径。
 *
 * 之前有两份：预览区底下是 `mm:ss:ff`（帧号），时间轴刻度是 `mm:ss.d`（十分之一秒）。
 * 两份都不算错，但同一个时刻在屏幕上出现两种写法，用户会以为它们不是同一个东西 ——
 * 尤其在做逐帧对齐的时候（「播放头在 00:12:15，标尺怎么写着 12.5」）。
 *
 * 现在按场合分工，函数只有一个来源：
 * - `timecode` 播放器口径，带帧号。播放头、入出点、标记点提示用它。
 * - `clock`    刻度口径，十分之一秒。尺子上的数字用它 —— 帧号在 1 像素一帧的尺子上是噪声。
 * - `verbose`  带小时的毫秒口径。导出摘要、剪辑表预览用它，要能贴到别人的文档里。
 */

/** `mm:ss:ff`；超过一小时变成 `h:mm:ss:ff` */
export function timecode(ms: number, fps: number): string {
  const safe = Math.max(0, Math.round(ms));
  const rate = Math.max(1, Math.round(fps || 30));
  const totalFrames = Math.round((safe / 1000) * rate);
  const f = totalFrames % rate;
  const totalSec = Math.floor(safe / 1000);
  const mm = String(Math.floor(totalSec / 60) % 60).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  const h = Math.floor(totalSec / 3600);
  const head = h > 0 ? `${h}:` : '';
  return `${head}${mm}:${ss}:${String(f).padStart(2, '0')}`;
}

/** `mm:ss.d`；超过一小时带上小时 */
export function clock(ms: number): string {
  const safe = Math.max(0, ms) / 1000;
  const h = Math.floor(safe / 3600);
  const m = String(Math.floor(safe / 60) % 60).padStart(2, '0');
  const s = String(Math.floor(safe % 60)).padStart(2, '0');
  const d = Math.floor((safe % 1) * 10);
  const head = h > 0 ? `${h}:` : '';
  return `${head}${m}:${s}.${d}`;
}

/** `h:mm:ss.mmm`，精确到毫秒 */
export function verbose(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const h = Math.floor(safe / 3_600_000);
  const m = String(Math.floor((safe % 3_600_000) / 60_000)).padStart(2, '0');
  const s = String(Math.floor((safe % 60_000) / 1000)).padStart(2, '0');
  const t = String(safe % 1000).padStart(3, '0');
  return `${h}:${m}:${s}.${t}`;
}

/** 把毫秒按 fps 对齐到最近的一帧（逐帧步进、入出点吸附都用它） */
export function snapToFrame(ms: number, fps: number): number {
  const rate = Math.max(1, Math.round(fps || 30));
  return Math.round((ms / 1000) * rate) * (1000 / rate);
}
