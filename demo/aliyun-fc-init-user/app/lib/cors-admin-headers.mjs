/**
 * FC HTTP 响应统一 CORS（含管理后台 /api/admin/*）
 *
 * ADMIN_CORS_ORIGIN：逗号或换行分隔的多个 Origin（如开发 + 线上）。
 * 若请求头 Origin 与列表中某项完全一致，则回显该项；否则使用列表第一项。
 * 未配置时默认仅 http://localhost:5173。
 */

function getHeader(reqHeaders, name) {
  if (!reqHeaders || typeof reqHeaders !== 'object') return '';
  const lower = name.toLowerCase();
  for (const k of Object.keys(reqHeaders)) {
    if (k.toLowerCase() === lower) {
      const v = reqHeaders[k];
      return v == null ? '' : String(v).trim();
    }
  }
  return '';
}

function parseAllowedOrigins() {
  const raw = String(process.env.ADMIN_CORS_ORIGIN || '').trim();
  if (!raw) return ['http://localhost:5173'];
  const parts = raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : ['http://localhost:5173'];
}

/**
 * @param {Record<string, string | undefined> | undefined} reqHeaders 请求头（含 Origin 时按白名单回显）
 */
export function getCorsHeaders(reqHeaders) {
  const allowed = parseAllowedOrigins();
  let origin = allowed[0] || 'http://localhost:5173';
  const clientOrigin = getHeader(reqHeaders, 'origin');
  if (clientOrigin && allowed.includes(clientOrigin)) {
    origin = clientOrigin;
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    Vary: 'Origin',
  };
}

export function mergeAdminCors(extra = {}, reqHeaders) {
  return { ...getCorsHeaders(reqHeaders), ...extra };
}

export function adminCorsJsonHeaders(reqHeaders) {
  return mergeAdminCors({ 'Content-Type': 'application/json' }, reqHeaders);
}

/** 与历史代码兼容 */
export function adminCorsHeaders(reqHeaders) {
  return getCorsHeaders(reqHeaders);
}
