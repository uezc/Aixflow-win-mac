import type { CollageLayer } from '../components/Canvas/PhotoCollageNode';
import { collageLayerSourceNodeId } from './collageLayerTransform';
import { sortNodesByReadingOrder } from './timelineSourceMedia';

type NodeLike = {
  id: string;
  type?: string;
  position?: { x?: number; y?: number };
  data?: Record<string, unknown>;
};
type EdgeLike = {
  source: string;
  target: string;
  targetHandle?: string | null;
  data?: Record<string, unknown>;
};

/** 拼图图层上限（超级连线 / 入边重建均遵守，超出不静默堆叠） */
export const MAX_PHOTO_COLLAGE_LAYERS = 24;

/** 从图片节点 data（及边上缓存的 imageAsset）解析拼图图层 URL */
export function resolveImageUrlFromNodeForPhotoCollage(
  data: Record<string, unknown> | undefined,
  edge?: EdgeLike,
): string {
  if (data) {
    const asset = data.imageAsset as { preview?: string; original?: string; tiny?: string } | undefined;
    const fromNode =
      String(data.outputImage || '').trim() ||
      String(asset?.preview || '').trim() ||
      String(asset?.original || '').trim() ||
      (typeof data.avatar === 'string' ? data.avatar.trim() : '') ||
      String(data.originalImageUrl || '').trim() ||
      String(data.localPath || '').trim() ||
      (Array.isArray(data.outputImages) && data.outputImages.length > 0
        ? String(data.outputImages[0] || '').trim()
        : '') ||
      (Array.isArray(data.inputImages) && data.inputImages.length > 0
        ? String(data.inputImages[0] || '').trim()
        : '') ||
      String(asset?.tiny || '').trim() ||
      String(data.tinyThumbUrl || '').trim();
    if (fromNode) return fromNode;
  }
  const edgePreview = (edge?.data as { imageAsset?: { preview?: string } } | undefined)?.imageAsset?.preview;
  return String(edgePreview || '').trim();
}

function isManualCollageLayer(layer: CollageLayer): boolean {
  return !collageLayerSourceNodeId(layer);
}

/**
 * 按拼图节点的全部入边重建图层：
 * - 已有连线图层：保留位置/变换，仅同步 URL
 * - 新连线：按源节点阅读顺序追加
 * - 无 sourceNodeId 的手动图层予以保留
 * - 遵守 MAX_PHOTO_COLLAGE_LAYERS（优先保留已有 + 手动，再追加新层）
 */
export function buildPhotoCollageLayersFromEdges(
  collageNodeId: string,
  edges: EdgeLike[],
  nodes: NodeLike[],
  existingLayers: CollageLayer[] = [],
): CollageLayer[] {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const collageNode = nodeById.get(collageNodeId);
  const cw0 = Number(collageNode?.data?.collageCanvasW) || 800;
  const ch0 = Number(collageNode?.data?.collageCanvasH) || 600;

  const existingBySource = new Map<string, CollageLayer>();
  const manualLayers: CollageLayer[] = [];
  for (const layer of existingLayers) {
    if (isManualCollageLayer(layer)) {
      manualLayers.push(layer);
      continue;
    }
    const srcId = collageLayerSourceNodeId(layer);
    if (srcId) existingBySource.set(srcId, layer);
  }

  const incoming = edges.filter(
    (e) => e.target === collageNodeId && (!e.targetHandle || e.targetHandle === 'input'),
  );

  const imageEdges = incoming.filter((e) => nodeById.get(e.source)?.type === 'image');
  const sourceNodesForSort = imageEdges
    .map((e) => nodeById.get(e.source))
    .filter((n): n is NodeLike => !!n);
  const orderedSourceIds = sortNodesByReadingOrder(sourceNodesForSort).map((n) => n.id);
  // 同一源多条入边时保持首次出现
  const seenSource = new Set<string>();
  const sortedIncoming: EdgeLike[] = [];
  for (const sourceId of orderedSourceIds) {
    if (seenSource.has(sourceId)) continue;
    seenSource.add(sourceId);
    const edge = imageEdges.find((e) => e.source === sourceId);
    if (edge) sortedIncoming.push(edge);
  }

  const edgeLayers: CollageLayer[] = [];
  let maxZ = existingLayers.length ? Math.max(...existingLayers.map((L) => L.z), 0) : 0;
  let newIndex = 0;

  for (const edge of sortedIncoming) {
    const sourceNode = nodeById.get(edge.source);
    if (sourceNode?.type !== 'image') continue;

    const url = resolveImageUrlFromNodeForPhotoCollage(sourceNode.data, edge);
    const kept = existingBySource.get(edge.source);
    if (kept) {
      edgeLayers.push(url && url !== kept.src ? { ...kept, src: url } : kept);
      continue;
    }
    if (!url) continue;

    const gap = newIndex;
    newIndex += 1;
    maxZ += 10;
    edgeLayers.push({
      id: `layer-${Date.now()}-${edge.source}-${gap}`,
      src: url,
      sourceNodeId: edge.source,
      x: Math.min(40 + gap * 28, Math.max(0, cw0 - 200)),
      y: Math.min(40 + gap * 22, Math.max(0, ch0 - 160)),
      w: Math.min(280, Math.floor(cw0 * 0.45)),
      h: Math.min(210, Math.floor(ch0 * 0.45)),
      z: maxZ,
    });
  }

  // 先手动层，再已绑定源，最后新层；总量截断到上限
  const keptExistingEdge = edgeLayers.filter((L) => {
    const sid = collageLayerSourceNodeId(L);
    return !!(sid && existingBySource.has(sid));
  });
  const brandNewEdge = edgeLayers.filter((L) => {
    const sid = collageLayerSourceNodeId(L);
    return !(sid && existingBySource.has(sid));
  });

  const result: CollageLayer[] = [];
  const pushCapped = (layers: CollageLayer[]) => {
    for (const L of layers) {
      if (result.length >= MAX_PHOTO_COLLAGE_LAYERS) break;
      result.push(L);
    }
  };
  pushCapped(manualLayers);
  pushCapped(keptExistingEdge);
  pushCapped(brandNewEdge);
  return result;
}

/**
 * 超级连线前：在已有图层基础上，还可新接入多少张（已绑定同一源的不算新槽）。
 */
export function photoCollageRemainingImportSlots(
  existingLayers: CollageLayer[] = [],
  reconnectingSourceIds: Iterable<string> = [],
): number {
  const reconnect = new Set(
    [...reconnectingSourceIds].map((id) => String(id || '').trim()).filter(Boolean),
  );
  let occupied = 0;
  for (const layer of existingLayers) {
    const sid = collageLayerSourceNodeId(layer);
    if (sid && reconnect.has(sid)) continue;
    occupied += 1;
  }
  return Math.max(0, MAX_PHOTO_COLLAGE_LAYERS - occupied);
}
