/**
 * Store SQLite Support + migration CSV + miroir CSV.
 */

import type { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { SUPPORT_DATA_CSV_PATH } from '../../shared/dataPaths';
import { supportSourceHeaders, type SourceDataResult } from '../../shared/sourceDataTypes';
import { EXCLUDE_ANOMALY_COLUMN } from '../../shared/excludeAnomalyColumn';
import { SOUTIEN_IGNORE_COLUMN } from '../../shared/soutienIgnoreColumn';
import { TRANSACTION_SOURCE_COLUMN } from '../../shared/transactionRowSource';
import { TRANSACTION_PROJET_COLUMN } from '../../shared/transactionsImportCore';
import { formatDateDDMMYY } from '../../shared/transactionsImportCore';
import { fillAmountCurrencyFromAmountGbpIfNeeded } from '../../shared/transactionsImportMappingPolicy';
import { amountIndicatorHeader, isAmountIndicatorHeader } from '../../shared/workingCurrencies';
import { writeSupportCsvMirror } from './supportCsvMirror';
import { closeSupportDb, getOpenSupportDataRoot, openSupportDb, persistSupportDb } from './supportDb';
import { queryAll, queryOne } from './sqlJsRuntime';
import { getWorkingCurrenciesOrDefault } from './workingCurrenciesStore';

const AMOUNT_CURRENCY_FROM_GBP_META = 'amount_currency_from_gbp_v1';

function toDisplayDate(s: string): string {
  const raw = (s ?? '').trim();
  if (!raw) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
  let day: number;
  let month: number;
  let year: number;
  const mi = raw.match(iso);
  if (mi) {
    year = parseInt(mi[1], 10);
    month = parseInt(mi[2], 10);
    day = parseInt(mi[3], 10);
  } else {
    const md = raw.match(dmy);
    if (!md) return raw;
    day = parseInt(md[1], 10);
    month = parseInt(md[2], 10);
    const yy = parseInt(md[3], 10);
    year = md[3].length === 2 ? (yy < 50 ? 2000 + yy : 1900 + yy) : yy;
  }
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

function cell(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null) return String(row[k]);
  }
  const lowerMap = new Map(Object.keys(row).map((h) => [h.toLowerCase(), h]));
  for (const k of keys) {
    const orig = lowerMap.get(k.toLowerCase());
    if (orig) return String(row[orig] ?? '');
  }
  return '';
}

function normalizeSupportRow(row: Record<string, string>): Record<string, string> {
  let indicator = cell(row, 'AMOUNT GBP', 'AMOUNT_GBP').trim();
  if (!indicator) {
    for (const k of Object.keys(row)) {
      if (isAmountIndicatorHeader(k)) {
        indicator = String(row[k] ?? '').trim();
        if (indicator) break;
      }
    }
  }
  return {
    DATE: formatDateDDMMYY(cell(row, 'DATE')) || cell(row, 'DATE').trim(),
    TITLE: cell(row, 'TITLE').trim(),
    AMOUNT: cell(row, 'AMOUNT').trim(),
    CURRENCY: cell(row, 'CURRENCY').trim(),
    'AMOUNT GBP': indicator,
    TYPE: cell(row, 'TYPE').trim(),
    [TRANSACTION_SOURCE_COLUMN]: cell(row, TRANSACTION_SOURCE_COLUMN, 'Source').trim(),
    [TRANSACTION_PROJET_COLUMN]: cell(row, TRANSACTION_PROJET_COLUMN, 'PROJET').trim(),
    [EXCLUDE_ANOMALY_COLUMN]: cell(row, EXCLUDE_ANOMALY_COLUMN).trim(),
    [SOUTIEN_IGNORE_COLUMN]: cell(row, SOUTIEN_IGNORE_COLUMN).trim(),
  };
}

function isSupportRowEmpty(row: Record<string, string>): boolean {
  return !(
    row.DATE?.trim() ||
    row.TITLE?.trim() ||
    row.AMOUNT?.trim() ||
    row.CURRENCY?.trim() ||
    row['AMOUNT GBP']?.trim() ||
    row.TYPE?.trim() ||
    row[TRANSACTION_SOURCE_COLUMN]?.trim() ||
    row[TRANSACTION_PROJET_COLUMN]?.trim() ||
    row[EXCLUDE_ANOMALY_COLUMN]?.trim() ||
    row[SOUTIEN_IGNORE_COLUMN]?.trim()
  );
}

function toUiRow(
  row: Record<string, string>,
  index: number,
  primaryCurrency = 'GBP'
): Record<string, string> {
  const indicatorKey = amountIndicatorHeader(primaryCurrency);
  return {
    Index: String(index),
    DATE: toDisplayDate(row.DATE ?? ''),
    TITLE: row.TITLE ?? '',
    AMOUNT: row.AMOUNT ?? '',
    CURRENCY: row.CURRENCY ?? '',
    [indicatorKey]: row['AMOUNT GBP'] ?? '',
    TYPE: row.TYPE ?? '',
    [TRANSACTION_SOURCE_COLUMN]: row[TRANSACTION_SOURCE_COLUMN] ?? '',
    PROJET: row[TRANSACTION_PROJET_COLUMN] ?? '',
    [EXCLUDE_ANOMALY_COLUMN]: row[EXCLUDE_ANOMALY_COLUMN] ?? '',
    [SOUTIEN_IGNORE_COLUMN]: row[SOUTIEN_IGNORE_COLUMN] ?? '',
  };
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function readCsvAsSupportRows(dataRoot: string): Record<string, string>[] {
  const fullPath = path.join(dataRoot, SUPPORT_DATA_CSV_PATH);
  if (!fs.existsSync(fullPath)) return [];
  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length <= 1) return [];
  const headers = parseCsvLine(lines[0], ';').map((h) => h.replace(/^\uFEFF/, '').trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], ';');
    const raw: Record<string, string> = {};
    headers.forEach((h, c) => {
      raw[h] = (values[c] ?? '').trim();
    });
    const norm = normalizeSupportRow(raw);
    if (!isSupportRowEmpty(norm)) rows.push(norm);
  }
  return rows;
}

function countSupportRows(database: Database): number {
  const row = queryOne(database, 'SELECT COUNT(*) AS n FROM support_rows');
  return Number(row?.n ?? 0);
}

function insertSupportRows(database: Database, rows: Record<string, string>[], replace: boolean): void {
  database.run('BEGIN');
  try {
    if (replace) database.run('DELETE FROM support_rows');
    const sql = `
      INSERT INTO support_rows (
        idx, date, title, amount, currency, amount_gbp, type, source, projet,
        exclure_anomalie, soutien_ignorer
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    rows.forEach((row, i) => {
      database.run(sql, [
        i + 1,
        row.DATE ?? '',
        row.TITLE ?? '',
        row.AMOUNT ?? '',
        row.CURRENCY ?? '',
        row['AMOUNT GBP'] ?? '',
        row.TYPE ?? '',
        row[TRANSACTION_SOURCE_COLUMN] ?? '',
        row[TRANSACTION_PROJET_COLUMN] ?? '',
        row[EXCLUDE_ANOMALY_COLUMN] ?? '',
        row[SOUTIEN_IGNORE_COLUMN] ?? '',
      ]);
    });
    database.run('COMMIT');
  } catch (err) {
    try {
      database.run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  persistSupportDb();
}

function selectAllSupportRows(database: Database): Record<string, string>[] {
  const rows = queryAll(
    database,
    `SELECT idx, date, title, amount, currency, amount_gbp, type, source, projet,
            exclure_anomalie, soutien_ignorer
     FROM support_rows
     ORDER BY idx ASC`
  );
  return rows.map((r) => ({
    DATE: String(r.date ?? ''),
    TITLE: String(r.title ?? ''),
    AMOUNT: String(r.amount ?? ''),
    CURRENCY: String(r.currency ?? ''),
    'AMOUNT GBP': String(r.amount_gbp ?? ''),
    TYPE: String(r.type ?? ''),
    [TRANSACTION_SOURCE_COLUMN]: String(r.source ?? ''),
    [TRANSACTION_PROJET_COLUMN]: String(r.projet ?? ''),
    [EXCLUDE_ANOMALY_COLUMN]: String(r.exclure_anomalie ?? ''),
    [SOUTIEN_IGNORE_COLUMN]: String(r.soutien_ignorer ?? ''),
  }));
}

function backfillSupportAmountCurrencyFromGbpIfNeeded(database: Database, dataRoot: string): void {
  const done = queryOne(database, 'SELECT value FROM meta WHERE key = ?', [
    AMOUNT_CURRENCY_FROM_GBP_META,
  ]);
  if (done?.value === '1') return;

  const rows = queryAll(
    database,
    `SELECT id, amount, currency, amount_gbp FROM support_rows
     WHERE TRIM(amount) = '' AND TRIM(amount_gbp) != ''
       AND (TRIM(currency) = '' OR UPPER(TRIM(currency)) = 'GBP')`
  );

  if (rows.length > 0) {
    database.run('BEGIN');
    try {
      for (const r of rows) {
        const id = Number(r.id);
        if (!id) continue;
        const patch = {
          AMOUNT: String(r.amount ?? ''),
          CURRENCY: String(r.currency ?? ''),
          'AMOUNT GBP': String(r.amount_gbp ?? ''),
        };
        if (!fillAmountCurrencyFromAmountGbpIfNeeded(patch)) continue;
        database.run('UPDATE support_rows SET amount = ?, currency = ? WHERE id = ?', [
          patch.AMOUNT,
          patch.CURRENCY,
          id,
        ]);
      }
      database.run('COMMIT');
    } catch (err) {
      try {
        database.run('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    }
    persistSupportDb();
    const valid = selectAllSupportRows(database);
    writeSupportCsvMirror(
      dataRoot,
      valid.map((r, i) => toUiRow(r, i + 1, getWorkingCurrenciesOrDefault(dataRoot).primary))
    );
  }

  const existing = queryOne(database, 'SELECT value FROM meta WHERE key = ?', [
    AMOUNT_CURRENCY_FROM_GBP_META,
  ]);
  if (existing) {
    database.run('UPDATE meta SET value = ? WHERE key = ?', ['1', AMOUNT_CURRENCY_FROM_GBP_META]);
  } else {
    database.run('INSERT INTO meta (key, value) VALUES (?, ?)', [
      AMOUNT_CURRENCY_FROM_GBP_META,
      '1',
    ]);
  }
  persistSupportDb();
}

export async function ensureSupportStore(dataRoot: string): Promise<void> {
  const database = await openSupportDb(dataRoot);
  if (countSupportRows(database) === 0) {
    const fromCsv = readCsvAsSupportRows(dataRoot);
    for (const row of fromCsv) {
      fillAmountCurrencyFromAmountGbpIfNeeded(row);
    }
    if (fromCsv.length > 0) {
      insertSupportRows(database, fromCsv, true);
      writeSupportCsvMirror(
        dataRoot,
        fromCsv.map((r, i) => toUiRow(r, i + 1, getWorkingCurrenciesOrDefault(dataRoot).primary))
      );
    } else {
      writeSupportCsvMirror(dataRoot, []);
    }
    const existing = queryOne(database, 'SELECT value FROM meta WHERE key = ?', [
      AMOUNT_CURRENCY_FROM_GBP_META,
    ]);
    if (!existing) {
      database.run('INSERT INTO meta (key, value) VALUES (?, ?)', [
        AMOUNT_CURRENCY_FROM_GBP_META,
        '1',
      ]);
      persistSupportDb();
    }
  } else {
    backfillSupportAmountCurrencyFromGbpIfNeeded(database, dataRoot);
  }
}

export async function getAllSupportAsSourceData(dataRoot: string): Promise<SourceDataResult> {
  await ensureSupportStore(dataRoot);
  const database = await openSupportDb(dataRoot);
  const valid = selectAllSupportRows(database);
  const primary = getWorkingCurrenciesOrDefault(dataRoot).primary || 'GBP';
  const headers = supportSourceHeaders(primary);
  const rows = valid.map((row, i) => toUiRow(row, i + 1, primary));
  return { headers, rows };
}

export async function replaceAllSupportRows(
  dataRoot: string,
  rows: Record<string, string>[]
): Promise<{ success: boolean; error?: string; count: number }> {
  try {
    await ensureSupportStore(dataRoot);
    const database = await openSupportDb(dataRoot);
    const valid = rows.map(normalizeSupportRow).filter((r) => !isSupportRowEmpty(r));
    insertSupportRows(database, valid, true);
    const primary = getWorkingCurrenciesOrDefault(dataRoot).primary || 'GBP';
    const uiRows = valid.map((r, i) => toUiRow(r, i + 1, primary));
    writeSupportCsvMirror(dataRoot, uiRows);
    return { success: true, count: valid.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, count: 0 };
  }
}

export async function syncSupportCsvMirror(dataRoot: string): Promise<void> {
  await ensureSupportStore(dataRoot);
  const data = await getAllSupportAsSourceData(dataRoot);
  writeSupportCsvMirror(dataRoot, data.rows);
}

export function ensureActiveSupportStoreSyncCheck(dataRoot: string | null | undefined): boolean {
  if (!dataRoot) return false;
  return getOpenSupportDataRoot() !== path.resolve(dataRoot);
}

export { closeSupportDb };
