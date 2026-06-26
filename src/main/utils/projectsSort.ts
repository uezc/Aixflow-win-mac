/** 项目列表项（与 electron-store `projects` 及渲染层 Project 一致） */
export type ProjectListRecord = {
  id: string;
  name: string;
  date: string;
  createdAt: number;
  lastModified: number;
};

/** 用于排序的「创建时间」：严格优先 createdAt；缺时从 id `project-<ms>` 解析；最后才用 lastModified */
export function projectCreatedSortKey(p: ProjectListRecord): number {
  const rawC = (p as { createdAt?: unknown }).createdAt;
  let c = 0;
  if (typeof rawC === 'number' && Number.isFinite(rawC)) c = rawC;
  else if (typeof rawC === 'string' && rawC.trim() !== '') {
    const n = parseInt(rawC, 10);
    if (Number.isFinite(n) && n > 0) c = n;
  }
  if (c > 0) return c;
  const idMs = /^project-(\d+)/.exec(p.id);
  if (idMs) {
    const fromId = parseInt(idMs[1], 10);
    if (Number.isFinite(fromId) && fromId > 0) return fromId;
  }
  const m = p.lastModified;
  if (typeof m === 'number' && Number.isFinite(m) && m > 0) return m;
  return 0;
}

/** 按创建时间倒序（越新建越靠前，时间轴倒序） */
export function sortProjectsByCreatedAtDesc<T extends ProjectListRecord>(projects: T[]): T[] {
  return [...projects].sort((a, b) => {
    const diff = projectCreatedSortKey(b) - projectCreatedSortKey(a);
    if (diff !== 0) return diff;
    return b.id.localeCompare(a.id);
  });
}

/** 按 id 列表重排项目（拖动排序用，保留未出现在列表中的尾部项） */
export function reorderProjectsByIds<T extends ProjectListRecord>(
  projects: T[],
  projectIds: string[],
): T[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const next: T[] = [];
  for (const id of projectIds) {
    const item = byId.get(id);
    if (item) {
      next.push(item);
      byId.delete(id);
    }
  }
  for (const item of byId.values()) {
    next.push(item);
  }
  return next;
}
