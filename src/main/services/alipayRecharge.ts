/**
 * 调用本机支付宝充值 API（backend/alipay_test.py，默认 :8000）
 */
import axios from 'axios';
import { getCloudUserState, getNxAccessToken } from './aliyunService.js';

const DEFAULT_BASE = 'http://127.0.0.1:8000';

function alipayApiBase(): string {
  return (process.env.ALIPAY_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
}

export type AlipayCreateOrderResult = {
  package_id: string;
  out_trade_no: string;
  total_amount: string;
  package_yuanbao: number;
  subject: string;
  pay_url: string;
  user_id?: string;
};

export async function createAlipayRechargeOrder(packageId: string): Promise<AlipayCreateOrderResult> {
  const userId = String(getCloudUserState().userId ?? '').trim();
  const accessToken = String(getNxAccessToken() ?? '').trim();
  if (!userId || !accessToken) {
    throw new Error('请先登录云端账号后再充值');
  }

  const base = alipayApiBase();
  const { data } = await axios.post<AlipayCreateOrderResult>(
    `${base}/api/v1/alipay/create_order`,
    {
      package_id: packageId,
      user_id: userId,
      access_token: accessToken,
    },
    { timeout: 15000 },
  );
  if (!data?.pay_url) {
    throw new Error('支付服务未返回 pay_url，请确认 backend 已启动（npm run alipay:start）');
  }
  return data;
}
