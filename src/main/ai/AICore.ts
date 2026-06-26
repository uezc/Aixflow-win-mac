/**
 * AI 插件化架构 - 主进程调度中控
 * 唯一入口：监听 ai:invoke IPC 通道
 * 路由逻辑：根据 modelId 从 Registry 查找对应的 Provider 并执行
 */

import { BrowserWindow } from 'electron';
import { AIInvokeParams, AIStatusPacket } from './types.js';
import { getProvider } from './Registry.js';
import { getBLTCYBalance, getRHBalance } from '../services/balance.js';
import { autoDownloadResource } from '../utils/resourceDownloader.js';
import { recordTaskHistory, TaskType } from '../services/taskHistory.js';
import { pollRunningHubVideoUntilTerminal } from '../utils/runningHubVideoQueryResume.js';
import { pollRunningHubImageUntilTerminal } from '../utils/runningHubImageQueryResume.js';
import { pollRunningHubAudioUntilTerminal } from '../utils/runningHubAudioQueryResume.js';

/** 熔断器：连续超时阈值 */
const CIRCUIT_BREAKER_TIMEOUT_THRESHOLD = 3;
/** 熔断器：锁定时长（毫秒） */
const CIRCUIT_BREAKER_LOCK_MS = 2 * 60 * 1000;

/**
 * AI 核心调度器
 * 支持并发控制：最多20个并行的Image模块请求
 * 熔断器：连续 3 次 AI 请求超时后，2 分钟内不允许提交新任务
 */
export class AICore {
  private mainWindow: BrowserWindow | null = null;
  
  // 熔断器状态
  private consecutiveTimeoutCount = 0;
  private circuitOpenUntil = 0;
  
  /** 防止同一 nodeId+rhTaskId 重复触发恢复轮询 */
  private resumeRunningHubPollInFlight = new Set<string>();

  // 并发控制：最多20个并行的Image模块请求
  private readonly MAX_CONCURRENT_IMAGE_REQUESTS = 20;
  private activeImageRequests = 0;
  private imageRequestQueue: Array<{
    params: AIInvokeParams;
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  /**
   * 设置主窗口引用（用于发送状态更新）
   * 
   * @param window 主窗口实例
   */
  setMainWindow(window: BrowserWindow | null): void {
    this.mainWindow = window;
  }

  /** 获取熔断器状态（供 IPC / 快捷键查询，用于排除系统休眠等） */
  getCircuitBreakerStatus(): { open: boolean; consecutiveTimeoutCount: number; circuitOpenUntil: number; retryAfterSeconds: number } {
    const now = Date.now();
    const open = now < this.circuitOpenUntil;
    const retryAfterSeconds = open ? Math.ceil((this.circuitOpenUntil - now) / 1000) : 0;
    return {
      open,
      consecutiveTimeoutCount: this.consecutiveTimeoutCount,
      circuitOpenUntil: this.circuitOpenUntil,
      retryAfterSeconds,
    };
  }

  /** 安全向渲染进程发送消息，避免窗口/帧已销毁时报错 */
  private safeSend(channel: string, ...args: any[]): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    try {
      if (!this.mainWindow.webContents.isDestroyed()) {
        this.mainWindow.webContents.send(channel, ...args);
      }
    } catch {
      // 忽略 Render frame was disposed 等
    }
  }

  /**
   * 处理 AI 调用请求
   * 每个模块的任务完全独立，互不影响
   * 
   * @param params AI 调用参数
   * @returns Promise<void>
   */
  async invoke(params: AIInvokeParams): Promise<void> {
    const { modelId, nodeId } = params;
    
    // 熔断器：若处于锁定状态，直接拒绝
    if (Date.now() < this.circuitOpenUntil) {
      const remaining = Math.ceil((this.circuitOpenUntil - Date.now()) / 1000);
      const msg = `AI 服务正忙，请稍后重试（约 ${remaining} 秒后恢复）`;
      console.warn(`[AICore] 熔断器已打开，拒绝任务: ${msg}`);
      throw new Error(msg);
    }

    console.log(`[AICore] 收到任务提交: modelId=${modelId}, nodeId=${nodeId}`);

    // 如果是 Image 模块，需要并发控制（限制最多20个并发）
    if (modelId === 'image') {
      return this.invokeWithConcurrencyControl(params);
    }

    // 其他模块（Video、Chat等）直接执行，完全独立，不阻塞其他任务
    console.log(`[AICore] 模块 ${modelId} 直接执行，不阻塞其他任务`);
    return this.executeInvoke(params);
  }

  /**
   * 带并发控制的调用（用于 Image 模块）
   */
  private async invokeWithConcurrencyControl(params: AIInvokeParams): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // 如果当前并发数未达到上限，直接执行
      if (this.activeImageRequests < this.MAX_CONCURRENT_IMAGE_REQUESTS) {
        this.activeImageRequests++;
        this.executeInvoke(params)
          .then(() => {
            this.activeImageRequests--;
            this.processImageQueue();
            resolve();
          })
          .catch((error) => {
            this.activeImageRequests--;
            this.processImageQueue();
            reject(error);
          });
      } else {
        // 加入队列等待
        console.log(`[并发控制] Image 请求 ${params.nodeId} 加入队列，当前并发数: ${this.activeImageRequests}/${this.MAX_CONCURRENT_IMAGE_REQUESTS}`);
        this.imageRequestQueue.push({
          params,
          resolve,
          reject,
        });
      }
    });
  }

  /**
   * 处理队列中的 Image 请求
   */
  private processImageQueue(): void {
    if (this.imageRequestQueue.length === 0) {
      return;
    }

    if (this.activeImageRequests >= this.MAX_CONCURRENT_IMAGE_REQUESTS) {
      return;
    }

    const next = this.imageRequestQueue.shift();
    if (!next) {
      return;
    }

    this.activeImageRequests++;
    console.log(`[并发控制] 从队列中取出 Image 请求 ${next.params.nodeId}，当前并发数: ${this.activeImageRequests}/${this.MAX_CONCURRENT_IMAGE_REQUESTS}`);
    
    this.executeInvoke(next.params)
      .then(() => {
        this.activeImageRequests--;
        next.resolve();
        this.processImageQueue();
      })
      .catch((error) => {
        this.activeImageRequests--;
        next.reject(error);
        this.processImageQueue();
      });
  }

  /**
   * 执行实际的 AI 调用
   * 每个任务完全独立，不共享状态
   */
  private async executeInvoke(params: AIInvokeParams): Promise<void> {
    const { modelId, nodeId, input } = params;
    
    console.log(`[AICore] 开始执行任务: modelId=${modelId}, nodeId=${nodeId}`);

    // 记录任务开始时间
    const startTime = Date.now();
    let taskFailed = false;
    let taskHistoryRecorded = false;

    const recordOutcomeOnce = (success: boolean) => {
      if (taskHistoryRecorded) return;
      taskHistoryRecorded = true;
      const duration = (Date.now() - startTime) / 1000;
      this.recordTaskDuration(modelId, duration, success);
    };

    // 从注册表获取 Provider
    const provider = getProvider(modelId);
    if (!provider) {
      const errorPacket: AIStatusPacket = {
        nodeId,
        status: 'ERROR',
        payload: {
          error: `Provider with modelId "${modelId}" not found in registry`,
        },
      };
      this.sendStatusUpdate(errorPacket);
      
      // 记录失败任务（耗时很短）
      recordOutcomeOnce(false);
      
      throw new Error(`AI Provider "${modelId}" not registered`);
    }

    // 创建状态回调函数（传递 input 以便保存元数据）
    const onStatus = async (packet: AIStatusPacket) => {
      if (packet.status === 'ERROR') taskFailed = true;
      else if (packet.status === 'SUCCESS') taskFailed = false;
      await this.sendStatusUpdate(packet, input);
    };

    try {
      // video-analysis 在 Provider 内先校验 API Key / URL，通过后再发 START；避免此处先发 START 再立刻 ERROR（日志像「秒失败」）
      if (modelId !== 'video-analysis') {
        await onStatus({
          nodeId,
          status: 'START',
        });
      }

      // 方式2：调用模型时触发余额刷新（后台执行，不阻塞任务）
      // 使用 Promise.all 并行查询，但不等待结果，避免阻塞任务执行
      Promise.all([
        getBLTCYBalance(true).catch(err => {
          console.warn('[余额刷新] BLTCY 余额查询失败:', err);
          return null;
        }),
        getRHBalance(true).catch(err => {
          console.warn('[余额刷新] RH 余额查询失败:', err);
          return null;
        })
      ]).then(([bltcyBalance, rhBalance]) => {
        if (bltcyBalance !== null) this.safeSend('balance-updated', { type: 'bltcy', balance: bltcyBalance });
        if (rhBalance !== null) this.safeSend('balance-updated', { type: 'rh', balance: rhBalance });
      }).catch(err => {
        // 余额查询失败不影响 AI 调用
        console.warn('[余额刷新] 余额查询失败:', err);
      });

      // 执行 Provider（不等待余额查询完成）
      await provider.execute({
        nodeId,
        input,
        onStatus,
      });

      // 任务成功完成，记录时长，重置熔断器计数
      this.consecutiveTimeoutCount = 0;
      recordOutcomeOnce(!taskFailed);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errCode = (error as { code?: string })?.code;
      const nxAuthRequired =
        errCode === 'NX_AUTH_REQUIRED' || errorMessage === 'NX_AUTH_REQUIRED';

      // 熔断器：连续超时 3 次则打开
      if (this.isTimeoutError(error)) {
        this.consecutiveTimeoutCount++;
        console.warn(`[AICore] 检测到超时，连续超时次数: ${this.consecutiveTimeoutCount}`);
        if (this.consecutiveTimeoutCount >= CIRCUIT_BREAKER_TIMEOUT_THRESHOLD) {
          this.circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_LOCK_MS;
          console.error(`[AICore] 熔断器打开：连续 ${CIRCUIT_BREAKER_TIMEOUT_THRESHOLD} 次超时，2 分钟内禁止新任务`);
          this.safeSend('ai:circuit-breaker-state', { open: true, retryAfter: 120 });
        }
      } else {
        this.consecutiveTimeoutCount = 0;
      }
      
      // 发送 ERROR 状态（SaaS 未登录等与 ChatProvider 约定 nxAuthRequired）
      const errorPacket: AIStatusPacket = {
        nodeId,
        status: 'ERROR',
        payload: nxAuthRequired
          ? { error: '请先登录 Aixflow 云端账号', nxAuthRequired: true }
          : { error: errorMessage },
      };
      this.sendStatusUpdate(errorPacket);
      
      // 记录失败任务时长
      recordOutcomeOnce(false);
      
      throw error;
    }
  }

  /** 判断是否为超时类错误（用于熔断器计数） */
  private isTimeoutError(error: unknown): boolean {
    if (!error) return false;
    const msg = error instanceof Error ? error.message : String(error);
    const code = (error as any)?.code;
    return (
      code === 'ECONNABORTED' ||
      code === 'ETIMEDOUT' ||
      /timeout|超时/i.test(msg)
    );
  }

  /**
   * 记录任务执行时长
   */
  private recordTaskDuration(modelId: string, duration: number, success: boolean): void {
    try {
      // 将 modelId 映射到 TaskType
      let taskType: TaskType;
      if (modelId === 'chat' || modelId === 'llm') {
        taskType = 'llm';
      } else if (modelId === 'image') {
        taskType = 'image';
      } else if (modelId === 'video') {
        taskType = 'video';
      } else {
        // 未知类型，跳过记录
        return;
      }

      recordTaskHistory(taskType, duration, success);
    } catch (error) {
      // 记录失败不影响任务执行
      console.warn('[AICore] 记录任务时长失败:', error);
    }
  }

  /**
   * 发送状态更新到渲染进程
   * 在发送 SUCCESS 状态时，先自动下载资源到本地，再发送状态更新（确保持久化）
   * 注意：资源下载在后台进行，不阻塞状态更新
   * 
   * @param packet 状态数据包
   * @param input 原始输入参数（包含 prompt、model 等信息）
   */
  private async sendStatusUpdate(packet: AIStatusPacket, input?: any): Promise<void> {
    // 统一规范化 nodeId，确保与渲染进程 trim 后的 id 一致，避免 GPT 反推等 SUCCESS 无法匹配到 LLM 节点
    const normalizedPacket: AIStatusPacket = {
      ...packet,
      nodeId: packet.nodeId != null ? String(packet.nodeId).trim() : '',
    };

    // 先立即发送状态更新（不等待资源下载），确保 UI 及时响应
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      // 调试日志：记录发送的状态更新，确保路径正确编码
      const hasText = !!(normalizedPacket.payload as any)?.text;
      const textLength = (normalizedPacket.payload as any)?.text?.length || 0;
      const hasLocalPath = !!(normalizedPacket.payload as any)?.localPath;
      const localPath = (normalizedPacket.payload as any)?.localPath || 'none';

      // 确保 localPath 是字符串格式（避免编码问题）
      if (hasLocalPath && typeof localPath === 'string') {
        // 验证路径格式
        try {
          const normalizedPath = localPath.replace(/\\/g, '/');
          console.log(`[AICore] 发送状态更新: nodeId=${normalizedPacket.nodeId}, status=${normalizedPacket.status}, hasPayload=${!!normalizedPacket.payload}, hasText=${hasText}, textLength=${textLength}, hasLocalPath=${hasLocalPath}, localPath=${normalizedPath}`);
        } catch (error) {
          console.error(`[AICore] 路径编码错误:`, error);
        }
      } else {
        const errPreview =
          normalizedPacket.status === 'ERROR'
            ? String((normalizedPacket.payload as { error?: unknown })?.error ?? '').slice(0, 500)
            : '';
        console.log(
          `[AICore] 发送状态更新: nodeId=${normalizedPacket.nodeId}, status=${normalizedPacket.status}, hasPayload=${!!normalizedPacket.payload}, hasText=${hasText}, textLength=${textLength}, hasLocalPath=${hasLocalPath}` +
            (errPreview ? `, error=${errPreview}` : ''),
        );
      }

      // 确保 payload 中的路径是字符串格式
      if (normalizedPacket.payload && (normalizedPacket.payload as any).localPath) {
        (normalizedPacket.payload as any).localPath = String((normalizedPacket.payload as any).localPath);
      }

      this.safeSend('ai:status-update', normalizedPacket);
    }

    // 如果是 SUCCESS 状态且包含图片 / 视频 / 音频 URL，在后台下载资源
    if (normalizedPacket.status === 'SUCCESS' && normalizedPacket.payload) {
      const { imageUrl, videoUrl, audioUrl, text } = normalizedPacket.payload as {
        imageUrl?: string;
        videoUrl?: string;
        audioUrl?: string;
        text?: string;
      };
      let payloadModified = false; // 仅当实际修改 payload 时才发送第二次更新，避免重复触发渲染导致崩溃

      // 从 input 中提取元数据信息
      const prompt = input?.prompt || normalizedPacket.payload.prompt || '';
      const model = input?.model || normalizedPacket.payload.model || '';
      const nodeId = normalizedPacket.nodeId;
      
      // 准备元数据
      // 优先使用 normalizedPacket.payload.projectId，如果没有则尝试从 input 中获取
      const projectId = normalizedPacket.payload.projectId || input?.projectId;
      const metadata = {
        prompt,
        model,
        nodeId,
        nodeTitle: normalizedPacket.payload.nodeTitle,
        projectId: projectId,
        createdAt: Date.now(),
      };
      
      // 先下载图片（如果存在远程 URL）
      if (imageUrl && !imageUrl.startsWith('data:') && !imageUrl.startsWith('local-resource://') && !imageUrl.startsWith('file://')) {
        const imgPayload = normalizedPacket.payload as { originalImageUrl?: string };
        if (!imgPayload.originalImageUrl && /^https?:\/\//i.test(imageUrl)) {
          imgPayload.originalImageUrl = imageUrl;
        }
        console.log(`[持久化] 开始下载图片: ${imageUrl}`);
        const localPath = await autoDownloadResource(imageUrl, 'image', metadata);
        if (localPath) {
          // 将本地路径转换为 local-resource:// URL
          // 确保路径格式正确：Windows 路径 C:\Users -> C:/Users
          // 注意：不要对整个路径编码，只对中文和空格部分编码，盘符的冒号必须保持原样
          let normalizedPath = localPath.replace(/\\/g, '/');
          
          // 修复盘符格式：如果路径是 "c/Users" 格式（缺少冒号），修正为 "C:/Users"
          // 这是关键修复：确保盘符格式正确
          if (normalizedPath.match(/^([a-zA-Z])\//)) {
            normalizedPath = normalizedPath[0].toUpperCase() + ':' + normalizedPath.substring(1);
          }
          
          // 确保 Windows 路径格式正确（C:/Users 而不是 /C:/Users）
          if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
            // 移除开头的 /
            normalizedPath = normalizedPath.substring(1);
          }
          
          // 只对路径中的中文和空格部分进行编码，保留盘符的冒号
          // 分段处理，但不对盘符部分（如 C:）编码
          const pathParts = normalizedPath.split('/');
          const encodedParts = pathParts.map((part, index) => {
            // 如果是第一段且是 Windows 盘符（如 C:），不编码
            if (index === 0 && /^[a-zA-Z]:$/.test(part)) {
              return part;
            }
            // 其他部分：只对包含中文或空格的部分进行编码
            if (/[\u4e00-\u9fa5\s]/.test(part)) {
              // 包含中文或空格，需要编码
              return encodeURIComponent(part);
            }
            // 不包含中文或空格，保持原样
            return part;
          });
          const encodedPath = encodedParts.join('/');
          
          const localResourceUrl = `local-resource://${encodedPath}`;
          normalizedPacket.payload.localPath = localPath;
          normalizedPacket.payload.imageUrl = localResourceUrl; // 替换为本地 URL
          payloadModified = true;
          console.log(`[持久化] 图片已下载并保存: ${localPath}`);
          console.log(`[持久化] 生成的 local-resource URL: ${localResourceUrl}`);
        }
      }
      
      // 先下载视频（如果存在远程 URL）
      if (videoUrl && !videoUrl.startsWith('local-resource://') && !videoUrl.startsWith('file://')) {
        // 保存原始远程 URL，以便在 local-resource:// 失败时使用
        const originalVideoUrl = videoUrl;
        normalizedPacket.payload.originalVideoUrl = originalVideoUrl; // 保存原始远程 URL
        
        console.log(`[持久化] 开始下载视频: ${videoUrl}`);
        const localPath = await autoDownloadResource(videoUrl, 'video', metadata);
        if (localPath) {
          // 将本地路径转换为 local-resource:// URL
          // 确保路径格式正确：Windows 路径 C:\Users -> C:/Users
          let normalizedPath = localPath.replace(/\\/g, '/');
          // 确保 Windows 路径格式正确（C:/Users 而不是 c/Users）
          if (normalizedPath.match(/^[a-zA-Z]:/)) {
            // 已经是正确的格式
          } else if (normalizedPath.match(/^\/[a-zA-Z]:/)) {
            // 移除开头的 /
            normalizedPath = normalizedPath.substring(1);
          }
          
          // 对路径进行URL编码（处理中文字符）
          // 分段编码，保留斜杠分隔符
          const pathParts = normalizedPath.split('/');
          const encodedParts = pathParts.map((part) => {
            // 对每段路径进行编码
            return encodeURIComponent(part);
          });
          const encodedPath = encodedParts.join('/');
          
          const localResourceUrl = `local-resource://${encodedPath}`;
          normalizedPacket.payload.localPath = localPath;
          normalizedPacket.payload.videoUrl = localResourceUrl; // 替换为本地 URL
          normalizedPacket.payload.url = localResourceUrl; // 同时更新 url 字段
          payloadModified = true;
          console.log(`[持久化] 视频已下载并保存: ${localPath}`);
          console.log(`[持久化] 生成的 local-resource URL: ${localResourceUrl}`);
          console.log(`[持久化] 原始远程 URL 已保存: ${originalVideoUrl}`);
        }
      }

      // 下载音频（与 AudioProvider.handleAudioResult 对齐，供恢复轮询等路径复用）
      if (
        audioUrl &&
        !audioUrl.startsWith('local-resource://') &&
        !audioUrl.startsWith('file://') &&
        (audioUrl.startsWith('http://') || audioUrl.startsWith('https://'))
      ) {
        const originalAudioUrl = audioUrl;
        (normalizedPacket.payload as { originalAudioUrl?: string }).originalAudioUrl = originalAudioUrl;
        console.log(`[持久化] 开始下载音频: ${audioUrl}`);
        const localPath = await autoDownloadResource(audioUrl, 'audio', {
          resourceType: 'audio',
          nodeId,
          nodeTitle: normalizedPacket.payload.nodeTitle,
          projectId: projectId,
        });
        if (localPath) {
          let normalizedPath = localPath.replace(/\\/g, '/');
          if (normalizedPath.match(/^\/[a-zA-Z]:/)) normalizedPath = normalizedPath.substring(1);
          const pathParts = normalizedPath.split('/');
          const encodedParts = pathParts.map((part) => encodeURIComponent(part));
          const encodedPath = encodedParts.join('/');
          const localResourceUrl = `local-resource://${encodedPath}`;
          (normalizedPacket.payload as { localPath?: string }).localPath = localPath;
          (normalizedPacket.payload as { audioUrl?: string }).audioUrl = localResourceUrl;
          (normalizedPacket.payload as { url?: string }).url = localResourceUrl;
          payloadModified = true;
          console.log(`[持久化] 音频已下载: ${localPath}`);
        }
      }
      
      // 如果是文本内容，也保存到本地（不覆盖 videoUrl/imageUrl 的 localPath）
      // 注意：如果 payload 中已经有 localPath（来自 ChatProvider），说明文本已经保存，跳过重复保存
      // 同时确保 text 字段被保留（来自 ChatProvider）
      if (text && text.trim() && !text.match(/^https?:\/\//)) {
        // 如果已经有 localPath（来自 ChatProvider），保留它和 text 字段
        if (normalizedPacket.payload.localPath) {
          console.log(`[持久化] 文本已保存（来自 Provider）: ${normalizedPacket.payload.localPath}, text 长度: ${text.length}`);
          // 确保 text 字段被保留
          if (!normalizedPacket.payload.text) {
            normalizedPacket.payload.text = text;
            console.log(`[持久化] 从 payload 恢复 text 字段，长度: ${text.length}`);
          }
        } else {
          // 如果没有 localPath，尝试保存
          const textMetadata = {
            ...metadata,
            text: text,
          };
          const textLocalPath = await autoDownloadResource(null, 'text', textMetadata);
          // 如果成功保存文本，设置 localPath 到 payload
          if (textLocalPath) {
            normalizedPacket.payload.localPath = textLocalPath;
            // 确保 text 字段被保留
            normalizedPacket.payload.text = text;
            payloadModified = true;
            console.log(`[持久化] 文本已保存: ${textLocalPath}, text 长度: ${text.length}`);
          }
        }
      }

      // 仅当 payload 被实际修改（下载了资源）时才发送第二次更新，避免与 Provider 已发送的 localPath 重复，减少渲染进程压力
      if (payloadModified) {
        console.log(`[AICore] 发送状态更新（包含本地路径）: nodeId=${normalizedPacket.nodeId}, status=${normalizedPacket.status}, hasPayload=${!!normalizedPacket.payload}, localPath=${(normalizedPacket.payload as any)?.localPath || 'none'}`);
        this.safeSend('ai:status-update', normalizedPacket);
      }
    }
  }

  /**
   * 应用重启后：任务列表已持久化 RunningHub taskId 时，后台继续 /query 直至出片或失败（与 VideoProvider 轮询一致）。
   * 立即返回，不阻塞 IPC。
   */
  startResumeRunningHubVideoPoll(args: {
    nodeId: string;
    rhTaskId: string;
    projectId?: string;
    prompt?: string;
    nodeTitle?: string;
  }): void {
    const key = `vid:${args.nodeId}:${args.rhTaskId}`;
    if (this.resumeRunningHubPollInFlight.has(key)) return;
    this.resumeRunningHubPollInFlight.add(key);
    void this.runResumeRunningHubVideoPoll(args).finally(() => {
      this.resumeRunningHubPollInFlight.delete(key);
    });
  }

  private async runResumeRunningHubVideoPoll(args: {
    nodeId: string;
    rhTaskId: string;
    projectId?: string;
    prompt?: string;
    nodeTitle?: string;
  }): Promise<void> {
    const { nodeId, rhTaskId, projectId, prompt, nodeTitle } = args;
    const input = { projectId, prompt, nodeTitle };
    try {
      await this.sendStatusUpdate(
        {
          nodeId,
          status: 'PROCESSING',
          payload: {
            progress: 1,
            text: '正在从云端同步视频任务状态…',
            taskId: rhTaskId,
          },
        },
        input,
      );
      let tick = 0;
      const result = await pollRunningHubVideoUntilTerminal(rhTaskId, {
        onTick: ({ attempt }) => {
          tick++;
          if (tick === 1 || attempt % 4 === 0) {
            const progress = Math.min(88, 12 + attempt * 3);
            void this.sendStatusUpdate(
              {
                nodeId,
                status: 'PROCESSING',
                payload: {
                  progress,
                  text: '正在从云端同步视频任务状态…',
                  taskId: rhTaskId,
                },
              },
              input,
            );
          }
        },
      });

      if (!result.ok) {
        await this.sendStatusUpdate(
          { nodeId, status: 'ERROR', payload: { error: result.error, taskId: rhTaskId } },
          input,
        );
        return;
      }

      await this.sendStatusUpdate(
        {
          nodeId,
          status: 'SUCCESS',
          payload: {
            videoUrl: result.videoUrl,
            url: result.videoUrl,
            originalVideoUrl: result.videoUrl,
            prompt,
            projectId,
            nodeTitle,
            taskId: rhTaskId,
          },
        },
        input,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.sendStatusUpdate(
        { nodeId, status: 'ERROR', payload: { error: msg, taskId: rhTaskId } },
        input,
      );
    }
  }

  startResumeRunningHubImagePoll(args: {
    nodeId: string;
    rhTaskId: string;
    projectId?: string;
    prompt?: string;
    nodeTitle?: string;
  }): void {
    const key = `img:${args.nodeId}:${args.rhTaskId}`;
    if (this.resumeRunningHubPollInFlight.has(key)) return;
    this.resumeRunningHubPollInFlight.add(key);
    void this.runResumeRunningHubImagePoll(args).finally(() => {
      this.resumeRunningHubPollInFlight.delete(key);
    });
  }

  private async runResumeRunningHubImagePoll(args: {
    nodeId: string;
    rhTaskId: string;
    projectId?: string;
    prompt?: string;
    nodeTitle?: string;
  }): Promise<void> {
    const { nodeId, rhTaskId, projectId, prompt, nodeTitle } = args;
    const input = { projectId, prompt, nodeTitle };
    try {
      await this.sendStatusUpdate(
        {
          nodeId,
          status: 'PROCESSING',
          payload: {
            progress: 1,
            text: '正在从云端同步图片任务状态…',
            taskId: rhTaskId,
          },
        },
        input,
      );
      let tick = 0;
      const result = await pollRunningHubImageUntilTerminal(rhTaskId, {
        onTick: ({ attempt }) => {
          tick++;
          if (tick === 1 || attempt % 4 === 0) {
            const progress = Math.min(88, 12 + attempt * 3);
            void this.sendStatusUpdate(
              {
                nodeId,
                status: 'PROCESSING',
                payload: {
                  progress,
                  text: '正在从云端同步图片任务状态…',
                  taskId: rhTaskId,
                },
              },
              input,
            );
          }
        },
      });

      if (!result.ok) {
        await this.sendStatusUpdate(
          { nodeId, status: 'ERROR', payload: { error: result.error, taskId: rhTaskId } },
          input,
        );
        return;
      }

      await this.sendStatusUpdate(
        {
          nodeId,
          status: 'SUCCESS',
          payload: {
            imageUrl: result.imageUrl,
            originalImageUrl: result.imageUrl,
            prompt,
            projectId,
            nodeTitle,
            taskId: rhTaskId,
            progress: 100,
          },
        },
        input,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.sendStatusUpdate(
        { nodeId, status: 'ERROR', payload: { error: msg, taskId: rhTaskId } },
        input,
      );
    }
  }

  startResumeRunningHubAudioPoll(args: {
    nodeId: string;
    rhTaskId: string;
    projectId?: string;
    prompt?: string;
    nodeTitle?: string;
  }): void {
    const key = `aud:${args.nodeId}:${args.rhTaskId}`;
    if (this.resumeRunningHubPollInFlight.has(key)) return;
    this.resumeRunningHubPollInFlight.add(key);
    void this.runResumeRunningHubAudioPoll(args).finally(() => {
      this.resumeRunningHubPollInFlight.delete(key);
    });
  }

  private async runResumeRunningHubAudioPoll(args: {
    nodeId: string;
    rhTaskId: string;
    projectId?: string;
    prompt?: string;
    nodeTitle?: string;
  }): Promise<void> {
    const { nodeId, rhTaskId, projectId, prompt, nodeTitle } = args;
    const input = { projectId, prompt, nodeTitle, text: prompt };
    try {
      await this.sendStatusUpdate(
        {
          nodeId,
          status: 'PROCESSING',
          payload: {
            progress: 1,
            text: '正在从云端同步音频任务状态…',
            taskId: rhTaskId,
          },
        },
        input,
      );
      let tick = 0;
      const result = await pollRunningHubAudioUntilTerminal(rhTaskId, {
        onTick: ({ attempt }) => {
          tick++;
          if (tick === 1 || attempt % 4 === 0) {
            const progress = Math.min(88, 12 + attempt * 3);
            void this.sendStatusUpdate(
              {
                nodeId,
                status: 'PROCESSING',
                payload: {
                  progress,
                  text: '正在从云端同步音频任务状态…',
                  taskId: rhTaskId,
                },
              },
              input,
            );
          }
        },
      });

      if (!result.ok) {
        await this.sendStatusUpdate(
          { nodeId, status: 'ERROR', payload: { error: result.error, taskId: rhTaskId } },
          input,
        );
        return;
      }

      await this.sendStatusUpdate(
        {
          nodeId,
          status: 'SUCCESS',
          payload: {
            audioUrl: result.audioUrl,
            url: result.audioUrl,
            originalAudioUrl: result.audioUrl,
            prompt,
            projectId,
            nodeTitle,
            taskId: rhTaskId,
            text: prompt ? `音频生成完成` : undefined,
          },
        },
        input,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await this.sendStatusUpdate(
        { nodeId, status: 'ERROR', payload: { error: msg, taskId: rhTaskId } },
        input,
      );
    }
  }
}

/**
 * 全局 AICore 实例
 */
export const aiCore = new AICore();
