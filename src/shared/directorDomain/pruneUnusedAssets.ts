/**
 * 清理分析多抽、分镜未用的道具/场景（保留已有参考图的可选手动）。
 */

import { createEmptyDramaSession } from './factories.js';
import { coreDramaPersonName } from './extractCastFromScript.js';
import type { DramaDirectorSession, DramaProp, DramaSceneAsset } from './types.js';

const PROP_KIND_RULES: Array<{ re: RegExp; canon: string }> = [
  { re: /手机|电话|智能手机|iphone|android|屏幕手机/i, canon: '智能手机' },
  { re: /外卖袋|保温袋|配送袋|餐箱|外卖箱/i, canon: '外卖保温袋' },
  { re: /水瓶|瓶装水|矿泉水|饮料瓶/i, canon: '瓶装水' },
  { re: /饭盒|餐盒|外卖盒|塑料盒/i, canon: '外卖餐盒' },
  { re: /电动车|电瓶车|外卖车|摩托车|踏板车/i, canon: '外卖电动车' },
  { re: /头盔|安全帽/i, canon: '头盔' },
  { re: /电脑|笔记本|显示器|屏幕/i, canon: '电脑屏幕' },
  { re: /钥匙|门禁卡|工牌/i, canon: '门禁卡' },
];

function propKindKey(name: string): string {
  const n = String(name || '').trim();
  for (const rule of PROP_KIND_RULES) {
    if (rule.re.test(n)) return rule.canon;
  }
  return n.replace(/\s+/g, '').toLowerCase() || n;
}

function preferProp(a: DramaProp, b: DramaProp): DramaProp {
  const aImg = !!String(a.imageUrl || '').trim();
  const bImg = !!String(b.imageUrl || '').trim();
  if (aImg !== bImg) return aImg ? a : b;
  return a;
}

/** 同类道具只留一张（有图优先），分析后硬顶 cap */
export function dedupeDramaPropsByKind(props: DramaProp[], cap = 6): DramaProp[] {
  const byKey = new Map<string, DramaProp>();
  const order: string[] = [];
  for (const p of props || []) {
    const key = propKindKey(p.name);
    if (!key) continue;
    const canon = PROP_KIND_RULES.find((r) => r.canon === key)?.canon;
    const normalized: DramaProp =
      canon && p.name !== canon
        ? { ...p, name: canon, description: p.description || p.name }
        : p;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, normalized);
      order.push(key);
      continue;
    }
    byKey.set(key, preferProp(prev, normalized));
  }
  return order.slice(0, Math.max(1, cap)).map((k) => byKey.get(k)!).filter(Boolean);
}

function shotTextBlob(session: DramaDirectorSession): string {
  const parts: string[] = [];
  for (const s of session.shots || []) {
    parts.push(
      s.action,
      s.blocking,
      s.environment,
      s.sfx,
      ...(s.prop_ids || []),
      ...(s.required_prop_ids || []),
    );
    for (const ev of s.timeline_events || []) {
      parts.push(ev.visual_action, ...(ev.character_ids || []));
    }
  }
  for (const sug of Object.values(session.episode_bibles || {})) {
    for (const s of sug.shot_suggestions || []) {
      parts.push(s.action, s.environment, ...(s.cast_names || []));
    }
    for (const ev of sug.visual_events || []) {
      parts.push(ev.see, ev.who, ev.location);
    }
  }
  return parts.map((x) => String(x || '')).join('\n');
}

export function listUnusedDramaPropIds(session: DramaDirectorSession): string[] {
  const shots = session.shots || [];
  const bound = new Set<string>();
  for (const s of shots) {
    for (const id of [...(s.prop_ids || []), ...(s.required_prop_ids || [])]) {
      if (id) bound.add(id);
    }
  }
  // 尚无正式分镜时：按事件/建议文案是否点名判断
  const blob = shotTextBlob(session);
  const unused: string[] = [];
  for (const p of session.bible.props || []) {
    const id = p.prop_id;
    if (bound.has(id)) continue;
    const name = String(p.name || '').trim();
    if (name && blob.includes(name)) continue;
    const core = coreDramaPersonName(name) || name;
    if (core.length >= 2 && blob.includes(core)) continue;
    // 无任何分镜/事件文本时不标「未用」（避免分析刚完成就全删）
    if (!blob.trim() && !(session.shots || []).length) continue;
    unused.push(id);
  }
  return unused;
}

export function listUnusedDramaSceneIds(session: DramaDirectorSession): string[] {
  if (!(session.shots || []).length) return [];
  const used = new Set<string>();
  for (const s of session.shots || []) {
    const id = String(s.scene_asset_id || '').trim();
    if (id) used.add(id);
  }
  for (const b of session.scene_beats || []) {
    const id = String(b.scene_asset_id || '').trim();
    if (id) used.add(id);
  }
  const locs = new Set<string>();
  for (const b of session.scene_beats || []) {
    const n = String(b.location_name || '').trim();
    if (n) locs.add(n);
  }
  for (const sug of Object.values(session.episode_bibles || {})) {
    for (const s of sug.shot_suggestions || []) {
      const n = String(s.scene || '').trim();
      if (n) locs.add(n);
    }
  }
  const unused: string[] = [];
  for (const sc of session.bible.scenes || []) {
    if (used.has(sc.scene_id)) continue;
    const name = String(sc.name || '').trim();
    const loc = String(sc.location || '').trim();
    if (name && locs.has(name)) continue;
    if (loc && locs.has(loc)) continue;
    unused.push(sc.scene_id);
  }
  return unused;
}

export type DramaPruneUnusedResult = {
  session: DramaDirectorSession;
  removedProps: DramaProp[];
  removedScenes: DramaSceneAsset[];
};

/** 删除分镜未绑定且文案未点名的道具；可选删未用场景 */
export function pruneUnusedDramaBibleAssets(
  session: DramaDirectorSession,
  opts?: { props?: boolean; scenes?: boolean },
): DramaPruneUnusedResult {
  const doProps = opts?.props !== false;
  const doScenes = !!opts?.scenes;
  const dropProp = new Set(doProps ? listUnusedDramaPropIds(session) : []);
  const dropScene = new Set(doScenes ? listUnusedDramaSceneIds(session) : []);
  const removedProps = (session.bible.props || []).filter((p) => dropProp.has(p.prop_id));
  const removedScenes = (session.bible.scenes || []).filter((s) => dropScene.has(s.scene_id));
  if (!removedProps.length && !removedScenes.length) {
    return { session, removedProps: [], removedScenes: [] };
  }
  return {
    session: createEmptyDramaSession({
      ...session,
      bible: {
        ...session.bible,
        props: (session.bible.props || []).filter((p) => !dropProp.has(p.prop_id)),
        scenes: (session.bible.scenes || []).filter((s) => !dropScene.has(s.scene_id)),
      },
    }),
    removedProps,
    removedScenes,
  };
}
