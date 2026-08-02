/**
 * 【可选遗留】企业微信 HTTP 服务（Webhook / 客户群回调）
 *
 * 个人微信社群请优先使用桌面 RPA：wechat_rpa.py（见 WECHAT_RPA.md）。
 * 本文件不作为主路径；仅在企业微信场景需要时启用。
 *
 * 能力：
 * 1) 企业微信「群机器人 Webhook」发欢迎/分流回复（WECOM_WEBHOOK_KEY）
 * 2) 企业微信「客户群」进群回调 change_external_chat / add_member（可选加解密）
 * 3) 通用钩子：
 *    POST /hooks/join    { userId, displayName?, chatId? }
 *    POST /hooks/message { userId, displayName?, text, chatId? }
 *
 * 环境变量见 .env.example
 *
 * 运行：
 *   cd community-bot
 *   npm run wechat-api
 */
import http from 'http';
import { URL } from 'url';
import {
  handleCommunityEvent,
  getStorePath,
} from './core.mjs';
import {
  decryptWecomMessage,
  encryptWecomMessage,
  sha1Sign,
  xmlGet,
  xmlGetAll,
} from './wecom-crypto.mjs';

const PORT = Number(process.env.WECHAT_BOT_PORT || process.env.PORT || 8787);
const WEBHOOK_KEY = String(process.env.WECOM_WEBHOOK_KEY || '').trim();
const WECOM_TOKEN = String(process.env.WECOM_TOKEN || '').trim();
const WECOM_AES_KEY = String(process.env.WECOM_ENCODING_AES_KEY || '').trim();
const WECOM_CORP_ID = String(process.env.WECOM_CORP_ID || '').trim();
const HOOK_SECRET = String(process.env.WECHAT_HOOK_SECRET || '').trim();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, code, text) {
  const body = String(text ?? '');
  res.writeHead(code, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function checkHookAuth(req) {
  if (!HOOK_SECRET) return true;
  const h = String(req.headers['x-aixflow-hook-secret'] || '').trim();
  return h === HOOK_SECRET;
}

/** 企业微信群机器人发 markdown / text */
async function sendWebhookMarkdown(content) {
  if (!WEBHOOK_KEY) {
    console.warn('[wechat-bot] 未配置 WECOM_WEBHOOK_KEY，仅记录知识库、不发群消息');
    return { skipped: true };
  }
  const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(WEBHOOK_KEY)}`;
  const text = String(content || '').slice(0, 4000);
  const payload = {
    msgtype: 'markdown',
    markdown: { content: text },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (data.errcode && data.errcode !== 0) {
    // markdown 失败时回退 text
    const r2 = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
    });
    return r2.json().catch(() => ({}));
  }
  return data;
}

async function replyMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (const msg of list) {
    const content = String(msg || '');
    await sendWebhookMarkdown(content);
  }
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return null;
  }
}

async function handleJoin(body) {
  const userId = String(body.userId || body.userid || body.UserId || '').trim();
  const displayName = String(body.displayName || body.name || body.Name || userId || '新朋友').trim();
  const chatId = String(body.chatId || body.ChatId || '').trim();
  if (!userId) return { ok: false, error: 'userId required' };
  const result = await handleCommunityEvent({
    userId,
    displayName,
    guildId: chatId || undefined,
    isNewJoin: true,
  });
  await replyMessages(result.messages);
  return { ok: true, kind: result.kind, messages: result.messages };
}

async function handleMessage(body) {
  const userId = String(body.userId || body.userid || body.FromUserName || '').trim();
  const displayName = String(body.displayName || body.name || userId || '朋友').trim();
  const text = String(body.text || body.Content || body.content || '').trim();
  const chatId = String(body.chatId || body.ChatId || '').trim();
  if (!userId) return { ok: false, error: 'userId required' };
  if (!text) return { ok: true, kind: 'noop', messages: [] };
  const result = await handleCommunityEvent({
    userId,
    displayName,
    guildId: chatId || undefined,
    text,
    isNewJoin: false,
  });
  if (result.messages?.length) await replyMessages(result.messages);
  return { ok: true, kind: result.kind, intent: result.intent, messages: result.messages };
}

function verifyWecomUrl(query) {
  const { msg_signature, timestamp, nonce, echostr } = query;
  if (!WECOM_TOKEN || !WECOM_AES_KEY || !WECOM_CORP_ID) {
    throw new Error('缺少 WECOM_TOKEN / WECOM_ENCODING_AES_KEY / WECOM_CORP_ID');
  }
  const sign = sha1Sign(WECOM_TOKEN, timestamp, nonce, echostr);
  if (sign !== msg_signature) throw new Error('invalid signature');
  return decryptWecomMessage(WECOM_AES_KEY, WECOM_CORP_ID, echostr);
}

async function handleWecomCallbackPost(query, rawBody) {
  if (!WECOM_TOKEN || !WECOM_AES_KEY || !WECOM_CORP_ID) {
    return 'success';
  }
  let xml = rawBody;
  const encrypt = xmlGet(rawBody, 'Encrypt');
  if (encrypt) {
    const sign = sha1Sign(WECOM_TOKEN, query.timestamp, query.nonce, encrypt);
    if (sign !== query.msg_signature) throw new Error('invalid signature');
    xml = decryptWecomMessage(WECOM_AES_KEY, WECOM_CORP_ID, encrypt);
  }

  const msgType = xmlGet(xml, 'MsgType');
  const event = xmlGet(xml, 'Event');
  const changeType = xmlGet(xml, 'ChangeType');
  const updateDetail = xmlGet(xml, 'UpdateDetail');
  const chatId = xmlGet(xml, 'ChatId');

  // 客户群：有人进群
  if (msgType === 'event' && event === 'change_external_chat' && changeType === 'update' && updateDetail === 'add_member') {
    const members = xmlGetAll(xml, 'Item');
    setImmediate(async () => {
      for (const uid of members) {
        try {
          await handleJoin({ userId: uid, displayName: uid, chatId });
        } catch (e) {
          console.error('[wechat-bot] join handle failed', uid, e?.message || e);
        }
      }
    });
    return 'success';
  }

  // 应用消息：用户发文本（若开通了应用会话）
  if (msgType === 'text') {
    const from = xmlGet(xml, 'FromUserName');
    const content = xmlGet(xml, 'Content');
    setImmediate(async () => {
      try {
        await handleMessage({ userId: from, displayName: from, text: content, chatId });
      } catch (e) {
        console.error('[wechat-bot] message handle failed', e?.message || e);
      }
    });
    // 被动回复（可选）：加密空包或 success；主动发群用 webhook
    return 'success';
  }

  return 'success';
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const path = u.pathname;

    if (req.method === 'GET' && (path === '/' || path === '/health')) {
      return sendJson(res, 200, {
        ok: true,
        service: 'aixflow-wechat-community-bot',
        store: getStorePath(),
        webhookConfigured: !!WEBHOOK_KEY,
        wecomCallbackConfigured: !!(WECOM_TOKEN && WECOM_AES_KEY && WECOM_CORP_ID),
      });
    }

    // 企业微信 URL 验证
    if (req.method === 'GET' && path === '/wecom/callback') {
      const echo = verifyWecomUrl(Object.fromEntries(u.searchParams));
      return sendText(res, 200, echo);
    }

    if (req.method === 'POST' && path === '/wecom/callback') {
      const raw = await readBody(req);
      const out = await handleWecomCallbackPost(Object.fromEntries(u.searchParams), raw);
      return sendText(res, 200, out);
    }

    if (req.method === 'POST' && path === '/hooks/join') {
      if (!checkHookAuth(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const body = parseJsonSafe(await readBody(req));
      if (!body) return sendJson(res, 400, { ok: false, error: 'invalid json' });
      const result = await handleJoin(body);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    if (req.method === 'POST' && path === '/hooks/message') {
      if (!checkHookAuth(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const body = parseJsonSafe(await readBody(req));
      if (!body) return sendJson(res, 400, { ok: false, error: 'invalid json' });
      const result = await handleMessage(body);
      return sendJson(res, result.ok ? 200 : 400, result);
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    console.error('[wechat-bot]', err?.message || err);
    sendJson(res, 500, { ok: false, error: String(err?.message || err) });
  }
});

server.listen(PORT, () => {
  console.log(`[wechat-bot] 监听 http://0.0.0.0:${PORT}`);
  console.log(`[wechat-bot] 健康检查 GET /health`);
  console.log(`[wechat-bot] 进群钩子   POST /hooks/join`);
  console.log(`[wechat-bot] 消息钩子   POST /hooks/message`);
  console.log(`[wechat-bot] 企微回调   GET/POST /wecom/callback`);
  console.log(`[wechat-bot] 知识库     ${getStorePath()}`);
  if (!WEBHOOK_KEY) console.warn('[wechat-bot] 提示：配置 WECOM_WEBHOOK_KEY 后才会往群里发消息');
});
