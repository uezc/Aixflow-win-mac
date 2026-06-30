/** 与主进程 cloudAiGate.CLOUD_AI_GATE_USER_MESSAGE 保持一致 */
export const CLOUD_AI_GATE_USER_MESSAGE =
  '当前处于离线模式或未登录，请登录云端账号以使用 AI 算力';

export function isCloudAiAuthRequiredError(error: unknown, nxAuthRequired?: boolean): boolean {
  if (nxAuthRequired === true) return true;
  const msg = String(error ?? '').trim();
  return msg === CLOUD_AI_GATE_USER_MESSAGE || msg.includes('请先登录 Aixflow 云端账号');
}
