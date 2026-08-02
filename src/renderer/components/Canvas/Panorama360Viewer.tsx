import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { Maximize2, Minimize2, Camera, RotateCcw, X } from 'lucide-react';
import { useStore } from 'reactflow';

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

/** 与截图逻辑一致：按目标比例在视口中心裁剪矩形（CSS 像素） */
function computeCenterCropRect(
  vw: number,
  vh: number,
  ratio: number | null,
): { left: number; top: number; width: number; height: number } {
  const w = Math.max(1, vw);
  const h = Math.max(1, vh);
  if (ratio == null || !(ratio > 0)) {
    return { left: 0, top: 0, width: w, height: h };
  }
  const srcR = w / h;
  if (srcR > ratio) {
    const cw = h * ratio;
    return { left: (w - cw) / 2, top: 0, width: cw, height: h };
  }
  const ch = w / ratio;
  return { left: 0, top: (h - ch) / 2, width: w, height: ch };
}

/** 比例预览小图标（自适应虚线框 / 固定比例实线框） */
function AspectRatioGlyph({
  id,
  active,
  isDarkMode,
}: {
  id: PanoramaAspectPresetId;
  active?: boolean;
  isDarkMode: boolean;
}) {
  const ratio = ratioForPreset(id);
  const stroke = active
    ? 'border-cyan-400'
    : isDarkMode
      ? 'border-white/70'
      : 'border-gray-700';
  if (id === 'adaptive' || ratio == null) {
    return (
      <span
        className={`block h-5 w-7 rounded-[3px] border border-dashed ${stroke}`}
        aria-hidden
      />
    );
  }
  const portrait = ratio < 1;
  const boxStyle = portrait
    ? { width: 12, height: Math.round(12 / ratio) }
    : { width: Math.min(28, Math.round(14 * ratio)), height: 14 };
  return (
    <span
      className={`block rounded-[2px] border ${stroke}`}
      style={{ width: boxStyle.width, height: Math.min(22, boxStyle.height) }}
      aria-hidden
    />
  );
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

/** 把 R3F/Three 可能写成屏幕像素的 canvas style 打回 100% 铺满（viewport scale 下易量错） */
function fillCanvasDom(el: HTMLCanvasElement) {
  const parent = el.parentElement as HTMLElement | null;
  if (parent) {
    parent.style.position = parent.style.position || 'absolute';
    parent.style.inset = '0';
    parent.style.width = '100%';
    parent.style.height = '100%';
    parent.style.maxWidth = 'none';
    parent.style.maxHeight = 'none';
    parent.style.overflow = 'hidden';
  }
  el.style.width = '100%';
  el.style.height = '100%';
  el.style.maxWidth = 'none';
  el.style.maxHeight = 'none';
  el.style.display = 'block';
  el.style.position = 'absolute';
  el.style.inset = '0';
  el.style.left = '0';
  el.style.top = '0';
  el.style.right = '0';
  el.style.bottom = '0';
  el.style.margin = '0';
  el.style.transform = 'none';
}

/** 强制 WebGL 绘制缓冲与模块逻辑像素一致（不改父级布局，避免把画布挤成全黑） */
function ForceCanvasPixelSize({ width, height, syncKey = 0 }: { width: number; height: number; syncKey?: number }) {
  const { gl, setSize, invalidate } = useThree();
  useLayoutEffect(() => {
    const w = Math.max(2, Math.round(width));
    const h = Math.max(2, Math.round(height));
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;

    const apply = () => {
      const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
      gl.setPixelRatio(dpr);
      // updateStyle=false：只改绘制缓冲，CSS 交给外层 100% 铺满
      setSize(w, h, false);
      gl.setSize(w, h, false);
      fillCanvasDom(gl.domElement);
      invalidate();
    };

    apply();
    let frames = 0;
    let raf = 0;
    const tick = () => {
      apply();
      frames += 1;
      // 开局多刷几帧，盖过 R3F ResizeObserver 用 getBoundingClientRect 写回的错误 CSS 尺寸
      if (frames < 24) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const t1 = window.setTimeout(apply, 48);
    const t2 = window.setTimeout(apply, 160);
    const t3 = window.setTimeout(apply, 400);
    const el = gl.domElement;
    const mo = new MutationObserver(() => {
      if (el.style.width !== '100%' || el.style.height !== '100%') apply();
    });
    mo.observe(el, { attributes: true, attributeFilter: ['style'] });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      mo.disconnect();
    };
  }, [width, height, syncKey, gl, setSize, invalidate]);
  return null;
}

/** 根据容器逻辑宽高同步透视相机 aspect */
function SyncCameraAspect({ width, height }: { width: number; height: number }) {
  const { camera, invalidate } = useThree();
  useLayoutEffect(() => {
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const c = camera as THREE.PerspectiveCamera;
    if (!c.isPerspectiveCamera) return;
    const next = w / h;
    if (Math.abs(c.aspect - next) > 1e-4) {
      c.aspect = next;
      c.updateProjectionMatrix();
      invalidate();
    }
  }, [camera, width, height, invalidate]);
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
  useLayoutEffect(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.magFilter = THREE.LinearFilter;
    map.generateMipmaps = true;
    map.flipY = true;
    map.needsUpdate = true;
  }, [map]);

  return (
    // 负 X 缩放：等距柱状全景朝向与常见工具一致
    <mesh scale={[-1, 1, 1]}>
      <sphereGeometry args={[12, 64, 40]} />
      <meshBasicMaterial map={map} side={THREE.BackSide} toneMapped={false} />
    </mesh>
  );
}

const RESET_VIEW_MS = 780;

/** easeOutCubic：FOV / 俯仰平滑回正 */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * 轻微回弹过冲：水平环视「摇回」落稳，避免硬切闪回
 * c1 小于经典 back(1.7)，过冲克制、不易晕
 */
function easeOutSoftBack(t: number): number {
  const c1 = 1.15;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

type OrbitControlsLike = {
  target: THREE.Vector3;
  enabled: boolean;
  enableDamping: boolean;
  update: () => void;
  getAzimuthalAngle: () => number;
  getPolarAngle: () => number;
};

/** 平滑摇回初始环视角度（供「复位」）；取消进行中的动画以防连点打架 */
function OrbitSmoothResetRegistrar({ onRegister }: { onRegister: (fn: () => void) => void }) {
  const { camera, controls: controlsRaw } = useThree();
  const animRafRef = useRef<number | null>(null);
  const initialRef = useRef<{ theta: number; phi: number; radius: number } | null>(null);

  useEffect(() => {
    const controls = controlsRaw as OrbitControlsLike | null | undefined;
    if (!controls || typeof controls.getAzimuthalAngle !== 'function') return;

    if (!initialRef.current) {
      const offset = new THREE.Vector3().copy(camera.position).sub(controls.target);
      const sph = new THREE.Spherical().setFromVector3(offset);
      initialRef.current = {
        theta: controls.getAzimuthalAngle(),
        phi: controls.getPolarAngle(),
        radius: Math.max(sph.radius, 0.01),
      };
    }

    const cancelAnim = () => {
      if (animRafRef.current != null) {
        cancelAnimationFrame(animRafRef.current);
        animRafRef.current = null;
      }
    };

    const smoothReset = () => {
      cancelAnim();
      const init = initialRef.current;
      if (!init) return;

      const startTheta = controls.getAzimuthalAngle();
      const startPhi = controls.getPolarAngle();
      const endTheta = init.theta;
      const endPhi = init.phi;
      const radius = init.radius;

      // 角度差过小则无需动画
      const dTheta = Math.abs(THREE.MathUtils.euclideanModulo(startTheta - endTheta + Math.PI, Math.PI * 2) - Math.PI);
      const dPhi = Math.abs(startPhi - endPhi);
      if (dTheta < 0.002 && dPhi < 0.002) return;

      const wasEnabled = controls.enabled;
      const wasDamping = controls.enableDamping;
      controls.enabled = false;
      controls.enableDamping = false;

      const t0 = performance.now();
      const offset = new THREE.Vector3();
      const sph = new THREE.Spherical();

      const tick = (now: number) => {
        const raw = Math.min(1, (now - t0) / RESET_VIEW_MS);
        const eRot = easeOutSoftBack(raw);
        const ePhi = easeOutCubic(raw);

        // 方位角走最短弧，避免整圈甩过去
        let deltaTheta = endTheta - startTheta;
        while (deltaTheta > Math.PI) deltaTheta -= Math.PI * 2;
        while (deltaTheta < -Math.PI) deltaTheta += Math.PI * 2;
        const theta = startTheta + deltaTheta * eRot;
        const phi = startPhi + (endPhi - startPhi) * ePhi;

        sph.set(radius, phi, theta);
        offset.setFromSpherical(sph);
        camera.position.copy(controls.target).add(offset);
        camera.lookAt(controls.target);
        controls.update();

        if (raw < 1) {
          animRafRef.current = requestAnimationFrame(tick);
        } else {
          animRafRef.current = null;
          controls.enableDamping = wasDamping;
          controls.enabled = wasEnabled;
          controls.update();
        }
      };

      animRafRef.current = requestAnimationFrame(tick);
    };

    onRegister(smoothReset);
    return () => {
      cancelAnim();
      controls.enabled = true;
      onRegister(() => undefined);
    };
  }, [camera, controlsRaw, onRegister]);

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
      <color attach="background" args={['#0a0a0c']} />
      <Suspense
        fallback={
          <mesh>
            <sphereGeometry args={[12, 16, 12]} />
            <meshBasicMaterial color="#1a1a1e" side={THREE.BackSide} />
          </mesh>
        }
      >
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
      <OrbitSmoothResetRegistrar onRegister={onRegisterOrbitReset} />
    </>
  );
});

export interface Panorama360ViewerProps {
  instanceKey: string;
  textureUrl: string;
  isDarkMode?: boolean;
  className?: string;
  /**
   * panel：底部完整工具条（FOV 滑条 + 截图比例）
   * overlay：模块内嵌 — 底部中央相机/复位 pill，右上角退出地球（对齐产品稿）
   */
  chrome?: 'panel' | 'overlay';
  /** 外层模块当前宽高：用于强制 WebGL 与节点尺寸同步，避免放大后黑边 */
  layoutWidth?: number;
  layoutHeight?: number;
  nearLabel?: string;
  farLabel?: string;
  zoomSliderTitle?: string;
  aspectAdaptiveLabel?: string;
  screenshotLabel?: string;
  /** 截图旁「复位」：恢复默认视野角 + 环视角度 */
  resetFovLabel?: string;
  /** 退出 360 模式（overlay 右上角按钮文案） */
  exitLabel?: string;
  /** 退出按钮 title / aria 完整说明 */
  exitTitle?: string;
  onRequestExit?: () => void;
  /** 注册全屏等控制 API，供节点顶栏「放大」调用 */
  onRegisterControls?: (api: {
    toggleFullscreen: () => Promise<void>;
    isFullscreen: () => boolean;
  } | null) => void;
  /** 截取当前视角 PNG 后回调（由 Image 节点写入项目并在画布右侧新建图片模块） */
  onScreenshotCaptured?: (buffer: ArrayBuffer) => void | Promise<void>;
  /** 截图得到空数据时（渲染未就绪等） */
  onCaptureEmpty?: () => void;
  expandRatioPickerTitle?: string;
  collapseRatioPickerTitle?: string;
  ratioShortcutHint?: string;
  /** 底部提示，如「拖拽旋转视角」 */
  dragHint?: string;
}

const Panorama360Viewer: React.FC<Panorama360ViewerProps> = ({
  instanceKey,
  textureUrl,
  isDarkMode = true,
  className = '',
  chrome = 'panel',
  layoutWidth,
  layoutHeight,
  nearLabel = '近',
  farLabel = '远',
  zoomSliderTitle = '视野远近',
  aspectAdaptiveLabel = '自适应',
  screenshotLabel = '截图',
  resetFovLabel = '重置视野',
  exitLabel = '退出',
  exitTitle,
  onRequestExit,
  onRegisterControls,
  onScreenshotCaptured,
  onCaptureEmpty,
  expandRatioPickerTitle = '展开截图比例',
  collapseRatioPickerTitle = '收起比例',
  ratioShortcutHint = 'C 展开/收起',
  dragHint,
}) => {
  const [webglBroken, setWebglBroken] = useState(false);
  const [panoFov, setPanoFov] = useState(DEFAULT_FOV);
  const [aspectPickerOpen, setAspectPickerOpen] = useState(false);
  const [previewAspectId, setPreviewAspectId] = useState<PanoramaAspectPresetId>('adaptive');
  const [lastCapturePreset, setLastCapturePreset] = useState<PanoramaAspectPresetId | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const fullscreenRef = useRef<HTMLDivElement>(null);
  const [fullscreenActive, setFullscreenActive] = useState(false);
  const aspectPresetRef = useRef<PanoramaAspectPresetId>('adaptive');
  const captureApiRef = useRef<(() => Promise<ArrayBuffer | null>) | null>(null);
  const orbitResetRef = useRef<(() => void) | null>(null);
  const fovAnimRafRef = useRef<number | null>(null);
  const aspectHoverCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const defaultCaptureAspect = useCallback((): PanoramaAspectPresetId => {
    // 竖幅 9:16 → 上下顶满、水平居中（与示意一致）；已选过固定比例则沿用
    if (lastCapturePreset && lastCapturePreset !== 'adaptive') return lastCapturePreset;
    return '9_16';
  }, [lastCapturePreset]);

  const openAspectPickerHover = useCallback(() => {
    if (aspectHoverCloseTimerRef.current != null) {
      clearTimeout(aspectHoverCloseTimerRef.current);
      aspectHoverCloseTimerRef.current = null;
    }
    setAspectPickerOpen((wasOpen) => {
      if (!wasOpen) setPreviewAspectId(defaultCaptureAspect());
      return true;
    });
  }, [defaultCaptureAspect]);

  const scheduleCloseAspectPickerHover = useCallback(() => {
    if (aspectHoverCloseTimerRef.current != null) {
      clearTimeout(aspectHoverCloseTimerRef.current);
    }
    aspectHoverCloseTimerRef.current = setTimeout(() => {
      aspectHoverCloseTimerRef.current = null;
      setAspectPickerOpen(false);
    }, 160);
  }, []);
  const registerOrbitReset = useCallback((fn: () => void) => {
    orbitResetRef.current = fn;
  }, []);

  useEffect(() => {
    return () => {
      if (fovAnimRafRef.current != null) cancelAnimationFrame(fovAnimRafRef.current);
      if (aspectHoverCloseTimerRef.current != null) clearTimeout(aspectHoverCloseTimerRef.current);
    };
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

  /** 全屏时跟窗口尺寸；模块内用 DOM client 尺寸（与节点外框一致，避免黑边） */
  const [fsViewport, setFsViewport] = useState({ w: 0, h: 0 });
  const [hostSize, setHostSize] = useState({ w: 0, h: 0 });
  /** 画布缩放变化时强制重刷 WebGL 尺寸（R3F 在 CSS transform 下可能量错） */
  const viewportZoom = useStore((s) => {
    const z = s.transform?.[2];
    return typeof z === 'number' && z > 0 ? Math.round(z * 100) / 100 : 1;
  });

  /** 模块内：观察真实容器，保证 WebGL 与蓝框同大 */
  useLayoutEffect(() => {
    if (fullscreenActive) return;
    const el = fullscreenRef.current;
    if (!el) return;
    const sync = () => {
      const layoutW =
        typeof layoutWidth === 'number' && Number.isFinite(layoutWidth) && layoutWidth > 1
          ? Math.round(layoutWidth)
          : 0;
      const layoutH =
        typeof layoutHeight === 'number' && Number.isFinite(layoutHeight) && layoutHeight > 1
          ? Math.round(layoutHeight)
          : 0;
      const domW = Math.max(0, Math.round(el.clientWidth || 0));
      const domH = Math.max(0, Math.round(el.clientHeight || 0));
      // 放大瞬间 DOM 可能仍是旧值：与 layout 取较大值，避免截图框停在左上
      const w = Math.max(2, domW, layoutW);
      const h = Math.max(2, domH, layoutH);
      setHostSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    sync();
    const ro = new ResizeObserver(() => sync());
    ro.observe(el);
    const t1 = window.setTimeout(sync, 32);
    const t2 = window.setTimeout(sync, 120);
    return () => {
      ro.disconnect();
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [fullscreenActive, layoutWidth, layoutHeight, viewportZoom, textureUrl]);

  useEffect(() => {
    if (!fullscreenActive) {
      setFsViewport({ w: 0, h: 0 });
      return;
    }
    const sync = () => {
      const el = fullscreenRef.current;
      const w = el?.clientWidth || window.innerWidth;
      const h = el?.clientHeight || window.innerHeight;
      setFsViewport({ w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) });
    };
    sync();
    const t1 = window.setTimeout(sync, 32);
    const t2 = window.setTimeout(sync, 120);
    window.addEventListener('resize', sync);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('resize', sync);
    };
  }, [fullscreenActive]);

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

  /** 退出 360 会话：先离开浏览器全屏，再还原模块尺寸与平面视角 */
  const exitPanoramaSession = useCallback(async () => {
    if (!onRequestExit) return;
    try {
      if (document.fullscreenElement === fullscreenRef.current) {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.warn('[Panorama360Viewer] 退出全屏失败', e);
    }
    onRequestExit();
  }, [onRequestExit]);

  useEffect(() => {
    if (!onRegisterControls) return;
    onRegisterControls({
      toggleFullscreen,
      isFullscreen: () => document.fullscreenElement === fullscreenRef.current,
    });
    return () => onRegisterControls(null);
  }, [onRegisterControls, toggleFullscreen]);

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

  const resetView = useCallback(() => {
    if (fovAnimRafRef.current != null) {
      cancelAnimationFrame(fovAnimRafRef.current);
      fovAnimRafRef.current = null;
    }
    const fromFov = panoFov;
    const toFov = DEFAULT_FOV;
    const t0 = performance.now();
    if (Math.abs(fromFov - toFov) > 0.05) {
      const tickFov = (now: number) => {
        const raw = Math.min(1, (now - t0) / RESET_VIEW_MS);
        const e = easeOutCubic(raw);
        setPanoFov(fromFov + (toFov - fromFov) * e);
        if (raw < 1) {
          fovAnimRafRef.current = requestAnimationFrame(tickFov);
        } else {
          fovAnimRafRef.current = null;
          setPanoFov(toFov);
        }
      };
      fovAnimRafRef.current = requestAnimationFrame(tickFov);
    } else {
      setPanoFov(toFov);
    }
    try {
      orbitResetRef.current?.();
    } catch {
      /* ignore */
    }
  }, [panoFov]);

  useEffect(() => {
    if (!onScreenshotCaptured) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          setAspectPickerOpen((v) => {
            const next = !v;
            if (next) setPreviewAspectId(defaultCaptureAspect());
            return next;
          });
        }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onScreenshotCaptured, chrome, executeCaptureWithPreset, defaultCaptureAspect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // 浏览器全屏由系统 Esc 退出，不连带退出 360
      if (document.fullscreenElement) return;
      if (aspectPickerOpen) {
        e.preventDefault();
        e.stopPropagation();
        setAspectPickerOpen(false);
        return;
      }
      if (!onRequestExit) return;
      e.preventDefault();
      e.stopPropagation();
      void exitPanoramaSession();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [aspectPickerOpen, onRequestExit, exitPanoramaSession]);

  const textMuted = isDarkMode ? 'text-white/60' : 'text-gray-600';
  const safeLayoutW =
    typeof layoutWidth === 'number' && Number.isFinite(layoutWidth) && layoutWidth > 1
      ? Math.round(layoutWidth)
      : 0;
  const safeLayoutH =
    typeof layoutHeight === 'number' && Number.isFinite(layoutHeight) && layoutHeight > 1
      ? Math.round(layoutHeight)
      : 0;
  const moduleW = Math.max(2, safeLayoutW || 480);
  const moduleH = Math.max(2, safeLayoutH || 270);
  // 优先取 layout（节点 state 放大尺寸）：放大后 RO 偶发仍读到旧 clientWidth，
  // 若只信 hostSize 会把截图虚线框钉在左上旧坐标。百分比定位作第二道保险。
  const pixelW = fullscreenActive
    ? fsViewport.w > 1
      ? fsViewport.w
      : Math.max(2, typeof window !== 'undefined' ? window.innerWidth : moduleW)
    : Math.max(2, safeLayoutW || hostSize.w, hostSize.w, moduleW);
  const pixelH = fullscreenActive
    ? fsViewport.h > 1
      ? fsViewport.h
      : Math.max(2, typeof window !== 'undefined' ? window.innerHeight : moduleH)
    : Math.max(2, safeLayoutH || hostSize.h, hostSize.h, moduleH);
  const cropFrameW = pixelW;
  const cropFrameH = pixelH;
  const zoomSyncKey = Math.round(viewportZoom * 50) * 100000 + pixelW * 10 + pixelH;
  const cropPreviewRect = useMemo(
    () => computeCenterCropRect(cropFrameW, cropFrameH, ratioForPreset(previewAspectId)),
    [cropFrameW, cropFrameH, previewAspectId],
  );
  /** 用父级百分比定位，避免 hostSize/layout 像素与真实 DOM 不一致时框钉在左上旧尺寸 */
  const cropPreviewPct = useMemo(() => {
    const fw = Math.max(1, cropFrameW);
    const fh = Math.max(1, cropFrameH);
    return {
      left: (cropPreviewRect.left / fw) * 100,
      top: (cropPreviewRect.top / fh) * 100,
      width: (cropPreviewRect.width / fw) * 100,
      height: (cropPreviewRect.height / fh) * 100,
    };
  }, [cropPreviewRect, cropFrameW, cropFrameH]);
  // 尺寸变化不整页 remount Canvas（避免闪黑）；只靠 ForceCanvas / SyncCameraAspect 同步
  const canvasKey = useMemo(() => {
    const fs = fullscreenActive ? '-fs' : '';
    return `${instanceKey}-${textureUrl.slice(0, 80)}${fs}`;
  }, [instanceKey, textureUrl, fullscreenActive]);
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
  const isOverlay = chrome === 'overlay';
  const exitButtonTitle = exitTitle || exitLabel;

  if (!textureUrl.trim()) return null;

  if (webglBroken) {
    return (
      <div className={`flex items-center justify-center p-3 text-xs ${textMuted} ${className}`}>
        WebGL 预览失败，请换一张图或检查显存/驱动
      </div>
    );
  }

  const overlayIconBtn = (active = false) =>
    [
      'nodrag nopan inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors',
      active
        ? isDarkMode
          ? 'bg-white/20 text-white'
          : 'bg-black/15 text-gray-900'
        : isDarkMode
          ? 'text-white/90 hover:bg-white/15'
          : 'text-gray-800 hover:bg-black/10',
    ].join(' ');

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
        className={`nodrag nopan bg-black [&:fullscreen]:fixed [&:fullscreen]:inset-0 [&:fullscreen]:h-screen [&:fullscreen]:w-screen [&:fullscreen]:rounded-none ${
          isOverlay ? className : `relative w-full h-full min-h-0 flex flex-col ${className}`
        }`}
        style={
          fullscreenActive
            ? { width: '100%', height: '100%', position: 'relative' }
            : isOverlay
              ? { position: 'absolute', inset: 0, width: '100%', height: '100%' }
              : undefined
        }
      >
        {isOverlay ? (
          <div
              className="nexflow-pano360-host relative h-full w-full min-h-0 min-w-0 overflow-hidden bg-black"
              style={{
                width: '100%',
                height: '100%',
              }}
            >
              <Canvas
                key={canvasKey}
                className="nexflow-pano360-canvas absolute inset-0 touch-none"
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'block',
                }}
                frameloop="always"
                // offsetSize：用 layout 像素而非 getBoundingClientRect，避免 RF scale(zoom) 下 canvas 缩成屏幕宽、右侧留黑
                resize={{ scroll: false, debounce: 0, offsetSize: true }}
                gl={{
                  antialias: true,
                  alpha: false,
                  powerPreference: 'high-performance',
                  preserveDrawingBuffer: true,
                }}
                camera={{
                  position: [0, 0, 0.1],
                  fov: DEFAULT_FOV,
                  near: 0.01,
                  far: 100,
                  aspect: pixelW / Math.max(2, pixelH),
                }}
                dpr={[1, 1.5]}
                onCreated={({ gl }) => {
                  fillCanvasDom(gl.domElement);
                }}
              >
                <ForceCanvasPixelSize width={pixelW} height={pixelH} syncKey={zoomSyncKey} />
                <SyncCameraAspect width={pixelW} height={pixelH} />
                <PanoramaScene
                  url={textureUrl}
                  fov={panoFov}
                  aspectPresetRef={aspectPresetRef}
                  captureApiRef={captureApiRef}
                  onRegisterOrbitReset={registerOrbitReset}
                />
              </Canvas>

              {aspectPickerOpen && onScreenshotCaptured ? (
                <div className="pointer-events-none absolute inset-0 z-[15]" aria-hidden>
                  <div
                    className="absolute left-0 right-0 top-0 bg-black/45"
                    style={{ height: `${Math.max(0, cropPreviewPct.top)}%` }}
                  />
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-black/45"
                    style={{ top: `${Math.max(0, cropPreviewPct.top + cropPreviewPct.height)}%` }}
                  />
                  <div
                    className="absolute bg-black/45"
                    style={{
                      left: 0,
                      top: `${Math.max(0, cropPreviewPct.top)}%`,
                      width: `${Math.max(0, cropPreviewPct.left)}%`,
                      height: `${Math.max(0, cropPreviewPct.height)}%`,
                    }}
                  />
                  <div
                    className="absolute right-0 bg-black/45"
                    style={{
                      left: `${Math.max(0, cropPreviewPct.left + cropPreviewPct.width)}%`,
                      top: `${Math.max(0, cropPreviewPct.top)}%`,
                      height: `${Math.max(0, cropPreviewPct.height)}%`,
                    }}
                  />
                  <div
                    className="absolute box-border border border-dashed border-white/90"
                    style={{
                      left: `${cropPreviewPct.left}%`,
                      top: `${cropPreviewPct.top}%`,
                      width: `${cropPreviewPct.width}%`,
                      height: `${cropPreviewPct.height}%`,
                    }}
                  />
                </div>
              ) : null}

              {onRequestExit ? (
                <button
                  type="button"
                  className={`nodrag nopan absolute top-3 right-3 z-[50] inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium shadow-lg backdrop-blur-md transition-colors pointer-events-auto ${
                    isDarkMode
                      ? 'bg-black/55 text-white ring-1 ring-white/20 hover:bg-black/75'
                      : 'bg-white/90 text-gray-900 ring-1 ring-black/10 hover:bg-white'
                  }`}
                  style={{ pointerEvents: 'all' }}
                  title={exitButtonTitle}
                  aria-label={exitButtonTitle}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    void exitPanoramaSession();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                >
                  {fullscreenActive ? (
                    <Minimize2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  ) : (
                    <X className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  )}
                  <span className="whitespace-nowrap">{exitLabel}</span>
                </button>
              ) : null}

              <div
                className="nexflow-pano360-chrome nodrag nopan absolute bottom-3 left-1/2 z-20 flex w-max max-w-[calc(100%-16px)] -translate-x-1/2 flex-col items-center gap-2 pointer-events-none"
                onPointerDown={(e) => e.stopPropagation()}
              >
                {dragHint && !aspectPickerOpen ? (
                  <span
                    className={`text-[10px] font-medium tracking-wide drop-shadow ${
                      isDarkMode ? 'text-white/55' : 'text-gray-700/80'
                    }`}
                  >
                    {dragHint}
                  </span>
                ) : null}

                {aspectPickerOpen && onScreenshotCaptured ? (
                  <div
                    className={`pointer-events-auto w-max max-w-full overflow-x-auto rounded-2xl px-2 py-2 shadow-xl backdrop-blur-md ${
                      isDarkMode
                        ? 'bg-black/55 ring-1 ring-white/15'
                        : 'bg-white/90 ring-1 ring-black/10'
                    }`}
                    onMouseEnter={openAspectPickerHover}
                    onMouseLeave={scheduleCloseAspectPickerHover}
                    onPointerDown={(e) => e.stopPropagation()}
                    role="menu"
                    aria-label={screenshotLabel}
                  >
                    <div className="flex w-max flex-nowrap items-end justify-center gap-0.5">
                      {ASPECT_PRESETS.map((p) => {
                        const label = p.id === 'adaptive' ? aspectAdaptiveLabel : p.label;
                        const active = previewAspectId === p.id;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            role="menuitem"
                            title={label}
                            disabled={isCapturing}
                            onMouseEnter={() => setPreviewAspectId(p.id)}
                            onFocus={() => setPreviewAspectId(p.id)}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              if (isCapturing) return;
                              setPreviewAspectId(p.id);
                              void executeCaptureWithPreset(p.id);
                            }}
                            className={`nodrag nopan flex min-w-[48px] flex-col items-center gap-1.5 rounded-xl px-2 py-2 transition-colors ${
                              active
                                ? isDarkMode
                                  ? 'bg-white/18 ring-1 ring-white/55'
                                  : 'bg-black/8 ring-1 ring-black/25'
                                : isDarkMode
                                  ? 'hover:bg-white/12'
                                  : 'hover:bg-black/6'
                            } ${isCapturing ? 'opacity-50 pointer-events-none' : ''}`}
                          >
                            <AspectRatioGlyph id={p.id} active={active} isDarkMode={isDarkMode} />
                            <span
                              className={`whitespace-nowrap text-[10px] font-medium leading-none ${
                                isDarkMode ? 'text-white/90' : 'text-gray-800'
                              }`}
                            >
                              {label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                <div
                  className={`pointer-events-auto flex items-center gap-0.5 rounded-full px-1.5 py-1 shadow-lg backdrop-blur-md ${
                    isDarkMode
                      ? 'bg-white/14 ring-1 ring-white/18'
                      : 'bg-white/85 ring-1 ring-black/10'
                  }`}
                >
                  <button
                    type="button"
                    disabled={isCapturing || !onScreenshotCaptured}
                    title={screenshotBtnTitle}
                    aria-label={screenshotLabel}
                    aria-expanded={aspectPickerOpen}
                    aria-haspopup="menu"
                    onMouseEnter={openAspectPickerHover}
                    onMouseLeave={scheduleCloseAspectPickerHover}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      if (!onScreenshotCaptured || isCapturing) return;
                      if (!aspectPickerOpen) {
                        setPreviewAspectId(defaultCaptureAspect());
                      }
                      setAspectPickerOpen((v) => !v);
                    }}
                    className={`${overlayIconBtn(aspectPickerOpen)} ${
                      isCapturing || !onScreenshotCaptured ? 'opacity-40 pointer-events-none' : ''
                    }`}
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    title={resetFovLabel}
                    aria-label={resetFovLabel}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      resetView();
                    }}
                    className={overlayIconBtn(false)}
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
        ) : (
          <>
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
                    onClick={resetView}
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
          </>
        )}
      </div>
    </PanoramaErrorBoundary>
  );
};

export default memo(Panorama360Viewer);
