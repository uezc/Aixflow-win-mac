// @ts-nocheck
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, Mountain, Plus, X, Pencil, Upload, Download, LayoutGrid } from 'lucide-react';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { assetLibraryT } from '../i18n/assetLibraryI18n';
import type { AssetLibraryViewMode } from './AssetLibrarySidebar';
import {
  NEXFLOW_SCENE_DRAG_MIME,
  sceneDisplay3dImageUrl,
  sceneNormalImageUrl,
  type SceneLibraryItem,
} from './characterListShared';
import SceneLibraryPanoramaHoverPreview from './SceneLibraryPanoramaHoverPreview';
import AssetLibLazyThumb from './AssetLibLazyThumb';
import {
  assetLibBtnIcon,
  assetLibBtnPrimary,
  assetLibBtnSecondary,
  assetLibDeleteToolbarBtn,
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
  assetLibEditModalSecondaryActionScratch,
  assetLibEditModalCanvasPickScratch,
} from '../utils/assetLibraryChrome';
import { useIdlePoll } from '../hooks/useIdlePoll';

function scenePanoramaUrlForCanvas(scene: SceneLibraryItem): string {
  return sceneDisplay3dImageUrl(scene);
}

function sceneThumbUrl(scene: SceneLibraryItem): string {
  return sceneNormalImageUrl(scene);
}

function pathToPreviewUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (m) => m.substring(1));
  return `local-resource://${normalized}`;
}

export interface SceneLibraryListProps {
  isDarkMode: boolean;
  viewMode?: AssetLibraryViewMode;
  refreshTrigger?: number;
  /** 当前 Tab 可见且侧栏展开时才后台轮询 */
  listActive?: boolean;
  onSelectScene?: (scene: SceneLibraryItem) => void;
  requestSceneImagePickFromCanvas?: (role: 'normal' | 'display3d') => Promise<string | null>;
}

const SceneLibraryList: React.FC<SceneLibraryListProps> = ({
  isDarkMode,
  viewMode = 'list',
  refreshTrigger,
  listActive = true,
  onSelectScene,
  requestSceneImagePickFromCanvas,
  onPlaceSceneToCanvas,
}) => {
  const { locale } = useAppLocale();
  const t = assetLibraryT(locale);
  const [scenes, setScenes] = useState<SceneLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const [exportImportMsg, setExportImportMsg] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [normalPreview, setNormalPreview] = useState('');
  const [display3dPreview, setDisplay3dPreview] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /** 画布点选期间隐藏弹窗，保留已填表单 */
  const [modalHiddenForCanvasPick, setModalHiddenForCanvasPick] = useState(false);
  const [scenePanoramaHover, setScenePanoramaHover] = useState<{
    scene: SceneLibraryItem;
    rect: DOMRect;
  } | null>(null);
  const [gallerySearch, setGallerySearch] = useState('');
  const sceneListScrollRef = useRef<HTMLDivElement>(null);

  const galleryFilteredScenes = React.useMemo(() => {
    const q = gallerySearch.trim().toLowerCase();
    if (!q) return scenes;
    return scenes.filter((s) => `${s.nickname || ''} ${s.name || ''}`.toLowerCase().includes(q));
  }, [scenes, gallerySearch]);

  const loadScenes = useCallback(async () => {
    try {
      if (window.electronAPI?.getScenes) {
        const list = await Promise.race([
          window.electronAPI.getScenes(),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error('getScenes timeout')), 12000);
          }),
        ]);
        setScenes(list.sort((a, b) => b.createdAt - a.createdAt));
      }
    } catch (e) {
      console.error('[SceneLibraryList] load failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadScenes();
  }, [loadScenes, refreshTrigger]);

  useIdlePoll(listActive, loadScenes, 60000);

  useEffect(() => {
    if (!scenePanoramaHover) return;
    const el = sceneListScrollRef.current;
    const hide = () => setScenePanoramaHover(null);
    el?.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('scroll', hide, true);
    return () => {
      el?.removeEventListener('scroll', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [scenePanoramaHover]);

  const resetModal = useCallback(() => {
    setEditingSceneId(null);
    setNickname('');
    setNormalPreview('');
    setDisplay3dPreview('');
    setModalHiddenForCanvasPick(false);
  }, []);

  const openAddModal = useCallback(() => {
    resetModal();
    setShowModal(true);
  }, [resetModal]);

  const openEditModal = useCallback((scene: SceneLibraryItem, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingSceneId(scene.id);
    setNickname((scene.nickname || scene.name || '').trim());
    setNormalPreview(sceneNormalImageUrl(scene));
    setDisplay3dPreview(sceneDisplay3dImageUrl(scene));
    setShowModal(true);
  }, []);

  const pickLocalImage = useCallback(
    async (role: 'normal' | 'display3d') => {
      if (!window.electronAPI?.pickSceneImage) return;
      const pick = await window.electronAPI.pickSceneImage(role);
      if (pick.canceled || !pick.filePath) return;
      const url = pathToPreviewUrl(pick.filePath);
      if (role === 'normal') setNormalPreview(url);
      else setDisplay3dPreview(url);
    },
    [],
  );

  const pickFromCanvas = useCallback(
    async (role: 'normal' | 'display3d') => {
      if (!requestSceneImagePickFromCanvas) return;
      setModalHiddenForCanvasPick(true);
      try {
        const url = await requestSceneImagePickFromCanvas(role);
        if (!url) return;
        if (role === 'normal') setNormalPreview(url);
        else setDisplay3dPreview(url);
      } finally {
        setModalHiddenForCanvasPick(false);
      }
    },
    [requestSceneImagePickFromCanvas],
  );

  const handleSaveScene = useCallback(async () => {
    const normal = normalPreview.trim();
    const display3d = display3dPreview.trim();
    if (!normal || !display3d) {
      setMsg(t.sceneNeedBothImages);
      setTimeout(() => setMsg(null), 2500);
      return;
    }
    setSubmitting(true);
    try {
      const nick = nickname.trim();
      if (editingSceneId && window.electronAPI?.updateScene) {
        await window.electronAPI.updateScene(editingSceneId, {
          ...(nick ? { nickname: nick } : {}),
          normalImageUrl: normal,
          display3dImageUrl: display3d,
        });
      } else if (window.electronAPI?.registerScene) {
        await window.electronAPI.registerScene({
          nickname: nick || undefined,
          normalImageUrl: normal,
          display3dImageUrl: display3d,
        });
      }
      setMsg(t.sceneSaved);
      setShowModal(false);
      resetModal();
      await loadScenes();
      setTimeout(() => setMsg(null), 2000);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t.sceneSaveFailed);
      setTimeout(() => setMsg(null), 3000);
    } finally {
      setSubmitting(false);
    }
  }, [display3dPreview, editingSceneId, loadScenes, nickname, normalPreview, resetModal, t]);

  const handleDeleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length || !window.electronAPI?.deleteScenes) return;
    await window.electronAPI.deleteScenes(ids);
    setSelectedIds(new Set());
    await loadScenes();
  }, [loadScenes, selectedIds]);

  const handleExportScenes = useCallback(async () => {
    try {
      if (!window.electronAPI?.exportScenes) {
        setExportImportMsg(t.sceneExportNotReady);
        setTimeout(() => setExportImportMsg(null), 3000);
        return;
      }
      const ids = Array.from(selectedIds);
      if (ids.length === 0) {
        setExportImportMsg(t.sceneSelectToExport);
        setTimeout(() => setExportImportMsg(null), 2000);
        return;
      }
      const res = await window.electronAPI.exportScenes(ids);
      if (res.success) {
        const n = res.count ?? ids.length;
        setExportImportMsg(
          n > 1 ? t.sceneExportedMulti.replace('{n}', String(n)) : t.sceneExported,
        );
        setTimeout(() => setExportImportMsg(null), 2000);
      } else if (res.error && !res.error.includes('取消')) {
        setExportImportMsg(res.error);
        setTimeout(() => setExportImportMsg(null), 3000);
      }
    } catch (e) {
      setExportImportMsg(e instanceof Error ? e.message : t.sceneExportFailed);
      setTimeout(() => setExportImportMsg(null), 3000);
    }
  }, [selectedIds, t]);

  const handleImportScenes = useCallback(async () => {
    try {
      if (!window.electronAPI?.importScenes) {
        setExportImportMsg(t.sceneExportNotReady);
        setTimeout(() => setExportImportMsg(null), 3000);
        return;
      }
      const res = await window.electronAPI.importScenes();
      if (res.canceled) return;
      if (res.success && res.count != null && res.count > 0) {
        setExportImportMsg(t.sceneImportedCount.replace('{n}', String(res.count)));
        await loadScenes();
        setTimeout(() => setExportImportMsg(null), 2000);
      } else if (res.error && !res.error.includes('取消')) {
        setExportImportMsg(res.error);
        setTimeout(() => setExportImportMsg(null), 3000);
      }
    } catch (e) {
      setExportImportMsg(e instanceof Error ? e.message : t.sceneAixflowImportFailed);
      setTimeout(() => setExportImportMsg(null), 3000);
    }
  }, [loadScenes, t]);

  const handleDragStart = useCallback((scene: SceneLibraryItem, e: React.DragEvent) => {
    const normalUrl = sceneNormalImageUrl(scene);
    const displayUrl = sceneDisplay3dImageUrl(scene);
    if (!normalUrl) {
      e.preventDefault();
      return;
    }
    try {
      e.dataTransfer.setData(
        NEXFLOW_SCENE_DRAG_MIME,
        JSON.stringify({
          ...scene,
          normalImageUrl: normalUrl,
          display3dImageUrl: displayUrl,
          panoramaUrl: displayUrl,
          avatar: sceneThumbUrl(scene) || normalUrl,
        }),
      );
      e.dataTransfer.effectAllowed = 'copy';
    } catch (err) {
      console.error('[SceneLibraryList] drag failed', err);
      e.preventDefault();
    }
  }, []);

  const allSelected = scenes.length > 0 && selectedIds.size === scenes.length;

  const slotBlock = (role: 'normal' | 'display3d', preview: string, label: string) => (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <span
        className={`text-xs font-semibold leading-tight ${
          isDarkMode ? 'text-white/75' : role === 'normal' ? 'text-[var(--scratch-looks)]' : 'text-[var(--scratch-sound)]'
        }`}
      >
        {label}
      </span>
      <div
        className={`relative h-[7.5rem] w-full rounded-xl overflow-hidden border shrink-0 ${
          isDarkMode
            ? 'border-white/15 bg-black/40'
            : role === 'normal'
              ? 'ring-1 ring-[var(--scratch-looks)]/35 shadow-sm shadow-violet-200/50 border-violet-200/60 bg-violet-50/30'
              : 'ring-1 ring-[var(--scratch-sound)]/35 shadow-sm shadow-fuchsia-200/50 border-fuchsia-200/60 bg-fuchsia-50/40'
        }`}
      >
        {preview ? (
          <img src={preview} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Mountain
              className={`w-7 h-7 ${
                isDarkMode ? 'text-white/25' : role === 'normal' ? 'text-[var(--scratch-looks)]/45' : 'text-[var(--scratch-sound)]/45'
              }`}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={submitting}
          onClick={() => void pickLocalImage(role)}
          className={`w-full py-1.5 px-2 text-xs font-medium disabled:opacity-50 ${assetLibBtnPrimary(
            isDarkMode,
            '!w-full !py-1.5',
            assetLibEditModalSecondaryActionScratch(isDarkMode),
          )}`}
        >
          {role === 'normal' ? t.sceneUploadNormal : t.sceneUploadDisplay3d}
        </button>
        {requestSceneImagePickFromCanvas ? (
          <button
            type="button"
            disabled={submitting}
            onClick={() => void pickFromCanvas(role)}
            className={`w-full py-1.5 px-2 text-xs font-medium disabled:opacity-50 ${assetLibBtnPrimary(
              isDarkMode,
              '!w-full !py-1.5',
              assetLibEditModalCanvasPickScratch(isDarkMode, role === 'normal' ? 1 : 2),
            )}`}
          >
            {t.scenePickFromCanvas}
          </button>
        ) : null}
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className={`flex-1 flex items-center justify-center text-sm ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}>
        加载中…
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className={`px-3 py-2 border-b flex items-center justify-between gap-2 flex-shrink-0 ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="flex items-center gap-2 min-w-0">
          {scenes.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={selectedIds.size === 0}
                className={assetLibDeleteToolbarBtn(isDarkMode, selectedIds.size > 0)}
                title={t.sceneDeleteSelected}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedIds(allSelected ? new Set() : new Set(scenes.map((s) => s.id)))
                }
                className={`text-xs ${assetLibBtnSecondary(isDarkMode, '!py-0.5 !px-2', isDarkMode ? undefined : 'operators')}`}
              >
                {allSelected ? t.sceneDeselectAll : t.sceneSelectAll}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={openAddModal}
            className={`text-xs flex items-center gap-1.5 shrink-0 ${assetLibBtnPrimary(isDarkMode, '!py-0.5 !px-2', 'control')}`}
            title={t.sceneAddTitle}
          >
            <span
              className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed ${
                isDarkMode ? 'border-white/30 text-white/55' : 'border-white/55 text-white/90'
              }`}
            >
              <Plus className="w-3 h-3" strokeWidth={2.5} />
            </span>
            {t.sceneAdd}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleExportScenes()}
            className={assetLibBtnIcon(isDarkMode)}
            title={t.sceneExportTitle}
          >
            <Upload className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => void handleImportScenes()}
            className={assetLibBtnIcon(isDarkMode)}
            title={t.sceneImportTitle}
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>
      {(msg || exportImportMsg) && (
        <div className={`px-3 py-1.5 text-xs ${assetLibMsgSuccess(isDarkMode)}`}>
          {exportImportMsg || msg}
        </div>
      )}
      {viewMode === 'gallery' ? (
        <div className="px-4 py-2 flex-shrink-0">
          <input
            type="search"
            value={gallerySearch}
            onChange={(e) => setGallerySearch(e.target.value)}
            placeholder={t.gallerySearchPlaceholder}
            className={`w-full rounded-full px-3 py-2 text-xs outline-none border ${
              isDarkMode
                ? 'bg-white/[0.06] border-white/10 text-white placeholder:text-white/35'
                : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400'
            }`}
          />
        </div>
      ) : null}
      <div
        ref={sceneListScrollRef}
        className={`flex-1 overflow-y-auto min-h-0 ${viewMode === 'gallery' ? 'px-4 pb-4' : 'p-3'} ${isDarkMode ? 'custom-scrollbar-dark' : 'custom-scrollbar'}`}
      >
        {viewMode === 'gallery' ? (
          galleryFilteredScenes.length === 0 ? (
            <p className={`text-xs text-center py-12 ${isDarkMode ? 'text-white/35' : 'text-gray-500'}`}>
              {scenes.length === 0 ? t.sceneEmpty : '无匹配场景'}
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {galleryFilteredScenes.map((scene) => {
                const normalThumb = sceneThumbUrl(scene);
                const hasPanoramaHover = !!sceneDisplay3dImageUrl(scene);
                const displayName = scene.nickname || scene.name || '—';
                return (
                  <div
                    key={scene.id}
                    draggable
                    onDragStart={(e) => handleDragStart(scene, e)}
                    onClick={() => {
                      setSelectedIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(scene.id)) next.delete(scene.id);
                        else next.add(scene.id);
                        return next;
                      });
                      onSelectScene?.(scene);
                    }}
                    onMouseEnter={
                      hasPanoramaHover
                        ? (e) => {
                            setScenePanoramaHover({
                              scene,
                              rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                            });
                          }
                        : undefined
                    }
                    onMouseLeave={hasPanoramaHover ? () => setScenePanoramaHover(null) : undefined}
                    className={`flex flex-col gap-1.5 cursor-pointer group`}
                  >
                    <div
                      className={`relative aspect-[4/3] rounded-xl overflow-hidden border ${
                        selectedIds.has(scene.id)
                          ? assetLibGalleryCardSelected(isDarkMode)
                          : isDarkMode
                            ? 'border-white/10 bg-zinc-900/90'
                            : 'border-gray-200 bg-gray-100'
                      }`}
                    >
                      {normalThumb ? (
                        <AssetLibLazyThumb
                          src={normalThumb}
                          className="absolute inset-0 w-full h-full"
                          imgClassName="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                          maxEdge={320}
                          placeholderClassName={isDarkMode ? 'bg-zinc-800' : 'bg-gray-200'}
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Mountain className={`w-10 h-10 ${isDarkMode ? 'text-white/20' : 'text-gray-300'}`} />
                        </div>
                      )}
                      <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-black/55 text-white/90 backdrop-blur-sm">
                        {t.galleryTypeScene}
                      </span>
                    </div>
                    <p
                      className={`text-xs truncate px-0.5 ${isDarkMode ? 'text-white/88' : 'text-gray-800'}`}
                      title={displayName}
                    >
                      {displayName}
                    </p>
                  </div>
                );
              })}
            </div>
          )
        ) : scenes.length === 0 ? (
          <p className={`text-xs text-center py-8 ${isDarkMode ? 'text-white/35' : 'text-gray-500'}`}>{t.sceneEmpty}</p>
        ) : (
          <div className="space-y-2">
            {scenes.map((scene) => {
              const normalThumb = sceneThumbUrl(scene);
              const hasPanoramaHover = !!sceneDisplay3dImageUrl(scene);
              return (
              <div
                key={scene.id}
                draggable
                onDragStart={(e) => handleDragStart(scene, e)}
                onClick={() => {
                  setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(scene.id)) next.delete(scene.id);
                    else next.add(scene.id);
                    return next;
                  });
                  onSelectScene?.(scene);
                }}
                onMouseEnter={
                  hasPanoramaHover
                    ? (e) => {
                        setScenePanoramaHover({
                          scene,
                          rect: (e.currentTarget as HTMLElement).getBoundingClientRect(),
                        });
                      }
                    : undefined
                }
                onMouseLeave={hasPanoramaHover ? () => setScenePanoramaHover(null) : undefined}
                title={hasPanoramaHover ? '悬停预览 360 场景' : t.sceneDragHint}
                className={`group relative flex items-center p-3 rounded-xl transition-all cursor-pointer ${
                  selectedIds.has(scene.id)
                    ? assetLibListCardSelected(isDarkMode)
                    : assetLibListCard(isDarkMode)
                }`}
              >
                <div className="flex shrink-0">
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden border border-zinc-600 bg-black/30">
                    {normalThumb ? (
                      <AssetLibLazyThumb
                        src={normalThumb}
                        className="w-full h-full"
                        maxEdge={160}
                        placeholderClassName={isDarkMode ? 'bg-zinc-800' : 'bg-gray-200'}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Mountain className={`w-5 h-5 ${isDarkMode ? 'text-white/30' : 'text-gray-400'}`} />
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-w-0 ml-3">
                  <p className={`text-sm font-medium truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                    {scene.nickname || scene.name}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    draggable={false}
                    onClick={(e) => openEditModal(scene, e)}
                    className={`p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${assetLibBtnIcon(isDarkMode, 'control')} !p-1.5`}
                    title={t.sceneEditTitle}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {onPlaceSceneToCanvas && sceneNormalImageUrl(scene) ? (
                    <button
                      type="button"
                      draggable={false}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlaceSceneToCanvas(scene);
                      }}
                      className={`${assetLibBtnPrimary(isDarkMode, '!p-1.5', 'operators')} opacity-0 group-hover:opacity-100 transition-opacity`}
                      title={t.sceneImportToCanvasTitle}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
            );
            })}
          </div>
        )}
      </div>

      {scenePanoramaHover && !showModal ? (
        <SceneLibraryPanoramaHoverPreview
          scene={scenePanoramaHover.scene}
          anchorRect={scenePanoramaHover.rect}
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
              className={`relative w-full max-w-3xl rounded-2xl border p-4 shadow-xl overflow-hidden ${assetLibEditModalPanel(isDarkMode)}`}
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
                <span className={`text-sm font-semibold ${assetLibEditModalTitle(isDarkMode)}`}>
                  {editingSceneId ? t.sceneEditTitle : t.sceneAddTitle}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (submitting) return;
                    setShowModal(false);
                    resetModal();
                  }}
                  className={assetLibBtnIcon(isDarkMode, assetLibEditModalCloseScratch(isDarkMode))}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative space-y-3 overflow-hidden">
                <div>
                  <label className={`block text-xs font-medium mb-1 ${assetLibEditModalLabel(isDarkMode)}`}>
                    {t.sceneNickname}
                  </label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    disabled={submitting}
                    className={`w-full px-2 py-1.5 rounded-lg text-sm outline-none border transition-shadow disabled:opacity-50 ${assetLibEditModalInput(isDarkMode)}`}
                    placeholder={t.sceneNickname}
                  />
                </div>
                <div className="flex gap-3 items-stretch">
                  {slotBlock('normal', normalPreview, t.sceneNormalImage)}
                  {slotBlock('display3d', display3dPreview, t.sceneDisplay3dImage)}
                </div>
              </div>
              <div className="relative flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setShowModal(false);
                    resetModal();
                  }}
                  className={assetLibBtnSecondary(
                    isDarkMode,
                    'text-xs !px-3 !py-1.5 disabled:opacity-50',
                    assetLibEditModalCancelScratch(isDarkMode),
                  )}
                >
                  {t.sceneCancel}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleSaveScene()}
                  className={assetLibBtnPrimary(
                    isDarkMode,
                    'text-xs !px-3 !py-1.5 disabled:opacity-50',
                    assetLibEditModalSaveScratch(isDarkMode),
                  )}
                >
                  {t.sceneSave}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default SceneLibraryList;
export { scenePanoramaUrlForCanvas, sceneThumbUrl, sceneNormalImageUrl, sceneDisplay3dImageUrl };
