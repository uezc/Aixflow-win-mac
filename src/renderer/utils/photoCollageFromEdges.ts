import type { CollageLayer } from '../components/Canvas/PhotoCollageNode';
import { collageLayerSourceNodeId } from './collageLayerTransform';

type NodeLike = { id: string; type?: string; data?: Record<string, unknown> };
type EdgeLike = {
  source: string;
  target: string;
  targetHandle?: string | null;
  data?: Record<string, unknown>;
};

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

/**
 * 按拼图节点的全部入边重建图层（保留已有图层的位置/变换；超级连线批量导入时一次性对齐）。
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
  for (const layer of existingLayers) {
    const srcId = collageLayerSourceNodeId(layer);
    if (srcId) existingBySource.set(srcId, layer);
  }

  const incoming = edges.filter(
    (e) => e.target === collageNodeId && (!e.targetHandle || e.targetHandle === 'input'),
  );

  const result: CollageLayer[] = [];
  let maxZ = existingLayers.length ? Math.max(...existingLayers.map((L) => L.z)) : 0;
  let newIndex = 0;

  for (const edge of incoming) {
    const sourceNode = nodeById.get(edge.source);
    if (sourceNode?.type !== 'image') continue;

    const url = resolveImageUrlFromNodeForPhotoCollage(sourceNode.data, edge);

    const kept = existingBySource.get(edge.source);
    if (kept) {
      result.push(url && url !== kept.src ? { ...kept, src: url } : kept);
      continue;
    }

    if (!url) continue;

    const gap = newIndex;
    newIndex += 1;
    maxZ += 10;
    result.push({
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

  return result;
}
