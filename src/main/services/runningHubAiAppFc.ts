/**
 * RunningHub 插件 AI 应用：经 FC run-task 转发并扣云端元宝，密钥仅在 FC。
 * 含抠图 / 去水印 / 视频分析 / Joy Caption Two 等；应用 ID 与 cloudModelPricing、各 Provider 保持一致。
 */
import { randomUUID } from 'crypto';
import axios from 'axios';
import { fcForwardRequest } from '../utils/fcForwardTask.js';
import { buildFcErrorPayload } from '../utils/fcBalanceError.js';
import { rhQueryPollImage, unwrapRunningHubForwardBody } from '../utils/runningHubFcHelpers.js';
import { normalizeRunningHubPollStatus } from '../utils/runningHubVideoQueryResume.js';
import {
  extractAllRunningHubImageUrlsFromPoll,
  finalizeCharacterMultiAngleImageUrls,
} from '../utils/runningHubImageQueryResume.js';

export const MATTING_AI_APP_ID = '2021955919764000770';
export const WATERMARK_REMOVAL_AI_APP_ID = '2022127885233950721';
export const IMAGE_CHARACTER_MULTI_ANGLE_AI_APP_ID = '1990056102572290049';
/** LLM「视频分析」RunningHub AI 应用（与 VideoAnalysisProvider、cloudModelPricing 一致） */
export const VIDEO_ANALYSIS_AI_APP_ID = '2033537159944212482';
/** LLM「Joy Caption Two」图像反推应用（与 ChatProvider 一致） */
export const JOY_CAPTION_TWO_AI_APP_ID = '2021821541272526850';
/** 视频去水印 RunningHub AI 应用（node 46=video, node 45=强度） */
export const VIDEO_WATERMARK_REMOVAL_AI_APP_ID = '2049450731266121729';
/** 图片转 3D 模型（输出 GLB） */
export const IMAGE_TO_3D_AI_APP_ID = '2059618241806430209';

const POLL_INTERVAL_MS = 5000;
const POLL_DEADLINE_IMAGE_TO_3D_MS = 20 * 60 * 1000;
const POLL_INTERVAL_MULTI_ANGLE_MS = 3000;
const POLL_DEADLINE_MS = 5 * 60 * 1000;
const POLL_DEADLINE_MULTI_ANGLE_MS = 10 * 60 * 1000;
/** SUCCESS 后 results 偶发晚到：最多再等约 2 分钟 */
const SUCCESS_WITHOUT_URL_MAX_ROUNDS = 40;
/** 人物多角度：SUCCESS 后 results 可能分批写入，连续 2 轮数量不变再返回 */
const MULTI_ANGLE_STABLE_SUCCESS_ROUNDS = 2;
const MULTI_ANGLE_MAX_ACCUMULATE_POLLS = 40;
const POLL_DEADLINE_VIDEO_ANALYSIS_MS = 10 * 60 * 1000;
const POLL_DEADLINE_VIDEO_WATERMARK_MS = 20 * 60 * 1000;

export interface MattingResult {
  success: true;
  imageUrl: string;
  imageUrls?: string[];
}

export interface MattingError {
  success: false;
  message: string;
}

export type WatermarkRemovalResult = MattingResult;
export type WatermarkRemovalError = MattingError;
export type CharacterMultiAngleResult = MattingResult;
export type CharacterMultiAngleError = MattingError;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function extractRhTaskId(data: Record<string, unknown>): string | undefined {
  const tid =
    (typeof data.taskId === 'string' && data.taskId) ||
    (typeof data.task_id === 'string' && data.task_id) ||
    undefined;
  if (tid) return tid;
  const inner = data.data;
  if (inner && typeof inner === 'object') {
    const o = inner as { taskId?: string; task_id?: string };
    return (typeof o.taskId === 'string' && o.taskId) || (typeof o.task_id === 'string' && o.task_id) || undefined;
  }
  return undefined;
}

async function submitAndPollAiApp(
  billingModelId: string,
  path: string,
  body: Record<string, unknown>,
  label: string,
  options?: {
    pollDeadlineMs?: number;
    pollIntervalMs?: number;
    /** SUCCESS 后持续轮询直至多图结果数量稳定（人物多角度） */
    accumulateImageUrls?: boolean;
    expandMultiAngleOutputs?: boolean;
  },
): Promise<MattingResult | MattingError> {
  const fcSubmitId = randomUUID();
  const pollIntervalMs = options?.pollIntervalMs ?? POLL_INTERVAL_MS;
  try {
    const { data: rawSubmit } = await fcForwardRequest(
      fcSubmitId,
      'image',
      'charge',
      {
        provider: 'runninghub',
        path,
        method: 'POST',
        body,
      },
      { billingModelId },
    );
    const data = unwrapRunningHubForwardBody(rawSubmit as Record<string, unknown>);

    const rhTaskId = extractRhTaskId(data);
    if (!rhTaskId) {
      const msg =
        (typeof data.errorMessage === 'string' && data.errorMessage) ||
        (typeof data.error === 'string' && data.error) ||
        (typeof data.message === 'string' && data.message) ||
        (typeof data.msg === 'string' && data.msg) ||
        (data.code !== undefined && data.code !== 0 ? `错误码 ${String(data.code)}` : '') ||
        '未返回 taskId';
      console.error(`[${label}] FC 提交响应`, data);
      return { success: false, message: `${label}任务提交失败：${msg}` };
    }

    const deadline = Date.now() + (options?.pollDeadlineMs ?? POLL_DEADLINE_MS);
    let poll = 0;
    let successWithoutUrlRounds = 0;
    let bestImageUrls: string[] = [];
    let stableSuccessRounds = 0;
    let accumulatePolls = 0;
    const accumulate = !!options?.accumulateImageUrls;
    while (Date.now() < deadline) {
      if (poll > 0) await sleep(pollIntervalMs);
      const qd = await rhQueryPollImage(rhTaskId, `${fcSubmitId}:poll:${poll}`);
      poll += 1;

      const rawSt =
        qd.status ??
        (qd as Record<string, unknown>).taskStatus ??
        (qd as Record<string, unknown>).task_status;
      const normalized = normalizeRunningHubPollStatus(rawSt);

      if (normalized === 'SUCCESS') {
        const imageUrls = extractAllRunningHubImageUrlsFromPoll(qd, { relaxed: accumulate });
        if (imageUrls.length > bestImageUrls.length) {
          bestImageUrls = imageUrls;
          stableSuccessRounds = 0;
        } else if (bestImageUrls.length > 0 && imageUrls.length === bestImageUrls.length) {
          stableSuccessRounds += 1;
        }

        const ready =
          bestImageUrls.length > 0 &&
          (!accumulate ||
            (stableSuccessRounds >= MULTI_ANGLE_STABLE_SUCCESS_ROUNDS &&
              accumulatePolls >= MULTI_ANGLE_STABLE_SUCCESS_ROUNDS) ||
            (bestImageUrls.length >= 2 &&
              stableSuccessRounds >= 1 &&
              accumulatePolls >= 2));

        if (ready) {
          let finalUrls = bestImageUrls;
          if (options?.expandMultiAngleOutputs) {
            try {
              finalUrls = await finalizeCharacterMultiAngleImageUrls(bestImageUrls);
            } catch (expandErr) {
              console.warn(`[${label}] 展开多图输出失败，使用原始 URL 列表`, expandErr);
            }
          }
          const url = finalUrls[0];
          if (url) {
            console.log(`[${label}] 解析到 ${finalUrls.length} 张结果图`);
            return { success: true, imageUrl: url, imageUrls: finalUrls };
          }
        }

        if (accumulate) {
          accumulatePolls += 1;
          if (bestImageUrls.length === 0) {
            successWithoutUrlRounds += 1;
            if (successWithoutUrlRounds >= SUCCESS_WITHOUT_URL_MAX_ROUNDS) {
              console.warn(`[${label}] SUCCESS 但无图片 URL`, JSON.stringify(qd).slice(0, 800));
              return {
                success: false,
                message: `${label}已完成但未解析到结果图片，请在 RunningHub 查看任务输出`,
              };
            }
          }
          if (accumulatePolls >= MULTI_ANGLE_MAX_ACCUMULATE_POLLS && bestImageUrls.length > 0) {
            let finalUrls = bestImageUrls;
            if (options?.expandMultiAngleOutputs) {
              try {
                finalUrls = await finalizeCharacterMultiAngleImageUrls(bestImageUrls);
              } catch {
                /* keep raw */
              }
            }
            const url = finalUrls[0];
            if (url) {
              console.log(`[${label}] 累积轮询上限，返回 ${finalUrls.length} 张`);
              return { success: true, imageUrl: url, imageUrls: finalUrls };
            }
          }
          successWithoutUrlRounds = 0;
          continue;
        }

        successWithoutUrlRounds += 1;
        if (successWithoutUrlRounds >= SUCCESS_WITHOUT_URL_MAX_ROUNDS) {
          console.warn(`[${label}] SUCCESS 但无图片 URL`, JSON.stringify(qd).slice(0, 800));
          return {
            success: false,
            message: `${label}已完成但未解析到结果图片，请在 RunningHub 查看任务输出`,
          };
        }
        continue;
      }
      successWithoutUrlRounds = 0;
      stableSuccessRounds = 0;

      if (normalized === 'FAILURE' || normalized === 'FAILED') {
        const msg =
          (typeof qd.errorMessage === 'string' && qd.errorMessage) ||
          (typeof qd.error === 'string' && qd.error) ||
          `${label}失败`;
        return { success: false, message: String(msg) };
      }
    }
    return { success: false, message: `${label}超时（云端可能已完成，请稍后重试或查看 RunningHub 任务）` };
  } catch (e: unknown) {
    const { error } = buildFcErrorPayload(e, `${label}失败`);
    console.error(`[${label}]`, e);
    return { success: false, message: error };
  }
}

export interface ImageTo3dResult {
  success: true;
  glbUrl: string;
  /** 同任务输出的贴图等资源（与 GLB 同目录下载后，相对路径才能解析） */
  companionUrls?: string[];
}

export interface ImageTo3dError {
  success: false;
  message: string;
}

const TEXTURE_OUTPUT_EXTS = /\.(png|jpg|jpeg|webp|bmp|ktx2?)(?:$|[?#])/i;

function scoreGlbCandidate(u: string, rec: Record<string, unknown>): number {
  const lower = u.toLowerCase();
  const name = String(rec.fileName ?? rec.filename ?? rec.name ?? '')
    .trim()
    .toLowerCase();
  const label = `${name} ${lower}`;
  let score = 0;
  if (label.includes('textured')) score += 120;
  if (label.includes('hy3d')) score += 60;
  if (label.includes('texture')) score += 40;
  if (label.includes('export')) score += 20;
  if (lower.endsWith('.glb')) score += 15;
  return score;
}

/** 从轮询结果挑选带贴图的 GLB，并收集可能的外部贴图 URL */
function extractImageTo3dOutputsFromPoll(qd: Record<string, unknown>): {
  glbUrl?: string;
  companionUrls: string[];
} {
  const results = qd.results;
  if (!Array.isArray(results)) return { companionUrls: [] };

  let bestGlb: { url: string; score: number } | undefined;
  const companionUrls: string[] = [];

  for (const it of results) {
    const rec = it as Record<string, unknown>;
    const u = typeof rec.url === 'string' ? rec.url.trim() : '';
    if (!u) continue;
    const lower = u.toLowerCase();
    const out = String(rec.outputType ?? rec.type ?? '')
      .trim()
      .toLowerCase();

    const isGlb = out === 'glb' || lower.includes('.glb');
    const isGltf = out === 'gltf' || lower.endsWith('.gltf');
    if (isGlb || isGltf) {
      const score = scoreGlbCandidate(u, rec) + (isGlb ? 10 : 0);
      if (!bestGlb || score > bestGlb.score) bestGlb = { url: u, score };
      continue;
    }

    if (TEXTURE_OUTPUT_EXTS.test(lower) || ['png', 'jpg', 'jpeg', 'webp', 'image'].includes(out)) {
      if (!companionUrls.includes(u)) companionUrls.push(u);
    }
  }

  return { glbUrl: bestGlb?.url, companionUrls };
}

/** 从同任务贴图输出中挑选最适合预览覆盖的一张 */
export function pickBestTextureCompanionUrl(urls: string[]): string {
  let best = '';
  let bestScore = -1;
  for (const u of urls) {
    const lower = u.toLowerCase();
    let score = 0;
    if (/textured|texture|diffuse|albedo|color|basecolor/i.test(lower)) score += 80;
    if (/\.png(?:$|[?#])/i.test(lower)) score += 20;
    if (/\.jpe?g|\.webp/i.test(lower)) score += 10;
    if (score > bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return best || urls[0] || '';
}

async function submitAndPollForGlb(
  billingModelId: string,
  path: string,
  body: Record<string, unknown>,
  label: string,
): Promise<ImageTo3dResult | ImageTo3dError> {
  const fcSubmitId = randomUUID();
  const pollIntervalMs = POLL_INTERVAL_MS;
  try {
    const { data: rawSubmit } = await fcForwardRequest(
      fcSubmitId,
      'image',
      'charge',
      {
        provider: 'runninghub',
        path,
        method: 'POST',
        body,
      },
      { billingModelId },
    );
    const data = unwrapRunningHubForwardBody(rawSubmit as Record<string, unknown>);
    const rhTaskId = extractRhTaskId(data);
    if (!rhTaskId) {
      const msg =
        (typeof data.errorMessage === 'string' && data.errorMessage) ||
        (typeof data.error === 'string' && data.error) ||
        (typeof data.message === 'string' && data.message) ||
        '未返回 taskId';
      return { success: false, message: `${label}任务提交失败：${msg}` };
    }

    const deadline = Date.now() + POLL_DEADLINE_IMAGE_TO_3D_MS;
    let poll = 0;
    let successWithoutUrlRounds = 0;
    while (Date.now() < deadline) {
      if (poll > 0) await sleep(pollIntervalMs);
      const qd = await rhQueryPollImage(rhTaskId, `${fcSubmitId}:poll:${poll}`);
      poll += 1;
      const rawSt =
        qd.status ??
        (qd as Record<string, unknown>).taskStatus ??
        (qd as Record<string, unknown>).task_status;
      const normalized = normalizeRunningHubPollStatus(rawSt);

      if (normalized === 'SUCCESS') {
        const { glbUrl, companionUrls } = extractImageTo3dOutputsFromPoll(qd);
        if (glbUrl) {
          console.log(
            `[${label}] 选用 GLB (score优先 textured): ${glbUrl.slice(0, 120)}…  companion=${companionUrls.length}`,
          );
          return { success: true, glbUrl, companionUrls };
        }
        successWithoutUrlRounds += 1;
        if (successWithoutUrlRounds >= SUCCESS_WITHOUT_URL_MAX_ROUNDS) {
          return {
            success: false,
            message: `${label}已完成但未解析到 GLB 文件，请在 RunningHub 查看任务输出`,
          };
        }
        continue;
      }
      successWithoutUrlRounds = 0;
      if (normalized === 'FAILURE' || normalized === 'FAILED') {
        const msg =
          (typeof qd.errorMessage === 'string' && qd.errorMessage) ||
          (typeof qd.error === 'string' && qd.error) ||
          `${label}失败`;
        return { success: false, message: String(msg) };
      }
    }
    return { success: false, message: `${label}超时（云端可能仍在生成，请稍后到 RunningHub 查看）` };
  } catch (e: unknown) {
    const { error } = buildFcErrorPayload(e, `${label}失败`);
    console.error(`[${label}]`, e);
    return { success: false, message: error };
  }
}

/** 图片转 3D（RunningHub AI App 2059618241806430209，node 13 image） */
export async function runImageTo3dViaFc(imageInputUrl: string): Promise<ImageTo3dResult | ImageTo3dError> {
  const u = imageInputUrl?.trim();
  if (!u) return { success: false, message: '图片地址为空' };
  const body: Record<string, unknown> = {
    nodeInfoList: [
      {
        nodeId: '13',
        fieldName: 'image',
        fieldValue: u,
        description: 'image',
      },
    ],
    instanceType: 'default',
    usePersonalQueue: 'false',
  };
  return submitAndPollForGlb(
    IMAGE_TO_3D_AI_APP_ID,
    `/run/ai-app/${IMAGE_TO_3D_AI_APP_ID}`,
    body,
    '图片转3D',
  );
}

export async function runMattingViaFc(imageInputUrl: string): Promise<MattingResult | MattingError> {
  const u = imageInputUrl?.trim();
  if (!u) return { success: false, message: '图片地址为空' };
  const body: Record<string, unknown> = {
    nodeInfoList: [
      {
        nodeId: '3',
        fieldName: 'image',
        fieldValue: u,
        description: 'image',
      },
    ],
    instanceType: 'plus',
    usePersonalQueue: 'false',
  };
  return submitAndPollAiApp(MATTING_AI_APP_ID, `/run/ai-app/${MATTING_AI_APP_ID}`, body, '抠图');
}

export async function runWatermarkRemovalViaFc(imageInputUrl: string): Promise<WatermarkRemovalResult | WatermarkRemovalError> {
  const u = imageInputUrl?.trim();
  if (!u) return { success: false, message: '图片地址为空' };
  const body: Record<string, unknown> = {
    nodeInfoList: [
      {
        nodeId: '166',
        fieldName: 'image',
        fieldValue: u,
        description: 'image',
      },
    ],
    instanceType: 'plus',
    usePersonalQueue: 'false',
  };
  return submitAndPollAiApp(
    WATERMARK_REMOVAL_AI_APP_ID,
    `/run/ai-app/${WATERMARK_REMOVAL_AI_APP_ID}`,
    body,
    '去水印',
  );
}

export async function runCharacterMultiAngleViaFc(
  imageInputUrl: string,
  width = 720,
  height = 1024,
): Promise<CharacterMultiAngleResult | CharacterMultiAngleError> {
  const u = imageInputUrl?.trim();
  if (!u) return { success: false, message: '图片地址为空' };
  const safeW = Number.isFinite(width) ? Math.max(256, Math.min(2048, Math.round(width))) : 720;
  const safeH = Number.isFinite(height) ? Math.max(256, Math.min(2048, Math.round(height))) : 1024;
  const body: Record<string, unknown> = {
    nodeInfoList: [
      {
        nodeId: '573',
        fieldName: 'image',
        fieldValue: u,
        description: '上传图像',
      },
      {
        nodeId: '571',
        fieldName: 'value',
        fieldValue: String(safeW),
        description: '宽',
      },
      {
        nodeId: '579',
        fieldName: 'value',
        fieldValue: String(safeH),
        description: '高',
      },
    ],
    instanceType: 'plus',
    usePersonalQueue: 'false',
  };
  return submitAndPollAiApp(
    IMAGE_CHARACTER_MULTI_ANGLE_AI_APP_ID,
    `/run/ai-app/${IMAGE_CHARACTER_MULTI_ANGLE_AI_APP_ID}`,
    body,
    '人物多角度',
    {
      pollDeadlineMs: POLL_DEADLINE_MULTI_ANGLE_MS,
      pollIntervalMs: POLL_INTERVAL_MULTI_ANGLE_MS,
      accumulateImageUrls: true,
      expandMultiAngleOutputs: true,
    },
  );
}

export interface VideoAnalysisFcOk {
  success: true;
  text: string;
}

export interface VideoAnalysisFcErr {
  success: false;
  message: string;
}

function extractAnalysisTextFromResults(results: unknown[]): string {
  if (!Array.isArray(results) || results.length === 0) return '';
  const withText = results.find((r: unknown) => {
    const o = r as { text?: string };
    return typeof o?.text === 'string' && o.text.trim();
  }) as { text?: string } | undefined;
  if (withText?.text) return withText.text.trim();

  const txtResult = results.find((r: unknown) => {
    const o = r as { url?: string; outputType?: string };
    return (
      o?.url &&
      (o.outputType === 'txt' || (typeof o.url === 'string' && o.url.toLowerCase().endsWith('.txt')))
    );
  }) as { url?: string } | undefined;
  if (txtResult?.url) {
    return ''; // fetched async below
  }
  return '';
}

async function fetchTextFromResults(results: unknown[]): Promise<string> {
  const sync = extractAnalysisTextFromResults(results);
  if (sync) return sync;

  const txtResult = results.find((r: unknown) => {
    const o = r as { url?: string; outputType?: string };
    return (
      o?.url &&
      (o.outputType === 'txt' || (typeof o.url === 'string' && o.url.toLowerCase().endsWith('.txt')))
    );
  }) as { url?: string } | undefined;
  if (txtResult?.url) {
    try {
      const fetchRes = await axios.get(txtResult.url, { responseType: 'text', timeout: 30000 });
      return typeof fetchRes.data === 'string' ? fetchRes.data.trim() : '';
    } catch {
      return '';
    }
  }
  const r0 = results[0] as { url?: string } | undefined;
  if (r0?.url && typeof r0.url === 'string') {
    const low = r0.url.toLowerCase();
    if (!low.endsWith('.mp4') && !low.endsWith('.webm')) {
      try {
        const fetchRes = await axios.get(r0.url, { responseType: 'text', timeout: 30000 });
        return typeof fetchRes.data === 'string' ? fetchRes.data.trim() : '';
      } catch {
        return '';
      }
    }
  }
  return '';
}

/**
 * 视频分析：经 FC 转发 RunningHub AI 应用，RUNNINGHUB_API_KEY 仅在云端配置。
 * taskType=video、billingModelId=应用 ID，与全能视频扣费维度一致。
 */
export async function runVideoAnalysisViaFc(videoInputUrl: string): Promise<VideoAnalysisFcOk | VideoAnalysisFcErr> {
  const u = videoInputUrl?.trim();
  if (!u) return { success: false, message: '视频地址为空' };

  const body: Record<string, unknown> = {
    nodeInfoList: [
      { nodeId: '2', fieldName: 'file', fieldValue: u, description: '上传视频' },
    ],
    instanceType: 'default',
    usePersonalQueue: 'false',
  };

  const fcSubmitId = randomUUID();
  const appId = VIDEO_ANALYSIS_AI_APP_ID;
  const path = `/run/ai-app/${appId}`;

  try {
    const { data: rawSubmit } = await fcForwardRequest(
      fcSubmitId,
      'video',
      'charge',
      { provider: 'runninghub', path, method: 'POST', body },
      { billingModelId: appId },
    );
    const data = unwrapRunningHubForwardBody(rawSubmit as Record<string, unknown>);

    const rhTaskId = extractRhTaskId(data);
    if (!rhTaskId) {
      const msg =
        (typeof data.errorMessage === 'string' && data.errorMessage) ||
        (typeof data.error === 'string' && data.error) ||
        (typeof data.message === 'string' && data.message) ||
        (typeof data.msg === 'string' && data.msg) ||
        (data.code !== undefined && data.code !== 0 ? `错误码 ${String(data.code)}` : '') ||
        '未返回 taskId';
      console.error('[视频分析] FC 提交响应', data);
      return { success: false, message: `视频分析任务提交失败：${msg}` };
    }

    const deadline = Date.now() + POLL_DEADLINE_VIDEO_ANALYSIS_MS;
    let poll = 0;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const { data: rawQ } = await fcForwardRequest(`${fcSubmitId}:poll:${poll}`, 'video', 'none', {
        provider: 'runninghub',
        path: '/query',
        method: 'POST',
        body: { taskId: rhTaskId },
      });
      poll += 1;

      const qd = unwrapRunningHubForwardBody(rawQ as Record<string, unknown>);
      const status = qd.status as string | undefined;
      if (status === 'SUCCESS') {
        const results = qd.results;
        const analysisText = Array.isArray(results)
          ? await fetchTextFromResults(results)
          : '';
        return { success: true, text: analysisText || '(视频分析未返回文本)' };
      }
      if (status === 'FAILED' || status === 'FAILURE') {
        const msg =
          (typeof qd.errorMessage === 'string' && qd.errorMessage) ||
          (typeof qd.error === 'string' && qd.error) ||
          '视频分析失败';
        return { success: false, message: String(msg) };
      }
    }
    return { success: false, message: '视频分析轮询超时' };
  } catch (e: unknown) {
    const { error } = buildFcErrorPayload(e, '视频分析失败');
    console.error('[视频分析] FC', e);
    return { success: false, message: error };
  }
}

export interface JoyCaptionFcOk {
  success: true;
  text: string;
}

export interface JoyCaptionFcErr {
  success: false;
  message: string;
}

/**
 * Joy Caption Two 图像反推：经 FC 转发，密钥仅在云端。
 */
export async function runJoyCaptionTwoViaFc(imageInputUrl: string): Promise<JoyCaptionFcOk | JoyCaptionFcErr> {
  const u = imageInputUrl?.trim();
  if (!u) return { success: false, message: '图片地址为空' };

  const appId = JOY_CAPTION_TWO_AI_APP_ID;
  const body: Record<string, unknown> = {
    nodeInfoList: [{ nodeId: '3', fieldName: 'image', fieldValue: u, description: 'image' }],
    instanceType: 'default',
    usePersonalQueue: 'false',
  };

  const fcSubmitId = randomUUID();
  const path = `/run/ai-app/${appId}`;

  try {
    const { data: rawSubmit } = await fcForwardRequest(
      fcSubmitId,
      'image',
      'charge',
      { provider: 'runninghub', path, method: 'POST', body },
      { billingModelId: appId },
    );
    const data = unwrapRunningHubForwardBody(rawSubmit as Record<string, unknown>);

    const rhTaskId = extractRhTaskId(data);
    if (!rhTaskId) {
      const msg =
        (typeof data.errorMessage === 'string' && data.errorMessage) ||
        (typeof data.error === 'string' && data.error) ||
        (typeof data.message === 'string' && data.message) ||
        (typeof data.msg === 'string' && data.msg) ||
        (data.code !== undefined && data.code !== 0 ? `错误码 ${String(data.code)}` : '') ||
        '未返回 taskId';
      console.error('[Joy Caption Two] FC 提交响应', data);
      return { success: false, message: `Joy Caption Two 提交失败：${msg}` };
    }

    const deadline = Date.now() + POLL_DEADLINE_VIDEO_ANALYSIS_MS;
    let poll = 0;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const { data: rawQ } = await fcForwardRequest(`${fcSubmitId}:poll:${poll}`, 'image', 'none', {
        provider: 'runninghub',
        path: '/query',
        method: 'POST',
        body: { taskId: rhTaskId },
      });
      poll += 1;

      const qd = unwrapRunningHubForwardBody(rawQ as Record<string, unknown>);
      const status = qd.status as string | undefined;
      if (status === 'SUCCESS') {
        const results = qd.results;
        const text = Array.isArray(results) ? await fetchTextFromResults(results) : '';
        return { success: true, text: text || '(未生成文本)' };
      }
      if (status === 'FAILED' || status === 'FAILURE') {
        const msg =
          (typeof qd.errorMessage === 'string' && qd.errorMessage) ||
          (typeof qd.error === 'string' && qd.error) ||
          'Joy Caption Two 失败';
        return { success: false, message: String(msg) };
      }
    }
    return { success: false, message: 'Joy Caption Two 轮询超时' };
  } catch (e: unknown) {
    const { error } = buildFcErrorPayload(e, 'Joy Caption Two 失败');
    console.error('[Joy Caption Two] FC', e);
    return { success: false, message: error };
  }
}

export interface VideoWatermarkRemovalFcOk {
  success: true;
  videoUrl: string;
}

export interface VideoWatermarkRemovalFcErr {
  success: false;
  message: string;
}

function pickVideoOutputUrlFromResults(results: unknown): string {
  if (!Array.isArray(results) || results.length === 0) return '';
  const pickUrl = (item: { url?: unknown; outputType?: unknown } | undefined): string => {
    if (!item) return '';
    let u = '';
    if (typeof item.url === 'string') u = item.url;
    else if (item.url && typeof item.url === 'object') {
      const o = item.url as { url?: string; href?: string };
      u = (typeof o.url === 'string' && o.url) || (typeof o.href === 'string' && o.href) || '';
    }
    return u.trim();
  };
  const scored = results.map((r) => {
    const item = r as { url?: unknown; outputType?: unknown };
    const u = pickUrl(item);
    const out = String(item?.outputType ?? '').trim().toLowerCase();
    const low = u.toLowerCase();
    let score = 0;
    if (out === 'mp4' || low.endsWith('.mp4')) score += 10;
    else if (out === 'webm' || low.endsWith('.webm')) score += 8;
    else if (out === 'mov' || low.endsWith('.mov')) score += 6;
    else if (u.startsWith('http://') || u.startsWith('https://')) score += 1;
    return { u, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored.find((s) => s.u && s.score > 0);
  if (best?.u) return best.u;
  const any = scored.find((s) => s.u);
  return any?.u ?? '';
}

/**
 * 视频去水印：经 FC 转发 RunningHub AI 应用，billingModelId=应用 ID。
 */
export async function runVideoWatermarkRemovalViaFc(
  videoInputUrl: string,
  strength = 0.2,
): Promise<VideoWatermarkRemovalFcOk | VideoWatermarkRemovalFcErr> {
  const u = videoInputUrl?.trim();
  if (!u) return { success: false, message: '视频地址为空' };
  const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0.2;

  const appId = VIDEO_WATERMARK_REMOVAL_AI_APP_ID;
  const body: Record<string, unknown> = {
    nodeInfoList: [
      { nodeId: '46', fieldName: 'video', fieldValue: u, description: 'video' },
      { nodeId: '45', fieldName: 'value', fieldValue: String(s), description: 'value' },
    ],
    instanceType: 'default',
    usePersonalQueue: 'false',
  };

  const fcSubmitId = randomUUID();
  const path = `/run/ai-app/${appId}`;

  try {
    const { data: rawSubmit } = await fcForwardRequest(
      fcSubmitId,
      'video',
      'charge',
      { provider: 'runninghub', path, method: 'POST', body },
      { billingModelId: appId },
    );
    const data = unwrapRunningHubForwardBody(rawSubmit as Record<string, unknown>);

    const rhTaskId = extractRhTaskId(data);
    if (!rhTaskId) {
      const msg =
        (typeof data.errorMessage === 'string' && data.errorMessage) ||
        (typeof data.error === 'string' && data.error) ||
        (typeof data.message === 'string' && data.message) ||
        (typeof data.msg === 'string' && data.msg) ||
        (data.code !== undefined && data.code !== 0 ? `错误码 ${String(data.code)}` : '') ||
        '未返回 taskId';
      console.error('[视频去水印] FC 提交响应', data);
      return { success: false, message: `视频去水印提交失败：${msg}` };
    }

    const deadline = Date.now() + POLL_DEADLINE_VIDEO_WATERMARK_MS;
    let poll = 0;
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const { data: rawQ } = await fcForwardRequest(`${fcSubmitId}:poll:${poll}`, 'video', 'none', {
        provider: 'runninghub',
        path: '/query',
        method: 'POST',
        body: { taskId: rhTaskId },
      });
      poll += 1;

      const qd = unwrapRunningHubForwardBody(rawQ as Record<string, unknown>);
      const status = qd.status as string | undefined;
      if (status === 'SUCCESS') {
        const videoUrl = pickVideoOutputUrlFromResults(qd.results);
        if (videoUrl) return { success: true, videoUrl };
        return { success: false, message: '视频去水印成功但未返回视频 URL' };
      }
      if (status === 'FAILED' || status === 'FAILURE') {
        const msg =
          (typeof qd.errorMessage === 'string' && qd.errorMessage) ||
          (typeof qd.error === 'string' && qd.error) ||
          '视频去水印失败';
        return { success: false, message: String(msg) };
      }
    }
    return { success: false, message: '视频去水印轮询超时' };
  } catch (e: unknown) {
    const { error } = buildFcErrorPayload(e, '视频去水印失败');
    console.error('[视频去水印] FC', e);
    return { success: false, message: error };
  }
}
