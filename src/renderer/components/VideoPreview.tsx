import React, { forwardRef, useImperativeHandle, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { normalizeVideoUrl, toElectronVideoElementSrc } from '../utils/normalizeVideoUrl';
import { useDarkAlert } from '../contexts/DarkAlertContext';

export interface VideoPreviewRef {
  pause: () => void;
  play: () => void;
  /** 释放 video 资源，防止 WebGL/GPU 崩溃 */
  releaseVideo: () => void;
  /** 截取当前帧并返回 dataUrl，用于纹理缓存 */
  captureCurrentFrame: (videoUrl: string, onCaptured: (url: string, dataUrl: string) => void) => void;
  /** 预热解码：仅在尚未挂载源时 load；已有源时勿 load（会清零 currentTime） */
  warmupDecode: () => void;
  /**
   * 将当前 currentTime 以 immediate 方式交给 onPlaybackTime（与拖动进度条触发的 seeked、控件 pause 同源）
   * 用于鼠标离开等场景：元素已 pause 时浏览器可能不再派发 pause 事件，仍需把进度写入节点数据
   */
  flushPlaybackTime: () => void;
  /** 读取当前播放头（秒），用于离开视频区时与 React state 异步解耦、精确落盘 */
  getCurrentTimeSec: () => number | null;
  getDurationSec: () => number | null;
  seekTo: (sec: number) => void;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  /** 画布 transform 下通过 body 壳全屏播放；成功打开返回 true */
  openPortalFullscreen: () => boolean;
  /** 当前 <video> 元素（色度预览等） */
  getVideoElement: () => HTMLVideoElement | null;
}

interface VideoPreviewProps {
  src: string;
  originalRemoteUrl?: string;
  /** 封面图 URL，与 RunningHub 对齐：video 标签必须挂载 poster */
  poster?: string;
  className?: string;
  style?: React.CSSProperties;
  controls?: boolean;
  preload?: 'none' | 'metadata' | 'auto';
  playsInline?: boolean;
  muted?: boolean;
  onClick?: () => void;
  /** 为 true 时暂停播放，避免离屏/缩小时 GPU 压力 */
  isPaused?: boolean;
  /** 播放到结尾后自动从头循环（画布视频节点预览） */
  loop?: boolean;
  /** 视频元数据加载完成时回调（宽高、时长），用于节点按视频比例调整尺寸及裁剪功能 */
  onLoadedMetadata?: (videoWidth: number, videoHeight: number, duration?: number) => void;
  /** canplay 触发后回调，用于节点执行淡入显示 */
  onCanPlay?: () => void;
  /** 浏览器已绘制至少一帧视频画面时回调（用于静帧叠层退场，避免纯黑） */
  onDecodedFrame?: () => void;
  /** 截取最后一帧时回调，用于纹理缓存 */
  onLastFrameCapture?: (url: string, dataUrl: string) => void;
  /** 播放进度落盘（仅 immediate：seek / pause / ended / 全屏退出）；播放中不通过 timeupdate 上报 */
  onPlaybackTime?: (timeSec: number, durationSec?: number, immediate?: boolean) => void;
  /** 播放状态变化（用于节点彩虹光晕等） */
  onPlayingChange?: (playing: boolean) => void;
  /** 外挂播放条 UI 刷新（不写节点 data） */
  onUiPlaybackTick?: (timeSec: number, durationSec: number, playing: boolean) => void;
  /** 重新挂载 <video> 后恢复到此秒数（如拖进度条/暂停后鼠标离开导致卸载再挂） */
  initialPlaybackTimeSec?: number;
  /**
   * React Flow 等祖先带 transform 时，点原生控件条「全屏」常无效。
   * 为 true 时在捕获阶段识别该区域的 pointerdown，改为挂到 body 的壳上 requestFullscreen（仍用播放器自带图标）。
   */
  fixFullscreenForTransformedParent?: boolean;
  /** 壳上关闭钮 aria-label（预留，与标题一致即可） */
  portalFullscreenTitle?: string;
  portalFullscreenExitTitle?: string;
}

/**
 * Chromium 默认控件条（约）：⋯ 最右 → 全屏 → 音量 → …
 * 全屏图标大致在距右缘约 34～96px、靠底一条带内（随 DPI/语言略变，区间略放宽）。
 */
function pointInNativeVideoFullscreenControlSlot(clientX: number, clientY: number, r: DOMRect): boolean {
  if (r.width < 64 || r.height < 48) return false;
  if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return false;
  const barTop = r.bottom - 58;
  if (clientY < barTop || clientY > r.bottom + 8) return false;
  const xFromRight = r.right - clientX;
  const narrow = r.width < 220;
  if (narrow) {
    return xFromRight > 26 && xFromRight < Math.min(110, r.width * 0.42);
  }
  return xFromRight > 28 && xFromRight < 108;
}

/** 顶栏放大等场景：节点内 <video> 未挂载时，用 URL 直接开 body 浮层预览 */
let standalonePortalShell: HTMLDivElement | null = null;
let standalonePortalEnteredNativeFs = false;
let standalonePortalCleanup: (() => void) | null = null;

function teardownStandaloneVideoPortal(): void {
  const shell = standalonePortalShell;
  const cleanup = standalonePortalCleanup;
  standalonePortalCleanup = null;
  standalonePortalEnteredNativeFs = false;
  standalonePortalShell = null;
  try {
    cleanup?.();
  } catch {
    /* ignore */
  }
  if (!shell) return;
  try {
    shell.remove();
  } catch {
    /* ignore */
  }
}

export type OpenVideoUrlPortalFullscreenOptions = {
  src: string;
  startAtSec?: number;
  exitLabel?: string;
  muted?: boolean;
};

/**
 * 不依赖节点内 VideoPreview 挂载：在 body 上挂 CSS fixed 全屏壳 + 临时 video。
 * 与 openPortalFullscreen（挪动已有 video）互补；成功返回 true。
 */
export function openVideoUrlPortalFullscreen(opts: OpenVideoUrlPortalFullscreenOptions): boolean {
  const src = (opts.src || '').trim();
  if (!src || typeof document === 'undefined') return false;
  if (standalonePortalShell || document.querySelector('[data-nexflow-portal-video-fs="1"]')) {
    return false;
  }

  const shell = document.createElement('div');
  shell.dataset.nexflowPortalVideoFs = '1';
  Object.assign(shell.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '100050',
    background: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', opts.exitLabel || 'Exit fullscreen');
  closeBtn.textContent = '\u00D7';
  Object.assign(closeBtn.style, {
    position: 'absolute',
    top: '12px',
    right: '12px',
    zIndex: '2',
    width: '44px',
    height: '44px',
    borderRadius: '10px',
    background: 'rgba(255,255,255,0.12)',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
    fontSize: '26px',
    lineHeight: '44px',
    padding: '0',
  });

  const vid = document.createElement('video');
  vid.src = src;
  vid.controls = true;
  vid.playsInline = true;
  vid.loop = true;
  vid.muted = !!opts.muted;
  if (src.startsWith('http://') || src.startsWith('https://')) {
    vid.crossOrigin = 'anonymous';
  }
  Object.assign(vid.style, {
    width: '100%',
    height: '100%',
    maxWidth: '100vw',
    maxHeight: '100vh',
    objectFit: 'contain',
  });

  const startAt =
    typeof opts.startAtSec === 'number' && Number.isFinite(opts.startAtSec) && opts.startAtSec > 0
      ? opts.startAtSec
      : 0;
  if (startAt > 0) {
    const applySeek = () => {
      try {
        const d = vid.duration;
        const hi = Number.isFinite(d) && d > 0 ? Math.max(0, d - 1e-6) : startAt;
        vid.currentTime = Math.min(Math.max(0, startAt), hi);
      } catch {
        /* ignore */
      }
    };
    vid.addEventListener('loadedmetadata', applySeek, { once: true });
  }

  const exitPortal = () => {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => void | Promise<void>;
    };
    const fsEl = document.fullscreenElement ?? doc.webkitFullscreenElement;
    if (fsEl === shell) {
      const docEx = document.exitFullscreen?.();
      if (docEx !== undefined) {
        void Promise.resolve(docEx).catch(() => teardownStandaloneVideoPortal());
        return;
      }
      void Promise.resolve(doc.webkitExitFullscreen?.()).catch(() => teardownStandaloneVideoPortal());
      return;
    }
    teardownStandaloneVideoPortal();
  };

  closeBtn.onclick = (ev) => {
    ev.stopPropagation();
    exitPortal();
  };
  shell.onclick = (ev) => {
    if (ev.target === shell) exitPortal();
  };

  const onFsChange = () => {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const fsEl = document.fullscreenElement ?? doc.webkitFullscreenElement;
    if (fsEl && fsEl === shell) {
      standalonePortalEnteredNativeFs = true;
      return;
    }
    if (fsEl) return;
    if (!standalonePortalEnteredNativeFs) return;
    if (standalonePortalShell === shell) teardownStandaloneVideoPortal();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (standalonePortalShell !== shell) return;
    if (standalonePortalEnteredNativeFs) return;
    e.preventDefault();
    e.stopPropagation();
    teardownStandaloneVideoPortal();
  };

  shell.appendChild(closeBtn);
  shell.appendChild(vid);
  document.body.appendChild(shell);
  standalonePortalShell = shell;
  standalonePortalEnteredNativeFs = false;
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  window.addEventListener('keydown', onKeyDown, true);
  standalonePortalCleanup = () => {
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    window.removeEventListener('keydown', onKeyDown, true);
    try {
      vid.pause();
      vid.removeAttribute('src');
      vid.load();
    } catch {
      /* ignore */
    }
  };

  void vid.play().catch(() => {});

  const sh = shell as unknown as {
    requestFullscreen?: (opts?: FullscreenOptions) => Promise<void>;
    webkitRequestFullscreen?: () => void;
  };
  try {
    if (typeof sh.requestFullscreen === 'function') {
      void Promise.resolve(sh.requestFullscreen())
        .then(() => {
          if (standalonePortalShell === shell) standalonePortalEnteredNativeFs = true;
        })
        .catch(() => {
          /* keep CSS overlay */
        });
    } else if (typeof sh.webkitRequestFullscreen === 'function') {
      try {
        sh.webkitRequestFullscreen();
        standalonePortalEnteredNativeFs = true;
      } catch {
        /* keep CSS overlay */
      }
    }
  } catch {
    /* keep CSS overlay */
  }

  return true;
}

/**
 * VideoPreview 组件
 * - 支持 ref 与 isPaused，用于 LOD：缩小时或离屏时暂停，避免大纹理导致 GPU 崩溃
 */
export const VideoPreview = forwardRef<VideoPreviewRef, VideoPreviewProps>(function VideoPreview({
  src,
  originalRemoteUrl: propOriginalRemoteUrl,
  poster,
  className = '',
  style = {},
  controls = true,
  preload = 'metadata',
  playsInline = true,
  muted = false,
  onClick,
  isPaused = false,
  loop = false,
  onLoadedMetadata,
  onCanPlay,
  onDecodedFrame,
  onLastFrameCapture,
  onPlaybackTime,
  onPlayingChange,
  onUiPlaybackTick,
  initialPlaybackTimeSec,
  fixFullscreenForTransformedParent = false,
  portalFullscreenTitle: _portalFullscreenTitle = 'Fullscreen',
  portalFullscreenExitTitle = 'Exit fullscreen',
}, ref) {
  const videoElRef = useRef<HTMLVideoElement>(null);
  const videoHostRef = useRef<HTMLDivElement>(null);
  const portalShellRef = useRef<HTMLDivElement | null>(null);
  /** 仅当浏览器原生 Fullscreen API 真正进入后为 true；CSS 浮层模式勿被 fullscreenchange 误拆 */
  const portalEnteredNativeFsRef = useRef(false);
  const savedVideoStyleRef = useRef('');
  const savedVideoControlsRef = useRef(false);
  const showAlert = useDarkAlert().showAlert;
  const decodedNotifySentRef = React.useRef(false);
  const pendingRvfcRef = React.useRef<number | null>(null);
  const decodedFallbackTimerRef = React.useRef<number | null>(null);

  const releaseVideo = React.useCallback(() => {
    const video = videoElRef.current;
    if (!video) return;
    try {
      video.pause();
      video.currentTime = 0;
      video.removeAttribute('src');
      video.load();
    } catch (_) {}
  }, []);

  const captureCurrentFrame = React.useCallback((videoUrl: string, onCaptured: (url: string, dataUrl: string) => void) => {
    const video = videoElRef.current;
    if (!video || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      if (dataUrl && dataUrl.length > 100) onCaptured(videoUrl, dataUrl);
    } catch (_) {}
  }, []);

  const warmupDecode = React.useCallback(() => {
    const video = videoElRef.current;
    if (!video) return;
    try {
      video.preload = 'auto';
      // 已有媒体源时绝不能 load()：会把 currentTime 重置为 0，悬停续播会先闪回片头再 seek 回来
      if (video.currentSrc || video.getAttribute('src')) return;
      video.load();
    } catch (_) {
      /* ignore */
    }
  }, []);

  const flushPlaybackTime = React.useCallback(() => {
    const v = videoElRef.current;
    if (!v || !onPlaybackTime) return;
    const d = v.duration;
    onPlaybackTime(
      v.currentTime,
      Number.isFinite(d) && d > 0 ? d : undefined,
      true
    );
  }, [onPlaybackTime]);

  const getCurrentTimeSec = React.useCallback((): number | null => {
    const v = videoElRef.current;
    if (!v) return null;
    const t = v.currentTime;
    return Number.isFinite(t) ? t : null;
  }, []);

  const getDurationSec = React.useCallback((): number | null => {
    const v = videoElRef.current;
    if (!v) return null;
    const d = v.duration;
    return Number.isFinite(d) && d > 0 ? d : null;
  }, []);

  const seekTo = React.useCallback((sec: number) => {
    const v = videoElRef.current;
    if (!v || !Number.isFinite(sec)) return;
    const d = v.duration;
    const hi = Number.isFinite(d) && d > 0 ? Math.max(0, d - 1e-6) : sec;
    try {
      v.currentTime = Math.min(Math.max(0, sec), hi);
    } catch {
      /* ignore */
    }
  }, []);

  const setVolume = React.useCallback((volume: number) => {
    const v = videoElRef.current;
    if (!v) return;
    const next = Math.min(1, Math.max(0, volume));
    v.volume = next;
    v.muted = next <= 0;
  }, []);

  const getVolume = React.useCallback((): number => {
    const v = videoElRef.current;
    if (!v) return 1;
    return v.muted ? 0 : v.volume;
  }, []);

  const lastSrcRef = React.useRef<string>('');
  /** 当前 URL 是否已做过「首帧黑屏」修正，避免 loadeddata/canplay 重复 seek */
  const firstFrameNudgeKeyRef = React.useRef<string | null>(null);
  const cleanSrcRef = React.useRef<string>('');
  const isPausedRef = React.useRef(isPaused);
  isPausedRef.current = isPaused;
  const initialPlaybackTimeSecRef = React.useRef(initialPlaybackTimeSec);
  initialPlaybackTimeSecRef.current = initialPlaybackTimeSec;

  /** 取消暂停时：已挂载且进度有效则直接 play，勿强行 seek（避免与 live currentTime 打架闪回） */
  useEffect(() => {
    const v = videoElRef.current;
    if (!v) return;

    if (isPaused) {
      v.pause();
      return;
    }

    const target = initialPlaybackTimeSecRef.current;
    const wantResume = typeof target === 'number' && Number.isFinite(target);
    const live = v.currentTime;
    const liveOk = Number.isFinite(live) && live > 0.05;

    // 元素仍停在有效进度上：只恢复播放，不要再 seek（防闪回片头）
    if (liveOk) {
      v.playbackRate = 1;
      v.play().catch(() => {});
      return;
    }

    const shouldDelayPlayUntilSeeked = (): boolean => {
      if (!wantResume) return false;
      const d = v.duration;
      if (Number.isFinite(d) && d > 0) {
        const hi = Math.max(0, d - 1e-6);
        const clamped = Math.min(Math.max(0, target!), hi);
        return Math.abs(v.currentTime - clamped) > 0.12;
      }
      return v.readyState < 2 || v.currentTime <= 1e-4;
    };

    if (shouldDelayPlayUntilSeeked()) {
      let settled = false;
      const tryPlay = () => {
        if (settled) return;
        settled = true;
        const el = videoElRef.current;
        if (!el || isPausedRef.current) return;
        el.playbackRate = 1;
        el.play().catch(() => {});
      };
      const onSeeked = () => {
        v.removeEventListener('seeked', onSeeked);
        tryPlay();
      };
      v.addEventListener('seeked', onSeeked, { once: true });
      try {
        const d = v.duration;
        const hi = Number.isFinite(d) && d > 0 ? Math.max(0, d - 1e-6) : target!;
        v.currentTime = Math.min(Math.max(0, target!), hi);
      } catch {
        /* ignore */
      }
      const tmr = window.setTimeout(() => {
        v.removeEventListener('seeked', onSeeked);
        tryPlay();
      }, 2500);
      return () => {
        settled = true;
        window.clearTimeout(tmr);
        v.removeEventListener('seeked', onSeeked);
      };
    }

    v.playbackRate = 1;
    v.play().catch(() => {});
  }, [isPaused]);

  // 标准化视频 URL
  const safeUrl = normalizeVideoUrl(src);
  
  // 提取原始远程 URL（优先使用 prop，否则从 src 判断）
  const originalRemoteUrl = React.useMemo(() => {
    // 如果通过 prop 传入，直接使用
    if (propOriginalRemoteUrl) {
      return propOriginalRemoteUrl;
    }
    // 如果当前是 local-resource://，但没有 prop，返回 null
    if (safeUrl.startsWith('local-resource://')) {
      return null;
    }
    // 如果已经是远程 URL，直接返回
    if (safeUrl.startsWith('http://') || safeUrl.startsWith('https://')) {
      return safeUrl;
    }
    return null;
  }, [safeUrl, propOriginalRemoteUrl]);
  
  // 使用 state 来管理视频源，支持重试和备用 URL
  const [videoSrc, setVideoSrc] = React.useState(safeUrl);
  const [retryCount, setRetryCount] = React.useState(0);
  const [useFallbackUrl, setUseFallbackUrl] = React.useState(false);
  const maxRetries = 3;
  
  // 使用 ref 来跟踪是否正在重试，避免重复触发错误处理
  const isRetryingRef = React.useRef(false);

  // 当 src 变化时，更新 videoSrc 并重置重试计数
  // 使用 useRef 保存上一次的 URL，避免相同 URL 时重新加载
  const prevUrlRef = React.useRef<string>('');
  React.useEffect(() => {
    // 只有当 URL 真正变化时才更新，避免不必要的重新加载
    if (prevUrlRef.current !== safeUrl) {
      prevUrlRef.current = safeUrl;
      setVideoSrc(safeUrl);
      setRetryCount(0);
      setUseFallbackUrl(false);
      isRetryingRef.current = false;
    }
  }, [safeUrl]);

  // 检查视频格式兼容性
  const checkVideoCompatibility = React.useCallback((url: string): boolean => {
    if (!url) return false;
    const video = document.createElement('video');
    const ext = url.split('.').pop()?.toLowerCase();
    let mimeType = '';
    switch (ext) {
      case 'mp4':
        mimeType = 'video/mp4';
        break;
      case 'webm':
        mimeType = 'video/webm';
        break;
      case 'ogg':
        mimeType = 'video/ogg';
        break;
      case 'mov':
        mimeType = 'video/quicktime';
        break;
      default:
        return true; // 未知格式，让浏览器尝试
    }
    const canPlay = video.canPlayType(mimeType);
    return canPlay === 'probably' || canPlay === 'maybe';
  }, []);

  // 预加载检查：确保 local-resource:// 文件存在且可访问，并检查格式兼容性
  React.useEffect(() => {
    if (safeUrl.startsWith('local-resource://') && !useFallbackUrl && originalRemoteUrl && window.electronAPI) {
      // 先检查格式兼容性
      if (!checkVideoCompatibility(safeUrl)) {
        console.warn(`[VideoPreview] 预加载检查：视频格式可能不兼容，立即切换到备用 URL`);
        setUseFallbackUrl(true);
        setVideoSrc(originalRemoteUrl);
        return;
      }

      // 通过 IPC 检查文件是否存在（避免尝试加载不存在的文件）
      window.electronAPI.checkFileExists(safeUrl).then((result) => {
        if (!result.exists || !result.readable) {
          console.warn(`[VideoPreview] 预加载检查：文件不存在或不可读 (exists: ${result.exists}, readable: ${result.readable})，立即切换到备用 URL`);
          setUseFallbackUrl(true);
          setVideoSrc(originalRemoteUrl);
          return;
        }
        
        // 文件存在，继续使用本地文件
        console.log(`[VideoPreview] 预加载检查：文件存在且可读 (size: ${result.size} bytes)`);
      }).catch((error) => {
        console.warn(`[VideoPreview] 预加载检查：检查文件失败，切换到备用 URL:`, error);
        setUseFallbackUrl(true);
        setVideoSrc(originalRemoteUrl);
      });
    }
  }, [safeUrl, useFallbackUrl, originalRemoteUrl, checkVideoCompatibility]);

  const handleError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    const error = video.error;

    // 详细的错误信息
    const errorInfo = {
      src: video.currentSrc || src,
      code: error?.code,
      message: error?.message,
      networkState: video.networkState,
      readyState: video.readyState,
    };

    console.error('[VIDEO_LOAD_ERROR]', errorInfo);
    
    // 如果正在重试中，不处理错误（避免重复触发）
    if (isRetryingRef.current) {
      return;
    }
    
    // 如果是 DEMUXER_ERROR、DECODE 错误或 code: 4 (MEDIA_ERR_SRC_NOT_SUPPORTED)，尝试容错处理
    if (
      error?.code === MediaError.MEDIA_ERR_DECODE || 
      error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || // code: 4
      error?.message?.includes('DEMUXER_ERROR') ||
      error?.message?.includes('COULD_NOT_OPEN') ||
      error?.message?.includes('PIPELINE_ERROR_DECODE')
    ) {
      // 如果使用的是 local-resource:// 且还有原始远程 URL，立即切换到远程 URL
      if (video.currentSrc.startsWith('local-resource://') && originalRemoteUrl && !useFallbackUrl) {
        console.log(`[VideoPreview] local-resource:// 加载失败 (code: ${error?.code})，立即切换到原始远程 URL: ${originalRemoteUrl}`);
        setUseFallbackUrl(true);
        setVideoSrc(originalRemoteUrl);
        isRetryingRef.current = true;
        setTimeout(() => {
          isRetryingRef.current = false;
        }, 500);
        return; // 不显示错误提示，等待远程 URL 加载
      }
      
      // 如果重试次数未达到上限，尝试重试
      if (retryCount < maxRetries) {
        const nextRetry = retryCount + 1;
        console.log(`[VideoPreview] 视频加载失败，${1000 * nextRetry}ms 后重试 (${nextRetry}/${maxRetries})...`);
        
        // 标记正在重试
        isRetryingRef.current = true;
        
        // 延迟重试，给文件系统更多时间
        setTimeout(() => {
          setRetryCount(nextRetry);
          // 通过重新设置 src 来触发重试（不设置空字符串，直接设置新值）
          // 使用 key 属性强制重新渲染，而不是清空 src
          setVideoSrc(safeUrl + `?retry=${nextRetry}`); // 添加查询参数强制重新加载
          
          // 重置重试标记（延迟一点，确保视频元素有机会加载）
          setTimeout(() => {
            isRetryingRef.current = false;
          }, 500);
        }, 1000 * nextRetry); // 递增延迟：1s, 2s, 3s
        return; // 不显示错误提示，等待重试
      }
    }

    // 所有重试都失败后，才显示错误提示
    // 根据错误代码提供更具体的错误信息
    let errorMessage = '视频无法播放，原因可能是：\n';
    
    if (error) {
      switch (error.code) {
        case MediaError.MEDIA_ERR_ABORTED:
          errorMessage += '1. 视频加载被中止\n';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          errorMessage += '1. 网络错误，无法加载视频\n';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          errorMessage += '1. 视频编码不被浏览器支持\n';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage += '1. 视频格式不被浏览器支持\n';
          break;
        default:
          errorMessage += '1. 未知错误\n';
      }
    } else {
      errorMessage += '1. 视频编码不被浏览器支持\n';
    }

    errorMessage += '2. OSS Content-Type 配置错误\n';
    errorMessage += '3. 视频尚未完成转码\n\n';
    errorMessage += '建议：请等待片刻或刷新页面';

    // 只有在所有重试都失败后才显示错误提示
    if (retryCount >= maxRetries) {
      // 延迟显示，避免在重试过程中弹出
      setTimeout(() => {
        showAlert(errorMessage);
      }, 100);
    }
  };

  // 移除查询参数（retry参数仅用于强制重新加载）
  const cleanSrc = videoSrc.split('?')[0];
  lastSrcRef.current = cleanSrc;
  cleanSrcRef.current = cleanSrc;

  const initialSeekAppliedForSrcRef = useRef<string | null>(null);
  /** 仅在实际切换片源时清空 seek 标记；首帧切勿在 loadedmetadata 之后无条件清空，否则 tryNudge 会把进度拉回 0 */
  const prevCleanSrcForResetRef = useRef<string | null>(null);

  useEffect(() => {
    const prev = prevCleanSrcForResetRef.current;
    if (prev !== null && prev !== cleanSrc) {
      initialSeekAppliedForSrcRef.current = null;
    }
    prevCleanSrcForResetRef.current = cleanSrc;
    firstFrameNudgeKeyRef.current = null;
    decodedNotifySentRef.current = false;
    const v = videoElRef.current;
    const id = pendingRvfcRef.current;
    if (v != null && id != null && typeof (v as HTMLVideoElement & { cancelVideoFrameCallback?: (n: number) => void }).cancelVideoFrameCallback === 'function') {
      try {
        (v as HTMLVideoElement & { cancelVideoFrameCallback: (n: number) => void }).cancelVideoFrameCallback(id);
      } catch (_) {
        /* ignore */
      }
    }
    pendingRvfcRef.current = null;
    if (decodedFallbackTimerRef.current != null) {
      window.clearTimeout(decodedFallbackTimerRef.current);
      decodedFallbackTimerRef.current = null;
    }
  }, [cleanSrc]);

  /**
   * Chromium / Electron 下部分 MP4（H.264）在 currentTime=0 时尚未解码出画，表现为黑屏+加载圈。
   * 先微 seek 再回 0，可触发关键帧解码，与 poster 叠加以减轻「总像黑色」的观感。
   */
  const notifyDecodedFrameOnce = React.useCallback(() => {
    if (decodedNotifySentRef.current) return;
    if (decodedFallbackTimerRef.current != null) {
      window.clearTimeout(decodedFallbackTimerRef.current);
      decodedFallbackTimerRef.current = null;
    }
    decodedNotifySentRef.current = true;
    onDecodedFrame?.();
  }, [onDecodedFrame]);

  /** 首帧实际绘到 video 上后再通知，避免 <video> 已 canplay 但仍全黑 */
  const scheduleDecodedFrameNotification = React.useCallback(
    (video: HTMLVideoElement) => {
      if (decodedNotifySentRef.current) return;
      const v = video;
      if (decodedFallbackTimerRef.current != null) {
        window.clearTimeout(decodedFallbackTimerRef.current);
        decodedFallbackTimerRef.current = null;
      }
      const onPlayingOnce = () => {
        notifyDecodedFrameOnce();
      };
      v.addEventListener('playing', onPlayingOnce, { once: true });
      if (typeof v.requestVideoFrameCallback === 'function') {
        const prev = pendingRvfcRef.current;
        if (prev != null && typeof v.cancelVideoFrameCallback === 'function') {
          try {
            v.cancelVideoFrameCallback(prev);
          } catch (_) {
            /* ignore */
          }
        }
        const id = v.requestVideoFrameCallback(() => {
          if (pendingRvfcRef.current === id) pendingRvfcRef.current = null;
          notifyDecodedFrameOnce();
        });
        pendingRvfcRef.current = id;
        /** 部分封装/编码下 RVFC 永不回调，但音频已播；与 VideoNode 解码遮罩配合会表现为「有声、画面像静帧」 */
        const t = window.setTimeout(() => {
          decodedFallbackTimerRef.current = null;
          notifyDecodedFrameOnce();
        }, 900);
        decodedFallbackTimerRef.current = t;
        return;
      }
      window.setTimeout(() => {
        if (!decodedNotifySentRef.current && v.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          notifyDecodedFrameOnce();
        }
      }, 600);
    },
    [notifyDecodedFrameOnce],
  );

  const tryNudgeFirstFrameDecode = React.useCallback((video: HTMLVideoElement) => {
    const srcKey = cleanSrcRef.current;
    if (!srcKey || firstFrameNudgeKeyRef.current === srcKey) return;
    const resumeT = initialPlaybackTimeSec;
    if (typeof resumeT === 'number' && Number.isFinite(resumeT)) {
      try {
        if (video.readyState >= 1) {
          const d = video.duration;
          if (Number.isFinite(d) && d > 0) {
            const hi = Math.max(0, d - 1e-6);
            const target = Math.min(Math.max(0, resumeT), hi);
            if (Math.abs(video.currentTime - target) > 0.05) {
              video.currentTime = target;
            }
          }
        }
      } catch (_) {
        /* ignore */
      }
      firstFrameNudgeKeyRef.current = srcKey;
      return;
    }
    try {
      if (video.readyState < 2) return;
      const d = video.duration;
      if (!d || !Number.isFinite(d) || d < 0.08) {
        firstFrameNudgeKeyRef.current = srcKey;
        return;
      }
      if (video.currentTime > 0.02) {
        firstFrameNudgeKeyRef.current = srcKey;
        return;
      }
      firstFrameNudgeKeyRef.current = srcKey;
      const nudge = Math.min(0.12, Math.max(0.02, d / 80));
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try {
          video.currentTime = 0;
        } catch (_) {
          /* ignore */
        }
      };
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        window.clearTimeout(fallbackTimer);
        finish();
      };
      const fallbackTimer = window.setTimeout(finish, 250);
      video.addEventListener('seeked', onSeeked, { once: true });
      video.currentTime = nudge;
    } catch (_) {
      firstFrameNudgeKeyRef.current = srcKey;
    }
  }, [initialPlaybackTimeSec]);

  const handleCanPlayWrapped = React.useCallback(() => {
    const v = videoElRef.current;
    if (v) {
      tryNudgeFirstFrameDecode(v);
      scheduleDecodedFrameNotification(v);
    }
    onCanPlay?.();
  }, [onCanPlay, tryNudgeFirstFrameDecode, scheduleDecodedFrameNotification]);

  const handleLoadedData = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = e.currentTarget;
    console.log('[VIDEO_LOAD_SUCCESS]', {
      src: safeUrl,
      duration: video.duration,
    });
    setRetryCount(0);
    isRetryingRef.current = false;
    tryNudgeFirstFrameDecode(video);
    scheduleDecodedFrameNotification(video);
  };

  useEffect(() => {
    return () => {
      const v = videoElRef.current;
      const id = pendingRvfcRef.current;
      if (v != null && id != null && typeof (v as HTMLVideoElement & { cancelVideoFrameCallback?: (n: number) => void }).cancelVideoFrameCallback === 'function') {
        try {
          (v as HTMLVideoElement & { cancelVideoFrameCallback: (n: number) => void }).cancelVideoFrameCallback(id);
        } catch (_) {
          /* ignore */
        }
      }
      pendingRvfcRef.current = null;
      if (decodedFallbackTimerRef.current != null) {
        window.clearTimeout(decodedFallbackTimerRef.current);
        decodedFallbackTimerRef.current = null;
      }
      if (onLastFrameCapture && lastSrcRef.current) {
        captureCurrentFrame(lastSrcRef.current, onLastFrameCapture);
      }
      releaseVideo();
    };
  }, [releaseVideo, captureCurrentFrame, onLastFrameCapture]);

  // Electron 下 <video> 对 local-resource:// 偶发异常时转 file:///；必须带中文分段 encode
  const displaySrc = React.useMemo(() => toElectronVideoElementSrc(cleanSrc) || cleanSrc, [cleanSrc]);
  
  // 判断是否为远程 URL，需要添加 crossOrigin
  const isRemoteUrl = cleanSrc.startsWith('http://') || cleanSrc.startsWith('https://');
  
  // 根据文件扩展名判断 MIME 类型
  const getMimeType = (url: string): string | undefined => {
    const ext = url.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'mp4':
        return 'video/mp4';
      case 'webm':
        return 'video/webm';
      case 'ogg':
        return 'video/ogg';
      case 'mov':
        return 'video/quicktime';
      default:
        return undefined;
    }
  };
  
  const mimeType = getMimeType(cleanSrc);

  const handlePlaybackReport = React.useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>, immediate: boolean) => {
      if (!onPlaybackTime) return;
      const v = e.currentTarget;
      const d = v.duration;
      onPlaybackTime(v.currentTime, Number.isFinite(d) && d > 0 ? d : undefined, immediate);
    },
    [onPlaybackTime]
  );

  const handleLoadedMetadataInner = React.useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const v = e.currentTarget;
      const key = cleanSrcRef.current;
      if (key && initialSeekAppliedForSrcRef.current !== key) {
        const t = initialPlaybackTimeSec;
        if (typeof t === 'number' && Number.isFinite(t)) {
          const dur = v.duration;
          if (Number.isFinite(dur) && dur > 0) {
            initialSeekAppliedForSrcRef.current = key;
            const hi = Math.max(0, dur - 1e-6);
            const target = Math.min(Math.max(0, t), hi);
            try {
              v.currentTime = target;
            } catch (_) {
              /* ignore */
            }
          }
        } else {
          initialSeekAppliedForSrcRef.current = key;
        }
      }
      if (onLoadedMetadata && v.videoWidth > 0 && v.videoHeight > 0) {
        onLoadedMetadata(v.videoWidth, v.videoHeight, v.duration);
      }
    },
    [initialPlaybackTimeSec, onLoadedMetadata]
  );

  // 在加载前检查格式兼容性（如果 local-resource 失败，立即切换到远程 URL）
  React.useEffect(() => {
    if (cleanSrc.startsWith('local-resource://') && originalRemoteUrl && !useFallbackUrl) {
      // 检查格式兼容性
      if (!checkVideoCompatibility(cleanSrc)) {
        console.warn(`[VideoPreview] 视频格式不兼容，立即切换到远程 URL`);
        setUseFallbackUrl(true);
        setVideoSrc(originalRemoteUrl);
      }
    }
  }, [cleanSrc, originalRemoteUrl, useFallbackUrl, checkVideoCompatibility]);
  
  // 只在真正需要重试时才改变 key，避免不必要的重新加载
  const videoKey = retryCount > 0 || useFallbackUrl 
    ? `${cleanSrc}-${retryCount}-${useFallbackUrl}` 
    : cleanSrc; // 正常情况下使用稳定的 key

  /** 悬停恢复：仅在 currentTime≈0（如刚 remount）时才按 initialPlaybackTimeSec seek */
  useLayoutEffect(() => {
    const v = videoElRef.current;
    if (!v || isPaused) return;
    const t = initialPlaybackTimeSec;
    if (!(typeof t === 'number' && Number.isFinite(t))) return;
    // 已有有效进度则不要覆盖（否则会与 live 位置来回跳 / 闪回片头）
    if (Number.isFinite(v.currentTime) && v.currentTime > 0.05) return;

    const applySeek = () => {
      const dur = v.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const hi = Math.max(0, dur - 1e-6);
      const target = Math.min(Math.max(0, t), hi);
      if (Math.abs(v.currentTime - target) > 0.12) {
        try {
          v.currentTime = target;
        } catch {
          /* ignore */
        }
      }
    };

    applySeek();
    if (!Number.isFinite(v.duration) || v.duration <= 0 || v.readyState < HTMLMediaElement.HAVE_METADATA) {
      const onMeta = () => {
        applySeek();
        v.removeEventListener('loadedmetadata', onMeta);
      };
      v.addEventListener('loadedmetadata', onMeta, { once: true });
    }
  }, [isPaused, initialPlaybackTimeSec, cleanSrc, videoKey]);

  const restorePortalFullscreen = useCallback(() => {
    flushPlaybackTime();
    const shell = portalShellRef.current;
    const host = videoHostRef.current;
    const vid = videoElRef.current;
    if (!shell) return;
    portalEnteredNativeFsRef.current = false;
    try {
      if (host && vid && vid.parentNode === shell) {
        host.appendChild(vid);
        vid.style.cssText = savedVideoStyleRef.current;
        vid.controls = savedVideoControlsRef.current;
      }
    } catch (_) {
      /* ignore */
    }
    try {
      shell.remove();
    } catch (_) {
      /* ignore */
    }
    portalShellRef.current = null;
  }, [flushPlaybackTime]);

  const openPortalFullscreenLayer = useCallback((): boolean => {
      if (!fixFullscreenForTransformedParent) return false;
      const host = videoHostRef.current;
      const vid = videoElRef.current;
      if (!host || !vid || portalShellRef.current) return false;
      // 顶栏 URL 浮层已开时勿再叠一层
      if (standalonePortalShell || document.querySelector('[data-nexflow-portal-video-fs="1"]')) {
        return false;
      }
      // releaseVideo 后可能清空 src；放大前按当前源补回，避免黑屏
      const liveSrc = (vid.currentSrc || vid.getAttribute('src') || '').trim();
      const wantSrc = (cleanSrcRef.current || '').trim();
      if (!liveSrc && wantSrc) {
        try {
          vid.src = wantSrc;
          vid.load();
        } catch {
          /* ignore */
        }
      }
      const shell = document.createElement('div');
      shell.dataset.nexflowPortalVideoFs = '1';
      Object.assign(shell.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '100050',
        background: '#000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      });
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', portalFullscreenExitTitle);
      closeBtn.textContent = '\u00D7';
      Object.assign(closeBtn.style, {
        position: 'absolute',
        top: '12px',
        right: '12px',
        zIndex: '2',
        width: '44px',
        height: '44px',
        borderRadius: '10px',
        background: 'rgba(255,255,255,0.12)',
        color: '#fff',
        border: 'none',
        cursor: 'pointer',
        fontSize: '26px',
        lineHeight: '44px',
        padding: '0',
      });
      const exitPortal = () => {
        const doc = document as Document & {
          webkitFullscreenElement?: Element | null;
          webkitExitFullscreen?: () => void | Promise<void>;
        };
        const fsEl = document.fullscreenElement ?? doc.webkitFullscreenElement;
        if (fsEl === shell) {
          const docEx = document.exitFullscreen?.();
          if (docEx !== undefined) {
            void Promise.resolve(docEx).catch(() => restorePortalFullscreen());
            return;
          }
          void Promise.resolve(doc.webkitExitFullscreen?.()).catch(() => restorePortalFullscreen());
          return;
        }
        restorePortalFullscreen();
      };
      closeBtn.onclick = (ev) => {
        ev.stopPropagation();
        exitPortal();
      };
      // 点击黑边关闭（点到 video 不关）
      shell.onclick = (ev) => {
        if (ev.target === shell) exitPortal();
      };
      shell.appendChild(closeBtn);
      document.body.appendChild(shell);
      portalShellRef.current = shell;
      portalEnteredNativeFsRef.current = false;
      savedVideoStyleRef.current = vid.style.cssText;
      savedVideoControlsRef.current = vid.controls;
      shell.appendChild(vid);
      // 节点内常用 controls=false（外挂播放条）；进浮层后打开原生控件便于观看
      vid.controls = true;
      Object.assign(vid.style, {
        width: '100%',
        height: '100%',
        maxWidth: '100vw',
        maxHeight: '100vh',
        objectFit: 'contain',
      });
      void vid.play().catch(() => {});
      const sh = shell as unknown as {
        requestFullscreen?: (opts?: FullscreenOptions) => Promise<void>;
        webkitRequestFullscreen?: () => void;
      };
      // 原生 FS 在 Electron / transform 祖先下常失败；CSS fixed 壳才是可靠体验，失败时切勿拆层
      try {
        if (typeof sh.requestFullscreen === 'function') {
          void Promise.resolve(sh.requestFullscreen())
            .then(() => {
              if (portalShellRef.current === shell) portalEnteredNativeFsRef.current = true;
            })
            .catch(() => {
              /* keep CSS overlay */
            });
        } else if (typeof sh.webkitRequestFullscreen === 'function') {
          try {
            sh.webkitRequestFullscreen();
            portalEnteredNativeFsRef.current = true;
          } catch (_) {
            /* keep CSS overlay */
          }
        }
      } catch (_) {
        /* keep CSS overlay */
      }
      return true;
  }, [
      fixFullscreenForTransformedParent,
      portalFullscreenExitTitle,
      restorePortalFullscreen,
  ]);

  /**
   * 在包裹层捕获：事件路径为 host → video → UA shadow 内控件，先于 shadow 内目标触发；
   * 比在 video 上监听更可靠，且不必在 document 上 stopImmediatePropagation。
   */
  useLayoutEffect(() => {
    if (!fixFullscreenForTransformedParent || !controls) return;
    const host = videoHostRef.current;
    const vid = videoElRef.current;
    if (!host || !vid) return;
    const onPointerDownCapture = (ev: PointerEvent) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      if (portalShellRef.current) return;
      const r = vid.getBoundingClientRect();
      if (!pointInNativeVideoFullscreenControlSlot(ev.clientX, ev.clientY, r)) return;
      ev.preventDefault();
      ev.stopPropagation();
      openPortalFullscreenLayer();
    };
    host.addEventListener('pointerdown', onPointerDownCapture, true);
    return () => {
      host.removeEventListener('pointerdown', onPointerDownCapture, true);
    };
  }, [fixFullscreenForTransformedParent, controls, videoKey, openPortalFullscreenLayer]);

  useEffect(() => {
    if (!fixFullscreenForTransformedParent || !controls) return;
    const vid = videoElRef.current;
    if (!vid) return;
    const onFsError = () => {
      if (portalShellRef.current) return;
      openPortalFullscreenLayer();
    };
    vid.addEventListener('fullscreenerror', onFsError);
    return () => {
      vid.removeEventListener('fullscreenerror', onFsError);
    };
  }, [fixFullscreenForTransformedParent, controls, videoKey, openPortalFullscreenLayer]);

  useEffect(() => {
    if (!fixFullscreenForTransformedParent) return;
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const onFsChange = () => {
      const fsEl = document.fullscreenElement ?? doc.webkitFullscreenElement;
      const shell = portalShellRef.current;
      if (fsEl && shell && fsEl === shell) {
        portalEnteredNativeFsRef.current = true;
        return;
      }
      if (fsEl) return;
      // 仅在「曾进入原生全屏」后退出时拆层；纯 CSS 浮层靠关闭钮 / Esc
      if (!portalEnteredNativeFsRef.current) return;
      const vid = videoElRef.current;
      if (shell && vid?.parentNode === shell) {
        restorePortalFullscreen();
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, [fixFullscreenForTransformedParent, restorePortalFullscreen]);

  useEffect(() => {
    if (!fixFullscreenForTransformedParent) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!portalShellRef.current) return;
      if (portalEnteredNativeFsRef.current) return; // 原生 FS 由浏览器 Esc 退出
      e.preventDefault();
      e.stopPropagation();
      restorePortalFullscreen();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [fixFullscreenForTransformedParent, restorePortalFullscreen]);

  useEffect(() => {
    return () => {
      restorePortalFullscreen();
    };
  }, [restorePortalFullscreen]);

  useEffect(() => {
    return () => {
      onPlayingChange?.(false);
    };
  }, [onPlayingChange]);

  useImperativeHandle(ref, () => ({
    pause: () => videoElRef.current?.pause(),
    play: () => videoElRef.current?.play().catch(() => {}),
    releaseVideo,
    captureCurrentFrame,
    warmupDecode,
    flushPlaybackTime,
    getCurrentTimeSec,
    getDurationSec,
    seekTo,
    setVolume,
    getVolume,
    openPortalFullscreen: () => openPortalFullscreenLayer(),
    getVideoElement: () => videoElRef.current,
  }), [releaseVideo, captureCurrentFrame, warmupDecode, flushPlaybackTime, getCurrentTimeSec, getDurationSec, seekTo, setVolume, getVolume, openPortalFullscreenLayer]);

  const videoEl = (
    <video
      ref={videoElRef}
      key={videoKey}
      src={displaySrc}
      poster={poster || undefined}
      controls={controls}
      preload={preload}
      playsInline={playsInline}
      muted={muted}
      loop={loop}
      draggable={false}
      className={className}
      style={{ width: '100%', objectFit: 'contain', borderRadius: 8, ...style }}
      crossOrigin={isRemoteUrl ? 'anonymous' : undefined}
      {...(playsInline ? { 'webkit-playsinline': 'true', 'x5-playsinline': 'true' } as React.HTMLAttributes<HTMLVideoElement> : {})}
      onError={handleError}
      onLoadedData={handleLoadedData}
      onCanPlay={handleCanPlayWrapped}
      onEnded={(e) => {
        if (loop) {
          const v = e.currentTarget;
          const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
          // 循环重播时把进度重置为 0，避免父组件 resume 仍停在片尾
          if (onPlaybackTime) {
            onPlaybackTime(0, dur > 0 ? dur : undefined, true);
          }
          if (!isPausedRef.current) {
            try {
              v.currentTime = 0;
              void v.play().catch(() => {});
            } catch {
              /* ignore */
            }
          }
          onUiPlaybackTick?.(0, dur, !isPausedRef.current && !v.paused);
          return;
        }
        handlePlaybackReport(e, true);
        onPlayingChange?.(false);
        if (onLastFrameCapture && cleanSrc) {
          captureCurrentFrame(cleanSrc, onLastFrameCapture);
        }
      }}
      onLoadedMetadata={handleLoadedMetadataInner}
      onSeeked={(e) => {
        handlePlaybackReport(e, true);
        const v = e.currentTarget;
        const d = v.duration;
        onUiPlaybackTick?.(
          v.currentTime,
          Number.isFinite(d) && d > 0 ? d : 0,
          !v.paused,
        );
      }}
      onTimeUpdate={(e) => {
        if (!onUiPlaybackTick) return;
        const v = e.currentTarget;
        if (v.seeking) return;
        const d = v.duration;
        onUiPlaybackTick(
          v.currentTime,
          Number.isFinite(d) && d > 0 ? d : 0,
          !v.paused,
        );
      }}
      onPlay={() => {
        onPlayingChange?.(true);
        const v = videoElRef.current;
        if (v && onUiPlaybackTick) {
          const d = v.duration;
          onUiPlaybackTick(
            v.currentTime,
            Number.isFinite(d) && d > 0 ? d : 0,
            true,
          );
        }
      }}
      onPause={(e) => {
        handlePlaybackReport(e, true);
        onPlayingChange?.(false);
        const v = e.currentTarget;
        onUiPlaybackTick?.(
          v.currentTime,
          Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0,
          false,
        );
      }}
      onClick={onClick}
    >
      {mimeType && <source src={displaySrc} type={mimeType} />}
    </video>
  );

  if (!fixFullscreenForTransformedParent) {
    return videoEl;
  }

  return (
    <div ref={videoHostRef} className="relative w-full h-full min-h-0">
      {videoEl}
    </div>
  );
});
