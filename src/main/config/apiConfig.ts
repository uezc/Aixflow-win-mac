/**
 * 主进程 API 配置
 * 集中管理超时、重试等参数，避免 30s 阻塞导致卡顿
 */

/** AI 请求超时时间（毫秒），图片生成等较慢，60s 更合理 */
export const API_TIMEOUT_MS = 60000;

/** axios-retry 重试次数 */
export const API_RETRY_COUNT = 3;
