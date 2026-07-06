export type OptionalEngineKind = 'rvc' | 'whisper';

export type OptionalEngineDownloadPhase = 'downloading' | 'extracting' | 'done' | 'error';

export interface OptionalEngineDownloadProgressPayload {
  kind: OptionalEngineKind;
  phase: OptionalEngineDownloadPhase;
  percent: number;
  message: string;
}

type ProgressSender = (channel: string, payload: OptionalEngineDownloadProgressPayload) => void;

let progressSender: ProgressSender | null = null;

export function setOptionalEngineDownloadSender(sender: ProgressSender | null): void {
  progressSender = sender;
}

export function emitOptionalEngineDownloadProgress(
  payload: OptionalEngineDownloadProgressPayload,
): void {
  progressSender?.('optional-engine:download-progress', payload);
}

export function chainOptionalEngineProgress<T extends { phase: string; percent: number; message: string }>(
  kind: OptionalEngineKind,
  onProgress?: (p: T) => void,
): (p: T) => void {
  return (p) => {
    emitOptionalEngineDownloadProgress({
      kind,
      phase: p.phase as OptionalEngineDownloadPhase,
      percent: p.percent,
      message: p.message,
    });
    onProgress?.(p);
  };
}
