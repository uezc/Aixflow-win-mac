import type { CSSProperties } from 'react';
import {
  asNormRect,
  normalizeClipLayout,
  type ClipLayout,
  type NormRect,
} from '../../shared/clipLayout';

export {
  DEFAULT_CLIP_LAYOUT,
  CLIP_LAYOUT_MIN,
  clamp01,
  normalizeClipLayout,
  isDefaultClipLayout,
  asNormRect,
  sourceRectFromLayoutAndCrop,
  layoutFromSourceRectAndCrop,
  syncLayoutAfterCropChange,
  buildClipLayoutScaleFilter,
  buildClipLayoutOverlayFilter,
  type ClipLayout,
  type NormRect,
} from '../../shared/clipLayout';

/** 预览 DOM：绝对定位百分比（默认夹紧到画布 0–1） */
export function clipLayoutToCss(layout?: Partial<ClipLayout> | null): CSSProperties {
  const L = normalizeClipLayout(layout);
  return {
    left: `${L.x * 100}%`,
    top: `${L.y * 100}%`,
    width: `${L.w * 100}%`,
    height: `${L.h * 100}%`,
    right: 'auto',
    bottom: 'auto',
  };
}

/** 预览 DOM：允许超出画布的源占位（裁剪编辑对照） */
export function normRectToCss(rect?: Partial<NormRect> | null): CSSProperties {
  const R = asNormRect(rect);
  return {
    left: `${R.x * 100}%`,
    top: `${R.y * 100}%`,
    width: `${R.w * 100}%`,
    height: `${R.h * 100}%`,
    right: 'auto',
    bottom: 'auto',
  };
}
