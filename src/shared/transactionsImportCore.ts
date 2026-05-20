/**
 * Logique partagée import transactions (renderer + processus principal).
 * Pas d’accès fichiers ici.
 */

import { EXCLUDE_ANOMALY_COLUMN } from './excludeAnomalyColumn';
import { TRANSACTION_SOURCE_COLUMN } from './transactionRowSource';
import {
  applyImportFiatResolutionToValueMap,
  applyValidRowPostProcessMappingPolicy,
  DEFAULT_IMPORT_MAPPING_RATES,
  parseAmountNumericForImport,
  type ParseImportCsvOptions,
} from './transactionsImportMappingPolicy';

export type { ParseImportCsvOptions } from './transactionsImportMappingPolicy';

/** En-têtes du fichier src_transaction_data.csv (colonne AMOUNT GBP : négatif = dépense, positif = revenu). */
export const TRANSACTION_PROJET_COLUMN = 'PROJET';

export const OUTPUT_HEADERS = [
  'INDEX',
  'DATE',
  'TITLE',
  'AMOUNT',
  'CURRENCY',
  'ACCOUNT',
  'AMOUNT GBP',
  'TYPE',
  TRANSACTION_PROJET_COLUMN,
  EXCLUDE_ANOMALY_COLUMN,
] as const;

/** En-têtes reconnus à l'import (fichiers peuvent avoir EXPENSE et INCOME séparés). */
export const IMPORT_HEADERS = ['INDEX', 'DATE', 'TITLE', 'AMOUNT', 'CURRENCY', 'ACCOUNT', 'EXPENSE', 'INCOME', 'TYPE'];

/** Mappe un en-tête import vers le nom standard (sans INDEX). */
const HEADER_MAP: Record<string, string> = {
  date: 'DATE',
  titre: 'TITLE',
  title: 'TITLE',
  libellé: 'TITLE',
  libelle: 'TITLE',
  description: 'TITLE',
  account: 'ACCOUNT',
  compte: 'ACCOUNT',
  expense: 'EXPENSE',
  depense: 'EXPENSE',
  dépense: 'EXPENSE',
  debit: 'EXPENSE',
  débit: 'EXPENSE',
  debited: 'AMOUNT',
  'eur/gbp': 'CURRENCY',
  income: 'INCOME',
  revenu: 'INCOME',
  credit: 'INCOME',
  crédit: 'INCOME',
  'amount gbp': 'AMOUNT GBP',
  montant: 'AMOUNT GBP',
  type: 'TYPE',
  category: 'TYPE',
  categorie: 'TYPE',
  source: TRANSACTION_SOURCE_COLUMN,
  projet: TRANSACTION_PROJET_COLUMN,
  project: TRANSACTION_PROJET_COLUMN,
  eur: 'AMOUNT',
  amount: 'AMOUNT',
  fx: 'CURRENCY',
  currency: 'CURRENCY',
};

export function normalizeHeader(h: string): string {
  const s = (h ?? '').replace(/^\uFEFF/, '').trim();
  return s;
}

export function mapToStandardHeader(norm: string): string | null {
  if (/^index$/i.test(norm)) return null;
  const fromMap = HEADER_MAP[norm.toLowerCase()];
  if (fromMap) return fromMap;
  if ((OUTPUT_HEADERS as readonly string[]).includes(norm) || IMPORT_HEADERS.includes(norm)) return norm;
  return null;
}

/** Indique si la première ligne semble être une ligne d'en-tête (noms de colonnes) plutôt que des données. */
export function firstLineLooksLikeHeader(firstLineValues: string[]): boolean {
  const mapped = firstLineValues.map((v) => mapToStandardHeader(normalizeHeader(v)));
  const hasKnownHeader = mapped.some((std) => std !== null);
  if (!hasKnownHeader) return false;
  const firstCell = (firstLineValues[0] ?? '').trim();
  const firstLooksLikeDate = parseDateToTime(firstCell) > 0;
  const firstLooksLikeNumber = parseAmountNumericForImport(firstCell ?? '') !== null;
  if (firstLooksLikeDate || (firstLooksLikeNumber && firstLineValues.length <= 3)) return false;
  return true;
}

/** Parse une date ISO ou DD/MM/YYYY ou DD.MM.YYYY ou DD.MM.YY → timestamp ou 0 si invalide. */
export function parseDateToTime(s: string): number {
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

/** Formate une date en DD.MM.YY pour le CSV de sortie. */
export function formatDateDDMMYY(s: string): string {
  const raw = (s ?? '').trim();
  if (!raw) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})/;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
  let day: number, month: number, year: number;
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
  const d = String(day).padStart(2, '0');
  const m = String(month).padStart(2, '0');
  const y = String(year).slice(-2);
  return `${d}.${m}.${y}`;
}

/** Normalise un montant : virgule décimale, signe négatif autorisé (AMOUNT). Retourne la chaîne ou null si invalide. */
export function normalizeAmount(s: string): string | null {
  const raw = (s ?? '').trim().replace(/\s/g, '').replace(/[£€$]/g, '');
  if (raw === '') return '';
  const num = parseAmountNumericForImport(s);
  if (num === null || Number.isNaN(num)) return null;
  return String(num).replace('.', ',');
}

export interface AnomalyRow {
  sourceFile: string;
  lineNumber: number;
  reason: string;
  row: Record<string, string>;
  rawLine: string;
}

export interface ValidRow {
  DATE: string;
  TITLE: string;
  AMOUNT: string;
  CURRENCY: string;
  ACCOUNT: string;
  'AMOUNT GBP': string;
  TYPE: string;
  [TRANSACTION_PROJET_COLUMN]?: string;
  [EXCLUDE_ANOMALY_COLUMN]?: string;
}

export function emptyRow(): ValidRow {
  return {
    DATE: '',
    TITLE: '',
    AMOUNT: '',
    CURRENCY: '',
    ACCOUNT: '',
    'AMOUNT GBP': '',
    TYPE: '',
    [TRANSACTION_PROJET_COLUMN]: '',
    [EXCLUDE_ANOMALY_COLUMN]: '',
  };
}

/** Signature d'une ligne pour la détection de doublons (même transaction = même DATE, TITLE, montants, compte). */
export function rowSignature(row: ValidRow): string {
  const d = (row.DATE ?? '').trim();
  const t = (row.TITLE ?? '').trim();
  const amt = (row.AMOUNT ?? '').trim();
  const amtGbp = (row['AMOUNT GBP'] ?? '').trim();
  const acc = (row.ACCOUNT ?? '').trim();
  return `${d}|${t}|${amt}|${amtGbp}|${acc}`;
}

export function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      current += c;
    } else if (c === delimiter) {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

function inferDateColumnIndex(lines: string[][]): number {
  let bestIdx = 0;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    let dateCount = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      if (parseDateToTime(v) > 0) dateCount++;
    }
    if (filled > 0 && dateCount / filled > bestScore) {
      bestScore = dateCount / filled;
      bestIdx = c;
    }
  }
  return bestScore >= 0.5 ? bestIdx : -1;
}

function inferTitleColumnIndex(lines: string[][], dateCol: number): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (c === dateCol) continue;
    let textLike = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      const isDate = parseDateToTime(v) > 0;
      const isNum = parseAmountNumericForImport(v) !== null;
      if (!isDate && (!isNum || v.length > 6)) textLike++;
    }
    if (filled >= 2 && textLike / filled > bestScore) {
      bestScore = textLike / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}

function inferEurColumnIndex(lines: string[][], exclude: Set<number> = new Set()): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let withEur = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      if (/€|eur/i.test(v) || (normalizeAmount(v) !== null && v.length >= 4)) withEur++;
    }
    if (filled > 0 && withEur / filled > bestScore) {
      bestScore = withEur / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}

function inferFxColumnIndex(lines: string[][], exclude: Set<number> = new Set()): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let fxLike = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      const n = parseFloat(v.replace(/,/, '.'));
      if (!Number.isNaN(n) && n >= 0.5 && n <= 2 && v.length <= 6) fxLike++;
    }
    if (filled > 0 && fxLike / filled > bestScore) {
      bestScore = fxLike / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}

function inferAccountColumnIndex(lines: string[][], exclude: Set<number> = new Set()): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let shortText = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      const isNum = parseAmountNumericForImport(v) !== null;
      if (!isNum && v.length >= 2 && v.length <= 20) shortText++;
    }
    if (filled > 0 && shortText / filled > bestScore) {
      bestScore = shortText / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}

function inferExpenseColumnIndex(lines: string[][], exclude: Set<number> = new Set()): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let expenseLike = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      if (/£|gbp|expense|debit|débit|depense/i.test(v) || normalizeAmount(v) !== null) expenseLike++;
    }
    if (filled > 0 && expenseLike / filled > bestScore) {
      bestScore = expenseLike / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}

function inferIncomeColumnIndex(lines: string[][], expenseCol: number, exclude: Set<number> = new Set()): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (c === expenseCol || exclude.has(c)) continue;
    let incomeLike = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      if (/£|gbp|income|credit|crédit|revenu/i.test(v) || normalizeAmount(v) !== null) incomeLike++;
    }
    if (filled > 0 && incomeLike / filled > bestScore) {
      bestScore = incomeLike / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}

function inferTypeColumnIndex(lines: string[][], exclude: Set<number> = new Set()): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let textLike = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      const isNum = parseAmountNumericForImport(v) !== null;
      if (!isNum && v.length <= 30) textLike++;
    }
    if (filled > 0 && textLike / filled > bestScore) {
      bestScore = textLike / filled;
      bestIdx = c;
    }
  }
  return bestIdx;
}

/** Infère le mapping colonne index → standard header à partir des lignes de données (sans en-tête). */
export function inferColumnMapping(parsed: string[][]): Map<number, number> {
  const colToStandardIdx = new Map<number, number>();
  if (parsed.length === 0) return colToStandardIdx;

  const used = new Set<number>();

  const dateCol = inferDateColumnIndex(parsed);
  if (dateCol >= 0) {
    colToStandardIdx.set(dateCol, IMPORT_HEADERS.indexOf('DATE'));
    used.add(dateCol);
  }

  const titleCol = inferTitleColumnIndex(parsed, dateCol);
  if (titleCol >= 0) {
    colToStandardIdx.set(titleCol, IMPORT_HEADERS.indexOf('TITLE'));
    used.add(titleCol);
  }

  const eurCol = inferEurColumnIndex(parsed, used);
  if (eurCol >= 0) {
    colToStandardIdx.set(eurCol, IMPORT_HEADERS.indexOf('AMOUNT'));
    used.add(eurCol);
  }

  const fxCol = inferFxColumnIndex(parsed, used);
  if (fxCol >= 0) {
    colToStandardIdx.set(fxCol, IMPORT_HEADERS.indexOf('CURRENCY'));
    used.add(fxCol);
  }

  const accountCol = inferAccountColumnIndex(parsed, used);
  if (accountCol >= 0) {
    colToStandardIdx.set(accountCol, IMPORT_HEADERS.indexOf('ACCOUNT'));
    used.add(accountCol);
  }

  const expenseCol = inferExpenseColumnIndex(parsed, used);
  if (expenseCol >= 0) {
    colToStandardIdx.set(expenseCol, IMPORT_HEADERS.indexOf('EXPENSE'));
    used.add(expenseCol);
  }

  const incomeCol = inferIncomeColumnIndex(parsed, expenseCol, used);
  if (incomeCol >= 0) {
    colToStandardIdx.set(incomeCol, IMPORT_HEADERS.indexOf('INCOME'));
    used.add(incomeCol);
  }

  const typeCol = inferTypeColumnIndex(parsed, used);
  if (typeCol >= 0) colToStandardIdx.set(typeCol, IMPORT_HEADERS.indexOf('TYPE'));

  return colToStandardIdx;
}

/**
 * Mapping colonne → champ standard uniquement par inférence sur les lignes de données.
 * Les libellés de la première ligne ne servent pas au mapping (même si elle ressemble à un en-tête CSV).
 */
export function inferColumnMappingFromDataLines(
  lines: string[],
  delimiter: string,
  dataStartIndex: number
): Map<number, string> {
  const dataLines = lines
    .slice(dataStartIndex)
    .map((line) => parseCsvLine(line, delimiter))
    .filter((row) => row.some((cell) => (cell ?? '').trim() !== ''));
  if (dataLines.length === 0) {
    return new Map<number, string>();
  }
  const colToStandardIdx = inferColumnMapping(dataLines);
  const colToStandardName = new Map<number, string>();
  colToStandardIdx.forEach((stdIdx: number, colIdx: number) => {
    const name = stdIdx < IMPORT_HEADERS.length ? IMPORT_HEADERS[stdIdx] : OUTPUT_HEADERS[stdIdx];
    if (name && name !== 'INDEX') colToStandardName.set(colIdx, name);
  });
  return colToStandardName;
}

export function processImportRow(
  sourceFile: string,
  lineNumber: number,
  _values: string[],
  valueByStandardName: Record<string, string>,
  rawLine: string
): { valid: ValidRow } | { anomaly: AnomalyRow } {
  const row = emptyRow();
  row.DATE = (valueByStandardName.DATE ?? '').trim();
  row.TITLE = (valueByStandardName.TITLE ?? '').trim();
  row.AMOUNT = (valueByStandardName.AMOUNT ?? valueByStandardName.EUR ?? '').trim();
  row.CURRENCY = (valueByStandardName.CURRENCY ?? valueByStandardName.FX ?? '').trim();
  row.ACCOUNT = (valueByStandardName.ACCOUNT ?? '').trim();
  row.TYPE = (valueByStandardName.TYPE ?? '').trim();
  row[TRANSACTION_PROJET_COLUMN] = (valueByStandardName[TRANSACTION_PROJET_COLUMN] ?? '').trim();

  const reasons: string[] = [];
  const dateNorm = formatDateDDMMYY(row.DATE);
  const dateTime = parseDateToTime(row.DATE);
  if (!row.DATE.trim()) reasons.push('Date manquante');
  else if (dateTime === 0) reasons.push('Date invalide');
  else {
    row.DATE = dateNorm;
  }

  if (!row.TITLE.trim()) reasons.push('Libellé (TITLE) manquant');

  if ((valueByStandardName['AMOUNT GBP'] ?? '').trim()) {
    const amtNorm = normalizeAmount(valueByStandardName['AMOUNT GBP']!);
    if (amtNorm === null) reasons.push('Montant (AMOUNT GBP) non numérique');
    else row['AMOUNT GBP'] = amtNorm;
  } else {
    const expNorm = normalizeAmount(valueByStandardName.EXPENSE ?? '');
    if ((valueByStandardName.EXPENSE ?? '').trim() && expNorm === null) reasons.push('Dépense (EXPENSE) non numérique');
    const incNorm = normalizeAmount(valueByStandardName.INCOME ?? '');
    if ((valueByStandardName.INCOME ?? '').trim() && incNorm === null) reasons.push('Revenu (INCOME) non numérique');
    row['AMOUNT GBP'] = (incNorm ?? '').trim() ? incNorm! : (expNorm ?? '').trim() ? '-' + expNorm! : '';
  }

  const amountNorm = normalizeAmount(row.AMOUNT);
  if (row.AMOUNT.trim() && amountNorm === null) reasons.push('AMOUNT non numérique');
  else if (amountNorm !== null) row.AMOUNT = amountNorm;

  const curRaw = (row.CURRENCY ?? '').trim();
  const curUp = curRaw.toUpperCase();
  if (curUp === 'EUR' || curUp === 'GBP' || curUp === 'CHF') {
    row.CURRENCY = curUp;
  } else {
    const currencyNorm = normalizeAmount(row.CURRENCY);
    if (row.CURRENCY.trim() && currencyNorm === null) reasons.push('CURRENCY non numérique');
    else if (currencyNorm !== null) row.CURRENCY = currencyNorm;
  }

  const isEmpty = OUTPUT_HEADERS.slice(1).every((h) => !(row as unknown as Record<string, string>)[h]?.trim());
  if (isEmpty) reasons.push('Ligne vide');

  if (reasons.length > 0) {
    return {
      anomaly: {
        sourceFile,
        lineNumber,
        reason: reasons.join(' ; '),
        row: { ...row },
        rawLine,
      },
    };
  }
  return { valid: row };
}

export interface ValidRowWithContext {
  row: ValidRow;
  sourceFile: string;
  lineNumber: number;
  rawLine: string;
}

export function parseImportCsv(
  content: string,
  sourceFile: string,
  delimiter: ';' | ',' = ';',
  options?: ParseImportCsvOptions
): { valid: ValidRowWithContext[]; anomalies: AnomalyRow[] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  const valid: ValidRowWithContext[] = [];
  const anomalies: AnomalyRow[] = [];

  if (lines.length === 0) return { valid, anomalies };

  const rates = options?.importMappingRates ?? DEFAULT_IMPORT_MAPPING_RATES;
  const fiatChoiceByRowId = options?.fiatChoiceByRowId ?? {};

  const firstLineValues = parseCsvLine(lines[0], delimiter);
  const useFirstLineAsHeader = firstLineLooksLikeHeader(firstLineValues);
  const dataStartIndex = useFirstLineAsHeader && lines.length >= 2 ? 1 : 0;
  const colToStandardName = inferColumnMappingFromDataLines(lines, delimiter, dataStartIndex);

  for (let i = dataStartIndex; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;
    const values = parseCsvLine(rawLine, delimiter);
    const valueByStandardName: Record<string, string> = {};
    colToStandardName.forEach((stdName, colIdx) => {
      valueByStandardName[stdName] = (values[colIdx] ?? '').trim();
    });

    const rowId = `${sourceFile}:${i + 1}`;
    const fiatEffective = applyImportFiatResolutionToValueMap(valueByStandardName, rowId, fiatChoiceByRowId);

    const dataLineNumber = i - dataStartIndex + 1;
    const result = processImportRow(sourceFile, dataLineNumber, values, valueByStandardName, rawLine);
    if ('valid' in result) {
      const row = applyValidRowPostProcessMappingPolicy(result.valid, fiatEffective, rates, {
        expenseRaw: valueByStandardName.EXPENSE ?? '',
        incomeRaw: valueByStandardName.INCOME ?? '',
      });
      valid.push({ row, sourceFile, lineNumber: dataLineNumber, rawLine });
    } else anomalies.push(result.anomaly);
  }

  return { valid, anomalies };
}

export function rowToCsvLine(row: ValidRow, index: number): string {
  return [
    index,
    row.DATE,
    row.TITLE,
    row.AMOUNT,
    row.CURRENCY,
    row.ACCOUNT,
    row['AMOUNT GBP'],
    row.TYPE,
    row[TRANSACTION_PROJET_COLUMN] ?? '',
    row[EXCLUDE_ANOMALY_COLUMN] ?? '',
  ].join(';');
}

export function sortByDate(rows: ValidRow[]): void {
  rows.sort((a, b) => {
    const ta = parseDateToTime(a.DATE);
    const tb = parseDateToTime(b.DATE);
    if (ta === 0 && tb !== 0) return 1;
    if (tb === 0 && ta !== 0) return -1;
    return ta - tb;
  });
}

/** Champs src_transaction_data pouvant être ajoutés manuellement via le mapping wizard (colonnes calculées). */
export const WIZARD_STANDARD_KEYS = [
  '',
  'DATE',
  'TITLE',
  'AMOUNT',
  'CURRENCY',
  'ACCOUNT',
  'AMOUNT GBP',
  'TYPE',
  TRANSACTION_PROJET_COLUMN,
  'EXPENSE',
  'INCOME',
] as const;

export type WizardStandardKey = (typeof WIZARD_STANDARD_KEYS)[number];

export function detectDelimiter(firstLine: string): ';' | ',' {
  const sc = (firstLine.match(/;/g) ?? []).length;
  const cc = (firstLine.match(/,/g) ?? []).length;
  return cc > sc ? ',' : ';';
}

/** CSV classique ou tabulations (collage depuis tableur). */
export function detectDelimiterForWizardFirstLine(firstLine: string): ';' | ',' | '\t' {
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const sc = (firstLine.match(/;/g) ?? []).length;
  const cc = (firstLine.match(/,/g) ?? []).length;
  if (tabs > 0 && tabs >= sc && tabs >= cc) return '\t';
  return cc > sc ? ',' : ';';
}
