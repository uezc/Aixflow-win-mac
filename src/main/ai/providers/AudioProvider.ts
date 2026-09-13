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
import {
  DOUBAO_SEED_AUDIO_MODEL_ID,
  clampDoubaoSpeechRate,
  clampDoubaoLoudnessRate,
  clampDoubaoPitchRate,
} from '../../../shared/doubaoSeedAudioUtils.js';
import {
  isAudioQueueGoldenPathEnabled,
  isAudioQueueOnlyModel,
  assertNotDirectChargeForAudioQueueOnlyModel,
  AUDIO_QUEUE_SPEECH_28_HD_MODEL,
  AUDIO_QUEUE_INDEX_TTS2_MODEL,
  AUDIO_QUEUE_DOUBAO_SEED_AUDIO_MODEL,
  AUDIO_QUEUE_RHART_SONG_V55_MODEL,
  AUDIO_QUEUE_RVC_VOICE_TRAIN_MODEL,
  isCanvasSpeech28HdQueueGoldenPathInput,
  isCanvasIndexTts2QueueGoldenPathInput,
  isCanvasDoubaoSeedAudioQueueGoldenPathInput,
  isCanvasRhartSongV55QueueGoldenPathInput,
  isCanvasRvcVoiceTrainQueueGoldenPathInput,
  buildSpeech28HdRhForward,
  buildIndexTts2RhForward,
  buildDoubaoSeedAudioRhForward,
  buildRhartSongV55RhForward,
  buildRvcVoiceTrainRhForward,
  type AudioQueueProviderForward,
} from '../../../shared/audioQueueGoldenPath.js';
import {
  mapCloudTaskToUserQueueUx,
  USER_QUEUE_UX_INDETERMINATE_PROGRESS,
} from '../../../shared/userQueueTaskUx.js';

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
  model?: string; // 'speech-2.8-hd' | 'index-tts2' | 'ai-voice-cover' | 'rhart-song-v5.5' | 'doubao-seed-audio-1.0'
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
  /** Doubao：参考音频 URL 列表（最多 3）；未传时回退 referenceAudioUrl */
  doubaoAudioUrls?: string[];
  /** Doubao：音色 ID（与 audio_url / image_url 互斥） */
  doubaoSpeaker?: string;
  /** Doubao：参考图片 URL（与 speaker / audio_url 互斥） */
  doubaoImageUrl?: string;
  /** Doubao：语速 [-50,100] */
  speechRate?: number;
  /** Doubao：音量 [-50,100] */
  loudnessRate?: number;
  /** Doubao：输出格式 */
  doubaoFormat?: string;
  /** Doubao：采样率 */
  doubaoSampleRate?: string;
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
  /** 画布音频 Queue Golden Path 开关（Queue-only 模型由面板/主进程强制 true） */
  nxCloudQueueGoldenPath?: boolean;
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
    m !== 'rvc-voice-train' &&
    m !== DOUBAO_SEED_AUDIO_MODEL_ID
  ) {
    return 'ai-voice-cover';
  }
  const ref = String(audioInput.referenceAudioUrl ?? '').trim();
  const hasText = String(audioInput.text ?? '').trim().length > 0;
  if (
    ref &&
    !hasText &&
    !sourceSong &&
    m !== 'index-tts2' &&
    m !== 'rhart-song-v5.5' &&
    m !== 'rhart-song' &&
    m !== DOUBAO_SEED_AUDIO_MODEL_ID
  ) {
    return 'rvc-voice-train';
  }
  return m;
}

export class AudioProvider extends BaseProvider {
  readonly modelId = 'audio';

  private readonly runningHubApiBaseUrl = 'https://nexflow-fc-rh.stub/openapi/v2';

  /** 本地/URL 图片 → 公网 OSS URL（Doubao image_url） */
  private async resolveImageUrlForRh(urlOrPath: string): Promise<string> {
    const raw = (urlOrPath || '').trim();
    if (!raw) throw new Error('参考图片 URL 为空');
    const { VideoProvider } = await import('./VideoProvider.js');
    const vp = new VideoProvider();
    return vp.processImageToOssUrl(raw);
  }

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

  private async executeAudioCloudQueueGoldenPath(opts: {
    nodeId: string;
    audioInput: AudioInput;
    onStatus: AIExecuteParams['onStatus'];
    model: string;
    billingModelId: string;
    rhForward: AudioQueueProviderForward;
    prompt: string;
    nodeData: Record<string, unknown>;
    logTag?: string;
    /** rvc-voice-train：SUCCESS 走 handleRvcTrainResult */
    resultMode?: 'audio' | 'rvc-train';
    rvcTrainModelName?: string;
  }): Promise<void> {
    const {
      nodeId,
      audioInput,
      onStatus,
      model,
      billingModelId,
      rhForward,
      prompt,
      nodeData,
      logTag = 'audio-queue-golden',
      resultMode = 'audio',
      rvcTrainModelName,
    } = opts;

    onStatus({ nodeId, status: 'START', payload: { progress: 1, text: '任务已提交云端队列…' } });

    const {
      isNxSaasMode,
      isNxOfflineCloudSession,
      getNxAccessToken,
      nxCloudTasksCreate,
      nxCloudTaskStatus,
    } = await import('../../services/aliyunService.js');

    if (!isAudioQueueGoldenPathEnabled()) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: 'AUDIO_QUEUE_ENABLED 未开启，无法使用 queue golden path' },
      });
      return;
    }
    if (
      !getAliyunFcInitUserUrl().trim() ||
      !isNxSaasMode() ||
      isNxOfflineCloudSession() ||
      !getNxAccessToken()
    ) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: '请先登录云端账号后再使用 queue 音频生成' },
      });
      return;
    }

    let taskId: string;
    try {
      const created = await nxCloudTasksCreate({
        model_id: billingModelId,
        type: 'audio',
        execution_mode: 'queue',
        provider_forward_json: rhForward,
        params: {
          nodeId,
          taskKind: 'audio',
          model,
          prompt: prompt.slice(0, 4000),
          nxCloudQueueGoldenPath: true,
        },
        nodeData: {
          ...nodeData,
          model,
          prompt,
          ...(audioInput.projectId ? { projectId: audioInput.projectId } : {}),
        },
      });
      taskId = created.task_id;
      const { notifyNxCloudTaskTrack } = await import('../../nxCloudTaskTrackNotifier.js');
      notifyNxCloudTaskTrack({ taskId, nodeId, taskType: 'audio', balance: created.balance });
      console.log(
        `[AudioProvider][${logTag}] created task=${taskId} model=${billingModelId} rhRegion=${rhForward.rhRegion ?? '?'} quoted=${created.quoted_cost_coins ?? '?'}`,
      );
    } catch (e) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: buildFcErrorPayload(e, '创建云端队列任务失败'),
      });
      return;
    }

    onStatus({
      nodeId,
      status: 'PROCESSING',
      payload: {
        progress: USER_QUEUE_UX_INDETERMINATE_PROGRESS,
        text: '准备排队…',
        cloudTaskId: taskId,
      },
    });

    const deadline = Date.now() + 30 * 60_000;
    let pollN = 0;
    while (Date.now() < deadline) {
      pollN += 1;
      const sleepMs = pollN <= 3 ? 3000 : pollN <= 12 ? 8000 : 15_000;
      await new Promise((r) => setTimeout(r, sleepMs));
      let row: Awaited<ReturnType<typeof nxCloudTaskStatus>>;
      try {
        row = await nxCloudTaskStatus(taskId);
      } catch (e) {
        console.warn(`[AudioProvider][${logTag}] status poll error`, e);
        continue;
      }
      const st = String(row.status || '').toLowerCase();
      const ux = mapCloudTaskToUserQueueUx({
        status: row.status,
        execution_stage: row.execution_stage,
        ahead_count: row.ahead_count,
        queue_position: row.queue_position,
        queue_position_available: row.queue_position_available,
        queue_position_complete: row.queue_position_complete,
        error_msg: row.error_msg,
        error_code: row.error_code,
        refunded: row.refunded,
      });
      onStatus({
        nodeId,
        status: 'PROCESSING',
        payload: {
          progress: USER_QUEUE_UX_INDETERMINATE_PROGRESS,
          text: ux.progressMessage,
          cloudTaskId: taskId,
          execution_stage: String(row.execution_stage || ''),
          ahead_count: row.ahead_count ?? null,
          queue_position: row.queue_position ?? null,
        },
      });

      if (st === 'success') {
        const { splitNxTaskResultOssUrls } = await import('../../services/aliyunService.js');
        const url = splitNxTaskResultOssUrls(row.result_oss_url)[0] || '';
        if (!url) {
          continue;
        }
        if (resultMode === 'rvc-train') {
          await this.handleRvcTrainResult(
            url,
            String(rvcTrainModelName || audioInput.rvcTrainModelName || 'audio').trim() || 'audio',
            nodeId,
            onStatus,
            audioInput.projectId,
            audioInput.nodeTitle,
          );
          return;
        }
        onStatus({
          nodeId,
          status: 'SUCCESS',
          payload: {
            audioUrl: url,
            outputAudios: [url],
            cloudTaskId: taskId,
            progress: 100,
            text: '生成完成',
          },
        });
        return;
      }
      if (st === 'failed' || st === 'cancelled' || st === 'timeout') {
        const errMsg =
          ux.failureDetail?.replace(/^失败原因：/, '') ||
          String(row.error_msg || row.error_code || '音频生成失败');
        onStatus({
          nodeId,
          status: 'ERROR',
          payload: {
            error: row.refunded ? `${ux.progressMessage}${errMsg ? `：${errMsg}` : ''}` : errMsg,
            cloudTaskId: taskId,
            ...(String(row.error_code || '') === 'BALANCE_INSUFFICIENT'
              ? { balanceInsufficient: true }
              : {}),
          },
        });
        return;
      }
    }

    onStatus({
      nodeId,
      status: 'ERROR',
      payload: { error: '云端任务超时，请稍后在任务列表查看', cloudTaskId: taskId },
    });
  }

  private async executeSpeech28HdCloudQueueGoldenPath(opts: {
    nodeId: string;
    audioInput: AudioInput;
    onStatus: AIExecuteParams['onStatus'];
  }): Promise<void> {
    const { nodeId, audioInput, onStatus } = opts;
    let rhForward: AudioQueueProviderForward;
    try {
      rhForward = buildSpeech28HdRhForward({
        text: String(audioInput.text || ''),
        voice_id: audioInput.voice_id,
        speed: audioInput.speed,
        volume: audioInput.volume,
        pitch: audioInput.pitch,
        pronunciation_dict: audioInput.pronunciation_dict,
        enable_base64_output: audioInput.enable_base64_output,
        english_normalization: audioInput.english_normalization,
        emotion: audioInput.emotion,
        billingModelId: AUDIO_QUEUE_SPEECH_28_HD_MODEL,
      });
    } catch (e: unknown) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: String((e as Error)?.message || e || 'speech-2.8-hd forward 构建失败') },
      });
      return;
    }
    await this.executeAudioCloudQueueGoldenPath({
      nodeId,
      audioInput,
      onStatus,
      model: AUDIO_QUEUE_SPEECH_28_HD_MODEL,
      billingModelId: AUDIO_QUEUE_SPEECH_28_HD_MODEL,
      rhForward,
      prompt: String(audioInput.text || ''),
      nodeData: {
        voice_id: audioInput.voice_id,
        speed: audioInput.speed,
        volume: audioInput.volume,
        pitch: audioInput.pitch,
        emotion: audioInput.emotion,
      },
      logTag: 'queue-speech-2.8-hd',
    });
  }

  private async executeIndexTts2CloudQueueGoldenPath(opts: {
    nodeId: string;
    audioInput: AudioInput;
    onStatus: AIExecuteParams['onStatus'];
  }): Promise<void> {
    const { nodeId, audioInput, onStatus } = opts;
    const ref = String(audioInput.referenceAudioUrl || '').trim();
    if (!ref) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: 'Index-TTS2.0 配音神器需要上传参考音（参考音为必填）' },
      });
      return;
    }
    onStatus({
      nodeId,
      status: 'PROCESSING',
      payload: { progress: 2, text: '正在处理参考音…' },
    });
    let audioUrl: string;
    try {
      audioUrl = await this.resolveAudioUrlForRhApp(ref);
    } catch (e: unknown) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: String((e as Error)?.message || e || '参考音处理失败') },
      });
      return;
    }
    let rhForward: AudioQueueProviderForward;
    try {
      rhForward = buildIndexTts2RhForward({
        text: String(audioInput.text || ''),
        audioUrl,
        select: audioInput.indexTts2Select,
        billingModelId: AUDIO_QUEUE_INDEX_TTS2_MODEL,
      });
    } catch (e: unknown) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: String((e as Error)?.message || e || 'index-tts2 forward 构建失败') },
      });
      return;
    }
    await this.executeAudioCloudQueueGoldenPath({
      nodeId,
      audioInput,
      onStatus,
      model: AUDIO_QUEUE_INDEX_TTS2_MODEL,
      billingModelId: AUDIO_QUEUE_INDEX_TTS2_MODEL,
      rhForward,
      prompt: String(audioInput.text || ''),
      nodeData: { indexTts2Select: audioInput.indexTts2Select },
      logTag: 'queue-index-tts2',
    });
  }

  private async executeDoubaoSeedAudioCloudQueueGoldenPath(opts: {
    nodeId: string;
    audioInput: AudioInput;
    onStatus: AIExecuteParams['onStatus'];
  }): Promise<void> {
    const { nodeId, audioInput, onStatus } = opts;
    const speaker = String(audioInput.doubaoSpeaker ?? '').trim();
    const imageRaw = String(audioInput.doubaoImageUrl ?? '').trim();
    const audioListRaw = Array.isArray(audioInput.doubaoAudioUrls)
      ? audioInput.doubaoAudioUrls.map((u) => String(u ?? '').trim()).filter(Boolean)
      : [];
    const singleRef = String(audioInput.referenceAudioUrl ?? '').trim();
    if (audioListRaw.length === 0 && singleRef) audioListRaw.push(singleRef);

    let audioUrls: string[] | undefined;
    let imageUrl: string | undefined;
    try {
      if (audioListRaw.length > 0) {
        onStatus({
          nodeId,
          status: 'PROCESSING',
          payload: { progress: 2, text: '正在处理参考音…' },
        });
        audioUrls = [];
        for (const u of audioListRaw) {
          audioUrls.push(await this.resolveAudioUrlForRhApp(u));
        }
      } else if (imageRaw) {
        onStatus({
          nodeId,
          status: 'PROCESSING',
          payload: { progress: 2, text: '正在处理参考图…' },
        });
        imageUrl = await this.resolveImageUrlForRh(imageRaw);
      }
    } catch (e: unknown) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: String((e as Error)?.message || e || 'Doubao 参考素材处理失败') },
      });
      return;
    }

    let rhForward: AudioQueueProviderForward;
    try {
      rhForward = buildDoubaoSeedAudioRhForward({
        text: String(audioInput.text || ''),
        speaker: speaker || undefined,
        audioUrls,
        imageUrl,
        speechRate: audioInput.speechRate,
        loudnessRate: audioInput.loudnessRate,
        pitchRate: audioInput.pitch,
        billingModelId: AUDIO_QUEUE_DOUBAO_SEED_AUDIO_MODEL,
      });
    } catch (e: unknown) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: String((e as Error)?.message || e || 'doubao-seed-audio forward 构建失败') },
      });
      return;
    }
    await this.executeAudioCloudQueueGoldenPath({
      nodeId,
      audioInput,
      onStatus,
      model: AUDIO_QUEUE_DOUBAO_SEED_AUDIO_MODEL,
      billingModelId: AUDIO_QUEUE_DOUBAO_SEED_AUDIO_MODEL,
      rhForward,
      prompt: String(audioInput.text || ''),
      nodeData: {
        speechRate: audioInput.speechRate,
        loudnessRate: audioInput.loudnessRate,
        pitch: audioInput.pitch,
      },
      logTag: 'queue-doubao-seed-audio',
    });
  }

  private async executeRhartSongV55CloudQueueGoldenPath(opts: {
    nodeId: string;
    audioInput: AudioInput;
    onStatus: AIExecuteParams['onStatus'];
  }): Promise<void> {
    const { nodeId, audioInput, onStatus } = opts;
    let rhForward: AudioQueueProviderForward;
    try {
      rhForward = buildRhartSongV55RhForward({
        songName: String(audioInput.songName || ''),
        lyrics: String(audioInput.lyrics || ''),
        styleDesc: String(audioInput.styleDesc || ''),
        billingModelId: AUDIO_QUEUE_RHART_SONG_V55_MODEL,
      });
    } catch (e: unknown) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: String((e as Error)?.message || e || 'rhart-song-v5.5 forward 构建失败') },
      });
      return;
    }
    await this.executeAudioCloudQueueGoldenPath({
      nodeId,
      audioInput,
      onStatus,
      model: AUDIO_QUEUE_RHART_SONG_V55_MODEL,
      billingModelId: AUDIO_QUEUE_RHART_SONG_V55_MODEL,
      rhForward,
      prompt: String(audioInput.lyrics || audioInput.songName || ''),
      nodeData: {
        songName: audioInput.songName,
        styleDesc: audioInput.styleDesc,
      },
      logTag: 'queue-rhart-song-v5.5',
    });
  }

  private async executeRvcVoiceTrainCloudQueueGoldenPath(opts: {
    nodeId: string;
    audioInput: AudioInput;
    onStatus: AIExecuteParams['onStatus'];
  }): Promise<void> {
    const { nodeId, audioInput, onStatus } = opts;
    const trainAudio = String(audioInput.referenceAudioUrl || '').trim();
    const modelName = String(audioInput.rvcTrainModelName ?? '').trim();
    if (!trainAudio) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: 'RVC 训练需要连接训练音频（1 路 audio 入边）' },
      });
      return;
    }
    if (!modelName) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: '请填写 RVC 模型名称' },
      });
      return;
    }
    onStatus({
      nodeId,
      status: 'PROCESSING',
      payload: { progress: 2, text: '正在处理训练音频…' },
    });
    let audioUrl: string;
    try {
      audioUrl = await this.resolveAudioUrlForRhApp(trainAudio);
    } catch (e: unknown) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: String((e as Error)?.message || e || '训练音频处理失败') },
      });
      return;
    }
    let rhForward: AudioQueueProviderForward;
    try {
      rhForward = buildRvcVoiceTrainRhForward({
        audioUrl,
        modelName,
        billingModelId: AUDIO_QUEUE_RVC_VOICE_TRAIN_MODEL,
      });
    } catch (e: unknown) {
      onStatus({
        nodeId,
        status: 'ERROR',
        payload: { error: String((e as Error)?.message || e || 'rvc-voice-train forward 构建失败') },
      });
      return;
    }
    await this.executeAudioCloudQueueGoldenPath({
      nodeId,
      audioInput,
      onStatus,
      model: AUDIO_QUEUE_RVC_VOICE_TRAIN_MODEL,
      billingModelId: AUDIO_QUEUE_RVC_VOICE_TRAIN_MODEL,
      rhForward,
      prompt: modelName,
      nodeData: { rvcTrainModelName: modelName },
      logTag: 'queue-rvc-voice-train',
      resultMode: 'rvc-train',
      rvcTrainModelName: modelName,
    });
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

      // P0：Queue-only 型号在 Direct 提交之前强制走 Unified Queue（禁止 Direct）
      {
        if (isAudioQueueOnlyModel(model)) {
          (audioInput as AudioInput).nxCloudQueueGoldenPath = true;
        }
        const queueForcedInput = {
          ...(audioInput as unknown as Record<string, unknown>),
          model,
          nxCloudQueueGoldenPath: true,
        };

        if (
          model === AUDIO_QUEUE_SPEECH_28_HD_MODEL &&
          isCanvasSpeech28HdQueueGoldenPathInput(queueForcedInput)
        ) {
          await this.executeSpeech28HdCloudQueueGoldenPath({ nodeId, audioInput, onStatus });
          return;
        }
        if (
          model === AUDIO_QUEUE_INDEX_TTS2_MODEL &&
          isCanvasIndexTts2QueueGoldenPathInput(queueForcedInput)
        ) {
          await this.executeIndexTts2CloudQueueGoldenPath({ nodeId, audioInput, onStatus });
          return;
        }
        if (
          model === AUDIO_QUEUE_DOUBAO_SEED_AUDIO_MODEL &&
          isCanvasDoubaoSeedAudioQueueGoldenPathInput(queueForcedInput)
        ) {
          await this.executeDoubaoSeedAudioCloudQueueGoldenPath({ nodeId, audioInput, onStatus });
          return;
        }
        if (
          model === AUDIO_QUEUE_RHART_SONG_V55_MODEL &&
          isCanvasRhartSongV55QueueGoldenPathInput(queueForcedInput)
        ) {
          await this.executeRhartSongV55CloudQueueGoldenPath({ nodeId, audioInput, onStatus });
          return;
        }
        if (
          model === AUDIO_QUEUE_RVC_VOICE_TRAIN_MODEL &&
          isCanvasRvcVoiceTrainQueueGoldenPathInput(queueForcedInput)
        ) {
          await this.executeRvcVoiceTrainCloudQueueGoldenPath({ nodeId, audioInput, onStatus });
          return;
        }

        if (isAudioQueueOnlyModel(model)) {
          onStatus({
            nodeId,
            status: 'ERROR',
            payload: {
              error:
                `模型 ${model} 已强制走云端排队，无法使用 Direct。` +
                '请检查：已登录云端、AUDIO_QUEUE_ENABLED 未关闭、输入形态与该模型匹配。',
            },
          });
          return;
        }
      }

      // 双重保险：Queue-only 不应落到 Direct（上方已 early-return）
      assertNotDirectChargeForAudioQueueOnlyModel(model, 'AudioProvider.execute');

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
        assertNotDirectChargeForAudioQueueOnlyModel(model, 'rhart-song-v5.5-direct');
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
        assertNotDirectChargeForAudioQueueOnlyModel(model, 'rvc-voice-train-direct');
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

      // Doubao 音频生成 1.0：POST /bytedance/doubao-seed-audio-1.0（路径首段 bytedance，须显式 billingModelId）
      if (model === DOUBAO_SEED_AUDIO_MODEL_ID) {
        assertNotDirectChargeForAudioQueueOnlyModel(model, 'doubao-seed-audio-direct');
        const textPrompt = String(text ?? '').trim();
        if (!textPrompt) throw new Error('Doubao 音频生成需要填写文本提示词（text_prompt）');
        if (textPrompt.length > 3000) throw new Error('文本提示词不能超过 3000 字符');

        const speaker = String(audioInput.doubaoSpeaker ?? '').trim();
        const imageRaw = String(audioInput.doubaoImageUrl ?? '').trim();
        const audioListRaw = Array.isArray(audioInput.doubaoAudioUrls)
          ? audioInput.doubaoAudioUrls.map((u) => String(u ?? '').trim()).filter(Boolean)
          : [];
        const singleRef = String(referenceAudioUrl ?? '').trim();
        if (audioListRaw.length === 0 && singleRef) audioListRaw.push(singleRef);
        if (audioListRaw.length > 3) throw new Error('Doubao 参考音频最多 3 段');

        const hasSpeaker = !!speaker;
        const hasAudio = audioListRaw.length > 0;
        const hasImage = !!imageRaw;
        const refModes = [hasSpeaker, hasAudio, hasImage].filter(Boolean).length;
        if (refModes > 1) {
          throw new Error('选了多种声音来源：只能选一种——要么用系统预设音色，要么传一段参考音频，要么传一张人物照片，不能同时选多个。');
        }
        if (refModes === 0) {
          throw new Error(
            '没法生成声音：缺少「用什么声音来念」的信息。请选择以下任意一种方式：① 在素材准备里给角色生成/上传一段试听音（推荐）；② 选择一个系统预设的音色；③ 上传一张人物照片让 AI 猜声音。',
          );
        }

        const speechRate = clampDoubaoSpeechRate(audioInput.speechRate ?? 0);
        const loudnessRate = clampDoubaoLoudnessRate(audioInput.loudnessRate ?? 0);
        const pitchRate = clampDoubaoPitchRate(audioInput.pitch ?? 0);
        const format = 'mp3';
        const sampleRate = '24000';

        const payload: Record<string, unknown> = {
          text_prompt: textPrompt,
          text: textPrompt,
          speech_rate: speechRate,
          loudness_rate: loudnessRate,
          pitch_rate: pitchRate,
          format,
          sample_rate: sampleRate,
          references: [],
        };
        if (hasSpeaker) {
          (payload.references as Array<Record<string, unknown>>).push({ speaker });
        } else if (hasAudio) {
          const resolved: string[] = [];
          for (const u of audioListRaw) {
            resolved.push(await this.resolveAudioUrlForRhApp(u));
          }
          for (const url of resolved) {
            (payload.references as Array<Record<string, unknown>>).push({ audio_url: url });
          }
        } else if (hasImage) {
          const resolvedImg = await this.resolveImageUrlForRh(imageRaw);
          (payload.references as Array<Record<string, unknown>>).push({ image_url: resolvedImg });
        }

        console.log('[音频生成] Doubao-seed-audio-1.0 提交', {
          textLen: textPrompt.length,
          speechRate,
          hasSpeaker,
          audioCount: hasAudio ? audioListRaw.length : 0,
          hasImage,
          format,
          sampleRate,
        });

        const fcBaseId = randomUUID();
        const ledgerDoubao = await this.ensureLedgerAudioTask(nodeId, DOUBAO_SEED_AUDIO_MODEL_ID, audioInput);
        const data = await rhPostChargeAudio(
          `${this.runningHubApiBaseUrl}/bytedance/doubao-seed-audio-1.0`,
          payload,
          fcBaseId,
          { billingModelId: DOUBAO_SEED_AUDIO_MODEL_ID },
          ledgerDoubao,
        );
        fcChargedTaskId = ledgerDoubao || fcBaseId;
        const taskId = this.requireRhTaskIdFromSubmit(data, 'Doubao-音频生成-1.0');
        onStatus({ nodeId, status: 'PROCESSING', payload: { taskId: String(taskId) } });
        const pollResult = await this.pollTaskUntilSuccess(String(taskId), fcBaseId, nodeId, onStatus, ledgerDoubao, {
          totalTimeoutMs: 3 * 60 * 1000,
          timeoutLabel: '声音生成',
        });
        if (pollResult.audioUrls.length > 0) {
          await this.handleAudioResults(pollResult.audioUrls, nodeId, onStatus, projectId, nodeTitle);
        }
        return;
      }

      // Index-TTS2.0 配音神器：AI 应用 run/ai-app/2008113338793857025
      if (model === 'index-tts2') {
        assertNotDirectChargeForAudioQueueOnlyModel(model, 'index-tts2-direct');
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
        const pollResult = await this.pollTaskUntilSuccess(String(taskId), fcBaseId, nodeId, onStatus, ledgerTts, {
          totalTimeoutMs: 3 * 60 * 1000,
          timeoutLabel: '声音生成',
        });
        if (pollResult.audioUrls.length > 0) {
          await this.handleAudioResults(pollResult.audioUrls, nodeId, onStatus, projectId, nodeTitle);
        }
        return;
      }

      // 默认：语音合成 speech-2.8-hd
      assertNotDirectChargeForAudioQueueOnlyModel('speech-2.8-hd', 'speech-2.8-hd-direct');
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

      // 轮询配置：试听/配音 3 分钟总超时，超时失败并退回元宝
      const totalTimeout = 3 * 60 * 1000;
      const startTime = Date.now();
      let attempt = 0;
      let lastPollTime = startTime;

      // 轮询循环
      while (true) {
        // 检查总超时时间
        const elapsed = Date.now() - startTime;
        if (elapsed >= totalTimeout) {
          throw new Error(
            `声音生成超时（3分钟未完成），已退回元宝。任务 ID: ${taskId}`,
          );
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
      const rawMsg =
        (error instanceof Error ? error.message : String(error || '')) || '';
      const refundReason = /超时/.test(rawMsg) ? 'poll_timeout' : 'execute_failed';
      void tryRefundFcForwardCharge(fcChargedTaskId, 'audio', refundReason);
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
   * @param opts.totalTimeoutMs 默认 10 分钟；试听音/配音传 3 分钟
   */
  private async pollTaskUntilSuccess(
    taskId: string,
    fcBaseId: string,
    nodeId: string,
    onStatus: (packet: AIStatusPacket) => void,
    ledgerTaskId?: string | null,
    opts?: { totalTimeoutMs?: number; timeoutLabel?: string },
  ): Promise<{ audioUrl: string; audioUrls: string[] }> {
    const totalTimeout =
      Number.isFinite(Number(opts?.totalTimeoutMs)) && Number(opts?.totalTimeoutMs) > 0
        ? Number(opts!.totalTimeoutMs)
        : 10 * 60 * 1000;
    const timeoutMin = Math.max(1, Math.round(totalTimeout / 60_000));
    const label = String(opts?.timeoutLabel || '音频生成').trim() || '音频生成';
    const startTime = Date.now();
    let attempt = 0;
    let lastPollTime = startTime;
    while (true) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= totalTimeout) {
        throw new Error(
          `${label}超时（${timeoutMin}分钟未完成），已退回元宝。任务 ID: ${taskId}`,
        );
      }
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
