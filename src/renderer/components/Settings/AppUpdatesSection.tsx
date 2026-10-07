import React, { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
        t('settings.updates.available', { latest: p.latestVersion, current: p.currentVersion })
      );
    });
  }, [t]);

  const handleCheck = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.checkForAppUpdate) {
      setMessage(t('settings.updates.apiUnavailable'));
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
        setMessage(result.error ?? t('settings.updates.devMode'));
        return;
      }
      if (result.status === 'error') {
        setMessage(result.error ?? t('settings.updates.checkFailed'));
        return;
      }
      if (result.status === 'update-available') {
        setUpdateAvailable(true);
        setLatestVersion(result.latestVersion ?? null);
        setMessage(
          t('settings.updates.available', {
            latest: result.latestVersion ?? '?',
            current: result.currentVersion,
          })
        );
        return;
      }
      setMessage(t('settings.updates.upToDate', { version: result.currentVersion }));
    } finally {
      setChecking(false);
    }
  }, [t]);

  const handleDownload = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.downloadAppUpdate) return;
    setDownloading(true);
    setDownloadPercent(0);
    setMessage(t('settings.updates.downloadInProgress'));
    try {
      const result = await api.downloadAppUpdate();
      if (!result.success) {
        setMessage(result.error ?? t('settings.updates.downloadFailed'));
        return;
      }
      setMessage(t('settings.updates.downloadDone'));
    } finally {
      setDownloading(false);
    }
  }, [t]);

  const handleOpenReleases = useCallback(() => {
    void window.electronAPI?.openGithubReleases?.();
  }, []);

  const tone = message ? getUiMessageTone(message) : null;

  return (
    <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5">
      <h2 className="text-lg font-semibold text-gray-800 mb-1">{t('settings.updates.title')}</h2>
      <p className="text-sm text-gray-600 mb-4 max-w-3xl">
        <Trans
          i18nKey="settings.updates.description"
          values={{ version: currentVersion }}
          components={{
            strong: <strong />,
            githubLink: (
              <a
                href={GITHUB_REPO_URL}
                className="text-indigo-700 hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  handleOpenReleases();
                }}
              />
            ),
          }}
        />
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
        {t('settings.updates.checkOnStartup')}
      </label>
      <div className="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={checking || downloading}
          className="rounded border border-indigo-700 bg-indigo-700 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {checking ? t('settings.updates.checking') : t('settings.updates.check')}
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
                ? t('settings.updates.downloadingPercent', { percent: downloadPercent })
                : t('settings.updates.downloading')
              : t('settings.updates.installVersion', { version: latestVersion ?? '' })}
          </button>
        )}
        <button
          type="button"
          onClick={handleOpenReleases}
          className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          {t('settings.updates.openReleases')}
        </button>
      </div>
      {message && tone && (
        <p className={`mt-3 text-sm rounded-lg border px-3 py-2 ${uiMessageClass(tone)}`}>{message}</p>
      )}
      <p className="mt-3 text-xs text-gray-500 max-w-3xl">
        {t('settings.updates.publishHint', { version: currentVersion })}{' '}
        <a href={GITHUB_RELEASES_PAGE_URL} className="text-indigo-700 hover:underline">
          {GITHUB_RELEASES_PAGE_URL}
        </a>
      </p>
    </div>
  );
};

export default AppUpdatesSection;
