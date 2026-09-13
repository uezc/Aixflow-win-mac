/**
 * 分镜卡左栏：场景/人物/道具/生物同一排，末尾添加卡。
 * 超过 5 张（含添加卡）改为 10 列。对口型：场景图下挂本镜声音；全能参考：人物图下挂角色参考音。
 */

import React, { useState } from 'react';
import {
  countDramaShotRefImages,
  dramaCostumeImageUrl,
  dramaShotNeedsAudioContent,
  dramaVideoModelLabel,
  dramaVideoModelMaxRefImages,
  dramaVideoModelRequiresShotAudio,
  dramaShotHasSpokenDialogue,
  dramaShotHasOnlySystemDialogue,
  activeDramaCostume,
  findDramaCostumeOwner,
  listDramaShotRefAudioSlots,
  listDramaShotRefImageSlots,
  resolveBoardShotCreatures,
  resolveBoardShotProps,
  resolveCharacterMasterReferenceUrl,
  resolveDramaShotVideoModel,
  resolveDramaShotVoiceIds,
  resolvePropMasterReferenceUrl,
  resolveSceneMasterReferenceUrl,
  resolveDramaCharacterLookUrl,
  setActiveDramaCharacterCostume,
  dramaShotRequiresCast,
  collectDramaShotCastGateIssues,
  resolveEffectiveDramaShotCharacterIds,
  isDramaSystemVoiceId,
  type DramaDirectorSession,
  type DramaShot,
  type DramaShotRefImageSlotView,
} from '../../../shared/directorDomain';
import { MusicPlayer } from '../Workspace/MusicPlayer';
import { RefImageHoverThumb } from '../Canvas/RefImageHoverThumb';
import { ModuleProgressBar } from '../Canvas/ModuleProgressBar';
import { yuanbaoHoverTipAboveCls } from '../darkModalShell';
import { AudioLines, Coins } from 'lucide-react';
import {
  DramaShotAddAssetCard,
  type DramaShotAddKind,
  type DramaShotAddOpt,
} from './DramaShotAddAssetCard';

function mutedCls(isDark: boolean) {
  return isDark ? 'text-white/50' : 'text-gray-500';
}

/** 造型切换标签颜色组：按索引循环分配，每个造型一种颜色 */
const COSTUME_TAG_COLORS = [
  '#0ea5e9', // sky
  '#8b5cf6', // violet
  '#10b981', // emerald
  '#f59e0b', // amber
  '#f43f5e', // rose
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
] as const;

function LongPressThumb({
  children,
  onRemove,
  busy,
  isDark,
}: {
  children: React.ReactNode;
  onRemove?: () => void;
  busy?: boolean;
  isDark: boolean;
}) {
  return (
    <div className="relative">
      {children}
      {onRemove ? (
        <button
          type="button"
          className={`nodrag absolute right-0.5 top-0.5 z-10 flex h-5 w-5 items-center justify-center rounded-full text-[12px] font-bold leading-none disabled:opacity-40 ${
            isDark
              ? 'bg-black/75 text-white/90 hover:bg-rose-600'
              : 'bg-white/95 text-gray-700 shadow hover:bg-rose-600 hover:text-white'
          }`}
          disabled={busy}
          title="移出本镜（场景/人物非必填）"
          aria-label="移出本镜"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function SlotIndexTag({
  label,
  isDark,
}: {
  label: string;
  isDark: boolean;
}) {
  return (
    <div
      className={`mt-0.5 text-center text-[10px] font-semibold tabular-nums leading-none ${
        isDark ? 'text-sky-300' : 'text-sky-700'
      }`}
    >
      {label}
    </div>
  );
}

function CharRefAudio({
  url,
  isDark,
  mediaActive = true,
  audioIndex,
}: {
  url?: string;
  isDark: boolean;
  mediaActive?: boolean;
  audioIndex?: number;
}) {
  return (
    <div className="mt-0.5 min-h-[78px] min-w-0">
      <MusicPlayer
        audioUrl={String(url || '').trim()}
        isDarkMode={isDark}
        cardWaveform
        mediaActive={mediaActive}
      />
      {audioIndex && audioIndex > 0 ? (
        <SlotIndexTag label={`声音${audioIndex}`} isDark={isDark} />
      ) : null}
    </div>
  );
}

function resolveBoardShotScene(session: DramaDirectorSession, shot: DramaShot) {
  const id = String(shot.scene_asset_id || '').trim();
  if (!id) return null;
  return session.bible.scenes.find((s) => s.scene_id === id) || null;
}

function resolveBoardShotCharacters(session: DramaDirectorSession, shot: DramaShot) {
  // 与参考图槽一致：镜级 + 时间轴 + 文案点名
  const ids = resolveEffectiveDramaShotCharacterIds(session, shot);
  const byId = new Map(session.bible.characters.map((c) => [c.character_id, c]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as NonNullable<
    ReturnType<typeof byId.get>
  >[];
}

/** 本镜人物卡取图：指定造型只用这一套，绝不回退到默认服装旧图。 */
function resolveShotCharacterDisplay(
  session: DramaDirectorSession,
  shot: DramaShot,
  characterId: string,
): { url: string; costumeId: string } {
  const ch = session.bible.characters.find((c) => c.character_id === characterId);
  const castMember = (shot.cast || []).find((m) => m.character_id === characterId);
  const costumeId =
    String(castMember?.costume_id || '').trim() ||
    String(activeDramaCostume(ch)?.costume_id || '').trim();
  const lookUrl = resolveDramaCharacterLookUrl(ch, costumeId);
  const url = lookUrl || (!costumeId ? String(ch?.imageUrl || '').trim() : '');
  return { url, costumeId };
}

function descForSlot(
  session: DramaDirectorSession,
  shot: DramaShot,
  slot: DramaShotRefImageSlotView,
): string {
  if (slot.role === 'style') {
    return (
      session.bible.projectVisualBible?.stylePrompt ||
      session.bible.visualDNA?.generatedPrompt ||
      session.meta.globalStyle ||
      '全片风格参考（光色锁）'
    );
  }
  if (slot.role === 'storyboard') {
    return '本镜分镜参考图';
  }
  if (slot.role === 'scene') {
    const sc =
      session.bible.scenes.find((s) => s.scene_id === slot.asset_id) ||
      resolveBoardShotScene(session, shot);
    return String(sc?.prompt || sc?.mood || sc?.location || '').trim();
  }
  if (slot.role === 'character') {
    const ch = session.bible.characters.find((c) => c.character_id === slot.asset_id);
    return String(ch?.prompt || '').trim();
  }
  if (slot.role === 'prop') {
    const p = session.bible.props.find((x) => x.prop_id === slot.asset_id);
    return String(p?.prompt || p?.description || p?.appearance || '').trim();
  }
  if (slot.role === 'creature') {
    const c = session.bible.creatures.find((x) => x.creature_id === slot.asset_id);
    return String(c?.prompt || c?.appearance || '').trim();
  }
  return '';
}

export function DramaShotRefZones({
  session,
  shot,
  isDark,
  busy,
  thumbBox,
  mediaActive = true,
  onPatchShot,
  onSessionChange,
  onGenerateShotAudio,
  onAbandonShotAudio,
  unitVoicePriceLabel,
  showAlert,
}: {
  session: DramaDirectorSession;
  shot: DramaShot;
  isDark: boolean;
  busy: boolean;
  thumbBox: (extra?: string) => string;
  /** 焦点镜才挂波形/预载音频；邻镜点播放再加载 */
  mediaActive?: boolean;
  onPatchShot: (shotId: string, patch: Partial<DramaShot>) => void;
  /** 切换装扮等需要改 bible 时用 */
  onSessionChange?: (next: DramaDirectorSession) => void;
  onGenerateShotAudio?: (shotId: string) => void;
  onAbandonShotAudio?: (shotId: string) => void;
  unitVoicePriceLabel?: string | null;
  showAlert: (msg: string) => void;
}) {
  const characters = resolveBoardShotCharacters(session, shot);
  const props = resolveBoardShotProps(session, shot);
  const creatures = resolveBoardShotCreatures(session, shot);
  const videoModel = resolveDramaShotVideoModel(shot.model_params, session.meta.videoBatchModel, {
    hasDialogue: dramaShotHasSpokenDialogue(shot),
    hasShotAudio: !!String(shot.audio_url || '').trim(),
  });
  const maxRefImages = dramaVideoModelMaxRefImages(videoModel);
  /** 本镜融合音轨仅对口型需要；全能参考用各角色参考音，不展示本镜声音区 */
  const showShotAudioUi = dramaVideoModelRequiresShotAudio(videoModel);
  const refImageSlots = listDramaShotRefImageSlots(session, shot, { maxImages: maxRefImages });
  const refAudioSlots = listDramaShotRefAudioSlots(session, shot);

  const audioByChar = new Map<string, string>();
  for (const a of refAudioSlots) {
    if (a.character_id && a.sample_url && !audioByChar.has(a.character_id)) {
      audioByChar.set(a.character_id, String(a.sample_url).trim());
    }
  }
  const sampleUrlForCharacter = (characterId: string) => {
    const fromSlot = audioByChar.get(characterId);
    if (fromSlot) return fromSlot;
    const ch = session.bible.characters.find((c) => c.character_id === characterId);
    if (!ch) return '';
    const voice =
      session.bible.voices.find((v) => v.voice_id === ch.voice_id) ||
      session.bible.voices.find((v) => v.character_id === ch.character_id);
    return String(voice?.identity?.reference_audio || voice?.sample_url || '').trim();
  };
  const audioIndexForId = (characterId: string) => {
    const hit = refAudioSlots.find((a) => a.character_id === characterId);
    return hit && hit.index > 0 ? hit.index : 0;
  };

  const patch = (partial: Partial<DramaShot>) => onPatchShot(shot.shot_id, partial);

  const boundChar = new Set(shot.character_ids || []);
  const boundProp = new Set([...(shot.prop_ids || []), ...(shot.required_prop_ids || [])]);
  const boundCreature = new Set(shot.creature_ids || []);

  const addImageOptions: DramaShotAddOpt[] = [];
  for (const sc of session.bible.scenes || []) {
    if (sc.scene_id && sc.scene_id !== shot.scene_asset_id) {
      addImageOptions.push({
        value: `scene:${sc.scene_id}`,
        label: sc.name || sc.scene_id,
        kind: 'scene',
        thumb: resolveSceneMasterReferenceUrl(sc) || String(sc.imageUrl || '').trim(),
      });
    }
  }
  for (const ch of session.bible.characters || []) {
    if (!ch.character_id) continue;
    const costumes = (ch.costumes || []).filter((c) => dramaCostumeImageUrl(c));
    if (costumes.length > 0) {
      for (const cos of costumes) {
        // 已出场人物也会列出：方便换成刚上传的其它装扮形象
        addImageOptions.push({
          value: `costume:${cos.costume_id}`,
          label:
            costumes.length > 1
              ? `${ch.name || ch.character_id}·${cos.name || '装扮'}`
              : ch.name || ch.character_id,
          kind: 'character',
          thumb: dramaCostumeImageUrl(cos),
        });
      }
      continue;
    }
    if (boundChar.has(ch.character_id)) continue;
    const master =
      resolveCharacterMasterReferenceUrl(ch) || String(ch.imageUrl || '').trim();
    addImageOptions.push({
      value: `character:${ch.character_id}`,
      label: ch.name || ch.character_id,
      kind: 'character',
      thumb: master,
    });
  }
  for (const p of session.bible.props || []) {
    if (p.prop_id && !boundProp.has(p.prop_id)) {
      addImageOptions.push({
        value: `prop:${p.prop_id}`,
        label: p.name || p.prop_id,
        kind: 'prop',
        thumb: resolvePropMasterReferenceUrl(p) || String(p.imageUrl || '').trim(),
      });
    }
  }
  for (const c of session.bible.creatures || []) {
    if (c.creature_id && !boundCreature.has(c.creature_id)) {
      addImageOptions.push({
        value: `creature:${c.creature_id}`,
        label: c.name || c.creature_id,
        kind: 'creature',
        thumb: String(c.imageUrl || '').trim(),
      });
    }
  }

  const usedRefImages = countDramaShotRefImages(session, shot);
  const refSlotsFull = usedRefImages >= maxRefImages;
  const hasBoundScene = !!String(shot.scene_asset_id || '').trim();
  const canAddKind = (kind: DramaShotAddKind) => {
    if (kind === 'scene') return !refSlotsFull || hasBoundScene;
    return !refSlotsFull;
  };
  const quotaLabel = `${dramaVideoModelLabel(videoModel)} 参考图 ${usedRefImages}/${maxRefImages}${
    refSlotsFull ? ' · 已满' : ''
  }`;
  const quotaBlockedMsg = `${dramaVideoModelLabel(videoModel)} 最多参考 ${maxRefImages} 张图（当前 ${usedRefImages} 张）。请先点缩略图右上角 × 移出后再添加。`;

  const addImageRef = (raw: string) => {
    const [kind, id] = String(raw || '').split(':') as [DramaShotAddKind | 'costume' | string, string];
    if (!kind || !id) return;
    if (kind === 'costume') {
      const owner = findDramaCostumeOwner(session, id);
      if (!owner) {
        showAlert('找不到该装扮，请回素材准备检查');
        return;
      }
      const characterId = owner.character.character_id;
      if (!canAddKind('character') && !boundChar.has(characterId)) {
        showAlert(quotaBlockedMsg);
        return;
      }
      if (!dramaCostumeImageUrl(owner.costume)) {
        showAlert('该装扮尚无形象图，请先生成或上传后再添加到本镜');
        return;
      }
      let nextSession = setActiveDramaCharacterCostume(session, characterId, id);
      const character_ids = [...(shot.character_ids || []), characterId].filter(
        (x, i, arr) => x && arr.indexOf(x) === i,
      );
      const existingCast = (shot.cast || []).find((m) => m.character_id === characterId);
      const nextCast = existingCast
        ? (shot.cast || []).map((m) =>
            m.character_id === characterId ? { ...m, costume_id: id } : m,
          )
        : [
            ...(shot.cast || []),
            {
              character_id: characterId,
              screen_position: '',
              action: '',
              expression: '',
              emotion: { primary: '', intensity: 0.6 },
              performance: '',
              dialogue_ids: [] as string[],
              voice_id: '',
              costume_id: id,
            },
          ];
      const ch = nextSession.bible.characters.find((c) => c.character_id === characterId);
      const voice =
        (ch &&
          (nextSession.bible.voices.find((v) => v.voice_id === ch.voice_id) ||
            nextSession.bible.voices.find((v) => v.character_id === ch.character_id))) ||
        null;
      const voice_ids = resolveDramaShotVoiceIds(nextSession, { ...shot, character_ids });
      const nextVoices =
        voice?.voice_id && !voice_ids.includes(voice.voice_id)
          ? [...voice_ids, voice.voice_id].slice(0, 3)
          : voice_ids;
      nextSession = {
        ...nextSession,
        shots: nextSession.shots.map((s) =>
          s.shot_id === shot.shot_id
            ? { ...s, character_ids, voice_ids: nextVoices, cast: nextCast }
            : s,
        ),
      } as DramaDirectorSession;
      if (onSessionChange) onSessionChange(nextSession);
      else patch({ character_ids, voice_ids: nextVoices, cast: nextCast });
      return;
    }
    if (!canAddKind(kind as DramaShotAddKind)) {
      showAlert(quotaBlockedMsg);
      return;
    }
    if (kind === 'scene') {
      patch({ scene_asset_id: id });
      return;
    }
    if (kind === 'character') {
      const ch = session.bible.characters.find((c) => c.character_id === id);
      if (!resolveCharacterMasterReferenceUrl(ch)) {
        showAlert('该人物尚无可用形象图，请先回「资产生成」完成形象后再添加到本镜');
        return;
      }
      const character_ids = [...(shot.character_ids || []), id].filter(
        (x, i, arr) => x && arr.indexOf(x) === i,
      );
      const removed_character_ids = (shot.removed_character_ids || []).filter((rid) => rid !== id);
      const voice =
        (ch &&
          (session.bible.voices.find((v) => v.voice_id === ch.voice_id) ||
            session.bible.voices.find((v) => v.character_id === ch.character_id))) ||
        null;
      const voice_ids = resolveDramaShotVoiceIds(session, { ...shot, character_ids });
      const nextVoices =
        voice?.voice_id && !voice_ids.includes(voice.voice_id)
          ? [...voice_ids, voice.voice_id].slice(0, 3)
          : voice_ids;
      patch({ character_ids, removed_character_ids, voice_ids: nextVoices });
      return;
    }
    if (kind === 'prop') {
      patch({
        prop_ids: [...(shot.prop_ids || []), id].filter((x, i, arr) => x && arr.indexOf(x) === i),
      });
      return;
    }
    if (kind === 'creature') {
      patch({
        creature_ids: [...(shot.creature_ids || []), id].filter(
          (x, i, arr) => x && arr.indexOf(x) === i,
        ),
      });
    }
  };

  const removeSlot = (slot: DramaShotRefImageSlotView) => {
    if (slot.role === 'storyboard') {
      patch({ storyboard_image_url: '' });
      return;
    }
    if (slot.role === 'scene') {
      patch({ scene_asset_id: '' });
      return;
    }
    if (slot.role === 'character' && slot.asset_id) {
      const character_ids = (shot.character_ids || []).filter((id) => id !== slot.asset_id);
      const removed_character_ids = [...new Set([...(shot.removed_character_ids || []), slot.asset_id])].filter(Boolean);
      const ch = session.bible.characters.find((c) => c.character_id === slot.asset_id);
      const dropVoice =
        (ch &&
          (session.bible.voices.find((v) => v.voice_id === ch.voice_id) ||
            session.bible.voices.find((v) => v.character_id === ch.character_id))) ||
        null;
      const voice_ids = resolveDramaShotVoiceIds(session, shot).filter(
        (id) => id !== dropVoice?.voice_id,
      );
      patch({ character_ids, removed_character_ids, voice_ids });
      return;
    }
    if (slot.role === 'prop' && slot.asset_id) {
      patch({
        prop_ids: (shot.prop_ids || []).filter((id) => id !== slot.asset_id),
        required_prop_ids: (shot.required_prop_ids || []).filter((id) => id !== slot.asset_id),
      });
      return;
    }
    if (slot.role === 'creature' && slot.asset_id) {
      patch({
        creature_ids: (shot.creature_ids || []).filter((id) => id !== slot.asset_id),
      });
    }
  };

  // 无图但仍绑定的人物/道具/生物（不占出片序号，排在有图槽之后）
  const slottedAssetIds = new Set(
    refImageSlots.map((s) => s.asset_id).filter(Boolean) as string[],
  );
  const orphanChars = characters.filter((c) => !slottedAssetIds.has(c.character_id));
  const orphanProps = props.filter((p) => !slottedAssetIds.has(p.prop_id));
  const orphanCreatures = creatures.filter((c) => !slottedAssetIds.has(c.creature_id));

  const audioUrl = String(shot.audio_url || '').trim();
  const audioGenerating = String(shot.audio_status || '').trim() === 'generating';
  const canAudio = dramaShotNeedsAudioContent(shot);
  const hasDlg = dramaShotHasSpokenDialogue(shot);
  const onlySystemDlg = dramaShotHasOnlySystemDialogue(session, shot);

  const sceneSlots = refImageSlots.filter((s) => s.role === 'scene');
  const storyboardSlots = refImageSlots.filter((s) => s.role === 'storyboard');
  const charRowSlots = refImageSlots.filter((s) => s.role === 'character');
  const propSlots = refImageSlots.filter((s) => s.role === 'prop');
  const creatureSlots = refImageSlots.filter((s) => s.role === 'creature');

  // 场景：已绑定则必须有图。人物：非空镜必须绑定且有图；空镜可不绑人物。
  const sceneBound = sceneSlots.length > 0 || !!String(shot.scene_asset_id || '').trim();
  const sceneOk =
    !sceneBound || sceneSlots.some((s) => !!String(s.url || '').trim());
  const requiresCast = dramaShotRequiresCast(shot);
  const castGateIssues = collectDramaShotCastGateIssues(session, shot);
  const charBound = charRowSlots.length + orphanChars.length > 0 || requiresCast;
  const charsOk =
    requiresCast
      ? castGateIssues.length === 0 &&
        characters.length > 0 &&
        characters.every((c) => {
          const url = resolveCharacterMasterReferenceUrl(c);
          if (!url) return false;
          return slottedAssetIds.has(c.character_id);
        })
      : !charBound ||
        characters.every((c) => {
          const url = resolveCharacterMasterReferenceUrl(c);
          if (!url) return false;
          return slottedAssetIds.has(c.character_id);
        });
  const voiceOk = !canAudio
    ? true
    : showShotAudioUi
      ? !!audioUrl
      : refAudioSlots.length > 0 || !!audioUrl;
  const materialsOk = sceneOk && charsOk && voiceOk;

  const generateShotAudio = () => {
    if (!canAudio) {
      showAlert('请先为本镜填写对白或环境音效');
      return;
    }
    if (hasDlg && refAudioSlots.length === 0 && !onlySystemDlg) {
      showAlert('本镜有对白但尚无角色参考音，请先为出场人物准备试听音（素材准备）');
      return;
    }
    onGenerateShotAudio?.(shot.shot_id);
  };

  const [audioPriceHover, setAudioPriceHover] = useState(false);
  const shotAudioPriceTip = String(unitVoicePriceLabel || '').trim();
  const shotAudioGenButton = audioGenerating ? (
    <button
      type="button"
      className={`nodrag box-border flex h-7 w-full items-center justify-center gap-1 rounded-md px-2 text-[11px] leading-none ${
        isDark ? 'bg-white/10 text-white/85 hover:bg-white/15' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
      title="仅取消本地等待；已发出的任务无法撤回，费用不退"
      disabled={!onAbandonShotAudio}
      onClick={() => onAbandonShotAudio?.(shot.shot_id)}
    >
      <span className="whitespace-nowrap">放弃生成</span>
    </button>
  ) : (
    <span
      className="relative flex w-full min-w-0 overflow-visible"
      onMouseEnter={() => setAudioPriceHover(true)}
      onMouseLeave={() => setAudioPriceHover(false)}
    >
      {audioPriceHover && shotAudioPriceTip ? (
        <span
          className={`${yuanbaoHoverTipAboveCls} translate-y-0 opacity-100`}
          title={shotAudioPriceTip}
        >
          <Coins className="h-3 w-3 shrink-0 text-amber-300" aria-hidden strokeWidth={2.25} />
          <span>{shotAudioPriceTip}</span>
        </span>
      ) : null}
      <button
        type="button"
        className={`nodrag box-border flex h-7 w-full items-center justify-center gap-1 rounded-md px-2 text-[11px] leading-none disabled:opacity-40 ${
          isDark ? 'bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/35' : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
        }`}
        disabled={busy || !canAudio || !onGenerateShotAudio}
        title={audioUrl ? '重新生成本镜配音' : '本镜配音生成'}
        onClick={generateShotAudio}
      >
        <AudioLines className="h-3.5 w-3.5 shrink-0" strokeWidth={2.25} />
        <span className="whitespace-nowrap">
          {audioUrl ? '重新生成本镜配音' : '本镜配音生成'}
        </span>
      </button>
    </span>
  );

  const shotAudioBlock = (
    <div className="relative mt-0.5 min-w-0">
      <div className="relative min-h-[78px] min-w-0 overflow-hidden rounded-md">
        {!audioGenerating ? (
          <MusicPlayer
            audioUrl={audioUrl}
            isDarkMode={isDark}
            cardWaveform
            mediaActive={mediaActive}
          />
        ) : null}
        <ModuleProgressBar
          visible={audioGenerating}
          progress={audioGenerating ? 35 : 100}
          solidBackground={isDark ? '#1C1C1E' : '#e5e7eb'}
          progressMessage="音频生成中"
          borderRadius={6}
        />
        {!audioUrl && !audioGenerating ? (
          <div
            className={`absolute inset-0 flex items-center justify-center text-[12px] ${mutedCls(isDark)}`}
          >
            待生成本镜声音
          </div>
        ) : null}
      </div>
      <SlotIndexTag label="声音1" isDark={isDark} />
      <div className="mt-1 w-full min-w-0">{shotAudioGenButton}</div>
    </div>
  );

  type GalleryCard = {
    key: string;
    kindLabel: string;
    name: string;
    url: string;
    desc: string;
    onRemove?: () => void;
    showShotAudio?: boolean;
    charAudioUrl?: string;
    /** 出片 <Picture N>，与 nodeInfoList 图槽一致 */
    pictureIndex?: number;
    /** 出片 <Audio N>，与 nodeInfoList 参考音槽一致 */
    audioIndex?: number;
    /** 角色有多个造型时：本镜独立切换标签 */
    costumeOptions?: {
      characterId: string;
      costumes: { costume_id: string; name: string }[];
      currentCostumeId?: string;
    };
  };

  const galleryCards: GalleryCard[] = [];
  sceneSlots.forEach((slot, i) => {
    galleryCards.push({
      key: `scene-${slot.asset_id || slot.url || i}`,
      kindLabel: '场景图',
      name: String(slot.name || '场景').trim(),
      url: slot.url,
      desc: descForSlot(session, shot, slot),
      onRemove: () => removeSlot(slot),
      showShotAudio: showShotAudioUi && i === 0,
      pictureIndex: slot.index,
      audioIndex: showShotAudioUi && i === 0 ? 1 : undefined,
    });
  });
  const shotAudioOnGallery = galleryCards.some((c) => c.showShotAudio);
  storyboardSlots.forEach((slot, i) => {
    galleryCards.push({
      key: `sb-${slot.url || i}`,
      kindLabel: '分镜',
      name: String(slot.name || '分镜').trim(),
      url: slot.url,
      desc: descForSlot(session, shot, slot),
      onRemove: () => removeSlot(slot),
      pictureIndex: slot.index,
    });
  });
  let charSerial = 0;
  charRowSlots.forEach((slot) => {
    charSerial += 1;
    const ch = characters.find((c) => c.character_id === slot.asset_id);
    const costumes = (ch?.costumes || []).filter((cos) => cos.costume_id);
    const display = slot.asset_id
      ? resolveShotCharacterDisplay(session, shot, slot.asset_id)
      : { url: slot.url, costumeId: '' };
    galleryCards.push({
      key: `char-${slot.asset_id || display.url || charSerial}:${display.costumeId}:${display.url}`,
      kindLabel: `人物${charSerial}`,
      name: String(slot.name || '').trim(),
      url: display.url,
      desc: descForSlot(session, shot, slot),
      onRemove: () => removeSlot(slot),
      charAudioUrl: slot.asset_id ? sampleUrlForCharacter(slot.asset_id) : '',
      pictureIndex: slot.index,
      audioIndex: slot.asset_id ? audioIndexForId(slot.asset_id) : 0,
      costumeOptions:
        costumes.length > 1 && slot.asset_id
          ? {
              characterId: slot.asset_id,
              costumes: costumes.map((cos) => ({
                costume_id: cos.costume_id,
                name: cos.name || '造型',
              })),
              currentCostumeId: display.costumeId,
            }
          : undefined,
    });
  });
  orphanChars.forEach((ch) => {
    charSerial += 1;
    // 本镜造型覆盖：孤儿角色也支持按 shot.cast 切换参考图
    const display = resolveShotCharacterDisplay(session, shot, ch.character_id);
    const costumes = (ch.costumes || []).filter((cos) => cos.costume_id);
    galleryCards.push({
      key: `orphan-ch-${ch.character_id}:${display.costumeId}:${display.url}`,
      kindLabel: display.url ? `人物${charSerial}·未送出` : `人物${charSerial}·无图`,
      name: ch.name,
      url: display.url,
      costumeOptions:
        costumes.length > 1
          ? {
              characterId: ch.character_id,
              costumes: costumes.map((cos) => ({
                costume_id: cos.costume_id,
                name: cos.name || '造型',
              })),
              currentCostumeId: display.costumeId,
            }
          : undefined,
      desc: display.url
        ? `参考图额度已满（${maxRefImages}），本人物有图但未进入出片槽；请减少场景/道具或换全能参考后再添加。`
        : String(ch.prompt || '').trim(),
      onRemove: () => {
        const character_ids = (shot.character_ids || []).filter((id) => id !== ch.character_id);
        const removed_character_ids = [...new Set([...(shot.removed_character_ids || []), ch.character_id])].filter(Boolean);
        const dropVoice =
          session.bible.voices.find((v) => v.voice_id === ch.voice_id) ||
          session.bible.voices.find((v) => v.character_id === ch.character_id);
        const voice_ids = resolveDramaShotVoiceIds(session, shot).filter(
          (id) => id !== dropVoice?.voice_id,
        );
        patch({ character_ids, removed_character_ids, voice_ids });
      },
      charAudioUrl: sampleUrlForCharacter(ch.character_id),
      audioIndex: audioIndexForId(ch.character_id),
    });
  });
  const sysAudio = refAudioSlots.find((a) => isDramaSystemVoiceId(a.character_id));
  if (sysAudio?.sample_url) {
    galleryCards.push({
      key: 'system-voice',
      kindLabel: '系统音',
      name: '系统',
      url: '',
      desc: '非人物语音，不进画面 Subject',
      charAudioUrl: String(sysAudio.sample_url).trim(),
      audioIndex: sysAudio.index,
    });
  }
  propSlots.forEach((slot, i) => {
    galleryCards.push({
      key: `prop-${slot.asset_id || slot.url || i}`,
      kindLabel: '道具',
      name: String(slot.name || '').trim(),
      url: slot.url,
      desc: descForSlot(session, shot, slot),
      onRemove: () => removeSlot(slot),
      pictureIndex: slot.index,
    });
  });
  orphanProps.forEach((p) => {
    galleryCards.push({
      key: `orphan-p-${p.prop_id}`,
      kindLabel: '道具',
      name: p.name,
      url: resolvePropMasterReferenceUrl(p) || String(p.imageUrl || '').trim(),
      desc: String(p.prompt || p.description || '').trim(),
      onRemove: () =>
        patch({
          prop_ids: (shot.prop_ids || []).filter((id) => id !== p.prop_id),
          required_prop_ids: (shot.required_prop_ids || []).filter((id) => id !== p.prop_id),
        }),
    });
  });
  creatureSlots.forEach((slot, i) => {
    galleryCards.push({
      key: `creature-${slot.asset_id || slot.url || i}`,
      kindLabel: '生物',
      name: String(slot.name || '').trim(),
      url: slot.url,
      desc: descForSlot(session, shot, slot),
      onRemove: () => removeSlot(slot),
      pictureIndex: slot.index,
    });
  });
  orphanCreatures.forEach((c) => {
    galleryCards.push({
      key: `orphan-c-${c.creature_id}`,
      kindLabel: '生物',
      name: c.name,
      url: String(c.imageUrl || '').trim(),
      desc: String(c.prompt || c.appearance || '').trim(),
      onRemove: () =>
        patch({
          creature_ids: (shot.creature_ids || []).filter((id) => id !== c.creature_id),
        }),
    });
  });

  const overflow = galleryCards.length + 1 > 5;

  /** 本镜独立切换角色造型：只改当前 shot 的 cast.costume_id，不影响其他镜头 */
  const switchShotCostume = (characterId: string, costumeId: string) => {
    const existing = (shot.cast || []).find((m) => m.character_id === characterId);
    let nextCast;
    if (existing) {
      nextCast = shot.cast.map((m) =>
        m.character_id === characterId ? { ...m, costume_id: costumeId } : m,
      );
    } else {
      // cast 里没有该角色：补一条最小记录，仅记 costume_id
      nextCast = [
        ...(shot.cast || []),
        {
          character_id: characterId,
          screen_position: '',
          action: '',
          expression: '',
          emotion: { primary: '', intensity: 0.6 },
          performance: '',
          dialogue_ids: [] as string[],
          voice_id: '',
          costume_id: costumeId,
        },
      ];
    }
    patch({ cast: nextCast });
  };

  const renderGalleryCard = (card: GalleryCard) => (
    <div key={card.key} className="min-w-0">
      <div
        className="mb-0.5 flex min-w-0 items-center gap-0.5"
        title={`${card.kindLabel}${
          card.pictureIndex && card.pictureIndex > 0 ? ` 图${card.pictureIndex}` : ''
        }${card.audioIndex && card.audioIndex > 0 ? ` 声音${card.audioIndex}` : ''} ${
          card.name || ''
        }`.trim()}
      >
        <div className="min-w-0 flex-1 truncate text-[11px] leading-tight">
          <span className="font-medium text-violet-300">{card.kindLabel}</span>
          {card.pictureIndex && card.pictureIndex > 0 ? (
            <span className={isDark ? 'text-sky-300' : 'text-sky-700'}> 图{card.pictureIndex}</span>
          ) : null}
          {card.audioIndex && card.audioIndex > 0 && !card.pictureIndex ? (
            <span className={isDark ? 'text-sky-300' : 'text-sky-700'}> 声音{card.audioIndex}</span>
          ) : null}
          {card.name ? (
            <span className={isDark ? 'text-white/85' : 'text-gray-800'}> {card.name}</span>
          ) : null}
        </div>
      </div>
      <LongPressThumb onRemove={card.onRemove} busy={busy} isDark={isDark}>
        <div className={thumbBox('aspect-[3/4] w-full')}>
          {card.url ? (
            <RefImageHoverThumb
              key={card.url}
              url={card.url}
              alt=""
              title={card.name || card.kindLabel}
              objectFit="contain"
              previewBorderless
              preferListThumb
              listThumbMaxEdge={128}
              cacheNonce={card.url}
              className="absolute inset-0 h-full w-full rounded-[inherit]"
            />
          ) : (
            <div
              className={`absolute inset-0 flex items-center justify-center text-[13px] ${mutedCls(isDark)}`}
            >
              —
            </div>
          )}
        </div>
      </LongPressThumb>
      {card.pictureIndex && card.pictureIndex > 0 ? (
        <SlotIndexTag label={`图${card.pictureIndex}`} isDark={isDark} />
      ) : null}
      {card.costumeOptions ? (
        <div className="mt-0.5 flex flex-row flex-nowrap gap-0.5 overflow-x-auto">
          {card.costumeOptions.costumes.map((cos, idx) => {
            const active = cos.costume_id === card.costumeOptions!.currentCostumeId;
            const color = COSTUME_TAG_COLORS[idx % COSTUME_TAG_COLORS.length];
            return (
              <button
                key={cos.costume_id}
                type="button"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation();
                  switchShotCostume(card.costumeOptions!.characterId, cos.costume_id);
                }}
                className="nodrag rounded px-1.5 py-0.5 text-[9px] font-medium leading-none transition-all"
                style={
                  active
                    ? { backgroundColor: color, color: '#fff', boxShadow: `0 0 0 1px ${color}` }
                    : {
                        backgroundColor: color + '1f',
                        color: isDark ? color : color,
                        boxShadow: `0 0 0 1px ${color}40`,
                      }
                }
                title={`切换为${cos.name}`}
              >
                {cos.name}
              </button>
            );
          })}
        </div>
      ) : null}
      {card.showShotAudio ? shotAudioBlock : null}
      {card.charAudioUrl !== undefined ? (
        <CharRefAudio
          url={card.charAudioUrl}
          isDark={isDark}
          mediaActive={mediaActive}
          audioIndex={card.audioIndex}
        />
      ) : null}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <section className="min-h-0 min-w-0 flex-1 overflow-auto custom-scrollbar-dark pr-0.5">
        <div className={`grid gap-1 ${overflow ? 'grid-cols-10' : 'grid-cols-5'}`}>
          {galleryCards.map(renderGalleryCard)}
          <DramaShotAddAssetCard
            options={addImageOptions}
            onAdd={addImageRef}
            disabled={busy}
            isDark={isDark}
            thumbBox={thumbBox}
            allowAddKind={canAddKind}
            quotaLabel={quotaLabel}
            onQuotaBlocked={() => showAlert(quotaBlockedMsg)}
          />
        </div>
        {!shotAudioOnGallery && showShotAudioUi ? (
          <div className="mt-1 max-w-[9.5rem]">{shotAudioBlock}</div>
        ) : null}
      </section>
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
        <div
          className={`min-w-0 text-[14px] font-medium ${
            materialsOk
              ? isDark
                ? 'text-emerald-300'
                : 'text-emerald-700'
              : isDark
                ? 'text-amber-300/90'
                : 'text-amber-700'
          }`}
        >
          {materialsOk
            ? '√ 素材完整'
            : requiresCast && !(shot.character_ids || []).length
              ? '缺出场人物'
              : `缺${!sceneOk ? '场景图' : ''}${!sceneOk && !charsOk ? '、' : ''}${
                  !charsOk ? '人物图' : ''
                }${(!sceneOk || !charsOk) && !voiceOk ? '、' : ''}${!voiceOk ? '声音' : ''}`}
        </div>
      </div>
    </div>
  );
}
