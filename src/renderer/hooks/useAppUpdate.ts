import { useCallback, useEffect, useState } from 'react';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { getStoredSettingsLocale, settingsT } from '../i18n/settingsI18n';

export type AppUpdateDownloadProgress = {
  phase?: 'stub' | 'main-package' | 'full' | 'paused';
  percent: number;
  stubPercent?: number;
  packagePercent?: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
  packageBytes?: number;
  stubBytes?: number;
  etaSeconds?: number | null;
  fileName?: string;
  savePath?: string;
  paused?: boolean;
};

export function useAppUpdate(options?: { autoCheck?: boolean }) {
  const { locale } = useAppLocale();
  const t = settingsT(locale);
  const autoCheck = options?.autoCheck !== false;

  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateDownloadError, setUpdateDownloadError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<AppUpdateDownloadProgress | null>(null);
  const [downloadPaused, setDownloadPaused] = useState(false);
  const [lastCheckResult, setLastCheckResult] = useState<{
    currentVersion: string;
    latestVersion: string | null;
    isLatest: boolean;
    error?: boolean;
    errorMessage?: string | null;
  } | null>(null);
  const [appVersion, setAppVersion] = useState('');

  const supportsUpdate = Boolean(window.electronAPI?.checkForUpdates);

  useEffect(() => {
    if (!window.electronAPI?.getAppVersion) return;
    window.electronAPI.getAppVersion().then((v) => setAppVersion(v || ''));
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateAvailable) return;
    const unsub = window.electronAPI.onUpdateAvailable((info) => {
      const loc = getStoredSettingsLocale();
      setUpdateAvailable(info?.version || settingsT(loc).newVersionFallback);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateDownloaded) return;
    const unsub = window.electronAPI.onUpdateDownloaded(() => {
      setUpdateDownloading(false);
      setDownloadPaused(false);
      setDownloadProgress(null);
      setUpdateAvailable(null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateInstalling) return;
    const unsub = window.electronAPI.onUpdateInstalling(() => {
      setUpdateInstalling(true);
      setUpdateDownloading(false);
      setDownloadPaused(false);
      setDownloadProgress(null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateDownloadProgress) return;
    const unsub = window.electronAPI.onUpdateDownloadProgress((info) => {
      const percent = Number.isFinite(info.percent) ? info.percent : 0;
      const transferred = Number.isFinite(info.transferred) ? info.transferred : 0;
      const total = Number.isFinite(info.total) ? info.total : 0;
      const bytesPerSecond = Number.isFinite(info.bytesPerSecond) ? info.bytesPerSecond : 0;
      setDownloadProgress({
        phase: info.phase,
        percent,
        stubPercent: info.stubPercent,
        packagePercent: info.packagePercent,
        bytesPerSecond,
        transferred,
        total,
        packageBytes: info.packageBytes,
        stubBytes: info.stubBytes,
        etaSeconds: info.etaSeconds,
        fileName: info.fileName,
        savePath: info.savePath,
        paused: info.paused,
      });
      if (info.paused != null) setDownloadPaused(!!info.paused);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateDownloadPaused) return;
    const unsub = window.electronAPI.onUpdateDownloadPaused((info) => {
      setDownloadPaused(!!info?.paused);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateDownloadCancelled) return;
    const unsub = window.electronAPI.onUpdateDownloadCancelled(() => {
      setUpdateDownloading(false);
      setDownloadPaused(false);
      setDownloadProgress(null);
      setUpdateDownloadError(null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateError) return;
    const unsub = window.electronAPI.onUpdateError((info) => {
      setUpdateDownloading(false);
      setUpdateInstalling(false);
      setDownloadPaused(false);
      setDownloadProgress(null);
      setUpdateDownloadError(info?.message || t.downloadFailed);
    });
    return unsub;
  }, [t.downloadFailed]);

  const handleCheckUpdate = useCallback(async () => {
    if (!window.electronAPI?.checkForUpdates) return;
    setUpdateChecking(true);
    setUpdateAvailable(null);
    setLastCheckResult(null);
    setUpdateDownloadError(null);
    try {
      const res = await window.electronAPI.checkForUpdates();
      const currentVersion = res?.currentVersion ?? '';
      const latestVersion = res?.latestVersion ?? null;
      const isLatest = !res?.updateAvailable;
      const errorMsg = res?.error ?? null;
      setLastCheckResult({ currentVersion, latestVersion, isLatest, error: !!errorMsg, errorMessage: errorMsg });
      if (res?.updateAvailable && latestVersion) setUpdateAvailable(latestVersion);
    } catch {
      setLastCheckResult({
        currentVersion: '',
        latestVersion: null,
        isLatest: false,
        error: true,
        errorMessage: t.requestFailed,
      });
    } finally {
      setUpdateChecking(false);
    }
  }, [t.requestFailed]);

  useEffect(() => {
    if (!autoCheck || !supportsUpdate) return;
    void handleCheckUpdate();
  }, [autoCheck, supportsUpdate, handleCheckUpdate]);

  const handleInstallUpdate = useCallback(async () => {
    if (!window.electronAPI?.downloadAndInstallUpdate || !updateAvailable) return;
    setUpdateDownloading(true);
    setDownloadPaused(false);
    setUpdateDownloadError(null);
    setDownloadProgress(null);
    try {
      const res = await window.electronAPI.downloadAndInstallUpdate();
      if (!res?.success) {
        if (res?.error === 'cancelled') {
          setUpdateDownloading(false);
          setDownloadProgress(null);
          return;
        }
        setUpdateDownloading(false);
        setDownloadProgress(null);
        setUpdateDownloadError(res?.error || t.downloadFailed);
      }
    } catch {
      setUpdateDownloading(false);
      setDownloadProgress(null);
      setUpdateDownloadError(t.downloadFailed);
    }
  }, [updateAvailable, t.downloadFailed]);

  const handlePauseDownload = useCallback(async () => {
    if (!window.electronAPI?.pauseUpdateDownload) return;
    await window.electronAPI.pauseUpdateDownload();
    setDownloadPaused(true);
  }, []);

  const handleResumeDownload = useCallback(async () => {
    if (!window.electronAPI?.resumeUpdateDownload) return;
    setDownloadPaused(false);
    setUpdateDownloading(true);
    const res = await window.electronAPI.resumeUpdateDownload();
    if (!res?.success && res?.error && res.error !== 'cancelled') {
      setUpdateDownloading(false);
      setUpdateDownloadError(res.error || t.downloadFailed);
    }
  }, [t.downloadFailed]);

  const handleCancelDownload = useCallback(async () => {
    if (!window.electronAPI?.cancelUpdateDownload) return;
    await window.electronAPI.cancelUpdateDownload();
    setUpdateDownloading(false);
    setDownloadPaused(false);
    setDownloadProgress(null);
  }, []);

  const formatBytes = useCallback((bytes: number) => {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }, []);

  return {
    t,
    supportsUpdate,
    appVersion,
    updateChecking,
    updateAvailable,
    updateDownloading,
    updateInstalling,
    updateDownloadError,
    downloadProgress,
    downloadPaused,
    lastCheckResult,
    handleCheckUpdate,
    handleInstallUpdate,
    handlePauseDownload,
    handleResumeDownload,
    handleCancelDownload,
    formatBytes,
  };
}
