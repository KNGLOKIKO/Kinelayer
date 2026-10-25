import { buildOpenAITools, type OpenAITool } from '@/core/registry';
import { summarizeProject } from '@/core/summary';
import { useEditor } from '@/core/store';

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export function systemPrompt(): string {
  const state = useEditor.getState();
  const summary = summarizeProject(state.project);
  return [
    '你是 Kinelayer 动态海报编辑器的操作代理。你只能通过提供的工具函数修改项目，不能直接改文件或 DOM。',
    '',
    '规则：',
    '1. 动手前先调用 query_project 读取当前状态；不确定 payload 形状时调用 query_registry。',
    '2. 所有修改都必须落到一个命令上。多个相关修改请用 command_batch（atomic=true）合并成一个撤销点。',
    '3. 坐标系原点在画布左上角，单位 px。画布尺寸见下。图层数组顺序即 z 序，背景永远在最底层且不可删除。',
    '4. 文本层请显式给出 x/y/width/height 与字号，避免默认值导致排版错位。中文字体优先 Microsoft YaHei / PingFang SC。',
    '5. 不要请求或传输任何图片 base64。资源只能通过 asset_place 使用已导入的 assetId。',
    '6. 需要核对画面时调用 query_capture（返回截图），不要凭空猜测视觉结果。',
    '7. 回答用简体中文，简短说明你做了什么、涉及哪些图层 id。',
    '',
    '当前项目摘要：',
    JSON.stringify(summary),
    '',
    `当前播放头：${Math.round(state.runtime.playhead)}ms`,
    `当前选中：${state.ui.selectedIds.join(', ') || '无'}`,
  ].join('\n');
}

export function tools(): OpenAITool[] {
  return buildOpenAITools();
}

export interface CompletionResult {
  content: string;
  toolCalls: ToolCall[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export async function chatCompletion(
  messages: ChatMessage[],
  opts: { baseUrl: string; apiKey: string; model: string; temperature: number },
  signal?: AbortSignal,
): Promise<CompletionResult> {
  const url = `${opts.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      tools: tools(),
      tool_choice: 'auto',
      temperature: opts.temperature,
      max_tokens: 2400,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI 接口 HTTP ${res.status}：${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
    usage?: CompletionResult['usage'];
  };
  const message = json.choices?.[0]?.message;
  return {
    content: message?.content ?? '',
    toolCalls: message?.tool_calls ?? [],
    usage: json.usage,
  };
}
