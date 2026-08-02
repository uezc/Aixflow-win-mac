import { useRef, useState, useCallback, useEffect, type RefObject, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { Square, Loader2 } from 'lucide-react';
import { rmsFromByteTimeDomain, smoothMicLevel } from '../utils/micInputLevel';

export function localResourceUrlFromSavedPath(savedPath: string): string {
  let p = (savedPath || '').replace(/\\/g, '/');
  if (p.match(/^[a-zA-Z]\//)) p = p[0].toUpperCase() + ':' + p.substring(1);
  else if (p.match(/^[a-zA-Z]:\//)) p = p[0].toUpperCase() + p.substring(1);
  if (p.match(/^\/[a-zA-Z]:/)) p = p.substring(1);
  return `local-resource://${p}`;
}

export interface ReferenceMicRecordingStrings {
  micPermissionDenied: string;
  micSaveFailed: string;
  recordTooShort: string;
  recordModalTitle: string;
  recordModalSubtitle: string;
  recordModalStop: string;
}

export interface UseReferenceMicRecordingOptions {
  projectId?: string;
  onSaved: (localResourceUrl: string, durationSec?: number) => void;
  /** 录音过短、保存失败等未进入 onSaved 时回调 */
  onRecordingFailed?: () => void;
  showAlert: (message: string) => void;
  strings: ReferenceMicRecordingStrings;
  isDarkMode: boolean;
  /**
   * push-to-talk：getUserMedia 返回后若已松手，返回 true 则放弃开录并释放麦。
   */
  shouldAbortAfterMic?: () => boolean;
}

export function useReferenceMicRecording({
  projectId,
  onSaved,
  onRecordingFailed,
  showAlert,
  strings,
  isDarkMode,
  shouldAbortAfterMic,
}: UseReferenceMicRecordingOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordStartedAtRef = useRef(0);
  const discardRecordingRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const waveformRafRef = useRef<number | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const levelSmoothRef = useRef(0);
  const levelTimeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const levelLastEmitRef = useRef(0);
  const [inputLevel, setInputLevel] = useState(0);
  const recordingVisualizerActiveRef = useRef(false);
  const waveCanvasRef = useRef<HTMLCanvasElement | null>(null);
  /** 平滑峰值，用于时域波形可视化自动增益（麦克风 raw 偏离通常很小） */
  const waveformSmoothedPeakRef = useRef(0.06);

  useEffect(() => {
    return () => {
      discardRecordingRef.current = true;
      recordingVisualizerActiveRef.current = false;
      if (waveformRafRef.current != null) {
        cancelAnimationFrame(waveformRafRef.current);
        waveformRafRef.current = null;
      }
      if (levelRafRef.current != null) {
        cancelAnimationFrame(levelRafRef.current);
        levelRafRef.current = null;
      }
      analyserRef.current = null;
      void audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
      levelSmoothRef.current = 0;
      setInputLevel(0);
      const mr = mediaRecorderRef.current;
      if (mr && mr.state !== 'inactive') {
        try {
          mr.stop();
        } catch {
          /* ignore */
        }
      }
      mediaRecorderRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    };
  }, []);

  /** 电平监测：不依赖波形 canvas，PTT 小按钮也可驱动波动 */
  useEffect(() => {
    if (!isRecording) {
      if (levelRafRef.current != null) {
        cancelAnimationFrame(levelRafRef.current);
        levelRafRef.current = null;
      }
      levelSmoothRef.current = 0;
      setInputLevel(0);
      return;
    }
    const tick = () => {
      const analyser = analyserRef.current;
      if (!analyser || !recordingVisualizerActiveRef.current) {
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
    return () => {
      if (levelRafRef.current != null) {
        cancelAnimationFrame(levelRafRef.current);
        levelRafRef.current = null;
      }
    };
  }, [isRecording]);

  useEffect(() => {
    if (!isRecording) return;
    waveformSmoothedPeakRef.current = 0.06;
    const canvas = waveCanvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const timeData = new Uint8Array(analyser.fftSize);

    const draw = () => {
      if (!recordingVisualizerActiveRef.current || !analyserRef.current) return;
      const c = waveCanvasRef.current;
      if (!c) return;
      const context = c.getContext('2d');
      if (!context) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(320, c.clientWidth);
      const cssH = Math.max(120, c.clientHeight);
      const needResize = c.width !== Math.floor(cssW * dpr) || c.height !== Math.floor(cssH * dpr);
      if (needResize) {
        c.width = Math.floor(cssW * dpr);
        c.height = Math.floor(cssH * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);

      const dark = isDarkMode;
      context.fillStyle = dark ? '#0c0c0e' : '#f4f4f5';
      context.fillRect(0, 0, cssW, cssH);

      // 单轨道：时域波形垂直方向尽量占满（自动增益 + 限幅）
      const waveMid = cssH / 2;
      const halfUsable = (cssH / 2) * 0.9;
      const maxGain = 100;
      analyserRef.current.getByteTimeDomainData(timeData);
      let framePeak = 1e-6;
      for (let i = 0; i < timeData.length; i++) {
        const dv = Math.abs(timeData[i] / 128 - 1);
        if (dv > framePeak) framePeak = dv;
      }
      const prevPeak = waveformSmoothedPeakRef.current;
      const attack = 0.38;
      const release = 0.014;
      const nextPeak =
        framePeak > prevPeak
          ? prevPeak + (framePeak - prevPeak) * attack
          : prevPeak + (framePeak - prevPeak) * release;
      waveformSmoothedPeakRef.current = Math.max(0.018, Math.min(0.95, nextPeak));
      const denom = Math.max(0.012, waveformSmoothedPeakRef.current);
      const gain = Math.min(maxGain, halfUsable / denom);

      context.lineWidth = 2;
      context.strokeStyle = dark ? '#4ade80' : '#16a34a';
      context.beginPath();
      const step = cssW / timeData.length;
      let x = 0;
      const yMin = 2;
      const yMax = cssH - 2;
      for (let i = 0; i < timeData.length; i++) {
        const rawV = timeData[i] / 128 - 1;
        const y = Math.min(yMax, Math.max(yMin, waveMid + rawV * gain));
        if (i === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
        x += step;
      }
      context.stroke();

      waveformRafRef.current = requestAnimationFrame(draw);
    };

    waveformRafRef.current = requestAnimationFrame(draw);
    return () => {
      if (waveformRafRef.current != null) {
        cancelAnimationFrame(waveformRafRef.current);
        waveformRafRef.current = null;
      }
    };
  }, [isRecording, isDarkMode]);

  const stopReferenceRecording = useCallback(() => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state === 'recording') {
      try {
        if (typeof mr.requestData === 'function') {
          mr.requestData();
        }
        mr.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const startReferenceRecording = useCallback(async () => {
    if (isRecording) {
      stopReferenceRecording();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      showAlert(strings.micPermissionDenied);
      return;
    }
    discardRecordingRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (shouldAbortAfterMic?.()) {
        stream.getTracks().forEach((t) => t.stop());
        onRecordingFailed?.();
        return;
      }
      mediaStreamRef.current = stream;

      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        const audioCtx = new AC();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.72;
        source.connect(analyser);
        analyserRef.current = analyser;
        recordingVisualizerActiveRef.current = true;
        try {
          if (audioCtx.state === 'suspended') await audioCtx.resume();
        } catch {
          /* ignore */
        }
      }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const mr = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      recordChunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        recordingVisualizerActiveRef.current = false;
        if (waveformRafRef.current != null) {
          cancelAnimationFrame(waveformRafRef.current);
          waveformRafRef.current = null;
        }
        analyserRef.current = null;
        const ac = audioContextRef.current;
        audioContextRef.current = null;
        if (ac) {
          try {
            await ac.close();
          } catch {
            /* ignore */
          }
        }

        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsRecording(false);
        if (discardRecordingRef.current) {
          discardRecordingRef.current = false;
          recordChunksRef.current = [];
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 120));
        const chunks = recordChunksRef.current;
        recordChunksRef.current = [];
        const recordedSec =
          recordStartedAtRef.current > 0
            ? Math.max(0.1, (performance.now() - recordStartedAtRef.current) / 1000)
            : 0;
        recordStartedAtRef.current = 0;
        const mimeType = mr.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        if (blob.size < 256) {
          showAlert(strings.recordTooShort);
          onRecordingFailed?.();
          return;
        }
        const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
        const hasWebmHeader =
          header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3;
        if (!hasWebmHeader) {
          console.warn('[useReferenceMicRecording] invalid webm header', Array.from(header));
          showAlert(strings.micSaveFailed);
          onRecordingFailed?.();
          return;
        }
        try {
          const buf = await blob.arrayBuffer();
          const ext = mimeType.includes('webm') ? 'webm' : 'webm';
          const api = window.electronAPI;
          if (!api?.saveDroppedFileBufferToProjectAssets) {
            showAlert(strings.micSaveFailed);
            onRecordingFailed?.();
            return;
          }
          const { savedPath } = await api.saveDroppedFileBufferToProjectAssets(
            projectId,
            `mic-ref-${Date.now()}.${ext}`,
            buf,
          );
          let finalPath = savedPath;
          let durationSec = 0;
          if (api.finalizeMicRecording) {
            try {
              const fixed = await api.finalizeMicRecording(projectId, savedPath);
              finalPath = fixed.savedPath;
              durationSec = fixed.durationSec;
            } catch (fixErr) {
              console.warn('[useReferenceMicRecording] finalizeMicRecording failed', fixErr);
            }
          }
          onSaved(
            localResourceUrlFromSavedPath(finalPath),
            durationSec > 0 ? durationSec : recordedSec > 0 ? recordedSec : undefined,
          );
        } catch (e) {
          console.error('[useReferenceMicRecording] save recording failed', e);
          showAlert(strings.micSaveFailed);
          onRecordingFailed?.();
        }
      };
      mr.start(250);
      recordStartedAtRef.current = performance.now();
      setIsRecording(true);
      if (shouldAbortAfterMic?.()) {
        discardRecordingRef.current = true;
        try {
          if (typeof mr.requestData === 'function') mr.requestData();
          mr.stop();
        } catch {
          /* ignore */
        }
      }
    } catch (e) {
      console.error('[useReferenceMicRecording] getUserMedia', e);
      recordingVisualizerActiveRef.current = false;
      if (waveformRafRef.current != null) {
        cancelAnimationFrame(waveformRafRef.current);
        waveformRafRef.current = null;
      }
      analyserRef.current = null;
      void audioContextRef.current?.close().catch(() => {});
      audioContextRef.current = null;
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      showAlert(strings.micPermissionDenied);
    }
  }, [
    isRecording,
    onSaved,
    onRecordingFailed,
    projectId,
    showAlert,
    shouldAbortAfterMic,
    stopReferenceRecording,
    strings.micPermissionDenied,
    strings.micSaveFailed,
    strings.recordTooShort,
  ]);

  return {
    isRecording,
    /** 0–1 麦克风输入电平 */
    inputLevel,
    waveCanvasRef,
    startReferenceRecording,
    stopReferenceRecording,
  };
}

export interface ReferenceMicRecordingPortalProps {
  open: boolean;
  isDarkMode: boolean;
  waveCanvasRef: RefObject<HTMLCanvasElement | null>;
  onStop: () => void;
  strings: Pick<ReferenceMicRecordingStrings, 'recordModalTitle' | 'recordModalSubtitle' | 'recordModalStop'>;
  /** 录音已结束，正在保存/转写 */
  processing?: boolean;
  processingTitle?: string;
  processingSubtitle?: string;
}

export function ReferenceMicRecordingPortal({
  open,
  isDarkMode,
  waveCanvasRef,
  onStop,
  strings,
  processing = false,
  processingTitle,
  processingSubtitle,
}: ReferenceMicRecordingPortalProps) {
  if (typeof document === 'undefined' || !open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center p-4 bg-black/55 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nexflow-audio-record-modal-title"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className={`w-full max-w-lg rounded-2xl border-2 shadow-2xl p-5 flex flex-col gap-4 ${
          isDarkMode
            ? 'border-green-500/50 bg-[#1C1C1E] text-white'
            : 'border-green-600/40 bg-white text-gray-900'
        }`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-10 w-10 items-center justify-center rounded-full ${
              processing
                ? isDarkMode
                  ? 'bg-white/10 text-white/80'
                  : 'bg-gray-100 text-gray-600'
                : 'bg-green-500/20 text-green-400'
            }`}
          >
            {processing ? (
              <Loader2 className="h-5 w-5 animate-spin" strokeWidth={2.25} />
            ) : (
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="nexflow-audio-record-modal-title" className="text-base font-semibold">
              {processing ? processingTitle ?? strings.recordModalTitle : strings.recordModalTitle}
            </h2>
            <p className={`mt-1 text-xs ${isDarkMode ? 'text-white/60' : 'text-gray-600'}`}>
              {processing ? processingSubtitle ?? strings.recordModalSubtitle : strings.recordModalSubtitle}
            </p>
          </div>
        </div>
        {processing ? (
          <div
            className={`flex h-40 w-full items-center justify-center rounded-xl border ${
              isDarkMode ? 'border-white/10 bg-black/40' : 'border-gray-200 bg-gray-50'
            }`}
          >
            <div className="flex flex-col items-center gap-2">
              <Loader2 className={`h-8 w-8 animate-spin ${isDarkMode ? 'text-green-400' : 'text-green-600'}`} />
              <span className={`text-xs ${isDarkMode ? 'text-white/55' : 'text-gray-500'}`}>
                {processingSubtitle ?? processingTitle}
              </span>
            </div>
          </div>
        ) : (
          <canvas
            ref={waveCanvasRef as Ref<HTMLCanvasElement>}
            className={`h-40 w-full rounded-xl border ${
              isDarkMode ? 'border-white/10 bg-black/40' : 'border-gray-200 bg-gray-50'
            }`}
            width={640}
            height={160}
          />
        )}
        {!processing ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onStop();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80"
            >
              <Square className="h-4 w-4 fill-current" />
              {strings.recordModalStop}
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
