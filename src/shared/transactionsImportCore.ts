/**
 * Logique partagée import transactions (renderer + processus principal).
 * Pas d’accès fichiers ici.
 */

import { EXCLUDE_ANOMALY_COLUMN } from './excludeAnomalyColumn';
import { SOUTIEN_IGNORE_COLUMN } from './soutienIgnoreColumn';
import { TRANSACTION_SOURCE_COLUMN } from './transactionRowSource';
import {
  resolveAccountForDuplicateSignature,
} from './accountAliasForDuplicates';
import {
  applyImportFiatResolutionToValueMap,
  applyValidRowPostProcessMappingPolicy,
  DEFAULT_IMPORT_MAPPING_RATES,
  parseAmountNumericForImport,
  type ParseImportCsvOptions,
} from './transactionsImportMappingPolicy';

export type { AccountAliasEntry } from './accountAliasForDuplicates';
export { buildAccountAliasLookup } from './accountAliasForDuplicates';

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
  SOUTIEN_IGNORE_COLUMN,
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
  exclure_anomalie: EXCLUDE_ANOMALY_COLUMN,
  soutien_ignorer: SOUTIEN_IGNORE_COLUMN,
};

export function normalizeHeader(h: string): string {
  const s = (h ?? '').replace(/^\uFEFF/, '').trim();
  return s;
}

export function mapToStandardHeader(norm: string): string | null {
  if (/^index$/i.test(norm)) return null;
  const lower = norm.toLowerCase().trim();
  const fromMap = HEADER_MAP[lower];
  if (fromMap) return fromMap;
  // Exports bancaires courants (N26, etc.)
  if (/booking\s*date|date\s*de\s*comptabilisation|date\s*d['’]?op[eé]ration|date\s*operation/i.test(lower)) {
    return 'DATE';
  }
  if (/^value\s*date$|date\s*de\s*valeur/i.test(lower)) return 'DATE';
  if (/partner\s*name|beneficiary|counterparty|nom\s*du\s*partenaire/i.test(lower)) return 'TITLE';
  if (/account\s*name|nom\s*du\s*compte/i.test(lower)) return 'ACCOUNT';
  if (/^amount\s*\(\s*[a-z]{3}\s*\)$/i.test(lower)) return 'AMOUNT';
  if (/^amount\s+[a-z]{3}$/i.test(lower)) return 'AMOUNT GBP';
  if (/original\s*currency/i.test(lower)) return 'CURRENCY';
  if ((OUTPUT_HEADERS as readonly string[]).includes(norm) || IMPORT_HEADERS.includes(norm)) return norm;
  return null;
}

/**
 * Suggestion de mapping depuis un libellé d'en-tête pour l'auto-mapping wizard.
 * TYPE est inclus s'il est présent (CSV pré-édité) ; absent sinon → auto-catégorisation plus tard.
 */
export function suggestStandardFromHeaderLabel(headerLabel: string): string | null {
  const std = mapToStandardHeader(normalizeHeader(headerLabel));
  if (!std || std === 'INDEX') return null;
  return std;
}

/** Types d'opération bancaire (N26, etc.) — ne doivent pas être mappés vers TYPE (catégorie). */
const BANK_OPERATION_TYPE_RE =
  /^(presentment|credit\s*transfer|debit\s*transfer|card\s*payment|direct\s*debit|sepa(\s|$)|transfer|payment|fee|interest|atm|withdrawal|cash\s*withdrawal)$/i;

function columnLooksLikeBankOperationType(lines: string[][], col: number): boolean {
  let bankLike = 0;
  let filled = 0;
  for (const row of lines) {
    const v = (row[col] ?? '').trim();
    if (!v) continue;
    filled++;
    if (BANK_OPERATION_TYPE_RE.test(v)) bankLike++;
  }
  return filled > 0 && bankLike / filled >= 0.5;
}

/**
 * Devise implicite depuis un en-tête de montant bancaire, ex. « Amount (EUR) » → EUR.
 * Sert de repli quand la colonne CURRENCY est vide (exports N26, etc.).
 */
export function extractImpliedCurrencyFromHeaderLabel(headerLabel: string): string | null {
  const lower = normalizeHeader(headerLabel).toLowerCase().trim();
  const paren = lower.match(/^amount\s*\(\s*([a-z]{3})\s*\)$/i);
  if (paren) return paren[1]!.toUpperCase();
  const spaced = lower.match(/^amount\s+([a-z]{3})$/i);
  if (spaced) return spaced[1]!.toUpperCase();
  const fr = lower.match(/^montant\s*\(\s*([a-z]{3})\s*\)$/i);
  if (fr) return fr[1]!.toUpperCase();
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
  [SOUTIEN_IGNORE_COLUMN]?: string;
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
    [SOUTIEN_IGNORE_COLUMN]: '',
  };
}

export type RowSignatureOptions = {
  /** Alias compte (Paramètres + défauts import) : ex. HSBC → HSBC OBS. */
  accountAliasLookup?: ReadonlyMap<string, string>;
};

/**
 * Signature d'une ligne pour la détection de doublons.
 * - AMOUNT renseigné : DATE, TITLE, AMOUNT, ACCOUNT (AMOUNT GBP ignoré — taux FX variable entre import et app).
 * - AMOUNT vide : DATE, TITLE, AMOUNT GBP, ACCOUNT.
 * Les montants et comptes sont normalisés (ex. 200 ≡ 200,00 ; HSBC ≡ HSBC OBS si alias).
 */
function signatureAmountPart(raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return '';
  const norm = normalizeAmount(trimmed);
  return norm !== null ? norm : trimmed;
}

export function rowSignature(row: ValidRow, options?: RowSignatureOptions): string {
  const d = (row.DATE ?? '').trim();
  const t = (row.TITLE ?? '').trim();
  const amt = (row.AMOUNT ?? '').trim();
  const amtGbp = (row['AMOUNT GBP'] ?? '').trim();
  const acc = resolveAccountForDuplicateSignature(
    (row.ACCOUNT ?? '').trim(),
    options?.accountAliasLookup
  );
  if (amt !== '') {
    return `${d}|${t}|${signatureAmountPart(amt)}|${acc}`;
  }
  return `${d}|${t}|${signatureAmountPart(amtGbp)}|${acc}`;
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

/** True si la cellule est une date (à exclure des heuristiques de montants). */
function isDateLikeCell(v: string): boolean {
  return parseDateToTime(v) > 0;
}

const CURRENCY_CODE_RE =
  /^(EUR|GBP|CHF|USD|CAD|AUD|JPY|SEK|NOK|DKK|PLN|CZK|HUF|RON|BGN|TRY|MXN|BRL|INR|CNY|HKD|SGD|NZD|ZAR|AED|ILS)$/i;

function isCurrencyCodeCell(v: string): boolean {
  return CURRENCY_CODE_RE.test(v.trim());
}

/** Montant numérique utilisable (pas une date, pas un code devise). */
function isAmountLikeCell(v: string): boolean {
  const t = (v ?? '').trim();
  if (!t) return false;
  if (isDateLikeCell(t)) return false;
  if (isCurrencyCodeCell(t)) return false;
  return parseAmountNumericForImport(t) !== null;
}

function columnFillRatio(lines: string[][], col: number): number {
  if (lines.length === 0) return 0;
  let filled = 0;
  for (const row of lines) {
    if ((row[col] ?? '').trim()) filled++;
  }
  return filled / lines.length;
}

function inferDateColumnIndex(lines: string[][], exclude: Set<number> = new Set()): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
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

function inferTitleColumnIndex(lines: string[][], exclude: Set<number>): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let textLike = 0;
    let filled = 0;
    const uniqueness = new Set<string>();
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      uniqueness.add(v.toUpperCase());
      const isDate = isDateLikeCell(v);
      const isNum = isAmountLikeCell(v);
      if (!isDate && !isCurrencyCodeCell(v) && (!isNum || v.length > 6)) textLike++;
    }
    if (filled < 2) continue;
    const textRatio = textLike / filled;
    // Favoriser les libellés variés (marchands) plutôt qu'un libellé de compte constant.
    const diversity = uniqueness.size / filled;
    const score = textRatio * (0.55 + 0.45 * Math.min(1, diversity * 2));
    if (score > bestScore) {
      bestScore = score;
      bestIdx = c;
    }
  }
  return bestIdx;
}

/**
 * Colonne AMOUNT (montant unique, souvent signé).
 * Exclut les dates (sinon Value Date / ISO volent le slot via parseFloat).
 * Préfère les colonnes avec signes +/− et un fort taux de remplissage.
 */
function inferAmountColumnIndex(lines: string[][], exclude: Set<number> = new Set()): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let amountLike = 0;
    let filled = 0;
    let neg = 0;
    let pos = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      if (!isAmountLikeCell(v)) continue;
      amountLike++;
      const n = parseAmountNumericForImport(v);
      if (n !== null && n < 0) neg++;
      if (n !== null && n > 0) pos++;
    }
    if (filled === 0 || amountLike / filled < 0.5) continue;
    const fillRatio = columnFillRatio(lines, c);
    const signedBonus = neg > 0 && pos > 0 ? 0.35 : neg > 0 || pos > 0 ? 0.1 : 0;
    const score = (amountLike / filled) * fillRatio + signedBonus;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = c;
    }
  }
  return bestIdx;
}

/** Alias historique. */
function inferEurColumnIndex(lines: string[][], exclude: Set<number> = new Set()): number {
  return inferAmountColumnIndex(lines, exclude);
}

/** Colonne CURRENCY : codes ISO (EUR, GBP…), pas les taux de change (~1.0). */
function inferCurrencyColumnIndex(lines: string[][], exclude: Set<number> = new Set()): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let codeLike = 0;
    let filled = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      if (isCurrencyCodeCell(v)) codeLike++;
    }
    if (filled === 0) continue;
    const ratio = codeLike / filled;
    if (ratio < 0.5) continue;
    const score = ratio * columnFillRatio(lines, c);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = c;
    }
  }
  return bestIdx;
}

function inferFxColumnIndex(lines: string[][], exclude: Set<number> = new Set()): number {
  return inferCurrencyColumnIndex(lines, exclude);
}

/**
 * Colonne ACCOUNT : texte court, peu de valeurs distinctes (ex. « Compte courant »),
 * plutôt qu'un type d'opération (Presentment / Credit Transfer).
 */
function inferAccountColumnIndex(lines: string[][], exclude: Set<number> = new Set()): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (exclude.has(c)) continue;
    let shortText = 0;
    let filled = 0;
    const unique = new Set<string>();
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      if (isDateLikeCell(v) || isAmountLikeCell(v) || isCurrencyCodeCell(v)) continue;
      if (v.length >= 2 && v.length <= 40) {
        shortText++;
        unique.add(v.toUpperCase());
      }
    }
    if (filled === 0 || shortText / filled < 0.7) continue;
    const fillRatio = columnFillRatio(lines, c);
    const uniquenessPenalty = Math.min(1, unique.size / Math.max(1, filled));
    const score = (shortText / filled) * fillRatio * (1.15 - uniquenessPenalty);
    if (score > bestScore) {
      bestScore = score;
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
    let negOrAbs = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      if (/£|gbp|expense|debit|débit|depense/i.test(v)) {
        expenseLike++;
        continue;
      }
      if (!isAmountLikeCell(v)) continue;
      expenseLike++;
      const n = parseAmountNumericForImport(v);
      if (n !== null && n <= 0) negOrAbs++;
    }
    if (filled === 0 || expenseLike / filled < 0.5) continue;
    const score =
      (expenseLike / filled) * columnFillRatio(lines, c) * (0.7 + 0.3 * (negOrAbs / Math.max(1, expenseLike)));
    if (score > bestScore) {
      bestScore = score;
      bestIdx = c;
    }
  }
  return bestIdx;
}

function inferIncomeColumnIndex(
  lines: string[][],
  expenseCol: number,
  exclude: Set<number> = new Set()
): number {
  let bestIdx = -1;
  let bestScore = 0;
  const colCount = Math.max(0, ...lines.map((r) => r.length));
  for (let c = 0; c < colCount; c++) {
    if (c === expenseCol || exclude.has(c)) continue;
    let incomeLike = 0;
    let filled = 0;
    let pos = 0;
    for (const row of lines) {
      const v = (row[c] ?? '').trim();
      if (!v) continue;
      filled++;
      if (/£|gbp|income|credit|crédit|revenu/i.test(v)) {
        incomeLike++;
        continue;
      }
      if (!isAmountLikeCell(v)) continue;
      incomeLike++;
      const n = parseAmountNumericForImport(v);
      if (n !== null && n > 0) pos++;
    }
    if (filled === 0 || incomeLike / filled < 0.5) continue;
    const score =
      (incomeLike / filled) * columnFillRatio(lines, c) * (0.7 + 0.3 * (pos / Math.max(1, incomeLike)));
    if (score > bestScore) {
      bestScore = score;
      bestIdx = c;
    }
  }
  return bestIdx;
}

/** True si la colonne AMOUNT déjà choisie contient des montants signés (+ et −). */
function amountColumnLooksSigned(lines: string[][], amountCol: number): boolean {
  if (amountCol < 0) return false;
  let neg = 0;
  let pos = 0;
  for (const row of lines) {
    const v = (row[amountCol] ?? '').trim();
    if (!isAmountLikeCell(v)) continue;
    const n = parseAmountNumericForImport(v);
    if (n !== null && n < 0) neg++;
    if (n !== null && n > 0) pos++;
  }
  return neg > 0 && pos > 0;
}

export function inferColumnMapping(
  parsed: string[][],
  preUsedCols: Set<number> = new Set(),
  options?: { amountAlreadyMapped?: boolean; amountColHint?: number }
): Map<number, number> {
  const colToStandardIdx = new Map<number, number>();
  if (parsed.length === 0) return colToStandardIdx;

  const used = new Set<number>(preUsedCols);

  const dateCol = inferDateColumnIndex(parsed, used);
  if (dateCol >= 0) {
    colToStandardIdx.set(dateCol, IMPORT_HEADERS.indexOf('DATE'));
    used.add(dateCol);
  }

  const titleCol = inferTitleColumnIndex(parsed, used);
  if (titleCol >= 0) {
    colToStandardIdx.set(titleCol, IMPORT_HEADERS.indexOf('TITLE'));
    used.add(titleCol);
  }

  const amountCol = inferAmountColumnIndex(parsed, used);
  if (amountCol >= 0) {
    colToStandardIdx.set(amountCol, IMPORT_HEADERS.indexOf('AMOUNT'));
    used.add(amountCol);
  }

  const currencyCol = inferCurrencyColumnIndex(parsed, used);
  if (currencyCol >= 0) {
    colToStandardIdx.set(currencyCol, IMPORT_HEADERS.indexOf('CURRENCY'));
    used.add(currencyCol);
  }

  const accountCol = inferAccountColumnIndex(parsed, used);
  if (accountCol >= 0) {
    colToStandardIdx.set(accountCol, IMPORT_HEADERS.indexOf('ACCOUNT'));
    used.add(accountCol);
  }

  const amountColForSign =
    amountCol >= 0 ? amountCol : typeof options?.amountColHint === 'number' ? options.amountColHint : -1;
  // Si AMOUNT est déjà mappé (en-tête) ou signé, ne pas inventer EXPENSE/INCOME
  // (évite Exchange Rate → EXPENSE / Original Amount → INCOME sur N26).
  const skipSplitAmounts =
    options?.amountAlreadyMapped === true || amountColumnLooksSigned(parsed, amountColForSign);
  if (!skipSplitAmounts) {
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
  }

  // TYPE non auto-assigné : réservé à l'auto-catégorisation ultérieure.

  return colToStandardIdx;
}

/**
 * Mapping colonne → champ standard :
 * 1) indices d'en-têtes si la 1re ligne est un header
 *    (TYPE seulement si ce n'est pas un type d'opération bancaire type N26) ;
 * 2) complété par inférence sur les lignes de données (sans inventer TYPE).
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

  const colToStandardName = new Map<number, string>();
  const usedStandards = new Set<string>();
  const usedCols = new Set<number>();

  let amountColHint = -1;
  if (dataStartIndex > 0 && lines.length > 0) {
    const headers = parseCsvLine(lines[0], delimiter);
    for (let c = 0; c < headers.length; c++) {
      const std = suggestStandardFromHeaderLabel(headers[c] ?? '');
      if (!std || usedStandards.has(std)) continue;
      // « Type » N26 (Presentment / Credit Transfer…) ≠ catégorie comptable.
      if (std === 'TYPE' && columnLooksLikeBankOperationType(dataLines, c)) continue;
      colToStandardName.set(c, std);
      usedStandards.add(std);
      usedCols.add(c);
      if (std === 'AMOUNT') amountColHint = c;
    }
  }

  const colToStandardIdx = inferColumnMapping(dataLines, usedCols, {
    amountAlreadyMapped: usedStandards.has('AMOUNT'),
    amountColHint,
  });
  colToStandardIdx.forEach((stdIdx: number, colIdx: number) => {
    if (usedCols.has(colIdx)) return;
    const name = stdIdx < IMPORT_HEADERS.length ? IMPORT_HEADERS[stdIdx] : OUTPUT_HEADERS[stdIdx];
    // Ne jamais inventer TYPE par heuristique données — seulement via en-tête catégorie réel.
    if (!name || name === 'INDEX' || name === 'TYPE' || usedStandards.has(name)) return;
    colToStandardName.set(colIdx, name);
    usedStandards.add(name);
    usedCols.add(colIdx);
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

  const fiatChoiceByRowId = options?.fiatChoiceByRowId ?? {};
  const primaryRates = options?.primaryMappingRates;
  const rates = primaryRates ?? options?.importMappingRates ?? DEFAULT_IMPORT_MAPPING_RATES;
  const workingCurrencies = options?.workingCurrencies;
  const primaryCurrency = options?.primaryCurrency;

  const firstLineValues = parseCsvLine(lines[0], delimiter);
  const useFirstLineAsHeader = firstLineLooksLikeHeader(firstLineValues);
  const dataStartIndex = useFirstLineAsHeader && lines.length >= 2 ? 1 : 0;
  const colToStandardName = inferColumnMappingFromDataLines(lines, delimiter, dataStartIndex);

  let defaultCurrency = (options?.defaultCurrency ?? '').trim().toUpperCase() || undefined;
  if (!defaultCurrency && useFirstLineAsHeader) {
    for (const h of firstLineValues) {
      const implied = extractImpliedCurrencyFromHeaderLabel(h ?? '');
      if (implied) {
        defaultCurrency = implied;
        break;
      }
    }
  }

  for (let i = dataStartIndex; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;
    const values = parseCsvLine(rawLine, delimiter);
    const valueByStandardName: Record<string, string> = {};
    colToStandardName.forEach((stdName, colIdx) => {
      valueByStandardName[stdName] = (values[colIdx] ?? '').trim();
    });

    const rowId = `${sourceFile}:${i + 1}`;
    const fiatEffective = applyImportFiatResolutionToValueMap(
      valueByStandardName,
      rowId,
      fiatChoiceByRowId,
      workingCurrencies,
      defaultCurrency
    );

    const dataLineNumber = i - dataStartIndex + 1;
    const result = processImportRow(sourceFile, dataLineNumber, values, valueByStandardName, rawLine);
    if ('valid' in result) {
      const row = applyValidRowPostProcessMappingPolicy(result.valid, fiatEffective, rates, {
        expenseRaw: valueByStandardName.EXPENSE ?? '',
        incomeRaw: valueByStandardName.INCOME ?? '',
        primaryCurrency,
        workingCurrencies,
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
    row[SOUTIEN_IGNORE_COLUMN] ?? '',
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
