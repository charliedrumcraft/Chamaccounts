/**
 * Charge et parse le CSV data/TransactionsData/Processed/src_transaction_data.csv pour le tableau des transactions.
 * Tableau dynamique : colonnes et lignes dérivées du fichier.
 * Les dates (DD/MM/YYYY ou DD.MM.YYYY) sont normalisées en DD.MM.YYYY.
 * L’ordre des lignes suit le fichier (pas de tri) pour préserver la chronologie et la détection d’anomalies.
 */

import { FileService } from './FileService';
import { formatDateDDMMYYYY } from '../utils/format';
import { SOURCE_DATA_PATH, SUPPORT_DATA_CSV_PATH } from '@/shared/dataPaths';
import { EXCLUDE_ANOMALY_COLUMN } from '@/shared/excludeAnomalyColumn';
import { TRANSACTION_SOURCE_COLUMN } from '@/shared/transactionRowSource';
import { parseDateToTime } from '@/shared/transactionsImportCore';
import Papa from 'papaparse';

/** Chemin du fichier source pour l’édition (sauvegarde depuis le tableau). */
export { SOURCE_DATA_PATH };

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

export interface SourceDataResult {
  headers: string[];
  rows: Record<string, string>[];
  /**
   * Optionnel : pour chaque ligne rows[i], index de cette ligne dans le data_source complet.
   * Utilisé par les rapports d'anomalies (ex. monthly) pour afficher l'index dans le fichier source.
   */
  rowIndicesInSource?: number[];
}

/**
 * Parse le contenu d’un CSV transactions (même schéma que src_transaction_data.csv).
 * Utilisé pour src_transaction_data.csv et Support_data.csv.
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

/** Retire la colonne Source (src_transaction_data.csv n’en contient plus ; le soutien reste dans Support_data.csv). */
export function stripSourceColumnFromSourceData(result: SourceDataResult): SourceDataResult {
  const sourceKey = result.headers.find((h) => /^source$/i.test(h));
  if (!sourceKey) return result;
  const headers = result.headers.filter((h) => h !== sourceKey);
  const rows = result.rows.map((row) => {
    const { [sourceKey]: _removed, ...rest } = row;
    return rest;
  });
  return { ...result, headers, rows };
}

/** Fusionne deux jeux de lignes (ex. src + support) avec union des en-têtes (ex. Source uniquement côté support). */
function mergeSourceDataResults(
  main: SourceDataResult | null,
  support: SourceDataResult | null
): SourceDataResult | null {
  if (!main && !support?.rows?.length) return null;
  const hMain = main?.headers ?? [];
  const hSup = support?.headers ?? [];
  const dataColsMain = hMain.filter((h) => !/^index$/i.test(h));
  const dataColsSup = hSup.filter((h) => !/^index$/i.test(h));
  const seen = new Set<string>();
  const mergedDataCols: string[] = [];
  for (const h of [...dataColsMain, ...dataColsSup]) {
    if (!seen.has(h)) {
      seen.add(h);
      mergedDataCols.push(h);
    }
  }
  const headers = ['Index', ...mergedDataCols];
  const padRow = (row: Record<string, string>): Record<string, string> => {
    const o: Record<string, string> = {};
    for (const h of headers) {
      o[h] = (row[h] ?? '').toString();
    }
    return o;
  };
  const rows = [...(main?.rows ?? []).map(padRow), ...(support?.rows ?? []).map(padRow)];
  return normalizeOrderAndIndex({ headers, rows });
}

export class SourceDataCSVService {
  static async load(): Promise<SourceDataResult | null> {
    try {
      const content = await FileService.readFile(SOURCE_DATA_PATH);
      if (!content?.trim()) return null;
      return parseSourceTransactionCsvContent(content);
    } catch {
      return null;
    }
  }

  /**
   * Fusionne src_transaction_data.csv et Support_data.csv (ordre : src puis soutien).
   */
  static async loadMergedWithSupport(): Promise<SourceDataResult | null> {
    const main = await SourceDataCSVService.load();
    let supportContent: string | null = null;
    try {
      supportContent = await FileService.readFile(SUPPORT_DATA_CSV_PATH);
    } catch {
      supportContent = null;
    }
    const supportParsed = supportContent?.trim() ? parseSourceTransactionCsvContent(supportContent) : null;
    return mergeSourceDataResults(main, supportParsed);
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
