/**
 * Phase 7：RunningHub 提交/查询薄封装（可注入，便于单测不打真 RH）
 */

import {
  pickRunningHubTarget,
  buildRunningHubForwardUrl,
  normalizeRhPath,
  isRhQueryPath,
  extractRhTaskIdFromForwardData,
  persistRhTaskRegion,
  rhAuthErrorMessage,
  forceOverseasByBillingOrPath,
} from './runningHubTarget.mjs';

const DEFAULT_TIMEOUT_MS = parseInt(String(process.env.NX_FORWARD_TIMEOUT_MS || '300000'), 10) || 300000;

function unwrapRhPayload(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const inner = raw.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    if (inner.taskId || inner.task_id || inner.status || inner.results) return { ...raw, ...inner };
  }
  return raw;
}

export function readRhStatus(data) {
  const u = unwrapRhPayload(data);
  if (typeof u.status === 'string' && u.status.trim()) return String(u.status).toUpperCase();
  if (u.data && typeof u.data === 'object' && typeof u.data.status === 'string') {
    return String(u.data.status).toUpperCase();
  }
  // outputs 接口：code 0 + data → SUCCESS；805 → FAILED；804/813 → RUNNING/QUEUED
  const code = u.code != null ? Number(u.code) : NaN;
  if (code === 0 && u.data) return 'SUCCESS';
  if (code === 805) return 'FAILED';
  if (code === 804) return 'RUNNING';
  if (code === 813) return 'QUEUED';
  return '';
}

const RESULT_SKIP_OUTPUT_TYPES = new Set([
  'zip',
  'txt',
  'text',
  'json',
  'glb',
  'gltf',
  'obj',
  'fbx',
]);

function tryHttpUrl(v) {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim()) ? v.trim() : '';
}

function shouldSkipResultUrl(url, outputType) {
  const out = String(outputType || '')
    .trim()
    .toLowerCase();
  if (out && RESULT_SKIP_OUTPUT_TYPES.has(out)) return true;
  if (/\.(zip|txt|json|glb|gltf|obj|fbx)(?:$|[?#])/i.test(url)) return true;
  return false;
}

/**
 * 从 RH /query 提取全部可展示结果 URL（悠船/MJ 等多图）。
 * 写入 nx_tasks.result_oss_url 时用换行拼接；客户端按行拆成 outputImages。
 */
export function extractResultUrls(data) {
  const u = unwrapRhPayload(data);
  const urls = [];
  const push = (raw, outputType) => {
    const s = tryHttpUrl(raw);
    if (!s || shouldSkipResultUrl(s, outputType)) return;
    if (!urls.includes(s)) urls.push(s);
  };

  if (Array.isArray(u.results)) {
    for (const item of u.results) {
      if (typeof item === 'string') {
        push(item);
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const rec = item;
      const out = rec.outputType ?? rec.type;
      push(rec.url, out);
      push(rec.fileUrl, out);
      push(rec.imageUrl, out);
      push(rec.image_url, out);
      push(rec.videoUrl, out);
      push(rec.video_url, out);
    }
  }

  push(u.fileUrl);
  push(u.imageUrl);
  push(u.url);
  push(u.videoUrl);
  push(u.video_url);
  push(u.outputUrl);
  push(u.resultUrl);

  if (u.data && typeof u.data === 'object' && !Array.isArray(u.data)) {
    push(u.data.fileUrl);
    push(u.data.imageUrl);
    push(u.data.url);
    push(u.data.videoUrl);
    push(u.data.video_url);
    if (Array.isArray(u.data.results)) {
      for (const item of u.data.results) {
        if (typeof item === 'string') push(item);
        else if (item && typeof item === 'object') {
          const out = item.outputType ?? item.type;
          push(item.url, out);
          push(item.fileUrl, out);
          push(item.imageUrl, out);
        }
      }
    }
  } else if (Array.isArray(u.data)) {
    for (const item of u.data) {
      if (typeof item === 'string') push(item);
    }
  }

  return urls;
}

export function extractResultUrl(data) {
  const urls = extractResultUrls(data);
  return urls[0] || '';
}

/** 多图写入 result_oss_url：换行分隔（URL 本身不含换行） */
export function joinResultUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return '';
  const out = [];
  for (const u of urls) {
    const s = tryHttpUrl(u);
    if (s && !out.includes(s)) out.push(s);
  }
  return out.join('\n');
}

/**
 * @param {{
 *   path: string,
 *   method?: string,
 *   body?: object,
 *   provider?: string,
 *   rhRegion?: string,
 *   billingModelId?: string,
 * }} forward
 * @param {{ userId?: string, dbModule?: object, timeoutMs?: number, fetchImpl?: typeof fetch }} [opts]
 */
export async function submitRunningHub(forward, opts = {}) {
  const provider = String(forward.provider || 'runninghub').toLowerCase();
  if (provider !== 'runninghub') {
    return { ok: false, reason: 'UNSUPPORTED_PROVIDER', uncertain: false };
  }
  const path = String(forward.path || '');
  if (!path) return { ok: false, reason: 'PATH_REQUIRED', uncertain: false };
  if (isRhQueryPath(path)) {
    return { ok: false, reason: 'SUBMIT_PATH_IS_QUERY', uncertain: false };
  }

  let regionHint = forward.rhRegion || null;
  const billingModelId = String(forward.billingModelId || '').trim();
  if (forceOverseasByBillingOrPath(path, billingModelId)) regionHint = 'ai';
  const rhTarget = pickRunningHubTarget(path, { regionHint });
  if (!rhTarget.apiKey) {
    return { ok: false, reason: rhAuthErrorMessage(rhTarget.region), uncertain: false };
  }

  const url = buildRunningHubForwardUrl(path, rhTarget);
  const method = String(forward.method || 'POST').toUpperCase();
  const bodyObj =
    forward.body && typeof forward.body === 'object' && !Array.isArray(forward.body)
      ? forward.body
      : {};
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${rhTarget.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: method === 'GET' ? undefined : JSON.stringify(bodyObj),
      signal: controller.signal,
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      const errMsg = data?.message || data?.error?.message || data?.error || `HTTP ${res.status}`;
      return {
        ok: false,
        reason: typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg),
        http_status: res.status,
        uncertain: false,
        data,
      };
    }
    const providerTaskId = extractRhTaskIdFromForwardData(data) || '';
    if (providerTaskId && opts.dbModule && opts.userId) {
      try {
        await persistRhTaskRegion(opts.dbModule, opts.userId, providerTaskId, rhTarget.region);
      } catch (_) {}
    }
    return {
      ok: true,
      provider_task_id: providerTaskId,
      data,
      region: rhTarget.region,
      path: normalizeRhPath(path),
    };
  } catch (e) {
    const aborted = e?.name === 'AbortError' || /aborted|timeout/i.test(String(e?.message || e));
    return {
      ok: false,
      reason: aborted ? 'SUBMIT_TIMEOUT' : String(e?.message || e || 'SUBMIT_ERROR'),
      uncertain: true, // 禁止盲重试 / 盲退款
      data: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 查询 RH 任务状态（默认 /query）
 */
export async function queryRunningHub(providerTaskId, opts = {}) {
  const tid = String(providerTaskId || '').trim();
  if (!tid) return { ok: false, reason: 'PROVIDER_TASK_ID_REQUIRED' };

  const path = String(opts.queryPath || '/query');
  const regionHint = opts.rhRegion || null;
  const rhTarget = pickRunningHubTarget(path, { regionHint });
  if (!rhTarget.apiKey) {
    return { ok: false, reason: rhAuthErrorMessage(rhTarget.region) };
  }
  const url = buildRunningHubForwardUrl(path, rhTarget);
  const timeoutMs = opts.timeoutMs ?? Math.min(60000, DEFAULT_TIMEOUT_MS);
  const fetchImpl = opts.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rhTarget.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ taskId: tid, apiKey: rhTarget.apiKey }),
      signal: controller.signal,
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      return {
        ok: false,
        reason: `HTTP ${res.status}`,
        uncertain: true,
        data,
      };
    }
    return {
      ok: true,
      status: readRhStatus(data),
      result_url: joinResultUrls(extractResultUrls(data)),
      data,
    };
  } catch (e) {
    return {
      ok: false,
      reason: String(e?.message || e || 'QUERY_ERROR'),
      uncertain: true,
    };
  } finally {
    clearTimeout(timer);
  }
}
