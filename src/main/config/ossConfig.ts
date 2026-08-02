import { store } from '../services/store.js';

/**
 * 阿里云 OSS 内置配置
 * 安装包自带，用户无需填写。凭证经 Base64 编码避免二进制中明文搜索。
 *
 * 目录划分：
 *
 * **香港桶** `nexflow-temp-images` @ `oss-cn-hongkong` — 海外用户临时素材
 * **北京桶** `nexflow-temp-images-bj` @ `oss-cn-beijing` — 大陆用户临时素材（与香港不同步）
 * **上海桶** `nexflow-temp-images-sh` @ `oss-cn-shanghai` — VIAPI 智能抠像专用（须上海地域公网 URL）
 *
 * 1. **Windows 安装包与 latest.yml** — `OSS_INSTALLER_OBJECT_PREFIX`（默认 `aixflow uploads/`）
 *    仅 Windows `.exe` 与 `latest.yml`；与 package.json `build.publish.url`、落地页 Windows 下载一致。
 *
 * 1b. **Mac 安装包与 latest-mac.yml** — `OSS_MAC_INSTALLER_OBJECT_PREFIX`（默认 `Aixflow uploads Mac/`）
 *    仅 macOS `.zip`/`.dmg`、差分用的 `.zip.blockmap` 与 `latest-mac.yml`；与主进程 `autoUpdater.setFeedURL`、落地页 Mac 下载一致。
 *    控制台路径示例：[Aixflow uploads Mac](https://oss.console.aliyun.com/bucket/oss-cn-hongkong/nexflow-temp-images/object?path=Aixflow%20uploads%20Mac%2F)
 *
 * 2. **临时素材** — `OSS_OBJECT_UPLOAD_PREFIX`（默认 `aixflow-temp-media/`）
 *    图/音/视频等中转文件。建议在 OSS 控制台为该前缀配置生命周期：**过期删除，创建后 1 天**
 *    （规则前缀填 `aixflow-temp-media/`）。具体以控制台「生命周期」规则为准。
 *
 * 控制台入口示例：[bucket 对象列表](https://oss.console.aliyun.com/bucket/oss-cn-hongkong/nexflow-temp-images/object)
 *
 * 如需更换凭证，请将真实值 Base64 编码后替换下面的常量：
 *   node -e "console.log(Buffer.from('你的AccessKeyID', 'utf8').toString('base64'))"
 */

// Base64 编码的 AccessKey ID、Secret（运行时解码）
const ACCESS_KEY_ID_B64 = 'TFRBSTV0N3BKRFo1clpqVEJ5RHJVc0tX';
const ACCESS_KEY_SECRET_B64 = 'eDBOcG80dWx1TnltN3ZkZGJtYXVaamtRemg4NUNF';

const REGION = 'oss-cn-hongkong';
const BUCKET = 'nexflow-temp-images';

/**
 * Windows 安装包与 latest.yml 的对象键前缀（须以 / 结尾）。
 * 与 `scripts/upload-release-to-oss.js`、`build.publish.url` 保持一致。
 */
export const OSS_INSTALLER_OBJECT_PREFIX = 'aixflow uploads/';

/**
 * Mac 安装包与 latest-mac.yml 的对象键前缀（须以 / 结尾）。
 * 与 OSS 控制台目录「Aixflow uploads Mac/」一致（大小写与空格须一致）。
 */
export const OSS_MAC_INSTALLER_OBJECT_PREFIX = 'Aixflow uploads Mac/';

/** 临时素材（图/音/视频）对象键前缀，须以 / 结尾；建议在 OSS 对该前缀配置约 1 天自动删除 */
export const OSS_OBJECT_UPLOAD_PREFIX = 'aixflow-temp-media/';

/** 北京 Release 副本（仅安装包/更新元数据，与 upload-release 脚本一致） */
export const RELEASE_CN_REGION = 'oss-cn-beijing';
export const RELEASE_CN_BUCKET = 'nexflow-temp-images-bj';

/** 临时素材北京桶（与 Release 同桶、不同前缀；大陆用户独立存储，不与香港同步） */
export const MEDIA_CN_REGION = RELEASE_CN_REGION;
export const MEDIA_CN_BUCKET = RELEASE_CN_BUCKET;

/** 临时素材上海桶（VIAPI SegmentVideoBody 要求 videoUrl 为上海 OSS） */
export const MEDIA_SH_REGION = 'oss-cn-shanghai';
export const MEDIA_SH_BUCKET = 'nexflow-temp-images-sh';

export type ReleaseFeedRegion = 'hk' | 'cn';
/** 双线路临时素材区域：hk=香港桶，cn=北京桶（各自独立，不同步） */
export type MediaOssRegion = 'hk' | 'cn';
/** 上传目标区域：含上海（智能抠像专用，不参与双线路切换） */
export type MediaUploadOssRegion = MediaOssRegion | 'sh';

export type BuiltInOssConfig = {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  bucket: string;
  timeout?: number;
};

function installerPrefixSlash(prefix: string): string {
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
}

function buildReleaseFeedBaseUrl(bucket: string, region: string, objectPrefix: string): string {
  const p = installerPrefixSlash(objectPrefix);
  return `https://${bucket}.${region}.aliyuncs.com/${p.replace(/ /g, '%20')}`;
}

/** electron-updater（Windows）香港 Release 基址 */
export function getWindowsUpdaterFeedUrl(): string {
  return buildReleaseFeedBaseUrl(BUCKET, REGION, OSS_INSTALLER_OBJECT_PREFIX);
}

/** electron-updater（Windows）北京 Release 副本基址 */
export function getWindowsUpdaterFeedUrlCn(): string {
  return buildReleaseFeedBaseUrl(RELEASE_CN_BUCKET, RELEASE_CN_REGION, OSS_INSTALLER_OBJECT_PREFIX);
}

/** electron-updater（macOS）香港 Release 基址 */
export function getMacUpdaterFeedUrl(): string {
  return buildReleaseFeedBaseUrl(BUCKET, REGION, OSS_MAC_INSTALLER_OBJECT_PREFIX);
}

/** electron-updater（macOS）北京 Release 副本基址 */
export function getMacUpdaterFeedUrlCn(): string {
  return buildReleaseFeedBaseUrl(RELEASE_CN_BUCKET, RELEASE_CN_REGION, OSS_MAC_INSTALLER_OBJECT_PREFIX);
}

export function getUpdaterFeedUrlForRegion(region: ReleaseFeedRegion, platform: 'win32' | 'darwin'): string {
  if (platform === 'darwin') {
    return region === 'cn' ? getMacUpdaterFeedUrlCn() : getMacUpdaterFeedUrl();
  }
  return region === 'cn' ? getWindowsUpdaterFeedUrlCn() : getWindowsUpdaterFeedUrl();
}

/** 拼接 OSS 对象完整键（避免重复斜杠） */
export function buildOssUploadObjectKey(fileName: string): string {
  const prefix = OSS_OBJECT_UPLOAD_PREFIX.endsWith('/') ? OSS_OBJECT_UPLOAD_PREFIX : `${OSS_OBJECT_UPLOAD_PREFIX}/`;
  const name = String(fileName || '').replace(/^\/+/, '');
  return `${prefix}${name}`;
}

function decode(s: string): string {
  try {
    return Buffer.from(s, 'base64').toString('utf8');
  } catch {
    return s;
  }
}

/** OSS 请求超时时间（毫秒），应对香港节点连接不稳定 */
export const OSS_TIMEOUT_MS = 120000;

/** OSS 上传失败时的最大重试次数 */
export const OSS_RETRY_COUNT = 3;

/** 单张图片直连 OSS / 北京 FC 代传上限（FC JSON base64 请求体须低于约 32MB） */
export const OSS_MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;

function builtInOssCredentials(): Pick<BuiltInOssConfig, 'accessKeyId' | 'accessKeySecret' | 'timeout'> {
  return {
    accessKeyId: decode(ACCESS_KEY_ID_B64),
    accessKeySecret: decode(ACCESS_KEY_SECRET_B64),
    timeout: OSS_TIMEOUT_MS,
  };
}

/** 香港临时素材桶（默认） */
export function getBuiltInOSSConfig(): BuiltInOssConfig {
  return {
    ...builtInOssCredentials(),
    region: REGION,
    bucket: BUCKET,
  };
}

/** 按区域返回临时素材 OSS 配置（大陆 cn / 海外 hk / 上海 sh） */
export function getBuiltInOSSConfigForMedia(region: MediaUploadOssRegion): BuiltInOssConfig {
  if (region === 'cn') {
    return {
      ...builtInOssCredentials(),
      region: MEDIA_CN_REGION,
      bucket: MEDIA_CN_BUCKET,
    };
  }
  if (region === 'sh') {
    return {
      ...builtInOssCredentials(),
      region: MEDIA_SH_REGION,
      bucket: MEDIA_SH_BUCKET,
    };
  }
  return getBuiltInOSSConfig();
}

/** 与 ali-oss `put` 返回 URL 同域的源站公网根（无尾斜杠） */
export function getDirectOssPublicObjectOrigin(): string {
  return getDirectOssPublicObjectOriginForMedia('hk');
}

export function getDirectOssPublicObjectOriginForMedia(region: MediaUploadOssRegion): string {
  const cfg = getBuiltInOSSConfigForMedia(region);
  return `https://${cfg.bucket}.${cfg.region}.aliyuncs.com`;
}

/** 是否为本项目任一临时素材桶源站 URL */
export function isOurMediaOssObjectUrl(url: string): boolean {
  const s = String(url || '');
  return (
    s.includes(`${BUCKET}.${REGION}.aliyuncs.com`) ||
    s.includes(`${MEDIA_CN_BUCKET}.${MEDIA_CN_REGION}.aliyuncs.com`) ||
    s.includes(`${MEDIA_SH_BUCKET}.${MEDIA_SH_REGION}.aliyuncs.com`)
  );
}

/** 公网 URL 是否为上海地域 OSS（VIAPI SegmentVideoBody 可拉取） */
export function isShanghaiOssPublicUrl(url: string): boolean {
  const s = String(url || '').toLowerCase();
  return s.includes('.oss-cn-shanghai.aliyuncs.com') || s.includes(`${MEDIA_SH_BUCKET.toLowerCase()}.`);
}

/**
 * 与 FC 环境变量 `OSS_PUBLIC_BASE_URL` 语义一致：可选 CDN/自定义加速域名。
 * 上传仍走 SDK → 源站；返回给前端的 object URL 可改写为该前缀，使客户端经 CDN 读对象。
 */
export function getOptionalOssPublicBaseUrlFromEnv(): string {
  return String(process.env.OSS_PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
}

export type OssRouteChannel = 'cn' | 'global';

/** 中国通道：优先直连 OSS 香港；全球通道：优先 CDN */
export function getOssRouteChannel(): OssRouteChannel {
  try {
    const v = String(store.get('ossRouteChannel') || 'cn').toLowerCase();
    return v === 'global' ? 'global' : 'cn';
  } catch {
    return 'cn';
  }
}

/** 将 `put` 返回的源站 URL 换为公网/CDN 前缀；默认保持 OSS 源站直链（第三方算力拉 CDN 易失败） */
export function rewriteOssPutUrlToPublic(ossClientUrl: string): string {
  const normalized = String(ossClientUrl || '').replace(/([^:]\/)\/+/g, '$1');
  if (process.env.NX_OSS_UPLOAD_USE_CDN !== '1') return normalized;
  if (getOssRouteChannel() === 'cn') return normalized;
  const cdn = getOptionalOssPublicBaseUrlFromEnv();
  if (!cdn) return normalized;
  try {
    const u = new URL(normalized);
    return (cdn + u.pathname + u.search + u.hash).replace(/([^:]\/)\/+/g, '$1');
  } catch {
    return normalized;
  }
}

/** 生产 CDN 域名（与 OSS_PUBLIC_BASE_URL 常见值一致；未写 env 时仍识别） */
const KNOWN_OSS_CDN_HOSTS = ['cdn.aixflow.ai'];

function urlOriginFromPublicBase(cdn: string): string | null {
  try {
    return new URL(cdn.startsWith('http') ? cdn : `https://${cdn}`).origin;
  } catch {
    return null;
  }
}

/** 是否为本 bucket 绑定的 CDN / 加速域 URL */
function isOurCdnObjectUrl(u: URL): boolean {
  if (KNOWN_OSS_CDN_HOSTS.includes(u.hostname.toLowerCase())) return true;
  const cdn = getOptionalOssPublicBaseUrlFromEnv();
  if (!cdn) return false;
  const cdnOrigin = urlOriginFromPublicBase(cdn);
  return Boolean(cdnOrigin && u.origin === cdnOrigin);
}

/** 是否为本 Bucket 源站或已配置 CDN 公网上的对象 URL */
export function isOurOssOrCdnObjectUrl(url: string): boolean {
  const s = String(url || '');
  if (isOurMediaOssObjectUrl(s)) return true;
  if (KNOWN_OSS_CDN_HOSTS.some((h) => s.includes(h))) return true;
  const cdn = getOptionalOssPublicBaseUrlFromEnv();
  if (cdn && (s === cdn || s.startsWith(`${cdn}/`))) return true;
  return false;
}

/**
 * RunningHub 等第三方会在**其服务端**拉取 imageUrls。CDN 域名在境外/ComfyUI 侧可能出现 SSL 握手失败，
 * 因此提交给 RH 的参考图 URL **始终**改回 OSS 源站直链（与用户侧 OSS 通道 cn/global 无关）。
 * 若需强制仍传 CDN（极少见）：`NX_RH_REF_IMAGE_URL_USE_CDN=1`
 */
export function preferDirectOssUrlForThirdPartyImageRef(url: string): string {
  if (process.env.NX_RH_REF_IMAGE_URL_USE_CDN === '1') {
    return String(url || '').trim();
  }
  const s = String(url || '').trim();
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    const u = new URL(s);
    for (const region of ['hk', 'cn', 'sh'] as MediaUploadOssRegion[]) {
      const directOrigin = getDirectOssPublicObjectOriginForMedia(region);
      if (u.origin === directOrigin) return s;
    }
    if (isOurCdnObjectUrl(u)) {
      const hkOrigin = getDirectOssPublicObjectOriginForMedia('hk');
      return `${hkOrigin}${u.pathname}${u.search}${u.hash}`.replace(/([^:]\/)\/+/g, '$1');
    }
  } catch {
    return s;
  }
  return s;
}

/** 上传后归一化公网 URL（图/音/视频通用，供 RH/FC 等第三方拉取） */
export function normalizeOssMediaUrlForGeneration(url: string): string {
  return preferDirectOssUrlForThirdPartyImageRef(rewriteOssPutUrlToPublic(url));
}

/** 从 OSS 对象 URL 推断素材区域（无法识别时 null；上海不参与双线路） */
export function inferMediaOssRegionFromUrl(url: string): MediaOssRegion | null {
  const s = String(url || '');
  if (s.includes(`${MEDIA_CN_BUCKET}.${MEDIA_CN_REGION}.aliyuncs.com`)) return 'cn';
  if (s.includes(`${BUCKET}.${REGION}.aliyuncs.com`)) return 'hk';
  return null;
}

export function mediaUploadRegionLabel(region: MediaUploadOssRegion): string {
  if (region === 'cn') return '北京';
  if (region === 'sh') return '上海';
  return '香港';
}
