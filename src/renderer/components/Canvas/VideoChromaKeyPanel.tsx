/**
 * 视频色度抠像：
 * - 主预览实时显示抠像效果（棋盘格透明底）
 * - 吸色仍从底层 <video> 像素采样，不依赖显示的 canvas
 * - 右侧独立面板：参数操作（主预览已承载效果预览）
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { Check, Droplet, Loader2, X } from 'lucide-react';
import { applyChromaToRgba, parseChromaHex, suggestKeyParamsForColor } from '../../../shared/chromaKey';

export { suggestKeyParamsForColor } from '../../../shared/chromaKey';

/** 主预览绘制最长边上限，避免每帧全分辨率 getImageData 卡顿 */
const MAIN_PREVIEW_MAX_EDGE = 720;

/** 透明成片/抠像预览共用棋盘格底，避免透明区被当成黑底 */
export const CHROMA_CHECKERBOARD_BG: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg,#808080 25%,transparent 25%),linear-gradient(-45deg,#808080 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#808080 75%),linear-gradient(-45deg,transparent 75%,#808080 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
  backgroundColor: '#b0b0b0',
};

export type ChromaKeyParams = {
  colorHex: string;
  similarity: number;
  blend: number;
};

export type ChromaKeyStrings = {
  title: string;
  greenPreset: string;
  pickColor: string;
  similarity: string;
  blend: string;
  confirm: string;
  cancel: string;
};

/** 吸色模式光标：吸管图标，热点在尖端 */
const EYEDROPPER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
    <g transform="rotate(-45 12 12)">
      <path d="M11 3h2v8h-2z" fill="#111" stroke="#fff" stroke-width="1"/>
      <path d="M9 11h6l1 3v5a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-5l1-3z" fill="#222" stroke="#fff" stroke-width="1"/>
      <circle cx="12" cy="17" r="1.6" fill="#0ea5e9"/>
    </g>
  </svg>`,
)}") 2 22, crosshair`;

function toHex(r: number, g: number, b: number) {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/** 按 object-fit:contain 将点击映射到视频像素并取样 */
export function sampleVideoPixelColor(
  video: HTMLVideoElement,
  clientX: number,
  clientY: number,
): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw < 2 || vh < 2 || video.readyState < 2) return null;
  const rect = video.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const scale = Math.min(rect.width / vw, rect.height / vh);
  const dispW = vw * scale;
  const dispH = vh * scale;
  const ox = rect.left + (rect.width - dispW) / 2;
  const oy = rect.top + (rect.height - dispH) / 2;
  const x = Math.floor((clientX - ox) / scale);
  const y = Math.floor((clientY - oy) / scale);
  if (x < 0 || y < 0 || x >= vw || y >= vh) return null;

  const canvas = document.createElement('canvas');
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, vw, vh);
    const px = ctx.getImageData(x, y, 1, 1).data;
    return toHex(px[0]!, px[1]!, px[2]!);
  } catch {
    return null;
  }
}

/** 主预览：棋盘格 → 清空后的抠像 canvas（透明透棋盘）；原片 video 由 VideoNode 隐藏但仍解码供采样 */
export function VideoChromaKeyMainPreview({
  getVideoElement,
  active,
  colorHex,
  similarity,
  blend,
}: {
  getVideoElement: () => HTMLVideoElement | null;
  active: boolean;
  colorHex: string;
  similarity: number;
  blend: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const paramsRef = useRef({ colorHex, similarity, blend });
  paramsRef.current = { colorHex, similarity, blend };

  const drawPreview = useCallback(() => {
    const video = getVideoElement();
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || video.videoWidth < 2) {
      rafRef.current = requestAnimationFrame(drawPreview);
      return;
    }
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const scale = Math.min(1, MAIN_PREVIEW_MAX_EDGE / Math.max(vw, vh));
    const w = Math.max(2, Math.round(vw * scale));
    const h = Math.max(2, Math.round(vh * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
    if (!ctx) {
      rafRef.current = requestAnimationFrame(drawPreview);
      return;
    }
    // 必须先清空：带 alpha 的 putImageData 若叠在旧帧上会产生运动残影/拖尾
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const key = parseChromaHex(paramsRef.current.colorHex);
    if (key) {
      applyChromaToRgba(img.data, key, paramsRef.current.similarity, paramsRef.current.blend);
      // 再清一次再 put，确保不会与 clear 前残留做任何混合
      ctx.clearRect(0, 0, w, h);
      ctx.putImageData(img, 0, 0);
    }
    ctx.restore();
    rafRef.current = requestAnimationFrame(drawPreview);
  }, [getVideoElement]);

  useEffect(() => {
    if (!active) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      return;
    }
    rafRef.current = requestAnimationFrame(drawPreview);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [active, drawPreview]);

  if (!active) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[55] overflow-hidden rounded-2xl"
      style={CHROMA_CHECKERBOARD_BG}
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      />
    </div>
  );
}

/** 主模块上：吸色透明覆盖层；采样对准底层 video（含 object-fit:contain） */
export function VideoChromaKeyPickOverlay({
  getVideoElement,
  active,
  busy = false,
  onPickColor,
}: {
  getVideoElement: () => HTMLVideoElement | null;
  active: boolean;
  busy?: boolean;
  onPickColor: (hex: string) => void;
}) {
  if (!active) return null;
  return (
    <div
      className="nodrag nopan absolute inset-0 z-[70] rounded-2xl"
      style={{
        pointerEvents: 'auto',
        background: 'transparent',
        cursor: busy ? 'wait' : EYEDROPPER_CURSOR,
      }}
      title="点击画面取色"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (busy) return;
        const video = getVideoElement();
        if (!video) return;
        const hex = sampleVideoPixelColor(video, e.clientX, e.clientY);
        if (hex) onPickColor(hex);
      }}
    />
  );
}

/** 右侧独立面板：参数与确认/取消（抠像效果在主预览） */
export function VideoChromaKeySidePanel({
  isDarkMode,
  busy = false,
  colorHex,
  similarity,
  blend,
  picking,
  strings,
  onColorHexChange,
  onSimilarityChange,
  onBlendChange,
  onPickingChange,
  onConfirm,
  onCancel,
}: {
  isDarkMode: boolean;
  busy?: boolean;
  colorHex: string;
  similarity: number;
  blend: number;
  picking: boolean;
  strings: ChromaKeyStrings;
  onColorHexChange: (hex: string) => void;
  onSimilarityChange: (v: number) => void;
  onBlendChange: (v: number) => void;
  onPickingChange: (v: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelBg = isDarkMode
    ? 'border-white/15 bg-[#1C1C1E]/96 text-white'
    : 'border-gray-200 bg-white/96 text-gray-900 shadow-xl';
  const labelCls = isDarkMode ? 'text-white/70' : 'text-gray-600';
  const btnGhost = isDarkMode
    ? 'bg-white/10 hover:bg-white/20 text-white'
    : 'bg-gray-100 hover:bg-gray-200 text-gray-800';

  const applyColor = (hex: string) => {
    const next = hex.toUpperCase();
    onColorHexChange(next);
    const sug = suggestKeyParamsForColor(next);
    onSimilarityChange(sug.similarity);
    onBlendChange(sug.blend);
  };

  const keyWarn = suggestKeyParamsForColor(colorHex).warnDarkOrGray;
  const blendMax = Math.min(0.35, Math.max(0.02, similarity * 0.85));

  return (
    <div
      className={`nodrag nopan w-[260px] rounded-2xl border px-2.5 py-2.5 backdrop-blur-md ${panelBg}`}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0 text-xs font-semibold truncate">{strings.title}</div>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${btnGhost}`}
          title={strings.cancel}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => applyColor('#00FF00')}
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${btnGhost}`}
        >
          {strings.greenPreset}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onPickingChange(!picking)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
            picking ? 'bg-cyan-600 text-white' : btnGhost
          }`}
          title={strings.pickColor}
          style={picking ? { cursor: EYEDROPPER_CURSOR } : undefined}
        >
          <Droplet className="h-3 w-3" />
          {strings.pickColor}
        </button>
        <label
          className="ml-auto inline-flex h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded border border-black/20 shadow-inner"
          title={colorHex}
          style={{ backgroundColor: colorHex }}
        >
          <input
            type="color"
            value={colorHex}
            disabled={busy}
            onChange={(e) => applyColor(e.target.value)}
            className="h-full w-full cursor-pointer border-0 p-0 opacity-0"
            aria-label={colorHex}
          />
        </label>
      </div>

      {picking ? (
        <div
          className={`mb-2 rounded-md px-2 py-1 text-[10px] ${
            isDarkMode ? 'bg-cyan-500/15 text-cyan-200' : 'bg-cyan-50 text-cyan-800'
          }`}
        >
          请点击主画面取色（主窗口保持抠像预览）
        </div>
      ) : null}

      {keyWarn ? (
        <div
          className={`mb-2 rounded-md px-2 py-1 text-[10px] leading-snug ${
            isDarkMode ? 'bg-amber-500/15 text-amber-200' : 'bg-amber-50 text-amber-800'
          }`}
        >
          当前键色偏黑/灰/白，色度抠像容易抠空。请尽量点「绿幕」或吸取纯净绿幕区域，并把「相似度」调低。
        </div>
      ) : null}

      <label className={`mb-1.5 flex items-center gap-2 text-[11px] ${labelCls}`}>
        <span className="w-14 shrink-0">{strings.similarity}</span>
        <input
          type="range"
          min={0.03}
          max={0.55}
          step={0.01}
          value={similarity}
          disabled={busy}
          onChange={(e) => {
            const next = Number(e.target.value);
            onSimilarityChange(next);
            if (blend > next * 0.85) onBlendChange(Math.max(0, next * 0.4));
          }}
          className="flex-1 accent-cyan-500"
        />
        <span className="w-8 text-right tabular-nums">{similarity.toFixed(2)}</span>
      </label>
      <label className={`mb-2 flex items-center gap-2 text-[11px] ${labelCls}`}>
        <span className="w-14 shrink-0">{strings.blend}</span>
        <input
          type="range"
          min={0}
          max={blendMax}
          step={0.01}
          value={Math.min(blend, blendMax)}
          disabled={busy}
          onChange={(e) => onBlendChange(Number(e.target.value))}
          className="flex-1 accent-cyan-500"
        />
        <span className="w-8 text-right tabular-nums">{Math.min(blend, blendMax).toFixed(2)}</span>
      </label>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className={`inline-flex flex-1 items-center justify-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${btnGhost}`}
        >
          <X className="h-3.5 w-3.5" />
          {strings.cancel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={`inline-flex flex-[1.4] items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-white ${
            busy ? 'bg-cyan-600/70 cursor-wait' : 'bg-cyan-600 hover:bg-cyan-500'
          }`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {strings.confirm}
        </button>
      </div>
    </div>
  );
}
