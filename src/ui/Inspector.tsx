import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Code2,
  Copy,
  Image as ImageIcon,
  Mic,
  MonitorSmartphone,
  Music,
  Play,
  RotateCcw,
  Square,
  Trash2,
  Type,
  Upload,
  Video,
} from 'lucide-react';
import { exec } from '@/core/commandBus';
import { pushToast, updateUi, useEditor } from '@/core/store';
import type {
  AnimPreset,
  BlendMode,
  CodeEngine,
  EasingName,
  FitMode,
  GradientSpec,
  Layer,
  TextLayer,
  VoiceMode,
  VoicePreset,
} from '@/core/types';
import { ANIM_PRESETS, BLEND_MODES, BINDING_TARGETS, CODE_ENGINES, EASINGS, TONE_PRESETS, TRANSITION_KINDS } from '@/core/types';
import type { TransitionKind } from '@/core/types';
import { previewAudioLayer } from '@/render/audioEngine';
import { MIN_CLIP_MS, TRANSITION_LABEL_KEY as TRANSITION_LABEL } from '@/core/media';
import { defaultTextStyle } from '@/core/defaults';
import { syllablesOf } from '@/core/voice';
import { openVoiceTab } from '@/ui/LeftPanels';
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
import { isAssetMissing, sameRefLayers } from './assetGaps';
import { LyricsSection, TempoSection } from './ScorePanel';
import { uploadAsset } from './uploadAsset';

import { t } from '@/i18n';
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
            { value: 'linear', label: t('线性') },
            { value: 'radial', label: t('径向') },
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
          {t('+ 增加色标')}
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
        <span className="text-[11px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">{t('画布 / 背景')}</span>
        <Badge>{project.width}×{project.height}</Badge>
      </div>
      <div className="ml-scroll flex-1 overflow-y-auto">
        <Section title={t('画布')}>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label={t('宽')}>
              <NumberInput value={project.width} onCommit={(width) => void exec('canvas.resize', { width, height: project.height, scaleContent: true })} min={16} max={8192} suffix="px" />
            </Field>
            <Field label={t('高')}>
              <NumberInput value={project.height} onCommit={(height) => void exec('canvas.resize', { width: project.width, height, scaleContent: true })} min={16} max={8192} suffix="px" />
            </Field>
            <Field label={t('时长')}>
              <NumberInput value={project.duration} onCommit={(duration) => void exec('canvas.setDuration', { duration })} min={100} max={600000} step={100} suffix="ms" />
            </Field>
            <Field label={t('帧率')}>
              <NumberInput value={project.fps} onCommit={(fps) => void exec('canvas.setFps', { fps })} min={1} max={60} suffix="fps" />
            </Field>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Toggle value={showSafeArea} onChange={(v) => updateUi((ui) => { ui.showSafeArea = v; })} label={t('安全区')} />
            <Toggle value={snapping} onChange={(v) => updateUi((ui) => { ui.snapping = v; })} label={t('吸附')} />
            <Toggle value={project.loop} onChange={(v) => void exec('timeline.setLoop', { loop: v })} label={t('循环')} />
          </div>
        </Section>

        {bg && bg.type === 'background' && (
          <Section title={t('背景')}>
            <Select
              value={bg.kind}
              options={[
                { value: 'solid', label: t('纯色') },
                { value: 'gradient', label: t('渐变') },
                { value: 'image', label: t('图片') },
                { value: 'code', label: t('代码驱动') },
              ]}
              onChange={(kind) => void exec('background.set', { kind })}
            />
            {bg.kind === 'solid' && (
              <Field label={t('颜色')}>
                <ColorInput value={bg.color} onChange={(color) => void exec('background.set', { color })} />
              </Field>
            )}
            {bg.kind === 'gradient' && (
              <GradientEditor value={bg.gradient} onChange={(gradient) => void exec('background.set', { gradient })} />
            )}
            {bg.kind === 'image' && (
              <div className="space-y-1.5">
                <p className="text-[10.5px] leading-relaxed text-zinc-500">
                  {t('在左侧「资源」里选一张图，点「设为背景」，或用命令 background.set 指定 assetId。')}
                </p>
                <Select
                  value={bg.fit}
                  options={[
                    { value: 'cover', label: t('覆盖') },
                    { value: 'contain', label: t('包含') },
                    { value: 'fill', label: t('拉伸') },
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
                <Code2 size={12} /> {t('编辑背景代码')}
              </Button>
            )}
          </Section>
        )}

        <TempoSection />
        <LyricsSection />

        <Section title={t('操作提示')} defaultOpen>
          <ul className="space-y-1 text-[10.5px] leading-relaxed text-zinc-500">
            <li>{t('· 空格 + 拖拽：平移画布；Ctrl + 滚轮：缩放')}</li>
            <li>{t('· 双击文本层：就地编辑；拖拽手柄缩放，顶部圆点旋转')}</li>
            <li>{t('· 选中后按方向键微调 1px（Shift 为 10px）')}</li>
            <li>{t('· 所有改动都会进入同一个撤销栈')}</li>
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
        <IconButton size={22} title={t('复制图层')} onClick={() => void exec('layer.duplicate', { ids: [layer.id] })}>
          <Copy size={12} />
        </IconButton>
        {!isBg && (
          <>
            <IconButton size={22} title={t('独立窗口')} onClick={() => void exec('window.openLayer', { layerId: layer.id, mode: 'auto' })}>
              <MonitorSmartphone size={12} />
            </IconButton>
            <IconButton
              size={22}
              title={t('删除图层')}
              onClick={() => {
                if (confirm(t('删除「{name}」？', { name: layer.name }))) void exec('layer.delete', { ids: [layer.id], force: false });
              }}
            >
              <Trash2 size={12} />
            </IconButton>
          </>
        )}
      </div>

      <div className="ml-scroll flex-1 overflow-y-auto pb-8">
        {!isBg && (
          <Section title={t('变换')}>
            <div className="grid grid-cols-2 gap-1.5">
              <Field label="X">
                <NumberInput value={layer.x} onCommit={(x) => update({ x })} suffix="px" />
              </Field>
              <Field label="Y">
                <NumberInput value={layer.y} onCommit={(y) => update({ y })} suffix="px" />
              </Field>
              <Field label={t('宽')}>
                <NumberInput value={layer.width} onCommit={(width) => update({ width })} min={1} suffix="px" />
              </Field>
              <Field label={t('高')}>
                <NumberInput value={layer.height} onCommit={(height) => update({ height })} min={1} suffix="px" />
              </Field>
              <Field label={t('旋转')}>
                <NumberInput value={layer.rotation} onCommit={(rotation) => update({ rotation })} suffix="°" />
              </Field>
              <Field label={t('对齐')}>
                <div className="flex gap-0.5">
                  {(['left', 'center-x', 'right'] as const).map((mode) => (
                    <IconButton key={mode} size={20} title={t('对齐 {mode}', { mode })} onClick={() => void exec('layer.align', { ids: [layer.id], mode })}>
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
              <RotateCcw size={11} /> {t('居中并复位旋转')}
            </Button>
          </Section>
        )}

        <Section title={t('外观')}>
          <Slider label={t('不透明度')} value={layer.opacity} min={0} max={1} step={0.01} onChange={(opacity) => update({ opacity })} format={(v) => `${Math.round(v * 100)}%`} />
          <Field label={t('混合模式')}>
            <Select
              value={layer.blendMode}
              options={BLEND_MODES.map((b) => ({ value: b as BlendMode, label: t(BLEND_LABELS[b] ?? b) }))}
              onChange={(blendMode) => update({ blendMode })}
            />
          </Field>
          <div className="flex items-center gap-4 pt-1">
            <Toggle value={layer.visible} onChange={(visible) => void exec('layer.setVisible', { id: layer.id, visible })} label={t('可见')} />
            {!isBg && <Toggle value={layer.locked} onChange={(locked) => void exec('layer.setLocked', { id: layer.id, locked })} label={t('锁定')} />}
          </div>
        </Section>

        {layer.type === 'text' && <TextSection layer={layer} />}
        {layer.type === 'image' && <ImageSection layer={layer} />}
        {layer.type === 'video' && <VideoSection layer={layer} />}
        {layer.type === 'code' && <CodeSection layer={layer} />}
        {layer.type === 'audio' && <AudioSection layer={layer} />}

        <Section title={t('动画')} defaultOpen={false}>
          {(['enter', 'exit', 'emphasis'] as const).map((slot) => {
            const anim = layer.animation?.[slot];
            const label = slot === 'enter' ? t('入场') : slot === 'exit' ? t('退场') : t('强调');
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
                      {t('清除')}
                    </button>
                  )}
                </div>
                <Select
                  value={(anim?.preset ?? 'none') as AnimPreset}
                  options={ANIM_PRESETS.map((p) => ({ value: p, label: t(PRESET_LABELS[p] ?? p) }))}
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
                      <Field label={t('时长')}>
                        <NumberInput value={anim.duration} onCommit={(duration) => void exec('layer.setAnimation', { id: layer.id, animation: { [slot]: { ...anim, duration } } })} min={0} max={20000} step={50} suffix="ms" />
                      </Field>
                      <Field label={t('延迟')}>
                        <NumberInput value={anim.delay} onCommit={(delay) => void exec('layer.setAnimation', { id: layer.id, animation: { [slot]: { ...anim, delay } } })} min={0} max={20000} step={50} suffix="ms" />
                      </Field>
                    </div>
                    <Field label={t('曲线')}>
                      <Select
                        value={anim.easing}
                        options={EASINGS.map((e) => ({ value: e as EasingName, label: e }))}
                        onChange={(easing) => void exec('layer.setAnimation', { id: layer.id, animation: { [slot]: { ...anim, easing } } })}
                      />
                    </Field>
                    <Slider label={t('强度')} value={anim.intensity} min={0} max={1} step={0.05} onChange={(intensity) => void exec('layer.setAnimation', { id: layer.id, animation: { [slot]: { ...anim, intensity } } })} format={(v) => `${Math.round(v * 100)}%`} />
                  </>
                )}
              </div>
            );
          })}
        </Section>

        <Section title={t('属性绑定（表达式）')} defaultOpen={false}>
          <p className="text-[10px] leading-relaxed text-zinc-600">
            {t('每帧求值，可用 time(ms)、w、h、i 与 Math 函数。例如 rotation = sin(time*0.001)*6。')}
          </p>
          {BINDING_TARGETS.map((target) => (
            <Field key={target} label={target}>
              <TextInput
                value={layer.bindings?.[target] ?? ''}
                onCommit={(value) =>
                  void exec('layer.setBindings', { id: layer.id, bindings: { ...(layer.bindings ?? {}), [target]: value } })
                }
                placeholder={t('留空表示不绑定')}
                className="font-mono text-[10.5px]"
              />
            </Field>
          ))}
        </Section>

        {!isBg && (
          <Section title={t('时间轴区间')} defaultOpen={false}>
            <div className="grid grid-cols-2 gap-1.5">
              <Field label={t('出现')}>
                <NumberInput
                  value={layer.inPoint}
                  onCommit={(inPoint) => void exec('timeline.setLayerTiming', { id: layer.id, inPoint })}
                  min={0}
                  max={project.duration}
                  step={50}
                  suffix="ms"
                />
              </Field>
              <Field label={t('消失')}>
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
            <p className="text-[10px] text-zinc-600">{t('消失填 0 表示持续到结尾。')}</p>
          </Section>
        )}

        {/* 来源放在最后一节：诊断信息，不该挡住日常要改的参数 */}
        <OriginSection layer={layer} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- origin */

/** 来源格式的人话名字。字典里的 key 用中文原文，和别处一致 */
const ORIGIN_FORMATS: Record<string, string> = {
  remotion: 'Remotion 工程',
  html: 'HTML 片段',
  gsap: 'HTML / GSAP 片段',
  manim: 'Manim 场景',
  raw: '单个文件',
  'scene-json': '场景 JSON',
  'ai-scene': 'Kinelayer 语义层',
};

/** 来源区块里的一行「标签 → 值」。值可能是地址，必须能换行，别把面板撑破 */
function MetaRow({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-1.5 text-[11px] leading-relaxed">
      <span className="w-[52px] shrink-0 text-zinc-500">{label}</span>
      <span className={cx('min-w-0 flex-1 break-words', mono ? 'font-mono text-[10px] text-zinc-400' : 'text-zinc-300')}>{children}</span>
    </div>
  );
}

/**
 * 「这层是从哪来的」+「它缺的东西怎么补」。
 *
 * 导入报告是个一次性对话框：关掉之后，缺资源的层在画布上只剩一块
 * 「图片资源缺失」的占位，用户既不知道它原本指向哪儿，也不知道补哪儿。
 * 所以这里把两件事放在同一个区块里 —— 溯源信息是诊断，补资源是处方，
 * 拆成两个地方用户就得自己去连线。
 *
 * 只在 layer.origin 存在时渲染（手搓的层没有来源，不需要这一块）。
 */
function OriginSection({ layer }: { layer: Layer }) {
  const project = useEditor((s) => s.project);
  const fileRef = useRef<HTMLInputElement>(null);
  const origin = layer.origin;
  if (!origin) return null;

  const mediaKind = layer.type === 'image' || layer.type === 'video' ? layer.type : null;
  const gap = isAssetMissing(project, layer);
  const ref = origin.sourceRef;
  /* 同一个地址被多处引用的情况（HTML 里的 logo 最常见）：补一次就该全好 */
  const shared = sameRefLayers(project, layer);
  const ids = [layer.id, ...shared.map((l) => l.id)];
  const assign = (assetId: string) => {
    if (assetId) void exec('asset.assign', { ids, assetId });
  };

  const candidates = mediaKind
    ? project.assets.filter((a) => a.kind === (mediaKind === 'video' ? 'video' : 'image'))
    : [];

  return (
    <Section
      title={t('来源')}
      defaultOpen={false}
      right={
        <Badge tone={origin.generator === 'ai' ? 'accent' : 'neutral'}>
          {origin.generator === 'ai' ? t('AI 生成') : t('外部导入')}
        </Badge>
      }
    >
      {/* 一个统一的测试/断言入口：英文模式零中文、来源字段这些检查都只扫这一块 */}
      <div data-testid="origin-body" className="space-y-2">
      <MetaRow label={t('格式')}>
        {origin.sourceFormat ? t(ORIGIN_FORMATS[origin.sourceFormat] ?? origin.sourceFormat) : t('未知')}
      </MetaRow>
      {origin.parser && (
        <MetaRow label={t('解析器')} mono>
          {origin.parser}
        </MetaRow>
      )}
      {origin.sourceBundle && (
        <MetaRow label={t('来源包')} mono>
          {origin.sourceBundle}
        </MetaRow>
      )}
      {origin.importedAt && <MetaRow label={t('导入时间')}>{new Date(origin.importedAt).toLocaleString()}</MetaRow>}

      {origin.external && origin.external.length > 0 && (
        <div className="space-y-1">
          <MetaRow label={t('外部依赖')} mono>
            {origin.external.slice(0, 3).map((url) => (
              <div key={url} className="truncate" title={url}>
                {url}
              </div>
            ))}
            {origin.external.length > 3 && (
              <div className="text-zinc-600">{t('还有 {n} 个', { n: origin.external.length - 3 })}</div>
            )}
          </MetaRow>
          <p className="text-[10px] leading-relaxed text-amber-400/80">
            {t('这些是远程地址：编辑态能加载，导出和离线打开都拿不到')}
          </p>
        </div>
      )}

      {gap && mediaKind && (
        <div className="space-y-1.5 rounded border border-amber-500/30 bg-amber-500/[0.07] p-2">
          <div className="flex gap-1.5 text-[11px] text-amber-300/90">
            <AlertTriangle size={12} className="mt-[3px] shrink-0" />
            <span>{mediaKind === 'video' ? t('这层的视频没跟着导入') : t('这层的图片没跟着导入')}</span>
          </div>
          {ref && (
            <div className="font-mono text-[10px] break-all text-zinc-500" title={ref}>
              {ref}
            </div>
          )}
          {shared.length > 0 && (
            <p className="text-[10px] text-zinc-500">
              {t('另有 {n} 层指向同一个地址，会一起补上', { n: shared.length })}
            </p>
          )}
          <Select
            value=""
            onChange={assign}
            options={[
              { value: '', label: t('选资源库里的{kind}…', { kind: mediaKind === 'video' ? t('视频') : t('图片') }) },
              ...candidates.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <Button size="sm" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
            <Upload size={11} /> {t('从本地补一个')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={mediaKind === 'video' ? 'video/*' : 'image/*'}
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              const meta = await uploadAsset(file);
              if (!meta) return;
              /* 补错类型时把刚写进资源库的那条删掉，别留下没人引用的孤儿资源 */
              if (meta.kind !== mediaKind) {
                await exec('asset.remove', { id: meta.id, removeLayers: false });
                pushToast('warn', t('{name} 不是{kind}，这层用不了', { name: file.name, kind: mediaKind === 'video' ? t('视频') : t('图片') }));
                return;
              }
              const res = await exec('asset.assign', { ids, assetId: meta.id });
              if (res.ok) pushToast('success', t('已补上 {name}', { name: file.name }));
            }}
          />
        </div>
      )}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------ type sections */

function TextSection({ layer }: { layer: TextLayer }) {
  const style = layer.style;
  const setStyle = (patch: Partial<import('@/core/types').TextStyle>) => void exec('text.setStyle', { id: layer.id, style: patch });
  const fonts = useEditor((s) => s.project.fonts);

  return (
    <Section title={t('文本')}>
      <textarea
        value={layer.text}
        onChange={(e) => void exec('text.setContent', { id: layer.id, text: e.target.value })}
        rows={3}
        className="border-ink-700 w-full resize-y rounded-md border bg-ink-900/80 p-2 text-[11.5px] leading-relaxed text-zinc-200 outline-none focus:border-accent/60"
      />
      <div className="grid grid-cols-2 gap-1.5">
        <Field label={t('字号')}>
          <NumberInput value={style.fontSize} onCommit={(fontSize) => setStyle({ fontSize })} min={4} max={800} suffix="px" />
        </Field>
        <Field label={t('字重')}>
          <Select
            value={String(style.fontWeight)}
            options={['300', '400', '500', '600', '700', '800', '900'].map((w) => ({ value: w, label: w }))}
            onChange={(w) => setStyle({ fontWeight: Number(w) })}
          />
        </Field>
        <Field label={t('行高')}>
          <NumberInput value={style.lineHeight} onCommit={(lineHeight) => setStyle({ lineHeight })} min={0.6} max={4} step={0.05} />
        </Field>
        <Field label={t('字距')}>
          <NumberInput value={style.letterSpacing} onCommit={(letterSpacing) => setStyle({ letterSpacing })} min={-20} max={80} step={0.5} suffix="px" />
        </Field>
      </div>
      <Field label={t('字体')}>
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
            { value: 'top', label: t('顶对齐') },
            { value: 'middle', label: t('居中') },
            { value: 'bottom', label: t('底对齐') },
          ]}
          onChange={(verticalAlign) => setStyle({ verticalAlign })}
          className="w-24"
        />
      </div>
      <div className="flex items-center gap-3">
        <Toggle value={style.wrap} onChange={(wrap) => setStyle({ wrap })} label={t('自动换行')} />
        <Toggle value={style.uppercase} onChange={(uppercase) => setStyle({ uppercase })} label={t('大写')} />
      </div>
      <Field label={t('填充')}>
        {style.useGradient ? (
          <GradientEditor value={style.gradient} onChange={(gradient) => setStyle({ gradient })} />
        ) : (
          <ColorInput value={style.color} onChange={(color) => setStyle({ color })} />
        )}
      </Field>
      <Toggle value={style.useGradient} onChange={(useGradient) => setStyle({ useGradient })} label={t('使用渐变填充')} />
      <div className="grid grid-cols-2 gap-1.5">
        <Field label={t('描边')}>
          <div className="flex items-center gap-1">
            <ColorInput value={style.stroke?.color ?? '#000000'} onChange={(color) => setStyle({ stroke: { color, width: style.stroke?.width ?? 2 } })} />
            <NumberInput value={style.stroke?.width ?? 0} onCommit={(width) => setStyle({ stroke: width > 0 ? { color: style.stroke?.color ?? '#000000', width } : null })} min={0} max={40} className="w-16" />
          </div>
        </Field>
        <Field label={t('阴影模糊')}>
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
        {t('重置文本样式')}
      </Button>
    </Section>
  );
}

/**
 * 片段通用区：入点 / 出点 / 素材入点 / 转场。
 *
 * 放在图片、视频、音频三个面板的最上面而不是各写一份 —— 「片段在时间轴上的哪一段」
 * 是这三类共同的第一属性；用户换了图层类型也不该换个地方找它。
 */
function ClipSection({ layer }: { layer: Extract<Layer, { type: 'image' | 'video' | 'audio' }> }) {
  const project = useEditor((s) => s.project);
  const asset = useEditor((s) => (layer.assetId ? s.project.assets.find((a) => a.id === layer.assetId) : undefined));
  const trim = (patch: Record<string, unknown>) => void exec('layer.trim', { id: layer.id, ...patch });
  const out = layer.outPoint > 0 ? layer.outPoint : project.duration;
  const transition = layer.type === 'audio' ? null : layer.transition;
  /* 素材入点能拖到素材的什么位置：与片段长度无关（片段可以比素材长，循环播） */
  const maxTrimIn = Math.max(1, (asset?.duration ?? 0) - 100);
  const transitionMax = Math.max(200, Math.min(2000, (out - layer.inPoint) / 2));

  return (
    <Section title={t('片段')}>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('入点')}>
          <NumberInput value={Math.round(layer.inPoint)} onCommit={(v) => trim({ inPoint: v })} min={0} max={project.duration} suffix="ms" />
        </Field>
        <Field label={t('出点')}>
          <NumberInput
            value={Math.round(out)}
            onCommit={(v) => trim({ outPoint: v >= project.duration ? 0 : v })}
            min={0}
            max={project.duration}
            suffix="ms"
          />
        </Field>
      </div>
      {(layer.type === 'video' || layer.type === 'audio') && asset?.duration ? (
        <Slider
          label={t('素材入点')}
          value={Math.min(layer.trimIn ?? 0, maxTrimIn)}
          min={0}
          max={maxTrimIn}
          step={10}
          onChange={(trimIn) => trim({ trimIn })}
          format={(v) => `${(v / 1000).toFixed(2)}s`}
        />
      ) : null}
      {(layer.type === 'image' || layer.type === 'video') && (
        <>
          <Field label={t('转场（与上一段）')}>
            <Select
              value={transition?.kind ?? 'none'}
              options={[
                { value: 'none', label: t('硬切（无转场）') },
                ...TRANSITION_KINDS.map((k) => ({ value: k, label: t(TRANSITION_LABEL[k]) })),
              ]}
              onChange={(kind) =>
                void exec('layer.setTransition', {
                  id: layer.id,
                  kind: kind === 'none' ? null : (kind as TransitionKind),
                  duration: transition?.duration ?? 500,
                })
              }
            />
          </Field>
          {transition && (
            <Slider
              label={t('转场时长')}
              value={Math.min(transition.duration, transitionMax)}
              min={100}
              max={transitionMax}
              step={50}
              onChange={(duration) => void exec('layer.setTransition', { id: layer.id, kind: transition.kind, duration })}
              format={(v) => `${Math.round(v)}ms`}
            />
          )}
          <p className="text-[10px] leading-relaxed text-zinc-600">
            {t('转场只需要设在后一段上，前一段会自动让路。设成 0 或者选「硬切」就回到直接切。')}
          </p>
        </>
      )}
    </Section>
  );
}

function ImageSection({ layer }: { layer: Extract<Layer, { type: 'image' }> }) {
  const asset = useEditor((s) => s.project.assets.find((a) => a.id === layer.assetId));
  const update = (patch: Record<string, unknown>) => void exec('layer.update', { id: layer.id, patch });
  return (
    <Section title={t('图片')}>
      <ClipSection layer={layer} />
      <div className="flex items-center gap-2 rounded border border-ink-700 bg-ink-900/60 p-2">
        <ImageIcon size={14} className="text-zinc-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-zinc-300">{asset?.name ?? t('未选择资源')}</div>
          <div className="text-[10px] text-zinc-600">
            {asset ? `${asset.width ?? '?'}×${asset.height ?? '?'} · ${(asset.size / 1024).toFixed(0)}KB` : t('在左侧资源面板导入')}
          </div>
        </div>
      </div>
      <Field label={t('填充方式')}>
        <Select
          value={layer.fit}
          options={[
            { value: 'cover' as FitMode, label: t('覆盖') },
            { value: 'contain' as FitMode, label: t('包含') },
            { value: 'fill' as FitMode, label: t('拉伸') },
          ]}
          onChange={(fit) => update({ fit })}
        />
      </Field>
      <Field label={t('圆角')}>
        <NumberInput value={layer.radius} onCommit={(radius) => update({ radius })} min={0} max={2000} suffix="px" />
      </Field>
      <Slider label={t('亮度')} value={layer.brightness} min={0} max={2} step={0.01} onChange={(brightness) => update({ brightness })} />
      <Slider label={t('对比度')} value={layer.contrast} min={0} max={2} step={0.01} onChange={(contrast) => update({ contrast })} />
      <Slider label={t('饱和度')} value={layer.saturate} min={0} max={3} step={0.01} onChange={(saturate) => update({ saturate })} />
      <Slider label={t('灰度')} value={layer.grayscale} min={0} max={1} step={0.01} onChange={(grayscale) => update({ grayscale })} />
      <Slider label={t('模糊')} value={layer.blur} min={0} max={40} step={0.5} onChange={(blur) => update({ blur })} />
    </Section>
  );
}

function VideoSection({ layer }: { layer: Extract<Layer, { type: 'video' }> }) {
  const asset = useEditor((s) => s.project.assets.find((a) => a.id === layer.assetId));
  const update = (patch: Record<string, unknown>) => void exec('layer.update', { id: layer.id, patch });
  return (
    <Section title={t('视频')}>
      <ClipSection layer={layer} />
      <div className="flex items-center gap-2 rounded border border-ink-700 bg-ink-900/60 p-2">
        <Video size={14} className="text-zinc-500" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-zinc-300">{asset?.name ?? t('未选择视频资源')}</div>
          <div className="text-[10px] text-zinc-600">{t('由主时钟 seek 驱动，预览与导出取同一帧')}</div>
        </div>
      </div>
      <Field label={t('填充方式')}>
        <Select
          value={layer.fit}
          options={[
            { value: 'cover' as FitMode, label: t('覆盖') },
            { value: 'contain' as FitMode, label: t('包含') },
            { value: 'fill' as FitMode, label: t('拉伸') },
          ]}
          onChange={(fit) => update({ fit })}
        />
      </Field>
      <Field label={t('圆角')}>
        <NumberInput value={layer.radius} onCommit={(radius) => update({ radius })} min={0} max={2000} suffix="px" />
      </Field>
      <div className="flex items-center gap-4">
        <Toggle value={layer.muted} onChange={(muted) => update({ muted })} label={t('静音')} />
        <Toggle value={layer.loop} onChange={(loop) => update({ loop })} label={t('循环')} />
      </div>
      <Slider label={t('播放速度')} value={layer.playbackRate} min={0.25} max={3} step={0.05} onChange={(playbackRate) => update({ playbackRate })} format={(v) => `${v.toFixed(2)}×`} />
    </Section>
  );
}

/**
 * 音频层。
 *
 * 三条音源互斥，优先级 voice > assetId > tone：
 * 人声（共振峰合成）、导入的音频文件（按 trimIn 排程）、程序化音源（示例工程全靠它）。
 */
function AudioSection({ layer }: { layer: Extract<Layer, { type: 'audio' }> }) {
  const set = (patch: Record<string, unknown>) => void exec('audio.set', { id: layer.id, ...patch });
  const setTone = (patch: Record<string, unknown>) => void exec('audio.set', { id: layer.id, tone: patch });
  const asset = useEditor((s) => (layer.assetId ? s.project.assets.find((a) => a.id === layer.assetId) : undefined));
  const presetLabel: Record<string, string> = {
    pad: t('长音铺底'),
    pulse: t('节拍'),
    chime: t('提示音'),
  };
  const voice = layer.voice;
  const modeLabel: Record<VoiceMode, string> = { speak: t('说话'), sing: t('演唱') };
  const voiceLabel: Record<VoicePreset, string> = {
    female: t('女声'),
    male: t('男声'),
    child: t('童声'),
    robot: t('机器人'),
  };

  const headline = voice
    ? `${voice.text.slice(0, 18)}${voice.text.length > 18 ? '…' : ''}`
    : asset
      ? asset.name
      : `${presetLabel[layer.tone.preset] ?? layer.tone.preset} · ${Math.round(layer.volume * 100)}%`;

  const subline = voice
    ? t('人声合成 · {mode} · {preset} · {n} 字', {
        mode: modeLabel[voice.mode],
        preset: voiceLabel[voice.preset],
        n: syllablesOf(voice.text).length,
      })
    : asset
      ? t('导入音频 · {sec}s · 拖动片段边缘裁剪', { sec: ((asset.duration ?? 0) / 1000).toFixed(1) })
      : t('程序化合成，不依赖任何音频文件');

  return (
    <Section title={t('音频')}>
      <ClipSection layer={layer} />
      <div className="border-ink-700 bg-ink-900/60 flex items-center gap-2 rounded border p-2">
        {voice ? <Mic size={14} className="text-sky-400" /> : <Music size={14} className="text-emerald-400" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-zinc-300">
            {headline}
            {layer.muted ? ` · ${t('已静音')}` : ''}
          </div>
          <div className="truncate text-[10px] text-zinc-600">{subline}</div>
        </div>
        <Button variant="ghost" onClick={() => previewAudioLayer(layer)} title={t('试听这一层')} testId="audio-preview">
          <Play size={11} /> {t('试听')}
        </Button>
      </div>

      {voice && (
        <Button variant="ghost" onClick={() => openVoiceTab()} testId="audio-edit-voice">
          <Mic size={11} /> {t('去人声面板编辑')}
        </Button>
      )}

      {!asset && !voice && (
        <Field label={t('音源')}>
          <Select
            value={layer.tone.preset}
            options={TONE_PRESETS.map((p) => ({ value: p, label: presetLabel[p] ?? p }))}
            onChange={(preset) => setTone({ preset })}
          />
        </Field>
      )}

      <Slider
        label={t('音量')}
        value={layer.volume}
        min={0}
        max={1}
        step={0.01}
        onChange={(volume) => set({ volume })}
        format={(v) => `${Math.round(v * 100)}%`}
      />

      <Toggle value={layer.muted} onChange={(muted) => set({ muted })} label={t('静音')} />

      <div className="grid grid-cols-2 gap-2">
        <Field label={t('淡入')}>
          <NumberInput value={layer.fadeIn} onCommit={(fadeIn) => set({ fadeIn })} min={0} max={60000} suffix="ms" />
        </Field>
        <Field label={t('淡出')}>
          <NumberInput value={layer.fadeOut} onCommit={(fadeOut) => set({ fadeOut })} min={0} max={60000} suffix="ms" />
        </Field>
      </div>

      {!asset && !voice && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('基频')}>
            <NumberInput value={layer.tone.root} onCommit={(root) => setTone({ root })} min={20} max={4000} suffix="Hz" />
          </Field>
          {layer.tone.preset !== 'pad' && (
            <Field label={t('每分钟拍数')}>
              <NumberInput value={layer.tone.bpm} onCommit={(bpm) => setTone({ bpm })} min={20} max={300} suffix="BPM" />
            </Field>
          )}
        </div>
      )}

      <p className="text-[10px] leading-relaxed text-zinc-600">
        {t('音频跟着主时钟走：暂停、拖播放头都会重锚。导出 WebM 时会离线渲染一遍混进音轨。')}
      </p>
    </Section>
  );
}

function CodeSection({ layer }: { layer: Extract<Layer, { type: 'code' }> }) {
  const open = () => updateUi((ui) => { ui.codeEditorFor = layer.id; });
  const paramsJson = useMemo(() => JSON.stringify(layer.code.params, null, 2), [layer.code.params]);
  const isRemotion = layer.code.engine === 'remotion-component';
  const rt = layer.code.runtime;
  return (
    <Section title={t('代码')}>
      {isRemotion ? (
        /* remotion 层的引擎不是「可切换的选项」：源码是 TSX，切走就再也画不出来 */
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-2.5 py-2 text-[10.5px] leading-relaxed text-zinc-400">
          <div className="mb-1 font-medium text-amber-300">{t('Remotion 组件层')}</div>
          {rt ? (
            <div className="font-mono text-[10px] text-zinc-500">
              {rt.compositionId} · {rt.width}×{rt.height} · {rt.fps}fps · {rt.durationInFrames}f
            </div>
          ) : null}
          <p className="mt-1">{t('内部不可编辑，时间轴只有静态首帧；成片请导出 remotion-kit 在外部渲染。')}</p>
        </div>
      ) : (
        <Field label={t('引擎')}>
          <Select
            value={layer.code.engine}
            options={CODE_ENGINES.map((e) => ({ value: e as CodeEngine, label: e }))}
            onChange={(engine) => void exec('code.setEngine', { id: layer.id, engine })}
          />
        </Field>
      )}
      <div className="flex items-center justify-between">
        <Badge tone="cyan">{t('{n} 行', { n: layer.code.source.split('\n').length })}</Badge>
        <Button size="sm" variant="accent" onClick={open}>
          <Code2 size={11} /> {isRemotion ? t('查看源码') : t('打开编辑器')}
        </Button>
      </div>

      {!isRemotion && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Field label={t('内部分辨率')}>
              <Select
                value={String(layer.code.renderScale ?? 1)}
                options={[1, 0.75, 0.5, 0.35, 0.25].map((v) => ({ value: String(v), label: `${Math.round(v * 100)}%` }))}
                onChange={(v) =>
                  /* 1 就是默认值：写 null 让工程里不留冗余字段 */
                  void exec('code.setRenderScale', { id: layer.id, renderScale: Number(v) === 1 ? null : Number(v) })
                }
              />
            </Field>
            <Field label={t('运动模糊')}>
              <Select
                value={!layer.code.motionBlur ? 'off' : layer.code.motionBlur.samples === 'auto' ? 'auto' : 'fixed'}
                options={[
                  { value: 'off', label: t('关') },
                  { value: 'fixed', label: t('固定') },
                  { value: 'auto', label: t('自动') },
                ]}
                onChange={(v) =>
                  void exec('code.setMotionBlur', {
                    id: layer.id,
                    motionBlur:
                      v === 'off'
                        ? null
                        : { samples: v === 'auto' ? 'auto' : 5, shutter: 44, ...(v === 'auto' ? { tol: 3 } : {}) },
                  })
                }
              />
            </Field>
          </div>
          {layer.code.motionBlur && (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                {typeof layer.code.motionBlur.samples === 'number' ? (
                  <Field label={t('子帧')}>
                    <NumberInput
                      value={layer.code.motionBlur.samples}
                      onCommit={(samples) => void exec('code.setMotionBlur', { id: layer.id, motionBlur: { ...layer.code.motionBlur!, samples } })}
                      min={2}
                      max={32}
                    />
                  </Field>
                ) : (
                  <Field label={t('容差')}>
                    <NumberInput
                      value={layer.code.motionBlur.tol ?? 3}
                      onCommit={(tol) => void exec('code.setMotionBlur', { id: layer.id, motionBlur: { ...layer.code.motionBlur!, tol } })}
                      min={0}
                      max={32}
                    />
                  </Field>
                )}
                <Field label={t('快门')}>
                  <NumberInput
                    value={layer.code.motionBlur.shutter}
                    onCommit={(shutter) => void exec('code.setMotionBlur', { id: layer.id, motionBlur: { ...layer.code.motionBlur!, shutter } })}
                    min={1}
                    max={200}
                    suffix="ms"
                  />
                </Field>
              </div>
              <p className="text-[10px] leading-relaxed text-zinc-600">
                {layer.code.motionBlur.samples === 'auto'
                  ? t('自动：从 4 个子帧起步逐级加密，全图最大变化不超过容差就停（最多 32）。容差是 0–255 的色阶。')
                  : t('快门是一帧曝光，不是重影次数：30fps 下一帧 33ms。给 110ms 会得到三次离散重影。代价是这一层多画 N 遍。')}
              </p>
            </>
          )}
        </>
      )}

      <Field label={t('参数 params（JSON）')}>
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
