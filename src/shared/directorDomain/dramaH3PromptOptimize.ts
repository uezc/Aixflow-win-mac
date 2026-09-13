/**
 * 短剧「提示词优化」= 官方 MiniMax H3 Skill + 短剧四段格式：
 * 英文标签 + 中文正文；已锁定画风色调写入 detailed_description 首段；参考图只锁身份。
 */

import {
  buildMinimaxH3OptimizeMessages,
  isAcceptableMinimaxH3OptimizedPrompt,
  isMinimaxH3ChineseSkillPrompt,
  parseMinimaxH3OptimizedPrompt,
  recoverMinimaxH3OptimizedPrompt,
  resolveMinimaxH3BaseSubMode,
  resolveMinimaxH3OptimizeStructure,
  sanitizeDramaChineseH3SkillPrompt,
  sanitizeDramaEnglishH3SkillPrompt,
  type MinimaxH3OptimizeStructure,
} from '../minimaxH3OptimizePrompt.js';
import {
  composeDramaShotLensTaggedPrompt,
  isDramaH3AntiCrosstalkPrompt,
  isDramaH3ProductionPrompt,
  resolveDramaShotVisualStylePrompt,
  sealDramaProductionCloudPrompt,
} from './composeDramaShotLensPrompt.js';
import {
  dramaShotHasSpokenDialogue,
  resolveDramaShotAudioTimeline,
  speakerIdForCharacter,
} from './migrateH3Compiler.js';
import { formatDramaDialogueLines } from './factories.js';
import { listDramaShotRefAudioSlots, listDramaShotRefImageSlots } from './shotRefs.js';
import { formatDramaTimelineEventDisplay } from './timelineEvent.js';
import { resolveDramaShotVideoModel } from './dramaVideoModels.js';
import type { DramaDirectorSession, DramaShot } from './types.js';

export function buildDramaShotH3SourceBrief(
  session: DramaDirectorSession,
  shot: DramaShot,
): string {
  const events = shot.timeline_events || [];
  const timeline = events.length
    ? events.map((ev) => formatDramaTimelineEventDisplay(ev)).join('\n')
    : '—';
  const audio = resolveDramaShotAudioTimeline(session, shot);
  const speakers = (session.bible.characters || [])
    .filter((c) => (shot.character_ids || []).includes(c.character_id))
    .map((c) => `${c.speaker_id || speakerIdForCharacter(session, c.character_id) || '?'} ${c.character_id} ${c.name}`)
    .join('\n');
  const audioLines = audio.length
    ? audio
        .map(
          (a) =>
            `${a.start_sec.toFixed(2)}–${a.end_sec.toFixed(2)} ${a.speaker_id} ${a.character_id}：「${a.text}」`,
        )
        .join('\n')
    : '（无对白事件）';

  return [
    `【镜号】${shot.shot_no}  【时长】${shot.duration_sec}s  【shot_id】${shot.shot_id}`,
    `【说话人表·只读】\n${speakers || '—'}`,
    `【AudioTimeline·只读·禁止修改起止/说话人/台词】\n${audioLines}`,
    `【画面切段·只读·无景别/机位/运镜/规划；由 Skill 补全】\n${timeline}`,
    `【对白原文·只读】${formatDramaDialogueLines(shot.dialogue) || '—'}`,
    `【已有用户表演】\n${
      (shot.performance_plan || [])
        .filter((b) => b.source === 'user')
        .map((b) => JSON.stringify(b))
        .join('\n') || '（无）'
    }`,
  ].join('\n\n');
}

export function shotHasRefAudio(session: DramaDirectorSession, shot: DramaShot): boolean {
  for (const vid of shot.voice_ids || []) {
    const v = session.bible.voices.find((x) => x.voice_id === vid);
    if (v?.sample_url) return true;
  }
  for (const id of shot.character_ids || []) {
    const c = (session.bible?.characters || []).find((x) => x.character_id === id);
    if (!c) continue;
    const v =
      session.bible.voices.find((x) => x.voice_id === c.voice_id) ||
      session.bible.voices.find((x) => x.character_id === c.character_id);
    if (v?.sample_url) return true;
  }
  return false;
}

const ENHANCE_SYSTEM = `你是短剧分镜的「导演增强」助手，不是 Prompt 写手。
只输出一个 JSON 对象，不要 markdown，不要六段式，不要主体定义/详细描述长文。

schema 必须是：
{
  "schema": "drama-directing-enhance.v1",
  "shot_id": "...",
  "performance_plan": [
    {
      "character_id": "已有角色 id",
      "audio_event_id": "可选，对应只读 AudioTimeline.event_id",
      "timeline_event_id": "可选",
      "facial_expression": "",
      "eye_direction": "",
      "mouth_state": "speaking|closed|natural",
      "breathing": "",
      "head_movement": "",
      "body_movement": "",
      "hand_movement": "",
      "emotional_change": "",
      "post_dialogue_reaction": ""
    }
  ],
  "directing_enhance": {
    "camera_movement": "",
    "focus_behavior": "",
    "subtle_environment_action": ""
  }
}

硬性禁止修改（出现即无效）：speakerId、character 身份、dialogue 文本、audio start/end、audio URL、参考图、参考音、Visual Bible、H3 mode、服装锁、场景锁。
你只能加细表演与镜头微动作。
不要覆盖用户已填写的表演字段。
AudioTimeline 原样理解：谁在何时说什么，你不得改时间或说话人。
无对白时段不要写「全员双唇紧闭/蜡像」；应允许呼吸、吞咽、自然微动，只禁止说话口型。
character_id 必须来自输入的说话人表。`;

/** @deprecated 旧「导演增强 JSON」入口；提示词优化请用 buildDramaShotH3SkillOptimizeMessages */
export function buildDramaShotH3OptimizeMessages(
  session: DramaDirectorSession,
  shot: DramaShot,
  _guides?: { skillMd: string; guide: string },
): { systemPrompt: string; userPrompt: string } {
  const brief = buildDramaShotH3SourceBrief(session, shot);
  return {
    systemPrompt: ENHANCE_SYSTEM,
    userPrompt: `请为本镜输出导演增强 JSON（schema=drama-directing-enhance.v1）。shot_id=${shot.shot_id}\n\n${brief}`,
  };
}

const DRAMA_SKILL_EXTRA_RULES = [
  '短剧硬锁（英文四段标签 + 中文正文 + 画风色调生效）：',
  '- 只输出：retention_analysis / detailed_description / overall_soundscape / non_diegetic_music',
  '- 禁止输出：Keep Picture 1 colors…、Picture 1 is the first frame…、Negative: unrealistic color shift…、口型英文规则块、subject_definitions、summary',
  '- 参考与分镜：<Picture N>、[Shot N]、At 00:07.000；禁止 <主体N>/<图片N>/[镜头N]',
  '- retention_analysis 每行：<Picture N>：中文姓名性别年龄外貌服饰（或场景结构）',
  '- detailed_description 第一段必须写入 HARD LOOK/GRADE 铅字，不得改成别的画风/色调；然后写 [Shot N]',
  '- 参考图角色：有分镜图时分镜锁构图/画风/光色/场景，人物/道具/生物只锁身份；无分镜时场景锁空间结构，画风跟已锁定画风色调文字',
  '- 对白原样进 <d>[Chinese]…</d>；有动作先写动作再写对白',
  '- 【禁字幕】严禁烧录字幕/台词叠字/对话气泡/歌词条/水印/UI；对白只在 <d> 与音频，禁止把台词写成画面字',
  '- non_diegetic_music: N/A；文末追加：No burned-in subtitles, captions, dialogue bubbles, watermarks, or on-screen UI text.',
].join('\n');

/** 从时间轴/镜级动作抽出只读动作清单，供 Skill 优化硬锁 */
export function collectDramaShotActionLockLines(
  session: DramaDirectorSession,
  shot: DramaShot,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = String(raw || '')
      .replace(/【[^】]{1,24}】/g, '')
      .replace(/(?:空间与站位|上半身与手部|面部与眼神)[：:][^。\n]*/g, '')
      .replace(/看向\s*char-[\w-]+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t || t.length < 2) return;
    if (/^(?:站定|冷喝|喘气|震惊|冷笑|威严|坚定|愤怒)[。．.]?$/u.test(t)) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  push(String(shot.action || ''));
  for (const ev of shot.timeline_events || []) {
    push(String(ev.visual_action || ''));
  }
  void session;
  return out.slice(0, 24);
}

const ZH_PLAIN_OPTIMIZE_SYSTEM = `你是短剧分镜「中文白话提示词」润色助手。
只输出提示词正文，不要 markdown，不要解释，不要英文八段。

必须严格保持以下结构（顺序固定）：
1. 第一段：@图片N 是……（角色/背景××/道具），用逗号或顿号连接，以句号结尾
2. 第二段：风格色调：需要……。
3. 第三段标题行：剧情：
4. 其后为本镜剧本式正文（可含「内景 … - 日」、动作、对白、【特效】）

硬性禁止：
- 编造、删改、合并、调换对白原文
- 改动 @图片 序号与绑定对象（人/景/道具关系不得错位）
- 输出「主体定义」「详细描述」「subject_definitions」或英文 Ref2VA 八段
- 把「系统：」「【系统】」等标签写成要念出口的画面字；系统说话人写作「系统」换行后再写台词
- 写入「背影镜头/特写镜头」等脏机位词
- 写入景别/机位/运镜/规划（如「中景·平视·固定」「缓慢推入」）；机位运镜交给后续 H3 Skill

允许：润色动作与场面描写，使更清楚、仍像剧本白话；保留角色中文名。`;

/** 中文白话优化（产品中文路径）：源稿 → LLM 润色 → 写回 h3_skill_prompt（即上云终稿） */
export function buildDramaShotZhPlainOptimizeMessages(opts: {
  session: DramaDirectorSession;
  shot: DramaShot;
  sourcePrompt?: string;
}): { systemPrompt: string; userPrompt: string; sourcePrompt: string } {
  const sourcePrompt =
    String(opts.sourcePrompt || '').trim() ||
    composeDramaShotLensTaggedPrompt(opts.session, opts.shot);
  const brief = buildDramaShotH3SourceBrief(opts.session, opts.shot);
  return {
    systemPrompt: ZH_PLAIN_OPTIMIZE_SYSTEM,
    userPrompt: [
      '请润色下面的中文白话整镜提示词。只输出润色后的全文。',
      '',
      '【源提示词】',
      sourcePrompt,
      '',
      '【只读事实·禁止改对白/说话人/绑图】',
      brief,
    ].join('\n'),
    sourcePrompt,
  };
}

export function isDramaZhPlainOptimizedPrompt(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/subject_definitions\s*:/i.test(t) && /detailed_description\s*:/i.test(t)) {
    return false;
  }
  return (
    isDramaH3ProductionPrompt(t) &&
    /@图片\s*\d+\s*是/.test(t) &&
    /风格色调\s*[：:]/.test(t) &&
    /剧情\s*[：:]/.test(t)
  );
}

export function applyDramaShotZhPlainOptimizeResult(
  session: DramaDirectorSession,
  shot: DramaShot,
  rawLlmText: string,
  sourcePrompt: string,
): DramaShot {
  let optimized = String(rawLlmText || '')
    .replace(/^```(?:text|markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  // 若模型加了前缀说明，尽量截到 @图片 起
  const at = optimized.search(/@图片\s*\d+\s*是/);
  if (at > 0) optimized = optimized.slice(at).trim();
  if (!isDramaZhPlainOptimizedPrompt(optimized)) {
    // 源稿已是合格白话则回退源稿，避免整次失败
    if (isDramaZhPlainOptimizedPrompt(sourcePrompt)) {
      optimized = sourcePrompt;
    } else {
      const fallback = composeDramaShotLensTaggedPrompt(session, shot);
      if (!isDramaZhPlainOptimizedPrompt(fallback)) {
        throw new Error('中文优化稿格式不符合 @图片 / 风格色调 / 剧情，请换模型重试');
      }
      optimized = fallback;
    }
  }
  return {
    ...shot,
    last_compiled_prompt: sourcePrompt,
    h3_skill_prompt: optimized,
    h3_skill_prompt_from: sourcePrompt,
  };
}

/** 无 LLM：直接把中文白话 Compiler 写入优化槽（Skill 失败回退） */
export function applyDramaShotZhPlainOfficialSeal(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaShot {
  const compiled = composeDramaShotLensTaggedPrompt(session, shot);
  return {
    ...shot,
    last_compiled_prompt: compiled,
    h3_skill_prompt: compiled,
    h3_skill_prompt_from: compiled,
  };
}

export function buildDramaShotH3SkillOptimizeMessages(opts: {
  session: DramaDirectorSession;
  shot: DramaShot;
  skillMd: string;
  guideText: string;
  sourcePrompt?: string;
  videoModel?: string;
}): {
  systemPrompt: string;
  userPrompt: string;
  sourcePrompt: string;
  structure: MinimaxH3OptimizeStructure;
  imageCount: number;
  hasRefAudio: boolean;
} {
  const { session, shot } = opts;
  const videoModel = String(
    opts.videoModel ||
      resolveDramaShotVideoModel(shot.model_params, session.meta.videoBatchModel, {
        hasDialogue: dramaShotHasSpokenDialogue(shot),
        hasShotAudio: !!String(shot.audio_url || '').trim(),
      }),
  ).trim();
  const structure = resolveMinimaxH3OptimizeStructure(videoModel || 'minimax-h3-multi');
  // 短剧：以中文整镜编译稿为源，Skill 输出中文六段
  const sourcePrompt =
    String(opts.sourcePrompt || '').trim() || composeDramaShotLensTaggedPrompt(session, shot);
  const imageCount = listDramaShotRefImageSlots(session, shot).length;
  const hasRefAudio =
    listDramaShotRefAudioSlots(session, shot).length > 0 || shotHasRefAudio(session, shot);
  const actionLock = collectDramaShotActionLockLines(session, shot);
  const style = resolveDramaShotVisualStylePrompt(session, shot);
  const lookGrade =
    String(style.body || '').trim() ||
    String(style.name || '').trim() ||
    '按已锁定画风色调';
  const useSb = listDramaShotRefImageSlots(session, shot).some((s) => s.role === 'storyboard');
  const extraRules = [
    DRAMA_SKILL_EXTRA_RULES,
    useSb
      ? [
          `HARD LOOK/GRADE（写入 detailed_description 第一段）：${lookGrade}`,
          '本镜启用分镜参考图：<Picture 1> 为分镜时，构图/画风/光色/场景以分镜图为准；人物/道具/生物参考图只锁身份。冲突时服从分镜图。',
          'HARD FRAMING（分镜出片）：开场景别必须与分镜主画面一致；禁止从更远全景/建立镜头缓慢拉近或推进；禁止把多格分镜页当建立镜头再逐格扫入；运镜仅按正文明确写出的走，默认固定/微晃。',
          'retention_analysis 须按当前参考图顺序写：分镜 → 人物 → 道具 → 生物（无场景卡）。',
        ].join('\n')
      : [
          `HARD LOOK/GRADE（写入 detailed_description 第一段，禁止改写为其它画风/色调）：${lookGrade}`,
          '本镜未启用分镜参考图：参考图只锁身份与场景结构，成片画风色调以已锁定画风色调文字为准。',
          'retention_analysis 须按当前参考图顺序写：场景 → 人物 → 道具 → 生物。',
        ].join('\n'),
    actionLock.length
      ? [
          'HARD ACTION LOCK（必须作为可见肢体动作写进详细描述，不能只剩对白）：',
          ...actionLock.map((l, i) => `${i + 1}. ${l}`),
        ].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  const { systemPrompt, userPrompt } = buildMinimaxH3OptimizeMessages({
    structure,
    skillMd: opts.skillMd,
    guideText: opts.guideText,
    prompt: sourcePrompt,
    imageCount,
    hasRefAudio,
    durationSec: Number(shot.duration_sec) || undefined,
    baseSubMode: resolveMinimaxH3BaseSubMode(videoModel || 'minimax-h3-multi', imageCount),
    modelId: videoModel || 'minimax-h3-multi',
    extraRules,
    outputLanguage: 'zh',
  });
  return { systemPrompt, userPrompt, sourcePrompt, structure, imageCount, hasRefAudio };
}

/** 解析 Skill 返回并写回 shot.h3_skill_prompt（短剧默认中文六段） */
export function applyDramaShotH3SkillOptimizeResult(
  session: DramaDirectorSession,
  shot: DramaShot,
  rawLlmText: string,
  sourcePrompt: string,
  structure: MinimaxH3OptimizeStructure = 'ref',
): DramaShot {
  let optimized = String(
    parseMinimaxH3OptimizedPrompt(rawLlmText, structure, sourcePrompt) || '',
  ).trim();
  if (!isAcceptableMinimaxH3OptimizedPrompt(optimized)) {
    const alt: MinimaxH3OptimizeStructure = structure === 'ref' ? 'base' : 'ref';
    optimized = String(
      parseMinimaxH3OptimizedPrompt(rawLlmText, alt, sourcePrompt) || '',
    ).trim();
  }
  optimized = recoverMinimaxH3OptimizedPrompt(optimized);
  if (
    !isAcceptableMinimaxH3OptimizedPrompt(optimized) &&
    !isDramaH3AntiCrosstalkPrompt(optimized)
  ) {
    throw new Error('Skill 返回格式不符合 MiniMax H3 Ref2VA，请换模型重试');
  }
  const styleForSeal = resolveDramaShotVisualStylePrompt(session, shot);
  optimized = sealDramaProductionCloudPrompt(optimized, {
    hasDialogue: dramaShotHasSpokenDialogue(shot),
    preserveChinese: true,
    storyboardPicIndex:
      listDramaShotRefImageSlots(session, shot).find((s) => s.role === 'storyboard')?.index ??
      null,
    styleHint: [
      styleForSeal.body,
      styleForSeal.name,
      session.bible?.project?.visual_style,
      session.bible?.project?.color_style,
      optimized,
    ]
      .filter(Boolean)
      .join(' '),
    session,
    shot,
  });
  optimized = isMinimaxH3ChineseSkillPrompt(optimized)
    ? sanitizeDramaChineseH3SkillPrompt(optimized)
    : sanitizeDramaEnglishH3SkillPrompt(optimized);
  if (
    !isDramaH3AntiCrosstalkPrompt(optimized) &&
    !isAcceptableMinimaxH3OptimizedPrompt(optimized)
  ) {
    throw new Error('Skill 优化稿校验失败');
  }
  return {
    ...shot,
    last_compiled_prompt: sourcePrompt,
    h3_skill_prompt: optimized,
    h3_skill_prompt_from: sourcePrompt,
  };
}
