import React from 'react';
import { LayoutGrid } from 'lucide-react';
import {
  layerImageWrapperStyle,
  layerRotationDeg,
  layerTransformStyle,
} from '../../utils/collageLayerTransform';

export interface PhotoCollageLayerItemProps {
  layer: {
    id: string;
    x: number;
    y: number;
    w: number;
    h: number;
    z: number;
    rotation?: number;
    flipH?: boolean;
    flipV?: boolean;
  };
  selected: boolean;
  src: string;
  isDarkMode?: boolean;
  /** 旋钮拖动预览时的旋转角（覆盖 layer.rotation） */
  rotationDeg?: number;
  onMove: (e: React.MouseEvent) => void;
  onResize: (e: React.MouseEvent) => void;
  registerTransformEl?: (el: HTMLDivElement | null) => void;
}

export const PhotoCollageLayerItem: React.FC<PhotoCollageLayerItemProps> = ({
  layer: L,
  selected,
  src,
  isDarkMode = true,
  rotationDeg,
  onMove,
  onResize,
  registerTransformEl,
}) => {
  const rot = rotationDeg ?? layerRotationDeg(L);
  const transformLayer = { ...L, rotation: rot };

  return (
    <div
      className="absolute nodrag nopan overflow-visible pointer-events-none"
      style={{
        left: L.x,
        top: L.y,
        width: L.w,
        height: L.h,
        zIndex: Math.round(L.z) + 2,
      }}
    >
      <div
        ref={registerTransformEl}
        className={`relative h-full w-full overflow-visible rounded shadow-md pointer-events-auto ${
          selected ? 'ring-2 ring-violet-500 ring-offset-1 ring-offset-transparent' : ''
        }`}
        style={layerTransformStyle(transformLayer)}
        onMouseDown={onMove}
      >
        <div
          className="h-full w-full overflow-visible rounded bg-black/20 pointer-events-auto"
          onMouseDown={onMove}
        >
          {src ? (
            <div style={layerImageWrapperStyle(L)}>
              <img
                src={src}
                alt=""
                className="max-h-full max-w-full object-contain pointer-events-none select-none"
                draggable={false}
                loading="lazy"
                decoding="async"
              />
            </div>
          ) : (
            <div
              className={`flex h-full w-full items-center justify-center select-none ${
                isDarkMode ? 'bg-white/[0.06]' : 'bg-black/[0.04]'
              }`}
              aria-hidden
            >
              <LayoutGrid className={`h-5 w-5 ${isDarkMode ? 'text-white/20' : 'text-gray-400/50'}`} />
            </div>
          )}
        </div>
        <div
          className="absolute right-0 bottom-0 z-10 h-4 w-4 cursor-nwse-resize rounded-tl bg-violet-500/80 nodrag nopan"
          onMouseDown={(e) => {
            e.stopPropagation();
            onResize(e);
          }}
        />
      </div>
    </div>
  );
};
