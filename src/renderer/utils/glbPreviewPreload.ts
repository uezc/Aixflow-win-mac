import { useGLTF } from '@react-three/drei';
import type { Character } from '../components/characterListShared';
import {
  characterHasGlbForPreview,
  isImageTo3dLibraryCharacter,
  resolveCharacterGlbUrlForPreview,
} from '../components/characterListShared';

const done = new Set<string>();
const inflight = new Map<string, Promise<unknown>>();

/** 预加载 GLB 到 useGLTF 缓存，悬停预览可近乎秒开 */
export function preloadGlbPreviewUrl(url: string | undefined | null): void {
  const u = (url || '').trim();
  if (!u || done.has(u) || inflight.has(u)) return;
  try {
    const p = Promise.resolve(useGLTF.preload(u))
      .then(() => {
        done.add(u);
        inflight.delete(u);
      })
      .catch(() => {
        inflight.delete(u);
      });
    inflight.set(u, p);
  } catch {
    /* ignore */
  }
}

export function preloadImageTo3dCharacter(character: Character | null | undefined): void {
  if (!character || !isImageTo3dLibraryCharacter(character)) return;
  if (!characterHasGlbForPreview(character)) return;
  preloadGlbPreviewUrl(resolveCharacterGlbUrlForPreview(character));
}

/** 进入 3D 模型库时后台预热（限制并发，避免卡顿） */
export function preloadImageTo3dCharactersIdle(characters: Character[]): void {
  if (typeof window === 'undefined') return;
  const urls = characters
    .filter((c) => isImageTo3dLibraryCharacter(c) && characterHasGlbForPreview(c))
    .map((c) => resolveCharacterGlbUrlForPreview(c))
    .filter(Boolean);
  const unique = [...new Set(urls)];
  let idx = 0;
  const CONCURRENCY = 2;

  const pump = () => {
    let started = 0;
    while (idx < unique.length && started < CONCURRENCY) {
      preloadGlbPreviewUrl(unique[idx]);
      idx += 1;
      started += 1;
    }
    if (idx < unique.length) {
      const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 48));
      ric(pump);
    }
  };

  pump();
}
