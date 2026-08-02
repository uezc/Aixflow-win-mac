import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { storyboardScriptT } from '../../i18n/storyboardScriptI18n';
import {
  LLM_CHAT_DISPLAY_MODEL_ID,
  LLM_CHAT_MODEL_IDS,
  LLM_CHAT_MODEL_GPT56_TERRA,
  LLM_CHAT_MODEL_LABELS,
} from '../../utils/cloudModelPricing';
import { prepareStoryboardScriptChatInput } from '../../utils/prepareStoryboardScriptChatInput';
import {
  buildStoryboardScriptStatePatch,
  createDefaultStoryboardScriptState,
  normalizeStoryboardScriptGenerationResult,
  type StoryboardScriptState,
  type SourceMode,
} from '../../../shared/storyboardScript';

const CHAT_MODELS = LLM_CHAT_MODEL_IDS;

export interface StoryboardScriptInputPanelProps {
  nodeId: string;
  projectId?: string | null;
  isDarkMode?: boolean;
  userPrompt: string;
  chatModel?: string;
  storyboardScript?: StoryboardScriptState;
  imageUrls: string[];
  videoUrls: string[];
  onUserPromptChange: (v: string) => void;
  onChatModelChange?: (m: string) => void;
  onScriptChange: (script: StoryboardScriptState) => void;
  onGeneratingChange?: (v: boolean) => void;
  onErrorChange?: (err: string | null) => void;
  onRunStart?: () => void;
}

const StoryboardScriptInputPanel: React.FC<StoryboardScriptInputPanelProps> = ({
  nodeId,
  projectId,
  isDarkMode = true,
  userPrompt,
  chatModel = LLM_CHAT_DISPLAY_MODEL_ID,
  storyboardScript,
  imageUrls,
  videoUrls,
  onUserPromptChange,
  onChatModelChange,
  onScriptChange,
  onGeneratingChange,
  onErrorChange,
  onRunStart,
}) => {
  const { locale } = useAppLocale();
  const tt = useMemo(() => storyboardScriptT(locale), [locale]);
  const [busy, setBusy] = useState(false);
  const lastSourceModeRef = useRef<SourceMode>('text');

  const model = useMemo(() => {
    const raw = (chatModel || LLM_CHAT_DISPLAY_MODEL_ID).trim();
    return (CHAT_MODELS as readonly string[]).includes(raw) ? raw : LLM_CHAT_DISPLAY_MODEL_ID;
  }, [chatModel]);

  const { execute } = useAI({
    nodeId,
    modelId: 'chat',
    onComplete: (payload) => {
      setBusy(false);
      onGeneratingChange?.(false);
      const text = String(payload?.text ?? payload?.content ?? payload?.result ?? '').trim();
      if (payload?.error && !text) {
        onErrorChange?.(String(payload.error));
        return;
      }
      const prev = createDefaultStoryboardScriptState(storyboardScript || {});
      const normalized = normalizeStoryboardScriptGenerationResult(text, {
        sourceMode: lastSourceModeRef.current,
      });
      if (!normalized.ok) {
        onErrorChange?.(tt.generateFailed + (normalized.error ? `: ${normalized.error}` : ''));
        return;
      }
      onErrorChange?.(null);
      onScriptChange(
        buildStoryboardScriptStatePatch({
          normalized,
          prev,
          sourceMode: lastSourceModeRef.current,
          mediaMode: prev.mediaMode,
          viewMode: prev.viewMode,
        }),
      );
    },
    onError: (msg) => {
      setBusy(false);
      onGeneratingChange?.(false);
      onErrorChange?.(msg || tt.generateFailed);
    },
  });

  const handleSend = useCallback(async () => {
    const prompt = String(userPrompt || '').trim();
    if (!prompt && imageUrls.length === 0 && videoUrls.length === 0) {
      onErrorChange?.(tt.generateNeedInput);
      return;
    }
    if (busy) return;
    setBusy(true);
    onGeneratingChange?.(true);
    onErrorChange?.(null);
    onRunStart?.();

    try {
      const prepared = await prepareStoryboardScriptChatInput({
        promptText: prompt,
        imageUrls,
        videoUrls,
        projectId: projectId || undefined,
      });
      lastSourceModeRef.current = prepared.sourceMode;

      const messages: Array<{ role: string; content: unknown }> = [];
      if (prepared.systemPrompt) {
        messages.push({ role: 'system', content: prepared.systemPrompt });
      }

      if (prepared.chatImageUrls.length > 0) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: prepared.userPrompt },
            ...prepared.chatImageUrls.map((url) => ({
              type: 'image_url',
              image_url: { url },
            })),
          ],
        });
      } else {
        messages.push({ role: 'user', content: prepared.userPrompt });
      }

      const chatModelId =
        prepared.chatImageUrls.length > 0 && model === LLM_CHAT_DISPLAY_MODEL_ID ? 'gpt-4o' : model;

      await execute({
        model: chatModelId,
        messages,
        stream: false,
        projectId: projectId || undefined,
        nodeTitle: '分镜脚本',
      });
    } catch (e) {
      setBusy(false);
      onGeneratingChange?.(false);
      onErrorChange?.(e instanceof Error ? e.message : tt.generateFailed);
    }
  }, [
    userPrompt,
    imageUrls,
    videoUrls,
    busy,
    projectId,
    model,
    execute,
    onErrorChange,
    onGeneratingChange,
    onRunStart,
    tt.generateFailed,
    tt.generateNeedInput,
  ]);

  const dark = isDarkMode;
  const panelBg = dark ? 'nexflow-glass-panel border-zinc-700' : 'bg-white border-slate-200';

  return (
    <div
      className={`rounded-xl border shadow-lg overflow-hidden ${panelBg}`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="p-2.5 flex flex-col gap-2">
        <textarea
          className={`nodrag nopan w-full min-h-[72px] max-h-[160px] resize-y rounded-lg border px-3 py-2 text-sm outline-none ${
            dark
              ? 'bg-zinc-950/80 border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
              : 'bg-white border-slate-200 text-slate-900'
          }`}
          placeholder={tt.promptPlaceholder}
          value={userPrompt}
          onChange={(e) => onUserPromptChange(e.target.value)}
          disabled={busy}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <label className={`flex items-center gap-1.5 text-[11px] ${dark ? 'text-zinc-400' : 'text-slate-600'}`}>
            <span>{tt.modelLabel}</span>
            <select
              className={`nodrag rounded-md border px-2 py-1 text-[11px] ${
                dark ? 'bg-zinc-900 border-zinc-700 text-zinc-200' : 'bg-white border-slate-200'
              }`}
              value={model}
              disabled={busy}
              onChange={(e) => onChatModelChange?.(e.target.value)}
            >
              <option value={LLM_CHAT_DISPLAY_MODEL_ID}>{LLM_CHAT_MODEL_LABELS[LLM_CHAT_DISPLAY_MODEL_ID]}</option>
              <option value="gpt-4o">{LLM_CHAT_MODEL_LABELS['gpt-4o']}</option>
              <option value={LLM_CHAT_MODEL_GPT56_TERRA}>{LLM_CHAT_MODEL_LABELS[LLM_CHAT_MODEL_GPT56_TERRA]}</option>
            </select>
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleSend()}
            className={`inline-flex items-center justify-center w-9 h-9 rounded-full shrink-0 ${
              busy
                ? 'bg-zinc-700 text-zinc-400'
                : 'bg-amber-500 hover:bg-amber-400 text-zinc-950'
            }`}
            title={busy ? tt.generating : tt.send}
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StoryboardScriptInputPanel;
