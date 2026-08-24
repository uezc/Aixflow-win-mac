/**
 * 导演镜头：时长估算 + 秒级时间轴（启发式 / LLM 结果归一化）
 */

import { createEmptyDramaShot, formatDramaDialogueLines, snapDramaPlanDurationSec } from './factories.js';
import { applyDramaDirectingBreakdownToShot } from './directingBreakdown.js';
import { ensureAppearingCharactersInBible } from './ensureAppearingCharacters.js';
import {
  replaceDramaAnonymousCastLabel,
  syncDramaShotCharacterIds,
} from './shotCastGate.js';
import { ensureDramaShotTimelineEvents, buildHeuristicTimelineEvents, isDramaTimelineEventsThin, normalizeDramaTimelineEvents, rescaleDramaTimelineEventsToDuration, createEmptyDramaTimelineEvent } from './timelineEvent.js';
import type {
  DramaCharacter,
  DramaDirectorSession,
  DramaShot,
  DramaShotTimelineBeat,
  DramaTimelineEvent,
  DramaVoice,
} from './types.js';

export const DRAMA_SHOT_DURATION_MIN = 6;
export const DRAMA_SHOT_DURATION_MAX = 20;
/** MiniMax H3 支持的成片时长档：6 / 10 / 15 / 20 秒 */
export const DRAMA_SHOT_DURATION_TIERS = [6, 10, 15, 20] as const;

/**
 * 将规划时长落到模型支持的档位（最近档；并列时取不短于规划的档）。
 */
export function snapDramaShotDurationSec(sec: number): number {
  return snapDramaPlanDurationSec(sec, 10);
}

export function clampDramaShotDuration(sec: number): number {
  return snapDramaShotDurationSec(sec);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 中文对白语速约 4 字/秒 + 气口 */
export function estimateDialogueSeconds(dialogueText: string): number {
  const t = String(dialogueText || '').replace(/\s+/g, '');
  if (!t) return 0;
  const chars = t.length;
  return chars / 4 + 0.4;
}

function cameraComplexityBonus(move: string, size: string): number {
  const m = String(move || '');
  const s = String(size || '');
  let bonus = 1.2;
  if (/推|拉|摇|移|跟|升|降|环绕|dolly|pan|tilt|track/i.test(m)) bonus += 1.5;
  if (/慢|缓/i.test(m)) bonus += 1;
  if (/全景|大远|建立/i.test(s) || /建立|环境/i.test(m)) bonus += 1;
  if (/近景|特写/i.test(s)) bonus += 0.5;
  return bonus;
}

function actionComplexityBonus(action: string): number {
  const a = String(action || '');
  if (!a.trim()) return 2;
  let bonus = Math.min(6, a.length / 28);
  if (/对峙|掏|拔|追|跑|打|摔|转身|逼近|跃|踢|逃/i.test(a)) bonus += 2;
  return bonus;
}

/** 按对白 + 动作 + 运镜估算，并落到 6 / 10 / 15 / 20 秒档 */
export function estimateDramaShotDurationSec(shot: Pick<
  DramaShot,
  'dialogue' | 'action' | 'move' | 'size' | 'purpose' | 'sfx' | 'duration_sec'
>): number {
  const dlg = formatDramaDialogueLines(shot.dialogue || []);
  const dialogueSec = estimateDialogueSeconds(dlg);
  const actionSec = actionComplexityBonus(shot.action);
  const camSec = cameraComplexityBonus(shot.move, shot.size);
  const sfxSec = String(shot.sfx || '').trim() ? 1 : 0;
  const purposeSec = String(shot.purpose || '').includes('建立') ? 1.2 : 0;
  // 基础偏长：鼓励单镜塞入多段动作/对白，而不是切成 3–5s 碎镜
  const raw = 8 + dialogueSec + actionSec + camSec + sfxSec + purposeSec;
  return snapDramaShotDurationSec(raw);
}

export function normalizeTimelineBeats(
  beats: DramaShotTimelineBeat[] | undefined | null,
  durationSec: number,
): DramaShotTimelineBeat[] {
  const dur = clampDramaShotDuration(durationSec);
  const raw = Array.isArray(beats) ? beats : [];
  const cleaned = raw
    .map((b) => ({
      start_sec: Math.max(0, Number(b.start_sec) || 0),
      end_sec: Math.max(0, Number(b.end_sec) || 0),
      text: stripDirectorBeatTimePrefix(String(b.text || '').trim()),
      ...(b.kind ? { kind: String(b.kind) } : {}),
    }))
    .filter((b) => b.text && b.end_sec > b.start_sec)
    .sort((a, b) => a.start_sec - b.start_sec || a.end_sec - b.end_sec);

  if (!cleaned.length) return buildHeuristicTimelineBeats({} as DramaShot, dur);

  // 拉伸/裁剪到覆盖 0 → dur
  const last = cleaned[cleaned.length - 1];
  const scale = last.end_sec > 0 ? dur / last.end_sec : 1;
  const scaled = cleaned.map((b) => ({
    ...b,
    start_sec: round1(b.start_sec * scale),
    end_sec: round1(b.end_sec * scale),
  }));
  if (scaled[0]) scaled[0].start_sec = 0;
  if (scaled.length) scaled[scaled.length - 1].end_sec = dur;
  // 填缝：若有空隙，并入前一拍 end
  for (let i = 1; i < scaled.length; i += 1) {
    if (scaled[i].start_sec > scaled[i - 1].end_sec) {
      scaled[i].start_sec = scaled[i - 1].end_sec;
    }
  }
  return scaled;
}

/** 旧粗时间轴 / 标签体：需重写为导演级自然语言 */
export function isDramaTimelineThin(
  beats: DramaShotTimelineBeat[] | undefined | null,
): boolean {
  const list = Array.isArray(beats) ? beats : [];
  if (!list.length) return true;
  return list.some((b) => {
    const t = String(b?.text || '').trim();
    if (!t) return true;
    if (/【谁】|【在哪】|【动作】|【说话】|【人物】|【地点】|【台词】/.test(t)) return true;
    if (/\[action\]|\[dialogue\]|\[camera\]|\[sfx\]|\[env\]/i.test(t)) return true;
    if (/做铺垫|引出人物|叙事作用|剧情目的|稳住身形|已就位|主要活动区域/.test(t)) return true;
    const body = stripDirectorBeatTimePrefix(t);
    // 合格：够长、含机位/运镜线索、非纯关键词列表
    if (body.length < 36) return true;
    if (!/(中景|近景|全景|远景|特写|固定|推|拉|摇|移|跟|升|降|镜头)/.test(body)) return true;
    return false;
  });
}

/** 去掉「0–4 秒｜」前缀，便于展示去重或二次拼接 */
export function stripDirectorBeatTimePrefix(text: string): string {
  return String(text || '')
    .trim()
    .replace(/^\d+(\.\d+)?\s*[–—\-]\s*\d+(\.\d+)?\s*秒\s*｜\s*/, '');
}

/** 标准展示/导出：起始秒–结束秒｜正文 */
export function formatDirectorTimelineBeatDisplay(beat: DramaShotTimelineBeat): string {
  const raw = String(beat?.text || '').trim();
  if (/^\d+(\.\d+)?\s*[–—\-]\s*\d+(\.\d+)?\s*秒\s*｜/.test(raw)) return raw;
  return `${formatTimelineRange(beat.start_sec, beat.end_sec)}｜${raw}`;
}

function fmtLensMoveSfx(size: string, angle: string, move: string, sfxBit: string): string {
  const lens = `${size || '中景'}${angle || '正面'}`;
  const cam = move || '固定镜头';
  return [lens, cam, sfxBit].filter(Boolean).join('，');
}

/**
 * 无 LLM 时：生成导演级自然语言时间轴（禁止标签/键值对/叙事目的）。
 * text 存正文（不含时间前缀）；展示时用 formatDirectorTimelineBeatDisplay。
 * 对白格式：人物名称（台词）（情绪）：“对白原文”
 */
export function buildHeuristicTimelineBeats(
  shot: Partial<DramaShot>,
  durationSec?: number,
  ctx?: {
    characterNames?: string[];
    sceneName?: string;
    sceneLocation?: string;
    sceneAnchors?: string;
  },
): DramaShotTimelineBeat[] {
  const dur = clampDramaShotDuration(durationSec ?? estimateDramaShotDurationSec({
    dialogue: shot.dialogue || [],
    action: String(shot.action || ''),
    move: String(shot.move || ''),
    size: String(shot.size || ''),
    purpose: String(shot.purpose || ''),
    sfx: String(shot.sfx || ''),
    duration_sec: Number(shot.duration_sec) || 5,
  }));

  const namesFromCtx = (ctx?.characterNames || []).filter(Boolean);
  const namesFromDlg = (shot.dialogue || [])
    .map((d) => String(d.character_name || '').trim())
    .filter(Boolean);
  const whoList = [
    ...new Set(namesFromCtx.length ? namesFromCtx : namesFromDlg.length ? namesFromDlg : []),
  ];
  // 禁止「出场人物」占位：无姓名时用空串，后续门禁会拦截非空镜
  const lead = whoList[0] || '';
  const others = whoList.slice(1);
  const sceneTitle = String(ctx?.sceneName || '').trim();
  const loc = String(ctx?.sceneLocation || shot.environment || '').trim();
  const anchors = String(ctx?.sceneAnchors || '').trim();
  // 禁止「主要活动区域/角落」等模糊词：尽量落到具体参照物
  const where =
    [sceneTitle, loc, anchors].filter(Boolean).join('') ||
    sceneTitle ||
    loc ||
    '室内';
  const angle = String(shot.angle || shot.camera || '').trim() || '正面';
  const size = String(shot.size || shot.framing || '').trim() || '中景';
  const move = String(shot.move || '').trim() || '固定镜头';
  const expression = String(shot.expression || '').trim() || '神情平静';
  const eyeline = String(shot.eyeline || '').trim() || '目光朝向对面人物或画面纵深';
  const blocking = String(shot.blocking || '').trim();
  const action = String(shot.action || '').trim();
  const sfx = String(shot.sfx || '').trim();
  const sfxParts = sfx.split(/[，,、／/|]/).map((x) => x.trim()).filter(Boolean);

  const dialogueSpecs = (shot.dialogue || [])
    .map((d) => {
      const name =
        String(d.character_name || '').trim() ||
        lead;
      const text = String(d.text || '').trim();
      if (!text) return '';
      const emotion =
        String(d.performance?.emotion || '').trim() ||
        expression ||
        '平静情绪';
      const emoLabel = /情绪$/.test(emotion) ? emotion : `${emotion}情绪`;
      return `${name}（台词）（${emoLabel}）：“${text}”`;
    })
    .filter(Boolean);
  const hasDlg = dialogueSpecs.length > 0;
  const dlgSec = estimateDialogueSeconds(
    (shot.dialogue || []).map((d) => d.text || '').join(''),
  );

  const castExtra = (shot.cast || [])
    .map((c) => {
      const bits = [c.emotion, c.action, c.screen_position].filter(Boolean);
      return bits.length ? bits.join('，') : '';
    })
    .filter(Boolean);

  const othersState = () => {
    if (others.length) {
      return `${others.join('、')}同处画幅内，各自站位可辨，面部表情与视线随主事件变化`;
    }
    if (castExtra.length) return castExtra.slice(0, 2).join('，');
    return '';
  };

  const formatSpeak = (speaking: boolean) => {
    if (speaking && hasDlg) {
      const speaker =
        String(shot.dialogue?.[0]?.character_name || '').trim() || lead;
      return `${dialogueSpecs.join('，')}；本段音频为${speaker}对应台词人声，仅驱动${speaker}进行对口型演算，环境音作为背景音不参与口型计算`;
    }
    return '';
  };

  const prose = (opts: {
    sfxBit: string;
    motion: string;
    speaking: boolean;
    expr?: string;
  }) => {
    const envBit = opts.sfxBit
      ? opts.sfxBit.startsWith('环境音效')
        ? opts.sfxBit
        : `环境音效：${opts.sfxBit}`
      : '环境音效：场景底噪';
    const head = fmtLensMoveSfx(size, angle, move, envBit);
    const placeAct = lead
      ? `${lead}身处${where}，${opts.motion}`
      : `画面交代${where}，${opts.motion}`;
    const speak = formatSpeak(opts.speaking);
    const face = opts.expr || expression;
    const stand = blocking ? `${blocking}` : '';
    const rest = [othersState(), stand].filter(Boolean).join('，');
    const mid =
      opts.speaking && hasDlg
        ? lead
          ? `${lead}面容呈${face}，${eyeline}，${speak}`
          : `${speak}`
        : lead
          ? [speak, `${lead}面容呈${face}`, eyeline].filter(Boolean).join('，')
          : [speak, eyeline].filter(Boolean).join('，');
    const tail = rest ? `${mid}，${rest}。` : `${mid}。`;
    return `${head}。${placeAct}；${tail}`
      .replace(/；+/g, '；')
      .replace(/，+/g, '，')
      .replace(/。。+/g, '。');
  };

  const beats: DramaShotTimelineBeat[] = [];
  let t = 0;
  const push = (len: number, text: string, kind: DramaShotTimelineBeat['kind']) => {
    const span = Math.max(0.3, len);
    const end = Math.min(dur, round1(t + span));
    if (end <= t || !text.trim()) return;
    beats.push({ start_sec: t, end_sec: end, text: text.trim(), kind });
    t = end;
  };

  const establish = 0.8 + (/全景|建立|环境/i.test(String(shot.size || '')) ? 0.6 : 0);
  push(
    establish,
    prose({
      sfxBit: sfxParts[0] || '场景底噪',
      motion: action
        ? `准备：${action}`
        : `双脚站定，双手自然下垂`,
      speaking: false,
    }),
    'env',
  );

  if (action) {
    const remainForAction = Math.max(1.2, (dur - t) * (hasDlg ? 0.4 : 0.55));
    push(
      remainForAction,
      prose({
        sfxBit: sfxParts[0] || '动作带起细碎声响',
        motion: `开始执行：${action}；可见肢体从起始姿态移向落点，双手与脚步位置变化清晰`,
        speaking: false,
        expr: expression,
      }),
      'action',
    );
  }

  if (hasDlg) {
    push(
      Math.max(1.5, dlgSec),
      prose({
        sfxBit: sfxParts.slice(-1)[0] || '场景底噪压低',
        motion: `面向听者，肩线略前倾，下颌开合随语句起伏，双手保持上一落点姿态`,
        speaking: true,
        expr: expression,
      }),
      'dialogue',
    );
  }

  if (t < dur - 0.05) {
    push(
      dur - t,
      prose({
        sfxBit: sfxParts[0] || '环境声收回',
        motion: `身体停在落点姿态，胸腔随呼吸轻微起伏，双手与脚步不再大幅改位`,
        speaking: false,
      }),
      'camera',
    );
  } else if (beats.length) {
    beats[beats.length - 1].end_sec = dur;
  }

  if (!beats.length) {
    return [
      {
        start_sec: 0,
        end_sec: dur,
        text: prose({
          sfxBit: sfxParts[0] || '场景底噪',
          motion: action || '双手与双脚完成可见调度后停住',
          speaking: hasDlg,
        }),
        kind: 'action',
      },
    ];
  }
  beats[0].start_sec = 0;
  beats[beats.length - 1].end_sec = dur;
  return beats;
}

export function formatTimelineRange(start: number, end: number): string {
  const fmt = (n: number) => {
    const x = round1(n);
    return Number.isInteger(x) ? String(x) : x.toFixed(1);
  };
  return `${fmt(start)}–${fmt(end)}秒`;
}

/** 对白角色名 → 圣经角色 id；合并进 character_ids */
export function resolveCharacterIdsForShot(
  session: DramaDirectorSession,
  shot: DramaShot,
): string[] {
  const byId = new Map(session.bible.characters.map((c) => [c.character_id, c]));
  const byName = new Map(
    session.bible.characters.map((c) => [String(c.name || '').trim().toLowerCase(), c]),
  );
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (id: string) => {
    const k = String(id || '').trim();
    if (!k || seen.has(k) || !byId.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const id of shot.character_ids || []) add(id);
  for (const line of shot.dialogue || []) {
    if (line.character_id) add(line.character_id);
    const name = String(line.character_name || '').trim().toLowerCase();
    if (name && byName.has(name)) add(byName.get(name)!.character_id);
  }
  return out;
}

export function resolveVoicesForShot(
  session: DramaDirectorSession,
  shot: DramaShot,
  characters: DramaCharacter[],
): DramaVoice[] {
  const voices = session.bible.voices || [];
  const byVoiceId = new Map(voices.map((v) => [v.voice_id, v]));
  const seen = new Set<string>();
  const out: DramaVoice[] = [];
  const push = (v: DramaVoice | undefined | null) => {
    if (!v?.voice_id || seen.has(v.voice_id)) return;
    seen.add(v.voice_id);
    out.push(v);
  };
  for (const vid of shot.voice_ids || []) push(byVoiceId.get(String(vid || '').trim()));
  for (const ch of characters) {
    const linked = String(ch.voice_id || '').trim();
    if (linked) push(byVoiceId.get(linked));
    push(voices.find((v) => v.character_id === ch.character_id));
  }
  return out;
}

/** 单镜：回填人物/音色 + 时长 + 启发式时间轴 */
export function enrichDramaShotLocally(
  session: DramaDirectorSession,
  shot: DramaShot,
): DramaShot {
  shot = syncDramaShotCharacterIds(session, shot);
  const byId = new Map(session.bible.characters.map((c) => [c.character_id, c]));
  // 参考图出场以 shot.character_ids 为准；sync 已合并时间轴/文案点名
  const character_ids = (shot.character_ids || [])
    .map((id) => String(id || '').trim())
    .filter((id, i, arr) => id && byId.has(id) && arr.indexOf(id) === i);
  const characters = character_ids
    .map((id) => byId.get(id))
    .filter(Boolean) as DramaCharacter[];
  // 对白说话人仍可解析音色（即使本镜未绑人物参考图）
  const dialogueCharIds = resolveCharacterIdsForShot(session, {
    ...shot,
    character_ids,
  });
  const voiceChars = (
    dialogueCharIds.length ? dialogueCharIds : character_ids
  )
    .map((id) => byId.get(id))
    .filter(Boolean) as DramaCharacter[];
  const voices = resolveVoicesForShot(session, shot, voiceChars);
  const voice_ids = voices.map((v) => v.voice_id);
  const storedDur = Number(shot.duration_sec);
  const duration_sec =
    Number.isFinite(storedDur) && storedDur > 0
      ? snapDramaShotDurationSec(storedDur)
      : estimateDramaShotDurationSec(shot);
  const scene = session.bible.scenes.find((sc) => sc.scene_id === shot.scene_asset_id) || null;
  const beatCtx = {
    characterNames: (
      voiceChars.length ? voiceChars : characters
    )
      .map((c) => c.name)
      .filter(Boolean),
    sceneName: scene?.name,
    sceneLocation: scene?.location || '',
    sceneAnchors: [
      scene?.spatial_structure,
      Array.isArray(scene?.fixed_elements) ? scene.fixed_elements.slice(0, 6).join('、') : '',
    ]
      .filter(Boolean)
      .join('，')
      .slice(0, 160),
  };
  const hasEvents =
    Array.isArray(shot.timeline_events) &&
    shot.timeline_events.length > 0 &&
    !isDramaTimelineEventsThin(shot.timeline_events);
  const eventEnd = hasEvents
    ? Math.max(0, ...shot.timeline_events.map((e) => Number(e.end_sec) || 0))
    : 0;
  const castNames = characters.map((c) => String(c.name || '').trim()).filter(Boolean);
  const timeline_events = (hasEvents
    ? rescaleDramaTimelineEventsToDuration(
        shot.timeline_events,
        eventEnd > 0.1 ? eventEnd : duration_sec,
        duration_sec,
      )
    : buildHeuristicTimelineEvents(
        { ...shot, character_ids, duration_sec },
        duration_sec,
        {
          characterNames: beatCtx.characterNames,
          characterIds: character_ids.length ? character_ids : dialogueCharIds,
          sceneName: beatCtx.sceneName,
          sceneLocation: beatCtx.sceneLocation,
          sceneAnchors: beatCtx.sceneAnchors,
        },
      )
  ).map((ev) => {
    const evIds = (ev.character_ids || []).map(String).filter(Boolean);
    const nextIds = evIds.length ? evIds : character_ids;
    return {
      ...ev,
      character_ids: nextIds,
      visual_action: replaceDramaAnonymousCastLabel(String(ev.visual_action || ''), castNames),
      character_state: replaceDramaAnonymousCastLabel(String(ev.character_state || ''), castNames),
    };
  });
  const base = createEmptyDramaShot({
    ...shot,
    character_ids,
    action: replaceDramaAnonymousCastLabel(String(shot.action || ''), castNames),
    voice_ids: voice_ids.length ? voice_ids : shot.voice_ids,
    duration_sec,
    timeline_events,
    timeline_beats: [],
  });
  return ensureDramaShotTimelineEvents(base);
}

export function enrichAllDramaShotsLocally(session: DramaDirectorSession): DramaDirectorSession {
  const ensured = ensureAppearingCharactersInBible(session);
  const enriched = (ensured.shots || []).map((s) => enrichDramaShotLocally(ensured, s));
  const working = { ...ensured, shots: enriched };
  const shots = [...enriched];
  for (let i = 0; i < shots.length; i += 1) {
    shots[i] = applyDramaDirectingBreakdownToShot(working, shots[i], i > 0 ? shots[i - 1] : null);
  }
  return { ...ensured, shots };
}

export function buildDramaBoardEnrichMessages(
  session: DramaDirectorSession,
  opts?: { shotIds?: string[] },
): {
  systemPrompt: string;
  userPrompt: string;
} {
  const style =
    session.bible.projectVisualBible?.stylePrompt ||
    session.bible.visualDNA?.generatedPrompt ||
    session.bible.visual?.style ||
    '';
  const styleName =
    session.bible.projectVisualBible?.presetId ||
    session.bible.visualDNA?.presetId ||
    'unset';
  const chars = session.bible.characters.map((c) => ({
    id: c.character_id,
    name: c.name,
    identity: c.identity || c.role,
  }));
  const scenes = session.bible.scenes.map((s) => ({
    id: s.scene_id,
    name: s.name,
    location: s.location,
    spatial_structure: s.spatial_structure,
    fixed_elements: s.fixed_elements,
    prompt: String(s.prompt || '').slice(0, 400),
  }));
  const idFilter = new Set(
    (opts?.shotIds || []).map((x) => String(x || '').trim()).filter(Boolean),
  );
  const shots = (session.shots || [])
    .filter((s) => !idFilter.size || idFilter.has(s.shot_id))
    .map((s) => ({
    shot_id: s.shot_id,
    shot_no: s.shot_no,
    size: s.size,
    angle: s.angle || s.camera,
    move: s.move,
    action: s.action,
    blocking: s.blocking,
    expression: s.expression,
    eyeline: s.eyeline,
    sfx: s.sfx,
    dialogue: (s.dialogue || []).map((d) => ({
      character_name: d.character_name,
      character_id: d.character_id,
      text: d.text,
      emotion: d.performance?.emotion || '',
    })),
    character_ids: s.character_ids,
    scene_asset_id: s.scene_asset_id,
    duration_sec: s.duration_sec,
    cast: (s.cast || []).map((c) => ({
      character_id: c.character_id,
      screen_position: c.screen_position,
      action: c.action,
      emotion: c.emotion,
    })),
  }));

  const systemPrompt = `你负责把每镜补成「AI导演执行表」时间轴：多段视听事件 timeline_events（禁止一整段自由大 Prompt / 禁止【标签】键值对）。

每条 timeline_events 必须含：
start_sec, end_sec, character_ids[], visual_action, character_state, position, expression, eyeline,
dialogue（无台词填 ""）, dialogue_character_id（说话人 id，无台词填 ""）,
environment_audio[]（环境音，不绑人物）, lip_sync（仅有绑定对白时可为 true）, camera_action。

硬规则：
1) duration_sec 只能是 6 / 10 / 15 / 20；事件从 0 连续铺满到 duration_sec。
2) 禁止「有人说话」：有对白必须填 dialogue_character_id（用给定角色 id）。
3) lip_sync=true 仅当该段有对白且已绑定 dialogue_character_id；无台词段 lip_sync=false。
4) environment_audio 与人物对白分离；环境音不驱动口型。
5) visual_action 写可拍摄动作细节；禁止叙事目的句。一事件一段：禁止把多个独立动作写进同一 visual_action。
6) 6秒镜 2–4 段；10秒镜 3–6 段；15秒镜 4–8 段。禁止机械等分。说话人变、信息揭示、情绪反应必须分段。
7) 同步补全 shot 级 blocking/expression/eyeline/sfx/size/angle/move/action/character_ids。
8) **只处理 user JSON 里给出的 shots**（可能是分批），不要编造未给出的 shot_id。输出必须完整可解析，以 } 结束。

只输出 JSON：
{"shots":[{"shot_id":"...","duration_sec":15,"blocking":"...","expression":"...","eyeline":"...","sfx":"...","size":"...","angle":"...","move":"...","action":"...","character_ids":["tommy"],"timeline_events":[{"start_sec":0,"end_sec":3,"character_ids":["tommy"],"visual_action":"汤米从二楼栏杆跃下双脚落在一楼木地板","character_state":"愤怒","position":"二楼东北→一楼中央","expression":"怒色","eyeline":"看向帮众甲","dialogue":"","dialogue_character_id":"","environment_audio":["落地声"],"lip_sync":false,"camera_action":"中景正面·固定"},{"start_sec":6,"end_sec":9,"character_ids":["snake_a","tommy"],"visual_action":"帮众甲倒地撑起上身抬头说话","character_state":"惊恐","position":"圆桌旁地面","expression":"惊恐","eyeline":"看向汤米","dialogue":"那把枪……是托马斯的枪！","dialogue_character_id":"snake_a","environment_audio":["远处惊呼"],"lip_sync":true,"camera_action":"中景正面·固定"}]}]}
不要 markdown。`;

  const userPrompt = JSON.stringify(
    {
      visual_style_preset: styleName,
      visual_style_prompt: style.slice(0, 1200),
      characters: chars,
      scenes,
      shots,
      batch_note: idFilter.size
        ? `本批仅 ${shots.length} 镜，请只输出这些 shot_id`
        : undefined,
    },
    null,
    2,
  );

  return { systemPrompt, userPrompt };
}

/** 一键补全导演脚本：每批镜数（过多易 length 截断） */
export const DRAMA_BOARD_ENRICH_BATCH = 4;

function extractJsonObject(text: string): unknown {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* continue */
  }
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* continue */
    }
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/** 将 LLM JSON 合并进 session.shots */
export function applyDramaBoardEnrichResult(
  session: DramaDirectorSession,
  llmText: string,
): DramaDirectorSession {
  const parsed = extractJsonObject(llmText) as {
    shots?: Array<{
      shot_id?: string;
      shot_no?: string;
      duration_sec?: number;
      blocking?: string;
      expression?: string;
      eyeline?: string;
      sfx?: string;
      action?: string;
      size?: string;
      angle?: string;
      move?: string;
      character_ids?: string[];
      timeline_events?: DramaTimelineEvent[];
      timeline_beats?: DramaShotTimelineBeat[];
    }>;
  } | null;
  const list = Array.isArray(parsed?.shots) ? parsed!.shots! : [];
  if (!list.length) {
    return enrichAllDramaShotsLocally(session);
  }
  const byId = new Map(list.map((x) => [String(x.shot_id || '').trim(), x]));
  const byNo = new Map(list.map((x) => [String(x.shot_no || '').trim(), x]));

  const shots = (session.shots || []).map((s) => {
    const patch = byId.get(s.shot_id) || byNo.get(String(s.shot_no || '').trim());
    if (!patch) return enrichDramaShotLocally(session, s);
    const duration_sec = clampDramaShotDuration(
      Number(patch.duration_sec) || estimateDramaShotDurationSec({
        ...s,
        action: String(patch.action ?? s.action ?? ''),
        move: String(patch.move ?? s.move ?? ''),
        size: String(patch.size ?? s.size ?? ''),
      }),
    );
    const rawEvents = Array.isArray(patch.timeline_events)
      ? patch.timeline_events.map((e) => createEmptyDramaTimelineEvent(e))
      : [];
    const timeline_events =
      rawEvents.length && !isDramaTimelineEventsThin(rawEvents)
        ? normalizeDramaTimelineEvents(rawEvents, duration_sec)
        : [];
    const merged = createEmptyDramaShot({
      ...s,
      duration_sec,
      timeline_events,
      timeline_beats: Array.isArray(patch.timeline_beats) ? patch.timeline_beats : [],
      blocking: String(patch.blocking ?? s.blocking ?? '').trim(),
      expression: String(patch.expression ?? s.expression ?? '').trim(),
      eyeline: String(patch.eyeline ?? s.eyeline ?? '').trim(),
      sfx: String(patch.sfx ?? s.sfx ?? '').trim(),
      action: String(patch.action ?? s.action ?? '').trim(),
      size: String(patch.size ?? s.size ?? '').trim(),
      angle: String(patch.angle ?? s.angle ?? '').trim(),
      move: String(patch.move ?? s.move ?? '').trim(),
      character_ids: Array.isArray(patch.character_ids)
        ? patch.character_ids.map(String)
        : s.character_ids,
    });
    return enrichDramaShotLocally(session, merged);
  });

  return { ...session, shots };
}
