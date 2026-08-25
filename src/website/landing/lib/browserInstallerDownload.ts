/**
 * 官网浏览器端安装包下载：优先 File System Access API 流式落盘（可进度/暂停），
 * 不支持时回退为浏览器原生下载。
 */

export type BrowserDownloadProgress = {
  transferred: number;
  total: number;
  percent: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
};

export type BrowserDownloadMode = 'streaming' | 'native' | 'idle';

type ProgressCb = (p: BrowserDownloadProgress) => void;

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

function supportsSaveFilePicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
}

function triggerNativeDownload(url: string, fileName: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export class BrowserInstallerDownloader {
  private abort: AbortController | null = null;
  private paused = false;
  private offset = 0;
  private total = 0;
  private writable: FileSystemWritableFileStream | null = null;
  private fileHandle: FileSystemFileHandle | null = null;
  private mode: BrowserDownloadMode = 'idle';
  private speedSamples: Array<{ t: number; bytes: number }> = [];
  private lastTick = 0;

  get downloadMode(): BrowserDownloadMode {
    return this.mode;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get canStream(): boolean {
    return supportsSaveFilePicker();
  }

  async start(opts: {
    url: string;
    fileName: string;
    knownSize?: number | null;
    onProgress: ProgressCb;
    onDone: (mode: BrowserDownloadMode) => void;
    onError: (message: string) => void;
  }): Promise<void> {
    const { url, fileName, knownSize, onProgress, onDone, onError } = opts;
    this.paused = false;
    this.offset = 0;
    this.total = knownSize && knownSize > 0 ? knownSize : 0;
    this.speedSamples = [];
    this.lastTick = performance.now();

    if (!supportsSaveFilePicker()) {
      this.mode = 'native';
      triggerNativeDownload(url, fileName);
      onProgress({
        transferred: 0,
        total: this.total,
        percent: 0,
        bytesPerSecond: 0,
        etaSeconds: null,
      });
      onDone('native');
      return;
    }

    try {
      this.fileHandle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: 'Aixflow Installer',
            accept: {
              'application/octet-stream': ['.exe', '.zip', '.dmg'],
            },
          },
        ],
      });
      this.writable = await this.fileHandle.createWritable();
      this.mode = 'streaming';
      await this.pump(url, onProgress, onDone, onError);
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      if (name === 'AbortError') {
        onError('已取消选择保存位置');
        return;
      }
      // 权限/不支持时回退原生下载
      this.mode = 'native';
      triggerNativeDownload(url, fileName);
      onDone('native');
    }
  }

  async pause(): Promise<void> {
    if (this.mode !== 'streaming' || this.paused) return;
    this.paused = true;
    this.abort?.abort();
    this.abort = null;
  }

  async resume(
    url: string,
    onProgress: ProgressCb,
    onDone: (mode: BrowserDownloadMode) => void,
    onError: (message: string) => void,
  ): Promise<void> {
    if (this.mode !== 'streaming' || !this.writable || !this.paused) return;
    this.paused = false;
    await this.pump(url, onProgress, onDone, onError);
  }

  async cancel(): Promise<void> {
    this.paused = false;
    this.abort?.abort();
    this.abort = null;
    try {
      await this.writable?.abort();
    } catch {
      /* ignore */
    }
    this.writable = null;
    this.fileHandle = null;
    this.mode = 'idle';
    this.offset = 0;
  }

  private emitProgress(onProgress: ProgressCb): void {
    const now = performance.now();
    this.speedSamples.push({ t: now, bytes: this.offset });
    while (this.speedSamples.length > 0 && now - this.speedSamples[0].t > 2000) {
      this.speedSamples.shift();
    }
    let bytesPerSecond = 0;
    if (this.speedSamples.length >= 2) {
      const first = this.speedSamples[0];
      const last = this.speedSamples[this.speedSamples.length - 1];
      const dt = (last.t - first.t) / 1000;
      if (dt > 0) bytesPerSecond = (last.bytes - first.bytes) / dt;
    }
    const remain = this.total > this.offset ? this.total - this.offset : 0;
    onProgress({
      transferred: this.offset,
      total: this.total,
      percent: this.total > 0 ? clampPercent((this.offset / this.total) * 100) : 0,
      bytesPerSecond,
      etaSeconds: bytesPerSecond > 0 && remain > 0 ? remain / bytesPerSecond : null,
    });
    this.lastTick = now;
  }

  private async pump(
    url: string,
    onProgress: ProgressCb,
    onDone: (mode: BrowserDownloadMode) => void,
    onError: (message: string) => void,
  ): Promise<void> {
    if (!this.writable) return;
    this.abort = new AbortController();
    const headers: Record<string, string> = {};
    if (this.offset > 0) headers.Range = `bytes=${this.offset}-`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        signal: this.abort.signal,
        headers,
      });
      if (!res.ok && res.status !== 206) {
        throw new Error(`下载失败 HTTP ${res.status}`);
      }
      const len = Number(res.headers.get('content-length') || 0);
      if (res.status === 206) {
        const cr = res.headers.get('content-range');
        const m = cr?.match(/\/(\d+)\s*$/);
        if (m) this.total = Number(m[1]) || this.total;
        else if (len > 0) this.total = this.offset + len;
      } else if (len > 0) {
        this.total = len;
        if (this.offset > 0) {
          // 服务器不支持 Range，从头写
          this.offset = 0;
          await this.writable.seek(0);
        }
      }

      if (!res.body) throw new Error('响应无内容流');
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value?.byteLength) continue;
        await this.writable.write(value);
        this.offset += value.byteLength;
        if (performance.now() - this.lastTick > 80) this.emitProgress(onProgress);
      }
      this.emitProgress(onProgress);
      await this.writable.close();
      this.writable = null;
      this.fileHandle = null;
      this.mode = 'idle';
      onDone('streaming');
    } catch (e) {
      if (this.paused || (e instanceof DOMException && e.name === 'AbortError')) {
        this.emitProgress(onProgress);
        return;
      }
      const msg = e instanceof Error ? e.message : String(e);
      try {
        await this.writable?.abort();
      } catch {
        /* ignore */
      }
      this.writable = null;
      this.fileHandle = null;
      this.mode = 'idle';
      onError(msg || '下载失败');
    } finally {
      this.abort = null;
    }
  }
}
