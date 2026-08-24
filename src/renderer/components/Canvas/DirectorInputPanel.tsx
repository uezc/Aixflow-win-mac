import React, { useCallback, useMemo, useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { directorPipelineT } from '../../i18n/directorPipelineI18n';
import { LLM_CHAT_DISPLAY_MODEL_ID, LLM_CHAT_MODEL_IDS, LLM_CHAT_MODEL_LABELS } from '../../utils/cloudModelPricing';
import { assetLibBtnPrimary } from '../../utils/assetLibraryChrome';
import {
  applyDirectorShotsPatch,
  buildDirectorShotsMessages,
  createDefaultDirectorPipelineState,
  normalizeDirectorShotsResult,
  resolveDirectorStylePrompt,
  type DirectorPipelineState,
} from '../../../shared/directorPipeline';

const CHAT_MODELS = LLM_CHAT_MODEL_IDS;

export interface DirectorInputPanelProps {
  nodeId: string;
  projectId?: string | null;
  isDarkMode?: boolean;
  userPrompt: string;
  scriptText: string;
  chatModel?: string;
  director?: DirectorPipelineState;
  onUserPromptChange: (v: string) => void;
  onChatModelChange?: (m: string) => void;
  onDirectorChange: (director: DirectorPipelineState) => void;
  onGeneratingChange?: (v: boolean) => void;
  onErrorChange?: (err: string | null) => void;
  onRunStart?: () => void;
}

const DirectorInputPanel: React.FC<DirectorInputPanelProps> = ({
  nodeId,
  projectId,
  isDarkMode = true,
  userPrompt,
  scriptText,
  chatModel = LLM_CHAT_DISPLAY_MODEL_ID,
  director,
  onUserPromptChange,
  onChatModelChange,
  onDirectorChange,
  onGeneratingChange,
  onErrorChange,
  onRunStart,
}) => {
  const { locale } = useAppLocale();
  const tt = useMemo(() => directorPipelineT(locale), [locale]);
  const [busy, setBusy] = useState(false);

  const model = useMemo(() => {
    const raw = (chatModel || LLM_CHAT_DISPLAY_MODEL_ID).trim();
    return (CHAT_MODELS as readonly string[]).includes(raw) ? raw : LLM_CHAT_DISPLAY_MODEL_ID;
  }, [chatModel]);

  const { execute } = useAI({
    nodeId: `${nodeId}-director-shots`,
    modelId: 'chat',
    onComplete: (payload) => {
      setBusy(false);
      onGeneratingChange?.(false);
      const text = String(payload?.text ?? payload?.content ?? payload?.result ?? '').trim();
      if (payload?.error && !text) {
        onErrorChange?.(String(payload.error));
        return;
      }
      const prev = createDefaultDirectorPipelineState({
        ...(director || {}),
        scriptText: String(director?.scriptText || scriptText || '').trim(),
        chatModel: model,
      });
      const normalized = normalizeDirectorShotsResult(text);
      if (!normalized.ok) {
        onErrorChange?.(tt.generateFailed + (normalized.error ? `: ${normalized.error}` : ''));
        return;
      }
      onErrorChange?.(null);
      onDirectorChange(applyDirectorShotsPatch(prev, normalized));
    },
    onError: (msg) => {
      setBusy(false);
      onGeneratingChange?.(false);
      onErrorChange?.(msg || tt.generateFailed);
    },
  });

  const handleSend = useCallback(async () => {
    const baseScript = String(scriptText || '').trim();
    const extra = String(userPrompt || '').trim();
    const combined = [baseScript, extra].filter(Boolean).join('\n\n');
    if (!combined) {
      onErrorChange?.(tt.generateNeedScript);
      return;
    }
    if (busy) return;
    setBusy(true);
    onGeneratingChange?.(true);
    onErrorChange?.(null);
    onRunStart?.();

    try {
      const styleHint = resolveDirectorStylePrompt(director?.stylePresetId, director?.globalStyle);
      const { systemPrompt, userPrompt: up } = buildDirectorShotsMessages(combined, styleHint);
      await execute({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: up },
        ],
        stream: false,
        projectId: projectId || undefined,
        nodeTitle: 'MV导演',
      });
    } catch (e) {
      setBusy(false);
      onGeneratingChange?.(false);
      onErrorChange?.(e instanceof Error ? e.message : tt.generateFailed);
    }
  }, [
    scriptText,
    userPrompt,
    busy,
    projectId,
    model,
    director?.stylePresetId,
    director?.globalStyle,
    execute,
    onErrorChange,
    onGeneratingChange,
    onRunStart,
    tt.generateFailed,
    tt.generateNeedScript,
  ]);

  const dark = isDarkMode;
  const panelBg = dark
    ? 'nexflow-glass-panel ring-1 ring-white/[0.08]'
    : 'apple-panel-light ring-1 ring-gray-300/80 bg-gray-100';

  return (
    <div
      className={`rounded-xl shadow-lg overflow-hidden ${panelBg}`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="p-2.5 flex flex-col gap-2">
        <textarea
          className={`nodrag nopan w-full min-h-[72px] max-h-[160px] resize-y rounded-lg px-3 py-2 text-sm outline-none ${
            dark
              ? 'bg-white/[0.04] text-white/90 placeholder:text-white/35 focus:ring-1 focus:ring-blue-500/40'
              : 'bg-gray-100 text-gray-900 placeholder:text-gray-400 border border-gray-300/80 focus:ring-1 focus:ring-sky-400/40'
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
          <label className={`flex items-center gap-1.5 text-[11px] ${dark ? 'text-white/50' : 'text-gray-600'}`}>
            <span>{tt.modelLabel}</span>
            <select
              className={`nodrag rounded-md px-2 py-1 text-[11px] ${
                dark
                  ? 'bg-zinc-950 text-white/80 ring-1 ring-white/10'
                  : 'bg-gray-100 text-gray-800 border border-gray-300 shadow-sm'
              }`}
              value={model}
              disabled={busy}
              onChange={(e) => onChatModelChange?.(e.target.value)}
            >
              {CHAT_MODELS.map((m) => (
                <option key={m} value={m}>
                  {LLM_CHAT_MODEL_LABELS[m] || m}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`nodrag inline-flex items-center gap-1.5 disabled:opacity-50 ${assetLibBtnPrimary(isDarkMode, '', 'motion')}`}
            disabled={busy}
            onClick={() => void handleSend()}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {tt.generateShots}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DirectorInputPanel;
