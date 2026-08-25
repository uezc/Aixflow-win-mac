import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import {
  buildMinimaxH3SmartPromptDraft,
  buildMinimaxH3SmartPromptMessages,
  parseMinimaxH3FullRefPrompt,
  type MinimaxH3SmartPromptSlot,
} from '../../../shared/minimaxH3SmartPrompt';
import { coerceAssistantText } from '../../../shared/directorPipeline/normalize';
import { LLM_CHAT_DISPLAY_MODEL_ID } from '../../utils/cloudModelPricing';

export type MinimaxH3SmartPromptPanelStrings = {
  smartPromptTitle: string;
  smartPromptHint: string;
  smartPromptSlotLabel: (n: number) => string;
  smartPromptSlotPlaceholder: string;
  smartPromptUseRefAudio: string;
  smartPromptPlotLabel: string;
  smartPromptPlotPlaceholder: string;
  smartPromptGenerate: string;
  smartPromptGenerating: string;
  smartPromptNeedImages: string;
  smartPromptNeedAudio: string;
  smartPromptNeedSlotOrPlot: string;
  smartPromptEmptyResult: string;
  smartPromptFailed: string;
};

type Props = {
  nodeId: string;
  isDarkMode: boolean;
  imageCount: number;
  /** 原音模式：生成前必须有参考音 */
  requireRefAudio: boolean;
  inputAudioUrl?: string;
  projectId?: string;
  strings: MinimaxH3SmartPromptPanelStrings;
  onPromptReady: (prompt: string) => void;
  showAlert: (message: string) => void;
};

const emptySlot = (): MinimaxH3SmartPromptSlot => ({
  description: '',
  useRefAudioTimbre: false,
});

const MinimaxH3SmartPromptPanel: React.FC<Props> = ({
  nodeId,
  isDarkMode,
  imageCount,
  requireRefAudio,
  inputAudioUrl,
  projectId,
  strings: t,
  onPromptReady,
  showAlert,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [slots, setSlots] = useState<MinimaxH3SmartPromptSlot[]>(() =>
    Array.from({ length: Math.max(imageCount, 1) }, emptySlot),
  );
  const [plot, setPlot] = useState('');
  const [busy, setBusy] = useState(false);
  const chatResolverRef = useRef<{
    resolve: (text: string) => void;
    reject: (err: Error) => void;
  } | null>(null);

  useEffect(() => {
    setSlots((prev) => {
      const n = Math.max(imageCount, 0);
      if (prev.length === n) return prev;
      if (prev.length < n) {
        return [...prev, ...Array.from({ length: n - prev.length }, emptySlot)];
      }
      return prev.slice(0, n);
    });
  }, [imageCount]);

  const { execute: executeChat } = useAI({
    nodeId: `${nodeId}__minimax_h3_smart_prompt`,
    modelId: 'chat',
    onComplete: (payload) => {
      const text = coerceAssistantText(
        payload?.text ?? payload?.content ?? payload?.result ?? '',
      );
      const resolver = chatResolverRef.current;
      chatResolverRef.current = null;
      if (!resolver) return;
      if (payload?.error && !text) {
        resolver.reject(new Error(String(payload.error)));
        return;
      }
      resolver.resolve(text);
    },
    onError: (msg) => {
      const resolver = chatResolverRef.current;
      chatResolverRef.current = null;
      if (resolver) resolver.reject(new Error(msg || t.smartPromptFailed));
    },
  });

  const runChat = useCallback(
    async (systemPrompt: string, userPrompt: string) => {
      return new Promise<string>((resolve, reject) => {
        chatResolverRef.current = { resolve, reject };
        void executeChat({
          model: LLM_CHAT_DISPLAY_MODEL_ID,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          stream: false,
          projectId: projectId || undefined,
          nodeTitle: 'MiniMax智能提示词',
          max_tokens: 8192,
          temperature: 0.4,
        }).catch((e) => {
          chatResolverRef.current = null;
          reject(e instanceof Error ? e : new Error(String(e)));
        });
      });
    },
    [executeChat, projectId],
  );

  const hasAnySlotText = useMemo(
    () => slots.some((s) => String(s.description || '').trim()),
    [slots],
  );

  const handleGenerate = useCallback(async () => {
    if (busy) return;
    if (imageCount <= 0) {
      showAlert(t.smartPromptNeedImages);
      return;
    }
    if (requireRefAudio && !String(inputAudioUrl || '').trim()) {
      showAlert(t.smartPromptNeedAudio);
      return;
    }
    if (!hasAnySlotText && !String(plot || '').trim()) {
      showAlert(t.smartPromptNeedSlotOrPlot);
      return;
    }

    const draft = buildMinimaxH3SmartPromptDraft({
      slots,
      plot,
      imageCount,
    });
    const { systemPrompt, userPrompt } = buildMinimaxH3SmartPromptMessages(draft);

    setBusy(true);
    try {
      const text = await runChat(systemPrompt, userPrompt);
      const next = parseMinimaxH3FullRefPrompt(text);
      if (!next || !/^\s*subject_definitions\s*:/i.test(next)) {
        throw new Error(t.smartPromptEmptyResult);
      }
      onPromptReady(next);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e || '');
      showAlert(msg || t.smartPromptFailed);
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    hasAnySlotText,
    imageCount,
    inputAudioUrl,
    onPromptReady,
    plot,
    requireRefAudio,
    runChat,
    showAlert,
    slots,
    t,
  ]);

  const updateSlot = useCallback((index: number, patch: Partial<MinimaxH3SmartPromptSlot>) => {
    setSlots((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  }, []);

  const shellCls = isDarkMode
    ? 'border-white/12 bg-black/25'
    : 'border-gray-300/70 bg-white/50';
  const labelCls = isDarkMode ? 'text-white/80' : 'text-gray-800';
  const mutedCls = isDarkMode ? 'text-white/45' : 'text-gray-500';
  const inputCls = isDarkMode
    ? 'bg-black/40 border-white/15 text-white/90 placeholder:text-white/30'
    : 'bg-white/90 border-gray-300 text-gray-900 placeholder:text-gray-400';

  return (
    <div className={`mb-2 rounded-lg border ${shellCls} nodrag nopan`}>
      <button
        type="button"
        className={`w-full flex items-center gap-1.5 px-2 py-1.5 text-left ${labelCls}`}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-70" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0 opacity-70" />
        )}
        <span className="text-xs font-medium">{t.smartPromptTitle}</span>
        <span className={`text-[10px] ml-auto ${mutedCls}`}>{t.smartPromptHint}</span>
      </button>

      {expanded && (
        <div className="px-2 pb-2 flex flex-col gap-1.5">
          {imageCount <= 0 ? (
            <p className={`text-[11px] leading-snug ${mutedCls}`}>{t.smartPromptNeedImages}</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-[120px] overflow-y-auto custom-scrollbar pr-0.5">
              {slots.slice(0, imageCount).map((slot, index) => (
                <div key={index} className="flex items-center gap-1.5 min-w-0">
                  <span className={`text-[10px] shrink-0 w-9 ${mutedCls}`}>
                    {t.smartPromptSlotLabel(index + 1)}
                  </span>
                  <input
                    type="text"
                    value={slot.description}
                    onChange={(e) => updateSlot(index, { description: e.target.value })}
                    placeholder={t.smartPromptSlotPlaceholder}
                    className={`flex-1 min-w-0 h-7 px-1.5 rounded border text-[11px] outline-none ${inputCls}`}
                    disabled={busy}
                  />
                  <label
                    className={`flex items-center gap-1 shrink-0 text-[10px] cursor-pointer select-none ${mutedCls}`}
                    title={t.smartPromptUseRefAudio}
                  >
                    <input
                      type="checkbox"
                      checked={!!slot.useRefAudioTimbre}
                      onChange={(e) =>
                        updateSlot(index, { useRefAudioTimbre: e.target.checked })
                      }
                      disabled={busy}
                      className="accent-emerald-500"
                    />
                    <span className="max-w-[72px] truncate">{t.smartPromptUseRefAudio}</span>
                  </label>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-0.5">
            <label className={`text-[10px] font-medium ${labelCls}`}>
              {t.smartPromptPlotLabel}
            </label>
            <textarea
              value={plot}
              onChange={(e) => setPlot(e.target.value)}
              placeholder={t.smartPromptPlotPlaceholder}
              rows={3}
              disabled={busy}
              className={`w-full resize-none rounded border px-1.5 py-1 text-[11px] leading-snug outline-none ${inputCls}`}
            />
          </div>

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={busy}
            className={`self-start inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] font-medium transition-colors ${
              busy
                ? isDarkMode
                  ? 'bg-white/15 text-white/40 cursor-not-allowed'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : isDarkMode
                  ? 'bg-emerald-500/25 text-emerald-200 hover:bg-emerald-500/35 border border-emerald-400/30'
                  : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            {busy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {t.smartPromptGenerating}
              </>
            ) : (
              t.smartPromptGenerate
            )}
          </button>
        </div>
      )}
    </div>
  );
};

export default MinimaxH3SmartPromptPanel;
