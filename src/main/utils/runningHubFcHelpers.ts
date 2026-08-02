/**
 * RunningHub 请求经 FC 转发：提交扣费、轮询不扣费（与 ImageProvider 中 rhPost/rhQuery 模式一致）。
 */
import { fcForwardRequest } from './fcForwardTask.js';

/**
 * FC 返回的 RunningHub 体常被包一层 `{ code, data: { status, results, ... } }`，
 * 若直接读顶层 `status` 会得到 undefined，导致轮询永远不认 SUCCESS。
 */
export function unwrapRunningHubForwardBody(raw: Record<string, unknown>): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, unknown> = { ...raw };
  const inner = raw.data;
  if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
    const d = inner as Record<string, unknown>;
    const innerLooksRh =
      d.status != null ||
      d.results != null ||
      d.taskId != null ||
      d.task_id != null ||
      d.errorMessage != null ||
      d.error != null;
    const code = raw.code;
    const codeOk = code === 0 || code === '0' || code === 200 || code === '200';
    if (innerLooksRh || codeOk) {
      if (d.status != null) out.status = d.status;
      if (d.results != null) out.results = d.results;
      if (d.taskId != null) out.taskId = d.taskId;
      if (d.task_id != null) out.task_id = d.task_id;
      if (d.errorMessage != null) out.errorMessage = d.errorMessage;
      if (d.errorCode != null) out.errorCode = d.errorCode;
      if (d.error != null) out.error = d.error;
      if (d.message != null) out.message = d.message;
      if (d.fail_reason != null) out.fail_reason = d.fail_reason;
      if (d.failedReason != null) out.failedReason = d.failedReason;
      for (const k of ['video_url', 'videoUrl', 'url', 'output', 'fileUrl']) {
        const v = d[k];
        if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
          out[k] = v;
        }
      }
      const inner2 = d.data;
      if (inner2 != null && typeof inner2 === 'object' && !Array.isArray(inner2)) {
        const d2 = inner2 as Record<string, unknown>;
        if (out.status == null && d2.status != null) out.status = d2.status;
        if (out.results == null && d2.results != null) out.results = d2.results;
      }
    }
  }
  return out;
}

/** 从 FC 转发提交响应提取 RunningHub taskId（含 `{ code, data: { taskId } }` 包装） */
export function extractRhTaskIdFromForward(raw: Record<string, unknown>): string | undefined {
  const data = unwrapRunningHubForwardBody(raw);
  const top =
    (typeof data.taskId === 'string' && data.taskId.trim()) ||
    (typeof data.task_id === 'string' && data.task_id.trim()) ||
    '';
  if (top) return top;
  const inner = data.data;
  if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
    const o = inner as { taskId?: string; task_id?: string };
    const nested =
      (typeof o.taskId === 'string' && o.taskId.trim()) ||
      (typeof o.task_id === 'string' && o.task_id.trim()) ||
      '';
    if (nested) return nested;
  }
  return undefined;
}

/** 从 RunningHub 提交/轮询响应提取可读错误（含 errorCode） */
function extractRhFailedReasonMessage(failedReason: unknown): string {
  if (!failedReason || typeof failedReason !== 'object') return '';
  const fr = failedReason as Record<string, unknown>;
  const direct =
    fr.exception_message ??
    fr.exceptionMessage ??
    fr.message ??
    fr.error ??
    fr.reason;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return '';
}

export function formatRunningHubTaskError(
  data: Record<string, unknown> | null | undefined,
  fallback = '任务失败',
): string {
  if (!data || typeof data !== 'object') return fallback;
  const codeRaw = data.errorCode ?? data.error_code ?? data.code;
  const msgRaw =
    data.errorMessage ??
    data.error ??
    data.message ??
    data.msg ??
    data.fail_reason ??
    data.failReason ??
    extractRhFailedReasonMessage(data.failedReason);
  const frMsg = extractRhFailedReasonMessage(data.failedReason);
  const msg = typeof msgRaw === 'string' ? msgRaw.trim() : msgRaw != null ? String(msgRaw).trim() : '';
  const isGenericMsg = !msg || /^工作流运行失败$/i.test(msg) || /^task failed$/i.test(msg);
  let detail = isGenericMsg && frMsg ? frMsg.split('\n')[0].trim() : msg;
  if (/Value not in list|not in \(list of length 47\)/i.test(`${detail} ${frMsg}`)) {
    detail =
      'RVC model_name 不在 RunningHub 官方 47 项预置列表内（自训练 openapi/ 路径不可用，非客户端故障）';
  }
  const code =
    codeRaw != null && String(codeRaw).trim() !== '' && !['0', '200', 'SUCCESS'].includes(String(codeRaw))
      ? String(codeRaw).trim()
      : '';
  if (code && detail) return `[${code}] ${detail}`;
  return detail || frMsg.split('\n')[0].trim() || fallback;
}

export function logRunningHubTaskFailure(
  context: string,
  data: Record<string, unknown>,
  taskId?: string,
): void {
  const summary = formatRunningHubTaskError(data);
  console.error(`[RunningHub] ${context} 失败 taskId=${taskId ?? '—'} → ${summary}`);
  try {
    const debug = {
      status: data.status,
      errorCode: data.errorCode ?? data.error_code ?? data.code,
      errorMessage: data.errorMessage,
      error: data.error,
      message: data.message,
      fail_reason: data.fail_reason,
      failedReason: data.failedReason,
    };
    console.error(`[RunningHub] ${context} 响应摘要:`, JSON.stringify(debug));
  } catch {
    /* ignore */
  }
}

export function rhPollFailureError(
  context: string,
  data: Record<string, unknown>,
  taskId?: string,
  fallback = '生成失败',
): Error {
  logRunningHubTaskFailure(context, data, taskId);
  return new Error(formatRunningHubTaskError(data, fallback));
}

export function summarizeRhNodeInfoForLog(
  list: Array<{ nodeId: string; fieldName: string; fieldValue: string; description?: string }>,
): unknown[] {
  return list.map((n) => ({
    nodeId: n.nodeId,
    fieldName: n.fieldName,
    description: n.description,
    fieldValue:
      n.fieldName === 'image' && n.fieldValue
        ? n.fieldValue.length > 72
          ? `${n.fieldValue.slice(0, 72)}…`
          : n.fieldValue
        : n.fieldValue,
  }));
}

export function pathFromRunningHubUrl(fullUrl: string): string {
  const marker = '/openapi/v2';
  const i = fullUrl.indexOf(marker);
  if (i === -1) {
    try {
      const u = new URL(fullUrl);
      return u.pathname + u.search;
    } catch {
      return fullUrl;
    }
  }
  return fullUrl.slice(i + marker.length) || '/';
}

export async function rhPostChargeVideo(
  fullUrl: string,
  payload: Record<string, unknown>,
  fallbackFcId: string,
  options?: { billingModelId?: string; rhRegion?: 'cn' | 'ai' },
  prepaidLedgerTaskId?: string | null,
): Promise<Record<string, unknown>> {
  const usePrepaid = prepaidLedgerTaskId != null && String(prepaidLedgerTaskId).trim() !== '';
  const taskId = usePrepaid ? String(prepaidLedgerTaskId).trim() : fallbackFcId;
  const billing = usePrepaid ? ('none' as const) : ('charge' as const);
  const rhRegion = options?.rhRegion === 'ai' || options?.rhRegion === 'cn' ? options.rhRegion : undefined;
  const { data } = await fcForwardRequest(
    taskId,
    'video',
    billing,
    {
      provider: 'runninghub',
      path: pathFromRunningHubUrl(fullUrl),
      method: 'POST',
      body: payload,
      ...(rhRegion ? { rhRegion } : {}),
    },
    options?.billingModelId ? { billingModelId: options.billingModelId } : undefined,
  );
  return data;
}

export async function rhQueryPollVideo(
  rhTaskId: string,
  fcPollId: string,
  ledgerTaskId?: string | null,
  options?: { rhRegion?: 'cn' | 'ai' },
): Promise<Record<string, unknown>> {
  const taskId =
    ledgerTaskId != null && String(ledgerTaskId).trim() !== '' ? String(ledgerTaskId).trim() : fcPollId;
  const rhRegion = options?.rhRegion === 'ai' || options?.rhRegion === 'cn' ? options.rhRegion : undefined;
  const { data } = await fcForwardRequest(taskId, 'video', 'none', {
    provider: 'runninghub',
    path: '/query',
    method: 'POST',
    body: { taskId: rhTaskId },
    ...(rhRegion ? { rhRegion } : {}),
  });
  return unwrapRunningHubForwardBody(data as Record<string, unknown>);
}

export type RhQueryPollOptions = {
  /** 为 true 时用 ledger taskId 走 FC（写 nx_tasks）；默认 false，轮询只用 fcPollId 快路径 */
  useLedgerFcTaskId?: boolean;
};

/** RunningHub 图片轮询：首次不等待，前 60s 每 1s，之后每 3s */
export function imageRhPollSleepMs(pollingAttempts: number, pollStartTimeMs: number): number {
  if (pollingAttempts === 0) return 0;
  const elapsed = Date.now() - pollStartTimeMs;
  return elapsed < 60_000 ? 1000 : 3000;
}

export async function rhQueryPollImage(
  rhTaskId: string,
  fcPollId: string,
  ledgerTaskId?: string | null,
  options?: RhQueryPollOptions,
): Promise<Record<string, unknown>> {
  const useLedger =
    options?.useLedgerFcTaskId === true &&
    ledgerTaskId != null &&
    String(ledgerTaskId).trim() !== '';
  const taskId = useLedger ? String(ledgerTaskId).trim() : fcPollId;
  const { data } = await fcForwardRequest(taskId, 'image', 'none', {
    provider: 'runninghub',
    path: '/query',
    method: 'POST',
    body: { taskId: rhTaskId },
  });
  return unwrapRunningHubForwardBody(data as Record<string, unknown>);
}

/** SUCCESS 后一次性用 ledger id 回写 nx_tasks（供 /tasks/status） */
export async function syncLedgerAfterRhImageSuccess(
  rhTaskId: string,
  ledgerTaskId: string,
): Promise<void> {
  try {
    await rhQueryPollImage(rhTaskId, `${ledgerTaskId}:ledger-sync`, ledgerTaskId, {
      useLedgerFcTaskId: true,
    });
  } catch (e) {
    console.warn('[图片生成] 云端任务状态回写失败（不影响结果）', e);
  }
}

export async function rhPostChargeAudio(
  fullUrl: string,
  payload: Record<string, unknown>,
  fallbackFcId: string,
  options?: { billingModelId?: string },
  prepaidLedgerTaskId?: string | null,
): Promise<Record<string, unknown>> {
  const usePrepaid = prepaidLedgerTaskId != null && String(prepaidLedgerTaskId).trim() !== '';
  const taskId = usePrepaid ? String(prepaidLedgerTaskId).trim() : fallbackFcId;
  const billing = usePrepaid ? ('none' as const) : ('charge' as const);
  const { data: raw } = await fcForwardRequest(
    taskId,
    'audio',
    billing,
    {
      provider: 'runninghub',
      path: pathFromRunningHubUrl(fullUrl),
      method: 'POST',
      body: payload,
    },
    options?.billingModelId ? { billingModelId: options.billingModelId } : undefined,
  );
  return unwrapRunningHubForwardBody(raw as Record<string, unknown>);
}

export async function rhQueryPollAudio(
  rhTaskId: string,
  fcPollId: string,
  ledgerTaskId?: string | null,
): Promise<Record<string, unknown>> {
  const taskId =
    ledgerTaskId != null && String(ledgerTaskId).trim() !== '' ? String(ledgerTaskId).trim() : fcPollId;
  const { data } = await fcForwardRequest(taskId, 'audio', 'none', {
    provider: 'runninghub',
    path: '/query',
    method: 'POST',
    body: { taskId: rhTaskId },
  });
  return unwrapRunningHubForwardBody(data as Record<string, unknown>);
}
