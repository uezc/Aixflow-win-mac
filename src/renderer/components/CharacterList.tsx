import React, { useState, useEffect, useLayoutEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { User, Copy, Check, Trash2, ChevronLeft, ChevronRight, Download, Upload, ExternalLink, Plus, X, Mic, Headphones, Square, Pencil, Box, Layers, Loader2 } from 'lucide-react';
import { useDarkAlert } from '../contexts/DarkAlertContext';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { useNxModelPricing } from '../contexts/NxModelPricingContext';
import { useAI } from '../hooks/useAI';
import { assetLibraryT } from '../i18n/assetLibraryI18n';
import {
  IMAGE_REVERSE_DEFAULT_MODEL,
  LLM_CHAT_MODEL_GPT56_TERRA,
  getImageReverseDisplayPrice,
  normalizeImageReverseCaptionModel,
  type ImageReverseCaptionModel,
} from '../utils/cloudModelPricing';
import type { AssetLibraryViewMode } from './AssetLibrarySidebar';
import type { Character } from './characterListShared';
import {
  NEXFLOW_CHARACTER_DRAG_MIME,
  characterHasGlbForPreview,
  isImageTo3dLibraryCharacter,
  resolveImageTo3dLibraryThumbUrl,
  resolveCharacterVoiceUrlForDrag,
} from './characterListShared';
import { importImageTo3dAssetsToCharacters } from '../utils/importImageTo3dAsset';
import {
  preloadImageTo3dCharacter,
} from '../utils/glbPreviewPreload';
import AssetLibLazyThumb from './AssetLibLazyThumb';
import { getCharactersCoalesced } from '../utils/characterLibraryCache';
import { useIdlePoll } from '../hooks/useIdlePoll';
import ImageTo3dLibraryHoverPreview from './ImageTo3dLibraryHoverPreview';
import ImageTo3dInlineGlbPreview from './ImageTo3dInlineGlbPreview';
import { buildAudioEqBarHeightsPct } from '../utils/audioEqThumb';
import {
  assetLibBtnIcon,
  assetLibDeleteToolbarBtn,
  assetLibBtnPrimary,
  assetLibCardActionBtn,
  assetLibBtnSecondary,
  assetLibCopySuccess,
  assetLibGalleryCardSelected,
  assetLibListCard,
  assetLibListCardSelected,
  assetLibMsgSuccess,
  assetLibEditModalBackdrop,
  assetLibEditModalPanel,
  assetLibEditModalTitle,
  assetLibEditModalLabel,
  assetLibEditModalInput,
  assetLibEditModalMutedLink,
  assetLibEditModalCloseScratch,
  assetLibEditModalCancelScratch,
  assetLibEditModalSaveScratch,
  assetLibEditModalPrimaryScratch,
  assetLibEditModalSecondaryActionScratch,
  assetLibEditModalCanvasPickScratch,
} from '../utils/assetLibraryChrome';

/**
 * 添加角色弹窗参考音波形：仅用 URL seed 生成装饰条，绝不 fetch/decodeAudioData。
 * （整轨解码在 Electron/Windows 上可原生崩溃 0xC0000005，与 try/catch 无关）
 */
function buildDecorativeVoiceBars(seed: string, barCount = 56): number[] {
  return buildAudioEqBarHeightsPct(seed || 'voice', barCount).map((pct) =>
    Math.max(0.12, Math.min(1, pct / 100)),
  );
}

const EMPTY_FOUR_VIEWS: [string, string, string, string] = ['', '', '', ''];

function pathToPreviewUrl(filePath: string): string {
  let normalized = filePath.replace(/\\/g, '/').replace(/^\/([a-zA-Z]:)/, '$1');
  if (/^[a-zA-Z]\//.test(normalized)) {
    normalized = `${normalized[0].toUpperCase()}:${normalized.slice(1)}`;
  }
  const encoded = normalized.split('/').map((part, index) => {
    if (index === 0 && /^[a-zA-Z]:$/.test(part)) return part;
    if (/[\u4e00-\u9fa5\s]/.test(part)) return encodeURIComponent(part);
    return part;
  });
  return `local-resource://${encoded.join('/')}`;
}

function isImageFilePath(filePath: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(filePath.trim());
}

/** 角色头像取自四视图顺序中的第一张非空图 */
function avatarFromViewImages(views: readonly string[]): string {
  for (let i = 0; i < views.length; i++) {
    const v = (views[i] || '').trim();
    if (v) return v;
  }
  return '';
}

/** 将四视图槽位 URL 规范为可预览 / 可反推的地址 */
function normalizeCharacterViewImageUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  if (
    trimmed.startsWith('local-resource://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('file://')
  ) {
    return trimmed;
  }
  return pathToPreviewUrl(trimmed);
}

function characterViewImageUrlForPreview(c: Character, slot: number): string {
  const vi = c.viewImages || [];
  const url = (typeof vi[slot] === 'string' ? vi[slot] : '').trim();
  if (url) return normalizeCharacterViewImageUrl(url);
  const locals = c.localViewPaths || [];
  const lp = typeof locals[slot] === 'string' ? locals[slot].trim() : '';
  return lp ? pathToPreviewUrl(lp) : '';
}

const CHARACTER_LIB_REVERSE_NODE_ID = 'character-library-image-reverse';

function characterHasViewImages(c: Character): boolean {
  const vi = c.viewImages || [];
  if (vi.some((s) => (s || '').trim().length > 0)) return true;
  return (c.localViewPaths || []).some((s) => (s || '').trim().length > 0);
}

/** 悬停四视图单格高度（略大于旧版 216，更易看清定妆细节） */
const FOUR_VIEW_PREVIEW_CELL = 300;
/** 预览区与资产侧栏间距 */
const FOUR_VIEW_PREVIEW_SIDE_GAP = '1cm';

let fourViewSideGapPxCache: number | null = null;
function getFourViewSideGapPx(): number {
  if (fourViewSideGapPxCache != null) return fourViewSideGapPxCache;
  if (typeof document === 'undefined') {
    fourViewSideGapPxCache = 38;
    return fourViewSideGapPxCache;
  }
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;left:-9999px;width:${FOUR_VIEW_PREVIEW_SIDE_GAP};height:1px;visibility:hidden;pointer-events:none`;
  document.body.appendChild(probe);
  fourViewSideGapPxCache = probe.getBoundingClientRect().width;
  probe.remove();
  return fourViewSideGapPxCache;
}

function CharacterFourViewHoverPreview({
  character,
  anchorRect,
  isDarkMode,
}: {
  character: Character;
  anchorRect: DOMRect;
  isDarkMode: boolean;
}) {
  const urls = [0, 1, 2, 3].map((i) => characterViewImageUrlForPreview(character, i));
  const rowRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const sideGap = getFourViewSideGapPx();

  const updatePosition = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const panelW = el.offsetWidth;
    const panelH = el.offsetHeight || FOUR_VIEW_PREVIEW_CELL;
    const edge = 8;
    let left = anchorRect.right + sideGap;
    if (left + panelW > window.innerWidth - edge) {
      left = Math.max(edge, anchorRect.left - sideGap - panelW);
    }
    let top = anchorRect.top + anchorRect.height / 2;
    const halfH = panelH / 2;
    if (top - halfH < edge) top = edge + halfH;
    if (top + halfH > window.innerHeight - edge) top = window.innerHeight - edge - halfH;
    setPosition({ left, top });
  }, [anchorRect, sideGap]);

  useLayoutEffect(() => {
    updatePosition();
  }, [updatePosition, character.id, urls.join('\0')]);

  const imgStyle: React.CSSProperties = {
    height: FOUR_VIEW_PREVIEW_CELL,
    width: 'auto',
    maxHeight: FOUR_VIEW_PREVIEW_CELL,
  };

  const frameClass = isDarkMode
    ? 'rounded-xl overflow-hidden border border-white/15 bg-zinc-900/55 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-sm'
    : 'rounded-xl overflow-hidden border border-black/10 bg-white/65 shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-sm';

  return createPortal(
    <div
      ref={rowRef}
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
      <div className={frameClass}>
        <div className="flex flex-row items-center gap-0 leading-[0]">
          {urls.map((src, slot) =>
            src ? (
              <img
                key={slot}
                src={src}
                alt=""
                className="block shrink-0 h-auto max-h-full object-contain"
                style={imgStyle}
                draggable={false}
                onLoad={updatePosition}
              />
            ) : null,
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** 添加角色弹窗：横向装饰声波纹（seed 条高，不解码音频） */
function CharacterAddVoiceWaveformStrip({ seed }: { seed: string }) {
  const bars = buildDecorativeVoiceBars(seed);
  const n = Math.max(1, bars.length);
  const vbW = 200;
  const vbH = 36;
  const stroke = 'rgba(56, 189, 248, 0.95)';
  const strokeW = vbW / n - 0.12;
  return (
    <svg viewBox={`0 0 ${vbW} ${vbH}`} className="h-full w-full min-h-[2.25rem] block" preserveAspectRatio="none" aria-hidden>
      {bars.map((v, i) => {
        const x = ((i + 0.5) * vbW) / n;
        const amp = Math.max(0.06, Math.min(1, v));
        const half = amp * (vbH / 2 - 3);
        const mid = vbH / 2;
        return (
          <line
            key={i}
            x1={x}
            x2={x}
            y1={mid - half}
            y2={mid + half}
            stroke={stroke}
            strokeWidth={Math.max(0.28, strokeW)}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

interface CharacterListProps {
  isDarkMode: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  /** 嵌入资产库侧栏时由父级提供顶栏 Tab，本组件只渲染列表区 */
  embedded?: boolean;
  /** 列表 / 大窗口网格（画廊） */
  viewMode?: AssetLibraryViewMode;
  /** 角色 / 3D 模型分库筛选 */
  assetFilter?: 'role' | 'imageTo3d';
  /** 3D 模型库显示 .aixflow 导入按钮 */
  showImport3d?: boolean;
  onSelectCharacter?: (character: Character) => void;
  refreshTrigger?: number; // 外部触发刷新的计数器
  /** 当前 Tab 可见且侧栏展开时才后台轮询 */
  listActive?: boolean;
  /** 从画布点选音频类节点作为添加角色时的参考音；取消时 resolve null */
  requestVoicePickFromCanvas?: () => Promise<{ url: string; label: string } | null>;
  /** 从画布点选图片节点，写入「添加角色」四视图指定槽位（0–3）；取消时 resolve null */
  requestViewSlotPickFromCanvas?: (slotIndex: number) => Promise<string | null>;
}

const CharacterList: React.FC<CharacterListProps> = ({
  isDarkMode,
  isCollapsed,
  onToggleCollapse,
  embedded = false,
  viewMode = 'list',
  assetFilter,
  showImport3d = false,
  onSelectCharacter,
  refreshTrigger,
  listActive = true,
  requestVoicePickFromCanvas,
  requestViewSlotPickFromCanvas,
}) => {
  const { showAlert, showConfirm } = useDarkAlert();
  const { locale } = useAppLocale();
  const libT = assetLibraryT(locale);
  const { cloudMap } = useNxModelPricing();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [gallerySearch, setGallerySearch] = useState('');
  const [loading, setLoading] = useState(true);
  /** 刚完成「复制角色名」的角色 id，用于显示对勾 */
  const [copiedCharacterId, setCopiedCharacterId] = useState<string | null>(null);
  /** 正在试听参考音的角色 id */
  const [previewingCharacterId, setPreviewingCharacterId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [exportImportMsg, setExportImportMsg] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
  const [editingNickname, setEditingNickname] = useState('');
  const nicknameInputRef = useRef<HTMLInputElement>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  /** 非空表示弹窗为「修改素材」模式，对应角色 id */
  const [addModalEditingCharacterId, setAddModalEditingCharacterId] = useState<string | null>(null);
  const [addNickname, setAddNickname] = useState('');
  const [addVoiceDataUrl, setAddVoiceDataUrl] = useState('');
  const [addVoiceLabel, setAddVoiceLabel] = useState('');
  const [addViewImages, setAddViewImages] = useState<[string, string, string, string]>(() => [...EMPTY_FOUR_VIEWS]);
  const [addImageDescription, setAddImageDescription] = useState('');
  const [addReverseModel, setAddReverseModel] = useState<ImageReverseCaptionModel>(IMAGE_REVERSE_DEFAULT_MODEL);
  const [addReverseSlot, setAddReverseSlot] = useState<number | null>(null);
  /** 弹窗内反推错误（列表顶栏 toast 会被模态遮住） */
  const [addReverseError, setAddReverseError] = useState<string | null>(null);
  const reversePendingRef = useRef<{
    resolve: (text: string) => void;
    reject: (err: string) => void;
  } | null>(null);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addModalVoicePlaying, setAddModalVoicePlaying] = useState(false);
  const addVoiceInputRef = useRef<HTMLInputElement>(null);
  const addViewInputRef = useRef<HTMLInputElement>(null);
  const addViewSlotIndexRef = useRef(0);
  const addModalVoiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const characterListScrollRef = useRef<HTMLDivElement>(null);
  const [fourViewHover, setFourViewHover] = useState<{ character: Character; rect: DOMRect } | null>(null);
  const [imageTo3dHover, setImageTo3dHover] = useState<{ character: Character; rect: DOMRect } | null>(null);
  const imageTo3dHoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 3D 模型库：编辑弹窗（备注 + 参考图头像） */
  const [showImageTo3dEditModal, setShowImageTo3dEditModal] = useState(false);
  const [edit3dCharacterId, setEdit3dCharacterId] = useState<string | null>(null);
  const [edit3dNickname, setEdit3dNickname] = useState('');
  const [edit3dAvatarPreview, setEdit3dAvatarPreview] = useState('');
  const [edit3dSubmitting, setEdit3dSubmitting] = useState(false);
  const [edit3dModalHiddenForCanvasPick, setEdit3dModalHiddenForCanvasPick] = useState(false);
  const edit3dAvatarInputRef = useRef<HTMLInputElement>(null);
  /** 画廊模式：当前悬停展示 3D 网格预览的条目 */
  const [galleryHovered3dId, setGalleryHovered3dId] = useState<string | null>(null);
  /** 从画布选参考图前暂存添加角色表单，关闭弹窗期间保留 */
  const addCharacterFormDraftRef = useRef<{
    nickname: string;
    voice: string;
    voiceLabel: string;
    views: [string, string, string, string];
    imageDescription: string;
    editingCharacterId: string | null;
  } | null>(null);

  // 加载角色列表（必须定义在 handleImport 之前）
  const loadCharacters = useCallback(async () => {
    try {
      if (window.electronAPI) {
        const chars = await Promise.race([
          getCharactersCoalesced<Character>(),
          new Promise<never>((_, reject) => {
            window.setTimeout(() => reject(new Error('getCharacters timeout')), 8000);
          }),
        ]);
        const sortedChars = [...chars].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setCharacters(sortedChars);
      }
    } catch (error) {
      console.error('加载角色列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredCharacters = React.useMemo(() => {
    if (!assetFilter) return characters;
    return characters.filter((c) =>
      assetFilter === 'imageTo3d' ? isImageTo3dLibraryCharacter(c) : !isImageTo3dLibraryCharacter(c),
    );
  }, [characters, assetFilter]);

  const galleryFilteredCharacters = React.useMemo(() => {
    const q = gallerySearch.trim().toLowerCase();
    if (!q) return filteredCharacters;
    return filteredCharacters.filter((c) => {
      const name = `${c.nickname || ''} ${c.name || ''}`.toLowerCase();
      return name.includes(q);
    });
  }, [filteredCharacters, gallerySearch]);

  const resolveCharacterThumbSrc = (character: Character): string => {
    if (isImageTo3dLibraryCharacter(character)) {
      return resolveImageTo3dLibraryThumbUrl(character);
    }
    if (character.localAvatarPath) {
      return pathToPreviewUrl(character.localAvatarPath);
    }
    if (character.avatar?.startsWith('local-resource://') || character.avatar?.startsWith('data:')) {
      return character.avatar;
    }
    const fromViews = avatarFromViewImages(character.viewImages || []);
    if (fromViews) return normalizeCharacterViewImageUrl(fromViews);
    const localView = (character.localViewPaths || []).find((p) => String(p || '').trim());
    if (localView) return pathToPreviewUrl(String(localView));
    return character.avatar || '';
  };

  // 导出勾选的角色（收起状态导出全部）
  const handleExport = useCallback(async () => {
    try {
      if (!window.electronAPI?.exportCharacters) return;
      const ids = isCollapsed ? [] : Array.from(selectedIds);
      if (!isCollapsed && ids.length === 0) {
        setExportImportMsg('请先勾选要导出的角色');
        setTimeout(() => setExportImportMsg(null), 2000);
        return;
      }
      const res = await window.electronAPI.exportCharacters(ids);
      if (res.success) {
        setExportImportMsg(ids.length > 0 ? `已导出 ${ids.length} 个角色` : '导出成功');
        setTimeout(() => setExportImportMsg(null), 2000);
      } else {
        setExportImportMsg(res.error || '导出失败');
        setTimeout(() => setExportImportMsg(null), 3000);
      }
    } catch (e) {
      setExportImportMsg('导出失败');
      setTimeout(() => setExportImportMsg(null), 3000);
    }
  }, [selectedIds, isCollapsed]);

  // 导出勾选的 3D 模型（单文件 .aixflow；多选导出到所选文件夹）
  const handleExport3d = useCallback(async () => {
    try {
      if (!window.electronAPI?.exportImageTo3dModels) {
        setExportImportMsg('导出功能未就绪，请重新编译主进程后重启');
        setTimeout(() => setExportImportMsg(null), 3000);
        return;
      }
      const ids = isCollapsed ? [] : Array.from(selectedIds);
      if (!isCollapsed && ids.length === 0) {
        setExportImportMsg('请先勾选要导出的 3D 模型');
        setTimeout(() => setExportImportMsg(null), 2000);
        return;
      }
      const res = await window.electronAPI.exportImageTo3dModels(ids);
      if (res.success) {
        const n = res.count ?? (ids.length || filteredCharacters.length);
        setExportImportMsg(
          n > 1
            ? `已导出 ${n} 个 .aixflow（参考图+GLB+贴图）到文件夹`
            : n > 0
              ? `已导出 .aixflow（参考图+GLB+贴图）`
              : '导出成功',
        );
        setTimeout(() => setExportImportMsg(null), 2000);
      } else if (res.error && !res.error.includes('取消')) {
        setExportImportMsg(res.error);
        setTimeout(() => setExportImportMsg(null), 3000);
      }
    } catch (e) {
      setExportImportMsg(e instanceof Error ? e.message : '导出失败');
      setTimeout(() => setExportImportMsg(null), 3000);
    }
  }, [selectedIds, isCollapsed, filteredCharacters.length]);

  // 导入角色
  const handleImport = useCallback(async () => {
    try {
      if (!window.electronAPI?.importCharacters) return;
      const res = await window.electronAPI.importCharacters();
      if (res.success && res.count != null && res.count > 0) {
        setExportImportMsg(`已导入 ${res.count} 个角色`);
        await loadCharacters();
        setTimeout(() => setExportImportMsg(null), 2000);
      } else if (res.error && !res.error.includes('取消')) {
        setExportImportMsg(res.error);
        setTimeout(() => setExportImportMsg(null), 3000);
      }
    } catch (e) {
      setExportImportMsg('导入失败');
      setTimeout(() => setExportImportMsg(null), 3000);
    }
  }, [loadCharacters]);

  // 导入 .aixflow / .glb 到角色库（可再拖到画布）
  const handleImport3d = useCallback(async () => {
    try {
      const { canceled, characters } = await importImageTo3dAssetsToCharacters();
      if (canceled) return;
      if (characters.length > 0) {
        setExportImportMsg(`已导入 ${characters.length} 个 3D 模型，可拖到画布`);
        await loadCharacters();
        setTimeout(() => setExportImportMsg(null), 2500);
      }
    } catch (e) {
      setExportImportMsg(e instanceof Error ? e.message : '导入 3D 失败');
      setTimeout(() => setExportImportMsg(null), 3000);
    }
  }, [loadCharacters]);

  useEffect(() => {
    loadCharacters();
  }, [loadCharacters, refreshTrigger]); // 当 refreshTrigger 变化时也刷新

  useEffect(() => {
    const unsub = window.electronAPI?.onCharactersUpdated?.(() => {
      void loadCharacters();
    });
    return () => {
      unsub?.();
    };
  }, [loadCharacters]);

  useEffect(() => {
    if (viewMode !== 'gallery') setGalleryHovered3dId(null);
  }, [viewMode]);

  useEffect(() => {
    if (!fourViewHover && !imageTo3dHover) return;
    const el = characterListScrollRef.current;
    const hide = () => {
      if (imageTo3dHoverLeaveTimerRef.current) {
        clearTimeout(imageTo3dHoverLeaveTimerRef.current);
        imageTo3dHoverLeaveTimerRef.current = null;
      }
      setFourViewHover(null);
      setImageTo3dHover(null);
    };
    el?.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('scroll', hide, true);
    return () => {
      el?.removeEventListener('scroll', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, [fourViewHover, imageTo3dHover]);

  useEffect(() => {
    if (!galleryHovered3dId) return;
    const el = characterListScrollRef.current;
    const hide = () => setGalleryHovered3dId(null);
    el?.addEventListener('scroll', hide, { passive: true });
    return () => el?.removeEventListener('scroll', hide);
  }, [galleryHovered3dId]);

  // 仅在侧栏可见时低频轮询；禁止 5s 全量刷新（会反复 IPC + 重渲染，素材库无法秒开）
  useIdlePoll(listActive && !isCollapsed, loadCharacters, 60000);

  // 模型库：空闲时只预热前 3 个 GLB，悬停可更快出 3D 预览（不全量预热避免卡顿）
  useEffect(() => {
    if (assetFilter !== 'imageTo3d' || !listActive || isCollapsed) return;
    const targets = filteredCharacters.filter((c) => characterHasGlbForPreview(c)).slice(0, 3);
    if (targets.length === 0) return;
    let cancelled = false;
    let idx = 0;
    const pump = () => {
      if (cancelled || idx >= targets.length) return;
      preloadImageTo3dCharacter(targets[idx]);
      idx += 1;
      const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 80));
      ric(() => pump());
    };
    const ric = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 120));
    const id = ric(() => pump());
    return () => {
      cancelled = true;
      if (typeof id === 'number' && window.cancelIdleCallback) window.cancelIdleCallback(id);
    };
  }, [assetFilter, filteredCharacters, listActive, isCollapsed]);

  useEffect(() => {
    return () => {
      if (imageTo3dHoverLeaveTimerRef.current) {
        clearTimeout(imageTo3dHoverLeaveTimerRef.current);
        imageTo3dHoverLeaveTimerRef.current = null;
      }
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current.src = '';
        previewAudioRef.current = null;
      }
    };
  }, []);

  /** 解析角色参考音 URL（与头像 local-resource 规则一致） */
  const stopVoicePreview = useCallback(() => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current.src = '';
      previewAudioRef.current = null;
    }
    setPreviewingCharacterId(null);
  }, []);

  const handlePreviewVoice = useCallback(
    (character: Character, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const url = resolveCharacterVoiceUrlForDrag(character);
      if (!url) {
        showAlert('该角色暂无参考音');
        return;
      }
      if (previewingCharacterId === character.id) {
        stopVoicePreview();
        return;
      }
      stopVoicePreview();
      const a = new Audio(url);
      previewAudioRef.current = a;
      setPreviewingCharacterId(character.id);
      a.addEventListener('ended', () => setPreviewingCharacterId(null), { once: true });
      a.addEventListener(
        'error',
        () => {
          showAlert('无法播放参考音');
          stopVoicePreview();
        },
        { once: true },
      );
      void a.play().catch(() => {
        showAlert('无法播放参考音');
        stopVoicePreview();
      });
    },
    [previewingCharacterId, showAlert, stopVoicePreview],
  );

  /** 复制展示用角色名（备注昵称优先，否则平台名） */
  const handleCopyCharacterDisplayName = useCallback(
    async (character: Character, e: React.MouseEvent) => {
      e.stopPropagation();
      const name = (character.nickname || character.name || '').trim();
      if (!name) {
        showAlert('暂无角色名可复制');
        return;
      }
      try {
        await navigator.clipboard.writeText(name);
        setCopiedCharacterId(character.id);
        setTimeout(() => setCopiedCharacterId(null), 2000);
      } catch (error) {
        console.error('复制失败:', error);
        const textArea = document.createElement('textarea');
        textArea.value = name;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          setCopiedCharacterId(character.id);
          setTimeout(() => setCopiedCharacterId(null), 2000);
        } catch (err) {
          console.error('复制失败:', err);
          showAlert('复制失败，请手动复制');
        }
        document.body.removeChild(textArea);
      }
    },
    [showAlert],
  );

  const handleCharacterCardDragStart = useCallback((character: Character, e: React.DragEvent) => {
    if (isImageTo3dLibraryCharacter(character)) {
      const hasGlb = !!(character.localGlbUrl || character.localGlbPath || character.remoteGlbUrl);
      if (!hasGlb) {
        e.preventDefault();
        showAlert('该 3D 模型文件缺失，无法拖到画布');
        return;
      }
    }
    try {
      e.dataTransfer.setData(NEXFLOW_CHARACTER_DRAG_MIME, JSON.stringify(character));
      e.dataTransfer.effectAllowed = 'copy';
    } catch (err) {
      console.error('[CharacterList] drag data failed', err);
      e.preventDefault();
    }
  }, [showAlert]);

  // 删除勾选的角色（单个或多个）
  const handleDeleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      setExportImportMsg('请先勾选要删除的角色');
      setTimeout(() => setExportImportMsg(null), 2000);
      return;
    }
    const confirmed = await showConfirm(`确定要删除选中的 ${ids.length} 个角色吗？`);
    if (!confirmed) return;
    try {
      if (window.electronAPI) {
        for (const id of ids) {
          await window.electronAPI.deleteCharacter(id);
        }
        setSelectedIds(new Set());
        await loadCharacters();
        setExportImportMsg(`已删除 ${ids.length} 个角色`);
        setTimeout(() => setExportImportMsg(null), 2000);
      }
    } catch (error) {
      console.error('删除角色失败:', error);
      setExportImportMsg('删除角色失败');
      setTimeout(() => setExportImportMsg(null), 3000);
    }
  }, [selectedIds, loadCharacters, showConfirm]);

  // 跳转角色页面（左上角图标点击）
  const handleJumpToRole = useCallback((character: Character, e: React.MouseEvent) => {
    e.stopPropagation();
    if (character.permalink && character.permalink.startsWith('http')) {
      window.electronAPI?.openExternalUrl?.(character.permalink);
    } else if (onSelectCharacter) {
      onSelectCharacter(character);
    }
  }, [onSelectCharacter]);

  // 全选/取消全选
  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredCharacters.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCharacters.map((c) => c.id)));
    }
  }, [filteredCharacters, selectedIds.size]);

  // 点击头衔勾选/取消勾选
  const handleToggleSelect = useCallback((characterId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(characterId)) next.delete(characterId);
      else next.add(characterId);
      return next;
    });
  }, []);

  // 双击昵称开始编辑
  const handleNicknameDoubleClick = useCallback((character: Character, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingCharacterId(character.id);
    setEditingNickname(character?.nickname || character?.name || '');
    setTimeout(() => nicknameInputRef.current?.focus(), 0);
  }, []);

  // 保存昵称
  const handleSaveNickname = useCallback(async () => {
    if (!editingCharacterId) return;
    try {
      if (window.electronAPI?.updateCharacter) {
        await window.electronAPI.updateCharacter(editingCharacterId, { nickname: editingNickname.trim() || undefined });
        await loadCharacters();
      }
    } catch (err) {
      console.error('更新昵称失败:', err);
    }
    setEditingCharacterId(null);
  }, [editingCharacterId, editingNickname, loadCharacters]);

  useEffect(() => {
    if (editingCharacterId) {
      const handler = (e: KeyboardEvent) => {
        if (e.key === 'Enter') handleSaveNickname();
        if (e.key === 'Escape') setEditingCharacterId(null);
      };
      window.addEventListener('keydown', handler);
      return () => window.removeEventListener('keydown', handler);
    }
  }, [editingCharacterId, handleSaveNickname]);

  const stopAddModalVoicePreview = useCallback(() => {
    if (addModalVoiceAudioRef.current) {
      addModalVoiceAudioRef.current.pause();
      addModalVoiceAudioRef.current.src = '';
      addModalVoiceAudioRef.current = null;
    }
    setAddModalVoicePlaying(false);
  }, []);

  const toggleAddModalVoicePreview = useCallback(() => {
    if (!addVoiceDataUrl) return;
    if (addModalVoicePlaying) {
      stopAddModalVoicePreview();
      return;
    }
    const a = new Audio(addVoiceDataUrl);
    addModalVoiceAudioRef.current = a;
    setAddModalVoicePlaying(true);
    a.addEventListener(
      'ended',
      () => {
        setAddModalVoicePlaying(false);
        addModalVoiceAudioRef.current = null;
      },
      { once: true },
    );
    a.addEventListener(
      'error',
      () => {
        showAlert('无法播放参考音');
        stopAddModalVoicePreview();
      },
      { once: true },
    );
    void a.play().catch(() => {
      showAlert('无法播放参考音');
      stopAddModalVoicePreview();
    });
  }, [addVoiceDataUrl, addModalVoicePlaying, stopAddModalVoicePreview, showAlert]);

  useEffect(() => {
    if (!showAddModal) {
      stopAddModalVoicePreview();
    }
  }, [showAddModal, stopAddModalVoicePreview]);

  const resetAddCharacterForm = useCallback(() => {
    stopAddModalVoicePreview();
    setAddModalEditingCharacterId(null);
    setAddNickname('');
    setAddVoiceDataUrl('');
    setAddVoiceLabel('');
    setAddViewImages([...EMPTY_FOUR_VIEWS]);
    setAddImageDescription('');
    setAddReverseModel(IMAGE_REVERSE_DEFAULT_MODEL);
    setAddReverseSlot(null);
    setAddReverseError(null);
    if (reversePendingRef.current) {
      reversePendingRef.current.reject('cancelled');
      reversePendingRef.current = null;
    }
  }, [stopAddModalVoicePreview]);

  const reversePriceLabel = useMemo(() => {
    const value = getImageReverseDisplayPrice(
      normalizeImageReverseCaptionModel(addReverseModel),
      cloudMap,
    );
    return value == null ? ({ ok: false as const }) : ({ ok: true as const, value });
  }, [addReverseModel, cloudMap]);

  const applyReverseResult = useCallback(
    (payload: { text?: string; error?: string } | null | undefined) => {
      const err = String(payload?.error || '').trim();
      if (err) {
        setAddReverseError(err);
        reversePendingRef.current?.reject(err);
        reversePendingRef.current = null;
        return;
      }
      const text = String(payload?.text || '').trim();
      if (text) {
        setAddImageDescription(text);
        setAddReverseError(null);
        reversePendingRef.current?.resolve(text);
        reversePendingRef.current = null;
        return;
      }
      const emptyMsg = libT.roleReverseEmpty;
      setAddReverseError(emptyMsg);
      reversePendingRef.current?.reject(emptyMsg);
      reversePendingRef.current = null;
    },
    [libT.roleReverseEmpty],
  );

  const { status: reverseAiStatus, execute: executeImageReverse } = useAI({
    nodeId: CHARACTER_LIB_REVERSE_NODE_ID,
    modelId: 'chat',
    onComplete: (payload) => {
      applyReverseResult(payload);
    },
    onError: (err) => {
      const msg = String(err || libT.roleReverseFailed).trim() || libT.roleReverseFailed;
      setAddReverseError(msg);
      reversePendingRef.current?.reject(msg);
      reversePendingRef.current = null;
    },
  });
  const isReversing = reverseAiStatus === 'START' || reverseAiStatus === 'PROCESSING';

  const runReverseForViewSlot = useCallback(
    async (slot: number) => {
      const imageUrl = normalizeCharacterViewImageUrl(String(addViewImages[slot] || ''));
      if (!imageUrl) {
        const msg = libT.roleReverseNeedImage;
        setAddReverseError(msg);
        showAlert(msg);
        return;
      }
      if (isReversing || addSubmitting) return;
      setAddReverseSlot(slot);
      setAddReverseError(null);
      const model = normalizeImageReverseCaptionModel(addReverseModel);
      const question =
        locale === 'en'
          ? 'Describe this character’s appearance, clothing, and vibe in detail for reuse as a character look description.'
          : '请详细描述该角色的外貌、服装与气质，便于作为角色形象描述复用。';

      const resultPromise = new Promise<string>((resolve, reject) => {
        reversePendingRef.current = { resolve, reject };
      });

      try {
        await executeImageReverse({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: question },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
          max_tokens: 800,
          stream: false,
          nodeTitle: 'character-image-reverse',
        });
        // invoke 可能在 SUCCESS 事件发出前就返回，再等回调写入描述
        const text = await Promise.race([
          resultPromise,
          new Promise<string>((_, reject) => {
            window.setTimeout(() => reject(new Error(libT.roleReverseFailed)), 180_000);
          }),
        ]);
        if (text) setAddImageDescription(text);
      } catch (e) {
        const msg =
          e instanceof Error && e.message && e.message !== 'cancelled'
            ? e.message
            : libT.roleReverseFailed;
        console.error('[角色素材] 图像反推失败:', e);
        if (msg !== 'cancelled') {
          setAddReverseError(msg);
          showAlert(msg);
        }
        if (reversePendingRef.current) {
          reversePendingRef.current = null;
        }
      }
    },
    [
      addViewImages,
      addReverseModel,
      addSubmitting,
      isReversing,
      executeImageReverse,
      locale,
      libT.roleReverseNeedImage,
      libT.roleReverseFailed,
      showAlert,
    ],
  );

  const openAddCharacterModal = useCallback(() => {
    resetAddCharacterForm();
    setShowAddModal(true);
  }, [resetAddCharacterForm]);

  const openEditCharacterMaterials = useCallback(
    (character: Character, e: React.MouseEvent) => {
      e.stopPropagation();
      stopAddModalVoicePreview();
      setAddModalEditingCharacterId(character.id);
      setAddNickname((character.nickname || character.name || '').trim());
      const vUrl = resolveCharacterVoiceUrlForDrag(character);
      setAddVoiceDataUrl(vUrl || '');
      setAddVoiceLabel(vUrl ? libT.roleVoiceSelected : '');
      const nextViews = [0, 1, 2, 3].map((i) =>
        characterViewImageUrlForPreview(character, i),
      ) as [string, string, string, string];
      setAddViewImages(nextViews);
      setAddImageDescription(String(character.imageDescription || '').trim());
      setAddReverseModel(IMAGE_REVERSE_DEFAULT_MODEL);
      setAddReverseSlot(nextViews.findIndex((u) => !!u));
      setAddReverseError(null);
      setShowAddModal(true);
    },
    [stopAddModalVoicePreview, libT.roleVoiceSelected],
  );

  const resetImageTo3dEditModal = useCallback(() => {
    setShowImageTo3dEditModal(false);
    setEdit3dCharacterId(null);
    setEdit3dNickname('');
    setEdit3dAvatarPreview('');
    setEdit3dSubmitting(false);
  }, []);

  const openEditImageTo3dCharacter = useCallback((character: Character, e: React.MouseEvent) => {
    e.stopPropagation();
    setEdit3dCharacterId(character.id);
    setEdit3dNickname((character.nickname || character.name || '').trim());
    setEdit3dAvatarPreview(resolveCharacterThumbSrc(character));
    setShowImageTo3dEditModal(true);
  }, []);

  const handlePickImageTo3dAvatar = useCallback(async () => {
    const applyPickedPath = (filePath: string) => {
      if (!isImageFilePath(filePath)) {
        setExportImportMsg('请选择图片文件（png / jpg / webp 等）');
        setTimeout(() => setExportImportMsg(null), 2500);
        return;
      }
      setEdit3dAvatarPreview(pathToPreviewUrl(filePath));
    };

    try {
      if (window.electronAPI?.pickImageTo3dUpload) {
        const pick = await window.electronAPI.pickImageTo3dUpload();
        if (pick && !pick.canceled && pick.filePath) {
          applyPickedPath(pick.filePath);
          return;
        }
        if (pick?.canceled) return;
      }
    } catch (err) {
      console.warn('[3D模型编辑] pickImageTo3dUpload 失败，尝试 pickImageTo3dAvatar', err);
    }

    try {
      if (window.electronAPI?.pickImageTo3dAvatar) {
        const pick = await window.electronAPI.pickImageTo3dAvatar();
        if (pick && !pick.canceled && pick.filePath) {
          applyPickedPath(pick.filePath);
          return;
        }
        if (pick?.canceled) return;
      }
    } catch (err) {
      console.warn('[3D模型编辑] pickImageTo3dAvatar 不可用，回退浏览器选图', err);
    }

    edit3dAvatarInputRef.current?.click();
  }, []);

  const handleEdit3dAvatarFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      if (url) setEdit3dAvatarPreview(url);
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = '';
  }, []);

  const handlePickImageTo3dAvatarFromCanvas = useCallback(async () => {
    if (!requestViewSlotPickFromCanvas) return;
    setEdit3dModalHiddenForCanvasPick(true);
    try {
      const url = await requestViewSlotPickFromCanvas(0);
      if (url?.trim()) setEdit3dAvatarPreview(url.trim());
    } finally {
      setEdit3dModalHiddenForCanvasPick(false);
    }
  }, [requestViewSlotPickFromCanvas]);

  const handleSaveImageTo3dEdit = useCallback(async () => {
    if (!edit3dCharacterId) return;
    const nickname = edit3dNickname.trim();
    if (!nickname) {
      setExportImportMsg(libT.roleNeedNickname);
      setTimeout(() => setExportImportMsg(null), 2000);
      return;
    }
    setEdit3dSubmitting(true);
    try {
      if (!window.electronAPI?.updateCharacter) return;
      await window.electronAPI.updateCharacter(edit3dCharacterId, {
        nickname,
        name: nickname,
        avatar: edit3dAvatarPreview.trim(),
      });
      await loadCharacters();
      resetImageTo3dEditModal();
      setExportImportMsg(libT.roleSaved);
      setTimeout(() => setExportImportMsg(null), 2000);
    } catch (err) {
      console.error('保存 3D 模型失败:', err);
      setExportImportMsg(libT.roleSaveFailed);
      setTimeout(() => setExportImportMsg(null), 3000);
    } finally {
      setEdit3dSubmitting(false);
    }
  }, [
    edit3dCharacterId,
    edit3dNickname,
    edit3dAvatarPreview,
    loadCharacters,
    resetImageTo3dEditModal,
    libT.roleNeedNickname,
    libT.roleSaved,
    libT.roleSaveFailed,
  ]);

  // 添加 / 修改角色（同一弹窗）
  const handleAddCharacter = useCallback(async () => {
    const nickname = addNickname.trim();
    if (!nickname) {
      setExportImportMsg(libT.roleNeedNickname);
      setTimeout(() => setExportImportMsg(null), 2000);
      return;
    }
    setAddSubmitting(true);
    try {
      const avatar = avatarFromViewImages(addViewImages);
      if (addModalEditingCharacterId) {
        if (!window.electronAPI?.updateCharacter) return;
        await window.electronAPI.updateCharacter(addModalEditingCharacterId, {
          nickname,
          name: nickname,
          avatar,
          voiceClip: addVoiceDataUrl.trim() ? addVoiceDataUrl.trim() : '',
          viewImages: [...addViewImages],
          imageDescription: addImageDescription.trim(),
        });
        await loadCharacters();
        setShowAddModal(false);
        resetAddCharacterForm();
        setExportImportMsg(libT.roleSaved);
        setTimeout(() => setExportImportMsg(null), 2000);
      } else if (window.electronAPI?.createCharacter) {
        await window.electronAPI.createCharacter(
          nickname,
          nickname,
          avatar,
          undefined,
          undefined,
          addVoiceDataUrl || undefined,
          [...addViewImages],
          addImageDescription.trim() || undefined,
        );
        await loadCharacters();
        setShowAddModal(false);
        resetAddCharacterForm();
        setExportImportMsg(libT.roleAdded);
        setTimeout(() => setExportImportMsg(null), 2000);
      }
    } catch (err) {
      console.error(addModalEditingCharacterId ? '保存角色失败:' : '添加角色失败:', err);
      setExportImportMsg(addModalEditingCharacterId ? libT.roleSaveFailed : libT.roleAddFailed);
      setTimeout(() => setExportImportMsg(null), 3000);
    } finally {
      setAddSubmitting(false);
    }
  }, [
    addModalEditingCharacterId,
    addNickname,
    addVoiceDataUrl,
    addViewImages,
    addImageDescription,
    loadCharacters,
    resetAddCharacterForm,
  ]);

  const handleAddVoiceSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) {
      setExportImportMsg('请选择音频文件');
      setTimeout(() => setExportImportMsg(null), 2000);
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setExportImportMsg('音频大小不能超过 20MB');
      setTimeout(() => setExportImportMsg(null), 2000);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === 'string') {
        if (addModalVoiceAudioRef.current) {
          addModalVoiceAudioRef.current.pause();
          addModalVoiceAudioRef.current.src = '';
          addModalVoiceAudioRef.current = null;
        }
        setAddModalVoicePlaying(false);
        setAddVoiceDataUrl(result);
        setAddVoiceLabel(file.name || '已选择音频');
      }
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = '';
  }, []);

  const handleAddViewSlotSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const idx = addViewSlotIndexRef.current;
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setExportImportMsg('请选择图片文件');
      setTimeout(() => setExportImportMsg(null), 2000);
      if (e.target) e.target.value = '';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setExportImportMsg('单张四视图图片不能超过 5MB');
      setTimeout(() => setExportImportMsg(null), 2000);
      if (e.target) e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === 'string') {
        setAddViewImages((prev) => {
          const next: [string, string, string, string] = [...prev];
          if (idx >= 0 && idx < 4) next[idx] = result;
          return next;
        });
      }
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = '';
  }, []);

  const handlePickVoiceFromCanvas = useCallback(async () => {
    if (!requestVoicePickFromCanvas) return;
    stopAddModalVoicePreview();
    addCharacterFormDraftRef.current = {
      nickname: addNickname,
      voice: addVoiceDataUrl,
      voiceLabel: addVoiceLabel,
      views: [...addViewImages],
      imageDescription: addImageDescription,
      editingCharacterId: addModalEditingCharacterId,
    };
    setShowAddModal(false);
    try {
      const payload = await requestVoicePickFromCanvas();
      const d = addCharacterFormDraftRef.current;
      if (d) {
        setAddNickname(d.nickname);
        if (payload?.url?.trim()) {
          setAddVoiceDataUrl(payload.url.trim());
          setAddVoiceLabel((payload.label && payload.label.trim()) || '来自画布');
        } else {
          setAddVoiceDataUrl(d.voice);
          setAddVoiceLabel(d.voiceLabel);
        }
        setAddViewImages([...(d.views || EMPTY_FOUR_VIEWS)] as [string, string, string, string]);
        setAddImageDescription(d.imageDescription || '');
        setAddModalEditingCharacterId(d.editingCharacterId ?? null);
      }
    } finally {
      addCharacterFormDraftRef.current = null;
      setShowAddModal(true);
    }
  }, [
    requestVoicePickFromCanvas,
    addNickname,
    addVoiceDataUrl,
    addVoiceLabel,
    addViewImages,
    addImageDescription,
    addModalEditingCharacterId,
    stopAddModalVoicePreview,
  ]);

  const handlePickViewSlotFromCanvas = useCallback(
    async (slot: number) => {
      if (!requestViewSlotPickFromCanvas || slot < 0 || slot > 3) return;
      stopAddModalVoicePreview();
      addCharacterFormDraftRef.current = {
        nickname: addNickname,
        voice: addVoiceDataUrl,
        voiceLabel: addVoiceLabel,
        views: [...addViewImages],
        imageDescription: addImageDescription,
        editingCharacterId: addModalEditingCharacterId,
      };
      setShowAddModal(false);
      try {
        const url = await requestViewSlotPickFromCanvas(slot);
        const d = addCharacterFormDraftRef.current;
        if (d) {
          setAddNickname(d.nickname);
          setAddVoiceDataUrl(d.voice);
          setAddVoiceLabel(d.voiceLabel);
          const base = [...(d.views || EMPTY_FOUR_VIEWS)] as [string, string, string, string];
          if (url?.trim()) {
            base[slot] = url.trim();
            setAddReverseSlot(slot);
          }
          setAddViewImages(base);
          setAddImageDescription(d.imageDescription || '');
          setAddModalEditingCharacterId(d.editingCharacterId ?? null);
        }
      } finally {
        addCharacterFormDraftRef.current = null;
        setShowAddModal(true);
      }
    },
    [
      requestViewSlotPickFromCanvas,
      addNickname,
      addVoiceDataUrl,
      addVoiceLabel,
      addViewImages,
      addImageDescription,
      addModalEditingCharacterId,
      stopAddModalVoicePreview,
    ],
  );

  if (loading && characters.length === 0) {
    return (
      <div className={`h-full flex items-center justify-center ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
        <div className="text-sm">加载中...</div>
      </div>
    );
  }

  // 收起状态：仅显示箭头和角色数，点击任意处展开（嵌入模式由 AssetLibrarySidebar 处理）
  if (!embedded && isCollapsed) {
    return (
      <>
      <div
        onClick={onToggleCollapse}
        className={`h-full w-12 flex flex-col items-center py-4 border-r cursor-pointer hover:bg-white/5 transition-colors ${
          isDarkMode ? 'apple-panel border-white/10' : 'apple-panel-light border-gray-300/30'
        }`}
        title="点击展开角色列表"
      >
        <ChevronRight className={`w-5 h-5 mt-1 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`} />
        <div className="flex-1 flex items-center justify-center">
          <User className={`w-6 h-6 ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`} />
        </div>
        <div className={`text-xs mb-2 ${isDarkMode ? 'text-white/40' : 'text-gray-400'}`}>
          {characters.length}
        </div>
      </div>
    </>
    );
  }

  // 展开状态：显示完整列表
  return (
    <div
      className={`h-full flex flex-col min-h-0 ${
        embedded ? 'flex-1' : `w-[280px] border-r ${isDarkMode ? 'apple-panel border-white/10' : 'apple-panel-light border-gray-300/30'}`
      }`}
    >
      {/* 头部 / 工具栏 */}
      <div
        className={`${embedded ? 'px-3 py-2' : 'p-4'} border-b flex items-center justify-between flex-shrink-0 flex-wrap gap-2 ${
          isDarkMode ? 'border-white/10' : 'border-gray-300/30'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {!embedded && (
            <h3 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>角色列表</h3>
          )}
          {filteredCharacters.length > 0 && (
            <>
              <button
                type="button"
                onClick={handleDeleteSelected}
                disabled={selectedIds.size === 0}
                className={assetLibDeleteToolbarBtn(isDarkMode, selectedIds.size > 0)}
                title={libT.roleDeleteSelected}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleSelectAll}
                className={`text-xs ${assetLibBtnSecondary(isDarkMode, '!py-0.5 !px-2', isDarkMode ? undefined : 'operators')}`}
                title={selectedIds.size === filteredCharacters.length ? libT.roleDeselectAll : libT.roleSelectAll}
              >
                {selectedIds.size === filteredCharacters.length ? libT.roleDeselectAll : libT.roleSelectAll}
              </button>
            </>
          )}
          {(!assetFilter || assetFilter === 'role') && (
            <button
              type="button"
              onClick={openAddCharacterModal}
              className={`text-xs flex items-center gap-1.5 shrink-0 ${assetLibBtnPrimary(isDarkMode, '!py-0.5 !px-2', 'control')}`}
              title={libT.roleAdd}
            >
              <span
                className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed ${
                  isDarkMode ? 'border-white/30 text-white/55' : 'border-gray-400 text-gray-500'
                }`}
              >
                <Plus className="w-3 h-3" strokeWidth={2.5} />
              </span>
              {libT.roleAdd}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {assetFilter !== 'imageTo3d' && (
            <>
              <button
                onClick={handleExport}
                className={assetLibBtnIcon(isDarkMode, isDarkMode ? undefined : 'motion')}
                title={libT.roleExportTitle}
              >
                <Upload className="w-4 h-4" />
              </button>
              <button
                onClick={handleImport}
                className={assetLibBtnIcon(isDarkMode, isDarkMode ? undefined : 'operators')}
                title={libT.roleImportTitle}
              >
                <Download className="w-4 h-4" />
              </button>
            </>
          )}
          {assetFilter === 'imageTo3d' && (
            <>
              <button
                onClick={handleExport3d}
                className={assetLibBtnIcon(isDarkMode)}
                title={libT.roleExport3dTitle}
              >
                <Upload className="w-4 h-4" />
              </button>
              <button
                onClick={handleImport3d}
                className={assetLibBtnIcon(isDarkMode)}
                title={libT.roleImport3dTitle}
              >
                <Download className="w-4 h-4" />
              </button>
            </>
          )}
          {showImport3d && assetFilter !== 'imageTo3d' && (
            <button
              onClick={handleImport3d}
              className={assetLibBtnIcon(isDarkMode)}
              title={libT.roleImport3dExtraTitle}
            >
              <Box className="w-4 h-4" />
            </button>
          )}
          {!embedded && (
            <button
              onClick={onToggleCollapse}
              className={assetLibBtnIcon(isDarkMode)}
              title={libT.roleCollapseList}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
      {exportImportMsg && (
        <div className={`px-3 py-1.5 text-xs ${assetLibMsgSuccess(isDarkMode)}`}>
          {exportImportMsg}
        </div>
      )}

      {viewMode === 'gallery' ? (
        <div className={`px-3 py-2 flex-shrink-0 ${embedded ? '' : ''}`}>
          <input
            type="search"
            value={gallerySearch}
            onChange={(e) => setGallerySearch(e.target.value)}
            placeholder={libT.gallerySearchPlaceholder}
            className={`w-full rounded-full px-3 py-2 text-xs outline-none border ${
              isDarkMode
                ? 'bg-white/[0.06] border-white/10 text-white placeholder:text-white/35'
                : 'bg-white border-gray-200 text-gray-900 placeholder:text-gray-400'
            }`}
          />
        </div>
      ) : null}

      {/* 角色列表 */}
      <div
        ref={characterListScrollRef}
        className={`flex-1 overflow-y-auto min-h-0 ${viewMode === 'gallery' ? 'px-4 pb-4' : 'p-3'} ${isDarkMode ? 'custom-scrollbar-dark' : 'custom-scrollbar'}`}
      >
        {viewMode === 'gallery' ? (
          <div
            className={`grid ${
              assetFilter === 'imageTo3d'
                ? 'gap-4 grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3'
                : 'gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
            }`}
          >
            {galleryFilteredCharacters.map((character) => {
              if (!character?.id) return null;
              const is3dEntry = isImageTo3dLibraryCharacter(character);
              const show3dGalleryHover = is3dEntry && characterHasGlbForPreview(character);
              const is3dGalleryPreviewActive =
                show3dGalleryHover && galleryHovered3dId === character.id;
              const thumb = resolveCharacterThumbSrc(character);
              const displayName = character.nickname || character.name || '未命名';
              const typeLabel = is3dEntry ? libT.galleryTypeModel3d : libT.galleryTypeImage;
              const galleryAspect =
                assetFilter === 'imageTo3d' || is3dEntry ? 'aspect-square' : 'aspect-[9/16]';
              return (
                <div
                  key={character.id}
                  draggable
                  onDragStart={(e) => handleCharacterCardDragStart(character, e)}
                  onClick={(e) => handleToggleSelect(character.id, e)}
                  onMouseEnter={
                    show3dGalleryHover
                      ? () => {
                          preloadImageTo3dCharacter(character);
                          setGalleryHovered3dId(character.id);
                        }
                      : undefined
                  }
                  onMouseLeave={
                    show3dGalleryHover
                      ? () => {
                          setGalleryHovered3dId((id) => (id === character.id ? null : id));
                        }
                      : undefined
                  }
                  className={`relative ${galleryAspect} rounded-xl overflow-hidden border cursor-pointer group ${
                    selectedIds.has(character.id)
                      ? assetLibGalleryCardSelected(isDarkMode)
                      : isDarkMode
                        ? 'border-white/10 bg-zinc-900/90'
                        : 'border-gray-200 bg-gray-100'
                  }`}
                >
                  {is3dGalleryPreviewActive ? (
                    <div className="absolute inset-0 z-[1] bg-[#1a1a1e]">
                      <ImageTo3dInlineGlbPreview character={character} showReferencePlaceholder />
                    </div>
                  ) : thumb ? (
                    <AssetLibLazyThumb
                      src={thumb}
                      alt={displayName}
                      className="absolute inset-0 w-full h-full"
                      imgClassName="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      maxEdge={320}
                      placeholderClassName={isDarkMode ? 'bg-zinc-800' : 'bg-gray-200'}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      {is3dEntry ? (
                        <Box className={`w-10 h-10 ${isDarkMode ? 'text-cyan-400/50' : 'text-cyan-600/40'}`} />
                      ) : (
                        <User className={`w-10 h-10 ${isDarkMode ? 'text-white/20' : 'text-gray-300'}`} />
                      )}
                    </div>
                  )}
                  <div
                    className={`pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-black/75 to-transparent transition-opacity duration-150 ${
                      is3dGalleryPreviewActive ? 'opacity-0' : 'opacity-100'
                    }`}
                    aria-hidden
                  />
                  <span
                    className={`absolute bottom-1.5 left-1.5 z-[2] px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-black/55 text-white/90 backdrop-blur-sm transition-opacity duration-150 ${
                      is3dGalleryPreviewActive ? 'opacity-0' : 'opacity-100'
                    }`}
                  >
                    {typeLabel}
                  </span>
                  <p
                    className={`absolute bottom-1.5 right-1.5 z-[2] max-w-[72%] text-right text-xs font-medium leading-snug truncate text-white drop-shadow-sm transition-opacity duration-150 ${
                      is3dGalleryPreviewActive ? 'opacity-0' : 'opacity-100'
                    }`}
                    title={displayName}
                  >
                    {displayName}
                  </p>
                </div>
              );
            })}
          </div>
        ) : filteredCharacters.length === 0 ? null : (
          <div className="space-y-2">
            {filteredCharacters.map((character) => {
              // 空值保护：确保 character 存在且有效
              if (!character || !character.id) {
                return null;
              }
              
              const is3dEntry = isImageTo3dLibraryCharacter(character);
              const hasVoice = !is3dEntry && !!resolveCharacterVoiceUrlForDrag(character);

              const showFourViewHover = !is3dEntry && characterHasViewImages(character);
              const show3dHover = is3dEntry && characterHasGlbForPreview(character);

              const clearImageTo3dHoverLeaveTimer = () => {
                if (imageTo3dHoverLeaveTimerRef.current) {
                  clearTimeout(imageTo3dHoverLeaveTimerRef.current);
                  imageTo3dHoverLeaveTimerRef.current = null;
                }
              };

              const handleCardMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                if (show3dHover) {
                  clearImageTo3dHoverLeaveTimer();
                  preloadImageTo3dCharacter(character);
                  setFourViewHover(null);
                  setImageTo3dHover({ character, rect });
                } else if (showFourViewHover) {
                  setImageTo3dHover(null);
                  setFourViewHover({ character, rect });
                }
              };

              const handleCardMouseLeave = () => {
                if (show3dHover) {
                  clearImageTo3dHoverLeaveTimer();
                  // 短延迟：缩略图异步替换 DOM 时避免预览闪断
                  imageTo3dHoverLeaveTimerRef.current = setTimeout(() => {
                    setImageTo3dHover((cur) => (cur?.character.id === character.id ? null : cur));
                    imageTo3dHoverLeaveTimerRef.current = null;
                  }, 120);
                  return;
                }
                setImageTo3dHover(null);
                setFourViewHover(null);
              };

              return (
              <div
                key={character.id}
                draggable
                onDragStart={(e) => handleCharacterCardDragStart(character, e)}
                onClick={(e) => handleToggleSelect(character.id, e)}
                onMouseEnter={show3dHover || showFourViewHover ? handleCardMouseEnter : undefined}
                onMouseLeave={show3dHover || showFourViewHover ? handleCardMouseLeave : undefined}
                title={
                  is3dEntry
                    ? show3dHover
                      ? '悬停预览 3D 模型'
                      : '拖到画布创建图片转 3D 节点'
                    : showFourViewHover
                      ? '悬停查看四视图'
                      : undefined
                }
                className={`group relative flex items-center p-3 rounded-xl transition-all cursor-pointer ${
                  selectedIds.has(character.id)
                    ? assetLibListCardSelected(isDarkMode)
                    : assetLibListCard(isDarkMode)
                }`}
              >
                {/* 角色头像（取自四视图首图） */}
                <div
                  className="flex-shrink-0 relative rounded-full"
                  title={is3dEntry ? '3D 模型（参考图缩略图）' : '角色头像（取自四视图首图）'}
                >
                  {resolveCharacterThumbSrc(character) ? (
                    <AssetLibLazyThumb
                      src={resolveCharacterThumbSrc(character)}
                      alt={character?.nickname || character?.name || '角色'}
                      className="w-12 h-12 rounded-full overflow-hidden border-2 border-zinc-600"
                      imgClassName="w-12 h-12 rounded-full object-cover"
                      maxEdge={128}
                      placeholderClassName={isDarkMode ? 'bg-zinc-800' : 'bg-gray-200'}
                    />
                  ) : (
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 border-zinc-600 ${
                      isDarkMode ? 'bg-white/10' : 'bg-gray-200/50'
                    }`}>
                      {is3dEntry ? (
                        <Box className={`w-6 h-6 ${isDarkMode ? 'text-cyan-300/80' : 'text-cyan-700'}`} />
                      ) : character?.nickname || character?.name ? (
                        <span className={`text-sm font-bold ${
                          isDarkMode ? 'text-white/60' : 'text-gray-600'
                        }`}>
                          {(character.nickname || character.name).charAt(0).toUpperCase()}
                        </span>
                      ) : (
                        <User className={`w-6 h-6 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`} />
                      )}
                    </div>
                  )}
                  {is3dEntry ? (
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 rounded px-1 text-[9px] font-bold leading-tight ${
                        isDarkMode ? 'bg-cyan-600/90 text-white' : 'bg-cyan-600 text-white'
                      }`}
                    >
                      3D
                    </span>
                  ) : null}
                </div>

                {/* 角色信息：仅一行展示名；试听 / 复制 / 主页在右侧 */}
                <div className="ml-3 flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {editingCharacterId === character.id ? (
                      <input
                        ref={nicknameInputRef}
                        type="text"
                        value={editingNickname}
                        onChange={(e) => setEditingNickname(e.target.value)}
                        onBlur={handleSaveNickname}
                        onClick={(e) => e.stopPropagation()}
                        draggable={false}
                        className={`flex-1 min-w-0 text-sm font-bold bg-transparent outline-none border-b border-current ${
                          isDarkMode ? 'text-white' : 'text-gray-900'
                        }`}
                        placeholder="备注昵称"
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => handleNicknameDoubleClick(character, e)}
                        className={`character-card-title flex-1 text-sm font-bold truncate cursor-text ${
                          isDarkMode ? 'text-white' : 'text-gray-900'
                        }`}
                        title="双击编辑昵称"
                      >
                        {character?.nickname || character?.name || '未命名角色'}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-0.5 ml-1">
                  <button
                    type="button"
                    draggable={false}
                    onClick={(e) => {
                      if (is3dEntry) {
                        openEditImageTo3dCharacter(character, e);
                      } else {
                        openEditCharacterMaterials(character, e);
                      }
                    }}
                    className={`${assetLibCardActionBtn(isDarkMode, 'control')} opacity-0 group-hover:opacity-100 transition-opacity`}
                    title={is3dEntry ? libT.model3dEditTitle : '修改参考音与四视图'}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {!is3dEntry && (
                  <button
                    type="button"
                    draggable={false}
                    onClick={(e) => handlePreviewVoice(character, e)}
                    disabled={!hasVoice}
                    className={`p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity transition-colors ${
                      !hasVoice
                        ? isDarkMode
                          ? 'text-white/20 cursor-not-allowed'
                          : 'opacity-35 cursor-not-allowed rounded-full p-1.5 scratch-float-btn scratch-tint scratch-tint--sound'
                        : previewingCharacterId === character.id
                          ? isDarkMode
                            ? 'bg-sky-600/35 text-sky-200 border border-sky-500/40'
                            : `${assetLibCardActionBtn(isDarkMode, 'sound')} ring-2 ring-white/80`
                          : assetLibCardActionBtn(isDarkMode, 'sound')
                    }`}
                    title={hasVoice ? (previewingCharacterId === character.id ? libT.roleStopPreview : libT.rolePreviewVoice) : libT.roleNoVoice}
                  >
                    {previewingCharacterId === character.id ? (
                      <Square className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Headphones className="w-3.5 h-3.5" />
                    )}
                  </button>
                  )}
                  {assetFilter !== 'imageTo3d' ? (
                  <button
                    type="button"
                    draggable={false}
                    onClick={(e) => handleCopyCharacterDisplayName(character, e)}
                    className={`p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity transition-colors ${
                      copiedCharacterId === character.id
                        ? assetLibCopySuccess(isDarkMode)
                        : assetLibCardActionBtn(isDarkMode, 'operators')
                    }`}
                    title="复制角色名"
                  >
                    {copiedCharacterId === character.id ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                  ) : null}
                  {character.permalink && character.permalink.startsWith('http') && (
                    <button
                      type="button"
                      draggable={false}
                      onClick={(e) => handleJumpToRole(character, e)}
                      className={`p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${assetLibBtnIcon(isDarkMode, 'motion')} !p-1.5`}
                      title="打开角色主页"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

              </div>
              );
            })}
          </div>
        )}
      </div>

      {fourViewHover && assetFilter !== 'imageTo3d' ? (
        <CharacterFourViewHoverPreview
          character={fourViewHover.character}
          anchorRect={fourViewHover.rect}
          isDarkMode={isDarkMode}
        />
      ) : null}

      {imageTo3dHover ? (
        <ImageTo3dLibraryHoverPreview
          character={imageTo3dHover.character}
          anchorRect={imageTo3dHover.rect}
          isDarkMode={isDarkMode}
        />
      ) : null}

      {/* 添加 / 修改角色素材弹窗 */}
      {showAddModal &&
        createPortal(
          <div
            className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 ${assetLibEditModalBackdrop(isDarkMode)}`}
            onClick={() => {
              if (addSubmitting) return;
              resetAddCharacterForm();
              setShowAddModal(false);
            }}
          >
            <div
              className={`relative w-full max-w-5xl rounded-2xl border p-5 shadow-xl overflow-hidden max-h-[92vh] overflow-y-auto ${assetLibEditModalPanel(isDarkMode)}`}
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
                  {addModalEditingCharacterId ? libT.roleEditMaterials : libT.roleAddTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    if (addSubmitting) return;
                    resetAddCharacterForm();
                    setShowAddModal(false);
                  }}
                  className={assetLibBtnIcon(isDarkMode, assetLibEditModalCloseScratch(isDarkMode))}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative space-y-4">
                <div>
                  <label className={`block text-xs font-medium mb-1 ${assetLibEditModalLabel(isDarkMode)}`}>
                    {libT.roleNicknameLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={addNickname}
                    onChange={(e) => setAddNickname(e.target.value)}
                    placeholder={libT.roleNicknamePlaceholder}
                    disabled={addSubmitting}
                    className={`w-full px-2 py-1.5 rounded-lg border text-sm outline-none transition-shadow disabled:opacity-50 ${assetLibEditModalInput(isDarkMode)}`}
                  />
                </div>
                {/* 左：参考音 · 右：形象描述（等宽等高） */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-stretch min-h-[220px]">
                  <div className="min-w-0 flex flex-col h-full">
                    <label
                      htmlFor="add-character-voice-input"
                      className={`block text-xs mb-1.5 font-semibold shrink-0 ${
                        isDarkMode ? 'text-white/80' : 'text-[var(--scratch-sound)]'
                      }`}
                    >
                      {libT.roleUploadVoice}
                    </label>
                    <input
                      ref={addVoiceInputRef}
                      id="add-character-voice-input"
                      type="file"
                      accept="audio/*,.mp3,.wav,.webm,.ogg,.m4a,audio/mpeg"
                      onChange={handleAddVoiceSelect}
                      className="hidden"
                      aria-label={libT.roleUploadVoice}
                      title={libT.roleUploadVoice}
                    />
                    <div className="flex flex-1 flex-col gap-2 min-h-0">
                      {!addVoiceDataUrl ? (
                        <button
                          type="button"
                          onClick={() => addVoiceInputRef.current?.click()}
                          disabled={addSubmitting}
                          title={libT.roleUploadVoiceOptional}
                          aria-label={libT.roleUploadVoice}
                          className={`w-full flex-1 min-h-[7rem] rounded-xl border-2 border-dashed flex items-center justify-center gap-2 px-2 transition-colors disabled:opacity-50 ${
                            isDarkMode
                              ? 'border-white/20 hover:border-sky-500/60 hover:bg-white/5 text-white/70'
                              : 'border-[var(--scratch-sound)]/55 bg-fuchsia-50/90 text-fuchsia-800/75 hover:border-[var(--scratch-sound)]'
                          }`}
                        >
                          <Mic className="h-5 w-5 shrink-0" aria-hidden />
                          <span className="text-xs">{libT.roleUploadVoiceClick}</span>
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void toggleAddModalVoicePreview()}
                            disabled={addSubmitting}
                            title={addModalVoicePlaying ? libT.roleStopPreview : libT.rolePreviewVoice}
                            aria-label={addModalVoicePlaying ? libT.roleStopPreview : libT.rolePreviewVoice}
                            className={`w-full flex-1 min-h-[7rem] rounded-xl border-2 px-2 py-2 flex items-center justify-center transition-colors disabled:opacity-50 ${
                              addModalVoicePlaying
                                ? isDarkMode
                                  ? 'border-sky-400/90 ring-2 ring-sky-400/45 bg-sky-500/15'
                                  : 'border-[var(--scratch-sound)] ring-2 ring-fuchsia-300/45 bg-fuchsia-50'
                                : isDarkMode
                                  ? 'border-sky-500/55 hover:border-sky-400/85 hover:bg-sky-500/10'
                                  : 'ring-1 ring-[var(--scratch-sound)]/35 border-[var(--scratch-sound)]/55 hover:border-[var(--scratch-sound)] bg-fuchsia-50/90'
                            }`}
                          >
                            <span className="sr-only">
                              {addModalVoicePlaying ? libT.roleStopPreview : libT.rolePreviewVoice}
                            </span>
                            <CharacterAddVoiceWaveformStrip seed={addVoiceDataUrl || addVoiceLabel || 'voice'} />
                          </button>
                          <div className="flex items-start justify-between gap-2 shrink-0">
                            <span
                              className={`text-xs min-w-0 flex-1 line-clamp-2 ${
                                isDarkMode ? 'text-white/55' : 'text-fuchsia-800/75'
                              }`}
                              title={addVoiceLabel || undefined}
                            >
                              {addVoiceLabel || libT.roleVoiceSelected}
                            </span>
                            <button
                              type="button"
                              disabled={addSubmitting}
                              title={libT.roleReplaceVoice}
                              aria-label={libT.roleReplaceVoice}
                              onClick={() => addVoiceInputRef.current?.click()}
                              className={`text-xs shrink-0 rounded-full px-2 py-0.5 transition-colors disabled:opacity-50 ${
                                isDarkMode
                                  ? 'text-sky-300/90 hover:bg-white/10'
                                  : 'text-[var(--scratch-sound)] hover:bg-fuchsia-100/80'
                              }`}
                            >
                              {libT.roleReplaceShort}
                            </button>
                          </div>
                        </>
                      )}
                      {requestVoicePickFromCanvas && (
                        <button
                          type="button"
                          onClick={() => void handlePickVoiceFromCanvas()}
                          disabled={addSubmitting}
                          title={libT.roleVoicePickTitle}
                          className={`mt-auto w-full py-2 px-2 text-xs font-medium shrink-0 disabled:opacity-50 ${assetLibBtnPrimary(
                            isDarkMode,
                            '!w-full',
                            assetLibEditModalCanvasPickScratch(isDarkMode, 0),
                          )}`}
                        >
                          {libT.rolePickFromCanvas}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex flex-col h-full">
                    <label className={`block text-xs font-medium mb-1.5 shrink-0 ${assetLibEditModalLabel(isDarkMode)}`}>
                      {libT.roleImageDescLabel}
                    </label>
                    <textarea
                      value={addImageDescription}
                      onChange={(e) => setAddImageDescription(e.target.value)}
                      placeholder={libT.roleImageDescPlaceholder}
                      disabled={addSubmitting || isReversing}
                      className={`w-full flex-1 min-h-[7rem] px-2 py-1.5 rounded-lg border text-sm outline-none transition-shadow resize-none disabled:opacity-50 ${assetLibEditModalInput(isDarkMode)}`}
                    />
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 shrink-0">
                      <select
                        value={normalizeImageReverseCaptionModel(addReverseModel)}
                        onChange={(e) =>
                          setAddReverseModel(normalizeImageReverseCaptionModel(e.target.value))
                        }
                        disabled={addSubmitting || isReversing}
                        title={libT.roleReverseModelLabel}
                        className={`px-2 py-1 rounded-lg text-xs flex-shrink-0 max-w-[140px] outline-none disabled:opacity-50 ${
                          isDarkMode
                            ? 'bg-white/[0.06] text-white border border-white/10'
                            : 'bg-black/[0.04] text-gray-900 border border-black/10'
                        }`}
                      >
                        <option value={LLM_CHAT_MODEL_GPT56_TERRA}>
                          {locale === 'en' ? 'LLM-5.6' : '大语言模型-5.6'}
                        </option>
                        <option value="joy-caption-two">Joy Caption Two</option>
                      </select>
                      {reversePriceLabel.ok ? (
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 tabular-nums border ${
                            isDarkMode
                              ? 'text-amber-200/90 bg-amber-500/15 border-amber-400/25'
                              : 'text-amber-700 bg-amber-50 border-amber-200'
                          }`}
                          title={libT.roleReversePriceTitle}
                        >
                          {reversePriceLabel.value}
                          {locale === 'en' ? ' ' : ''}
                          {libT.roleReverseCreditsSuffix}
                        </span>
                      ) : (
                        <span
                          className={`text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${
                            isDarkMode ? 'text-white/45 bg-white/10' : 'text-gray-500 bg-gray-100'
                          }`}
                          title={libT.roleReverseNoPrice}
                        >
                          {libT.roleReverseNoPrice}
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={
                          addSubmitting ||
                          isReversing ||
                          !addViewImages.some((u) => String(u || '').trim())
                        }
                        onClick={() => {
                          const selected =
                            addReverseSlot != null && String(addViewImages[addReverseSlot] || '').trim()
                              ? addReverseSlot
                              : addViewImages.findIndex((u) => String(u || '').trim());
                          if (selected < 0) {
                            setExportImportMsg(libT.roleReverseNeedImage);
                            setTimeout(() => setExportImportMsg(null), 2000);
                            return;
                          }
                          void runReverseForViewSlot(selected);
                        }}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 disabled:opacity-45 disabled:cursor-not-allowed transition-colors ${
                          isDarkMode
                            ? 'bg-sky-500/90 hover:bg-sky-400 text-white'
                            : 'bg-sky-600 hover:bg-sky-500 text-white'
                        }`}
                        title={libT.roleReverseRun}
                      >
                        {isReversing ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : null}
                        {isReversing ? libT.roleReversing : libT.roleReverseRun}
                      </button>
                    </div>
                    {addReverseError ? (
                      <p
                        className={`text-[11px] mt-1 shrink-0 ${
                          isDarkMode ? 'text-rose-300/90' : 'text-rose-600'
                        }`}
                        role="alert"
                      >
                        {addReverseError}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div>
                  <span
                    className={`block text-xs font-semibold mb-1.5 ${
                      isDarkMode ? 'text-white/80' : 'text-[var(--scratch-looks)]'
                    }`}
                  >
                    {libT.roleUploadFourViews}
                  </span>
                  <input
                    ref={addViewInputRef}
                    id="add-character-views-input"
                    type="file"
                    accept="image/*"
                    onChange={handleAddViewSlotSelect}
                    className="hidden"
                    aria-label="为四视图槽位选择图片"
                    title="选择四视图图片"
                  />
                  <div className="grid grid-cols-4 gap-1">
                    {[0, 1, 2, 3].map((slot) => (
                      <div key={slot} className="flex min-w-0 flex-col gap-1">
                        <button
                          type="button"
                          disabled={addSubmitting || isReversing}
                          title={
                            addViewImages[slot]
                              ? libT.roleReverseClickImageTitle
                              : `点击上传视图 ${slot + 1}`
                          }
                          aria-label={
                            addViewImages[slot]
                              ? libT.roleReverseClickImageTitle
                              : `上传角色四视图第 ${slot + 1} 格`
                          }
                          onClick={() => {
                            if (addViewImages[slot]) {
                              setAddReverseSlot(slot);
                              return;
                            }
                            addViewSlotIndexRef.current = slot;
                            addViewInputRef.current?.click();
                          }}
                          className={`relative aspect-[9/16] w-full rounded-md border overflow-hidden flex items-center justify-center transition-colors disabled:opacity-50 ${
                            addReverseSlot === slot && addViewImages[slot]
                              ? isDarkMode
                                ? 'border-sky-400 ring-2 ring-sky-400/50'
                                : 'border-sky-500 ring-2 ring-sky-300/60'
                              : isDarkMode
                                ? 'border-white/15 hover:border-blue-500/50 bg-black/30 text-white/50'
                                : 'border-[var(--scratch-looks)]/40 hover:border-[var(--scratch-looks)] bg-violet-50/40 text-[var(--scratch-looks)]/70'
                          }`}
                        >
                          {addViewImages[slot] ? (
                            <>
                              <img
                                src={addViewImages[slot]}
                                alt=""
                                className="absolute inset-0 h-full w-full object-cover"
                              />
                              {isReversing && addReverseSlot === slot ? (
                                <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                                  <Loader2 className="h-5 w-5 animate-spin text-white" aria-hidden />
                                </span>
                              ) : null}
                            </>
                          ) : (
                            <Plus className="h-6 w-6 opacity-70" aria-hidden />
                          )}
                        </button>
                        <div className="flex items-center gap-1">
                          {addViewImages[slot] ? (
                            <button
                              type="button"
                              disabled={addSubmitting || isReversing}
                              title={libT.roleReplaceShort}
                              onClick={() => {
                                addViewSlotIndexRef.current = slot;
                                addViewInputRef.current?.click();
                              }}
                              className={`flex-1 shrink-0 py-0.5 text-[10px] font-medium disabled:opacity-50 ${
                                isDarkMode
                                  ? 'text-sky-300/90 hover:bg-white/5 rounded'
                                  : 'text-[var(--scratch-looks)] hover:bg-violet-50 rounded'
                              }`}
                            >
                              {libT.roleReplaceShort}
                            </button>
                          ) : null}
                          {requestViewSlotPickFromCanvas && (
                            <button
                              type="button"
                              onClick={() => void handlePickViewSlotFromCanvas(slot)}
                              disabled={addSubmitting || isReversing}
                              title={libT.roleViewPickTitle}
                              className={`flex-1 shrink-0 py-1 px-0.5 text-[10px] font-medium leading-tight disabled:opacity-50 ${assetLibBtnPrimary(
                                isDarkMode,
                                '!w-full !py-1 !px-0.5 !text-[10px]',
                                assetLibEditModalCanvasPickScratch(isDarkMode, slot + 1),
                              )}`}
                            >
                              {libT.roleViewPickFromCanvas}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p
                    className={`text-[11px] mt-1.5 ${isDarkMode ? 'text-white/35' : 'text-violet-700/70'}`}
                  >
                    {addModalEditingCharacterId ? libT.roleFourViewsHintEdit : libT.roleFourViewsHint}
                  </p>
                </div>
              </div>
              <div className="relative flex justify-end gap-2 mt-4">
                <button
                  type="button"
                  onClick={() => {
                    if (addSubmitting) return;
                    resetAddCharacterForm();
                    setShowAddModal(false);
                  }}
                  disabled={addSubmitting}
                  className={assetLibBtnSecondary(
                    isDarkMode,
                    'text-xs !px-3 !py-1.5 disabled:opacity-50',
                    assetLibEditModalCancelScratch(isDarkMode),
                  )}
                >
                  {libT.roleCancel}
                </button>
                <button
                  type="button"
                  onClick={handleAddCharacter}
                  disabled={addSubmitting || !addNickname.trim()}
                  className={assetLibBtnPrimary(
                    isDarkMode,
                    'text-xs !px-3 !py-1.5 disabled:opacity-50',
                    assetLibEditModalSaveScratch(isDarkMode),
                  )}
                >
                  {addSubmitting
                    ? addModalEditingCharacterId
                      ? libT.roleSaving
                      : libT.roleAdding
                    : addModalEditingCharacterId
                      ? libT.roleSave
                      : libT.roleAddBtn}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 3D 模型库：编辑备注与参考图 */}
      {showImageTo3dEditModal && !edit3dModalHiddenForCanvasPick &&
        createPortal(
          <div
            className={`fixed inset-0 z-[10000] flex items-center justify-center p-4 ${assetLibEditModalBackdrop(isDarkMode)}`}
            onClick={() => {
              if (edit3dSubmitting) return;
              resetImageTo3dEditModal();
            }}
          >
            <div
              className={`relative w-full max-w-md rounded-2xl border p-4 shadow-xl overflow-hidden ${assetLibEditModalPanel(isDarkMode)}`}
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
                  {libT.model3dEditTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    if (edit3dSubmitting) return;
                    resetImageTo3dEditModal();
                  }}
                  className={assetLibBtnIcon(isDarkMode, assetLibEditModalCloseScratch(isDarkMode))}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="relative flex items-center gap-3 mb-4">
                <input
                  ref={edit3dAvatarInputRef}
                  type="file"
                  accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp"
                  className="hidden"
                  onChange={handleEdit3dAvatarFileSelect}
                  aria-hidden
                />
                <button
                  type="button"
                  disabled={edit3dSubmitting}
                  onClick={() => void handlePickImageTo3dAvatar()}
                  title={libT.model3dUploadAvatarLocal}
                  className="relative shrink-0 rounded-full disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60"
                >
                  {edit3dAvatarPreview ? (
                    <img
                      src={edit3dAvatarPreview}
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
                      <Box className={`w-7 h-7 ${isDarkMode ? 'text-violet-400' : 'text-[var(--scratch-looks)]'}`} />
                    </div>
                  )}
                </button>
                <div className="flex flex-col gap-1.5 min-w-0 flex-1">
                  <div className="flex flex-row flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handlePickImageTo3dAvatar()}
                      disabled={edit3dSubmitting}
                      className={assetLibBtnPrimary(
                        isDarkMode,
                        'text-xs !px-2.5 !py-1.5 gap-1 flex-1 min-w-[7rem]',
                        assetLibEditModalSecondaryActionScratch(isDarkMode),
                      )}
                    >
                      <Upload className="w-3.5 h-3.5 shrink-0" />
                      {libT.model3dUploadAvatarLocal}
                    </button>
                    {requestViewSlotPickFromCanvas ? (
                      <button
                        type="button"
                        onClick={() => void handlePickImageTo3dAvatarFromCanvas()}
                        disabled={edit3dSubmitting}
                        className={assetLibBtnPrimary(
                          isDarkMode,
                          'text-xs !px-2.5 !py-1.5 gap-1 flex-1 min-w-[7rem]',
                          assetLibEditModalCanvasPickScratch(isDarkMode, 1),
                        )}
                      >
                        <Layers className="w-3.5 h-3.5 shrink-0" />
                        {libT.rolePickFromCanvas}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <label className={`block text-xs mb-1 font-medium ${assetLibEditModalLabel(isDarkMode)}`}>
                {libT.roleNicknameLabel} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={edit3dNickname}
                onChange={(e) => setEdit3dNickname(e.target.value)}
                placeholder={libT.roleNicknamePlaceholder}
                disabled={edit3dSubmitting}
                className={`w-full mb-4 px-2 py-1.5 rounded-lg text-sm border outline-none transition-shadow disabled:opacity-50 ${assetLibEditModalInput(isDarkMode)}`}
              />
              <div className="relative flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (edit3dSubmitting) return;
                    resetImageTo3dEditModal();
                  }}
                  disabled={edit3dSubmitting}
                  className={assetLibBtnSecondary(
                    isDarkMode,
                    'text-xs !px-3 !py-1.5 disabled:opacity-50',
                    assetLibEditModalCancelScratch(isDarkMode),
                  )}
                >
                  {libT.roleCancel}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveImageTo3dEdit()}
                  disabled={edit3dSubmitting || !edit3dNickname.trim()}
                  className={assetLibBtnPrimary(
                    isDarkMode,
                    'text-xs !px-3 !py-1.5 disabled:opacity-50',
                    assetLibEditModalSaveScratch(isDarkMode),
                  )}
                >
                  {edit3dSubmitting ? libT.roleSaving : libT.roleSave}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

    </div>
  );
};

export default CharacterList;
