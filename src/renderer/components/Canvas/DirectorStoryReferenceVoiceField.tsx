/**
 * MV/短剧「参考」语音输入：听写状态只在本组件内更新，避免拖垮巨大的 DirectorNode。
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useCloudRealtimeDictation } from '../../hooks/useCloudRealtimeDictation';
import { useDictationPushToTalk } from '../../hooks/useDictationPushToTalk';
import { registerDictationTarget } from '../../utils/dictationTargetRegistry';
import { micLevelCssVars } from '../../utils/micInputLevel';
import {
  acquireVoiceModalLock,
  forceClearVoiceModalLock,
  releaseVoiceModalLock,
} from '../../utils/voiceModalGate';
import VoiceMicGlyph from './VoiceMicGlyph';
import { abortAllPushToTalkPointers } from '../../utils/pushToTalkPointer';

export type DirectorStoryReferenceVoiceFieldProps = {
  value: string;
  onChange: (next: string) => void;
  isDarkMode: boolean;
  placeholder: string;
  textareaClassName: string;
  textareaStyle?: React.CSSProperties;
  rows?: number;
  minHeightPx?: number;
  /** 左侧标题（MV）；短剧可省略，话筒单独右对齐 */
  label?: React.ReactNode;
  labels: {
    voiceStart: string;
    voiceStop: string;
    voiceBusy: string;
    micDenied: string;
  };
  onError: (message: string) => void;
  enabled?: boolean;
};

function growTextarea(el: HTMLTextAreaElement | null, minHeightPx: number) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(minHeightPx, el.scrollHeight)}px`;
}

const ReferenceTextarea = memo(function ReferenceTextarea({
  displayValue,
  readOnly,
  className,
  style,
  rows,
  minHeightPx,
  placeholder,
  onChange,
  onRef,
}: {
  displayValue: string;
  readOnly: boolean;
  className: string;
  style?: React.CSSProperties;
  rows: number;
  minHeightPx: number;
  placeholder: string;
  onChange: (value: string) => void;
  onRef: (el: HTMLTextAreaElement | null) => void;
}) {
  const bindRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      onRef(el);
      growTextarea(el, minHeightPx);
    },
    [onRef, minHeightPx],
  );
  return (
    <textarea
      className={className}
      style={{ ...style, minHeight: minHeightPx }}
      rows={rows}
      value={displayValue}
      readOnly={readOnly}
      onChange={(e) => {
        if (readOnly) return;
        onChange(e.target.value);
      }}
      placeholder={placeholder}
      onPointerDown={(e) => e.stopPropagation()}
      ref={bindRef}
      onInput={(e) => growTextarea(e.currentTarget, minHeightPx)}
    />
  );
});

const DirectorStoryReferenceVoiceField: React.FC<DirectorStoryReferenceVoiceFieldProps> = memo(
  function DirectorStoryReferenceVoiceField({
    value,
    onChange,
    isDarkMode,
    placeholder,
    textareaClassName,
    textareaStyle,
    rows = 3,
    minHeightPx = 72,
    label,
    labels,
    onError,
    enabled = true,
  }) {
    const valueRef = useRef(value);
    valueRef.current = value;
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const liveTextRef = useRef<string | null>(null);
    const draftFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const persistRafRef = useRef<number | null>(null);
    const editGenRef = useRef(0);
    const bindTextareaRef = useCallback((el: HTMLTextAreaElement | null) => {
      textareaRef.current = el;
    }, []);
    const [voiceDraft, setVoiceDraft] = useState<string | null>(null);
    const [externalLive, setExternalLive] = useState(false);
    const [asrHint, setAsrHint] = useState<string | null>(null);

    const cancelPendingWrites = useCallback(() => {
      if (draftFlushRef.current != null) {
        clearTimeout(draftFlushRef.current);
        draftFlushRef.current = null;
      }
      if (persistRafRef.current != null) {
        cancelAnimationFrame(persistRafRef.current);
        persistRafRef.current = null;
      }
    }, []);

    const persistDraft = useCallback((next?: string | null) => {
      const gen = editGenRef.current;
      cancelPendingWrites();
      const fromEl = textareaRef.current?.value;
      const text = String(next ?? liveTextRef.current ?? fromEl ?? '').trimEnd();
      liveTextRef.current = text || null;
      setVoiceDraft(text);
      persistRafRef.current = requestAnimationFrame(() => {
        persistRafRef.current = null;
        if (gen !== editGenRef.current) return;
        onChangeRef.current(text);
      });
    }, [cancelPendingWrites]);

    const handleTextChange = useCallback((next: string) => {
      cancelPendingWrites();
      editGenRef.current += 1;
      liveTextRef.current = null;
      valueRef.current = next;
      setVoiceDraft(next);
      onChangeRef.current(next);
    }, [cancelPendingWrites]);

    const reportError = useCallback((message: string) => {
      forceClearVoiceModalLock();
      abortAllPushToTalkPointers();
      persistDraft();
      setExternalLive(false);
      setAsrHint(message);
      if (!/超时|网络|timeout|TIMEOUT/i.test(message)) {
        onErrorRef.current(message);
      }
    }, [persistDraft]);

    const {
      status,
      isActive,
      inputLevel,
      start,
      stop,
      cancel: cancelRaw,
    } = useCloudRealtimeDictation({
      getBaseText: () => {
        const fromEl = textareaRef.current?.value;
        const prev = String(
          fromEl != null ? fromEl : valueRef.current || '',
        ).trimEnd();
        return prev ? `${prev} ` : '';
      },
      onLiveText: (full) => {
        const gen = editGenRef.current;
        liveTextRef.current = full;
        const el = textareaRef.current;
        if (el && el.value !== full) el.value = full;
        if (draftFlushRef.current != null) return;
        draftFlushRef.current = setTimeout(() => {
          draftFlushRef.current = null;
          if (gen !== editGenRef.current) return;
          const live = liveTextRef.current;
          if (live != null) setVoiceDraft(live);
        }, 160);
      },
      onCommitted: (_dictation, full) => {
        liveTextRef.current = full || null;
        setVoiceDraft(full || '');
        setExternalLive(false);
        onChangeRef.current(full || '');
      },
      onError: reportError,
      onMicDenied: () => reportError(labels.micDenied),
    });

    const cancel = useCallback(() => {
      persistDraft();
      setExternalLive(false);
      cancelRaw();
      forceClearVoiceModalLock();
    }, [cancelRaw, persistDraft]);

    const stopSafe = useCallback(async () => {
      const result = await stop();
      persistDraft();
      setExternalLive(false);
      return result;
    }, [stop, persistDraft]);

    const micBusy = status === 'connecting' || status === 'stopping';
    const voiceUiActive =
      status === 'listening' || status === 'connecting' || externalLive;

    const { pointerHandlers } = useDictationPushToTalk({
      start: async () => {
        cancelPendingWrites();
        liveTextRef.current = null;
        setAsrHint(null);
        return start();
      },
      stop: stopSafe,
      cancel,
      status,
      disabled: !enabled,
    });

    useEffect(() => {
      if (status !== 'listening') return;
      acquireVoiceModalLock();
      return () => releaseVoiceModalLock();
    }, [status]);

    useEffect(() => {
      if (!enabled) cancel();
    }, [enabled, cancel]);

    useEffect(() => {
      const onForceEnd = () => cancel();
      window.addEventListener('nexflow-force-end-dictation', onForceEnd);
      return () => window.removeEventListener('nexflow-force-end-dictation', onForceEnd);
    }, [cancel]);

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      return registerDictationTarget(el, {
        getText: () => {
          if (liveTextRef.current != null) return liveTextRef.current;
            return String(textareaRef.current?.value ?? valueRef.current ?? '');
        },
        setText: (text) => {
          liveTextRef.current = text;
          setVoiceDraft(text);
          if (el.value !== text) el.value = text;
          setExternalLive((v) => v || true);
        },
        commit: () => {
          persistDraft();
          setExternalLive(false);
        },
        isAvailable: () => el.isConnected && !el.disabled && enabled,
      });
    }, [enabled, persistDraft]);

    useEffect(() => {
      if (voiceDraft == null) return;
      if (String(value || '') === voiceDraft) setVoiceDraft(null);
    }, [value, voiceDraft]);

    const title =
      status === 'connecting'
        ? '正在连接语音识别，请按住不放…'
        : micBusy
          ? labels.voiceBusy
          : isActive
            ? labels.voiceStop
            : labels.voiceStart;

    const micBtn = (
      <button
        type="button"
        {...pointerHandlers}
        disabled={!enabled}
        style={{
          pointerEvents: 'auto',
          touchAction: 'none',
          ...(status === 'listening' || status === 'connecting'
            ? micLevelCssVars(inputLevel)
            : {}),
        }}
        className={`nexflow-voice-mic-btn nodrag nopan nowheel relative z-[80] flex h-9 w-9 shrink-0 items-center justify-center rounded-md border select-none ${
          status === 'connecting'
            ? 'connecting'
            : status === 'listening'
              ? 'listening'
              : ''
        } ${
          !enabled
            ? isDarkMode
              ? 'cursor-not-allowed border-white/15 bg-white/5 text-white/35'
              : 'cursor-not-allowed border-gray-200 bg-white/90 text-gray-400'
            : isDarkMode
              ? 'cursor-pointer border-white/25 bg-black/55 text-white/85 hover:bg-white/10 hover:text-white'
              : 'cursor-pointer border-gray-300 bg-white/95 text-gray-700 hover:bg-gray-100'
        }`}
        title={title}
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <VoiceMicGlyph
          busy={micBusy}
          active={status === 'listening'}
          level={inputLevel}
          size="md"
        />
      </button>
    );

    const textarea = (
      <ReferenceTextarea
        displayValue={voiceDraft != null ? voiceDraft : value}
        readOnly={voiceUiActive}
        className={`${textareaClassName} pr-11`}
        style={textareaStyle}
        rows={rows}
        minHeightPx={minHeightPx}
        placeholder={placeholder}
        onChange={handleTextChange}
        onRef={bindTextareaRef}
      />
    );

    const field = (
      <div className="relative">
        {textarea}
        <div className="pointer-events-auto absolute top-1.5 right-1.5 z-[80]">{micBtn}</div>
        {asrHint ? (
          <div
            className={`mt-1.5 text-[11px] leading-snug ${
              isDarkMode ? 'text-amber-300/90' : 'text-amber-700'
            }`}
          >
            {asrHint}
          </div>
        ) : null}
      </div>
    );

    if (label != null) {
      return (
        <>
          {label}
          {field}
        </>
      );
    }

    return field;
  },
);

export default DirectorStoryReferenceVoiceField;
