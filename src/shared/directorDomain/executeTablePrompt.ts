/**
 * 导演执行表中间栏：按「参考图绑定 → 风格 → 身份锁 → 开场 → 分段时间轴 → 全镜连续性」编译。
 * 展示用，不替代 timeline_events 真相源。
 */

import {
  listDramaShotRefAudioSlots,
  listDramaShotRefImageSlots,
} from './shotRefs.js';
import { resolveCharacterIdsForShot } from './shotTimeline.js';
import { replaceDramaAnonymousCastLabel } from './shotCastGate.js';
import {
  isDramaNarratorVoiceId,
  isDramaSystemOnlyVoiceId,
  isDramaSystemVoiceId,
  resolveDramaVoiceRole,
} from './voiceEntity.js';
import type {
  DramaCharacter,
  DramaDirectorSession,
  DramaSceneAsset,
  DramaShot,
  DramaTimelineEvent,
} from './types.js';

export type DramaCharCite = {
  character_id: string;
  name: string;
  /** 1-based，与左侧参考图N / H3 <图片N> 对齐 */
  imageIndex: number | null;
  /** 1-based，与左侧参考音N 对齐；对口型编译时不引用角色参考音 */
  audioIndex: number | null;
};

/** display=导演台；h3-*=Adapter 编译，不写进 UI 执行表 */
export type DramaExecuteCompileMode = 'display' | 'h3-multi' | 'h3-audio';

export function formatDramaCharCite(
  cite: DramaCharCite | undefined,
  fallbackName = '',
  opts?: { omitAudioCite?: boolean },
): string {
  const name = String(cite?.name || fallbackName || '').trim() || '未命名人物';
  const img =
    cite?.imageIndex && cite.imageIndex > 0
      ? `（参考图${cite.imageIndex}）`
      : '（无参考图）';
  if (opts?.omitAudioCite) return `${name}${img}`;
  const aud =
    cite?.audioIndex && cite.audioIndex > 0
      ? `（音频${cite.audioIndex}）`
      : '（无参考音）';
  return `${name}${img}${aud}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 把正文里的人名补上（参考图N）（音频N），避免重复标注 */
export function annotateDramaCharCitesInText(
  text: string,
  citeById: Map<string, DramaCharCite>,
  opts?: { omitAudioCite?: boolean },
): string {
  let out = String(text || '');
  if (!out) return out;
  const cites = [...citeById.values()]
    .filter((c) => String(c.name || '').trim())
    .sort((a, b) => b.name.length - a.name.length);
  for (const c of cites) {
    const cited = formatDramaCharCite(c, c.name, opts);
    const re = new RegExp(`${escapeRegExp(c.name)}(?!（参考图)`, 'g');
    out = out.replace(re, cited);
  }
  return out;
}

function buildCharCiteMap(
  session: DramaDirectorSession,
  shot: DramaShot,
  chars: DramaCharacter[],
  nameById: Map<string, string>,
): Map<string, DramaCharCite> {
  const imgSlots = listDramaShotRefImageSlots(session, shot);
  const audSlots = listDramaShotRefAudioSlots(session, shot);
  const map = new Map<string, DramaCharCite>();
  const ids = new Set([
    ...chars.map((c) => c.character_id),
    ...audSlots.map((a) => a.character_id),
    ...imgSlots.filter((s) => s.role === 'character' && s.asset_id).map((s) => String(s.asset_id)),
  ]);
  for (const id of ids) {
    if (!id || isDramaSystemVoiceId(id)) continue;
    const ch = chars.find((c) => c.character_id === id);
    const img = imgSlots.find((s) => s.role === 'character' && s.asset_id === id);
    const aud = audSlots.find((s) => s.character_id === id);
    map.set(id, {
      character_id: id,
      name: ch?.name || nameById.get(id) || aud?.character_name || id,
      imageIndex: img?.index ?? null,
      audioIndex: aud?.index ?? null,
    });
  }
  const sysAud = audSlots.find((s) => isDramaSystemOnlyVoiceId(s.character_id));
  if (sysAud) {
    map.set(sysAud.character_id, {
      character_id: sysAud.character_id,
      name: '系统',
      imageIndex: null,
      audioIndex: sysAud.index,
    });
  }
  const narAud = audSlots.find((s) => isDramaNarratorVoiceId(s.character_id));
  if (narAud) {
    map.set(narAud.character_id, {
      character_id: narAud.character_id,
      name: '旁白',
      imageIndex: null,
      audioIndex: narAud.index,
    });
  }
  return map;
}

function fmtSec(n: number): string {
  const x = Math.round(n * 10) / 10;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function styleLineOf(session: DramaDirectorSession): string {
  const raw =
    session.bible.projectVisualBible?.presetName ||
    session.bible.project.visual_style ||
    session.bible.project.style ||
    session.meta.globalStyle ||
    '';
  const s = String(raw || '').trim();
  if (s) {
    const short = s.length > 40 ? `${s.slice(0, 40)}…` : s;
    return `生成一段${short}风格的连续视频。`;
  }
  return '生成一段电影级连续视频。';
}

function figureIndexFor(
  slots: { index: number; role: string; asset_id?: string }[],
  role: string,
  assetId: string,
): number | null {
  const id = String(assetId || '').trim();
  const hit = slots.find((s) => s.role === role && String(s.asset_id || '') === id);
  return hit ? hit.index : null;
}

function characterLockSentence(
  ch: DramaCharacter,
  cite: DramaCharCite | undefined,
  opts?: { omitAudioCite?: boolean },
): string {
  const age = String(ch.age || '').trim();
  const ident = String(ch.identity || ch.role || '').trim();
  const who = [age, ident].filter(Boolean).join('，');
  const face = String(ch.visual?.face || '').trim();
  const hair = String(ch.visual?.hair || '').trim();
  const clothing = String(ch.visual?.clothing || '').trim();
  const fig = cite?.imageIndex ?? null;
  const keepDetail = [face, hair, clothing].filter(Boolean).join('、');
  const figBit = fig
    ? `保持参考图${fig}中的${keepDetail || '面部特征、发型与服饰'}`
    : `保持已锁定的${keepDetail || '面部特征、发型与服饰'}`;
  const head = who
    ? `${formatDramaCharCite(cite, ch.name, opts)}为${who}`
    : formatDramaCharCite(cite, ch.name, opts);
  return `${head}，${figBit}，不改变人物身份与服饰。`;
}

function sceneLockSentence(sc: DramaSceneAsset, fig: number | null): string {
  const layout =
    [sc.spatial_structure, sc.architecture, ...(sc.fixed_elements || []).slice(0, 4)]
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .join('、') || '主要空间结构';
  const name = sc.name || sc.location || '本场';
  if (fig) return `${name}保持参考图${fig}中的${layout}，不改变主要场景布局。`;
  return `${name}保持已锁定的${layout}，不改变主要场景布局。`;
}

function openingCamera(shot: DramaShot): string {
  const parts = [shot.size, shot.angle || shot.camera, shot.move]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  return parts.length ? `镜头开始为${parts.join('、')}。` : '镜头开始为固定机位。';
}

/** 时间轴正文：去掉身份锁/场景设定句，只留动作。 */
export function briefDramaEventAction(raw: string): string {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s
    .replace(/保持参考图\d+中的[^。；;]*/g, '')
    .replace(/不改变人物身份与服饰/g, '')
    .replace(/不改变主要场景布局/g, '')
    .replace(/生成一段[^。]*风格的连续视频/g, '')
    .replace(/[。；;]{2,}/g, '。')
    .trim();
  const parts = s
    .split(/[。！？\n]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => !/身份与服饰|场景布局|参考图\d+|低饱和|电影级胶片|cinematic film/i.test(x));
  const pick = parts.slice(0, 2);
  if (!pick.length) return s.slice(0, 80);
  return `${pick.join('。')}。`;
}

export function formatDramaExecuteEventParagraph(
  ev: DramaTimelineEvent,
  citeById: Map<string, DramaCharCite>,
  nameById?: Map<string, string>,
  opts?: { compileMode?: DramaExecuteCompileMode },
): string {
  const compileMode = opts?.compileMode || 'display';
  const omitAudioCite = compileMode === 'h3-audio';
  const citeOf = (id: string) =>
    formatDramaCharCite(citeById.get(id), nameById?.get(id) || id, { omitAudioCite });
  const who = (ev.character_ids || [])
    .map((id) => citeOf(id))
    .filter(Boolean)
    .join('、');
  const action = annotateDramaCharCitesInText(
    briefDramaEventAction(ev.visual_action || ''),
    citeById,
    { omitAudioCite },
  );
  const bits: string[] = [];
  if (who && action) bits.push(`${who}${action.replace(/。$/, '')}`);
  else if (action) bits.push(action.replace(/。$/, ''));
  else if (who) bits.push(who);

  const dlg = String(ev.dialogue || '').trim();
  const sid = String(ev.dialogue_character_id || '').trim();
  const env = (ev.environment_audio || []).map((x) => String(x || '').trim()).filter(Boolean);
  if (isDramaSystemVoiceId(sid) && dlg) {
    const aud = citeById.get(sid)?.audioIndex;
    const role = resolveDramaVoiceRole(sid);
    const who = role === 'narrator' ? '画外旁白' : '画外系统声';
    const sysSpeak =
      compileMode === 'h3-multi' && aud
        ? `${who}使用音频${aud}说：「${dlg}」`
        : `${who}说（非人物音色）：「${dlg}」`;
    bits.push(sysSpeak);
    if (compileMode === 'h3-audio') {
      bits.push(env.length ? `环境音已含于音频1：${env.join('、')}` : '环境音已含于音频1');
    } else if (env.length) {
      bits.push(`环境音：${env.join('、')}`);
    }
    return `${bits.join('。')}。`.replace(/。+/g, '。');
  }
  const speaker = sid ? citeOf(sid) : '';

  if (compileMode === 'h3-audio') {
    if (dlg && ev.lip_sync && speaker) {
      bits.push(`${speaker}口型对齐音频1，台词：「${dlg}」`);
    } else if (dlg && speaker) {
      bits.push(`口型关，${speaker}台词已在音频1中：「${dlg}」`);
    } else {
      bits.push('口型关，本段不说话');
    }
    bits.push(env.length ? `环境音已含于音频1：${env.join('、')}` : '环境音已含于音频1');
  } else {
    if (dlg && speaker) {
      const aud = omitAudioCite ? '' : citeById.get(sid)?.audioIndex;
      const timbre =
        compileMode === 'h3-multi' && aud
          ? `，音色跟随音频${aud}`
          : '';
      bits.push(
        ev.lip_sync
          ? `${speaker}口型开，说：「${dlg}」${timbre}`
          : `${speaker}口型关：「${dlg}」`,
      );
    } else {
      bits.push(ev.lip_sync ? '口型开' : '口型关');
    }
    if (env.length) bits.push(`环境音：${env.join('、')}`);
  }

  return `${bits.join('。')}。`.replace(/。+/g, '。');
}

export type DramaExecuteTableView = {
  refBinding: string;
  styleLine: string;
  identityLocks: string[];
  opening: string;
  continuity: string;
  fullText: string;
  citeById: Map<string, DramaCharCite>;
};

export function buildDramaExecuteTableView(
  session: DramaDirectorSession,
  shot: DramaShot,
  opts?: { nameById?: Map<string, string>; compileMode?: DramaExecuteCompileMode },
): DramaExecuteTableView {
  const compileMode: DramaExecuteCompileMode = opts?.compileMode || 'display';
  const omitAudioCite = compileMode === 'h3-audio';
  const slots = listDramaShotRefImageSlots(session, shot);
  const events = shot.timeline_events || [];
  const charIds = resolveCharacterIdsForShot(session, shot);
  const chars = charIds
    .map((id) => (session.bible?.characters || []).find((c) => c.character_id === id))
    .filter(Boolean) as DramaCharacter[];
  const scene = (session.bible?.scenes || []).find((s) => s.scene_id === shot.scene_asset_id) || null;
  const nameById =
    opts?.nameById ||
    new Map(chars.map((c) => [c.character_id, c.name] as const));
  const citeById = buildCharCiteMap(session, shot, chars, nameById);
  if (omitAudioCite) {
    for (const [id, c] of citeById) {
      citeById.set(id, { ...c, audioIndex: null });
    }
  }

  const bindParts: string[] = [];
  for (const ch of chars) {
    const cite = citeById.get(ch.character_id);
    const img = cite?.imageIndex;
    const aud = omitAudioCite ? null : cite?.audioIndex;
    if (omitAudioCite) {
      if (img) bindParts.push(`使用参考图${img}作为${ch.name}的人物身份参考`);
      else bindParts.push(`${ch.name}尚未绑定人物参考图`);
    } else if (img && aud) {
      bindParts.push(`使用参考图${img}与音频${aud}作为${ch.name}的人物身份与音色参考`);
    } else if (img) {
      bindParts.push(`使用参考图${img}作为${ch.name}的人物身份参考（无参考音）`);
    } else if (aud) {
      bindParts.push(`${ch.name}已绑定音频${aud}，但尚未绑定人物参考图`);
    } else {
      bindParts.push(`${ch.name}尚未绑定人物参考图与参考音`);
    }
  }
  for (const p of session.bible.props || []) {
    if (!(shot.prop_ids || []).includes(p.prop_id) && !(shot.required_prop_ids || []).includes(p.prop_id)) {
      continue;
    }
    const n = figureIndexFor(slots, 'prop', p.prop_id);
    if (n) bindParts.push(`使用参考图${n}作为${p.name}的道具参考`);
  }
  if (scene) {
    const n = figureIndexFor(slots, 'scene', scene.scene_id);
    if (n) bindParts.push(`使用参考图${n}作为${scene.name || scene.location || '本场'}的场景参考`);
    else bindParts.push(`${scene.name || '本场'}尚未绑定场景参考图`);
  }
  if (compileMode === 'h3-audio') {
    bindParts.push(
      '音频1为本镜声音（已含对白与环境音），是本请求唯一参考音与成片声轨；角色参考音未提交',
    );
  } else if (compileMode === 'h3-multi') {
    bindParts.push('本请求音频槽仅为各角色音色参考音，未提交本镜合成音');
  }
  const refBinding = bindParts.length ? `${bindParts.join('，')}。` : '本镜尚未绑定参考图。';

  const styleLine = styleLineOf(session);

  const identityLocks: string[] = [];
  for (const ch of chars) {
    identityLocks.push(characterLockSentence(ch, citeById.get(ch.character_id), { omitAudioCite }));
  }
  if (scene) {
    identityLocks.push(sceneLockSentence(scene, figureIndexFor(slots, 'scene', scene.scene_id)));
  }

  const opening = openingCamera(shot);

  const envAll = [
    ...new Set(
      events.flatMap((e) => e.environment_audio || []).map((x) => String(x || '').trim()).filter(Boolean),
    ),
  ];
  const sfx = String(shot.sfx || '').trim();
  const ambient = envAll.length ? envAll.join('、') : sfx || '现场环境声';
  const sceneName = scene?.name || scene?.location || '本场';
  const sceneFig = scene ? figureIndexFor(slots, 'scene', scene.scene_id) : null;
  const sceneCite = sceneFig ? `${sceneName}（参考图${sceneFig}）` : sceneName;
  let lipNote = '';
  if (compileMode === 'h3-audio') {
    lipNote =
      '成片声轨必须使用音频1（本镜声音）。有对白时段人物开口、口型对齐音频1；禁止另生成人声或环境音。';
  } else if (compileMode === 'h3-multi') {
    lipNote = events.some((e) => e.lip_sync && String(e.dialogue || '').trim())
      ? '对白段落保持人物开口与嘴型同步，说话人音色跟随其已绑定的角色参考音。环境音按时间轴生成。'
      : '环境音按时间轴生成；角色参考音只提供音色身份。';
  } else {
    lipNote = events.some((e) => e.lip_sync && String(e.dialogue || '').trim())
      ? '对白段落保持人物声音与嘴型同步，说话人音色跟随其参考音。'
      : '';
  }
  const continuity =
    compileMode === 'h3-audio'
      ? `整个视频保持${sceneCite}环境连续性。${lipNote}不要添加字幕、文字、水印或额外主要人物。`.replace(
          /。+/g,
          '。',
        )
      : `整个视频保持${sceneCite}环境连续性，持续存在${ambient}。${lipNote}不要添加字幕、文字、水印或额外主要人物。`.replace(
          /。+/g,
          '。',
        );

  const castNames = chars.map((c) => String(c.name || '').trim()).filter(Boolean);
  const scrub = (t: string) => replaceDramaAnonymousCastLabel(t, castNames);

  const eventLines = events.map((ev) => {
    const t = `${fmtSec(ev.start_sec)}–${fmtSec(ev.end_sec)}秒`;
    return `${t}：${scrub(
      formatDramaExecuteEventParagraph(ev, citeById, nameById, { compileMode }),
    )}`;
  });

  const fullText = [
    scrub(refBinding),
    '',
    scrub(styleLine),
    '',
    scrub(identityLocks.join('')),
    '',
    scrub(opening),
    '',
    ...eventLines,
    '',
    scrub(continuity),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    refBinding: scrub(refBinding),
    styleLine: scrub(styleLine),
    identityLocks: identityLocks.map(scrub),
    opening: scrub(opening),
    continuity: scrub(continuity),
    fullText,
    citeById,
  };
}
