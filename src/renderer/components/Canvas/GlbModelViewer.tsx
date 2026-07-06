import React, { Suspense, Component, memo, useRef, useState, useEffect, useLayoutEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Center,
  Environment,
  GizmoHelper,
  GizmoViewport,
  Grid,
  OrbitControls,
  useGLTF,
  useTexture,
} from '@react-three/drei';
import * as THREE from 'three';
import {
  captureWebGLCanvasToDataUrl,
  installGltfDisplayRefresh,
  prepareGltfSceneForDisplay,
} from '../../utils/glbViewerUtils';

useGLTF.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
import { canCreateWebGLContext } from '../../utils/webglSupport';
import GlbViewerPlaceholder from './GlbViewerPlaceholder';

const MAX_DPR = 1.25;

function GlbTextureOverride({
  textureUrl,
  target,
}: {
  textureUrl: string;
  target: THREE.Object3D;
}) {
  const tex = useTexture(textureUrl);
  React.useLayoutEffect(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    target.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((m) => {
        if (!m) return;
        const std = m as THREE.MeshStandardMaterial;
        std.map = tex;
        std.vertexColors = false;
        /** 强制低金属度，保留 PBR 光照计算 */
        std.metalnessMap = null;
        std.roughnessMap = null;
        std.metalness = 0;
        std.roughness = 0.68;
        std.needsUpdate = true;
      });
    });
  }, [tex, textureUrl, target]);
  return null;
}

export type GlbCameraFramingMode = 'default' | 'closeup' | 'fit';

/** 生成后默认近距离构图（与 ComfyUI 预览类似）；fit：4:3 等预览框内完整展示模型 */
function GlbCameraFraming({
  root,
  mode,
  framingKey,
}: {
  root: THREE.Object3D;
  mode: GlbCameraFramingMode;
  framingKey: string;
}) {
  const { camera, controls } = useThree();
  const lastKeyRef = useRef('');

  useLayoutEffect(() => {
    if (mode === 'default' || !root) return;
    if (lastKeyRef.current === framingKey) return;

    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;

    const persp = camera as THREE.PerspectiveCamera;
    const center = box.getCenter(new THREE.Vector3());
    let distance: number;
    let dir: THREE.Vector3;

    if (mode === 'fit') {
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const radius = Math.max(sphere.radius, 0.001);
      const vFovRad = (persp.fov * Math.PI) / 180;
      const aspect = Math.max(persp.aspect, 0.01);
      const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * aspect);
      const distV = radius / Math.sin(vFovRad / 2);
      const distH = radius / Math.sin(hFovRad / 2);
      distance = Math.max(distV, distH) * 1.18;
      dir = new THREE.Vector3(0.42, 0.32, 1).normalize();
    } else {
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 0.001);
      const fovRad = (persp.fov * Math.PI) / 180;
      const fitDist = (maxDim / 2) / Math.tan(fovRad / 2);
      distance = fitDist * 0.68;
      dir = new THREE.Vector3(0.12, 0.14, 1).normalize();
    }

    camera.position.copy(center).add(dir.clone().multiplyScalar(distance));
    persp.updateProjectionMatrix();

    const oc = controls as { target?: THREE.Vector3; update?: () => void } | null;
    if (oc?.target) {
      oc.target.copy(center);
      oc.update?.();
    }
    lastKeyRef.current = framingKey;
  }, [root, mode, framingKey, camera, controls]);

  useEffect(() => {
    lastKeyRef.current = '';
  }, [framingKey]);

  return null;
}

/** 模型绕 Y 轴缓慢自转（资产库悬停预览，约一圈/24s） */
function GlbTurntable({
  speed,
  children,
}: {
  speed: number;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * speed;
    }
  });
  return <group ref={groupRef}>{children}</group>;
}

function GlbMesh({
  url,
  overrideTextureUrl,
  cameraFraming = 'default',
  onModelReady,
}: {
  url: string;
  overrideTextureUrl?: string;
  cameraFraming?: GlbCameraFramingMode;
  onModelReady?: () => void;
}) {
  const { scene, textures } = useGLTF(url);
  const displayScene = React.useMemo(() => scene.clone() as THREE.Object3D, [scene, url]);
  const readyKeyRef = useRef('');
  const reportedReadyRef = useRef(false);

  useLayoutEffect(() => {
    for (const tex of textures || []) {
      if (!tex) continue;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
    }
  }, [textures, url]);

  useLayoutEffect(() => {
    reportedReadyRef.current = false;
    return installGltfDisplayRefresh(displayScene, (mapCount) => {
      if (import.meta.env.DEV) {
        console.log(`[GlbModelViewer] ${url.slice(-48)} baseColor贴图数=${mapCount}`);
      }
      if (!reportedReadyRef.current && mapCount > 0) {
        reportedReadyRef.current = true;
        onModelReady?.();
      }
    });
  }, [displayScene, url, onModelReady]);

  useLayoutEffect(() => {
    const key = `${url}|${displayScene.uuid}`;
    if (readyKeyRef.current === key) return;
    readyKeyRef.current = key;
    onModelReady?.();
  }, [url, displayScene, onModelReady]);

  const overlay = overrideTextureUrl?.trim();
  const framingKey = `${url}|${overlay}|${cameraFraming}`;
  return (
    <Center>
      <primitive object={displayScene} />
      {overlay ? <GlbTextureOverride textureUrl={overlay} target={displayScene} /> : null}
      <GlbCameraFraming root={displayScene} mode={cameraFraming} framingKey={framingKey} />
    </Center>
  );
}

function GlbScene({
  url,
  showGridWhenEmpty,
  overrideTextureUrl,
  cameraFraming,
  showGrid = true,
  showGizmo = true,
  autoRotate = false,
  autoRotateSpeed = 0.4,
  controlsInteractive = true,
  controlMinDistance = 0.35,
  controlMaxDistance = 14,
  gridStyle = 'default',
  showFog = true,
  turntableRotate = false,
  turntableSpeed = Math.PI / 12,
  useStudioEnvironment = true,
  usePureBlackBackground = false,
  usePureWhiteBackground = false,
  onModelReady,
}: {
  url: string;
  showGridWhenEmpty: boolean;
  overrideTextureUrl?: string;
  cameraFraming?: GlbCameraFramingMode;
  showGrid?: boolean;
  showGizmo?: boolean;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  controlsInteractive?: boolean;
  controlMinDistance?: number;
  controlMaxDistance?: number;
  gridStyle?: 'default' | 'showcase';
  showFog?: boolean;
  turntableRotate?: boolean;
  /** 弧度/秒，默认约 24 秒转一圈 */
  turntableSpeed?: number;
  /** false：资产库悬停等轻量预览，跳过 HDR 环境贴图以加快首帧 */
  useStudioEnvironment?: boolean;
  /** 全屏纯黑背景 */
  usePureBlackBackground?: boolean;
  /** 全屏纯白背景 */
  usePureWhiteBackground?: boolean;
  onModelReady?: () => void;
}) {
  const hasModel = !!url?.trim();
  const gridProps =
    gridStyle === 'showcase'
      ? {
          cellSize: 0.32,
          sectionSize: 1.6,
          cellColor: '#5a5a64',
          sectionColor: '#c4c4cc',
          fadeDistance: 26,
          fadeStrength: 1,
        }
      : {
          cellSize: 0.35,
          sectionSize: 1.75,
          cellColor: '#3f3f46',
          sectionColor: '#71717a',
          fadeDistance: 22,
          fadeStrength: 1.2,
        };
  const bgColor = usePureWhiteBackground ? '#ffffff' : usePureBlackBackground ? '#000000' : '#1a1a1e';
  const ambientIntensity = usePureWhiteBackground ? 0.92 : useStudioEnvironment ? 0.55 : 0.72;
  const hemiIntensity = usePureWhiteBackground ? 1.05 : useStudioEnvironment ? 0.65 : 0.85;
  const keyLightIntensity = usePureWhiteBackground ? 1.55 : useStudioEnvironment ? 1.15 : 1.35;
  const fillLightIntensity = usePureWhiteBackground ? 0.75 : useStudioEnvironment ? 0.35 : 0.5;
  return (
    <>
      <color attach="background" args={[bgColor]} />
      {showFog && !usePureWhiteBackground ? <fog attach="fog" args={[bgColor, 14, 32]} /> : null}
      <ambientLight intensity={ambientIntensity} />
      <hemisphereLight args={['#ffffff', usePureWhiteBackground ? '#cccccc' : '#444455', hemiIntensity]} />
      <directionalLight position={[6, 10, 4]} intensity={keyLightIntensity} />
      <directionalLight position={[-4, 6, -3]} intensity={fillLightIntensity} />
      {usePureWhiteBackground ? (
        <directionalLight position={[0, 4, 8]} intensity={0.85} />
      ) : null}
      {useStudioEnvironment ? <Environment preset="studio" environmentIntensity={0.85} /> : null}
      {turntableRotate ? (
        <GlbTurntable speed={turntableSpeed}>
          {showGrid ? <Grid position={[0, 0, 0]} infiniteGrid {...gridProps} /> : null}
          {(hasModel || showGridWhenEmpty) && (
            <Suspense fallback={null}>
              {hasModel ? (
                <GlbMesh
                  url={url}
                  overrideTextureUrl={overrideTextureUrl}
                  cameraFraming={cameraFraming}
                  onModelReady={onModelReady}
                />
              ) : null}
            </Suspense>
          )}
        </GlbTurntable>
      ) : (
        <>
          {showGrid ? <Grid position={[0, 0, 0]} infiniteGrid {...gridProps} /> : null}
          {(hasModel || showGridWhenEmpty) && (
            <Suspense fallback={null}>
              {hasModel ? (
                <GlbMesh
                  url={url}
                  overrideTextureUrl={overrideTextureUrl}
                  cameraFraming={cameraFraming}
                  onModelReady={onModelReady}
                />
              ) : null}
            </Suspense>
          )}
        </>
      )}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={controlMinDistance}
        maxDistance={controlMaxDistance}
        zoomSpeed={controlsInteractive ? 1.1 : 1}
        autoRotate={autoRotate && !turntableRotate}
        autoRotateSpeed={autoRotateSpeed}
        enableRotate={controlsInteractive || (autoRotate && !turntableRotate)}
        enablePan={controlsInteractive}
        enableZoom={controlsInteractive}
      />
      {hasModel && showGizmo ? (
        <GizmoHelper alignment="bottom-left" margin={[48, 48]}>
          <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="#e4e4e7" />
        </GizmoHelper>
      ) : null}
    </>
  );
}

type CanvasBoundaryProps = {
  children: React.ReactNode;
  fallback: React.ReactNode;
  onError?: () => void;
};

type CanvasBoundaryState = { failed: boolean };

class GlbCanvasErrorBoundary extends Component<CanvasBoundaryProps, CanvasBoundaryState> {
  state: CanvasBoundaryState = { failed: false };

  static getDerivedStateFromError(): CanvasBoundaryState {
    return { failed: true };
  }

  componentDidCatch(err: Error) {
    console.warn('[GlbModelViewer] WebGL/Canvas 错误:', err.message);
    this.props.onError?.();
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

export interface GlbModelViewerProps {
  url: string;
  className?: string;
  showGridWhenEmpty?: boolean;
  renderActive?: boolean;
  /** false 时不创建 WebGL 上下文（用于未选中节点，避免超出浏览器上下文上限） */
  enabled?: boolean;
  /** 可选：用 2D 图覆盖模型表面（仅预览） */
  overrideTextureUrl?: string;
  placeholderMessage?: string;
  placeholderSubMessage?: string;
  /** 由父组件在失焦前调用，截取当前帧为 data URL */
  captureRef?: React.MutableRefObject<(() => string | null) | null>;
  /** closeup：近距离；fit：按视口比例完整框选模型 */
  cameraFraming?: GlbCameraFramingMode;
  /** 缓慢自动绕模型旋转（轨道相机） */
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  /** 模型绕 Y 轴自转（资产库悬停预览，与 autoRotate 二选一） */
  turntableRotate?: boolean;
  turntableSpeed?: number;
  /** false 时禁用拖拽/缩放，仅展示自动旋转 */
  controlsInteractive?: boolean;
  controlMinDistance?: number;
  controlMaxDistance?: number;
  /** false：全屏等场景，不加 React Flow 的 nodrag/nowheel 类 */
  embeddedInFlow?: boolean;
  showGrid?: boolean;
  showGizmo?: boolean;
  gridStyle?: 'default' | 'showcase';
  showFog?: boolean;
  /** 资产库悬停等场景：不加载 studio HDR，加快首帧 */
  useStudioEnvironment?: boolean;
  /** 全屏纯黑背景 */
  usePureBlackBackground?: boolean;
  /** 全屏纯白背景 */
  usePureWhiteBackground?: boolean;
  onModelReady?: () => void;
}

const GlbModelViewer: React.FC<GlbModelViewerProps> = ({
  url,
  className = '',
  showGridWhenEmpty = true,
  renderActive = true,
  enabled = true,
  overrideTextureUrl,
  placeholderMessage,
  placeholderSubMessage,
  captureRef,
  cameraFraming = 'default',
  autoRotate = false,
  autoRotateSpeed = 0.4,
  controlsInteractive = true,
  controlMinDistance = 0.35,
  controlMaxDistance = 14,
  embeddedInFlow = true,
  showGrid = true,
  showGizmo = true,
  gridStyle = 'default',
  showFog = true,
  turntableRotate = false,
  turntableSpeed = Math.PI / 12,
  useStudioEnvironment = true,
  usePureBlackBackground = false,
  usePureWhiteBackground = false,
  onModelReady,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const [sizeReady, setSizeReady] = useState(false);
  const [contextFailed, setContextFailed] = useState(false);
  const [webglCapable, setWebglCapable] = useState(true);

  useEffect(() => {
    setContextFailed(false);
  }, [usePureWhiteBackground, usePureBlackBackground, showGrid]);

  useEffect(() => {
    if (!captureRef) return;
    captureRef.current = () => {
      const canvas = glRef.current?.domElement;
      if (!canvas) return null;
      return captureWebGLCanvasToDataUrl(canvas);
    };
    return () => {
      captureRef.current = null;
    };
  }, [captureRef, contextFailed, sizeReady, enabled]);

  useEffect(() => {
    if (!enabled) return;
    setWebglCapable(canCreateWebGLContext());
  }, [enabled]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) {
      setSizeReady(false);
      return;
    }
    const check = () => {
      const { width, height } = el.getBoundingClientRect();
      setSizeReady(width >= 8 && height >= 8);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  const dpr =
    typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, MAX_DPR) : 1;
  /** 全屏预览（非 embeddedInFlow）时进一步降低 DPR，减少 GPU 压力 */
  const effectiveDpr = embeddedInFlow ? dpr : Math.min(dpr, 1.0);

  const placeholder = (
    <GlbViewerPlaceholder
      className="absolute inset-0 w-full h-full"
      message={placeholderMessage}
      subMessage={placeholderSubMessage}
    />
  );

  if (!enabled || contextFailed || !webglCapable) {
    return (
      <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
        <GlbViewerPlaceholder
          className="absolute inset-0 w-full h-full"
          message={
            placeholderMessage ||
            (contextFailed || !webglCapable ? 'WebGL 不可用或上下文已满' : undefined)
          }
          subMessage={
            placeholderSubMessage ||
            (contextFailed || !webglCapable
              ? '请选中本节点预览，或使用右上角全屏预览；可关闭其他 3D 预览后重试'
              : undefined)
          }
        />
      </div>
    );
  }

  if (!sizeReady) {
    return (
      <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
        {placeholder}
      </div>
    );
  }

  const flowGuard = embeddedInFlow ? 'nodrag nopan nowheel' : '';
  const interactionStyle = controlsInteractive
    ? { touchAction: 'none' as const, cursor: 'grab' }
    : { touchAction: 'none' as const };

  return (
    <div
      ref={containerRef}
      className={`${flowGuard} relative overflow-hidden ${
        usePureWhiteBackground ? 'bg-white' : usePureBlackBackground ? 'bg-black' : 'bg-[#1a1a1e]'
      } ${className}`}
      style={interactionStyle}
    >
      <GlbCanvasErrorBoundary
        fallback={placeholder}
        onError={() => setContextFailed(true)}
      >
        <Canvas
          frameloop={renderActive ? 'always' : 'never'}
          dpr={effectiveDpr}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'default',
            preserveDrawingBuffer: true,
            failIfMajorPerformanceCaveat: false,
          }}
          onCreated={({ gl }) => {
            glRef.current = gl;
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
        >
          <GlbScene
            url={url}
            showGridWhenEmpty={showGridWhenEmpty}
            overrideTextureUrl={overrideTextureUrl}
            cameraFraming={cameraFraming}
            showGrid={showGrid}
            showGizmo={showGizmo}
            autoRotate={autoRotate}
            autoRotateSpeed={autoRotateSpeed}
            controlsInteractive={controlsInteractive}
            controlMinDistance={controlMinDistance}
            controlMaxDistance={controlMaxDistance}
            gridStyle={gridStyle}
            showFog={showFog}
            turntableRotate={turntableRotate}
            turntableSpeed={turntableSpeed}
            useStudioEnvironment={useStudioEnvironment}
            usePureBlackBackground={usePureBlackBackground}
            usePureWhiteBackground={usePureWhiteBackground}
            onModelReady={onModelReady}
          />
        </Canvas>
      </GlbCanvasErrorBoundary>
    </div>
  );
};

export default memo(GlbModelViewer, (prev, next) => {
  return (
    prev.url === next.url &&
    prev.className === next.className &&
    prev.showGridWhenEmpty === next.showGridWhenEmpty &&
    prev.renderActive === next.renderActive &&
    prev.enabled === next.enabled &&
    prev.overrideTextureUrl === next.overrideTextureUrl &&
    prev.placeholderMessage === next.placeholderMessage &&
    prev.placeholderSubMessage === next.placeholderSubMessage &&
    prev.captureRef === next.captureRef &&
    prev.cameraFraming === next.cameraFraming &&
    prev.autoRotate === next.autoRotate &&
    prev.autoRotateSpeed === next.autoRotateSpeed &&
    prev.controlsInteractive === next.controlsInteractive &&
    prev.controlMinDistance === next.controlMinDistance &&
    prev.controlMaxDistance === next.controlMaxDistance &&
    prev.embeddedInFlow === next.embeddedInFlow &&
    prev.showGrid === next.showGrid &&
    prev.showGizmo === next.showGizmo &&
    prev.gridStyle === next.gridStyle &&
    prev.showFog === next.showFog &&
    prev.turntableRotate === next.turntableRotate &&
    prev.turntableSpeed === next.turntableSpeed &&
    prev.useStudioEnvironment === next.useStudioEnvironment &&
    prev.usePureBlackBackground === next.usePureBlackBackground &&
    prev.usePureWhiteBackground === next.usePureWhiteBackground &&
    prev.onModelReady === next.onModelReady
  );
});
