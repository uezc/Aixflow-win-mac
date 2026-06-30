// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, User, Box, Mountain, LayoutGrid, List, ScanFace } from 'lucide-react';
import CharacterList from './CharacterList';
import SceneLibraryList from './SceneLibraryList';
import DigitalHumanLibraryList from './DigitalHumanLibraryList';
import type { Character, SceneLibraryItem, DigitalHumanLibraryItem } from './characterListShared';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { assetLibraryT } from '../i18n/assetLibraryI18n';
import {
  ASSET_LIBRARY_SIDEBAR_WIDTH_PX,
  assetLibBtnIcon,
  assetLibGalleryToggleActive,
  assetLibTabActive,
  assetLibTabInactive,
} from '../utils/assetLibraryChrome';

export type AssetLibraryTab = 'role' | 'model3d' | 'scene' | 'digitalHuman';

export type AssetLibraryViewMode = 'list' | 'gallery';

export interface AssetLibrarySidebarProps {
  isDarkMode: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** 大窗口画廊模式时通知父级加宽侧栏 */
  onGalleryModeChange?: (wide: boolean) => void;
  characterListRefreshTrigger: number;
  sceneListRefreshTrigger: number;
  digitalHumanListRefreshTrigger: number;
  onSelectCharacter?: (character: Character) => void;
  requestVoicePickFromCanvas?: () => Promise<{ url: string; label: string } | null>;
  requestViewSlotPickFromCanvas?: (slotIndex: number) => Promise<string | null>;
  requestSceneImagePickFromCanvas?: (role: 'normal' | 'display3d') => Promise<string | null>;
  requestDigitalHumanVideoPickFromCanvas?: () => Promise<string | null>;
  onPlaceSceneToCanvas?: (scene: SceneLibraryItem) => void;
  onPlaceDigitalHumanToCanvas?: (item: DigitalHumanLibraryItem) => void;
}

const AssetLibrarySidebar: React.FC<AssetLibrarySidebarProps> = ({
  isDarkMode,
  isCollapsed,
  onToggleCollapse,
  onGalleryModeChange,
  characterListRefreshTrigger,
  sceneListRefreshTrigger,
  digitalHumanListRefreshTrigger,
  onSelectCharacter,
  requestVoicePickFromCanvas,
  requestViewSlotPickFromCanvas,
  requestSceneImagePickFromCanvas,
  requestDigitalHumanVideoPickFromCanvas,
  onPlaceSceneToCanvas,
  onPlaceDigitalHumanToCanvas,
}) => {
  const { locale } = useAppLocale();
  const t = assetLibraryT(locale);
  const [tab, setTab] = useState<AssetLibraryTab>('role');
  const [viewMode, setViewMode] = useState<AssetLibraryViewMode>('list');

  const setGalleryMode = (wide: boolean) => {
    setViewMode(wide ? 'gallery' : 'list');
    onGalleryModeChange?.(wide);
  };

  useEffect(() => {
    if (isCollapsed && viewMode === 'gallery') {
      setViewMode('list');
      onGalleryModeChange?.(false);
    }
  }, [isCollapsed, viewMode, onGalleryModeChange]);

  const renderTabPanel = (mode: AssetLibraryViewMode) => (
    <>
      {tab === 'role' && (
        <CharacterList
          embedded
          assetFilter="role"
          viewMode={mode}
          isDarkMode={isDarkMode}
          isCollapsed={false}
          onToggleCollapse={onToggleCollapse}
          refreshTrigger={characterListRefreshTrigger}
          onSelectCharacter={onSelectCharacter}
          requestVoicePickFromCanvas={requestVoicePickFromCanvas}
          requestViewSlotPickFromCanvas={requestViewSlotPickFromCanvas}
        />
      )}
      {tab === 'model3d' && (
        <CharacterList
          embedded
          assetFilter="imageTo3d"
          showImport3d
          viewMode={mode}
          isDarkMode={isDarkMode}
          isCollapsed={false}
          onToggleCollapse={onToggleCollapse}
          refreshTrigger={characterListRefreshTrigger}
          onSelectCharacter={onSelectCharacter}
        />
      )}
      {tab === 'scene' && (
        <SceneLibraryList
          viewMode={mode}
          isDarkMode={isDarkMode}
          listActive={!isCollapsed && tab === 'scene'}
          refreshTrigger={sceneListRefreshTrigger}
          requestSceneImagePickFromCanvas={requestSceneImagePickFromCanvas}
          onPlaceSceneToCanvas={onPlaceSceneToCanvas}
        />
      )}
      {tab === 'digitalHuman' && (
        <DigitalHumanLibraryList
          viewMode={mode}
          isDarkMode={isDarkMode}
          listActive={!isCollapsed && tab === 'digitalHuman'}
          refreshTrigger={digitalHumanListRefreshTrigger}
          requestVideoPickFromCanvas={requestDigitalHumanVideoPickFromCanvas}
          onPlaceToCanvas={onPlaceDigitalHumanToCanvas}
        />
      )}
    </>
  );

  const tabBtn = (id: AssetLibraryTab, label: string, Icon: React.ComponentType<{ className?: string }>) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      title={label}
      className={`min-w-0 px-1 py-1.5 rounded-full text-[10px] leading-tight font-medium transition-all flex flex-col items-center justify-center gap-0.5 border ${
        tab === id ? assetLibTabActive(isDarkMode, id) : assetLibTabInactive(isDarkMode)
      }`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="truncate w-full text-center">{label}</span>
    </button>
  );

  if (isCollapsed) {
    const iconBtn = (id: AssetLibraryTab, Icon: React.ComponentType<{ className?: string }>, title: string) => (
      <button
        type="button"
        title={title}
        onClick={() => {
          setTab(id);
          onToggleCollapse();
        }}
        className={`p-2 rounded-full transition-colors border ${
          tab === id ? assetLibTabActive(isDarkMode, id) : assetLibTabInactive(isDarkMode)
        }`}
      >
        <Icon className="w-5 h-5" />
      </button>
    );

    return (
      <div
        className={`h-full w-12 flex flex-col items-center py-3 gap-2 border-r ${
          isDarkMode ? 'apple-panel border-white/10' : 'apple-panel-light border-gray-300/30'
        }`}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          className={assetLibBtnIcon(isDarkMode, 'motion')}
          title={t.expandLibrary}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
        {iconBtn('role', User, t.tabRole)}
        {iconBtn('digitalHuman', ScanFace, t.tabDigitalHuman)}
        {iconBtn('scene', Mountain, t.tabScene)}
        {iconBtn('model3d', Box, t.tabModel3d)}
      </div>
    );
  }

  const headerChrome = (
    <div
      className={`p-2.5 border-b flex items-center gap-1.5 flex-shrink-0 ${
        isDarkMode ? 'border-white/10' : 'border-gray-300/30'
      }`}
    >
      <div className="grid grid-cols-4 gap-1 flex-1 min-w-0">
        {tabBtn('role', t.tabRole, User)}
        {tabBtn('digitalHuman', t.tabDigitalHuman, ScanFace)}
        {tabBtn('scene', t.tabScene, Mountain)}
        {tabBtn('model3d', t.tabModel3d, Box)}
      </div>
      <button
        type="button"
        onClick={() => setGalleryMode(viewMode !== 'gallery')}
        className={viewMode === 'gallery' ? assetLibGalleryToggleActive(isDarkMode) : assetLibBtnIcon(isDarkMode, 'sensing')}
        title={viewMode === 'gallery' ? t.listMode : t.galleryMode}
      >
        {viewMode === 'gallery' ? <List className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
      </button>
      <button
        type="button"
        onClick={onToggleCollapse}
        className={assetLibBtnIcon(isDarkMode, 'motion')}
        title={t.collapseLibrary}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
    </div>
  );

  if (viewMode === 'gallery') {
    return (
      <div
        className={`h-full flex flex-col min-w-0 ${
          isDarkMode ? 'apple-panel border-white/10' : 'apple-panel-light border-gray-300/30'
        }`}
      >
        {headerChrome}
        <div
          className={`flex-1 min-w-0 flex flex-col min-h-0 ${
            isDarkMode ? 'bg-[#0c0c0e]' : 'bg-gray-50'
          }`}
        >
          {renderTabPanel('gallery')}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`h-full flex flex-col border-r ${
        isDarkMode ? 'apple-panel border-white/10' : 'apple-panel-light border-gray-300/30'
      }`}
      style={{ width: ASSET_LIBRARY_SIDEBAR_WIDTH_PX }}
    >
      {headerChrome}
      <div className="flex-1 min-h-0 flex flex-col">{renderTabPanel('list')}</div>
    </div>
  );
};

export default AssetLibrarySidebar;
