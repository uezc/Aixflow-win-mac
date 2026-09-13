/**
 * 人物/场景设计提示词：贴合背景故事，写清形象与音色字段。
 */

import type { DramaCharacter, DramaCharacterVisualLock, DramaVoice } from './types.js';
import {
  inferDramaSceneSettingPeriod,
  isDramaSceneEraCompatible,
  isDramaSceneStoryContextCompatible,
} from './sceneSettingPeriod.js';

const GENDER_ZH: Record<string, string> = {
  male: '男',
  female: '女',
  '男': '男',
  '女': '女',
};

export function dramaGenderLabel(gender: string): string {
  const g = String(gender || '').trim().toLowerCase();
  if (g === 'male' || g === '男') return '男';
  if (g === 'female' || g === '女') return '女';
  return String(gender || '').trim() || '未注明';
}

/** 人物生图提示词必含维度（用于校验与补全） */
export const DRAMA_CHARACTER_PROMPT_REQUIRED_HINTS = [
  '年龄',
  '性别',
  '身材',
  '发型',
  '发色',
  '服饰',
  '配饰',
  '颜色',
  '年代',
  '表情',
  '材质',
] as const;

export function composeDramaCharacterDesignPrompt(input: {
  name?: string;
  age?: string;
  gender?: string;
  role?: string;
  identity?: string;
  personality?: string;
  backstory?: string;
  prompt?: string;
  visual?: Partial<DramaCharacterVisualLock> | null;
  expression?: string;
  materials?: string;
  storyContext?: string;
  eraStyle?: string;
}): string {
  const existing = String(input.prompt || '').trim();
  const age = String(input.age || '').trim();
  const genderZh = dramaGenderLabel(String(input.gender || ''));
  const role = String(input.role || input.identity || '').trim();
  const personality = String(input.personality || '').trim();
  const backstory = String(input.backstory || '').trim();
  const face = String(input.visual?.face || '').trim();
  const hair = String(input.visual?.hair || '').trim();
  const body = String(input.visual?.body || '').trim();
  const clothing = String(input.visual?.clothing || '').trim();
  const special = String(input.visual?.specialFeature || '').trim();
  const expression = String(input.expression || '').trim();
  const materials = String(input.materials || '').trim();
  const story = String(input.storyContext || '').trim();
  const era = String(input.eraStyle || '').trim();

  // 已足够详细则保留，仅在缺关键维度时追加
  const richEnough =
    existing.length >= 140 &&
    /岁|年龄/.test(existing) &&
    /(男|女|性别)/.test(existing) &&
    /(发型|发色|头发)/.test(existing) &&
    /(衣|裙|袍|装|服|穿)/.test(existing) &&
    /(配饰|首饰|耳环|项链|手表|背包|眼镜|戒指|发饰)/.test(existing) &&
    /(色|颜色|黑|白|灰|蓝|红|绿|棕|米|金|银)/.test(existing);

  if (richEnough && !clothing && !hair && !body) {
    return existing;
  }

  const parts: string[] = [];
  const name = String(input.name || '').trim();
  if (name) parts.push(name);
  if (age || genderZh !== '未注明') {
    parts.push(`年龄外形必须符合小说设定：${genderZh}${age ? `，约${age}岁` : ''}，禁止擅自改龄`);
  }
  if (era || story) {
    parts.push(
      `年代与题材风格：${[era, story.slice(0, 80)].filter(Boolean).join('；') || '严格按小说时代与世界观'}，服饰发型不得穿越`,
    );
  }
  if (role) parts.push(`身份：${role}`);
  if (personality) parts.push(`气质性格：${personality}`);
  if (body) parts.push(`体型身材：${body}`);
  else if (!/(高矮|胖瘦|身材|体型)/.test(existing)) {
    parts.push('体型身材：按角色年龄与身份写清高矮胖瘦、肩宽与体态');
  }
  if (face) parts.push(`面容五官：${face}`);
  if (hair) parts.push(`发型发色：${hair}`);
  else if (!/(发型|发色|头发)/.test(existing)) {
    parts.push('发型发色：写清长短、分缝、卷直、发质与具体发色（如自然黑/深棕/染灰等）');
  }
  if (clothing) parts.push(`服饰穿搭：${clothing}`);
  else if (!/(衣|裙|袍|装|服|穿)/.test(existing)) {
    parts.push('服饰穿搭：写清款式、层次、面料与主色，必须符合小说年代与人物身份');
  }
  if (special) parts.push(`配饰细节与颜色：${special}`);
  else if (!/(配饰|首饰|耳环|项链|手表|背包|眼镜|戒指|发饰)/.test(existing)) {
    parts.push('配饰细节与颜色：写清眼镜/首饰/包袋/鞋履等可见配饰及各自颜色，无配饰则明确「无额外配饰」');
  }
  if (expression) parts.push(`常驻表情：${expression}`);
  else if (!/(表情|神情|眉眼)/.test(existing)) {
    parts.push('常驻表情：写清眉眼口角与默认神情');
  }
  if (materials) {
    parts.push(`材质与细节：${materials}`);
  } else if (!/(材质|面料|皮质|金属|布料|光泽)/.test(existing)) {
    parts.push('材质细节：写清面料/皮革/金属等可见材质与质感');
  }
  if (backstory) parts.push(`背景故事锚点：${backstory.slice(0, 120)}`);
  parts.push(
    '全身或半身人设图，白底或简洁棚拍，面部清晰，服饰与配饰完整可见，颜色准确，禁止文字水印，禁止擅自年轻化或古装/现代错配',
  );

  const composed = parts.filter(Boolean).join('，');
  if (!existing) return composed;
  if (richEnough) {
    // 补缺维度
    const extras: string[] = [];
    if (age && !/岁|年龄/.test(existing)) extras.push(`年龄：${age}`);
    if (era && !existing.includes(era.slice(0, 6))) extras.push(`年代：${era}`);
    if (body && !existing.includes(body)) extras.push(`体型：${body}`);
    if (hair && !existing.includes(hair.slice(0, 8))) extras.push(`发型发色：${hair}`);
    if (clothing && !existing.includes(clothing.slice(0, 8))) extras.push(`服饰：${clothing}`);
    if (special && !existing.includes(special.slice(0, 8))) extras.push(`配饰：${special}`);
    if (expression && !/(表情|神情)/.test(existing)) extras.push(`表情：${expression}`);
    if (materials && !/(材质|面料)/.test(existing)) extras.push(`材质：${materials}`);
    if (!/(配饰|首饰|耳环|项链|手表|背包|眼镜|戒指|发饰|无额外配饰)/.test(existing)) {
      extras.push('配饰细节与颜色需写清');
    }
    return extras.length ? `${existing}。${extras.join('，')}` : existing;
  }
  // 短稿：结构化稿优先，再拼原文尾巴
  return existing.length < 40 ? composed : `${composed}。补充：${existing}`;
}

export function composeDramaSceneDesignPrompt(input: {
  name?: string;
  location?: string;
  mood?: string;
  time_default?: string;
  weather_default?: string;
  prompt?: string;
  spatial_structure?: string;
  lighting?: string;
  storyContext?: string;
  eraStyle?: string;
  /** 室内 / 室外 / INT / EXT */
  kind?: string;
  architecture?: string;
  materials?: string;
  /** 剧本可核验的陈设硬事实 */
  fixed_elements?: string[];
  /** 为 true 时即使已有 prompt 也强制重拼（用于原文回填后刷新空壳） */
  forceRebuild?: boolean;
}): string {
  const existing = String(input.prompt || '').trim();
  const fixed = (Array.isArray(input.fixed_elements) ? input.fixed_elements : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  const fixedLine = fixed.length ? `陈设硬事实：${fixed.slice(0, 10).join('、')}` : '';
  const kindRaw = String(input.kind || '').trim();
  const kindZh = /ext|外/i.test(kindRaw)
    ? '室外'
    : /int|内/i.test(kindRaw)
      ? '室内'
      : kindRaw;

  const parts: string[] = [];
  const loc = String(input.location || input.name || '').trim();
  if (loc) parts.push(`空场景：${loc}`);
  if (kindZh) parts.push(kindZh);

  const period = inferDramaSceneSettingPeriod(
    loc,
    kindZh,
    fixed.join('、'),
    existing,
    input.spatial_structure,
  );
  const era = String(input.eraStyle || '').trim();
  if (era && isDramaSceneEraCompatible(period, era)) {
    parts.push(`时代/题材：${era}`);
  } else if (period === 'modern') {
    parts.push('时代/题材：当代现代都市室内外（禁止古装仙侠山水地貌渗入）');
  } else if (period === 'ancient') {
    parts.push('时代/题材：古代/传统建筑语境（禁止现代电竞霓虹设备渗入）');
  }

  const story = String(input.storyContext || '').trim();
  if (story && isDramaSceneStoryContextCompatible(period, story)) {
    parts.push(`符合背景故事：${story.slice(0, 120)}`);
  }
  if (input.spatial_structure) parts.push(`空间结构：${input.spatial_structure}`);
  if (input.architecture) parts.push(`建筑：${input.architecture}`);
  if (input.materials) parts.push(`材质：${input.materials}`);
  if (fixedLine) parts.push(fixedLine);
  if (input.time_default) parts.push(`时段：${input.time_default}`);
  if (input.weather_default) parts.push(`天气：${input.weather_default}`);
  if (input.lighting) parts.push(`光影：${input.lighting}`);
  if (input.mood) parts.push(`氛围：${input.mood}`);
  parts.push(
    fixed.length
      ? '无人物，严格按上述陈设还原，写实空场景静帧，禁止空旷棚拍或与地点无关的通用电影感布景'
      : '无人物，写清建筑/家具材质与陈设细节，写实空场景静帧，禁止空旷棚拍感',
  );
  const composed = parts.filter(Boolean).join('，');

  const existingHasProps =
    fixed.some((f) => existing.includes(f.slice(0, Math.min(6, f.length)))) ||
    /陈设硬事实|电竞|显示器|键盘|货架|收银台|香炉|蒲团|霓虹|招牌|茶几|红木|青石|栏杆|床铺|衣柜/.test(
      existing,
    );
  const richEnough =
    !input.forceRebuild &&
    existing.length >= 100 &&
    /无人物|空场景/.test(existing) &&
    existingHasProps;

  if (richEnough) {
    // 已有厚稿：若被全片古风污染且本场是现代，强制重拼
    if (
      period === 'modern' &&
      /(时代\/题材：[^，,]*?(古装|仙侠|玄幻|武侠|汉服|国风|水墨)|符合背景故事：[^。]*?(古装|仙侠|玄幻|武侠))/.test(
        existing,
      )
    ) {
      return composed;
    }
    if (story && isDramaSceneStoryContextCompatible(period, story) && !existing.includes(story.slice(0, 20))) {
      return `${existing}。须符合本剧背景：${story.slice(0, 80)}`;
    }
    if (fixedLine && !/陈设硬事实/.test(existing)) {
      return `${existing}。${fixedLine}`;
    }
    return existing;
  }

  if (!existing || input.forceRebuild) return composed;
  // 旧空壳（地点名+电影感）用新拼装覆盖，仅把旧稿里多出来的具体句尾缀保留
  if (/电影感静帧/.test(existing) && !existingHasProps) return composed;
  if (period === 'modern' && /时代\/题材：[^，,]*?(古装|仙侠|玄幻)/.test(existing)) {
    return composed;
  }
  if (existing.length < 40) return composed;
  return `${composed}。${existing}`;
}

export function composeDramaVoiceDesign(input: {
  name?: string;
  age?: string;
  gender?: string;
  role?: string;
  personality?: string;
  backstory?: string;
  timbre?: string;
  voiceStyle?: string;
  language_style?: string;
  emotion_range?: string;
}): Pick<DramaVoice, 'timbre' | 'voiceStyle' | 'language_style' | 'emotion_range'> {
  const name = String(input.name || '').trim() || '角色';
  const age = String(input.age || '').trim();
  const genderZh = dramaGenderLabel(String(input.gender || ''));
  const role = String(input.role || '').trim();
  const personality = String(input.personality || '').trim();
  const given =
    String(input.timbre || '').trim() ||
    String(input.voiceStyle || '').trim();

  const looksDefault = !given || /默认音色|音色待定|^.{1,8}音色$|配音|写清音高/.test(given);

  const timbre = looksDefault ? composeNaturalTimbreDescription(input) : given;

  const voiceStyle =
    String(input.voiceStyle || '').trim() && !looksDefault
      ? String(input.voiceStyle || '').trim()
      : timbre;

  return {
    timbre,
    voiceStyle,
    language_style:
      String(input.language_style || '').trim() ||
      (personality ? `${personality}口语风格` : ''),
    emotion_range:
      String(input.emotion_range || '').trim() ||
      '平静/压抑/爆发/柔软，按剧情可切换',
  };
}

/** 口语化音色描述（甜美细声细语 / 粗放狂野等），避免 medium/sharp 英文标签 */
function composeNaturalTimbreDescription(input: {
  name?: string;
  age?: string;
  gender?: string;
  role?: string;
  personality?: string;
  timbre?: string;
  voiceStyle?: string;
}): string {
  const given = String(input.timbre || input.voiceStyle || '').trim();
  if (given && !/默认音色|音色待定|配音|写清音高|medium|sharp|pragmatic/i.test(given)) {
    return given;
  }
  const age = String(input.age || '').trim();
  const genderZh = dramaGenderLabel(String(input.gender || ''));
  const role = String(input.role || '').trim();
  const personality = String(input.personality || '').trim();
  const bag = `${role}${personality}${String(input.name || '')}`;

  let color = '';
  if (/甜美|温柔|软萌|娇|细声/.test(bag) || (/女/.test(genderZh) && /配|龙套|姑娘|小姐/.test(bag))) {
    color = '甜美细声细语，嗓音偏软偏细，说话轻缓';
  } else if (/狂野|粗犷|暴躁|凶|匪|硬汉|冲/.test(bag)) {
    color = '粗放狂野，嗓音偏沉偏沙，说话冲直';
  } else if (/克制|冷静|冷峻|沉稳|寡言/.test(bag)) {
    color = '沉稳克制，音色偏干净，语速不急，句尾自然下沉';
  } else if (/活泼|跳脱|机灵|俏皮/.test(bag)) {
    color = '轻快活泼，音色清亮，咬字干脆';
  } else if (/老|苍|暮年|说书/.test(bag) || (/[6-9]\d|老/.test(age) && age)) {
    color = '年长感明显，音色略沙略厚，说话稳而缓';
  } else if (/女/.test(genderZh)) {
    color = '女声偏柔，音色清晰，说话自然不夸张';
  } else if (/男/.test(genderZh)) {
    color = '男声偏实，音色中正，说话干净有力';
  } else {
    color = '音色自然清晰，不尖不破，近距离听感舒服';
  }

  const who = [
    age ? `约${age}岁` : '',
    genderZh !== '未注明' ? `${genderZh}声` : '',
  ]
    .filter(Boolean)
    .join('');
  return who ? `${who}，${color}` : color;
}

/**
 * 声音提示词固定口型约束（分析稿与卡片展示共用）。
 */
export const DRAMA_VOICE_PROMPT_LIPSYNC =
  '人物开口必须与台词逐字同步，停顿位置与省略号、标点对应。';

const DRAMA_VOICE_PROMPT_SECTION_RE = /音色(描述)?\s*[：:]/;
const DRAMA_VOICE_PROMPT_LINE_RE = /台词\s*[：:]/;

/** 旧版生硬结构（情绪/语速/音量/呼吸分条），需升级成口语化提示词 */
export function isDramaVoiceSampleTextLegacyStiff(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  const stiffMarks =
    Number(/情绪\s*[：:]/.test(t)) +
    Number(/语速\s*[：:]/.test(t)) +
    Number(/音量\s*[：:]/.test(t)) +
    Number(/呼吸\s*[：:]/.test(t)) +
    Number(/语气\s*[：:]/.test(t)) +
    Number(/口型\s*[：:]/.test(t));
  return stiffMarks >= 3 || /\b(medium|sharp|pragmatic)\b/i.test(t);
}

/**
 * 从声音提示词里抽出真正送给 TTS 的台词。
 * 有「台词：」段落则只取该段；否则把整段当对白（兼容旧数据）。
 */
export function extractDramaVoiceSpokenText(prompt: string): string {
  const t = String(prompt || '').trim();
  if (!t) return '';
  const m = t.match(/台词\s*[：:]\s*([\s\S]*?)(?=\n\s*口型\s*[：:]|$)/i);
  let spoken = (m ? m[1] : DRAMA_VOICE_PROMPT_SECTION_RE.test(t) ? '' : t).trim();
  spoken = spoken
    .replace(/^[「『“"']+/gm, '')
    .replace(/[」』”"']+$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  return spoken;
}

/**
 * 造样/试听台词：只允许剧本/小说原文；禁止按身份乱编。
 */
export function countDramaVoiceSampleSentences(text: string): number {
  const t = extractDramaVoiceSpokenText(text) || String(text || '').trim();
  if (!t) return 0;
  if (/剧本中暂无该角色对白|请从小说中选取/.test(t)) return 0;
  const parts = t
    .split(/(?<=[。！？!?…])\s*|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2 && !/剧本中暂无该角色对白|请从小说中选取/.test(x));
  return parts.length || (t.length >= 4 ? 1 : 0);
}

/** 声音提示词是否齐：名字/年龄性别 + 音色描述 + 可念台词（旧生硬结构视为未齐，便于升级） */
export function isDramaVoiceSampleTextRichEnough(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isDramaVoiceSampleTextLegacyStiff(t)) return false;
  const hasTimbre = DRAMA_VOICE_PROMPT_SECTION_RE.test(t);
  const hasLines = DRAMA_VOICE_PROMPT_LINE_RE.test(t);
  const hasAgeGender = /年龄\s*[：:]/.test(t) && /性别\s*[：:]/.test(t);
  if (!(hasTimbre || hasAgeGender) || !hasLines) return false;
  const spoken = extractDramaVoiceSpokenText(t);
  if (/剧本中暂无该角色对白|请从小说中选取/.test(spoken)) return false;
  return spoken.length >= 4;
}

function joinSampleSentences(lines: string[], max = 3): string {
  const out: string[] = [];
  for (const raw of lines) {
    const s = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) continue;
    if (/剧本中暂无该角色对白|请从小说中选取/.test(s)) continue;
    // 一行里若已有多句，拆开再收
    const bits = s
      .split(/(?<=[。！？!?…])\s*/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2);
    for (const b of bits.length ? bits : [s]) {
      if (out.includes(b)) continue;
      out.push(/[。！？!?…]$/.test(b) ? b : `${b}。`);
      if (out.length >= max) return out.join('\n');
    }
  }
  return out.join('\n');
}

const ABSTRACT_PAREN_BODY_RE =
  /^(?:紧张|压抑|愤怒|悲伤|恐惧|疑惑|冷漠|震惊|释然|克制|沉默|开心|兴奋|绝望|孤独|疲惫|困倦|轻松|慵懒|机械|懵逼|无奈|困惑|迷茫|失落|决心|怀疑|专注|确认|平静|低声)(?:[、，,].*)?$/;

function isParenStageDirectionLine(line: string): boolean {
  const m = String(line || '')
    .trim()
    .match(/^[（(]([^）)]{0,40})[）)]$/u);
  if (!m) return false;
  const body = String(m[1] || '')
    .replace(/[。．.!！?？]+$/g, '')
    .trim();
  if (!body) return true;
  if (ABSTRACT_PAREN_BODY_RE.test(body)) return true;
  // 任意独占括注行（舞台说明）都不进 <d>
  return true;
}

function isBareSpeakerNameLine(line: string, knownNames: Set<string>): boolean {
  const bare = String(line || '')
    .replace(/[。．.\s：:]+$/g, '')
    .trim();
  if (!bare || bare.length > 16) return false;
  if (knownNames.has(bare)) return true;
  if (knownNames.size) return false;
  // 无名单时：短中文独占行，且后文仍有内容时视为说话人标签
  return /^[\u4e00-\u9fffA-Za-z·•]{1,12}$/u.test(bare);
}

/**
 * 剥离说话人标注 / 括注舞台说明，只留可念正文。
 * 用于试听句、TE.dialogue、以及进入 <d> 前的最终清洗。
 * knownNames：本镜角色名；有则更稳地剥「名独占行」。
 */
export function stripDramaSpokenLineBody(raw: string, knownNames?: string[]): string {
  let t = String(raw || '').trim();
  if (!t) return '';
  const nameSet = new Set(
    (knownNames || []).map((n) => String(n || '').trim()).filter(Boolean),
  );
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^【[^】]*】\s*$/u.test(line)) {
      i += 1;
      continue;
    }
    if (
      /^(?:系统提示音|系统声音|系统提示|系统播报|系统音|系统|旁白|画外音|SYSTEM)\s*(?:[（(][^)）]*[)）])?\s*[:：.。]?\s*$/iu.test(
        line,
      )
    ) {
      i += 1;
      continue;
    }
    const colon = line.match(
      /^([\u4e00-\u9fffA-Za-z·•]{1,16})\s*(?:[（(][^)）]*[)）])?\s*[:：]\s*(.*)$/u,
    );
    if (colon) {
      const name = colon[1];
      const body = String(colon[2] || '').trim();
      if (!nameSet.size || nameSet.has(name)) {
        if (body) {
          lines[i] = body;
          break;
        }
        i += 1;
        continue;
      }
    }
    if (i < lines.length - 1 && isBareSpeakerNameLine(line, nameSet)) {
      i += 1;
      continue;
    }
    if (i < lines.length - 1 && isParenStageDirectionLine(line)) {
      i += 1;
      continue;
    }
    if (i === lines.length - 1 && isParenStageDirectionLine(line)) {
      // 仅剩括注 → 无可念正文
      return '';
    }
    break;
  }
  t = lines.slice(i).join('\n').trim();
  t = t.replace(/^【[^】]*】\s*/u, '');
  t = t.replace(
    /^(?:系统提示音|系统声音|系统提示|系统播报|系统音|系统|旁白|画外音|SYSTEM)\s*(?:[（(][^)）]*[)）])?\s*[:：.。]\s*/iu,
    '',
  );
  t = t.replace(/^[\u4e00-\u9fffA-Za-z·•]{1,16}\s*(?:[（(][^)）]*[)）])?\s*[:：]\s*/u, '');
  // 行首抽象括注（同一行：「（慵懒）家人们」）
  t = t.replace(/^[（(][^）)]{0,24}[）)]\s*/u, '');
  t = t.replace(/^[「『“"']+|[」』”"']+$/g, '').trim();
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * 试听台词：只取 dialogueHint 中的剧本原文；没有则返回空。
 * 禁止按身份/性格模板乱编句子。
 */
export function composeDramaVoiceSpokenLines(input: {
  name?: string;
  role?: string;
  identity?: string;
  personality?: string;
  gender?: string;
  dialogueHint?: string;
}): string {
  const hintRaw = String(input.dialogueHint || '').trim();
  if (!hintRaw) return '';
  const hint = extractDramaVoiceSpokenText(hintRaw) || hintRaw;
  const lines = hint
    .split(/\n+/)
    .map((l) => stripDramaSpokenLineBody(l))
    .filter((l) => l.length >= 2);
  return joinSampleSentences(lines.length ? lines : [stripDramaSpokenLineBody(hint)], 3);
}

export const DRAMA_VOICE_SAMPLE_NO_SCRIPT_LINE =
  '（剧本中暂无该角色对白，请从小说中选取一句原文填入）';

function looksEmptyTimbre(s: string): boolean {
  const t = String(s || '').trim();
  return !t || /默认音色|音色待定|^.{1,8}音色$|配音|写清音高|medium|sharp|pragmatic/i.test(t);
}

/**
 * 声音提示词：名字 + 年龄 + 性别 + 口语化音色描述 + 剧本原文台词。
 * 台词必须来自小说/剧本；没有则写占位，禁止乱编。
 */
export function composeDramaVoiceSampleLine(input: {
  name?: string;
  age?: string;
  role?: string;
  identity?: string;
  personality?: string;
  gender?: string;
  timbre?: string;
  voiceStyle?: string;
  language_style?: string;
  emotion_range?: string;
  dialogueHint?: string;
  /** 为 true 时即使旧稿已「够长」也用 dialogueHint 重写台词段 */
  forceScriptLines?: boolean;
}): string {
  const existing = String(input.dialogueHint || '').trim();
  if (!input.forceScriptLines && isDramaVoiceSampleTextRichEnough(existing)) {
    return existing;
  }

  const name = String(input.name || '').trim() || '未命名角色';
  const designed = composeDramaVoiceDesign({
    name,
    age: input.age,
    gender: input.gender,
    role: input.role || input.identity,
    personality: input.personality,
    timbre: input.timbre,
    voiceStyle: input.voiceStyle,
    language_style: input.language_style,
    emotion_range: input.emotion_range,
  });
  const spoken = composeDramaVoiceSpokenLines(input);
  const age = String(input.age || '').trim();
  const genderZh = dramaGenderLabel(String(input.gender || ''));

  const timbre = looksEmptyTimbre(designed.timbre)
    ? composeNaturalTimbreDescription(input)
    : designed.timbre;

  if (input.forceScriptLines && /音色(描述)?\s*[：:]/.test(existing) && /台词\s*[：:]/.test(existing)) {
    const head = existing.replace(/\n?\s*台词\s*[：:][\s\S]*$/i, '').trim();
    return `${head}\n台词：\n${spoken || DRAMA_VOICE_SAMPLE_NO_SCRIPT_LINE}`;
  }

  const ageLine = age ? (/\d/.test(age) && !/岁/.test(age) ? `${age}岁` : age) : '未注明';
  const genderLine = genderZh !== '未注明' ? genderZh : '未注明';

  return [
    name,
    `年龄：${ageLine}`,
    `性别：${genderLine}`,
    `音色描述：${timbre}`,
    '台词：',
    spoken || DRAMA_VOICE_SAMPLE_NO_SCRIPT_LINE,
  ].join('\n');
}

export function enrichDramaCharacterDesignFields(
  character: DramaCharacter,
  opts?: { storyContext?: string; eraStyle?: string },
): DramaCharacter {
  const storyBits = [opts?.storyContext, opts?.eraStyle, character.backstory]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join('；');
  const prompt = composeDramaCharacterDesignPrompt({
    name: character.name,
    age: character.age,
    gender: character.gender,
    role: character.role,
    identity: character.identity,
    personality: character.personality,
    backstory: character.backstory,
    prompt: character.prompt,
    visual: character.visual,
    expression: character.states?.normal,
    storyContext: storyBits,
    eraStyle: opts?.eraStyle,
  });
  return { ...character, prompt };
}
