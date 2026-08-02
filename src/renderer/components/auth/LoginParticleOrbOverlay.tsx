// @ts-nocheck
import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * 登录页粒子球：叠在暗背景上。
 * 注意：Electron/Chromium WebGL 上下文数量有限；卸载必须 forceContextLoss，
 * 否则进入画布后资源区全景预览 / 上传后 GPU 压力叠加会表现为整窗卡死。
 */
const CORE_COUNT = 1200;
const RING_COUNT = 9;
const RING_PARTICLES = 420;
/** 整体放大，覆盖范围接近首次进入时的视觉体量 */
const ORB_SCALE = 1.22;

function makeSoftDotTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

function buildParticleGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();

  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < CORE_COUNT; i++) {
    const t = i / CORE_COUNT;
    const y = 1 - 2 * t;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const u = Math.random();
    const shell = 0.95 + Math.pow(u, 0.35) * 0.23;
    const x = Math.cos(theta) * radiusAtY * shell;
    const z = Math.sin(theta) * radiusAtY * shell;
    positions.push(x, y * shell, z);
    const hue = 0.78 + (1 - Math.abs(y)) * 0.22 + (Math.random() - 0.5) * 0.04;
    color.setHSL(hue % 1, 1, 0.55 + (1 - Math.abs(y)) * 0.12);
    color.multiplyScalar(1.25);
    colors.push(color.r, color.g, color.b);
  }

  for (let i = 0; i < RING_COUNT; i++) {
    const radius = 1.4 + i * 0.34;
    const thickness = 0.14 + (i % 3) * 0.055;
    const tiltX = ((i * 37) % 50) * 0.02 - 0.4;
    const tiltZ = ((i * 53) % 50) * 0.02 - 0.35;
    const cosX = Math.cos(tiltX);
    const sinX = Math.sin(tiltX);
    const cosZ = Math.cos(tiltZ);
    const sinZ = Math.sin(tiltZ);

    for (let j = 0; j < RING_PARTICLES; j++) {
      const angle = (j / RING_PARTICLES) * Math.PI * 2;
      const radiusVariation = radius + (Math.random() - 0.5) * thickness;
      let x = Math.cos(angle) * radiusVariation;
      let y = (Math.random() - 0.5) * thickness;
      let z = Math.sin(angle) * radiusVariation;

      const y1 = y * cosX - z * sinX;
      const z1 = y * sinX + z * cosX;
      y = y1;
      z = z1;
      const x2 = x * cosZ - y * sinZ;
      const y2 = x * sinZ + y * cosZ;
      x = x2;
      y = y2;

      positions.push(x, y, z);
      const hue = (i / RING_COUNT) * 0.7 + (j / RING_PARTICLES) * 0.3;
      color.setHSL(hue % 1, 1, 0.6);
      color.multiplyScalar(1.2);
      colors.push(color.r, color.g, color.b);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

const LoginParticleOrbOverlay: React.FC = () => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer | null = null;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        powerPreference: 'low-power',
        failIfMajorPerformanceCaveat: false,
      });
    } catch (err) {
      console.warn('[LoginParticleOrb] WebGL 创建失败，跳过粒子球:', err);
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
    // 略拉远 + 略偏右看，粒子球铺满左侧品牌区，接近首次进入体量
    camera.position.set(1.05, 0.12, 5.55);
    camera.lookAt(-0.95, 0.05, 0);

    const texture = makeSoftDotTexture();
    const geometry = buildParticleGeometry();
    const material = new THREE.PointsMaterial({
      size: 0.042,
      map: texture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.9,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.position.set(-1.15, 0.05, 0);
    points.scale.setScalar(ORB_SCALE);
    scene.add(points);

    let raf = 0;
    let running = document.visibilityState === 'visible';
    const clock = new THREE.Clock();

    const resize = () => {
      if (!renderer) return;
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };

    const onVisibility = () => {
      running = document.visibilityState === 'visible';
      if (running && !raf) raf = requestAnimationFrame(tick);
    };

    const tick = () => {
      raf = 0;
      if (!running || !renderer) return;
      const t = clock.getElapsedTime();
      points.rotation.y = t * 0.12;
      points.rotation.x = Math.sin(t * 0.15) * 0.08;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    if (running) raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      geometry.dispose();
      material.dispose();
      texture.dispose();
      if (renderer) {
        try {
          // 必须释放 WebGL 槽位，否则登录→画布后资源区/3D 预览会抢不到上下文并拖垮交互
          renderer.forceContextLoss();
        } catch {
          /* ignore */
        }
        try {
          renderer.dispose();
        } catch {
          /* ignore */
        }
        if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
        renderer = null;
      }
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="nexflow-login-particle-orb pointer-events-none absolute inset-0"
      aria-hidden
    />
  );
};

export default LoginParticleOrbOverlay;
