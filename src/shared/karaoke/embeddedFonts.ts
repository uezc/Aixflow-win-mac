/**
 * 卡拉OK内嵌字体：无系统安装时，预览与方案 A（CSS）烧录仍可通过 FontFace 加载。
 * 文件放在 `public/fonts/`，Vite 构建后位于 `dist/fonts/`。
 * 主进程 tsc 无 DOM lib：运行时探测 document / FontFace，类型用宽松断言。
 *
 * 办公本注意：文鼎 TTF ~10MB，勿在打开编辑器时阻塞 UI；加载失败/超时也不应拖死流程。
 */

import { KARAOKE_PREFERRED_FONT_LEGACY } from './types.js';

export type KaraokeEmbeddedFont = {
  /** CSS font-family / ASS Style Fontname（与 name 表一致） */
  family: string;
  /** 相对页面根的路径（public → dist） */
  relativePath: string;
};

/** 应用内嵌字体清单 */
export const KARAOKE_EMBEDDED_FONTS: readonly KaraokeEmbeddedFont[] = [
  {
    family: KARAOKE_PREFERRED_FONT_LEGACY,
    /** 文鼎中特圓 / AR Yenti Extra B5 */
    relativePath: 'fonts/AR-Yenti-Extra-B5.ttf',
  },
];

/** fonts.ready 最长等待（办公本磁盘慢时避免假死） */
const FONTS_READY_TIMEOUT_MS = 8_000;

let ensurePromise: Promise<void> | null = null;
let fontsReadyFlag = false;

function resolveEmbeddedFontUrl(relativePath: string): string {
  const rel = relativePath.replace(/^\//, '');
  const doc = (globalThis as { document?: { baseURI?: string } }).document;
  if (doc?.baseURI) {
    return new URL(rel, doc.baseURI).href;
  }
  const envBase =
    typeof import.meta !== 'undefined'
      ? (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL
      : undefined;
  const base = envBase && envBase.length > 0 ? envBase : './';
  return `${base.endsWith('/') ? base : `${base}/`}${rel}`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve('timeout');
    }, ms);
    void p.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve('timeout');
      },
    );
  });
}

/** 内嵌字体是否已加入 document.fonts（供 UI 轻提示） */
export function isKaraokeEmbeddedFontsReady(): boolean {
  return fontsReadyFlag;
}

/**
 * 加载内嵌卡拉OK字体（FontFace）。幂等；仅渲染进程有效。
 * 不阻塞调用方：编辑器应 `void ensure…()`；烧录窗可 await。
 */
export function ensureKaraokeEmbeddedFonts(): Promise<void> {
  const g = globalThis as {
    document?: {
      fonts?: {
        add: (face: unknown) => void;
        ready?: Promise<unknown>;
      };
    };
    FontFace?: new (
      family: string,
      source: string,
      descriptors?: { style?: string; weight?: string },
    ) => { load: () => Promise<unknown> };
  };
  if (!g.document) return Promise.resolve();
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    const fontsApi = g.document?.fonts;
    const FontFaceCtor = g.FontFace;
    if (!fontsApi || typeof FontFaceCtor !== 'function') {
      fontsReadyFlag = true;
      return;
    }
    await Promise.all(
      KARAOKE_EMBEDDED_FONTS.map(async (entry) => {
        const url = resolveEmbeddedFontUrl(entry.relativePath);
        const face = new FontFaceCtor(entry.family, `url(${JSON.stringify(url)})`, {
          style: 'normal',
          weight: '400',
        });
        try {
          // 单字体也加超时，避免磁盘/杀软扫描拖死打开
          const loaded = await withTimeout(face.load(), FONTS_READY_TIMEOUT_MS);
          if (loaded === 'timeout') {
            console.warn('[karaoke] embedded font load timeout:', entry.family, url);
            return;
          }
          fontsApi.add(loaded);
        } catch (err) {
          console.warn('[karaoke] embedded font load failed:', entry.family, url, err);
        }
      }),
    );
    try {
      if (fontsApi.ready) {
        const ready = await withTimeout(Promise.resolve(fontsApi.ready), FONTS_READY_TIMEOUT_MS);
        if (ready === 'timeout') {
          console.warn('[karaoke] document.fonts.ready timeout — continue without blocking');
        }
      }
    } catch {
      /* ignore */
    }
    fontsReadyFlag = true;
  })();
  return ensurePromise;
}
