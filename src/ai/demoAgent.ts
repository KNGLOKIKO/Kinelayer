import type { Project } from '@/core/types';
import { getBackground } from '@/core/types';
import { t } from '@/i18n';

export interface PlannedCommand {
  type: string;
  payload: unknown;
  label: string;
}

export interface DemoReply {
  text: string;
  commands: PlannedCommand[];
}

function selected(project: Project, ids: string[]): string | null {
  return ids[0] ?? project.layers[1]?.id ?? null;
}

/**
 * 离线演示代理：不联网也能验证通道 A 的整条链路
 * （自然语言 → 工具调用 → 命令总线 → 撤销栈 → 广播）。
 * 只覆盖最常见的几种意图，命中不了会给出能力说明。
 *
 * 注意：入参 text 的小写副本叫 `q`，不能再叫 `t` —— 那会遮蔽 i18n 的取词函数。
 */
export function planDemo(text: string, project: Project, selectedIds: string[]): DemoReply {
  const q = text.toLowerCase();
  const bg = getBackground(project);
  const target = selected(project, selectedIds);

  if (/导出|export/.test(q) && /png|图片|静帧|still/.test(q)) {
    return {
      text: t('好的，导出当前帧为 PNG（2 倍图）。'),
      commands: [{ type: 'export.png', payload: { scale: 2, transparent: false }, label: t('导出 PNG') }],
    };
  }
  if (/导出|export/.test(q) && /webm|视频|video/.test(q)) {
    return {
      text: t('开始逐帧导出 WebM，请保持页面在前台。'),
      commands: [{ type: 'export.webm', payload: { fps: 30, quality: 75 }, label: t('导出 WebM') }],
    };
  }
  if (/播放|预览|play/.test(q)) {
    return { text: t('开始播放时间轴。'), commands: [{ type: 'timeline.play', payload: {}, label: t('播放') }] };
  }
  if (/暂停|停止|pause|stop/.test(q)) {
    return { text: t('已暂停。'), commands: [{ type: 'timeline.pause', payload: {}, label: t('暂停') }] };
  }
  if (/背景|background/.test(q) && /(渐变|紫色|深色|暗色|gradient|purple|dark)/.test(q)) {
    return {
      text: t('把背景换成深紫渐变。'),
      commands: [
        {
          type: 'background.set',
          payload: {
            kind: 'gradient',
            gradient: {
              type: 'linear',
              angle: 145,
              stops: [
                { offset: 0, color: '#07090f' },
                { offset: 0.6, color: '#141a2e' },
                { offset: 1, color: '#2a1147' },
              ],
            },
          },
          label: t('背景改为深紫渐变'),
        },
      ],
    };
  }
  if (/删除|delete|remove/.test(q) && target) {
    return {
      text: t('删除当前选中的图层。'),
      commands: [{ type: 'layer.delete', payload: { ids: [target], force: false }, label: t('删除图层') }],
    };
  }
  if (/复制|再来一个|duplicate/.test(q) && target) {
    return {
      text: t('复制当前图层并向右下偏移。'),
      commands: [{ type: 'layer.duplicate', payload: { ids: [target] }, label: t('复制图层') }],
    };
  }
  if (/(标题|文字|文本|加一行|写字|title|heading)/.test(q) && /(加|新建|创建|添加|写|add|new|create)/.test(q)) {
    const content = text.replace(/^.*?(?:写上|文字|标题|文本|加一个|添加|新建|add|create)[：: ]?/i, '').trim() || t('在这里输入标题');
    return {
      text: t('新建一个居中标题「{text}」，64px 粗体，并带淡入。', { text: content.slice(0, 18) }),
      commands: [
        {
          type: 'layer.create',
          payload: {
            type: 'text',
            text: content,
            x: Math.round(project.width * 0.08),
            y: Math.round(project.height * 0.42),
            width: Math.round(project.width * 0.84),
            height: 220,
            textStyle: { fontSize: 72, fontWeight: 700, color: '#ffffff', lineHeight: 1.2 },
          },
          label: t('新建标题'),
        },
      ],
    };
  }
  if (/(字号|大一点|放大|小一点|缩小|font size|bigger|larger|smaller)/.test(q) && target) {
    const layer = project.layers.find((l) => l.id === target);
    if (layer?.type === 'text') {
      const bigger = /(大|放大|bigger|larger)/.test(q) && !/缩小|smaller/.test(q);
      const fontSize = Math.round(layer.style.fontSize * (bigger ? 1.2 : 0.85));
      return {
        text: t('把「{name}」字号调整为 {size}px。', { name: layer.name, size: fontSize }),
        commands: [{ type: 'text.setStyle', payload: { id: layer.id, style: { fontSize } }, label: t('调整字号') }],
      };
    }
  }
  if (/(颜色|变色|改成|color)/.test(q) && target) {
    const m = /#([0-9a-f]{6})/i.exec(text);
    const layer = project.layers.find((l) => l.id === target);
    if (m && layer?.type === 'text') {
      return {
        text: t('把「{name}」的文字颜色改成 #{color}。', { name: layer.name, color: m[1] }),
        commands: [
          { type: 'text.setStyle', payload: { id: layer.id, style: { color: `#${m[1]}` } }, label: t('改文字颜色') },
        ],
      };
    }
  }
  if (/代码层|加个代码|生成式|code layer/.test(q)) {
    return {
      text: t('新建一个全画布代码层，用流线做背景纹理（screen 混合）。'),
      commands: [
        {
          type: 'layer.create',
          payload: {
            type: 'code',
            name: t('流线'),
            x: 0,
            y: 0,
            width: project.width,
            height: project.height,
            code: {
              engine: 'canvas2d',
              params: {},
              source:
                "ctx.clearRect(0,0,width,height);\nctx.globalCompositeOperation='lighter';\nfor(let i=0;i<6;i++){const t=time*0.0002+i;ctx.beginPath();for(let x=0;x<=width;x+=14){const y=height*(0.2+i*0.12)+Math.sin(x*0.004+t*3)*50+(api.noise(x*0.002+t,i)-0.5)*120;x===0?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.strokeStyle=i%2?'rgba(34,211,238,.4)':'rgba(124,92,255,.5)';ctx.lineWidth=1.4;ctx.stroke();}",
            },
          },
          label: t('新建代码层'),
        },
      ],
    };
  }
  if (/居中|对齐|center|align/.test(q) && target) {
    return {
      text: t('把选中图层水平居中。'),
      commands: [{ type: 'layer.align', payload: { ids: [target], mode: 'center-x' }, label: t('水平居中') }],
    };
  }

  return {
    text: [
      t('演示模式能识别这些指令：'),
      t('· 加一个标题「…」 · 字号大一点 · 把颜色改成 #7c5cff'),
      t('· 背景改成渐变 · 加个代码层 · 居中 · 复制 · 删除'),
      t('· 播放 / 暂停 · 导出 PNG / 导出 WebM'),
      '',
      t('当前画布 {w}×{h}，共 {n} 个图层（含背景 {kind}）。', {
        w: project.width,
        h: project.height,
        n: project.layers.length,
        kind: bg.kind,
      }),
      t('接入真实模型后可以用任意自然语言描述排版；在设置里填 Base URL / Key 并关闭演示模式即可。'),
    ].join('\n'),
    commands: [],
  };
}
