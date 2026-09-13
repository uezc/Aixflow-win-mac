/**
 * RunningHub 双基址分流：.cn（国内）/ .ai（海外）
 * 按 path 前缀白名单选站；/query 靠 OTS rhreg:{taskId} 粘性。
 */

export const DEFAULT_RH_BASE_CN = 'https://www.runninghub.cn/openapi/v2';
export const DEFAULT_RH_BASE_AI = 'https://www.runninghub.ai/openapi/v2';

/**
 * 强制海外 path（不可被 RUNNINGHUB_OVERSEAS_PATH_PREFIXES 覆盖掉）。
 * 悠船 v8.1 官方仅海外站；若 env 白名单漏配会导致误走 .cn。
 */
export const ALWAYS_OVERSEAS_PATH_PREFIXES = [
  'youchuan/text-to-image-v81',
  'youchuan/text-to-image-v82',
  'rhart-image-g',
  'rhart-image-g-2',
  'rhart-image-g-2.5',
  'gemini-omni-flash',
  'rhart-video-g',
];

/** 默认迁出海外的 path 前缀（可用 RUNNINGHUB_OVERSEAS_PATH_PREFIXES 整表覆盖；ALWAYS_* 仍生效） */
export const DEFAULT_OVERSEAS_PATH_PREFIXES = [
  'rhart-video-v3.1-fast',
  'rhart-video-v3.1-pro',
  'rhart-video-v3.1-pro-official',
  'rhart-image-n-g31-flash',
  'rhart-image-g-2',
  'rhart-image-g-2.5',
  'rhart-image-g-2-official',
  'rhart-image-g',
  'youchuan/text-to-image-v81',
  'youchuan/text-to-image-v82',
  'rhart-video-g',
  'rhart-video-g-official',
  'rhart-audio/suno',
  'gemini-omni-flash',
  '/run/ai-app/2067153261005721602',
];

export const RH_REGION_TASK_PREFIX = 'rhreg:';

/** 进程内 taskId → region 快路径（冷启动靠 OTS） */
const rhRegionMemory = new Map();

/**
 * RunningHub OpenAPI 实际根路径为 .../openapi/v2。
 * 若仅配置站点根（如 https://www.runninghub.cn），自动补全 /openapi/v2。
 */
export function normalizeRunningHubApiBase(raw, fallback = DEFAULT_RH_BASE_CN) {
  const d = raw?.trim();
  if (!d) return fallback;
  const noSlash = d.replace(/\/$/, '');
  if (/\/openapi\/v2(\/|$)/i.test(noSlash)) return noSlash;
  return `${noSlash}/openapi/v2`;
}

export function normalizeRhPath(path) {
  const raw = String(path || '').trim().replace(/\?.*$/, '');
  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/** 拆出 path / query，normalizeRhPath 会丢掉 query */
export function splitRhPathAndQuery(path) {
  const raw = String(path || '').trim();
  const qIdx = raw.indexOf('?');
  if (qIdx < 0) return { pathOnly: raw, query: '' };
  return { pathOnly: raw.slice(0, qIdx), query: raw.slice(qIdx) };
}

/**
 * 组装 RunningHub 转发绝对 URL。
 * - 默认：{openapi/v2 base}{path}
 * - `/api/webapp/*`（如 apiCallDemo）：站点根路径，并注入 apiKey（勿把完整 URL 打进日志）
 */
export function buildRunningHubForwardUrl(path, rhTarget) {
  const { pathOnly, query } = splitRhPathAndQuery(path);
  const p = normalizeRhPath(pathOnly);
  if (p.startsWith('/api/webapp/')) {
    const site =
      rhTarget?.region === 'ai'
        ? 'https://www.runninghub.ai'
        : 'https://www.runninghub.cn';
    const u = new URL(`${site}${p}${query}`);
    const key = String(rhTarget?.apiKey || '').trim();
    if (key && !u.searchParams.get('apiKey')) u.searchParams.set('apiKey', key);
    return u.toString();
  }
  const base = (rhTarget?.base || DEFAULT_RH_BASE_CN).replace(/\/$/, '');
  return `${base}${p}${query}`;
}

export function getOverseasPathPrefixes() {
  const env = process.env.RUNNINGHUB_OVERSEAS_PATH_PREFIXES?.trim();
  if (env) {
    return env
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => {
        const t = s.replace(/^\/+/, '');
        return `/${t}`;
      });
  }
  return DEFAULT_OVERSEAS_PATH_PREFIXES.map((p) => (p.startsWith('/') ? p : `/${p}`));
}

function pathMatchesPrefixList(path, prefixes) {
  const p = normalizeRhPath(path);
  for (const pref of prefixes) {
    const n = pref.startsWith('/') ? pref : `/${pref}`;
    if (p === n || p.startsWith(`${n}/`) || p.startsWith(`${n}-`)) return true;
  }
  return false;
}

export function pathMatchesOverseasPrefix(path) {
  if (pathMatchesPrefixList(path, ALWAYS_OVERSEAS_PATH_PREFIXES.map((x) => (x.startsWith('/') ? x : `/${x}`)))) {
    return true;
  }
  return pathMatchesPrefixList(path, getOverseasPathPrefixes());
}

/** billingModelId / path 硬编码海外模型（防 env 白名单漏配） */
export function forceOverseasByBillingOrPath(path, billingModelId) {
  const bid = String(billingModelId || '').trim().toLowerCase();
  if (
    bid === 'youchuan-text-to-image-v81' ||
    bid === 'youchuan-text-to-image-v81-hd' ||
    bid === 'youchuan-text-to-image-v82' ||
    bid === 'youchuan-text-to-image-v82-hd' ||
    bid === 'rhart-image-g' ||
    bid === 'rhart-image-g-2' ||
    bid === 'rhart-image-g-2.5' ||
    bid === 'rhart-image-g-2-official' ||
    bid === 'gemini-omni-flash' ||
    bid.startsWith('gemini-omni-flash-') ||
    bid === 'grok-3' ||
    bid.startsWith('grok-3-') ||
    bid === 'rhart-video-x' ||
    bid.startsWith('rhart-video-x-') ||
    bid === 'rhart-v3.1-pro-se' ||
    bid.startsWith('rhart-v3.1-pro-se-') ||
    bid === 'rhart-v3.1-pro' ||
    bid === 'rhart-v3.1-fast' ||
    bid === 'rhart-v3.1-fast-se' ||
    bid === 'rhart-v3.1-pro-official-i2v'
  ) {
    return true;
  }
  const p = normalizeRhPath(path).toLowerCase();
  if (
    p.includes('youchuan/text-to-image-v81') ||
    p.endsWith('/text-to-image-v81') ||
    p.includes('youchuan/text-to-image-v82') ||
    p.endsWith('/text-to-image-v82')
  )
    return true;
  // 精确匹配 /rhart-image-g/...，避免误伤其它路径；前缀白名单另有 rhart-image-g
  if (p === '/rhart-image-g' || p.startsWith('/rhart-image-g/')) return true;
  if (p === '/rhart-image-g-2' || p.startsWith('/rhart-image-g-2/') || p.startsWith('/rhart-image-g-2-')) return true;
  if (p === '/rhart-image-g-2.5' || p.startsWith('/rhart-image-g-2.5/') || p.startsWith('/rhart-image-g-2.5-')) return true;
  if (p === '/gemini-omni-flash' || p.startsWith('/gemini-omni-flash/')) return true;
  if (p === '/rhart-video-g' || p.startsWith('/rhart-video-g/') || p.startsWith('/rhart-video-g-')) return true;
  if (p === '/rhart-video-v3.1-pro' || p.startsWith('/rhart-video-v3.1-pro/') || p.startsWith('/rhart-video-v3.1-pro-')) return true;
  if (p === '/rhart-video-v3.1-fast' || p.startsWith('/rhart-video-v3.1-fast/') || p.startsWith('/rhart-video-v3.1-fast-')) return true;
  return false;
}

export function isRhQueryPath(path) {
  const p = normalizeRhPath(path);
  return p === '/query' || p.endsWith('/query');
}

export function isRhMediaUploadPath(path) {
  const p = normalizeRhPath(path);
  return p === '/media/upload/binary' || p.startsWith('/media/upload/');
}

/**
 * @param {string} path
 * @param {{ regionHint?: string | null }} [opts]
 * @returns {{ region: 'cn' | 'ai', base: string, apiKey: string }}
 */
export function pickRunningHubTarget(path, opts = {}) {
  const hintRaw = opts.regionHint != null ? String(opts.regionHint).trim().toLowerCase() : '';
  let region;
  if (hintRaw === 'ai' || hintRaw === 'cn') {
    region = hintRaw;
  } else if (pathMatchesOverseasPrefix(path)) {
    region = 'ai';
  } else {
    region = 'cn';
  }

  if (region === 'ai') {
    const apiKey = process.env.RUNNINGHUB_API_KEY_AI?.trim() || '';
    // 海外站基址：禁止误配成 .cn；未配或配错时回退默认 .ai
    let base = normalizeRunningHubApiBase(process.env.RUNNINGHUB_API_BASE_AI, DEFAULT_RH_BASE_AI).replace(
      /\/$/,
      '',
    );
    if (/runninghub\.cn/i.test(base)) {
      console.warn('[RH] RUNNINGHUB_API_BASE_AI 指向 .cn，已强制改回 .ai');
      base = DEFAULT_RH_BASE_AI.replace(/\/$/, '');
    }
    return { region: 'ai', base, apiKey };
  }

  const apiKey =
    process.env.RUNNINGHUB_API_KEY?.trim() ||
    process.env.RUNNINGHUB_API_KEY_CN?.trim() ||
    '';
  const base = normalizeRunningHubApiBase(
    process.env.RUNNINGHUB_API_BASE || process.env.RUNNINGHUB_API_BASE_CN,
    DEFAULT_RH_BASE_CN,
  ).replace(/\/$/, '');
  return { region: 'cn', base, apiKey };
}

export function rememberRhTaskRegionMemory(rhTaskId, region) {
  const id = String(rhTaskId || '').trim();
  if (!id) return;
  if (region !== 'ai' && region !== 'cn') return;
  rhRegionMemory.set(id, region);
}

export function lookupRhTaskRegionMemory(rhTaskId) {
  const id = String(rhTaskId || '').trim();
  if (!id) return null;
  const r = rhRegionMemory.get(id);
  return r === 'ai' || r === 'cn' ? r : null;
}

export function extractRhTaskIdFromForwardData(data) {
  if (!data || typeof data !== 'object') return '';
  const top =
    (typeof data.taskId === 'string' && data.taskId.trim()) ||
    (typeof data.task_id === 'string' && data.task_id.trim()) ||
    '';
  if (top) return top;
  const inner = data.data;
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const nested =
      (typeof inner.taskId === 'string' && inner.taskId.trim()) ||
      (typeof inner.task_id === 'string' && inner.task_id.trim()) ||
      '';
    if (nested) return nested;
  }
  return '';
}

/**
 * 提交成功后写入 OTS rhreg:{taskId}，供后续 /query 同站粘性。
 */
export async function persistRhTaskRegion(dbModule, userId, rhTaskId, region) {
  const id = String(rhTaskId || '').trim();
  if (!id || (region !== 'ai' && region !== 'cn')) return;
  rememberRhTaskRegionMemory(id, region);
  if (!dbModule || typeof dbModule.upsertTask !== 'function' || !userId) return;
  try {
    await dbModule.upsertTask(`${RH_REGION_TASK_PREFIX}${id}`, userId, {
      status: 'success',
      prompt_json: JSON.stringify({ rhRegion: region }),
    });
  } catch (e) {
    console.warn('[RH] persistRhTaskRegion failed', e?.message || e);
  }
}

/**
 * /query 解析站点：forward.rhRegion → 内存 → OTS rhreg → null
 */
export async function resolveRhRegionForQuery(dbModule, userId, bodyObj, fwdRhRegion) {
  const hintRaw = fwdRhRegion != null ? String(fwdRhRegion).trim().toLowerCase() : '';
  if (hintRaw === 'ai' || hintRaw === 'cn') return hintRaw;

  const rhTaskId =
    (bodyObj && typeof bodyObj.taskId === 'string' && bodyObj.taskId.trim()) ||
    (bodyObj && typeof bodyObj.task_id === 'string' && bodyObj.task_id.trim()) ||
    '';
  if (!rhTaskId) return null;

  const mem = lookupRhTaskRegionMemory(rhTaskId);
  if (mem) return mem;

  if (!dbModule || typeof dbModule.getTaskRowForUser !== 'function' || !userId) return null;
  try {
    const row = await dbModule.getTaskRowForUser(`${RH_REGION_TASK_PREFIX}${rhTaskId}`, userId);
    if (!row?.prompt_json) return null;
    const j = typeof row.prompt_json === 'string' ? JSON.parse(row.prompt_json) : row.prompt_json;
    const r = j?.rhRegion != null ? String(j.rhRegion).trim().toLowerCase() : '';
    if (r === 'ai' || r === 'cn') {
      rememberRhTaskRegionMemory(rhTaskId, r);
      return r;
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

export function rhAuthErrorMessage(region) {
  if (region === 'ai') {
    return 'RUNNINGHUB_API_KEY_AI_NOT_CONFIGURED';
  }
  return 'RUNNINGHUB_API_KEY_NOT_CONFIGURED';
}
