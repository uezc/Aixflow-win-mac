/**
 * 从音频文件解码生成波形数据
 * 使用全局队列限制并发，降低内存压力
 *
 * 注意：在 Electron 中对 local-resource:// 整文件 fetch 后再 decodeAudioData，
 * 大文件或部分编码易触发渲染进程原生崩溃（Windows exit -1073741819）。
 * 对本地 URL 的 UI 波形预览应在业务层跳过，或改为经主进程读盘后再解码。
 */

let audioDecodeQueue = Promise.resolve<void>(undefined);

function enqueueAudioDecode<T>(fn: () => Promise<T>): Promise<T> {
  const prev = audioDecodeQueue;
  let resolve: () => void;
  audioDecodeQueue = new Promise<void>((r) => { resolve = r; });
  return prev.then(() => fn()).finally(() => resolve!());
}

export async function decodeAudioWaveform(
  audioUrl: string,
  trimStart: number,
  trimEnd: number,
  barCount: number
): Promise<number[]> {
  return enqueueAudioDecode(async () => {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error('Audio fetch failed');
    const arrayBuffer = await response.arrayBuffer();

    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    ctx.close();

    const sampleRate = buffer.sampleRate;
    const channelData = buffer.getChannelData(0);
    const totalSamples = channelData.length;
    const startSample = Math.floor(trimStart * sampleRate);
    const endSample = Math.min(Math.floor(trimEnd * sampleRate), totalSamples);
    const rangeSamples = endSample - startSample;
    if (rangeSamples <= 0) return Array(barCount).fill(0.5);

    const samplesPerBar = rangeSamples / barCount;
    const bars: number[] = [];
    for (let i = 0; i < barCount; i++) {
      const barStart = Math.floor(startSample + i * samplesPerBar);
      const barEnd = Math.min(Math.floor(barStart + samplesPerBar), totalSamples);
      let max = 0;
      for (let j = barStart; j < barEnd; j++) {
        const v = Math.abs(channelData[j] ?? 0);
        if (v > max) max = v;
      }
      bars.push(Math.max(0.1, Math.min(1, max * 2)));
    }
    return bars;
  });
}
