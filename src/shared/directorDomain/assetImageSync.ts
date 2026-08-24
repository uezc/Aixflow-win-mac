/**
 * 短剧 Domain 资产生图结果回写（人物 / 场景 / 道具 / 生物）。
 * Workspace 任务 SUCCESS 与 DirectorNode 监听共用，避免只写 pipeline 不写 bible。
 */

import { dramaCreaturePromptLooksHuman, namesLikelySameDramaPerson, coreDramaPersonName } from './extractCastFromScript.js';
import type { DramaAssetReferenceImage, DramaAssetStatus, DramaDirectorSession } from './types.js';
import { createEmptyDramaAssetReferenceImage, createEmptyDramaSession } from './factories.js';
import { normDramaAssetName } from './mergeAnalyzeBible.js';
import {
  resolveCharacterMasterReferenceUrl,
  resolvePropMasterReferenceUrl,
  resolveSceneMasterReferenceUrl,
} from './constraints.js';
import type { DirectorAsset, DirectorAssetsBag } from '../directorPipeline/schema.js';
import { flattenDirectorAssets } from '../directorPipeline/schema.js';

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
      return { ...c, costumes: nextCostumes };
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
    const nextCharacters = session.bible.characters.map((c) => {
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
          }
        : { costumes };
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
  const voices = session.bible.voices.map((v) => {
    if (v.voice_id !== id) return v;
    hit = true;
    return {
      ...v,
      ...(opts.sampleUrl !== undefined ? { sample_url: String(opts.sampleUrl || '').trim() } : {}),
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
  return createEmptyDramaSession({
    ...session,
    bible: { ...session.bible, voices },
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
        if (preserve.has(id) && !fromMap) return x;
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

  const characters = healVisual(session.bible.characters, (c) => c.character_id);
  const scenes = healVisual(session.bible.scenes, (s) => s.scene_id);
  const props = healVisual(session.bible.props, (p) => p.prop_id);
  const creatures = healVisual(session.bible.creatures, (c) => c.creature_id);

  // 声音 generating 不在此自动清：声音不走 image 队列，tasks 对账若在 START 前把
  // generating 抹掉会导致绿色进度条闪一下消失。完成态由 SUCCESS/ERROR 回写。
  const voices = session.bible.voices;

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
  return changed ? next : promoted;
}
