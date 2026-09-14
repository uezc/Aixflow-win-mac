import React, { useEffect } from 'react';
import { FileText, Image, Video, User, UserRound, Volume2, Brain, SplitSquareVertical, Palette, Film, Layers, Box, Music2, Mic2, LayoutGrid, Sparkles, Clapperboard, SplitSquareHorizontal } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { contextMenuLabelForType } from '../../i18n/contextMenuI18n';
import { HIDE_SORA2_AND_SORA_CHARACTER_UI } from '../../config/sora2UiPolicy';
import { HIDE_DIRECTOR_DRAMA_UI, HIDE_DIRECTOR_STAGE_UI } from '../../config/directorUiPolicy';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onSelect: (type: string) => void;
  /** 拖线创建时：只展示这些类型，不传则展示全部 */
  allowedTypes?: string[] | null;
}

const baseMenuItems = [
  { type: 'text', icon: FileText },
  { type: 'llm', icon: Brain },
  { type: 'textSplit', icon: SplitSquareVertical },
  { type: 'image', icon: Image },
  { type: 'canvas-tool', icon: Palette },
  { type: 'video', icon: Video },
  { type: 'heyGem', icon: UserRound },
  { type: 'videoSplice', icon: Film },
  { type: 'photoCollage', icon: Layers },
  { type: 'gridMap', icon: LayoutGrid },
  { type: 'imageComparer', icon: SplitSquareHorizontal },
  { type: 'director', icon: Sparkles },
  { type: 'directorDrama', icon: Clapperboard },
  { type: 'directorDramaV2', icon: Clapperboard },
  { type: 'imageTo3d', icon: Box },
  { type: 'character', icon: User },
  { type: 'audio', icon: Volume2 },
];

const visibleBaseMenuItems = baseMenuItems.filter((item) => {
  if (HIDE_SORA2_AND_SORA_CHARACTER_UI && item.type === 'character') return false;
  if (HIDE_DIRECTOR_STAGE_UI && (item.type === 'director' || item.type === 'directorDrama' || item.type === 'directorDramaV2')) return false;
  if (HIDE_DIRECTOR_DRAMA_UI && item.type === 'directorDrama') return false;
  return true;
});

const videoToAudioItems = [{ type: 'audio-extract-from-video', icon: Volume2 }];

const audioSubMenuItems = [
  { type: 'audio-voice-cover', icon: Music2 },
  { type: 'audio-extract-vocals', icon: Volume2 },
  { type: 'audio-extract-background', icon: Volume2 },
  { type: 'rvcTrain', icon: Mic2 },
];

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, onSelect, allowedTypes }) => {
  const { locale } = useAppLocale();

  // 打开菜单时清掉画布上误拖出的文字选区，避免菜单项被“拖蓝”
  useEffect(() => {
    try {
      window.getSelection()?.removeAllRanges();
    } catch {
      /* ignore */
    }
  }, []);

  const handleItemClick = (e: React.MouseEvent, type: string) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(type);
    // 延迟关闭，避免菜单立即卸载导致同一次点击落到画布触发 onPaneClick
    requestAnimationFrame(() => onClose());
  };

  const items = (() => {
    if (allowedTypes && allowedTypes.length === 0) return [];
    if (allowedTypes && allowedTypes.length > 0) {
      const hasVideoToAudio = allowedTypes.includes('audio-extract-from-video');
      const hasAudioSubmenu =
        allowedTypes.includes('audio-voice-cover') ||
        allowedTypes.includes('audio-extract-vocals') ||
        allowedTypes.includes('audio-extract-background') ||
        allowedTypes.includes('rvcTrain');
      const base = visibleBaseMenuItems.filter(
        (item) =>
          allowedTypes!.includes(item.type) &&
          (hasVideoToAudio ? item.type !== 'audio' : true)
      );
      const audioExtractItems = videoToAudioItems.filter((item) => allowedTypes!.includes(item.type));
      const audioSubItems = audioSubMenuItems.filter((item) => allowedTypes!.includes(item.type));
      return [...base, ...audioExtractItems, ...audioSubItems];
    }
    return visibleBaseMenuItems;
  })();

  return (
    <>
      {/* 背景遮罩，点击关闭菜单 */}
      <div
        className="fixed inset-0 z-40 select-none"
        style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
        onClick={onClose}
        onMouseDown={(e) => {
          e.preventDefault();
          try {
            window.getSelection()?.removeAllRanges();
          } catch {
            /* ignore */
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* 菜单 */}
      <div
        className="fixed z-50 apple-panel rounded-lg py-2 min-w-[120px] shadow-xl animate-menu-expand select-none"
        style={{
          left: `${x}px`,
          top: `${y}px`,
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          e.stopPropagation();
          // 阻止拖动手势产生文字蓝选；菜单项仍靠自身 onMouseDown 创建节点
          e.preventDefault();
          try {
            window.getSelection()?.removeAllRanges();
          } catch {
            /* ignore */
          }
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.type}
              type="button"
              onMouseDown={(e) => handleItemClick(e, item.type)}
              className="w-full px-4 py-2 flex items-center gap-3 text-white hover:bg-white/15 transition-colors text-sm select-none"
              style={{ userSelect: 'none', WebkitUserSelect: 'none' } as React.CSSProperties}
            >
              <Icon className="w-4 h-4 text-white/60 shrink-0 pointer-events-none" />
              <span className="select-none pointer-events-none">{contextMenuLabelForType(locale, item.type)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};

export default ContextMenu;
