/**
 * Accès renderer aux listes reconnues du profil (AppState/recognised_data.json via IPC).
 */

import type { RecognisedDataFile } from '@/shared/recognisedData';
import {
  RECOGNISED_ACCOUNTS_LS_KEY,
  RECOGNISED_ENTRY_TYPES_LS_KEY,
  RECOGNISED_OUTPUT_TYPES_LS_KEY,
  emptyRecognisedData,
  parseRecognisedAccounts,
  parseRecognisedDataFile,
  parseRecognisedStringList,
} from '@/shared/recognisedData';
import i18n from '../i18n';

function notifyRecognisedChanged(): void {
  try {
    window.dispatchEvent(new Event('chamaccounts-recognised-data-changed'));
  } catch {
    /* ignore */
  }
}

function syncLocalStorageCache(data: RecognisedDataFile): void {
  try {
    localStorage.setItem(RECOGNISED_ACCOUNTS_LS_KEY, JSON.stringify(data.accounts));
    localStorage.setItem(RECOGNISED_ENTRY_TYPES_LS_KEY, JSON.stringify(data.entryTypes));
    localStorage.setItem(RECOGNISED_OUTPUT_TYPES_LS_KEY, JSON.stringify(data.outputTypes));
  } catch {
    /* ignore */
  }
  notifyRecognisedChanged();
}

function readLocalCache(): RecognisedDataFile {
  try {
    const accountsRaw = localStorage.getItem(RECOGNISED_ACCOUNTS_LS_KEY);
    const entryRaw = localStorage.getItem(RECOGNISED_ENTRY_TYPES_LS_KEY);
    const outputRaw = localStorage.getItem(RECOGNISED_OUTPUT_TYPES_LS_KEY);
    return parseRecognisedDataFile({
      version: 1,
      accounts: accountsRaw ? (JSON.parse(accountsRaw) as unknown) : [],
      entryTypes: entryRaw ? (JSON.parse(entryRaw) as unknown) : [],
      outputTypes: outputRaw ? (JSON.parse(outputRaw) as unknown) : [],
    });
  } catch {
    return emptyRecognisedData();
  }
}

export async function loadRecognisedDataFromProfile(): Promise<RecognisedDataFile> {
  const api = window.electronAPI;
  const cache = readLocalCache();
  if (!api?.recognisedDataGet) return cache;

  if (api.recognisedDataMergeCache) {
    const merged = await api.recognisedDataMergeCache({ data: cache });
    if (merged.success && merged.data) {
      syncLocalStorageCache(merged.data);
      return merged.data;
    }
  }

  const r = await api.recognisedDataGet();
  if (!r.success || !r.data) return cache;
  syncLocalStorageCache(r.data);
  return r.data;
}

export async function saveRecognisedDataToProfile(
  data: RecognisedDataFile
): Promise<{ ok: true; data: RecognisedDataFile } | { ok: false; error: string }> {
  const cleaned = parseRecognisedDataFile(data);
  syncLocalStorageCache(cleaned);
  const api = window.electronAPI;
  if (!api?.recognisedDataSave) {
    return { ok: true, data: cleaned };
  }
  const r = await api.recognisedDataSave({ data: cleaned });
  if (!r.success || !r.data) {
    return { ok: false, error: r.error ?? i18n.t('system.saveFailed') };
  }
  syncLocalStorageCache(r.data);
  return { ok: true, data: r.data };
}

/** Persiste les 3 listes (utilisé par Paramètres / saves partiels). */
export function persistRecognisedListsBundle(
  accounts: unknown,
  entryTypes: unknown,
  outputTypes: unknown
): RecognisedDataFile {
  const data: RecognisedDataFile = {
    version: 1,
    accounts: parseRecognisedAccounts(accounts),
    entryTypes: parseRecognisedStringList(entryTypes),
    outputTypes: parseRecognisedStringList(outputTypes),
  };
  void saveRecognisedDataToProfile(data);
  return data;
}

/**
 * Charge recognised_data.json → cache LS.
 * @returns true si le cache a changé.
 */
export async function hydrateRecognisedDataFromProfileFile(): Promise<boolean> {
  const before = {
    a: localStorage.getItem(RECOGNISED_ACCOUNTS_LS_KEY) ?? '',
    e: localStorage.getItem(RECOGNISED_ENTRY_TYPES_LS_KEY) ?? '',
    o: localStorage.getItem(RECOGNISED_OUTPUT_TYPES_LS_KEY) ?? '',
  };
  const fromProfile = await loadRecognisedDataFromProfile();
  const after = {
    a: JSON.stringify(fromProfile.accounts),
    e: JSON.stringify(fromProfile.entryTypes),
    o: JSON.stringify(fromProfile.outputTypes),
  };
  if (before.a === after.a && before.e === after.e && before.o === after.o) {
    return false;
  }
  return true;
}
