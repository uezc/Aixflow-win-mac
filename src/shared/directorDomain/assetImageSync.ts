/**
 * 短剧 Domain 资产生图结果回写（人物 / 场景 / 道具 / 生物）。
 * Workspace 任务 SUCCESS 与 DirectorNode 监听共用，避免只写 pipeline 不写 bible。
 */

import { dramaCreaturePromptLooksHuman, namesLikelySameDramaPerson, coreDramaPersonName } from './extractCastFromScript.js';
import type { DramaAssetReferenceImage, DramaAssetStatus, DramaDirectorSession, DramaShot } from './types.js';
import { createEmptyDramaAssetReferenceImage, createEmptyDramaSession } from './factories.js';
import { normDramaAssetName } from './mergeAnalyzeBible.js';
import {
  resolveCharacterMasterReferenceUrl,
  resolvePropMasterReferenceUrl,
  resolveSceneMasterReferenceUrl,
} from './constraints.js';
import type { DirectorAsset, DirectorAssetsBag } from '../directorPipeline/schema.js';
import { flattenDirectorAssets } from '../directorPipeline/schema.js';
import {
  DRAMA_SYSTEM_SPEAKER_ID,
  isDramaSystemOnlyVoiceId,
  isDramaSystemVisualAssetId,
  resolveDramaSystemVoice,
} from './voiceEntity.js';

function upsertMasterReferenceImage(
  refs: DramaAssetReferenceImage[] | undefined,
  url: string,
): DramaAssetReferenceImage[] {
  const nextUrl = String(url || '').trim();
  const list = Array.isArray(refs)
    ? refs.map((r) => createEmptyDramaAssetReferenceImage(r))
    : [];
  const idx = list.findIndex((r) => r.kind === 'master' || r.kind === 'main');
  if (!nextUrl) {
    if (idx < 0) return list;
    list.splice(idx, 1);
    return list;
  }
  if (idx >= 0) {
    list[idx] = createEmptyDramaAssetReferenceImage({
      ...list[idx],
      kind: 'master',
      url: nextUrl,
      label: list[idx].label || 'master',
    });
    return list;
  }
  return [
    createEmptyDramaAssetReferenceImage({ kind: 'master', url: nextUrl, label: 'master' }),
    ...list,
  ];
}

export function applyDramaSessionAssetImage(
  session: DramaDirectorSession | null | undefined,
  assetId: string,
  opts: {
    imageUrl?: string;
    status?: DramaAssetStatus;
    error?: string;
  },
): DramaDirectorSession | null {
  if (!session?.bible) return null;
  const id = String(assetId || '').trim();
  if (!id) return null;
  const hasUrl = opts.imageUrl !== undefined;
  const imageUrl = hasUrl ? String(opts.imageUrl || '').trim() : undefined;

  // 系统提示音形象挂在 Voice 上，不进 bible.characters
  if (isDramaSystemVisualAssetId(id, session)) {
    const systemVoice = resolveDramaSystemVoice(session);
    if (!systemVoice) return null;
    let hit = false;
    const voices = (session.bible.voices || []).map((v) => {
      if (v.voice_id !== systemVoice.voice_id) return v;
      hit = true;
      return {
        ...v,
        ...(hasUrl ? { imageUrl: imageUrl || '' } : {}),
        ...(opts.status
          ? { image_status: opts.status }
          : hasUrl
            ? { image_status: imageUrl ? ('ready' as const) : ('pending' as const) }
            : {}),
        ...(opts.error !== undefined
          ? { error: opts.error }
          : opts.status && opts.status !== 'error'
            ? { error: undefined }
            : {}),
        asset_version: (Number(v.asset_version) || 1) + (hasUrl || opts.status ? 1 : 0),
      };
    });
    if (!hit) return null;
    return createEmptyDramaSession({
      ...session,
      bible: { ...session.bible, voices },
    });
  }

  const patchList = <T extends { imageUrl?: string; status?: string; error?: string; reference_images?: any[] }>(
    list: T[],
    match: (x: T) => boolean,
  ): T[] | null => {
    let hit = false;
    const next = list.map((x) => {
      if (!match(x)) return x;
      hit = true;
      return {
        ...x,
        ...(hasUrl ? { imageUrl } : {}),
        ...(hasUrl
          ? { reference_images: upsertMasterReferenceImage(x.reference_images, imageUrl || '') }
          : {}),
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.error !== undefined
          ? { error: opts.error }
          : opts.status && opts.status !== 'error'
            ? { error: undefined }
            : {}),
      };
    });
    return hit ? next : null;
  };

  const characters = patchList(session.bible.characters, (c) => c.character_id === id);
  if (characters) {
    const synced = characters.map((c) => {
      if (c.character_id !== id) return c;
      if (!hasUrl) return c;
      const list = c.costumes || [];
      if (!list.length) return c;
      const hasActive = list.some((cos) => cos.active);
      const nextCostumes = list.map((cos, i) => {
        const writeHere = cos.active || (!hasActive && i === 0);
        if (!writeHere) return cos;
        return {
          ...cos,
          active: true,
          images: imageUrl
            ? [imageUrl, ...(cos.images || []).filter((u) => u !== imageUrl)]
            : [],
        };
      });
      const views = c.views || { front: [], full: [], expression: [], detail: [] };
      return {
        ...c,
        costumes: nextCostumes,
        views: imageUrl
          ? {
              ...views,
              full: [imageUrl, ...(views.full || []).filter((u) => u !== imageUrl)].slice(0, 4),
              front: [imageUrl, ...(views.front || []).filter((u) => u !== imageUrl)].slice(0, 4),
            }
          : views,
        assets: {
          ...(c.assets || {}),
          fullBodyImage: imageUrl || c.assets?.fullBodyImage || '',
          frontImage: imageUrl || c.assets?.frontImage || '',
        },
        asset_version: (Number(c.asset_version) || 1) + 1,
      };
    });
    return createEmptyDramaSession({
      ...session,
      bible: { ...session.bible, characters: synced },
    });
  }
  const scenes = patchList(session.bible.scenes, (s) => s.scene_id === id);
  const props =
    characters || scenes ? null : patchList(session.bible.props, (p) => p.prop_id === id);
  const creatures =
    characters || scenes || props
      ? null
      : patchList(session.bible.creatures, (c) => c.creature_id === id);

  if (!characters && !scenes && !props && !creatures) {
    let costumeHit = false;
    const nextCharacters = (session.bible?.characters || []).map((c) => {
      let hit = false;
      const costumes = (c.costumes || []).map((cos) => {
        if (cos.costume_id !== id) return cos;
        hit = true;
        costumeHit = true;
        const nextImages = hasUrl
          ? imageUrl
            ? [imageUrl, ...(cos.images || []).filter((u) => u !== imageUrl)]
            : []
          : cos.images;
        return { ...cos, images: nextImages };
      });
      if (!hit) return c;
      const views = c.views || { front: [], full: [], expression: [], detail: [] };
      const writeMaster = hasUrl
        ? {
            imageUrl: imageUrl || '',
            reference_images: upsertMasterReferenceImage(c.reference_images, imageUrl || ''),
            ...(opts.status ? { status: opts.status } : imageUrl ? { status: 'ready' as const } : {}),
            ...(opts.error !== undefined
              ? { error: opts.error }
              : opts.status && opts.status !== 'error'
                ? { error: undefined }
                : {}),
            // 上传/生成到某一装扮时一并设为当前装，保证分镜「添加」与主卡立刻用上新图
            costumes: costumes.map((x) => ({
              ...x,
              active: x.costume_id === id,
            })),
            views: imageUrl
              ? {
                  ...views,
                  full: [imageUrl, ...(views.full || []).filter((u) => u !== imageUrl)].slice(0, 4),
                  front: [imageUrl, ...(views.front || []).filter((u) => u !== imageUrl)].slice(0, 4),
                }
              : views,
            assets: {
              ...(c.assets || {}),
              fullBodyImage: imageUrl || c.assets?.fullBodyImage || '',
              frontImage: imageUrl || c.assets?.frontImage || '',
            },
            asset_version: (Number(c.asset_version) || 1) + 1,
          }
        : {
            // 造型生图进行中不要把人物主卡标成 generating：
            // 对账会用 pipeline 里人物旧定妆盖掉刚写上的造型图。
            ...(opts.status === 'error' ? { status: opts.status } : {}),
            ...(opts.error !== undefined
              ? { error: opts.error }
              : opts.status && opts.status !== 'error'
                ? { error: undefined }
                : {}),
            costumes,
          };
      return { ...c, ...writeMaster };
    });
    if (!costumeHit) return null;
    return createEmptyDramaSession({
      ...session,
      bible: { ...session.bible, characters: nextCharacters },
    });
  }

  return createEmptyDramaSession({
    ...session,
    bible: {
      ...session.bible,
      ...(characters ? { characters } : {}),
      ...(scenes ? { scenes } : {}),
      ...(props ? { props } : {}),
      ...(creatures ? { creatures } : {}),
    },
  });
}

export function applyDramaSessionVoiceSample(
  session: DramaDirectorSession | null | undefined,
  voiceId: string,
  opts: {
    sampleUrl?: string;
    model?: string;
    status?: DramaAssetStatus;
    error?: string;
  },
): DramaDirectorSession | null {
  if (!session?.bible) return null;
  const id = String(voiceId || '').trim();
  if (!id) return null;
  let hit = false;
  let oldSampleUrl = '';
  const voices = session.bible.voices.map((v) => {
    if (v.voice_id !== id) return v;
    hit = true;
    oldSampleUrl = String(v.sample_url || '').trim();
    const nextSample = opts.sampleUrl !== undefined ? String(opts.sampleUrl || '').trim() : undefined;
    return {
      ...v,
      ...(nextSample !== undefined ? { sample_url: nextSample } : {}),
      // 同步 identity.reference_audio：UI 与 package 都按 "identity.reference_audio || sample_url" 取值，
      // 不同步会导致更换参考音后分镜人物卡仍展示旧 URL。
      ...(nextSample !== undefined && v.identity
        ? {
            identity: {
              ...v.identity,
              reference_audio: nextSample,
            },
          }
        : {}),
      ...(opts.model !== undefined ? { model: String(opts.model || '').trim() } : {}),
      ...(opts.status !== undefined ? { status: opts.status } : {}),
      ...(opts.error !== undefined
        ? { error: opts.error }
        : opts.status && opts.status !== 'error'
          ? { error: undefined }
          : {}),
    };
  });
  if (!hit) return null;

  // 更换参考音时同步：把所有引用了该 voice 的已生成镜头配音失效掉，
  // 强制用户在分镜卡片上看到"本镜配音生成"按钮重新点亮，重新生成时即用新 sample_url。
  const newSampleUrl = String(opts.sampleUrl || '').trim();
  const sampleReplaced = opts.sampleUrl !== undefined && newSampleUrl !== oldSampleUrl;
  let shots = session.shots;
  if (sampleReplaced) {
    // 该 voice 的 character_id（部分 voice 直接绑定角色）
    const voiceCharId = String(voices.find((v) => v.voice_id === id)?.character_id || '').trim();
    // 通过 character.voice_id 显式绑定该 voice 的角色集合
    const charIdsByVoice = new Set<string>();
    for (const ch of session.bible.characters) {
      if (String(ch.voice_id || '').trim() === id) charIdsByVoice.add(ch.character_id);
    }
    const shotTouchesVoice = (s: DramaShot): boolean => {
      // 显式：shot.voice_ids 包含该 voice
      if ((s.voice_ids || []).some((vid) => String(vid || '').trim() === id)) return true;
      // 启发式：本镜对白/出场人物解析出的角色命中该 voice
      const cids = new Set<string>();
      for (const d of s.dialogue || []) {
        const cid = String(d.character_id || '').trim();
        if (cid) cids.add(cid);
      }
      for (const cid of s.character_ids || []) {
        const v = String(cid || '').trim();
        if (v) cids.add(v);
      }
      for (const cid of cids) {
        if (charIdsByVoice.has(cid)) return true;
        if (voiceCharId && cid === voiceCharId) return true;
      }
      return false;
    };
    shots = session.shots.map((s) => {
      if (!shotTouchesVoice(s)) return s;
      // 只清"已生成/有 url"的镜头；空或 generating 的保持原状避免误伤
      if (String(s.audio_status || '') !== 'ready' && !s.audio_url) return s;
      return { ...s, audio_url: '', audio_status: 'pending', audio_error: '' };
    });
  }

  return createEmptyDramaSession({
    ...session,
    bible: { ...session.bible, voices },
    shots,
  });
}

/**
 * 清掉孤儿 generating：无图 → pending；有图 / 传入 urlByAssetId → ready。
 * 用于重启后任务已完成但 Domain 仍转圈。
 * @param preserveGeneratingIds 仍在真正生图中的资产 id，勿清 generating（避免进度条被抹掉）
 */
export function healDramaSessionStuckAssetGenerating(
  session: DramaDirectorSession | null | undefined,
  urlByAssetId?: Record<string, string>,
  preserveGeneratingIds?: ReadonlySet<string> | string[],
): DramaDirectorSession | null {
  if (!session?.bible) return null;
  const urls = urlByAssetId || {};
  const preserve = new Set(
    Array.isArray(preserveGeneratingIds)
      ? preserveGeneratingIds
      : preserveGeneratingIds
        ? [...preserveGeneratingIds]
        : [],
  );
  let changed = false;

  const healVisual = <T extends { imageUrl?: string; status?: string; error?: string }>(
    list: T[],
    getId: (x: T) => string,
  ): T[] =>
    list.map((x) => {
      const id = String(getId(x) || '').trim();
      const fromMap = id ? String(urls[id] || '').trim() : '';
      const own = String(x.imageUrl || '').trim();
      if (x.status === 'generating') {
        // 仍在飞的任务：禁止用 pipeline 旧图提前收口
        if (preserve.has(id)) return x;
        // 重新生成：优先任务/pipeline 新图，不能 own||fromMap 把旧定妆钉死
        const url = fromMap || own;
        changed = true;
        return {
          ...x,
          ...(url ? { imageUrl: url } : {}),
          status: url ? 'ready' : 'pending',
          error: undefined,
        };
      }
      // 只填空：禁止用历史 SUCCESS 任务 URL 覆盖用户本地替换 / 已 ready 的图
      if (!own && fromMap) {
        changed = true;
        return { ...x, imageUrl: fromMap, status: 'ready', error: undefined };
      }
      return x;
    });

  const prevCharUrl = new Map(
    (session.bible.characters || []).map((c) => [c.character_id, String(c.imageUrl || '').trim()]),
  );
  const characters = healVisual(session.bible.characters, (c) => c.character_id).map((c) => {
    let next = c;
    const url = String(c.imageUrl || '').trim();
    const prev = prevCharUrl.get(c.character_id) || '';
    const masterUpdated = !!(url && url !== prev);
    const skipActiveCostumeIds = new Set<string>();
    if (masterUpdated && (c.costumes || []).length) {
      const hasActive = (c.costumes || []).some((cos) => cos.active);
      const costumes = (c.costumes || []).map((cos, i) => {
        const writeHere = cos.active || (!hasActive && i === 0);
        if (!writeHere) return cos;
        skipActiveCostumeIds.add(String(cos.costume_id || '').trim());
        if (String(cos.images?.[0] || '').trim() === url) return cos;
        return {
          ...cos,
          images: [url, ...(cos.images || []).filter((u) => u !== url)],
        };
      });
      next = { ...c, costumes };
    }
    // 主卡刚被人物 id 任务更新时，禁止再用造型 id 的历史旧图盖掉当前装
    const synced = applyCostumeImagesFromUrlMap([next], urls, {
      overwrite: true,
      skipCostumeIds: skipActiveCostumeIds,
    })[0];
    if (synced && synced !== next) changed = true;
    return synced || next;
  });
  const scenes = healVisual(session.bible.scenes, (s) => s.scene_id);
  const props = healVisual(session.bible.props, (p) => p.prop_id);
  const creatures = healVisual(session.bible.creatures, (c) => c.creature_id);

  // 声音 generating 不在此自动清：声音不走 image 队列，tasks 对账若在 START 前把
  // generating 抹掉会导致绿色进度条闪一下消失。完成态由 SUCCESS/ERROR 回写。
  // 系统形象图走 image 队列，用 image_status；任务列表已有成图时必须收回 Voice.imageUrl。
  const voices = (session.bible.voices || []).map((v) => {
    const vid = String(v.voice_id || '').trim();
    const fromMap = String(
      urls[DRAMA_SYSTEM_SPEAKER_ID] || (vid ? urls[vid] : '') || '',
    ).trim();
    const own = String(v.imageUrl || '').trim();
    const isSys =
      isDramaSystemOnlyVoiceId(v.character_id) || isDramaSystemOnlyVoiceId(vid);

    if (v.image_status === 'generating') {
      if (preserve.has(DRAMA_SYSTEM_SPEAKER_ID) || (vid && preserve.has(vid))) return v;
      // 重新生成：优先用任务/pipeline 新图，不能 own||fromMap 把旧定妆钉死
      const url = fromMap || own;
      changed = true;
      return {
        ...v,
        ...(url ? { imageUrl: url } : {}),
        image_status: url ? ('ready' as const) : ('pending' as const),
        error: undefined,
      };
    }

    // 系统卡：Domain 空图但任务列表已成功 → 补上（否则「任务有图、卡片空白/旧图」）
    if (isSys && fromMap && !own) {
      changed = true;
      return {
        ...v,
        imageUrl: fromMap,
        image_status: 'ready' as const,
        error: undefined,
      };
    }
    return v;
  });

  if (!changed) return null;
  return createEmptyDramaSession({
    ...session,
    bible: {
      ...session.bible,
      characters,
      scenes,
      props,
      creatures,
      voices,
    },
  });
}

function pickPipelineMediaByName(list: DirectorAsset[] | undefined, name: string): string {
  const key = normDramaAssetName(name);
  if (!key) return '';
  const items = list || [];
  const withUrl = (a: DirectorAsset) => String(a.imageUrl || '').trim();
  const exact = items.find((a) => normDramaAssetName(a.name) === key && withUrl(a));
  if (exact) return withUrl(exact);
  const core = normDramaAssetName(coreDramaPersonName(name));
  if (core) {
    const hit = items.find((a) => normDramaAssetName(a.name) === core && withUrl(a));
    if (hit) return withUrl(hit);
  }
  const fuzzy = items.find((a) => withUrl(a) && namesLikelySameDramaPerson(name, a.name));
  if (fuzzy) return withUrl(fuzzy);
  const suffix = items.find((a) => {
    const n = normDramaAssetName(coreDramaPersonName(a.name) || a.name);
    if (!n || n.length < 3 || !withUrl(a)) return false;
    return key.endsWith(n) || n.endsWith(key);
  });
  return suffix ? withUrl(suffix) : '';
}

function applyCostumeImagesFromUrlMap<
  T extends {
    character_id?: string;
    imageUrl?: string;
    costumes?: { costume_id: string; images?: string[]; active?: boolean }[];
    asset_version?: number;
  },
>(
  characters: T[],
  urls: Record<string, string>,
  opts?: { overwrite?: boolean; skipCostumeIds?: ReadonlySet<string> },
): T[] {
  const overwrite = opts?.overwrite === true;
  const skipIds = opts?.skipCostumeIds;
  return characters.map((c) => {
    let hit = false;
    const list = c.costumes || [];
    const hasActive = list.some((cos) => cos.active);
    const charId = String(c.character_id || '').trim();
    const charTaskUrl = charId ? String(urls[charId] || '').trim() : '';
    const masterUrl = String(c.imageUrl || '').trim();
    // 主卡已是人物 id 任务成图：当前装跟主卡，忽略造型 id 历史任务
    const lockActiveToMaster = !!(
      masterUrl &&
      charTaskUrl &&
      masterUrl === charTaskUrl
    );
    const costumes = list.map((cos, i) => {
      const costumeId = String(cos.costume_id || '').trim();
      const isActive = !!(cos.active || (!hasActive && i === 0));
      const own = String(cos.images?.[0] || '').trim();

      if (skipIds?.has(costumeId)) return cos;

      if (lockActiveToMaster && isActive) {
        if (own === masterUrl) return cos;
        hit = true;
        return {
          ...cos,
          images: [masterUrl, ...(cos.images || []).filter((u) => u !== masterUrl)],
        };
      }

      const fromMap = costumeId ? String(urls[costumeId] || '').trim() : '';
      if (!fromMap) return cos;
      if (own === fromMap) return cos;
      if (own && !overwrite) return cos;
      hit = true;
      return {
        ...cos,
        images: [fromMap, ...(cos.images || []).filter((u) => u !== fromMap)],
      };
    });
    if (!hit) return c;
    return {
      ...c,
      costumes,
      asset_version: (Number(c.asset_version) || 1) + 1,
    };
  });
}

/** 画布/本剧已有定妆：先按 id，再按同名（含简称）。供素材格立刻显示本地图。 */
export function pickPipelineAssetImage(
  list: DirectorAsset[] | undefined,
  id: string,
  name: string,
): string {
  const nid = String(id || '').trim();
  const items = list || [];
  if (nid) {
    const byId = items.find((a) => a.id === nid && String(a.imageUrl || '').trim());
    if (byId) return String(byId.imageUrl).trim();
  }
  return pickPipelineMediaByName(items, name);
}

/**
 * 把服装图 / 参考图 / 视图槽提升到主形象 imageUrl，只填空。
 * 不依赖 pipeline，换集后卡片才能立刻显示已有定妆。
 */
export function promoteDramaCharacterMasterImages(
  session: DramaDirectorSession | null | undefined,
): DramaDirectorSession | null {
  if (!session?.bible) return null;
  let next: DramaDirectorSession = session;
  let changed = false;
  const fill = (id: string, url: string) => {
    const u = String(url || '').trim();
    if (!u) return;
    const patched = applyDramaSessionAssetImage(next, id, { imageUrl: u, status: 'ready' });
    if (patched) {
      next = patched;
      changed = true;
    }
  };
  for (const c of next.bible.characters) {
    if (String(c.imageUrl || '').trim()) continue;
    const active = c.costumes?.find((x) => x.active) || c.costumes?.[0];
    const fromActive = String(active?.images?.[0] || '').trim();
    // 当前造型为空（用户新建/切到空造型）：禁止用其它装/参考图回填主卡
    if ((c.costumes?.length || 0) > 0 && active && !fromActive) continue;
    fill(c.character_id, resolveCharacterMasterReferenceUrl(c));
  }
  for (const s of next.bible.scenes) {
    if (String(s.imageUrl || '').trim()) continue;
    fill(s.scene_id, resolveSceneMasterReferenceUrl(s));
  }
  for (const p of next.bible.props) {
    if (String(p.imageUrl || '').trim()) continue;
    fill(p.prop_id, resolvePropMasterReferenceUrl(p));
  }
  return changed ? next : null;
}

/**
 * 分析换了 character_id 后，按名字把 pipeline 里仍在的定妆图绑回圣经。
 * 只填空，不覆盖用户已有图。无 pipeline 时仍会提升服装/参考图。
 */
export function restoreDramaBibleMediaFromPipeline(
  session: DramaDirectorSession | null | undefined,
  assets: DirectorAssetsBag | null | undefined,
): DramaDirectorSession | null {
  if (!session?.bible) return null;
  const promoted = promoteDramaCharacterMasterImages(session);
  if (!assets) return promoted;
  session = promoted || session;
  const flat = flattenDirectorAssets(assets);
  const byId = new Map<string, string>();
  for (const a of flat) {
    const url = String(a.imageUrl || '').trim();
    if (url) byId.set(a.id, url);
  }
  let next: DramaDirectorSession = session;
  let changed = false;
  const fill = (id: string, url: string) => {
    const u = String(url || '').trim();
    if (!u) return;
    const patched = applyDramaSessionAssetImage(next, id, { imageUrl: u, status: 'ready' });
    if (patched) {
      next = patched;
      changed = true;
    }
  };

  for (const c of next.bible.characters) {
    if (String(c.imageUrl || '').trim()) continue;
    const active = c.costumes?.find((x) => x.active) || c.costumes?.[0];
    const fromActive = String(active?.images?.[0] || '').trim();
    // 已有造型且当前为空：用户新建/切到空造型，禁止用 pipeline 或其它装回填
    if ((c.costumes?.length || 0) > 0 && active && !fromActive) continue;
    fill(
      c.character_id,
      byId.get(c.character_id) || pickPipelineMediaByName(assets.characters, c.name) || fromActive,
    );
  }
  {
    const costumeUrlMap: Record<string, string> = {};
    for (const [id, url] of byId) {
      if (id && url) costumeUrlMap[id] = url;
    }
    // 只补空造型；禁止用 pipeline 里造型 id 的旧定妆盖掉主卡刚写上的新图
    const synced = applyCostumeImagesFromUrlMap(next.bible.characters, costumeUrlMap, {
      overwrite: false,
    });
    if (synced.some((c, i) => c !== next.bible.characters[i])) {
      next = createEmptyDramaSession({
        ...next,
        bible: { ...next.bible, characters: synced },
      });
      changed = true;
    }
  }
  for (const s of next.bible.scenes) {
    if (String(s.imageUrl || '').trim()) continue;
    fill(s.scene_id, byId.get(s.scene_id) || pickPipelineMediaByName(assets.scenes, s.name || s.location));
  }
  for (const p of next.bible.props) {
    if (String(p.imageUrl || '').trim()) continue;
    fill(p.prop_id, byId.get(p.prop_id) || pickPipelineMediaByName(assets.props, p.name));
  }
  for (const c of next.bible.creatures) {
    if (String(c.imageUrl || '').trim()) continue;
    // 生物卡刚从人物定妆纠错清空时，禁止把 pipeline 里的人像绑回来
    if (c.status === 'pending' && /禁止人类/.test(String(c.prompt || ''))) continue;
    const pipe =
      (assets.creatures || []).find((a) => a.id === c.creature_id) ||
      (assets.creatures || []).find(
        (a) => normDramaAssetName(a.name) === normDramaAssetName(c.name),
      );
    if (
      pipe &&
      (dramaCreaturePromptLooksHuman(pipe.prompt) ||
        /血条|进度条|生命值|HP|面板/.test(String(pipe.name || '')) ||
        /血条|进度条|生命值|HP|面板/.test(String(c.name || '')))
    ) {
      continue;
    }
    fill(c.creature_id, byId.get(c.creature_id) || pickPipelineMediaByName(assets.creatures, c.name));
  }
  {
    const sysVoice = resolveDramaSystemVoice(next);
    if (sysVoice) {
      const own = String(sysVoice.imageUrl || '').trim();
      const fromPipe =
        byId.get(DRAMA_SYSTEM_SPEAKER_ID) ||
        byId.get(String(sysVoice.voice_id || '').trim()) ||
        pickPipelineMediaByName(assets.characters, '系统提示音');
      // 空图必补；generating 时用 pipeline 新图收口（重新生成）
      if (
        fromPipe &&
        (!own || sysVoice.image_status === 'generating')
      ) {
        fill(DRAMA_SYSTEM_SPEAKER_ID, fromPipe);
      }
    }
  }
  return changed ? next : promoted;
}
