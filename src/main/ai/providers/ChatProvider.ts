/**
 * Chat API Provider - 大语言模型调用
 * 仅经阿里云 FC run-task（云端扣费），不向本机存储或直连第三方 LLM Key。
 */

import { BaseProvider } from '../BaseProvider.js';
import { AIExecuteParams, AIStatusPacket } from '../types.js';
import { autoDownloadResource } from '../../utils/resourceDownloader.js';
import fs from 'fs';
import path from 'path';
import { isLocalResourcePathAllowed } from '../../utils/projectFolderHelper.js';
import { resolveOriginalImageUrlIfPreview } from '../utils/imageAssetResolver.js';
import { callFCChat } from '../../ai-provider.js';
import { buildFcErrorPayload } from '../../utils/fcBalanceError.js';
import { getAliyunFcInitUserUrl } from '../../config/aliyunConfig.js';
import { runJoyCaptionTwoViaFc } from '../../services/runningHubAiAppFc.js';
import { getCloudAiBlockReason } from '../../utils/cloudAiGate.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  // 对于纯文本对话，content 为字符串；对于图像分析等场景，content 可以是对象或数组
  // 使用 any 以兼容多种内容格式（例如包含 image_url 的结构）。
  content: any;
}

interface ChatInput {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  n?: number;
  stream?: boolean;
  stop?: string;
  max_tokens?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  logit_bias?: any;
  user?: string;
  response_format?: any;
  seen?: number;
  tools?: string[];
  tool_choice?: any;
  [key: string]: any;
}

export class ChatProvider extends BaseProvider {
  readonly modelId = 'chat';

  async execute(params: AIExecuteParams): Promise<void> {
    const { nodeId, input, onStatus } = params;

    // 验证输入
    if (!this.validateInput(input)) {
      const errorPacket: AIStatusPacket = {
        nodeId,
        status: 'ERROR',
        payload: {
          error: 'Invalid input: input is required',
        },
      };
      onStatus(errorPacket);
      return;
    }

    const chatInput = input as ChatInput;

    // 验证必需字段
    if (!chatInput.model || !chatInput.messages || !Array.isArray(chatInput.messages)) {
      const errorPacket: AIStatusPacket = {
        nodeId,
        status: 'ERROR',
        payload: {
          error: 'Invalid input: model and messages are required',
        },
      };
      onStatus(errorPacket);
      return;
    }

    // 发送 START 状态
    onStatus({
      nodeId,
      status: 'START',
      payload: {},
    });
    
    // 发送 PROCESSING 状态
    onStatus({
      nodeId,
      status: 'PROCESSING',
      payload: {},
    });

    const cloudBlock = getCloudAiBlockReason();
    if (cloudBlock) {
      onStatus({ nodeId, status: 'ERROR', payload: { error: cloudBlock } });
      return;
    }

    try {
      // Joy Caption Two 反推提示词：经 FC 转发 RunningHub AI 应用
      if (chatInput.model === 'joy-caption-two') {
        if (!getAliyunFcInitUserUrl().trim()) {
          throw new Error(
            '未配置云端转发（ALIYUN_FC_INIT_USER_URL）。图像反推经阿里云 FC 调用 RunningHub，请在 FC 环境变量配置 RUNNINGHUB_API_KEY。',
          );
        }
        let imageUrl: string | null = null;
        for (const msg of chatInput.messages || []) {
          if (Array.isArray(msg.content)) {
            for (const item of msg.content) {
              if (item?.type === 'image_url' && item.image_url?.url) {
                imageUrl = item.image_url.url;
                break;
              }
            }
            if (imageUrl) break;
          }
        }
        if (!imageUrl) {
          throw new Error('未找到图片：请从图片节点连线到本 LLM 节点');
        }
        const resolvedImageUrl = resolveOriginalImageUrlIfPreview(imageUrl);
        let fieldValue = resolvedImageUrl;
        if (resolvedImageUrl.startsWith('local-resource://') || resolvedImageUrl.startsWith('file://')) {
          let filePath = resolvedImageUrl.startsWith('local-resource://') ? resolvedImageUrl.replace(/^local-resource:\/\//, '') : resolvedImageUrl.replace(/^file:\/\//, '');
          if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
          filePath = decodeURIComponent(filePath);
          if (filePath.match(/^[/\\]+[a-zA-Z]:[/\\]/)) filePath = filePath.replace(/^[/\\]+/, '');
          if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
          const normalizedFilePath = path.normalize(filePath);
          if (!isLocalResourcePathAllowed(normalizedFilePath)) {
            throw new Error(`访问路径超出允许范围: ${filePath}`);
          }
          if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
          const imageBuffer = fs.readFileSync(normalizedFilePath);
          const ext = path.extname(normalizedFilePath).toLowerCase();
          const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png';
          const { VideoProvider } = await import('./VideoProvider.js');
          const vp = new VideoProvider();
          fieldValue = await vp.uploadImageToOSS(imageBuffer, mimeType);
        } else if (resolvedImageUrl.startsWith('data:image/')) {
          const base64Match = resolvedImageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
          if (!base64Match) throw new Error('Base64 图片格式无效');
          const [, imageType, base64Data] = base64Match;
          const imageBuffer = Buffer.from(base64Data, 'base64');
          const mimeType = `image/${imageType}`;
          const { VideoProvider } = await import('./VideoProvider.js');
          const vp = new VideoProvider();
          fieldValue = await vp.uploadImageToOSS(imageBuffer, mimeType);
        } else if (!resolvedImageUrl.startsWith('http://') && !resolvedImageUrl.startsWith('https://')) {
          throw new Error('Joy Caption Two 仅支持本地图片、Base64 图片或 http(s) 图片链接');
        }
        const jr = await runJoyCaptionTwoViaFc(fieldValue);
        if (jr.success) {
          onStatus({
            nodeId,
            status: 'SUCCESS',
            payload: { text: jr.text },
          });
          return;
        }
        throw new Error(jr.message);
      }

      // 处理 messages 中的 local-resource:// 图片 URL，转换为 base64（供 FC 转发）
      let imageConversionError: string | null = null;
      const processedMessages = chatInput.messages.map((msg: ChatMessage) => {
        if (Array.isArray(msg.content)) {
          // 处理包含 image_url 的消息
          const processedContent = msg.content.map((item: any) => {
            if (item.type === 'image_url' && item.image_url?.url) {
              const imageUrl = resolveOriginalImageUrlIfPreview(item.image_url.url);
              console.log(`[ChatProvider] 处理图片 URL: ${imageUrl.substring(0, 100)}...`);
              
              // 如果是 local-resource:// 或 file://，转换为 base64 data URL
              if (imageUrl.startsWith('local-resource://') || imageUrl.startsWith('file://')) {
                try {
                  let filePath: string;
                  
                  if (imageUrl.startsWith('local-resource://')) {
                    filePath = imageUrl.replace(/^local-resource:\/\//, '');
                    filePath = decodeURIComponent(filePath);
                    // URL 可能产生 /E:/ 或 //E:/，去掉前导斜杠以便 Windows 路径校验通过
                    if (filePath.match(/^[/\\]+[a-zA-Z]:[/\\]/)) {
                      filePath = filePath.replace(/^[/\\]+/, '');
                    }
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
                  
                  console.log(`[ChatProvider] 解析后的文件路径: ${filePath}`);
                  
                  const normalizedFilePath = path.normalize(filePath);
                  if (!isLocalResourcePathAllowed(normalizedFilePath)) {
                    const errorMsg = `访问路径超出允许范围: ${filePath}`;
                    console.error(`[ChatProvider] ${errorMsg}`);
                    imageConversionError = errorMsg;
                    throw new Error(errorMsg);
                  }
                  
                  // 检查文件是否存在
                  if (!fs.existsSync(normalizedFilePath)) {
                    const errorMsg = `文件不存在: ${normalizedFilePath}`;
                    console.error(`[ChatProvider] ${errorMsg}`);
                    imageConversionError = errorMsg;
                    throw new Error(errorMsg);
                  }
                  
                  // 读取文件并转换为 base64
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
                  
                  const base64 = imageBuffer.toString('base64');
                  const base64Url = `data:${mimeType};base64,${base64}`;
                  console.log(`[ChatProvider] 成功将本地图片转换为 base64: ${normalizedFilePath}, 大小: ${imageBuffer.length} 字节, MIME: ${mimeType}`);
                  
                  return {
                    ...item,
                    image_url: {
                      url: base64Url,
                    },
                  };
                } catch (error: any) {
                  const errorMsg = `转换本地图片失败: ${imageUrl} - ${error.message || error}`;
                  console.error(`[ChatProvider] ${errorMsg}`);
                  imageConversionError = errorMsg;
                  throw error; // 抛出错误，而不是返回原始项
                }
              } else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
                // HTTP/HTTPS URL 直接使用，无需转换
                console.log(`[ChatProvider] 使用远程图片 URL: ${imageUrl}`);
                return item;
              } else {
                // 未知协议，记录警告
                console.warn(`[ChatProvider] 未知的图片 URL 协议: ${imageUrl}`);
                return item;
              }
            }
            return item;
          });
          
          return {
            ...msg,
            content: processedContent,
          };
        }
        return msg;
      });
      
      // 如果图片转换失败，立即抛出错误
      if (imageConversionError) {
        throw new Error(`图片处理失败: ${imageConversionError}`);
      }

      console.log('[ChatProvider] 使用 FC run-task 转发（云端扣费）');
      try {
        const { content } = await callFCChat({
          messages: processedMessages,
          model: chatInput.model,
          temperature: chatInput.temperature,
          max_tokens: chatInput.max_tokens,
        });
        let localPath: string | null = null;
        try {
          const projectId = (chatInput as any)?.projectId;
          const nodeTitle = (chatInput as any)?.nodeTitle || 'llm';
          if (projectId && content) {
            localPath = await autoDownloadResource(null, 'text', {
              text: content,
              prompt:
                chatInput.messages?.map((m: ChatMessage) =>
                  typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
                ).join('\n') || '',
              model: chatInput.model,
              nodeId,
              nodeTitle,
              projectId,
            });
          }
        } catch (_e) {
          /* 忽略 */
        }
        onStatus({ nodeId, status: 'SUCCESS', payload: { text: content, localPath: localPath || undefined } });
        return;
      } catch (fcError: any) {
        const needAuth =
          fcError?.code === 'NX_AUTH_REQUIRED' || String(fcError?.message || '') === 'NX_AUTH_REQUIRED';
        if (needAuth) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: '请先登录 Aixflow 云端账号', nxAuthRequired: true },
          });
          throw fcError;
        }
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: buildFcErrorPayload(fcError, fcError instanceof Error ? fcError.message : 'LLM 调用失败'),
        });
        throw fcError;
      }
    } catch (error) {
      let errorMessage = '未知错误';
      
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // 处理连接超时错误
        if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
          errorMessage = '连接超时：请检查网络后重试，或确认云端服务可用。';
        } else if (errorMessage.includes('ECONNREFUSED')) {
          errorMessage = '连接被拒绝：请检查网络或云端服务状态。';
        } else if (errorMessage.includes('ENOTFOUND')) {
          errorMessage = 'DNS 解析失败：请检查网络连接。';
        }
        
        console.error(`[ChatProvider] API 调用失败:`, errorMessage);
        console.error(`[ChatProvider] 错误详情:`, error);
      } else {
        errorMessage = String(error);
      }
      
      const errorPacket: AIStatusPacket = {
        nodeId,
        status: 'ERROR',
        payload: {
          error: `Chat API 错误: ${errorMessage}`,
        },
      };
      onStatus(errorPacket);
      throw error;
    }
  }
}
