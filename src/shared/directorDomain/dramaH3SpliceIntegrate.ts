/**
 * 「提示词优化」= 拼接草稿 + 整合终稿（AIXFLOW 短剧导演台提示词工程师）。
 * 输出三部分：拼接草稿 / 整合报告 / 整合终稿；生成时优先发送终稿。
 */

import { dramaShotHasSpokenDialogue } from './migrateH3Compiler.js';
import { formatDramaDialogueLines } from './factories.js';
import { formatDramaTimelineEventDisplay } from './timelineEvent.js';
import {
  dramaShotRequiresCast,
  isDramaShotExplicitEmptyShot,
  listDramaShotCastDisplayNames,
} from './shotCastGate.js';
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

【拼接规则】
将输入数据拼接成一份完整提示词草稿，包含以下必要信息：
- 有/无对白模式声明
- [场景概述]（一句话地图：谁、在哪里、干什么、和谁/是否独处、情绪基调；可先草稿，整合层再精炼）
- 参考图/音绑定（图N是什么，音频N是什么）
- 视觉风格（继承全局风格，但可被分镜表的光线覆盖）
- 镜头时间线（按分镜表顺序，每个镜头标注时间窗、动作、对白、声音）
- 负面清单（禁止出现的内容）

拼接时不做去重，不做冲突解决，只做信息堆叠。若提供了整镜编译稿，可并入草稿，但仍须完整堆叠分镜与参考绑定信息。

【场景概述规则 - 强制】
整合终稿（平台 api）开头，必须在 [NO_DIALOGUE] 或 [Spoken-words lock] 之后、场景锚点/视觉风格之前，插入一段 [场景概述]：

格式：[场景概述] 一句话说清这个视频是什么（谁、在哪里、干什么、和谁或是否独处、什么情绪基调）。不超过50字。不包含任何镜头术语（景别、运镜、焦段、跟拍、甩镜等），只用叙事语言。

作用：在 H3 读细节之前先建立整体语境（“地图”），防止 Context-IR 自行脑补成错误故事模板（如雨夜+外卖员→两人深情对望）。

示例：
- ✅ "[场景概述] 雨夜，外卖员周一川在积水街道上独自骑行，穿过密集车流，冲向写字楼入口。"
- ✅ "[场景概述] 写字楼内，周一川站在办公桌前，与西装男对峙，压抑沉默。"
- ❌ "[场景概述] 中近景低角度跟拍周一川骑行"（不能写镜头术语）
- ❌ "[场景概述] 周一川很焦虑"（不能只写情绪）

层级提醒：场景概述=地图；时间线=显微镜。缺地图时细节指令会被模型脑补覆盖。

【出演门禁 - 强制】
- 若本镜未明确标成空镜/无人物：必须写清出场角色姓名（与人物参考图一致），禁止「出场人物」「某人」「路人甲」等匿名占位。
- [场景概述] 与时间线动作主语必须点名谁出演；有人物参考图时动作须落到对应姓名。
- 仅当输入明确空镜时，才可写无人物、无人脸、无肢体。

【整合规则 - 强制】
拼接完成后，执行以下操作：

1. 去重：
   - 同一约束声明（如"无对白""不要说""不要说话"）出现多次 → 只保留第一次，删除后续
   - 同一视觉描述重复出现 → 只保留最完整的一条
   - 同一声音描述重复出现 → 只保留最完整的一条
   - [场景概述] 只保留一条，放在模式声明之后

2. 合并：
   - 同类信息（如多个"保持图1"的约束）→ 合并为一段
   - 同一时间窗的对白 + 动作 + 声音 → 合并到该时间窗内
   - 多个负面词 → 合并为一段，用逗号分隔

3. 修正格式：
   - 时间戳统一为 [HH:MM:SS.mmm] 格式（若平台为 api 且终稿用中文自然语言，可用「0.0–2.0秒」等清晰时间窗，但不得混用多种乱格式）
   - 对白用 <d>[Chinese] ... </d> 标签包裹（有对白时）
   - 参考图用 <图N> 或 Picture N / 图N 一致引用
   - 参考音用 <音频N> 标签引用
   - 角色用 <主体N> 或清晰角色名引用，前后一致
   - [场景概述] 必须带标签，纯叙事，≤50字，无镜头术语

4. 补缺：
   - 缺失 duration_sec → 从分镜表秒列获取
   - 缺失有/无对白模式声明 → 从 hasDialogue 字段获取
   - 缺失参考图绑定 → 从输入数据中补全
   - 缺失 [场景概述] → 根据出场角色、地点、动作、是否独处、情绪基调补写一句（强制）

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
- 平台模式 api → 终稿用中文自然语言为主；有对白时口语放在 <d>[Chinese] ... </d>；不要输出英文六段字段名；必须含 [场景概述]
- 平台模式 local → 终稿用英文六段式：subject_definitions → summary → retention_analysis → detailed_description → overall_soundscape → non_diegetic_music；其中 summary 须承担与 [场景概述] 同等的“整体是什么”职责（叙事一句，无镜头术语）

【终稿结构（api）】
无对白模式：
[NO_DIALOGUE] + [场景概述] + 场景锚点锁定 + 视觉风格 + 镜头时间线 + 声音描述 + 负面清单

有对白模式：
[Spoken-words lock] 语义 + [场景概述] + 场景锚点锁定 + 视觉风格 + 对白规则 + 镜头时间线（含对白窗） + 声音描述 + 负面清单

【密度标杆示例 · 15秒有对白镜（api 终稿，勿照抄剧情，只学结构与单窗密度）】
时长 15s 时时间线须覆盖 [00:00.000–00:15.000]，通常 2 个 6s 全窗 + 1 个 3s 收束窗；每窗含空间、表演、光影、拟音四要素，对白落在子时间窗 <d> 内。

[Spoken-words lock] 成片中仅允许在 <d>[Chinese] ... </d> 标签内出现人声台词；仅在对应时间窗内说出标签中的中文原句。其余时间仅保留环境声与拟音，所有角色闭口，无额外人声、旁白、低语、歌唱或重复台词。口型仅在台词时间窗内与台词同步。无烧录字幕、无屏幕字幕、无可读文字。
[场景概述] 雨夜，外卖员周一川遭客户差评后独自冒雨奔波，本段为金鼎国际1708办公室内与客户对峙开端。
[场景锚点锁定] <图1>为金鼎国际1708室办公室视觉锚点：办公桌、三台显示器、代码界面、人体工学椅、深色玻璃窗。<图2>为周一川身份与湿透外卖服锚点。程序员客户为<主体3>，仅出现于办公室段，与周一川严格区分，外观前后一致。
[视觉风格] 电影质感，低饱和、高反差、深层阴影与压黑黑位；35mm变形宽银幕构图，中等景深、椭圆散景、轻微变形耀斑；Kodak Vision3 500T胶片颗粒，都市雨夜悬疑氛围，写实电影光影。各时间窗光线以分镜描述为准。
[对白规则] 本镜 15 秒内：周一川仅说「雨太大了」；程序员客户仅说「超时多久了」。无配乐、无歌曲、无额外声音角色。
[时间线]
[00:00.000–00:06.000] 金鼎国际1708室。周一川站在办公桌外，不敢靠近，将保温袋搁在桌沿，指尖擦过水渍；眼皮低垂、嘴唇发白、指尖蜷起。桌面暖台灯照亮袋口，屏幕冷光切过手背。保温袋落桌闷响、水滴砸桌、键盘骤停。 [00:04.500–00:06.000] 周一川低声说：<d>[Chinese] 雨太大了。</d>
[00:06.000–00:12.000] 程序员客户隔着显示器抬眼，屏幕边缘压住前景；冷屏光从下托脸，台灯硬边勾出轮廓。客户眉心拧紧、嘴角下压，直视周一川。键盘停键声、椅轮轻响、主机风扇轰鸣。 [00:10.500–00:12.000] 程序员客户说：<d>[Chinese] 超时多久了？</d>
[00:12.000–00:15.000] 周一川盯住桌面水渍，吸气卡住，瞳孔缩紧、鼻翼翕动、湿睫毛轻颤，随后缓慢抬眼。客户显示器虚化于前景。屏幕冷光铺过半张脸，台灯暖边被阴影截断。滞住的呼吸、水滴落地、低频风扇。
[声音描述] 全程仅使用上述对白、环境声与拟音。办公室段以键盘、风扇、雨拍窗构成压迫感；无配乐。
[负面清单] 无烧录字幕、无屏幕字幕、无可读文字、无水印、无Logo、无额外UI；无额外角色、无额外人声、无旁白、无配乐、无歌曲；不改变<图2>周一川身份和服装；程序员客户不得被替换成周一川；不改变办公室既定空间关系。

【硬性禁止】
1. 终稿中不得出现调试用语（如"不要说这行""不要读这条"）
2. 终稿中不得出现占位符（如空的 【 】、+ +）
3. 终稿中不得堆叠重复声明
4. 终稿中不得保留任何未解决的角色名/角色编号缺失
5. 第三部分只能是终稿正文，不要再解释
6. api 终稿不得缺少 [场景概述]；[场景概述] 不得写成景别/运镜/焦段等镜头术语`;

function visualStyleLine(session: DramaDirectorSession): string {
  const pvb = session.bible.projectVisualBible;
  const dna = pvb?.visualDNA || session.bible.visualDNA;
  return String(
    pvb?.stylePrompt ||
      dna?.generatedPrompt ||
      session.bible.visual?.style ||
      session.meta.globalStyle ||
      '',
  ).trim();
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
    `对白：${formatDramaDialogueLines(shot.dialogue) || '（无）'}`,
    `潜台词/备注：${shot.continuity_notes || '—'}`,
    `时间轴切段：\n${timeline}`,
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
    `平台模式：${platform}`,
    '',
    compiled
      ? `当前整镜编译稿（可并入拼接，须去重整合）：\n${compiled}`
      : '当前整镜编译稿：（无，请仅根据分镜与参考绑定拼接）',
    '',
    '请按系统提示词执行拼接+整合，输出三部分结果。',
    '硬性提醒：api 终稿必须在模式声明之后立即包含一行 [场景概述]（≤50字纯叙事，无景别/运镜术语），否则视为不合格。',
    `时间线必须覆盖 [00:00.000–00:${String(shot.duration_sec).padStart(2, '0')}.000]，单窗信息密度对齐系统提示词中的「15秒有对白镜」标杆（动作+微表情+光影+拟音，对白落子窗 <d> 内）。`,
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
    `平台模式：${platform}`,
    '',
    compiled
      ? `多镜提示词草稿（须去重整合为单镜终稿）：\n${compiled}`
      : '多镜提示词草稿：（无，请根据合并分镜表拼接）',
    '',
    '请按系统提示词执行拼接+整合，输出三部分结果；终稿必须是合并后的**一镜**连续提示词。',
    '硬性提醒：api 终稿必须在模式声明之后立即包含一行 [场景概述]（≤50字纯叙事，无景别/运镜术语），否则视为不合格。',
    `时间线必须覆盖 [00:00.000–00:${String(mergedShot.duration_sec).padStart(2, '0')}.000]，单窗信息密度对齐系统提示词中的「15秒有对白镜」标杆（动作+微表情+光影+拟音，对白落子窗 <d> 内）。`,
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
  // api：必须有「场景概述」地图句，防止 H3 Context-IR 脑补故事
  if (!/\[场景概述\]/.test(t)) return false;
  return true;
}
