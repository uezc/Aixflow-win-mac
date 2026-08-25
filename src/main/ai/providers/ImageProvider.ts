/**
 * Image Generation Provider - 图片生成
 * 文生图：使用 RunningHub 插件算力 API
 * 图生图：使用 BLTCY 核心算力 API
 */

import { BaseProvider } from '../BaseProvider.js';
import { AIExecuteParams } from '../types.js';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { fcForwardRequest } from '../../utils/fcForwardTask.js';
import path from 'path';
import fs from 'fs';
import { isLocalResourcePathAllowed } from '../../utils/projectFolderHelper.js';
import { resolveOriginalImageUrlIfPreview, resolveOriginalImageUrls } from '../utils/imageAssetResolver.js';
import { buildFcErrorPayload } from '../../utils/fcBalanceError.js';
import { tryRefundFcForwardCharge } from '../../utils/fcRefundCharge.js';
import { getAliyunFcInitUserUrl } from '../../config/aliyunConfig.js';
import { preferDirectOssUrlForThirdPartyImageRef } from '../../config/ossConfig.js';
import { getCloudAiBlockReason, buildCloudAiBlockedPayload } from '../../utils/cloudAiGate.js';
import {
  imageRhPollSleepMs,
  rhQueryPollImage,
  syncLedgerAfterRhImageSuccess,
} from '../../utils/runningHubFcHelpers.js';
import { extractAllRunningHubImageUrlsFromPoll } from '../../utils/runningHubImageQueryResume.js';
import { normalizeRunningHubPollStatus } from '../../utils/runningHubVideoQueryResume.js';
import {
  flux2KleinBillingModelId,
  lensBillingModelId,
  zImageBillingModelId,
  zImageDimensionsForAspect,
  Z_IMAGE_ASPECT_RATIOS,
  normalizeZImageResolutionTier,
} from '../../../common/zImageDimensions.js';

interface ImageInput {
  model?: string;
  prompt: string;
  image?: string | string[]; // 图生图时使用
  negativePrompt?: string; // 文悠船等模型可选
  response_format?: 'url' | 'b64_json';
  aspect_ratio?: string;
  image_size?: '1K' | '2K' | '4K';
  n?: number;
  size?: string;
  seedreamWidth?: number;
  seedreamHeight?: number;
  resolution?: string;
}

/** seedream-v4.5 比例→像素（1024-4096） */
const SEEDREAM_V45_RATIO_MAP: Record<string, { width: number; height: number }> = {
  '1:1': { width: 2048, height: 2048 },
  '2:3': { width: 1664, height: 2496 },
  '3:2': { width: 2496, height: 1664 },
  '3:4': { width: 1728, height: 2304 },
  '4:3': { width: 2304, height: 1728 },
  '9:16': { width: 1440, height: 2560 },
  '16:9': { width: 2560, height: 1440 },
  '21:9': { width: 3024, height: 1296 },
};

/** seedream-v5 比例→像素（width 1600-4704, height 1344-4096） */
const SEEDREAM_V5_RATIO_MAP: Record<string, { width: number; height: number }> = {
  '1:1': { width: 2048, height: 2048 },
  '2:3': { width: 1664, height: 2496 },
  '3:2': { width: 2496, height: 1664 },
  '3:4': { width: 1728, height: 2304 },
  '4:3': { width: 2304, height: 1728 },
  '9:16': { width: 1600, height: 2845 },
  '16:9': { width: 2560, height: 1440 },
  '21:9': { width: 3136, height: 1344 },
};

/** 优先显式宽高；否则按 aspect_ratio 映射，避免默认落成 1:1 方图 */
function resolveSeedreamPixelSize(
  model: string,
  aspectRatio: string | undefined,
  explicitW?: number,
  explicitH?: number,
): { width: number; height: number } {
  const isV5 = model === 'seedream-v5';
  const minW = isV5 ? 1600 : 1024;
  const maxW = isV5 ? 4704 : 4096;
  const minH = isV5 ? 1344 : 1024;
  const maxH = isV5 ? 4096 : 4096;
  const map = isV5 ? SEEDREAM_V5_RATIO_MAP : SEEDREAM_V45_RATIO_MAP;
  const fromAspect = map[String(aspectRatio || '').trim()] || map['1:1'];
  const ew = Number(explicitW);
  const eh = Number(explicitH);
  const hasExplicit = Number.isFinite(ew) && ew > 0 && Number.isFinite(eh) && eh > 0;
  return {
    width: Math.max(minW, Math.min(maxW, hasExplicit ? ew : fromAspect.width)),
    height: Math.max(minH, Math.min(maxH, hasExplicit ? eh : fromAspect.height)),
  };
}

/** 全能图片 X（rhart-image-g）API aspectRatio 为像素枚举 */
const RHART_IMAGE_G_ASPECT_MAP: Record<string, string> = {
  '1:1': '960x960',
  '16:9': '1280x720',
  '9:16': '720x1280',
  '3:2': '1168x784',
  '2:3': '784x1168',
  '960x960': '960x960',
  '1280x720': '1280x720',
  '720x1280': '720x1280',
  '1168x784': '1168x784',
  '784x1168': '784x1168',
};

const RHART_IMAGE_G_MODELS = ['g-3', 'g-4', 'g-4.1', 'g-4.2'] as const;

function toRhartImageGAspect(aspectRatio?: string): string {
  const key = String(aspectRatio || '').trim();
  return RHART_IMAGE_G_ASPECT_MAP[key] || '960x960';
}

function toRhartImageGModel(raw?: string): (typeof RHART_IMAGE_G_MODELS)[number] {
  const m = String(raw || '').trim().toLowerCase();
  if ((RHART_IMAGE_G_MODELS as readonly string[]).includes(m)) {
    return m as (typeof RHART_IMAGE_G_MODELS)[number];
  }
  return 'g-4.2';
}

function extractImageUrlsFromResults(results: unknown): string[] {
  if (!Array.isArray(results)) return [];
  return results
    .map((it) => {
      const rec = it as { url?: unknown; outputType?: unknown };
      const out = String(rec?.outputType ?? '').trim().toLowerCase();
      const u = typeof rec?.url === 'string' ? rec.url.trim() : '';
      if (!u || !/^https?:\/\//i.test(u)) return '';
      if (/\.zip(?:$|[?#])/i.test(u) || out === 'zip') return '';
      if (out && !['png', 'jpg', 'jpeg', 'webp', 'bmp', 'image', 'img'].includes(out)) return '';
      if (!out && !/\.(png|jpg|jpeg|webp|bmp)(?:$|[?#])/i.test(u)) return '';
      return u;
    })
    .filter((u): u is string => !!u);
}

function resolveRhPollStatus(queryResult: Record<string, unknown>): string | undefined {
  const raw =
    queryResult.status ??
    queryResult.taskStatus ??
    queryResult.task_status;
  return normalizeRunningHubPollStatus(raw);
}

function extractImageUrlsFromRhPoll(queryResult: Record<string, unknown>): string[] {
  const relaxed = extractAllRunningHubImageUrlsFromPoll(queryResult, { relaxed: true });
  if (relaxed.length > 0) return relaxed;
  return extractImageUrlsFromResults(queryResult.results);
}

function isRetryableImageQueryError(err: unknown): boolean {
  const code = String((err as { code?: string })?.code || '');
  const msg = err instanceof Error ? err.message : String(err || '');
  if (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNABORTED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ENETUNREACH'
  ) {
    return true;
  }
  return /ECONNRESET|socket hang up|ETIMEDOUT|ECONNREFUSED|ECONNABORTED|EAI_AGAIN|network error|Failed to fetch|Client network socket disconnected/i.test(
    msg,
  );
}

const MAX_SUCCESS_WITHOUT_URL_ROUNDS = 24;

/** 多图结果（如 MJ V7 四宫格）逐张落盘，避免仅首张本地化后 outputImages 被压成单张 */
async function downloadRhOutputImagesToLocal(
  outputImageUrls: string[],
  primaryRemoteUrl: string,
  meta: {
    nodeId: string;
    nodeTitle: string;
    projectId?: string;
    prompt: string;
    model: string;
  },
): Promise<{ finalImageUrl: string; outputImages: string[]; localPath?: string }> {
  const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
  const sourceUrls = outputImageUrls.length > 0 ? outputImageUrls : [primaryRemoteUrl].filter(Boolean);
  const finalList: string[] = [];
  let localPath: string | undefined;

  for (let i = 0; i < sourceUrls.length; i++) {
    const url = sourceUrls[i];
    if (url.startsWith('http://') || url.startsWith('https://')) {
      try {
        const downloadedPath = await autoDownloadResource(url, 'image', {
          resourceType: 'image',
          nodeId: meta.nodeId,
          nodeTitle: meta.nodeTitle,
          projectId: meta.projectId,
          prompt: meta.prompt,
          model: meta.model,
        });
        if (downloadedPath) {
          finalList.push(`local-resource://${downloadedPath.replace(/\\/g, '/')}`);
          if (i === 0) localPath = downloadedPath;
        } else {
          finalList.push(url);
        }
      } catch (downloadError) {
        console.error(`[图片生成] 多图第 ${i + 1} 张自动下载失败:`, downloadError);
        finalList.push(url);
      }
    } else {
      finalList.push(url);
    }
  }

  const finalImageUrl = finalList[0] || primaryRemoteUrl;
  return {
    finalImageUrl,
    outputImages: finalList.length > 0 ? finalList : [primaryRemoteUrl].filter(Boolean),
    localPath,
  };
}

export class ImageProvider extends BaseProvider {
  readonly modelId = 'image';

  // RunningHub 路径前缀（实际请求经 FC 转发，密钥在云端）
  private readonly runningHubApiBaseUrl = 'https://nexflow-fc-rh.stub/openapi/v2';

  private pathFromRunningHubUrl(fullUrl: string): string {
    const marker = '/openapi/v2';
    const i = fullUrl.indexOf(marker);
    if (i === -1) {
      try {
        const u = new URL(fullUrl);
        return u.pathname + u.search;
      } catch {
        return fullUrl;
      }
    }
    return fullUrl.slice(i + marker.length) || '/';
  }

  /**
   * RunningHub 路径（如 rhart-image-n-g31-flash）与 FC 定价表 model_id（banana-2.0）不一致，
   * 必须显式传 billingModelId，否则 extractModelIdFromForward 会得到无法计价的 ID。
   *
   * FC：`mergeRunTaskInner` 后 `inner.billingModelId`；主进程：`callFCGenericTask` 根级字段 `billingModelId`
   *（与 fcForwardRequest 的 `options.billingModelId` 一致，禁止改用其它 key）。
   */
  /**
   * SaaS：可先 POST /tasks/create 扣费，再传 prepaidLedgerTaskId，此处走 billing=none。
   */
  private async rhPostCharge(
    fullUrl: string,
    payload: Record<string, unknown>,
    fallbackFcId: string,
    billingModelId?: string,
    prepaidLedgerTaskId?: string | null,
    rhRegion?: 'cn' | 'ai',
  ): Promise<Record<string, unknown>> {
    const path = this.pathFromRunningHubUrl(fullUrl);
    const bid = billingModelId?.trim();
    const usePrepaid = prepaidLedgerTaskId != null && String(prepaidLedgerTaskId).trim() !== '';
    const taskId = usePrepaid ? String(prepaidLedgerTaskId).trim() : fallbackFcId;
    const billing = usePrepaid ? ('none' as const) : ('charge' as const);
    const { data } = await fcForwardRequest(
      taskId,
      'image',
      billing,
      {
        provider: 'runninghub',
        path,
        method: 'POST',
        body: payload,
        ...(rhRegion ? { rhRegion } : {}),
      },
      bid ? { billingModelId: bid } : undefined,
    );
    return data;
  }

  /** SaaS 预扣费最长等待；超时则跳过预扣费，直接经 FC 转发 RunningHub，避免批量生图时长时间卡在「解析中…」 */
  private static readonly TASKS_CREATE_PRECHARGE_TIMEOUT_MS = 15_000;

  /** 正式版 SaaS：先下单扣费并写入 nx_tasks(pending)，便于前端轮询 /tasks/status */
  private async ensureLedgerImageTask(
    nodeId: string,
    billingModelId: string,
    imageInput: ImageInput,
    prompt: string,
    nodeDataExtra: Record<string, unknown>,
  ): Promise<string | null> {
    try {
      if (!getAliyunFcInitUserUrl().trim()) return null;
      const { isNxSaasMode, isNxOfflineCloudSession, getNxAccessToken, nxCloudTasksCreate } = await import(
        '../../services/aliyunService.js'
      );
      if (!isNxSaasMode() || isNxOfflineCloudSession() || !getNxAccessToken()) return null;
      console.log(
        `[ImageProvider] 正在请求 SaaS /tasks/create 预扣费 model_id=${billingModelId} nodeId=${nodeId}`,
      );
      const createOnce = () =>
        nxCloudTasksCreate({
          model_id: billingModelId,
          type: 'image',
          params: {
            nodeId,
            taskKind: 'image',
            model: imageInput.model,
            prompt: String(prompt || '').slice(0, 4000),
          },
          nodeData: {
            model: imageInput.model,
            resolution: imageInput.image_size,
            aspect_ratio: imageInput.aspect_ratio,
            ...nodeDataExtra,
          },
        });
      const createWithRetry = async (): Promise<{ task_id: string; balance: number }> => {
        try {
          return await createOnce();
        } catch (firstErr) {
          const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
          if (msg.includes('401') || msg.includes('未授权') || /UNAUTHORIZED/i.test(msg)) {
            const { refreshNxAccessToken } = await import('../../services/aliyunService.js');
            const refreshed = await refreshNxAccessToken();
            if (refreshed) {
              return await createOnce();
            }
          }
          throw firstErr;
        }
      };
      const timeoutMs = ImageProvider.TASKS_CREATE_PRECHARGE_TIMEOUT_MS;
      const r = await Promise.race([
        createWithRetry(),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
      if (r === null) {
        console.warn(
          `[ImageProvider] /tasks/create 超过 ${timeoutMs}ms 未完成，跳过预扣费并直接经 FC 转发 RunningHub（nodeId=${nodeId}）`,
        );
        return null;
      }
      const { notifyNxCloudTaskTrack } = await import('../../nxCloudTaskTrackNotifier.js');
      notifyNxCloudTaskTrack({ taskId: r.task_id, nodeId, taskType: 'image', balance: r.balance });
      console.log(`[ImageProvider] /tasks/create 预扣费成功 task_id=${r.task_id} nodeId=${nodeId}`);
      return r.task_id;
    } catch (e) {
      console.warn('[ImageProvider] /tasks/create 失败，回退为 run-task 内扣费（RunningHub 仍经 FC 转发）', e);
      return null;
    }
  }

  /** 轮询 RH 状态；ledger 仅在 SUCCESS 后由 syncLedgerAfterRhImageSuccess 一次性回写 */
  private rhQueryPoll(
    rhTaskId: string,
    fcPollId: string,
    rhRegion?: 'cn' | 'ai',
  ): Promise<Record<string, unknown>> {
    return rhQueryPollImage(rhTaskId, fcPollId, undefined, rhRegion ? { rhRegion } : undefined);
  }

  /**
   * 将历史分辨率字段统一映射为 RunningHub 要求的 1k/2k/4k
   */
  private toRunningHubImageQuality(quality?: string): 'low' | 'medium' | 'high' {
    const q = String(quality ?? '')
      .trim()
      .toLowerCase();
    if (q === 'low' || q === 'high' || q === 'medium') return q;
    return 'low';
  }

  private toRunningHubResolution(resolution?: string): '1k' | '2k' | '4k' {
    const normalized = String(resolution || '').trim().toLowerCase();
    if (normalized === '4k' || normalized.includes('1792') || normalized.includes('2048') || normalized.includes('2160') || normalized.includes('4k')) {
      return '4k';
    }
    if (normalized === '2k' || normalized.includes('1024') || normalized.includes('1280') || normalized.includes('2k')) {
      return '2k';
    }
    return '1k';
  }

  async execute(params: AIExecuteParams): Promise<void> {
    const { nodeId, input, onStatus } = params;

    // 解析输入参数
    const imageInput = input as ImageInput;
    if (Array.isArray(imageInput.image)) {
      imageInput.image = resolveOriginalImageUrls(imageInput.image);
    } else if (typeof imageInput.image === 'string') {
      imageInput.image = resolveOriginalImageUrlIfPreview(imageInput.image);
    }
    
    const cloudBlock = getCloudAiBlockReason();
    if (cloudBlock) {
      onStatus({ nodeId, status: 'ERROR', payload: buildCloudAiBlockedPayload() });
      return;
    }
    if (!getAliyunFcInitUserUrl().trim()) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: {
          error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法使用图片生成',
        },
      });
      return;
    }

    // 创建统一模拟进度引擎
    const { createProgressEngine } = await import('../utils/ProgressHelper.js');
    const progressEngine = createProgressEngine('image', Date.now());
    /** 提交 RunningHub 后写入，供进度条与任务列表持久化 runningHubTaskId */
    const rhPollTaskIdRef = { current: undefined as string | undefined };

    // 启动进度更新循环（在 1.5 秒内冲到 95%）
    let progressInterval: NodeJS.Timeout | null = setInterval(() => {
      const currentProgress = progressEngine.getProgress();
      const progressMessage = progressEngine.getMessage();

      onStatus({
        nodeId,
        status: 'PROCESSING',
        payload: {
          progress: currentProgress,
          text: progressMessage, // 只显示轮播文字，不显示百分比
          ...(rhPollTaskIdRef.current ? { taskId: rhPollTaskIdRef.current } : {}),
        },
      });
      
      // 如果达到最大进度，停止更新（等待实际结果）
      if (currentProgress >= 95) {
        if (progressInterval) {
          clearInterval(progressInterval);
          progressInterval = null;
        }
      }
    }, 100); // 每 100ms 更新一次

    // 清理进度更新的辅助函数
    const clearProgress = () => {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    };

    /** FC 提交已成功扣费时记录 taskId，生成失败时在 catch 中退回元宝（须在 try 外声明以便 catch 可访问） */
    let fcChargedTaskId: string | undefined;
    try {
      // 解析输入参数（imageInput 已在上面定义）
      const { 
        model = 'rhart-image-g-2', 
        prompt, 
        aspect_ratio
      } = imageInput;

      if (!prompt) {
        throw new Error('提示词是必需的');
      }

      const retiredImageModels = new Set([
        'nano-banana',
        'nano-banana-2',
        'nano-banana-2-2k',
        'nano-banana-2-4k',
        'seedream-v4.5',
        'youchuan-text-to-image-v7',
        'mj-v7',
        'gpt-image-2',
        'rhart-image-g',
        'rhart-image-g-1.5',
      ]);
      if (retiredImageModels.has(String(model))) {
        throw new Error(
          '该图片模型已从前端下架，请在面板中改用全能图片 V2、Seedream v5、悠船文生图 v8.1 等模型。',
        );
      }

      const knownImageModels = new Set([
        'banana-2.0',
        'seedream-v5',
        'rhart-image-g-2',
        'flux2-klein',
        'z-image',
        'lens',
        'youchuan-text-to-image-v81',
      ]);
      if (!knownImageModels.has(String(model))) {
        throw new Error(`不支持的图片模型：${model}。请改用面板中的活跃模型。`);
      }

      // 规范化参考图：空串/空白视为无图，避免 UI 有缩略图但请求 image:[] 被误判为文生图
      const normalizeImageRefs = (raw: unknown): string[] => {
        if (raw == null) return [];
        const arr = Array.isArray(raw) ? raw : [raw];
        return arr
          .map((u) => String(u ?? '').trim())
          .filter((u) => u.length > 0);
      };
      const imageRefs = normalizeImageRefs(imageInput.image);
      if (imageRefs.length > 0) {
        imageInput.image = imageRefs.length === 1 ? imageRefs[0] : imageRefs;
      } else {
        delete (imageInput as { image?: string | string[] }).image;
      }

      // 判断是文生图还是图生图
      // 默认优先文生图模式，只有当有有效输入图片时才切换到图生图模式
      const isImageToImage = imageRefs.length > 0;
      
      console.log(`[图片生成] 模式: ${isImageToImage ? '图生图' : '文生图'}, 模型: ${model}, 参考图数量: ${isImageToImage ? imageRefs.length : 0}`);

      // 仅文生图且不允许参考图的模型：有参考图时硬拒（与 imageModelUiPolicy 对齐）
      // 注：悠船 v7/v81 文生图可选用一张 style 图，不得在此硬拒，应落入下方文生图分支
      const textToImageNoRefsModels = new Set(['mj-v7', 'z-image', 'lens', 'rhart-image-g']);
      if (isImageToImage && textToImageNoRefsModels.has(String(model))) {
        const labelMap: Record<string, string> = {
          'mj-v7': 'MJ V7',
          'z-image': 'Z-image',
          lens: 'Lens',
          'rhart-image-g': '全能图片 X',
        };
        const label = labelMap[String(model)] || String(model);
        throw new Error(`${label} 仅支持文生图，请移除参考图后重试`);
      }

      // 图生图模式：使用 RunningHub API（插件算力）。MJ / Z-image / Lens / 悠船 / 全能图片 X 不走图生图 OpenAPI
      if (
        isImageToImage &&
        imageInput.image &&
        model !== 'mj-v7' &&
        model !== 'z-image' &&
        model !== 'lens' &&
        model !== 'youchuan-text-to-image-v81' &&
        model !== 'youchuan-text-to-image-v7' &&
        model !== 'rhart-image-g'
      ) {
        // 图生图模式使用 RunningHub API（经 FC 转发）
        // 检查图片数量（GPT image 2 最多 2 张；全能图片PRO 最多5张；seedream / banana / G-2 最多10张）
        const imageArray = Array.isArray(imageInput.image) ? imageInput.image : [imageInput.image];
        const maxImagesAllowed =
          model === 'flux2-klein'
            ? 3
            : model === 'gpt-image-2'
              ? 2
              : model === 'seedream-v4.5' ||
                  model === 'seedream-v5' ||
                  model === 'banana-2.0' ||
                  model === 'rhart-image-g-2'
                ? 10
                : 5;
        if (imageArray.length > maxImagesAllowed) {
          throw new Error(`连接已满：最多支持 ${maxImagesAllowed} 张参考图片`);
        }
        
        console.log(`[图片生成] 图生图模式，使用 RunningHub API，参考图数量: ${imageArray.length}`);
        
        // OSS 预处理阶段：将本地图片上传到 OSS 获取公网 URL
        const imageUrls: string[] = [];
        for (const imageUrl of imageArray) {
          try {
            let finalImageUrl: string;
            
            // 如果已经是 HTTP/HTTPS URL，直接使用
            if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
              finalImageUrl = imageUrl;
              console.log(`[图片生成] 使用远程图片 URL: ${imageUrl}`);
            } else {
              // 本地图片需要先上传到 OSS 获取公网 URL
              console.log(`[图片生成] 检测到本地图片，开始 OSS 预处理: ${imageUrl}`);
              
              // 准备图片 Buffer
              let imageBuffer: Buffer;
              let mimeType = 'image/png';
              
              if (imageUrl.startsWith('local-resource://')) {
                // 解析 local-resource:// 协议路径
                let filePath = imageUrl.replace(/^local-resource:\/\//, '');
                filePath = decodeURIComponent(filePath);
                if (filePath.match(/^[/\\]+[a-zA-Z]:[/\\]/)) filePath = filePath.replace(/^[/\\]+/, '');
                if (filePath.match(/^[a-zA-Z]\//)) {
                  filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
                }
                const userDataPath = app.getPath('userData');
                let normalizedFilePath = path.normalize(filePath);
                if (!path.isAbsolute(normalizedFilePath)) {
                  normalizedFilePath = path.resolve(userDataPath, normalizedFilePath);
                }
                if (!isLocalResourcePathAllowed(normalizedFilePath)) {
                  throw new Error(`访问路径超出允许范围: ${normalizedFilePath}`);
                }
                
                // 检查文件是否存在（使用绝对路径）
                if (!fs.existsSync(normalizedFilePath)) {
                  throw new Error(`文件不存在: ${normalizedFilePath}`);
                }
                
                // 读取文件（使用 try-catch 捕获读取错误）
                try {
                  imageBuffer = fs.readFileSync(normalizedFilePath);
                  console.log(`[图片生成] 成功读取本地图片: ${normalizedFilePath}, 大小: ${imageBuffer.length} bytes`);
                } catch (readError: any) {
                  console.error(`[图片生成] 读取文件失败: ${normalizedFilePath}`, readError);
                  throw new Error(`读取文件失败: ${normalizedFilePath} - ${readError.message || readError}`);
                }
                
                const fileExt = path.extname(normalizedFilePath).toLowerCase();
                if (fileExt === '.jpg' || fileExt === '.jpeg') {
                  mimeType = 'image/jpeg';
                } else if (fileExt === '.png') {
                  mimeType = 'image/png';
                } else if (fileExt === '.webp') {
                  mimeType = 'image/webp';
                }
              } else if (imageUrl.startsWith('file://')) {
                let filePath = imageUrl.replace(/^file:\/\//, '');
                if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') {
                  filePath = filePath.substring(1);
                }
                filePath = decodeURIComponent(filePath);
                
                // 确保是绝对路径
                if (!path.isAbsolute(filePath)) {
                  filePath = path.resolve(filePath);
                }
                
                // 检查文件是否存在
                if (!fs.existsSync(filePath)) {
                  throw new Error(`文件不存在: ${filePath}`);
                }
                
                // 读取文件（使用 try-catch 捕获读取错误）
                try {
                  imageBuffer = fs.readFileSync(filePath);
                  console.log(`[图片生成] 成功读取文件图片: ${filePath}, 大小: ${imageBuffer.length} bytes`);
                } catch (readError: any) {
                  console.error(`[图片生成] 读取文件失败: ${filePath}`, readError);
                  throw new Error(`读取文件失败: ${filePath} - ${readError.message || readError}`);
                }
                
                const fileExt = path.extname(filePath).toLowerCase();
                if (fileExt === '.jpg' || fileExt === '.jpeg') {
                  mimeType = 'image/jpeg';
                } else if (fileExt === '.png') {
                  mimeType = 'image/png';
                } else if (fileExt === '.webp') {
                  mimeType = 'image/webp';
                }
              } else if (imageUrl.startsWith('data:')) {
                // Base64 data URL
                const base64Match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
                if (!base64Match) {
                  throw new Error('无效的 data URL 格式');
                }
                const [, imageType, base64Data] = base64Match;
                mimeType = `image/${imageType}`;
                
                try {
                  imageBuffer = Buffer.from(base64Data, 'base64');
                  console.log(`[图片生成] 成功解析 Base64 图片, 大小: ${imageBuffer.length} bytes`);
                } catch (base64Error: any) {
                  console.error(`[图片生成] Base64 解码失败:`, base64Error);
                  throw new Error(`Base64 解码失败: ${base64Error.message || base64Error}`);
                }
              } else {
                throw new Error(`不支持的图片 URL 格式: ${imageUrl.substring(0, 50)}`);
              }
              
              // 检查图片大小（如果超过 10MB，给出警告）
              const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
              if (imageBuffer.length > MAX_IMAGE_SIZE) {
                console.warn(`[图片生成] 图片过大: ${imageBuffer.length} bytes (${(imageBuffer.length / 1024 / 1024).toFixed(2)} MB)，可能导致上传失败`);
              }
              
              // 上传到 OSS 获取公网 URL
              console.log(`[图片生成] 开始上传图片到 OSS，文件大小: ${imageBuffer.length} bytes, MIME: ${mimeType}`);
              
              try {
                // 使用 VideoProvider 的 OSS 上传方法
                const { VideoProvider } = await import('./VideoProvider.js');
                const videoProvider = new VideoProvider();
                finalImageUrl = await videoProvider.uploadImageToOSS(imageBuffer, mimeType);
                console.log(`[图片生成] 图片已上传到 OSS，获得公网 URL: ${finalImageUrl}`);
              } catch (ossError: any) {
                console.error(`[图片生成] OSS 上传失败:`, ossError);
                console.error(`[图片生成] OSS 上传错误堆栈:`, ossError.stack);
                throw new Error(`OSS 上传失败: ${ossError.message || ossError}`);
              }
            }
            
            const refForRh = preferDirectOssUrlForThirdPartyImageRef(finalImageUrl);
            if (refForRh !== finalImageUrl) {
              console.log(`[图片生成] RunningHub 参考图改为 OSS 源站直链（第三方拉取更稳）: ${refForRh}`);
            }
            imageUrls.push(refForRh);
          } catch (error: any) {
            console.error(`[图片生成] ========== 处理参考图失败 ==========`);
            console.error(`[图片生成] 图片 URL: ${imageUrl}`);
            console.error(`[图片生成] 错误对象:`, error);
            console.error(`[图片生成] 错误堆栈:`, error.stack);
            console.error(`[图片生成] 错误消息:`, error.message);
            if (error.response) {
              console.error(`[图片生成] 错误响应:`, error.response.status, error.response.statusText);
              console.error(`[图片生成] 错误响应数据:`, JSON.stringify(error.response.data, null, 2));
            }
            console.error(`[图片生成] =====================================`);
            throw new Error(`处理参考图失败: ${error.message || error}`);
          }
        }
        
        let submitUrl: string;
        let submitPayload: any;

        if (model === 'flux2-klein') {
          const trimmedPrompt = prompt.trim();
          if (!trimmedPrompt) {
            throw new Error('Flux2 Klein 提示词不能为空');
          }
          const zTier = normalizeZImageResolutionTier((imageInput as { resolution?: string }).resolution);
          const aspectKey =
            aspect_ratio &&
            (Z_IMAGE_ASPECT_RATIOS as readonly string[]).includes(String(aspect_ratio).trim())
              ? aspect_ratio
              : '16:9';
          const { width, height } = zImageDimensionsForAspect(aspectKey, zTier);
          const img1 = imageUrls[0];
          const img2 = imageUrls.length >= 2 ? imageUrls[1] : img1;
          const img3 = imageUrls.length >= 3 ? imageUrls[2] : img2;
          const FLUX2_KLEIN_AI_APP_ID = '2059939823342936066';
          submitUrl = `${this.runningHubApiBaseUrl}/run/ai-app/${FLUX2_KLEIN_AI_APP_ID}`;
          submitPayload = {
            nodeInfoList: [
              { nodeId: '355', fieldName: 'image', fieldValue: img1, description: 'image1' },
              { nodeId: '352', fieldName: 'image', fieldValue: img2, description: 'image2' },
              { nodeId: '357', fieldName: 'image', fieldValue: img3, description: 'image3' },
              { nodeId: '353', fieldName: 'text', fieldValue: trimmedPrompt, description: 'text' },
              { nodeId: '368', fieldName: 'value', fieldValue: String(width), description: '宽' },
              { nodeId: '367', fieldName: 'value', fieldValue: String(height), description: '高' },
            ],
            instanceType: 'default',
            usePersonalQueue: 'false',
            model: 'flux2-klein',
            resolution: zTier,
          };
          console.log(
            `[图片生成] 使用 Flux2 Klein 图生图，${width}×${height}（${zTier === '720p' ? '720P' : '1080P'}，比例 ${aspectKey}），参考图 ${imageUrls.length} 张`,
          );
        } else if (model === 'gpt-image-2') {
          // GPT image 2 图生图（RunningHub AI App）：
          // POST /openapi/v2/run/ai-app/2048651352842182658
          // nodeId 2/7：参考图；nodeId 1：aspectRatio；nodeId 5：text（描述）
          const trimmedPrompt = prompt.trim();
          if (!trimmedPrompt) {
            throw new Error('GPT image 2 图生图描述不能为空');
          }
          if (imageUrls.length === 0) {
            throw new Error('GPT image 2 图生图需要至少 1 张参考图');
          }
          if (imageUrls.length > 2) {
            throw new Error('GPT image 2 图生图最多 2 张参考图');
          }
          const img1 = imageUrls[0];
          const img2 = imageUrls.length >= 2 ? imageUrls[1] : imageUrls[0];
          const gptImg2I2IAspectFieldData =
            '[["empty", "3:2", "1:1", "2:3", "5:4", "4:5", "16:9", "9:16", "21:9", "3:4", "4:3"], {"default": "empty"}]';
          const validGptImg2I2IRatios = ['empty', '3:2', '1:1', '2:3', '5:4', '4:5', '16:9', '9:16', '21:9', '3:4', '4:3'];
          const finalAspectRatio =
            aspect_ratio && validGptImg2I2IRatios.includes(aspect_ratio) ? aspect_ratio : 'empty';
          submitUrl = `${this.runningHubApiBaseUrl}/run/ai-app/2048651352842182658`;
          submitPayload = {
            nodeInfoList: [
              { nodeId: '2', fieldName: 'image', fieldValue: img1, description: '图一' },
              { nodeId: '7', fieldName: 'image', fieldValue: img2, description: '图2' },
              {
                nodeId: '1',
                fieldName: 'aspectRatio',
                fieldData: gptImg2I2IAspectFieldData,
                fieldValue: finalAspectRatio,
                description: '比例',
              },
              { nodeId: '5', fieldName: 'text', fieldValue: trimmedPrompt, description: '描述' },
            ],
            instanceType: 'default',
            usePersonalQueue: 'false',
          };
          console.log(
            `[图片生成] 使用 GPT image 2 图生图，aspectRatio: ${finalAspectRatio}，参考图: ${imageUrls.length} 张`,
          );
        } else if (model === 'seedream-v4.5') {
          // seedream-v4.5-图生图：宽高由输入栏填写，范围 1024-4096；未显式传宽高时按 aspect_ratio 映射
          const trimmedPrompt = prompt.trim();
          if (trimmedPrompt.length < 5 || trimmedPrompt.length > 2000) {
            throw new Error('seedream-v4.5-图生图 提示词长度为 5-2000 字');
          }
          const { width, height } = resolveSeedreamPixelSize(
            'seedream-v4.5',
            aspect_ratio,
            Number((imageInput as any).seedreamWidth) || undefined,
            Number((imageInput as any).seedreamHeight) || undefined,
          );
          submitUrl = `${this.runningHubApiBaseUrl}/seedream-v4.5/image-to-image`;
          submitPayload = {
            prompt: trimmedPrompt,
            width,
            height,
            imageUrls: imageUrls,
            maxImages: 1,
          };
          console.log(`[图片生成] 提交图生图任务到 RunningHub API（seedream-v4.5/image-to-image），width: ${width}, height: ${height}, aspect: ${aspect_ratio || ''}, 图片数量: ${imageUrls.length}`);
        } else if (model === 'seedream-v5') {
          // seedream-v5-图生图（国内）：https://www.runninghub.cn/openapi/v2/seedream-v5-lite/image-to-image
          // prompt(5-2000)、imageUrls≤10、sequentialImageGeneration、maxImages；
          // resolution(2k|3k) 优先于 width/height
          const trimmedPrompt = prompt.trim();
          if (trimmedPrompt.length < 5 || trimmedPrompt.length > 2000) {
            throw new Error('seedream-v5-图生图 提示词长度为 5-2000 字');
          }
          if (imageUrls.length === 0) {
            throw new Error('seedream-v5-图生图需要至少 1 张参考图');
          }
          if (imageUrls.length > 10) {
            throw new Error('seedream-v5-图生图最多 10 张参考图');
          }
          const resRaw = String((imageInput as { resolution?: string }).resolution || '')
            .trim()
            .toLowerCase();
          const seedreamResolution =
            resRaw === '2k' || resRaw === '3k' ? resRaw : undefined;
          submitUrl = `${this.runningHubApiBaseUrl}/seedream-v5-lite/image-to-image`;
          if (seedreamResolution) {
            submitPayload = {
              prompt: trimmedPrompt,
              imageUrls,
              sequentialImageGeneration: 'disabled',
              maxImages: 1,
              resolution: seedreamResolution,
            };
            console.log(
              `[图片生成] 提交图生图（seedream-v5，国内 .cn），resolution: ${seedreamResolution}, 图片数量: ${imageUrls.length}`,
            );
          } else {
            const { width, height } = resolveSeedreamPixelSize(
              'seedream-v5',
              aspect_ratio,
              Number((imageInput as any).seedreamWidth) || undefined,
              Number((imageInput as any).seedreamHeight) || undefined,
            );
            submitPayload = {
              prompt: trimmedPrompt,
              width,
              height,
              imageUrls,
              sequentialImageGeneration: 'disabled',
              maxImages: 1,
            };
            console.log(
              `[图片生成] 提交图生图（seedream-v5，国内 .cn），width: ${width}, height: ${height}, aspect: ${aspect_ratio || ''}, 图片数量: ${imageUrls.length}`,
            );
          }
        } else if (model === 'banana-2.0') {
          // 全能图片 V2 图生图：海外 https://www.runninghub.ai/openapi/v2/rhart-image-n-g31-flash/image-to-image
          const validAspectRatios = [
            '1:1',
            '16:9',
            '9:16',
            '4:3',
            '3:4',
            '3:2',
            '2:3',
            '5:4',
            '4:5',
            '21:9',
            '1:4',
            '4:1',
            '1:8',
            '8:1',
          ];
          const finalAspectRatio = aspect_ratio && validAspectRatios.includes(aspect_ratio) ? aspect_ratio : '1:1';
          const finalResolution = this.toRunningHubResolution((imageInput as any).resolution);
          submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-n-g31-flash/image-to-image`;
          submitPayload = {
            imageUrls,
            prompt: prompt.trim(),
            resolution: finalResolution,
            aspectRatio: finalAspectRatio,
          };
          console.log(
            `[图片生成] 提交图生图到 RunningHub（全能图片 V2 / rhart-image-n-g31-flash），resolution: ${finalResolution}, aspectRatio: ${finalAspectRatio}, 图片数量: ${imageUrls.length}`,
          );
        } else if (model === 'rhart-image-g-2') {
          // 全能图片 G-2.0 图生图：海外 https://www.runninghub.ai/openapi/v2/rhart-image-g-2/image-to-image
          const validAspectRatiosG2 = [
            '1:1',
            '2:3',
            '3:2',
            '4:5',
            '5:4',
            '4:3',
            '3:4',
            '16:9',
            '9:16',
            '21:9',
            '9:21',
            '2:1',
            '1:2',
            '3:1',
            '1:3',
          ];
          const finalAspectRatio =
            aspect_ratio && validAspectRatiosG2.includes(aspect_ratio) ? aspect_ratio : '1:1';
          const finalResolution = this.toRunningHubResolution((imageInput as any).resolution);
          submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-g-2/image-to-image`;
          submitPayload = {
            imageUrls,
            prompt: prompt.trim(),
            resolution: finalResolution,
            aspectRatio: finalAspectRatio,
          };
          console.log(
            `[图片生成] 提交图生图到 RunningHub（全能图片 G-2.0 / rhart-image-g-2），resolution: ${finalResolution}, aspectRatio: ${finalAspectRatio}, 图片数量: ${imageUrls.length}`,
          );
        } else {
          throw new Error(`不支持的图片模型：${model}。请改用面板中的活跃模型。`);
        }
        
        console.log('[图片生成] 提交任务到 RunningHub API:', submitUrl);
        console.log('[图片生成] 提交任务载荷:', JSON.stringify(submitPayload, null, 2));

        const utf8Prompt = Buffer.from(prompt, 'utf-8').toString('utf-8');
        if (Object.prototype.hasOwnProperty.call(submitPayload, 'prompt')) {
          submitPayload.prompt = utf8Prompt;
        }

        const billingModelI2I =
          model === 'flux2-klein'
            ? flux2KleinBillingModelId((imageInput as { resolution?: string }).resolution)
            : model;
        if (model === 'flux2-klein') {
          console.log(
            `[图片生成] Flux2 Klein 扣费 model_id=${billingModelI2I}，分辨率档位=${normalizeZImageResolutionTier((imageInput as { resolution?: string }).resolution)}`,
          );
        }

        const fcGenIdI2I = randomUUID();
        let ledgerIdI2I: string | null = null;
        const perfStartI2I = Date.now();
        let perfCreateDoneI2I = 0;
        let perfForwardDoneI2I = 0;
        const rhRegionI2I: 'cn' | 'ai' | undefined =
          model === 'banana-2.0' || model === 'rhart-image-g-2'
            ? 'ai'
            : model === 'seedream-v5'
              ? 'cn'
              : undefined;
        console.log('[图片生成] Sending Request via FC...', submitUrl);
        let submitResult: Record<string, unknown>;
        try {
          ledgerIdI2I = await this.ensureLedgerImageTask(nodeId, billingModelI2I, imageInput, prompt, {
            resolution: (submitPayload as { resolution?: string }).resolution,
            aspectRatio: (submitPayload as { aspectRatio?: string }).aspectRatio,
          });
          perfCreateDoneI2I = Date.now();
          submitResult = await this.rhPostCharge(
            submitUrl,
            submitPayload as Record<string, unknown>,
            fcGenIdI2I,
            billingModelI2I,
            ledgerIdI2I,
            rhRegionI2I,
          );
          perfForwardDoneI2I = Date.now();
          fcChargedTaskId = ledgerIdI2I || fcGenIdI2I;
          console.log('[图片生成] 提交任务响应数据:', JSON.stringify(submitResult, null, 2));
        } catch (submitError: unknown) {
          if (submitError instanceof Error) throw submitError;
          throw new Error(`提交任务失败: ${String(submitError)}`);
        }

        const rhTaskIdI2I =
          submitResult.taskId ||
          submitResult.task_id ||
          (submitResult.data as { taskId?: string } | undefined)?.taskId ||
          (submitResult.result as { taskId?: string } | undefined)?.taskId;

        if (!rhTaskIdI2I) {
          const errMsg = submitResult.error || submitResult.errorMessage || submitResult.message || submitResult.msg ||
            (submitResult.code !== undefined && submitResult.code !== 0 ? `错误码 ${submitResult.code}，${submitResult.message || submitResult.msg || ''}` : '') ||
            'API 未返回任务 ID';
          console.error('[图片生成] submit 未返回 taskId，立刻上报 ERROR:', errMsg);
          onStatus({ nodeId, status: 'ERROR', payload: { error: `提交任务失败：${errMsg}`, progress: 0 } });
          throw new Error(`提交任务失败：${errMsg}`);
        }

        console.log(`[图片生成] 任务已提交，taskId: ${String(rhTaskIdI2I)}`);

        rhPollTaskIdRef.current = String(rhTaskIdI2I);
        onStatus({
          nodeId,
          status: 'PROCESSING',
          payload: {
            progress: progressEngine.getProgress(),
            text: progressEngine.getMessage(),
            taskId: rhPollTaskIdRef.current,
          },
        });

        let imageUrl: string | null = null;
        let outputImageUrls: string[] = [];
        const maxPollingAttempts = 120;
        let pollingAttempts = 0;
        let successWithoutUrlRounds = 0;
        const pollStartTime = Date.now();
        let perfPollDoneI2I = 0;

        while (pollingAttempts < maxPollingAttempts) {
          const pollSleepMs = imageRhPollSleepMs(pollingAttempts, pollStartTime);
          if (pollSleepMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, pollSleepMs));
          }

          onStatus({
            nodeId,
            status: 'PROCESSING',
            payload: {
              progress: Math.min(92, 18 + pollingAttempts * 2),
              text: '生成中…',
              taskId: rhPollTaskIdRef.current,
            },
          });

          try {
            const queryResult = await this.rhQueryPoll(
              String(rhTaskIdI2I),
              `${fcGenIdI2I}:poll:${pollingAttempts}`,
              rhRegionI2I,
            );
            const status = resolveRhPollStatus(queryResult as Record<string, unknown>);
            const rawStatus = String(queryResult.status ?? queryResult.taskStatus ?? '');

            console.log(`[图片生成] 任务状态: ${rawStatus || status}, taskId: ${String(rhTaskIdI2I)}`);

            if (status === 'SUCCESS') {
              outputImageUrls = extractImageUrlsFromRhPoll(queryResult as Record<string, unknown>);
              imageUrl = outputImageUrls[0] ?? null;
              if (!imageUrl) {
                successWithoutUrlRounds += 1;
                console.warn(
                  `[图片生成] SUCCESS 但未解析到图片 URL，继续查询 (${successWithoutUrlRounds}/${MAX_SUCCESS_WITHOUT_URL_ROUNDS}) taskId=${String(rhTaskIdI2I)}`,
                );
                if (successWithoutUrlRounds >= MAX_SUCCESS_WITHOUT_URL_ROUNDS) {
                  throw new Error('任务完成但未返回结果');
                }
                pollingAttempts++;
                continue;
              }
              perfPollDoneI2I = Date.now();
              if (ledgerIdI2I) {
                void syncLedgerAfterRhImageSuccess(String(rhTaskIdI2I), ledgerIdI2I);
              }
              console.log(`[图片生成] 任务完成，图片 URL: ${imageUrl}`);
              break;
            } else if (status === 'FAILURE' || status === 'FAILED') {
              const errorMessage = (queryResult.errorMessage as string) || '任务失败';
              const errorCode = queryResult.errorCode || '';
              const failedReason = queryResult.failedReason || {};
              let detailedError = errorMessage;
              if (errorCode) {
                detailedError = `[错误码: ${errorCode}] ${errorMessage}`;
              }
              if (failedReason && Object.keys(failedReason as object).length > 0) {
                detailedError += ` | 失败详情: ${JSON.stringify(failedReason)}`;
              }
              console.error(`[图片生成] 任务失败，错误码: ${errorCode}, 错误信息: ${errorMessage}`);
              throw new Error(detailedError);
            } else if (
              status === 'IN_PROGRESS' ||
              status === 'NOT_START' ||
              rawStatus === 'RUNNING' ||
              rawStatus === 'QUEUED'
            ) {
              console.log(`[图片生成] 任务处理中，状态: ${rawStatus || status}`);
              pollingAttempts++;
              continue;
            } else {
              console.warn(`[图片生成] 未知任务状态: ${rawStatus || status}`);
              pollingAttempts++;
              continue;
            }
          } catch (queryError: unknown) {
            console.error(`[图片生成] 查询任务状态时出错:`, queryError);
            pollingAttempts++;
            if (queryError && typeof queryError === 'object' && 'response' in queryError) {
              continue;
            }
            if (isRetryableImageQueryError(queryError)) {
              continue;
            }
            throw queryError;
          }
        }
        
        if (!imageUrl) {
          throw new Error('任务超时：超过最大轮询次数');
        }
        
        // 自动下载并保存图片到本地（多图时逐张落盘）
        let localPath: string | undefined;
        let finalImageUrl = imageUrl;
        let finalOutputImages = outputImageUrls.length > 0 ? outputImageUrls : [imageUrl].filter(Boolean);

        if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
          try {
            const projectId = (input as any)?.projectId;
            const nodeTitle = (input as any)?.nodeTitle || 'image';
            const downloaded = await downloadRhOutputImagesToLocal(
              outputImageUrls,
              imageUrl,
              { nodeId, nodeTitle, projectId, prompt, model },
            );
            finalImageUrl = downloaded.finalImageUrl;
            finalOutputImages = downloaded.outputImages;
            localPath = downloaded.localPath;
            if (localPath) {
              console.log(`[图片生成] 图片已自动下载到本地: ${localPath}`);
            }
          } catch (downloadError) {
            console.error(`[图片生成] 自动下载图片失败:`, downloadError);
          }
        }

        if (perfForwardDoneI2I > 0) {
          const now = Date.now();
          const createMs = (perfCreateDoneI2I || perfForwardDoneI2I) - perfStartI2I;
          const forwardMs = perfForwardDoneI2I - (perfCreateDoneI2I || perfStartI2I);
          const pollMs = (perfPollDoneI2I || now) - perfForwardDoneI2I;
          const downloadMs = perfPollDoneI2I > 0 ? now - perfPollDoneI2I : 0;
          console.log(
            `[图片生成] 耗时 i2i create=${createMs}ms forward=${forwardMs}ms poll=${pollMs}ms download=${downloadMs}ms total=${now - perfStartI2I}ms`,
          );
        }

        clearProgress(); // 清除进度更新循环
        onStatus({
          nodeId,
          status: 'SUCCESS',
          payload: {
            imageUrl: finalImageUrl, // 优先使用本地路径
            originalImageUrl: imageUrl, // 保存原始远程 URL
            outputImages: finalOutputImages,
            originalImageUrls: outputImageUrls.length > 0 ? outputImageUrls : [imageUrl].filter(Boolean),
            localPath: localPath, // 传递本地路径
            progress: 100, // 设置为 100% 表示完成
          },
        });
        
        return; // 图生图模式已处理，直接返回
      }

      // 文生图模式：使用 RunningHub API（插件算力）
      const validAspectRatiosRhart = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
      const validAspectRatiosYouchuan = ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'];
      let submitUrl: string;
      let submitPayload: any;

      if (model === 'rhart-image-g-2') {
        // 安全网：有参考图时绝不能落到文生图分支（应已在上方 image-to-image 处理并 return）
        if (isImageToImage) {
          throw new Error(
            '全能图片 G-2.0 图生图路径异常：请重试。若持续失败，请改选全能图片 V2 / Seedream v5。',
          );
        }
        // 全能图片 G-2.0 文生图：海外 https://www.runninghub.ai/openapi/v2/rhart-image-g-2/text-to-image
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt) {
          throw new Error('全能图片 G-2.0 提示词不能为空');
        }
        const validAspectRatiosG2 = [
          '1:1',
          '2:3',
          '3:2',
          '4:5',
          '5:4',
          '4:3',
          '3:4',
          '16:9',
          '9:16',
          '21:9',
          '9:21',
          '2:1',
          '1:2',
          '3:1',
          '1:3',
        ];
        const finalAspectRatio =
          aspect_ratio && validAspectRatiosG2.includes(aspect_ratio) ? aspect_ratio : '16:9';
        const finalResolution = this.toRunningHubResolution((imageInput as any).resolution);
        submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-g-2/text-to-image`;
        submitPayload = {
          prompt: trimmedPrompt,
          aspectRatio: finalAspectRatio,
          resolution: finalResolution,
        };
        console.log(
          `[图片生成] 使用全能图片 G-2.0 文生图（rhart-image-g-2/text-to-image，海外），resolution: ${finalResolution}, aspectRatio: ${finalAspectRatio}`,
        );
      } else if (model === 'rhart-image-g') {
        // 全能图片 X 文生图：海外 https://www.runninghub.ai/openapi/v2/rhart-image-g/text-to-image
        if (isImageToImage) {
          throw new Error('全能图片 X 仅支持文生图，请移除参考图后重试');
        }
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt) {
          throw new Error('全能图片 X 提示词不能为空');
        }
        const apiModel = toRhartImageGModel(
          (imageInput as { rhartGModel?: string; quality?: string }).rhartGModel ||
            (imageInput as { quality?: string }).quality,
        );
        const finalAspectRatio = toRhartImageGAspect(aspect_ratio);
        submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-g/text-to-image`;
        submitPayload = {
          model: apiModel,
          prompt: trimmedPrompt,
          aspectRatio: finalAspectRatio,
        };
        console.log(
          `[图片生成] 使用全能图片 X 文生图（rhart-image-g），model: ${apiModel}, aspectRatio: ${finalAspectRatio}`,
        );
      } else if (model === 'banana-2.0') {
        // 全能图片 V2 文生图：海外 https://www.runninghub.ai/openapi/v2/rhart-image-n-g31-flash/text-to-image
        const validAspectRatiosBanana = [
          '1:1',
          '16:9',
          '9:16',
          '4:3',
          '3:4',
          '3:2',
          '2:3',
          '5:4',
          '4:5',
          '21:9',
          '1:4',
          '4:1',
          '1:8',
          '8:1',
        ];
        const finalAspectRatio = aspect_ratio && validAspectRatiosBanana.includes(aspect_ratio) ? aspect_ratio : '1:1';
        const finalResolution = this.toRunningHubResolution((imageInput as any).resolution);
        submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-n-g31-flash/text-to-image`;
        submitPayload = {
          prompt: prompt.trim(),
          resolution: finalResolution,
          aspectRatio: finalAspectRatio,
        };
        console.log(
          `[图片生成] 使用全能图片 V2 文生图（rhart-image-n-g31-flash），resolution: ${finalResolution}, aspectRatio: ${finalAspectRatio}`,
        );
      } else if (model === 'seedream-v4.5') {
        // seedream-v4.5-文生图：宽高由输入栏填写，范围 1024-4096
        if (isImageToImage) {
          throw new Error('seedream-v4.5 仅支持文生图，请勿传入参考图');
        }
        const trimmedPrompt = prompt.trim();
        if (trimmedPrompt.length < 5 || trimmedPrompt.length > 2000) {
          throw new Error('seedream-v4.5 提示词长度为 5-2000 字');
        }
        const { width, height } = resolveSeedreamPixelSize(
          'seedream-v4.5',
          aspect_ratio,
          Number((imageInput as any).seedreamWidth) || undefined,
          Number((imageInput as any).seedreamHeight) || undefined,
        );
        submitUrl = `${this.runningHubApiBaseUrl}/seedream-v4.5/text-to-image`;
        submitPayload = {
          prompt: trimmedPrompt,
          width,
          height,
          maxImages: 1,
        };
        console.log(`[图片生成] 使用 seedream-v4.5-文生图，width: ${width}, height: ${height}, aspect: ${aspect_ratio || ''}`);
      } else if (model === 'seedream-v5') {
        // seedream-v5-文生图（国内）：https://www.runninghub.cn/openapi/v2/seedream-v5-lite/text-to-image
        // 参数：prompt(5-2000字), width(1600-4704), height(1344-4096),
        // sequentialImageGeneration, maxImages(1-15)；可选 resolution(2k|3k，优先于宽高)、toolsType(web_search)
        // 注：有参考图时走上方图生图分支
        const trimmedPrompt = prompt.trim();
        if (trimmedPrompt.length < 5 || trimmedPrompt.length > 2000) {
          throw new Error('seedream-v5 提示词长度为 5-2000 字');
        }
        const resRaw = String((imageInput as { resolution?: string }).resolution || '')
          .trim()
          .toLowerCase();
        const seedreamResolution =
          resRaw === '2k' || resRaw === '3k' ? resRaw : undefined;
        submitUrl = `${this.runningHubApiBaseUrl}/seedream-v5-lite/text-to-image`;
        if (seedreamResolution) {
          submitPayload = {
            prompt: trimmedPrompt,
            sequentialImageGeneration: 'disabled',
            maxImages: 1,
            resolution: seedreamResolution,
          };
          console.log(
            `[图片生成] 使用 seedream-v5-文生图（国内 .cn），resolution: ${seedreamResolution}`,
          );
        } else {
          const { width, height } = resolveSeedreamPixelSize(
            'seedream-v5',
            aspect_ratio,
            Number((imageInput as any).seedreamWidth) || undefined,
            Number((imageInput as any).seedreamHeight) || undefined,
          );
          submitPayload = {
            prompt: trimmedPrompt,
            width,
            height,
            sequentialImageGeneration: 'disabled',
            maxImages: 1,
          };
          console.log(
            `[图片生成] 使用 seedream-v5-文生图（国内 .cn），width: ${width}, height: ${height}, aspect: ${aspect_ratio || ''}`,
          );
        }
      } else if (model === 'mj-v7') {
        // MJ V7 文生图（RunningHub AI App）：
        // POST /openapi/v2/run/ai-app/2049067169295638530
        // nodeId=9 value(prompt), nodeId=2 aspect_rate(value=比例)
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt) {
          throw new Error('MJ V7 提示词不能为空');
        }
        const validAspectRatiosMjV7 = ['auto', '1:1', '16:9', '16:10', '4:3', '3:2', '9:16', '10:16', '3:4', '2:3'];
        const finalAspectRatio = aspect_ratio && validAspectRatiosMjV7.includes(aspect_ratio) ? aspect_ratio : 'auto';
        submitUrl = `${this.runningHubApiBaseUrl}/run/ai-app/2049067169295638530`;
        submitPayload = {
          nodeInfoList: [
            { nodeId: '9', fieldName: 'value', fieldValue: trimmedPrompt, description: '提示词' },
            {
              nodeId: '2',
              fieldName: 'aspect_rate',
              fieldData: '[["auto","1:1","16:9","16:10","4:3","3:2","9:16","10:16","3:4","2:3"],{"default":"auto"}]',
              fieldValue: finalAspectRatio,
              description: '比例',
            },
          ],
          instanceType: 'default',
          usePersonalQueue: 'false',
        };
        console.log(`[图片生成] 使用 MJ V7 文生图，aspectRatio: ${finalAspectRatio}`);
      } else if (model === 'gpt-image-2') {
        // GPT image 2 文生图（RunningHub AI App）：
        // POST /openapi/v2/run/ai-app/2048342525672427521
        // nodeId=18 aspectRatio（fieldData 与工作流一致）+ nodeId=18 prompt
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt) {
          throw new Error('GPT image 2 提示词不能为空');
        }
        const gptImg2AspectFieldData =
          '[["empty", "3:2", "1:1", "2:3", "5:4", "4:5", "16:9", "9:16", "21:9", "3:4", "4:3"], {"default": "empty"}]';
        const validGptImg2Ratios = ['empty', '3:2', '1:1', '2:3', '5:4', '4:5', '16:9', '9:16', '21:9', '3:4', '4:3'];
        const finalAspectRatio =
          aspect_ratio && validGptImg2Ratios.includes(aspect_ratio) ? aspect_ratio : 'empty';
        submitUrl = `${this.runningHubApiBaseUrl}/run/ai-app/2048342525672427521`;
        submitPayload = {
          nodeInfoList: [
            {
              nodeId: '18',
              fieldName: 'aspectRatio',
              fieldData: gptImg2AspectFieldData,
              fieldValue: finalAspectRatio,
              description: 'aspectRatio',
            },
            {
              nodeId: '18',
              fieldName: 'prompt',
              fieldValue: trimmedPrompt,
              description: 'prompt',
            },
          ],
          instanceType: 'default',
          usePersonalQueue: 'false',
        };
        console.log(`[图片生成] 使用 GPT image 2 文生图，aspectRatio: ${finalAspectRatio}`);
      } else if (model === 'flux2-klein') {
        throw new Error('Flux2 Klein 仅支持图生图，请连接 1–3 张参考图');
      } else if (model === 'z-image') {
        if (isImageToImage) {
          throw new Error('Z-image 仅支持文生图，请勿传入参考图');
        }
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt) {
          throw new Error('Z-image 提示词不能为空');
        }
        const zTier = normalizeZImageResolutionTier((imageInput as { resolution?: string }).resolution);
        const aspectKey =
          aspect_ratio &&
          (Z_IMAGE_ASPECT_RATIOS as readonly string[]).includes(String(aspect_ratio).trim())
            ? aspect_ratio
            : '16:9';
        const { width, height } = zImageDimensionsForAspect(aspectKey, zTier);
        const Z_IMAGE_AI_APP_ID = '2059599553522921474';
        submitUrl = `${this.runningHubApiBaseUrl}/run/ai-app/${Z_IMAGE_AI_APP_ID}`;
        submitPayload = {
          nodeInfoList: [
            { nodeId: '32', fieldName: 'text', fieldValue: trimmedPrompt, description: 'text' },
            { nodeId: '37', fieldName: 'width', fieldValue: String(width), description: 'width' },
            { nodeId: '37', fieldName: 'height', fieldValue: String(height), description: 'height' },
          ],
          instanceType: 'default',
          usePersonalQueue: 'false',
          /** 供 FC 扣费查 OTS（RunningHub 会忽略未知字段） */
          model: 'z-image',
          resolution: zTier,
        };
        console.log(
          `[图片生成] 使用 Z-image 文生图，${width}×${height}（${zTier === '720p' ? '720P' : '1080P'}，比例 ${aspectKey}）`,
        );
      } else if (model === 'lens') {
        if (isImageToImage) {
          throw new Error('Lens 仅支持文生图，请勿传入参考图');
        }
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt) {
          throw new Error('Lens 提示词不能为空');
        }
        const lensTier = normalizeZImageResolutionTier((imageInput as { resolution?: string }).resolution);
        const aspectKey =
          aspect_ratio &&
          (Z_IMAGE_ASPECT_RATIOS as readonly string[]).includes(String(aspect_ratio).trim())
            ? aspect_ratio
            : '9:16';
        const { width, height } = zImageDimensionsForAspect(aspectKey, lensTier);
        const LENS_AI_APP_ID = '2063798801864945666';
        submitUrl = `${this.runningHubApiBaseUrl}/run/ai-app/${LENS_AI_APP_ID}`;
        submitPayload = {
          nodeInfoList: [
            { nodeId: '3', fieldName: 'text', fieldValue: trimmedPrompt, description: 'text' },
            { nodeId: '8', fieldName: 'width', fieldValue: String(width), description: 'width' },
            { nodeId: '8', fieldName: 'height', fieldValue: String(height), description: 'height' },
          ],
          instanceType: 'plus', // Lens：48G 显存
          usePersonalQueue: 'false',
          model: 'lens',
          resolution: lensTier,
        };
        console.log(
          `[图片生成] 使用 Lens 文生图，${width}×${height}（${lensTier === '720p' ? '720P' : '1080P'}，比例 ${aspectKey}）`,
        );
      } else if (model === 'youchuan-text-to-image-v7') {
        // 文悠船文生图-v7：https://www.runninghub.cn/openapi/v2/youchuan/text-to-image-v7
        let finalAspectRatio = aspect_ratio && validAspectRatiosYouchuan.includes(aspect_ratio) ? aspect_ratio : '1:1';
        submitUrl = `${this.runningHubApiBaseUrl}/youchuan/text-to-image-v7`;
        submitPayload = {
          prompt: prompt,
          negativePrompt: (imageInput.negativePrompt as string) || '',
          chaos: 0,
          stylize: 0,
          weird: 0,
          raw: false,
          imageUrl: '',
          iw: 1,
          sref: '',
          sw: 100,
          sv: 4,
          oref: '',
          ow: 100,
          tile: false,
          aspectRatio: finalAspectRatio,
        };
        // 可选：传入一张参考图时作为 imageUrl
        const firstImage = imageInput.image ? (Array.isArray(imageInput.image) ? imageInput.image[0] : imageInput.image) : '';
        if (firstImage) {
          let imageUrlForYouchuan: string;
          if (firstImage.startsWith('http://') || firstImage.startsWith('https://')) {
            imageUrlForYouchuan = firstImage;
          } else {
            let imageBuffer: Buffer;
            let mimeType = 'image/png';
            if (firstImage.startsWith('local-resource://') || firstImage.startsWith('file://')) {
              let filePath = firstImage.startsWith('local-resource://') ? firstImage.replace(/^local-resource:\/\//, '') : firstImage.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[/\\]+[a-zA-Z]:[/\\]/)) filePath = filePath.replace(/^[/\\]+/, '');
              if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              let normalizedFilePath = path.normalize(filePath);
              if (!path.isAbsolute(normalizedFilePath)) normalizedFilePath = path.resolve(userDataPath, normalizedFilePath);
              if (!isLocalResourcePathAllowed(normalizedFilePath)) throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
            } else if (firstImage.startsWith('data:image/')) {
              const base64Data = firstImage.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = firstImage.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            } else {
              throw new Error(`不支持的图片 URL 格式: ${firstImage.substring(0, 50)}`);
            }
            const { VideoProvider } = await import('./VideoProvider.js');
            const videoProvider = new VideoProvider();
            imageUrlForYouchuan = await videoProvider.uploadImageToOSS(imageBuffer, mimeType);
          }
          submitPayload.imageUrl = imageUrlForYouchuan;
          submitPayload.iw = 1;
        }
        console.log(`[图片生成] 使用文悠船文生图-v7，aspectRatio: ${submitPayload.aspectRatio}`);
      } else if (model === 'youchuan-text-to-image-v81') {
        // 悠船文生图-v8.1：海外 https://www.runninghub.ai/openapi/v2/youchuan/text-to-image-v81
        const trimmedPrompt = prompt.trim();
        if (!trimmedPrompt || trimmedPrompt.length > 8192) {
          throw new Error('悠船 v8.1 提示词长度为 1-8192 字');
        }
        let finalAspectRatio =
          aspect_ratio && validAspectRatiosYouchuan.includes(aspect_ratio) ? aspect_ratio : '1:1';
        const resRaw = String((imageInput as any).resolution || '').trim().toLowerCase();
        const hd =
          (imageInput as any).hd === true ||
          resRaw === 'hd' ||
          resRaw === '2k' ||
          resRaw === 'true';
        const qualityRaw = String((imageInput as any).quality || '1').trim();
        const quality = qualityRaw === '4' ? '4' : '1';
        submitUrl = `${this.runningHubApiBaseUrl}/youchuan/text-to-image-v81`;
        submitPayload = {
          prompt: trimmedPrompt,
          chaos: Math.max(0, Math.min(100, Number((imageInput as any).chaos) || 0)),
          quality,
          stylize: Math.max(0, Math.min(1000, Number((imageInput as any).stylize) || 0)),
          raw: !!(imageInput as any).raw,
          imageUrl: null,
          iw: 1,
          sref: null,
          sw: 100,
          sv: 6,
          aspectRatio: finalAspectRatio,
          hd,
        };
        const firstImage = imageInput.image
          ? Array.isArray(imageInput.image)
            ? imageInput.image[0]
            : imageInput.image
          : '';
        if (firstImage) {
          let imageUrlForYouchuan: string;
          if (firstImage.startsWith('http://') || firstImage.startsWith('https://')) {
            imageUrlForYouchuan = firstImage;
          } else {
            let imageBuffer: Buffer;
            let mimeType = 'image/png';
            if (firstImage.startsWith('local-resource://') || firstImage.startsWith('file://')) {
              let filePath = firstImage.startsWith('local-resource://')
                ? firstImage.replace(/^local-resource:\/\//, '')
                : firstImage.replace(/^file:\/\//, '');
              if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':')
                filePath = filePath.slice(1);
              filePath = decodeURIComponent(filePath);
              if (filePath.match(/^[/\\]+[a-zA-Z]:[/\\]/)) filePath = filePath.replace(/^[/\\]+/, '');
              if (filePath.match(/^[a-zA-Z]\//))
                filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
              const userDataPath = app.getPath('userData');
              let normalizedFilePath = path.normalize(filePath);
              if (!path.isAbsolute(normalizedFilePath))
                normalizedFilePath = path.resolve(userDataPath, normalizedFilePath);
              if (!isLocalResourcePathAllowed(normalizedFilePath))
                throw new Error(`访问路径超出允许范围: ${filePath}`);
              if (!fs.existsSync(normalizedFilePath))
                throw new Error(`文件不存在: ${normalizedFilePath}`);
              imageBuffer = fs.readFileSync(normalizedFilePath);
              const ext = path.extname(normalizedFilePath).toLowerCase();
              mimeType =
                ext === '.jpg' || ext === '.jpeg'
                  ? 'image/jpeg'
                  : ext === '.webp'
                    ? 'image/webp'
                    : 'image/png';
            } else if (firstImage.startsWith('data:image/')) {
              const base64Data = firstImage.split(',')[1];
              if (!base64Data) throw new Error('Base64 Data URL 格式无效');
              imageBuffer = Buffer.from(base64Data, 'base64');
              const mimeMatch = firstImage.match(/^data:image\/(\w+);base64,/);
              mimeType = mimeMatch ? `image/${mimeMatch[1]}` : 'image/png';
            } else {
              throw new Error(`不支持的图片 URL 格式: ${firstImage.substring(0, 50)}`);
            }
            const { VideoProvider } = await import('./VideoProvider.js');
            const videoProvider = new VideoProvider();
            imageUrlForYouchuan = await videoProvider.uploadImageToOSS(imageBuffer, mimeType);
          }
          submitPayload.imageUrl = imageUrlForYouchuan;
          submitPayload.iw = Math.max(0, Math.min(3, Number((imageInput as any).iw) || 1));
        }
        console.log(
          `[图片生成] 使用悠船文生图-v8.1，aspectRatio: ${finalAspectRatio}, hd: ${hd}, quality: ${quality}`,
        );
      } else {
        throw new Error(`不支持的图片模型：${model}。请改用面板中的活跃模型。`);
      }

      console.log('[图片生成] 提交任务到 RunningHub API:', submitUrl, submitPayload);

      const billingModelIdForCharge =
        model === 'z-image'
          ? zImageBillingModelId((imageInput as { resolution?: string }).resolution)
          : model === 'lens'
            ? lensBillingModelId((imageInput as { resolution?: string }).resolution)
            : model;
      if (model === 'z-image') {
        console.log(
          `[图片生成] Z-image 扣费 model_id=${billingModelIdForCharge}，分辨率档位=${normalizeZImageResolutionTier((imageInput as { resolution?: string }).resolution)}`,
        );
      }
      if (model === 'lens') {
        console.log(
          `[图片生成] Lens 扣费 model_id=${billingModelIdForCharge}，分辨率档位=${normalizeZImageResolutionTier((imageInput as { resolution?: string }).resolution)}`,
        );
      }

      const fcGenIdTxt = randomUUID();
      const perfStartTxt = Date.now();
      const ledgerIdTxt = await this.ensureLedgerImageTask(nodeId, billingModelIdForCharge, imageInput, prompt, {
        resolution: (imageInput as { resolution?: string }).resolution,
        aspectRatio: (submitPayload as { aspectRatio?: string }).aspectRatio ?? aspect_ratio,
      });
      const perfCreateDoneTxt = Date.now();
      // Flux 已在上方文生分支硬拒，此处勿再比较（TS 会判定无重叠）
      const rhRegionTxt: 'cn' | 'ai' | undefined =
        model === 'youchuan-text-to-image-v81' ||
        model === 'banana-2.0' ||
        model === 'rhart-image-g' ||
        model === 'rhart-image-g-2'
          ? 'ai'
          : model === 'seedream-v5'
            ? 'cn'
            : undefined;
      console.log(
        `[图片生成] 经 FC 转发 RunningHub path=${this.pathFromRunningHubUrl(submitUrl)} billingModelId=${billingModelIdForCharge} ledger=${ledgerIdTxt ?? '(run-task 内扣费)'} rhRegion=${rhRegionTxt ?? 'auto'}`,
      );
      const submitResultTxt = await this.rhPostCharge(
        submitUrl,
        submitPayload as Record<string, unknown>,
        fcGenIdTxt,
        billingModelIdForCharge,
        ledgerIdTxt,
        rhRegionTxt,
      );
      const perfForwardDoneTxt = Date.now();
      fcChargedTaskId = ledgerIdTxt || fcGenIdTxt;

      const rhTaskIdTxt =
        submitResultTxt.taskId ||
        submitResultTxt.task_id ||
        (submitResultTxt.data as { taskId?: string } | undefined)?.taskId ||
        (submitResultTxt.result as { taskId?: string } | undefined)?.taskId;

      if (!rhTaskIdTxt) {
        const errMsg = submitResultTxt.error || submitResultTxt.errorMessage || submitResultTxt.message || submitResultTxt.msg ||
          (submitResultTxt.code !== undefined && submitResultTxt.code !== 0 ? `错误码 ${submitResultTxt.code}，${submitResultTxt.message || submitResultTxt.msg || ''}` : '') ||
          'API 未返回任务 ID';
        console.error('[图片生成] submit 未返回 taskId，立刻上报 ERROR:', errMsg);
        onStatus({ nodeId, status: 'ERROR', payload: { error: `提交任务失败：${errMsg}`, progress: 0 } });
        throw new Error(`提交任务失败：${errMsg}`);
      }

      console.log(`[图片生成] 已通过 FC 转发至 RunningHub，taskId: ${String(rhTaskIdTxt)}`);

      rhPollTaskIdRef.current = String(rhTaskIdTxt);
      onStatus({
        nodeId,
        status: 'PROCESSING',
        payload: {
          progress: progressEngine.getProgress(),
          text: progressEngine.getMessage(),
          taskId: rhPollTaskIdRef.current,
        },
      });

      let imageUrl: string | null = null;
      let outputImageUrls: string[] = [];
      const maxPollingAttempts = 120;
      let pollingAttempts = 0;
      let successWithoutUrlRounds = 0;
      const pollStartTimeText = Date.now();
      let perfPollDoneTxt = 0;

      while (pollingAttempts < maxPollingAttempts) {
        const pollSleepMs = imageRhPollSleepMs(pollingAttempts, pollStartTimeText);
        if (pollSleepMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, pollSleepMs));
        }

        onStatus({
          nodeId,
          status: 'PROCESSING',
          payload: {
            progress: Math.min(92, 18 + pollingAttempts * 2),
            text: '生成中…',
            taskId: rhPollTaskIdRef.current,
          },
        });

        try {
          const queryResult = await this.rhQueryPoll(
            String(rhTaskIdTxt),
            `${fcGenIdTxt}:poll:${pollingAttempts}`,
            rhRegionTxt,
          );
          const qd = queryResult as Record<string, unknown>;
          const status = resolveRhPollStatus(qd);
          const rawStatus = String(queryResult.status ?? queryResult.taskStatus ?? '');

          console.log(`[图片生成] 任务状态: ${rawStatus || status}, taskId: ${String(rhTaskIdTxt)}`);

          if (status === 'SUCCESS') {
            outputImageUrls = extractImageUrlsFromRhPoll(qd);
            imageUrl = outputImageUrls[0] ?? null;
            if (!imageUrl) {
              successWithoutUrlRounds += 1;
              console.warn(
                `[图片生成] SUCCESS 但未解析到图片 URL，继续查询 (${successWithoutUrlRounds}/${MAX_SUCCESS_WITHOUT_URL_ROUNDS}) taskId=${String(rhTaskIdTxt)}`,
              );
              if (successWithoutUrlRounds >= MAX_SUCCESS_WITHOUT_URL_ROUNDS) {
                throw new Error('任务完成但未返回结果');
              }
              pollingAttempts++;
              continue;
            }
            perfPollDoneTxt = Date.now();
            if (ledgerIdTxt) {
              void syncLedgerAfterRhImageSuccess(String(rhTaskIdTxt), ledgerIdTxt);
            }
            console.log(`[图片生成] 任务完成，图片 URL: ${imageUrl}`);
            break;
          } else if (status === 'FAILURE' || status === 'FAILED') {
            const errorMessage = String(queryResult.errorMessage || '任务失败');
            const errorCode = String(queryResult.errorCode || '');
            const failedReason = (queryResult.failedReason || {}) as Record<string, unknown>;

            let detailedError = errorMessage;
            if (errorCode) {
              detailedError = `[错误码: ${errorCode}] ${errorMessage}`;
            }

            if (failedReason && Object.keys(failedReason).length > 0) {
              detailedError += ` | 失败详情: ${JSON.stringify(failedReason)}`;
            }

            console.error(`[图片生成] 任务失败，错误码: ${errorCode}, 错误信息: ${errorMessage}`);
            if (Object.keys(failedReason).length > 0) {
              console.error(`[图片生成] 失败详情:`, JSON.stringify(failedReason, null, 2));
            }

            throw new Error(detailedError);
          } else if (
            status === 'IN_PROGRESS' ||
            status === 'NOT_START' ||
            rawStatus === 'RUNNING' ||
            rawStatus === 'QUEUED'
          ) {
            console.log(`[图片生成] 任务处理中，状态: ${rawStatus || status}`);
            pollingAttempts++;
            continue;
          } else {
            console.warn(`[图片生成] 未知任务状态: ${rawStatus || status}`);
            pollingAttempts++;
            continue;
          }
        } catch (queryError: any) {
          console.error(`[图片生成] 查询任务状态时出错:`, queryError);
          pollingAttempts++;
          if (queryError.response && queryError.response.status !== 200) {
            continue;
          }
          if (isRetryableImageQueryError(queryError)) {
            continue;
          }
          throw queryError;
        }
      }

      if (!imageUrl) {
        throw new Error('任务超时：超过最大轮询次数');
      }

      // 自动下载并保存图片到本地（多图时逐张落盘）
      let localPath: string | undefined;
      let finalImageUrl = imageUrl;
      let finalOutputImages = outputImageUrls.length > 0 ? outputImageUrls : [imageUrl].filter(Boolean);

      if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        try {
          const projectId = (input as any)?.projectId;
          const nodeTitle = (input as any)?.nodeTitle || 'image';
          const downloaded = await downloadRhOutputImagesToLocal(
            outputImageUrls,
            imageUrl,
            { nodeId, nodeTitle, projectId, prompt, model },
          );
          finalImageUrl = downloaded.finalImageUrl;
          finalOutputImages = downloaded.outputImages;
          localPath = downloaded.localPath;
          if (localPath) {
            console.log(`[图片生成] 图片已自动下载到本地: ${localPath}`);
          }
        } catch (downloadError) {
          console.error(`[图片生成] 自动下载图片失败:`, downloadError);
        }
      }
      
      const nowTxt = Date.now();
      const createMsTxt = perfCreateDoneTxt - perfStartTxt;
      const forwardMsTxt = perfForwardDoneTxt - perfCreateDoneTxt;
      const pollMsTxt = (perfPollDoneTxt || nowTxt) - perfForwardDoneTxt;
      const downloadMsTxt = perfPollDoneTxt > 0 ? nowTxt - perfPollDoneTxt : 0;
      console.log(
        `[图片生成] 耗时 t2i create=${createMsTxt}ms forward=${forwardMsTxt}ms poll=${pollMsTxt}ms download=${downloadMsTxt}ms total=${nowTxt - perfStartTxt}ms`,
      );

      clearProgress(); // 清除进度更新循环
      onStatus({
        nodeId,
        status: 'SUCCESS',
        payload: {
          imageUrl: finalImageUrl, // 优先使用本地路径
          originalImageUrl: imageUrl, // 保存原始远程 URL
          outputImages: finalOutputImages,
          originalImageUrls: outputImageUrls.length > 0 ? outputImageUrls : [imageUrl].filter(Boolean),
          localPath: localPath, // 传递本地路径
          progress: 100, // 设置为 100% 表示完成
        },
      });
    } catch (error: any) {
      void tryRefundFcForwardCharge(fcChargedTaskId, 'image', 'execute_failed');
      console.error('[图片生成] ========== 发生错误 ==========');
      console.error('[图片生成] 错误对象:', error);
      console.error('[图片生成] 错误堆栈:', error.stack);
      console.error('[图片生成] 错误消息:', error.message);

      // 异常处理：打印最真实的错误原因
      if (error.response) {
        console.error('[图片生成] API 错误响应状态:', error.response.status, error.response.statusText);
        console.error('[图片生成] API 错误响应 Headers:', JSON.stringify(error.response.headers, null, 2));
        console.error('[图片生成] API 错误响应数据:', JSON.stringify(error.response.data, null, 2));
        console.error('[图片生成] error.response.data 完整内容:', error.response.data);
      } else if (error.request) {
        console.error('[图片生成] 请求发送失败，服务器无响应');
        console.error('[图片生成] 请求对象:', error.request);
        console.error('[图片生成] 错误消息:', error.message);
      } else {
        console.error('[图片生成] 请求配置错误');
        console.error('[图片生成] 错误消息:', error.message);
      }

      // 提取错误信息
      let errorMsg = error.message || '图片生成失败';
      
      // 尝试从不同位置提取错误信息
      if (error.response?.data) {
        const responseData = error.response.data;
        
        // 优先提取 errorMessage
        if (responseData.errorMessage) {
          errorMsg = responseData.errorMessage;
          // 如果有 errorCode，添加到错误信息中
          if (responseData.errorCode) {
            errorMsg = `[错误码: ${responseData.errorCode}] ${errorMsg}`;
          }
          // 如果有 failedReason，添加到错误信息中
          if (responseData.failedReason && Object.keys(responseData.failedReason).length > 0) {
            errorMsg += ` | 失败详情: ${JSON.stringify(responseData.failedReason)}`;
          }
        } else if (responseData.error?.message) {
          errorMsg = responseData.error.message;
        } else if (responseData.message) {
          errorMsg = responseData.message;
        } else if (typeof responseData === 'string') {
          errorMsg = responseData;
        } else {
          errorMsg = JSON.stringify(responseData);
        }
      }
      
      console.error('[图片生成] 最终错误信息:', errorMsg);
      console.error('[图片生成] =================================');

      clearProgress(); // 清除进度更新循环
      const fcPayload = buildFcErrorPayload(
        error,
        errorMsg.includes('图片生成失败') ? errorMsg : `图片生成失败: ${errorMsg}`,
      );
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: {
          ...fcPayload,
          progress: 0, // 错误时重置进度
        },
      });
    }
  }
}
