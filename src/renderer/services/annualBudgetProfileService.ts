/**
 * Accès renderer au snapshot budget annuel du profil (AppState/annual_budget.json via IPC).
 */

import type { AnnualBudgetSnapshotFile } from '@/shared/annualBudget';
import { parseAnnualBudgetSnapshot } from '@/shared/annualBudget';
import i18n from '../i18n';

const ANNUAL_BUDGET_SNAPSHOT_KEY = 'annual-budget-snapshot-v1';

function notifyBudgetChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent('annual-budget-snapshot-changed'));
  } catch {
    /* ignore */
  }
}

function syncLocalStorageCache(snap: AnnualBudgetSnapshotFile): void {
  try {
    // Clé historique sans `version` au top-level pour compat lecture
    localStorage.setItem(
      ANNUAL_BUDGET_SNAPSHOT_KEY,
      JSON.stringify({ byYear: snap.byYear })
    );
  } catch {
    /* ignore */
  }
  notifyBudgetChanged();
}

function readLocalCache(): AnnualBudgetSnapshotFile {
  try {
    const raw = localStorage.getItem(ANNUAL_BUDGET_SNAPSHOT_KEY);
    if (!raw) return { version: 1, byYear: {} };
    return parseAnnualBudgetSnapshot(JSON.parse(raw) as unknown);
  } catch {
    return { version: 1, byYear: {} };
  }
}

export async function loadAnnualBudgetFromProfile(): Promise<AnnualBudgetSnapshotFile> {
  const api = window.electronAPI;
  const cache = readLocalCache();
  if (!api?.annualBudgetGet) {
    return cache;
  }
  // Enrichit le fichier si le cache LS a des années absentes
  if (api.annualBudgetMergeCache && Object.keys(cache.byYear).length > 0) {
    const merged = await api.annualBudgetMergeCache({ snapshot: cache });
    if (merged.success && merged.data?.snapshot) {
      syncLocalStorageCache(merged.data.snapshot);
      return merged.data.snapshot;
    }
  }
  const r = await api.annualBudgetGet();
  if (!r.success || !r.data?.snapshot) {
    return cache;
  }
  syncLocalStorageCache(r.data.snapshot);
  return r.data.snapshot;
}

export async function saveAnnualBudgetToProfile(
  snap: AnnualBudgetSnapshotFile
): Promise<{ ok: true; snapshot: AnnualBudgetSnapshotFile } | { ok: false; error: string }> {
  const cleaned = parseAnnualBudgetSnapshot(snap);
  syncLocalStorageCache(cleaned);
  const api = window.electronAPI;
  if (!api?.annualBudgetSave) {
    return { ok: true, snapshot: cleaned };
  }
  const r = await api.annualBudgetSave({ snapshot: cleaned });
  if (!r.success || !r.data?.snapshot) {
    return { ok: false, error: r.error ?? i18n.t('system.saveFailed') };
  }
  syncLocalStorageCache(r.data.snapshot);
  return { ok: true, snapshot: r.data.snapshot };
}
