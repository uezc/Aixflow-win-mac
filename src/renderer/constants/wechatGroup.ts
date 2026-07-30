/**
 * 登录页微信交流群二维码。
 *
 * 实际图片由主进程列举北京桶前缀 `WX/` 下最新一张返回（见 `wechat-group:get-qr-url`）。
 * 运维换图：OSS 控制台 `nexflow-temp-images-bj` → `WX/` 覆盖/替换图片即可，无需改客户端。
 *
 * 可选：`VITE_WECHAT_GROUP_QR_URL` 仅作本地调试覆盖。
 */
export const WECHAT_GROUP_OSS_PREFIX = 'WX/';
export const WECHAT_GROUP_OSS_PUBLIC_ORIGIN =
  'https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com';

export function getWeChatGroupQrUrlOverride(): string | null {
  const fromEnv = String(
    (import.meta as { env?: { VITE_WECHAT_GROUP_QR_URL?: string } }).env?.VITE_WECHAT_GROUP_QR_URL || '',
  ).trim();
  return fromEnv || null;
}
