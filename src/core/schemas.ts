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
});

/** 程序化音源。marks 是「相对图层起点」的毫秒数组，chime 用它标章节切换 */
export const zToneSpec = z.object({
  preset: z.enum(['pad', 'pulse', 'chime']),
  root: z.number().min(20).max(4000),
  bpm: z.number().min(20).max(300),
  chord: z.array(z.number().min(-36).max(36)).max(8),
  marks: z.array(z.number().min(0).max(600_000)).max(128),
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
});

export const zBase64DataUrl = z
  .string()
  .min(32)
  .max(64_000_000)
  .regex(/^data:[^;]+;base64,/, '必须是 data URL（base64）');
