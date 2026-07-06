/**
 * 通过阿里云 FC run-task 转发第三方 API（RunningHub / BLTCY），密钥仅在云端配置。
 */
import axios from 'axios';
import { randomUUID } from 'crypto';
import { callFCGenericTask } from '../ai-provider.js';
import { beginFcGenerationActivity, endFcGenerationActivity } from '../services/nxFcRouteManager.js';

export type FcForwardProvider = 'runninghub' | 'bltcy';

export interface FcForwardMultipartPayload {
  fieldName?: string;
  filename: string;
  contentType: string;
  /** 文件内容的 base64（由 FC 侧组装为 multipart/form-data 发往第三方） */
  base64: string;
}

export interface FcForwardPayload {
  provider: FcForwardProvider;
  /** 相对路径，如 /query、/seedream-v4.5/text-to-image */
  path: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, unknown> | unknown;
  /** 与 body 二选一：multipart 上传（当前 FC 实现仅对 RunningHub 转发） */
  uploadMultipart?: FcForwardMultipartPayload;
  /** FC 从公网 URL 拉取文件再 multipart 上传 RunningHub（避免 invoke payload 32MB 限制） */
  uploadFromUrl?: {
    url: string;
    filename?: string;
    contentType?: string;
    fieldName?: string;
  };
}

function rhTaskIdFromForwardData(d: Record<string, unknown>): string | undefined {
  const tid =
    (typeof d.taskId === 'string' && d.taskId) ||
    (typeof d.task_id === 'string' && d.task_id) ||
    undefined;
  if (tid) return tid;
  const inner = d.data;
  if (inner && typeof inner === 'object') {
    const o = inner as { taskId?: string; task_id?: string };
    return (typeof o.taskId === 'string' && o.taskId) || (typeof o.task_id === 'string' && o.task_id) || undefined;
  }
  return undefined;
}

function attachResponse(out: Error, response: unknown): void {
  (out as Error & { response?: unknown }).response = response;
}

function mapForwardAxiosError(e: unknown): Error {
  if (!axios.isAxiosError(e)) return e instanceof Error ? e : new Error(String(e));
  const st = e.response?.status;
  const raw = e.response?.data;
  const errStr =
    (raw && typeof raw === 'object' && (raw as { error?: unknown }).error != null
      ? String((raw as { error?: unknown }).error)
      : '') ||
    (raw && typeof raw === 'object' && (raw as { message?: unknown }).message != null
      ? String((raw as { message?: unknown }).message)
      : '') ||
    e.message ||
    '';
  const combined = `${st ?? ''} ${errStr}`;
  if (
    st === 401 ||
    /HTTP\s*401|\b401\b/i.test(combined) ||
    /Unauthorized/i.test(errStr)
  ) {
    const out = new Error(
      '云端 RunningHub 鉴权失败（HTTP 401）：请在 FC 环境变量中配置有效的 RUNNINGHUB_API_KEY，并与 RunningHub 开放平台「插件算力 API Key」一致。',
    );
    attachResponse(out, e.response);
    return out;
  }
  /** Cloudflare：边缘与源站 TLS 握手失败，多为瞬时或 CDN/域名 SSL 配置问题，非业务 API Key 错误 */
  if (st === 525 || /(^|\s)525(\s|$)|SSL handshake failed|525/i.test(combined)) {
    const out = new Error(
      '连接异常（HTTP 525）：多为 CDN（如 Cloudflare）与源站 SSL 握手失败，常见于网络抖动或服务侧短暂故障。请稍后重试；若反复出现，检查 FC 自定义域名 HTTPS、或更换网络/时段后再试。',
    );
    attachResponse(out, e.response);
    return out;
  }
  return e;
}

/**
 * @param taskType 用于 FC 侧扣费档位：image | video | audio
 * @param billing charge=扣费（提交任务）；none=仅转发（轮询查询）
 * @param options.billingModelId 与 FC `mergeRunTaskInner` 后根字段 `inner.billingModelId` 一致（勿改名）
 */
export async function fcForwardRequest(
  taskId: string,
  taskType: 'image' | 'video' | 'audio',
  billing: 'charge' | 'none',
  forward: FcForwardPayload,
  options?: { billingModelId?: string },
): Promise<{ data: Record<string, unknown> }> {
  const billingModelId = options?.billingModelId?.trim();
  beginFcGenerationActivity();
  try {
    let { data } = await callFCGenericTask({
      type: taskType,
      taskId,
      billing,
      forward,
      ...(billingModelId ? { billingModelId } : {}),
    });
    let out = data as Record<string, unknown>;

    if (
      billing === 'charge' &&
      out.duplicate_task === true &&
      !rhTaskIdFromForwardData(out)
    ) {
      const retryId = randomUUID();
      const second = await callFCGenericTask({
        type: taskType,
        taskId: retryId,
        billing,
        forward,
        ...(billingModelId ? { billingModelId } : {}),
      });
      out = second.data as Record<string, unknown>;
    }

    return { data: out };
  } catch (e) {
    throw mapForwardAxiosError(e);
  } finally {
    endFcGenerationActivity();
  }
}
