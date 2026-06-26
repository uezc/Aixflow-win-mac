import { checkWriteSafety, type ControlRegion } from './controlPlane.js';

/**
 * HK 单一生产写入口。所有 OTS 写操作从此处统一拦截。
 */
export async function writeOts(
  region: ControlRegion,
  action: () => Promise<void>,
): Promise<void> {
  checkWriteSafety(region, 'write');
  await action();
}

/**
 * // [BE-ONLY] Cold Storage / Legacy Archive - READ ONLY
 */
export async function readOts<T>(action: () => Promise<T>): Promise<T> {
  return action();
}
