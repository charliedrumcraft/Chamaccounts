import React, { useCallback, useEffect, useState } from 'react';
import {
  readDismissedUpdateVersion,
  readUpdateCheckOnStartup,
  writeDismissedUpdateVersion,
} from '../../constants/appUpdateStorage';

type UpdatePayload = {
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  releaseUrl: string;
};

const UpdateAvailableBanner: React.FC = () => {
  const [payload, setPayload] = useState<UpdatePayload | null>(null);
  const [snoozed, setSnoozed] = useState(false);
  const [installing, setInstalling] = useState(false);

  const shouldShow = useCallback(
    (p: UpdatePayload) => {
      if (!readUpdateCheckOnStartup()) return false;
      if (snoozed) return false;
      if (readDismissedUpdateVersion() === p.latestVersion) return false;
      return true;
    },
    [snoozed]
  );

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onAppUpdateAvailable) return;
    return api.onAppUpdateAvailable((p) => {
      if (shouldShow(p)) setPayload(p);
    });
  }, [shouldShow]);

  const handleInstall = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.downloadAppUpdate) return;
    setInstalling(true);
    try {
      await api.downloadAppUpdate();
    } finally {
      setInstalling(false);
      setPayload(null);
    }
  }, []);

  const handleLater = useCallback(() => {
    setSnoozed(true);
    setPayload(null);
  }, []);

  const handleDismissVersion = useCallback(() => {
    if (payload) writeDismissedUpdateVersion(payload.latestVersion);
    setPayload(null);
  }, [payload]);

  if (!payload) return null;

  return (
    <div
      role="status"
      className="shrink-0 border-b border-indigo-200 bg-indigo-50 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-indigo-950">
        <span className="font-medium">Mise à jour disponible</span> — v{payload.latestVersion}{' '}
        <span className="text-indigo-800/80">(installée : v{payload.currentVersion})</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleInstall()}
          disabled={installing}
          className="rounded border border-indigo-700 bg-indigo-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {installing ? 'Téléchargement…' : 'Installer'}
        </button>
        <button
          type="button"
          onClick={handleLater}
          className="rounded border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-900 hover:bg-indigo-100/50"
        >
          Plus tard
        </button>
        <button
          type="button"
          onClick={handleDismissVersion}
          className="rounded border border-transparent px-3 py-1.5 text-xs font-medium text-indigo-800/90 hover:underline"
        >
          Ne plus proposer cette version
        </button>
      </div>
    </div>
  );
};

export default UpdateAvailableBanner;
