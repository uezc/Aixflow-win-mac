/**
 * 云端 AI 算力门禁：未配置 FC、未登录 SaaS 或未初始化云端用户时禁止走算力。
 * 与本地 electron-store 第三方 Key 彻底脱钩。
 */
import { isAliyunFcForwardConfigured } from '../config/aliyunConfig.js';
import {
  isNxSaasMode,
  getNxAccessToken,
  isNxOfflineCloudSession,
  getCloudUserState,
} from '../services/aliyunService.js';

export const CLOUD_AI_GATE_USER_MESSAGE =
  '当前处于离线模式或未登录，请登录云端账号以使用 AI 算力';

export function getCloudAiBlockReason(): string | null {
  if (!isAliyunFcForwardConfigured()) {
    return CLOUD_AI_GATE_USER_MESSAGE;
  }
  if (isNxSaasMode()) {
    if (!getNxAccessToken()?.trim() || isNxOfflineCloudSession()) {
      return CLOUD_AI_GATE_USER_MESSAGE;
    }
    return null;
  }
  const s = getCloudUserState();
  if (s.status !== 'success') {
    return CLOUD_AI_GATE_USER_MESSAGE;
  }
  return null;
}

/** 未登录/离线拦截：渲染进程据此弹窗并跳转登录（与 ChatProvider nxAuthRequired 约定一致） */
export function buildCloudAiBlockedPayload(): { error: string; nxAuthRequired: true } {
  return { error: CLOUD_AI_GATE_USER_MESSAGE, nxAuthRequired: true };
}
