/**
 * Unified Queue：从 task / attrs 解析 RunningHub forward（与 Phase 7 Dispatch 同源）。
 * 无 path → 不可 Dispatch（永久数据缺陷，除非后续写入 forward）。
 */

/**
 * @param {Record<string, unknown> | null | undefined} taskOrAttrs
 * @returns {{ path: string, [k: string]: unknown } | null}
 */
export function parseForwardPayload(taskOrAttrs) {
  const task = taskOrAttrs || {};
  const raw = task.provider_forward_json || task.forward_json || '';
  if (raw && typeof raw === 'string') {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object' && String(o.path || '').trim()) return o;
    } catch (_) {}
  }
  const pj = task.prompt_json;
  if (pj && typeof pj === 'string') {
    try {
      const o = JSON.parse(pj);
      if (o?._nexflow_forward && typeof o._nexflow_forward === 'object') {
        const f = o._nexflow_forward;
        if (String(f.path || '').trim()) return f;
      }
      if (o?.forward && typeof o.forward === 'object' && String(o.forward.path || '').trim()) {
        return o.forward;
      }
    } catch (_) {}
  }
  return null;
}

/** @param {Record<string, unknown> | null | undefined} taskOrAttrs */
export function hasValidForwardPath(taskOrAttrs) {
  return Boolean(parseForwardPayload(taskOrAttrs)?.path);
}

export const PROVIDER_ERROR_NO_FORWARD = 'NO_FORWARD_PAYLOAD';
