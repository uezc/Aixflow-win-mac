/**
 * 百炼 / DashScope 异步录音文件识别（fun-asr）。
 * 密钥仅存 FC 环境变量 DASHSCOPE_API_KEY，不下发客户端。
 *
 * 文档：https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-http-api
 * 提交：POST .../api/v1/services/audio/asr/transcription + X-DashScope-Async: enable
 * 查询：GET .../api/v1/tasks/{task_id} → transcription_url → 下载 JSON
 */

const DEFAULT_SUBMIT_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
const DEFAULT_TASK_BASE = 'https://dashscope.aliyuncs.com/api/v1/tasks';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveApiBase() {
  const workspaceId = String(process.env.DASHSCOPE_WORKSPACE_ID || '').trim();
  const customSubmit = String(process.env.DASHSCOPE_ASR_FILE_SUBMIT_URL || '').trim();
  const customTaskBase = String(process.env.DASHSCOPE_ASR_FILE_TASK_BASE || '').trim();
  if (customSubmit && customTaskBase) {
    return { submitUrl: customSubmit, taskBase: customTaskBase.replace(/\/$/, '') };
  }
  if (workspaceId) {
    const host = `https://${workspaceId}.cn-beijing.maas.aliyuncs.com`;
    return {
      submitUrl: `${host}/api/v1/services/audio/asr/transcription`,
      taskBase: `${host}/api/v1/tasks`,
    };
  }
  return { submitUrl: DEFAULT_SUBMIT_URL, taskBase: DEFAULT_TASK_BASE };
}

/**
 * 将 DashScope transcription JSON 归一化为客户端契约。
 * @param {unknown} json
 * @returns {{ text: string; segments: Array<{ text: string; startSec: number; endSec: number }> }}
 */
export function normalizeTranscriptionResult(json) {
  const root = json && typeof json === 'object' ? /** @type {Record<string, unknown>} */ (json) : {};
  const transcripts = Array.isArray(root.transcripts) ? root.transcripts : [];
  /** @type {Array<{ text: string; startSec: number; endSec: number }>} */
  const segments = [];
  const fullParts = [];

  for (const t of transcripts) {
    if (!t || typeof t !== 'object') continue;
    const tr = /** @type {Record<string, unknown>} */ (t);
    const channelText = String(tr.text || '').trim();
    if (channelText) fullParts.push(channelText);
    const sentences = Array.isArray(tr.sentences) ? tr.sentences : [];
    for (const s of sentences) {
      if (!s || typeof s !== 'object') continue;
      const sent = /** @type {Record<string, unknown>} */ (s);
      const text = String(sent.text || '').trim();
      if (!text) continue;
      const beginMs = Number(sent.begin_time);
      const endMs = Number(sent.end_time);
      segments.push({
        text,
        startSec: Number.isFinite(beginMs) ? beginMs / 1000 : 0,
        endSec: Number.isFinite(endMs) ? endMs / 1000 : 0,
      });
    }
  }

  let text = fullParts.join('\n').trim();
  if (!text && segments.length > 0) {
    text = segments.map((s) => s.text).join('\n');
  }
  return { text, segments };
}

/**
 * @param {{ userId: string; headers: Record<string, string>; body: Record<string, unknown> }} opts
 */
export async function handleAsrFileTranscribe(opts) {
  const { userId, headers, body } = opts;
  const apiKey = String(process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: 'DASHSCOPE_ASR_NOT_CONFIGURED',
        message: '云端未配置 DASHSCOPE_API_KEY，无法使用录音文件识别',
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

  const fileUrl = String(body?.fileUrl ?? body?.file_url ?? '').trim();
  if (!fileUrl || !/^https?:\/\//i.test(fileUrl)) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: 'FILE_URL_REQUIRED',
        message: '请提供公网可访问的 fileUrl（http/https）',
      }),
    };
  }

  const languageRaw = String(body?.language ?? '').trim().toLowerCase();
  /** @type {string[] | undefined} */
  let languageHints;
  if (languageRaw && languageRaw !== 'auto') {
    const hint = languageRaw === 'zh-cn' || languageRaw === 'zh_cn' ? 'zh' : languageRaw;
    languageHints = [hint];
  } else {
    languageHints = ['zh', 'en'];
  }

  // 稳定版异步模型；可用 DASHSCOPE_ASR_FILE_MODEL 钉死 fun-asr-2025-11-07
  const model =
    String(process.env.DASHSCOPE_ASR_FILE_MODEL || '').trim() || 'fun-asr';
  const { submitUrl, taskBase } = resolveApiBase();
  const authHeader = `Bearer ${apiKey}`;

  const pollIntervalMs = Math.min(
    10000,
    Math.max(1500, Number(process.env.DASHSCOPE_ASR_FILE_POLL_MS || 2500) || 2500),
  );
  const maxWaitMs = Math.min(
    15 * 60 * 1000,
    Math.max(60_000, Number(process.env.DASHSCOPE_ASR_FILE_MAX_WAIT_MS || 600_000) || 600_000),
  );

  try {
    const submitRes = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify({
        model,
        input: { file_urls: [fileUrl] },
        parameters: {
          channel_id: [0],
          language_hints: languageHints,
        },
      }),
    });
    const submitJson = await submitRes.json().catch(() => ({}));
    if (!submitRes.ok) {
      const msg =
        String(submitJson?.message || submitJson?.code || '').trim() ||
        `提交转写任务失败（HTTP ${submitRes.status}）`;
      console.error('[asr/file-transcribe] submit failed', submitRes.status, submitJson);
      return {
        statusCode: submitRes.status >= 400 && submitRes.status < 600 ? submitRes.status : 502,
        headers,
        body: JSON.stringify({
          error: String(submitJson?.code || 'SUBMIT_FAILED'),
          message: msg,
        }),
      };
    }

    const taskId = String(submitJson?.output?.task_id || '').trim();
    if (!taskId) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'NO_TASK_ID',
          message: '百炼未返回 task_id',
        }),
      };
    }

    const t0 = Date.now();
    let lastStatus = '';
    /** @type {Record<string, unknown> | null} */
    let taskOutput = null;

    while (Date.now() - t0 < maxWaitMs) {
      await sleep(pollIntervalMs);
      const qRes = await fetch(`${taskBase}/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: { Authorization: authHeader },
      });
      const qJson = await qRes.json().catch(() => ({}));
      if (!qRes.ok) {
        const msg =
          String(qJson?.message || qJson?.code || '').trim() ||
          `查询转写任务失败（HTTP ${qRes.status}）`;
        console.error('[asr/file-transcribe] query failed', qRes.status, qJson);
        return {
          statusCode: qRes.status >= 400 && qRes.status < 600 ? qRes.status : 502,
          headers,
          body: JSON.stringify({
            error: String(qJson?.code || 'QUERY_FAILED'),
            message: msg,
          }),
        };
      }

      taskOutput = (qJson?.output && typeof qJson.output === 'object' ? qJson.output : null) || null;
      lastStatus = String(taskOutput?.task_status || '').toUpperCase();
      if (lastStatus === 'SUCCEEDED' || lastStatus === 'FAILED' || lastStatus === 'UNKNOWN') {
        break;
      }
    }

    if (lastStatus !== 'SUCCEEDED') {
      if (!lastStatus || lastStatus === 'PENDING' || lastStatus === 'RUNNING') {
        return {
          statusCode: 504,
          headers,
          body: JSON.stringify({
            error: 'TIMEOUT',
            message: '录音文件识别超时，请稍后重试或缩短音频时长',
            taskId,
            taskStatus: lastStatus || 'PENDING',
          }),
        };
      }
      const failMsg =
        String(taskOutput?.message || taskOutput?.code || '').trim() ||
        `转写任务失败（${lastStatus}）`;
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: String(taskOutput?.code || 'TASK_FAILED'),
          message: failMsg,
          taskId,
          taskStatus: lastStatus,
        }),
      };
    }

    const results = Array.isArray(taskOutput?.results) ? taskOutput.results : [];
    const first = results.find((r) => r && typeof r === 'object') || null;
    const transcriptionUrl = String(
      (first && /** @type {Record<string, unknown>} */ (first).transcription_url) ||
        taskOutput?.transcription_url ||
        '',
    ).trim();
    if (!transcriptionUrl) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'NO_TRANSCRIPTION_URL',
          message: '任务成功但未返回 transcription_url',
          taskId,
        }),
      };
    }

    const subStatus = String(
      (first && /** @type {Record<string, unknown>} */ (first).subtask_status) || '',
    ).toUpperCase();
    if (subStatus && subStatus !== 'SUCCEEDED') {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'SUBTASK_FAILED',
          message: `子任务状态异常：${subStatus}`,
          taskId,
        }),
      };
    }

    const dlRes = await fetch(transcriptionUrl, { method: 'GET' });
    if (!dlRes.ok) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'DOWNLOAD_FAILED',
          message: `下载识别结果失败（HTTP ${dlRes.status}）`,
          taskId,
        }),
      };
    }
    const transcriptionJson = await dlRes.json().catch(() => null);
    if (!transcriptionJson) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'INVALID_RESULT',
          message: '识别结果不是合法 JSON',
          taskId,
        }),
      };
    }

    const normalized = normalizeTranscriptionResult(transcriptionJson);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        text: normalized.text,
        segments: normalized.segments,
        model,
        taskId,
        userId,
      }),
    };
  } catch (e) {
    const msg = e?.message || String(e);
    console.error('[asr/file-transcribe]', msg, e?.stack ?? e);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'INTERNAL',
        message: msg || '录音文件识别失败',
      }),
    };
  }
}
