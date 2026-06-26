import {
  getNxAccessToken,
  isNxOfflineCloudSession,
  getCloudUserState,
} from './aliyunService.js';
import { isAliyunFcForwardConfigured } from '../config/aliyunConfig.js';

/**
 * 余额查询服务
 * 所有余额查询都在主进程进行，避免跨域问题
 * 
 * 限流保护：
 * - 余额查询频率限制为每 5 分钟一次
 * - 仅在应用启动和手动刷新时触发
 * - 避免轮询导致的 429 错误
 */

// 余额查询限流状态
const balanceQueryState = {
  lastQueryTime: {
    bltcy: 0,
    rh: 0,
  },
  minInterval: 5 * 60 * 1000, // 5 分钟（毫秒）
};

/**
 * 检查是否可以查询余额（限流保护）
 * 即使 force=true，也要检查最小间隔（防止疯狂请求）
 */
function canQueryBalance(type: 'bltcy' | 'rh', force: boolean = false): boolean {
  const now = Date.now();
  const lastQuery = balanceQueryState.lastQueryTime[type];
  const timeSinceLastQuery = now - lastQuery;

  // 最小间隔：即使 force=true，也要至少间隔 2 秒（防止疯狂点击）
  const minInterval = 2000; // 2 秒
  if (timeSinceLastQuery < minInterval) {
    const remainingMs = minInterval - timeSinceLastQuery;
    console.warn(`[余额查询限流] ${type.toUpperCase()} 余额查询过于频繁，还需等待 ${Math.ceil(remainingMs / 1000)} 秒`);
    return false;
  }

  // 如果不是强制刷新，检查 5 分钟间隔
  if (!force) {
    if (timeSinceLastQuery < balanceQueryState.minInterval) {
      const remainingSeconds = Math.ceil((balanceQueryState.minInterval - timeSinceLastQuery) / 1000);
      console.warn(`[余额查询限流] ${type.toUpperCase()} 余额查询过于频繁，还需等待 ${remainingSeconds} 秒`);
      return false;
    }
  }

  return true;
}

/**
 * 更新最后查询时间
 */
function updateLastQueryTime(type: 'bltcy' | 'rh'): void {
  balanceQueryState.lastQueryTime[type] = Date.now();
}

/**
 * 已配置 FC 且用户处于云端会话（JWT 或离线云端占位）时，不再直连 BLTCY / RunningHub 查余额，
 * 统一使用 init-user / 任务回写后的本地元宝余额（与设置页一致）。
 */
function cloudUnifiedBalanceYuanbao(): number | null {
  if (!isAliyunFcForwardConfigured()) return null;
  const s = getCloudUserState();
  if (s.status !== 'success') return null;
  if (getNxAccessToken()?.trim() || isNxOfflineCloudSession()) {
    return typeof s.balance === 'number' ? s.balance : null;
  }
  return null;
}

/** 元宝余额（与设置页一致）；不再向 BLTCY / RunningHub 直连查询 */
export async function getBLTCYBalance(force: boolean = false): Promise<number | null> {
  const cloudBal = cloudUnifiedBalanceYuanbao();
  if (cloudBal !== null) {
    if (canQueryBalance('bltcy', force)) {
      updateLastQueryTime('bltcy');
    }
    return cloudBal;
  }
  return null;
}

/** 与核心算力槽位共用云端元宝；不再向 RunningHub 账户接口直连 */
export async function getRHBalance(force: boolean = false): Promise<number | null> {
  const cloudBal = cloudUnifiedBalanceYuanbao();
  if (cloudBal !== null) {
    if (canQueryBalance('rh', force)) {
      updateLastQueryTime('rh');
    }
    return cloudBal;
  }
  return null;
}
