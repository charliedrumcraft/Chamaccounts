import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MappingWizardProfile } from '@/shared/mappingWizardProfiles';
import { WIZARD_STANDARD_KEYS, type WizardStandardKey } from '@/shared/transactionsImportCore';
import { peekCsvHeadersForMappingTraining } from '../../services/mappingWizardService';
import {
  listMappingWizardProfiles,
  removeMappingWizardProfile,
  upsertMappingWizardProfile,
} from '../../services/mappingWizardProfilesService';

const MappingProfilesSection: React.FC = () => {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<MappingWizardProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [draftName, setDraftName] = useState('');
  const [draftLabels, setDraftLabels] = useState<string[]>([]);
  const [draftMap, setDraftMap] = useState<Record<number, WizardStandardKey>>({});
  const [draftCurrency, setDraftCurrency] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const list = await listMappingWizardProfiles();
    setProfiles(list);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetDraft = useCallback(() => {
    setDraftName('');
    setDraftLabels([]);
    setDraftMap({});
    setDraftCurrency(undefined);
    setEditingId(null);
  }, []);

  const handlePickCsv = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.selectFile || !api?.readExternalFile) {
      setMessage(t('system.apiUnavailableShort'));
      return;
    }
    setMessage(null);
    const pick = await api.selectFile({
      filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
      allowMultiple: false,
    });
    if (pick.canceled) return;
    const path =
      (pick as { paths?: string[]; path?: string }).paths?.[0] ??
      (pick as { path?: string }).path;
    if (!path) return;
    const read = await api.readExternalFile(path);
    if (!read.success || read.data == null) {
      setMessage(read.error ?? t('common.error'));
      return;
    }
    const peeked = peekCsvHeadersForMappingTraining(read.data);
    if (!peeked) {
      setMessage(t('profileSettings.mappingProfiles.unreadableCsv'));
      return;
    }
    const baseName = path.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') || '';
    setDraftName((prev) => prev.trim() || baseName);
    setDraftLabels(peeked.labels);
    const map: Record<number, WizardStandardKey> = {};
    peeked.suggested.forEach((s, i) => {
      map[i] = s;
    });
    setDraftMap(map);
    setDraftCurrency(peeked.defaultCurrency);
    setEditingId(null);
  }, [t]);

  const handleEditProfile = useCallback((p: MappingWizardProfile) => {
    setEditingId(p.id);
    setDraftName(p.name);
    setDraftLabels([...p.headerSignature]);
    const map: Record<number, WizardStandardKey> = {};
    p.headerSignature.forEach((label, i) => {
      map[i] = p.columnMap[label] ?? '';
    });
    setDraftMap(map);
    setDraftCurrency(p.defaultCurrency);
    setMessage(null);
  }, []);

  const handleSaveDraft = useCallback(async () => {
    if (draftLabels.length === 0) {
      setMessage(t('profileSettings.mappingProfiles.needCsv'));
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const columnMap: Record<string, string> = {};
      draftLabels.forEach((label, i) => {
        columnMap[label] = draftMap[i] ?? '';
      });
      const r = await upsertMappingWizardProfile({
        id: editingId ?? undefined,
        name: draftName,
        headerLabels: draftLabels,
        columnMap,
        defaultCurrency: draftCurrency,
      });
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      setProfiles(r.profiles);
      resetDraft();
      setMessage(t('profileSettings.mappingProfiles.saved', { name: r.profile.name }));
    } finally {
      setLoading(false);
    }
  }, [draftLabels, draftMap, draftName, draftCurrency, editingId, resetDraft, t]);

  const handleRemove = useCallback(
    async (profileId: string) => {
      if (!window.confirm(t('profileSettings.mappingProfiles.removeConfirm'))) return;
      setLoading(true);
      setMessage(null);
      try {
        const r = await removeMappingWizardProfile(profileId);
        if (!r.ok) {
          setMessage(r.error);
          return;
        }
        setProfiles(r.profiles);
        if (editingId === profileId) resetDraft();
        setMessage(t('profileSettings.mappingProfiles.removed'));
      } finally {
        setLoading(false);
      }
    },
    [editingId, resetDraft, t]
  );

  return (
    <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5">
      <h2 className="text-lg font-semibold text-gray-800 mb-1">
        {t('profileSettings.mappingProfiles.title')}
      </h2>
      <p className="text-sm text-gray-600 mb-4 max-w-3xl">
        {t('profileSettings.mappingProfiles.description')}
      </p>

      {profiles.length === 0 ? (
        <p className="text-sm text-gray-500 mb-4">{t('profileSettings.mappingProfiles.empty')}</p>
      ) : (
        <ul className="space-y-2 mb-4">
          {profiles.map((p) => (
            <li
              key={p.id}
              className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 ${
                editingId === p.id ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'
              }`}
            >
              <div className="flex-1 min-w-[10rem]">
                <p className="text-sm font-medium text-gray-900">{p.name}</p>
                <p className="text-xs text-slate-500 truncate" title={p.headerSignature.join(' | ')}>
                  {p.headerSignature.join(' · ')}
                </p>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={() => handleEditProfile(p)}
                className="text-xs rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {t('common.edit')}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleRemove(p.id)}
                className="text-xs text-red-700 hover:underline disabled:opacity-50"
              >
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
        <p className="text-sm font-medium text-indigo-950">
          {editingId
            ? t('profileSettings.mappingProfiles.editTitle')
            : t('profileSettings.mappingProfiles.trainTitle')}
        </p>
        <div className="flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-slate-600 mb-1" htmlFor="mapping-profile-name">
              {t('profileSettings.mappingProfiles.nameLabel')}
            </label>
            <input
              id="mapping-profile-name"
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={t('profileSettings.mappingProfiles.namePlaceholder')}
              className="rounded border border-slate-300 px-2 py-1.5 text-sm w-48"
            />
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handlePickCsv()}
            className="rounded border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {t('profileSettings.mappingProfiles.pickCsv')}
          </button>
          {draftLabels.length > 0 && (
            <button
              type="button"
              disabled={loading}
              onClick={resetDraft}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>

        {draftLabels.length > 0 && (
          <>
            <ul className="space-y-1.5 max-h-56 overflow-y-auto">
              {draftLabels.map((label, index) => (
                <li key={`${index}-${label}`} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-8 shrink-0 font-mono text-xs text-slate-500">{index + 1}</span>
                  <span className="min-w-[8rem] flex-1 text-xs text-slate-800 break-words">{label}</span>
                  <select
                    className="min-w-[10rem] rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
                    value={draftMap[index] ?? ''}
                    onChange={(e) =>
                      setDraftMap((prev) => ({
                        ...prev,
                        [index]: e.target.value as WizardStandardKey,
                      }))
                    }
                  >
                    <option value="">{t('transactions.importPrep.ignoreOption')}</option>
                    {WIZARD_STANDARD_KEYS.filter((k) => k !== '').map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={loading || !draftName.trim()}
              onClick={() => void handleSaveDraft()}
              className="rounded border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {loading ? t('common.saving') : t('profileSettings.mappingProfiles.save')}
            </button>
          </>
        )}
      </div>

      {message && <p className="mt-3 text-sm text-gray-700">{message}</p>}
    </div>
  );
};

export default MappingProfilesSection;
