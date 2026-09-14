/**
 * 画布模块组合 / 解除组合。
 * 使用绝对坐标 + data.nodeGroupId 软绑定（不用 React Flow parentNode，
 * 避免相对坐标被当成绝对坐标导致子模块飞出框外）。
 */
import type { Node } from 'reactflow';
import { NODE_GROUP_TYPE, type NodeGroupData } from '../components/Canvas/NodeGroupFrame';

const PAD = 28;
/** 角色设计师：顶边多留空给黄标角色名，避免与组框顶/粉标挤叠 */
const PAD_CHAR_DESIGNER_TOP = 44;

function groupFramePads(data?: { kind?: string } | null): { padX: number; padTop: number; padBottom: number } {
  const kind = String(data?.kind || '');
  const isAssetDesigner =
    kind === 'dramaFlowCharacterDesigner' ||
    kind === 'dramaFlowSceneDesigner' ||
    kind === 'dramaFlowPropDesigner' ||
    kind === 'dramaFlowCreatureDesigner';
  return {
    padX: PAD,
    padTop: isAssetDesigner ? PAD_CHAR_DESIGNER_TOP : PAD,
    /** 底边多留空给角色/场景卡正下方垃圾桶 */
    padBottom: isAssetDesigner ? 40 : PAD,
  };
}

function nodeSize(n: Node): { w: number; h: number } {
  const w =
    Number(n.width) ||
    Number(n.data?.width) ||
    Number((n.style as { width?: number } | undefined)?.width) ||
    200;
  const h =
    Number(n.height) ||
    Number(n.data?.height) ||
    Number((n.style as { height?: number } | undefined)?.height) ||
    160;
  return { w: Math.max(1, w), h: Math.max(1, h) };
}

/** 绝对画布坐标（兼容旧版误用的 parentNode） */
export function absoluteNodePosition(n: Node, byId: Map<string, Node>): { x: number; y: number } {
  let x = Number(n.position?.x) || 0;
  let y = Number(n.position?.y) || 0;
  let pid = String((n as any).parentNode || '').trim();
  const guard = new Set<string>();
  while (pid && !guard.has(pid)) {
    guard.add(pid);
    const p = byId.get(pid);
    if (!p) break;
    x += Number(p.position?.x) || 0;
    y += Number(p.position?.y) || 0;
    pid = String((p as any).parentNode || '').trim();
  }
  return { x, y };
}

export function getNodeGroupId(n: Node): string {
  if (n.type === NODE_GROUP_TYPE) return n.id;
  const fromData = String((n.data as { nodeGroupId?: string } | undefined)?.nodeGroupId || '').trim();
  if (fromData) return fromData;
  // 兼容旧版 parentNode
  return String((n as any).parentNode || '').trim();
}

/** 组内子模块：不可单独框选 / 拖走，打组后作为整体 */
export function lockGroupedChild<T extends Node>(n: T): T {
  if (n.type === NODE_GROUP_TYPE) return n;
  if (n.selectable === false && n.draggable === false && !n.selected) return n;
  return { ...n, selectable: false, draggable: false, selected: false };
}

export function unlockGroupedChild<T extends Node>(n: T): T {
  return { ...n, selectable: true, draggable: true };
}

/** 已有 nodeGroupId 的子模块统一锁成整体（加载/修复时用） */
export function sealGroupedChildren(allNodes: Node[]): Node[] {
  let changed = false;
  const next = allNodes.map((n) => {
    if (n.type === NODE_GROUP_TYPE) return n;
    const gid = String((n.data as { nodeGroupId?: string } | undefined)?.nodeGroupId || '').trim();
    if (!gid) return n;
    const sealed = lockGroupedChild(n);
    if (sealed !== n) changed = true;
    return sealed;
  });
  return changed ? next : allNodes;
}

function computeBounds(
  nodes: Node[],
  byId: Map<string, Node>,
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const abs = absoluteNodePosition(n, byId);
    const { w, h } = nodeSize(n);
    minX = Math.min(minX, abs.x);
    minY = Math.min(minY, abs.y);
    maxX = Math.max(maxX, abs.x + w);
    maxY = Math.max(maxY, abs.y + h);
  }
  if (!Number.isFinite(minX)) {
    return { x: 0, y: 0, width: 200, height: 160 };
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function canGroupNodes(nodes: Node[]): boolean {
  const candidates = nodes.filter((n) => n.type !== NODE_GROUP_TYPE);
  if (candidates.length < 2) return false;
  const groups = new Set(candidates.map((n) => getNodeGroupId(n)).filter(Boolean));
  if (groups.size === 1 && candidates.every((n) => getNodeGroupId(n))) {
    return false;
  }
  return true;
}

/** 选区可解除组合：选中了组合框，或选中同组的子节点 */
export function findUngroupTargetIds(selected: Node[], all: Node[]): string[] {
  const byId = new Map(all.map((n) => [n.id, n]));
  const groupIds = new Set<string>();
  for (const n of selected) {
    if (n.type === NODE_GROUP_TYPE) {
      groupIds.add(n.id);
      continue;
    }
    const gid = getNodeGroupId(n);
    if (!gid) continue;
    const g = byId.get(gid);
    if (g?.type === NODE_GROUP_TYPE || !g) groupIds.add(gid);
  }
  return [...groupIds];
}

/** 剥离旧版 parentNode，并写回绝对坐标 */
function detachParentNode(n: Node, byId: Map<string, Node>): Node {
  if (!(n as any).parentNode) return n;
  const abs = absoluteNodePosition(n, byId);
  const next = { ...n } as Node & {
    parentNode?: string;
    extent?: unknown;
    expandParent?: boolean;
    positionAbsolute?: unknown;
  };
  delete next.parentNode;
  delete next.extent;
  delete next.expandParent;
  delete next.positionAbsolute;
  return { ...next, position: abs };
}

export function groupSelectedNodes(
  allNodes: Node[],
  selectedIds: string[],
  opts?: { arrangeCols?: number; label?: string; groupId?: string },
): Node[] {
  const selected = allNodes.filter(
    (n) => selectedIds.includes(n.id) && n.type !== NODE_GROUP_TYPE,
  );
  if (selected.length < 2) return allNodes;

  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const bounds = computeBounds(selected, byId);
  const gx = bounds.x - PAD;
  const gy = bounds.y - PAD;
  const gw = Math.ceil(bounds.width + PAD * 2);
  const gh = Math.ceil(bounds.height + PAD * 2);
  const arrangeCols =
    Number.isFinite(Number(opts?.arrangeCols)) && Number(opts?.arrangeCols) >= 1
      ? Math.min(6, Math.floor(Number(opts?.arrangeCols)))
      : undefined;
  const groupId = String(opts?.groupId || '').trim() || `nodeGroup-${Date.now()}`;
  const childIds = selected.map((n) => n.id);
  const selectedSet = new Set(childIds);

  const groupNode: Node<NodeGroupData> = {
    id: groupId,
    type: NODE_GROUP_TYPE,
    position: { x: gx, y: gy },
    style: { width: gw, height: gh },
    width: gw,
    height: gh,
    data: {
      label: opts?.label || '组合',
      width: gw,
      height: gh,
      childIds,
      ...(arrangeCols != null ? { arrangeCols } : {}),
    },
    selected: true,
    zIndex: -1,
    draggable: true,
    selectable: true,
  };

  const next = allNodes.map((n) => {
    let node = detachParentNode(n, byId);
    if (!selectedSet.has(node.id)) {
      return node.selected ? { ...node, selected: false } : node;
    }
    const abs = absoluteNodePosition(n, byId);
    return lockGroupedChild({
      ...node,
      position: abs,
      selected: false,
      data: {
        ...(node.data || {}),
        nodeGroupId: groupId,
      },
    });
  });

  let out = pruneEmptyNodeGroups([groupNode, ...next]);
  if (arrangeCols != null) {
    out = arrangeGroupNodes(out, groupId, arrangeCols);
  }
  return out;
}

/** 打组后：把「同一源 → 多个子模块」的入边收成「源 → 组合框」一根线 */
export function collapseEdgesIntoGroup(
  edges: { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; type?: string; [k: string]: unknown }[],
  childIds: string[],
  groupId: string,
) {
  const childSet = new Set(childIds);
  const incoming = edges.filter((e) => childSet.has(e.target));
  const rest = edges.filter((e) => !childSet.has(e.source) && !childSet.has(e.target));
  if (!incoming.length) return edges;

  const bySource = new Map<string, (typeof incoming)[0]>();
  for (const e of incoming) {
    if (!bySource.has(e.source)) bySource.set(e.source, e);
  }
  const collapsed = [...bySource.values()].map((e) => ({
    ...e,
    id: `e-${e.source}-${groupId}`,
    target: groupId,
    targetHandle: 'in',
  }));
  return [...rest, ...collapsed];
}

/** 根据已摆好的子节点生成软组合框（不改子坐标，仅包一层） */
export function buildSoftGroupFrame(
  children: Node[],
  opts: {
    groupId?: string;
    label?: string;
    arrangeCols?: number;
    extraData?: Record<string, unknown>;
  } = {},
): Node<NodeGroupData> {
  const byId = new Map(children.map((n) => [n.id, n]));
  const bounds = computeBounds(children, byId);
  const pads = groupFramePads({ kind: String(opts.extraData?.kind || '') });
  const gx = bounds.x - pads.padX;
  const gy = bounds.y - pads.padTop;
  const gw = Math.ceil(bounds.width + pads.padX * 2);
  const gh = Math.ceil(bounds.height + pads.padTop + pads.padBottom);
  const groupId = opts.groupId || `nodeGroup-${Date.now()}`;
  const childIds = children.map((n) => n.id);
  return {
    id: groupId,
    type: NODE_GROUP_TYPE,
    position: { x: gx, y: gy },
    style: { width: gw, height: gh },
    width: gw,
    height: gh,
    data: {
      label: opts.label || '组合',
      width: gw,
      height: gh,
      childIds,
      ...(opts.arrangeCols != null ? { arrangeCols: opts.arrangeCols } : {}),
      ...(opts.extraData || {}),
    },
    selected: false,
    zIndex: -1,
    draggable: true,
    selectable: true,
  };
}

export function ungroupNodes(allNodes: Node[], groupIds: string[]): Node[] {
  const idSet = new Set(groupIds);
  if (!idSet.size) return allNodes;
  const byId = new Map(allNodes.map((n) => [n.id, n]));

  return allNodes
    .filter((n) => !idSet.has(n.id))
    .map((n) => {
      let node = detachParentNode(n, byId);
      const gid = String((node.data as { nodeGroupId?: string } | undefined)?.nodeGroupId || '').trim();
      if (!gid || !idSet.has(gid)) return node;
      const data = { ...(node.data || {}) } as Record<string, unknown>;
      delete data.nodeGroupId;
      return unlockGroupedChild({
        ...node,
        selected: true,
        data,
      });
    });
}

/** 删掉已无子节点的空组合框 */
export function pruneEmptyNodeGroups(allNodes: Node[]): Node[] {
  const parentIds = new Set(
    allNodes
      .map((n) => String((n.data as { nodeGroupId?: string } | undefined)?.nodeGroupId || '').trim())
      .filter(Boolean),
  );
  return allNodes.filter((n) => n.type !== NODE_GROUP_TYPE || parentIds.has(n.id));
}

/** 按子节点包围盒同步组合框位置与尺寸 */
export function syncGroupFrameBounds(allNodes: Node[], groupId: string): Node[] {
  const children = allNodes.filter(
    (n) =>
      n.type !== NODE_GROUP_TYPE &&
      String((n.data as { nodeGroupId?: string } | undefined)?.nodeGroupId || '') === groupId,
  );
  if (!children.length) {
    return allNodes.filter((n) => n.id !== groupId);
  }
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const bounds = computeBounds(children, byId);
  const groupNode = allNodes.find((n) => n.id === groupId);
  const pads = groupFramePads(groupNode?.data as { kind?: string } | undefined);
  const gx = bounds.x - pads.padX;
  const gy = bounds.y - pads.padTop;
  const gw = Math.ceil(bounds.width + pads.padX * 2);
  const gh = Math.ceil(bounds.height + pads.padTop + pads.padBottom);
  const childIds = children.map((n) => n.id);
  return allNodes.map((n) => {
    if (n.id !== groupId) return n;
    return {
      ...n,
      position: { x: gx, y: gy },
      width: gw,
      height: gh,
      style: { ...(n.style || {}), width: gw, height: gh },
      data: {
        ...(n.data || {}),
        width: gw,
        height: gh,
        childIds,
      },
    };
  });
}

const ARRANGE_GAP_X = 36;
const ARRANGE_GAP_Y = 52;
const ARRANGE_ROW_Y_TOLERANCE = 48;

/** 根据现有布局推断列数：按 Y 分带，取众数行宽；否则 √n 封顶 3 */
function detectArrangeColumns(sorted: Node[], byId: Map<string, Node>): number {
  if (sorted.length <= 1) return 1;
  const rows: number[] = [];
  let rowCount = 0;
  let lastY = -Infinity;
  for (const n of sorted) {
    const y = absoluteNodePosition(n, byId).y;
    if (rowCount === 0 || Math.abs(y - lastY) > ARRANGE_ROW_Y_TOLERANCE) {
      if (rowCount > 0) rows.push(rowCount);
      rowCount = 1;
      lastY = y;
    } else {
      rowCount += 1;
    }
  }
  if (rowCount > 0) rows.push(rowCount);
  if (rows.length) {
    const freq = new Map<number, number>();
    for (const c of rows) freq.set(c, (freq.get(c) || 0) + 1);
    let best = rows[0]!;
    let bestN = 0;
    for (const [c, n] of freq) {
      if (n > bestN || (n === bestN && c > best)) {
        best = c;
        bestN = n;
      }
    }
    if (best >= 1 && best <= 4) return best;
  }
  return Math.min(3, Math.max(1, Math.ceil(Math.sqrt(sorted.length))));
}

/**
 * 整理组内模块：按阅读顺序（上→下、左→右）排成整齐网格，再同步组合框。
 * @param forceCols 若传入则覆盖组上 arrangeCols / 自动推断
 */
export function arrangeGroupNodes(
  allNodes: Node[],
  groupId: string,
  forceCols?: number,
): Node[] {
  const children = allNodes.filter(
    (n) => n.type !== NODE_GROUP_TYPE && getNodeGroupId(n) === groupId,
  );
  if (children.length < 2) return allNodes;

  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const sorted = [...children].sort((a, b) => {
    const pa = absoluteNodePosition(a, byId);
    const pb = absoluteNodePosition(b, byId);
    if (Math.abs(pa.y - pb.y) > ARRANGE_ROW_Y_TOLERANCE) return pa.y - pb.y;
    return pa.x - pb.x;
  });

  const colsFromGroup = Number(
    (allNodes.find((n) => n.id === groupId)?.data as { arrangeCols?: number } | undefined)?.arrangeCols,
  );
  const cols =
    Number.isFinite(Number(forceCols)) && Number(forceCols) >= 1
      ? Math.min(6, Math.floor(Number(forceCols)))
      : Number.isFinite(colsFromGroup) && colsFromGroup >= 1
        ? Math.min(6, Math.floor(colsFromGroup))
        : detectArrangeColumns(sorted, byId);
  const origin = computeBounds(sorted, byId);
  const startX = origin.x;
  const startY = origin.y;

  const positions = new Map<string, { x: number; y: number }>();
  let y = startY;
  const rowCount = Math.ceil(sorted.length / cols);
  for (let row = 0; row < rowCount; row++) {
    const rowNodes = sorted.slice(row * cols, row * cols + cols);
    let x = startX;
    let rowH = 0;
    for (const n of rowNodes) {
      positions.set(n.id, { x, y });
      const { w, h } = nodeSize(n);
      x += w + ARRANGE_GAP_X;
      rowH = Math.max(rowH, h);
    }
    y += rowH + ARRANGE_GAP_Y;
  }

  const next = allNodes.map((n) => {
    if (n.id === groupId && Number.isFinite(Number(forceCols)) && Number(forceCols) >= 1) {
      return {
        ...n,
        data: {
          ...(n.data || {}),
          arrangeCols: Math.min(6, Math.floor(Number(forceCols))),
        },
      };
    }
    const p = positions.get(n.id);
    if (!p) return n;
    return { ...n, position: { x: p.x, y: p.y } };
  });
  return syncGroupFrameBounds(next, groupId);
}

/**
 * 修复旧版 parentNode 打组：还原绝对坐标，改为 data.nodeGroupId 软绑定；
 * 并锁定组内子模块（不可单独框选/拖走）。
 */
export function repairLegacyParentNodeGroups(allNodes: Node[]): Node[] {
  const hasLegacy = allNodes.some((n) => !!(n as any).parentNode);
  let out = allNodes;

  if (hasLegacy) {
    const byId = new Map(allNodes.map((n) => [n.id, n]));
    const next = allNodes.map((n) => {
      const pid = String((n as any).parentNode || '').trim();
      if (!pid) return n;
      const abs = absoluteNodePosition(n, byId);
      const parent = byId.get(pid);
      const rest = { ...n } as Node & {
        parentNode?: string;
        extent?: unknown;
        expandParent?: boolean;
        positionAbsolute?: unknown;
      };
      delete rest.parentNode;
      delete rest.extent;
      delete rest.expandParent;
      delete rest.positionAbsolute;
      const data = { ...(rest.data || {}) } as Record<string, unknown>;
      if (parent?.type === NODE_GROUP_TYPE) {
        data.nodeGroupId = pid;
      }
      return {
        ...rest,
        position: abs,
        data,
      };
    });

    out = next;
    for (const g of next) {
      if (g.type === NODE_GROUP_TYPE) {
        out = syncGroupFrameBounds(out, g.id);
      }
    }
  }

  return sealGroupedChildren(out);
}

export type GroupDragSession = {
  groupId: string;
  originId: string;
  originStart: { x: number; y: number };
  startPos: Record<string, { x: number; y: number }>;
};

/** 开始拖组：仅当拖的是组合框本身时整组跟移（拖子模块不跟，避免与 RF 位移打架打乱） */
export function beginGroupDrag(allNodes: Node[], origin: Node): GroupDragSession | null {
  if (origin.type !== NODE_GROUP_TYPE) return null;
  const groupId = origin.id;
  const members = allNodes.filter((n) => n.id === groupId || getNodeGroupId(n) === groupId);
  if (members.length < 2) return null;
  const startPos: Record<string, { x: number; y: number }> = {};
  for (const m of members) {
    startPos[m.id] = {
      x: Number(m.position?.x) || 0,
      y: Number(m.position?.y) || 0,
    };
  }
  return {
    groupId,
    originId: origin.id,
    originStart: { ...startPos[origin.id]! },
    startPos,
  };
}

/**
 * 框选多个组合框时：为每个选中的组框建立跟移会话。
 * 返回的 primary 为当前拖拽源所在会话。
 */
export function beginMultiGroupDrag(
  allNodes: Node[],
  dragOrigin: Node,
): { primary: GroupDragSession; sessions: GroupDragSession[] } | null {
  if (dragOrigin.type !== NODE_GROUP_TYPE) return null;
  const selectedGroupIds = new Set<string>();
  for (const n of allNodes) {
    if (n.type !== NODE_GROUP_TYPE) continue;
    if (n.id === dragOrigin.id || n.selected) selectedGroupIds.add(n.id);
  }
  if (!selectedGroupIds.has(dragOrigin.id)) selectedGroupIds.add(dragOrigin.id);

  const sessions: GroupDragSession[] = [];
  for (const gid of selectedGroupIds) {
    const origin = allNodes.find((n) => n.id === gid);
    if (!origin) continue;
    const s = beginGroupDrag(allNodes, origin);
    if (s) sessions.push(s);
  }
  const primary = sessions.find((s) => s.originId === dragOrigin.id) || null;
  if (!primary || !sessions.length) return null;
  return { primary, sessions };
}

/** 拖动中：以组合框位移同步组内子模块；同时写回拖拽源坐标，避免 setNodes 覆盖 RF 最新位置 */
export function applyGroupDrag(
  allNodes: Node[],
  session: GroupDragSession,
  originCurrent: { x: number; y: number },
): Node[] {
  return applyMultiGroupDrag(allNodes, [session], session, originCurrent);
}

/**
 * 多组跟移：以主拖拽组框的位移为 dx/dy，同步所有会话内的组框与子模块。
 * 避免框选多个组时只有当前组下的卡跟着动。
 */
export function applyMultiGroupDrag(
  allNodes: Node[],
  sessions: GroupDragSession[],
  primary: GroupDragSession,
  originCurrent: { x: number; y: number },
): Node[] {
  const dx = originCurrent.x - primary.originStart.x;
  const dy = originCurrent.y - primary.originStart.y;
  if (dx === 0 && dy === 0) return allNodes;

  const startById = new Map<string, { x: number; y: number }>();
  for (const s of sessions) {
    for (const [id, pos] of Object.entries(s.startPos)) {
      if (!startById.has(id)) startById.set(id, pos);
    }
  }

  return allNodes.map((n) => {
    const start = startById.get(n.id);
    if (!start) return n;
    if (n.id === primary.originId) {
      if (n.position?.x === originCurrent.x && n.position?.y === originCurrent.y) return n;
      return { ...n, position: { x: originCurrent.x, y: originCurrent.y } };
    }
    const nextX = start.x + dx;
    const nextY = start.y + dy;
    if (n.position?.x === nextX && n.position?.y === nextY) return n;
    return { ...n, position: { x: nextX, y: nextY } };
  });
}

type PositionChange = {
  type: string;
  id?: string;
  position?: { x: number; y: number };
  dragging?: boolean;
};

/**
 * 软组跟移（走 RF onNodesChange）：组框位移时，给尚未出现在本次 position changes 里的子模块补上同量位移。
 * 已由多选拖动带上的子节点会跳过，避免双重叠加。
 */
export function expandGroupFramePositionChanges<T extends PositionChange>(
  allNodes: Node[],
  positionChanges: T[],
): T[] {
  if (!positionChanges.length) return positionChanges;
  const byId = new Map(allNodes.map((n) => [n.id, n]));
  const movedIds = new Set<string>();
  for (const c of positionChanges) {
    if (c.id) movedIds.add(c.id);
  }
  const extras: T[] = [];

  for (const change of positionChanges) {
    if (change.type !== 'position' || !change.id || !change.position) continue;
    const node = byId.get(change.id);
    if (!node || node.type !== NODE_GROUP_TYPE) continue;
    const prev = node.position || { x: 0, y: 0 };
    const dx = change.position.x - prev.x;
    const dy = change.position.y - prev.y;
    if (dx === 0 && dy === 0) continue;

    for (const n of allNodes) {
      if (n.id === change.id) continue;
      if (getNodeGroupId(n) !== change.id) continue;
      if (movedIds.has(n.id)) continue;
      const start = n.position || { x: 0, y: 0 };
      extras.push({
        ...(change as T),
        id: n.id,
        position: { x: start.x + dx, y: start.y + dy },
      });
      movedIds.add(n.id);
    }
  }

  return extras.length ? [...positionChanges, ...extras] : positionChanges;
}
