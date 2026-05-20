/**
 * Export / import de tout le localStorage vers un CSV sous data/AppState/
 * (même schéma que le stockage : chaînes uniquement ; valeurs souvent du JSON).
 */

import Papa from 'papaparse';
import { LOCAL_STORAGE_SNAPSHOT_CSV_PATH } from '@/shared/dataPaths';

export type LocalStorageSnapshotResult =
  | { ok: true; keyCount: number }
  | { ok: false; error: string };

/** Toutes les paires clé → valeur du localStorage courant (ordre des clés trié). */
export function readAllLocalStorageEntries(): Array<{ key: string; value: string }> {
  if (typeof localStorage === 'undefined') return [];
  const out: Array<{ key: string; value: string }> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key === null) continue;
    const value = localStorage.getItem(key);
    if (value !== null) out.push({ key, value });
  }
  out.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

export function buildLocalStorageSnapshotCsv(rows: Array<{ key: string; value: string }>): string {
  return Papa.unparse(rows, {
    columns: ['key', 'value'],
    delimiter: ';',
    header: true,
    quotes: true,
    quoteChar: '"',
    escapeChar: '"',
    newline: '\n',
  });
}

export function parseLocalStorageSnapshotCsv(text: string): Array<{ key: string; value: string }> {
  const parsed = Papa.parse<{ key: string; value: string }>(text, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  if (parsed.errors.length > 0) {
    const msg = parsed.errors.map((e) => e.message).join('; ');
    throw new Error(msg || 'CSV invalide');
  }
  const rows = parsed.data.filter((r) => (r.key ?? '').trim() !== '');
  if (rows.length === 0) throw new Error('Aucune ligne exploitable dans le fichier');
  return rows.map((r) => ({
    key: String(r.key).trim(),
    value: r.value ?? '',
  }));
}

/** Écrit data/AppState/local_storage_snapshot.csv (Electron uniquement). */
export async function exportLocalStorageSnapshotToDataFile(): Promise<LocalStorageSnapshotResult> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.writeFile) {
    return { ok: false, error: 'Export disponible uniquement dans l’application desktop (Electron).' };
  }
  const rows = readAllLocalStorageEntries();
  const csv = buildLocalStorageSnapshotCsv(rows);
  const res = await api.writeFile(LOCAL_STORAGE_SNAPSHOT_CSV_PATH, csv);
  if (!res.success) {
    return { ok: false, error: res.error ?? 'Écriture du fichier impossible' };
  }
  return { ok: true, keyCount: rows.length };
}

export type ImportMode = 'replace' | 'merge';

/**
 * Applique les entrées au localStorage.
 * - replace : efface toutes les clés existantes puis applique le fichier.
 * - merge : écrase uniquement les clés présentes dans le fichier.
 */
export function applyLocalStorageSnapshot(
  rows: Array<{ key: string; value: string }>,
  mode: ImportMode
): LocalStorageSnapshotResult {
  try {
    if (mode === 'replace' && typeof localStorage !== 'undefined') {
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k !== null) toRemove.push(k);
      }
      for (const k of toRemove) localStorage.removeItem(k);
    }
    for (const { key, value } of rows) {
      if (!key) continue;
      localStorage.setItem(key, value);
    }
    return { ok: true, keyCount: rows.length };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

/** Lit le CSV sous data/ et fusionne ou remplace le localStorage (Electron uniquement). */
export async function importLocalStorageSnapshotFromDataFile(mode: ImportMode): Promise<LocalStorageSnapshotResult> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.readFile) {
    return { ok: false, error: 'Import disponible uniquement dans l’application desktop (Electron).' };
  }
  const res = await api.readFile(LOCAL_STORAGE_SNAPSHOT_CSV_PATH);
  if (!res.success || res.data === undefined) {
    return { ok: false, error: res.error ?? 'Fichier introuvable ou illisible' };
  }
  try {
    const rows = parseLocalStorageSnapshotCsv(res.data);
    return applyLocalStorageSnapshot(rows, mode);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}
