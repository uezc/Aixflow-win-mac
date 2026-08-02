import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

export interface CameraControlValue {
  rotationX: number; // deg
  rotationY: number; // deg
  scale: number;
  fov: number;
}

interface CubeCameraControllerProps {
  value: CameraControlValue;
  onChange: (next: CameraControlValue) => void;
  onChangeEnd?: (next: CameraControlValue) => void;
  onInvalidateReady?: (invalidate: () => void) => void;
  onContextLost?: () => void;
  onDraftModeChange?: (draft: boolean) => void;
  inputImageUrl?: string;
  frontThumbnailUrl?: string;
  isDarkMode?: boolean;
  /** 侧面文字：中文 / 英文 */
  locale?: 'zh' | 'en';
}

const TARGET = new THREE.Vector3(0, 0, 0);
const MIN_TILT = -45;
const MAX_TILT = 45;
const MIN_SCALE = 1.2;
const MAX_SCALE = 6.5;
const SNAP_THRESHOLD_DEG = 6;
const KEY_YAW_ANGLES = [0, -45, 45, 180, -180];
const KEY_PITCH_ANGLES = [0];
const MIN_AZIMUTH_ANGLE = -Math.PI;
const MAX_AZIMUTH_ANGLE = Math.PI;
const MIN_POLAR_ANGLE = Math.PI / 4;
const MAX_POLAR_ANGLE = (3 * Math.PI) / 4;

function disposeMaterial(material: any) {
  if (!material) return;
  const mats = Array.isArray(material) ? material : [material];
  mats.forEach((m) => {
    if (!m) return;
    // 不 dispose map 纹理：正面贴图 / 侧面标签由各自 effect 管理，避免被误释放导致空白
    if (typeof m.dispose === 'function') m.dispose();
  });
}

function cleanupResources(scene: THREE.Scene) {
  scene.traverse((obj: any) => {
    if (obj?.isMesh || obj?.isLineSegments) {
      if (obj.geometry?.dispose) obj.geometry.dispose();
      disposeMaterial(obj.material);
    }
  });
}

function snapToKeyAngles(value: CameraControlValue): CameraControlValue {
  let rotY = value.rotationY;
  let rotX = value.rotationX;
  for (const key of KEY_YAW_ANGLES) {
    if (Math.abs(rotY - key) <= SNAP_THRESHOLD_DEG) {
      rotY = key;
      break;
    }
  }
  for (const key of KEY_PITCH_ANGLES) {
    if (Math.abs(rotX - key) <= SNAP_THRESHOLD_DEG) {
      rotX = key;
      break;
    }
  }
  return { ...value, rotationX: rotX, rotationY: rotY };
}

function toCameraPosition(rotationX: number, rotationY: number, scale: number): THREE.Vector3 {
  const tilt = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(rotationX, MIN_TILT, MAX_TILT));
  const yaw = THREE.MathUtils.degToRad(rotationY);
  const distance = THREE.MathUtils.clamp(scale, MIN_SCALE, MAX_SCALE);
  const x = Math.sin(yaw) * Math.cos(tilt) * distance;
  const y = Math.sin(tilt) * distance;
  const z = Math.cos(yaw) * Math.cos(tilt) * distance;
  return new THREE.Vector3(x, y, z);
}

const DRAFT_PIXEL_RATIO = 1;
const FULL_PIXEL_RATIO = 1;
const DRAFT_RESTORE_DELAY_MS = 100;
const TARGET_FPS = 30;
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS;
/** 3D 纹理最大边长，超限时缩放下采样，降低显存压力避免渲染进程崩溃 */
const MAX_TEXTURE_DIM = 1024;

/** 正面固定图案：边框框，中间写着 "image" */
function createImageFrameTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.fillStyle = '#f5ead8';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#6b7280';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, size - 16, size - 16);
  ctx.fillStyle = '#374151';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('image', size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** 创建单面标签纹理：白字、小字号、底色与方框灰色一致 */
function createLabelTexture(text: string, isDarkMode: boolean): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  const bgColor = isDarkMode ? '#5f6368' : '#e2e8f0';
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = isDarkMode ? '#ffffff' : '#334155';
  // 中文单字略大，英文短词略小
  const isCjk = /[\u4e00-\u9fff]/.test(text);
  ctx.font = `bold ${isCjk ? 28 : 14}px system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function cubeSideLabels(): [string, string, string, string, string] {
  // 对应 BoxGeometry: +X -X +Y -Y -Z（正面 +Z 单独贴图）
  return ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'BACK'];
}

function loadTextureWithMaxSize(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    // Electron 下 Image 对 local-resource:// 可能无法正确加载（协议流式响应），改为使用 file:// 以可靠显示（与 VideoPreview 一致）
    let loadUrl = url;
    if (url.startsWith('local-resource://') && typeof window !== 'undefined' && (window as any).electronAPI) {
      try {
        const pathPart = url.replace(/^local-resource:\/\/+/, '');
        loadUrl = pathPart ? `file:///${decodeURIComponent(pathPart).replace(/\\/g, '/')}` : url;
      } catch {
        loadUrl = url;
      }
    }
    const img = new Image();
    if (loadUrl.startsWith('http://') || loadUrl.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      try {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w <= 0 || h <= 0) {
          reject(new Error('Invalid image dimensions'));
          return;
        }
        if (w <= MAX_TEXTURE_DIM && h <= MAX_TEXTURE_DIM) {
          const tex = new THREE.Texture(img);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.needsUpdate = true;
          resolve(tex);
          return;
        }
        const scale = MAX_TEXTURE_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas 2d unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        resolve(tex);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = loadUrl;
  });
}

function applyCoverUvToSquare(texture: THREE.Texture) {
  const img = texture.image as { width?: number; height?: number } | undefined;
  const width = Number(img?.width || 0);
  const height = Number(img?.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

  // 正面是 1:1 方形，使用中心裁切实现“铺满一面”的 cover 效果
  const imageAspect = width / height;
  const targetAspect = 1;
  let repeatX = 1;
  let repeatY = 1;

  if (imageAspect > targetAspect) {
    repeatX = targetAspect / imageAspect;
  } else {
    repeatY = imageAspect / targetAspect;
  }

  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.offset.set((1 - repeatX) * 0.5, (1 - repeatY) * 0.5);
  texture.needsUpdate = true;
}

const SceneBridge: React.FC<CubeCameraControllerProps> = ({ value, onChange, onChangeEnd, onInvalidateReady, onContextLost, onDraftModeChange, inputImageUrl, frontThumbnailUrl, isDarkMode }) => {
  const { camera, gl, scene, invalidate } = useThree();
  const controlsRef = useRef<any>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const edgeRef = useRef<THREE.LineSegments>(null);
  const syncingRef = useRef(false);
  const isInteractingRef = useRef(false);
  const invalidateRafRef = useRef<number | null>(null);
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInvalidateTsRef = useRef(0);
  const dampingRafRef = useRef<number | null>(null);
  const emitRafRef = useRef<number | null>(null);
  const pendingSampleRef = useRef<CameraControlValue | null>(null);
  const lastEmitTimeRef = useRef(0);
  const frontTextureRef = useRef<THREE.Texture | null>(null);
  const draftRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetRafRef = useRef<number | null>(null);
  const isDraftModeRef = useRef(false);
  const [meshVersion, setMeshVersion] = useState(0);
  const [frontTexture, setFrontTexture] = useState<THREE.Texture | null>(null);
  const [labelTextures, setLabelTextures] = useState<THREE.CanvasTexture[]>([]);
  const [draftMode, setDraftMode] = useState(false);

  const disposeCurrentRefs = useCallback(() => {
    meshRef.current?.geometry?.dispose?.();
    disposeMaterial(meshRef.current?.material);
    edgeRef.current?.geometry?.dispose?.();
    disposeMaterial(edgeRef.current?.material);
  }, []);

  const scheduleInvalidate = useCallback(() => {
    if (invalidateRafRef.current !== null || invalidateTimerRef.current !== null) return;
    const now = performance.now();
    const elapsed = now - lastInvalidateTsRef.current;
    const enqueueInvalidate = () => {
      invalidateRafRef.current = requestAnimationFrame(() => {
        invalidateRafRef.current = null;
        lastInvalidateTsRef.current = performance.now();
        invalidate();
      });
    };
    if (elapsed >= FRAME_INTERVAL_MS) {
      enqueueInvalidate();
      return;
    }
    invalidateTimerRef.current = setTimeout(() => {
      invalidateTimerRef.current = null;
      enqueueInvalidate();
    }, Math.max(0, FRAME_INTERVAL_MS - elapsed));
  }, [invalidate]);

  const kickDamping = useCallback(() => {
    if (dampingRafRef.current !== null) return;
    const tick = () => {
      const controls = controlsRef.current;
      if (!controls) {
        dampingRafRef.current = null;
        return;
      }
      const changed = controls.update?.() ?? false;
      scheduleInvalidate();
      if (changed) {
        dampingRafRef.current = requestAnimationFrame(tick);
      } else {
        dampingRafRef.current = null;
      }
    };
    dampingRafRef.current = requestAnimationFrame(tick);
  }, [scheduleInvalidate]);

  const sampleCameraValue = useCallback((): CameraControlValue => {
    const distance = camera.position.distanceTo(TARGET);
    const safeDistance = Math.max(distance, 0.0001);
    const rotationY = THREE.MathUtils.radToDeg(Math.atan2(camera.position.x, camera.position.z));
    const rotationX = THREE.MathUtils.radToDeg(
      Math.asin(THREE.MathUtils.clamp(camera.position.y / safeDistance, -1, 1))
    );
    return {
      rotationX: THREE.MathUtils.clamp(rotationX, MIN_TILT, MAX_TILT),
      rotationY: THREE.MathUtils.clamp(rotationY, -180, 180),
      scale: THREE.MathUtils.clamp(distance, MIN_SCALE, MAX_SCALE),
      fov: (camera as THREE.PerspectiveCamera).fov,
    };
  }, [camera]);

  const scheduleEmitChange = useCallback(() => {
    if (emitRafRef.current !== null) return;
    const tick = (ts: number) => {
      emitRafRef.current = null;
      const pending = pendingSampleRef.current;
      if (!pending) return;
      // 与渲染节奏对齐：最多每 33ms 向上游同步一次
      if (ts - lastEmitTimeRef.current >= FRAME_INTERVAL_MS) {
        onChange(pending);
        lastEmitTimeRef.current = ts;
        pendingSampleRef.current = null;
      } else {
        emitRafRef.current = requestAnimationFrame(tick);
      }
    };
    emitRafRef.current = requestAnimationFrame(tick);
  }, [onChange]);

  useEffect(() => {
    camera.up.set(0, 1, 0);
  }, [camera]);

  const animateResetToCenter = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    if (resetRafRef.current !== null) {
      cancelAnimationFrame(resetRafRef.current);
      resetRafRef.current = null;
    }
    if (draftRestoreTimerRef.current) {
      clearTimeout(draftRestoreTimerRef.current);
      draftRestoreTimerRef.current = null;
    }
    setDraftMode(true);

    const startAzimuth = controls.getAzimuthalAngle?.() ?? 0;
    const startPolar = controls.getPolarAngle?.() ?? Math.PI / 2;
    const targetAzimuth = 0;
    const targetPolar = Math.PI / 2;
    const startTs = performance.now();
    const durationMs = 320;

    const tick = (now: number) => {
      const t = Math.min(1, (now - startTs) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const nextAzimuth = THREE.MathUtils.lerp(startAzimuth, targetAzimuth, eased);
      const nextPolar = THREE.MathUtils.lerp(startPolar, targetPolar, eased);

      controls.setAzimuthalAngle?.(THREE.MathUtils.clamp(nextAzimuth, MIN_AZIMUTH_ANGLE, MAX_AZIMUTH_ANGLE));
      controls.setPolarAngle?.(THREE.MathUtils.clamp(nextPolar, MIN_POLAR_ANGLE, MAX_POLAR_ANGLE));
      controls.update?.();
      camera.up.set(0, 1, 0);

      pendingSampleRef.current = sampleCameraValue();
      scheduleEmitChange();
      scheduleInvalidate();

      if (t < 1) {
        resetRafRef.current = requestAnimationFrame(tick);
      } else {
        resetRafRef.current = null;
        const finalValue = sampleCameraValue();
        onChange(finalValue);
        onChangeEnd?.(finalValue);
        draftRestoreTimerRef.current = setTimeout(() => {
          draftRestoreTimerRef.current = null;
          setDraftMode(false);
        }, DRAFT_RESTORE_DELAY_MS);
      }
    };

    resetRafRef.current = requestAnimationFrame(tick);
  }, [camera, onChange, onChangeEnd, sampleCameraValue, scheduleEmitChange, scheduleInvalidate]);

  useEffect(() => {
    onInvalidateReady?.(scheduleInvalidate);
  }, [onInvalidateReady, scheduleInvalidate]);

  // 草稿模式：旋转中降低分辨率，停止后恢复
  useEffect(() => {
    const ratio = draftMode ? DRAFT_PIXEL_RATIO : FULL_PIXEL_RATIO;
    gl.setPixelRatio?.(ratio);
    onDraftModeChange?.(draftMode);
    scheduleInvalidate();
  }, [draftMode, gl, onDraftModeChange, scheduleInvalidate]);

  useEffect(() => {
    const onLost = (event: Event) => {
      event.preventDefault?.();
      cleanupResources(scene);
      onContextLost?.();
    };
    gl.domElement.addEventListener('webglcontextlost', onLost, { passive: false });
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', onLost);
    };
  }, [gl, onContextLost, scene]);

  useEffect(() => {
    const el = gl.domElement;
    const onDoubleClick = () => {
      animateResetToCenter();
    };
    el.addEventListener('dblclick', onDoubleClick);
    return () => {
      el.removeEventListener('dblclick', onDoubleClick);
    };
  }, [animateResetToCenter, gl]);

  useEffect(() => {
    let cancelled = false;
    frontTextureRef.current?.dispose?.();
    frontTextureRef.current = null;
    setFrontTexture(null);

    const fallbackTex = createImageFrameTexture();
    // 优先用完整图，缩略图仅作回退（避免 tiny 失败导致正面空白）
    const primaryUrl = (inputImageUrl || '').trim();
    const secondaryUrl = (frontThumbnailUrl || '').trim();
    const urls = [primaryUrl, secondaryUrl].filter((u, i, arr) => u && arr.indexOf(u) === i);

    const applyTex = (tex: THREE.Texture) => {
      if (cancelled) {
        if (tex !== fallbackTex) tex.dispose();
        return;
      }
      if (tex !== fallbackTex) fallbackTex.dispose();
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      applyCoverUvToSquare(tex);
      frontTextureRef.current = tex;
      setFrontTexture(tex);
      setMeshVersion((v) => v + 1);
      scheduleInvalidate();
    };

    if (urls.length === 0) {
      applyTex(fallbackTex);
      return () => {
        cancelled = true;
        fallbackTex.dispose();
        frontTextureRef.current = null;
        setFrontTexture(null);
      };
    }

    (async () => {
      for (const url of urls) {
        if (cancelled) return;
        try {
          const tex = await loadTextureWithMaxSize(url);
          applyTex(tex);
          return;
        } catch {
          /* try next */
        }
      }
      if (!cancelled) applyTex(fallbackTex);
    })();

    return () => {
      cancelled = true;
      frontTextureRef.current?.dispose?.();
      frontTextureRef.current = null;
      setFrontTexture(null);
    };
  }, [frontThumbnailUrl, inputImageUrl, scheduleInvalidate]);

  useEffect(() => {
    if (isInteractingRef.current) return;
    syncingRef.current = true;
    const pos = toCameraPosition(value.rotationX, value.rotationY, value.scale);
    camera.position.copy(pos);
    (camera as THREE.PerspectiveCamera).fov = value.fov;
    (camera as THREE.PerspectiveCamera).near = 0.1;
    (camera as THREE.PerspectiveCamera).far = 100;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    camera.lookAt(TARGET);
    if (controlsRef.current) {
      controlsRef.current.target.copy(TARGET);
      controlsRef.current.update();
    }
    syncingRef.current = false;
    scheduleInvalidate();
  }, [camera, scheduleInvalidate, value.rotationX, value.rotationY, value.scale, value.fov]);

  const handleControlsChange = useCallback(() => {
    if (syncingRef.current) return;
    camera.up.set(0, 1, 0);
    pendingSampleRef.current = sampleCameraValue();
    scheduleEmitChange();
    kickDamping();
    scheduleInvalidate();
  }, [camera, kickDamping, sampleCameraValue, scheduleEmitChange, scheduleInvalidate]);

  const handleControlsStart = useCallback(() => {
    isInteractingRef.current = true;
    camera.up.set(0, 1, 0);
    if (draftRestoreTimerRef.current) {
      clearTimeout(draftRestoreTimerRef.current);
      draftRestoreTimerRef.current = null;
    }
    if (!isDraftModeRef.current) {
      isDraftModeRef.current = true;
      setDraftMode(true);
    }
    scheduleInvalidate();
  }, [camera, scheduleInvalidate]);

  const handleControlsEnd = useCallback(() => {
    isInteractingRef.current = false;
    camera.up.set(0, 1, 0);
    let finalValue = sampleCameraValue();
    const snapped = snapToKeyAngles(finalValue);
    if (snapped.rotationX !== finalValue.rotationX || snapped.rotationY !== finalValue.rotationY) {
      const pos = toCameraPosition(snapped.rotationX, snapped.rotationY, snapped.scale);
      camera.position.copy(pos);
      camera.lookAt(TARGET);
      if (controlsRef.current) {
        controlsRef.current.target.copy(TARGET);
        controlsRef.current.update();
      }
      finalValue = snapped;
    }
    pendingSampleRef.current = null;
    onChange(finalValue);
    onChangeEnd?.(finalValue);
    kickDamping();
    scheduleInvalidate();
    if (draftRestoreTimerRef.current) clearTimeout(draftRestoreTimerRef.current);
    draftRestoreTimerRef.current = setTimeout(() => {
      draftRestoreTimerRef.current = null;
      isDraftModeRef.current = false;
      setDraftMode(false);
    }, DRAFT_RESTORE_DELAY_MS);
  }, [camera, kickDamping, onChange, onChangeEnd, sampleCameraValue, scheduleInvalidate]);

  useEffect(() => {
    return () => {
      if (draftRestoreTimerRef.current) {
        clearTimeout(draftRestoreTimerRef.current);
        draftRestoreTimerRef.current = null;
      }
      if (invalidateRafRef.current !== null) {
        cancelAnimationFrame(invalidateRafRef.current);
      }
      if (invalidateTimerRef.current !== null) {
        clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = null;
      }
      if (dampingRafRef.current !== null) {
        cancelAnimationFrame(dampingRafRef.current);
      }
      if (emitRafRef.current !== null) {
        cancelAnimationFrame(emitRafRef.current);
      }
      if (resetRafRef.current !== null) {
        cancelAnimationFrame(resetRafRef.current);
        resetRafRef.current = null;
      }
      frontTextureRef.current?.dispose?.();
      frontTextureRef.current = null;
      disposeCurrentRefs();
      controlsRef.current?.dispose?.();
      cleanupResources(scene);
      scene.clear();
      gl.renderLists?.dispose?.();
      try { gl.dispose(); } catch { /* R3F may also dispose */ }
    };
  }, [disposeCurrentRefs, gl, scene]);

  const sideColor = isDarkMode ? '#5f6368' : '#cbd5e1';
  const edgeColor = isDarkMode ? '#ffffff' : '#475569';

  useEffect(() => {
    const labels = cubeSideLabels();
    const tex = labels.map((l) => createLabelTexture(l, !!isDarkMode));
    setLabelTextures(tex);
    return () => tex.forEach((t) => t.dispose());
  }, [isDarkMode]);

  return (
    <>
      <ambientLight intensity={isDarkMode ? 0.48 : 0.56} />
      <directionalLight position={[2.5, 3, 2.2]} intensity={isDarkMode ? 0.92 : 1.02} />
      <mesh key={`cube-${meshVersion}`} ref={meshRef}>
        <boxGeometry args={[1.1, 1.1, 1.1]} />
        {labelTextures.length >= 5 ? (
          draftMode ? (
            <>
              <meshBasicMaterial attach="material-0" map={labelTextures[0]} color={sideColor} />
              <meshBasicMaterial attach="material-1" map={labelTextures[1]} color={sideColor} />
              <meshBasicMaterial attach="material-2" map={labelTextures[2]} color={sideColor} />
              <meshBasicMaterial attach="material-3" map={labelTextures[3]} color={sideColor} />
              <meshBasicMaterial
                attach="material-4"
                map={frontTexture ?? undefined}
                color={frontTexture ? '#ffffff' : sideColor}
              />
              <meshBasicMaterial attach="material-5" map={labelTextures[4]} color={sideColor} />
            </>
          ) : (
            <>
              <meshStandardMaterial attach="material-0" map={labelTextures[0]} color={sideColor} roughness={0.84} metalness={0.08} />
              <meshStandardMaterial attach="material-1" map={labelTextures[1]} color={sideColor} roughness={0.84} metalness={0.08} />
              <meshStandardMaterial attach="material-2" map={labelTextures[2]} color={sideColor} roughness={0.84} metalness={0.08} />
              <meshStandardMaterial attach="material-3" map={labelTextures[3]} color={sideColor} roughness={0.84} metalness={0.08} />
              <meshStandardMaterial
                attach="material-4"
                map={frontTexture ?? undefined}
                color={frontTexture ? '#ffffff' : sideColor}
                roughness={0.88}
                metalness={0.04}
              />
              <meshStandardMaterial attach="material-5" map={labelTextures[4]} color={sideColor} roughness={0.84} metalness={0.08} />
            </>
          )
        ) : draftMode ? (
          <meshBasicMaterial color={sideColor} />
        ) : (
          <meshStandardMaterial color={sideColor} roughness={0.84} metalness={0.08} />
        )}
      </mesh>
      <lineSegments key={`edge-${meshVersion}`} ref={edgeRef}>
        <edgesGeometry args={[new THREE.BoxGeometry(1.12, 1.12, 1.12)]} />
        <lineBasicMaterial color={edgeColor} />
      </lineSegments>
      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        rotateSpeed={0.5}
        enableDamping
        dampingFactor={0.05}
        minDistance={MIN_SCALE}
        maxDistance={MAX_SCALE}
        minAzimuthAngle={MIN_AZIMUTH_ANGLE}
        maxAzimuthAngle={MAX_AZIMUTH_ANGLE}
        minPolarAngle={MIN_POLAR_ANGLE}
        maxPolarAngle={MAX_POLAR_ANGLE}
        target={TARGET}
        onStart={handleControlsStart}
        onChange={handleControlsChange}
        onEnd={handleControlsEnd}
      />
    </>
  );
};

const CubeCameraController: React.FC<CubeCameraControllerProps> = ({
  value,
  onChange,
  onChangeEnd,
  onInvalidateReady,
  onContextLost,
  inputImageUrl,
  frontThumbnailUrl,
  isDarkMode = true,
}) => {
  const cameraPos = useMemo(() => toCameraPosition(value.rotationX, value.rotationY, value.scale), [value.rotationX, value.rotationY, value.scale]);
  const invalidateRef = useRef<(() => void) | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const setInvalidate = useCallback((fn: () => void) => {
    invalidateRef.current = fn;
    onInvalidateReady?.(fn);
  }, [onInvalidateReady]);

  const requestRender = useCallback(() => {
    invalidateRef.current?.();
  }, []);

  return (
    <div
      className="absolute inset-0 w-full h-full nodrag nopan"
      style={{
        pointerEvents: 'auto',
        touchAction: 'none',
        userSelect: 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={() => setIsDragging(true)}
      onPointerUp={() => setIsDragging(false)}
      onPointerLeave={() => setIsDragging(false)}
      onPointerEnter={requestRender}
      onPointerMove={requestRender}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="relative rounded-xl overflow-hidden"
          style={{
            width: '100%',
            height: '100%',
            aspectRatio: '1 / 1',
            maxWidth: '100%',
            maxHeight: '100%',
          }}
        >
          <Canvas
            className="w-full h-full"
            style={{
              pointerEvents: 'auto',
              touchAction: 'none',
              userSelect: 'none',
              display: 'block',
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
            }}
            camera={{ position: [cameraPos.x, cameraPos.y, cameraPos.z], fov: value.fov, near: 0.1, far: 100 }}
            frameloop="demand"
            dpr={[1, 1.2]}
            gl={{ antialias: false, alpha: true, powerPreference: 'default', failIfMajorPerformanceCaveat: false }}
          >
            <color attach="background" args={[isDarkMode ? '#1a1a1f' : '#f3f4f6']} />
            <SceneBridge
              value={value}
              onChange={onChange}
              onChangeEnd={onChangeEnd}
              onInvalidateReady={setInvalidate}
              onContextLost={onContextLost}
              onDraftModeChange={undefined}
              inputImageUrl={inputImageUrl}
              frontThumbnailUrl={frontThumbnailUrl}
              isDarkMode={isDarkMode}
            />
          </Canvas>
        </div>
      </div>
    </div>
  );
};

export default CubeCameraController;
