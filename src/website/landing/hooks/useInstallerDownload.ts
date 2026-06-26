import { useCallback, useEffect, useState } from 'react';
import {
  detectInstallerPlatform,
  resolveMacInstallerUrl,
  resolveWindowsInstallerUrl,
  type InstallerPlatform,
} from '../lib/installerDownload';

type State = {
  platform: InstallerPlatform;
  windowsUrl: string;
  macUrl: string;
  primaryUrl: string;
  loading: boolean;
};

export function useInstallerDownload() {
  const [state, setState] = useState<State>(() => ({
    platform: detectInstallerPlatform(),
    windowsUrl: '',
    macUrl: '',
    primaryUrl: '',
    loading: true,
  }));

  const refresh = useCallback(async () => {
    const platform = detectInstallerPlatform();
    setState((s) => ({ ...s, platform, loading: true }));
    const [windowsUrl, macUrl] = await Promise.all([
      resolveWindowsInstallerUrl(),
      resolveMacInstallerUrl(),
    ]);
    const primaryUrl = platform === 'mac' ? macUrl || windowsUrl : windowsUrl || macUrl;
    setState({ platform, windowsUrl, macUrl, primaryUrl, loading: false });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
