/**
 * AI 插件化架构 - 统一类型定义
 * 所有 AI 模型的状态和数据包必须遵守此规范
 */

/**
 * AI 任务状态枚举
 */
export type AIStatus = 'START' | 'PROCESSING' | 'SUCCESS' | 'ERROR';

/**
 * AI 状态数据包
 * 主进程发送给渲染进程的数据包必须严格遵守此结构
 * 禁止透传第三方原始数据
 */
export interface AIStatusPacket {
  nodeId: string;       // 对应画布上的节点 ID
  status: AIStatus;
  payload?: {
    text?: string;      // 文本片段（流式或完整）
    url?: string;       // 生成的图片/视频链接（远程 URL）
    imageUrl?: string;  // 生成的图片 URL（用于图片生成，远程 URL）
    outputImages?: string[]; // 批量图片结果（用于宫格展示）
    originalImageUrls?: string[]; // 批量图片原始远程 URL（备用）
    videoUrl?: string;  // 生成的视频 URL（用于视频生成，远程 URL）
    audioUrl?: string;  // 生成的音频 URL（用于音频生成）
    /** RVC 训练输出的模型文件（本地或远程 URL） */
    outputModelUrl?: string;
    outputModelRemoteUrl?: string;
    outputModelLocalPath?: string;
    rvcTrainModelName?: string;
    /** 多段音频结果（如 AI 翻唱宫格） */
    outputAudios?: string[];
    originalOutputAudios?: string[];
    originalAudioUrl?: string; // 原始音频远程 URL（备用）
    localPath?: string; // 本地文件路径（自动下载后）
    originalImageUrl?: string; // 原始图片远程 URL（备用，用于图片加载失败时回退）
    originalVideoUrl?: string; // 原始视频远程 URL（备用，用于视频加载失败时回退）
    progress?: number;  // 0-100 的进度值
    error?: string;     // 错误描述
    /** 模型结束原因（如 length / stop，用于截断提示） */
    finishReason?: string;
    balanceInsufficient?: boolean; // 云端元宝不足（用于弹窗提示）
    /** 正式版 SaaS：需要登录云端账号后才能继续调用 FC */
    nxAuthRequired?: boolean;
    taskId?: string;    // 任务 ID（用于轮询查询任务状态）
    prompt?: string;    // 提示词（用于保存元数据）
    model?: string;     // 使用的模型（用于保存元数据）
    nodeTitle?: string; // 节点标题（用于保存元数据）
    projectId?: string; // 项目 ID（用于保存元数据）
    /** 本地 RVC 翻唱进度 */
    localRvcCover?: boolean;
    stage?: string;
    engineDownload?: { phase: string; percent: number; message: string };
  };
}

/**
 * AI 调用参数
 * 渲染进程通过 IPC 发送给主进程
 */
export interface AIInvokeParams {
  modelId: string;     // 模型标识符（如 'gemini', 'nanobanana', 'sora2'）
  nodeId: string;      // 节点 ID
  input: any;          // 模型特定的输入参数
}

/**
 * AI Provider 执行参数
 */
export interface AIExecuteParams {
  nodeId: string;
  input: any;
  onStatus: (packet: AIStatusPacket) => void;
}
