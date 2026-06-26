import type { AppLocale } from '../i18n/settingsI18n';

/**
 * 云端登录/注册 IPC 失败时展示文案：去掉 Electron 前缀，并把 Axios 英文转为中文/英文兜底。
 */
export function formatCloudAuthError(e: unknown, locale: AppLocale = 'zh'): string {
  const raw = e instanceof Error ? e.message : String(e);
  const stripped = raw
    .replace(
      /^Error invoking remote method 'nx-cloud-(?:login|register|send-auth-code|change-password|login-with-code|redeem-coupon|recharge|get-profile)':\s*/i,
      '',
    )
    .replace(/^Error:\s*/g, '')
    .trim();
  const en = locale === 'en';
  if (!/AxiosError|Request failed with status code/i.test(stripped)) {
    return stripped || (en ? 'Request failed' : '请求失败');
  }
  if (/status code 401/i.test(stripped)) return en ? 'Invalid email or password' : '邮箱或密码错误';
  if (/status code 403/i.test(stripped)) return en ? 'Account suspended or forbidden' : '账号已冻结或无权限';
  if (/status code 404/i.test(stripped)) {
    return en
      ? 'Cloud endpoint not found. Deploy the latest function (including redeem) and check ALIYUN_FC_INIT_USER_URL.'
      : '云端未找到该接口。请确认函数已部署最新代码（含兑换码接口），并核对 ALIYUN_FC_INIT_USER_URL';
  }
  if (/status code 409/i.test(stripped)) return en ? 'This email is already registered' : '该邮箱已被注册';
  if (/status code 429/i.test(stripped)) return en ? 'Too many requests. Try again later.' : '请求过于频繁，请稍后再试';
  if (/status code 5\d\d/i.test(stripped)) return en ? 'Cloud error. Please try again later.' : '云端服务异常，请稍后重试';
  if (/timeout|ECONNABORTED/i.test(stripped)) return en ? 'Request timed out. Check your network.' : '请求超时，请检查网络后重试';
  if (/ECONNREFUSED|ENOTFOUND|network/i.test(stripped))
    return en ? 'Cannot reach cloud. Check network and FC URL.' : '无法连接云端，请检查网络与 FC 地址';
  return en ? 'Request failed. Try again later.' : '请求失败，请稍后重试';
}
