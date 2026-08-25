/**
 * 工程草稿兜底（优化版）：
 * - 紧凑 JSON 热路径（写入更快，降低卡顿中途断电窗口）
 * - 原子写 + 目录 fsync（尽力）
 * - A/B 双槽副本（data.slot-a/b.json）与 bak / 滚动备份
 * - 同内容跳过写盘、按项目串行化保存
 * - 防空 / 防缩覆盖 + 多层加载恢复
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';

export type ProjectGraph = { nodes: any[]; edges: any[] };

export type SaveProjectGraphResult =
  | { success: true; rolledBackup?: string; skipped?: boolean }
  | {
      success: false;
      code: 'EMPTY_OVERWRITE_BLOCKED' | 'SHRINK_OVERWRITE_BLOCKED';
      existingNodes: number;
      incomingNodes: number;
      archivedPath?: string | null;
    };

const ROLLING_DIR = 'backups';
const MAX_ROLLING_BACKUPS = 40;
const SHRINK_GUARD_MIN_EXISTING = 4;
const SHRINK_RATIO = 0.5;
const GLOBAL_LOST_DIR = 'lost-project-data';
const SLOT_A = 'data.slot-a.json';
const SLOT_B = 'data.slot-b.json';
const SLOT_META = 'data.slot-meta.json';

/** 按项目串行化，避免自动保存与退出保存交错半写 */
const saveQueues = new Map<string, Promise<unknown>>();

export function enqueueProjectSave<T>(projectId: string, task: () => T | Promise<T>): Promise<T> {
  const key = String(projectId || '').trim() || '_';
  const prev = saveQueues.get(key) || Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(() => task());
  const tracked = next.then(
    (v) => v,
    (e) => {
      throw e;
    },
  );
  saveQueues.set(
    key,
    tracked.then(
      () => undefined,
      () => undefined,
    ),
  );
  return tracked;
}

export function readProjectGraphFile(filePath: string): ProjectGraph | null {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw || !raw.trim()) return null;
    const data = JSON.parse(raw);
    return {
      nodes: Array.isArray(data?.nodes) ? data.nodes : [],
      edges: Array.isArray(data?.edges) ? data.edges : [],
    };
  } catch {
    return null;
  }
}

export function graphScore(g: ProjectGraph | null | undefined): number {
  if (!g) return -1;
  const n = Array.isArray(g.nodes) ? g.nodes.length : 0;
  const e = Array.isArray(g.edges) ? g.edges.length : 0;
  return n * 1000 + e;
}

/** 热路径：紧凑 JSON，缩短写盘时间 */
export function serializeProjectGraphCompact(graph: ProjectGraph): string {
  return JSON.stringify({ nodes: graph.nodes, edges: graph.edges });
}

export function hashProjectPayload(payload: string): string {
  return crypto.createHash('sha1').update(payload).digest('hex');
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

function tryFsyncPath(filePath: string): void {
  try {
    const fd = fs.openSync(filePath, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* ignore */
  }
}

function tryFsyncDir(dirPath: string): void {
  try {
    const fd = fs.openSync(dirPath, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* Windows 上目录 fsync 常不可用 */
  }
}

/** 先写临时文件并 fsync，再替换目标；尽力 fsync 目录 */
export function atomicWriteText(filePath: string, text: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  fs.writeFileSync(tmp, text, 'utf-8');
  tryFsyncPath(tmp);
  try {
    // Windows：目标存在时 rename 可能失败，用 copy + unlink 更稳
    fs.copyFileSync(tmp, filePath);
    tryFsyncPath(filePath);
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
  tryFsyncDir(dir);
}

function listRollingBackupFiles(projectFolderPath: string): string[] {
  const dir = path.join(projectFolderPath, ROLLING_DIR);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => /^data-\d{4}.+\.json$/i.test(n) || /^data_.+\.json$/i.test(n))
      .map((n) => path.join(dir, n))
      .filter((p) => {
        try {
          return fs.statSync(p).isFile();
        } catch {
          return false;
        }
      })
      .sort((a, b) => {
        try {
          return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
        } catch {
          return 0;
        }
      });
  } catch {
    return [];
  }
}

function pruneRollingBackups(projectFolderPath: string): void {
  const files = listRollingBackupFiles(projectFolderPath);
  for (const f of files.slice(MAX_ROLLING_BACKUPS)) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* ignore */
    }
  }
}

export function writeRollingBackup(
  projectFolderPath: string,
  graph: ProjectGraph,
  reason = 'autosave',
): string | null {
  if (graphScore(graph) <= 0) return null;
  try {
    const dir = path.join(projectFolderPath, ROLLING_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const n = graph.nodes.length;
    const name = `data-${stamp()}-n${n}-${reason}.json`;
    const dest = path.join(dir, name);
    atomicWriteText(dest, serializeProjectGraphCompact(graph));
    pruneRollingBackups(projectFolderPath);
    return `${ROLLING_DIR}/${name}`;
  } catch (e) {
    console.warn('[projectDataDurability] 滚动备份失败:', e);
    return null;
  }
}

export function archiveGraphToLost(
  projectId: string,
  graph: ProjectGraph,
  reason: string,
): string | null {
  if (graphScore(graph) <= 0) return null;
  try {
    const lostDir = path.join(app.getPath('userData'), GLOBAL_LOST_DIR, projectId);
    fs.mkdirSync(lostDir, { recursive: true });
    const file = path.join(lostDir, `graph-${stamp()}-${reason}.json`);
    atomicWriteText(
      file,
      JSON.stringify(
        {
          projectId,
          reason,
          archivedAt: new Date().toISOString(),
          nodes: graph.nodes,
          edges: graph.edges,
        },
        null,
        2,
      ),
    );
    return file;
  } catch (e) {
    console.warn('[projectDataDurability] lost 归档失败:', e);
    return null;
  }
}

/** 入图节点 id 均为已有图子集 → 视为删节点，而非整图被异常换掉 */
function isStrictNodeIdSubset(existing: ProjectGraph | null, incoming: ProjectGraph): boolean {
  const ex = existing?.nodes;
  const inn = incoming.nodes;
  if (!Array.isArray(ex) || !Array.isArray(inn) || inn.length === 0) return false;
  if (inn.length >= ex.length) return false;
  const ids = new Set(ex.map((n) => String(n?.id ?? '')));
  ids.delete('');
  if (ids.size === 0) return false;
  return inn.every((n) => ids.has(String(n?.id ?? '')));
}

function shouldBlockShrink(existing: ProjectGraph | null, incoming: ProjectGraph): boolean {
  const exN = existing?.nodes?.length ?? 0;
  const inN = incoming.nodes.length;
  if (exN < SHRINK_GUARD_MIN_EXISTING) return false;
  if (inN >= exN) return false;
  // 用户手动删模块：剩余 id 仍是原图子集，应正常落盘，勿弹「异常缩水」
  if (isStrictNodeIdSubset(existing, incoming)) return false;
  if (inN < Math.ceil(exN * SHRINK_RATIO)) return true;
  if (exN - inN >= 3 && inN < exN * 0.75) return true;
  return false;
}

function readSlotMeta(projectFolderPath: string): 'a' | 'b' {
  try {
    const p = path.join(projectFolderPath, SLOT_META);
    if (!fs.existsSync(p)) return 'a';
    const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return j?.active === 'b' ? 'b' : 'a';
  } catch {
    return 'a';
  }
}

/** 写入非当前槽，再翻 meta；崩溃时至少有一槽完整 */
function writeAlternatingSlot(projectFolderPath: string, payload: string): void {
  const active = readSlotMeta(projectFolderPath);
  const next: 'a' | 'b' = active === 'a' ? 'b' : 'a';
  const slotName = next === 'a' ? SLOT_A : SLOT_B;
  atomicWriteText(path.join(projectFolderPath, slotName), payload);
  atomicWriteText(
    path.join(projectFolderPath, SLOT_META),
    JSON.stringify({ active: next, updatedAt: new Date().toISOString() }),
  );
}

export type SaveProjectGraphOpts = {
  allowEmptyOverwrite?: boolean;
  allowShrinkOverwrite?: boolean;
  /** 强制落盘（退出/切后台），即使内容哈希相同也写一次槽位心跳可选；默认同内容跳过 */
  force?: boolean;
};

/**
 * 安全保存工程图：防空、防缩、bak、A/B 槽、滚动备份、原子写 data.json。
 * 不删除 assets 内任何素材文件。
 */
export function saveProjectGraphDurable(
  projectFolderPath: string,
  projectId: string,
  nodes: any[],
  edges: any[],
  opts?: SaveProjectGraphOpts,
): SaveProjectGraphResult {
  fs.mkdirSync(path.join(projectFolderPath, 'assets'), { recursive: true });

  const dataPath = path.join(projectFolderPath, 'data.json');
  const bakPath = path.join(projectFolderPath, 'data.json.bak');
  const incoming: ProjectGraph = {
    nodes: Array.isArray(nodes) ? nodes : [],
    edges: Array.isArray(edges) ? edges : [],
  };
  const payload = serializeProjectGraphCompact(incoming);
  const payloadHash = hashProjectPayload(payload);

  // 同内容跳过：减少卡顿时无意义写盘与盘片磨损
  if (!opts?.force && graphScore(incoming) > 0) {
    try {
      if (fs.existsSync(dataPath)) {
        const curRaw = fs.readFileSync(dataPath, 'utf-8');
        if (curRaw && hashProjectPayload(curRaw.replace(/^\uFEFF/, '')) === payloadHash) {
          return { success: true, skipped: true };
        }
        // 紧凑前后空白不同但语义相同
        const curGraph = readProjectGraphFile(dataPath);
        if (curGraph && serializeProjectGraphCompact(curGraph) === payload) {
          return { success: true, skipped: true };
        }
      }
    } catch {
      /* 继续正常写入 */
    }
  }

  const existing = readProjectGraphFile(dataPath);
  const existingScore = graphScore(existing);
  const incomingEmpty = graphScore(incoming) <= 0;
  const existingHasGraph = existingScore > 0;

  if (incomingEmpty && existingHasGraph && !opts?.allowEmptyOverwrite) {
    const archivedPath = archiveGraphToLost(projectId, existing!, 'empty-overwrite-blocked');
    console.warn(
      `[save-project-data] 阻止空画布覆盖: ${projectId}（现有 ${existing?.nodes?.length ?? 0} 节点）`,
    );
    return {
      success: false,
      code: 'EMPTY_OVERWRITE_BLOCKED',
      existingNodes: existing?.nodes?.length ?? 0,
      incomingNodes: 0,
      archivedPath,
    };
  }

  if (
    !opts?.allowShrinkOverwrite &&
    !opts?.allowEmptyOverwrite &&
    existingHasGraph &&
    shouldBlockShrink(existing, incoming)
  ) {
    archiveGraphToLost(projectId, incoming, 'shrink-incoming');
    const archivedExisting = archiveGraphToLost(projectId, existing!, 'shrink-blocked-keep');
    writeRollingBackup(projectFolderPath, incoming, 'rejected-shrink');
    console.warn(
      `[save-project-data] 阻止缩水覆盖: ${projectId} ${existing?.nodes?.length} → ${incoming.nodes.length}`,
    );
    return {
      success: false,
      code: 'SHRINK_OVERWRITE_BLOCKED',
      existingNodes: existing?.nodes?.length ?? 0,
      incomingNodes: incoming.nodes.length,
      archivedPath: archivedExisting,
    };
  }

  let rolledBackup: string | undefined;
  if (existingHasGraph && existing) {
    const sameCount =
      (existing.nodes?.length ?? 0) === incoming.nodes.length &&
      (existing.edges?.length ?? 0) === incoming.edges.length;
    let shouldPreRoll = !sameCount;
    if (sameCount) {
      const latest = listRollingBackupFiles(projectFolderPath)[0];
      if (!latest) {
        shouldPreRoll = true;
      } else {
        try {
          const age = Date.now() - fs.statSync(latest).mtimeMs;
          if (age >= 60_000) shouldPreRoll = true;
        } catch {
          shouldPreRoll = true;
        }
      }
    }
    if (shouldPreRoll) {
      rolledBackup = writeRollingBackup(projectFolderPath, existing, 'pre-save') || undefined;
    }
    try {
      atomicWriteText(bakPath, serializeProjectGraphCompact(existing));
    } catch (e) {
      console.warn('[save-project-data] 写入 data.json.bak 失败:', e);
    }
  }

  // 先写 A/B 槽，再写主 data.json：主文件损坏时槽位仍在
  try {
    writeAlternatingSlot(projectFolderPath, payload);
  } catch (e) {
    console.warn('[save-project-data] A/B 槽写入失败（继续写主文件）:', e);
  }
  atomicWriteText(dataPath, payload);

  if (graphScore(incoming) > 0) {
    let shouldOkRoll = true;
    const latest = listRollingBackupFiles(projectFolderPath)[0];
    if (latest && /(-ok|-pre-save)\.json$/i.test(latest)) {
      try {
        const age = Date.now() - fs.statSync(latest).mtimeMs;
        const prev = readProjectGraphFile(latest);
        const sameCount =
          (prev?.nodes?.length ?? -1) === incoming.nodes.length &&
          (prev?.edges?.length ?? -1) === incoming.edges.length;
        if (sameCount && age < 120_000) shouldOkRoll = false;
      } catch {
        shouldOkRoll = true;
      }
    }
    if (shouldOkRoll) {
      const okRoll = writeRollingBackup(projectFolderPath, incoming, 'ok');
      if (okRoll) rolledBackup = okRoll;
    }
  }

  return { success: true, rolledBackup };
}

type GraphCandidate = { graph: ProjectGraph; source: string; mtimeMs: number };

function pushCandidate(list: GraphCandidate[], filePath: string, source: string): void {
  const graph = readProjectGraphFile(filePath);
  if (!graph) return;
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    mtimeMs = 0;
  }
  list.push({ graph, source, mtimeMs });
}

export function resolveBestProjectGraph(
  projectFolderPath: string,
  projectId: string,
): { graph: ProjectGraph; source: string } | null {
  const candidates: GraphCandidate[] = [];
  pushCandidate(candidates, path.join(projectFolderPath, 'data.json'), 'data.json');
  pushCandidate(candidates, path.join(projectFolderPath, 'data.json.bak'), 'data.json.bak');
  pushCandidate(candidates, path.join(projectFolderPath, SLOT_A), SLOT_A);
  pushCandidate(candidates, path.join(projectFolderPath, SLOT_B), SLOT_B);
  for (const f of listRollingBackupFiles(projectFolderPath)) {
    pushCandidate(candidates, f, path.relative(projectFolderPath, f).replace(/\\/g, '/'));
  }
  const lostDir = path.join(app.getPath('userData'), GLOBAL_LOST_DIR, projectId);
  if (fs.existsSync(lostDir)) {
    try {
      for (const name of fs.readdirSync(lostDir)) {
        if (!name.endsWith('.json')) continue;
        pushCandidate(candidates, path.join(lostDir, name), `lost/${name}`);
      }
    } catch {
      /* ignore */
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const ds = graphScore(b.graph) - graphScore(a.graph);
    if (ds !== 0) return ds;
    return b.mtimeMs - a.mtimeMs;
  });
  return { graph: candidates[0].graph, source: candidates[0].source };
}

export function loadProjectGraphDurable(
  projectFolderPath: string,
  projectId: string,
): { nodes: any[]; edges: any[]; recoveredFrom?: string } {
  const dataPath = path.join(projectFolderPath, 'data.json');
  const primary = readProjectGraphFile(dataPath);
  const primaryScore = graphScore(primary);

  // 主文件可读且有图：视为用户当前落盘结果（含手动删模块后的缩水），
  // 切勿仅因 backups/ 里旧 pre-save 节点更多就自动「恢复」覆盖。
  if (primary && primaryScore > 0) {
    return { nodes: primary.nodes, edges: primary.edges };
  }

  const best = resolveBestProjectGraph(projectFolderPath, projectId);
  if (!best) {
    console.error('[load-project-data] 无任何可读草稿:', projectId);
    return { nodes: [], edges: [] };
  }

  const bestScore = graphScore(best.graph);
  if (bestScore <= 0) {
    if (primary) return { nodes: primary.nodes, edges: primary.edges };
    return { nodes: [], edges: [] };
  }

  // 仅当主文件缺失 / 空图 / 损坏时，才从 bak、A/B 槽或滚动备份拉回
  console.warn(
    `[load-project-data] 主文件不可用（分 ${primaryScore}），已从 ${best.source} 恢复 ${best.graph.nodes.length} 节点: ${projectId}`,
  );
  try {
    atomicWriteText(dataPath, serializeProjectGraphCompact(best.graph));
  } catch (e) {
    console.warn('[load-project-data] 回写 data.json 失败:', e);
  }
  return {
    nodes: best.graph.nodes,
    edges: best.graph.edges,
    recoveredFrom: best.source,
  };
}

export function listProjectBackupSummaries(projectFolderPath: string): Array<{
  path: string;
  nodes: number;
  edges: number;
  mtimeMs: number;
}> {
  const out: Array<{ path: string; nodes: number; edges: number; mtimeMs: number }> = [];
  const add = (abs: string, rel: string) => {
    const g = readProjectGraphFile(abs);
    if (!g) return;
    let mtimeMs = 0;
    try {
      mtimeMs = fs.statSync(abs).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    out.push({
      path: rel,
      nodes: g.nodes.length,
      edges: g.edges.length,
      mtimeMs,
    });
  };
  add(path.join(projectFolderPath, 'data.json'), 'data.json');
  add(path.join(projectFolderPath, 'data.json.bak'), 'data.json.bak');
  add(path.join(projectFolderPath, SLOT_A), SLOT_A);
  add(path.join(projectFolderPath, SLOT_B), SLOT_B);
  for (const f of listRollingBackupFiles(projectFolderPath)) {
    add(f, path.relative(projectFolderPath, f).replace(/\\/g, '/'));
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}
