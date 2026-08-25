import { useCallback, useEffect, useState } from 'react';
import {
  detectInstallerPlatform,
  getPreferredDownloadRegion,
  resolveInstallerArtifactStrict,
  resolveMacInstallerUrl,
  resolveWindowsInstallerUrl,
  subscribeDownloadRegion,
  type InstallerPlatform,
  type ReleaseDownloadRegion,
} from '../lib/installerDownload';

type State = {
  platform: InstallerPlatform;
  region: ReleaseDownloadRegion;
  windowsUrl: string;
  macUrl: string;
  primaryUrl: string;
  loading: boolean;
};

export function useInstallerDownload() {
  const [state, setState] = useState<State>(() => ({
    platform: detectInstallerPlatform(),
    region: getPreferredDownloadRegion(),
    windowsUrl: '',
    macUrl: '',
    primaryUrl: '',
    loading: true,
  }));

  const refresh = useCallback(async (preferred?: ReleaseDownloadRegion) => {
    const platform = detectInstallerPlatform();
    const region = preferred ?? getPreferredDownloadRegion();
    setState((s) => ({ ...s, platform, region, loading: true }));
    const [windowsUrl, macUrl] = await Promise.all([
      resolveWindowsInstallerUrl(region),
      resolveMacInstallerUrl(region),
    ]);
    const primaryUrl = platform === 'mac' ? macUrl || windowsUrl : windowsUrl || macUrl;
    setState({ platform, region, windowsUrl, macUrl, primaryUrl, loading: false });
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeDownloadRegion((region) => {
      void refresh(region);
    });
  }, [refresh]);

  return { ...state, refresh };
}

type DualState = {
  platform: InstallerPlatform;
  beijingUrl: string;
  hongKongUrl: string;
  loading: boolean;
};

/** 同时解析北京、香港两条直链，供用户按网速自选 */
export function useDualInstallerDownload() {
  const [state, setState] = useState<DualState>(() => ({
    platform: detectInstallerPlatform(),
    beijingUrl: '',
    hongKongUrl: '',
    loading: true,
  }));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const platform = detectInstallerPlatform();
      setState((s) => ({ ...s, platform, loading: true }));
      const [cn, hk] = await Promise.all([
        resolveInstallerArtifactStrict(platform, 'cn'),
        resolveInstallerArtifactStrict(platform, 'hk'),
      ]);
      if (cancelled) return;
      setState({
        platform,
        beijingUrl: cn?.url || '',
        hongKongUrl: hk?.url || '',
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
