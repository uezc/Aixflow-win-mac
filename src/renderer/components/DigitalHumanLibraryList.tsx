// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Plus, X, Pencil, Video, Layers, Upload } from 'lucide-react';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { assetLibraryT } from '../i18n/assetLibraryI18n';
import type { AssetLibraryViewMode } from './AssetLibrarySidebar';
import {
  NEXFLOW_DIGITAL_HUMAN_DRAG_MIME,
  digitalHumanPosterUrl,
  digitalHumanVideoUrl,
  type DigitalHumanLibraryItem,
} from './characterListShared';
import {
  assetLibBtnIcon,
  assetLibBtnPrimary,
  assetLibBtnSecondary,
  assetLibDeleteToolbarBtn,
  assetLibCardActionBtn,
  assetLibGalleryCardSelected,
  assetLibListCard,
  assetLibListCardSelected,
  assetLibMsgSuccess,
  assetLibEditModalBackdrop,
  assetLibEditModalPanel,
  assetLibEditModalTitle,
  assetLibEditModalLabel,
  assetLibEditModalInput,
  assetLibEditModalCloseScratch,
  assetLibEditModalCancelScratch,
  assetLibEditModalSaveScratch,
  assetLibEditModalPrimaryScratch,
  assetLibEditModalSecondaryActionScratch,
  assetLibEditModalCanvasPickScratch,
} from '../utils/assetLibraryChrome';
import { toElectronVideoElementSrc } from '../utils/normalizeVideoUrl';
import DigitalHumanLibraryVideoHoverPreview from './DigitalHumanLibraryVideoHoverPreview';
import { useIdlePoll } from '../hooks/useIdlePoll';

const GALLERY_HOVER_DELAY_MS = 220;

/** 画廊卡片内：悬停时在卡片上播放参考视频 */
const DigitalHumanGalleryCardVideo: React.FC<{ active: boolean; src: string }> = ({ active, src }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !src) return;
    if (active) {
      v.volume = 1;
      v.muted = false;
      v.currentTime = 0;
      void v.play().catch(() => {
        v.muted = true;
        void v.play().catch(() => undefined);
      });
    } else {
      v.pause();
      v.muted = true;
    }
  }, [active, src]);

  if (!active || !src) return null;

  return (
    <video
      ref={videoRef}
      src={src}
      className="absolute inset-0 z-[1] h-full w-full object-contain bg-black"
      loop
      playsInline
      preload="metadata"
    />
  );
};

/** 数字人参考视频默认竖屏比例（宽/高） */
const PORTRAIT_VIDEO_ASPECT = 9 / 16;
const MODAL_PREVIEW_MAX_W = 240;

function pathToPreviewUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (m) => m.substring(1));
  return `local-resource://${normalized}`;
}

export interface DigitalHumanLibraryListProps {
  isDarkMode: boolean;
  viewMode?: AssetLibraryViewMode;
  refreshTrigger?: number;
  /** 当前 Tab 可见且侧栏展开时才后台轮询 */
  listActive?: boolean;
  requestVideoPickFromCanvas?: () => Promise<string | null>;
  onPlaceToCanvas?: (item: DigitalHumanLibraryItem) => void;
}

const DigitalHumanLibraryList: React.FC<DigitalHumanLibraryListProps> = ({
  isDarkMode,
  viewMode = 'list',
  refreshTrigger,
  listActive = true,
  requestVideoPickFromCanvas,
  onPlaceToCanvas,
}) => {
  const { locale } = useAppLocale();
  const t = assetLibraryT(locale);
  const [items, setItems] = useState<DigitalHumanLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [videoPreview, setVideoPreview] = useState('');
  const [previewAspect, setPreviewAspect] = useState(PORTRAIT_VIDEO_ASPECT);
  const [submitting, setSubmitting] = useState(false);
  const [modalHint, setModalHint] = useState<string | null>(null);
  const [modalHiddenForCanvasPick, setModalHiddenForCanvasPick] = useState(false);
  const [videoHover, setVideoHover] = useState<{ item: DigitalHumanLibraryItem; rect: DOMRect } | null>(null);
  const [galleryHoveredId, setGalleryHoveredId] = useState<string | null>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const galleryHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadItems = useCallback(async () => {
    try {
      if (window.electronAPI?.getDigitalHumans) {
        const list = await window.electronAPI.getDigitalHumans();
        setItems(list.sort((a, b) => b.createdAt - a.createdAt));
      }
    } catch (e) {
      console.error('[DigitalHumanLibraryList] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems, refreshTrigger]);

  useIdlePoll(listActive, loadItems, 20000);

  useEffect(() => {
    return () => {
      if (galleryHoverTimerRef.current) clearTimeout(galleryHoverTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (viewMode === 'gallery') setVideoHover(null);
    else setGalleryHoveredId(null);
  }, [viewMode]);

  useEffect(() => {
    if (!videoHover && !galleryHoveredId) return;
    const el = listScrollRef.current;
    const hide = () => {
      setVideoHover(null);
      setGalleryHoveredId(null);
    };
    el?.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('scroll', hide, true);
    return () => {
      el?.removeEventListener('scroll', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [videoHover, galleryHoveredId]);

  const bindVideoHover = useCallback(
    (item: DigitalHumanLibraryItem, videoOk: boolean) =>
      viewMode === 'list'
        ? {
            onMouseEnter: videoOk
              ? (e: React.MouseEvent<HTMLElement>) => {
                  setVideoHover({
                    item,
                    rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                  });
                }
              : undefined,
            onMouseLeave: videoOk ? () => setVideoHover(null) : undefined,
          }
        : {},
    [viewMode],
  );

  const renderGalleryCard = (item: DigitalHumanLibraryItem) => {
    const thumb = digitalHumanPosterUrl(item);
    const videoUrl = digitalHumanVideoUrl(item);
    const videoOk = !!videoUrl;
    const displaySrc = videoOk ? toElectronVideoElementSrc(videoUrl) || videoUrl : '';
    const selected = selectedIds.has(item.id);
    const isHovered = galleryHoveredId === item.id;
    const displayName = (item.nickname || item.name || t.dhUntitled).trim();

    return (
      <div
        key={item.id}
        draggable={videoOk}
        onDragStart={(e) => handleDragStart(item, e)}
        onClick={() =>
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          })
        }
        onMouseEnter={
          videoOk
            ? () => {
                if (galleryHoverTimerRef.current) clearTimeout(galleryHoverTimerRef.current);
                galleryHoverTimerRef.current = setTimeout(() => {
                  setGalleryHoveredId(item.id);
                  galleryHoverTimerRef.current = null;
                }, GALLERY_HOVER_DELAY_MS);
              }
            : undefined
        }
        onMouseLeave={
          videoOk
            ? () => {
                if (galleryHoverTimerRef.current) {
                  clearTimeout(galleryHoverTimerRef.current);
                  galleryHoverTimerRef.current = null;
                }
                setGalleryHoveredId((id) => (id === item.id ? null : id));
              }
            : undefined
        }
        className={`relative aspect-[9/16] rounded-xl overflow-hidden border cursor-pointer group ${
          selected
            ? assetLibGalleryCardSelected(isDarkMode)
            : isDarkMode
              ? 'border-white/10 bg-zinc-900/90'
              : 'border-gray-200 bg-gray-100'
        }`}
        title={videoOk ? t.dhDragHint : undefined}
      >
        {videoOk ? (
          <DigitalHumanGalleryCardVideo active={isHovered} src={displaySrc} />
        ) : null}
        {!isHovered && thumb ? (
          thumb.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
            <video
              src={toElectronVideoElementSrc(thumb) || thumb}
              className="absolute inset-0 z-0 h-full w-full object-cover"
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            <img src={thumb} alt="" className="absolute inset-0 z-0 h-full w-full object-cover" draggable={false} />
          )
        ) : !isHovered && videoOk ? (
          <video
            src={displaySrc}
            className="absolute inset-0 z-0 h-full w-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
        ) : !videoOk ? (
          <div className="absolute inset-0 z-0 flex items-center justify-center">
            <Video className={`w-10 h-10 ${isDarkMode ? 'text-white/20' : 'text-gray-300'}`} />
          </div>
        ) : null}
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-16 bg-gradient-to-t from-black/75 to-transparent transition-opacity duration-150 ${
            isHovered ? 'opacity-90' : 'opacity-100'
          }`}
          aria-hidden
        />
        <p
          className="absolute bottom-1.5 inset-x-2 z-[2] text-xs font-medium leading-snug truncate text-white drop-shadow-sm"
          title={displayName}
        >
          {displayName}
        </p>
        <div className="absolute top-1.5 right-1.5 z-[3] flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => openEditModal(item, e)}
            className={`${assetLibCardActionBtn(isDarkMode, 'control')} opacity-0 group-hover:opacity-100 transition-opacity`}
            title={t.dhEditTitle}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {onPlaceToCanvas && videoOk ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPlaceToCanvas(item);
              }}
              className={`${assetLibCardActionBtn(isDarkMode, 'operators')} opacity-0 group-hover:opacity-100 transition-opacity`}
              title={t.dhPlaceOnCanvas}
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const resetModal = useCallback(() => {
    setEditingId(null);
    setNickname('');
    setVideoPreview('');
    setPreviewAspect(PORTRAIT_VIDEO_ASPECT);
    setModalHiddenForCanvasPick(false);
    setModalHint(null);
  }, []);

  const openAddModal = useCallback(() => {
    resetModal();
    setShowModal(true);
  }, [resetModal]);

  const openEditModal = useCallback((item: DigitalHumanLibraryItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingId(item.id);
    setNickname((item.nickname || item.name || '').trim());
    setVideoPreview(digitalHumanVideoUrl(item));
    setPreviewAspect(PORTRAIT_VIDEO_ASPECT);
    setShowModal(true);
  }, []);

  const pickLocalVideo = useCallback(async () => {
    if (!window.electronAPI?.showOpenVideoDialog) {
      setModalHint(t.dhUploadVideoUnavailable);
      return;
    }
    const res = await window.electronAPI.showOpenVideoDialog();
    if (!res.success || !res.filePath) return;
    setModalHint(null);
    setVideoPreview(pathToPreviewUrl(res.filePath));
    setPreviewAspect(PORTRAIT_VIDEO_ASPECT);
  }, [t.dhUploadVideoUnavailable]);

  const pickVideoFromCanvas = useCallback(async () => {
    if (!requestVideoPickFromCanvas) return;
    setModalHiddenForCanvasPick(true);
    try {
      const url = await requestVideoPickFromCanvas();
      if (url) {
        setVideoPreview(url);
        setPreviewAspect(PORTRAIT_VIDEO_ASPECT);
      }
    } finally {
      setModalHiddenForCanvasPick(false);
    }
  }, [requestVideoPickFromCanvas]);

  const handleSave = useCallback(async () => {
    const video = videoPreview.trim();
    if (!video) {
      setMsg(t.dhNeedVideo);
      setTimeout(() => setMsg(null), 2500);
      return;
    }
    setSubmitting(true);
    try {
      const nick = nickname.trim();
      const payload = {
        ...(nick ? { nickname: nick } : {}),
        videoUrl: video,
      };
      if (editingId && window.electronAPI?.updateDigitalHuman) {
        await window.electronAPI.updateDigitalHuman(editingId, payload);
      } else if (window.electronAPI?.registerDigitalHuman) {
        await window.electronAPI.registerDigitalHuman(payload);
      } else {
        throw new Error(t.dhSaveNotReady);
      }
      setMsg(t.dhSaved);
      setShowModal(false);
      resetModal();
      await loadItems();
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t.dhSaveFailed);
      setTimeout(() => setMsg(null), 3000);
    } finally {
      setSubmitting(false);
    }
  }, [editingId, loadItems, nickname, resetModal, t, videoPreview]);

  const handleDeleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || !window.electronAPI?.deleteDigitalHumans) return;
    await window.electronAPI.deleteDigitalHumans(ids);
    setSelectedIds(new Set());
    await loadItems();
  }, [loadItems, selectedIds]);

  const handleDragStart = useCallback((item: DigitalHumanLibraryItem, e: React.DragEvent) => {
    const videoUrl = digitalHumanVideoUrl(item);
    if (!videoUrl) {
      e.preventDefault();
      return;
    }
    try {
      e.dataTransfer.setData(
        NEXFLOW_DIGITAL_HUMAN_DRAG_MIME,
        JSON.stringify({
          ...item,
          videoUrl,
          poster: digitalHumanPosterUrl(item),
        }),
      );
      e.dataTransfer.effectAllowed = 'copy';
    } catch (err) {
      console.error('[DigitalHumanLibraryList] drag failed', err);
      e.preventDefault();
    }
  }, []);

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  const renderRow = (item: DigitalHumanLibraryItem) => {
    const thumb = digitalHumanPosterUrl(item);
    const videoOk = !!digitalHumanVideoUrl(item);
    const selected = selectedIds.has(item.id);

    return (
      <div
        key={item.id}
        draggable={videoOk}
        onDragStart={(e) => handleDragStart(item, e)}
        onClick={() =>
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(item.id)) next.delete(item.id);
            else next.add(item.id);
            return next;
          })
        }
        {...bindVideoHover(item, videoOk)}
        className={`group flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors ${
          selected
            ? assetLibListCardSelected(isDarkMode)
            : assetLibListCard(isDarkMode)
        }`}
        title={videoOk ? t.dhHoverVideoPreview : t.dhDragHint}
      >
        <div
          className={`w-10 h-10 rounded-full overflow-hidden shrink-0 border ${
            isDarkMode ? 'border-white/15 bg-black/50' : 'border-gray-200 bg-gray-100'
          }`}
        >
          {thumb ? (
            thumb.match(/\.(mp4|webm|mov)(\?|$)/i) ? (
              <video src={thumb} className="w-full h-full object-cover" muted playsInline preload="metadata" />
            ) : (
              <img src={thumb} alt="" className="w-full h-full object-cover" draggable={false} />
            )
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Video className={`w-4 h-4 ${isDarkMode ? 'text-white/30' : 'text-gray-400'}`} />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium truncate ${isDarkMode ? 'text-white/90' : 'text-gray-900'}`}>
            {(item.nickname || item.name || t.dhUntitled).trim()}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => openEditModal(item, e)}
            className={`${assetLibCardActionBtn(isDarkMode, 'control')} opacity-0 group-hover:opacity-100 transition-opacity`}
            title={t.dhEditTitle}
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {onPlaceToCanvas && videoOk ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPlaceToCanvas(item);
              }}
              className={`${assetLibCardActionBtn(isDarkMode, 'operators')} opacity-0 group-hover:opacity-100 transition-opacity`}
              title={t.dhPlaceOnCanvas}
            >
              <Layers className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className={`flex-1 flex items-center justify-center text-sm ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
        加载中…
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className={`px-3 py-2 border-b flex items-center justify-between gap-2 flex-shrink-0 ${
          isDarkMode ? 'border-white/10' : 'border-gray-200'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {items.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => void handleDeleteSelected()}
                disabled={selectedIds.size === 0}
                className={assetLibDeleteToolbarBtn(isDarkMode, selectedIds.size > 0)}
                title={t.dhDeleteSelected}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(allSelected ? new Set() : new Set(items.map((s) => s.id)))}
                className={`text-xs ${assetLibBtnSecondary(isDarkMode, '!py-0.5 !px-2', isDarkMode ? undefined : 'operators')}`}
              >
                {allSelected ? t.roleDeselectAll : t.roleSelectAll}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={openAddModal}
            className={`text-xs flex items-center gap-1.5 shrink-0 ${assetLibBtnPrimary(isDarkMode, '!py-0.5 !px-2', 'control')}`}
            title={t.dhAddTitle}
          >
            <span
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed ${
                isDarkMode ? 'border-white/30 text-white/55' : 'border-white/55 text-white/90'
              }`}
            >
              <Plus className="w-3 h-3" strokeWidth={2.5} />
            </span>
            {t.dhAdd}
          </button>
        </div>
      </div>

      {msg ? (
        <div className={`px-3 py-1.5 text-xs ${assetLibMsgSuccess(isDarkMode)}`}>{msg}</div>
      ) : null}

      <div
        ref={listScrollRef}
        className={`flex-1 min-h-0 overflow-y-auto ${viewMode === 'gallery' ? 'px-4 pb-4' : 'px-2 py-2 space-y-1.5'} ${
          isDarkMode ? 'custom-scrollbar-dark' : 'custom-scrollbar'
        }`}
      >
        {items.length === 0 ? (
          <div className={`text-center text-xs py-8 px-4 ${isDarkMode ? 'text-white/45' : 'text-gray-500'}`}>
            {t.dhEmpty}
          </div>
        ) : viewMode === 'gallery' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {items.map(renderGalleryCard)}
          </div>
        ) : (
          items.map(renderRow)
        )}
      </div>

      {viewMode === 'list' && videoHover ? (
        <DigitalHumanLibraryVideoHoverPreview
          item={videoHover.item}
          anchorRect={videoHover.rect}
          isDarkMode={isDarkMode}
        />
      ) : null}

      {showModal && !modalHiddenForCanvasPick &&
        createPortal(
          <div
            className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 ${assetLibEditModalBackdrop(isDarkMode)}`}
            onClick={() => {
              if (submitting) return;
              setShowModal(false);
              resetModal();
            }}
          >
            <div
              className={`relative w-full max-w-md rounded-2xl border shadow-xl p-4 overflow-hidden ${assetLibEditModalPanel(isDarkMode)}`}
              onClick={(e) => e.stopPropagation()}
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
                <h3 className={`text-sm font-semibold ${assetLibEditModalTitle(isDarkMode)}`}>
                  {editingId ? t.dhEditTitle : t.dhAddTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className={assetLibBtnIcon(isDarkMode, assetLibEditModalCloseScratch(isDarkMode))}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <label className={`block text-xs mb-1 font-medium ${assetLibEditModalLabel(isDarkMode)}`}>
                {t.dhNickname}
              </label>
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder={t.dhNicknamePlaceholder}
                className={`w-full mb-3 px-2 py-1.5 text-sm rounded-lg border outline-none transition-shadow ${assetLibEditModalInput(isDarkMode)}`}
              />
              <span className={`block text-xs font-semibold mb-2 ${isDarkMode ? 'text-white/75' : 'text-[var(--scratch-sound)]'}`}>
                {t.dhReferenceVideo}
              </span>
              <div className="relative flex justify-center mb-3">
                <div
                  className={`relative w-full rounded-xl overflow-hidden border ${
                    isDarkMode ? 'border-white/15 bg-black/40' : 'ring-1 ring-[var(--scratch-sound)]/35 shadow-sm shadow-fuchsia-200/50 border-violet-200/60 bg-fuchsia-50/40'
                  }`}
                  style={{
                    maxWidth: MODAL_PREVIEW_MAX_W,
                    aspectRatio: previewAspect,
                    maxHeight: 'min(420px, 55vh)',
                  }}
                >
                  {videoPreview ? (
                    <video
                      src={toElectronVideoElementSrc(videoPreview) || videoPreview}
                      className="absolute inset-0 h-full w-full object-contain"
                      muted
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(e) => {
                        const v = e.currentTarget;
                        if (v.videoWidth > 0 && v.videoHeight > 0) {
                          setPreviewAspect(v.videoWidth / v.videoHeight);
                        }
                      }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Video className={`w-8 h-8 ${isDarkMode ? 'text-white/25' : 'text-[var(--scratch-sound)]/45'}`} />
                    </div>
                  )}
                </div>
              </div>
              {modalHint ? (
                <p className={`relative mb-2 text-xs ${isDarkMode ? 'text-amber-300/90' : 'text-fuchsia-800/75'}`}>{modalHint}</p>
              ) : null}
              <div className="relative flex flex-row flex-wrap gap-2 mb-4">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void pickLocalVideo()}
                  className={`flex-1 py-2 px-2 text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5 ${assetLibBtnPrimary(
                    isDarkMode,
                    '!w-auto flex-1',
                    assetLibEditModalSecondaryActionScratch(isDarkMode),
                  )}`}
                >
                  <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  {t.dhUploadVideo}
                </button>
                {requestVideoPickFromCanvas ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void pickVideoFromCanvas()}
                    className={`flex-1 py-2 px-2 text-xs font-medium disabled:opacity-50 inline-flex items-center justify-center gap-1.5 ${assetLibBtnPrimary(
                      isDarkMode,
                      '!w-auto flex-1',
                      assetLibEditModalCanvasPickScratch(isDarkMode, 1),
                    )}`}
                  >
                    <Layers className="w-3.5 h-3.5 shrink-0" aria-hidden />
                    {t.dhPickVideoFromCanvas}
                  </button>
                ) : null}
              </div>
              <div className="relative flex justify-end gap-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setShowModal(false)}
                  className={assetLibBtnSecondary(
                    isDarkMode,
                    'text-xs !px-3 !py-1.5',
                    assetLibEditModalCancelScratch(isDarkMode),
                  )}
                >
                  {t.sceneCancel}
                </button>
                <button
                  type="button"
                  disabled={submitting || !videoPreview.trim()}
                  onClick={() => void handleSave()}
                  className={assetLibBtnPrimary(
                    isDarkMode,
                    'text-xs !px-3 !py-1.5',
                    assetLibEditModalSaveScratch(isDarkMode),
                  )}
                >
                  {submitting ? t.roleSaving : t.sceneSave}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default DigitalHumanLibraryList;
