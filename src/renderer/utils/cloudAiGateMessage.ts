/** 与主进程 cloudAiGate.CLOUD_AI_GATE_USER_MESSAGE 保持一致 */
export const CLOUD_AI_GATE_USER_MESSAGE =
  '当前处于离线模式或未登录，请登录云端账号以使用 AI 算力';

export const NX_SAAS_LOGIN_REQUIRED_EVENT = 'nx-saas-login-required';

export function isCloudAiAuthRequiredError(error: unknown, nxAuthRequired?: boolean): boolean {
  if (nxAuthRequired === true) return true;
  const msg = String(error ?? '').trim();
  if (!msg) return false;
  if (msg === CLOUD_AI_GATE_USER_MESSAGE) return true;
  if (msg.includes('离线模式或未登录')) return true;
  if (msg.includes('未登录') && msg.includes('云端')) return true;
  if (msg.includes('请先登录') && (msg.includes('云端') || msg.includes('Aixflow'))) return true;
  if (/sign in|log in|not signed in|login required|offline mode/i.test(msg)) return true;
  return false;
}

/** 未登录/离线：弹出「返回登录界面」并跳转 /settings（仅用于实时 AI 调用失败，勿在节点挂载/读历史 errorMessage 时调用） */
export function promptNxSaasLoginIfNeeded(error: unknown, nxAuthRequired?: boolean): boolean {
  if (!isCloudAiAuthRequiredError(error, nxAuthRequired)) return false;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NX_SAAS_LOGIN_REQUIRED_EVENT));
  }
  return true;
}
