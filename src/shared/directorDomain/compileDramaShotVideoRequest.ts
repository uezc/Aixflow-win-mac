/**
 * 短剧出片编译：导演执行表 → Adapter 输入（图/音/提示词/审计）。
 * 真相源是 Domain（timeline_events + 本镜参考槽），禁止再用 V1 资产库压扁。
 */

import { ensureDirectorDramaVideoPromptGuards } from '../directorPipeline/composeFinalPrompt.js';
import { buildLiteralDramaH3CompileDebug } from './composeDramaShotLiteralPrompt.js';
import {
  composeDramaShotLensTaggedPrompt,
  composeDramaShotLensTaggedPromptEn,
  formatDramaH3ClockCompact,
  resolveDramaLensSubjects,
  resolveDramaProductionH3Prompt,
  resolveDramaShotVisualStylePrompt,
  sealDramaProductionCloudPrompt,
} from './composeDramaShotLensPrompt.js';
import { ensureDramaShotTimelineEvents } from './timelineEvent.js';
import { shouldSendDramaH3AudioReference } from './h3DialogueMode.js';
import type { DramaH3CompileDebug } from './h3PromptCompiler.js';
import {
  listDramaShotRefAudioSlots,
  listDramaShotRefImageSlots,
} from './shotRefs.js';
import type { DramaDirectorSession, DramaShot } from './types.js';
import {
  assertDramaH3CompileMode,
  type DramaH3CompileMode,
} from './compilers/h3CompileMode.js';
import {
  dramaVideoModelMaxRefAudios,
  dramaVideoModelMaxRefImages,
} from './dramaVideoModels.js';
import { formatDramaShotCastGateError, syncDramaShotCharacterIds } from './shotCastGate.js';
import {
  attachDramaVoiceBindingPictures,
  buildDramaShotVoiceBindingTable,
  formatDramaVoiceBindingTableText,
  type DramaVoiceBindingTable,
} from './voiceBinding.js';
import { isDramaNarratorVoiceId, isDramaSystemOnlyVoiceId, isDramaSystemVoiceId } from './voiceEntity.js';

export type { DramaH3CompileMode } from './compilers/h3CompileMode.js';

export const NEXFLOW_DRAMA_VIDEO_REQUEST_AUDIT_EVENT = 'nexflow-drama-video-request-audit';

const lastDramaVideoRequestAudits = new Map<string, DramaShotVideoRequestAudit>();

export function getLastDramaShotVideoRequestAudit(
  shotNo: string,
): DramaShotVideoRequestAudit | null {
  const no = String(shotNo || '').trim();
  return no ? lastDramaVideoRequestAudits.get(no) || null : null;
}

function roleLabelZh(role: string): string {
  if (role === 'scene') return '场景';
  if (role === 'character') return '人物';
  if (role === 'prop') return '道具';
  if (role === 'creature') return '生物';
  if (role === 'storyboard') return '分镜';
  if (role === 'style') return '风格';
  return role || '参考';
}

function fmtSec(n: number): string {
  const x = Math.round(n * 10) / 10;
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

export type DramaShotVideoRequestAuditRef = {
  index: number;
  role: string;
  roleLabel: string;
  name: string;
  url: string;
  sent: boolean;
};

export type DramaShotVideoRequestAuditTimeline = {
  start_sec: number;
  end_sec: number;
  visual_action: string;
  dialogue: string;
  dialogue_character_id: string;
  dialogue_character_name: string;
  lip_sync: boolean;
  environment_audio: string[];
};

export type DramaShotVideoRequestAudit = {
  shot_no: string;
  duration_sec: number;
  mode: DramaH3CompileMode;
  model: string;
  refs: DramaShotVideoRequestAuditRef[];
  direction: {
    size: string;
    angle: string;
    move: string;
    purpose: string;
  };
  timeline: DramaShotVideoRequestAuditTimeline[];
  dialogues: Array<{
    character_id: string;
    name: string;
    start_sec: number;
    end_sec: number;
    text: string;
  }>;
  environment: Array<{ start_sec: number; end_sec: number; items: string[] }>;
  api: {
    imageCount: number;
    audioCount: number;
    prompt: string;
    /** 上云英文生产稿（与 inputAudios 对齐）；不改 H3 请求节点。 */
    production_prompt: string;
    /** 编辑器用英文白话稿（与中文同构）；上云用 production_prompt（跟系统语言） */
    editor_prompt_en?: string;
  };
  dialogue: boolean;
  dialogue_mode: 'DIALOGUE_MODE' | 'NO_DIALOGUE_MODE';
  audioReferenceSent: boolean;
  prompt_version: string;
  dialogue_events: Array<{
    speaker: string;
    character_id: string;
    language: 'Chinese';
    text: string;
    start: number;
    end: number;
  }>;
  checks: {
    allRefsSent: boolean;
    refIdentitiesKept: boolean;
    allTimelineSegments: boolean;
    dialogueBound: boolean;
    envBound: boolean;
    apiMatchesTable: boolean;
  };
  /** Console 审计用，不改 H3 API。 */
  voice_binding_table: DramaVoiceBindingTable;
};

export type DramaShotVideoCompiledRequest = {
  mode: DramaH3CompileMode;
  model: string;
  prompt: string;
  inputImages: string[];
  inputAudios: string[];
  durationSec: number;
  audit: DramaShotVideoRequestAudit;
  debug: DramaH3CompileDebug;
};

/**
 * 把本镜执行表编译成视频模型请求。
 * mode 必须显式传入（h3-multi | h3-audio），禁止从提示词猜测。
 */
export function compileDramaShotVideoRequest(
  session: DramaDirectorSession,
  shot: DramaShot,
  opts: { mode: DramaH3CompileMode; model?: string; locale?: 'zh' | 'en' | string },
): DramaShotVideoCompiledRequest {
  const mode = opts.mode;
  assertDramaH3CompileMode(mode);
  // 先自愈漏绑，再出门禁（文案/时间轴已有「周一阳」但 character_ids 空）
  const shotSynced = syncDramaShotCharacterIds(session, shot);
  const castErr = formatDramaShotCastGateError(session, shotSynced);
  if (castErr) {
    throw new Error(castErr);
  }
  shot = ensureDramaShotTimelineEvents(shotSynced, session);
  const model =
    String(opts.model || (mode === 'h3-audio' ? 'minimax-h3-audio' : 'minimax-h3-multi')).trim() ||
    (mode === 'h3-audio' ? 'minimax-h3-audio' : 'minimax-h3-multi');
  const maxImages = dramaVideoModelMaxRefImages(model);
  const maxAudios = dramaVideoModelMaxRefAudios(model);

  const slots = listDramaShotRefImageSlots(session, shot, { maxImages });
  const inputImages = slots
    .map((s) => String(s.url || '').trim())
    .filter(Boolean)
    .slice(0, maxImages);

  // 编辑预览：中文白话稿；英文白话同构给编辑器切换
  // 上云终稿：与画布同一 MiniMax H3 Skill（优先 h3_skill_prompt）
  const literalPrompt = composeDramaShotLensTaggedPrompt(session, shot);
  const editorPromptEn = composeDramaShotLensTaggedPromptEn(session, shot);
  const debug = buildLiteralDramaH3CompileDebug(session, shot, mode, literalPrompt);
  const prompt = ensureDirectorDramaVideoPromptGuards(literalPrompt, {
    skipDialogueSfxFlatten: true,
    skipSoundscapeGuard: true,
    hasDialogue: debug.dialogue,
    preserveChinese: true,
  });

  const inputAudios: string[] = [];
  const shotAudio = String(shot.audio_url || '').trim();
  const sendAudioRef = shouldSendDramaH3AudioReference({
    mode,
    hasDialogue: debug.dialogue,
  });
  if (mode === 'h3-audio') {
    if (sendAudioRef && shotAudio) inputAudios.push(shotAudio);
  } else if (sendAudioRef) {
    for (const a of listDramaShotRefAudioSlots(session, shot, maxAudios)) {
      const url = String(a.sample_url || '').trim();
      if (!url || inputAudios.includes(url)) continue;
      inputAudios.push(url);
      if (inputAudios.length >= maxAudios) break;
    }
  }

  const nameById = new Map(
    (session.bible.characters || []).map((c) => [c.character_id, c.name] as const),
  );
  const events = shot.timeline_events || [];
  const timeline: DramaShotVideoRequestAuditTimeline[] = events.map((ev) => {
    const cid = String(ev.dialogue_character_id || '').trim();
    return {
      start_sec: ev.start_sec,
      end_sec: ev.end_sec,
      visual_action: String(ev.visual_action || '').trim(),
      dialogue: String(ev.dialogue || '').trim(),
      dialogue_character_id: cid,
      dialogue_character_name: cid
        ? isDramaSystemOnlyVoiceId(cid)
          ? '系统'
          : isDramaNarratorVoiceId(cid)
            ? '旁白'
            : isDramaSystemVoiceId(cid)
              ? '系统'
              : String(nameById.get(cid) || cid)
        : '',
      lip_sync: !!ev.lip_sync,
      environment_audio: (ev.environment_audio || []).map((x) => String(x || '').trim()).filter(Boolean),
    };
  });
  const dialogues = timeline
    .filter((t) => t.dialogue)
    .map((t) => ({
      character_id: t.dialogue_character_id,
      name: t.dialogue_character_name,
      start_sec: t.start_sec,
      end_sec: t.end_sec,
      text: t.dialogue,
    }));
  const environment = timeline
    .filter((t) => t.environment_audio.length)
    .map((t) => ({
      start_sec: t.start_sec,
      end_sec: t.end_sec,
      items: t.environment_audio,
    }));

  const sentSet = new Set(inputImages);
  const refs: DramaShotVideoRequestAuditRef[] = slots.map((s) => ({
    index: s.index,
    role: s.role,
    roleLabel: roleLabelZh(s.role),
    name: String(s.name || '').trim() || `${roleLabelZh(s.role)}${s.index}`,
    url: s.url,
    sent: sentSet.has(s.url),
  }));

  const dlgLines = (shot.dialogue || []).filter((d) => String(d.text || '').trim());
  const allRefsSent = refs.length > 0 && refs.every((r) => r.sent);
  const refIdentitiesKept = refs.every((r) => !!r.role && !!r.name);
  const allTimelineSegments =
    events.length === 0 ||
    timeline.every((t, i) => {
      const shotTag = `[镜头 ${i + 1}]`;
      const shotTagEn = `[Shot ${i + 1}]`;
      const range = `${formatDramaH3ClockCompact(t.start_sec)}–${formatDramaH3ClockCompact(t.end_sec)}`;
      return (
        Number.isFinite(t.start_sec) &&
        Number.isFinite(t.end_sec) &&
        t.end_sec > t.start_sec &&
        (prompt.includes(shotTag) ||
          prompt.includes(shotTagEn) ||
          prompt.includes(range) ||
          prompt.includes(formatDramaH3ClockCompact(t.start_sec)) ||
          i === 0)
      );
    });
  const dialogueBound =
    dlgLines.length === 0 ||
    dialogues.every(
      (d) =>
        !!d.character_id &&
        d.end_sec > d.start_sec &&
        (!d.text || prompt.includes(d.text.slice(0, 8))),
    );
  const envBound =
    environment.length === 0 ||
    /overall_soundscape\s*:/i.test(prompt) ||
    environment.every(
      (e) =>
        e.items.length > 0 &&
        e.end_sec > e.start_sec &&
        e.items.every((item) => !item || prompt.includes(item.slice(0, 8))),
    );
  const apiMatchesTable =
    allRefsSent &&
    refIdentitiesKept &&
    allTimelineSegments &&
    dialogueBound &&
    envBound &&
    inputImages.length === Math.min(slots.length, maxImages);

  const visualStyle = resolveDramaShotVisualStylePrompt(session, shot);
  const productionPrompt = sealDramaProductionCloudPrompt(
    resolveDramaProductionH3Prompt(session, shot, {
      durationSec: Number(shot.duration_sec) > 0 ? Number(shot.duration_sec) : undefined,
      locale: opts.locale,
    }),
    {
      hasDialogue: debug.dialogue,
      preserveChinese: !/^en\b/i.test(String(opts.locale || '')),
      storyboardPicIndex: slots.find((s) => s.role === 'storyboard')?.index ?? null,
      styleHint: [
        visualStyle.body,
        visualStyle.name,
        session.bible?.project?.visual_style,
        session.bible?.project?.color_style,
      ]
        .filter(Boolean)
        .join(' '),
      session,
      shot,
    },
  );

  // 编辑预览：有中文优化稿则展示/上云同一份（图二）；否则中文白话；英文 UI 才给英文编辑稿
  const displayPrompt = (() => {
    const skill = String(shot.h3_skill_prompt || '').trim();
    if (skill && /[\u4e00-\u9fff]/.test(skill) && skill.length >= 40) return productionPrompt;
    if (!/^en\b/i.test(String(opts.locale || ''))) return productionPrompt;
    return prompt;
  })();

  const rawVoiceTable = buildDramaShotVoiceBindingTable(session, shot, maxAudios);
  const lens = resolveDramaLensSubjects(session, shot);
  const voice_binding_table: DramaVoiceBindingTable = {
    rows: attachDramaVoiceBindingPictures(
      rawVoiceTable.rows,
      slots.map((s) => ({ index: s.index, asset_id: s.asset_id, role: s.role })),
      lens.subjects.map((s) => ({ n: s.n, character_id: s.character_id })),
    ),
    warnings: rawVoiceTable.warnings,
  };

  const audit: DramaShotVideoRequestAudit = {
    shot_no: String(shot.shot_no || '').trim(),
    duration_sec: Number(shot.duration_sec) || 0,
    mode,
    model,
    refs,
    direction: {
      size: String(shot.size || '').trim(),
      angle: String(shot.angle || '').trim(),
      move: String(shot.move || '').trim(),
      purpose: String(shot.purpose || '').trim(),
    },
    timeline,
    dialogues,
    environment,
    api: {
      imageCount: inputImages.length,
      audioCount: inputAudios.length,
      prompt: displayPrompt,
      production_prompt: productionPrompt,
      editor_prompt_en: editorPromptEn,
    },
    dialogue: debug.dialogue,
    dialogue_mode: debug.dialogue_mode,
    audioReferenceSent: inputAudios.length > 0,
    prompt_version: debug.prompt_version,
    dialogue_events: debug.dialogue_events || [],
    checks: {
      allRefsSent,
      refIdentitiesKept,
      allTimelineSegments,
      dialogueBound,
      envBound,
      apiMatchesTable,
    },
    voice_binding_table,
  };
  if (audit.shot_no) lastDramaVideoRequestAudits.set(audit.shot_no, audit);

  return {
    mode,
    model,
    prompt: productionPrompt,
    inputImages,
    inputAudios,
    durationSec: Number(shot.duration_sec) || 0,
    audit,
    debug,
  };
}

export function formatDramaShotVideoRequestAuditText(audit: DramaShotVideoRequestAudit): string {
  const mark = (ok: boolean) => (ok ? '✓' : '✗');
  const lines: string[] = [
    `本镜生成请求`,
    `镜头：${audit.shot_no || '—'}`,
    `时长：${audit.duration_sec}秒`,
    `模型：${audit.model}`,
    `编译 mode：${audit.mode}`,
    `对白模式：${audit.dialogue_mode}`,
    `dialogue：${audit.dialogue ? 'true' : 'false'}`,
    `audioReferenceSent：${audit.audioReferenceSent ? 'true' : 'false'}`,
    `promptVersion：${audit.prompt_version || '—'}`,
    '',
    '【参考素材】',
    ...audit.refs.map(
      (r) => `${mark(r.sent)} 图${r.index} ${r.roleLabel}：${r.name}`,
    ),
    audit.refs.length === 0 ? '（无参考图）' : '',
    '【导演指示】',
    `${mark(!!audit.direction.size)} 机位/景别：${audit.direction.size || '—'}`,
    `${mark(!!audit.direction.angle)} 角度：${audit.direction.angle || '—'}`,
    `${mark(!!audit.direction.move)} 运镜：${audit.direction.move || '—'}`,
    `${mark(!!audit.direction.purpose)} 目的：${audit.direction.purpose || '—'}`,
    '',
    '【时间轴】',
    ...(audit.timeline.length
      ? audit.timeline.map(
          (t) =>
            `${mark(true)} ${t.start_sec}–${t.end_sec}秒 ${t.visual_action || '—'}${
              t.dialogue ? `｜对白 ${t.dialogue_character_name || t.dialogue_character_id}：${t.dialogue}` : ''
            }`,
        )
      : ['（无分段事件）']),
    '',
    '【对白绑定】',
    ...(audit.dialogues.length
      ? audit.dialogues.map(
          (d) =>
            `${mark(!!d.character_id)} ${d.name || d.character_id || '未绑定'} ${d.start_sec}–${d.end_sec}s：${d.text}`,
        )
      : ['（无对白）']),
    '',
    '【环境音】',
    ...(audit.environment.length
      ? audit.environment.map(
          (e) => `${mark(e.items.length > 0)} ${e.start_sec}–${e.end_sec}s：${e.items.join('、')}`,
        )
      : ['（无分段环境音）']),
    '',
    audit.voice_binding_table ? formatDramaVoiceBindingTableText(audit.voice_binding_table) : '',
    '',
    '【最终 API】',
    `图片：${audit.api.imageCount}`,
    `音频：${audit.api.audioCount}${
      audit.mode === 'h3-audio'
        ? '（对口型：仅本镜声音）'
        : audit.audioReferenceSent
          ? '（全能参考：各角色参考音）'
          : '（全能参考：本镜无对白，未传参考音）'
    }`,
    '',
    '发送给模型：',
    `${mark(audit.checks.allRefsSent)} 全部参考图`,
    `${mark(audit.checks.refIdentitiesKept)} 参考图身份`,
    `${mark(audit.checks.allTimelineSegments)} 时间轴各段`,
    `${mark(audit.checks.dialogueBound)} 对白 character_id+时段`,
    `${mark(audit.checks.envBound)} 环境音时段`,
    `${mark(audit.checks.apiMatchesTable)} 与执行表 1:1`,
  ];
  return lines.filter((x, i, arr) => x !== '' || arr[i - 1] !== '').join('\n');
}
