/**
 * 导演分镜中间栏：彩条铺满；下方手改切段 / 修改思路 AI 改。出片走 Compiler，不再做 H3 skill 改写。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { compileDramaShotVideoRequest } from '../../../shared/directorDomain/compileDramaShotVideoRequest';
import {
  isDramaBoardPromptStale,
  rebuildDramaShotPromptFromUpstream,
} from '../../../shared/directorDomain/boardPromptSync';
import { dramaShotHasSpokenDialogue, resolveDramaShotAudioTimeline } from '../../../shared/directorDomain/migrateH3Compiler';
import {
  dramaVideoModelRequiresShotAudio,
  resolveDramaShotVideoModel,
} from '../../../shared/directorDomain/dramaVideoModels';
import type {
  DramaDirectorSession,
  DramaShot,
  DramaTimelineEvent,
} from '../../../shared/directorDomain';
import {
  composeDramaShotLensTaggedPrompt,
  collapseDramaTimelineEventsToSingle,
  DRAMA_TIMELINE_SPLIT_DISABLED,
  enrichDramaShotLocally,
  formatTimelineRange,
  isDramaH3LensTaggedPrompt,
  isLegacyDramaH3ChineseLensPrompt,
  resolveDramaShotVisualStylePrompt,
  sealDramaProductionCloudPrompt,
} from '../../../shared/directorDomain';
import {
  buildDirectorReviseDramaCutBatchMessages,
  buildDirectorReviseDramaCutMessages,
  parseDirectorRevisedDramaCut,
  parseDirectorRevisedDramaCutBatch,
} from '../../../shared/directorPipeline/reviseDramaCutPrompt';
import {
  buildDramaMultiShotMergeMessages,
  extractDramaH3CompactFinal,
  isAcceptableDramaH3SpliceFinal,
  parseDramaH3SpliceIntegrateResult,
  reinjectCutDialogueIntoDramaH3Final,
  repairDramaH3SpliceFinal,
} from '../../../shared/directorDomain/dramaH3SpliceIntegrate';
import { listDramaShotRefAudioSlots } from '../../../shared/directorDomain/shotRefs';
import { resolveDramaChatModel } from '../../utils/cloudModelPricing';
import { Coins, ChevronDown, ChevronUp, Image as ImageIcon, X, ZoomIn } from 'lucide-react';
import { yuanbaoHoverTipAboveCls } from '../darkModalShell';
import { DramaShotTimelineRuler } from './DramaShotTimelineRuler';
import { ModuleProgressBar } from '../Canvas/ModuleProgressBar';
import { toDisplayableDramaMediaUrl } from './DramaCharacterLibraryPick';
import VoiceMicGlyph from '../Canvas/VoiceMicGlyph';
import {
  composeDramaShotStoryboardImagePrompt,
  resolveDramaShotStoryboardImageUrl,
} from '../../../shared/directorDomain/dramaShotStoryboard';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { micLevelCssVars } from '../../utils/micInputLevel';
import { acquireVoiceModalLock, releaseVoiceModalLock, forceClearVoiceModalLock } from '../../utils/voiceModalGate';
import { abortAllPushToTalkPointers } from '../../utils/pushToTalkPointer';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import type { DirectorConcurrentChatQueueStatus } from '../../utils/directorConcurrentChatQueue';

function mutedCls(isDark: boolean) {
  return isDark ? 'text-white/50' : 'text-gray-500';
}

function ExecuteYuanbaoHover({
  priceLabel,
  children,
}: {
  priceLabel?: string | null;
  children: React.ReactNode;
}) {
  const [hover, setHover] = useState(false);
  const tip = String(priceLabel || '').trim();
  return (
    <span
      className="relative inline-flex overflow-visible"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {hover && tip ? (
        <span className={`${yuanbaoHoverTipAboveCls} translate-y-0 opacity-100`} title={tip}>
          <Coins className="h-3 w-3 shrink-0 text-amber-300" aria-hidden strokeWidth={2.25} />
          <span>{tip}</span>
        </span>
      ) : null}
      {children}
    </span>
  );
}

type PromptTab = 'cut' | 'compiled';

/** 多镜合并后：去重参考绑定 + LLM 整合时间轴（不再做 H3 skill 改写） */
export async function runDramaMultiShotH3SkillMerge(opts: {
  session: DramaDirectorSession;
  sourceShots: DramaShot[];
  mergedShot: DramaShot;
  runChat: (
    systemPrompt: string,
    userPrompt: string,
    chatOpts?: {
      max_tokens?: number;
      temperature?: number;
      model?: string;
      concurrent?: boolean;
      skillOptimize?: boolean;
      onQueueStatus?: (status: DirectorConcurrentChatQueueStatus) => void;
      signal?: AbortSignal | null;
    },
  ) => Promise<string>;
  model?: string;
  locale?: string;
  onQueueStatus?: (status: DirectorConcurrentChatQueueStatus) => void;
  signal?: AbortSignal | null;
}): Promise<{ final: string; source: string; draft: string; report: string }> {
  const { session, sourceShots, mergedShot, runChat } = opts;
  const events = mergedShot.timeline_events || [];
  const shotForSend = {
    ...mergedShot,
    timeline_events: events,
    audio_timeline: resolveDramaShotAudioTimeline(session, { ...mergedShot, timeline_events: events }),
  };
  const hasDlg = dramaShotHasSpokenDialogue(shotForSend);
  const videoModel = resolveDramaShotVideoModel(
    shotForSend.model_params,
    session.meta.videoBatchModel,
    {
      hasDialogue: hasDlg,
      hasShotAudio: !!String(shotForSend.audio_url || '').trim(),
    },
  );
  const mode = dramaVideoModelRequiresShotAudio(videoModel) ? 'h3-audio' : 'h3-multi';
  let compiledPrompt = '';
  try {
    compiledPrompt = String(
      compileDramaShotVideoRequest(session, shotForSend, {
        mode,
        model: videoModel,
        locale: opts.locale || 'zh-CN',
      }).prompt || '',
    ).trim();
  } catch {
  }
  const source =
    compiledPrompt ||
    String(mergedShot.last_compiled_prompt || '').trim() ||
    sourceShots
      .map((s) => String(s.last_compiled_prompt || '').trim())
      .filter(Boolean)
      .join('\n\n---\n\n');
  if (!source && !events.length) {
    throw new Error('还没有可合并的分镜数据');
  }
  const platformMode = 'api' as const;
  let imageBindings: Array<{ index: number; label: string }> = [];
  try {
    const compiled = compileDramaShotVideoRequest(session, shotForSend, {
      mode,
      model: videoModel,
      locale: opts.locale || 'zh-CN',
    });
    imageBindings = (compiled.audit?.refs || []).map((r) => ({
      index: r.index,
      label: `${r.roleLabel}${r.name ? ` · ${r.name}` : ''}${r.sent ? '' : '（未送出）'}`,
    }));
  } catch {
    imageBindings = [];
  }
  const audioSlots = listDramaShotRefAudioSlots(session, shotForSend);
  const audioBindings =
    audioSlots.length > 0
      ? audioSlots.map((s) => ({
          index: s.index,
          label: `${s.character_name || '角色'}${s.character_id ? ` · ${s.character_id}` : ''}`,
        }))
      : [];
  const rawModel = String(opts.model || session.meta.chatModel || '').trim();
  const chatModel = resolveDramaChatModel(rawModel);
  const { systemPrompt, userPrompt } = buildDramaMultiShotMergeMessages({
    session,
    sourceShots,
    mergedShot: shotForSend,
    compiledPrompt: source,
    imageBindings,
    audioBindings,
    platformMode,
  });
  const raw = await runChat(systemPrompt, userPrompt, {
    max_tokens: 8192,
    temperature: 0.35,
    model: chatModel,
    concurrent: true,
    signal: opts.signal,
    onQueueStatus: opts.onQueueStatus,
  });
  const parsed = parseDramaH3SpliceIntegrateResult(raw);
  let finalText = parsed.final;
  if (!isAcceptableDramaH3SpliceFinal(finalText, platformMode)) {
    const repaired = repairDramaH3SpliceFinal(finalText, shotForSend, session, platformMode);
    if (!repaired) {
      throw new Error('整合终稿格式不对，请换一个模型再试');
    }
    finalText = repaired;
    console.warn('[Drama] 终稿缺少 [场景概述]，已自动补全（多镜合并）');
  }
  const compact = extractDramaH3CompactFinal(raw);
  const lens = composeDramaShotLensTaggedPrompt(session, shotForSend);
  const picked =
    isDramaH3LensTaggedPrompt(compact.final) && !isLegacyDramaH3ChineseLensPrompt(compact.final)
      ? compact.final
      : isDramaH3LensTaggedPrompt(finalText) && !isLegacyDramaH3ChineseLensPrompt(finalText)
        ? finalText
        : lens;
  const finalSource = reinjectCutDialogueIntoDramaH3Final(picked, shotForSend);
  return {
    final: finalSource,
    source,
    draft: parsed.draft,
    report: parsed.report,
  };
}

/** 分镜卡中间栏轻量面：只挂时间轴；剧本变动时顶栏显示「更新提示词」 */
export function DramaShotPromptCardSurface({
  session,
  shot,
  timeline,
  nameById,
  isDark,
  busy,
  onPatchTimeline,
  onPatchShot,
  runChat,
  showAlert,
  unitChatPriceLabel,
  unitImagePriceLabel,
  storyboardImageGenSlot,
  storyboardImageUrl,
  storyboardGenerating,
  onGenerateShotStoryboard,
  skillPromptActionSlot,
}: {
  session: DramaDirectorSession;
  shot: DramaShot;
  timeline: DramaTimelineEvent[];
  nameById: Map<string, string>;
  isDark: boolean;
  busy?: boolean;
  onPatchTimeline?: (events: DramaTimelineEvent[]) => void;
  onPatchShot?: (patch: Partial<DramaShot>) => void;
  runChat?: (
    systemPrompt: string,
    userPrompt: string,
    opts?: {
      max_tokens?: number;
      temperature?: number;
      concurrent?: boolean;
      skillOptimize?: boolean;
      signal?: AbortSignal | null;
    },
  ) => Promise<string>;
  showAlert?: (msg: string) => void;
  unitChatPriceLabel?: string | null;
  /** 分镜图生图单价悬停文案 */
  unitImagePriceLabel?: string | null;
  /** 分镜图：模型 / 清晰度选择（不含 4K） */
  storyboardImageGenSlot?: React.ReactNode;
  /** pipeline / Domain 分镜图 URL */
  storyboardImageUrl?: string | null;
  storyboardGenerating?: boolean;
  onGenerateShotStoryboard?: (shotNo: string, opts?: { force?: boolean }) => void;
  /** 提示词优化 / 查看优化稿（放在 AI 改整镜右侧） */
  skillPromptActionSlot?: React.ReactNode;
}) {
  const { locale } = useAppLocale();
  const { showConfirm } = useDarkAlert();
  const durationSec = Number(shot.duration_sec) > 0 ? Number(shot.duration_sec) : 10;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [opinion, setOpinion] = useState('');
  const opinionRef = useRef('');
  opinionRef.current = opinion;
  const [revising, setRevising] = useState(false);
  const rawEvents = timeline?.length ? timeline : shot.timeline_events || [];
  const events =
    DRAMA_TIMELINE_SPLIT_DISABLED && rawEvents.length > 1
      ? collapseDramaTimelineEventsToSingle(rawEvents, durationSec)
      : rawEvents;
  const promptStale = isDramaBoardPromptStale(session, shot);
  const seededTimelineRef = useRef('');
  const collapsedOnceRef = useRef('');
  const fieldCls = isDark
    ? 'border border-white/12 bg-[#1c1c1e] text-white/90 placeholder:text-white/40 focus:border-sky-500/50'
    : 'border border-gray-300 bg-white text-gray-900 placeholder:text-gray-400';

  /** TEMP：关切分时，把已有多段彩条一次性压成整镜单段写回 */
  useEffect(() => {
    if (!DRAMA_TIMELINE_SPLIT_DISABLED || !onPatchShot || busy) return;
    const src = shot.timeline_events || [];
    if (src.length <= 1) return;
    if (collapsedOnceRef.current === shot.shot_id) return;
    collapsedOnceRef.current = shot.shot_id;
    const nextEvents = collapseDramaTimelineEventsToSingle(src, durationSec);
    onPatchShot({
      timeline_events: nextEvents,
      timeline_beats: nextEvents.map((e) => ({
        start_sec: e.start_sec,
        end_sec: e.end_sec,
        text: `${e.start_sec}-${e.end_sec}s`,
        kind: e.lip_sync || e.dialogue ? 'dialogue' : e.environment_audio.length ? 'sfx' : 'action',
      })),
      audio_timeline: resolveDramaShotAudioTimeline(session, { ...shot, timeline_events: nextEvents }),
    });
  }, [busy, durationSec, onPatchShot, session, shot, shot.shot_id]);

  /** 镜卡展开且无切段时：本地自动补一条时间轴（非整表 enrich，避免 OOM） */
  useEffect(() => {
    if (busy || rebuilding || !onPatchShot) return;
    if ((shot.timeline_events || []).length > 0) return;
    if ((timeline || []).length > 0) return;
    if (seededTimelineRef.current === shot.shot_id) return;
    seededTimelineRef.current = shot.shot_id;
    try {
      const enriched = enrichDramaShotLocally(session, shot);
      const nextEvents = enriched.timeline_events || [];
      if (!nextEvents.length) return;
      onPatchShot({
        duration_sec: enriched.duration_sec,
        timeline_events: nextEvents,
        timeline_beats: enriched.timeline_beats,
        character_ids: enriched.character_ids,
        voice_ids: enriched.voice_ids,
        audio_timeline: resolveDramaShotAudioTimeline(session, { ...shot, timeline_events: nextEvents }),
      });
    } catch {
      seededTimelineRef.current = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.shot_id]);

  useEffect(() => {
    setOpinion('');
  }, [shot.shot_id]);

  const {
    status: opinionDictationStatus,
    isActive: isOpinionDictationActive,
    inputLevel: opinionDictationLevel,
    start: startOpinionDictation,
    stop: stopOpinionDictation,
    cancel: cancelOpinionDictation,
  } = useCloudRealtimeDictation({
    getBaseText: () => {
      const prev = String(opinionRef.current || '').trimEnd();
      return prev ? `${prev} ` : '';
    },
    onLiveText: (full) => setOpinion(full),
    onError: (message) => showAlert?.(message),
    onMicDenied: () => showAlert?.('无法使用麦克风，请检查系统权限'),
  });

  useEffect(() => {
    forceClearVoiceModalLock();
    abortAllPushToTalkPointers();
    cancelOpinionDictation();
    return () => {
      cancelOpinionDictation();
      forceClearVoiceModalLock();
      abortAllPushToTalkPointers();
    };
  }, [shot.shot_id, cancelOpinionDictation]);

  const opinionMicBusy =
    opinionDictationStatus === 'connecting' || opinionDictationStatus === 'stopping';
  const opinionMicStopping = opinionDictationStatus === 'stopping';
  const { pointerHandlers: opinionMicPointerHandlers } = useDictationPushToTalk({
    start: startOpinionDictation,
    stop: stopOpinionDictation,
    cancel: cancelOpinionDictation,
    status: opinionDictationStatus,
    disabled: opinionMicStopping || revising,
  });

  useEffect(() => {
    if (!isOpinionDictationActive) return;
    acquireVoiceModalLock();
    return () => releaseVoiceModalLock();
  }, [isOpinionDictationActive]);

  const fillLocalTimeline = () => {
    if (!onPatchShot) return;
    const enriched = enrichDramaShotLocally(session, shot);
    const nextEvents = enriched.timeline_events || [];
    onPatchShot({
      duration_sec: enriched.duration_sec,
      timeline_events: nextEvents,
      timeline_beats: enriched.timeline_beats,
      character_ids: enriched.character_ids,
      voice_ids: enriched.voice_ids,
      audio_timeline: resolveDramaShotAudioTimeline(session, { ...shot, timeline_events: nextEvents }),
    });
    seededTimelineRef.current = shot.shot_id;
  };

  const commitEvents = (next: DramaTimelineEvent[]) => {
    onPatchTimeline?.(next);
  };

  const patchEvent = (eventId: string, patch: Partial<DramaTimelineEvent>) => {
    const id = String(eventId || '').trim();
    if (!id) return;
    commitEvents(
      events.map((e) => (String(e.event_id || '') === id ? { ...e, ...patch } : e)),
    );
  };

  const shotForSend = {
    ...shot,
    timeline_events: events,
    audio_timeline: resolveDramaShotAudioTimeline(session, { ...shot, timeline_events: events }),
  };
  const compiled = useMemo(() => {
    try {
      const hasDlg = dramaShotHasSpokenDialogue(shotForSend);
      const model = resolveDramaShotVideoModel(
        shotForSend.model_params,
        session.meta.videoBatchModel,
        {
          hasDialogue: hasDlg,
          hasShotAudio: !!String(shotForSend.audio_url || '').trim(),
        },
      );
      const mode = dramaVideoModelRequiresShotAudio(model) ? 'h3-audio' : 'h3-multi';
      return compileDramaShotVideoRequest(session, shotForSend, { mode, model, locale });
    } catch (e) {
      return {
        prompt: e instanceof Error ? e.message : String(e),
      };
    }
  }, [
    session,
    shotForSend.shot_id,
    shotForSend.duration_sec,
    shotForSend.final_prompt,
    shotForSend.last_compiled_prompt,
    shotForSend.h3_skill_prompt,
    shotForSend.audio_url,
    shotForSend.storyboard_image_url,
    shotForSend.use_storyboard_as_video_ref,
    shotForSend.scene_asset_id,
    shotForSend.model_params?.video_model,
    shotForSend.performance_plan,
    shotForSend.directing_breakdown,
    shotForSend.audio_timeline,
    (shotForSend.character_ids || []).join(','),
    session.meta.videoBatchModel,
    events,
    events
      .map(
        (e) =>
          `${e.event_id}:${e.start_sec}:${e.end_sec}:${e.visual_action}:${e.camera_action}:${e.dialogue}`,
      )
      .join('|'),
    locale,
  ]);
  const compiledDisplay = (() => {
    const skill = String(shot.h3_skill_prompt || '').trim();
    // 分镜卡中间栏：有中文优化稿则展示封口后的上云稿（勾选切换时参考对应/风格句即时变）
    if (skill && /[\u4e00-\u9fff]/.test(skill) && skill.length >= 40) {
      const style = resolveDramaShotVisualStylePrompt(session, shotForSend);
      return sealDramaProductionCloudPrompt(skill, {
        hasDialogue: dramaShotHasSpokenDialogue(shotForSend),
        preserveChinese: true,
        session,
        shot: shotForSend,
        styleHint: [
          style.body,
          style.name,
          session.bible?.project?.visual_style,
          session.bible?.project?.color_style,
          skill,
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
    return String(compiled.prompt || '').trim();
  })();

  const handleUpdatePrompt = async () => {
    if (!onPatchShot || rebuilding || busy) return;
    const ok = await showConfirm(
      '分镜脚本已更新。将按最新建议重写本镜切段/编译稿。成片不会重跑。',
    );
    if (!ok) return;
    setRebuilding(true);
    try {
      const next = rebuildDramaShotPromptFromUpstream(session, shot);
      onPatchShot({
        purpose: next.purpose,
        size: next.size,
        camera: next.camera,
        angle: next.angle,
        move: next.move,
        action: next.action,
        expression: next.expression,
        blocking: next.blocking,
        lighting: next.lighting,
        dialogue: next.dialogue,
        sfx: next.sfx,
        continuity_notes: next.continuity_notes,
        character_ids: next.character_ids,
        dramatic_purpose: next.dramatic_purpose,
        visual_focus: next.visual_focus,
        transition_in: next.transition_in,
        transition_out: next.transition_out,
        timeline_events: next.timeline_events,
        timeline_beats: next.timeline_beats,
        audio_timeline: next.audio_timeline,
        h3_skill_prompt: '',
        h3_skill_prompt_from: '',
        last_compiled_prompt: '',
        prompt_source_fingerprint: next.prompt_source_fingerprint,
      });
    } finally {
      setRebuilding(false);
    }
  };

  const handleAiReviseShot = async () => {
    if (revising || !!busy || !runChat) return;
    const hint = String(opinion || '').trim();
    if (!hint) {
      showAlert?.('请先输入修改思路，例如：改成侧脸近景，眼神更紧');
      return;
    }
    const target = events[0];
    if (!target) {
      showAlert?.('暂无时间轴，请先生成本镜切段或补全导演脚本');
      return;
    }
    const currentVisual =
      String(target.visual_action || '').trim() || compiledDisplay || String(shot.action || '').trim();
    if (!currentVisual) {
      showAlert?.('当前还没有可改的画面提示');
      return;
    }
    setRevising(true);
    try {
      const { systemPrompt, userPrompt } = buildDirectorReviseDramaCutMessages({
        shotNo: shot.shot_no,
        purpose: shot.purpose,
        size: shot.size,
        durationLabel: `${durationSec}s`,
        currentVisual,
        currentCamera: String(target.camera_action || shot.camera || '').trim(),
        dialogue: target.dialogue || (shot.dialogue || []).map((d) => d.text).filter(Boolean).join(' '),
        envAudio: (target.environment_audio || []).filter(Boolean).join('、'),
        startSec: target.start_sec,
        endSec: target.end_sec,
        opinion: hint,
        siblingCuts: events.slice(1).map((e) => ({
          event_id: e.event_id,
          range: formatTimelineRange(e.start_sec, e.end_sec),
          visual_action: String(e.visual_action || ''),
          camera_action: String(e.camera_action || ''),
        })),
      });
      const text = await runChat(systemPrompt, userPrompt, {
        max_tokens: 2048,
        temperature: 0.25,
        concurrent: true,
        skillOptimize: true,
      });
      const parsed = parseDirectorRevisedDramaCut(text);
      if (!parsed?.visual_action) {
        showAlert?.('AI 没有返回可用的画面提示，请换个思路再试');
        return;
      }
      setOpinion('');
      if (events.length <= 1) {
        patchEvent(target.event_id, {
          visual_action: parsed.visual_action,
          ...(parsed.camera_action ? { camera_action: parsed.camera_action } : {}),
        });
      } else {
        commitEvents(
          events.map((e, i) =>
            i === 0
              ? {
                  ...e,
                  visual_action: parsed.visual_action,
                  ...(parsed.camera_action ? { camera_action: parsed.camera_action } : {}),
                }
              : e,
          ),
        );
      }
      // 切段 AI 改写不冲掉已优化中文终稿；需换稿请点「提示词优化 / 重新优化」
    } catch (e) {
      showAlert?.(e instanceof Error ? e.message : 'AI 改写失败');
    } finally {
      setRevising(false);
    }
  };

  const [sbLightboxOpen, setSbLightboxOpen] = useState(false);
  const [sbPromptOpen, setSbPromptOpen] = useState(false);
  const sbUrl = resolveDramaShotStoryboardImageUrl(shot, storyboardImageUrl);
  const sbDisplay = toDisplayableDramaMediaUrl(sbUrl) || sbUrl;
  const shotNo = String(shot.shot_no || '').trim();
  const sbGenerating = !!storyboardGenerating;
  const canGenStoryboard =
    !!onGenerateShotStoryboard &&
    !!shotNo &&
    (!!String(shot.h3_skill_prompt || '').trim() ||
      !!String(shot.action || shot.purpose || '').trim());
  const storyboardPromptText = useMemo(
    () => composeDramaShotStoryboardImagePrompt(session, shot, { locale }),
    [
      session,
      shot,
      shot.h3_skill_prompt,
      shot.action,
      shot.purpose,
      shot.duration_sec,
      shot.shot_id,
      locale,
    ],
  );

  useEffect(() => {
    setSbPromptOpen(false);
  }, [shot.shot_id]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 gap-1.5">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1">
        {promptStale ? (
          <div className="flex shrink-0 items-center justify-center gap-2 px-0.5">
            <button
              type="button"
              className={`nodrag rounded-md px-2.5 py-1 text-[12px] font-semibold disabled:opacity-45 ${
                isDark
                  ? 'bg-amber-400 text-black hover:bg-amber-300'
                  : 'bg-amber-500 text-white hover:bg-amber-600'
              }`}
              disabled={rebuilding || !!busy || !onPatchShot}
              title="分镜脚本已变动，点击按最新剧本重写本镜切段与编译稿"
              onClick={() => void handleUpdatePrompt()}
            >
              {rebuilding ? '更新中…' : '更新提示词'}
            </button>
            <span className={`text-[11px] ${mutedCls(isDark)}`}>剧本已变动</span>
          </div>
        ) : null}
        <div className="min-h-0 w-full flex-1 overflow-hidden" style={{ minHeight: '10rem' }}>
          <DramaShotTimelineRuler
            durationSec={durationSec}
            events={events}
            hoverId={hoverId || undefined}
            onSelect={() => undefined}
            onHover={setHoverId}
            onChange={commitEvents}
            onPatchEvent={patchEvent}
            nameById={nameById}
            isDark={isDark}
            promptOverride={compiledDisplay || undefined}
          />
        </div>
        {!events.length ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 px-0.5 pt-0.5">
            <p className={`text-[12px] ${mutedCls(isDark)}`}>暂无时间轴</p>
            <button
              type="button"
              className={`nodrag rounded-md px-2 py-0.5 text-[12px] font-medium disabled:opacity-45 ${
                isDark
                  ? 'bg-sky-500/80 text-white hover:bg-sky-400'
                  : 'bg-sky-600 text-white hover:bg-sky-700'
              }`}
              disabled={rebuilding || !!busy || !onPatchShot}
              title="按本镜内容本地生成时间轴（不跑 LLM）"
              onClick={fillLocalTimeline}
            >
              生成本镜切段
            </button>
          </div>
        ) : null}
        <div
          className={`flex shrink-0 flex-wrap items-center gap-1 border-t pt-1 ${
            isDark ? 'border-white/10' : 'border-gray-200'
          }`}
        >
          <input
            type="text"
            className={`nodrag nowheel min-w-0 flex-1 basis-[10rem] rounded-md px-2 py-1.5 text-[12px] outline-none [color-scheme:dark] ${fieldCls}`}
            value={opinion}
            disabled={revising || !!busy || isOpinionDictationActive || opinionMicBusy}
            placeholder="修改思路，例如：改成侧脸近景…"
            onChange={(e) => setOpinion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAiReviseShot();
              }
            }}
          />
          <button
            type="button"
            {...opinionMicPointerHandlers}
            disabled={opinionMicStopping || revising || !!busy}
            style={
              opinionDictationStatus === 'listening' || opinionDictationStatus === 'connecting'
                ? micLevelCssVars(opinionDictationLevel)
                : undefined
            }
            className={`nexflow-voice-mic-btn nodrag nopan relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border select-none ${
              opinionDictationStatus === 'connecting'
                ? 'connecting'
                : opinionDictationStatus === 'listening'
                  ? 'listening'
                  : ''
            } ${
              opinionMicStopping
                ? isDark
                  ? 'cursor-wait border-white/25 bg-white/5 text-white/75'
                  : 'cursor-wait border-gray-300 bg-white/90 text-gray-600'
                : isDark
                  ? 'border-white/25 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white'
                  : 'border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-100'
            }`}
            title={
              opinionMicBusy ? '正在听写…' : isOpinionDictationActive ? '松开结束' : '按住说话'
            }
            aria-label={
              opinionMicBusy ? '正在听写…' : isOpinionDictationActive ? '松开结束' : '按住说话'
            }
            onClick={(e) => e.stopPropagation()}
          >
            <VoiceMicGlyph
              busy={opinionMicBusy}
              active={opinionDictationStatus === 'listening'}
              level={opinionDictationLevel}
            />
          </button>
          <ExecuteYuanbaoHover priceLabel={unitChatPriceLabel}>
            <button
              type="button"
              className={`nodrag rounded-md px-2.5 py-1.5 text-[13px] font-medium disabled:opacity-40 ${
                isDark
                  ? 'bg-sky-500/80 text-white hover:bg-sky-500'
                  : 'bg-gray-900 text-white hover:bg-black'
              }`}
              disabled={revising || !!busy || !runChat || !String(opinion || '').trim()}
              onClick={() => void handleAiReviseShot()}
            >
              {revising ? 'AI 改写中…' : 'AI 修改提示词'}
            </button>
          </ExecuteYuanbaoHover>
          {skillPromptActionSlot ? (
            <div className="flex shrink-0 items-stretch">{skillPromptActionSlot}</div>
          ) : null}
        </div>
      </div>

      {/* 提示词区右侧：本镜分镜图（与提示词对半宽） */}
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col gap-1 rounded-lg p-1.5 ${
          isDark ? 'bg-black/25 ring-1 ring-white/10' : 'bg-gray-50 ring-1 ring-gray-200'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-1 px-0.5">
          <label
            className={`nodrag inline-flex min-w-0 items-center gap-1.5 text-[12px] font-medium ${
              sbUrl ? '' : mutedCls(isDark)
            }`}
            title={
              sbUrl
                ? '勾选：出片参考用分镜图（+人物/道具/生物）；不勾选：用场景+人物+道具+生物'
                : '请先生成分镜图后再勾选作为出片参考'
            }
          >
            <input
              type="checkbox"
              className="nodrag h-3.5 w-3.5 accent-sky-500"
              checked={!!sbUrl && shot.use_storyboard_as_video_ref !== false}
              disabled={!!busy || !sbUrl || !onPatchShot}
              onChange={(e) => {
                e.stopPropagation();
                const checked = e.target.checked;
                onPatchShot?.({
                  use_storyboard_as_video_ref: checked,
                  ...(checked && sbUrl && !String(shot.storyboard_image_url || '').trim()
                    ? { storyboard_image_url: sbUrl }
                    : {}),
                });
              }}
              onClick={(e) => e.stopPropagation()}
            />
            <span>用分镜图作出片参考</span>
          </label>
          {storyboardImageGenSlot ? (
            <div className="flex min-w-0 flex-1 justify-end overflow-x-auto">
              {storyboardImageGenSlot}
            </div>
          ) : null}
        </div>
        <div
          className={`relative min-h-0 flex-1 overflow-hidden rounded-md ${
            isDark ? 'bg-black/40' : 'bg-white'
          }`}
        >
          {sbDisplay ? (
            <img
              src={sbDisplay}
              alt=""
              className="h-full w-full object-contain"
              draggable={false}
            />
          ) : (
            <div
              className={`flex h-full flex-col items-center justify-center gap-1 px-2 text-center text-[12px] ${mutedCls(isDark)}`}
            >
              <ImageIcon className="h-5 w-5 opacity-60" />
              <span>{sbGenerating ? '生成中…' : '待生成'}</span>
            </div>
          )}
          {sbDisplay && !sbGenerating ? (
            <button
              type="button"
              className={`nodrag absolute right-1.5 top-1.5 z-[3] rounded-md p-1.5 shadow-md ${
                isDark
                  ? 'bg-black/65 text-white hover:bg-black/80'
                  : 'bg-white/90 text-gray-800 hover:bg-white'
              }`}
              title="放大观看"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSbLightboxOpen(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <ModuleProgressBar
            visible={sbGenerating}
            progress={sbGenerating ? 35 : 0}
            solidBackground={isDark ? '#1C1C1E' : '#e5e7eb'}
            progressMessage="正在生成分镜图…"
            borderRadius={6}
          />
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            className={`nodrag flex w-full items-center justify-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium ${
              isDark
                ? 'bg-white/8 text-white/85 hover:bg-white/14'
                : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
            }`}
            title={sbPromptOpen ? '收起分镜提示词' : '展开查看分镜图生图提示词'}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setSbPromptOpen((v) => !v);
            }}
          >
            {sbPromptOpen ? (
              <ChevronUp className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            )}
            {sbPromptOpen ? '收起分镜提示词' : '分镜提示词'}
          </button>
          {sbPromptOpen ? (
            <div
              className={`nowheel max-h-[11rem] min-h-[5.5rem] overflow-y-auto rounded-md border px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words custom-scrollbar-dark ${
                isDark
                  ? 'border-white/12 bg-black/45 text-white/88'
                  : 'border-gray-200 bg-white text-gray-800'
              }`}
              onPointerDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              {storyboardPromptText || '暂无分镜提示词，请先完成优化稿或补全本镜画面'}
            </div>
          ) : null}
          <ExecuteYuanbaoHover priceLabel={unitImagePriceLabel}>
            <button
              type="button"
              className={`nodrag w-full rounded-md px-2 py-1.5 text-[12px] font-medium disabled:opacity-40 ${
                isDark
                  ? 'bg-white/12 text-white hover:bg-white/18'
                  : 'bg-gray-900 text-white hover:bg-black'
              }`}
              disabled={!!busy || sbGenerating || !canGenStoryboard}
              title={
                canGenStoryboard
                  ? sbUrl
                    ? '按优化稿重新生成分镜图（参考场景/人物/道具/生物）'
                    : '用优化稿 + 场景/人物/道具/生物参考生成分镜图'
                  : '请先完成提示词优化或补全本镜画面'
              }
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!shotNo) return;
                onGenerateShotStoryboard?.(shotNo, { force: !!sbUrl });
              }}
            >
              {sbGenerating ? '生成中…' : sbUrl ? '重新生成分镜图' : '生成分镜图'}
            </button>
          </ExecuteYuanbaoHover>
        </div>
      </div>

      {sbLightboxOpen && sbDisplay && typeof document !== 'undefined'
        ? createPortal(
            <div
              className={`fixed inset-0 z-[100002] flex items-center justify-center p-6 ${
                isDark ? 'bg-black/80' : 'bg-black/50'
              }`}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (e.target === e.currentTarget) setSbLightboxOpen(false);
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div
                className={`relative flex max-h-[min(90vh,900px)] w-full max-w-[min(92vw,1100px)] flex-col overflow-hidden rounded-2xl shadow-2xl ring-1 ${
                  isDark ? 'bg-zinc-900 ring-white/15' : 'bg-gray-100 ring-gray-200'
                }`}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
                  <div
                    className={`truncate text-base font-semibold ${
                      isDark ? 'text-white' : 'text-gray-900'
                    }`}
                  >
                    {`镜 ${shotNo || '?'} · 分镜图`}
                  </div>
                  <button
                    type="button"
                    className={`nodrag shrink-0 rounded-lg p-1.5 ${
                      isDark ? 'text-white/60 hover:bg-white/10' : 'text-gray-500 hover:bg-gray-100'
                    }`}
                    title="关闭"
                    onClick={() => setSbLightboxOpen(false)}
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-4 pb-4">
                  <img
                    src={sbDisplay}
                    alt=""
                    className="nodrag max-h-[min(78vh,780px)] max-w-full rounded-lg object-contain"
                    draggable={false}
                  />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function DramaExecuteTablePanel({
  session,
  shot,
  isDark,
  timeline,
  nameById,
  activeEventId: _activeEventId,
  onSelectEvent: _onSelectEvent,
  onPatchTimeline,
  onPatchShot,
  runChat,
  showAlert,
  busy,
  onRequestOpenEditor: _onRequestOpenEditor,
  initialTab,
  unitChatPriceLabel,
}: {
  session: DramaDirectorSession;
  shot: DramaShot;
  isDark: boolean;
  timeline: DramaTimelineEvent[];
  nameById: Map<string, string>;
  activeEventId?: string;
  onSelectEvent?: (eventId: string) => void;
  onPatchTimeline?: (events: DramaTimelineEvent[]) => void;
  onPatchShot?: (patch: Partial<DramaShot>) => void;
  runChat?: (
    systemPrompt: string,
    userPrompt: string,
    opts?: {
      max_tokens?: number;
      temperature?: number;
      model?: string;
      concurrent?: boolean;
      skillOptimize?: boolean;
      onQueueStatus?: (status: DirectorConcurrentChatQueueStatus) => void;
      signal?: AbortSignal | null;
    },
  ) => Promise<string>;
  showAlert?: (msg: string) => void;
  busy?: boolean;
  /** @deprecated 卡面请用 DramaShotPromptCardSurface */
  layout?: 'card' | 'modal';
  onRequestOpenEditor?: (opts?: { tab?: PromptTab }) => void;
  initialTab?: PromptTab;
  /** 切段 AI 改写单次悬停价 */
  unitChatPriceLabel?: string | null;
}) {
  const { locale } = useAppLocale();
  const { showConfirm } = useDarkAlert();
  const durationSec = Number(shot.duration_sec) > 0 ? Number(shot.duration_sec) : 10;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tab, setTab] = useState<PromptTab>(() => initialTab || 'compiled');
  const [compileLang, setCompileLang] = useState<'en' | 'zh'>('zh');
  const [draftVisual, setDraftVisual] = useState('');
  const [draftCamera, setDraftCamera] = useState('');
  const [opinion, setOpinion] = useState('');
  const opinionRef = useRef('');
  opinionRef.current = opinion;
  const [revising, setRevising] = useState<'cut' | 'batch' | 'rebuild' | null>(null);
  const [selectedEventId, setSelectedEventId] = useState('');
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftVisualRef = useRef('');
  const draftCameraRef = useRef('');
  const selectedIdRef = useRef('');
  const selectedIndexRef = useRef(0);
  const dirtyRef = useRef(false);
  const eventsRef = useRef<DramaTimelineEvent[]>([]);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab, shot.shot_id]);

  const {
    status: opinionDictationStatus,
    isActive: isOpinionDictationActive,
    inputLevel: opinionDictationLevel,
    start: startOpinionDictation,
    stop: stopOpinionDictation,
    cancel: cancelOpinionDictation,
  } = useCloudRealtimeDictation({
    getBaseText: () => {
      const prev = String(opinionRef.current || '').trimEnd();
      return prev ? `${prev} ` : '';
    },
    onLiveText: (full) => {
      setOpinion(full);
    },
    onError: (message) => {
      showAlert?.(message);
    },
    onMicDenied: () => {
      showAlert?.('无法使用麦克风，请检查系统权限');
    },
  });

  // 打开弹窗 / 换镜：清掉上次卡顿残留的 pointer capture 与听写锁，避免话筒「按了没反应」
  useEffect(() => {
    forceClearVoiceModalLock();
    abortAllPushToTalkPointers();
    cancelOpinionDictation();
    return () => {
      cancelOpinionDictation();
      forceClearVoiceModalLock();
      abortAllPushToTalkPointers();
    };
  }, [shot.shot_id, cancelOpinionDictation]);

  const opinionMicBusy =
    opinionDictationStatus === 'connecting' || opinionDictationStatus === 'stopping';
  const opinionMicStopping = opinionDictationStatus === 'stopping';
  const { pointerHandlers: opinionMicPointerHandlers } = useDictationPushToTalk({
    start: startOpinionDictation,
    stop: stopOpinionDictation,
    cancel: cancelOpinionDictation,
    status: opinionDictationStatus,
    disabled: opinionMicStopping || !!revising,
  });

  useEffect(() => {
    if (!isOpinionDictationActive) return;
    acquireVoiceModalLock();
    return () => releaseVoiceModalLock();
  }, [isOpinionDictationActive]);

  useEffect(() => {
    setOpinion('');
    setTab(initialTab || 'compiled');
    cancelOpinionDictation();
  }, [shot.shot_id, durationSec, initialTab, cancelOpinionDictation]);

  const events = timeline;
  eventsRef.current = events;
  const selected =
    (selectedEventId.startsWith('__idx_')
      ? events[Number(selectedEventId.slice(6))]
      : selectedEventId
        ? events.find((e) => e.event_id === selectedEventId)
        : null) ||
    events[selectedIndexRef.current] ||
    events[0] ||
    null;

  const selectEvent = useCallback((eventId: string, index?: number) => {
    const list = eventsRef.current;
    const idx =
      typeof index === 'number' && index >= 0 && index < list.length
        ? index
        : list.findIndex((e) => e.event_id && e.event_id === eventId);
    if (idx >= 0) selectedIndexRef.current = idx;
    const id = String(eventId || '').trim() || (idx >= 0 ? `__idx_${idx}` : '');
    if (!id) return;
    setSelectedEventId(id);
  }, []);

  useEffect(() => {
    const list = eventsRef.current;
    if (!list.length) return;
    if (selectedEventId.startsWith('__idx_')) {
      const idx = Number(selectedEventId.slice(6));
      if (Number.isFinite(idx) && list[idx]) {
        selectedIndexRef.current = idx;
        return;
      }
    }
    if (selectedEventId && list.some((e) => e.event_id === selectedEventId)) {
      selectedIndexRef.current = list.findIndex((e) => e.event_id === selectedEventId);
      return;
    }
    const kept = list[selectedIndexRef.current] || list[0];
    if (kept) selectEvent(kept.event_id, list.indexOf(kept));
    // 只在本镜切段变化时纠正；不要写回父级全局选中，多镜卡片会互相抢第一段
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot.shot_id, events.map((e) => e.event_id).join('|')]);

  const clearPersistTimer = useCallback(() => {
    if (persistTimerRef.current == null) return;
    clearTimeout(persistTimerRef.current);
    persistTimerRef.current = null;
  }, []);

  const flushDraft = useCallback(() => {
    clearPersistTimer();
    if (!dirtyRef.current) return;
    const id = selectedIdRef.current;
    if (!id || !onPatchTimeline) return;
    const visual = draftVisualRef.current;
    const camera = draftCameraRef.current;
    dirtyRef.current = false;
    onPatchTimeline(
      eventsRef.current.map((e) =>
        e.event_id === id ? { ...e, visual_action: visual, camera_action: camera } : e,
      ),
    );
  }, [clearPersistTimer, onPatchTimeline]);
  const flushDraftRef = useRef(flushDraft);
  flushDraftRef.current = flushDraft;

  useEffect(() => {
    flushDraft();
    const ev =
      (selectedEventId.startsWith('__idx_')
        ? events[Number(selectedEventId.slice(6))]
        : selectedEventId
          ? events.find((e) => e.event_id === selectedEventId)
          : null) ||
      events[selectedIndexRef.current] ||
      events[0];
    const visual = String(ev?.visual_action || '');
    const camera = String(ev?.camera_action || '');
    selectedIdRef.current = ev?.event_id || '';
    draftVisualRef.current = visual;
    draftCameraRef.current = camera;
    dirtyRef.current = false;
    setDraftVisual(visual);
    setDraftCamera(camera);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.event_id, selectedEventId, shot.shot_id]);

  useEffect(() => {
    if (!selected || dirtyRef.current) return;
    if (selected.event_id !== selectedIdRef.current) return;
    const visual = String(selected.visual_action || '');
    const camera = String(selected.camera_action || '');
    if (visual === draftVisualRef.current && camera === draftCameraRef.current) return;
    draftVisualRef.current = visual;
    draftCameraRef.current = camera;
    setDraftVisual(visual);
    setDraftCamera(camera);
  }, [selected?.visual_action, selected?.camera_action, selected?.event_id]);

  useEffect(() => () => flushDraftRef.current(), []);

  const schedulePersist = useCallback(
    (visual: string, camera: string) => {
      draftVisualRef.current = visual;
      draftCameraRef.current = camera;
      dirtyRef.current = true;
      clearPersistTimer();
      persistTimerRef.current = setTimeout(() => {
        persistTimerRef.current = null;
        flushDraft();
      }, 300);
    },
    [clearPersistTimer, flushDraft],
  );

  const shotForSend = {
    ...shot,
    timeline_events: events,
    audio_timeline: resolveDramaShotAudioTimeline(session, { ...shot, timeline_events: events }),
  };
  const compiled = useMemo(() => {
    try {
      const hasDlg = dramaShotHasSpokenDialogue(shotForSend);
      const model = resolveDramaShotVideoModel(
        shotForSend.model_params,
        session.meta.videoBatchModel,
        {
          hasDialogue: hasDlg,
          hasShotAudio: !!String(shotForSend.audio_url || '').trim(),
        },
      );
      const mode = dramaVideoModelRequiresShotAudio(model) ? 'h3-audio' : 'h3-multi';
      return compileDramaShotVideoRequest(session, shotForSend, { mode, model, locale });
    } catch (e) {
      return {
        mode: 'h3-multi' as const,
        model: '',
        prompt: e instanceof Error ? e.message : String(e),
        inputImages: [] as string[],
        inputAudios: [] as string[],
        durationSec: Number(shot.duration_sec) || 10,
        audit: null,
        debug: null,
      };
    }
  }, [
    session,
    shotForSend.shot_id,
    shotForSend.duration_sec,
    shotForSend.final_prompt,
    shotForSend.last_compiled_prompt,
    shotForSend.h3_skill_prompt,
    shotForSend.audio_url,
    shotForSend.storyboard_image_url,
    shotForSend.use_storyboard_as_video_ref,
    shotForSend.scene_asset_id,
    shotForSend.model_params?.video_model,
    shotForSend.performance_plan,
    shotForSend.directing_breakdown,
    shotForSend.audio_timeline,
    shotForSend.directing_enhance,
    (shotForSend.character_ids || []).join(','),
    session.meta.videoBatchModel,
    events,
    events.map((e) => `${e.event_id}:${e.start_sec}:${e.end_sec}:${(e.character_ids || []).join('+')}`).join('|'),
    locale,
  ]);

  const compiledZh = (() => {
    const skill = String(shot.h3_skill_prompt || '').trim();
    if (skill && /[\u4e00-\u9fff]/.test(skill) && skill.length >= 40) {
      const style = resolveDramaShotVisualStylePrompt(session, shotForSend);
      return sealDramaProductionCloudPrompt(skill, {
        hasDialogue: dramaShotHasSpokenDialogue(shotForSend),
        preserveChinese: true,
        session,
        shot: shotForSend,
        styleHint: [
          style.body,
          style.name,
          session.bible?.project?.visual_style,
          session.bible?.project?.color_style,
          skill,
        ]
          .filter(Boolean)
          .join(' '),
      });
    }
    return String(compiled.prompt || '').trim();
  })();
  const compiledEn = String(
    compiled.audit?.api?.editor_prompt_en || '',
  ).trim();
  const hasCompiledZh = !!compiledZh;
  const hasCompiledEn = !!compiledEn;
  const compileLangEffective: 'en' | 'zh' =
    compileLang === 'en' && hasCompiledEn
      ? 'en'
      : hasCompiledZh
        ? 'zh'
        : hasCompiledEn
          ? 'en'
          : 'zh';
  const compiledDisplay =
    compileLangEffective === 'en' ? compiledEn : compiledZh;

  const commitEvents = (next: DramaTimelineEvent[]) => {
    onPatchTimeline?.(next);
  };

  const patchEvent = (eventId: string, patch: Partial<DramaTimelineEvent>) => {
    commitEvents(events.map((e) => (e.event_id === eventId ? { ...e, ...patch } : e)));
  };

  const cutBusy = !!revising || !!busy || !runChat;
  const selectedRange = selected
    ? formatTimelineRange(selected.start_sec, selected.end_sec)
    : '';
  const who = selected
    ? (selected.character_ids || [])
        .map((id) => nameById.get(id) || id)
        .filter(Boolean)
        .join('、')
    : '';

  const handleAiReviseCut = async () => {
    if (cutBusy || !selected || !runChat) return;
    const hint = String(opinion || '').trim();
    if (!hint) {
      showAlert?.('请先输入修改思路，例如：改成侧脸近景，眼神更紧，不要和前后段同一句');
      return;
    }
    flushDraft();
    const currentVisual = String(draftVisualRef.current || selected.visual_action || '').trim();
    const currentCamera = String(draftCameraRef.current || selected.camera_action || '').trim();
    if (!currentVisual) {
      showAlert?.('当前切段还没有画面提示，请先手改或补全导演脚本');
      return;
    }
    setRevising('cut');
    try {
      const { systemPrompt, userPrompt } = buildDirectorReviseDramaCutMessages({
        shotNo: shot.shot_no,
        purpose: shot.purpose,
        size: shot.size,
        durationLabel: `${durationSec}s`,
        currentVisual,
        currentCamera,
        dialogue: selected.dialogue,
        envAudio: (selected.environment_audio || []).filter(Boolean).join('、'),
        startSec: selected.start_sec,
        endSec: selected.end_sec,
        opinion: hint,
        siblingCuts: events
          .filter((e) => e.event_id !== selected.event_id)
          .map((e) => ({
            event_id: e.event_id,
            range: formatTimelineRange(e.start_sec, e.end_sec),
            visual_action: String(e.visual_action || ''),
            camera_action: String(e.camera_action || ''),
          })),
      });
      const text = await runChat(systemPrompt, userPrompt, {
        max_tokens: 2048,
        temperature: 0.25,
        concurrent: true,
        skillOptimize: true,
      });
      const parsed = parseDirectorRevisedDramaCut(text);
      if (!parsed?.visual_action) {
        showAlert?.('AI 没有返回可用的画面提示，请换个思路再试');
        return;
      }
      dirtyRef.current = false;
      draftVisualRef.current = parsed.visual_action;
      if (parsed.camera_action) draftCameraRef.current = parsed.camera_action;
      setDraftVisual(parsed.visual_action);
      if (parsed.camera_action) setDraftCamera(parsed.camera_action);
      setOpinion('');
      patchEvent(selected.event_id, {
        visual_action: parsed.visual_action,
        ...(parsed.camera_action ? { camera_action: parsed.camera_action } : {}),
      });
    } catch (e) {
      showAlert?.(e instanceof Error ? e.message : 'AI 改写失败');
    } finally {
      setRevising(null);
    }
  };

  const handleAiReviseBatch = async () => {
    if (cutBusy || !runChat || events.length < 2) return;
    flushDraft();
    setRevising('batch');
    try {
      const { systemPrompt, userPrompt } = buildDirectorReviseDramaCutBatchMessages({
        shotNo: shot.shot_no,
        purpose: shot.purpose,
        size: shot.size,
        opinion: String(opinion || '').trim(),
        cuts: events.map((e) => ({
          event_id: e.event_id,
          range: formatTimelineRange(e.start_sec, e.end_sec),
          visual_action: String(e.visual_action || ''),
          camera_action: String(e.camera_action || ''),
        })),
      });
      const text = await runChat(systemPrompt, userPrompt, {
        max_tokens: 4096,
        temperature: 0.25,
        concurrent: true,
        skillOptimize: true,
      });
      const parsed = parseDirectorRevisedDramaCutBatch(text);
      if (!parsed?.length) {
        showAlert?.('AI 没有返回可用的切段提示，请再试一次');
        return;
      }
      const byId = new Map(parsed.map((x) => [x.event_id, x]));
      const next = events.map((e) => {
        const hit = byId.get(e.event_id);
        if (!hit) return e;
        return {
          ...e,
          visual_action: hit.visual_action,
          ...(hit.camera_action ? { camera_action: hit.camera_action } : {}),
        };
      });
      dirtyRef.current = false;
      const live = next.find((e) => e.event_id === selectedIdRef.current) || next[0];
      if (live) {
        draftVisualRef.current = live.visual_action;
        draftCameraRef.current = live.camera_action;
        setDraftVisual(live.visual_action);
        setDraftCamera(live.camera_action);
      }
      setOpinion('');
      commitEvents(next);
    } catch (e) {
      showAlert?.(e instanceof Error ? e.message : 'AI 分化失败');
    } finally {
      setRevising(null);
    }
  };

  const promptStale = isDramaBoardPromptStale(session, shot);

  const handleRebuildPrompt = async () => {
    if (!onPatchShot || revising) return;
    flushDraft();
    const tip = promptStale
      ? '分镜脚本已更新。将按最新建议重写本镜切段/编译稿。成片不会重跑。'
      : '将用分镜脚本重新导入本镜提示词与切段（覆盖当前手改切段）。成片不会重跑。';
    const ok = await showConfirm(tip);
    if (!ok) return;
    setRevising('rebuild');
    try {
      const next = rebuildDramaShotPromptFromUpstream(session, shot);
      onPatchShot({
        purpose: next.purpose,
        size: next.size,
        camera: next.camera,
        angle: next.angle,
        move: next.move,
        action: next.action,
        expression: next.expression,
        blocking: next.blocking,
        lighting: next.lighting,
        dialogue: next.dialogue,
        sfx: next.sfx,
        continuity_notes: next.continuity_notes,
        character_ids: next.character_ids,
        dramatic_purpose: next.dramatic_purpose,
        visual_focus: next.visual_focus,
        transition_in: next.transition_in,
        transition_out: next.transition_out,
        timeline_events: next.timeline_events,
        timeline_beats: next.timeline_beats,
        audio_timeline: next.audio_timeline,
        h3_skill_prompt: '',
        h3_skill_prompt_from: '',
        last_compiled_prompt: '',
        prompt_source_fingerprint: next.prompt_source_fingerprint,
      });
      setTab('compiled');
    } finally {
      setRevising(null);
    }
  };

  const fieldCls = isDark
    ? 'bg-black/35 text-white/90 ring-1 ring-white/10 focus:ring-sky-500/40 placeholder:text-white/35'
    : 'bg-white text-gray-900 ring-1 ring-gray-200 focus:ring-sky-400/50 placeholder:text-gray-400';

  return (
    <div
      className="grid h-full min-h-0 w-full min-w-0"
      style={{
        /* 彩条行高度固定，切「整镜编译稿」只改变下方提示词区，不挤压/重排彩条 */
        gridTemplateRows: 'minmax(12rem, 12rem) minmax(0, 1fr)',
      }}
    >
      <div className="min-h-0 w-full overflow-hidden">
        <DramaShotTimelineRuler
          durationSec={durationSec}
          events={events}
          activeId={selected?.event_id}
          hoverId={hoverId || undefined}
          onSelect={(id, index) => {
            setTab('cut');
            selectEvent(id, index);
          }}
          onHover={setHoverId}
          onChange={commitEvents}
          onPatchEvent={patchEvent}
          nameById={nameById}
          isDark={isDark}
        />
        {!events.length ? (
          <p className={`px-0.5 text-[13px] ${mutedCls(isDark)}`}>暂无切段，Ctrl+双击时间轴切开</p>
        ) : null}
      </div>

      <div className="mt-0.5 flex min-h-0 min-w-0 w-full flex-col overflow-hidden">
        <div
          className={`flex h-full min-h-0 flex-col rounded-md px-1.5 py-1 ${
            isDark ? 'bg-black/40 ring-1 ring-white/10' : 'bg-gray-50 ring-1 ring-gray-200'
          }`}
        >
          <div className="mb-0.5 flex shrink-0 flex-wrap items-center justify-between gap-1">
            <div className="flex items-center gap-1.5">
              <div
                className={`nodrag inline-flex items-center rounded-full p-0.5 ${
                  isDark ? 'bg-white/10 ring-1 ring-white/15' : 'bg-gray-200/90 ring-1 ring-gray-300/80'
                }`}
                role="tablist"
                aria-label="提示词视图切换"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'compiled'}
                  className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    tab === 'compiled'
                      ? isDark
                        ? 'bg-amber-400 text-black shadow-sm'
                        : 'bg-white text-amber-900 shadow-sm'
                      : isDark
                        ? 'text-white/65 hover:text-white/90'
                        : 'text-gray-600 hover:text-gray-800'
                  }`}
                  onClick={() => {
                    flushDraft();
                    setTab('compiled');
                  }}
                >
                  整镜编译稿
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === 'cut'}
                  className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors ${
                    tab === 'cut'
                      ? isDark
                        ? 'bg-amber-400 text-black shadow-sm'
                        : 'bg-white text-amber-900 shadow-sm'
                      : isDark
                        ? 'text-white/65 hover:text-white/90'
                        : 'text-gray-600 hover:text-gray-800'
                  }`}
                  onClick={() => setTab('cut')}
                >
                  切段修改
                </button>
              </div>
              <button
                type="button"
                className={`nodrag rounded-md px-2 py-1 text-[13px] font-medium disabled:opacity-40 ${
                  isDark
                    ? 'bg-emerald-500/90 text-white hover:bg-emerald-500'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
                disabled={!!revising || !!busy || !onPatchShot}
                title="用分镜脚本重新导入本镜提示词与切段。不重跑成片。"
                onClick={() => void handleRebuildPrompt()}
              >
                {revising === 'rebuild' ? '导入中…' : '重新导入提示词'}
              </button>
            </div>
            {tab === 'compiled' ? (
              <div className="flex items-center gap-1">
                {hasCompiledZh && hasCompiledEn ? (
                  <div
                    className={`nodrag inline-flex items-center rounded-full p-0.5 ${
                      isDark ? 'bg-white/10 ring-1 ring-white/15' : 'bg-gray-200/90 ring-1 ring-gray-300/80'
                    }`}
                    role="group"
                    aria-label="编译稿语言"
                  >
                    <button
                      type="button"
                      className={`rounded-full px-2 py-0.5 text-[12px] font-medium transition-colors ${
                        compileLangEffective === 'en'
                          ? isDark
                            ? 'bg-sky-400 text-black shadow-sm'
                            : 'bg-white text-sky-900 shadow-sm'
                          : isDark
                            ? 'text-white/65 hover:text-white/90'
                            : 'text-gray-600 hover:text-gray-800'
                      }`}
                      onClick={() => setCompileLang('en')}
                    >
                      英文
                    </button>
                    <button
                      type="button"
                      className={`rounded-full px-2 py-0.5 text-[12px] font-medium transition-colors ${
                        compileLangEffective === 'zh'
                          ? isDark
                            ? 'bg-sky-400 text-black shadow-sm'
                            : 'bg-white text-sky-900 shadow-sm'
                          : isDark
                            ? 'text-white/65 hover:text-white/90'
                            : 'text-gray-600 hover:text-gray-800'
                      }`}
                      onClick={() => setCompileLang('zh')}
                    >
                      中文
                    </button>
                  </div>
                ) : null}
                <button
                  type="button"
                  className={`nodrag rounded px-2 py-0.5 text-[13px] ${
                    isDark ? 'bg-white/10 text-white/80 hover:bg-white/15' : 'bg-white text-gray-700'
                  }`}
                  onClick={() => {
                    void navigator.clipboard?.writeText(compiledDisplay || '');
                  }}
                >
                  复制全文
                </button>
              </div>
            ) : (
              <div className={`text-[12px] ${mutedCls(isDark)}`}>
                {selected
                  ? `切段 ${selectedRange}${who ? ` · ${who}` : ''} · 点彩条选段，可直接改或让 AI 改`
                  : '点上方彩条选择切段'}
              </div>
            )}
          </div>

          {tab === 'compiled' ? (
            <>
              <div className={`mb-0.5 shrink-0 text-[11px] leading-tight ${mutedCls(isDark)}`}>
                {compileLangEffective === 'en'
                  ? '编辑用英文白话稿（仅预览）'
                  : String(shot.h3_skill_prompt || '').trim()
                    ? '中文优化稿（与「查看优化稿」一致，发往视频 API）'
                    : '编辑用中文稿；点「提示词优化」后将以此上云'}
              </div>
              <pre
                className={`min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-snug custom-scrollbar-dark ${
                  isDark ? 'text-white/82' : 'text-gray-800'
                }`}
              >
                {compiledDisplay || '（空）'}
              </pre>
            </>
          ) : !selected ? (
            <p className={`px-0.5 text-[13px] ${mutedCls(isDark)}`}>暂无切段可改</p>
          ) : (
            <>
              <label className={`mb-0.5 shrink-0 text-[11px] leading-tight ${mutedCls(isDark)}`}>
                机位 / 运镜
                <input
                  type="text"
                  className={`nodrag nowheel mt-0.5 w-full rounded-md px-1.5 py-0.5 text-[12px] outline-none ${fieldCls}`}
                  value={draftCamera}
                  disabled={!!revising}
                  placeholder="例如：斯坦尼康贴身呼吸跟拍，膝高距1.2m"
                  onChange={(e) => {
                    const value = e.target.value;
                    setDraftCamera(value);
                    schedulePersist(draftVisualRef.current, value);
                  }}
                />
              </label>
              <textarea
                className={`nodrag nowheel min-h-[2.5rem] flex-1 resize-none rounded-md px-1.5 py-1 text-[12px] leading-snug outline-none custom-scrollbar-dark ${fieldCls}`}
                value={draftVisual}
                disabled={!!revising}
                placeholder="本段画面提示：写可见表演。直接改，或在下方输入修改思路让 AI 改。"
                onChange={(e) => {
                  const value = e.target.value;
                  setDraftVisual(value);
                  schedulePersist(value, draftCameraRef.current);
                }}
                onBlur={() => flushDraft()}
              />
              <div
                className={`mt-1 flex shrink-0 flex-wrap items-center gap-1 border-t pt-1 ${
                  isDark ? 'border-white/10' : 'border-gray-200'
                }`}
              >
                <input
                  type="text"
                  className={`nodrag nowheel min-w-0 flex-1 basis-[10rem] rounded-md px-1.5 py-1 text-[12px] outline-none ${fieldCls}`}
                  value={opinion}
                  disabled={!!revising || isOpinionDictationActive || opinionMicBusy}
                  placeholder="修改思路，例如：改成侧脸近景，别和前后段同一句表演"
                  onChange={(e) => setOpinion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAiReviseCut();
                    }
                  }}
                />
                <button
                  type="button"
                  {...opinionMicPointerHandlers}
                  disabled={opinionMicStopping || !!revising}
                  style={
                    opinionDictationStatus === 'listening' ||
                    opinionDictationStatus === 'connecting'
                      ? micLevelCssVars(opinionDictationLevel)
                      : undefined
                  }
                  className={`nexflow-voice-mic-btn nodrag nopan relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border select-none ${
                    opinionDictationStatus === 'connecting'
                      ? 'connecting'
                      : opinionDictationStatus === 'listening'
                        ? 'listening'
                        : ''
                  } ${
                    opinionMicStopping
                      ? isDark
                        ? 'cursor-wait border-white/25 bg-white/5 text-white/75'
                        : 'cursor-wait border-gray-300 bg-white/90 text-gray-600'
                      : isDark
                        ? 'border-white/25 bg-white/5 text-white/75 hover:bg-white/10 hover:text-white'
                        : 'border-gray-300 bg-white/90 text-gray-600 hover:bg-gray-100'
                  }`}
                  title={
                    opinionMicBusy
                      ? '正在听写…'
                      : isOpinionDictationActive
                        ? '松开结束'
                        : '按住说话'
                  }
                  aria-label={
                    opinionMicBusy
                      ? '正在听写…'
                      : isOpinionDictationActive
                        ? '松开结束'
                        : '按住说话'
                  }
                  onClick={(e) => e.stopPropagation()}
                >
                  <VoiceMicGlyph
                    busy={opinionMicBusy}
                    active={opinionDictationStatus === 'listening'}
                    level={opinionDictationLevel}
                  />
                </button>
                <ExecuteYuanbaoHover priceLabel={unitChatPriceLabel}>
                  <button
                    type="button"
                    className={`nodrag rounded-md px-2.5 py-1.5 text-[13px] font-medium disabled:opacity-40 ${
                      isDark
                        ? 'bg-sky-500/80 text-white hover:bg-sky-500'
                        : 'bg-gray-900 text-white hover:bg-black'
                    }`}
                    disabled={cutBusy || !String(opinion || '').trim()}
                    onClick={() => void handleAiReviseCut()}
                  >
                    {revising === 'cut' ? 'AI 改写中…' : 'AI 改当前切段'}
                  </button>
                </ExecuteYuanbaoHover>
                {events.length >= 2 ? (
                  <ExecuteYuanbaoHover priceLabel={unitChatPriceLabel}>
                    <button
                      type="button"
                      className={`nodrag rounded-md px-2.5 py-1.5 text-[13px] font-medium disabled:opacity-40 ${
                        isDark
                          ? 'bg-orange-500/90 text-white hover:bg-orange-500'
                          : 'bg-orange-500 text-white hover:bg-orange-600'
                      }`}
                      disabled={cutBusy}
                      title="按全景/中景/近景把各段画面提示拉开，避免复制同一句"
                      onClick={() => void handleAiReviseBatch()}
                    >
                      {revising === 'batch' ? '分化中…' : 'AI 分化全部切段'}
                    </button>
                  </ExecuteYuanbaoHover>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
