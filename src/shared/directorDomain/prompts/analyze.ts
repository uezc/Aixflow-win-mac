/**
 * 短剧 V2：剧本分析 → 项目圣经 + 资产清单 + 视觉事件（镜头由 Shot Planning 另阶段生成）
 */

import { estimateDramaAnalyzeShotBudget } from '../shotPlanning.js';

export const DRAMA_DOMAIN_ANALYZE_SYSTEM_PROMPT = `你是世界级短剧制片总监 + 角色造型导演 + 场景美术指导。
任务：根据用户给出的「本集剧本正文」，输出可确认的「项目圣经草稿 + 资产清单 + 场次/视觉事件」JSON。本阶段不生成 shots。

规则：
1. 只输出合法 JSON，不要 Markdown，不要代码块；不要在 JSON 前后加任何说明文字。
2. schemaVersion 必须是 "director-domain.v2"；type 必须是 "director-drama-domain-analyze"。
3. 顶层字段（顺序必须遵守，先事件后人物，防止截断丢事件）：schemaVersion, type, project, plot, relationships, script_keywords, scene_beats, visual_events, characters, scenes, props, creatures。
3b. **禁止输出 shots**。镜头规划是下一阶段；本阶段只把「发生了什么」拆成 Visual Events。
3c. **篇幅（防截断，必须遵守）**：
   - 优先保证 JSON **完整可解析**，宁可字段略短，不可写到一半被截断。
   - characters ≤ 12；scenes ≤ 8；props ≤ 5；scene_beats ≤ 12；visual_events 约 {eventsTarget}（≥{eventsMin}）。
   - 每人 visual.* / prompt、每景 prompt：各 ≤ 160 字；plot / relationships / worldview ≤ 200 字。
   - sample_text 为声音提示词（名字 + 年龄 + 性别 + 口语化音色描述 + 剧本 2～3 句台词），约 80–220 字，不可只写台词。
4. project: { name, type, style, worldview, visual_style, color_style, era, references[] }
   - **必须先判定题材**：style 写成明确题材标签（如「古装玄幻」「现代都市」「武侠」「末世科幻」「民国」），era 写时代（如「架空古代」「当代」）。
   - visual_style 必须与题材一致（古装玄幻→中国古风/仙侠光色；禁止在古装题材里写赛博霓虹都市作为主视觉）。
   - worldview / plot 必须能支撑后续人物与场景设计；人物形象、服装、场景材质都要服务背景故事，禁止与剧情身份矛盾。
   - project.name 只写剧名，禁止带「第N集」。

【强制：人物普查 — 先于一切资产生成】
A. 先通读**本集正文**，列出本集会出镜、说话、被点名、有动作互动的人物，再写 characters[]。禁止把下方示例或其他集的人物/地点/剧情抄进结果。
B. 不得只写男女主。必须包含：配角、对手、说书人、店小二、保镖、路人甲乙（只要本集剧本给了名字或固定称呼）、电话/画外音里的具名角色。
C. 旁白/画外音/OS 若无具体人物身份，不要当成角色；但「父亲（画外）」这种有身份的必须收录。
D. characters[].name 必须是**可称呼的人名或固定角色名**（如「沈倦」「码头更夫」「汤米·巴洛」），2–8 字，与剧本对白里的说话人一致。
   **禁止**把下列内容写成人物：
   - 类别词：「角色」「人物」「主角」「配角」「演员」
   - 对白/叙述句子：「他说选回自己」「由这些引步出来」
   - 舞台指示/动作链：「进房步转身，三个人走过来」「走过来」「转身」
   - 人名后粘音效：「苏国庆鸣」应拆成人物「苏国庆」+ 音效，不要当新人
   - 人名后粘动作/表情：「火焰玫瑰好心补充」「火焰玫瑰微带微笑」仍是「火焰玫瑰」，禁止新开卡
   - 画面/环境描写不是人名：「平原充满血丝」「天星生命引导」「暗流潜行冷气」
   - 无名字的外貌堆砌：「冷漠肥胖男人」不要单独建卡
   - 镜头动作（「眼睛动了一下」）、身体局部（「喉结」「眼神」「血丝」）、画面/字幕说明、构图/进度、场景状态、穿着描述（「戴头盔的德鲁」应归到「德鲁」的服装）
   - **同一人只写一条**：简称、化名、带服饰后缀都并入全名。例：「沈倦」「阿倦」「沈倦/黑衣信差」= 同一人，name 用「沈倦」，黑衣信差写入 costumes[]，禁止再开新卡。
   - **动物不是人物**：乌鸦、猫、狗、马、兔、平原兔等写入 creatures[]，禁止放 characters[]。不像人名的一律不要进人物。
   - **生物不是人**：creatures[] 的 name 是物种（平原兔），不是「兔子血条」；prompt 写动物，禁止人脸/服饰/骑手。
E. scene_beats[].cast_names 与 visual_events[].who 出现的人名，**必须能在 characters[] 找到同名条目**（简称算同一人）；禁止事件里有人、圣经里没有。
F. 建议先在心里完成「人物名单 checklist」，再展开外貌与音色；只收录真正的人物，宁可不收录画面说明。

5. characters[]（主+次凡出镜/说话都必须有独立条目；真人名宁多勿漏，画面说明一律不要）：
   {
     name, age, gender, role, identity, personality, backstory,
     visual: { face, hair, body, clothing, specialFeature },
     expression, materials,
     prompt,
     timbre, voiceStyle, language_style, emotion_range,
     sample_text
   }
   - age / gender 必填（gender 用 male/female 或 男/女）。次要角色也可根据语境合理推定年龄段与性别，禁止空着。
   - role 写清：男主/女主/配角/龙套/反派/说书人 等。
   - backstory 必须点明与本剧背景故事的关系（出身、立场、关键过往）；龙套可短，但不可空。
   - visual.body：高矮胖瘦、肩宽腰肢、体态。
   - visual.hair：发型 + 发色 + 发质。
   - visual.clothing：服饰款式、层次、配色、配饰、鞋履；穿搭必须锁题材时代。
   - visual.face：五官轮廓与辨识点。
   - expression：常驻表情/神情。
   - materials：可见材质质感。
   - visual.specialFeature：伤疤、首饰、纹身、道具随身等。
   - **prompt（120–280字中文生图提示词，禁止「待定」）必须写清楚**：
     年龄性别、高矮胖瘦、发型发色、服饰细节与穿搭、人物表情、材质质感；符合背景故事/身份。
   - **sample_text（必填，声音提示词）**必须按下列自然结构写，禁止 medium/sharp 等英文标签，禁止情绪/语速/音量/呼吸分条：
     {角色名}
     年龄：{如 32岁}
     性别：{男/女}
     音色描述：{口语化，如「甜美细声细语，嗓音偏软」或「粗放狂野，嗓音偏沉偏沙」}
     台词：
     {优先本集剧本该角色真实对白 2～3 句，每句一行；不足再补符合身份的可念句子}
   - **音色必须写清**（禁止「默认音色」「XXX音色」空壳）：
     timbre / voiceStyle 用中文口语描述；language_style / emotion_range 可简写。
   - **服装必须锁题材**：古装玄幻/武侠→中国古装或仙侠服饰；现代题材禁止无依据道袍襦裙。
   - **同一人物多种装扮**写入 costumes[]，禁止把「戴头盔的××」「穿制服的××」拆成新人物。
     costumes: [{ name, tag, prompt }]；tag 用 常服/制服/作战/礼服/家居/其他。
     prompt 只写这一套衣服（款式、颜色、材质、配饰），脸发型与主条目一致。无换装可省略或只写默认服装。
     每人 costumes ≤ 4。

6. scenes[]: {
     name, location, time_default, weather_default, mood,
     spatial_structure, lighting, fixed_elements[], prompt
   }
   - **一场一地点**：只按剧本真实换景列场景；同地点不同情绪不要拆成多景。scenes ≤ 8。
   - 空场景、无人物；空间结构、光影、固定陈设、材质必须写清。
   - prompt（120–220字）必须符合 project.worldview / plot / era。

7. props[]: { name, description, prompt }
   - **只列需要单独定妆参考图的「关键道具」**（剧情硬物件：武器、关键信物、特殊装备、剧情手机若需特写 UI）。
   - 禁止堆环境杂物：桌椅、门、霓虹、雨水、普通建筑构件不要进 props。
   - **同类只留 1 条**：多个手机→「智能手机」一条；多个外卖袋→「外卖保温袋」一条。props ≤ 5，宁缺毋滥；没有硬道具就输出 []。
   - prompt 写清材质、尺寸、颜色、时代特征；生图时会自动做成白底四视图，不必在 prompt 里写宫格。
8. creatures[]: 只放真正的非人动物/怪物 { name, appearance, behavior, prompt }。
   - name 必须是物种称呼（平原兔、乌鸦、黄狗），禁止「兔子血条」「草原兔血条」这种 UI 数值名。
   - prompt 必须写动物外形（毛色、耳、四肢、体型），禁止年龄/发型/服饰/骑手等人物定妆。
   - 禁止把人放进 creatures[]，禁止把猫狗鸟马兔放进 characters[]。
9. scene_beats[]: { scene_no, location_name, int_ext, day_night, weather, cast_names[], dramatic_goal, emotion, purpose, event, conflict, result }
   cast_names 必须列出该场**全部**出场人物（主+次），且每人已在 characters[]。
   **一场 = 一个地点/时间**，不是一个自然段。换地点、换楼层、室外↔室内必须新场，且新场第一条 visual_event 优先 establish（全景交代我们在哪）。

9b. visual_events[]（本阶段核心产出）：观众必须看见、理解或感受到的视觉事件。
   不要问「这段能用几镜」；要问「有多少件事必须被看见」。
   每项：{ i, id, loc, kind, pri, who, see, cut }
   - id 用 EV001、EV002… 与 i 对应
   - kind: establish|action|reaction|dialogue|reveal|emotional|transition|information|insert
   - pri: A 或 B。A=剧情硬事件（人物首次出场、换地点、关键道具/能力、信息揭示、冲突发生/结果、死伤、升级、关键对白）；B=视觉辅助（雨水、车流、皱眉、走路、氛围空镜）。不确定标 A。
   - see: 这一拍观众最该看什么（一句）
   - cut: 切点（new_action|action_done|eyeline|emotion|enter|exit|speaker|reveal|prop|space|time|emphasis|handoff）
   切点（满足任一就应新增事件）：新动作开始/完成、视线或注意力变、情绪变、人物进出、互动、说话人变、对白情绪变、信息/道具/环境首次出现、空间或时间变、叙事重点变、需强调表情/动作细节/屏幕UI、需为下一事件铺空间。
   复杂动作拆：准备→开始→执行→完成→结果反应。表演拆：动作→反应→再动作。禁止把「看手机+沉默+握拳+松开+骑走」写成一条。
   信息揭示（手机/屏幕/数值/差评/任务）必须单独事件，后面再跟人物反应事件。
   空间移动必须有：离开原空间 → 移动过程 → 到达新空间；禁止雨夜街直接跳进17楼房间。
   对白：每一完整对白事件单独一条；说话人变、信息重点、对方反应不得并进同一条。
   条目数约 {eventsTarget}（不少于 {eventsMin}），不要压缩成个位数。

9c. 【15秒高密度对齐 · 分析阶段即按出片密度写】
   - visual_events[].see 必须写满四要素：空间/机位 + 主体可见动作 + 光影暗示 + 声音/拟音暗示；每条约 25～55 字。
   - 禁止空泛句：「男人说话」「周一川反应」「两人对峙」——必须落到姓名、肢体与光影。
   - 示例 see：「金鼎1708，周一川将保温袋搁桌沿指尖擦水渍；台灯暖光照袋口，屏幕冷光切手背；落桌闷响、水滴砸桌。」
   - 后续分镜将把同地点连续约 3～6 条事件合并为一条 15 秒出片镜；事件层仍要细拆，但 see 须够密，便于合镜后直达 H3 时间线。

10. 不要写 shots。分镜建议由后续「事件→镜头」阶段生成。
11. 同地点同 scene_no；换地点递增。

输出骨架（字段示意；**禁止照抄示例人名/地点/剧情**；visual_events 须按预算写满）：
{"schemaVersion":"director-domain.v2","type":"director-drama-domain-analyze","project":{"name":"剧名","type":"竖屏短剧","style":"题材","worldview":"...","visual_style":"...","color_style":"...","era":"...","references":[]},"plot":"...","relationships":"...","script_keywords":["词1"],"scene_beats":[{"scene_no":"1","location_name":"地点","int_ext":"外","day_night":"夜","weather":"雨","cast_names":["角色A"],"dramatic_goal":"...","emotion":"..."}],"visual_events":[{"i":1,"id":"EV001","loc":"地点","kind":"establish","pri":"A","who":"","see":"交代空间","cut":"space"}],"characters":[{"name":"角色A","age":"28","gender":"male","role":"男主","identity":"...","personality":"...","backstory":"...","visual":{"face":"...","hair":"...","body":"...","clothing":"...","specialFeature":"..."},"expression":"...","materials":"...","prompt":"...","timbre":"...","voiceStyle":"...","language_style":"...","emotion_range":"...","sample_text":"角色A\\n年龄：28岁\\n性别：男\\n音色描述：...\\n台词：\\n句1。\\n句2。"}],"scenes":[{"name":"地点","location":"...","time_default":"夜","weather_default":"雨","mood":"...","spatial_structure":"...","lighting":"...","fixed_elements":["陈设"],"prompt":"空场景无人物..."}],"props":[],"creatures":[]}`;

export const DRAMA_DOMAIN_ANALYZE_USER_PROMPT_TEMPLATE = `请分析下列「本集」剧本并输出 director-drama-domain-analyze JSON。
视觉事件约：{eventsTarget}（不少于 {eventsMin}）
本阶段不要输出 shots。
全片视觉风格提示：{styleHint}
标题：{title}
{existingRoster}
重要（必须遵守）：
0) 只分析下面「剧本正文」这一集。系统示例里的人物、地点、剧情一律禁止照抄。未在本集正文出场的前集人物不要写入 plot / scene_beats / visual_events。
1) 先判断题材，再写 project.style、era、visual_style。project.name 只写剧名，不要带第几集。
2) **先做人物普查**：只把本集剧本里可称呼的人名/固定角色名写入 characters[]（主+配+龙套）。同一人的简称/斜杠后缀只保留全名一条，服饰写入 costumes[]。动物写入 creatures[]。禁止把类别词、对白句子、舞台指示、音效、镜头动作、画面说明、表情后缀当成人物。
3) **已有人物必须沿用原名**：若上方列出「项目已有人物」，本集出现的同一人必须用完全相同的 name，禁止改名、拆分或另造条目。本集新人才新增 name。未出场者只对名，不要写进本集事件。
4) JSON 字段顺序必须是：project → plot → scene_beats → visual_events → characters → scenes…。先写完所有视觉事件再写人物详情。
5) scene_beats.cast_names、visual_events.who 出现的人名必须都能在 characters[] 找到。
6) 每个人物 prompt 写清：年龄性别、高矮胖瘦、发型发色、服饰穿搭、表情、材质；并填写 timbre/voiceStyle；每人 sample_text 必须含名字、年龄、性别、口语化音色描述，以及剧本 2～3 句台词。
7) 场景 prompt 写清空间、材质、光影，服务剧情。已有场景也尽量沿用原名。换地点必须新场。
8) visual_events[].see 按「15秒高密度」写：空间+动作+光影+声音四要素，25～55 字/条，禁止空泛「某人说话/反应」。
9) 只输出一个 JSON 对象；不要代码块、不要解释；控制总长度，确保以 } 正常结束。
剧本正文：
{sourceText}`;

export function buildDramaDomainAnalyzeMessages(opts: {
  sourceText: string;
  title?: string;
  styleHint?: string;
  targetShotCount?: number;
  existingCharacterNames?: string[];
  existingSceneNames?: string[];
}): { systemPrompt: string; userPrompt: string } {
  const budget = estimateDramaAnalyzeShotBudget(opts.sourceText || '');
  const chars = (opts.existingCharacterNames || []).map((n) => String(n || '').trim()).filter(Boolean);
  const scenes = (opts.existingSceneNames || []).map((n) => String(n || '').trim()).filter(Boolean);
  const rosterLines: string[] = [];
  if (chars.length) rosterLines.push(`项目已有人物（仅供对名；本集出场须沿用原名，未出场者不要写入本集事件）：${chars.join('、')}`);
  if (scenes.length) rosterLines.push(`项目已有场景（沿用原名）：${scenes.join('、')}`);
  const existingRoster = rosterLines.length
    ? `${rosterLines.join('\n')}\n`
    : '';
  const fill = (s: string) =>
    s
      .replace(/\{eventsTarget\}/g, String(budget.eventsTarget))
      .replace(/\{eventsMin\}/g, String(budget.eventsMin))
      .replace(/\{styleHint\}/g, String(opts.styleHint || '电影感写实').trim())
      .replace(/\{title\}/g, String(opts.title || '').trim() || '未命名')
      .replace(/\{existingRoster\}/g, existingRoster)
      .replace(/\{sourceText\}/g, String(opts.sourceText || '').trim());
  return {
    systemPrompt: fill(DRAMA_DOMAIN_ANALYZE_SYSTEM_PROMPT),
    userPrompt: fill(DRAMA_DOMAIN_ANALYZE_USER_PROMPT_TEMPLATE),
  };
}

export function buildDramaDomainAnalyzeCompactMessages(opts: {
  sourceText: string;
  title?: string;
  styleHint?: string;
}): { systemPrompt: string; userPrompt: string } {
  const budget = estimateDramaAnalyzeShotBudget(opts.sourceText || '');
  const title = String(opts.title || '').trim() || '未命名';
  const styleHint = String(opts.styleHint || '电影感写实').trim();
  const source = String(opts.sourceText || '').trim();
  return {
    systemPrompt: `你只输出一个合法 JSON 对象，不要 Markdown，不要解释，不要 shots。
schemaVersion 必须是 "director-domain.v2"；type 必须是 "director-drama-domain-analyze"。
字段顺序：project, plot, scene_beats, visual_events, characters, scenes, props。
- project: {name, type, style, era, visual_style, worldview}
- scene_beats: [{scene_no, location_name, int_ext, day_night, weather, cast_names, dramatic_goal, emotion}]，场次≤8
- visual_events: [{i, id, loc, kind, pri, who, see, cut}]，pri 为 A/B，id 用 EV001 起，至少 ${budget.eventsMin} 条（目标 ${budget.eventsTarget}）；宁可少而完整，禁止写到一半截断
- characters: [{name, age, gender, role, identity, personality, prompt, timbre, sample_text}]，prompt≤60字，角色≤10
- scenes: [{name, location, prompt}]，场景≤8
- props: [{name, description, prompt}]，**仅关键定妆道具≤5**，同类合并（多个手机只一条），无硬道具输出 []
先写完 scene_beats 和 visual_events，再写人物。换地点必须新场+establish。控制总长，确保以 } 结束。`,
    userPrompt: `标题：${title}
风格：${styleHint}
请只分析下面这一集的剧本正文，不要沿用示例或其他集剧情。visual_events 不少于 ${budget.eventsMin} 条。以 } 结束。
${source}`,
  };
}
