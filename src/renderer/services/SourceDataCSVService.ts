/**
 * Charge les transactions (SQLite via IPC ; CSV miroir / Support via parse local).
 * Tableau dynamique : colonnes et lignes dérivées de la source.
 * Les dates (DD/MM/YYYY ou DD.MM.YYYY) sont normalisées en DD.MM.YYYY.
 * L’ordre des lignes suit la source (pas de tri) pour préserver la chronologie et la détection d’anomalies.
 */

import { formatDateDDMMYYYY } from '../utils/format';
import { SOURCE_DATA_PATH } from '@/shared/dataPaths';
import { EXCLUDE_ANOMALY_COLUMN } from '@/shared/excludeAnomalyColumn';
import { SOUTIEN_IGNORE_COLUMN } from '@/shared/soutienIgnoreColumn';
import { TRANSACTION_SOURCE_COLUMN } from '@/shared/transactionRowSource';
import { parseDateToTime } from '@/shared/transactionsImportCore';
import type { SourceDataResult } from '@/shared/sourceDataTypes';
import Papa from 'papaparse';
import i18n from '../i18n';

/** Chemin du fichier CSV miroir (compat / export). */
export { SOURCE_DATA_PATH };
export type { SourceDataResult };

/** Colonnes à ne pas afficher (toujours masquées, même si des lignes ont des valeurs). */
const HIDDEN_COLUMNS = new Set<string>();

/** Colonne index du CSV ignorée ; on génère notre propre index selon l’ordre des lignes (voir commentaire fichier). */
function isIndexColumn(norm: string): boolean {
  return norm.toLowerCase().startsWith('index');
}

function normalizeHeader(h: string | undefined): string {
  const s = (h ?? '').replace(/^\uFEFF/, '').trim();
  return s;
}

function isDateColumn(header: string): boolean {
  return /date/i.test(header);
}

/**
 * Ligne sans aucune donnée métier (toutes les colonnes vides après trim, hors Index).
 * Évite qu’une ligne placeholder du CSV (ex. « 1;;;;;;; ») prenne l’index 1.
 */
export function isSourceDataRowEmpty(row: Record<string, string>, dataColumnHeaders: string[]): boolean {
  const cols = dataColumnHeaders.filter((h) => !/^index$/i.test(h));
  if (cols.length === 0) return false;
  return cols.every((h) => !(row[h] ?? '').toString().trim());
}

/**
 * Parse le contenu d’un CSV transactions (même schéma que src_transaction_data.csv).
 * Utilisé pour Support_data.csv et repli local.
 */
export function parseSourceTransactionCsvContent(content: string): SourceDataResult | null {
  if (!content?.trim()) return null;
  const results = Papa.parse<Record<string, string>>(content, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
  });
  const fields = results.meta.fields ?? [];
  const rawData = results.data as Record<string, string>[];
  const data = rawData.filter(
    (row) => !fields.every((f) => (row[f] ?? '').toString().trim() === (f ?? '').trim())
  );
  if (!fields.length) {
    return null;
  }
  if (!data.length) {
    const headerOnly = fields
      .map((orig) => ({ orig, norm: normalizeHeader(orig) }))
      .filter(({ norm }) => norm && !HIDDEN_COLUMNS.has(norm) && !isIndexColumn(norm));
    let headersFromCsv = headerOnly.map((x) => x.norm);
    if (!headersFromCsv.length) return null;
    if (!headersFromCsv.some((h) => /^projet$/i.test(h))) {
      const typeIdx = headersFromCsv.findIndex((h) => /^type$/i.test(h));
      const insertAt = typeIdx >= 0 ? typeIdx + 1 : headersFromCsv.length;
      headersFromCsv = [
        ...headersFromCsv.slice(0, insertAt),
        'PROJET',
        ...headersFromCsv.slice(insertAt),
      ];
    }
    return { headers: ['Index', ...headersFromCsv], rows: [] };
  }
  const kept = fields
    .map((orig) => ({ orig, norm: normalizeHeader(orig) }))
    .filter(
      ({ orig, norm }) =>
        norm &&
        !HIDDEN_COLUMNS.has(norm) &&
        !isIndexColumn(norm) &&
        (norm === EXCLUDE_ANOMALY_COLUMN ||
          norm === SOUTIEN_IGNORE_COLUMN ||
          norm === TRANSACTION_SOURCE_COLUMN ||
          /^projet$/i.test(norm) ||
          data.some((row) => (row[orig] ?? '').toString().trim() !== ''))
    );
  let headersFromCsv = kept.map((x) => x.norm);
  if (!headersFromCsv.length) {
    return null;
  }
  if (!headersFromCsv.some((h) => /^projet$/i.test(h))) {
    const typeIdx = headersFromCsv.findIndex((h) => /^type$/i.test(h));
    const insertAt = typeIdx >= 0 ? typeIdx + 1 : headersFromCsv.length;
    headersFromCsv = [
      ...headersFromCsv.slice(0, insertAt),
      'PROJET',
      ...headersFromCsv.slice(insertAt),
    ];
  }
  let rows = data.map((row) => {
    const r: Record<string, string> = {};
    kept.forEach(({ orig, norm }) => {
      const raw = (row[orig] ?? '').toString();
      r[norm] = isDateColumn(norm) ? formatDateDDMMYYYY(raw) : raw;
    });
    return r;
  });
  rows = rows.map((row) => {
    const r = { ...row };
    headersFromCsv.forEach((h) => {
      if (r[h] === undefined) r[h] = '';
    });
    return r;
  });
  rows = rows.filter((row) => !isSourceDataRowEmpty(row, headersFromCsv));
  const INDEX_HEADER = 'Index';
  const firstDataRowIndex = 1;
  rows = rows.map((row, i) => ({ ...row, [INDEX_HEADER]: String(firstDataRowIndex + i) }));
  const headers = [INDEX_HEADER, ...headersFromCsv];
  return {
    headers,
    rows,
  };
}

function stripColumnFromSourceData(
  result: SourceDataResult,
  isTarget: (header: string) => boolean
): SourceDataResult {
  const key = result.headers.find(isTarget);
  if (!key) return result;
  const headers = result.headers.filter((h) => h !== key);
  const rows = result.rows.map((row) => {
    const { [key]: _removed, ...rest } = row;
    return rest;
  });
  return { ...result, headers, rows };
}

/** Retire la colonne Source (src_transaction_data.csv n’en contient plus ; le soutien reste dans Support_data.csv). */
export function stripSourceColumnFromSourceData(result: SourceDataResult): SourceDataResult {
  return stripColumnFromSourceData(result, (h) => /^source$/i.test(h));
}

/** Retire la colonne Account (utile uniquement aux transactions, pas à Support_data.csv). */
export function stripAccountColumnFromSupportData(result: SourceDataResult): SourceDataResult {
  return stripColumnFromSourceData(result, (h) => /^account$/i.test(h));
}

function getTxApi(): Window['electronAPI'] | undefined {
  return (window as unknown as { electronAPI?: Window['electronAPI'] }).electronAPI;
}

export class SourceDataCSVService {
  /** Charge depuis SQLite (processus main). */
  static async load(): Promise<SourceDataResult | null> {
    try {
      const api = getTxApi();
      if (!api?.transactionsGetAll) return null;
      const result = await api.transactionsGetAll();
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async getMonthKeys(): Promise<{ monthKeys: string[]; monthStartsMs: number[] } | null> {
    try {
      const api = getTxApi();
      if (!api?.transactionsGetMonthKeys) return null;
      const result = await api.transactionsGetMonthKeys();
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async aggregateRange(startMs: number, endMs: number) {
    try {
      const api = getTxApi();
      if (!api?.transactionsAggregateRange) return null;
      const result = await api.transactionsAggregateRange({ startMs, endMs });
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async aggregateYearly() {
    try {
      const api = getTxApi();
      if (!api?.transactionsAggregateYearly) return null;
      const result = await api.transactionsAggregateYearly();
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async loadByMonth(monthKey: string): Promise<SourceDataResult | null> {
    try {
      const api = getTxApi();
      if (!api?.transactionsGetByMonth) return null;
      const result = await api.transactionsGetByMonth(monthKey);
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async getMonthlyTotals() {
    try {
      const api = getTxApi();
      if (!api?.transactionsGetMonthlyTotals) return null;
      const result = await api.transactionsGetMonthlyTotals();
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async queryTableRows(
    query: import('../../shared/transactionQueryTypes').TransactionsTableRowsQuery
  ) {
    try {
      const api = getTxApi();
      if (!api?.transactionsQueryTableRows) return null;
      const result = await api.transactionsQueryTableRows(query);
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async getSuggestValues(): Promise<{
    titles: string[];
    types: string[];
    accounts: string[];
  } | null> {
    try {
      const api = getTxApi();
      if (!api?.transactionsGetSuggestValues) return null;
      const result = await api.transactionsGetSuggestValues();
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async aggregateAnnualBudgetYear(year: number) {
    try {
      const api = getTxApi();
      if (!api?.transactionsAggregateAnnualBudgetYear) return null;
      const result = await api.transactionsAggregateAnnualBudgetYear(year);
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async refreshGbpRates(rates: {
    eurToGbp: number;
    chfToGbp: number;
  }): Promise<{ success: boolean; error?: string; rowCount: number; updatedCount: number }> {
    try {
      const api = getTxApi();
      if (!api?.transactionsRefreshGbpRates) {
        return { success: false, error: i18n.t('system.apiUnavailable', { name: 'transactionsRefreshGbpRates' }), rowCount: 0, updatedCount: 0 };
      }
      return await api.transactionsRefreshGbpRates(rates);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, rowCount: 0, updatedCount: 0 };
    }
  }

  static async refreshPrimaryRates(rates: {
    primary: string;
    ratesToPrimary: Record<string, number>;
  }): Promise<{ success: boolean; error?: string; rowCount: number; updatedCount: number }> {
    try {
      const api = getTxApi();
      if (api?.transactionsRefreshPrimaryRates) {
        return await api.transactionsRefreshPrimaryRates(rates);
      }
      if (api?.transactionsRefreshGbpRates) {
        return await api.transactionsRefreshGbpRates({
          eurToGbp: rates.ratesToPrimary.EUR ?? 0.86,
          chfToGbp: rates.ratesToPrimary.CHF ?? 0.95,
        });
      }
      return { success: false, error: i18n.t('system.apiUnavailable', { name: 'refresh rates' }), rowCount: 0, updatedCount: 0 };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, rowCount: 0, updatedCount: 0 };
    }
  }

  static async detectAnomalies(payload: {
    recognisedAccountLabels: string[];
    recognisedEntryTypes: string[];
    recognisedOutputTypes: string[];
    writeReport?: boolean;
  }): Promise<import('@/shared/transactionQueryTypes').DetectAnomaliesResultDto | null> {
    try {
      const api = getTxApi();
      if (!api?.transactionsDetectAnomalies) return null;
      const result = await api.transactionsDetectAnomalies(payload);
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async mergeMonthEdit(
    monthKey: string,
    rows: Record<string, string>[]
  ): Promise<{ success: boolean; error?: string; count: number }> {
    try {
      const api = getTxApi();
      if (!api?.transactionsMergeMonthEdit) {
        return { success: false, error: i18n.t('system.apiUnavailable', { name: 'transactionsMergeMonthEdit' }), count: 0 };
      }
      return await api.transactionsMergeMonthEdit({ monthKey, rows });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, count: 0 };
    }
  }

  static async getRowSignatures(
    accountEntries?: Array<{ name: string; aliases?: string[] }>
  ): Promise<string[] | null> {
    try {
      const api = getTxApi();
      if (!api?.transactionsGetRowSignatures) return null;
      const result = await api.transactionsGetRowSignatures({ accountEntries });
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async getAnomalyExceptions(): Promise<SourceDataResult | null> {
    try {
      const api = getTxApi();
      if (!api?.transactionsGetAnomalyExceptions) return null;
      const result = await api.transactionsGetAnomalyExceptions();
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async clearAnomalyException(idx: number): Promise<{ success: boolean; error?: string }> {
    try {
      const api = getTxApi();
      if (!api?.transactionsClearAnomalyException) {
        return { success: false, error: i18n.t('system.apiUnavailable', { name: 'transactionsClearAnomalyException' }) };
      }
      return await api.transactionsClearAnomalyException(idx);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /** Persiste toutes les lignes dans SQLite (+ miroir CSV). */
  static async replaceAll(rows: Record<string, string>[]): Promise<{ success: boolean; error?: string }> {
    try {
      const api = getTxApi();
      if (!api?.transactionsReplaceAll) {
        return { success: false, error: i18n.t('system.apiUnavailable', { name: 'transactionsReplaceAll' }) };
      }
      const result = await api.transactionsReplaceAll(rows);
      return { success: result.success, error: result.error };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
}

/** Conserve l’ordre des lignes ; réattribue Index 1, 2, 3, … (même logique que le tableau des transactions). */
export function normalizeOrderAndIndex(source: SourceDataResult): SourceDataResult {
  const headers = source.headers;
  const dataCols = headers.filter((h) => !/^index$/i.test(h));
  const rowsNonEmpty = source.rows.filter((row) => !isSourceDataRowEmpty(row, dataCols));
  const indexCol = headers.find((h) => /^index$/i.test(h)) ?? 'Index';
  const firstDataRowIndex = 1;
  const rows = rowsNonEmpty.map((row, i) => ({ ...row, [indexCol]: String(firstDataRowIndex + i) }));
  return { ...source, rows };
}

/**
 * Trie les lignes par la colonne Date (chronologie), puis réattribue Index 1…n (même règle que l’import : dates invalides en fin).
 */
export function sortSourceDataByDateChronology(source: SourceDataResult): SourceDataResult {
  const dateKey = source.headers.find((h) => /^date$/i.test(h));
  if (!dateKey) {
    return normalizeOrderAndIndex(source);
  }
  const indexKey = source.headers.find((h) => /^index$/i.test(h)) ?? 'Index';
  const rows = [...source.rows].sort((a, b) => {
    const ta = parseDateToTime(String(a[dateKey] ?? '').trim());
    const tb = parseDateToTime(String(b[dateKey] ?? '').trim());
    if (ta === 0 && tb !== 0) return 1;
    if (tb === 0 && ta !== 0) return -1;
    if (ta !== tb) return ta - tb;
    const ia = parseInt(String(a[indexKey] ?? '').replace(/\D/g, ''), 10);
    const ib = parseInt(String(b[indexKey] ?? '').replace(/\D/g, ''), 10);
    return (Number.isFinite(ia) ? ia : 0) - (Number.isFinite(ib) ? ib : 0);
  });
  return normalizeOrderAndIndex({ ...source, rows });
}
