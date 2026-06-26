/**
 * Aixflow 官网：管理员上传素材与更新 showcase.json（OSS）
 * 环境：OSS_REGION, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET
 * 香港部署：FC 与 Bucket 同地域时设 OSS_USE_INTERNAL=1，SDK 使用内网
 * https://oss-cn-hongkong-internal.aliyuncs.com（由 OSS_REGION=oss-cn-hongkong 推导，见 lib/oss-sdk-options.mjs）。
 * 可选：OSS_ENDPOINT 覆盖内网地址；OSS_PUBLIC_BASE_URL（回写前端用的公网前缀）、
 * OSS_SHOWCASE_JSON、ADMIN_CORS_ORIGIN（见 cors-admin-headers.mjs）
 */
import crypto from 'crypto';
import { adminCorsJsonHeaders } from './cors-admin-headers.mjs';
import { createOssClientInstance, readAdminPass } from './oss-sdk-options.mjs';

const SHOWCASE_KEY = process.env.OSS_SHOWCASE_JSON || 'data/showcase.json';

const TYPE_PREFIX = {
  image: 'image/',
  video: 'video/',
  music: 'music/',
  workflow: 'workflow/',
};

function getHeader(h, name) {
  const lower = name.toLowerCase();
  for (const k of Object.keys(h || {})) {
    if (k.toLowerCase() === lower) return h[k];
  }
  return undefined;
}

/**
 * 返回浏览器可访问的公网对象 URL（与 SDK 是否走内网传输无关）
 */
function buildPublicObjectUrl(objectKey) {
  const key = String(objectKey || '').replace(/^\/+/, '');
  const base = process.env.OSS_PUBLIC_BASE_URL?.replace(/\/$/, '').trim();
  if (base) return `${base}/${key}`;
  const bucket = process.env.OSS_BUCKET?.trim();
  const reg = (process.env.OSS_REGION || 'oss-cn-hongkong').trim();
  if (!bucket || !reg) return '';
  return `https://${bucket}.${reg}.aliyuncs.com/${key}`;
}

function getOssClient() {
  try {
    return createOssClientInstance(process.env);
  } catch (e) {
    const m = e?.message || '';
    if (m === 'OSS_NOT_CONFIGURED' || String(m).includes('accessKeyId')) {
      throw new Error('OSS_NOT_CONFIGURED');
    }
    throw e;
  }
}

function safeBasename(name) {
  const base = String(name || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .pop();
  const s = base.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
  return s || 'file';
}

function guessMime(filename) {
  const f = filename.toLowerCase();
  if (f.endsWith('.png')) return 'image/png';
  if (f.endsWith('.jpg') || f.endsWith('.jpeg')) return 'image/jpeg';
  if (f.endsWith('.webp')) return 'image/webp';
  if (f.endsWith('.gif')) return 'image/gif';
  if (f.endsWith('.mp4')) return 'video/mp4';
  if (f.endsWith('.webm')) return 'video/webm';
  if (f.endsWith('.mov')) return 'video/quicktime';
  if (f.endsWith('.mp3')) return 'audio/mpeg';
  if (f.endsWith('.wav')) return 'audio/wav';
  if (f.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

/**
 * POST /api/admin/upload-file
 * Body JSON: { type: 'image'|'video'|'music'|'workflow', filename: string, fileBase64: string }
 */
export async function handleAdminUploadFile(body, reqHeaders) {
  const jsonHeaders = adminCorsJsonHeaders(reqHeaders);
  const type = String(body?.type || '').toLowerCase();
  const prefix = TYPE_PREFIX[type];
  if (!prefix) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'INVALID_TYPE', message: 'type 须为 image | video | music | workflow' }),
    };
  }
  const filename = safeBasename(body?.filename || body?.fileName || 'file.bin');
  const b64 = body?.fileBase64 ?? body?.file_base64;
  if (typeof b64 !== 'string' || !b64.trim()) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'MISSING_FILE', message: 'fileBase64 必填' }),
    };
  }
  let buf;
  try {
    buf = Buffer.from(String(b64).replace(/\s/g, ''), 'base64');
  } catch {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'INVALID_BASE64' }),
    };
  }
  if (!buf.length) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'EMPTY_FILE' }),
    };
  }

  const client = getOssClient();
  const key = `${prefix}${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${filename}`;
  const mime = guessMime(filename);
  await client.put(key, buf, {
    headers: { 'Content-Type': mime },
  });
  const url = buildPublicObjectUrl(key);
  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({ url, key, mime }),
  };
}

function defaultShowcase() {
  return { image: [], video: [], music: [], workflow: [] };
}

async function loadShowcaseData(client) {
  const empty = defaultShowcase();
  try {
    const res = await client.get(SHOWCASE_KEY);
    const text = (res.content && res.content.toString()) || '{}';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return empty;
    }
    if (Array.isArray(parsed)) {
      return empty;
    }
    if (parsed && typeof parsed === 'object') {
      const data = { ...empty, ...parsed };
      for (const k of ['image', 'video', 'music', 'workflow']) {
        if (!Array.isArray(data[k])) data[k] = [];
      }
      return data;
    }
  } catch (e) {
    const code = e?.code;
    const status = e?.status;
    if (code === 'NoSuchKey' || status === 404) return empty;
    throw e;
  }
  return empty;
}

async function saveShowcaseData(client, data) {
  await client.put(SHOWCASE_KEY, Buffer.from(JSON.stringify(data, null, 2), 'utf8'), {
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * 从公网对象 URL 解析 OSS object key（与 SDK 走内网无关）
 */
function extractObjectKeyFromPublicUrl(href) {
  try {
    const u = new URL(String(href).trim());
    let path = u.pathname.replace(/^\/+/, '');
    const pb = process.env.OSS_PUBLIC_BASE_URL?.replace(/\/$/, '').trim();
    if (pb) {
      try {
        const pbUrl = new URL(pb.startsWith('http') ? pb : `https://${pb}`);
        if (u.hostname === pbUrl.hostname) {
          const pbp = pbUrl.pathname.replace(/\/$/, '').replace(/^\/+/, '');
          if (pbp && path.startsWith(`${pbp}/`)) path = path.slice(pbp.length + 1);
          else if (pbp === path) path = '';
        }
      } catch {
        /* ignore */
      }
    }
    if (/\.aliyuncs\.com$/i.test(u.hostname)) return path || null;
    return path || null;
  } catch {
    return null;
  }
}

function collectObjectKeysFromEntry(entry) {
  const set = new Set();
  for (const k of ['url', 'cover', 'download']) {
    const v = entry?.[k];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
      const key = extractObjectKeyFromPublicUrl(v);
      if (key) set.add(key);
    }
  }
  return [...set];
}

/** 从 showcase 全量收集已出现在 JSON 中的 object key（用于与 OSS list 比对） */
function collectAllIndexedKeysFromShowcase(data) {
  const set = new Set();
  for (const cat of ['image', 'video', 'music', 'workflow']) {
    const arr = data?.[cat];
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      for (const key of collectObjectKeysFromEntry(entry)) {
        set.add(key);
      }
    }
  }
  return set;
}

/**
 * 分页列举某前缀下全部对象 key（不含「目录占位」）
 */
async function listAllObjectKeysUnderPrefix(client, prefix) {
  const keys = [];
  let marker;
  for (;;) {
    const res = await client.list({
      prefix,
      marker,
      'max-keys': 1000,
    });
    const objects = res.objects || [];
    for (const o of objects) {
      const name = o.name;
      if (!name || name.endsWith('/')) continue;
      keys.push(name);
    }
    if (!res.isTruncated) break;
    marker = res.nextMarker || res.nextContinuationToken;
    if (!marker) break;
  }
  return keys;
}

function parseCategoryIndex(body) {
  const category = String(body?.category || '').toLowerCase();
  if (!['image', 'video', 'music', 'workflow'].includes(category)) return { error: 'INVALID_CATEGORY' };
  const id = body?.id != null ? String(body.id).trim() : '';
  let index = NaN;
  if (body?.index != null && body?.index !== '') {
    index = Number(body.index);
    if (!Number.isFinite(index)) return { error: 'INVALID_INDEX' };
  }
  return { category, id, index };
}

function resolveEntryIndex(arr, id, index) {
  if (id) {
    const idx = arr.findIndex((e) => e && String(e.id || '') === id);
    return idx;
  }
  if (Number.isFinite(index) && index >= 0 && index < arr.length) return index;
  return -1;
}

/**
 * POST /api/admin/update-json
 * Body: { category: 'image'|'video'|'music'|'workflow', entry: { title, url, cover, download } }
 */
export async function handleAdminUpdateShowcaseJson(body, reqHeaders) {
  const jsonHeaders = adminCorsJsonHeaders(reqHeaders);
  const category = String(body?.category || '').toLowerCase();
  if (!['image', 'video', 'music', 'workflow'].includes(category)) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'INVALID_CATEGORY' }),
    };
  }
  const entry = body?.entry && typeof body.entry === 'object' ? body.entry : {};
  const title = String(entry.title || '').trim();
  const url = String(entry.url || '').trim();
  const cover = String(entry.cover || '').trim();
  const download = String(entry.download || '').trim();
  if (!title || !url || !cover || !download) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'INVALID_ENTRY', message: 'title, url, cover, download 均须为非空字符串' }),
    };
  }

  const client = getOssClient();
  const data = await loadShowcaseData(client);

  const row = {
    id: crypto.randomUUID(),
    title,
    url,
    cover,
    download,
    addedAt: new Date().toISOString(),
  };
  data[category].push(row);

  await saveShowcaseData(client, data);

  const showcaseUrl = buildPublicObjectUrl(SHOWCASE_KEY);

  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({ ok: true, showcaseKey: SHOWCASE_KEY, showcaseUrl, count: data[category].length, id: row.id }),
  };
}

/**
 * POST /api/admin/delete-item
 * Body: { category, id? } 或 { category, index? } — 旧数据无 id 时用 index
 */
export async function handleAdminDeleteItem(body, reqHeaders) {
  const jsonHeaders = adminCorsJsonHeaders(reqHeaders);
  const parsed = parseCategoryIndex(body);
  if (parsed.error) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: parsed.error }),
    };
  }
  const { category, id, index } = parsed;
  const client = getOssClient();
  const data = await loadShowcaseData(client);
  const arr = data[category];
  const idx = resolveEntryIndex(arr, id, index);
  if (idx < 0) {
    return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: 'NOT_FOUND' }) };
  }
  const removed = arr[idx];
  arr.splice(idx, 1);
  const keys = collectObjectKeysFromEntry(removed);
  for (const key of keys) {
    try {
      await client.delete(key);
    } catch (e) {
      if (e?.code !== 'NoSuchKey') throw e;
    }
  }
  await saveShowcaseData(client, data);
  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({ ok: true, deletedKeys: keys, showcaseKey: SHOWCASE_KEY }),
  };
}

/**
 * POST /api/admin/update-title
 * Body: { category, title, id? | index? }
 */
export async function handleAdminUpdateTitle(body, reqHeaders) {
  const jsonHeaders = adminCorsJsonHeaders(reqHeaders);
  const parsed = parseCategoryIndex(body);
  if (parsed.error) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: parsed.error }),
    };
  }
  const { category, id, index } = parsed;
  const title = String(body?.title ?? '').trim();
  if (!title) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'INVALID_TITLE' }),
    };
  }
  const client = getOssClient();
  const data = await loadShowcaseData(client);
  const arr = data[category];
  const idx = resolveEntryIndex(arr, id, index);
  if (idx < 0) {
    return { statusCode: 404, headers: jsonHeaders, body: JSON.stringify({ error: 'NOT_FOUND' }) };
  }
  arr[idx].title = title;
  await saveShowcaseData(client, data);
  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({ ok: true, showcaseKey: SHOWCASE_KEY }),
  };
}

/**
 * POST /api/admin/get-showcase
 * Body: {} — 返回当前 showcase 全文（供管理端列表）
 */
export async function handleAdminGetShowcase(body, reqHeaders) {
  const jsonHeaders = adminCorsJsonHeaders(reqHeaders);
  const client = getOssClient();
  const data = await loadShowcaseData(client);
  const showcaseUrl = buildPublicObjectUrl(SHOWCASE_KEY);
  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({ ok: true, data, showcaseKey: SHOWCASE_KEY, showcaseUrl }),
  };
}

/**
 * POST /api/admin/scan-oss-stock
 * 列举 image/、video/、music/、workflow/ 下物理文件，与 data/showcase.json 比对入库状态。
 */
export async function handleAdminScanOssStock(body, reqHeaders) {
  const jsonHeaders = adminCorsJsonHeaders(reqHeaders);
  const client = getOssClient();
  const data = await loadShowcaseData(client);
  const indexedSet = collectAllIndexedKeysFromShowcase(data);

  const byCategory = {};
  const scannedKeys = new Set();
  let totalFiles = 0;
  let inShowcaseCount = 0;
  let orphanCount = 0;

  for (const [cat, prefix] of Object.entries(TYPE_PREFIX)) {
    const keys = await listAllObjectKeysUnderPrefix(client, prefix);
    const items = [];
    let catIn = 0;
    let catOrphan = 0;
    for (const key of keys) {
      scannedKeys.add(key);
      const inShowcase = indexedSet.has(key);
      if (inShowcase) {
        catIn += 1;
        inShowcaseCount += 1;
      } else {
        catOrphan += 1;
        orphanCount += 1;
      }
      totalFiles += 1;
      const publicUrl = buildPublicObjectUrl(key);
      items.push({
        key,
        category: cat,
        publicUrl,
        inShowcase,
        status: inShowcase ? 'indexed' : 'orphan',
        labelZh: inShowcase ? '已入库' : 'OSS 存量（未发布）',
      });
    }
    items.sort((a, b) => a.key.localeCompare(b.key));
    byCategory[cat] = {
      prefix,
      total: keys.length,
      inShowcase: catIn,
      orphan: catOrphan,
      items,
    };
  }

  const materialPrefixes = ['image/', 'video/', 'music/', 'workflow/'];
  const staleReferences = [...indexedSet].filter((k) => {
    if (!materialPrefixes.some((p) => k.startsWith(p))) return false;
    return !scannedKeys.has(k);
  });
  staleReferences.sort();

  const showcaseUrl = buildPublicObjectUrl(SHOWCASE_KEY);

  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({
      ok: true,
      showcaseKey: SHOWCASE_KEY,
      showcaseUrl,
      summary: {
        totalFiles,
        inShowcase: inShowcaseCount,
        orphan: orphanCount,
        staleReferenceCount: staleReferences.length,
      },
      byCategory,
      staleReferences: staleReferences.map((key) => ({ key, publicUrl: buildPublicObjectUrl(key) })),
    }),
  };
}

/**
 * @param {{ pathNorm: string, httpMethod: string, reqHeaders: Record<string, string>, body: object }} args
 * @returns {Promise<object | null>} FC HTTP 响应；非 admin 路由返回 null
 */
export async function handleAixflowAdminRequest(args) {
  const { pathNorm, httpMethod, reqHeaders, body } = args;
  const hitUpload = pathNorm.includes('/api/admin/upload-file');
  const hitUpdate = pathNorm.includes('/api/admin/update-json');
  const hitDelete = pathNorm.includes('/api/admin/delete-item');
  const hitTitle = pathNorm.includes('/api/admin/update-title');
  const hitGet = pathNorm.includes('/api/admin/get-showcase');
  const hitScan = pathNorm.includes('/api/admin/scan-oss-stock');
  if (!hitUpload && !hitUpdate && !hitDelete && !hitTitle && !hitGet && !hitScan) return null;

  const jsonHeaders = adminCorsJsonHeaders(reqHeaders);
  const pass = readAdminPass(process.env);
  if (!pass) {
    return {
      statusCode: 503,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: 'ADMIN_NOT_CONFIGURED',
        message: '请配置环境变量 ADMIN_PASS',
      }),
    };
  }
  const admin = getHeader(reqHeaders, 'x-admin-password');
  if (admin !== pass) {
    return { statusCode: 401, headers: jsonHeaders, body: JSON.stringify({ error: 'UNAUTHORIZED' }) };
  }
  if (httpMethod !== 'POST') {
    return { statusCode: 405, headers: jsonHeaders, body: JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }) };
  }

  try {
    if (hitUpload) return await handleAdminUploadFile(body, reqHeaders);
    if (hitUpdate) return await handleAdminUpdateShowcaseJson(body, reqHeaders);
    if (hitDelete) return await handleAdminDeleteItem(body, reqHeaders);
    if (hitTitle) return await handleAdminUpdateTitle(body, reqHeaders);
    if (hitGet) return await handleAdminGetShowcase(body, reqHeaders);
    if (hitScan) return await handleAdminScanOssStock(body, reqHeaders);
  } catch (e) {
    const msg = e?.message || 'INTERNAL';
    const code = msg === 'OSS_NOT_CONFIGURED' ? 503 : 500;
    return {
      statusCode: code,
      headers: jsonHeaders,
      body: JSON.stringify({ error: msg }),
    };
  }
  return null;
}
