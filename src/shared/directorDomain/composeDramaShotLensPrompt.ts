/**
 * 整镜编译稿：中文白话（编辑预览）与英文 H3 八段（Skill/上云）。
 * 「提示词优化」与画布视频节点同一 MiniMax H3 Skill；优化稿即上云终稿。
 */

import {
  directorStyleLooksMonochrome,
  ensureDirectorDramaVideoPromptGuards,
} from '../directorPipeline/composeFinalPrompt.js';
import { formatDirectorH3Timecode } from '../directorPipeline/minimaxH3DramaPrompt.js';
import { isMinimaxH3ChineseSkillPrompt } from '../minimaxH3OptimizePrompt.js';
import {
  dramaVisualActionToEnglish,
  isBlankDramaCameraMarker,
  isSubjectOnlyResidue,
} from './dramaVisualToEnglish.js';
import {
  cleanDramaMappedVisualAction,
  formatDramaScreenOverlayEn,
  formatDramaScreenOverlayZh,
  isDramaInnerOsCue,
  isDramaNarrationVisual,
  isDramaSceneTransitionText,
  isDramaScreenTextVisual,
  isNonVisualDramaEyeline,
  looksLikeDramaSystemSpokenText,
  looksLikeDramaInMindSystemVoice,
  stripDramaDirectorLensTags,
  stripDramaNarrationLabel,
  stripDramaSystemSpokenLabel,
} from './extractCastFromScript.js';
import { stripDramaSpokenLineBody } from './characterDesignPrompt.js';
import {
  collectDramaEventSpokenTurns,
  dramaTimelineEventHasContent,
  ensureDramaShotTimelineEvents,
  isDramaSystemTimelineBeat,
  isDramaSystemTimelineSpeaker,
  isPlaceholderDramaVisualAction,
  peelSystemSpokenFromTimelineVisual,
  tidyDramaTimelineVisualAction,
  type DramaSpeakerRef,
} from './timelineEvent.js';
import {
  applyDramaShotPromptBackfill,
  dramaShotCameraRecipeFromFields,
  dramaShotHandoffLineZh,
} from './dramaShotPromptBackfill.js';
import { getActiveEpisodeBible } from './episodeBible.js';
import { resolveDramaScriptDesignVisualStyle } from './scriptDesign.js';
import { scrubVisualStyleToLookAndColor } from './visualStyleLookColor.js';
import { getVisualStylePreset } from './visualStylePresets.js';
import {
  isDramaShotUsingStoryboardAsVideoRef,
  listDramaShotRefAudioSlots,
  listDramaShotRefImageSlots,
} from './shotRefs.js';
import { resolveEffectiveDramaShotCharacterIds } from './shotCastGate.js';
import {
  audioIndexForVoiceEntity,
  buildDramaShotVoiceBindingTable,
  resolveSpokenLineVoiceRole,
  type DramaVoiceBindingTable,
} from './voiceBinding.js';
import {
  DRAMA_NARRATOR_SPEAKER_ID,
  DRAMA_SYSTEM_HOLOGRAM_VISUAL_EN,
  DRAMA_SYSTEM_HOLOGRAM_VISUAL_ZH,
  DRAMA_SYSTEM_SPEAKER_ID,
  dramaShotHasNarratorDialogue,
  dramaShotHasSystemDialogue,
  ensureDramaSystemHologramVisual,
  isDramaSystemHologramVisual,
  isDramaSystemVoiceId,
  resolveDramaVoiceRole,
} from './voiceEntity.js';
import { scrubH3SpeechLeak } from './h3DialogueMode.js';
import { toH3SilentFoleyEnglish } from './h3SilentEnglish.js';
import { dramaShotHasSpokenDialogue } from './migrateH3Compiler.js';
import {
  parseDramaShotTimeEnv,
  type DramaCharacter,
  type DramaDirectorSession,
  type DramaShot,
  type DramaTimelineEvent,
  type DramaVoice,
} from './types.js';

export const DRAMA_LENS_PROMPT_VERSION = 'lens-prod.v1';

export type DramaLensSubject = {
  n: number;
  tag: string;
  sn: string;
  name: string;
  character_id?: string;
  prop_id?: string;
  creature_id?: string;
  role: 'character' | 'scene' | 'prop' | 'creature';
  pictureTag: string;
  look: string;
  voiceTimbre: string;
  speakPronoun: 'he' | 'she';
};

type DramaVocalSpeakers = {
  byCharacterId: Map<string, number>;
  systemSpeakId: number;
  narratorSpeakId: number;
};

const NEGATIVE_LINE =
  'Negative: unrealistic color shift, over-saturation, style drift, CGI remake, warm golden hour, purple haze, cold blue mood, orange sunlight, watermark, logo, deformed hands, extra fingers, distorted facial features, unwanted camera shake';

/** Pic1 色锁 + 空间锚点合并为一次（原 COLOR_FRONT + VISUAL_ANCHOR 重复）。 */
const PIC1_LOCK_EN =
  'Keep Picture 1 colors, rendering, visible scene structure, and materials as in the image; do not regrade or restyle into 3D CGI. Camera stays in that visual space. Do not speak this line.';

const PIC1_LOCK_ZH =
  '保持 Picture 1 的色彩、渲染、可见场景结构与材质；禁止重上色或改成 3D CGI。运镜留在同一视觉空间。本行勿口述。';

const SUBJECT_RULES = [
  'When a visible character Subject speaks that character\'s own <d> lines, generate accurate lip-sync matching that spoken dialogue. Do not lip-sync system-voice or narrator <d> onto any visible face.',
  'When speakers switch: only the current speaker Subject opens the mouth for that <d> window; every other visible Subject keeps mouth closed and silent. Never swap, merge, or reassign <d> lines across Subjects.',
  'Character Pictures are appearance locks only (face, hair, costume, silhouette). Never inherit their white, blank, or studio backdrop into the shot; place characters into the scene Picture environment only.',
  'Maintain correct human anatomy; avoid distorted hands, extra fingers, twisted limbs; no unwanted camera shake.',
  'Character vocal on dedicated track; ambience on background track.',
].join('\n');

/** 系统声绑定禁令（口型/画外已写入 SPEECH_RULE_*_WITH_SYSTEM，此处不重复）。 */
const SYSTEM_VOICE_ASSIGN_EN =
  'Never assign system-voice or narrator <d> lines to any Subject or any character Audio.';

/** 对齐官方 skill：台词仅 <d>；画面字仅英文双引号点名（短剧默认不点名）。 */
const SPEECH_RULE_EN =
  'Spoken lines use only <d>[Chinese] … </d>. Place speaker ID, action, and delivery outside <d>. On-screen banners/signs/labels use English double quotes only when they must appear in frame; never put dialogue in quotation marks as visible text.';

const SPEECH_RULE_EN_WITH_SYSTEM =
  `${SPEECH_RULE_EN} System-voice and narrator say in an off-screen voiceover; visible characters' lips remain completely closed.`;

const SPEECH_RULE_ZH =
  '对白只能写在 <d>[Chinese] … </d> 内。说话人编号、动作与情绪写在 <d> 外。招牌/霓虹等画面字仅在必须入画时用英文双引号点名；禁止把对白写成画面引号字。';

const SPEECH_RULE_ZH_WITH_SYSTEM =
  `${SPEECH_RULE_ZH}系统声与旁白用画外旁白说出，可见人物嘴唇保持完全闭合。`;

const SUBJECT_RULES_ZH = [
  '可见角色 Subject 念本人 <d> 时口型精确同步；系统声/旁白 <d> 不得套到可见人脸。',
  '切换说话人时：仅当前说话 Subject 张口；其余可见 Subject 闭嘴静默。禁止对调、合并或错挂 <d> 台词。',
  '人物参考图只锁外貌（脸/发/服装/轮廓）；禁止把人物图的白底/棚拍背景带进成片，人物必须落在场景参考图环境中。',
  '保持正确人体结构；禁止多指/畸形手/无意义机位抖动。',
  '人物对白走人声轨；环境音走背景轨。',
].join('\n');

const SYSTEM_VOICE_ASSIGN_ZH =
  '禁止把系统声/旁白 <d> 分配给任何 Subject 或任何角色 Audio。';

function trimLine(s: unknown): string {
  return String(s || '').trim();
}

/** 旧中文稿：说：后跟引用块、台词没进 <d>。新中文稿带 <d>，不算旧稿。 */
export function isLegacyDramaH3ChineseLensPrompt(text: string): boolean {
  const t = String(text || '');
  if (/<d>\s*\[Chinese/i.test(t)) return false;
  if (/subject_definitions\s*:/i.test(t) && /\[Shot\s*\d+\]/i.test(t)) return false;
  if (/主体定义\s*[：:]/.test(t) && /详细描述\s*[：:]/.test(t)) return false;
  if (!/\[镜头\s*\d+\]/.test(t) || !/<(?:Picture|Subject|Audio)\s*\d+>/.test(t)) return false;
  return /说：\s*\n+\s*>/.test(t) || /使用 <Audio \d+> 参考的音色，/.test(t);
}

/** 说明书目标格式：英文 8 段 + [Shot N] + Subject */
export function isDramaH3AntiCrosstalkPrompt(text: string): boolean {
  const t = String(text || '');
  return (
    /subject_definitions\s*:/i.test(t) &&
    /detailed_description\s*:/i.test(t) &&
    /\[Shot\s*\d+\]/i.test(t) &&
    /<(?:Picture|Subject)\s*\d+>/.test(t)
  );
}

/** 中文整镜编译稿：白话 @图片 / 风格色调 / 剧情；兼容旧密集稿；英文白话同构 */
export function isDramaH3ProductionPrompt(text: string): boolean {
  const t = String(text || '');
  if (/@图片\s*\d+\s*是/.test(t) && /风格色调\s*[：:]/.test(t) && /剧情\s*[：:]/.test(t)) {
    return true;
  }
  if (
    /@Picture\s+\d+\s+is\b/i.test(t) &&
    /Style\s*\/\s*tone\s*[：:]/i.test(t) &&
    /Plot\s*[：:]/i.test(t)
  ) {
    return true;
  }
  if (
    /主体定义\s*[：:]/.test(t) &&
    /详细描述\s*[：:]/.test(t) &&
    /\[镜头\s*\d+\]/.test(t) &&
    /<(?:Picture|Subject)\s*\d+>/.test(t)
  ) {
    return true;
  }
  if (!/\d{2}:\d{2}(?:\.\d{1,3})?\s*[–-]\s*\d{2}:\d{2}/.test(t)) return false;
  if (/\[场景概述\]|subject_definitions\s*:|主体定义\s*[：:]/i.test(t)) return false;
  return (
    /全程保持|<d>\s*\[Chinese/i.test(t) ||
    /<(?:Picture|Audio)\s*\d+>/.test(t)
  );
}

export function isDramaH3LensTaggedPrompt(text: string): boolean {
  const t = String(text || '');
  if (isDramaH3AntiCrosstalkPrompt(t)) return true;
  if (isDramaH3ProductionPrompt(t)) return true;
  if (/@图片\s*\d+\s*是/.test(t) && /剧情\s*[：:]/.test(t)) return true;
  if (/@Picture\s+\d+\s+is\b/i.test(t) && /Plot\s*[：:]/i.test(t)) return true;
  return /\[镜头\s*\d+\]/.test(t) && /<(?:Picture|Subject|Audio)\s*\d+>/.test(t);
}

export function formatDramaH3Clock(sec: number): string {
  return formatDirectorH3Timecode(sec);
}

/** 生产稿时段：00:00–00:03.6 */
export function formatDramaH3ClockCompact(sec: number): string {
  const x = Math.max(0, Number(sec) || 0);
  const totalTenths = Math.round(x * 10);
  const mm = Math.floor(totalTenths / 600);
  const rem = totalTenths % 600;
  const ss = Math.floor(rem / 10);
  const tenths = rem % 10;
  const base = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return tenths > 0 ? `${base}.${tenths}` : base;
}

function formatDramaH3RangeCompact(start: number, end: number): string {
  return `${formatDramaH3ClockCompact(start)}–${formatDramaH3ClockCompact(end)}`;
}

function speakPronounOf(gender?: string): 'he' | 'she' {
  return /女|female|woman|girl/i.test(String(gender || '')) ? 'she' : 'he';
}

const REF_ROLE_ZH: Record<string, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  creature: '生物',
  style: '风格',
  storyboard: '分镜',
};

export function resolveDramaShotVisualStylePrompt(
  session: DramaDirectorSession,
  shot?: DramaShot,
): { name: string; body: string } {
  const bible = getActiveEpisodeBible(session);
  const sug = shot
    ? (bible.shot_suggestions || []).find(
        (s) =>
          String(s.shot || '') === String(shot.shot_no || '') ||
          String(s.suggestion_id || '') === String(shot.shot_id || ''),
      )
    : undefined;
  const pvb = session.bible?.projectVisualBible;
  const dna = pvb?.visualDNA || session.bible?.visualDNA;
  const preset = getVisualStylePreset(pvb?.presetId || dna?.presetId || '');
  const fromDnaZh = scrubVisualStyleToLookAndColor(
    trimLine(preset?.visualDNA?.promptTemplateZh) ||
      trimLine(preset?.visualDNA?.promptTemplate) ||
      trimLine(pvb?.stylePrompt) ||
      trimLine(dna?.generatedPrompt),
  );
  const body = scrubVisualStyleToLookAndColor(
    fromDnaZh ||
      trimLine(sug?.visual_style) ||
      resolveDramaScriptDesignVisualStyle(session) ||
      trimLine(session.bible?.visual?.style) ||
      trimLine(session.bible?.project?.visual_style),
  );
  const name =
    trimLine(bible.visual_bible_binding?.style_name) ||
    trimLine(pvb?.presetName) ||
    trimLine(preset?.name) ||
    '';
  return { name, body };
}

function characterLookZh(c?: DramaCharacter): string {
  if (!c) return '以参考图外貌为准';
  const bits = [
    trimLine(c.visual?.hair) || trimLine(c.hair_color),
    trimLine(c.visual?.face),
    trimLine(c.visual?.clothing),
    trimLine(c.visual?.specialFeature),
  ].filter(Boolean);
  return bits.join('，') || '以参考图外貌为准';
}

function characterLook(c?: DramaCharacter): string {
  if (!c) return 'appearance locked to the assigned reference image';
  const bits = [
    trimLine(c.visual?.hair) || trimLine(c.hair_color),
    trimLine(c.visual?.face),
    trimLine(c.visual?.clothing),
    trimLine(c.visual?.body) || trimLine(c.body_type),
    trimLine(c.visual?.specialFeature),
    (c.visual_anchors || []).map(trimLine).filter(Boolean).slice(0, 3).join(', '),
  ].filter(Boolean);
  return bits.join(', ') || 'appearance locked to the assigned reference image';
}

/** retention / subject：按角色/道具/场景分流；禁止道具套用「脸/发/服装」角色模板 */
function retentionLookEn(
  look: string,
  pictureTag: string,
  role: DramaLensSubject['role'] = 'character',
): string {
  const raw = trimLine(look);
  const propLock = pictureTag
    ? `follow ${pictureTag} exactly for prop appearance, materials, silhouette, and structure`
    : 'prop appearance, materials, and structure retained from reference';
  const charLock = pictureTag
    ? `follow ${pictureTag} exactly for face, hair, costume, silhouette, and materials`
    : 'identity and visible appearance retained from reference';
  const sceneLock = pictureTag
    ? `follow ${pictureTag} exactly for spatial structure, materials, and lighting logic`
    : 'scene structure, materials, and lighting retained from reference';
  const fallback =
    role === 'prop' || role === 'creature' ? propLock : role === 'scene' ? sceneLock : charLock;
  if (!raw || /appearance locked|environment locked/i.test(raw)) {
    return fallback;
  }
  if (!/[\u4e00-\u9fff]/.test(raw)) return raw;
  const en = trimLine(dramaVisualActionToEnglish(raw, [], { failOpen: false }));
  if (en && !/[\u4e00-\u9fff]/.test(en) && !/on-screen action continues/i.test(en) && en.length > 6) {
    return en;
  }
  return fallback;
}

function retentionLookZh(role: DramaLensSubject['role'], pictureTag: string): string {
  if (role === 'prop' || role === 'creature') {
    return pictureTag
      ? `跟随 ${pictureTag} 的外观、材质与结构，不得改形或换材质`
      : '跟随参考外观、材质与结构，不得改形或换材质';
  }
  if (role === 'scene') {
    return pictureTag
      ? `跟随 ${pictureTag} 的空间结构、材质与光色逻辑，不得重上色或改风格`
      : '跟随参考图空间结构、材质与光色逻辑，不得重上色或改风格';
  }
  return pictureTag
    ? `跟随 ${pictureTag} 的外貌与服装轮廓，不得重绘身份`
    : '跟随参考图外貌与服装轮廓，不得重绘身份';
}

function sceneLookEn(
  session: DramaDirectorSession,
  shot: DramaShot,
  sceneSubject: DramaLensSubject | null,
): string {
  const scene = (session.bible?.scenes || []).find((s) => s.scene_id === shot.scene_asset_id);
  const bits = [
    trimLine(scene?.prompt),
    trimLine(scene?.spatial_structure),
    trimLine(scene?.architecture),
    trimLine(scene?.lighting),
    trimLine(scene?.materials),
    (scene?.fixed_elements || []).map(trimLine).filter(Boolean).slice(0, 6).join(', '),
    trimLine(sceneSubject?.look),
  ].filter(Boolean);
  return retentionLookEn(bits.join('; '), sceneSubject?.pictureTag || '', 'scene');
}

function voiceOf(session: DramaDirectorSession, characterId: string): DramaVoice | undefined {
  const c = (session.bible?.characters || []).find((x) => x.character_id === characterId);
  const voices = session.bible?.voices || [];
  return (
    voices.find((v) => v.voice_id && v.voice_id === c?.voice_id) ||
    voices.find((v) => v.character_id === characterId)
  );
}

function voiceTimbreOf(
  session: DramaDirectorSession,
  characterId: string,
  gender?: string,
): string {
  const v = voiceOf(session, characterId);
  const bits = [
    trimLine(v?.identity?.timbre) || trimLine(v?.timbre),
    trimLine(v?.identity?.voice_character) || trimLine(v?.voiceStyle),
    trimLine(v?.identity?.age_range),
    trimLine(v?.identity?.gender) || trimLine(gender),
  ].filter(Boolean);
  if (bits.length) return bits.join(', ');
  return /女|female/i.test(String(gender || ''))
    ? 'female voice'
    : 'male voice';
}

function pictureTagFor(
  slots: ReturnType<typeof listDramaShotRefImageSlots>,
  subject: {
    role: DramaLensSubject['role'];
    character_id?: string;
    prop_id?: string;
    creature_id?: string;
    name: string;
  },
): string {
  const assetId = trimLine(subject.character_id || subject.prop_id || subject.creature_id);
  const role = subject.role;
  // 角色不得锁到 scene 槽：只匹配同 role 的槽
  const byId = assetId
    ? slots.find((s) => s.asset_id === assetId && (!role || s.role === role))
    : undefined;
  if (byId) return `<Picture ${byId.index}>`;
  const byName = slots.find(
    (s) => trimLine(s.name) === subject.name && (!role || s.role === role),
  );
  if (byName) return `<Picture ${byName.index}>`;
  if (role === 'scene') {
    const byRole = slots.find((s) => s.role === 'scene');
    if (byRole) return `<Picture ${byRole.index}>`;
  }
  return '';
}

export function resolveDramaLensSubjects(
  session: DramaDirectorSession,
  shot: DramaShot,
): {
  pictureCount: number;
  subjects: DramaLensSubject[];
  subjectByCharacterId: Map<string, DramaLensSubject>;
  sceneSubject: DramaLensSubject | null;
} {
  const slots = listDramaShotRefImageSlots(session, shot);
  const charIds = resolveEffectiveDramaShotCharacterIds(session, shot);
  const subjects: DramaLensSubject[] = [];
  const subjectByCharacterId = new Map<string, DramaLensSubject>();
  let n = 1;
  for (const id of charIds) {
    const c = (session.bible?.characters || []).find((x) => x.character_id === id);
    const name = trimLine(c?.name) || id;
    const sub: DramaLensSubject = {
      n,
      tag: `<Subject ${n}>`,
      sn: `S${n}`,
      name,
      character_id: id,
      role: 'character',
      pictureTag: pictureTagFor(slots, { role: 'character', character_id: id, name }),
      look: characterLook(c),
      voiceTimbre: voiceTimbreOf(session, id, c?.gender),
      speakPronoun: speakPronounOf(c?.gender),
    };
    subjects.push(sub);
    subjectByCharacterId.set(id, sub);
    n += 1;
  }
  const sceneSlot = slots.find((s) => s.role === 'scene');
  const scene = (session.bible?.scenes || []).find((s) => s.scene_id === shot.scene_asset_id);
  const sceneName = trimLine(sceneSlot?.name || scene?.name || scene?.location);
  let sceneSubject: DramaLensSubject | null = null;
  if (sceneName) {
    const look = [
      trimLine(scene?.kind),
      trimLine(scene?.location),
      (scene?.fixed_elements || []).map(trimLine).filter(Boolean).slice(0, 3).join(', '),
    ]
      .filter(Boolean)
      .join(', ');
    sceneSubject = {
      n,
      tag: `<Subject ${n}>`,
      sn: `S${n}`,
      name: sceneName,
      role: 'scene',
      pictureTag: pictureTagFor(slots, { role: 'scene', name: sceneName }),
      look: look || 'environment locked to the assigned reference image',
      voiceTimbre: '',
      speakPronoun: 'he',
    };
    subjects.push(sceneSubject);
    n += 1;
  }
  const propIds = [...(shot.prop_ids || []), ...(shot.required_prop_ids || [])];
  const seenProp = new Set<string>();
  for (const id of propIds) {
    if (!id || seenProp.has(id)) continue;
    seenProp.add(id);
    const p = (session.bible?.props || []).find((x) => x.prop_id === id);
    const name = trimLine(p?.name) || id;
    const look = [
      trimLine(p?.appearance),
      trimLine(p?.material),
      trimLine(p?.description),
    ]
      .filter(Boolean)
      .join(', ') || 'appearance locked to the assigned reference image';
    subjects.push({
      n,
      tag: `<Subject ${n}>`,
      sn: `S${n}`,
      name,
      prop_id: id,
      role: 'prop',
      pictureTag: pictureTagFor(slots, { role: 'prop', prop_id: id, name }),
      look,
      voiceTimbre: '',
      speakPronoun: 'he',
    });
    n += 1;
  }
  const seenCreature = new Set<string>();
  for (const id of shot.creature_ids || []) {
    if (!id || seenCreature.has(id)) continue;
    seenCreature.add(id);
    const c = (session.bible?.creatures || []).find((x) => x.creature_id === id);
    const name = trimLine(c?.name) || id;
    subjects.push({
      n,
      tag: `<Subject ${n}>`,
      sn: `S${n}`,
      name,
      creature_id: id,
      role: 'creature',
      pictureTag: pictureTagFor(slots, { role: 'creature', creature_id: id, name }),
      look:
        trimLine(c?.appearance) ||
        trimLine(c?.behavior) ||
        'appearance locked to the assigned reference image',
      voiceTimbre: '',
      speakPronoun: 'he',
    });
    n += 1;
  }
  return {
    pictureCount: slots.length,
    subjects,
    subjectByCharacterId,
    sceneSubject,
  };
}

function voiceTableOf(session: DramaDirectorSession, shot: DramaShot): DramaVoiceBindingTable {
  return buildDramaShotVoiceBindingTable(session, shot);
}

function audioIndexForCharacter(
  session: DramaDirectorSession,
  shot: DramaShot,
  characterId: string,
): number {
  const role = resolveDramaVoiceRole(characterId);
  if (role === 'system') return audioIndexForVoiceEntity(voiceTableOf(session, shot), DRAMA_SYSTEM_SPEAKER_ID);
  if (role === 'narrator') {
    return audioIndexForVoiceEntity(voiceTableOf(session, shot), DRAMA_NARRATOR_SPEAKER_ID);
  }
  return audioIndexForVoiceEntity(voiceTableOf(session, shot), characterId);
}

function audioIndexForSystem(session: DramaDirectorSession, shot: DramaShot): number {
  return audioIndexForVoiceEntity(voiceTableOf(session, shot), DRAMA_SYSTEM_SPEAKER_ID);
}

function audioIndexForNarrator(session: DramaDirectorSession, shot: DramaShot): number {
  return audioIndexForVoiceEntity(voiceTableOf(session, shot), DRAMA_NARRATOR_SPEAKER_ID);
}

function speakerLabel(s: DramaLensSubject): string {
  return `${s.tag} (${s.sn}) ${s.name}`;
}

function speakerLabelZh(s: DramaLensSubject): string {
  return `${s.tag}（${s.sn}）${s.name}`;
}

function bindSubjectTagsZh(text: string, subjects: DramaLensSubject[]): string {
  let t = String(text || '');
  const ordered = [...subjects].sort((a, b) => b.name.length - a.name.length);
  for (const s of ordered) {
    if (!s.name || t.includes(s.tag)) continue;
    const re = new RegExp(s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    t = t.replace(re, speakerLabelZh(s));
  }
  return t;
}

function isCutEvent(ev: DramaTimelineEvent, index: number): boolean {
  if (index <= 0) return false;
  const blob = `${ev.camera_action || ''} ${ev.visual_action || ''}`;
  return /\[切\]|硬切|急切|切到|切镜|hard\s*cut|\bcut\s+to\b/i.test(blob);
}

function cameraToEnglish(raw: string, subjects: DramaLensSubject[] = []): string {
  let t = String(raw || '').trim();
  if (!t || isBlankDramaCameraMarker(t)) return '';
  const ordered = [...subjects].sort((a, b) => b.name.length - a.name.length);
  for (const s of ordered) {
    if (!s.name) continue;
    const re = new RegExp(s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    t = t.replace(re, s.tag);
  }
  const map: Array<[RegExp, string]> = [
    [/希区柯克推拉/g, 'Hitchcock dolly zoom'],
    [/斯坦尼康贴身呼吸跟拍/g, 'Steadicam breathing follow at hip height'],
    [/斯坦尼康/g, 'Steadicam'],
    [/贴地飞行跟拍/g, 'low skimming tracking shot'],
    [/过肩呼吸跟拍/g, 'over-the-shoulder breathing follow'],
    [/过肩压迫/g, 'over-the-shoulder pressure'],
    [/过肩对切感/g, 'over-the-shoulder coverage'],
    [/过肩看听者/g, 'over-the-shoulder onto the listener'],
    [/双人拉锯推拉/g, 'two-shot push-pull on speech rhythm'],
    [/窒息推轨对准下颌开合/g, 'choke dolly onto the jaw'],
    [/窒息推轨/g, 'choke dolly-in at 0.2m/s'],
    [/窒息推近/g, 'choke push-in'],
    [/急推变焦后接手持崩坏感/g, 'crash zoom then handheld collapse'],
    [/急推后手持崩坏/g, 'crash push then handheld collapse'],
    [/急推变焦/g, 'crash zoom'],
    [/手持崩坏跟拍/g, 'handheld collapse tracking'],
    [/手持贴身跟打点/g, 'handheld body tracking on impact'],
    [/手持呼吸感/g, 'handheld breathing drift'],
    [/手持崩坏/g, 'handheld collapse'],
    [/框架推门跟入/g, 'door-frame push-in follow'],
    [/前景门框挤入后缓推轨/g, 'door-frame squeeze then slow dolly-in'],
    [/倒飞揭示，镜头后退上升，人物缩成点/g, 'reverse pull-back aerial, camera moves backward and upward, character becomes a tiny dot'],
    [/倒飞揭示/g, 'reverse pull-back aerial reveal'],
    [/垂直上升揭示后悬停俯冲到站位/g, 'vertical rise reveal then hover-dive onto the stance'],
    [/垂直上升揭示/g, 'vertical rise reveal'],
    [/插入镜头急推到屏幕或证物/g, 'insert shot, fast push-in onto the screen or evidence'],
    [/插入镜头/g, 'insert shot'],
    [/慢速横摇后悬停俯冲到站位/g, 'slow pan then hover-dive onto the stance'],
    [/慢速横摇扫过对峙轴线后停在两人之间/g, 'slow pan across the confrontation axis, hold between them'],
    [/顶部俯拍缓慢环绕审视/g, 'top-down slow orbit of scrutiny'],
    [/顶部俯拍缓慢环绕后落动作轴/g, 'top-down orbit then settle on the action axis'],
    [/高机位上帝俯/g, "God's-eye high angle"],
    [/高角度上帝降/g, "God's-eye descending high angle"],
    [/高角度缓慢降/g, 'slow descending high angle'],
    [/环绕审视后停在宣判角度/g, 'orbit of scrutiny, stop on the verdict angle'],
    [/环绕审视后急停在宣判角度/g, 'orbit of scrutiny, hard-stop on the verdict angle'],
    [/环绕审视/g, 'orbit of scrutiny'],
    [/半环绕审视/g, 'half-orbit of scrutiny'],
    [/低角度虫眼推/g, 'worm-eye low push-in'],
    [/虫眼仰拍/g, 'worm-eye low angle'],
    [/极低机位超广角缓推入/g, 'ultra-wide ground-level slow push-in'],
    [/极低机位超广角缓推/g, 'ultra-wide ground-level slow push'],
    [/极低机位超广角/g, 'ultra-wide ground-level'],
    [/剥离拉远半档/g, 'half-stop pull-away'],
    [/剥离拉远/g, 'estranging pull-out'],
    [/逆向飞离/g, 'reverse fly-away'],
    [/失重漂浮感缓拉/g, 'weightless drifting pull-out'],
    [/缓拉远\+轻微变焦/g, 'slow pull-out with a slight zoom'],
    [/呼吸变焦/g, 'breathing zoom'],
    [/变焦切割到证物[^，,]*/g, 'zoom-cut onto the evidence'],
    [/POV 第一人称闯入/g, 'POV first-person intrusion'],
    [/POV 第一人称听句/g, 'POV first-person listening'],
    [/POV 第一人称/g, 'POV first-person'],
    [/甩摇切入动作轴/g, 'whip-pan onto the action axis'],
    [/撕裂感甩摇/g, 'lacerating whip-pan'],
    [/听者反应特写/g, 'listener reaction close-up'],
    [/柔和云台慢推/g, 'soft gimbal slow push'],
    [/固定仰拍长老面部/g, 'locked low-angle on the elder face'],
    [/固定机位，胸腔呼吸起伏可读，禁止再推/g, 'locked-off, ribcage breathing readable, no further push'],
    [/固定呼吸/g, 'locked breathing hold'],
    [/前景道具遮挡/g, 'foreground prop obstruction'],
    [/前景遮挡不撤/g, 'foreground obstruction held'],
    [/前景肩背虚化/g, 'foreground shoulder defocus'],
    [/浅景深隔离/g, 'shallow-depth isolation'],
    [/景深收死背景/g, 'background crushed by shallow focus'],
    [/负空间留白/g, 'negative-space hold'],
    [/中近景/g, 'Medium close-up'],
    [/中全景/g, 'Medium-wide shot'],
    [/大特写/g, 'Extreme close-up'],
    [/特写/g, 'Close-up'],
    [/近景/g, 'Close-up'],
    [/中景/g, 'Medium shot'],
    [/全景|远景/g, 'Wide shot'],
    [/屏幕插入/g, 'screen insert shot'],
    [/推屏/g, 'push-in onto the screen'],
    [/缓移带环境元素/g, 'slow drift including environment elements'],
    [/缓移带环境与窗户/g, 'slow drift including environment and window'],
    [/缓移/g, 'slow drift'],
    [/贴地低机/g, 'ground-skimming low camera'],
    [/低机位仰拍/g, 'low-angle upshot'],
    [/低机仰拍/g, 'low-angle upshot'],
    [/低机位/g, 'low camera'],
    [/平视略偏侧|平视微侧/g, 'eye-level slight profile'],
    [/平视贴脸/g, 'eye-level tight on the face'],
    [/俯拍审判/g, 'high-angle judgment'],
    [/微俯/g, 'slight high angle'],
    [/微仰/g, 'slight low angle'],
    [/正面/g, 'front angle'],
    [/平视/g, 'eye-level'],
    [/俯拍/g, 'high angle'],
    [/仰拍/g, 'low angle'],
    [/高机/g, 'high camera'],
    [/三分构图/g, 'rule of thirds'],
    [/居中构图/g, 'centered composition'],
    [/框中框/g, 'frame-within-frame'],
    [/前景遮挡/g, 'foreground obstruction'],
    [/负空间/g, 'negative space'],
    [/固定镜头|固定机位|固定/g, 'locked-off camera'],
    [/缓慢推向/g, 'slow push-in toward'],
    [/缓慢推入|缓推/g, 'slow push-in'],
    [/硬切|急切/g, 'hard cut'],
    [/切到黑场|切到黑屏/g, 'cut to black'],
    [/跟拍/g, 'tracking'],
  ];
  for (const [re, en] of map) t = t.replace(re, en);
  t = t
    .replace(/[·｜|]/g, ', ')
    .replace(/[\u4e00-\u9fff]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .replace(/(?:,\s*){2,}/g, ', ');
  return t;
}

function visualToEnglish(raw: string, subjects: DramaLensSubject[]): string {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (isDramaSystemHologramVisual(t)) return DRAMA_SYSTEM_HOLOGRAM_VISUAL_EN;
  return dramaVisualActionToEnglish(
    t,
    subjects
      .filter((s) => !!s.name)
      .map((s) => ({
        name: s.name,
        replacement: s.role === 'character' ? `${s.tag} (${s.sn})` : s.tag,
      })),
  );
}

function formatSpeakId(n: number): string {
  return n > 0 ? `(S${n})` : '';
}

/** 角色括注与 Subject 编号一致；禁止 SpeakId 序与 Subject 序错位（如 Subject 3 (S2)）。 */
function formatCharacterSpeakLabel(speaker: DramaLensSubject): string {
  const sn = trimLine(speaker.sn);
  if (sn) return `${speaker.tag} (${sn.replace(/^[Ss]/, 'S')})`;
  return speaker.tag;
}

function eventTextBlob(ev: DramaTimelineEvent): string {
  return [
    ev.visual_action,
    ev.character_state,
    ev.expression,
    ev.eyeline,
    ev.dialogue,
    ev.camera_action,
  ]
    .map(trimLine)
    .filter(Boolean)
    .join(' ');
}

function eventMentionsSubjectName(ev: DramaTimelineEvent, name: string): boolean {
  const n = trimLine(name);
  return !!n && eventTextBlob(ev).includes(n);
}

function visibleSubjectsForEvent(
  ev: DramaTimelineEvent,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): DramaLensSubject[] {
  const out: DramaLensSubject[] = [];
  const seen = new Set<string>();
  const push = (s?: DramaLensSubject | null) => {
    if (!s || seen.has(s.tag)) return;
    seen.add(s.tag);
    out.push(s);
  };
  // 专段弹幕/屏字：角色/场景均未「真实出镜」，禁止从 character_ids / scene 注入 Subject
  if (isDramaScreenTextVisual(ev.visual_action)) {
    for (const s of resolved.subjects) {
      if (s.role !== 'prop' && s.role !== 'creature') continue;
      if (eventMentionsSubjectName(ev, s.name)) push(s);
    }
    return out;
  }
  for (const id of ev.character_ids || []) {
    push(resolved.subjectByCharacterId.get(id));
  }
  const dlgId = trimLine(ev.dialogue_character_id);
  if (dlgId && resolveDramaVoiceRole(dlgId) === 'character') {
    push(resolved.subjectByCharacterId.get(dlgId));
  }
  if (resolved.sceneSubject) push(resolved.sceneSubject);
  const contentEvents = (shot.timeline_events || []).filter(
    (e) =>
      !!trimLine(e.visual_action) ||
      !!trimLine(e.dialogue) ||
      (e.character_ids || []).length > 0,
  );
  const includeAllProps = contentEvents.length <= 1;
  for (const s of resolved.subjects) {
    if (s.role !== 'prop' && s.role !== 'creature') continue;
    if (includeAllProps || eventMentionsSubjectName(ev, s.name)) push(s);
  }
  return out;
}

function formatVisibleLine(subjects: DramaLensSubject[]): string {
  if (!subjects.length) return '';
  return `Visible: ${subjects
    .map((s) =>
      s.pictureTag ? `${s.tag} (locked to ${s.pictureTag})` : `${s.tag} (locked to NONE)`,
    )
    .join('; ')}`;
}

function formatLipSyncLine(
  turns: Array<{ name: string; character_id: string; line: string }>,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): string {
  if (!turns.length) return '';
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const turn of turns) {
    const role = resolveSpokenLineVoiceRole(turn.character_id, turn.name, turn.line);
    if (role === 'system' || role === 'narrator') continue;
    const who = resolveSpokenWho(turn, resolved);
    if (!who || seen.has(who.tag)) continue;
    seen.add(who.tag);
    tags.push(who.tag);
  }
  if (!tags.length) return 'Lip-sync: none.';
  if (tags.length === 1) return `Lip-sync: ${tags[0]} only.`;
  return `Lip-sync: ${tags.join(' and ')} only.`;
}

function formatVisibleLineZh(subjects: DramaLensSubject[]): string {
  if (!subjects.length) return '';
  return `可见：${subjects
    .map((s) =>
      s.pictureTag ? `${s.tag}（锁定 ${s.pictureTag}）` : `${s.tag}（锁定 NONE）`,
    )
    .join('；')}`;
}

function formatLipSyncLineZh(
  turns: Array<{ name: string; character_id: string; line: string }>,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): string {
  if (!turns.length) return '';
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const turn of turns) {
    const role = resolveSpokenLineVoiceRole(turn.character_id, turn.name, turn.line);
    if (role === 'system' || role === 'narrator') continue;
    const who = resolveSpokenWho(turn, resolved);
    if (!who || seen.has(who.tag)) continue;
    seen.add(who.tag);
    tags.push(who.tag);
  }
  if (!tags.length) return '口型：无。';
  if (tags.length === 1) return `口型：仅 ${tags[0]}。`;
  return `口型：仅 ${tags.join(' 与 ')}。`;
}

function formatSpokenBlock(
  speaker: DramaLensSubject,
  line: string,
  audioIndex = 0,
  _speakId = 0,
): string {
  void _speakId;
  const spoken = stripDramaSpokenLineBody(line, [speaker.name].filter(Boolean));
  if (!spoken) return '';
  const who = formatCharacterSpeakLabel(speaker);
  const timbre =
    audioIndex > 0
      ? `, using the voice timbre referenced from <Audio ${audioIndex}>`
      : ', MISSING VOICE: no reference audio for this character; do not use another character Audio';
  // 官方格式：Speaker (Sx) … says: <d>[Lang] … </d>，并强制最小说前/说后状态
  return `${who}${timbre} parts the lips and says: <d>[Chinese]${spoken}</d> ${who} closes the mouth and holds still after the line. Other visible Subjects keep mouths closed and silent during this line.`;
}

function formatOffscreenSpokenBlock(
  role: 'system' | 'narrator',
  line: string,
  audioIndex = 0,
  speakId = 0,
): string {
  const spoken = trimLine(
    role === 'narrator' ? stripDramaNarrationLabel(stripDramaSystemSpokenLabel(line)) : stripDramaSystemSpokenLabel(line),
  );
  if (!spoken) return '';
  const sid = formatSpeakId(speakId);
  const who =
    role === 'system'
      ? sid
        ? `The off-screen system voice ${sid}`
        : 'The off-screen system voice'
      : sid
        ? `The off-screen narrator ${sid}`
        : 'The off-screen narrator';
  const timbre =
    audioIndex > 0
      ? `, using the voice timbre referenced from <Audio ${audioIndex}>`
      : ', MISSING VOICE: not using any character Audio';
  // 官方 voiceover：says in an off-screen voiceover … while lips remain completely closed
  return `${who}${timbre} says in an off-screen voiceover: <d>[Chinese]${spoken}</d> while visible characters' lips remain completely closed.`;
}

function formatSpokenBlockZh(
  speaker: DramaLensSubject,
  line: string,
  audioIndex: number,
): string {
  const spoken = stripDramaSpokenLineBody(line, [speaker.name].filter(Boolean));
  if (!spoken) return '';
  const audio = audioIndex > 0 ? `使用 <Audio ${audioIndex}> 参考的音色，` : '';
  return `${audio}${speakerLabelZh(speaker)}，说：\n<d>[Chinese]${spoken}</d>\n（仅此人张口；其余可见 Subject 闭嘴静默）`;
}

function styleLeadZh(style: { name: string; body: string }): string {
  const name = trimLine(style.name);
  if (/电影质感/.test(name)) return '电影质感';
  if (name && /[\u4e00-\u9fff]/.test(name) && name.length <= 12) {
    return name.replace(/的?风格$/, '');
  }
  const first = trimLine(style.body).split(/[，,\n]/)[0] || '';
  if (/[\u4e00-\u9fff]/.test(first) && first.length <= 12) return first;
  return '电影质感';
}

function buildProductionOpenZh(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): string {
  const style = resolveDramaShotVisualStylePrompt(session, shot);
  const place = resolved.sceneSubject?.name || '本场';
  const lead = styleLeadZh(style);
  const slots = listDramaShotRefImageSlots(session, shot);
  const sceneSlot = slots.find((s) => s.role === 'scene');
  const chars = resolved.subjects.filter((s) => s.role === 'character');
  const people = chars
    .map((c) => {
      const pic = slots.length && c.pictureTag ? `${c.pictureTag} 中` : '';
      return `${pic}${c.name}`;
    })
    .filter(Boolean)
    .join('、');
  const sceneLock = sceneSlot
    ? `<Picture ${sceneSlot.index}> 中的${place}空间结构`
    : `${place}空间结构`;
  let open = '';
  if (people && sceneSlot) {
    open = `${lead}的${place}，保持 ${sceneLock}与 ${people}的外貌服装完全一致；人物落在场景环境中，禁止沿用人物参考图白底/棚拍背景。`;
  } else if (people) {
    open = `${lead}的${place}，保持参考图中的人物${chars.map((c) => c.name).join('、')}和${place}空间结构完全一致；禁止白底棚拍背景。`;
  } else {
    open = `${lead}的${place}，保持${sceneLock}完全一致。`;
  }
  const handoff = dramaShotHandoffLineZh(shot);
  if (handoff) open = `${open}\n承接：${handoff}`;
  return open;
}

function cameraMoveAsSentence(move: string): string {
  const m = trimLine(move);
  if (!m) return '';
  if (/摄影机|镜头/.test(m)) return m;
  if (/缓慢推向|缓慢推入|缓推/.test(m)) return '摄影机缓慢向前推进';
  if (/快速推近|急推/.test(m) && !/变焦|手持/.test(m)) return '镜头快速推近';
  if (/^固定(?:机位|镜头)?$/.test(m)) return '摄影机固定';
  return m;
}

function cameraToNaturalZh(raw: string, opts: { cut: boolean }): string {
  let t = trimLine(raw);
  if (!t || isBlankDramaCameraMarker(t)) return opts.cut ? '硬切。' : '';
  if (/切到黑场|切到黑屏|进入纯黑/.test(t) && t.length < 48) {
    return '画面迅速进入纯黑。';
  }
  const cut = opts.cut || /\[切\]|硬切/.test(t);
  t = t.replace(/\[切\]\s*/g, '');
  const recipe = t.match(
    /^([^·]+)·([^·]+)·([^，,]+)[，,]?\s*(\d+\s*mm)?[，,]?/,
  );
  if (recipe && /中景|近景|特写|全景|远景|中近景|中全景|屏幕插入/.test(recipe[1])) {
    const size = trimLine(recipe[1]);
    const angle = trimLine(recipe[2]).replace(/^微俯$/, '微俯视');
    const move = cameraMoveAsSentence(trimLine(recipe[3]));
    const lensRaw = trimLine(recipe[4] || '').replace(/\s+/g, '') || '35mm';
    const lensBit = /电影镜头/.test(lensRaw) ? lensRaw : `${lensRaw}电影镜头`;
    let out = [size, angle, lensBit, move].filter(Boolean).join('，');
    if (cut && !/^切入|^硬切|^切至/.test(out)) out = `切入${out}`;
    if (!/[。！？]$/.test(out)) out += '。';
    return out;
  }
  t = t.replace(/[·｜|]/g, '，').replace(/，{2,}/g, '，').replace(/^，|，$/g, '');
  if (/硬切/.test(t) && /急推|快速推/.test(t)) {
    return '切入，镜头快速推近。';
  }
  if (/缓慢推向|缓慢推入|缓推/.test(t) && !/摄影机/.test(t) && t.length < 20) {
    t = '摄影机缓慢向前推进';
  }
  if (/(\d+)\s*mm(?!电影镜头)/i.test(t)) {
    t = t.replace(/(\d+)\s*mm(?!电影镜头)/i, '$1mm电影镜头');
  }
  if (cut && !/^切入|^硬切|^切至|^切到/.test(t)) t = `切入${t}`;
  if (!/[。！？]$/.test(t)) t += '。';
  return t;
}

function resolveProductionCameraZh(
  ev: DramaTimelineEvent,
  writtenCam: string,
  shot?: DramaShot,
): string {
  const cam = trimLine(writtenCam || ev.camera_action);
  if (!isBlankDramaCameraMarker(cam)) return cam;
  const fromShot = shot ? dramaShotCameraRecipeFromFields(shot) : '';
  return isBlankDramaCameraMarker(fromShot) ? '' : fromShot;
}

function isBlackBeat(visual: string, cam: string): boolean {
  return /黑屏|黑场|纯黑/.test(`${visual} ${cam}`);
}

function stripTimelineCutChineseDecorators(visual: string): string {
  return stripDramaDirectorLensTags(
    String(visual || '')
      .replace(/^【[^】]{1,24}】\s*/, '')
      .trim(),
  );
}

/** 源提示词不含规划/机位/运镜：这些交给 MiniMax H3 Skill 优化补全 */
function stripCameraPlanningFromVisual(visual: string): string {
  let t = String(visual || '').trim();
  if (!t) return '';
  t = t.replace(
    /^(?:\[切\]\s*)?(?:中景|近景|特写|全景|远景|中近景|中全景|屏幕插入)·[^·\n]+·[^，,\n]+(?:[，,]\s*\d+\s*mm)?[，,]?\s*/g,
    '',
  );
  t = t.replace(
    /(?:^|[。；;\n])\s*(?:景别|机位|运镜|规划|镜头|摄影机)\s*[：:]\s*[^。\n]+[。]?/g,
    (m) => (/^[。；;\n]/.test(m) ? m[0] : ''),
  );
  t = t.replace(
    /(?:固定机位|固定镜头|缓慢推入|缓慢推向|缓推|急推|手持微晃|环绕|俯拍|仰拍|平视|微俯|微仰)\s*[，,]?/g,
    '',
  );
  return t.replace(/[，,]{2,}/g, '，').replace(/^[，,\s]+|[，,\s]+$/g, '').trim();
}

function resolveTimelineVisualForPrompt(visual: string, lang: 'zh' | 'en'): string {
  const raw = String(visual || '').trim();
  if (!raw) return '';
  if (isDramaScreenTextVisual(raw)) {
    return lang === 'zh' ? formatDramaScreenOverlayZh(raw) : formatDramaScreenOverlayEn(raw);
  }
  const peeled = stripCameraPlanningFromVisual(stripTimelineCutChineseDecorators(raw));
  const cleaned = tidyDramaTimelineVisualAction(cleanDramaMappedVisualAction(peeled));
  if (isDramaNarrationVisual(cleaned) || isPlaceholderDramaVisualAction(cleaned)) return '';
  // 占位「站定」等稀疏 visual 不得进动作链（TE 脏字段同源）
  if (isSparseDramaVisualForDirecting(cleaned)) return '';
  return cleaned;
}

function sequentialActionZh(visual: string): string {
  if (isDramaScreenTextVisual(visual)) {
    return formatDramaScreenOverlayZh(visual);
  }
  const t = resolveTimelineVisualForPrompt(visual, 'zh');
  if (!t) return '';
  if (/黑屏|黑场|纯黑/.test(t) && t.length < 24) return '画面迅速进入纯黑。';
  const parts = t
    .split(/[，、；;]+/)
    .map((p) => trimLine(p))
    .filter(Boolean);
  return parts
    .map((p) => {
      if (/黑屏|黑场|纯黑/.test(p) && p.length < 24) return '画面迅速进入纯黑。';
      return /[。！？]$/.test(p) ? p : `${p}。`;
    })
    .join('');
}

function speakEmotionFromVisual(visual: string): string {
  return visual.match(/惊恐|紧张|惊讶|愤怒|平静|慵懒/)?.[0] || '';
}

function formatSpokenProductionZh(
  speaker: DramaLensSubject,
  line: string,
  audioIndex: number,
  opts: { continued: boolean; visual: string; speakId?: number },
): string {
  const spoken = stripDramaSpokenLineBody(line, [speaker.name].filter(Boolean));
  if (!spoken) return '';
  const who = formatCharacterSpeakLabel(speaker);
  const timbre =
    audioIndex > 0
      ? `，使用 <Audio ${audioIndex}> 参考音色`
      : '，MISSING VOICE：本角色无参考音，禁止套用其他角色 Audio';
  if (opts.continued) {
    return `短暂停顿后继续张口说：<d>[Chinese]${spoken}</d> ${who} 说完闭嘴静止。其余可见 Subject 本句期间闭嘴静默。`;
  }
  const emo = speakEmotionFromVisual(opts.visual);
  const lead = emo ? `${emo}地` : '';
  return `${who}${timbre} ${lead}张口说：<d>[Chinese]${spoken}</d> ${who} 说完闭嘴静止。其余可见 Subject 本句期间闭嘴静默。`;
}

function formatOffscreenSpokenProductionZh(
  role: 'system' | 'narrator',
  line: string,
  audioIndex = 0,
  speakId = 0,
): string {
  const spoken = trimLine(
    role === 'narrator'
      ? stripDramaNarrationLabel(stripDramaSystemSpokenLabel(line))
      : stripDramaSpokenLineBody(stripDramaSystemSpokenLabel(line)),
  );
  if (!spoken) return '';
  const sid = formatSpeakId(speakId);
  const label = role === 'system' ? '画外系统声' : '画外旁白';
  const sidBit = sid ? ` ${sid}` : '';
  const timbre =
    audioIndex > 0
      ? `，使用 <Audio ${audioIndex}> 参考音色`
      : '，MISSING VOICE：不使用任何角色 Audio';
  // 「说道」紧贴说话人标签，SpeakId / Audio 说明跟在后面（对齐英文 who + timbre + says）
  return `${label}说道${sidBit}${timbre}：<d>[Chinese]${spoken}</d>，可见人物嘴唇保持完全闭合。`;
}

function productionCharacterState(raw: string): string {
  return trimLine(raw)
    .replace(/[，,]?\s*情绪强度高/g, '')
    .replace(/[、，,\s]+$/g, '')
    .trim();
}

/** 空/占位视觉：禁止再把 TE.position / eyeline / character_state 串进动作链 */
function isSparseDramaVisualForDirecting(raw: string): boolean {
  const t = tidyDramaTimelineVisualAction(raw);
  if (!t || isPlaceholderDramaVisualAction(t)) return true;
  if (/^(?:站定|双脚站定|站位落定|双手自然下垂|维持落点|画面过渡)[。．.]?$/u.test(t)) {
    return true;
  }
  if (/空间与站位[：:].{0,12}站定/.test(t) && t.length < 48) return true;
  return false;
}

const STUB_BLOCKING_RE =
  /^(?:站定|双脚站定|站位落定|双手自然下垂|维持落点|画面过渡|空间与站位)(?:[。．.…]*)?$/u;

function isDramaStubBlocking(raw: string): boolean {
  const t = trimLine(raw).replace(/[。．.…]+$/g, '');
  if (!t) return true;
  if (STUB_BLOCKING_RE.test(t)) return true;
  if (/^空间与站位[：:]/.test(t) && /站定/.test(t) && t.length < 40) return true;
  return false;
}

/** 站位未落在本拍 visual、也不点名在场主体 → 视为错误字段串入（如「狼群中」） */
function isUngroundedDramaPosition(
  pos: string,
  visual: string,
  subjects: DramaLensSubject[],
): boolean {
  const p = trimLine(pos);
  if (!p || isDramaStubBlocking(p)) return true;
  const v = trimLine(visual);
  if (v && (v.includes(p) || p.includes(v))) return false;
  if (subjects.some((s) => {
    const n = trimLine(s.name);
    return !!n && p.includes(n);
  })) {
    return false;
  }
  // 短抽象站位/地点标签且未在 visual 出现 → 污染
  if (p.length <= 16 && (!v || !v.includes(p))) return true;
  return false;
}

function productionEventKeep(ev: DramaTimelineEvent): boolean {
  const peeled = peelSystemSpokenFromTimelineVisual(ev.visual_action, ev.dialogue);
  if (isDramaScreenTextVisual(peeled.visual)) return true;
  const visual = resolveTimelineVisualForPrompt(peeled.visual, 'zh');
  const patched = {
    ...ev,
    visual_action: isPlaceholderDramaVisualAction(visual) ? '' : visual,
    dialogue: peeled.dialogue,
  };
  if (isBlackBeat(visual, String(ev.camera_action || ''))) return true;
  return dramaTimelineEventHasContent(patched);
}

const PRODUCTION_CLOSE_ZH =
  '全程保持人物外貌、服装、场景结构与画风连续；对白只写在 <d>[Chinese]…</d>（声音与口型），勿把台词写成画面字或引号招牌字。';

const FORBIDDEN_DEFAULT_EYELINE_RE =
  /^(?:the\s+)?(?:camera|viewer|lens|audience)$|^镜头(?:前|里|中)?$|^观众$|^镜头$/i;

function semanticOrRaw(raw: string, subjects: DramaLensSubject[]): string {
  const t = trimLine(raw);
  if (!t) return '';
  const en = visualToEnglish(t, subjects);
  if (en) return en;
  // 禁止未译中文静默变空：留给 visualToEnglish/dramaVisualActionToEnglish 保底
  if (/[\u4e00-\u9fff]/.test(t)) {
    return visualToEnglish(t, subjects) || 'the on-screen action continues';
  }
  return t;
}

function formatEyelineForPrompt(
  eyeline: string,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
  ev?: DramaTimelineEvent,
  lang: 'zh' | 'en' = 'en',
): string {
  const t = trimLine(eyeline);
  const sceneNames = [
    ...resolved.subjects.filter((s) => s.role === 'scene').map((s) => s.name),
    resolved.sceneSubject?.name,
  ].filter((n): n is string => !!n);
  if (
    !t ||
    FORBIDDEN_DEFAULT_EYELINE_RE.test(t) ||
    isNonVisualDramaEyeline(t, sceneNames)
  ) {
    return '';
  }
  if (ev && (t === trimLine(ev.visual_action) || t === trimLine(ev.dialogue))) return '';
  if (ev && isDramaSystemTimelineBeat(ev)) return '';
  const byId = resolved.subjectByCharacterId.get(t);
  if (byId) return lang === 'zh' ? byId.name : byId.tag;
  const byName = resolved.subjects.find((s) => s.name === t || s.character_id === t);
  if (byName) return lang === 'zh' ? byName.name : byName.tag;
  // 未解析到的 char-xxx 原始 id 禁止进提示词
  if (/^char-[\w-]+$/i.test(t)) return '';
  if (lang === 'zh') return t;
  return semanticOrRaw(t, resolved.subjects);
}

function eventDirectingLinesZh(
  ev: DramaTimelineEvent,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): string[] {
  if (isDramaSystemTimelineBeat(ev)) return [];
  if (isDramaScreenTextVisual(ev.visual_action)) return [];
  if (isSparseDramaVisualForDirecting(ev.visual_action)) return [];
  const lines: string[] = [];
  const pos = trimLine(ev.position);
  if (pos && !isUngroundedDramaPosition(pos, ev.visual_action, resolved.subjects)) {
    lines.push(pos);
  }
  const eye = formatEyelineForPrompt(ev.eyeline, resolved, ev, 'zh');
  if (eye) lines.push(`视线 ${eye}`);
  const state = productionCharacterState(ev.character_state);
  if (state) lines.push(state);
  const expr = trimLine(ev.expression);
  if (expr && !isDramaInnerOsCue(expr)) lines.push(expr);
  return lines;
}

function eventDirectingLinesEnglish(
  ev: DramaTimelineEvent,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): string[] {
  if (isDramaSystemTimelineBeat(ev)) return [];
  if (isDramaScreenTextVisual(ev.visual_action)) return [];
  if (isSparseDramaVisualForDirecting(ev.visual_action)) return [];
  const lines: string[] = [];
  const posRaw = trimLine(ev.position);
  if (posRaw && !isUngroundedDramaPosition(posRaw, ev.visual_action, resolved.subjects)) {
    const pos = semanticOrRaw(posRaw, resolved.subjects);
    if (pos) lines.push(pos);
  }
  const eye = formatEyelineForPrompt(ev.eyeline, resolved, ev, 'en');
  if (eye) lines.push(`eyeline ${eye}`);
  const state = semanticOrRaw(productionCharacterState(ev.character_state), resolved.subjects);
  if (state) lines.push(state);
  return lines;
}

function eventVisualZh(
  visual: string,
  ev: DramaTimelineEvent,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): { text: string; cam: string } {
  // 机位/运镜不进源稿，交给 Skill
  const cam = '';
  const act = bindSubjectTagsZh(
    resolveTimelineVisualForPrompt(visual, 'zh') || stripCameraPlanningFromVisual(visual),
    resolved.subjects,
  );
  const foleyRaw = (ev.environment_audio || []).map(trimLine).filter(Boolean);
  const foley = `环境音效：${(foleyRaw.length ? foleyRaw : ['场景底噪']).join('、')}`;
  return {
    text: [act, ...eventDirectingLinesZh(ev, resolved), foley].filter(Boolean).join('\n'),
    cam,
  };
}

function normalizeActionDedupeKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,;:!?'"“”‘’、，。；：！？…—\-–]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 镜头动作链：去掉标点差异造成的同句重复，保留真正递进动作。 */
function dedupeActionChainLines(lines: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const t = trimLine(line);
    if (!t) continue;
    const key = normalizeActionDedupeKey(t);
    if (!key || seen.has(key)) continue;
    let subsumed = false;
    for (const prev of [...seen]) {
      if (key.length >= 24 && prev.includes(key)) {
        subsumed = true;
        break;
      }
      if (prev.length >= 24 && key.includes(prev)) {
        const idx = out.findIndex((d) => normalizeActionDedupeKey(d) === prev);
        if (idx >= 0) {
          seen.delete(prev);
          seen.add(key);
          out[idx] = t;
        }
        subsumed = true;
        break;
      }
    }
    if (subsumed) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function resolveSpokenWho(
  turn: { character_id: string; name: string },
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): DramaLensSubject | null {
  if (
    isDramaSystemVoiceId(turn.character_id) ||
    isDramaSystemTimelineSpeaker(turn.character_id, turn.name)
  ) {
    return null;
  }
  return (
    resolved.subjectByCharacterId.get(turn.character_id) ||
    resolved.subjects.find((s) => s.name === turn.name && s.role === 'character') ||
    null
  );
}

function eventVisualEnglish(
  visual: string,
  ev: DramaTimelineEvent,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): { text: string; cam: string } {
  const spoken = String(ev.dialogue || '').trim();
  const actRaw = isDramaSystemHologramVisual(visual)
    ? DRAMA_SYSTEM_HOLOGRAM_VISUAL_EN
    : isDramaScreenTextVisual(visual)
      ? formatDramaScreenOverlayEn(visual)
      : visualToEnglish(
          resolveTimelineVisualForPrompt(visual, 'en') ||
            stripCameraPlanningFromVisual(stripTimelineCutChineseDecorators(visual)),
          resolved.subjects,
        );
  // P0：有原文动作时禁止因未收录词把 Action 静默清空
  let act = trimLine(actRaw);
  // 对白镜：禁止空/残渣 visual 回落成「错误 Subject continues the on-screen action」
  if (spoken && (!act || /continues the on-screen action/i.test(act))) {
    act = '';
  }
  let exprRaw = trimLine(ev.expression);
  // 对白切段：表情若是整段 action 污染则丢掉
  if (spoken && isDialogueBeatActionDump(exprRaw, spoken)) {
    exprRaw = '';
  }
  const exprEn = isDramaInnerOsCue(exprRaw) ? '' : visualToEnglish(exprRaw, resolved.subjects);
  const expr = trimLine(exprEn);
  const envRaw = (ev.environment_audio || []).map(trimLine).filter(Boolean);
  const foleyItems = toH3SilentFoleyEnglish(envRaw.length ? envRaw : ['场景底噪']);
  const foley = foleyItems.length ? `Foley: ${foleyItems.join('; ')}` : '';
  const directing = eventDirectingLinesEnglish(ev, resolved).filter(
    (line) => !isSubjectOnlyResidue(line.replace(/^eyeline\s+/i, '')),
  );
  const parts = [act, ...directing, expr, foley]
    .map(trimLine)
    .filter(Boolean);
  // 去重：同一站位/表情被 visual + position + expression 重复写入（忽略标点差异）
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const p of parts) {
    const key = normalizeActionDedupeKey(p);
    if (!key || seen.has(key)) continue;
    // 丢弃切镜中文前缀/屏字被剥汉字后的空括号残片
    if (/^\[(?:\s|[．.／/：:])*\]$/.test(p) || /\[(?:\s|[．.／/]){1,12}\]/.test(p)) continue;
    // 近重复：新句被已有句包含则跳过；已有短句被新句覆盖则替换
    let replaced = false;
    for (const prev of [...seen]) {
      if (prev === key) {
        replaced = true;
        break;
      }
      if (key.length >= 24 && prev.includes(key)) {
        replaced = true;
        break;
      }
      if (prev.length >= 24 && key.includes(prev)) {
        const idx = deduped.findIndex((d) => normalizeActionDedupeKey(d) === prev);
        if (idx >= 0) {
          seen.delete(prev);
          seen.add(key);
          deduped[idx] = p;
          replaced = true;
        }
        break;
      }
    }
    if (replaced) continue;
    seen.add(key);
    deduped.push(p);
  }
  const raw = deduped.join('\n');
  // 弹幕/屏字 overlay 的双引号条目必须保留；scrubH3SpeechLeak 会清掉所有引号串
  return {
    text: isDramaScreenTextVisual(visual)
      ? raw
      : scrubH3SpeechLeak(raw, { allowedSpoken: spoken ? [spoken] : [] }),
    cam: '',
  };
}

function buildLensBindAndStyleZh(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): string {
  const slots = listDramaShotRefImageSlots(session, shot);
  const audios = listDramaShotRefAudioSlots(session, shot);
  const style = resolveDramaShotVisualStylePrompt(session, shot);
  const lines: string[] = ['【参考对应】'];
  if (slots.length) {
    if (slots.some((s) => s.role === 'storyboard')) {
      lines.push(
        '<Picture 1> 是本镜分镜：构图、画风、光色与场景以该图为准；其后人物/道具/生物只锁身份。开场即该景别，禁止从更远全景拉近。',
      );
    } else if (slots.some((s) => s.role === 'scene')) {
      lines.push(
        '<Picture 1> 是场景空间锚点：保持同一空间结构、材质与渲染；人物参考图只锁外貌。',
      );
    } else {
      lines.push(
        '<Picture 1> 是首帧与视觉锚点。后续镜头保持同一空间结构、材质与渲染，不改风格、不重上色。',
      );
    }
    for (const slot of slots) {
      const pic = `<Picture ${slot.index}>`;
      const sub =
        resolved.subjects.find((s) => s.pictureTag === pic) ||
        (slot.role === 'scene' && resolved.sceneSubject?.pictureTag === pic
          ? resolved.sceneSubject
          : null);
      const roleZh = REF_ROLE_ZH[slot.role] || slot.role;
      const arrow = sub ? ` → ${sub.tag}（${sub.sn}）${sub.name}` : '';
      lines.push(`图${slot.index} ${pic}：${slot.name || '未命名'}（${roleZh}参考图）${arrow}`);
    }
  } else {
    lines.push('本镜尚未绑定参考图；主体仍按下方名称对应，出片前请先挂角色卡/场景卡。');
    for (const s of resolved.subjects) {
      lines.push(`${s.tag}（${s.sn}）${s.name} ← ${s.pictureTag}`);
    }
    if (resolved.sceneSubject && !resolved.subjects.includes(resolved.sceneSubject)) {
      const s = resolved.sceneSubject;
      lines.push(`${s.tag}（${s.sn}）${s.name} ← ${s.pictureTag}`);
    }
  }
  if (audios.length) {
    for (const a of audios) {
      const role = resolveDramaVoiceRole(a.character_id, a.character_name);
      if (role === 'system') {
        lines.push(`<Audio ${a.index}>：系统声（无 Picture / 无 Subject）`);
        continue;
      }
      if (role === 'narrator') {
        lines.push(`<Audio ${a.index}>：旁白（无 Picture / 无 Subject）`);
        continue;
      }
      const sub = resolved.subjectByCharacterId.get(a.character_id);
      const who = sub ? `${sub.tag}（${sub.sn}）${sub.name}` : a.character_name;
      lines.push(`<Audio ${a.index}>：${who} 的音色参考`);
    }
  } else {
    lines.push('本镜说话实体缺少参考音；禁止用其他角色声音顶替。');
  }

  lines.push('', '【主体定义】');
  for (const s of resolved.subjects.filter((x) => x.role === 'character')) {
    const ch = (session.bible?.characters || []).find((c) => c.character_id === s.character_id);
    lines.push(
      `${s.tag}（${s.sn}）是${s.name}，外貌锁定 ${s.pictureTag}：${characterLookZh(ch)}。`,
    );
  }
  if (resolved.sceneSubject) {
    const s = resolved.sceneSubject;
    const look = /environment locked/i.test(s.look) ? '以参考图空间为准' : s.look;
    lines.push(`${s.tag}（${s.sn}）是${s.name}环境，空间锁定 ${s.pictureTag}：${look}。`);
  }
  for (const s of resolved.subjects.filter((x) => x.role === 'prop')) {
    lines.push(`${s.tag}（${s.sn}）是道具${s.name}，外观锁定 ${s.pictureTag || '无参考图'}。`);
  }
  for (const s of resolved.subjects.filter((x) => x.role === 'creature')) {
    lines.push(`${s.tag}（${s.sn}）是生物${s.name}，外观锁定 ${s.pictureTag || '无参考图'}。`);
  }

  if (style.body) {
    lines.push('', '【视觉风格】');
    if (style.name) lines.push(`方案：${style.name}`);
    lines.push(style.body);
    lines.push('全片只在此声明一次风格；后面镜头只写机位、动作与表演，不要改风格。');
  }

  return lines.join('\n').trim();
}

function speakIdForCharacter(vocal: DramaVocalSpeakers, characterId?: string): number {
  const id = String(characterId || '').trim();
  if (id && vocal.byCharacterId.has(id)) return vocal.byCharacterId.get(id) || 0;
  return 0;
}

function buildSubjectDefinitions(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
  vocal: DramaVocalSpeakers,
): string {
  const lines: string[] = ['subject_definitions:'];
  const imgSlots = listDramaShotRefImageSlots(session, shot);
  for (const slot of imgSlots) {
    const pic = `<Picture ${slot.index}>`;
    const matched =
      resolved.subjects.find((s) => s.pictureTag === pic) ||
      (slot.role === 'scene' && resolved.sceneSubject?.pictureTag === pic
        ? resolved.sceneSubject
        : null);
    if (slot.role === 'scene') {
      const look = sceneLookEn(session, shot, matched || resolved.sceneSubject);
      lines.push(
        `${pic} is the environment spatial and material anchor${look ? `: ${look}` : ''}.`,
      );
    } else if (matched) {
      const look = retentionLookEn(matched.look, pic, matched.role || slot.role);
      if (slot.role === 'character') {
        lines.push(
          `${pic} is the character appearance reference for ${matched.tag}: ${look}. Use clothing/face/hair only; discard any white, blank, or studio backdrop from ${pic}.`,
        );
      } else {
        lines.push(
          `${pic} is the ${slot.role} appearance reference for ${matched.tag}: ${look}.`,
        );
      }
    } else {
      lines.push(`${pic} is the ${slot.role} reference.`);
    }
  }
  if (!imgSlots.length) {
    lines.push('<Picture 1> is the first-frame spatial, material, and composition anchor.');
  }
  const chars = resolved.subjects.filter((s) => s.role === 'character');
  for (const s of chars) {
    // Picture 行已写外貌；Subject 只保留绑定，不重复 look
    lines.push(
      `${s.tag} is the character referenced by ${s.pictureTag || 'no appearance reference'}.`,
    );
  }
  if (resolved.sceneSubject) {
    const s = resolved.sceneSubject;
    lines.push(
      `${s.tag} is the environment referenced by ${s.pictureTag || 'no appearance reference'}.`,
    );
  }
  for (const s of resolved.subjects.filter((x) => x.role === 'prop')) {
    lines.push(
      `${s.tag} is the prop referenced by ${s.pictureTag || 'no appearance reference'}.`,
    );
  }
  for (const s of resolved.subjects.filter((x) => x.role === 'creature')) {
    lines.push(
      `${s.tag} is the creature referenced by ${s.pictureTag || 'no appearance reference'}.`,
    );
  }
  chars.forEach((s) => {
    const bound = s.character_id ? audioIndexForCharacter(session, shot, s.character_id) : 0;
    const sid = speakIdForCharacter(vocal, s.character_id);
    const sidBit = sid > 0 ? ` ${formatSpeakId(sid)}` : '';
    if (bound > 0) {
      lines.push(
        `<Audio ${bound}> is the voice-timbre reference for ${s.tag}${sidBit}.`,
      );
      return;
    }
    lines.push(
      `${s.tag} MISSING VOICE. Do not copy another subject's voice. Do not use system or narrator Audio.`,
    );
  });
  const sysN = audioIndexForSystem(session, shot);
  const narN = audioIndexForNarrator(session, shot);
  const sysSid = formatSpeakId(vocal.systemSpeakId);
  const narSid = formatSpeakId(vocal.narratorSpeakId);
  if (dramaShotHasSystemDialogue(session, shot) || sysN > 0) {
    if (sysN > 0) {
      lines.push(
        `System Voice = <Audio ${sysN}> (Picture = NONE, Subject = NONE); voice-timbre for off-screen system voice${sysSid ? ` ${sysSid}` : ''}. Never assign to any visible character.`,
      );
    } else {
      lines.push(
        'System Voice = MISSING VOICE (Picture = NONE, Subject = NONE). Speak as voice-over only; never use character Audio.',
      );
    }
  }
  if (dramaShotHasNarratorDialogue(session, shot) || narN > 0) {
    if (narN > 0) {
      lines.push(
        `Narrator Voice = <Audio ${narN}> (Picture = NONE, Subject = NONE); voice-timbre for off-screen narrator${narSid ? ` ${narSid}` : ''}. Never assign to any visible character.`,
      );
    } else {
      lines.push(
        'Narrator Voice = MISSING VOICE (Picture = NONE, Subject = NONE). Speak as voice-over only; never use character Audio.',
      );
    }
  }
  return lines.join('\n');
}

function buildSummary(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
  vocal: DramaVocalSpeakers,
): string {
  const chars = resolved.subjects.filter((s) => s.role === 'character');
  const who = chars.map((s) => s.tag).join(' and ');
  const scene = resolved.sceneSubject ? ` at ${resolved.sceneSubject.tag}` : '';
  const charBits = chars
    .map((s) => {
      const n = s.character_id ? audioIndexForCharacter(session, shot, s.character_id) : 0;
      if (n <= 0) return '';
      const sid = speakIdForCharacter(vocal, s.character_id);
      return `<Audio ${n}> as the voice-timbre reference for ${s.tag}${sid > 0 ? ` ${formatSpeakId(sid)}` : ''}`;
    })
    .filter(Boolean);
  const sysN = audioIndexForSystem(session, shot);
  const narN = audioIndexForNarrator(session, shot);
  if (sysN > 0) {
    const sid = formatSpeakId(vocal.systemSpeakId);
    charBits.push(
      `<Audio ${sysN}> as the voice-timbre reference for the off-screen system voice${sid ? ` ${sid}` : ''}`,
    );
  }
  if (narN > 0) {
    const sid = formatSpeakId(vocal.narratorSpeakId);
    charBits.push(
      `<Audio ${narN}> as the voice-timbre reference for the off-screen narrator${sid ? ` ${sid}` : ''}`,
    );
  }
  return [
    'summary:',
    who
      ? `${who}${scene}. Voices: ${charBits.join('; ') || 'described voice-timbres'}. System/narrator never use character Audio.`
      : 'Scene stays in <Picture 1> visual space.',
  ].join('\n');
}

function buildRetention(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
  shotCount: number,
): string {
  const allShots = Array.from({ length: Math.max(1, shotCount) }, (_, i) => `[Shot ${i + 1}]`).join('');
  const imgSlots = listDramaShotRefImageSlots(session, shot);
  const lines: string[] = ['retention_analysis:'];
  const pictured = new Set<string>();
  if (imgSlots.length) {
    for (const slot of imgSlots) {
      const pic = `<Picture ${slot.index}>`;
      pictured.add(pic);
      const matched =
        resolved.subjects.find((s) => s.pictureTag === pic) ||
        (slot.role === 'scene' && resolved.sceneSubject?.pictureTag === pic
          ? resolved.sceneSubject
          : null);
      if (slot.role === 'scene' || matched?.role === 'scene') {
        const look = sceneLookEn(session, shot, matched || resolved.sceneSubject);
        lines.push(
          `${pic} (appears in ${allShots}): fully_preserved - ${look}.`,
        );
      } else if (matched) {
        const look = retentionLookEn(matched.look, pic, matched.role || slot.role);
        lines.push(
          `${pic} (appears in ${allShots}): fully_preserved - ${look}.`,
        );
      } else {
        const role = slot.role as DramaLensSubject['role'];
        lines.push(
          `${pic} (appears in ${allShots}): fully_preserved - ${retentionLookEn('', pic, role)}.`,
        );
      }
    }
  } else {
    lines.push(
      `<Picture 1> ([Shot 1] first frame): fully_preserved - the opening frame composition, visible scene structure, materials, and rendering are retained.`,
    );
  }
  for (const s of resolved.subjects) {
    if (s.pictureTag && pictured.has(s.pictureTag)) {
      // Picture 行已写外貌；Subject 行只补 identity 绑定
      lines.push(
        `${s.tag} (appears in ${allShots}): identity locked to ${s.pictureTag}.`,
      );
      continue;
    }
    const look =
      s.role === 'scene'
        ? sceneLookEn(session, shot, s)
        : retentionLookEn(s.look, s.pictureTag || '', s.role);
    lines.push(
      `${s.tag} (appears in ${allShots}): fully_preserved - ${look}.`,
    );
  }
  const chars = resolved.subjects.filter((x) => x.role === 'character');
  chars.forEach((s) => {
    const n = s.character_id ? audioIndexForCharacter(session, shot, s.character_id) : 0;
    if (n > 0) {
      lines.push(
        `<Audio ${n}>: voice-timbre reference for ${s.tag} (do not use for narration).`,
      );
    }
  });
  const sysN = audioIndexForSystem(session, shot);
  if (sysN > 0) {
    lines.push(
      `<Audio ${sysN}>: voice-timbre reference for off-screen system voice; never assign to a visible character.`,
    );
  }
  const narN = audioIndexForNarrator(session, shot);
  if (narN > 0) {
    lines.push(
      `<Audio ${narN}>: voice-timbre reference for off-screen narrator; never assign to a visible character.`,
    );
  }
  return lines.join('\n');
}

function buildSoundscape(
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
  hasDialogue: boolean,
  hasOffscreen = false,
  timelineFoley: string[] = [],
): string {
  const names = resolved.subjects
    .filter((s) => s.role === 'character')
    .map((s) => s.tag)
    .filter(Boolean)
    .join(' and ');
  const foleyEn = toH3SilentFoleyEnglish(timelineFoley);
  const ambience =
    foleyEn.length > 0
      ? `Ambient bed and diegetic foley stay under dialogue: ${foleyEn.join('; ')}.`
      : 'Ambient bed is quiet room tone, soft cloth/foot movement, and held silence under speech.';
  let spoken = '';
  if (hasDialogue && hasOffscreen) {
    spoken = ` Spoken channels: character dialogue from ${names || 'the on-screen subject'}, plus off-screen system voice and/or narrator voice-over. Off-screen lines are never spoken by visible characters.`;
  } else if (hasDialogue) {
    spoken = ` Spoken dialogue${names ? ` from ${names}` : ''} remains the loudest layer; ambience never overpowers lines.`;
  } else {
    spoken = ' No spoken dialogue in this sequence.';
  }
  return ['overall_soundscape:', `${ambience}${spoken}`].join('\n');
}

function buildHardConstraintsEn(hasSystem: boolean): string {
  return [
    PIC1_LOCK_EN,
    hasSystem ? SPEECH_RULE_EN_WITH_SYSTEM : SPEECH_RULE_EN,
    SUBJECT_RULES,
    hasSystem ? SYSTEM_VOICE_ASSIGN_EN : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildHardConstraintsZh(hasSystem: boolean): string {
  return [
    PIC1_LOCK_ZH,
    hasSystem ? SPEECH_RULE_ZH_WITH_SYSTEM : SPEECH_RULE_ZH,
    SUBJECT_RULES_ZH,
    hasSystem ? SYSTEM_VOICE_ASSIGN_ZH : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildSubjectDefinitionsZh(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
  vocal: DramaVocalSpeakers,
): string {
  const lines: string[] = ['主体定义：'];
  const imgSlots = listDramaShotRefImageSlots(session, shot);
  for (const slot of imgSlots) {
    const pic = `<Picture ${slot.index}>`;
    const matched =
      resolved.subjects.find((s) => s.pictureTag === pic) ||
      (slot.role === 'scene' && resolved.sceneSubject?.pictureTag === pic
        ? resolved.sceneSubject
        : null);
    const roleZh = REF_ROLE_ZH[slot.role] || slot.role;
    if (slot.role === 'scene') {
      const look =
        matched?.look && !/environment locked/i.test(matched.look)
          ? matched.look
          : '按参考图空间结构、材质与光色';
      lines.push(`${pic} 是环境空间与材质锚点：${look}。`);
    } else if (matched) {
      const ch =
        matched.role === 'character'
          ? (session.bible?.characters || []).find((c) => c.character_id === matched.character_id)
          : undefined;
      const look =
        matched.role === 'character' ? characterLookZh(ch) : trimLine(matched.look) || '按参考图外貌';
      if (slot.role === 'character') {
        lines.push(
          `${pic} 是 ${matched.tag} 的人物外观参考：${look}。仅用服装/脸/发；丢弃 ${pic} 的白底/棚拍背景。`,
        );
      } else {
        lines.push(`${pic} 是 ${matched.tag} 的${roleZh}外观参考：${look}。`);
      }
    } else {
      lines.push(`${pic} 是${roleZh}参考。`);
    }
  }
  if (!imgSlots.length) {
    lines.push('<Picture 1> 是首帧空间、材质与构图锚点。');
  }
  for (const s of resolved.subjects.filter((x) => x.role === 'character')) {
    lines.push(
      `${s.tag} 是角色「${s.name}」，外貌锁定 ${s.pictureTag || '无外观参考'}。`,
    );
  }
  if (resolved.sceneSubject) {
    const s = resolved.sceneSubject;
    lines.push(`${s.tag} 是环境「${s.name}」，空间锁定 ${s.pictureTag || '无参考'}。`);
  }
  for (const s of resolved.subjects.filter((x) => x.role === 'prop')) {
    lines.push(`${s.tag} 是道具「${s.name}」，外观锁定 ${s.pictureTag || '无参考图'}。`);
  }
  for (const s of resolved.subjects.filter((x) => x.role === 'creature')) {
    lines.push(`${s.tag} 是生物「${s.name}」，外观锁定 ${s.pictureTag || '无参考图'}。`);
  }
  for (const s of resolved.subjects.filter((x) => x.role === 'character')) {
    const bound = s.character_id ? audioIndexForCharacter(session, shot, s.character_id) : 0;
    const sid = speakIdForCharacter(vocal, s.character_id);
    const sidBit = sid > 0 ? ` ${formatSpeakId(sid)}` : '';
    if (bound > 0) {
      lines.push(`<Audio ${bound}> 是 ${s.tag}${sidBit} 的音色参考。`);
    } else {
      lines.push(`${s.tag} MISSING VOICE。禁止套用其他角色声音，禁止使用系统/旁白 Audio。`);
    }
  }
  const sysN = audioIndexForSystem(session, shot);
  const narN = audioIndexForNarrator(session, shot);
  if (dramaShotHasSystemDialogue(session, shot) || sysN > 0) {
    if (sysN > 0) {
      lines.push(
        `系统声 = <Audio ${sysN}>（Picture = NONE，Subject = NONE）；画外系统声${formatSpeakId(vocal.systemSpeakId) ? ` ${formatSpeakId(vocal.systemSpeakId)}` : ''} 音色参考，禁止分配给可见角色。`,
      );
    } else {
      lines.push('系统声 = MISSING VOICE（Picture = NONE，Subject = NONE）。');
    }
  }
  if (dramaShotHasNarratorDialogue(session, shot) || narN > 0) {
    if (narN > 0) {
      lines.push(
        `旁白 = <Audio ${narN}>（Picture = NONE，Subject = NONE）；画外旁白${formatSpeakId(vocal.narratorSpeakId) ? ` ${formatSpeakId(vocal.narratorSpeakId)}` : ''} 音色参考，禁止分配给可见角色。`,
      );
    } else {
      lines.push('旁白 = MISSING VOICE（Picture = NONE，Subject = NONE）。');
    }
  }
  return lines.join('\n');
}

function buildSummaryZh(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
  vocal: DramaVocalSpeakers,
): string {
  const chars = resolved.subjects.filter((s) => s.role === 'character');
  const who = chars.map((s) => `${s.tag}（${s.name}）`).join('、');
  const scene = resolved.sceneSubject
    ? `，场景 ${resolved.sceneSubject.tag}（${resolved.sceneSubject.name}）`
    : '';
  const audioBits = chars
    .map((s) => {
      const n = s.character_id ? audioIndexForCharacter(session, shot, s.character_id) : 0;
      if (n <= 0) return '';
      return `<Audio ${n}> 作为 ${s.tag} 音色参考`;
    })
    .filter(Boolean);
  const sysN = audioIndexForSystem(session, shot);
  const narN = audioIndexForNarrator(session, shot);
  if (sysN > 0) audioBits.push(`<Audio ${sysN}> 作为画外系统声音色参考`);
  if (narN > 0) audioBits.push(`<Audio ${narN}> 作为画外旁白音色参考`);
  void vocal;
  return [
    '概述：',
    who
      ? `${who}${scene}。音色：${audioBits.join('；') || '描述音色'}。系统声与旁白永不使用角色 Audio。`
      : '本镜保持在 <Picture 1> 视觉空间内。',
  ].join('\n');
}

function buildRetentionZh(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
  shotCount: number,
): string {
  const allShots = Array.from({ length: Math.max(1, shotCount) }, (_, i) => `[镜头 ${i + 1}]`).join('');
  const imgSlots = listDramaShotRefImageSlots(session, shot);
  const lines: string[] = ['内容保留分析：'];
  const pictured = new Set<string>();
  if (imgSlots.length) {
    for (const slot of imgSlots) {
      const pic = `<Picture ${slot.index}>`;
      pictured.add(pic);
      const matched =
        resolved.subjects.find((s) => s.pictureTag === pic) ||
        (slot.role === 'scene' && resolved.sceneSubject?.pictureTag === pic
          ? resolved.sceneSubject
          : null);
      if (slot.role === 'scene' || matched?.role === 'scene') {
        lines.push(
          `${pic}（出现于 ${allShots}）：完全保留 — ${retentionLookZh('scene', pic)}。`,
        );
      } else if (matched) {
        lines.push(
          `${pic}（出现于 ${allShots}）：完全保留 — ${retentionLookZh(matched.role, pic)}。`,
        );
      } else {
        const role = (slot.role as DramaLensSubject['role']) || 'character';
        lines.push(`${pic}（出现于 ${allShots}）：完全保留 — ${retentionLookZh(role, pic)}。`);
      }
    }
  } else {
    lines.push('<Picture 1>（[镜头 1] 首帧）：完全保留 — 起幅构图、场景结构、材质与渲染。');
  }
  for (const s of resolved.subjects) {
    if (s.pictureTag && pictured.has(s.pictureTag)) {
      lines.push(
        `${s.tag}（出现于 ${allShots}）：身份锁定 ${s.pictureTag}。`,
      );
      continue;
    }
    lines.push(
      `${s.tag}（出现于 ${allShots}）：完全保留 — ${s.pictureTag ? `锁定 ${s.pictureTag}` : '按文案身份'}。`,
    );
  }
  void session;
  void shot;
  return lines.join('\n');
}

function buildSoundscapeZh(
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
  hasDialogue: boolean,
  hasOffscreen = false,
  timelineFoley: string[] = [],
): string {
  const names = resolved.subjects
    .filter((s) => s.role === 'character')
    .map((s) => s.tag)
    .filter(Boolean)
    .join('、');
  const foley = timelineFoley.map(trimLine).filter(Boolean);
  const ambience = foley.length
    ? `环境底噪与剧情拟音压在对白之下：${foley.join('；')}。`
    : '环境底噪为安静室内声、轻布料/脚步与对白下的静默。';
  let spoken = '';
  if (hasDialogue && hasOffscreen) {
    spoken = ` 人声通道：${names || '在场主体'} 的角色对白，外加画外系统声与/或旁白。画外句不得由可见人物口型说出。`;
  } else if (hasDialogue) {
    spoken = ` ${names ? `来自 ${names} 的` : ''}角色对白始终为最响层；环境音不得盖过台词。`;
  } else {
    spoken = ' 本序列无对白。';
  }
  return ['整体声景：', `${ambience}${spoken}`].join('\n');
}

function spokenTurnsFromTimelineEvent(
  ev: DramaTimelineEvent,
  speakers: DramaSpeakerRef[],
): { visual: string; turns: Array<{ name: string; character_id: string; line: string }> } {
  const peeled = peelSystemSpokenFromTimelineVisual(ev.visual_action, ev.dialogue);
  let visual = isDramaScreenTextVisual(peeled.visual)
    ? peeled.visual
    : cleanDramaMappedVisualAction(stripTimelineCutChineseDecorators(peeled.visual));
  if (isDramaNarrationVisual(visual)) visual = '';
  const dlgRaw = trimLine(peeled.dialogue);
  if (isDramaSceneTransitionText(dlgRaw)) {
    return { visual, turns: [] };
  }
  if (isDramaInnerOsCue(dlgRaw) || isDramaInnerOsCue(String(ev.expression || ''))) {
    return { visual, turns: [] };
  }
  const roleFromLine = resolveSpokenLineVoiceRole(
    trimLine(ev.dialogue_character_id),
    '',
    dlgRaw || ev.dialogue,
  );
  const role =
    roleFromLine !== 'character'
      ? roleFromLine
      : looksLikeDramaSystemSpokenText(ev.visual_action) ||
          looksLikeDramaInMindSystemVoice(ev.visual_action)
        ? 'system'
        : isDramaNarrationVisual(ev.visual_action) || isDramaNarrationVisual(ev.dialogue)
          ? 'system'
          : 'character';
  const offscreen = role === 'system' || role === 'narrator';
  const speakerNames = speakers.map((s) => String(s.name || '').trim()).filter(Boolean);
  const dlg = offscreen
    ? trimLine(stripDramaNarrationLabel(stripDramaSystemSpokenLabel(dlgRaw)))
    : stripDramaSpokenLineBody(dlgRaw, speakerNames);
  if (role === 'system' && dlg) {
    visual = ensureDramaSystemHologramVisual(visual, true);
  }
  if (!dlg) return { visual, turns: [] };
  // 对白切段：丢掉整段镜级 action 回填 / 说话人标签污染；保留剥掉对白后的真实动作
  if (isDialogueBeatActionDump(visual, dlg)) {
    const peeledAct = tidyDramaTimelineVisualAction(
      cleanDramaMappedVisualAction(
        stripTimelineCutChineseDecorators(
          visual
            .split(dlg)
            .join(' ')
            .replace(/[「」""]/g, ' ')
            .replace(/(?:^|\n)\s*\S{1,12}\s*[：:]\s*(?:\n|$)/g, '\n'),
        ),
      ),
    );
    visual =
      peeledAct && !isDialogueBeatActionDump(peeledAct, dlg) && !isSparseDramaVisualForDirecting(peeledAct)
        ? peeledAct
        : '';
  }
  const forcedId =
    role === 'system'
      ? DRAMA_SYSTEM_SPEAKER_ID
      : role === 'narrator'
        ? DRAMA_NARRATOR_SPEAKER_ID
        : trimLine(ev.dialogue_character_id);
  const forcedName = role === 'system' ? '系统' : role === 'narrator' ? '旁白' : '';
  const synthetic: DramaTimelineEvent = {
    ...ev,
    visual_action: visual,
    dialogue: dlg,
    dialogue_character_id: forcedId,
  };
  const split = collectDramaEventSpokenTurns(synthetic, speakers, '');
  if (split.turns.length) {
    return {
      visual,
      turns: split.turns.map((t) =>
        offscreen
          ? { ...t, character_id: forcedId, name: forcedName || t.name }
          : {
              ...t,
              line: stripDramaSpokenLineBody(t.line, speakerNames) || t.line,
            },
      ),
    };
  }
  // 禁止回退脏原文进 <d>
  return {
    visual,
    turns: [
      {
        name: forcedName,
        character_id: forcedId,
        line: dlg,
      },
    ],
  };
}

/** 对白 Shot 上的 visual 是否其实是整段 action/说话人标签污染 */
function isDialogueBeatActionDump(visual: string, dialogue: string): boolean {
  const v = trimLine(visual);
  if (!v) return false;
  const dlg = trimLine(dialogue);
  if (dlg && v.includes(dlg)) return true;
  // 多行且含「角色名：」说话人行 → 整段剧本回填
  if (/\n/.test(v) && /(?:^|\n)\s*\S{1,12}\s*[：:]\s*(?:\n|$)/.test(v)) return true;
  if (/\n/.test(v) && /[「」]/.test(v)) return true;
  // 仅说话人标签残留（译成 Subject + 冒号）
  if (/^(?:<Subject\s+\d+(?:\s*\(S\d+\))?>\s*[：:]\s*)+$/i.test(v)) return true;
  return false;
}

function resolveDramaVocalSpeakers(
  session: DramaDirectorSession,
  shot: DramaShot,
  speakers: DramaSpeakerRef[],
): DramaVocalSpeakers {
  const byCharacterId = new Map<string, number>();
  // SpeakId = Subject 序号（speakers 已按 Subject 序）；禁止按开口先后把 Subject 3 标成 (S2)
  speakers.forEach((sp, i) => {
    const id = trimLine(sp.character_id);
    if (id && !byCharacterId.has(id)) byCharacterId.set(id, i + 1);
  });
  let systemSpeakId = 0;
  let narratorSpeakId = 0;
  let next = Math.max(speakers.length, byCharacterId.size) + 1;
  const takeOffscreen = (cid: string, name: string, line: string) => {
    if (!trimLine(line)) return;
    const role = resolveSpokenLineVoiceRole(cid, name, line);
    if (role === 'system') {
      if (!systemSpeakId) systemSpeakId = next++;
      return;
    }
    if (role === 'narrator') {
      if (!narratorSpeakId) narratorSpeakId = next++;
    }
  };
  const events = [...(shot.timeline_events || [])].sort(
    (a, b) => (Number(a.start_sec) || 0) - (Number(b.start_sec) || 0),
  );
  for (const ev of events) {
    for (const turn of spokenTurnsFromTimelineEvent(ev, speakers).turns) {
      takeOffscreen(turn.character_id, turn.name, turn.line);
    }
  }
  if (!systemSpeakId && dramaShotHasSystemDialogue(session, shot)) {
    systemSpeakId = next++;
  }
  if (!narratorSpeakId && dramaShotHasNarratorDialogue(session, shot)) {
    narratorSpeakId = next++;
  }
  return { byCharacterId, systemSpeakId, narratorSpeakId };
}

function formatEnglishDialogueLines(
  session: DramaDirectorSession,
  shot: DramaShot,
  turns: Array<{ name: string; character_id: string; line: string }>,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
  vocal: DramaVocalSpeakers,
): string[] {
  return turns
    .map((turn) => {
      const role = resolveSpokenLineVoiceRole(turn.character_id, turn.name, turn.line);
      if (role === 'system') {
        return formatOffscreenSpokenBlock(
          'system',
          turn.line,
          audioIndexForSystem(session, shot),
          vocal.systemSpeakId,
        );
      }
      if (role === 'narrator') {
        return formatOffscreenSpokenBlock(
          'narrator',
          turn.line,
          audioIndexForNarrator(session, shot),
          vocal.narratorSpeakId,
        );
      }
      const who = resolveSpokenWho(turn, resolved);
      if (who) {
        return formatSpokenBlock(
          who,
          turn.line,
          who.character_id ? audioIndexForCharacter(session, shot, who.character_id) : 0,
          speakIdForCharacter(vocal, who.character_id),
        );
      }
      if (looksLikeDramaSystemSpokenText(turn.line) || looksLikeDramaInMindSystemVoice(turn.line)) {
        return formatOffscreenSpokenBlock(
          'system',
          turn.line,
          audioIndexForSystem(session, shot),
          vocal.systemSpeakId,
        );
      }
      if (isDramaNarrationVisual(turn.line)) {
        return formatOffscreenSpokenBlock(
          'narrator',
          turn.line,
          audioIndexForNarrator(session, shot),
          vocal.narratorSpeakId,
        );
      }
      return '';
    })
    .filter(Boolean);
}

function formatChineseDialogueLines(
  session: DramaDirectorSession,
  shot: DramaShot,
  turns: Array<{ name: string; character_id: string; line: string }>,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
  vocal: DramaVocalSpeakers,
  visual: string,
  prevSpeakerId: string,
): { lines: string[]; lastSpeakerId: string } {
  const out: string[] = [];
  let last = prevSpeakerId;
  turns.forEach((turn, ti) => {
    const role = resolveSpokenLineVoiceRole(turn.character_id, turn.name, turn.line);
    if (role === 'system' || role === 'narrator') {
      const off = formatOffscreenSpokenProductionZh(
        role,
        turn.line,
        role === 'system' ? audioIndexForSystem(session, shot) : audioIndexForNarrator(session, shot),
        role === 'system' ? vocal.systemSpeakId : vocal.narratorSpeakId,
      );
      if (off) out.push(off);
      last = role;
      return;
    }
    const who = resolveSpokenWho(turn, resolved);
    if (!who) {
      if (looksLikeDramaSystemSpokenText(turn.line) || looksLikeDramaInMindSystemVoice(turn.line)) {
        const sys = formatOffscreenSpokenProductionZh(
          'system',
          turn.line,
          audioIndexForSystem(session, shot),
          vocal.systemSpeakId,
        );
        if (sys) out.push(sys);
        last = 'system';
      } else if (isDramaNarrationVisual(turn.line)) {
        const nar = formatOffscreenSpokenProductionZh(
          'narrator',
          turn.line,
          audioIndexForNarrator(session, shot),
          vocal.narratorSpeakId,
        );
        if (nar) out.push(nar);
        last = 'narrator';
      }
      return;
    }
    const audioN = who.character_id
      ? audioIndexForCharacter(session, shot, who.character_id)
      : 0;
    const same = !!who.character_id && who.character_id === last && ti > 0;
    out.push(
      formatSpokenProductionZh(who, turn.line, audioN, {
        continued: same,
        visual,
        speakId: speakIdForCharacter(vocal, who.character_id),
      }),
    );
    last = who.character_id || '';
  });
  return { lines: out, lastSpeakerId: turns.length ? last : '' };
}

/** 提示词优化 / 上云用的英文 8 段 */
export function composeDramaShotH3EnglishPrompt(
  session: DramaDirectorSession,
  shot: DramaShot,
  opts?: { previousCompile?: string; durationSec?: number },
): string {
  const ready = applyDramaShotPromptBackfill(ensureDramaShotTimelineEvents(shot, session));
  const eventsRaw = [...(ready.timeline_events || [])]
    .sort((a, b) => (Number(a.start_sec) || 0) - (Number(b.start_sec) || 0))
    .filter(productionEventKeep);
  const srcDur = Math.max(
    Number(ready.duration_sec) || 0,
    ...eventsRaw.map((e) => Number(e.end_sec) || 0),
    0.1,
  );
  const dstDur = Number(opts?.durationSec);
  const scale =
    Number.isFinite(dstDur) && dstDur > 0.5 && Math.abs(dstDur - srcDur) > 0.15
      ? dstDur / srcDur
      : 1;
  const events =
    scale === 1
      ? eventsRaw
      : eventsRaw.map((e) => ({
          ...e,
          start_sec: (Number(e.start_sec) || 0) * scale,
          end_sec: (Number(e.end_sec) || 0) * scale,
        }));
  const resolved = resolveDramaLensSubjects(session, ready);
  const speakers: DramaSpeakerRef[] = resolved.subjects
    .filter((s) => s.role === 'character' && s.character_id)
    .map((s) => ({ name: s.name, character_id: String(s.character_id) }));
  const vocal = resolveDramaVocalSpeakers(session, ready, speakers);
  const hasSystem = dramaShotHasSystemDialogue(session, ready);
  const hasNarrator = dramaShotHasNarratorDialogue(session, ready);
  const hasOffscreen = hasSystem || hasNarrator;

  const shotActionFallback = (() => {
    const raw = tidyDramaTimelineVisualAction(
      cleanDramaMappedVisualAction(stripTimelineCutChineseDecorators(String(ready.action || ''))),
    );
    if (!raw || isPlaceholderDramaVisualAction(raw) || isSparseDramaVisualForDirecting(raw)) {
      return '';
    }
    return trimLine(visualToEnglish(raw, resolved.subjects));
  })();

  const shotBlocks = (events.length ? events : [undefined]).map((ev, i) => {
    const n = i + 1;
    if (!ev) {
      return `[Shot 1] The shot begins from <Picture 1>.`;
    }
    const t0 = formatDramaH3Clock(ev.start_sec);
    const cut = isCutEvent(ev, i) ? '[cut] ' : '';
    const open =
      n === 1
        ? `[Shot 1] The shot begins from <Picture 1>.`
        : `[Shot ${n}] At ${t0}, ${cut}the sequence continues in the same location.`;
    const split = spokenTurnsFromTimelineEvent(ev, speakers);
    const visual = eventVisualEnglish(split.visual, ev, resolved);
    const dlgBlocks = formatEnglishDialogueLines(session, ready, split.turns, resolved, vocal);
    const visible = formatVisibleLine(visibleSubjectsForEvent(ev, ready, resolved));
    const lip = formatLipSyncLine(split.turns, resolved);
    // 电影句顺序：动作/表演 → 台词(含说前说后) → Visible / Lip-sync
    const proseLines = visual.text
      .split('\n')
      .map(trimLine)
      .filter(Boolean);
    const hasDlg = dlgBlocks.some((b) => /<d>\s*\[Chinese/i.test(b));
    const proseKeep = dedupeActionChainLines(
      hasDlg ? proseLines.filter((line) => !/^Foley:\s*/i.test(line)) : proseLines,
    );
    const prose = proseKeep.join(' ');
    const dlgInline = dlgBlocks.map(trimLine).filter(Boolean).join(' ');
    // 对白且本段无画面动作：优先用镜级动作，禁止只剩「站定说话」
    const preBridge =
      hasDlg && !prose
        ? shotActionFallback ||
          'The speaker continues the visible physical action while delivering the line.'
        : '';
    const body = [prose || preBridge, dlgInline, visible, lip].filter(Boolean).join(' ');
    if (!body) return '';
    return [open, body].filter(Boolean).join(' ');
  }).filter(Boolean);

  const hasDialogue = shotBlocks.some((b) => /<d>\s*\[Chinese/i.test(b));
  const timelineFoley = events.flatMap((e) =>
    (e.environment_audio || []).map((x) => String(x || '').trim()).filter(Boolean),
  );
  const styleEn = resolveDramaShotVisualStylePrompt(session, ready);
  // 画风/色调铅字保持中文，不英译（H3 对白已是中文；风格句同语言更稳）
  const styleLead = styleEn.body
    ? [styleEn.name ? trimLine(styleEn.name) : '', trimLine(styleEn.body)]
        .filter(Boolean)
        .join('。')
    : '';
  return [
    buildHardConstraintsEn(hasOffscreen),
    '',
    buildSubjectDefinitions(session, ready, resolved, vocal),
    '',
    buildSummary(session, ready, resolved, vocal),
    '',
    buildRetention(session, ready, resolved, shotBlocks.length),
    '',
    'detailed_description:',
    styleLead || '',
    '',
    shotBlocks.join('\n\n'),
    '',
    buildSoundscape(resolved, hasDialogue, hasOffscreen, timelineFoley),
    '',
    'non_diegetic_music:',
    'N/A',
    '',
    NEGATIVE_LINE,
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 中文白话优化/生产稿（@图片 / 风格色调 / 剧情） */
export function isDramaZhPlainProductionPrompt(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    /@图片\s*\d+\s*是/.test(t) &&
    /风格色调\s*[：:]/.test(t) &&
    /剧情\s*[：:]/.test(t)
  );
}

/**
 * 生产上云 Prompt：
 * - 中文产品：优先图二类中文 Skill / 白话优化稿；禁止默认回退英文 subject_definitions（图一）
 * - 英文产品：才使用英文 Ref2VA 密封稿 / English Compiler
 */
export function resolveDramaProductionH3Prompt(
  session: DramaDirectorSession,
  shot: DramaShot,
  opts?: { durationSec?: number; locale?: string; previousCompile?: string },
): string {
  const sealed = String(shot.h3_skill_prompt || '').trim();
  const wantEn = /^en\b/i.test(String(opts?.locale || ''));

  // 图二：中文 Skill（retention_analysis / 中文六段）与中文白话优化稿
  if (sealed && isMinimaxH3ChineseSkillPrompt(sealed)) {
    return sealed;
  }
  if (sealed && isDramaZhPlainProductionPrompt(sealed)) {
    return sealed;
  }
  if (
    sealed &&
    /[\u4e00-\u9fff]/.test(sealed) &&
    sealed.length >= 40 &&
    (/retention_analysis\s*:/i.test(sealed) ||
      /detailed[_\s-]*description\s*:/i.test(sealed) ||
      /主体定义\s*[：:]/.test(sealed) ||
      /@图片\s*\d+\s*是/.test(sealed))
  ) {
    return sealed;
  }

  // 仅英文 UI：英文 Ref2VA 密封稿
  if (wantEn && sealed && isDramaH3AntiCrosstalkPrompt(sealed)) {
    return sealed;
  }

  // 中文产品缺优化稿：回退中文白话 Compiler，绝不发图一英文八段
  if (!wantEn) {
    return composeDramaShotLensTaggedPrompt(session, shot);
  }
  return composeDramaShotH3EnglishPrompt(session, shot, opts);
}

/**
 * 本地官方格式密封（无 LLM）：英文 Compiler → 守卫封口 → 写入 h3_skill_prompt。
 * Skill 失败时的回退；正式路径请用 buildDramaShotH3SkillOptimizeMessages。
 */
export function applyDramaShotH3OfficialSeal(
  session: DramaDirectorSession,
  shot: DramaShot,
  opts?: { durationSec?: number },
): DramaShot {
  const ready = applyDramaShotPromptBackfill(ensureDramaShotTimelineEvents(shot, session));
  const compiled = composeDramaShotH3EnglishPrompt(session, ready, opts);
  const sealed = sealDramaProductionCloudPrompt(compiled, {
    hasDialogue: dramaShotHasSpokenDialogue(ready),
    session,
    shot: ready,
  });
  return {
    ...ready,
    last_compiled_prompt: compiled,
    h3_skill_prompt: sealed,
    h3_skill_prompt_from: compiled,
  };
}

/**
 * 按「是否用分镜图作出片参考」轻量对齐提示词：只改参考对应 + 风格优先级句，不动剧情戏文。
 * 勾选：分镜锁构图/画风/光色/场景；未勾选：场景锁空间，画风跟已锁定文字。
 */
export function alignDramaProductionPromptRefMode(
  session: DramaDirectorSession,
  shot: DramaShot,
  sourcePrompt: string,
): string {
  const body = String(sourcePrompt || '').trim();
  if (!body) return body;
  const ready = applyDramaShotPromptBackfill(ensureDramaShotTimelineEvents(shot, session));
  if (
    isDramaZhPlainProductionPrompt(body) ||
    (/@图片\s*\d+\s*是/.test(body) && /风格色调\s*[：:]/.test(body))
  ) {
    return alignZhPlainProductionRefMode(session, ready, body);
  }
  if (isMinimaxH3ChineseSkillPrompt(body)) {
    return alignZhSkillProductionRefMode(session, ready, body);
  }
  if (/@Picture\s+\d+\s+is/i.test(body) && /Style\s*\/\s*tone\s*:/i.test(body)) {
    return alignEnPlainProductionRefMode(session, ready, body);
  }
  if (/retention_analysis\s*:/i.test(body) && /detailed_description\s*:/i.test(body)) {
    return alignEnSkillProductionRefMode(session, ready, body);
  }
  return scrubStaleStoryboardPriorityWording(
    body,
    isDramaShotUsingStoryboardAsVideoRef(ready),
  );
}

function buildDramaZhStyleBlockForRefMode(
  session: DramaDirectorSession,
  shot: DramaShot,
): string {
  const style = resolveDramaShotVisualStylePrompt(session, shot);
  const styleLine = trimLine(style.body) || trimLine(style.name) || '按已锁定画风色调';
  const need = styleLine.replace(/^需要/, '');
  if (isDramaShotUsingStoryboardAsVideoRef(shot)) {
    return `风格色调：以本镜分镜图画面为准（优先级高于下列文字）；文字仅补充：需要${need}。冲突时服从分镜图。开场景别与分镜主画面一致，禁止从更远全景/建立镜头拉近，禁止把分镜整页当建立镜头再推进。`.replace(
      /。。/g,
      '。',
    );
  }
  return `风格色调：需要${need}。`.replace(/。。$/, '。');
}

function buildDramaEnStyleBlockForRefMode(
  session: DramaDirectorSession,
  shot: DramaShot,
): string {
  const style = resolveDramaShotVisualStylePrompt(session, shot);
  const styleLine =
    trimLine(style.body) ||
    trimLine(style.name) ||
    'the locked look and color grade';
  const clean = styleLine.replace(/^needs?\s+/i, '').replace(/\.$/, '');
  if (isDramaShotUsingStoryboardAsVideoRef(shot)) {
    return `Style / tone: follow this shot's storyboard image for look and color (overrides text); text only supplements: ${clean}. On conflict, obey the storyboard. Open at the storyboard's framing — do not start wider and push/dolly in; do not treat a multi-panel page as an establishing shot.`;
  }
  return `Style / tone: ${clean}.`;
}

function alignZhPlainProductionRefMode(
  session: DramaDirectorSession,
  shot: DramaShot,
  body: string,
): string {
  const resolved = resolveDramaLensSubjects(session, shot);
  const bindings = buildSimplePictureBindingsZh(session, shot, resolved);
  const styleBlock = buildDramaZhStyleBlockForRefMode(session, shot);
  const plotMatch = body.match(/(^|\n)(剧情\s*[：:][\s\S]*)$/);
  if (plotMatch?.[2]) {
    return `${bindings}\n${styleBlock}\n${plotMatch[2]}`.replace(/\n{3,}/g, '\n\n').trim();
  }
  return `${bindings}\n${styleBlock}\n剧情：\n（本镜暂无剧情正文）`
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function alignEnPlainProductionRefMode(
  session: DramaDirectorSession,
  shot: DramaShot,
  body: string,
): string {
  const resolved = resolveDramaLensSubjects(session, shot);
  const bindings = buildSimplePictureBindingsEn(session, shot, resolved);
  const styleBlock = buildDramaEnStyleBlockForRefMode(session, shot);
  const plotMatch = body.match(/(^|\n)(Plot\s*:\s*[\s\S]*)$/i);
  if (plotMatch?.[2]) {
    return `${bindings}\n${styleBlock}\n${plotMatch[2]}`.replace(/\n{3,}/g, '\n\n').trim();
  }
  return `${bindings}\n${styleBlock}\nPlot:\n(No plot body for this shot yet)`
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildRetentionAnalysisLinesZh(
  session: DramaDirectorSession,
  shot: DramaShot,
): string[] {
  const slots = listDramaShotRefImageSlots(session, shot);
  const chars = session.bible?.characters || [];
  return slots.map((slot) => {
    const pic = `<Picture ${slot.index}>`;
    if (slot.role === 'storyboard') {
      return `${pic}：本镜分镜，构图/画风/光色/场景以该图为准；开场即该景别，禁止从远拉近`;
    }
    if (slot.role === 'scene') {
      return `${pic}：${slot.name || '场景'}，空间结构与材质以该图为准`;
    }
    if (slot.role === 'character') {
      const ch = chars.find((c) => c.character_id === slot.asset_id);
      return `${pic}：${slot.name || ch?.name || '角色'}，${characterLookZh(ch)}`;
    }
    if (slot.role === 'prop') {
      return `${pic}：道具「${slot.name || '未命名'}」，外观以该图为准`;
    }
    if (slot.role === 'creature') {
      return `${pic}：生物「${slot.name || '未命名'}」，外观以该图为准`;
    }
    return `${pic}：${slot.name || slot.role}`;
  });
}

function buildRetentionAnalysisLinesEn(
  session: DramaDirectorSession,
  shot: DramaShot,
): string[] {
  const slots = listDramaShotRefImageSlots(session, shot);
  return slots.map((slot) => {
    const pic = `<Picture ${slot.index}>`;
    if (slot.role === 'storyboard') {
      return `${pic}: this shot's storyboard — lock composition, look, color, and scene to the image; open at this framing, no far-to-near push-in.`;
    }
    if (slot.role === 'scene') {
      return `${pic}: scene "${slot.name || 'location'}" — lock spatial structure and materials to the image.`;
    }
    if (slot.role === 'character') {
      return `${pic}: character "${slot.name || 'cast'}" — lock face/hair/costume identity only.`;
    }
    if (slot.role === 'prop') {
      return `${pic}: prop "${slot.name || 'prop'}" — lock appearance to the image.`;
    }
    if (slot.role === 'creature') {
      return `${pic}: creature "${slot.name || 'creature'}" — lock appearance to the image.`;
    }
    return `${pic}: ${slot.name || slot.role}`;
  });
}

/** 从 retention 行解析稳定键 → Picture 序号，供戏文里 <Picture N> 重映射 */
function parseRetentionPictureKeys(raText: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const raw of String(raText || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/<Picture\s+(\d+)\>\s*[：:]\s*(.+)$/i);
    if (!m) continue;
    const index = Number(m[1]);
    if (!(index > 0)) continue;
    const rest = String(m[2] || '').trim();
    let key = '';
    if (/本镜分镜|storyboard/i.test(rest)) key = 'role:storyboard';
    else if (/^道具|:\s*prop\b/i.test(rest)) {
      key = `prop:${(rest.match(/[「"]([^」"]+)[」"]/) || [, rest])[1]}`.toLowerCase();
    } else if (/^生物|:\s*creature\b/i.test(rest)) {
      key = `creature:${(rest.match(/[「"]([^」"]+)[」"]/) || [, rest])[1]}`.toLowerCase();
    } else if (
      /空间结构|scene\s*"/i.test(rest) ||
      (/场景/.test(rest) && !/角色|人物/.test(rest))
    ) {
      const name = (rest.match(/^([^，,：:]+)/) || [, ''])[1].replace(/^场景/, '').trim();
      key = `scene:${name || rest}`.toLowerCase();
    } else {
      const name = (rest.match(/^([^，,：:]+)/) || [, ''])[1].trim();
      key = `char:${name}`.toLowerCase();
    }
    if (key && !map.has(key)) map.set(key, index);
  }
  return map;
}

function buildPictureIndexRemap(oldRa: string, newRa: string): Map<number, number> {
  const oldKeys = parseRetentionPictureKeys(oldRa);
  const newKeys = parseRetentionPictureKeys(newRa);
  const remap = new Map<number, number>();
  for (const [key, oldIdx] of oldKeys) {
    const neu = newKeys.get(key);
    if (neu != null && neu !== oldIdx) remap.set(oldIdx, neu);
  }
  return remap;
}

function remapPictureTagsInText(text: string, remap: Map<number, number>): string {
  if (!remap.size) return text;
  return String(text || '').replace(/<Picture\s+(\d+)\>/gi, (full, n) => {
    const old = Number(n);
    const neu = remap.get(old);
    return neu != null ? `<Picture ${neu}>` : full;
  });
}

function scrubStaleStoryboardPriorityWording(prompt: string, useSb: boolean): string {
  if (useSb) return String(prompt || '');
  let t = String(prompt || '');
  t = t
    .replace(/以本镜分镜图画面为准（优先级高于下列文字）；文字仅补充：/g, '需要')
    .replace(/冲突时服从分镜图[。.]?/g, '')
    .replace(/开场景别与分镜主画面一致[^。\n]*[。.]?/g, '')
    .replace(/画风(?:\/?光色)?以本镜分镜[^。\n]*[。.]?/g, '')
    .replace(/服从分镜图[。.]?/g, '')
    .replace(
      /follow this shot's storyboard image for look and color \(overrides text\); text only supplements:\s*/gi,
      '',
    )
    .replace(/On conflict, obey the storyboard\./gi, '')
    .replace(/Open at the storyboard's framing[^.]*\./gi, '')
    .replace(/以分镜为准[。.]?/g, '');
  return t;
}

/** 分镜作出片参考时：补一句景别硬锁，抑制默认「从远拉近」 */
function ensureDramaStoryboardFramingGuard(prompt: string): string {
  const body = String(prompt || '').trim();
  if (!body) return body;
  if (/开场景别与分镜|禁止从更远|no far-to-near|open at (?:this|the storyboard)/i.test(body)) {
    return body;
  }
  const line =
    '【分镜景别】开场即与分镜主画面同一景别与构图，禁止从更远全景/建立镜头拉近或推进；禁止把多格分镜页当建立镜头再扫入。';
  if (/风格色调\s*[：:][^\n]*/.test(body)) {
    return body.replace(/(风格色调\s*[：:][^\n]*)/, `$1\n${line}`);
  }
  if (/detailed_description\s*:/i.test(body)) {
    return body.replace(
      /(detailed_description\s*:\s*\n?)/i,
      `$1${line}\n`,
    );
  }
  return `${line}\n${body}`;
}

function replaceRetentionAnalysisBlock(body: string, newRaBody: string): string {
  if (!/retention_analysis\s*:/i.test(body)) return body;
  if (/detailed_description\s*:/i.test(body)) {
    return body.replace(
      /retention_analysis\s*:\s*[\s\S]*?(?=\n\s*detailed_description\s*:)/i,
      `retention_analysis:\n${newRaBody}\n\n`,
    );
  }
  return body.replace(
    /retention_analysis\s*:\s*[\s\S]*?(?=\n\s*(?:overall_soundscape|non_diegetic_music)\s*:|$)/i,
    `retention_analysis:\n${newRaBody}\n\n`,
  );
}

function alignZhSkillProductionRefMode(
  session: DramaDirectorSession,
  shot: DramaShot,
  body: string,
): string {
  const useSb = isDramaShotUsingStoryboardAsVideoRef(shot);
  const newRa = buildRetentionAnalysisLinesZh(session, shot).join('\n');
  const oldRaMatch = body.match(
    /retention_analysis\s*:\s*([\s\S]*?)(?=\n\s*detailed_description\s*:)/i,
  );
  const oldRa = oldRaMatch?.[1] || '';
  const remap = buildPictureIndexRemap(oldRa, newRa);
  let next = replaceRetentionAnalysisBlock(body, newRa || '（本镜尚未绑定参考图）');
  if (remap.size && /detailed_description\s*:/i.test(next)) {
    next = next.replace(
      /(detailed_description\s*:\s*)([\s\S]*?)(?=\n\s*overall_soundscape\s*:|$)/i,
      (_m, head: string, dd: string) => `${head}${remapPictureTagsInText(dd, remap)}`,
    );
  }
  return scrubStaleStoryboardPriorityWording(next, useSb);
}

function alignEnSkillProductionRefMode(
  session: DramaDirectorSession,
  shot: DramaShot,
  body: string,
): string {
  const useSb = isDramaShotUsingStoryboardAsVideoRef(shot);
  const newRa = buildRetentionAnalysisLinesEn(session, shot).join('\n');
  const oldRaMatch = body.match(
    /retention_analysis\s*:\s*([\s\S]*?)(?=\n\s*detailed_description\s*:)/i,
  );
  const oldRa = oldRaMatch?.[1] || '';
  const remap = buildPictureIndexRemap(oldRa, newRa);
  let next = replaceRetentionAnalysisBlock(body, newRa || '(No reference pictures bound.)');
  if (remap.size && /detailed_description\s*:/i.test(next)) {
    next = next.replace(
      /(detailed_description\s*:\s*)([\s\S]*?)(?=\n\s*overall_soundscape\s*:|$)/i,
      (_m, head: string, dd: string) => `${head}${remapPictureTagsInText(dd, remap)}`,
    );
  }
  return scrubStaleStoryboardPriorityWording(next, useSb);
}

/**
 * 生产上云封口：只加确定性守卫，禁止再改 Speaker / Audio / Lip-sync。
 * 中文白话稿自动保留汉字（见 isDramaH3ZhNaturalApiPrompt）。
 * 黑白/单色画风：剥掉旧文首硬锁与「已锁定画风色调」后的长并入句，并清洗正文抢色词（金色等）。
 * 传入 session+shot 时，按勾选同步参考对应与风格优先级（不动剧情戏文）。
 */
export function sealDramaProductionCloudPrompt(
  sourcePrompt: string,
  opts?: {
    hasDialogue?: boolean;
    preserveChinese?: boolean;
    /** 本镜分镜图的 Picture / @图片 序号（1-based）；保留参数兼容调用方 */
    storyboardPicIndex?: number | null;
    /** 额外风格文案（项目/预设），用于识别黑白等 */
    styleHint?: string | null;
    /** 传入后按 use_storyboard_as_video_ref 对齐参考对应/风格句 */
    session?: DramaDirectorSession;
    shot?: DramaShot;
  },
): string {
  let sealed = String(sourcePrompt || '').trim();
  if (opts?.session && opts?.shot) {
    sealed = alignDramaProductionPromptRefMode(opts.session, opts.shot, sealed);
    if (isDramaShotUsingStoryboardAsVideoRef(opts.shot)) {
      sealed = ensureDramaStoryboardFramingGuard(sealed);
    }
  }
  sealed = ensureDirectorDramaVideoPromptGuards(sealed, {
    skipDialogueSfxFlatten: true,
    skipSoundscapeGuard: true,
    hasDialogue: opts?.hasDialogue,
    ...(opts?.preserveChinese !== undefined
      ? { preserveChinese: opts.preserveChinese }
      : {}),
  });
  sealed = stripDramaLeadingStyleHardLockBanners(sealed);
  sealed = stripDramaLockedStyleLineStoryboardSuffix(sealed);
  const mono =
    directorStyleLooksMonochrome(sealed) ||
    directorStyleLooksMonochrome(opts?.styleHint) ||
    directorStyleLooksMonochrome(String(sourcePrompt || ''));
  if (mono) {
    sealed = scrubDramaMonochromeColorWording(sealed);
    sealed = ensureDramaLockedStyleMonochromeClause(sealed);
  }
  return sealed;
}

/** 去掉封口曾前置的风格硬锁横幅（保留正文） */
function stripDramaLeadingStyleHardLockBanners(prompt: string): string {
  let body = String(prompt || '').trim();
  if (!body) return body;
  for (let i = 0; i < 6; i++) {
    const next = body
      .replace(/^【单色\/黑白硬性】[\s\S]*?(?:no color\.|去色。)\s*/i, '')
      .replace(/^【分镜风格优先】[\s\S]*?本行勿口述。\s*/u, '')
      .replace(/^\[Storyboard style priority\][\s\S]*?Do not speak this line\.\s*/i, '')
      .replace(/^\n+/, '')
      .trim();
    if (next === body) break;
    body = next;
  }
  return body;
}

/** 去掉「已锁定画风色调」行后曾并入的分镜长说明（用户不要这段） */
function stripDramaLockedStyleLineStoryboardSuffix(prompt: string): string {
  let body = String(prompt || '');
  body = body.replace(
    /(已锁定画风色调\s*[：:][^\n]*?)(?:\s*画面风格与色调以本镜分镜参考图[\s\S]*?)(?=\n|$)/u,
    (_m, head: string) => {
      const base = String(head || '')
        .replace(/\s*画面风格与色调以本镜分镜参考图[\s\S]*$/u, '')
        .replace(/[。.\s]+$/u, '');
      return `${base}。`;
    },
  );
  body = body.replace(
    /(风格色调\s*[：:][^\n]*?)(?:\s*画面风格与色调以本镜分镜参考图[\s\S]*?)(?=\n|$)/u,
    (_m, head: string) => {
      const base = String(head || '')
        .replace(/\s*画面风格与色调以本镜分镜参考图[\s\S]*$/u, '')
        .replace(/[。.\s]+$/u, '');
      return `${base}。`;
    },
  );
  // 误插在 detailed_description 下的整行
  body = body.replace(
    /^已锁定画风色调：以分镜为准。画面风格与色调以本镜分镜参考图[^\n]*\n+/mu,
    '',
  );
  return body;
}

/** 黑白锁定时：把正文抢色词改成材质/结构表述，减轻 H3 上色 */
function scrubDramaMonochromeColorWording(prompt: string): string {
  let t = String(prompt || '');
  if (!t.trim()) return t;
  // 不改 <d> 对白内汉字（对白可保留原文）
  const parts = t.split(/(<d>\s*\[[^\]]*\][\s\S]*?<\/d>)/gi);
  for (let i = 0; i < parts.length; i++) {
    if (/^<d>\s*\[/i.test(parts[i] || '')) continue;
    let s = parts[i] || '';
    s = s
      .replace(/天庭金殿/g, '天庭大殿')
      .replace(/金殿/g, '大殿')
      .replace(/金色宫殿/g, '宏伟宫殿')
      .replace(/宫殿结构，金色[^，。\n]*/g, '宫殿结构')
      .replace(/金色辉煌/g, '雕梁画栋、气势恢宏')
      .replace(/金碧辉煌/g, '雕梁画栋、气势恢宏')
      .replace(/帝袍金光闪闪|金光闪闪的帝袍/g, '华贵帝袍')
      .replace(/金光闪闪/g, '高光闪烁')
      .replace(/身穿金甲/g, '身穿铠甲')
      .replace(/金甲/g, '铠甲')
      .replace(/帝袍金/g, '帝袍')
      .replace(/金色长袍|金色龙袍|金色袍服/g, '华贵长袍')
      .replace(/金色粗链/g, '金属粗链')
      .replace(/金色\s*/g, '')
      .replace(/金光/g, '强光')
      .replace(/神光四射/g, '强光四射')
      .replace(/神光/g, '强光')
      .replace(/滔天光芒/g, '强烈高光')
      .replace(/剑光如虹/g, '剑刃高光锐利')
      .replace(/剑光/g, '剑刃高光')
      .replace(/雷霆风暴/g, '强烈风暴光影')
      .replace(/霓虹/g, '高对比光带')
      .replace(/\bgolden\b/gi, 'metallic')
      .replace(/\bgold\b/gi, 'metal');
    parts[i] = s;
  }
  return parts.join('');
}

/** 确保「已锁定画风色调」行带短句全程黑白，不加长段说明 */
function ensureDramaLockedStyleMonochromeClause(prompt: string): string {
  const body = String(prompt || '');
  const zhRe = /(已锁定画风色调\s*[：:][^\n]*)/;
  if (zhRe.test(body)) {
    return body.replace(zhRe, (_m, head: string) => {
      let base = String(head || '')
        .replace(/\s*画面风格与色调以本镜分镜参考图[\s\S]*$/u, '')
        .replace(/\s*全程黑白去色[^。\n]*/u, '')
        .replace(/[。.\s]+$/u, '');
      if (!/高反差黑白|黑白|单色|monochrome/i.test(base)) {
        base = `${base}，高反差黑白`;
      }
      return `${base}。全程黑白去色，禁止彩色。`;
    });
  }
  const plainRe = /(风格色调\s*[：:][^\n]*)/;
  if (plainRe.test(body)) {
    return body.replace(plainRe, (_m, head: string) => {
      const base = String(head || '')
        .replace(/\s*画面风格与色调以本镜分镜参考图[\s\S]*$/u, '')
        .replace(/\s*全程黑白去色[^。\n]*/u, '')
        .replace(/[。.\s]+$/u, '');
      return `${base}。全程黑白去色，禁止彩色。`;
    });
  }
  return body;
}

/** 编辑器整镜编译稿：与英文 8 段同级密度（中文分段 + Subject/Visible/口型）。Skill 不进正文。 */
/** 白话参考对应：@图片N 是林凡 / 背景天庭金殿 / 木棍 */
function buildSimplePictureBindingsZh(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): string {
  const slots = listDramaShotRefImageSlots(session, shot);
  const parts: string[] = [];
  const push = (s: string) => {
    const t = trimLine(s);
    if (t) parts.push(t);
  };
  if (slots.length) {
    for (const slot of slots) {
      const pic = `@图片${slot.index}`;
      const matched =
        resolved.subjects.find((s) => s.pictureTag === `<Picture ${slot.index}>`) ||
        (slot.role === 'scene' && resolved.sceneSubject?.pictureTag === `<Picture ${slot.index}>`
          ? resolved.sceneSubject
          : null);
      const name = trimLine(matched?.name) || trimLine(slot.name) || '';
      if (slot.role === 'scene') {
        push(`${pic} 是背景${name || '场景'}`);
      } else if (slot.role === 'storyboard') {
        push(`${pic} 是本镜分镜（画风/光色/场景构图以该图为准，优先于文字风格；开场即该景别，禁止从远拉近）`);
      } else if (slot.role === 'prop') {
        push(`${pic} 是${name || '道具'}`);
      } else if (slot.role === 'creature') {
        push(`${pic} 是${name || '生物'}`);
      } else {
        push(`${pic} 是${name || '角色'}`);
      }
    }
  } else {
    for (const s of resolved.subjects) {
      const pic = s.pictureTag.replace(/<Picture\s+(\d+)>/i, '@图片$1');
      if (s.role === 'scene') push(`${pic} 是背景${s.name}`);
      else if (s.role === 'prop') push(`${pic} 是${s.name}`);
      else if (s.role === 'creature') push(`${pic} 是${s.name}`);
      else push(`${pic} 是${s.name}`);
    }
    if (resolved.sceneSubject && !resolved.subjects.includes(resolved.sceneSubject)) {
      const s = resolved.sceneSubject;
      const pic = s.pictureTag.replace(/<Picture\s+(\d+)>/i, '@图片$1');
      push(`${pic} 是背景${s.name}`);
    }
  }
  if (!parts.length) return '本镜尚未绑定参考图。';
  return `${parts.join('，')}。`;
}

/** 本镜剧情正文：优先原文片段，其次动作/对白，再退回时间轴白话 */
function buildSimplePlotZh(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): string {
  const bible = getActiveEpisodeBible(session);
  const eventIds = new Set((shot.visual_event_ids || []).map((id) => trimLine(id)).filter(Boolean));
  const ves = (bible.visual_events || []).filter((e) => eventIds.has(trimLine(e.event_id)));
  const segIds = new Set<string>();
  for (const ve of ves) {
    for (const id of ve.source_segment_ids || []) {
      if (trimLine(id)) segIds.add(trimLine(id));
    }
  }
  const segs = (bible.original_segments || [])
    .filter((s) => segIds.has(String(s.segment_id || '')))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const scrubPlotSourceLine = (raw: string): string => {
    const t = trimLine(raw);
    if (!t) return '';
    if (isDramaScreenTextVisual(t)) return formatDramaScreenOverlayZh(t);
    if (isDramaNarrationVisual(t)) return stripDramaNarrationLabel(t);
    if (looksLikeDramaSystemSpokenText(t)) {
      const body = stripDramaSystemSpokenLabel(t);
      return body ? `系统\n${body}` : '';
    }
    if (/【\s*(?:弹幕|旁白|字幕|浮字)|(?:背影|正面|特写)镜头/.test(t)) {
      return tidyDramaTimelineVisualAction(cleanDramaMappedVisualAction(t));
    }
    return t;
  };
  const fromSegs = segs
    .map((s) => scrubPlotSourceLine(s.original_text))
    .filter(Boolean)
    .join('\n');

  const fromVe = ves
    .slice()
    .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0))
    .map((e) => scrubPlotSourceLine(e.original_text || e.see))
    .filter(Boolean)
    .join('\n');

  const nameById = new Map(
    (session.bible?.characters || []).map((c) => [c.character_id, c.name] as const),
  );
  const lines: string[] = [];
  const sceneHeading = trimLine(resolved.sceneSubject?.name);
  if (sceneHeading) {
    const tod =
      trimLine(parseDramaShotTimeEnv(shot.environment).time_of_day) || '日';
    lines.push(`内景 ${sceneHeading} - ${tod}`);
    lines.push('');
  }
  const actionRaw = tidyDramaTimelineVisualAction(
    cleanDramaMappedVisualAction(trimLine(shot.action)),
  );
  const action =
    actionRaw && !looksLikeDramaSystemSpokenText(actionRaw) && !isDramaSceneTransitionText(actionRaw)
      ? actionRaw
      : '';
  if (action) lines.push(action);

  const dlg = (shot.dialogue || [])
    .map((line) => {
      const textRaw = trimLine(line.text);
      if (!textRaw) return '';
      const cid = trimLine(line.character_id);
      const asSystem =
        isDramaSystemVoiceId(cid) || looksLikeDramaSystemSpokenText(textRaw);
      const text = asSystem ? stripDramaSystemSpokenLabel(textRaw) : textRaw;
      if (!text) return '';
      const who = asSystem
        ? '系统'
        : trimLine(line.character_name) || trimLine(nameById.get(cid));
      return who ? `${who}\n${text}` : text;
    })
    .filter(Boolean);
  if (dlg.length) {
    if (action) lines.push('');
    lines.push(...dlg);
  }

  // 优先时间轴（含站位/视线/表演），没有再退回原文片段
  const events = [...(shot.timeline_events || [])].sort(
    (a, b) => (Number(a.start_sec) || 0) - (Number(b.start_sec) || 0),
  );
  const beatLines: string[] = [];
  for (const ev of events) {
    const rawVis = trimLine(ev.visual_action);
    const peeled = peelSystemSpokenFromTimelineVisual(rawVis, ev.dialogue);
    const dialogueRaw = trimLine(peeled.dialogue);
    const dlgId = trimLine(ev.dialogue_character_id);
    let who = isDramaSystemVoiceId(dlgId)
      ? '系统'
      : trimLine(nameById.get(dlgId)) || '';
    const dialogue = looksLikeDramaSystemSpokenText(dialogueRaw)
      ? stripDramaSystemSpokenLabel(dialogueRaw)
      : dialogueRaw;
    if (!who && dialogue && (isDramaSystemVoiceId(dlgId) || looksLikeDramaSystemSpokenText(dialogueRaw))) {
      who = '系统';
    }
    if (!who && dlgId && !isDramaSystemVoiceId(dlgId)) who = dlgId;
    let vis = '';
    if (rawVis) {
      if (isDramaScreenTextVisual(rawVis)) {
        vis = formatDramaScreenOverlayZh(rawVis);
      } else if (isDramaNarrationVisual(rawVis)) {
        vis = stripDramaNarrationLabel(rawVis);
      } else if (peeled.visual) {
        vis = sequentialActionZh(peeled.visual);
      } else if (
        rawVis &&
        dialogue &&
        looksLikeDramaInMindSystemVoice(rawVis) &&
        !/[：:“"「].*叮|叮——/.test(rawVis)
      ) {
        // 对白已在 dialogue：保留「听见机械声」反应画面
        vis = sequentialActionZh(rawVis);
      } else if (
        rawVis &&
        !looksLikeDramaSystemSpokenText(rawVis) &&
        !isDramaSceneTransitionText(rawVis)
      ) {
        vis = sequentialActionZh(rawVis);
      } else if (!dialogue) {
        vis = sequentialActionZh(rawVis);
      }
    }
    // 残余【弹幕…】块一律转白话屏字
    if (/【\s*(?:弹幕|浮字|字幕)/.test(vis)) {
      vis =
        formatDramaScreenOverlayZh(vis) ||
        tidyDramaTimelineVisualAction(cleanDramaMappedVisualAction(vis));
    }
    const hasPicture =
      !!vis && !isPlaceholderDramaVisualAction(vis) && !isSparseDramaVisualForDirecting(peeled.visual || rawVis);
    if (vis && !isPlaceholderDramaVisualAction(vis)) beatLines.push(vis);
    // 空情绪拍 / 占位视觉：不串站位、表情、状态
    if (hasPicture) {
      for (const line of eventDirectingLinesZh(ev, resolved)) {
        // 白话不用「视线 X」，改成「看向X」；站位/表情原样
        if (/^视线\s+/.test(line)) {
          const eye = line.replace(/^视线\s+/, '');
          if (eye && !vis.includes(eye)) beatLines.push(`看向${eye}`);
        } else if (!isDramaInnerOsCue(line)) {
          beatLines.push(line);
        }
      }
    }
    // shot.dialogue 已写过时，不再重复时间轴对白
    if (dialogue && !dlg.length) beatLines.push(who ? `${who}\n${dialogue}` : dialogue);
  }
  const beats = dedupeActionChainLines(beatLines)
    .map((line) => {
      if (!/【\s*(?:弹幕|浮字|字幕)/.test(line)) return line;
      return (
        formatDramaScreenOverlayZh(line) ||
        tidyDramaTimelineVisualAction(cleanDramaMappedVisualAction(line)) ||
        ''
      );
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const head = lines.join('\n').trim();
  if (head && beats) return `${head}\n\n${beats}`;
  if (beats) return beats;
  if (fromSegs) return fromSegs;
  if (fromVe) return fromVe;
  return head || '（本镜暂无剧情正文）';
}

export function composeDramaShotLensTaggedPrompt(
  session: DramaDirectorSession,
  shot: DramaShot,
  _opts?: { previousCompile?: string },
): string {
  const ready = applyDramaShotPromptBackfill(ensureDramaShotTimelineEvents(shot, session));
  const resolved = resolveDramaLensSubjects(session, ready);
  const bindings = buildSimplePictureBindingsZh(session, ready, resolved);
  const plot = buildSimplePlotZh(session, ready, resolved);
  const styleBlock = buildDramaZhStyleBlockForRefMode(session, ready);

  return [bindings, styleBlock, '剧情：', plot]
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 白话参考对应：@Picture N is Lin Fan / background hall / prop */
function buildSimplePictureBindingsEn(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): string {
  const slots = listDramaShotRefImageSlots(session, shot);
  const parts: string[] = [];
  const push = (s: string) => {
    const t = trimLine(s);
    if (t) parts.push(t);
  };
  if (slots.length) {
    for (const slot of slots) {
      const pic = `@Picture ${slot.index}`;
      const matched =
        resolved.subjects.find((s) => s.pictureTag === `<Picture ${slot.index}>`) ||
        (slot.role === 'scene' && resolved.sceneSubject?.pictureTag === `<Picture ${slot.index}>`
          ? resolved.sceneSubject
          : null);
      const name = trimLine(matched?.name) || trimLine(slot.name) || '';
      if (slot.role === 'scene') {
        push(`${pic} is the background ${name || 'scene'}`);
      } else if (slot.role === 'storyboard') {
        push(
          `${pic} is this shot's storyboard (look/color/composition lock; overrides textual style; open at this framing, no far-to-near push-in)`,
        );
      } else if (slot.role === 'prop') {
        push(`${pic} is ${name || 'the prop'}`);
      } else if (slot.role === 'creature') {
        push(`${pic} is ${name || 'the creature'}`);
      } else {
        push(`${pic} is ${name || 'the character'}`);
      }
    }
  } else {
    for (const s of resolved.subjects) {
      const pic = s.pictureTag.replace(/<Picture\s+(\d+)>/i, '@Picture $1');
      if (s.role === 'scene') push(`${pic} is the background ${s.name}`);
      else if (s.role === 'prop') push(`${pic} is ${s.name}`);
      else if (s.role === 'creature') push(`${pic} is ${s.name}`);
      else push(`${pic} is ${s.name}`);
    }
    if (resolved.sceneSubject && !resolved.subjects.includes(resolved.sceneSubject)) {
      const s = resolved.sceneSubject;
      const pic = s.pictureTag.replace(/<Picture\s+(\d+)>/i, '@Picture $1');
      push(`${pic} is the background ${s.name}`);
    }
  }
  if (!parts.length) return 'No reference pictures bound for this shot yet.';
  return `${parts.join(', ')}.`;
}

function sequentialActionEn(visual: string, subjects: DramaLensSubject[]): string {
  if (isDramaScreenTextVisual(visual)) {
    return formatDramaScreenOverlayEn(visual);
  }
  const t = resolveTimelineVisualForPrompt(visual, 'en');
  if (!t) return '';
  if (/black\s*(?:screen|frame|out)|纯黑|黑屏|黑场/i.test(t) && t.length < 48) {
    return 'The frame cuts quickly to solid black.';
  }
  const en = visualToEnglish(t, subjects) || t;
  return /[.!?]$/.test(en) ? en : `${en}.`;
}

/** 英文剧情正文：与中文同构（场次头 + 动作 + 对白），台词保留中文原文 */
function buildSimplePlotEn(
  session: DramaDirectorSession,
  shot: DramaShot,
  resolved: ReturnType<typeof resolveDramaLensSubjects>,
): string {
  const bible = getActiveEpisodeBible(session);
  const eventIds = new Set((shot.visual_event_ids || []).map((id) => trimLine(id)).filter(Boolean));
  const ves = (bible.visual_events || []).filter((e) => eventIds.has(trimLine(e.event_id)));
  const segIds = new Set<string>();
  for (const ve of ves) {
    for (const id of ve.source_segment_ids || []) {
      if (trimLine(id)) segIds.add(trimLine(id));
    }
  }
  const segs = (bible.original_segments || [])
    .filter((s) => segIds.has(String(s.segment_id || '')))
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const scrubPlotSourceLine = (raw: string): string => {
    const t = trimLine(raw);
    if (!t) return '';
    if (isDramaScreenTextVisual(t)) return formatDramaScreenOverlayEn(t);
    if (isDramaNarrationVisual(t)) return stripDramaNarrationLabel(t);
    if (looksLikeDramaSystemSpokenText(t)) {
      const body = stripDramaSystemSpokenLabel(t);
      return body ? `System\n${body}` : '';
    }
    if (/【\s*(?:弹幕|旁白|字幕|浮字)|(?:背影|正面|特写)镜头/.test(t)) {
      const cleaned = tidyDramaTimelineVisualAction(cleanDramaMappedVisualAction(t));
      return cleaned ? sequentialActionEn(cleaned, resolved.subjects) || cleaned : '';
    }
    return t;
  };
  const fromSegs = segs
    .map((s) => scrubPlotSourceLine(s.original_text))
    .filter(Boolean)
    .join('\n');
  const fromVe = ves
    .slice()
    .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0))
    .map((e) => scrubPlotSourceLine(e.original_text || e.see))
    .filter(Boolean)
    .join('\n');

  const nameById = new Map(
    (session.bible?.characters || []).map((c) => [c.character_id, c.name] as const),
  );
  const lines: string[] = [];
  const sceneHeading = trimLine(resolved.sceneSubject?.name);
  if (sceneHeading) {
    const tod = trimLine(parseDramaShotTimeEnv(shot.environment).time_of_day) || 'Day';
    const todEn = /夜|晚|night/i.test(tod)
      ? 'NIGHT'
      : /晨|早|dawn|morning/i.test(tod)
        ? 'MORNING'
        : /昏|暮|dusk|evening/i.test(tod)
          ? 'DUSK'
          : 'DAY';
    lines.push(`INT. ${sceneHeading} - ${todEn}`);
    lines.push('');
  }
  const actionRaw = tidyDramaTimelineVisualAction(
    cleanDramaMappedVisualAction(trimLine(shot.action)),
  );
  const action =
    actionRaw && !looksLikeDramaSystemSpokenText(actionRaw) && !isDramaSceneTransitionText(actionRaw)
      ? sequentialActionEn(actionRaw, resolved.subjects) || actionRaw
      : '';
  if (action) lines.push(action);

  const dlg = (shot.dialogue || [])
    .map((line) => {
      const textRaw = trimLine(line.text);
      if (!textRaw) return '';
      const cid = trimLine(line.character_id);
      const asSystem =
        isDramaSystemVoiceId(cid) || looksLikeDramaSystemSpokenText(textRaw);
      const text = asSystem ? stripDramaSystemSpokenLabel(textRaw) : textRaw;
      if (!text) return '';
      const who = asSystem
        ? 'System'
        : trimLine(line.character_name) || trimLine(nameById.get(cid));
      return who ? `${who}\n${text}` : text;
    })
    .filter(Boolean);
  if (dlg.length) {
    if (action) lines.push('');
    lines.push(...dlg);
  }

  const events = [...(shot.timeline_events || [])].sort(
    (a, b) => (Number(a.start_sec) || 0) - (Number(b.start_sec) || 0),
  );
  const beatLines: string[] = [];
  for (const ev of events) {
    const rawVis = trimLine(ev.visual_action);
    const peeled = peelSystemSpokenFromTimelineVisual(rawVis, ev.dialogue);
    const dialogueRaw = trimLine(peeled.dialogue);
    const dlgId = trimLine(ev.dialogue_character_id);
    let who = isDramaSystemVoiceId(dlgId)
      ? 'System'
      : trimLine(nameById.get(dlgId)) || '';
    const dialogue = looksLikeDramaSystemSpokenText(dialogueRaw)
      ? stripDramaSystemSpokenLabel(dialogueRaw)
      : dialogueRaw;
    if (
      !who &&
      dialogue &&
      (isDramaSystemVoiceId(dlgId) || looksLikeDramaSystemSpokenText(dialogueRaw))
    ) {
      who = 'System';
    }
    if (!who && dlgId && !isDramaSystemVoiceId(dlgId)) who = dlgId;
    let vis = '';
    if (rawVis) {
      if (isDramaScreenTextVisual(rawVis)) {
        vis = formatDramaScreenOverlayEn(rawVis);
      } else if (isDramaNarrationVisual(rawVis)) {
        vis = stripDramaNarrationLabel(rawVis);
      } else if (peeled.visual) {
        vis = sequentialActionEn(peeled.visual, resolved.subjects);
      } else if (
        rawVis &&
        dialogue &&
        looksLikeDramaInMindSystemVoice(rawVis) &&
        !/[：:“"「].*叮|叮——/.test(rawVis)
      ) {
        vis = sequentialActionEn(rawVis, resolved.subjects);
      } else if (
        rawVis &&
        !looksLikeDramaSystemSpokenText(rawVis) &&
        !isDramaSceneTransitionText(rawVis)
      ) {
        vis = sequentialActionEn(rawVis, resolved.subjects);
      } else if (!dialogue) {
        vis = sequentialActionEn(rawVis, resolved.subjects);
      }
    }
    if (/【\s*(?:弹幕|浮字|字幕)/.test(vis)) {
      vis =
        formatDramaScreenOverlayEn(vis) ||
        tidyDramaTimelineVisualAction(cleanDramaMappedVisualAction(vis));
    }
    const hasPicture =
      !!vis &&
      !isPlaceholderDramaVisualAction(vis) &&
      !isSparseDramaVisualForDirecting(peeled.visual || rawVis);
    if (vis && !isPlaceholderDramaVisualAction(vis)) beatLines.push(vis);
    if (hasPicture) {
      for (const line of eventDirectingLinesEnglish(ev, resolved)) {
        if (/^eyeline\s+/i.test(line)) {
          const eye = line.replace(/^eyeline\s+/i, '');
          if (eye && !vis.includes(eye)) beatLines.push(`looks toward ${eye}`);
        } else {
          beatLines.push(line);
        }
      }
    }
    if (dialogue && !dlg.length) beatLines.push(who ? `${who}\n${dialogue}` : dialogue);
  }
  const beats = dedupeActionChainLines(beatLines)
    .map((line) => {
      if (!/【\s*(?:弹幕|浮字|字幕)/.test(line)) return line;
      return (
        formatDramaScreenOverlayEn(line) ||
        tidyDramaTimelineVisualAction(cleanDramaMappedVisualAction(line)) ||
        ''
      );
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const head = lines.join('\n').trim();
  if (head && beats) return `${head}\n\n${beats}`;
  if (beats) return beats;
  if (fromSegs) return fromSegs;
  if (fromVe) return fromVe;
  return head || '(No plot body for this shot yet)';
}

/** 英文整镜编译稿：与中文同构 @Picture / Style·tone / Plot（编辑器用；上云仍走 H3 八段） */
export function composeDramaShotLensTaggedPromptEn(
  session: DramaDirectorSession,
  shot: DramaShot,
  _opts?: { previousCompile?: string },
): string {
  const ready = applyDramaShotPromptBackfill(ensureDramaShotTimelineEvents(shot, session));
  const resolved = resolveDramaLensSubjects(session, ready);
  const bindings = buildSimplePictureBindingsEn(session, ready, resolved);
  const plot = buildSimplePlotEn(session, ready, resolved);
  const styleBlock = buildDramaEnStyleBlockForRefMode(session, ready);

  return [bindings, styleBlock, 'Plot:', plot]
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
