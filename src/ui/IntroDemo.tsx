/**
 * 项目介绍页（启动页 `/`）的示例动画。
 *
 * 四拍循环，讲的是「这东西怎么用」，不是「这东西长什么样」：
 *
 *   01 画布   —— 尺寸 / 时长 / 帧率
 *   02 图层   —— 选中、改位置、叠放
 *   03 关键帧 —— 播放头扫过，属性按曲线求值
 *   04 命令   —— 同一个动作写成一条命令，AI 和人走同一条总线
 *
 * 为什么不用 canvas 摆一套真渲染：介绍页要讲清楚的是**界面语言**，
 * 用界面本身去画界面最直白；再挂一条渲染管线既慢，又等于在介绍「渲染」而不是「怎么用」。
 * 真正的渲染能力由旁边的示例工程卡承担 —— 那张缩略图就是渲染器的产物。
 *
 * 动效只用 CSS 的 left / transform / opacity 过渡，四拍各 2.2 秒。
 * `prefers-reduced-motion` 下停在第三拍（信息量最大的一帧），不循环。
 */

import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { cx } from './primitives';

const BEATS = 4;
const BEAT_MS = 2200;

/**
 * 设计稿尺寸。
 *
 * 内部是「百分比定位 + 固定像素细节」的混排，直接把容器拉大只会把方块拉长、字号不变，
 * 比例全乱。所以固定画一张 380×210，再整体等比缩放到容器宽度 —— 任何宽度下比例都一致。
 */
const DESIGN_W = 380;
const DESIGN_H = 210;

/** 每一拍的短标签与一句话说明。标签用等宽字，和命令行的气质对上 */
const STEP_LABEL = ['画布', '图层', '关键帧', '命令'];
const STEP_HINT = ['尺寸 · 时长 · 帧率', '位置 · 样式 · 叠放', '轨道 + 播放头求值', '同一条命令总线'];

export function IntroDemo() {
  const [phase, setPhase] = useState(0);
  const [still, setStill] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) {
      setStill(true);
      setPhase(2);
      return;
    }
    const id = window.setInterval(() => setPhase((p) => (p + 1) % BEATS), BEAT_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / DESIGN_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onStage = phase >= 0;
  const selected = phase === 1;
  const keyed = phase >= 2;
  const commanding = phase === 3;

  /*
   * 第 0 拍不参与过渡：循环回到起点时，播放头和标题要「瞬间归位」，
   * 否则每一次重播都会看到它们倒着滑回去，像卡带。
   */
  const ease = still || phase === 0 ? 'none' : 'left 2000ms linear, transform 700ms ease-out, opacity 500ms ease-out';

  return (
    <figure data-testid="intro-demo" data-phase={phase} className="m-0 w-full select-none">
      <div ref={wrapRef} className="relative w-full overflow-hidden" style={{ aspectRatio: `${DESIGN_W} / ${DESIGN_H}` }}>
      <div
        aria-hidden
        className="border-ink-700 bg-ink-900 absolute top-0 left-0 overflow-hidden rounded-lg border"
        style={{ width: DESIGN_W, height: DESIGN_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        {/* ── 图层面板 ─────────────────────────────── */}
        <div className="border-ink-700/80 bg-ink-850/80 absolute rounded-[3px] border" style={{ left: '3.5%', top: '7%', width: '22%', height: '62%' }}>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className={cx(
                'absolute left-[6%] flex items-center gap-[6%] rounded-[2px] px-[6%] transition-colors duration-500',
                (selected && row === 0) || (keyed && row === 1) ? 'bg-accent/25' : 'bg-transparent',
              )}
              style={{ top: `${6 + row * 30}%`, width: '88%', height: '24%' }}
            >
              <span className={cx('h-[26%] w-[26%] shrink-0 rounded-[1px] transition-colors duration-500', keyed && row === 1 ? 'bg-accent-soft' : 'bg-ink-600')} />
              <span className="bg-ink-600/80 h-[16%] flex-1 rounded-[1px]" />
            </div>
          ))}
        </div>

        {/* ── 画布 ────────────────────────────────── */}
        <div
          className="absolute overflow-hidden rounded-[3px]"
          style={{
            left: '29%',
            top: '7%',
            width: '67.5%',
            height: '58%',
            background: 'linear-gradient(135deg,#0a0d14 0%,#141a2b 55%,#2a1147 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(124,92,255,.18)',
          }}
        >
          {/* 流线：三条弧，示意代码层 */}
          <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-70">
            {[0, 1, 2].map((i) => (
              <path
                key={i}
                d={`M -4 ${16 + i * 11} C 24 ${8 + i * 11}, 52 ${30 + i * 11}, 104 ${18 + i * 11}`}
                fill="none"
                stroke={i % 2 === 0 ? 'rgba(124,92,255,.55)' : 'rgba(34,211,238,.45)'}
                strokeWidth={0.5}
              />
            ))}
          </svg>

          {/* 光斑：第三拍跟着关键帧放大 */}
          <div
            className="absolute rounded-full"
            style={{
              right: '8%',
              bottom: '4%',
              width: '26%',
              height: '42%',
              background: 'radial-gradient(circle at 50% 50%, rgba(160,140,255,.85), rgba(96,80,220,.35) 42%, rgba(34,211,238,0) 72%)',
              opacity: onStage ? 1 : 0,
              transform: keyed ? 'scale(1.18)' : 'scale(1)',
              transition: ease,
            }}
          />

          {/* 标题两行：第一拍淡入，第三拍整体上抬 */}
          <div
            className="absolute"
            style={{
              left: '9%',
              top: '34%',
              width: '72%',
              transform: keyed ? 'translateY(-7%)' : 'translateY(0)',
              opacity: onStage ? 1 : 0,
              transition: ease,
            }}
          >
            <div className="bg-white/85 h-[9px] w-[86%] rounded-[1px]" />
            <div className="bg-white/85 mt-[5px] h-[9px] w-[62%] rounded-[1px]" />
            <div className="bg-white/35 mt-[7px] h-[4px] w-[70%] rounded-[1px]" />
          </div>

          {/* 选中框：第二拍出现 */}
          <div
            className="pointer-events-none absolute rounded-[2px]"
            style={{
              left: '7%',
              top: '30%',
              width: '76%',
              height: '30%',
              border: '1px dashed rgba(155,131,255,.95)',
              opacity: selected ? 1 : 0,
              transition: 'opacity 400ms ease-out',
            }}
          >
            {[
              ['-3px', '-3px'],
              ['calc(100% - 3px)', '-3px'],
              ['-3px', 'calc(100% - 3px)'],
              ['calc(100% - 3px)', 'calc(100% - 3px)'],
            ].map(([x, y], i) => (
              <span key={i} className="bg-accent-soft absolute h-[5px] w-[5px] rounded-[1px]" style={{ left: x, top: y }} />
            ))}
          </div>

          {/* 第四拍：命令落下去，新图层出现 */}
          <div
            className="bg-cyan/70 absolute rounded-[1px]"
            style={{
              left: '9%',
              bottom: '13%',
              width: '40%',
              height: '3px',
              opacity: commanding ? 0.9 : 0,
              transition: 'opacity 500ms ease-out',
            }}
          />
        </div>

        {/* ── 时间轴 ──────────────────────────────── */}
        <div className="border-ink-700/80 bg-ink-850/80 absolute rounded-[3px] border" style={{ left: '29%', top: '69%', width: '67.5%', height: '24%' }}>
          {/* 轨道 */}
          <div className="bg-ink-600/70 absolute rounded-full" style={{ left: '6%', top: '34%', width: '88%', height: '1.5px' }} />
          <div className="bg-ink-600/40 absolute rounded-full" style={{ left: '6%', top: '70%', width: '88%', height: '1.5px' }} />

          {/* 关键帧菱形：第三拍亮起 */}
          {[12, 46, 80].map((left, i) => (
            <span
              key={left}
              className="absolute bg-accent-soft"
              style={{
                left: `${left}%`,
                top: '34%',
                width: '7px',
                height: '7px',
                marginTop: '-3.5px',
                transform: `rotate(45deg) scale(${keyed ? 1 : 0.4})`,
                opacity: keyed ? 1 : 0.25,
                transition: `opacity 400ms ease-out ${i * 90}ms, transform 400ms ease-out ${i * 90}ms`,
              }}
            />
          ))}

          {/* 播放头：第三拍从左扫到右 */}
          <div
            className="absolute top-0 bottom-0"
            style={{
              left: keyed ? '92%' : '6%',
              width: '1.5px',
              background: 'rgba(34,211,238,.9)',
              transition: still ? 'none' : ease,
            }}
          >
            <span className="bg-cyan absolute -left-[2.5px] h-[5px] w-[5px] rounded-full" style={{ top: 0 }} />
          </div>
        </div>

        {/* ── 命令行 ──────────────────────────────── */}
        <div
          className="border-ink-700 bg-ink-950/90 absolute overflow-hidden rounded-[3px] border"
          style={{ left: '3.5%', bottom: '4%', maxWidth: '94%' }}
        >
          <div className="flex items-center gap-1 px-1.5 py-1">
            <span className="text-accent-soft font-mono text-[8px]">›</span>
            {/*
              光标常驻：前三拍命令块是空的，如果整个盒子跟着隐藏，左下角会剩一个看不懂的空框；
              留着光标闪，读起来就是「终端在等指令」，第四拍才把命令打出来。
            */}
            <span
              data-user-text
              className="overflow-hidden whitespace-nowrap font-mono text-[8.5px] text-zinc-400"
              style={{
                maxWidth: commanding ? '260px' : '0px',
                opacity: commanding ? 1 : 0,
                transition: still ? 'none' : 'max-width 1400ms steps(28, end), opacity 200ms linear',
              }}
            >
              layer.create {'{'} type: &quot;text&quot;, text: &quot;标题&quot; {'}'}
            </span>
            <span
              className={cx('bg-accent-soft inline-block h-[8px] w-[1.5px] shrink-0', commanding ? 'opacity-100' : 'animate-pulseSoft')}
            />
          </div>
        </div>
      </div>
      </div>

      {/* 四拍指示：当前那拍亮起 */}
      <figcaption className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {STEP_LABEL.map((label, i) => (
          <span key={label} className="flex items-center gap-1">
            <span
              data-testid="intro-step"
              data-active={i === phase ? 'true' : 'false'}
              className={cx(
                'font-mono text-[9.5px] tracking-wide transition-colors duration-300',
                i === phase ? 'text-accent-soft' : 'text-zinc-600',
              )}
            >
              {String(i + 1).padStart(2, '0')} {t(label)}
            </span>
            {i < STEP_LABEL.length - 1 && <span className="text-ink-600 text-[9px]">→</span>}
          </span>
        ))}
        <span className="text-zinc-600 ml-auto hidden text-[10px] sm:inline">{t(STEP_HINT[phase])}</span>
      </figcaption>
    </figure>
  );
}
