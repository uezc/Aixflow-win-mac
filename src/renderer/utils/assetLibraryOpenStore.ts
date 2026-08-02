import type { AssetLibTabId } from './assetLibraryChrome';
import {
  digitalHumanAudioUrl,
  digitalHumanVideoUrl,
  type DigitalHumanLibraryItem,
} from '../components/characterListShared';

/** 打开左侧素材库并切换到指定 Tab（Workspace 展开侧栏，AssetLibrarySidebar 切 Tab） */
export const OPEN_ASSET_LIBRARY_EVENT = 'nexflow-open-asset-library';

export type OpenAssetLibraryDetail = {
  tab: AssetLibTabId;
};

export function openAssetLibrary(tab: AssetLibTabId): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<OpenAssetLibraryDetail>(OPEN_ASSET_LIBRARY_EVENT, { detail: { tab } }),
  );
}

export type DigitalHumanLibraryPickResult = {
  videoUrl: string;
  audioUrl?: string;
};

type PickListener = (active: boolean) => void;

let pickResolve: ((result: DigitalHumanLibraryPickResult | null) => void) | null = null;
let pickActive = false;
const pickListeners = new Set<PickListener>();

function notifyPickListeners(): void {
  for (const l of pickListeners) {
    try {
      l(pickActive);
    } catch {
      /* ignore */
    }
  }
}

export function isDigitalHumanLibraryPickActive(): boolean {
  return pickActive;
}

export function subscribeDigitalHumanLibraryPick(listener: PickListener): () => void {
  pickListeners.add(listener);
  listener(pickActive);
  return () => {
    pickListeners.delete(listener);
  };
}

function endPick(result: DigitalHumanLibraryPickResult | null): void {
  const resolve = pickResolve;
  pickResolve = null;
  pickActive = false;
  notifyPickListeners();
  resolve?.(result);
}

/** 取消当前「为 HeyGem 选择数字人」点选 */
export function cancelDigitalHumanLibraryPick(): void {
  if (!pickActive) return;
  endPick(null);
}

/**
 * 进入数字人库点选：侧栏条目（有参考视频）被选中后 resolve。
 * 再次调用会取消上一次未完成的 Promise。
 */
export function beginDigitalHumanLibraryPick(): Promise<DigitalHumanLibraryPickResult | null> {
  if (pickResolve) {
    endPick(null);
  }
  pickActive = true;
  notifyPickListeners();
  return new Promise((resolve) => {
    pickResolve = resolve;
  });
}

/** 侧栏选中数字人后回填到 HeyGem */
export function resolveDigitalHumanLibraryPick(item: DigitalHumanLibraryItem): boolean {
  if (!pickActive || !pickResolve) return false;
  const videoUrl = digitalHumanVideoUrl(item);
  if (!videoUrl) return false;
  const audio = digitalHumanAudioUrl(item);
  endPick({
    videoUrl,
    ...(audio ? { audioUrl: audio } : {}),
  });
  return true;
}
