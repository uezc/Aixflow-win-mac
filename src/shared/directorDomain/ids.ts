/** 短 ID 生成（渲染/主进程共用） */
export function dramaNewId(prefix: string): string {
  const p = String(prefix || 'id').replace(/[^a-z0-9_-]/gi, '').slice(0, 16) || 'id';
  return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
