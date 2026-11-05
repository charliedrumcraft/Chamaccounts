import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  exportLocalStorageSnapshotToDataFile,
  importLocalStorageSnapshotFromDataFile,
} from '../services/localStorageSnapshotService';
import { describeProjectCsvDataForExport } from '../services/projectDataExportService';
import { LOCAL_STORAGE_SNAPSHOT_CSV_PATH } from '@/shared/dataPaths';
import AppUpdatesSection from '../components/Settings/AppUpdatesSection';
import LanguageSection from '../components/Settings/LanguageSection';
import ProfilesSection from '../components/Settings/ProfilesSection';

/** Messages ZIP / AppState à afficher en avertissement (ton ambre) : mots-clés FR + EN. */
function isSnapshotWarningMessage(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.startsWith('erreur') ||
    m.startsWith('error') ||
    m.includes('uniquement') ||
    m.includes('only available') ||
    m.includes('introuvable') ||
    m.includes('not found') ||
    m.includes('illisible') ||
    m.includes('unreadable') ||
    m.includes('annulé') ||
    m.includes('cancelled') ||
    m.includes('canceled') ||
    m.includes('indisponible') ||
    m.includes('unavailable') ||
    m.includes('échec import') ||
    m.includes('import failed')
  );
}

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

  const handleExportLocalStorageSnapshot = useCallback(async () => {
    setSnapshotMessage(null);
    setSnapshotLoading(true);
    try {
      const r = await exportLocalStorageSnapshotToDataFile();
      if (r.ok) {
        setSnapshotMessage(
          t('settings.snapshot.exportSuccess', {
            count: r.keyCount,
            path: LOCAL_STORAGE_SNAPSHOT_CSV_PATH,
          })
        );
      } else {
        setSnapshotMessage(r.error ?? t('common.error'));
      }
    } finally {
      setSnapshotLoading(false);
    }
  }, [t]);

  const handleImportLocalStorageSnapshot = useCallback(async (mode: 'merge' | 'replace') => {
    if (mode === 'replace') {
      const ok = window.confirm(t('settings.snapshot.confirmReplaceStorage'));
      if (!ok) return;
    }
    setSnapshotMessage(null);
    setSnapshotLoading(true);
    try {
      const r = await importLocalStorageSnapshotFromDataFile(mode);
      if (r.ok) {
        setSnapshotMessage(t('settings.snapshot.importSuccessReloading', { count: r.keyCount }));
        window.setTimeout(() => {
          window.location.reload();
        }, 400);
      } else {
        setSnapshotMessage(r.error ?? t('common.error'));
      }
    } finally {
      setSnapshotLoading(false);
    }
  }, [t]);

  /** Met à jour le CSV AppState puis archive tout le dossier data/ (ZIP). */
  const handleExportProjectZip = useCallback(async () => {
    setSnapshotMessage(null);
    setSnapshotLoading(true);
    try {
      const snap = await exportLocalStorageSnapshotToDataFile();
      if (!snap.ok) {
        setSnapshotMessage(snap.error ?? t('settings.snapshot.exportSnapshotFailed'));
        return;
      }
      const csvCheck = await describeProjectCsvDataForExport();
      const api = window.electronAPI;
      if (!api?.exportDataFolderZip) {
        setSnapshotMessage(t('settings.snapshot.zipExportUnavailable'));
        return;
      }
      const z = await api.exportDataFolderZip();
      if (z.canceled) {
        setSnapshotMessage(t('settings.snapshot.zipExportCanceled'));
        return;
      }
      if (!z.success) {
        setSnapshotMessage(z.error ?? t('settings.snapshot.zipExportError'));
        return;
      }
      const emptyHint =
        csvCheck.emptyLabels.length > 0
          ? t('settings.snapshot.zipEmptyCsvHint', { labels: csvCheck.emptyLabels.join(', ') })
          : '';
      setSnapshotMessage(
        t('settings.snapshot.zipCreated', {
          path: z.path ?? '',
          keyCount: snap.keyCount,
          transactions: csvCheck.transactionRows,
          balances: csvCheck.balanceRows,
          support: csvCheck.supportRows,
          hint: emptyHint,
        })
      );
    } finally {
      setSnapshotLoading(false);
    }
  }, [t]);

  const handleImportProjectZip = useCallback(async () => {
    const ok = window.confirm(t('settings.snapshot.confirmImportZip'));
    if (!ok) return;
    setSnapshotMessage(null);
    setSnapshotLoading(true);
    try {
      const api = window.electronAPI;
      if (!api?.importDataFolderZip) {
        setSnapshotMessage(t('settings.snapshot.zipImportUnavailable'));
        return;
      }
      const z = await api.importDataFolderZip();
      if (z.canceled) {
        setSnapshotMessage(t('settings.snapshot.zipImportCanceled'));
        return;
      }
      if (!z.success) {
        setSnapshotMessage(z.error ?? t('settings.snapshot.zipImportError'));
        return;
      }
      const n = z.extractedFileCount ?? 0;
      if (!z.appStateSnapshotFound) {
        setSnapshotMessage(t('settings.snapshot.zipImportedNoSnapshot', { count: n }));
        window.setTimeout(() => {
          window.location.reload();
        }, 700);
        return;
      }
      const ls = await importLocalStorageSnapshotFromDataFile('replace');
      if (!ls.ok) {
        setSnapshotMessage(
          t('settings.snapshot.zipImportedSettingsFailed', {
            count: n,
            error: ls.error ?? t('settings.snapshot.unknownErrorLower'),
          })
        );
        window.setTimeout(() => {
          window.location.reload();
        }, 900);
        return;
      }
      setSnapshotMessage(t('settings.snapshot.zipImportDone', { files: n, keys: ls.keyCount }));
      window.setTimeout(() => {
        window.location.reload();
      }, 500);
    } finally {
      setSnapshotLoading(false);
    }
  }, [t]);

  return (
    <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 w-full max-w-[1600px] mx-auto">
      <h1 className="text-2xl font-bold text-gray-800">{t('settings.title')}</h1>

      <div className="mt-6 flex flex-col gap-6 w-full">
        <LanguageSection />

        <AppUpdatesSection />

        <ProfilesSection />

        <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">{t('settings.projectZip.title')}</h2>
          <p className="text-sm text-gray-600 mb-4 max-w-3xl">{t('settings.projectZip.description')}</p>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={() => void handleExportProjectZip()}
              disabled={snapshotLoading}
              className="rounded border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {snapshotLoading ? t('common.processing') : t('settings.projectZip.export')}
            </button>
            <button
              type="button"
              onClick={() => void handleImportProjectZip()}
              disabled={snapshotLoading}
              className="rounded border border-emerald-600 bg-white px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
            >
              {t('settings.projectZip.import')}
            </button>
          </div>
        </div>

        <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">{t('settings.appState.title')}</h2>
          <p className="text-sm text-gray-600 mb-4 max-w-3xl">
            {t('settings.appState.description', { path: LOCAL_STORAGE_SNAPSHOT_CSV_PATH })}
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              type="button"
              onClick={() => void handleExportLocalStorageSnapshot()}
              disabled={snapshotLoading}
              className="rounded border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {snapshotLoading ? t('common.processing') : t('settings.appState.export')}
            </button>
            <button
              type="button"
              onClick={() => void handleImportLocalStorageSnapshot('merge')}
              disabled={snapshotLoading}
              className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              {t('settings.appState.importMerge')}
            </button>
            <button
              type="button"
              onClick={() => void handleImportLocalStorageSnapshot('replace')}
              disabled={snapshotLoading}
              className="rounded border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {t('settings.appState.importReplace')}
            </button>
          </div>
        </div>

        {snapshotMessage && (
          <p
            className={`text-sm ${
              isSnapshotWarningMessage(snapshotMessage) ? 'text-amber-700' : 'text-gray-700'
            }`}
          >
            {snapshotMessage}
          </p>
        )}
      </div>
    </main>
  );
};

export default Settings;
