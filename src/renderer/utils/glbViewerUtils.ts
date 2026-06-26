import * as THREE from 'three';

type PbrMaterial = THREE.MeshStandardMaterial & {
  map?: THREE.Texture | null;
  emissiveMap?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  metalnessMap?: THREE.Texture | null;
  roughnessMap?: THREE.Texture | null;
  aoMap?: THREE.Texture | null;
  metalness?: number;
  roughness?: number;
  vertexColors?: boolean;
};

function fixTextureColorSpace(tex: THREE.Texture | null | undefined, srgb: boolean): void {
  if (!tex || !tex.image) return;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
  tex.needsUpdate = true;
}

/** 修正 GLB/GLTF 材质贴图色彩空间与 PBR 显示（Hy3D 等带贴图模型） */
export function prepareGltfSceneForDisplay(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of materials) {
      if (!raw) continue;
      const mat = raw as PbrMaterial;

      fixTextureColorSpace(mat.map, true);
      fixTextureColorSpace(mat.emissiveMap, true);
      fixTextureColorSpace(mat.normalMap, false);
      fixTextureColorSpace(mat.metalnessMap, false);
      fixTextureColorSpace(mat.roughnessMap, false);
      fixTextureColorSpace(mat.aoMap, false);

      if (mat.map?.image) {
        mat.vertexColors = false;
      }

      if (typeof mat.metalness === 'number' && mat.metalness > 0.95 && !mat.metalnessMap) {
        mat.metalness = 0.35;
      }
      if (typeof mat.roughness === 'number' && mat.roughness < 0.05 && !mat.roughnessMap) {
        mat.roughness = 0.45;
      }

      mat.needsUpdate = true;
    }
  });
}

/** 开发诊断：统计已加载 baseColor 贴图数量 */
export function countGltfBaseColorMaps(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      const mat = m as PbrMaterial;
      if (mat?.map?.image) n += 1;
    }
  });
  return n;
}

/** 将 WebGL 画布截图为 JPEG data URL（用于未选中节点的静态预览） */
export function captureWebGLCanvasToDataUrl(
  source: HTMLCanvasElement,
  maxWidth = 960,
  maxHeight = 540,
  quality = 0.85,
): string | null {
  const w = source.width;
  const h = source.height;
  if (w < 2 || h < 2) return null;
  try {
    const scale = Math.min(1, maxWidth / w, maxHeight / h);
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, tw, th);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    try {
      return source.toDataURL('image/jpeg', quality);
    } catch {
      return null;
    }
  }
}
