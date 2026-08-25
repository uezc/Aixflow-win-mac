/**
 * 阿里云百炼实时语音听写（push-to-talk：按住说话 / 松开识别；边说边出字）。
 * 音频经 IPC → 主进程 WebSocket → DashScope；渲染进程不接触 API Key。
 * 对外提供 start / stop / cancel；toggle 仍保留作内部/兼容。
 *
 * 稳定性（Windows Electron exitCode 134 / ACCESS_VIOLATION）：
 * - 禁止 ScriptProcessor
 * - 优先 AudioWorklet（听写可靠）；失败再 MediaStreamTrackProcessor
 * - TrackProcessor 若建链后仍无 PCM，自动回退 Worklet（防 EmptyAudio）
 * - Worklet 不接扬声器 destination；禁止 transferable postMessage
 * - 电平从 PCM RMS 估算
 * - 禁止在音频回调里 invoke；主线程定时 flush + 单向 send
 * - 按下瞬间不重活：先 yield，再请求麦克风权限
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  rmsFromByteTimeDomain,
  smoothMicLevel,
} from '../utils/micInputLevel';
import { forceClearVoiceModalLock } from '../utils/voiceModalGate';
import { abortAllPushToTalkPointers } from '../utils/pushToTalkPointer';

function unlockDictationPointer(): void {
  forceClearVoiceModalLock();
  abortAllPushToTalkPointers();
}

export type RealtimeDictationStatus = 'idle' | 'connecting' | 'listening' | 'stopping' | 'error';

const ASR_PENDING_SID = '__asr_pending__';

function isRealAsrSessionId(sid: string | null | undefined): sid is string {
  return !!sid && sid !== ASR_PENDING_SID;
}

type TrackProcessorReader = ReadableStreamDefaultReader<AudioData>;

const PCM_WORKLET_NAME = 'nexflow-pcm-capture';
const PCM_WORKLET_SOURCE = `
class NexflowPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(2048);
    this._off = 0;
  }
  process(inputs) {
    const ch0 = inputs[0] && inputs[0][0];
    if (ch0 && ch0.length > 0) {
      let i = 0;
      while (i < ch0.length) {
        const space = this._buf.length - this._off;
        const n = Math.min(space, ch0.length - i);
        this._buf.set(ch0.subarray(i, i + n), this._off);
        this._off += n;
        i += n;
        if (this._off >= this._buf.length) {
          // 勿 transfer buffer：部分 Electron 上 neutered ArrayBuffer 易崩
          const copy = this._buf.slice();
          this.port.postMessage(copy);
          this._off = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('${PCM_WORKLET_NAME}', NexflowPcmCaptureProcessor);
`;

/** 静态 worklet（CSP 允许 'self'）；勿用 blob:，Electron 默认 script-src 不含 blob */
function resolvePcmWorkletModuleUrl(): string {
  const base = String(import.meta.env.BASE_URL || '/');
  const rel = `${base.replace(/\/?$/, '/')}audio-worklets/nexflow-pcm-capture.js`;
  try {
    if (typeof window !== 'undefined' && window.location?.href) {
      return new URL(rel, window.location.href).href;
    }
  } catch {
    /* ignore */
  }
  return rel.startsWith('/') ? rel : `/${rel}`;
}

const PCM_WORKLET_MODULE_URL = resolvePcmWorkletModuleUrl();

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

/** AudioWorklet 每回调约 128 帧；按采样数封顶，避免「24 块 ≈ 64ms」把边说边等的音频丢光 */
const PCM_QUEUE_MAX_SAMPLES = 48000 * 4;

function enqueuePcm(queue: Float32Array[], chunk: Float32Array): void {
  if (!(chunk instanceof Float32Array) || chunk.length === 0) return;
  // 拷贝一份，避免 Worklet/Track 侧复用缓冲被后续写坏
  queue.push(chunk.slice());
  let total = 0;
  for (const c of queue) total += c.length;
  while (total > PCM_QUEUE_MAX_SAMPLES && queue.length > 1) {
    const dropped = queue.shift();
    total -= dropped?.length || 0;
  }
}

function rmsFromFloat32(buf: Float32Array): number {
  if (!buf.length) return 0;
  let sum = 0;
  const step = Math.max(1, Math.floor(buf.length / 512));
  let n = 0;
  for (let i = 0; i < buf.length; i += step) {
    const v = buf[i]!;
    sum += v * v;
    n += 1;
  }
  return Math.sqrt(sum / Math.max(1, n));
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
  const workletReadyRef = useRef(false);
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
  const statusRef = useRef<RealtimeDictationStatus>(status);
  statusRef.current = status;

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
      if (now - levelLastEmitRef.current >= 80) {
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

  const flushPcmQueue = useCallback((opts?: { force?: boolean }) => {
    const sid = sessionIdRef.current;
    const force = opts?.force === true;
    if (!force && !sendingRef.current) {
      pcmQueueRef.current = [];
      return;
    }
    const chunks = pcmQueueRef.current;
    if (chunks.length === 0) return;
    // 会话未就绪：只更新电平，保留队列等连上后再送
    if (!isRealAsrSessionId(sid)) {
      try {
        const peek = mergeFloatChunks(chunks.slice(-2));
        if (peek.length > 0) {
          const rawLevel = rmsFromFloat32(peek);
          const boosted = Math.min(1, rawLevel * 4.5);
          const next = smoothMicLevel(levelSmoothRef.current, boosted);
          levelSmoothRef.current = next;
          const now = performance.now();
          if (now - levelLastEmitRef.current >= 80) {
            levelLastEmitRef.current = now;
            setInputLevel(next);
          }
        }
      } catch {
        /* ignore */
      }
      return;
    }
    pcmQueueRef.current = [];
    try {
      const merged = mergeFloatChunks(chunks);
      if (merged.length === 0) return;
      const rawLevel = rmsFromFloat32(merged);
      const boosted = Math.min(1, rawLevel * 4.5);
      const next = smoothMicLevel(levelSmoothRef.current, boosted);
      levelSmoothRef.current = next;
      const now = performance.now();
      if (now - levelLastEmitRef.current >= 80) {
        levelLastEmitRef.current = now;
        setInputLevel(next);
      }
      const rate = sampleRateRef.current || audioCtxRef.current?.sampleRate || 48000;
      const down = downsampleTo16k(merged, rate);
      const b64 = floatTo16BitPcmBase64(down);
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
    if (ctx && ctx.state === 'running') {
      void ctx.suspend().catch(() => {});
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

  /** connecting / stopping 卡死时强制复位，避免话筒永久失效 */
  useEffect(() => {
    if (status !== 'connecting' && status !== 'stopping') return;
    const ms = status === 'connecting' ? 22_000 : 12_000;
    const timer = setTimeout(() => {
      const stuck = statusRef.current;
      if (stuck !== 'connecting' && stuck !== 'stopping') return;
      console.warn(`[useCloudRealtimeDictation] watchdog reset from ${stuck}`);
      startGenRef.current += 1;
      const sid = sessionIdRef.current;
      sessionIdRef.current = null;
      cleanupMic();
      setStatus('idle');
      unlockDictationPointer();
      if (isRealAsrSessionId(sid)) void window.electronAPI?.asrRealtimeCancel?.(sid);
      else void window.electronAPI?.asrRealtimeCancel?.();
      optsRef.current.onError?.(
        stuck === 'stopping'
          ? '语音听写结束超时，已强制复位'
          : '语音听写启动超时，请检查网络后重试',
      );
    }, ms);
    return () => clearTimeout(timer);
  }, [status, cleanupMic]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onAsrRealtimeEvent) return;
    return api.onAsrRealtimeEvent((ev) => {
      if (!isRealAsrSessionId(sessionIdRef.current) || ev.sessionId !== sessionIdRef.current) return;
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
        unlockDictationPointer();
        const raw = String(ev.message || '').trim() || '语音听写失败';
        const friendly = /EmptyAudio|NO_VALID_AUDIO|empty.?audio/i.test(raw + String(ev.code || ''))
          ? '没有听清有效语音，请按住麦克风再说一会儿'
          : raw;
        optsRef.current.onError?.(friendly);
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
      const ctx = audioCtxRef.current;
      audioCtxRef.current = null;
      workletReadyRef.current = false;
      if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
      const extra = levelCtxRef.current;
      levelCtxRef.current = null;
      if (extra && extra !== ctx && extra.state !== 'closed') void extra.close().catch(() => {});
      if (isRealAsrSessionId(sid)) void window.electronAPI?.asrRealtimeCancel?.(sid);
      else if (sid) void window.electronAPI?.asrRealtimeCancel?.();
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
        while (sendingRef.current) {
          const { value, done } = await reader.read();
          if (done || !value) break;
          try {
            if (!sendingRef.current) {
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
        if (sendingRef.current) {
          console.warn('[useCloudRealtimeDictation] track processor ended', e);
        }
      }
    };
    void pump();
  }, []);

  const startAudioWorkletCapture = useCallback(async (_sessionId: string, stream: MediaStream) => {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) throw new Error('NO_AUDIO_CONTEXT');

    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') {
      workletReadyRef.current = false;
      // 勿强制 16k：与麦克风原生采样率不一致时，部分环境 MediaStreamSource 无声
      ctx = new AudioCtx();
      audioCtxRef.current = ctx;
    }
    sampleRateRef.current = ctx.sampleRate || 48000;
    if (ctx.state === 'suspended') await ctx.resume();

    if (!ctx.audioWorklet?.addModule) {
      throw new Error('NO_AUDIO_WORKLET');
    }

    if (!workletReadyRef.current) {
      try {
        await ctx.audioWorklet.addModule(PCM_WORKLET_MODULE_URL);
        workletReadyRef.current = true;
      } catch (staticErr) {
        // 兜底：旧路径 blob（需 CSP script-src 含 blob:）
        const blob = new Blob([PCM_WORKLET_SOURCE], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        workletUrlRef.current = url;
        try {
          await ctx.audioWorklet.addModule(url);
          workletReadyRef.current = true;
        } catch (blobErr) {
          console.warn('[useCloudRealtimeDictation] worklet static+blob load failed', staticErr, blobErr);
          throw blobErr;
        } finally {
          try {
            URL.revokeObjectURL(url);
          } catch {
            /* ignore */
          }
          workletUrlRef.current = null;
        }
      }
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
      if (!sendingRef.current) return;
      const data = ev.data;
      if (!(data instanceof Float32Array) || data.length === 0) return;
      enqueuePcm(pcmQueueRef.current, data);
    };

    const mute = ctx.createGain();
    mute.gain.value = 0;
    muteRef.current = mute;
    // 接到 MediaStreamDestination，避免接扬声器 destination（Windows 上更易崩）
    const sink = ctx.createMediaStreamDestination();
    source.connect(node);
    node.connect(mute);
    mute.connect(sink);
  }, []);

  const startMicCapture = useCallback(
    async (sessionId: string) => {
      const gen = startGenRef.current;
      if (!navigator.mediaDevices?.getUserMedia) {
        optsRef.current.onMicDenied?.();
        throw new Error('MIC_DENIED');
      }

      const perm = await ensureMicPermission();
      if (perm === 'denied') {
        optsRef.current.onMicDenied?.();
        throw new Error('MIC_DENIED');
      }
      if (gen !== startGenRef.current) throw new Error('MIC_ABORTED');

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        optsRef.current.onMicDenied?.();
        throw new Error('MIC_DENIED');
      }
      if (gen !== startGenRef.current) {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            /* ignore */
          }
        });
        throw new Error('MIC_ABORTED');
      }
      streamRef.current = stream;

      // 采音策略：AudioWorklet 优先（听写可用）；失败再 TrackProcessor。
      // 注意：部分 Electron 上 TrackProcessor 能建链但 PCM 全 0，会导致 EmptyAudio。
      let started = false;
      try {
        await startAudioWorkletCapture(sessionId, stream);
        started = true;
      } catch (e) {
        console.warn('[useCloudRealtimeDictation] AudioWorklet unavailable, try TrackProcessor', e);
        // 清半成品 Worklet，保留 stream
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
        workletReadyRef.current = false;
        const ctx = audioCtxRef.current;
        audioCtxRef.current = null;
        if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => {});
      }
      if (!started) {
        try {
          await startTrackProcessorCapture(sessionId, stream);
          started = true;
          // 若 280ms 内仍无 PCM，改走 Worklet（防假成功无声）
          await new Promise<void>((r) => setTimeout(r, 280));
          if (gen !== startGenRef.current) throw new Error('MIC_ABORTED');
          let queued = 0;
          for (const c of pcmQueueRef.current) queued += c.length;
          if (queued < 160) {
            console.warn('[useCloudRealtimeDictation] TrackProcessor silent, fallback AudioWorklet');
            sendingRef.current = false;
            try {
              await trackReaderRef.current?.cancel();
            } catch {
              /* ignore */
            }
            trackReaderRef.current = null;
            pcmQueueRef.current = [];
            await startAudioWorkletCapture(sessionId, stream);
          }
        } catch (e) {
          if (String(e) === 'Error: MIC_ABORTED') throw e;
          console.warn('[useCloudRealtimeDictation] capture fallback failed', e);
          started = false;
        }
      }
      if (!started) {
        stream.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {
            /* ignore */
          }
        });
        streamRef.current = null;
        throw new Error('NO_CAPTURE_PATH');
      }

      if (flushTimerRef.current != null) clearInterval(flushTimerRef.current);
      flushTimerRef.current = setInterval(() => {
        flushPcmQueue();
      }, 100);
    },
    [flushPcmQueue, startAudioWorkletCapture, startTrackProcessorCapture],
  );

  const start = useCallback(async () => {
    const st = statusRef.current;
    if (st === 'listening') return false;
    // connecting / stopping 卡住时允许第二次按住打断转圈
    if (st === 'connecting' || st === 'stopping') {
      startGenRef.current += 1;
      const sid = sessionIdRef.current;
      sessionIdRef.current = null;
      cleanupMic();
      if (isRealAsrSessionId(sid)) void window.electronAPI?.asrRealtimeCancel?.(sid);
      else void window.electronAPI?.asrRealtimeCancel?.();
    }
    if (!window.electronAPI?.asrRealtimeStart) {
      optsRef.current.onError?.('当前版本不支持实时语音听写');
      return false;
    }
    const gen = ++startGenRef.current;
    setStatus('connecting');
    baseTextRef.current = optsRef.current.getBaseText() || '';
    setLiveText('');
    sessionIdRef.current = ASR_PENDING_SID;

    await yieldToUi();
    if (gen !== startGenRef.current) {
      return false;
    }

    const micPromise = startMicCapture(ASR_PENDING_SID);

    let res: { ok: true; sessionId: string } | { ok: false; message: string; code?: string };
    try {
      res = await window.electronAPI.asrRealtimeStart();
    } catch (e) {
      if (gen !== startGenRef.current) {
        return false;
      }
      sessionIdRef.current = null;
      cleanupMic();
      try {
        await micPromise;
      } catch {
        /* 开麦失败或已中止 */
      }
      cleanupMic();
      setStatus('idle');
      unlockDictationPointer();
      void window.electronAPI?.asrRealtimeCancel?.();
      optsRef.current.onError?.(e instanceof Error ? e.message : '无法开始语音听写');
      return false;
    }
    if (gen !== startGenRef.current) {
      sessionIdRef.current = null;
      cleanupMic();
      try {
        await micPromise;
      } catch {
        /* ignore */
      }
      cleanupMic();
      if (res.ok) void window.electronAPI.asrRealtimeCancel?.(res.sessionId);
      else void window.electronAPI?.asrRealtimeCancel?.();
      return false;
    }
    if (!res.ok) {
      sessionIdRef.current = null;
      cleanupMic();
      try {
        await micPromise;
      } catch {
        /* ignore */
      }
      cleanupMic();
      setStatus('idle');
      unlockDictationPointer();
      void window.electronAPI?.asrRealtimeCancel?.();
      optsRef.current.onError?.(res.message || '无法开始语音听写');
      return false;
    }
    sessionIdRef.current = res.sessionId;
    setStatus('listening');
    try {
      await micPromise;
      if (gen !== startGenRef.current) {
        cleanupMic();
        void window.electronAPI.asrRealtimeCancel?.(res.sessionId);
        sessionIdRef.current = null;
        return false;
      }
      flushPcmQueue();
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
      unlockDictationPointer();
      if (String(e) !== 'Error: MIC_DENIED' && String(e) !== 'Error: MIC_ABORTED') {
        const msg = e instanceof Error ? e.message : String(e);
        optsRef.current.onError?.(
          msg === 'NO_CAPTURE_PATH'
            ? '当前环境无法采集麦克风，请更新 Electron/系统权限后重试'
            : '无法打开麦克风',
        );
      }
      return false;
    }
  }, [cleanupMic, flushPcmQueue, startMicCapture]);

  const stop = useCallback(async () => {
    const gen = ++startGenRef.current;
    const sid = sessionIdRef.current;
    // 先停采再 force flush，避免结束等待期间继续往堆里塞 PCM（易 134）
    sendingRef.current = false;
    flushPcmQueue({ force: true });
    await new Promise<void>((r) => setTimeout(r, 40));
    if (gen !== startGenRef.current) return '';
    flushPcmQueue({ force: true });
    cleanupMic();
    if (!isRealAsrSessionId(sid)) {
      sessionIdRef.current = null;
      if (gen === startGenRef.current) setStatus('idle');
      void window.electronAPI?.asrRealtimeCancel?.();
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
      if (gen !== startGenRef.current) return dictation;
      sessionIdRef.current = null;
      setStatus('idle');
      setLiveText('');
      return dictation;
    } catch (e) {
      if (gen !== startGenRef.current) return '';
      sessionIdRef.current = null;
      setStatus('idle');
      const raw = e instanceof Error ? e.message : '结束听写失败';
      const friendly = /EmptyAudio|NO_VALID_AUDIO|empty.?audio/i.test(raw)
        ? '没有听清有效语音，请按住麦克风再说一会儿'
        : raw;
      optsRef.current.onError?.(friendly);
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
    if (isRealAsrSessionId(sid)) void window.electronAPI?.asrRealtimeCancel?.(sid);
    else void window.electronAPI?.asrRealtimeCancel?.();
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
