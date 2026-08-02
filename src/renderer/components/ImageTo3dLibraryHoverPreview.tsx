import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ImageTo3dInlineGlbPreview from './ImageTo3dInlineGlbPreview';
import type { Character } from './characterListShared';
import { resolveCharacterGlbUrlForPreview } from './characterListShared';

/** 悬停预览视口（与资产库侧栏旁展示一致） */
const PREVIEW_WIDTH = 440;
const PREVIEW_HEIGHT = 330;
const ASSET_LIBRARY_HOVER_SIDE_GAP = '1cm';

let sideGapPxCache: number | null = null;
function getSideGapPx(): number {
  if (sideGapPxCache != null) return sideGapPxCache;
  if (typeof document === 'undefined') {
    sideGapPxCache = 38;
    return sideGapPxCache;
  }
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;left:-9999px;width:${ASSET_LIBRARY_HOVER_SIDE_GAP};height:1px;visibility:hidden;pointer-events:none`;
  document.body.appendChild(probe);
  sideGapPxCache = probe.getBoundingClientRect().width;
  probe.remove();
  return sideGapPxCache;
}

function hoverFrameClass(isDarkMode: boolean): string {
  return isDarkMode
    ? 'rounded-xl overflow-hidden border border-white/15 bg-zinc-900/90 shadow-[0_8px_32px_rgba(0,0,0,0.55)]'
    : 'rounded-xl overflow-hidden border border-black/10 bg-white/90 shadow-[0_8px_32px_rgba(0,0,0,0.14)]';
}

function computeHoverPosition(anchorRect: DOMRect, sideGap: number, panelW: number, panelH: number) {
  const edge = 8;
  let left = anchorRect.right + sideGap;
  if (left + panelW > window.innerWidth - edge) {
    left = Math.max(edge, anchorRect.left - sideGap - panelW);
  }
  let top = anchorRect.top + anchorRect.height / 2;
  const halfH = panelH / 2;
  if (top - halfH < edge) top = edge + halfH;
  if (top + halfH > window.innerHeight - edge) top = window.innerHeight - edge - halfH;
  return { left, top };
}

export interface ImageTo3dLibraryHoverPreviewProps {
  character: Character;
  anchorRect: DOMRect;
  isDarkMode: boolean;
}

const ImageTo3dLibraryHoverPreview: React.FC<ImageTo3dLibraryHoverPreviewProps> = ({
  character,
  anchorRect,
  isDarkMode,
}) => {
  const glbUrl = resolveCharacterGlbUrlForPreview(character);
  const panelRef = useRef<HTMLDivElement>(null);
  const sideGap = getSideGapPx();
  const [position, setPosition] = useState(() =>
    computeHoverPosition(anchorRect, sideGap, PREVIEW_WIDTH, PREVIEW_HEIGHT),
  );

  const updatePosition = useCallback(() => {
    const el = panelRef.current;
    const panelW = el?.offsetWidth || PREVIEW_WIDTH;
    const panelH = el?.offsetHeight || PREVIEW_HEIGHT;
    setPosition(computeHoverPosition(anchorRect, sideGap, panelW, panelH));
  }, [anchorRect, sideGap]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, character.id, glbUrl]);

  if (!glbUrl) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[10050] pointer-events-none"
      style={{
        left: position.left,
        top: position.top,
        transform: 'translateY(-50%)',
      }}
      role="presentation"
      aria-hidden
    >
      <div className={hoverFrameClass(isDarkMode)}>
        <div
          className="relative overflow-hidden bg-[#1a1a1e]"
          style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
        >
          <ImageTo3dInlineGlbPreview
            character={character}
            showReferencePlaceholder
            gridStyle="showcase"
            showGrid
            turntableRotate
            controlsInteractive={false}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ImageTo3dLibraryHoverPreview;
