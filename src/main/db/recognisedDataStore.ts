/**
 * Lecture / écriture de AppState/recognised_data.json.
 * Migration depuis local_storage_snapshot.csv si le fichier est absent.
 */

import * as fs from 'fs';
import * as path from 'path';
import { LOCAL_STORAGE_SNAPSHOT_CSV_PATH, RECOGNISED_DATA_JSON_PATH } from '../../shared/dataPaths';
import {
  RECOGNISED_ACCOUNTS_LS_KEY,
  RECOGNISED_ENTRY_TYPES_LS_KEY,
  RECOGNISED_OUTPUT_TYPES_LS_KEY,
  emptyRecognisedData,
  isRecognisedDataEmpty,
  mergeRecognisedData,
  parseRecognisedAccounts,
  parseRecognisedDataFilePayload,
  parseRecognisedStringList,
  serializeRecognisedDataFile,
  type RecognisedDataFile,
} from '../../shared/recognisedData';

function fullPath(dataRoot: string): string {
  return path.join(dataRoot, RECOGNISED_DATA_JSON_PATH);
}

function snapshotPath(dataRoot: string): string {
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

function readFromSnapshotCsv(csvPath: string): RecognisedDataFile {
  const accountsRaw = readKeyFromSnapshotCsv(csvPath, RECOGNISED_ACCOUNTS_LS_KEY);
  const entryRaw = readKeyFromSnapshotCsv(csvPath, RECOGNISED_ENTRY_TYPES_LS_KEY);
  const outputRaw = readKeyFromSnapshotCsv(csvPath, RECOGNISED_OUTPUT_TYPES_LS_KEY);
  let accounts: RecognisedDataFile['accounts'] = [];
  let entryTypes: string[] = [];
  let outputTypes: string[] = [];
  if (accountsRaw) {
    try {
      accounts = parseRecognisedAccounts(JSON.parse(accountsRaw) as unknown);
    } catch {
      /* ignore */
    }
  }
  if (entryRaw) {
    try {
      entryTypes = parseRecognisedStringList(JSON.parse(entryRaw) as unknown);
    } catch {
      /* ignore */
    }
  }
  if (outputRaw) {
    try {
      outputTypes = parseRecognisedStringList(JSON.parse(outputRaw) as unknown);
    } catch {
      /* ignore */
    }
  }
  return { version: 1, accounts, entryTypes, outputTypes };
}

export function readRecognisedData(dataRoot: string): RecognisedDataFile | null {
  const p = fullPath(dataRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return parseRecognisedDataFilePayload(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeRecognisedData(dataRoot: string, data: RecognisedDataFile): void {
  const p = fullPath(dataRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, serializeRecognisedDataFile(data), 'utf-8');
}

export function ensureRecognisedData(dataRoot: string): RecognisedDataFile {
  const existing = readRecognisedData(dataRoot);
  if (existing) return existing;
  const fromSnap = readFromSnapshotCsv(snapshotPath(dataRoot));
  writeRecognisedData(dataRoot, fromSnap);
  return fromSnap;
}

export function saveRecognisedData(
  dataRoot: string,
  data: RecognisedDataFile
): RecognisedDataFile {
  const cleaned = parseRecognisedDataFilePayload(serializeRecognisedDataFile(data));
  writeRecognisedData(dataRoot, cleaned);
  return cleaned;
}

/** Fusionne un cache LS dans le fichier si le fichier a des listes vides. */
export function mergeRecognisedDataFromCache(
  dataRoot: string,
  cache: RecognisedDataFile
): RecognisedDataFile {
  const file = ensureRecognisedData(dataRoot);
  if (isRecognisedDataEmpty(cache)) return file;
  if (isRecognisedDataEmpty(file)) {
    return saveRecognisedData(dataRoot, cache);
  }
  const merged = mergeRecognisedData(file, cache);
  if (JSON.stringify(merged) === JSON.stringify(file)) return file;
  return saveRecognisedData(dataRoot, merged);
}

export function recognisedDataToLocalStorageMap(
  data: RecognisedDataFile
): Record<string, string> {
  return {
    [RECOGNISED_ACCOUNTS_LS_KEY]: JSON.stringify(data.accounts),
    [RECOGNISED_ENTRY_TYPES_LS_KEY]: JSON.stringify(data.entryTypes),
    [RECOGNISED_OUTPUT_TYPES_LS_KEY]: JSON.stringify(data.outputTypes),
  };
}

export { emptyRecognisedData };
