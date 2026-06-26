import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo, startTransition } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, Node, useReactFlow, useViewport, useStore, useUpdateNodeInternals } from 'reactflow';
import { motion } from 'framer-motion';
import {
  Upload,
  Loader2,
  Scissors,
  Eraser,
  RotateCcw,
  Cuboid,
  X,
  Image as ImageIcon,
  ZoomIn,
  PenTool,
  Download,
  Sparkles,
  Globe,
  LayoutGrid,
  ChevronDown,
  FlipHorizontal2,
  FlipVertical2,
} from 'lucide-react';
import { ModuleProgressBar } from './ModuleProgressBar';
import { mapProjectPath } from '../../utils/pathMapper';
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
import CubeCameraController, { CameraControlValue } from './CubeCameraController';
import {
  getPhotographyPrompt,
  DEFAULT_CAMERA_VALUE,
  SCALE_CLOSEUP,
  SCALE_MEDIUM,
  SCALE_WIDE,
  CAMERA_PRESETS,
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
  getCharacterMultiAngleDisplayPrice,
} from '../../utils/cloudModelPricing';
import {
  userFacingErrorMessage,
  refundHintForLocale,
  messageContainsRefundHint,
} from '../../utils/userErrorMessageCn';
import { nodeFloatPillBtn } from '../../utils/assetLibraryChrome';
import { scratchTintClass } from '../../theme/scratchColors';

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
}

interface ImageNodeProps extends NodeProps<ImageNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
  prefetchScreenFactor?: number;
  projectId?: string; // 项目ID，用于路径映射
  /** 抠图/去水印完成后回调，用于将结果加入任务列表 */
  onAuxImageTaskComplete?: (params: { nodeId: string; type: 'matting' | 'watermark' | 'multi-angle'; imageUrl: string; imageUrls?: string[] }) => void;
  onPreviewImage?: (url: string, nodeId?: string) => void;
  /** 画板：在画板工具中打开当前图片进行绘图标记 */
  onOpenDrawingBoard?: (url: string, nodeId: string, localPath?: string) => void;
  /** VR 全景 + 3D 道具摆放：独立弹窗，输出写入当前图片节点 */
  onOpenPanoramaPlacement?: (params: {
    nodeId: string;
    imageUrl: string;
    localPath?: string;
    pixelWidth?: number;
    pixelHeight?: number;
  }) => void;
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

  // 上游图片/角色连线传入的参考图：主模块不展示
  if (hasIncomingImageSource) return '';

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

function getNineScreenRectsFromObjectContain(
  containerEl: HTMLElement | null,
  naturalW: number,
  naturalH: number,
): { left: number; top: number; width: number; height: number }[] {
  if (!containerEl || naturalW < 3 || naturalH < 3) return [];
  const c = containerEl.getBoundingClientRect();
  const content = getObjectContainContentRect(c, naturalW, naturalH);
  const out: { left: number; top: number; width: number; height: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    out.push({
      left: content.left + (col * content.width) / 3,
      top: content.top + (row * content.height) / 3,
      width: content.width / 3,
      height: content.height / 3,
    });
  }
  return out;
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
  if (!containerEl || naturalW < 2 || naturalH < 2) return [];
  const c = containerEl.getBoundingClientRect();
  const content = getObjectContainContentRect(c, naturalW, naturalH);
  const out: { left: number; top: number; width: number; height: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    out.push({
      left: content.left + (col * content.width) / 2,
      top: content.top + (row * content.height) / 2,
      width: content.width / 2,
      height: content.height / 2,
    });
  }
  return out;
}

async function cropFourTilesToPngBuffers(img: HTMLImageElement): Promise<{ sw: number; sh: number; buffers: ArrayBuffer[] }> {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const halfW = nw / 2;
  const halfH = nh / 2;
  const buffers: ArrayBuffer[] = [];
  for (let i = 0; i < 4; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const sx = Math.round(col * halfW);
    const sy = Math.round(row * halfH);
    const sx2 = Math.round((col + 1) * halfW);
    const sy2 = Math.round((row + 1) * halfH);
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
  return { sw: Math.round(halfW), sh: Math.round(halfH), buffers };
}

function detectMultiAngleCompositeGrid(
  nw: number,
  nh: number,
): { cols: number; rows: number } | null {
  if (nw < 256 || nh < 256) return null;
  if (nw % 3 === 0 && nh % 4 === 0) return { cols: 3, rows: 4 };
  if (nw % 4 === 0 && nh % 3 === 0) return { cols: 4, rows: 3 };
  if (nw % 3 === 0 && nh % 3 === 0 && (nw / 3) * (nh / 3) >= 9) return { cols: 3, rows: 3 };
  return null;
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

/** 人物多角度若返回单张拼图，按 3×4 / 4×3 / 3×3 自动拆成多张本地图 */
async function expandMultiAngleCompositeIfNeeded(
  singleUrl: string,
  nodeData: ImageNodeData | undefined,
  projectId: string | undefined,
): Promise<string[] | null> {
  if (!window.electronAPI?.createImageLocalResourceFromBuffer) return null;
  let img: HTMLImageElement;
  try {
    img = await loadImageForCanvasDecode(singleUrl, nodeData);
  } catch {
    return null;
  }
  const grid = detectMultiAngleCompositeGrid(img.naturalWidth, img.naturalHeight);
  if (!grid) return null;
  const total = grid.cols * grid.rows;
  if (total < 4) return null;
  let buffers: ArrayBuffer[];
  try {
    buffers = await cropGridToPngBuffers(img, grid.cols, grid.rows);
  } catch {
    return null;
  }
  const ts = Date.now();
  const urls: string[] = [];
  for (let i = 0; i < buffers.length; i++) {
    const result = await window.electronAPI.createImageLocalResourceFromBuffer(
      projectId ?? undefined,
      `multi-angle-${ts}-${i + 1}.png`,
      buffers[i],
    );
    const u = formatImagePath(result.previewUrl);
    if (u) urls.push(u);
  }
  return urls.length >= 2 ? urls : null;
}

async function cropNineTilesToPngBuffers(img: HTMLImageElement): Promise<{ sw: number; sh: number; buffers: ArrayBuffer[] }> {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const thirdW = nw / 3;
  const thirdH = nh / 3;
  const buffers: ArrayBuffer[] = [];
  for (let i = 0; i < 9; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const sx = Math.round(col * thirdW);
    const sy = Math.round(row * thirdH);
    const sx2 = Math.round((col + 1) * thirdW);
    const sy2 = Math.round((row + 1) * thirdH);
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
  return { sw: Math.round(thirdW), sh: Math.round(thirdH), buffers };
}

type GridSplitMode = 'four' | 'nine';

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
    onOpenPanoramaPlacement,
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
  const { setNodes, getNodes, getEdges, flowToScreenPosition } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const hasIncomingImageSource = useStore(
    useCallback(
      (state: { edges: { target: string; source: string }[]; nodeInternals: Map<string, { type?: unknown }> }) => {
        for (const edge of state.edges) {
          if (edge.target !== id) continue;
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
  const MIN_NODE_WIDTH = 369.46;
  const MIN_NODE_HEIGHT = 211.12;
  const MAX_NODE_WIDTH = 2048;
  const MAX_NODE_HEIGHT = 2048;
  const clampW = (v: number) => Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, v));
  const clampH = (v: number) => Math.max(MIN_NODE_HEIGHT, Math.min(MAX_NODE_HEIGHT, v));
  const computeAdaptiveNodeSize = useCallback((mediaW?: number, mediaH?: number) => {
    if (!mediaW || !mediaH || mediaW <= 0 || mediaH <= 0) {
      return { w: MIN_NODE_WIDTH, h: MIN_NODE_HEIGHT };
    }
    const scale = Math.max(MIN_NODE_WIDTH / mediaW, MIN_NODE_HEIGHT / mediaH);
    return {
      w: clampW(Math.round(mediaW * scale)),
      h: clampH(Math.round(mediaH * scale)),
    };
  }, []);

  const [size, setSize] = useState({
    w: clampW(data?.width ?? MIN_NODE_WIDTH),
    h: clampH(data?.height ?? MIN_NODE_HEIGHT),
  });

  useEffect(() => {
    const raf = requestAnimationFrame(() => updateNodeInternals(id));
    return () => cancelAnimationFrame(raf);
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
  const [errorMessage, setErrorMessage] = useState(data?.errorMessage || '');
  const [isMattingLoading, setIsMattingLoading] = useState(false);
  const [isWatermarkRemovalLoading, setIsWatermarkRemovalLoading] = useState(false);
  const [isMultiAngleLoading, setIsMultiAngleLoading] = useState(false);
  const [showAllOutputImages, setShowAllOutputImages] = useState(false);
  const [nineSplitAnim, setNineSplitAnim] = useState<NineSplitAnimState | null>(null);
  const nineSplitPayloadRef = useRef<NineSplitPayload | null>(null);
  const [isSplitNineBusy, setIsSplitNineBusy] = useState(false);
  const [mattingPriceHover, setMattingPriceHover] = useState(false);
  const [splitGridMenuHover, setSplitGridMenuHover] = useState(false);
  const [flipMenuHover, setFlipMenuHover] = useState(false);
  const flipMenuLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 预览翻转：先写 DOM，再低优先级持久化，避免 setNodes 卡住主线程 */
  const flipLiveRef = useRef({ h: !!data?.flipH, v: !!data?.flipV });
  const [watermarkPriceHover, setWatermarkPriceHover] = useState(false);
  const [multiAnglePriceHover, setMultiAnglePriceHover] = useState(false);
  /** 3D 视角控制器弹窗：仅选中时显示，未选中时收起 */
  const [is3DPopoverOpen, setIs3DPopoverOpen] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState<boolean | null>(null);
  const threeDTriggerRef = useRef<HTMLButtonElement>(null);
  const [threeDPopoverPosition, setThreeDPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  /** 打开 3D 弹窗时的基础提示词，调整时用「基础 + 最新相机指令」替换，避免不断累加 */
  const basePromptFor3DRef = useRef<string | null>(null);

  const nodeRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
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
  /** 拖出到桌面/资源管理器：pointerdown 起在主进程准备路径，dragstart 内发起原生拖出 */
  const nativeDragPreparePromiseRef = useRef<Promise<string | null> | null>(null);
  const nativeDragPreparedPathRef = useRef<string | null>(null);
  const viewport = useViewport();
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
  const imageLoadFailPlaceholder = useMemo(
    () =>
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#ccc" width="100" height="100"/><text x="50" y="50" text-anchor="middle" dy=".3em" fill="#999">${imgc.imageLoadFailedShort.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`
      ),
    [imgc.imageLoadFailedShort]
  );
  const { cloudMap } = useNxModelPricing();
  const mattingDisplayYuanbao = useMemo(() => getMattingDisplayPrice(cloudMap), [cloudMap]);
  const watermarkDisplayYuanbao = useMemo(() => getWatermarkRemovalDisplayPrice(cloudMap), [cloudMap]);
  const multiAngleDisplayYuanbao = useMemo(() => getCharacterMultiAngleDisplayPrice(cloudMap), [cloudMap]);
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

  // 同步外部数据变化
  useEffect(() => {
    if (typeof data?.width === 'number' && data.width > 0 && typeof data?.height === 'number' && data.height > 0) {
      const nextW = clampW(data.width);
      const nextH = clampH(data.height);
      setSize((prev) => (prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH }));
      if (nodeRef.current) {
        nodeRef.current.style.width = `${nextW}px`;
        nodeRef.current.style.height = `${nextH}px`;
      }
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
  }, [data?.width, data?.height, data?.outputImage, data?.outputImages, data?.originalImageUrl, data?.title, data?.progress, data?.progressMessage, data?.errorMessage, outputImage]);

  // Image 未被选中时收起 3D 弹窗
  useEffect(() => {
    if (!selected) {
      setIs3DPopoverOpen(false);
    }
  }, [selected]);

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

  // 3D 弹窗定位：在 Image 节点下方，相对整个 Image 节点水平居中
  const POPOVER_WIDTH = 440;
  const updateThreeDPopoverPosition = useCallback(() => {
    if (!is3DPopoverOpen || !nodeRef.current) return;
    const nodeRect = nodeRef.current.getBoundingClientRect();
    // 以 Image 节点中心水平居中
    const centerLeft = nodeRect.left + nodeRect.width / 2 - POPOVER_WIDTH / 2;
    const left = Math.max(8, Math.min(centerLeft, window.innerWidth - POPOVER_WIDTH - 8));
    setThreeDPopoverPosition({ left, top: nodeRect.bottom + 8 });
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

  /* 3D 弹窗：Image 取消选中时自动关闭；点击画布空白处（onPaneClick）或其它节点也关闭；或通过右上角 X 关闭 */
  useEffect(() => {
    const onClose = () => {
      setIs3DPopoverOpen(false);
    };
    window.addEventListener('nexflow-close-3d-popover', onClose);
    return () => window.removeEventListener('nexflow-close-3d-popover', onClose);
  }, []);
  useEffect(() => {
    if (!is3DPopoverOpen) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const popover = document.getElementById(`image-3d-popover-${id}`);
      const trigger = threeDTriggerRef.current;
      if (popover?.contains(target) || trigger?.contains(target)) return;
      const pane = target?.closest('.react-flow__pane');
      const viewportEl = target?.closest('.react-flow__viewport');
      const otherNode = target?.closest('.react-flow__node');
      const isOurNode = nodeRef.current?.contains(target);
      if (pane || (viewportEl && !otherNode) || (otherNode && !isOurNode)) setIs3DPopoverOpen(false);
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
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

  const handleOutputImageDragStart = useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation();
      void (async () => {
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
        if (fp) window.electronAPI.startNativeFileDrag(fp);
      })();
    },
    [dragOutFileSourceUrl, projectId, title],
  );

  const handleSplitGridToCanvas = useCallback(
    async (mode: GridSplitMode, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (nineSplitAnim || isSplitNineBusy) return;

      const cells = mode === 'four' ? 4 : 9;
      const flowCols = mode === 'four' ? 2 : 3;
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
          const gridLayout = getOutputImageGridLayout(outputImages.length);
          const domCols = mode === 'four' ? 2 : gridLayout.cols;
          const domRows = mode === 'four' ? 2 : gridLayout.rows;
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

          if (mode === 'four') {
            if (nw < 2 || nh < 2) {
              showAlert(imgc.splitNineCropFailed);
              return;
            }
            const fromRects = getFourScreenRectsFromObjectContain(imgContainerRef.current, nw, nh);
            if (fromRects.length !== 4) {
              showAlert(imgc.splitNineCropFailed);
              return;
            }
            let buffers: ArrayBuffer[];
            let sw0: number;
            let sh0: number;
            try {
              const cropped = await cropFourTilesToPngBuffers(imgBitmap);
              buffers = cropped.buffers;
              sw0 = cropped.sw;
              sh0 = cropped.sh;
            } catch (err) {
              console.error('[ImageNode] four-split crop', err);
              showAlert(userFacingErrorMessage(err instanceof Error ? err.message : imgc.splitNineCropFailed, locale));
              return;
            }
            const adapted = computeAdaptiveNodeSize(sw0, sh0);
            splitW = adapted.w;
            splitH = adapted.h;
            const ft = makeFlowAndTo(4, splitW, splitH, 2);
            flowPositions = ft.flowPositions;
            to = ft.toRects;
            from = fromRects;
            const ts = Date.now();
            const results: {
              previewUrl: string;
              originalUrl: string;
              tinyUrl?: string;
              originalPath?: string;
              avgColorHex?: string;
              width?: number;
              height?: number;
            }[] = [];
            for (let i = 0; i < 4; i++) {
              const result = await window.electronAPI.createImageLocalResourceFromBuffer(
                projectId ?? undefined,
                `four-grid-${ts}-${i}.png`,
                buffers[i],
              );
              results.push(result);
            }
            urls = results.map((r) => formatImagePath(r.previewUrl)).filter(Boolean);
            if (urls.length !== 4) {
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
          } else {
            if (nw < 3 || nh < 3) {
              showAlert(imgc.splitNineCropFailed);
              return;
            }
            const fromRects = getNineScreenRectsFromObjectContain(imgContainerRef.current, nw, nh);
            if (fromRects.length !== 9) {
              showAlert(imgc.splitNineCropFailed);
              return;
            }
            let buffers: ArrayBuffer[];
            let sw0: number;
            let sh0: number;
            try {
              const cropped = await cropNineTilesToPngBuffers(imgBitmap);
              buffers = cropped.buffers;
              sw0 = cropped.sw;
              sh0 = cropped.sh;
            } catch (err) {
              console.error('[ImageNode] nine-split crop', err);
              showAlert(userFacingErrorMessage(err instanceof Error ? err.message : imgc.splitNineCropFailed, locale));
              return;
            }
            const adapted = computeAdaptiveNodeSize(sw0, sh0);
            splitW = adapted.w;
            splitH = adapted.h;
            const ft = makeFlowAndTo(9, splitW, splitH, 3);
            flowPositions = ft.flowPositions;
            to = ft.toRects;
            from = fromRects;
            const ts = Date.now();
            const results: {
              previewUrl: string;
              originalUrl: string;
              tinyUrl?: string;
              originalPath?: string;
              avgColorHex?: string;
              width?: number;
              height?: number;
            }[] = [];
            for (let i = 0; i < 9; i++) {
              const result = await window.electronAPI.createImageLocalResourceFromBuffer(
                projectId ?? undefined,
                `nine-split-${ts}-${i}.png`,
                buffers[i],
              );
              results.push(result);
            }
            urls = results.map((r) => formatImagePath(r.previewUrl)).filter(Boolean);
            if (urls.length !== 9) {
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
        }

        const n = urls.length;
        const d = data as any;
        nineSplitPayloadRef.current = {
          urls,
          flowPositions,
          splitW,
          splitH,
          labels: urls.map((_, i) =>
            mode === 'four' ? imgc.splitFourNodeLabel(i) : imgc.splitNineNodeLabel(i),
          ),
          resolution: data?.resolution ?? '1k',
          aspectRatio: data?.aspectRatio ?? '9:16',
          model: data?.model ?? 'banana-2.0',
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
            minWidth: `${MIN_NODE_WIDTH}px`,
            minHeight: `${MIN_NODE_HEIGHT}px`,
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
    minWidth: `${MIN_NODE_WIDTH}px`,
    minHeight: `${MIN_NODE_HEIGHT}px`,
    userSelect: isResizing ? 'none' : 'auto',
    willChange: isResizing ? 'transform, width, height' : dragging ? 'transform' : 'auto',
    backfaceVisibility: isResizing ? 'hidden' : 'visible',
    transition: isResizing ? 'none' : 'background-color 0.2s, border-color 0.2s',
  };
  const combinedStyle: React.CSSProperties = baseStyle;

  const zoom = viewport.zoom ?? 1;
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

  /** 当前主图像素尺寸，用于全景摆放入口判断与弹窗内分辨率展示 */
  const [imageNaturalPx, setImageNaturalPx] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    setImageNaturalPx(null);
  }, [primaryOutputImage]);
  /** 与画板并列；任意比例图均可打开（球幕内为等距柱状投影时观感最佳） */
  const showPanoramaPlacementEntry = useMemo(
    () => !!(onOpenPanoramaPlacement && primaryOutputImage),
    [onOpenPanoramaPlacement, primaryOutputImage]
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
    applyFlipToPreview();
  }, [data?.flipH, data?.flipV, applyFlipToPreview]);

  useLayoutEffect(() => {
    applyFlipToPreview();
  }, [primaryOutputImage, applyFlipToPreview]);

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
    }, 160);
  }, []);

  useEffect(
    () => () => {
      if (flipMenuLeaveTimerRef.current != null) clearTimeout(flipMenuLeaveTimerRef.current);
    },
    [],
  );
  const resolvedAvgColor = data?.imageAsset?.avgColorHex || data?.avgColorHex || '';
  const hasAvgColor = !!resolvedAvgColor;
  const skeletonColor = resolvedAvgColor || '#6b7280';
  const isUserResized = Boolean((data as any)?.isUserResized);
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
      const primarySrc = await resolveImageSrcForElectronDisplay(primaryPath, projectId);
      const previewSrc = previewImagePath ? await resolveImageSrcForElectronDisplay(previewImagePath, projectId) : '';
      if (cancelled) return;
      const src = primarySrc;
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
        } ${isResizing ? '!shadow-none !ring-0' : ''} transition-all duration-200`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Handle 必须始终渲染，否则连线会断；有图片时输出 Handle 始终可见便于连接 */}
        <Handle type="target" position={Position.Left} id="image-input" className={`nexflow-plus-handle nexflow-plus-handle-left ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''}`} />
        <Handle type="source" position={Position.Right} id="output" style={{ top: '50%', right: 0 }} className={`nexflow-plus-handle nexflow-plus-handle-right ${showPlaceholder ? 'opacity-0 pointer-events-none' : ''}`} />
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
        {/* 左上角标题区域（在文本框外部，节点边框外）；选中时缩小画布也显示 */}
        {(showDetailedUi || selected) && <div className="title-area absolute -top-7 left-0 z-10">
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
              className={`bg-transparent outline-none font-bold text-xs ${
                isDarkMode ? 'text-white/80' : 'text-gray-900'
              }`}
              style={{ 
                caretColor: isDarkMode ? '#0A84FF' : '#22c55e',
                minWidth: '40px',
                maxWidth: '120px',
              }}
              title={imgc.editTitle}
              autoFocus
            />
          ) : (
            <span
              onClick={handleTitleDoubleClick}
              className={`font-bold text-xs cursor-pointer select-none ${
                isDarkMode ? 'text-white/80' : 'text-gray-900'
              } hover:opacity-70 transition-opacity`}
            >
              {title || 'image'}
            </span>
          )}
        </div>}

        {/* 全模块覆盖进度条（生成中时纯色遮罩，不显示其他内容） */}
        <ModuleProgressBar
          visible={progress > 0}
          progress={progress}
          solidBackground={isDarkMode ? '#1C1C1E' : '#f5f5f5'}
          progressMessage={progress > 0 ? (progressMessage || wc.progressImage) : undefined}
          borderRadius={16}
          onFadeComplete={() => updateNodeData({ progress: 0 })}
        />

        {/* 抠图/去水印进度条（覆盖整个模块，带循环动画） */}
        <ModuleProgressBar
          visible={isMattingLoading || isWatermarkRemovalLoading || isMultiAngleLoading}
          progress={0}
          solidBackground={isDarkMode ? '#1C1C1E' : '#f5f5f5'}
          progressMessage={
            isMattingLoading
              ? imgc.mattingProgress(String(mattingDisplayYuanbao))
              : isWatermarkRemovalLoading
                ? imgc.watermarkProgress(String(watermarkDisplayYuanbao))
                : isMultiAngleLoading
                  ? imgc.multiAngleProgress(String(multiAngleDisplayYuanbao))
                  : undefined
          }
          borderRadius={16}
        />

        {/* 模块内右上角图片上传按钮；选中时缩小画布也显示 */}
        {selected && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              aria-label={imgc.uploadImageTitle}
              onChange={handleFileChange}
              onClick={(e) => {
                // 确保点击事件不会冒泡到 React Flow
                e.stopPropagation();
              }}
              className="hidden"
              style={{ display: 'none' }}
            />
            <button
              onClick={handleUploadImage}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              className={`nodrag absolute top-2 right-2 p-1.5 rounded-lg transition-all z-10 ${
                isDarkMode 
                  ? 'apple-panel hover:bg-white/20' 
                  : 'apple-panel-light hover:bg-gray-200/30'
              }`}
              title={imgc.uploadImageTitle}
              style={{ pointerEvents: 'all' }}
              type="button"
            >
              <Upload className={`w-3.5 h-3.5 ${
                isDarkMode ? 'text-white/80' : 'text-gray-700'
              }`} />
            </button>
          </>
        )}

        {/* 左上角下载与放大预览按钮；选中或悬停时缩小画布也显示 */}
        {primaryOutputImage && (selected || isHovered) && (
          <div className="nodrag absolute top-2 left-2 flex items-center gap-1 z-10" style={{ pointerEvents: 'all' }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadImage();
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              className={`p-1.5 rounded-lg transition-all ${
                isDarkMode
                  ? 'apple-panel hover:bg-white/20'
                  : 'apple-panel-light hover:bg-gray-200/30'
              }`}
              title={imgc.downloadTitle}
              aria-label={imgc.downloadTitle}
            >
              <Download className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const previewSrc = getImageDisplaySrc(formatImagePath(previewImagePath || primaryOutputImage || tinyImagePath));
                if (!previewSrc) return;
                if (onPreviewImage) {
                  onPreviewImage(previewSrc, id);
                  return;
                }
                window.open(previewSrc, '_blank', 'noopener,noreferrer');
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              className={`p-1.5 rounded-lg transition-all ${
                isDarkMode
                  ? 'apple-panel hover:bg-white/20'
                  : 'apple-panel-light hover:bg-gray-200/30'
              }`}
              title={imgc.zoomPreviewTitle}
              aria-label={imgc.zoomPreviewTitle}
            >
              <ZoomIn className={`w-3.5 h-3.5 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
            </button>
          </div>
        )}

        {/* 画板按钮：选中时显示，点击后在画板工具中打开图片进行绘图标记 */}
        {selected && primaryOutputImage && (
          <div
            className="nodrag nopan absolute -top-14 left-0 right-0 flex justify-center gap-2 z-10"
            style={{ pointerEvents: 'all' }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const baseSrc = getImageDisplaySrc(formatImagePath(previewImagePath || primaryOutputImage || tinyImagePath));
                if (!baseSrc) return;
                // data URL 不能加 query，否则格式被破坏导致画板无法加载（视频提取的第一帧/最后一帧为 data URL）
                const urlForBoard = baseSrc.startsWith('data:') ? baseSrc : `${baseSrc}${baseSrc.includes('?') ? '&' : '?'}_t=${Date.now()}`;
                if (onOpenDrawingBoard) {
                  onOpenDrawingBoard(urlForBoard, id, data?.localPath);
                } else if (onPreviewImage) {
                  onPreviewImage(baseSrc, id);
                } else {
                  window.open(baseSrc, '_blank', 'noopener,noreferrer');
                }
              }}
              className={
                isDarkMode
                  ? 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 text-white'
                  : nodeFloatPillBtn(isDarkMode, 'gap-1.5 px-3 py-1.5', 'looks')
              }
              title={imgc.drawingBoardTitle}
              aria-label={imgc.drawingBoardAria}
            >
              <PenTool className="w-4 h-4" />
              {imgc.drawingBoardButton}
            </button>
            <div
              className="relative inline-flex flex-col items-stretch nodrag nopan"
              onMouseEnter={openFlipMenu}
              onMouseLeave={scheduleCloseFlipMenu}
            >
              <div
                className={`flex cursor-default items-center gap-0.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all select-none ${
                  isDarkMode
                    ? `bg-white/15 text-white ${
                        flipHUi || flipVUi
                          ? 'ring-1 ring-violet-400/50 bg-violet-500/20'
                          : flipMenuHover
                            ? 'ring-1 ring-white/30'
                            : ''
                      }`
                    : `scratch-float-btn ${scratchTintClass('variables')} gap-0.5 px-3 py-1.5 ${
                        flipHUi || flipVUi ? 'ring-2 ring-offset-1 ring-gray-900/20' : ''
                      } ${flipMenuHover && !(flipHUi || flipVUi) ? 'ring-2 ring-offset-1 ring-gray-900/10' : ''}`
                }`}
                title={imgc.flipMenuHoverHint}
                role="group"
                aria-label={imgc.flipMenuHoverHint}
              >
                <FlipHorizontal2 className="w-4 h-4 shrink-0 opacity-90" aria-hidden />
                <span>{imgc.flipButton}</span>
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
            {showPanoramaPlacementEntry && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const scene3dSrc =
                    typeof data?.sceneDisplay3dUrl === 'string' ? data.sceneDisplay3dUrl.trim() : '';
                  const flatSrc = getImageDisplaySrc(
                    formatImagePath(previewImagePath || primaryOutputImage || tinyImagePath),
                  );
                  const baseSrc = scene3dSrc || flatSrc;
                  if (!baseSrc || !onOpenPanoramaPlacement) return;
                  const urlForPanel = baseSrc.startsWith('data:') ? baseSrc : `${baseSrc}${baseSrc.includes('?') ? '&' : '?'}_t=${Date.now()}`;
                  const nw = imgRef.current?.naturalWidth ?? imageNaturalPx?.w;
                  const nh = imgRef.current?.naturalHeight ?? imageNaturalPx?.h;
                  onOpenPanoramaPlacement({
                    nodeId: id,
                    imageUrl: urlForPanel,
                    localPath: data?.localPath,
                    pixelWidth: nw,
                    pixelHeight: nh,
                  });
                }}
                className={
                  isDarkMode
                    ? `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/15 hover:bg-white/25 text-white`
                    : nodeFloatPillBtn(isDarkMode, 'gap-1.5 px-3 py-1.5', 'sensing')
                }
                title={imgc.panoramaPlacementTitle}
                aria-label={imgc.panoramaPlacementAria}
              >
                <Globe className="w-4 h-4" />
                {imgc.panoramaPlacementButton}
              </button>
            )}
          </div>
        )}

        {/* 图片内容显示区域：运行中由全模块进度条遮罩覆盖，再显示结果/错误/占位；缩放时隐藏高清图仅显示轮廓以提升性能 */}
        <div className={`custom-scrollbar relative w-full h-full flex flex-col items-center overflow-auto min-h-0 ${hasRenderableImage ? 'p-0' : 'p-2'}`}>
          {primaryOutputImage ? (
            <>
              <div
                ref={imgContainerRef}
                className="relative flex items-center justify-center min-w-0 min-h-0 flex-1 w-full h-full"
                style={{
                  ...(hideImageLayerInPrefetch ? { visibility: 'hidden', pointerEvents: 'none' as const } : {}),
                }}
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
                onPointerDown={beginNativeDragPrepare}
                onDragStart={handleOutputImageDragStart}
                title={
                  outputImages.length <= 1 &&
                  !!dragOutFileSourceUrl &&
                  !dragOutFileSourceUrl.startsWith('blob:')
                    ? locale === 'en'
                      ? 'Drag to desktop or a folder to copy the image file'
                      : '拖到桌面或文件夹以复制图片文件'
                    : undefined
                }
                className="absolute inset-0 w-full h-full object-contain rounded-2xl select-none transition-opacity duration-150"
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
                  lastOnLoadSrcRef.current = srcKey;

                  if (fallbackUrl) setFallbackUrl(null);
                  // 始终根据图片比例更新模块尺寸，不受 LOD 影响，确保模块比例符合图片
                  setImageNaturalPx({ w: img.naturalWidth, h: img.naturalHeight });
                  const adapted = computeAdaptiveNodeSize(img.naturalWidth, img.naturalHeight);
                  const lastApplied = lastAppliedSizeRef.current;
                  const alreadyApplied =
                    !!lastApplied &&
                    lastApplied.srcKey === srcKey &&
                    lastApplied.w === adapted.w &&
                    lastApplied.h === adapted.h;
                  if (!alreadyApplied) {
                    lastAppliedSizeRef.current = { srcKey, w: adapted.w, h: adapted.h };
                    setSize((prev) => (prev.w === adapted.w && prev.h === adapted.h ? prev : adapted));
                    updateNodeData({ width: adapted.w, height: adapted.h });
                  }
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
                });
                
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
                  className="absolute inset-0 w-full h-full object-contain rounded-2xl select-none pointer-events-none transition-opacity duration-150"
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
              ) : (
                <div className={`w-full h-full min-h-[80px] rounded-lg flex items-center justify-center text-xs ${isDarkMode ? 'bg-white/10 text-white/50' : 'bg-black/10 text-gray-500'}`}>
                  {wc.viewportPausedLoad}
                </div>
              )}
              </>
              )}
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

        {/* 抠图/去水印/3D视角：在 image 框外（下方），选中时显示；抠图/去水印作用于输出图或输入图 */}
        {selected && (
          <div
            className="nodrag nopan absolute -bottom-[4.5rem] left-0 right-0 flex flex-wrap justify-center items-end gap-x-2 gap-y-1.5 z-10 overflow-visible pb-0.5"
            style={{ pointerEvents: 'all' }}
          >
            <div
              className="relative inline-flex flex-col items-center"
              onMouseEnter={() => setMattingPriceHover(true)}
              onMouseLeave={() => setMattingPriceHover(false)}
            >
              <button
              type="button"
              disabled={isMattingLoading || isWatermarkRemovalLoading || isMultiAngleLoading}
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (isMattingLoading || isWatermarkRemovalLoading || isMultiAngleLoading) return;
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
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all text-white ${
                isMattingLoading
                  ? 'bg-blue-500/70 cursor-not-allowed opacity-80'
                  : 'bg-blue-500 hover:bg-blue-600'
              }`}
              title={imgc.mattingTitle}
            >
              {isMattingLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Scissors className="w-3.5 h-3.5" />
              )}
              {imgc.mattingButton}
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
            {primaryOutputImage ? (
              <div
                className="relative inline-flex flex-col items-stretch"
                onMouseEnter={() => setSplitGridMenuHover(true)}
                onMouseLeave={() => setSplitGridMenuHover(false)}
              >
                <div
                  className={`flex items-center gap-0.5 px-2 py-1 rounded-lg text-xs font-medium transition-all text-white select-none ${
                    isMattingLoading ||
                    isWatermarkRemovalLoading ||
                    isMultiAngleLoading ||
                    !!nineSplitAnim ||
                    isSplitNineBusy
                      ? 'bg-indigo-500/70 cursor-not-allowed opacity-80'
                      : 'bg-indigo-600/90 hover:bg-indigo-600 cursor-default'
                  } ${splitGridMenuHover && !isSplitNineBusy ? 'ring-1 ring-white/30' : ''}`}
                  title={imgc.splitGridHoverHint}
                  role="group"
                  aria-label={imgc.splitGridHoverHint}
                >
                  {isSplitNineBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LayoutGrid className="w-3.5 h-3.5" />
                  )}
                  <span>{imgc.splitNineButton}</span>
                  <ChevronDown className="w-3 h-3 shrink-0 opacity-90" aria-hidden />
                </div>
                {splitGridMenuHover &&
                  !isMattingLoading &&
                  !isWatermarkRemovalLoading &&
                  !isMultiAngleLoading &&
                  !nineSplitAnim &&
                  !isSplitNineBusy && (
                    <div
                      className="absolute left-0 top-full z-[60] min-w-[10.5rem] pt-0.5"
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
                            void handleSplitGridToCanvas('nine', ev);
                          }}
                        >
                          {imgc.splitGridMenuNine}
                        </button>
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
              disabled={isMattingLoading || isWatermarkRemovalLoading || isMultiAngleLoading}
              onClick={async (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (isMattingLoading || isWatermarkRemovalLoading || isMultiAngleLoading) return;
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
                  setIsWatermarkRemovalLoading(true);
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
                  setIsWatermarkRemovalLoading(false);
                  setErrorMessage(imgc.needImageFirst);
                  return;
                }
                if (!window.electronAPI?.imageWatermarkRemoval) {
                  setErrorMessage(imgc.watermarkNotSupported);
                  return;
                }
                setIsWatermarkRemovalLoading(true);
                setErrorMessage('');
                try {
                  const result = await window.electronAPI.imageWatermarkRemoval(imageToProcess);
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
                    onAuxImageTaskComplete?.({ nodeId: id, type: 'watermark', imageUrl: newUrl });
                  }
                } catch (err: any) {
                  const msg = err?.message || imgc.watermarkFailedDefault;
                  setErrorMessage(msg);
                  updateNodeData({ errorMessage: msg });
                } finally {
                  setIsWatermarkRemovalLoading(false);
                }
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all text-white ${
                isMattingLoading || isWatermarkRemovalLoading || isMultiAngleLoading
                  ? 'bg-orange-500/70 cursor-not-allowed opacity-80'
                  : 'bg-orange-500 hover:bg-orange-600'
              }`}
              title={imgc.watermarkTitle}
            >
              {isWatermarkRemovalLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Eraser className="w-3.5 h-3.5" />
              )}
              {imgc.watermarkButton}
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
            <div
              className="relative inline-flex flex-col items-center"
              onMouseEnter={() => setMultiAnglePriceHover(true)}
              onMouseLeave={() => setMultiAnglePriceHover(false)}
            >
              <button
                type="button"
                disabled={isMattingLoading || isWatermarkRemovalLoading || isMultiAngleLoading}
                onClick={async (e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (isMattingLoading || isWatermarkRemovalLoading || isMultiAngleLoading) return;
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
                    setIsMultiAngleLoading(true);
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
                    setIsMultiAngleLoading(false);
                    setErrorMessage(imgc.needImageFirst);
                    return;
                  }
                  if (!window.electronAPI?.imageCharacterMultiAngle) {
                    setErrorMessage(imgc.multiAngleNotSupported);
                    return;
                  }
                  setIsMultiAngleLoading(true);
                  setErrorMessage('');
                  try {
                    const result = await window.electronAPI.imageCharacterMultiAngle(imageToProcess);
                    if (result?.success && result.imageUrl) {
                      const newUrl = result.imageUrl;
                      let allUrls = Array.isArray(result.imageUrls) && result.imageUrls.length > 0
                        ? result.imageUrls
                        : [newUrl];
                      if (allUrls.length === 1) {
                        const expanded = await expandMultiAngleCompositeIfNeeded(newUrl, data, projectId);
                        if (expanded && expanded.length > 1) {
                          allUrls = expanded;
                        }
                      }
                      const coverUrl = allUrls[0] || newUrl;
                      setOutputImage(coverUrl);
                      setOutputImages(allUrls);
                      updateNodeData({
                        outputImage: coverUrl,
                        outputImages: allUrls,
                        errorMessage: undefined,
                        imageAsset: buildImageAssetAfterAuxUrl(data?.imageAsset, coverUrl),
                      });
                      onAuxImageTaskComplete?.({
                        nodeId: id,
                        type: 'multi-angle',
                        imageUrl: coverUrl,
                        imageUrls: allUrls,
                      });
                    } else {
                      const msg =
                        (result as { message?: string } | undefined)?.message || imgc.multiAngleFailedDefault;
                      setErrorMessage(msg);
                      updateNodeData({ errorMessage: msg });
                    }
                  } catch (err: any) {
                    const msg = err?.message || imgc.multiAngleFailedDefault;
                    setErrorMessage(msg);
                    updateNodeData({ errorMessage: msg });
                  } finally {
                    setIsMultiAngleLoading(false);
                  }
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all text-white ${
                  isMattingLoading || isWatermarkRemovalLoading || isMultiAngleLoading
                    ? 'bg-violet-500/70 cursor-not-allowed opacity-80'
                    : 'bg-violet-500 hover:bg-violet-600'
                }`}
                title={imgc.multiAngleTitle}
              >
                {isMultiAngleLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {imgc.multiAngleButton}
              </button>
              <span
                className={`absolute left-1/2 top-full z-20 mt-1 w-24 -translate-x-1/2 text-center text-xs font-medium px-2 py-1 rounded shadow-md transition-all duration-200 ease-out ${
                  isDarkMode ? 'text-yellow-200 bg-yellow-900/90 ring-1 ring-yellow-500/35' : 'text-yellow-800 bg-yellow-100 ring-1 ring-yellow-300/60'
                } ${
                  multiAnglePriceHover
                    ? 'pointer-events-none translate-y-0 opacity-100'
                    : 'pointer-events-none translate-y-2 opacity-0'
                }`}
                title={imgc.multiAnglePriceTitle}
              >
                {locale === 'en' ? `${multiAngleDisplayYuanbao} ${imgc.creditsSuffix}` : `${multiAngleDisplayYuanbao}${imgc.creditsSuffix}`}
              </span>
            </div>
            <button
              ref={threeDTriggerRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIs3DPopoverOpen((v) => !v);
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                is3DPopoverOpen
                  ? 'bg-cyan-500 text-white ring-2 ring-cyan-400/60'
                  : 'bg-cyan-600/90 hover:bg-cyan-600 text-white'
              }`}
              title={imgc.perspective3dTitle}
            >
              <Cuboid className="w-3.5 h-3.5" />
              {imgc.perspective3dButton}
            </button>
          </div>
        )}

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

        {/* 3D 视角控制器弹窗：在 Image 下方，仅选中且打开时渲染 */}
        {is3DPopoverOpen && threeDPopoverPosition && createPortal(
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
                        inputImageUrl={
                          getImageDisplaySrc(
                            formatImagePath(currentImageSrc || resolvedDisplaySrc || previewImagePath || primaryOutputImage || ''),
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
                </div>
                <button
                  type="button"
                  onClick={() => persistCameraValue(normalizeCameraValue(DEFAULT_CAMERA_VALUE))}
                  className={`flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-xs ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-black/10 hover:bg-black/20 text-gray-800'}`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {imgc.resetView}
                </button>
              </div>
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                <div className="flex flex-wrap gap-1">
                  {CAMERA_PRESETS.map((preset, presetIdx) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => {
                        const next: CameraControlValue = { ...cameraValue, ...preset.value };
                        persistCameraValue(normalizeCameraValue(next));
                      }}
                      className={`px-2 py-1 rounded text-[10px] ${isDarkMode ? 'bg-white/10 hover:bg-white/20 text-white' : 'bg-black/10 hover:bg-black/20 text-gray-800'}`}
                    >
                      {imageNodeCameraPresetLabel(locale, presetIdx)}
                    </button>
                  ))}
                </div>
                <div className={`text-[11px] ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
                  <div className="flex justify-between">
                    <span>{imgc.rotation}</span>
                    <span>{Math.round(cameraValue.rotationY)}°</span>
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
                    <span>{Math.round(cameraValue.rotationX)}°</span>
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
                    <span>
                      {cameraValue.scale <= 2.5 ? imgc.shotCloseup : cameraValue.scale > 4.5 ? imgc.shotWide : imgc.shotMedium}
                    </span>
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
              </div>
            </div>
          </div>,
          document.body
        )}

        </>
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
    prevProps.data?.imageAsset?.height === nextProps.data?.imageAsset?.height
  );
});
ImageNode.displayName = 'ImageNode';
