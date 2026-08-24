/**
 * 短剧 H3 Prompt Compiler：结构化导演数据 → A–H 分段长文本。
 * 出片只走本模块；不读取 final_prompt / adapter_prompt_cache。
 */

import {
  formatDirectorH3TimeRange,
} from '../directorPipeline/minimaxH3DramaPrompt.js';
import {
  H3_LISTENER_MOUTH_RULE,
  H3_NATURAL_NO_DIALOGUE_MOUTH_RULE,
  H3_NO_DIALOGUE_PROMPT_BANNER,
  H3_SPOKEN_WORDS_LOCK,
  assertDramaH3CompileMode,
  h3AudioModeBanner,
  h3AudioSoundConstraint,
  h3LipsyncTimelineRule,
  h3MultiModeBanner,
  h3MultiSoundConstraint,
  type DramaH3CompileMode,
} from './compilers/h3CompileMode.js';
import {
  dramaH3PromptVersion,
  resolveDramaH3DialoguePlan,
  scrubDramaDirectingBeatSpeech,
  scrubH3EnvironmentAudio,
  scrubH3SpeechLeak,
  type DramaH3DialogueEvent,
  type DramaH3DialogueMode,
} from './h3DialogueMode.js';
import {
  toH3SilentActionEnglish,
  toH3SilentCameraEnglish,
  toH3SilentFoleyEnglish,
} from './h3SilentEnglish.js';
import { replaceDramaAnonymousCastLabel } from './shotCastGate.js';
import { buildDramaDirectingBreakdown, breakdownBeatsToTimelineEvents } from './directingBreakdown.js';
import { pickMergedPerformanceField } from './directingEnhance.js';
import { formatLockedCameraLine, stripConflictingCameraLanguage } from './directorCameraSchema.js';
import {
  qaCompiledDramaPrompt,
  qaDramaDirectingBeats,
  mergeQaReports,
  repairCompiledDramaPromptCameraLanguage,
  type DirectorQaReport,
} from './directorQa.js';
import {
  applyGazeTargetInText,
  collapseDuplicateActionText,
  locationGazeLabel,
  sanitizeSilentCharacterText,
  stripEmotionLabels,
} from './visiblePerformance.js';
import {
  clipDramaAudioEventsToRange,
  defaultDramaReferenceLockIntent,
  dramaShotHasSpokenDialogue,
  resolveDramaShotAudioTimeline,
  speakerIdForCharacter,
} from './migrateH3Compiler.js';
import { listDramaShotRefAudioSlots, listDramaShotRefImageSlots } from './shotRefs.js';
import { resolveCharacterIdsForShot } from './shotTimeline.js';
import { differentiateDuplicateTimelineCuts } from './timelineEvent.js';
import { buildCinematicPromptZhFromVisualDna } from './visualDna.js';
import { getVisualStylePreset } from './visualStylePresets.js';
import {
  dramaVideoModelMaxRefImages,
  resolveDramaShotVideoModel,
} from './dramaVideoModels.js';
import type {
  DramaAudioEvent,
  DramaCharacter,
  DramaDirectorSession,
  DramaH3CompileSectionId,
  DramaPerformanceBeat,
  DramaReferenceLockIntent,
  DramaSceneAsset,
  DramaShot,
  DramaSpeakerId,
  DramaTimelineEvent,
} from './types.js';

export type DramaH3CompileLocale = 'zh' | 'en';

const SECTION_TITLES: Record<DramaH3CompileLocale, Record<DramaH3CompileSectionId, string>> = {
  zh: {
    A: '系统规则',
    B: 'H3 模式',
    C: '视觉',
    D: '资产定义',
    E: '镜头时间轴',
    F: '表演',
    G: '音频',
    H: '负向约束',
  },
  en: {
    A: 'System Rules',
    B: 'H3 Mode',
    C: 'Visual',
    D: 'Assets',
    E: 'Timeline',
    F: 'Performance',
    G: 'Audio',
    H: 'Negative',
  },
};

function resolveCompileLocale(raw?: string | null): DramaH3CompileLocale {
  return String(raw || '').trim().toLowerCase() === 'en' ? 'en' : 'zh';
}

function h3SpokenD(text: string): string {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line ? `<d>[Chinese] ${line}</d>` : '';
}

/** 画面描述不得被 MiniMax 当台词朗读 */
function h3UnspokenVisual(text: string): string {
  const t = String(text || '').trim();
  if (!t) return '';
  const mapped = t
    .replace(/^【全景交代人物与环境位置】\s*/, 'wide establishing. ')
    .replace(/^【中景看肢体与站位】\s*/, 'medium shot of body and stance. ')
    .replace(/^【近景看面部与眼神】\s*/, 'close-up of face and eyes. ');
  return `Visual-only (do not speak): ${mapped}`;
}

export type DramaH3PromptSection = {
  id: DramaH3CompileSectionId;
  title: string;
  text: string;
  sources: Array<{
    kind: string;
    ref?: string;
    source?: string;
  }>;
};

export type DramaH3CompileProvenance = {
  sections: DramaH3PromptSection[];
  final_prompt: string;
};

export type DramaH3CompileDebug = {
  mode: DramaH3CompileMode;
  dialogue: boolean;
  dialogue_mode: DramaH3DialogueMode;
  dialogue_events: DramaH3DialogueEvent[];
  prompt_version: string;
  audio_reference_intended: boolean;
  audio_mode: 'character_reference' | 'lip_sync';
  duration_sec: number;
  visual_bible: { preset_id?: string; style_prompt: string; used_in_section: 'C' };
  references: Array<{
    index: number;
    role: string;
    lock_intent: DramaReferenceLockIntent;
    name: string;
    url: string;
    asset_id?: string;
  }>;
  characters: Array<{
    character_id: string;
    speaker_id: DramaSpeakerId | '';
    name: string;
    subject_n?: number;
    audio_slot_n?: number;
  }>;
  shots: Array<{
    timeline_event_id: string;
    start_sec: number;
    end_sec: number;
    camera: string;
    character_ids: string[];
    audio_event_ids: string[];
  }>;
  audio_timeline: DramaAudioEvent[];
  performance_plan: Array<{
    beat_id: string;
    character_id: string;
    source: 'system_constraint' | 'user' | 'llm_enhanced' | 'structured';
    mouth_state?: string;
    facial_expression?: string;
  }>;
  environment_audio: Array<{ start_sec: number; end_sec: number; items: string[] }>;
  constraints: {
    no_subtitle: true;
    no_bgm: true;
    lipsync_reuse_shot_audio: boolean;
    generate_dialogue: boolean;
    generate_environment: boolean;
  };
  provenance: DramaH3CompileProvenance;
  qa: DirectorQaReport;
  final_prompt: string;
  legacy_final_prompt?: string;
};

function uniqJoin(parts: Array<string | undefined | null>, sep = '、'): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = String(p || '').trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.join(sep);
}

function genderLabel(ch: DramaCharacter | undefined): string {
  if (ch?.gender === 'female') return '女性';
  if (ch?.gender === 'male') return '男性';
  return '';
}

function pronoun(ch: DramaCharacter | undefined): string {
  return ch?.gender === 'female' ? '她' : '他';
}

function compactBits(parts: Array<string | undefined | null>): string[] {
  const tokens: string[] = [];
  for (const p of parts) {
    for (const t of String(p || '').split(/[。；;，,、/|]+/)) {
      const s = t.trim();
      if (!s || s.length < 2) continue;
      if (tokens.some((x) => x === s || x.includes(s))) continue;
      const idx = tokens.findIndex((x) => s.includes(x) && s !== x);
      if (idx >= 0) tokens[idx] = s;
      else tokens.push(s);
    }
  }
  return tokens;
}

function appearanceBits(ch: DramaCharacter): string[] {
  return compactBits([
    ch.visual?.hair || (ch.hair_color ? `${ch.hair_color}头发` : ''),
    ch.visual?.face,
    ch.visual?.specialFeature,
    ch.visual?.body || ch.body_type,
    ch.visual?.clothing,
    ch.accessories,
    ...(ch.visual_anchors || []).slice(0, 4),
  ]);
}

function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 - 1e-6 && b0 < a1 - 1e-6;
}

function audioInRange(events: DramaAudioEvent[], start: number, end: number): DramaAudioEvent[] {
  return clipDramaAudioEventsToRange(events, start, end);
}

function fmtRangeSec(start: number, end: number): string {
  const one = (n: number) => {
    const x = Math.round(n * 10) / 10;
    return Number.isInteger(x) ? String(x) : x.toFixed(1);
  };
  return `${one(start)}–${one(end)}秒`;
}

function visualActionKey(text: string): string {
  return String(text || '')
    .replace(/^【[^】]{1,24}】\s*/, '')
    .replace(/\s+/g, '');
}

function sameText(a: string | undefined, b: string | undefined): boolean {
  return String(a || '').trim() === String(b || '').trim();
}

function splitActionPhrases(text: string): string[] {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const byStop = raw
    .split(/[。；;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of byStop) {
    const bits = p.split(/[，,、]/).map((s) => s.trim()).filter(Boolean);
    if (bits.length > 1 && p.length > 10) out.push(...bits);
    else out.push(p);
  }
  return out;
}

/** 连续切段若复制了同一 visual_action，按时间顺序拆成动作阶段，避免 4 镜重演同一拍。 */
function phasedVisualAction(events: DramaTimelineEvent[], idx: number): string {
  const ev = events[idx];
  const act = String(ev.visual_action || '').trim();
  if (!act) return '';
  const key = visualActionKey(act);
  if (!key) return act;
  let lo = idx;
  let hi = idx;
  while (lo > 0 && visualActionKey(events[lo - 1].visual_action) === key) lo -= 1;
  while (hi < events.length - 1 && visualActionKey(events[hi + 1].visual_action) === key) hi += 1;
  const run = hi - lo + 1;
  if (run === 1) return act;
  const parts = splitActionPhrases(act.replace(/^【[^】]{1,24}】\s*/, ''));
  const pos = idx - lo;
  if (!parts.length) return act;
  if (pos < run - 1) return parts[Math.min(pos, parts.length - 1)] || act;
  return parts.slice(Math.min(pos, parts.length - 1)).join('，') || act;
}

function stripLeadingNames(action: string, names: string[]): string {
  let t = String(action || '').trim();
  for (const name of names) {
    const n = String(name || '').trim();
    if (!n) continue;
    t = t.replace(new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:（[^）]*）)?`), '');
  }
  return t.replace(/^[的，,、。\s]+/, '').trim();
}

function speakingWindow(a: DramaAudioEvent): { start: number; end: number } {
  const dur = Math.max(0.1, (Number(a.end_sec) || 0) - (Number(a.start_sec) || 0));
  const pb = Number(a.pause_before_sec);
  const pa = Number(a.pause_after_sec);
  const before = Number.isFinite(pb) ? Math.max(0, pb) : Math.min(0.4, dur * 0.12);
  const after = Number.isFinite(pa) ? Math.max(0, pa) : Math.min(0.5, dur * 0.15);
  let start = (Number(a.start_sec) || 0) + before;
  let end = (Number(a.end_sec) || 0) - after;
  if (end - start < 0.5) {
    start = Number(a.start_sec) || 0;
    end = Number(a.end_sec) || start;
  }
  return { start, end };
}

function primaryEventIndexForAudio(events: DramaTimelineEvent[], audio: DramaAudioEvent): number {
  const sw = speakingWindow(audio);
  const contain = events.findIndex(
    (e) => e.start_sec <= sw.start + 1e-6 && e.end_sec > sw.start + 1e-6,
  );
  if (contain >= 0) return contain;
  let best = -1;
  let bestDur = 0;
  events.forEach((e, i) => {
    const a0 = Math.max(e.start_sec, audio.start_sec);
    const a1 = Math.min(e.end_sec, audio.end_sec);
    const d = a1 - a0;
    if (d > bestDur) {
      bestDur = d;
      best = i;
    }
  });
  return best;
}

function lockIntentLine(
  intent: DramaReferenceLockIntent,
  pic: number,
  en = false,
): string {
  if (en) {
    if (intent === 'composition') return `<图${pic}> composition lock.`;
    if (intent === 'visual_anchor') return `<图${pic}> visual-anchor lock.`;
    if (intent === 'style') return `<图${pic}> style lock.`;
    return `<图${pic}> identity lock.`;
  }
  if (intent === 'composition') {
    return `<图${pic}>为构图参考：只锁定构图、人物站位与空间关系，不单独重写色彩与光影。`;
  }
  if (intent === 'visual_anchor') {
    return `<图${pic}>为视觉锚点：空间结构、色彩、材质、光影方向与渲染风格以该图为准；镜头描述不得另起一套调色或照明。`;
  }
  if (intent === 'style') {
    return `<图${pic}>为风格参考：全片渲染与胶片感跟该图，不占身份锁。`;
  }
  return `<图${pic}>为身份参考：只锁定该主体外观，不改场景光色。`;
}

function lockIntentName(intent: DramaReferenceLockIntent, locale: DramaH3CompileLocale): string {
  if (locale === 'en') return intent;
  if (intent === 'composition') return '构图';
  if (intent === 'visual_anchor') return '视觉锚点';
  if (intent === 'style') return '风格';
  return '身份';
}

function visualBibleStyle(session: DramaDirectorSession, locale: DramaH3CompileLocale): string {
  const pvb = session.bible.projectVisualBible;
  const dna = pvb?.visualDNA || session.bible.visualDNA;
  if (locale !== 'en' && dna) {
    const preset = getVisualStylePreset(pvb?.presetId || dna.presetId);
    return buildCinematicPromptZhFromVisualDna(dna, preset?.visualDNA?.promptTemplateZh).trim();
  }
  return String(pvb?.stylePrompt || dna?.generatedPrompt || session.bible.visual?.style || '').trim();
}

function visualBibleOnce(session: DramaDirectorSession, locale: DramaH3CompileLocale): string {
  const pvb = session.bible.projectVisualBible;
  const dna = pvb?.visualDNA || session.bible.visualDNA;
  if (locale !== 'en') {
    const style = visualBibleStyle(session, locale);
    return `【视觉圣经·全局一次】${style || '写实真人电影拍摄风格'}。以上全片只在此声明一次，后续镜头不要重复写风格/饱和/景深/胶片词，只写本镜机位、动作与表演。`;
  }
  const style = visualBibleStyle(session, locale);
  const bits = uniqJoin([
    style || 'photoreal cinematic look',
    dna?.lighting?.style,
    dna?.camera?.movement,
    Number(dna?.color?.saturation) > 0 && Number(dna?.color?.saturation) < 50 ? 'low saturation' : '',
    Number(dna?.camera?.depthOfField) >= 50 ? 'shallow depth of field' : '',
    dna?.texture?.filmStock,
  ]);
  return `【Visual Bible · once】${bits}. State style/saturation/DoF/film once here; later shots only write camera, action, and performance.`;
}

function section(
  id: DramaH3CompileSectionId,
  title: string,
  text: string,
  sources: DramaH3PromptSection['sources'] = [],
): DramaH3PromptSection {
  return { id, title, text: String(text || '').trim(), sources };
}

export function compileDramaH3Prompt(
  session: DramaDirectorSession,
  shot: DramaShot,
  mode: DramaH3CompileMode,
  opts?: { locale?: DramaH3CompileLocale | string; skipQaRebuild?: boolean },
): DramaH3CompileDebug {
  assertDramaH3CompileMode(mode);
  const locale = resolveCompileLocale(opts?.locale);
  const reuseShotAudio = mode === 'h3-audio';
  const lipsync = reuseShotAudio;
  const dur = Math.max(0.5, Number(shot.duration_sec) || 10);
  const videoModel = resolveDramaShotVideoModel(shot.model_params, session.meta.videoBatchModel, {
    hasDialogue: dramaShotHasSpokenDialogue(shot),
    hasShotAudio: !!String(shot.audio_url || '').trim(),
  });
  const maxImages = dramaVideoModelMaxRefImages(videoModel);
  const slots = listDramaShotRefImageSlots(session, shot, { maxImages });
  const charIds = resolveCharacterIdsForShot(session, shot);
  const chars = charIds
    .map((id) => session.bible.characters.find((c) => c.character_id === id))
    .filter(Boolean) as DramaCharacter[];
  const scene: DramaSceneAsset | null =
    session.bible.scenes.find((s) => s.scene_id === shot.scene_asset_id) || null;
  const storedBreakdown = shot.directing_breakdown;
  const storedBeatsOk =
    !!storedBreakdown?.beats?.length &&
    storedBreakdown.beats.every((b) => b.lockedCamera && b.visiblePerformance) &&
    qaDramaDirectingBeats(shot, storedBreakdown.beats).ok;
  let liveBreakdown = storedBeatsOk
    ? storedBreakdown
    : buildDramaDirectingBreakdown(session, shot, null);
  let events: DramaTimelineEvent[] = liveBreakdown?.beats?.length
    ? breakdownBeatsToTimelineEvents(shot, liveBreakdown)
    : Array.isArray(shot.timeline_events)
      ? shot.timeline_events
      : [];
  const liveTimes = Array.isArray(shot.timeline_events) ? shot.timeline_events : [];
  if (liveTimes.length) {
    const finiteSec = (v: unknown, fallback: number) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    if (!events.length || liveTimes.length !== events.length) {
      events = liveTimes;
    } else {
      events = events.map((e, i) => {
        const byId = liveTimes.find((x) => x.event_id && x.event_id === e.event_id);
        const src = byId || liveTimes[i];
        if (!src) return e;
        return {
          ...e,
          start_sec: finiteSec(src.start_sec, e.start_sec),
          end_sec: finiteSec(src.end_sec, e.end_sec),
          visual_action: String(src.visual_action || '').trim() || e.visual_action,
          camera_action: String(src.camera_action || '').trim() || e.camera_action,
          dialogue: String(src.dialogue || '').trim() || e.dialogue,
          dialogue_character_id:
            String(src.dialogue_character_id || '').trim() || e.dialogue_character_id,
          environment_audio: Array.isArray(src.environment_audio)
            ? src.environment_audio
            : e.environment_audio,
          lip_sync: typeof src.lip_sync === 'boolean' ? src.lip_sync : e.lip_sync,
        };
      });
    }
  }
  events = differentiateDuplicateTimelineCuts(events);
  let audioTimeline = resolveDramaShotAudioTimeline(session, {
    ...shot,
    timeline_events: events,
  });
  const nameById = new Map(
    (session.bible.characters || []).map((c) => [c.character_id, c.name] as const),
  );
  const dialoguePlan = resolveDramaH3DialoguePlan(audioTimeline, nameById);
  const hasDlgEvents = dialoguePlan.dialogue;
  const silentMulti = !hasDlgEvents && !reuseShotAudio;
  // H3 会把 <d> 外中文念成台词；出片正文一律英文骨架
  const en = true;
  const allowedSpoken = dialoguePlan.dialogueEvents.map((d) => d.text);
  const scrubOpts = { allowedSpoken: hasDlgEvents ? allowedSpoken : [] };
  if (!hasDlgEvents) {
    audioTimeline = [];
  } else {
    const keys = new Set(
      dialoguePlan.dialogueEvents.map((d) => `${d.character_id}\t${d.text}`),
    );
    audioTimeline = audioTimeline.filter((a) =>
      keys.has(`${String(a.character_id || '').trim()}\t${String(a.text || '').trim()}`),
    );
  }
  events = events.map((e) => ({
    ...e,
    visual_action: scrubH3SpeechLeak(e.visual_action, scrubOpts),
    environment_audio: scrubH3EnvironmentAudio(e.environment_audio, scrubOpts),
    ...(hasDlgEvents ? {} : { dialogue: '', dialogue_character_id: '', lip_sync: false }),
  }));
  if (liveBreakdown?.beats?.length) {
    liveBreakdown = {
      ...liveBreakdown,
      beats: liveBreakdown.beats.map((b) =>
        scrubDramaDirectingBeatSpeech(b, {
          allowedSpoken: scrubOpts.allowedSpoken,
          noDialogue: !hasDlgEvents,
        }),
      ),
    };
  }
  const audioSlots =
    lipsync || !hasDlgEvents ? [] : listDramaShotRefAudioSlots(session, shot, 3);
  const doLipsync = reuseShotAudio && hasDlgEvents;
  const perf = shot.performance_plan || [];
  const envContains =
    shot.audio_contains_environment !== undefined
      ? !!shot.audio_contains_environment
      : lipsync;
  const generateEnv = !lipsync && !envContains;
  const generateDlg = !lipsync && hasDlgEvents;

  const picNoByAsset = new Map<string, number>();
  const lockByIndex = new Map<number, DramaReferenceLockIntent>();
  slots.forEach((s, i) => {
    if (s.asset_id) picNoByAsset.set(s.asset_id, i + 1);
    lockByIndex.set(i + 1, s.lock_intent || defaultDramaReferenceLockIntent(s.role));
  });
  const scenePic = scene ? picNoByAsset.get(scene.scene_id) || null : null;
  const hasVisualAnchor = [...lockByIndex.values()].includes('visual_anchor');
  const charById = new Map(chars.map((c) => [c.character_id, c]));
  const subjectNoByChar = new Map<string, number>();
  let subjectN = 0;

  const defLines: string[] = [];
  slots.forEach((slot, i) => {
    const pic = i + 1;
    const intent = lockByIndex.get(pic) || defaultDramaReferenceLockIntent(slot.role);
    if (slot.role === 'storyboard') {
      defLines.push(
        lockIntentLine(intent === 'identity' ? 'composition' : intent, pic, silentMulti || en),
      );
      return;
    }
    if (slot.role === 'scene') {
      defLines.push(
        silentMulti || en
          ? `${lockIntentLine(intent, pic, true)} Scene from image ${pic}.`
          : `${lockIntentLine(intent, pic)}本镜场景「${slot.name || scene?.name || '场景'}」。`,
      );
      return;
    }
    if (slot.role === 'character') {
      subjectN += 1;
      const id = String(slot.asset_id || '');
      if (id) subjectNoByChar.set(id, subjectN);
      const ch = charById.get(id);
      const sid = speakerIdForCharacter(session, id);
      const g = genderLabel(ch);
      const looks = appearanceBits(ch || ({ visual: {} } as DramaCharacter));
      const lookStr = looks.length ? looks.join('、') : '可识别的面部特征、发型与服饰';
      const who = uniqJoin([ch?.age, g, ch?.identity || ch?.role], '，');
      const speaks = audioTimeline.some((a) => a.character_id === id);
      const speak = speaks
        ? silentMulti || en
          ? `Speaker (${sid || `S${subjectN}`}).`
          : `${pronoun(ch)}是说话人（${sid || `主体${subjectN}`}）。`
        : silentMulti || en
          ? 'Silent on camera.'
          : `${pronoun(ch)} on camera.`;
      defLines.push(
        silentMulti || en
          ? `${lockIntentLine('identity', pic, true)}<主体${subjectN}> from image ${pic}. ${speak}`
          : `${lockIntentLine('identity', pic)}<主体${subjectN}>为图${pic}中的${who || g || '人物'}「${
              slot.name || ch?.name || '未命名'
            }」${sid ? `（${sid}）` : ''}，${lookStr}。${speak}`,
      );
      return;
    }
    subjectN += 1;
    defLines.push(
      silentMulti || en
        ? `${lockIntentLine(intent, pic, true)}<主体${subjectN}> from image ${pic}.`
        : `${lockIntentLine(intent, pic)}<主体${subjectN}>为图${pic}的${slot.name || slot.role}。`,
    );
  });

  for (const c of chars) {
    if (!subjectNoByChar.has(c.character_id)) {
      subjectN += 1;
      subjectNoByChar.set(c.character_id, subjectN);
    }
  }

  const audioDef: string[] = [];
  if (reuseShotAudio) {
    audioDef.push(
      hasDlgEvents
        ? `<音频1> is the uploaded full shot track (~${Math.round(dur)}s) with dialogue and ambience. Keep the original signal, timing, pauses, speaker order, and emotion. Lip-sync only to that track in dialogue windows. Do not speak this line.`
        : `<音频1> is the uploaded full shot track (~${Math.round(dur)}s), ambience/foley only, no dialogue. Keep the original signal and duration. No speaking or singing mouth shapes. Do not speak this line.`,
    );
  } else if (hasDlgEvents) {
    audioSlots.forEach((a, i) => {
      const sn = subjectNoByChar.get(a.character_id);
      const sid = speakerIdForCharacter(session, a.character_id);
      audioDef.push(
        `<音频${i + 1}> is voice-timbre reference for 「${a.character_name}」${
          sid ? ` (${sid})` : ''
        }${sn ? `, <主体${sn}>` : ''}. Timbre only — do not copy or speak the sample-script words from that clip.`,
      );
    });
  }

  // H3 会把 <d> 外中文念成台词；出片正文一律走英文骨架（对白只留在 <d>）
  const styleLocale: DramaH3CompileLocale = 'en';
  const titles = SECTION_TITLES[styleLocale];
  const stylePrompt = visualBibleStyle(session, styleLocale);

  const secA = section(
    'A',
    titles.A,
    reuseShotAudio || hasDlgEvents
      ? `${H3_SPOKEN_WORDS_LOCK} No burned-in subtitles, no on-screen captions, no readable text. Do not speak this rule.`
      : H3_NO_DIALOGUE_PROMPT_BANNER,
    [{ kind: 'system_rule', ref: hasDlgEvents || reuseShotAudio ? 'no_subtitle' : 'no_dialogue' }],
  );
  const secB = section(
    'B',
    titles.B,
    reuseShotAudio
      ? `${h3AudioModeBanner(hasDlgEvents)}\n\n${h3AudioSoundConstraint(hasDlgEvents)}\n${h3LipsyncTimelineRule(hasDlgEvents)}`
      : hasDlgEvents
        ? `${h3MultiModeBanner(true)}\n\n${h3MultiSoundConstraint(true)}\n${h3LipsyncTimelineRule(true)}`
        : 'mode=h3-multi',
    [{ kind: 'h3_mode', ref: mode }],
  );

  const refLockSummary = slots.length
    ? silentMulti || en
      ? `Image locks: ${slots
          .map((slot, i) => {
            const pic = i + 1;
            const intent = lockByIndex.get(pic) || defaultDramaReferenceLockIntent(slot.role);
            return `<图${pic}> ${intent}`;
          })
          .join('; ')}. Expand lock only in subject defs; do not repeat looks in shot lines.`
      : `【参考图锁】${slots
          .map((slot, i) => {
            const pic = i + 1;
            const intent = lockByIndex.get(pic) || defaultDramaReferenceLockIntent(slot.role);
            const lab =
              intent === 'visual_anchor'
                ? '视觉锚点'
                : intent === 'composition'
                  ? '构图'
                  : intent === 'style'
                    ? '风格'
                    : '身份';
            return `图${pic}${lab}`;
          })
          .join('；')}。锁意图只在主体定义展开，镜头段不要复述外貌。`
    : '';
  const visualLines = [
    visualBibleOnce(session, styleLocale),
    refLockSummary,
    hasVisualAnchor
      ? silentMulti || en
        ? 'Visual-anchor image owns color and light. Do not restyle in shot lines.'
        : '参考图视觉锚点优先于镜头光色描写：不要在镜头段重复「昏暗灯光/烟雾/低饱和」等已由锚点图决定的词。'
      : '',
  ];
  const secC = section('C', titles.C, visualLines.filter(Boolean).join('\n'), [
    { kind: 'visual_bible', ref: session.bible.projectVisualBible?.presetId || 'visual' },
    ...slots.map((s) => ({ kind: 'reference', ref: `图${s.index}:${s.role}` })),
  ]);

  const secD = section(
    'D',
    titles.D,
    [
      silentMulti || en ? '[Subjects]' : '【主体定义】',
      ...(defLines.length
        ? defLines
        : [silentMulti || en ? 'No reference images bound.' : '本镜尚未绑定参考图。']),
    ].join('\n'),
    chars.map((c) => ({
      kind: 'character',
      ref: `${c.character_id}:${c.speaker_id || ''}`,
    })),
  );

  const enhance = shot.directing_enhance;
  let prevPerfExtras = '';
  let wroteSilentMouth = false;

  const shotLines = events.map((ev, idx) => {
    const n = idx + 1;
    const rangeSec = fmtRangeSec(ev.start_sec, ev.end_sec);
    const range = formatDirectorH3TimeRange(ev.start_sec, ev.end_sec);
    const whoIds = (ev.character_ids || []).filter(Boolean);
    const segs = audioInRange(audioTimeline, ev.start_sec, ev.end_sec);
    const names = whoIds.map((id) => charById.get(id)?.name || id);
    const whoTxt = whoIds
      .map((id) => {
        const sn = subjectNoByChar.get(id);
        if (silentMulti || en) return sn ? `<主体${sn}>` : '';
        const name = charById.get(id)?.name || id;
        const sid = speakerIdForCharacter(session, id);
        return sn
          ? `<主体${sn}>「${name}」${sid ? `（${sid}）` : ''}`
          : `${name}${sid ? `（${sid}）` : ''}`;
      })
      .filter(Boolean)
      .join(silentMulti || en ? ' ' : '、');
    const beat = liveBreakdown?.beats?.[idx];
    const lipOpen = beat ? !!beat.lipSync : segs.length > 0;
    const lipHead = silentMulti || en
      ? `${range} · ${lipOpen ? 'lips open' : 'lips closed'}`
      : `${rangeSec} · ${lipOpen ? '口型开' : '口型关'}`;
    const camAct = String(ev.camera_action || '').trim()
      || (beat?.lockedCamera
        ? formatLockedCameraLine(beat.lockedCamera)
        : String(beat?.camera || '').trim());
    const prevCam = idx > 0
      ? String(events[idx - 1].camera_action || '').trim()
        || (liveBreakdown?.beats?.[idx - 1]?.lockedCamera
          ? formatLockedCameraLine(liveBreakdown.beats[idx - 1].lockedCamera!)
          : String(events[idx - 1].camera_action || '').trim())
      : '';
    const camChanged = !!camAct && (idx === 0 || !sameText(camAct, prevCam));
    const movement = beat?.lockedCamera?.cameraMovement;
    const storedVisual = String(ev.visual_action || '').trim();
    const beatVisual = scrubH3SpeechLeak(
      String(beat?.visibleAction || beat?.visiblePerformance || beat?.action || ''),
      scrubOpts,
    );
    const rawAct =
      (storedVisual &&
      events.filter((e) => visualActionKey(e.visual_action) === visualActionKey(storedVisual))
        .length > 1
        ? phasedVisualAction(events, idx)
        : storedVisual) || beatVisual;
    const act = applyGazeTargetInText(
      stripConflictingCameraLanguage(
        collapseDuplicateActionText(
          stripEmotionLabels(
            sanitizeSilentCharacterText(stripLeadingNames(rawAct, names)),
          ),
          names,
        ),
        movement,
      ),
      beat?.gazeTarget || beat?.endState?.gazeTarget,
      beat?.gazeTarget ? subjectNoByChar.get(beat.gazeTarget) : undefined,
      beat?.gazeTarget
        ? charById.get(beat.gazeTarget)?.name || locationGazeLabel(beat.gazeTarget)
        : undefined,
    );
    const alreadyHasSubject = /<主体\d+>/.test(act) || names.some((n) => n && act.startsWith(n));
    const sceneRef =
      idx === 0
        ? scenePic && lockByIndex.get(scenePic) === 'composition'
          ? reuseShotAudio
            ? `参照<图${scenePic}>构图。`
            : `Composition from <图${scenePic}>. `
          : scenePic
            ? reuseShotAudio
              ? `空间锁在<图${scenePic}>。`
              : `Space locked to <图${scenePic}>. `
            : ''
        : '';
    const camBit = camChanged
      ? reuseShotAudio
        ? `${camAct}。`
        : silentMulti || en
          ? `Camera: ${toH3SilentCameraEnglish(camAct)}. `
          : `Camera: ${camAct}. `
      : idx === 0
        ? ''
        : reuseShotAudio
          ? '机位保持。'
          : 'Camera holds. ';
    const lead = reuseShotAudio
      ? `[镜头${n}] ${lipHead}（${range}）。${sceneRef}${camBit}`
      : `[Shot ${n}] ${range}. ${sceneRef}${camBit}`;

    const pickPerf = (
      id: string,
      field: 'facial_expression' | 'eye_direction' | 'body_movement' | 'breathing' | 'head_movement' | 'hand_movement' | 'post_dialogue_reaction' | 'mouth_state',
      structured?: string,
      audioEventId?: string,
    ) =>
      pickMergedPerformanceField(perf, id, field, {
        timelineEventId: ev.event_id,
        audioEventId,
        structured,
      }).value;

    const phaseBits: string[] = [];
    if (!segs.length) {
      if (!silentMulti && !en) {
        const extrasList = compactBits([
          pickPerf(whoIds[0] || '', 'facial_expression', ''),
          pickPerf(whoIds[0] || '', 'eye_direction', ''),
        ]).filter((t) => t && !act.includes(t) && !/看向/.test(act));
        const extrasKey = extrasList.join('，');
        const extras = extrasKey && extrasKey !== prevPerfExtras ? extrasKey : '';
        prevPerfExtras = extrasKey || prevPerfExtras;
        if (extras) phaseBits.push(`${extras}。`);
      }
      if (!wroteSilentMouth && !beat && hasDlgEvents) {
        wroteSilentMouth = true;
        phaseBits.push(
          doLipsync
            ? `${rangeSec} no <d> tag this window: natural mouth, do not invent speech.`
            : `${rangeSec} no speech: mouths rest naturally. Do not speak director notes.`,
        );
      }
    } else {
      prevPerfExtras = '';
      wroteSilentMouth = false;
      const speakers = new Set(segs.map((a) => a.character_id));
      for (const a of segs) {
        const primary = primaryEventIndexForAudio(events, a) === idx;
        const sw = speakingWindow(a);
        const beforeStart = Math.max(ev.start_sec, a.start_sec);
        const afterEnd = Math.min(ev.end_sec, a.end_sec);
        const sn = subjectNoByChar.get(a.character_id);
        const tag = sn
          ? `<主体${sn}> (${a.speaker_id})`
          : `${charById.get(a.character_id)?.name || a.character_id} (${a.speaker_id})`;
        const face = pickPerf(a.character_id, 'facial_expression', ev.expression, a.event_id);
        const eye = pickPerf(a.character_id, 'eye_direction', ev.eyeline, a.event_id);
        const breath = pickPerf(a.character_id, 'breathing', '', a.event_id);
        const head = pickPerf(a.character_id, 'head_movement', '', a.event_id);
        const hand = pickPerf(a.character_id, 'hand_movement', '', a.event_id);
        const post = pickPerf(a.character_id, 'post_dialogue_reaction', '', a.event_id);
        const mouth = pickPerf(a.character_id, 'mouth_state', '', a.event_id);
        if (beforeStart + 0.12 < sw.start && ev.start_sec < sw.start) {
          const t0 = formatDirectorH3TimeRange(beforeStart, Math.min(ev.end_sec, sw.start));
          phaseBits.push(
            en
              ? `${t0} pre-speech: ${tag} inhales, eyes set${face ? `, face ${toH3SilentActionEnglish(face)}` : ''}, mouth still closed.`
              : `${t0}说话前：${tag}吸气、目光先到位${face ? `，表情${face}` : ''}，尚未开口。`,
          );
        }
        if (primary && overlaps(ev.start_sec, ev.end_sec, sw.start, sw.end)) {
          const t1 = formatDirectorH3TimeRange(
            Math.max(ev.start_sec, sw.start),
            Math.min(ev.end_sec, sw.end),
          );
          const timbre = reuseShotAudio
            ? 'Lip-sync to <音频1> in this window. Face and mouth visible. Do not speak prompt notes.'
            : (() => {
                const aud = audioSlots.findIndex((x) => x.character_id === a.character_id) + 1;
                return aud > 0
                  ? `Lip-sync. Timbre from <音频${aud}>. Speak ONLY the <d> words.`
                  : 'Lip-sync. Speak ONLY the <d> words.';
              })();
          const live = en
            ? ''
            : uniqJoin(
                [face && `表情${face}`, eye && `视线${eye}`, breath, head, hand, mouth && `口型${mouth}`],
                '，',
              );
          const spoken = h3SpokenD(a.text);
          phaseBits.push(
            reuseShotAudio
              ? `${t1} speaking window: ${tag} mouths the existing soundtrack. ${timbre}${live ? ` ${live}.` : ''}`
              : `${t1} ${tag} says ${spoken} ${timbre}${live ? ` Visual-only: ${live}.` : ''}`.trim(),
          );
        } else if (!primary && overlaps(ev.start_sec, ev.end_sec, sw.start, sw.end)) {
          phaseBits.push(
            `${formatDirectorH3TimeRange(
              Math.max(ev.start_sec, sw.start),
              Math.min(ev.end_sec, sw.end),
            )} same line continues; do not start a new spoken sentence.`,
          );
        }
        if (sw.end + 0.12 < afterEnd && ev.end_sec > sw.end) {
          const t2 = formatDirectorH3TimeRange(Math.max(ev.start_sec, sw.end), afterEnd);
          phaseBits.push(
            `${t2} after speech: ${tag} closes mouth${
              post ? `, ${en ? toH3SilentActionEnglish(post) : post}` : ''
            }, ${en ? 'breath settles' : breath || 'breath settles'}. Do not speak the next line early.`,
          );
        }
      }
      const listeners = whoIds.filter((id) => !speakers.has(id));
      if (listeners.length) {
        phaseBits.push(
          `${listeners
            .map((id) => {
              const sn = subjectNoByChar.get(id);
              return sn ? `<主体${sn}>` : en ? '' : charById.get(id)?.name || '';
            })
            .filter(Boolean)
            .join(en ? ' ' : '、')} listener(s). ${H3_LISTENER_MOUTH_RULE}`,
        );
      }
      if (segs.length >= 2) {
        const ordered = [...segs].sort((a, b) => a.start_sec - b.start_sec);
        for (let i = 0; i < ordered.length - 1; i += 1) {
          const gap0 = speakingWindow(ordered[i]).end;
          const gap1 = speakingWindow(ordered[i + 1]).start;
          const g0 = Math.max(ev.start_sec, gap0);
          const g1 = Math.min(ev.end_sec, gap1);
          if (g1 - g0 >= 0.25) {
            phaseBits.push(`${formatDirectorH3TimeRange(g0, g1)} pause: no extra speech.`);
          }
        }
      }
    }

    const env = (ev.environment_audio || []).filter(Boolean);
    let envBit = '';
    if (env.length) {
      if (lipsync || envContains) {
        envBit = en
          ? `${range} ambience already on track: ${toH3SilentFoleyEnglish(env).join(', ') || env.join(', ')}. `
          : `${rangeSec}环境（已在声轨）：${env.join('、')}。`;
      } else if (silentMulti || en) {
        const foley = toH3SilentFoleyEnglish(env);
        envBit = foley.length ? `${range} Foley: ${foley.join(', ')}. ` : '';
      } else {
        envBit = `${rangeSec} Foley (not spoken): ${env.join(', ')}. ${
          hasDlgEvents ? 'Do not cover speech. ' : ''
        }`;
      }
    }

    const focus =
      !silentMulti && !en && idx === 0 && enhance?.focus_behavior
        ? `焦点：${stripConflictingCameraLanguage(
            stripEmotionLabels(sanitizeSilentCharacterText(enhance.focus_behavior)),
            movement,
          )}。`
        : '';
    const envAct =
      !silentMulti && !en && idx === 0 && enhance?.subtle_environment_action
        ? `${stripConflictingCameraLanguage(
            stripEmotionLabels(sanitizeSilentCharacterText(enhance.subtle_environment_action)),
            movement,
          )}。`
        : '';
    const silentAct = silentMulti || en ? toH3SilentActionEnglish(act || 'in frame') : '';
    const actionBit = silentMulti || en
      ? alreadyHasSubject
        ? silentAct
          ? `${silentAct}. `
          : ''
        : whoTxt
          ? `${whoTxt} ${silentAct}. `
          : silentAct
            ? `${silentAct}. `
            : ''
      : alreadyHasSubject
        ? act
          ? `${reuseShotAudio ? `${act}。` : `${h3UnspokenVisual(act)}. `}`
          : ''
        : whoTxt
          ? `${whoTxt}${reuseShotAudio ? `${act || '在场'}。` : ` ${h3UnspokenVisual(act || 'in frame')}. `}`
          : act
            ? reuseShotAudio
              ? `${act}。`
              : `${h3UnspokenVisual(act)}. `
            : '';
    const perfBit = '';
    const dlgBit =
      !hasDlgEvents
        ? ''
        : !segs.length && beat
          ? beat.lipSync && beat.dialogue
            ? reuseShotAudio
              ? `Soundtrack already contains ${h3SpokenD(beat.dialogue)}; do not add new speech.`
              : `${whoTxt || 'Speaker'} says ${h3SpokenD(beat.dialogue)} Speak only those <d> words.`
            : ''
          : '';
    const out = scrubH3SpeechLeak(
      applyGazeTargetInText(
        String(beat?.continuityOut || '').trim(),
        beat?.gazeTarget || beat?.endState?.gazeTarget,
        beat?.gazeTarget ? subjectNoByChar.get(beat.gazeTarget) : undefined,
        beat?.gazeTarget ? charById.get(beat.gazeTarget)?.name : undefined,
      ),
      scrubOpts,
    );
    const handoff =
      idx === events.length - 1 && out
        ? reuseShotAudio
          ? `${out.startsWith('本镜结束') ? out : `本镜结束${/^(保持|承接)/.test(out) ? '' : '保持'}${out}`}。`
          : silentMulti || en
            ? 'Hold. '
            : `End-hold (do not speak): ${out}. `
        : '';
    return `${lead}${actionBit}${perfBit}${dlgBit}${focus}${envAct}${phaseBits.join('')}${envBit}${handoff}`.replace(/。+/g, '。');
  });

  const overview = reuseShotAudio
    ? [
        '【参考素材生成+音频复用】',
        `目标视频时长${Math.round(dur)}秒，分${events.length || 1}个镜头。`,
        chars.map((c) => c.name).filter(Boolean).join('、')
          ? `出场：${chars.map((c) => c.name).filter(Boolean).join('、')}。`
          : '',
        scenePic ? `场景锁在<图${scenePic}>，后续镜头不重复锁场景。` : '',
        audioTimeline.length
          ? `对白按 Audio Timeline 写入对应镜头时间窗（说话前/说话中/停顿/说完后）。`
          : '本镜 Audio Timeline 无对白事件；成片原样使用<音频1>，禁止开口说话或唱歌。',
      ]
        .filter(Boolean)
        .join('')
    : [
        '[reference generation] ',
        `Target length ${Math.round(dur)}s, ${events.length || 1} shots. `,
        chars.map((c) => c.name).filter(Boolean).join('、')
          ? silentMulti || en
            ? ''
            : `Cast: ${chars.map((c) => c.name).filter(Boolean).join(', ')}. `
          : '',
        scenePic ? `Scene locked to <图${scenePic}>. ` : '',
        audioTimeline.length
          ? 'Speech only from <d>[Chinese] tags in the shot windows below. Do not speak this summary. '
          : '',
      ]
        .filter(Boolean)
        .join('');

  const retention: string[] = [];
  slots.forEach((slot, i) => {
    const pic = i + 1;
    const intent = lockByIndex.get(pic) || defaultDramaReferenceLockIntent(slot.role);
    if (slot.role === 'scene' || slot.role === 'storyboard') {
      retention.push(
        silentMulti || en
          ? `<图${pic}> ${intent} lock. Keep the scene; do not invent a new one.`
          : `<图${pic}>（${lockIntentName(intent, locale)}）：按该锁意图保留，不另造场景。`,
      );
      return;
    }
    if (slot.role === 'character') {
      const id = String(slot.asset_id || '');
      const sn = subjectNoByChar.get(id);
      retention.push(
        silentMulti || en
          ? `<主体${sn || 1}>: keep identity and costume from the subject def.`
          : `<主体${sn || 1}>：身份与服饰按主体定义保留，镜头段不要复述外貌。`,
      );
    }
  });

  const detailedHead = silentMulti || en
    ? 'Shot lines: camera, physical action, Foley. Speech only inside <d> tags.'
    : hasVisualAnchor
      ? '镜头段只写人物、动作、机位变化与表演；色彩光影材质以视觉锚点图为准。不要添加字幕、文字、水印或额外主要人物。'
      : '镜头段只写本镜机位、动作与表演，不要重复全局视觉圣经。不要添加字幕、文字、水印或额外主要人物。';

  const secE = section(
    'E',
    titles.E,
    [
      silentMulti || en ? '[Overview]' : '【概述】',
      overview,
      '',
      silentMulti || en ? '[Keep]' : '【内容保留分析】',
      ...(retention.length
        ? retention
        : [silentMulti || en ? 'Keep reference identity across windows.' : '参考图身份须跨时段完整保留。']),
      '',
      silentMulti || en ? '[Shots]' : '【详细描述】',
      detailedHead,
      ...(shotLines.length
        ? shotLines
        : [
            silentMulti || en
              ? '[Shot 1] Camera and action.'
              : `[镜头1] 按本镜机位完成调度。${H3_NATURAL_NO_DIALOGUE_MOUTH_RULE}`,
          ]),
    ].join('\n'),
    events.map((e) => ({ kind: 'shot_timeline', ref: e.event_id })),
  );

  const debugPerf: DramaH3CompileDebug['performance_plan'] = [];
  for (const ev of events) {
    const segs = audioInRange(audioTimeline, ev.start_sec, ev.end_sec);
    const speakers = new Set(segs.map((a) => a.character_id));
    for (const id of ev.character_ids || []) {
      debugPerf.push({
        beat_id: `sys-${ev.event_id || 'ev'}-${id}`,
        character_id: id,
        source: speakers.has(id) ? 'structured' : 'system_constraint',
        mouth_state: speakers.has(id) ? 'speaking' : 'natural',
        facial_expression: pickMergedPerformanceField(perf, id, 'facial_expression', {
          timelineEventId: ev.event_id,
          structured: ev.expression,
        }).value,
      });
    }
  }

  const secF = section(
    'F',
    titles.F,
    hasDlgEvents
      ? [
          'Performance by window: pre-speech (inhale / eyes set / mouth closed) → speaking (lips follow <d>) → pause (rest mouth) → after (close / react). Do not speak this line.',
        ].join('')
      : silentMulti || en
        ? 'No dialogue. Camera, action, Foley only.'
        : '本镜无对白：只写机位、动作与环境音。',
    [
      { kind: 'performance', source: 'system_constraint' },
      ...perf.map((b) => ({ kind: 'performance', ref: b.beat_id, source: b.source })),
    ],
  );

  const envAxis = events
    .map((e) => {
      const items = (e.environment_audio || []).map((x) => String(x || '').trim()).filter(Boolean);
      if (!items.length) return '';
      if (silentMulti || en) {
        const foley = toH3SilentFoleyEnglish(items);
        return foley.length
          ? `${formatDirectorH3TimeRange(e.start_sec, e.end_sec)} ${foley.join(', ')}`
          : '';
      }
      return `${fmtRangeSec(e.start_sec, e.end_sec)} ${items.join('、')}`;
    })
    .filter(Boolean);
  const dlgAxis = audioTimeline.map((a) =>
    reuseShotAudio
      ? `${fmtRangeSec(a.start_sec, a.end_sec)} ${a.speaker_id} ${
          charById.get(a.character_id)?.name || a.character_id
        } — words already in <音频1>`
      : `${fmtRangeSec(a.start_sec, a.end_sec)} ${a.speaker_id} ${
          charById.get(a.character_id)?.name || a.character_id
        } — spoken words only in the matching <d>[Chinese] tag above; do not speak this label`,
  );
  const gAudio = lipsync
    ? [
        '[Audio]',
        ...audioDef,
        '',
        '[Audio Timeline]',
        ...(dlgAxis.length ? dlgAxis : ['(no structured dialogue events)']),
        '',
        '[Foley]',
        ...(envAxis.length ? envAxis : ['(no foley cues)']),
        '',
        '[Sound]',
        `Reuse <音频1> as-is. ${
          envContains || envAxis.length
            ? 'Ambience is already on that track; do not invent speech or ambience.'
            : 'Do not invent speech, ambience, or BGM.'
        }${hasDlgEvents ? ' Foley must not cover dialogue.' : ' No dialogue; do not add speech.'}`,
      ]
    : silentMulti || en
      ? [
          '[Audio]',
          audioDef.length ? audioDef.join('\n') : 'No character voice reference.',
          '',
          '[Audio Timeline]',
          ...(dlgAxis.length ? dlgAxis : ['(no dialogue events)']),
          '',
          '[Foley]',
          ...(envAxis.length ? envAxis : ['(no foley cues)']),
          '',
          '[Sound]',
          generateDlg
            ? `Speech = only <d> tags in detailed_description. ${
                generateEnv ? 'Foley from environment axis, never covering speech. ' : ''
              }No extra voices, no reading director notes, no BGM.`
            : `${generateEnv ? 'No speech. Foley from environment axis. ' : 'No speech. '}No BGM, no reading director notes.`,
        ]
      : [
        '【音频定义】',
        ...(audioDef.length ? audioDef : ['本镜无对白，不使用角色音色参考。']),
        '',
        '【Audio Timeline】',
        ...(dlgAxis.length ? dlgAxis : ['（无对白事件）']),
        '',
        '【环境轴】',
        ...(envAxis.length ? envAxis : ['（无分段环境音）']),
        '',
        '【整体声景】',
        generateDlg
          ? `Speech = only <d> tags in detailed_description. ${
              generateEnv ? 'Foley from environment axis, never covering speech. ' : ''
            }No extra voices, no reading director notes, no BGM.`
          : `${generateEnv ? 'No speech. Foley from environment axis. ' : 'No speech. '}No BGM, no reading director notes.`,
      ];
  const secG = section('G', titles.G, gAudio.filter(Boolean).join('\n'), [
    { kind: 'audio_timeline' },
    ...audioTimeline.map((a) => ({ kind: 'audio_timeline', ref: a.event_id })),
  ]);

  const secH = section(
    'H',
    titles.H,
    hasDlgEvents
      ? [
          '[Negative]',
          'No burned-in subtitles, no on-screen captions, no readable text, no watermark, no logo, no UI.',
          'Do not invent BGM, songs, extra voices, or read prompt instructions aloud.',
          'Do not change locked character identity, costume, or scene structure.',
        ].join('\n')
      : [
          silentMulti || en ? '[Negative]' : '【负向约束】',
          'No BGM. No watermark. No logo. No UI. Do not change locked identity, costume, or scene.',
        ].join('\n'),
    [{ kind: 'negative', ref: 'system_rule' }],
  );

  const sections = [secA, secB, secC, secD, secE, secF, secG, secH];
  const liveBeats = liveBreakdown?.beats || [];
  let final_prompt = repairCompiledDramaPromptCameraLanguage(
    sections.map((s) => s.text).filter(Boolean).join('\n\n'),
    liveBeats,
  );
  final_prompt = replaceDramaAnonymousCastLabel(
    final_prompt,
    chars.map((c) => String(c.name || '').trim()).filter(Boolean),
  );
  const qa = mergeQaReports(
    qaDramaDirectingBeats(shot, liveBeats),
    qaCompiledDramaPrompt(final_prompt, { hasDialogue: hasDlgEvents, beats: liveBeats }),
  );
  if (!qa.ok && !opts?.skipQaRebuild) {
    const rebuilt = buildDramaDirectingBreakdown(session, shot, null);
    return compileDramaH3Prompt(
      session,
      { ...shot, directing_breakdown: rebuilt },
      mode,
      { ...opts, skipQaRebuild: true },
    );
  }

  const debug: DramaH3CompileDebug = {
    mode,
    dialogue: hasDlgEvents,
    dialogue_mode: dialoguePlan.dialogue_mode,
    dialogue_events: dialoguePlan.dialogueEvents,
    prompt_version: dramaH3PromptVersion(hasDlgEvents),
    audio_reference_intended: !lipsync && hasDlgEvents && audioSlots.length > 0,
    audio_mode: lipsync ? 'lip_sync' : 'character_reference',
    duration_sec: dur,
    visual_bible: {
      preset_id: session.bible.projectVisualBible?.presetId,
      style_prompt: stylePrompt,
      used_in_section: 'C',
    },
    references: slots.map((s, i) => ({
      index: s.index,
      role: s.role,
      lock_intent: lockByIndex.get(i + 1) || defaultDramaReferenceLockIntent(s.role),
      name: s.name,
      url: s.url,
      asset_id: s.asset_id,
    })),
    characters: chars.map((c) => ({
      character_id: c.character_id,
      speaker_id: (c.speaker_id as DramaSpeakerId) || speakerIdForCharacter(session, c.character_id) || '',
      name: c.name,
      subject_n: subjectNoByChar.get(c.character_id),
      audio_slot_n: lipsync
        ? undefined
        : (() => {
            const i = audioSlots.findIndex((a) => a.character_id === c.character_id);
            return i >= 0 ? i + 1 : undefined;
          })(),
    })),
    shots: events.map((e, i) => ({
      timeline_event_id: e.event_id,
      start_sec: e.start_sec,
      end_sec: e.end_sec,
      camera: liveBreakdown?.beats?.[i]?.lockedCamera
        ? formatLockedCameraLine(liveBreakdown.beats[i].lockedCamera!)
        : e.camera_action || '',
      character_ids: e.character_ids || [],
      audio_event_ids: audioInRange(audioTimeline, e.start_sec, e.end_sec).map((a) => a.event_id),
    })),
    audio_timeline: audioTimeline,
    performance_plan: debugPerf,
    environment_audio: events
      .filter((e) => (e.environment_audio || []).length)
      .map((e) => ({
        start_sec: e.start_sec,
        end_sec: e.end_sec,
        items: e.environment_audio || [],
      })),
    constraints: {
      no_subtitle: true,
      no_bgm: true,
      lipsync_reuse_shot_audio: lipsync,
      generate_dialogue: generateDlg,
      generate_environment: generateEnv,
    },
    provenance: { sections, final_prompt },
    qa,
    final_prompt,
    ...(String(shot.final_prompt || '').trim()
      ? { legacy_final_prompt: String(shot.final_prompt).trim() }
      : {}),
  };
  return debug;
}

/** 兼容旧调用名：只返回编译正文 */
export function composeDramaH3OfficialSixSection(
  session: DramaDirectorSession,
  shot: DramaShot,
  mode?: DramaH3CompileMode,
  opts?: { locale?: DramaH3CompileLocale | string },
): string {
  const m: DramaH3CompileMode = mode || 'h3-multi';
  return compileDramaH3Prompt(session, shot, m, opts).final_prompt;
}
