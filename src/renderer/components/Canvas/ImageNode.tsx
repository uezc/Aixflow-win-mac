import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo, startTransition } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { Handle, Position, NodeProps, Node, addEdge, useReactFlow, useStore, useStoreApi, useUpdateNodeInternals } from 'reactflow';
import { useFrozenFlowViewport, useFrozenFlowZoom } from '../../hooks/useFrozenFlowViewport';
import { motion } from 'framer-motion';
import {
  Upload,
  Loader2,
  Stamp,
  RotateCcw,
  Box,
  X,
  Image as ImageIcon,
  PenTool,
  Download,
  Globe,
  LayoutGrid,
  ChevronDown,
  FlipHorizontal2,
  FlipVertical2,
  Crop,
  Maximize2,
  ArrowUp,
  Check,
} from 'lucide-react';
import { ModuleProgressBar } from './ModuleProgressBar';
import { AiGeneratedBadge } from '../legal/AiGeneratedBadge';
import { useImageInputPanelAnchor } from '../../contexts/ImageInputPanelContext';
import { PanelOptionDropdown } from './PanelOptionDropdown';
import { useAI } from '../../hooks/useAI';
import {
  computeNodeSizeFromMedia,
  DEFAULT_IMAGE_ASPECT_RATIO,
  IMAGE_NODE_DEFAULT_H,
  IMAGE_NODE_DEFAULT_W,
  IMAGE_NODE_MAX_H,
  IMAGE_NODE_MAX_W,
  IMAGE_NODE_MIN_H,
  IMAGE_NODE_MIN_W,
  NODE_SIZE_TRANSITION,
  aspectRatioLabelFromPixelSize,
  imageNodeSizeForAspectRatio,
  nodeStyleDimensions,
  parseAspectRatioValue,
  probeImagePixelSize,
} from '../../utils/nodeSizeFromAspectRatio';
import {
  enqueueImageLoad,
  calcViewportPriority,
  isImageLoadedInSession,
  markImageLoadedInSession,
} from '../../utils/imageLoadPriorityQueue';
import { getGlobalInteractionSnapshot, useGlobalInteractionSelector } from '../../utils/globalInteractionStore';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { workspaceChromeT } from '../../i18n/workspaceI18n';
import { imageNodeChromeT, imageNodeCameraPresetLabel } from '../../i18n/imageNodeI18n';
import { imageInputPanelT } from '../../i18n/imageInputPanelI18n';
import { mapProjectPath } from '../../utils/pathMapper';
import CubeCameraController, { CameraControlValue } from './CubeCameraController';
import Panorama360Viewer from './Panorama360Viewer';
import ImageCropOverlay, { type ImageCropOverlayHandle } from './ImageCropModal';
import { cropImageToPngBuffer, type NormalizedCropRect } from '../../utils/imageCropUtils';
import {
  getPhotographyPrompt,
  DEFAULT_CAMERA_VALUE,
  SCALE_CLOSEUP,
  SCALE_MEDIUM,
  SCALE_WIDE,
  CAMERA_PRESETS,
  MAX_SCALE,
} from '../../utils/cameraControlUtils';
import { PERF_POLICY, TAPNOW_INTERACTION_SUSPEND } from '../../config/perfPolicy';
import {
  buildMultiImageGridPreviewDataUrl,
  estimateExpandAllGridFrameSize,
  EXPAND_ALL_GRID_GAP_PX,
  EXPAND_ALL_GRID_PAD_PX,
  getFullOutputImagesGridLayout,
  getOutputImageGridLayout,
  getOutputGridCellScreenRectsFromBounds,
  gridClassForLayout,
} from '../../utils/multiImageGridPreview';
import { CROSS_FADE_MS, FAR_PLACEHOLDER_HYSTERESIS, LOD_HYSTERESIS } from '../../config/renderPerfConstants';
import { useNxModelPricing } from '../../contexts/NxModelPricingContext';
import {
  getMattingDisplayPrice,
  getWatermarkRemovalDisplayPrice,
  getImageUpscaleV3DisplayPrice,
  getImageDisplayPrice,
} from '../../utils/cloudModelPricing';
import { isModelNotPricedError } from '../../utils/priceCalc';
import { filterImageModelsForMode, DEFAULT_IMAGE_MODEL } from '../../config/imageModelUiPolicy';
import {
  Z_IMAGE_ASPECT_RATIOS,
  normalizeZImageResolutionTier,
  zImageDimensionsForAspect,
} from '../../../common/zImageDimensions';
import {
  userFacingErrorMessage,
  refundHintForLocale,
  messageContainsRefundHint,
} from '../../utils/userErrorMessageCn';
import { type ScratchColorId } from '../../theme/scratchColors';
import {
  fillCanvasImageDragTransfer,
  endCanvasImageDrag,
} from '../characterListShared';

/** 工具栏「放大」：四角取景框 + 中心放大镜（currentColor） */
function ImageUpscaleToolbarIcon({ className = 'w-4 h-4 shrink-0' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 9V5h4" />
      <path d="M20 9V5h-4" />
      <path d="M4 15v4h4" />
      <path d="M20 15v4h-4" />
      <circle cx="11" cy="11" r="4.25" />
      <path d="M14.2 14.2L18 18" />
      <path d="M11 9.1v3.8" />
      <path d="M9.1 11h3.8" />
    </svg>
  );
}

/** 工具栏「抠图」：圆角图片框 + 人物上半身（无风景） */
function ImageMattingToolbarIcon({ className = 'w-4 h-4 shrink-0' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2.5" />
      <circle cx="12" cy="10" r="2.35" />
      <path d="M7.5 18c.7-2.6 2.2-3.75 4.5-3.75s3.8 1.15 4.5 3.75" />
    </svg>
  );
}

interface ImageNodeData {
  width?: number;
  height?: number;
  outputImage?: string;
  outputImages?: string[];
  localPath?: string; // 本地文件路径（用于 fallback）
  originalImageUrl?: string; // 原始远程 URL（用于 fallback）
  tinyThumbUrl?: string;
  avgColorHex?: string;
  imageAsset?: {
    preview?: string;
    tiny?: string;
    original?: string;
    ghost?: string;
    avgColorHex?: string;
    width?: number;
    height?: number;
  };
  title?: string;
  prompt?: string;
  resolution?: string;
  aspectRatio?: string;
  inputImages?: string[]; // 输入的参考图数组（最多10张）
  progress?: number; // 图片生成进度 0-100
  progressMessage?: string; // 进度状态文案
  /** 最近一次生成耗时（秒），用于标题旁标签展示 */
  lastElapsedSec?: number;
  errorMessage?: string; // 错误信息
  /** 参考图标记笔画（图生图时便于模型理解意图），归一化坐标 0-1 */
  imageDrawStrokes?: { color: string; points: { x: number; y: number }[] }[];
  /** 3D 视角控制器参数（集成在 Image 内） */
  cameraControl?: { rotationX: number; rotationY: number; scale: number; fov: number };
  /** 摄影语义 payload，供下游 AI 节点消费 */
  prompt_payload?: Record<string, unknown>;
  /** 预览水平镜像 */
  flipH?: boolean;
  /** 预览垂直镜像 */
  flipV?: boolean;
  /** 拆帧/导出等已写入目标外框时，避免被面板或 onLoad 覆盖比例 */
  preserveExportLayout?: boolean;
  /** 新建视角模块后自动打开 3D 控制器（一次性） */
  open3DPopover?: boolean;
  /** 由「3D 视角」从原图派生的视角模块：点击立方体仅开关本模块控制器 */
  isCameraViewModule?: boolean;
  /** 模块内预览：平面图 / 360° 球幕环视（不打开全景摆放弹窗） */
  viewMode?: 'flat' | 'panorama360';
  /** 场景库 3D 展示图（等距柱状）；有则优先作为 360 纹理 */
  sceneDisplay3dUrl?: string;
  /** 进入 360 前的模块尺寸，退出时还原 */
  panorama360BaseWidth?: number;
  panorama360BaseHeight?: number;
}

interface ImageNodeProps extends NodeProps<ImageNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
  prefetchScreenFactor?: number;
  projectId?: string; // 项目ID，用于路径映射
  /** 抠图/去水印完成后回调，用于将结果加入任务列表 */
  onAuxImageTaskComplete?: (params: {
    nodeId: string;
    type: 'matting' | 'watermark' | 'multi-angle' | 'upscale-v3';
    imageUrl: string;
    imageUrls?: string[];
  }) => void;
  onPreviewImage?: (url: string, nodeId?: string) => void;
  /** 画板：在画板工具中打开当前图片进行绘图标记 */
  onOpenDrawingBoard?: (url: string, nodeId: string, localPath?: string) => void;
  /** 一键拆分等：将新图片节点写入 Workspace 画布状态 */
  onAddCanvasImageNodes?: (nodes: Node[]) => void;
}

/** 捕获 3D/WebGL 渲染错误，避免整个应用崩溃 */
class Local3DErrorBoundary extends React.Component<
  { fallback: React.ReactNode; onError?: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError = () => ({ hasError: true });
  componentDidCatch() {
    this.props.onError?.();
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function isAbortLikeError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const name = 'name' in err && typeof (err as { name: unknown }).name === 'string' ? (err as { name: string }).name : '';
  return name === 'AbortError';
}

/** 全能图片 V2 图生图支持的比例 */
const CAMERA_BANANA_ASPECTS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
] as const;
/** Seedream v5 图生图支持的比例与像素 */
const CAMERA_SEEDREAM_V5_RATIO_MAP: Record<string, { width: number; height: number }> = {
  '1:1': { width: 2048, height: 2048 },
  '2:3': { width: 1664, height: 2496 },
  '3:2': { width: 2496, height: 1664 },
  '3:4': { width: 1728, height: 2304 },
  '4:3': { width: 2304, height: 1728 },
  '9:16': { width: 1600, height: 2845 },
  '16:9': { width: 2560, height: 1440 },
  '21:9': { width: 3136, height: 1344 },
};
const CAMERA_SEEDREAM_ASPECTS = Object.keys(CAMERA_SEEDREAM_V5_RATIO_MAP);

function snapAspectToAllowed(label: string, allowed: readonly string[]): string {
  if (allowed.includes(label)) return label;
  const parsed = parseAspectRatioValue(label);
  if (!parsed) return allowed[0] || '1:1';
  const target = parsed.w / parsed.h;
  let best = allowed[0] || '1:1';
  let bestDiff = Infinity;
  for (const opt of allowed) {
    const p = parseAspectRatioValue(opt);
    if (!p) continue;
    const diff = Math.abs(Math.log(target / (p.w / p.h)));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = opt;
    }
  }
  return best;
}

// 格式化图片路径：统一转换为 local-resource:// 协议
const formatImagePath = (path: string): string => {
  if (!path) return '';
  // 如果是 HTTP/HTTPS URL，直接返回
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  // 如果是 data: URL，直接返回
  if (path.startsWith('data:')) {
    return path;
  }
  // 如果已经是 local-resource:// 格式，直接返回（协议处理器会自己处理解码）
  if (path.startsWith('local-resource://')) {
    return path;
  }
  // 移除可能存在的协议头，统一转换
  const cleanPath = path.replace(/^(file:\/\/|local-resource:\/\/)/, '');
  // 转换为 local-resource:// 协议，并将反斜杠替换为正斜杠
  // 注意：不要对整个路径编码，只对中文和空格部分编码，盘符的冒号必须保持原样
  let normalizedPath = cleanPath.replace(/\\/g, '/');
  
  // 修复盘符格式：如果路径是 "c/Users" 格式（缺少冒号），修正为 "C:/Users"
  // 这是关键修复：确保盘符格式正确
  if (normalizedPath.match(/^([a-zA-Z])\//)) {
    normalizedPath = normalizedPath[0].toUpperCase() + ':' + normalizedPath.substring(1);
  }
  
  // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
  if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
    normalizedPath = normalizedPath.substring(1); // 移除开头的 /
  }
  
  // 只对路径中的中文和空格部分进行编码，保留盘符的冒号
  // 分段处理，但不对盘符部分（如 C:）编码
  const pathParts = normalizedPath.split('/');
  const encodedParts = pathParts.map((part, index) => {
    // 如果是第一段且是 Windows 盘符（如 C:），不编码
    if (index === 0 && /^[a-zA-Z]:$/.test(part)) {
      return part;
    }
    // 其他部分：只对包含中文或空格的部分进行编码
    if (/[\u4e00-\u9fa5\s]/.test(part)) {
      // 包含中文或空格，需要编码
      return encodeURIComponent(part);
    }
    // 不包含中文或空格，保持原样
    return part;
  });
  const encodedPath = encodedParts.join('/');
  
  return `local-resource://${encodedPath}`;
};

function isLocalDiskMediaUrl(url: string): boolean {
  const u = (url || '').trim();
  return (
    u.startsWith('local-resource://') ||
    u.startsWith('file:') ||
    u.startsWith('data:') ||
    u.startsWith('blob:') ||
    /^[a-zA-Z]:[\\/]/.test(u)
  );
}

function isHttpLikeMediaUrl(url: string): boolean {
  return /^https?:\/\//i.test((url || '').trim());
}

/** 非远程 http(s) 的地址（含 local-resource、file、盘符路径、项目相对 assets 等），应优先于过期 OSS 缩略图 */
function isNonHttpMediaUrl(url: string): boolean {
  const u = (url || '').trim();
  return !!u && !isHttpLikeMediaUrl(u);
}

/**
 * 合并 props 与 state 的主图地址。抠图/去水印等先写回 OSS 临时链到 state，随后 autoSave 把 data 换成 local-resource；
 * 若仍优先 state 的 http，会拉已失效链 →「一闪后加载失败」，而任务列表已用本地 URL 正常。
 */
function mergePrimaryImageOutput(
  outputImageState: string,
  outputImagesState: string[],
  dataOutputImage: string | undefined,
  dataOutputImages: unknown[] | undefined,
): string {
  const fromData = (dataOutputImage || '').trim();
  const fromDataFmt = fromData ? formatImagePath(fromData) : '';
  const dataList0 =
    Array.isArray(dataOutputImages) && dataOutputImages.length > 0
      ? formatImagePath(String(dataOutputImages[0] || ''))
      : '';
  const stateFmt = outputImageState.trim() ? formatImagePath(outputImageState) : '';
  const stateList0 =
    outputImagesState.length > 0 ? formatImagePath(String(outputImagesState[0] || '')) : '';

  const firstLocal = [fromDataFmt, dataList0].find((u) => u && isNonHttpMediaUrl(u)) || '';
  if (firstLocal) {
    if (stateFmt && isHttpLikeMediaUrl(stateFmt)) return firstLocal;
    if (stateList0 && isHttpLikeMediaUrl(stateList0)) return firstLocal;
  }
  return stateFmt || fromDataFmt || stateList0 || dataList0 || '';
}

function buildInputReferenceKeySet(inputImages: unknown): Set<string> {
  return new Set(
    (Array.isArray(inputImages) ? inputImages : [])
      .map((u) => formatImagePath(String(u ?? '').trim()))
      .filter(Boolean),
  );
}

/** 主模块仅展示正式输出；接入的参考图只在输入面板缩略图区显示。 */
function resolveMainModuleDisplayUrl(
  mergedPrimary: string,
  dataOutputImage: string | undefined,
  dataOutputImages: unknown[] | undefined,
  inputRefSet: Set<string>,
  hasIncomingImageSource: boolean,
): string {
  const primary = (mergedPrimary || '').trim();
  if (!primary) return '';

  const primaryKey = formatImagePath(primary);
  if (!inputRefSet.has(primaryKey)) return primary;

  // 生成结果已显式写入 outputImage(s) 时必须展示（即便与某张参考图 URL 相同），
  // 否则有上游连线时会被误清空 → 任务列表能看缩略图、画布却「图片加载失败」。
  const explicitKey = (dataOutputImage || '').trim()
    ? formatImagePath(String(dataOutputImage).trim())
    : '';
  if (explicitKey && explicitKey === primaryKey) return primary;

  const dataOutList = Array.isArray(dataOutputImages)
    ? dataOutputImages
        .map((u) => formatImagePath(String(u ?? '').trim()))
        .filter(Boolean)
    : [];
  if (dataOutList.length > 0 && dataOutList.includes(primaryKey)) return primary;

  // 上游图片/角色连线传入的参考图：主模块不展示
  if (hasIncomingImageSource) return '';

  return '';
}

/** 抠图/去水印/多角度等返回新 URL 后写回 imageAsset，避免 preview 仍为上一版 OSS */
function buildImageAssetAfterAuxUrl(
  prev: ImageNodeData['imageAsset'] | undefined,
  newUrl: string,
): NonNullable<ImageNodeData['imageAsset']> {
  return {
    ...prev,
    preview: newUrl,
    original: newUrl,
  };
}

/**
 * Electron 下图节点多时，大量并发 file:// 在 Chromium 中易偶发失败；走主进程注册的 local-resource:// 更稳（与任务列表缩略图一致）。
 */
function getImageDisplaySrc(formattedUrl: string): string {
  if (!formattedUrl?.startsWith('local-resource://') || !(typeof window !== 'undefined' && (window as any).electronAPI)) {
    return formattedUrl;
  }
  return formattedUrl;
}

/** 与任务列表一致：先 mapProjectPath（中文项目→映射目录），再交给 getImageDisplaySrc */
async function resolveImageSrcForElectronDisplay(rawPath: string, projectId?: string): Promise<string> {
  const raw = (rawPath || '').trim();
  if (raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
  const formatted = formatImagePath(rawPath);
  if (!formatted) return '';
  let u = formatted;
  if (projectId && u.startsWith('local-resource://')) {
    try {
      u = await mapProjectPath(u, projectId);
    } catch {
      /* 保持 formatted */
    }
  }
  return getImageDisplaySrc(u);
}

/** object-contain 下内容区在容器内的矩形（用于单图九宫裁切的飞入起点） */
function getObjectContainContentRect(
  containerRect: DOMRect,
  naturalW: number,
  naturalH: number,
): { left: number; top: number; width: number; height: number } {
  const cw = Math.max(1, containerRect.width);
  const ch = Math.max(1, containerRect.height);
  const scale = Math.min(cw / naturalW, ch / naturalH) || 1;
  const dw = naturalW * scale;
  const dh = naturalH * scale;
  return {
    left: containerRect.left + (cw - dw) / 2,
    top: containerRect.top + (ch - dh) / 2,
    width: dw,
    height: dh,
  };
}

function getGridScreenRectsFromObjectContain(
  containerEl: HTMLElement | null,
  naturalW: number,
  naturalH: number,
  cols: number,
  rows: number,
): { left: number; top: number; width: number; height: number }[] {
  if (!containerEl || cols < 1 || rows < 1 || naturalW < cols || naturalH < rows) return [];
  const c = containerEl.getBoundingClientRect();
  const content = getObjectContainContentRect(c, naturalW, naturalH);
  const out: { left: number; top: number; width: number; height: number }[] = [];
  const total = cols * rows;
  for (let i = 0; i < total; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({
      left: content.left + (col * content.width) / cols,
      top: content.top + (row * content.height) / rows,
      width: content.width / cols,
      height: content.height / rows,
    });
  }
  return out;
}

function getNineScreenRectsFromObjectContain(
  containerEl: HTMLElement | null,
  naturalW: number,
  naturalH: number,
): { left: number; top: number; width: number; height: number }[] {
  return getGridScreenRectsFromObjectContain(containerEl, naturalW, naturalH, 3, 3);
}

async function loadImageForCanvasDecode(primaryUrl: string, nodeData: ImageNodeData | undefined): Promise<HTMLImageElement> {
  const formatted = formatImagePath(primaryUrl);
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : undefined;

  const loadSrc = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('image load failed'));
      im.src = src;
    });

  if (api?.readImageAsDataUrl) {
    try {
      const { dataUrl } = await api.readImageAsDataUrl(formatted, nodeData?.originalImageUrl, nodeData?.localPath);
      if (dataUrl) return loadSrc(dataUrl);
    } catch {
      /* 回退到直接 URL */
    }
  }
  return loadSrc(getImageDisplaySrc(formatted));
}

function getFourScreenRectsFromObjectContain(
  containerEl: HTMLElement | null,
  naturalW: number,
  naturalH: number,
): { left: number; top: number; width: number; height: number }[] {
  return getGridScreenRectsFromObjectContain(containerEl, naturalW, naturalH, 2, 2);
}

async function cropFourTilesToPngBuffers(img: HTMLImageElement): Promise<{ sw: number; sh: number; buffers: ArrayBuffer[] }> {
  return cropGridTilesToPngBuffers(img, 2, 2);
}

async function cropGridToPngBuffers(
  img: HTMLImageElement,
  cols: number,
  rows: number,
): Promise<ArrayBuffer[]> {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const cellW = nw / cols;
  const cellH = nh / rows;
  const buffers: ArrayBuffer[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const sx = Math.round(col * cellW);
      const sy = Math.round(row * cellH);
      const sx2 = Math.round((col + 1) * cellW);
      const sy2 = Math.round((row + 1) * cellH);
      const sw = Math.max(1, sx2 - sx);
      const sh = Math.max(1, sy2 - sy);
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      const ab = await new Promise<ArrayBuffer>((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) reject(new Error('toBlob'));
            else blob.arrayBuffer().then(resolve, reject);
          },
          'image/png',
        );
      });
      buffers.push(ab);
    }
  }
  return buffers;
}

async function cropGridTilesToPngBuffers(
  img: HTMLImageElement,
  cols: number,
  rows: number,
): Promise<{ sw: number; sh: number; buffers: ArrayBuffer[] }> {
  const buffers = await cropGridToPngBuffers(img, cols, rows);
  return {
    sw: Math.max(1, Math.round(img.naturalWidth / cols)),
    sh: Math.max(1, Math.round(img.naturalHeight / rows)),
    buffers,
  };
}

async function cropNineTilesToPngBuffers(img: HTMLImageElement): Promise<{ sw: number; sh: number; buffers: ArrayBuffer[] }> {
  return cropGridTilesToPngBuffers(img, 3, 3);
}

type GridSplitMode = 'four' | 'nine' | '2x3' | '3x2' | { cols: number; rows: number };

const GRID_SPLIT_MAX_AXIS = 8;
const GRID_SPLIT_MAX_CELLS = 36;

function gridSplitLayout(mode: GridSplitMode): { cols: number; rows: number; cells: number } {
  if (typeof mode === 'object') {
    const cols = Math.max(1, Math.min(GRID_SPLIT_MAX_AXIS, Math.floor(mode.cols)));
    const rows = Math.max(1, Math.min(GRID_SPLIT_MAX_AXIS, Math.floor(mode.rows)));
    return { cols, rows, cells: cols * rows };
  }
  switch (mode) {
    case 'four':
      return { cols: 2, rows: 2, cells: 4 };
    case '2x3':
      return { cols: 2, rows: 3, cells: 6 };
    case '3x2':
      return { cols: 3, rows: 2, cells: 6 };
    case 'nine':
    default:
      return { cols: 3, rows: 3, cells: 9 };
  }
}

type NineSplitAnimState = {
  urls: string[];
  from: { left: number; top: number; width: number; height: number }[];
  to: { left: number; top: number; width: number; height: number }[];
};

type NineSplitPayload = {
  urls: string[];
  flowPositions: { x: number; y: number }[];
  splitW: number;
  splitH: number;
  labels: string[];
  resolution: string;
  aspectRatio: string;
  model: string;
  seedreamWidth: number;
  seedreamHeight: number;
  avgColorHex: string;
  /** 单图裁切落盘后的逐格资源（多 URL 拆分时为空） */
  tileAssets?: {
    outputImage: string;
    originalImageUrl: string;
    tinyThumbUrl: string;
    localPath?: string;
    imageAsset?: ImageNodeData['imageAsset'];
  }[];
};

const VIEWPORT_PADDING = 280;
const ZOOM_THRESHOLD_ICON_ONLY = 0.08;
const ZOOM_THRESHOLD_FAR = 0.1;
const ZOOM_THRESHOLD_NEAR = 0.5;
const DEFAULT_PREFETCH_SCREEN_FACTOR = PERF_POLICY.prefetchScreenFactor;
const FPS_PROTECT_THRESHOLD = PERF_POLICY.fpsP1Threshold;
const FAST_MOVE_SPEED_THRESHOLD = 2200; // px/s
const PREFETCH_DIRECTION_LOCK_MS = 150;
const PREFETCH_SECTOR_COS = 0.7071; // 90° 扇形（±45°）

const ImageNodeComponent: React.FC<ImageNodeProps> = (props) => {
  // 解构出 React Flow 专有属性，避免透传给 DOM
  const {
    id,
    data,
    selected,
    isDarkMode = true,
    performanceMode = false,
    prefetchScreenFactor = DEFAULT_PREFETCH_SCREEN_FACTOR,
    onDataChange,
    onAuxImageTaskComplete,
    onPreviewImage,
    onOpenDrawingBoard,
    onAddCanvasImageNodes,
    projectId,
    // React Flow 专有属性，不应传递给 DOM（显式解构以过滤）
    xPos = 0,
    yPos = 0,
    dragging,
    zIndex: _zIndex,
    width: _width,
    height: _height,
    type: _type,
    targetPosition: _targetPosition,
    sourcePosition: _sourcePosition,
    position: _position,
    // 确保不会透传任何其他 React Flow 内部属性
  } = props as any;
  const { setNodes, setEdges, getNodes, getEdges, flowToScreenPosition, getZoom } = useReactFlow();
  const storeApi = useStoreApi();
  const updateNodeInternals = useUpdateNodeInternals();
  const hasIncomingImageSource = useStore(
    useCallback(
      (state: {
        edges: {
          target: string;
          source: string;
          targetHandle?: string | null;
          data?: { importLayoutOnly?: boolean };
        }[];
        nodeInternals: Map<string, { type?: unknown }>;
      }) => {
        for (const edge of state.edges) {
          if (edge.target !== id) continue;
          // 「导入到画布」布局边不算参考图上游
          if (edge.data?.importLayoutOnly || edge.targetHandle === 'import-layout') continue;
          const src = state.nodeInternals?.get(edge.source);
          const t = src?.type as string | undefined;
          if (t === 'image' || t === 'character') return true;
        }
        return false;
      },
      [id],
    ),
  );
  // 图片节点采用“最小尺寸下限 + 按素材比例自适应”的外框策略。
  const clampW = (v: number) => Math.max(IMAGE_NODE_MIN_W, Math.min(IMAGE_NODE_MAX_W, v));
  const clampH = (v: number) => Math.max(IMAGE_NODE_MIN_H, Math.min(IMAGE_NODE_MAX_H, v));
  const computeAdaptiveNodeSize = useCallback((mediaW?: number, mediaH?: number) => {
    return computeNodeSizeFromMedia(
      mediaW,
      mediaH,
      IMAGE_NODE_MIN_W,
      IMAGE_NODE_MIN_H,
      IMAGE_NODE_MAX_W,
      IMAGE_NODE_MAX_H,
    );
  }, []);

  const [size, setSize] = useState({
    w: clampW(data?.width ?? IMAGE_NODE_DEFAULT_W),
    h: clampH(data?.height ?? IMAGE_NODE_DEFAULT_H),
  });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const raf = requestAnimationFrame(() => updateNodeInternals(id));
    // 尺寸 CSS 过渡约 0.32s：结束后再刷一次，避免锚点停在过渡中途高度
    const t = window.setTimeout(() => updateNodeInternals(id), 360);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [id, size.w, size.h, updateNodeInternals]);

  const isResizing = false;
  const [outputImage, setOutputImage] = useState(data?.outputImage || data?.originalImageUrl || '');
  const [outputImages, setOutputImages] = useState<string[]>(
    Array.isArray(data?.outputImages) && data.outputImages.length > 0
      ? data.outputImages.map((u: unknown) => formatImagePath(String(u || ''))).filter(Boolean)
      : (data?.outputImage || data?.originalImageUrl ? [formatImagePath(data?.outputImage || data?.originalImageUrl || '')].filter(Boolean) : [])
  );
  const [currentImageSrc, setCurrentImageSrc] = useState('');
  const [bufferImageSrc, setBufferImageSrc] = useState('');
  const [isBufferVisible, setIsBufferVisible] = useState(false);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [isImageVisible, setIsImageVisible] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const crossFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 仅在输出路径/项目变化时 abort；视口平移缩放共用同一 controller，避免拖动画布反复取消解码队列 */
  const pathLoadAbortRef = useRef<AbortController | null>(null);
  const loadStartAtRef = useRef<number>(0);
  const velocitySampleRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [isFastMoving, setIsFastMoving] = useState(false);
  const [lockedVelocity, setLockedVelocity] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isCulledByViewport, setIsCulledByViewport] = useState(false);
  const culledStateRef = useRef(false);
  const prefetchDebugAtRef = useRef(0);
  const directionLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(data?.originalImageUrl || null); // 用于 fallback 的远程 URL
  const [title, setTitle] = useState(data?.title || 'image');
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [progress, setProgress] = useState(data?.progress || 0);
  const [progressMessage, setProgressMessage] = useState(data?.progressMessage || '');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const genStartAtRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');
  const [isMattingLoading, setIsMattingLoading] = useState(false);
  const [isWatermarkRemovalLoading, setIsWatermarkRemovalLoading] = useState(false);
  const [isUpscaleV3Loading, setIsUpscaleV3Loading] = useState(false);
  const [showAllOutputImages, setShowAllOutputImages] = useState(false);
  const [nineSplitAnim, setNineSplitAnim] = useState<NineSplitAnimState | null>(null);
  const nineSplitPayloadRef = useRef<NineSplitPayload | null>(null);
  const [isSplitNineBusy, setIsSplitNineBusy] = useState(false);
  const [mattingPriceHover, setMattingPriceHover] = useState(false);
  const [upscaleV3PriceHover, setUpscaleV3PriceHover] = useState(false);
  const [inspectZoom, setInspectZoom] = useState(1);
  const [inspectPan, setInspectPan] = useState({ x: 0, y: 0 });
  const inspectZoomRef = useRef(1);
  const inspectPanDragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [splitGridMenuHover, setSplitGridMenuHover] = useState(false);
  const [customSplitCols, setCustomSplitCols] = useState('4');
  const [customSplitRows, setCustomSplitRows] = useState('2');
  const [flipMenuHover, setFlipMenuHover] = useState(false);
  const flipMenuLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitMenuLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropBusy, setCropBusy] = useState(false);
  const cropOverlayRef = useRef<ImageCropOverlayHandle>(null);
  /** 裁剪时临时放大模块；结束后还原 */
  const cropSizeBackupRef = useRef<{ w: number; h: number } | null>(null);
  /** 「九宫格多角度」胶囊激活时临时放大；关闭/离开时还原 */
  const nineGridSizeBackupRef = useRef<{ w: number; h: number } | null>(null);

  const applyCropNodeBox = useCallback(
    (nextW: number, nextH: number) => {
      const w = Math.round(Number(nextW));
      const h = Math.round(Number(nextH));
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) {
        console.warn('[ImageNode] applyCropNodeBox skipped: invalid size', nextW, nextH);
        return;
      }
      const styleDims = nodeStyleDimensions(w, h);
      // 先同步 RF store width/height（nodesselection-rect / getNodesBounds 读这里），再改本地 size / DOM
      flushSync(() => {
        setNodes((nds) =>
          nds.map((node) =>
            node.id === id
              ? {
                  ...node,
                  width: w,
                  height: h,
                  style: {
                    ...(node.style as object),
                    ...styleDims,
                    width: w,
                    height: h,
                  },
                  data: {
                    ...node.data,
                    width: w,
                    height: h,
                  },
                }
              : node,
          ),
        );
      });
      setSize({ w, h });
      if (nodeRef.current) {
        nodeRef.current.style.width = `${w}px`;
        nodeRef.current.style.height = `${h}px`;
        nodeRef.current.style.minWidth = `${w}px`;
        nodeRef.current.style.minHeight = `${h}px`;
        const rfNode = nodeRef.current.closest('.react-flow__node') as HTMLElement | null;
        if (rfNode) {
          rfNode.style.width = `${w}px`;
          rfNode.style.height = `${h}px`;
        }
      }
      requestAnimationFrame(() => {
        updateNodeInternals(id);
        requestAnimationFrame(() => updateNodeInternals(id));
      });
    },
    [id, setNodes, updateNodeInternals],
  );

  /** 无论原图多小，裁剪时都放大到接近视口的超大窗口；外框比例严格跟随图片 aspect，避免黑边 */
  const computeLargeCropNodeSize = useCallback((aspect: number, zoom: number) => {
    const zRaw = Number(zoom);
    const aRaw = Number(aspect);
    const z = Number.isFinite(zRaw) && zRaw > 0 ? Math.max(zRaw, 0.2) : 1;
    const a = Number.isFinite(aRaw) && aRaw > 0 ? Math.max(aRaw, 0.05) : DEFAULT_IMAGE_ASPECT_RATIO;
    const vw = Math.max(320, Number(window.innerWidth) || 1280);
    const vh = Math.max(240, Number(window.innerHeight) || 720);
    const maxFlowW = Math.min((vw * 0.82) / z, IMAGE_NODE_MAX_W);
    const maxFlowH = Math.min((vh * 0.7) / z, IMAGE_NODE_MAX_H);
    let w = maxFlowW;
    let h = w / a;
    if (h > maxFlowH) {
      h = maxFlowH;
      w = h * a;
    }
    // 独立 clamp 会破坏比例；按短边约束后再反推另一边
    if (w < IMAGE_NODE_MIN_W) {
      w = IMAGE_NODE_MIN_W;
      h = w / a;
    }
    if (h < IMAGE_NODE_MIN_H) {
      h = IMAGE_NODE_MIN_H;
      w = h * a;
    }
    if (w > IMAGE_NODE_MAX_W) {
      w = IMAGE_NODE_MAX_W;
      h = w / a;
    }
    if (h > IMAGE_NODE_MAX_H) {
      h = IMAGE_NODE_MAX_H;
      w = h * a;
    }
    const outW = Math.round(w);
    const outH = Math.round(h);
    if (!Number.isFinite(outW) || !Number.isFinite(outH) || outW < 2 || outH < 2) {
      return { w: IMAGE_NODE_MIN_W, h: IMAGE_NODE_MIN_H };
    }
    return { w: outW, h: outH };
  }, []);

  /** 模块内 360 环视：本地态保证点击立刻切换（外层 memo 可能漏比 viewMode） */
  const [panorama360Active, setPanorama360Active] = useState(() => data?.viewMode === 'panorama360');
  /** 悬停小地球时在上方显示「转换」；再悬停「转换」展开 21:9 图生图模型 */
  const [panoramaConvertHover, setPanoramaConvertHover] = useState(false);
  const [scene360ModelMenuOpen, setScene360ModelMenuOpen] = useState(false);
  const [scene360PriceHoverModel, setScene360PriceHoverModel] = useState<string | null>(null);
  const panoramaConvertLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 进入/退出 360 时跳过尺寸 CSS 过渡，避免 WebGL 量到旧宽高后黑边 */
  const [suppressSizeTransition, setSuppressSizeTransition] = useState(false);
  const panoSizeBackupRef = useRef<{ w: number; h: number } | null>(null);
  /** 360 游览中锁定的展示尺寸；未退出前禁止被 data/onLoad/RO 改小 */
  const panoLockedSizeRef = useRef<{ w: number; h: number } | null>(null);
  const panoControlsRef = useRef<{
    toggleFullscreen: () => Promise<void>;
    isFullscreen: () => boolean;
  } | null>(null);
  /** 连续全景截图时，在 getNodes 尚未跟上前用游标避免新节点叠在一起 */
  const panoCaptureSpawnXRef = useRef<number | null>(null);

  const registerPanoControls = useCallback(
    (
      api: {
        toggleFullscreen: () => Promise<void>;
        isFullscreen: () => boolean;
      } | null,
    ) => {
      panoControlsRef.current = api;
    },
    [],
  );
  /** 预览翻转：先写 DOM，再低优先级持久化，避免 setNodes 卡住主线程 */
  const flipLiveRef = useRef({ h: !!data?.flipH, v: !!data?.flipV });
  const [watermarkPriceHover, setWatermarkPriceHover] = useState(false);
  /** 3D 视角控制器弹窗：仅选中时显示，未选中时收起 */
  const [is3DPopoverOpen, setIs3DPopoverOpen] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState<boolean | null>(null);
  const [cameraGenModel, setCameraGenModel] = useState<string>(DEFAULT_IMAGE_MODEL);
  /** original = 跟随当前图比例；其余为固定档位 */
  const [cameraGenAspect, setCameraGenAspect] = useState<string>('original');
  /** 清晰度：banana/gpt/seedream 用 1k/2k/4k；flux2-klein 用 720p/1080p */
  const [cameraGenResolution, setCameraGenResolution] = useState<string>('1k');
  const cameraGenMetaRef = useRef<{ aspect: string; model: string }>({
    aspect: '1:1',
    model: DEFAULT_IMAGE_MODEL,
  });
  const threeDTriggerRef = useRef<HTMLButtonElement>(null);
  const [threeDPopoverPosition, setThreeDPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  /** 打开 3D 弹窗时的基础提示词，调整时用「基础 + 最新相机指令」替换，避免不断累加 */
  const basePromptFor3DRef = useRef<string | null>(null);
  /** 重置视角缓动动画 RAF */
  const cameraResetRafRef = useRef<number | null>(null);

  const nodeRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  /**
   * 放大裁剪/360 时 RF 的 nodesselection-rect 仍按「旧 measured 宽高」画虚线框，
   * 会在大窗左上角留下原模块大小的幽灵框。硬方案：会话期间取消节点选中，
   * 关掉 nodesSelectionActive，并保留 CSS hide 双保险；退出后按需恢复选中。
   */
  const wasHidingRfSelectionRef = useRef(false);
  const rfSessionRestoreSelectedRef = useRef(false);
  useLayoutEffect(() => {
    const hide = showCropModal || panorama360Active;
    const rfNode = nodeRef.current?.closest('.react-flow__node') as HTMLElement | null;

    const clearNodeSelectionHard = () => {
      flushSync(() => {
        setNodes((nds) => {
          let changed = false;
          const next = nds.map((n) => {
            if (n.id !== id || !n.selected) return n;
            changed = true;
            return { ...n, selected: false };
          });
          return changed ? next : nds;
        });
      });
      storeApi.setState({ nodesSelectionActive: false });
    };

    if (hide) {
      if (!wasHidingRfSelectionRef.current) {
        // 入口可能已提前记录；此处兜底（含 selected 尚未被清掉的首帧）
        rfSessionRestoreSelectedRef.current =
          rfSessionRestoreSelectedRef.current ||
          selected ||
          getNodes().some((n) => n.id === id && n.selected);
        wasHidingRfSelectionRef.current = true;
      }
      // 会话期间若被其它逻辑重新选中，继续强制清掉
      clearNodeSelectionHard();
      rfNode?.classList.add('nexflow-hide-rf-selection');
      return () => {
        rfNode?.classList.remove('nexflow-hide-rf-selection');
      };
    }

    rfNode?.classList.remove('nexflow-hide-rf-selection');
    if (!wasHidingRfSelectionRef.current) return;
    wasHidingRfSelectionRef.current = false;
    const shouldRestore = rfSessionRestoreSelectedRef.current;
    rfSessionRestoreSelectedRef.current = false;
    updateNodeInternals(id);
    const t = window.setTimeout(() => {
      updateNodeInternals(id);
      if (!shouldRestore) return;
      flushSync(() => {
        setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, selected: true } : n)),
        );
      });
      storeApi.setState({ nodesSelectionActive: true });
    }, 100);
    return () => window.clearTimeout(t);
  }, [showCropModal, panorama360Active, selected, storeApi, getNodes, id, updateNodeInternals, setNodes]);

  // 外框实际像素变化时持续刷新 Handle；同时把 RF 节点宽高钉死为 size，防止底栏撑大选框
  useEffect(() => {
    const el = nodeRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let raf = 0;
    const pinAndRefresh = () => {
      const w = sizeRef.current?.w ?? size.w;
      const h = sizeRef.current?.h ?? size.h;
      if (w > 0 && h > 0) {
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        el.style.minWidth = `${w}px`;
        el.style.minHeight = `${h}px`;
        const rfNode = el.closest('.react-flow__node') as HTMLElement | null;
        if (rfNode) {
          rfNode.style.width = `${w}px`;
          rfNode.style.height = `${h}px`;
          rfNode.style.minWidth = `${w}px`;
          rfNode.style.minHeight = `${h}px`;
        }
      }
      updateNodeInternals(id);
    };
    const ro = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(pinAndRefresh);
    });
    ro.observe(el);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [id, updateNodeInternals, size.w, size.h]);

  /** 避免 onLoad 触发的 updateNodeData/updateNodeInternals 导致重复调整尺寸、形成死循环 */
  const lastOnLoadSrcRef = useRef<string | null>(null);
  /** 尺寸对比锁：已对该 src 应用过的 (w,h)，避免重渲染后再次 onLoad 时重复调用 updateNodeData */
  const lastAppliedSizeRef = useRef<{ srcKey: string; w: number; h: number } | null>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const nineGridRef = useRef<HTMLDivElement>(null);
  const [multiGridPreviewSrc, setMultiGridPreviewSrc] = useState('');
  /** 与 outputImages 绑定；仅多图列表变化时重建，平移时复用 */
  const multiGridPreviewCacheRef = useRef<{ key: string; src: string } | null>(null);
  const multiGridBuildGenRef = useRef(0);
  /** 展开全部（10+ 张）平移画布时的合并预览 */
  const [expandAllMergePreviewSrc, setExpandAllMergePreviewSrc] = useState('');
  const expandAllMergePreviewCacheRef = useRef<{ key: string; src: string } | null>(null);
  const expandAllMergeBuildGenRef = useRef(0);
  const expandAllGridWrapRef = useRef<HTMLDivElement>(null);
  const expandAllGridInnerRef = useRef<HTMLDivElement>(null);
  const expandAllGridFrameLockedRef = useRef<{ frameWidth: number; frameHeight: number } | null>(null);
  const [expandAllGridFrame, setExpandAllGridFrame] = useState(() => estimateExpandAllGridFrameSize(10));
  const imgRef = useRef<HTMLImageElement>(null);
  const currentImageSrcRef = useRef('');
  const bufferImageSrcRef = useRef('');
  /** 拖动画布时偶发 onError（请求被取消/竞态），限制次数内自动重试 */
  const transientImgErrorRetriesRef = useRef(0);
  /** 拖出到桌面/资源管理器：pointerdown 预准备路径；拖出窗口后再 startDrag，避免抢走应用内放下 */
  const nativeDragPreparePromiseRef = useRef<Promise<string | null> | null>(null);
  const nativeDragPreparedPathRef = useRef<string | null>(null);
  const nativeDragStartedRef = useRef(false);
  const viewport = useFrozenFlowViewport();
  const isVisualInteractionLocked = useGlobalInteractionSelector((state) => state.isVisualInteractionLocked);
  const isGlobalInteracting = useGlobalInteractionSelector((state) => state.isGlobalInteracting);
  const velocityX = useGlobalInteractionSelector((state) => state.velocityX);
  const velocityY = useGlobalInteractionSelector((state) => state.velocityY);
  const runtimeFps = useGlobalInteractionSelector((state) => state.runtimeFps);
  const perfLevel = useGlobalInteractionSelector((state) => state.perfLevel);
  const showAlert = useDarkAlert().showAlert;
  const { locale } = useAppLocale();
  const wc = workspaceChromeT(locale);
  const imgc = useMemo(() => imageNodeChromeT(locale), [locale]);
  const imagePanelT = useMemo(() => imageInputPanelT(locale), [locale]);
  const imageLoadFailPlaceholder = useMemo(
    () =>
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#ccc" width="100" height="100"/><text x="50" y="50" text-anchor="middle" dy=".3em" fill="#999">${imgc.imageLoadFailedShort.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`
      ),
    [imgc.imageLoadFailedShort]
  );
  const { cloudMap } = useNxModelPricing();
  const mattingDisplayYuanbao = useMemo(() => {
    try {
      return getMattingDisplayPrice(cloudMap);
    } catch {
      return null;
    }
  }, [cloudMap]);
  const watermarkDisplayYuanbao = useMemo(() => {
    try {
      return getWatermarkRemovalDisplayPrice(cloudMap);
    } catch {
      return null;
    }
  }, [cloudMap]);
  const upscaleV3DisplayYuanbao = useMemo(() => {
    try {
      return getImageUpscaleV3DisplayPrice(cloudMap);
    } catch {
      return null;
    }
  }, [cloudMap]);
  /** 场景转换360：图生图可用模型（同源目录） */
  const scene360ConvertModelOptions = useMemo(
    () =>
      filterImageModelsForMode({ hasRefs: true, refCount: 1 }).map(({ value, label }) => ({
        value,
        label,
      })),
    [],
  );
  const scene360ResolutionForModel = useCallback((model: string) => {
    return model === 'flux2-klein' ? '1080p' : '4k';
  }, []);
  const scene360PriceLabelForModel = useCallback(
    (model: string) => {
      try {
        const resolution = scene360ResolutionForModel(model);
        const y = getImageDisplayPrice({ model, resolution, quantity: 1 }, cloudMap);
        return locale === 'en' ? `${y} ${imgc.creditsSuffix}` : `${y}${imgc.creditsSuffix}`;
      } catch (e) {
        if (isModelNotPricedError(e)) return null;
        return null;
      }
    },
    [cloudMap, imgc.creditsSuffix, locale, scene360ResolutionForModel],
  );
  // 仅在视口本身移动时（平移/缩放）才启用图像过渡抑制。
  const isViewportMoving = Math.hypot(velocityX, velocityY) > 1;
  /** 画布平移/缩放或拖拽节点时：多图改用缓存的合并图，静止时仍显示宫格 */
  const showMultiMergeWhileMoving = useMemo(
    () =>
      outputImages.length > 1 &&
      !!multiGridPreviewSrc &&
      !showAllOutputImages &&
      (isVisualInteractionLocked || isGlobalInteracting || dragging),
    [
      outputImages.length,
      multiGridPreviewSrc,
      showAllOutputImages,
      isVisualInteractionLocked,
      isGlobalInteracting,
      dragging,
    ],
  );
  const showExpandAllMergeWhileMoving = useMemo(
    () =>
      showAllOutputImages &&
      outputImages.length > 9 &&
      !!expandAllMergePreviewSrc &&
      (isVisualInteractionLocked || isGlobalInteracting),
    [
      showAllOutputImages,
      outputImages.length,
      expandAllMergePreviewSrc,
      isVisualInteractionLocked,
      isGlobalInteracting,
    ],
  );

  /** 3D 视角值：弹窗内用本地 state，关闭时以 data 为准 */
  const initialCameraValue = useMemo(
    () => ({
      rotationX: data?.cameraControl?.rotationX ?? DEFAULT_CAMERA_VALUE.rotationX,
      rotationY: data?.cameraControl?.rotationY ?? DEFAULT_CAMERA_VALUE.rotationY,
      scale: data?.cameraControl?.scale ?? DEFAULT_CAMERA_VALUE.scale,
      fov: data?.cameraControl?.fov ?? DEFAULT_CAMERA_VALUE.fov,
    }),
    [data?.cameraControl?.rotationX, data?.cameraControl?.rotationY, data?.cameraControl?.scale, data?.cameraControl?.fov]
  );
  const [cameraValue, setCameraValue] = useState<CameraControlValue>(initialCameraValue);
  useEffect(() => {
    if (!is3DPopoverOpen) {
      setCameraValue(initialCameraValue);
    } else {
      basePromptFor3DRef.current = data?.prompt ?? '';
    }
  }, [initialCameraValue, is3DPopoverOpen, data?.prompt]);

  const normalizeCameraValue = useCallback((v: CameraControlValue): CameraControlValue => ({
    rotationX: Math.max(-75, Math.min(75, v.rotationX)),
    rotationY: Math.max(-180, Math.min(180, v.rotationY)),
    scale: Math.max(1.2, Math.min(6.5, v.scale)),
    fov: Math.max(30, Math.min(95, v.fov)),
  }), []);

  const cancelCameraResetAnimation = useCallback(() => {
    if (cameraResetRafRef.current != null) {
      cancelAnimationFrame(cameraResetRafRef.current);
      cameraResetRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!is3DPopoverOpen) cancelCameraResetAnimation();
  }, [is3DPopoverOpen, cancelCameraResetAnimation]);

  useEffect(() => () => cancelCameraResetAnimation(), [cancelCameraResetAnimation]);

  // 更新节点数据（需在 persistCameraValue 之前定义）
  const updateNodeData = useCallback((updates: Partial<ImageNodeData>) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                ...updates,
              },
            }
          : node
      )
    );
    if (
      onDataChange &&
      (updates.outputImage !== undefined ||
        updates.outputImages !== undefined ||
        updates.imageAsset !== undefined)
    ) {
      onDataChange(id, {
        ...(updates.outputImage !== undefined ? { outputImage: updates.outputImage } : {}),
        ...(updates.outputImages !== undefined ? { outputImages: updates.outputImages } : {}),
        ...(updates.imageAsset !== undefined ? { imageAsset: updates.imageAsset } : {}),
      });
    }
  }, [id, setNodes, onDataChange]);

  const restoreCropNodeSize = useCallback(() => {
    const backup = cropSizeBackupRef.current;
    cropSizeBackupRef.current = null;
    if (!backup) return;
    setSuppressSizeTransition(true);
    applyCropNodeBox(backup.w, backup.h);
    window.setTimeout(() => setSuppressSizeTransition(false), 50);
  }, [applyCropNodeBox]);

  /** 裁剪时抬到画布最上层，避免被其它模块压住选框（勿强制 selected，会画出幽灵选框） */
  const CROP_LAYER_Z = 10000;
  const elevateCropNodeLayer = useCallback(
    (elevate: boolean) => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id !== id) return n;
          if (elevate) {
            return {
              ...n,
              selected: false,
              zIndex: CROP_LAYER_Z,
              style: {
                ...(n.style as object),
                zIndex: CROP_LAYER_Z,
              },
            };
          }
          const nextStyle = { ...(n.style as Record<string, unknown>) };
          delete nextStyle.zIndex;
          return {
            ...n,
            zIndex: undefined,
            style: nextStyle,
          };
        }),
      );
      const rfNode = nodeRef.current?.closest('.react-flow__node') as HTMLElement | null;
      if (rfNode) {
        if (elevate) {
          rfNode.style.zIndex = String(CROP_LAYER_Z);
          rfNode.classList.add('nexflow-crop-top-layer');
        } else {
          rfNode.style.zIndex = '';
          rfNode.classList.remove('nexflow-crop-top-layer');
        }
      }
    },
    [id, setNodes],
  );

  const closeCropSession = useCallback(() => {
    setShowCropModal(false);
    elevateCropNodeLayer(false);
    restoreCropNodeSize();
  }, [elevateCropNodeLayer, restoreCropNodeSize]);

  const openCropSession = useCallback(() => {
    try {
    if (panorama360Active) {
      setPanorama360Active(false);
      updateNodeData({ viewMode: 'flat' });
    }
    if (!cropSizeBackupRef.current) {
      const bw = Number(size.w);
      const bh = Number(size.h);
      cropSizeBackupRef.current = {
        w: Number.isFinite(bw) && bw > 0 ? bw : IMAGE_NODE_MIN_W,
        h: Number.isFinite(bh) && bh > 0 ? bh : IMAGE_NODE_MIN_H,
      };
    }
    // 外框比例跟图片 intrinsic / 资源尺寸对齐，避免放大后 object-contain 上下大块黑边
    const imgEl = imgRef.current;
    const assetW = Number(data?.imageAsset?.width) || 0;
    const assetH = Number(data?.imageAsset?.height) || 0;
    let aspect = DEFAULT_IMAGE_ASPECT_RATIO;
    if (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
      aspect = imgEl.naturalWidth / imgEl.naturalHeight;
    } else if (assetW > 0 && assetH > 0) {
      aspect = assetW / assetH;
    } else {
      const parsed = parseAspectRatioValue(String(data?.aspectRatio || ''));
      if (parsed && parsed.w > 0 && parsed.h > 0) aspect = parsed.w / parsed.h;
      else if (size.w > 0 && size.h > 0) aspect = size.w / size.h;
    }
    if (!Number.isFinite(aspect) || aspect <= 0) aspect = DEFAULT_IMAGE_ASPECT_RATIO;
    let z = 1;
    try {
      const gz = getZoom?.();
      z = Number(gz ?? viewport.zoom ?? 1);
    } catch {
      z = Number(viewport.zoom) || 1;
    }
    if (!Number.isFinite(z) || z <= 0) z = 1;
    const large = computeLargeCropNodeSize(aspect, z);
    if (!(large.w > 1 && large.h > 1)) {
      console.warn('[ImageNode] openCropSession aborted: invalid enlarge size', large);
      return;
    }
    setSuppressSizeTransition(true);
    // 放大前先记下选中态再取消，避免旧 measured 尺寸幽灵框；退出后可恢复
    if (!wasHidingRfSelectionRef.current) {
      rfSessionRestoreSelectedRef.current =
        selected || getNodes().some((n) => n.id === id && n.selected);
    }
    flushSync(() => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, selected: false } : n)),
      );
    });
    storeApi.setState({ nodesSelectionActive: false });
    applyCropNodeBox(large.w, large.h);
    setShowCropModal(true);
    elevateCropNodeLayer(true);

    /** 跟手对焦：约 320ms fitBounds；布局就绪后立刻触发，仅短兜底 */
    const CROP_FOCUS_MS = 320;
    const focusCropModule = () => {
      try {
        elevateCropNodeLayer(true);
        window.dispatchEvent(
          new CustomEvent('nexflow-canvas-focus-nodes', {
            detail: {
              nodes: [{ id, width: large.w, height: large.h }],
              duration: CROP_FOCUS_MS,
              padding: 0.14,
            },
          }),
        );
      } catch (err) {
        console.warn('[ImageNode] crop focus failed', err);
      }
    };
    // 双 rAF：等放大尺寸写入 DOM/RF 后再对焦（不再叠加 100ms）
    requestAnimationFrame(() => {
      requestAnimationFrame(focusCropModule);
    });
    // 短兜底：布局偶发偏慢时补一次同 bounds（幂等）
    window.setTimeout(focusCropModule, 64);
    window.setTimeout(() => setSuppressSizeTransition(false), 40);
    } catch (err) {
      console.warn('[ImageNode] openCropSession failed', err);
      setShowCropModal(false);
      setSuppressSizeTransition(false);
    }
  }, [
    panorama360Active,
    updateNodeData,
    size.w,
    size.h,
    data?.imageAsset?.width,
    data?.imageAsset?.height,
    data?.aspectRatio,
    getZoom,
    viewport.zoom,
    computeLargeCropNodeSize,
    applyCropNodeBox,
    elevateCropNodeLayer,
    id,
    storeApi,
    selected,
    getNodes,
    setNodes,
  ]);

  /** 九宫格多角度：相对当前尺寸 1.5 倍，受视口与模块上限约束 */
  const computeNineGridEnlargeSize = useCallback((baseW: number, baseH: number, zoom: number) => {
    const z = Math.max(zoom, 0.2);
    const maxFlowW = (window.innerWidth * 0.9) / z;
    const maxFlowH = (window.innerHeight * 0.72) / z;
    let w = clampW(Math.round(baseW * 1.5));
    let h = clampH(Math.round(baseH * 1.5));
    if (w > maxFlowW || h > maxFlowH) {
      const scale = Math.min(maxFlowW / Math.max(w, 1), maxFlowH / Math.max(h, 1), 1);
      w = clampW(Math.round(w * scale));
      h = clampH(Math.round(h * scale));
    }
    if (w < baseW || h < baseH) {
      w = clampW(baseW);
      h = clampH(baseH);
    }
    return { w, h };
  }, []);

  const applyNineGridEnlarge = useCallback(
    (active: boolean) => {
      if (active) {
        // 裁剪 / 360 会话已占用外框时不抢尺寸
        if (showCropModal || panorama360Active) return;
        if (!nineGridSizeBackupRef.current) {
          nineGridSizeBackupRef.current = { w: sizeRef.current.w, h: sizeRef.current.h };
        }
        const base = nineGridSizeBackupRef.current;
        const z = getZoom?.() ?? viewport.zoom ?? 1;
        const large = computeNineGridEnlargeSize(base.w, base.h, z);
        setSuppressSizeTransition(true);
        applyCropNodeBox(large.w, large.h);
        const focusNineGrid = () => {
          window.dispatchEvent(
            new CustomEvent('nexflow-canvas-focus-nodes', {
              detail: {
                nodes: [{ id, width: large.w, height: large.h }],
                duration: 320,
                padding: 0.14,
              },
            }),
          );
        };
        requestAnimationFrame(() => {
          requestAnimationFrame(focusNineGrid);
        });
        window.setTimeout(focusNineGrid, 64);
        window.setTimeout(() => setSuppressSizeTransition(false), 40);
        return;
      }
      const backup = nineGridSizeBackupRef.current;
      nineGridSizeBackupRef.current = null;
      if (!backup) return;
      // 若裁剪已接管，把裁剪还原目标改回九宫格前尺寸，避免裁剪结束后留在 1.5×
      if (cropSizeBackupRef.current) {
        cropSizeBackupRef.current = backup;
      }
      if (showCropModal || panorama360Active) return;
      setSuppressSizeTransition(true);
      applyCropNodeBox(backup.w, backup.h);
      window.setTimeout(() => setSuppressSizeTransition(false), 50);
    },
    [
      showCropModal,
      panorama360Active,
      getZoom,
      viewport.zoom,
      computeNineGridEnlargeSize,
      applyCropNodeBox,
      id,
    ],
  );

  useEffect(() => {
    const onNineGridEnlarge = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId?: string; active?: boolean }>).detail;
      if (!detail || detail.nodeId !== id) return;
      applyNineGridEnlarge(!!detail.active);
    };
    window.addEventListener('nexflow-image-ninegrid-enlarge', onNineGridEnlarge as EventListener);
    return () => {
      window.removeEventListener('nexflow-image-ninegrid-enlarge', onNineGridEnlarge as EventListener);
      // 节点卸载时若仍处放大态则还原，避免留下异常尺寸
      if (nineGridSizeBackupRef.current) {
        const backup = nineGridSizeBackupRef.current;
        nineGridSizeBackupRef.current = null;
        applyCropNodeBox(backup.w, backup.h);
      }
    };
  }, [id, applyNineGridEnlarge, applyCropNodeBox]);

  const persistCameraValue = useCallback(
    (next: CameraControlValue) => {
      const normalized = normalizeCameraValue(next);
      setCameraValue(normalized);
      const { payload } = getPhotographyPrompt(normalized);
      const promptPayload = {
        ...payload,
        camera_tags: payload.prompt_metadata.view_tags,
        full_camera_prompt: payload.prompt_metadata.formatted_output,
        qwen_instruction: payload.prompt_metadata.qwen_instruction,
      };
      const cameraText = promptPayload.qwen_instruction || promptPayload.full_camera_prompt || promptPayload.camera_tags || '';
      const basePrompt = basePromptFor3DRef.current ?? (getNodes().find((n) => n.id === id)?.data?.prompt || '');
      const newPrompt = cameraText ? (basePrompt ? `${basePrompt.trim()}, ${cameraText}` : cameraText) : basePrompt;
      setNodes((nds) => {
        return nds.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  cameraControl: {
                    rotationX: normalized.rotationX,
                    rotationY: normalized.rotationY,
                    scale: normalized.scale,
                    fov: normalized.fov,
                  },
                  prompt_payload: promptPayload,
                  ...(cameraText ? { prompt: newPrompt } : {}),
                },
              }
            : n
        );
      });
      if (cameraText) {
        window.dispatchEvent(
          new CustomEvent('nexflow-image-prompt-from-3d', { detail: { nodeId: id, prompt: newPrompt } })
        );
      }
    },
    [id, normalizeCameraValue, setNodes, getNodes]
  );

  /** 重置视角：立方体与滑条缓动回到默认位 */
  const animateCameraResetToDefault = useCallback(() => {
    cancelCameraResetAnimation();
    const start = { ...cameraValue };
    const target = normalizeCameraValue(DEFAULT_CAMERA_VALUE);
    const yawDelta = ((target.rotationY - start.rotationY + 540) % 360) - 180;
    const startTs = performance.now();
    const durationMs = 420;
    const tick = (now: number) => {
      const t = Math.min(1, (now - startTs) / durationMs);
      const eased = 1 - (1 - t) ** 3;
      const next = normalizeCameraValue({
        rotationX: start.rotationX + (target.rotationX - start.rotationX) * eased,
        rotationY: start.rotationY + yawDelta * eased,
        scale: start.scale + (target.scale - start.scale) * eased,
        fov: start.fov + (target.fov - start.fov) * eased,
      });
      setCameraValue(next);
      if (t < 1) {
        cameraResetRafRef.current = requestAnimationFrame(tick);
      } else {
        cameraResetRafRef.current = null;
        persistCameraValue(target);
      }
    };
    cameraResetRafRef.current = requestAnimationFrame(tick);
  }, [cameraValue, cancelCameraResetAnimation, normalizeCameraValue, persistCameraValue]);

  // 同步外部数据变化
  useEffect(() => {
    if (typeof data?.width === 'number' && data.width > 0 && typeof data?.height === 'number' && data.height > 0) {
      const nextW = clampW(data.width);
      const nextH = clampH(data.height);
      // 360 游览中：只允许维持/放大到锁定尺寸，禁止被旧 data 改小
      if (panorama360Active || data?.viewMode === 'panorama360') {
        const locked = panoLockedSizeRef.current;
        if (locked) {
          setSize((prev) =>
            prev.w === locked.w && prev.h === locked.h ? prev : { w: locked.w, h: locked.h },
          );
          if (nodeRef.current) {
            nodeRef.current.style.width = `${locked.w}px`;
            nodeRef.current.style.height = `${locked.h}px`;
          }
        } else if (nextW >= size.w * 0.95 && nextH >= size.h * 0.95) {
          setSize((prev) => (prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH }));
        }
      } else if (!nineGridSizeBackupRef.current && !cropSizeBackupRef.current) {
        setSize((prev) => (prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH }));
        if (nodeRef.current) {
          nodeRef.current.style.width = `${nextW}px`;
          nodeRef.current.style.height = `${nextH}px`;
        }
        requestAnimationFrame(() => updateNodeInternals(id));
      }
      // 九宫格 / 裁剪临时放大会话中勿被旧 data 改回原尺寸
    }
    if (data?.outputImage !== undefined || data?.originalImageUrl !== undefined || data?.outputImages !== undefined) {
      const list = Array.isArray(data?.outputImages)
        ? data.outputImages.map((u: unknown) => formatImagePath(String(u || ''))).filter(Boolean)
        : [];
      if (list.length > 0) {
        setOutputImages((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
      }
      // 防止 outputImage 被意外清空：优先用 outputImage，否则回退 originalImageUrl
      const rawImagePath = data?.outputImage || list[0] || data?.originalImageUrl || '';
      const formattedPath = formatImagePath(rawImagePath);
      if (outputImage !== formattedPath) {
        lastOnLoadSrcRef.current = null;
        lastAppliedSizeRef.current = null;
        setOutputImage(formattedPath);
      }
    }
    if (data?.title !== undefined) {
      setTitle(data.title);
    }
    if (data?.progress !== undefined) {
      setProgress(data.progress);
    }
    if (data?.progressMessage !== undefined) {
      setProgressMessage(data.progressMessage);
    }
    if (data?.errorMessage !== undefined) {
      setErrorMessage(data.errorMessage);
    }
  }, [data?.width, data?.height, data?.outputImage, data?.outputImages, data?.originalImageUrl, data?.title, data?.progress, data?.progressMessage, data?.errorMessage, data?.viewMode, outputImage, id, updateNodeInternals, panorama360Active, size.w, size.h]);

  // 生成耗时：进度进行中计时，结束写入 lastElapsedSec（标题旁仅展示标签）
  useEffect(() => {
    const running = progress > 0 && progress < 100;
    if (running) {
      if (!isTimerRunning) {
        genStartAtRef.current = Date.now();
        setIsTimerRunning(true);
        setElapsedSeconds(0);
      }
      return;
    }
    if (isTimerRunning) {
      const start = genStartAtRef.current ?? Date.now();
      const elapsed = Math.round(((Date.now() - start) / 1000) * 10) / 10;
      setIsTimerRunning(false);
      genStartAtRef.current = null;
      setElapsedSeconds(elapsed);
      if (elapsed > 0) {
        updateNodeData({ lastElapsedSec: elapsed });
      }
    }
  }, [progress, isTimerRunning, updateNodeData]);

  useEffect(() => {
    if (!isTimerRunning) return;
    timerIntervalRef.current = setInterval(() => {
      const start = genStartAtRef.current ?? Date.now();
      setElapsedSeconds(Math.round(((Date.now() - start) / 1000) * 10) / 10);
    }, 100);
    return () => {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, [isTimerRunning]);

  const displayElapsedSec = isTimerRunning
    ? elapsedSeconds
    : typeof data?.lastElapsedSec === 'number' && data.lastElapsedSec > 0
      ? data.lastElapsedSec
      : null;

  const displayTitleLabel = useMemo(() => {
    const raw = (title || '').trim() || 'image';
    if (raw.length <= 22) return raw;
    return `${raw.slice(0, 18)}...`;
  }, [title]);

  // Image 未被选中时收起 3D 弹窗
  useEffect(() => {
    if (!selected) {
      setIs3DPopoverOpen(false);
    }
  }, [selected]);

  // 清理历史残留的 open3DPopover（曾写入节点数据，缩放/重挂载会反复自动打开）
  useEffect(() => {
    if (!data?.open3DPopover) return;
    updateNodeData({ open3DPopover: false });
  }, [data?.open3DPopover, updateNodeData]);

  // 仅响应「新建视角模块」发出的一次性打开事件，不跟缩放/选中挂钩
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId?: string }>).detail;
      if (!detail?.nodeId || detail.nodeId !== id) return;
      const skipUntil = (window as Window & { __nexflowSkipClose3dUntil?: number }).__nexflowSkipClose3dUntil || 0;
      // 给新建落点一点时间，避免被同一次点击关掉
      const delay = Math.max(0, skipUntil - Date.now());
      window.setTimeout(() => {
        setIs3DPopoverOpen(true);
        requestAnimationFrame(() => {
          if (!nodeRef.current) return;
          const nodeRect = nodeRef.current.getBoundingClientRect();
          const popoverW = 440;
          const centerLeft = nodeRect.left + nodeRect.width / 2 - popoverW / 2;
          const left = Math.max(8, Math.min(centerLeft, window.innerWidth - popoverW - 8));
          setThreeDPopoverPosition({ left, top: nodeRect.bottom + 8 });
        });
      }, delay);
    };
    window.addEventListener('nexflow-open-3d-popover', onOpen as EventListener);
    return () => window.removeEventListener('nexflow-open-3d-popover', onOpen as EventListener);
  }, [id]);

  // 画布缩放/平移时：若弹窗开着只更新位置，绝不因缩放而自动打开
  // （打开仅来自上方事件或用户点击立方按钮）

  // 弹窗打开时检测 WebGL 可用性
  useEffect(() => {
    if (!is3DPopoverOpen) return;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      setWebglAvailable(!!gl);
      if (gl) (gl as WebGLRenderingContext).getExtension?.('WEBGL_lose_context')?.loseContext?.();
    } catch {
      setWebglAvailable(false);
    }
  }, [is3DPopoverOpen]);

  // 3D 弹窗定位：贴在当前视角生成模块正下方，相对模块水平居中
  const POPOVER_WIDTH = 440;
  const POPOVER_SIDE_GAP = 8;
  const updateThreeDPopoverPosition = useCallback(() => {
    if (!is3DPopoverOpen || !nodeRef.current) return;
    const nodeRect = nodeRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const centerLeft = nodeRect.left + nodeRect.width / 2 - POPOVER_WIDTH / 2;
    const left = Math.max(8, Math.min(centerLeft, vw - POPOVER_WIDTH - 8));
    let top = nodeRect.bottom + POPOVER_SIDE_GAP;
    // 下方空间不足时仍尽量贴模块底边，仅钳制到视口内
    top = Math.max(8, Math.min(top, vh - 120));

    setThreeDPopoverPosition({ left, top });
  }, [is3DPopoverOpen]);

  useEffect(() => {
    if (!is3DPopoverOpen) return;
    // 延迟一帧，确保 ReactFlow 画布变换后布局已更新
    const rafId = requestAnimationFrame(() => updateThreeDPopoverPosition());
    return () => cancelAnimationFrame(rafId);
  }, [updateThreeDPopoverPosition, is3DPopoverOpen, xPos, yPos, viewport.x, viewport.y, viewport.zoom, size.w, size.h]);

  useEffect(() => {
    if (!is3DPopoverOpen) return;
    const onScrollOrResize = () => updateThreeDPopoverPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    const ro = nodeRef.current ? new ResizeObserver(updateThreeDPopoverPosition) : null;
    if (nodeRef.current) ro?.observe(nodeRef.current);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      ro?.disconnect();
    };
  }, [is3DPopoverOpen, updateThreeDPopoverPosition]);

  /* 3D 弹窗：全局事件 / 点空白关闭；打开后短延迟再挂监听，避免同一次点击立刻关掉 */
  useEffect(() => {
    const onClose = () => {
      const skipUntil = (window as Window & { __nexflowSkipClose3dUntil?: number }).__nexflowSkipClose3dUntil || 0;
      if (Date.now() < skipUntil) return;
      setIs3DPopoverOpen(false);
    };
    window.addEventListener('nexflow-close-3d-popover', onClose);
    return () => window.removeEventListener('nexflow-close-3d-popover', onClose);
  }, []);
  useEffect(() => {
    if (!is3DPopoverOpen) return;
    const isInsideKeepOpen = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (target.closest(`#image-3d-popover-${id}`)) return true;
      if (target.closest('.panel-option-dropdown-menu')) return true;
      if (target.closest('.at-mention-menu')) return true;
      if (target.closest('.prompt-mention-menu')) return true;
      if (threeDTriggerRef.current?.contains(target)) return true;
      return false;
    };
    const handler = (e: PointerEvent) => {
      const skipUntil = (window as Window & { __nexflowSkipClose3dUntil?: number }).__nexflowSkipClose3dUntil || 0;
      if (Date.now() < skipUntil) return;
      if (isInsideKeepOpen(e.target)) return;
      setIs3DPopoverOpen(false);
    };
    // 延后挂载，避免打开按钮的 pointerdown 冒泡把刚打开的窗立刻关掉
    const timer = window.setTimeout(() => {
      document.addEventListener('pointerdown', handler, true);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', handler, true);
    };
  }, [is3DPopoverOpen, id]);

  // 双击标题进入编辑模式
  const handleTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 0);
  }, []);

  // 图片上传处理
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const handleUploadImage = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    console.log('[ImageNode] 点击上传按钮，fileInputRef.current:', fileInputRef.current);
    if (fileInputRef.current) {
      fileInputRef.current.click();
      console.log('[ImageNode] 已触发文件选择对话框');
    } else {
      console.error('[ImageNode] fileInputRef.current 为 null');
    }
  }, []);

  const handleDownloadImage = useCallback(async () => {
    // 优先使用原图（imageAsset.original），其次 outputImage，最后 originalImageUrl
    const url = data?.imageAsset?.original || outputImage || data?.originalImageUrl || '';
    if (!url) {
      showAlert(wc.noImageToDownload);
      return;
    }
    const isRemote = url.startsWith('http://') || url.startsWith('https://');
    const isDataUrl = url.startsWith('data:');
    // Electron 不支持 window.prompt，依赖 prompt 会拿到 null 并静默 return，表现为「下载无效」
    const finalName = (title || 'image').replace(/[/\\?*:|"]/g, '_').trim() || 'image';
    try {
      if (isRemote || isDataUrl) {
        const result = await window.electronAPI.downloadImage(url, finalName);
        if (!result.success && result.error && !result.error.includes('取消')) {
          showAlert(userFacingErrorMessage(result.error, locale));
        }
      } else if (url.startsWith('local-resource://') || url.startsWith('file://')) {
        const resolved = url.startsWith('file://')
          ? `local-resource://${url.replace(/^file:\/\/\/?/, '')}`
          : (projectId ? await mapProjectPath(url, projectId) : url);
        const result = await window.electronAPI.downloadLocalFileToFolder(resolved, finalName);
        if (!result.success && result.error && !result.error.includes('取消')) {
          showAlert(userFacingErrorMessage(result.error, locale));
        }
      } else {
        showAlert(locale === 'en' ? 'Unsupported image URL' : '不支持的图片地址格式');
      }
    } catch (err) {
      console.error('[ImageNode] 下载失败:', err);
      showAlert(userFacingErrorMessage(err instanceof Error ? err.message : wc.downloadFailed, locale));
    }
  }, [outputImage, data?.originalImageUrl, data?.imageAsset?.original, title, projectId, showAlert]);

  const dragOutFileSourceUrl = useMemo(
    () => (data?.imageAsset?.original || outputImage || data?.originalImageUrl || '').trim(),
    [data?.imageAsset?.original, data?.originalImageUrl, outputImage],
  );

  useEffect(() => {
    nativeDragPreparedPathRef.current = null;
    nativeDragPreparePromiseRef.current = null;
  }, [dragOutFileSourceUrl]);

  const beginNativeDragPrepare = useCallback(() => {
    const url = dragOutFileSourceUrl;
    if (!url || url.startsWith('blob:')) {
      nativeDragPreparePromiseRef.current = null;
      return;
    }
    nativeDragPreparePromiseRef.current = (async () => {
      try {
        const mapped =
          url.startsWith('local-resource://') && projectId ? await mapProjectPath(url, projectId) : url;
        const base = (title || 'image').replace(/[/\\?*:|"]/g, '_').trim() || 'image';
        const r = await window.electronAPI.prepareImageForExternalDrag({
          imageUrl: mapped,
          preferredBaseName: base,
        });
        const p = r.success && r.path ? r.path : null;
        nativeDragPreparedPathRef.current = p;
        return p;
      } catch (err) {
        console.error('[ImageNode] prepare native drag failed', err);
        nativeDragPreparedPathRef.current = null;
        return null;
      }
    })();
  }, [dragOutFileSourceUrl, projectId, title]);

  const startNativeFileDragIfReady = useCallback(async () => {
    if (nativeDragStartedRef.current) return;
    let fp = nativeDragPreparedPathRef.current;
    if (!fp && nativeDragPreparePromiseRef.current) {
      try {
        fp = await nativeDragPreparePromiseRef.current;
      } catch {
        fp = null;
      }
    }
    if (!fp) {
      const url = dragOutFileSourceUrl;
      if (!url || url.startsWith('blob:')) return;
      const mapped =
        url.startsWith('local-resource://') && projectId ? await mapProjectPath(url, projectId) : url;
      const base = (title || 'image').replace(/[/\\?*:|"]/g, '_').trim() || 'image';
      const r = await window.electronAPI.prepareImageForExternalDrag({
        imageUrl: mapped,
        preferredBaseName: base,
      });
      fp = r.success && r.path ? r.path : null;
    }
    if (!fp || nativeDragStartedRef.current) return;
    nativeDragStartedRef.current = true;
    window.electronAPI.startNativeFileDrag(fp);
  }, [dragOutFileSourceUrl, projectId, title]);

  const handleOutputImageDragStart = useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation();
      nativeDragStartedRef.current = false;
      const dragUrl = String(dragOutFileSourceUrl || '').trim();
      if (dragUrl && !dragUrl.startsWith('blob:') && e.dataTransfer) {
        fillCanvasImageDragTransfer(e.dataTransfer, dragUrl);
      }
    },
    [dragOutFileSourceUrl],
  );

  const handleOutputImageDrag = useCallback(
    (e: React.DragEvent) => {
      const outside =
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight;
      if (outside) void startNativeFileDragIfReady();
    },
    [startNativeFileDragIfReady],
  );

  const handleOutputImageDragEnd = useCallback(() => {
    nativeDragStartedRef.current = false;
    endCanvasImageDrag();
  }, []);

  const handleSplitGridToCanvas = useCallback(
    async (mode: GridSplitMode, e?: React.SyntheticEvent) => {
      e?.stopPropagation();
      e?.preventDefault();
      if (nineSplitAnim || isSplitNineBusy) return;

      const { cols: flowCols, rows: flowRows, cells } = gridSplitLayout(mode);
      const multi = outputImages.length > 1;
      const singleSrc = outputImage || outputImages[0] || '';
      if (!singleSrc && !multi) return;

      const GAP = 40;
      const CELL_GAP = 28;

      const selfRf = getNodes().find((n) => n.id === id);
      const anchorX = selfRf?.positionAbsolute?.x ?? selfRf?.position?.x ?? xPos;
      const anchorY = selfRf?.positionAbsolute?.y ?? selfRf?.position?.y ?? yPos;

      const makeFlowAndTo = (n: number, splitW: number, splitH: number, cols: number) => {
        const flowPositions: { x: number; y: number }[] = [];
        for (let i = 0; i < n; i++) {
          const col = i % cols;
          const row = Math.floor(i / cols);
          flowPositions.push({
            x: anchorX + size.w + GAP + col * (splitW + CELL_GAP),
            y: anchorY + row * (splitH + CELL_GAP),
          });
        }
        const toRects = flowPositions.map((pos) => {
          const tl = flowToScreenPosition({ x: pos.x, y: pos.y });
          const br = flowToScreenPosition({ x: pos.x + splitW, y: pos.y + splitH });
          return {
            left: tl.x,
            top: tl.y,
            width: Math.max(1, br.x - tl.x),
            height: Math.max(1, br.y - tl.y),
          };
        });
        return { flowPositions, toRects };
      };

      const labelForIndex = (i: number) => {
        if (flowCols === 2 && flowRows === 2) return imgc.splitFourNodeLabel(i);
        if (flowCols === 3 && flowRows === 3) return imgc.splitNineNodeLabel(i);
        if ((flowCols === 2 && flowRows === 3) || (flowCols === 3 && flowRows === 2)) {
          return imgc.splitSixNodeLabel(i);
        }
        return imgc.splitCustomNodeLabel(i);
      };

      setIsSplitNineBusy(true);
      try {
        let urls: string[];
        let splitW: number;
        let splitH: number;
        let from: { left: number; top: number; width: number; height: number }[];
        let to: { left: number; top: number; width: number; height: number }[];
        let flowPositions: { x: number; y: number }[];
        let tileAssets: NineSplitPayload['tileAssets'];

        if (multi) {
          const cap = Math.min(cells, outputImages.length);
          urls = outputImages
            .slice(0, cap)
            .map((u) => formatImagePath(String(u || '')))
            .filter(Boolean);
          const n = urls.length;
          if (n < 2) return;
          const domCols = flowCols;
          const domRows = flowRows;
          splitW = clampW(Math.round(size.w / domCols));
          splitH = clampH(Math.round(size.h / domRows));
          const ft = makeFlowAndTo(n, splitW, splitH, flowCols);
          flowPositions = ft.flowPositions;
          to = ft.toRects;
          const gridEl = nineGridRef.current || imgContainerRef.current;
          const allFrom = gridEl
            ? getOutputGridCellScreenRectsFromBounds(gridEl.getBoundingClientRect(), domCols, domRows)
            : null;
          from = (allFrom ?? to).slice(0, n);
          tileAssets = undefined;
        } else {
          if (!window.electronAPI?.createImageLocalResourceFromBuffer) {
            showAlert(imgc.splitNineCropFailed);
            return;
          }
          let imgBitmap: HTMLImageElement;
          try {
            imgBitmap = await loadImageForCanvasDecode(singleSrc, data);
          } catch (err) {
            console.error('[ImageNode] grid-split decode', err);
            showAlert(userFacingErrorMessage(err instanceof Error ? err.message : imgc.splitNineCropFailed, locale));
            return;
          }
          const nw = imgBitmap.naturalWidth;
          const nh = imgBitmap.naturalHeight;

          if (nw < flowCols || nh < flowRows) {
            showAlert(imgc.splitNineCropFailed);
            return;
          }
          const fromRects = getGridScreenRectsFromObjectContain(
            imgContainerRef.current,
            nw,
            nh,
            flowCols,
            flowRows,
          );
          if (fromRects.length !== cells) {
            showAlert(imgc.splitNineCropFailed);
            return;
          }
          let buffers: ArrayBuffer[];
          let sw0: number;
          let sh0: number;
          try {
            const cropped = await cropGridTilesToPngBuffers(imgBitmap, flowCols, flowRows);
            buffers = cropped.buffers;
            sw0 = cropped.sw;
            sh0 = cropped.sh;
          } catch (err) {
            console.error('[ImageNode] grid-split crop', err);
            showAlert(userFacingErrorMessage(err instanceof Error ? err.message : imgc.splitNineCropFailed, locale));
            return;
          }
          const adapted = computeAdaptiveNodeSize(sw0, sh0);
          splitW = adapted.w;
          splitH = adapted.h;
          const ft = makeFlowAndTo(cells, splitW, splitH, flowCols);
          flowPositions = ft.flowPositions;
          to = ft.toRects;
          from = fromRects;
          const ts = Date.now();
          const filePrefix =
            flowCols === 2 && flowRows === 2
              ? 'four-grid'
              : flowCols === 3 && flowRows === 3
                ? 'nine-split'
                : `grid-${flowCols}x${flowRows}`;
          const results: {
            previewUrl: string;
            originalUrl: string;
            tinyUrl?: string;
            originalPath?: string;
            avgColorHex?: string;
            width?: number;
            height?: number;
          }[] = [];
          for (let i = 0; i < cells; i++) {
            const result = await window.electronAPI.createImageLocalResourceFromBuffer(
              projectId ?? undefined,
              `${filePrefix}-${ts}-${i}.png`,
              buffers[i],
            );
            results.push(result);
          }
          urls = results.map((r) => formatImagePath(r.previewUrl)).filter(Boolean);
          if (urls.length !== cells) {
            showAlert(imgc.splitNineCropFailed);
            return;
          }
          tileAssets = results.map((r) => ({
            outputImage: formatImagePath(r.previewUrl),
            originalImageUrl: formatImagePath(r.originalUrl),
            tinyThumbUrl: r.tinyUrl || '',
            localPath: r.originalPath,
            imageAsset: {
              preview: formatImagePath(r.previewUrl),
              original: formatImagePath(r.originalUrl),
              tiny: r.tinyUrl || '',
              avgColorHex: r.avgColorHex,
              width: r.width,
              height: r.height,
            },
          }));
        }

        const n = urls.length;
        const d = data as any;
        nineSplitPayloadRef.current = {
          urls,
          flowPositions,
          splitW,
          splitH,
          labels: urls.map((_, i) => labelForIndex(i)),
          resolution: data?.resolution ?? '1k',
          aspectRatio: data?.aspectRatio ?? DEFAULT_IMAGE_ASPECT_RATIO,
          model: data?.model ?? DEFAULT_IMAGE_MODEL,
          seedreamWidth: d?.seedreamWidth ?? 2048,
          seedreamHeight: d?.seedreamHeight ?? 2048,
          avgColorHex: data?.avgColorHex || data?.imageAsset?.avgColorHex || '',
          tileAssets,
        };
        setNineSplitAnim({ urls, from: from.slice(0, n), to: to.slice(0, n) });
      } finally {
        setIsSplitNineBusy(false);
      }
    },
    [
      outputImages,
      outputImage,
      nineSplitAnim,
      isSplitNineBusy,
      imgc,
      id,
      getNodes,
      size.w,
      size.h,
      xPos,
      yPos,
      data,
      clampW,
      clampH,
      flowToScreenPosition,
      computeAdaptiveNodeSize,
      projectId,
      showAlert,
      locale,
    ],
  );

  useEffect(() => {
    if (!nineSplitAnim) return;
    const n = nineSplitAnim.urls.length;
    const delayMs = 850 + n * 55;
    const handle = window.setTimeout(() => {
      const p = nineSplitPayloadRef.current;
      if (!p) {
        setNineSplitAnim(null);
        return;
      }
      nineSplitPayloadRef.current = null;
      const baseTs = Date.now();
      const lastIdx = p.urls.length - 1;
      const newNodes: Node[] = p.urls.map((url, i) => {
        const ta = p.tileAssets?.[i];
        const out = ta?.outputImage ?? url;
        return {
          id: `image-${baseTs}-${i}`,
          type: 'image',
          position: p.flowPositions[i]!,
          selected: i === lastIdx,
          data: {
            label: p.labels[i],
            width: p.splitW,
            height: p.splitH,
            isUserResized: false,
            title: 'image',
            resolution: p.resolution,
            aspectRatio: p.aspectRatio,
            model: p.model,
            seedreamWidth: p.seedreamWidth,
            seedreamHeight: p.seedreamHeight,
            outputImage: out,
            outputImages: [out],
            originalImageUrl: ta?.originalImageUrl ?? url,
            tinyThumbUrl: ta?.tinyThumbUrl ?? '',
            localPath: ta?.localPath,
            imageAsset: ta?.imageAsset,
            avgColorHex: ta?.imageAsset?.avgColorHex ?? p.avgColorHex,
            progress: 0,
            errorMessage: undefined,
          },
          style: {
            width: `${p.splitW}px`,
            height: `${p.splitH}px`,
            minWidth: `${IMAGE_NODE_MIN_W}px`,
            minHeight: `${IMAGE_NODE_MIN_H}px`,
          },
        };
      });
      if (onAddCanvasImageNodes) {
        onAddCanvasImageNodes(newNodes);
      } else {
        console.warn('[ImageNode] onAddCanvasImageNodes 未注入，拆分图片无法保留到画布');
      }
      setNineSplitAnim(null);
    }, delayMs);
    return () => window.clearTimeout(handle);
  }, [nineSplitAnim, onAddCanvasImageNodes]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    console.log('[ImageNode] 文件选择事件触发，文件:', file);
    
    if (!file) {
      console.warn('[ImageNode] 未选择文件');
      return;
    }
    
    // 检查文件类型
    if (!file.type.startsWith('image/')) {
      console.error('[ImageNode] 只能上传图片文件，当前文件类型:', file.type);
      return;
    }
    
    console.log('[ImageNode] 开始保存原图并生成预览图:', file.name, '类型:', file.type, '大小:', file.size);
    try {
      if (!window.electronAPI?.createImageLocalResourceFromBuffer) {
        throw new Error('createImageLocalResourceFromBuffer IPC 不可用');
      }
      const buffer = await file.arrayBuffer();
      const result = await window.electronAPI.createImageLocalResourceFromBuffer(projectId, file.name, buffer);
      if (!result?.previewUrl) {
        throw new Error('预览图路径为空');
      }

      // UI 与画布统一使用 preview 路径；保留原图路径用于后续能力扩展
      setOutputImage(result.previewUrl);
      const adapted = computeAdaptiveNodeSize(result.width, result.height);
      const nextUpdates: Partial<ImageNodeData> = {
        outputImage: result.previewUrl,
        originalImageUrl: result.originalUrl,
        localPath: result.originalPath,
        tinyThumbUrl: result.tinyUrl,
        avgColorHex: result.avgColorHex,
        imageAsset: {
          preview: result.previewUrl,
          tiny: result.tinyUrl,
          original: result.originalUrl,
          ghost: result.ghostBase64,
          avgColorHex: result.avgColorHex,
          width: result.width,
          height: result.height,
        },
        width: adapted.w,
        height: adapted.h,
      };
      setSize(adapted);
      updateNodeData({
        ...nextUpdates,
      });
    } catch (error) {
      console.error('[ImageNode] 本地资源管理失败:', error);
    }
    
    // 清空 input，允许重复上传同一文件
    e.target.value = '';
  }, [projectId, updateNodeData, computeAdaptiveNodeSize]);

  // 防御性 style 合并：baseStyle + 可选 filter，确保无 undefined 等非法值导致渲染引擎异常
  const baseStyle: React.CSSProperties = {
    width: size.w,
    height: size.h,
    minWidth: `${IMAGE_NODE_MIN_W}px`,
    minHeight: `${IMAGE_NODE_MIN_H}px`,
    userSelect: isResizing ? 'none' : 'auto',
    willChange: isResizing ? 'transform, width, height' : dragging ? 'transform' : 'auto',
    backfaceVisibility: isResizing ? 'hidden' : 'visible',
    transition:
      suppressSizeTransition || panorama360Active || isResizing || dragging
        ? 'none'
        : `${NODE_SIZE_TRANSITION}, background-color 0.2s, border-color 0.2s`,
  };
  const combinedStyle: React.CSSProperties = baseStyle;

  const zoom = viewport.zoom ?? 1;
  // 工具栏反缩放：量化步进，避免 liveZoom 微抖动导致按钮「发抖」
  const liveZoom = useFrozenFlowZoom(zoom);
  // 镜头拉远：随画布缩小；拉近：反缩放，避免操作栏撑满屏幕
  const zoomInv = useMemo(() => {
    const z = Math.max(liveZoom || zoom || 1, 0.01);
    const raw = Math.min(1, 1 / z);
    return Math.round(raw * 50) / 50;
  }, [liveZoom, zoom]);
  const imagePromptAnchor = useImageInputPanelAnchor();
  const showImagePromptPanel =
    !!imagePromptAnchor &&
    imagePromptAnchor.nodeId === id &&
    !!selected &&
    !is3DPopoverOpen &&
    !panorama360Active &&
    !showCropModal;
  const vx = viewport.x ?? 0;
  const vy = viewport.y ?? 0;
  const effectivePrefetchScreenFactor = 2.0;
  const isFpsProtected = runtimeFps > 0 && runtimeFps < FPS_PROTECT_THRESHOLD;
  const [lodLevel, setLodLevel] = useState<'far' | 'mid' | 'near'>(() => {
    if (zoom < ZOOM_THRESHOLD_FAR) return 'far';
    if (zoom < ZOOM_THRESHOLD_NEAR) return 'mid';
    return 'near';
  });
  useEffect(() => {
    if (TAPNOW_INTERACTION_SUSPEND && isVisualInteractionLocked) return; /* [Tapnow] 交互期间冻结 LOD */
    setLodLevel((prev) => {
      if (prev === 'near') {
        return zoom < ZOOM_THRESHOLD_NEAR - LOD_HYSTERESIS ? 'mid' : 'near';
      }
      if (prev === 'mid') {
        if (zoom >= ZOOM_THRESHOLD_NEAR + LOD_HYSTERESIS) return 'near';
        if (zoom < ZOOM_THRESHOLD_FAR - LOD_HYSTERESIS) return 'far';
        return 'mid';
      }
      return zoom >= ZOOM_THRESHOLD_FAR + LOD_HYSTERESIS ? 'mid' : 'far';
    });
  }, [zoom, isVisualInteractionLocked]);
  // 小控件显示采用稳定规则：仅由 LOD 控制，不受交互态/FPS 保护抖动影响。
  const showDetailedUi = lodLevel === 'near';
  const showTextLabelInFar = zoom >= ZOOM_THRESHOLD_ICON_ONLY;
  const ghostImage = data?.imageAsset?.ghost || '';
  const tinyImagePath = useMemo(() => data?.imageAsset?.tiny || data?.tinyThumbUrl || '', [data?.imageAsset?.tiny, data?.tinyThumbUrl]);
  const inputReferenceKeySet = useMemo(
    () => buildInputReferenceKeySet(data?.inputImages),
    [data?.inputImages],
  );
  const mergedPrimaryOutput = useMemo(
    () => mergePrimaryImageOutput(outputImage, outputImages, data?.outputImage as string | undefined, data?.outputImages),
    [outputImages, outputImage, data?.outputImage, data?.outputImages],
  );
  /** 主图 URL：本地 state 与 props 合并；自动保存后 data 已为 local-resource 时不得再被 state 里短暂/卡住的 OSS 盖住 */
  const primaryOutputImage = useMemo(
    () =>
      resolveMainModuleDisplayUrl(
        mergedPrimaryOutput,
        data?.outputImage as string | undefined,
        data?.outputImages,
        inputReferenceKeySet,
        hasIncomingImageSource,
      ),
    [mergedPrimaryOutput, data?.outputImage, data?.outputImages, inputReferenceKeySet, hasIncomingImageSource],
  );

  /** 视角立方体 / 生成用图：优先本节点输出，否则用上游参考图 */
  const cameraSourceImageUrl = useMemo(() => {
    const fromOutput = primaryOutputImage || tinyImagePath || '';
    if (fromOutput) return fromOutput;
    const inputs = Array.isArray(data?.inputImages) ? data.inputImages : [];
    for (const u of inputs) {
      const s = String(u || '').trim();
      if (s) return s;
    }
    return '';
  }, [primaryOutputImage, tinyImagePath, data?.inputImages]);

  const { status: cameraAiStatus, execute: executeCameraAI } = useAI({
    nodeId: id,
    modelId: 'image',
    onStatusUpdate: (packet) => {
      if (packet.status === 'START') {
        setProgress(1);
        setProgressMessage(wc.progressImage);
      } else if (packet.status === 'PROCESSING' && packet.payload?.progress !== undefined) {
        setProgress(packet.payload.progress);
        const t = (packet.payload.text || wc.progressImage).replace(/\s*\d+%$/, '').trim();
        setProgressMessage(t || wc.progressImage);
      } else if (packet.status === 'SUCCESS' || packet.status === 'ERROR') {
        setProgress(0);
        setProgressMessage('');
      }
    },
    onComplete: (result) => {
      const localPath = result?.localPath;
      let imageUrl = result?.imageUrl;
      if (localPath) {
        let filePath = localPath.replace(/\\/g, '/');
        if (filePath.match(/^\/[a-zA-Z]:/)) filePath = filePath.substring(1);
        imageUrl = `local-resource://${filePath}`;
      }
      if (!imageUrl) return;
      // 写回当前视角模块（原图节点不变）
      setOutputImage(imageUrl);
      setOutputImages([imageUrl]);
      updateNodeData({
        outputImage: imageUrl,
        outputImages: [imageUrl],
        errorMessage: undefined,
        progress: 0,
        imageAsset: buildImageAssetAfterAuxUrl(data?.imageAsset, imageUrl),
      });
      setProgress(0);
      setProgressMessage('');
    },
    onError: (error) => {
      const msg = typeof error === 'string' ? error : String(error || imgc.needImageFirst);
      setErrorMessage(msg);
      updateNodeData({ errorMessage: msg, progress: 0 });
      setProgress(0);
      setProgressMessage('');
    },
  });

  const cameraGenModelOptions = useMemo(
    () =>
      filterImageModelsForMode({ hasRefs: true, refCount: 1 }).map(({ value, label }) => ({
        value,
        label,
      })),
    [],
  );

  const cameraGenUsesTierResolution = cameraGenModel === 'flux2-klein';
  const cameraGenResolutionOptions = useMemo(() => {
    if (cameraGenUsesTierResolution) {
      return [
        { value: '720p', label: '720P' },
        { value: '1080p', label: '1080P' },
      ];
    }
    return [
      { value: '1k', label: '1k' },
      { value: '2k', label: '2k' },
      { value: '4k', label: '4k' },
    ];
  }, [cameraGenUsesTierResolution]);

  const cameraGenAspectOptions = useMemo(() => {
    const presets =
      cameraGenModel === 'seedream-v5'
        ? CAMERA_SEEDREAM_ASPECTS
        : cameraGenUsesTierResolution
          ? [...Z_IMAGE_ASPECT_RATIOS]
          : cameraGenModel === 'gpt-image-2'
            ? ['1:1', '3:2', '2:3', '5:4', '4:5', '16:9', '9:16', '21:9', '3:4', '4:3']
            : [...CAMERA_BANANA_ASPECTS];
    return [
      { value: 'original', label: imgc.cameraControlAspectOriginal },
      ...presets.map((value) => ({ value, label: value })),
    ];
  }, [cameraGenModel, cameraGenUsesTierResolution, imgc.cameraControlAspectOriginal]);

  const cameraGenPriceYuanbao = useMemo(() => {
    try {
      const resolution = cameraGenUsesTierResolution
        ? normalizeZImageResolutionTier(cameraGenResolution)
        : cameraGenResolution;
      return getImageDisplayPrice(
        { model: cameraGenModel, resolution, quantity: 1 },
        cloudMap,
      );
    } catch (e) {
      if (isModelNotPricedError(e)) return null;
      return null;
    }
  }, [cameraGenModel, cameraGenResolution, cameraGenUsesTierResolution, cloudMap]);

  const cameraGenPriceLabel =
    cameraGenPriceYuanbao == null
      ? null
      : locale === 'en'
        ? `${cameraGenPriceYuanbao} ${imgc.creditsSuffix}`
        : `${cameraGenPriceYuanbao}${imgc.creditsSuffix}`;

  const resolveCameraAspectRatio = useCallback(async (): Promise<string> => {
    const allowed =
      cameraGenModel === 'seedream-v5'
        ? CAMERA_SEEDREAM_ASPECTS
        : cameraGenUsesTierResolution
          ? Z_IMAGE_ASPECT_RATIOS
          : cameraGenModel === 'gpt-image-2'
            ? ['1:1', '3:2', '2:3', '5:4', '4:5', '16:9', '9:16', '21:9', '3:4', '4:3']
            : CAMERA_BANANA_ASPECTS;
    if (cameraGenAspect !== 'original') {
      return snapAspectToAllowed(cameraGenAspect, allowed);
    }
    const assetW = Number(data?.imageAsset?.width) || 0;
    const assetH = Number(data?.imageAsset?.height) || 0;
    if (assetW > 0 && assetH > 0) {
      return snapAspectToAllowed(aspectRatioLabelFromPixelSize(assetW, assetH), allowed);
    }
    const src = getImageDisplaySrc(formatImagePath(cameraSourceImageUrl || '')) || '';
    if (!src) return snapAspectToAllowed('1:1', allowed);
    try {
      const px = await probeImagePixelSize(src);
      return snapAspectToAllowed(aspectRatioLabelFromPixelSize(px.width, px.height), allowed);
    } catch {
      const fallback = String(data?.aspectRatio || '1:1');
      return snapAspectToAllowed(fallback === 'original' ? '1:1' : fallback, allowed);
    }
  }, [
    cameraGenAspect,
    cameraGenModel,
    cameraGenUsesTierResolution,
    cameraSourceImageUrl,
    data?.aspectRatio,
    data?.imageAsset?.height,
    data?.imageAsset?.width,
  ]);

  /**
   * 在当前图片右侧新建图片模块并连线（原图不变）。
   * @returns 新节点 id；失败返回 null
   */
  const spawnLinkedImageModule = useCallback(
    (opts: {
      label: string;
      inputImageUrl: string;
      outputImageUrl?: string;
      extraData?: Record<string, unknown>;
      /** 指定新模块外框尺寸（如全景截图按实际像素适配） */
      nodeSize?: { w: number; h: number };
      /** 全景连续截图：强制水平错开，避免相互堆叠 */
      cascadeSpawn?: boolean;
      /**
       * 落点按此宽高贴源模块右侧（用于截图前仍是 360 放大态、即将还原的场景）。
       * 不传则读源节点当前 width/height。
       */
      sourceBoxOverride?: { w: number; h: number };
      /**
       * 固定贴在主模块右侧约 1cm，不做避让/错开（右侧已有模块可重叠）。
       * 画面裁剪等「结果必须紧挨源模块右侧」的场景使用。
       */
      pinToSourceRight?: boolean;
    }): string | null => {
      const srcFormatted = formatImagePath(opts.inputImageUrl);
      if (!srcFormatted) return null;
      /** 96dpi 下 1cm ≈ 37.8px；固定贴侧时用此间距 */
      const GAP_CM = 37.8;
      const GAP = opts.pinToSourceRight ? GAP_CM : 48;
      const aspect = snapAspectToAllowed(
        String(data?.aspectRatio || '1:1'),
        CAMERA_BANANA_ASPECTS,
      );
      const sized = opts.nodeSize
        ? { w: clampW(opts.nodeSize.w), h: clampH(opts.nodeSize.h) }
        : imageNodeSizeForAspectRatio(String(data?.aspectRatio || aspect)) ||
          { w: size.w, h: size.h };
      const seedreamDims = CAMERA_SEEDREAM_V5_RATIO_MAP[aspect] || { width: 2048, height: 2048 };
      const newNodeId = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const styleDims = nodeStyleDimensions(sized.w, sized.h);
      const outUrl = opts.outputImageUrl ? formatImagePath(opts.outputImageUrl) : '';

      const source = getNodes().find((n) => n.id === id);
      if (!source) return null;

      const srcW =
        (opts.sourceBoxOverride?.w && opts.sourceBoxOverride.w > 0
          ? opts.sourceBoxOverride.w
          : 0) ||
        Number(source.width) ||
        Number((source as { measured?: { width?: number } }).measured?.width) ||
        Number(source.data?.width) ||
        (nodeRef.current?.offsetWidth ?? 0) ||
        size.w;
      const srcH =
        (opts.sourceBoxOverride?.h && opts.sourceBoxOverride.h > 0
          ? opts.sourceBoxOverride.h
          : 0) ||
        Number(source.height) ||
        Number((source as { measured?: { height?: number } }).measured?.height) ||
        Number(source.data?.height) ||
        (nodeRef.current?.offsetHeight ?? 0) ||
        size.h;
      const anchorX = source.position.x + srcW + GAP;
      let newX = anchorX;
      let newY = source.position.y + Math.max(0, (srcH - sized.h) / 2);

      if (!opts.pinToSourceRight) {
        if (opts.cascadeSpawn && panoCaptureSpawnXRef.current != null) {
          newX = Math.max(newX, panoCaptureSpawnXRef.current);
        }

        const allNodes = getNodes();
        const nodeBox = (n: Node) => {
          const nw =
            Number(n.width) ||
            Number((n.style as { width?: number } | undefined)?.width) ||
            Number(n.data?.width) ||
            IMAGE_NODE_MIN_W;
          const nh =
            Number(n.height) ||
            Number((n.style as { height?: number } | undefined)?.height) ||
            Number(n.data?.height) ||
            IMAGE_NODE_MIN_H;
          return { x: n.position.x, y: n.position.y, w: nw, h: nh };
        };

        const priorTargets = getEdges()
          .filter((e) => e.source === id && e.target && e.target !== id)
          .map((e) => allNodes.find((n) => n.id === e.target))
          .filter((n): n is Node => !!n && n.type === 'image');
        if (priorTargets.length > 0) {
          let maxRight = newX;
          for (const n of priorTargets) {
            const box = nodeBox(n);
            if (box.x + box.w < anchorX - 4) continue;
            maxRight = Math.max(maxRight, box.x + box.w + GAP);
          }
          newX = Math.max(newX, maxRight);
        }

        /** AABB 避让：与画布上已有节点重叠则继续右移（必要时下移） */
        const overlapsAny = (x: number, y: number) =>
          allNodes.some((n) => {
            if (n.id === id) return false;
            const r = nodeBox(n);
            return (
              x < r.x + r.w + GAP &&
              x + sized.w + GAP > r.x &&
              y < r.y + r.h + GAP &&
              y + sized.h + GAP > r.y
            );
          });

        let guard = 0;
        while (overlapsAny(newX, newY) && guard < 48) {
          let pushed = false;
          for (const n of allNodes) {
            if (n.id === id) continue;
            const r = nodeBox(n);
            const hit =
              newX < r.x + r.w + GAP &&
              newX + sized.w + GAP > r.x &&
              newY < r.y + r.h + GAP &&
              newY + sized.h + GAP > r.y;
            if (hit) {
              newX = Math.max(newX, r.x + r.w + GAP);
              pushed = true;
            }
          }
          if (!pushed) newY += sized.h + GAP;
          guard += 1;
        }

        if (opts.cascadeSpawn) {
          panoCaptureSpawnXRef.current = newX + sized.w + GAP;
        }
      }

      const newNode: Node = {
        id: newNodeId,
        type: 'image',
        position: { x: newX, y: newY },
        width: sized.w,
        height: sized.h,
        selected: true,
        data: {
          label: opts.label,
          title: opts.label,
          isUserResized: false,
          resolution: (data?.resolution as string) || '1k',
          aspectRatio: data?.aspectRatio || aspect,
          model: (data?.model as string) || DEFAULT_IMAGE_MODEL,
          seedreamWidth: Number(data?.seedreamWidth) || seedreamDims.width,
          seedreamHeight: Number(data?.seedreamHeight) || seedreamDims.height,
          prompt: '',
          inputImages: [srcFormatted],
          ...(outUrl
            ? {
                outputImage: outUrl,
                outputImages: [outUrl],
                originalImageUrl: outUrl,
                imageAsset: { preview: outUrl, original: outUrl },
              }
            : {}),
          progress: 0,
          errorMessage: undefined,
          ...(opts.extraData || {}),
          width: sized.w,
          height: sized.h,
        },
        style: {
          ...styleDims,
          width: sized.w,
          height: sized.h,
          minWidth: `${IMAGE_NODE_MIN_W}px`,
          minHeight: `${IMAGE_NODE_MIN_H}px`,
        },
      };

      if (onAddCanvasImageNodes) {
        onAddCanvasImageNodes([newNode]);
      } else {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: false })).concat(newNode));
      }

      setEdges((eds) =>
        addEdge(
          {
            id: `e-${id}-${newNodeId}`,
            source: id,
            target: newNodeId,
            sourceHandle: 'output',
            targetHandle: 'image-input',
          },
          eds,
        ),
      );
      return newNodeId;
    },
    [
      clampH,
      clampW,
      data?.aspectRatio,
      data?.model,
      data?.resolution,
      data?.seedreamHeight,
      data?.seedreamWidth,
      getEdges,
      getNodes,
      id,
      onAddCanvasImageNodes,
      setEdges,
      setNodes,
      size.h,
      size.w,
    ],
  );

  const patchImageNodeData = useCallback(
    (nodeId: string, updates: Record<string, unknown>) => {
      // 画布 nodes 由 Workspace 受控：仅改 useReactFlow().setNodes 会被父状态覆盖，
      // 导致任务列表已有结果、右侧新模块仍停在进度中。必须同步走 onDataChange。
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
                ...n,
                data: {
                  ...n.data,
                  ...updates,
                },
              }
            : n,
        ),
      );
      if (typeof onDataChange === 'function') {
        onDataChange(nodeId, updates);
      }
    },
    [setNodes, onDataChange],
  );

  /** 点击 3D：在原图右侧新建视角模块并连线，控制器开在新模块上（不改原图） */
  const spawnCameraViewModule = useCallback(() => {
    const srcRaw = String(
      primaryOutputImage ||
        tinyImagePath ||
        data?.imageAsset?.preview ||
        data?.outputImage ||
        (Array.isArray(data?.outputImages) ? data.outputImages[0] : '') ||
        data?.localPath ||
        data?.originalImageUrl ||
        '',
    ).trim();
    if (!srcRaw) {
      setErrorMessage(imgc.cameraGenerateNeedImage);
      showAlert(imgc.cameraGenerateNeedImage);
      return;
    }

    setIs3DPopoverOpen(false);
    (window as Window & { __nexflowSkipClose3dUntil?: number }).__nexflowSkipClose3dUntil =
      Date.now() + 400;

    const newId = spawnLinkedImageModule({
      label: imgc.cameraGenerateNodeLabel,
      inputImageUrl: srcRaw,
      extraData: {
        isCameraViewModule: true,
        cameraControl: { ...DEFAULT_CAMERA_VALUE },
      },
      // 视角模块始终贴源图右侧创建，不因旁侧已有模块而避让错位
      pinToSourceRight: true,
    });
    if (!newId) {
      showAlert(imgc.cameraGenerateNeedImage);
      return;
    }
    // 一次性事件打开控制器，避免把 open3DPopover 写入节点数据后缩放又自动弹出
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('nexflow-open-3d-popover', { detail: { nodeId: newId } }),
      );
    }, 100);
  }, [
    data?.imageAsset?.preview,
    data?.localPath,
    data?.originalImageUrl,
    data?.outputImage,
    data?.outputImages,
    imgc.cameraGenerateNeedImage,
    imgc.cameraGenerateNodeLabel,
    primaryOutputImage,
    showAlert,
    spawnLinkedImageModule,
    tinyImagePath,
  ]);

  useEffect(() => {
    if (cameraGenAspect === 'original') return;
    const allowed = cameraGenAspectOptions.map((o) => o.value).filter((v) => v !== 'original');
    if (!allowed.includes(cameraGenAspect)) setCameraGenAspect('original');
  }, [cameraGenAspect, cameraGenAspectOptions]);

  useEffect(() => {
    const allowed = cameraGenResolutionOptions.map((o) => o.value);
    if (!allowed.includes(cameraGenResolution)) {
      setCameraGenResolution(allowed[0] || (cameraGenUsesTierResolution ? '720p' : '1k'));
    }
  }, [cameraGenResolution, cameraGenResolutionOptions, cameraGenUsesTierResolution]);

  const handleCameraGenerate = useCallback(async () => {
    const src = getImageDisplaySrc(formatImagePath(cameraSourceImageUrl || '')) || '';
    if (!src) {
      setErrorMessage(imgc.cameraGenerateNeedImage);
      return;
    }
    const { payload } = getPhotographyPrompt(cameraValue);
    const prompt =
      payload.prompt_metadata.qwen_instruction ||
      payload.prompt_metadata.formatted_output ||
      'Front view, eye-level, medium shot.';
    const aspect = await resolveCameraAspectRatio();
    cameraGenMetaRef.current = { aspect, model: cameraGenModel };
    const resolution = cameraGenUsesTierResolution
      ? normalizeZImageResolutionTier(cameraGenResolution)
      : cameraGenResolution;
    const seedreamDims =
      cameraGenModel === 'seedream-v5'
        ? CAMERA_SEEDREAM_V5_RATIO_MAP[aspect] || { width: 2048, height: 2048 }
        : cameraGenUsesTierResolution
          ? zImageDimensionsForAspect(aspect, resolution)
          : CAMERA_SEEDREAM_V5_RATIO_MAP[aspect] || { width: 2048, height: 2048 };
    setProgress(1);
    setProgressMessage(wc.progressImage);
    try {
      await executeCameraAI({
        model: cameraGenModel,
        prompt,
        response_format: 'url',
        aspect_ratio: aspect,
        resolution,
        seedreamWidth: seedreamDims.width,
        seedreamHeight: seedreamDims.height,
        image: [src],
        projectId,
      });
    } catch (err) {
      console.error('[ImageNode] 视角生成失败:', err);
    }
  }, [
    cameraSourceImageUrl,
    cameraValue,
    cameraGenModel,
    cameraGenResolution,
    cameraGenUsesTierResolution,
    executeCameraAI,
    imgc.cameraGenerateNeedImage,
    projectId,
    resolveCameraAspectRatio,
    wc.progressImage,
  ]);
  /** 截帧/粘贴等为 data: 或 blob: 时必须优先于旧 imageAsset.preview，否则预取队列会去拉已失效的 http 图 → 闪一下后「图片加载失败」 */
  const previewImagePath = useMemo(() => {
    const stripIfRefOnly = (url: string): string => {
      const u = (url || '').trim();
      if (!u) return '';
      if (inputReferenceKeySet.has(formatImagePath(u))) return '';
      return url;
    };

    const primary = resolveMainModuleDisplayUrl(
      mergedPrimaryOutput,
      data?.outputImage as string | undefined,
      data?.outputImages,
      inputReferenceKeySet,
      hasIncomingImageSource,
    );
    if (primary.startsWith('data:') || primary.startsWith('blob:')) return primary;

    const asset = (data?.imageAsset?.preview || '').trim();
    const tiny = (data?.imageAsset?.tiny || data?.tinyThumbUrl || '').trim();
    const localFallback = (data?.localPath || '').trim();

    if (!primary.trim()) {
      if (isNonHttpMediaUrl(localFallback)) return stripIfRefOnly(localFallback);
      return stripIfRefOnly(asset) || stripIfRefOnly(tiny) || '';
    }

    if (isNonHttpMediaUrl(primary) && asset && isHttpLikeMediaUrl(asset)) return primary;
    if (isHttpLikeMediaUrl(primary) && isNonHttpMediaUrl(localFallback)) return primary;
    if (isNonHttpMediaUrl(primary) && tiny && isHttpLikeMediaUrl(tiny)) return primary;
    if (isNonHttpMediaUrl(tiny) && asset && isHttpLikeMediaUrl(asset)) return stripIfRefOnly(tiny) || primary;

    return primary || stripIfRefOnly(asset) || stripIfRefOnly(tiny) || '';
  }, [
    mergedPrimaryOutput,
    data?.imageAsset?.preview,
    data?.imageAsset?.tiny,
    data?.tinyThumbUrl,
    data?.localPath,
    data?.outputImage,
    data?.outputImages,
    inputReferenceKeySet,
    hasIncomingImageSource,
  ]);
  /** 主图解码前占位：不用已失效的 OSS tiny */
  const loadingPlaceholderSrc = useMemo(() => {
    if (tinyImagePath && isNonHttpMediaUrl(tinyImagePath)) {
      const tinyKey = formatImagePath(tinyImagePath);
      if (!inputReferenceKeySet.has(tinyKey)) return tinyImagePath;
    }
    return previewImagePath || primaryOutputImage || '';
  }, [tinyImagePath, previewImagePath, primaryOutputImage, inputReferenceKeySet]);
  /** 主图 URL 经项目路径映射后的展示地址（与任务列表 TaskImageDisplay 一致），供 <img> fallback 与预加载队列使用 */
  const [resolvedDisplaySrc, setResolvedDisplaySrc] = useState('');
  useEffect(() => {
    const raw = previewImagePath || primaryOutputImage;
    if (!raw) {
      setResolvedDisplaySrc('');
      return;
    }
    let cancelled = false;
    void resolveImageSrcForElectronDisplay(raw, projectId).then((s) => {
      if (!cancelled) setResolvedDisplaySrc(s);
    });
    return () => {
      cancelled = true;
    };
  }, [previewImagePath, primaryOutputImage, projectId]);

  const isImageLoadedRef = useRef(false);
  isImageLoadedRef.current = isImageLoaded;
  const resolvedDisplaySrcRef = useRef('');
  resolvedDisplaySrcRef.current = resolvedDisplaySrc;
  useEffect(() => {
    transientImgErrorRetriesRef.current = 0;
  }, [primaryOutputImage]);

  /** 有图即可在模块内切换 360 环视（多图网格时不提供） */
  const showPanorama360Entry = useMemo(
    () => !!(primaryOutputImage && outputImages.length <= 1),
    [primaryOutputImage, outputImages.length],
  );
  const isPanorama360Mode = panorama360Active && showPanorama360Entry;
  const panoTextureUrl = useMemo(() => {
    const scene3d =
      typeof data?.sceneDisplay3dUrl === 'string' ? data.sceneDisplay3dUrl.trim() : '';
    if (scene3d) return getImageDisplaySrc(formatImagePath(scene3d));
    const flat = previewImagePath || primaryOutputImage || tinyImagePath;
    if (!flat) return '';
    return getImageDisplaySrc(formatImagePath(flat));
  }, [data?.sceneDisplay3dUrl, previewImagePath, primaryOutputImage, tinyImagePath]);

  useEffect(() => {
    const on = data?.viewMode === 'panorama360';
    setPanorama360Active(on);
    if (!on) {
      panoLockedSizeRef.current = null;
      return;
    }
    if (panoLockedSizeRef.current) return;
    const bw = data?.panorama360BaseWidth;
    const bh = data?.panorama360BaseHeight;
    if (typeof bw === 'number' && bw > 0 && typeof bh === 'number' && bh > 0) {
      panoLockedSizeRef.current = { w: clampW(bw * 2), h: clampH(bh * 2) };
    }
  }, [data?.viewMode, data?.panorama360BaseWidth, data?.panorama360BaseHeight, id]);

  useEffect(() => {
    if (outputImages.length > 1 && panorama360Active) {
      const backup =
        panoSizeBackupRef.current ||
        (typeof data?.panorama360BaseWidth === 'number' &&
        typeof data?.panorama360BaseHeight === 'number'
          ? { w: data.panorama360BaseWidth, h: data.panorama360BaseHeight }
          : null);
      panoSizeBackupRef.current = null;
      panoLockedSizeRef.current = null;
      setPanorama360Active(false);
      if (backup) {
        const nextW = clampW(backup.w);
        const nextH = clampH(backup.h);
        setSize({ w: nextW, h: nextH });
        updateNodeData({
          viewMode: 'flat',
          width: nextW,
          height: nextH,
          panorama360BaseWidth: undefined,
          panorama360BaseHeight: undefined,
        });
      } else if (data?.viewMode === 'panorama360') {
        updateNodeData({ viewMode: 'flat' });
      }
    }
  }, [
    outputImages.length,
    panorama360Active,
    data?.viewMode,
    data?.panorama360BaseWidth,
    data?.panorama360BaseHeight,
    updateNodeData,
  ]);

  const togglePanorama360Mode = useCallback(() => {
    if (!panoTextureUrl) {
      showAlert(imgc.panorama360NoImage);
      return;
    }
    const next = !panorama360Active;
    if (next && showCropModal) closeCropSession();
    setSuppressSizeTransition(true);

    const applyNodeBox = (nextW: number, nextH: number, dataPatch: Record<string, unknown>) => {
      const styleDims = nodeStyleDimensions(nextW, nextH);
      // 先同步 RF store 的 width/height（选框 getNodesBounds 读的是这里），再改本地 size / DOM
      flushSync(() => {
        setNodes((nds) =>
          nds.map((node) =>
            node.id === id
              ? {
                  ...node,
                  width: nextW,
                  height: nextH,
                  style: {
                    ...(node.style as object),
                    ...styleDims,
                    width: nextW,
                    height: nextH,
                  },
                  data: {
                    ...node.data,
                    ...dataPatch,
                    width: nextW,
                    height: nextH,
                  },
                }
              : node,
          ),
        );
      });
      setSize({ w: nextW, h: nextH });
      if (nodeRef.current) {
        nodeRef.current.style.width = `${nextW}px`;
        nodeRef.current.style.height = `${nextH}px`;
        nodeRef.current.style.minWidth = `${nextW}px`;
        nodeRef.current.style.minHeight = `${nextH}px`;
        const rfNode = nodeRef.current.closest('.react-flow__node') as HTMLElement | null;
        if (rfNode) {
          rfNode.style.width = `${nextW}px`;
          rfNode.style.height = `${nextH}px`;
        }
      }
      updateNodeInternals(id);
      requestAnimationFrame(() => {
        updateNodeInternals(id);
        requestAnimationFrame(() => updateNodeInternals(id));
      });
    };

    if (next) {
      // 进 360：放大为原尺寸 2 倍（便于环视）；退出时还原
      let baseW = size.w;
      let baseH = size.h;
      const bw = data?.panorama360BaseWidth;
      const bh = data?.panorama360BaseHeight;
      // 已是放大态时不要再 *2
      if (
        typeof bw === 'number' &&
        bw > 0 &&
        typeof bh === 'number' &&
        bh > 0 &&
        baseW >= bw * 1.7 &&
        baseH >= bh * 1.7
      ) {
        baseW = clampW(bw);
        baseH = clampH(bh);
      }
      panoSizeBackupRef.current = { w: baseW, h: baseH };
      panoCaptureSpawnXRef.current = null;
      const nextW = clampW(baseW * 2);
      const nextH = clampH(baseH * 2);
      panoLockedSizeRef.current = { w: nextW, h: nextH };
      // 先落定外框尺寸，再挂载 WebGL，避免「先开 360 再用旧宽高初始化」导致右侧黑边
      applyNodeBox(nextW, nextH, {
        viewMode: 'panorama360',
        panorama360BaseWidth: baseW,
        panorama360BaseHeight: baseH,
      });
      setPanorama360Active(true);
      // 放大瞬间记下选中态再取消；会话期间由 wasHidingRfSelectionRef effect 保持
      if (!wasHidingRfSelectionRef.current) {
        rfSessionRestoreSelectedRef.current =
          selected || getNodes().some((n) => n.id === id && n.selected);
      }
      flushSync(() => {
        setNodes((nds) =>
          nds.map((n) => (n.id === id ? { ...n, selected: false } : n)),
        );
      });
      storeApi.setState({ nodesSelectionActive: false });

      /** 与裁剪打开同级：约 320ms fitBounds 丝滑居中 */
      const PANO_FOCUS_MS = 320;
      const focusPanoModule = () => {
        try {
          if (!(nextW > 1 && nextH > 1)) return;
          window.dispatchEvent(
            new CustomEvent('nexflow-canvas-focus-nodes', {
              detail: {
                nodes: [{ id, width: nextW, height: nextH }],
                duration: PANO_FOCUS_MS,
                padding: 0.14,
              },
            }),
          );
        } catch (err) {
          console.warn('[ImageNode] 360 focus failed', err);
        }
      };
      requestAnimationFrame(() => {
        requestAnimationFrame(focusPanoModule);
      });
      window.setTimeout(focusPanoModule, 64);

      window.setTimeout(() => {
        updateNodeInternals(id);
        flushSync(() => {
          setNodes((nds) =>
            nds.map((node) =>
              node.id === id
                ? {
                    ...node,
                    width: nextW,
                    height: nextH,
                    style: {
                      ...(node.style as object),
                      ...nodeStyleDimensions(nextW, nextH),
                      width: nextW,
                      height: nextH,
                    },
                    data: {
                      ...node.data,
                      width: nextW,
                      height: nextH,
                      viewMode: 'panorama360',
                      panorama360BaseWidth: baseW,
                      panorama360BaseHeight: baseH,
                    },
                  }
                : node,
            ),
          );
        });
        updateNodeInternals(id);
        // 不再在此处重新打开 nodesSelectionActive：旧 measured 尺寸会立刻画出左上幽灵框
        focusPanoModule();
      }, 48);
    } else {
      const backup =
        panoSizeBackupRef.current ||
        (typeof data?.panorama360BaseWidth === 'number' &&
        typeof data?.panorama360BaseHeight === 'number'
          ? { w: data.panorama360BaseWidth, h: data.panorama360BaseHeight }
          : { w: clampW(size.w / 2), h: clampH(size.h / 2) });
      panoSizeBackupRef.current = null;
      panoLockedSizeRef.current = null;
      const nextW = clampW(backup.w);
      const nextH = clampH(backup.h);
      setPanorama360Active(false);
      applyNodeBox(nextW, nextH, {
        viewMode: 'flat',
        panorama360BaseWidth: undefined,
        panorama360BaseHeight: undefined,
      });
    }
    window.setTimeout(() => setSuppressSizeTransition(false), 50);
  }, [
    panoTextureUrl,
    panorama360Active,
    showCropModal,
    closeCropSession,
    size.w,
    size.h,
    data?.panorama360BaseWidth,
    data?.panorama360BaseHeight,
    id,
    setNodes,
    updateNodeInternals,
    showAlert,
    imgc.panorama360NoImage,
    storeApi,
    getNodes,
    selected,
  ]);

  /** 360 预览期间持续把 RF node 宽高钉在锁定尺寸，未退出前不允许变小 */
  useLayoutEffect(() => {
    if (!panorama360Active) return;
    const locked = panoLockedSizeRef.current;
    const w = Math.round(locked?.w ?? size.w);
    const h = Math.round(locked?.h ?? size.h);
    if (w < 2 || h < 2) return;
    if (!panoLockedSizeRef.current) {
      panoLockedSizeRef.current = { w, h };
    }

    const syncRfBox = () => {
      const rfNode = nodeRef.current?.closest('.react-flow__node') as HTMLElement | null;
      if (rfNode) {
        rfNode.style.width = `${w}px`;
        rfNode.style.height = `${h}px`;
        rfNode.style.minWidth = `${w}px`;
        rfNode.style.minHeight = `${h}px`;
      }
      if (nodeRef.current) {
        nodeRef.current.style.width = `${w}px`;
        nodeRef.current.style.height = `${h}px`;
        nodeRef.current.style.minWidth = `${w}px`;
        nodeRef.current.style.minHeight = `${h}px`;
      }
      const internals = storeApi.getState().nodeInternals;
      const node = internals.get(id);
      if (node && (node.width !== w || node.height !== h)) {
        const nextMap = new Map(internals);
        nextMap.set(id, {
          ...node,
          width: w,
          height: h,
          style: {
            ...(node.style as object),
            ...nodeStyleDimensions(w, h),
            width: w,
            height: h,
          },
        });
        storeApi.setState({ nodeInternals: nextMap });
      }
    };

    setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));

    const cur = getNodes().find((n) => n.id === id);
    if (!cur || cur.width !== w || cur.height !== h || (cur.data as any)?.width !== w) {
      flushSync(() => {
        setNodes((nds) =>
          nds.map((node) =>
            node.id === id
              ? {
                  ...node,
                  width: w,
                  height: h,
                  style: {
                    ...(node.style as object),
                    ...nodeStyleDimensions(w, h),
                    width: w,
                    height: h,
                  },
                  data: {
                    ...node.data,
                    width: w,
                    height: h,
                    viewMode: 'panorama360',
                  },
                }
              : node,
          ),
        );
      });
    }
    syncRfBox();
    updateNodeInternals(id);
    const t = window.setTimeout(() => {
      syncRfBox();
      updateNodeInternals(id);
    }, 48);
    return () => window.clearTimeout(t);
  }, [panorama360Active, size.w, size.h, id, getNodes, setNodes, updateNodeInternals, storeApi]);

  useEffect(() => {
    return () => {
      if (panoramaConvertLeaveTimerRef.current != null) {
        clearTimeout(panoramaConvertLeaveTimerRef.current);
      }
    };
  }, []);

  const openPanoramaConvertHover = useCallback(() => {
    if (panoramaConvertLeaveTimerRef.current != null) {
      clearTimeout(panoramaConvertLeaveTimerRef.current);
      panoramaConvertLeaveTimerRef.current = null;
    }
    setPanoramaConvertHover(true);
  }, []);

  const scheduleClosePanoramaConvertHover = useCallback(() => {
    if (panoramaConvertLeaveTimerRef.current != null) {
      clearTimeout(panoramaConvertLeaveTimerRef.current);
    }
    panoramaConvertLeaveTimerRef.current = setTimeout(() => {
      panoramaConvertLeaveTimerRef.current = null;
      setPanoramaConvertHover(false);
      setScene360ModelMenuOpen(false);
      setScene360PriceHoverModel(null);
    }, 160);
  }, []);

  const openScene360ModelMenu = useCallback(() => {
    openPanoramaConvertHover();
    setScene360ModelMenuOpen(true);
  }, [openPanoramaConvertHover]);

  const runScene360ConvertWithModel = useCallback(
    async (model: string) => {
      const nextPrompt = imagePanelT.tagScene3dPrompt;
      const aspectRatio = '21:9';
      const resolution = scene360ResolutionForModel(model);
      const seedreamDims =
        model === 'seedream-v5'
          ? CAMERA_SEEDREAM_V5_RATIO_MAP[aspectRatio] || { width: 3136, height: 1344 }
          : model === 'flux2-klein'
            ? zImageDimensionsForAspect(aspectRatio, normalizeZImageResolutionTier(resolution))
            : CAMERA_SEEDREAM_V5_RATIO_MAP[aspectRatio] || { width: 3136, height: 1344 };

      updateNodeData({
        prompt: nextPrompt,
        model,
        aspectRatio,
        resolution,
        seedreamWidth: seedreamDims.width,
        seedreamHeight: seedreamDims.height,
      });
      window.dispatchEvent(
        new CustomEvent('nexflow-image-scene360-preset', {
          detail: {
            nodeId: id,
            prompt: nextPrompt,
            model,
            aspectRatio,
            resolution,
          },
        }),
      );
      setPanoramaConvertHover(false);
      setScene360ModelMenuOpen(false);
      setScene360PriceHoverModel(null);

      const src = getImageDisplaySrc(formatImagePath(cameraSourceImageUrl || '')) || '';
      if (!src) {
        setErrorMessage(imgc.needImageFirst);
        return;
      }
      if (cameraAiStatus === 'START' || cameraAiStatus === 'PROCESSING') {
        return;
      }

      setProgress(1);
      setProgressMessage(wc.progressImage);
      try {
        await executeCameraAI({
          model,
          prompt: nextPrompt,
          response_format: 'url',
          aspect_ratio: aspectRatio,
          resolution,
          seedreamWidth: seedreamDims.width,
          seedreamHeight: seedreamDims.height,
          image: [src],
          projectId,
        });
      } catch (err) {
        console.error('[ImageNode] 场景转换360失败:', err);
      }
    },
    [
      cameraAiStatus,
      cameraSourceImageUrl,
      executeCameraAI,
      id,
      imagePanelT.tagScene3dPrompt,
      imgc.needImageFirst,
      projectId,
      scene360ResolutionForModel,
      updateNodeData,
      wc.progressImage,
    ],
  );

  const handlePanoramaScreenshot = useCallback(
    async (buffer: ArrayBuffer) => {
      if (!projectId) {
        showAlert(imgc.panorama360NeedProject);
        return;
      }
      if (!window.electronAPI?.createImageLocalResourceFromBuffer) {
        showAlert(imgc.panorama360CaptureFailed);
        return;
      }
      try {
        const result = await window.electronAPI.createImageLocalResourceFromBuffer(
          projectId,
          `pano-capture-${Date.now()}.png`,
          buffer,
        );
        if (!result?.previewUrl) throw new Error('preview empty');
        const w = Number(result.width) || 0;
        const h = Number(result.height) || 0;
        const adapted =
          w > 0 && h > 0 ? computeAdaptiveNodeSize(w, h) : undefined;

        // 落点按「退出 360 后」的外框算，避免按 2 倍宽生成后缩回留下大空档
        const placeBox =
          panoSizeBackupRef.current ||
          (typeof data?.panorama360BaseWidth === 'number' &&
          typeof data?.panorama360BaseHeight === 'number'
            ? { w: data.panorama360BaseWidth, h: data.panorama360BaseHeight }
            : null);

        // 截取后退出浏览器全屏
        try {
          if (panoControlsRef.current?.isFullscreen()) {
            await panoControlsRef.current.toggleFullscreen();
          } else if (document.fullscreenElement) {
            await document.exitFullscreen();
          }
        } catch {
          /* ignore */
        }

        // 先退出 360 还原模块尺寸，再贴右侧生成截图模块
        if (panorama360Active) {
          togglePanorama360Mode();
        }

        spawnLinkedImageModule({
          label: imgc.panorama360CaptureNodeLabel,
          inputImageUrl: result.previewUrl,
          outputImageUrl: result.previewUrl,
          cascadeSpawn: true,
          ...(adapted ? { nodeSize: adapted } : {}),
          ...(placeBox ? { sourceBoxOverride: placeBox } : {}),
          extraData: {
            originalImageUrl: result.originalUrl,
            localPath: result.originalPath,
            tinyThumbUrl: result.tinyUrl,
            avgColorHex: result.avgColorHex,
            imageAsset: {
              preview: result.previewUrl,
              tiny: result.tinyUrl,
              original: result.originalUrl,
              ghost: result.ghostBase64,
              avgColorHex: result.avgColorHex,
              width: result.width,
              height: result.height,
            },
          },
        });
      } catch (err) {
        console.error('[ImageNode] 全景截图失败:', err);
        showAlert(imgc.panorama360CaptureFailed);
      }
    },
    [
      projectId,
      showAlert,
      imgc.panorama360NeedProject,
      imgc.panorama360CaptureFailed,
      imgc.panorama360CaptureNodeLabel,
      computeAdaptiveNodeSize,
      spawnLinkedImageModule,
      panorama360Active,
      togglePanorama360Mode,
      data?.panorama360BaseWidth,
      data?.panorama360BaseHeight,
    ],
  );

  const flipHUi = !!data?.flipH;
  const flipVUi = !!data?.flipV;

  const applyFlipToPreview = useCallback(() => {
    const el = imgContainerRef.current;
    if (!el) return;
    const { h, v } = flipLiveRef.current;
    el.style.transform = h || v ? `scale(${h ? -1 : 1}, ${v ? -1 : 1})` : '';
  }, []);

  useEffect(() => {
    flipLiveRef.current = { h: !!data?.flipH, v: !!data?.flipV };
    if (panorama360Active) {
      const el = imgContainerRef.current;
      if (el) el.style.transform = '';
      return;
    }
    applyFlipToPreview();
  }, [data?.flipH, data?.flipV, panorama360Active, applyFlipToPreview]);

  useLayoutEffect(() => {
    if (panorama360Active) {
      const el = imgContainerRef.current;
      if (el) el.style.transform = '';
      return;
    }
    applyFlipToPreview();
  }, [primaryOutputImage, panorama360Active, applyFlipToPreview]);

  /** 内联裁剪时临时取消镜像，避免选框坐标与源图不一致 */
  useEffect(() => {
    if (!showCropModal) {
      applyFlipToPreview();
      return;
    }
    const el = imgContainerRef.current;
    if (el) el.style.transform = '';
  }, [showCropModal, applyFlipToPreview]);

  /** 裁剪期间保持节点在最上层（避免 RF 选中其它节点后压住选框） */
  useEffect(() => {
    if (!showCropModal) return;
    elevateCropNodeLayer(true);
  }, [showCropModal, elevateCropNodeLayer]);

  const persistFlip = useCallback(
    (patch: { flipH?: boolean; flipV?: boolean }) => {
      startTransition(() => {
        updateNodeData(patch);
      });
    },
    [updateNodeData],
  );

  const toggleFlipH = useCallback(() => {
    const nextH = !flipLiveRef.current.h;
    flipLiveRef.current = { h: nextH, v: flipLiveRef.current.v };
    applyFlipToPreview();
    persistFlip({ flipH: nextH });
  }, [applyFlipToPreview, persistFlip]);

  const toggleFlipV = useCallback(() => {
    const nextV = !flipLiveRef.current.v;
    flipLiveRef.current = { h: flipLiveRef.current.h, v: nextV };
    applyFlipToPreview();
    persistFlip({ flipV: nextV });
  }, [applyFlipToPreview, persistFlip]);

  const openFlipMenu = useCallback(() => {
    if (flipMenuLeaveTimerRef.current != null) {
      clearTimeout(flipMenuLeaveTimerRef.current);
      flipMenuLeaveTimerRef.current = null;
    }
    setFlipMenuHover(true);
  }, []);

  const scheduleCloseFlipMenu = useCallback(() => {
    if (flipMenuLeaveTimerRef.current != null) clearTimeout(flipMenuLeaveTimerRef.current);
    flipMenuLeaveTimerRef.current = setTimeout(() => {
      flipMenuLeaveTimerRef.current = null;
      setFlipMenuHover(false);
    }, 180);
  }, []);

  const openSplitMenu = useCallback(() => {
    if (splitMenuLeaveTimerRef.current != null) {
      clearTimeout(splitMenuLeaveTimerRef.current);
      splitMenuLeaveTimerRef.current = null;
    }
    setSplitGridMenuHover(true);
  }, []);

  const applyCustomSplitGrid = useCallback(
    (e?: React.SyntheticEvent) => {
      const cols = parseInt(customSplitCols, 10);
      const rows = parseInt(customSplitRows, 10);
      if (
        !Number.isFinite(cols) ||
        !Number.isFinite(rows) ||
        cols < 1 ||
        rows < 1 ||
        cols > GRID_SPLIT_MAX_AXIS ||
        rows > GRID_SPLIT_MAX_AXIS ||
        cols * rows > GRID_SPLIT_MAX_CELLS
      ) {
        showAlert(imgc.splitGridCustomInvalid);
        return;
      }
      setSplitGridMenuHover(false);
      void handleSplitGridToCanvas({ cols, rows }, e);
    },
    [customSplitCols, customSplitRows, handleSplitGridToCanvas, imgc.splitGridCustomInvalid, showAlert],
  );

  const scheduleCloseSplitMenu = useCallback(() => {
    if (splitMenuLeaveTimerRef.current != null) clearTimeout(splitMenuLeaveTimerRef.current);
    splitMenuLeaveTimerRef.current = setTimeout(() => {
      splitMenuLeaveTimerRef.current = null;
      setSplitGridMenuHover(false);
    }, 180);
  }, []);

  const topToolbarIconBtn = useCallback(
    (_scratch: ScratchColorId = 'looks', active = false, extra = '') => {
      const base =
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-[background-color,color,transform,opacity] duration-150 ease-out will-change-transform active:scale-[0.94] disabled:opacity-35 disabled:active:scale-100';
      if (isDarkMode) {
        return `${base} ${
          active ? 'bg-white/15 text-white' : 'bg-transparent text-white/80 hover:bg-white/10 hover:text-white'
        } ${extra}`.trim();
      }
      return `${base} ${
        active ? 'bg-black/10 text-gray-900' : 'bg-transparent text-gray-700 hover:bg-black/[0.06] hover:text-gray-900'
      } ${extra}`.trim();
    },
    [isDarkMode],
  );

  const toolbarDivider = (
    <span
      className={`mx-0.5 h-4 w-px shrink-0 ${isDarkMode ? 'bg-white/20' : 'bg-black/15'}`}
      aria-hidden
    />
  );

  const openImagePreview = useCallback(() => {
    const previewSrc = getImageDisplaySrc(
      formatImagePath(previewImagePath || primaryOutputImage || tinyImagePath),
    );
    if (!previewSrc) return;
    if (onPreviewImage) {
      onPreviewImage(previewSrc, id);
      return;
    }
    window.open(previewSrc, '_blank', 'noopener,noreferrer');
  }, [previewImagePath, primaryOutputImage, tinyImagePath, onPreviewImage, id]);

  inspectZoomRef.current = inspectZoom;

  useEffect(() => {
    setInspectZoom(1);
    setInspectPan({ x: 0, y: 0 });
    inspectPanDragRef.current = null;
  }, [primaryOutputImage]);

  const handleInspectWheel = useCallback((e: React.WheelEvent) => {
    if (!selected || isPanorama360Mode || showCropModal || outputImages.length > 1) return;
    /** 与画布滚轮缩放区分：Ctrl/Meta+滚轮检视模块内细节 */
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setInspectZoom((z) => {
      const next = Math.min(6, Math.max(1, z * factor));
      if (next <= 1.001) {
        setInspectPan({ x: 0, y: 0 });
        return 1;
      }
      return next;
    });
  }, [selected, isPanorama360Mode, showCropModal, outputImages.length]);

  const handleInspectPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (inspectZoomRef.current <= 1.01) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      inspectPanDragRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        originX: inspectPan.x,
        originY: inspectPan.y,
      };
    },
    [inspectPan.x, inspectPan.y],
  );

  const handleInspectPointerMove = useCallback((e: React.PointerEvent) => {
    const d = inspectPanDragRef.current;
    if (!d?.active) return;
    e.stopPropagation();
    setInspectPan({
      x: d.originX + (e.clientX - d.startX),
      y: d.originY + (e.clientY - d.startY),
    });
  }, []);

  const handleInspectPointerUp = useCallback((e: React.PointerEvent) => {
    if (!inspectPanDragRef.current?.active) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    inspectPanDragRef.current = null;
  }, []);

  const selectedAtPointerDownRef = useRef(false);

  const handleOutputImagePointerDown = useCallback(() => {
    if (inspectZoomRef.current > 1.01) return;
    selectedAtPointerDownRef.current = selected;
    beginNativeDragPrepare();
  }, [selected, beginNativeDragPrepare]);

  const handleOutputImageDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!selectedAtPointerDownRef.current || !selected || outputImages.length > 1) return;
      if (showCropModal) return;
      e.stopPropagation();
      e.preventDefault();
      openImagePreview();
    },
    [selected, outputImages.length, openImagePreview, showCropModal],
  );

  useEffect(() => {
    if (!selected || !primaryOutputImage || outputImages.length > 1) return;
    if (showCropModal || showAllOutputImages) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if ((window as Window & { __nexflowVoiceModalOpen?: boolean }).__nexflowVoiceModalOpen) return;
      e.preventDefault();
      e.stopPropagation();
      openImagePreview();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected, primaryOutputImage, outputImages.length, openImagePreview, showCropModal, showAllOutputImages]);

  const cropSourceUrl = useMemo(() => {
    const raw = previewImagePath || primaryOutputImage || tinyImagePath;
    if (!raw) return '';
    return getImageDisplaySrc(formatImagePath(raw));
  }, [previewImagePath, primaryOutputImage, tinyImagePath]);

  const handleCropConfirm = useCallback(
    async (rect: NormalizedCropRect) => {
      if (!cropSourceUrl) return;
      if (!window.electronAPI?.createImageLocalResourceFromBuffer) {
        showAlert(imgc.cropFailed);
        return;
      }
      if (cropBusy) return;

      // 与视频画面裁剪一致：原模块不动，确认后导出到右侧新模块
      const sizeFallback = cropSizeBackupRef.current ?? { w: size.w, h: size.h };
      closeCropSession();
      setCropBusy(true);
      try {
        const { buffer, width, height } = await cropImageToPngBuffer(cropSourceUrl, rect);
        const result = await window.electronAPI.createImageLocalResourceFromBuffer(
          projectId,
          `crop-${Date.now()}.png`,
          buffer,
        );
        if (!result?.previewUrl) throw new Error('预览图路径为空');

        const outW = Number(result.width) || width;
        const outH = Number(result.height) || height;
        const adapted =
          outW > 0 && outH > 0
            ? computeAdaptiveNodeSize(outW, outH)
            : { w: sizeFallback.w, h: sizeFallback.h };

        const newId = spawnLinkedImageModule({
          label: imgc.cropNodeLabel,
          inputImageUrl: result.previewUrl,
          outputImageUrl: result.previewUrl,
          /** 始终贴主模块右侧 1cm，不因右侧已有模块而右移避让 */
          pinToSourceRight: true,
          sourceBoxOverride: sizeFallback,
          nodeSize: adapted,
          extraData: {
            originalImageUrl: result.originalUrl,
            localPath: result.originalPath,
            tinyThumbUrl: result.tinyUrl,
            avgColorHex: result.avgColorHex,
            flipH: false,
            flipV: false,
            imageAsset: {
              preview: result.previewUrl,
              tiny: result.tinyUrl,
              original: result.originalUrl,
              ghost: result.ghostBase64,
              avgColorHex: result.avgColorHex,
              width: result.width,
              height: result.height,
            },
          },
        });
        if (!newId) throw new Error('spawn failed');
      } catch (err) {
        console.error('[ImageNode] 裁剪失败:', err);
        showAlert(imgc.cropFailed);
      } finally {
        setCropBusy(false);
      }
    },
    [
      cropSourceUrl,
      cropBusy,
      closeCropSession,
      projectId,
      computeAdaptiveNodeSize,
      spawnLinkedImageModule,
      showAlert,
      imgc.cropFailed,
      imgc.cropNodeLabel,
      size.w,
      size.h,
    ],
  );

  useEffect(
    () => () => {
      if (flipMenuLeaveTimerRef.current != null) clearTimeout(flipMenuLeaveTimerRef.current);
      if (splitMenuLeaveTimerRef.current != null) clearTimeout(splitMenuLeaveTimerRef.current);
    },
    [],
  );
  const resolvedAvgColor = data?.imageAsset?.avgColorHex || data?.avgColorHex || '';
  const hasAvgColor = !!resolvedAvgColor;
  const skeletonColor = resolvedAvgColor || '#6b7280';
  const isUserResized = Boolean((data as any)?.isUserResized);

  const applyLayoutFromMediaPixels = useCallback(
    (naturalW: number, naturalH: number, srcKey: string) => {
      if (!naturalW || !naturalH || naturalW <= 0 || naturalH <= 0) return;
      if (showCropModal) return;
      if (data?.preserveExportLayout && data?.width && data?.height) return;
      if (panorama360Active || data?.viewMode === 'panorama360') return;
      if (isUserResized) return;
      const adapted = computeAdaptiveNodeSize(naturalW, naturalH);
      const lastApplied = lastAppliedSizeRef.current;
      if (
        lastApplied &&
        lastApplied.srcKey === srcKey &&
        lastApplied.w === adapted.w &&
        lastApplied.h === adapted.h
      ) {
        return;
      }
      lastAppliedSizeRef.current = { srcKey, w: adapted.w, h: adapted.h };
      lastOnLoadSrcRef.current = srcKey;
      setSize((prev) => (prev.w === adapted.w && prev.h === adapted.h ? prev : adapted));
      const aspectRatio = aspectRatioLabelFromPixelSize(naturalW, naturalH);
      const styleDims = nodeStyleDimensions(adapted.w, adapted.h);
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  width: adapted.w,
                  height: adapted.h,
                  aspectRatio,
                  isUserResized: false,
                  imageAsset: {
                    ...((node.data?.imageAsset as object) || {}),
                    width: naturalW,
                    height: naturalH,
                  },
                },
                style: { ...(node.style as object), ...styleDims },
              }
            : node,
        ),
      );
      if (onDataChange) {
        onDataChange(id, { width: adapted.w, height: adapted.h });
      }
    },
    [
      computeAdaptiveNodeSize,
      data?.preserveExportLayout,
      data?.width,
      data?.height,
      data?.viewMode,
      panorama360Active,
      showCropModal,
      id,
      isUserResized,
      onDataChange,
      setNodes,
    ],
  );

  const mediaLayoutProbeKey = useMemo(() => {
    const first = outputImages[0] || outputImage || primaryOutputImage || '';
    return `${outputImages.length}:${formatImagePath(first)}`;
  }, [outputImages, outputImage, primaryOutputImage]);

  useEffect(() => {
    if (!mediaLayoutProbeKey || mediaLayoutProbeKey.endsWith(':')) return;
    if (data?.preserveExportLayout && data?.width && data?.height) return;
    if (panorama360Active || data?.viewMode === 'panorama360') return;
    if (isUserResized) return;

    const rawPath = outputImages[0] || outputImage || primaryOutputImage || '';
    if (!rawPath.trim()) return;

    const formattedPath = formatImagePath(rawPath);
    const asset = data?.imageAsset as { width?: number; height?: number; preview?: string; original?: string } | undefined;
    const aw = Number(asset?.width);
    const ah = Number(asset?.height);
    const assetUrlMatches =
      !!asset &&
      (formatImagePath(String(asset.preview || '')) === formattedPath ||
        formatImagePath(String(asset.original || '')) === formattedPath ||
        formatImagePath(String(data?.outputImage || '')) === formattedPath);
    if (aw > 0 && ah > 0 && assetUrlMatches) {
      applyLayoutFromMediaPixels(aw, ah, mediaLayoutProbeKey);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const displaySrc = await resolveImageSrcForElectronDisplay(rawPath, projectId);
        const px = await probeImagePixelSize(displaySrc);
        if (!cancelled && px.width > 0 && px.height > 0) {
          applyLayoutFromMediaPixels(px.width, px.height, mediaLayoutProbeKey);
        }
      } catch {
        try {
          const px = await probeImagePixelSize(formattedPath);
          if (!cancelled && px.width > 0 && px.height > 0) {
            applyLayoutFromMediaPixels(px.width, px.height, mediaLayoutProbeKey);
          }
        } catch {
          /* 探测失败时保留当前外框 */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    applyLayoutFromMediaPixels,
    data?.imageAsset,
    data?.outputImage,
    data?.preserveExportLayout,
    data?.width,
    data?.height,
    isUserResized,
    mediaLayoutProbeKey,
    outputImage,
    outputImages,
    primaryOutputImage,
    projectId,
  ]);

  const isInViewportRef = useRef(true);
  const hasMultiOutputImagesForViewport = outputImages.length > 1;
  const hasImageOutputForViewport = !!(primaryOutputImage || outputImages.length > 0);
  const isInViewport = useMemo(() => {
    if (
      TAPNOW_INTERACTION_SUSPEND &&
      isVisualInteractionLocked &&
      !hasImageOutputForViewport
    ) {
      return isInViewportRef.current;
    }
    const left = -vx / zoom - VIEWPORT_PADDING / zoom;
    const top = -vy / zoom - VIEWPORT_PADDING / zoom;
    const right = -vx / zoom + (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom + VIEWPORT_PADDING / zoom;
    const bottom = -vy / zoom + (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom + VIEWPORT_PADDING / zoom;
    const result = !((xPos + size.w) < left || xPos > right || (yPos + size.h) < top || yPos > bottom);
    isInViewportRef.current = result;
    return result;
  }, [vx, vy, zoom, xPos, yPos, size.w, size.h, isVisualInteractionLocked, hasImageOutputForViewport]);
  const isInPrefetchAreaRef = useRef(true);
  const isInPrefetchArea = useMemo(() => {
    if (
      TAPNOW_INTERACTION_SUSPEND &&
      isVisualInteractionLocked &&
      !hasImageOutputForViewport
    ) {
      return isInPrefetchAreaRef.current;
    }
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const left = -vx / zoom;
    const top = -vy / zoom;
    const right = left + viewportWidth;
    const bottom = top + viewportHeight;
    const intersectsViewport = !((xPos + size.w) < left || xPos > right || (yPos + size.h) < top || yPos > bottom);
    if (intersectsViewport) {
      isInPrefetchAreaRef.current = true;
      return true;
    }

    const centerX = left + viewportWidth / 2;
    const centerY = top + viewportHeight / 2;
    const nodeCenterX = xPos + size.w / 2;
    const nodeCenterY = yPos + size.h / 2;
    const toNodeX = nodeCenterX - centerX;
    const toNodeY = nodeCenterY - centerY;
    const distance = Math.hypot(toNodeX, toNodeY);
    const radius = Math.hypot(viewportWidth, viewportHeight) * (0.5 + effectivePrefetchScreenFactor);

    const moveX = -lockedVelocity.x;
    const moveY = -lockedVelocity.y;
    const moveLen = Math.hypot(moveX, moveY);
    if (moveLen < 60) {
      const padX = viewportWidth * effectivePrefetchScreenFactor;
      const padY = viewportHeight * effectivePrefetchScreenFactor;
      return !((xPos + size.w) < (left - padX) || xPos > (right + padX) || (yPos + size.h) < (top - padY) || yPos > (bottom + padY));
    }
    const toNodeLen = Math.max(distance, 1);
    const cos = (toNodeX * moveX + toNodeY * moveY) / (toNodeLen * moveLen);
    const result = cos >= PREFETCH_SECTOR_COS && distance <= radius;
    isInPrefetchAreaRef.current = result;
    return result;
  }, [vx, vy, zoom, xPos, yPos, size.w, size.h, lockedVelocity, effectivePrefetchScreenFactor, isVisualInteractionLocked, hasImageOutputForViewport]);
  const isHardFrozenRef = useRef(false);
  const isHardFrozen = useMemo(() => {
    if (!performanceMode || selected || dragging || isResizing) return false;
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = xPos + size.w;
    const nodeBottom = yPos + size.h;
    const intersects = !(nodeRight < viewportLeft || xPos > viewportRight || nodeBottom < viewportTop || yPos > viewportBottom);
    // 视口内节点永不冻结，优先于 lock 缓存
    if (intersects) {
      isHardFrozenRef.current = false;
      return false;
    }
    if (TAPNOW_INTERACTION_SUSPEND && isVisualInteractionLocked) return isHardFrozenRef.current;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (xPos > viewportRight ? xPos - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (yPos > viewportBottom ? yPos - viewportBottom : 0);
    const result = distX > viewportWidth * 2 || distY > viewportHeight * 2;
    isHardFrozenRef.current = result;
    return result;
  }, [performanceMode, selected, dragging, isResizing, vx, vy, zoom, xPos, yPos, size.w, size.h, isVisualInteractionLocked]);
  useEffect(() => {
    if (TAPNOW_INTERACTION_SUSPEND && isVisualInteractionLocked) return; /* [Tapnow] 交互期间冻结速度计算 */
    const now = Date.now();
    const prev = velocitySampleRef.current;
    velocitySampleRef.current = { x: vx, y: vy, t: now };
    if (!prev) return;
    const dt = Math.max(now - prev.t, 1);
    const dx = vx - prev.x;
    const dy = vy - prev.y;
    const speed = Math.hypot(dx, dy) / (dt / 1000);
    const nextFast = speed > FAST_MOVE_SPEED_THRESHOLD;
    setIsFastMoving((curr) => (curr === nextFast ? curr : nextFast));
  }, [vx, vy, isVisualInteractionLocked]);

  useEffect(() => {
    if (TAPNOW_INTERACTION_SUSPEND && isVisualInteractionLocked) return; /* [Tapnow] 交互期间冻结 velocity 订阅 */
    if (directionLockTimerRef.current) clearTimeout(directionLockTimerRef.current);
    directionLockTimerRef.current = setTimeout(() => {
      setLockedVelocity({ x: velocityX, y: velocityY });
    }, PREFETCH_DIRECTION_LOCK_MS);
    return () => {
      if (directionLockTimerRef.current) clearTimeout(directionLockTimerRef.current);
    };
  }, [velocityX, velocityY, isVisualInteractionLocked]);

  useEffect(() => {
    const viewportLeft = -vx / zoom;
    const viewportTop = -vy / zoom;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;
    const nodeRight = xPos + size.w;
    const nodeBottom = yPos + size.h;
    const intersects = !(nodeRight < viewportLeft || xPos > viewportRight || nodeBottom < viewportTop || yPos > viewportBottom);
    if (intersects) {
      culledStateRef.current = false;
      setIsCulledByViewport(false);
      return;
    }
    if (isVisualInteractionLocked) return;
    const distX = nodeRight < viewportLeft ? (viewportLeft - nodeRight) : (xPos > viewportRight ? xPos - viewportRight : 0);
    const distY = nodeBottom < viewportTop ? (viewportTop - nodeBottom) : (yPos > viewportBottom ? yPos - viewportBottom : 0);
    const unloadThresholdX = viewportWidth * 2.5;
    const unloadThresholdY = viewportHeight * 2.5;
    const reloadThresholdX = viewportWidth * 1.5;
    const reloadThresholdY = viewportHeight * 1.5;
    if (!culledStateRef.current) {
      if (distX > unloadThresholdX || distY > unloadThresholdY) {
        culledStateRef.current = true;
        setIsCulledByViewport(true);
      } else {
        setIsCulledByViewport(false);
      }
      return;
    }
    if (distX <= reloadThresholdX && distY <= reloadThresholdY) {
      culledStateRef.current = false;
      setIsCulledByViewport(false);
    } else {
      setIsCulledByViewport(true);
    }
  }, [isVisualInteractionLocked, vx, vy, zoom, xPos, yPos, size.w, size.h]);
  /** 多图宫格每张独立 <img>，平移/预取时不应被单图 LOD 占位盖住或整节点 visibility:hidden */
  const hasMultiOutputImages = hasMultiOutputImagesForViewport;
  // 进入预取区后继续保留图像层（虚拟隐藏而非卸载），避免“刚出屏回拖就刷新”的视觉断层。
  const shouldRenderImage =
    !isHardFrozen &&
    (!isCulledByViewport || isInPrefetchArea) &&
    (lodLevel !== 'far' || isInPrefetchArea) &&
    (selected || dragging || isResizing || isInViewport || isInPrefetchArea || !!currentImageSrc);
  const shouldShowOutputLayer = shouldRenderImage || hasMultiOutputImages;
  const isInteractionVisualLock = isVisualInteractionLocked;
  const [showFarPlaceholder, setShowFarPlaceholder] = useState<boolean>(zoom < ZOOM_THRESHOLD_ICON_ONLY);
  useEffect(() => {
    setShowFarPlaceholder((prev) => {
      if (prev) {
        return zoom < ZOOM_THRESHOLD_ICON_ONLY + FAR_PLACEHOLDER_HYSTERESIS;
      }
      return zoom < ZOOM_THRESHOLD_ICON_ONLY - FAR_PLACEHOLDER_HYSTERESIS;
    });
  }, [zoom]);
  const keepImageLayerDuringInteraction =
    isInteractionVisualLock && (!!currentImageSrc || hasMultiOutputImages);
  // 已加载图像时尽量保持显示，避免 showFarPlaceholder 导致缩放时刷新
  const keepImageWhenLoaded = !!currentImageSrc && isImageLoaded;
  const showPlaceholder =
    !hasMultiOutputImages &&
    (isResizing ||
      isHardFrozen ||
      isCulledByViewport ||
      (showFarPlaceholder && !keepImageWhenLoaded) ||
      (isFpsProtected && !isInViewport) ||
      (perfLevel >= 3 && !isInViewport)) &&
    !keepImageLayerDuringInteraction;
  const hasRenderableImage = !!primaryOutputImage && !showPlaceholder;
  const isPrefetchOnly = isInPrefetchArea && !isInViewport;
  /** 预取区隐藏整节点会导致「只剩连线、图消失」；多图与画布平移期间必须保持可见 */
  const shouldHideNodeForPrefetch = isPrefetchOnly && !primaryOutputImage;
  const hideImageLayerInPrefetch =
    !hasMultiOutputImages &&
    !isInteractionVisualLock &&
    (!isImageVisible || (isFpsProtected && !isInViewport)) &&
    isInPrefetchArea;
  const shouldUseFocusTransition = !isInteractionVisualLock && !isFastMoving && !isFpsProtected;

  useEffect(() => {
    if (!import.meta.env.DEV || !selected) return;
    const now = Date.now();
    if (now - prefetchDebugAtRef.current < 600) return;
    prefetchDebugAtRef.current = now;
    const viewportWidth = (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const viewportHeight = (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const viewportCenterX = -vx / zoom + viewportWidth / 2;
    const viewportCenterY = -vy / zoom + viewportHeight / 2;
    const nodeCenterX = xPos + size.w / 2;
    const nodeCenterY = yPos + size.h / 2;
    const screenDistance = Math.hypot(nodeCenterX - viewportCenterX, nodeCenterY - viewportCenterY) / Math.hypot(viewportWidth, viewportHeight);
    console.debug('[ImageNode][prefetch-debug]', {
      id,
      zoom: Number(zoom.toFixed(3)),
      prefetchScreenFactor: Number(effectivePrefetchScreenFactor.toFixed(2)),
      screenDistance: Number(screenDistance.toFixed(3)),
      inViewport: isInViewport,
      inPrefetchArea: isInPrefetchArea,
    });
  }, [selected, id, zoom, effectivePrefetchScreenFactor, isInViewport, isInPrefetchArea, vx, vy, xPos, yPos, size.w, size.h]);

  useEffect(() => {
    // 快速缩放/平移期间只取消 reveal 定时器，不强制隐藏当前图层，避免闪屏。
    if (!isInteractionVisualLock || !isViewportMoving) return;
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }, [isInteractionVisualLock, isViewportMoving]);


  const startCrossFadeTo = useCallback((nextSrc: string) => {
    if (!nextSrc) return;
    if (isInteractionVisualLock) return;
    if (nextSrc === currentImageSrcRef.current) return;
    if (crossFadeTimerRef.current) {
      clearTimeout(crossFadeTimerRef.current);
      crossFadeTimerRef.current = null;
    }
    setBufferImageSrc(nextSrc);
    bufferImageSrcRef.current = nextSrc;
    setIsBufferVisible(true);
    crossFadeTimerRef.current = setTimeout(() => {
      setCurrentImageSrc(nextSrc);
      currentImageSrcRef.current = nextSrc;
      setBufferImageSrc('');
      bufferImageSrcRef.current = '';
      setIsBufferVisible(false);
      setIsImageLoaded(true);
      setIsImageVisible(true);
      crossFadeTimerRef.current = null;
    }, CROSS_FADE_MS);
  }, [isInteractionVisualLock]);

  useEffect(() => {
    pathLoadAbortRef.current?.abort();
    pathLoadAbortRef.current = new AbortController();
    return () => {
      pathLoadAbortRef.current?.abort();
    };
  }, [previewImagePath, primaryOutputImage, projectId]);

  useEffect(() => {
    if (outputImages.length < 2) {
      multiGridPreviewCacheRef.current = null;
      setMultiGridPreviewSrc('');
      return;
    }
    const key = `${outputImages.join('\u0001')}|${Math.round(size.w)}|${Math.round(size.h)}`;
    const cached = multiGridPreviewCacheRef.current;
    if (cached?.key === key) {
      setMultiGridPreviewSrc((prev) => (prev === cached.src ? prev : cached.src));
      return;
    }
    const buildGen = ++multiGridBuildGenRef.current;
    const frameW = size.w;
    const frameH = size.h;
    let cancelled = false;
    void (async () => {
      try {
        const dataUrl = await buildMultiImageGridPreviewDataUrl(
          outputImages,
          (u) => resolveImageSrcForElectronDisplay(formatImagePath(u), projectId),
          { frameWidth: frameW, frameHeight: frameH },
        );
        if (cancelled || buildGen !== multiGridBuildGenRef.current) return;
        multiGridPreviewCacheRef.current = { key, src: dataUrl };
        setMultiGridPreviewSrc(dataUrl);
      } catch (err) {
        if (cancelled) return;
        console.warn('[ImageNode] 多图合并预览失败，平移时将沿用宫格:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outputImages, projectId, size.w, size.h]);

  useEffect(() => {
    if (outputImages.length <= 9) {
      expandAllMergePreviewCacheRef.current = null;
      setExpandAllMergePreviewSrc('');
      return;
    }
    const { frameWidth, frameHeight } = expandAllGridFrame;
    const key = `expand|${outputImages.join('\u0001')}|${frameWidth}|${frameHeight}`;
    const cached = expandAllMergePreviewCacheRef.current;
    if (cached?.key === key) {
      setExpandAllMergePreviewSrc((prev) => (prev === cached.src ? prev : cached.src));
      return;
    }
    const buildGen = ++expandAllMergeBuildGenRef.current;
    let cancelled = false;
    void (async () => {
      try {
        const dataUrl = await buildMultiImageGridPreviewDataUrl(
          outputImages,
          (u) => resolveImageSrcForElectronDisplay(formatImagePath(u), projectId),
          {
            frameWidth,
            frameHeight,
            padPx: EXPAND_ALL_GRID_PAD_PX,
            gapPx: EXPAND_ALL_GRID_GAP_PX,
            layoutMode: 'all',
          },
        );
        if (cancelled || buildGen !== expandAllMergeBuildGenRef.current) return;
        expandAllMergePreviewCacheRef.current = { key, src: dataUrl };
        setExpandAllMergePreviewSrc(dataUrl);
      } catch (err) {
        if (cancelled) return;
        console.warn('[ImageNode] 展开全部合并预览失败:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outputImages, projectId, expandAllGridFrame]);

  const measureExpandAllGridFrame = useCallback(() => {
    const grid = expandAllGridInnerRef.current;
    if (!grid) return null;
    const w = grid.offsetWidth;
    const h = grid.offsetHeight;
    if (w < 8 || h < 8) return null;
    return { frameWidth: Math.round(w), frameHeight: Math.round(h) };
  }, []);

  useEffect(() => {
    if (!showAllOutputImages || outputImages.length <= 9) {
      expandAllGridFrameLockedRef.current = null;
      return;
    }
    setExpandAllGridFrame(estimateExpandAllGridFrameSize(outputImages.length));
    const sync = () => {
      if (getGlobalInteractionSnapshot().isGlobalInteracting || getGlobalInteractionSnapshot().isVisualInteractionLocked) {
        return;
      }
      const measured = measureExpandAllGridFrame();
      if (!measured) return;
      expandAllGridFrameLockedRef.current = measured;
      setExpandAllGridFrame((prev) =>
        prev.frameWidth === measured.frameWidth && prev.frameHeight === measured.frameHeight ? prev : measured,
      );
    };
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(sync);
    });
    const el = expandAllGridInnerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return () => cancelAnimationFrame(raf);
    }
    const ro = new ResizeObserver(() => sync());
    ro.observe(el);
    sync();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [showAllOutputImages, outputImages.length, measureExpandAllGridFrame]);

  useEffect(() => {
    if (!showExpandAllMergeWhileMoving) return;
    const measured = measureExpandAllGridFrame();
    if (measured) expandAllGridFrameLockedRef.current = measured;
  }, [showExpandAllMergeWhileMoving, measureExpandAllGridFrame]);

  // 依赖项刻意不含 vx/vy/zoom/lockedVelocity 与 currentImageSrc/isImageLoaded/isImageVisible；
  // 解码 Abort 仅绑定到「路径/项目」effect（pathLoadAbortRef），避免视口变化反复 cancel 队列。
  useEffect(() => {
    // 视口外时保留已加载状态，不清理，缩放回来时无需重新加载
    if (isCulledByViewport && !isInteractionVisualLock) return;
    // 始终优先 preview；再兜底 primaryOutputImage，避免仅 tiny 与旧 asset 组合时漏掉 data: 截帧
    const primaryPath = previewImagePath || primaryOutputImage || tinyImagePath;
    if (!primaryPath) {
      setCurrentImageSrc('');
      currentImageSrcRef.current = '';
      setBufferImageSrc('');
      bufferImageSrcRef.current = '';
      setIsBufferVisible(false);
      setIsImageLoaded(false);
      setIsImageVisible(false);
      return;
    }
    if (!isInViewport && (isInteractionVisualLock || isFpsProtected || perfLevel >= 1)) {
      // 拖拽期/FPS 保护期暂停视口外预取，优先保障画布变换帧率
      return;
    }
    if (perfLevel >= 3 && !isInViewport) {
      return;
    }
    if (isInteractionVisualLock && currentImageSrcRef.current) {
      if (!isImageVisible) setIsImageVisible(true);
      return;
    }
    let cancelled = false;
    const pathSig = pathLoadAbortRef.current?.signal;
    const queueOpts =
      pathSig && !pathSig.aborted ? ({ signal: pathSig, dedupe: true } as const) : ({ dedupe: true } as const);
    const viewportCenterX = -vx / zoom + (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom / 2;
    const viewportCenterY = -vy / zoom + (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom / 2;
    const nodeCenterX = xPos + size.w / 2;
    const nodeCenterY = yPos + size.h / 2;
    const distance = Math.hypot(nodeCenterX - viewportCenterX, nodeCenterY - viewportCenterY);
    const toNodeX = nodeCenterX - viewportCenterX;
    const toNodeY = nodeCenterY - viewportCenterY;
    const velocityLen = Math.hypot(lockedVelocity.x, lockedVelocity.y);
    const toNodeLen = Math.max(Math.hypot(toNodeX, toNodeY), 1);
    const aheadCos = velocityLen > 1 ? ((toNodeX * -lockedVelocity.x + toNodeY * -lockedVelocity.y) / (toNodeLen * velocityLen)) : 0;
    const directionalBias = Math.max(0, aheadCos) * 1500;
    const priority = calcViewportPriority(distance, isInPrefetchArea, directionalBias);

    void (async () => {
      const formattedImmediate = formatImagePath(primaryPath);
      const localInstant = isLocalDiskMediaUrl(formattedImmediate);
      if (localInstant && formattedImmediate) {
        if (formattedImmediate !== currentImageSrcRef.current) {
          setCurrentImageSrc(formattedImmediate);
          currentImageSrcRef.current = formattedImmediate;
        }
        setIsImageLoaded(true);
        setIsImageVisible(true);
        markImageLoadedInSession(formattedImmediate);
      }

      const primarySrc = await resolveImageSrcForElectronDisplay(primaryPath, projectId);
      const previewSrc = previewImagePath ? await resolveImageSrcForElectronDisplay(previewImagePath, projectId) : '';
      if (cancelled) return;
      const src = primarySrc;
      if (localInstant) {
        if (src && src !== currentImageSrcRef.current) {
          setCurrentImageSrc(src);
          currentImageSrcRef.current = src;
          markImageLoadedInSession(src);
        }
        setIsImageLoaded(true);
        setIsImageVisible(true);
        return;
      }
      const sameSrc = src === currentImageSrcRef.current;
      if (sameSrc && (isImageLoadedRef.current || isImageLoadedInSession(src))) {
        if (!isImageLoadedRef.current) setIsImageLoaded(true);
        if (!isImageVisible) setIsImageVisible(true);
        return;
      }
      if (isImageLoadedInSession(src)) {
        if (isInteractionVisualLock) {
          if (src !== bufferImageSrcRef.current) {
            setBufferImageSrc(src);
            bufferImageSrcRef.current = src;
          }
        } else {
          startCrossFadeTo(src);
        }
        setIsImageLoaded(true);
        loadStartAtRef.current = Date.now();
        if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
        revealTimerRef.current = setTimeout(() => setIsImageVisible(true), 100);
        return;
      }
      if (!currentImageSrcRef.current) {
        setIsImageLoaded(false);
        setIsImageVisible(false);
      }
      loadStartAtRef.current = Date.now();
      enqueueImageLoad(src, priority, queueOpts)
        .then((loadedSrc) => {
          if (cancelled) return;
          markImageLoadedInSession(loadedSrc);
          if (isInteractionVisualLock) {
            setBufferImageSrc(loadedSrc);
            bufferImageSrcRef.current = loadedSrc;
          } else {
            startCrossFadeTo(loadedSrc);
          }
          if (
            previewSrc &&
            previewSrc !== loadedSrc &&
            previewImagePath.trim() !== primaryPath.trim()
          ) {
            if (isImageLoadedInSession(previewSrc)) {
              if (isInteractionVisualLock) {
                setBufferImageSrc(previewSrc);
                bufferImageSrcRef.current = previewSrc;
              } else {
                startCrossFadeTo(previewSrc);
              }
              return;
            }
            enqueueImageLoad(previewSrc, priority - 2000, queueOpts)
              .then((highSrc) => {
                if (cancelled) return;
                markImageLoadedInSession(highSrc);
                if (isInteractionVisualLock) {
                  setBufferImageSrc(highSrc);
                  bufferImageSrcRef.current = highSrc;
                } else {
                  startCrossFadeTo(highSrc);
                }
              })
              .catch(() => undefined);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          if (isAbortLikeError(err)) return;
          if (isInteractionVisualLock) {
            setBufferImageSrc(src);
            bufferImageSrcRef.current = src;
          } else {
            startCrossFadeTo(src);
          }
        });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    previewImagePath,
    primaryOutputImage,
    projectId,
    isCulledByViewport,
    xPos,
    yPos,
    size.w,
    size.h,
    isInPrefetchArea,
    isInViewport,
    isFpsProtected,
    perfLevel,
    isInteractionVisualLock,
    startCrossFadeTo,
  ]);

  useEffect(() => {
    if (isInteractionVisualLock) return;
    if (!bufferImageSrc) return;
    if (bufferImageSrc === currentImageSrc) {
      setBufferImageSrc('');
      bufferImageSrcRef.current = '';
      setIsBufferVisible(false);
      return;
    }
    if (isImageLoadedInSession(bufferImageSrc)) {
      startCrossFadeTo(bufferImageSrc);
    }
  }, [isInteractionVisualLock, bufferImageSrc, currentImageSrc, startCrossFadeTo]);

  useEffect(() => {
    return () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
      if (crossFadeTimerRef.current) {
        clearTimeout(crossFadeTimerRef.current);
        crossFadeTimerRef.current = null;
      }
      pathLoadAbortRef.current?.abort();
      currentImageSrcRef.current = '';
      bufferImageSrcRef.current = '';
      lastOnLoadSrcRef.current = '';
    };
  }, []);

  return (
    <>
      <div
        ref={nodeRef}
        data-id={id}
        style={{
          ...combinedStyle,
          overflow: 'visible',
          ...(shouldHideNodeForPrefetch ? { visibility: 'hidden', pointerEvents: 'none' as const } : {}),
        }}
        className={`custom-node-container group relative rounded-2xl overflow-visible ${
          showMultiMergeWhileMoving ? 'custom-node-container--multi-merged ' : ''
        }${
          hasRenderableImage
            ? 'p-0 bg-transparent shadow-none custom-node-container--transparent'
            : isDarkMode
              ? 'p-4 nexflow-glass-panel'
              : 'p-4 apple-panel-light' /* 使用磨砂材质浅灰半透明背板 */
        } ${isResizing ? '!shadow-none !ring-0' : ''} ${
          isPanorama360Mode || suppressSizeTransition ? '' : 'transition-all duration-200'
        }`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Handle 必须始终渲染，否则连线会断；有图片时输出 Handle 始终可见便于连接 */}
        <Handle type="target" position={Position.Left} id="image-input" style={{ top: '50%', left: 0 }} className={`nexflow-plus-handle nexflow-plus-handle-left ${showPlaceholder || is3DPopoverOpen ? 'opacity-0 pointer-events-none' : ''}`} />
        <Handle type="source" position={Position.Right} id="output" style={{ top: '50%', right: 0 }} className={`nexflow-plus-handle nexflow-plus-handle-right ${showPlaceholder || is3DPopoverOpen ? 'opacity-0 pointer-events-none' : ''}`} />
        {showPlaceholder ? (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            {ghostImage ? (
              <div
                className="absolute inset-0 rounded-2xl"
                style={{
                  backgroundImage: `url(${ghostImage})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  filter: 'blur(5px)',
                  opacity: 0.78,
                  transition: 'all 0.2s ease',
                }}
              />
            ) : hasAvgColor ? (
              <div className="absolute inset-0 rounded-2xl" style={{ backgroundColor: skeletonColor, opacity: 0.82, transition: 'all 0.2s ease' }} />
            ) : (
              <div
                className="absolute inset-0 rounded-2xl animate-pulse"
                style={{
                  background: isDarkMode
                    ? 'linear-gradient(135deg, rgba(71,85,105,0.32), rgba(100,116,139,0.42))'
                    : 'linear-gradient(135deg, rgba(148,163,184,0.22), rgba(148,163,184,0.34))',
                  transition: 'all 0.2s ease',
                }}
              />
            )}
            <div className="flex flex-col items-center justify-center gap-1">
              <ImageIcon className={`w-4 h-4 ${isDarkMode ? 'text-white/65' : 'text-gray-500'}`} />
              {showTextLabelInFar ? (
                <span className={`text-[10px] font-medium ${isDarkMode ? 'text-white/60' : 'text-gray-500'}`}>
                  {isHardFrozen ? `${title || 'image'}（冻结）` : (title || 'image')}
                </span>
              ) : null}
            </div>
          </div>
        ) : (
        <>
        {/* 模块上方标签：仅图标 + 标题 + 耗时，不对齐“打印”式状态条 */}
        {(showDetailedUi || selected || showCropModal || isPanorama360Mode) && (
          <div className="title-area absolute -top-7 left-0 right-0 z-10 flex items-center justify-between gap-2 pointer-events-none">
            <div className="flex min-w-0 items-center gap-1 pointer-events-auto">
              <ImageIcon
                className={`h-3 w-3 shrink-0 ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}
                strokeWidth={2.25}
              />
              {isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    setIsEditingTitle(false);
                    if (data?.title !== title) {
                      updateNodeData({ title });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      setIsEditingTitle(false);
                      if (data?.title !== title) {
                        updateNodeData({ title });
                      }
                    }
                    if (e.key === 'Escape') {
                      setIsEditingTitle(false);
                      setTitle(data?.title || 'image');
                    }
                  }}
                  className={`bg-transparent outline-none text-xs font-medium ${
                    isDarkMode ? 'text-white/80' : 'text-gray-900'
                  }`}
                  style={{
                    caretColor: isDarkMode ? '#0A84FF' : '#22c55e',
                    minWidth: '40px',
                    maxWidth: '160px',
                  }}
                  title={imgc.editTitle}
                  autoFocus
                />
              ) : (
                <span
                  onClick={handleTitleDoubleClick}
                  className={`cursor-pointer select-none truncate text-xs font-medium ${
                    isDarkMode ? 'text-white/75' : 'text-gray-700'
                  } hover:opacity-70 transition-opacity`}
                  title={title || 'image'}
                >
                  {displayTitleLabel}
                </span>
              )}
            </div>
            {displayElapsedSec != null && (
              <span
                className={`shrink-0 text-[10px] font-medium tabular-nums pointer-events-none ${
                  isDarkMode ? 'text-white/45' : 'text-gray-500'
                }`}
              >
                {wc.llmElapsedLabel(displayElapsedSec)}
              </span>
            )}
          </div>
        )}

        {/* 全模块覆盖进度条（生成中时纯色遮罩，不显示其他内容） */}
        <ModuleProgressBar
          visible={progress > 0}
          progress={progress}
          solidBackground={isDarkMode ? '#1C1C1E' : '#f5f5f5'}
          progressMessage={progress > 0 ? (progressMessage || wc.progressImage) : undefined}
          borderRadius={16}
          onFadeComplete={() => updateNodeData({ progress: 0 })}
        />

        {/* 抠图进度条（覆盖整个模块）；去水印在右侧新模块显示进度，不遮挡原图 */}
        <ModuleProgressBar
          visible={isMattingLoading}
          progress={0}
          solidBackground={isDarkMode ? '#1C1C1E' : '#f5f5f5'}
          progressMessage={
            isMattingLoading
              ? imgc.mattingProgress(String(mattingDisplayYuanbao))
              : undefined
          }
          borderRadius={16}
        />

        {/* 顶部统一工具栏：360 模式仅保留放大 + 绿色地球退出；平面模式为完整工具（会话期不依赖 RF selected，避免幽灵选框） */}
        {isPanorama360Mode ? (
          <div
            className={[
              'node-floating-toolbar nodrag nopan absolute bottom-[calc(100%+36px)] left-1/2 z-[80]',
              'flex w-max flex-nowrap items-center justify-center gap-0.5',
              'overflow-visible rounded-full px-2 py-1.5',
              isDarkMode
                ? 'nexflow-glass-panel border border-white/[0.14] shadow-[0_8px_28px_rgba(0,0,0,0.28)]'
                : 'apple-panel-light border border-black/[0.08] shadow-[0_8px_28px_rgba(0,0,0,0.06)]',
            ].join(' ')}
            style={{
              pointerEvents: 'all',
              transform: `translate3d(-50%, 0, 0) scale(${zoomInv})`,
              transformOrigin: 'bottom center',
              transition: 'opacity 160ms ease-out',
              willChange: 'transform',
              backfaceVisibility: 'hidden',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                void panoControlsRef.current?.toggleFullscreen();
              }}
              className={topToolbarIconBtn('looks')}
              title={locale === 'en' ? 'Enlarge / fullscreen' : '放大查看'}
              aria-label={locale === 'en' ? 'Enlarge / fullscreen' : '放大查看'}
            >
              <Maximize2 className="w-4 h-4 shrink-0" />
            </button>
            <button
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                togglePanorama360Mode();
              }}
              className={topToolbarIconBtn(
                'sensing',
                true,
                isDarkMode
                  ? '!bg-emerald-600/55 text-white ring-1 ring-emerald-400/70'
                  : '!bg-emerald-600 text-white ring-2 ring-emerald-700/30',
              )}
              title={locale === 'en' ? 'Exit 360° view' : '退出 360° 模式'}
              aria-label={locale === 'en' ? 'Exit 360° view' : '退出 360° 模式'}
              aria-pressed
            >
              <Globe className="w-4 h-4 shrink-0" />
            </button>
          </div>
        ) : null}
        {(selected || showCropModal) && !isPanorama360Mode && (
          <div
            className={[
              'node-floating-toolbar nodrag nopan absolute bottom-[calc(100%+36px)] left-1/2 z-[80]',
              'flex w-max max-w-[min(92vw,720px)] flex-nowrap items-center justify-center gap-0.5',
              'overflow-visible rounded-full px-2 py-1.5',
              isDarkMode
                ? 'nexflow-glass-panel border border-white/[0.14] shadow-[0_8px_28px_rgba(0,0,0,0.28)]'
                : 'apple-panel-light border border-black/[0.08] shadow-[0_8px_28px_rgba(0,0,0,0.06)]',
            ].join(' ')}
            style={{
              pointerEvents: 'all',
              transform: `translate3d(-50%, 0, 0) scale(${zoomInv})`,
              transformOrigin: 'bottom center',
              transition: 'opacity 160ms ease-out',
              willChange: 'transform',
              backfaceVisibility: 'hidden',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label={imgc.uploadImageTitle}
              onChange={handleFileChange}
              onClick={(e) => e.stopPropagation()}
              className="hidden"
              style={{ display: 'none' }}
            />
            {primaryOutputImage ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDownloadImage();
                }}
                className={topToolbarIconBtn('looks')}
                title={imgc.downloadTitle}
                aria-label={imgc.downloadTitle}
              >
                <Download className="w-4 h-4 shrink-0" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleUploadImage}
              className={topToolbarIconBtn('looks')}
              title={imgc.uploadImageTitle}
              aria-label={imgc.uploadImageTitle}
            >
              <Upload className="w-4 h-4 shrink-0" />
            </button>
            {primaryOutputImage ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const baseSrc = getImageDisplaySrc(formatImagePath(previewImagePath || primaryOutputImage || tinyImagePath));
                    if (!baseSrc) return;
                    const urlForBoard = baseSrc.startsWith('data:') ? baseSrc : `${baseSrc}${baseSrc.includes('?') ? '&' : '?'}_t=${Date.now()}`;
                    if (onOpenDrawingBoard) {
                      onOpenDrawingBoard(urlForBoard, id, data?.localPath);
                    } else if (onPreviewImage) {
                      onPreviewImage(baseSrc, id);
                    } else {
                      window.open(baseSrc, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  className={topToolbarIconBtn('looks')}
                  title={imgc.drawingBoardTitle}
                  aria-label={imgc.drawingBoardAria}
                >
                  <PenTool className="w-4 h-4 shrink-0" />
                </button>
                <div
                  className="relative inline-flex flex-col items-stretch nodrag nopan"
                  onMouseEnter={openFlipMenu}
                  onMouseLeave={scheduleCloseFlipMenu}
                >
                  <div
                    className={topToolbarIconBtn(
                      'variables',
                      flipHUi || flipVUi || flipMenuHover,
                      'cursor-default gap-0 !w-auto px-1.5',
                    )}
                    title={imgc.flipMenuHoverHint}
                    role="group"
                    aria-label={imgc.flipMenuHoverHint}
                  >
                    <FlipHorizontal2 className="w-4 h-4 shrink-0 opacity-90" aria-hidden />
                    <ChevronDown className="w-3 h-3 shrink-0 opacity-80" aria-hidden />
                  </div>
                  {flipMenuHover && (
                    <div
                      className="absolute left-0 top-full z-[60] min-w-[10.5rem] pt-1 nodrag nopan"
                      onMouseEnter={openFlipMenu}
                      onMouseLeave={scheduleCloseFlipMenu}
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <div
                        className={`rounded-lg border py-1 shadow-xl ${
                          isDarkMode ? 'bg-zinc-900 border-white/15 text-white/95' : 'bg-white border-gray-200 text-gray-900'
                        }`}
                      >
                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                            flipHUi
                              ? isDarkMode
                                ? 'bg-violet-500/20 text-violet-100'
                                : 'bg-violet-100 text-violet-900'
                              : isDarkMode
                                ? 'hover:bg-white/10'
                                : 'hover:bg-gray-100'
                          }`}
                          title={imgc.flipHorizontalTitle}
                          aria-label={imgc.flipHorizontalTitle}
                          aria-pressed={flipHUi}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            toggleFlipH();
                          }}
                        >
                          <FlipHorizontal2 className="w-4 h-4 shrink-0" />
                          {imgc.flipHorizontalTitle}
                        </button>
                        <button
                          type="button"
                          className={`flex w-full items-center gap-2 px-3 py-2 text-xs font-medium transition-colors ${
                            flipVUi
                              ? isDarkMode
                                ? 'bg-violet-500/20 text-violet-100'
                                : 'bg-violet-100 text-violet-900'
                              : isDarkMode
                                ? 'hover:bg-white/10'
                                : 'hover:bg-gray-100'
                          }`}
                          title={imgc.flipVerticalTitle}
                          aria-label={imgc.flipVerticalTitle}
                          aria-pressed={flipVUi}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            toggleFlipV();
                          }}
                        >
                          <FlipVertical2 className="w-4 h-4 shrink-0" />
                          {imgc.flipVerticalTitle}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {!hasMultiOutputImages && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!cropSourceUrl) return;
                      if (showCropModal) {
                        closeCropSession();
                        return;
                      }
                      openCropSession();
                    }}
                    className={topToolbarIconBtn(
                      'operators',
                      showCropModal,
                      showCropModal
                        ? isDarkMode
                          ? '!bg-emerald-500/25 ring-1 ring-emerald-400/50'
                          : 'ring-2 ring-offset-1 ring-gray-900/20'
                        : '',
                    )}
                    title={imgc.cropTitle}
                    aria-label={imgc.cropTitle}
                    aria-pressed={showCropModal}
                  >
                    <Crop className="w-4 h-4 shrink-0" />
                  </button>
                )}
                  <div
                    className="relative inline-flex flex-col items-stretch nodrag nopan"
                    onMouseEnter={openPanoramaConvertHover}
                    onMouseLeave={scheduleClosePanoramaConvertHover}
                  >
                    <button
                      type="button"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        if (!showPanorama360Entry) return;
                        togglePanorama360Mode();
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                      }}
                      className={topToolbarIconBtn(
                        'sensing',
                        isPanorama360Mode || panoramaConvertHover,
                        isPanorama360Mode || panoramaConvertHover
                          ? isDarkMode
                            ? '!bg-emerald-500/25 ring-1 ring-emerald-400/50'
                            : 'ring-2 ring-offset-1 ring-gray-900/20'
                          : '',
                      )}
                      title={
                        isPanorama360Mode
                          ? imgc.panorama360PreviewExit
                          : showPanorama360Entry
                            ? imgc.panorama360Preview
                            : imgc.panorama360Button
                      }
                      aria-label={
                        isPanorama360Mode
                          ? imgc.panorama360PreviewExit
                          : showPanorama360Entry
                            ? imgc.panorama360Preview
                            : imgc.panorama360Button
                      }
                      aria-pressed={isPanorama360Mode}
                    >
                      <Globe className="w-4 h-4 shrink-0" />
                    </button>
                    {panoramaConvertHover ? (
                      <div
                        className="absolute left-1/2 bottom-full z-[60] mb-1 -translate-x-1/2 nodrag nopan"
                        onMouseEnter={openPanoramaConvertHover}
                        onMouseLeave={scheduleClosePanoramaConvertHover}
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <div className="relative inline-flex flex-col items-center">
                          <button
                            type="button"
                            className={`inline-flex items-center whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium shadow-xl transition-colors ${
                              isDarkMode
                                ? 'bg-zinc-900 border-white/15 text-white/95 hover:bg-white/10'
                                : 'bg-white border-gray-200 text-gray-900 hover:bg-gray-100'
                            }`}
                            title={imgc.panorama360SceneConvertHint}
                            onMouseEnter={openScene360ModelMenu}
                          >
                            {imgc.panorama360Convert}
                          </button>
                          {scene360ModelMenuOpen ? (
                            <div
                              className={`absolute left-1/2 bottom-full mb-1 -translate-x-1/2 min-w-[168px] overflow-hidden rounded-lg border shadow-xl ${
                                isDarkMode
                                  ? 'bg-zinc-900 border-white/15'
                                  : 'bg-white border-gray-200 shadow-gray-900/15'
                              }`}
                              onMouseEnter={openScene360ModelMenu}
                            >
                              <div className="p-1">
                                {scene360ConvertModelOptions.map((opt) => {
                                  const priceLabel = scene360PriceLabelForModel(opt.value);
                                  const showPrice =
                                    scene360PriceHoverModel === opt.value && !!priceLabel;
                                  return (
                                    <button
                                      key={opt.value}
                                      type="button"
                                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                                        isDarkMode
                                          ? 'text-white/95 hover:bg-white/10'
                                          : 'text-gray-900 hover:bg-gray-100'
                                      }`}
                                      onMouseEnter={() => setScene360PriceHoverModel(opt.value)}
                                      onMouseLeave={() =>
                                        setScene360PriceHoverModel((prev) =>
                                          prev === opt.value ? null : prev,
                                        )
                                      }
                                      onClick={() => void runScene360ConvertWithModel(opt.value)}
                                    >
                                      <span className="truncate">{opt.label}</span>
                                      {showPrice ? (
                                        <span
                                          className={`shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                                            isDarkMode
                                              ? 'bg-amber-500/20 text-amber-200/95 border border-amber-500/35'
                                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                                          }`}
                                        >
                                          {priceLabel}
                                        </span>
                                      ) : null}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
              </>
            ) : null}

            {toolbarDivider}

            {/* 原下方工具：改为仅图标，并入顶栏 */}
            <div
              className="relative inline-flex"
              onMouseEnter={() => setMattingPriceHover(true)}
              onMouseLeave={() => setMattingPriceHover(false)}
            >
              <button
                type="button"
                disabled={isMattingLoading || isWatermarkRemovalLoading}
                onClick={async (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (isMattingLoading || isWatermarkRemovalLoading) return;
                  const resolveImageToProcess = (nodeData: ImageNodeData | undefined, outImg: string): string => {
                    return outImg
                      || (nodeData?.inputImages && nodeData.inputImages.length > 0 ? formatImagePath(nodeData.inputImages[0]) : '')
                      || (nodeData?.imageAsset?.original ? formatImagePath(nodeData.imageAsset.original) : '')
                      || (nodeData?.originalImageUrl ? formatImagePath(nodeData.originalImageUrl) : '')
                      || (nodeData?.imageAsset?.preview ? formatImagePath(nodeData.imageAsset.preview) : '');
                  };
                  let imageToProcess = resolveImageToProcess(data, primaryOutputImage);
                  if (!imageToProcess) {
                    const edges = getEdges();
                    const nodes = getNodes();
                    const incomingImageEdges = edges.filter((ed) => ed.target === id);
                    for (const edge of incomingImageEdges) {
                      const srcNode = nodes.find((n) => n.id === edge.source);
                      if (srcNode?.type === 'image' && srcNode.data) {
                        const srcOut = (srcNode.data?.outputImage as string) || (srcNode.data?.originalImageUrl as string) || '';
                        imageToProcess = resolveImageToProcess(srcNode.data as ImageNodeData, srcOut);
                        if (imageToProcess) break;
                      }
                    }
                  }
                  if (!imageToProcess) {
                    setIsMattingLoading(true);
                    setErrorMessage('');
                    for (let i = 0; i < 4; i++) {
                      await new Promise((r) => setTimeout(r, 500));
                      const freshNodes = getNodes();
                      const selfNode = freshNodes.find((n) => n.id === id);
                      const freshData = selfNode?.data as ImageNodeData | undefined;
                      const freshOut = (freshData?.outputImage as string) || (freshData?.originalImageUrl as string) || '';
                      imageToProcess = resolveImageToProcess(freshData, freshOut);
                      if (!imageToProcess) {
                        const incomingImageEdges = getEdges().filter((ed) => ed.target === id);
                        for (const edge of incomingImageEdges) {
                          const srcNode = freshNodes.find((n) => n.id === edge.source);
                          if (srcNode?.type === 'image' && srcNode.data) {
                            const srcOut = (srcNode.data?.outputImage as string) || (srcNode.data?.originalImageUrl as string) || '';
                            imageToProcess = resolveImageToProcess(srcNode.data as ImageNodeData, srcOut);
                            if (imageToProcess) break;
                          }
                        }
                      }
                      if (imageToProcess) break;
                    }
                  }
                  if (!imageToProcess) {
                    setIsMattingLoading(false);
                    setErrorMessage(imgc.needImageFirst);
                    return;
                  }
                  if (!window.electronAPI?.imageMatting) {
                    setErrorMessage(imgc.mattingNotSupported);
                    return;
                  }
                  setIsMattingLoading(true);
                  setErrorMessage('');
                  try {
                    const result = await window.electronAPI.imageMatting(imageToProcess);
                    if (result?.success && result.imageUrl) {
                      const newUrl = result.imageUrl;
                      setOutputImage(newUrl);
                      setOutputImages([newUrl]);
                      updateNodeData({
                        outputImage: newUrl,
                        outputImages: [newUrl],
                        errorMessage: undefined,
                        imageAsset: buildImageAssetAfterAuxUrl(data?.imageAsset, newUrl),
                      });
                      onAuxImageTaskComplete?.({ nodeId: id, type: 'matting', imageUrl: newUrl });
                    }
                  } catch (err: any) {
                    const msg = err?.message || imgc.mattingFailedDefault;
                    setErrorMessage(msg);
                    updateNodeData({ errorMessage: msg });
                  } finally {
                    setIsMattingLoading(false);
                  }
                }}
                className={topToolbarIconBtn(
                  'motion',
                  false,
                  isMattingLoading || isWatermarkRemovalLoading ? '!opacity-50 cursor-not-allowed' : '',
                )}
                title={`${imgc.mattingTitle} · ${locale === 'en' ? `${mattingDisplayYuanbao} ${imgc.creditsSuffix}` : `${mattingDisplayYuanbao}${imgc.creditsSuffix}`}`}
                aria-label={imgc.mattingButton}
              >
                {isMattingLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ImageMattingToolbarIcon />
                )}
              </button>
              <span
                className={`absolute left-1/2 top-full z-20 mt-1 w-24 -translate-x-1/2 text-center text-xs font-medium px-2 py-1 rounded shadow-md transition-all duration-200 ease-out ${
                  isDarkMode ? 'text-yellow-200 bg-yellow-900/90 ring-1 ring-yellow-500/35' : 'text-yellow-800 bg-yellow-100 ring-1 ring-yellow-300/60'
                } ${
                  mattingPriceHover
                    ? 'pointer-events-none translate-y-0 opacity-100'
                    : 'pointer-events-none translate-y-2 opacity-0'
                }`}
                title={imgc.mattingPriceTitle}
              >
                {locale === 'en' ? `${mattingDisplayYuanbao} ${imgc.creditsSuffix}` : `${mattingDisplayYuanbao}${imgc.creditsSuffix}`}
              </span>
            </div>

            {/* 放大：仅图标，悬停显示价；结果落到右侧新模块 */}
            <div
              className="relative inline-flex"
              onMouseEnter={() => setUpscaleV3PriceHover(true)}
              onMouseLeave={() => setUpscaleV3PriceHover(false)}
            >
              <button
                type="button"
                disabled={isMattingLoading || isWatermarkRemovalLoading || isUpscaleV3Loading}
                onClick={async (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (isMattingLoading || isWatermarkRemovalLoading || isUpscaleV3Loading) return;
                  const resolveImageToProcess = (nodeData: ImageNodeData | undefined, outImg: string): string => {
                    return outImg
                      || (nodeData?.inputImages && nodeData.inputImages.length > 0 ? formatImagePath(nodeData.inputImages[0]) : '')
                      || (nodeData?.imageAsset?.original ? formatImagePath(nodeData.imageAsset.original) : '')
                      || (nodeData?.imageAsset?.preview ? formatImagePath(nodeData.imageAsset.preview) : '');
                  };
                  let imageToProcess = resolveImageToProcess(data, primaryOutputImage);
                  if (!imageToProcess) {
                    const edges = getEdges();
                    const nodes = getNodes();
                    const incomingImageEdges = edges.filter((ed) => ed.target === id);
                    for (const edge of incomingImageEdges) {
                      const srcNode = nodes.find((n) => n.id === edge.source);
                      if (srcNode?.type === 'image' && srcNode.data) {
                        const srcOut = (srcNode.data?.outputImage as string) || (srcNode.data?.originalImageUrl as string) || '';
                        imageToProcess = resolveImageToProcess(srcNode.data as ImageNodeData, srcOut);
                        if (imageToProcess) break;
                      }
                    }
                  }
                  if (!imageToProcess) {
                    setErrorMessage('');
                    for (let i = 0; i < 4; i++) {
                      await new Promise((r) => setTimeout(r, 500));
                      const freshNodes = getNodes();
                      const selfNode = freshNodes.find((n) => n.id === id);
                      const freshData = selfNode?.data as ImageNodeData | undefined;
                      const freshOut = (freshData?.outputImage as string) || (freshData?.originalImageUrl as string) || '';
                      imageToProcess = resolveImageToProcess(freshData, freshOut);
                      if (!imageToProcess) {
                        const incomingImageEdges = getEdges().filter((ed) => ed.target === id);
                        for (const edge of incomingImageEdges) {
                          const srcNode = freshNodes.find((n) => n.id === edge.source);
                          if (srcNode?.type === 'image' && srcNode.data) {
                            const srcOut = (srcNode.data?.outputImage as string) || (srcNode.data?.originalImageUrl as string) || '';
                            imageToProcess = resolveImageToProcess(srcNode.data as ImageNodeData, srcOut);
                            if (imageToProcess) break;
                          }
                        }
                      }
                      if (imageToProcess) break;
                    }
                  }
                  if (!imageToProcess) {
                    setErrorMessage(imgc.needImageFirst);
                    return;
                  }
                  if (!window.electronAPI?.imageUpscaleV3) {
                    setErrorMessage(imgc.upscaleV3NotSupported);
                    return;
                  }

                  const targetNodeId = spawnLinkedImageModule({
                    label: imgc.upscaleV3Title,
                    inputImageUrl: imageToProcess,
                    pinToSourceRight: true,
                    extraData: {
                      progress: 1,
                      progressMessage: imgc.upscaleV3Progress(String(upscaleV3DisplayYuanbao)),
                    },
                  });
                  if (!targetNodeId) {
                    setErrorMessage(imgc.needImageFirst);
                    return;
                  }

                  setIsUpscaleV3Loading(true);
                  setErrorMessage('');
                  try {
                    const result = await window.electronAPI.imageUpscaleV3(imageToProcess);
                    if (result?.success && result.imageUrl && !/\.zip(?:$|[?#])/i.test(result.imageUrl)) {
                      const newUrl = result.imageUrl;
                      patchImageNodeData(targetNodeId, {
                        outputImage: newUrl,
                        outputImages: [newUrl],
                        originalImageUrl: newUrl,
                        errorMessage: undefined,
                        progress: 0,
                        progressMessage: '',
                        imageAsset: buildImageAssetAfterAuxUrl(undefined, newUrl),
                      });
                      onAuxImageTaskComplete?.({ nodeId: targetNodeId, type: 'upscale-v3', imageUrl: newUrl });
                    } else {
                      patchImageNodeData(targetNodeId, {
                        progress: 0,
                        progressMessage: '',
                        errorMessage:
                          result?.success && result.imageUrl
                            ? (locale === 'en' ? 'Upscale returned no image (zip ignored)' : '超分未返回可用图片（已忽略 zip）')
                            : imgc.upscaleV3FailedDefault,
                      });
                    }
                  } catch (err: any) {
                    const msg = err?.message || imgc.upscaleV3FailedDefault;
                    patchImageNodeData(targetNodeId, {
                      progress: 0,
                      progressMessage: '',
                      errorMessage: msg,
                    });
                  } finally {
                    setIsUpscaleV3Loading(false);
                  }
                }}
                className={topToolbarIconBtn(
                  'looks',
                  false,
                  isMattingLoading || isWatermarkRemovalLoading || isUpscaleV3Loading
                    ? '!opacity-50 cursor-not-allowed'
                    : '',
                )}
                title={`${imgc.upscaleV3Title} · ${locale === 'en' ? `${upscaleV3DisplayYuanbao} ${imgc.creditsSuffix}` : `${upscaleV3DisplayYuanbao}${imgc.creditsSuffix}`}`}
                aria-label={imgc.upscaleV3Title}
              >
                {isUpscaleV3Loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ImageUpscaleToolbarIcon />
                )}
              </button>
              <span
                className={`absolute left-1/2 top-full z-20 mt-1 w-24 -translate-x-1/2 text-center text-xs font-medium px-2 py-1 rounded shadow-md transition-all duration-200 ease-out ${
                  isDarkMode ? 'text-yellow-200 bg-yellow-900/90 ring-1 ring-yellow-500/35' : 'text-yellow-800 bg-yellow-100 ring-1 ring-yellow-300/60'
                } ${
                  upscaleV3PriceHover
                    ? 'pointer-events-none translate-y-0 opacity-100'
                    : 'pointer-events-none translate-y-2 opacity-0'
                }`}
                title={imgc.upscaleV3PriceTitle}
              >
                {locale === 'en' ? `${upscaleV3DisplayYuanbao} ${imgc.creditsSuffix}` : `${upscaleV3DisplayYuanbao}${imgc.creditsSuffix}`}
              </span>
            </div>

            {primaryOutputImage ? (
              <div
                className="relative inline-flex flex-col items-stretch nodrag nopan"
                onMouseEnter={openSplitMenu}
                onMouseLeave={scheduleCloseSplitMenu}
              >
                <div
                  className={topToolbarIconBtn(
                    'events',
                    splitGridMenuHover && !isSplitNineBusy,
                    isMattingLoading ||
                      isWatermarkRemovalLoading ||
                      isUpscaleV3Loading ||
                      !!nineSplitAnim ||
                      isSplitNineBusy
                      ? '!opacity-50 cursor-not-allowed'
                      : 'cursor-default gap-0 !w-auto px-1.5',
                  )}
                  title={imgc.splitGridHoverHint}
                  role="group"
                  aria-label={imgc.splitGridHoverHint}
                >
                  {isSplitNineBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <LayoutGrid className="w-4 h-4 shrink-0" />
                  )}
                  <ChevronDown className="w-3 h-3 shrink-0 opacity-80" aria-hidden />
                </div>
                {splitGridMenuHover &&
                  !isMattingLoading &&
                  !isWatermarkRemovalLoading &&
                  !nineSplitAnim &&
                  !isSplitNineBusy && (
                    <div
                      className="absolute left-0 top-full z-[60] min-w-[10.5rem] pt-1 nodrag nopan"
                      onMouseEnter={openSplitMenu}
                      onMouseLeave={scheduleCloseSplitMenu}
                      onPointerDown={(ev) => ev.stopPropagation()}
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <div
                        className={`rounded-lg border py-1 shadow-xl ${
                          isDarkMode ? 'bg-zinc-900 border-white/15 text-white/95' : 'bg-white border-gray-200 text-gray-900'
                        }`}
                      >
                        <button
                          type="button"
                          className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
                            isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                          }`}
                          onClick={(ev) => {
                            setSplitGridMenuHover(false);
                            void handleSplitGridToCanvas('four', ev);
                          }}
                        >
                          {imgc.splitGridMenuFour}
                        </button>
                        <button
                          type="button"
                          className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
                            isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                          }`}
                          onClick={(ev) => {
                            setSplitGridMenuHover(false);
                            void handleSplitGridToCanvas('2x3', ev);
                          }}
                        >
                          {imgc.splitGridMenuTwoByThree}
                        </button>
                        <button
                          type="button"
                          className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
                            isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                          }`}
                          onClick={(ev) => {
                            setSplitGridMenuHover(false);
                            void handleSplitGridToCanvas('3x2', ev);
                          }}
                        >
                          {imgc.splitGridMenuThreeByTwo}
                        </button>
                        <button
                          type="button"
                          className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${
                            isDarkMode ? 'hover:bg-white/10' : 'hover:bg-gray-100'
                          }`}
                          onClick={(ev) => {
                            setSplitGridMenuHover(false);
                            void handleSplitGridToCanvas('nine', ev);
                          }}
                        >
                          {imgc.splitGridMenuNine}
                        </button>
                        <div
                          className={`mt-0.5 border-t px-3 py-2 ${
                            isDarkMode ? 'border-white/10' : 'border-gray-200'
                          }`}
                          onMouseEnter={openSplitMenu}
                        >
                          <div
                            className={`mb-1.5 text-[10px] font-medium ${
                              isDarkMode ? 'text-white/55' : 'text-gray-500'
                            }`}
                          >
                            {imgc.splitGridMenuCustom}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={1}
                              max={GRID_SPLIT_MAX_AXIS}
                              inputMode="numeric"
                              value={customSplitCols}
                              onChange={(ev) => setCustomSplitCols(ev.target.value)}
                              onFocus={openSplitMenu}
                              onKeyDown={(ev) => {
                                if (ev.key === 'Enter') {
                                  ev.preventDefault();
                                  applyCustomSplitGrid(ev);
                                }
                              }}
                              className={`nodrag nopan h-7 w-10 rounded-md border px-1.5 text-center text-xs outline-none ${
                                isDarkMode
                                  ? 'border-white/15 bg-white/5 text-white focus:border-white/35'
                                  : 'border-gray-200 bg-white text-gray-900 focus:border-gray-400'
                              }`}
                              aria-label={locale === 'en' ? 'Columns' : '列'}
                              title={locale === 'en' ? 'Columns' : '列'}
                            />
                            <span className={`text-xs ${isDarkMode ? 'text-white/45' : 'text-gray-400'}`}>×</span>
                            <input
                              type="number"
                              min={1}
                              max={GRID_SPLIT_MAX_AXIS}
                              inputMode="numeric"
                              value={customSplitRows}
                              onChange={(ev) => setCustomSplitRows(ev.target.value)}
                              onFocus={openSplitMenu}
                              onKeyDown={(ev) => {
                                if (ev.key === 'Enter') {
                                  ev.preventDefault();
                                  applyCustomSplitGrid(ev);
                                }
                              }}
                              className={`nodrag nopan h-7 w-10 rounded-md border px-1.5 text-center text-xs outline-none ${
                                isDarkMode
                                  ? 'border-white/15 bg-white/5 text-white focus:border-white/35'
                                  : 'border-gray-200 bg-white text-gray-900 focus:border-gray-400'
                              }`}
                              aria-label={locale === 'en' ? 'Rows' : '行'}
                              title={locale === 'en' ? 'Rows' : '行'}
                            />
                            <button
                              type="button"
                              className={`ml-auto h-7 shrink-0 rounded-md px-2 text-xs font-medium transition-colors ${
                                isDarkMode
                                  ? 'bg-white/12 text-white hover:bg-white/18'
                                  : 'bg-gray-900 text-white hover:bg-gray-800'
                              }`}
                              onClick={(ev) => applyCustomSplitGrid(ev)}
                            >
                              {imgc.splitGridCustomApply}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
              </div>
            ) : null}

            <div
              className="relative inline-flex flex-col items-center"
              onMouseEnter={() => setWatermarkPriceHover(true)}
              onMouseLeave={() => setWatermarkPriceHover(false)}
            >
              <button
              type="button"
              disabled={isMattingLoading || isWatermarkRemovalLoading}
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (isMattingLoading || isWatermarkRemovalLoading) return;
                const resolveImageToProcess = (nodeData: ImageNodeData | undefined, outImg: string): string => {
                  return outImg
                    || (nodeData?.inputImages && nodeData.inputImages.length > 0 ? formatImagePath(nodeData.inputImages[0]) : '')
                    || (nodeData?.imageAsset?.original ? formatImagePath(nodeData.imageAsset.original) : '')
                    || (nodeData?.originalImageUrl ? formatImagePath(nodeData.originalImageUrl) : '')
                    || (nodeData?.imageAsset?.preview ? formatImagePath(nodeData.imageAsset.preview) : '');
                };
                let imageToProcess = resolveImageToProcess(data, primaryOutputImage);
                if (!imageToProcess) {
                  const edges = getEdges();
                  const nodes = getNodes();
                  const incomingImageEdges = edges.filter((ed) => ed.target === id);
                  for (const edge of incomingImageEdges) {
                    const srcNode = nodes.find((n) => n.id === edge.source);
                    if (srcNode?.type === 'image' && srcNode.data) {
                      const srcOut = (srcNode.data?.outputImage as string) || (srcNode.data?.originalImageUrl as string) || '';
                      imageToProcess = resolveImageToProcess(srcNode.data as ImageNodeData, srcOut);
                      if (imageToProcess) break;
                    }
                  }
                }
                if (!imageToProcess) {
                  setErrorMessage('');
                  for (let i = 0; i < 4; i++) {
                    await new Promise((r) => setTimeout(r, 500));
                    const freshNodes = getNodes();
                    const selfNode = freshNodes.find((n) => n.id === id);
                    const freshData = selfNode?.data as ImageNodeData | undefined;
                    const freshOut = (freshData?.outputImage as string) || (freshData?.originalImageUrl as string) || '';
                    imageToProcess = resolveImageToProcess(freshData, freshOut);
                    if (!imageToProcess) {
                      const incomingImageEdges = getEdges().filter((ed) => ed.target === id);
                      for (const edge of incomingImageEdges) {
                        const srcNode = freshNodes.find((n) => n.id === edge.source);
                        if (srcNode?.type === 'image' && srcNode.data) {
                          const srcOut = (srcNode.data?.outputImage as string) || (srcNode.data?.originalImageUrl as string) || '';
                          imageToProcess = resolveImageToProcess(srcNode.data as ImageNodeData, srcOut);
                          if (imageToProcess) break;
                        }
                      }
                    }
                    if (imageToProcess) break;
                  }
                }
                if (!imageToProcess) {
                  setErrorMessage(imgc.needImageFirst);
                  return;
                }
                if (!window.electronAPI?.imageWatermarkRemoval) {
                  setErrorMessage(imgc.watermarkNotSupported);
                  return;
                }

                // 原图不变：右侧新建模块承接去水印结果与进度遮罩
                const targetNodeId = spawnLinkedImageModule({
                  label: imgc.watermarkButton,
                  inputImageUrl: imageToProcess,
                  extraData: {
                    progress: 1,
                    progressMessage: imgc.watermarkProgress(String(watermarkDisplayYuanbao)),
                  },
                });
                if (!targetNodeId) {
                  setErrorMessage(imgc.needImageFirst);
                  return;
                }

                // 仅按钮转圈，不在原模块盖进度遮罩
                setIsWatermarkRemovalLoading(true);
                setErrorMessage('');
                try {
                  const result = await window.electronAPI.imageWatermarkRemoval(imageToProcess);
                  if (result?.success && result.imageUrl) {
                    const newUrl = result.imageUrl;
                    patchImageNodeData(targetNodeId, {
                      outputImage: newUrl,
                      outputImages: [newUrl],
                      originalImageUrl: newUrl,
                      errorMessage: undefined,
                      progress: 0,
                      progressMessage: '',
                      imageAsset: buildImageAssetAfterAuxUrl(undefined, newUrl),
                    });
                    onAuxImageTaskComplete?.({ nodeId: targetNodeId, type: 'watermark', imageUrl: newUrl });
                  } else {
                    patchImageNodeData(targetNodeId, {
                      progress: 0,
                      progressMessage: '',
                      errorMessage: imgc.watermarkFailedDefault,
                    });
                  }
                } catch (err: any) {
                  const msg = err?.message || imgc.watermarkFailedDefault;
                  patchImageNodeData(targetNodeId, {
                    progress: 0,
                    progressMessage: '',
                    errorMessage: msg,
                  });
                } finally {
                  setIsWatermarkRemovalLoading(false);
                }
              }}
              className={topToolbarIconBtn('operators', false, isMattingLoading || isWatermarkRemovalLoading ? '!opacity-50 cursor-not-allowed' : '')}
              title={imgc.watermarkTitle}
            >
              {isWatermarkRemovalLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Stamp className="w-4 h-4" />
              )}
            </button>
              <span
                className={`absolute left-1/2 top-full z-20 mt-1 w-24 -translate-x-1/2 text-center text-xs font-medium px-2 py-1 rounded shadow-md transition-all duration-200 ease-out ${
                  isDarkMode ? 'text-yellow-200 bg-yellow-900/90 ring-1 ring-yellow-500/35' : 'text-yellow-800 bg-yellow-100 ring-1 ring-yellow-300/60'
                } ${
                  watermarkPriceHover
                    ? 'pointer-events-none translate-y-0 opacity-100'
                    : 'pointer-events-none translate-y-2 opacity-0'
                }`}
                title={imgc.watermarkPriceTitle}
              >
                {locale === 'en' ? `${watermarkDisplayYuanbao} ${imgc.creditsSuffix}` : `${watermarkDisplayYuanbao}${imgc.creditsSuffix}`}
              </span>
            </div>
            <button
              ref={threeDTriggerRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                if (data?.isCameraViewModule) {
                  setIs3DPopoverOpen((v) => !v);
                } else {
                  spawnCameraViewModule();
                }
              }}
              className={topToolbarIconBtn('sensing', is3DPopoverOpen)}
              title={imgc.perspective3dTitle}
            >
              <Box className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 图片内容显示区域：运行中由全模块进度条遮罩覆盖，再显示结果/错误/占位；缩放时隐藏高清图仅显示轮廓以提升性能 */}
        <div
          className={`custom-scrollbar relative w-full h-full flex flex-col min-h-0 ${
            hasRenderableImage ? 'p-0' : 'p-2'
          } ${
            isPanorama360Mode
              ? 'items-stretch overflow-hidden'
              : 'items-center overflow-auto'
          }`}
        >
          {hasRenderableImage && !isPanorama360Mode ? <AiGeneratedBadge isDarkMode={isDarkMode} /> : null}
          {primaryOutputImage ? (
            <>
              <div
                ref={imgContainerRef}
                className={`relative flex items-center justify-center min-w-0 min-h-0 flex-1 w-full h-full ${
                  isPanorama360Mode ? 'overflow-hidden' : inspectZoom > 1.01 ? 'overflow-hidden nodrag nopan nowheel' : ''
                }`}
                style={{
                  ...(hideImageLayerInPrefetch && !showCropModal && !isPanorama360Mode
                    ? { visibility: 'hidden', pointerEvents: 'none' as const }
                    : {}),
                }}
                onWheel={handleInspectWheel}
                onPointerDown={inspectZoom > 1.01 ? handleInspectPointerDown : undefined}
                onPointerMove={inspectZoom > 1.01 ? handleInspectPointerMove : undefined}
                onPointerUp={inspectZoom > 1.01 ? handleInspectPointerUp : undefined}
                onPointerCancel={inspectZoom > 1.01 ? handleInspectPointerUp : undefined}
              >
              {isResizing ? (
                <div className={`w-full h-full min-h-[80px] rounded-lg flex items-center justify-center ${isDarkMode ? 'bg-white/10' : 'bg-black/10'}`} />
              ) : (
              <>
              {hasMultiOutputImages ? (() => {
                const gridLayout = getOutputImageGridLayout(outputImages.length);
                const remain = outputImages.length - gridLayout.maxSlots;
                return (
                <>
                <div
                  ref={nineGridRef}
                  className={`absolute inset-0 grid ${gridClassForLayout(gridLayout.cols)} gap-1 p-1`}
                  style={{
                    gridTemplateRows: `repeat(${gridLayout.rows}, minmax(0, 1fr))`,
                    opacity: showMultiMergeWhileMoving ? 0 : 1,
                    pointerEvents: showMultiMergeWhileMoving ? 'none' : 'auto',
                  }}
                >
                  {outputImages.slice(0, gridLayout.maxSlots).map((img, idx) => {
                    const isMoreTile = gridLayout.maxSlots === 9 && idx === 8 && remain > 0;
                    if (isMoreTile) {
                      return (
                        <button
                          key={`${img}-${idx}-more`}
                          type="button"
                          className="relative rounded-lg overflow-hidden bg-black/60 text-white font-semibold text-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShowAllOutputImages(true);
                          }}
                          title={`还有 ${remain} 张`}
                        >
                          +{remain}
                        </button>
                      );
                    }
                    return (
                    <button
                      key={`${img}-${idx}`}
                      type="button"
                      className="relative rounded-lg overflow-hidden bg-black/20"
                      onClick={(e) => {
                        e.stopPropagation();
                        const previewSrc = getImageDisplaySrc(formatImagePath(img));
                        if (!previewSrc) return;
                        if (onPreviewImage) onPreviewImage(previewSrc, id);
                        else window.open(previewSrc, '_blank', 'noopener,noreferrer');
                      }}
                      title={`预览第 ${idx + 1} 张`}
                    >
                      <img
                        src={getImageDisplaySrc(formatImagePath(img))}
                        alt={`Generated ${idx + 1}`}
                        className="w-full h-full object-cover select-none"
                        draggable={false}
                      />
                    </button>
                    );
                  })}
                </div>
                {showMultiMergeWhileMoving ? (
                  <img
                    src={multiGridPreviewSrc}
                    alt=""
                    className="absolute top-0 left-0 rounded-2xl select-none pointer-events-none"
                    width={Math.round(size.w)}
                    height={Math.round(size.h)}
                    style={{
                      width: Math.round(size.w),
                      height: Math.round(size.h),
                    }}
                    draggable={false}
                    aria-hidden
                  />
                ) : null}
                </>
                );
              })() : null}
              {shouldShowOutputLayer ? (
              isPanorama360Mode && panoTextureUrl ? (
                <div
                  className="nexflow-pano360-host z-[1] rounded-2xl overflow-hidden nodrag nopan nowheel bg-black"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                  }}
                >
                  <Panorama360Viewer
                    instanceKey={`${id}-pano360`}
                    textureUrl={panoTextureUrl}
                    isDarkMode={isDarkMode}
                    chrome="overlay"
                    className=""
                    layoutWidth={Math.round(size.w)}
                    layoutHeight={Math.round(size.h)}
                    nearLabel={imgc.panorama360Near}
                    farLabel={imgc.panorama360Far}
                    zoomSliderTitle={imgc.panorama360ZoomTitle}
                    aspectAdaptiveLabel={imgc.panorama360AspectAdaptive}
                    screenshotLabel={imgc.panorama360Screenshot}
                    resetFovLabel={imgc.panorama360ResetFov}
                    exitLabel={imgc.panorama360ExitFullscreen}
                    exitTitle={imgc.panorama360ExitFullscreenTitle}
                    dragHint={locale === 'en' ? 'Drag to rotate view' : '拖拽旋转视角'}
                    onRegisterControls={registerPanoControls}
                    expandRatioPickerTitle={imgc.panorama360ExpandRatioPicker}
                    collapseRatioPickerTitle={imgc.panorama360CollapseRatioPicker}
                    ratioShortcutHint={imgc.panorama360RatioShortcutHint}
                    onScreenshotCaptured={handlePanoramaScreenshot}
                    onCaptureEmpty={() => showAlert(imgc.panorama360CaptureNotReady)}
                    onRequestExit={() => {
                      if (panorama360Active) togglePanorama360Mode();
                    }}
                  />
                </div>
              ) : (
              <>
              {!isImageLoaded && !hasMultiOutputImages && (
                loadingPlaceholderSrc ? (
                  <img
                    src={getImageDisplaySrc(formatImagePath(loadingPlaceholderSrc))}
                    alt="Tiny"
                    className="absolute inset-0 w-full h-full object-contain rounded-2xl select-none"
                    draggable={false}
                  />
                ) : ghostImage ? (
                  <div
                    className="absolute inset-0 rounded-2xl"
                    style={{
                      backgroundImage: `url(${ghostImage})`,
                      backgroundSize: 'contain',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat',
                      filter: 'blur(5px)',
                      transition: 'all 0.2s ease',
                      opacity: 0.85,
                    }}
                  />
                ) : (
                  hasAvgColor ? (
                    <div
                      className="absolute inset-0 rounded-2xl"
                      style={{ backgroundColor: skeletonColor, transition: 'all 0.2s ease', opacity: 0.85 }}
                    />
                  ) : (
                    <div
                      className="absolute inset-0 rounded-2xl flex items-center justify-center animate-pulse"
                      style={{
                        background: isDarkMode
                          ? 'linear-gradient(135deg, rgba(71,85,105,0.32), rgba(100,116,139,0.42))'
                          : 'linear-gradient(135deg, rgba(148,163,184,0.22), rgba(148,163,184,0.34))',
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <ImageIcon className={`w-4 h-4 ${isDarkMode ? 'text-white/35' : 'text-gray-500/80'}`} />
                    </div>
                  )
                )
              )}
              <img
                ref={imgRef}
                src={currentImageSrc || resolvedDisplaySrc}
                alt="Generated"
                loading="lazy"
                draggable={
                  outputImages.length <= 1 &&
                  !!dragOutFileSourceUrl &&
                  !dragOutFileSourceUrl.startsWith('blob:')
                }
                onPointerDown={handleOutputImagePointerDown}
                onDoubleClick={handleOutputImageDoubleClick}
                onDragStart={handleOutputImageDragStart}
                onDrag={handleOutputImageDrag}
                onDragEnd={handleOutputImageDragEnd}
                title={
                  selected && outputImages.length <= 1
                    ? imgc.previewOpenHint
                    : outputImages.length <= 1 &&
                        !!dragOutFileSourceUrl &&
                        !dragOutFileSourceUrl.startsWith('blob:')
                      ? locale === 'en'
                        ? 'Drag to desktop or a folder to copy the image file'
                        : '拖到桌面或文件夹以复制图片文件'
                      : undefined
                }
                className={`nodrag nopan absolute inset-0 w-full h-full rounded-2xl select-none transition-opacity duration-150 ${
                  showCropModal ? 'object-fill' : 'object-contain'
                }`}
                style={{
                  display: hasMultiOutputImages ? 'none' : 'block',
                  opacity: isInteractionVisualLock ? 1 : (isImageVisible ? 1 : 0),
                  filter: shouldUseFocusTransition
                    ? (isImageVisible ? 'blur(0px)' : 'blur(10px)')
                    : 'blur(0px)',
                  transitionProperty: 'opacity, filter',
                  transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDuration: isInteractionVisualLock ? '0ms' : '220ms',
                  ...(performanceMode ? { imageRendering: 'crisp-edges' } : {}),
                  ...(inspectZoom > 1.01 && !showCropModal
                    ? {
                        transform: `translate(${inspectPan.x}px, ${inspectPan.y}px) scale(${inspectZoom})`,
                        transformOrigin: 'center center',
                        cursor: 'grab',
                      }
                    : {}),
                }}
                onLoad={(e) => {
                  transientImgErrorRetriesRef.current = 0;
                  setIsImageLoaded(true);
                  const elapsed = Date.now() - loadStartAtRef.current;
                  const minimumDelay = isFastMoving ? 30 : 100;
                  const delay = Math.max(minimumDelay - elapsed, 0);
                  if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
                  revealTimerRef.current = setTimeout(() => setIsImageVisible(true), delay);
                  const img = e.currentTarget;
                  const srcKey = currentImageSrc || primaryOutputImage || img.src || '';
                  if (lastOnLoadSrcRef.current === srcKey) return;

                  if (fallbackUrl) setFallbackUrl(null);
                  const assetW = Number(data?.imageAsset?.width);
                  const assetH = Number(data?.imageAsset?.height);
                  const imgRatio = img.naturalWidth / Math.max(img.naturalHeight, 1);
                  const assetRatio = assetW > 0 && assetH > 0 ? assetW / assetH : 0;
                  const assetMatchesLoaded =
                    assetW > 0 &&
                    assetH > 0 &&
                    img.naturalWidth > 0 &&
                    img.naturalHeight > 0 &&
                    Math.abs(assetRatio - imgRatio) / Math.max(imgRatio, 0.01) < 0.08;
                  const naturalW = assetMatchesLoaded ? assetW : img.naturalWidth;
                  const naturalH = assetMatchesLoaded ? assetH : img.naturalHeight;
                  applyLayoutFromMediaPixels(naturalW, naturalH, srcKey);
                }}
                onError={async (e) => {
                // 图片加载失败时，检查是否有本地文件路径可以回退
                const img = e.currentTarget;
                const src = img.src;
                const originalUrl = primaryOutputImage;
                const isInlinePrimary =
                  originalUrl.startsWith('data:') || originalUrl.startsWith('blob:');
                setIsImageLoaded(false);
                setIsImageVisible(false);
                
                console.error('[ImageNode] 图片加载失败:', {
                  originalUrl,
                  formattedUrl: formatImagePath(primaryOutputImage),
                  actualSrc: src,
                  isLocalResource: originalUrl.startsWith('local-resource://'),
                  localPath: data?.localPath,
                });

                // 与任务列表一致：远程/坏链失败时优先回退 localPath（经 mapProjectPath）
                const diskRaw = String(data?.localPath || '').trim();
                const diskLooksImage =
                  !!diskRaw &&
                  /\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(diskRaw) &&
                  !/\.(txt|json|md|csv)$/i.test(diskRaw);
                if (
                  !isInlinePrimary &&
                  diskLooksImage &&
                  !String(src).includes('_nf_local_fb=') &&
                  (src.startsWith('http://') ||
                    src.startsWith('https://') ||
                    !originalUrl ||
                    isHttpLikeMediaUrl(originalUrl))
                ) {
                  try {
                    let localUrl = await resolveImageSrcForElectronDisplay(diskRaw, projectId);
                    if (localUrl && img.src !== localUrl) {
                      const sep = localUrl.includes('?') ? '&' : '?';
                      img.src = `${localUrl}${sep}_nf_local_fb=1`;
                      return;
                    }
                  } catch (fbErr) {
                    console.warn('[ImageNode] localPath 回退失败', fbErr);
                  }
                }
                
                // 如果当前使用的是 local-resource://，尝试检查文件是否存在
                if (originalUrl.startsWith('local-resource://') && window.electronAPI) {
                  try {
                    const checkResult = await window.electronAPI.checkFileExists(originalUrl);
                    console.error('[ImageNode] 文件系统检查结果（通过 fs.stat）:', {
                      url: originalUrl,
                      exists: checkResult.exists,
                      readable: checkResult.readable,
                      size: checkResult.size,
                      path: checkResult.path,
                      error: checkResult.error,
                    });
                    
                    if (!checkResult.exists || !checkResult.readable) {
                      console.error('[ImageNode] 本地文件不存在或不可读，详细信息:', {
                        url: originalUrl,
                        decodedPath: checkResult.path,
                        exists: checkResult.exists,
                        readable: checkResult.readable,
                        size: checkResult.size,
                        error: checkResult.error,
                      });
                      // 如果有 fallback URL，尝试使用它
                      if (fallbackUrl) {
                        console.log('[ImageNode] 使用 fallback URL:', fallbackUrl);
                        img.src = fallbackUrl;
                        return;
                      }
                      // 显示错误占位符
                      img.src = imageLoadFailPlaceholder;
                      return;
                    }
                    // 磁盘存在：file:// 回退到 local-resource；已是协议 URL 时带参强制重载一次（并发高时偶发失败）
                    if (checkResult.exists && checkResult.readable && originalUrl.startsWith('local-resource://')) {
                      if (src.startsWith('file:')) {
                        img.src = originalUrl.split('?')[0];
                        return;
                      }
                      if (!String(src).includes('_nf_retry=')) {
                        const ou = originalUrl.split('?')[0];
                        img.src = `${ou}?_nf_retry=${Date.now()}`;
                        return;
                      }
                    }
                  } catch (error) {
                    console.error('[ImageNode] 检查文件失败，异常信息:', error);
                    // 如果有 fallback URL，尝试使用它
                    if (fallbackUrl) {
                      console.log('[ImageNode] 检查失败，使用 fallback URL:', fallbackUrl);
                      img.src = fallbackUrl;
                      return;
                    }
                  }
                }
                
                // 如果当前使用的是远程URL（OSS），尝试检查是否有本地文件（主图为 data:/blob: 时不走此链，避免误对过期 http 重试）
                if (
                  !isInlinePrimary &&
                  (src.includes('oss-cn-hongkong.aliyuncs.com') ||
                   src.includes('oss-us-west-1.aliyuncs.com') ||
                   src.includes('aliyuncs.com') ||
                   src.startsWith('http://') ||
                   src.startsWith('https://')) &&
                  !src.includes('_retry=')
                ) {
                  console.log(`[ImageNode] 图片加载失败，1.5秒后重试:`, src);
                  setTimeout(() => {
                    const separator = src.includes('?') ? '&' : '?';
                    img.src = `${src}${separator}_retry=${Date.now()}`;
                  }, 1500);
                } else {
                  const tries = transientImgErrorRetriesRef.current;
                  const base =
                    resolvedDisplaySrcRef.current ||
                    getImageDisplaySrc(formatImagePath(primaryOutputImage));
                  if (tries < 6 && base && !src.startsWith('data:') && !isInlinePrimary) {
                    transientImgErrorRetriesRef.current = tries + 1;
                    setTimeout(() => {
                      if (imgRef.current !== img) return;
                      if (base.startsWith('file:')) {
                        img.src = `${base.split('#')[0]}#r=${Date.now()}`;
                      } else if (base.startsWith('local-resource:')) {
                        const q = base.includes('?') ? '&' : '?';
                        img.src = `${base.split('?')[0]}${q}_nf_retry=${Date.now()}`;
                      } else {
                        const sep = base.includes('?') ? '&' : '?';
                        img.src = `${base}${sep}_nexflow_retry=${Date.now()}`;
                      }
                    }, 150);
                    return;
                  }
                  transientImgErrorRetriesRef.current = 0;
                  // 竞态：主图已是 data:/blob: 但 <img> 仍短暂指向旧 http → 拉回内联主图而非占位符
                  if (
                    isInlinePrimary &&
                    originalUrl &&
                    (src.startsWith('http://') ||
                      src.startsWith('https://') ||
                      src.includes('aliyuncs.com'))
                  ) {
                    img.src = originalUrl;
                    return;
                  }
                  // 显示错误占位符
                  img.src = imageLoadFailPlaceholder;
                }
                }}
              />
              {bufferImageSrc && (
                <img
                  src={bufferImageSrc}
                  alt="buffer"
                  loading="eager"
                  draggable={false}
                  className={`absolute inset-0 w-full h-full rounded-2xl select-none pointer-events-none transition-opacity duration-150 ${
                    showCropModal ? 'object-fill' : 'object-contain'
                  }`}
                  style={{
                    opacity: isBufferVisible ? 1 : 0,
                    transitionProperty: 'opacity, filter',
                    transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                    transitionDuration: isInteractionVisualLock ? '0ms' : '220ms',
                    ...(performanceMode ? { imageRendering: 'crisp-edges' } : {}),
                  }}
                  onLoad={() => {
                    if (isInteractionVisualLock) return;
                    startCrossFadeTo(bufferImageSrc);
                  }}
                  onError={() => {
                    setBufferImageSrc('');
                    bufferImageSrcRef.current = '';
                    setIsBufferVisible(false);
                  }}
                />
              )}
              </>
              )
              ) : (
                <div className={`w-full h-full min-h-[80px] rounded-lg flex items-center justify-center text-xs ${isDarkMode ? 'bg-white/10 text-white/50' : 'bg-black/10 text-gray-500'}`}>
                  {wc.viewportPausedLoad}
                </div>
              )}
              </>
              )}
              {showCropModal && cropSourceUrl ? (
                <ImageCropOverlay
                  key={`crop-overlay-${size.w}x${size.h}`}
                  ref={cropOverlayRef}
                  imageUrl={cropSourceUrl}
                  isDarkMode={isDarkMode}
                  hint=""
                  showHint={false}
                  busy={cropBusy}
                  layoutRevision={`${size.w}x${size.h}`}
                  onConfirm={(rect) => void handleCropConfirm(rect)}
                  onCancel={() => {
                    if (cropBusy) return;
                    closeCropSession();
                  }}
                />
              ) : null}
              </div>
            </>
          ) : errorMessage ? (
            <div className="flex flex-col items-center justify-center gap-3 p-4">
              <div className={`text-2xl ${isDarkMode ? 'text-red-400' : 'text-red-600'}`}>
                ⚠️
              </div>
              <p className={`text-sm font-semibold text-center ${isDarkMode ? 'text-red-300' : 'text-red-700'}`}>
                {wc.genFailedTitle}
              </p>
              <p className={`text-xs text-center line-clamp-3 ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
                {userFacingErrorMessage(errorMessage, locale)}
              </p>
              {!messageContainsRefundHint(userFacingErrorMessage(errorMessage, locale)) ? (
                <p className={`text-[11px] text-center ${isDarkMode ? 'text-amber-400/90' : 'text-amber-700'}`}>
                  {refundHintForLocale(locale)}
                </p>
              ) : null}
            </div>
          ) : (
            <p className={isDarkMode ? 'text-white/60' : 'text-gray-500'}>
              {wc.waitingForImage}
            </p>
          )}
        </div>

        {nineSplitAnim &&
          createPortal(
            <div className="pointer-events-none fixed inset-0 z-[13000]" aria-hidden>
              {nineSplitAnim.urls.map((url, i) => (
                <motion.img
                  key={`split-fly-${i}-${url.slice(-24)}`}
                  src={getImageDisplaySrc(formatImagePath(url))}
                  alt=""
                  className="object-cover shadow-2xl ring-2 ring-white/25"
                  style={{
                    position: 'fixed',
                    zIndex: 13001 + i,
                    objectFit: 'cover',
                    objectPosition: 'center',
                  }}
                  initial={{
                    left: nineSplitAnim.from[i].left,
                    top: nineSplitAnim.from[i].top,
                    width: nineSplitAnim.from[i].width,
                    height: nineSplitAnim.from[i].height,
                    borderRadius: 8,
                    opacity: 1,
                  }}
                  animate={{
                    left: nineSplitAnim.to[i].left,
                    top: nineSplitAnim.to[i].top,
                    width: nineSplitAnim.to[i].width,
                    height: nineSplitAnim.to[i].height,
                    borderRadius: 14,
                    opacity: 1,
                  }}
                  transition={{
                    type: 'spring',
                    stiffness: 260,
                    damping: 26,
                    delay: i * 0.045,
                    mass: 0.85,
                  }}
                />
              ))}
            </div>,
            document.body,
          )}

        {showAllOutputImages && outputImages.length > 0 && (() => {
          const useExpandMerge = outputImages.length > 9;
          const allGridLayout = useExpandMerge
            ? getFullOutputImagesGridLayout(outputImages.length)
            : getOutputImageGridLayout(outputImages.length);
          const expandGridDisplayFrame =
            useExpandMerge && showExpandAllMergeWhileMoving && expandAllGridFrameLockedRef.current
              ? expandAllGridFrameLockedRef.current
              : expandAllGridFrame;
          return (
          <div
            className="fixed inset-0 z-[1200] bg-black/70 flex items-center justify-center p-4"
            onClick={() => setShowAllOutputImages(false)}
          >
            <div
              className={`w-full max-w-5xl max-h-[80vh] flex flex-col overflow-hidden rounded-xl p-3 ${isDarkMode ? 'bg-zinc-900' : 'bg-white'}`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex shrink-0 items-center justify-between">
                <span className={`text-sm font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  共 {outputImages.length} 张
                </span>
                <button
                  type="button"
                  onClick={() => setShowAllOutputImages(false)}
                  className={`px-2 py-1 text-xs rounded ${isDarkMode ? 'bg-white/10 text-white' : 'bg-gray-200 text-gray-800'}`}
                >
                  关闭
                </button>
              </div>
              <div
                className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden ${isDarkMode ? 'custom-scrollbar-dark nexflow-output-images-modal-scroll' : 'custom-scrollbar'}`}
              >
              <div
                ref={useExpandMerge ? expandAllGridWrapRef : undefined}
                className="relative w-full overflow-hidden"
                style={
                  useExpandMerge
                    ? {
                        height: expandGridDisplayFrame.frameHeight,
                        minHeight: expandGridDisplayFrame.frameHeight,
                        maxHeight: expandGridDisplayFrame.frameHeight,
                      }
                    : undefined
                }
              >
                <div
                  ref={useExpandMerge ? expandAllGridInnerRef : undefined}
                  className={`grid w-full overflow-hidden ${gridClassForLayout(allGridLayout.cols)} gap-2`}
                  style={{
                    gridTemplateRows: `repeat(${allGridLayout.rows}, minmax(0, 1fr))`,
                    opacity: useExpandMerge && showExpandAllMergeWhileMoving ? 0 : 1,
                    pointerEvents: useExpandMerge && showExpandAllMergeWhileMoving ? 'none' : 'auto',
                  }}
                >
                  {outputImages.map((img, idx) => (
                    <button
                      key={`${img}-${idx}-all`}
                      type="button"
                      className="rounded-lg overflow-hidden bg-black/20 aspect-square min-h-[72px]"
                      onClick={() => {
                        const previewSrc = getImageDisplaySrc(formatImagePath(img));
                        if (!previewSrc) return;
                        if (onPreviewImage) onPreviewImage(previewSrc, id);
                        else window.open(previewSrc, '_blank', 'noopener,noreferrer');
                      }}
                      title={`预览第 ${idx + 1} 张`}
                    >
                      <img
                        src={getImageDisplaySrc(formatImagePath(img))}
                        alt={`Generated ${idx + 1}`}
                        className="w-full h-full object-cover select-none"
                        draggable={false}
                      />
                    </button>
                  ))}
                </div>
                {useExpandMerge && showExpandAllMergeWhileMoving && expandAllMergePreviewSrc ? (
                  <img
                    src={expandAllMergePreviewSrc}
                    alt=""
                    className="absolute inset-0 w-full h-full rounded-lg select-none pointer-events-none"
                    draggable={false}
                    aria-hidden
                  />
                ) : null}
              </div>
              </div>
            </div>
          </div>
          );
        })()}

        {/* 3D 视角控制器弹窗：点旁边空白（遮罩）关闭 */}
        {is3DPopoverOpen && threeDPopoverPosition && createPortal(
          <>
            <div
              className="fixed inset-0 z-[9998] bg-transparent"
              aria-hidden
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIs3DPopoverOpen(false);
              }}
            />
            <div
            id={`image-3d-popover-${id}`}
            className={`fixed z-[9999] rounded-xl shadow-xl border overflow-hidden flex flex-col nodrag nopan ${
              isDarkMode ? 'apple-panel border-white/15' : 'apple-panel-light border-gray-300/40'
            }`}
            style={{
              left: threeDPopoverPosition.left,
              top: threeDPopoverPosition.top,
              width: 440,
              minHeight: 360,
              maxHeight: 460,
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between px-3 py-2 border-b ${isDarkMode ? 'border-white/10' : 'border-gray-200'}`}>
              <span className={`text-sm font-medium ${isDarkMode ? 'text-white/90' : 'text-gray-800'}`}>{imgc.dragCubeHint}</span>
              <button
                type="button"
                onClick={() => setIs3DPopoverOpen(false)}
                className={`p-1 rounded ${isDarkMode ? 'hover:bg-white/10 text-white/70' : 'hover:bg-black/8 text-gray-600'}`}
                aria-label={imgc.closeAria}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-1 min-h-0 p-2 gap-3">
              <div className="flex flex-col gap-2 shrink-0" style={{ width: 240 }}>
                <div className={`relative rounded-lg overflow-hidden flex-1 min-h-[240px] ${isDarkMode ? 'bg-black/30' : 'bg-gray-100'}`}>
                  {webglAvailable === null ? (
                    <div
                      className={`h-full w-full flex items-center justify-center text-xs ${isDarkMode ? 'text-white/50' : 'text-gray-500'}`}
                    >
                      {imgc.webglChecking}
                    </div>
                  ) : webglAvailable === false ? (
                    <div
                      className={`h-full w-full flex flex-col items-center justify-center gap-2 p-3 text-center text-xs ${
                        isDarkMode ? 'text-white/70' : 'text-gray-600'
                      }`}
                    >
                      <span>{imgc.webglUnavailable}</span>
                      <span className="opacity-80">{imgc.webglUnavailableHint}</span>
                      <button
                        type="button"
                        onClick={() => setIs3DPopoverOpen(false)}
                        className={`mt-1 px-2 py-1 rounded text-[10px] ${
                          isDarkMode ? 'bg-white/15 hover:bg-white/25' : 'bg-black/15 hover:bg-black/25'
                        }`}
                      >
                        {imgc.closeAria}
                      </button>
                    </div>
                  ) : (
                  <Local3DErrorBoundary
                    fallback={
                      <div
                        className={`h-full w-full flex flex-col items-center justify-center gap-2 p-3 text-center text-xs ${
                          isDarkMode ? 'text-white/70' : 'text-gray-600'
                        }`}
                      >
                        <span>{imgc.webglUnavailable}</span>
                        <span className="opacity-80">{imgc.webglUnavailableHint}</span>
                        <button
                          type="button"
                          onClick={() => setIs3DPopoverOpen(false)}
                          className={`mt-1 px-2 py-1 rounded text-[10px] ${
                            isDarkMode ? 'bg-white/15 hover:bg-white/25' : 'bg-black/15 hover:bg-black/25'
                          }`}
                        >
                          {imgc.closeAria}
                        </button>
                      </div>
                    }
                    onError={() => {}}
                  >
                    {webglAvailable === true && (
                      <CubeCameraController
                        value={cameraValue}
                        isDarkMode={isDarkMode}
                        locale={locale === 'en' ? 'en' : 'zh'}
                        inputImageUrl={
                          getImageDisplaySrc(
                            formatImagePath(
                              cameraSourceImageUrl ||
                                currentImageSrc ||
                                resolvedDisplaySrc ||
                                previewImagePath ||
                                primaryOutputImage ||
                                '',
                            ),
                          ) || undefined
                        }
                        frontThumbnailUrl={
                          getImageDisplaySrc(
                            formatImagePath(
                              tinyImagePath || cameraSourceImageUrl || previewImagePath || primaryOutputImage || '',
                            ),
                          ) || undefined
                        }
                        onChange={(next) => {
                          const n = normalizeCameraValue(next);
                          setCameraValue(n);
                          persistCameraValue(n);
                        }}
                        onChangeEnd={(next) => persistCameraValue(normalizeCameraValue(next))}
                        onContextLost={() => {}}
                      />
                    )}
                  </Local3DErrorBoundary>
                  )}
                  <button
                    type="button"
                    onClick={() => animateCameraResetToDefault()}
                    className={`absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                      isDarkMode
                        ? 'bg-black/55 text-white/85 hover:bg-black/70'
                        : 'bg-white/90 text-gray-800 hover:bg-white shadow-sm'
                    }`}
                  >
                    <RotateCcw className="w-3 h-3" />
                    {imgc.resetView}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <div className={`text-[11px] ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
                  <div className="flex justify-between">
                    <span>{imgc.rotation}</span>
                    <span>{cameraValue.rotationY.toFixed(1)}°</span>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    title={imgc.rotateAngleTitle}
                    value={cameraValue.rotationY}
                    onChange={(e) => persistCameraValue(normalizeCameraValue({ ...cameraValue, rotationY: Number(e.target.value) }))}
                    className="accent-cyan-400 w-full"
                  />
                </div>
                <div className={`text-[11px] ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
                  <div className="flex justify-between">
                    <span>{imgc.tilt}</span>
                    <span>{cameraValue.rotationX.toFixed(1)}°</span>
                  </div>
                  <input
                    type="range"
                    min={-75}
                    max={75}
                    title={imgc.tiltAngleTitle}
                    value={cameraValue.rotationX}
                    onChange={(e) => persistCameraValue(normalizeCameraValue({ ...cameraValue, rotationX: Number(e.target.value) }))}
                    className="accent-cyan-400 w-full"
                  />
                </div>
                <div className={`text-[11px] ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
                  <div className="flex justify-between">
                    <span>{imgc.shotScale}</span>
                    <span>{(cameraValue.scale / MAX_SCALE).toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min={1.2}
                    max={6.5}
                    step={0.1}
                    title={imgc.shotScaleTitle}
                    value={cameraValue.scale}
                    onChange={(e) => persistCameraValue(normalizeCameraValue({ ...cameraValue, scale: Number(e.target.value) }))}
                    className="accent-cyan-400 w-full"
                  />
                </div>
                <div className="mt-auto flex flex-col gap-1.5 pt-1">
                  <div className="grid grid-cols-2 gap-1.5 min-w-0">
                    <PanelOptionDropdown
                      value={cameraGenAspectOptions.some((o) => o.value === cameraGenAspect) ? cameraGenAspect : 'original'}
                      options={cameraGenAspectOptions}
                      onChange={setCameraGenAspect}
                      isDarkMode={isDarkMode}
                      title={imgc.cameraControlAspectTitle}
                      minWidthPx={96}
                      menuPlacement="up"
                    />
                    <PanelOptionDropdown
                      value={
                        cameraGenResolutionOptions.some((o) => o.value === cameraGenResolution)
                          ? cameraGenResolution
                          : cameraGenResolutionOptions[0]?.value || '1k'
                      }
                      options={cameraGenResolutionOptions}
                      onChange={setCameraGenResolution}
                      isDarkMode={isDarkMode}
                      title={imgc.cameraControlResolutionTitle}
                      minWidthPx={72}
                      menuPlacement="up"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <PanelOptionDropdown
                        value={
                          cameraGenModelOptions.some((o) => o.value === cameraGenModel)
                            ? cameraGenModel
                            : cameraGenModelOptions[0]?.value || DEFAULT_IMAGE_MODEL
                        }
                        options={cameraGenModelOptions}
                        onChange={(v) => setCameraGenModel(v)}
                        isDarkMode={isDarkMode}
                        title={imgc.cameraControlModelTitle}
                        minWidthPx={120}
                        menuPlacement="up"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCameraGenerate()}
                      disabled={cameraAiStatus === 'PROCESSING' || !cameraSourceImageUrl}
                      className={`flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 transition-colors ${
                        cameraAiStatus === 'PROCESSING' || !cameraSourceImageUrl
                          ? isDarkMode
                            ? 'bg-white/10 text-white/30 cursor-not-allowed'
                            : 'bg-black/10 text-gray-400 cursor-not-allowed'
                          : 'bg-sky-500 text-white hover:bg-sky-400'
                      }`}
                      title={
                        cameraGenPriceLabel
                          ? `${imgc.cameraGenerateAria} · ${cameraGenPriceLabel}`
                          : imgc.cameraGenerateAria
                      }
                      aria-label={imgc.cameraGenerateAria}
                    >
                      {cameraAiStatus === 'PROCESSING' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          {cameraGenPriceLabel ? (
                            <span className="text-[11px] font-semibold tabular-nums whitespace-nowrap">
                              {cameraGenPriceLabel}
                            </span>
                          ) : null}
                          <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </>,
          document.body
        )}

        </>
        )}

      {/* 确认栏紧贴放大后图像下沿 */}
      {showCropModal && cropSourceUrl ? (
        <div
          className="nodrag nopan pointer-events-auto absolute left-0 right-0 top-full z-[70] mt-1 flex justify-center"
          style={{
            transform: `scale(${zoomInv})`,
            transformOrigin: 'top center',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className={`inline-flex items-center gap-1.5 rounded-xl border px-2 py-1.5 shadow-lg backdrop-blur-md ${
              isDarkMode ? 'border-white/15 bg-black/75' : 'border-gray-200 bg-white/95'
            }`}
          >
            <button
              type="button"
              disabled={cropBusy}
              onClick={(e) => {
                e.stopPropagation();
                if (cropBusy) return;
                closeCropSession();
              }}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
                isDarkMode
                  ? 'border border-white/10 bg-white/10 text-white/90 hover:bg-white/15'
                  : 'border border-gray-200 bg-gray-100 text-gray-800 hover:bg-gray-200'
              }`}
            >
              <X className="h-3.5 w-3.5" />
              {imgc.cropCancel}
            </button>
            <button
              type="button"
              disabled={cropBusy}
              onClick={(e) => {
                e.stopPropagation();
                cropOverlayRef.current?.confirm();
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
            >
              {cropBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {cropBusy ? imgc.cropConfirming : imgc.cropConfirm}
            </button>
          </div>
        </div>
      ) : null}

      {/* 对齐 LLM：控制栏挂在图像模块正下方，随节点平移/缩放 */}
      {showImagePromptPanel && imagePromptAnchor && (
        <div
          className="image-text-prompt-panel nodrag nopan absolute z-[60]"
          style={{
            top: 'calc(100% + 14px)',
            left: '50%',
            width: imagePromptAnchor.width,
            height: imagePromptAnchor.height === 'auto' ? 'auto' : imagePromptAnchor.height,
            transform: `translateX(-50%) scale(${zoomInv})`,
            transformOrigin: 'top center',
            pointerEvents: 'auto',
            transition: 'none',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {imagePromptAnchor.panel}
        </div>
      )}
      </div>
    </>
  );
};

export const ImageNode = memo(ImageNodeComponent, (prevProps, nextProps) => {
  return (
    prevProps.id === nextProps.id &&
    prevProps.selected === nextProps.selected &&
    prevProps.dragging === nextProps.dragging &&
    prevProps.xPos === nextProps.xPos &&
    prevProps.yPos === nextProps.yPos &&
    prevProps.isDarkMode === nextProps.isDarkMode &&
    prevProps.performanceMode === nextProps.performanceMode &&
    prevProps.prefetchScreenFactor === nextProps.prefetchScreenFactor &&
    prevProps.data?.outputImage === nextProps.data?.outputImage &&
    JSON.stringify(prevProps.data?.outputImages || []) === JSON.stringify(nextProps.data?.outputImages || []) &&
    JSON.stringify(prevProps.data?.inputImages || []) === JSON.stringify(nextProps.data?.inputImages || []) &&
    prevProps.data?.originalImageUrl === nextProps.data?.originalImageUrl &&
    prevProps.data?.width === nextProps.data?.width &&
    prevProps.data?.height === nextProps.data?.height &&
    prevProps.data?.title === nextProps.data?.title &&
    prevProps.data?.progress === nextProps.data?.progress &&
    prevProps.data?.progressMessage === nextProps.data?.progressMessage &&
    prevProps.data?.errorMessage === nextProps.data?.errorMessage &&
    prevProps.data?.avgColorHex === nextProps.data?.avgColorHex &&
    prevProps.data?.tinyThumbUrl === nextProps.data?.tinyThumbUrl &&
    prevProps.data?.imageAsset?.preview === nextProps.data?.imageAsset?.preview &&
    prevProps.data?.imageAsset?.original === nextProps.data?.imageAsset?.original &&
    prevProps.data?.imageAsset?.tiny === nextProps.data?.imageAsset?.tiny &&
    prevProps.data?.imageAsset?.ghost === nextProps.data?.imageAsset?.ghost &&
    prevProps.data?.imageAsset?.avgColorHex === nextProps.data?.imageAsset?.avgColorHex &&
    prevProps.data?.imageAsset?.width === nextProps.data?.imageAsset?.width &&
    prevProps.data?.imageAsset?.height === nextProps.data?.imageAsset?.height &&
    prevProps.data?.viewMode === nextProps.data?.viewMode &&
    prevProps.data?.sceneDisplay3dUrl === nextProps.data?.sceneDisplay3dUrl
  );
});
ImageNode.displayName = 'ImageNode';
