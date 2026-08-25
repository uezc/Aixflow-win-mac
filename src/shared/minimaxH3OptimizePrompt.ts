/**
 * MiniMax-H3「一键优化提示词」：按 skill 选 base / ref 结构，组装 LLM messages 并解析结果。
 */

import {
  stripDirectorPromptInventedLook,
  directorMvPromptNeedsLookRelock,
  DIRECTOR_PIC1_COLOR_FRONT,
  DIRECTOR_PIC1_VISUAL_ANCHOR,
  DIRECTOR_PIC1_LOOK_NEGATIVE_LINE,
} from './directorPipeline/bindAssetRefs.js';

export type MinimaxH3OptimizeStructure = 'base' | 'ref';

/** 基础模式子类型（对齐 SKILL.md / base-en.txt） */
export type MinimaxH3BaseSubMode = 'T2VA' | 'I2VA' | 'FL2VA' | 'L2VA';

export function isMinimaxH3VideoModel(model: string): boolean {
  const m = String(model || '').trim();
  return (
    m === 'minimax-h3-t2v' ||
    m === 'minimax-h3-i2v' ||
    m === 'minimax-h3-multi' ||
    m === 'minimax-h3-audio'
  );
}

/** 多参 / 口型同步 → Full-Reference 六段；文生 / 图生 → base 三段 */
export function resolveMinimaxH3OptimizeStructure(model: string): MinimaxH3OptimizeStructure {
  const m = String(model || '').trim();
  if (m === 'minimax-h3-multi' || m === 'minimax-h3-audio') return 'ref';
  return 'base';
}

export function resolveMinimaxH3BaseSubMode(
  model: string,
  imageCount: number,
): MinimaxH3BaseSubMode {
  const m = String(model || '').trim();
  const n = Math.max(0, Math.floor(Number(imageCount) || 0));
  if (m === 'minimax-h3-i2v' || (m === 'minimax-h3-t2v' && n >= 1)) return 'I2VA';
  return 'T2VA';
}

export type BuildMinimaxH3OptimizeMessagesInput = {
  structure: MinimaxH3OptimizeStructure;
  /** SKILL.md 正文 */
  skillMd: string;
  /** base-en.txt 或 ref-en.txt */
  guideText: string;
  prompt: string;
  imageCount: number;
  hasRefAudio: boolean;
  /** 目标时长（秒），写入 user 上下文 */
  durationSec?: number;
  baseSubMode?: MinimaxH3BaseSubMode;
  modelId?: string;
  /** 导演台：第1张分镜 / 第2张起角色，写入优化约束 */
  refMapHint?: string;
  /** 本镜地点+画面描述，约束出场物须符合故事场景 */
  sceneStoryHint?: string;
  /** 额外硬规则（短剧无对白 / 保留 <d> 等） */
  extraRules?: string;
};

const OUTPUT_RULES_BASE = `Output rules:
1. Absolute pure output: ONLY the final H3 prompt body. No greetings, explanations, markdown fences, or notes.
2. Follow the selected guide's field names, section order, labels, and timing notation exactly.
3. Labels must be EXACT English snake_case only: subject_definitions: / summary: / retention_analysis: / detailed_description: / overall_soundscape: / non_diegetic_music:. NEVER use Chinese section titles (主体定义 / 概述 / 内容保留分析 / 详细描述 / 整体声景 / 非剧情配乐). Outside <d>…</d>, write English ONLY — MiniMax H3 will speak any Chinese director notes as dialogue. Preserve spoken lines ONLY inside <d>[Chinese] … </d> in their ORIGINAL language.
4. Do not invent major new plot, characters, or a different location/set. Objects on screen must match the source scene.
5. Timing must match the requested duration when provided.
6. In integrated_multimodal_description / detailed_description: camera motion, rhythm, visible objects, and sound ONLY — no mood, lighting, color naming, or atmosphere words.
7. CRITICAL: Zero Chinese characters outside <d> tags. Reference tags like <图片1>/<主体1>/<音频1> may stay; all other prose must be English.`;

const OPTIMIZER_ROLE = `You are a video generation prompt optimization assistant for MiniMax H3. Produce stable, executable H3 prompts from reference images and shot requirements.

Core principles (highest priority):
1. Reference image visual atmosphere, color tone, lighting direction, material, and rendering style are TOP priority.
2. Do NOT hardcode specific colors (no purple, warm, cool, golden, etc.) — Picture 1 drives grading.
3. Only describe features visible in the reference image; do not add atmosphere words not in Picture 1.
4. For ruins/architecture/scene frames: do not change style, color grade, time-of-day feel, or materials.
5. All camera moves, FPV passes, cuts, and spatial extensions stay in Picture 1's visual space — no regrade.
6. Do not generate elements absent from references (people/faces/silhouues/statues for empty shots; no off-story props).
7. Do not use strong color atmosphere phrases (purple dusk, golden sunlight, warm orange daylight, cold blue mood, etc.).
8. No on-screen text/subtitles/UI unless explicitly requested.`;

const PIC1_FIRST_FRAME_LOCK = `If any reference image is connected: Picture 1 is the first frame at 0.00s and the look source. Camera MAY change. Keep Picture 1's colors and rendering exactly as they appear in the image — do not regrade, do not restyle into 3D CGI, do not write lighting or time of day, do not invent a different sky. Do not describe style or color names in words. ALLOWLIST: objects already in Picture 1 or in the Story scene block. If Picture 2+ exists, never write a character as "as seen in Picture 1"; identity is Picture 2+ only. If the source says 「无参考图」 or 「按文字描述生成」 but images are connected, ignore those sentences.`;

const VISUAL_ANCHOR_COPY_RULE = `After the Picture 1 / <图片1> visual-anchor definition line, copy these three English lines VERBATIM in order (do not paraphrase, do not translate to Chinese):
${DIRECTOR_PIC1_COLOR_FRONT}
${DIRECTOR_PIC1_VISUAL_ANCHOR}
${DIRECTOR_PIC1_LOOK_NEGATIVE_LINE}`;

export function buildMinimaxH3OptimizeMessages(
  input: BuildMinimaxH3OptimizeMessagesInput,
): { systemPrompt: string; userPrompt: string } {
  const structure = input.structure;
  const skillMd = String(input.skillMd || '').trim();
  const guideText = String(input.guideText || '').trim();
  const prompt = String(input.prompt || '').trim();
  const imageCount = Math.max(0, Math.floor(Number(input.imageCount) || 0));
  const hasRefAudio = !!input.hasRefAudio;
  const durationSec =
    input.durationSec != null && Number.isFinite(Number(input.durationSec))
      ? Number(input.durationSec)
      : undefined;
  const baseSubMode = input.baseSubMode || 'T2VA';
  const modelId = String(input.modelId || '').trim();

  const systemPrompt = [
    '# Role',
    OPTIMIZER_ROLE,
    '',
    '# Skill Workflow (from h3-prompt-writing/SKILL.md)',
    skillMd || '(skill missing)',
    '',
    '# Format Guide',
    guideText || '(guide missing)',
    '',
    OUTPUT_RULES_BASE,
    structure === 'base'
      ? `8. For base modes, output must include integrated_multimodal_description, overall_soundscape, and non_diegetic_music in that order. Use mode ${baseSubMode} alignment rules from the guide.`
      : '8. For full-reference mode, output must start with subject_definitions: and include summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music in that order.',
    imageCount >= 1 ? `9. ${PIC1_FIRST_FRAME_LOCK}` : '',
    imageCount >= 1 ? `10. ${VISUAL_ANCHOR_COPY_RULE}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const ctxLines: string[] = [
    `Product model id: ${modelId || '(unspecified)'}`,
    `Rewrite structure: ${structure === 'ref' ? 'Full-Reference (Ref2VA / six sections)' : `Base (${baseSubMode} / three core fields)`}`,
    `Connected reference images: ${imageCount}`,
    `Reference audio connected: ${hasRefAudio ? 'yes' : 'no'}`,
  ];
  if (durationSec != null) ctxLines.push(`Target duration (seconds): ${durationSec}`);
  if (imageCount >= 1) {
    ctxLines.push(VISUAL_ANCHOR_COPY_RULE);
  }
  if (String(input.sceneStoryHint || '').trim()) {
    ctxLines.push(
      'Story scene (visible objects/architecture must match this; do not invent a different set):',
    );
    ctxLines.push(String(input.sceneStoryHint).trim());
    if (/空镜|无人物/.test(String(input.sceneStoryHint))) {
      ctxLines.push(
        'EMPTY SHOT: Output MUST start with 参考图对照 and <图片1>. Copy the Visual Anchor block verbatim after 图片1. Put people bans AFTER the anchor — never before 参考图对照. Do NOT write 空旷环境 or atmosphere/grade words. Do NOT insert Empty frame inside (from [Shot N]).',
      );
      ctxLines.push(
        'People bans after anchor: 严禁出现任何人、人脸、人形、人物剪影、人形雕像，无人类痕迹。No people, no faces, no silhouettes, no statues, no human-like shadows.',
      );
      ctxLines.push(
        '不要出现：人，人类，人物，人脸，剪影，人形，人影，雕像，石像，尸体，流浪者，幸存者，游客。',
      );
      ctxLines.push(
        'First-frame sentence: For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced. Never write Empty frame inside those parentheses.',
      );
      ctxLines.push(
        'Repeat Empty frame only after each [Shot N] in integrated_multimodal_description — not inside from [Shot N].',
      );
    }
  }

  if (String(input.refMapHint || '').trim()) {
    ctxLines.push('Director MV image order (mandatory, do not collapse to one image):');
    ctxLines.push(String(input.refMapHint).trim());
    ctxLines.push(
      'Picture 1 = look anchor (composition, scene, colors, rendering). Picture 2+ = face/hair/costume only. Camera may change. Do not name colors. Do not write lighting or time of day. Objects only from Story scene or Picture 1.',
    );
    ctxLines.push('Keep an @图片N footer line for every connected image in this exact order.');
  }
  if (imageCount >= 1) {
    ctxLines.push(PIC1_FIRST_FRAME_LOCK);
  }
  if (structure === 'base' && baseSubMode === 'I2VA' && imageCount === 1 && !input.refMapHint) {
    ctxLines.push(
      'Keyframe note: Treat <Picture 1> as the first frame at 0.00s of Shot 1 (I2VA).',
    );
  } else if (structure === 'base' && imageCount > 1) {
    ctxLines.push(
      'This is multi-reference, not single-keyframe I2VA. Do not lock face/costume to <Picture 1>.',
    );
  }
  if (structure === 'ref') {
    if (imageCount > 0) {
      ctxLines.push(
        `Map connected images in order as <Picture 1>..<Picture ${imageCount}> (and/or <Subject N> per guide).`,
      );
    }
    if (hasRefAudio) {
      ctxLines.push(
        'Map the connected reference audio as <Audio 1> with an appropriate copy/reference role from the guide.',
      );
    }
  }
  if (String(input.extraRules || '').trim()) {
    ctxLines.push(String(input.extraRules).trim());
  }

  const userPrompt = [
    '## Context',
    ...ctxLines.map((l) => `- ${l}`),
    '',
    '## Current user prompt (rewrite this; keep dialogue/lyrics/on-screen text language)',
    prompt,
    '',
    structure === 'ref'
      ? 'Rewrite into the Full-Reference six-section prompt. Output must start with subject_definitions: and end with non_diegetic_music:. English ONLY outside <d> tags. No Chinese section titles. No markdown fences.'
      : `Rewrite into the Base-mode final prompt for ${baseSubMode}. English ONLY outside <d> tags. Include alignment instruction line, then integrated_multimodal_description / overall_soundscape / non_diegetic_music. No markdown fences.`,
    'Object allowlist: only Picture 1 and the Story scene block. Camera through that location. Do not add props that are not in those sources.',
    'Copy the Visual Anchor block verbatim after <图片1>. Do not regrade. Do not restyle into 3D CGI. Do not write lighting, time of day, mood, or color names in shot descriptions.',
    '',
    structure === 'ref'
      ? [
          '## Required labels (copy these English lines exactly, then fill content in English; spoken lines only inside <d>)',
          'subject_definitions:',
          'summary:',
          'retention_analysis:',
          'detailed_description:',
          'overall_soundscape:',
          'non_diegetic_music:',
        ].join('\n')
      : [
          '## Required labels (copy these lines exactly, then fill content)',
          'integrated_multimodal_description:',
          'overall_soundscape:',
          'non_diegetic_music:',
        ].join('\n'),
  ].join('\n');

  return { systemPrompt, userPrompt };
}

function stripFences(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  const fenced = s.match(/^```(?:[\w-]*)?\s*([\s\S]*?)```\s*$/);
  if (fenced) s = fenced[1].trim();
  else {
    s = s.replace(/^```(?:[\w-]*)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  return s;
}

function trimAfterMusicSection(s: string): string {
  const musicIdx = s.search(/non_diegetic_music\s*:|非剧情配乐\s*[：:]/i);
  if (musicIdx < 0) return s.trim();
  const after = s.slice(musicIdx);
  const nextSection = after.search(/\n(?:#{1,3}\s|\*{1,2}|Note:|说明[:：])/i);
  if (nextSection > 0) {
    return s.slice(0, musicIdx + nextSection).trim();
  }
  return s.trim();
}

function matchH3HeadingCanon(body: string): string | null {
  const b = String(body || '').trim();
  if (!b || b.length > 48) return null;
  if (/^subject[_\s-]*definitions?$/i.test(b) || /^(主体定义|角色定义)$/.test(b)) {
    return /[\u4e00-\u9fff]/.test(b) ? '主体定义：' : 'subject_definitions:';
  }
  if (/^summary$|^overview$/i.test(b) || /^(概述|摘要)$/.test(b)) {
    return /[\u4e00-\u9fff]/.test(b) ? '概述：' : 'summary:';
  }
  if (/^retention[_\s-]*analysis$|^content[_\s-]*retention$/i.test(b) || /^(内容保留分析|保留分析)$/.test(b)) {
    return /[\u4e00-\u9fff]/.test(b) ? '内容保留分析：' : 'retention_analysis:';
  }
  if (/^integrated[_\s-]*multimodal[_\s-]*description$/i.test(b)) {
    return 'integrated_multimodal_description:';
  }
  if (/^detailed[_\s-]*description$/i.test(b) || /^详细描述$/.test(b)) {
    return /[\u4e00-\u9fff]/.test(b) ? '详细描述：' : 'detailed_description:';
  }
  if (
    /^overall[_\s-]*soundscape$|^soundscape$|^background$|^ambience$|^ambient(?:\s+sound)?$/i.test(b) ||
    /^(整体声景|声景|背景|背景音|环境音|音效)$/.test(b)
  ) {
    return /[\u4e00-\u9fff]/.test(b) ? '整体声景：' : 'overall_soundscape:';
  }
  if (
    /^non[_\s-]*diegetic[_\s-]*music$|^background\s*music$|^bgm$/i.test(b) ||
    /^(非剧情配乐|背景音乐|配乐)$/.test(b)
  ) {
    return /[\u4e00-\u9fff]/.test(b) || /^bgm$/i.test(b) ? '非剧情配乐：' : 'non_diegetic_music:';
  }
  return null;
}

/** 把模型常用的 Markdown / 背景 / Title Case 标题收成 H3 段名 */
function canonicalizeMinimaxH3SectionLabels(text: string): string {
  let t = String(text || '');
  const prefixFixes: Array<[RegExp, string]> = [
    [/(^|\n)\s*(?:#{1,6}\s*)?subject\s+definitions?\s*[:：]/gi, '$1subject_definitions:'],
    [/(^|\n)\s*(?:#{1,6}\s*)?retention\s+analysis\s*[:：]/gi, '$1retention_analysis:'],
    [
      /(^|\n)\s*(?:#{1,6}\s*)?integrated\s+multimodal\s+description\s*[:：]/gi,
      '$1integrated_multimodal_description:',
    ],
    [/(^|\n)\s*(?:#{1,6}\s*)?detailed\s+description\s*[:：]/gi, '$1detailed_description:'],
    [/(^|\n)\s*(?:#{1,6}\s*)?overall\s+soundscape\s*[:：]/gi, '$1overall_soundscape:'],
    [/(^|\n)\s*(?:#{1,6}\s*)?non[-\s]*diegetic\s+music\s*[:：]/gi, '$1non_diegetic_music:'],
    [/(^|\n)\s*(?:#{1,6}\s*)?background(?:\s*sound)?\s*[:：](?!\s*music)/gi, '$1overall_soundscape:'],
    [/(^|\n)\s*(?:#{1,6}\s*)?background\s*music\s*[:：]/gi, '$1non_diegetic_music:'],
    [/(^|\n)\s*(?:#{1,6}\s*)?角色定义\s*[:：]/g, '$1主体定义：'],
    [/(^|\n)\s*(?:#{1,6}\s*)?(?:整体)?声景\s*[:：]/g, '$1整体声景：'],
    [/(^|\n)\s*(?:#{1,6}\s*)?(?:背景音|环境音|音效)\s*[:：]/g, '$1整体声景：'],
    [/(^|\n)\s*(?:#{1,6}\s*)?背景\s*[:：]/g, '$1整体声景：'],
    [/(^|\n)\s*(?:#{1,6}\s*)?(?:背景音乐|配乐|BGM)\s*[:：]/gi, '$1非剧情配乐：'],
    [/(^|\n)\s*【主体定义】/g, '$1主体定义：'],
    [/(^|\n)\s*【概述】/g, '$1概述：'],
    [/(^|\n)\s*【内容保留分析】/g, '$1内容保留分析：'],
    [/(^|\n)\s*【详细描述】/g, '$1详细描述：'],
    [/(^|\n)\s*【整体声景】/g, '$1整体声景：'],
    [/(^|\n)\s*【负向约束】/g, '$1非剧情配乐：'],
  ];
  for (const [re, rep] of prefixFixes) t = t.replace(re, rep);

  t = t
    .split('\n')
    .map((line) => {
      const stripped = line
        .replace(/^\s*(?:#{1,6}\s*|\d+[.、]\s*|[一二三四五六][.、]\s*|(?:\*{1,2}|_){1,2}\s*)/, '')
        .replace(/\s*(?:\*{1,2}|_){1,2}\s*$/, '')
        .trim()
        .replace(/\s*[:：]\s*$/, '');
      const canon = matchH3HeadingCanon(stripped);
      return canon || line;
    })
    .join('\n');
  return t;
}

function looksZhH3(s: string): boolean {
  return /主体定义|详细描述|整体声景|非剧情配乐|参考图对照/.test(s);
}

function hasMinimaxH3VisualBody(s: string): boolean {
  return (
    /主体定义\s*[：:]/.test(s) ||
    /subject[_\s-]*definitions\s*:/i.test(s) ||
    /详细描述\s*[：:]/.test(s) ||
    /detailed[_\s-]*description\s*:/i.test(s) ||
    /integrated[_\s-]*multimodal[_\s-]*description\s*:/i.test(s)
  );
}

/** 有画面段但缺声景/配乐时补默认尾段，避免整镜优化被丢掉 */
function ensureMinimaxH3SoundTail(text: string): string {
  let t = String(text || '').trim();
  if (!t || !hasMinimaxH3VisualBody(t)) return t;
  const zh = looksZhH3(t);
  if (
    !/overall[_\s-]*soundscape\s*:/i.test(t) &&
    !/整体声景\s*[：:]/.test(t)
  ) {
    t += zh ? '\n\n整体声景：\n环境底噪与动作音。' : '\n\noverall_soundscape:\nAmbient and physical sound only.';
  }
  if (
    !/non[_\s-]*diegetic[_\s-]*music\s*:/i.test(t) &&
    !/非剧情配乐\s*[：:]/.test(t)
  ) {
    t += zh ? '\n\n非剧情配乐：\n无。' : '\n\nnon_diegetic_music:\nN/A';
  }
  return t.trim();
}

function hasSalvageableH3Body(s: string): boolean {
  if (String(s || '').trim().length < 80) return false;
  return /<图片|Picture\s*\d+|\[Shot|\[镜头|00:\d{2}|参考图对照|Keep Picture 1|主体定义|详细描述/i.test(
    s,
  );
}

function wrapProseAsZhH3(s: string): string {
  const body = String(s || '').trim();
  if (/主体定义\s*[：:]/.test(body) && /详细描述\s*[：:]/.test(body)) {
    return ensureMinimaxH3SoundTail(body);
  }
  if (/主体定义\s*[：:]/.test(body)) {
    return ensureMinimaxH3SoundTail(
      `${body}\n\n详细描述：\n按参考图对照与分镜图运镜，时长内连续动作。`,
    );
  }
  return [
    '主体定义：',
    '按参考图对照。',
    '',
    '详细描述：',
    body,
    '',
    '整体声景：',
    '环境底噪与动作音。',
    '',
    '非剧情配乐：',
    '无。',
  ].join('\n');
}

export function recoverMinimaxH3OptimizedPrompt(text: string): string {
  let t = canonicalizeMinimaxH3SectionLabels(String(text || ''));
  t = ensureMinimaxH3SoundTail(t);
  if (isAcceptableMinimaxH3OptimizedPrompt(t)) return t;
  if (hasSalvageableH3Body(t)) return wrapProseAsZhH3(t);
  return t;
}

/** 解析模型返回：base 三段或 ref 六段（英/中） */
export function parseMinimaxH3OptimizedPrompt(
  text: unknown,
  structure: MinimaxH3OptimizeStructure,
  sourcePrompt?: string,
): string {
  let s = stripFences(typeof text === 'string' ? text : text == null ? '' : String(text));
  if (!s) return '';
  s = canonicalizeMinimaxH3SectionLabels(s);

  if (structure === 'ref') {
    const startIdx = s.search(/subject_definitions\s*:|主体定义\s*[：:]/i);
    if (startIdx >= 0) s = s.slice(startIdx).trim();
  } else {
    const startCandidates = [
      s.search(/参考图对照[：:]/),
      s.search(/<图片\s*1>/),
      s.search(/Keep Picture 1 colors/i),
      s.search(/以第1张分镜图为首帧/i),
      s.search(/For the target video,/i),
      s.search(/How the reference pictures align/i),
      s.search(/integrated[_\s-]*multimodal[_\s-]*description\s*:/i),
      s.search(/主体定义\s*[：:]/),
    ].filter((i) => i >= 0);
    if (startCandidates.length > 0) {
      s = s.slice(Math.min(...startCandidates)).trim();
    }
  }
  s = stripDirectorPromptInventedLook(trimAfterMusicSection(s), sourcePrompt);
  return recoverMinimaxH3OptimizedPrompt(s);
}

/** 英文 base 三段 */
function hasMinimaxH3EnBaseSections(s: string): boolean {
  return (
    /integrated[_\s-]*multimodal[_\s-]*description\s*:/i.test(s) &&
    /overall[_\s-]*soundscape\s*:/i.test(s) &&
    /non[_\s-]*diegetic[_\s-]*music\s*:/i.test(s)
  );
}

/** 英文 ref 六段（至少主体/详述/配乐） */
function hasMinimaxH3EnRefSections(s: string): boolean {
  return (
    /subject[_\s-]*definitions\s*:/i.test(s) &&
    /detailed[_\s-]*description\s*:/i.test(s) &&
    (/non[_\s-]*diegetic[_\s-]*music\s*:/i.test(s) || /overall[_\s-]*soundscape\s*:/i.test(s))
  );
}

/** 中文六段（导演台常用；模型常把「整体声景」写成「背景」） */
function hasMinimaxH3ZhSections(s: string): boolean {
  return (
    /主体定义\s*[：:]/.test(s) &&
    /详细描述\s*[：:]/.test(s) &&
    (/非剧情配乐\s*[：:]/.test(s) ||
      /整体声景\s*[：:]/.test(s) ||
      /(?:^|\n)\s*背景\s*[：:]/.test(s) ||
      /(?:^|\n)\s*声景\s*[：:]/.test(s))
  );
}

export function isValidMinimaxH3OptimizedPrompt(
  text: string,
  structure: MinimaxH3OptimizeStructure,
): boolean {
  const s = String(text || '').trim();
  if (!s) return false;
  if (structure === 'ref') {
    return hasMinimaxH3EnRefSections(s) || hasMinimaxH3ZhSections(s);
  }
  return hasMinimaxH3EnBaseSections(s) || hasMinimaxH3ZhSections(s);
}

/**
 * 模型常在 multi/口型（期望 ref）时仍输出 base；也常回中文六段或中英混用。
 * 英 base / 英 ref / 中文六段 / 中英混用 任一合格即视为可用。
 */
export function isAcceptableMinimaxH3OptimizedPrompt(text: string): boolean {
  const s = String(text || '').trim();
  if (!s) return false;
  if (
    hasMinimaxH3EnBaseSections(s) ||
    hasMinimaxH3EnRefSections(s) ||
    hasMinimaxH3ZhSections(s)
  ) {
    return true;
  }
  const hasSubject = /主体定义\s*[：:]/.test(s) || /subject[_\s-]*definitions\s*:/i.test(s);
  const hasDetail =
    /详细描述\s*[：:]/.test(s) ||
    /detailed[_\s-]*description\s*:/i.test(s) ||
    /integrated[_\s-]*multimodal[_\s-]*description\s*:/i.test(s);
  const hasSound =
    /整体声景\s*[：:]/.test(s) ||
    /非剧情配乐\s*[：:]/.test(s) ||
    /overall[_\s-]*soundscape\s*:/i.test(s) ||
    /non[_\s-]*diegetic[_\s-]*music\s*:/i.test(s) ||
    /(?:^|\n)\s*背景\s*[：:]/.test(s);
  return hasSubject && hasDetail && hasSound;
}

/** 优化稿已含视觉锚点 + H3 结构 + 无脏句 → 跳过 LLM 重写 */
export function isDirectorMvPromptLookReady(
  prompt: string,
  _structure: MinimaxH3OptimizeStructure,
): boolean {
  const t = String(prompt || '');
  // 不强制与当前视频模型 structure 一致：LLM/历史稿可能是 base 或 ref
  if (!isAcceptableMinimaxH3OptimizedPrompt(t)) return false;
  if (directorMvPromptNeedsLookRelock(t)) return false;
  if (!/严格继承参考图中可见|Only describe what is visible in Picture 1/i.test(t)) return false;
  if (!/unrealistic color shift|style drift/i.test(t)) return false;
  return true;
}
