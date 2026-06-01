import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ExchangeRateService, type ExchangeRateResult } from '../services/ExchangeRateService';
import { EXCLUDE_ANOMALY_COLUMN } from '@/shared/excludeAnomalyColumn';
import {
  SourceDataCSVService,
  SOURCE_DATA_PATH,
  stripSourceColumnFromSourceData,
  sortSourceDataByDateChronology,
} from '../services/SourceDataCSVService';
import { amountToGbp } from '../services/EffectiveExchangeRates';
import { formatAmountGbpForCsv } from '../utils/format';
import Papa from 'papaparse';
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
} from '../services/localStorageSnapshotService';
import { describeProjectCsvDataForExport } from '../services/projectDataExportService';
import { LOCAL_STORAGE_SNAPSHOT_CSV_PATH } from '@/shared/dataPaths';
import AppUpdatesSection from '../components/Settings/AppUpdatesSection';
import ProfilesSection from '../components/Settings/ProfilesSection';

const STORAGE_KEYS = {
  eurGbpManual: 'settings-eurgbp-manual',
  chfGbpManual: 'settings-chfgbp-manual',
  eurGbpUseLive: 'settings-eurgbp-use-live',
  chfGbpUseLive: 'settings-chfgbp-use-live',
  eurGbpLiveRate: 'settings-eurgbp-live-rate',
  chfGbpLiveRate: 'settings-chfgbp-live-rate',
  recognisedAccounts: RECOGNISED_ACCOUNTS_STORAGE_KEY,
  recognisedEntryTypes: 'settings-recognised-entry-types',
  recognisedOutputTypes: 'settings-recognised-output-types',
} as const;

const KNOWN_ENTRY_TYPES: string[] = [
  'Lampton',
  'LMB',
  'LTL',
  'MPC',
  'LGV',
  'Other Inc',
  'Support',
  'Refund',
  'Benefit',
  'SLCcredit',
];

const KNOWN_OUTPUT_TYPES: string[] = [
  'Rent',
  'Council',
  'Comm',
  'Electricity',
  'Water',
  'Service',
  'SLCdebit',
  'Transport',
  'Fuel',
  'Car',
  'Food',
  'Restaurant',
  'Shopping',
  'Leisure',
  'Holiday',
  'LST',
  'School',
  'Misc',
  'Health',
  'Donation',
];

function loadString(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? v : fallback;
  } catch {
    return fallback;
  }
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === 'true' ? true : v === 'false' ? false : fallback;
  } catch {
    return fallback;
  }
}

function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function saveBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

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

function isRecognisedEditBaselineEqual(a: RecognisedEditBaseline, b: RecognisedEditBaseline): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function formatFetchedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

const Settings: React.FC = () => {
  const [eurGbpManual, setEurGbpManual] = useState(() =>
    loadString(STORAGE_KEYS.eurGbpManual, '0.86')
  );
  const [chfGbpManual, setChfGbpManual] = useState(() =>
    loadString(STORAGE_KEYS.chfGbpManual, '0.95')
  );
  const [eurGbpUseLive, setEurGbpUseLive] = useState(() =>
    loadBool(STORAGE_KEYS.eurGbpUseLive, false)
  );
  const [chfGbpUseLive, setChfGbpUseLive] = useState(() =>
    loadBool(STORAGE_KEYS.chfGbpUseLive, false)
  );
  const [eurGbpLive, setEurGbpLive] = useState<ExchangeRateResult | null>(null);
  const [chfGbpLive, setChfGbpLive] = useState<ExchangeRateResult | null>(null);
  const [eurGbpLoading, setEurGbpLoading] = useState(false);
  const [chfGbpLoading, setChfGbpLoading] = useState(false);
  const [eurGbpError, setEurGbpError] = useState<string | null>(null);
  const [chfGbpError, setChfGbpError] = useState<string | null>(null);
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
  const [refreshCsvLoading, setRefreshCsvLoading] = useState(false);
  const [refreshCsvMessage, setRefreshCsvMessage] = useState<string | null>(null);
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
    setBalanceCsvAlign({ kind: 'loading' });
    void AccountBalanceCSVService.loadRawCsvRows()
      .then((raw) => {
        if (cancelled) return;
        if (!raw?.headers?.length) {
          setBalanceCsvAlign({ kind: 'missing' });
          return;
        }
        const expectedCodes = recognisedAccounts
          .map((e) => getBalanceCodeForSettingsAccountName(e.name))
          .filter((c): c is string => Boolean(c));
        const actualHeaders = raw.headers
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
        name: 'Nouveau projet',
        color: nextDefaultProjectColor(projects),
      },
    ]);
  }, [projects, persistProjects]);

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
          `Export réussi : ${r.keyCount} clé(s) écrites dans ${LOCAL_STORAGE_SNAPSHOT_CSV_PATH}`
        );
      } else {
        setSnapshotMessage(r.error ?? 'Erreur');
      }
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  const handleImportLocalStorageSnapshot = useCallback(async (mode: 'merge' | 'replace') => {
    if (mode === 'replace') {
      const ok = window.confirm(
        'Remplacer tout le stockage local par le contenu du fichier ? Les réglages actuels non présents dans le fichier seront perdus.'
      );
      if (!ok) return;
    }
    setSnapshotMessage(null);
    setSnapshotLoading(true);
    try {
      const r = await importLocalStorageSnapshotFromDataFile(mode);
      if (r.ok) {
        setSnapshotMessage(`Import réussi (${r.keyCount} clé(s)). Rechargement…`);
        window.setTimeout(() => {
          window.location.reload();
        }, 400);
      } else {
        setSnapshotMessage(r.error ?? 'Erreur');
      }
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  /** Met à jour le CSV AppState puis archive tout le dossier data/ (ZIP). */
  const handleExportProjectZip = useCallback(async () => {
    setSnapshotMessage(null);
    setSnapshotLoading(true);
    try {
      const snap = await exportLocalStorageSnapshotToDataFile();
      if (!snap.ok) {
        setSnapshotMessage(snap.error ?? 'Export snapshot impossible');
        return;
      }
      const csvCheck = await describeProjectCsvDataForExport();
      const api = window.electronAPI;
      if (!api?.exportDataFolderZip) {
        setSnapshotMessage('Export ZIP indisponible (hors application desktop).');
        return;
      }
      const z = await api.exportDataFolderZip();
      if (z.canceled) {
        setSnapshotMessage('Export ZIP annulé.');
        return;
      }
      if (!z.success) {
        setSnapshotMessage(z.error ?? 'Erreur lors de la création du ZIP');
        return;
      }
      const emptyHint =
        csvCheck.emptyLabels.length > 0
          ? ` Attention : CSV sans lignes de données — ${csvCheck.emptyLabels.join(', ')}.`
          : '';
      setSnapshotMessage(
        `Archive créée : ${z.path ?? ''} (snapshot ${snap.keyCount} clé(s) ; transactions ${csvCheck.transactionRows}, soldes ${csvCheck.balanceRows}, soutien ${csvCheck.supportRows}).${emptyHint}`
      );
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  const handleImportProjectZip = useCallback(async () => {
    const ok = window.confirm(
      'Cette opération remplace les fichiers du dossier du profil actif (transactions, soldes, AppState, etc.) par ceux de l’archive.\n\n' +
        'Avez-vous exporté le projet (ZIP) pour conserver l’état actuel ?\n\n' +
        'Si l’archive contient un snapshot AppState, vos réglages navigateur seront aussi remplacés. Continuer ?'
    );
    if (!ok) return;
    setSnapshotMessage(null);
    setSnapshotLoading(true);
    try {
      const api = window.electronAPI;
      if (!api?.importDataFolderZip) {
        setSnapshotMessage('Import ZIP indisponible (hors application desktop).');
        return;
      }
      const z = await api.importDataFolderZip();
      if (z.canceled) {
        setSnapshotMessage('Import ZIP annulé.');
        return;
      }
      if (!z.success) {
        setSnapshotMessage(z.error ?? 'Erreur lors de l’import du ZIP');
        return;
      }
      const n = z.extractedFileCount ?? 0;
      if (!z.appStateSnapshotFound) {
        setSnapshotMessage(
          `${n} fichier(s) importé(s). Aucun local_storage_snapshot.csv — réglages navigateur inchangés. Rechargement…`
        );
        window.setTimeout(() => {
          window.location.reload();
        }, 700);
        return;
      }
      const ls = await importLocalStorageSnapshotFromDataFile('replace');
      if (!ls.ok) {
        setSnapshotMessage(
          `${n} fichier(s) importé(s). Échec import des réglages : ${ls.error ?? 'erreur'}. Rechargement…`
        );
        window.setTimeout(() => {
          window.location.reload();
        }, 900);
        return;
      }
      setSnapshotMessage(
        `Import terminé : ${n} fichier(s) + ${ls.keyCount} clé(s) de réglages. Rechargement…`
      );
      window.setTimeout(() => {
        window.location.reload();
      }, 500);
    } finally {
      setSnapshotLoading(false);
    }
  }, []);

  /**
   * Trie src_transaction_data.csv par date (réindexe 1…n), recalcule AMOUNT GBP pour EUR/CHF avec les taux actuels,
   * met à jour les données pour la détection d’anomalies, puis enregistre une seule fois.
   */
  const handleRefreshSourceDataRates = useCallback(async () => {
    setRefreshCsvMessage(null);
    setRefreshCsvLoading(true);
    try {
      saveString(STORAGE_KEYS.eurGbpManual, eurGbpManual);
      saveString(STORAGE_KEYS.chfGbpManual, chfGbpManual);
      const raw = await SourceDataCSVService.load();
      if (!raw?.headers?.length || !raw?.rows?.length) {
        setRefreshCsvMessage('Fichier src_transaction_data.csv absent ou vide.');
        return;
      }
      const headers = raw.headers.includes(EXCLUDE_ANOMALY_COLUMN)
        ? raw.headers
        : [...raw.headers, EXCLUDE_ANOMALY_COLUMN];
      const rows = raw.headers.includes(EXCLUDE_ANOMALY_COLUMN)
        ? raw.rows.map((r) => ({ ...r }))
        : raw.rows.map((r) => ({ ...r, [EXCLUDE_ANOMALY_COLUMN]: '' }));
      const stripped = stripSourceColumnFromSourceData({ headers, rows });
      const sorted = sortSourceDataByDateChronology(stripped);

      const amountHeader = sorted.headers.find((h) => /^amount$/i.test(h)) ?? null;
      const currencyHeader = sorted.headers.find((h) => /^currency$/i.test(h)) ?? null;
      const amountGbpHeader = sorted.headers.find((h) => /^amount\s*gbp$/i.test(h)) ?? null;
      if (!amountHeader || !currencyHeader || !amountGbpHeader) {
        setRefreshCsvMessage('Colonnes AMOUNT / CURRENCY / AMOUNT GBP introuvables.');
        return;
      }
      let updated = 0;
      const rowsOut = sorted.rows.map((row) => {
        const next = { ...row };
        const amountStr = (next[amountHeader] ?? '').trim().replace(',', '.');
        const amount = parseFloat(amountStr);
        const currency = (next[currencyHeader] ?? '').trim().toUpperCase();
        if (!Number.isNaN(amount) && amount !== 0 && (currency === 'EUR' || currency === 'CHF')) {
          const gbp = amountToGbp(amount, currency);
          if (gbp !== null) {
            next[amountGbpHeader] = formatAmountGbpForCsv(gbp);
            updated++;
          }
        }
        return next;
      });
      const api = (window as unknown as {
        electronAPI?: { writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }> };
      }).electronAPI;
      if (!api?.writeFile) {
        setRefreshCsvMessage('Écriture fichier non disponible.');
        return;
      }
      const csvContent = Papa.unparse(rowsOut, { columns: sorted.headers, delimiter: ';' });
      const result = await api.writeFile(SOURCE_DATA_PATH, csvContent);
      if (result.success) {
        setRefreshCsvMessage(
          `${sorted.rows.length} ligne(s) réordonnées par date (index 1…${sorted.rows.length}) ; ${updated} montant(s) GBP recalculé(s). Rechargez le tableau des transactions pour voir les changements.`
        );
      } else {
        setRefreshCsvMessage(result.error ?? 'Erreur lors de l\'enregistrement.');
      }
    } catch (e) {
      setRefreshCsvMessage(e instanceof Error ? e.message : 'Erreur lors du rafraîchissement.');
    } finally {
      setRefreshCsvLoading(false);
    }
  }, [eurGbpManual, chfGbpManual]);

  const fetchEurGbp = useCallback(async () => {
    setEurGbpLoading(true);
    setEurGbpError(null);
    try {
      const result = await ExchangeRateService.getEurGbp();
      setEurGbpLive(result);
      saveString(STORAGE_KEYS.eurGbpLiveRate, String(result.rate));
    } catch (err) {
      setEurGbpError(err instanceof Error ? err.message : 'Erreur réseau');
    } finally {
      setEurGbpLoading(false);
    }
  }, []);

  const fetchChfGbp = useCallback(async () => {
    setChfGbpLoading(true);
    setChfGbpError(null);
    try {
      const result = await ExchangeRateService.getChfGbp();
      setChfGbpLive(result);
      saveString(STORAGE_KEYS.chfGbpLiveRate, String(result.rate));
    } catch (err) {
      setChfGbpError(err instanceof Error ? err.message : 'Erreur réseau');
    } finally {
      setChfGbpLoading(false);
    }
  }, []);

  const handleEurGbpManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setEurGbpManual(v);
    saveString(STORAGE_KEYS.eurGbpManual, v);
  };

  const handleChfGbpManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setChfGbpManual(v);
    saveString(STORAGE_KEYS.chfGbpManual, v);
  };

  const handleEurGbpUseLiveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setEurGbpUseLive(checked);
    saveBool(STORAGE_KEYS.eurGbpUseLive, checked);
    if (checked) fetchEurGbp();
    else {
      setEurGbpLive(null);
      try {
        localStorage.removeItem(STORAGE_KEYS.eurGbpLiveRate);
      } catch {}
    }
  };

  const handleChfGbpUseLiveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setChfGbpUseLive(checked);
    saveBool(STORAGE_KEYS.chfGbpUseLive, checked);
    if (checked) fetchChfGbp();
    else {
      setChfGbpLive(null);
      try {
        localStorage.removeItem(STORAGE_KEYS.chfGbpLiveRate);
      } catch {}
    }
  };

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

  const handleSaveRecognisedData = async () => {
    setRecognisedExitConfirmOpen(false);
    const acc = migrateRecognisedAccountEntriesIfNeeded(
      draftAccounts
        .filter((e) => e.name.trim())
        .map((e) => ({
          name: e.name.trim(),
          currency: e.currency,
          aliases: e.aliases,
        }))
    );
    const entry = Array.from(new Set(draftEntryTypes.map((s) => s.trim()).filter(Boolean)));
    const output = Array.from(new Set(draftOutputTypes.map((s) => s.trim()).filter(Boolean)));
    saveRecognisedAccountsToStorage(acc);
    saveStringArray(STORAGE_KEYS.recognisedEntryTypes, entry);
    saveStringArray(STORAGE_KEYS.recognisedOutputTypes, output);
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
      setRecognisedDataSaveMessage(
        'Listes enregistrées. Ordre des colonnes de src_account_balance.csv aligné sur cette liste.'
      );
    } else {
      setRecognisedDataSaveMessage(
        `Listes enregistrées. ${csvResult.error ?? 'Impossible de mettre à jour src_account_balance.csv.'}`
      );
    }
    setBalanceCsvAlignTick((t) => t + 1);
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
        <h1 className="text-2xl font-bold text-gray-800">Réglages</h1>

        <div className="mt-6 flex flex-col gap-8 w-full">
          <div className="w-full flex flex-col gap-6">
            <AppUpdatesSection />

            <ProfilesSection />

            <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5">
              <h2 className="text-lg font-semibold text-gray-800 mb-1">Projet complet (données + snapshot)</h2>
              <p className="text-sm text-gray-600 mb-4 max-w-3xl">
                Archive ZIP du dossier de données du profil actif (celui indiqué dans Profils), y compris{' '}
                <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">AppState/</code> (réglages). « Exporter le
                projet » met d’abord à jour le snapshot puis crée l’archive — à utiliser avant un import ou une
                restauration sur une autre machine. « Importer projet (ZIP) » écrase les fichiers du profil actif.
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  onClick={() => void handleExportProjectZip()}
                  disabled={snapshotLoading}
                  className="rounded border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  {snapshotLoading ? 'Traitement…' : 'Exporter le projet (ZIP)'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleImportProjectZip()}
                  disabled={snapshotLoading}
                  className="rounded border border-emerald-600 bg-white px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                >
                  Importer projet (ZIP)
                </button>
              </div>
            </div>

            <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5">
              <h2 className="text-lg font-semibold text-gray-800 mb-1">Réglages navigateur uniquement (fichier AppState)</h2>
              <p className="text-sm text-gray-600 mb-4 max-w-3xl">
                Un seul fichier CSV sous{' '}
                <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{LOCAL_STORAGE_SNAPSHOT_CSV_PATH}</code>, qui
                reflète le stockage local (projets, taux, préférences du tableau de bord, etc.). Ces actions ne modifient
                pas les CSV de transactions ni de soldes : seulement
                le contenu importé dans le navigateur à partir de ce fichier.
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  onClick={() => void handleExportLocalStorageSnapshot()}
                  disabled={snapshotLoading}
                  className="rounded border border-slate-600 bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {snapshotLoading ? 'Traitement…' : 'Exporter vers AppState'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleImportLocalStorageSnapshot('merge')}
                  disabled={snapshotLoading}
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  Importer (fusion)
                </button>
                <button
                  type="button"
                  onClick={() => void handleImportLocalStorageSnapshot('replace')}
                  disabled={snapshotLoading}
                  className="rounded border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Importer (tout remplacer)
                </button>
              </div>
            </div>

            {snapshotMessage && (
              <p
                className={`text-sm ${
                  snapshotMessage.startsWith('Erreur') ||
                  snapshotMessage.includes('uniquement') ||
                  snapshotMessage.includes('introuvable') ||
                  snapshotMessage.includes('illisible') ||
                  snapshotMessage.includes('annulé') ||
                  snapshotMessage.includes('indisponible') ||
                  snapshotMessage.includes('Échec import')
                    ? 'text-amber-700'
                    : 'text-gray-700'
                }`}
              >
                {snapshotMessage}
              </p>
            )}
          </div>

          <div className="flex flex-col lg:flex-row lg:items-start lg:gap-6">
            <div className="flex-1 min-w-0 max-w-2xl space-y-6">
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Taux de change</h2>

              {/* EUR / GBP */}
              <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-gray-200">
                <label className="font-medium text-gray-700 w-20">EURGBP</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 0.8714"
                  value={eurGbpManual}
                  onChange={handleEurGbpManualChange}
                  className="border border-gray-300 rounded px-3 py-1.5 w-32 text-gray-800"
                  disabled={eurGbpUseLive}
                />
                <span className="text-gray-500">=</span>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={eurGbpUseLive}
                    onChange={handleEurGbpUseLiveChange}
                    className="rounded border-gray-400"
                  />
                  <span>Utiliser le taux en ligne</span>
                </label>
                {eurGbpUseLive && (
                  <div className="w-full mt-2 ml-0 pl-0 text-sm">
                    {eurGbpLoading ? (
                      <span className="text-gray-500">Chargement…</span>
                    ) : eurGbpError ? (
                      <span className="text-amber-600">{eurGbpError}</span>
                    ) : eurGbpLive ? (
                      <span className="text-gray-700">
                        Taux réel : <strong>{eurGbpLive.rate.toFixed(4)}</strong>
                        {' — '}
                        Requête : {formatFetchedAt(eurGbpLive.fetchedAt)}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              {/* CHF / GBP */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="font-medium text-gray-700 w-20">CHFGBP</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 0.89"
                  value={chfGbpManual}
                  onChange={handleChfGbpManualChange}
                  className="border border-gray-300 rounded px-3 py-1.5 w-32 text-gray-800"
                  disabled={chfGbpUseLive}
                />
                <span className="text-gray-500">=</span>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chfGbpUseLive}
                    onChange={handleChfGbpUseLiveChange}
                    className="rounded border-gray-400"
                  />
                  <span>Utiliser le taux en ligne</span>
                </label>
                {chfGbpUseLive && (
                  <div className="w-full mt-2 ml-0 pl-0 text-sm">
                    {chfGbpLoading ? (
                      <span className="text-gray-500">Chargement…</span>
                    ) : chfGbpError ? (
                      <span className="text-amber-600">{chfGbpError}</span>
                    ) : chfGbpLive ? (
                      <span className="text-gray-700">
                        Taux réel : <strong>{chfGbpLive.rate.toFixed(4)}</strong>
                        {' — '}
                        Requête : {formatFetchedAt(chfGbpLive.fetchedAt)}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
            </div>

            <div className="w-full lg:max-w-md lg:shrink-0 bg-white rounded-lg shadow p-4 border border-gray-100 space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-800 mb-2">Rafraîchir le fichier source</h2>
                <p className="text-sm text-gray-600 mb-4">
                  Trie toutes les lignes par la colonne Date (du plus ancien au plus récent), réattribue la colonne Index
                  (1, 2, 3…), recalcule les montants AMOUNT GBP pour EUR et CHF avec les taux ci-contre, et enregistre
                  src_transaction_data.csv. Met à jour aussi les données utilisées par la détection d&apos;anomalies.
                  Rechargez le tableau des transactions pour voir les changements.
                </p>
                <button
                  type="button"
                  onClick={handleRefreshSourceDataRates}
                  disabled={refreshCsvLoading}
                  className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {refreshCsvLoading ? 'Rafraîchissement…' : 'Rafraîchir src_transaction_data.csv'}
                </button>

                {refreshCsvMessage && (
                  <p
                    className={`mt-4 text-sm ${
                      refreshCsvMessage.startsWith('Erreur') ||
                      refreshCsvMessage.includes('introuvable') ||
                      refreshCsvMessage.includes('absent') ||
                      refreshCsvMessage.includes('non disponible')
                        ? 'text-amber-600'
                        : 'text-gray-700'
                    }`}
                  >
                    {refreshCsvMessage}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5">
            <h2 className="text-lg font-semibold text-gray-800 mb-1">Projets</h2>
            <p className="text-sm text-gray-600 mb-4 max-w-3xl">
              Définissez des projets et une couleur chacun. Ils apparaissent en liste déroulante dans la colonne PROJET
              (transactions, Soutien, comptabilité mensuelle) ; le fichier enregistre l’identifiant du projet, stable même
              si vous renommez le libellé ici.
            </p>
            {projects.length === 0 ? (
              <p className="text-sm text-gray-500 mb-3">Aucun projet — ajoutez-en un pour commencer.</p>
            ) : (
              <ul className="space-y-3 mb-4">
                {projects.map((p, i) => (
                  <li
                    key={p.id}
                    className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 rounded-lg border border-gray-200 bg-slate-50/50 p-3"
                    style={projetBackgroundStyle(p.color, 0.12)}
                  >
                    <label className="flex flex-1 min-w-[10rem] flex-col gap-0.5 text-sm">
                      <span className="text-gray-600">Nom</span>
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
                        <span className="text-gray-600">Couleur</span>
                        <input
                          type="color"
                          value={p.color}
                          onChange={(e) => handleUpdateProject(i, { color: e.target.value })}
                          className="h-9 w-14 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
                          title="Couleur du projet"
                        />
                      </label>
                      <span className="pb-2 text-xs font-mono text-gray-600">{p.color}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveProject(i)}
                        className="rounded border border-red-300 bg-white px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                      >
                        Supprimer
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
              Ajouter un projet
            </button>
          </div>

          <div className="bg-white rounded-xl shadow-md border border-gray-200/80 overflow-hidden w-full min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-5 py-4 border-b border-gray-200 bg-gradient-to-r from-slate-50 to-gray-50/80">
              <div>
                <h2 className="text-xl font-bold text-gray-900 tracking-tight">Données reconnues</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Comptes, types d&apos;entrées et de sorties utilisés pour l&apos;import et les contrôles.
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
                    {recognisedDataEditMode ? 'Quitter le mode édition' : 'Mode édition'}
                  </button>
                  {recognisedDataEditMode && (
                    <button
                      type="button"
                      onClick={() => void handleSaveRecognisedData()}
                      disabled={recognisedDataSaveLoading}
                      className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {recognisedDataSaveLoading ? 'Enregistrement…' : 'Sauvegarder les listes'}
                    </button>
                  )}
                </div>
            </div>

            {(recognisedDataEditMode || recognisedDataSaveMessage) && (
              <div className="px-5 py-4 space-y-3 border-b border-amber-100 bg-amber-50/60">
                {recognisedDataEditMode && (
                  <p className="text-amber-900 text-sm font-medium">
                    <span className="font-bold">Mode édition</span> — les listes ne sont enregistrées qu&apos;après
                    « Sauvegarder les listes ».
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
                <section className="rounded-xl border border-slate-200 bg-slate-50/40 p-4 shadow-sm ring-1 ring-slate-100">
                  <h3 className="text-base font-bold text-slate-900 mb-1 flex items-center gap-2 border-b border-slate-200 pb-3">
                    <span className="flex h-8 w-1 shrink-0 rounded-full bg-slate-600" aria-hidden />
                    Comptes actifs
                  </h3>
                  {!recognisedDataEditMode && (
                    <div className="text-xs text-slate-600 mb-3 space-y-2">
                      <p>
                        Chaque compte actif correspond à une colonne dans{' '}
                        <code className="text-gray-800">src_account_balance.csv</code> (après la date), dans le même
                        ordre. Un compte ajouté ici reçoit une colonne au prochain enregistrement des listes ; la
                        devise ne convertit pas les montants, elle fixe seulement le format (£, € ou CHF). Les alias
                        servent à reconnaître le même compte ailleurs (ex. source_data) sans colonne de solde
                        supplémentaire.
                      </p>
                      {balanceCsvAlign.kind === 'loading' && (
                        <p className="text-slate-500">Vérification du fichier soldes…</p>
                      )}
                      {balanceCsvAlign.kind === 'missing' && (
                        <p className="text-amber-900 font-medium">
                          Aucun fichier de soldes lisible dans Processed — il sera créé ou mis à jour lorsque vous
                          enregistrerez les listes (bouton « Sauvegarder les listes » en mode édition).
                        </p>
                      )}
                      {balanceCsvAlign.kind === 'aligned' && (
                        <p className="text-emerald-800 font-medium">
                          src_account_balance.csv : colonnes (hors date) identiques à la liste des comptes actifs et au
                          même ordre.
                        </p>
                      )}
                      {balanceCsvAlign.kind === 'mismatch' && (
                        <p className="text-amber-900 font-medium">
                          Écart avec src_account_balance.csv : le nombre ou l’ordre logique des comptes (y compris
                          correspondances d’anciens libellés) ne correspond pas au fichier. Enregistrez les listes pour
                          réaligner le CSV sur les comptes actifs (colonnes réordonnées ou ajoutées, montants regroupés
                          par compte).
                        </p>
                      )}
                    </div>
                  )}
                  {recognisedDataEditMode ? (
                    <>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          placeholder="Ajouter un compte…"
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
                          Ajouter
                        </button>
                      </div>
                      {draftAccounts.length === 0 ? (
                        <p className="text-xs text-gray-500">Aucun compte défini pour le moment.</p>
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
                                    title="Monter"
                                    aria-label="Monter"
                                    disabled={index === 0}
                                    onClick={() => handleMoveDraftAccount(index, -1)}
                                    className="px-1.5 py-0 text-xs leading-tight rounded border border-gray-300 text-gray-700 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    title="Descendre"
                                    aria-label="Descendre"
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
                                  Devise
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
                                  <option value="EUR">EUR (€)</option>
                                  <option value="GBP">GBP (£)</option>
                                  <option value="CHF">CHF</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveFromList('accounts', index)}
                                  className="px-2 py-1 rounded border border-red-500 text-red-600 text-xs hover:bg-red-50 shrink-0"
                                >
                                  Supprimer
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
                                            Retirer
                                          </button>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                  <div className="flex flex-wrap gap-1 items-center">
                                    <input
                                      type="text"
                                      placeholder="Nouvel alias…"
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
                                      Ajouter
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
                        <p className="text-xs text-gray-500">Aucun compte défini pour le moment.</p>
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
                                    title={`Alias : ${alias}`}
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

                <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm ring-1 ring-emerald-100">
                  <h3 className="text-base font-bold text-emerald-900 mb-1 flex items-center gap-2 border-b border-emerald-200/80 pb-3">
                    <span className="flex h-8 w-1 shrink-0 rounded-full bg-emerald-600" aria-hidden />
                    Types d&apos;entrées
                  </h3>
                  <p className="text-xs text-emerald-800/80 mb-3">Revenus et crédits reconnus.</p>
                  {recognisedDataEditMode ? (
                    <>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          placeholder="Ajouter un type d'entrée…"
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
                          Ajouter
                        </button>
                      </div>
                      {draftEntryTypes.length === 0 ? (
                        <p className="text-xs text-emerald-800/70">Aucun type d&apos;entrée défini pour le moment.</p>
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
                                Supprimer
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <>
                      {recognisedEntryTypes.length === 0 ? (
                        <p className="text-xs text-emerald-800/70">Aucun type d&apos;entrée défini pour le moment.</p>
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

                <section className="rounded-xl border border-red-200 bg-red-50/50 p-4 shadow-sm ring-1 ring-red-100">
                  <h3 className="text-base font-bold text-red-900 mb-1 flex items-center gap-2 border-b border-red-200/80 pb-3">
                    <span className="flex h-8 w-1 shrink-0 rounded-full bg-red-600" aria-hidden />
                    Types de sorties
                  </h3>
                  <p className="text-xs text-red-800/80 mb-3">Dépenses et débits reconnus.</p>
                  {recognisedDataEditMode ? (
                    <>
                      <div className="flex gap-2 mb-2">
                        <input
                          type="text"
                          placeholder="Ajouter un type de sortie…"
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
                          Ajouter
                        </button>
                      </div>
                      {draftOutputTypes.length === 0 ? (
                        <p className="text-xs text-red-800/70">Aucun type de sortie défini pour le moment.</p>
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
                                Supprimer
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <>
                      {recognisedOutputTypes.length === 0 ? (
                        <p className="text-xs text-red-800/70">Aucun type de sortie défini pour le moment.</p>
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
              Quitter sans sauvegarder ?
            </h2>
            <p className="text-sm text-gray-600">
              Les modifications non enregistrées sur les listes seront perdues.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRecognisedExitConfirmOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Retour
              </button>
              <button
                type="button"
                onClick={performExitRecognisedEditMode}
                className="rounded border border-red-600 bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Quitter
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Settings;
