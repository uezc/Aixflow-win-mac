import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppLocale } from '../../contexts/AppLocaleContext';
import { useDarkAlert } from '../../contexts/DarkAlertContext';
import { canvasShortcutsT } from '../../i18n/canvasShortcutsI18n';
import {
  buildDefaultCanvasOperationRows,
  buildDefaultCanvasShortcutSections,
  type CanvasShortcutOpRow,
  type CanvasShortcutRow,
  type CanvasShortcutSection,
} from '../../utils/canvasShortcutsCatalog';
import {
  resetVoiceInputShortcut,
  setVoiceShortcutRecording,
  shortcutFromKeyboardEvent,
  voiceInputShortcutToKeycaps,
  writeVoiceInputShortcut,
} from '../../utils/voiceInputShortcutPrefs';

function Keycap({ label }: { label: string }) {
  return (
    <span className="inline-flex min-h-[26px] min-w-[26px] items-center justify-center rounded-md bg-[#27272a] px-2 text-[11px] font-medium text-white/90">
      {label}
    </span>
  );
}

function ShortcutKeys({
  row,
  recording,
  recordingLabel,
}: {
  row: CanvasShortcutRow;
  recording?: boolean;
  recordingLabel?: string;
}) {
  if (recording) {
    return (
      <span className="shrink-0 animate-pulse text-[11px] text-sky-400">
        {recordingLabel ?? '…'}
      </span>
    );
  }
  if (row.keys.length === 0) {
    return (
      <span className="shrink-0 text-[11px] text-zinc-500">{row.hint ?? '—'}</span>
    );
  }
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      {row.keys.map((key, i) => (
        <Keycap key={`${row.id}-${i}-${key}`} label={key} />
      ))}
    </div>
  );
}

function ShortcutRowItem({
  row,
  recording,
  recordingLabel,
  rebindHint,
  onStartRebind,
}: {
  row: CanvasShortcutRow;
  recording?: boolean;
  recordingLabel?: string;
  rebindHint?: string;
  onStartRebind?: () => void;
}) {
  const interactive = !!row.customizable && !!onStartRebind;
  return (
    <div
      className={`flex items-center justify-between gap-3 py-[7px] ${
        interactive ? 'cursor-pointer rounded-md px-1 -mx-1 hover:bg-white/[0.04]' : ''
      } ${recording ? 'bg-sky-500/10 ring-1 ring-sky-500/30 rounded-md px-1 -mx-1' : ''}`}
      onClick={
        interactive
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onStartRebind();
            }
          : undefined
      }
      title={interactive ? rebindHint : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onStartRebind();
              }
            }
          : undefined
      }
    >
      <div className="min-w-0">
        <span className="text-[13px] leading-snug text-zinc-300">{row.label}</span>
        {interactive && !recording ? (
          <span className="mt-0.5 block text-[10px] text-zinc-500">{rebindHint}</span>
        ) : null}
      </div>
      <ShortcutKeys row={row} recording={recording} recordingLabel={recordingLabel} />
    </div>
  );
}

function ShortcutColumn({
  section,
  recordingRowId,
  recordingLabel,
  rebindHint,
  onStartRebind,
}: {
  section: CanvasShortcutSection;
  recordingRowId: string | null;
  recordingLabel: string;
  rebindHint: string;
  onStartRebind: (rowId: string) => void;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="mb-1 text-[13px] font-medium text-sky-400/90">{section.title}</h3>
      <div className="flex flex-col">
        {section.rows.map((row) => (
          <ShortcutRowItem
            key={row.id}
            row={row}
            recording={recordingRowId === row.id}
            recordingLabel={recordingLabel}
            rebindHint={rebindHint}
            onStartRebind={row.customizable ? () => onStartRebind(row.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function OpsTable({
  title,
  actionHeader,
  descHeader,
  rows,
}: {
  title: string;
  actionHeader: string;
  descHeader: string;
  rows: CanvasShortcutOpRow[];
}) {
  return (
    <div className="mt-1">
      <h3 className="mb-2 text-[13px] font-medium text-sky-400/90">{title}</h3>
      <div className="overflow-hidden rounded-lg border border-zinc-700/70">
        <div className="grid grid-cols-[minmax(140px,0.38fr)_1fr] border-b border-zinc-700/70 bg-[#1f1f23]">
          <div className="px-3 py-2 text-[12px] font-medium text-zinc-400">{actionHeader}</div>
          <div className="border-l border-zinc-700/70 px-3 py-2 text-[12px] font-medium text-zinc-400">
            {descHeader}
          </div>
        </div>
        <div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(140px,0.38fr)_1fr] border-b border-zinc-800/80 last:border-b-0"
            >
              <div className="px-3 py-2 text-[12.5px] leading-snug text-zinc-200">{row.action}</div>
              <div className="border-l border-zinc-800/80 px-3 py-2 text-[12.5px] leading-snug text-zinc-400">
                {row.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export type CanvasShortcutsPanelProps = {
  open: boolean;
  onClose: () => void;
};

const CanvasShortcutsPanel: React.FC<CanvasShortcutsPanelProps> = ({ open, onClose }) => {
  const { locale } = useAppLocale();
  const { showAlert } = useDarkAlert();
  const t = useMemo(() => canvasShortcutsT(locale), [locale]);
  const defaultSections = useMemo(() => buildDefaultCanvasShortcutSections(locale), [locale]);
  const defaultOps = useMemo(() => buildDefaultCanvasOperationRows(locale), [locale]);
  const [sections, setSections] = useState<CanvasShortcutSection[]>(defaultSections);
  const [opsRows, setOpsRows] = useState<CanvasShortcutOpRow[]>(defaultOps);
  const [recordingRowId, setRecordingRowId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSections(defaultSections);
      setOpsRows(defaultOps);
      setRecordingRowId(null);
      setVoiceShortcutRecording(false);
    }
  }, [open, defaultSections, defaultOps]);

  useEffect(() => {
    if (!open) {
      setRecordingRowId(null);
      setVoiceShortcutRecording(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (recordingRowId === 'voice-input-hold') {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'Escape') {
          setRecordingRowId(null);
          setVoiceShortcutRecording(false);
          return;
        }
        if (e.repeat) return;
        const next = shortcutFromKeyboardEvent(e);
        if (!next) return;
        writeVoiceInputShortcut(next);
        setSections((prev) =>
          prev.map((sec) => ({
            ...sec,
            rows: sec.rows.map((row) =>
              row.id === 'voice-input-hold'
                ? { ...row, keys: voiceInputShortcutToKeycaps(next) }
                : row,
            ),
          })),
        );
        setRecordingRowId(null);
        setVoiceShortcutRecording(false);
        void showAlert(t.voiceInputHoldSaved);
        return;
      }

      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, recordingRowId, showAlert, t.voiceInputHoldSaved]);

  const handleStartRebind = useCallback((rowId: string) => {
    if (rowId !== 'voice-input-hold') return;
    setRecordingRowId(rowId);
    setVoiceShortcutRecording(true);
  }, []);

  const handleRestore = useCallback(() => {
    resetVoiceInputShortcut();
    setRecordingRowId(null);
    setVoiceShortcutRecording(false);
    setSections(buildDefaultCanvasShortcutSections(locale));
    setOpsRows(buildDefaultCanvasOperationRows(locale));
    void showAlert(t.restoreDefaultsDone);
  }, [locale, showAlert, t.restoreDefaultsDone]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100020] flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
      onClick={() => {
        if (recordingRowId) {
          setRecordingRowId(null);
          setVoiceShortcutRecording(false);
          return;
        }
        onClose();
      }}
      role="presentation"
    >
      <div
        className="mx-4 flex w-full max-w-[760px] flex-col rounded-xl border border-zinc-800/80 bg-[#18181b] px-6 py-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t.panelTitle}
      >
        <div className="mb-4 flex gap-10">
          {sections.map((section) => (
            <ShortcutColumn
              key={section.id}
              section={section}
              recordingRowId={recordingRowId}
              recordingLabel={t.voiceInputHoldRecording}
              rebindHint={t.voiceInputHoldClickToRebind}
              onStartRebind={handleStartRebind}
            />
          ))}
        </div>

        <div className="mb-4 border-t border-zinc-800/80 pt-4">
          <OpsTable
            title={t.opsSection}
            actionHeader={t.opsActionHeader}
            descHeader={t.opsDescHeader}
            rows={opsRows}
          />
        </div>

        <div className="mb-4 border-t border-zinc-800/80 pt-4">
          <h3 className="mb-2 text-[13px] font-medium text-sky-400/90">{t.promptTipsSection}</h3>
          <div className="rounded-lg border border-zinc-700/70 bg-[#1a1a1e] px-3.5 py-3">
            <div className="mb-1 flex items-center gap-2">
              <span className="inline-flex min-h-[22px] min-w-[22px] items-center justify-center rounded-md bg-[#27272a] px-1.5 text-[12px] font-semibold text-white/90">
                @
              </span>
              <span className="text-[13px] font-medium text-zinc-200">{t.promptTipsAtTitle}</span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-zinc-400">{t.promptTipsAtBody}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-500">{t.promptTipsWireNote}</p>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800/80 pt-4">
          <div className="flex items-center gap-2 text-[11px] text-zinc-500">
            <Keycap label="Esc" />
            <span>{t.escClose}</span>
          </div>
          <button
            type="button"
            onClick={handleRestore}
            className="rounded-md border border-zinc-700/80 bg-[#27272a] px-3 py-1.5 text-[12px] text-zinc-300 transition-colors hover:bg-zinc-700/80 hover:text-zinc-100"
          >
            {t.restoreDefaults}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default CanvasShortcutsPanel;
