/**
 * Store SQLite (sql.js) des transactions + migration CSV + miroir CSV.
 */

import type { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { tm } from '../uiI18n';
import { SOURCE_DATA_PATH } from '../../shared/dataPaths';
import {
  transactionSourceHeaders,
  type SourceDataResult,
} from '../../shared/sourceDataTypes';
import { EXCLUDE_ANOMALY_COLUMN } from '../../shared/excludeAnomalyColumn';
import { SOUTIEN_IGNORE_COLUMN } from '../../shared/soutienIgnoreColumn';
import {
  TRANSACTION_PROJET_COLUMN,
  emptyRow,
  formatDateDDMMYY,
  parseCsvLine,
  parseDateToTime,
  rowSignature,
  sortByDate,
  type ValidRow,
} from '../../shared/transactionsImportCore';
import {
  buildAccountAliasLookup,
  type AccountAliasEntry,
} from '../../shared/accountAliasForDuplicates';
import {
  amountToPrimaryWithRates,
  fillAmountCurrencyFromAmountGbpIfNeeded,
  formatAmountGbpForCsvImport,
  type PrimaryMappingRates,
} from '../../shared/transactionsImportMappingPolicy';
import type { RefreshGbpRatesResult } from '../../shared/transactionQueryTypes';
import { amountIndicatorHeader, isAmountIndicatorHeader } from '../../shared/workingCurrencies';
import { writeTransactionsCsvMirror } from './csvMirror';
import {
  csvMirrorNeedsResyncFromCsv,
  rememberCsvMirrorHash,
} from './csvMirrorSync';
import { getWorkingCurrenciesOrDefault } from './workingCurrenciesStore';
import {
  closeTransactionDb,
  getOpenTransactionDataRoot,
  openTransactionDb,
  persistTransactionDb,
  queryAll,
  queryOne,
} from './transactionDb';

function transactionsCsvPath(dataRoot: string): string {
  return path.join(dataRoot, SOURCE_DATA_PATH);
}

/** Écrit le miroir CSV et mémorise son empreinte (anti-dérive). */
function writeTxCsvMirror(dataRoot: string, rows: ValidRow[], database: Database): void {
  writeTransactionsCsvMirror(dataRoot, rows);
  rememberCsvMirrorHash(database, transactionsCsvPath(dataRoot), persistTransactionDb);
}

function importTransactionsFromCsv(database: Database, dataRoot: string): void {
  const fromCsv = readCsvAsValidRows(dataRoot);
  for (const row of fromCsv) {
    fillAmountCurrencyFromAmountGbpIfNeeded(row);
  }
  insertValidRows(database, fromCsv, true);
  writeTxCsvMirror(dataRoot, fromCsv, database);
}

function isExcludedAnomalyFlag(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'oui' || v === 'true' || v === 'yes';
}

function monthBoundsMs(monthKey: string): { startMs: number; endMs: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return null;
  const y = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isFinite(y) || month < 1 || month > 12) return null;
  return {
    startMs: new Date(y, month - 1, 1).getTime(),
    endMs: new Date(y, month, 0, 23, 59, 59, 999).getTime(),
  };
}

/** Affichage UI : DD.MM.YYYY (comme l’ancien parse CSV renderer). */
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

function sourceRowToValidRow(row: Record<string, string>): ValidRow {
  const v = emptyRow();
  v.DATE = formatDateDDMMYY(cell(row, 'DATE')) || cell(row, 'DATE').trim();
  v.TITLE = cell(row, 'TITLE').trim();
  v.AMOUNT = cell(row, 'AMOUNT').trim();
  v.CURRENCY = cell(row, 'CURRENCY').trim();
  v.ACCOUNT = cell(row, 'ACCOUNT').trim();
  let indicator = cell(row, 'AMOUNT GBP', 'AMOUNT_GBP').trim();
  if (!indicator) {
    for (const k of Object.keys(row)) {
      if (isAmountIndicatorHeader(k)) {
        indicator = String(row[k] ?? '').trim();
        if (indicator) break;
      }
    }
  }
  v['AMOUNT GBP'] = indicator;
  v.TYPE = cell(row, 'TYPE').trim();
  v[TRANSACTION_PROJET_COLUMN] = cell(row, TRANSACTION_PROJET_COLUMN, 'PROJET').trim();
  v[EXCLUDE_ANOMALY_COLUMN] = cell(row, EXCLUDE_ANOMALY_COLUMN).trim();
  v[SOUTIEN_IGNORE_COLUMN] = cell(row, SOUTIEN_IGNORE_COLUMN).trim();
  return v;
}

function validRowToSourceRow(
  row: ValidRow,
  index: number,
  primaryCurrency = 'GBP'
): Record<string, string> {
  const indicatorKey = amountIndicatorHeader(primaryCurrency);
  return {
    Index: String(index),
    DATE: toDisplayDate(row.DATE),
    TITLE: row.TITLE ?? '',
    AMOUNT: row.AMOUNT ?? '',
    CURRENCY: row.CURRENCY ?? '',
    ACCOUNT: row.ACCOUNT ?? '',
    [indicatorKey]: row['AMOUNT GBP'] ?? '',
    TYPE: row.TYPE ?? '',
    PROJET: row[TRANSACTION_PROJET_COLUMN] ?? '',
    [EXCLUDE_ANOMALY_COLUMN]: row[EXCLUDE_ANOMALY_COLUMN] ?? '',
    [SOUTIEN_IGNORE_COLUMN]: row[SOUTIEN_IGNORE_COLUMN] ?? '',
  };
}

function isValidRowEmpty(row: ValidRow): boolean {
  return !(
    row.DATE.trim() ||
    row.TITLE.trim() ||
    row.AMOUNT.trim() ||
    row.CURRENCY.trim() ||
    row.ACCOUNT.trim() ||
    row['AMOUNT GBP'].trim() ||
    row.TYPE.trim() ||
    (row[TRANSACTION_PROJET_COLUMN] ?? '').trim() ||
    (row[EXCLUDE_ANOMALY_COLUMN] ?? '').trim() ||
    (row[SOUTIEN_IGNORE_COLUMN] ?? '').trim()
  );
}

function readCsvAsValidRows(dataRoot: string): ValidRow[] {
  const fullPath = path.join(dataRoot, SOURCE_DATA_PATH);
  if (!fs.existsSync(fullPath)) return [];
  const content = fs.readFileSync(fullPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length <= 1) return [];

  const headerNames = parseCsvLine(lines[0], ';').map((h) => h.replace(/^\uFEFF/, '').trim());
  const rows: ValidRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], ';');
    const raw: Record<string, string> = {};
    headerNames.forEach((h, c) => {
      raw[h] = (values[c] ?? '').trim();
    });
    const row = sourceRowToValidRow(raw);
    row.DATE = formatDateDDMMYY(row.DATE) || row.DATE;
    if (!isValidRowEmpty(row)) rows.push(row);
  }
  return rows;
}

function countTransactions(database: Database): number {
  const row = queryOne(database, 'SELECT COUNT(*) AS n FROM transactions');
  return Number(row?.n ?? 0);
}

export async function getTransactionCount(dataRoot: string): Promise<number> {
  await ensureTransactionStore(dataRoot);
  const database = await openTransactionDb(dataRoot);
  return countTransactions(database);
}

function dateMsForRow(row: ValidRow): number {
  return parseDateToTime(row.DATE ?? '') || 0;
}

function backfillDateMsIfNeeded(database: Database): void {
  const pending = queryOne(
    database,
    `SELECT COUNT(*) AS n FROM transactions WHERE date_ms = 0 AND TRIM(date) != ''`
  );
  if (Number(pending?.n ?? 0) === 0) return;
  const rows = queryAll(database, `SELECT id, date FROM transactions WHERE date_ms = 0`);
  database.run('BEGIN');
  try {
    for (const r of rows) {
      const id = Number(r.id);
      const ms = parseDateToTime(String(r.date ?? ''));
      if (!id || !ms) continue;
      database.run('UPDATE transactions SET date_ms = ? WHERE id = ?', [ms, id]);
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
  persistTransactionDb();
}

const AMOUNT_CURRENCY_FROM_GBP_META = 'amount_currency_from_gbp_v1';

/**
 * One-shot : lignes historiques AMOUNT/CURRENCY vides avec AMOUNT GBP rempli → AMOUNT + CURRENCY=GBP.
 */
function backfillAmountCurrencyFromGbpIfNeeded(database: Database, dataRoot: string): void {
  const done = queryOne(database, 'SELECT value FROM meta WHERE key = ?', [
    AMOUNT_CURRENCY_FROM_GBP_META,
  ]);
  if (done?.value === '1') return;

  const rows = queryAll(
    database,
    `SELECT id, amount, currency, amount_gbp FROM transactions
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
        database.run('UPDATE transactions SET amount = ?, currency = ? WHERE id = ?', [
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
    persistTransactionDb();
    writeTxCsvMirror(dataRoot, selectAllValidRows(database), database);
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
  persistTransactionDb();
}

function insertValidRows(database: Database, rows: ValidRow[], replace: boolean): void {
  database.run('BEGIN');
  try {
    if (replace) {
      database.run('DELETE FROM transactions');
    }
    const insertSql = `
      INSERT INTO transactions (
        idx, date, date_ms, title, amount, currency, account, amount_gbp, type, projet,
        exclure_anomalie, soutien_ignorer
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      database.run(insertSql, [
        i + 1,
        row.DATE ?? '',
        dateMsForRow(row),
        row.TITLE ?? '',
        row.AMOUNT ?? '',
        row.CURRENCY ?? '',
        row.ACCOUNT ?? '',
        row['AMOUNT GBP'] ?? '',
        row.TYPE ?? '',
        row[TRANSACTION_PROJET_COLUMN] ?? '',
        row[EXCLUDE_ANOMALY_COLUMN] ?? '',
        row[SOUTIEN_IGNORE_COLUMN] ?? '',
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
  persistTransactionDb();
}

function selectAllValidRows(database: Database): ValidRow[] {
  const rows = queryAll(
    database,
    `SELECT idx, date, title, amount, currency, account, amount_gbp, type, projet,
            exclure_anomalie, soutien_ignorer
     FROM transactions
     ORDER BY idx ASC`
  );

  return rows.map((r) => {
    const v = emptyRow();
    v.DATE = String(r.date ?? '');
    v.TITLE = String(r.title ?? '');
    v.AMOUNT = String(r.amount ?? '');
    v.CURRENCY = String(r.currency ?? '');
    v.ACCOUNT = String(r.account ?? '');
    v['AMOUNT GBP'] = String(r.amount_gbp ?? '');
    v.TYPE = String(r.type ?? '');
    v[TRANSACTION_PROJET_COLUMN] = String(r.projet ?? '');
    v[EXCLUDE_ANOMALY_COLUMN] = String(r.exclure_anomalie ?? '');
    v[SOUTIEN_IGNORE_COLUMN] = String(r.soutien_ignorer ?? '');
    return v;
  });
}

/** Ouvre la DB du profil, migre depuis CSV si table vide ou si le miroir CSV a divergé. */
export async function ensureTransactionStore(dataRoot: string): Promise<void> {
  const database = await openTransactionDb(dataRoot);
  const csvPath = transactionsCsvPath(dataRoot);

  if (countTransactions(database) === 0) {
    const fromCsv = readCsvAsValidRows(dataRoot);
    for (const row of fromCsv) {
      fillAmountCurrencyFromAmountGbpIfNeeded(row);
    }
    insertValidRows(database, fromCsv, true);
    writeTxCsvMirror(dataRoot, fromCsv, database);
    const existing = queryOne(database, 'SELECT value FROM meta WHERE key = ?', [
      AMOUNT_CURRENCY_FROM_GBP_META,
    ]);
    if (!existing) {
      database.run('INSERT INTO meta (key, value) VALUES (?, ?)', [
        AMOUNT_CURRENCY_FROM_GBP_META,
        '1',
      ]);
      persistTransactionDb();
    }
  } else if (!fs.existsSync(csvPath)) {
    writeTxCsvMirror(dataRoot, selectAllValidRows(database), database);
  } else if (csvMirrorNeedsResyncFromCsv(database, csvPath)) {
    console.info(
      '[transactions] CSV miroir modifié hors SQLite — réimport depuis',
      csvPath
    );
    importTransactionsFromCsv(database, dataRoot);
  }

  if (countTransactions(database) > 0) {
    backfillDateMsIfNeeded(database);
    backfillAmountCurrencyFromGbpIfNeeded(database, dataRoot);
    rememberCsvMirrorHash(database, csvPath, persistTransactionDb);
  }
}

export async function ensureActiveTransactionStore(
  dataRoot: string | null | undefined
): Promise<void> {
  if (!dataRoot) {
    closeTransactionDb();
    return;
  }
  const resolved = path.resolve(dataRoot);
  if (getOpenTransactionDataRoot() !== resolved) {
    await ensureTransactionStore(resolved);
  }
}

export function validRowsToSourceData(
  valid: ValidRow[],
  primaryCurrency = 'GBP'
): SourceDataResult {
  const headers = transactionSourceHeaders(primaryCurrency);
  const rows = valid.map((row, i) => validRowToSourceRow(row, i + 1, primaryCurrency));
  return { headers, rows };
}

export async function getAllAsSourceData(dataRoot: string): Promise<SourceDataResult> {
  await ensureTransactionStore(dataRoot);
  const database = await openTransactionDb(dataRoot);
  const primary = getWorkingCurrenciesOrDefault(dataRoot).primary;
  return validRowsToSourceData(selectAllValidRows(database), primary);
}

export async function getAllAsValidRows(dataRoot: string): Promise<ValidRow[]> {
  await ensureTransactionStore(dataRoot);
  const database = await openTransactionDb(dataRoot);
  return selectAllValidRows(database);
}

/**
 * Remplace toutes les transactions (depuis lignes UI SourceDataResult ou ValidRow-like).
 * Régénère le miroir CSV.
 */
export async function replaceAllTransactions(
  dataRoot: string,
  rows: Record<string, string>[]
): Promise<{ success: boolean; error?: string; count: number }> {
  try {
    await ensureTransactionStore(dataRoot);
    const database = await openTransactionDb(dataRoot);
    const valid = rows.map(sourceRowToValidRow).filter((r) => !isValidRowEmpty(r));
    insertValidRows(database, valid, true);
    writeTxCsvMirror(dataRoot, valid, database);
    return { success: true, count: valid.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, count: 0 };
  }
}

/**
 * Remplace depuis une liste ValidRow (import merge), avec tri date optionnel.
 */
export async function replaceAllValidRows(
  dataRoot: string,
  rows: ValidRow[],
  options?: { sortByDate?: boolean }
): Promise<{ success: boolean; error?: string; count: number }> {
  try {
    await ensureTransactionStore(dataRoot);
    const database = await openTransactionDb(dataRoot);
    const list = rows.filter((r) => !isValidRowEmpty(r));
    if (options?.sortByDate !== false) {
      sortByDate(list);
    }
    insertValidRows(database, list, true);
    writeTxCsvMirror(dataRoot, list, database);
    return { success: true, count: list.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, count: 0 };
  }
}

/** Ajoute des lignes en fin (tri chronologique global + réindex). */
export async function appendValidRows(
  dataRoot: string,
  rows: ValidRow[]
): Promise<{ success: boolean; error?: string; appendedCount: number }> {
  if (!rows.length) return { success: true, appendedCount: 0 };
  try {
    await ensureTransactionStore(dataRoot);
    const existing = await getAllAsValidRows(dataRoot);
    const all = [...existing, ...rows.filter((r) => !isValidRowEmpty(r))];
    sortByDate(all);
    const result = await replaceAllValidRows(dataRoot, all, { sortByDate: false });
    if (!result.success) {
      return { success: false, error: result.error, appendedCount: 0 };
    }
    return { success: true, appendedCount: rows.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, appendedCount: 0 };
  }
}

/** Force le miroir CSV à jour (ex. avant export ZIP). */
export async function syncCsvMirror(dataRoot: string): Promise<void> {
  await ensureTransactionStore(dataRoot);
  const database = await openTransactionDb(dataRoot);
  const rows = selectAllValidRows(database);
  writeTxCsvMirror(dataRoot, rows, database);
}

/**
 * Trie chronologiquement et recalcule l’indicateur (AMOUNT {PRIMARY}) pour les devises secondaires.
 */
export async function refreshGbpRates(
  dataRoot: string,
  rates: { eurToGbp: number; chfToGbp: number } | PrimaryMappingRates
): Promise<RefreshGbpRatesResult> {
  const primaryRates: PrimaryMappingRates =
    'ratesToPrimary' in rates
      ? rates
      : {
          primary: getWorkingCurrenciesOrDefault(dataRoot).primary || 'GBP',
          ratesToPrimary: {
            EUR: Number(rates.eurToGbp) || 0.86,
            CHF: Number(rates.chfToGbp) || 0.95,
          },
        };
  return refreshPrimaryRates(dataRoot, primaryRates);
}

export async function refreshPrimaryRates(
  dataRoot: string,
  rates: PrimaryMappingRates
): Promise<RefreshGbpRatesResult> {
  try {
    await ensureTransactionStore(dataRoot);
    const list = await getAllAsValidRows(dataRoot);
    if (!list.length) {
      return { success: false, error: tm('error.noTransactions'), rowCount: 0, updatedCount: 0 };
    }
    sortByDate(list);
    const primary = (rates.primary || 'GBP').toUpperCase();
    const secondarySet = new Set(
      Object.keys(rates.ratesToPrimary || {}).map((c) => c.toUpperCase())
    );
    let updatedCount = 0;
    for (const row of list) {
      const amountStr = (row.AMOUNT ?? '').trim().replace(',', '.');
      const amount = parseFloat(amountStr);
      const currency = (row.CURRENCY ?? '').trim().toUpperCase();
      if (Number.isNaN(amount) || amount === 0) continue;
      if (currency === primary) {
        row['AMOUNT GBP'] = formatAmountGbpForCsvImport(amount);
        updatedCount++;
        continue;
      }
      if (secondarySet.has(currency)) {
        const converted = amountToPrimaryWithRates(amount, currency, rates);
        if (converted !== null) {
          row['AMOUNT GBP'] = formatAmountGbpForCsvImport(converted);
          updatedCount++;
        }
      }
    }
    const result = await replaceAllValidRows(dataRoot, list, { sortByDate: false });
    if (!result.success) {
      return { success: false, error: result.error, rowCount: 0, updatedCount: 0 };
    }
    return { success: true, rowCount: list.length, updatedCount };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, rowCount: 0, updatedCount: 0 };
  }
}

/**
 * Remplace le mois `monthKey` par `monthRows` (autres mois inchangés), puis replaceAll + miroir.
 */
export async function mergeMonthEdit(
  dataRoot: string,
  monthKey: string,
  monthRows: Record<string, string>[]
): Promise<{ success: boolean; error?: string; count: number }> {
  try {
    const bounds = monthBoundsMs(monthKey);
    if (!bounds) {
      return { success: false, error: tm('error.invalidMonthKey'), count: 0 };
    }
    const all = await getAllAsValidRows(dataRoot);
    const kept = all.filter((r) => {
      const t = parseDateToTime(r.DATE) || 0;
      if (t <= 0) return true;
      return t < bounds.startMs || t > bounds.endMs;
    });
    const incoming = (Array.isArray(monthRows) ? monthRows : [])
      .map(sourceRowToValidRow)
      .filter((r) => !isValidRowEmpty(r));
    const merged = [...kept, ...incoming];
    return await replaceAllValidRows(dataRoot, merged, { sortByDate: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, count: 0 };
  }
}

/** Signatures doublons import (sans getAll côté renderer). */
export async function getRowSignatures(
  dataRoot: string,
  accountEntries?: AccountAliasEntry[]
): Promise<string[]> {
  const rows = await getAllAsValidRows(dataRoot);
  const lookup = buildAccountAliasLookup(accountEntries ?? []);
  return rows.map((r) => rowSignature(r, { accountAliasLookup: lookup }));
}

/** Lignes marquées Exclure_anomalie (Index = idx DB). */
export async function getAnomalyExceptions(dataRoot: string): Promise<SourceDataResult> {
  await ensureTransactionStore(dataRoot);
  const database = await openTransactionDb(dataRoot);
  const rows = queryAll(
    database,
    `SELECT idx, date, title, amount, currency, account, amount_gbp, type, projet,
            exclure_anomalie, soutien_ignorer
     FROM transactions
     ORDER BY idx ASC`
  );
  const primary = getWorkingCurrenciesOrDefault(dataRoot).primary || 'GBP';
  const headers = transactionSourceHeaders(primary);
  const outRows: Record<string, string>[] = [];
  const rowIndicesInSource: number[] = [];
  for (const r of rows) {
    if (!isExcludedAnomalyFlag(String(r.exclure_anomalie ?? ''))) continue;
    const idx = Number(r.idx ?? 0);
    const v = emptyRow();
    v.DATE = String(r.date ?? '');
    v.TITLE = String(r.title ?? '');
    v.AMOUNT = String(r.amount ?? '');
    v.CURRENCY = String(r.currency ?? '');
    v.ACCOUNT = String(r.account ?? '');
    v['AMOUNT GBP'] = String(r.amount_gbp ?? '');
    v.TYPE = String(r.type ?? '');
    v[TRANSACTION_PROJET_COLUMN] = String(r.projet ?? '');
    v[EXCLUDE_ANOMALY_COLUMN] = String(r.exclure_anomalie ?? '');
    v[SOUTIEN_IGNORE_COLUMN] = String(r.soutien_ignorer ?? '');
    outRows.push(validRowToSourceRow(v, idx > 0 ? idx : outRows.length + 1, primary));
    rowIndicesInSource.push(idx > 0 ? idx - 1 : outRows.length - 1);
  }
  return { headers, rows: outRows, rowIndicesInSource };
}

/** Efface Exclure_anomalie pour l’idx DB donné (replaceAll interne). */
export async function clearAnomalyException(
  dataRoot: string,
  idx: number
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!Number.isFinite(idx) || idx < 1) {
      return { success: false, error: tm('error.invalidIndex') };
    }
    const data = await getAllAsSourceData(dataRoot);
    let found = false;
    const nextRows = data.rows.map((row) => {
      if (String(row.Index ?? '').trim() !== String(idx)) return row;
      found = true;
      return { ...row, [EXCLUDE_ANOMALY_COLUMN]: '' };
    });
    if (!found) {
      return { success: false, error: tm('error.noRowWithIndex', { index: idx }) };
    }
    const result = await replaceAllTransactions(dataRoot, nextRows);
    return { success: result.success, error: result.error };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export { closeTransactionDb };
