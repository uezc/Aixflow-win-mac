/**
 * 阿里云函数计算 API 配置
 * HK_FC_ENDPOINT          - 香港 FC 根地址（设置页切「香港」时使用）
 * ALIYUN_FC_INIT_USER_URL - 兼容旧变量（若 HK_FC_ENDPOINT 缺失时回退）
 * BEIJING_FC_ENDPOINT / ALIYUN_FC_FALLBACK_URL - 北京 FC（网络不畅时 failover）
 * ALIYUN_FC_TOKEN        - 请求头 x-nexflow-token，需与 FC 环境变量 API_SECRET_TOKEN 一致
 *
 * 客户端默认 nxCloudFcRoute=hk；香港失败且北京可达时自动切北京。
 * **相同** OTS_* 指向香港实例，勿为北京单独建一套 cn-beijing OTS 以免数据不同步。
 */
function normalizeAliyunFcInitUserUrl(raw: string): string {
  let s = raw.trim();
  if (!s) return '';
  if (s.startsWith('http://')) {
    s = `https://${s.slice(7)}`;
  }
  if (!s.startsWith('https://')) {
    s = `https://${s.replace(/^\/+/, '')}`;
  }
  return s.replace(/\/+$/, '');
}

let runtimeFcEndpointOverride = '';

/** 每次读取 process.env（envLoader 合并 .env 之后也生效，避免模块加载顺序导致常量被冻成空串） */
export function getAliyunFcInitUserUrl(): string {
  if (runtimeFcEndpointOverride) return runtimeFcEndpointOverride;
  const hk = process.env.HK_FC_ENDPOINT?.trim() || '';
  if (hk) return normalizeAliyunFcInitUserUrl(hk);
  return normalizeAliyunFcInitUserUrl(process.env.ALIYUN_FC_INIT_USER_URL?.trim() || '');
}

export function getHongKongFcEndpoint(): string {
  const hk = process.env.HK_FC_ENDPOINT?.trim() || process.env.ALIYUN_FC_INIT_USER_URL?.trim() || '';
  return normalizeAliyunFcInitUserUrl(hk);
}

export function getBeijingFcEndpoint(): string {
  const bj =
    process.env.BEIJING_FC_ENDPOINT?.trim() ||
    process.env.ALIYUN_FC_FALLBACK_URL?.trim() ||
    '';
  return normalizeAliyunFcInitUserUrl(bj);
}

/** 临时覆盖 FC 地址（仅当前进程内存生效，不改 .env） */
export function setAliyunFcRuntimeOverride(url: string): string {
  runtimeFcEndpointOverride = normalizeAliyunFcInitUserUrl(url || '');
  return runtimeFcEndpointOverride;
}

export function clearAliyunFcRuntimeOverride(): void {
  runtimeFcEndpointOverride = '';
}

export function getAliyunFcRuntimeOverride(): string {
  return runtimeFcEndpointOverride;
}

export function getAliyunFcToken(): string {
  return process.env.ALIYUN_FC_TOKEN?.trim() || '';
}

/** 已配置 FC 根地址与 x-nexflow-token 时可走 run-task 转发（本机无需第三方 API Key） */
export function isAliyunFcForwardConfigured(): boolean {
  return Boolean(getAliyunFcInitUserUrl().trim() && getAliyunFcToken().trim());
}
/** 正式版：FC 使用 JWT，run-task 需 Authorization Bearer */
export const NX_SAAS_MODE = process.env.NX_SAAS_MODE === '1' || process.env.NX_SAAS_MODE === 'true';
/**
 * 是否显示「充值档位」并允许调用 FC /recharge（未对接真实支付时应为 false，仅开放兑换码）
 * 项目根目录 .env：NX_ENABLE_DIRECT_RECHARGE=1 或 true 开启（联调/管理员测试）
 */
export const NX_ENABLE_DIRECT_RECHARGE =
  process.env.NX_ENABLE_DIRECT_RECHARGE === '1' || process.env.NX_ENABLE_DIRECT_RECHARGE === 'true';

/**
 * 已配置 ALIYUN_FC_INIT_USER_URL 时，默认走账号 JWT（/login、/me），不再对未登录用户打旧版 POST …/init-user。
 * 若仍依赖仅机器 init-user 的老部署，设 NX_LEGACY_MACHINE_INIT_USER=1。
 */
export const NX_LEGACY_MACHINE_INIT_USER =
  process.env.NX_LEGACY_MACHINE_INIT_USER === '1' || process.env.NX_LEGACY_MACHINE_INIT_USER === 'true';

/**
 * 未配置 ALIYUN_FC_INIT_USER_URL 时，是否仍允许设置页/弹窗完成「本地云端会话」（不向 FC 发登录请求）。
 * 默认开启便于无阿里云环境使用本地功能；正式 SaaS 上架请设环境变量 NX_DISALLOW_OFFLINE_CLOUD_LOGIN=1 并配置 URL。
 */
const NX_CLOUD_OFFLINE_LOGIN_DEFAULT = true;
export const NX_CLOUD_OFFLINE_LOGIN_WHEN_NO_FC =
  process.env.NX_DISALLOW_OFFLINE_CLOUD_LOGIN !== '1' &&
  process.env.NX_DISALLOW_OFFLINE_CLOUD_LOGIN !== 'true' &&
  (NX_CLOUD_OFFLINE_LOGIN_DEFAULT ||
    process.env.NX_CLOUD_OFFLINE_LOGIN === '1' ||
    /^(true|yes)$/i.test(String(process.env.NX_CLOUD_OFFLINE_LOGIN ?? '')));
