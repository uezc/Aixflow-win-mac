/**
 * 百炼 / DashScope 实时 ASR 会话票据（密钥仅存 FC 环境变量，不下发到渲染进程）。
 *
 * 协议：Fun-ASR-Realtime / Qwen-Audio-3.0-ASR-Flash-Streaming 的 inference WebSocket
 * （run-task → 二进制 PCM → result-generated → finish-task）
 * 文档：https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api
 * 用户指南：https://help.aliyun.com/zh/model-studio/real-time-speech-recognition-user-guide
 *
 * 默认模型 fun-asr-realtime：国内常用实时模型，支持 sentence_end 句级流式输出。
 * 亦可设 DASHSCOPE_ASR_MODEL=qwen-audio-3.0-asr-flash-streaming（同协议）。
 */

/**
 * @param {{ userId: string, headers: Record<string, string> }} opts
 */
export function handleAsrRealtimeSession(opts) {
  const { userId, headers } = opts;
  const apiKey = String(process.env.DASHSCOPE_API_KEY || '').trim();
  if (!apiKey) {
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({
        error: 'DASHSCOPE_ASR_NOT_CONFIGURED',
        message: '云端未配置 DASHSCOPE_API_KEY，无法使用实时语音听写',
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

  // 稳定版实时模型；句级流式 + sentence_end，适合打字/听写。
  const model =
    String(process.env.DASHSCOPE_ASR_MODEL || '').trim() || 'fun-asr-realtime';

  const workspaceId = String(process.env.DASHSCOPE_WORKSPACE_ID || '').trim();
  const customUrl = String(process.env.DASHSCOPE_ASR_WS_URL || '').trim();
  let wsUrl = customUrl;
  if (!wsUrl) {
    if (workspaceId) {
      // 业务空间专属域名（华北2 北京）
      wsUrl = `wss://${workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`;
    } else {
      // 旧域名仍可用（文档说明）
      wsUrl = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
    }
  }

  const sampleRate = Number(process.env.DASHSCOPE_ASR_SAMPLE_RATE || 16000) || 16000;
  const format = String(process.env.DASHSCOPE_ASR_FORMAT || 'pcm').trim() || 'pcm';
  const expiresInSec = Math.min(
    600,
    Math.max(60, Number(process.env.DASHSCOPE_ASR_TICKET_TTL_SEC || 300) || 300),
  );

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      /** 仅供 Electron 主进程建立 WebSocket；禁止写入渲染进程 */
      authorization: `bearer ${apiKey}`,
      wsUrl,
      model,
      sampleRate,
      format,
      expiresInSec,
      issuedAt: Date.now(),
      userId,
    }),
  };
}
