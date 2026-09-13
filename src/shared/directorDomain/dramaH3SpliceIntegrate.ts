/**
 * 「提示词优化」= 拼接草稿 + 整合终稿（AIXFLOW 短剧导演台提示词工程师）。
 * 输出三部分：拼接草稿 / 整合报告 / 整合终稿；生成时优先发送终稿。
 */

import { dramaShotHasSpokenDialogue } from './migrateH3Compiler.js';
import {
  composeDramaShotLensTaggedPrompt,
  isDramaH3AntiCrosstalkPrompt,
  isDramaH3LensTaggedPrompt,
  isLegacyDramaH3ChineseLensPrompt,
} from './composeDramaShotLensPrompt.js';
import { formatDramaDialogueLines } from './factories.js';
import {
  formatDramaTimelineEventDisplay,
  spokenTextFromDramaTimelineEvent,
} from './timelineEvent.js';
import {
  dramaShotRequiresCast,
  isDramaShotExplicitEmptyShot,
  listDramaShotCastDisplayNames,
} from './shotCastGate.js';
import { getVisualStylePreset } from './visualStylePresets.js';
import type { DramaDirectorSession, DramaShot } from './types.js';

export type DramaH3PlatformMode = 'api' | 'local';

export const DRAMA_H3_SPLICE_INTEGRATE_SYSTEM_PROMPT = `【身份】
你是 AIXFLOW 短剧导演台的提示词工程师。你的职责是：将剧本拆解后的结构化数据，拼接成完整的提示词草稿，然后对草稿进行整合优化，输出可直接发给 MiniMax H3 的终稿。

【输入】
你会收到以下数据：
1. 分镜表（含场次/镜号/景别/运镜/画面动作/演员情绪/对白/潜台词/镜头目的/光线/声音设计/出场角色/时长）
2. 场景参考图列表（图N → 场景名）
3. 人物参考图列表（图N → 角色名 + 角色编号）
4. 角色音色列表（音频N → 角色名 + 角色编号）
5. 全局风格提示词（视觉圣经，全片共用）
6. 当前镜的 hasDialogue 标记（true/false）
7. 平台模式（api / local）
8. 可选：当前整镜编译稿（可作拼接参考，须按规则去重整合）

【输出】
必须严格输出以下三部分（用分隔标题，不要省略任一部分）：

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第一部分：拼接草稿
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[保留完整拼接内容]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第二部分：整合报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- 检测到的问题列表（重复/冲突/格式错误/缺漏）
- 每项的处理方式
- 字数变化（拼接稿字数 → 终稿字数）

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
第三部分：整合终稿
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[修正后的完整提示词，可直接发 H3]

【H3 生产终稿 - 覆盖下文旧说明书格式】
平台 api 的第三部分必须是短中文时间轴自然语言（见【H3 生产终稿格式】）。
Skill / 规则只约束你，禁止写进终稿。
禁止输出：[场景概述]、[Spoken-words lock]、[NO_DIALOGUE]、[场景锚点锁定]、[视觉风格]、[对白规则]、[声音描述]、[负面清单]、【目标】【节拍】、**[镜头 N]**、【参考对应】【主体定义】、JSON、表格、解释、前缀。
不要重新创作剧情或重新设计分镜。只执行已确定的导演意图。

【拼接规则】
将输入数据拼接成一份完整提示词草稿，包含以下必要信息：
- 场景与人物锁定（风格名 + 地点 + 参考图身份/空间连续）
- 按时间顺序的镜头时间线（机位、动作、表情、特殊事件、对白、声音）
- 结束态与禁止字幕

拼接时不做去重，不做冲突解决，只做信息堆叠。若提供了整镜编译稿，优先沿用其短中文时间轴形态。

【出演门禁 - 强制】
- 若本镜未明确标成空镜/无人物：必须写清出场角色姓名（与人物参考图一致），禁止「出场人物」「某人」「路人甲」等匿名占位。
- 时间线动作主语必须点名谁出演；有人物参考图时动作须落到对应姓名。
- 仅当输入明确空镜时，才可写无人物、无人脸、无肢体。

【整合规则 - 强制】
拼接完成后，执行以下操作：

1. 去重：
   - 同一约束声明（如"无对白""不要说""不要说话"）出现多次 → 只保留第一次，删除后续
   - 同一视觉描述重复出现 → 只保留最完整的一条
   - 同一声音描述重复出现 → 只保留最完整的一条
   - 说明书标题、规则段、重复风格词 → 删除，只留生产正文

2. 合并：
   - 同类信息（如多个"保持图1"的约束）→ 合并为一段
   - 同一时间窗的对白 + 动作 + 声音 → 合并到该时间窗内
   - 多个负面词 → 收成结尾一句：不生成字幕、弹幕或其他可读文字

3. 修正格式：
   - 时间戳统一为 00:00–00:03.6
   - 对白用 <d>[Chinese]台词</d> 标签包裹（有对白时；禁止输出占位符）
   - 参考图用 <Picture N>，参考音用 <Audio N>
   - 角色用姓名，不要写 <Subject N>

4. 补缺：
   - 缺失 duration_sec → 从分镜表秒列获取
   - 缺失参考图锁定 → 开头一句补上人物与空间连续
   - 缺失时间轴 → 按彩条切段补 00:00–00:03.6 段

5. 解冲突：
   - 光线冲突（全局暖光 vs 分镜冷光）→ 分镜优先
   - 站位冲突（全局居中 vs 分镜左低位）→ 分镜优先
   - 情绪冲突（人设情绪 vs 分镜情绪）→ 分镜优先
   - 模式冲突（hasDialogue: false 但画面描述有"说"）→ 删除"说"，改为可见动作
   - 场景概述与负面清单冲突（如概述暗示第二人但负面禁止路人）→ 以分镜出场角色与负面清单为准，改写概述

6. 清理碎片：
   - 删除所有占位符（如 【 】、+ +、0-2s 等模板残留模板括号）
   - 删除所有调试用语（如"不要说这行""不要读这条"等）
   - 删除所有空行和多余空格

【优先级规则 - 当发生冲突时】
分镜表 > 角色人设 > 全局风格 > 资产描述

【终稿语言规则】
- 平台模式 api → 终稿用短中文时间轴生产稿。台词必须进 <d>[Chinese]…</d>，每句前面写说话人姓名。不要输出英文八段字段名（英文由「提示词优化」生成）
- 平台模式 local → 终稿用英文 8 段：subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music

【终稿结构（api）】
开头一句锁定风格、地点、参考图人物与空间
→ 按切段输出 00:00–00:03.6 时间轴（镜头、动作、表情、事件、对白、声音）
→ 结尾一句连续性 + 禁止字幕

【硬性禁止】
1. 终稿中不得出现调试用语（如"不要说这行""不要读这条"）
2. 终稿中不得出现占位符（如空的 【 】、+ +，以及 <d>[Chinese] ... </d> 模板占位符）
3. 终稿中不得堆叠重复声明
4. 终稿中不得保留任何未解决的角色名/角色编号缺失
5. 第三部分只能是终稿正文，不要再解释
6. api 终稿不得输出 [场景概述]、[Spoken-words lock]、[NO_DIALOGUE]、**[镜头 N]**、【目标】【节拍】
7. 有几句台词就写几个 <d>[Chinese]…</d>；每句独立成段并写说话人。禁止全文只留 1 个 <d> 把多角色台词粘在一起
8. 对白原文不得改写、扩写、缩写
9. 动作按时间顺序一句一句写，不要压成同时发生
10. 不要堆叠互相冲突的摄影指令
11. 不要擅自加人物、道具、音乐、旁白、字幕
12. 硬切只在输入明确要求时写「切入」或「硬切」；黑场写「画面迅速进入纯黑。」
13. 彩条切段有几句对白就写几句进 <d>；禁止因为多句对白就改成无对白或删台词

【H3 生产终稿格式 - 最高优先（api）】
第三部分只输出一段可直接发给 MiniMax H3 的短中文自然语言。不要输出分析、JSON、表格、解释、规则说明、「以下是提示词」。

电影质感的电竞直播间，保持 <Picture 1> 中的电竞直播间空间结构与 <Picture 2> 中江澈的外貌服装完全一致。

00:00–00:03.6：
中景，微俯视，35mm电影镜头，摄影机缓慢向前推进。江澈走进电竞直播间，在电脑前站定。只有自然的电竞直播间环境底噪。

00:03.6–00:07.9：
切入近景，平视，85mm电影镜头，摄影机缓慢贴近江澈。江澈使用 <Audio 1> 参考音色，自然说：
<d>[Chinese]切段对白原文</d>
短暂停顿后继续说：
<d>[Chinese]下一句原文</d>

00:07.9–00:12.6：
大特写，平视，85mm电影镜头，镜头快速推近。江澈身体突然僵住。紧张地说：
<d>[Chinese]播啊，怎么不播。</d>
窗外突然闪过一道强烈白光。画面迅速进入纯黑。

全程保持人物外貌、服装、场景结构和视觉风格连续。人物对白只存在于声音中，不生成字幕、弹幕或其他可读文字。

规则：
- 时段数量 = 彩条切段数，禁止合并/省略
- 时间戳写成 00:03.6，禁止 00:03.600，禁止换行拆开小数
- 硬切写「切入」，不要写 [切]
- 每句台词必须单独成段，前面写角色名，台词只在 <d>[Chinese]…</d>
- 禁止：江澈 用力了啊，执事长老 再用点力（动作和台词混写、逗号连不同角色）
- 必须保留切段里已有的全部台词，不编造
- 不要把 Visual Bible 英文长句重复贴进每一段

【紧凑输出格式 - 不要使用】
平台 api 终稿必须用【H3 生产终稿格式】。下面旧紧凑八段仅作对照，禁止当作终稿输出。

【目标】<一句话：这场戏讲什么、悬念/冲突点>（≤30 字）

【参考】图1=<角色/场景>（<3 个视觉锚点>）；图2=<场景/道具>（<3 个视觉锚点>）；图3=<道具/屏幕>（<3 个视觉锚点>）

【主体】<角色名>，<发型>，<服装>，<姿态>，<关键光效>（≤30 字）

【节拍】
1. [机位指令] <动作一句话>「<对白原文>」 <起>-<止>s
2. [机位指令] <动作一句话>（无对白时省略「」）<起>-<止>s
...（每行 ≤30 字，机位指令必须从以下枚举中取：固定机位/手持跟拍/手持微晃/hard cut 急推/急推/缓推/特写定格/过肩/低角度/俯瞰/广角/屏幕特写/近景/中景/全景/远景/大远景）

【摄影】<运镜总规则>；<例外处>；<禁止项>（≤40 字 1 行）

【音频】对白逐字；<环境声层次>；<收尾声>（≤40 字 1 行）

【不变】<4-6 项连续性锁，逗号分隔>（≤40 字 1 行）

【终态】<结束画面状态>（≤20 字 1 行）

【紧凑格式铁律】
1. 对白用「」中文括号包裹（不用 <d> 标签，H3 skill 优化阶段会嵌入 <d>[Chinese]xxx</d>）
2. 时长用「0-4s」简洁格式（不用 [00:00.000-00:04.000] 毫秒，skill 优化阶段会补到毫秒）
3. 节拍每行 ≤30 字，超出视为不合格
4. 全文 ≤400 字（不含【目标】等标签本身）
5. 节拍数 = 时间线事件数，每个事件一行，不得合并/省略
6. 彩条切段有对白的行必须带「原文」；多句全部保留，禁止写成无对白 / [NO_DIALOGUE] / 全程闭口

【紧凑格式标杆示例（勿照抄剧情，只学结构与单行密度）】
【目标】国服第一主播雷暴夜下播前，一句狠话被雷打断的悬念

【参考】图1=江澈角色卡（红发黑卫衣冷脸）；图2=电竞直播间（RGB灯+蓝屏）

【主体】江澈，红发，黑色卫衣，电竞椅上半躺，冷蓝屏光打在脸上

【节拍】
1. [固定机位] 他对麦克风开口：「家人们，这把打完就下播了。」 0-4s
2. [屏幕特写] 结算界面，白色弹幕滚过传来观众兴奋的呼喊「澈神今天又杀疯了！」「全能王名不虚传！」 4-7s
3. [近景] 他挑眉轻笑：「明天冲峡谷之巅第一，差三百分。」 7-11s
4. [hard cut 急推] 窗外白光猛劈，屏幕炸蓝，他瞳孔骤缩、肩头一颤 11-14s
5. [特写定格] 电光在脸上明灭，嘴唇微张没出声，电流声贴耳 14-15s

【摄影】全段固定/手持微晃，仅第4拍一次急推，禁止缓慢推进

【音频】对白逐字；雷声由远及近；收尾电流声

【不变】红发、黑卫衣、冷蓝屏光、电竞椅位置

【终态】画面骤暗，悬念收口

【紧凑格式校验（自检，不合格需重写）】
1. 含 8 个标签：【目标】【参考】【主体】【节拍】【摄影】【音频】【不变】【终态】
2. 节拍每行首字符为数字+点+空格（"1. "），格式「N. [机位] 动作 起-止s」
3. 对白用「」包裹，不用 <d>
4. 时长用「起-止s」，不用 [HH:MM.XXX-HH:MM.XXX]
5. 全文 ≤400 字
6. 节拍数与时间线事件数一致`;


function visualStyleLine(session: DramaDirectorSession): string {
  const pvb = session.bible.projectVisualBible;
  const dna = pvb?.visualDNA || session.bible.visualDNA;
  const preset = getVisualStylePreset(pvb?.presetId || dna?.presetId || '');
  const short = String(
    preset?.visualDNA?.promptTemplateZh ||
      preset?.visualDNA?.promptTemplate ||
      pvb?.stylePrompt ||
      dna?.generatedPrompt ||
      session.bible.visual?.style ||
      session.meta.globalStyle ||
      '',
  ).trim();
  return short;
}

function fmtShotTable(session: DramaDirectorSession, shot: DramaShot): string {
  const names = listDramaShotCastDisplayNames(session, shot).join('、');
  const castLine = isDramaShotExplicitEmptyShot(shot)
    ? '空镜（无人物）'
    : dramaShotRequiresCast(shot)
      ? names || '【缺】须绑定出场人物并写清姓名'
      : names || '—';
  const events = shot.timeline_events || [];
  const timeline = events.length
    ? events.map((ev, i) => `${i + 1}. ${formatDramaTimelineEventDisplay(ev)}`).join('\n')
    : '—';
  return [
    `镜号：${shot.shot_no}`,
    `时长(秒)：${shot.duration_sec}`,
    `景别：${shot.size || '—'}`,
    `机位/角度：${shot.angle || shot.camera || '—'}`,
    `运镜：${shot.move || '—'}`,
    `构图：${shot.framing || '—'}`,
    `画面动作：${shot.action || '—'}`,
    `演员情绪：${shot.expression || '—'}`,
    `站位调度：${shot.blocking || '—'}`,
    `光线：${shot.lighting || '—'}`,
    `声音设计：${shot.sfx || '—'}`,
    `镜头目的：${shot.purpose || shot.dramatic_purpose || '—'}`,
    `视觉焦点：${shot.visual_focus || '—'}`,
    `出场角色：${castLine}`,
    `对白：${formatDramaDialogueLines(shot.dialogue) || cutDialogueLines(shot) || '（无）'}`,
    `潜台词/备注：${shot.continuity_notes || '—'}`,
    `时间轴切段：\n${timeline}`,
    cutDialogueLockBlock(shot),
  ].filter(Boolean).join('\n');
}

function cutDialogueLines(shot: DramaShot): string {
  return (shot.timeline_events || [])
    .map((ev) => spokenTextFromDramaTimelineEvent(ev))
    .filter(Boolean)
    .map((t) => `「${t}」`)
    .join('；');
}

function cutDialogueLockBlock(shot: DramaShot): string {
  const rows = (shot.timeline_events || [])
    .map((ev, i) => {
      const text = spokenTextFromDramaTimelineEvent(ev);
      if (!text) return '';
      const t0 = Number(ev.start_sec) || 0;
      const t1 = Number(ev.end_sec) || t0;
      return `${i + 1}. ${t0}-${t1}s 「${text}」`;
    })
    .filter(Boolean);
  if (!rows.length) return '';
  return [
    '切段对白（必须全部写入终稿【节拍】对应行的「」以及【音频】逐字；禁止输出 [NO_DIALOGUE]，禁止写全程闭口/无对白）：',
    ...rows,
  ].join('\n');
}

export type DramaH3SpliceIntegrateInput = {
  session: DramaDirectorSession;
  shot: DramaShot;
  /** 当前整镜编译稿（可作拼接参考） */
  compiledPrompt?: string;
  /** 参考图：图N → 说明 */
  imageBindings: Array<{ index: number; label: string }>;
  /** 参考音：音频N → 说明 */
  audioBindings: Array<{ index: number; label: string }>;
  platformMode?: DramaH3PlatformMode;
};

export function buildDramaH3SpliceIntegrateUserPrompt(input: DramaH3SpliceIntegrateInput): string {
  const { session, shot } = input;
  const hasDialogue = dramaShotHasSpokenDialogue(shot);
  const platform: DramaH3PlatformMode = input.platformMode === 'local' ? 'local' : 'api';
  const style = visualStyleLine(session);
  const scenes = input.imageBindings
    .map((b) => `图${b.index} → ${b.label}`)
    .join('\n');
  const audios = input.audioBindings
    .map((b) => `音频${b.index} → ${b.label}`)
    .join('\n');
  const compiled = String(input.compiledPrompt || '').trim();

  return [
    '【本次输入数据】',
    `全局风格：${style || '（未设置）'}`,
    '',
    '分镜表：',
    fmtShotTable(session, shot),
    '',
    '场景/人物参考图：',
    scenes || '（无）',
    '',
    '角色音色：',
    audios || '（无）',
    '',
    `hasDialogue：${hasDialogue ? 'true' : 'false'}`,
    hasDialogue
      ? '对白硬锁：切段已有台词。终稿必须保留全部「」原文。禁止 [NO_DIALOGUE]、禁止写江澈全程闭口/无人声/无对白。'
      : '',
    `平台模式：${platform}`,
    '',
    compiled
      ? `当前整镜编译稿（可并入拼接，须去重整合）：\n${compiled}`
      : '当前整镜编译稿：（无，请仅根据分镜与参考绑定拼接）',
    '',
    '请按系统提示词执行拼接+整合，输出三部分结果。',
    '硬性提醒：api 终稿必须是短中文时间轴生产稿（开头锁定 + 00:00–00:03.6 切段 + 结尾连续性）。禁止 [场景概述]、[镜头 N]、【节拍】。',
    `时间线必须覆盖 00:00–${String(shot.duration_sec).padStart(2, '0')} 对应时段，切段有几句台词就写几个 <d>[Chinese]…</d>。`,
  ].join('\n');
}

export function buildDramaH3SpliceIntegrateMessages(input: DramaH3SpliceIntegrateInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: DRAMA_H3_SPLICE_INTEGRATE_SYSTEM_PROMPT,
    userPrompt: buildDramaH3SpliceIntegrateUserPrompt(input),
  };
}

export type DramaMultiShotMergeInput = {
  session: DramaDirectorSession;
  /** 按播放顺序 */
  sourceShots: DramaShot[];
  /** 合并后的单镜（参考绑定已去重） */
  mergedShot: DramaShot;
  imageBindings: Array<{ index: number; label: string }>;
  audioBindings: Array<{ index: number; label: string }>;
  compiledPrompt?: string;
  platformMode?: DramaH3PlatformMode;
};

const DRAMA_MULTI_SHOT_MERGE_EXTRA = `

【多镜合并任务】
本次输入为「多镜合并为一镜」：参考图/参考音绑定已去重；时间轴已按镜序拼接。
你必须输出**单一连续镜头**的整合终稿（第三部分），时间窗覆盖合并后总时长，不得保留「镜01/镜02」分段标题。
删除镜间重复的约束、重复的场景/人物绑定说明、重复负面词；保留全部叙事信息与对白顺序。`;

export function buildDramaMultiShotMergeUserPrompt(input: DramaMultiShotMergeInput): string {
  const { session, sourceShots, mergedShot } = input;
  const platform: DramaH3PlatformMode = input.platformMode === 'local' ? 'local' : 'api';
  const style = visualStyleLine(session);
  const scenes = input.imageBindings.map((b) => `图${b.index} → ${b.label}`).join('\n');
  const audios = input.audioBindings.map((b) => `音频${b.index} → ${b.label}`).join('\n');
  const compiled = String(input.compiledPrompt || '').trim();
  const hasDialogue = dramaShotHasSpokenDialogue(mergedShot);
  const tables = sourceShots
    .map((s, i) => `--- 原镜 ${i + 1}（镜号 ${s.shot_no}）---\n${fmtShotTable(session, s)}`)
    .join('\n\n');

  return [
    '【本次输入数据 · 多镜合并】',
    `待合并镜数：${sourceShots.length}`,
    `合并后镜号（保留）：${mergedShot.shot_no}`,
    `合并后总时长(秒)：${mergedShot.duration_sec}`,
    `全局风格：${style || '（未设置）'}`,
    '',
    '原分镜表（按播放顺序，供拼接参考）：',
    tables,
    '',
    '合并后单镜分镜表（参考绑定已去重，时间轴已拼接）：',
    fmtShotTable(session, mergedShot),
    '',
    '去重后的场景/人物参考图：',
    scenes || '（无）',
    '',
    '去重后的角色音色：',
    audios || '（无）',
    '',
    `hasDialogue：${hasDialogue ? 'true' : 'false'}`,
    hasDialogue
      ? '对白硬锁：切段已有台词。终稿必须保留全部「」原文。禁止 [NO_DIALOGUE]、禁止写全程闭口/无人声/无对白。'
      : '',
    `平台模式：${platform}`,
    '',
    compiled
      ? `多镜提示词草稿（须去重整合为单镜终稿）：\n${compiled}`
      : '多镜提示词草稿：（无，请根据合并分镜表拼接）',
    '',
    '请按系统提示词执行拼接+整合，输出三部分结果；终稿必须是合并后的**一镜**连续提示词。',
    '硬性提醒：api 终稿必须是短中文时间轴生产稿（开头锁定 + 00:00–00:03.6 切段 + 结尾连续性）。禁止 [场景概述]、[镜头 N]、【节拍】。',
    `时间线必须覆盖 00:00–${String(mergedShot.duration_sec).padStart(2, '0')} 对应时段，切段有几句台词就写几个 <d>[Chinese]…</d>。`,
  ].join('\n');
}

export function buildDramaMultiShotMergeMessages(input: DramaMultiShotMergeInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  return {
    systemPrompt: DRAMA_H3_SPLICE_INTEGRATE_SYSTEM_PROMPT + DRAMA_MULTI_SHOT_MERGE_EXTRA,
    userPrompt: buildDramaMultiShotMergeUserPrompt(input),
  };
}

export type DramaH3SpliceIntegrateParsed = {
  draft: string;
  report: string;
  final: string;
};

function sliceBetween(raw: string, startRe: RegExp, endRe: RegExp | null): string {
  const s = String(raw || '');
  const m = startRe.exec(s);
  if (!m || m.index == null) return '';
  const from = m.index + m[0].length;
  const rest = s.slice(from);
  if (!endRe) return rest.trim();
  const end = endRe.exec(rest);
  if (!end || end.index == null) return rest.trim();
  return rest.slice(0, end.index).trim();
}

/** 解析三部分输出；若结构不完整则尽量兜底终稿 */
export function parseDramaH3SpliceIntegrateResult(raw: string): DramaH3SpliceIntegrateParsed {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  const draft = sliceBetween(
    text,
    /第一部分\s*[:：]?\s*拼接草稿/,
    /第二部分\s*[:：]?\s*整合报告/,
  ).replace(/^[━=\-]{3,}\s*/gm, '').trim();
  const report = sliceBetween(
    text,
    /第二部分\s*[:：]?\s*整合报告/,
    /第三部分\s*[:：]?\s*整合终稿/,
  ).replace(/^[━=\-]{3,}\s*/gm, '').trim();
  let final = sliceBetween(text, /第三部分\s*[:：]?\s*整合终稿/, null)
    .replace(/^[━=\-]{3,}\s*/gm, '')
    .trim();

  if (!final) {
    // 兜底：取最后一个明显终稿块，或全文
    const parts = text.split(/第三部分\s*[:：]?\s*整合终稿/);
    if (parts.length > 1) final = parts[parts.length - 1].replace(/^[━=\-\s]+/, '').trim();
  }
  if (!final) final = text;

  // 去掉模型偶发的解释尾巴
  final = final
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^(以下是|如下为|终稿如下)[^\n]*\n+/i, '')
    .trim();

  return {
    draft: draft || '（模型未返回独立拼接草稿）',
    report: report || '（模型未返回整合报告）',
    final,
  };
}

export function isAcceptableDramaH3SpliceFinal(final: string, platformMode: DramaH3PlatformMode = 'api'): boolean {
  const t = String(final || '').trim();
  if (t.length < 40) return false;
  if (/第一部分\s*[:：]?\s*拼接草稿|第二部分\s*[:：]?\s*整合报告/.test(t)) return false;
  if (/不要说这行|不要读这条/.test(t)) return false;
  if (platformMode === 'local') {
    return /subject_definitions\s*:/i.test(t) && /detailed_description\s*:/i.test(t);
  }
  // api：短中文时间轴生产稿（带 <d>）或已优化英文 8 段
  if (isDramaH3AntiCrosstalkPrompt(t)) return true;
  if (isLegacyDramaH3ChineseLensPrompt(t)) return false;
  if (isDramaH3LensTaggedPrompt(t)) return true;
  if (!/\[场景概述\]/.test(t)) return false;
  return true;
}

/**
 * 如果终稿缺少 [场景概述]，从 shot 信息自动补一个，避免直接 throw 阻塞生成。
 * 插入位置：[NO_DIALOGUE] 或 [Spoken-words lock] 之后、其他段之前。
 */
export function ensureDramaH3SceneOverview(
  final: string,
  shot: DramaShot,
  session: DramaDirectorSession,
): string {
  const t = String(final || '').trim();
  if (/\[场景概述\]/.test(t)) return t;

  // 从 shot 信息提取场景概述素材
  const castNames = listDramaShotCastDisplayNames(session, shot);
  const beat = (session.scene_beats || []).find((b) => b.scene_beat_id === shot.scene_beat_id);
  const location = String(beat?.location_name || shot.shot_no || '').trim();
  const dialogueStr = formatDramaDialogueLines(shot.dialogue || []);
  const hasDialogue = dramaShotHasSpokenDialogue(shot);
  const isEmptyShot = isDramaShotExplicitEmptyShot(shot);

  // 构造 80-120 字场景概述
  const whoPart = castNames.length
    ? castNames.slice(0, 3).join('与')
    : isEmptyShot
      ? '空镜'
      : '角色';
  const locPart = location || '场景中';
  const dlgPart = hasDialogue && dialogueStr
    ? `对白：「${String(dialogueStr).slice(0, 40)}${dialogueStr.length > 40 ? '…' : ''}」`
    : isEmptyShot
      ? '无人物'
      : '无对白';
  const moodPart = String(shot.expression || '').trim();
  const actionPart = String(shot.action || '').trim().slice(0, 50);

  const overview = [
    `[场景概述] ${locPart}，`,
    whoPart,
    isEmptyShot ? '' : `${actionPart ? '正在' + actionPart : ''}`,
    dlgPart ? '，' + dlgPart : '',
    moodPart ? '，情绪基调' + moodPart : '',
    '。',
  ].join('').replace(/，+/g, '，').replace(/，。/g, '。');

  // 插入到 [NO_DIALOGUE] 或 [Spoken-words lock] 之后
  const insertAfter = /\[NO_DIALOGUE\]|\[Spoken-words lock\]/;
  if (insertAfter.test(t)) {
    return t.replace(insertAfter, (m) => `${m}\n${overview}`);
  }
  // 否则插入到开头
  return `${overview}\n${t}`;
}

/**
 * 如果终稿格式不合规但内容可用，做最小修复后返回；否则返回 null。
 * 修复项：缺少 [场景概述] → 自动补全
 */
export function repairDramaH3SpliceFinal(
  final: string,
  shot: DramaShot,
  session: DramaDirectorSession,
  platformMode: DramaH3PlatformMode = 'api',
): string | null {
  const t = String(final || '').trim();
  if (t.length < 40) return null;
  if (/第一部分\s*[:：]?\s*拼接草稿|第二部分\s*[:：]?\s*整合报告/.test(t)) return null;
  if (/不要说这行|不要读这条/.test(t)) return null;
  if (platformMode === 'local') {
    if (/subject_definitions\s*:/i.test(t) && /detailed_description\s*:/i.test(t)) return t;
    return null;
  }
  if (isDramaH3AntiCrosstalkPrompt(t)) return t;
  if (isDramaH3LensTaggedPrompt(t) && !isLegacyDramaH3ChineseLensPrompt(t)) return t;
  const lens = composeDramaShotLensTaggedPrompt(session, shot);
  if (isDramaH3LensTaggedPrompt(lens)) return lens;
  if (!/\[场景概述\]/.test(t)) {
    return ensureDramaH3SceneOverview(t, shot, session);
  }
  return t;
}

// ===== 紧凑格式校验（v3 增量）=====

const DRAMA_H3_COMPACT_LABELS = [
  '【目标】',
  '【参考】',
  '【主体】',
  '【节拍】',
  '【摄影】',
  '【音频】',
  '【不变】',
  '【终态】',
] as const;

/** 允许的机位指令枚举（节拍行 [xxx] 内必须是其中之一，可中英混用） */
const DRAMA_H3_COMPACT_CAMERA_ENUM = [
  '固定机位',
  '手持跟拍',
  '手持微晃',
  'hard cut 急推',
  '急推',
  '缓推',
  '特写定格',
  '过肩',
  '低角度',
  '俯瞰',
  '广角',
  '屏幕特写',
  '近景',
  '中景',
  '全景',
  '远景',
  '大远景',
  '特写',
];

/**
 * 校验终稿是否符合紧凑 8 段格式（v3 增量）。
 * 通过 = 可作为 H3 skill 优化的密集源；不通过 = 调用方降级走原 8 段长描写。
 *
 * 校验项：
 * 1. 含 8 个标签：【目标】【参考】【主体】【节拍】【摄影】【音频】【不变】【终态】
 * 2. 不含 <d>[Chinese] 标签（紧凑格式对白用「」，<d> 由 skill 优化阶段嵌入）
 * 3. 节拍行格式「N. [机位] 动作 起-止s」
 * 4. 节拍每行 ≤30 字（不含时间戳）
 * 5. 时长格式「起-止s」，不用 [HH:MM.XXX-HH:MM.XXX]
 * 6. 全文 ≤500 字（含标签；放宽到 500 防 LLM 偶尔多写）
 * 7. 节拍机位指令必须从枚举中取
 */
export function isAcceptableDramaH3CompactFinal(final: string): boolean {
  const t = String(final || '').trim();
  if (!t) return false;

  // 1. 含 8 个标签
  for (const label of DRAMA_H3_COMPACT_LABELS) {
    if (!t.includes(label)) return false;
  }

  // 2. 不含 <d>[Chinese] 标签（紧凑格式对白用「」）
  if (/<d>\s*\[Chinese/i.test(t)) return false;

  // 3. 不含 [场景概述] / [Spoken-words lock] 等长格式标签（防 LLM 混合输出）
  if (/\[场景概述\]|\[Spoken-words lock\]|\[场景锚点锁定\]|\[对白规则\]|\[声音描述\]|\[负面清单\]/.test(t)) {
    return false;
  }

  // 4. 全文 ≤500 字
  if (t.length > 500) return false;

  // 5. 提取【节拍】段
  const beatMatch = t.match(/【节拍】\s*\n([\s\S]*?)(?=\n【|$)/);
  if (!beatMatch) return false;
  const beatBody = beatMatch[1].trim();
  if (!beatBody) return false;

  // 6. 节拍行格式「N. [机位] 动作 起-止s」
  const beatLines = beatBody.split('\n').map((l) => l.trim()).filter(Boolean);
  if (beatLines.length === 0) return false;

  // 每行必须以「数字. 」开头
  for (const line of beatLines) {
    if (!/^\d+\.\s/.test(line)) return false;
    // 必须有时长「起-止s」
    if (!/\d+-\d+s/.test(line)) return false;
    // 不用毫秒格式
    if (/\[\d{2}:\d{2}\.\d{3}/.test(line)) return false;
    // 行长 ≤30 字（去掉时间戳后算）
    const stripped = line.replace(/\d+-\d+s$/, '').replace(/^\d+\.\s/, '').trim();
    if (stripped.length > 60) return false; // 放宽到 60 防 LLM 写中文一字算多
  }

  // 7. 机位指令必须从枚举中取（[xxx] 内容必须是枚举之一）
  for (const line of beatLines) {
    const camMatch = line.match(/\[([^\]]+)\]/);
    if (!camMatch) return false;
    const cam = camMatch[1].trim();
    if (!DRAMA_H3_COMPACT_CAMERA_ENUM.includes(cam)) return false;
  }

  return true;
}

function overlapSec(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - 1e-6 && b0 < a1 - 1e-6;
}

/** 切段已有台词时，清掉 LLM 误写的 [NO_DIALOGUE]/全程闭口，并把「」补回节拍 */
export function reinjectCutDialogueIntoDramaH3Final(final: string, shot: DramaShot): string {
  const cuts = (shot.timeline_events || [])
    .map((ev, index) => ({
      index,
      start_sec: Number(ev.start_sec) || 0,
      end_sec: Number(ev.end_sec) || 0,
      text: spokenTextFromDramaTimelineEvent(ev),
    }))
    .filter((x) => x.text);
  if (!cuts.length) return String(final || '').trim();

  let t = String(final || '').replace(/\r\n/g, '\n');
  t = t.replace(/^\[NO_DIALOGUE\][^\n]*\n*/i, '');
  t = t.replace(/^[^\n]*全程闭口[^\n]*\n*/gm, '');
  t = t.replace(/【音频】\s*无对白[；;，,\s]*/g, '【音频】');

  const beatMatch = t.match(/【节拍】\s*\n([\s\S]*?)(?=\n【|$)/);
  if (beatMatch) {
    const nextLines = beatMatch[1].split('\n').map((line) => {
      const raw = line;
      const num = line.match(/^(\d+)\.\s/);
      const time = line.match(/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)s/);
      const hit =
        (num ? cuts.find((c) => c.index === Number(num[1]) - 1) : null) ||
        (time
          ? cuts.find((c) =>
              overlapSec(Number(time[1]), Number(time[2]), c.start_sec, c.end_sec),
            )
          : null);
      if (!hit) return raw;
      if (raw.includes(`「${hit.text}」`) || raw.includes(hit.text)) return raw;
      if (/\d+(?:\.\d+)?-\d+(?:\.\d+)?s\s*$/.test(raw)) {
        return raw.replace(/(\s*\d+(?:\.\d+)?-\d+(?:\.\d+)?s\s*)$/, ` 「${hit.text}」$1`);
      }
      return `${raw} 「${hit.text}」`;
    });
    t = t.replace(beatMatch[0], `【节拍】\n${nextLines.join('\n')}${beatMatch[0].endsWith('\n') ? '\n' : ''}`);
  }

  if (/【音频】/.test(t) && !cuts.some((c) => t.includes(c.text))) {
    const listed = cuts.map((c) => `「${c.text}」`).join('；');
    t = t.replace(/【音频】/, `【音频】对白${listed}；`);
  }
  return t.trim();
}

/**
 * 从 LLM 输出中提取紧凑格式终稿。
 * LLM 仍可能输出三部分结构（第一/二/三部分），本函数提取第三部分并校验是否紧凑格式。
 * 返回 { ok, final, error? }：ok=true 时 final 为紧凑格式终稿。
 */
export function extractDramaH3CompactFinal(raw: string): {
  ok: boolean;
  final: string;
  error?: string;
} {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  // 复用现有 parseDramaH3SpliceIntegrateResult 提取第三部分
  const parsed = parseDramaH3SpliceIntegrateResult(text);
  const final = parsed.final;

  if (
    (isDramaH3LensTaggedPrompt(final) && !isLegacyDramaH3ChineseLensPrompt(final)) ||
    isAcceptableDramaH3CompactFinal(final)
  ) {
    return { ok: true, final };
  }
  return {
    ok: false,
    final,
    error: '紧凑格式校验失败：缺标签 / 含 <d> 标签 / 节拍行超长 / 机位非枚举',
  };
}

// ===== H3 提示词运行时校验（v3 新增）=====

/** 统计提示词内 <d>[Chinese] 出现次数（原文 token 不变，禁止空格变体绕过） */
export function countDramaH3DialogueTags(prompt: string): number {
  const t = String(prompt || '');
  let count = 0;
  // 匹配 <d>[Chinese]xxx</d>，允许中文/全角空格
  const re = /<d>\s*\[Chinese[^\]]*\]\s*[^<]*<\/d>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    count++;
    // 防死循环
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return count;
}

/**
 * 检测单镜对白句数。
 * @returns 句数；0 表示无对白
 */
export function countDramaShotDialogueSentences(shot: DramaShot): number {
  const list = shot.dialogue || [];
  return list.filter((d) => String(d?.text || '').trim().length > 0).length;
}

/**
 * short-drama 拆镜判定：单镜对白 ≥2 句 → 触发拆镜警告。
 * 上层调用此函数决定是否拆镜。本函数只判定不执行拆镜。
 */
export function needsDramaShotSplitForH3Audio(shot: DramaShot): {
  needSplit: boolean;
  dialogueCount: number;
  reason: string;
} {
  const n = countDramaShotDialogueSentences(shot);
  if (n <= 1) {
    return { needSplit: false, dialogueCount: n, reason: '' };
  }
  return {
    needSplit: true,
    dialogueCount: n,
    reason: `short-drama 单镜只允许 1 句对白，当前镜 ${shot.shot_no} 有 ${n} 句，须拆为 ${n} 个子镜，每镜仅保留 1 句台词，保证全文 <d>[Chinese] 计数严格等于 1。`,
  };
}

/**
 * 提示词运行时硬校验。任一项不通过直接拦截，不向下游输出。
 * @returns ok=true 通过；ok=false 拦截，errors 为失败原因列表
 */
export function validateDramaH3SpliceFinal(final: string): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const t = String(final || '');

  // 1. 禁止存在子串 `<d>[Chinese] ... </d>`（占位符）
  if (/<d>\s*\[Chinese[^\]]*\]\s*\.\.\.\s*<\/d>/i.test(t)) {
    errors.push('禁止存在模板占位符 `<d>[Chinese] ... </d>`，必须替换为真实台词。');
  }

  // 2. 统计 <d>[Chinese] 出现次数必须等于 1
  const tagCount = countDramaH3DialogueTags(t);
  if (tagCount !== 1) {
    errors.push(`全文 <d>[Chinese] 出现次数必须等于 1，当前为 ${tagCount}。`);
  }

  // 3. 必须包含防朗读硬约束文本
  if (!t.includes('本提示词不是配音稿，禁止朗读提示词')) {
    errors.push('[Spoken-words lock] 必须包含文本：本提示词不是配音稿，禁止朗读提示词');
  }

  // 4. <d> 标签必须位于时间线切片内部，不能出现在 Spoken-words lock 头部
  // 找到 [Spoken-words lock] 段范围（从该标签到下一个 [ 标签之间）
  const spokenMatch = /\[Spoken-words lock\][\s\S]*?(?=\n\[)/i.exec(t);
  if (spokenMatch && /<d>\s*\[Chinese/i.test(spokenMatch[0])) {
    errors.push('<d> 标签不得出现在 [Spoken-words lock] 头部，必须位于时间线切片内部。');
  }
  // 同时确认 <d> 标签位于 [时间线] 段内
  const timelineMatch = /\[时间线\]([\s\S]*?)(?=\n\[负面清单\]|\n\[声音描述\]|\n$|$)/i.exec(t);
  if (timelineMatch && !/<d>\s*\[Chinese/i.test(timelineMatch[1])) {
    errors.push('<d> 标签必须位于 [时间线] 切片内部，当前时间线段未检出 <d> 标签。');
  }

  // 5. 时间切片格式正则校验 [HH:MM.XXX–HH:MM.XXX]（支持 – en-dash 与 - 普通连字符）
  const sliceRe = /\[\d{2}:\d{2}\.\d{3}[–\-]\d{2}:\d{2}\.\d{3}\]/;
  if (!sliceRe.test(t)) {
    errors.push('时间线必须包含至少一个时间切片 [HH:MM.XXX–HH:MM.XXX]，格式不合规。');
  }

  return { ok: errors.length === 0, errors };
}
