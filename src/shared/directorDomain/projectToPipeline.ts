/**
 * Domain V2 Session → 画布节点 DirectorPipelineState 投影（兼容出片 / 资产生图）
 */

import {
  createDefaultDirectorPipelineState,
  createEmptyDirectorAsset,
  createEmptyDirectorShot,
  createEmptyDirectorShotStoryboard,
  directorDramaStoryboardKey,
  migrateBareDirectorStoryboardsToEpisode,
  type DirectorAsset,
  type DirectorPipelineState,
  type DirectorShot,
} from '../directorPipeline/schema.js';
import { formatDramaDialogueLines } from './factories.js';
import type { DramaDirectorSession } from './types.js';
import { dramaStudioNodeTitle } from './episodes.js';
import { coreDramaPersonName, namesLikelySameDramaPerson } from './extractCastFromScript.js';
import { normDramaAssetName } from './mergeAnalyzeBible.js';
import {
  composeDramaSystemVisualPrompt,
  DRAMA_SYSTEM_SPEAKER_ID,
  DRAMA_SYSTEM_VISUAL_ASSET_NAME,
  resolveDramaSystemVoice,
} from './voiceEntity.js';

function assetMediaUrl(a: DirectorAsset | undefined): string {
  return String(a?.imageUrl || '').trim();
}

function assetsLikelySameName(a: string, b: string): boolean {
  // 「江澈·造型2」是造型卡，不能按人名糊成人物主卡
  const lookA = String(a || '').includes('·');
  const lookB = String(b || '').includes('·');
  if (lookA !== lookB) return false;
  const na = normDramaAssetName(a);
  const nb = normDramaAssetName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (namesLikelySameDramaPerson(a, b)) return true;
  const ca = normDramaAssetName(coreDramaPersonName(a));
  const cb = normDramaAssetName(coreDramaPersonName(b));
  if (ca && cb && ca.length >= 3 && cb.length >= 3 && (ca.endsWith(cb) || cb.endsWith(ca))) {
    return true;
  }
  return false;
}

/**
 * 投影时禁止用空 imageUrl 冲掉画布里已有定妆。
 * 换集/重分析会改 character_id 或名字，旧卡仍保留，供按名回填。
 */
function mergeProjectedAssetsKeepImages(
  projected: DirectorAsset[],
  prev: DirectorAsset[] | undefined,
): DirectorAsset[] {
  const prevList = prev || [];
  const used = new Set<string>();
  const takePrev = (hit: DirectorAsset | undefined) => {
    if (!hit || !assetMediaUrl(hit)) return null;
    used.add(hit.id);
    return hit;
  };
  const out = projected.map((a) => {
    if (assetMediaUrl(a)) {
      const same = prevList.find((p) => p.id === a.id);
      if (same) used.add(same.id);
      return a;
    }
    const byId = takePrev(prevList.find((p) => p.id === a.id && assetMediaUrl(p)));
    if (byId) {
      return { ...a, imageUrl: byId.imageUrl, status: 'ready' as const };
    }
    const byName = takePrev(
      prevList.find((p) => !used.has(p.id) && assetMediaUrl(p) && assetsLikelySameName(p.name, a.name)),
    );
    if (byName) {
      return { ...a, imageUrl: byName.imageUrl, status: 'ready' as const };
    }
    return a;
  });
  for (const p of prevList) {
    if (used.has(p.id) || !assetMediaUrl(p)) continue;
    if (out.some((a) => a.id === p.id)) continue;
    out.push(p);
  }
  return out;
}

export function mergeDramaPipelineAssetsFromSession(
  session: DramaDirectorSession,
  prev?: DirectorPipelineState['assets'] | null,
): DirectorPipelineState['assets'] {
  const characterAssets = (session.bible?.characters || []).map((c, i) => {
    const a = createEmptyDirectorAsset(
      'character',
      c.name,
      c.prompt,
      i,
      c.gender === 'male' || c.gender === 'female' ? c.gender : '',
    );
    return {
      ...a,
      id: c.character_id || a.id,
      imageUrl: c.imageUrl,
      status: c.status,
    };
  });
  let costumeIndex = characterAssets.length;
  for (const c of session.bible?.characters || []) {
    for (const cos of c.costumes || []) {
      const cid = String(cos.costume_id || '').trim();
      if (!cid) continue;
      const url = String(cos.images?.[0] || '').trim();
      const a = createEmptyDirectorAsset(
        'character',
        `${c.name}·${cos.name || '造型'}`,
        String(cos.prompt || c.prompt || '').trim(),
        costumeIndex,
      );
      costumeIndex += 1;
      characterAssets.push({
        ...a,
        id: cid,
        imageUrl: url,
        status: url ? ('ready' as const) : ('pending' as const),
      });
    }
  }
  // 系统提示音形象：pipeline 生图槽，不进 bible.characters / Subject
  const systemVoice = resolveDramaSystemVoice(session);
  if (systemVoice) {
    const img = String(systemVoice.imageUrl || '').trim();
    const prompt = composeDramaSystemVisualPrompt(systemVoice.image_prompt);
    const a = createEmptyDirectorAsset(
      'character',
      DRAMA_SYSTEM_VISUAL_ASSET_NAME,
      prompt,
      costumeIndex,
    );
    characterAssets.push({
      ...a,
      id: DRAMA_SYSTEM_SPEAKER_ID,
      imageUrl: img,
      status:
        systemVoice.image_status === 'generating' ||
        systemVoice.image_status === 'error' ||
        systemVoice.image_status === 'ready' ||
        systemVoice.image_status === 'pending'
          ? systemVoice.image_status
          : img
            ? ('ready' as const)
            : ('pending' as const),
    });
  }
  const characters = mergeProjectedAssetsKeepImages(characterAssets, prev?.characters);

  const scenes = mergeProjectedAssetsKeepImages(
    (session.bible?.scenes || []).map((s, i) => {
      const a = createEmptyDirectorAsset('scene', s.name, s.prompt, i);
      return { ...a, id: s.scene_id || a.id, imageUrl: s.imageUrl, status: s.status };
    }),
    prev?.scenes,
  );

  const props = mergeProjectedAssetsKeepImages(
    session.bible.props.map((p, i) => {
      const a = createEmptyDirectorAsset('prop', p.name, p.prompt || p.description, i);
      return { ...a, id: p.prop_id || a.id, imageUrl: p.imageUrl, status: p.status };
    }),
    prev?.props,
  );

  const creatures = mergeProjectedAssetsKeepImages(
    session.bible.creatures.map((c, i) => {
      const a = createEmptyDirectorAsset('creature', c.name, c.prompt || c.appearance, i);
      return { ...a, id: c.creature_id || a.id, imageUrl: c.imageUrl, status: c.status };
    }),
    prev?.creatures,
  );

  return { characters, scenes, props, creatures };
}

export function projectDramaSessionToPipeline(
  session: DramaDirectorSession,
  base?: DirectorPipelineState | null,
): DirectorPipelineState {
  const shots: DirectorShot[] = (session.shots || []).map((s, i) => {
    const beat = session.scene_beats.find((b) => b.scene_beat_id === s.scene_beat_id);
    const castNames = (s.character_ids || [])
      .map((id) => (session.bible?.characters || []).find((c) => c.character_id === id)?.name || '')
      .filter(Boolean)
      .join('、');
    return {
      ...createEmptyDirectorShot(i),
      场号: beat?.scene_no || '',
      内外景: beat?.int_ext || '',
      日夜: beat?.day_night || '',
      地点: beat?.location_name || '',
      出场人物: castNames,
      镜号: s.shot_no || String(i + 1),
      时长: `${s.duration_sec || 5}s`,
      画面描述: s.action,
      镜头角度: s.angle,
      焦距: s.focal,
      景别: s.size,
      光影氛围: s.atmosphere || s.lighting,
      对白旁白: formatDramaDialogueLines(s.dialogue),
      音效: s.sfx,
      运镜: s.move,
      制作备注: s.costume_notes,
      连贯性: s.continuity_notes,
      参考图绑定: [
        beat?.location_name ? `场景：${beat.location_name}` : '',
        castNames ? `角色：${castNames}` : '',
      ]
        .filter(Boolean)
        .join('；'),
      最终提示词: s.final_prompt,
    };
  });

  const { characters, scenes, props, creatures } = mergeDramaPipelineAssetsFromSession(
    session,
    base?.assets,
  );

  const phase =
    session.meta.phase === 'ingest'
      ? 'ingest'
      : session.meta.phase === 'episodes'
        ? 'episodes'
        : session.meta.phase === 'visual'
          ? 'visual'
          : session.meta.phase === 'analyze'
            ? 'analyze'
            : session.meta.phase === 'bible' || session.meta.phase === 'assets'
              ? 'assets'
              : session.meta.phase === 'board'
                ? 'board'
                : session.meta.phase === 'review'
                  ? 'review'
                  : 'videos';

  return createDefaultDirectorPipelineState({
    ...(base || {}),
    mode: 'drama',
    phase: phase as DirectorPipelineState['phase'],
    title: dramaStudioNodeTitle(session),
    scriptText: session.bible.plot || base?.scriptText || '',
    mvScriptReference: session.meta.source_script || base?.mvScriptReference || '',
    globalStyle:
      session.bible.projectVisualBible?.stylePrompt ||
      session.bible.visualDNA?.generatedPrompt ||
      session.meta.globalStyle ||
      session.bible.project.visual_style ||
      base?.globalStyle,
    styleReferenceImageUrl:
      session.bible.projectVisualBible?.visualDNA?.referenceImages?.find((r) => r.url)?.url ||
      session.bible.visualDNA?.referenceImages?.find((r) => r.url)?.url ||
      session.meta.styleReferenceImageUrl ||
      base?.styleReferenceImageUrl,
    stylePresetId: session.meta.stylePresetId || base?.stylePresetId,
    chatModel: session.meta.chatModel || base?.chatModel,
    imageModel: session.meta.imageModel || base?.imageModel,
    videoBatchModel: (() => {
      const raw = String(session.meta.videoBatchModel || base?.videoBatchModel || 'minimax-h3-multi').trim();
      // Domain 可把「默认=对口型」记在 videoBatchModel；Pipeline 普通档需非口型 id
      if (raw === 'minimax-h3-audio' || raw.includes('lipsync')) return 'minimax-h3-multi';
      return raw || 'minimax-h3-multi';
    })(),
    videoBatchLipsyncModel:
      session.meta.videoBatchLipsyncModel || base?.videoBatchLipsyncModel || 'minimax-h3-audio',
    videoBatchResolution: (() => {
      const raw =
        session.meta.videoBatchResolution ||
        base?.videoBatchResolution ||
        '720p';
      const s = String(raw).trim().toLowerCase();
      if (s === '480p' || s === '480' || s === '0.4') return '480p';
      return '720p';
    })(),
    videoBatchLipsyncResolution: (() => {
      const raw =
        session.meta.videoBatchLipsyncResolution ||
        session.meta.videoBatchResolution ||
        base?.videoBatchLipsyncResolution ||
        base?.videoBatchResolution ||
        '720p';
      const s = String(raw).trim().toLowerCase();
      if (s === '480p' || s === '480' || s === '0.4') return '480p';
      return '720p';
    })(),
    videoBatchAspectRatio:
      session.meta.aspect_ratio || base?.videoBatchAspectRatio || base?.mvAspectRatio || '9:16',
    mvAspectRatio: (session.meta.aspect_ratio === '16:9' ||
    session.meta.aspect_ratio === '9:16' ||
    session.meta.aspect_ratio === '3:4' ||
    session.meta.aspect_ratio === '4:3'
      ? session.meta.aspect_ratio
      : base?.mvAspectRatio || '9:16') as DirectorPipelineState['mvAspectRatio'],
    shots,
    activeDramaEpisodeId: session.active_episode_id || '',
    storyboardsByShotNo: (() => {
      const firstId = String(session.episodes?.[0]?.episode_id || '').trim();
      const epId = String(session.active_episode_id || firstId || '').trim();
      const next = migrateBareDirectorStoryboardsToEpisode(
        base?.storyboardsByShotNo,
        epId,
      );
      for (const s of session.shots || []) {
        const no = String(s.shot_no || '').trim();
        const url = String(s.video_url || '').trim();
        const vst = String(s.video_status || '').trim();
        if (!no) continue;
        const key = directorDramaStoryboardKey(epId, no);
        const prev = next[key] || createEmptyDirectorShotStoryboard();
        const prevVideoSt = String(prev.videoStatus || '').trim();
        const sbImg = String(s.storyboard_image_url || '').trim();
        // 本镜正在出片：把画布表改成 generating，保留旧 URL，避免对账把旧 ready 当成完成
        if (vst === 'generating' || vst === 'queued') {
          next[key] = {
            ...prev,
            ...(sbImg ? { imageUrl: sbImg, status: 'ready' as const } : {}),
            videoStatus: 'generating',
            videoGeneratingStartedAt:
              Number(prev.videoGeneratingStartedAt) > 0
                ? Number(prev.videoGeneratingStartedAt)
                : Date.now(),
          };
          continue;
        }
        if (!url && !sbImg) continue;
        if (
          (prevVideoSt === 'generating' || prevVideoSt === 'queued') &&
          vst !== 'ready' &&
          vst !== 'success'
        ) {
          if (sbImg) {
            next[key] = {
              ...prev,
              imageUrl: sbImg,
              status: 'ready',
            };
          }
          continue;
        }
        next[key] = {
          ...prev,
          ...(sbImg ? { imageUrl: sbImg, status: 'ready' as const } : {}),
          ...(url
            ? {
                videoUrl: url,
                videoStatus: 'ready' as const,
              }
            : {}),
        };
      }
      return next;
    })(),
    assets: { characters, scenes, props, creatures },
    mvStoryAnalysis: {
      ...(base?.mvStoryAnalysis || {}),
      summary: session.bible.plot.slice(0, 120) || base?.mvStoryAnalysis?.summary || '短剧 V2',
      genre: session.bible.project.type || '短剧',
      scriptKeywords: session.bible.script_keywords,
      emotions: base?.mvStoryAnalysis?.emotions || [],
      keywords: base?.mvStoryAnalysis?.keywords || [],
      sections: {
        plot: session.bible.plot,
        worldView: session.bible.project.worldview,
        relationships: session.bible.relationships,
        characters: session.bible.characters
          .map((c) => `${c.name}：${c.prompt}`)
          .join('\n'),
        scenes: (session.bible?.scenes || []).map((s) => `${s.name}：${s.prompt}`).join('\n'),
        props: session.bible.props.map((p) => `${p.name}：${p.prompt || p.description}`).join('\n'),
      },
    },
  });
}
