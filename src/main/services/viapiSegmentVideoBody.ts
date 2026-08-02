/**
 * 视频智能抠像（一键人像）：本地预检 → OSS 公网 URL → FC VIAPI SegmentVideoBody →
 * 下载 mask → 本地 ffmpeg 合成 WebM VP9+alpha。
 * AccessKey 仅存 FC，不下发渲染进程。
 */
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { app } from 'electron';
import { getNxFcAxios, getFcBaseUrlForClient } from './nxFcClient.js';
import {
  localResourceManager,
  resolveLocalMediaFilePath,
  type LocalVideoResourceResult,
} from './localResourceManager.js';
import { checkLicenseStatus } from './licenseManager.js';
import { getNxAccessToken } from './aliyunService.js';

export const VIAPI_SEGMENT_VIDEO_BODY_MODEL_ID = 'viapi-segment-video-body';

const FC_TIMEOUT_MS = 20 * 60 * 1000;

export type SmartMattingProgressPhase =
  | 'precheck'
  | 'upload'
  | 'cloud'
  | 'download_mask'
  | 'compose'
  | 'done';

export type SmartMattingProgress = {
  phase: SmartMattingProgressPhase;
  percent: number;
  message: string;
};

const SH_OSS_REQUIRED_MSG =
  '请配置上海 OSS 素材桶供智能抠像使用（FC 环境变量 OSS_MEDIA_SH_BUCKET、OSS_MEDIA_SH_REGION=oss-cn-shanghai）';

function mapFcError(status: number, data: unknown): { code: string; message: string } {
  const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const err = String(body.error || '').trim();
  const msg = String(body.message || '').trim();
  if (status === 401 || err === 'UNAUTHORIZED') {
    return { code: 'UNAUTHORIZED', message: '请先登录账号后再使用智能抠像' };
  }
  if (status === 402 || err === 'BALANCE_INSUFFICIENT') {
    return { code: 'BALANCE_INSUFFICIENT', message: msg || '元宝不足，请充值后再使用智能抠像' };
  }
  if (err === 'OSS_SH_NOT_CONFIGURED' || (status === 503 && /上海|OSS_MEDIA_SH/i.test(msg))) {
    return { code: 'OSS_SH_NOT_CONFIGURED', message: msg || SH_OSS_REQUIRED_MSG };
  }
  if (err === 'OSS_REGION') {
    return {
      code: 'OSS_REGION',
      message: msg || '视频须上传至上海地域 OSS 后才能智能抠像',
    };
  }
  if (err === 'VIAPI_NOT_CONFIGURED' || status === 503) {
    return {
      code: 'NOT_CONFIGURED',
      message: msg || '云端未配置视觉智能抠像（VIAPI AccessKey），请联系管理员',
    };
  }
  if (err === 'VIDEO_URL_REQUIRED' || err === 'VIDEO_URL_INVALID' || status === 400) {
    return { code: err || 'BAD_REQUEST', message: msg || '视频公网地址无效' };
  }
  if (err === 'TIMEOUT' || status === 504) {
    return { code: 'TIMEOUT', message: msg || '云端智能抠像超时，请缩短视频后重试' };
  }
  if (/invalid region|地域不对|oss url/i.test(msg + err)) {
    return {
      code: 'OSS_REGION',
      message: '视频须上传至上海地域 OSS 后才能智能抠像。请确认已配置 OSS_MEDIA_SH_BUCKET 并重新部署云端',
    };
  }
  if (/余额|balance|Arrearage|Insufficient|InvalidAccessKey/i.test(msg + err)) {
    return {
      code: 'UPSTREAM',
      message: msg || '视觉智能服务异常或账号欠费，请稍后重试或联系管理员',
    };
  }
  return {
    code: err || 'FC_ERROR',
    message: msg || `智能抠像失败（HTTP ${status}）`,
  };
}

function videoMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.avi') return 'video/x-msvideo';
  if (ext === '.flv') return 'video/x-flv';
  if (ext === '.webm') return 'video/webm';
  return 'video/mp4';
}

async function ensureLocalVideoPath(projectId: string | undefined, videoUrl: string): Promise<{
  inputPath: string;
  shouldDelete: boolean;
}> {
  const url = (videoUrl || '').trim();
  if (!url) throw Object.assign(new Error('视频 URL 为空'), { code: 'EMPTY_URL' });

  if (/^https?:\/\//i.test(url)) {
    const saveDir = await localResourceManager.getProjectSaveDir(projectId);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const extMatch = url.split('?')[0]?.match(/\.(mp4|mov|avi|flv|m4v|webm)$/i);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '.mp4';
    const dest = path.join(saveDir, `video-smart-matting-src-${id}${ext}`).replace(/\\/g, '/');
    const resp = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 180000,
      proxy: false,
    });
    fs.writeFileSync(dest, Buffer.from(resp.data));
    return { inputPath: dest, shouldDelete: true };
  }

  return { inputPath: await resolveLocalMediaFilePath(projectId, url), shouldDelete: false };
}

async function callFcSegmentVideoBody(
  videoUrl: string,
  durationSec: number,
): Promise<{
  maskVideoUrl: string;
  cost?: number;
  billableSeconds?: number;
  billableUnits?: number;
}> {
  const base = getFcBaseUrlForClient();
  if (!base) {
    throw Object.assign(new Error('未配置云端地址（HK_FC_ENDPOINT / ALIYUN_FC_INIT_USER_URL）'), {
      code: 'NO_FC',
    });
  }

  const axiosInst = getNxFcAxios();
  try {
    const res = await axiosInst.post(
      '/viapi/segment-video-body',
      { videoUrl, durationSec },
      { timeout: FC_TIMEOUT_MS },
    );
    const data = res.data || {};
    const maskVideoUrl = String(data.maskVideoUrl || data.mask_video_url || '').trim();
    if (!maskVideoUrl) {
      throw Object.assign(new Error('云端未返回 mask 视频地址'), { code: 'NO_MASK_URL' });
    }
    const billableSeconds =
      typeof data.billableSeconds === 'number'
        ? data.billableSeconds
        : typeof data.billableUnits === 'number'
          ? data.billableUnits
          : typeof data.billableMinutes === 'number'
            ? data.billableMinutes
            : undefined;
    return {
      maskVideoUrl,
      cost: typeof data.cost === 'number' ? data.cost : undefined,
      billableSeconds,
      billableUnits: billableSeconds,
    };
  } catch (e: unknown) {
    const ax = e as {
      response?: { status?: number; data?: unknown };
      message?: string;
      code?: string;
    };
    if (ax.code && ax.message && !ax.response && ax.code !== 'ECONNABORTED') {
      throw e;
    }
    if (ax.response) {
      const mapped = mapFcError(ax.response.status || 500, ax.response.data);
      throw Object.assign(new Error(mapped.message), { code: mapped.code });
    }
    const msg = ax.message || String(e);
    if (/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|network|ECONNABORTED/i.test(msg)) {
      throw Object.assign(new Error('网络异常或云端智能抠像超时，请检查网络后重试'), {
        code: 'NETWORK',
      });
    }
    throw Object.assign(new Error(msg || '智能抠像失败'), { code: 'UNKNOWN' });
  }
}

/**
 * 端到端：预检 → 上传 → FC 抠像 → mask 合成透明 WebM → 落盘为本地视频资源。
 */
export async function runSmartPortraitMatting(
  projectId: string | undefined,
  videoUrl: string,
  onProgress?: (p: SmartMattingProgress) => void,
): Promise<LocalVideoResourceResult> {
  const check = checkLicenseStatus(app.getPath('userData'));
  if (check.status !== 'VALID') {
    throw Object.assign(new Error('智能抠像需要有效授权，请先激活'), { code: 'LICENSE' });
  }
  if (!getNxAccessToken()) {
    throw Object.assign(new Error('请先登录云端账号'), { code: 'UNAUTHORIZED' });
  }

  const report = (phase: SmartMattingProgressPhase, percent: number, message: string) => {
    try {
      onProgress?.({ phase, percent, message });
    } catch {
      // ignore
    }
  };

  report('precheck', 5, '正在检查视频是否符合智能抠像要求…');
  const { inputPath, shouldDelete } = await ensureLocalVideoPath(projectId, videoUrl);

  try {
    const pre = await localResourceManager.precheckVideoForViapiSegment(inputPath);
    if (!pre.ok) {
      throw Object.assign(new Error(pre.message), { code: pre.code || 'PRECHECK' });
    }

    report('upload', 15, '正在上传视频到上海云端…');
    const buffer = fs.readFileSync(inputPath);
    const { VideoProvider } = await import('../ai/providers/VideoProvider.js');
    const { isShanghaiOssPublicUrl } = await import('../config/ossConfig.js');
    const vp = new VideoProvider();
    let publicUrl: string;
    try {
      // VIAPI SegmentVideoBody 要求 videoUrl 为上海地域 OSS（文档 155645）
      publicUrl = await vp.uploadVideoToOSS(buffer, videoMime(inputPath), { mediaRegion: 'sh' });
    } catch (uploadErr: unknown) {
      const ue = uploadErr as { code?: string; message?: string };
      if (ue?.code === 'OSS_SH_NOT_CONFIGURED') {
        throw Object.assign(new Error(ue.message || SH_OSS_REQUIRED_MSG), {
          code: 'OSS_SH_NOT_CONFIGURED',
        });
      }
      throw uploadErr;
    }
    const publicTrimmed = String(publicUrl || '').trim();
    if (!publicTrimmed || !/^https?:\/\//i.test(publicTrimmed)) {
      throw Object.assign(new Error('上传未返回公网 URL'), { code: 'UPLOAD_FAILED' });
    }
    if (/[\u4e00-\u9fff]/.test(publicTrimmed)) {
      throw Object.assign(new Error('上传后的视频 URL 含中文，不符合阿里云 VIAPI 要求'), {
        code: 'URL_CN',
      });
    }
    if (!isShanghaiOssPublicUrl(publicTrimmed)) {
      throw Object.assign(
        new Error(
          '智能抠像要求视频位于上海地域 OSS，当前上传地址不符合要求。请在云端配置 OSS_MEDIA_SH_BUCKET 后重新部署',
        ),
        { code: 'OSS_REGION' },
      );
    }

    report('cloud', 30, '云端人像分割处理中，请稍候…');
    const { maskVideoUrl } = await callFcSegmentVideoBody(publicTrimmed, pre.durationSec);

    report('download_mask', 70, '正在下载人像遮罩…');
    const saveDir = await localResourceManager.getProjectSaveDir(projectId);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const maskPath = path.join(saveDir, `video-smart-matting-mask-${id}.mp4`).replace(/\\/g, '/');
    const maskResp = await axios.get<ArrayBuffer>(maskVideoUrl, {
      responseType: 'arraybuffer',
      timeout: 180000,
      proxy: false,
    });
    fs.writeFileSync(maskPath, Buffer.from(maskResp.data));

    report('compose', 82, '正在合成透明视频…');
    const result = await localResourceManager.composeMaskAlphaWebm(projectId, inputPath, maskPath);

    try {
      fs.unlinkSync(maskPath);
    } catch {
      // ignore
    }

    report('done', 100, '智能抠像完成');
    return result;
  } finally {
    if (shouldDelete) {
      try {
        fs.unlinkSync(inputPath);
      } catch {
        // ignore
      }
    }
  }
}
