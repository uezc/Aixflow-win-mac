import { resolveImageUrlFromNodeForPhotoCollage } from './photoCollageFromEdges';

export const IMAGE_COMPARER_HANDLE_A = 'image_a';
export const IMAGE_COMPARER_HANDLE_B = 'image_b';

type NodeLike = { id: string; type?: string; data?: Record<string, unknown> };
type EdgeLike = {
  source: string;
  target: string;
  targetHandle?: string | null;
  data?: Record<string, unknown>;
};

export type ImageComparerSlotUrls = {
  imageAUrl: string;
  imageBUrl: string;
  imageASourceNodeId?: string;
  imageBSourceNodeId?: string;
};

function isComparerHandle(h: string | null | undefined): h is typeof IMAGE_COMPARER_HANDLE_A | typeof IMAGE_COMPARER_HANDLE_B {
  return h === IMAGE_COMPARER_HANDLE_A || h === IMAGE_COMPARER_HANDLE_B;
}

/** 保证写入节点 data 的始终是纯字符串 URL */
function asUrlString(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    for (const key of ['url', 'preview', 'original', 'src', 'path'] as const) {
      if (typeof o[key] === 'string' && (o[key] as string).trim()) return (o[key] as string).trim();
    }
  }
  return '';
}

/** 为对比节点选择空闲槽位（优先 A）；两槽皆满时覆盖 A */
export function pickImageComparerTargetHandle(
  edges: EdgeLike[],
  comparerNodeId: string,
  preferred?: string | null,
): typeof IMAGE_COMPARER_HANDLE_A | typeof IMAGE_COMPARER_HANDLE_B {
  if (isComparerHandle(preferred)) return preferred;
  const incoming = edges.filter((e) => e.target === comparerNodeId);
  const hasA = incoming.some((e) => e.targetHandle === IMAGE_COMPARER_HANDLE_A);
  const hasB = incoming.some((e) => e.targetHandle === IMAGE_COMPARER_HANDLE_B);
  if (!hasA) return IMAGE_COMPARER_HANDLE_A;
  if (!hasB) return IMAGE_COMPARER_HANDLE_B;
  return IMAGE_COMPARER_HANDLE_A;
}

/** 按 image_a / image_b 入边解析对比图 URL */
export function buildImageComparerUrlsFromEdges(
  comparerNodeId: string,
  edges: EdgeLike[],
  nodes: NodeLike[],
): ImageComparerSlotUrls {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  let imageAUrl = '';
  let imageBUrl = '';
  let imageASourceNodeId: string | undefined;
  let imageBSourceNodeId: string | undefined;

  for (const edge of edges.filter((e) => e.target === comparerNodeId)) {
    const handle = isComparerHandle(edge.targetHandle)
      ? edge.targetHandle
      : IMAGE_COMPARER_HANDLE_A;
    const sourceNode = nodeById.get(edge.source);
    if (sourceNode?.type !== 'image') continue;
    const url = asUrlString(resolveImageUrlFromNodeForPhotoCollage(sourceNode.data, edge));
    if (!url) continue;
    if (handle === IMAGE_COMPARER_HANDLE_A) {
      imageAUrl = url;
      imageASourceNodeId = edge.source;
    } else {
      imageBUrl = url;
      imageBSourceNodeId = edge.source;
    }
  }

  return { imageAUrl, imageBUrl, imageASourceNodeId, imageBSourceNodeId };
}
