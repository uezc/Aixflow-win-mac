/**
 * Video Generation Provider - 视频生成
 * 插件算力（RunningHub）OpenAPI v2 路径仅用于拼接后交给 FC 转发（不向该占位 host 发请求）。
 * Sora2 选「核心算力」时走 BLTCY（经 FC），其余插件模型经 FC 转发。
 */

import { BaseProvider } from '../BaseProvider.js';
import { AIExecuteParams } from '../types.js';
import {
  getBuiltInOSSConfigForMedia,
  OSS_MAX_IMAGE_UPLOAD_BYTES,
  OSS_TIMEOUT_MS,
  OSS_RETRY_COUNT,
  buildOssUploadObjectKey,
  rewriteOssPutUrlToPublic,
  isOurOssOrCdnObjectUrl,
  preferDirectOssUrlForThirdPartyImageRef,
  normalizeOssMediaUrlForGeneration,
  type MediaOssRegion,
} from '../../config/ossConfig.js';
import axios from 'axios';
import { randomUUID } from 'crypto';
import {
  rhPostChargeVideo,
  rhQueryPollVideo,
  formatRunningHubTaskError,
  rhPollFailureError,
  summarizeRhNodeInfoForLog,
} from '../../utils/runningHubFcHelpers.js';
import { tryRefundFcForwardCharge } from '../../utils/fcRefundCharge.js';
import {
  buildVideoBillingModelId,
  normalizeGrok3DurationSec,
  normalizeGrok3StableDurationSec,
  normalizeLtx23DurationSec,
  normalizeSeedanceDurationSec,
  normalizeGeminiOmniDurationSec,
  coerceSeedanceResolution,
} from '../../utils/videoBillingSku.js';
import { buildFcErrorPayload, isFcBalanceInsufficientError } from '../../utils/fcBalanceError.js';
import { getAliyunFcInitUserUrl } from '../../config/aliyunConfig.js';
import { fcForwardRequest } from '../../utils/fcForwardTask.js';
import { getCloudAiBlockReason, buildCloudAiBlockedPayload } from '../../utils/cloudAiGate.js';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { getProjectsBasePath } from '../../utils/projectFolderHelper.js';
import { resolveOriginalImageUrls } from '../utils/imageAssetResolver.js';
import { createAliOssClientForMedia, invalidateOssTimeSkewCache } from '../../utils/ossTimeSkew.js';
import { uploadMediaBufferViaFcProxy } from '../../services/ossFcProxyUpload.js';
import {
  getActiveMediaOssRegion,
  markMediaOssDirectUnreachable,
  markSessionFcProxyUpload,
  shouldPreferFcProxyUpload,
} from '../../services/ossUploadSession.js';
import {
  LTX23_HDR_MULTI_APP_ID,
  LTX23_HDR_STORYBOARD_NODES,
  ltx23HdrMultiDimensions,
  normalizeLtx23HdrStoryboardSlots,
  isLtx23HdrMultiRunnable,
  validateLtx23HdrMultiInputs,
} from '../../../common/ltx23HdrMulti.js';

const require = createRequire(import.meta.url);

/** 占位 URL：仅含 `/openapi/v2` 供 pathFromRunningHubUrl 截取；实际 HTTP 仅发往 FC */
const RUNNINGHUB_OPENAPI_V2_BASE = 'https://nexflow-fc-rh.stub/openapi/v2';

/** 万相2.6 Flash 图生视频支持的时长（秒） */
type Wan26FlashDuration = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | '11' | '12' | '13' | '14' | '15';

interface VideoInput {
  prompt: string;
  model?: 'sora-2' | 'sora-2-pro' | 'kling-v2.6-pro' | 'kling-video-o1' | 'kling-video-o1-i2v' | 'kling-video-o1-start-end' | 'kling-video-o1-ref' | 'wan-2.6' | 'wan-2.6-flash' | 'wan-animate' | 'hey-gem' | 'gemini-omni' | 'seedance-2.0-fast' | 'seedance-2.0-mini' | 'ltx-2.3-lipsync' | 'ltx-2.3-i2v' | 'ltx-2.3-t2v' | 'ltx-2.3-hdr-multi' | 'rhart-v3.1-fast' | 'rhart-v3.1-fast-se' | 'rhart-v3.1-pro' | 'rhart-v3.1-pro-se' | 'grok-3' | 'grok-3-stable' | 'rhart-v3.1-pro-official-i2v' | 'hailuo-02-t2v-standard' | 'hailuo-2.3-t2v-standard' | 'hailuo-02-i2v-standard' | 'hailuo-2.3-i2v-standard' | 'rh-video-start-end';
  aspect_ratio?: '16:9' | '9:16' | '1:1' | '2:3' | '3:2';
  hd?: boolean;
  duration?: '5' | '10' | '15' | '25';
  images?: string[]; // 图生视频参考图，支持 url / base64
  /** 可灵参考生视频o1：必填，参考视频 URL（需为可公网访问的 http(s)） */
  referenceVideoUrl?: string;
  /** 可灵参考生视频o1：是否保留参考视频原声 */
  keepOriginalSound?: boolean;
  notify_hook?: string;
  watermark?: boolean;
  private?: boolean;
  // kling 系列参数
  negativePrompt?: string;
  guidanceScale?: number;
  sound?: 'true' | 'false';
  // 万相2.6 文生/图生视频参数
  shotType?: 'single' | 'multi';
  resolutionWan26?: '720p' | '1080p';
  durationWan26Flash?: Wan26FlashDuration;
  enableAudio?: boolean;
  durationVeo31ProOfficial?: '4' | '6' | '8';
  generateAudioVeo31ProOfficial?: boolean;
  enablePromptExpansion?: boolean;
  // 全能视频V3.1-fast 文生视频（仅文生）
  resolutionRhartV31?: '720p' | '1080p' | '4k';
  /** Grok video3 图生视频（标准 rhart-video-g/image-to-video）：时长 6|10|15|30 秒 */
  durationGrok3?: string;
  resolutionGrok3?: '720p';
  /** Grok video3（稳定版）参考图生视频：时长 6|10 秒，固定 720p */
  // 海螺-02 文生视频标准：仅文生，时长 6|10 秒
  durationHailuo02?: '6' | '10';
  /** 海螺计费 SKU 用；API 未使用时可填 na / 720p / 1080p */
  resolutionHailuo?: 'na' | '720p' | '1080p' | '4k';
  // 可灵文生视频o1：仅文生，时长 5|10 秒，模式 std|pro
  durationKlingO1?: '5' | '10';
  modeKlingO1?: 'std' | 'pro';
  // ltx-2.3-lipsync 数字人对口型
  inputAudioUrl?: string;
  resolutionLtx23Lipsync?: '720' | '1280' | '1920'; // 标准720 | 高清1280 | 超清1920
  actionPrompt?: string;
  // ltx-2.3-i2v 图生视频：时长 5|10|15 秒，分辨率 720|1280|1920（标准/高清/超清），工作流默认保持参考图比例
  durationLtx23I2v?: '5' | '10' | '15';
  resolutionLtx23I2v?: '720' | '1280' | '1920';
  // ltx-2.3-t2v 文生视频：时长 5|10|15 秒，分辨率 720|1280|1920，比例 16:9|9:16 换算宽高
  durationLtx23T2v?: '5' | '10' | '15';
  resolutionLtx23T2v?: '720' | '1280' | '1920';
  /** LTX2.3 高动态（多图控制）：背景图 URL；images 为有序分镜图（1–4 张） */
  ltx23HdrBackgroundImage?: string;
  durationLtx23HdrMulti?: '5' | '10' | '15';
  resolutionLtx23HdrMulti?: '720' | '1280' | '1920';
  /** Sora2 算力渠道：plugin=插件算力(RunningHub)，core=核心算力(BLTCY) */
  sora2Channel?: 'plugin' | 'core';
  /** WanAnimate（角色替换）：分辨率档位 720P / 1080P（RH node 259） */
  resolutionWanAnimate?: '720p' | '1080p' | '480p' | '480' | '1280p' | '1280x720' | '1080x1920' | '1920x1080';
  /** WanAnimate：node 250 数值（工作流侧参数） */
  wanAnimateClipSec?: '5' | '8' | '10' | '15';
  /** Seedance 2.0 Fast 多模态：分辨率 720p|1080p，时长 5|10|15 秒 */
  resolutionSeedance?: '480p' | '720p' | '1080p' | '2k' | '4k';
  durationSeedance?: '5' | '10' | '15';
  /** Gemini Omni 图生视频：分辨率 720p|1080p|4k，时长 4|6|8|10 秒 */
  resolutionGeminiOmni?: '720p' | '1080p' | '4k';
  durationGeminiOmni?: '6' | '8' | '10';
}

export class VideoProvider extends BaseProvider {
  readonly modelId = 'video';

  /** 占位 host；BLTCY 请求仅经 FC，不向该域直连 */
  private readonly apiBaseUrl = 'https://nexflow-fc-bltcy.stub';

  /** 获取当前区域阿里云 OSS 配置（大陆北京桶 / 海外香港桶） */
  private getOSSConfig() {
    return getBuiltInOSSConfigForMedia(getActiveMediaOssRegion());
  }

  /** 是否为 OSS 请求时间与服务器偏差过大（本机系统时间不准） */
  private isOssTimeSkewError(err: unknown): boolean {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
    const errMsg = err instanceof Error ? err.message : String(err);
    return (
      code === 'RequestTimeTooSkewed' ||
      /RequestTimeTooSkewed|difference between the request time and the current time is too large/i.test(errMsg)
    );
  }

  /** 是否为可重试的网络错误（ETIMEDOUT、ECONNRESET 等） */
  private isRetryableOSSError(err: unknown): boolean {
    if (this.isOssTimeSkewError(err)) return true;
    const msg = err && typeof err === 'object' && 'code' in err ? String((err as { code?: string }).code) : '';
    const errMsg = err instanceof Error ? err.message : String(err);
    return (
      msg === 'ETIMEDOUT' ||
      msg === 'ECONNRESET' ||
      msg === 'ECONNREFUSED' ||
      msg === 'ENOTFOUND' ||
      msg === 'EAI_AGAIN' ||
      msg === 'ENETUNREACH' ||
      msg === 'EHOSTUNREACH' ||
      msg === 'EPIPE' ||
      /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|socket hang up|Client network socket disconnected|Failed to fetch|network error/i.test(
        errMsg,
      )
    );
  }

  /** 直连 OSS 失败后是否应尝试北京 FC 代传 */
  private shouldTryFcProxyAfterDirectFailure(buffer: Buffer, err: unknown): boolean {
    if (buffer.length > OSS_MAX_IMAGE_UPLOAD_BYTES) return false;
    if (String(err instanceof Error ? err.message : err).includes('请先登录')) return false;
    return true;
  }

  /** 优先 FC 代传或直连失败后 FC 兜底 */
  private async uploadBufferViaOssOrFcProxy(
    buffer: Buffer,
    mimeType: string,
    buildObjectName: () => string,
  ): Promise<string> {
    const mediaRegion = getActiveMediaOssRegion();
    const regionLabel = mediaRegion === 'cn' ? '北京' : '香港';
    const withinFcLimit = buffer.length <= OSS_MAX_IMAGE_UPLOAD_BYTES;
    const objectName = buildOssUploadObjectKey(buildObjectName());
    const toPublicUrl = (url: string) => normalizeOssMediaUrlForGeneration(url);

    if (shouldPreferFcProxyUpload() && withinFcLimit) {
      try {
        const url = await uploadMediaBufferViaFcProxy(buffer, mimeType, { objectKey: objectName, mediaRegion });
        console.log(`[OSS上传] 北京 FC 代传成功（${regionLabel}素材桶），公网 URL: ${url}`);
        return url;
      } catch (fcErr) {
        console.warn('[OSS上传] FC 代传失败，尝试直连 OSS…', fcErr instanceof Error ? fcErr.message : fcErr);
      }
    }

    try {
      const result = await this.ossPutWithRetry(objectName, buffer, { mime: mimeType }, mediaRegion);
      console.log(`[OSS上传] 直连${regionLabel}素材桶成功`);
      return toPublicUrl(result.url);
    } catch (error) {
      if (this.shouldTryFcProxyAfterDirectFailure(buffer, error)) {
        try {
          console.warn(`[OSS上传] 直连${regionLabel}失败，尝试北京 FC 代传…`);
          const url = await uploadMediaBufferViaFcProxy(buffer, mimeType, { objectKey: objectName, mediaRegion });
          markSessionFcProxyUpload(mediaRegion);
          if (this.isRetryableOSSError(error)) {
            markMediaOssDirectUnreachable('直连上传失败');
          }
          console.log(`[OSS上传] FC 代传成功，本会话后续将固定走 FC（${regionLabel}素材桶）: ${url}`);
          return url;
        } catch (fcErr) {
          console.error('[OSS上传] FC 代传亦失败:', fcErr);
        }
      }
      throw error;
    }
  }

  /** 带重试的 OSS 上传（应对连接不稳定、本机时间偏差） */
  private async ossPutWithRetry(
    objectName: string,
    buffer: Buffer,
    options: { mime: string },
    mediaRegion: MediaOssRegion,
  ): Promise<{ url: string }> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= OSS_RETRY_COUNT; attempt++) {
      try {
        const client = await createAliOssClientForMedia(mediaRegion);
        const result = await client.put(objectName, buffer, options);
        return result as { url: string };
      } catch (err) {
        lastError = err;
        if (this.isOssTimeSkewError(err)) invalidateOssTimeSkewCache();
        if (attempt < OSS_RETRY_COUNT && this.isRetryableOSSError(err)) {
          const delayMs = 2000;
          console.warn(`[OSS上传] 第 ${attempt}/${OSS_RETRY_COUNT} 次失败，${delayMs}ms 后重试:`, err instanceof Error ? err.message : err);
          await new Promise((r) => setTimeout(r, delayMs));
        } else {
          throw err;
        }
      }
    }
    throw lastError;
  }

  /**
   * 上传图片到阿里云 OSS
   * @param imageBuffer 图片 Buffer
   * @param mimeType 图片 MIME 类型
   * @returns 公网 URL
   */
  async uploadImageToOSS(imageBuffer: Buffer, mimeType: string = 'image/png'): Promise<string> {
    try {
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).slice(-5);
      const fileExt = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'png';
      console.log('[OSS上传] 开始上传图片…');
      const publicUrl = await this.uploadBufferViaOssOrFcProxy(
        imageBuffer,
        mimeType,
        () => `${timestamp}-${randomStr}.${fileExt}`,
      );
      console.log(`[OSS上传] 图片上传成功，公网 URL: ${publicUrl}`);
      return publicUrl;
    } catch (error: any) {
      console.error('[OSS上传] OSS上传失败:', error);
      throw this.formatOSSError(error);
    }
  }

  /** 将任意图片 URL/本地路径转为 RunningHub 可拉取的 OSS 源站直链（不用 CDN） */
  async processImageToOssUrl(imageUrl: string): Promise<string> {
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      if (isOurOssOrCdnObjectUrl(imageUrl)) return preferDirectOssUrlForThirdPartyImageRef(imageUrl);
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
      return preferDirectOssUrlForThirdPartyImageRef(
        await this.uploadImageToOSS(Buffer.from(response.data), response.headers['content-type'] || 'image/png')
      );
    }
    if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
      let filePath = imageUrl.startsWith('local-resource://')
        ? imageUrl.replace(/^local-resource:\/\//, '')
        : imageUrl.replace(/^file:\/\//, '');
      filePath = decodeURIComponent(filePath);
      if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.substring(1);
      const userDataPath = app.getPath('userData');
      const projectsBase = getProjectsBasePath();
      const normalized = path.normalize(filePath);
      if (!normalized.startsWith(path.normalize(userDataPath)) && !normalized.startsWith(path.normalize(projectsBase))) {
        throw new Error(`访问路径超出允许范围: ${filePath}`);
      }
      if (!fs.existsSync(normalized)) throw new Error('文件不存在: ' + filePath);
      const buf = fs.readFileSync(normalized);
      const ext = path.extname(normalized).toLowerCase();
      const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
      return preferDirectOssUrlForThirdPartyImageRef(await this.uploadImageToOSS(buf, mime));
    }
    if (imageUrl.startsWith('data:image/')) {
      const base64 = imageUrl.split(',')[1];
      if (!base64) throw new Error('Base64 Data URL 格式无效');
      const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
      const mime = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
      return preferDirectOssUrlForThirdPartyImageRef(await this.uploadImageToOSS(Buffer.from(base64, 'base64'), mime));
    }
    throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
  }

  /** 统一格式化 OSS 错误，凭证缺失时提示用户去设置页配置 */
  private formatOSSError(error: any): Error {
    const raw = error.message || error.code || '未知错误';
    const isCredentialMissing = /require\s+accessKeyId|accessKeySecret/i.test(raw);
    const hint = isCredentialMissing ? '。请前往「设置」配置阿里云 OSS（AccessKey ID 和 AccessKey Secret）' : '';
    const timeSkew =
      this.isOssTimeSkewError(error) || /difference between the request time and the current time is too large/i.test(String(raw))
        ? '。多为本机系统日期/时间不准：请在 Windows「设置 → 时间和语言」开启「自动设置时间」并选正确时区后重试'
        : '';
    return new Error(`OSS上传失败: ${raw}${hint}${timeSkew}`);
  }

  private resolveFfmpegPath(): string {
    const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    try {
      const resourcesPath = process.resourcesPath;
      if (resourcesPath) {
        const bundled = path.join(resourcesPath, 'ffmpeg', exeName);
        if (fs.existsSync(bundled)) return bundled;
      }
    } catch {
      // ignore
    }
    try {
      const mod = require('ffmpeg-static');
      const p = typeof mod === 'string' ? mod : mod?.default ?? mod?.path;
      if (p && typeof p === 'string' && fs.existsSync(p)) return p;
    } catch {
      // ignore
    }
    return 'ffmpeg';
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpegBin = this.resolveFfmpegPath();
      const child = spawn(ffmpegBin, args, { windowsHide: true, shell: false });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk || '');
      });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
      });
    });
  }

  private normalizeAndValidateLocalVideoPath(localVideoPath: string): string {
    let filePath: string;
    if (localVideoPath.startsWith('local-resource://')) {
      filePath = localVideoPath.replace(/^local-resource:\/\//, '');
      filePath = decodeURIComponent(filePath);
      if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.substring(1);
    } else if (localVideoPath.startsWith('file://')) {
      filePath = localVideoPath.replace(/^file:\/\//, '');
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.substring(1);
      filePath = decodeURIComponent(filePath);
    } else {
      filePath = localVideoPath;
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.substring(1);
    }
    const normalizedFilePath = path.normalize(filePath);
    const userDataPath = app.getPath('userData');
    const projectsBase = getProjectsBasePath();
    const allowed = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBase));
    if (!allowed) throw new Error(`访问路径超出允许范围: ${filePath}`);
    if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
    return normalizedFilePath;
  }

  private async transcodeVideoToWanAnimateSafeMp4(inputPath: string, workDir: string): Promise<string> {
    const outputPath = path.join(workDir, `wan-animate-safe-${Date.now()}-${Math.random().toString(36).slice(-5)}.mp4`);
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p,fps=30',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      outputPath,
    ];
    await this.runFfmpeg(args);
    return outputPath;
  }

  /**
   * 下载或读取本地视频 → ffmpeg 转 H.264 + yuv420p（与 RH Comfy VHS_LoadVideo / OpenCV 兼容）→ 上传 OSS。
   * WanAnimate 参考视频与视频去水印提交 RH 前共用。
   */
  private async prepareOpenCvFriendlyVideoRemoteUrl(videoRef: string): Promise<string> {
    const tmpRoot = path.join(app.getPath('temp'), 'nexflow-opencv-friendly-transcode');
    await fs.promises.mkdir(tmpRoot, { recursive: true });
    const workDir = await fs.promises.mkdtemp(path.join(tmpRoot, 'job-'));
    const toCleanup: string[] = [];
    try {
      let inputPath = '';
      if (videoRef.startsWith('http://') || videoRef.startsWith('https://')) {
        const response = await axios.get(videoRef, {
          responseType: 'arraybuffer',
          timeout: 180_000,
          maxContentLength: 500 * 1024 * 1024,
          validateStatus: (s) => s >= 200 && s < 300,
        });
        let ext = '.mp4';
        try {
          const u = new URL(videoRef);
          const name = path.basename(u.pathname || '');
          const hit = name.match(/\.(mp4|webm|mov|avi|mkv)$/i);
          if (hit) ext = `.${hit[1].toLowerCase()}`;
        } catch {
          // ignore
        }
        inputPath = path.join(workDir, `input${ext}`);
        await fs.promises.writeFile(inputPath, Buffer.from(response.data));
        toCleanup.push(inputPath);
      } else if (videoRef.startsWith('local-resource://') || videoRef.startsWith('file://') || path.isAbsolute(videoRef)) {
        inputPath = this.normalizeAndValidateLocalVideoPath(videoRef);
      } else {
        throw new Error('参考视频须为 http(s) 链接或本机画布视频（local-resource）');
      }

      console.log(`[Video] OpenCV 友好转码（WanAnimate/RH）: ${inputPath}`);
      const transcodedPath = await this.transcodeVideoToWanAnimateSafeMp4(inputPath, workDir);
      toCleanup.push(transcodedPath);
      const transcodedBuf = await fs.promises.readFile(transcodedPath);
      return this.uploadVideoToOSS(transcodedBuf, 'video/mp4');
    } finally {
      for (const p of toCleanup) {
        try { await fs.promises.unlink(p); } catch { /* ignore */ }
      }
      try { await fs.promises.rm(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  private prepareWanAnimateVideoRemoteUrl(videoRef: string): Promise<string> {
    return this.prepareOpenCvFriendlyVideoRemoteUrl(videoRef);
  }

  /** 视频去水印提交 RH 前：本地转码再上传 OSS，降低 VHS_LoadVideo / cv 解码失败率 */
  async prepareVideoForWatermarkRemovalRemoteUrl(videoUrl: string): Promise<string> {
    return this.prepareOpenCvFriendlyVideoRemoteUrl(videoUrl.trim());
  }

  /**
   * 上传视频到阿里云 OSS
   * @param videoBuffer 视频 Buffer
   * @param mimeType 视频 MIME 类型，默认为 video/mp4
   * @returns 公网 URL
   */
  async uploadVideoToOSS(videoBuffer: Buffer, mimeType: string = 'video/mp4'): Promise<string> {
    try {
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).slice(-5);
      let fileExt = 'mp4';
      if (mimeType.includes('webm')) fileExt = 'webm';
      else if (mimeType.includes('mov')) fileExt = 'mov';
      else if (mimeType.includes('avi')) fileExt = 'avi';
      else if (mimeType.includes('mkv')) fileExt = 'mkv';

      console.log(`[OSS上传] 开始上传视频… 大小: ${videoBuffer.length} bytes`);
      const publicUrl = await this.uploadBufferViaOssOrFcProxy(
        videoBuffer,
        mimeType,
        () => `${timestamp}-${randomStr}.${fileExt}`,
      );
      console.log(`[OSS上传] 视频上传成功，公网 URL: ${publicUrl}`);
      return publicUrl;
    } catch (error: any) {
      console.error('[OSS上传] 视频上传失败:', error);
      throw this.formatOSSError(error);
    }
  }

  /**
   * 上传音频到阿里云 OSS（用于 Index-TTS2 参考音等）
   * @param audioBuffer 音频 Buffer
   * @param mimeType 音频 MIME 类型，默认为 audio/mpeg
   * @returns 公网 URL
   */
  async uploadAudioToOSS(audioBuffer: Buffer, mimeType: string = 'audio/mpeg'): Promise<string> {
    try {
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).slice(-5);
      let fileExt = 'mp3';
      if (mimeType.includes('wav')) fileExt = 'wav';
      else if (mimeType.includes('ogg')) fileExt = 'ogg';
      else if (mimeType.includes('m4a')) fileExt = 'm4a';

      console.log(`[OSS上传] 开始上传音频… 大小: ${audioBuffer.length} bytes`);
      const publicUrl = await this.uploadBufferViaOssOrFcProxy(
        audioBuffer,
        mimeType,
        () => `${timestamp}-${randomStr}.${fileExt}`,
      );
      console.log(`[OSS上传] 音频上传成功，公网 URL: ${publicUrl}`);
      return publicUrl;
    } catch (error: any) {
      console.error('[OSS上传] 音频上传失败:', error);
      throw this.formatOSSError(error);
    }
  }

  /**
   * 上传 RVC 模型包（zip/pth 等）到 OSS，供 RH ai-app 以 URL 引用
   */
  async uploadModelPackageToOSS(buffer: Buffer, fileExt = 'zip'): Promise<string> {
    try {
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).slice(-5);
      const ext = (fileExt || 'zip').replace(/^\./, '').toLowerCase();
      let mimeType = 'application/zip';
      if (ext === 'pth' || ext === 'pt' || ext === 'ckpt') mimeType = 'application/octet-stream';
      else if (ext === 'index') mimeType = 'application/octet-stream';

      console.log(`[OSS上传] 开始上传 RVC 模型包… 大小: ${buffer.length} bytes, ext=${ext}`);
      const publicUrl = await this.uploadBufferViaOssOrFcProxy(
        buffer,
        mimeType,
        () => `${timestamp}-${randomStr}.${ext}`,
      );
      console.log(`[OSS上传] RVC 模型包上传成功，公网 URL: ${publicUrl}`);
      return publicUrl;
    } catch (error: any) {
      console.error('[OSS上传] RVC 模型包上传失败:', error);
      throw this.formatOSSError(error);
    }
  }

  /** 本地 RVC 模型包 → OSS 公网 URL */
  async uploadLocalModelPackageToOSS(localPathOrUrl: string): Promise<string> {
    let filePath = (localPathOrUrl || '').trim();
    if (filePath.startsWith('local-resource://')) {
      filePath = filePath.replace(/^local-resource:\/\/+/, '');
    } else if (filePath.startsWith('file://')) {
      filePath = filePath.replace(/^file:\/\/+/, '');
    }
    filePath = filePath.replace(/%5C/gi, '/');
    if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
    filePath = decodeURIComponent(filePath);
    if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
    const normalizedFilePath = path.normalize(filePath);
    if (!fs.existsSync(normalizedFilePath)) {
      throw new Error(`RVC 模型包文件不存在: ${normalizedFilePath}`);
    }
    const buffer = await fs.promises.readFile(normalizedFilePath);
    const ext = path.extname(normalizedFilePath).toLowerCase().replace(/^\./, '') || 'zip';
    return this.uploadModelPackageToOSS(buffer, ext);
  }

  /**
   * 上传本地视频文件到 OSS（用于角色创建模块）
   * @param localVideoPath 本地视频路径（如 C:/Users/... 或 local-resource://...）
   * @returns OSS 公网 URL
   */
  async uploadLocalVideoToOSS(localVideoPath: string): Promise<string> {
    try {
      const normalizedFilePath = this.normalizeAndValidateLocalVideoPath(localVideoPath);
      
      // 使用 fs.promises.readFile 异步读取文件
      const videoBuffer = await fs.promises.readFile(normalizedFilePath);
      
      // 根据文件扩展名确定 MIME 类型
      const ext = path.extname(normalizedFilePath).toLowerCase();
      let mimeType = 'video/mp4';
      if (ext === '.webm') {
        mimeType = 'video/webm';
      } else if (ext === '.mov') {
        mimeType = 'video/quicktime';
      } else if (ext === '.avi') {
        mimeType = 'video/x-msvideo';
      } else if (ext === '.mkv') {
        mimeType = 'video/x-matroska';
      }
      
      console.log(`[OSS上传] 读取本地视频文件: ${normalizedFilePath}，大小: ${videoBuffer.length} bytes`);
      
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).slice(-5);
      const fileExt = ext.substring(1) || 'mp4';
      const publicUrl = await this.uploadBufferViaOssOrFcProxy(
        videoBuffer,
        mimeType,
        () => `${timestamp}-${randomStr}.${fileExt}`,
      );
      console.log(`[OSS上传] 视频上传成功，公网 URL: ${publicUrl}`);
      return publicUrl;
    } catch (error: any) {
      console.error('[OSS上传] 本地视频上传失败:', error);
      throw this.formatOSSError(error);
    }
  }

  /**
   * 将远程视频 URL 下载后上传到 OSS（统一使用项目 OSS 存储，便于第三方 API 访问）
   * @param remoteVideoUrl 公网视频 URL（http/https）
   * @returns OSS 公网 URL
   */
  async uploadRemoteVideoToOSS(remoteVideoUrl: string): Promise<string> {
    try {
      const response = await axios.get(remoteVideoUrl, {
        responseType: 'arraybuffer',
        timeout: 120_000,
        maxContentLength: 500 * 1024 * 1024, // 500MB
        validateStatus: (s) => s >= 200 && s < 300,
      });
      const videoBuffer = Buffer.from(response.data);
      const ct = (response.headers['content-type'] as string) || '';
      let mimeType = 'video/mp4';
      if (ct.includes('webm')) mimeType = 'video/webm';
      else if (ct.includes('quicktime') || ct.includes('x-mov')) mimeType = 'video/quicktime';
      else if (ct.includes('x-msvideo')) mimeType = 'video/x-msvideo';
      else if (ct.includes('matroska')) mimeType = 'video/x-matroska';
      else if (ct.includes('mp4') || ct.includes('mpeg4')) mimeType = 'video/mp4';
      let fileExt = 'mp4';
      try {
        const u = new URL(remoteVideoUrl);
        const p = u.pathname.split('/').pop() || '';
        const m = p.match(/\.(mp4|webm|mov|avi|mkv)$/i);
        if (m) fileExt = m[1].toLowerCase();
      } catch (_) {}
      console.log(`[OSS上传] 远程视频下载完成: ${remoteVideoUrl}，大小: ${videoBuffer.length} bytes`);
      const timestamp = Date.now();
      const randomStr = Math.random().toString(36).slice(-5);
      const publicUrl = await this.uploadBufferViaOssOrFcProxy(
        videoBuffer,
        mimeType,
        () => `${timestamp}-${randomStr}.${fileExt}`,
      );
      console.log(`[OSS上传] 远程视频上传到 OSS 成功，公网 URL: ${publicUrl}`);
      return publicUrl;
    } catch (error: unknown) {
      console.error('[OSS上传] 远程视频上传失败:', error);
      throw this.formatOSSError(error);
    }
  }

  /**
   * 上传本地音频文件到 OSS（用于声音模块连接时，将参考音上传后回传 URL）
   * @param localAudioPath 本地路径（local-resource:// 或 file:// 或绝对路径）
   * @returns OSS 公网 URL
   */
  async uploadLocalAudioToOSS(localAudioPath: string): Promise<string> {
    let filePath = localAudioPath.trim();
    if (filePath.startsWith('local-resource://')) {
      filePath = filePath.replace(/^local-resource:\/\/+/, '').replace(/%5C/gi, '/');
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
      filePath = decodeURIComponent(filePath);
      if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
    } else if (filePath.startsWith('file://')) {
      filePath = filePath.replace(/^file:\/\/+/, '');
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
      filePath = decodeURIComponent(filePath);
    }
    const normalizedFilePath = path.normalize(filePath);
    if (!fs.existsSync(normalizedFilePath)) {
      throw new Error(`文件不存在: ${normalizedFilePath}`);
    }
    const stat = fs.statSync(normalizedFilePath);
    if (!stat.isFile()) {
      throw new Error(`路径不是文件: ${normalizedFilePath}`);
    }
    const audioBuffer = fs.readFileSync(normalizedFilePath);
    const ext = path.extname(normalizedFilePath).toLowerCase();
    const mimeType = ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
    console.log(`[OSS上传] 上传本地音频: ${normalizedFilePath}，大小: ${audioBuffer.length} bytes`);
    return this.uploadAudioToOSS(audioBuffer, mimeType);
  }

  /** 将完整 BLTCY URL 转为 FC forward 用的 path（含 query） */
  private bltcyForwardPath(apiEndpoint: string): string {
    const base = this.apiBaseUrl;
    if (apiEndpoint.startsWith(base)) {
      const rest = apiEndpoint.slice(base.length);
      return rest.startsWith('/') ? rest : `/${rest}`;
    }
    try {
      const u = new URL(apiEndpoint);
      return `${u.pathname}${u.search}`;
    } catch {
      return '/';
    }
  }

  /**
   * RunningHub /query 返回的 status 可能是 SUCCESS、succeed、complete 等，需统一后再判断，否则平台已出片但画布一直轮询。
   */
  private normalizeRunningHubPollStatus(raw: unknown): string | undefined {
    if (raw == null || raw === '') return undefined;
    const u = String(raw).trim().toUpperCase();
    if (u === 'SUCCESS' || u === 'SUCCEED' || u === 'COMPLETE' || u === 'COMPLETED') return 'SUCCESS';
    if (u === 'FAILED' || u === 'FAILURE') return 'FAILURE';
    if (u === 'RUNNING') return 'IN_PROGRESS';
    if (u === 'QUEUED') return 'NOT_START';
    return String(raw);
  }

  /** query 结果数组首项常见 url / fileUrl / videoUrl */
  private firstRhMediaUrlFromResultItem(item: unknown): string | undefined {
    if (!item || typeof item !== 'object') return undefined;
    const o = item as Record<string, unknown>;
    for (const k of ['url', 'fileUrl', 'videoUrl']) {
      const v = o[k];
      if (typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))) return v;
    }
    const nested = o.url;
    if (nested && typeof nested === 'object' && 'url' in nested && typeof (nested as { url?: string }).url === 'string') {
      return (nested as { url: string }).url;
    }
    return undefined;
  }

  /** SaaS：POST /tasks/create 预扣费，与 Workspace 轮询 /tasks/status 对齐 */
  private async ensureLedgerVideoTask(
    nodeId: string,
    billingModelId: string,
    videoInput: VideoInput,
    modelName: string,
  ): Promise<string | null> {
    try {
      if (!getAliyunFcInitUserUrl().trim()) return null;
      const { isNxSaasMode, isNxOfflineCloudSession, getNxAccessToken, nxCloudTasksCreate } = await import(
        '../../services/aliyunService.js'
      );
      if (!isNxSaasMode() || isNxOfflineCloudSession() || !getNxAccessToken()) return null;
      const r = await nxCloudTasksCreate({
        model_id: billingModelId,
        type: 'video',
        params: {
          nodeId,
          taskKind: 'video',
          model: modelName,
          prompt: String(videoInput.prompt || '').slice(0, 4000),
        },
        nodeData: { ...(videoInput as unknown as Record<string, unknown>) },
      });
      const { notifyNxCloudTaskTrack } = await import('../../nxCloudTaskTrackNotifier.js');
      notifyNxCloudTaskTrack({ taskId: r.task_id, nodeId, taskType: 'video', balance: r.balance });
      return r.task_id;
    } catch (e) {
      console.warn('[VideoProvider] /tasks/create 失败，回退为 run-task 内扣费', e);
      return null;
    }
  }

  async execute(params: AIExecuteParams): Promise<void> {
    const { nodeId, input, onStatus } = params;

    /** 插件算力经 FC 已成功扣费时记录，用于生成失败退回元宝（须在 try 外声明以便 catch 可访问） */
    let fcChargedTaskId: string | undefined;
    try {
      const videoInput = input as VideoInput;
      const {
        prompt,
        model = 'sora-2',
        aspect_ratio = '16:9',
        hd = false,
        duration = '10',
        images: rawImages,
        notify_hook,
        watermark,
        private: isPrivate,
        negativePrompt,
        guidanceScale,
        sound,
        shotType: inputShotType,
        resolutionWan26: inputResolutionWan26,
        durationWan26Flash,
        enableAudio: inputEnableAudio,
        durationVeo31ProOfficial,
        generateAudioVeo31ProOfficial,
        enablePromptExpansion: inputEnablePromptExpansion,
        resolutionRhartV31: inputResolutionRhartV31,
        durationHailuo02: inputDurationHailuo02,
        durationKlingO1: inputDurationKlingO1,
        modeKlingO1: inputModeKlingO1,
        inputAudioUrl,
        resolutionLtx23Lipsync: inputResolutionLtx23Lipsync = '720',
        actionPrompt: inputActionPrompt = '',
        durationLtx23I2v: inputDurationLtx23I2v = '10',
        resolutionLtx23I2v: inputResolutionLtx23I2v = '720',
        durationLtx23T2v: inputDurationLtx23T2v = '10',
        resolutionLtx23T2v: inputResolutionLtx23T2v = '720',
        ltx23HdrBackgroundImage: inputLtx23HdrBackgroundImage = '',
        durationLtx23HdrMulti: inputDurationLtx23HdrMulti = '15',
        resolutionLtx23HdrMulti: inputResolutionLtx23HdrMulti = '720',
        sora2Channel = 'plugin',
        referenceVideoUrl: inputReferenceVideoUrl = '',
        resolutionWanAnimate: inputResolutionWanAnimate = '720p',
        wanAnimateClipSec: inputWanAnimateClipSec = '8',
        durationGrok3: inputDurationGrok3 = '10',
        resolutionGrok3: inputResolutionGrok3 = '720p',
        resolutionSeedance: inputResolutionSeedance = '720p',
        durationSeedance: inputDurationSeedance = '10',
        resolutionGeminiOmni: inputResolutionGeminiOmni = '720p',
        durationGeminiOmni: inputDurationGeminiOmni = '6',
      } = videoInput;

      const images = resolveOriginalImageUrls(rawImages);

      const isWanAnimateModel = model === 'wan-animate';
      const isHeyGemModel = model === 'hey-gem';
      const isGeminiOmniModel = model === 'gemini-omni';
      const isSeedanceFastModel = model === 'seedance-2.0-fast';
      const isSeedanceMiniModel = model === 'seedance-2.0-mini';
      const isSeedanceModel = isSeedanceFastModel || isSeedanceMiniModel;
      if (!isWanAnimateModel && !isHeyGemModel && !(prompt || '').trim()) {
        throw new Error('提示词是必需的');
      }

      const isLtx23LipsyncModel = model === 'ltx-2.3-lipsync';
      const isLtx23HdrMultiModel = model === 'ltx-2.3-hdr-multi';

      const isImageToVideo =
        isLtx23HdrMultiModel
          ? isLtx23HdrMultiRunnable(String(inputLtx23HdrBackgroundImage || ''), rawImages || [])
          : Array.isArray(images) && images.length > 0;
      const isKlingModel = model === 'kling-v2.6-pro';
      const isSora2Model = model === 'sora-2';
      const isSora2ProModel = model === 'sora-2-pro';
      const isWan26Model = model === 'wan-2.6';
      const isWan26FlashModel = model === 'wan-2.6-flash';
      const isRhartV31FastModel = model === 'rhart-v3.1-fast';
      const isRhartV31FastSEModel = model === 'rhart-v3.1-fast-se';
      const isRhartV31ProModel = model === 'rhart-v3.1-pro';
      const isRhartV31ProSEModel = model === 'rhart-v3.1-pro-se';
      const isRhartV31ProOfficialI2vModel = model === 'rhart-v3.1-pro-official-i2v';
      const isGrok3Model = model === 'grok-3';
      const isGrok3StableModel = model === 'grok-3-stable';
      // 存量工程可能仍带 rhart-video-g（已从类型中移除）
      if (String(videoInput.model ?? '') === 'rhart-video-g') {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: 'Grok 1.5（全能视频 G）已下线，请在面板中选择 Grok video3（grok-3）。' },
        });
        return;
      }
      const retiredVideoModels = new Set([
        'kling-v2.6-pro',
        'kling-video-o1',
        'kling-video-o1-i2v',
        'kling-video-o1-start-end',
        'kling-video-o1-ref',
        'wan-2.6',
        'wan-2.6-flash',
        'hailuo-02-t2v-standard',
        'hailuo-2.3-t2v-standard',
        'hailuo-02-i2v-standard',
        'hailuo-2.3-i2v-standard',
      ]);
      if (retiredVideoModels.has(String(model))) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: {
            error: '该视频模型（可灵 / 万相 / 海螺）已从前端下架，请在面板中改用 Grok video3、Veo 3.1 或 LTX2.3 等模型。',
          },
        });
        return;
      }
      const isHailuo02Model = model === 'hailuo-02-t2v-standard';
      const isHailuo23Model = model === 'hailuo-2.3-t2v-standard';
      const isHailuo02I2vModel = model === 'hailuo-02-i2v-standard';
      const isHailuo23I2vModel = model === 'hailuo-2.3-i2v-standard';
      const isKlingVideoO1Model = model === 'kling-video-o1';
      const isKlingVideoO1I2vModel = model === 'kling-video-o1-i2v';
      const isKlingVideoO1StartEndModel = model === 'kling-video-o1-start-end';
      const isRhVideoStartEndModel = model === 'rh-video-start-end';
      const isKlingVideoO1RefModel = model === 'kling-video-o1-ref';
      /** RunningHub OpenAPI v2 POST /query 轮询（rhQueryPollVideo + unwrap） */
      const usesRhOpenApiV2QueryPoll =
        isKlingModel ||
        isKlingVideoO1Model ||
        isKlingVideoO1I2vModel ||
        isKlingVideoO1StartEndModel ||
        isSora2Model ||
        isSora2ProModel ||
        isRhartV31ProOfficialI2vModel ||
        isWan26Model ||
        isWan26FlashModel ||
        isRhartV31FastModel ||
        isRhartV31FastSEModel ||
        isRhartV31ProModel ||
        isRhartV31ProSEModel ||
        isGrok3Model ||
        isGrok3StableModel ||
        isSeedanceModel ||
        isHailuo02Model ||
        isHailuo23Model ||
        isHailuo02I2vModel ||
        isHailuo23I2vModel;

      const isSora2Core = (isSora2Model || isSora2ProModel) && sora2Channel === 'core';
      // LTX2.3（对口型 / 图生 / 文生）仅经 FC + RunningHub ai-app，不依赖本机核心算力 BLTCY Key
      const usesFcRunningHub =
        !isSora2Core &&
        (isLtx23LipsyncModel ||
          model === 'ltx-2.3-i2v' ||
          model === 'ltx-2.3-t2v' ||
          isLtx23HdrMultiModel ||
          isWanAnimateModel ||
          isHeyGemModel ||
          isSeedanceModel ||
          isKlingModel ||
          isKlingVideoO1Model ||
          isKlingVideoO1I2vModel ||
          isKlingVideoO1StartEndModel ||
          isRhVideoStartEndModel ||
          isSora2Model ||
          isSora2ProModel ||
          isRhartV31ProOfficialI2vModel ||
          isWan26Model ||
          isWan26FlashModel ||
          isRhartV31FastModel ||
          isRhartV31FastSEModel ||
          isRhartV31ProModel ||
          isRhartV31ProSEModel ||
          isGrok3Model ||
          isGrok3StableModel ||
          isHailuo02Model ||
          isHailuo23Model ||
          isHailuo02I2vModel ||
          isHailuo23I2vModel);

      // 可灵O1 (参考) 已下线，不再支持
      if (isKlingVideoO1RefModel) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵O1 (参考) 模型已下线，请切换为其他模型（如可灵O1）。' },
        });
        return;
      }

      if (String(model) === 'rhart-video-s-i2v-pro') {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '「Sora2 Pro 图生视频」已下线，请在视频节点中切换为其他图生模型。' },
        });
        return;
      }

      // WanAnimate（角色替换）：1 张图 + 参考视频
      if (isWanAnimateModel) {
        if (!Array.isArray(images) || images.length < 1) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'WanAnimate（角色替换）需接入 1 张角色参考图。' },
          });
          return;
        }
        if (!String(inputReferenceVideoUrl || '').trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'WanAnimate（角色替换）需连接参考视频节点。' },
          });
          return;
        }
      }

      // HeyGem 数字人：参考视频 + 驱动音频
      if (isHeyGemModel) {
        if (!String(inputReferenceVideoUrl || '').trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'HeyGem 数字人需连接参考视频节点。' },
          });
          return;
        }
        if (!inputAudioUrl || !inputAudioUrl.trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'HeyGem 数字人需连接音频节点。' },
          });
          return;
        }
      }

      // LTX2.3 数字人对口型：需要 1 张图 + 1 段音频 + 动作提示词
      if (isLtx23LipsyncModel) {
        if (!Array.isArray(images) || images.length < 1) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'LTX2.3 对口型需接入 1 张参考图。' },
          });
          return;
        }
        if (!inputAudioUrl || !inputAudioUrl.trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'LTX2.3 对口型需连接音频节点。' },
          });
          return;
        }
      }

      // LTX2.3 图生视频：仅支持图生视频，1 张图
      const isLtx23I2vModel = model === 'ltx-2.3-i2v';
      if (isLtx23HdrMultiModel) {
        const hdrValidation = validateLtx23HdrMultiInputs(
          String(inputLtx23HdrBackgroundImage || ''),
          images || [],
        );
        if (!hdrValidation.ok) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: hdrValidation.error },
          });
          return;
        }
      }
      if (isLtx23I2vModel) {
        if (!isImageToVideo) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'LTX2.3 图生视频仅支持图生视频，请接入 1 张参考图。' },
          });
          return;
        }
        if (images!.length !== 1) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'LTX2.3 图生视频仅支持 1 张参考图，当前提供了 ' + images!.length + ' 张。' },
          });
          return;
        }
      }

      // Veo 3.1 Pro（官方图生）：仅支持图生，且仅 1 张图
      if (isRhartV31ProOfficialI2vModel) {
        if (!isImageToVideo) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'Veo 3.1 Pro（图生）仅支持图生视频，请接入 1 张参考图。' },
          });
          return;
        }
        if (images!.length !== 1) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'Veo 3.1 Pro（图生）仅支持 1 张参考图，当前提供了 ' + images!.length + ' 张。' },
          });
          return;
        }
      }

      // 可灵文生视频o1：仅支持文生视频
      if (isKlingVideoO1Model && isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵文生视频o1 仅支持文生视频，请勿传入参考图。' },
        });
        return;
      }

      // 可灵图生视频o1：仅支持图生视频，仅 1 张图
      if (isKlingVideoO1I2vModel && !isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵图生视频o1 仅支持图生视频，请接入 1 张参考图。' },
        });
        return;
      }
      if (isKlingVideoO1I2vModel && isImageToVideo && images!.length !== 1) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵图生视频o1 仅支持 1 张参考图，当前提供了 ' + images!.length + ' 张。' },
        });
        return;
      }

      // 可灵首尾帧生视频o1：仅支持首尾帧，恰好 2 张图
      if (isKlingVideoO1StartEndModel && !isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵首尾帧生视频o1 需要首帧+尾帧共 2 张参考图。' },
        });
        return;
      }
      if (isKlingVideoO1StartEndModel && isImageToVideo && images!.length !== 2) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '可灵首尾帧生视频o1 需要恰好 2 张参考图（首帧、尾帧），当前提供了 ' + images!.length + ' 张。' },
        });
        return;
      }
      // LTX2.3（首位帧）：仅支持首尾帧，恰好 2 张图
      if (isRhVideoStartEndModel && !isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: 'LTX2.3（首位帧）需要首帧+尾帧共 2 张参考图。' },
        });
        return;
      }
      if (isRhVideoStartEndModel && isImageToVideo && images!.length !== 2) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: 'LTX2.3（首位帧）需要恰好 2 张参考图（首帧、尾帧），当前提供了 ' + images!.length + ' 张。' },
        });
        return;
      }

      // 海螺-02 / 海螺-2.3 文生视频标准：仅支持文生视频
      if ((isHailuo02Model || isHailuo23Model) && isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '海螺文生视频标准 仅支持文生视频，请勿传入参考图。' },
        });
        return;
      }

      // 海螺-02 图生视频标准：仅支持图生视频，1 或 2 张图（2 张为首尾帧）
      if (isHailuo02I2vModel && !isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '海螺-02-图生视频-标准 仅支持图生视频，请接入 1 或 2 张参考图。' },
        });
        return;
      }
      if (isHailuo02I2vModel && isImageToVideo && (images!.length < 1 || images!.length > 2)) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '海螺-02-图生视频-标准 支持 1 张图（首帧）或 2 张图（首帧+尾帧），当前提供了 ' + images!.length + ' 张。' },
        });
        return;
      }

      // 海螺-2.3 图生视频标准：仅支持图生视频，仅 1 张图
      if (isHailuo23I2vModel && !isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '海螺-2.3-图生视频-标准 仅支持图生视频，请接入 1 张参考图。' },
        });
        return;
      }
      if (isHailuo23I2vModel && isImageToVideo && images!.length !== 1) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '海螺-2.3-图生视频-标准 仅支持 1 张参考图，当前提供了 ' + images!.length + ' 张。' },
        });
        return;
      }

      // 全能视频V3.1-fast / V3.1-pro 首尾帧生视频仅支持恰好 2 张图片（首帧+尾帧）
      if ((isRhartV31FastSEModel || isRhartV31ProSEModel) && isImageToVideo) {
        if (images!.length !== 2) {
          const name = isRhartV31ProSEModel ? '全能视频V3.1-pro' : '全能视频V3.1-fast';
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: `${name} 首尾帧生视频需要恰好 2 张图片（首帧、尾帧），当前提供了 ${images!.length} 张。` },
          });
          return;
        }
      }

      // 全能视频V3.1-pro 仅支持文生视频（不含首尾帧时）
      if (isRhartV31ProModel && isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '全能视频V3.1-pro 仅支持文生视频，请勿传入参考图。' },
        });
        return;
      }

      // 全能视频V3.1-fast 图生视频支持 1–3 张图片
      if (isRhartV31FastModel && isImageToVideo) {
        if (images!.length < 1 || images!.length > 3) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '全能视频V3.1-fast 图生视频支持 1–3 张图片，当前提供了 ' + images!.length + ' 张。' },
          });
          return;
        }
      }

      // 万相2.6 / 万相2.6 Flash 图生视频只支持 1 张图片
      if ((isWan26Model || isWan26FlashModel) && isImageToVideo) {
        if (images!.length !== 1) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: `${isWan26FlashModel ? '万相2.6 Flash' : '万相2.6'} 图生视频只支持 1 张图片，当前提供了 ${images!.length} 张。` },
          });
          return;
        }
      }

      // 万相2.6 Flash 仅支持图生视频
      if (isWan26FlashModel && !isImageToVideo) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: '万相2.6 Flash 仅支持图生视频，请接入 1 张参考图。' },
        });
        return;
      }

      // Grok video3：文生（无参考图）或图生 1–7 张（标准 API rhart-video-g）
      if (isGrok3Model && isImageToVideo) {
        const g3n = images!.length;
        if (g3n < 1 || g3n > 7) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: `Grok video3 图生视频需 1–7 张参考图，当前 ${g3n} 张。` },
          });
          return;
        }
      }

      // Grok video3（稳定版）：仅参考图生视频 1–7 张（rhart-video-g-official/reference-to-video）
      if (isGrok3StableModel) {
        if (!isImageToVideo) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'Grok video3 plus 需连接 1–7 张参考图，不支持纯文生。' },
          });
          return;
        }
        const g3sn = images!.length;
        if (g3sn < 1 || g3sn > 7) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: `Grok video3 plus 需 1–7 张参考图，当前 ${g3sn} 张。` },
          });
          return;
        }
      }

      const cloudBlock = getCloudAiBlockReason();
      if (cloudBlock) {
        onStatus({ nodeId, status: 'ERROR', payload: buildCloudAiBlockedPayload() });
        return;
      }
      if (usesFcRunningHub) {
        if (!getAliyunFcInitUserUrl().trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: {
              error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法使用插件算力视频生成',
            },
          });
          return;
        }
      }

      // kling-v2.6-pro 图生视频只支持 1 张图片
      if (isKlingModel && isImageToVideo) {
        const imageCount = images!.length;
        if (imageCount !== 1) {
          const errorMessage = `kling-v2.6-pro 图生视频模式只支持 1 张图片，当前提供了 ${imageCount} 张`;
          console.error(`[视频生成] ${errorMessage}`);
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: {
              error: errorMessage,
            },
          });
          return;
        }
      }

      // 图生视频模型验证：根据 API 文档，只有特定模型支持图生视频
      if (isImageToVideo) {
        const imageCount = images!.length;
        
        // 支持首尾帧的模型（已移除 VEO，当前无）
        const supportedFirstLastFrameModels: string[] = ['rhart-v3.1-fast-se', 'rhart-v3.1-pro-se', 'rh-video-start-end'];

        // 所有图生视频支持的模型（sora/sora2 pro/kling/万相仅 1 张，全能V3.1-fast 支持 1–3 张，首尾帧仅 2 张）
        const supportedImageToVideoModels = [
          'sora-2',
          'kling-v2.6-pro',
          'wan-2.6',
          'wan-2.6-flash',
          'wan-animate',
          'gemini-omni',
          'seedance-2.0-fast',
          'seedance-2.0-mini',
          'ltx-2.3-lipsync',
          'ltx-2.3-i2v', // LTX2.3 图生视频，仅 1 张
          'ltx-2.3-hdr-multi', // LTX2.3 高动态：背景 + 1–4 分镜
          'rhart-v3.1-fast',
          'rhart-v3.1-fast-se',
          'rhart-v3.1-pro-se',
          'grok-3',
          'grok-3-stable',
          'hailuo-02-i2v-standard',
          'hailuo-2.3-i2v-standard',
          'kling-video-o1-i2v',
          'rhart-v3.1-pro-official-i2v',
          'rh-video-start-end',
        ];

        if (isSeedanceModel && imageCount > 9) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'Seedance 最多支持 9 张参考图，当前提供了 ' + imageCount + ' 张。' },
          });
          return;
        }

        if (isSeedanceFastModel && String(inputReferenceVideoUrl || '').trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'Seedance 2.0 Fast 不支持参考视频，请断开视频连线或改用 WanAnimate / 其他模型。' },
          });
          return;
        }

        if (isGeminiOmniModel) {
          const geminiImageCount = images.filter((img) => String(img || '').trim()).length;
          if (geminiImageCount < 1 || geminiImageCount > 3) {
            onStatus({
              nodeId,
              status: 'ERROR',
              payload: { error: `Gemini Omni 需要 1–3 张参考图，当前提供了 ${geminiImageCount} 张。` },
            });
            return;
          }
          if (String(inputReferenceVideoUrl || '').trim()) {
            onStatus({
              nodeId,
              status: 'ERROR',
              payload: { error: 'Gemini Omni 不支持参考视频，请断开视频连线或改用其他模型。' },
            });
            return;
          }
        }

        // sora-2 / 万相2.6 / 万相2.6 Flash / 海螺-2.3 图生 / 可灵图生o1 只支持 1 张图片
        if ((isSora2Model || isRhartV31ProOfficialI2vModel || isWan26Model || isWan26FlashModel || isWanAnimateModel || isHailuo23I2vModel || isKlingVideoO1I2vModel || isLtx23LipsyncModel || isLtx23I2vModel) && imageCount > 1) {
          const name = isWanAnimateModel ? 'WanAnimate（角色替换）' : isRhartV31ProOfficialI2vModel ? 'Veo 3.1 Pro（图生）' : isKlingVideoO1I2vModel ? '可灵图生视频o1' : isHailuo23I2vModel ? '海螺-2.3-图生视频-标准' : isWan26FlashModel ? '万相2.6 Flash' : isWan26Model ? '万相2.6' : isLtx23I2vModel ? 'LTX2.3 图生视频' : 'sora-2';
          const errorMessage = `${name} 图生视频模式最多支持 1 张图片，当前提供了 ${imageCount} 张`;
          console.error(`[视频生成] ${errorMessage}`);
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: {
              error: errorMessage,
            },
          });
          return;
        }
        
        // 根据图片数量验证模型：2 张图时可选首尾帧(fast-se/pro-se)或图生；Seedance 支持 1–9 张多参考图，不走此分支
        if (imageCount === 2 && !isSeedanceModel) {
          const allowedForTwo =
            supportedFirstLastFrameModels.includes(model) ||
            model === 'rhart-v3.1-fast' ||
            model === 'hailuo-02-i2v-standard' ||
            model === 'kling-video-o1-start-end' ||
            model === 'rh-video-start-end' ||
            model === 'grok-3' ||
            model === 'grok-3-stable' ||
            model === 'gemini-omni';
          if (!allowedForTwo) {
            onStatus({
              nodeId,
              status: 'ERROR',
              payload: {
                error: '2 张参考图时请选择支持首尾帧或多参考图的模型（如 Seedance 2.0 Mini、Grok video3、全能视频V3.1-fast 等）。',
              },
            });
            return;
          }
        } else if (imageCount !== 2 || !isSeedanceModel) {
          if (!supportedImageToVideoModels.includes(model)) {
            onStatus({
              nodeId,
              status: 'ERROR',
              payload: {
                error: `模型 ${model} 不支持图生视频。支持的模型：${supportedImageToVideoModels.join(', ')}`,
              },
            });
            return;
          }
        }
      }

      // LTX2.3 数字人对口型：RunningHub ai-app API（经 FC）
      if (isLtx23LipsyncModel) {
        if (!getAliyunFcInitUserUrl().trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法使用插件算力视频生成' },
          });
          return;
        }
        const LTX23_LIPSYNC_APP_ID = '2029400959335534594';
        const RUN_BASE = RUNNINGHUB_OPENAPI_V2_BASE;
        const POLL_INTERVAL_MS = 5 * 1000;
        const POLL_DEADLINE_MS = 60 * 60 * 1000; // 60 分钟（对口型视频可能较长）

        const imageUrl = images![0];
        let imageUrlRemote = imageUrl;
        let audioUrlRemote = inputAudioUrl!.trim();

        const ensureAudioRemote = async (url: string): Promise<string> => {
          if (url.startsWith('http://') || url.startsWith('https://')) {
            if (isOurOssOrCdnObjectUrl(url)) {
              console.log('[LTX2.3 对口型] 音频已是 OSS 地址，直接使用:', url.length > 80 ? url.slice(0, 80) + '...' : url);
              return preferDirectOssUrlForThirdPartyImageRef(url);
            }
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000, proxy: false });
            const ct = res.headers['content-type'] || '';
            const mimeType = ct.includes('wav') ? 'audio/wav' : ct.includes('ogg') ? 'audio/ogg' : ct.includes('m4a') ? 'audio/mp4' : 'audio/mpeg';
            return this.uploadAudioToOSS(Buffer.from(res.data), mimeType);
          }
          if (url.startsWith('local-resource://') || url.startsWith('file://')) {
            return this.uploadLocalAudioToOSS(url);
          }
          if (url.startsWith('data:audio/')) {
            const m = url.match(/^data:audio\/(\w+);base64,(.+)$/);
            const buf = Buffer.from(m ? m[2] : '', 'base64');
            const mime = m ? `audio/${m[1]}` : 'audio/mpeg';
            return this.uploadAudioToOSS(buf, mime);
          }
          return url;
        };

        let ltxFcChargedId: string | undefined;
        try {
          onStatus({ nodeId, status: 'START', payload: {} });
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 5, text: '正在上传图片和音频到 OSS...' } });
          imageUrlRemote = await this.processImageToOssUrl(imageUrl);
          audioUrlRemote = await ensureAudioRemote(audioUrlRemote);
          console.log('[LTX2.3 对口型] 图片与音频已就绪，OSS 素材 URL 已回传（区域桶: 大陆北京 / 海外香港）');
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 15, text: '提交任务中...' } });

          const runPayload = {
            nodeInfoList: [
              { nodeId: '50', fieldName: 'image', fieldValue: imageUrlRemote },
              { nodeId: '37', fieldName: 'audio', fieldValue: audioUrlRemote },
              { nodeId: '54', fieldName: 'value', fieldValue: (inputActionPrompt || prompt || '').trim() || '正在讲解，有一些手势动作' },
              { nodeId: '187', fieldName: 'value', fieldValue: String(inputResolutionLtx23Lipsync || '720') },
            ],
            instanceType: 'plus', // LTX2.3 对口型：48G 显存，效果更佳
            usePersonalQueue: 'false',
          };

          const ltxFcId = randomUUID();
          const runRes = await rhPostChargeVideo(
            `${RUN_BASE}/run/ai-app/${LTX23_LIPSYNC_APP_ID}`,
            runPayload as Record<string, unknown>,
            ltxFcId,
            {
              billingModelId: buildVideoBillingModelId('ltx-2.3-lipsync', input as Record<string, unknown>),
            },
          );
          ltxFcChargedId = ltxFcId;

          const body = runRes ?? {};
          const taskId = body.taskId ?? body.task_id;
          if (!taskId) {
            throw new Error(`提交失败：${formatRunningHubTaskError(body, '未返回 taskId')}`);
          }

          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: { progress: 15, text: '任务已提交，生成中…', taskId: String(taskId) },
          });

          const deadline = Date.now() + POLL_DEADLINE_MS;
          let lastProgress = 15;
          let ltxPollRound = 0;

          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            lastProgress = Math.min(95, lastProgress + 5);
            onStatus({
              nodeId,
              status: 'PROCESSING',
              payload: { progress: lastProgress, text: '生成中...', taskId: String(taskId) },
            });

            ltxPollRound += 1;
            const queryRes = await rhQueryPollVideo(String(taskId), `${ltxFcId}:poll:${ltxPollRound}`);

            const status = queryRes.status;
            if (status === 'SUCCESS') {
              const results = queryRes.results as Array<{ url?: unknown }> | undefined;
              if (results && Array.isArray(results) && results.length > 0) {
                const first = results[0];
                const url = typeof first?.url === 'string' ? first.url : (first?.url as { url?: string })?.url ?? (first?.url as { href?: string })?.href;
                if (url) {
                  onStatus({
                    nodeId,
                    status: 'SUCCESS',
                    payload: { url, videoUrl: url, originalVideoUrl: url },
                  });
                  return;
                }
              }
              throw new Error('生成成功但未返回视频 URL');
            }
            if (status === 'FAILED' || status === 'FAILURE') {
              throw rhPollFailureError('LTX2.3 对口型', queryRes, String(taskId));
            }
          }
          throw new Error('生成超时');
        } catch (err: unknown) {
          void tryRefundFcForwardCharge(ltxFcChargedId, 'video', 'ltx_23_lipsync_failed');
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: buildFcErrorPayload(err, err instanceof Error ? err.message : 'LTX2.3 对口型生成失败'),
          });
        }
        return;
      }

      // LTX2.3 图生视频：RunningHub ai-app API，instanceType plus (48G 显存)（经 FC）
      if (isLtx23I2vModel) {
        if (!getAliyunFcInitUserUrl().trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法使用插件算力视频生成' },
          });
          return;
        }
        const LTX23_I2V_APP_ID = '2034955204851933186';
        const RUN_BASE = RUNNINGHUB_OPENAPI_V2_BASE;
        const POLL_INTERVAL_MS = 5 * 1000;
        const POLL_DEADLINE_MS = 60 * 60 * 1000;

        const imageUrl = images![0];

        let ltxFcChargedIdI2v: string | undefined;
        try {
          onStatus({ nodeId, status: 'START', payload: {} });
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 5, text: '正在上传图片到 OSS...' } });
          const imageUrlRemote = await this.processImageToOssUrl(imageUrl);
          console.log(
            `[LTX2.3 图生视频] 参考图已转为 OSS 源站直链: ${imageUrlRemote.length > 96 ? imageUrlRemote.slice(0, 96) + '...' : imageUrlRemote}`,
          );
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 15, text: '提交任务中...' } });

          // 工作流默认保持参考图比例，仅传分辨率档位 720|1280|1920
          const resRaw = (inputResolutionLtx23I2v || '720') as string; // 兼容旧数据 1080
          const res = resRaw === '1080' ? '1920' : (resRaw as '720' | '1280' | '1920');

          const nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string }> = [
            { nodeId: '584', fieldName: 'image', fieldValue: imageUrlRemote },
            { nodeId: '593', fieldName: 'value', fieldValue: String(normalizeLtx23DurationSec(inputDurationLtx23I2v, 10)) },
            { nodeId: '595', fieldName: 'value', fieldValue: String(res) },
            { nodeId: '602', fieldName: 'positive', fieldValue: (prompt || '').trim() || '视频动画' },
          ];

          const runPayload = {
            nodeInfoList,
            instanceType: 'plus', // 48G 显存
            usePersonalQueue: 'false',
          };

          const ltxFcId = randomUUID();
          const runRes = await rhPostChargeVideo(
            `${RUN_BASE}/run/ai-app/${LTX23_I2V_APP_ID}`,
            runPayload as Record<string, unknown>,
            ltxFcId,
            {
              billingModelId: buildVideoBillingModelId('ltx-2.3-i2v', input as Record<string, unknown>),
            },
          );
          ltxFcChargedIdI2v = ltxFcId;

          const body = runRes ?? {};
          const taskId = body.taskId ?? body.task_id;
          if (!taskId) {
            throw new Error(`提交失败：${formatRunningHubTaskError(body, '未返回 taskId')}`);
          }

          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: { progress: 15, text: '任务已提交，生成中…', taskId: String(taskId) },
          });

          const deadline = Date.now() + POLL_DEADLINE_MS;
          let lastProgress = 15;
          let ltxPollRound = 0;

          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            lastProgress = Math.min(95, lastProgress + 5);
            onStatus({
              nodeId,
              status: 'PROCESSING',
              payload: { progress: lastProgress, text: '生成中...', taskId: String(taskId) },
            });

            ltxPollRound += 1;
            const queryRes = await rhQueryPollVideo(String(taskId), `${ltxFcId}:poll:${ltxPollRound}`);

            const status = queryRes.status;
            if (status === 'SUCCESS') {
              const results = queryRes.results as Array<{ url?: unknown }> | undefined;
              if (results && Array.isArray(results) && results.length > 0) {
                const first = results[0];
                const url = typeof first?.url === 'string' ? first.url : (first?.url as { url?: string })?.url ?? (first?.url as { href?: string })?.href;
                if (url) {
                  onStatus({
                    nodeId,
                    status: 'SUCCESS',
                    payload: { url, videoUrl: url, originalVideoUrl: url },
                  });
                  return;
                }
              }
              throw new Error('生成成功但未返回视频 URL');
            }
            if (status === 'FAILED' || status === 'FAILURE') {
              throw rhPollFailureError('LTX2.3 图生视频', queryRes, String(taskId));
            }
          }
          throw new Error('生成超时');
        } catch (err: unknown) {
          void tryRefundFcForwardCharge(ltxFcChargedIdI2v, 'video', 'ltx_23_i2v_failed');
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: buildFcErrorPayload(err, err instanceof Error ? err.message : 'LTX2.3 图生视频生成失败'),
          });
        }
        return;
      }

      // LTX2.3 文生视频：RunningHub ai-app API，instanceType plus (48G 显存)，仅文生无需参考图
      const isLtx23T2vModel = model === 'ltx-2.3-t2v';
      if (isLtx23T2vModel) {
        if (!getAliyunFcInitUserUrl().trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法使用插件算力视频生成' },
          });
          return;
        }
        const LTX23_T2V_APP_ID = '2034994243982336001';
        const RUN_BASE = RUNNINGHUB_OPENAPI_V2_BASE;
        const POLL_INTERVAL_MS = 5 * 1000;
        const POLL_DEADLINE_MS = 60 * 60 * 1000;

        let ltxFcChargedIdT2v: string | undefined;
        try {
          onStatus({ nodeId, status: 'START', payload: {} });
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 10, text: '提交任务中...' } });

          const resRaw = (inputResolutionLtx23T2v || '720') as string;
          const res = resRaw === '1080' ? '1920' : (resRaw as '720' | '1280' | '1920');
          const ratio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
          const wh = (() => {
            if (res === '720') return ratio === '16:9' ? { w: 1280, h: 720 } : { w: 720, h: 1280 };
            if (res === '1280') return ratio === '16:9' ? { w: 1280, h: 720 } : { w: 720, h: 1280 };
            return ratio === '16:9' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
          })();

          const nodeInfoList = [
            { nodeId: '43', fieldName: 'value', fieldValue: String(wh.w) },
            { nodeId: '44', fieldName: 'value', fieldValue: String(wh.h) },
            { nodeId: '74', fieldName: 'value', fieldValue: String(normalizeLtx23DurationSec(inputDurationLtx23T2v, 10)) },
            { nodeId: '73', fieldName: 'text', fieldValue: (prompt || '').trim() || '视频动画' },
          ];

          const ltxFcId = randomUUID();
          const runRes = await rhPostChargeVideo(
            `${RUN_BASE}/run/ai-app/${LTX23_T2V_APP_ID}`,
            { nodeInfoList, instanceType: 'plus', usePersonalQueue: 'false' } as Record<string, unknown>,
            ltxFcId,
            {
              billingModelId: buildVideoBillingModelId('ltx-2.3-t2v', input as Record<string, unknown>),
            },
          );
          ltxFcChargedIdT2v = ltxFcId;

          const body = runRes ?? {};
          const taskId = body.taskId ?? body.task_id;
          if (!taskId) {
            throw new Error(`提交失败：${formatRunningHubTaskError(body, '未返回 taskId')}`);
          }

          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: { progress: 15, text: '任务已提交，生成中…', taskId: String(taskId) },
          });

          const deadline = Date.now() + POLL_DEADLINE_MS;
          let lastProgress = 15;
          let ltxPollRound = 0;

          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            lastProgress = Math.min(95, lastProgress + 5);
            onStatus({
              nodeId,
              status: 'PROCESSING',
              payload: { progress: lastProgress, text: '生成中...', taskId: String(taskId) },
            });

            ltxPollRound += 1;
            const queryRes = await rhQueryPollVideo(String(taskId), `${ltxFcId}:poll:${ltxPollRound}`);

            const status = queryRes.status;
            if (status === 'SUCCESS') {
              const results = queryRes.results as Array<{ url?: unknown }> | undefined;
              if (results && Array.isArray(results) && results.length > 0) {
                const first = results[0];
                const url = typeof first?.url === 'string' ? first.url : (first?.url as { url?: string })?.url ?? (first?.url as { href?: string })?.href;
                if (url) {
                  onStatus({ nodeId, status: 'SUCCESS', payload: { url, videoUrl: url, originalVideoUrl: url } });
                  return;
                }
              }
              throw new Error('生成成功但未返回视频 URL');
            }
            if (status === 'FAILED' || status === 'FAILURE') {
              throw rhPollFailureError('LTX2.3 文生视频', queryRes, String(taskId));
            }
          }
          throw new Error('生成超时');
        } catch (err: unknown) {
          void tryRefundFcForwardCharge(ltxFcChargedIdT2v, 'video', 'ltx_23_t2v_failed');
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: buildFcErrorPayload(err, err instanceof Error ? err.message : 'LTX2.3 文生视频生成失败'),
          });
        }
        return;
      }

      // LTX2.3 高动态（多图视频控制）：背景图 + 有序分镜图 1–4 张
      if (isLtx23HdrMultiModel) {
        if (!getAliyunFcInitUserUrl().trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法使用插件算力视频生成' },
          });
          return;
        }
        const RUN_BASE = RUNNINGHUB_OPENAPI_V2_BASE;
        const POLL_INTERVAL_MS = 5 * 1000;
        const POLL_DEADLINE_MS = 60 * 60 * 1000;

        const bgUrl = String(inputLtx23HdrBackgroundImage || '').trim();
        const storyboardSlots = normalizeLtx23HdrStoryboardSlots(images || []);

        let ltxFcChargedIdHdr: string | undefined;
        try {
          onStatus({ nodeId, status: 'START', payload: {} });
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 5, text: '正在上传背景图与分镜图...' } });

          const bgRemote = bgUrl ? await this.processImageToOssUrl(bgUrl) : '';
          const storyboardRemote: string[] = [];
          for (const u of storyboardSlots) {
            const trimmed = String(u || '').trim();
            storyboardRemote.push(trimmed ? await this.processImageToOssUrl(trimmed) : '');
          }

          const resRaw = (inputResolutionLtx23HdrMulti || '720') as string;
          const res =
            resRaw === '1080' || resRaw === '1920'
              ? '1280'
              : (resRaw as '720' | '1280' | '1920');
          const ratio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
          const { width, height } = ltx23HdrMultiDimensions(ratio, res);
          const durSec = normalizeLtx23DurationSec(inputDurationLtx23HdrMulti, 15);

          const nodeInfoList: Array<{ nodeId: string; fieldName: string; fieldValue: string; description?: string }> = [
            { nodeId: '43', fieldName: 'value', fieldValue: String(width), description: '宽' },
            { nodeId: '44', fieldName: 'value', fieldValue: String(height), description: '高' },
            { nodeId: '86', fieldName: 'value', fieldValue: String(durSec), description: '时长' },
            { nodeId: '83', fieldName: 'prompt', fieldValue: (prompt || '').trim(), description: 'prompt' },
            { nodeId: '33', fieldName: 'image', fieldValue: bgRemote, description: '背景' },
          ];
          LTX23_HDR_STORYBOARD_NODES.forEach((slot, idx) => {
            nodeInfoList.push({
              nodeId: slot.nodeId,
              fieldName: 'image',
              fieldValue: storyboardRemote[idx] || '',
              description: slot.description,
            });
          });

          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 15, text: '提交任务中...' } });

          console.log(
            '[视频生成] LTX2.3 MSR 提交参数:',
            JSON.stringify({
              appId: LTX23_HDR_MULTI_APP_ID,
              width,
              height,
              durationSec: durSec,
              prompt: (prompt || '').trim().slice(0, 120),
              nodeInfoList: summarizeRhNodeInfoForLog(nodeInfoList),
            }),
          );

          const ltxFcId = randomUUID();
          const runRes = await rhPostChargeVideo(
            `${RUN_BASE}/run/ai-app/${LTX23_HDR_MULTI_APP_ID}`,
            {
              nodeInfoList,
              instanceType: 'plus',
              randomSeed: true,
              retainSeconds: 0,
              usePersonalQueue: false,
            } as Record<string, unknown>,
            ltxFcId,
            {
              billingModelId: buildVideoBillingModelId('ltx-2.3-hdr-multi', input as Record<string, unknown>),
            },
          );
          ltxFcChargedIdHdr = ltxFcId;

          const body = runRes ?? {};
          const taskId = body.taskId ?? body.task_id;
          if (!taskId) {
            throw new Error(`提交失败：${formatRunningHubTaskError(body, '未返回 taskId')}`);
          }

          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: { progress: 15, text: '任务已提交，生成中…', taskId: String(taskId) },
          });

          const deadline = Date.now() + POLL_DEADLINE_MS;
          let lastProgress = 15;
          let ltxPollRound = 0;

          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            lastProgress = Math.min(95, lastProgress + 5);
            onStatus({
              nodeId,
              status: 'PROCESSING',
              payload: { progress: lastProgress, text: '生成中...', taskId: String(taskId) },
            });

            ltxPollRound += 1;
            const queryRes = await rhQueryPollVideo(String(taskId), `${ltxFcId}:poll:${ltxPollRound}`);

            const status = queryRes.status;
            if (status === 'SUCCESS') {
              const results = queryRes.results as Array<{ url?: unknown }> | undefined;
              if (results && Array.isArray(results) && results.length > 0) {
                const first = results[0];
                const url = typeof first?.url === 'string' ? first.url : (first?.url as { url?: string })?.url ?? (first?.url as { href?: string })?.href;
                if (url) {
                  onStatus({ nodeId, status: 'SUCCESS', payload: { url, videoUrl: url, originalVideoUrl: url } });
                  return;
                }
              }
              throw new Error('生成成功但未返回视频 URL');
            }
            if (status === 'FAILED' || status === 'FAILURE') {
              throw rhPollFailureError('LTX2.3 MSR', queryRes, String(taskId));
            }
          }
          throw new Error('生成超时');
        } catch (err: unknown) {
          void tryRefundFcForwardCharge(ltxFcChargedIdHdr, 'video', 'ltx_23_hdr_multi_failed');
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: buildFcErrorPayload(err, err instanceof Error ? err.message : 'LTX2.3 高动态（多图控制）生成失败'),
          });
        }
        return;
      }

      // LTX2.3（首位帧）：RunningHub ai-app（run/ai-app/2048742865043460098）
      if (isRhVideoStartEndModel) {
        if (!getAliyunFcInitUserUrl().trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法使用插件算力视频生成' },
          });
          return;
        }
        const RH_START_END_APP_ID = '2048742865043460098';
        const RUN_BASE = RUNNINGHUB_OPENAPI_V2_BASE;
        const POLL_INTERVAL_MS = 5 * 1000;
        const POLL_DEADLINE_MS = 60 * 60 * 1000;

        const toProcess = (images || []).slice(0, 2);

        let firstImageUrl = '';
        let lastImageUrl = '';
        try {
          firstImageUrl = await this.processImageToOssUrl(toProcess[0]);
          lastImageUrl = await this.processImageToOssUrl(toProcess[1]);
        } catch (e: unknown) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: `处理首尾帧图片失败: ${e instanceof Error ? e.message : String(e)}` },
          });
          return;
        }

        const ratio = aspect_ratio === '9:16' ? '9:16' : '16:9';
        const res = inputResolutionRhartV31 === '720p' || inputResolutionRhartV31 === '1080p' || inputResolutionRhartV31 === '4k'
          ? inputResolutionRhartV31
          : '1080p';
        const sec = duration === '15' ? '15' : duration === '10' ? '10' : '5';
        const size = (() => {
          if (res === '4k') return ratio === '9:16' ? { w: '2160', h: '3840' } : { w: '3840', h: '2160' };
          if (res === '720p') return ratio === '9:16' ? { w: '720', h: '1280' } : { w: '1280', h: '720' };
          return ratio === '9:16' ? { w: '1080', h: '1920' } : { w: '1920', h: '1080' };
        })();
        const runPayload = {
          nodeInfoList: [
            { nodeId: '2004', fieldName: 'image', fieldValue: firstImageUrl, description: 'image1' },
            { nodeId: '5062', fieldName: 'image', fieldValue: lastImageUrl, description: 'image2' },
            { nodeId: '5018', fieldName: 'value', fieldValue: size.w, description: '宽' },
            { nodeId: '5020', fieldName: 'value', fieldValue: size.h, description: '高' },
            { nodeId: '5022', fieldName: 'value', fieldValue: sec, description: '时长' },
            { nodeId: '5090', fieldName: 'text', fieldValue: String(prompt || '').trim(), description: 'text' },
          ],
          instanceType: 'plus', // 视频换人固定 48G 显存
          usePersonalQueue: 'false',
        };

        let rhStartEndChargedTaskId: string | undefined;
        try {
          onStatus({ nodeId, status: 'START', payload: {} });
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 10, text: '提交任务中...' } });
          const fcBaseId = randomUUID();
          const runRes = await rhPostChargeVideo(
            `${RUN_BASE}/run/ai-app/${RH_START_END_APP_ID}`,
            runPayload as Record<string, unknown>,
            fcBaseId,
            { billingModelId: buildVideoBillingModelId('rh-video-start-end', input as Record<string, unknown>) },
          );
          rhStartEndChargedTaskId = fcBaseId;
          const taskId = runRes?.taskId ?? runRes?.task_id;
          if (!taskId) {
            throw new Error(`提交失败：${formatRunningHubTaskError(runRes ?? {}, '未返回 taskId')}`);
          }
          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: { progress: 15, text: '任务已提交，生成中…', taskId: String(taskId) },
          });

          const deadline = Date.now() + POLL_DEADLINE_MS;
          let lastProgress = 15;
          let pollRound = 0;
          while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            lastProgress = Math.min(95, lastProgress + 5);
            onStatus({
              nodeId,
              status: 'PROCESSING',
              payload: { progress: lastProgress, text: '生成中...', taskId: String(taskId) },
            });
            pollRound += 1;
            const queryRes = await rhQueryPollVideo(String(taskId), `${fcBaseId}:poll:${pollRound}`);
            const status = queryRes.status;
            if (status === 'SUCCESS') {
              const results = queryRes.results as Array<{ url?: unknown }> | undefined;
              if (results && Array.isArray(results) && results.length > 0) {
                const first = results[0];
                const url = typeof first?.url === 'string' ? first.url : (first?.url as { url?: string })?.url ?? (first?.url as { href?: string })?.href;
                if (url) {
                  onStatus({ nodeId, status: 'SUCCESS', payload: { url, videoUrl: url, originalVideoUrl: url } });
                  return;
                }
              }
              throw new Error('生成成功但未返回视频 URL');
            }
            if (status === 'FAILED' || status === 'FAILURE') {
              throw rhPollFailureError('LTX2.3（首位帧）', queryRes, String(taskId));
            }
          }
          throw new Error('生成超时');
        } catch (err: unknown) {
          void tryRefundFcForwardCharge(rhStartEndChargedTaskId, 'video', 'rh_start_end_failed');
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: buildFcErrorPayload(err, err instanceof Error ? err.message : 'LTX2.3（首位帧）生成失败'),
          });
          return;
        }
      }

      // WanAnimate（角色替换）：RunningHub ai-app 2048978834447409154（角色图 + 参考视频）
      if (isWanAnimateModel) {
        if (!getAliyunFcInitUserUrl().trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法使用插件算力视频生成' },
          });
          return;
        }
        const RH_WAN_ANIMATE_APP_ID = '2048978834447409154';
        const RUN_BASE = RUNNINGHUB_OPENAPI_V2_BASE;
        const POLL_INTERVAL_MS = 5 * 1000;
        const POLL_DEADLINE_MS = 60 * 60 * 1000;

        const ensureVideoRemoteWa = async (url: string): Promise<string> => {
          const u = String(url || '').trim();
          if (!u) throw new Error('参考视频为空');
          return this.prepareWanAnimateVideoRemoteUrl(u);
        };

        let imageUrlWa = '';
        let videoUrlWa = '';
        try {
          imageUrlWa = await this.processImageToOssUrl(images![0]);
          videoUrlWa = await ensureVideoRemoteWa(String(inputReferenceVideoUrl || '').trim());
        } catch (e: unknown) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: `WanAnimate 处理输入失败: ${e instanceof Error ? e.message : String(e)}` },
          });
          return;
        }

        const presetRaw = String(inputResolutionWanAnimate || '720p').trim().toLowerCase();
        const resVal =
          presetRaw === '1080p' || presetRaw === '1080' || presetRaw === '1920x1080' || presetRaw === '1080x1920'
            ? '1080'
            : '720';
        const clipRaw = String(inputWanAnimateClipSec || '8').trim();
        const clipVal = clipRaw === '5' || clipRaw === '10' || clipRaw === '15' ? clipRaw : '8';

        const runPayloadWa = {
          nodeInfoList: [
            { nodeId: '57', fieldName: 'image', fieldValue: imageUrlWa, description: 'image' },
            { nodeId: '63', fieldName: 'video', fieldValue: videoUrlWa, description: 'video' },
            { nodeId: '250', fieldName: 'value', fieldValue: clipVal, description: 'value' },
            { nodeId: '259', fieldName: 'value', fieldValue: resVal, description: 'resolution' },
          ],
          instanceType: 'plus', // 视频换人固定 48G 显存
          usePersonalQueue: 'false',
        };

        let wanAnimateChargedTaskId: string | undefined;
        try {
          onStatus({ nodeId, status: 'START', payload: {} });
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 10, text: '提交任务中...' } });
          const fcBaseIdWa = randomUUID();
          const runResWa = await rhPostChargeVideo(
            `${RUN_BASE}/run/ai-app/${RH_WAN_ANIMATE_APP_ID}`,
            runPayloadWa as Record<string, unknown>,
            fcBaseIdWa,
            { billingModelId: buildVideoBillingModelId('wan-animate', input as Record<string, unknown>) },
          );
          wanAnimateChargedTaskId = fcBaseIdWa;
          const taskIdWa = runResWa?.taskId ?? runResWa?.task_id;
          if (!taskIdWa) {
            throw new Error(`提交失败：${formatRunningHubTaskError(runResWa ?? {}, '未返回 taskId')}`);
          }
          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: { progress: 15, text: '任务已提交，生成中…', taskId: String(taskIdWa) },
          });

          const deadlineWa = Date.now() + POLL_DEADLINE_MS;
          let lastProgressWa = 15;
          let pollRoundWa = 0;
          while (Date.now() < deadlineWa) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            lastProgressWa = Math.min(95, lastProgressWa + 5);
            onStatus({
              nodeId,
              status: 'PROCESSING',
              payload: { progress: lastProgressWa, text: '生成中...', taskId: String(taskIdWa) },
            });
            pollRoundWa += 1;
            const queryResWa = await rhQueryPollVideo(String(taskIdWa), `${fcBaseIdWa}:poll:${pollRoundWa}`);
            const st = queryResWa.status;
            if (st === 'SUCCESS') {
              const resultsWa = queryResWa.results as Array<{ url?: unknown; outputType?: unknown }> | undefined;
              if (resultsWa && Array.isArray(resultsWa) && resultsWa.length > 0) {
                const pickUrl = (it: { url?: unknown } | undefined): string => {
                  if (!it) return '';
                  if (typeof it.url === 'string') return it.url;
                  return (it.url as { url?: string })?.url ?? (it.url as { href?: string })?.href ?? '';
                };
                // WanAnimate 可能先返回音频(flac)再返回视频(mp4)：优先取视频结果
                const mp4Item = resultsWa.find((it) => {
                  const out = String(it?.outputType ?? '').trim().toLowerCase();
                  const u = pickUrl(it).toLowerCase();
                  return out === 'mp4' || u.endsWith('.mp4');
                });
                const bestItem = mp4Item || resultsWa[0];
                const urlWa = pickUrl(bestItem);
                if (urlWa) {
                  onStatus({ nodeId, status: 'SUCCESS', payload: { url: urlWa, videoUrl: urlWa, originalVideoUrl: urlWa } });
                  return;
                }
              }
              throw new Error('生成成功但未返回视频 URL');
            }
            if (st === 'FAILED' || st === 'FAILURE') {
              throw rhPollFailureError('WanAnimate', queryResWa, String(taskIdWa));
            }
          }
          throw new Error('生成超时');
        } catch (err: unknown) {
          void tryRefundFcForwardCharge(wanAnimateChargedTaskId, 'video', 'wan_animate_failed');
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: buildFcErrorPayload(err, err instanceof Error ? err.message : 'WanAnimate（角色替换）生成失败'),
          });
          return;
        }
      }

      // HeyGem 数字人：RunningHub ai-app 2071200225913565185（参考视频 + 音频，plus 48G）
      if (isHeyGemModel) {
        if (!getAliyunFcInitUserUrl().trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法使用插件算力视频生成' },
          });
          return;
        }
        const RH_HEYGEM_APP_ID = '2071200225913565185';
        const RUN_BASE = RUNNINGHUB_OPENAPI_V2_BASE;
        const POLL_INTERVAL_MS = 5 * 1000;
        const POLL_DEADLINE_MS = 60 * 60 * 1000;

        const ensureAudioRemoteHg = async (url: string): Promise<string> => {
          if (url.startsWith('http://') || url.startsWith('https://')) {
            if (isOurOssOrCdnObjectUrl(url)) {
              return preferDirectOssUrlForThirdPartyImageRef(url);
            }
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000, proxy: false });
            const ct = res.headers['content-type'] || '';
            const mimeType = ct.includes('wav') ? 'audio/wav' : ct.includes('ogg') ? 'audio/ogg' : ct.includes('m4a') ? 'audio/mp4' : 'audio/mpeg';
            return this.uploadAudioToOSS(Buffer.from(res.data), mimeType);
          }
          if (url.startsWith('local-resource://') || url.startsWith('file://')) {
            return this.uploadLocalAudioToOSS(url);
          }
          if (url.startsWith('data:audio/')) {
            const m = url.match(/^data:audio\/(\w+);base64,(.+)$/);
            const buf = Buffer.from(m ? m[2] : '', 'base64');
            const mime = m ? `audio/${m[1]}` : 'audio/mpeg';
            return this.uploadAudioToOSS(buf, mime);
          }
          return url;
        };

        let videoUrlHg = '';
        let audioUrlHg = '';
        let heyGemChargedTaskId: string | undefined;
        try {
          onStatus({ nodeId, status: 'START', payload: {} });
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 5, text: '正在上传参考视频与音频…' } });
          videoUrlHg = await this.prepareWanAnimateVideoRemoteUrl(String(inputReferenceVideoUrl || '').trim());
          audioUrlHg = await ensureAudioRemoteHg(inputAudioUrl!.trim());
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 15, text: '提交 HeyGem 任务…' } });

          const runPayloadHg = {
            nodeInfoList: [
              { nodeId: '1', fieldName: 'file', fieldValue: videoUrlHg, description: 'file' },
              { nodeId: '4', fieldName: 'audio', fieldValue: audioUrlHg, description: 'audio' },
            ],
            instanceType: 'plus',
            usePersonalQueue: 'false',
          };

          const fcBaseIdHg = randomUUID();
          const runResHg = await rhPostChargeVideo(
            `${RUN_BASE}/run/ai-app/${RH_HEYGEM_APP_ID}`,
            runPayloadHg as Record<string, unknown>,
            fcBaseIdHg,
            { billingModelId: buildVideoBillingModelId('hey-gem', input as Record<string, unknown>) },
          );
          heyGemChargedTaskId = fcBaseIdHg;
          const taskIdHg = runResHg?.taskId ?? runResHg?.task_id;
          if (!taskIdHg) {
            throw new Error(`提交失败：${formatRunningHubTaskError(runResHg ?? {}, '未返回 taskId')}`);
          }
          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: { progress: 15, text: '任务已提交，生成中…', taskId: String(taskIdHg) },
          });

          const deadlineHg = Date.now() + POLL_DEADLINE_MS;
          let lastProgressHg = 15;
          let pollRoundHg = 0;
          while (Date.now() < deadlineHg) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            lastProgressHg = Math.min(95, lastProgressHg + 5);
            onStatus({
              nodeId,
              status: 'PROCESSING',
              payload: { progress: lastProgressHg, text: 'HeyGem 生成中…', taskId: String(taskIdHg) },
            });
            pollRoundHg += 1;
            const queryResHg = await rhQueryPollVideo(String(taskIdHg), `${fcBaseIdHg}:poll:${pollRoundHg}`);
            const stHg = queryResHg.status;
            if (stHg === 'SUCCESS') {
              const resultsHg = queryResHg.results as Array<{ url?: unknown; outputType?: unknown }> | undefined;
              if (resultsHg && Array.isArray(resultsHg) && resultsHg.length > 0) {
                const pickUrl = (it: { url?: unknown } | undefined): string => {
                  if (!it) return '';
                  if (typeof it.url === 'string') return it.url;
                  return (it.url as { url?: string })?.url ?? (it.url as { href?: string })?.href ?? '';
                };
                const mp4Item = resultsHg.find((it) => {
                  const out = String(it?.outputType ?? '').trim().toLowerCase();
                  const u = pickUrl(it).toLowerCase();
                  return out === 'mp4' || u.endsWith('.mp4');
                });
                const bestItem = mp4Item || resultsHg[0];
                const urlHg = pickUrl(bestItem);
                if (urlHg) {
                  onStatus({ nodeId, status: 'SUCCESS', payload: { url: urlHg, videoUrl: urlHg, originalVideoUrl: urlHg } });
                  return;
                }
              }
              throw new Error('生成成功但未返回视频 URL');
            }
            if (stHg === 'FAILED' || stHg === 'FAILURE') {
              throw rhPollFailureError('HeyGem', queryResHg, String(taskIdHg));
            }
          }
          throw new Error('生成超时');
        } catch (err: unknown) {
          void tryRefundFcForwardCharge(heyGemChargedTaskId, 'video', 'hey_gem_failed');
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: buildFcErrorPayload(err, err instanceof Error ? err.message : 'HeyGem 数字人生成失败'),
          });
          return;
        }
      }

      // Gemini Omni 图生视频：RunningHub ai-app 2067153261005721602（1–3 张参考图 + prompt）
      if (isGeminiOmniModel) {
        if (!getAliyunFcInitUserUrl().trim()) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法使用插件算力视频生成' },
          });
          return;
        }
        if (!Array.isArray(images) || images.filter((img) => String(img || '').trim()).length < 1) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: 'Gemini Omni 需要至少 1 张参考图' },
          });
          return;
        }
        const RH_GEMINI_OMNI_APP_ID = '2067153261005721602';
        const RUN_BASE = RUNNINGHUB_OPENAPI_V2_BASE;
        const POLL_INTERVAL_MS = 5 * 1000;
        const POLL_DEADLINE_MS = 60 * 60 * 1000;

        const imageNodeIds = ['1', '2', '3'] as const;
        const geminiImages = images
          .map((img) => String(img || '').trim())
          .filter(Boolean)
          .slice(0, 3);
        let uploadedImageUrls: string[] = [];
        try {
          onStatus({ nodeId, status: 'START', payload: {} });
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 5, text: '正在上传参考图...' } });
          uploadedImageUrls = await Promise.all(
            geminiImages.map((img) => this.processImageToOssUrl(img)),
          );
        } catch (e: unknown) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: `Gemini Omni 处理参考图失败: ${e instanceof Error ? e.message : String(e)}` },
          });
          return;
        }

        const resRaw = String(inputResolutionGeminiOmni || '720p').trim().toLowerCase();
        const resolutionVal = resRaw === '1080p' || resRaw === '4k' ? resRaw : '720p';
        const durationVal = String(normalizeGeminiOmniDurationSec(inputDurationGeminiOmni, 6));
        const aspectVal = aspect_ratio === '9:16' ? '9:16' : '16:9';

        /** 始终写满 3 个参考图槽位，空位传 ''，避免 RH 工作流沿用上次任务的残留参考图 */
        const nodeInfoList: Array<Record<string, string>> = imageNodeIds.map((nodeId, idx) => ({
          nodeId,
          fieldName: 'image',
          fieldValue: uploadedImageUrls[idx] || '',
          description: 'image',
        }));
        nodeInfoList.push(
          {
            nodeId: '5',
            fieldName: 'aspectRatio',
            fieldData: '[["16:9", "9:16"], {"default": "16:9"}]',
            fieldValue: aspectVal,
            description: 'aspectRatio',
          },
          {
            nodeId: '5',
            fieldName: 'duration',
            fieldData: '[["6", "8", "10"], {"default": "6"}]',
            fieldValue: durationVal,
            description: 'duration',
          },
          {
            nodeId: '5',
            fieldName: 'prompt',
            fieldValue: (prompt || '').trim(),
            description: 'prompt',
          },
          {
            nodeId: '5',
            fieldName: 'resolution',
            fieldData: '[["720p", "1080p", "4k"], {"default": "720p"}]',
            fieldValue: resolutionVal,
            description: 'resolution',
          },
        );

        const runPayloadGo = {
          nodeInfoList,
          instanceType: 'default',
          usePersonalQueue: 'false',
        };

        let geminiOmniChargedTaskId: string | undefined;
        try {
          onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 10, text: '提交任务中...' } });
          const fcBaseIdGo = randomUUID();
          const runResGo = await rhPostChargeVideo(
            `${RUN_BASE}/run/ai-app/${RH_GEMINI_OMNI_APP_ID}`,
            runPayloadGo as Record<string, unknown>,
            fcBaseIdGo,
            { billingModelId: buildVideoBillingModelId('gemini-omni', input as Record<string, unknown>) },
          );
          geminiOmniChargedTaskId = fcBaseIdGo;
          const taskIdGo = runResGo?.taskId ?? runResGo?.task_id;
          if (!taskIdGo) {
            throw new Error(`提交失败：${formatRunningHubTaskError(runResGo ?? {}, '未返回 taskId')}`);
          }
          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: { progress: 15, text: '任务已提交，生成中…', taskId: String(taskIdGo) },
          });

          const deadlineGo = Date.now() + POLL_DEADLINE_MS;
          let lastProgressGo = 15;
          let pollRoundGo = 0;
          while (Date.now() < deadlineGo) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
            lastProgressGo = Math.min(95, lastProgressGo + 5);
            onStatus({
              nodeId,
              status: 'PROCESSING',
              payload: { progress: lastProgressGo, text: '生成中...', taskId: String(taskIdGo) },
            });
            pollRoundGo += 1;
            const queryResGo = await rhQueryPollVideo(String(taskIdGo), `${fcBaseIdGo}:poll:${pollRoundGo}`);
            const st = queryResGo.status;
            if (st === 'SUCCESS') {
              const resultsGo = queryResGo.results as Array<{ url?: unknown; outputType?: unknown }> | undefined;
              if (resultsGo && Array.isArray(resultsGo) && resultsGo.length > 0) {
                const pickUrl = (it: { url?: unknown } | undefined): string => {
                  if (!it) return '';
                  if (typeof it.url === 'string') return it.url;
                  return (it.url as { url?: string })?.url ?? (it.url as { href?: string })?.href ?? '';
                };
                const mp4Item = resultsGo.find((it) => {
                  const out = String(it?.outputType ?? '').trim().toLowerCase();
                  const u = pickUrl(it).toLowerCase();
                  return out === 'mp4' || u.endsWith('.mp4');
                });
                const bestItem = mp4Item || resultsGo[0];
                const urlGo = pickUrl(bestItem);
                if (urlGo) {
                  onStatus({ nodeId, status: 'SUCCESS', payload: { url: urlGo, videoUrl: urlGo, originalVideoUrl: urlGo } });
                  return;
                }
              }
              throw new Error('生成成功但未返回视频 URL');
            }
            if (st === 'FAILED' || st === 'FAILURE') {
              throw rhPollFailureError('Gemini Omni', queryResGo, String(taskIdGo));
            }
          }
          throw new Error('生成超时');
        } catch (err: unknown) {
          void tryRefundFcForwardCharge(geminiOmniChargedTaskId, 'video', 'gemini_omni_failed');
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: buildFcErrorPayload(err, err instanceof Error ? err.message : 'Gemini Omni 生成失败'),
          });
          return;
        }
      }

      // kling 和 sora-2 模型使用不同的 API 端点和参数格式
      let payload: any;
      let apiEndpoint: string;
      
      if (isKlingModel) {
        // kling-v2.6-pro 模型参数格式（runninghub-api）
        payload = {
          prompt,
        };
        
        if (negativePrompt) {
          payload.negativePrompt = negativePrompt;
        }
        if (guidanceScale !== undefined) {
          payload.guidanceScale = guidanceScale;
        } else {
          payload.guidanceScale = 0.5; // 默认值
        }
        if (sound) {
          payload.sound = sound;
        } else {
          payload.sound = 'false'; // 默认值
        }
        if (aspect_ratio) {
          payload.aspectRatio = aspect_ratio;
        } else {
          payload.aspectRatio = '16:9'; // 默认值
        }
        if (duration === '5' || duration === '10') {
          payload.duration = duration;
        } else {
          payload.duration = '5'; // 默认值
        }
        
        // 图生视频模式：需要先处理图片 URL
        if (isImageToVideo) {
          const imageUrl = images && images.length > 0 ? images[0] : '';
          if (!imageUrl) {
            throw new Error('图生视频模式需要至少一张图片');
          }
          
          // 处理图片 URL：无论是什么格式，都先上传到阿里云 OSS，获取公网 URL
          let processedImageUrl = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          
          try {
            // 0. 检查是否已经是 OSS URL，如果是则直接使用，避免重复上传
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              // 检查是否是我们的 OSS URL
              if (isOurOssOrCdnObjectUrl(imageUrl)) {
                console.log(`[视频生成] kling-v2.6-pro 图生视频：检测到已经是 OSS URL，直接使用: ${imageUrl}`);
                processedImageUrl = imageUrl;
              } else {
                // 是其他 HTTP/HTTPS URL，需要下载后上传到 OSS
                console.log(`[视频生成] kling-v2.6-pro 图生视频：检测到 HTTP/HTTPS URL，先下载图片，然后上传至香港OSS...`);
                
                const response = await axios.get(imageUrl, {
                  responseType: 'arraybuffer',
                  timeout: 30000, // 30秒超时
                });
                
                imageBuffer = Buffer.from(response.data);
                const contentType = response.headers['content-type'] || 'image/png';
                mimeType = contentType;
                
                processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
                console.log(`[视频生成] kling-v2.6-pro 图生视频：图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
              }
            }
            // 1. 处理本地文件路径（local-resource:// 或 file://）
            else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath: string;
              
              if (imageUrl.startsWith('local-resource://')) {
                filePath = imageUrl.replace(/^local-resource:\/\/+/, '');
              } else {
                filePath = imageUrl.replace(/^file:\/\/\/+/, '');
              }
              
              // 移除查询参数
              if (filePath.includes('?')) {
                filePath = filePath.split('?')[0];
              }
              
              // URL 解码
              try {
                filePath = decodeURIComponent(filePath);
              } catch (e) {
                console.warn('[视频生成] kling-v2.6-pro 图生视频：URL 解码失败，使用原始路径');
              }
              
              // 规范化路径
              if (!path.isAbsolute(filePath)) {
                const userDataPath = app.getPath('userData');
                filePath = path.resolve(userDataPath, filePath);
              }
              
              filePath = path.normalize(filePath);
              
              console.log(`[视频生成] kling-v2.6-pro 图生视频：读取本地文件: ${filePath}`);
              
              // 检查文件是否存在
              if (!fs.existsSync(filePath)) {
                throw new Error(`图片文件不存在: ${filePath}`);
              }
              
              // 读取文件
              imageBuffer = fs.readFileSync(filePath);
              
              // 根据文件扩展名确定 MIME 类型
              const ext = path.extname(filePath).toLowerCase();
              switch (ext) {
                case '.jpg':
                case '.jpeg':
                  mimeType = 'image/jpeg';
                  break;
                case '.png':
                  mimeType = 'image/png';
                  break;
                case '.webp':
                  mimeType = 'image/webp';
                  break;
                default:
                  mimeType = 'image/png';
              }
              
              // 上传到 OSS
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
              console.log(`[视频生成] kling-v2.6-pro 图生视频：本地图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
            }
            // 2. 处理 base64 图片
            else if (imageUrl.startsWith('data:image/')) {
              const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
              if (!base64Match) {
                throw new Error('无效的 base64 图片格式');
              }
              
              const imageFormat = base64Match[1];
              const base64Data = base64Match[2];
              
              imageBuffer = Buffer.from(base64Data, 'base64');
              
              // 根据格式确定 MIME 类型
              mimeType = `image/${imageFormat}`;
              
              // 上传到 OSS
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
              console.log(`[视频生成] kling-v2.6-pro 图生视频：base64 图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}...`);
            }
            
            // 将处理后的图片 URL 添加到 payload
            payload.imageUrl = processedImageUrl;
          } catch (error: any) {
            console.error('[视频生成] kling-v2.6-pro 图生视频：图片处理失败:', error);
            throw new Error(`图片处理失败: ${error.message || error}`);
          }
          
          // 图生视频端点
          apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/kling-v2.6-pro/image-to-video`;
        } else {
          // 文生视频端点
          apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/kling-v2.6-pro/text-to-video`;
        }
      } else if (isHailuo02Model) {
        // 海螺-02 文生视频标准：https://www.runninghub.cn/openapi/v2/minimax/hailuo-02/t2v-standard
        const dur = inputDurationHailuo02 === '10' ? '10' : '6';
        payload = { prompt, enablePromptExpansion: true, duration: dur };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/minimax/hailuo-02/t2v-standard`;
      } else if (isHailuo23Model) {
        // 海螺-2.3 文生视频标准：https://www.runninghub.cn/openapi/v2/minimax/hailuo-2.3/t2v-standard
        const dur = inputDurationHailuo02 === '10' ? '10' : '6';
        payload = { prompt, enablePromptExpansion: true, duration: dur };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/minimax/hailuo-2.3/t2v-standard`;
      } else if (isKlingVideoO1Model) {
        // 可灵文生视频o1：https://www.runninghub.cn/openapi/v2/kling-video-o1/text-to-video
        const ratio = (aspect_ratio === '1:1' || aspect_ratio === '9:16' || aspect_ratio === '16:9') ? aspect_ratio : '16:9';
        const dur = inputDurationKlingO1 === '10' ? '10' : '5';
        const mode = inputModeKlingO1 === 'pro' ? 'pro' : 'std';
        payload = { prompt: prompt || '', aspectRatio: ratio, duration: dur, mode };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/kling-video-o1/text-to-video`;
      } else if (isKlingVideoO1I2vModel) {
        // 可灵图生视频o1：https://www.runninghub.cn/openapi/v2/kling-video-o1/image-to-video
        // 参数：firstImageUrl(必填), prompt(可选), aspectRatio(必填), duration(5|10), mode(std|pro)
        const imageUrl = images && images.length > 0 ? images[0] : '';
        if (!imageUrl) throw new Error('可灵图生视频o1 需要 1 张参考图');
        let processedImageUrl = imageUrl;
        let imageBuffer: Buffer;
        let mimeType = 'image/png';
        try {
          if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            if (!isOurOssOrCdnObjectUrl(imageUrl)) {
              const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
              imageBuffer = Buffer.from(response.data);
              mimeType = (response.headers['content-type'] as string) || 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            }
          } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
            let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
            if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
            filePath = decodeURIComponent(filePath);
            if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
            const userDataPath = app.getPath('userData');
            const normalizedFilePath = path.normalize(filePath);
            const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
            if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
            imageBuffer = fs.readFileSync(normalizedFilePath);
            const ext = path.extname(normalizedFilePath).toLowerCase();
            mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else if (imageUrl.startsWith('data:image/')) {
            const base64Data = imageUrl.split(',')[1];
            if (!base64Data) throw new Error('Base64 Data URL 格式无效');
            imageBuffer = Buffer.from(base64Data, 'base64');
            const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
            mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else {
            throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
          }
        } catch (err: any) {
          throw new Error(`可灵图生视频o1 图片处理失败: ${err.message || err}`);
        }
        if (!processedImageUrl || (!processedImageUrl.startsWith('http://') && !processedImageUrl.startsWith('https://'))) {
          throw new Error('图片上传失败，请检查图片格式和网络连接');
        }
        const ratio = (aspect_ratio === '1:1' || aspect_ratio === '9:16' || aspect_ratio === '16:9') ? aspect_ratio : '16:9';
        const dur = inputDurationKlingO1 === '10' ? '10' : '5';
        const mode = inputModeKlingO1 === 'pro' ? 'pro' : 'std';
        payload = { prompt: prompt || '', aspectRatio: ratio, duration: dur, firstImageUrl: processedImageUrl, mode };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/kling-video-o1/image-to-video`;
      } else if (isKlingVideoO1StartEndModel) {
        // 可灵首尾帧生视频o1：https://www.runninghub.cn/openapi/v2/kling-video-o1/start-to-end
        // 参数：firstImageUrl(必填), lastImageUrl(必填), prompt(可选), aspectRatio, duration(5|10), mode(std|pro)
        const toProcess = (images || []).slice(0, 2);
        let firstImageUrl = '';
        let lastImageUrl = '';
        for (let i = 0; i < toProcess.length; i++) {
          const imageUrl = toProcess[i];
          if (!imageUrl) continue;
          let processed = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (!isOurOssOrCdnObjectUrl(imageUrl)) {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                imageBuffer = Buffer.from(response.data);
                mimeType = (response.headers['content-type'] as string) || 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const normalizedFilePath = path.normalize(filePath);
              const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`可灵首尾帧生视频o1 图片处理失败: ${err.message || err}`);
          }
          if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
            if (i === 0) firstImageUrl = processed;
            else lastImageUrl = processed;
          }
        }
        if (!firstImageUrl || !lastImageUrl) throw new Error('可灵首尾帧生视频o1 需要首帧、尾帧共 2 张有效参考图');
        const ratio = (aspect_ratio === '1:1' || aspect_ratio === '9:16' || aspect_ratio === '16:9') ? aspect_ratio : '16:9';
        const dur = inputDurationKlingO1 === '10' ? '10' : '5';
        const mode = inputModeKlingO1 === 'pro' ? 'pro' : 'std';
        payload = { prompt: prompt || '', aspectRatio: ratio, duration: dur, firstImageUrl, lastImageUrl, mode };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/kling-video-o1/start-to-end`;
      } else if (isHailuo02I2vModel) {
        // 海螺-02 图生视频标准：https://www.runninghub.cn/openapi/v2/minimax/hailuo-02/i2v-standard
        // 参数：firstImageUrl(必填), lastImageUrl(可选), prompt(可选), enablePromptExpansion, duration(6|10)
        const dur = inputDurationHailuo02 === '10' ? '10' : '6';
        const toProcess = (images || []).slice(0, 2);
        let firstImageUrl = '';
        let lastImageUrl = '';
        for (let i = 0; i < toProcess.length; i++) {
          const imageUrl = toProcess[i];
          if (!imageUrl) continue;
          let processed = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (!isOurOssOrCdnObjectUrl(imageUrl)) {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                imageBuffer = Buffer.from(response.data);
                mimeType = (response.headers['content-type'] as string) || 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const normalizedFilePath = path.normalize(filePath);
              const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`海螺-02 图生视频图片处理失败: ${err.message || err}`);
          }
          if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
            if (i === 0) firstImageUrl = processed;
            else lastImageUrl = processed;
          }
        }
        if (!firstImageUrl) throw new Error('海螺-02 图生视频需要至少一张有效参考图');
        payload = {
          prompt: prompt || '',
          enablePromptExpansion: true,
          firstImageUrl,
          duration: dur,
        };
        if (lastImageUrl) (payload as Record<string, string>)['lastImageUrl'] = lastImageUrl;
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/minimax/hailuo-02/i2v-standard`;
      } else if (isHailuo23I2vModel) {
        // 海螺-2.3 图生视频标准：https://www.runninghub.cn/openapi/v2/minimax/hailuo-2.3/i2v-standard
        // 参数：imageUrl(必填), prompt(可选), enablePromptExpansion, duration(6|10)，仅 1 张图
        const imageUrl = images && images.length > 0 ? images[0] : '';
        if (!imageUrl) throw new Error('海螺-2.3 图生视频需要 1 张参考图');
        let processedImageUrl = imageUrl;
        let imageBuffer: Buffer;
        let mimeType = 'image/png';
        try {
          if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            if (!isOurOssOrCdnObjectUrl(imageUrl)) {
              const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
              imageBuffer = Buffer.from(response.data);
              mimeType = (response.headers['content-type'] as string) || 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            }
          } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
            let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
            if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
            filePath = decodeURIComponent(filePath);
            if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
            const userDataPath = app.getPath('userData');
            const normalizedFilePath = path.normalize(filePath);
            const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
            if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
            imageBuffer = fs.readFileSync(normalizedFilePath);
            const ext = path.extname(normalizedFilePath).toLowerCase();
            mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else if (imageUrl.startsWith('data:image/')) {
            const base64Data = imageUrl.split(',')[1];
            if (!base64Data) throw new Error('Base64 Data URL 格式无效');
            imageBuffer = Buffer.from(base64Data, 'base64');
            const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
            mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else {
            throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
          }
        } catch (err: any) {
          throw new Error(`海螺-2.3 图生视频图片处理失败: ${err.message || err}`);
        }
        if (!processedImageUrl || (!processedImageUrl.startsWith('http://') && !processedImageUrl.startsWith('https://'))) {
          throw new Error('图片上传失败，请检查图片格式和网络连接');
        }
        const dur = inputDurationHailuo02 === '10' ? '10' : '6';
        payload = { prompt: prompt || '', enablePromptExpansion: true, imageUrl: processedImageUrl, duration: dur };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/minimax/hailuo-2.3/i2v-standard`;
      } else if (isWan26Model) {
        const shotType = inputShotType === 'multi' ? 'multi' : 'single';
        const wanDuration = duration === '5' || duration === '10' || duration === '15' ? duration : '5';
        const resolutionWan26 = inputResolutionWan26 === '720p' ? '720p' : '1080p';

        if (isImageToVideo) {
          // 万相2.6 图生视频：https://www.runninghub.cn/openapi/v2/alibaba/wan-2.6/image-to-video
          // 参数：imageUrl(必填), prompt(可选), negativePrompt(可选), resolution(720p|1080p), duration(5|10|15), shotType(single|multi)
          const imageUrl = images && images.length > 0 ? images[0] : '';
          if (!imageUrl) {
            throw new Error('图生视频模式需要至少一张图片');
          }
          let processedImageUrl = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (isOurOssOrCdnObjectUrl(imageUrl)) {
                processedImageUrl = imageUrl;
              } else {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                imageBuffer = Buffer.from(response.data);
                mimeType = (response.headers['content-type'] as string) || 'image/png';
                processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://')
                ? imageUrl.replace(/^local-resource:\/\//, '')
                : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const projectsBaseV2 = getProjectsBasePath();
              const normalizedFilePath = path.normalize(filePath);
              const allowedV2 = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBaseV2));
              if (!allowedV2) {
                throw new Error(`访问路径超出允许范围: ${filePath}`);
              }
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`万相2.6 图生视频图片处理失败: ${err.message || err}`);
          }
          if (!processedImageUrl || (!processedImageUrl.startsWith('http://') && !processedImageUrl.startsWith('https://'))) {
            throw new Error('图片上传失败，请检查图片格式和网络连接');
          }
          payload = {
            imageUrl: processedImageUrl,
            prompt: prompt || '',
            negativePrompt: negativePrompt || '',
            resolution: resolutionWan26,
            duration: wanDuration,
            shotType,
          };
          apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/alibaba/wan-2.6/image-to-video`;
          console.log('[视频生成] 万相2.6 图生视频 请求体:', JSON.stringify({ ...payload, imageUrl: processedImageUrl.substring(0, 80) + '...' }, null, 2));
        } else {
          // 万相2.6 文生视频：https://www.runninghub.cn/openapi/v2/alibaba/wan-2.6/text-to-video
          const resolutionMap: Record<string, string> = {
            '16:9': '1920*1080',
            '9:16': '1080*1920',
            '1:1': '1280*720',
          };
          const resolution = resolutionMap[aspect_ratio || '16:9'] || '1920*1080';
          payload = {
            prompt,
            negativePrompt: negativePrompt || '',
            duration: wanDuration,
            resolution,
            shotType,
          };
          apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/alibaba/wan-2.6/text-to-video`;
        }
      } else if (isRhartV31ProSEModel) {
        // 全能视频V3.1-pro 首尾帧生视频：https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-pro/start-end-to-video
        // 参数：prompt(必填), firstFrameUrl(必填), lastFrameUrl(可选), aspectRatio(16:9|9:16), duration(可选 仅8), resolution(必填 720p|1080p|4k)
        const ratio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        const toProcess = (images || []).slice(0, 2);
        let firstFrameUrl = '';
        let lastFrameUrl = '';
        for (let i = 0; i < toProcess.length; i++) {
          const imageUrl = toProcess[i];
          if (!imageUrl) continue;
          let processed = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (!isOurOssOrCdnObjectUrl(imageUrl)) {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                imageBuffer = Buffer.from(response.data);
                mimeType = (response.headers['content-type'] as string) || 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const normalizedFilePath = path.normalize(filePath);
              const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`全能V3.1-pro 首尾帧生视频图片处理失败: ${err.message || err}`);
          }
          if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
            if (i === 0) firstFrameUrl = processed;
            else lastFrameUrl = processed;
          }
        }
        if (!firstFrameUrl || !lastFrameUrl) throw new Error('首尾帧生视频需要恰好两张有效图片（首帧、尾帧）');
        const resProSe = inputResolutionRhartV31 === '720p' || inputResolutionRhartV31 === '1080p' || inputResolutionRhartV31 === '4k' ? inputResolutionRhartV31 : '1080p';
        payload = {
          prompt: prompt || '',
          firstFrameUrl,
          lastFrameUrl,
          aspectRatio: ratio,
          duration: '8',
          resolution: resProSe,
        };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-v3.1-pro/start-end-to-video`;
      } else if (isRhartV31ProModel) {
        // 全能视频V3.1-pro 仅文生视频：https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-pro/text-to-video
        // 参数：prompt(必填 5-8000), aspectRatio(必填 16:9|9:16), resolution(必填 720p|1080p|4k), duration(可选 8)
        const ratio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        const resProT2v = inputResolutionRhartV31 === '720p' || inputResolutionRhartV31 === '1080p' || inputResolutionRhartV31 === '4k' ? inputResolutionRhartV31 : '1080p';
        payload = {
          prompt,
          aspectRatio: ratio,
          resolution: resProT2v,
          duration: '8',
        };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-v3.1-pro/text-to-video`;
      } else if (isRhartV31FastSEModel) {
        // 全能视频V3.1-fast 首尾帧生视频：https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-fast/start-end-to-video
        // 参数：prompt(必填), firstFrameUrl(必填), lastFrameUrl(必填), aspectRatio(16:9|9:16), resolution(720p|1080p|4k), duration(可选8)
        const ratio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        const res = inputResolutionRhartV31 === '720p' || inputResolutionRhartV31 === '1080p' || inputResolutionRhartV31 === '4k' ? inputResolutionRhartV31 : '1080p';
        const toProcess = (images || []).slice(0, 2);
        let firstFrameUrl = '';
        let lastFrameUrl = '';
        for (let i = 0; i < toProcess.length; i++) {
          const imageUrl = toProcess[i];
          if (!imageUrl) continue;
          let processed = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (!isOurOssOrCdnObjectUrl(imageUrl)) {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                imageBuffer = Buffer.from(response.data);
                mimeType = (response.headers['content-type'] as string) || 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const normalizedFilePath = path.normalize(filePath);
              const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`全能V3.1-fast 首尾帧生视频图片处理失败: ${err.message || err}`);
          }
          if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
            if (i === 0) firstFrameUrl = processed;
            else lastFrameUrl = processed;
          }
        }
        if (!firstFrameUrl || !lastFrameUrl) throw new Error('首尾帧生视频需要恰好两张有效图片（首帧、尾帧）');
        payload = {
          prompt: prompt || '',
          firstFrameUrl,
          lastFrameUrl,
          aspectRatio: ratio,
          resolution: res,
          duration: '8',
        };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-v3.1-fast/start-end-to-video`;
      } else if (isRhartV31FastModel) {
        const ratio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        const res = inputResolutionRhartV31 === '720p' || inputResolutionRhartV31 === '1080p' || inputResolutionRhartV31 === '4k' ? inputResolutionRhartV31 : '1080p';

        if (isImageToVideo) {
          // 全能视频V3.1-fast 图生视频：https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-fast/image-to-video
          // 参数：prompt(必填), aspectRatio(16:9|9:16), imageUrls(必填, 最多3张), resolution(720p|1080p|4k), duration(可选8)
          const toProcess = (images || []).slice(0, 3);
          const imageUrls: string[] = [];
          for (const imageUrl of toProcess) {
            if (!imageUrl) continue;
            let processed = imageUrl;
            let imageBuffer: Buffer;
            let mimeType = 'image/png';
            try {
              if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                if (!isOurOssOrCdnObjectUrl(imageUrl)) {
                  const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                  imageBuffer = Buffer.from(response.data);
                  mimeType = (response.headers['content-type'] as string) || 'image/png';
                  processed = await this.uploadImageToOSS(imageBuffer, mimeType);
                }
              } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
                let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
                if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
                filePath = decodeURIComponent(filePath);
                if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
                const userDataPath = app.getPath('userData');
                const normalizedFilePath = path.normalize(filePath);
                const _projectsBase = getProjectsBasePath();
            if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBase))) throw new Error(`访问路径超出允许范围: ${filePath}`);
                if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
                imageBuffer = fs.readFileSync(normalizedFilePath);
                const ext = path.extname(normalizedFilePath).toLowerCase();
                mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              } else if (imageUrl.startsWith('data:image/')) {
                const base64Data = imageUrl.split(',')[1];
                if (!base64Data) throw new Error('Base64 Data URL 格式无效');
                imageBuffer = Buffer.from(base64Data, 'base64');
                const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
                mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              } else {
                throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
              }
            } catch (err: any) {
              throw new Error(`全能V3.1-fast 图生视频图片处理失败: ${err.message || err}`);
            }
            if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
              imageUrls.push(processed);
            }
          }
          if (imageUrls.length === 0) throw new Error('图生视频需要至少一张有效图片');
          payload = {
            prompt: prompt || '',
            aspectRatio: ratio,
            imageUrls,
            resolution: res,
            duration: '8',
          };
          apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-v3.1-fast/image-to-video`;
        } else {
          // 全能视频V3.1-fast 文生视频
          payload = {
            prompt,
            aspectRatio: ratio,
            resolution: res,
            duration: '8',
          };
          apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-v3.1-fast/text-to-video`;
        }
      } else if (isGrok3Model) {
        // Grok video3（标准 OpenAPI v2）：文生 /rhart-video-g/text-to-video；图生 /rhart-video-g/image-to-video
        // 参数：prompt、aspectRatio、resolution(720p)、duration(6|10|15|30 秒)；图生另含 imageUrls(最多 7)
        const arG3Raw = String(aspect_ratio || '16:9').trim();
        const allowedG3Ar = new Set(['2:3', '3:2', '1:1', '16:9', '9:16']);
        const aspectG3Val = allowedG3Ar.has(arG3Raw) ? arG3Raw : '16:9';
        const resG3Val = '720p';
        const durG3Sec = normalizeGrok3DurationSec(inputDurationGrok3, 10);

        if (isImageToVideo) {
          const toProcessG3 = (images || []).slice(0, 7);
          const imageUrlsG3: string[] = [];
          for (const imageUrl of toProcessG3) {
            if (!imageUrl) continue;
            let processed = imageUrl;
            let imageBuffer: Buffer;
            let mimeType = 'image/png';
            try {
              if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                if (!isOurOssOrCdnObjectUrl(imageUrl)) {
                  const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                  imageBuffer = Buffer.from(response.data);
                  mimeType = (response.headers['content-type'] as string) || 'image/png';
                  processed = await this.uploadImageToOSS(imageBuffer, mimeType);
                }
              } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
                let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
                if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
                filePath = decodeURIComponent(filePath);
                if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
                const userDataPath = app.getPath('userData');
                const normalizedFilePath = path.normalize(filePath);
                const _projectsBaseG3 = getProjectsBasePath();
                if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBaseG3))) {
                  throw new Error(`访问路径超出允许范围: ${filePath}`);
                }
                if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
                imageBuffer = fs.readFileSync(normalizedFilePath);
                const ext = path.extname(normalizedFilePath).toLowerCase();
                mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              } else if (imageUrl.startsWith('data:image/')) {
                const base64Data = imageUrl.split(',')[1];
                if (!base64Data) throw new Error('Base64 Data URL 格式无效');
                imageBuffer = Buffer.from(base64Data, 'base64');
                const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
                mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              } else {
                throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
              }
            } catch (err: any) {
              throw new Error(`Grok video3 图生视频图片处理失败: ${err.message || err}`);
            }
            if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
              imageUrlsG3.push(preferDirectOssUrlForThirdPartyImageRef(processed));
            }
          }
          if (imageUrlsG3.length === 0) throw new Error('图生视频需要至少一张有效图片');
          payload = {
            prompt: String(prompt || '').trim(),
            aspectRatio: aspectG3Val,
            imageUrls: imageUrlsG3,
            resolution: resG3Val,
            duration: durG3Sec,
          };
          apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-g/image-to-video`;
          console.log(
            '[视频生成] Grok video3 图生视频 请求体:',
            JSON.stringify({ ...payload, imageUrls: imageUrlsG3.map((u) => (u.length > 90 ? `${u.slice(0, 90)}…` : u)) }, null, 2),
          );
        } else {
          payload = {
            prompt: String(prompt || '').trim(),
            aspectRatio: aspectG3Val,
            resolution: resG3Val,
            duration: durG3Sec,
          };
          apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-g/text-to-video`;
          console.log('[视频生成] Grok video3 文生视频 请求体:', JSON.stringify(payload, null, 2));
        }
      } else if (isGrok3StableModel) {
        const durG3StableSec = normalizeGrok3StableDurationSec(inputDurationGrok3, 10);
        const toProcessG3s = (images || []).slice(0, 7);
        const imageUrlsG3s: string[] = [];
        for (const imageUrl of toProcessG3s) {
          if (!imageUrl) continue;
          let processed = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (!isOurOssOrCdnObjectUrl(imageUrl)) {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                imageBuffer = Buffer.from(response.data);
                mimeType = (response.headers['content-type'] as string) || 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const normalizedFilePath = path.normalize(filePath);
              const _projectsBaseG3s = getProjectsBasePath();
              if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(_projectsBaseG3s))) {
                throw new Error(`访问路径超出允许范围: ${filePath}`);
              }
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`Grok video3 plus 参考图处理失败: ${err.message || err}`);
          }
          if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
            imageUrlsG3s.push(preferDirectOssUrlForThirdPartyImageRef(processed));
          }
        }
        if (imageUrlsG3s.length === 0) throw new Error('参考图生视频需要至少一张有效图片');
        payload = {
          imageUrls: imageUrlsG3s,
          prompt: String(prompt || '').trim(),
          duration: String(durG3StableSec),
          resolution: '720p',
        };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-g-official/reference-to-video`;
        console.log(
          '[视频生成] Grok video3（稳定版）参考图生视频 请求体:',
          JSON.stringify({ ...payload, imageUrls: imageUrlsG3s.map((u) => (u.length > 90 ? `${u.slice(0, 90)}…` : u)) }, null, 2),
        );
      } else if (isSeedanceModel) {
        // Seedance 2.0 Fast / Mini 多模态：sparkvideo-2.0-{fast|mini}/multimodal-video
        const resVal = coerceSeedanceResolution(inputResolutionSeedance, model);
        const durVal = String(normalizeSeedanceDurationSec(inputDurationSeedance, 10));
        const imageUrlsSd: string[] = [];
        for (const imageUrl of (images || []).slice(0, 9)) {
          if (!imageUrl) continue;
          let processed = imageUrl;
          try {
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              if (!isOurOssOrCdnObjectUrl(imageUrl)) {
                const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
                const imageBuffer = Buffer.from(response.data);
                const mimeType = (response.headers['content-type'] as string) || 'image/png';
                processed = await this.uploadImageToOSS(imageBuffer, mimeType);
              }
            } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath = imageUrl.startsWith('local-resource://') ? imageUrl.replace(/^local-resource:\/\//, '') : imageUrl.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              const normalizedFilePath = path.normalize(filePath);
              const projectsBaseSd = getProjectsBasePath();
              if (!normalizedFilePath.startsWith(path.normalize(userDataPath)) && !normalizedFilePath.startsWith(path.normalize(projectsBaseSd))) {
                throw new Error(`访问路径超出允许范围: ${filePath}`);
              }
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              const imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else if (imageUrl.startsWith('data:image/')) {
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              const imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              const mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              processed = await this.uploadImageToOSS(imageBuffer, mimeType);
            } else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (err: any) {
            throw new Error(`Seedance 多模态图片处理失败: ${err.message || err}`);
          }
          if (processed && (processed.startsWith('http://') || processed.startsWith('https://'))) {
            imageUrlsSd.push(preferDirectOssUrlForThirdPartyImageRef(processed));
          }
        }

        const ensureAudioRemoteSd = async (url: string): Promise<string> => {
          if (url.startsWith('http://') || url.startsWith('https://')) {
            if (isOurOssOrCdnObjectUrl(url)) {
              return preferDirectOssUrlForThirdPartyImageRef(url);
            }
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 60000, proxy: false });
            const ct = res.headers['content-type'] || '';
            const mimeType = ct.includes('wav') ? 'audio/wav' : ct.includes('ogg') ? 'audio/ogg' : ct.includes('m4a') ? 'audio/mp4' : 'audio/mpeg';
            return this.uploadAudioToOSS(Buffer.from(res.data), mimeType);
          }
          if (url.startsWith('local-resource://') || url.startsWith('file://')) {
            return this.uploadLocalAudioToOSS(url);
          }
          if (url.startsWith('data:audio/')) {
            const m = url.match(/^data:audio\/(\w+);base64,(.+)$/);
            const buf = Buffer.from(m ? m[2] : '', 'base64');
            const mime = m ? `audio/${m[1]}` : 'audio/mpeg';
            return this.uploadAudioToOSS(buf, mime);
          }
          return url;
        };

        const videoUrlsSd: string[] = [];
        const refVideoSd = String(inputReferenceVideoUrl || '').trim();
        if (isSeedanceMiniModel && refVideoSd) {
          videoUrlsSd.push(await this.prepareWanAnimateVideoRemoteUrl(refVideoSd));
        }

        const audioUrlsSd: string[] = [];
        const refAudioSd = String(inputAudioUrl || '').trim();
        if (isSeedanceMiniModel && refAudioSd) {
          audioUrlsSd.push(await ensureAudioRemoteSd(refAudioSd));
        }

        payload = {
          prompt: String(prompt || '').trim(),
          resolution: resVal,
          duration: durVal,
          imageUrls: imageUrlsSd,
          videoUrls: videoUrlsSd,
          audioUrls: audioUrlsSd,
          generateAudio: true,
          ratio: 'adaptive',
          realPersonMode: true,
          ...(isSeedanceMiniModel ? { conversionSlots: ['all'] as string[] } : {}),
          returnLastFrame: false,
          seed: -1,
        };
        apiEndpoint = isSeedanceMiniModel
          ? `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video/sparkvideo-2.0-mini/multimodal-video`
          : `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video/sparkvideo-2.0-fast/multimodal-video`;
        const seedanceLabel = isSeedanceMiniModel ? 'Seedance 2.0 Mini' : 'Seedance 2.0 Fast';
        console.log(
          `[视频生成] ${seedanceLabel} 多模态 请求体:`,
          JSON.stringify(
            {
              ...payload,
              imageUrls: imageUrlsSd.map((u) => (u.length > 90 ? `${u.slice(0, 90)}…` : u)),
              videoUrls: videoUrlsSd.map((u) => (u.length > 90 ? `${u.slice(0, 90)}…` : u)),
              audioUrls: audioUrlsSd.map((u) => (u.length > 90 ? `${u.slice(0, 90)}…` : u)),
            },
            null,
            2,
          ),
        );
      } else if (isWan26FlashModel) {
        // 万相2.6 图生视频 Flash：仅图生视频，https://www.runninghub.cn/openapi/v2/alibaba/wan-2.6/image-to-video-flash
        // 参数：prompt(必填), negativePrompt, imageUrl(必填), audioUrl(可选), resolution(720p|1080p), duration(2-15), shotType, enablePromptExpansion, enableAudio
        const imageUrl = images && images.length > 0 ? images[0] : '';
        if (!imageUrl) throw new Error('图生视频模式需要至少一张图片');
        const shotType = inputShotType === 'multi' ? 'multi' : 'single';
        const resolutionWan26 = inputResolutionWan26 === '720p' ? '720p' : '1080p';
        const flashDuration = (durationWan26Flash && /^([2-9]|1[0-5])$/.test(durationWan26Flash)) ? durationWan26Flash : '5';
        let processedImageUrl = imageUrl;
        let imageBuffer: Buffer;
        let mimeType = 'image/png';
        try {
          if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            if (isOurOssOrCdnObjectUrl(imageUrl)) {
              processedImageUrl = imageUrl;
            } else {
              const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
              imageBuffer = Buffer.from(response.data);
              mimeType = (response.headers['content-type'] as string) || 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            }
          } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
            let filePath = imageUrl.startsWith('local-resource://')
              ? imageUrl.replace(/^local-resource:\/\//, '')
              : imageUrl.replace(/^file:\/\//, '');
            if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
            filePath = decodeURIComponent(filePath);
            if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
            const userDataPath = app.getPath('userData');
            const projectsBaseV3 = getProjectsBasePath();
            const normalizedFilePath = path.normalize(filePath);
            const allowedV3 = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBaseV3));
            if (!allowedV3) {
              throw new Error(`访问路径超出允许范围: ${filePath}`);
            }
            if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
            imageBuffer = fs.readFileSync(normalizedFilePath);
            const ext = path.extname(normalizedFilePath).toLowerCase();
            mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else if (imageUrl.startsWith('data:image/')) {
            const base64Data = imageUrl.split(',')[1];
            if (!base64Data) throw new Error('Base64 Data URL 格式无效');
            imageBuffer = Buffer.from(base64Data, 'base64');
            const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
            mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else {
            throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
          }
        } catch (err: any) {
          throw new Error(`万相2.6 Flash 图生视频图片处理失败: ${err.message || err}`);
        }
        if (!processedImageUrl || (!processedImageUrl.startsWith('http://') && !processedImageUrl.startsWith('https://'))) {
          throw new Error('图片上传失败，请检查图片格式和网络连接');
        }
        payload = {
          prompt: prompt || '',
          negativePrompt: negativePrompt || '',
          imageUrl: processedImageUrl,
          audioUrl: '',
          resolution: resolutionWan26,
          duration: flashDuration,
          shotType,
          enablePromptExpansion: inputEnablePromptExpansion === true,
          enableAudio: inputEnableAudio !== false,
        };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/alibaba/wan-2.6/image-to-video-flash`;
        console.log('[视频生成] 万相2.6 Flash 图生视频 请求体:', JSON.stringify({ ...payload, imageUrl: processedImageUrl.substring(0, 80) + '...' }, null, 2));
      } else if (isRhartV31ProOfficialI2vModel) {
        // Veo 3.1 Pro（官方）图生视频：https://www.runninghub.cn/openapi/v2/rhart-video-v3.1-pro-official/image-to-video
        // 参数：prompt(必填), imageUrl(必填), resolution(720p|1080p|4k), duration(4|6|8), generateAudio(boolean)
        const imageUrl = images && images.length > 0 ? images[0] : '';
        let processedImageUrl = imageUrl;
        let imageBuffer: Buffer;
        let mimeType = 'image/png';
        try {
          if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            if (isOurOssOrCdnObjectUrl(imageUrl)) {
              processedImageUrl = imageUrl;
            } else {
              const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
              imageBuffer = Buffer.from(response.data);
              mimeType = (response.headers['content-type'] as string) || 'image/png';
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
            }
          } else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
            let filePath = imageUrl.replace(/^local-resource:\/\//, '').replace(/^file:\/\//, '');
            filePath = decodeURIComponent(filePath);
            if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
            if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.substring(1);
            const normalizedFilePath = path.normalize(filePath);
            const userDataPath = app.getPath('userData');
            const projectsBase = getProjectsBasePath();
            const allowed = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBase));
            if (!allowed || !fs.existsSync(normalizedFilePath)) throw new Error(allowed ? `文件不存在: ${normalizedFilePath}` : `访问路径超出允许范围: ${filePath}`);
            imageBuffer = fs.readFileSync(normalizedFilePath);
            const fileExt = path.extname(normalizedFilePath).toLowerCase();
            mimeType = fileExt === '.jpg' || fileExt === '.jpeg' ? 'image/jpeg' : fileExt === '.png' ? 'image/png' : fileExt === '.webp' ? 'image/webp' : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else if (imageUrl.startsWith('data:image/')) {
            const base64Data = imageUrl.split(',')[1];
            if (!base64Data) throw new Error('Base64 Data URL 格式无效');
            imageBuffer = Buffer.from(base64Data, 'base64');
            const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
            mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
          } else {
            throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
          }
        } catch (error: any) {
          console.error('[视频生成] Veo 3.1 Pro（图生）处理图片失败:', error.message || error);
          throw new Error(`处理图片失败: ${error.message || error}`);
        }
        if (!processedImageUrl || (!processedImageUrl.startsWith('http://') && !processedImageUrl.startsWith('https://'))) {
          throw new Error('imageUrl 必须为可公网访问的 HTTP/HTTPS URL');
        }
        const validDuration = durationVeo31ProOfficial === '6' || durationVeo31ProOfficial === '8' ? durationVeo31ProOfficial : '4';
        const validResolution = inputResolutionRhartV31 === '720p' || inputResolutionRhartV31 === '1080p' || inputResolutionRhartV31 === '4k' ? inputResolutionRhartV31 : '720p';
        const validAspectRatio = aspect_ratio === '16:9' || aspect_ratio === '9:16' ? aspect_ratio : '16:9';
        payload = {
          prompt,
          imageUrl: processedImageUrl,
          lastImageUrl: '',
          negativePrompt: '',
          seed: '',
          aspectRatio: validAspectRatio,
          resolution: validResolution,
          duration: validDuration,
          generateAudio: generateAudioVeo31ProOfficial === true,
        };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-v3.1-pro-official/image-to-video`;
        console.log('[视频生成] Veo 3.1 Pro（图生）请求体:', JSON.stringify({ ...payload, imageUrl: processedImageUrl.substring(0, 80) + '...' }, null, 2));
      } else if (model === 'sora-2-pro' && !isImageToVideo && sora2Channel !== 'core') {
        // Sora2 Pro 文生视频（插件算力）：https://www.runninghub.cn/openapi/v2/rhart-video-s/text-to-video-pro
        const validDuration = duration === '25' ? '25' : '15';
        const validAspectRatio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        payload = {
          prompt,
          duration: validDuration,
          aspectRatio: validAspectRatio,
          storyboard: false,
        };
        apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-s/text-to-video-pro`;
        console.log('[视频生成] Sora2 Pro 文生视频(插件) 请求体:', JSON.stringify(payload, null, 2));
      } else if ((isSora2Model || isSora2ProModel) && sora2Channel === 'core') {
        // Sora2 核心算力：BLTCY API POST /v2/videos/generations
        // 注意：实际 API 的 seconds 仅支持 '4'|'8'|'12'（与 OpenAPI 文档 10/15/25 不一致），需映射
        const validAspectRatio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9';
        const mapToSeconds = (d: string): '4' | '8' | '12' => {
          const n = parseInt(d, 10);
          if (n <= 6) return '4';
          if (n <= 10) return '8';
          return '12';
        };
        const validDuration = mapToSeconds(duration);
        payload = {
          prompt,
          model,
          aspect_ratio: validAspectRatio,
          hd: isSora2ProModel ? hd : false,
          duration: validDuration,
        };
        if (notify_hook?.trim()) (payload as Record<string, unknown>).notify_hook = notify_hook.trim();
        if (watermark !== undefined) (payload as Record<string, unknown>).watermark = watermark;
        if (isPrivate !== undefined) (payload as Record<string, unknown>).private = isPrivate;
        if (isImageToVideo && images && images.length > 0) {
          // OpenAPI 要求 images 数组（支持 url、base64），不使用 imageUrl
          const processedImageUrl = await this.processImageToOssUrl(images[0]);
          (payload as Record<string, unknown>).images = [processedImageUrl];
        }
        apiEndpoint = `${this.apiBaseUrl}/v2/videos/generations`;
        console.log('[视频生成] Sora2 核心算力 请求体:', JSON.stringify(payload, null, 2));
      } else if (isSora2Model) {
        // sora-2 模型参数格式
        if (isImageToVideo) {
          // 图生视频模式：需要先处理图片 URL
          // 注意：sora-2 图生视频只支持 1 张图片，使用 imageUrl 参数
          const imageUrl = images && images.length > 0 ? images[0] : '';
          if (!imageUrl) {
            throw new Error('图生视频模式需要至少一张图片');
          }
          
          // 处理图片 URL：无论是什么格式，都先上传到阿里云 OSS，获取公网 URL
          // 这是为了确保所有图片都通过 OSS 中转，保证 API 调用的稳定性
          let processedImageUrl = imageUrl;
          let imageBuffer: Buffer;
          let mimeType = 'image/png';
          
          try {
            // 0. 检查是否已经是 OSS URL，如果是则直接使用，避免重复上传
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              // 检查是否是我们的 OSS URL
              if (isOurOssOrCdnObjectUrl(imageUrl)) {
                console.log(`[视频生成] sora-2 图生视频：检测到已经是 OSS URL，直接使用: ${imageUrl}`);
                processedImageUrl = imageUrl;
                // 跳过后续处理，直接使用这个 URL
              } else {
                // 是其他 HTTP/HTTPS URL，需要下载后上传到 OSS
                console.log(`[视频生成] sora-2 图生视频：检测到 HTTP/HTTPS URL，先下载图片，然后上传至香港OSS...`);
                
                // 使用已导入的 axios 下载图片
                const response = await axios.get(imageUrl, {
                  responseType: 'arraybuffer',
                  timeout: 30000, // 30秒超时
                });
                
                imageBuffer = Buffer.from(response.data);
                
                // 从响应头获取 MIME 类型
                const contentType = response.headers['content-type'] || 'image/png';
                mimeType = contentType;
                
                // 统一上传到 OSS
                processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
                console.log(`[视频生成] sora-2 图生视频：图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
              }
            }
            // 1. 处理本地文件路径（local-resource:// 或 file://）
            else if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              let filePath: string;
              
              if (imageUrl.startsWith('local-resource://')) {
                filePath = imageUrl.replace(/^local-resource:\/\//, '');
                filePath = decodeURIComponent(filePath);
                
                // 如果路径像 "c/Users"，修正为 "C:/Users"
                if (filePath.match(/^[a-zA-Z]\//)) {
                  filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
                }
              } else {
                // file:// 协议
                filePath = imageUrl.replace(/^file:\/\//, '');
                if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
                  filePath = filePath.substring(1);
                }
                filePath = decodeURIComponent(filePath);
              }
              
              const userDataPath = app.getPath('userData');
              const projectsBaseV4 = getProjectsBasePath();
              const normalizedFilePath = path.normalize(filePath);
              const allowedV4 = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBaseV4));
              if (!allowedV4) {
                throw new Error(`访问路径超出允许范围: ${filePath}`);
              }
              if (!fs.existsSync(normalizedFilePath)) {
                throw new Error(`文件不存在: ${normalizedFilePath}`);
              }
              
              // 读取文件 Buffer
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const fileExt = path.extname(normalizedFilePath).toLowerCase();
              if (fileExt === '.jpg' || fileExt === '.jpeg') {
                mimeType = 'image/jpeg';
              } else if (fileExt === '.png') {
                mimeType = 'image/png';
              } else if (fileExt === '.webp') {
                mimeType = 'image/webp';
              }
              
              console.log(`[视频生成] sora-2 图生视频：检测到本地图片，正在上传至香港OSS...`);
              
              // 统一上传到 OSS
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
              console.log(`[视频生成] sora-2 图生视频：图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
            } 
            // 2. 处理 Base64 Data URL
            else if (imageUrl.startsWith('data:image/')) {
              console.log(`[视频生成] sora-2 图生视频：检测到 Base64 Data URL，转换为 Buffer 后上传至香港OSS...`);
              
              // 提取 Base64 数据：使用 split(',')[1] 获取 base64 部分
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) {
                throw new Error('Base64 Data URL 格式无效：无法提取 base64 数据');
              }
              
              // 使用 Buffer.from 将 base64 字符串转换为二进制 Buffer
              imageBuffer = Buffer.from(base64Data, 'base64');
              
              console.log(`[视频生成] Base64 数据已转换为 Buffer，大小: ${imageBuffer.length} bytes`);
              
              // 从 Data URL 中提取 MIME 类型
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              if (mimeMatch) {
                const imageType = mimeMatch[1];
                mimeType = `image/${imageType}`;
                console.log(`[视频生成] 检测到 MIME 类型: ${mimeType}`);
              } else {
                // 如果没有匹配到，默认使用 png
                mimeType = 'image/png';
                console.log(`[视频生成] 未检测到 MIME 类型，使用默认: ${mimeType}`);
              }
              
              // 统一上传到 OSS
              processedImageUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
              console.log(`[视频生成] sora-2 图生视频：图片上传成功，OSS 公网 URL: ${processedImageUrl}`);
            }
            // 3. 其他格式不支持
            else {
              throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
            }
          } catch (error: any) {
            console.error(`[视频生成] sora-2 图生视频：处理图片失败:`, error.message || error);
            throw new Error(`处理图片失败: ${error.message || error}`);
          }
          
          // 验证 imageUrl 必须是 HTTP/HTTPS URL 格式
          if (!processedImageUrl) {
            throw new Error('imageUrl 不能为空');
          }
          
          // 检查 URL 格式：必须是 HTTP/HTTPS URL
          const isValidHttpUrl = processedImageUrl.startsWith('http://') || processedImageUrl.startsWith('https://');
          
          if (!isValidHttpUrl) {
            // 不是 HTTP/HTTPS URL，说明上传失败
            if (processedImageUrl.startsWith('local-resource://') || processedImageUrl.startsWith('file://')) {
              throw new Error('图片上传失败，请检查图片格式和网络连接，或稍后重试。如果问题持续，请检查 OSS 配置。');
            } else {
              throw new Error(`imageUrl 格式无效，必须是 HTTP/HTTPS URL，当前格式: ${processedImageUrl.substring(0, 100)}`);
            }
          }
          
          // 构建新的 API 请求
          // 请求地址：https://www.runninghub.cn/openapi/v2/rhart-video-s/image-to-video
          // 参数限制：duration 仅支持 "10" 或 "15"（字符串），aspectRatio 仅支持 "9:16" 或 "16:9"（字符串）
          const validDuration = duration === '10' || duration === '15' ? String(duration) : '10';
          const validAspectRatio = aspect_ratio === '9:16' || aspect_ratio === '16:9' ? String(aspect_ratio) : '16:9';
          
          // 构建请求体，字段顺序与 API 文档示例保持一致
          payload = {
            prompt: prompt,
            duration: validDuration, // 确保是字符串类型，只支持 "10" 或 "15"
            imageUrl: processedImageUrl, // OSS 公网 URL（由于权限是公共读，RunningHub能直接拉取）
            aspectRatio: validAspectRatio, // 确保是字符串类型，只支持 "9:16" 或 "16:9"
          };
          
          // 新的 API 端点
          apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-s/image-to-video`;
          
          // 日志确认：确保使用的是 OSS URL，而不是 Base64
          console.log(`[视频生成] sora-2 图生视频：最终请求体（imageUrl 已替换为 OSS URL）:`, JSON.stringify({
            prompt: prompt,
            duration: validDuration,
            imageUrl: processedImageUrl, // 完整 URL，用于调试
            aspectRatio: validAspectRatio,
          }, null, 2));
        } else {
          // 文生视频模式（保持原有逻辑）
          payload = {
            prompt,
            duration: String(duration === '10' || duration === '15' ? duration : '10'), // 确保是字符串类型，只支持 "10" 或 "15"
            aspectRatio: String(aspect_ratio === '9:16' || aspect_ratio === '16:9' ? aspect_ratio : '16:9'), // 确保是字符串类型，只支持 "9:16" 或 "16:9"
          };
          
          // runninghub-api 文生视频端点
          apiEndpoint = `${RUNNINGHUB_OPENAPI_V2_BASE}/rhart-video-s/text-to-video`;
        }
      } else {
        // 全能视频V3.1-pro / 全能视频V3.1-fast 首尾帧 仅走 RunningHub，若落入此处说明未命中上方分支（多为旧构建）
        if (String(model) === 'rhart-v3.1-pro' || String(model) === 'rhart-v3.1-fast-se' || String(model) === 'rhart-v3.1-pro-se') {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: {
              error: '该模型需使用插件算力接口。请完全退出应用后重新打开，或重新执行 npm run build:main 后重启。',
            },
          });
          return;
        }
        // 其他模型使用原有格式（BLTCY 核心算力）
        payload = {
          prompt,
          model,
          aspect_ratio,
        };

        // sora-2-pro 系列参数（使用 bltcy-api）
        if (model === 'sora-2-pro') {
          payload.hd = hd;
          payload.duration = duration;
        }

        apiEndpoint = `${this.apiBaseUrl}/v2/videos/generations`;
      }

      // 注意：sora-2、全能视频S-图生视频-pro、万相2.6、万相2.6 Flash、全能V3.1-fast/pro 图生/首尾帧已在上面单独处理，这里只处理其他模型（如 kling）
      if (isImageToVideo && !isSora2Model && !isWan26Model && !isWan26FlashModel && !isRhartV31FastModel && !isRhartV31FastSEModel && !isRhartV31ProSEModel && !isGrok3Model) {
        // 处理图片URL：将 local-resource:// 和 file:// 上传到 OSS
        const processedImages = await Promise.all(
          images!.slice(0, 10).map(async (imageUrl) => {
            // 如果是 local-resource:// 或 file://，转换为 base64
            if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
              try {
                let filePath: string;
                
                if (imageUrl.startsWith('local-resource://')) {
                  filePath = imageUrl.replace(/^local-resource:\/\//, '');
                  filePath = decodeURIComponent(filePath);
                  
                  // 如果路径像 "c/Users"，修正为 "C:/Users"
                  if (filePath.match(/^[a-zA-Z]\//)) {
                    filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
                  }
                } else {
                  // file:// 协议
                  filePath = imageUrl.replace(/^file:\/\//, '');
                  if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
                    filePath = filePath.substring(1);
                  }
                  filePath = decodeURIComponent(filePath);
                }
                
                const userDataPath = app.getPath('userData');
                const projectsBaseV5 = getProjectsBasePath();
                const normalizedFilePath = path.normalize(filePath);
                const allowedV5 = normalizedFilePath.startsWith(path.normalize(userDataPath)) || normalizedFilePath.startsWith(path.normalize(projectsBaseV5));
                if (!allowedV5) {
                  console.error(`[视频生成] 访问路径超出允许范围: ${filePath}`);
                  return imageUrl;
                }
                if (!fs.existsSync(normalizedFilePath)) {
                  console.error(`[视频生成] 文件不存在: ${normalizedFilePath}`);
                  return imageUrl; // 返回原URL，让API处理
                }
                
                // 读取文件并上传到 OSS
                const imageBuffer = fs.readFileSync(normalizedFilePath);
                const fileExt = path.extname(normalizedFilePath).toLowerCase();
                let mimeType = 'image/png';
                if (fileExt === '.jpg' || fileExt === '.jpeg') {
                  mimeType = 'image/jpeg';
                } else if (fileExt === '.png') {
                  mimeType = 'image/png';
                } else if (fileExt === '.webp') {
                  mimeType = 'image/webp';
                }
                
                // 上传到 OSS，获取公网 URL
                const ossUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
                console.log(`[视频生成] 将本地图片上传到 OSS: ${normalizedFilePath} -> ${ossUrl}`);
                return ossUrl;
              } catch (error: any) {
                console.error(`[视频生成] 转换本地图片失败: ${imageUrl}`, error.message || error);
                return imageUrl; // 返回原URL，让API处理
              }
            }
            // HTTP/HTTPS URL：如果是 OSS URL，直接返回；如果是其他 URL，下载后上传到 OSS
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              // 检查是否是我们的 OSS URL
              if (isOurOssOrCdnObjectUrl(imageUrl)) {
                // 已经是 OSS URL，直接返回，避免重复上传
                console.log(`[视频生成] 检测到已经是 OSS URL，直接使用: ${imageUrl}`);
                return imageUrl;
              } else {
                // 是其他 HTTP/HTTPS URL，下载后上传到 OSS
                try {
                  console.log(`[视频生成] 检测到其他 HTTP/HTTPS URL，下载后上传到 OSS: ${imageUrl}`);
                  const response = await axios.get(imageUrl, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                  });
                  
                  const imageBuffer = Buffer.from(response.data);
                  const contentType = response.headers['content-type'] || 'image/png';
                  const mimeType = contentType;
                  
                  const ossUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
                  console.log(`[视频生成] 将 HTTP/HTTPS 图片上传到 OSS: ${ossUrl}`);
                  return ossUrl;
                } catch (error: any) {
                  console.error(`[视频生成] 下载并上传 HTTP/HTTPS 图片失败: ${error.message || error}`);
                  return imageUrl; // 失败时返回原 URL
                }
              }
            } else if (imageUrl.startsWith('data:image/')) {
              // Base64 Data URL：转换为 Buffer 后上传到 OSS
              const base64Data = imageUrl.split(',')[1];
              if (!base64Data) {
                console.warn(`[视频生成] Base64 Data URL 格式无效，返回原 URL: ${imageUrl.substring(0, 50)}`);
                return imageUrl;
              }
              
              const imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = imageUrl.match(/^data:image\/(\w+);base64,/);
              const mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
              
              try {
                const ossUrl = await this.uploadImageToOSS(imageBuffer, mimeType);
                console.log(`[视频生成] 将 Base64 图片上传到 OSS: ${ossUrl}`);
                return ossUrl;
              } catch (error: any) {
                console.error(`[视频生成] 上传 Base64 图片到 OSS 失败: ${error.message || error}`);
                return imageUrl; // 失败时返回原 URL
              }
            }
            // 其他格式，直接返回
            return imageUrl;
          })
        );
        
        payload.images = processedImages;
      }
      // 注意：sora-2 图生视频模式的图片 URL 已在上面处理，直接使用 imageUrl 参数
      if (notify_hook) payload.notify_hook = notify_hook;
      if (typeof watermark === 'boolean') payload.watermark = watermark;
      if (typeof isPrivate === 'boolean') payload.private = isPrivate;

      console.log(
        `[视频生成] 模式: ${isImageToVideo ? '图生视频' : '文生视频'}, 模型: ${model}, 比例: ${aspect_ratio}${
          isWan26Model
            ? `, 时长: ${duration || '5'}, 镜头: ${inputShotType || 'single'}${isImageToVideo ? `, 分辨率: ${inputResolutionWan26 || '1080p'}` : ''}`
            : isRhartV31ProModel || isRhartV31ProSEModel
            ? `, 比例: ${aspect_ratio || '16:9'}`
            : isGrok3Model
            ? `, 比例: ${aspect_ratio || '16:9'}, 时长: ${inputDurationGrok3 || '10'}s, 分辨率: 720p`
            : isRhartV31FastSEModel || isRhartV31FastModel
            ? `, 比例: ${aspect_ratio || '16:9'}, 分辨率: ${inputResolutionRhartV31 || '1080p'}`
            : isWan26FlashModel
            ? `, 时长: ${durationWan26Flash || '5'}s, 镜头: ${inputShotType || 'single'}, 分辨率: ${inputResolutionWan26 || '1080p'}, 音频: ${inputEnableAudio !== false}`
            : isKlingModel
            ? `, 自由度: ${guidanceScale || 0.5}, 声音: ${sound || 'false'}, 时长: ${duration || '5'}`
            : `, 时长: ${duration}, 高清: ${hd}`
        }, 参考图数量: ${isImageToVideo ? images!.length : 0}`,
      );

      // 发送 PROCESSING 状态
      onStatus({
        nodeId,
        status: 'PROCESSING',
      });

      const videoBillingId = buildVideoBillingModelId(model, input as Record<string, unknown>);
      const fcVideoSessionId = randomUUID();
      let ledgerVideoId: string | null = null;
      let data: Record<string, unknown>;
      try {
        if (apiEndpoint.includes('/openapi/v2')) {
          ledgerVideoId = await this.ensureLedgerVideoTask(nodeId, videoBillingId, videoInput, model);
          data = await rhPostChargeVideo(
            apiEndpoint,
            payload as Record<string, unknown>,
            fcVideoSessionId,
            { billingModelId: videoBillingId },
            ledgerVideoId,
          );
          fcChargedTaskId = ledgerVideoId || fcVideoSessionId;
        } else {
          const fwdPath = this.bltcyForwardPath(apiEndpoint);
          const sub = await fcForwardRequest(
            fcVideoSessionId,
            'video',
            'charge',
            {
              provider: 'bltcy',
              path: fwdPath,
              method: 'POST',
              body: payload as Record<string, unknown>,
            },
            { billingModelId: videoBillingId },
          );
          data = sub.data;
          fcChargedTaskId = fcVideoSessionId;
        }
      } catch (submitErr: unknown) {
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: buildFcErrorPayload(submitErr, '提交视频任务失败'),
        });
        return;
      }

      console.log('[视频生成] 原始响应:', JSON.stringify(data, null, 2));

      // 第三方响应结构各异，统一按宽松结构解析
      const d = data as Record<string, any>;

      // runninghub-api kling-v2.6-pro 可能直接返回视频 URL 或返回 task_id
      // 其他模型返回格式：{ task_id, ... }
      let taskId: string | undefined;
      let videoUrl: string | undefined;
      
      if (isKlingModel) {
        // runninghub-api 响应格式（文档未明确说明，先尝试多种可能）
        // 可能直接返回视频 URL，也可能返回 task_id 需要轮询
        if (d.code !== undefined && d.code !== 0) {
          throw new Error(d.message || `API 返回错误: code=${d.code}`);
        }
        
        // 尝试提取视频 URL（可能直接返回）
        videoUrl = d.videoUrl || 
                  d.video_url || 
                  d.url || 
                  d.data?.videoUrl ||
                  d.data?.video_url ||
                  d.data?.url ||
                  d.data?.output ||
                  (Array.isArray(d.data) && d.data[0]?.url);
        
        // 如果没有视频 URL，尝试提取 task_id（可能需要轮询）
        if (!videoUrl) {
          taskId = d.taskId || 
                  d.task_id || 
                  d.data?.taskId ||
                  d.data?.task_id;
        }
      } else if (isSora2Model && isImageToVideo) {
        // sora-2 图生视频接口响应格式（https://www.runninghub.cn/openapi/v2/rhart-video-s/image-to-video）
        // 可能返回格式：{ taskId, ... } 或 { task_id, ... }
        taskId = d.taskId ||
                 d.task_id ||
                 d.data?.taskId ||
                 d.data?.task_id;
        videoUrl = d.videoUrl ||
                  d.video_url ||
                  d.url ||
                  d.data?.videoUrl ||
                  d.data?.video_url ||
                  d.data?.url ||
                  d.data?.output ||
                  (Array.isArray(d.data) && d.data[0]?.url);
        
        // 如果获取到 taskId，存储到 store 中以便后续追踪
        if (taskId) {
          console.log(`[视频生成] sora-2 图生视频：获取到 taskId: ${taskId}，已存储到状态中`);
          // 可以将 taskId 存储到 store 中，但通常通过 onStatus 回调传递给前端即可
        }
      } else if (isWan26Model || isWan26FlashModel || isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProModel || isRhartV31ProSEModel || isGrok3Model || isGrok3StableModel || isSeedanceModel || isSora2ProModel || isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel) {
        taskId = d.taskId || d.task_id || d.data?.taskId || d.data?.task_id;
        videoUrl = d.results?.[0]?.url || d.data?.results?.[0]?.url || d.data?.output || d.url || d.data?.url;
      } else {
        // 其他模型响应格式
        taskId = d.task_id || d.taskId;
        videoUrl = d.data?.output ||
                  d.video_url || 
                  d.url || 
                  (Array.isArray(d.data) && d.data[0]?.url);
      }

      // 若首次响应即返回 FAILED（如系统繁忙 1011），立即发送 ERROR 并退出，避免进入轮询后进度条继续跑
      const isRunningHubModel = !isSora2Core && (isKlingModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isSora2Model || isSora2ProModel || isRhartV31ProOfficialI2vModel || isWan26Model || isWan26FlashModel || isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProModel || isRhartV31ProSEModel || isGrok3Model || isGrok3StableModel || isSeedanceModel || isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel);
      if ((isRunningHubModel || isSora2Core) && (d.status === 'FAILED' || d.status === 'FAILURE')) {
        const failReason = d.fail_reason || d.errorMessage || d.error || d.message || '视频生成失败';
        const fullReason = d.errorCode ? `[错误码: ${d.errorCode}] ${failReason}` : failReason;
        console.error('[视频生成] 首次响应即失败:', fullReason);
        void tryRefundFcForwardCharge(fcChargedTaskId, 'video', 'submit_status_failed');
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: { error: fullReason, progress: 0, text: `视频生成失败: ${fullReason}` },
        });
        return; // 不进入轮询
      }

      // 如果是 veo、kling、sora-2 或 wan-2.6 且返回了 task_id，需要轮询获取结果；Sora2 核心算力也需轮询
      let successSent = false; // 标记是否已发送 SUCCESS 状态
      if ((isRunningHubModel || isSora2Core) && taskId && !videoUrl) {
        console.log(`[视频生成] ${model} 返回 task_id: ${taskId}，开始轮询...`);
        
        // 轮询配置：SORA2/SORA2 Pro 25 分钟，其他模型 15 分钟
        const totalTimeout = (isSora2Model || isSora2ProModel) ? 25 * 60 * 1000 : 15 * 60 * 1000;
        const startTime = Date.now();
        let attempt = 0;
        let lastPollTime = startTime;
        
        // 统一使用模拟进度引擎（所有视频模型）
        const { createProgressEngine } = await import('../utils/ProgressHelper.js');
        const progressEngine = createProgressEngine('video', startTime);

        onStatus({
          nodeId,
          status: 'PROCESSING',
          payload: {
            progress: progressEngine.getProgress(),
            text: progressEngine.getMessage(),
            taskId: String(taskId),
          },
        });

        // runninghub-api kling、sora-2(插件)、万相2.6 使用通用查询接口；Sora2 核心算力使用 BLTCY 轮询
        const pollEndpoint = isSora2Core
          ? `${this.apiBaseUrl}/v2/videos/generations/${taskId}`
          : usesRhOpenApiV2QueryPoll
            ? `${RUNNINGHUB_OPENAPI_V2_BASE}/query`
            : `${this.apiBaseUrl}/v2/videos/generations/${taskId}`;
        
        // 轮询循环：只有 SUCCESS 或 FAILURE 时才停止
        while (true) {
          // 检查总超时时间
          const elapsed = Date.now() - startTime;
          if (elapsed >= totalTimeout) {
            const timeoutMin = (isSora2Model || isSora2ProModel) ? 25 : 15;
            throw new Error(`轮询超时（${timeoutMin}分钟）：无法获取视频结果，任务 ID: ${taskId}`);
          }
          
          // 更新统一模拟进度条（所有视频模型）
          const currentProgress = progressEngine.getProgress();
          const progressMessage = progressEngine.getMessage();
          
          // 发送进度更新
          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: {
              progress: currentProgress,
              text: progressMessage, // 只显示轮播文字，不显示百分比
              taskId: String(taskId),
            },
          });
          
          // 计算轮询间隔：前 30 秒每 2 秒，之后每 5 秒
          const timeSinceStart = Date.now() - startTime;
          const pollInterval = timeSinceStart < 30000 ? 2000 : 5000;
          
          // 等待到下一次轮询时间
          const timeSinceLastPoll = Date.now() - lastPollTime;
          if (timeSinceLastPoll < pollInterval) {
            await new Promise(resolve => setTimeout(resolve, pollInterval - timeSinceLastPoll));
          }
          
          attempt++;
          lastPollTime = Date.now();
          
          try {
            // runninghub-api 使用 POST 方法查询任务；Sora2 核心算力使用 GET
            let pollResponse;
            if (isSora2Core) {
              const r = await fcForwardRequest(
                `${fcVideoSessionId}:poll:${attempt}`,
                'video',
                'none',
                {
                  provider: 'bltcy',
                  path: this.bltcyForwardPath(pollEndpoint),
                  method: 'GET',
                },
              );
              pollResponse = { data: r.data };
            } else if (usesRhOpenApiV2QueryPoll) {
              // RunningHub OpenAPI v2：经 FC 轮询（billing=none）
              pollResponse = {
                data: await rhQueryPollVideo(String(taskId), `${fcVideoSessionId}:poll:${attempt}`, ledgerVideoId),
              };
            } else {
              const r = await fcForwardRequest(
                `${fcVideoSessionId}:poll:${attempt}`,
                'video',
                'none',
                {
                  provider: 'bltcy',
                  path: this.bltcyForwardPath(pollEndpoint),
                  method: 'GET',
                },
              );
              pollResponse = { data: r.data };
            }
            
            const pollData = (pollResponse.data || {}) as Record<string, any>;
            console.log(`[视频生成] 轮询结果 (第 ${attempt} 次，已用时 ${Math.floor(elapsed / 1000)} 秒):`, JSON.stringify(pollData, null, 2));
            
            // runninghub-api kling-v2.6-pro 和 sora-2 响应格式：{ taskId, status, results, ... }
            // 其他模型响应格式：{ status, ... }
            let status: string | undefined;
            let progress: string | undefined;
            
            if (!isSora2Core && usesRhOpenApiV2QueryPoll) {
              // runninghub-api 响应格式（status 含 SUCCESS / succeed / complete 等）
              status = this.normalizeRunningHubPollStatus(pollData.status);
              
              // 检查是否有错误（在状态转换后检查，避免重复处理）
              // 如果状态已经是 FAILED，会在后面统一处理
              if (status !== 'FAILURE' && pollData.errorCode && pollData.errorCode !== '') {
                // 非 FAILED 状态但有错误码，可能是警告，记录但不抛出
                console.warn(`[视频生成] 检测到错误码: ${pollData.errorCode}, 消息: ${pollData.errorMessage}`);
              }
              
              // runninghub-api 不提供进度百分比，统一使用模拟进度
              // 如果状态是 RUNNING 或 QUEUED，继续使用模拟进度
              if (status === 'IN_PROGRESS' || status === 'NOT_START') {
                // 使用进度引擎的当前值
                const currentProgress = progressEngine.getProgress();
                progress = `${currentProgress}%`;
              } else {
                progress = '100%';
              }
            } else {
              // 其他模型也统一使用模拟进度（废弃真实进度读取）
              status = pollData.status;
              // 使用进度引擎的当前值，而不是从 API 读取
              const currentProgress = progressEngine.getProgress();
              progress = `${currentProgress}%`;
              
              // 对于其他模型，如果状态是 SUCCESS，检查是否有 output
              if (status === 'SUCCESS' && pollData.data?.output) {
                // 提前提取 URL，避免后续逻辑遗漏
                console.log(`[视频生成] 检测到 SUCCESS 状态，提前提取 URL: ${pollData.data.output}`);
              }
            }
            
            // 进度值已通过 progressEngine.getProgress() 获取，无需再次计算
            
            // 尝试从多个可能的字段中获取视频 URL
            let possibleVideoUrl: string | undefined;
            if (isKlingModel) {
              // 可灵 (Kling) 路径：response.data.data.task_result.videos[0].url
              // 也支持 runninghub-api 的 results 格式
              if (pollData.data?.task_result?.videos && Array.isArray(pollData.data.task_result.videos) && pollData.data.task_result.videos.length > 0) {
                possibleVideoUrl = pollData.data.task_result.videos[0]?.url;
                console.log(`[视频生成] kling-v2.6-pro - 从 data.task_result.videos[0].url 提取到视频 URL: ${possibleVideoUrl}`);
              } else if (Array.isArray(pollData.results) && pollData.results.length > 0) {
                // runninghub-api 响应格式：results 数组中包含 url / fileUrl 等
                possibleVideoUrl = this.firstRhMediaUrlFromResultItem(pollData.results[0]);
                console.log(`[视频生成] kling-v2.6-pro - 从 results[0] 提取到视频 URL: ${possibleVideoUrl}`);
              } else {
                console.warn(`[视频生成] kling-v2.6-pro - 未找到视频 URL，完整响应:`, JSON.stringify(pollData, null, 2));
              }
            } else if (isSora2Core) {
              // BLTCY 轮询响应：data.output 或 data.data.output（双层包装）
              possibleVideoUrl = pollData.data?.output ||
                pollData.data?.data?.output ||
                pollData.data?.results?.[0]?.url ||
                pollData.results?.[0]?.url ||
                pollData.output ||
                pollData.url;
              if (possibleVideoUrl) console.log(`[视频生成] Sora2 核心算力 - 提取到视频 URL: ${possibleVideoUrl}`);
            } else if (isSora2Model || isSora2ProModel || isWan26Model || isWan26FlashModel || isRhartV31FastModel || isRhartV31FastSEModel || isRhartV31ProModel || isRhartV31ProSEModel || isGrok3Model || isGrok3StableModel || isSeedanceModel || isHailuo02Model || isHailuo23Model || isHailuo02I2vModel || isHailuo23I2vModel || isKlingVideoO1Model || isKlingVideoO1I2vModel || isKlingVideoO1StartEndModel || isRhVideoStartEndModel || isWanAnimateModel) {
              const resultsArray = Array.isArray(pollData.results) ? pollData.results : pollData.data?.results;
              if (resultsArray && resultsArray.length > 0) {
                possibleVideoUrl = this.firstRhMediaUrlFromResultItem(resultsArray[0]);
                const name = isWanAnimateModel ? 'wan-animate' : isRhVideoStartEndModel ? 'rh-video-start-end' : isRhartV31ProOfficialI2vModel ? 'rhart-v3.1-pro-official-i2v' : isSora2ProModel ? 'sora-2-pro' : isKlingVideoO1StartEndModel ? 'kling-video-o1-start-end' : isKlingVideoO1I2vModel ? 'kling-video-o1-i2v' : isKlingVideoO1Model ? 'kling-video-o1' : isHailuo23I2vModel ? 'hailuo-2.3-i2v-standard' : isHailuo02I2vModel ? 'hailuo-02-i2v-standard' : isHailuo23Model ? 'hailuo-2.3-t2v-standard' : isHailuo02Model ? 'hailuo-02-t2v-standard' : isGrok3StableModel ? 'grok-3-stable' : isSeedanceMiniModel ? 'seedance-2.0-mini' : isSeedanceFastModel ? 'seedance-2.0-fast' : isGrok3Model ? 'grok-video3' : isRhartV31ProSEModel ? 'rhart-v3.1-pro-se' : isRhartV31ProModel ? 'rhart-v3.1-pro' : isRhartV31FastSEModel ? 'rhart-v3.1-fast-se' : isRhartV31FastModel ? 'rhart-v3.1-fast' : isWan26FlashModel ? 'wan-2.6-flash' : isWan26Model ? 'wan-2.6' : 'sora-2';
                console.log(`[视频生成] ${name} - 从 results[0].url 提取到视频 URL: ${possibleVideoUrl}`);
              } else {
                const name = isWanAnimateModel ? 'wan-animate' : isRhVideoStartEndModel ? 'rh-video-start-end' : isRhartV31ProOfficialI2vModel ? 'rhart-v3.1-pro-official-i2v' : isSora2ProModel ? 'sora-2-pro' : isKlingVideoO1StartEndModel ? 'kling-video-o1-start-end' : isKlingVideoO1I2vModel ? 'kling-video-o1-i2v' : isKlingVideoO1Model ? 'kling-video-o1' : isHailuo23I2vModel ? 'hailuo-2.3-i2v-standard' : isHailuo02I2vModel ? 'hailuo-02-i2v-standard' : isHailuo23Model ? 'hailuo-2.3-t2v-standard' : isHailuo02Model ? 'hailuo-02-t2v-standard' : isGrok3StableModel ? 'grok-3-stable' : isSeedanceMiniModel ? 'seedance-2.0-mini' : isSeedanceFastModel ? 'seedance-2.0-fast' : isGrok3Model ? 'grok-video3' : isRhartV31ProSEModel ? 'rhart-v3.1-pro-se' : isRhartV31ProModel ? 'rhart-v3.1-pro' : isRhartV31FastSEModel ? 'rhart-v3.1-fast-se' : isRhartV31FastModel ? 'rhart-v3.1-fast' : isWan26FlashModel ? 'wan-2.6-flash' : isWan26Model ? 'wan-2.6' : 'sora-2';
                console.warn(`[视频生成] ${name} - 未找到视频 URL，完整响应:`, JSON.stringify(pollData, null, 2));
              }
            } else if (isKlingModel) {
              // kling 模型在 SUCCESS 时再次尝试提取 URL
              if (!possibleVideoUrl) {
                // 尝试深层路径：data.data.task_result.videos[0].url
                const deepTaskResult = pollData.data?.data?.task_result;
                const deepVideos = deepTaskResult?.videos;
                if (Array.isArray(deepVideos) && deepVideos.length > 0 && deepVideos[0]?.url) {
                  possibleVideoUrl = deepVideos[0].url;
                  console.log(`[视频生成] kling 模型 - 从 data.data.task_result.videos[0].url 提取到 URL: ${possibleVideoUrl}`);
                } else {
                  // 尝试浅层路径：data.task_result.videos[0].url
                  const taskResult = pollData.data?.task_result;
                  const videos = taskResult?.videos;
                  if (Array.isArray(videos) && videos.length > 0 && videos[0]?.url) {
                    possibleVideoUrl = videos[0].url;
                    console.log(`[视频生成] kling 模型 - 从 data.task_result.videos[0].url 提取到 URL: ${possibleVideoUrl}`);
                  }
                }
              }
            } else {
              // 其他模型响应格式
              possibleVideoUrl = pollData.data?.output || 
                                pollData.video_url || 
                                pollData.url || 
                                (Array.isArray(pollData.data) && pollData.data[0]?.url) ||
                                pollData.result?.video_url || 
                                pollData.result?.url ||
                                pollData.output ||
                                pollData.videoUrl;
            }
            
            console.log(`[视频生成] 最终提取的视频 URL: ${possibleVideoUrl}, 状态: ${status}`);
            
            // 状态闭环：只有 SUCCESS 或 FAILURE 时才停止（RunningHub succeed 等已在 normalizeRunningHubPollStatus 中合并为 SUCCESS）
            const finalStatus = status === 'SUCCESS' ? 'SUCCESS' : status;
            
            if (finalStatus === 'SUCCESS') {
              // 如果是 kling 模型且还没有提取到 URL，再次尝试提取
              // 可灵 (Kling) 路径：response.data.data.task_result.videos[0].url
              if (isKlingModel && !possibleVideoUrl) {
                // 尝试深层路径：data.data.task_result.videos[0].url
                const deepTaskResult = pollData.data?.data?.task_result;
                const deepVideos = deepTaskResult?.videos;
                if (Array.isArray(deepVideos) && deepVideos.length > 0 && deepVideos[0]?.url) {
                  possibleVideoUrl = deepVideos[0].url;
                  console.log(`[视频生成] kling 模型 - 从 data.data.task_result.videos[0].url 提取到 URL: ${possibleVideoUrl}`);
                } else {
                  // 尝试浅层路径：data.task_result.videos[0].url
                  const taskResult = pollData.data?.task_result;
                  const videos = taskResult?.videos;
                  console.log(`[视频生成] kling 模型 - 在 SUCCESS 检查时重新提取 URL，videos:`, JSON.stringify(videos, null, 2));
                  if (Array.isArray(videos) && videos.length > 0 && videos[0]?.url) {
                    possibleVideoUrl = videos[0].url;
                    console.log(`[视频生成] kling 模型 - 从 data.task_result.videos[0].url 提取到 URL: ${possibleVideoUrl}`);
                  }
                }
              }
              
              // 对于所有模型，如果状态是 SUCCESS 但还没有提取到 URL，再次尝试从 data.output 提取
              // 这是为了处理不同 API 平台可能返回的不同格式
              if (!possibleVideoUrl) {
                const r0 = Array.isArray(pollData.results) ? pollData.results[0] : undefined;
                const dr0 = pollData.data && typeof pollData.data === 'object' && Array.isArray((pollData.data as { results?: unknown[] }).results)
                  ? (pollData.data as { results: unknown[] }).results[0]
                  : undefined;
                const fallbackUrl =
                  this.firstRhMediaUrlFromResultItem(r0) ||
                  this.firstRhMediaUrlFromResultItem(dr0) ||
                  (pollData.data as { results?: { url?: string }[] })?.results?.[0]?.url ||
                  pollData.data?.output ||
                  pollData.data?.data?.output ||
                  pollData.output ||
                  pollData.data?.video_url ||
                  pollData.data?.url ||
                  pollData.video_url ||
                  pollData.url;
                if (fallbackUrl) {
                  possibleVideoUrl = fallbackUrl;
                  console.log(`[视频生成] SUCCESS 状态 - 从备用路径提取到 URL: ${possibleVideoUrl}`);
                } else {
                  console.warn(`[视频生成] SUCCESS 状态但未找到 URL，完整响应:`, JSON.stringify(pollData, null, 2));
                  console.warn(`[视频生成] 尝试的路径: data.output=${pollData.data?.output}, output=${pollData.output}, data.video_url=${pollData.data?.video_url}`);
                }
              }
              
              // 状态为 SUCCESS，立即提取视频 URL
              if (possibleVideoUrl) {
                videoUrl = possibleVideoUrl;
                console.log(`[视频生成] 任务状态 SUCCESS，视频 URL: ${videoUrl}`);
                // 自动下载并保存视频到本地（如果 videoUrl 是远程 URL）
                let localPath: string | undefined;
                let finalVideoUrl = videoUrl;
                
                if (videoUrl && (videoUrl.startsWith('http://') || videoUrl.startsWith('https://'))) {
                  try {
                    // 自动下载视频到本地
                    const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
                    // 从 input 中获取项目 ID（如果存在）
                    const projectId = (input as any)?.projectId;
                    const nodeTitle = (input as any)?.nodeTitle || 'video';
                    
                    const downloadedPath = await autoDownloadResource(
                      videoUrl,
                      'video',
                      {
                        resourceType: 'video',
                        nodeId: nodeId,
                        nodeTitle: nodeTitle,
                        projectId: projectId,
                      }
                    );
                    
                    if (downloadedPath) {
                      localPath = downloadedPath;
                      // 使用本地路径作为最终 URL
                      finalVideoUrl = `local-resource://${downloadedPath.replace(/\\/g, '/')}`;
                      console.log(`[视频生成] 视频已自动下载到本地: ${localPath}`);
                    }
                  } catch (downloadError) {
                    console.error(`[视频生成] 自动下载视频失败:`, downloadError);
                    // 下载失败不影响视频显示，继续使用远程 URL
                  }
                }
                
                // 立即发送 SUCCESS 状态，停止进度显示
                onStatus({
                  nodeId,
                  status: 'SUCCESS',
                  payload: {
                    url: finalVideoUrl, // 优先使用本地路径
                    videoUrl: finalVideoUrl,
                    originalVideoUrl: videoUrl, // 保存原始远程 URL
                    localPath: localPath, // 传递本地路径
                    text: `视频生成完成: ${finalVideoUrl}`,
                    taskId: taskId,
                    progress: 100, // 确保进度为 100%
                  },
                });
                successSent = true; // 标记已发送 SUCCESS
                break; // 立即退出轮询循环
              } else {
                // 状态为SUCCESS但没有URL，可能是API返回格式不同，立即再次轮询一次
                console.warn(`[视频生成] 任务状态为 ${status}，但未找到视频 URL`);
                console.warn(`[视频生成] 完整响应数据:`, JSON.stringify(pollData, null, 2));
                console.warn(`[视频生成] data.task_result:`, JSON.stringify(pollData.data?.task_result, null, 2));
                console.warn(`[视频生成] data.task_result.videos:`, JSON.stringify(pollData.data?.task_result?.videos, null, 2));
                // 对于 kling 模型，如果状态是 SUCCESS 但没有 URL，可能是视频还在生成中，继续轮询
                if (isKlingModel) {
                  // 等待 2 秒后继续轮询
                  await new Promise(resolve => setTimeout(resolve, 2000));
                  continue;
                } else {
                  // 其他模型，不等待，立即继续下一次循环
                  continue;
                }
              }
            } else if (status === 'FAILURE' || status === 'FAILED' || pollData.status === 'FAILED') {
              // 状态为 FAILURE 或 FAILED，立即发送 ERROR 并停止轮询，避免进度条继续显示
              let failReason = pollData.fail_reason || pollData.errorMessage || pollData.error || pollData.message || '视频生成失败';
              
              // 对于 runninghub-api，优先使用 errorMessage 和 errorCode
              if (usesRhOpenApiV2QueryPoll) {
                if (pollData.errorMessage) {
                  failReason = pollData.errorMessage;
                  if (pollData.errorCode) {
                    failReason = `[错误码: ${pollData.errorCode}] ${pollData.errorMessage}`;
                  }
                } else if (pollData.errorCode) {
                  failReason = `错误码: ${pollData.errorCode}`;
                }
              }
              
              console.error(`[视频生成] 任务失败: ${failReason}`);
              console.error(`[视频生成] 任务状态详情:`, JSON.stringify(pollData, null, 2));

              void tryRefundFcForwardCharge(fcChargedTaskId, 'video', 'poll_status_failed');
              
              // 发送 ERROR 状态，停止进度条
              onStatus({
                nodeId,
                status: 'ERROR',
                payload: {
                  error: failReason,
                  progress: 0, // 停止进度条
                  text: `视频生成失败: ${failReason}`,
                },
              });
              
              // 退出轮询循环
              break;
            }
            
            // 只有在任务未完成且未发送SUCCESS时才发送进度更新
            if (!successSent && status !== 'SUCCESS' && status !== 'FAILURE' && status !== 'FAILED') {
              // 发送进度更新（统一使用模拟进度引擎）
              const displayProgress = progressEngine.getProgress();
              const progressMessage = progressEngine.getMessage();
              
              onStatus({
                nodeId,
                status: 'PROCESSING',
                payload: {
                  progress: displayProgress,
                  text: progressMessage, // 只显示轮播文字，不显示百分比
                },
              });
              
              if (status === 'NOT_START' || status === 'IN_PROGRESS') {
                // 继续轮询
                console.log(`[视频生成] 任务状态: ${status}, 进度: ${progress}`);
              } else if (status && status !== 'SUCCESS' && status !== 'FAILURE' && status !== 'FAILED') {
                // 未知状态，继续轮询
                console.warn(`[视频生成] 未知任务状态: ${status}，继续轮询...`);
              }
            }
          } catch (pollError: any) {
            // 健壮的错误处理：捕获网络错误并重试
            const errorMessage = pollError?.message || String(pollError);
            const isConnectionError = 
              errorMessage.includes('ECONNRESET') ||
              errorMessage.includes('socket hang up') ||
              errorMessage.includes('ETIMEDOUT') ||
              errorMessage.includes('ECONNREFUSED') ||
              pollError?.code === 'ECONNRESET' ||
              pollError?.code === 'ETIMEDOUT' ||
              pollError?.code === 'ECONNREFUSED';
            
            if (isConnectionError) {
              // 网络连接错误，等待 5 秒后重试
              console.warn(`[视频生成] 轮询网络错误 (第 ${attempt} 次): ${errorMessage}，等待 5 秒后重试...`);
              await new Promise(resolve => setTimeout(resolve, 5000));
              lastPollTime = Date.now(); // 重置最后轮询时间
              continue; // 继续轮询，不退出
            } else if (isFcBalanceInsufficientError(pollError)) {
              onStatus({
                nodeId,
                status: 'ERROR',
                payload: buildFcErrorPayload(pollError, '轮询失败'),
              });
              break;
            } else if (axios.isAxiosError(pollError) && pollError.response?.status === 404) {
              // 404 错误：任务不存在，可能任务 ID 错误
              console.error(`[视频生成] 任务不存在 (404): ${taskId}`);
              throw new Error(`任务不存在，任务 ID: ${taskId}`);
            } else {
              // 其他错误，记录但继续尝试
              console.warn(`[视频生成] 轮询失败 (第 ${attempt} 次): ${errorMessage}`);
              // 继续轮询，不退出（除非是明确的业务错误）
              if (axios.isAxiosError(pollError) && pollError.response?.status && pollError.response.status >= 400 && pollError.response.status < 500) {
                // 4xx 客户端错误，可能是任务 ID 错误或其他业务错误
                const errorMsg =
                  (pollError.response?.data as { error?: string })?.error ||
                  (pollError.response?.data as { message?: string })?.message ||
                  errorMessage;
                throw new Error(`轮询失败: ${errorMsg}`);
              }
              // 5xx 服务器错误或其他错误，继续重试
              await new Promise(resolve => setTimeout(resolve, 5000));
              lastPollTime = Date.now();
            }
          }
        }
      }

      // 只有在轮询中没有发送 SUCCESS 状态时才发送（避免重复）
      if (!successSent) {
        if (videoUrl) {
          // 首次响应即带 videoUrl：与轮询 SUCCESS 一致，尝试下载到本地并传 originalVideoUrl，确保前端能显示
          let finalVideoUrl = videoUrl;
          let localPath: string | undefined;
          if (videoUrl.startsWith('http://') || videoUrl.startsWith('https://')) {
            try {
              const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
              const projectId = (input as any)?.projectId;
              const nodeTitle = (input as any)?.nodeTitle || 'video';
              const downloadedPath = await autoDownloadResource(videoUrl, 'video', {
                resourceType: 'video',
                nodeId: nodeId,
                nodeTitle: nodeTitle,
                projectId: projectId,
              });
              if (downloadedPath) {
                localPath = downloadedPath;
                finalVideoUrl = `local-resource://${downloadedPath.replace(/\\/g, '/')}`;
                console.log('[视频生成] 首次响应视频已下载到本地:', localPath);
              }
            } catch (downloadError) {
              console.error('[视频生成] 首次响应视频下载失败，使用远程 URL:', downloadError);
            }
          }
          onStatus({
            nodeId,
            status: 'SUCCESS',
            payload: {
              url: finalVideoUrl,
              videoUrl: finalVideoUrl,
              originalVideoUrl: videoUrl,
              localPath: localPath,
              text: taskId ? `任务 ID: ${taskId}，视频已就绪` : `视频生成完成: ${finalVideoUrl}`,
              taskId: taskId,
              progress: 100,
            },
          });
        } else if (taskId) {
          // 如果有 taskId 但没有 videoUrl，说明任务已提交但还在处理中（非 veo 模型的情况）
          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: {
              text: `任务已提交，任务 ID: ${taskId}，正在处理中...`,
              taskId: taskId,
            },
          });
        } else {
          // 其他情况，发送 SUCCESS 但提示用户查看任务列表
          onStatus({
            nodeId,
            status: 'SUCCESS',
            payload: {
              text: '视频生成任务已提交，请稍后在控制台或任务列表中查看结果',
            },
          });
        }
      }
    } catch (error: unknown) {
      const message =
        (axios.isAxiosError(error) && (error.response?.data as { error?: { message?: string } })?.error?.message) ||
        (error instanceof Error ? error.message : String(error)) ||
        '视频生成失败，请稍后重试';

      console.error('[视频生成] 调用失败:', message, axios.isAxiosError(error) ? error.response?.data : '');

      void tryRefundFcForwardCharge(fcChargedTaskId, 'video', 'execute_failed');

      onStatus({
        nodeId,
        status: 'ERROR',
        payload: buildFcErrorPayload(error, message),
      });
    }
  }
}

