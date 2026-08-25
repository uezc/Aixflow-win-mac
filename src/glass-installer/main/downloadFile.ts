import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

export type DownloadProgress = {
  transferred: number;
  total: number;
  bytesPerSecond: number;
  etaSeconds: number | null;
};

type DownloadOpts = {
  url: string;
  destPath: string;
  knownSize?: number;
  signal?: AbortSignal;
  onProgress?: (p: DownloadProgress) => void;
  /** 已有部分文件时从此偏移续传 */
  resumeFrom?: number;
};

function ensureParent(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export async function downloadFile(opts: DownloadOpts): Promise<void> {
  const { url, destPath, knownSize = 0, signal, onProgress } = opts;
  ensureParent(destPath);

  let start = opts.resumeFrom ?? 0;
  if (start <= 0 && fs.existsSync(destPath)) {
    start = fs.statSync(destPath).size;
  }

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }

    const parsed = new URL(url);
    const lib = parsed.protocol === 'http:' ? http : https;
    const headers: Record<string, string> = {
      'User-Agent': 'Aixflow-Installer',
    };
    if (start > 0) headers.Range = `bytes=${start}-`;

    const req = lib.get(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: parsed.pathname + parsed.search,
        headers,
        timeout: 120000,
      },
      (res) => {
        // 重定向
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          downloadFile({
            ...opts,
            url: new URL(res.headers.location, url).toString(),
            resumeFrom: start,
          })
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200 && res.statusCode !== 206) {
          reject(new Error(`下载失败 HTTP ${res.statusCode}`));
          res.resume();
          return;
        }

        const contentLength = Number(res.headers['content-length'] || 0);
        const totalFromHeader =
          res.statusCode === 206 && contentLength > 0
            ? start + contentLength
            : contentLength > 0
              ? contentLength
              : knownSize;
        const total = totalFromHeader > 0 ? totalFromHeader : knownSize;

        const append = res.statusCode === 206 && start > 0;
        if (!append) start = 0;
        const writeStart = start;
        if (!append && fs.existsSync(destPath)) {
          try {
            fs.unlinkSync(destPath);
          } catch {
            /* ignore */
          }
        }

        const out = fs.createWriteStream(destPath, { flags: append ? 'a' : 'w' });
        let transferred = writeStart;
        let lastT = Date.now();
        let lastBytes = transferred;
        let bps = 0;

        const onAbort = () => {
          req.destroy();
          out.destroy();
          reject(new Error('aborted'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        res.on('data', (chunk: Buffer) => {
          transferred += chunk.length;
          const now = Date.now();
          const dt = (now - lastT) / 1000;
          if (dt >= 0.35) {
            bps = (transferred - lastBytes) / dt;
            lastT = now;
            lastBytes = transferred;
          }
          const eta = bps > 0 && total > transferred ? (total - transferred) / bps : null;
          onProgress?.({
            transferred,
            total,
            bytesPerSecond: bps,
            etaSeconds: eta,
          });
        });

        res.pipe(out);
        out.on('finish', () => {
          signal?.removeEventListener('abort', onAbort);
          onProgress?.({
            transferred: total > 0 ? Math.max(transferred, total) : transferred,
            total: total || transferred,
            bytesPerSecond: 0,
            etaSeconds: 0,
          });
          resolve();
        });
        out.on('error', (e) => {
          signal?.removeEventListener('abort', onAbort);
          reject(e);
        });
        res.on('error', (e) => {
          signal?.removeEventListener('abort', onAbort);
          reject(e);
        });
      },
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('下载超时'));
    });
  });
}
