/**
 * AI 请求专用 axios 实例
 * - 超时 60s（图片生成等较慢）
 * - axios-retry 3 次，指数退避
 */

import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import { API_TIMEOUT_MS, API_RETRY_COUNT } from '../config/apiConfig.js';

const aiAxios: AxiosInstance = axios.create({
  timeout: API_TIMEOUT_MS,
  proxy: false,
});

aiAxios.interceptors.request.use((config) => {
  const dataStr = config.data != null ? (typeof config.data === 'string' ? config.data : JSON.stringify(config.data)) : '';
  const dataPreview = dataStr ? dataStr.slice(0, 200) + (dataStr.length > 200 ? '...' : '') : '(no body)';
  console.log('[NETWORK] Requesting:', config.url, dataPreview);
  return config;
});

axiosRetry(aiAxios, {
  retries: API_RETRY_COUNT,
  retryCondition: (error) => {
    return (
      axiosRetry.isNetworkOrIdempotentRequestError(error) ||
      error.code === 'ECONNABORTED' ||
      error.response?.status === 429 ||
      error.response?.status === 502 ||
      error.response?.status === 503
    );
  },
  retryDelay: (retryCount) => {
    // 指数退避：1s, 2s, 4s
    return Math.min(1000 * Math.pow(2, retryCount), 10000);
  },
});

export { aiAxios };
