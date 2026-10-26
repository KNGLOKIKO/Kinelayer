/**
 * AI 生产链路的三条命令：预检 → 导入 → 导出。
 *
 * 这条链的设计底线（v2.5 阶段 A）：
 *   1. **代码是一等公民图层**：导入不了的东西要么降级成代码层，要么明确拒绝，不许「假装成功」；
 *   2. **预检必须先跑**：`ai.importProject` 内部自己再跑一遍 `inspectImport`，
 *      所以哪怕调用方（Agent）跳过预检，也拿得到同一份降级报告；
 *   3. **降级要说人话**：每一处「丢了什么」都进 `report.notes`，UI 直接展示，不做二次解释。
 *
 * 这一层不碰 IndexedDB 的读（那是 importPipeline 的纯函数部分），只负责「映射结果怎么变成当前工程」。
 */

import { z } from 'zod';
import { defineCommand, CommandFailure, type CommandContext } from '../registry';
import { normalizeProject } from '../defaults';
import { unpackProject } from '../projectFile';
import { uid } from '../ids';
import { buildAiScene, aiSceneToJson, describeCode } from '../aiScene';
import { buildRemotionKit, type KitAsset } from '../remotionKit';
import {
  detectImportFormat,
  inspectImport,
  renderNote,
  mapAiScene,
  mapHtml,
  mapMedia,
  mapRemotion,
  mapScene,
  ImportError,
  type AssetJob,
  type ImportFormat,
  type ImportInput,
  type ImportMode,
  type ImportReport,
} from '../importPipeline';
import { bytesToBase64 } from '../bundle';
import { loadProjectRecord } from '@/persist/projects';
import type { Project } from '../types';
import { installAsCurrentProject } from './project';

const IMPORT_FORMATS = [
  'kly',
  'kly-json',
  'ai-scene',
  'project-json',
  'scene-json',
  'remotion',
  'html',
  'media',
  'unknown',
] as const;

const inputShape = {
  stageId: z.string().min(3).max(80).optional(),
  text: z.string().min(1).max(8_000_000).optional(),
  name: z.string().max(200).optional(),
  format: z.enum(IMPORT_FORMATS).optional(),
};

interface InputPayload {
  stageId?: string;
  text?: string;
  name?: string;
  format?: ImportFormat;
}

/** stageId（UI 选的文件）与 text（Agent 直接给的内容）二选一 */
async function resolveInput(payload: InputPayload, ctx: CommandContext): Promise<ImportInput> {
  if (payload.stageId) {
    const staged = await ctx.services.peekBundleStage(payload.stageId);
    if (!staged) throw new CommandFailure('NOT_FOUND', '导入文件已过期，请重新选择');
    return { bytes: staged.bytes, name: payload.name ?? staged.name, format: payload.format };
  }
  if (typeof payload.text === 'string') {
    return { text: payload.text, name: payload.name, format: payload.format };
  }
  throw new CommandFailure('VALIDATION', '需要 stageId（选中的文件）或 text（内容）其中之一');
}

function textOf(input: ImportInput): string {
  if (typeof input.text === 'string') return input.text;
  if (input.bytes) return new TextDecoder().decode(input.bytes);
  return '';
}

function fileStem(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n\t]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || 'project';
}

const MEDIA_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  ogg: 'video/ogg',
};

function mimeOfDataUrl(dataUrl: string): string {
  return /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? 'application/octet-stream';
}

/**
 * 把映射器留下的「待物化资源」写进资源库，并把 layerId 换成真的 assetId。
 * data URL 是映射器唯一能带过来的形态（外部路径它拿不到字节），所以这里只管解码。
 */
async function materializeAssets(project: Project, jobs: AssetJob[], ctx: CommandContext): Promise<number> {
  if (!jobs.length) return 0;
  const byLayer = new Map(jobs.map((job) => [job.layerId, job]));
  let written = 0;
  for (const layer of project.layers) {
    const job = byLayer.get(layer.id);
    if (!job) continue;
    try {
      const meta = await ctx.services.importAsset({ name: job.name, mime: mimeOfDataUrl(job.dataUrl), dataUrl: job.dataUrl });
      if (job.slot === 'proxy') {
        /*
         * 代理视频不是层的 asset，是「这层怎么显示」—— 写进 runtime 而不是 assetId。
         * 顺手把 previewMode 也升级掉，免得 runtime 里出现「有 proxyAssetId 但还写着静态首帧」。
         */
        if (layer.type === 'code' && layer.code.runtime) {
          layer.code = {
            ...layer.code,
            runtime: { ...layer.code.runtime, proxyAssetId: meta.id, previewMode: 'proxy-video' },
          };
        }
      } else {
        (layer as { assetId: string | null }).assetId = meta.id;
      }
      project.assets = [...project.assets.filter((a) => a.id !== meta.id), meta];
      written += 1;
    } catch (err) {
      /* 单个资源解不出来不该拦住整个导入：图层留着，用户自己再指定一张图 */
      console.warn('[Kinelayer] 导入资源失败：', job.name, err);
    }
  }
  return written;
}

function summaryOf(report: ImportReport, project: Project) {
  return {
    format: report.format,
    label: report.label,
    fidelity: report.fidelity,
    layers: project.layers.length - 1, // 减掉背景层，和报告口径一致
    structured: report.counts.structured,
    code: report.counts.code,
    media: report.counts.media,
    tracks: report.counts.tracks,
    keyframes: report.counts.keyframes,
    missingAssets: report.missingAssets,
    /* 给 Agent 的是成句中文（它读得懂，也省得自己拼占位符）；界面另外用结构化 notes 走 t() */
    notes: report.notes.map(renderNote),
    blockers: report.blockers.map(renderNote),
  };
}

export const aiCommands = [
  defineCommand({
    type: 'ai.inspectImport',
    category: 'AI',
    mutating: false,
    undoable: false,
    asyncHandler: true,
    description:
      '导入预检（只读）：给 stageId 或 text，回答「这次导入会得到什么」——格式、保真度、可编辑图层/代码层/轨道/关键帧数量、每一处降级的原因、以及不能导入的阻塞项。不写库、不改文档，可反复调用。',
    schema: z.object(inputShape),
    example: { text: '{"width":1080,"height":1080,"duration":5,"layers":[{"type":"text","text":"Hello"}]}' },
    handler: async (_draft, payload, ctx) => {
      const input = await resolveInput(payload, ctx);
      const { report } = await inspectImport(input);
      return { report, importable: report.supported && report.blockers.length === 0 };
    },
  }),

  defineCommand({
    type: 'ai.importProject',
    category: 'AI',
    mutating: true,
    resetsHistory: true,
    asyncHandler: true,
    description:
      '把外部工程/场景导入成一份**新**工程并打开（不覆盖同名工程）。支持 scene JSON（Rendervid/cadence 风格）、scene.ai.json、HTML/GSAP 片段（静态 DOM 解析）、图片/视频、原生 project.json、Remotion 工程 ZIP（静态 AST 解析）；.kly 工程包请走 project.importBundle。内部会先跑一次等价于 ai.inspectImport 的预检，结果随记录一起返回。Remotion 里能识别成文字/图片/盒子的元素变原生图层，其余组件整块保留为 remotion-component 代码层（不执行、不假装可内部编辑）。HTML 只拆绝对定位的元素（文本/图片/容器→原生图层，GSAP timeline→原生关键帧），普通流与 flex 布局的元素不猜位置，整块留成 html 代码层。',
    schema: z.object({
      ...inputShape,
      mode: z.enum(['prefer-editable', 'preserve-code']).default('prefer-editable'),
    }),
    example: { stageId: 'st_abc', mode: 'prefer-editable' },
    handler: async (draft, payload, ctx) => {
      const input = await resolveInput(payload, ctx);
      const mode = payload.mode as ImportMode;
      const format = detectImportFormat(input);
      /* 预检先跑：报告是这次导入的一部分，不是可选装饰 */
      const { report, mapped } = await inspectImport(input);

      if (format === 'kly') {
        throw new CommandFailure('VALIDATION', '这是 Kinelayer 工程包（ZIP），请用 project.importBundle 以便校验 sha256', {
          command: 'project.importBundle',
        });
      }
      if (report.blockers.length) {
        throw new CommandFailure('VALIDATION', report.blockers.map(renderNote).join('；'), { report });
      }
      if (!report.supported) {
        throw new CommandFailure('VALIDATION', `${renderNote({ key: report.label })} 暂不支持导入`, { report });
      }

      let project: Project;
      let jobs: AssetJob[] = [];
      let assetsWritten = 0;

      try {
        if (format === 'project-json' || format === 'kly-json') {
          /* 原生 JSON 不做映射：normalizeProject 就是精确还原，映射反而会丢资产引用 */
          project = normalizeProject(unpackProject(JSON.parse(textOf(input))));
        } else if (format === 'media') {
          const name = input.name ?? '媒体';
          const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
          const mime = MEDIA_MIME[ext] ?? 'application/octet-stream';
          const video = mime.startsWith('video');
          if (ctx.dryRun) {
            project = mapMedia(input, video ? 'video' : 'image', { width: 1080, height: 1080 }, null);
          } else {
            const dataUrl = `data:${mime};base64,${bytesToBase64(input.bytes ?? new Uint8Array())}`;
            const meta = await ctx.services.importAsset({ name, mime, dataUrl });
            assetsWritten += 1;
            project = mapMedia(input, video ? 'video' : 'image', { width: meta.width ?? 1080, height: meta.height ?? 1080 }, meta.id);
            project.assets = [meta];
          }
        } else if (format === 'html') {
          /* 和 Remotion 一样：预检跑的是 dryRun，这里按用户选的 mode 重跑一遍才有 project */
          const result = await mapHtml(input, mode, ctx.dryRun);
          if (!result.mapped) {
            throw new CommandFailure('VALIDATION', result.report.blockers.map(renderNote).join('；') || 'HTML 解析没有产出工程', {
              report: result.report,
            });
          }
          project = result.mapped.project;
          jobs = result.mapped.assetJobs;
        } else if (format === 'remotion') {
          /*
           * Remotion 的预检只跑 dryRun（拿到报告，不建工程），
           * 这里要按用户实际选的 mode 重跑一遍才有 project。
           */
          const result = await mapRemotion(input, mode, ctx.dryRun);
          if (!result.mapped) {
            throw new CommandFailure('VALIDATION', result.report.blockers.map(renderNote).join('；') || 'Remotion 解析没有产出工程', {
              report: result.report,
            });
          }
          project = result.mapped.project;
          jobs = result.mapped.assetJobs;
        } else if (format === 'ai-scene') {
          const result = mapped ?? mapAiScene(input, mode, ctx.dryRun);
          project = result.project;
          jobs = result.assetJobs;
        } else {
          const result = mapped ?? mapScene(input, mode, ctx.dryRun);
          project = result.project;
          jobs = result.assetJobs;
        }
      } catch (err) {
        if (err instanceof ImportError) throw new CommandFailure('VALIDATION', err.message, { code: err.code, report });
        throw new CommandFailure('VALIDATION', `导入映射失败：${(err as Error).message}`, { report });
      }

      /* 导入永远是「新增一份」：换新 id，别把本机同名的旧工程顶掉 */
      project.id = uid('prj');
      project.name = (payload.name ?? project.name).slice(0, 80) || '导入的工程';
      project.createdAt = Date.now();
      project.updatedAt = Date.now();
      project.version = draft.version + 1;

      const summary = { projectId: project.id, name: project.name, ...summaryOf(report, project), mode };
      if (ctx.dryRun) return { ...summary, dryRun: true };

      assetsWritten += await materializeAssets(project, jobs, ctx);
      await installAsCurrentProject(ctx, project, draft);
      return { ...summary, assets: assetsWritten };
    },
  }),

  defineCommand({
    type: 'ai.exportProject',
    category: 'AI',
    mutating: false,
    undoable: false,
    asyncHandler: true,
    description:
      '导出 scene.ai.json：当前工程给 Agent 读的语义投影（时间以秒为单位、缓动压成字符串、代码层带 codeSummary + 源码、不含任何 base64）。download=true 时同时触发下载；Agent 只读时不要开 download。',
    schema: z.object({
      projectId: z.string().min(1).max(80).optional(),
      includeCode: z.boolean().default(true),
      download: z.boolean().default(false),
    }),
    example: { includeCode: false },
    handler: async (draft, payload, ctx) => {
      const sourceId = payload.projectId ?? draft.id;
      const source = sourceId === draft.id ? draft : await loadProjectRecord(sourceId);
      if (!source) throw new CommandFailure('NOT_FOUND', `工程不存在：${sourceId}`);

      const scene = buildAiScene(source);
      if (!payload.includeCode) {
        for (const layer of scene.layers) {
          if (layer.type === 'code') layer.code = '';
        }
      }
      const text = aiSceneToJson(scene);
      const filename = `${fileStem(source.name)}.scene.ai.json`;
      const codeLayers = scene.layers.filter((l) => l.type === 'code').length;

      if (payload.download && !ctx.dryRun) {
        await ctx.services.saveTextFile(filename, text);
      }
      return {
        filename,
        text,
        bytes: text.length,
        layers: scene.layers.length,
        codeLayers,
        duration: scene.duration,
        fps: scene.fps,
        limitations: scene.capabilities.limitations,
      };
    },
  }),

  defineCommand({
    type: 'ai.exportRemotionKit',
    category: 'AI',
    mutating: false,
    undoable: false,
    asyncHandler: true,
    description:
      '导出 remotion-kit（ZIP）：把工程里的 remotion-component 层还原成一个能 `npx remotion render` 的外部工程（package.json + src/Root.tsx + 每层 entry.tsx + 原工程源码树 + public/assets + README）。没有 remotion 层时会明确报错；download=true 时触发下载。',
    schema: z.object({
      projectId: z.string().min(1).max(80).optional(),
      download: z.boolean().default(false),
    }),
    example: { download: false },
    handler: async (draft, payload, ctx) => {
      const sourceId = payload.projectId ?? draft.id;
      const source = sourceId === draft.id ? draft : await loadProjectRecord(sourceId);
      if (!source) throw new CommandFailure('NOT_FOUND', `工程不存在：${sourceId}`);

      const remotionLayers = source.layers.filter((l) => l.type === 'code' && l.code.engine === 'remotion-component');
      if (!remotionLayers.length) {
        throw new CommandFailure('VALIDATION', '这个工程里没有 remotion 组件层，没有可导出的 kit（原生图层请走 ai.exportProject 或 project.exportBundle）');
      }

      /* kit 的 public/assets 只放工程里还在用的媒体：原件按 basename 落盘，和 staticFile('assets/x.png') 对得上 */
      const assets: KitAsset[] = [];
      const missingAssets: string[] = [];
      if (!ctx.dryRun) {
        for (const meta of source.assets) {
          const rec = await ctx.services.readAsset(meta.id);
          if (!rec) {
            missingAssets.push(meta.name);
            continue;
          }
          assets.push({ name: rec.name || meta.name, bytes: rec.bytes });
        }
      }

      const kit = buildRemotionKit({ project: source, assets });
      if (!kit.compositions.length) {
        throw new CommandFailure(
          'VALIDATION',
          `没有可导出的 remotion 组件：${kit.skipped.map((s) => `${s.layer}（${s.reason}）`).join('；') || '源码为空'}`,
        );
      }

      const filename = `${fileStem(source.name)}.remotion-kit.zip`;
      if (payload.download && !ctx.dryRun) {
        await ctx.services.saveBinaryFile(filename, kit.bytes, 'application/zip');
      }

      return {
        filename,
        bytes: kit.bytes.length,
        files: kit.files,
        compositions: kit.compositions,
        hasOriginalTree: kit.hasOriginalTree,
        skipped: kit.skipped,
        missingAssets,
        layers: remotionLayers.length,
      };
    },
  }),

  defineCommand({
    type: 'ai.queryCodeLayer',
    category: 'AI',
    mutating: false,
    undoable: false,
    description:
      '查代码层（只读）：不给 layerId 就列出全部代码层的引擎/摘要/行数/参数字段；给 layerId 时可选带上完整源码。导出整份 scene.ai.json 太费上下文时用这个。',
    schema: z.object({
      layerId: z.string().min(1).max(80).optional(),
      includeCode: z.boolean().default(false),
    }),
    example: { includeCode: false },
    handler: (draft, payload) => {
      const codeLayers = draft.layers.filter((l) => l.type === 'code');
      const describe = (layer: (typeof codeLayers)[number]) => {
        if (layer.type !== 'code') return null;
        return {
          id: layer.id,
          name: layer.name,
          engine: layer.code.engine,
          summary: describeCode(layer.code),
          lines: layer.code.source.split('\n').length,
          bytes: layer.code.source.length,
          params: Object.keys(layer.code.params ?? {}),
          inPoint: layer.inPoint,
          outPoint: layer.outPoint,
          ...(payload.includeCode ? { code: layer.code.source } : {}),
        };
      };

      if (payload.layerId) {
        const layer = codeLayers.find((l) => l.id === payload.layerId);
        if (!layer) throw new CommandFailure('NOT_FOUND', `没有这个代码层：${payload.layerId}`);
        return { layer: describe(layer), total: codeLayers.length };
      }
      return { layers: codeLayers.map(describe), total: codeLayers.length };
    },
  }),
];
