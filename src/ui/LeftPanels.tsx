import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Code2,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Image as ImageIcon,
  Layers,
  Lock,
  MonitorSmartphone,
  Plus,
  Search,
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
import type { Layer } from '@/core/types';
import { Badge, Button, EmptyState, IconButton, TextInput, cx } from './primitives';

import { t } from '@/i18n';
/* ------------------------------------------------------------------ rail */

// label 一律存中文原文：模块级拿不到「用户当前语言」，翻译必须留到渲染时做
const TABS: { id: 'layers' | 'assets' | 'fonts' | 'commands'; icon: typeof Layers; label: string }[] = [
  { id: 'layers', icon: Layers, label: '图层' },
  { id: 'assets', icon: ImageIcon, label: '资源' },
  { id: 'fonts', icon: Type, label: '字体' },
  { id: 'commands', icon: Terminal, label: '命令' },
];

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
    default:
      return <Square size={13} />;
  }
}

function LayerRow({ layer, index }: { layer: Layer; index: number }) {
  const selected = useEditor((s) => s.ui.selectedIds.includes(layer.id));
  const active = useEditor((s) => s.ui.activeLayerId === layer.id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(layer.name);
  const isBg = layer.type === 'background';

  return (
    <div
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
        if (!isBg) {
          setEditing(true);
          setName(layer.name);
        }
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
      {layer.type === 'code' ? <Badge tone="cyan">code</Badge> : null}
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
  const selected = useEditor((s) => s.ui.selectedIds);
  const [addOpen, setAddOpen] = useState(false);
  const reversed = useMemo(() => [...layers].reverse(), [layers]);

  const add = (type: 'text' | 'code' | 'image') => {
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
  return (
    <div className="group border-ink-700/70 bg-ink-900/60 relative overflow-hidden rounded-md border">
      <button type="button" className="block h-20 w-full" onClick={() => void exec('asset.place', { assetId: id })} title={t('点击放置到画布')}>
        {url ? (
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(t('读取文件失败')));
    reader.readAsDataURL(file);
  });
}

export async function importFiles(files: FileList | File[]): Promise<void> {
  const arr = Array.from(files);
  for (const file of arr) {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) {
      pushToast('warn', t('跳过不支持的文件：{name}', { name: file.name }));
      continue;
    }
    if (file.size > 48 * 1024 * 1024) {
      pushToast('error', t('{name} 超过 48MB，已跳过', { name: file.name }));
      continue;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await exec<{ id: string }>('asset.import', {
        name: file.name,
        mime: file.type || (isVideo ? 'video/mp4' : 'image/png'),
        dataUrl,
        kind: isVideo ? 'video' : 'image',
      });
      if (res.ok && res.data?.id) {
        await exec('asset.place', { assetId: res.data.id });
        pushToast('success', t('已导入 {name}', { name: file.name }));
      } else {
        pushToast('error', res.error?.message ?? t('导入失败'));
      }
    } catch (err) {
      pushToast('error', (err as Error).message);
    }
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
        <IconButton title={t('导入图片 / 视频')} onClick={() => inputRef.current?.click()} size={24}>
          <Upload size={13} />
        </IconButton>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
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
            title={t('把图片或视频拖进来')}
            hint={t('二进制存 IndexedDB，项目 JSON 里只有元数据，导出时不带 base64。')}
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
                {(category as CommandCategory).toUpperCase()}
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

/* ------------------------------------------------------------------ shell */

export function LeftPanel({ width = 268 }: { width?: number }) {
  const tab = useEditor((s) => s.ui.leftTab);
  return (
    <aside className="border-ink-700/80 bg-ink-850/60 flex shrink-0 flex-col border-r" style={{ width }}>
      {tab === 'layers' && <LayersPanel />}
      {tab === 'assets' && <AssetsPanel />}
      {tab === 'fonts' && <FontsPanel />}
      {tab === 'commands' && <CommandsPanel />}
    </aside>
  );
}

