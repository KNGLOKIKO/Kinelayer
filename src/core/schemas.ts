import { z } from 'zod';

export const zId = z.string().min(1).max(64).describe('图层或资源的 id');
export const zIds = z.array(zId).min(1).max(200);

export const zColor = z
  .string()
  .min(1)
  .max(80)
  .describe('CSS 颜色，如 #ffffff / rgba(0,0,0,.4)');

export const zGradient = z.object({
  type: z.enum(['linear', 'radial']).default('linear'),
  angle: z.number().min(0).max(360).default(135),
  stops: z
    .array(
      z.object({
        offset: z.number().min(0).max(1),
        color: zColor,
      }),
    )
    .min(2)
    .max(8),
});

export const zEasing = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'ease-in-quad',
  'ease-out-quad',
  'ease-in-cubic',
  'ease-out-cubic',
  'ease-out-back',
  'ease-out-elastic',
]);

export const zAnimPreset = z.enum([
  'none',
  'fade',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'zoom-in',
  'zoom-out',
  'pulse',
  'float',
  'spin',
]);

export const zAnim = z.object({
  preset: zAnimPreset.default('fade'),
  duration: z.number().min(0).max(20_000).default(600),
  delay: z.number().min(0).max(20_000).default(0),
  easing: zEasing.default('ease-out'),
  intensity: z.number().min(0).max(1).default(0.6),
});

export const zAnimatableProperty = z.enum([
  'x',
  'y',
  'width',
  'height',
  'rotation',
  'opacity',
  'fontSize',
  'letterSpacing',
]);

export const zEasingSpec = z.object({
  kind: z
    .enum([
      'linear',
      'ease-in',
      'ease-out',
      'ease-in-out',
      'ease-in-quad',
      'ease-out-quad',
      'ease-in-cubic',
      'ease-out-cubic',
      'ease-out-back',
      'ease-out-elastic',
      'cubic-bezier',
    ])
    .default('ease-out'),
  /** kind = cubic-bezier 时生效，与 CSS cubic-bezier 同义 */
  bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
});

export const zKeyframe = z.object({
  id: z.string().max(64).optional(),
  /** 相对图层 inPoint 的毫秒数（不是绝对时间） */
  time: z.number().min(-600_000).max(600_000),
  value: z.number(),
  easing: zEasingSpec.optional(),
});

export const zTrack = z.object({
  property: zAnimatableProperty,
  keyframes: z.array(zKeyframe).max(500),
});

export const zAnimation = z.object({
  enter: zAnim.nullable().optional(),
  exit: zAnim.nullable().optional(),
  emphasis: zAnim.nullable().optional(),
  tracks: z.array(zTrack).max(16).optional(),
  autoKeyframe: z.boolean().optional(),
});

export const zTextStyle = z.object({
  fontFamily: z.string().min(1).max(120),
  fontSize: z.number().min(4).max(800),
  fontWeight: z.number().min(100).max(900),
  fontStyle: z.enum(['normal', 'italic']),
  lineHeight: z.number().min(0.6).max(4),
  letterSpacing: z.number().min(-20).max(80),
  align: z.enum(['left', 'center', 'right']),
  verticalAlign: z.enum(['top', 'middle', 'bottom']),
  color: zColor,
  useGradient: z.boolean(),
  gradient: zGradient,
  stroke: z
    .object({ color: zColor, width: z.number().min(0).max(40) })
    .nullable(),
  shadow: z
    .object({
      color: zColor,
      blur: z.number().min(0).max(200),
      x: z.number().min(-100).max(100),
      y: z.number().min(-100).max(100),
    })
    .nullable(),
  wrap: z.boolean(),
  uppercase: z.boolean(),
});

export const zTextStylePatch = zTextStyle.partial();

export const zEngine = z.enum(['canvas2d', 'glsl', 'html']);

export const zCodeSpec = z.object({
  engine: zEngine,
  source: z.string().max(200_000),
  params: z.record(z.union([z.string(), z.number(), z.boolean()])),
  /** 内部分辨率倍率（0.25–1）。低频画面降它换帧率，文字层不要降 */
  renderScale: z.number().min(0.25).max(1).optional(),
  /** 子帧超采样：samples 次绘制叠成一张，shutter 是快门时长（毫秒） */
  motionBlur: z
    .object({
      /** 数字 = 固定次数；'auto' = 按瓦片收敛自适应（导出用，预览会慢） */
      samples: z.union([z.number().int().min(2).max(32), z.literal('auto')]),
      shutter: z.number().min(1).max(200),
      /** 收敛阈值（0..255 色阶），默认 3 */
      tol: z.number().min(0).max(32).optional(),
    })
    .optional(),
});

/** 速度网格（工程级）：画面与声音共用的那一份时间真理 */
export const zTempo = z.object({
  bpm: z.number().min(20).max(300),
  offsetMs: z.number().min(-60_000).max(600_000),
  meter: z.number().int().min(1).max(16),
});

/** 一行歌词：绝对毫秒区间。逐字时间由 core/score.ts 按字符权重切 */
export const zLyricLine = z.object({
  text: z.string().min(1).max(400),
  start: z.number().min(0).max(3_600_000),
  end: z.number().min(0).max(3_600_000),
});

export const zLyrics = z.array(zLyricLine).max(512);

/**
 * 出片区间（毫秒）。工程里存的是 `Project.range`，null 表示整条时间轴。
 *
 * 为什么它进文档而不是进 UI 状态：这段片子要出哪一段，是**工程数据**。
 * 存 ui 里会导致「换台机器打开，导出范围没了」——而导出的正是这一段。
 */
export const zTimeRange = z.object({
  in: z.number().min(0).max(3_600_000),
  out: z.number().min(0).max(3_600_000),
});

export const zMarkerKind = z.enum(['beat', 'note', 'cut']);

/** 程序化音源。marks 是「相对图层起点」的毫秒数组，chime 用它标章节切换 */
export const zToneSpec = z.object({
  preset: z.enum(['pad', 'pulse', 'chime']),
  root: z.number().min(20).max(4000),
  bpm: z.number().min(20).max(300),
  chord: z.array(z.number().min(-36).max(36)).max(8),
  marks: z.array(z.number().min(0).max(600_000)).max(128),
});

/**
 * 人声参数。
 *
 * 上限都写死在这里而不是留给 handler：`text` 是会被合成器逐个音节算一遍的，
 * 给一段十万字的文本进来，界面会卡到用户以为崩了（而且那不是「一句词」的用法）。
 * 旋律限制 64 个音，够一段主歌 + 副歌轮替。
 */
export const zVoiceSpec = z.object({
  text: z.string().min(1).max(400),
  mode: z.enum(['speak', 'sing']),
  preset: z.enum(['female', 'male', 'child', 'robot']),
  root: z.number().min(55).max(660),
  rate: z.number().min(0.5).max(2),
  pitch: z.number().min(-24).max(24),
  vibrato: z.number().min(0).max(1),
  breath: z.number().min(0).max(1),
  melody: z.array(z.number().min(-24).max(24)).max(64),
  beatsPerSyllable: z.number().min(0.25).max(8),
  bpm: z.number().min(30).max(300),
});

export const zBindTarget = z.enum(['x', 'y', 'width', 'height', 'rotation', 'opacity', 'scale']);

export const zBindings = z
  .record(zBindTarget, z.string().max(400))
  .describe('属性表达式绑定，如 {"rotation":"sin(time*0.001)*8"}');

export const zFit = z.enum(['cover', 'contain', 'fill']);

export const zBlend = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'lighten',
  'darken',
  'difference',
  'hard-light',
  'soft-light',
]);

export const zTransition = z
  .object({
    kind: z.enum(['crossfade', 'dip', 'slide', 'wipe']),
    duration: z.number().min(0).max(10_000),
  })
  .nullable();

export const zLayerPatch = z.object({
  name: z.string().min(1).max(80).optional(),
  x: z.number().min(-100_000).max(100_000).optional(),
  y: z.number().min(-100_000).max(100_000).optional(),
  width: z.number().min(1).max(100_000).optional(),
  height: z.number().min(1).max(100_000).optional(),
  rotation: z.number().min(-3600).max(3600).optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  blendMode: zBlend.optional(),
  bindings: zBindings.optional(),
  animation: zAnimation.optional(),
  inPoint: z.number().min(0).max(600_000).optional(),
  outPoint: z.number().min(0).max(600_000).optional(),
  meta: z.record(z.string().max(400)).optional(),
  /* 媒体层字段：这些以前不在白名单里，检查器上的「填充方式 / 播放速度 / 静音」
     改完会被 zod 静默丢掉 —— 用户点了没反应，还查不出原因 */
  fit: zFit.optional(),
  radius: z.number().min(0).max(2000).optional(),
  brightness: z.number().min(0).max(4).optional(),
  contrast: z.number().min(0).max(4).optional(),
  saturate: z.number().min(0).max(4).optional(),
  grayscale: z.number().min(0).max(1).optional(),
  blur: z.number().min(0).max(200).optional(),
  muted: z.boolean().optional(),
  loop: z.boolean().optional(),
  playbackRate: z.number().min(0.1).max(8).optional(),
  trimIn: z.number().min(0).max(24 * 3600_000).optional(),
  transition: zTransition.optional(),
});

export const zBase64DataUrl = z
  .string()
  .min(32)
  .max(64_000_000)
  .regex(/^data:[^;]+;base64,/, '必须是 data URL（base64）');
