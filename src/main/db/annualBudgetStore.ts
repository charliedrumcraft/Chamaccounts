/**
 * Lecture / écriture de AppState/annual_budget.json (budget annuel du profil).
 * Migration depuis local_storage_snapshot.csv si le fichier est absent.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ANNUAL_BUDGET_JSON_PATH, LOCAL_STORAGE_SNAPSHOT_CSV_PATH } from '../../shared/dataPaths';
import {
  mergeAnnualBudgetSnapshots,
  parseAnnualBudgetFilePayload,
  parseAnnualBudgetSnapshot,
  serializeAnnualBudgetFile,
  type AnnualBudgetSnapshotFile,
} from '../../shared/annualBudget';

const LS_SNAPSHOT_KEY = 'annual-budget-snapshot-v1';

function budgetFullPath(dataRoot: string): string {
  return path.join(dataRoot, ANNUAL_BUDGET_JSON_PATH);
}

function snapshotFullPath(dataRoot: string): string {
  return path.join(dataRoot, LOCAL_STORAGE_SNAPSHOT_CSV_PATH);
}

function readKeyFromSnapshotCsv(csvPath: string, key: string): string | null {
  if (!fs.existsSync(csvPath)) return null;
  let text: string;
  try {
    text = fs.readFileSync(csvPath, 'utf-8');
  } catch {
    return null;
  }
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^"?${escaped}"?\\s*;\\s*(.*)$`, 'i');
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(key)) continue;
    const m = line.match(re);
    if (!m) continue;
    let value = m[1] ?? '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/""/g, '"');
    }
    return value;
  }
  return null;
}

function readBudgetFromSnapshotCsv(csvPath: string): AnnualBudgetSnapshotFile {
  const raw = readKeyFromSnapshotCsv(csvPath, LS_SNAPSHOT_KEY);
  if (!raw) return { version: 1, byYear: {} };
  try {
    return parseAnnualBudgetSnapshot(JSON.parse(raw) as unknown);
  } catch {
    return { version: 1, byYear: {} };
  }
}

export function readAnnualBudget(dataRoot: string): AnnualBudgetSnapshotFile | null {
  const p = budgetFullPath(dataRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return parseAnnualBudgetFilePayload(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeAnnualBudget(dataRoot: string, snap: AnnualBudgetSnapshotFile): void {
  const p = budgetFullPath(dataRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, serializeAnnualBudgetFile(snap), 'utf-8');
}

/**
 * Garantit annual_budget.json : fichier existant, sinon migration depuis le snapshot AppState.
 */
export function ensureAnnualBudget(dataRoot: string): AnnualBudgetSnapshotFile {
  const existing = readAnnualBudget(dataRoot);
  if (existing) return existing;

  const fromSnap = readBudgetFromSnapshotCsv(snapshotFullPath(dataRoot));
  writeAnnualBudget(dataRoot, fromSnap);
  return fromSnap;
}

export function saveAnnualBudget(
  dataRoot: string,
  snap: AnnualBudgetSnapshotFile
): AnnualBudgetSnapshotFile {
  const cleaned = parseAnnualBudgetSnapshot(snap);
  writeAnnualBudget(dataRoot, cleaned);
  return cleaned;
}

/** Fusionne un snapshot (ex. cache LS) dans le fichier profil si le fichier est plus pauvre. */
export function mergeAnnualBudgetFromCache(
  dataRoot: string,
  cache: AnnualBudgetSnapshotFile
): AnnualBudgetSnapshotFile {
  const file = ensureAnnualBudget(dataRoot);
  const cacheYears = Object.keys(cache.byYear).length;
  const fileYears = Object.keys(file.byYear).length;
  if (cacheYears === 0) return file;
  if (fileYears === 0 && cacheYears > 0) {
    return saveAnnualBudget(dataRoot, cache);
  }
  // Si le cache a des années absentes du fichier, les ajouter (sans écraser le fichier)
  const missing = Object.keys(cache.byYear).filter((k) => !file.byYear[k]);
  if (missing.length === 0) return file;
  const merged = mergeAnnualBudgetSnapshots(file, cache);
  return saveAnnualBudget(dataRoot, merged);
}
