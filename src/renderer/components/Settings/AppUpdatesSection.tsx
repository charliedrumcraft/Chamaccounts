import React, { useCallback, useEffect, useState } from 'react';
import { GITHUB_RELEASES_PAGE_URL, GITHUB_REPO_URL } from '@/shared/githubApp';
import {
  clearDismissedUpdateVersion,
  readUpdateCheckOnStartup,
  writeUpdateCheckOnStartup,
} from '../../constants/appUpdateStorage';
import { getUiMessageTone, uiMessageClass } from '../../utils/uiMessageTone';

type AppUpdateStatus = 'dev' | 'up-to-date' | 'update-available' | 'error';

type AppUpdateCheckResult = {
  success: boolean;
  currentVersion: string;
  status: AppUpdateStatus;
  latestVersion?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  error?: string;
};

const AppUpdatesSection: React.FC = () => {
  const [currentVersion, setCurrentVersion] = useState<string>('…');
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [checkOnStartup, setCheckOnStartup] = useState(readUpdateCheckOnStartup);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getAppVersion) return;
    void api.getAppVersion().then((v) => setCurrentVersion(v));
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onAppUpdateDownloadProgress) return;
    return api.onAppUpdateDownloadProgress((percent) => {
      setDownloadPercent(percent);
    });
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onAppUpdateAvailable) return;
    return api.onAppUpdateAvailable((p) => {
      if (!readUpdateCheckOnStartup()) return;
      setUpdateAvailable(true);
      setLatestVersion(p.latestVersion);
      setCurrentVersion(p.currentVersion);
      setMessage(
        `Une mise à jour est disponible : v${p.latestVersion} (vous : v${p.currentVersion}).`
      );
    });
  }, []);

  const handleCheck = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.checkForAppUpdate) {
      setMessage('API Electron indisponible.');
      return;
    }
    setChecking(true);
    setMessage(null);
    setUpdateAvailable(false);
    setLatestVersion(null);
    try {
      const result: AppUpdateCheckResult = await api.checkForAppUpdate();
      setCurrentVersion(result.currentVersion);
      if (result.status === 'dev') {
        setMessage(
          result.error ??
            'Mode développement : ouvrez les releases GitHub pour installer une version packagée.'
        );
        return;
      }
      if (result.status === 'error') {
        setMessage(
          result.error ??
            'Impossible de vérifier les mises à jour. Consultez les releases sur GitHub.'
        );
        return;
      }
      if (result.status === 'update-available') {
        setUpdateAvailable(true);
        setLatestVersion(result.latestVersion ?? null);
        setMessage(
          `Une mise à jour est disponible : v${result.latestVersion ?? '?'} (vous : v${result.currentVersion}).`
        );
        return;
      }
      setMessage(`Vous utilisez la dernière version publiée (v${result.currentVersion}).`);
    } finally {
      setChecking(false);
    }
  }, []);

  const handleDownload = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.downloadAppUpdate) return;
    setDownloading(true);
    setDownloadPercent(0);
    setMessage('Téléchargement en cours…');
    try {
      const result = await api.downloadAppUpdate();
      if (!result.success) {
        setMessage(result.error ?? 'Échec du téléchargement.');
        return;
      }
      setMessage('Téléchargement terminé. Confirmez le redémarrage dans la boîte de dialogue système.');
    } finally {
      setDownloading(false);
    }
  }, []);

  const handleOpenReleases = useCallback(() => {
    void window.electronAPI?.openGithubReleases?.();
  }, []);

  const tone = message ? getUiMessageTone(message) : null;

  return (
    <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5">
      <h2 className="text-lg font-semibold text-gray-800 mb-1">Application &amp; GitHub</h2>
      <p className="text-sm text-gray-600 mb-4 max-w-3xl">
        Version installée : <strong>v{currentVersion}</strong>. Les mises à jour sont publiées sur{' '}
        <a
          href={GITHUB_REPO_URL}
          className="text-indigo-700 hover:underline"
          onClick={(e) => {
            e.preventDefault();
            handleOpenReleases();
          }}
        >
          GitHub
        </a>{' '}
        (releases). En production, l’app vérifie et télécharge la nouvelle version. Sur Mac, sans certificat
        Apple, l’app se remplace elle-même au redémarrage.
      </p>
      <label className="flex items-center gap-2 text-sm text-gray-700 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={checkOnStartup}
          onChange={(e) => {
            const enabled = e.target.checked;
            setCheckOnStartup(enabled);
            writeUpdateCheckOnStartup(enabled);
            if (enabled) clearDismissedUpdateVersion();
          }}
          className="rounded border-gray-300 text-indigo-700 focus:ring-indigo-500"
        />
        Vérifier les mises à jour au démarrage (bandeau discret si une version est disponible)
      </label>
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={checking || downloading}
          className="rounded border border-indigo-700 bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {checking ? 'Vérification…' : 'Vérifier les mises à jour'}
        </button>
        {updateAvailable && (
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={checking || downloading}
            className="rounded border border-indigo-600 bg-white px-4 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-50 disabled:opacity-50"
          >
            {downloading
              ? downloadPercent != null
                ? `Téléchargement… ${downloadPercent} %`
                : 'Téléchargement…'
              : `Installer v${latestVersion ?? ''}`}
          </button>
        )}
        <button
          type="button"
          onClick={handleOpenReleases}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Ouvrir les releases
        </button>
      </div>
      {message && tone && (
        <p className={`mt-3 text-sm rounded-lg border px-3 py-2 ${uiMessageClass(tone)}`}>{message}</p>
      )}
      <p className="mt-3 text-xs text-gray-500 max-w-3xl">
        Publication : créez un tag <code className="bg-slate-100 px-1 rounded">v{currentVersion}</code> sur GitHub
        pour déclencher le build automatique (voir workflow CI). Première release :{' '}
        <a href={GITHUB_RELEASES_PAGE_URL} className="text-indigo-700 hover:underline">
          {GITHUB_RELEASES_PAGE_URL}
        </a>
      </p>
    </div>
  );
};

export default AppUpdatesSection;
