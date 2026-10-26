/**
 * remotion-kit 导出：把工程里的 `remotion-component` 层还原成一个能 `npx remotion render` 的小工程。
 *
 * 为什么要有这个东西：Remotion 层在 Kinelayer 里只能静态预览（浏览器不跑渲染管线），
 * 用户想拿到成片只有两条路 —— ① 在这里继续当图层做（做不到的部分就不是层）；
 * ② 把代码原样带走，在外部 Remotion 环境出片。这份 kit 就是第 ② 条路。
 *
 * 目录（规格里定的形状）：
 *   remotion-kit/
 *   ├── package.json          只放 remotion 侧依赖，不搬原工程的依赖树
 *   ├── src/index.ts          registerRoot
 *   ├── src/Root.tsx          每个 remotion 层一个 Composition
 *   ├── src/layers/<Name>/entry.tsx   该层的组件源码（补 default export）
 *   ├── src/original/**       原工程源码树（相对 import 靠它才不断）
 *   ├── public/assets/**      引用的媒体
 *   └── README.md             npx remotion render 的命令
 *
 * 诚实性：kit 里**不写**「这就是原片」。能重建到哪一步，README 和返回值都写清楚：
 * 结构化图层不在 kit 里（它们已经变成原生图层了），kit 只负责 remotion 组件那部分。
 */

import { strToU8, zipSync } from 'fflate';
import type { Project, RemotionRuntime } from './types';

export interface KitAsset {
  /** 写进 public/assets 的文件名（不含目录） */
  name: string;
  bytes: Uint8Array;
}

export interface KitBuildInput {
  project: Project;
  /** 已经读出来的资源字节（命令层负责从资源库取，这里只排版） */
  assets: KitAsset[];
}

export interface KitComposition {
  /** Composition id（remotion 只允许字母数字和连字符） */
  id: string;
  component: string;
  entryPath: string;
  layerName: string;
}

export interface KitBuild {
  bytes: Uint8Array;
  files: string[];
  compositions: KitComposition[];
  /** 没能写进 kit 的层（源码为空等），连同原因 */
  skipped: { layer: string; reason: string }[];
  /** 有没有带原工程源码树 */
  hasOriginalTree: boolean;
}

const KIT_ROOT = 'remotion-kit/';

/** 组件名 / 文件名：只保留安全字符，避免把用户图层名当路径用 */
function safeName(raw: string, fallback: string): string {
  const s = raw.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  return s || fallback;
}

function pascal(raw: string, fallback: string): string {
  const s = raw
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('')
    .slice(0, 32);
  return /^[A-Za-z]/.test(s) ? s : fallback;
}

/** 源码里已经有 default export 就不要再补一个（会导致「重复导出」语法错误） */
function withDefaultExport(code: string, componentName: string): string {
  if (/\bexport\s+default\b/.test(code)) return code;
  const hasNamed = new RegExp(`\\b(?:export\\s+)?(?:const|function|class)\\s+${componentName}\\b`).test(code);
  if (!hasNamed) return code;
  return `${code.trimEnd()}\n\nexport default ${componentName};\n`;
}

/** 原工程源码树里，哪些文件是「本来就该在根上」的（这些不需要再套一层 src/） */
function originalPathOf(path: string): string {
  const clean = path.replace(/^\.?\//, '');
  return `${KIT_ROOT}src/original/${clean}`;
}

function readRuntime(layer: Project['layers'][number]): RemotionRuntime | null {
  if (layer.type !== 'code') return null;
  const rt = layer.code.runtime;
  return layer.code.engine === 'remotion-component' && rt ? rt : null;
}

/** 估算 kit 里的 Composition 时长：层自己的时长优先，其次 runtime 里的 composition 时长 */
function framesOf(layer: Project['layers'][number], fps: number, fallback: number): number {
  const span = Math.max(1, layer.outPoint - layer.inPoint);
  const fromLayer = Math.round((span / 1000) * fps);
  return Math.max(1, fromLayer || fallback);
}

export function buildRemotionKit(input: KitBuildInput): KitBuild {
  const { project } = input;
  const fps = Math.max(1, Math.round(project.fps) || 30);
  const width = Math.max(1, Math.round(project.width));
  const height = Math.max(1, Math.round(project.height));
  const totalFrames = Math.max(1, Math.round((project.duration / 1000) * fps));

  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  const text = (path: string, body: string): void => {
    files[`${KIT_ROOT}${path}`] = [strToU8(body), { level: 6 }];
  };

  const compositions: KitComposition[] = [];
  const skipped: KitBuild['skipped'] = [];
  const imports: string[] = [];
  const elements: string[] = [];
  let originalTree: { path: string; code: string }[] | null = null;

  let seq = 0;
  for (const layer of project.layers) {
    const rt = readRuntime(layer);
    if (!rt) continue;
    seq += 1;
    /* 源码树只取一次（它挂在第一个 remotion 层上） */
    if (!originalTree && rt.sources?.length) originalTree = rt.sources;

    const code = (rt.entryCode || (layer.type === 'code' ? layer.code.source : '') || '').trim();
    if (!code) {
      skipped.push({ layer: layer.name, reason: '源码为空' });
      continue;
    }

    const idx = String(seq).padStart(2, '0');
    const id = `kly-${idx}`;
    const component = pascal(layer.name, `Layer${idx}`);
    const dir = `src/layers/${safeName(layer.name, `layer-${idx}`)}`;
    const entryPath = `${KIT_ROOT}${dir}/entry.tsx`;

    text(`${dir}/entry.tsx`, `/*\n * Kinelayer 导出 · 图层「${layer.name}」\n * 下面这段是从原 Remotion 工程里原样摘出来的源码，只做了「确保有 default export」这一步。\n * 它不在 Kinelayer 里执行，只在这里被 render 消费。\n */\n\n${withDefaultExport(code, component)}\n`);

    const importName = `Layer${idx}`;
    imports.push(`import ${importName} from './layers/${safeName(layer.name, `layer-${idx}`)}/entry';`);
    elements.push(
      `      <Composition\n        id="${id}"\n        component={${importName}}\n        durationInFrames={${framesOf(layer, fps, rt.durationInFrames)}}\n        fps={${rt.fps || fps}}\n        width={${rt.width || width}}\n        height={${rt.height || height}}\n      />`,
    );
    compositions.push({ id, component: importName, entryPath, layerName: layer.name });
  }

  /* 原工程源码树：相对 import 靠它才不断 */
  if (originalTree) {
    for (const file of originalTree) {
      files[originalPathOf(file.path)] = [strToU8(file.code), { level: 6 }];
    }
  }

  /* 媒体：同名会互相覆盖，加序号前缀保证都留得下 */
  for (const asset of input.assets) {
    const name = safeName(asset.name.replace(/\.[^.]+$/, ''), 'asset');
    const ext = /\.([a-zA-Z0-9]+)$/.exec(asset.name)?.[1] ?? 'bin';
    files[`${KIT_ROOT}public/assets/${name}.${ext}`] = [asset.bytes, { level: 0 }];
  }

  if (!compositions.length) {
    return {
      bytes: new Uint8Array(),
      files: [],
      compositions: [],
      skipped,
      hasOriginalTree: !!originalTree,
    };
  }

  text(
    'src/Root.tsx',
    `/* Kinelayer 生成：每个 remotion 层一个 Composition，id 就是图层序号 */\nimport { Composition } from 'remotion';\n${imports.join('\n')}\n\nexport const RemotionRoot = () => {\n  return (\n    <>\n${elements.join('\n')}\n    </>\n  );\n};\n`,
  );

  text('src/index.ts', `import { registerRoot } from 'remotion';\nimport { RemotionRoot } from './Root';\n\nregisterRoot(RemotionRoot);\n`);

  text(
    'package.json',
    `${JSON.stringify(
      {
        name: 'kinelayer-remotion-kit',
        version: '1.0.0',
        private: true,
        description: `Kinelayer 导出的 Remotion 组件（工程：${project.name}）`,
        scripts: {
          render: `remotion render src/index.ts ${compositions[0]!.id} out/${compositions[0]!.id}.mp4`,
          studio: 'remotion studio src/index.ts',
        },
        dependencies: {
          react: '^19.0.0',
          'react-dom': '^19.0.0',
          remotion: '^4.0.0',
        },
        devDependencies: {
          '@remotion/cli': '^4.0.0',
        },
      },
      null,
      2,
    )}\n`,
  );

  text('README.md', kitReadme(project, compositions, !!originalTree, skipped, totalFrames, fps, width, height));

  const zipped = zipSync(files, { mtime: Date.now() });
  return {
    bytes: zipped,
    files: Object.keys(files).map((p) => p.replace(KIT_ROOT, '')),
    compositions,
    skipped,
    hasOriginalTree: !!originalTree,
  };
}

function kitReadme(
  project: Project,
  compositions: KitComposition[],
  hasTree: boolean,
  skipped: KitBuild['skipped'],
  totalFrames: number,
  fps: number,
  width: number,
  height: number,
): string {
  const list = compositions.map((c) => `| \`${c.id}\` | ${c.layerName} | \`${c.entryPath.replace(KIT_ROOT, '')}\` |`).join('\n');
  const skip = skipped.length ? `\n## 没有导出成功的层\n\n${skipped.map((s) => `- ${s.layer}：${s.reason}`).join('\n')}\n` : '';
  const tree = hasTree
    ? `
## 原工程源码

原工程的整棵源码树在 \`src/original/\` 下（保持原来的相对路径）。
想还原**完整原片**（包括已经被 Kinelayer 拆成原生图层的文字/图片），直接对原始入口 render：

\`\`\`bash
npx remotion render src/original/src/index.ts <原 Composition id> out/original.mp4
\`\`\`

注意：原树的入口文件名与 Composition id 来自原工程，不一定是 \`src/index.ts\`，以 \`src/original/\` 里的实际文件为准。
`
    : `
## 原工程源码

这份 kit **没有**带原工程源码树（原工程源码体积超过保存上限，或导入时只剩单个组件）。
所以它能渲染的只有下面列出的这些 Composition，原片请回原工程出。
`;

  return `# remotion-kit · ${project.name}

由 Kinelayer 导出。这里是工程里那些「整块保留为 Remotion 代码层」的组件，
**可以在外部 Remotion 环境出片** —— Kinelayer 自己不在浏览器里跑渲染管线。

工程参数：${width}×${height} · ${fps}fps · ${(totalFrames / fps).toFixed(2)}s（${totalFrames} 帧）

## 导出内容

| Composition id | 来自图层 | 入口 |
| --- | --- | --- |
${list}
${skip}${tree}
## 出片

\`\`\`bash
npm install
npx remotion render src/index.ts ${compositions[0]!.id} out/${compositions[0]!.id}.mp4
\`\`\`

先跑 \`npx remotion studio src/index.ts\` 看一眼也行。

## 边界

- 每个 \`src/layers/*/entry.tsx\` 是原组件源码的**原样副本**，只补了一行 \`export default\`（原本没有 default export 时）。
- Kinelayer 里给这些层打的关键帧不在这里：它们从没被当成可编辑轨道（这正是「不假装能编辑」的意思）。
- 已经被拆成原生图层（文字/图片/盒子）的部分不在 kit 里 —— 那部分请在 Kinelayer 里改和导出。
`;
}
