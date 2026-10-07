import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Profile } from '@/shared/profiles';
import { DATA_TEMPLATE_PROFILE_NAME } from '@/shared/dataTemplateProfile';
import {
  syncAppStateOnProfileLeave,
} from '../../services/profileAppStateSync';

const ProfilesSection: React.FC = () => {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDataRoot, setActiveDataRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  const refresh = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.getDataSetupStatus) return;
    const s = await api.getDataSetupStatus();
    setProfiles(s.profiles);
    setActiveId(s.activeProfileId);
    setActiveDataRoot(s.activeDataRoot);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleActivate = useCallback(
    async (profileId: string) => {
      if (profileId === activeId) return;
      const api = window.electronAPI;
      if (!api?.setActiveProfile) return;
      setLoading(true);
      setMessage(null);
      try {
        const left = await syncAppStateOnProfileLeave();
        if (!left.ok) {
          setMessage(left.error ?? t('settings.profiles.saveCurrentFailed'));
          return;
        }
        const r = await api.setActiveProfile(profileId);
        if (!r.ok) {
          setMessage(r.error ?? t('settings.profiles.activateFailed'));
          return;
        }
        if (api.reloadWindowForActiveProfile) {
          setMessage(t('settings.profiles.activatedReloading'));
          await api.reloadWindowForActiveProfile();
          return;
        }
        setMessage(t('settings.profiles.activated'));
      } finally {
        setLoading(false);
      }
    },
    [activeId, t]
  );

  const handleAddProfile = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.selectFolder || !api?.registerDataProfile) return;
    const pick = await api.selectFolder();
    if (pick.canceled || !pick.path) return;
    setLoading(true);
    setMessage(null);
    try {
      let dataRoot = pick.path;
      if (api.initializeDataFolder) {
        const init = await api.initializeDataFolder(pick.path);
        if (init.success && init.path) dataRoot = init.path;
      }
      const name = newName.trim() || pick.path.split(/[/\\]/).pop() || t('common.defaultProfileName');
      const r = await api.registerDataProfile({
        name,
        dataRoot,
        initialize: false,
        setActive: false,
      });
      if (!r.success) {
        setMessage(r.error ?? t('settings.profiles.addFailed'));
        return;
      }
      setNewName('');
      await refresh();
      setMessage(t('settings.profiles.added', { name }));
    } finally {
      setLoading(false);
    }
  }, [newName, refresh, t]);

  const handleRename = useCallback(
    async (profileId: string, name: string) => {
      const api = window.electronAPI;
      if (!api?.renameDataProfile) return;
      const r = await api.renameDataProfile({ profileId, name });
      if (!r.ok) setMessage(r.error ?? t('settings.profiles.renameFailed'));
      else void refresh();
    },
    [refresh, t]
  );

  const handleRemove = useCallback(
    async (profileId: string) => {
      if (!window.confirm(t('settings.profiles.removeConfirm'))) {
        return;
      }
      const api = window.electronAPI;
      if (!api?.removeDataProfile) return;
      const wasActive = profileId === activeId;
      const r = await api.removeDataProfile(profileId);
      if (!r.ok) setMessage(r.error ?? t('settings.profiles.removeFailed'));
      else {
        await refresh();
        if (wasActive && api.reloadWindowForActiveProfile) {
          setMessage(t('settings.profiles.removedReloading'));
          await api.reloadWindowForActiveProfile();
          return;
        }
        setMessage(t('settings.profiles.removed'));
      }
    },
    [activeId, refresh, t]
  );

  return (
    <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5" data-tour="settings-profiles">
      <h2 className="text-lg font-semibold text-gray-800 mb-1">{t('settings.profiles.title')}</h2>
      <p className="text-sm text-gray-600 mb-4 max-w-3xl">
        {t('settings.profiles.description')}
      </p>
      {activeDataRoot && (
        <p className="text-xs text-slate-500 mb-3 truncate" title={activeDataRoot}>
          {t('settings.profiles.activeFolder', { path: activeDataRoot })}
        </p>
      )}
      <ul className="space-y-3 mb-4">
        {profiles.map((p) => (
          <li
            key={p.id}
            className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
              p.id === activeId ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200'
            }`}
          >
            <input
              type="text"
              defaultValue={p.name}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== p.name) void handleRename(p.id, v);
              }}
              className="flex-1 min-w-[120px] rounded border border-slate-200 px-2 py-1 text-sm font-medium"
            />
            <span className="text-xs text-slate-500 truncate max-w-full" title={p.dataRoot}>
              {p.dataRoot}
            </span>
            {p.id === activeId ? (
              <span className="text-xs font-medium text-emerald-800">{t('common.active')}</span>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleActivate(p.id)}
                className="text-xs rounded border border-emerald-600 px-2 py-1 text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
              >
                {t('common.activate')}
              </button>
            )}
            {profiles.length > 1 && p.name !== DATA_TEMPLATE_PROFILE_NAME && (
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleRemove(p.id)}
                className="text-xs text-red-700 hover:underline disabled:opacity-50"
              >
                {t('common.remove')}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs text-slate-600 mb-1" htmlFor="new-profile-name">
            {t('settings.profiles.newNameLabel')}
          </label>
          <input
            id="new-profile-name"
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('settings.profiles.newNamePlaceholder')}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm w-48"
          />
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => void handleAddProfile()}
          className="rounded border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {t('settings.profiles.add')}
        </button>
      </div>
      {message && <p className="mt-3 text-sm text-gray-700">{message}</p>}
    </div>
  );
};

export default ProfilesSection;
