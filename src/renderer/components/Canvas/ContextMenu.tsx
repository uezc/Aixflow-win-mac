import React from 'react';
import { FileText, Image, Video, User, UserRound, Volume2, Brain, SplitSquareVertical, Palette, Film, Layers, Box, Music2, Mic2 } from 'lucide-react';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { contextMenuLabelForType } from '../../i18n/contextMenuI18n';
import { HIDE_SORA2_AND_SORA_CHARACTER_UI } from '../../config/sora2UiPolicy';

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
  { type: 'imageTo3d', icon: Box },
  { type: 'rvcTrain', icon: Mic2 },
  { type: 'character', icon: User },
  { type: 'audio', icon: Volume2 },
];

const visibleBaseMenuItems = HIDE_SORA2_AND_SORA_CHARACTER_UI
  ? baseMenuItems.filter((item) => item.type !== 'character')
  : baseMenuItems;

const videoToImageItems = [
  { type: 'image-first-frame', icon: Image },
  { type: 'image-current-frame', icon: Image },
  { type: 'image-last-frame', icon: Image },
];

const videoToAudioItems = [{ type: 'audio-extract-from-video', icon: Volume2 }];

const audioToAudioItems = [
  { type: 'audio-voice-cover', icon: Music2 },
  { type: 'audio-extract-vocals', icon: Volume2 },
  { type: 'audio-extract-background', icon: Volume2 },
];

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, onSelect, allowedTypes }) => {
  const { locale } = useAppLocale();

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
      const hasVideoToImage =
        allowedTypes.includes('image-first-frame') ||
        allowedTypes.includes('image-current-frame') ||
        allowedTypes.includes('image-last-frame');
      const hasVideoToAudio = allowedTypes.includes('audio-extract-from-video');
      const hasAudioToAudio =
        allowedTypes.includes('audio-voice-cover') ||
        allowedTypes.includes('audio-extract-vocals') ||
        allowedTypes.includes('audio-extract-background');
      const base = visibleBaseMenuItems.filter(
        (item) =>
          allowedTypes!.includes(item.type) &&
          (hasVideoToImage ? item.type !== 'image' : true) &&
          (hasVideoToAudio ? item.type !== 'audio' : true)
      );
      const frameItems = videoToImageItems.filter((item) => allowedTypes!.includes(item.type));
      const audioExtractItems = videoToAudioItems.filter((item) => allowedTypes!.includes(item.type));
      const audioToAudioExtractItems = audioToAudioItems.filter((item) => allowedTypes!.includes(item.type));
      return [...base, ...frameItems, ...audioExtractItems, ...audioToAudioExtractItems];
    }
    return visibleBaseMenuItems;
  })();

  return (
    <>
      {/* 背景遮罩，点击关闭菜单 */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* 菜单 */}
      <div
        className="fixed z-50 apple-panel rounded-lg py-2 min-w-[120px] shadow-xl animate-menu-expand"
        style={{
          left: `${x}px`,
          top: `${y}px`,
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.type}
              type="button"
              onMouseDown={(e) => handleItemClick(e, item.type)}
              className="w-full px-4 py-2 flex items-center gap-3 text-white hover:bg-white/15 transition-colors text-sm"
            >
              <Icon className="w-4 h-4 text-white/60" />
              <span>{contextMenuLabelForType(locale, item.type)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};

export default ContextMenu;
