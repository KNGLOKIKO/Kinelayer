/**
 * 人声引擎 · 前端一半（**纯函数**，不碰 WebAudio、不碰 DOM）。
 *
 * 它只回答一个问题：**「这段文字要怎么唱/怎么说」** —— 切成音节、每个音节拆成音素、
 * 每个音素占多少毫秒、音高从哪滑到哪。真正的发声在 `src/render/voiceSynth.ts`。
 *
 * 为什么不用系统 TTS（`speechSynthesis`）：那条路只能「放出来」，拿不到 PCM。
 * 导出 WebM 时要把人声混进音轨、时间轴上要画波形、离线渲染要可复现 ——
 * 三件事都要求「声音是我算出来的」，所以这里走**共振峰合成**（formant synthesis）：
 * 一个声门脉冲源 + 三个共振峰滤波器，改的是滤波器中心频率，不是采样。
 *
 * 这是 1980 年代声码器/早期歌声合成的做法（Klatt 合成器的极简版）。
 * 音色一定不像真人，但**每个字都是按音素表算出来的**，不是随便一段嗡嗡声。
 *
 * 参考的四个开源实现（详见 docs/14-voice.md）：
 *   · **NNSVS** —— 「乐谱 → 时长模型 → F0 模型 → 声码器」的四段式。我们只做前两段，
 *     且都用规则实现（音节时长表 + 旋律/语调曲线），把声码器换成 WebAudio 的共振峰滤波。
 *   · **DiffSinger / OpenUtau** —— 神经歌声合成，模型几百 MB、要跑 ONNX，纯前端离线装不下；
 *     但它的**表情词汇**（breathiness / pexp / velocity）值得抄，本文件的
 *     `breath` / `vibrato` / `rate` 就是这三个。
 *   · **klattsch**（浏览器并联共振峰合成，零依赖）—— 「音素串 + 音符分组」的输入模型与
 *     「清浊交替 + 共振峰滑动」的发声顺序，这里的 note/phoneme 结构跟它同构。
 *   · **eSpeak NG** —— 107 种语言只有 1.4 MB，因为「一种语言 = 一张音素表 + 规则」。
 *     本文件的 HANZI 表 + 韵母归并就是这条思路的中文缩水版。
 */

import { VOICE_MODES, VOICE_PRESETS, type Project, type VoiceMode, type VoicePreset, type VoiceSpec } from './types';

export type { VoiceMode, VoicePreset, VoiceSpec };
export { VOICE_MODES, VOICE_PRESETS };

const DEFAULT_SPEC: VoiceSpec = {
  text: '你好，世界',
  mode: 'sing',
  preset: 'female',
  root: 220,
  rate: 1,
  pitch: 0,
  vibrato: 0.32,
  breath: 0.18,
  melody: [],
  beatsPerSyllable: 2,
  bpm: 120,
};

export function normalizeVoiceSpec(input: Partial<VoiceSpec> | null | undefined): VoiceSpec {
  const raw = input ?? {};
  const text = typeof raw.text === 'string' ? raw.text.slice(0, 400) : DEFAULT_SPEC.text;
  const preset = VOICE_PRESETS.includes(raw.preset as VoicePreset) ? (raw.preset as VoicePreset) : DEFAULT_SPEC.preset;
  const mode = VOICE_MODES.includes(raw.mode as VoiceMode) ? (raw.mode as VoiceMode) : DEFAULT_SPEC.mode;
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
    return Math.max(min, Math.min(max, n));
  };
  return {
    text,
    mode,
    preset,
    root: num(raw.root, PRESET_F0[preset], 55, 660),
    rate: num(raw.rate, 1, 0.5, 2),
    pitch: num(raw.pitch, 0, -24, 24),
    vibrato: num(raw.vibrato, DEFAULT_SPEC.vibrato, 0, 1),
    breath: num(raw.breath, DEFAULT_SPEC.breath, 0, 1),
    melody: Array.isArray(raw.melody)
      ? raw.melody.filter((n) => typeof n === 'number' && Number.isFinite(n)).slice(0, 64).map((n) => Math.round(n))
      : [],
    beatsPerSyllable: num(raw.beatsPerSyllable, DEFAULT_SPEC.beatsPerSyllable, 0.25, 8),
    bpm: num(raw.bpm, DEFAULT_SPEC.bpm, 30, 300),
  };
}

/** 各音色的基准基频。只影响默认值，用户调过就以用户为准 */
export const PRESET_F0: Record<VoicePreset, number> = {
  female: 220,
  male: 110,
  child: 300,
  robot: 130,
};

/* --------------------------------------------------------------- 音素表 */

/**
 * 一个音素的声学参数。
 *
 * 三个共振峰（F1/F2/F3）决定「是哪个元音」，`noise` 段决定「是哪个辅音」：
 * 塞音是一小段带通噪声（爆破），擦音是一段宽噪声，鼻音把 F1 压低。
 * 这些数字取自普通话元音的常见测量值（女声），男声/童声按 `formantScale` 整体缩放。
 */
export interface Phoneme {
  /** 第一/二/三共振峰（Hz，女声基准） */
  f1: number;
  f2: number;
  f3: number;
  /** 是否浊音（有声带振动） */
  voiced: boolean;
  /** 清音的噪声频带 [低, 高]，没有就是纯浊音 */
  noise?: [number, number];
  /** 相对振幅 */
  gain: number;
  /** 基准时长（毫秒，语速 1×） */
  ms: number;
}

const V = (f1: number, f2: number, f3: number, ms: number, gain = 1): Phoneme => ({ f1, f2, f3, voiced: true, gain, ms });
const C = (lo: number, hi: number, ms: number, gain = 0.45): Phoneme => ({
  f1: 400,
  f2: 1200,
  f3: 2600,
  voiced: false,
  noise: [lo, hi],
  gain,
  ms,
});
const NASAL = (f1: number, f2: number, ms: number, gain = 0.62): Phoneme => ({ f1, f2, f3: 2500, voiced: true, gain, ms });

/** 声母 / 韵母的声学参数表 */
export const PHONEMES: Record<string, Phoneme> = {
  /* ── 韵母（元音） ── */
  a: V(850, 1220, 2810, 190),
  o: V(500, 850, 2830, 180),
  e: V(520, 1350, 2500, 175),
  i: V(300, 2300, 3010, 180),
  u: V(330, 760, 2240, 175),
  v: V(300, 1900, 2400, 180),
  er: V(520, 1400, 1750, 200),
  ai: V(750, 1300, 2700, 230),
  ei: V(480, 1900, 2700, 220),
  ao: V(720, 1000, 2600, 230),
  ou: V(480, 900, 2500, 220),
  an: V(720, 1300, 2550, 230),
  en: V(520, 1500, 2500, 200),
  ang: V(720, 1100, 2500, 240),
  eng: V(530, 1400, 2500, 220),
  ong: V(520, 900, 2400, 230),
  /* ── 声母 ── */
  b: C(300, 1200, 55, 0.42),
  p: C(400, 1800, 70, 0.5),
  m: NASAL(280, 1000, 70, 0.7),
  f: C(1200, 5000, 75, 0.4),
  d: C(2500, 5000, 50, 0.4),
  t: C(2800, 6000, 65, 0.45),
  n: NASAL(280, 1500, 65, 0.65),
  l: V(360, 1250, 2700, 60, 0.7),
  g: C(1500, 3500, 50, 0.4),
  k: C(1600, 4000, 65, 0.45),
  h: C(700, 2500, 60, 0.32),
  j: C(2500, 5500, 60, 0.42),
  q: C(2600, 6000, 70, 0.46),
  x: C(3000, 7000, 70, 0.42),
  zh: C(1800, 4000, 65, 0.44),
  ch: C(2000, 4500, 75, 0.48),
  sh: C(1800, 5000, 75, 0.44),
  r: V(340, 1400, 1700, 65, 0.62),
  z: C(4000, 8000, 60, 0.38),
  c: C(4200, 9000, 70, 0.42),
  s: C(4000, 9000, 75, 0.38),
  w: V(300, 700, 2300, 55, 0.62),
  y: V(300, 2200, 3000, 55, 0.62),
};

/** 声母表，按长度倒序匹配（zh/ch/sh 必须先于 z/c/s） */
const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];

/** 复韵母 → 基础元音。带介音的（ia/iang/üan…）都归到最接近的单元音，够唱就行 */
const FINAL_ALIAS: Record<string, string> = {
  ia: 'a',
  iao: 'ao',
  ie: 'e',
  iu: 'ou',
  ian: 'an',
  in: 'en',
  iang: 'ang',
  ing: 'eng',
  iong: 'ong',
  ua: 'a',
  uo: 'o',
  uai: 'ai',
  ui: 'ei',
  uan: 'an',
  un: 'en',
  uang: 'ang',
  ueng: 'eng',
  ue: 'v',
  van: 'an',
  vn: 'en',
  ve: 'v',
  ü: 'v',
  üe: 'v',
  ün: 'en',
  üan: 'an',
};

/**
 * 常用汉字 → 拼音（去声调）。
 *
 * 只收「歌词里高频」的字，覆盖不到的字会退化成 `la` 并在计划里标 `unknown`，
 * 面板会提示「N 个字没有读音」。**这是有意的取舍**：与其猜一个错的音，
 * 不如让用户直接把那几个字写成拼音（`syllablesOf` 支持混写）。
 */
const HANZI: Record<string, string> = {
  我: 'wo', 你: 'ni', 他: 'ta', 她: 'ta', 它: 'ta', 们: 'men', 的: 'de', 了: 'le', 是: 'shi', 在: 'zai',
  有: 'you', 和: 'he', 就: 'jiu', 不: 'bu', 人: 'ren', 都: 'dou', 一: 'yi', 个: 'ge', 上: 'shang', 也: 'ye',
  很: 'hen', 到: 'dao', 说: 'shuo', 要: 'yao', 去: 'qu', 会: 'hui', 着: 'zhe', 没: 'mei', 看: 'kan', 好: 'hao',
  自: 'zi', 己: 'ji', 这: 'zhe', 那: 'na', 里: 'li', 天: 'tian', 地: 'di', 大: 'da', 小: 'xiao', 中: 'zhong',
  国: 'guo', 家: 'jia', 年: 'nian', 月: 'yue', 日: 'ri', 时: 'shi', 分: 'fen', 秒: 'miao', 心: 'xin', 手: 'shou',
  眼: 'yan', 头: 'tou', 走: 'zou', 来: 'lai', 想: 'xiang', 爱: 'ai', 恨: 'hen', 笑: 'xiao', 哭: 'ku', 唱: 'chang',
  歌: 'ge', 声: 'sheng', 音: 'yin', 话: 'hua', 语: 'yu', 字: 'zi', 词: 'ci', 句: 'ju', 诗: 'shi', 文: 'wen',
  书: 'shu', 写: 'xie', 读: 'du', 听: 'ting', 见: 'jian', 知: 'zhi', 道: 'dao', 事: 'shi', 情: 'qing', 意: 'yi',
  思: 'si', 梦: 'meng', 光: 'guang', 亮: 'liang', 黑: 'hei', 白: 'bai', 红: 'hong', 蓝: 'lan', 绿: 'lv', 黄: 'huang',
  色: 'se', 风: 'feng', 雨: 'yu', 雪: 'xue', 云: 'yun', 山: 'shan', 水: 'shui', 海: 'hai', 河: 'he', 花: 'hua',
  草: 'cao', 树: 'shu', 叶: 'ye', 春: 'chun', 夏: 'xia', 秋: 'qiu', 冬: 'dong', 早: 'zao', 晚: 'wan', 夜: 'ye',
  今: 'jin', 明: 'ming', 昨: 'zuo', 前: 'qian', 后: 'hou', 左: 'zuo', 右: 'you', 东: 'dong', 西: 'xi', 南: 'nan',
  北: 'bei', 长: 'chang', 短: 'duan', 多: 'duo', 少: 'shao', 高: 'gao', 低: 'di', 快: 'kuai', 慢: 'man', 新: 'xin',
  旧: 'jiu', 老: 'lao', 远: 'yuan', 近: 'jin', 开: 'kai', 关: 'guan', 起: 'qi', 落: 'luo', 飞: 'fei', 跑: 'pao',
  停: 'ting', 等: 'deng', 找: 'zhao', 拿: 'na', 放: 'fang', 给: 'gei', 让: 'rang', 把: 'ba', 被: 'bei', 从: 'cong',
  向: 'xiang', 对: 'dui', 跟: 'gen', 与: 'yu', 或: 'huo', 但: 'dan', 而: 'er', 因: 'yin', 为: 'wei', 所: 'suo',
  以: 'yi', 如: 'ru', 果: 'guo', 还: 'hai', 再: 'zai', 又: 'you', 只: 'zhi', 最: 'zui', 更: 'geng', 太: 'tai',
  真: 'zhen', 假: 'jia', 错: 'cuo', 非: 'fei', 无: 'wu', 生: 'sheng', 死: 'si', 活: 'huo', 完: 'wan', 成: 'cheng',
  变: 'bian', 化: 'hua', 加: 'jia', 减: 'jian', 数: 'shu', 电: 'dian', 脑: 'nao', 网: 'wang', 络: 'luo', 机: 'ji',
  器: 'qi', 车: 'che', 船: 'chuan', 路: 'lu', 门: 'men', 窗: 'chuang', 房: 'fang', 屋: 'wu', 桌: 'zhuo', 椅: 'yi',
  床: 'chuang', 灯: 'deng', 火: 'huo', 冰: 'bing', 热: 're', 冷: 'leng', 暖: 'nuan', 凉: 'liang', 累: 'lei', 饿: 'e',
  渴: 'ke', 睡: 'shui', 醒: 'xing', 坐: 'zuo', 站: 'zhan', 躺: 'tang', 转: 'zhuan', 回: 'hui', 过: 'guo', 出: 'chu',
  进: 'jin', 入: 'ru', 下: 'xia', 内: 'nei', 外: 'wai', 间: 'jian', 边: 'bian', 旁: 'pang', 处: 'chu', 方: 'fang',
  面: 'mian', 点: 'dian', 线: 'xian', 条: 'tiao', 块: 'kuai', 片: 'pian', 张: 'zhang', 本: 'ben', 次: 'ci', 遍: 'bian',
  些: 'xie', 每: 'mei', 各: 'ge', 全: 'quan', 半: 'ban', 几: 'ji', 百: 'bai', 千: 'qian', 万: 'wan', 亿: 'yi',
  零: 'ling', 二: 'er', 三: 'san', 四: 'si', 五: 'wu', 六: 'liu', 七: 'qi', 八: 'ba', 九: 'jiu', 十: 'shi',
  第: 'di', 号: 'hao', 岁: 'sui', 刻: 'ke', 钟: 'zhong', 星: 'xing', 期: 'qi', 周: 'zhou', 现: 'xian', 未: 'wei',
  曾: 'ceng', 经: 'jing', 常: 'chang', 总: 'zong', 直: 'zhi', 马: 'ma', 立: 'li', 忽: 'hu', 然: 'ran', 终: 'zhong',
  于: 'yu', 已: 'yi', 将: 'jiang', 正: 'zheng', 刚: 'gang', 才: 'cai', 决: 'jue', 定: 'ding', 选: 'xuan', 择: 'ze',
  改: 'gai', 换: 'huan', 删: 'shan', 除: 'chu', 添: 'tian', 移: 'yi', 动: 'dong', 静: 'jing', 止: 'zhi', 播: 'bo',
  录: 'lu', 制: 'zhi', 剪: 'jian', 辑: 'ji', 画: 'hua', 图: 'tu', 层: 'ceng', 轨: 'gui', 速: 'su', 度: 'du',
  帧: 'zhen', 率: 'lv', 导: 'dao', 保: 'bao', 存: 'cun', 打: 'da', 闭: 'bi', 退: 'tui', 步: 'bu', 骤: 'zhou',
  命: 'ming', 令: 'ling', 行: 'xing', 代: 'dai', 码: 'ma', 程: 'cheng', 序: 'xu', 系: 'xi', 统: 'tong', 软: 'ruan',
  件: 'jian', 硬: 'ying', 盘: 'pan', 储: 'chu', 取: 'qu', 传: 'chuan', 输: 'shu', 信: 'xin', 息: 'xi', 据: 'ju',
  表: 'biao', 格: 'ge', 式: 'shi', 模: 'mo', 型: 'xing', 智: 'zhi', 能: 'neng', 算: 'suan', 法: 'fa', 言: 'yan',
  章: 'zhang', 曲: 'qu', 旋: 'xuan', 律: 'lv', 调: 'diao', 拍: 'pai', 节: 'jie', 奏: 'zou', 钢: 'gang', 琴: 'qin',
  鼓: 'gu', 吉: 'ji', 笛: 'di', 弦: 'xian', 管: 'guan', 乐: 'yue', 队: 'dui', 合: 'he', 独: 'du', 众: 'zhong',
  群: 'qun', 团: 'tuan', 员: 'yuan', 师: 'shi', 友: 'you', 朋: 'peng', 亲: 'qin', 爸: 'ba', 妈: 'ma', 哥: 'ge',
  姐: 'jie', 妹: 'mei', 弟: 'di', 爷: 'ye', 奶: 'nai', 叔: 'shu', 姨: 'yi', 舅: 'jiu', 女: 'nv', 男: 'nan',
  子: 'zi', 儿: 'er', 名: 'ming', 姓: 'xing', 谁: 'shui', 什: 'shen', 么: 'me', 怎: 'zen', 样: 'yang',
  虽: 'sui', 此: 'ci', 由: 'you', 至: 'zhi', 需: 'xu',
  求: 'qiu', 应: 'ying', 该: 'gai', 必: 'bi', 须: 'xu', 可: 'ke', 许: 'xu', 愿: 'yuan', 望: 'wang', 希: 'xi',
  记: 'ji', 忘: 'wang', 留: 'liu', 送: 'song', 接: 'jie', 抱: 'bao', 牵: 'qian', 靠: 'kao', 陪: 'pei', 守: 'shou',

  /* 第二批：常用字扩到一千上下，够写日常句子。
     不带声调：声调由旋律与语速决定，这里只给音节骨架。 */
  得: 'de', 学: 'xue', 之: 'zhi', 发: 'fa', 当: 'dang', 用: 'yong', 作: 'zuo', 种: 'zhong', 美: 'mei', 同: 'tong',
  位: 'wei', 斯: 'si', 世: 'shi', 两: 'liang', 使: 'shi', 身: 'shen', 者: 'zhe', 其: 'qi', 感: 'gan', 问: 'wen',
  力: 'li', 理: 'li', 尔: 'er', 公: 'gong', 特: 'te', 做: 'zuo', 孩: 'hai', 相: 'xiang', 实: 'shi', 重: 'zhong',
  工: 'gong', 物: 'wu', 气: 'qi', 并: 'bing', 别: 'bie', 比: 'bi', 便: 'bian', 夫: 'fu', 部: 'bu', 像: 'xiang',
  体: 'ti', 却: 'que', 主: 'zhu', 界: 'jie', 利: 'li', 受: 'shou', 德: 'de', 克: 'ke', 先: 'xian', 口: 'kou',
  安: 'an', 性: 'xing', 住: 'zhu', 难: 'nan', 教: 'jiao', 结: 'jie', 拉: 'la', 神: 'shen', 母: 'mu', 父: 'fu',
  场: 'chang', 平: 'ping', 报: 'bao', 认: 'ren', 告: 'gao', 英: 'ying', 军: 'jun', 候: 'hou', 民: 'min', 往: 'wang',
  何: 'he', 觉: 'jue', 带: 'dai', 解: 'jie', 叫: 'jiao', 任: 'ren', 金: 'jin', 原: 'yuan', 吃: 'chi', 通: 'tong',
  象: 'xiang', 失: 'shi', 满: 'man', 战: 'zhan', 士: 'shi', 轻: 'qing', 目: 'mu', 呢: 'ne', 病: 'bing', 始: 'shi',
  达: 'da', 深: 'shen', 提: 'ti', 清: 'qing', 王: 'wang', 空: 'kong', 业: 'ye', 切: 'qie', 罗: 'luo', 钱: 'qian',
  吗: 'ma', 元: 'yuan', 喜: 'xi', 离: 'li', 科: 'ke', 干: 'gan', 流: 'liu', 欢: 'huan', 约: 'yue', 即: 'ji',
  指: 'zhi', 反: 'fan', 题: 'ti', 论: 'lun', 交: 'jiao', 林: 'lin', 请: 'qing', 医: 'yi', 球: 'qiu', 运: 'yun',
  及: 'ji', 则: 'ze', 院: 'yuan', 量: 'liang', 苦: 'ku', 布: 'bu', 品: 'pin', 产: 'chan', 答: 'da', 精: 'jing',
  视: 'shi', 连: 'lian', 司: 'si', 巴: 'ba', 奇: 'qi', 类: 'lei', 且: 'qie', 婚: 'hun', 台: 'tai', 青: 'qing',
  久: 'jiu', 乎: 'hu', 越: 'yue', 观: 'guan', 尽: 'jin', 形: 'xing', 影: 'ying', 吧: 'ba', 识: 'shi', 亚: 'ya',
  术: 'shu', 市: 'shi', 兴: 'xing', 造: 'zao', 谈: 'tan', 容: 'rong', 极: 'ji', 随: 'sui', 演: 'yan', 收: 'shou',
  首: 'shou', 根: 'gen', 讲: 'jiang', 整: 'zheng', 照: 'zhao', 办: 'ban', 强: 'qiang', 石: 'shi', 古: 'gu', 华: 'hua',
  计: 'ji', 您: 'nin', 装: 'zhuang', 似: 'si', 足: 'zu', 双: 'shuang', 妻: 'qi', 尼: 'ni', 诉: 'su', 米: 'mi',
  称: 'cheng', 丽: 'li', 客: 'ke', 领: 'ling', 衣: 'yi', 断: 'duan', 福: 'fu', 城: 'cheng', 故: 'gu', 历: 'li',
  惊: 'jing', 脸: 'lian', 包: 'bao', 紧: 'jin', 争: 'zheng', 另: 'ling', 建: 'jian', 维: 'wei', 绝: 'jue', 伤: 'shang',
  示: 'shi', 持: 'chi', 史: 'shi', 准: 'zhun', 联: 'lian', 妇: 'fu', 纪: 'ji', 基: 'ji', 买: 'mai', 志: 'zhi',
  阿: 'a', 复: 'fu', 痛: 'tong', 消: 'xiao', 社: 'she', 义: 'yi', 竟: 'jing', 确: 'que', 酒: 'jiu', 单: 'dan',
  治: 'zhi', 卡: 'ka', 幸: 'xing', 兰: 'lan', 念: 'nian', 举: 'ju', 仅: 'jin', 怕: 'pa', 共: 'gong', 毛: 'mao',
  功: 'gong', 官: 'guan', 待: 'dai', 究: 'jiu', 穿: 'chuan', 室: 'shi', 易: 'yi', 游: 'you', 居: 'ju', 考: 'kao',
  突: 'tu', 皮: 'pi', 哪: 'na', 费: 'fei', 倒: 'dao', 价: 'jia', 具: 'ju', 永: 'yong', 响: 'xiang', 商: 'shang',
  礼: 'li', 细: 'xi', 专: 'zhuan', 脚: 'jiao', 味: 'wei', 灵: 'ling', 般: 'ban', 破: 'po', 引: 'yin', 食: 'shi',
  仍: 'reng', 注: 'zhu', 笔: 'bi', 甚: 'shen', 某: 'mou', 沉: 'chen', 血: 'xue', 备: 'bei', 习: 'xi', 校: 'xiao',
  默: 'mo', 务: 'wu', 土: 'tu', 微: 'wei', 娘: 'niang', 试: 'shi', 怀: 'huai', 料: 'liao', 广: 'guang', 苏: 'su',
  显: 'xian', 赛: 'sai', 查: 'cha', 密: 'mi', 议: 'yi', 底: 'di', 列: 'lie', 富: 'fu', 座: 'zuo', 参: 'can',
  印: 'yin', 设: 'she', 温: 'wen', 掉: 'diao', 京: 'jing', 初: 'chu', 养: 'yang', 香: 'xiang', 际: 'ji', 致: 'zhi',
  阳: 'yang', 纸: 'zhi', 李: 'li', 纳: 'na', 验: 'yan', 助: 'zhu', 激: 'ji', 够: 'gou', 严: 'yan', 证: 'zheng',
  帝: 'di', 饭: 'fan', 趣: 'qu', 支: 'zhi', 集: 'ji', 丈: 'zhang', 木: 'mu', 研: 'yan', 班: 'ban', 普: 'pu',
  顿: 'dun', 展: 'zhan', 跳: 'tiao', 获: 'huo', 艺: 'yi', 波: 'bo', 察: 'cha', 皇: 'huang', 段: 'duan', 急: 'ji',
  庭: 'ting', 创: 'chuang', 区: 'qu', 奥: 'ao', 谢: 'xie', 店: 'dian', 否: 'fou', 害: 'hai', 排: 'pai', 背: 'bei',
  组: 'zu', 州: 'zhou', 朝: 'chao', 封: 'feng', 睛: 'jing', 板: 'ban', 角: 'jiao', 况: 'kuang', 馆: 'guan', 育: 'yu',
  忙: 'mang', 质: 'zhi', 续: 'xu', 呼: 'hu', 若: 'ruo', 推: 'tui', 境: 'jing', 遇: 'yu', 标: 'biao', 充: 'chong',
  围: 'wei', 案: 'an', 伦: 'lun', 护: 'hu', 警: 'jing', 贝: 'bei', 著: 'zhu', 索: 'suo', 剧: 'ju', 啊: 'a',
  险: 'xian', 烟: 'yan', 依: 'yi', 斗: 'dou', 值: 'zhi', 帮: 'bang', 汉: 'han', 佛: 'fo', 肯: 'ken', 闻: 'wen',
  沙: 'sha', 局: 'ju', 伯: 'bo', 族: 'zu', 玩: 'wan', 资: 'zi', 击: 'ji', 顾: 'gu', 泪: 'lei', 洲: 'zhou',
  圣: 'sheng', 堂: 'tang', 兵: 'bing', 露: 'lu', 园: 'yuan', 牛: 'niu', 旅: 'lv', 街: 'jie', 劳: 'lao', 烈: 'lie',
  姑: 'gu', 陈: 'chen', 莫: 'mo', 鱼: 'yu', 异: 'yi', 宝: 'bao', 权: 'quan', 鲁: 'lu', 简: 'jian', 态: 'tai',
  级: 'ji', 票: 'piao', 怪: 'guai', 寻: 'xun', 杀: 'sha', 胜: 'sheng', 份: 'fen', 汽: 'qi', 洋: 'yang', 范: 'fan',
  舞: 'wu', 秘: 'mi', 午: 'wu', 登: 'deng', 楼: 'lou', 贵: 'gui', 吸: 'xi', 责: 'ze', 例: 'li', 追: 'zhui',
  较: 'jiao', 职: 'zhi', 属: 'shu', 渐: 'jian', 丝: 'si', 牙: 'ya', 党: 'dang', 继: 'ji', 托: 'tuo', 赶: 'gan',
  冲: 'chong', 胡: 'hu', 卖: 'mai', 坚: 'jian', 喝: 'he', 肉: 'rou', 遗: 'yi', 救: 'jiu', 修: 'xiu', 松: 'song',
  临: 'lin', 藏: 'cang', 担: 'dan', 戏: 'xi', 善: 'shan', 卫: 'wei', 药: 'yao', 悲: 'bei', 敢: 'gan', 伊: 'yi',
  村: 'cun', 戴: 'dai', 森: 'sen', 耳: 'er', 差: 'cha', 祖: 'zu', 规: 'gui', 散: 'san', 迷: 'mi', 油: 'you',
  适: 'shi', 乡: 'xiang', 架: 'jia', 恩: 'en', 投: 'tou', 弹: 'dan', 铁: 'tie', 博: 'bo', 雷: 'lei', 府: 'fu',
  压: 'ya', 超: 'chao', 负: 'fu', 勒: 'le', 杂: 'za', 洗: 'xi', 采: 'cai', 毫: 'hao', 嘴: 'zui', 毕: 'bi',
  既: 'ji', 状: 'zhuang', 乱: 'luan', 景: 'jing', 席: 'xi', 珍: 'zhen', 童: 'tong', 顶: 'ding', 派: 'pai', 素: 'su',
  脱: 'tuo', 农: 'nong', 疑: 'yi', 练: 'lian', 野: 'ye', 按: 'an', 犯: 'fan', 征: 'zheng', 坏: 'huai', 骨: 'gu',
  余: 'yu', 承: 'cheng', 置: 'zhi', 彩: 'cai', 巨: 'ju', 免: 'mian', 环: 'huan', 姆: 'mu', 暗: 'an', 技: 'ji',
  翻: 'fan', 束: 'shu', 增: 'zeng', 忍: 'ren', 餐: 'can', 洛: 'luo', 塞: 'sai', 缺: 'que', 忆: 'yi', 判: 'pan',
  欧: 'ou', 付: 'fu', 阵: 'zhen', 玛: 'ma', 批: 'pi', 岛: 'dao', 项: 'xiang', 狗: 'gou', 休: 'xiu', 懂: 'dong',
  武: 'wu', 革: 'ge', 良: 'liang', 恶: 'e', 恋: 'lian', 委: 'wei', 拥: 'yong', 娜: 'na', 妙: 'miao', 探: 'tan',
  呀: 'ya', 营: 'ying', 摇: 'yao', 弄: 'nong', 熟: 'shu', 诺: 'nuo', 宣: 'xuan', 银: 'yin', 势: 'shi', 奖: 'jiang',
  宫: 'gong', 套: 'tao', 康: 'kang', 供: 'gong', 优: 'you', 课: 'ke', 鸟: 'niao', 喊: 'han', 降: 'jiang', 困: 'kun',
  刘: 'liu', 罪: 'zui', 亡: 'wang', 鞋: 'xie', 健: 'jian', 败: 'bai', 伴: 'ban', 挥: 'hui', 鲜: 'xian', 财: 'cai',
  孤: 'gu', 枪: 'qiang', 禁: 'jin', 恐: 'kong', 伙: 'huo', 杰: 'jie', 迹: 'ji', 玻: 'bo', 沿: 'yan', 颗: 'ke',
  谋: 'mou',
};

/** 数字读法：歌词里写 `2026` 也能唱成「二零二六」 */
const DIGITS = ['ling', 'yi', 'er', 'san', 'si', 'wu', 'liu', 'qi', 'ba', 'jiu'];

/** 拉丁字母 → 近似的音素。英文歌词不会念得很准，但节奏与音高是对的 */
const LATIN: Record<string, string> = {
  a: 'a', e: 'e', i: 'i', o: 'o', u: 'u', y: 'i',
  b: 'b', c: 'k', d: 'd', f: 'f', g: 'g', h: 'h', j: 'j', k: 'k', l: 'l', m: 'm', n: 'n',
  p: 'p', q: 'k', r: 'r', s: 's', t: 't', v: 'f', w: 'w', x: 's', z: 'z',
};

/* --------------------------------------------------------------- 音节化 */

export interface Syllable {
  /** 原文（一个字 / 一个词） */
  text: string;
  /** 音节拼写（拼音或拉丁转写） */
  pinyin: string;
  /** 拆出来的音素序列，按时间顺序 */
  phonemes: string[];
  /** 表里没查到读音，用 `la` 顶上了 */
  unknown: boolean;
  /** 后面跟的停顿（毫秒）：逗号/句号/换行 */
  pauseMs: number;
}

const PUNCT_PAUSE: Record<string, number> = {
  '，': 180, ',': 180, '、': 150, '；': 220, ';': 220, '：': 160, ':': 160,
  '。': 320, '.': 300, '！': 300, '!': 300, '？': 320, '?': 320, '…': 260, '~': 120, '—': 160,
  ' ': 70, '\n': 300, '\t': 120,
};

/** 把拼音切成声母 + 韵母，再映射到音素表里的键 */
export function pinyinToPhonemes(pinyin: string): { phonemes: string[]; canonical: string } {
  const py = pinyin.toLowerCase().replace(/[1-5]/g, '').replace(/u:|ü/g, 'v').replace(/[^a-z]/g, '');
  if (!py) return { phonemes: ['la'], canonical: 'la' };
  const initial = INITIALS.find((i) => py.startsWith(i)) ?? '';
  const rest = py.slice(initial.length) || py;
  /* zhi/chi/shi/ri/zi/ci/si 的「空韵母」在合成里用一个短 i 顶替 */
  const emptyRime = ['zh', 'ch', 'sh', 'r', 'z', 'c', 's'].includes(initial) && rest === 'i';
  const finalKey = emptyRime ? 'i' : (FINAL_ALIAS[rest] ?? rest);
  const final = PHONEMES[finalKey] ? finalKey : 'a';
  const phonemes = [...(initial ? [initial === 'y' || initial === 'w' ? final : initial] : []), final];
  /* y/w 开头的音节（yi/wu/yu）没有真声母，直接当元音唱 */
  return { phonemes: phonemes.length ? phonemes : [final], canonical: `${initial}${finalKey}` };
}

function syllablesOfWord(word: string): Syllable[] {
  const out: Syllable[] = [];
  const lower = word.toLowerCase();
  let i = 0;
  while (i < lower.length) {
    const ch = lower[i]!;
    const vowelGroup = /[aeiouy]/.test(ch);
    /* 一个音节 = 至多两个辅音 + 一串元音 + 至多两个辅音 */
    let j = i;
    let consonants = 0;
    while (j < lower.length && !/[aeiouy]/.test(lower[j]!)) {
      if (++consonants > 2) break;
      j += 1;
    }
    if (j < lower.length) {
      while (j < lower.length && /[aeiouy]/.test(lower[j]!)) j += 1;
      let tail = 0;
      while (j < lower.length && !/[aeiouy]/.test(lower[j]!) && tail < 2) {
        j += 1;
        tail += 1;
      }
    }
    if (j === i) j = i + 1;
    const chunk = lower.slice(i, j);
    const phonemes = [...chunk].map((c) => LATIN[c] ?? 'a').filter((p) => PHONEMES[p]);
    out.push({
      text: word.slice(i, j),
      pinyin: chunk,
      phonemes: phonemes.length ? phonemes : ['la'],
      unknown: false,
      pauseMs: 0,
    });
    i = j;
    if (vowelGroup && out.length > 8) break; /* 太长的词不当一个词处理 */
  }
  return out;
}

/**
 * 文本 → 音节序列。
 *
 * 支持三种混写：汉字（查表）、拼音（`ni3 hao3` / `nihao`）、拉丁词（近似转写）。
 * 标点与空白不进音节，只产生停顿。
 */
export function syllablesOf(text: string): Syllable[] {
  const out: Syllable[] = [];
  const raw = [...(text ?? '')];
  let latin = '';

  const flushLatin = () => {
    if (!latin) return;
    const parts = syllablesOfWord(latin);
    if (parts.length) {
      out.push(...parts);
      /* 词尾给一点点停顿，句子才有「词」的感觉 */
      out[out.length - 1]!.pauseMs = Math.max(out[out.length - 1]!.pauseMs, 60);
    }
    latin = '';
  };

  for (const ch of raw) {
    if (/[A-Za-z]/.test(ch)) {
      latin += ch;
      continue;
    }
    flushLatin();
    if (/[0-9]/.test(ch)) {
      const py = DIGITS[Number(ch)] ?? 'ling';
      out.push({ text: ch, pinyin: py, ...pinyinToPhonemes(py), pauseMs: 0, unknown: false });
      continue;
    }
    const pause = PUNCT_PAUSE[ch];
    if (pause !== undefined) {
      if (out.length) out[out.length - 1]!.pauseMs = Math.max(out[out.length - 1]!.pauseMs, pause);
      continue;
    }
    const py = HANZI[ch];
    if (py) {
      out.push({ text: ch, pinyin: py, ...pinyinToPhonemes(py), pauseMs: 0, unknown: false });
    } else if (/\s/.test(ch)) {
      continue;
    } else {
      /* 表里没有的字：用 la 顶上，并标记出来让界面提示 */
      out.push({ text: ch, pinyin: 'la', phonemes: ['l', 'a'], pauseMs: 0, unknown: true });
    }
  }
  flushLatin();
  return out;
}

/* ------------------------------------------------------------------ 计划 */

export interface VoicePhoneme {
  ph: string;
  ms: number;
  /** 这一个音素的起始时刻（相对整层） */
  atMs: number;
}

export interface VoiceNote {
  text: string;
  pinyin: string;
  atMs: number;
  ms: number;
  /** 起始/结束基频（Hz），滑音靠这两个数 */
  f0: number;
  f0End: number;
  phonemes: VoicePhoneme[];
  unknown: boolean;
}

export interface VoicePlan {
  notes: VoiceNote[];
  /** 整层需要多长（毫秒），含尾部换气 */
  totalMs: number;
  /** 没有读音的字数，界面据此提示 */
  unknownCount: number;
  /** 音素总数，面板上显示「N 个音素」 */
  phonemeCount: number;
}

/** 演唱没给旋律时的自动旋律：五声音阶 + 回旋，听得出是「有曲」，且完全确定 */
const AUTO_MELODY = [0, 2, 4, 7, 4, 2, 0, -3, 0, 4, 7, 9, 7, 4, 2, 0];

/**
 * 生成「怎么唱」的完整计划。
 *
 * 时间分配的两条规则：
 *   · **说话**：字节拍由音素表决定（辅音 50–75ms、元音 175–240ms），除以 `rate`；
 *   · **演唱**：每个音节占 `beatsPerSyllable` 拍，音素按基准时长**等比拉伸**到拍长里，
 *     多出来的时间补给最后一个元音 —— 这样长音真的是长音，不是把整句拖慢。
 */
export function buildVoicePlan(input: Partial<VoiceSpec>): VoicePlan {
  const spec = normalizeVoiceSpec(input);
  const syllables = syllablesOf(spec.text);
  const beatMs = 60_000 / Math.max(30, spec.bpm);

  const notes: VoiceNote[] = [];
  let cursor = 0;
  let unknownCount = 0;
  let phonemeCount = 0;

  syllables.forEach((syl, index) => {
    const defs = syl.phonemes.map((p) => PHONEMES[p] ?? PHONEMES.a!).map((p) => p.ms);
    const baseSum = defs.reduce((a, b) => a + b, 0);

    let target: number;
    if (spec.mode === 'sing') {
      target = beatMs * spec.beatsPerSyllable;
    } else {
      /* 说话：按音素表算，语速直接除；最短 60ms 保证听得出一个音节 */
      target = Math.max(60, baseSum / spec.rate);
    }

    /* 音素时长按比例分配，最后多出来的给最后一个元音 */
    const scale = target / Math.max(1, baseSum);
    const durations = defs.map((d) => Math.max(18, d * scale));
    const used = durations.reduce((a, b) => a + b, 0);
    if (used < target) durations[durations.length - 1]! += target - used;

    let at = 0;
    const phonemes: VoicePhoneme[] = syl.phonemes.map((p, i) => {
      const item = { ph: p, ms: Math.round(durations[i]!), atMs: Math.round(at) };
      at += durations[i]!;
      return item;
    });

    /* 音高：演唱按旋律走，说话按「句末下沉 + 每字轻微起伏」走 */
    let semi: number;
    if (spec.mode === 'sing') {
      const melody = spec.melody.length ? spec.melody : AUTO_MELODY;
      semi = melody[index % melody.length]!;
    } else {
      const drift = -Math.min(3, index * 0.22);
      semi = drift + (index % 3 === 0 ? 0.4 : 0);
    }
    const f0 = spec.root * Math.pow(2, (semi + spec.pitch) / 12);
    /* 句末两字下滑一点，是「陈述句」的唯一线索 */
    const tail = spec.mode === 'sing' ? 0 : index === syllables.length - 1 ? -1.2 : 0;
    const f0End = spec.root * Math.pow(2, (semi + spec.pitch + tail) / 12);

    if (syl.unknown) unknownCount += 1;
    phonemeCount += phonemes.length;
    notes.push({
      text: syl.text,
      pinyin: syl.pinyin,
      atMs: Math.round(cursor),
      ms: Math.round(target),
      f0: Math.round(f0 * 100) / 100,
      f0End: Math.round(f0End * 100) / 100,
      phonemes,
      unknown: syl.unknown,
    });
    cursor += target + syl.pauseMs;
  });

  const tailMs = spec.mode === 'sing' ? 260 : 180;
  return {
    notes,
    totalMs: Math.round(cursor + tailMs),
    unknownCount,
    phonemeCount,
  };
}

/** 面板上显示的「大约多少秒」 */
export function estimateVoiceMs(input: Partial<VoiceSpec>): number {
  return buildVoicePlan(input).totalMs;
}

/**
 * 从工程的歌词里取一段文本（`voice.generate` 的 `fromLyrics` 用）。
 * 没有歌词时退回工程名 + 一句招呼，总比生成一片空白好。
 */
export function lyricTextOf(project: Project, maxLines = 4): string {
  const lines = project.lyrics ?? [];
  const picked = lines
    .slice(0, maxLines)
    .map((l: { text: string }) => l.text.replace(/[[\]]/g, '').trim())
    .filter(Boolean);
  if (picked.length) return picked.join('，');
  return project.name ? `${project.name}` : '你好';
}
