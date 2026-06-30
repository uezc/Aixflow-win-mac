import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DigitalHumanLibraryItem } from './characterListShared';
import { digitalHumanVideoUrl } from './characterListShared';
import { toElectronVideoElementSrc } from '../utils/normalizeVideoUrl';

const HOVER_SIDE_GAP = '1cm';
const VIEWPORT_EDGE = 12;
/** 竖屏卡片 9:16，高度上限 */
const PORTRAIT_CARD_MAX_HEIGHT = 560;
const PORTRAIT_ASPECT = 9 / 16;

let sideGapPxCache: number | null = null;
function getSideGapPx(): number {
  if (sideGapPxCache != null) return sideGapPxCache;
  if (typeof document === 'undefined') {
    sideGapPxCache = 38;
    return sideGapPxCache;
  }
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;left:-9999px;width:${HOVER_SIDE_GAP};height:1px;visibility:hidden;pointer-events:none`;
  document.body.appendChild(probe);
  sideGapPxCache = probe.getBoundingClientRect().width;
  probe.remove();
  return sideGapPxCache;
}

function portraitCardSize(): { width: number; height: number } {
  const maxH = Math.min(
    PORTRAIT_CARD_MAX_HEIGHT,
    (typeof window !== 'undefined' ? window.innerHeight : 800) - VIEWPORT_EDGE * 2,
  );
  const height = Math.max(240, maxH);
  const width = Math.round(height * PORTRAIT_ASPECT);
  return { width, height };
}

function hoverFrameClass(isDarkMode: boolean): string {
  return isDarkMode
    ? 'rounded-xl overflow-hidden border border-white/15 bg-zinc-900/90 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-sm'
    : 'rounded-xl overflow-hidden border border-black/10 bg-white shadow-[0_8px_32px_rgba(0,0,0,0.12)]';
}

export interface DigitalHumanLibraryVideoHoverPreviewProps {
  item: DigitalHumanLibraryItem;
  anchorRect: DOMRect;
  isDarkMode: boolean;
}

const DigitalHumanLibraryVideoHoverPreview: React.FC<DigitalHumanLibraryVideoHoverPreviewProps> = ({
  item,
  anchorRect,
  isDarkMode,
}) => {
  const videoUrl = digitalHumanVideoUrl(item);
  const displaySrc = useMemo(
    () => (videoUrl ? toElectronVideoElementSrc(videoUrl) || videoUrl : ''),
    [videoUrl],
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const cardSize = useMemo(() => portraitCardSize(), []);
  const sideGap = getSideGapPx();
  const displayName = (item.nickname || item.name || '').trim();

  const updatePosition = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    const panelW = el.offsetWidth || cardSize.width;
    const panelH = el.offsetHeight || cardSize.height;
    const edge = VIEWPORT_EDGE;
    let left = anchorRect.right + sideGap;
    if (left + panelW > window.innerWidth - edge) {
      left = Math.max(edge, anchorRect.left - sideGap - panelW);
    }
    let top = anchorRect.top + anchorRect.height / 2;
    const halfH = panelH / 2;
    if (top - halfH < edge) top = edge + halfH;
    if (top + halfH > window.innerHeight - edge) top = window.innerHeight - edge - halfH;
    setPosition({ left, top });
  }, [anchorRect, sideGap, cardSize.width, cardSize.height]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, item.id, videoUrl]);

  const startPlayback = useCallback(() => {
    const v = videoRef.current;
    if (!v || !displaySrc) return;
    v.volume = 1;
    v.muted = false;
    v.currentTime = 0;
    void v.play().catch(() => {
      v.muted = true;
      void v.play().catch(() => undefined);
    });
  }, [displaySrc]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !displaySrc) return;
    startPlayback();
    return () => {
      v.pause();
      v.muted = true;
    };
  }, [displaySrc, item.id, startPlayback]);

  if (!displaySrc.trim()) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[10050] pointer-events-none"
      style={{
        left: position?.left ?? anchorRect.right + sideGap,
        top: position?.top ?? anchorRect.top + anchorRect.height / 2,
        transform: 'translateY(-50%)',
        visibility: position ? 'visible' : 'hidden',
      }}
      role="presentation"
      aria-hidden
    >
      <div className={hoverFrameClass(isDarkMode)}>
        <div
          className="relative overflow-hidden bg-black"
          style={{ width: cardSize.width, height: cardSize.height }}
        >
          <video
            ref={videoRef}
            key={`${item.id}-${displaySrc.slice(-48)}`}
            src={displaySrc}
            className="absolute inset-0 h-full w-full object-contain"
            loop
            playsInline
            preload="auto"
            onLoadedData={startPlayback}
          />
          {displayName ? (
            <div className="absolute inset-x-0 bottom-0 px-2 py-1.5 bg-gradient-to-t from-black/75 to-transparent pointer-events-none">
              <p className="text-xs font-medium text-white truncate">{displayName}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default DigitalHumanLibraryVideoHoverPreview;
