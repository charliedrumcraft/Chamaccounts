/**
 * Détection de dérive entre le CSV miroir et la DB SQLite.
 * Si le fichier CSV change hors de l’app (ancienne version, édition manuelle),
 * on réimporte le CSV au prochain ensure* pour éviter une DB obsolète.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import type { Database } from 'sql.js';
import { queryOne } from './sqlJsRuntime';

export const CSV_MIRROR_SHA256_META = 'csv_mirror_sha256';

export function sha256File(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
  } catch {
    return null;
  }
}

export function getMetaValue(database: Database, key: string): string | null {
  const row = queryOne(database, 'SELECT value FROM meta WHERE key = ?', [key]);
  return row?.value != null ? String(row.value) : null;
}

export function setMetaValue(
  database: Database,
  key: string,
  value: string,
  persist: () => void
): void {
  const existing = queryOne(database, 'SELECT value FROM meta WHERE key = ?', [key]);
  if (existing) {
    database.run('UPDATE meta SET value = ? WHERE key = ?', [value, key]);
  } else {
    database.run('INSERT INTO meta (key, value) VALUES (?, ?)', [key, value]);
  }
  persist();
}

/** Enregistre l’empreinte du CSV miroir juste après une écriture contrôlée. */
export function rememberCsvMirrorHash(
  database: Database,
  csvPath: string,
  persist: () => void
): void {
  const hash = sha256File(csvPath);
  if (!hash) return;
  setMetaValue(database, CSV_MIRROR_SHA256_META, hash, persist);
}

/**
 * true si le CSV on-disk ne correspond plus à la dernière empreinte connue
 * (ou si aucune empreinte n’existe encore — premier passage après mise à jour).
 */
export function csvMirrorNeedsResyncFromCsv(
  database: Database,
  csvPath: string
): boolean {
  if (!fs.existsSync(csvPath)) return false;
  const current = sha256File(csvPath);
  if (!current) return false;
  const stored = getMetaValue(database, CSV_MIRROR_SHA256_META);
  return stored !== current;
}
