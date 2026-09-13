/**
 * Timeline visual_action → H3 Action English.
 * Deterministic lexicon (no LLM). Unmapped Chinese must not be silently deleted
 * when it is the only action content — we map longest phrases first, then tokens.
 */

export type DramaVisualEnBind = {
  name: string;
  /** e.g. `<Subject 1> (S1)` or `<Subject 5>` */
  replacement: string;
};

/** 机位空值 / 破折号占位，不当作运镜写入 Action。 */
export function isBlankDramaCameraMarker(raw: string): boolean {
  const t = String(raw || '')
    .trim()
    .replace(/^机位\s*[:：]?\s*/i, '')
    .replace(/^Camera\s*[:：]?\s*/i, '');
  return !t || /^(?:—|－|–|−|-|~|～|无|空|暂无|\.{1,3}|N\/A|n\/a)$/i.test(t);
}

function applyLongestFirst(text: string, pairs: Array<[string, string]>): string {
  const sorted = [...pairs].sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
  let t = text;
  for (const [zh, en] of sorted) {
    if (!zh || !t.includes(zh)) continue;
    t = t.split(zh).join(` ${en} `);
  }
  return t;
}

/** 多字优先的动作/场面短语（覆盖武戏、常见生活动作）。 */
const VISUAL_PHRASES: Array<[string, string]> = [
  ['进入画面，站位落定，双手自然下垂', 'enters the frame, takes position, hands naturally at the sides'],
  ['进入画面，站位落定', 'enters the frame, takes position'],
  ['维持落点，呼吸起伏', 'maintains position, breathing steadily'],
  ['半空浮现半透明3D全息系统面板', 'a translucent 3D holographic system panel floats in mid-air'],
  ['画面过渡到黑屏', 'the frame cuts to black'],
  ['画面切黑', 'the frame cuts to black'],
  ['雷声由远及近', 'thunder closes in'],
  ['雷声逼近', 'thunder closes in'],
  ['屏幕被击中', 'the screen is struck'],
  ['屏幕炸开蓝光', 'the screen bursts with blue light'],
  ['左手键盘右手鼠标', 'left hand on the keyboard, right hand on the mouse'],
  ['坐在电竞椅上', 'sits in the gaming chair'],
  ['靠在电竞椅上', 'leans back in the gaming chair'],
  ['拿起汽水', 'picks up the soda'],
  ['RGB灯条在昏暗房间里闪烁', 'RGB light strips flicker in the dim room'],
  ['RGB灯条', 'RGB light strips'],
  ['打了个哈欠', 'yawns'],
  ['拿起一罐汽水灌了一大口', 'picks up a soda can and gulps a big mouthful'],
  ['灌了一大口', 'gulps a big mouthful'],
  ['气泡声嗞', 'soda fizz'],
  ['气泡声', 'soda fizz'],
  ['打个汽水嗝', 'lets out a soda burp'],
  ['一道白光闪过', 'a flash of white light cuts across'],
  ['白光闪过', 'a flash of white light cuts across'],
  ['第二道雷直接劈进电脑屏幕', 'a second thunderbolt strikes straight into the computer screen'],
  ['蓝光炸裂', 'blue light explodes'],
  ['浑身一麻', 'body jolts numb'],
  ['眼睛瞪大', 'eyes widen'],
  ['长叹一口气', 'sighs deeply'],
  ['全身用力', 'exerts full force'],
  ['毫无反应', 'remains unresponsive'],
  ['语气沧桑', 'voice weathered'],
  ['憋红脸', 'face flushed red with effort'],

  // 议事堂 / 站位 / 表情
  ['议事堂内灯火通明', 'the council hall is brightly lit'],
  ['灯火通明', 'brightly lit'],
  ['九把椅子排开', 'nine chairs lined up in a row'],
  ['六位长老坐在上面', 'six elders seated upon them'],
  ['神情严肃', 'stern expressions'],
  ['站在堂中央', 'stands at the center of the hall'],
  ['站在中央', 'stands at the center'],
  ['灰袍上沾着狼血和泥', 'gray robe stained with wolf blood and mud'],
  ['沾着狼血和泥', 'stained with wolf blood and mud'],
  ['红毛刺猬头在烛光下格外显眼', 'red spiked hair stands out sharply under the candlelight'],
  ['红毛刺猬头', 'red spiked hair'],
  ['在烛光下格外显眼', 'stands out sharply under the candlelight'],
  ['格外显眼', 'stands out sharply'],
  ['嘴角抽搐', 'mouth corner twitches'],
  ['长老们的眼神', "the elders' eyes"],
  ['长老们', 'the elders'],
  ['坐在上面', 'seated upon them'],
  ['椅子排开', 'chairs lined up'],
  ['站在', 'stands at'],
  ['抽搐', 'twitches'],

  // 议事堂对峙续拍（拍桌/叉腰/踢凳/侧头/对视/孤傲离场）
  ['一位长老激动地拍桌子站起来', 'an elder slams the table and springs to his feet in agitation'],
  ['激动地拍桌子站起来', 'slams the table and springs to his feet in agitation'],
  ['拍桌子站起来', 'slams the table and stands up'],
  ['拍桌子', 'slams the table'],
  ['大声说道', 'speaks loudly'],
  ['神情愤怒', 'furious expression'],
  ['双手叉腰', 'hands on hips'],
  ['嘴角微扬', 'mouth corner lifts slightly'],
  ['语气轻松地回应', 'responds in a relaxed tone'],
  ['语气轻松', 'relaxed tone'],
  ['另一位长老猛地一脚把凳子踢开', 'another elder kicks the stool away hard'],
  ['猛地一脚把凳子踢开', 'kicks the stool away hard'],
  ['一脚把凳子踢开', 'kicks the stool away'],
  ['把凳子踢开', 'kicks the stool away'],
  ['站起身来', 'stands up'],
  ['大声呵斥', 'barks a loud rebuke'],
  ['微微侧头', 'tilts the head slightly'],
  ['眼神中带着一丝不屑', 'eyes carry a hint of disdain'],
  ['一丝不屑', 'a hint of disdain'],
  ['长老们彼此对视', 'the elders exchange glances'],
  ['彼此对视', 'exchange glances'],
  ['脸上写满震惊和愤怒', 'faces written with shock and fury'],
  ['震惊和愤怒', 'shock and fury'],
  ['转身离开', 'turns and walks away'],
  ['背影在烛光下显得格外孤傲', 'silhouette looks especially solitary and proud under the candlelight'],
  ['格外孤傲', 'especially solitary and proud'],
  ['孤傲', 'solitary and proud'],

  // 武戏 / 巷战（本例）
  ['倒飞出去', 'is flung backward through the air'],
  ['撞在墙上', 'crashes into the wall'],
  ['吐出一口黑血', 'spits a mouthful of black blood'],
  ['墙面出现裂痕', 'cracks appear on the wall surface'],
  ['从阴影中浮现', 'emerges from the shadows'],
  ['形态模糊', 'form blurred and indistinct'],
  ['眼中泛着红光', 'eyes glow with red light'],
  ['举着缠成一团的缚魂锁冲上去', 'charges forward holding a tangled soul-binding chain'],
  ['举着缠成一团的', 'holding the tangled'],
  ['却踩到水渍滑倒', 'but slips on a wet patch'],
  ['踩到水渍滑倒', 'slips on a wet patch'],
  ['整个人飞出去', 'the whole body flies outward'],
  ['锁链团正好砸在血煞鬼头上', 'the chain mass smashes squarely onto the blood-fiend head'],
  ['锁链团砸中血煞鬼的瞬间', 'the instant the chain mass strikes the blood-fiend'],
  ['砸在血煞鬼头上', 'smashes onto the blood-fiend head'],
  ['在一旁观望', 'watches from the side'],
  ['身体接触到地面的积水', 'body contacts the puddle on the ground'],
  ['接触到地面的积水', 'contacts the puddle on the ground'],
  ['水中的阴寒之气顺着他的经脉涌入', 'yin-cold qi from the water surges into his meridians'],
  ['阴寒之气顺着他的经脉涌入', 'yin-cold qi surges into his meridians'],
  ['他被篡改的记忆里', 'inside his altered memories'],
  ['一丝战斗本能被触发', 'a shred of combat instinct is triggered'],
  ['缚魂锁发出一道金光', 'the soul-binding chain emits a beam of golden light'],
  ['发出一道金光', 'emits a beam of golden light'],
  ['无意识发动', 'activates unconsciously'],
  ['被金光弹飞', 'is blasted away by the golden light'],
  ['被金光震退', 'is forced back by the golden light'],
  ['逐渐变得透明', 'gradually turns translucent'],
  ['发出尖锐的嘶吼', 'lets out a piercing shriek'],
  ['从地上爬起来', 'scrambles up from the ground'],
  ['嘴角流血', 'blood at the corner of the mouth'],
  ['目光转向血怨灵体消失的方向', 'gaze turns toward where the blood-resentment spirit vanished'],
  ['目光锁定在', 'gaze locks onto'],
  ['眼中带着复杂的情绪', 'eyes carry a complex mix of emotion'],
  ['靠着墙', 'leans against the wall'],
  ['喘息着', 'breathing hard'],
  ['捂脸', 'covers the face with a hand'],

  // 慢镜头 / 特效标签
  ['【慢镜头】', '[slow motion] '],
  ['慢镜头', 'slow motion'],

  // 常见武戏短语
  ['冲上去', 'charges forward'],
  ['冲上前', 'charges forward'],
  ['飞出去', 'flies outward'],
  ['倒飞', 'is flung backward'],
  ['弹飞', 'is blasted away'],
  ['震退', 'is forced back'],
  ['滑倒', 'slips and falls'],
  ['爬起来', 'gets up'],
  ['扑上去', 'lunges forward'],
  ['挥拳', 'throws a punch'],
  ['出拳', 'throws a punch'],
  ['拔刀', 'draws a blade'],
  ['拔剑', 'draws a sword'],
  ['挥剑', 'swings the sword'],
  ['挥刀', 'swings the blade'],
  ['格挡', 'parries'],
  ['躲开', 'dodges'],
  ['闪身', 'sidesteps'],
  ['后退', 'steps back'],
  ['上前', 'steps forward'],
  ['跪下', 'kneels'],
  ['站起', 'stands up'],
  ['转身', 'turns around'],
  ['回头', 'looks back'],
  ['抬头', 'looks up'],
  ['低头', 'looks down'],
  ['握紧拳头', 'clenches fists'],
  ['握紧', 'grips tightly'],
  ['松开', 'lets go'],
  ['抓住', 'grabs'],
  ['推开', 'pushes away'],
  ['拉住', 'pulls and holds'],
  ['砸中', 'strikes'],
  ['砸在', 'smashes onto'],
  ['撞上', 'collides with'],
  ['撞到', 'hits'],
  ['浮现', 'emerges'],
  ['消失', 'vanishes'],
  ['观望', 'watches'],
  ['嘶吼', 'shrieks'],
  ['吐血', 'spits blood'],
  ['流血', 'bleeds'],
  ['裂痕', 'cracks'],
  ['积水', 'puddle'],
  ['水渍', 'wet patch'],
  ['阴影中', 'in the shadows'],
  ['阴影', 'shadows'],
  ['金光', 'golden light'],
  ['红光', 'red light'],
  ['黑血', 'black blood'],
  ['缚魂诀', 'Soul-Binding Art'],
  ['锁链团', 'chain mass'],
  ['血煞鬼', 'blood-fiend'],
  ['灵体', 'spirit form'],
  ['经脉', 'meridians'],
  ['阴寒之气', 'yin-cold qi'],
  ['战斗本能', 'combat instinct'],
  ['被篡改的记忆', 'altered memories'],
  ['无意识', 'unconsciously'],
  ['缠成一团', 'tangled into a mass'],
  ['变得透明', 'turns translucent'],
  ['尖锐的', 'piercing'],
  ['复杂的情绪', 'complex emotion'],
  ['目光转向', 'gaze turns toward'],
  ['目光锁定', 'gaze locks onto'],
  // 视线 / 反应（GAZE 等对白链高频）
  ['转头看向', 'turns the head and looks toward'],
  ['抬头看向', 'looks up toward'],
  ['低头看向', 'looks down toward'],
  ['没有回答', 'does not answer'],
  ['不作回答', 'does not answer'],
  ['不回答', 'does not answer'],
  ['看向', 'looks toward'],
  ['望向', 'gazes toward'],
  ['盯着', 'stares at'],
  ['青衫少年', 'the youth in a blue robe'],
  ['青衫', 'blue robe'],

  // 表情 / 状态（短）
  ['眼神茫然', 'eyes vacant'],
  ['目光茫然', 'gaze vacant'],
  ['茫然', 'vacant'],
  ['震惊', 'shocked'],
  ['惊恐', 'terrified'],
  ['紧张', 'tense'],
  ['惊讶', 'surprised'],
  ['愤怒', 'furious'],
  ['平静', 'calm'],
  ['慵懒', 'languid'],
  ['困惑', 'confused'],
  ['迷茫', 'confused'],
  ['疑惑', 'puzzled'],
  ['无奈', 'resigned'],
  ['决心', 'determined'],
  ['懵逼', 'stunned'],
  ['慌乱', 'panicked'],
  ['痛苦', 'in pain'],
  ['虚弱', 'weakened'],
  ['警惕', 'wary'],
  ['冷漠', 'cold'],
  ['温柔', 'gentle'],
  ['狠厉', 'fierce'],
];

/** 剩余短词兜底（短语跑完后再用）。避免过短虚词，防止「一道白光」被拆成 a beam of。 */
const VISUAL_TOKENS: Array<[string, string]> = [
  ['瞬间', 'instant'],
  ['身体', 'body'],
  ['地面', 'ground'],
  ['墙面', 'wall surface'],
  ['方向', 'direction'],
  ['一旁', 'aside'],
  ['整个人', 'the whole body'],
];

function tidyEnglishAction(t: string): string {
  return t
    .replace(/[【]/g, '[')
    .replace(/[】]/g, ']')
    .replace(/[「『]/g, '')
    .replace(/[」』]/g, '')
    .replace(/[，、；]/g, ', ')
    .replace(/[。！？]/g, '. ')
    .replace(/[:：]\s*[—－–−]+\s*/g, '')
    .replace(/[—－–−]{1,}/g, ' ')
    .replace(/[\u4e00-\u9fff]+/g, ' ')
    // 切镜中文【前缀】/「焦点：」剥汉字后残留空括号与冒号
    .replace(/\[\s*\]/g, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s*[：:]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/(?:\.\s*){2,}/g, '. ')
    .replace(/\s+([.,;])/g, '$1')
    .replace(/([.,;])(?=\S)/g, '$1 ')
    .replace(/(>(?:\s*\(S\d+\))?)\s*([A-Za-z\[])/g, '$1 $2')
    .replace(/\(\s*S(\d+)\s*\)/g, '(S$1)')
    .replace(/>\s+\(S/g, '> (S')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s.]+|[,\s.]+$/g, '')
    .trim();
}

function bindDramaVisualSubjects(raw: string, binds: DramaVisualEnBind[]): string {
  let t = String(raw || '').trim();
  if (!t) return '';
  const ordered = [...binds]
    .filter((b) => b.name && b.replacement)
    .sort((a, b) => b.name.length - a.name.length);
  for (const b of ordered) {
    const re = new RegExp(b.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    t = t.replace(re, b.replacement);
  }
  return t;
}

function bridgeDramaVisualSubjects(t: string): string {
  return t
    .replace(
      /举着缠成一团的(<Subject\s+\d+>)冲上去/g,
      'charges forward holding the tangled $1',
    )
    .replace(
      /(<Subject\s+\d+(?:\s*\(S\d+\))?>)发出一道金光/g,
      '$1 emits a beam of golden light',
    )
    .replace(
      /目光转向(<Subject\s+\d+(?:\s*\(S\d+\))?>)消失的方向/g,
      'gaze turns toward where $1 vanished',
    )
    .replace(
      /转头看向\s*(<Subject\s+\d+(?:\s*\(S\d+\))?>)/g,
      'turns the head and looks toward $1',
    )
    .replace(
      /看向\s*(<Subject\s+\d+(?:\s*\(S\d+\))?>)/g,
      'looks toward $1',
    )
    .replace(
      /望向\s*(<Subject\s+\d+(?:\s*\(S\d+\))?>)/g,
      'gazes toward $1',
    );
}

/** 未收录中文动作的最后保底：保留 Subject，禁止静默变空。 */
function fallbackEnglishActionKeep(raw: string, bound: string): string {
  const tags = [...String(bound || '').matchAll(/<Subject\s+\d+(?:\s*\(S\d+\))?>/gi)].map((m) =>
    m[0].replace(/\s+/g, ' ').trim(),
  );
  const uniq = [...new Set(tags)];
  if (uniq.length) {
    return `${uniq.join(' ')} continues the on-screen action`;
  }
  const hasHan = /[\u4e00-\u9fff]/.test(String(raw || ''));
  if (hasHan || String(raw || '').trim()) {
    return 'the on-screen action continues';
  }
  return '';
}

/**
 * 将中文画面动作编译为英文 Action 行内容。
 * 先绑 Subject，再短语/短词；另补少量「Subject + 中文动词」桥接，避免道具名被译丢标签。
 * P0：原文有动作时默认禁止因未收录词而静默返回空串（failOpen）。
 * 外貌/场景 look 等非动作路径传 failOpen:false，保持旧行为。
 */
export function dramaVisualActionToEnglish(
  raw: string,
  binds: DramaVisualEnBind[] = [],
  opts?: { failOpen?: boolean },
): string {
  const source = String(raw || '').trim();
  if (!source) return '';
  const failOpen = opts?.failOpen !== false;

  let t = bindDramaVisualSubjects(source, binds);
  t = bridgeDramaVisualSubjects(t);
  t = applyLongestFirst(t, VISUAL_PHRASES);
  t = applyLongestFirst(t, VISUAL_TOKENS);
  t = tidyEnglishAction(t);

  if (/[A-Za-z0-9<[]/.test(t) && !isSubjectOnlyResidue(t)) {
    return t;
  }
  if (!failOpen) return '';
  // 译后只剩 Subject / 被剥光：用保底英文，绝不静默删除
  return fallbackEnglishActionKeep(source, bindDramaVisualSubjects(source, binds));
}

/** 译完后只剩 <Subject N>/(SN)，没有可读动作。 */
export function isSubjectOnlyResidue(en: string): boolean {
  const rest = String(en || '')
    .replace(/<Subject\s+\d+>/gi, '')
    .replace(/\(S\d+\)/gi, '')
    .replace(/[\s,.;:，。、]+/g, '');
  return !rest;
}
