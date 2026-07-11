import { useCallback, useEffect, useState } from 'react';

export type SidebarAppInfo = {
  appVersion: string | null;
  activeProfileName: string | null;
};

export function useSidebarAppInfo(): SidebarAppInfo {
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [activeProfileName, setActiveProfileName] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    if (api?.getAppVersion) {
      const v = await api.getAppVersion();
      setAppVersion(v || null);
    }
    if (api?.getDataSetupStatus) {
      const s = await api.getDataSetupStatus();
      const active = s.profiles.find((p) => p.id === s.activeProfileId);
      setActiveProfileName(active?.name?.trim() || null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  return { appVersion, activeProfileName };
}
