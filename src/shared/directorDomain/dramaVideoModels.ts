/**
 * 短剧导演：已接入且可真实出片的视频模型白名单。
 * 未接入 Adapter（stub）的模型不出现在单镜/批量选择器。
 */

import { getDramaVideoAdapter, listDramaVideoAdapters } from './adapters/types.js';

export type DramaSupportedVideoModelId =
  | 'minimax-h3-multi'
  | 'minimax-h3-audio';

export type DramaSupportedVideoModelOption = {
  id: DramaSupportedVideoModelId;
  label: string;
  /** lipsync 需要本镜 audio_url */
  requiresShotAudio: boolean;
  title: string;
};

const READY: DramaSupportedVideoModelOption[] = [
  {
    id: 'minimax-h3-multi',
    label: 'MiniMax H3 全能参考',
    requiresShotAudio: false,
    title: '最多 9 张参考图 + 各角色参考音（音色身份）；480P/720P',
  },
  {
    id: 'minimax-h3-audio',
    label: 'MiniMax H3 对口型',
    requiresShotAudio: true,
    title: '本镜声音（对白+环境音）作为唯一参考音驱动口型；需先生成本镜声音',
  },
];

const READY_SET = new Set<string>(READY.map((m) => m.id));

export function listDramaSupportedVideoModels(): DramaSupportedVideoModelOption[] {
  // 与 Adapter 注册表对齐：仅保留已注册且在白名单内的
  const registered = new Set(listDramaVideoAdapters().map((a) => a.id));
  return READY.filter((m) => registered.has(m.id) && !!getDramaVideoAdapter(m.id));
}

export function isDramaSupportedVideoModel(id: string | undefined | null): boolean {
  return READY_SET.has(String(id || '').trim());
}

export function normalizeDramaSupportedVideoModel(
  raw: string | undefined | null,
  fallback: DramaSupportedVideoModelId = 'minimax-h3-multi',
): DramaSupportedVideoModelId {
  const m = String(raw || '').trim();
  if (isDramaSupportedVideoModel(m)) return m as DramaSupportedVideoModelId;
  if (m.startsWith('minimax-h3')) {
    if (m.includes('audio') || m.includes('lipsync')) return 'minimax-h3-audio';
    return 'minimax-h3-multi';
  }
  return fallback;
}

export function dramaVideoModelRequiresShotAudio(id: string | undefined | null): boolean {
  const m = normalizeDramaSupportedVideoModel(id);
  return listDramaSupportedVideoModels().find((x) => x.id === m)?.requiresShotAudio === true;
}

/** 当前模型最多可提交的参考图张数（场景/人物/道具/生物共用） */
export function dramaVideoModelMaxRefImages(id: string | undefined | null): number {
  const raw = String(id || '').trim();
  if (raw === 'minimax-h3-i2v') return 1;
  const m = normalizeDramaSupportedVideoModel(id);
  if (m === 'minimax-h3-audio') return 5;
  return 9;
}

/** 当前模型最多可提交的参考音路数（全能参考=角色音色；对口型=本镜声音 1 路） */
export function dramaVideoModelMaxRefAudios(id: string | undefined | null): number {
  const raw = String(id || '').trim();
  if (raw === 'minimax-h3-i2v') return 0;
  const m = normalizeDramaSupportedVideoModel(id);
  if (m === 'minimax-h3-audio') return 1;
  return 3;
}

export function dramaVideoModelLabel(id: string | undefined | null): string {
  const m = normalizeDramaSupportedVideoModel(id);
  return listDramaSupportedVideoModels().find((x) => x.id === m)?.label || m;
}

export function resolveDramaShotVideoModel(
  shotModelParams: Record<string, string> | undefined | null,
  sessionDefault: string | undefined | null,
  opts?: { hasDialogue?: boolean; hasShotAudio?: boolean },
): DramaSupportedVideoModelId {
  const fromShot = String(shotModelParams?.video_model || '').trim();
  if (fromShot) {
    const normalized = normalizeDramaSupportedVideoModel(fromShot);
    if (isDramaSupportedVideoModel(fromShot) || fromShot.startsWith('minimax-h3')) {
      return normalized;
    }
  }
  const base = normalizeDramaSupportedVideoModel(sessionDefault, 'minimax-h3-multi');
  // 未手选时：有对白 + 本镜音 → 默认口型；否则全能参考
  if (opts?.hasDialogue && opts?.hasShotAudio) {
    return 'minimax-h3-audio';
  }
  return base === 'minimax-h3-audio' && !opts?.hasShotAudio ? 'minimax-h3-multi' : base;
}
