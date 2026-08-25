/**
 * 从音频文件解码生成波形数据
 * 使用全局队列限制并发，降低内存压力
 *
 * 注意：decodeAudioData 会把整文件解成 PCM，与 trim 范围无关。
 * 在 Electron/Windows 上对 local-resource / 大文件 fetch+decode 易触发渲染进程原生崩溃
 *（exit -1073741819 / 0xC0000005），try/catch 无法拦截。业务层应优先用装饰波形；
 * 本工具对危险 URL / 超大缓冲直接拒绝。
 */

let audioDecodeQueue = Promise.resolve<void>(undefined);

/** 超过此体积不再解码（PCM 膨胀后极易 OOM/原生崩） */
const MAX_WAVEFORM_BYTES = 6 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 8 * 1024 * 1024;

function enqueueAudioDecode<T>(fn: () => Promise<T>): Promise<T> {
  const prev = audioDecodeQueue;
  let resolve: () => void;
  audioDecodeQueue = new Promise<void>((r) => {
    resolve = r;
  });
  return prev.then(() => fn()).finally(() => resolve!());
}

function assertUrlSafeForWaveformDecode(audioUrl: string): void {
  const url = String(audioUrl || '').trim();
  if (!url) throw new Error('Audio URL empty');
  if (
    url.startsWith('local-resource://') ||
    url.startsWith('file://') ||
    url.startsWith('blob:')
  ) {
    throw new Error('Local/blob audio waveform decode disabled (native crash risk)');
  }
  if (url.startsWith('data:') && url.length > MAX_DATA_URL_CHARS) {
    throw new Error('Data URL too large for waveform decode');
  }
}

export async function decodeAudioWaveform(
  audioUrl: string,
  trimStart: number,
  trimEnd: number,
  barCount: number
): Promise<number[]> {
  assertUrlSafeForWaveformDecode(audioUrl);

  const safeBarCount = Math.max(1, Math.min(240, Math.round(barCount) || 1));
  const startSec = Math.max(0, Number(trimStart) || 0);
  const endSec = Math.max(startSec + 0.05, Math.min(Number(trimEnd) || startSec + 30, startSec + 120));

  return enqueueAudioDecode(async () => {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error('Audio fetch failed');

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_WAVEFORM_BYTES) {
      throw new Error('Audio too large for waveform decode');
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_WAVEFORM_BYTES) {
      throw new Error('Audio too large for waveform decode');
    }

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    try {
      const buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
      const sampleRate = buffer.sampleRate;
      const channelData = buffer.getChannelData(0);
      const totalSamples = channelData.length;
      const startSample = Math.floor(startSec * sampleRate);
      const endSample = Math.min(Math.floor(endSec * sampleRate), totalSamples);
      const rangeSamples = endSample - startSample;
      if (rangeSamples <= 0) return Array(safeBarCount).fill(0.5);

      const samplesPerBar = rangeSamples / safeBarCount;
      const bars: number[] = [];
      for (let i = 0; i < safeBarCount; i++) {
        const barStart = Math.floor(startSample + i * samplesPerBar);
        const barEnd = Math.min(Math.floor(barStart + samplesPerBar), totalSamples);
        let max = 0;
        // 降采样扫描，避免超长区间逐样本扫爆主线程
        const step = Math.max(1, Math.floor((barEnd - barStart) / 256));
        for (let j = barStart; j < barEnd; j += step) {
          const v = Math.abs(channelData[j] ?? 0);
          if (v > max) max = v;
        }
        bars.push(Math.max(0.1, Math.min(1, max * 2)));
      }
      return bars;
    } finally {
      try {
        await ctx.close();
      } catch {
        /* ignore */
      }
    }
  });
}
