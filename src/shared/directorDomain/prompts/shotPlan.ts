/**
 * 第二阶段：Visual Events → 导演可执行的分镜建议。
 * 不负责项目圣经 / 人物普查；只做事件→镜头。
 */

import type { DramaAnalyzeShotBudget, DramaVisualEvent } from '../shotPlanning.js';
import type { DramaSceneBeat, DramaShotPlanPaceGear, DramaShotIntent } from '../types.js';
import { normalizeDramaShotPlanPaceGear } from '../types.js';
import {
  DRAMA_ANTI_DILUTION_RULE_LINES,
  DRAMA_DENSE_20S_BEAT_WINDOWS,
  DRAMA_DENSE_20S_MAX_DIALOGUE_CHARS_PER_SEGMENT,
  DRAMA_DENSE_20S_SEGMENT_DURATION,
  DRAMA_NARRATIVE_PLANNING_RULES,
} from '../shotPlanning.js';
import { DRAMA_CAMERA_MOVE_SHOT_PLAN_RULES } from './cameraMoveHandbook.js';
import { DRAMA_H3_CRAFT_SHOT_PLAN_RULES } from './h3VideoCraftHandbook.js';
import { DRAMA_H3_TIMING_SOUND_SHOT_PLAN_RULES } from './h3TimingSoundHandbook.js';

// 把共享反拖沓规则拼成注入用段落（所有挡位统一注入，覆盖冲突规则）
const ANTI_DILUTION_INJECT = `${DRAMA_ANTI_DILUTION_RULE_LINES.join('\n')}`;

/**
 * 20秒长视频高密度（新）：一条 20s 长视频内部 4-6 节拍快节奏。
 * 座右铭：一条长视频内部快节拍，不碎切、不慢推。
 * 保留 shots[] 作为兼容视图（每个 beat 映射为一个 shot，shot.video_id = VSxxx），
 * 同时产出 video_segments[] 作为权威结构（含 beats[] 节拍级详情）。
 */
export const DRAMA_SHOT_PLAN_PACE_DENSE_20S = `【角色设定：20秒长视频高密度导演 · 覆盖上文一切冲突规则 · 反拖沓规则共享·强制执行】
${ANTI_DILUTION_INJECT}
你是电影级竖屏长视频高密度导演。任务：把 Visual Events 组合为 ${DRAMA_DENSE_20S_SEGMENT_DURATION}s 一条的独立可成片视频段，段内 5 个节拍快节奏推进；不要拆成 6s 短镜拼接（会碎、有接缝、不连贯），也不要把 20s 撑成慢推长镜。
座右铭：一条长视频内部快节拍，不碎切、不慢推；节奏靠节拍切换，不靠长镜硬撑。
世界观：每个 VideoSegment = 一个完整的 20s 出片单元，一次生成；段内 beats[5] 是内部节奏骨架，节拍间用快切/动作打断/光影突变衔接。

【20秒高密度硬规则 · 强制执行 · 最高优先】
0. **对白完整性铁律（最高优先 · 覆盖一切冲突规则）**：
   - 剧本中每一句人物对白、旁白、画外音(VO/OS)、内心独白必须逐字出现在某个 beat 的 dialogue 中，禁止省略、概括、改写、合并任何一句。
   - 剧本有 N 句对白（含旁白/画外音/内心独白） → 所有 video_segment 的 beats[].dialogue.line 合计必须有 N 句。
   - 旁白/画外音/内心独白的 speaker 填「旁白」「画外音」或具体说话人名（如「父亲（画外）」）。
   - **原文每一句独立对白必须是一个独立 beat 的 dialogue，禁止把多句原文对白合并成同一条 dialogue.line**。
   - 单段总对白字数 ≤ ${DRAMA_DENSE_20S_MAX_DIALOGUE_CHARS_PER_SEGMENT} 字（4.5 字/秒 × 20s）。超出必须拆到下一个 VideoSegment，禁止用「极速念白」硬塞。
   - 每节拍对白容量上限（按 4.5 字/秒）：${DRAMA_DENSE_20S_BEAT_WINDOWS.map((b) => `${b.window} ${b.label} ≤${b.maxDialogueChars}字`).join(' / ')}。
   - 节拍窗口时长之和自检：Σbeats[].durationSec 必须 = ${DRAMA_DENSE_20S_SEGMENT_DURATION}s。

1. **强制 5 段式节拍结构模板**（每个 VideoSegment 必须 exactly 5 beats，窗口不得偏移）：
   - Beat1 钩子 [${DRAMA_DENSE_20S_BEAT_WINDOWS[0].window}，${DRAMA_DENSE_20S_BEAT_WINDOWS[0].durationSec}s]：视觉钩子 / 冲突入口 / 人物状态开场 → 必须给一个新信息点（新动作/新揭示/新冲突起手），禁止空景慢推开场。
   - Beat2 推进 [${DRAMA_DENSE_20S_BEAT_WINDOWS[1].window}，${DRAMA_DENSE_20S_BEAT_WINDOWS[1].durationSec}s]：事态发展 / 动作执行 / 对话主体推进，必须承接钩子并把信息推进一步。
   - Beat3 情绪/反应 [${DRAMA_DENSE_20S_BEAT_WINDOWS[2].window}，${DRAMA_DENSE_20S_BEAT_WINDOWS[2].durationSec}s]：对 Beat2 结果的物理微相反应 / 听话人表情 / 环境后果呈现；expression 写微相，emotion 写导演意图。
   - Beat4 反转/新事件 [${DRAMA_DENSE_20S_BEAT_WINDOWS[3].window}，${DRAMA_DENSE_20S_BEAT_WINDOWS[3].durationSec}s]：剧情拐点 / 新揭示 / 另一方入场 / 信息升级。本段唯一允许放 1 处「急推/甩切」的节拍，其他节拍禁甩禁急推。
   - Beat5 悬念收口 [${DRAMA_DENSE_20S_BEAT_WINDOWS[4].window}，${DRAMA_DENSE_20S_BEAT_WINDOWS[4].durationSec}s]：给下一视频段的钩子 / 未决状态 / 情绪落点 / 悬念眼神。必须在 20s 结尾把观众注意力引向下一段，不要平淡收。

2. **节拍级信息密度（强制）**：
   - 每个 beat 必须有且仅有 1 个 info_point（新动作/新对白/新情绪/新揭示四选一）。
   - 5 个 beat 合计 5 个信息点，不要漏不要重复。
   - 节拍间衔接方式 = 快切 / 动作打断 / 光影突变 / 说话人切换 四选一，衔接点必须可见。

3. **运镜铁律（整条 20s 段范围）**：
   - 每拍必须写命名运镜（景别+角度+手法+构图），禁止裸写「固定」。默认用手册手法：建立用上帝俯/倒飞揭示/慢摇，对话用过肩慢推，收束用剥离拉远。
   - 整条最多 1-2 处「急推 / 甩切」，且只能放在 Beat4 反转节拍。
   - 一拍最多 1～2 种运镜；环绕只写 180 度；手持只写 subtle shake。
   - 禁用空词：固定、跟拍、推、拉（必须换成命名手法）。

4. **VideoSegments 输出（权威结构，同时保留 shots[] 兼容视图）**：
   - 顶层 schema 仍含 shots[]（兼容下游剪辑层：每个 beat → 一个 shot，shot.duration_sec=beat.durationSec，shot.video_id=video_id，shot.duration_why 写节拍标签如「钩子/推进/情绪」）。
   - 新增 video_segments[] 权威数组，每个 VideoSegment 结构：
     { video_id: "VS001", duration: ${DRAMA_DENSE_20S_SEGMENT_DURATION}, loc: "S01", gear: "dense_20s", beats: [Beat×5], cast_names: [...], event_ids: [...], transition_in, transition_out }
   - 每个 Beat 结构：
     { window: "0-4s", duration_sec: 4, beat_label: "钩子", info_point: "本节拍新信息点一句话", action: "可见动作描述(≤40字)", dialogue: {speaker:"周一川", line:"逐字原文台词"} | null, expression: "可见物理微相(≤20字，纯物理不写抽象情绪词)", emotion: {primary:"主导情绪", secondary:"辅助(可空)", intensity:0.5, arc:"变化弧线(可空)"}, camera: "固定机位/手持微晃/急推(仅Beat4)/甩切(仅Beat4)", light: "本段光线此刻特征(≤25字)", sound: "底噪Loop或同步Foley(≤25字，禁止台词)" }
   - beats[].window 必须严格对齐 DRAMA_DENSE_20S_BEAT_WINDOWS 的固定值，不得自定义。

5. **段分组策略（Visual Events → VideoSegments）**：
   - 一段 ≈ 4-6 个连续 Visual Events；同地点、同冲突线、情绪不断层 → 归入同一段。
   - 换地点 / 冲突线跳变 / 情绪断崖 → 必须开新段（新 video_id）。
   - 单段对白字数 > 90 字 → 必须开下一段，本段在剧情断点处收口到 Beat5，余下对白放入下一段从 Beat1 钩子开始。
   - 全段慢推禁词扫描：video_segments[].beats[].camera/action 合起来命中慢推词次数必须 = 0。`;

/** 20秒长视频高密度加厚：保持 5 节拍结构不变，细化每节拍四要素，禁止扩回碎切，禁止加慢推 */
export const DRAMA_SHOT_PLAN_ENRICH_PACE_DENSE_20S = `【加厚挡位：20秒长视频高密度 · 覆盖手册冲突项 · 反拖沓共享铁律】
${ANTI_DILUTION_INJECT}
- 禁止把 20s 段加厚时拆成多个小镜；保持 video_id / duration / beats 的 5 个节拍窗口完全不变。
- 每个 beat 的四要素（action/expression/camera/sound/light）按本节拍实际信息点细化到可拍；动作最多 3-5 个可见物理动作，禁止过程链堆字。
- 对白 line 必须逐字保留原文；speaker 与 dialogue[] 对齐。
- camera 必须写手册命名手法（过肩/慢推/航拍揭示/手持微晃等），仅 Beat4 允许 1 处急推/甩切；禁止裸写「固定」。
- expression/beat 只写物理微相（攥拳、喉结、眨眼等），禁止抽象情绪词。
- 保留 beats[].emotion 结构化对象不变：加厚只细化四要素，不得覆盖或删除原 emotion 字段。
- 加厚后再次做慢推词扫描：命中必须立刻改为固定机位/手持微晃 + 动作打断切。`;

/**
 * 15秒高密度（分析/分镜默认）：一镜≈15s，镜内时间子窗承载对白与微相，对齐 H3 出片密度。
 */
export const DRAMA_SHOT_PLAN_PACE_DENSE_15S = `【角色设定：15秒高密度导演 · 覆盖上文一切冲突规则 · 反拖沓共享铁律】
${ANTI_DILUTION_INJECT}
你是电影级短剧导演。任务：把 Visual Events 合并为可直接出 H3 的 15 秒段落镜。
座右铭：一镜一段落，镜内用时间子窗写清表演；不要碎切成 6 秒快切。
世界观：每镜 action 即镜内时间轴；对白落在子窗；光影/拟音与动作同密度。

【15秒高密度硬规则 · 强制执行 · 最高优先】
0. **对白完整性铁律（最高优先 · 覆盖一切冲突规则）**：
   - 剧本中每一句人物对白、旁白、画外音(VO/OS)、内心独白必须逐字出现在某个 shot 的 dialogue[] 中，禁止省略、概括、改写、合并任何一句。
   - 剧本有 N 句对白（含旁白/画外音/内心独白） → 所有 shot 的 dialogue[] 合计必须有 N 句。
   - 旁白/画外音/内心独白的 character_name 填「旁白」「画外音」或具体说话人名（如「父亲（画外）」）。
   - 对白字数超过本镜时长容量时必须拆到多个镜头，禁止用「极速正反打」把超量对白塞进一镜。
   - **原文每一句独立对白必须是 dialogue[] 中独立的一条，禁止把多句原文对白合并成一条 dialogue.text**。
   - 中文正常语速约 4.5 字/秒（旁白/画外音同速）。各时长容量上限：
     · 6 秒镜：≤27 字（约 1 短句）
     · 10 秒镜：≤45 字（约 1～2 句）
     · 15 秒镜：≤68 字（约 2～3 句）
     · 20 秒镜：≤90 字（约 3～4 句）
   - 超出容量 → 必须按说话人切换/句意断点拆到下一镜，每镜对白字数（含旁白）不得超过对应上限。
1. 合镜：同地点、连续、情绪不断层的 3～8 个事件 → 合并为 1 镜（duration_sec=15）。
2. 时长：默认 15；单事件落点/信息闪现可用 10；完整长段落极少用 20。本集 ≥65% 镜必须为 15。
3. 镜内时间轴（写在 action 字段，强制）：
   - 15s 镜拆 2×6s 全窗 + 1×3s 收束，或 3×5s；每窗含空间+动作+微表情+光影+拟音。
   - 对白写子窗：例 [10.5-12s] 程序员客户说：「超时多久了？」
   - 禁止把整场对白压进一句概括；禁止镜外再拆 6s 反应镜（反应写进同镜子窗）。
4. 对白：每镜对白字数（含旁白/画外音）不得超过时长容量上限；落在子时间窗；dialogue[] 同步列出本镜全部台词与旁白（逐字保留原文）；旁白/画外音的 character_name 填「旁白」「画外音」或具体说话人名。
5. expression：物理微相串，禁止抽象情绪词。
5b. 新增 emotion 结构化对象：{primary 主导情绪, secondary? 辅助, intensity 0-1, arc? 变化弧线}。与 expression 分离，两者并存不合并。
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
export const DRAMA_SHOT_PLAN_PACE_SHORT_DRAMA = `【角色设定：短剧爆款导演 · 覆盖上文一切冲突规则 · 反拖沓共享铁律】
${ANTI_DILUTION_INJECT}
你是拥有 10 年一线经验的微短剧爆款导演。任务：把小说叙事转成强视觉、快节奏、高爽感的竖屏分镜。
座右铭：观众没有耐心；对话是爽点，赶路是成本。
世界观：情绪前置、逻辑后置；每镜至少 1～2 个信息点；拒绝文艺腔与无意义留白。

【短剧快节奏硬规则 · 强制执行 · 最高优先】
0. **对白完整性铁律（最高优先 · 覆盖一切冲突规则）**：
   - 剧本中每一句人物对白、旁白、画外音(VO/OS)、内心独白必须逐字出现在某个 shot 的 dialogue[] 中，禁止省略、概括、改写、合并任何一句。
   - 剧本有 N 句对白（含旁白/画外音/内心独白） → 所有 shot 的 dialogue[] 合计必须有 N 句。
   - 旁白/画外音/内心独白的 character_name 填「旁白」「画外音」或具体说话人名（如「父亲（画外）」）。
   - 对白字数超过本镜时长容量时必须拆到多个镜头，禁止用「极速正反打」把超量对白塞进一镜。
   - **原文每一句独立对白必须是 dialogue[] 中独立的一条，禁止把多句原文对白合并成一条 dialogue.text（例：原文「你超时了。」「客户已差评。」→ 必须是 dialogue[0] + dialogue[1] 两条，绝不能写成单条 text:「你超时了，客户已差评。」）**。
   - 中文正常语速约 4.5 字/秒（旁白/画外音同速）。各时长容量上限：
     · 6 秒镜：≤27 字（约 1 短句）
     · 10 秒镜：≤45 字（约 1～2 句）
     · 15 秒镜：≤68 字（约 2～3 句）
     · 20 秒镜：≤90 字（约 3～4 句）
   - 超出容量 → 必须按说话人切换/句意断点拆到下一镜，每镜对白字数（含旁白）不得超过对应上限。

1. 场景/镜头配额（硬）：
   - 有对白的场景（对话/对峙/谈判）→ 分配 ≥50% 的镜头数
   - 无对白赶路/环境/过渡（街头奔波、大堂、电梯、走廊、门口）→ 合计 ≤30% 的镜头数
   - 禁止为了「凑镜头」把同一赶路动作拆成 4～8 镜

2. 对话切镜（硬）：
   - 对白字数超出本镜时长容量时必须切镜（允许同一地点多镜）
   - 每段对话必须「说话人镜头 + 听话人反应镜头」交替
   - 关键情绪动作（攥拳又松开 / 喉结动 / 闭眼 / 点屏差评）必须单独成镜
   - 禁止把整场 8～10 句对白压进 1 镜（即使写了【极速正反打】时间轴也不算合规）

3. 砍场景（硬）：
   - 同一人物同一赶路动作：最多 1～2 镜（建立环境 + 进门/落点）
   - 电梯/走廊/大堂/门口等过渡空间：能合并就合并，合计 ≤1～2 镜
   - 只保留四类：建立环境、人物出场、对话核心、情绪收尾

4. 总镜数：1 分钟级短剧约 4～6 镜；每镜 15～20 秒，承载多句对白与多动作；平均叙事密度高；同场景对白整段保留在一镜内不切。

铁律 A·场景不拆镜（最高优先）：
- 同一场景空间、无黑屏硬转场、无时空跳转 → 禁止拆成多个 shot；多句对白、多动作、运镜推拉、特效爆发全部放在同一 shot 内部时间节拍（[0-5s]…[5-12s]…[12-20s]）区分先后。
- 只有下列三种情形允许开新 shot：① 场景切换（雨夜街头→1708室内）；② 黑屏硬转场；③ 时空跳转（现在→回忆）。
- 同一赶路动作最多 1 镜（不是 2 镜）；电梯/走廊/大堂/门口过渡能并入下一场就并入。

铁律 B·时长（最高优先）：
- 单镜优先 15～20 秒；最小不低于 10 秒；最大不超过 30 秒。
- 6 秒镜禁止使用（碎切源头）；只有真正独立的闪回/特写落点可降至 10 秒。
- 同场景多句对白容量上限（按 4.5 字/秒）：15s 镜 ≤68 字（约 2～3 句）；20s 镜 ≤90 字（约 3～4 句）；25s 镜 ≤112 字（约 4～5 句）；超出容量才允许拆到下一镜。
- duration_why 必须写明本镜承载多少句对白/多少动作。

铁律 C·对白落镜（替代旧「单镜单对白」铁律）：
- 剧本每一句对白必须逐字出现在某 shot 的 dialogue[] 中，禁止省略/概括/改写/合并多句为一条。
- 同场景多句对白优先落在同一 shot 的 dialogue[]（按时间子窗排列），不切镜；超出容量上限才允许切到下一镜。
- 反应不再单独成镜；反应写进同镜子窗的 expression 字段。
- 旁白/画外音的 character_name 填「旁白」「画外音」或具体说话人名。

铁律 D·情绪与表情分层（不混用，两者并存）：
- expression 字段：只写可见物理微相（眉心紧锁 / 喉结硬滚 / 拳攥紧又松开 / 瞳孔放大），禁止抽象情绪词
- 新增 emotion 结构化对象字段：承载导演情绪意图（primary 主导情绪 / secondary 辅助 / intensity 0-1 / arc 变化弧线）
- 禁止把抽象情绪词写进 expression；禁止把物理微相写进 emotion。两者分离，下游分别读

铁律 E·镜头运动：
- 禁止连续 ≥2 镜 move 只写固定/静帧
- 本集至少 2 个重点镜含「手持急推」「快速拉近」或「甩镜」
- 禁止无人机慢下摇、长全景雨景连铺

铁律 F·冲突前置：
- 开场 1 镜内进入冲突点（迟到/差评/对峙）。纯雨景/路况建立镜优先删除或压成 0～1 镜
- pri=B 的雨水/车流/走路辅助事件允许 0% 覆盖

时长：单镜优先 15～20；落点/闪回可降至 10；禁用 6；上限 30。`;


/** 正剧细致感：留白、光影、呼吸感（反拖沓共享规则仍生效，禁止无信息慢推空窗） */
export const DRAMA_SHOT_PLAN_PACE_CINEMATIC = `【导演指令：正剧细致感 · 反拖沓共享铁律（只改禁止无信息空窗，不拆质感）】
${ANTI_DILUTION_INJECT}
全片采用正剧/电影质感，强调氛围铺垫与视觉留白（但每个镜头至少有一个明确导演意图：铺垫/揭示/情绪升级，不得有无信息空景）。
镜头运动：优先缓推、慢横移、或完全固定；但缓推/慢移必须服务于一个信息点（揭示新物件/心理升级），纯"慢推看走廊"禁止；强调稳重构图与几何美感。
景别：先全景交代环境压迫/空间关系，再切特写心理微相（咽口水、指尖颤等）。
光影：必须写清光源（霓虹/手机冷光/路灯/监控灯等）；可用低照度明暗交界、逆光/侧逆光勾轮廓。
节奏：单镜可偏 10/15；允许停顿、犹豫、气息变化（但必须对应一个情绪/信息目的，不是纯撑时长）；sfx 含细腻环境氛围音。
禁止为了快而碎切；建立镜与情绪镜必须留足呼吸；但建立镜超过 8s 没有新信息 → 压缩或并入下一镜头。`;

/** 15秒高密度加厚：保持镜内时间子窗密度，禁止扩回碎切 */
export const DRAMA_SHOT_PLAN_ENRICH_PACE_DENSE_15S = `【加厚挡位：15秒高密度 · 覆盖手册冲突项】
- 禁止把 15s 镜加厚时拆成多镜；保持 duration_sec 与 event_ids 不变。
- action 必须扩成镜内时间子窗（[0-6s]…[6-12s]…[12-15s]），每窗四要素齐全。
- 对白子窗与 dialogue[] 对齐；反应写进同镜子窗，禁止另开反应镜。
- expression/lighting/sfx 按子窗细化，禁止抽象情绪词。
- emotion 结构化对象保留原样，加厚不得覆盖或删除原 emotion。`;

/** 短剧加厚时覆盖运镜手册里的「过程链 / 抽象情绪 / 对话并成一镜」写法 */
export const DRAMA_SHOT_PLAN_ENRICH_PACE_SHORT_DRAMA = `【加厚挡位：短剧爆款导演 · 覆盖手册冲突项】
- 禁止把 action 扩成过程链；只保留爆发落点 + 物理微相。
- 禁止把多镜对白「加厚」合并回单镜；保持说话人/反应镜交替结构。
- 反应镜必须写清可见微相（攥拳又松开、喉结动、点屏），禁止空表情。
- expression：禁止抽象情绪词；只写物理微相。
- emotion 结构化对象保留原样，不得覆盖或删除；加厚只细化 expression/action，不动 emotion。
- move：冲突对白改成手持急推/快速拉近；禁止连续固定。
- sfx：具体冲击力 Foley。
- 句子短粗干练。`;

export function dramaShotPlanPaceGearDirective(gear: DramaShotPlanPaceGear | unknown): string {
  const g = normalizeDramaShotPlanPaceGear(gear);
  if (g === 'cinematic') return DRAMA_SHOT_PLAN_PACE_CINEMATIC;
  if (g === 'short_drama') return DRAMA_SHOT_PLAN_PACE_SHORT_DRAMA;
  if (g === 'dense_20s') return DRAMA_SHOT_PLAN_PACE_DENSE_20S;
  return DRAMA_SHOT_PLAN_PACE_DENSE_15S;
}

export function dramaShotPlanPaceGearLabel(gear: DramaShotPlanPaceGear | unknown): string {
  const g = normalizeDramaShotPlanPaceGear(gear);
  if (g === 'cinematic') return '正剧细致感';
  if (g === 'short_drama') return '短剧快切';
  if (g === 'dense_20s') return '20秒长视频高密度';
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
  // ===== 20秒长视频高密度（新）=====
  if (normalizeDramaShotPlanPaceGear(gear) === 'dense_20s') {
    return {
      mergeRules: `5. 合段：同地点、连续 4～6 个 Visual Events → 合并为 1 个 VideoSegment（duration=20，gear=dense_20s）。
   强制 5 节拍结构：beats[5] 严格按 钩子(0-4s)→推进(4-9s)→情绪/反应(9-13s)→反转/新事件(13-17s)→悬念收口(17-20s) 固定窗口，不得偏移。
   Σbeats[].duration_sec 必须 =20。每个 beat 一个 info_point（新动作/新对白/新情绪/新揭示四选一）。
   同时保留 shots[] 兼容视图：每个 beat → 一个 shot（duration_sec=beat.durationSec，shot.video_id=VSxxx，shot.duration_why=beat_label），video_id 跨 beat 不变。`,
      locationRules: `7. 换地点/冲突线跳变/情绪断崖：必须开新段（新 video_id VS002…）。禁止把不同空间的 beats 塞进同一个 20s 段。同楼内门口→大厅→电梯→走廊空间连续 → 可并入一段作为 Beat1 钩子级空间交代（总段数不增）。`,
      durationRules: `8. VideoSegment.duration 固定 =${DRAMA_DENSE_20S_SEGMENT_DURATION}。内部 5 节拍固定窗口：
   • Beat1 钩子 0-4s（≤18字对白）
   • Beat2 推进 4-9s（≤22字对白）
   • Beat3 情绪/反应 9-13s（≤18字对白）
   • Beat4 反转/新事件 13-17s（≤18字对白，本段唯一允许急推/甩切）
   • Beat5 悬念收口 17-20s（≤13字对白）
   单段总对白 ≤${DRAMA_DENSE_20S_MAX_DIALOGUE_CHARS_PER_SEGMENT} 字。>90 字必须拆到下一段。duration_why 写「VS001钩子段」「VS002冲突升级段」等。`,
      actionFieldRule:
        '- action = VideoSegment 级别可写段级背景(≤60字)；beats[].action 写本节拍可见物理动作(≤40字，3-5个动作)。禁止一句概括整段 20s 表演；必须下钻到节拍级。',
      expressionFieldRule:
        '- beats[].expression = 本节拍物理微相（攥拳/喉结硬滚/瞳孔缩/嘴角下撇/指节蜷起），≤20字。禁止抽象情绪词。段级 expression 可为空。'
        + '\n- beats[].emotion = 结构化情绪意图：{primary,secondary?,intensity 0-1,arc?}。与 expression 并存，不要合并到同一字段。段级 emotion 可聚合本段主导情绪。',
      signatureRules: `11. 人设档案执行不变，但：
   - 标志性动作/情绪信号，必须落位到具体节拍（如 signature 的攥拳 → Beat3 情绪节拍）。
   - move/运镜：整段默认固定机位/手持微晃，只有 Beat4 反转节拍允许写 1 处急推/甩切。
   - 同一角色标志性动作：全片所有 beats 中保持一致，禁止漂移。`,
      userDurationHint:
        '一条视频 =20s 固定长。内部 5 个节拍窗口（钩子/推进/情绪/反转/收口）严格对齐。对白按节拍容量分配；单段>90字对白必须拆段；全段慢推禁词=0。',
      auxEventCoverage:
        'pri=B 辅助事件（雨水/车流/走路等）允许压缩到 0-30% 以让位对白和核心冲突，但 pri=A 硬事件必须 100% 覆盖且分配到具体节拍。',
      fieldLimitRule:
        `12. 本阶段字段上限：
   - video_segments[].beats[].action ≤40 字；expression ≤20；info_point ≤1 句(≤30字)；camera ≤15 字；light ≤25；sound ≤25。
   - 段级 action ≤60 字；shots[] 兼容视图字段 action/expression ≤80 字。
   - beats[].emotion 对象不参与字符计数（因其为结构化字段），但 primary/secondary/arc 文本各自控制 ≤15字。
   - 控制总长，优先保证 beats[5] 齐全、对白逐字、窗口对齐，宁可段级字段写短。`,
      paceAcceptanceHint:
        `验收：每段 beats=5 且窗口严格对齐(0-4/4-9/9-13/13-17/17-20)；Σduration=20；每节拍有唯一 info_point；单段对白≤${DRAMA_DENSE_20S_MAX_DIALOGUE_CHARS_PER_SEGMENT}字；整段慢推禁词命中=0；整条急推/甩切≤2处且仅在Beat4。`,
      paceExampleShots: `{
    "video_segments": [
      { "video_id": "VS001", "duration": 20, "loc": "S01", "gear": "dense_20s",
        "beats": [
          { "window": "0-4s", "duration_sec": 4, "beat_label": "钩子", "info_point": "周一川冲进电梯超时弹窗扑面", "action": "周一川攥外卖袋撞进电梯门，手指戳键面板亮", "dialogue": null, "expression": "腮帮紧咬眼皮半垂", "camera": "固定机位", "light": "电梯冷白荧光+镜面光斑", "sound": "电梯门哐当+键声嘀+雨衣袖口甩水" },
          { "window": "4-9s", "duration_sec": 5, "beat_label": "推进", "info_point": "客户质问首句台词砸下", "action": "显示器后客户抬眼眉心拧紧，冷屏光切半脸", "dialogue": { "speaker": "程序员客户", "line": "超时多久了？" }, "expression": "眉心拧死嘴角下撇", "camera": "固定机位", "light": "屏幕冷光+台灯暖光切割", "sound": "键盘骤停+椅轮轻响" },
          { "window": "9-13s", "duration_sec": 4, "beat_label": "情绪/反应", "info_point": "周一川被钉住抬眼湿睫毛颤", "action": "周一川盯水渍吸气卡住，缓慢抬眼胸口起伏", "dialogue": { "speaker": "周一川", "line": "雨太大了。" }, "expression": "瞳孔缩紧湿睫毛轻颤", "camera": "手持微晃", "light": "台灯暖光托脸袖口阴影扫过", "sound": "水滴砸桌+吸气滞住声" },
          { "window": "13-17s", "duration_sec": 4, "beat_label": "反转/新事件", "info_point": "客户甩出差评按钮点屏", "action": "客户手指砸向屏幕一星差评UI浮现高亮", "dialogue": { "speaker": "程序员客户", "line": "这单我不会付款。" }, "expression": "指节弹起指甲泛白", "camera": "手持急推怼屏", "light": "屏幕红叉光反打客户脸", "sound": "指尖砸屏脆响+UI弹出蜂鸣" },
          { "window": "17-20s", "duration_sec": 3, "beat_label": "悬念收口", "info_point": "周一川攥拳未挥看保温袋悬念留白", "action": "拳攥紧又松开，视线落保温袋口未说话", "dialogue": null, "expression": "拳攥紧后指甲留红印", "camera": "固定机位", "light": "台灯暖光落袋口水汽反光", "sound": "指节弹响+远处电梯报层声" }
        ],
        "cast_names": ["C-01 周一川", "程序员客户"],
        "event_ids": ["EV010","EV011","EV012","EV013","EV014"],
        "transition_in": "硬切", "transition_out": "切办公室VS002"
      }
    ],
    "shots": [
      { "shot_no": "1", "video_id": "VS001", "scene_no": "2", "scene": "金鼎1708办公室/电梯过渡", "duration_sec": 4, "duration_why": "钩子", "dramatic_purpose": "introduce", "visual_focus": "超时弹窗扑面", "purpose": "core_fear被激活入口", "size": "中景", "angle": "平视", "move": "固定机位", "action": "周一川攥外卖袋撞进电梯门，手指戳键面板亮", "expression": "腮帮紧咬眼皮半垂", "time_of_day": "深夜", "environment": "写字楼夜班电梯镜面", "lighting": "冷白荧光+镜面光斑", "sfx": "电梯门哐当+键声嘀", "dialogue": [], "cast_names": ["C-01 周一川"], "event_ids": ["EV010"], "transition_in": "硬切", "transition_out": "切推进" },
      { "shot_no": "2", "video_id": "VS001", "duration_sec": 5, "duration_why": "推进", ... },
      { "shot_no": "3", "video_id": "VS001", "duration_sec": 4, "duration_why": "情绪/反应", ... },
      { "shot_no": "4", "video_id": "VS001", "duration_sec": 4, "duration_why": "反转", ... },
      { "shot_no": "5", "video_id": "VS001", "duration_sec": 3, "duration_why": "悬念收口", ... }
    ]
  }`,
    };
  }
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
        '- expression = 物理微相串，可按子窗写「[6-12s]眉心拧紧/嘴角下压」。禁止隐忍/焦虑等抽象词。'
        + '\n- 新增 emotion 结构化字段：{primary, secondary?, intensity 0-1, arc?}，承载本段导演情绪意图；与 expression 分离，不得合并。',
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
        '12. 本阶段 action 可写满镜内时间轴（≤220 字）；purpose/expression 各 ≤100 字；emotion 结构化字段不参与字符计数但 primary/secondary/arc 各 ≤15字。更细微相由加厚补全。',
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
    mergeRules: `5. 一镜 = 一个连续场景段落：同场景、同时间、同空间的多句对白 + 多动作 + 运镜推拉 + 特效爆发全部合并进同一 shot。
   禁止拆镜：同场景对白（即使 3～5 句）；同场景反应（写进同镜子窗 expression）；同场景动作变化；同场景运镜推拉。
   允许拆镜：场景切换；黑屏硬转场；时空跳转；同场景对白字数超容量上限（按 4.5 字/秒，20s≤90字）。
   关键情绪动作（攥拳又松开/喉结动/点屏差评）不再单独成镜，写进同镜 action 子窗。
   配额硬指标：本集 4～6 镜，每镜 15～20 秒；纯过渡镜 ≤1 镜。`,
    locationRules: `7. 冲突前置：开场 1 镜必须到冲突点。禁止无人机/全景雨景/路况连铺 ≥1 镜。大厦外观/电梯/走廊过渡尽量并入下一场。pri=B 雨水/车流/走路可 0% 覆盖。establish 最多 1 镜且优先中近景。`,
    durationRules: `8. duration_sec 优先 15～20，最小 10，最大 30，禁用 6/8。短剧强制：
   - 同场景多句对白段 → 优先 20（含 3～4 句对白 + 反应微相）
   - 同场景单句对白 + 动作变化 → 15
   - 独立闪回/特写落点 → 10
   - 6/8 秒镜视为碎切，禁止使用
   duration_why 必须写：「N 句对白 + N 个动作，Xs」例：「3 句对白+2 微相，20s」。`,
    actionFieldRule:
      '- action = 镜内时间轴正文：写 [0-5s] 子窗 1 动作 + [5-12s] 子窗 2 动作 + [12-20s] 子窗 3 动作。禁止一句概括整场戏；必须下钻到时间子窗。反应写进同镜子窗的 expression，不另开反应镜。',
    expressionFieldRule:
      '- expression = 物理微相串（按时间子窗）：[0-5s] 眉心紧锁 + [5-12s] 喉结硬滚 + [12-20s] 拳攥紧又松开。禁止抽象情绪词。',
    signatureRules: `11. 人设欲望/恐惧仍要点名，短剧改写：
   - signature_actions 按时间子窗触发，写进对应子窗的 action。
   - 同场景多句对白整段保留在一镜，dialogue[] 按子窗时间顺序列出所有台词。
   - move：对白冲突段用手持急推/快速拉近（限 1～2 处）；禁止连续固定；本集至少 2 处急推/甩镜。
   - expression 按子窗写物理微相；sfx 具体有冲击力。`,
    userDurationHint:
      '同场景不拆镜；每镜 15～20 秒承载多句对白+多动作+反应微相；禁用 6/8 秒碎切；4～6 镜讲完一段戏；≥2 处手持急推。',
    auxEventCoverage:
      '短剧挡位：pri=B（雨水/车流/走路/空镜）允许 0%～50% 覆盖，可整段丢掉以砍前戏。',
    fieldLimitRule:
      '12. 本阶段字段可以写满，但每镜 action/purpose 各 ≤ 120 字（长镜承载多动作，上限放宽），expression ≤ 80 字，防止 JSON 截断。更细的微相由后续按镜加厚补全。',
    paceAcceptanceHint:
      '验收：本集 4～6 镜；每镜 15～20 秒；同场景对白不拆镜；6/8 秒碎镜 = 0 个；至少 2 处手持急推。',
    paceExampleShots: `{
    { "shot_no": "1", "scene_no": "1", "scene": "雨夜街头→1708室内", "duration_sec": 20, "duration_why": "3 句对白+2 微相，20s", "dramatic_purpose": "dialogue", "visual_focus": "周一川被质问+差评+攥拳", "purpose": "C-01 core_fear（被否定）被钉住+差评落锤", "size": "中景", "angle": "平视", "move": "手持急推怼脸（限 1 处）", "action": "[0-5s] 男人抬手指向门口，吐字砸下「迟到十三分钟」；[5-12s] 周一川低头辩解「雨太大了，路上全是积水」；[12-18s] 男人宣布「借口。客户已经打差评了」；[18-20s] 周一川攥拳又松开", "expression": "[0-5s] 眉心拧死嘴角下撇；[5-12s] 喉结硬滚；[12-18s] 瞳孔放大；[18-20s] 拳攥紧又松开", "time_of_day": "深夜", "environment": "开敞办公区夜班屏幕", "lighting": "屏幕冷光打半脸", "sfx": "键盘停+手机震动", "dialogue": [{ "character_name": "男人", "text": "你迟到了十三分钟。" }, { "character_name": "周一川", "text": "雨太大了，路上全是积水。" }, { "character_name": "男人", "text": "借口。客户已经打差评了。" }], "cast_names": ["男人", "C-01 周一川"], "event_ids": ["EV010", "EV011", "EV012"], "intent_ids": ["SI04", "SI05", "SI06"], "transition_in": "硬切", "transition_out": "切黑屏" }
  }`,
  };
}

export const DRAMA_DOMAIN_SHOT_PLAN_SYSTEM_PROMPT = `你是短剧分镜导演。任务：把已确认的 Visual Events 转成可拍摄的 shots JSON。短剧挡位时你必须切换为「短剧爆款导演」人设，并严格执行第 14 条铁律（覆盖冲突规则）。

规则：
1. 只输出合法 JSON，不要 Markdown，不要代码块，不要解释。
2. schemaVersion 必须是 "director-domain.v2"；type 必须是 "director-drama-domain-shot-plan"。
3. 顶层只有：schemaVersion, type, shots。
4. 本集镜头预算：目标 {targetShotCount} 镜，允许 {shotsMin}–{shotsMax}。尽量靠近目标；短剧挡位优先长镜承载多句对白+多动作（15～20s/镜），允许低于预算下限（4～6 镜讲完一段戏即可），禁止为凑数拆碎镜。
4b. 长镜守则（最高优先 · 覆盖预算冲突）：同场景、同时间、同空间的多句对白+多动作+运镜推拉+特效爆发必须合并进同一 shot；只有场景切换/黑屏硬转场/时空跳转才允许开新 shot。6/8 秒镜视为碎切，禁止使用；最小 10 秒，最大 30 秒，优先 15～20 秒。
{mergeRules}
6. 每个 shot 必须带 event_ids。pri=A 的硬事件必须 100% 被至少一镜覆盖。{auxEventCoverage}
{locationRules}
{durationRules}
9. shots[] 每项：
   { shot_no, scene_no, scene, duration_sec, duration_why, dramatic_purpose, visual_focus, purpose, size, angle, move, action, expression, lighting, blocking, time_of_day, environment, dialogue:[{character_name,text,subtext}], sfx, cast_names[], prop_names[], creature_names[], transition_in, transition_out, event_ids[] }
   {actionFieldRule}
   {expressionFieldRule}
   - purpose = 镜头目的：除纯建立镜外必须含「触发[角色]的 core_desire/core_fear（具体内容）」。禁止「表现紧迫感/暗示无力感」。禁止把 purpose 写成 action 的复述。
   - move 必须是命名手法，格式 [设备]+[运动方式]+[速度/节奏]+[情绪意图]。
   - time_of_day 必填，只能从下列择一（据剧情/场次/对白推断，禁止空、禁止写光影技术词）：朦胧亮 | 日出 | 正午 | 下午 | 傍晚 | 晚上 | 深夜 | 黎明。同场连续镜时段须一致，跨场才可跳变。
   - environment 必填，≤20 字：天气+室内外+可见景物简述（例：雨夜写字楼外积水；白天便利店冷柜灯）。禁止复述 lighting。
   - lighting 按地点变化：雨夜=霓虹倒影+水面反射；电梯=冷白荧光+镜面光斑；室内=暖台灯 vs 屏幕冷光切割。禁止全表「冷光」。lighting 是用光技术，不要写「深夜」「傍晚」——时段只写在 time_of_day。
   - sfx 必填：按「底噪Loop｜FoleyA、FoleyB」分层；台词禁止写入 sfx。
   - cast_names 写成「C-01 周一川」，必须带人设编号。
   - dramatic_purpose: establish|introduce|action|reaction|dialogue|reveal|emotional|transition|information|environment|insert
   - scene 写地点名，与 visual_events.loc / scene_beats.location_name 对齐
   - dialogue 无台词用 []；每镜对白字数（含旁白/画外音）不得超过时长容量上限（6s≤27字/10s≤45字/15s≤68字/20s≤90字，按 4.5 字/秒）；反应镜可用 []；禁止整场对白压进单镜；**剧本每一句对白、旁白、画外音、内心独白必须逐字出现在某个 shot 的 dialogue[] 中，禁止省略/概括/改写；旁白/画外音的 character_name 填「旁白」「画外音」或具体说话人名**
   - prop_names / creature_names：只写本镜实际用到的道具/生物名，从给定列表里选（必须用原名，禁止简称/泛称/改写）；本镜没有就写 []。
10. 不要发明 Visual Events 里没有的大情节；不要输出 characters/scenes/project。
{signatureRules}
{fieldLimitRule}
13. ${DRAMA_CAMERA_MOVE_SHOT_PLAN_RULES}
13b. ${DRAMA_H3_CRAFT_SHOT_PLAN_RULES}
13c. ${DRAMA_H3_TIMING_SOUND_SHOT_PLAN_RULES}
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
道具（本镜用到才写进 prop_names，用原名）：{props}
生物（本镜用到才写进 creature_names，用物种名）：{creatures}
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
  propNames?: string[];
  creatureNames?: string[];
  characterDossier?: string;
  retryHint?: string;
  /** 短剧快节奏 / 正剧细致感 */
  paceGear?: DramaShotPlanPaceGear | string;
  /** v3：Shot Intent 列表（Narrative Planning 阶段产出，有则落镜时引用 intent_id） */
  shotIntents?: DramaShotIntent[];
  /** 原文分割模式：直接注入原文段落，LLM 从原文逐字提取对白，不改写 */
  sourceScript?: string;
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
  // v3：Shot Intents 注入（有则落镜时必须引用 intent_id）
  const intentsJson = (opts.shotIntents && opts.shotIntents.length > 0)
    ? JSON.stringify(
        opts.shotIntents.map((si) => ({
          intent_id: si.intent_id,
          director_beat_id: si.director_beat_id,
          purpose: si.purpose,
          visual_information: si.visual_information,
          audience_change: si.audience_change,
          subject: si.subject,
          visual_change_count: si.visual_change_count,
          visual_emphasis: si.visual_emphasis || undefined,
        })),
      )
    : '';
  const intentsDirective = intentsJson
    ? `\n【Shot Intents（v3 · 落镜时必须引用 intent_id）】\n${intentsJson}\n每个 shot_suggestion 必须带 intent_ids 数组字段关联到上述 intent；一镜可挂载多个 intent_id（同场景多句对白+多动作合并一镜时，把对应的所有 intent_id 都放入 intent_ids 数组）；不要强制 1 镜 1 intent。audience_change 是观众信息增量，确保每个镜头都有新的 audience_change。`
    : '';
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
      .replace(/\{props\}/g, (opts.propNames || []).join('、') || '无')
      .replace(/\{creatures\}/g, (opts.creatureNames || []).join('、') || '无')
      .replace(/\{retryHint\}/g, String(opts.retryHint || '').trim() ? `\n【重试】${opts.retryHint}\n` : '')
      + intentsDirective
      + (opts.sourceScript && opts.sourceScript.trim()
        ? `\n\n【原文（逐字保留，禁止改写/概括/省略任何对白）】\n${opts.sourceScript.trim()}\n\n【对白铁律】以上原文中的每一句「」对白必须逐字出现在对应 shot 的 dialogue[].text 中。禁止省略、概括、改写、合并。N 句对白 = N 条 dialogue。`
        : ''),
  };
}

/**
 * v4 合并调用：Narrative Planning + Shot Plan 一次 LLM 输出。
 * 顶层 JSON：{ narrative_beats, director_beats, shot_intents, shots, schemaVersion, type }
 * 当 narrative/shot_intents 为空时（新 session）使用，节省一次 LLM 调用。
 * 失败后应降级为 buildDramaNarrativePlanning + buildDramaDomainShotPlanMessages 的两步调用。
 */
export function buildMergedNarrativeAndShotPlanMessages(opts: {
  title?: string;
  styleHint?: string;
  budget: DramaAnalyzeShotBudget;
  sourceText: string;
  visualEvents: DramaVisualEvent[];
  sceneBeats: DramaSceneBeat[];
  characterNames?: string[];
  sceneNames?: string[];
  propNames?: string[];
  creatureNames?: string[];
  characterDossier?: string;
  retryHint?: string;
  paceGear?: DramaShotPlanPaceGear | string;
}): { systemPrompt: string; userPrompt: string } {
  // 1. Build the Narrative Planning + Shot Plan rules together
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

  const narrativeRules = DRAMA_NARRATIVE_PLANNING_RULES.join('\n');
  // Override the single output contract to note that shots must ALSO be included.
  const mergedSystemPrompt = `${narrativeRules}

═══════════════════════════════════════════════════
【合并输出 · 额外追加：Shots 分镜建议（同一次 JSON 输出）】
你在完成上方 Narrative/Director/Intent 三层后，需要在同一个 JSON 对象里继续追加 shots[] 分镜建议（落镜）。
落镜规则如下（覆盖上方 narrative 中仅出三层结构的要求）：
${fill(DRAMA_DOMAIN_SHOT_PLAN_SYSTEM_PROMPT.replace(/^你是短剧分镜导演。任务：把已确认的 Visual Events 转成可拍摄的 shots JSON。短剧挡位时你必须切换为「短剧爆款导演」人设，并严格执行第 14 条铁律（覆盖冲突规则）。/, '【落镜（Shots）规则】下方是短剧分镜导演职责的补充规则：用已确认的 Visual Events + 你刚刚生成的 shot_intents 转成可拍摄的 shots JSON。短剧挡位时必须切换为「短剧爆款导演」人设，并严格执行第 14 条铁律（覆盖冲突规则）。'))
  .replace('schemaVersion 必须是 "director-domain.v2"；type 必须是 "director-drama-domain-shot-plan"。',
    '顶层 schemaVersion 必须是 "director-domain.v2"；顶层 type 必须是 "director-drama-domain-shot-plan-with-intents"。')
  .replace('顶层只有：schemaVersion, type, shots。',
    '顶层必须包含：schemaVersion, type, narrative_beats, director_beats, shot_intents, shots 六个字段（顺序不限）。')
  .replace('每个 shot 必须带 event_ids。pri=A 的硬事件必须 100% 被至少一镜覆盖。',
    '每个 shot 必须带 event_ids 和 intent_ids（关联你生成的 shot_intents[].intent_id）。pri=A 的硬事件必须 100% 被至少一镜覆盖。一镜可挂载多个 intent_id。')
  .replace('【输出契约 · 一次 JSON 输出三层 · schema 固定】只输出合法 JSON，不要 Markdown，不要代码块。顶层结构：{"narrative_beats":[...],"director_beats":[...],"shot_intents":[...]}',
    '')
}
═══════════════════════════════════════════════════
【合并输出契约 · 顶层 JSON 固定六字段（顺序不限）】
只输出合法 JSON，不要 Markdown，不要代码块，不要解释。顶层结构：
{
  "schemaVersion": "director-domain.v2",
  "type": "director-drama-domain-shot-plan-with-intents",
  "narrative_beats": [ ... ],
  "director_beats": [ ... ],
  "shot_intents": [ ... ],
  "shots": [ ... ]
}
注意：你刚生成的每个 shot_intents 必须被至少一个 shot 的 intent_ids[] 引用到，做到 「intent_id → shot.intent_ids」 完整关联。`;

  const mergedUserPrompt = fill(DRAMA_DOMAIN_SHOT_PLAN_USER_PROMPT_TEMPLATE)
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
    .replace(/\{props\}/g, (opts.propNames || []).join('、') || '无')
    .replace(/\{creatures\}/g, (opts.creatureNames || []).join('、') || '无')
    .replace(/\{retryHint\}/g, String(opts.retryHint || '').trim() ? `\n【重试】${opts.retryHint}\n` : '')
    + `\n\n【原文（逐字保留，禁止改写/概括/省略任何对白）】\n${opts.sourceText}\n\n【对白铁律】原文中每一句「」对白必须逐字出现在对应 shot 的 dialogue[].text 中。禁止省略、概括、改写、合并。N 句对白 = N 条 dialogue。\n\n要求：同一 JSON 中同时输出 narrative_beats + director_beats + shot_intents（三层规划） + shots（落镜），intent_id 与 shots.intent_ids[] 要形成完整关联。`;

  return { systemPrompt: mergedSystemPrompt, userPrompt: mergedUserPrompt };
}
