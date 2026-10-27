import { z } from 'zod';
import { defineCommand, CommandFailure, type CommandContext } from '../registry';
import { createEmptyProject, normalizeProject } from '../defaults';
import { SAMPLE_PACK_VERSION, SAMPLES, sampleHighlights, type SampleDef } from '../sampleProject';
import { unpackProject } from '../projectFile';
import { LIMITS, getBackground, type Project } from '../types';
import { beatMs, clampTempo, normalizeLyrics } from '../score';
import { zLyrics } from '../schemas';
import { clamp } from '../geometry';
import { BundleError, blobOf, buildBundle, bytesToDataUrl, parseBundle } from '../bundle';
import { uid } from '../ids';
import { idbGetAsset, idbPutAsset } from '@/persist/idb';
import { listStoredFonts, registerFontFace } from '@/persist/fonts';
import {
  createProjectRecord,
  markSampleVersion,
  seededVersionOf,
  deleteProjectRecord,
  detachProject,
  duplicateProjectRecord,
  getLastProjectId,
  getProjectMeta,
  isDetached,
  listRecentProjects,
  loadProjectRecord,
  renameProjectRecord,
  saveProject,
  setLastProjectId,
} from '@/persist/projects';

/* ------------------------------------------------------------------ 示例 */

export interface SeededSample {
  created: boolean;
  /** seeded = 已经是最新；removed = 用户删过；open = 正开在编辑器里；modified = 被改过 */
  reason?: 'seeded' | 'removed' | 'open' | 'modified' | 'upgraded';
  projectId: string;
  name: string;
  version: number;
  upgradedFrom?: number;
  replaced?: boolean;
  thumbnail?: boolean;
  seconds?: number;
  layers?: number;
  tracks?: number;
  codeLayers?: number;
  audioLayers?: number;
  lyrics?: number;
  tempo?: number;
}

/**
 * 塞一份示例。逐份判定，五条规矩：
 *
 * 1. 已经是最新版 → 一次 prefs 读就回去（绝大多数情况走这条）；
 * 2. 库里没有、但标记说塞过 → 用户自己删的，只把版本标记跟上，**不塞回来**；
 * 3. 这一份正开在编辑器里 → 先不动（内存里还是旧内容，下一次自动保存会盖回来）；
 * 4. 被改过（updatedAt > createdAt）→ 只报「有新版」，不覆盖，也不写版本标记；
 * 5. 没动过 → 原地换新，同一个 id，列表里的位置与「当前」标记都不变。
 */
async function seedOne(def: SampleDef, currentId: string, force: boolean): Promise<SeededSample> {
  const seeded = await seededVersionOf(def.id);
  const existing = await getProjectMeta(def.id);
  const wanted = SAMPLE_PACK_VERSION;

  if (force) {
    const project = await def.load();
    const meta = await createProjectRecord(project);
    await markSampleVersion(def.id, wanted);
    return {
      created: true,
      replaced: !!existing,
      projectId: meta.id,
      name: meta.name,
      version: wanted,
      thumbnail: !!meta.thumbnail,
      ...sampleHighlights(project),
    };
  }

  if (seeded >= wanted) {
    return { created: false, reason: 'seeded', projectId: def.id, name: existing?.name ?? def.name, version: seeded };
  }

  if (!existing) {
    if (seeded > 0) {
      await markSampleVersion(def.id, wanted);
      return { created: false, reason: 'removed', projectId: def.id, name: def.name, version: seeded };
    }
    const project = await def.load();
    const meta = await createProjectRecord(project);
    await markSampleVersion(def.id, wanted);
    return {
      created: true,
      projectId: meta.id,
      name: meta.name,
      version: wanted,
      thumbnail: !!meta.thumbnail,
      ...sampleHighlights(project),
    };
  }

  /* 判据是「当前文档 id」，不是「上次打开的 id」：启动页里内存中是一份空工程 */
  if (currentId === def.id) {
    return { created: false, reason: 'open', projectId: existing.id, name: existing.name, version: seeded };
  }

  if (existing.updatedAt > existing.createdAt) {
    return {
      created: false,
      reason: 'modified',
      projectId: existing.id,
      name: existing.name,
      version: seeded,
      seconds: Math.round(def.duration / 1000),
    };
  }

  const project = await def.load();
  const meta = await createProjectRecord(project);
  await markSampleVersion(def.id, wanted);
  return {
    created: false,
    reason: 'upgraded',
    upgradedFrom: seeded,
    projectId: meta.id,
    name: meta.name,
    version: wanted,
    thumbnail: !!meta.thumbnail,
    ...sampleHighlights(project),
  };
}

/* ---------------------------------------------------------------- 切换工程 */

/**
 * 切换工程前把当前工程先写一次。
 * 自动保存有 1.6 秒防抖，切走那一刻最后几次编辑还在内存里 —— 不先落盘就会丢。
 * 落盘失败不阻断切换：1.6 秒前已经写过一份，最多丢这一小段。
 *
 * version === 1 表示「建出来之后一条命令都没跑过」——没人编辑过它，不值得占一条列表记录。
 * 启动时内存里那份示例工程正好是 version 1：不挡掉的话，每次刷新都会往工程库里
 * 塞一条新的「示例海报」（id 每次都不一样），列表很快就被它刷满。
 */
async function flushCurrent(project: Project): Promise<void> {
  if (isDetached(project.id)) return; // 这个工程刚被删掉，别再写回去
  if (project.version <= 1) return;
  try {
    await saveProject(project);
  } catch (err) {
    console.warn('[Kinelayer] 切换前落盘失败：', err);
  }
}

/**
 * 切换文档后的统一收尾。
 * 旧工程的 layerId 在新工程里没有意义 —— 图层窗口全部关掉；
 * 主时钟必须归零，否则新工程会从上一支的播放头某一帧开始播。
 */
function sessionReset(ctx: CommandContext, project: Project): void {
  ctx.services.closeAllLayerWindows();
  ctx.ui((ui) => {
    ui.selectedIds = [];
    ui.activeLayerId = project.layers[1]?.id ?? null;
    ui.floatingWindows = [];
    ui.codeEditorFor = null;
    ui.expandedTracks = [];
    ui.selectedKeyframes = [];
  });
  ctx.runtime((rt) => {
    rt.playhead = 0;
    rt.playing = false;
  });
}

/**
 * 把一个**已经在内存里拼好**的工程变成「当前打开的工程」。
 *
 * 三条导入路径（.kly 工程包 / 场景 JSON / HTML 片段）最后都要做完全一样的一组动作：
 * 旧工程先落盘 → 预加载资源（缩略图要渲染，图没就位会拍出空图）→ 建档 → 记住 lastProjectId
 * → 解掉 detach 标记 → 覆盖 draft → 会话收尾。
 *
 * 抽出来是为了让 `project.importBundle` 和 `ai.importProject` 共用一份实现：
 * 复制一遍必然会在某次改动里分叉（比如某天忘了 detach(null)），然后「导入后自动保存不生效」这种鬼 bug 就出来了。
 */
export async function installAsCurrentProject(ctx: CommandContext, project: Project, draft: Project): Promise<void> {
  await flushCurrent(ctx.before);
  await ctx.services.preloadProjectAssets(project);
  await createProjectRecord(project);
  await setLastProjectId(project.id);
  detachProject(null);
  Object.assign(draft, project);
  sessionReset(ctx, project);
}

export const projectCommands = [
  defineCommand({
    type: 'project.new',
    category: '项目',
    mutating: true,
    dangerous: true,
    resetsHistory: true,
    description: '新建空白项目（会丢弃当前项目的撤销历史，但不会删除 IndexedDB 里的资源）。',
    schema: z.object({
      name: z.string().min(1).max(80).default('未命名织层项目'),
      width: z.number().min(LIMITS.width.min).max(LIMITS.width.max).default(1080),
      height: z.number().min(LIMITS.height.min).max(LIMITS.height.max).default(1440),
    }),
    example: { name: '新品发布海报', width: 1080, height: 1440 },
    handler: (draft, payload, ctx) => {
      const next = createEmptyProject(payload.name);
      next.width = payload.width;
      next.height = payload.height;
      next.layers[0]!.width = payload.width;
      next.layers[0]!.height = payload.height;
      Object.assign(draft, next);
      ctx.ui((ui) => {
        ui.selectedIds = [];
        ui.activeLayerId = null;
        ui.zoom = 0.5;
        ui.panX = 0;
        ui.panY = 0;
      });
      ctx.runtime((rt) => {
        rt.playhead = 0;
        rt.playing = false;
      });
      return { id: next.id, name: next.name };
    },
  }),

  defineCommand({
    type: 'project.load',
    category: '项目',
    mutating: true,
    dangerous: true,
    resetsHistory: true,
    description: '从工程包（.kly）文本载入，也接受旧版裸项目 JSON。载入会做修复与不变式校验。',
    schema: z.object({ data: z.string().min(2).max(50_000_000) }),
    example: { data: '{"name":"海报","width":1080,...}' },
    handler: (draft, payload, ctx) => {
      let parsed: unknown;
      try {
        parsed = unpackProject(JSON.parse(payload.data));
      } catch (err) {
        throw new CommandFailure('VALIDATION', `工程包解析失败：${(err as Error).message}`);
      }
      const next = normalizeProject(parsed);
      Object.assign(draft, next);
      ctx.ui((ui) => {
        ui.selectedIds = [];
        ui.activeLayerId = next.layers[1]?.id ?? null;
      });
      ctx.runtime((rt) => {
        rt.playhead = next.duration;
        rt.playing = false;
      });
      return { id: next.id, layers: next.layers.length };
    },
  }),

  defineCommand({
    type: 'project.listRecent',
    category: '项目',
    mutating: false,
    undoable: false,
    description:
      '列出最近的工程（按更新时间倒序，最多 12 条），带缩略图、画布尺寸、图层数与最后打开的工程 id。启动页只读这个，不加载工程本体。',
    schema: z.object({ limit: z.number().int().min(1).max(50).default(12) }),
    example: { limit: 12 },
    handler: async (draft, payload) => {
      const projects = await listRecentProjects(payload.limit);
      return {
        projects,
        count: projects.length,
        currentId: draft.id,
        lastProjectId: await getLastProjectId(),
      };
    },
  }),

  defineCommand({
    type: 'project.seedSample',
    category: '项目',
    mutating: false,
    undoable: false,
    description:
      '把内置示例写进本地工程库（逐份、按版本幂等）。现在有两份：① 64 秒极限样片，九段、九个代码层，把引擎压到性能上限；② 60 秒「再改一版」，128 BPM、逐字卡拉 OK、下拍硬切、一条贯穿母题与一个逐级递增的数字，复刻自 mexicat/pdoom-video 的叙事手法。两份都是 1920×1080 / 30fps，图形与声音全部由代码算出来，没有任何外部资源。同一版本塞过就直接返回；库里的还是旧版时，没被动过就原地换新、被改过只回报「有新版」不覆盖；用户删掉之后不会自己冒回来。不改动当前打开的文档。',
    schema: z.object({ force: z.boolean().default(false) }),
    example: {},
    handler: async (draft, payload, ctx) => {
      if (ctx.dryRun) return { created: false, reason: 'dryRun' };

      const samples: SeededSample[] = [];
      for (const def of SAMPLES) {
        samples.push(await seedOne(def, draft.id, payload.force));
      }

      /* 顶层字段描述「第一份」，启动页的引导卡只讲它；其余一份在 samples 里 */
      const primary = samples[0]!;
      return {
        ...primary,
        version: SAMPLE_PACK_VERSION,
        samples,
        created: samples.some((s) => s.created),
      };
    },
  }),

  defineCommand({
    type: 'project.create',
    category: '项目',
    mutating: true,
    resetsHistory: true,
    asyncHandler: true,
    description:
      '新建工程并立即打开：先把当前工程落盘，再建空工程、写进本地索引、切成当前文档。撤销栈与主时钟一并重置。',
    schema: z.object({
      name: z.string().min(1).max(80).default('未命名织层项目'),
      width: z.number().min(LIMITS.width.min).max(LIMITS.width.max).default(1080),
      height: z.number().min(LIMITS.height.min).max(LIMITS.height.max).default(1440),
      duration: z.number().min(LIMITS.duration.min).max(LIMITS.duration.max).default(4000),
      fps: z.number().min(LIMITS.fps.min).max(LIMITS.fps.max).default(30),
      background: z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).optional(),
    }),
    example: { name: '新品发布海报', width: 1080, height: 1440, duration: 4000, fps: 30, background: '#0b0e14' },
    handler: async (draft, payload, ctx) => {
      const next = createEmptyProject(payload.name);
      next.width = payload.width;
      next.height = payload.height;
      next.duration = Math.round(payload.duration);
      next.fps = Math.round(payload.fps);
      const bg = getBackground(next);
      bg.width = payload.width;
      bg.height = payload.height;
      if (payload.background) {
        bg.kind = 'solid';
        bg.color = payload.background;
      }
      /* 总线提交时会把 version 写成「执行前版本 + 1」；先对齐，落盘那份才不会差一版 */
      next.version = draft.version + 1;

      if (ctx.dryRun) return { projectId: next.id, name: next.name, dryRun: true };

      await flushCurrent(ctx.before);
      await createProjectRecord(next);
      await setLastProjectId(next.id);
      detachProject(null);
      Object.assign(draft, next);
      await ctx.services.preloadProjectAssets(next);
      sessionReset(ctx, next);
      return { projectId: next.id, name: next.name, layerCount: next.layers.length };
    },
  }),

  defineCommand({
    type: 'project.open',
    category: '项目',
    mutating: true,
    resetsHistory: true,
    asyncHandler: true,
    description:
      '打开本地工程：先把当前工程落盘，再整份换成目标工程。撤销栈清空、主时钟归零、所有图层窗口关闭（旧 layerId 已失效）。',
    schema: z.object({ projectId: z.string().min(1).max(80) }),
    example: { projectId: 'prj_abc' },
    handler: async (draft, payload, ctx) => {
      /* 打开的就是当前这份：别从库里重读，那会把手上的未保存改动冲掉 */
      if (payload.projectId === draft.id) {
        if (!ctx.dryRun) {
          await setLastProjectId(draft.id);
          detachProject(null);
        }
        return { projectId: draft.id, name: draft.name, alreadyOpen: true };
      }

      if (ctx.dryRun) {
        const meta = await getProjectMeta(payload.projectId);
        if (!meta) throw new CommandFailure('NOT_FOUND', `工程不存在：${payload.projectId}`);
        return { projectId: meta.id, name: meta.name, layerCount: meta.layerCount, dryRun: true };
      }

      await flushCurrent(ctx.before);
      const next = await loadProjectRecord(payload.projectId);
      if (!next) throw new CommandFailure('NOT_FOUND', `工程不存在：${payload.projectId}`);
      next.version = draft.version + 1;
      Object.assign(draft, next);
      await setLastProjectId(next.id);
      detachProject(null);
      await ctx.services.preloadProjectAssets(next);
      sessionReset(ctx, next);
      return { projectId: next.id, name: next.name, layerCount: next.layers.length, version: next.version };
    },
  }),

  defineCommand({
    type: 'project.setTempo',
    category: '项目',
    mutating: true,
    description:
      '设置工程的速度网格（BPM / 第 0 拍偏移 / 每小节拍数）。这是画面与声音共用的那一份时间真理：代码层通过 api.tempo 读它，鼓点也按它落点 —— 改一次，切镜与鼓一起走，不会一边改了一边忘。省略的字段保持不变；偏移可以是负数（从半拍处切进来）。',
    schema: z
      .object({
        bpm: z.number().min(20).max(300).optional(),
        offsetMs: z.number().min(-60_000).max(600_000).optional(),
        meter: z.number().int().min(1).max(16).optional(),
      })
      .refine((v) => v.bpm !== undefined || v.offsetMs !== undefined || v.meter !== undefined, {
        message: '至少要给一个字段',
      }),
    example: { bpm: 132, offsetMs: 0, meter: 4 },
    handler: (draft, payload) => {
      const next = clampTempo({ ...clampTempo(draft.tempo), ...payload });
      draft.tempo = next;
      return {
        ...next,
        /** 一拍多少毫秒 —— 调用方（AI / 人）真正要算的东西 */
        beatMs: Math.round(beatMs(next) * 10) / 10,
        barMs: Math.round(beatMs(next) * next.meter * 10) / 10,
      };
    },
  }),

  defineCommand({
    type: 'project.setLyrics',
    category: '项目',
    mutating: true,
    description:
      '写入/替换工程的词级时间（逐行歌词）。每行给 text 与绝对毫秒区间 [start, end)；行内的逐字时间由引擎按字符权重切分，所以**不需要手工排每一个字**。代码层用 api.lyrics 查询：at/before/after/units/progress/chars —— chars 就是逐字擦除要的那个「已唱几个字」。append 模式用于分章写入，replace 覆盖全部。',
    schema: z.object({
      lines: zLyrics,
      mode: z.enum(['replace', 'append']).default('replace'),
    }),
    example: {
      lines: [
        { text: '先画一条线', start: 4000, end: 6800 },
        { text: '就有了时间', start: 6900, end: 9600 },
      ],
    },
    handler: (draft, payload) => {
      const merged = payload.mode === 'append' ? [...(draft.lyrics ?? []), ...payload.lines] : payload.lines;
      const lines = normalizeLyrics(merged, draft.duration);
      draft.lyrics = lines;
      return {
        count: lines.length,
        /* 报一下「讲到什么时候」，方便调用方接下一段 */
        coverageMs: lines.reduce((n, l) => n + (l.end - l.start), 0),
        lastEnd: lines.length ? lines[lines.length - 1]!.end : 0,
      };
    },
  }),

  defineCommand({
    type: 'project.rename',
    category: '项目',
    mutating: true,
    asyncHandler: true,
    description:
      '重命名工程。省略 projectId 时改当前打开的工程（改完立即落盘）；指定其它工程 id 时只改本地索引里那条记录，不动当前文档。',
    schema: z.object({
      name: z.string().min(1).max(80),
      projectId: z.string().min(1).max(80).optional(),
    }),
    example: { name: 'Kinelayer · 版本 B' },
    handler: async (draft, payload, ctx) => {
      const target = payload.projectId ?? draft.id;

      if (target !== draft.id) {
        if (ctx.dryRun) {
          const meta = await getProjectMeta(target);
          if (!meta) throw new CommandFailure('NOT_FOUND', `工程不存在：${target}`);
          return { projectId: target, name: payload.name, scope: 'stored', dryRun: true };
        }
        const meta = await renameProjectRecord(target, payload.name);
        if (!meta) throw new CommandFailure('NOT_FOUND', `工程不存在：${target}`);
        return { projectId: target, name: meta.name, scope: 'stored' };
      }

      draft.name = payload.name;
      draft.version += 1; // 与总线提交时的 version 对齐，见 project.create 的注释
      draft.updatedAt = Date.now();
      if (!ctx.dryRun) {
        try {
          await saveProject(draft);
        } catch (err) {
          /* 落盘失败不让重命名本身失败：自动保存会再写一次 */
          console.warn('[Kinelayer] 改名落盘失败：', err);
        }
      }
      return { projectId: draft.id, name: draft.name, scope: 'current' };
    },
  }),

  defineCommand({
    type: 'project.deleteLocal',
    category: '项目',
    mutating: true,
    undoable: false,
    dangerous: true,
    asyncHandler: true,
    description:
      '删除本地工程记录（连带不再被任何工程引用的图片/视频）。必须显式 confirm: true。删除的若是当前打开的工程，编辑器仍开着它但不再落盘，下次打开或新建即丢弃。',
    schema: z.object({
      projectId: z.string().min(1).max(80),
      confirm: z.boolean().default(false),
    }),
    example: { projectId: 'prj_abc', confirm: true },
    handler: async (draft, payload, ctx) => {
      if (payload.confirm !== true) {
        throw new CommandFailure('FORBIDDEN', '删除本地工程需要显式确认：confirm: true');
      }
      const meta = await getProjectMeta(payload.projectId);
      if (!meta) throw new CommandFailure('NOT_FOUND', `工程不存在：${payload.projectId}`);
      const wasCurrent = payload.projectId === draft.id;

      if (ctx.dryRun) return { projectId: payload.projectId, name: meta.name, wasCurrent, dryRun: true };

      const { removedAssets } = await deleteProjectRecord(payload.projectId);
      if (wasCurrent) {
        detachProject(draft.id);
        await setLastProjectId(null);
      }
      return { projectId: payload.projectId, name: meta.name, wasCurrent, removedAssets };
    },
  }),

  defineCommand({
    type: 'project.duplicate',
    category: '项目',
    mutating: false,
    undoable: false,
    description:
      '复制一个工程（默认复制当前打开的）。图片/视频按 assetId 共享，不重复占空间；不会切换当前文档，要打开请再调 project.open。',
    schema: z.object({
      projectId: z.string().min(1).max(80).optional(),
      nameSuffix: z.string().max(20).default(' 副本'),
    }),
    example: { nameSuffix: ' 副本' },
    handler: async (draft, payload, ctx) => {
      const sourceId = payload.projectId ?? draft.id;
      const source = sourceId === draft.id ? draft : await loadProjectRecord(sourceId);
      if (!source) throw new CommandFailure('NOT_FOUND', `工程不存在：${sourceId}`);
      const name = `${source.name}${payload.nameSuffix}`.slice(0, 80);
      if (ctx.dryRun) return { from: sourceId, name, dryRun: true };
      const copy = await duplicateProjectRecord(source, payload.nameSuffix);
      return { projectId: copy.id, name: copy.name, from: sourceId };
    },
  }),

  defineCommand({
    type: 'project.exportBundle',
    category: '项目',
    mutating: false,
    undoable: false,
    description:
      '导出工程包（.kly / ZIP）：project.json + manifest.json + assets/ + fonts/，二进制原样打包并逐文件带 sha256。不带 projectId 时导出当前工程。',
    schema: z.object({ projectId: z.string().min(1).max(80).optional() }),
    example: {},
    handler: async (draft, payload, ctx) => {
      const sourceId = payload.projectId ?? draft.id;
      const source = sourceId === draft.id ? draft : await loadProjectRecord(sourceId);
      if (!source) throw new CommandFailure('NOT_FOUND', `工程不存在：${sourceId}`);

      const assets: { id: string; name: string; mime: string; bytes: Uint8Array }[] = [];
      const missing: string[] = [];
      for (const meta of source.assets) {
        const rec = await idbGetAsset(meta.id);
        if (!rec?.blob) {
          missing.push(meta.name);
          continue;
        }
        assets.push({
          id: meta.id,
          name: rec.name,
          mime: rec.mime || meta.mime,
          bytes: new Uint8Array(await rec.blob.arrayBuffer()),
        });
      }

      /* 只带「工程里真的用到了的上传字体」；系统字体不打包，换台机器照样有 */
      const used = new Set(source.fonts.filter((f) => f.source === 'upload').map((f) => f.family));
      const fonts = used.size ? (await listStoredFonts()).filter((f) => used.has(f.family)) : [];

      const { bytes, manifest } = await buildBundle({ project: source, assets, fonts });
      const saved = await ctx.services.saveBundle(bytes, source);
      return {
        filename: saved.filename,
        bytes: saved.bytes,
        formatVersion: manifest.formatVersion,
        assets: manifest.assets.length,
        fonts: manifest.fonts.length,
        missingAssets: missing,
      };
    },
  }),

  defineCommand({
    type: 'project.importBundle',
    category: '项目',
    mutating: true,
    resetsHistory: true,
    asyncHandler: true,
    description:
      '导入工程包（.kly / ZIP）。文件二进制走 services 暂存区，这里只收 stageId：校验清单与 sha256 → 资源落库 → 新建一条工程记录并打开（不会覆盖同名工程）。',
    schema: z.object({ stageId: z.string().min(3).max(80) }),
    example: { stageId: 'st_abc' },
    handler: async (draft, payload, ctx) => {
      const bytes = await ctx.services.takeBundleStage(payload.stageId);
      if (!bytes) throw new CommandFailure('NOT_FOUND', '导入文件已过期，请重新选择');

      let parsed;
      try {
        parsed = await parseBundle(bytes);
      } catch (err) {
        if (err instanceof BundleError) throw new CommandFailure('VALIDATION', err.message, { code: err.code });
        throw new CommandFailure('VALIDATION', `工程包解析失败：${(err as Error).message}`);
      }

      /* 换新 id：导入是「新增一份」，不该覆盖本机同名的旧工程 */
      const project = normalizeProject({ ...parsed.project, id: uid('prj') });
      project.createdAt = Date.now();
      project.updatedAt = Date.now();
      project.name = `${project.name}`.slice(0, 80) || '导入的工程';
      project.version = draft.version + 1;

      const summary = {
        projectId: project.id,
        name: project.name,
        assets: parsed.assets.length,
        fonts: parsed.fonts.length,
        totalBytes: parsed.totalBytes,
        version: parsed.manifest.formatVersion,
      };
      if (ctx.dryRun) return { ...summary, dryRun: true };

      await flushCurrent(ctx.before);

      /* 资源先进库，再截图建档：缩略图要渲染，图片没就位会拍出一张空图 */
      for (const asset of parsed.assets) {
        if (await idbGetAsset(asset.id)) continue; // 同一个包里重复的 id 只写一次
        const blob = blobOf(asset.bytes, asset.mime);
        await idbPutAsset({
          id: asset.id,
          name: asset.name,
          kind: asset.mime.startsWith('video') ? 'video' : 'image',
          mime: asset.mime,
          size: blob.size,
          createdAt: Date.now(),
          blob,
        });
      }
      for (const font of parsed.fonts) {
        try {
          await registerFontFace({
            family: font.family,
            weight: font.weight,
            style: font.style,
            dataUrl: bytesToDataUrl(font.bytes, font.mime),
          });
        } catch {
          /* 字体坏了不该拦住整个导入：渲染层会退回系统字体 */
        }
      }

      await ctx.services.preloadProjectAssets(project);
      await createProjectRecord(project);
      await setLastProjectId(project.id);
      detachProject(null);
      Object.assign(draft, project);
      sessionReset(ctx, project);
      return summary;
    },
  }),

  defineCommand({
    type: 'canvas.resize',
    category: '画布',
    mutating: true,
    description: '修改画布尺寸。scaleContent=true 时按比例缩放所有图层（保持构图）。',
    schema: z.object({
      width: z.number().min(LIMITS.width.min).max(LIMITS.width.max),
      height: z.number().min(LIMITS.height.min).max(LIMITS.height.max),
      scaleContent: z.boolean().default(true),
    }),
    example: { width: 1080, height: 1080, scaleContent: true },
    handler: (draft, payload) => {
      const sx = payload.width / draft.width;
      const sy = payload.height / draft.height;
      if (payload.scaleContent) {
        for (const layer of draft.layers) {
          if (layer.type === 'background') continue;
          layer.x = Math.round(layer.x * sx);
          layer.y = Math.round(layer.y * sy);
          layer.width = Math.max(1, Math.round(layer.width * sx));
          layer.height = Math.max(1, Math.round(layer.height * sy));
          if (layer.type === 'text') {
            layer.style.fontSize = Math.max(4, layer.style.fontSize * Math.min(sx, sy));
          }
        }
      }
      draft.width = payload.width;
      draft.height = payload.height;
      return { width: draft.width, height: draft.height };
    },
  }),

  defineCommand({
    type: 'canvas.setDuration',
    category: '画布',
    mutating: true,
    description: '设置时间轴总时长（毫秒，100..600000）。',
    schema: z.object({ duration: z.number().min(LIMITS.duration.min).max(LIMITS.duration.max) }),
    example: { duration: 6000 },
    handler: (draft, payload, ctx) => {
      const duration = Math.round(payload.duration);
      draft.duration = duration;
      for (const layer of draft.layers) {
        if (layer.outPoint > duration) layer.outPoint = duration;
      }
      /*
       * 副作用闭包里只能引用普通值，不能引用 draft。
       * applyEffects 是在 produceWithPatches 结束之后才跑的，那会儿 draft 已被 immer
       * 回收，闭包里读 draft.duration 会抛 "Cannot perform 'get' on a proxy that has
       * been revoked" —— 状态其实已经提交了，但命令返回失败，用户看到的是「改成功了却报错」。
       */
      ctx.runtime((rt) => {
        rt.playhead = clamp(rt.playhead, 0, duration);
      });
      return { duration };
    },
  }),

  defineCommand({
    type: 'canvas.setFps',
    category: '画布',
    mutating: true,
    description: '设置导出帧率（1..60）。',
    schema: z.object({ fps: z.number().min(LIMITS.fps.min).max(LIMITS.fps.max) }),
    example: { fps: 30 },
    handler: (draft, payload) => {
      draft.fps = Math.round(payload.fps);
      return { fps: draft.fps };
    },
  }),
];
