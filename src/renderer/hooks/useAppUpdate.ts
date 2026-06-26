import { useCallback, useEffect, useState } from 'react';
import { useAppLocale } from '../contexts/AppLocaleContext';
import { getStoredSettingsLocale, settingsT } from '../i18n/settingsI18n';

export type AppUpdateDownloadProgress = {
  phase?: 'stub' | 'main-package' | 'full';
  percent: number;
  stubPercent?: number;
  packagePercent?: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
  packageBytes?: number;
  stubBytes?: number;
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
      setDownloadProgress(null);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateDownloadProgress) return;
    const unsub = window.electronAPI.onUpdateDownloadProgress((info) => {
      setDownloadProgress({
        phase: info.phase,
        percent: info.percent,
        stubPercent: info.stubPercent,
        packagePercent: info.packagePercent,
        bytesPerSecond: info.bytesPerSecond,
        transferred: info.transferred,
        total: info.total,
        packageBytes: info.packageBytes,
        stubBytes: info.stubBytes,
      });
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateError) return;
    const unsub = window.electronAPI.onUpdateError((info) => {
      setUpdateDownloading(false);
      setUpdateInstalling(false);
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
    setUpdateDownloadError(null);
    setDownloadProgress(null);
    try {
      const res = await window.electronAPI.downloadAndInstallUpdate();
      if (!res?.success) {
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

  const formatBytes = useCallback((bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
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
    lastCheckResult,
    handleCheckUpdate,
    handleInstallUpdate,
    formatBytes,
  };
}
