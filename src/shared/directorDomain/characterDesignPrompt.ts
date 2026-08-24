/**
 * 人物/场景设计提示词：贴合背景故事，写清形象与音色字段。
 */

import type { DramaCharacter, DramaCharacterVisualLock, DramaVoice } from './types.js';

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

  // 已足够详细则保留，仅在缺关键维度时追加
  const richEnough =
    existing.length >= 120 &&
    /岁|年龄/.test(existing) &&
    /(男|女|性别)/.test(existing) &&
    /(发型|发色|头发)/.test(existing) &&
    /(衣|裙|袍|装|服|穿)/.test(existing);

  if (richEnough && !clothing && !hair && !body) {
    return existing;
  }

  const parts: string[] = [];
  const name = String(input.name || '').trim();
  if (name) parts.push(name);
  if (age || genderZh !== '未注明') {
    parts.push(`${genderZh}${age ? `，${age}岁` : ''}`);
  }
  if (role) parts.push(`身份：${role}`);
  if (personality) parts.push(`气质性格：${personality}`);
  if (body) parts.push(`体型身材：${body}`);
  else if (!/(高矮|胖瘦|身材|体型)/.test(existing)) {
    parts.push('体型身材：按角色身份写清高矮胖瘦与肩宽比例');
  }
  if (face) parts.push(`面容五官：${face}`);
  if (hair) parts.push(`发型发色：${hair}`);
  else if (!/(发型|发色|头发)/.test(existing)) {
    parts.push('发型发色：写清长短、分缝、发质与颜色');
  }
  if (clothing) parts.push(`服饰穿搭：${clothing}`);
  else if (!/(衣|裙|袍|装|服|穿)/.test(existing)) {
    parts.push('服饰穿搭：写清款式、层次、配饰与时代/题材锁');
  }
  if (expression) parts.push(`常驻表情：${expression}`);
  else if (!/(表情|神情|眉眼)/.test(existing)) {
    parts.push('常驻表情：写清眉眼口角与默认神情');
  }
  if (materials || special) {
    parts.push(`材质与细节：${[materials, special].filter(Boolean).join('；')}`);
  } else if (!/(材质|面料|皮质|金属|布料|光泽)/.test(existing)) {
    parts.push('材质细节：写清面料/皮革/金属等可见材质与质感');
  }
  if (backstory) parts.push(`背景故事锚点：${backstory.slice(0, 120)}`);
  if (story) parts.push(`须符合本剧世界观：${story.slice(0, 100)}`);
  parts.push('全身或半身人设图，白底或简洁棚拍，面部清晰，服饰完整可见，禁止文字水印');

  const composed = parts.filter(Boolean).join('，');
  if (!existing) return composed;
  if (richEnough) {
    // 补缺维度
    const extras: string[] = [];
    if (body && !existing.includes(body)) extras.push(`体型：${body}`);
    if (hair && !existing.includes(hair.slice(0, 8))) extras.push(`发型发色：${hair}`);
    if (clothing && !existing.includes(clothing.slice(0, 8))) extras.push(`服饰：${clothing}`);
    if (expression && !/(表情|神情)/.test(existing)) extras.push(`表情：${expression}`);
    if (materials && !/(材质|面料)/.test(existing)) extras.push(`材质：${materials}`);
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
}): string {
  const existing = String(input.prompt || '').trim();
  const parts: string[] = [];
  const loc = String(input.location || input.name || '').trim();
  if (loc) parts.push(`空场景：${loc}`);
  if (input.eraStyle) parts.push(`时代/题材：${input.eraStyle}`);
  if (input.storyContext) parts.push(`符合背景故事：${String(input.storyContext).slice(0, 120)}`);
  if (input.spatial_structure) parts.push(`空间结构：${input.spatial_structure}`);
  if (input.time_default) parts.push(`时段：${input.time_default}`);
  if (input.weather_default) parts.push(`天气：${input.weather_default}`);
  if (input.lighting) parts.push(`光影：${input.lighting}`);
  if (input.mood) parts.push(`氛围：${input.mood}`);
  parts.push('无人物，写清建筑/家具材质与陈设细节，电影感静帧');
  const composed = parts.filter(Boolean).join('，');
  if (!existing) return composed;
  if (existing.length >= 80 && /无人物|空场景/.test(existing)) {
    if (input.storyContext && !existing.includes(String(input.storyContext).slice(0, 20))) {
      return `${existing}。须符合本剧背景：${String(input.storyContext).slice(0, 80)}`;
    }
    return existing;
  }
  return existing.length < 40 ? composed : `${composed}。${existing}`;
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
 * 造样/试听台词：优先剧本对白 2～3 句；不足再按身份补全。
 */
export function countDramaVoiceSampleSentences(text: string): number {
  const t = extractDramaVoiceSpokenText(text) || String(text || '').trim();
  if (!t) return 0;
  const parts = t
    .split(/(?<=[。！？!?…])\s*|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
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
  return spoken.length >= 8;
}

function joinSampleSentences(lines: string[], max = 3): string {
  const out: string[] = [];
  for (const raw of lines) {
    const s = String(raw || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!s) continue;
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

function composeDramaVoiceSpokenLines(input: {
  name?: string;
  role?: string;
  identity?: string;
  personality?: string;
  gender?: string;
  dialogueHint?: string;
}): string {
  const hint = extractDramaVoiceSpokenText(String(input.dialogueHint || ''))
    .replace(/\s+/g, ' ')
    .trim();
  const fromHint = hint ? joinSampleSentences([hint], 3) : '';

  const name = String(input.name || '').trim() || '此人';
  const role = String(input.role || '').trim();
  const identity = String(input.identity || '').trim();
  const personality = String(input.personality || '').trim();
  const bag = `${name}${role}${identity}${personality}`;
  const genderZh = dramaGenderLabel(String(input.gender || ''));

  let template: string[] = [];

  if (/说书|说书人|旁白叙述/.test(bag)) {
    template = [
      '且听我细细道来。',
      '这一回，却有一段不为人知的往事。',
      '矿灯摇曳，人心也跟着摇曳。',
      '诸位且看：祸事，是怎么一步步逼近的。',
    ];
  } else if (/读书人|读书人VO|神秘|VO|画外|旁白/.test(bag)) {
    template = [
      '夜色压在矿道口，风像刀子。',
      '有人还在赌命，有人已经开始算计。',
      '名字不重要，重要的是——谁先松口。',
      '听好了：接下来的每一句，都可能改写结局。',
    ];
  } else if (/响应控制众|控制众|众甲|众乙|群众|起哄/.test(bag)) {
    template = [
      '听见没有？都给我听清楚！',
      '谁敢乱动，别怪咱们不客气。',
      '把路让开！别挡事！',
      '走！跟上！别掉队！',
    ];
  } else if (/看门|门卫|门房/.test(bag)) {
    template = [
      '站住！什么人？',
      '此乃重地，闲人免进！',
      '把证件拿出来，别磨蹭。',
      '再不老实，就别怪我不客气。',
    ];
  } else if (/护卫|侍卫|卫兵|矿护/.test(bag)) {
    template = [
      '前方戒严，闲杂人等不得靠近！',
      '把手放看得见的地方。',
      '再往前一步，后果自负。',
      '把他们看住，谁也不许乱跑。',
    ];
  } else if (/协拍|拍干|工头|管事|矿协/.test(bag)) {
    template = [
      '都听好了，今晚的班不能乱。',
      '矿里的规矩，谁坏谁负责。',
      '该签字的签字，该闭嘴的闭嘴。',
      '别跟我扯闲话，赶紧把活干完。',
    ];
  } else if (/龙套|甲|乙|路人|仆人|家丁|边缘/.test(bag)) {
    template = [
      '是，马上去办！',
      '主人吩咐的事，不敢有误。',
      '我什么都没看见，也什么都没听见。',
      '您慢走，我这就去传话。',
    ];
  } else if (
    /女人|姑娘|小姐/.test(name) ||
    (/女/.test(genderZh) && /配|龙套|出场/.test(role + identity))
  ) {
    template = [
      '你先别急，听我说完。',
      '这里不干净，今晚别再往深处走。',
      '我不是吓你，我是在救你。',
      '答应我，天亮之前回来。',
    ];
  } else if (/巴洛|安妮|汤米|查理|主角|男主|女主/.test(bag) || /男主|女主/.test(role)) {
    template = [
      '我不会退缩。该来的，总会来。',
      '你们要的答案，我心里清楚。',
      '别再用规矩压我，规矩救不了人。',
      '跟我走。这一次，必须把话说开。',
    ];
  } else if (/书生|文人|夫子|学者|先生|顾炎武/.test(bag)) {
    template = [
      '天下兴亡，匹夫有责。',
      '今日之事，我记下了。',
      '嘴上的义气不值钱，手上的选择才值钱。',
      '若你们还讲道理，就听我说完这几句。',
    ];
  } else if (/出场人物|出场角色/.test(bag)) {
    template = [
      '我来了。有话就说，别绕弯子。',
      '这地方我熟，别拿我当外人。',
      '谁先动手，谁就先承担后果。',
      '走吧。磨叽下去，只会更糟。',
    ];
  } else if (personality) {
    template = [
      `${name}在此。`,
      `${personality}也好，这一遭我认了。`,
      '别再试探我，话我只说一遍。',
      '该做的事，今晚就做完。',
    ];
  } else {
    template = [
      `${name}在此。`,
      '今日之事，我记住了。',
      '你们想听真话，还是想听好听的？',
      '跟紧点。耽误不起。',
    ];
  }

  if (fromHint && countDramaVoiceSampleSentences(fromHint) >= 2) {
    return joinSampleSentences([fromHint], 3);
  }
  const merged = joinSampleSentences([fromHint, ...template], 3);
  if (countDramaVoiceSampleSentences(merged) >= 2) return merged;
  return joinSampleSentences(template, 3);
}

function looksEmptyTimbre(s: string): boolean {
  const t = String(s || '').trim();
  return !t || /默认音色|音色待定|^.{1,8}音色$|配音|写清音高|medium|sharp|pragmatic/i.test(t);
}

/**
 * 声音提示词：名字 + 年龄 + 性别 + 口语化音色描述 + 剧本 2～3 句台词。
 * 卡片展示与剧本分析共用；送 TTS 时整段交给豆包（模型自行区分描述与台词）。
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
}): string {
  const existing = String(input.dialogueHint || '').trim();
  if (isDramaVoiceSampleTextRichEnough(existing)) {
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

  const ageLine = age ? (/\d/.test(age) && !/岁/.test(age) ? `${age}岁` : age) : '未注明';
  const genderLine = genderZh !== '未注明' ? genderZh : '未注明';
  const spokenBlock = spoken
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[「『“"']+|[」』”"']+$/g, '').trim())
    .filter(Boolean)
    .join('\n');

  return [
    name,
    `年龄：${ageLine}`,
    `性别：${genderLine}`,
    `音色描述：${timbre}`,
    '台词：',
    spokenBlock || `${name}在此。`,
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
  });
  return { ...character, prompt };
}
