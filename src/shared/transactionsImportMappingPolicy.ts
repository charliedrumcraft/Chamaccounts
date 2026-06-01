/**
 * Politique d’import commune (mapping wizard + merge principal) :
 * résolution devise fiat, recalcul AMOUNT GBP à partir d’AMOUNT et des taux.
 * Aucune dépendance au renderer (localStorage) : les taux sont passés en paramètre.
 */

import type { ValidRow } from './transactionsImportCore';

/** Taux alignés sur EffectiveExchangeRates.ts (valeurs par défaut Paramètres). */
export const DEFAULT_EUR_TO_GBP = 0.86;
export const DEFAULT_CHF_TO_GBP = 0.95;

export interface ImportMappingRates {
  eurToGbp: number;
  chfToGbp: number;
}

export const DEFAULT_IMPORT_MAPPING_RATES: ImportMappingRates = {
  eurToGbp: DEFAULT_EUR_TO_GBP,
  chfToGbp: DEFAULT_CHF_TO_GBP,
};

export type ImportFiatCurrency = 'EUR' | 'GBP' | 'CHF';

/** Options de parseImportCsv (aligné process principal / wizard). */
export interface ParseImportCsvOptions {
  importMappingRates?: ImportMappingRates;
  fiatChoiceByRowId?: Record<string, ImportFiatCurrency | '' | undefined>;
}

/**
 * Convertit une chaîne monétaire (EU: 1.234,56 / US: 1,234.56) en chaîne parsable par parseFloat (point décimal).
 * Les points entre la virgule et les chiffres sont des milliers (ex. € 1.675,69 → 1675.69).
 * Plusieurs virgules sans point : dernière = décimale, les autres = milliers (ex. 1,675,69 → 1675.69).
 */
export function amountStringToParseFloatNormalized(amountStr: string): string {
  let raw = amountStr
    .trim()
    .replace(/\s/g, '')
    .replace(/[£€$]/g, '')
    .replace(/−/g, '-');
  if (raw === '') return '';
  let neg = false;
  if (raw.startsWith('(') && raw.endsWith(')')) {
    neg = true;
    raw = raw.slice(1, -1);
  } else if (raw.startsWith('-')) {
    neg = true;
    raw = raw.slice(1);
  }
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      raw = raw.replace(/\./g, '').replace(',', '.');
    } else {
      raw = raw.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    const commaCount = (raw.match(/,/g) ?? []).length;
    if (commaCount > 1) {
      raw = raw.replace(/,(?=.*,)/g, '').replace(',', '.');
    } else {
      raw = raw.replace(',', '.');
    }
  } else if (lastDot !== -1 && raw.indexOf('.') !== lastDot) {
    raw = raw.replace(/\./g, '');
  }
  if (neg) raw = '-' + raw;
  return raw;
}

export function parseAmountNumericForImport(amountStr: string): number | null {
  const raw = amountStringToParseFloatNormalized(amountStr);
  if (raw === '') return null;
  const n = parseFloat(raw);
  return Number.isNaN(n) ? null : n;
}

/** Virgule décimale, 2 décimales — aligné sur formatAmountGbpForCsv (renderer). */
export function formatAmountGbpForCsvImport(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return String(rounded).replace('.', ',');
}

export function amountToGbpWithRates(amount: number, currency: string, rates: ImportMappingRates): number | null {
  const c = (currency ?? '').trim().toUpperCase();
  if (c === 'EUR') return amount * rates.eurToGbp;
  if (c === 'CHF') return amount * rates.chfToGbp;
  return null;
}

/** Recalcule AMOUNT GBP à partir d’AMOUNT et de la devise (taux explicites). */
export function applyGbpFromAmountAndFiatWithRates(amountStr: string, fiat: string, rates: ImportMappingRates): string {
  const amount = parseAmountNumericForImport(amountStr);
  if (amount === null || amount === 0) return '';
  const c = fiat.toUpperCase();
  if (c === 'EUR' || c === 'CHF') {
    const gbp = amountToGbpWithRates(amount, c, rates);
    return gbp !== null ? formatAmountGbpForCsvImport(gbp) : '';
  }
  if (c === 'GBP') return formatAmountGbpForCsvImport(amount);
  return '';
}

/** Même règle que processImportRow : INCOME prioritaire si les deux sont renseignés. */
function expenseIncomeSemanticSign(expenseRaw: string, incomeRaw: string): 1 | -1 | null {
  const norm = (s: string): boolean => {
    if ((s ?? '').trim() === '') return false;
    return parseAmountNumericForImport(s) !== null;
  };
  if (norm(incomeRaw)) return 1;
  if (norm(expenseRaw)) return -1;
  return null;
}

/** Aligne AMOUNT sur le signe attendu (dépense / revenu) avant conversion → AMOUNT GBP. */
function applySemanticSignToImportAmountStr(amountStr: string, sign: 1 | -1): string {
  const n = parseAmountNumericForImport(amountStr);
  if (n === null || n === 0) return amountStr;
  const absFormatted = formatAmountGbpForCsvImport(Math.abs(n));
  return sign < 0 ? `-${absFormatted}` : absFormatted;
}

export type ApplyValidRowPostProcessOptions = {
  /** Valeurs brutes des colonnes EXPENSE / INCOME (si présentes) pour le signe final. */
  expenseRaw?: string;
  incomeRaw?: string;
};

function detectFiatFromAmountText(raw: string): ImportFiatCurrency | null {
  const s = raw ?? '';
  if (/€/.test(s)) return 'EUR';
  if (/£/.test(s)) return 'GBP';
  if (/\bCHF\b/i.test(s)) return 'CHF';
  if (/\bEUR\b/i.test(s)) return 'EUR';
  if (/\bGBP\b/i.test(s)) return 'GBP';
  return null;
}

/**
 * Devise effective pour une ligne (choix utilisateur, sinon détection sur AMOUNT, sinon colonne CURRENCY).
 * Aligné sur le mapping wizard (renderer).
 */
export function resolveImportFiatEffective(
  rowId: string,
  valueMap: Record<string, string>,
  fiatChoice: Record<string, ImportFiatCurrency | '' | undefined>
): string {
  const choice = fiatChoice[rowId];
  if (choice === '') return '';
  if (choice === 'EUR' || choice === 'GBP' || choice === 'CHF') return choice;
  const det = detectFiatFromAmountText(valueMap.AMOUNT ?? '');
  if (det) return det;
  const m = (valueMap.CURRENCY ?? '').trim().toUpperCase();
  if (m === 'EUR' || m === 'GBP' || m === 'CHF') return m;
  return '';
}

/** Met à jour valueMap.CURRENCY si une fiat a été résolue ; retourne la fiat effective. */
export function applyImportFiatResolutionToValueMap(
  valueMap: Record<string, string>,
  rowId: string,
  fiatChoice: Record<string, ImportFiatCurrency | '' | undefined>
): string {
  const fiatEffective = resolveImportFiatEffective(rowId, valueMap, fiatChoice);
  if (fiatEffective) valueMap.CURRENCY = fiatEffective;
  return fiatEffective;
}

/**
 * Export / colonne compte avec libellé « Revolut » → compte actif (REV EUR / REV GBP / REV CHF)
 * selon la devise de la ligne (même règle mapping wizard + merge).
 *
 * - EUR → REV EUR
 * - CHF → REV CHF
 * - devise vide (ou GBP, portefeuille sterling explicite) → REV GBP
 */
export function mapRawRevolutAccountToActiveLabel(account: string, currency: string): string | null {
  const acc = (account ?? '').trim();
  if (!acc) return null;
  const accLower = acc.toLowerCase();
  if (accLower !== 'revolut' && !accLower.startsWith('revolut ')) return null;
  const c = (currency ?? '').trim().toUpperCase();
  if (c === 'EUR') return 'REV EUR';
  if (c === 'CHF') return 'REV CHF';
  if (c === '' || c === 'GBP') return 'REV GBP';
  return null;
}

/**
 * Post-traitement d’une ligne déjà validée par processImportRow (même logique que le wizard).
 */
export function applyValidRowPostProcessMappingPolicy(
  validRow: ValidRow,
  fiatEffective: string,
  rates: ImportMappingRates,
  opts?: ApplyValidRowPostProcessOptions
): ValidRow {
  let vr = { ...validRow };
  if (fiatEffective === 'EUR' || fiatEffective === 'GBP' || fiatEffective === 'CHF') {
    vr.CURRENCY = fiatEffective;
    const sign = opts
      ? expenseIncomeSemanticSign(opts.expenseRaw ?? '', opts.incomeRaw ?? '')
      : null;
    if (sign !== null && vr.AMOUNT.trim()) {
      vr.AMOUNT = applySemanticSignToImportAmountStr(vr.AMOUNT, sign);
    }
    const gbp = applyGbpFromAmountAndFiatWithRates(vr.AMOUNT, fiatEffective, rates);
    if (gbp) vr['AMOUNT GBP'] = gbp;
  }
  const revolutActive = mapRawRevolutAccountToActiveLabel(vr.ACCOUNT, vr.CURRENCY);
  if (revolutActive) vr.ACCOUNT = revolutActive;
  return vr;
}
