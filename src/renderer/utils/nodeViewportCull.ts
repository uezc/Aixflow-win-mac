import type { Node } from 'reactflow';

export function getNodeBounds(node: Node): { x: number; y: number; w: number; h: number } {
  const w = Number(node.data?.width) || Number(node.width) || 300;
  const h = Number(node.data?.height) || Number(node.height) || 200;
  return { x: node.position.x, y: node.position.y, w, h };
}

/** 节点矩形是否与扩展视口相交（flow 坐标） */
export function isNodeInExpandedViewport(
  node: Node,
  transform: [number, number, number],
  viewportWidth: number,
  viewportHeight: number,
  paddingScreenFactor: number,
): boolean {
  const [tx, ty, tz] = transform;
  if (!Number.isFinite(tz) || tz <= 0) return true;

  const padW = viewportWidth * paddingScreenFactor;
  const padH = viewportHeight * paddingScreenFactor;
  const viewLeft = (-tx - padW) / tz;
  const viewTop = (-ty - padH) / tz;
  const viewRight = (-tx + viewportWidth + padW) / tz;
  const viewBottom = (-ty + viewportHeight + padH) / tz;

  const { x, y, w, h } = getNodeBounds(node);
  return x + w >= viewLeft && x <= viewRight && y + h >= viewTop && y <= viewBottom;
}

export type NodeGuillotineOptions = {
  nodes: Node[];
  transform: [number, number, number];
  viewportWidth: number;
  viewportHeight: number;
  paddingScreenFactor: number;
  /** 永不剔除的节点 id（选中、拖拽、运行中等） */
  keepNodeIds: ReadonlySet<string>;
};

/** 视口外节点不进入 React Flow，减轻平移合成压力 */
export function applyNodeGuillotine(options: NodeGuillotineOptions): Node[] {
  const {
    nodes,
    transform,
    viewportWidth,
    viewportHeight,
    paddingScreenFactor,
    keepNodeIds,
  } = options;

  if (viewportWidth <= 0 || viewportHeight <= 0) return nodes;

  return nodes.filter(
    (n) =>
      keepNodeIds.has(n.id) ||
      isNodeInExpandedViewport(n, transform, viewportWidth, viewportHeight, paddingScreenFactor),
  );
}
