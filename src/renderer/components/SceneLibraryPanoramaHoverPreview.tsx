import React, { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { canCreateWebGLContext } from '../utils/webglSupport';
import type { SceneLibraryItem } from './characterListShared';
import { isLoadableMediaUrl, sceneDisplay3dImageUrl } from './characterListShared';

const PREVIEW_WIDTH = 400;
const PREVIEW_HEIGHT = 300;
const ASSET_LIBRARY_HOVER_SIDE_GAP = '1cm';
/** 环视角速度（弧度/秒），约 28 秒转一圈 */
const PANORAMA_YAW_SPEED = 0.22;
const PANORAMA_FOV = 70;

let sideGapPxCache: number | null = null;
function getSideGapPx(): number {
  if (sideGapPxCache != null) return sideGapPxCache;
  if (typeof document === 'undefined') {
    sideGapPxCache = 38;
    return sideGapPxCache;
  }
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;left:-9999px;width:${ASSET_LIBRARY_HOVER_SIDE_GAP};height:1px;visibility:hidden;pointer-events:none`;
  document.body.appendChild(probe);
  sideGapPxCache = probe.getBoundingClientRect().width;
  probe.remove();
  return sideGapPxCache;
}

function hoverFrameClass(isDarkMode: boolean): string {
  return isDarkMode
    ? 'rounded-xl overflow-hidden border border-white/15 bg-zinc-900/55 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-sm'
    : 'rounded-xl overflow-hidden border border-black/10 bg-white/65 shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-sm';
}

class PanoramaTextureErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.warn('[SceneLibraryPanoramaHoverPreview] 全景贴图加载失败:', err);
  }

  componentDidUpdate(prevProps: { children: React.ReactNode }) {
    if (prevProps.children !== this.props.children && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

function EquirectSphere({ url }: { url: string }) {
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

/** 相机在球心缓慢水平环视（不依赖 OrbitControls.autoRotate） */
function PanoramaSlowYawView() {
  const { camera } = useThree();
  const yawRef = useRef(0);

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(0, 0, 0.01);
    cam.lookAt(1, 0, 0);
    cam.up.set(0, 1, 0);
    yawRef.current = 0;
  }, [camera]);

  useFrame((_, delta) => {
    const cam = camera as THREE.PerspectiveCamera;
    yawRef.current += delta * PANORAMA_YAW_SPEED;
    const yaw = yawRef.current;
    const lookDist = 50;
    cam.position.set(Math.sin(yaw) * 0.01, 0, Math.cos(yaw) * 0.01);
    cam.lookAt(Math.sin(yaw) * lookDist, 0, Math.cos(yaw) * lookDist);
    cam.up.set(0, 1, 0);
  });

  return null;
}

function PanoramaHoverScene({ url }: { url: string }) {
  return (
    <>
      <color attach="background" args={['#050508']} />
      <PanoramaTextureErrorBoundary>
        <Suspense fallback={null}>
          <EquirectSphere url={url} />
        </Suspense>
      </PanoramaTextureErrorBoundary>
      <PanoramaSlowYawView />
    </>
  );
}

export interface SceneLibraryPanoramaHoverPreviewProps {
  scene: SceneLibraryItem;
  anchorRect: DOMRect;
  isDarkMode: boolean;
}

const SceneLibraryPanoramaHoverPreview: React.FC<SceneLibraryPanoramaHoverPreviewProps> = ({
  scene,
  anchorRect,
  isDarkMode,
}) => {
  const textureUrl = sceneDisplay3dImageUrl(scene);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const sideGap = getSideGapPx();
  const webglOk = canCreateWebGLContext();
  const canLoadTexture = isLoadableMediaUrl(textureUrl);

  const updatePosition = useCallback(() => {
    const el = panelRef.current;
    if (!el) return;
    const panelW = el.offsetWidth;
    const panelH = el.offsetHeight || PREVIEW_HEIGHT;
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
  }, [updatePosition, scene.id, textureUrl]);

  if (!textureUrl.trim() || !canLoadTexture) return null;

  return createPortal(
    <div
      ref={panelRef}
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
      <div className={hoverFrameClass(isDarkMode)}>
        <div
          className="relative overflow-hidden bg-[#050508]"
          style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
        >
          {webglOk ? (
            <Canvas
              key={`${scene.id}-${textureUrl.slice(-48)}`}
              className="absolute inset-0 h-full w-full"
              frameloop="always"
              dpr={Math.min(window.devicePixelRatio || 1, 1.25)}
              camera={{ position: [0, 0, 0.01], fov: PANORAMA_FOV, near: 0.001, far: 100 }}
              gl={{ antialias: false, alpha: false, powerPreference: 'low-power' }}
            >
              <PanoramaHoverScene url={textureUrl} />
            </Canvas>
          ) : (
            <img src={textureUrl} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default SceneLibraryPanoramaHoverPreview;
