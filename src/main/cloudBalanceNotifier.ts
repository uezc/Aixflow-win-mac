/**
 * 云端余额更新通知 - 供 ChatProvider 等在 run-task 成功后调用
 */
import { updateCloudBalance } from './services/aliyunService.js';
import { getCloudUserState } from './services/aliyunService.js';

type SendFn = (state: { userId: string | null; balance: number; isPro: boolean; status: string }) => void;

let sendToRenderer: SendFn | null = null;

export function setCloudBalanceNotifier(fn: SendFn): void {
  sendToRenderer = fn;
}

export function notifyCloudBalance(balance: number): void {
  updateCloudBalance(balance);
  if (sendToRenderer) {
    const state = getCloudUserState();
    sendToRenderer(state);
  }
}

/** Token 刷新、/me 等已写入 store 后，统一广播当前云端用户状态（顶栏元宝实时同步） */
export function notifyCloudUserStateRefresh(): void {
  if (sendToRenderer) {
    sendToRenderer(getCloudUserState());
  }
}
