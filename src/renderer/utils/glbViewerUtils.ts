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

function textureImageLoaded(tex: THREE.Texture | null | undefined): boolean {
  const img = tex?.image as { complete?: boolean; naturalWidth?: number; width?: number } | undefined;
  if (!img) return false;
  if (typeof img.naturalWidth === 'number') return img.naturalWidth > 0;
  if (typeof img.width === 'number') return img.width > 0;
  return !!img.complete;
}

function collectMaterialTextures(mat: PbrMaterial): THREE.Texture[] {
  const out: THREE.Texture[] = [];
  for (const tex of [
    mat.map,
    mat.emissiveMap,
    mat.normalMap,
    mat.metalnessMap,
    mat.roughnessMap,
    mat.aoMap,
  ]) {
    if (tex && !out.includes(tex)) out.push(tex);
  }
  return out;
}

function flattenGltfMaterialForPreview(raw: THREE.Material): THREE.Material {
  if ((raw as THREE.MeshBasicMaterial).isMeshBasicMaterial) return raw;
  const std = raw as THREE.MeshStandardMaterial;
  const mat = raw as PbrMaterial;
  if (!std?.isMeshStandardMaterial) {
    if (typeof std?.metalness === 'number' && std.metalness > 0.15) {
      std.metalness = 0;
      std.metalnessMap = null;
      std.roughnessMap = null;
      std.needsUpdate = true;
    }
    return raw;
  }
  const map = mat.map;
  fixTextureColorSpace(map, true);
  /** 保留 StandardMaterial，只把金属度拉低，避免 Trellis2 metallicFactor=1 的灰模 */
  mat.vertexColors = false;
  mat.metalnessMap = null;
  mat.roughnessMap = null;
  mat.metalness = 0;
  mat.roughness = 0.68;
  if (mat.aoMap && !textureImageLoaded(mat.aoMap)) {
    mat.aoMap = null;
  }
  mat.needsUpdate = true;
  return raw;
}

/** 修正 GLB/GLTF 材质贴图色彩空间与 PBR 显示（Hy3D 等带贴图模型） */
export function prepareGltfSceneForDisplay(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const nextMaterials = materials.map((raw) => {
      if (!raw) return raw;
      const mat = raw as PbrMaterial;

      fixTextureColorSpace(mat.map, true);
      fixTextureColorSpace(mat.emissiveMap, true);
      fixTextureColorSpace(mat.normalMap, false);
      fixTextureColorSpace(mat.metalnessMap, false);
      fixTextureColorSpace(mat.roughnessMap, false);
      fixTextureColorSpace(mat.aoMap, false);

      /** 有 baseColor 贴图时：预览改用 BasicMaterial，绕过 Trellis2 metallicFactor≈1 的 PBR 灰模 */
      if (mat.map) {
        return flattenGltfMaterialForPreview(raw);
      }

      const hasLoadedAlbedo = textureImageLoaded(mat.map);

      if (hasLoadedAlbedo) {
        mat.vertexColors = false;
        const sharedOrm =
          mat.metalnessMap &&
          mat.roughnessMap &&
          mat.metalnessMap === mat.roughnessMap;
        if (sharedOrm || (typeof mat.metalness === 'number' && mat.metalness > 0.35)) {
          mat.metalnessMap = null;
          mat.roughnessMap = null;
          mat.metalness = 0;
          mat.roughness = 0.62;
        }
      } else {
        if (typeof mat.metalness === 'number' && mat.metalness > 0.15) {
          mat.metalness = 0;
        } else if (typeof mat.metalness === 'number' && mat.metalness > 0.95 && !mat.metalnessMap) {
          mat.metalness = 0.35;
        }
        mat.metalnessMap = null;
        mat.roughnessMap = null;
        if (typeof mat.roughness === 'number' && mat.roughness < 0.2) {
          mat.roughness = 0.62;
        }
      }

      if (typeof mat.roughness === 'number' && mat.roughness < 0.05 && !mat.roughnessMap) {
        mat.roughness = 0.45;
      }

      mat.needsUpdate = true;
      return raw;
    });

    mesh.material = Array.isArray(mesh.material) ? nextMaterials : nextMaterials[0];
  });
}

function collectDisplayTextures(mat: THREE.Material): THREE.Texture[] {
  const basic = mat as THREE.MeshBasicMaterial;
  if (basic.isMeshBasicMaterial) return basic.map ? [basic.map] : [];
  return collectMaterialTextures(mat as PbrMaterial);
}

/** 贴图异步加载完成后再次修正材质（返回 cleanup） */
export function installGltfDisplayRefresh(
  root: THREE.Object3D,
  onRefresh?: (mapCount: number) => void,
): () => void {
  let disposed = false;
  const refresh = () => {
    if (disposed) return;
    prepareGltfSceneForDisplay(root);
    onRefresh?.(countGltfBaseColorMaps(root));
  };

  refresh();
  const disposers: Array<() => void> = [];

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of materials) {
      if (!raw) continue;
      for (const tex of collectDisplayTextures(raw)) {
        const img = tex.image as HTMLImageElement | undefined;
        if (!img || typeof img.addEventListener !== 'function') continue;
        if (textureImageLoaded(tex)) continue;
        const onLoad = () => refresh();
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onLoad);
        disposers.push(() => {
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onLoad);
        });
      }
    }
  });

  return () => {
    disposed = true;
    for (const d of disposers) d();
  };
}

/** 开发诊断：统计已加载 baseColor 贴图数量 */
export function countGltfBaseColorMaps(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials) {
      if (!m) continue;
      const basic = m as THREE.MeshBasicMaterial;
      const std = m as PbrMaterial;
      const map = basic.isMeshBasicMaterial ? basic.map : std?.map;
      if (map?.image && textureImageLoaded(map)) n += 1;
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

/** RH ComfyUI 预览渲染图（非 UV 贴图），不应作为 GlbTextureOverride 输入 */
export function isRhPreviewRenderTextureUrl(url: string | undefined | null): boolean {
  const v = (url || '').trim();
  if (!v) return false;
  const base = (v.split('/').pop() || v).split('?')[0] || '';
  return /^ComfyUI_\d+_/i.test(base);
}
