/**
 * Audio Unified Cloud Queue Golden Path
 * ACTIVE 音频/TTS 强制 Queue（禁止 Direct 回落）
 * - speech-2.8-hd：MiniMax TTS（.cn）
 * - index-tts2：ai-app 克隆配音（.cn）
 * - doubao-seed-audio-1.0：豆包音频生成（.cn）
 * - rhart-song-v5.5：SUNO v5.5（.ai）
 * - rvc-voice-train：RVC 训练 ai-app（.cn）
 * 排除：ai-voice-cover（本地推理）
 * Feature Gate：AUDIO_QUEUE_ENABLED / VITE_AUDIO_QUEUE_ENABLED（未设置默认开启）
 */

import {
  clampDoubaoLoudnessRate,
  clampDoubaoPitchRate,
  clampDoubaoSpeechRate,
} from './doubaoSeedAudioUtils.js';

function readEnvFlag(raw: string | undefined, defaultOn = true): boolean {
  if (raw == null || String(raw).trim() === '') return defaultOn;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function isAudioQueueGoldenPathEnabled(): boolean {
  if (typeof process !== 'undefined' && process.env && 'AUDIO_QUEUE_ENABLED' in process.env) {
    return readEnvFlag(process.env.AUDIO_QUEUE_ENABLED, true);
  }
  return true;
}

export function isAudioQueueGoldenPathEnabledRenderer(): boolean {
  try {
    const vite = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
    if (vite && 'VITE_AUDIO_QUEUE_ENABLED' in vite) {
      return readEnvFlag(vite.VITE_AUDIO_QUEUE_ENABLED, true);
    }
  } catch {
    /* ignore */
  }
  return true;
}

export const AUDIO_QUEUE_SPEECH_28_HD_MODEL = 'speech-2.8-hd' as const;
export const AUDIO_QUEUE_INDEX_TTS2_MODEL = 'index-tts2' as const;
/** 与 DOUBAO_SEED_AUDIO_MODEL_ID 对齐 */
export const AUDIO_QUEUE_DOUBAO_SEED_AUDIO_MODEL = 'doubao-seed-audio-1.0' as const;
export const AUDIO_QUEUE_RHART_SONG_V55_MODEL = 'rhart-song-v5.5' as const;
export const AUDIO_QUEUE_RVC_VOICE_TRAIN_MODEL = 'rvc-voice-train' as const;

export const AUDIO_QUEUE_ONLY_MODEL_IDS = [
  AUDIO_QUEUE_SPEECH_28_HD_MODEL,
  AUDIO_QUEUE_INDEX_TTS2_MODEL,
  AUDIO_QUEUE_DOUBAO_SEED_AUDIO_MODEL,
  AUDIO_QUEUE_RHART_SONG_V55_MODEL,
  AUDIO_QUEUE_RVC_VOICE_TRAIN_MODEL,
] as const;

export type AudioQueueOnlyModelId = (typeof AUDIO_QUEUE_ONLY_MODEL_IDS)[number];

const AUDIO_QUEUE_ONLY_SET = new Set<string>(AUDIO_QUEUE_ONLY_MODEL_IDS);

export function isAudioQueueOnlyModel(modelId: unknown): boolean {
  return AUDIO_QUEUE_ONLY_SET.has(String(modelId ?? '').trim());
}

export function assertNotDirectChargeForAudioQueueOnlyModel(modelId: unknown, via = 'direct'): void {
  const m = String(modelId ?? '').trim();
  if (!AUDIO_QUEUE_ONLY_SET.has(m)) return;
  throw new Error(
    `QUEUE_ONLY_MODEL_DIRECT_FORBIDDEN:${m} 已强制云端排队，禁止 Direct（via=${via}）`,
  );
}

export const INDEX_TTS2_APP_ID = '2008113338793857025' as const;
export const INDEX_TTS2_RUN_PATH = `/run/ai-app/${INDEX_TTS2_APP_ID}` as const;

export const RVC_VOICE_TRAIN_APP_ID = '2072990640429953025' as const;
export const RVC_VOICE_TRAIN_RUN_PATH = `/run/ai-app/${RVC_VOICE_TRAIN_APP_ID}` as const;

export const SPEECH_28_HD_RUN_PATH = '/rhart-audio/text-to-audio/speech-2.8-hd' as const;
export const DOUBAO_SEED_AUDIO_RUN_PATH = '/bytedance/doubao-seed-audio-1.0' as const;
export const RHART_SONG_V55_RUN_PATH = '/rhart-audio/suno-v5.5/custom' as const;

export type AudioQueueProviderForward = {
  provider: 'runninghub';
  path: string;
  method: 'POST';
  body: Record<string, unknown>;
  billingModelId?: string;
  rhRegion?: 'cn' | 'ai';
};

function isAudioQueueBypass(input: Record<string, unknown>): boolean {
  if (input.directorSpawned === true || input.drama === true) return true;
  return false;
}

export function assertAudioQueueHttpsUrl(url: unknown, label: string): string {
  const u = String(url || '').trim();
  if (!u) throw new Error(`${label} 不能为空`);
  if (/^(openapi|api)\//i.test(u)) {
    throw new Error(`${label} 须为 HTTPS OSS URL，不能是 RH Media fileName`);
  }
  if (!u.startsWith('https://')) {
    throw new Error(`${label} 必须为 HTTPS OSS URL，实际: ${u.slice(0, 80)}`);
  }
  if (/^(file:|data:|blob:|local-resource:)/i.test(u)) {
    throw new Error(`${label} 禁止 local/file/data/blob 写入 Queue`);
  }
  return u;
}

/** MiniMax speech-2.8-hd：需非空 text */
export function isCanvasSpeech28HdQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== AUDIO_QUEUE_SPEECH_28_HD_MODEL) return false;
  if (!String(input.text || '').trim()) return false;
  if (isAudioQueueBypass(input)) return false;
  return true;
}

/** Index-TTS2：text + referenceAudioUrl */
export function isCanvasIndexTts2QueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== AUDIO_QUEUE_INDEX_TTS2_MODEL) return false;
  if (!String(input.text || '').trim()) return false;
  if (!String(input.referenceAudioUrl || '').trim()) return false;
  if (isAudioQueueBypass(input)) return false;
  return true;
}

/** Doubao：text + 恰好一种声音来源 */
export function isCanvasDoubaoSeedAudioQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== AUDIO_QUEUE_DOUBAO_SEED_AUDIO_MODEL) return false;
  if (!String(input.text || '').trim()) return false;
  const speaker = String(input.doubaoSpeaker || '').trim();
  const imageUrl = String(input.doubaoImageUrl || '').trim();
  const audioList = Array.isArray(input.doubaoAudioUrls)
    ? input.doubaoAudioUrls.map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  const singleRef = String(input.referenceAudioUrl || '').trim();
  if (audioList.length === 0 && singleRef) audioList.push(singleRef);
  const modes = [!!speaker, audioList.length > 0, !!imageUrl].filter(Boolean).length;
  if (modes !== 1) return false;
  if (audioList.length > 3) return false;
  if (isAudioQueueBypass(input)) return false;
  return true;
}

/** SUNO v5.5：songName + styleDesc + lyrics */
export function isCanvasRhartSongV55QueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== AUDIO_QUEUE_RHART_SONG_V55_MODEL) return false;
  if (!String(input.songName || '').trim()) return false;
  if (!String(input.styleDesc || '').trim()) return false;
  if (!String(input.lyrics || '').trim()) return false;
  if (isAudioQueueBypass(input)) return false;
  return true;
}

/** RVC 训练：referenceAudioUrl + rvcTrainModelName */
export function isCanvasRvcVoiceTrainQueueGoldenPathInput(input: Record<string, unknown>): boolean {
  if (input.nxCloudQueueGoldenPath !== true) return false;
  if (String(input.model || '').trim() !== AUDIO_QUEUE_RVC_VOICE_TRAIN_MODEL) return false;
  if (!String(input.referenceAudioUrl || '').trim()) return false;
  if (!String(input.rvcTrainModelName || '').trim()) return false;
  if (isAudioQueueBypass(input)) return false;
  return true;
}

export function buildSpeech28HdRhForward(body: {
  text: string;
  voice_id?: string;
  speed?: number;
  volume?: number;
  pitch?: number;
  pronunciation_dict?: string[];
  enable_base64_output?: boolean;
  english_normalization?: boolean;
  emotion?: string;
  billingModelId?: string;
}): AudioQueueProviderForward {
  const text = String(body.text || '').trim();
  if (!text) throw new Error('speech-2.8-hd 文本不能为空');
  const payload: Record<string, unknown> = {
    text,
    voice_id: String(body.voice_id || 'Wise_Woman').trim() || 'Wise_Woman',
    speed: Math.max(0.5, Math.min(2, Number(body.speed) || 1)),
    volume: Math.max(0.1, Math.min(10, Number(body.volume) || 1)),
    pitch: Math.max(-12, Math.min(12, Number(body.pitch) || 0)),
    enable_base64_output: !!body.enable_base64_output,
    english_normalization: !!body.english_normalization,
  };
  if (Array.isArray(body.pronunciation_dict) && body.pronunciation_dict.length > 0) {
    payload.pronunciation_dict = body.pronunciation_dict;
  }
  if (body.emotion) payload.emotion = body.emotion;
  return {
    provider: 'runninghub',
    path: SPEECH_28_HD_RUN_PATH,
    method: 'POST',
    body: payload,
    billingModelId: body.billingModelId || AUDIO_QUEUE_SPEECH_28_HD_MODEL,
    rhRegion: 'cn',
  };
}

export function buildIndexTts2RhForward(body: {
  text: string;
  /** 已 OSS HTTPS */
  audioUrl: string;
  select?: string;
  billingModelId?: string;
}): AudioQueueProviderForward {
  const text = String(body.text || '').trim();
  if (!text) throw new Error('index-tts2 台词不能为空');
  const audioUrl = assertAudioQueueHttpsUrl(body.audioUrl, 'index-tts2 参考音');
  return {
    provider: 'runninghub',
    path: INDEX_TTS2_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '13', fieldName: 'audio', fieldValue: audioUrl, description: '参考音' },
        { nodeId: '60', fieldName: 'text', fieldValue: text, description: '台词' },
        {
          nodeId: '106',
          fieldName: 'select',
          fieldValue: String(body.select || '1'),
          description: 'select',
        },
      ],
      instanceType: 'default',
      usePersonalQueue: 'false',
    },
    billingModelId: body.billingModelId || AUDIO_QUEUE_INDEX_TTS2_MODEL,
    rhRegion: 'cn',
  };
}

export function buildDoubaoSeedAudioRhForward(body: {
  text: string;
  speaker?: string;
  /** 已 OSS HTTPS，≤3 */
  audioUrls?: string[];
  /** 已 OSS HTTPS */
  imageUrl?: string;
  speechRate?: number;
  loudnessRate?: number;
  pitchRate?: number;
  billingModelId?: string;
}): AudioQueueProviderForward {
  const textPrompt = String(body.text || '').trim();
  if (!textPrompt) throw new Error('Doubao 音频生成需要填写文本提示词');
  if (textPrompt.length > 3000) throw new Error('文本提示词不能超过 3000 字符');

  const speaker = String(body.speaker || '').trim();
  const imageUrlRaw = String(body.imageUrl || '').trim();
  const audioUrls = (body.audioUrls || [])
    .map((u) => String(u || '').trim())
    .filter(Boolean)
    .slice(0, 3);
  const modes = [!!speaker, audioUrls.length > 0, !!imageUrlRaw].filter(Boolean).length;
  if (modes !== 1) {
    throw new Error('Doubao 只能选一种声音来源：预设音色 / 参考音频 / 人物照片');
  }

  const references: Array<Record<string, unknown>> = [];
  if (speaker) {
    references.push({ speaker });
  } else if (audioUrls.length > 0) {
    for (const u of audioUrls) {
      references.push({ audio_url: assertAudioQueueHttpsUrl(u, 'Doubao 参考音频') });
    }
  } else {
    references.push({
      image_url: assertAudioQueueHttpsUrl(imageUrlRaw, 'Doubao 参考图片'),
    });
  }

  return {
    provider: 'runninghub',
    path: DOUBAO_SEED_AUDIO_RUN_PATH,
    method: 'POST',
    body: {
      text_prompt: textPrompt,
      text: textPrompt,
      speech_rate: clampDoubaoSpeechRate(body.speechRate ?? 0),
      loudness_rate: clampDoubaoLoudnessRate(body.loudnessRate ?? 0),
      pitch_rate: clampDoubaoPitchRate(body.pitchRate ?? 0),
      format: 'mp3',
      sample_rate: '24000',
      references,
    },
    billingModelId: body.billingModelId || AUDIO_QUEUE_DOUBAO_SEED_AUDIO_MODEL,
    rhRegion: 'cn',
  };
}

export function buildRhartSongV55RhForward(body: {
  songName: string;
  lyrics: string;
  styleDesc: string;
  billingModelId?: string;
}): AudioQueueProviderForward {
  const title = String(body.songName || '').trim().slice(0, 80);
  const prompt = String(body.lyrics || '').trim().slice(0, 5000);
  const tags = String(body.styleDesc || '').trim().slice(0, 1000);
  if (!title) throw new Error('全能写歌需要填写歌曲名');
  if (!prompt) throw new Error('全能写歌需要填写歌词');
  if (!tags) throw new Error('全能写歌需要填写风格描述');
  return {
    provider: 'runninghub',
    path: RHART_SONG_V55_RUN_PATH,
    method: 'POST',
    body: { title, prompt, tags },
    billingModelId: body.billingModelId || AUDIO_QUEUE_RHART_SONG_V55_MODEL,
    rhRegion: 'ai',
  };
}

export function buildRvcVoiceTrainRhForward(body: {
  audioUrl: string;
  modelName: string;
  billingModelId?: string;
}): AudioQueueProviderForward {
  const audioUrl = assertAudioQueueHttpsUrl(body.audioUrl, 'RVC 训练音频');
  const modelName = String(body.modelName || '').trim();
  if (!modelName) throw new Error('请填写 RVC 模型名称');
  return {
    provider: 'runninghub',
    path: RVC_VOICE_TRAIN_RUN_PATH,
    method: 'POST',
    body: {
      nodeInfoList: [
        { nodeId: '5', fieldName: 'audio', fieldValue: audioUrl, description: 'audio' },
        { nodeId: '6', fieldName: 'value', fieldValue: modelName, description: 'name' },
      ],
      instanceType: 'plus',
      usePersonalQueue: 'false',
      retainSeconds: 120,
    },
    billingModelId: body.billingModelId || AUDIO_QUEUE_RVC_VOICE_TRAIN_MODEL,
    rhRegion: 'cn',
  };
}
