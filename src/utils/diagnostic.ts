export type DiagnosticLevel = 'trace' | 'info' | 'warn' | 'error';

export type DiagnosticMeta = Record<string, unknown> | undefined;

type LoggerOptions = {
  traceSampleRate?: number;
  namespace?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function clampSampleRate(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.05;
  return Math.max(0, Math.min(1, n));
}

export class DiagnosticLogger {
  private readonly traceSampleRate: number;
  private readonly namespace: string;

  constructor(options?: LoggerOptions) {
    this.traceSampleRate = clampSampleRate(options?.traceSampleRate ?? process.env.NX_DIAG_TRACE_SAMPLE_RATE);
    this.namespace = String(options?.namespace || 'NEXFLOW').trim() || 'NEXFLOW';
  }

  private emit(level: DiagnosticLevel, message: string, meta?: DiagnosticMeta): void {
    const payload = {
      ts: nowIso(),
      ns: this.namespace,
      level,
      message,
      ...(meta ? { meta } : {}),
    };
    const line = `[${payload.ns}] ${payload.level.toUpperCase()} ${payload.ts} ${payload.message}`;
    if (level === 'error') console.error(line, meta || '');
    else if (level === 'warn') console.warn(line, meta || '');
    else if (level === 'info') console.info(line, meta || '');
    else console.debug(line, meta || '');
  }

  trace(message: string, meta?: DiagnosticMeta): void {
    if (Math.random() > this.traceSampleRate) return;
    this.emit('trace', message, meta);
  }

  info(message: string, meta?: DiagnosticMeta): void {
    this.emit('info', message, meta);
  }

  warn(message: string, meta?: DiagnosticMeta): void {
    this.emit('warn', message, meta);
  }

  error(message: string, meta?: DiagnosticMeta): void {
    this.emit('error', message, meta);
  }
}

export const diagnosticLogger = new DiagnosticLogger();
