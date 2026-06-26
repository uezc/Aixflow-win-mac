/**
 * 应用重启后根据 RunningHub taskId 对音频任务继续 /query（FC taskType=audio）。
 */
import { randomUUID } from 'crypto';
import { rhQueryPollAudio } from './runningHubFcHelpers.js';
import { getAliyunFcInitUserUrl } from '../config/aliyunConfig.js';
import { normalizeRunningHubPollStatus } from './runningHubVideoQueryResume.js';

function firstRhAudioUrlFromResultItem(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const o = item as Record<string, unknown>;
  for (const k of ['url', 'fileUrl', 'audioUrl', 'audio_url', 'videoUrl', 'video_url']) {
    const v = o[k];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
  }
  const nested = o.url;
  if (nested && typeof nested === 'object' && 'url' in nested && typeof (nested as { url?: string }).url === 'string') {
    const inner = (nested as { url: string }).url;
    if (/^https?:\/\//i.test(inner)) return inner;
  }
  return undefined;
}

/** 从 /query 响应中尽量提取音频 URL（与 AudioProvider、FC 解包后结构对齐） */
export function extractRunningHubAudioUrlFromPoll(pollData: Record<string, unknown>): string | undefined {
  const d = pollData as Record<string, any>;
  const resultsArray = Array.isArray(d.results) ? d.results : d.data?.results;
  if (resultsArray && resultsArray.length > 0) {
    const u = firstRhAudioUrlFromResultItem(resultsArray[0]);
    if (u) return u;
  }
  const tr = d.data?.task_result;
  const audioList = tr?.audios ?? tr?.audio;
  if (Array.isArray(audioList) && audioList.length > 0) {
    const u = firstRhAudioUrlFromResultItem(audioList[0]);
    if (u) return u;
  }
  const deepTr = d.data?.data?.task_result;
  const deepAudioList = deepTr?.audios ?? deepTr?.audio;
  if (Array.isArray(deepAudioList) && deepAudioList.length > 0) {
    const u = firstRhAudioUrlFromResultItem(deepAudioList[0]);
    if (u) return u;
  }
  const topAudio =
    typeof d.audio_url === 'string' && /^https?:\/\//i.test(d.audio_url)
      ? d.audio_url
      : typeof d.audioUrl === 'string' && /^https?:\/\//i.test(d.audioUrl)
        ? d.audioUrl
        : undefined;
  if (topAudio) return topAudio;

  return (
    d.data?.output ||
    d.data?.data?.output ||
    d.output ||
    d.url ||
    d.data?.url ||
    undefined
  );
}

export type RunningHubAudioResumeResult =
  | { ok: true; audioUrl: string }
  | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;
const MAX_SUCCESS_WITHOUT_URL_ROUNDS = 24;

export async function pollRunningHubAudioUntilTerminal(
  rhTaskId: string,
  options?: {
    totalTimeoutMs?: number;
    onTick?: (info: { attempt: number; normalizedStatus?: string }) => void;
  },
): Promise<RunningHubAudioResumeResult> {
  if (!getAliyunFcInitUserUrl().trim()) {
    return { ok: false, error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法恢复 RunningHub 音频任务' };
  }
  const deadline = Date.now() + (options?.totalTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  let attempt = 0;
  let successWithoutUrlRounds = 0;

  while (Date.now() < deadline) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    attempt++;
    let pollData: Record<string, unknown>;
    try {
      pollData = (await rhQueryPollAudio(String(rhTaskId), `resume-rh-aud:${randomUUID()}:p${attempt}`)) as Record<
        string,
        unknown
      >;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `查询任务失败：${msg}` };
    }

    const rawSt =
      pollData.status ??
      (pollData as Record<string, unknown>).taskStatus ??
      (pollData as Record<string, unknown>).task_status;
    const normalized = normalizeRunningHubPollStatus(rawSt);
    options?.onTick?.({ attempt, normalizedStatus: normalized });

    if (normalized === 'SUCCESS') {
      const url = extractRunningHubAudioUrlFromPoll(pollData);
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        return { ok: true, audioUrl: url };
      }
      successWithoutUrlRounds += 1;
      if (successWithoutUrlRounds >= MAX_SUCCESS_WITHOUT_URL_ROUNDS) {
        return { ok: false, error: '任务已成功但未解析到音频地址，请在 RunningHub 控制台查看' };
      }
      continue;
    }
    successWithoutUrlRounds = 0;
    if (normalized === 'FAILURE' || normalized === 'FAILED') {
      const msg = String(pollData.errorMessage ?? pollData.error ?? pollData.message ?? '生成失败');
      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: '恢复轮询超时。若云端已生成完成，可在 RunningHub 任务详情中查看。' };
}
