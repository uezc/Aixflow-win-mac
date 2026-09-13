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
import { standardizeMinimaxH3VideoPrompt } from './minimaxH3StandardizePrompt.js';
import {
  looksLikeDramaSystemSpokenText,
  stripDramaSystemSpokenLabel,
} from './directorDomain/extractCastFromScript.js';

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
  /**
   * 终稿语言。短剧用 zh：段名与正文中文；台词仍进 <d>[Chinese]。
   * 画布默认 en（官方英文段名）。
   */
  outputLanguage?: 'zh' | 'en';
};

const H3_D_TAG_RE = /<d>\s*\[Chinese[^\]]*\]\s*([^<]*?)\s*<\/d>/gi;
const H3_SPEECH_QUOTE_RE = /(?:开口|说|道|喊|对白)?[：:]\s*「([^」]{1,160})」/g;
const H3_BARE_QUOTE_RE = /「([^」]{1,160})」/g;

const H3_STANDARDIZE_RULES = `MINIMAX-H3 STANDARDIZE (mandatory, do not skip):
1. Delete ALL vocal-suppression: without dialogue or vocals; closed mouth / keep mouth closed / mouth still closed; silent performance / silent yawn / swallowing silently / silent closed-mouth breaths; "No dialogue, narration, singing, or vocal sound occurs"; "Jiang Che does not speak"; "No voices are audible"; "No one speaks"; "No voices, narration, or music are present"; "No dialogue or narration"; nonverbal-only Audio mapping / "no vocal or music signal is copied".
2. KEEP the spoken-channel rule: Spoken lines use only <d>[Chinese] … </d>; on-screen text uses English double quotes only when it must appear in frame. KEEP Picture-1 "Do not speak this line". Those do NOT forbid character vocals.
3. Timestamps must stay on one line: write At 00:03.600 not At 00:03. then a newline then 600.
4. After subject_definitions, append these four lines:
When a visible character Subject speaks that character's own <d> lines, generate accurate lip-sync matching that spoken dialogue. Do not lip-sync system-voice or narrator <d> lines onto any visible face.
Maintain correct human anatomy, avoid distorted hands, malformed fingers, extra fingers, twisted limbs.
No unwanted camera shake, no random camera jitter.
Character vocal lines run on dedicated vocal-audio track; environmental sounds occupy background track.
5. Prefix every hard-cut / cut-to sentence with [cut].
6. Append to Negative: deformed hands, extra fingers, distorted facial features, unwanted camera shake.
7. Do not invent dialogue. If the source has 「」 or <d>, wrap every spoken line in <d>[Chinese] … </d>. If there is no spoken line, do not write "No one speaks".
8. ANTI-CROSSTALK: Every <d> line MUST be preceded by its speaker on its own paragraph in official form: "<Subject N> (Sx), using the voice timbre referenced from <Audio N> says: <d>[Chinese] … </d>". Never omit the speaker. Never join two speakers with a comma in one sentence. Action stays outside <d>. After [Shot N], if the shot starts with speech, write the speaker first. Different characters MUST use different <Audio N> timbres.`;

function uniqSpokenLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const t = String(raw || '').trim();
    if (!t || t.length < 1 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function splitSpokenChunks(raw: string): string[] {
  const t = String(raw || '')
    .replace(/【炸弹字幕[:：][^】]*】/g, '')
    .replace(/^[,，;；\s]+|[,，;；\s]+$/g, '')
    .trim();
  if (!t) return [];
  if (/无参考图|按文字描述生成/.test(t) && t.length < 24) return [];
  if (!t.includes('/')) return [t];
  return t
    .split(/\s*\/\s*/)
    .map((s) => s.replace(/^[,，;；\s]+|[,，;；\s]+$/g, '').trim())
    .filter(Boolean);
}

/** 从中文紧凑稿 / 八段稿 / 已有 <d> / 裸「」抽出要说出口的原句 */
export function extractSpokenLinesForH3Skill(source: string): string[] {
  const src = String(source || '')
    .replace(/弹幕[^「\n]{0,16}「[^」]*」/g, '')
    .replace(/呼喊「[^」]*」/g, '');
  const found: string[] = [];
  for (const m of src.matchAll(new RegExp(H3_D_TAG_RE.source, 'gi'))) {
    found.push(...splitSpokenChunks(String(m[1] || '')));
  }
  for (const m of src.matchAll(new RegExp(H3_SPEECH_QUOTE_RE.source, 'g'))) {
    found.push(...splitSpokenChunks(String(m[1] || '')));
  }
  for (const m of src.matchAll(new RegExp(H3_BARE_QUOTE_RE.source, 'g'))) {
    found.push(...splitSpokenChunks(String(m[1] || '')));
  }
  for (const m of src.matchAll(/^>\s*(.+)$/gm)) {
    found.push(...splitSpokenChunks(String(m[1] || '')));
  }
  return uniqSpokenLines(found);
}

/** 分镜对白列 + 切段对白 + 「」 + 额外中文稿 */
export function collectDramaShotSpokenLinesForH3(
  shot?: {
    dialogue?: { text?: string }[];
    audio_timeline?: { text?: string }[];
    timeline_events?: { dialogue?: string; visual_action?: string }[];
  },
  extraSources: string[] = [],
): string[] {
  const structured: string[] = [];
  for (const d of shot?.dialogue || []) {
    structured.push(...splitSpokenChunks(String(d?.text || '')));
  }
  for (const a of shot?.audio_timeline || []) {
    structured.push(...splitSpokenChunks(String(a?.text || '')));
  }
  for (const e of shot?.timeline_events || []) {
    structured.push(...splitSpokenChunks(String(e?.dialogue || '')));
  }
  const fromText = extractSpokenLinesForH3Skill(extraSources.filter(Boolean).join('\n'));
  return uniqSpokenLines([...structured, ...fromText]);
}

/** 回填 <d> 后再跑确定性标准化（清禁人声 / 修时间戳 / 补口型规则） */
export function finalizeMinimaxH3SkillPrompt(output: string, spokenLines: string[] = []): string {
  return standardizeMinimaxH3VideoPrompt(
    reinjectSpokenLinesIntoH3SkillPrompt(output, spokenLines),
  );
}

export function countH3SpokenDTags(text: string): number {
  return (String(text || '').match(/<d>\s*\[Chinese/gi) || []).length;
}

export function wrapSpokenLineAsH3D(line: string): string {
  const t = String(line || '').trim();
  return t ? `<d>[Chinese] ${t}</d>` : '';
}

export function skillOutputKeepsSpokenLines(output: string, lines: string[]): boolean {
  if (!lines.length) return true;
  const body = String(output || '');
  if (countH3SpokenDTags(body) === 0) return false;
  const compact = body.replace(/\s+/g, '');
  // 每一句都要能在正文找到（不再用 some，避免漏句却跳过回填）
  return lines.every((l) => {
    const raw = String(l || '').trim();
    if (!raw || /^[…·\.．]{1,6}$/.test(raw)) return true;
    if (body.includes(raw)) return true;
    const stripped = stripDramaSystemSpokenLabel(raw);
    if (!stripped) return true;
    return body.includes(stripped) || compact.includes(stripped.replace(/\s+/g, ''));
  });
}

/** Skill 把「」台词丢掉时，按句回填 <d>，每句独立说话人，禁止粘成一句 */
export function reinjectSpokenLinesIntoH3SkillPrompt(output: string, lines: string[]): string {
  const keep = uniqSpokenLines(lines).filter((l) => l && !/^[…·\.．]{1,6}$/.test(l));
  if (!keep.length || skillOutputKeepsSpokenLines(output, keep)) return output;
  // 已有足够 <d> 标签时不再贴「on-camera speaker」粘包（短剧易把多说话人糊成一句）
  if (countH3SpokenDTags(output) >= keep.length) return output;
  const blocks = keep
    .map((line) => {
      const spoken = stripDramaSystemSpokenLabel(line) || line;
      const tag = wrapSpokenLineAsH3D(spoken);
      if (!tag) return '';
      if (looksLikeDramaSystemSpokenText(line)) {
        return `The off-screen narrator says in an off-screen voiceover: ${tag} while visible characters' lips remain completely closed.`;
      }
      return `The on-camera speaker says: ${tag}`;
    })
    .filter(Boolean)
    .join('\n\n');
  const speakBit = `${blocks}\nSpeak only those <d> words. Lip-sync each on-camera <d> line to the speaker named above it. Do not stay silent. Do not merge different speakers into one sentence. Do not place dialogue in English double quotation marks as visible text.`;
  const body = String(output || '').trim();
  if (/overall_soundscape\s*:/i.test(body)) {
    return body.replace(/overall_soundscape\s*:/i, `${speakBit}\n\noverall_soundscape:`);
  }
  if (/整体声景\s*[：:]/.test(body)) {
    return body.replace(/整体声景\s*[：:]/, `${speakBit}\n\n整体声景：`);
  }
  return `${body}\n\n${speakBit}`;
}

export function buildH3SkillDialogueLockRules(opts: {
  spokenLines: string[];
  hasRefAudio?: boolean;
}): string {
  const lines = uniqSpokenLines(opts.spokenLines || []);
  if (!lines.length) return '';
  return [
    'HARD DIALOGUE LOCK (overrides Picture-1 "Do not speak this line"):',
    'Source spoken lines use 「」 and/or <d> tags. Wrap EVERY line below in its own <d>[Chinese] … </d> inside detailed_description.',
    'Each <d> MUST be preceded by official form: "<Subject N> (Sx) … says: <d>[Chinese] … </d>". Off-screen narration uses: says in an off-screen voiceover … while lips remain completely closed. Never comma-join two speakers.',
    'Spoken lines (verbatim, original language):',
    ...lines.map((l, i) => `${i + 1}. ${l}`),
    'FORBIDDEN: "No one speaks", "No dialogue", "does not speak", "no vocal", "nonverbal only", or replacing these lines with a silent yawn/drink beat.',
    '"Do not speak this line" applies ONLY to Picture-1 lock sentences. It does NOT mean the character stays silent.',
    opts.hasRefAudio
      ? '<Audio N> is voice-timbre for the speaker. Generate audible speech + lip-sync for the <d> lines. Do not treat Audio as Foley-only.'
      : 'Generate audible speech + lip-sync for the <d> lines.',
  ].join('\n');
}

const OUTPUT_RULES_BASE_EN = `Output rules:
1. Absolute pure output: ONLY the final H3 prompt body. No greetings, explanations, markdown fences, or notes.
2. Follow the selected guide's field names, section order, labels, and timing notation exactly.
3. Labels must be EXACT English snake_case only: subject_definitions: / summary: / retention_analysis: / detailed_description: / overall_soundscape: / non_diegetic_music:. NEVER use Chinese section titles (主体定义 / 概述 / 内容保留分析 / 详细描述 / 整体声景 / 非剧情配乐). Outside <d>…</d>, write English ONLY — MiniMax H3 will speak any Chinese director notes as dialogue. Spoken lines from the source (「」 quotes or existing <d> tags) MUST be copied verbatim into <d>[Chinese] … </d>. Never drop them. Never replace them with "No one speaks".
4. Do not invent major new plot, characters, or a different location/set. Objects on screen must match the source scene.
5. Timing must match the requested duration when provided.
6. In integrated_multimodal_description / detailed_description: camera motion, rhythm, visible objects, and sound ONLY — no mood, lighting, color naming, or atmosphere words.
7. CRITICAL: Zero Chinese characters outside <d> tags. Reference tags like <图片1>/<主体1>/<音频1> may stay; all other prose must be English.
8. "Do not speak this line" is only for visual-anchor lock sentences. If the source has spoken lines, the character MUST speak those <d> words.`;

/** 短剧 Skill 终稿：英文段名/结构标签 + 中文正文；画风色调写入 detailed_description 首段 */
const OUTPUT_RULES_BASE_ZH = `输出规则（中英标签分工，必须严格遵守）：
1. 只输出最终提示词正文。不要问候、解释、markdown 代码块或备注。
2. 【英文·段名】只输出以下四段（按此顺序），禁止中文段名，禁止在正文前粘贴任何英文锁色/Negative/口型规则：
   retention_analysis:
   detailed_description:
   overall_soundscape:
   non_diegetic_music:
3. 【英文·结构标签】正文里必须用：
   - 参考：<Picture 1> <Picture 2> …（禁止 <图片N> / <主体N> / @图片N）
   - 分镜：[Shot 1] [Shot 2] …（禁止 [镜头 N]）
   - 时码：At 00:07.000
   - 对白壳：<d>[Chinese] … </d>
4. 【中文·正文】外貌、风格、运镜、动作、声景一律中文；对白原文进 <d>[Chinese]…</d>。
5. retention_analysis：每行一条「<Picture N>：姓名/身份，性别年龄气质，五官发型服饰」（场景图写场景结构）。
6. detailed_description：
   - 第一段必须写「已锁定画风色调」铅字（见上下文 HARD LOOK/GRADE），可再补一句电影质感，但不得改成别的画风/色调；
   - 然后写 [Shot N] 中文运镜+动作；有对白：动作 → <d>[Chinese]台词</d> → 说后反应；人物用 <Picture N>。
   - 【禁字幕硬锁】严禁在画面中出现任何烧录字幕、台词叠字、对话气泡、歌词条、水印、logo、UI 文字；对白只进 <d> 与音频轨，禁止把台词写成可见字幕。
7. 【禁止】输出或照抄以下内容到终稿：
   Keep Picture 1 colors… / Picture 1 is the first frame… / Negative: unrealistic color shift… /
   When a visible character Subject speaks… / Maintain correct human anatomy… /
   subject_definitions: / summary: （短剧本路径不用这两段）
8. 参考图只锁身份与场景结构，不锁死成片画风；成片 Look/Grade 以已锁定画风色调为准。
9. non_diegetic_music 必须 N/A。在 non_diegetic_music 段落后追加一行英文：No burned-in subtitles, captions, dialogue bubbles, watermarks, or on-screen UI text.
10. 不要追加编辑器尾巴（@图片 / 风格色调 / 剧情）。`;

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
  const autoSpoken = extractSpokenLinesForH3Skill(prompt);
  const imageCount = Math.max(0, Math.floor(Number(input.imageCount) || 0));
  const hasRefAudio = !!input.hasRefAudio;
  const durationSec =
    input.durationSec != null && Number.isFinite(Number(input.durationSec))
      ? Number(input.durationSec)
      : undefined;
  const baseSubMode = input.baseSubMode || 'T2VA';
  const modelId = String(input.modelId || '').trim();
  const outputZh = String(input.outputLanguage || 'en').toLowerCase() === 'zh';

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
    outputZh ? OUTPUT_RULES_BASE_ZH : OUTPUT_RULES_BASE_EN,
    structure === 'base'
      ? outputZh
        ? `9. Base 模式仍输出 retention_analysis + detailed_description + overall_soundscape + non_diegetic_music；正文中文；[Shot N] + <Picture N>。`
        : `9. For base modes, output must include integrated_multimodal_description, overall_soundscape, and non_diegetic_music in that order. Use mode ${baseSubMode} alignment rules from the guide.`
      : outputZh
        ? '9. 短剧 Full-Reference 精简四段：retention_analysis → detailed_description → overall_soundscape → non_diegetic_music。勿输出 subject_definitions/summary，勿粘贴 Picture1 锁色英文块。'
        : '9. For full-reference mode, output must start with subject_definitions: and include summary, retention_analysis, detailed_description, overall_soundscape, non_diegetic_music in that order.',
    !outputZh && imageCount >= 1 ? `10. ${PIC1_FIRST_FRAME_LOCK}` : '',
    !outputZh && imageCount >= 1 ? `11. ${VISUAL_ANCHOR_COPY_RULE}` : '',
    outputZh
      ? '10. 口型/解剖/声轨规则只在生成时遵守，禁止把英文规则句写入终稿正文。'
      : '',
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
  if (!outputZh && imageCount >= 1) {
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
        autoSpoken.length
          ? 'Map connected reference audio as <Audio 1> = speaker voice-timbre only. Generate the <d> spoken lines; do not copy sample-script words; do not treat Audio as nonverbal Foley-only.'
          : 'Map the connected reference audio as <Audio 1> with an appropriate copy/reference role from the guide.',
      );
    }
  }
  const dialogueLock = buildH3SkillDialogueLockRules({
    spokenLines: autoSpoken,
    hasRefAudio,
  });
  if (dialogueLock) ctxLines.push(dialogueLock);
  if (!outputZh) {
    ctxLines.push(H3_STANDARDIZE_RULES);
  } else {
    ctxLines.push(
      'DRAMA ZH META (do NOT paste into output): keep lip-sync accurate for on-camera <d> lines; no BGM; preserve spoken lines verbatim.',
    );
  }
  if (String(input.extraRules || '').trim()) {
    ctxLines.push(String(input.extraRules).trim());
  }

  const userPrompt = [
    '## Context',
    ...ctxLines.map((l) => `- ${l}`),
    '',
    outputZh
      ? '## 当前源提示词（请改写；对白/歌词语言保持原样）'
      : '## Current user prompt (rewrite this; keep dialogue/lyrics/on-screen text language)',
    prompt,
    '',
    structure === 'ref' || outputZh
      ? outputZh
        ? '请改写成短剧四段终稿：retention_analysis → detailed_description → overall_soundscape → non_diegetic_music。英文段名；正文中文；<Picture N> / [Shot N] / At 00:07.000 / <d>[Chinese]。禁止输出 Keep Picture 1…、Negative: unrealistic…、口型英文规则块、subject_definitions、summary。不要 markdown。'
        : 'Rewrite into the Full-Reference six-section prompt. Output must start with subject_definitions: and end with non_diegetic_music:. English ONLY outside <d> tags. No Chinese section titles. No markdown fences.'
      : outputZh
        ? `请改写成 Base 模式（${baseSubMode}）终稿（同上四段英文标签+中文正文）。`
        : `Rewrite into the Base-mode final prompt for ${baseSubMode}. English ONLY outside <d> tags. Include alignment instruction line, then integrated_multimodal_description / overall_soundscape / non_diegetic_music. No markdown fences.`,
    outputZh
      ? '参考图只锁身份与场景结构。成片画风色调必须用上下文 HARD LOOK/GRADE，写在 detailed_description 第一段。'
      : 'Object allowlist: only Picture 1 and the Story scene block. Camera through that location. Do not add props that are not in those sources.',
    outputZh
      ? '范例节奏：retention_analysis 每行 <Picture N>：中文外貌；detailed_description 先风格铅字再 [Shot N]；overall_soundscape 中文；non_diegetic_music: N/A。'
      : 'Copy the Visual Anchor block verbatim after <图片1>. Do not regrade. Do not restyle into 3D CGI. Do not write lighting, time of day, mood, or color names in shot descriptions.',
    '',
    outputZh
      ? [
          '## Required English labels (copy exactly; fill Chinese content)',
          'retention_analysis:',
          'detailed_description:',
          'overall_soundscape:',
          'non_diegetic_music:',
          '',
          '## Tag examples',
          '<Picture 1>：江绫，女，约二十岁……',
          '[Shot 1] … <Picture 1> … <d>[Chinese]台词</d>',
          '[Shot 2] At 00:07.000 …',
        ].join('\n')
      : structure === 'ref'
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
  if (musicIdx < 0) {
    // 无配乐段时也截掉中文编辑器尾巴（@图片 / 风格色调 / 剧情）
    const cn = s.search(/\n\s*@图片\s*\d+\s*是|\n\s*风格色调\s*[：:]|\n\s*剧情\s*[：:]/);
    return cn > 0 ? s.slice(0, cn).trim() : s.trim();
  }
  const after = s.slice(musicIdx);
  const cutters = [
    after.search(/\n\s*@图片\s*\d+\s*是/),
    after.search(/\n\s*风格色调\s*[：:]/),
    after.search(/\n\s*剧情\s*[：:]/),
    after.search(/\n(?:#{1,3}\s|\*{1,2}|Note:|说明[:：])/i),
  ].filter((i) => i > 0);
  if (cutters.length) {
    return s.slice(0, musicIdx + Math.min(...cutters)).trim();
  }
  return s.trim();
}

/** 短剧英文 Skill 终稿清洗：去中文尾巴 / 空 <d> / 错误 speakBit / 强制无配乐 */
export function sanitizeDramaEnglishH3SkillPrompt(text: string): string {
  let s = trimAfterMusicSection(String(text || ''));
  // 同行粘住的中文编辑器说明 / @图片 尾巴
  s = s.replace(
    /non_diegetic_music\s*:\s*\n?\s*N\/A\s*(?:编辑用[^\n]*|@图片[\s\S]*)$/i,
    'non_diegetic_music:\nN/A',
  );
  const cnTail = s.search(
    /\n\s*(?:编辑用中文稿|编辑用英文稿)|(?:^|\n)\s*@图片\s*\d+\s*是|(?:^|\n)\s*风格色调\s*[：:]|(?:^|\n)\s*剧情\s*[：:]/,
  );
  if (cnTail > 0) s = s.slice(0, cnTail).trim();
  // 空/省略号对白（模型抄了规则里的 … 占位）
  s = s.replace(/<d>\s*\[Chinese\]\s*[…·\.．]{1,6}\s*<\/d>/gi, '');
  // detailed_description 已有正经 <d> 时，删掉 overall 前的「The on-camera speaker says + Speak only those」粘贴块
  if (
    /detailed_description\s*:/i.test(s) &&
    (/<d>\s*\[Chinese\][^<]{4,}<\/d>/i.test(s.match(/detailed_description\s*:[\s\S]*?(?=overall_soundscape\s*:|$)/i)?.[0] || '') ||
      /says:\s*<d>\s*\[Chinese\]/i.test(s))
  ) {
    s = s.replace(
      /\n(?:The (?:on-camera speaker|off-screen narrator)[\s\S]*?\n)+Speak only those <d> words\.[\s\S]*?(?=\n(?:overall_soundscape|non_diegetic_music)\s*:)/gi,
      '\n\n',
    );
  }
  // 短剧禁止发明非剧情配乐
  if (/non_diegetic_music\s*:/i.test(s)) {
    s = s.replace(
      /non_diegetic_music\s*:[\s\S]*$/i,
      'non_diegetic_music:\nN/A',
    );
  } else {
    s = `${s.trim()}\n\nnon_diegetic_music:\nN/A`;
  }
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

/** 短剧中英混排 Skill 终稿清洗：统一英文段名/标签，去掉锁色英文块，正文可保留中文 */
export function sanitizeDramaChineseH3SkillPrompt(text: string): string {
  let s = String(text || '').trim();
  // 砍掉正文前的 Picture1 锁色 / Negative / 口型规则粘贴
  s = s.replace(
    /^[\s\S]*?(?=(?:retention_analysis|detailed_description|主体定义|内容保留分析|详细描述)\s*[：:])/i,
    '',
  );
  s = s.replace(/^Keep Picture 1 colors[\s\S]*?(?=\n(?:subject_definitions|retention_analysis|detailed_description)\s*:)/gim, '');
  s = s.replace(/^Picture 1 is the first frame[\s\S]*?Do not speak this line\.\s*/gim, '');
  s = s.replace(/^Negative:\s*unrealistic color shift[^\n]*\n?/gim, '');
  s = s.replace(
    /\nWhen a visible character Subject speaks[\s\S]*?environmental sounds occupy background track\.\s*/gi,
    '\n',
  );
  s = s.replace(/\nMaintain correct human anatomy[^\n]*\n?/gi, '\n');
  s = s.replace(/\nNo unwanted camera shake[^\n]*\n?/gi, '\n');
  s = s.replace(/\nCharacter vocal lines run on dedicated vocal-audio track[^\n]*\n?/gi, '\n');
  // 短剧四段：丢掉 subject_definitions / summary（若模型仍输出）
  s = s.replace(
    /subject_definitions\s*:[\s\S]*?(?=retention_analysis\s*:|detailed_description\s*:)/i,
    '',
  );
  s = s.replace(/summary\s*:[\s\S]*?(?=retention_analysis\s*:|detailed_description\s*:)/i, '');

  const tail = s.search(
    /\n\s*(?:编辑用中文稿|编辑用英文稿)|(?:^|\n)\s*@图片\s*\d+\s*是|(?:^|\n)\s*风格色调\s*[：:]|(?:^|\n)\s*剧情\s*[：:]/,
  );
  if (
    tail > 0 &&
    (/retention_analysis\s*:/i.test(s.slice(0, tail)) ||
      /detailed_description\s*:/i.test(s.slice(0, tail)))
  ) {
    s = s.slice(0, tail).trim();
  }
  const headingMap: Array<[RegExp, string]> = [
    [/(^|\n)\s*主体定义\s*[：:]/g, '$1subject_definitions:'],
    [/(^|\n)\s*概述\s*[：:]/g, '$1summary:'],
    [/(^|\n)\s*内容保留分析\s*[：:]/g, '$1retention_analysis:'],
    [/(^|\n)\s*详细描述\s*[：:]/g, '$1detailed_description:'],
    [/(^|\n)\s*整体声景\s*[：:]/g, '$1overall_soundscape:'],
    [/(^|\n)\s*非剧情配乐\s*[：:]/g, '$1non_diegetic_music:'],
    [/(^|\n)\s*综合多模态描述\s*[：:]/g, '$1integrated_multimodal_description:'],
  ];
  for (const [re, rep] of headingMap) s = s.replace(re, rep);
  s = s.replace(/<图片\s*(\d+)\s*>/g, '<Picture $1>');
  s = s.replace(/<主体\s*(\d+)\s*>/g, '<Picture $1>');
  s = s.replace(/\[镜头\s*(\d+)\]/g, '[Shot $1]');
  s = s.replace(/在\s*(\d{2}:\d{2}(?:\.\d{1,3})?)/g, 'At $1');
  s = s.replace(/<d>\s*\[Chinese\]\s*[…·\.．]{1,6}\s*<\/d>/gi, '');
  // 优先从 retention_analysis 起裁
  const ra = s.search(/retention_analysis\s*:/i);
  const dd = s.search(/detailed_description\s*:/i);
  if (ra >= 0) s = s.slice(ra).trim();
  else if (dd >= 0) s = s.slice(dd).trim();
  if (/non_diegetic_music\s*:/i.test(s)) {
    s = s.replace(/non_diegetic_music\s*:[\s\S]*$/i, 'non_diegetic_music:\nN/A');
  } else {
    s = `${s.trim()}\n\nnon_diegetic_music:\nN/A`;
  }
  if (
    !/No burned-in subtitles|burned-in subtitle|短剧禁字幕|NO_SUBTITLE/i.test(s)
  ) {
    s = `${s.trim()}\nNo burned-in subtitles, captions, dialogue bubbles, watermarks, or on-screen UI text.`;
  }
  return s.replace(/\n{3,}/g, '\n\n').trim();
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
  if (/^integrated[_\s-]*multimodal[_\s-]*description$/i.test(b) || /^综合多模态描述$/.test(b)) {
    return /[\u4e00-\u9fff]/.test(b) || /^综合/.test(b)
      ? '综合多模态描述：'
      : 'integrated_multimodal_description:';
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
    const startIdx = s.search(
      /subject_definitions\s*:|主体定义\s*[：:]|retention_analysis\s*:|内容保留分析\s*[：:]/i,
    );
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
  s = recoverMinimaxH3OptimizedPrompt(s);
  s = finalizeMinimaxH3SkillPrompt(s, extractSpokenLinesForH3Skill(sourcePrompt || ''));
  return sanitizeDramaEnglishH3SkillPrompt(s);
}

/** 英文 base 三段 */
function hasMinimaxH3EnBaseSections(s: string): boolean {
  return (
    /integrated[_\s-]*multimodal[_\s-]*description\s*:/i.test(s) &&
    /overall[_\s-]*soundscape\s*:/i.test(s) &&
    /non[_\s-]*diegetic[_\s-]*music\s*:/i.test(s)
  );
}

/** 英文 ref 六段（至少主体/详述/配乐）；短剧四段以 retention+detailed 为准 */
function hasMinimaxH3EnRefSections(s: string): boolean {
  const hasDetail = /detailed[_\s-]*description\s*:/i.test(s);
  const hasSound =
    /non[_\s-]*diegetic[_\s-]*music\s*:/i.test(s) || /overall[_\s-]*soundscape\s*:/i.test(s);
  if (!hasDetail || !hasSound) return false;
  return (
    /subject[_\s-]*definitions\s*:/i.test(s) ||
    /retention_analysis\s*:/i.test(s)
  );
}

/** 中文六段（导演台常用；模型常把「整体声景」写成「背景」） */
function hasMinimaxH3ZhSections(s: string): boolean {
  const hasSound =
    /非剧情配乐\s*[：:]/.test(s) ||
    /整体声景\s*[：:]/.test(s) ||
    /(?:^|\n)\s*背景\s*[：:]/.test(s) ||
    /(?:^|\n)\s*声景\s*[：:]/.test(s);
  if (/综合多模态描述\s*[：:]/.test(s) && hasSound) return true;
  return (
    /主体定义\s*[：:]/.test(s) &&
    /详细描述\s*[：:]/.test(s) &&
    hasSound
  );
}

/** 是否为短剧 Skill 终稿（中文正文；段名可为中文或英文） */
export function isMinimaxH3ChineseSkillPrompt(text: string): boolean {
  const s = String(text || '').trim();
  if (!s || !/[\u4e00-\u9fff]/.test(s)) return false;
  if (hasMinimaxH3ZhSections(s)) return true;
  // 英文段名 + 中文正文（产品范例）；兼容 detailed description / overall soundscape 空格写法
  return (
    (/retention_analysis\s*:/i.test(s) ||
      /detailed[_\s-]*description\s*:/i.test(s) ||
      /overall[_\s-]*soundscape\s*:/i.test(s)) &&
    (/<Picture\s+\d+>/i.test(s) || /\[Shot\s*\d+\]/i.test(s) || /<d>\s*\[Chinese/i.test(s))
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
