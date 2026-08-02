/**
 * 阿里云百炼实时语音听写（push-to-talk：按住说话 / 松开识别；边说边出字）。
 * 音频经 IPC → 主进程 WebSocket → DashScope；渲染进程不接触 API Key。
 * 对外提供 start / stop / cancel；toggle 仍保留作内部/兼容。
 *
 * 稳定性（Windows Electron ACCESS_VIOLATION / exitCode -1073741819）：
 * - 禁止 ScriptProcessor（Chromium 已废弃，Electron 上易崩）
 * - 优先 AudioWorklet（回调内仅拷贝 PCM）；失败再 MediaStreamTrackProcessor
 * - 禁止在音频回调里 invoke；主线程定时 flush + 单向 send
 * - 按下瞬间不重活：先 yield，再请求麦克风权限
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  rmsFromByteTimeDomain,
  smoothMicLevel,
} from '../utils/micInputLevel';

export type RealtimeDictationStatus = 'idle' | 'connecting' | 'listening' | 'stopping' | 'error';

type TrackProcessorReader = ReadableStreamDefaultReader<AudioData>;

const PCM_WORKLET_NAME = 'nexflow-pcm-capture';
const PCM_WORKLET_SOURCE = `
class NexflowPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch0 = inputs[0] && inputs[0][0];
    if (ch0 && ch0.length > 0) {
      const copy = new Float32Array(ch0.length);
      copy.set(ch0);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('${PCM_WORKLET_NAME}', NexflowPcmCaptureProcessor);
`;

function floatTo16BitPcmBase64(input: Float32Array): string {
  const bytes = new Uint8Array(input.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const CHUNK = 0x2000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}

/** 将任意采样率单声道 float 重采样到 16kHz */
function downsampleTo16k(input: Float32Array, inputSampleRate: number): Float32Array {
  if (!inputSampleRate || inputSampleRate === 16000) return input;
  const ratio = inputSampleRate / 16000;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j]!;
      count++;
    }
    out[i] = count > 0 ? sum / count : input[start] || 0;
  }
  return out;
}

function mergeFloatChunks(chunks: Float32Array[]): Float32Array {
  if (chunks.length === 0) return new Float32Array(0);
  if (chunks.length === 1) return chunks[0]!;
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function ensureMicPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const perms = navigator.permissions;
    if (!perms?.query) return 'unknown';
    const status = await perms.query({ name: 'microphone' as PermissionName });
    return (status.state as 'granted' | 'denied' | 'prompt') || 'unknown';
  } catch {
    return 'unknown';
  }
}

function enqueuePcm(queue: Float32Array[], chunk: Float32Array): void {
  queue.push(chunk);
  // 防止 flush 卡住时队列无限增长（约保留 ~0.5–1s）
  if (queue.length > 24) {
    queue.splice(0, queue.length - 12);
  }
}

function extractMonoFloat32(audioData: AudioData): Float32Array {
  const frames = audioData.numberOfFrames;
  const out = new Float32Array(frames);
  try {
    audioData.copyTo(out, { planeIndex: 0, format: 'f32-planar' });
  } catch {
    // 部分 Chromium 仅接受 interleaved
    const interleaved = new Float32Array(frames * Math.max(1, audioData.numberOfChannels));
    audioData.copyTo(interleaved, { planeIndex: 0, format: 'f32' });
    if (audioData.numberOfChannels <= 1) {
      out.set(interleaved.subarray(0, frames));
    } else {
      for (let i = 0; i < frames; i++) out[i] = interleaved[i * audioData.numberOfChannels]!;
    }
  }
  return out;
}

export interface UseCloudRealtimeDictationOptions {
  /** 听写开始前输入框已有文本（用于拼接 partial） */
  getBaseText: () => string;
  /** partial / final 时写回输入框 */
  onLiveText: (fullText: string) => void;
  /** 会话结束（成功提交）时回调最终文本（相对 base 的听写结果） */
  onCommitted?: (dictationText: string, fullText: string) => void;
  onError?: (message: string) => void;
  /** 无麦克风等 */
  onMicDenied?: () => void;
}

export function useCloudRealtimeDictation(opts: UseCloudRealtimeDictationOptions) {
  const [status, setStatus] = useState<RealtimeDictationStatus>('idle');
  const [liveText, setLiveText] = useState('');
  const sessionIdRef = useRef<string | null>(null);
  const baseTextRef = useRef('');
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const muteRef = useRef<GainNode | null>(null);
  const trackReaderRef = useRef<TrackProcessorReader | null>(null);
  const sampleRateRef = useRef(48000);
  const sendingRef = useRef(false);
  /** 使 in-flight start() 在 stop/cancel 后失效 */
  const startGenRef = useRef(0);
  /** 点击切换防重入（双击 / 连点） */
  const toggleLockRef = useRef(false);
  const pcmQueueRef = useRef<Float32Array[]>([]);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workletUrlRef = useRef<string | null>(null);
  /** 电平监测：可与 Worklet 共用 source，或 TrackProcessor 路径下单独轻量 AudioContext */
  const levelAnalyserRef = useRef<AnalyserNode | null>(null);
  const levelCtxRef = useRef<AudioContext | null>(null);
  const levelSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const levelSmoothRef = useRef(0);
  const levelTimeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const levelLastEmitRef = useRef(0);
  const [inputLevel, setInputLevel] = useState(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stopLevelMonitor = useCallback(() => {
    if (levelRafRef.current != null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    try {
      levelSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    levelSourceRef.current = null;
    levelAnalyserRef.current = null;
    const levelCtx = levelCtxRef.current;
    levelCtxRef.current = null;
    if (levelCtx && levelCtx !== audioCtxRef.current) {
      void levelCtx.close().catch(() => {});
    }
    levelSmoothRef.current = 0;
    levelTimeDataRef.current = null;
    levelLastEmitRef.current = 0;
    setInputLevel(0);
  }, []);

  const startLevelRafLoop = useCallback(() => {
    if (levelRafRef.current != null) return;
    const tick = () => {
      const analyser = levelAnalyserRef.current;
      if (!analyser) {
        levelRafRef.current = null;
        return;
      }
      const need = analyser.fftSize;
      if (!levelTimeDataRef.current || levelTimeDataRef.current.length !== need) {
        levelTimeDataRef.current = new Uint8Array(new ArrayBuffer(need));
      }
      analyser.getByteTimeDomainData(levelTimeDataRef.current);
      const raw = rmsFromByteTimeDomain(levelTimeDataRef.current);
      const next = smoothMicLevel(levelSmoothRef.current, raw);
      levelSmoothRef.current = next;
      const now = performance.now();
      if (now - levelLastEmitRef.current >= 48) {
        levelLastEmitRef.current = now;
        setInputLevel(next);
      }
      levelRafRef.current = requestAnimationFrame(tick);
    };
    levelRafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopFlushTimer = useCallback(() => {
    if (flushTimerRef.current != null) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pcmQueueRef.current = [];
  }, []);

  const flushPcmQueue = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid || !sendingRef.current) {
      pcmQueueRef.current = [];
      return;
    }
    const chunks = pcmQueueRef.current;
    if (chunks.length === 0) return;
    pcmQueueRef.current = [];
    try {
      const merged = mergeFloatChunks(chunks);
      if (merged.length === 0) return;
      const rate = sampleRateRef.current || audioCtxRef.current?.sampleRate || 48000;
      const down = downsampleTo16k(merged, rate);
      const b64 = floatTo16BitPcmBase64(down);
      // 单向 send，勿 await / invoke（避免音频路径上堆 Promise）
      window.electronAPI?.asrRealtimeSendAudio?.(sid, b64);
    } catch (e) {
      console.warn('[useCloudRealtimeDictation] flush PCM failed', e);
    }
  }, []);

  const cleanupMic = useCallback(() => {
    sendingRef.current = false;
    stopFlushTimer();
    stopLevelMonitor();

    const reader = trackReaderRef.current;
    trackReaderRef.current = null;
    if (reader) {
      try {
        void reader.cancel();
      } catch {
        /* ignore */
      }
    }

    try {
      workletNodeRef.current?.port.close();
    } catch {
      /* ignore */
    }
    try {
      workletNodeRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    workletNodeRef.current = null;

    try {
      sourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    sourceRef.current = null;

    try {
      muteRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    muteRef.current = null;

    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx) {
      // 先断图再 close，避免关闭中仍有回调
      void ctx.close().catch(() => {});
    }

    if (workletUrlRef.current) {
      try {
        URL.revokeObjectURL(workletUrlRef.current);
      } catch {
        /* ignore */
      }
      workletUrlRef.current = null;
    }

    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
  }, [stopFlushTimer, stopLevelMonitor]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onAsrRealtimeEvent) return;
    return api.onAsrRealtimeEvent((ev) => {
      if (!sessionIdRef.current || ev.sessionId !== sessionIdRef.current) return;
      if (ev.type === 'partial' || ev.type === 'final') {
        const dictation = String(ev.text || '');
        setLiveText(dictation);
        const base = baseTextRef.current;
        const sep = base && dictation && !base.endsWith('\n') && !base.endsWith(' ') ? '' : '';
        const full = base ? `${base}${sep}${dictation}` : dictation;
        optsRef.current.onLiveText(full);
      } else if (ev.type === 'error') {
        cleanupMic();
        sessionIdRef.current = null;
        setStatus('error');
        optsRef.current.onError?.(ev.message || '语音听写失败');
        setTimeout(() => setStatus('idle'), 0);
      } else if (ev.type === 'finished') {
        /* stop() 路径会处理 */
      }
    });
  }, [cleanupMic]);

  useEffect(() => {
    return () => {
      startGenRef.current += 1;
      const sid = sessionIdRef.current;
      cleanupMic();
      if (sid) void window.electronAPI?.asrRealtimeCancel?.(sid);
      sessionIdRef.current = null;
    };
  }, [cleanupMic]);

  const startTrackProcessorCapture = useCallback(async (sessionId: string, stream: MediaStream) => {
    const TrackProcessorCtor = (
      window as unknown as {
        MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => {
          readable: ReadableStream<AudioData>;
        };
      }
    ).MediaStreamTrackProcessor;
    if (!TrackProcessorCtor) throw new Error('NO_TRACK_PROCESSOR');

    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('NO_AUDIO_TRACK');

    const processor = new TrackProcessorCtor({ track });
    const reader = processor.readable.getReader();
    trackReaderRef.current = reader;
    sendingRef.current = true;

    const pump = async () => {
      try {
        while (sendingRef.current && sessionIdRef.current === sessionId) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          try {
            if (!sendingRef.current || sessionIdRef.current !== sessionId) {
              value.close();
              break;
            }
            sampleRateRef.current = value.sampleRate || sampleRateRef.current;
            enqueuePcm(pcmQueueRef.current, extractMonoFloat32(value));
          } finally {
            try {
              value.close();
            } catch {
              /* ignore */
            }
          }
        }
      } catch (e) {
        if (sendingRef.current && sessionIdRef.current === sessionId) {
          console.warn('[useCloudRealtimeDictation] track processor ended', e);
        }
      }
    };
    void pump();
  }, []);

  const startAudioWorkletCapture = useCallback(async (sessionId: string, stream: MediaStream) => {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) throw new Error('NO_AUDIO_CONTEXT');

    let ctx: AudioContext;
    try {
      ctx = new AudioCtx({ sampleRate: 16000 });
    } catch {
      ctx = new AudioCtx();
    }
    audioCtxRef.current = ctx;
    sampleRateRef.current = ctx.sampleRate || 48000;
    if (ctx.state === 'suspended') await ctx.resume();

    if (!ctx.audioWorklet?.addModule) {
      throw new Error('NO_AUDIO_WORKLET');
    }

    const blob = new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    workletUrlRef.current = url;
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      workletUrlRef.current = null;
    }

    const source = ctx.createMediaStreamSource(stream);
    sourceRef.current = source;
    const node = new AudioWorkletNode(ctx, PCM_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    });
    workletNodeRef.current = node;
    sendingRef.current = true;
    node.port.onmessage = (ev: MessageEvent<Float32Array>) => {
      if (!sendingRef.current || sessionIdRef.current !== sessionId) return;
      const data = ev.data;
      if (!(data instanceof Float32Array) || data.length === 0) return;
      enqueuePcm(pcmQueueRef.current, data);
    };

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    source.connect(analyser);
    levelAnalyserRef.current = analyser;
    // 电平与 Worklet 共用同一 AudioContext，勿单独 close
    levelCtxRef.current = ctx;

    const mute = ctx.createGain();
    mute.gain.value = 0;
    muteRef.current = mute;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);
  }, []);

  const startMicCapture = useCallback(
    async (sessionId: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        optsRef.current.onMicDenied?.();
        throw new Error('MIC_DENIED');
      }

      const perm = await ensureMicPermission();
      if (perm === 'denied') {
        optsRef.current.onMicDenied?.();
        throw new Error('MIC_DENIED');
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
      } catch {
        optsRef.current.onMicDenied?.();
        throw new Error('MIC_DENIED');
      }
      streamRef.current = stream;

      // AudioWorklet 优先（ScriptProcessor 的正式替代）；失败再试 TrackProcessor
      let started = false;
      try {
        await startAudioWorkletCapture(sessionId, stream);
        started = true;
      } catch (e) {
        console.warn('[useCloudRealtimeDictation] AudioWorklet unavailable, try MediaStreamTrackProcessor', e);
        // 清掉半成品 AudioContext/Worklet，但不要 stop 掉刚拿到的 stream
        sendingRef.current = false;
        try {
          workletNodeRef.current?.port.close();
        } catch {
          /* ignore */
        }
        try {
          workletNodeRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        workletNodeRef.current = null;
        try {
          sourceRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        sourceRef.current = null;
        try {
          muteRef.current?.disconnect();
        } catch {
          /* ignore */
        }
        muteRef.current = null;
        levelAnalyserRef.current = null;
        levelSourceRef.current = null;
        if (levelCtxRef.current === audioCtxRef.current) {
          levelCtxRef.current = null;
        }
        const ctx = audioCtxRef.current;
        audioCtxRef.current = null;
        if (ctx) void ctx.close().catch(() => {});
        if (workletUrlRef.current) {
          try {
            URL.revokeObjectURL(workletUrlRef.current);
          } catch {
            /* ignore */
          }
          workletUrlRef.current = null;
        }
      }
      if (!started) {
        await startTrackProcessorCapture(sessionId, stream);
        // TrackProcessor 路径无 Worklet AudioContext：单独建轻量 Analyser 取电平
        if (!levelAnalyserRef.current) {
          const AudioCtx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx) {
            try {
              const levelCtx = new AudioCtx();
              levelCtxRef.current = levelCtx;
              if (levelCtx.state === 'suspended') await levelCtx.resume();
              const levelSource = levelCtx.createMediaStreamSource(stream);
              levelSourceRef.current = levelSource;
              const analyser = levelCtx.createAnalyser();
              analyser.fftSize = 512;
              analyser.smoothingTimeConstant = 0.72;
              levelSource.connect(analyser);
              levelAnalyserRef.current = analyser;
            } catch (e) {
              console.warn('[useCloudRealtimeDictation] level analyser unavailable', e);
            }
          }
        }
      }

      if (levelAnalyserRef.current) startLevelRafLoop();

      if (flushTimerRef.current != null) clearInterval(flushTimerRef.current);
      flushTimerRef.current = setInterval(() => {
        flushPcmQueue();
      }, 100);
    },
    [flushPcmQueue, startAudioWorkletCapture, startLevelRafLoop, startTrackProcessorCapture],
  );

  const start = useCallback(async () => {
    if (status === 'connecting' || status === 'listening' || status === 'stopping') return false;
    if (!window.electronAPI?.asrRealtimeStart) {
      optsRef.current.onError?.('当前版本不支持实时语音听写');
      return false;
    }
    const gen = ++startGenRef.current;
    setStatus('connecting');
    baseTextRef.current = optsRef.current.getBaseText() || '';
    setLiveText('');

    // 点击 handler 先返回，避免与 pointer/click 同步重活叠在一起
    await yieldToUi();
    if (gen !== startGenRef.current) {
      setStatus('idle');
      return false;
    }

    const res = await window.electronAPI.asrRealtimeStart();
    if (gen !== startGenRef.current) {
      if (res.ok) void window.electronAPI.asrRealtimeCancel?.(res.sessionId);
      setStatus('idle');
      return false;
    }
    if (!res.ok) {
      setStatus('idle');
      optsRef.current.onError?.(res.message || '无法开始语音听写');
      return false;
    }
    sessionIdRef.current = res.sessionId;
    try {
      await startMicCapture(res.sessionId);
      if (gen !== startGenRef.current) {
        cleanupMic();
        void window.electronAPI.asrRealtimeCancel?.(res.sessionId);
        sessionIdRef.current = null;
        setStatus('idle');
        return false;
      }
      setStatus('listening');
      return true;
    } catch (e) {
      if (gen !== startGenRef.current) {
        void window.electronAPI.asrRealtimeCancel?.(res.sessionId);
        sessionIdRef.current = null;
        cleanupMic();
        return false;
      }
      void window.electronAPI.asrRealtimeCancel?.(res.sessionId);
      sessionIdRef.current = null;
      cleanupMic();
      setStatus('idle');
      if (String(e) !== 'Error: MIC_DENIED') {
        optsRef.current.onError?.('无法打开麦克风');
      }
      return false;
    }
  }, [cleanupMic, startMicCapture, status]);

  const stop = useCallback(async () => {
    startGenRef.current += 1;
    const sid = sessionIdRef.current;
    sendingRef.current = false;
    flushPcmQueue();
    cleanupMic();
    if (!sid) {
      setStatus('idle');
      return '';
    }
    setStatus('stopping');
    try {
      const res = await window.electronAPI?.asrRealtimeStop?.(sid);
      const dictation = String(res?.text || liveText || '').trim();
      const base = baseTextRef.current;
      const full = dictation ? (base ? `${base}${dictation}` : dictation) : base;
      if (dictation) {
        optsRef.current.onLiveText(full);
        optsRef.current.onCommitted?.(dictation, full);
      }
      sessionIdRef.current = null;
      setStatus('idle');
      setLiveText('');
      return dictation;
    } catch (e) {
      sessionIdRef.current = null;
      setStatus('idle');
      optsRef.current.onError?.(e instanceof Error ? e.message : '结束听写失败');
      return '';
    }
  }, [cleanupMic, flushPcmQueue, liveText]);

  const cancel = useCallback(() => {
    startGenRef.current += 1;
    const sid = sessionIdRef.current;
    cleanupMic();
    sessionIdRef.current = null;
    setLiveText('');
    setStatus('idle');
    if (sid) void window.electronAPI?.asrRealtimeCancel?.(sid);
  }, [cleanupMic]);

  /** 兼容旧调用：开始 ↔ 结束；主交互已改为 push-to-talk */
  const toggle = useCallback(async () => {
    if (toggleLockRef.current) return false;
    if (status === 'stopping' || status === 'connecting') return false;
    toggleLockRef.current = true;
    try {
      if (status === 'listening') {
        await stop();
        return false;
      }
      return await start();
    } finally {
      // 短锁，挡住同一次双击的第二次 click
      setTimeout(() => {
        toggleLockRef.current = false;
      }, 280);
    }
  }, [start, status, stop]);

  return {
    status,
    isActive: status === 'connecting' || status === 'listening' || status === 'stopping',
    isListening: status === 'listening',
    /** 0–1 麦克风输入电平（录制中由 Analyser 驱动） */
    inputLevel,
    liveText,
    start,
    stop,
    cancel,
    toggle,
  };
}
