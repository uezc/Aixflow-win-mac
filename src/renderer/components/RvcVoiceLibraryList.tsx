// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X, Pencil, Package, Upload, ImagePlus, Layers } from 'lucide-react';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { assetLibraryT } from '../i18n/assetLibraryI18n';
import type { AssetLibraryViewMode } from './AssetLibrarySidebar';
import {
  rvcVoiceAvatarUrl,
  rvcVoiceDisplayName,
  rvcVoiceModelPackageUrl,
  rvcVoiceTrainAudioUrl,
  NEXFLOW_RVC_VOICE_DRAG_MIME,
  type RvcVoiceLibraryItem,
} from './characterListShared';
import { ReferenceAudioWaveStrip } from './Canvas/ReferenceAudioWaveStrip';
import {
  assetLibBtnIcon,
  assetLibBtnPrimary,
  assetLibBtnSecondary,
  assetLibDeleteToolbarBtn,
  assetLibGalleryCardSelected,
  assetLibListCard,
  assetLibListCardSelected,
} from '../utils/assetLibraryChrome';
import { useIdlePoll } from '../hooks/useIdlePoll';

function pathToPreviewUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (m) => m.substring(1));
  return `local-resource://${normalized}`;
}

export interface RvcVoiceLibraryListProps {
  isDarkMode: boolean;
  viewMode?: AssetLibraryViewMode;
  refreshTrigger?: number;
  listActive?: boolean;
  onPlaceToCanvas?: (item: RvcVoiceLibraryItem) => void;
  onRvcVoiceUpdated?: (item: RvcVoiceLibraryItem) => void;
  requestVoicePickFromCanvas?: () => Promise<{ url: string; label: string } | null>;
}

const RvcVoiceLibraryList: React.FC<RvcVoiceLibraryListProps> = ({
  isDarkMode,
  viewMode = 'list',
  refreshTrigger,
  listActive = true,
  onPlaceToCanvas,
  onRvcVoiceUpdated,
  requestVoicePickFromCanvas,
}) => {
  const { locale } = useAppLocale();
  const t = assetLibraryT(locale);
  const [items, setItems] = useState<RvcVoiceLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [avatarPreview, setAvatarPreview] = useState('');
  const [trainAudioPreview, setTrainAudioPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalHiddenForCanvasPick, setModalHiddenForCanvasPick] = useState(false);
  const listScrollRef = useRef<HTMLDivElement>(null);

  const loadItems = useCallback(async () => {
    try {
      if (window.electronAPI?.getRvcVoices) {
        const list = await window.electronAPI.getRvcVoices();
        setItems(list.sort((a, b) => b.createdAt - a.createdAt));
      }
    } catch (e) {
      console.error('[RvcVoiceLibraryList] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems, refreshTrigger]);

  useIdlePoll(listActive, loadItems, 20000);

  const resetModal = useCallback(() => {
    setEditingId(null);
    setNickname('');
    setAvatarPreview('');
    setTrainAudioPreview('');
    setShowModal(false);
  }, []);

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!window.electronAPI?.deleteRvcVoices) return;
    try {
      await window.electronAPI.deleteRvcVoices(Array.from(selectedIds));
      setSelectedIds(new Set());
      loadItems();
    } catch (e) {
      console.error('[RvcVoiceLibraryList] delete failed', e);
    }
  };

  const handleImportZip = async () => {
    if (!window.electronAPI?.pickRvcVoicePackage || !window.electronAPI?.registerRvcVoice) return;
    try {
      const pick = await window.electronAPI.pickRvcVoicePackage();
      if (pick.canceled || !pick.filePath) return;
      await window.electronAPI.registerRvcVoice({
        modelPackageUrl: pathToPreviewUrl(pick.filePath),
      });
      loadItems();
    } catch (e) {
      console.error('[RvcVoiceLibraryList] import failed', e);
    }
  };

  const openEditModal = (item: RvcVoiceLibraryItem) => {
    setEditingId(item.id);
    setNickname(rvcVoiceDisplayName(item, ''));
    setAvatarPreview(rvcVoiceAvatarUrl(item));
    setTrainAudioPreview(rvcVoiceTrainAudioUrl(item));
    setShowModal(true);
  };

  const handlePickAvatar = async () => {
    const pick = await window.electronAPI?.pickRvcVoiceAvatar?.();
    if (pick && !pick.canceled && pick.filePath) {
      setAvatarPreview(pathToPreviewUrl(pick.filePath));
    }
  };

  const handlePickTrainAudio = async () => {
    const pick = await window.electronAPI?.pickRvcVoiceTrainAudio?.();
    if (pick && !pick.canceled && pick.filePath) {
      setTrainAudioPreview(pathToPreviewUrl(pick.filePath));
    }
  };

  const handlePickTrainAudioFromCanvas = useCallback(async () => {
    if (!requestVoicePickFromCanvas) return;
    setModalHiddenForCanvasPick(true);
    try {
      const payload = await requestVoicePickFromCanvas();
      const url = payload?.url?.trim();
      if (url) setTrainAudioPreview(url);
    } finally {
      setModalHiddenForCanvasPick(false);
    }
  }, [requestVoicePickFromCanvas]);

  const handleSubmit = async () => {
    if (!window.electronAPI || !editingId) return;
    const name = nickname.trim();
    if (!name) return;
    setSubmitting(true);
    try {
      const updated = (await window.electronAPI.updateRvcVoice(editingId, {
        nickname: name,
        rvcTrainModelName: name,
        avatarUrl: avatarPreview.trim(),
        trainAudioUrl: trainAudioPreview.trim(),
      })) as RvcVoiceLibraryItem;
      resetModal();
      loadItems();
      if (updated?.id) onRvcVoiceUpdated?.(updated);
    } catch (e) {
      console.error('[RvcVoiceLibraryList] save failed', e);
    } finally {
      setSubmitting(false);
    }
  };

  const renderGalleryCard = (item: RvcVoiceLibraryItem) => {
    const selected = selectedIds.has(item.id);
    const displayName = rvcVoiceDisplayName(item, t.rvcVoiceUntitled);
    const av = rvcVoiceAvatarUrl(item);
    const pkgOk = !!rvcVoiceModelPackageUrl(item);
    const firstLetter = displayName.charAt(0).toUpperCase() || 'R';

    return (
      <div
        key={item.id}
        draggable={pkgOk}
        onDragStart={(e) => handleDragStart(item, e)}
        onClick={() =>
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          })
        }
        className={`relative aspect-square rounded-xl overflow-hidden border cursor-pointer group ${
          selected
            ? assetLibGalleryCardSelected(isDarkMode)
            : isDarkMode
              ? 'border-white/10 bg-zinc-900/90'
              : 'border-gray-200 bg-gray-100'
        }`}
      >
        {av ? (
          <img
            src={av}
            alt=""
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            draggable={false}
          />
        ) : (
          <div
            className={`absolute inset-0 flex items-center justify-center ${
              isDarkMode ? 'bg-violet-950/80' : 'bg-violet-100'
            }`}
          >
            <span
              className={`text-2xl font-bold ${isDarkMode ? 'text-violet-300/70' : 'text-violet-600/80'}`}
            >
              {firstLetter}
            </span>
          </div>
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/75 to-transparent"
          aria-hidden
        />
        <span className="absolute bottom-1.5 left-1.5 z-[2] px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-black/55 text-white/90 backdrop-blur-sm">
          RVC
        </span>
        <p
          className="absolute bottom-1.5 right-1.5 z-[2] max-w-[72%] text-right text-xs font-medium leading-snug truncate text-white drop-shadow-sm"
          title={displayName}
        >
          {displayName}
        </p>
      </div>
    );
  };

  const renderListCard = (item: RvcVoiceLibraryItem) => {
    const selected = selectedIds.has(item.id);
    const displayName = rvcVoiceDisplayName(item, t.rvcVoiceUntitled);
    const av = rvcVoiceAvatarUrl(item);
    const pkgOk = !!rvcVoiceModelPackageUrl(item);
    const firstLetter = displayName.charAt(0).toUpperCase() || 'R';

    return (
      <div
        key={item.id}
        draggable={pkgOk}
        onDragStart={(e) => handleDragStart(item, e)}
        onClick={() =>
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          })
        }
        className={`group relative flex items-center p-3 rounded-xl transition-all cursor-pointer ${
          selected ? assetLibListCardSelected(isDarkMode) : assetLibListCard(isDarkMode)
        }`}
      >
        <div className="flex-shrink-0 relative rounded-full">
          {av ? (
            <img
              src={av}
              alt=""
              className="w-12 h-12 rounded-full object-cover border-2 border-zinc-600"
              draggable={false}
            />
          ) : (
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center border-2 border-zinc-600 ${
                isDarkMode ? 'bg-violet-500/15' : 'bg-violet-50'
              }`}
            >
              <span className={`text-sm font-bold ${isDarkMode ? 'text-violet-300' : 'text-violet-700'}`}>
                {firstLetter}
              </span>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0 ml-3">
          <div
            className={`character-card-title text-sm font-bold truncate ${isDarkMode ? 'text-white/90' : 'text-gray-900'}`}
            title={displayName}
          >
            {displayName}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-2">
          <button
            type="button"
            title={t.rvcVoiceEditTitle}
            className={`${assetLibBtnIcon(isDarkMode, 'control')} opacity-0 group-hover:opacity-100 transition-opacity`}
            onClick={(e) => {
              e.stopPropagation();
              openEditModal(item);
            }}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {onPlaceToCanvas && pkgOk ? (
            <button
              type="button"
              title={t.rvcVoicePlaceToCanvas}
              className={`${assetLibBtnIcon(isDarkMode, 'operators')} opacity-0 group-hover:opacity-100 transition-opacity`}
              onClick={(e) => {
                e.stopPropagation();
                onPlaceToCanvas(item);
              }}
            >
              <Upload className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const handleDragStart = useCallback((item: RvcVoiceLibraryItem, e: React.DragEvent) => {
    const pkgUrl = rvcVoiceModelPackageUrl(item);
    if (!pkgUrl) {
      e.preventDefault();
      return;
    }
    try {
      e.dataTransfer.setData(
        NEXFLOW_RVC_VOICE_DRAG_MIME,
        JSON.stringify({
          ...item,
          modelPackageUrl: pkgUrl,
        }),
      );
      e.dataTransfer.effectAllowed = 'copy';
    } catch (err) {
      console.error('[RvcVoiceLibraryList] drag failed', err);
      e.preventDefault();
    }
  }, []);

  const toolbar = (
    <div className={`flex items-center gap-1.5 px-2.5 py-2 border-b flex-shrink-0 ${isDarkMode ? 'border-white/10' : 'border-gray-200/80'}`}>
      <button
        type="button"
        onClick={handleImportZip}
        className={assetLibBtnSecondary(isDarkMode, 'flex-1 !py-1.5 text-xs gap-1 justify-center')}
        title={t.rvcVoiceImportTitle}
      >
        <Upload className="w-3.5 h-3.5" />
        {t.rvcVoiceImportTitle}
      </button>
      <button
        type="button"
        onClick={handleDeleteSelected}
        disabled={selectedIds.size === 0}
        className={assetLibDeleteToolbarBtn(isDarkMode, selectedIds.size > 0)}
        title={t.rvcVoiceDeleteSelected}
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );

  const body =
    items.length === 0 && !loading ? (
      <div className={`flex-1 flex items-center justify-center p-4 text-center text-xs leading-relaxed ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
        {t.rvcVoiceEmpty}
      </div>
    ) : viewMode === 'gallery' ? (
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 p-2">
        {items.map((item) => renderGalleryCard(item))}
      </div>
    ) : (
      <div className="space-y-2 p-2">
        {items.map((item) => renderListCard(item))}
      </div>
    );

  const modal =
    showModal &&
    !modalHiddenForCanvasPick &&
    createPortal(
      <div className={`fixed inset-0 z-[2000] flex items-center justify-center p-4 ${isDarkMode ? 'bg-black/55' : 'bg-violet-950/25 backdrop-blur-[2px]'}`}>
        <div
          className={`relative w-full max-w-md rounded-2xl border p-4 shadow-xl overflow-hidden ${
            isDarkMode
              ? 'bg-[#1a1a1e] border-white/10 shadow-black/40'
              : 'bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 border-violet-300/70 shadow-violet-400/25'
          }`}
        >
          {!isDarkMode ? (
            <>
              <div
                className="pointer-events-none absolute inset-x-0 top-0 h-1.5 rounded-t-2xl bg-gradient-to-r from-[var(--scratch-looks)] via-[var(--scratch-sound)] to-[var(--scratch-myBlocks)]"
                aria-hidden
              />
              <div className="pointer-events-none absolute -top-10 -right-10 h-36 w-36 rounded-full bg-fuchsia-300/35 blur-2xl" aria-hidden />
              <div className="pointer-events-none absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-violet-400/30 blur-2xl" aria-hidden />
            </>
          ) : null}
          <div className="relative flex items-center justify-between mb-3">
            <h3 className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-violet-900'}`}>{t.rvcVoiceEditTitle}</h3>
            <button type="button" onClick={resetModal} className={assetLibBtnIcon(isDarkMode, isDarkMode ? undefined : 'looks')}>
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="relative flex items-center gap-3 mb-4">
            <div className="relative">
              {avatarPreview ? (
                <img
                  src={avatarPreview}
                  alt=""
                  className={`w-16 h-16 rounded-full object-cover ${
                    isDarkMode ? 'border border-white/10' : 'ring-2 ring-[var(--scratch-looks)]/70 shadow-md shadow-violet-300/40'
                  }`}
                />
              ) : (
                <div
                  className={`w-16 h-16 rounded-full flex items-center justify-center ${
                    isDarkMode ? 'bg-violet-500/10' : 'bg-gradient-to-br from-violet-100 to-fuchsia-100 ring-2 ring-[var(--scratch-looks)]/45'
                  }`}
                >
                  <Package className={`w-8 h-8 ${isDarkMode ? 'text-violet-400' : 'text-[var(--scratch-looks)]'}`} />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <button
                type="button"
                onClick={handlePickAvatar}
                className={assetLibBtnPrimary(isDarkMode, 'text-xs !px-2.5 !py-1.5 gap-1', isDarkMode ? 'control' : 'looks')}
              >
                <ImagePlus className="w-3.5 h-3.5" />
                {t.rvcVoiceUploadAvatar}
              </button>
              {avatarPreview ? (
                <button
                  type="button"
                  onClick={() => setAvatarPreview('')}
                  className={`text-[11px] text-left hover:opacity-100 ${
                    isDarkMode ? 'text-white/70 opacity-60' : 'text-violet-700/80 opacity-80'
                  }`}
                >
                  {t.rvcVoiceClearAvatar}
                </button>
              ) : null}
            </div>
          </div>
          <label className={`block text-xs mb-1 font-medium ${isDarkMode ? 'opacity-70' : 'text-violet-800'}`}>
            {t.rvcVoiceRenameLabel}
          </label>
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            className={`w-full mb-4 px-2 py-1.5 rounded-lg text-sm border outline-none transition-shadow ${
              isDarkMode
                ? 'bg-black/30 border-white/10 text-white placeholder:text-white/35'
                : 'bg-white/90 border-violet-300/65 text-violet-950 placeholder:text-violet-400/65 focus:border-[var(--scratch-looks)] focus:ring-2 focus:ring-violet-300/45'
            }`}
            placeholder={t.rvcVoiceNicknamePlaceholder}
          />
          <div className="relative mb-4">
            <label
              className={`block text-xs mb-1.5 font-semibold ${
                isDarkMode ? 'opacity-70' : 'text-[var(--scratch-sound)]'
              }`}
            >
              {t.rvcVoiceTrainAudioLabel}
            </label>
            {trainAudioPreview ? (
              <div
                className={`rounded-xl overflow-hidden mb-2 ${
                  isDarkMode ? '' : 'ring-1 ring-[var(--scratch-sound)]/35 shadow-sm shadow-fuchsia-200/50'
                }`}
              >
                <ReferenceAudioWaveStrip src={trainAudioPreview} isDarkMode={isDarkMode} />
              </div>
            ) : (
              <div
                className={`rounded-xl border border-dashed px-3 py-6 text-center text-xs mb-2 ${
                  isDarkMode
                    ? 'border-white/15 text-white/40'
                    : 'border-[var(--scratch-sound)]/55 bg-fuchsia-50/90 text-fuchsia-800/75'
                }`}
              >
                {t.rvcVoiceTrainAudioLabel}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handlePickTrainAudio()}
                className={assetLibBtnPrimary(isDarkMode, 'text-xs !px-2.5 !py-1.5 gap-1', isDarkMode ? 'control' : 'sound')}
              >
                <Upload className="w-3.5 h-3.5" />
                {t.rvcVoiceUploadTrainAudio}
              </button>
              {requestVoicePickFromCanvas ? (
                <button
                  type="button"
                  onClick={() => void handlePickTrainAudioFromCanvas()}
                  className={assetLibBtnPrimary(isDarkMode, 'text-xs !px-2.5 !py-1.5 gap-1', isDarkMode ? 'events' : 'events')}
                >
                  <Layers className="w-3.5 h-3.5" />
                  {t.rvcVoicePickTrainAudioFromCanvas}
                </button>
              ) : null}
              {trainAudioPreview ? (
                <button
                  type="button"
                  onClick={() => setTrainAudioPreview('')}
                  className={`text-[11px] hover:opacity-100 ${
                    isDarkMode ? 'text-white/70 opacity-60' : 'text-fuchsia-800/75 opacity-80'
                  }`}
                >
                  {t.rvcVoiceClearTrainAudio}
                </button>
              ) : null}
            </div>
          </div>
          <div className="relative flex justify-end gap-2">
            <button
              type="button"
              onClick={resetModal}
              className={assetLibBtnSecondary(isDarkMode, 'text-xs !px-3 !py-1.5', isDarkMode ? undefined : 'sensing')}
            >
              {t.rvcVoiceCancel}
            </button>
            <button
              type="button"
              disabled={submitting || !nickname.trim()}
              onClick={handleSubmit}
              className={assetLibBtnPrimary(isDarkMode, 'text-xs !px-3 !py-1.5', isDarkMode ? 'control' : 'looks')}
            >
              {submitting ? t.rvcVoiceSaving : t.rvcVoiceSave}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {toolbar}
      <div ref={listScrollRef} className="flex-1 min-h-0 overflow-y-auto nexflow-scrollbar">
        {loading ? (
          <div className={`p-4 text-center text-xs ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>…</div>
        ) : (
          body
        )}
      </div>
      {modal}
    </div>
  );
};

export default RvcVoiceLibraryList;
