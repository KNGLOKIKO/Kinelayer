/**
 * 人声引擎 · 发声的一半（共振峰合成 → AudioBuffer）。
 *
 * 结构就是一台极简 Klatt 合成器：
 *
 *     声门脉冲源(锯齿波 + 颤音) ─┬─ 带通 F1 ─┐
 *                                 ├─ 带通 F2 ─┼─ 包络 ─ 主增益 ─ 输出
 *                                 └─ 带通 F3 ─┘
 *     噪声源 ─ 带通(按辅音换频段) ─ 噪声包络 ─┘
 *
 * 元音换的是三个带通的**中心频率**，辅音开的是一段带通噪声 —— 所以「说话」和「演唱」
 * 是同一台机器：区别只在 `buildVoicePlan` 给的音高与时长。
 *
 * 为什么自己算而不调 `speechSynthesis`：那个 API 只能「放出来」，拿不到 PCM。
 * 导出的 WebM 要把人声混进音轨、时间轴要画波形、离线渲染要可复现 —— 三件事都要拿到采样。
 *
 * 结果按 `spec` 缓存：一段人声只算一次，预览 / 波形 / 导出共用同一份 AudioBuffer。
 */

import { buildVoicePlan, normalizeVoiceSpec, PHONEMES, type VoicePreset, type VoiceSpec } from '@/core/voice';

/** 各音色的共振峰缩放：男声腔体大 → 整体偏低；童声声道短 → 偏高 */
const FORMANT_SCALE: Record<VoicePreset, number> = {
  female: 1,
  male: 0.88,
  child: 1.18,
  robot: 0.95,
};

const cache = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<AudioBuffer | null>>();

export function voiceKey(input: Partial<VoiceSpec>): string {
  const spec = normalizeVoiceSpec(input);
  return JSON.stringify([spec.text, spec.mode, spec.preset, spec.root, spec.rate, spec.pitch, spec.vibrato, spec.breath, spec.melody, spec.beatsPerSyllable, spec.bpm]);
}

/** 已经在缓存里的（排程是同步的，拿不到就先不出声，下一轮 tick 再来） */
export function getVoiceBuffer(input: Partial<VoiceSpec>): AudioBuffer | null {
  return cache.get(voiceKey(input)) ?? null;
}

/** 确定性噪声：同一个 spec 在同一台机器上必须生成同一段采样，所以不能用 Math.random */
function seededNoise(length: number, seed = 0x9e3779b9): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    out[i] = (state / 0xffffffff) * 2 - 1;
  }
  return out;
}

function offlineCtor(): typeof OfflineAudioContext | null {
  if (typeof window === 'undefined') return null;
  return window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext ?? null;
}

/**
 * 把一段人声算成 AudioBuffer。
 *
 * `ms` 是上限：计划算出来多长就多长，超过上限就截断（片段被裁短时用）。
 */
export async function renderVoiceBuffer(input: Partial<VoiceSpec>, opts: { sampleRate?: number; ms?: number } = {}): Promise<AudioBuffer | null> {
  const spec = normalizeVoiceSpec(input);
  const plan = buildVoicePlan(spec);
  const sampleRate = Math.max(8000, Math.min(96000, Math.round(opts.sampleRate ?? 44100)));
  const totalMs = Math.max(120, Math.min(opts.ms ?? plan.totalMs, plan.totalMs));
  const frames = Math.ceil((totalMs / 1000) * sampleRate);
  const Ctor = offlineCtor();
  if (!Ctor) return null;

  try {
    const ctx = new Ctor(1, frames, sampleRate);
    const master = ctx.createGain();
    master.gain.value = 0.62;
    master.connect(ctx.destination);

    /* 共用的确定性噪声底：辅音与气声都从这里取 */
    const noiseBuf = ctx.createBuffer(1, Math.max(1, Math.round(sampleRate * 0.5)), sampleRate);
    noiseBuf.getChannelData(0).set(seededNoise(noiseBuf.length));

    const scale = FORMANT_SCALE[spec.preset];
    /** 上一个音节的结束基频：演唱时的滑音从这里出发，不是凭空跳到目标音 */
    let lastF0 = plan.notes[0]?.f0 ?? spec.root;

    for (const note of plan.notes) {
      if (note.atMs >= totalMs) continue;
      /*
       * 辅音抢拍：音节以清辅音开头时，让辅音提前进来，元音才落在拍点上。
       * 这是歌声合成里的常规做法（OpenUtau 的 consonant velocity），不提前的话
       * 每个字听起来都「慢半拍」。
       */
      const leadMs = Math.min(60, note.phonemes[0] && !PHONEMES[note.phonemes[0].ph]?.voiced ? (note.phonemes[0].ms ?? 0) * 0.7 : 0);
      const start = Math.max(0, note.atMs - leadMs) / 1000;
      const dur = Math.min(note.ms + leadMs, Math.max(0, totalMs - Math.max(0, note.atMs - leadMs))) / 1000;
      if (dur <= 0.02) continue;

      /* ── 声门源 ── */
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      /* 滑音：从上一个音滑到本音（唱连句时这是「不走音」的关键） */
      const glide = Math.min(0.06, dur * 0.25);
      osc.frequency.setValueAtTime(Math.max(40, lastF0), start);
      osc.frequency.linearRampToValueAtTime(Math.max(40, note.f0), start + glide);
      osc.frequency.linearRampToValueAtTime(Math.max(40, note.f0End), start + dur);
      lastF0 = note.f0End;

      /* 颤音：连到 frequency 上是「加」上去，所以幅度要按当前基频比例给 */
      if (spec.vibrato > 0.001) {
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = spec.mode === 'sing' ? 5.4 : 3.2;
        lfoGain.gain.value = note.f0 * 0.022 * spec.vibrato;
        lfo.connect(lfoGain).connect(osc.frequency);
        lfo.start(start);
        lfo.stop(start + dur + 0.05);
      }

      /* ── 三个共振峰（并联带通） ── */
      const formantGain: GainNode[] = [];
      const formants = [
        { q: 7, amp: 1 },
        { q: 10, amp: 0.55 },
        { q: 14, amp: 0.3 },
      ].map((cfg) => {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = cfg.q;
        bp.frequency.setValueAtTime(PHONEMES[note.phonemes[0]?.ph ?? 'a']?.f1 ?? 700, start);
        const g = ctx.createGain();
        g.gain.value = cfg.amp;
        osc.connect(bp).connect(g);
        formantGain.push(g);
        return bp;
      });

      /* ── 噪声支路（辅音 / 气声） ── */
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuf;
      noise.loop = true;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.Q.value = 1.6;
      noiseFilter.frequency.setValueAtTime(2500, start);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.0001, start);
      noise.connect(noiseFilter).connect(noiseGain);

      /* 气声底：浊音段也给一点噪声，听起来不像纯蜂鸣器 */
      if (spec.breath > 0.001) {
        const airGain = ctx.createGain();
        airGain.gain.setValueAtTime(0.0001, start);
        airGain.gain.linearRampToValueAtTime(spec.breath * 0.05, start + 0.03);
        airGain.gain.linearRampToValueAtTime(0.0001, start + dur);
        noise.connect(airGain).connect(master);
      }

      /* ── 总包络 ── */
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, start);
      for (const g of formantGain) g.connect(amp);
      noiseGain.connect(amp);
      amp.connect(master);

      /* ── 逐音素：共振峰搬位置、噪声开门、振幅换档 ── */
      let t = start;
      for (const item of note.phonemes) {
        const ph = PHONEMES[item.ph] ?? PHONEMES.a!;
        const segMs = item.ms;
        const segEnd = Math.min(start + dur, t + segMs / 1000);
        const glide = Math.min(0.045, (segEnd - t) * 0.5);

        if (ph.voiced) {
          const [f1, f2, f3] = [ph.f1 * scale, ph.f2 * scale, ph.f3 * scale];
          formants[0]!.frequency.linearRampToValueAtTime(f1, t + glide);
          formants[1]!.frequency.linearRampToValueAtTime(f2, t + glide);
          formants[2]!.frequency.linearRampToValueAtTime(f3, t + glide);
          amp.gain.linearRampToValueAtTime(ph.gain * 0.9, t + glide);
          noiseGain.gain.linearRampToValueAtTime(0.0001, t + glide);
        } else if (ph.noise) {
          const [lo, hi] = ph.noise;
          noiseFilter.frequency.linearRampToValueAtTime(Math.sqrt(lo * hi) * scale, t + glide);
          noiseFilter.Q.value = 1.1;
          noiseGain.gain.linearRampToValueAtTime(ph.gain, t + Math.min(0.012, segMs / 3000));
          noiseGain.gain.linearRampToValueAtTime(0.0001, segEnd);
          /* 清音段声门几乎不振动：压低浊音支路，否则辅音会被元音盖住 */
          amp.gain.linearRampToValueAtTime(0.06, t + glide);
        }
        t = segEnd;
      }
      amp.gain.linearRampToValueAtTime(0.0001, start + dur);

      osc.start(start);
      osc.stop(start + dur + 0.02);
      noise.start(start);
      noise.stop(start + dur + 0.02);
    }

    return await ctx.startRendering();
  } catch {
    return null;
  }
}

/** 有就返回，没有就算一次（并发调用共享同一个 Promise，避免同段人声算两遍） */
export async function ensureVoiceBuffer(input: Partial<VoiceSpec>, opts: { sampleRate?: number } = {}): Promise<AudioBuffer | null> {
  const key = voiceKey(input);
  const hit = cache.get(key);
  if (hit) return hit;
  const running = pending.get(key);
  if (running) return running;
  const job = renderVoiceBuffer(input, opts).then((buf) => {
    pending.delete(key);
    if (buf) {
      /* 缓存别无限长：留最近 12 段 */
      if (cache.size > 12) cache.clear();
      cache.set(key, buf);
    }
    return buf;
  });
  pending.set(key, job);
  return job;
}

/**
 * 排程前先把所有用到的人声算好。
 *
 * 离线渲染必须走这一步：`scheduleRange` 是同步的，缓冲区不在缓存里那一层就静默不出声。
 * 预览路径没有它也能活 —— 第一次 tick 会空过，等 `ensureVoiceBuffer` 回来下一轮就响。
 */
export async function preloadVoiceLayers(
  layers: { type: string; voice?: Partial<VoiceSpec> | null }[],
  opts: { sampleRate?: number } = {},
): Promise<number> {
  const specs = layers
    .filter((l) => l.type === 'audio' && l.voice && (l.voice.text ?? '').trim().length > 0)
    .map((l) => l.voice as Partial<VoiceSpec>);
  if (!specs.length) return 0;
  const seen = new Set<string>();
  let rendered = 0;
  for (const spec of specs) {
    const key = voiceKey(spec);
    if (seen.has(key)) continue;
    seen.add(key);
    if (cache.has(key)) continue;
    const buf = await ensureVoiceBuffer(spec, opts);
    if (buf) rendered += 1;
  }
  return rendered;
}

/** 自检与调试用：清干净缓存 */
export function clearVoiceCache(): void {
  cache.clear();
  pending.clear();
}
