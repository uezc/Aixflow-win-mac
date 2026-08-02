/**
 * MV 歌词时间线：经 FC 调用百炼 fun-asr 异步录音文件识别。
 * 主进程负责本地音频 → 公网 URL（OSS/FC 代传）→ POST /asr/file-transcribe；
 * DASHSCOPE_API_KEY 仅存 FC，不下发渲染进程。不回退本地 Whisper。
 */
import fs from 'fs';
import path from 'path';
import { getNxFcAxios, getFcBaseUrlForClient } from './nxFcClient.js';
import { resolveLocalMediaFilePath } from './localResourceManager.js';

export type SpeechSegment = { text: string; startSec: number; endSec: number };
export type SpeechSegmentsResult = { text: string; segments: SpeechSegment[] };

const FC_FILE_TRANSCRIBE_TIMEOUT_MS = 11 * 60 * 1000;

function mimeFromAudioPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.flac') return 'audio/flac';
  if (ext === '.aac') return 'audio/aac';
  if (ext === '.webm') return 'audio/webm';
  return 'audio/mpeg';
}

function mapFcError(status: number, data: unknown): { code: string; message: string } {
  const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const err = String(body.error || '').trim();
  const msg = String(body.message || '').trim();
  if (status === 401 || err === 'UNAUTHORIZED') {
    return { code: 'UNAUTHORIZED', message: '请先登录账号后再使用云端转写' };
  }
  if (status === 402 || err === 'BALANCE_INSUFFICIENT') {
    return { code: 'BALANCE_INSUFFICIENT', message: msg || '元宝不足，请充值后再使用云端转写' };
  }
  if (err === 'DASHSCOPE_ASR_NOT_CONFIGURED' || status === 503) {
    return {
      code: 'NOT_CONFIGURED',
      message: msg || '云端未配置录音识别（DASHSCOPE_API_KEY），请联系管理员',
    };
  }
  if (err === 'FILE_URL_REQUIRED' || status === 400) {
    return { code: err || 'BAD_REQUEST', message: msg || '音频公网地址无效' };
  }
  if (err === 'TIMEOUT' || status === 504) {
    return { code: 'TIMEOUT', message: msg || '云端转写超时，请稍后重试' };
  }
  if (/余额|balance|Arrearage|Insufficient/i.test(msg + err)) {
    return { code: 'BALANCE', message: '语音识别额度不足或账号欠费，请稍后重试或联系管理员' };
  }
  return {
    code: err || 'FC_ERROR',
    message: msg || `云端转写失败（HTTP ${status}）`,
  };
}

/**
 * 将本地/项目内音频上传为公网 URL；已是 http(s) 则直接返回。
 */
async function ensurePublicAudioUrl(
  projectId: string | undefined,
  audioUrl: string,
): Promise<string> {
  const url = (audioUrl || '').trim();
  if (!url) throw Object.assign(new Error('音频 URL 为空'), { code: 'EMPTY_URL' });

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  let inputPath: string;
  try {
    inputPath = await resolveLocalMediaFilePath(projectId, url);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw Object.assign(new Error(`无法读取本地音频：${msg}`), { code: 'LOCAL_PATH' });
  }

  if (!fs.existsSync(inputPath)) {
    throw Object.assign(new Error('本地音频文件不存在'), { code: 'NOT_FOUND' });
  }

  const buffer = fs.readFileSync(inputPath);
  if (!buffer.length) {
    throw Object.assign(new Error('音频文件为空'), { code: 'EMPTY_FILE' });
  }

  const mime = mimeFromAudioPath(inputPath);
  try {
    const { VideoProvider } = await import('../ai/providers/VideoProvider.js');
    const vp = new VideoProvider();
    const publicUrl = await vp.uploadAudioToOSS(buffer, mime);
    const out = String(publicUrl || '').trim();
    if (!out) throw new Error('上传未返回公网 URL');
    return out;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw Object.assign(new Error(`上传音频到云端失败：${msg}`), { code: 'UPLOAD_FAILED' });
  }
}

async function callFcFileTranscribe(
  fileUrl: string,
  language?: string,
): Promise<SpeechSegmentsResult> {
  const base = getFcBaseUrlForClient();
  if (!base) {
    throw Object.assign(new Error('未配置云端地址（HK_FC_ENDPOINT / ALIYUN_FC_INIT_USER_URL）'), {
      code: 'NO_FC',
    });
  }

  const axiosInst = getNxFcAxios();
  try {
    const res = await axiosInst.post(
      '/asr/file-transcribe',
      {
        fileUrl,
        // language 可选：不传 / auto → FC 侧 language_hints ['zh','en'] 自动识别
        language: (language || 'auto').trim() || 'auto',
      },
      { timeout: FC_FILE_TRANSCRIBE_TIMEOUT_MS },
    );
    const data = res.data || {};
    const text = String(data.text || '').trim();
    const rawSegs = Array.isArray(data.segments) ? data.segments : [];
    const segments: SpeechSegment[] = rawSegs
      .map((s: unknown) => {
        const o = s && typeof s === 'object' ? (s as Record<string, unknown>) : {};
        return {
          text: String(o.text || '').trim(),
          startSec: Number(o.startSec) || 0,
          endSec: Number(o.endSec) || 0,
        };
      })
      .filter((s: SpeechSegment) => !!s.text);
    return { text, segments };
  } catch (e: unknown) {
    const ax = e as {
      response?: { status?: number; data?: unknown };
      message?: string;
      code?: string;
    };
    if (ax.code && ax.message && !ax.response && ax.code !== 'ECONNABORTED') {
      throw e;
    }
    if (ax.response) {
      const mapped = mapFcError(ax.response.status || 500, ax.response.data);
      throw Object.assign(new Error(mapped.message), { code: mapped.code });
    }
    const msg = ax.message || String(e);
    if (/ETIMEDOUT|ENOTFOUND|ECONNREFUSED|network|ECONNABORTED/i.test(msg)) {
      throw Object.assign(new Error('网络异常或云端转写超时，请检查网络后重试'), {
        code: 'NETWORK',
      });
    }
    throw Object.assign(new Error(msg || '云端转写失败'), { code: 'UNKNOWN' });
  }
}

/**
 * 上传（如需）+ FC fun-asr 文件转写。契约与旧本地 Whisper segments 一致。
 * 供 MV 歌词时间线、文本节点「转文字」、AudioTranscribeNode 等共用。不回退 Whisper。
 */
export async function transcribeSpeechSegmentsViaFunAsr(
  projectId: string | undefined,
  audioUrl: string,
  language?: string,
): Promise<SpeechSegmentsResult> {
  const publicUrl = await ensurePublicAudioUrl(projectId, audioUrl);
  return callFcFileTranscribe(publicUrl, language);
}

/** 纯文本契约：与旧 transcribeSpeechFromAudioUrl（Whisper）IPC 返回值一致 */
export async function transcribeSpeechViaFunAsr(
  projectId: string | undefined,
  audioUrl: string,
  language?: string,
): Promise<{ text: string }> {
  const { text } = await transcribeSpeechSegmentsViaFunAsr(projectId, audioUrl, language);
  return { text };
}

/** 便于单测 / 诊断：仅调用 FC（fileUrl 须已是公网） */
export async function transcribePublicAudioViaFunAsr(
  fileUrl: string,
  language?: string,
): Promise<SpeechSegmentsResult> {
  if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
    throw Object.assign(new Error('fileUrl 须为公网 http(s) 地址'), { code: 'FILE_URL_REQUIRED' });
  }
  return callFcFileTranscribe(fileUrl, language);
}
