/**
 * 从剧本文本启发式提取出场人名（程序规则，不走 LLM）。
 * 不做「创造」：只识别正文里已开口的说话人/称呼。
 */

export const STOP_NAMES = new Set(
  [
    '旁白',
    '画外音',
    'os',
    'OS',
    '内心',
    '众人',
    '全场',
    '系统',
    '字幕',
    '音效',
    '音乐',
    '镜头',
    '画面',
    '场景',
    '切至',
    '淡入',
    '淡出',
    '内',
    '外',
    '日',
    '夜',
    '晨',
    '晚',
    '小字',
    '水印',
    '标题',
    '角色',
    '人物',
    '主角',
    '配角',
    '演员',
    '路人',
    '有人',
    '大家',
    '三人',
    '两人',
    '一人',
    '动作',
    '对白',
    '旁述',
    '叙述',
    '系统提示',
    '系统提示音',
    '系统声音',
    '系统播报',
    '系统音',
    '电子音',
    '电子声音',
    '机械音',
    '机械声音',
    '机械提示音',
    '机械女声',
    'system',
    'SYSTEM',
    '广播',
    '播报',
    '弹幕',
    '弹幕浮字',
    '蒙太奇',
    '快速蒙太奇',
    '特效',
    '技能',
    '商城',
    '血条',
    '峡谷',
    '山门',
    '会场',
    '直播间',
    '开场',
    '转场',
    '内景',
    '外景',
  ].map((s) => s.toLowerCase()),
);

const SYSTEM_SPEAKER_NAME_RE =
  /^(?:系统提示音|系统声音|系统提示|系统播报|系统音|系统|机械提示音|机械声音|机械女声|机械音|电子声音|电子音|旁白|画外音|system(?:[_\s-]?voice)?)$/i;

/** 判断名字是否属于非人物说话者（系统/旁白/画外音等），需独立 speaker 不抢角色音色 */
export function isSystemSpeakerName(raw: string): boolean {
  const n = String(raw || '').trim().toLowerCase();
  if (!n) return false;
  if (STOP_NAMES.has(n)) return true;
  if (SYSTEM_SPEAKER_NAME_RE.test(n)) return true;
  return /系统提示|系统音|旁白|画外音/.test(n);
}

/** 小说场次过渡（切至/淡入），不是系统语音。 */
export function isDramaSceneTransitionText(raw: string): boolean {
  const t = String(raw || '').trim();
  if (!t) return false;
  if (/^【\s*转\s*】/.test(t) && /切至|淡入|淡出/.test(t)) return true;
  if (/^(?:切至|淡入|淡出)/.test(t)) return true;
  return /^(?:CUT\s*TO|FADE\s*(?:IN|OUT))\b/i.test(t);
}

/** 真正会开口的系统/旁白名；切至等过渡词不算。 */
export function isDramaSystemSpeechSpeaker(raw: string): boolean {
  const n = String(raw || '').trim();
  if (!n || isDramaSceneTransitionText(n) || isDramaSceneTransitionText(`${n}：`)) return false;
  return SYSTEM_SPEAKER_NAME_RE.test(n) || /^(?:旁白|画外音)$/i.test(n);
}

/**
 * 脑海中的系统/机械播报。单写「脑海中」不是系统；
 * 「心想 / 内心 OS」也不是系统。
 */
export function looksLikeDramaInMindSystemVoice(raw: string): boolean {
  const t = String(raw || '').trim();
  if (!t) return false;
  if (/(?:心想|心里想|暗想|内心\s*OS|内心独白|心声)/.test(t) && !/(?:机械|系统|电子)/.test(t)) {
    return false;
  }
  return /(?:脑海中|意识中)响起.{0,20}(?:机械|系统|电子)|响起一道?(?:机械|系统|电子)(?:声音|提示音|女声)?/.test(
    t,
  );
}

const SYSTEM_SPOKEN_LABEL_RE =
  /^(?:【\s*(?:系统|SYSTEM)[^】]*】|(?:系统提示音|系统声音|系统提示|系统播报|系统音|系统|SYSTEM|System|机械声音|电子声音|机械提示音|机械女声)\s*[:：.。】])/i;

/** 系统播报/商城语音：应进 <d>，不得当画面字。人物台词里提到「系统」不算。 */
export function looksLikeDramaSystemSpokenText(raw: string): boolean {
  const t = String(raw || '').trim();
  if (!t) return false;
  if (isDramaSceneTransitionText(t)) return false;
  if (SYSTEM_SPOKEN_LABEL_RE.test(t)) return true;
  if (/^【\s*系统/.test(t)) return true;
  if (/^新手引导\s*[：:]/.test(t)) return true;
  if (looksLikeDramaInMindSystemVoice(t)) return true;
  if (/叮——/.test(t) && /(?:系统|激活|金币|英雄|宿主|检测)/.test(t)) return true;
  if (/(?:当前金币|无法购买任何英雄|可任意携带一位英雄|QWER四技能|更换英雄需冷却)/.test(t)) {
    return true;
  }
  if (/是的[。.]宿主/.test(t)) return true;
  return false;
}

const SYSTEM_LABEL_NAMES =
  '系统提示音|系统声音|系统提示|系统播报|系统音|系统|SYSTEM|System|机械声音|电子声音|机械提示音|机械女声';

/** 系统声 <d> 只保留台词；不剥人物对白里的「系统」。 */
export function stripDramaSystemSpokenLabel(raw: string): string {
  let t = String(raw || '').trim();
  if (!t) return '';
  t = t.replace(/^(?:【\s*(?:系统|SYSTEM)[^】]*】\s*)+/iu, '');
  t = t.replace(new RegExp(`^(?:${SYSTEM_LABEL_NAMES})\\s*[:：.。]\\s*`, 'i'), '');
  t = t.replace(new RegExp(`^(?:${SYSTEM_LABEL_NAMES})\\s*[\\r\\n]+`, 'i'), '');
  t = t.trim();
  if (new RegExp(`^(?:${SYSTEM_LABEL_NAMES})$`, 'i').test(t)) return '';
  return t;
}

const NON_VISUAL_EYELINE_RE =
  /^(?:脑海中|意识中|脑海|意识空间|机械提示|系统提示|系统声音|机械女声|自己|周围|周围环境|房间|这里|那里|思绪|内心|镜头(?:前|里|中)?)$/i;

/** 场景容器名当视线不可靠；山/门外等可视地点不走这条。 */
const SETTING_SCENE_EYELINE_RE = /(?:直播间|房间|室内|大厅|片场|舞台|工作室|卧室|客厅|走廊|办公室)$/;

export function isNonVisualDramaEyeline(raw: string, sceneNames: string[] = []): boolean {
  const t = String(raw || '').trim().replace(/[。．.]+$/g, '');
  if (!t) return true;
  if (NON_VISUAL_EYELINE_RE.test(t)) return true;
  if (/^(?:the\s+)?(?:camera|viewer|lens|audience)$/i.test(t)) return true;
  if (/(?:脑海中|意识中|意识空间|机械提示|系统提示|系统声音)/.test(t) && t.length <= 16) {
    return true;
  }
  if (SETTING_SCENE_EYELINE_RE.test(t) && t.length <= 16) return true;
  const compact = t.replace(/\s+/g, '');
  if (
    sceneNames.some((name) => {
      const n = String(name || '').trim().replace(/\s+/g, '');
      return !!n && (compact === n || t === name) && SETTING_SCENE_EYELINE_RE.test(n);
    })
  ) {
    return true;
  }
  return false;
}

export function isDramaScreenTextVisual(raw: string): boolean {
  const t = String(raw || '').trim();
  if (!t) return false;
  if (isDramaSceneTransitionText(t) || looksLikeDramaSystemSpokenText(t)) return false;
  if (isDramaNarrationVisual(t)) return false;
  if (/^【\s*(?:弹幕|字幕|浮字|标题|屏幕文字|UI文字)/.test(t)) return true;
  if (/^(?:弹幕浮字|弹幕|屏幕文字|浮字|字幕|标题|UI文字)\s*[:：]/.test(t)) return true;
  if (/^(?:弹幕浮字|弹幕|屏幕文字|浮字|字幕|标题|UI文字)$/.test(t)) return true;
  if (/^【[^】]{0,80}】$/.test(t) && /(?:弹幕|浮字|字幕|标题|屏幕文字|UI文字)/.test(t)) {
    return true;
  }
  const stripped = stripDramaScreenTextFromVisual(t);
  return !stripped && /弹幕|浮字|字幕|屏幕文字|UI文字|标题/.test(t);
}

export function stripDramaScreenTextFromVisual(raw: string): string {
  const t = String(raw || '')
    .replace(/【\s*(?:弹幕浮字|弹幕|字幕|浮字|标题|屏幕文字|UI文字)[^】]*】/g, '')
    .replace(/(?:弹幕浮字|屏幕文字|UI文字)\s*[:：][^\n]*/g, '')
    .replace(/弹幕[^，。；;\n]*/g, '')
    .replace(/[，、；;]{2,}/g, '，')
    .replace(/[。.]{2,}/g, '。')
    .replace(/^[，、。.\s]+|[，、。.\s]+$/g, '')
    .trim();
  return t;
}

/** 从【弹幕浮字：A／B】抽出条目（供 TE→Prompt 画屏字） */
export function parseDramaScreenOverlayItems(raw: string): string[] {
  const t = String(raw || '').trim();
  if (!t) return [];
  const m =
    t.match(/【\s*(?:弹幕浮字|弹幕|字幕|浮字|屏幕文字|UI文字)\s*[：:]\s*([^】]*)】/) ||
    t.match(/(?:弹幕浮字|弹幕|屏幕文字|UI文字)\s*[：:]\s*(.+)$/);
  const body = String(m?.[1] || '').trim();
  if (!body) return [];
  return body
    .split(/[／/|｜]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 专段弹幕/屏字 → 中文镜头稿（保留原文条目） */
export function formatDramaScreenOverlayZh(raw: string): string {
  const items = parseDramaScreenOverlayItems(raw);
  if (!items.length) {
    return isDramaScreenTextVisual(raw) ? '屏幕上弹出直播弹幕浮字。' : '';
  }
  return `屏幕弹幕浮字依次闪过：${items.map((x) => `「${x}」`).join('／')}。`;
}

/** 专段弹幕/屏字 → 英文 H3（条目可保留中文，作为画面字） */
export function formatDramaScreenOverlayEn(raw: string): string {
  const items = parseDramaScreenOverlayItems(raw);
  if (!items.length) {
    return isDramaScreenTextVisual(raw)
      ? 'On-screen live-stream comment overlay scrolls across the display.'
      : '';
  }
  return `On-screen live-stream comment overlay scrolls: ${items.map((x) => `"${x}"`).join(' / ')}.`;
}

export function isDramaNarrationVisual(raw: string): boolean {
  const t = String(raw || '').trim();
  if (!t) return false;
  if (isDramaSceneTransitionText(t)) return false;
  if (/^【\s*旁白/.test(t)) return true;
  if (/^(?:旁白|画外音)\s*[:：.。，,]/.test(t)) return true;
  return false;
}

export function stripDramaNarrationLabel(raw: string): string {
  let t = String(raw || '').trim();
  if (!t) return '';
  t = t.replace(/^【\s*旁白[^】]*】\s*[,，:：.。]?\s*/u, '');
  t = t.replace(/^(?:旁白|画外音)\s*[:：.。，,]\s*/u, '');
  return t.trim();
}

export function stripDramaNarrationFromVisual(raw: string): string {
  const t = String(raw || '')
    .replace(/【\s*旁白[^】]*】\s*[,，:：.。]?\s*[^，。；;\n]*/g, '')
    .replace(/(?:^|[。\n])\s*(?:旁白|画外音)\s*[:：.。，,][^\n]*/g, '')
    .replace(/[，、；;]{2,}/g, '，')
    .replace(/[。.]{2,}/g, '。')
    .replace(/^[，、。.\s]+|[，、。.\s]+$/g, '')
    .trim();
  return t;
}

export function isDramaInnerOsCue(raw: string): boolean {
  const t = String(raw || '').trim();
  if (!t) return false;
  if (looksLikeDramaInMindSystemVoice(t) || looksLikeDramaSystemSpokenText(t)) return false;
  return /内心\s*OS|内心独白|心声|心想|心里想|暗想|(?:^|[（(【\s])(?:OS|VO)(?:[）)】\s:,：]|$)/i.test(
    t,
  );
}

const INNER_OS_PHYSICAL_RE = /坐|站|走|看|拿|靠|睁|躺|跪|跑|转身|抬头|低头|蹲/;

export function stripDramaInnerOsFromVisual(raw: string): string {
  const source = String(raw || '').trim();
  const t = source
    .replace(/[（(【]\s*内心\s*OS[^）)】]*[）)】]/gi, '')
    .replace(/内心\s*OS\s*[:：]?/gi, '')
    .replace(/内心独白\s*[:：][^\n]*/g, '')
    .replace(/心声\s*[:：][^\n]*/g, '')
    .replace(/^[，、。.\s]+|[，、。.\s]+$/g, '')
    .trim();
  if (isDramaInnerOsCue(source) && t && !INNER_OS_PHYSICAL_RE.test(t)) return '';
  return t;
}

const DIRECTOR_LENS_TAG_RE =
  /(?:背影|正面|特写|近景|中景|全景|俯拍|仰拍)镜头|镜头切到|镜头转向|镜头拉近|镜头推进/g;

/** 切段去重后加的景别/站位导演词（非小说原文），一律剥离，导演权交给后续 Skill */
const AI_COVERAGE_BRACKET_RE =
  /【(?:全景交代人物与环境位置|中景看肢体与站位|近景看面部与眼神|(?:全景交代|中景看|近景看)[^】]{0,20})】/g;
const AI_COVERAGE_FOCUS_RE =
  /(?:^|[。；;\n，,\s]+)(?:空间与站位|上半身与手部|面部与眼神)[：:][^。\n；;【]*/g;

/** 原文脏机位词 + AI 景别站位装饰，不进 visual_action。不碰已有 camera_action。 */
export function stripDramaDirectorLensTags(raw: string): string {
  let t = String(raw || '')
    .replace(AI_COVERAGE_BRACKET_RE, '')
    .replace(AI_COVERAGE_FOCUS_RE, (m) => (/^[。；;\n]/.test(m) ? m[0] : ''))
    .replace(DIRECTOR_LENS_TAG_RE, '')
    .replace(/[，、；;]{2,}/g, '，')
    .replace(/[。.]{2,}/g, '。')
    .replace(/^[，、。.\s]+|[，、。.\s]+$/g, '')
    .trim();
  return t;
}

/** Timeline / Compiler 共用：屏幕字、旁白、内心 OS、脏机位词不进画面动作。 */
export function cleanDramaMappedVisualAction(raw: string): string {
  let t = stripDramaInnerOsFromVisual(
    stripDramaNarrationFromVisual(stripDramaScreenTextFromVisual(String(raw || ''))),
  );
  t = stripDramaDirectorLensTags(t);
  if (isDramaScreenTextVisual(t) || isDramaNarrationVisual(t)) return '';
  return t;
}

function cleanName(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^[\s【\[（(「『]+/, '')
    .replace(/[\s】\]）)」』]+$/, '')
    .replace(/\s+/g, '')
    .slice(0, 16);
}

const GENERIC_ROLE_LABELS = new Set(
  [
    '女孩',
    '男孩',
    '男人',
    '女人',
    '打手',
    '保镖',
    '老板',
    '店员',
    '路人',
    '司机',
    '警察',
    '杀手',
    '刺客',
    '侍卫',
    '士兵',
    '护士',
    '医生',
    '老师',
    '学生',
    '小孩',
    '老人',
    '少年',
    '少女',
    '女子',
    '男子',
    '大哥',
    '小弟',
    '小姐',
    '先生',
  ].map((s) => s.toLowerCase()),
);

const CREATURE_HEAD =
  /(乌鸦|麻雀|鸽子|喜鹊|老鹰|猫头鹰|燕子|鹦鹉|猫咪|小猫|小狗|大狗|老鼠|兔子|小兔|野兔|平原兔|狐狸|熊猫|狼狗|野猪|野狼|史莱姆|小怪|怪物|白马|黑马|战马|猫|狗|犬|鸟|兔|羊|牛|鸡|鸭|鱼|蛇)(儿)?$/;

/** 「一川/黑衣打手」「一川（便装）」「C-01 周一川」→ 核心名「一川」/「周一川」 */
export function coreDramaPersonName(raw: string): string {
  // 必须先剥 C-编号再去空白：否则「C-01 周一川」会变成「C-01周一川」导致编号剥不掉
  let n = String(raw || '')
    .trim()
    .replace(/^C-\d+\s*/i, '')
    .trim();
  n = cleanName(n);
  n = n.replace(/^C-\d+/i, '').trim();
  n = (n.split(/[/／|｜]/)[0] || n).trim();
  n = n.replace(/[（(][^）)]{0,24}[）)]/g, '');
  return n;
}

/** 斜杠/括号后的服饰或身份后缀 */
export function dramaNameCostumeSuffix(raw: string): string {
  const s = String(raw || '').trim().replace(/\s+/g, '');
  const parts = s.split(/[/／|｜]/);
  if (parts.length >= 2) return cleanName(parts.slice(1).join(''));
  const m = s.match(/[（(]([^）)]{1,24})[）)]/);
  return m ? cleanName(m[1]) : '';
}

export function isDramaGenericRoleLabel(name: string): boolean {
  const n = coreDramaPersonName(name).toLowerCase();
  return !!n && GENERIC_ROLE_LABELS.has(n);
}

/** 素材页「新建角色」占位名。带序号也要保留，不能当垃圾人名清掉。 */
export function isDramaManualCharacterCardName(name: string): boolean {
  const n = String(name || '')
    .trim()
    .replace(/\s+/g, '');
  if (!n) return false;
  return /^(新(角色|人物)|未命名|Untitled)[A-Za-z0-9一二三四五六七八九十]*$/i.test(n);
}

/** 乌鸦、黄色的小狗、一只黑色的小猫、平原兔 → 生物，不是人物 */
export function isDramaAnimalCreatureName(name: string): boolean {
  const n = String(name || '')
    .trim()
    .replace(/\s+/g, '');
  if (!n || n.length > 12) return false;
  if (/龙套|马仔|马夫|司马|成龙|龙虾|龙王|玉兔精|兔女郎/.test(n)) return false;
  if (/^(一只|一条|一头|一匹|两只|几只)/.test(n) && (CREATURE_HEAD.test(n) || /的/.test(n))) {
    return true;
  }
  if (CREATURE_HEAD.test(n) && n.length <= 10) return true;
  const core = canonicalizeDramaCreatureName(n) || n;
  if (CREATURE_HEAD.test(core) && core.length <= 10) return true;
  if (/兔|猫|狗|鸟|乌鸦|野猪|野狼|小怪/.test(core) && core.length <= 6 && !/司马|成龙/.test(core)) {
    return true;
  }
  return false;
}

/** 草原兔血条 / 兔子血条 → 平原兔 / 兔子。UI 数值不是物种名。 */
export function canonicalizeDramaCreatureName(raw: string): string {
  let n = String(raw || '')
    .trim()
    .replace(/\s+/g, '');
  if (!n) return '';
  n = n.replace(/(的)?(血条|进度条|生命值|生命|HP|hp|面板|数值|攻击力)$/g, '');
  n = n.replace(/血条|进度条|生命值/g, '');
  n = n.replace(/草原兔/g, '平原兔');
  if (n === '兔' || n === '小兔' || n === '野兔') n = '兔子';
  return n;
}

export function namesLikelySameDramaCreature(a: string, b: string): boolean {
  const ca = canonicalizeDramaCreatureName(a);
  const cb = canonicalizeDramaCreatureName(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (/兔/.test(ca) && /兔/.test(cb) && Math.max(ca.length, cb.length) <= 4) return true;
  return false;
}

export function preferCanonicalDramaCreatureName(a: string, b: string): string {
  const ca = canonicalizeDramaCreatureName(a) || String(a || '').trim();
  const cb = canonicalizeDramaCreatureName(b) || String(b || '').trim();
  if (ca.includes('平原') && !cb.includes('平原')) return ca;
  if (cb.includes('平原') && !ca.includes('平原')) return cb;
  if (ca.length !== cb.length) return ca.length > cb.length ? ca : cb;
  return ca || cb;
}

/** 人物定妆词误写进生物卡：年龄服饰骑手等 */
export function dramaCreaturePromptLooksHuman(prompt: string): boolean {
  const p = String(prompt || '');
  return /(岁|年龄|发型|发色|服饰|外卖|骑手|夹克|T恤|男性|女性|人脸|真人写实人物|人物必须|男主|女主|便利店女孩|写字楼男人|快递员|头盔|工装|黄黑外套|背包少年)/.test(
    p,
  );
}

function inferDramaCreatureSpecies(name: string): string {
  const n = canonicalizeDramaCreatureName(name) || String(name || '');
  if (/兔/.test(n)) return '平原野兔（四足动物，长耳短尾，灰褐或浅黄毛色）';
  if (/乌鸦/.test(n)) return '乌鸦';
  if (/鸟/.test(n)) return '鸟';
  if (/猫/.test(n)) return '猫';
  if (/狗|犬/.test(n)) return '狗';
  if (/狼/.test(n)) return '狼';
  if (/猪/.test(n)) return '野猪';
  if (/狐/.test(n)) return '狐狸';
  return '非人类动物';
}

/** 生物生图提示词：必须是动物，禁止人物定妆。 */
export function composeDramaCreatureDesignPrompt(opts: {
  name?: string;
  appearance?: string;
  behavior?: string;
  prompt?: string;
}): string {
  const name = canonicalizeDramaCreatureName(opts.name || '') || String(opts.name || '').trim() || '生物';
  const species = inferDramaCreatureSpecies(name);
  const appearance = String(opts.appearance || '').trim();
  const behavior = String(opts.behavior || '').trim();
  const existing = String(opts.prompt || '').trim();
  if (existing && !dramaCreaturePromptLooksHuman(existing) && existing.length >= 16) {
    if (/禁止人类|非人类|动物/.test(existing)) return existing;
    return `${existing}。必须是${species}，禁止人类、人脸、人体与服装人物。`;
  }
  return [
    name,
    `写实${species}`,
    appearance,
    behavior,
    '全身可见毛发与四肢，纯白背景生物设定图',
    '禁止人类、禁止人脸、禁止人体、禁止外卖骑手、禁止服装模特',
  ]
    .filter(Boolean)
    .join('，');
}

/** 地点+固定身份：便利店女孩、写字楼男人。不是「平原充满血丝」。 */
export function isDramaPlacePlusRoleName(name: string): boolean {
  const n = coreDramaPersonName(name);
  return /^(便利店|写字楼|办公室|出租屋|酒吧|酒馆|酒店|饭店|超市|警局|医院|学校|门口|大厅|保安室)(女孩|男孩|男人|女人|男子|女子|老板|店员|保安|前台|秘书|医生|护士|警察)$/.test(
    n,
  );
}

/** 人名后粘了动作/表情/环境，不是新角色：火焰玫瑰好心补充、暗流潜行冷气 */
const NAME_JUNK_LEXICON =
  /好心|补充|微笑|微带|冷气|充满|血丝|引导|生命|肥胖|冷漠|进度|文字|屏幕|面板|皱眉|加速|骑行|冲入|看着|拿出|说道|问道|天赋|血条|订单|超时|雨水|车流/;

function remainderLooksLikeDescription(short: string, long: string): boolean {
  if (!long.startsWith(short) || long.length <= short.length) return false;
  return isGluedJunkSuffix(long.slice(short.length));
}

function isGluedJunkSuffix(rest: string): boolean {
  const r = String(rest || '').trim();
  if (!r) return false;
  return /^(好心|微带|微笑|补充|冷气|充满|血丝|引导|生命|肥胖|进度|文字|屏幕|面板|皱眉)/.test(r);
}

/**
 * 同一人：周一川 ≈ 一川 ≈ 一川/黑衣打手。
 * 不合并「便利店女孩」与「女孩」这类泛称。
 */
export function namesLikelySameDramaPerson(a: string, b: string): boolean {
  const ca = coreDramaPersonName(a);
  const cb = coreDramaPersonName(b);
  if (!ca || !cb) return false;
  if (ca.toLowerCase() === cb.toLowerCase()) return true;
  if (isDramaGenericRoleLabel(ca) || isDramaGenericRoleLabel(cb)) return false;
  const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  if (short.length < 2 || short.length >= long.length) return false;
  // 姓+名：周一川 包含 一川
  if (long.endsWith(short) && long.length <= 4) return true;
  // 一川XXX 且后缀像服饰/身份
  if (long.startsWith(short) && /黑衣|白衣|便装|正装|打手|保镖|变装|伪装|战斗|日常|制服/.test(long.slice(short.length))) {
    return true;
  }
  // 火焰玫瑰好心补充 ≈ 火焰玫瑰
  if (remainderLooksLikeDescription(short, long)) return true;
  return false;
}

export function preferCanonicalDramaPersonName(a: string, b: string): string {
  const aSlash = /[/／|｜]/.test(String(a || ''));
  const bSlash = /[/／|｜]/.test(String(b || ''));
  if (aSlash !== bSlash) {
    const pick = aSlash ? b : a;
    return coreDramaPersonName(pick) || String(pick || '').trim();
  }
  const ca = coreDramaPersonName(a);
  const cb = coreDramaPersonName(b);
  if (remainderLooksLikeDescription(ca, cb)) return ca;
  if (remainderLooksLikeDescription(cb, ca)) return cb;
  if (ca.length !== cb.length) return ca.length > cb.length ? ca : cb;
  return ca || cb;
}

function collapseAliasPersonNames(names: string[]): string[] {
  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const core = coreDramaPersonName(raw) || cleanName(raw);
    if (!core) continue;
    const k = core.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(core);
  }
  uniq.sort((a, b) => b.length - a.length);
  const kept: string[] = [];
  for (const n of uniq) {
    const hit = kept.findIndex((k) => namesLikelySameDramaPerson(k, n));
    if (hit >= 0) {
      kept[hit] = preferCanonicalDramaPersonName(kept[hit], n);
      continue;
    }
    kept.push(n);
  }
  return kept;
}

/**
 * 小说「XX道 / XX：」叙述引导，不是人物：冷冷道、问道、心想、注意、地点。
 */
export function isDramaSpeechAttributionLead(name: string): boolean {
  const n = coreDramaPersonName(name) || cleanName(name);
  if (!n) return false;
  if (/^(?:心想|暗想|寻思|默念|低语|轻声|开口|接话|补充|答话|回话)$/.test(n)) return true;
  if (/^(?:冷冷|沉声|低声|轻声|缓缓|慢慢|怒声|大声|小声|柔声|厉声|冷声)道$/.test(n)) return true;
  if (/^(?:说|问|喊|叫|骂|答|回|应|叹|哼|怒|笑|哭|嘲)道$/.test(n)) return true;
  if (/[说问喊叫骂答回应叹哼]道$/.test(n) && n.length <= 4) return true;
  return false;
}

const NARRATION_COLON_LABELS = new Set(
  [
    '注意',
    '提示',
    '说明',
    '备注',
    '注释',
    '地点',
    '时间',
    '场景',
    '声音',
    '音效',
    '效果',
    '字幕',
    '旁白',
    '画外',
    '内心',
    '独白',
    '条件',
    '规则',
    '目标',
    '参考',
    '步骤',
    '原因',
    '结果',
    '总之',
    '另外',
    '例如',
    '比如',
    '如下',
    '其实',
    '当然',
    '显然',
    '果然',
    '居然',
    '竟然',
    '忽然',
    '猛然',
    '瞬间',
    '只见',
    '但见',
    '原来',
    '所以',
    '如果',
    '那么',
    '可是',
    '不过',
    '而且',
    '并且',
    '或者',
    '以及',
    '还有',
    '没有',
    '不是',
    '就是',
    '还是',
    '已经',
    '正在',
    '开始',
    '结束',
    '最后',
    '首先',
    '其次',
    '再次',
    '最终',
    '此刻',
    '此时',
    '这时',
    '随后',
    '接着',
    '同时',
    '然后',
    '但是',
    '于是',
    '突然',
    '第一',
    '第二',
    '第三',
    '第四',
    '第五',
    '看见',
    '听到',
    '感到',
    '标题',
    '正文',
    '附录',
    '要求',
    '限制',
    '禁止',
    '必须',
    '可以',
    '应该',
    '内容',
    '简介',
    '概述',
    '背景',
    '设定',
    '世界观',
    '任务',
    '奖励',
    '属性',
    '数值',
    '等级',
    '经验',
    '金币',
    '血量',
    '蓝量',
    '攻略',
    '提示音',
  ].map((s) => s.toLowerCase()),
);

/** 行首「注意：」「地点：」这类结构标签，不是说话人 */
export function isDramaNarrationColonLabel(name: string): boolean {
  const n = (coreDramaPersonName(name) || cleanName(name)).toLowerCase();
  if (!n) return false;
  return NARRATION_COLON_LABELS.has(n) || STOP_NAMES.has(n);
}

/** 素材人物黑名单：叙述引导 + 结构标签（程序规则，不走 LLM） */
export function isDramaNonCastLabel(name: string): boolean {
  return isDramaSpeechAttributionLead(name) || isDramaNarrationColonLabel(name);
}

/**
 * 可当作角色名的称呼：周一川、便利店女孩、汤米·巴洛、火焰玫瑰。
 * 排除镜头动作、画面说明、字幕、身体局部、对白碎片、形容词堆砌、地名/标题。
 */
export function isDramaCharacterNamePlausible(name: string): boolean {
  if (isDramaNonCastLabel(name)) return false;
  if (isDramaAnimalCreatureName(name)) return false;
  const n = coreDramaPersonName(name) || cleanName(name);
  if (!n || n.length < 2) return false;
  if (n.length > 8) return false;
  if (STOP_NAMES.has(n.toLowerCase())) return false;
  if (!/[\u4e00-\u9fffA-Za-z]/.test(n)) return false;
  if (/[0-9%％]/.test(n)) return false;
  if (/[，。、；：:！!？?,.…]/.test(n)) return false;
  // 「戴头盔的德鲁」「周一川的眼睛动了一下」——描述不是名
  if (n.includes('的')) return false;
  if (/画面|字幕|文字|进度|镜头|特写|构图|右下|左上|浮现|动态|小字|水印|标题|广告|弹幕|蒙太奇|特效|技能/.test(n)) {
    return false;
  }
  if (/眼睛|眼神|喉结|嘴角|眉毛|手指|脚步|眨眼|血丝/.test(n)) return false;
  if (/动了一下|动了|站在|戴着|带着|带风雪|户外|远处/.test(n)) return false;
  if (/^(第.+场|场景|地点|时间|动作|特写|全景)/.test(n)) return false;
  if (/^(然后|但是|于是|突然|这时|此时|随后|接着|同时)$/.test(n)) return false;
  if (/^(他|她|它|我|你|您|咱|这|那|由|从|被|把|让|因|由于|这些|那些)/.test(n)) return false;
  if (
    /走过来|走过去|转身|进房|出来|进来|进去|过去|过来|回去|起来|拿出|看向|说道|问道|选回|引步|步转|三个人|两个人|一个人/.test(
      n,
    )
  ) {
    return false;
  }
  if (/(说|问|喊|叫|走|转|进|出|拿|看|冲|骑|停|敲|推|放)$/.test(n) && n.length >= 3) return false;
  if (n.length >= 4 && /鸣$/.test(n)) return false;
  if (n.length >= 7 && /说|走|转|进|出|来|去|看|拿|选|步/.test(n)) return false;
  // 描写句 / 表情后缀 / 氛围词，不是称呼
  if (NAME_JUNK_LEXICON.test(n)) return false;
  // 地名 / 场景标题 / 世界观地点：峡谷之巅、云霄峰、山门外、直播间
  if (isDramaPlaceOrTitleName(n)) return false;
  // 地点开头但不是「地点+身份」
  if (
    /^(平原|草原|街头|街道|雨夜|写字楼|电梯|走廊|办公室|大厅|门口|便利店|出租屋|纯白|白空间|房间|滨江|峡谷|云霄|山门|会场|直播)/.test(
      n,
    ) &&
    !isDramaPlacePlusRoleName(n)
  ) {
    return false;
  }
  // 形容词堆在身份词前：冷漠肥胖男人
  if (
    n.length >= 5 &&
    /(男人|女人|女孩|男孩|男子|女子)$/.test(n) &&
    !isDramaPlacePlusRoleName(n)
  ) {
    return false;
  }
  return true;
}

/** 地名、场次标题、世界观地点 —— 禁止进人物卡 */
export function isDramaPlaceOrTitleName(name: string): boolean {
  const n = coreDramaPersonName(name) || cleanName(name);
  if (!n) return false;
  if (isDramaPlacePlusRoleName(n)) return false;
  if (/(峰|山|谷|崖|湖|河|江|海|岛|城|镇|村|街|路|巷|桥|塔|殿|宫|寺|观|阁|楼|厅|室|间|场|馆|院|园|门外|门内|门口)$/.test(n)) {
    return true;
  }
  if (/(之巅|之巅|直播间|会场|峡谷|商城|山门|大典|擂台|竞技场)$/.test(n)) return true;
  if (/^(内景|外景|开场|转场)/.test(n)) return true;
  return false;
}

/**
 * 素材准备准入：必须像人名，且优先为对白说话人。
 * 系统/旁白不算人物卡；地名/标题/生物不算。
 */
export function isDramaStrictCastName(name: string, sourceText?: string): boolean {
  if (isSystemSpeakerName(name)) return false;
  if (isDramaNonCastLabel(name)) return false;
  if (isDramaAnimalCreatureName(name)) return false;
  if (isDramaPlaceOrTitleName(name)) return false;
  if (!isDramaCharacterNamePlausible(name)) return false;
  return isDramaCharacterNameAcceptable(name, sourceText);
}

/** 剧本里能对上的才准入人物；地点+身份例外。无剧本时只做形态校验。 */
export function isDramaCharacterNameAcceptable(name: string, sourceText?: string): boolean {
  if (!isDramaCharacterNamePlausible(name)) return false;
  const src = String(sourceText || '').replace(/\s+/g, '');
  if (!src) return true;
  if (isDramaPlacePlusRoleName(name)) return true;
  const core = coreDramaPersonName(name) || cleanName(name);
  if (/[·•]/.test(core) || /[A-Za-z]/.test(core)) return src.toLowerCase().includes(core.toLowerCase());
  return src.includes(core);
}

/**
 * 火焰玫瑰好心补充 → 火焰玫瑰；对不上则空串。
 */
export function salvageDramaPersonName(raw: string, sourceText?: string): string {
  const n = coreDramaPersonName(raw) || cleanName(raw);
  if (!n) return '';
  if (isDramaAnimalCreatureName(n)) return '';
  if (isDramaCharacterNameAcceptable(n, sourceText)) return n;
  const src = String(sourceText || '').replace(/\s+/g, '');
  for (let len = Math.min(4, n.length - 1); len >= 2; len -= 1) {
    const prefix = n.slice(0, len);
    const rest = n.slice(len);
    if (!isGluedJunkSuffix(rest)) continue;
    if (!isDramaCharacterNamePlausible(prefix)) continue;
    if (src && !src.includes(prefix) && !isDramaPlacePlusRoleName(prefix)) continue;
    return prefix;
  }
  return '';
}

function isPlausiblePersonName(name: string): boolean {
  return isDramaCharacterNamePlausible(name);
}

/**
 * 去掉行首尾 Markdown 加粗/斜体，便于识别 **林凡**（怒）：台词、**场景一：天庭**。
 */
export function stripDramaMarkdownDecor(raw: string): string {
  let s = String(raw || '').trim();
  if (!s) return '';
  // 整行被 **…** 或 *…* 包裹
  s = s.replace(/^\*{1,3}\s*([\s\S]*?)\s*\*{1,3}$/u, '$1').trim();
  // 行内 **姓名** / *姓名*
  s = s.replace(/\*{1,3}([^*\n]{1,24})\*{1,3}/gu, '$1');
  return s.trim();
}

/**
 * 从剧本/对白字符串中提取可能的人名。
 * 覆盖：
 * - 「林默：……」「苏婉:……」
 * - 「**林凡**（怒）：……」Markdown 剧本
 * - 「【林默】……」
 * - 连续台词块
 */
export function extractCharacterNamesFromScriptText(sourceText: string): string[] {
  const text = String(sourceText || '');
  if (!text.trim()) return [];
  const found = new Set<string>();

  const patterns: RegExp[] = [
    // 仅短称呼 + 冒号，避免把整句叙述当成说话人
    /^[\s]*([\u4e00-\u9fffA-Za-z·]{2,8})\s*[：:]\s*.+/gm,
    // **姓名**（情绪）： / **姓名**：
    /^[\s]*\*{1,3}\s*([\u4e00-\u9fffA-Za-z·]{2,8})\s*\*{1,3}\s*(?:[（(][^）\n]{0,16}[）)])?\s*[：:]/gm,
    // 【姓名】
    /【\s*([\u4e00-\u9fffA-Za-z·]{2,8})\s*】/g,
    // （姓名）独白/旁白以外的角色标注：姓名（情绪）
    /^[\s]*([\u4e00-\u9fff]{2,8})\s*[（(][^）\n]{0,12}[）)]\s*[：:]/gm,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const n = cleanName(m[1] || '');
      if (isPlausiblePersonName(n)) found.add(n);
    }
  }

  // 再扫一遍去壳后的行（兼容整行 **姓名（情绪）：台词**）
  for (const line of text.split(/\r?\n/)) {
    const plain = stripDramaMarkdownDecor(line);
    if (!plain || plain === line.trim()) continue;
    const m =
      plain.match(/^([\u4e00-\u9fffA-Za-z·]{2,8})\s*(?:[（(][^）\n]{0,16}[）)])?\s*[：:]\s*.+/) ||
      plain.match(/^([\u4e00-\u9fffA-Za-z·]{2,8})\s*(?:[（(][^）\n]{0,16}[）)])?\s*[：:]\s*$/);
    if (!m) continue;
    const n = cleanName(m[1] || '');
    if (isPlausiblePersonName(n) && !/^场景/.test(n)) found.add(n);
  }

  return [...found];
}

/** 从「名：文 / 名：文」或换行台词串里拆人名 */
export function extractCharacterNamesFromDialogueBlob(blob: string): string[] {
  const text = String(blob || '').trim();
  if (!text) return [];
  const found = new Set<string>();
  const parts = text.split(/\n+|\/|\||；|;/);
  for (const part of parts) {
    const m = part.trim().match(/^([\u4e00-\u9fffA-Za-z·]{2,8})\s*[：:]\s*(.+)$/);
    if (m) {
      const n = cleanName(m[1]);
      if (isPlausiblePersonName(n)) found.add(n);
    }
  }
  return [...found];
}

export function mergeUniqueNames(...lists: string[][]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list) {
      const salvaged = salvageDramaPersonName(raw);
      const n = salvaged || cleanName(raw);
      if (!isPlausiblePersonName(n)) continue;
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(n);
    }
  }
  return collapseAliasPersonNames(out);
}
