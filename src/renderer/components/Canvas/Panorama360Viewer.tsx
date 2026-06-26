import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { Maximize2, Minimize2, Camera, RotateCcw } from 'lucide-react';

const DEFAULT_FOV = 70;
/** 可拖动/滚轮调节的 FOV 范围（数值越小越「近」，越大越「远」），略宽于早期版本便于细调 */
const MIN_FOV = 26;
const MAX_FOV = 120;
const CAPTURE_OUT_MAX = 2048;

export type PanoramaAspectPresetId =
  | 'adaptive'
  | '1_1'
  | '4_3'
  | '3_4'
  | '16_9'
  | '9_16'
  | '21_9'
  | '235_100';

const ASPECT_PRESETS: { id: PanoramaAspectPresetId; label: string; ratio: number | null }[] = [
  { id: 'adaptive', label: '', ratio: null },
  { id: '1_1', label: '1:1', ratio: 1 },
  { id: '4_3', label: '4:3', ratio: 4 / 3 },
  { id: '3_4', label: '3:4', ratio: 3 / 4 },
  { id: '16_9', label: '16:9', ratio: 16 / 9 },
  { id: '9_16', label: '9:16', ratio: 9 / 16 },
  { id: '21_9', label: '21:9', ratio: 21 / 9 },
  { id: '235_100', label: '2.35:1', ratio: 2.35 },
];

function ratioForPreset(id: PanoramaAspectPresetId): number | null {
  const p = ASPECT_PRESETS.find((x) => x.id === id);
  return p?.ratio ?? null;
}

/** 同步透视相机 FOV：数值越小越「近」（窄视野），越大越「远」（广视野） */
function PanoramaCameraFov({ fov }: { fov: number }) {
  const { camera } = useThree();
  useEffect(() => {
    const c = camera as THREE.PerspectiveCamera;
    if (c.isPerspectiveCamera) {
      c.fov = fov;
      c.updateProjectionMatrix();
    }
  }, [camera, fov]);
  return null;
}

/** 注册当前帧截图：按选中的比例中心裁剪后输出 PNG ArrayBuffer */
function PanoramaGlCaptureBridge({
  aspectPresetRef,
  captureApiRef,
}: {
  aspectPresetRef: React.MutableRefObject<PanoramaAspectPresetId>;
  captureApiRef: React.MutableRefObject<(() => Promise<ArrayBuffer | null>) | null>;
}) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    const run = async (): Promise<ArrayBuffer | null> => {
      try {
        gl.render(scene, camera);
        const canvas = gl.domElement;
        const sw = canvas.width;
        const sh = canvas.height;
        if (sw < 2 || sh < 2) return null;

        const targetR = ratioForPreset(aspectPresetRef.current);
        let sx = 0;
        let sy = 0;
        let sww = sw;
        let shh = sh;
        if (targetR != null) {
          const srcR = sw / sh;
          if (srcR > targetR) {
            shh = sh;
            sww = Math.round(sh * targetR);
            sx = Math.floor((sw - sww) / 2);
            sy = 0;
          } else {
            sww = sw;
            shh = Math.round(sw / targetR);
            sx = 0;
            sy = Math.floor((sh - shh) / 2);
          }
        }

        let dw: number;
        let dh: number;
        if (sww >= shh) {
          dw = Math.min(CAPTURE_OUT_MAX, sww);
          dh = Math.round(dw * (shh / sww));
        } else {
          dh = Math.min(CAPTURE_OUT_MAX, shh);
          dw = Math.round(dh * (sww / shh));
        }
        dw = Math.max(1, dw);
        dh = Math.max(1, dh);

        const out = document.createElement('canvas');
        out.width = dw;
        out.height = dh;
        const ctx = out.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(canvas, sx, sy, sww, shh, 0, 0, dw, dh);
        const blob = await new Promise<Blob | null>((res) => out.toBlob((b) => res(b), 'image/png', 0.95));
        if (!blob) return null;
        return await blob.arrayBuffer();
      } catch (e) {
        console.warn('[Panorama360Viewer] capture failed', e);
        return null;
      }
    };
    captureApiRef.current = run;
    return () => {
      captureApiRef.current = null;
    };
  }, [gl, scene, camera, aspectPresetRef, captureApiRef]);
  return null;
}

/** 捕获 WebGL 纹理加载/着色错误，避免拖垮画布 */
class PanoramaErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode; onError?: () => void },
  { err: boolean }
> {
  state = { err: false };
  static getDerivedStateFromError = () => ({ err: true });
  componentDidCatch() {
    this.props.onError?.();
  }
  render() {
    return this.state.err ? this.props.fallback : this.props.children;
  }
}

function EquirectMesh({ url }: { url: string }) {
  const map = useTexture(url);
  useEffect(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    return () => {
      map.dispose();
    };
  }, [map]);

  return (
    <mesh>
      <sphereGeometry args={[12, 64, 32]} />
      <meshBasicMaterial map={map} side={THREE.BackSide} />
    </mesh>
  );
}

/** 将 OrbitControls.reset 挂到 ref，供「复位」恢复默认环视角度 */
function OrbitResetRegistrar({ onRegister }: { onRegister: (fn: () => void) => void }) {
  const controls = useThree((s) => s.controls) as { reset?: () => void } | null | undefined;
  useEffect(() => {
    if (controls && typeof controls.reset === 'function') {
      const reset = controls.reset.bind(controls);
      onRegister(() => reset());
    }
  }, [controls, onRegister]);
  return null;
}

const PanoramaScene = memo(function PanoramaScene({
  url,
  fov,
  aspectPresetRef,
  captureApiRef,
  onRegisterOrbitReset,
}: {
  url: string;
  fov: number;
  aspectPresetRef: React.MutableRefObject<PanoramaAspectPresetId>;
  captureApiRef: React.MutableRefObject<(() => Promise<ArrayBuffer | null>) | null>;
  onRegisterOrbitReset: (fn: () => void) => void;
}) {
  return (
    <>
      <PanoramaGlCaptureBridge aspectPresetRef={aspectPresetRef} captureApiRef={captureApiRef} />
      <PanoramaCameraFov fov={fov} />
      <color attach="background" args={['#050508']} />
      <Suspense fallback={null}>
        <EquirectMesh url={url} />
      </Suspense>
      <OrbitControls
        makeDefault
        enablePan={false}
        enableZoom={false}
        enableDamping
        dampingFactor={0.068}
        rotateSpeed={-0.42}
        minPolarAngle={0.055}
        maxPolarAngle={Math.PI - 0.055}
      />
      <OrbitResetRegistrar onRegister={onRegisterOrbitReset} />
    </>
  );
});

export interface Panorama360ViewerProps {
  instanceKey: string;
  textureUrl: string;
  isDarkMode?: boolean;
  className?: string;
  nearLabel?: string;
  farLabel?: string;
  zoomSliderTitle?: string;
  aspectAdaptiveLabel?: string;
  screenshotLabel?: string;
  /** 截图旁「复位」：恢复默认视野角 + 环视角度 */
  resetFovLabel?: string;
  /** 截取当前视角 PNG 后回调（由 Image 节点写入项目并在画布右侧新建图片模块） */
  onScreenshotCaptured?: (buffer: ArrayBuffer) => void | Promise<void>;
  /** 截图得到空数据时（渲染未就绪等） */
  onCaptureEmpty?: () => void;
  expandRatioPickerTitle?: string;
  collapseRatioPickerTitle?: string;
  ratioShortcutHint?: string;
}

const Panorama360Viewer: React.FC<Panorama360ViewerProps> = ({
  instanceKey,
  textureUrl,
  isDarkMode = true,
  className = '',
  nearLabel = '近',
  farLabel = '远',
  zoomSliderTitle = '视野远近',
  aspectAdaptiveLabel = '自适应',
  screenshotLabel = '截图',
  resetFovLabel = '重置视野',
  onScreenshotCaptured,
  onCaptureEmpty,
  expandRatioPickerTitle = '展开截图比例',
  collapseRatioPickerTitle = '收起比例',
  ratioShortcutHint = 'C 展开/收起',
}) => {
  const [webglBroken, setWebglBroken] = useState(false);
  const [panoFov, setPanoFov] = useState(DEFAULT_FOV);
  const [aspectPickerOpen, setAspectPickerOpen] = useState(false);
  const [lastCapturePreset, setLastCapturePreset] = useState<PanoramaAspectPresetId | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const aspectPresetRef = useRef<PanoramaAspectPresetId>('adaptive');
  const captureApiRef = useRef<(() => Promise<ArrayBuffer | null>) | null>(null);
  const orbitResetRef = useRef<(() => void) | null>(null);
  const registerOrbitReset = useCallback((fn: () => void) => {
    orbitResetRef.current = fn;
  }, []);

  useEffect(() => {
    setWebglBroken(false);
    setPanoFov(DEFAULT_FOV);
    setAspectPickerOpen(false);
  }, [textureUrl]);

  useEffect(() => {
    const onChange = () => {
      setFullscreenActive(document.fullscreenElement === fullscreenRef.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  /** 窗口 / 全屏：滚轮调 FOV；rAF 合并多帧增量 + 曲线映射，避免「一格一格」顿挫 */
  useEffect(() => {
    if (!textureUrl.trim()) return;
    const root = fullscreenRef.current;
    if (!root) return;

    let acc = 0;
    let raf: number | null = null;

    const flush = () => {
      raf = null;
      const d = acc;
      acc = 0;
      if (Math.abs(d) < 1e-5) return;
      setPanoFov((prev) => {
        const n = prev + d;
        return Math.min(MAX_FOV, Math.max(MIN_FOV, n));
      });
    };

    const scheduleFlush = () => {
      if (raf != null) return;
      raf = requestAnimationFrame(flush);
    };

    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || !root.contains(t)) return;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;
      e.preventDefault();
      e.stopPropagation();

      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= 100;

      const mag = Math.min(280, Math.abs(dy));
      if (mag < 1e-3) return;
      const sign = Math.sign(dy);
      const curved = sign * Math.pow(mag, 0.76) * 0.042;
      acc += curved;
      scheduleFlush();
    };

    root.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      root.removeEventListener('wheel', onWheel);
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [textureUrl]);

  const toggleFullscreen = useCallback(async () => {
    const el = fullscreenRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch (e) {
      console.warn('[Panorama360Viewer] 全屏切换失败', e);
    }
  }, []);

  const executeCaptureWithPreset = useCallback(
    async (presetId: PanoramaAspectPresetId) => {
      if (!onScreenshotCaptured || isCapturing) return;
      const fn = captureApiRef.current;
      if (!fn) {
        onCaptureEmpty?.();
        return;
      }
      aspectPresetRef.current = presetId;
      setLastCapturePreset(presetId);
      setAspectPickerOpen(false);
      setIsCapturing(true);
      try {
        const buf = await fn();
        if (buf) await onScreenshotCaptured(buf);
        else onCaptureEmpty?.();
      } finally {
        setIsCapturing(false);
      }
    },
    [onScreenshotCaptured, onCaptureEmpty, isCapturing],
  );

  useEffect(() => {
    if (!onScreenshotCaptured) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setAspectPickerOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onScreenshotCaptured]);

  useEffect(() => {
    if (!aspectPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setAspectPickerOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [aspectPickerOpen]);

  const textMuted = isDarkMode ? 'text-white/60' : 'text-gray-600';
  const canvasKey = useMemo(() => `${instanceKey}-${textureUrl.slice(0, 80)}`, [instanceKey, textureUrl]);
  const barBg = isDarkMode ? 'bg-black/50' : 'bg-white/80';
  const labelCls = isDarkMode ? 'text-white/55' : 'text-gray-600';
  const pillBase = `px-2 py-1 rounded-md text-[10px] font-medium transition-all nodrag nopan`;
  const pillOff = isDarkMode
    ? 'text-white/75 hover:bg-white/10 bg-white/5'
    : 'text-gray-800 hover:bg-black/10 bg-black/5';
  const pillOn = 'bg-cyan-600/90 text-white ring-1 ring-cyan-400/50';
  const screenshotBtnTitle = aspectPickerOpen
    ? `${collapseRatioPickerTitle}（${ratioShortcutHint}）`
    : `${expandRatioPickerTitle}（${ratioShortcutHint}）`;

  if (!textureUrl.trim()) return null;

  if (webglBroken) {
    return (
      <div className={`flex items-center justify-center p-3 text-xs ${textMuted} ${className}`}>
        WebGL 预览失败，请换一张图或检查显存/驱动
      </div>
    );
  }

  return (
    <PanoramaErrorBoundary
      onError={() => setWebglBroken(true)}
      fallback={
        <div className={`flex items-center justify-center p-3 text-xs ${textMuted} ${className}`}>
          全景纹理加载失败（格式或跨域）
        </div>
      }
    >
      <div
        ref={fullscreenRef}
        className={`relative w-full h-full min-h-0 flex flex-col nodrag nopan bg-[#050508] [&:fullscreen]:rounded-none ${className}`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void toggleFullscreen();
          }}
          className={`nodrag nopan absolute top-2 right-2 z-20 p-1.5 rounded-lg transition-colors shadow-md ${
            isDarkMode
              ? 'bg-black/60 hover:bg-black/80 text-white'
              : 'bg-white/90 hover:bg-white text-gray-900'
          }`}
          title={fullscreenActive ? '退出全屏 (Esc)' : '全屏查看'}
        >
          {fullscreenActive ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>

        <div className="relative flex-1 min-h-0 w-full">
          <Canvas
            key={canvasKey}
            className="absolute inset-0 h-full w-full touch-none"
            gl={{
              antialias: true,
              alpha: false,
              powerPreference: 'high-performance',
              preserveDrawingBuffer: true,
            }}
            camera={{ position: [0, 0, 0.01], fov: DEFAULT_FOV, near: 0.001, far: 100 }}
            dpr={[1, 2]}
          >
            <PanoramaScene
              url={textureUrl}
              fov={panoFov}
              aspectPresetRef={aspectPresetRef}
              captureApiRef={captureApiRef}
              onRegisterOrbitReset={registerOrbitReset}
            />
          </Canvas>
        </div>

        {onScreenshotCaptured ? (
          <div
            className={`nodrag nopan shrink-0 ${barBg}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-2 py-2">
              <button
                type="button"
                disabled={isCapturing}
                title={screenshotBtnTitle}
                onClick={() => setAspectPickerOpen((v) => !v)}
                className={`nodrag nopan flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium ${
                  aspectPickerOpen
                    ? isDarkMode
                      ? 'bg-white/15 text-white ring-1 ring-cyan-400/40'
                      : 'bg-black/10 text-gray-900 ring-1 ring-cyan-500/40'
                    : isCapturing
                      ? 'opacity-50 cursor-not-allowed text-white/50'
                      : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                {isCapturing ? '…' : screenshotLabel}
              </button>
              <button
                type="button"
                title={resetFovLabel}
                onClick={() => {
                  setPanoFov(DEFAULT_FOV);
                  try {
                    orbitResetRef.current?.();
                  } catch {
                    /* ignore */
                  }
                }}
                className={`nodrag nopan flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium shrink-0 ${
                  isDarkMode
                    ? 'text-white/85 bg-white/10 hover:bg-white/18'
                    : 'text-gray-800 bg-black/8 hover:bg-black/14'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {resetFovLabel}
              </button>
              <span className={`text-[10px] ml-auto opacity-70 ${labelCls}`}>{ratioShortcutHint}</span>
            </div>
            {aspectPickerOpen ? (
              <div className="flex flex-wrap gap-1 px-2 pb-2 pt-0">
                {ASPECT_PRESETS.map((p) => {
                  const label = p.id === 'adaptive' ? aspectAdaptiveLabel : p.label;
                  const active = lastCapturePreset === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      title={label}
                      disabled={isCapturing}
                      onClick={() => void executeCaptureWithPreset(p.id)}
                      className={`${pillBase} ${active ? pillOn : pillOff} ${isCapturing ? 'opacity-50 pointer-events-none' : ''}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        <div
          className={`nodrag nopan shrink-0 flex items-center gap-2 px-2 py-2 ${barBg}`}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className={`text-[10px] shrink-0 w-5 tabular-nums ${labelCls}`} title={zoomSliderTitle}>
            {nearLabel}
          </span>
          <input
            type="range"
            min={MIN_FOV}
            max={MAX_FOV}
            step={0.15}
            value={panoFov}
            title={zoomSliderTitle}
            aria-label={zoomSliderTitle}
            onChange={(e) => setPanoFov(Number(e.target.value))}
            className="nodrag nopan flex-1 min-w-0 h-1.5 accent-emerald-500 cursor-pointer"
          />
          <span className={`text-[10px] shrink-0 w-5 text-right tabular-nums ${labelCls}`} title={zoomSliderTitle}>
            {farLabel}
          </span>
        </div>
      </div>
    </PanoramaErrorBoundary>
  );
};

export default memo(Panorama360Viewer);
