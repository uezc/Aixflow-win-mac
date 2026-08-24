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

function assetMediaUrl(a: DirectorAsset | undefined): string {
  return String(a?.imageUrl || '').trim();
}

function assetsLikelySameName(a: string, b: string): boolean {
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
  const characters = mergeProjectedAssetsKeepImages(
    session.bible.characters.map((c, i) => {
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
    }),
    prev?.characters,
  );

  const scenes = mergeProjectedAssetsKeepImages(
    session.bible.scenes.map((s, i) => {
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
      .map((id) => session.bible.characters.find((c) => c.character_id === id)?.name || '')
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
        if (!no || !url) continue;
        // 生成中勿把 Domain 旧成片强行盖成 ready，避免与画布 generating 对打 → 死循环
        if (vst === 'generating' || vst === 'queued') continue;
        const key = directorDramaStoryboardKey(epId, no);
        const prev = next[key] || createEmptyDirectorShotStoryboard();
        const prevVideoSt = String(prev.videoStatus || '').trim();
        if (
          (prevVideoSt === 'generating' || prevVideoSt === 'queued') &&
          vst !== 'ready' &&
          vst !== 'success'
        ) {
          continue;
        }
        next[key] = {
          ...prev,
          videoUrl: url,
          videoStatus: 'ready',
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
        scenes: session.bible.scenes.map((s) => `${s.name}：${s.prompt}`).join('\n'),
        props: session.bible.props.map((p) => `${p.name}：${p.prompt || p.description}`).join('\n'),
      },
    },
  });
}
