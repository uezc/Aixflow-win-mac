/**
 * 第二阶段：Visual Events → 导演可执行的分镜建议。
 * 不负责项目圣经 / 人物普查；只做事件→镜头。
 */

import type { DramaAnalyzeShotBudget, DramaVisualEvent } from '../shotPlanning.js';
import type { DramaSceneBeat, DramaShotPlanPaceGear } from '../types.js';
import { normalizeDramaShotPlanPaceGear } from '../types.js';
import { DRAMA_CAMERA_MOVE_SHOT_PLAN_RULES } from './cameraMoveHandbook.js';

/**
 * 15秒高密度（分析/分镜默认）：一镜≈15s，镜内时间子窗承载对白与微相，对齐 H3 出片密度。
 */
export const DRAMA_SHOT_PLAN_PACE_DENSE_15S = `【角色设定：15秒高密度导演 · 覆盖上文一切冲突规则】
你是电影级短剧导演。任务：把 Visual Events 合并为可直接出 H3 的 15 秒段落镜。
座右铭：一镜一段落，镜内用时间子窗写清表演；不要碎切成 6 秒快切。
世界观：每镜 action 即镜内时间轴；对白落在子窗；光影/拟音与动作同密度。

【15秒高密度硬规则 · 强制执行 · 最高优先】
1. 合镜：同地点、连续、情绪不断层的 3～8 个事件 → 合并为 1 镜（duration_sec=15）。
2. 时长：默认 15；单事件落点/信息闪现可用 10；完整长段落极少用 20。本集 ≥65% 镜必须为 15。
3. 镜内时间轴（写在 action 字段，强制）：
   - 15s 镜拆 2×6s 全窗 + 1×3s 收束，或 3×5s；每窗含空间+动作+微表情+光影+拟音。
   - 对白写子窗：例 [10.5-12s] 程序员客户说：「超时多久了？」
   - 禁止把整场对白压进一句概括；禁止镜外再拆 6s 反应镜（反应写进同镜子窗）。
4. 对白：每镜 1～3 句，落在子时间窗；dialogue[] 同步列出本镜全部台词。
5. expression：物理微相串，禁止抽象情绪词。
6. lighting/sfx：每镜必填，按子窗变化（台灯暖 vs 屏幕冷光切割）。
7. 赶路段：同一路程最多 1 镜 15s；pri=B 可压缩但不得丢掉 A 类硬事件。
8. 总镜数 ≈ visual_events 的 20%～35%；禁止为切而切，也禁止 2～3 镜吞全集。`;

/**
 * 短剧爆款导演人设 + 快节奏铁律（强制）。
 * 成片时长档仍是 6/10/15/20。
 *
 * 核心修正（2026-08）：禁止「赶路堆镜、对话并成一镜」。
 * 对话场景必须细切（说话人 + 反应镜交替）；赶路/过渡必须粗切。
 */
export const DRAMA_SHOT_PLAN_PACE_SHORT_DRAMA = `【角色设定：短剧爆款导演 · 覆盖上文一切冲突规则】
你是拥有 10 年一线经验的微短剧爆款导演。任务：把小说叙事转成强视觉、快节奏、高爽感的竖屏分镜。
座右铭：观众没有耐心；对话是爽点，赶路是成本。
世界观：情绪前置、逻辑后置；每镜至少 1～2 个信息点；拒绝文艺腔与无意义留白。

【短剧快节奏硬规则 · 强制执行 · 最高优先】
1. 场景/镜头配额（硬）：
   - 有对白的场景（对话/对峙/谈判）→ 分配 ≥50% 的镜头数
   - 无对白赶路/环境/过渡（街头奔波、大堂、电梯、走廊、门口）→ 合计 ≤30% 的镜头数
   - 禁止为了「凑镜头」把同一赶路动作拆成 4～8 镜

2. 对话切镜（硬）：
   - 每 2～3 句有信息量的对白必须切一次镜（允许同一地点多镜）
   - 每段对话必须「说话人镜头 + 听话人反应镜头」交替
   - 关键情绪动作（攥拳又松开 / 喉结动 / 闭眼 / 点屏差评）必须单独成镜
   - 禁止把整场 8～10 句对白压进 1 镜（即使写了【极速正反打】时间轴也不算合规）

3. 砍场景（硬）：
   - 同一人物同一赶路动作：最多 1～2 镜（建立环境 + 进门/落点）
   - 电梯/走廊/大堂/门口等过渡空间：能合并就合并，合计 ≤1～2 镜
   - 只保留四类：建立环境、人物出场、对话核心、情绪收尾

4. 总镜数：1 分钟级短剧约 10～15 镜；平均每镜叙事密度高；禁用 15/20。

铁律 A·赶路粗切：
- 雨夜街头：最多 2 镜（跟拍赶路 / 手机超时特写急停）
- 写字楼内过渡：最多 1 镜（电梯镜面或冲进门厅落点）
- 走廊/敲门：能并入室内开场就删独立走廊镜

铁律 B·对话细切：
- 室内对峙核心场：目标 ≥40%～60% 总镜数
- 例：推门见人→男人指责→周一川反应→男人宣布差评→攥拳又松开离开
- dialogue 每镜只放本镜 1～3 句；反应镜 dialogue 可为 []，但 action/expression 必须写出可见反应

铁律 C·情绪只写物理微相：
- 禁止：隐忍、焦虑、冷漠、麻木、愤怒、疲惫、无奈等抽象词
- 强制：眉心紧锁 / 喉结硬滚 / 拳攥紧又松开 / 瞳孔放大

铁律 D·镜头运动：
- 禁止连续 ≥2 镜 move 只写固定/静帧
- 本集至少 3 个重点镜含「手持急推」「快速拉近」或「甩镜」
- 禁止无人机慢下摇、长全景雨景连铺

铁律 E·冲突前置：
- 开场 1～2 镜内进入冲突点（迟到/差评/对峙）。纯雨景/路况建立镜优先删除或压成 0～1 镜
- pri=B 的雨水/车流/走路辅助事件允许 0% 覆盖

时长：赶路/落点优先=6；对白单镜=6（或必要时 10）；禁用 15/20；总时长压缩≥30%。`;

/** 正剧细致感：留白、光影、呼吸感 */
export const DRAMA_SHOT_PLAN_PACE_CINEMATIC = `【导演指令：正剧细致感】
全片采用正剧/电影质感，强调氛围铺垫与视觉留白。
镜头运动：优先缓推、慢横移、或完全固定；强调稳重构图与几何美感。
景别：先全景交代环境压迫/空间关系，再切特写心理微相（咽口水、指尖颤等）。
光影：必须写清光源（霓虹/手机冷光/路灯/监控灯等）；可用低照度明暗交界、逆光/侧逆光勾轮廓。
节奏：单镜可偏 10/15；允许停顿、犹豫、气息变化；sfx 含细腻环境氛围音。
禁止为了快而碎切；建立镜与情绪镜必须留足呼吸。`;

/** 15秒高密度加厚：保持镜内时间轴密度，禁止扩回碎切 */
export const DRAMA_SHOT_PLAN_ENRICH_PACE_DENSE_15S = `【加厚挡位：15秒高密度 · 覆盖手册冲突项】
- 禁止把 15s 镜加厚时拆成多镜；保持 duration_sec 与 event_ids 不变。
- action 必须扩成镜内时间子窗（[0-6s]…[6-12s]…[12-15s]），每窗四要素齐全。
- 对白子窗与 dialogue[] 对齐；反应写进同镜子窗，禁止另开反应镜。
- expression/lighting/sfx 按子窗细化，禁止抽象情绪词。`;

/** 短剧加厚时覆盖运镜手册里的「过程链 / 抽象情绪 / 对话并成一镜」写法 */
export const DRAMA_SHOT_PLAN_ENRICH_PACE_SHORT_DRAMA = `【加厚挡位：短剧爆款导演 · 覆盖手册冲突项】
- 禁止把 action 扩成过程链；只保留爆发落点 + 物理微相。
- 禁止把多镜对白「加厚」合并回单镜；保持说话人/反应镜交替结构。
- 反应镜必须写清可见微相（攥拳又松开、喉结动、点屏），禁止空表情。
- expression：禁止抽象情绪词；只写物理微相。
- move：冲突对白改成手持急推/快速拉近；禁止连续固定。
- sfx：具体冲击力 Foley。
- 句子短粗干练。`;

export function dramaShotPlanPaceGearDirective(gear: DramaShotPlanPaceGear | unknown): string {
  const g = normalizeDramaShotPlanPaceGear(gear);
  if (g === 'cinematic') return DRAMA_SHOT_PLAN_PACE_CINEMATIC;
  if (g === 'short_drama') return DRAMA_SHOT_PLAN_PACE_SHORT_DRAMA;
  return DRAMA_SHOT_PLAN_PACE_DENSE_15S;
}

export function dramaShotPlanPaceGearLabel(gear: DramaShotPlanPaceGear | unknown): string {
  const g = normalizeDramaShotPlanPaceGear(gear);
  if (g === 'cinematic') return '正剧细致感';
  if (g === 'short_drama') return '短剧快切';
  return '15秒高密度';
}

export function dramaShotPlanGearRuleBlocks(gear: DramaShotPlanPaceGear | unknown): {
  mergeRules: string;
  locationRules: string;
  durationRules: string;
  actionFieldRule: string;
  expressionFieldRule: string;
  signatureRules: string;
  userDurationHint: string;
  auxEventCoverage: string;
  fieldLimitRule: string;
  paceAcceptanceHint: string;
  paceExampleShots: string;
} {
  if (normalizeDramaShotPlanPaceGear(gear) === 'dense_15s') {
    return {
      mergeRules: `5. 一镜 = 一个 15 秒连续视觉段落：同地点连续 3～8 个 visual events 合并为一镜。
   强制镜内时间轴：action 用 [0-6s]…[6-12s]…[12-15s]（或 3×5s）写清空间、动作、微表情、光影、拟音。
   对白落在子窗（如 [10.5-12s] 角色说：「…」），dialogue[] 列出本镜全部台词。
   禁止为每句对白/每个反应单独开镜；禁止 6 秒碎切。`,
      locationRules: `7. 换地点：新空间第一镜必须 dramatic_purpose=establish 或 transition。禁止雨夜街直接切进 17 楼办公室。同楼内门口→大厅→电梯→走廊可合并为 1 镜 15s 过渡。`,
      durationRules: `8. duration_sec 只能是 6 / 10 / 15 / 20。15秒高密度强制：
   - 默认 =15；单事件落点/信息闪现 =10；完整长段落极少 =20
   - 本集 ≥65% 镜 =15
   - duration_why 例：「办公室对峙段落」「便利店喘息段落」「镜内双对白+反应」`,
      actionFieldRule:
        '- action = 镜内时间轴正文（含子窗时间标记 + 四要素）。禁止一句概括整场戏。',
      expressionFieldRule:
        '- expression = 物理微相串，可按子窗写「[6-12s]眉心拧紧/嘴角下压」。禁止隐忍/焦虑等抽象词。',
      signatureRules: `11. 人设档案是执行手册：
   - purpose 点名 core_desire/core_fear；blocking 写权力关系。
   - dialogue[].text 只写可说出台词；潜台词写 subtext。
   - lighting/sfx 按子窗变化；move 从手册选命名手法。
   - 同一角色标志性动作全片一致。`,
      userDurationHint:
        '合镜为 15 秒段落；镜内写时间子窗；≥65% 镜用 15；每镜 1～3 句对白落在子窗内。',
      auxEventCoverage:
        'pri=B 允许 0%～50% 覆盖以便压缩赶路，但 pri=A 硬事件必须 100% 入镜。',
      fieldLimitRule:
        '12. 本阶段 action 可写满镜内时间轴（≤220 字）；purpose/expression 各 ≤100 字。更细微相由加厚补全。',
      paceAcceptanceHint:
        '验收：≥65% 镜 duration_sec=15；action 含镜内时间子窗；禁止 6 秒碎切堆镜。',
      paceExampleShots: `{
    { "shot_no": "1", "scene_no": "2", "scene": "金鼎1708办公室", "duration_sec": 15, "duration_why": "办公室对峙开端段落", "dramatic_purpose": "dialogue", "visual_focus": "保温袋落桌与客户质问", "purpose": "C-01 core_fear（被否定）在对峙中被激活", "size": "中景", "angle": "平视", "move": "手持缓推压近桌沿", "action": "[0-6s]周一川站桌外将保温袋搁桌沿指尖擦水渍，眼皮低垂指节蜷起；台灯暖光照袋口屏幕冷光切手背；落桌闷响水滴砸桌。[6-12s]程序员客户隔显示器抬眼眉心拧紧；冷屏光托脸台灯硬边勾轮廓；键盘停键椅轮轻响。[10.5-12s]客户说：「超时多久了？」[12-15s]周一川盯水渍吸气卡住瞳孔缩紧缓慢抬眼；滞住呼吸水滴落地。", "expression": "[0-6s]嘴唇发白指节蜷起；[12-15s]瞳孔缩紧湿睫毛轻颤", "time_of_day": "深夜", "environment": "夜班办公室三台显示器", "lighting": "台灯暖光vs屏幕冷光切割半脸", "sfx": "落桌闷响、键盘停键、椅轮、风扇低鸣", "dialogue": [{ "character_name": "程序员客户", "text": "超时多久了？" }, { "character_name": "周一川", "text": "雨太大了。" }], "cast_names": ["C-01 周一川", "程序员客户"], "event_ids": ["EV010", "EV011", "EV012"], "transition_in": "硬切", "transition_out": "切下一段落" }
  }`,
    };
  }
  if (normalizeDramaShotPlanPaceGear(gear) === 'cinematic') {
    return {
      mergeRules: `5. 一镜 = 一个明确导演意图：1 个主要叙事目的 + 最多 1～2 个辅助动作。
   可合并：连续、同空间、同目的、同运动方向、情绪不变。
   禁止合并：信息揭示+人物反应；质问+回答+打断；建立空间+人物动作。`,
      locationRules: `7. 换地点：新空间第一镜必须 dramatic_purpose=establish 或 transition（全景交代我们在哪）。禁止雨夜街直接切进 17 楼办公室。同楼内门口→大厅→电梯→走廊算连续，不必每步都新开 establish。`,
      durationRules: `8. duration_sec 只能是 6 / 10 / 15 / 20，必须按信息量选，禁止连续十几镜全是 6 秒；每镜必须另写 duration_why：
   - 环境建立 / 信息闪现（手机屏幕）/ 单纯反应 → 6
   - 赶路、单句对白、中等动作 → 10
   - 对白冲突、复杂动作（多步击打/升级） → 15
   - 一个完整视觉段落才用 20（极少）`,
      actionFieldRule:
        '- action = 画面动作：至少 2 个连续可见身体动作（加厚阶段再扩到 3–5 个）。禁止只写「低头快步冲进」。',
      expressionFieldRule:
        '- expression = 演员情绪，格式 [主导情绪]（微表情/肢体1/肢体2）；转折写「从A转向B（…）」。禁止单字「焦虑」。',
      signatureRules: `11. 人设档案是执行手册，不是参考读物。有档案时必须执行：
   - action 禁止只写「看手机/走路/推门」。触发条件匹配时必须调用 signature_actions / action_index 里的强制动作（如推陌生门→用手背试门板温度）。
   - expression 按第 9 条格式，从 emotion_signals 展开。
   - purpose 必须点名被触发的 core_desire 或 core_fear。
   - dialogue[].text 只写可说出台词原文；潜台词写 dialogue[].subtext，禁止把【潜台词】塞进 text（否则会被念出来）。
   - lighting / sfx / move 从该角色 scene_anchor 继承，再按运镜手册升级，禁止裸写「固定/跟拍」。
   - blocking 写站位与权力关系（谁画左低位/谁画右高位）。
   - 无对白 ≠ 无表演：从 emotion_signals 展开麻木/压抑等肢体，sfx 只留环境与 Foley。
   - 同一角色标志性动作全片必须一致。`,
      userDurationHint:
        '时长按信息量选 6/10/15/20 并写 duration_why，并服从上方节奏挡位。',
      auxEventCoverage:
        'pri=B 的辅助事件允许 80%～90%（雨水/车流/走路可压缩，但不能整段丢掉）。',
      fieldLimitRule:
        '12. 本阶段字段可以写满，但每镜 action/purpose/expression 各 ≤ 80 字，防止 JSON 截断。更细的微相由后续按镜加厚补全。',
      paceAcceptanceHint:
        '验收：建立/情绪镜留呼吸；时长按信息量选 10/15/20。',
      paceExampleShots: `{
    { "shot_no": "1", "scene_no": "1", "scene": "雨夜街头", "duration_sec": 10, "duration_why": "赶路段落", "dramatic_purpose": "action", "visual_focus": "电动车穿车流", "purpose": "C-01 core_desire（准时送达）驱动冲刺", "size": "低角度", "angle": "低角度", "move": "手持缓跟", "action": "车灯甩雨，车身穿车缝冲出", "expression": "腮帮紧咬，雨水糊脸", "time_of_day": "深夜", "environment": "雨夜车流积水", "lighting": "霓虹倒影+车灯扫脸", "sfx": "雨声+引擎轰鸣", "dialogue": [], "cast_names": ["C-01 周一川"], "event_ids": ["EV001"], "transition_in": "硬切", "transition_out": "切门口" }
  }`,
    };
  }
  return {
    mergeRules: `5. 一镜 = 一个爆发落点，或一段「2～3 句对白 + 绑定微相」，或一个独立反应镜。
   强制细切对白：同一场有信息量的对白必须拆成多镜；每 2～3 句切一次；说话人镜与听话人反应镜交替。
   关键情绪动作（攥拳又松开/喉结动/点屏差评）必须单独成镜。
   强制粗切赶路：雨夜街头 ≤2 镜；大堂/电梯/走廊合计 ≤1～2 镜；禁止把「赶路」拆成 4+ 镜。
   配额硬指标：有对白相关镜（含反应镜）≥50%；纯赶路/过渡镜 ≤30%。`,
    locationRules: `7. 冲突前置：开场 1～2 镜必须到冲突点。禁止无人机/全景雨景/路况连铺 ≥2 镜。大厦外观/电梯/走廊过渡尽量合并为 0～1 镜。pri=B 雨水/车流/走路可 0% 覆盖。establish 最多 1 镜且优先中近景。`,
    durationRules: `8. duration_sec 只能是 6 / 10 / 15 / 20。短剧强制：
   - 单句/双句对白镜、反应镜、赶路落点 → 优先 =6
   - 本集 ≥70% 镜 =6；几乎禁用 15/20；少用 10
   - 总 duration 压缩 ≥30%
   duration_why 例：「对白切镜」「反应镜」「赶路落点」「冲突硬切」。`,
    actionFieldRule:
      '- action = 落点短句；对白镜写清本镜说话人可见动作+1～3句台词落点；反应镜写清微相（禁止空脸）。禁止把整场对白塞进一镜时间轴。',
    expressionFieldRule:
      '- expression = 只写物理微表情串。禁止隐忍/焦虑/冷漠/麻木/愤怒/无奈等抽象词。',
    signatureRules: `11. 人设欲望/恐惧仍要点名，短剧改写：
   - 过程 signature → 结果落点。
   - 对白细切多镜；dialogue 每镜 1～3 句；反应镜可空 dialogue。
   - move：对白冲突必须手持急推怼脸/快速拉近；禁止连续固定；本集至少 3 处急推/甩镜。
   - expression 只写物理微相；sfx 具体有冲击力。`,
    userDurationHint:
      '对白细切（≥50% 镜服务对话/反应），赶路粗切（≤30%）；每 2～3 句切镜；关键微相单独成镜。冲突前置砍雨景。至少 3 处手持急推/快速拉近。≥70% 用 6。',
    auxEventCoverage:
      '短剧挡位：pri=B（雨水/车流/走路/空镜）允许 0%～50% 覆盖，可整段丢掉以砍前戏。',
    fieldLimitRule:
      '12. 本阶段字段可以写满，但每镜 action/purpose/expression 各 ≤ 80 字，防止 JSON 截断。更细的微相由后续按镜加厚补全。',
    paceAcceptanceHint:
      '验收：服务对话/对峙/反应的镜头 ≥50%；纯赶路/过渡 ≤30%；≥70% 镜 duration_sec=6。',
    paceExampleShots: `{
    { "shot_no": "1", "scene_no": "1", "scene": "雨夜街头", "duration_sec": 6, "duration_why": "赶路落点", "dramatic_purpose": "action", "visual_focus": "电动车穿车流", "purpose": "C-01 core_desire（准时送达）驱动冲刺", "size": "低角度", "angle": "低角度", "move": "手持跟拍急推", "action": "车灯甩雨，车身穿车缝冲出", "expression": "腮帮紧咬，雨水糊脸", "time_of_day": "深夜", "environment": "雨夜车流积水", "lighting": "霓虹倒影+车灯扫脸", "sfx": "雨声+引擎轰鸣", "dialogue": [], "cast_names": ["C-01 周一川"], "event_ids": ["EV001"], "transition_in": "硬切", "transition_out": "切门口" },
    { "shot_no": "2", "scene_no": "2", "scene": "1708室内", "duration_sec": 6, "duration_why": "对白切镜", "dramatic_purpose": "dialogue", "visual_focus": "男人指责", "purpose": "C-01 core_fear（被否定）被质问钉住", "size": "中景", "angle": "平视", "move": "手持急推怼脸", "action": "男人抬手指向门口，吐字砸下「迟到十三分钟」", "expression": "眉心拧死，嘴角下撇", "time_of_day": "深夜", "environment": "开敞办公区夜班屏幕", "lighting": "屏幕冷光打半脸", "sfx": "键盘停", "dialogue": [{ "character_name": "男人", "text": "你迟到了十三分钟。" }], "cast_names": ["男人", "C-01 周一川"], "event_ids": ["EV010"], "transition_in": "硬切", "transition_out": "切反应" }
  }`,
  };
}

export const DRAMA_DOMAIN_SHOT_PLAN_SYSTEM_PROMPT = `你是短剧分镜导演。任务：把已确认的 Visual Events 转成可拍摄的 shots JSON。短剧挡位时你必须切换为「短剧爆款导演」人设，并严格执行第 14 条铁律（覆盖冲突规则）。

规则：
1. 只输出合法 JSON，不要 Markdown，不要代码块，不要解释。
2. schemaVersion 必须是 "director-domain.v2"；type 必须是 "director-drama-domain-shot-plan"。
3. 顶层只有：schemaVersion, type, shots。
4. 本集镜头预算：目标 {targetShotCount} 镜，允许 {shotsMin}–{shotsMax}。尽量靠近目标；短剧挡位为对切可贴近上限，禁止压成 2～3 镜，也禁止无意义空镜。
{mergeRules}
6. 每个 shot 必须带 event_ids。pri=A 的硬事件必须 100% 被至少一镜覆盖。{auxEventCoverage}
{locationRules}
{durationRules}
9. shots[] 每项：
   { shot_no, scene_no, scene, duration_sec, duration_why, dramatic_purpose, visual_focus, purpose, size, angle, move, action, expression, lighting, blocking, time_of_day, environment, dialogue:[{character_name,text,subtext}], sfx, cast_names[], transition_in, transition_out, event_ids[] }
   {actionFieldRule}
   {expressionFieldRule}
   - purpose = 镜头目的：除纯建立镜外必须含「触发[角色]的 core_desire/core_fear（具体内容）」。禁止「表现紧迫感/暗示无力感」。禁止把 purpose 写成 action 的复述。
   - move 必须是命名手法，格式 [设备]+[运动方式]+[速度/节奏]+[情绪意图]。
   - time_of_day 必填，只能从下列择一（据剧情/场次/对白推断，禁止空、禁止写光影技术词）：朦胧亮 | 日出 | 正午 | 下午 | 傍晚 | 晚上 | 深夜 | 黎明。同场连续镜时段须一致，跨场才可跳变。
   - environment 必填，≤20 字：天气+室内外+可见景物简述（例：雨夜写字楼外积水；白天便利店冷柜灯）。禁止复述 lighting。
   - lighting 按地点变化：雨夜=霓虹倒影+水面反射；电梯=冷白荧光+镜面光斑；室内=暖台灯 vs 屏幕冷光切割。禁止全表「冷光」。lighting 是用光技术，不要写「深夜」「傍晚」——时段只写在 time_of_day。
   - sfx 必填：环境底噪+物理 Foley。
   - cast_names 写成「C-01 周一川」，必须带人设编号。
   - dramatic_purpose: establish|introduce|action|reaction|dialogue|reveal|emotional|transition|information|environment|insert
   - scene 写地点名，与 visual_events.loc / scene_beats.location_name 对齐
   - dialogue 无台词用 []；短剧挡位：每镜 dialogue 只放本镜 1～3 句；反应镜可用 []；禁止整场对白压进单镜
10. 不要发明 Visual Events 里没有的大情节；不要输出 characters/scenes/project。
{signatureRules}
{fieldLimitRule}
13. ${DRAMA_CAMERA_MOVE_SHOT_PLAN_RULES}
14. {paceGearDirective}
（若第 14 条与上文运镜/动作/情绪规则冲突，以第 14 条与挡位改写规则为准。）

缩略示例仅作 schema 参考；真实输出必须覆盖硬事件，条数按预算。
{
  "schemaVersion": "director-domain.v2",
  "type": "director-drama-domain-shot-plan",
  "shots": [
    {paceExampleShots}
  ]
}
`;

export const DRAMA_DOMAIN_SHOT_PLAN_USER_PROMPT_TEMPLATE = `请把下列 Visual Events 转成 director-drama-domain-shot-plan JSON。
当前节奏挡位：{paceGearLabel}
{paceGearDirective}
镜头预算：目标 {targetShotCount}（{shotsMin}–{shotsMax}）。
{paceAcceptanceHint}
pri=A 硬事件必须 100% 覆盖；pri=B（雨水/车流/走路）按挡位规则压缩。
action / purpose 按挡位规则写；运镜禁止裸写「固定/跟拍/推/拉」；cast_names 写成「C-01 周一川」；sfx 必填；每镜必填 time_of_day（朦胧亮/日出/正午/下午/傍晚/晚上/深夜/黎明）与 environment（环境简述）；光线按地点变化禁止全冷光。
{userDurationHint}
{retryHint}
标题：{title}
场次：
{beatsJson}
视觉事件：
{eventsJson}
人物（仅供对白人名对齐）：{characterNames}
人设档案（拆镜时遵守欲望/恐惧/标志动作/对白/锚点；无则忽略）：
{characterDossier}
场景：{sceneNames}
视觉风格：{styleHint}
只输出一个 JSON 对象。`;

export function buildDramaDomainShotPlanMessages(opts: {
  title?: string;
  styleHint?: string;
  budget: DramaAnalyzeShotBudget;
  visualEvents: DramaVisualEvent[];
  sceneBeats: DramaSceneBeat[];
  characterNames?: string[];
  sceneNames?: string[];
  characterDossier?: string;
  retryHint?: string;
  /** 短剧快节奏 / 正剧细致感 */
  paceGear?: DramaShotPlanPaceGear | string;
}): { systemPrompt: string; userPrompt: string } {
  const b = opts.budget;
  const paceGear = normalizeDramaShotPlanPaceGear(opts.paceGear);
  const paceGearDirective = dramaShotPlanPaceGearDirective(paceGear);
  const paceGearLabel = dramaShotPlanPaceGearLabel(paceGear);
  const gearRules = dramaShotPlanGearRuleBlocks(paceGear);
  const eventsJson = JSON.stringify(
    (opts.visualEvents || []).map((e) => ({
      id: e.event_id,
      i: e.index,
      loc: e.location,
      kind: e.kind,
      pri: e.priority || 'A',
      who: e.who,
      see: e.see,
      cut: e.cut,
    })),
  );
  const beatsJson = JSON.stringify(
    (opts.sceneBeats || []).map((beat) => ({
      scene_no: beat.scene_no,
      location_name: beat.location_name,
      int_ext: beat.int_ext,
      day_night: beat.day_night,
      weather: beat.weather,
      dramatic_goal: beat.dramatic_goal,
      emotion: beat.emotion,
    })),
  );
  const fill = (s: string) =>
    s
      .replace(/\{targetShotCount\}/g, String(b.shotsTarget))
      .replace(/\{shotsMin\}/g, String(b.shotsMin))
      .replace(/\{shotsMax\}/g, String(b.shotsMax))
      .replace(/\{paceGearDirective\}/g, paceGearDirective)
      .replace(/\{paceGearLabel\}/g, paceGearLabel)
      .replace(/\{mergeRules\}/g, gearRules.mergeRules)
      .replace(/\{locationRules\}/g, gearRules.locationRules)
      .replace(/\{durationRules\}/g, gearRules.durationRules)
      .replace(/\{actionFieldRule\}/g, gearRules.actionFieldRule)
      .replace(/\{expressionFieldRule\}/g, gearRules.expressionFieldRule)
      .replace(/\{signatureRules\}/g, gearRules.signatureRules)
      .replace(/\{userDurationHint\}/g, gearRules.userDurationHint)
      .replace(/\{auxEventCoverage\}/g, gearRules.auxEventCoverage)
      .replace(/\{fieldLimitRule\}/g, gearRules.fieldLimitRule)
      .replace(/\{paceExampleShots\}/g, gearRules.paceExampleShots);
  return {
    systemPrompt: fill(DRAMA_DOMAIN_SHOT_PLAN_SYSTEM_PROMPT),
    userPrompt: fill(DRAMA_DOMAIN_SHOT_PLAN_USER_PROMPT_TEMPLATE)
      .replace(/\{paceAcceptanceHint\}/g, gearRules.paceAcceptanceHint)
      .replace(/\{title\}/g, String(opts.title || '').trim() || '未命名')
      .replace(/\{styleHint\}/g, String(opts.styleHint || '电影感写实').trim())
      .replace(/\{beatsJson\}/g, beatsJson)
      .replace(/\{eventsJson\}/g, eventsJson)
      .replace(/\{characterNames\}/g, (opts.characterNames || []).join('、') || '无')
      .replace(
        /\{characterDossier\}/g,
        String(opts.characterDossier || '').trim() || '无',
      )
      .replace(/\{sceneNames\}/g, (opts.sceneNames || []).join('、') || '无')
      .replace(/\{retryHint\}/g, String(opts.retryHint || '').trim() ? `\n【重试】${opts.retryHint}\n` : ''),
  };
}
