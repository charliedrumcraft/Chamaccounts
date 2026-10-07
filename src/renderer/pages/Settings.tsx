import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  RECOGNISED_ACCOUNTS_STORAGE_KEY,
  loadRecognisedAccountsFromStorage,
  saveRecognisedAccountsToStorage,
  isAccountAliasLabelAvailable,
  isRecognisedPrimaryNameTaken,
  migrateRecognisedAccountEntriesIfNeeded,
  type RecognisedAccountEntry,
} from '../constants/recognisedAccountsStorage';
import {
  loadProjectsFromStorage,
  saveProjectsToStorage,
  nextDefaultProjectColor,
  projetBackgroundStyle,
  type ProjectEntry,
} from '../constants/projectsStorage';
import {
  AccountBalanceCSVService,
  defaultFiatForSettingsAccountName,
  getBalanceCodeForSettingsAccountName,
  type AccountFiatCurrency,
} from '../services/AccountBalanceCSVService';
import {
  exportLocalStorageSnapshotToDataFile,
  importLocalStorageSnapshotFromDataFile,
  restoreRecognisedListsFromAppStateIfEmpty,
} from '../services/localStorageSnapshotService';
import { PERSIST_PENDING_APP_STATE_EVENT } from '../services/profileAppStateSync';
import { describeProjectCsvDataForExport } from '../services/projectDataExportService';
import { LOCAL_STORAGE_SNAPSHOT_CSV_PATH } from '@/shared/dataPaths';
import AppUpdatesSection from '../components/Settings/AppUpdatesSection';
import LanguageSection from '../components/Settings/LanguageSection';
import ProfilesSection from '../components/Settings/ProfilesSection';
import WorkingCurrenciesSettingsSection from '../components/Settings/WorkingCurrenciesSettingsSection';
import { getCachedWorkingCurrencies } from '../services/EffectiveExchangeRates';
import { currencyDisplaySymbol, workingCurrencyCodes } from '@/shared/workingCurrencies';

const STORAGE_KEYS = {
  recognisedAccounts: RECOGNISED_ACCOUNTS_STORAGE_KEY,
  recognisedEntryTypes: 'settings-recognised-entry-types',
  recognisedOutputTypes: 'settings-recognised-output-types',
} as const;

function loadStringArray(key: string, fallback: string[] = []): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : fallback;
  } catch {
    return fallback;
  }
}

function saveStringArray(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

type RecognisedEditBaseline = {
  draftAccounts: RecognisedAccountEntry[];
  draftEntryTypes: string[];
  draftOutputTypes: string[];
  newAliasDraft: Record<number, string>;
  newAccountValue: string;
  newEntryTypeValue: string;
  newOutputTypeValue: string;
};

function cloneRecognisedAccountEntries(entries: RecognisedAccountEntry[]): RecognisedAccountEntry[] {
  return entries.map((e) => ({
    name: e.name,
    currency: e.currency,
    aliases: e.aliases ? [...e.aliases] : undefined,
  }));
}

function takeRecognisedEditBaseline(
  draftAccounts: RecognisedAccountEntry[],
  draftEntryTypes: string[],
  draftOutputTypes: string[],
  newAliasDraft: Record<number, string>,
  newAccountValue: string,
  newEntryTypeValue: string,
  newOutputTypeValue: string
): RecognisedEditBaseline {
  return {
    draftAccounts: cloneRecognisedAccountEntries(draftAccounts),
    draftEntryTypes: [...draftEntryTypes],
    draftOutputTypes: [...draftOutputTypes],
    newAliasDraft: { ...newAliasDraft },
    newAccountValue,
    newEntryTypeValue,
    newOutputTypeValue,
  };
}

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

function isRecognisedEditBaselineEqual(a: RecognisedEditBaseline, b: RecognisedEditBaseline): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const Settings: React.FC = () => {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectEntry[]>(() => loadProjectsFromStorage());
  const persistProjects = useCallback((next: ProjectEntry[]) => {
    setProjects(next);
    saveProjectsToStorage(next);
    try {
      window.dispatchEvent(new Event('chamaccounts-projects-changed'));
    } catch {
      /* ignore */
    }
  }, []);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

  const [recognisedAccounts, setRecognisedAccounts] = useState<RecognisedAccountEntry[]>(() =>
    loadRecognisedAccountsFromStorage()
  );
  const [recognisedEntryTypes, setRecognisedEntryTypes] = useState<string[]>(() =>
    loadStringArray(STORAGE_KEYS.recognisedEntryTypes, [])
  );
  const [recognisedOutputTypes, setRecognisedOutputTypes] = useState<string[]>(() =>
    loadStringArray(STORAGE_KEYS.recognisedOutputTypes, [])
  );

  const [newAccountValue, setNewAccountValue] = useState('');
  const [newEntryTypeValue, setNewEntryTypeValue] = useState('');
  const [newOutputTypeValue, setNewOutputTypeValue] = useState('');

  const [recognisedDataEditMode, setRecognisedDataEditMode] = useState(false);
  const recognisedEditBaselineRef = useRef<RecognisedEditBaseline | null>(null);
  const [recognisedExitConfirmOpen, setRecognisedExitConfirmOpen] = useState(false);
  const [draftAccounts, setDraftAccounts] = useState<RecognisedAccountEntry[]>([]);
  const [draftEntryTypes, setDraftEntryTypes] = useState<string[]>([]);
  const [draftOutputTypes, setDraftOutputTypes] = useState<string[]>([]);
  const [recognisedDataSaveMessage, setRecognisedDataSaveMessage] = useState<string | null>(null);
  const [recognisedDataSaveLoading, setRecognisedDataSaveLoading] = useState(false);

  type BalanceCsvAlignStatus =
    | { kind: 'loading' }
    | { kind: 'missing' }
    | { kind: 'aligned' }
    | { kind: 'mismatch'; expected: string[]; actual: string[] };

  const [balanceCsvAlign, setBalanceCsvAlign] = useState<BalanceCsvAlignStatus>({ kind: 'loading' });
  const [balanceCsvAlignTick, setBalanceCsvAlignTick] = useState(0);

  const [newAliasDraft, setNewAliasDraft] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    void restoreRecognisedListsFromAppStateIfEmpty().then((r) => {
      if (cancelled || !r.ok || !(r.restoredKeys?.length)) return;
      setRecognisedAccounts(loadRecognisedAccountsFromStorage());
      setRecognisedEntryTypes(loadStringArray(STORAGE_KEYS.recognisedEntryTypes, []));
      setRecognisedOutputTypes(loadStringArray(STORAGE_KEYS.recognisedOutputTypes, []));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBalanceCsvAlign({ kind: 'loading' });
    void AccountBalanceCSVService.loadMirrorHeaders()
      .then((headers) => {
        if (cancelled) return;
        if (!headers?.length) {
          setBalanceCsvAlign({ kind: 'missing' });
          return;
        }
        const expectedCodes = recognisedAccounts
          .map((e) => getBalanceCodeForSettingsAccountName(e.name))
          .filter((c): c is string => Boolean(c));
        const actualHeaders = headers
          .map((h) => h?.replace(/^\uFEFF/, '').trim() ?? '')
          .filter((h) => h && !/^date$/i.test(h));
        const actualCodes = actualHeaders
          .map((h) => AccountBalanceCSVService.resolveAccountHeaderToCode(h))
          .filter((c): c is string => Boolean(c));
        const aligned =
          expectedCodes.length === actualCodes.length &&
          expectedCodes.every((code, index) => code === actualCodes[index]);
        if (aligned) setBalanceCsvAlign({ kind: 'aligned' });
        else
          setBalanceCsvAlign({
            kind: 'mismatch',
            expected: expectedCodes,
            actual: actualCodes,
          });
      })
      .catch(() => {
        if (!cancelled) setBalanceCsvAlign({ kind: 'missing' });
      });
    return () => {
      cancelled = true;
    };
  }, [recognisedAccounts, balanceCsvAlignTick]);

  const handleAddProject = useCallback(() => {
    persistProjects([
      ...projects,
      {
        id: crypto.randomUUID(),
        name: t('settings.projects.defaultName'),
        color: nextDefaultProjectColor(projects),
      },
    ]);
  }, [projects, persistProjects, t]);

  const handleUpdateProject = useCallback(
    (index: number, patch: Partial<Pick<ProjectEntry, 'name' | 'color'>>) => {
      persistProjects(projects.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    },
    [projects, persistProjects]
  );

  const handleRemoveProject = useCallback(
    (index: number) => {
      persistProjects(projects.filter((_, i) => i !== index));
    },
    [projects, persistProjects]
  );

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
      setSnapshotMessage(
        t('settings.snapshot.zipImportDone', { files: n, keys: ls.keyCount })
      );
      window.setTimeout(() => {
        window.location.reload();
      }, 500);
    } finally {
      setSnapshotLoading(false);
    }
  }, [t]);

  const performExitRecognisedEditMode = useCallback(() => {
    if (recognisedEditBaselineRef.current) {
      const b = recognisedEditBaselineRef.current;
      setDraftAccounts(cloneRecognisedAccountEntries(b.draftAccounts));
      setDraftEntryTypes([...b.draftEntryTypes]);
      setDraftOutputTypes([...b.draftOutputTypes]);
      setNewAliasDraft({ ...b.newAliasDraft });
      setNewAccountValue(b.newAccountValue);
      setNewEntryTypeValue(b.newEntryTypeValue);
      setNewOutputTypeValue(b.newOutputTypeValue);
      recognisedEditBaselineRef.current = null;
    } else {
      setNewAccountValue('');
      setNewEntryTypeValue('');
      setNewOutputTypeValue('');
      setNewAliasDraft({});
    }
    setRecognisedDataEditMode(false);
    setRecognisedExitConfirmOpen(false);
  }, []);

  const handleToggleRecognisedDataEditMode = () => {
    setRecognisedDataSaveMessage(null);
    if (!recognisedDataEditMode) {
      recognisedEditBaselineRef.current = takeRecognisedEditBaseline(
        recognisedAccounts,
        recognisedEntryTypes,
        recognisedOutputTypes,
        {},
        '',
        '',
        ''
      );
      setDraftAccounts(cloneRecognisedAccountEntries(recognisedAccounts));
      setDraftEntryTypes([...recognisedEntryTypes]);
      setDraftOutputTypes([...recognisedOutputTypes]);
      setNewAccountValue('');
      setNewEntryTypeValue('');
      setNewOutputTypeValue('');
      setNewAliasDraft({});
      setRecognisedDataEditMode(true);
    } else {
      const baseline = recognisedEditBaselineRef.current;
      const current = takeRecognisedEditBaseline(
        draftAccounts,
        draftEntryTypes,
        draftOutputTypes,
        newAliasDraft,
        newAccountValue,
        newEntryTypeValue,
        newOutputTypeValue
      );
      if (baseline && !isRecognisedEditBaselineEqual(current, baseline)) {
        setRecognisedExitConfirmOpen(true);
        return;
      }
      performExitRecognisedEditMode();
    }
  };

  const persistRecognisedLists = useCallback(
    (accounts: RecognisedAccountEntry[], entryTypes: string[], outputTypes: string[]) => {
      const acc = migrateRecognisedAccountEntriesIfNeeded(
        accounts
          .filter((e) => e.name.trim())
          .map((e) => ({
            name: e.name.trim(),
            currency: e.currency,
            aliases: e.aliases,
          }))
      );
      const entry = Array.from(new Set(entryTypes.map((s) => s.trim()).filter(Boolean)));
      const output = Array.from(new Set(outputTypes.map((s) => s.trim()).filter(Boolean)));
      saveRecognisedAccountsToStorage(acc);
      saveStringArray(STORAGE_KEYS.recognisedEntryTypes, entry);
      saveStringArray(STORAGE_KEYS.recognisedOutputTypes, output);
      return { acc, entry, output };
    },
    []
  );

  const recognisedFlushRef = useRef({
    editMode: false,
    draftAccounts,
    draftEntryTypes,
    draftOutputTypes,
    newAliasDraft,
    newAccountValue,
    newEntryTypeValue,
    newOutputTypeValue,
  });
  recognisedFlushRef.current = {
    editMode: recognisedDataEditMode,
    draftAccounts,
    draftEntryTypes,
    draftOutputTypes,
    newAliasDraft,
    newAccountValue,
    newEntryTypeValue,
    newOutputTypeValue,
  };

  useEffect(() => {
    const persistPending = () => {
      const s = recognisedFlushRef.current;
      if (!s.editMode) return;
      const baseline = recognisedEditBaselineRef.current;
      // Sans baseline (édition non initialisée) : ne pas écraser le stockage.
      if (!baseline) return;
      const current = takeRecognisedEditBaseline(
        s.draftAccounts,
        s.draftEntryTypes,
        s.draftOutputTypes,
        s.newAliasDraft,
        s.newAccountValue,
        s.newEntryTypeValue,
        s.newOutputTypeValue
      );
      // Quit / export : ne persister que s’il y a de vraies modifications.
      if (isRecognisedEditBaselineEqual(current, baseline)) return;
      persistRecognisedLists(s.draftAccounts, s.draftEntryTypes, s.draftOutputTypes);
    };
    window.addEventListener(PERSIST_PENDING_APP_STATE_EVENT, persistPending);
    return () => {
      window.removeEventListener(PERSIST_PENDING_APP_STATE_EVENT, persistPending);
      persistPending();
    };
  }, [persistRecognisedLists]);

  const handleSaveRecognisedData = async () => {
    setRecognisedExitConfirmOpen(false);
    const { acc, entry, output } = persistRecognisedLists(
      draftAccounts,
      draftEntryTypes,
      draftOutputTypes
    );
    setRecognisedDataSaveLoading(true);
    setRecognisedDataSaveMessage(null);
    let csvResult: { success: boolean; error?: string } = { success: false };
    try {
      csvResult = await AccountBalanceCSVService.rewriteCsvWithColumnOrder(acc);
    } finally {
      setRecognisedDataSaveLoading(false);
    }
    setRecognisedAccounts(acc);
    setRecognisedEntryTypes(entry);
    setRecognisedOutputTypes(output);
    setDraftAccounts([...acc]);
    setDraftEntryTypes([...entry]);
    setDraftOutputTypes([...output]);
    setNewAccountValue('');
    setNewEntryTypeValue('');
    setNewOutputTypeValue('');
    setNewAliasDraft({});
    recognisedEditBaselineRef.current = takeRecognisedEditBaseline(acc, entry, output, {}, '', '', '');
    if (csvResult.success) {
      setRecognisedDataSaveMessage(t('settings.recognised.savedAligned'));
    } else {
      setRecognisedDataSaveMessage(
        t('settings.recognised.savedWithMessage', {
          message: csvResult.error ?? t('settings.recognised.csvUpdateFailed'),
        })
      );
    }
    setBalanceCsvAlignTick((n) => n + 1);
  };

  const handleDraftAccountCurrencyChange = (index: number, currency: AccountFiatCurrency) => {
    setDraftAccounts((prev) => {
      const next = [...prev];
      const cur = next[index];
      if (cur) next[index] = { ...cur, currency };
      return next;
    });
  };

  const handleMoveDraftAccount = (index: number, delta: -1 | 1) => {
    setNewAliasDraft({});
    setDraftAccounts((prev) => {
      const j = index + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const handleAddDraftAccountAlias = (accountIndex: number) => {
    const raw = (newAliasDraft[accountIndex] ?? '').trim();
    if (!raw || !isAccountAliasLabelAvailable(draftAccounts, accountIndex, raw)) return;
    setDraftAccounts((prev) => {
      const next = [...prev];
      const cur = next[accountIndex];
      if (!cur) return prev;
      const aliases = [...(cur.aliases ?? []), raw];
      next[accountIndex] = { ...cur, aliases };
      return next;
    });
    setNewAliasDraft((prev) => ({ ...prev, [accountIndex]: '' }));
  };

  const handleRemoveDraftAccountAlias = (accountIndex: number, aliasIndex: number) => {
    setDraftAccounts((prev) => {
      const next = [...prev];
      const cur = next[accountIndex];
      if (!cur) return prev;
      const aliases = (cur.aliases ?? []).filter((_, j) => j !== aliasIndex);
      next[accountIndex] =
        aliases.length > 0
          ? { ...cur, aliases }
          : { name: cur.name, currency: cur.currency };
      return next;
    });
  };

  const handleEditDraftAccountAlias = (
    accountIndex: number,
    aliasIndex: number,
    value: string
  ) => {
    const trimmed = value.trimStart();
    setDraftAccounts((prev) => {
      const cur = prev[accountIndex];
      if (!cur) return prev;
      const list = [...(cur.aliases ?? [])];
      list[aliasIndex] = trimmed;
      const candidate = trimmed.trim();
      if (
        candidate &&
        !isAccountAliasLabelAvailable(prev, accountIndex, candidate, {
          replaceAliasIndex: aliasIndex,
        })
      ) {
        return prev;
      }
      const next = [...prev];
      next[accountIndex] = { ...cur, aliases: list };
      return next;
    });
  };

  const handleAddToList = (
    list: 'accounts' | 'entryTypes' | 'outputTypes'
  ) => {
    const value =
      list === 'accounts'
        ? newAccountValue.trim()
        : list === 'entryTypes'
        ? newEntryTypeValue.trim()
        : newOutputTypeValue.trim();
    if (!value) return;

    if (list === 'accounts') {
      if (isRecognisedPrimaryNameTaken(draftAccounts, value)) {
        return;
      }
      setDraftAccounts((prev) => [
        ...prev,
        { name: value, currency: defaultFiatForSettingsAccountName(value) },
      ]);
      setNewAccountValue('');
    } else if (list === 'entryTypes') {
      const next = Array.from(new Set([...draftEntryTypes, value]));
      setDraftEntryTypes(next);
      setNewEntryTypeValue('');
    } else {
      const next = Array.from(new Set([...draftOutputTypes, value]));
      setDraftOutputTypes(next);
      setNewOutputTypeValue('');
    }
  };

  const handleRemoveFromList = (
    list: 'accounts' | 'entryTypes' | 'outputTypes',
    index: number
  ) => {
    if (list === 'accounts') {
      setDraftAccounts((prev) => prev.filter((_, i) => i !== index));
      setNewAliasDraft({});
    } else if (list === 'entryTypes') {
      setDraftEntryTypes((prev) => prev.filter((_, i) => i !== index));
    } else {
      setDraftOutputTypes((prev) => prev.filter((_, i) => i !== index));
    }
  };

  const handleEditListItem = (
    list: 'accounts' | 'entryTypes' | 'outputTypes',
    index: number,
    value: string
  ) => {
    const trimmed = value.trimStart();
    if (list === 'accounts') {
      setDraftAccounts((prev) => {
        const next = [...prev];
        const cur = next[index];
        if (cur) next[index] = { ...cur, name: trimmed };
        return next;
      });
    } else if (list === 'entryTypes') {
      setDraftEntryTypes((prev) => {
        const next = [...prev];
        next[index] = trimmed;
        return next;
      });
    } else {
      setDraftOutputTypes((prev) => {
        const next = [...prev];
        next[index] = trimmed;
        return next;
      });
    }
  };

  return (
    <>
      <main className="flex-1 flex flex-col min-w-0 p-4 md:p-6 w-full max-w-[1600px] mx-auto">
        <h1 className="text-2xl font-bold text-gray-800">{t('settings.title')}</h1>

        <div className="mt-6 flex flex-col gap-8 w-full">
          <div className="w-full flex flex-col gap-6">
            <LanguageSection />

            <AppUpdatesSection />

            <ProfilesSection />

            <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5">
              <h2 className="text-lg font-semibold text-gray-800 mb-1">{t('settings.projectZip.title')}</h2>
              <p className="text-sm text-gray-600 mb-4 max-w-3xl">
                {t('settings.projectZip.description')}
              </p>
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

          <WorkingCurrenciesSettingsSection />

          <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5" data-tour="settings-projects">
            <h2 className="text-lg font-semibold text-gray-800 mb-1">{t('settings.projects.title')}</h2>
            <p className="text-sm text-gray-600 mb-4 max-w-3xl">
              {t('settings.projects.description')}
            </p>
            {projects.length === 0 ? (
              <p className="text-sm text-gray-500 mb-3">{t('settings.projects.empty')}</p>
            ) : (
              <ul className="space-y-3 mb-4">
                {projects.map((p, i) => (
                  <li
                    key={p.id}
                    className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 rounded-lg border border-gray-200 bg-slate-50/50 p-3"
                    style={projetBackgroundStyle(p.color, 0.12)}
                  >
                    <label className="flex flex-1 min-w-[10rem] flex-col gap-0.5 text-sm">
                      <span className="text-gray-600">{t('settings.projects.name')}</span>
                      <input
                        type="text"
                        value={p.name}
                        onChange={(e) => handleUpdateProject(i, { name: e.target.value })}
                        className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
                        autoComplete="off"
                      />
                    </label>
                    <div className="flex items-end gap-2">
                      <label className="flex flex-col gap-0.5 text-sm">
                        <span className="text-gray-600">{t('settings.projects.color')}</span>
                        <input
                          type="color"
                          value={p.color}
                          onChange={(e) => handleUpdateProject(i, { color: e.target.value })}
                          className="h-9 w-14 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
                          title={t('settings.projects.colorTitle')}
                        />
                      </label>
                      <span className="pb-2 text-xs font-mono text-gray-600">{p.color}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveProject(i)}
                        className="rounded border border-red-300 bg-white px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        {t('settings.projects.delete')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={handleAddProject}
              className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t('settings.projects.add')}
            </button>
          </div>

          <div
            className="bg-white rounded-xl shadow-md border border-gray-200/80 overflow-hidden w-full min-w-0"
            data-tour="settings-recognised-data"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-5 py-4 border-b border-gray-200 bg-gradient-to-r from-slate-50 to-gray-50/80">
              <div>
                <h2 className="text-xl font-bold text-gray-900 tracking-tight">{t('settings.recognised.title')}</h2>
                <p className="text-sm text-gray-600 mt-1">
                  {t('settings.recognised.description')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleToggleRecognisedDataEditMode}
                    className={`rounded-lg px-3 py-2 text-sm font-medium text-white shadow-sm ${
                      recognisedDataEditMode
                        ? 'bg-gray-500 hover:bg-gray-600'
                        : 'bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    {recognisedDataEditMode ? t('transactions.edit.exit') : t('transactions.edit.enter')}
                  </button>
                  {recognisedDataEditMode && (
                    <button
                      type="button"
                      onClick={() => void handleSaveRecognisedData()}
                      disabled={recognisedDataSaveLoading}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {recognisedDataSaveLoading ? t('common.saving') : t('settings.recognised.saveLists')}
                    </button>
                  )}
                </div>
            </div>

            {(recognisedDataEditMode || recognisedDataSaveMessage) && (
              <div className="px-5 py-4 space-y-3 border-b border-amber-100 bg-amber-50/60">
                {recognisedDataEditMode && (
                  <p className="text-amber-900 text-sm font-medium">
                    <span className="font-bold">{t('transactions.edit.enter')}</span>
                    {t('settings.recognised.editBannerText', { save: t('settings.recognised.saveLists') })}
                  </p>
                )}
                {recognisedDataSaveMessage && (
                  <p
                    className={`text-sm ${
                      recognisedDataEditMode ? 'text-emerald-800 font-medium' : 'text-gray-600'
                    }`}
                  >
                    {recognisedDataSaveMessage}
                  </p>
                )}
              </div>
            )}

              <div className="p-5 grid grid-cols-1 xl:grid-cols-3 gap-6">
                <section
                  className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 shadow-sm ring-1 ring-slate-100"
                  data-tour="settings-accounts"
                >
                  <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2 border-b border-slate-200 pb-3">
                    <span className="flex h-8 w-1 shrink-0 rounded-full bg-slate-600" aria-hidden />
                    {t('settings.recognised.accounts.title')}
                  </h3>
                  {!recognisedDataEditMode && (
                    <div className="text-xs text-slate-600 mb-3 space-y-2">
                      <p>
                        <Trans
                          i18nKey="settings.recognised.accounts.hint"
                          components={{ code: <code className="text-gray-800" /> }}
                        />
                      </p>
                      {balanceCsvAlign.kind === 'loading' && (
                        <p className="text-slate-500">{t('settings.recognised.align.loading')}</p>
                      )}
                      {balanceCsvAlign.kind === 'missing' && (
                        <p className="text-amber-900 font-medium">
                          {t('settings.recognised.align.missing', {
                            save: t('settings.recognised.saveLists'),
                          })}
                        </p>
                      )}
                      {balanceCsvAlign.kind === 'aligned' && (
                        <p className="text-emerald-800 font-medium">
                          {t('settings.recognised.align.aligned')}
                        </p>
                      )}
                      {balanceCsvAlign.kind === 'mismatch' && (
                        <p className="text-amber-900 font-medium">
                          {t('settings.recognised.align.mismatch')}
                        </p>
                      )}
                    </div>
                  )}
                  {recognisedDataEditMode ? (
                    <>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          placeholder={t('settings.recognised.accounts.addPlaceholder')}
                          value={newAccountValue}
                          onChange={(e) => setNewAccountValue(e.target.value)}
                          className="flex-1 border border-slate-300 bg-white rounded-lg px-3 py-1.5 text-sm text-gray-800 shadow-sm"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddToList('accounts')}
                          className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
                          disabled={!newAccountValue.trim()}
                        >
                          {t('settings.recognised.add')}
                        </button>
                      </div>
                      {draftAccounts.length === 0 ? (
                        <p className="text-xs text-gray-500">{t('settings.recognised.accounts.empty')}</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {draftAccounts.map((entry, index) => (
                            <li
                              key={index}
                              className="rounded-lg border border-slate-200/90 bg-white shadow-sm overflow-hidden"
                            >
                              <div className="flex flex-wrap items-center gap-1 p-1.5">
                                <div className="flex flex-col shrink-0">
                                  <button
                                    type="button"
                                    title={t('settings.recognised.moveUp')}
                                    aria-label={t('settings.recognised.moveUp')}
                                    disabled={index === 0}
                                    onClick={() => handleMoveDraftAccount(index, -1)}
                                    className="px-1.5 py-0 text-xs leading-tight rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    title={t('settings.recognised.moveDown')}
                                    aria-label={t('settings.recognised.moveDown')}
                                    disabled={index === draftAccounts.length - 1}
                                    onClick={() => handleMoveDraftAccount(index, 1)}
                                    className="px-1.5 py-0 text-xs leading-tight rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                                  >
                                    ↓
                                  </button>
                                </div>
                                <input
                                  type="text"
                                  value={entry.name}
                                  onChange={(e) =>
                                    handleEditListItem('accounts', index, e.target.value)
                                  }
                                  className="flex-1 min-w-[120px] border border-gray-200 rounded px-2 py-1 text-xs text-gray-800"
                                />
                                <label className="sr-only" htmlFor={`account-currency-${index}`}>
                                  {t('settings.recognised.currency')}
                                </label>
                                <select
                                  id={`account-currency-${index}`}
                                  value={entry.currency}
                                  onChange={(e) =>
                                    handleDraftAccountCurrencyChange(
                                      index,
                                      e.target.value as AccountFiatCurrency
                                    )
                                  }
                                  className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-gray-800 font-medium"
                                >
                                  {workingCurrencyCodes(getCachedWorkingCurrencies()).map((code) => (
                                    <option key={code} value={code}>
                                      {code} ({currencyDisplaySymbol(code)})
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFromList('accounts', index)}
                                  className="px-2 py-1 rounded border border-red-500 text-red-600 text-xs hover:bg-red-50 shrink-0"
                                >
                                  {t('settings.recognised.delete')}
                                </button>
                              </div>
                              <div className="ml-4 sm:ml-8 pl-3 sm:pl-4 border-l-2 border-indigo-200 bg-slate-50/80 py-1.5 pr-2 space-y-1">
                                  {(entry.aliases ?? []).length > 0 && (
                                    <ul className="space-y-0.5 pl-0.5">
                                      {(entry.aliases ?? []).map((alias, ai) => (
                                        <li key={ai} className="flex gap-1 items-center">
                                          <input
                                            type="text"
                                            value={alias}
                                            onChange={(e) =>
                                              handleEditDraftAccountAlias(
                                                index,
                                                ai,
                                                e.target.value
                                              )
                                            }
                                            className="flex-1 min-w-0 border border-slate-200 rounded px-2 py-0.5 text-xs text-gray-800 bg-white"
                                          />
                                          <button
                                            type="button"
                                            onClick={() =>
                                              handleRemoveDraftAccountAlias(index, ai)
                                            }
                                            className="px-1.5 py-0.5 rounded border border-red-400 text-red-600 text-xs hover:bg-red-50 shrink-0"
                                          >
                                            {t('common.remove')}
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  <div className="flex flex-wrap gap-1 items-center">
                                    <input
                                      type="text"
                                      placeholder={t('settings.recognised.accounts.newAliasPlaceholder')}
                                      value={newAliasDraft[index] ?? ''}
                                      onChange={(e) =>
                                        setNewAliasDraft((prev) => ({
                                          ...prev,
                                          [index]: e.target.value,
                                        }))
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.preventDefault();
                                          handleAddDraftAccountAlias(index);
                                        }
                                      }}
                                      className="flex-1 min-w-[100px] border border-slate-200 rounded px-2 py-0.5 text-xs text-gray-800 bg-white"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleAddDraftAccountAlias(index)}
                                      disabled={
                                        !(newAliasDraft[index] ?? '').trim() ||
                                        !isAccountAliasLabelAvailable(
                                          draftAccounts,
                                          index,
                                          (newAliasDraft[index] ?? '').trim()
                                        )
                                      }
                                      className="px-2 py-0.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:hover:bg-indigo-600"
                                    >
                                      {t('settings.recognised.add')}
                                    </button>
                                  </div>
                                </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <>
                      {recognisedAccounts.length === 0 ? (
                        <p className="text-xs text-gray-500">{t('settings.recognised.accounts.empty')}</p>
                      ) : (
                        <ul className="flex flex-wrap gap-2">
                          {recognisedAccounts.map((entry, index) => {
                            const aliases = entry.aliases ?? [];
                            const hasAliases = aliases.length > 0;
                            return (
                              <li
                                key={index}
                                className="relative inline-flex max-w-full flex-nowrap items-center"
                              >
                                <div
                                  className={`inline-flex min-w-0 shrink items-center gap-2 border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800 shadow-sm ${
                                    hasAliases
                                      ? 'rounded-l-full rounded-r-md border-r-0 pr-2.5'
                                      : 'rounded-full'
                                  }`}
                                >
                                  <span className="truncate">{entry.name}</span>
                                  <span className="shrink-0 text-xs font-semibold text-slate-500 tabular-nums">
                                    {entry.currency === 'GBP'
                                      ? '£'
                                      : entry.currency === 'CHF'
                                      ? 'CHF'
                                      : '€'}
                                  </span>
                                </div>
                                {aliases.map((alias, ai) => (
                                  <span
                                    key={`${index}-alias-${ai}`}
                                    className="-ml-2 inline-flex max-w-[min(100%,12rem)] shrink items-center truncate rounded-full border border-indigo-200/90 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-900 shadow-sm ring-2 ring-white"
                                    style={{ zIndex: ai + 1 }}
                                    title={t('settings.recognised.accounts.aliasTitle', { alias })}
                                  >
                                    {alias}
                                  </span>
                                ))}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  )}
                </section>

                <section
                  className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm ring-1 ring-emerald-100"
                  data-tour="settings-entry-types"
                >
                  <h3 className="text-base font-bold text-emerald-900 mb-1 flex items-center gap-2 border-b border-emerald-200/80 pb-3">
                    <span className="flex h-8 w-1 shrink-0 rounded-full bg-emerald-600" aria-hidden />
                    {t('settings.recognised.entryTypes.title')}
                  </h3>
                  <p className="text-xs text-emerald-800/80 mb-3">
                    {t('settings.recognised.entryTypes.description')}
                  </p>
                  {recognisedDataEditMode ? (
                    <>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          placeholder={t('settings.recognised.entryTypes.addPlaceholder')}
                          value={newEntryTypeValue}
                          onChange={(e) => setNewEntryTypeValue(e.target.value)}
                          className="flex-1 border border-emerald-200 bg-white rounded-lg px-3 py-1.5 text-sm text-gray-800 shadow-sm"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddToList('entryTypes')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-700 text-white text-sm font-medium hover:bg-emerald-800 disabled:opacity-50"
                          disabled={!newEntryTypeValue.trim()}
                        >
                          {t('settings.recognised.add')}
                        </button>
                      </div>
                      {draftEntryTypes.length === 0 ? (
                        <p className="text-xs text-emerald-800/70">{t('settings.recognised.entryTypes.empty')}</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {draftEntryTypes.map((value, index) => (
                            <li key={index} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={value}
                                onChange={(e) =>
                                  handleEditListItem('entryTypes', index, e.target.value)
                                }
                                className="flex-1 border border-emerald-200/80 bg-white rounded-lg px-2 py-1.5 text-xs text-gray-800"
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveFromList('entryTypes', index)}
                                className="px-2 py-1 rounded border border-red-500 text-red-600 text-xs hover:bg-red-50"
                              >
                                {t('settings.recognised.delete')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <>
                      {recognisedEntryTypes.length === 0 ? (
                        <p className="text-xs text-emerald-800/70">{t('settings.recognised.entryTypes.empty')}</p>
                      ) : (
                        <ul className="flex flex-wrap gap-2">
                          {recognisedEntryTypes.map((value, index) => (
                            <li
                              key={index}
                              className="inline-flex items-center rounded-full border border-emerald-300 bg-white px-3 py-1 text-sm text-emerald-950 shadow-sm"
                            >
                              {value}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </section>

                <section
                  className="rounded-xl border border-red-200 bg-red-50/50 p-4 shadow-sm ring-1 ring-red-100"
                  data-tour="settings-output-types"
                >
                  <h3 className="text-base font-bold text-red-900 mb-1 flex items-center gap-2 border-b border-red-200/80 pb-3">
                    <span className="flex h-8 w-1 shrink-0 rounded-full bg-red-600" aria-hidden />
                    {t('settings.recognised.outputTypes.title')}
                  </h3>
                  <p className="text-xs text-red-800/80 mb-3">
                    {t('settings.recognised.outputTypes.description')}
                  </p>
                  {recognisedDataEditMode ? (
                    <>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          placeholder={t('settings.recognised.outputTypes.addPlaceholder')}
                          value={newOutputTypeValue}
                          onChange={(e) => setNewOutputTypeValue(e.target.value)}
                          className="flex-1 border border-red-200 bg-white rounded-lg px-3 py-1.5 text-sm text-gray-800 shadow-sm"
                        />
                        <button
                          type="button"
                          onClick={() => handleAddToList('outputTypes')}
                          className="px-3 py-1.5 rounded-lg bg-red-700 text-white text-sm font-medium hover:bg-red-800 disabled:opacity-50"
                          disabled={!newOutputTypeValue.trim()}
                        >
                          {t('settings.recognised.add')}
                        </button>
                      </div>
                      {draftOutputTypes.length === 0 ? (
                        <p className="text-xs text-red-800/70">{t('settings.recognised.outputTypes.empty')}</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {draftOutputTypes.map((value, index) => (
                            <li key={index} className="flex items-center gap-2">
                              <input
                                type="text"
                                value={value}
                                onChange={(e) =>
                                  handleEditListItem('outputTypes', index, e.target.value)
                                }
                                className="flex-1 border border-red-200/80 bg-white rounded-lg px-2 py-1.5 text-xs text-gray-800"
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveFromList('outputTypes', index)}
                                className="px-2 py-1 rounded border border-red-500 text-red-600 text-xs hover:bg-red-50"
                              >
                                {t('settings.recognised.delete')}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <>
                      {recognisedOutputTypes.length === 0 ? (
                        <p className="text-xs text-red-800/70">{t('settings.recognised.outputTypes.empty')}</p>
                      ) : (
                        <ul className="flex flex-wrap gap-2">
                          {recognisedOutputTypes.map((value, index) => (
                            <li
                              key={index}
                              className="inline-flex items-center rounded-full border border-red-300 bg-white px-3 py-1 text-sm text-red-950 shadow-sm"
                            >
                              {value}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </section>
              </div>
            </div>

        </div>
      </main>
      {recognisedExitConfirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-recognised-edit-exit-title"
          onClick={() => setRecognisedExitConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="settings-recognised-edit-exit-title" className="text-lg font-semibold text-gray-900">
              {t('settings.recognised.exitConfirm.title')}
            </h2>
            <p className="text-sm text-gray-600">
              {t('settings.recognised.exitConfirm.description')}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRecognisedExitConfirmOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('settings.recognised.exitConfirm.back')}
              </button>
              <button
                type="button"
                onClick={performExitRecognisedEditMode}
                className="rounded border border-red-600 bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                {t('settings.recognised.exitConfirm.leave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Settings;
