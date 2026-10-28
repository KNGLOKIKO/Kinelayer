import type { Locale } from './index';

/**
 * 英文词典。
 *
 * key 一律是**中文原文**（见 i18n/index.ts 的设计说明），value 是译文。
 * 未命中的 key 会原样回退成中文，所以这里漏一条不会崩，只是漏翻。
 */
export const en: Record<string, string> = {
  // ── 编辑器画布 ──────────────────────────────────────────
  '拖拽移动 · 双击编辑文本 · 空格拖拽平移 · Ctrl+滚轮缩放':
    'Drag to move · double-click to edit text · space-drag to pan · Ctrl+wheel to zoom',
  '· 空格 + 拖拽：平移画布；Ctrl + 滚轮：缩放': '· Space + drag: pan the canvas; Ctrl + wheel: zoom',
  '· 双击文本层：就地编辑；拖拽手柄缩放，顶部圆点旋转':
    '· Double-click a text layer to edit in place; drag handles to resize, the top dot to rotate',
  '· 所有改动都会进入同一个撤销栈': '· Every change lands on the same undo stack',
  '· 选中后按方向键微调 1px（Shift 为 10px）':
    '· With a layer selected, arrow keys nudge by 1px (Shift for 10px)',

  // ── 顶栏 / 全局 ─────────────────────────────────────────
  动态海报工作台: 'Motion poster studio',
  撤销: 'Undo',
  重做: 'Redo',
  '撤销 (Ctrl+Z)': 'Undo (Ctrl+Z)',
  '重做 (Ctrl+Shift+Z)': 'Redo (Ctrl+Shift+Z)',
  '播放 / 暂停': 'Play / Pause',
  '播放 / 暂停 (Space)': 'Play / Pause (Space)',
  回到开头: 'Back to start',
  '适应窗口 (Shift+1)': 'Fit to window (Shift+1)',
  设置: 'Settings',
  接入: 'Integrate',
  界面语言: 'Interface language',
  'AI 接入提示词': 'AI integration prompt',
  'AI 接入提示词（复制给任意模型 / MCP 客户端）':
    'AI integration prompt (copy to any model / MCP client)',
  关闭: 'Close',
  取消: 'Cancel',
  重试: 'Retry',
  删除: 'Delete',
  复制: 'Copy',
  清除: 'Clear',
  失败: 'Failed',
  执行失败: 'Failed',

  // ── 左侧面板 ────────────────────────────────────────────
  图层: 'Layers',
  资源: 'Assets',
  命令: 'Commands',
  字体: 'Fonts',
  添加图层: 'Add layer',
  图片层: 'Image layer',
  文本层: 'Text layer',
  代码层: 'Code layer',
  视频层: 'Video layer',
  背景层: 'Background layer',
  '把图片或视频拖进来': 'Drop images or video here',
  '导入图片 / 视频': 'Import image / video',
  '点击放置到画布': 'Click to place on the canvas',
  上传: 'Upload',
  '上传字体文件': 'Upload font file',
  '扫描本地字体（需授权）': 'Scan local fonts (needs permission)',
  搜索字体: 'Search fonts',
  '搜索命令 / 分类': 'Search commands / categories',
  '这份列表与 AI 工具、MCP 工具同源。改这里就是改能力。':
    'This list is the same source the AI and MCP tools read from — change it here and you change what they can do.',
  命令注册表: 'Command registry',
  整理: 'Tidy',
  '修复越界与时间区间': 'Fix out-of-bounds and time ranges',
  运行: 'Run',
  '来源 user': 'source: user',
  '先选中一个文本层': 'Select a text layer first',
  显示: 'Show',
  隐藏: 'Hide',
  锁定: 'Lock',
  解锁: 'Unlock',
  导入失败: 'Import failed',
  '读取文件失败': 'Could not read the file',
  '字体注册失败': 'Font registration failed',
  '请求授权中…': 'Requesting permission…',
  '在独立窗口编辑': 'Edit in its own window',

  // ── 检查器 · 画布 / 背景 ─────────────────────────────────
  画布: 'Canvas',
  '画布 / 背景': 'Canvas / Background',
  宽: 'W',
  高: 'H',
  时长: 'Duration',
  背景: 'Background',
  纯色: 'Solid',
  渐变: 'Gradient',
  径向: 'Radial',
  颜色: 'Color',
  '+ 增加色标': '+ Add stop',
  '编辑背景代码': 'Edit background code',
  '在左侧「资源」里选一张图，点「设为背景」，或用命令 background.set 指定 assetId。':
    'Pick an image in the Assets panel and hit “Set as background”, or pass an assetId to the background.set command.',
  '在左侧资源面板导入': 'Import from the Assets panel',
  安全区: 'Safe area',
  吸附: 'Snap',
  循环: 'Loop',

  // ── 检查器 · 通用 ───────────────────────────────────────
  变换: 'Transform',
  对齐: 'Align',
  顶对齐: 'Top',
  居中: 'Center',
  底对齐: 'Bottom',
  '居中并复位旋转': 'Center and reset rotation',
  操作提示: 'Tips',
  '复制图层': 'Duplicate layer',
  独立窗口: 'In own window',
  删除图层: 'Delete layer',
  可见: 'Visible',
  不透明度: 'Opacity',
  混合模式: 'Blend mode',

  // ── 检查器 · 文本 / 图片 / 外观 ──────────────────────────
  字重: 'Weight',
  字号: 'Size',
  字距: 'Tracking',
  行高: 'Line height',
  大写: 'Uppercase',
  自动换行: 'Wrap',
  重置文本样式: 'Reset text style',
  描边: 'Stroke',
  圆角: 'Radius',
  填充: 'Fill',
  填充方式: 'Fill type',
  '使用渐变填充': 'Use gradient fill',
  包含: 'Contain',
  覆盖: 'Cover',
  拉伸: 'Stretch',
  文本: 'Text',
  线性: 'Linear',
  旋转: 'Rotate',
  图片: 'Image',
  视频: 'Video',
  未选择资源: 'No asset selected',
  '未选择视频资源': 'No video selected',
  外观: 'Look',
  亮度: 'Brightness',
  对比度: 'Contrast',
  饱和度: 'Saturation',
  灰度: 'Grayscale',
  模糊: 'Blur',
  阴影模糊: 'Shadow blur',
  播放速度: 'Playback speed',
  静音: 'Mute',

  // ── 检查器 · 动画 / 表达式 / 时间轴区间 ──────────────────
  动画: 'Animation',
  入场: 'Enter',
  退场: 'Exit',
  强调: 'Emphasis',
  延迟: 'Delay',
  曲线: 'Curve',
  强度: 'Intensity',
  '属性绑定（表达式）': 'Property binding (expression)',
  '留空表示不绑定': 'Leave empty to unbind',
  '每帧求值，可用 time(ms)、w、h、i 与 Math 函数。例如 rotation = sin(time*0.001)*6。':
    'Evaluated every frame; time (ms), w, h, i and the Math functions are in scope — e.g. rotation = sin(time*0.001)*6.',
  时间轴区间: 'Timeline range',
  出现: 'In',
  消失: 'Out',
  '消失填 0 表示持续到结尾。': 'Leave Out at 0 to run through to the end.',
  '由主时钟 seek 驱动，预览与导出取同一帧':
    'Driven by the host clock’s seek — preview and export grab the same frame',
  引擎: 'Engine',
  '打开编辑器': 'Open editor',
  代码: 'Code',
  代码驱动: 'Code-driven',
  帧率: 'Frame rate',

  // ── 时间轴 ─────────────────────────────────────────────
  时间轴: 'Timeline',
  收起时间轴: 'Collapse timeline',

  // ── 导出对话框 ─────────────────────────────────────────
  'PNG 静帧': 'PNG still',
  'WebM 视频': 'WebM video',
  输出尺寸: 'Output size',
  倍率: 'Scale',
  '0.5× 预览': '0.5× preview',
  '1× 原始尺寸': '1× native',
  '2× 高清': '2× HD',
  '3× 印刷': '3× print',
  '透明背景（不绘制背景层）': 'Transparent background (skip the background layer)',
  码率档位: 'Bitrate preset',
  小体积: 'Small',
  标准: 'Standard',
  高画质: 'High quality',
  '导出走与预览完全相同的 renderScene()，只是换了一个离屏 Canvas；导出前会 await 所有字体、视频帧与 HTML 栅格化。':
    'Export runs the exact same renderScene() as the preview, just against an offscreen canvas — and it awaits every font, video frame and HTML rasterization first.',
  '逐帧手动推帧（captureStream(0) + requestFrame）。导出耗时约等于视频时长，导出期间命令总线仍会串行等待。':
    'Frames are pushed one at a time (captureStream(0) + requestFrame). Export takes roughly as long as the video itself, and the command bus keeps queueing serially meanwhile.',
  '导出工程包 .kly': 'Export .kly package',
  '导入工程包 .kly': 'Import .kly package',
  未命名织层项目: 'Untitled project',
  已保存: 'Saved',
  '已保存，输入新值可覆盖': 'Saved — type a new value to replace it',
  恢复旧版数据: 'Recover legacy data',
  导出: 'Export',
  '导出 JSON 备份': 'Export JSON backup',
  织层: 'Weave',
  工程库: 'Library',
  '工程库 (Ctrl+O)': 'Library (Ctrl+O)',
  '工程库 · 最近打开的工程都在这里': 'Library · everything you opened recently',
  导入工程包: 'Import package',
  '回到编辑器 (Esc)': 'Back to editor (Esc)',
  新建: 'New',
  竖版: 'Portrait',
  方版: 'Square',
  横版: 'Landscape',
  '工程只存在这台电脑的浏览器里（IndexedDB）。换机器请用「导出工程包」。':
    'Projects live only in this browser (IndexedDB). Use “Export package” to move them.',
  最近工程: 'Recent projects',
  '正在读取…': 'Reading…',
  还没有工程: 'No projects yet',
  '上面选一个尺寸就开始，或者把之前导出的 .kly 拖进来。':
    'Pick a size above to start, or drag in a .kly you exported earlier.',
  当前: 'Current',
  '{n} 图层 · {time}': '{n} layers · {time}',
  重命名: 'Rename',
  复制一份: 'Duplicate',
  '导出 .kly': 'Export .kly',
  '当前：{name}': 'Current: {name}',
  'Esc 回到编辑器': 'Esc to go back',
  '删除「{name}」？它是当前打开的工程：删除后编辑器里还开着，但不再保存。':
    'Delete “{name}”? It is the project you have open — the editor keeps it in memory but stops saving it.',
  '删除「{name}」？本机记录与它独占的图片/视频会一起清掉。':
    'Delete “{name}”? Its local record and any images/videos only it used will be removed.',
  '已删除「{name}」· 清理 {n} 个资源': 'Deleted “{name}” · {n} asset(s) cleaned up',
  导出失败: 'Export failed',
  图层时间轴: 'Layer timeline',
  '入 {a} · 出 {b}': 'in {a} · out {b}',
  上一个关键帧: 'Previous keyframe',
  下一个关键帧: 'Next keyframe',
  这个图层还没有关键帧: 'No keyframes on this layer yet',
  面板: 'Panels',
  检查器: 'Inspector',
  '已导入「{name}」· {n} 个资源': 'Imported “{name}” · {n} asset(s)',
  '导入文件已过期，请重新选择': 'That import expired — please pick the file again',
  '已载入旧版 JSON 备份（资源需另行导入）': 'Legacy JSON backup loaded (assets are not included)',
  '每个工程单独存一条本地记录（工程本体在 projects，列表信息在 meta 索引里），自动保存每 1.6 秒写一次。工程包 .kly 是 ZIP：project.json + manifest.json + assets/ + fonts/，二进制原样打包、逐文件带 sha256；旧的 .json 备份仍可导入。':
    'Each project is its own local record (body in `projects`, list metadata in the `meta` index) and autosave writes every 1.6s. A .kly package is a ZIP holding project.json + manifest.json + assets/ + fonts/, with the binaries stored as-is and a sha256 per file; older .json backups still import.',
  没有找到旧版本数据: 'No legacy data found',
  '已恢复旧版工程：{name}': 'Recovered legacy project: {name}',
  '本机工程 {n} 个 · 当前：{name}': '{n} project(s) on this device · current: {name}',
  '正在读取本机工程…': 'Reading local projects…',
  '每个工程单独存一条本地记录（工程本体在 projects，列表信息在 meta 索引里），自动保存每 1.6 秒写一次。工程包里不含任何 base64：图片/视频/字体二进制只存在本机库里。':
    'Each project is its own local record (the project itself in `projects`, list metadata in the `meta` index), and autosave writes every 1.6s. The package holds no base64 — image, video and font binaries stay in the local database.',
  '应用（一条命令）': 'Apply (one command)',

  // ── 设置 · AI ──────────────────────────────────────────
  '通道 A：浏览器内直连任意 OpenAI 兼容接口（OpenAI / DeepSeek / Moonshot / 本地 vLLM 均可）。 工具定义由命令注册表自动生成，上下文只传项目摘要，不传任何 base64。':
    'Channel A: hit any OpenAI-compatible endpoint straight from the browser (OpenAI, DeepSeek, Moonshot, a local vLLM — all fine). Tool definitions are generated from the command registry, and only a project summary goes into the context — never any base64.',
  '通道 B：先在本机运行': 'Channel B: run ',
  '（WS 127.0.0.1:2718）， 再把终端打印的 token 粘到这里。MCP Server 由':
    ' (WS 127.0.0.1:2718) on your machine, then paste the token it prints into the field below. The MCP server is started by ',
  '启动， 工具清单从当前页面的命令注册表实时同步。':
    ' — its tool list syncs live from the command registry of this page.',
  模型: 'Model',
  测试连接: 'Test connection',
  连接桥接: 'Connect bridge',
  断开: 'Disconnect',
  可用: 'Available',
  未连接: 'Not connected',
  '离线演示模式（无需 Key）': 'Offline demo mode (no key needed)',
  '只影响界面文案与导出文件名；项目数据不受影响。':
    'Affects interface copy and exported filenames only — project data is untouched.',
  安全提示: 'Safety',
  'API Key 的加密只能防止「明文落在磁盘上」，不能防御同源 XSS。代码层是同源 JS 沙箱（防误用，不防恶意）， 不要运行来路不明的代码。AI 的修改默认需要确认，危险命令需要二次确认。':
    'Encrypting the API key only keeps it from sitting in plaintext on disk — it does nothing against same-origin XSS. The code layer is a same-origin JS sandbox: it guards against accidents, not against malice, so never run code from an untrusted source. AI edits need confirmation by default, and dangerous commands need a second one.',
  '可编程 HTML 层': 'Programmable HTML layer',
  '语法错误会在关闭编辑器后逐帧捕获': 'Syntax errors surface per frame once you close the editor',
  'HTML 模板': 'HTML template',
  'GLSL 模板': 'GLSL template',
  'canvas2d 模板': 'canvas2d template',
  'WebSocket 地址': 'WebSocket URL',
  'bridge 启动时打印的 token': 'the token printed when the bridge starts',

  // ── AI 面板 ────────────────────────────────────────────
  '待确认的命令': 'Commands awaiting confirmation',
  '危险操作，需要二次确认': 'Dangerous — needs a second confirmation',
  修改需确认: 'Confirm edits',
  '修改类命令需确认后执行': 'Commands that change the project run only after you approve them',
  自动执行: 'Run automatically',
  批准执行: 'Approve',
  拒绝: 'Reject',
  '确认执行（不可逆）': 'Confirm (irreversible)',
  '用户拒绝执行': 'Rejected by the user',
  '已取消，未执行任何命令。': 'Cancelled — no commands ran.',
  已应用: 'Applied',
  '正在处理…': 'Working…',
  '已达到单轮 6 次工具调用上限，先停在这里。可以继续追问。':
    'Hit the 6-tool-call limit for one turn, stopping here. Ask again to keep going.',
  '截图已返回并在界面展示，避免把 base64 塞回上下文。':
    'The screenshot came back and is shown inline, keeping base64 out of the context.',
  清空对话: 'Clear chat',
  '对话已清空。项目状态不受影响。': 'Chat cleared — project state is untouched.',
  '发送 (Enter)': 'Send (Enter)',
  演示模式: 'Demo mode',
  'AI 操作': 'AI actions',
  '参数 JSON 解析失败': 'Could not parse the JSON arguments',
  '我是命令总线上的一个客户端。所有修改都会变成结构化命令，可以单条撤销。当前是离线演示模式，可在设置里接入真实模型。':
    'I am a client on the command bus. Every change becomes a structured command you can undo one by one. Right now I am in offline demo mode — connect a real model in Settings.',
  '描述你想做的修改，例如：把标题改成两行，字号 96':
    'Describe the change — e.g. “split the title into two lines, 96px”',

  // ── 提示词面板 ──────────────────────────────────────────
  把模型回复粘回这里: 'Paste the model’s reply back here',
  附带当前项目上下文: 'Include the current project context',
  复制提示词: 'Copy prompt',
  '复制提示词 → 粘到任意对话框 → 把回复粘回下面的执行区':
    'Copy the prompt → paste it into any chat → paste the reply into the box below',
  通用大模型: 'Any LLM',
  'MCP 客户端': 'MCP client',
  示例: 'Example',
  解析: 'Parse',
  重新生成: 'Regenerate',
  用法: 'How to use',
  '下载 .md': 'Download .md',
  '已下载 kinelayer-ai-prompt.md': 'Downloaded kinelayer-ai-prompt.md',
  '支持代码围栏 / 裸 JSON / 单条命令': 'Accepts code fences, bare JSON, or a single command',
  '全部通过校验才会生效；任一条失败会整体回滚':
    'Nothing applies unless every command validates — one failure rolls back the whole batch',
  '执行中…': 'Running…',
  '加了一个标题，并让它 800ms 淡入。': 'Added a title and faded it in over 800ms.',
  '这一行是 AI 加的': 'Added by the AI',
  '这是 OpenAI 兼容接口需要的 tools 数组，直接放进请求体的 tools 字段；模型返回 tool_calls 后，把 name 里的 __ 换回 . 就是命令类型。':
    'This is the tools array an OpenAI-compatible endpoint expects — drop it straight into the request body’s tools field. When the model returns tool_calls, swap the __ in each name back to . to get the command type.',
  '给自建 Agent 用的 tools 数组（与 MCP 同源，来自命令注册表）':
    'The tools array for your own agent — same source as MCP, generated from the command registry',
  '配置片段在仓库 agent-bridge/claude-desktop-config.json，把路径换成你本机的绝对路径。':
    'The config snippet ships at agent-bridge/claude-desktop-config.json — swap in the absolute path on your machine.',
  '桥接只监听 127.0.0.1，令牌在 agent-bridge/.token；MCP 侧工具清单与上面的提示词同源，在编辑器里新增命令后客户端重新拉一次 tools/list 即可。':
    'The bridge binds to 127.0.0.1 only, and the token lives in agent-bridge/.token. The MCP tool list comes from the same place as the prompt above, so after adding commands in the editor just have the client re-fetch tools/list.',
  'Claude Desktop / Cursor 直连本机 bridge，模型可自己调工具':
    'Claude Desktop / Cursor talk to the local bridge and call the tools themselves',
  '参数 params（JSON）': 'Arguments (JSON)',

  // ── 审计 / Chrome ──────────────────────────────────────
  审计: 'Audit',
  审计日志: 'Audit log',
  'Command Bus · Host 权威': 'Command Bus · Host authoritative',
  '还没有命令被执行。': 'No commands have run yet.',
  '最近 200 条': 'Latest 200',
  系统弹窗: 'System popup',
  画中画: 'Picture-in-picture',
  应用内浮动: 'In-app floating',
  应用内浮动窗口: 'Floating layer window',

  // ── 图层独立窗口 ────────────────────────────────────────
  属性: 'Properties',
  文本内容: 'Text content',
  '只读镜像 · 主窗口渲染': 'Read-only mirror · rendered by the host',
  '图层已被删除，或该项目已关闭。': 'This layer was deleted, or the project has been closed.',
  缺少图层参数: 'Missing layer parameter',
  '正在连接主窗口…': 'Connecting to the host…',
  '主窗口无响应': 'The host is not responding',
  '这个页面只能由主窗口的「独立窗口」按钮打开：它会带上 layer 与 host 参数。':
    'This page can only be opened from the host window’s “In own window” button — it carries the layer and host parameters.',
  'Client 只发命令请求、不持有状态。若主窗口已关闭，请回到主窗口重新打开图层窗口。':
    'The client only sends command requests and holds no state. If the host window has closed, reopen the layer window from it.',

  // ── 动态拼接（含 {占位符}） ─────────────────────────────
  '工具 {n}+ 由注册表生成': '{n}+ tools generated from the registry',
  '未知命令：{type}': 'Unknown command: {type}',
  '工具参数不是合法 JSON：{snippet}': 'Tool arguments are not valid JSON: {snippet}',
  '截图 {w}×{h}': 'Screenshot {w}×{h}',
  'command.batch（{n} 条）': 'command.batch ({n} commands)',
  'Agent 已连接 · {n} 个客户端': 'Agent connected · {n} client(s)',
  '{n} 图层': '{n} layers',
  '选中 {n}': 'Selected {n}',
  '撤销栈 {n}': 'Undo stack {n}',
  '{n} 个失败命令': '{n} failed commands',
  '窗口：{mode}': 'Window: {mode}',
  '状态：{state} · {message}': 'Status: {state} · {message}',
  '代码编辑器 · {name}': 'Code editor · {name}',
  '删除「{name}」？': 'Delete “{name}”?',
  '对齐 {mode}': 'Align {mode}',
  '{n} 行': '{n} lines',
  '图层 {n}': 'Layers {n}',
  '资源 {n}': 'Assets {n}',
  '删除 {n} 个图层？': 'Delete {n} layers?',
  '删除资源「{name}」？引用它的图层会清空资源。':
    'Delete the asset “{name}”? Layers using it will lose their source.',
  '跳过不支持的文件：{name}': 'Skipped an unsupported file: {name}',
  '{name} 超过 48MB，已跳过': '{name} is over 48MB — skipped',
  '已导入 {name}': 'Imported {name}',
  '字体「{family}」已注册并持久化': 'Font “{family}” registered and persisted',
  '读取到 {n} 个本地字体族': 'Found {n} local font families',
  '提示词已复制（{n} 字符）': 'Prompt copied ({n} characters)',
  '这些命令不在注册表里，执行会失败：{list}':
    'These commands are not in the registry and would fail: {list}',
  '含未知命令：{list}': 'Contains unknown commands: {list}',
  '其中 {n} 条是危险命令（{list}），确认执行？':
    '{n} of these are dangerous ({list}) — run them anyway?',
  '已执行 {n} 条命令（{m} 条修改），可一次撤销':
    'Ran {n} commands ({m} mutations) — undoable as a single step',
  '{n} 条命令由注册表自动导出 · 改代码即改提示词':
    '{n} commands exported from the registry · change the code, change the prompt',
  '模型说明：{reply}': 'Model note: {reply}',
  '执行 {n} 条（一个撤销点）': 'Run {n} (one undo step)',
  '代码层请在主窗口的代码编辑器中修改 · {engine}':
    'Edit code layers in the host window’s code editor · {engine}',
  '{ms}ms · 命令由主窗口执行': '{ms}ms · commands run in the host',
  '已导出 {name}': 'Exported {name}',
  '已导出 {name}（{n} 帧）': 'Exported {name} ({n} frames)',
  '{reason}，已降级为应用内浮动窗口': '{reason} — fell back to the in-app floating window',

  // ── 状态与错误 ─────────────────────────────────────────
  '连接中…': 'Connecting…',
  '已连接本地桥接': 'Connected to the local bridge',
  '连接失败：检查 bridge 是否启动、token 是否一致':
    'Connection failed — check that the bridge is running and the token matches',
  '弹窗被浏览器拦截': 'The browser blocked the popup',
  '当前浏览器不支持 Document Picture-in-Picture': 'This browser has no Document Picture-in-Picture support',
  '与主窗口的连接已断开': 'Lost the connection to the host window',
  '主窗口 10s 未响应（可能正在导出）': 'The host window did not answer within 10s (it may be exporting)',
  '当前浏览器不支持 Local Font Access（需 Chrome/Edge 103+，且页面处于安全上下文）':
    'This browser has no Local Font Access (needs Chrome/Edge 103+ on a secure context)',
  'IndexedDB 打开失败': 'Could not open IndexedDB',
  'IndexedDB 操作失败': 'IndexedDB operation failed',
  'JSON 解析失败': 'Failed to parse the JSON',

  // ── 设置 · 通道说明 ────────────────────────────────────
  'AI 通道': 'AI channel',
  'Agent 桥接': 'Agent bridge',
  '数据与安全': 'Data & safety',
  '需以 /v1 结尾（例如 https://api.deepseek.com/v1）':
    'Must end with /v1 (e.g. https://api.deepseek.com/v1)',
  '使用 WebCrypto AES-GCM 加密后存 localStorage，密钥存在 IndexedDB':
    'Encrypted with WebCrypto AES-GCM before it reaches localStorage; the key itself lives in IndexedDB',
  '二进制存 IndexedDB，项目 JSON 里只有元数据，导出时不带 base64。':
    'Binaries live in IndexedDB; the project JSON holds metadata only, so exports carry no base64.',

  // ── 混合模式 / 动画预设 ─────────────────────────────────
  '导出 PNG': 'Export PNG',
  '导出 WebM': 'Export WebM',
  正常: 'Normal',
  正片叠底: 'Multiply',
  滤色: 'Screen',
  叠加: 'Overlay',
  变亮: 'Lighten',
  变暗: 'Darken',
  差值: 'Difference',
  强光: 'Hard light',
  柔光: 'Soft light',
  无: 'None',
  淡入: 'Fade in',
  上滑: 'Slide up',
  下滑: 'Slide down',
  左滑: 'Slide left',
  右滑: 'Slide right',
  放大进入: 'Zoom in',
  缩小进入: 'Zoom out',
  脉冲: 'Pulse',
  漂浮: 'Float',

  // ── 演示代理的回复 ─────────────────────────────────────
  '好的，导出当前帧为 PNG（2 倍图）。': 'Sure — exporting the current frame as a 2× PNG.',
  '开始逐帧导出 WebM，请保持页面在前台。':
    'Exporting WebM frame by frame — keep this tab in the foreground.',
  '开始播放时间轴。': 'Playing the timeline.',
  播放: 'Play',
  '已暂停。': 'Paused.',
  暂停: 'Pause',
  '把背景换成深紫渐变。': 'Switching the background to a deep purple gradient.',
  背景改为深紫渐变: 'Background → deep purple gradient',
  '删除当前选中的图层。': 'Deleting the selected layer.',
  '复制当前图层并向右下偏移。': 'Duplicating the layer, offset down and to the right.',
  '新建一个居中标题「{text}」，64px 粗体，并带淡入。':
    'Added a centered title “{text}”, 64px bold, fading in.',
  在这里输入标题: 'Type your title here',
  新建标题: 'New title',
  '把「{name}」字号调整为 {size}px。': 'Set “{name}” to {size}px.',
  调整字号: 'Adjust font size',
  '把「{name}」的文字颜色改成 #{color}。': 'Changed the text color of “{name}” to #{color}.',
  改文字颜色: 'Change text color',
  '新建一个全画布代码层，用流线做背景纹理（screen 混合）。':
    'Added a full-canvas code layer using flowing lines as a background texture (screen blend).',
  新建代码层: 'New code layer',
  流线: 'Flow lines',
  '把选中图层水平居中。': 'Centering the selected layer horizontally.',
  水平居中: 'Center horizontally',
  '演示模式能识别这些指令：': 'Demo mode understands these:',
  '· 加一个标题「…」 · 字号大一点 · 把颜色改成 #7c5cff':
    '· add a title “…” · bigger font · change the color to #7c5cff',
  '· 背景改成渐变 · 加个代码层 · 居中 · 复制 · 删除':
    '· gradient background · add a code layer · center · duplicate · delete',
  '· 播放 / 暂停 · 导出 PNG / 导出 WebM': '· play / pause · export PNG / export WebM',
  '当前画布 {w}×{h}，共 {n} 个图层（含背景 {kind}）。':
    'Canvas is {w}×{h} with {n} layers (background: {kind}).',
  '接入真实模型后可以用任意自然语言描述排版；在设置里填 Base URL / Key 并关闭演示模式即可。':
    'Connect a real model to describe layouts in plain language — set the Base URL and key in Settings and switch demo mode off.',

  // ── v2 时间轴 / 关键帧 ──────────────────────────────────
  缩放: 'Zoom',
  时间轴缩放: 'Timeline zoom',
  把越界的图层收回时长内: 'Pull out-of-range layers back inside the duration',
  '{n} 个图层越界 · 修复': '{n} layers out of range · fix',
  '{property} @ {time}ms': '{property} @ {time}ms',
  缓动: 'Easing',
  删除关键帧: 'Delete keyframe',
  '已选 {n} 个关键帧': '{n} keyframes selected',
  展开轨道: 'Expand tracks',
  自动关键帧: 'Auto-keyframe',
  用预设生成关键帧: 'Generate keyframes from a preset',
  在播放头打一个关键帧: 'Add a keyframe at the playhead',
  清空该轨道: 'Clear this track',
  没有可显示的图层: 'No layers to show',
  预设: 'Presets',
  上浮: 'Rise',
  弹入: 'Pop',
  旋转进入: 'Spin in',

  // ── 设置 · 桌面 Agent 接入 ──────────────────────────────
  '桌面 Agent': 'Desktop agent',
  桥接已连接: 'Bridge connected',
  桥接未连接: 'Bridge not connected',
  桥接出错: 'Bridge error',
  '{n} 个 Agent 在线': '{n} agent(s) online',
  '{n} 条命令': '{n} commands',
  '{n} 字符': '{n} characters',
  怎么接进来: 'How to connect',
  'MCP：npm run bridge + npm run mcp，客户端读 Claude Desktop 配置':
    'MCP: run npm run bridge + npm run mcp, then point the client at the Claude Desktop config',
  '直连：HTTP / WebSocket，令牌放 {header} 头':
    'Direct: HTTP / WebSocket, token in the {header} header',
  '工具名 = 命令类型把 . 换成 __（layer.create → layer__create）':
    'Tool name = command type with . replaced by __ (layer.create → layer__create)',
  能操作什么: 'What it can touch',
  '共 {n} 条，含 {d} 条危险命令': '{n} total, {d} of them dangerous',
  不能做什么: 'What it cannot touch',
  '读不到 API Key 与素材二进制，也碰不到本地文件系统':
    'Cannot read the API key or raw assets, and has no filesystem access',
  '桥接只监听 127.0.0.1，不对外网开放': 'The bridge binds to 127.0.0.1 only — nothing faces the internet',
  '危险命令必须由你在界面上确认，Agent 不能代点':
    'Dangerous commands must be approved by you in the UI — the agent cannot click for you',
  推荐调用顺序: 'Recommended call order',
  接入前自检: 'Pre-flight check',
  '三条命令按顺序打，先分清是桥接没跑、令牌不对，还是页面没连':
    'Run these three in order — they tell you whether the bridge is down, the token is wrong, or the page is not connected',
  '桥接活着？': 'Bridge alive?',
  '令牌对？': 'Token right?',
  '页面连上了？': 'Page connected?',
  '已复制自检命令': 'Pre-flight commands copied',
  站点: 'Site',
  完整接入文档: 'Full integration guide',
  中文: '中文',
  已知限制: 'Known limitations',
  '复制 MCP 配置': 'Copy MCP config',
  '已复制 MCP 配置': 'MCP config copied',
  结构: 'Structure',
  '第 {i} 节': 'section {i}',
  '0 定位': '0 Role',
  '1 接入': '1 Connect',
  '1.1 自检': '1.1 Pre-flight',
  '2 能力': '2 Capabilities',
  '3 契约': '3 Contract',
  '4 边界': '4 Boundaries',
  '5 危险': '5 Dangerous',
  '6 错误': '6 Errors',
  '7 话术': '7 Reporting',
  读清单: 'Manifest',
  试算: 'Dry-run',
  提交: 'Commit',
  读回: 'Read back',
  '桌面 Agent 接入提示词': 'Desktop agent integration prompt',
  '由命令注册表生成，随代码自动更新':
    'Generated from the command registry, so it tracks the code',
  带上当前项目: 'Include project',
  复制全部: 'Copy all',
  已复制: 'Copied',
  '已下载 kinelayer-desktop-agent.md': 'Downloaded kinelayer-desktop-agent.md',
  '把这段提示词交给本机 Agent 工具时，先确认它只连 127.0.0.1、只走命令总线。提示词里已写明：不能读密钥、不能碰文件系统、危险操作必须由你确认。':
    'Before handing this prompt to a desktop agent, make sure it only connects to 127.0.0.1 and only goes through the command bus. The prompt already spells out the boundaries: no key access, no filesystem, and dangerous actions need your approval.',

  // ── 命令分类（设置面板统计用） ───────────────────────────
  项目: 'Project',
  选择: 'Selection',
  历史: 'History',
  窗口: 'Window',
  查询: 'Query',
  系统: 'System',

  // ── 兜底 ───────────────────────────────────────────────
  打开失败: 'Failed to open',

  // ── 启动页 / 新建项目对话框 ──────────────────────────────
  创建失败: 'Could not create',
  切换语言: 'Switch language',
  空白项目: 'Blank project',
  '默认 1080 × 1440 · 5s · 30fps': 'Default 1080 × 1440 · 5s · 30fps',
  自定义尺寸: 'Custom size',
  '宽高 / 单位 / 时长 / 帧率 / 背景': 'Size / units / duration / fps / background',
  海报: 'Poster',
  横幅: 'Banner',
  方形: 'Square',
  竖屏: 'Portrait',
  '自定义…': 'Custom…',
  '最近项目（最多 {n}）': 'Recent projects (max {n})',
  '打开本地文件': 'Open local file',
  '还没有项目，从左侧新建一个': 'No projects yet — create one on the left',
  '左边选一个预设，或者用「自定义尺寸」自己定；也可以直接打开之前导出的 .kly。':
    'Pick a preset on the left, or use "Custom size"; you can also open a .kly you exported earlier.',
  打开: 'Open',
  导出工程包: 'Export package',
  'Kinelayer 织层 · 本机工程库': 'Kinelayer · Local project library',
  选中一个工程进入编辑器: 'Pick a project to enter the editor',
  新建项目: 'New project',
  项目名称: 'Project name',
  项目名称不能为空: 'Project name cannot be empty',
  '项目名称不能超过 60 个字符': 'Project name cannot exceed 60 characters',
  '宽度需要在 {min}–{max}px 之间': 'Width must be between {min}–{max}px',
  '高度需要在 {min}–{max}px 之间': 'Height must be between {min}–{max}px',
  '时长需要在 {min}–{max} 秒之间': 'Duration must be between {min}–{max} seconds',
  '背景色需要是 #rgb 或 #rrggbb': 'Background must be #rgb or #rrggbb',
  '内部统一按 px 存储 · 当前 {w} × {h}px': 'Stored in px internally · currently {w} × {h}px',
  创建并打开: 'Create & open',
  '宽度 / 高度': 'Width / height',
  '范围 {min}–{max}px（约 {mm}）@ 96dpi': 'Range {min}–{max}px (≈ {mm}) at 96dpi',
  '时长（秒）': 'Duration (s)',
  '画布默认底色，之后还能改': 'Default canvas colour, changeable later',
  '加载图层窗口…': 'Loading layer window…',
  '加载工程库…': 'Loading project library…',
  '加载编辑器…': 'Loading editor…',

  /* v2.5 导入预检 */
  导入预检: 'Import preview',
  '可编辑程度 {n}%': '{n}% editable',
  这份文件读不出来: 'This file cannot be read',
  可编辑图层: 'Editable layers',
  轨道: 'Tracks',
  关键帧: 'Keyframes',
  导入方式: 'Import mode',
  优先可编辑: 'Prefer editable',
  优先保代码: 'Prefer code',
  '尽量拆成文本/图片层，能打关键帧': 'Split into text/image layers you can keyframe',
  '少拆几层，形状等交给代码层': 'Keep more as code layers, shapes included',
  不能导入: 'Cannot import',
  这次导入会发生什么: 'What this import will do',
  '{n} 个资源找不到（图层会先建成空占位）': '{n} assets not found (layers start as empty placeholders)',
  导入这份工程: 'Import this project',
  '导入中…': 'Importing…',
  '导入文件…': 'Import file…',
  '导出 scene.ai.json': 'Export scene.ai.json',
  '已导入「{name}」· {layers} 个可编辑图层 / {code} 个代码层':
    'Imported "{name}" · {layers} editable layers / {code} code layers',
  导入: 'Import',
  'AI 生成': 'AI generated',
  外部导入: 'Imported',

  /* 导入预检：格式名与降级说明（报告由 importPipeline 以 key + 参数产出，这里必须一条不落） */
  '场景 JSON（Rendervid / cadence 风格）': 'Scene JSON (Rendervid / cadence style)',
  'Kinelayer 场景语义层（scene.ai.json）': 'Kinelayer scene semantics (scene.ai.json)',
  'Kinelayer 工程包（.kly / ZIP）': 'Kinelayer package (.kly / ZIP)',
  'Kinelayer 原生 JSON': 'Kinelayer native JSON',
  'HTML / GSAP 片段': 'HTML / GSAP snippet',
  视频文件: 'Video file',
  图片文件: 'Image file',
  'Remotion 工程': 'Remotion project',
  认不出这个文件: 'Unrecognised file',
  '场景 JSON': 'Scene JSON',
  '场景里没有图层数组，只建了一个空画布': 'No layer array in the scene — imported as an empty canvas',
  '文本层「{name}」没有文字内容，已跳过': 'Text layer "{name}" has no content — skipped',
  '媒体「{name}」以 data URL 内嵌，导入时会写进资源库': 'Media "{name}" is embedded as a data URL and will be added to the asset library',
  '媒体「{name}」引用外部路径 {src}，包里没带文件，图层先建但资源缺失':
    'Media "{name}" points at {src}; the file is not included, so the layer is created without its asset',
  '媒体层「{name}」没有 src，建成空占位': 'Media layer "{name}" has no src — created as an empty placeholder',
  '代码层「{name}」：{summary}': 'Code layer "{name}": {summary}',
  '形状「{name}」在 preserve-code 模式下被跳过': 'Shape "{name}" was skipped in preserve-code mode',
  '形状「{name}」没有对应的原生图层类型，已生成 canvas2d 代码层（可改代码，但内部不可打点）':
    'Shape "{name}" has no native layer type — generated a canvas2d code layer (editable code, no per-element keyframes)',
  '分组「{name}」没有展平：Kinelayer 没有图层组，子元素逐个导入':
    'Group "{name}" was flattened: Kinelayer has no layer groups, so children import one by one',
  '图层「{name}」类型无法识别，已跳过': 'Layer "{name}" has an unknown type — skipped',
  '「{name}」里 {props} 的动画无法映射为轨道，已跳过': 'Animation on {props} in "{name}" cannot map to a track — skipped',
  '{n} 个媒体层只剩资源名（scene.ai.json 不带二进制），导入后需要重新指定图片/视频':
    '{n} media layers only kept their asset names (scene.ai.json carries no binary); reassign the image/video after import',
  '原生格式：图层、轨道、资源引用都按原样恢复': 'Native format: layers, tracks and asset references come back exactly as they were',
  '媒体层没有图层语义：只有整体位置/尺寸/透明度，内部内容不可拆':
    'A media layer has no structure: only position/size/opacity, its contents cannot be split',
  '整段 HTML 作为 html 代码层导入（静态提取图片/文本是 v2.5c）':
    'The whole HTML snippet imports as an html code layer (static extraction of images/text lands in v2.5c)',
  '导出时这一层会被栅格化，精度可能下降': 'This layer is rasterised on export, so precision may drop',
  /* Remotion 工程导入（v2.5b 静态 AST 解析）：报告说明 */
  'Remotion 工程（静态解析）': 'Remotion project (static parse)',
  '包里认出 {n} 个条目': 'Found {n} entries in the archive',
  '支持 .kly / 场景 JSON / HTML / 图片视频 / Remotion 工程 ZIP':
    'Supports .kly / scene JSON / HTML / images and video / Remotion project ZIP',
  'Remotion 工程要传 ZIP：源码在压缩包里，纯文本给不出组件结构':
    'A Remotion project must be a ZIP — the component structure lives in the source files',
  '这个 Composition 里没有可识别的元素，也没有可保留的组件':
    'This composition has no recognisable element and no component worth keeping',
  '（Remotion）Composition「{id}」：{w}×{h} · {fps}fps · {n} 帧':
    '(Remotion) Composition "{id}": {w}×{h} · {fps}fps · {n} frames',
  '（Remotion）源码来自「{name}」，浏览器内不执行，只做结构解析':
    '(Remotion) Source from "{name}" is never executed in the browser — structure only',
  '（Remotion）没解析出任何结构化元素，整个 Composition 作为代码层导入':
    '(Remotion) Nothing structured could be parsed — the whole composition imports as a code layer',
  '（Remotion）<{name}> 是带背景的容器，已生成 canvas2d 代码层':
    '(Remotion) <{name}> is a container with a background — generated as a canvas2d code layer',
  '（Remotion）图片元素没有静态 src，建成空占位':
    '(Remotion) Image element has no static src — created as an empty placeholder',
  '（Remotion）容器「{name}」上的动画无法归到具体元素，已跳过':
    '(Remotion) Animation on container "{name}" cannot be attached to an element — skipped',
  '（Remotion）scale 插值没有对应轨道，已跳过':
    '(Remotion) scale interpolation has no matching track — skipped',
  '（Remotion）scale 动画没有对应轨道，已跳过（缩放请手动改 width/height）':
    '(Remotion) scale animation has no matching track — skipped (animate width/height instead)',
  '（Remotion）spring 按 eased 0→1 近似（真曲线要跑物理积分，这里不猜）':
    '(Remotion) spring is approximated as eased 0→1 (the real curve needs physics integration — not guessed here)',
  'Remotion 里的 <{tag}> 没有对应图层，已跳过（Kinelayer 没有这个原生图层类型）':
    '(Remotion) <{tag}> has no matching layer and was skipped (Kinelayer has no such native layer type)',
  'preserve-code 模式：整个 Composition 保留为一个 Remotion 代码层，没有拆成原生图层':
    'preserve-code mode: the whole composition stays one Remotion code layer, nothing is split into native layers',
  '找到代理视频「{name}」，remotion 层按它预览（不再是静态首帧）':
    'Found proxy video "{name}" — Remotion layers preview it instead of a static first frame',
  'remotion 层没有代理视频：时间轴上显示静态首帧卡片，要看到动画得在外部 `npx remotion render`':
    'No proxy video for the Remotion layers: the timeline shows a static first-frame card — run `npx remotion render` outside to see the motion',
  '{n} 个组件整块保留为 Remotion 代码层（内部关键帧不展示，双击看源码）':
    '{n} components kept whole as Remotion code layers (their internal keyframes are not shown — double-click to read the source)',
  '原工程源码共 {n} 个文件，超过 600KB 上限没有随工程保存：remotion-kit 只能导出解析出来的组件':
    'The original project has {n} source files and exceeded the 600KB cap, so it was not stored — remotion-kit will only export the parsed components',
  'Remotion 组件层：源码原样保存，内部不可编辑，成片需在外部渲染':
    'Remotion component layer: source kept verbatim, internals not editable, render outside Kinelayer',
  'Remotion 组件层': 'Remotion component layer',
  '只读：Remotion 组件在外部渲染，Kinelayer 不执行这段源码':
    'Read-only: Remotion components render outside Kinelayer, which never executes this source',
  '这段源码原样保存，Kinelayer 不执行、不渲染它 —— 时间轴上只显示静态首帧卡片。要看到动画，请用「导出 remotion-kit」拿到可 render 的工程，在外部跑 npx remotion render。':
    'This source is stored verbatim; Kinelayer neither executes nor renders it — the timeline only shows a static first-frame card. To see the motion, export the remotion-kit and run npx remotion render outside.',
  '内部不可编辑，时间轴只有静态首帧；成片请导出 remotion-kit 在外部渲染。':
    'Internals are not editable and the timeline only shows a static first frame; export the remotion-kit to render outside.',
  '查看源码': 'View source',
  'Remotion 组件层：内部关键帧不在时间轴上展示':
    'Remotion component layer: its internal keyframes are not shown on the timeline',
  '场景解析失败': 'Failed to parse the scene',
  'scene.ai.json 解析失败': 'Failed to parse scene.ai.json',

  /* ---- v2.5c：HTML / GSAP 静态解析 ---- */
  'HTML / GSAP 片段（静态解析）': 'HTML / GSAP snippet (static parse)',
  'HTML 片段（静态解析）': 'HTML snippet (static parse)',
  'preserve-code 模式：整份 HTML 保留为一个代码层，没有拆成原生图层':
    'preserve-code mode: the whole HTML stays one code layer and was not split into native layers',
  '剩下的 {n} 个元素不是绝对定位，整块保留为 html 代码层（编辑态用 sandbox iframe 渲染）':
    'The remaining {n} elements are not absolutely positioned, so they stay together as an html code layer (rendered in a sandboxed iframe while editing)',
  '这个 HTML 里没有可识别的元素': 'No recognizable elements in this HTML',
  '文件 {n} 个字符': 'The file is {n} characters',
  '{n} 个图片地址没能落地成资源（远程/相对路径），导入后需要重新指定':
    '{n} image URLs could not be materialized as assets (remote or relative paths) — reassign them after import',
  '（HTML）{n} 个动画选择器没对上任何图层，轨道没有建：{list}':
    '(HTML) {n} animation selectors matched no layer, so no tracks were built: {list}',
  '（HTML）跳过了 {n} 条 @ 规则（@media / @keyframes 不参与静态提取）':
    '(HTML) Skipped {n} @-rules (@media / @keyframes are not part of static extraction)',
  '（HTML）JS 解析器加载失败，这段脚本里的动画没有提取':
    '(HTML) The JS parser failed to load, so animations in this script were not extracted',
  '（HTML）有一段 <script> 解析不了（可能是 minified 或语法较新），里面的动画跳过':
    '(HTML) One <script> could not be parsed (minified or newer syntax) — its animations were skipped',
  '（HTML）认出 GSAP 调用，但目标都不是字符串选择器，动画没有提取':
    '(HTML) GSAP calls were found, but none targeted a string selector, so no animation was extracted',
  '（HTML）scale / 颜色 / 滤镜动画没有对应轨道，已跳过 {n} 项':
    '(HTML) Scale / color / filter animations have no matching track, skipped {n} of them',
  '（HTML）GSAP timeline 里的相对位置（如 "-=0.5"）读不出绝对时间，已按顺序累加 {n} 处':
    '(HTML) Relative positions in the GSAP timeline (such as "-=0.5") do not resolve to absolute time; {n} of them were accumulated in order',
  '（HTML）有 {n} 个动画用变量或相对值（"+=" / 函数），终点读不出来，已跳过':
    '(HTML) {n} animations use variables or relative values ("+=" / functions), so their end values cannot be read statically and were skipped',
  '（HTML）有 {n} 个 GSAP 调用的目标是变量而非选择器，已跳过':
    '(HTML) {n} GSAP calls target a variable instead of a selector and were skipped',
  '（HTML）引用了 {n} 个远程资源（GSAP CDN、字体、图片等）：编辑态能加载，导出与离线打开会缺':
    '(HTML) References {n} remote resources (GSAP CDN, fonts, images): they load while editing but will be missing on export and offline',
  '（HTML）有 <img> 没有 src，已跳过': '(HTML) An <img> has no src and was skipped',
  '（HTML）图片「{name}」不是绝对定位，位置按画布左上角估的，需要手动摆':
    '(HTML) Image 「{name}」 is not absolutely positioned; its position was guessed as the top-left corner and needs manual placement',
  '（HTML）文本「{name}」没写宽高，按字号与字数估了 {w}×{h}':
    '(HTML) Text 「{name}」 has no width/height; estimated {w}×{h} from font size and character count',
  '（HTML）可提取的元素超过 {n} 个上限，后面的没有再拆（避免图层树被撑爆）':
    '(HTML) Extractable elements exceeded the {n} limit; the rest were not split (to keep the layer tree manageable)',
  '（HTML）从 <script> 里提取了 {n} 条 GSAP 动画轨道':
    '(HTML) Extracted {n} GSAP animation tracks from <script>',
  '（HTML）没解析出任何内容（可能是纯 <canvas> 或空文档）':
    '(HTML) Nothing could be parsed (probably a pure <canvas> or an empty document)',
  '（HTML）源码来自「{name}」，只做静态结构解析，不执行脚本':
    '(HTML) Source from 「{name}」; only static structure is parsed, scripts are never executed',
  '（HTML）只认绝对定位元素的位置：流式布局的 {n} 个元素留在代码层':
    '(HTML) Only absolutely positioned elements get a position: {n} elements in normal flow stay in the code layer',
  '（HTML）<{tags}> 没有对应的原生图层，整块留在代码层':
    '(HTML) <{tags}> has no matching native layer and stays whole in the code layer',

  /* ---- v2.6 导入之后：来源区块 + 缺资源修复 ---- */
  '来源': 'Source',
  '格式': 'Format',
  '解析器': 'Parser',
  '来源包': 'Bundle',
  '导入时间': 'Imported',
  '外部依赖': 'External',
  '解析器 {name}': 'parser {name}',
  '{n} 个外部依赖': '{n} external deps',
  '未知': 'Unknown',
  'HTML 片段': 'HTML snippet',
  'Manim 场景': 'Manim scene',
  '单个文件': 'Single file',
  'Kinelayer 语义层': 'Kinelayer semantic layer',
  '还有 {n} 个': '{n} more',
  '这些是远程地址：编辑态能加载，导出和离线打开都拿不到':
    'These are remote URLs: they load while editing, but export and offline opening will not have them',
  '这层的图片没跟着导入': 'The image for this layer was not imported',
  '这层的视频没跟着导入': 'The video for this layer was not imported',
  '另有 {n} 层指向同一个地址，会一起补上': '{n} other layers point at the same URL and will be filled in too',
  '选资源库里的{kind}…': 'Pick a {kind} from the library…',
  '从本地补一个': 'Choose a local file',
  '{name} 不是{kind}，这层用不了': '{name} is not a {kind}, so this layer cannot use it',
  '已补上 {name}': 'Attached {name}',
  '资源没跟着导入，原本指向 {ref}': 'Asset was not imported — it originally pointed at {ref}',
  '引用的资源不在资源库里': 'The referenced asset is not in the library',
  '{n} 层缺资源': '{n} layers are missing assets',
  '定位': 'Find',
  '选中这些图层，在右侧「来源」里补上资源': 'Select these layers, then attach an asset under 「Source」 on the right',
  '（HTML）图片「{name}」在远程 {src}，不会替用户下载，导入后需要自己指定':
    '(HTML) Image 「{name}」 is remote ({src}); it is not downloaded for you, so pick one after import',
  '（HTML）图片「{name}」指向 {src}，单文件里没有这个文件，导入后需要自己指定':
    '(HTML) Image 「{name}」 points at {src}, which is not inside the single file; pick one after import',

  /* ---- v2.7 自定义命令 ---- */
  名称:
    'Name',
  数字:
    'Number',
  开关:
    'Toggle',
  参数名:
    'Param name',
  '默认值（可空）':
    'Default (optional)',
  '显示名（给人和 AI 看）':
    'Label (for humans and AI)',
  说明:
    'Hint',
  删除参数:
    'Remove parameter',
  上移:
    'Move up',
  下移:
    'Move down',
  删除这一步:
    'Remove step',
  '这一步在干什么（可选）':
    'What this step does (optional)',
  'JSON 有问题：{msg}':
    'JSON problem: {msg}',
  '插入参数：':
    'Insert param:',
  点击插入到光标位置:
    'Click to insert at the cursor',
  新建自定义命令:
    'New custom command',
  编辑自定义命令:
    'Edit custom command',
  '{n} 步 · 跑过 {r} 次':
    '{n} steps · run {r} times',
  'AI 创建':
    'By AI',
  我创建:
    'By me',
  '保存中…':
    'Saving…',
  '例如：做一张标题卡':
    'e.g. Build a title card',
  '描述（给人和 AI 看）':
    'Description (for humans and AI)',
  这条命令做什么:
    'What this command does',
  '参数（最多 8 个）':
    'Parameters (max 8)',
  加参数:
    'Add param',
  '没有参数时，运行就是点一下。需要「每次填不同的值」再加参数，步骤里写 {{key}} 引用。':
    'With no parameters, running is one click. Add parameters when values differ each time, then reference them as {{key}} in a step.',
  '步骤（按顺序执行，最多 30 步）':
    'Steps (run in order, max 30)',
  从示例开始:
    'Start from an example',
  加一步:
    'Add step',
  '每一步就是一条已有命令。先挑命令，再改 payload。':
    'Each step is one existing command. Pick the command, then edit its payload.',
  'payload 必须是一个对象':
    'payload must be a JSON object',
  '必须是一个 JSON 对象':
    'must be a JSON object',
  '第 {n} 步':
    'Step {n}',
  'payload 不是合法 JSON：{msg}':
    'payload is not valid JSON: {msg}',
  保存失败:
    'Save failed',
  '已保存「{name}」':
    'Saved 「{name}」',
  '保存成功，但有一处要留意：{msg}':
    'Saved, but one thing to note: {msg}',
  未命名命令:
    'Untitled command',
  '运行「{name}」':
    'Run 「{name}」',
  '{n} 步会作为一次原子操作执行：任何一步失败，前面改的全部回滚。':
    '{n} steps run as one atomic operation: if any step fails, everything before it is rolled back.',
  '选一个图层…':
    'Pick a layer…',
  做一张标题卡:
    'Build a title card',
  '在当前画布上叠标题 + 副标题两层文字':
    'Overlay a title and a subtitle on the current canvas',
  标题:
    'Title',
  副标题:
    'Subtitle',
  建标题层:
    'Create the title layer',
  建副标题层:
    'Create the subtitle layer',
  '「{name}」执行完成':
    '「{name}」 finished',
  自定义:
    'Custom',
  '自定义命令 {n}':
    'Custom commands {n}',
  '搜索名称 / 描述':
    'Search name / description',
  '命令 = 一串已有命令 + 参数。存下来就能重复点，AI 也能存。':
    'A command is a list of existing commands plus parameters. Save it and reuse it; AI can save them too.',
  '读取中…':
    'Loading…',
  还没有自定义命令:
    'No custom commands yet',
  '把一串常用操作存成一条命令；也可以让 AI 用 custom.define 存给你':
    'Save a chain of common operations as one command; AI can also save one for you via custom.define',
  没有匹配的命令:
    'No matching commands',
  我:
    'Me',
  '{steps} 步 · {params} 参数':
    '{steps} steps · {params} params',
  '跑过 {n} 次':
    'run {n} times',
  '删除自定义命令「{name}」？已经做过的画布改动不受影响。':
    'Delete custom command 「{name}」? Changes already made to the canvas are unaffected.',
  编辑:
    'Edit',

  /* ---- v2.8 首次运行 · 示例工程 · 介绍动画 ---- */
  '第一次来 · 四步看完':
    'First time here · four steps',
  可编程的动态海报工作台:
    'A programmable motion-poster workbench',
  '图层、关键帧、代码层和导出走同一条命令总线 —— 你在这里点的每一步，AI 都能用一条命令重放。':
    'Layers, keyframes, code layers and export all share one command bus — every step you take here, AI can replay as a single command.',
  一条命令总线:
    'one command bus',
  '关键帧 · 图层窗口同源':
    'keyframes · same source as layer windows',
  '已把示例「{name}」放进工程库：{seconds} 秒 · {layers} 层 · {code} 个代码层 · {audio} 条音轨 —— 打开就能改，删掉就不会再出现。':
    'Added the sample 「{name}」 to your library: {seconds}s · {layers} layers · {code} code layers · {audio} audio tracks — open it and edit freely; once deleted it will not come back.',
  打开示例:
    'Open the sample',
  关掉这条提示:
    'Dismiss this note',
  '尺寸 · 时长 · 帧率':
    'size · duration · fps',
  '位置 · 样式 · 叠放':
    'position · style · stacking',
  '轨道 + 播放头求值':
    'tracks + playhead evaluation',
  同一条命令总线:
    'the same command bus',
  放回示例工程:
    'Put the sample back',
  示例已放回工程库:
    'Sample restored to your library',
  '示例已换成新版：{seconds} 秒 · {layers} 层 · {audio} 条音轨 —— 原来那份没动过，直接换掉了。':
    'Sample upgraded: {seconds}s · {layers} layers · {audio} audio tracks — the old copy had not been edited, so it was replaced in place.',
  '示例有新版（{seconds} 秒极限样片）。你在这份上改过东西，所以没动它。':
    'A newer sample is available ({seconds}s extreme reel). You have edited your copy, so it was left untouched.',
  换成新版:
    'Replace with the new one',
  '换成新版示例？你在这份示例上做过的改动会丢掉。':
    'Replace with the newer sample? Any edits you made to this copy will be lost.',
  示例已换成新版:
    'Sample replaced with the new version',
  知道了:
    'Got it',
  放入失败:
    'Could not add the sample',

  /* ---- v2.9 音频层 ---- */
  音频: 'Audio',
  音频层: 'Audio layer',
  长音铺底: 'Sustained pad',
  节拍: 'Pulse',
  提示音: 'Chime',
  已静音: 'muted',
  '程序化合成，不依赖任何音频文件':
    'Synthesised from parameters — no audio file involved',
  试听: 'Preview',
  试听这一层:
    'Preview this layer',
  音源: 'Tone',
  音量: 'Volume',
  淡出: 'Fade out',
  基频: 'Root',
  每分钟拍数: 'BPM',
  '音频跟着主时钟走：暂停、拖播放头都会重锚。导出 WebM 时会离线渲染一遍混进音轨。':
    'Audio follows the master clock: pausing or scrubbing re-anchors it. WebM export renders the mix offline and muxes it into the file.',
  '是不是要先点一下播放才有声音':
    'Play once to unlock audio',

  内部分辨率: 'Internal resolution',
  运动模糊: 'Motion blur',
  开: 'On',
  关: 'Off',
  子帧: 'Sub-frames',
  快门: 'Shutter',
  '快门是一帧曝光，不是重影次数：30fps 下一帧 33ms。给 110ms 会得到三次离散重影。代价是这一层多画 N 遍。':
    'Shutter is one frame of exposure, not a ghost count — a frame at 30fps is 33ms. 110ms gives three discrete ghosts. The cost is N extra draws of this layer.',

  // ── 速度网格 / 歌词 ──────────────────────────────────────
  速度网格: 'Tempo grid',
  '{n} BPM': '{n} BPM',
  偏移: 'Offset',
  '拍 / 小节': 'Beats / bar',
  小节: 'bar',
  拍: 'beat',
  强拍: 'downbeat',
  '打拍': 'Tap',
  '速度减半（隔拍打拍时用）': 'Halve the tempo (when tapping every other beat)',
  '速度加倍（半速打拍时用）': 'Double the tempo (when tapping at half speed)',
  '把播放头当作拍点': 'Snap a beat to the playhead',
  '把播放头当作小节头（强拍）': 'Snap a downbeat to the playhead',
  '已按 {n} 下 · 间隔 {ms}ms · 敲得最散的一下偏 {spread}ms':
    '{n} taps · {ms}ms apart · worst tap is {spread}ms off the grid',
  '已按 {n} 下 · 间隔 {ms}ms（暂停中只改 BPM，不碰相位）':
    '{n} taps · {ms}ms apart (paused, so only BPM changes — the phase is left alone)',
  '跟着鼓点连按三下以上。播放中打拍会顺带把相位对齐；按的是隔拍就点 ×2。':
    'Tap along with the drums three times or more. Tapping during playback also aligns the phase; if you tap every other beat, hit ×2.',
  '此刻没有歌词': 'No lyric at this moment',
  '下一句 {ms}ms 后：{text}': 'Next line in {ms}ms: {text}',
  '歌词 / 逐字时间': 'Lyrics / word timing',
  '每行给一个毫秒区间；行内的逐字时间由引擎按字符权重切分，不用手排每一个字。代码层用 api.lyrics.chars 取「已唱几个字」。':
    'Each line carries a millisecond range; word timing inside the line is split by character weight, so you never place individual words by hand. Code layers read api.lyrics.chars for "how many characters have been sung".',
  起点改成播放头: 'Set start to playhead',
  删掉这一行: 'Delete this line',
  '还有 {n} 行没列出来（用命令改更快）': '{n} more lines not listed (a command edit is faster)',
  在播放头加一行: 'Add a line at the playhead',
  '复制为 LRC': 'Copy as LRC',
  '已复制 {n} 行 LRC': 'Copied {n} LRC lines',
  读进歌词: 'Import lyrics',
  '读进 {n} 行': 'Imported {n} lines',
  '这段文本里没有可用的歌词行': 'No usable lyric lines in that text',
  '认 [分:秒.毫秒] 和 [分:秒-分:秒] 两种写法；没带时间戳的行会按顺序接在后面，先有再准。':
    'Accepts [mm:ss.mmm] and [mm:ss-mm:ss]. Lines without a timestamp are appended in order — first get them in, then get them right.',
  新的一行: 'New line',

  // ── 剪辑：片段 / 裁剪 / 分割 / 转场 ────────────────────────
  片段: 'Clip',
  入点: 'In',
  出点: 'Out',
  素材入点: 'Source in',
  ' · 素材入点 {ms}ms': ' · source in {ms}ms',
  '拖动移动 · 左右边缘裁剪 · S 在播放头切开':
    'Drag to move · drag the edges to trim · S splits at the playhead',
  '拖动裁剪左边缘（素材不会跟着滑走）':
    'Drag to trim the left edge (the media stays put inside the clip)',
  拖动裁剪右边缘: 'Drag to trim the right edge',
  '在播放头切开选中片段（S）': 'Split the selected clip at the playhead (S)',
  切不开: 'Cannot split here',
  '转场（与上一段）': 'Transition (from the previous clip)',
  '硬切（无转场）': 'Cut (no transition)',
  转场时长: 'Transition length',
  '转场 {kind} · {ms}ms': 'Transition {kind} · {ms}ms',
  叠化: 'Crossfade',
  下陷黑场: 'Dip to black',
  滑入: 'Slide',
  擦除: 'Wipe',
  '转场只需要设在后一段上，前一段会自动让路。设成 0 或者选「硬切」就回到直接切。':
    'You only set the transition on the incoming clip — the previous one steps aside by itself. Set it to 0 or pick "Cut" to go back to a hard cut.',

  // ── 剪辑：导入媒体 ────────────────────────────────────────
  '导入图片 / 视频 / 音频': 'Import image / video / audio',
  '把图片、视频或音频拖进来': 'Drop images, videos or audio here',
  '视频/音频点一下自动放上时间轴；二进制存 IndexedDB，项目 JSON 里只有元数据。':
    'One click puts video or audio on the timeline; the bytes live in IndexedDB and the project JSON keeps only metadata.',
  '点击放到时间轴（从播放头开始）': 'Click to place on the timeline (starting at the playhead)',
  '{name} 超过 96MB，已跳过': '{name} is over 96MB — skipped',
  '导入音频 · {sec}s · 拖动片段边缘裁剪':
    'Imported audio · {sec}s · drag the clip edges to trim',
  // ── 剪映式界面：面板 / 时间轴拖放 / 预览控制条 ───────────────
  '拖到时间轴放入，或点一下放到播放头': 'Drag onto the timeline, or click to drop at the playhead',
  人声: 'Voice',
  音乐: 'Music',
  '{n} 条音轨': '{n} audio tracks',
  '程序化音源：不依赖任何音频文件，同一份工程在任何机器上听到的完全一样。': 'Procedural tone: no audio file involved, so the same project sounds identical on any machine.',
  正文: 'Body',
  特效: 'Effects',
  '把特效拖到时间轴的片段上，或者先选中片段再点。': 'Drag an effect onto a clip on the timeline, or select a clip first and click.',
  先选中一个片段: 'Select a clip first',
  转场: 'Transitions',
  '把转场拖到片段上就够了：它接在「上一段」和这一段之间，前一段会自动让路。': 'Dropping a transition onto a clip is enough: it lands between the previous clip and this one, and the previous one steps aside.',
  先选中要接在后面的那一段: 'Select the clip the transition leads into',
  '上一帧 (←)': 'Previous frame (←)',
  '下一帧 (→)': 'Next frame (→)',
  到结尾: 'Jump to the end',
  循环播放: 'Loop playback',
  这条时间轴上还没有片段: 'No clips on this timeline yet',
  贴不上转场: 'Cannot drop a transition there',
  '已把「{name}」接到 {clip} 上': 'Attached "{name}" to {clip}',
  套不上特效: 'Cannot apply the effect there',
  删除选中片段: 'Delete the selected clip',
  '复制选中片段 (Ctrl+D)': 'Duplicate the selected clip (Ctrl+D)',
  '时间轴缩放（Ctrl + 滚轮）': 'Timeline zoom (Ctrl + wheel)',
  固定: 'Fixed',
  自动: 'Auto',
  容差: 'Tolerance',
  '自动：从 4 个子帧起步逐级加密，全图最大变化不超过容差就停（最多 32）。容差是 0–255 的色阶。': 'Auto: start at 4 sub-frames and refine step by step, stopping once the largest change anywhere in the frame is within tolerance (at most 32). Tolerance is in 0–255 colour levels.',
  '100% · 文字与细线用这个': '100% · for text and hairlines',
  '50% · 噪声 / 辉光用这个': '50% · for noise / glow',
  保存: 'Save',

  // ── 人声引擎 ────────────────────────────────────────────
  'IndexedDB 事务被中断': 'IndexedDB transaction was aborted',
  '换成新版示例？你在内置示例上做过的改动会丢掉。': 'Switch to the new sample? Your edits to the built-in sample will be lost.',
  把内置示例放回工程库: 'Put the built-in sample back into the library',
  放回示例: 'Restore sample',
  '想找回内置示例，点右上角的「放回示例」。': 'To get the built-in sample back, click "Restore sample" in the top-right corner.',
  说话: 'Speak',
  演唱: 'Sing',
  女声: 'Female',
  男声: 'Male',
  童声: 'Child',
  机器人: 'Robot',
  '人声合成 · {mode} · {preset} · {n} 字': 'Synthesized voice · {mode} · {preset} · {n} syllables',
  去人声面板编辑: 'Edit in the voice panel',
  先写一句要唱的词: 'Write a line to sing first',
  生成失败: 'Generation failed',
  '已生成 {n} 个字 · 其中 {u} 个没有读音，已用哼声代替': 'Generated {n} syllables · {u} had no reading and became a hum',
  '已生成 {n} 个字 · {sec}s': 'Generated {n} syllables · {sec}s',
  工程里还没有歌词: 'This project has no lyrics yet',
  已按前几行歌词生成: 'Generated from the first lines of the lyrics',
  '正在编辑这一层：{name}': 'Editing this layer: {name}',
  '写一句要唱的词，或直接写拼音': 'Write a line to sing, or type pinyin directly',
  音色: 'Timbre',
  字: 'syllables',
  旋律: 'Melody',
  每字几拍: 'Beats per syllable',
  速度: 'Tempo',
  音色细节: 'Timbre details',
  音高: 'Pitch',
  半音: 'semitone',
  语速: 'Rate',
  颤音: 'Vibrato',
  气声: 'Breathiness',
  '有 {n} 个字不在读音表里，已用「啦」代替。把那几个字直接写成拼音就能唱对。': '{n} characters are not in the reading table and were replaced with "la". Write them as pinyin to make them sing correctly.',
  应用到这一层: 'Apply to this layer',
  生成到时间轴: 'Generate to timeline',
  用工程歌词生成: 'Generate from project lyrics',

  '上行': 'Upward',
  '起伏': 'Wave',
  '下行': 'Downward',
};

export type EnDict = typeof en;
export type { Locale };
