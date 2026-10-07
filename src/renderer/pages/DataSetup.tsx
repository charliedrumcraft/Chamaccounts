import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DataSetupStatus, LegacyDataLocation } from '@/shared/profiles';

type DataSetupProps = {
  onComplete: () => void;
};

const DataSetup: React.FC<DataSetupProps> = ({ onComplete }) => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DataSetupStatus | null>(null);
  const [profileName, setProfileName] = useState('');
  const [selectedPath, setSelectedPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.getDataSetupStatus) return;
    const s = await api.getDataSetupStatus();
    setStatus(s);
    if (!s.needsSetup && s.activeDataRoot) {
      onComplete();
    }
  }, [onComplete]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const registerProfile = useCallback(
    async (dataRoot: string, name: string, initialize: boolean) => {
      const api = window.electronAPI;
      if (!api?.registerDataProfile) {
        setError(t('dataSetup.unavailable'));
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const r = await api.registerDataProfile({
          name: name.trim() || dataRoot.split(/[/\\]/).pop() || t('common.defaultProfileName'),
          dataRoot,
          initialize,
        });
        if (!r.success) {
          setError(r.error ?? t('dataSetup.registerFailed'));
          return;
        }
        onComplete();
      } finally {
        setLoading(false);
      }
    },
    [onComplete, t]
  );

  const handlePickExisting = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.selectFolder) return;
    const pick = await api.selectFolder();
    if (pick.canceled || !pick.path) return;
    setSelectedPath(pick.path);
    if (!profileName.trim()) {
      setProfileName(pick.path.split(/[/\\]/).pop() ?? '');
    }
  }, [profileName]);

  const handleCreateNew = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.selectFolder || !api?.initializeDataFolder) return;
    const pick = await api.selectFolder();
    if (pick.canceled || !pick.path) return;
    setLoading(true);
    setError(null);
    try {
      const init = await api.initializeDataFolder(pick.path);
      if (!init.success || !init.path) {
        setError(init.error ?? t('dataSetup.createTreeFailed'));
        return;
      }
      const name = profileName.trim() || pick.path.split(/[/\\]/).pop() || t('common.defaultProfileName');
      await registerProfile(init.path, name, false);
    } finally {
      setLoading(false);
    }
  }, [profileName, registerProfile, t]);

  const handleUseSelected = useCallback(async () => {
    if (!selectedPath.trim()) {
      setError(t('dataSetup.chooseFolder'));
      return;
    }
    await registerProfile(selectedPath, profileName, false);
  }, [selectedPath, profileName, registerProfile, t]);

  const handleLegacy = useCallback(
    (legacy: LegacyDataLocation) => {
      setSelectedPath(legacy.path);
      setProfileName(legacy.suggestedName);
    },
    []
  );

  const handleConfirmLegacy = useCallback(async () => {
    if (!selectedPath) return;
    await registerProfile(selectedPath, profileName, false);
  }, [selectedPath, profileName, registerProfile]);

  if (!status) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-600">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-xl bg-white rounded-xl shadow-lg border border-slate-200 p-8">
        <h1 className="text-2xl font-bold text-slate-900">{t('dataSetup.title')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('dataSetup.description')}</p>

        <label className="mt-6 block text-sm font-medium text-slate-700" htmlFor="profile-name">
          {t('dataSetup.profileName')}
        </label>
        <input
          id="profile-name"
          type="text"
          value={profileName}
          onChange={(e) => setProfileName(e.target.value)}
          placeholder={t('dataSetup.profilePlaceholder')}
          className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
        />

        {status.legacyLocations.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-slate-800">{t('dataSetup.legacyTitle')}</h2>
            <ul className="mt-2 space-y-2">
              {status.legacyLocations.map((legacy) => (
                <li key={legacy.path}>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => handleLegacy(legacy)}
                    className="w-full text-left rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm hover:bg-amber-100 disabled:opacity-50"
                  >
                    <span className="font-medium text-amber-900">{legacy.suggestedName}</span>
                    <span className="block text-xs text-amber-800 mt-0.5">{legacy.label}</span>
                    <span className="block text-xs text-slate-500 mt-1 truncate">{legacy.path}</span>
                  </button>
                </li>
              ))}
            </ul>
            {selectedPath &&
              status.legacyLocations.some((l) => l.path === selectedPath) && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void handleConfirmLegacy()}
                  className="mt-3 w-full rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  {t('dataSetup.useLocation')}
                </button>
              )}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => void handlePickExisting()}
            className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {t('dataSetup.pickExisting')}
          </button>
          {selectedPath &&
            !status.legacyLocations.some((l) => l.path === selectedPath) && (
              <p className="text-xs text-slate-500 truncate">{selectedPath}</p>
            )}
          {selectedPath && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void handleUseSelected()}
              className="rounded bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {t('dataSetup.confirmFolder')}
            </button>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleCreateNew()}
            className="rounded border border-emerald-600 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
          >
            {t('dataSetup.createNew')}
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
        {loading && <p className="mt-2 text-sm text-slate-500">{t('common.processing')}</p>}
      </div>
    </div>
  );
};

export default DataSetup;
