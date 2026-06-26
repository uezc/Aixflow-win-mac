import { diagnosticLogger } from '../utils/diagnostic.js';

export class SystemSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SystemSafetyError';
  }
}

export type ControlRegion = 'hk' | 'be' | string;
export type ControlOperation = 'read' | 'write' | string;

export function checkWriteSafety(region: ControlRegion, operation: ControlOperation = 'write'): void {
  const r = String(region || '').trim().toLowerCase();
  const op = String(operation || '').trim().toLowerCase();
  if (r === 'be' && op === 'write') {
    const msg = '[Sentinel] 北京冷备仅允许只读，已拦截写入请求。';
    diagnosticLogger.error(msg, { region: r, operation: op });
    throw new SystemSafetyError(msg);
  }
  diagnosticLogger.trace('[Sentinel] 写入安全检查通过', { region: r, operation: op });
}
