import { useEffect, useRef, useState } from 'react';
import { Activity, Copy, Music2, Plus, Target, Timer, Trash2 } from 'lucide-react';
import { exec } from '@/core/commandBus';
import { pushToast, useEditor } from '@/core/store';
import {
  barAlignedOffset,
  beatAt,
  beatPhase,
  fitTaps,
  formatLrc,
  isDownbeat,
  lineAt,
  lineCharProgress,
  lyricsOf,
  parseLrc,
  phaseOffset,
  sinceBeat,
  tempoOf,
} from '@/core/score';
import type { LyricLine, Tempo } from '@/core/types';
import { Badge, Button, Field, IconButton, NumberInput, Section, cx } from './primitives';
import { copyText } from './clipboard';
import { t } from '@/i18n';

/**
 * 速度网格 + 歌词。
 *
 * 这两块放在画布的检查器里，理由和它们的数据位置一致：`tempo` 与 `lyrics`
 * 都是**工程级**的 —— 切镜发生在画面上，但必须落在声音的拍子上；
 * 歌词是整支片子的文本骨架，不属于任何一个图层。放进图层检查器里
 * 就会有人问「我这层为什么没有 BPM」。
 *
 * 打拍用的是墙钟（`performance.now()`），不是 `setInterval` 的心跳：
 * 后者每跳一次就带几毫秒抖动，而拍点的容差本来就只有十几毫秒。
 */

/* ------------------------------------------------------------------ 读数 */

interface Reading {
  beat: number;
  bar: number;
  beatInBar: number;
  phase: number;
  down: boolean;
  since: number;
  text: string;
  /** 已唱几个字（浮点，向下取整用于上色） */
  sung: number;
  total: number;
  next: string | null;
  nextIn: number;
}

function readNow(): Reading {
  const { project, runtime } = useEditor.getState();
  const tempo = tempoOf(project);
  const at = runtime.playhead;
  const beat = beatAt(tempo, at);
  const lyric = lineAt(lyricsOf(project), at);
  const nextLine = lyricsOf(project).find((l) => l.start > at) ?? null;
  return {
    beat,
    bar: Math.floor(beat / Math.max(1, tempo.meter)) + 1,
    beatInBar: (Math.floor(beat) % Math.max(1, tempo.meter)) + 1,
    phase: beatPhase(tempo, at),
    down: isDownbeat(tempo, at),
    since: Math.round(sinceBeat(tempo, at)),
    text: lyric?.text ?? '',
    sung: lyric ? lineCharProgress(lyric, at) : 0,
    total: lyric ? [...lyric.text].length : 0,
    next: nextLine?.text ?? null,
    nextIn: nextLine ? Math.round(nextLine.start - at) : 0,
  };
}

function sameRead(a: Reading, b: Reading): boolean {
  return (
    a.bar === b.bar &&
    a.beatInBar === b.beatInBar &&
    a.down === b.down &&
    a.since === b.since &&
    a.text === b.text &&
    Math.floor(a.sung) === Math.floor(b.sung) &&
    a.next === b.next &&
    Math.round(a.nextIn / 100) === Math.round(b.nextIn / 100)
  );
}

/**
 * 实时读数。
 *
 * 单独一个组件、自己跑 rAF、13fps 节流 —— 如果它订阅 `runtime.playhead`，
 * 整块检查器（连同下面二十行歌词输入框）会跟着每秒重渲染 60 次，
 * 打字时光标会跳。读数变了才 setState，暂停时几乎不产生渲染。
 */
function ScoreMeter() {
  const [view, setView] = useState<Reading>(() => readNow());

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < 72) return;
      last = now;
      const next = readNow();
      setView((prev) => (sameRead(prev, next) ? prev : next));
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sungInt = Math.floor(view.sung);
  const head = [...view.text].slice(0, sungInt).join('');
  const tail = [...view.text].slice(sungInt).join('');

  return (
    <div data-testid="score-readout" className="border-ink-700 bg-ink-950/60 space-y-1.5 rounded-md border p-2">
      <div className="flex items-baseline gap-2 font-mono text-[10.5px] text-zinc-400">
        <span className="text-zinc-200">
          {t('小节')} {String(view.bar).padStart(2, '0')}
        </span>
        <span className="text-zinc-200">
          {t('拍')} {view.beatInBar}
        </span>
        <span className="text-zinc-600">#{view.beat.toFixed(3)}</span>
        <span className="flex-1" />
        <span className={cx('tabular-nums', view.down ? 'text-accent' : 'text-zinc-600')}>
          {view.down ? t('强拍') : `+${view.since}ms`}
        </span>
      </div>

      <div className="bg-ink-700/60 h-1 overflow-hidden rounded-full">
        <div className="bg-accent/70 h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, view.phase)) * 100}%` }} />
      </div>

      <div className="min-h-[15px] text-[11px] leading-snug">
        {view.text ? (
          <span>
            <span className="text-accent">{head}</span>
            <span className="text-zinc-600">{tail}</span>
            <span className="ml-1.5 font-mono text-[9.5px] text-zinc-600">
              {sungInt}/{view.total}
            </span>
          </span>
        ) : view.next ? (
          <span className="text-zinc-600">
            {t('下一句 {ms}ms 后：{text}', { ms: view.nextIn, text: view.next })}
          </span>
        ) : (
          <span className="text-zinc-700">{t('此刻没有歌词')}</span>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- 速度网格 */

export function TempoSection() {
  const project = useEditor((s) => s.project);
  const tempo = tempoOf(project);
  const taps = useRef<{ wall: number; play: number | null }[]>([]);
  const [, bump] = useState(0);

  const setTempo = (patch: Partial<Tempo>) => void exec('project.setTempo', patch);

  const tap = () => {
    const now = performance.now();
    const rt = useEditor.getState().runtime;
    const list = taps.current;
    /* 停手两秒 = 一轮结束：重来，别让上一轮的 BPM 拖累这一轮 */
    if (list.length && now - list[list.length - 1]!.wall > 2000) list.length = 0;
    list.push({ wall: now, play: rt.playing ? rt.playhead : null });
    if (list.length > 16) list.shift();

    /* 全程都在播放才敢动相位：暂停时「第几毫秒按的」没有工程时间的意义 */
    const allPlaying = list.length >= 3 && list.every((e) => e.play !== null);
    const fit = fitTaps(list.map((e) => (allPlaying ? e.play! : e.wall)));
    if (fit && list.length >= 3) {
      setTempo(allPlaying ? { bpm: fit.bpm, offsetMs: fit.offsetMs } : { bpm: fit.bpm });
    }
    bump((v) => v + 1);
  };

  const tapCount = taps.current.length;
  const allPlaying = tapCount >= 3 && taps.current.every((e) => e.play !== null);
  const fit = tapCount >= 2 ? fitTaps(taps.current.map((e) => (allPlaying ? e.play! : e.wall))) : null;

  return (
    <Section
      title={t('速度网格')}
      right={<Badge tone="cyan">{t('{n} BPM', { n: Math.round(tempo.bpm) })}</Badge>}
    >
      <div className="grid grid-cols-3 gap-1.5">
        <Field label="BPM">
          <NumberInput value={tempo.bpm} onCommit={(bpm) => setTempo({ bpm })} min={20} max={300} step={1} />
        </Field>
        <Field label={t('偏移')}>
          <NumberInput value={tempo.offsetMs} onCommit={(offsetMs) => setTempo({ offsetMs })} min={-60_000} max={600_000} step={1} suffix="ms" />
        </Field>
        <Field label={t('拍 / 小节')}>
          <NumberInput value={tempo.meter} onCommit={(meter) => setTempo({ meter })} min={1} max={16} step={1} />
        </Field>
      </div>

      <ScoreMeter />

      <div className="flex items-stretch gap-1">
        <Button size="sm" variant="outline" className="px-1.5" title={t('速度减半（隔拍打拍时用）')} onClick={() => setTempo({ bpm: Math.max(20, Math.round(tempo.bpm / 2)) })}>
          ÷2
        </Button>
        <Button size="sm" variant="outline" className="px-1.5" title={t('速度加倍（半速打拍时用）')} onClick={() => setTempo({ bpm: Math.min(300, Math.round(tempo.bpm * 2)) })}>
          ×2
        </Button>
        <Button size="sm" variant="accent" className="flex-1" onClick={tap} testId="tempo-tap">
          <Timer size={12} /> {t('打拍')}
          {tapCount > 0 && <span className="ml-1 font-mono text-[10px] opacity-70">{tapCount}</span>}
        </Button>
        <IconButton
          size={26}
          title={t('把播放头当作拍点')}
          onClick={() => setTempo({ offsetMs: phaseOffset(tempo, useEditor.getState().runtime.playhead) })}
          testId="tempo-align-beat"
        >
          <Target size={12} />
        </IconButton>
        <IconButton
          size={26}
          title={t('把播放头当作小节头（强拍）')}
          onClick={() => setTempo({ offsetMs: barAlignedOffset(tempo, useEditor.getState().runtime.playhead) })}
        >
          <Activity size={12} />
        </IconButton>
      </div>

      <p className="text-[10px] leading-relaxed text-zinc-600">
        {fit && tapCount >= 3
          ? allPlaying
            ? t('已按 {n} 下 · 间隔 {ms}ms · 敲得最散的一下偏 {spread}ms', { n: tapCount, ms: fit.intervalMs, spread: fit.spreadMs })
            : t('已按 {n} 下 · 间隔 {ms}ms（暂停中只改 BPM，不碰相位）', { n: tapCount, ms: fit.intervalMs })
          : t('跟着鼓点连按三下以上。播放中打拍会顺带把相位对齐；按的是隔拍就点 ×2。')}
      </p>
    </Section>
  );
}

/* -------------------------------------------------------------------- 歌词 */

/** 行文本：空字符串不提交（schema 要求非空），失焦即回滚 */
function LyricText({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(value);
  }, [value]);
  return (
    <input
      value={local}
      className="border-ink-700 focus:border-accent/60 min-w-0 flex-1 rounded border bg-ink-900/80 px-1.5 py-[3px] text-[11px] text-zinc-200 outline-none"
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        focused.current = false;
        const next = local.trim();
        if (!next) {
          setLocal(value);
          return;
        }
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

const MAX_ROWS = 120;

export function LyricsSection() {
  const project = useEditor((s) => s.project);
  const lines = lyricsOf(project);
  const [draft, setDraft] = useState('');
  const [showImport, setShowImport] = useState(false);

  const commit = (next: LyricLine[], note?: string) => {
    void exec('project.setLyrics', { lines: next, mode: 'replace' }).then((res) => {
      if (res.ok && note) pushToast('success', note);
    });
  };
  const patch = (index: number, part: Partial<LyricLine>) =>
    commit(lines.map((l, i) => (i === index ? { ...l, ...part } : l)));

  const coverage = lines.reduce((n, l) => n + Math.max(0, l.end - l.start), 0);

  return (
    <Section
      title={t('歌词 / 逐字时间')}
      defaultOpen={false}
      right={
        lines.length ? (
          <Badge>
            {t('{n} 行', { n: lines.length })} · {(coverage / 1000).toFixed(0)}s
          </Badge>
        ) : undefined
      }
    >
      <p className="text-[10px] leading-relaxed text-zinc-600">
        {t('每行给一个毫秒区间；行内的逐字时间由引擎按字符权重切分，不用手排每一个字。代码层用 api.lyrics.chars 取「已唱几个字」。')}
      </p>

      {lines.length > 0 && (
        <div className="space-y-1">
          {lines.slice(0, MAX_ROWS).map((line, i) => (
            <div key={`${line.start}-${i}`} className="flex items-center gap-1">
              <LyricText value={line.text} onCommit={(text) => patch(i, { text })} />
              <NumberInput
                value={line.start}
                onCommit={(start) => patch(i, { start, end: Math.max(line.end, start + 200) })}
                min={0}
                max={3_600_000}
                step={10}
                className="w-[62px]"
              />
              <NumberInput
                value={line.end}
                onCommit={(end) => patch(i, { end: Math.max(line.start + 60, end) })}
                min={0}
                max={3_600_000}
                step={10}
                className="w-[62px]"
              />
              <IconButton
                size={20}
                title={t('起点改成播放头')}
                onClick={() => {
                  const at = Math.round(useEditor.getState().runtime.playhead);
                  patch(i, { start: at, end: Math.max(line.end, at + 600) });
                }}
              >
                <Target size={10} />
              </IconButton>
              <IconButton size={20} title={t('删掉这一行')} onClick={() => commit(lines.filter((_, j) => j !== i))}>
                <Trash2 size={10} />
              </IconButton>
            </div>
          ))}
          {lines.length > MAX_ROWS && (
            <p className="text-[10px] text-zinc-600">{t('还有 {n} 行没列出来（用命令改更快）', { n: lines.length - MAX_ROWS })}</p>
          )}
        </div>
      )}

      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={() => {
            const at = Math.round(useEditor.getState().runtime.playhead);
            commit([...lines, { text: t('新的一行'), start: at, end: at + 2000 }]);
          }}
        >
          <Plus size={11} /> {t('在播放头加一行')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowImport((v) => !v)}>
          <Music2 size={11} /> LRC
        </Button>
        {lines.length > 0 && (
          <IconButton
            size={22}
            title={t('复制为 LRC')}
            onClick={async () => {
              await copyText(formatLrc(lines));
              pushToast('success', t('已复制 {n} 行 LRC', { n: lines.length }));
            }}
          >
            <Copy size={11} />
          </IconButton>
        )}
      </div>

      {showImport && (
        <div className="space-y-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder={'[00:04.060-00:05.810] 先画一条线\n[00:06.800] 就有了时间'}
            className="border-ink-700 w-full resize-y rounded border bg-ink-950 p-2 font-mono text-[10.5px] text-zinc-300 outline-none focus:border-accent/60"
          />
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="accent"
              className="flex-1"
              testId="lyrics-import"
              onClick={() => {
                const parsed = parseLrc(draft, project.duration);
                if (!parsed.length) {
                  pushToast('warn', t('这段文本里没有可用的歌词行'));
                  return;
                }
                commit(parsed, t('读进 {n} 行', { n: parsed.length }));
                setDraft('');
                setShowImport(false);
              }}
            >
              {t('读进歌词')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowImport(false)}>
              {t('取消')}
            </Button>
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-600">
            {t('认 [分:秒.毫秒] 和 [分:秒-分:秒] 两种写法；没带时间戳的行会按顺序接在后面，先有再准。')}
          </p>
        </div>
      )}
    </Section>
  );
}
