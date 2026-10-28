import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Music4, Play, Sparkles, Wand2 } from 'lucide-react';
import { exec } from '@/core/commandBus';
import { pushToast, useEditor } from '@/core/store';
import type { AudioLayer, VoiceMode, VoicePreset, VoiceSpec } from '@/core/types';
import { VOICE_PRESETS } from '@/core/types';
import { estimateVoiceMs, normalizeVoiceSpec, syllablesOf } from '@/core/voice';
import { previewVoiceSpec } from '@/render/audioEngine';
import { Button, Field, Slider, cx } from './primitives';
import { t } from '@/i18n';

/**
 * 人声面板。
 *
 * 交互照剪映的「文本朗读」来：**上面一个输入框，下面一排音色，右下角一个蓝色主按钮**。
 * 参数分两层 —— 「唱什么、怎么说」放上面（文本、模式、音色），
 * 「像不像」折叠在下面（音高/语速/颤音/气声），非专业用户不展开也能直接生成。
 *
 * 一条纪律：**选中人声层时这块面板就是在编辑那一层**（改了立刻生效、可撤销），
 * 没选中时它是「新建草稿」。两种状态用同一条命令路径，不出现「预览一套、生成另一套」。
 */

const PRESET_LABEL: Record<VoicePreset, string> = {
  female: '女声',
  male: '男声',
  child: '童声',
  robot: '机器人',
};

/** 旋律预设：演唱没想法时给三条能听的曲线，省得用户对着空参数发呆 */
const MELODIES: { id: string; label: string; notes: number[] }[] = [
  { id: 'auto', label: '自动', notes: [] },
  { id: 'rise', label: '上行', notes: [0, 2, 4, 5, 7, 9, 12] },
  { id: 'wave', label: '起伏', notes: [0, 4, 2, 7, 4, 9, 5, 2] },
  { id: 'down', label: '下行', notes: [12, 9, 7, 5, 4, 2, 0] },
];

const DEFAULT_SPEC: Partial<VoiceSpec> = {
  text: '我在加我的图层数',
  mode: 'sing',
  preset: 'female',
  root: 220,
  rate: 1,
  pitch: 0,
  vibrato: 0.32,
  breath: 0.18,
  melody: [],
  beatsPerSyllable: 2,
};

export function VoicePanel() {
  const project = useEditor((s) => s.project);
  const selectedIds = useEditor((s) => s.ui.selectedIds);
  const selected = useMemo(() => {
    const id = selectedIds[0];
    const layer = id ? project.layers.find((l) => l.id === id) : undefined;
    return layer && layer.type === 'audio' && layer.voice ? (layer as AudioLayer) : null;
  }, [project.layers, selectedIds]);

  const [draft, setDraft] = useState<Partial<VoiceSpec>>(() => ({
    ...DEFAULT_SPEC,
    bpm: project.tempo?.bpm ?? 120,
  }));
  const [open, setOpen] = useState(false);
  const editingId = useRef<string | null>(null);

  /* 选中人声层 → 面板载入那一层的参数；取消选中 → 回到草稿 */
  useEffect(() => {
    if (selected?.voice) {
      editingId.current = selected.id;
      setDraft(selected.voice);
    } else if (editingId.current) {
      editingId.current = null;
      setDraft({ ...DEFAULT_SPEC, bpm: project.tempo?.bpm ?? 120 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const spec = normalizeVoiceSpec({ ...draft, bpm: draft.bpm ?? project.tempo?.bpm ?? 120 });
  const plan = useMemo(() => estimateVoiceMs(spec), [spec.text, spec.mode, spec.preset, spec.rate, spec.bpm, spec.beatsPerSyllable, spec.melody]);
  const syllables = useMemo(() => syllablesOf(spec.text), [spec.text]);
  const unknown = syllables.filter((s) => s.unknown).length;

  /** 改参数：选中层时立刻落到那一层（coalesce，一次拖动一个撤销点）；否则只改草稿 */
  const patch = (next: Partial<VoiceSpec>) => {
    const merged = { ...draft, ...next };
    setDraft(merged);
    if (editingId.current && selected?.voice) {
      void exec('voice.set', { id: editingId.current, voice: next, refit: true });
    }
  };

  const generate = () => {
    if (!spec.text.trim()) {
      pushToast('warn', t('先写一句要唱的词'));
      return;
    }
    if (editingId.current) {
      void exec('voice.set', { id: editingId.current, voice: draft, refit: true });
      return;
    }
    void exec('voice.create', {
      ...draft,
      text: spec.text,
      bpm: spec.bpm,
    }).then((res) => {
      if (!res.ok) {
        pushToast('error', res.error?.message ?? t('生成失败'));
        return;
      }
      const data = res.data as { id: string; ms: number; syllables: number; unknown: number };
      pushToast(
        'success',
        unknown
          ? t('已生成 {n} 个字 · 其中 {u} 个没有读音，已用哼声代替', { n: data.syllables, u: unknown })
          : t('已生成 {n} 个字 · {sec}s', { n: data.syllables, sec: (data.ms / 1000).toFixed(1) }),
      );
      void exec('selection.set', { ids: [data.id] });
    });
  };

  const fromLyrics = () => {
    void exec('voice.create', { ...draft, text: '歌词', fromLyrics: true }).then((res) => {
      if (!res.ok) pushToast('warn', t('工程里还没有歌词'));
      else {
        const data = res.data as { id: string; text: string };
        pushToast('success', t('已按前几行歌词生成'));
        void exec('selection.set', { ids: [data.id] });
      }
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
        {selected?.voice && (
          <div className="flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[10.5px] text-accent-soft">
            <Mic size={11} />
            {t('正在编辑这一层：{name}', { name: selected.name })}
          </div>
        )}

        <textarea
          data-testid="voice-text"
          value={spec.text}
          onChange={(e) => patch({ text: e.target.value })}
          rows={4}
          placeholder={t('写一句要唱的词，或直接写拼音')}
          className="border-ink-700 bg-ink-900/70 focus:border-accent/60 w-full resize-none rounded-md border p-2 text-[12px] leading-relaxed text-zinc-100 outline-none"
        />

        <div className="flex gap-1">
          {(['speak', 'sing'] as VoiceMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => patch({ mode })}
              className={cx(
                'flex h-7 flex-1 items-center justify-center gap-1 rounded-md text-[11px] transition',
                spec.mode === mode ? 'bg-accent text-white' : 'bg-ink-800 text-zinc-400 hover:bg-ink-700',
              )}
            >
              {mode === 'sing' ? <Music4 size={11} /> : <Mic size={11} />}
              {mode === 'sing' ? t('演唱') : t('说话')}
            </button>
          ))}
        </div>

        <div>
          <div className="mb-1 text-[10px] text-zinc-500">{t('音色')}</div>
          <div className="grid grid-cols-4 gap-1">
            {VOICE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => patch({ preset, root: preset === 'male' ? 110 : preset === 'child' ? 300 : preset === 'robot' ? 130 : 220 })}
                className={cx(
                  'h-7 rounded-md text-[10.5px] transition',
                  spec.preset === preset ? 'bg-accent/25 text-accent-soft ring-1 ring-accent/60' : 'bg-ink-800 text-zinc-400 hover:bg-ink-700',
                )}
              >
                {t(PRESET_LABEL[preset])}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button variant="solid" size="sm" onClick={() => previewVoiceSpec(spec)} className="gap-1" testId="voice-preview">
            <Play size={10} /> {t('试听')}
          </Button>
          <span className="font-mono text-[10px] text-zinc-500">
            {(plan / 1000).toFixed(1)}s · {syllables.length} {t('字')}
          </span>
        </div>

        {spec.mode === 'sing' && (
          <div className="space-y-2 rounded-md border border-ink-700/70 bg-ink-900/40 p-2">
            <div>
              <div className="mb-1 text-[10px] text-zinc-500">{t('旋律')}</div>
              <div className="flex gap-1">
                {MELODIES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => patch({ melody: m.notes })}
                    className={cx(
                      'h-6 flex-1 rounded text-[10px] transition',
                      (spec.melody.length === 0 && m.id === 'auto') || sameMelody(spec.melody, m.notes)
                        ? 'bg-accent/25 text-accent-soft'
                        : 'bg-ink-800 text-zinc-500 hover:bg-ink-700',
                    )}
                  >
                    {t(m.label)}
                  </button>
                ))}
              </div>
            </div>
            <Slider
              label={t('每字几拍')}
              value={spec.beatsPerSyllable}
              min={0.5}
              max={4}
              step={0.25}
              onChange={(beatsPerSyllable) => patch({ beatsPerSyllable })}
              format={(v) => `${v} ${t('拍')}`}
            />
            <div className="flex items-center justify-between text-[10px] text-zinc-500">
              <span>{t('速度')}</span>
              <span className="font-mono">{spec.bpm} BPM</span>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between py-0.5 text-[10.5px] text-zinc-500 hover:text-zinc-300"
        >
          <span>{t('音色细节')}</span>
          <span>{open ? '−' : '+'}</span>
        </button>
        {open && (
          <div className="space-y-2">
            <Slider
              label={t('音高')}
              value={spec.pitch}
              min={-12}
              max={12}
              step={1}
              onChange={(pitch) => patch({ pitch })}
              format={(v) => `${v > 0 ? '+' : ''}${v} ${t('半音')}`}
            />
            <Slider label={t('语速')} value={spec.rate} min={0.6} max={1.8} step={0.05} onChange={(rate) => patch({ rate })} format={(v) => `${v.toFixed(2)}×`} />
            <Slider label={t('颤音')} value={spec.vibrato} min={0} max={1} step={0.02} onChange={(vibrato) => patch({ vibrato })} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label={t('气声')} value={spec.breath} min={0} max={1} step={0.02} onChange={(breath) => patch({ breath })} format={(v) => `${Math.round(v * 100)}%`} />
          </div>
        )}

        {unknown > 0 && (
          <p className="rounded border border-amber-500/25 bg-amber-500/5 p-1.5 text-[10px] leading-relaxed text-amber-300/80">
            {t('有 {n} 个字不在读音表里，已用「啦」代替。把那几个字直接写成拼音就能唱对。', { n: unknown })}
          </p>
        )}
      </div>

      <div className="border-ink-700/70 flex shrink-0 flex-col gap-1.5 border-t p-2.5">
        <Button variant="accent" onClick={generate} className="h-8 w-full gap-1.5" testId="voice-generate">
          <Wand2 size={13} /> {selected?.voice ? t('应用到这一层') : t('生成到时间轴')}
        </Button>
        <Button variant="ghost" size="sm" onClick={fromLyrics} className="w-full gap-1.5" testId="voice-from-lyrics">
          <Sparkles size={11} /> {t('用工程歌词生成')}
        </Button>
      </div>
    </div>
  );
}

function sameMelody(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
