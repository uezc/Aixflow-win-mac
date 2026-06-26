/**
 * 阿里云 OSS SDK（ali-oss）Endpoint 与连接选项：FC Node.js 20 + 香港地域。
 * 内网域名：https://{OSS_REGION}-internal.aliyuncs.com（香港：oss-cn-hongkong-internal.aliyuncs.com）
 *
 * 环境变量仅允许下列键名（区分大小写，与 FC 控制台填写一致）：
 *   OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET
 * AIXflow 管理接口另需：ADMIN_PASS（在 lib/aixflow-admin-oss.mjs 校验，不在此创建 OSS 时使用）
 *
 * ali-oss 在 createRequest 内会生成 x-oss-date；本模块在 request 拦截层为每次请求再写入最新 GMT Date，
 * 避免部分环境下 MissingRequiredHeader（Date / x-oss-date）报错。
 */
import http from 'node:http';
import https from 'node:https';
import OSS from 'ali-oss';

/** 进程内复用连接；与 enableKeepAlive: true 一并强制长连接行为 */
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

/** 与 FC 控制台、代码读取严格一致（勿改大小写） */
export const STRICT_OSS_ENV_KEYS = Object.freeze([
  'OSS_REGION',
  'OSS_BUCKET',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
]);

export const STRICT_ADMIN_ENV_KEY = 'ADMIN_PASS';

export function useOssInternalFromEnv(env = process.env) {
  return (
    env.OSS_USE_INTERNAL === '1' ||
    env.OSS_USE_INTERNAL === 'true' ||
    env.OSS_USE_INTERNAL === 'yes'
  );
}

/** @param {string} region 如 oss-cn-hongkong */
export function ossInternalEndpointForRegion(region) {
  const r = String(region || '').trim();
  if (!r) return '';
  return `https://${r}-internal.aliyuncs.com`;
}

/** 返回应传给 ali-oss 的 endpoint（含 https://）；无需走内网且未显式指定时返回 null。 */
export function resolveOssEndpoint(env = process.env) {
  const custom = env.OSS_ENDPOINT?.trim();
  if (custom) {
    if (/^https?:\/\//i.test(custom)) return custom;
    return `https://${custom}`;
  }
  const region = env.OSS_REGION?.trim();
  if (useOssInternalFromEnv(env) && region) {
    return ossInternalEndpointForRegion(region);
  }
  return null;
}

/**
 * 读取 OSS 环境变量（键名严格为 OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET）
 * @returns {{ region: string, bucket: string, accessKeyId: string, accessKeySecret: string }}
 */
export function readOssEnv(env = process.env) {
  const trim = (v) => (v === undefined || v === null ? '' : String(v).trim());
  return {
    region: trim(env.OSS_REGION),
    bucket: trim(env.OSS_BUCKET),
    accessKeyId: trim(env.OSS_ACCESS_KEY_ID),
    accessKeySecret: trim(env.OSS_ACCESS_KEY_SECRET),
  };
}

/** 管理口令，键名严格为 ADMIN_PASS（供文档与其它模块统一引用） */
export function readAdminPass(env = process.env) {
  const v = env.ADMIN_PASS;
  return v === undefined || v === null ? '' : String(v).trim();
}

/**
 * 一次性读取 AIXflow 后端要求的键（仅上述 5 个名字，无别名）
 * @returns {{ OSS_REGION: string, OSS_BUCKET: string, OSS_ACCESS_KEY_ID: string, OSS_ACCESS_KEY_SECRET: string, ADMIN_PASS: string }}
 */
export function readStrictAixflowFcEnv(env = process.env) {
  const o = readOssEnv(env);
  return {
    OSS_REGION: o.region,
    OSS_BUCKET: o.bucket,
    OSS_ACCESS_KEY_ID: o.accessKeyId,
    OSS_ACCESS_KEY_SECRET: o.accessKeySecret,
    ADMIN_PASS: readAdminPass(env),
  };
}

/**
 * 构造传给 `new OSS(...)` 的选项：HTTPS、Keep-Alive、可选内网 endpoint、可选 V4 签名。
 * `enableKeepAlive: true` 为显式标记；Node 侧主要通过 agent/httpsAgent 启用 keep-alive。
 */
export function buildAliOssClientOptions(env = process.env) {
  const creds = readOssEnv(env);
  const ep = resolveOssEndpoint(env);
  const opts = {
    region: creds.region,
    bucket: creds.bucket,
    accessKeyId: creds.accessKeyId,
    accessKeySecret: creds.accessKeySecret,
    /** 强制 HTTPS */
    secure: true,
    agent: httpAgent,
    httpsAgent: httpsAgent,
    /** ali-oss 选项 + Agent keepAlive，双保险 */
    enableKeepAlive: true,
  };
  if (ep) opts.endpoint = ep;
  if (
    env.OSS_AUTHORIZATION_V4 === '1' ||
    env.OSS_AUTHORIZATION_V4 === 'true' ||
    env.OSS_AUTHORIZATION_V4 === 'yes'
  ) {
    opts.authorizationV4 = true;
  }
  return opts;
}

/**
 * 创建 OSS 客户端：校验 AK 非空；为每次 request 附带当前 GMT Date 头（不覆盖 SDK 自管的 x-oss-date 生成逻辑）。
 */
export function createOssClientInstance(env = process.env) {
  const creds = readOssEnv(env);
  if (!creds.region || !creds.bucket || !creds.accessKeyId || !creds.accessKeySecret) {
    throw new Error('OSS_NOT_CONFIGURED');
  }
  const opts = buildAliOssClientOptions(env);
  const client = new OSS(opts);
  const origRequest = client.request.bind(client);
  client.request = async function requestWithDateHeader(params) {
    const p = params ? { ...params } : {};
    const dateGmt = new Date().toUTCString();
    p.headers = { ...(p.headers || {}), Date: dateGmt };
    return origRequest(p);
  };
  return client;
}
