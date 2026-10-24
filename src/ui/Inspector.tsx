import { useMemo } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Code2,
  Copy,
  Image as ImageIcon,
  MonitorSmartphone,
  RotateCcw,
  Square,
  Trash2,
  Type,
  Video,
} from 'lucide-react';
import { exec } from '@/core/commandBus';
import { updateUi, useEditor } from '@/core/store';
import type {
  AnimPreset,
  BlendMode,
  CodeEngine,
  EasingName,
  FitMode,
  GradientSpec,
  Layer,
  TextLayer,
} from '@/core/types';
import { ANIM_PRESETS, BLEND_MODES, BINDING_TARGETS, CODE_ENGINES, EASINGS } from '@/core/types';
import { defaultTextStyle } from '@/core/defaults';
import {
  Badge,
  Button,
  ColorInput,
  EmptyState,
  Field,
  IconButton,
  NumberInput,
  Section,
  Select,
  Slider,
  TextInput,
  Toggle,
  cx,
} from './primitives';

const BLEND_LABELS: Record<string, string> = {
  normal: '正常',
  multiply: '正片叠底',
  screen: '滤色',
  overlay: '叠加',
  lighten: '变亮',
  darken: '变暗',
  difference: '差值',
  'hard-light': '强光',
  'soft-light': '柔光',
};

const PRESET_LABELS: Record<string, string> = {
  none: '无',
  fade: '淡入',
  'slide-up': '上滑',
  'slide-down': '下滑',
  'slide-left': '左滑',
  'slide-right': '右滑',
  'zoom-in': '放大进入',
  'zoom-out': '缩小进入',
  pulse: '脉冲',
  float: '漂浮',
  spin: '旋转',
};

function layerIcon(type: Layer['type']) {
  switch (type) {
    case 'text':
      return <Type size={13} />;
    case 'image':
      return <ImageIcon size={13} />;
    case 'video':
      return <Video size={13} />;
    case 'code':
      return <Code2 size={13} />;
    default:
      return <Square size={13} />;
  }
}

function GradientEditor({ value, onChange }: { value: GradientSpec; onChange: (g: GradientSpec) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Select
          value={value.type}
          options={[
            { value: 'linear', label: '线性' },
            { value: 'radial', label: '径向' },
          ]}
          onChange={(v) => onChange({ ...value, type: v })}
        />
        <NumberInput value={value.angle} onCommit={(angle) => onChange({ ...value, angle })} min={0} max={360} suffix="°" />
      </div>
      <div
        className="border-ink-600 h-4 w-full rounded border"
        style={{
          background: `linear-gradient(${value.angle}deg, ${[...value.stops]
            .sort((a, b) => a.offset - b.offset)
            .map((s) => `${s.color} ${s.offset * 100}%`)
            .join(',')})`,
        }}
      />
      {value.stops.map((stop, i) => (
        <div key={i} className="flex items-center gap-1">
          <ColorInput
            value={stop.color}
            onChange={(color) => {
              const stops = value.stops.map((s, j) => (j === i ? { ...s, color } : s));
              onChange({ ...value, stops });
            }}
          />
          <NumberInput
            value={Math.round(stop.offset * 100)}
            onCommit={(v) => {
              const stops = value.stops.map((s, j) => (j === i ? { ...s, offset: v / 100 } : s));
              onChange({ ...value, stops });
            }}
            min={0}
            max={100}
            suffix="%"
            className="w-20"
          />
          {value.stops.length > 2 && (
            <button
              type="button"
              className="text-zinc-600 hover:text-rose-400"
              onClick={() => onChange({ ...value, stops: value.stops.filter((_, j) => j !== i) })}
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      ))}
      {value.stops.length < 8 && (
        <Button size="sm" variant="outline" className="w-full" onClick={() => onChange({ ...value, stops: [...value.stops, { offset: 1, color: '#ffffff' }] })}>
          + 增加色标
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- canvas view */

function CanvasInspector() {
  const project = useEditor((s) => s.project);
  const bg = project.layers[0];
  const showSafeArea = useEditor((s) => s.ui.showSafeArea);
  const snapping = useEditor((s) => s.ui.snapping);

  return (
    <div className="flex h-full flex-col">
      <div className="border-ink-700/70 flex h-9 items-center gap-2 border-b px-3">
        <span className="text-[11px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">画布 / 背景</span>
        <Badge>{project.width}×{project.height}</Badge>
      </div>
      <div className="ml-scroll flex-1 overflow-y-auto">
        <Section title="画布">
          <div className="grid grid-cols-2 gap-1.5">
            <Field label="宽">
              <NumberInput value={project.width} onCommit={(width) => void exec('canvas.resize', { width, height: project.height, scaleContent: true })} min={16} max={8192} suffix="px" />
            </Field>
            <Field label="高">
              <NumberInput value={project.height} onCommit={(height) => void exec('canvas.resize', { width: project.width, height, scaleContent: true })} min={16} max={8192} suffix="px" />
            </Field>
            <Field label="时长">
              <NumberInput value={project.duration} onCommit={(duration) => void exec('canvas.setDuration', { duration })} min={100} max={600000} step={100} suffix="ms" />
            </Field>
            <Field label="帧率">
              <NumberInput value={project.fps} onCommit={(fps) => void exec('canvas.setFps', { fps })} min={1} max={60} suffix="fps" />
            </Field>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Toggle value={showSafeArea} onChange={(v) => updateUi((ui) => { ui.showSafeArea = v; })} label="安全区" />
            <Toggle value={snapping} onChange={(v) => updateUi((ui) => { ui.snapping = v; })} label="吸附" />
            <Toggle value={project.loop} onChange={(v) => void exec('timeline.setLoop', { loop: v })} label="循环" />
          </div>
        </Section>

        {bg && bg.type === 'background' && (
          <Section title="背景">
            <Select
              value={bg.kind}
              options={[
                { value: 'solid', label: '纯色' },
                { value: 'gradient', label: '渐变' },
                { value: 'image', label: '图片' },
                { value: 'code', label: '代码驱动' },
              ]}
              onChange={(kind) => void exec('background.set', { kind })}
            />
            {bg.kind === 'solid' && (
              <Field label="颜色">
                <ColorInput value={bg.color} onChange={(color) => void exec('background.set', { color })} />
              </Field>
            )}
            {bg.kind === 'gradient' && (
              <GradientEditor value={bg.gradient} onChange={(gradient) => void exec('background.set', { gradient })} />
            )}
            {bg.kind === 'image' && (
              <div className="space-y-1.5">
                <p className="text-[10.5px] leading-relaxed text-zinc-500">
                  在左侧「资源」里选一张图，点「设为背景」，或用命令 background.set 指定 assetId。
                </p>
                <Select
                  value={bg.fit}
                  options={[
                    { value: 'cover', label: '覆盖' },
                    { value: 'contain', label: '包含' },
                    { value: 'fill', label: '拉伸' },
                  ]}
                  onChange={(fit) => void exec('background.set', { fit })}
                />
              </div>
            )}
            {bg.kind === 'code' && (
              <Button
                size="sm"
                variant="accent"
                className="w-full"
                onClick={() => updateUi((ui) => { ui.codeEditorFor = bg.id; })}
              >
                <Code2 size={12} /> 编辑背景代码
              </Button>
            )}
          </Section>
        )}

        <Section title="操作提示" defaultOpen>
          <ul className="space-y-1 text-[10.5px] leading-relaxed text-zinc-500">
            <li>· 空格 + 拖拽：平移画布；Ctrl + 滚轮：缩放</li>
            <li>· 双击文本层：就地编辑；拖拽手柄缩放，顶部圆点旋转</li>
            <li>· 选中后按方向键微调 1px（Shift 为 10px）</li>
            <li>· 所有改动都会进入同一个撤销栈</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- inspector */

export function Inspector() {
  const project = useEditor((s) => s.project);
  const activeId = useEditor((s) => s.ui.activeLayerId);
  const layer = useMemo(() => project.layers.find((l) => l.id === activeId) ?? null, [project, activeId]);

  if (!layer) return <CanvasInspector />;

  const update = (patch: Record<string, unknown>) => void exec('layer.update', { id: layer.id, patch });
  const isBg = layer.type === 'background';

  return (
    <div className="flex h-full flex-col">
      <div className="border-ink-700/70 flex h-9 items-center gap-2 border-b px-2.5">
        <span className="text-zinc-500">{layerIcon(layer.type)}</span>
        <TextInput
          value={layer.name}
          onCommit={(name) => name.trim() && void exec('layer.rename', { id: layer.id, name: name.trim() })}
          className="h-6 flex-1 border-transparent bg-transparent px-1 text-[11.5px] hover:border-ink-700"
        />
        <IconButton size={22} title="复制图层" onClick={() => void exec('layer.duplicate', { ids: [layer.id] })}>
          <Copy size={12} />
        </IconButton>
        {!isBg && (
          <>
            <IconButton size={22} title="独立窗口" onClick={() => void exec('window.openLayer', { layerId: layer.id, mode: 'auto' })}>
              <MonitorSmartphone size={12} />
            </IconButton>
            <IconButton
              size={22}
              title="删除图层"
              onClick={() => {
                if (confirm(`删除「${layer.name}」？`)) void exec('layer.delete', { ids: [layer.id], force: false });
              }}
            >
              <Trash2 size={12} />
            </IconButton>
          </>
        )}
      </div>

      <div className="ml-scroll flex-1 overflow-y-auto pb-8">
        {!isBg && (
          <Section title="变换">
            <div className="grid grid-cols-2 gap-1.5">
              <Field label="X">
                <NumberInput value={layer.x} onCommit={(x) => update({ x })} suffix="px" />
              </Field>
              <Field label="Y">
                <NumberInput value={layer.y} onCommit={(y) => update({ y })} suffix="px" />
              </Field>
              <Field label="宽">
                <NumberInput value={layer.width} onCommit={(width) => update({ width })} min={1} suffix="px" />
              </Field>
              <Field label="高">
                <NumberInput value={layer.height} onCommit={(height) => update({ height })} min={1} suffix="px" />
              </Field>
              <Field label="旋转">
                <NumberInput value={layer.rotation} onCommit={(rotation) => update({ rotation })} suffix="°" />
              </Field>
              <Field label="对齐">
                <div className="flex gap-0.5">
                  {(['left', 'center-x', 'right'] as const).map((mode) => (
                    <IconButton key={mode} size={20} title={`对齐 ${mode}`} onClick={() => void exec('layer.align', { ids: [layer.id], mode })}>
                      {mode === 'left' ? <AlignLeft size={11} /> : mode === 'right' ? <AlignRight size={11} /> : <AlignCenter size={11} />}
                    </IconButton>
                  ))}
                </div>
              </Field>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() =>
                update({
                  x: Math.round((project.width - layer.width) / 2),
                  y: Math.round((project.height - layer.height) / 2),
                  rotation: 0,
                })
              }
            >
              <RotateCcw size={11} /> 居中并复位旋转
            </Button>
          </Section>
        )}

        <Section title="外观">
          <Slider label="不透明度" value={layer.opacity} min={0} max={1} step={0.01} onChange={(opacity) => update({ opacity })} format={(v) => `${Math.round(v * 100)}%`} />
          <Field label="混合模式">
            <Select
              value={layer.blendMode}
              options={BLEND_MODES.map((b) => ({ value: b as BlendMode, label: BLEND_LABELS[b] ?? b }))}
              onChange={(blendMode) => update({ blendMode })}
            />
          </Field>
          <div className="flex items-center gap-4 pt-1">
            <Toggle value={layer.visible} onChange={(visible) => void exec('layer.setVisible', { id: layer.id, visible })} label="可见" />
            {!isBg && <Toggle value={layer.locked} onChange={(locked) => void exec('layer.setLocked', { id: layer.id, locked })} label="锁定" />}
          </div>
        </Section>

        {layer.type === 'text' && <TextSection layer={layer} />}
        {layer.type === 'image' && <ImageSection layer={layer} />}
        {layer.type === 'video' && <VideoSection layer={layer} />}
        {layer.type === 'code' && <CodeSection layer={layer} />}

        <Section title="动画" defaultOpen={false}>
          {(['enter', 'exit', 'emphasis'] as const).map((slot) => {
            const anim = layer.animation?.[slot];
            const label = slot === 'enter' ? '入场' : slot === 'exit' ? '退场' : '强调';
            return (
              <div key={slot} className="border-ink-700/60 space-y-1.5 rounded border p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] font-medium text-zinc-400">{label}</span>
                  {anim && (
                    <button
                      type="button"
                      className="text-[10px] text-zinc-600 hover:text-rose-400"
                      onClick={() => void exec('layer.setAnimation', { id: layer.id, animation: { [slot]: null } })}
                    >
                      清除
                    </button>
                  )}
                </div>
                <Select
                  value={(anim?.preset ?? 'none') as AnimPreset}
                  options={ANIM_PRESETS.map((p) => ({ value: p, label: PRESET_LABELS[p] ?? p }))}
                  onChange={(preset) =>
                    void exec('layer.setAnimation', {
                      id: layer.id,
                      animation: {
                        [slot]:
                          preset === 'none'
                            ? null
                            : { ...(anim ?? { duration: 700, delay: 0, easing: 'ease-out', intensity: 0.6 }), preset },
                      },
                    })
                  }
                />
                {anim && (
                  <>
                    <div className="grid grid-cols-2 gap-1.5">
                      <Field label="时长">
                        <NumberInput value={anim.duration} onCommit={(duration) => void exec('layer.setAnimation', { id: layer.id, animation: { [slot]: { ...anim, duration } } })} min={0} max={20000} step={50} suffix="ms" />
                      </Field>
                      <Field label="延迟">
                        <NumberInput value={anim.delay} onCommit={(delay) => void exec('layer.setAnimation', { id: layer.id, animation: { [slot]: { ...anim, delay } } })} min={0} max={20000} step={50} suffix="ms" />
                      </Field>
                    </div>
                    <Field label="曲线">
                      <Select
                        value={anim.easing}
                        options={EASINGS.map((e) => ({ value: e as EasingName, label: e }))}
                        onChange={(easing) => void exec('layer.setAnimation', { id: layer.id, animation: { [slot]: { ...anim, easing } } })}
                      />
                    </Field>
                    <Slider label="强度" value={anim.intensity} min={0} max={1} step={0.05} onChange={(intensity) => void exec('layer.setAnimation', { id: layer.id, animation: { [slot]: { ...anim, intensity } } })} format={(v) => `${Math.round(v * 100)}%`} />
                  </>
                )}
              </div>
            );
          })}
        </Section>

        <Section title="属性绑定（表达式）" defaultOpen={false}>
          <p className="text-[10px] leading-relaxed text-zinc-600">
            每帧求值，可用 time(ms)、w、h、i 与 Math 函数。例如 rotation = sin(time*0.001)*6。
          </p>
          {BINDING_TARGETS.map((target) => (
            <Field key={target} label={target}>
              <TextInput
                value={layer.bindings?.[target] ?? ''}
                onCommit={(value) =>
                  void exec('layer.setBindings', { id: layer.id, bindings: { ...(layer.bindings ?? {}), [target]: value } })
                }
                placeholder="留空表示不绑定"
                className="font-mono text-[10.5px]"
              />
            </Field>
          ))}
        </Section>

        {!isBg && (
          <Section title="时间轴区间" defaultOpen={false}>
            <div className="grid grid-cols-2 gap-1.5">
              <Field label="出现">
                <NumberInput
                  value={layer.inPoint}
                  onCommit={(inPoint) => void exec('timeline.setLayerTiming', { id: layer.id, inPoint })}
                  min={0}
                  max={project.duration}
                  step={50}
                  suffix="ms"
                />
              </Field>
              <Field label="消失">
                <NumberInput
                  value={layer.outPoint}
                  onCommit={(outPoint) => void exec('timeline.setLayerTiming', { id: layer.id, outPoint })}
                  min={0}
                  max={project.duration}
                  step={50}
                  suffix="ms"
                />
              </Field>
            </div>
            <p className="text-[10px] text-zinc-600">消失填 0 表示持续到结尾。</p>
          </Section>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ type sections */

function TextSection({ layer }: { layer: TextLayer }) {
  const style = layer.style;
  const setStyle = (patch: Partial<import('@/core/types').TextStyle>) => void exec('text.setStyle', { id: layer.id, style: patch });
  const fonts = useEditor((s) => s.project.fonts);

  return (
    <Section title="文本">
      <textarea
        value={layer.text}
        onChange={(e) => void exec('text.setContent', { id: layer.id, text: e.target.value })}
        rows={3}
        className="border-ink-700 w-full resize-y rounded-md border bg-ink-900/80 p-2 text-[11.5px] leading-relaxed text-zinc-200 outline-none focus:border-accent/60"
      />
      <div className="grid grid-cols-2 gap-1.5">
        <Field label="字号">
          <NumberInput value={style.fontSize} onCommit={(fontSize) => setStyle({ fontSize })} min={4} max={800} suffix="px" />
        </Field>
        <Field label="字重">
          <Select
            value={String(style.fontWeight)}
            options={['300', '400', '500', '600', '700', '800', '900'].map((w) => ({ value: w, label: w }))}
            onChange={(w) => setStyle({ fontWeight: Number(w) })}
          />
        </Field>
        <Field label="行高">
          <NumberInput value={style.lineHeight} onCommit={(lineHeight) => setStyle({ lineHeight })} min={0.6} max={4} step={0.05} />
        </Field>
        <Field label="字距">
          <NumberInput value={style.letterSpacing} onCommit={(letterSpacing) => setStyle({ letterSpacing })} min={-20} max={80} step={0.5} suffix="px" />
        </Field>
      </div>
      <Field label="字体">
        <Select
          value={style.fontFamily}
          options={Array.from(
            new Set([
              style.fontFamily,
              'Segoe UI',
              'Microsoft YaHei',
              'PingFang SC',
              'Inter',
              'Georgia',
              'Times New Roman',
              'Arial',
              'Consolas',
              ...fonts.map((f) => f.family),
            ]),
          ).map((f) => ({ value: f, label: f }))}
          onChange={(fontFamily) => setStyle({ fontFamily })}
        />
      </Field>
      <div className="flex items-center gap-1">
        {(['left', 'center', 'right'] as const).map((align) => (
          <IconButton key={align} size={22} active={style.align === align} onClick={() => setStyle({ align })}>
            {align === 'left' ? <AlignLeft size={12} /> : align === 'center' ? <AlignCenter size={12} /> : <AlignRight size={12} />}
          </IconButton>
        ))}
        <div className="flex-1" />
        <Select
          value={style.verticalAlign}
          options={[
            { value: 'top', label: '顶对齐' },
            { value: 'middle', label: '居中' },
            { value: 'bottom', label: '底对齐' },
          ]}
          onChange={(verticalAlign) => setStyle({ verticalAlign })}
          className="w-24"
        />
      </div>
      <div className="flex items-center gap-3">
        <Toggle value={style.wrap} onChange={(wrap) => setStyle({ wrap })} label="自动换行" />
        <Toggle value={style.uppercase} onChange={(uppercase) => setStyle({ uppercase })} label="大写" />
      </div>
      <Field label="填充">
        {style.useGradient ? (
          <GradientEditor value={style.gradient} onChange={(gradient) => setStyle({ gradient })} />
        ) : (
          <ColorInput value={style.color} onChange={(color) => setStyle({ color })} />
        )}
      </Field>
      <Toggle value={style.useGradient} onChange={(useGradient) => setStyle({ useGradient })} label="使用渐变填充" />
      <div className="grid grid-cols-2 gap-1.5">
        <Field label="描边">
          <div className="flex items-center gap-1">
            <ColorInput value={style.stroke?.color ?? '#000000'} onChange={(color) => setStyle({ stroke: { color, width: style.stroke?.width ?? 2 } })} />
            <NumberInput value={style.stroke?.width ?? 0} onCommit={(width) => setStyle({ stroke: width > 0 ? { color: style.stroke?.color ?? '#000000', width } : null })} min={0} max={40} className="w-16" />
          </div>
        </Field>
        <Field label="阴影模糊">
          <NumberInput
            value={style.shadow?.blur ?? 0}
            onCommit={(blur) =>
              setStyle({ shadow: blur > 0 ? { color: style.shadow?.color ?? 'rgba(0,0,0,.45)', blur, x: style.shadow?.x ?? 0, y: style.shadow?.y ?? 8 } : null })
            }
            min={0}
            max={200}
          />
        </Field>
      </div>
      <Button size="sm" variant="outline" className="w-full" onClick={() => setStyle(defaultTextStyle())}>
        重置文本样式
      </Button>
    </Section>
  );
}

function ImageSection({ layer }: { layer: Extract<Layer, { type: 'image' }> }) {
  const asset = useEditor((s) => s.project.assets.find((a) => a.id === layer.assetId));
  const update = (patch: Record<string, unknown>) => void exec('layer.update', { id: layer.id, patch });
  return (
    <Section title="图片">
      <div className="flex items-center gap-2 rounded border border-ink-700 bg-ink-900/60 p-2">
        <ImageIcon size={14} className="text-zinc-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-zinc-300">{asset?.name ?? '未选择资源'}</div>
          <div className="text-[10px] text-zinc-600">
            {asset ? `${asset.width ?? '?'}×${asset.height ?? '?'} · ${(asset.size / 1024).toFixed(0)}KB` : '在左侧资源面板导入'}
          </div>
        </div>
      </div>
      <Field label="填充方式">
        <Select
          value={layer.fit}
          options={[
            { value: 'cover' as FitMode, label: '覆盖' },
            { value: 'contain' as FitMode, label: '包含' },
            { value: 'fill' as FitMode, label: '拉伸' },
          ]}
          onChange={(fit) => update({ fit })}
        />
      </Field>
      <Field label="圆角">
        <NumberInput value={layer.radius} onCommit={(radius) => update({ radius })} min={0} max={2000} suffix="px" />
      </Field>
      <Slider label="亮度" value={layer.brightness} min={0} max={2} step={0.01} onChange={(brightness) => update({ brightness })} />
      <Slider label="对比度" value={layer.contrast} min={0} max={2} step={0.01} onChange={(contrast) => update({ contrast })} />
      <Slider label="饱和度" value={layer.saturate} min={0} max={3} step={0.01} onChange={(saturate) => update({ saturate })} />
      <Slider label="灰度" value={layer.grayscale} min={0} max={1} step={0.01} onChange={(grayscale) => update({ grayscale })} />
      <Slider label="模糊" value={layer.blur} min={0} max={40} step={0.5} onChange={(blur) => update({ blur })} />
    </Section>
  );
}

function VideoSection({ layer }: { layer: Extract<Layer, { type: 'video' }> }) {
  const asset = useEditor((s) => s.project.assets.find((a) => a.id === layer.assetId));
  const update = (patch: Record<string, unknown>) => void exec('layer.update', { id: layer.id, patch });
  return (
    <Section title="视频">
      <div className="flex items-center gap-2 rounded border border-ink-700 bg-ink-900/60 p-2">
        <Video size={14} className="text-zinc-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-zinc-300">{asset?.name ?? '未选择视频资源'}</div>
          <div className="text-[10px] text-zinc-600">由主时钟 seek 驱动，预览与导出取同一帧</div>
        </div>
      </div>
      <Field label="填充方式">
        <Select
          value={layer.fit}
          options={[
            { value: 'cover' as FitMode, label: '覆盖' },
            { value: 'contain' as FitMode, label: '包含' },
            { value: 'fill' as FitMode, label: '拉伸' },
          ]}
          onChange={(fit) => update({ fit })}
        />
      </Field>
      <Field label="圆角">
        <NumberInput value={layer.radius} onCommit={(radius) => update({ radius })} min={0} max={2000} suffix="px" />
      </Field>
      <div className="flex items-center gap-4">
        <Toggle value={layer.muted} onChange={(muted) => update({ muted })} label="静音" />
        <Toggle value={layer.loop} onChange={(loop) => update({ loop })} label="循环" />
      </div>
      <Slider label="播放速度" value={layer.playbackRate} min={0.25} max={3} step={0.05} onChange={(playbackRate) => update({ playbackRate })} format={(v) => `${v.toFixed(2)}×`} />
    </Section>
  );
}

function CodeSection({ layer }: { layer: Extract<Layer, { type: 'code' }> }) {
  const open = () => updateUi((ui) => { ui.codeEditorFor = layer.id; });
  const paramsJson = useMemo(() => JSON.stringify(layer.code.params, null, 2), [layer.code.params]);
  return (
    <Section title="代码">
      <Field label="引擎">
        <Select
          value={layer.code.engine}
          options={CODE_ENGINES.map((e) => ({ value: e as CodeEngine, label: e }))}
          onChange={(engine) => void exec('code.setEngine', { id: layer.id, engine })}
        />
      </Field>
      <div className="flex items-center justify-between">
        <Badge tone="cyan">{layer.code.source.split('\n').length} 行</Badge>
        <Button size="sm" variant="accent" onClick={open}>
          <Code2 size={11} /> 打开编辑器
        </Button>
      </div>
      <Field label="参数 params（JSON）">
        <textarea
          defaultValue={paramsJson}
          key={paramsJson}
          rows={3}
          spellCheck={false}
          onBlur={(e) => {
            try {
              const params = JSON.parse(e.target.value || '{}');
              void exec('code.setParams', { id: layer.id, params });
            } catch {
              /* 保留原值 */
            }
          }}
          className={cx(
            'border-ink-700 w-full rounded border bg-ink-950 p-2 font-mono text-[10.5px] text-zinc-300 outline-none focus:border-accent/60',
          )}
        />
      </Field>
    </Section>
  );
}

export { EmptyState };
