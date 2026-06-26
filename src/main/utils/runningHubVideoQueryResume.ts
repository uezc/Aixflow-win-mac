/**
 * 应用重启后根据 RunningHub taskId 仅走 /query 恢复结果（与 VideoProvider 轮询同源）。
 */
import { randomUUID } from 'crypto';
import { rhQueryPollVideo } from './runningHubFcHelpers.js';
import { getAliyunFcInitUserUrl } from '../config/aliyunConfig.js';

export function normalizeRunningHubPollStatus(raw: unknown): string | undefined {
  if (raw == null || raw === '') return undefined;
  const u = String(raw).trim().toUpperCase();
  if (u === 'SUCCESS' || u === 'SUCCEED' || u === 'COMPLETE' || u === 'COMPLETED') return 'SUCCESS';
  if (u === 'FAILED' || u === 'FAILURE') return 'FAILURE';
  if (u === 'RUNNING') return 'IN_PROGRESS';
  if (u === 'QUEUED') return 'NOT_START';
  return String(raw);
}

function firstRhMediaUrlFromResultItem(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const o = item as Record<string, unknown>;
  for (const k of ['url', 'fileUrl', 'videoUrl', 'video_url']) {
    const v = o[k];
    if (typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))) return v;
  }
  const nested = o.url;
  if (nested && typeof nested === 'object' && 'url' in nested && typeof (nested as { url?: string }).url === 'string') {
    return (nested as { url: string }).url;
  }
  return undefined;
}

/** 从 /query 响应中尽量提取视频 URL（与 VideoProvider 宽松解析对齐） */
export function extractRunningHubVideoUrlFromPoll(pollData: Record<string, unknown>): string | undefined {
  const d = pollData as Record<string, any>;
  const resultsArray = Array.isArray(d.results) ? d.results : d.data?.results;
  if (resultsArray && resultsArray.length > 0) {
    for (const item of resultsArray) {
      const u = firstRhMediaUrlFromResultItem(item);
      if (u) return u;
    }
  }
  const tr = d.data?.task_result;
  const videos = tr?.videos;
  if (Array.isArray(videos) && videos.length > 0 && typeof videos[0]?.url === 'string') {
    return videos[0].url;
  }
  const deepTr = d.data?.data?.task_result;
  const deepVideos = deepTr?.videos;
  if (Array.isArray(deepVideos) && deepVideos.length > 0 && typeof deepVideos[0]?.url === 'string') {
    return deepVideos[0].url;
  }
  const topVideo =
    typeof d.video_url === 'string' && /^https?:\/\//i.test(d.video_url)
      ? d.video_url
      : typeof d.videoUrl === 'string' && /^https?:\/\//i.test(d.videoUrl)
        ? d.videoUrl
        : undefined;
  if (topVideo) return topVideo;

  return (
    d.data?.output ||
    d.data?.data?.output ||
    d.output ||
    d.url ||
    d.video_url ||
    d.data?.video_url ||
    d.data?.url ||
    undefined
  );
}

export type RunningHubVideoResumeResult =
  | { ok: true; videoUrl: string }
  | { ok: false; error: string };

const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;
const POLL_INTERVAL_MS = 5000;

/**
 * 轮询 RunningHub taskId 直至 SUCCESS / FAILURE / 超时（经 FC，billing=none）。
 */
export async function pollRunningHubVideoUntilTerminal(
  rhTaskId: string,
  options?: {
    totalTimeoutMs?: number;
    onTick?: (info: { attempt: number; normalizedStatus?: string }) => void;
  },
): Promise<RunningHubVideoResumeResult> {
  if (!getAliyunFcInitUserUrl().trim()) {
    return { ok: false, error: '未配置云端转发（ALIYUN_FC_INIT_USER_URL），无法恢复 RunningHub 视频任务' };
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
      pollData = (await rhQueryPollVideo(String(rhTaskId), `resume-rh:${randomUUID()}:p${attempt}`)) as Record<
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
      const url = extractRunningHubVideoUrlFromPoll(pollData);
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        return { ok: true, videoUrl: url };
      }
      successWithoutUrlRounds += 1;
      // SUCCESS 但 results 偶发晚到：多轮再试，避免首包无 URL 就误判失败
      if (successWithoutUrlRounds >= 24) {
        return { ok: false, error: '任务已成功但未解析到视频地址，请在 RunningHub 控制台查看' };
      }
      continue;
    }
    successWithoutUrlRounds = 0;
    if (normalized === 'FAILURE' || normalized === 'FAILED') {
      const msg = String(pollData.errorMessage ?? pollData.error ?? pollData.message ?? '生成失败');
      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: '恢复轮询超时。若云端已生成完成，可在 RunningHub 任务详情中复制视频链接。' };
}
