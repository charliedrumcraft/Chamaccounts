/**
 * Charge et parse le CSV data/TransactionsData/Processed/source_data.csv pour le tableau des transactions.
 * Tableau dynamique : colonnes et lignes dérivées du fichier.
 * Les dates (DD/MM/YYYY ou DD.MM.YYYY) sont normalisées en DD.MM.YYYY.
 */

import { FileService } from './FileService';
import { formatDateDDMMYYYY } from '../utils/format';
import Papa from 'papaparse';

const SOURCE_DATA_PATH = 'data/TransactionsData/Processed/source_data.csv';

/** Chemin du fichier source pour l’édition (sauvegarde depuis le tableau). */
export { SOURCE_DATA_PATH };

/** Colonnes à ne pas afficher (toujours masquées, même si des lignes ont des valeurs). */
const HIDDEN_COLUMNS = new Set<string>();

/** Colonne index du CSV ignorée ; on génère notre propre index basé sur la date. */
function isIndexColumn(norm: string): boolean {
  return norm.toLowerCase().startsWith('index');
}

function parseDateToTime(s: string): number {
  const raw = (s ?? '').trim();
  if (!raw) return 0;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
  const mi = raw.match(iso);
  if (mi) {
    const y = parseInt(mi[1], 10);
    const m = parseInt(mi[2], 10);
    const d = parseInt(mi[3], 10);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  const md = raw.match(dmy);
  if (md) {
    const d = parseInt(md[1], 10);
    const m = parseInt(md[2], 10);
    const yy =
      md[3].length === 2
        ? parseInt(md[3], 10) < 50
          ? 2000 + parseInt(md[3], 10)
          : 1900 + parseInt(md[3], 10)
        : parseInt(md[3], 10);
    const date = new Date(yy, m - 1, d);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  return 0;
}

function normalizeHeader(h: string | undefined): string {
  const s = (h ?? '').replace(/^\uFEFF/, '').trim();
  return s;
}

function isDateColumn(header: string): boolean {
  return /date/i.test(header);
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

export class SourceDataCSVService {
  static async load(): Promise<SourceDataResult | null> {
    let content: string;
    try {
      content = await FileService.readFile(SOURCE_DATA_PATH);
    } catch {
      return null;
    }
    if (!content?.trim()) return null;

    return new Promise((resolve) => {
      Papa.parse(content, {
        header: true,
        delimiter: ';',
        skipEmptyLines: true,
        complete: (results) => {
          const fields = results.meta.fields ?? [];
          const rawData = results.data as Record<string, string>[];
          // Exclure toute ligne qui répète les noms de colonnes (header) pour ne pas la compter comme donnée
          const data = rawData.filter(
            (row) =>
              !fields.every((f) => (row[f] ?? '').toString().trim() === (f ?? '').trim())
          );
          if (!fields.length || !data.length) {
            resolve(null);
            return;
          }
          const kept = fields
            .map((orig) => ({ orig, norm: normalizeHeader(orig) }))
            .filter(
              ({ orig, norm }) =>
                norm &&
                !HIDDEN_COLUMNS.has(norm) &&
                !isIndexColumn(norm) &&
                data.some((row) => (row[orig] ?? '').toString().trim() !== '')
            );
          const headersFromCsv = kept.map((x) => x.norm);
          if (!headersFromCsv.length) {
            resolve(null);
            return;
          }
          const dateCol = headersFromCsv.find((h) => /date/i.test(h)) ?? null;
          const accountCol = headersFromCsv.find((h) => /^account$/i.test(h) || /compte/i.test(h)) ?? null;
          const typeCol = headersFromCsv.find((h) => /^type$/i.test(h)) ?? null;
          const titleCol = headersFromCsv.find((h) => /^title$/i.test(h)) ?? null;
          let rows = data.map((row) => {
            const r: Record<string, string> = {};
            kept.forEach(({ orig, norm }) => {
              const raw = (row[orig] ?? '').toString();
              r[norm] = isDateColumn(norm) ? formatDateDDMMYYYY(raw) : raw;
            });
            return r;
          });
          // Tri : date (ancienne → récente), puis Account, Type, Title (alphabétique)
          rows = rows.sort((a, b) => {
            const ta = parseDateToTime(dateCol ? a[dateCol] ?? '' : '');
            const tb = parseDateToTime(dateCol ? b[dateCol] ?? '' : '');
            if (ta !== tb) return ta - tb;
            const accA = (accountCol ? (a[accountCol] ?? '') : '').trim().toLowerCase();
            const accB = (accountCol ? (b[accountCol] ?? '') : '').trim().toLowerCase();
            const cmpAcc = accA.localeCompare(accB, undefined, { sensitivity: 'base' });
            if (cmpAcc !== 0) return cmpAcc;
            const typeA = (typeCol ? (a[typeCol] ?? '') : '').trim().toLowerCase();
            const typeB = (typeCol ? (b[typeCol] ?? '') : '').trim().toLowerCase();
            const cmpType = typeA.localeCompare(typeB, undefined, { sensitivity: 'base' });
            if (cmpType !== 0) return cmpType;
            const titleA = (titleCol ? (a[titleCol] ?? '') : '').trim().toLowerCase();
            const titleB = (titleCol ? (b[titleCol] ?? '') : '').trim().toLowerCase();
            return titleA.localeCompare(titleB, undefined, { sensitivity: 'base' });
          });
          // Index : première ligne de donnée = 1 (sans compter le header), puis 2, 3, ...
          const INDEX_HEADER = 'Index';
          const firstDataRowIndex = 1;
          rows = rows.map((row, i) => ({ ...row, [INDEX_HEADER]: String(firstDataRowIndex + i) }));
          const headers = [INDEX_HEADER, ...headersFromCsv];
          resolve({
            headers,
            rows,
          });
        },
      });
    });
  }
}
