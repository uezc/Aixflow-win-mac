/**
 * 视频分析 Provider - RunningHub AI 应用
 * 仅经阿里云 FC 转发（与抠图/去水印一致），RUNNINGHUB_API_KEY 仅在云端配置。
 */
import { BaseProvider } from '../BaseProvider.js';
import { AIExecuteParams } from '../types.js';
import { VideoProvider } from './VideoProvider.js';
import { getAliyunFcInitUserUrl } from '../../config/aliyunConfig.js';
import { runVideoAnalysisViaFc } from '../../services/runningHubAiAppFc.js';
import { getCloudAiBlockReason } from '../../utils/cloudAiGate.js';

interface VideoAnalysisInput {
  videoUrl: string;
  nodeId: string;
  projectId?: string;
}

export class VideoAnalysisProvider extends BaseProvider {
  readonly modelId = 'video-analysis';

  async execute(params: AIExecuteParams): Promise<void> {
    const { nodeId, input, onStatus } = params;

    if (!this.validateInput(input)) {
      console.warn('[VideoAnalysis] 输入无效（缺少 input 对象）');
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: 'Invalid input: videoUrl is required' },
      });
      return;
    }

    const { videoUrl } = input as VideoAnalysisInput;
    if (!videoUrl || typeof videoUrl !== 'string' || !videoUrl.trim()) {
      console.warn('[VideoAnalysis] videoUrl 为空，请确认视频节点已连线且 LLM 面板处于视频分析模式');
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: '视频 URL 为空' },
      });
      return;
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
          error:
            '未配置云端转发（ALIYUN_FC_INIT_USER_URL）。视频分析已改为仅通过阿里云 FC 调用 RunningHub，请在 FC 环境变量中配置 RUNNINGHUB_API_KEY，并确保本机已登录云端账号。',
        },
      });
      return;
    }

    onStatus({ nodeId, status: 'START', payload: {} });
    onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 5 } });

    try {
      let fieldValue: string = videoUrl.trim();

      if (fieldValue.startsWith('local-resource://') || fieldValue.startsWith('file://')) {
        onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 10 } });
        const vp = new VideoProvider();
        fieldValue = await vp.uploadLocalVideoToOSS(fieldValue);
        console.log('[VideoAnalysis] 本地视频已上传到 OSS:', fieldValue.substring(0, 80));
      } else if (!fieldValue.startsWith('http://') && !fieldValue.startsWith('https://')) {
        throw new Error('视频分析仅支持本地文件（local-resource://、file://）或 http(s) 公网链接');
      }

      onStatus({ nodeId, status: 'PROCESSING', payload: { progress: 20 } });

      const result = await runVideoAnalysisViaFc(fieldValue);

      if (result.success) {
        onStatus({
          nodeId,
          status: 'SUCCESS',
          payload: { text: result.text },
        });
        return;
      }

      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: result.message },
      });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[VideoAnalysis] 执行失败:', errMsg);
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: errMsg },
      });
    }
  }
}
