/**
 * Audio Generation Provider - 声音生成
 * RunningHub 插件算力经 FC 转发，密钥仅在云端配置。
 */

import { BaseProvider } from '../BaseProvider.js';
import { AIExecuteParams, AIStatusPacket } from '../types.js';
import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { rhPostChargeAudio, rhQueryPollAudio, formatRunningHubTaskError, extractRhTaskIdFromForward } from '../../utils/runningHubFcHelpers.js';
import { isRvcModelPackageUrl } from '../../../shared/rvcVoiceTrainUtils.js';
import {
  deriveRvcCoverModelPath,
  resolveRvcVoiceModelPackageUrl,
  clampCoverPitch,
  clampCoverIndexRate,
  clampCoverVocalMixPct,
  clampCoverAccompanimentMixPct,
} from '../../../shared/rvcVoiceCoverUtils.js';
import { store } from '../../services/store.js';
import { buildFcErrorPayload, isFcBalanceInsufficientError } from '../../utils/fcBalanceError.js';
import { tryRefundFcForwardCharge } from '../../utils/fcRefundCharge.js';
import { getAliyunFcInitUserUrl } from '../../config/aliyunConfig.js';
import { getCloudAiBlockReason, buildCloudAiBlockedPayload } from '../../utils/cloudAiGate.js';

/**
 * 轮询 FC→RunningHub 时：525（CDN SSL）、网络抖动等应重试，避免「第三方已成功但本地误判失败并退款」。
 */
function isRetriableAudioPollError(pollError: unknown): boolean {
  if (isFcBalanceInsufficientError(pollError)) return false;
  const msg = pollError instanceof Error ? pollError.message : String(pollError);
  if (/ECONNRESET|socket hang up|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN/i.test(msg)) return true;
  if (/525|SSL handshake failed|连接异常（HTTP 525）/i.test(msg)) return true;
  if (axios.isAxiosError(pollError)) {
    const st = pollError.response?.status;
    if (st === 404) return false;
    if (st != null && st >= 500) return true;
    if (st === 429) return true;
  }
  return false;
}

interface AudioInput {
  text: string;
  model?: string; // 'speech-2.8-hd' | 'index-tts2' | 'ai-voice-cover' | 'rhart-song-v5.5'
  voice_id?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  pronunciation_dict?: string[];
  enable_base64_output?: boolean;
  english_normalization?: boolean;
  emotion?: 'happy' | 'sad' | 'angry' | 'fearful' | 'disgusted' | 'surprised' | 'neutral';
  projectId?: string;
  nodeTitle?: string;
  referenceAudioUrl?: string;
  indexTts2Select?: string;
  /** 全能写歌：歌曲名 */
  songName?: string;
  /** 全能写歌：风格描述 */
  styleDesc?: string;
  /** 全能写歌：歌词 */
  lyrics?: string;
  /** RVC 翻唱：RH model_name（.pth 路径） */
  rvcCoverModelName?: string;
  /** RVC 翻唱：原曲音频 URL */
  sourceSongAudioUrl?: string;
  /** 来自 RVC 训练卡 / 音色库 */
  libraryRvcVoiceId?: string;
  outputModelUrl?: string;
  outputModelRemoteUrl?: string;
  /** @deprecated SeedVC V2 已移除，保留字段兼容旧项目数据 */
  coverReferenceAudioUrl?: string;
  /** RVC 翻唱：音调（半音，-12~12） */
  coverPitch?: number;
  /** RVC 翻唱：index 检索占比 0~1 */
  coverIndexRate?: number;
  /** RVC 翻唱：混音人声音量 %（25~300） */
  coverVocalMixPct?: number;
  /** RVC 翻唱：混音伴奏音量 %（25~300） */
  coverAccompanimentMixPct?: number;
  /** @deprecated 旧 RH 工作流音量，本地翻唱无效 */
  coverRhVolume?: number;
  /** RVC 翻唱输出：with_accompaniment | vocals_only */
  coverOutputMode?: 'with_accompaniment' | 'vocals_only';
  /** RVC 音色训练：模型名称（RH node 6） */
  rvcTrainModelName?: string;
}

const RH_RVC_VOICE_TRAIN_APP_ID = '2072990640429953025';

function resolveEffectiveAudioModel(rawModel: string | undefined, audioInput: AudioInput): string {
  const m = String(rawModel ?? '').trim() || 'speech-2.8-hd';
  if (m === 'ai-voice-cover') return 'ai-voice-cover';
  if (m === 'rvc-voice-train') return 'rvc-voice-train';
  const sourceSong = String(audioInput.sourceSongAudioUrl ?? '').trim();
  const rvcModel = String(
    audioInput.rvcCoverModelName ?? deriveRvcCoverModelPath(String(audioInput.rvcTrainModelName ?? '')),
  ).trim();
  const hasRvcCard = !!(rvcModel || audioInput.libraryRvcVoiceId || audioInput.outputModelUrl);
  if (
    sourceSong &&
    hasRvcCard &&
    m !== 'index-tts2' &&
    m !== 'rhart-song-v5.5' &&
    m !== 'rhart-song' &&
    m !== 'rvc-voice-train'
  ) {
    return 'ai-voice-cover';
  }
  const ref = String(audioInput.referenceAudioUrl ?? '').trim();
  const hasText = String(audioInput.text ?? '').trim().length > 0;
  if (ref && !hasText && !sourceSong && m !== 'index-tts2' && m !== 'rhart-song-v5.5' && m !== 'rhart-song') {
    return 'rvc-voice-train';
  }
  return m;
}

export class AudioProvider extends BaseProvider {
  readonly modelId = 'audio';

  private readonly runningHubApiBaseUrl = 'https://nexflow-fc-rh.stub/openapi/v2';

  /** 本地/URL 音频 → RH ai-app fieldValue（必要时上传 OSS） */
  private async resolveAudioUrlForRhApp(urlOrPath: string): Promise<string> {
    let audioFieldValue = (urlOrPath || '').trim();
    if (!audioFieldValue) throw new Error('音频 URL 为空');
    if (audioFieldValue.startsWith('local-resource://') || audioFieldValue.startsWith('file://')) {
      let filePath = audioFieldValue.startsWith('local-resource://')
        ? audioFieldValue.replace(/^local-resource:\/\/+/, '')
        : audioFieldValue.replace(/^file:\/\/+/, '');
      filePath = filePath.replace(/%5C/gi, '/');
      if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
      filePath = decodeURIComponent(filePath);
      if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
      const normalizedFilePath = path.normalize(filePath);
      if (!fs.existsSync(normalizedFilePath)) throw new Error(`文件不存在: ${normalizedFilePath}`);
      const audioBuffer = fs.readFileSync(normalizedFilePath);
      const ext = path.extname(normalizedFilePath).toLowerCase();
      const mimeType =
        ext === '.wav' ? 'audio/wav' : ext === '.ogg' ? 'audio/ogg' : ext === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
      const { VideoProvider } = await import('./VideoProvider.js');
      const vp = new VideoProvider();
      audioFieldValue = await vp.uploadAudioToOSS(audioBuffer, mimeType);
    } else if (!audioFieldValue.startsWith('http://') && !audioFieldValue.startsWith('https://')) {
      throw new Error('音频需为公网 URL 或本地文件路径（local-resource:// 或 file://）');
    }
    return audioFieldValue;
  }

  private decodeLocalResourcePath(urlOrPath: string): string {
    let filePath = (urlOrPath || '').trim();
    if (filePath.startsWith('local-resource://')) {
      filePath = filePath.replace(/^local-resource:\/\/+/, '');
    } else if (filePath.startsWith('file://')) {
      filePath = filePath.replace(/^file:\/\/+/, '');
    } else {
      return filePath;
    }
    filePath = filePath.replace(/%5C/gi, '/');
    if (filePath.startsWith('/') && filePath.length > 1 && filePath[2] === ':') filePath = filePath.slice(1);
    filePath = decodeURIComponent(filePath);
    if (filePath.match(/^[a-zA-Z]\//)) filePath = filePath[0].toUpperCase() + ':' + filePath.substring(1);
    return path.normalize(filePath);
  }

  /** 翻唱提交前：从音色库补全 outputModelUrl（面板/批量任务可能只传 libraryRvcVoiceId） */
  private enrichRvcCoverAudioInput(audioInput: AudioInput): AudioInput {
    if (String(audioInput.outputModelUrl ?? '').trim() || String(audioInput.outputModelRemoteUrl ?? '').trim()) {
      return audioInput;
    }
    const libId = String(audioInput.libraryRvcVoiceId ?? '').trim();
    if (!libId) return audioInput;
    const items = (store.get('rvcVoiceLibrary') || []) as Array<{
      id?: string;
      modelPackageUrl?: string;
      localModelPath?: string;
      originalModelUrl?: string;
    }>;
    const item = items.find((x) => x.id === libId);
    const pkg = resolveRvcVoiceModelPackageUrl(item);
    if (!pkg) return audioInput;
    return {
      ...audioInput,
      outputModelUrl: pkg,
      outputModelRemoteUrl: item?.originalModelUrl || audioInput.outputModelRemoteUrl,
    };
  }

  private requireRhTaskIdFromSubmit(data: Record<string, unknown>, label: string): string {
    const taskId = extractRhTaskIdFromForward(data);
    if (!taskId) {
      console.error(`[音频生成] ${label} 提交响应`, JSON.stringify(data).slice(0, 2500));
      throw new Error(`${label}提交失败：${formatRunningHubTaskError(data, '未返回 taskId')}`);
    }
    return taskId;
  }

  private resolveLocalRvcCoverModelPackage(coverInput: AudioInput): string {
    const pkg = (coverInput.outputModelUrl || coverInput.outputModelRemoteUrl || '').trim();
    if (
      pkg &&
      (isRvcModelPackageUrl(pkg) ||
        pkg.startsWith('local-resource://') ||
        pkg.startsWith('file://') ||
        pkg.startsWith('http://') ||
        pkg.startsWith('https://'))
    ) {
      return pkg;
    }
    throw new Error('RVC 翻唱需要 RVC 模型：请从音色库选择或连接 RVC 训练节点');
  }

  private async runLocalRvcVoiceCover(
    coverInput: AudioInput,
    nodeId: string,
    onStatus: (packet: AIStatusPacket) => void,
    projectId?: string,
    nodeTitle?: string,
  ): Promise<void> {
    const sourceSong = (coverInput.sourceSongAudioUrl || '').trim();
    if (!sourceSong) throw new Error('RVC 翻唱需要原曲音频，请连接 audio 节点');
    const modelPackageUrl = this.resolveLocalRvcCoverModelPackage(coverInput);
    const { runLocalRvcCover } = await import('../../services/localRvcCover.js');
    onStatus({ nodeId, status: 'START', payload: {} });
    onStatus({
      nodeId,
      status: 'PROCESSING',
      payload: { localRvcCover: true, stage: 'prepare' },
    });
    const result = await runLocalRvcCover({
      projectId,
      sourceSongUrl: sourceSong,
      modelPackageUrl,
      pitch: clampCoverPitch(coverInput.coverPitch),
      indexRate: clampCoverIndexRate(coverInput.coverIndexRate),
      vocalMixPct: clampCoverVocalMixPct(coverInput.coverVocalMixPct),
      accompanimentMixPct: clampCoverAccompanimentMixPct(coverInput.coverAccompanimentMixPct),
      onProgress: (message) => {
        onStatus({ nodeId, status: 'PROCESSING', payload: { localRvcCover: true, stage: message } });
      },
      onEngineDownload: (p) => {
        onStatus({
          nodeId,
          status: 'PROCESSING',
          payload: { localRvcCover: true, engineDownload: p },
        });
      },
    });
    onStatus({
      nodeId,
      status: 'SUCCESS',
      payload: {
        url: result.audioUrl,
        audioUrl: result.audioUrl,
        localPath: result.localPath,
        outputAudios: [result.audioUrl],
        text: '本地 RVC 翻唱完成',
      },
    });
  }

  private async ensureLedgerAudioTask(
    nodeId: string,
    billingModelId: string,
    audioInput: AudioInput,
  ): Promise<string | null> {
    try {
      if (!getAliyunFcInitUserUrl().trim()) return null;
      const { isNxSaasMode, isNxOfflineCloudSession, getNxAccessToken, nxCloudTasksCreate } = await import(
        '../../services/aliyunService.js'
      );
      if (!isNxSaasMode() || isNxOfflineCloudSession() || !getNxAccessToken()) return null;
      const r = await nxCloudTasksCreate({
        model_id: billingModelId,
        type: 'audio',
        params: {
          nodeId,
          taskKind: 'audio',
          model: audioInput.model,
          prompt: String(audioInput.text || '').slice(0, 4000),
        },
        nodeData: { ...(audioInput as unknown as Record<string, unknown>) },
      });
      const { notifyNxCloudTaskTrack } = await import('../../nxCloudTaskTrackNotifier.js');
      notifyNxCloudTaskTrack({ taskId: r.task_id, nodeId, taskType: 'audio', balance: r.balance });
      return r.task_id;
    } catch (e) {
      console.warn('[AudioProvider] /tasks/create 失败，回退为 run-task 内扣费', e);
      return null;
    }
  }

  async execute(params: AIExecuteParams): Promise<void> {
    const { nodeId, input, onStatus } = params;

    /** FC 提交已成功扣费时记录 taskId，失败时退回元宝 */
    let fcChargedTaskId: string | undefined;
    try {
      const audioInput = input as AudioInput;
      const {
        text,
        model: rawModel,
        voice_id = 'Wise_Woman',
        speed = 1,
        volume = 1,
        pitch = 0,
        pronunciation_dict = [],
        enable_base64_output = false,
        english_normalization = false,
        emotion,
        projectId,
        nodeTitle = 'audio',
        referenceAudioUrl,
        indexTts2Select = '1',
        songName,
        styleDesc,
        lyrics,
      } = audioInput;

      const model = resolveEffectiveAudioModel(rawModel, audioInput);

      if (model === 'rhart-song') {
        throw new Error('SUNO v5 已从前端下架，请在面板中选择 SUNO v5.5（rhart-song-v5.5）。');
      }

      const isSongLike = model === 'rhart-song-v5.5';
      const isCoverModel = model === 'ai-voice-cover';
      const isRvcTrain = model === 'rvc-voice-train';
      if (!isSongLike && !isCoverModel && !isRvcTrain && !String(text ?? '').trim()) {
        throw new Error('文本是必需的');
      }
      if (isRvcTrain) {
        const trainAudio = (referenceAudioUrl || '').trim();
        const modelName = String(audioInput.rvcTrainModelName ?? '').trim();
        if (!trainAudio) throw new Error('RVC 训练需要连接训练音频（1 路 audio 入边）');
        if (!modelName) throw new Error('请填写 RVC 模型名称');
      }
      if (isSongLike) {
        if (!(songName ?? '').trim()) throw new Error('全能写歌 需要填写歌曲名');
        if (!(styleDesc ?? '').trim()) throw new Error('全能写歌 需要填写风格描述');
        if (!(lyrics ?? '').trim()) throw new Error('全能写歌 需要填写歌词');
      }

      // RVC 翻唱：100% 本地（Demucs + RVC 推理 + 伴奏混回），不扣元宝、不走 RH 翻唱 API
      if (model === 'ai-voice-cover') {
        const coverInput = this.enrichRvcCoverAudioInput(audioInput);
        console.log('[音频生成] RVC 翻唱路由 本地推理', {
          hasPkg: !!(coverInput.outputModelUrl || coverInput.outputModelRemoteUrl),
          libraryRvcVoiceId: coverInput.libraryRvcVoiceId || '',
        });
        try {
          await this.runLocalRvcVoiceCover(coverInput, nodeId, onStatus, projectId, nodeTitle);
        } catch (error: unknown) {
          const message =
            (error instanceof Error ? error.message : String(error)) || '本地 RVC 翻唱失败，请稍后重试';
          console.error('[音频生成] 本地 RVC 翻唱失败:', message);
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: { error: message, localRvcCover: true },
          });
        }
        return;
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
            error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法使用音频生成',
          },
        });
        return;
      }

      // 发送 START 状态
      onStatus({
        nodeId,
        status: 'START',
        payload: {},
      });

      onStatus({
        nodeId,
        status: 'PROCESSING',
        payload: {},
      });

      // SUNO v5.5 标准模型：POST /rhart-audio/suno-v5.5/custom（title / prompt / tags）
      if (model === 'rhart-song-v5.5') {
        const title = String(songName ?? '').trim().slice(0, 80);
        const prompt = String(lyrics ?? '').trim().slice(0, 5000);
        const tags = String(styleDesc ?? '').trim().slice(0, 1000);
        const sunoPayload: Record<string, unknown> = { title, prompt, tags };
        const fcBaseId = randomUUID();
        const ledgerSong = await this.ensureLedgerAudioTask(nodeId, 'rhart-song-v5.5', audioInput);
        const data = await rhPostChargeAudio(
          `${this.runningHubApiBaseUrl}/rhart-audio/suno-v5.5/custom`,
          sunoPayload,
          fcBaseId,
          { billingModelId: 'rhart-song-v5.5' },
          ledgerSong,
        );
        fcChargedTaskId = ledgerSong || fcBaseId;
        const taskId = this.requireRhTaskIdFromSubmit(data, 'SUNO v5.5');
        onStatus({ nodeId, status: 'PROCESSING', payload: { taskId: String(taskId) } });
        const pollResult = await this.pollTaskUntilSuccess(String(taskId), fcBaseId, nodeId, onStatus, ledgerSong);
        if (pollResult.audioUrls.length > 0) {
          await this.handleAudioResults(pollResult.audioUrls, nodeId, onStatus, projectId, nodeTitle);
        }
        return;
      }

      // RVC 音色模型训练：AI 应用 2072990640429953025（训练音频须为 OSS 公网 URL，与 Index-TTS2 一致）
      if (model === 'rvc-voice-train') {
        const trainAudio = (referenceAudioUrl || '').trim();
        const modelName = String(audioInput.rvcTrainModelName ?? '').trim();
        const audioField = await this.resolveAudioUrlForRhApp(trainAudio);
        const appPayload = {
          nodeInfoList: [
            { nodeId: '5', fieldName: 'audio', fieldValue: audioField, description: 'audio' },
            { nodeId: '6', fieldName: 'value', fieldValue: modelName, description: 'name' },
          ],
          instanceType: 'plus',
          usePersonalQueue: 'false',
          retainSeconds: 120,
        };
        console.log('[音频生成] RVC 训练提交 instance=plus', { modelName, audioField: audioField.slice(0, 64) });
        const fcBaseId = randomUUID();
        const ledgerRvc = await this.ensureLedgerAudioTask(nodeId, 'rvc-voice-train', audioInput);
        const data = await rhPostChargeAudio(
          `${this.runningHubApiBaseUrl}/run/ai-app/${RH_RVC_VOICE_TRAIN_APP_ID}`,
          appPayload as Record<string, unknown>,
          fcBaseId,
          { billingModelId: 'rvc-voice-train' },
          ledgerRvc,
        );
        fcChargedTaskId = ledgerRvc || fcBaseId;
        const taskId = this.requireRhTaskIdFromSubmit(data, 'RVC 训练');
        onStatus({ nodeId, status: 'PROCESSING', payload: { taskId: String(taskId) } });
        const pollResult = await this.pollTaskUntilModelFile(
          String(taskId),
          fcBaseId,
          nodeId,
          onStatus,
          ledgerRvc,
        );
        await this.handleRvcTrainResult(
          pollResult.modelUrl,
          modelName,
          nodeId,
          onStatus,
          projectId,
          nodeTitle,
        );
        return;
      }

      // Index-TTS2.0 配音神器：AI 应用 run/ai-app/2008113338793857025
      if (model === 'index-tts2') {
        if (!referenceAudioUrl || !referenceAudioUrl.trim()) {
          throw new Error('Index-TTS2.0 配音神器需要上传参考音（参考音为必填）');
        }
        const audioFieldValue = await this.resolveAudioUrlForRhApp(referenceAudioUrl.trim());
        const appPayload = {
          nodeInfoList: [
            { nodeId: '13', fieldName: 'audio', fieldValue: audioFieldValue, description: '参考音' },
            { nodeId: '60', fieldName: 'text', fieldValue: text.trim(), description: '台词' },
            { nodeId: '106', fieldName: 'select', fieldValue: String(indexTts2Select || '1'), description: 'select' },
          ],
          instanceType: 'default',
          usePersonalQueue: 'false',
        };
        console.log('[音频生成] Index-TTS2.0 提交任务，nodeInfoList(参考音已处理)');
        const fcBaseId = randomUUID();
        const ledgerTts = await this.ensureLedgerAudioTask(nodeId, 'index-tts2', audioInput);
        const data = await rhPostChargeAudio(
          `${this.runningHubApiBaseUrl}/run/ai-app/2008113338793857025`,
          appPayload as Record<string, unknown>,
          fcBaseId,
          { billingModelId: 'index-tts2' },
          ledgerTts,
        );
        fcChargedTaskId = ledgerTts || fcBaseId;
        const taskId = this.requireRhTaskIdFromSubmit(data, 'Index-TTS2.0');
        onStatus({ nodeId, status: 'PROCESSING', payload: { taskId: String(taskId) } });
        const pollResult = await this.pollTaskUntilSuccess(String(taskId), fcBaseId, nodeId, onStatus, ledgerTts);
        if (pollResult.audioUrls.length > 0) {
          await this.handleAudioResults(pollResult.audioUrls, nodeId, onStatus, projectId, nodeTitle);
        }
        return;
      }

      // 默认：语音合成 speech-2.8-hd
      const payload: Record<string, unknown> = {
        text,
        voice_id,
        speed: Math.max(0.5, Math.min(2, speed)),
        volume: Math.max(0.1, Math.min(10, volume)),
        pitch: Math.max(-12, Math.min(12, pitch)),
        enable_base64_output,
        english_normalization,
      };
      if (pronunciation_dict && pronunciation_dict.length > 0) payload.pronunciation_dict = pronunciation_dict;
      if (emotion) payload.emotion = emotion;
      console.log('[音频生成] 提交任务，参数:', JSON.stringify(payload, null, 2));

      const fcBaseId = randomUUID();
      const ledgerSpeech = await this.ensureLedgerAudioTask(nodeId, 'speech-2.8-hd', audioInput);
      const data = await rhPostChargeAudio(
        `${this.runningHubApiBaseUrl}/rhart-audio/text-to-audio/speech-2.8-hd`,
        payload,
        fcBaseId,
        { billingModelId: 'speech-2.8-hd' },
        ledgerSpeech,
      );
      fcChargedTaskId = ledgerSpeech || fcBaseId;

      console.log('[音频生成] 提交响应:', JSON.stringify(data, null, 2));

      const taskId = extractRhTaskIdFromForward(data);

      if (!taskId) {
        // 如果没有 taskId，可能直接返回了结果
        const results = data.results as Array<{ url?: string }> | undefined;
        if (results && Array.isArray(results) && results.length > 0) {
          const audioUrl = results[0]?.url;
          if (audioUrl) {
            await this.handleAudioResult(audioUrl, nodeId, onStatus, projectId, nodeTitle);
            return;
          }
        }
        throw new Error(`未获取到任务 ID：${formatRunningHubTaskError(data, '未返回 taskId')}`);
      }

      console.log(`[音频生成] 获取到 taskId: ${taskId}，开始轮询...`);
      onStatus({ nodeId, status: 'PROCESSING', payload: { taskId: String(taskId) } });

      // 轮询配置：10 分钟总超时时间
      const totalTimeout = 10 * 60 * 1000; // 10 分钟（毫秒）
      const startTime = Date.now();
      let attempt = 0;
      let lastPollTime = startTime;

      // 轮询循环
      while (true) {
        // 检查总超时时间
        const elapsed = Date.now() - startTime;
        if (elapsed >= totalTimeout) {
          throw new Error(`轮询超时（10分钟）：无法获取音频结果，任务 ID: ${taskId}`);
        }

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
          const pollData = await rhQueryPollAudio(String(taskId), `${fcBaseId}:poll:${attempt}`, ledgerSpeech);
          console.log(`[音频生成] 轮询结果 (第 ${attempt} 次，已用时 ${Math.floor(elapsed / 1000)} 秒):`, JSON.stringify(pollData, null, 2));

          const status = pollData.status;

          if (status === 'SUCCESS') {
            // 提取音频 URL
            let audioUrl: string | undefined;
            if (Array.isArray(pollData.results) && pollData.results.length > 0) {
              audioUrl = (pollData.results[0] as { url?: string })?.url;
            }

            if (audioUrl) {
              // 下载音频
              await this.handleAudioResult(audioUrl, nodeId, onStatus, projectId, nodeTitle);
              break; // 退出轮询循环
            } else {
              console.warn('[音频生成] SUCCESS 状态但未找到音频 URL，继续轮询...');
              await new Promise(resolve => setTimeout(resolve, 2000));
              continue;
            }
          } else if (status === 'FAILED' || status === 'FAILURE') {
            // 任务失败
            void tryRefundFcForwardCharge(fcChargedTaskId, 'audio', 'poll_status_failed');
            const errorMessage = (pollData.errorMessage || pollData.error || '音频生成失败') as string;
            const errorCode = pollData.errorCode ? `[错误码: ${pollData.errorCode}] ` : '';

            onStatus({
              nodeId,
              status: 'ERROR',
              payload: {
                error: `${errorCode}${errorMessage}`,
              },
            });
            break; // 退出轮询循环
          } else if (status === 'QUEUED' || status === 'RUNNING') {
            // 任务进行中，继续轮询
            onStatus({
              nodeId,
              status: 'PROCESSING',
              payload: { taskId: String(taskId) },
            });
            continue;
          } else {
            // 未知状态，继续轮询
            console.warn(`[音频生成] 未知任务状态: ${status}，继续轮询...`);
            onStatus({ nodeId, status: 'PROCESSING', payload: { taskId: String(taskId) } });
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
        } catch (pollError: unknown) {
          // 健壮的错误处理：捕获网络错误并重试
          const errorMessage = pollError instanceof Error ? pollError.message : String(pollError);
          if (isFcBalanceInsufficientError(pollError)) {
            onStatus({
              nodeId,
              status: 'ERROR',
              payload: buildFcErrorPayload(pollError, '轮询失败'),
            });
            break;
          }
          const isConnectionError =
            errorMessage.includes('ECONNRESET') ||
            errorMessage.includes('socket hang up') ||
            errorMessage.includes('ETIMEDOUT') ||
            errorMessage.includes('ECONNREFUSED') ||
            errorMessage.includes('525') ||
            errorMessage.includes('SSL handshake') ||
            errorMessage.includes('连接异常（HTTP 525）') ||
            (pollError as { code?: string })?.code === 'ECONNRESET' ||
            (pollError as { code?: string })?.code === 'ETIMEDOUT' ||
            (pollError as { code?: string })?.code === 'ECONNREFUSED';

          if (isConnectionError) {
            // 网络连接错误，等待 5 秒后重试
            console.warn(`[音频生成] 轮询网络错误 (第 ${attempt} 次): ${errorMessage}，等待 5 秒后重试...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            lastPollTime = Date.now();
            continue;
          } else if (axios.isAxiosError(pollError) && pollError.response?.status === 404) {
            // 404 错误：任务不存在
            console.error(`[音频生成] 任务不存在 (404): ${taskId}`);
            throw new Error(`任务不存在，任务 ID: ${taskId}`);
          } else {
            // 其他错误，记录但继续尝试
            console.warn(`[音频生成] 轮询失败 (第 ${attempt} 次): ${errorMessage}`);
            if (axios.isAxiosError(pollError) && pollError.response?.status && pollError.response.status >= 400 && pollError.response.status < 500) {
              // 4xx 客户端错误
              const errorMsg =
                (pollError.response?.data as { error?: string })?.error ||
                (pollError.response?.data as { message?: string })?.message ||
                errorMessage;
              throw new Error(`轮询失败: ${errorMsg}`);
            }
            // 5xx 服务器错误，继续重试
            await new Promise(resolve => setTimeout(resolve, 5000));
            lastPollTime = Date.now();
          }
        }
      }
    } catch (error: unknown) {
      void tryRefundFcForwardCharge(fcChargedTaskId, 'audio', 'execute_failed');
      const message =
        (axios.isAxiosError(error) && (error.response?.data as { error?: { message?: string } })?.error?.message) ||
        (axios.isAxiosError(error) && (error.response?.data as { errorMessage?: string })?.errorMessage) ||
        (error instanceof Error ? error.message : String(error)) ||
        '音频生成失败，请稍后重试';

      console.error('[音频生成] 调用失败:', message, axios.isAxiosError(error) ? error.response?.data : '');

      onStatus({
        nodeId,
        status: 'ERROR',
        payload: buildFcErrorPayload(error, message),
      });
    }
  }

  private extractModelUrlsFromPollResults(results: unknown): string[] {
    if (!Array.isArray(results)) return [];
    const urls: string[] = [];
    for (const item of results) {
      const r = item as { url?: string; outputType?: string };
      const url = String(r?.url ?? '').trim();
      if (!url) continue;
      const ot = String(r?.outputType ?? '').toLowerCase();
      const lower = url.toLowerCase();
      const looksModel =
        ['pth', 'pt', 'index', 'zip', 'ckpt', 'safetensors', 'onnx'].some((ext) => ot.includes(ext)) ||
        /\.(pth|pt|index|zip|ckpt|safetensors|onnx)(\?|$)/i.test(lower) ||
        /rvc|model|weight/i.test(lower);
      if (looksModel) urls.push(url);
    }
    if (urls.length === 0) {
      for (const item of results) {
        const url = String((item as { url?: string })?.url ?? '').trim();
        if (url && !/\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(url)) urls.push(url);
      }
    }
    return urls;
  }

  private async pollTaskUntilModelFile(
    taskId: string,
    fcBaseId: string,
    nodeId: string,
    onStatus: (packet: AIStatusPacket) => void,
    ledgerTaskId?: string | null,
  ): Promise<{ modelUrl: string }> {
    const totalTimeout = 45 * 60 * 1000;
    const startTime = Date.now();
    let attempt = 0;
    let lastPollTime = startTime;
    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= totalTimeout) throw new Error(`RVC 训练轮询超时（45 分钟），任务 ID: ${taskId}`);
      const pollInterval = elapsed < 60000 ? 3000 : 5000;
      const timeSinceLastPoll = Date.now() - lastPollTime;
      if (timeSinceLastPoll < pollInterval) await new Promise((r) => setTimeout(r, pollInterval - timeSinceLastPoll));
      attempt++;
      lastPollTime = Date.now();
      try {
        const pollData = await rhQueryPollAudio(taskId, `${fcBaseId}:poll:${attempt}`, ledgerTaskId);
        const status = pollData.status;
        if (status === 'SUCCESS') {
          const modelUrls = this.extractModelUrlsFromPollResults(pollData.results);
          if (modelUrls.length > 0) return { modelUrl: modelUrls[0] };
          throw new Error('RVC 训练已完成但未返回模型文件，请在 RunningHub 查看任务输出');
        }
        if (status === 'FAILED' || status === 'FAILURE') {
          const errorMessage = (pollData.errorMessage || pollData.error || '任务失败') as string;
          throw new Error(String(errorMessage));
        }
        onStatus({ nodeId, status: 'PROCESSING', payload: { taskId } });
      } catch (pollError: unknown) {
        if (isFcBalanceInsufficientError(pollError)) throw pollError;
        if (isRetriableAudioPollError(pollError)) {
          await new Promise((r) => setTimeout(r, 5000));
          lastPollTime = Date.now();
          continue;
        }
        throw pollError;
      }
    }
  }

  private async handleRvcTrainResult(
    modelUrl: string,
    modelName: string,
    nodeId: string,
    onStatus: (packet: AIStatusPacket) => void,
    projectId?: string,
    nodeTitle?: string,
  ): Promise<void> {
    try {
      const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
      const safeName = `${nodeTitle || 'rvc'}_${modelName}`.replace(/[^\w\u4e00-\u9fff.-]+/g, '_');
      const urlLower = modelUrl.toLowerCase();
      const isZip = /\.zip(\?|$)/.test(urlLower);
      let downloadedPath: string | null = null;
      if (isZip) {
        downloadedPath = await this.downloadRvcModelPackage(modelUrl, safeName, projectId, nodeId);
      } else {
        downloadedPath = await autoDownloadResource(modelUrl, 'audio', {
          resourceType: 'audio',
          nodeId,
          nodeTitle: safeName,
          projectId,
        });
      }
      const localUrl = downloadedPath
        ? `local-resource://${downloadedPath.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (m) => m.substring(1))}`
        : modelUrl;
      onStatus({
        nodeId,
        status: 'SUCCESS',
        payload: {
          outputModelUrl: localUrl,
          outputModelRemoteUrl: modelUrl,
          outputModelLocalPath: downloadedPath ?? undefined,
          rvcTrainModelName: modelName,
          text: `RVC 训练完成：${modelName}`,
        },
      });
    } catch (e) {
      console.warn('[音频生成] RVC 模型下载失败，使用远程 URL', e);
      onStatus({
        nodeId,
        status: 'SUCCESS',
        payload: {
          outputModelUrl: modelUrl,
          outputModelRemoteUrl: modelUrl,
          rvcTrainModelName: modelName,
          text: `RVC 训练完成：${modelName}`,
        },
      });
    }
  }

  /** RVC 训练 zip 包下载（保留 .zip 扩展名） */
  private async downloadRvcModelPackage(
    remoteUrl: string,
    baseName: string,
    projectId?: string,
    nodeId?: string,
  ): Promise<string | null> {
    const axios = (await import('axios')).default;
    const fs = await import('fs');
    const path = await import('path');
    const crypto = await import('crypto');
    const { app } = await import('electron');

    const userDataPath = app.getPath('userData');
    let saveDir: string;
    if (projectId) {
      const { getProjectFolderPath } = await import('../../utils/projectFolderHelper.js');
      const projectFolderPath = await getProjectFolderPath(projectId);
      saveDir = projectFolderPath
        ? path.join(projectFolderPath, 'assets')
        : path.join(userDataPath, 'assets');
    } else {
      saveDir = path.join(userDataPath, 'assets');
    }
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    const urlHash = crypto.createHash('md5').update(remoteUrl).digest('hex').substring(0, 12);
    const safeBase = baseName.slice(0, 48) || 'rvc-model';
    const fileName = `${safeBase}-${urlHash}.zip`;
    const filePath = path.join(saveDir, fileName);
    if (fs.existsSync(filePath)) return filePath;

    const response = await axios.get(remoteUrl, {
      responseType: 'arraybuffer',
      timeout: 300000,
      proxy: false,
    });
    fs.writeFileSync(filePath, Buffer.from(response.data));
    console.log('[音频生成] RVC 模型包已保存:', filePath.replace(/\\/g, '/'));
    return filePath;
  }

  private extractAudioUrlsFromPollResults(results: unknown): string[] {
    if (!Array.isArray(results)) return [];
    const urls: string[] = [];
    for (const item of results) {
      const r = item as { url?: string; outputType?: string };
      const url = String(r?.url ?? '').trim();
      if (!url || isRvcModelPackageUrl(url)) continue;
      const ot = String(r?.outputType ?? '').toLowerCase();
      const looksAudio =
        ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].some((ext) => ot.includes(ext)) ||
        /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(url);
      if (looksAudio) urls.push(url);
    }
    if (urls.length === 0) {
      for (const item of results) {
        const url = String((item as { url?: string })?.url ?? '').trim();
        if (url && !isRvcModelPackageUrl(url) && /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(url)) urls.push(url);
      }
    }
    return urls;
  }

  /**
   * 轮询任务直到成功或失败，返回全部音频 URL（用于 AI 应用 / 翻唱多结果）
   */
  private async pollTaskUntilSuccess(
    taskId: string,
    fcBaseId: string,
    nodeId: string,
    onStatus: (packet: AIStatusPacket) => void,
    ledgerTaskId?: string | null,
  ): Promise<{ audioUrl: string; audioUrls: string[] }> {
    const totalTimeout = 10 * 60 * 1000;
    const startTime = Date.now();
    let attempt = 0;
    let lastPollTime = startTime;
    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= totalTimeout) throw new Error(`轮询超时（10分钟），任务 ID: ${taskId}`);
      const pollInterval = elapsed < 30000 ? 2000 : 5000;
      const timeSinceLastPoll = Date.now() - lastPollTime;
      if (timeSinceLastPoll < pollInterval) await new Promise((r) => setTimeout(r, pollInterval - timeSinceLastPoll));
      attempt++;
      lastPollTime = Date.now();
      try {
        const pollData = await rhQueryPollAudio(taskId, `${fcBaseId}:poll:${attempt}`, ledgerTaskId);
        const status = pollData.status;
        if (status === 'SUCCESS') {
          const audioUrls = this.extractAudioUrlsFromPollResults(pollData.results);
          if (audioUrls.length > 0) return { audioUrl: audioUrls[0], audioUrls };
          throw new Error('任务成功但未返回音频结果');
        } else if (status === 'FAILED' || status === 'FAILURE') {
          if (pollData.failedReason) {
            console.error('[音频生成] RH failedReason:', JSON.stringify(pollData.failedReason, null, 2));
          }
          throw new Error(formatRunningHubTaskError(pollData as Record<string, unknown>, '任务失败'));
        }
        onStatus({ nodeId, status: 'PROCESSING', payload: { taskId } });
      } catch (pollError: unknown) {
        if (isFcBalanceInsufficientError(pollError)) throw pollError;
        if (isRetriableAudioPollError(pollError)) {
          const em = pollError instanceof Error ? pollError.message : String(pollError);
          console.warn(`[音频生成] AI 应用轮询可重试错误 (第 ${attempt} 次): ${em}，5 秒后重试…`);
          await new Promise((r) => setTimeout(r, 5000));
          lastPollTime = Date.now();
          continue;
        }
        throw pollError;
      }
    }
  }

  /**
   * 处理单段或多段音频结果：逐张下载并回传 outputAudios
   */
  private async handleAudioResults(
    audioUrls: string[],
    nodeId: string,
    onStatus: (packet: AIStatusPacket) => void,
    projectId?: string,
    nodeTitle?: string,
  ): Promise<void> {
    if (audioUrls.length === 0) return;
    if (audioUrls.length === 1) {
      await this.handleAudioResult(audioUrls[0], nodeId, onStatus, projectId, nodeTitle);
      return;
    }
    try {
      const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');
      const finalUrls: string[] = [];
      const originalUrls: string[] = [];
      let primaryLocalPath: string | undefined;
      for (let i = 0; i < audioUrls.length; i++) {
        const remote = audioUrls[i];
        originalUrls.push(remote);
        try {
          const downloadedPath = await autoDownloadResource(remote, 'audio', {
            resourceType: 'audio',
            nodeId,
            nodeTitle: `${nodeTitle || 'audio'}_${i + 1}`,
            projectId,
          });
          if (downloadedPath) {
            finalUrls.push(`local-resource://${downloadedPath.replace(/\\/g, '/')}`);
            if (i === 0) primaryLocalPath = downloadedPath;
          } else {
            finalUrls.push(remote);
          }
        } catch {
          finalUrls.push(remote);
        }
      }
      const primary = finalUrls[0];
      onStatus({
        nodeId,
        status: 'SUCCESS',
        payload: {
          url: primary,
          audioUrl: primary,
          originalAudioUrl: originalUrls[0],
          localPath: primaryLocalPath,
          outputAudios: finalUrls,
          originalOutputAudios: originalUrls,
          text: `翻唱完成，共 ${finalUrls.length} 段音频`,
        },
      });
    } catch (downloadError: unknown) {
      console.error('[音频生成] 多段音频处理失败:', downloadError);
      onStatus({
        nodeId,
        status: 'SUCCESS',
        payload: {
          url: audioUrls[0],
          audioUrl: audioUrls[0],
          outputAudios: audioUrls,
          originalOutputAudios: audioUrls,
          text: `翻唱完成，共 ${audioUrls.length} 段音频`,
        },
      });
    }
  }

  /**
   * 处理音频结果：下载音频文件到本地
   */
  private async handleAudioResult(
    audioUrl: string,
    nodeId: string,
    onStatus: (packet: AIStatusPacket) => void,
    projectId?: string,
    nodeTitle?: string,
  ): Promise<void> {
    if (isRvcModelPackageUrl(audioUrl)) {
      console.warn('[音频生成] 跳过将 RVC 模型包当作音频处理:', audioUrl.slice(0, 96));
      return;
    }
    try {
      // 自动下载音频到本地
      const { autoDownloadResource } = await import('../../utils/resourceDownloader.js');

      const downloadedPath = await autoDownloadResource(audioUrl, 'audio', {
        resourceType: 'audio',
        nodeId: nodeId,
        nodeTitle: nodeTitle || 'audio',
        projectId: projectId,
      });

      if (downloadedPath) {
        // 使用本地路径
        const localAudioUrl = `local-resource://${downloadedPath.replace(/\\/g, '/')}`;
        console.log(`[音频生成] 音频已自动下载到本地: ${downloadedPath}`);

        onStatus({
          nodeId,
          status: 'SUCCESS',
          payload: {
            url: localAudioUrl,
            audioUrl: localAudioUrl,
            originalAudioUrl: audioUrl, // 保存原始远程 URL
            localPath: downloadedPath,
            outputAudios: [localAudioUrl],
            originalOutputAudios: [audioUrl],
            text: `音频生成完成: ${localAudioUrl}`,
          },
        });
      } else {
        // 下载失败，使用远程 URL
        console.warn('[音频生成] 音频下载失败，使用远程 URL');
        onStatus({
          nodeId,
          status: 'SUCCESS',
          payload: {
            url: audioUrl,
            audioUrl: audioUrl,
            outputAudios: [audioUrl],
            originalOutputAudios: [audioUrl],
            text: `音频生成完成: ${audioUrl}`,
          },
        });
      }
    } catch (downloadError: unknown) {
      console.error('[音频生成] 处理音频结果失败:', downloadError);
      // 下载失败不影响音频显示，使用远程 URL
      onStatus({
        nodeId,
        status: 'SUCCESS',
        payload: {
          url: audioUrl,
          audioUrl: audioUrl,
          outputAudios: [audioUrl],
          originalOutputAudios: [audioUrl],
          text: `音频生成完成: ${audioUrl}`,
        },
      });
    }
  }
}
