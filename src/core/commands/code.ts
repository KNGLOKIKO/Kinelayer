import { z } from 'zod';
import { defineCommand, CommandFailure } from '../registry';
import { zCodeSpec, zEngine, zId } from '../schemas';
import { requireCode } from './_helpers';
import { resetCodeRuntime } from '@/render/codeEngine';
import { clearCodeSafeMode, isCodeSafeMode, markCodeSafeMode } from '@/persist/projects';
import { clearCrashMarker } from '@/core/loopProtect';

export const codeCommands = [
  defineCommand({
    type: 'code.setSource',
    category: '代码',
    mutating: true,
    description:
      '替换代码层源码。canvas2d 引擎可用 ctx/api/params/width/height/time/frame/state/output；glsl 引擎写 void main()，可用 u_time/u_resolution。',
    schema: z.object({ id: zId, source: z.string().max(200_000) }),
    example: {
      id: 'ly_abc',
      source:
        "const t = time * 0.001;\nctx.clearRect(0,0,width,height);\nctx.fillStyle = 'rgba(124,92,255,.6)';\nctx.fillRect(0, height/2 + Math.sin(t)*40, width, 4);",
    },
    handler: (draft, payload) => {
      const layer = requireCode(draft, payload.id);
      layer.code.source = payload.source;
      resetCodeRuntime(layer.id);
      return { id: layer.id, bytes: payload.source.length };
    },
  }),

  defineCommand({
    type: 'code.setEngine',
    category: '代码',
    mutating: true,
    description: '切换代码层引擎：canvas2d | glsl | html。切换不会改动源码，但源码需要符合对应引擎的约定。',
    schema: z.object({ id: zId, engine: zEngine }),
    example: { id: 'ly_abc', engine: 'glsl' },
    handler: (draft, payload) => {
      const layer = requireCode(draft, payload.id);
      layer.code.engine = payload.engine;
      resetCodeRuntime(layer.id);
      return { id: layer.id, engine: layer.code.engine };
    },
  }),

  defineCommand({
    type: 'code.setParams',
    category: '代码',
    mutating: true,
    coalesce: true,
    description: '设置代码层的参数对象（整体替换），代码内通过 params 读取。',
    schema: z.object({ id: zId, params: zCodeSpec.shape.params }),
    example: { id: 'ly_abc', params: { density: 12, color: '#7c5cff' } },
    handler: (draft, payload) => {
      const layer = requireCode(draft, payload.id);
      layer.code.params = payload.params;
      resetCodeRuntime(layer.id);
      return { id: layer.id, params: layer.code.params };
    },
  }),

  defineCommand({
    type: 'code.setRenderScale',
    category: '代码',
    mutating: true,
    description:
      '设置代码层的内部分辨率倍率（0.25–1，1 为原始）。低频成片画面（噪声场、雾、辉光）降它可以成倍省时间，文字与细线不要降。',
    schema: z.object({ id: zId, renderScale: z.number().min(0.25).max(1).nullable() }),
    example: { id: 'ly_abc', renderScale: 0.5 },
    handler: (draft, payload) => {
      const layer = requireCode(draft, payload.id);
      if (payload.renderScale === null) delete layer.code.renderScale;
      else layer.code.renderScale = payload.renderScale;
      return { id: layer.id, renderScale: layer.code.renderScale ?? 1 };
    },
  }),

  defineCommand({
    type: 'code.setMotionBlur',
    category: '代码',
    mutating: true,
    description:
      '设置代码层的子帧运动模糊。samples 是同一帧内取几个子帧（2–32，或 \'auto\' 按收敛情况自适应），shutter 是快门时长（毫秒）—— 注意它是一帧曝光，不是重影次数：30fps 下一帧 33ms，给 110ms 会得到三次离散重影（长曝光），给 44ms 才是真正的运动模糊。samples 为 \'auto\' 时 tol 是收敛阈值（色阶，默认 3）：从 4 起步逐级加密，全图最大变化不超过 tol 就停。代价是绘制次数线性上涨（只影响这一层），所以给一两层需要方向感的元素用，不要整片都开。传 null 关闭。',
    schema: z.object({
      id: zId,
      motionBlur: z
        .object({
          samples: z.union([z.number().int().min(2).max(32), z.literal('auto')]),
          shutter: z.number().min(1).max(200),
          tol: z.number().min(0).max(32).optional(),
        })
        .nullable(),
    }),
    example: { id: 'ly_abc', motionBlur: { samples: 5, shutter: 44 } },
    handler: (draft, payload) => {
      const layer = requireCode(draft, payload.id);
      if (payload.motionBlur === null) delete layer.code.motionBlur;
      else layer.code.motionBlur = payload.motionBlur;
      return { id: layer.id, motionBlur: layer.code.motionBlur ?? null };
    },
  }),

  defineCommand({
    type: 'code.resetRuntime',
    category: '代码',
    mutating: false,
    description: '清空某个代码层（或全部代码层）的编译缓存与熔断状态，用于异常后恢复。',
    schema: z.object({ id: zId.optional() }),
    example: { id: 'ly_abc' },
    handler: (_draft, payload) => {
      resetCodeRuntime(payload.id);
      return { reset: payload.id ?? 'all' };
    },
  }),

  defineCommand({
    type: 'code.setSafeMode',
    category: '代码',
    mutating: false,
    undoable: false,
    asyncHandler: true,
    description:
      '开关「代码层安全模式」：开启后预览不再求值代码层（死循环把编辑器冻住时的自救出口），并把这件事记进本机的工程偏好 —— 关掉浏览器再打开也还记得。关闭时同时清掉那条持久记忆与会话内的崩溃标记，代码层下一帧按带保护的源码重新编译。它不改文档、不进撤销栈；不带 projectId 时操作当前工程。',
    schema: z.object({
      projectId: z.string().min(1).max(80).optional(),
      enabled: z.boolean(),
    }),
    example: { enabled: false },
    handler: async (draft, payload, ctx) => {
      /* asyncHandler 拿到的是纯克隆，读字段安全；下面仍先落成普通变量，
         好让 ctx.ui 的闭包不碰 draft（那条铁律对克隆同样适用，省得以后改回 immer 忘掉） */
      const currentId = draft.id;
      const targetId = payload.projectId ?? currentId;
      if (!targetId) throw new CommandFailure('INVARIANT', '没有可操作的工程：传 projectId，或先打开一个工程');

      if (payload.enabled) {
        await markCodeSafeMode(targetId);
      } else {
        /* 会话内标记一起清：否则下一轮刷新还会被它判成「上次崩过」 */
        clearCrashMarker(targetId);
        await clearCodeSafeMode(targetId);
      }

      /* 开关只对当前打开的工程有意义；给别的工程留记号是上面那两行的事 */
      if (targetId !== currentId) {
        return { projectId: targetId, enabled: payload.enabled, applied: false };
      }

      const next = payload.enabled;
      ctx.ui((ui) => {
        ui.codeSafeMode = next;
      });
      /* 无论开还是关，旧运行时都作废：开是白占显存，关是必须按带保护的源码重编 */
      resetCodeRuntime();
      return {
        projectId: targetId,
        enabled: next,
        applied: true,
        persisted: await isCodeSafeMode(targetId),
      };
    },
  }),
];
