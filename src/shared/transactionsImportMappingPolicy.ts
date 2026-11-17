/**
 * Politique d’import commune (mapping wizard + merge principal) :
 * résolution devise fiat, recalcul AMOUNT GBP à partir d’AMOUNT et des taux.
 * Aucune dépendance au renderer (localStorage) : les taux sont passés en paramètre.
 */

import type { ValidRow } from './transactionsImportCore';

/** Codes ISO reconnus à l’import (aligné sur transactionsImportCore.isCurrencyCodeCell). */
const IMPORT_CURRENCY_CODE_RE =
  /^(EUR|GBP|CHF|USD|CAD|AUD|JPY|SEK|NOK|DKK|PLN|CZK|HUF|RON|BGN|TRY|MXN|BRL|INR|CNY|HKD|SGD|NZD|ZAR|AED|ILS)$/i;

function isIsoCurrencyCode(v: string): boolean {
  return IMPORT_CURRENCY_CODE_RE.test((v ?? '').trim());
}

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
  /**
   * Devise implicite du fichier (ex. en-tête Amount (EUR)).
   * Si absent, parseImportCsv peut la dériver des en-têtes.
   */
  defaultCurrency?: string;
  /** Types reconnus « sorties / dépenses » (Paramètres) — signe − si montant sans signe. */
  expenseTypes?: string[];
  /** Types reconnus « entrées / revenus » (Paramètres) — signe + si montant sans signe. */
  incomeTypes?: string[];
}

/**
 * Convertit une chaîne monétaire (EU: 1.234,56 / US: 1,234.56) en chaîne parsable par parseFloat (point décimal).
 * Les points entre la virgule et les chiffres sont des milliers (ex. € 1.675,69 → 1675.69).
 * Plusieurs virgules sans point : dernière = décimale, les autres = milliers (ex. 1,675,69 → 1675.69).
 */
export function amountStringToParseFloatNormalized(amountStr: string): string {
  let raw = amountStr
    .trim()
    // Espaces classiques + insécables (souvent avant €).
    .replace(/[\s\u00A0\u202F\u2009]/g, '')
    .replace(/[£€$₣]/g, '')
    // Codes ISO / libellés collés au montant (« EUR12,50 », « 12.50GBP », « Fr.10 »).
    // Pas de \b : les chiffres sont des « word chars », donc EUR12 n’a pas de frontière.
    .replace(/EUR|GBP|CHF|USD|CAD|AUD|JPY|SEK|NOK|DKK|PLN/gi, '')
    .replace(/S?Fr\.?/gi, '')
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

/** Types de sortie (dépenses) intégrés — alignés sur anomalyDetectionCore. */
export const BUILTIN_EXPENSE_TYPES = [
  'Rent',
  'Council',
  'Comm',
  'Electricity',
  'Water',
  'SLCdebit',
  'Transport',
  'Fuel',
  'Car',
  'Food',
  'Restaurant',
  'Shopping',
  'Leisure',
  'Holiday',
  'LST',
  'Misc',
  'Health',
  'Donation',
] as const;

/** Types d’entrée (revenus) intégrés — alignés sur anomalyDetectionCore. */
export const BUILTIN_INCOME_TYPES = [
  'Other Inc',
  'Support',
  'Refund',
  'Benefit',
  'SLCcredit',
] as const;

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

/** True si le montant CSV porte déjà un signe explicite (+/− ou parenthèses comptables). */
export function amountStringHasExplicitSign(amountStr: string): boolean {
  const raw = (amountStr ?? '').trim().replace(/\s/g, '').replace(/[£€$]/g, '');
  if (!raw) return false;
  if (raw.startsWith('(') && raw.endsWith(')')) return true;
  if (raw.startsWith('+') || raw.startsWith('-') || raw.startsWith('−')) return true;
  return false;
}

/**
 * Signe sémantique depuis le TYPE (entrée → +, sortie → −).
 * Union des listes Paramètres et des types intégrés ; comparaison insensible à la casse.
 */
export function resolveTransactionTypeSign(
  type: string,
  expenseTypes?: readonly string[],
  incomeTypes?: readonly string[]
): 1 | -1 | null {
  const t = (type ?? '').trim();
  if (!t) return null;
  const lo = t.toLowerCase();
  const income = new Set(
    [...BUILTIN_INCOME_TYPES, ...(incomeTypes ?? [])].map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  const expense = new Set(
    [...BUILTIN_EXPENSE_TYPES, ...(expenseTypes ?? [])].map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  if (income.has(lo)) return 1;
  if (expense.has(lo)) return -1;
  return null;
}

/**
 * Signe à appliquer sur AMOUNT :
 * 1) colonnes EXPENSE / INCOME (toujours, si présentes) ;
 * 2) sinon TYPE connu, uniquement si le montant CSV n’a pas déjà de signe.
 */
export function resolveImportAmountSemanticSign(
  amountStr: string,
  opts?: {
    expenseRaw?: string;
    incomeRaw?: string;
    type?: string;
    expenseTypes?: readonly string[];
    incomeTypes?: readonly string[];
  }
): 1 | -1 | null {
  const fromCols = expenseIncomeSemanticSign(opts?.expenseRaw ?? '', opts?.incomeRaw ?? '');
  if (fromCols !== null) return fromCols;
  if (amountStringHasExplicitSign(amountStr)) return null;
  return resolveTransactionTypeSign(opts?.type ?? '', opts?.expenseTypes, opts?.incomeTypes);
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
  /** Types reconnus sorties / dépenses (Paramètres). */
  expenseTypes?: readonly string[];
  /** Types reconnus entrées / revenus (Paramètres). */
  incomeTypes?: readonly string[];
};

/**
 * Devise déduite d’un texte de montant (€ → EUR, £ → GBP, code ISO collé, etc.).
 * Une cellule qui n’est qu’un code ISO seul est ignorée (colonne devise mal mappée vers AMOUNT).
 */
export function detectFiatFromAmountText(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s || isIsoCurrencyCode(s)) return null;
  const codes: Array<{ re: RegExp; code: string }> = [
    { re: /€/, code: 'EUR' },
    { re: /£/, code: 'GBP' },
    { re: /₣/, code: 'CHF' },
    { re: /\$/, code: 'USD' },
    { re: /CHF/i, code: 'CHF' },
    { re: /S?Fr\.?/i, code: 'CHF' },
    { re: /EUR/i, code: 'EUR' },
    { re: /GBP/i, code: 'GBP' },
    { re: /USD/i, code: 'USD' },
  ];
  for (const { re, code } of codes) {
    if (re.test(s)) return code;
  }
  return null;
}

/** Parcourt les champs montant usuels pour trouver un symbole / code devise. */
function detectFiatFromValueMapAmounts(valueMap: Record<string, string>): string | null {
  for (const key of ['AMOUNT', 'EXPENSE', 'INCOME', 'AMOUNT GBP'] as const) {
    const det = detectFiatFromAmountText(valueMap[key] ?? '');
    if (det) return det;
  }
  return null;
}

/**
 * Devise effective pour une ligne :
 * choix utilisateur → symbole/code dans le montant → colonne CURRENCY → devise implicite (ex. Amount (EUR)).
 * Les symboles €/£ du CSV sont toujours pris en compte (vérité de la ligne).
 */
export function resolveImportFiatEffective(
  rowId: string,
  valueMap: Record<string, string>,
  fiatChoice: Record<string, ImportFiatCurrency | '' | undefined>,
  allowedCurrencies?: string[],
  defaultCurrency?: string
): string {
  const choice = fiatChoice[rowId];
  if (choice === '') return '';
  const choiceUp = (choice ?? '').trim().toUpperCase();
  if (choiceUp) {
    if (!allowedCurrencies || allowedCurrencies.includes(choiceUp)) return choiceUp;
  }
  const det = detectFiatFromValueMapAmounts(valueMap);
  if (det) return det;
  const m = (valueMap.CURRENCY ?? '').trim().toUpperCase();
  // Uniquement les codes ISO — un taux FX (0.86) ne compte pas comme devise.
  if (m && isIsoCurrencyCode(m)) return m;
  const def = (defaultCurrency ?? '').trim().toUpperCase();
  if (def && (!allowedCurrencies || allowedCurrencies.includes(def))) return def;
  return '';
}

/** Met à jour valueMap.CURRENCY si une fiat a été résolue ; retourne la fiat effective. */
export function applyImportFiatResolutionToValueMap(
  valueMap: Record<string, string>,
  rowId: string,
  fiatChoice: Record<string, ImportFiatCurrency | '' | undefined>,
  allowedCurrencies?: string[],
  defaultCurrency?: string
): string {
  const fiatEffective = resolveImportFiatEffective(
    rowId,
    valueMap,
    fiatChoice,
    allowedCurrencies,
    defaultCurrency
  );
  if (fiatEffective) {
    const existing = (valueMap.CURRENCY ?? '').trim();
    // Ne pas écraser un code ISO déjà présent ; remplacer un taux FX / valeur vide.
    if (!existing || !isIsoCurrencyCode(existing)) {
      valueMap.CURRENCY = fiatEffective;
    }
  }
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

  const amountForSign = (vr.AMOUNT ?? '').trim() || (vr['AMOUNT GBP'] ?? '').trim();
  const sign = resolveImportAmountSemanticSign(amountForSign, {
    expenseRaw: opts?.expenseRaw,
    incomeRaw: opts?.incomeRaw,
    type: vr.TYPE,
    expenseTypes: opts?.expenseTypes,
    incomeTypes: opts?.incomeTypes,
  });
  if (sign !== null) {
    if ((vr.AMOUNT ?? '').trim()) {
      vr.AMOUNT = applySemanticSignToImportAmountStr(vr.AMOUNT, sign);
    } else if ((vr['AMOUNT GBP'] ?? '').trim()) {
      vr['AMOUNT GBP'] = applySemanticSignToImportAmountStr(vr['AMOUNT GBP'], sign);
    }
  }

  const fiat = (fiatEffective ?? '').trim().toUpperCase();
  if (fiat && working.includes(fiat)) {
    vr.CURRENCY = fiat;
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
