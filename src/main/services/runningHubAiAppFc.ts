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
export { TRELLIS2_IMAGE_TO_3D_APP_ID, IMAGE_TO_3D_HY3D_APP_ID } from '../../shared/imageTo3dModels.js';
import {
  IMAGE_TO_3D_HY3D_APP_ID,
  IMAGE_TO_3D_MODEL_HY3D,
  resolveImageTo3dModelId,
  imageTo3dAppIdForModel,
  imageTo3dImageNodeIdForModel,
  imageTo3dImageFieldDescriptionForModel,
  imageTo3dInstanceTypesToTryForModel,
  IMAGE_TO_3D_MIN_PLAUSIBLE_TASK_SEC,
  TRELLIS2_MIN_PLAUSIBLE_TASK_SEC,
  IMAGE_TO_3D_FAST_FAIL_TASK_SEC,
  imageTo3dMinPlausibleTaskSecForModel,
} from '../../shared/imageTo3dModels.js';

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
  /** Post Process 产出的 base_color 贴图（Trellis2 网格-only GLB 时用于预览上色） */
  resultTextureUrl?: string;
}

export interface ImageTo3dError {
  success: false;
  message: string;
  rhTaskId?: string;
}

const TEXTURE_OUTPUT_EXTS = /\.(png|jpg|jpeg|webp|bmp|ktx2?)(?:$|[?#])/i;
const MODEL_3D_URL_EXTS = /\.(glb|gltf|obj|fbx|usdz)(?:$|[?#])/i;
const MODEL_3D_OUTPUT_TYPES = new Set(['glb', 'gltf', 'model', 'mesh', '3d', 'obj', 'fbx', 'usdz', 'bin']);
const IMAGE_OUTPUT_TYPES = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'image', 'img', 'picture', 'photo']);

function urlFromRh3dResultRecord(rec: Record<string, unknown>): string {
  for (const k of ['url', 'fileUrl', 'file_url', 'download_url', 'downloadUrl', 'output', 'href']) {
    const v = rec[k];
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return v.trim();
  }
  return '';
}

function scoreGlbCandidate(u: string, rec: Record<string, unknown>): number {
  const lower = u.toLowerCase();
  const name = String(rec.fileName ?? rec.filename ?? rec.name ?? '')
    .trim()
    .toLowerCase();
  const nodeId = String(rec.nodeId ?? rec.node_id ?? '').trim();
  const out = String(rec.outputType ?? rec.type ?? '')
    .trim()
    .toLowerCase();
  const label = `${name} ${nodeId} ${lower} ${out}`;
  let score = 0;
  if (label.includes('textured')) score += 120;
  if (label.includes('trellis')) score += 90;
  if (label.includes('hy3d')) score += 60;
  if (label.includes('export')) score += 50;
  if (label.includes('mesh')) score += 40;
  if (label.includes('texture')) score += 20;
  if (out === 'glb' || out.includes('glb')) score += 80;
  if (MODEL_3D_URL_EXTS.test(lower)) score += 70;
  if (/\.zip(?:$|[?#])/i.test(lower)) score += 55;
  if (lower.endsWith('.glb')) score += 15;
  if (nodeId === '489' || nodeId === '505' || nodeId === '53' || nodeId === '52') score += 30;
  if (nodeId === '57') score += 10;
  return score;
}

function isRh3dTextureOutput(url: string, out: string): boolean {
  const lower = url.toLowerCase();
  if (TEXTURE_OUTPUT_EXTS.test(lower)) return true;
  if (IMAGE_OUTPUT_TYPES.has(out)) return true;
  if (/\.(mp4|webm|mov|avi|txt|json)(?:$|[?#])/i.test(lower)) return false;
  return false;
}

function isRh3dModelOutput(url: string, out: string, rec: Record<string, unknown>): boolean {
  const lower = url.toLowerCase();
  if (!url) return false;
  if (isRh3dTextureOutput(url, out)) return false;
  if (MODEL_3D_URL_EXTS.test(lower)) return true;
  if (MODEL_3D_OUTPUT_TYPES.has(out) || out.includes('glb') || out.includes('gltf')) return true;
  if (/\.zip(?:$|[?#])/i.test(lower)) return true;
  const label = `${String(rec.fileName ?? '')} ${String(rec.nodeId ?? '')} ${lower}`.toLowerCase();
  if (/trellis|hy3d|export|mesh|model|glb|gltf|3d/i.test(label)) return true;
  return false;
}

function gatherRh3dOutputRecords(qd: Record<string, unknown>): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const pushItem = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    const rec = item as Record<string, unknown>;
    const url = urlFromRh3dResultRecord(rec);
    const key = url || JSON.stringify(rec).slice(0, 200);
    if (seen.has(key)) return;
    seen.add(key);
    records.push(rec);
  };
  const pushList = (v: unknown) => {
    if (Array.isArray(v)) for (const it of v) pushItem(it);
    else pushItem(v);
  };
  pushList(qd.results);
  const tr = qd.task_result;
  if (tr && typeof tr === 'object') {
    const tro = tr as Record<string, unknown>;
    pushList(tro.results);
    pushList(tro.outputs);
    pushList(tro.files);
  }
  return records;
}

function isRhPreviewRenderImageUrl(url: string, rec?: Record<string, unknown>): boolean {
  const base = (url.split('/').pop() || url).split('?')[0] || '';
  if (/^ComfyUI_\d+_/i.test(base)) return true;
  const nodeId = String(rec?.nodeId ?? rec?.node_id ?? '').trim();
  /** Trellis2 工作流 #48 为 ComfyUI 预览图，非 UV 贴图 */
  if (nodeId === '48') return true;
  if (nodeId === '57' || nodeId === '452' || nodeId === '453') return false;
  return false;
}

function recordTextureHint(rec: Record<string, unknown>): string {
  return [
    rec.fieldName,
    rec.field_name,
    rec.outputName,
    rec.output_name,
    rec.description,
    rec.fileName,
    rec.filename,
    rec.name,
    rec.nodeId,
    rec.node_id,
  ]
    .filter((v) => typeof v === 'string' && v.trim())
    .join(' ')
    .toLowerCase();
}

function scoreRh3dTextureCandidate(url: string, rec?: Record<string, unknown>): number {
  if (isRhPreviewRenderImageUrl(url, rec)) return -1;
  const lower = url.toLowerCase();
  const hint = rec ? recordTextureHint(rec) : '';
  const label = `${hint} ${lower}`;
  let score = 0;
  if (/base_color|basecolor|base-color|albedo|diffuse|color.?texture|textured/.test(label)) score += 120;
  if (/trellis.*texture|texture.*trellis/.test(label)) score += 60;
  if (/\.png(?:$|[?#])/i.test(lower)) score += 25;
  if (/\.jpe?g|\.webp/i.test(lower)) score += 12;
  const nodeId = String(rec?.nodeId ?? rec?.node_id ?? '').trim();
  if (nodeId === '57' || nodeId === '452' || nodeId === '453') score += 90;
  /** 排除 ORM / 法线 / 深度等非 albedo 贴图 */
  if (/metallic|roughness|normal|depth|orm|mrs|mr_|_mr|occlusion|ao\b|alpha/.test(label)) score -= 100;
  if (/preview|render|comfyui|rmbg|mask|depth/.test(label)) score -= 40;
  return score;
}

/** 从轮询结果挑选带贴图的 GLB，并收集可能的外部贴图 URL */
function extractImageTo3dOutputsFromPoll(qd: Record<string, unknown>): {
  glbUrl?: string;
  companionUrls: string[];
  textureRecords: Record<string, unknown>[];
} {
  const records = gatherRh3dOutputRecords(qd);
  if (records.length === 0) return { companionUrls: [], textureRecords: [] };

  let bestGlb: { url: string; score: number } | undefined;
  const companionUrls: string[] = [];
  const textureRecords: Record<string, unknown>[] = [];

  for (const rec of records) {
    const u = urlFromRh3dResultRecord(rec);
    if (!u) continue;
    const out = String(rec.outputType ?? rec.type ?? '')
      .trim()
      .toLowerCase();

    if (isRh3dModelOutput(u, out, rec)) {
      const score = scoreGlbCandidate(u, rec);
      if (!bestGlb || score > bestGlb.score) bestGlb = { url: u, score };
      continue;
    }

    if (isRh3dTextureOutput(u, out)) {
      if (!isRhPreviewRenderImageUrl(u, rec) && !companionUrls.includes(u)) {
        companionUrls.push(u);
        textureRecords.push(rec);
      }
      continue;
    }

    /** Trellis2 Post Process 的 base_color 偶发未被识别为 image 输出 */
    const texScore = scoreRh3dTextureCandidate(u, rec);
    if (texScore >= 80 && !companionUrls.includes(u)) {
      companionUrls.push(u);
      textureRecords.push(rec);
    }
  }

  if (!bestGlb?.url) {
    const ambiguous: string[] = [];
    for (const rec of records) {
      const u = urlFromRh3dResultRecord(rec);
      const out = String(rec.outputType ?? rec.type ?? '').trim().toLowerCase();
      if (!u || isRh3dTextureOutput(u, out)) continue;
      if (/\.(mp4|webm|mov|avi|txt|json)(?:$|[?#])/i.test(u)) continue;
      if (!ambiguous.includes(u)) ambiguous.push(u);
    }
    if (ambiguous.length === 1) {
      bestGlb = { url: ambiguous[0], score: 1 };
      console.log(`[图片转3D] 单条非贴图输出兜底为 GLB: ${ambiguous[0].slice(0, 120)}`);
    }
  }

  if (!bestGlb?.url) {
    console.warn(
      '[图片转3D] SUCCESS 但未匹配 GLB，results 摘要:',
      JSON.stringify(records).slice(0, 2500),
    );
  }

  return { glbUrl: bestGlb?.url, companionUrls, textureRecords };
}

/** 从同任务贴图输出中挑选最适合预览覆盖的一张（排除 ComfyUI 预览渲染图） */
export function pickBestTextureCompanionUrl(
  urls: string[],
  textureRecords?: Record<string, unknown>[],
): string {
  const byUrl = new Map<string, Record<string, unknown>>();
  if (textureRecords) {
    for (const rec of textureRecords) {
      const u = urlFromRh3dResultRecord(rec);
      if (u) byUrl.set(u, rec);
    }
  }
  let best = '';
  let bestScore = -1;
  for (const u of urls) {
    const score = scoreRh3dTextureCandidate(u, byUrl.get(u));
    if (score > bestScore) {
      bestScore = score;
      best = u;
    }
  }
  return bestScore >= 0 ? best : '';
}

function rhTaskCostTimeSec(qd: Record<string, unknown>): number | null {
  const usage = qd.usage;
  if (!usage || typeof usage !== 'object') return null;
  const raw = (usage as { taskCostTime?: string | number }).taskCostTime;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function formatSuspiciousFastEmptySuccessMessage(
  label: string,
  taskCostSec: number | null,
  imageNodeId: string,
  instanceType?: string,
  taskId?: string,
  minPlausibleSec?: number,
): string {
  const sec = taskCostSec != null ? `${taskCostSec} 秒` : '极短时间';
  const normalHint =
    minPlausibleSec != null && minPlausibleSec < 60
      ? `（Trellis2 Plus 网页端约 30 秒～数分钟）`
      : `（正常约 10 分钟）`;
  const instHint =
    instanceType === 'plus'
      ? '当前为 PLUS（48G）实例。'
      : instanceType === 'default'
        ? '若工作流需大显存，请改用 PLUS（48G）实例。'
        : '';
  const taskHint = taskId ? ` RunningHub taskId=${taskId}。` : '';
  return (
    `${label}异常：云端仅运行 ${sec} 且无 API 输出${normalHint}。${instHint}${taskHint}` +
    `请确认参考图已通过 RunningHub 媒体上传接口注入（nodeId=${imageNodeId}，fieldName=image），` +
    `并在 RunningHub AI 应用「API 调用」中核对 #53 Export Mesh 是否映射到 results。`
  );
}

function formatImageTo3dPollExhaustedMessage(
  label: string,
  taskId: string,
  records: Record<string, unknown>[],
  companionCount: number,
): string {
  const withUrl = records.filter((r) => urlFromRh3dResultRecord(r));
  if (withUrl.length > 0) {
    return (
      `${label}已完成（taskId=${taskId}），API 返回 ${withUrl.length} 个文件` +
      (companionCount > 0 ? `（含 ${companionCount} 张图）` : '') +
      `，但未包含 GLB。请在 RunningHub AI 应用后台将 Export Mesh 节点加入 API 输出映射。`
    );
  }
  return (
    `${label}已完成（taskId=${taskId}），但 API results 始终为空。` +
    `网页端能跑通说明工作流正常，需在 RunningHub「API 调用」页配置输出节点映射。`
  );
}

function logRhPromptTips(label: string, data: Record<string, unknown>): void {
  const raw = data.promptTips;
  if (raw == null || raw === '') return;
  try {
    const tips = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (tips && typeof tips === 'object') {
      const t = tips as Record<string, unknown>;
      console.log(`[${label}] promptTips`, {
        result: t.result,
        outputs_to_execute: t.outputs_to_execute,
        node_errors: t.node_errors,
      });
      const nodeErrors = t.node_errors;
      if (nodeErrors && typeof nodeErrors === 'object' && Object.keys(nodeErrors as object).length > 0) {
        console.warn(`[${label}] ComfyUI node_errors`, nodeErrors);
      }
    }
  } catch {
    console.log(`[${label}] promptTips(raw)`, String(raw).slice(0, 500));
  }
}

async function submitAndPollForGlb(
  billingModelId: string,
  path: string,
  body: Record<string, unknown>,
  label: string,
  options?: {
    imageNodeId?: string;
    instanceType?: string;
    minPlausibleTaskSec?: number;
    /** 空 SUCCESS 时用 minPlausibleTaskSec 作秒退阈值（Trellis2 default 假成功） */
    emptySuccessFastFail?: boolean;
  },
): Promise<ImageTo3dResult | ImageTo3dError> {
  const imageNodeId = options?.imageNodeId ?? '13';
  const instanceType = options?.instanceType ?? 'default';
  const minPlausibleTaskSec = options?.minPlausibleTaskSec ?? IMAGE_TO_3D_MIN_PLAUSIBLE_TASK_SEC;
  const emptySuccessFastFail = options?.emptySuccessFastFail === true;
  const fastFailSec = emptySuccessFastFail ? minPlausibleTaskSec : IMAGE_TO_3D_FAST_FAIL_TASK_SEC;
  const fastFailPollRounds = emptySuccessFastFail ? 2 : 3;
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
    logRhPromptTips(label, data);
    const rhTaskId = extractRhTaskId(data);
    if (!rhTaskId) {
      const msg =
        (typeof data.errorMessage === 'string' && data.errorMessage) ||
        (typeof data.error === 'string' && data.error) ||
        (typeof data.message === 'string' && data.message) ||
        '未返回 taskId';
      console.error(`[${label}] FC 提交响应`, data);
      return { success: false, message: `${label}任务提交失败：${msg}` };
    }
    console.log(`[${label}] 已提交 RunningHub taskId=${rhTaskId} instance=${instanceType} billing=${billingModelId}`);
    console.log(`[${label}] 提交 body`, JSON.stringify(body));

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
        const { glbUrl, companionUrls, textureRecords } = extractImageTo3dOutputsFromPoll(qd);
        const taskCostSec = rhTaskCostTimeSec(qd);
        const records = gatherRh3dOutputRecords(qd);
        const resultCount = records.filter((r) => urlFromRh3dResultRecord(r)).length;
        const bestTex = pickBestTextureCompanionUrl(companionUrls, textureRecords);

        if (glbUrl) {
          console.log(
            `[${label}] 选用 GLB (score优先 textured): ${glbUrl.slice(0, 120)}…  companion=${companionUrls.length} bestTex=${bestTex ? 'yes' : 'no'}`,
          );
          return { success: true, glbUrl, companionUrls, resultTextureUrl: bestTex || undefined };
        }

        successWithoutUrlRounds += 1;

        // 极快 SUCCESS 仍无 results → 提前放弃并重试（Trellis2 default 常见 13s 空 SUCCESS）
        if (
          resultCount === 0 &&
          taskCostSec != null &&
          taskCostSec < fastFailSec &&
          successWithoutUrlRounds >= fastFailPollRounds
        ) {
          console.warn(`[${label}] 秒退 SUCCESS 且无 results`, { taskId: rhTaskId, taskCostSec, qd });
          return {
            success: false,
            message: formatSuspiciousFastEmptySuccessMessage(
              label,
              taskCostSec,
              imageNodeId,
              instanceType,
              rhTaskId,
              minPlausibleTaskSec,
            ),
            rhTaskId,
          };
        }

        if (successWithoutUrlRounds >= SUCCESS_WITHOUT_URL_MAX_ROUNDS) {
          console.warn(
            `[${label}] SUCCESS 轮询 ${SUCCESS_WITHOUT_URL_MAX_ROUNDS} 次仍无 GLB，taskId=${rhTaskId}`,
            JSON.stringify(qd.results ?? null).slice(0, 2000),
          );
          return {
            success: false,
            message: formatImageTo3dPollExhaustedMessage(label, rhTaskId, records, companionUrls.length),
            rhTaskId,
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

/** RunningHub 媒体上传结果：官方 fieldValue 多为 download_url 短名，部分工作流需 openapi/ 全路径 */
export interface RhMediaUploadFieldValues {
  /** 官方示例格式：hash.jpg */
  fieldValue: string;
  /** RH 存储路径：openapi/xxxx.png */
  fileNamePath?: string;
}

/** 解析 RunningHub /media/upload/binary 响应 */
function parseRhMediaUploadResponse(raw: Record<string, unknown>): RhMediaUploadFieldValues {
  const code = raw.code;
  const codeOk = code === 0 || code === '0' || code === 200 || code === '200';
  if (code != null && !codeOk) {
    const msg =
      (typeof raw.message === 'string' && raw.message) ||
      (typeof raw.errorMessage === 'string' && raw.errorMessage) ||
      '上传失败';
    throw new Error(`RunningHub 媒体上传失败：${msg}`);
  }
  const payload = raw.data;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('RunningHub 媒体上传未返回 data');
  }
  const d = payload as Record<string, unknown>;
  const downloadUrl = typeof d.download_url === 'string' ? d.download_url.trim() : '';
  const fileName = typeof d.fileName === 'string' ? d.fileName.trim() : '';

  let fieldValue = '';
  if (downloadUrl && !/^https?:\/\//i.test(downloadUrl)) {
    fieldValue = downloadUrl;
  } else if (fileName) {
    const base = fileName.split('/').filter(Boolean).pop();
    fieldValue = base || fileName;
  } else if (downloadUrl) {
    try {
      const u = new URL(downloadUrl);
      fieldValue = u.pathname.split('/').filter(Boolean).pop() || downloadUrl;
    } catch {
      fieldValue = downloadUrl.split('/').filter(Boolean).pop() || downloadUrl;
    }
  }
  if (!fieldValue) throw new Error('RunningHub 媒体上传未返回 download_url / fileName');

  const fileNamePath = fileName && fileName !== fieldValue ? fileName : undefined;
  return { fieldValue, fileNamePath };
}

/** FC invoke body 约 32MB；base64 膨胀后 raw 文件宜 ≤24MB */
export const RH_FC_SAFE_BINARY_UPLOAD_BYTES = 24 * 1024 * 1024;

/** 从 OSS/公网 URL 拉取后上传 RH 媒体库（FC 侧下载，客户端只传 URL） */
export async function uploadRunningHubMediaFromRemoteUrlViaFc(
  remoteUrl: string,
  filename = 'file.bin',
  contentType = 'application/octet-stream',
): Promise<RhMediaUploadFieldValues> {
  const url = (remoteUrl || '').trim();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('RH 媒体 URL 上传需要 http(s) 公网地址');
  }
  const fcId = randomUUID();
  const { data: raw } = await fcForwardRequest(fcId, 'image', 'none', {
    provider: 'runninghub',
    path: '/media/upload/binary',
    method: 'POST',
    uploadFromUrl: {
      url,
      filename: filename.replace(/[^\w.\-]+/g, '_'),
      contentType,
      fieldName: 'file',
    },
  });
  const parsed = parseRhMediaUploadResponse(raw as Record<string, unknown>);
  console.log('[RunningHub] 媒体(URL)上传成功', {
    fieldValue: parsed.fieldValue.slice(0, 80),
    fileNamePath: parsed.fileNamePath?.slice(0, 80),
  });
  return parsed;
}

/** 小文件直传；大文件先 OSS 再 FC URL 转存 RH */
export async function uploadRunningHubMediaBinarySmartViaFc(
  buffer: Buffer,
  mimeType: string,
  filename?: string,
  options?: { localPathForOss?: string },
): Promise<RhMediaUploadFieldValues> {
  const fsMod = await import('fs');
  const pathMod = await import('path');
  const { app } = await import('electron');
  const localPathRaw = (options?.localPathForOss || '').trim();
  let localPath = localPathRaw;
  if (localPathRaw.startsWith('local-resource://')) {
    localPath = localPathRaw.replace(/^local-resource:\/\/+/, '').replace(/%5C/gi, '/');
    if (localPath.startsWith('/') && localPath.length > 1 && localPath[2] === ':') localPath = localPath.slice(1);
    localPath = decodeURIComponent(localPath);
    if (localPath.match(/^[a-zA-Z]\//)) localPath = localPath[0].toUpperCase() + ':' + localPath.substring(1);
    localPath = pathMod.normalize(localPath);
  }

  let size = buffer?.length || 0;
  if (!size && localPath && fsMod.existsSync(localPath)) {
    size = fsMod.statSync(localPath).size;
  }
  if (!size) throw new Error('文件数据为空');

  if (size <= RH_FC_SAFE_BINARY_UPLOAD_BYTES) {
    const data =
      buffer?.length > 0
        ? buffer
        : localPath && fsMod.existsSync(localPath)
          ? fsMod.readFileSync(localPath)
          : buffer;
    return uploadRunningHubMediaBinaryViaFc(data, mimeType, filename);
  }

  const { VideoProvider } = await import('../ai/providers/VideoProvider.js');
  const vp = new VideoProvider();
  let ossUrl = '';
  if (localPath && fsMod.existsSync(localPath)) {
    const urlish = localPathRaw.startsWith('local-resource://')
      ? localPathRaw
      : `local-resource://${localPath.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (m) => m.substring(1))}`;
    ossUrl = await vp.uploadLocalModelPackageToOSS(urlish);
  } else {
    const ext = pathMod.extname(filename || '') || '.pth';
    const tmp = pathMod.join(app.getPath('temp'), `rvc-rh-upload-${Date.now()}${ext}`);
    fsMod.writeFileSync(tmp, buffer);
    try {
      const urlish = `local-resource://${tmp.replace(/\\/g, '/').replace(/^\/[a-zA-Z]:/, (m) => m.substring(1))}`;
      ossUrl = await vp.uploadLocalModelPackageToOSS(urlish);
    } finally {
      try {
        fsMod.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }
  console.log('[RunningHub] 大文件模型先上传 OSS', { sizeMb: (size / 1024 / 1024).toFixed(1), ossUrl: ossUrl.slice(0, 96) });
  try {
    return await uploadRunningHubMediaFromRemoteUrlViaFc(ossUrl, filename || 'model.pth', mimeType);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/uploadFromUrl|UPLOAD_FROM_URL|forward\.path|400|404|501/i.test(msg)) {
      throw new Error(
        `RVC 模型超过 24MB，需云端 FC 支持 uploadFromUrl 转发（请部署最新 demo/aliyun-fc-init-user）。原始错误: ${msg}`,
      );
    }
    throw e;
  }
}

/** 本地图片 Buffer → RunningHub 媒体库 fieldValue（经 FC 转发 /openapi/v2/media/upload/binary） */
export async function uploadRunningHubMediaBinaryViaFc(
  buffer: Buffer,
  mimeType: string,
  filename?: string,
): Promise<RhMediaUploadFieldValues> {
  if (!buffer?.length) throw new Error('图片数据为空');
  const ext = mimeType.includes('jpeg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : 'png';
  const fname = (filename || `image.${ext}`).replace(/[^\w.\-]+/g, '_');
  const fcId = randomUUID();
  const { data: raw } = await fcForwardRequest(fcId, 'image', 'none', {
    provider: 'runninghub',
    path: '/media/upload/binary',
    method: 'POST',
    uploadMultipart: {
      fieldName: 'file',
      filename: fname,
      contentType: mimeType || 'image/png',
      base64: buffer.toString('base64'),
    },
  });
  const parsed = parseRhMediaUploadResponse(raw as Record<string, unknown>);
  console.log('[RunningHub] 媒体上传成功', {
    fieldValue: parsed.fieldValue.slice(0, 80),
    fileNamePath: parsed.fileNamePath?.slice(0, 80),
  });
  return parsed;
}

function rhUploadFilenameAndMimeFromUrl(url: string): { filename: string; contentType: string } {
  try {
    const base = new URL(url).pathname.split('/').filter(Boolean).pop() || 'image.jpg';
    const lower = base.toLowerCase();
    const contentType = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
        ? 'image/webp'
        : lower.endsWith('.gif')
          ? 'image/gif'
          : 'image/jpeg';
    return { filename: base, contentType };
  } catch {
    return { filename: 'image.jpg', contentType: 'image/jpeg' };
  }
}

function buildImageTo3dSubmitBody(
  imageNodeId: string,
  imageFieldValue: string,
  instanceType: 'default' | 'plus',
  description: string,
  options?: { randomSeed?: boolean },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    nodeInfoList: [
      {
        nodeId: imageNodeId,
        fieldName: 'image',
        fieldValue: imageFieldValue,
        description,
      },
    ],
    instanceType,
    usePersonalQueue: 'false',
  };
  if (options?.randomSeed) body.randomSeed = true;
  return body;
}

function isImageTo3dRetryableError(err: ImageTo3dError): boolean {
  const m = err.message || '';
  return (
    /results 始终为空|未解析到 GLB|秒退|无 API 输出|API 返回.*但未包含 GLB/i.test(m) ||
    Boolean(err.rhTaskId)
  );
}

/** 图片转 3D（Hy3D / Trellis2，按 model 选择应用与实例档位） */
export async function runImageTo3dModelViaFc(
  modelId: string | undefined,
  imageFieldValue: string,
  options?: { alternateImageFieldValue?: string },
): Promise<ImageTo3dResult | ImageTo3dError> {
  const u = imageFieldValue?.trim();
  if (!u) return { success: false, message: '图片地址为空' };
  const model = resolveImageTo3dModelId(modelId);
  const appId = imageTo3dAppIdForModel(model);
  const isTrellis2 = model === 'trellis2';
  const imageNodeId = imageTo3dImageNodeIdForModel(model);
  const imageDescription = imageTo3dImageFieldDescriptionForModel(model);
  const minPlausibleTaskSec = imageTo3dMinPlausibleTaskSecForModel(model);
  const label = isTrellis2 ? 'Trellis2图片转3D' : '图片转3D';
  const instanceTypes = imageTo3dInstanceTypesToTryForModel(model);
  const attempts: Array<{ instanceType: 'default' | 'plus'; fieldVal: string }> = [];

  if (isTrellis2) {
    const { filename, contentType } = rhUploadFilenameAndMimeFromUrl(u);
    let uploaded: RhMediaUploadFieldValues;
    try {
      uploaded = await uploadRunningHubMediaFromRemoteUrlViaFc(u, filename, contentType);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, message: `${label}：参考图上传 RunningHub 媒体库失败（${msg}）` };
    }
    const instanceType = instanceTypes[0] ?? 'plus';
    attempts.push({ instanceType, fieldVal: uploaded.fieldValue });
    const altRh = uploaded.fileNamePath?.trim();
    if (altRh && altRh !== uploaded.fieldValue) {
      attempts.push({ instanceType, fieldVal: altRh });
    }
    const alt = options?.alternateImageFieldValue?.trim();
    if (alt && alt !== uploaded.fieldValue && alt !== altRh) {
      attempts.push({ instanceType, fieldVal: alt });
    }
  } else {
    for (const instanceType of instanceTypes) {
      attempts.push({ instanceType, fieldVal: u });
    }
  }

  let lastError: ImageTo3dError = { success: false, message: `${label}失败` };

  for (let i = 0; i < attempts.length; i++) {
    const { instanceType, fieldVal } = attempts[i];
    if (i > 0) {
      console.log(
        `[图片转3D] Trellis2 第 ${i + 1} 次尝试 instance=${instanceType} image=${fieldVal.slice(0, 48)}`,
      );
    }
    const body = buildImageTo3dSubmitBody(imageNodeId, fieldVal, instanceType, imageDescription, {
      randomSeed: isTrellis2,
    });
    const r = await submitAndPollForGlb(appId, `/run/ai-app/${appId}`, body, label, {
      imageNodeId,
      instanceType,
      minPlausibleTaskSec,
      emptySuccessFastFail: isTrellis2,
    });
    if (r.success) return r;
    lastError = r;
    if (!isTrellis2 || !isImageTo3dRetryableError(r)) return r;
  }

  return lastError;
}

/** @deprecated 使用 runImageTo3dModelViaFc */
export async function runImageTo3dViaFc(imageInputUrl: string): Promise<ImageTo3dResult | ImageTo3dError> {
  return runImageTo3dModelViaFc(IMAGE_TO_3D_MODEL_HY3D, imageInputUrl);
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
