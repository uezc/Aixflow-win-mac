/**
 * 从剧本文本启发式提取出场人名（分析 LLM 漏提时的补全）。
 * 不做「创造」：只识别正文里已出现的说话人/称呼。
 */

const STOP_NAMES = new Set(
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
  ].map((s) => s.toLowerCase()),
);

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
 * 可当作角色名的称呼：周一川、便利店女孩、汤米·巴洛、火焰玫瑰。
 * 排除镜头动作、画面说明、字幕、身体局部、对白碎片、形容词堆砌。
 */
export function isDramaCharacterNamePlausible(name: string): boolean {
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
  if (/画面|字幕|文字|进度|镜头|特写|构图|右下|左上|浮现|动态|小字|水印|标题|广告/.test(n)) {
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
  // 地点开头但不是「地点+身份」
  if (
    /^(平原|草原|街头|街道|雨夜|写字楼|电梯|走廊|办公室|大厅|门口|便利店|出租屋|纯白|白空间|房间|滨江)/.test(
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
 * 从剧本/对白字符串中提取可能的人名。
 * 覆盖：
 * - 「林默：……」「苏婉:……」
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
