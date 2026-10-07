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

/** Taux vers la devise primaire : 1 unité de clé = rate unités de primary. */
export type PrimaryMappingRates = {
  primary: string;
  ratesToPrimary: Record<string, number>;
};

export type ImportFiatCurrency = string;

/** Options de parseImportCsv (aligné process principal / wizard). */
export interface ParseImportCsvOptions {
  importMappingRates?: ImportMappingRates;
  primaryMappingRates?: PrimaryMappingRates;
  /** Devise primaire du profil (défaut GBP) — utilisée si AMOUNT vient de l’indicateur seul. */
  primaryCurrency?: string;
  /** Devises de travail autorisées (primaire + secondaires). */
  workingCurrencies?: string[];
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

export function importRatesAsPrimaryRates(rates: ImportMappingRates, primary = 'GBP'): PrimaryMappingRates {
  return {
    primary: (primary || 'GBP').toUpperCase(),
    ratesToPrimary: {
      EUR: rates.eurToGbp,
      CHF: rates.chfToGbp,
    },
  };
}

export function amountToPrimaryWithRates(
  amount: number,
  currency: string,
  rates: PrimaryMappingRates
): number | null {
  const c = (currency ?? '').trim().toUpperCase();
  const primary = (rates.primary || 'GBP').toUpperCase();
  if (c === primary) return amount;
  const rate = rates.ratesToPrimary[c];
  if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
    return amount * rate;
  }
  return null;
}

/** Recalcule AMOUNT GBP à partir d’AMOUNT et de la devise (taux explicites). */
export function applyGbpFromAmountAndFiatWithRates(amountStr: string, fiat: string, rates: ImportMappingRates): string {
  return applyPrimaryFromAmountAndFiatWithRates(amountStr, fiat, importRatesAsPrimaryRates(rates, 'GBP'));
}

export function applyPrimaryFromAmountAndFiatWithRates(
  amountStr: string,
  fiat: string,
  rates: PrimaryMappingRates
): string {
  const amount = parseAmountNumericForImport(amountStr);
  if (amount === null || amount === 0) return '';
  const c = fiat.toUpperCase();
  const primary = (rates.primary || 'GBP').toUpperCase();
  if (c === primary) return formatAmountGbpForCsvImport(amount);
  const converted = amountToPrimaryWithRates(amount, c, rates);
  return converted !== null ? formatAmountGbpForCsvImport(converted) : '';
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

function detectFiatFromAmountText(raw: string, allowed?: string[]): string | null {
  const s = raw ?? '';
  const codes: Array<{ re: RegExp; code: string }> = [
    { re: /€/, code: 'EUR' },
    { re: /£/, code: 'GBP' },
    { re: /\$/, code: 'USD' },
    { re: /\bCHF\b/i, code: 'CHF' },
    { re: /\bEUR\b/i, code: 'EUR' },
    { re: /\bGBP\b/i, code: 'GBP' },
    { re: /\bUSD\b/i, code: 'USD' },
  ];
  for (const { re, code } of codes) {
    if (re.test(s)) {
      if (!allowed || allowed.includes(code)) return code;
    }
  }
  return null;
}

/**
 * Devise effective pour une ligne (choix utilisateur, sinon détection sur AMOUNT, sinon colonne CURRENCY).
 * Aligné sur le mapping wizard (renderer).
 */
export function resolveImportFiatEffective(
  rowId: string,
  valueMap: Record<string, string>,
  fiatChoice: Record<string, ImportFiatCurrency | '' | undefined>,
  allowedCurrencies?: string[]
): string {
  const choice = fiatChoice[rowId];
  if (choice === '') return '';
  const choiceUp = (choice ?? '').trim().toUpperCase();
  if (choiceUp && (!allowedCurrencies || allowedCurrencies.includes(choiceUp))) return choiceUp;
  const det = detectFiatFromAmountText(valueMap.AMOUNT ?? '', allowedCurrencies);
  if (det) return det;
  const m = (valueMap.CURRENCY ?? '').trim().toUpperCase();
  if (m && (!allowedCurrencies || allowedCurrencies.includes(m))) return m;
  return '';
}

/** Met à jour valueMap.CURRENCY si une fiat a été résolue ; retourne la fiat effective. */
export function applyImportFiatResolutionToValueMap(
  valueMap: Record<string, string>,
  rowId: string,
  fiatChoice: Record<string, ImportFiatCurrency | '' | undefined>,
  allowedCurrencies?: string[]
): string {
  const fiatEffective = resolveImportFiatEffective(rowId, valueMap, fiatChoice, allowedCurrencies);
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
 * AMOUNT + CURRENCY = source de vérité. Si seul l’indicateur (AMOUNT GBP interne) est renseigné
 * et que la devise n’est pas une secondaire connue, copie vers AMOUNT et pose CURRENCY = primary.
 */
export function fillAmountCurrencyFromAmountGbpIfNeeded(
  row: {
    AMOUNT?: string;
    CURRENCY?: string;
    'AMOUNT GBP'?: string;
  },
  primary = 'GBP',
  secondaryCodes: string[] = ['EUR', 'CHF']
): boolean {
  const amount = (row.AMOUNT ?? '').trim();
  const amountGbp = (row['AMOUNT GBP'] ?? '').trim();
  if (amount || !amountGbp) return false;
  const currency = (row.CURRENCY ?? '').trim().toUpperCase();
  const secs = secondaryCodes.map((c) => c.toUpperCase());
  if (currency && secs.includes(currency)) return false;
  row.AMOUNT = amountGbp;
  row.CURRENCY = (primary || 'GBP').toUpperCase();
  return true;
}

/**
 * Post-traitement d’une ligne déjà validée par processImportRow (même logique que le wizard).
 */
export function applyValidRowPostProcessMappingPolicy(
  validRow: ValidRow,
  fiatEffective: string,
  rates: ImportMappingRates | PrimaryMappingRates,
  opts?: ApplyValidRowPostProcessOptions & { primaryCurrency?: string; workingCurrencies?: string[] }
): ValidRow {
  let vr = { ...validRow };
  const primary =
    opts?.primaryCurrency?.toUpperCase() ||
    ('primary' in rates ? rates.primary : 'GBP').toUpperCase() ||
    'GBP';
  const working = (opts?.workingCurrencies ?? [primary, 'EUR', 'CHF']).map((c) => c.toUpperCase());
  const secondaries = working.filter((c) => c !== primary);
  const primaryRates: PrimaryMappingRates =
    'ratesToPrimary' in rates ? rates : importRatesAsPrimaryRates(rates, primary);

  const fiat = (fiatEffective ?? '').trim().toUpperCase();
  if (fiat && working.includes(fiat)) {
    vr.CURRENCY = fiat;
    const sign = opts
      ? expenseIncomeSemanticSign(opts.expenseRaw ?? '', opts.incomeRaw ?? '')
      : null;
    if (sign !== null && vr.AMOUNT.trim()) {
      vr.AMOUNT = applySemanticSignToImportAmountStr(vr.AMOUNT, sign);
    }
    if (!(vr.AMOUNT ?? '').trim() && (vr['AMOUNT GBP'] ?? '').trim()) {
      vr.AMOUNT = vr['AMOUNT GBP'];
    }
    const converted = applyPrimaryFromAmountAndFiatWithRates(vr.AMOUNT, fiat, primaryRates);
    if (converted) vr['AMOUNT GBP'] = converted;
  } else {
    fillAmountCurrencyFromAmountGbpIfNeeded(vr, primary, secondaries);
  }
  const revolutActive = mapRawRevolutAccountToActiveLabel(vr.ACCOUNT, vr.CURRENCY);
  if (revolutActive) vr.ACCOUNT = revolutActive;
  return vr;
}
