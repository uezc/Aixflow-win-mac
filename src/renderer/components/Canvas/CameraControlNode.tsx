import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, NodeProps, Position, useReactFlow } from 'reactflow';
import { useFrozenFlowViewport } from '../../hooks/useFrozenFlowViewport';
import { Cuboid } from 'lucide-react';
import CubeCameraController, { CameraControlValue } from './CubeCameraController';
import {
  getPhotographyPrompt,
  DEFAULT_CAMERA_VALUE,
  SCALE_CLOSEUP,
  SCALE_MEDIUM,
  SCALE_WIDE,
  CAMERA_PRESETS,
} from '../../utils/cameraControlUtils';
import type { CameraPromptMetadata, CameraParams, QwenCameraAPI, CameraOutputPayload } from '../../utils/cameraControlUtils';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { scaleModulePx } from '../../utils/moduleDisplayScale';
export type { CameraPromptMetadata, CameraParams, QwenCameraAPI, CameraOutputPayload };

interface CameraControlNodeData {
  title?: string;
  rotationX?: number; // deg
  rotationY?: number; // deg
  scale?: number; // camera distance
  fov?: number;
  wideAngle?: boolean;
  cameraControl?: {
    rotationX: number;
    rotationY: number;
    scale: number;
    fov: number;
  };
  rot_h?: number;
  rot_v?: number;
  dist?: number;
  inputImage?: string;
  prompt_payload?: {
    camera_params?: CameraParams;
    qwen_api?: QwenCameraAPI;
    prompt_metadata?: CameraPromptMetadata;
    camera_tags?: string;
    composition_tags?: string;
    full_camera_prompt?: string;
    qwen_instruction?: string;
  };
}

interface CameraControlNodeProps extends NodeProps<CameraControlNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
}

interface Local3DErrorBoundaryProps {
  onError: () => void;
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface Local3DErrorBoundaryState {
  hasError: boolean;
}

class Local3DErrorBoundary extends React.Component<Local3DErrorBoundaryProps, Local3DErrorBoundaryState> {
  constructor(props: Local3DErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): Local3DErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

const DEFAULT_VALUE = DEFAULT_CAMERA_VALUE;
const MIN_SCALE = 1.2;
const MAX_SCALE = 6.5;

const NODE_WIDTH = scaleModulePx(340);
const NODE_HEIGHT = scaleModulePx(355);

const QWEN_PRESETS = CAMERA_PRESETS;

export const CameraControlNode: React.FC<CameraControlNodeProps> = ({
  id,
  data,
  selected,
  isDarkMode = true,
  performanceMode = false,
  xPos = 0,
  yPos = 0,
}) => {
  const { locale } = useAppLocale();
  const { setNodes } = useReactFlow();
  const { x: vx, y: vy, zoom } = useFrozenFlowViewport();
  const scaleRef = useRef<HTMLInputElement>(null);
  const rotationYTextRef = useRef<HTMLSpanElement>(null);
  const rotationXTextRef = useRef<HTMLSpanElement>(null);
  const scaleTextRef = useRef<HTMLSpanElement>(null);
  const statusTextRef = useRef<HTMLDivElement>(null);
  const keyPoseRef = useRef(false);
  const invalidate3DRef = useRef<(() => void) | null>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const [previewHostWidth, setPreviewHostWidth] = useState(0);
  const [webglContextLost, setWebglContextLost] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState<boolean | null>(null);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const popoverTriggerRef = useRef<HTMLButtonElement>(null);
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);

  const initial = useMemo<CameraControlValue>(() => {
    return {
      rotationX: data?.rotationX ?? DEFAULT_VALUE.rotationX,
      rotationY: data?.rotationY ?? DEFAULT_VALUE.rotationY,
      scale: data?.scale ?? DEFAULT_VALUE.scale,
      fov: data?.fov ?? (data?.wideAngle ? 85 : DEFAULT_VALUE.fov),
    };
  }, [data?.rotationX, data?.rotationY, data?.scale, data?.fov, data?.wideAngle]);

  const [controllerValue, setControllerValue] = useState<CameraControlValue>(initial);
  const currentValueRef = useRef<CameraControlValue>(initial);

  useEffect(() => {
    currentValueRef.current = initial;
    setControllerValue(initial);
  }, [initial]);

  const normalizeValue = useCallback((next: CameraControlValue): CameraControlValue => {
    return {
      rotationX: Math.max(-75, Math.min(75, next.rotationX)),
      rotationY: Math.max(-180, Math.min(180, next.rotationY)),
      scale: Math.max(1.2, Math.min(6.5, next.scale)),
      fov: Math.max(30, Math.min(95, next.fov)),
    };
  }, []);

  const scaleToStop = useCallback((s: number) => {
    const d0 = Math.abs(s - SCALE_CLOSEUP);
    const d1 = Math.abs(s - SCALE_MEDIUM);
    const d2 = Math.abs(s - SCALE_WIDE);
    if (d0 <= d1 && d0 <= d2) return 0;
    if (d1 <= d2) return 1;
    return 2;
  }, []);
  const stopToScale = useCallback((stop: number) => {
    if (stop <= 0) return SCALE_CLOSEUP;
    if (stop >= 2) return SCALE_WIDE;
    return SCALE_MEDIUM;
  }, []);
  const scaleToLabel = useCallback((s: number) => {
    const stop = scaleToStop(s);
    return stop === 0 ? '特写' : stop === 1 ? '中景' : '全景';
  }, [scaleToStop]);

  const syncSliderDom = useCallback((next: CameraControlValue) => {
    if (scaleRef.current) scaleRef.current.value = String(scaleToStop(next.scale));
    if (rotationYTextRef.current) rotationYTextRef.current.textContent = `${Math.round(next.rotationY)}deg`;
    if (rotationXTextRef.current) rotationXTextRef.current.textContent = `${Math.round(next.rotationX)}deg`;
    if (scaleTextRef.current) scaleTextRef.current.textContent = scaleToLabel(next.scale);
  }, [scaleToStop, scaleToLabel]);

  const syncPromptFeedback = useCallback((next: CameraControlValue) => {
    const result = getPhotographyPrompt(next);
    if (statusTextRef.current) {
      statusTextRef.current.textContent = `视角状态: ${result.statusText}`;
      statusTextRef.current.style.color = result.isKeyPose ? '#34d399' : '';
      if (result.isKeyPose && !keyPoseRef.current) {
        statusTextRef.current.animate(
          [{ opacity: 0.7, transform: 'translateY(1px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 280, easing: 'ease-out' }
        );
      }
    }
    keyPoseRef.current = result.isKeyPose;
    return result.payload;
  }, []);

  useEffect(() => {
    syncSliderDom(currentValueRef.current);
    syncPromptFeedback(currentValueRef.current);
  }, [syncPromptFeedback, syncSliderDom, controllerValue]);

  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) return;
    const updateWidth = () => {
      const rect = host.getBoundingClientRect();
      setPreviewHostWidth(rect.width || 0);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // 画布缩放时强制 3D 场景重绘，避免缩小后显示错位
  useEffect(() => {
    invalidate3DRef.current?.();
  }, [zoom]);

  const probeWebGL = useCallback(() => {
    try {
      const testCanvas = document.createElement('canvas');
      const gl =
        testCanvas.getContext('webgl2', { powerPreference: 'default', antialias: false }) ||
        testCanvas.getContext('webgl', { powerPreference: 'default', antialias: false });
      if (!gl) {
        setWebglAvailable(false);
        return;
      }
      const loseContext = (gl as WebGLRenderingContext).getExtension?.('WEBGL_lose_context');
      loseContext?.loseContext?.();
      setWebglAvailable(true);
    } catch {
      setWebglAvailable(false);
    }
  }, []);

  useEffect(() => {
    probeWebGL();
  }, [probeWebGL]);

  const updatePopoverPosition = useCallback(() => {
    if (isPopoverOpen && popoverTriggerRef.current) {
      const rect = popoverTriggerRef.current.getBoundingClientRect();
      setPopoverPosition({ left: rect.right + 8, top: rect.top });
    } else {
      setPopoverPosition(null);
    }
  }, [isPopoverOpen]);

  useEffect(() => {
    updatePopoverPosition();
  }, [updatePopoverPosition, isPopoverOpen, xPos, yPos, transform]);

  useEffect(() => {
    if (!isPopoverOpen) return;
    const onScrollOrResize = () => updatePopoverPosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    const ro = new ResizeObserver(updatePopoverPosition);
    if (popoverTriggerRef.current) ro.observe(popoverTriggerRef.current);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      ro.disconnect();
    };
  }, [isPopoverOpen, updatePopoverPosition]);

  useEffect(() => {
    if (!isPopoverOpen) return;
    const handler = (e: MouseEvent) => {
      const trigger = popoverTriggerRef.current;
      const popoverEl = document.getElementById(`camera-control-popover-${id}`);
      const target = e.target as Node | null;
      if (!trigger?.contains(target) && !popoverEl?.contains(target)) {
        setIsPopoverOpen(false);
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
    };
  }, [isPopoverOpen, id]);

  const persistNodeValue = useCallback(
    (next: CameraControlValue) => {
      const normalized = normalizeValue(next);
      currentValueRef.current = normalized;
      const { payload } = getPhotographyPrompt(normalized);
      const { camera_params, prompt_metadata } = payload;
      const promptPayload = {
        ...payload,
        camera_tags: prompt_metadata.view_tags,
        full_camera_prompt: prompt_metadata.formatted_output,
        qwen_instruction: prompt_metadata.qwen_instruction,
      };
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  title: (node.data as CameraControlNodeData)?.title ?? '3D视角控制器',
                  rotationX: normalized.rotationX,
                  rotationY: normalized.rotationY,
                  scale: normalized.scale,
                  fov: normalized.fov,
                  rot_h: camera_params.rot_h,
                  rot_v: camera_params.rot_v,
                  dist: camera_params.dist,
                  prompt_payload: promptPayload,
                  cameraControl: {
                    rotationX: normalized.rotationX,
                    rotationY: normalized.rotationY,
                    scale: normalized.scale,
                    fov: normalized.fov,
                  },
                },
              }
            : node
        )
      );
    },
    [id, normalizeValue, setNodes]
  );

  const updateLocalValue = useCallback(
    (next: CameraControlValue) => {
      const normalized = normalizeValue(next);
      currentValueRef.current = normalized;
      setControllerValue(normalized);
      syncSliderDom(normalized);
      syncPromptFeedback(normalized);
      invalidate3DRef.current?.();
    },
    [normalizeValue, syncPromptFeedback, syncSliderDom]
  );

  const isHardFrozen = useMemo(() => {
    if (!performanceMode) return false;
    const worldLeft = -vx / zoom;
    const worldTop = -vy / zoom;
    const worldRight = worldLeft + (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const worldBottom = worldTop + (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const marginX = ((worldRight - worldLeft) * 2) / Math.max(zoom, 0.0001);
    const marginY = ((worldBottom - worldTop) * 2) / Math.max(zoom, 0.0001);
    const right = xPos + NODE_WIDTH;
    const bottom = yPos + NODE_HEIGHT;
    return (
      right < worldLeft - marginX ||
      xPos > worldRight + marginX ||
      bottom < worldTop - marginY ||
      yPos > worldBottom + marginY
    );
  }, [performanceMode, vx, vy, zoom, xPos, yPos]);

  const displayTitle = data?.title === 'camera-control' ? '3D视角控制器' : (data?.title || '3D视角控制器');
  const inputImageUrl = typeof data?.inputImage === 'string' ? data.inputImage : '';
  const canMountThreeScene = !!inputImageUrl && previewHostWidth > 0 && webglAvailable === true && !webglContextLost;

  const handleReloadWebGL = useCallback(() => {
    setWebglContextLost(false);
    setWebglAvailable(true);
  }, []);

  const isWebGLError = webglContextLost || webglAvailable === false;
  const fallbackPanel = isWebGLError ? (
    <button
      type="button"
      className={`h-full w-full flex flex-col items-center justify-center gap-2 text-xs cursor-pointer border-0 ${
        isDarkMode ? 'bg-black/50 text-white/80 hover:bg-black/60' : 'bg-gray-300/80 text-gray-700 hover:bg-gray-400/80'
      }`}
      onClick={handleReloadWebGL}
    >
      <div>WebGL 上下文已丢失</div>
      <div className="text-[10px] opacity-80">点击重载</div>
    </button>
  ) : (
    <div
      className={`h-full w-full flex flex-col items-center justify-center gap-2 text-xs ${
        isDarkMode ? 'bg-black/35 text-white/65' : 'bg-gray-200/70 text-gray-600'
      }`}
    >
      3D 容器初始化中...
    </div>
  );

  return (
    <div
      data-id={id}
      className={`custom-node-container relative rounded-2xl overflow-visible p-2.5 ${
        isDarkMode
          ? 'apple-panel text-white'
          : 'apple-panel-light text-gray-900'
      } ${selected ? (isDarkMode ? 'ring-2 ring-green-400/80' : 'ring-2 ring-green-500') : ''}`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT, userSelect: 'auto' }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="nexflow-plus-handle nexflow-plus-handle-left"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="nexflow-plus-handle nexflow-plus-handle-right"
      />

      <div className="title-area absolute -top-7 left-0 z-10">
        <span className={`font-bold text-xs select-none ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
          {displayTitle}
        </span>
      </div>

      <div
        ref={previewHostRef}
        className="relative w-full rounded-xl overflow-hidden nodrag nopan shrink-0"
        style={{
          height: 180,
          minHeight: 180,
          pointerEvents: 'auto',
          transformOrigin: 'center center',
        }}
      >
        {isHardFrozen ? (
          <div
            className={`h-full w-full flex items-center justify-center text-xs ${
              isDarkMode ? 'bg-black/40 text-white/45' : 'bg-gray-200/70 text-gray-500'
            }`}
          >
            3D预览已冻结（性能模式）
          </div>
        ) : !inputImageUrl ? (
          <div
            className={`h-full w-full flex flex-col items-center justify-center gap-2 text-xs ${
              isDarkMode ? 'bg-black/35 text-white/65' : 'bg-gray-200/70 text-gray-600'
            }`}
          >
            <div>请先连接图片节点输入</div>
          </div>
        ) : (
          <>
            <div
              className={`h-full w-full flex flex-col items-center justify-center gap-2 text-xs ${
                isDarkMode ? 'bg-black/35 text-white/65' : 'bg-gray-200/70 text-gray-600'
              }`}
            >
              <span>点击「3D 视角」按钮打开控制器</span>
            </div>
            <button
              ref={popoverTriggerRef}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!inputImageUrl || webglAvailable === false || webglContextLost) return;
                setIsPopoverOpen((v) => !v);
              }}
              disabled={webglAvailable === false || webglContextLost}
              className={`nodrag absolute top-2 right-2 p-1.5 rounded-lg transition-all z-10 ${
                isDarkMode
                  ? 'apple-panel hover:bg-white/20 disabled:opacity-50'
                  : 'apple-panel-light hover:bg-gray-200/30 disabled:opacity-50'
              } ${isPopoverOpen ? (isDarkMode ? 'ring-2 ring-green-400/60' : 'ring-2 ring-green-600/50') : ''}`}
              title="3D 视角"
              style={{ pointerEvents: 'all' }}
            >
              <Cuboid className={`w-4 h-4 ${isDarkMode ? 'text-white/80' : 'text-gray-700'}`} />
            </button>
          </>
        )}
        <div
          ref={statusTextRef}
          className={`pointer-events-none absolute left-2 right-2 bottom-2 text-[11px] px-2 py-1 rounded ${
            isDarkMode ? 'bg-black/40 text-white/70' : 'bg-white/70 text-slate-700'
          }`}
        >
          正面 · 平视 · 中景
        </div>
      </div>

      {isPopoverOpen && popoverPosition && inputImageUrl && webglAvailable === true && !webglContextLost && createPortal(
        <div
          id={`camera-control-popover-${id}`}
          className={`fixed z-[9999] rounded-xl shadow-xl border overflow-hidden ${
            isDarkMode ? 'apple-panel border-white/15' : 'apple-panel-light border-gray-300/40'
          }`}
          style={{
            left: popoverPosition.left,
            top: popoverPosition.top,
            width: 280,
            height: 280,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <Local3DErrorBoundary
            fallback={fallbackPanel}
            onError={() => {
              setWebglContextLost(true);
              setWebglAvailable(false);
              setIsPopoverOpen(false);
            }}
          >
            {isPopoverOpen && (
              <CubeCameraController
                value={controllerValue}
                inputImageUrl={inputImageUrl}
                isDarkMode={isDarkMode}
                locale={locale}
                onContextLost={() => {
                  setWebglContextLost(true);
                  setWebglAvailable(false);
                  setIsPopoverOpen(false);
                }}
                onChange={(next) => {
                  const normalized = normalizeValue(next);
                  currentValueRef.current = normalized;
                  setControllerValue(normalized);
                  syncSliderDom(normalized);
                  syncPromptFeedback(normalized);
                }}
                onChangeEnd={(next) => {
                  const normalized = normalizeValue(next);
                  currentValueRef.current = normalized;
                  setControllerValue(normalized);
                  syncSliderDom(normalized);
                  syncPromptFeedback(normalized);
                  persistNodeValue(normalized);
                }}
                onInvalidateReady={(invalidate) => {
                  invalidate3DRef.current = invalidate;
                }}
              />
            )}
          </Local3DErrorBoundary>
        </div>,
        document.body
      )}

      <div className="mt-1 flex flex-wrap gap-1 text-[10px] nodrag nopan">
        {QWEN_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`px-2 py-1 rounded-md transition-colors ${
              isDarkMode
                ? 'bg-white/10 hover:bg-white/20 text-white/90'
                : 'bg-black/8 hover:bg-black/15 text-slate-700'
            }`}
            onClick={() => {
              const next: CameraControlValue = {
                ...currentValueRef.current,
                ...preset.value,
              };
              const normalized = normalizeValue(next);
              updateLocalValue(normalized);
              persistNodeValue(normalized);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-1 text-[11px]">
        <label className={`flex flex-col gap-1 ${isDarkMode ? 'text-white/80' : 'text-slate-700'}`}>
          <div className="flex items-center justify-between">
            <span>景别</span>
            <span ref={scaleTextRef}>{scaleToLabel(controllerValue.scale)}</span>
          </div>
          <input
            ref={scaleRef}
            type="range"
            min={0}
            max={2}
            step={1}
            defaultValue={scaleToStop(controllerValue.scale)}
            onChange={(e) => {
              const stop = Number(e.target.value);
              const scale = stopToScale(stop);
              updateLocalValue({ ...currentValueRef.current, scale });
            }}
            onPointerUp={() => persistNodeValue(currentValueRef.current)}
            onBlur={() => persistNodeValue(currentValueRef.current)}
            className="nodrag nopan accent-cyan-400 w-full"
          />
          <div className="flex justify-between text-[10px] opacity-70 mt-0.5">
            <span>特写</span>
            <span>中景</span>
            <span>全景</span>
          </div>
        </label>
      </div>
    </div>
  );
};

export default CameraControlNode;
