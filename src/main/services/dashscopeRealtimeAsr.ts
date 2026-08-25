/**
 * 阿里云百炼实时 ASR（打字/听写）：主进程持有票据并连 DashScope WebSocket，
 * 渲染进程仅通过 IPC 上下行 PCM / 文本，不接触 DASHSCOPE_API_KEY。
 *
 * 默认模型 fun-asr-realtime（句级流式 + sentence_end）。
 * 协议文档：https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api
 */
import { randomUUID } from 'crypto';
import { BrowserWindow } from 'electron';
import WebSocket from 'ws';
import { getNxFcAxios, getFcBaseUrlForClient } from './nxFcClient.js';
import { withFcRouteFailover } from './nxFcRouteManager.js';

export type AsrRealtimeEvent =
  | { type: 'started'; sessionId: string }
  | { type: 'partial'; sessionId: string; text: string }
  | { type: 'final'; sessionId: string; text: string }
  | { type: 'finished'; sessionId: string }
  | { type: 'error'; sessionId: string; message: string; code?: string };

type SessionTicket = {
  authorization: string;
  wsUrl: string;
  model: string;
  sampleRate: number;
  format: string;
};

type ActiveSession = {
  id: string;
  taskId: string;
  ws: WebSocket;
  taskStarted: boolean;
  closed: boolean;
  /** 已向服务端发送的 PCM 字节数（用于避免无音频 finish → EmptyAudio） */
  bytesSent: number;
  /** 已确认的最终句子拼接 */
  committedText: string;
  /** 当前句中间结果 */
  partialText: string;
  /** 已定稿的 sentence_id，防止同一句 final 被拼两次 */
  lastFinalizedSentenceId: number;
};

let active: ActiveSession | null = null;

function broadcast(event: AsrRealtimeEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const wc = win.webContents;
    // 渲染崩溃 / 关闭后勿再 send，避免 “Render frame was disposed”
    if (!wc || wc.isDestroyed() || wc.isCrashed()) continue;
    try {
      wc.send('asr-realtime-event', event);
    } catch {
      /* ignore disposed / WidgetHost rejected */
    }
  }
}

function mapFcError(status: number, data: unknown): { code: string; message: string } {
  const body = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const err = String(body.error || '').trim();
  const msg = String(body.message || '').trim();
  if (status === 401 || err === 'UNAUTHORIZED') {
    return { code: 'UNAUTHORIZED', message: '请先登录账号后再使用语音听写' };
  }
  if (err === 'DASHSCOPE_ASR_NOT_CONFIGURED' || status === 503) {
    return {
      code: 'NOT_CONFIGURED',
      message: msg || '云端未配置实时语音识别（DASHSCOPE_API_KEY），请联系管理员',
    };
  }
  if (/余额|balance|Arrearage|Insufficient/i.test(msg + err)) {
    return { code: 'BALANCE', message: '语音识别额度不足或账号欠费，请稍后重试或联系管理员' };
  }
  return {
    code: err || 'FC_ERROR',
    message: msg || `获取语音识别会话失败（HTTP ${status}）`,
  };
}

async function fetchSessionTicket(): Promise<SessionTicket> {
  const base = getFcBaseUrlForClient();
  if (!base) {
    throw Object.assign(new Error('未配置云端地址（HK_FC_ENDPOINT / ALIYUN_FC_INIT_USER_URL）'), {
      code: 'NO_FC',
    });
  }
  try {
    return await withFcRouteFailover(async () => {
      const axios = getNxFcAxios();
      const res = await axios.post('/asr/realtime-session', {}, { timeout: 20000 });
      const data = res.data || {};
      const authorization = String(data.authorization || '').trim();
      const wsUrl = String(data.wsUrl || '').trim();
      const model = String(data.model || 'fun-asr-realtime').trim() || 'fun-asr-realtime';
      const sampleRate = Number(data.sampleRate) || 16000;
      const format = String(data.format || 'pcm').trim() || 'pcm';
      if (!authorization || !wsUrl) {
        throw Object.assign(new Error('云端返回的语音识别会话无效'), { code: 'BAD_TICKET' });
      }
      return { authorization, wsUrl, model, sampleRate, format };
    });
  } catch (e: unknown) {
    const ax = e as { response?: { status?: number; data?: unknown }; message?: string; code?: string };
    if (ax.response) {
      const mapped = mapFcError(ax.response.status || 500, ax.response.data);
      throw Object.assign(new Error(mapped.message), { code: mapped.code });
    }
    const msg = ax.message || String(e);
    const code = String(ax.code || '');
    if (
      /ETIMEDOUT|ENOTFOUND|ECONNREFUSED|ECONNRESET|ECONNABORTED|network|socket hang up/i.test(
        `${msg} ${code}`,
      )
    ) {
      throw Object.assign(
        new Error('网络异常，无法连接云端语音服务。请检查网络或稍后重试；若长期超时可配置可用代理后重启'),
        { code: 'NETWORK' },
      );
    }
    throw Object.assign(new Error(msg || '获取语音识别会话失败'), { code: code || 'UNKNOWN' });
  }
}

function sendRunTask(session: ActiveSession, ticket: SessionTicket): void {
  const msg = {
    header: {
      action: 'run-task',
      task_id: session.taskId,
      streaming: 'duplex',
    },
    payload: {
      task_group: 'audio',
      task: 'asr',
      function: 'recognition',
      model: ticket.model,
      parameters: {
        sample_rate: ticket.sampleRate,
        format: ticket.format,
        // 启用中间结果，便于边说边出字
        enable_intermediate_result: true,
        enable_punctuation_prediction: true,
      },
      input: {},
    },
  };
  session.ws.send(JSON.stringify(msg));
}

function sendFinishTask(session: ActiveSession): void {
  if (session.closed || session.ws.readyState !== WebSocket.OPEN) return;
  const msg = {
    header: {
      action: 'finish-task',
      task_id: session.taskId,
      streaming: 'duplex',
    },
    payload: { input: {} },
  };
  try {
    session.ws.send(JSON.stringify(msg));
  } catch {
    /* ignore */
  }
}

/**
 * 句与句拼接：Fun-ASR 常在句边界把最后一个字再送进下一句（「三」+「三二」→「三三二」）。
 * 同一句的完整重发则直接丢弃。
 */
function appendAsrSentence(prev: string, next: string): string {
  const a = prev || '';
  const b = next || '';
  if (!a) return b;
  if (!b) return a;
  if (b.startsWith(a)) return b;
  const max = Math.min(a.length, b.length);
  for (let n = max; n >= 1; n--) {
    if (a.slice(-n) !== b.slice(0, n)) continue;
    if (n === b.length) return b.length >= 2 ? a : `${a}${b}`;
    return `${a}${b.slice(n)}`;
  }
  return `${a}${b}`;
}

function handleServerMessage(session: ActiveSession, raw: WebSocket.RawData): void {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }
  const header = (message.header || {}) as Record<string, unknown>;
  const event = String(header.event || '');
  if (event === 'task-started') {
    session.taskStarted = true;
    broadcast({ type: 'started', sessionId: session.id });
    return;
  }
  if (event === 'result-generated') {
    const payload = (message.payload || {}) as Record<string, unknown>;
    const output = (payload.output || {}) as Record<string, unknown>;
    const sentence = (output.sentence || {}) as Record<string, unknown>;
    if (sentence.heartbeat === true) return;
    const text = String(sentence.text || '').trim();
    const sentenceEnd = sentence.sentence_end === true;
    const sentenceId = Number(sentence.sentence_id) || 0;
    if (!text) return;
    if (sentenceEnd) {
      if (sentenceId > 0 && sentenceId === session.lastFinalizedSentenceId) {
        broadcast({ type: 'final', sessionId: session.id, text: session.committedText });
        return;
      }
      session.committedText = appendAsrSentence(session.committedText, text);
      if (sentenceId > 0) session.lastFinalizedSentenceId = sentenceId;
      session.partialText = '';
      broadcast({ type: 'final', sessionId: session.id, text: session.committedText });
    } else {
      if (sentenceId > 0 && sentenceId === session.lastFinalizedSentenceId) return;
      session.partialText = text;
      const combined = appendAsrSentence(session.committedText, text);
      broadcast({ type: 'partial', sessionId: session.id, text: combined });
    }
    return;
  }
  if (event === 'task-finished') {
    session.closed = true;
    try {
      session.ws.close();
    } catch {
      /* ignore */
    }
    if (active?.id === session.id) active = null;
    broadcast({ type: 'finished', sessionId: session.id });
    return;
  }
  if (event === 'task-failed') {
    const errMsg =
      String(header.error_message || header.errorMessage || '').trim() ||
      '实时语音识别失败';
    const errCode = String(header.error_code || header.errorCode || 'TASK_FAILED');
    session.closed = true;
    try {
      session.ws.close();
    } catch {
      /* ignore */
    }
    if (active?.id === session.id) active = null;
    let friendly = errMsg;
    if (/Arrearage|Insufficient|余额|quota|Quota/i.test(errMsg + errCode)) {
      friendly = '语音识别额度不足或账号欠费，请稍后重试';
    } else if (/EmptyAudio|NO_VALID_AUDIO|NO_SPEECH|SILENCE|empty.?audio/i.test(errMsg + errCode)) {
      // 松开过快 / 未采到有效人声：不当成硬错误弹「EmptyAudio」
      friendly = '没有听清有效语音，请按住麦克风再说一会儿';
    }
    broadcast({ type: 'error', sessionId: session.id, message: friendly, code: errCode });
  }
}

function forceCloseSession(reason?: string): void {
  const session = active;
  active = null;
  if (!session) return;
  session.closed = true;
  try {
    if (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING) {
      session.ws.close();
    }
  } catch {
    /* ignore */
  }
  if (reason) {
    broadcast({ type: 'error', sessionId: session.id, message: reason });
  }
}

export async function asrRealtimeStart(): Promise<{ ok: true; sessionId: string } | { ok: false; message: string; code?: string }> {
  // 不再因 LLM 占用而拒绝听写：否则生成故事期间/超时残留 busy 时，所有话筒都会静默失败
  if (active && !active.closed) {
    forceCloseSession();
  }
  let ticket: SessionTicket;
  try {
    ticket = await fetchSessionTicket();
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string };
    return { ok: false, message: err.message || '无法开始语音听写', code: err.code };
  }

  const sessionId = randomUUID();
  const taskId = randomUUID().replace(/-/g, '').slice(0, 32);
  const ws = new WebSocket(ticket.wsUrl, {
    headers: {
      Authorization: ticket.authorization,
    },
  });

  const session: ActiveSession = {
    id: sessionId,
    taskId,
    ws,
    taskStarted: false,
    closed: false,
    bytesSent: 0,
    committedText: '',
    partialText: '',
    lastFinalizedSentenceId: 0,
  };
  active = session;

  ws.on('open', () => {
    if (active?.id !== sessionId || session.closed) return;
    sendRunTask(session, ticket);
  });
  ws.on('message', (data) => {
    if (active?.id !== sessionId || session.closed) return;
    handleServerMessage(session, data);
  });
  ws.on('error', (err) => {
    if (session.closed) return;
    const msg = err?.message || 'WebSocket 连接失败';
    let friendly = msg;
    if (/401|403|Unauthorized/i.test(msg)) {
      friendly = '语音识别鉴权失败，请检查云端 DASHSCOPE_API_KEY';
    } else if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
      friendly = '无法连接语音识别服务，请检查网络';
    }
    forceCloseSession(friendly);
  });
  ws.on('close', () => {
    if (session.closed) return;
    session.closed = true;
    if (active?.id === sessionId) active = null;
    if (!session.taskStarted) {
      broadcast({
        type: 'error',
        sessionId,
        message: '语音识别会话未能启动，请稍后重试',
        code: 'WS_CLOSED',
      });
    } else {
      broadcast({ type: 'finished', sessionId });
    }
  });

  // 等待 task-started（最多 12s）
  const started = await new Promise<boolean>((resolve) => {
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (session.taskStarted) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (session.closed || Date.now() - t0 > 12000) {
        clearInterval(timer);
        resolve(false);
      }
    }, 50);
  });

  if (!started) {
    // 不广播 error：渲染进程会通过返回值弹一次；再广播会在会话已就绪时重复弹窗并把指针锁死
    forceCloseSession();
    return { ok: false, message: '语音识别启动超时，请检查网络后重试', code: 'TIMEOUT' };
  }

  return { ok: true, sessionId };
}

export function asrRealtimeSendAudio(sessionId: string, pcmBase64: string): { ok: boolean; message?: string } {
  const session = active;
  if (!session || session.id !== sessionId || session.closed) {
    return { ok: false, message: '语音会话已结束' };
  }
  if (!session.taskStarted || session.ws.readyState !== WebSocket.OPEN) {
    return { ok: false, message: '语音会话尚未就绪' };
  }
  try {
    const buf = Buffer.from(pcmBase64, 'base64');
    if (buf.length > 0) {
      session.ws.send(buf);
      session.bytesSent += buf.length;
    }
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : '发送音频失败' };
  }
}

export async function asrRealtimeStop(
  sessionId: string,
): Promise<{ ok: boolean; text: string; message?: string }> {
  const session = active;
  if (!session || session.id !== sessionId) {
    return { ok: true, text: '' };
  }
  // 未送出任何 PCM 就 finish → DashScope EmptyAudio；改静默取消
  if (!session.closed && session.taskStarted && session.bytesSent < 3200) {
    forceCloseSession();
    return { ok: true, text: '' };
  }
  if (!session.closed && session.taskStarted) {
    sendFinishTask(session);
    await new Promise<void>((resolve) => {
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (!active || active.id !== sessionId || active.closed || Date.now() - t0 > 1800) {
          clearInterval(timer);
          resolve();
        }
      }, 40);
    });
  }
  const text = (session.committedText || session.partialText || '').trim();
  if (active?.id === sessionId) {
    forceCloseSession();
  }
  return { ok: true, text };
}

export function asrRealtimeCancel(sessionId?: string): { ok: boolean } {
  if (!active) return { ok: true };
  if (sessionId && active.id !== sessionId) return { ok: true };
  forceCloseSession();
  return { ok: true };
}
