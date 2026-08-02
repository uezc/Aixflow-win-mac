/**
 * 阿里云视觉智能 VIAPI：视频人像分割 SegmentVideoBody（异步）+ GetAsyncJobResult 轮询。
 * AccessKey 仅读 FC 环境变量，不下发客户端。
 *
 * 文档：
 * - https://help.aliyun.com/zh/viapi/developer-reference/api-cq06eu
 * - Endpoint: videoseg.cn-shanghai.aliyuncs.com，Version 2020-03-20
 */

import crypto from 'crypto';

const DEFAULT_ENDPOINT = 'https://videoseg.cn-shanghai.aliyuncs.com';
const API_VERSION = '2020-03-20';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 阿里云 POP RPC percentEncode（*→%2A，~ 不编码等） */
function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

/**
 * 解析 VIAPI AccessKey（优先专用变量，其次标准阿里云环境变量）。
 * @returns {{ accessKeyId: string, accessKeySecret: string } | null}
 */
export function resolveViapiCredentials() {
  const accessKeyId = String(
    process.env.VIAPI_ACCESS_KEY_ID ||
      process.env.ALIBABA_CLOUD_ACCESS_KEY_ID ||
      '',
  ).trim();
  const accessKeySecret = String(
    process.env.VIAPI_ACCESS_KEY_SECRET ||
      process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET ||
      '',
  ).trim();
  if (!accessKeyId || !accessKeySecret) return null;
  return { accessKeyId, accessKeySecret };
}

/**
 * @param {Record<string, string>} params
 * @param {string} accessKeySecret
 */
function signRpcPost(params, accessKeySecret) {
  const keys = Object.keys(params).sort();
  const canonicalized = keys.map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`).join('&');
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalized)}`;
  return crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64');
}

/**
 * VIAPI POP RPC：POST + application/x-www-form-urlencoded（SegmentVideoBody / GetAsyncJobResult 共用）。
 * @param {string} action
 * @param {Record<string, string>} bizParams
 * @param {{ accessKeyId: string, accessKeySecret: string }} cred
 */
async function callVideosegRpc(action, bizParams, cred) {
  const endpoint = String(process.env.VIAPI_VIDEOSEG_ENDPOINT || DEFAULT_ENDPOINT)
    .trim()
    .replace(/\/$/, '');
  const params = {
    Format: 'JSON',
    Version: API_VERSION,
    AccessKeyId: cred.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Action: action,
    RegionId: 'cn-shanghai',
    ...bizParams,
  };
  params.Signature = signRpcPost(params, cred.accessKeySecret);
  const body = Object.keys(params)
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const url = `${endpoint}/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const json = await res.json().catch(() => ({}));
  const code = json?.Code || json?.code;
  const message = json?.Message || json?.message;
  if (!res.ok || code) {
    console.error(
      '[viapi/videoseg-rpc]',
      action,
      'status=',
      res.status,
      'Code=',
      code || '',
      'Message=',
      message || '',
    );
  }
  return { ok: res.ok, status: res.status, json };
}

/**
 * @param {{ userId: string; headers: Record<string, string>; body: Record<string, unknown> }} opts
 */
export async function handleViapiSegmentVideoBody(opts) {
  const { userId, headers, body } = opts;
  const cred = resolveViapiCredentials();
  if (!cred) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: 'VIAPI_NOT_CONFIGURED',
        message: '云端未配置视觉智能 AccessKey（VIAPI_ACCESS_KEY_ID / VIAPI_ACCESS_KEY_SECRET），无法使用智能抠像',
      }),
    };
  }
  if (!userId) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'UNAUTHORIZED' }),
    };
  }

  const videoUrl = String(body?.videoUrl ?? body?.video_url ?? '').trim();
  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'VIDEO_URL_REQUIRED',
        message: '请提供公网可访问的 videoUrl（http/https）',
      }),
    };
  }
  if (/[\u4e00-\u9fff]/.test(videoUrl)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'VIDEO_URL_INVALID',
        message: '视频 URL 不能包含中文字符（阿里云 VIAPI 限制）',
      }),
    };
  }

  const pollIntervalMs = Math.min(
    15000,
    Math.max(2000, Number(process.env.VIAPI_SEGMENT_POLL_MS || 4000) || 4000),
  );
  const maxWaitMs = Math.min(
    25 * 60 * 1000,
    Math.max(60_000, Number(process.env.VIAPI_SEGMENT_MAX_WAIT_MS || 900_000) || 900_000),
  );

  try {
    const submit = await callVideosegRpc('SegmentVideoBody', { VideoUrl: videoUrl }, cred);
    if (!submit.ok) {
      const code = String(submit.json?.Code || submit.json?.code || 'SUBMIT_FAILED');
      let msg =
        String(submit.json?.Message || submit.json?.message || '').trim() ||
        `提交人像分割任务失败（HTTP ${submit.status}）`;
      // 非上海 OSS：官方要求转存上海（文档 155645），勿把阿里原文直接抛给用户
      if (/invalid region|地域不对|oss url/i.test(`${code} ${msg}`)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({
            error: 'OSS_REGION',
            message:
              '视频须为上海地域 OSS 公网地址才能智能抠像。请确认已配置 OSS_MEDIA_SH_BUCKET 并以 mediaRegion=sh 上传',
          }),
        };
      }
      console.error('[viapi/segment-video-body] submit failed', submit.status, submit.json);
      return {
        statusCode: submit.status >= 400 && submit.status < 600 ? submit.status : 502,
        headers,
        body: JSON.stringify({ error: code, message: msg }),
      };
    }

    const jobId = String(submit.json?.RequestId || submit.json?.requestId || '').trim();
    if (!jobId) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'NO_JOB_ID',
          message: 'VIAPI 未返回 RequestId（JobId）',
        }),
      };
    }

    const t0 = Date.now();
    let lastStatus = '';
    /** @type {Record<string, unknown> | null} */
    let lastData = null;

    while (Date.now() - t0 < maxWaitMs) {
      await sleep(pollIntervalMs);
      const q = await callVideosegRpc('GetAsyncJobResult', { JobId: jobId }, cred);
      if (!q.ok) {
        const code = String(q.json?.Code || q.json?.code || 'QUERY_FAILED');
        const msg =
          String(q.json?.Message || q.json?.message || '').trim() ||
          `查询人像分割任务失败（HTTP ${q.status}）`;
        console.error('[viapi/segment-video-body] query failed', q.status, q.json);
        return {
          statusCode: q.status >= 400 && q.status < 600 ? q.status : 502,
          headers,
          body: JSON.stringify({ error: code, message: msg, jobId }),
        };
      }

      const data =
        q.json?.Data && typeof q.json.Data === 'object'
          ? /** @type {Record<string, unknown>} */ (q.json.Data)
          : q.json?.data && typeof q.json.data === 'object'
            ? /** @type {Record<string, unknown>} */ (q.json.data)
            : null;
      lastData = data;
      lastStatus = String(data?.Status || data?.status || '').toUpperCase();
      if (
        lastStatus === 'PROCESS_SUCCESS' ||
        lastStatus === 'PROCESS_FAILED' ||
        lastStatus === 'TIMEOUT' ||
        lastStatus === 'SUCCESS' ||
        lastStatus === 'FAILED'
      ) {
        break;
      }
    }

    if (lastStatus !== 'PROCESS_SUCCESS' && lastStatus !== 'SUCCESS') {
      if (
        !lastStatus ||
        lastStatus === 'QUEUING' ||
        lastStatus === 'PROCESSING' ||
        lastStatus === 'RUNNING'
      ) {
        return {
          statusCode: 504,
          headers,
          body: JSON.stringify({
            error: 'TIMEOUT',
            message: '智能抠像超时，请稍后重试或缩短视频时长（建议总帧数 ≤2000）',
            jobId,
            jobStatus: lastStatus || 'PROCESSING',
          }),
        };
      }
      const failMsg =
        String(lastData?.ErrorMessage || lastData?.errorMessage || lastData?.Message || '').trim() ||
        `人像分割失败（${lastStatus}）`;
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'TASK_FAILED',
          message: failMsg,
          jobId,
          jobStatus: lastStatus,
        }),
      };
    }

    let resultRaw = lastData?.Result ?? lastData?.result ?? '';
    let maskVideoUrl = '';
    if (typeof resultRaw === 'string' && resultRaw.trim()) {
      try {
        const parsed = JSON.parse(resultRaw);
        maskVideoUrl = String(parsed?.VideoUrl || parsed?.videoUrl || '').trim();
      } catch {
        maskVideoUrl = '';
      }
    } else if (resultRaw && typeof resultRaw === 'object') {
      maskVideoUrl = String(
        /** @type {Record<string, unknown>} */ (resultRaw).VideoUrl ||
          /** @type {Record<string, unknown>} */ (resultRaw).videoUrl ||
          '',
      ).trim();
    }
    if (!maskVideoUrl) {
      maskVideoUrl = String(lastData?.VideoUrl || lastData?.videoUrl || '').trim();
    }
    if (!maskVideoUrl || !/^https?:\/\//i.test(maskVideoUrl)) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'NO_MASK_URL',
          message: '任务成功但未返回 mask 视频 URL',
          jobId,
        }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        maskVideoUrl,
        jobId,
        userId,
      }),
    };
  } catch (e) {
    const msg = e?.message || String(e);
    console.error('[viapi/segment-video-body]', msg, e?.stack ?? e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'INTERNAL',
        message: msg || '智能抠像失败',
      }),
    };
  }
}
