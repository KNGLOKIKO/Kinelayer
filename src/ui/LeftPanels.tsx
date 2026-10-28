import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Baseline,
  ChevronDown,
  Code2,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  Layers,
  Lock,
  Mic,
  MonitorSmartphone,
  Music,
  Play,
  Plus,
  Search,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Type,
  Unlock,
  Upload,
  Video,
  Wand2,
} from 'lucide-react';
import { exec } from '@/core/commandBus';
import { listByCategory, type CommandCategory } from '@/core/registry';
import { pushToast, updateUi, useEditor } from '@/core/store';
import { idbGetAsset } from '@/persist/idb';
import { SYSTEM_FONTS, listLocalFonts } from '@/persist/fonts';
import type { CustomCommand, Layer, LayerOrigin, LeftTab } from '@/core/types';
import { Badge, Button, EmptyState, IconButton, TextInput, cx } from './primitives';
import { isAssetMissing, missingAssetLayers } from './assetGaps';
import { fileToDataUrl, uploadAsset } from './uploadAsset';
import { VoicePanel } from './VoicePanel';
import { TRANSITIONS } from '@/core/media';
import { setDragData } from './dnd';

import { t } from '@/i18n';
/* ------------------------------------------------------------------ rail */

// label 一律存中文原文：模块级拿不到「用户当前语言」，翻译必须留到渲染时做
const TABS: { id: LeftTab; icon: typeof Layers; label: string }[] = [
  { id: 'assets', icon: ImageIcon, label: '素材' },
  { id: 'audio', icon: Mic, label: '音频' },
  { id: 'text', icon: Type, label: '文本' },
  { id: 'effects', icon: Sparkles, label: '特效' },
  { id: 'transitions', icon: ArrowRightLeft, label: '转场' },
  { id: 'layers', icon: Layers, label: '图层' },
  { id: 'fonts', icon: Baseline, label: '字体' },
  { id: 'commands', icon: Terminal, label: '命令' },
  { id: 'custom', icon: Wand2, label: '自定义' },
];

/**
 * 从别处（检查器）跳到「音频 → 人声」这一页。
 *
 * 子页签是 AudioPanel 的局部 state，而面板只在 leftTab==='audio' 时才挂载 ——
 * 直接派事件会和挂载抢先后。所以用一个模块级的「下次挂载该开哪页」旗标，
 * 挂载时读它、读完清掉；已经挂着的情况靠同一条事件即时切换。
 */
let pendingAudioTab: 'voice' | 'music' | null = null;

export function openVoiceTab(): void {
  pendingAudioTab = 'voice';
  updateUi((u) => {
    u.leftTab = 'audio';
  });
  window.dispatchEvent(new CustomEvent('ml:audio-tab', { detail: 'voice' }));
}

export function LeftRail() {
  const tab = useEditor((s) => s.ui.leftTab);
  return (
    <nav className="border-ink-700/80 bg-ink-900/80 flex w-12 shrink-0 flex-col items-center gap-1 border-r py-2">
      {TABS.map((item) => {
        const Icon = item.icon;
        const label = t(item.label);
        return (
          <button
            key={item.id}
            type="button"
            title={label}
            onClick={() => updateUi((u) => { u.leftTab = item.id; })}
            className={cx(
              'flex h-10 w-10 flex-col items-center justify-center gap-0.5 rounded-lg transition',
              tab === item.id ? 'bg-accent/20 text-accent-soft' : 'text-zinc-500 hover:bg-ink-800 hover:text-zinc-200',
            )}
          >
            <Icon size={16} />
            <span className="text-[9px]">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

/* ---------------------------------------------------------------- layers */

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
    case 'audio':
      return <Music size={13} />;
    default:
      return <Square size={13} />;
  }
}

/** 徽标的悬浮说明：只放能核对的事实（谁生成的、从哪种格式来的、什么时候） */
function originTitle(origin: LayerOrigin): string {
  const generator = origin.generator === 'ai' ? t('AI 生成') : t('外部导入');
  const parts = [generator];
  if (origin.sourceFormat) parts.push(origin.sourceFormat);
  if (origin.sourceBundle) parts.push(origin.sourceBundle);
  if (origin.parser) parts.push(t('解析器 {name}', { name: origin.parser }));
  if (origin.importedAt) parts.push(new Date(origin.importedAt).toLocaleString());
  /* 外部依赖只给个数：悬浮提示塞不下几条 URL，详细清单在右侧「来源」里 */
  if (origin.external?.length) parts.push(t('{n} 个外部依赖', { n: origin.external.length }));
  return parts.join(' · ');
}

function LayerRow({ layer, index }: { layer: Layer; index: number }) {
  const selected = useEditor((s) => s.ui.selectedIds.includes(layer.id));
  const active = useEditor((s) => s.ui.activeLayerId === layer.id);
  const gap = useEditor((s) => isAssetMissing(s.project, layer));
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(layer.name);
  const isBg = layer.type === 'background';

  return (
    <div
      data-testid="layer-row"
      draggable={!isBg}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/layer-id', layer.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(e) => {
        if (isBg) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        e.preventDefault();
        const src = e.dataTransfer.getData('text/layer-id');
        if (src && src !== layer.id) void exec('layer.reorder', { id: src, toIndex: index });
      }}
      onClick={(e) => {
        if (isBg) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey) void exec('selection.toggle', { id: layer.id });
        else void exec('selection.set', { ids: [layer.id] });
      }}
      onDoubleClick={() => {
        if (isBg) return;
        /*
         * Remotion 层双击不进重命名，直接开代码查看器 ——
         * 这类层的名字通常就是组件名（ParticleField），用户双击它想问的是「里面是什么」，
         * 而不是改名字。查看器里也只读（见 Dialogs 的说明）。
         */
        if (layer.type === 'code' && layer.code.engine === 'remotion-component') {
          updateUi((ui) => {
            ui.codeEditorFor = layer.id;
          });
          return;
        }
        setEditing(true);
        setName(layer.name);
      }}
      className={cx(
        'group flex h-8 cursor-default items-center gap-1.5 rounded-md px-1.5 transition',
        selected || active ? 'bg-accent/20 text-zinc-100' : 'text-zinc-400 hover:bg-ink-800',
        !layer.visible && 'opacity-45',
      )}
    >
      <span className="cursor-grab text-zinc-700 group-hover:text-zinc-500">
        {isBg ? <span className="inline-block w-[10px]" /> : <GripVertical size={12} />}
      </span>
      <span className={cx('shrink-0', layer.type === 'code' ? 'text-cyan' : 'text-zinc-500')}>{layerIcon(layer.type)}</span>
      {editing ? (
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => {
            setEditing(false);
            if (name.trim() && name !== layer.name) void exec('layer.rename', { id: layer.id, name: name.trim() });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
          className="border-accent/60 min-w-0 flex-1 rounded border bg-ink-900 px-1 text-[11.5px] text-zinc-100 outline-none"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[11.5px]">{layer.name}</span>
      )}
      {layer.type === 'code' ? (
        layer.code.engine === 'remotion-component' ? (
          <span title={t('Remotion 组件层：源码原样保存，内部不可编辑，成片需在外部渲染')}>
            <Badge tone="warn">remotion</Badge>
          </span>
        ) : (
          <Badge tone="cyan">code</Badge>
        )
      ) : null}
      {/*
        来源徽标：AI 生成的层和导入的层长得跟手搓的一模一样，
        不标出来用户会以为「这层本来就是我做的」，然后奇怪为什么改不了。
        悬浮到徽标上给出 生成方式 · 来源格式 · 导入时间。
      */}
      {layer.origin && (
        <span title={originTitle(layer.origin)}>
          <Badge tone={layer.origin.generator === 'ai' ? 'accent' : 'neutral'}>
            {layer.origin.generator === 'ai' ? 'AI' : t('导入')}
          </Badge>
        </span>
      )}
      {/*
        缺资源标记要挨着来源徽标，因为这两件事是同一个故事：
        「这层是导入来的」+「它要的那张图没跟着来」。分开摆用户对不上。
      */}
      {gap && (
        <span
          data-testid="asset-gap-mark"
          title={
            layer.origin?.sourceRef
              ? t('资源没跟着导入，原本指向 {ref}', { ref: layer.origin.sourceRef })
              : t('引用的资源不在资源库里')
          }
        >
          <AlertTriangle size={11} className="text-amber-400" />
        </span>
      )}
      {!isBg && (
        <button
          type="button"
          title={t('在独立窗口编辑')}
          onClick={(e) => {
            e.stopPropagation();
            void exec('window.openLayer', { layerId: layer.id, mode: 'auto' });
          }}
          className="hidden text-zinc-500 hover:text-cyan group-hover:block"
        >
          <MonitorSmartphone size={12} />
        </button>
      )}
      <button
        type="button"
        title={layer.visible ? t('隐藏') : t('显示')}
        onClick={(e) => {
          e.stopPropagation();
          void exec('layer.setVisible', { id: layer.id, visible: !layer.visible });
        }}
        className="text-zinc-500 hover:text-zinc-200"
      >
        {layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
      {!isBg && (
        <button
          type="button"
          title={layer.locked ? t('解锁') : t('锁定')}
          onClick={(e) => {
            e.stopPropagation();
            void exec('layer.setLocked', { id: layer.id, locked: !layer.locked });
          }}
          className={cx('hover:text-zinc-200', layer.locked ? 'text-amber-400' : 'text-zinc-600')}
        >
          {layer.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
      )}
    </div>
  );
}

function LayersPanel() {
  const layers = useEditor((s) => s.project.layers);
  const project = useEditor((s) => s.project);
  const selected = useEditor((s) => s.ui.selectedIds);
  const [addOpen, setAddOpen] = useState(false);
  const reversed = useMemo(() => [...layers].reverse(), [layers]);
  const gaps = useMemo(() => missingAssetLayers(project), [project]);

  const add = (type: 'text' | 'code' | 'image' | 'audio') => {
    setAddOpen(false);
    void exec('layer.create', { type });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-ink-700/70 flex h-9 items-center justify-between border-b px-2.5">
        <span className="text-[11px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">{t('图层 {n}', { n: layers.length })}</span>
        <div className="relative">
          <IconButton title={t('添加图层')} onClick={() => setAddOpen((v) => !v)} size={24}>
            <Plus size={14} />
          </IconButton>
          {addOpen && (
            <div className="border-ink-600 bg-ink-800 absolute top-7 right-0 z-40 w-32 overflow-hidden rounded-md border shadow-panel">
              {[
                { k: 'text' as const, label: t('文本层'), icon: Type },
                { k: 'code' as const, label: t('代码层'), icon: Code2 },
                { k: 'image' as const, label: t('图片层'), icon: ImageIcon },
                { k: 'audio' as const, label: t('音频层'), icon: Music },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.k}
                    type="button"
                    onClick={() => add(item.k)}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] text-zinc-300 hover:bg-ink-700"
                  >
                    <Icon size={12} /> {item.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="ml-scroll flex-1 overflow-y-auto p-1.5">
        {gaps.length > 0 && (
          /*
           * 缺资源是「导入之后」才会暴露的问题：报告对话框已经关了，
           * 画上只剩一块「图片资源缺失」的占位，用户看不出总共有几层、是哪几层。
           * 这条横幅就是那个「总账」，点一下把有问题的层全部选中。
           */
          <button
            type="button"
            data-testid="asset-gap-banner"
            onClick={() => void exec('selection.set', { ids: gaps.map((l) => l.id) })}
            title={t('选中这些图层，在右侧「来源」里补上资源')}
            className="border-amber-500/30 bg-amber-500/10 text-amber-300/90 hover:bg-amber-500/15 mb-1.5 flex w-full items-center gap-1.5 rounded border px-2 py-1.5 text-left text-[11px]"
          >
            <AlertTriangle size={12} className="shrink-0" />
            <span className="flex-1">{t('{n} 层缺资源', { n: gaps.length })}</span>
            <span className="text-[10px] opacity-70">{t('定位')}</span>
          </button>
        )}
        {reversed.map((layer, i) => (
          <LayerRow key={layer.id} layer={layer} index={layers.length - 1 - i} />
        ))}
      </div>
      <div className="border-ink-700/70 flex items-center gap-1 border-t p-1.5">
        <Button size="sm" variant="ghost" disabled={selected.length === 0} onClick={() => void exec('layer.duplicate', { ids: selected })}>
          <Copy size={11} /> {t('复制')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={selected.length === 0}
          onClick={() => {
            if (confirm(t('删除 {n} 个图层？', { n: selected.length }))) void exec('layer.delete', { ids: selected, force: false });
          }}
        >
          <Trash2 size={11} /> {t('删除')}
        </Button>
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => void exec('layer.fixAll', {})} title={t('修复越界与时间区间')}>
          <Wand2 size={11} /> {t('整理')}
        </Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- assets */

function useAssetUrl(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let objUrl: string | null = null;
    void idbGetAsset(id).then((rec) => {
      if (!rec || !alive) return;
      objUrl = URL.createObjectURL(rec.blob);
      setUrl(objUrl);
    });
    return () => {
      alive = false;
      if (objUrl) URL.revokeObjectURL(objUrl);
    };
  }, [id]);
  return url;
}

function AssetCard({ id, name, kind, size }: { id: string; name: string; kind: string; size: number }) {
  const url = useAssetUrl(id);
  const isAudio = kind === 'audio';
  return (
    <div
      className="group border-ink-700/70 bg-ink-900/60 relative overflow-hidden rounded-md border"
      draggable
      onDragStart={(e) => setDragData(e, 'asset', id)}
      title={t('拖到时间轴放入，或点一下放到播放头')}
    >
      <button
        type="button"
        className="block h-20 w-full"
        onClick={() => void exec('asset.place', { assetId: id })}
        title={isAudio ? t('点击放到时间轴（从播放头开始）') : t('点击放置到画布')}
      >
        {isAudio ? (
          <div className="text-emerald-300/80 flex h-full flex-col items-center justify-center gap-1">
            <Music size={18} />
            <span className="text-[9px] tracking-wider text-zinc-500">AUDIO</span>
          </div>
        ) : url ? (
          kind === 'video' ? (
            <video src={url} className="h-full w-full object-cover" muted />
          ) : (
            <img src={url} alt={name} className="h-full w-full object-cover" />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-600">
            {kind === 'video' ? <Video size={16} /> : <ImageIcon size={16} />}
          </div>
        )}
      </button>
      <div className="flex items-center gap-1 px-1.5 py-1">
        <span className="min-w-0 flex-1 truncate text-[10.5px] text-zinc-400">{name}</span>
        <span className="text-[9.5px] text-zinc-600">{(size / 1024).toFixed(0)}K</span>
        <button
          type="button"
          className="text-zinc-600 opacity-0 hover:text-rose-400 group-hover:opacity-100"
          onClick={() => {
            if (confirm(t('删除资源「{name}」？引用它的图层会清空资源。', { name }))) void exec('asset.remove', { id, removeLayers: false });
          }}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

export async function importFiles(files: FileList | File[]): Promise<void> {
  for (const file of Array.from(files)) {
    const meta = await uploadAsset(file);
    if (!meta) continue;
    await exec('asset.place', { assetId: meta.id });
    pushToast('success', t('已导入 {name}', { name: file.name }));
  }
}

function AssetsPanel() {
  const assets = useEditor((s) => s.project.assets);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="border-ink-700/70 flex h-9 items-center justify-between border-b px-2.5">
        <span className="text-[11px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">{t('资源 {n}', { n: assets.length })}</span>
        <IconButton title={t('导入图片 / 视频 / 音频')} onClick={() => inputRef.current?.click()} size={24}>
          <Upload size={13} />
        </IconButton>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <div
        className={cx('ml-scroll flex-1 overflow-y-auto p-1.5', dragOver && 'bg-accent/10')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
        }}
      >
        {assets.length === 0 ? (
          <EmptyState
            icon={<ImageIcon size={22} />}
            title={t('把图片、视频或音频拖进来')}
            hint={t('视频/音频点一下自动放上时间轴；二进制存 IndexedDB，项目 JSON 里只有元数据。')}
          />
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {assets.map((a) => (
              <AssetCard key={a.id} id={a.id} name={a.name} kind={a.kind} size={a.size} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- fonts */

function FontsPanel() {
  const fonts = useEditor((s) => s.project.fonts);
  const activeId = useEditor((s) => s.ui.activeLayerId);
  const layer = useEditor((s) => s.project.layers.find((l) => l.id === s.ui.activeLayerId));
  const [localFonts, setLocalFonts] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = layer && layer.type === 'text' ? layer.style.fontFamily : null;
  const all = [...SYSTEM_FONTS, ...localFonts, ...fonts.map((f) => f.family)];
  const list = Array.from(new Set(all)).filter((f) => f.toLowerCase().includes(query.toLowerCase()));

  const apply = (family: string) => {
    if (!activeId) {
      pushToast('warn', t('先选中一个文本层'));
      return;
    }
    void exec('text.setStyle', { id: activeId, style: { fontFamily: family } });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-ink-700/70 flex h-9 items-center justify-between border-b px-2.5">
        <span className="text-[11px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">{t('字体')}</span>
        <div className="flex items-center gap-1">
          <IconButton title={t('上传字体文件')} onClick={() => fileRef.current?.click()} size={24}>
            <Upload size={13} />
          </IconButton>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const family = file.name.replace(/\.[^.]+$/, '');
            try {
              const dataUrl = await fileToDataUrl(file);
              const res = await exec('font.register', { family, weight: 400, style: 'normal', dataUrl });
              if (res.ok) {
                pushToast('success', t('字体「{family}」已注册并持久化', { family }));
                apply(family);
              } else pushToast('error', res.error?.message ?? t('字体注册失败'));
            } catch (err) {
              pushToast('error', (err as Error).message);
            }
          }}
        />
      </div>
      <div className="border-ink-700/70 space-y-1.5 border-b p-2">
        <div className="relative">
          <Search size={12} className="absolute top-1/2 left-2 -translate-y-1/2 text-zinc-600" />
          <TextInput value={query} onChange={setQuery} placeholder={t('搜索字体')} className="pl-6" />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const list = await listLocalFonts();
              setLocalFonts(list);
              pushToast('success', t('读取到 {n} 个本地字体族', { n: list.length }));
            } catch (err) {
              pushToast('warn', (err as Error).message, 6000);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t('请求授权中…') : t('扫描本地字体（需授权）')}
        </Button>
      </div>
      <div className="ml-scroll flex-1 overflow-y-auto p-1.5">
        {list.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => apply(f)}
            className={cx(
              'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12px] transition',
              current === f ? 'bg-accent/20 text-zinc-100' : 'text-zinc-400 hover:bg-ink-800',
            )}
          >
            <span className="truncate" style={{ fontFamily: `"${f}"` }}>
              {f}
            </span>
            {fonts.some((x) => x.family === f && x.source === 'upload') && <Badge tone="accent">{t('上传')}</Badge>}
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- commands */

function CommandRow({ type, description, example }: { type: string; description: string; example: unknown }) {
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState(() => JSON.stringify(example ?? {}, null, 2));
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="border-ink-700/60 border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-1.5 px-2 py-1.5 text-left hover:bg-ink-800"
      >
        <ChevronDown size={11} className={cx('mt-0.5 shrink-0 text-zinc-600 transition', !open && '-rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[11px] text-zinc-300">{type}</span>
          <span className="mt-0.5 block text-[10px] leading-snug text-zinc-600">{description.slice(0, 76)}</span>
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 px-2 pb-2">
          <textarea
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
            rows={Math.min(10, json.split('\n').length)}
            className="border-ink-700 w-full rounded border bg-ink-950 p-1.5 font-mono text-[10.5px] text-zinc-300 outline-none focus:border-accent/60"
          />
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="accent"
              onClick={async () => {
                let payload: unknown = {};
                try {
                  payload = JSON.parse(json || '{}');
                } catch {
                  setResult(t('JSON 解析失败'));
                  return;
                }
                const r = await exec(type, payload);
                setResult(JSON.stringify(r.ok ? r.data : r.error, null, 2).slice(0, 900));
              }}
            >
              {t('运行')}
            </Button>
            <span className="text-[10px] text-zinc-600">{t('来源 user')}</span>
          </div>
          {result && (
            <pre className="ml-scroll max-h-40 overflow-auto rounded bg-ink-950 p-1.5 text-[10px] whitespace-pre-wrap text-zinc-500">
              {result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- 自定义命令面板 */

/**
 * 自定义命令（宏）列表。
 *
 * 这一屏要回答三个问题，顺序就是卡片从上到下的顺序：
 * 这条命令是干什么的 → 它有多重（几步 / 几个参数）→ 上次跑成功没有。
 * 运行按钮放在最显眼的位置：存下来就是为了重复点。
 */
function CustomPanel() {
  const list = useEditor((s) => s.runtime.customCommands);
  const loaded = useEditor((s) => s.runtime.customCommandsLoaded);
  const [query, setQuery] = useState('');
  const norm = query.trim().toLowerCase();
  const filtered = useMemo(
    () => list.filter((c) => !norm || c.name.toLowerCase().includes(norm) || c.description.toLowerCase().includes(norm)),
    [list, norm],
  );

  const openEditor = (id: string | 'new') => updateUi((ui) => { ui.customEditorFor = id; });

  const run = async (cmd: CustomCommand) => {
    /* 有参数的先弹表单：不问就按默认值跑，等于替用户做决定 */
    if (cmd.params.length > 0) {
      updateUi((ui) => { ui.customRunFor = cmd.id; });
      return;
    }
    const res = await exec('custom.run', { id: cmd.id });
    if (res.ok) pushToast('success', t('「{name}」执行完成', { name: cmd.name }));
    else pushToast('error', res.error?.message ?? t('执行失败'));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-ink-700/70 flex h-9 items-center justify-between border-b px-2.5">
        <span className="text-[11px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">{t('自定义命令 {n}', { n: list.length })}</span>
        <IconButton title={t('新建自定义命令')} onClick={() => openEditor('new')} size={24}>
          <Plus size={14} />
        </IconButton>
      </div>
      <div className="border-ink-700/70 border-b p-2">
        <div className="relative">
          <Search size={12} className="absolute top-1/2 left-2 -translate-y-1/2 text-zinc-600" />
          <TextInput value={query} onChange={setQuery} placeholder={t('搜索名称 / 描述')} className="pl-6" />
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">{t('命令 = 一串已有命令 + 参数。存下来就能重复点，AI 也能存。')}</p>
      </div>

      <div className="ml-scroll flex-1 overflow-y-auto p-1.5">
        {!loaded && <p className="px-2 py-3 text-[11px] text-zinc-600">{t('读取中…')}</p>}
        {loaded && list.length === 0 && (
          <EmptyState
            icon={<Sparkles size={18} />}
            title={t('还没有自定义命令')}
            hint={t('把一串常用操作存成一条命令；也可以让 AI 用 custom.define 存给你')}
          />
        )}
        {loaded && list.length > 0 && filtered.length === 0 && <p className="px-2 py-3 text-[11px] text-zinc-600">{t('没有匹配的命令')}</p>}
        {filtered.map((cmd) => (
          <div key={cmd.id} data-testid="custom-command-row" data-cmd-id={cmd.id} className="border-ink-700/70 bg-ink-900/50 mb-1.5 rounded-md border p-2">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-zinc-200" title={cmd.name} data-user-text>
                {cmd.name}
              </span>
              <Badge tone={cmd.author === 'ai' ? 'accent' : 'neutral'}>{cmd.author === 'ai' ? t('AI') : t('我')}</Badge>
            </div>
            {cmd.description && <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-zinc-500" data-user-text>{cmd.description}</p>}
            <div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-600">
              <span>{t('{steps} 步 · {params} 参数', { steps: cmd.steps.length, params: cmd.params.length })}</span>
              {cmd.runCount > 0 && <span>· {t('跑过 {n} 次', { n: cmd.runCount })}</span>}
            </div>
            {cmd.lastError && (
              <p className="mt-1 flex items-start gap-1 text-[10px] leading-relaxed text-rose-400" title={cmd.lastError} data-user-text>
                <AlertTriangle size={10} className="mt-[3px] shrink-0" />
                <span className="line-clamp-2">{cmd.lastError}</span>
              </p>
            )}
            <div className="mt-1.5 flex items-center gap-1">
              <Button size="sm" variant="accent" onClick={() => void run(cmd)}>
                <Play size={10} /> {t('运行')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => openEditor(cmd.id)}>
                {t('编辑')}
              </Button>
              <div className="flex-1" />
              <button
                type="button"
                title={t('删除')}
                className="text-zinc-600 hover:text-rose-400"
                onClick={() => {
                  if (confirm(t('删除自定义命令「{name}」？已经做过的画布改动不受影响。', { name: cmd.name }))) {
                    void exec('custom.remove', { id: cmd.id });
                  }
                }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CommandsPanel() {
  const [query, setQuery] = useState('');
  const grouped = useMemo(() => listByCategory(), []);
  const norm = query.trim().toLowerCase();

  return (
    <div className="flex h-full flex-col">
      <div className="border-ink-700/70 flex h-9 items-center justify-between border-b px-2.5">
        <span className="text-[11px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">{t('命令注册表')}</span>
        <Badge tone="accent">{Array.from(grouped.values()).reduce((n, arr) => n + arr.length, 0)}</Badge>
      </div>
      <div className="border-ink-700/70 border-b p-2">
        <div className="relative">
          <Search size={12} className="absolute top-1/2 left-2 -translate-y-1/2 text-zinc-600" />
          <TextInput value={query} onChange={setQuery} placeholder={t('搜索命令 / 分类')} className="pl-6" />
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-zinc-600">
          {t('这份列表与 AI 工具、MCP 工具同源。改这里就是改能力。')}
        </p>
      </div>
      <div className="ml-scroll flex-1 overflow-y-auto">
        {Array.from(grouped.entries()).map(([category, defs]) => {
          const filtered = defs.filter(
            (d) => !norm || d.type.toLowerCase().includes(norm) || d.description.includes(norm) || category.includes(norm),
          );
          if (filtered.length === 0) return null;
          return (
            <div key={category}>
              <div className="sticky top-0 z-10 bg-ink-850/95 px-2 py-1 text-[10px] font-semibold tracking-wider text-zinc-600 backdrop-blur">
                {t(category).toUpperCase()}
              </div>
              {filtered.map((d) => (
                <CommandRow key={d.type} type={d.type} description={d.description} example={d.example} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 面板：素材 / 音频 / 文本 / 特效 / 转场 */

/** 特效 = 一套入场动画。拖到片段上就是给那一段套上 */
const EFFECTS: { id: string; label: string; hint: string }[] = [
  { id: 'fade-in', label: '淡入', hint: '从透明浮出来' },
  { id: 'rise', label: '上浮', hint: '从下方推上来' },
  { id: 'zoom-in', label: '放大进入', hint: '由小变大' },
  { id: 'pop', label: '弹入', hint: '带一点回弹' },
  { id: 'spin', label: '旋转进入', hint: '边转边出现' },
  { id: 'pulse', label: '脉冲', hint: '强调一次，不改变位置' },
];

function PanelHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="border-ink-700/70 flex h-9 shrink-0 items-center justify-between border-b px-2.5">
      <span className="text-[11.5px] font-medium text-zinc-300">{title}</span>
      {right}
    </div>
  );
}

function AudioPanel() {
  const [tab, setTab] = useState<'voice' | 'music'>(() => {
    const wanted = pendingAudioTab ?? 'voice';
    pendingAudioTab = null;
    return wanted;
  });
  useEffect(() => {
    const onTab = (e: Event) => setTab((e as CustomEvent<'voice' | 'music'>).detail ?? 'voice');
    window.addEventListener('ml:audio-tab', onTab);
    return () => window.removeEventListener('ml:audio-tab', onTab);
  }, []);
  const layers = useEditor((s) => s.project.layers);
  const audioCount = layers.filter((l) => l.type === 'audio').length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-ink-700/70 flex h-9 shrink-0 items-center gap-1 border-b px-2">
        {(['voice', 'music'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cx(
              'h-6 rounded px-2 text-[11px] transition',
              tab === id ? 'bg-accent/20 text-accent-soft' : 'text-zinc-500 hover:text-zinc-200',
            )}
          >
            {id === 'voice' ? t('人声') : t('音乐')}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-[10px] text-zinc-600">{t('{n} 条音轨', { n: audioCount })}</span>
      </div>
      {tab === 'voice' ? (
        <div className="min-h-0 flex-1">
          <VoicePanel />
        </div>
      ) : (
        <div className="ml-scroll min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
          <p className="text-[10.5px] leading-relaxed text-zinc-600">
            {t('程序化音源：不依赖任何音频文件，同一份工程在任何机器上听到的完全一样。')}
          </p>
          {[
            { preset: 'pad' as const, label: '长音铺底', hint: '和弦长音，垫在下面' },
            { preset: 'pulse' as const, label: '节拍', hint: '跟着工程速度打点' },
            { preset: 'chime' as const, label: '提示音', hint: '在标记点响一声' },
          ].map((item) => (
            <button
              key={item.preset}
              type="button"
              onClick={() =>
                void exec('layer.create', {
                  type: 'audio',
                  name: t(item.label),
                  tone: { preset: item.preset },
                })
              }
              className="border-ink-700/70 bg-ink-900/50 hover:border-accent/50 hover:bg-ink-800/70 flex w-full items-center gap-2 rounded-md border p-2 text-left transition"
            >
              <Music size={14} className="text-emerald-300/80" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11.5px] text-zinc-200">{t(item.label)}</span>
                <span className="block text-[10px] text-zinc-600">{t(item.hint)}</span>
              </span>
              <Plus size={12} className="text-zinc-600" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TextPanel() {
  const project = useEditor((s) => s.project);
  const add = (kind: 'title' | 'sub' | 'body') => {
    const width = Math.round(project.width * (kind === 'body' ? 0.62 : 0.78));
    const size = kind === 'title' ? Math.round(project.width * 0.062) : kind === 'sub' ? Math.round(project.width * 0.032) : Math.round(project.width * 0.024);
    void exec('layer.create', {
      type: 'text',
      name: kind === 'title' ? t('标题') : kind === 'sub' ? t('副标题') : t('正文'),
      x: Math.round((project.width - width) / 2),
      y: Math.round(project.height * (kind === 'title' ? 0.42 : kind === 'sub' ? 0.52 : 0.62)),
      width,
      height: Math.round(size * 1.6),
      text: kind === 'title' ? t('在这里输入标题') : kind === 'sub' ? t('副标题') : t('正文'),
      textStyle: { fontSize: size, fontWeight: kind === 'body' ? 400 : 700, align: 'center' },
    });
  };
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t('文本')} />
      <div className="ml-scroll flex-1 space-y-2 overflow-y-auto p-2.5">
        {[
          { id: 'title' as const, label: '标题', hint: '大字号居中，占画面宽度的 78%' },
          { id: 'sub' as const, label: '副标题', hint: '标题下面那一行' },
          { id: 'body' as const, label: '正文', hint: '小字号，多行' },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => add(item.id)}
            className="border-ink-700/70 bg-ink-900/50 hover:border-accent/50 hover:bg-ink-800/70 flex w-full items-center gap-2 rounded-md border p-2 text-left transition"
          >
            <Type size={14} className="text-accent-soft/80" />
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] text-zinc-200">{t(item.label)}</span>
              <span className="block text-[10px] text-zinc-600">{t(item.hint)}</span>
            </span>
            <Plus size={12} className="text-zinc-600" />
          </button>
        ))}
      </div>
    </div>
  );
}

function EffectsPanel() {
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t('特效')} />
      <div className="ml-scroll flex-1 overflow-y-auto p-2">
        <p className="mb-2 px-0.5 text-[10.5px] leading-relaxed text-zinc-600">
          {t('把特效拖到时间轴的片段上，或者先选中片段再点。')}
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {EFFECTS.map((fx) => (
            <button
              key={fx.id}
              type="button"
              draggable
              onDragStart={(e) => setDragData(e, 'effect', fx.id)}
              onClick={() => {
                const id = useEditor.getState().ui.selectedIds[0];
                if (!id) {
                  pushToast('warn', t('先选中一个片段'));
                  return;
                }
                void exec('animation.applyPreset', { id, preset: fx.id, duration: 600 });
              }}
              title={t(fx.hint)}
              className="border-ink-700/70 bg-ink-900/50 hover:border-accent/60 hover:bg-ink-800/80 flex h-16 cursor-grab flex-col items-center justify-center gap-1 rounded-md border transition active:cursor-grabbing"
            >
              <Sparkles size={13} className="text-accent-soft/80" />
              <span className="text-[10.5px] text-zinc-300">{t(fx.label)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TransitionsPanel() {
  const selectedIds = useEditor((s) => s.ui.selectedIds);
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={t('转场')} />
      <div className="ml-scroll flex-1 overflow-y-auto p-2">
        <p className="mb-2 px-0.5 text-[10.5px] leading-relaxed text-zinc-600">
          {t('把转场拖到片段上就够了：它接在「上一段」和这一段之间，前一段会自动让路。')}
        </p>
        {TRANSITIONS.map((tr) => (
          <button
            key={tr.kind}
            type="button"
            draggable
            onDragStart={(e) => setDragData(e, 'transition', tr.kind)}
            onClick={() => {
              const id = selectedIds[0];
              if (!id) {
                pushToast('warn', t('先选中要接在后面的那一段'));
                return;
              }
              void exec('layer.setTransition', { id, kind: tr.kind, duration: 600 });
            }}
            className="border-ink-700/70 bg-ink-900/50 hover:border-accent/60 hover:bg-ink-800/80 mb-1.5 flex w-full cursor-grab items-center gap-2 rounded-md border p-2 text-left transition active:cursor-grabbing"
          >
            <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded bg-gradient-to-r from-accent/50 via-accent/20 to-transparent">
              <ArrowRightLeft size={12} className="text-accent-soft" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] text-zinc-200">{t(tr.label)}</span>
              <span className="block truncate text-[10px] text-zinc-600">{t(tr.hint)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

export function LeftPanel({ width = 268 }: { width?: number }) {
  const tab = useEditor((s) => s.ui.leftTab);
  return (
    <aside className="border-ink-700/80 bg-ink-850/60 flex shrink-0 flex-col border-r" style={{ width }}>
      {tab === 'assets' && <AssetsPanel />}
      {tab === 'audio' && <AudioPanel />}
      {tab === 'text' && <TextPanel />}
      {tab === 'effects' && <EffectsPanel />}
      {tab === 'transitions' && <TransitionsPanel />}
      {tab === 'layers' && <LayersPanel />}
      {tab === 'fonts' && <FontsPanel />}
      {tab === 'custom' && <CustomPanel />}
      {tab === 'commands' && <CommandsPanel />}
    </aside>
  );
}

