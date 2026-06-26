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
import { getCloudAiBlockReason } from '../../utils/cloudAiGate.js';
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
}

function extractImageUrlsFromResults(results: unknown): string[] {
  if (!Array.isArray(results)) return [];
  return results
    .map((it) => {
      const rec = it as { url?: unknown; outputType?: unknown };
      const out = String(rec?.outputType ?? '').trim().toLowerCase();
      const u = typeof rec?.url === 'string' ? rec.url : '';
      if (!u) return '';
      if (out && !['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(out)) return '';
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
      },
      bid ? { billingModelId: bid } : undefined,
    );
    return data;
  }

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
      let r: { task_id: string; balance: number };
      try {
        r = await createOnce();
      } catch (firstErr) {
        const msg = firstErr instanceof Error ? firstErr.message : String(firstErr);
        if (msg.includes('401') || msg.includes('未授权') || /UNAUTHORIZED/i.test(msg)) {
          const { refreshNxAccessToken } = await import('../../services/aliyunService.js');
          const refreshed = await refreshNxAccessToken();
          if (refreshed) {
            r = await createOnce();
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
      const { notifyNxCloudTaskTrack } = await import('../../nxCloudTaskTrackNotifier.js');
      notifyNxCloudTaskTrack({ taskId: r.task_id, nodeId, taskType: 'image', balance: r.balance });
      return r.task_id;
    } catch (e) {
      console.warn('[ImageProvider] /tasks/create 失败，回退为 run-task 内扣费（RunningHub 仍经 FC 转发）', e);
      return null;
    }
  }

  /** 轮询 RH 状态；ledger 仅在 SUCCESS 后由 syncLedgerAfterRhImageSuccess 一次性回写 */
  private rhQueryPoll(rhTaskId: string, fcPollId: string): Promise<Record<string, unknown>> {
    return rhQueryPollImage(rhTaskId, fcPollId);
  }

  /**
   * 将历史分辨率字段统一映射为 RunningHub 要求的 1k/2k/4k
   */
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
      onStatus({ nodeId, status: 'ERROR', payload: { error: cloudBlock } });
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
        model = 'banana-2.0', 
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
      ]);
      if (retiredImageModels.has(String(model))) {
        throw new Error('该图片模型（Nano banana / Seedream 4.5）已从前端下架，请在面板中改用 banana 2.0、Seedream v5 等模型。');
      }

      // 判断是文生图还是图生图
      // 默认优先文生图模式，只有当有输入图片时才切换到图生图模式
      const isImageToImage = !!imageInput.image && (Array.isArray(imageInput.image) ? imageInput.image.length > 0 : true);
      
      console.log(`[图片生成] 模式: ${isImageToImage ? '图生图' : '文生图'}, 模型: ${model}, 参考图数量: ${isImageToImage ? (Array.isArray(imageInput.image) ? imageInput.image.length : 1) : 0}`);

      // 图生图模式：使用 RunningHub API（插件算力）。文悠船/MJ V7 仅文生图；GPT image 2 图生图走独立 AI App；
      // seedream-v4.5 / banana 2.0 / 全能图片PRO 共用下方 imageUrls 与轮询
      if (
        isImageToImage &&
        imageInput.image &&
        model !== 'youchuan-text-to-image-v7' &&
        model !== 'mj-v7' &&
        model !== 'z-image' &&
        model !== 'lens'
      ) {
        // 图生图模式使用 RunningHub API（经 FC 转发）
        // 检查图片数量（GPT image 2 最多 2 张；全能图片PRO 最多5张；seedream-v4.5 / seedream-v5 / banana2.0 最多10张）
        const imageArray = Array.isArray(imageInput.image) ? imageInput.image : [imageInput.image];
        const maxImagesAllowed =
          model === 'flux2-klein'
            ? 3
            : model === 'gpt-image-2'
              ? 2
              : model === 'seedream-v4.5' || model === 'seedream-v5' || model === 'banana-2.0'
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
          // seedream-v4.5-图生图：宽高由输入栏填写，范围 1024-4096
          const trimmedPrompt = prompt.trim();
          if (trimmedPrompt.length < 5 || trimmedPrompt.length > 2000) {
            throw new Error('seedream-v4.5-图生图 提示词长度为 5-2000 字');
          }
          const minS = 1024;
          const maxS = 4096;
          const width = Math.max(minS, Math.min(maxS, Number((imageInput as any).seedreamWidth) || 2048));
          const height = Math.max(minS, Math.min(maxS, Number((imageInput as any).seedreamHeight) || 2048));
          submitUrl = `${this.runningHubApiBaseUrl}/seedream-v4.5/image-to-image`;
          submitPayload = {
            prompt: trimmedPrompt,
            width,
            height,
            imageUrls: imageUrls,
            maxImages: 1,
          };
          console.log(`[图片生成] 提交图生图任务到 RunningHub API（seedream-v4.5/image-to-image），width: ${width}, height: ${height}, 图片数量: ${imageUrls.length}`);
        } else if (model === 'seedream-v5') {
          // seedream-v5-图生图：https://www.runninghub.cn/openapi/v2/seedream-v5-lite/image-to-image
          // 参数：prompt(5-2000字), width(1600-4704), height(1344-4096), imageUrls(最多10张), maxImages(1-15)
          const trimmedPrompt = prompt.trim();
          if (trimmedPrompt.length < 5 || trimmedPrompt.length > 2000) {
            throw new Error('seedream-v5-图生图 提示词长度为 5-2000 字');
          }
          const minW = 1600;
          const maxW = 4704;
          const minH = 1344;
          const maxH = 4096;
          const width = Math.max(minW, Math.min(maxW, Number((imageInput as any).seedreamWidth) || 2048));
          const height = Math.max(minH, Math.min(maxH, Number((imageInput as any).seedreamHeight) || 2048));
          submitUrl = `${this.runningHubApiBaseUrl}/seedream-v5-lite/image-to-image`;
          submitPayload = {
            prompt: trimmedPrompt,
            width,
            height,
            imageUrls,
            maxImages: 1,
          };
          console.log(`[图片生成] 提交图生图任务到 RunningHub API（seedream-v5/image-to-image），width: ${width}, height: ${height}, 图片数量: ${imageUrls.length}`);
        } else if (model === 'banana-2.0') {
          // banana 2.0 图生图：https://www.runninghub.cn/openapi/v2/rhart-image-n-g31-flash/image-to-image
          const validAspectRatios = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
          const finalAspectRatio = aspect_ratio && validAspectRatios.includes(aspect_ratio) ? aspect_ratio : '1:1';
          const finalResolution = this.toRunningHubResolution((imageInput as any).resolution);
          submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-n-g31-flash/image-to-image`;
          submitPayload = {
            imageUrls,
            prompt: prompt.trim(),
            resolution: finalResolution,
            aspectRatio: finalAspectRatio,
          };
          console.log(`[图片生成] 提交图生图任务到 RunningHub API（rhart-image-n-g31-flash/image-to-image），resolution: ${finalResolution}, aspectRatio: ${finalAspectRatio}, 图片数量: ${imageUrls.length}`);
        } else {
          // 全能图片PRO 图生图：/rhart-image-n-pro/edit
          const validAspectRatios = ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
          let finalAspectRatio = aspect_ratio || 'auto';
          if (!validAspectRatios.includes(finalAspectRatio)) {
            finalAspectRatio = 'auto';
            console.warn(`[图片生成] 无效的 aspect_ratio: ${aspect_ratio}，使用默认值 auto`);
          }
          let editResolution: '1k' | '2k' | '4k' = '1k';
          if (model === 'nano-banana') {
            editResolution = this.toRunningHubResolution((imageInput as any).resolution);
          } else if (model === 'nano-banana-2-2k') {
            editResolution = '2k';
          } else if (model === 'nano-banana-2-4k') {
            editResolution = '4k';
          }
          submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-n-pro/edit`;
          submitPayload = {
            prompt: prompt,
            aspectRatio: finalAspectRatio,
            imageUrls: imageUrls,
            resolution: editResolution,
          };
          console.log(`[图片生成] 提交图生图任务到 RunningHub API（rhart-image-n-pro/edit），resolution: ${editResolution}, aspectRatio: ${finalAspectRatio}, 图片数量: ${imageUrls.length}`);
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
            );
            const status = resolveRhPollStatus(queryResult as Record<string, unknown>);
            const rawStatus = String(queryResult.status ?? '');

            console.log(`[图片生成] 任务状态: ${rawStatus || status}, taskId: ${String(rhTaskIdI2I)}`);

            if (status === 'SUCCESS') {
              outputImageUrls = extractImageUrlsFromRhPoll(queryResult as Record<string, unknown>);
              imageUrl = outputImageUrls[0] ?? null;
              if (!imageUrl) {
                throw new Error('任务完成但未返回结果');
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
            const code = (queryError as { code?: string })?.code;
            if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED') {
              continue;
            }
            throw queryError;
          }
        }
        
        if (!imageUrl) {
          throw new Error('任务超时：超过最大轮询次数');
        }
        
        // 自动下载并保存图片到本地
        let localPath: string | undefined;
        let finalImageUrl = imageUrl;
        
        if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
          try {
            // 自动下载图片到本地
            const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
            // 从 input 中获取项目 ID 和节点标题（如果存在）
            const projectId = (input as any)?.projectId;
            const nodeTitle = (input as any)?.nodeTitle || 'image';
            
            const downloadedPath = await autoDownloadResource(
              imageUrl,
              'image',
              {
                resourceType: 'image',
                nodeId: nodeId,
                nodeTitle: nodeTitle,
                projectId: projectId,
                prompt: prompt,
                model: model,
              }
            );
            
            if (downloadedPath) {
              localPath = downloadedPath;
              // 使用本地路径作为最终 URL
              finalImageUrl = `local-resource://${downloadedPath.replace(/\\/g, '/')}`;
              console.log(`[图片生成] 图片已自动下载到本地: ${localPath}`);
            }
          } catch (downloadError) {
            console.error(`[图片生成] 自动下载图片失败:`, downloadError);
            // 下载失败不影响图片显示，继续使用远程 URL
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
            outputImages: outputImageUrls.length > 0 ? outputImageUrls : [imageUrl].filter(Boolean),
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

      if (model === 'banana-2.0') {
        // banana 2.0 文生图：https://www.runninghub.cn/openapi/v2/rhart-image-n-g31-flash/text-to-image
        const validAspectRatiosBanana = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'];
        const finalAspectRatio = aspect_ratio && validAspectRatiosBanana.includes(aspect_ratio) ? aspect_ratio : '1:1';
        const finalResolution = this.toRunningHubResolution((imageInput as any).resolution);
        submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-n-g31-flash/text-to-image`;
        submitPayload = {
          prompt: prompt.trim(),
          resolution: finalResolution,
          aspectRatio: finalAspectRatio,
        };
        console.log(`[图片生成] 使用 banana 2.0 文生图，resolution: ${finalResolution}, aspectRatio: ${finalAspectRatio}`);
      } else if (model === 'seedream-v4.5') {
        // seedream-v4.5-文生图：宽高由输入栏填写，范围 1024-4096
        if (isImageToImage) {
          throw new Error('seedream-v4.5 仅支持文生图，请勿传入参考图');
        }
        const trimmedPrompt = prompt.trim();
        if (trimmedPrompt.length < 5 || trimmedPrompt.length > 2000) {
          throw new Error('seedream-v4.5 提示词长度为 5-2000 字');
        }
        const minS = 1024;
        const maxS = 4096;
        const width = Math.max(minS, Math.min(maxS, Number((imageInput as any).seedreamWidth) || 2048));
        const height = Math.max(minS, Math.min(maxS, Number((imageInput as any).seedreamHeight) || 2048));
        submitUrl = `${this.runningHubApiBaseUrl}/seedream-v4.5/text-to-image`;
        submitPayload = {
          prompt: trimmedPrompt,
          width,
          height,
          maxImages: 1,
        };
        console.log(`[图片生成] 使用 seedream-v4.5-文生图，width: ${width}, height: ${height}`);
      } else if (model === 'seedream-v5') {
        // seedream-v5-文生图：https://www.runninghub.cn/openapi/v2/seedream-v5-lite/text-to-image
        // 参数：prompt(5-2000字), width(1600-4704), height(1344-4096), maxImages(1-15)
        // 注：有参考图时走上方图生图分支
        const trimmedPrompt = prompt.trim();
        if (trimmedPrompt.length < 5 || trimmedPrompt.length > 2000) {
          throw new Error('seedream-v5 提示词长度为 5-2000 字');
        }
        const minW = 1600;
        const maxW = 4704;
        const minH = 1344;
        const maxH = 4096;
        const width = Math.max(minW, Math.min(maxW, Number((imageInput as any).seedreamWidth) || 2048));
        const height = Math.max(minH, Math.min(maxH, Number((imageInput as any).seedreamHeight) || 2048));
        submitUrl = `${this.runningHubApiBaseUrl}/seedream-v5-lite/text-to-image`;
        submitPayload = {
          prompt: trimmedPrompt,
          width,
          height,
          maxImages: 1,
        };
        console.log(`[图片生成] 使用 seedream-v5-文生图，width: ${width}, height: ${height}`);
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
      } else {
        // 全能图片PRO 文生图：rhart-image-n-pro/text-to-image
        let resolution: '1k' | '2k' | '4k' = '1k';
        if (model === 'nano-banana') {
          resolution = this.toRunningHubResolution((imageInput as any).resolution);
        } else if (model === 'nano-banana-2-2k') {
          resolution = '2k';
        } else if (model === 'nano-banana-2-4k') {
          resolution = '4k';
        }
        let finalAspectRatio = aspect_ratio && validAspectRatiosRhart.includes(aspect_ratio) ? aspect_ratio : '1:1';
        submitUrl = `${this.runningHubApiBaseUrl}/rhart-image-n-pro/text-to-image`;
        submitPayload = {
          prompt: prompt,
          resolution: resolution,
        };
        if (finalAspectRatio) submitPayload.aspectRatio = finalAspectRatio;
        console.log(`[图片生成] 使用 RunningHub API，模型: ${model}, resolution: ${resolution}, aspectRatio: ${finalAspectRatio}`);
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
      console.log(
        `[图片生成] 经 FC 转发 RunningHub path=${this.pathFromRunningHubUrl(submitUrl)} billingModelId=${billingModelIdForCharge} ledger=${ledgerIdTxt ?? '(run-task 内扣费)'}`,
      );
      const submitResultTxt = await this.rhPostCharge(
        submitUrl,
        submitPayload as Record<string, unknown>,
        fcGenIdTxt,
        billingModelIdForCharge,
        ledgerIdTxt,
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
          );
          const qd = queryResult as Record<string, unknown>;
          const status = resolveRhPollStatus(qd);
          const rawStatus = String(queryResult.status ?? '');

          console.log(`[图片生成] 任务状态: ${rawStatus || status}, taskId: ${String(rhTaskIdTxt)}`);

          if (status === 'SUCCESS') {
            outputImageUrls = extractImageUrlsFromRhPoll(qd);
            imageUrl = outputImageUrls[0] ?? null;
            if (!imageUrl) throw new Error('任务完成但未返回结果');
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
          
          // 如果是网络错误，继续重试；如果是业务错误，抛出异常
          if (queryError.response && queryError.response.status !== 200) {
            // 业务错误，继续重试
            continue;
          } else if (queryError.code === 'ETIMEDOUT' || queryError.code === 'ECONNREFUSED') {
            // 网络错误，继续重试
            continue;
          } else {
            // 其他错误，抛出异常
            throw queryError;
          }
        }
      }

      if (!imageUrl) {
        throw new Error('任务超时：超过最大轮询次数');
      }

      // 自动下载并保存图片到本地
      let localPath: string | undefined;
      let finalImageUrl = imageUrl;

      if (imageUrl && (imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        try {
          // 自动下载图片到本地
          const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
          // 从 input 中获取项目 ID 和节点标题（如果存在）
          const projectId = (input as any)?.projectId;
          const nodeTitle = (input as any)?.nodeTitle || 'image';
          
          const downloadedPath = await autoDownloadResource(
            imageUrl,
            'image',
            {
              resourceType: 'image',
              nodeId: nodeId,
              nodeTitle: nodeTitle,
              projectId: projectId,
              prompt: prompt,
              model: model,
            }
          );
          
          if (downloadedPath) {
            localPath = downloadedPath;
            // 使用本地路径作为最终 URL
            finalImageUrl = `local-resource://${downloadedPath.replace(/\\/g, '/')}`;
            console.log(`[图片生成] 图片已自动下载到本地: ${localPath}`);
          }
        } catch (downloadError) {
          console.error(`[图片生成] 自动下载图片失败:`, downloadError);
          // 下载失败不影响图片显示，继续使用远程 URL
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
          outputImages: outputImageUrls.length > 0 ? outputImageUrls : [imageUrl].filter(Boolean),
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
