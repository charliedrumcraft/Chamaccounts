/**
 * Devises de travail du profil : 1 primaire (pivot) + jusqu’à 2 secondaires.
 */

export const WORKING_CURRENCIES_FILENAME = 'working_currencies.json';

/** Liste Frankfurter / BCE (codes ISO 4217 courants). */
export const FRANKFURTER_CURRENCY_CODES = [
  'AUD',
  'BGN',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
] as const;

export type FrankfurterCurrencyCode = (typeof FRANKFURTER_CURRENCY_CODES)[number];

export type WorkingCurrenciesConfig = {
  version: 1;
  primary: string;
  secondaries: string[];
  /** Présent uniquement après configuration explicite (wizard / Settings). */
  configuredAt?: string;
};

export const DEFAULT_WORKING_CURRENCIES: WorkingCurrenciesConfig = {
  version: 1,
  primary: 'GBP',
  secondaries: ['EUR', 'CHF'],
};

/** Clé interne ValidRow / SQLite (`amount_gbp`) — ne pas renommer. */
export const AMOUNT_INDICATOR_INTERNAL_KEY = 'AMOUNT GBP';

export function amountIndicatorHeader(primary: string): string {
  const p = (primary ?? '').trim().toUpperCase() || 'GBP';
  return `AMOUNT ${p}`;
}

/** Détecte une colonne indicateur (AMOUNT GBP historique ou AMOUNT {CODE}). */
export function isAmountIndicatorHeader(header: string): boolean {
  return /^amount\s+[A-Za-z]{3}$/i.test((header ?? '').trim());
}

export function normalizeCurrencyCode(raw: string): string {
  return (raw ?? '').trim().toUpperCase();
}

export function isKnownFrankfurterCurrency(code: string): boolean {
  const c = normalizeCurrencyCode(code);
  return (FRANKFURTER_CURRENCY_CODES as readonly string[]).includes(c);
}

export function workingCurrencyCodes(config: WorkingCurrenciesConfig): string[] {
  const primary = normalizeCurrencyCode(config.primary) || 'GBP';
  const secs = (config.secondaries ?? [])
    .map(normalizeCurrencyCode)
    .filter((c) => c && c !== primary);
  const unique: string[] = [primary];
  for (const s of secs) {
    if (!unique.includes(s) && unique.length < 3) unique.push(s);
  }
  return unique;
}

export function isWorkingCurrencyConfigured(config: WorkingCurrenciesConfig | null | undefined): boolean {
  return Boolean(config?.configuredAt);
}

/** Erreur de validation : `error` (FR, défaut) + clé main `tm()` pour l’affichage localisé. */
export type WorkingCurrenciesInputError = {
  error: string;
  errorKey: string;
  errorVars?: Record<string, string | number>;
};

const DISTINCT_CURRENCIES_ERROR: WorkingCurrenciesInputError = {
  error: 'Les devises doivent être distinctes.',
  errorKey: 'workingCurrencies.distinct',
};

export function sanitizeWorkingCurrenciesInput(input: {
  primary: string;
  secondaries?: Array<string | '' | null | undefined>;
}): WorkingCurrenciesConfig | WorkingCurrenciesInputError {
  const primary = normalizeCurrencyCode(input.primary);
  if (!primary) return { error: 'La devise principale est obligatoire.', errorKey: 'workingCurrencies.primaryRequired' };
  if (!isKnownFrankfurterCurrency(primary)) {
    return {
      error: `Devise principale inconnue : ${primary}`,
      errorKey: 'workingCurrencies.unknownPrimary',
      errorVars: { code: primary },
    };
  }
  const secondaries: string[] = [];
  for (const raw of input.secondaries ?? []) {
    const c = normalizeCurrencyCode(String(raw ?? ''));
    if (!c) continue;
    if (!isKnownFrankfurterCurrency(c)) {
      return {
        error: `Devise secondaire inconnue : ${c}`,
        errorKey: 'workingCurrencies.unknownSecondary',
        errorVars: { code: c },
      };
    }
    if (c === primary || secondaries.includes(c)) return { ...DISTINCT_CURRENCIES_ERROR };
    if (secondaries.length >= 2) {
      return { error: 'Au plus deux devises secondaires.', errorKey: 'workingCurrencies.maxSecondaries' };
    }
    secondaries.push(c);
  }
  return {
    version: 1,
    primary,
    secondaries,
    configuredAt: new Date().toISOString(),
  };
}

/** Symbole d’affichage pour un code ISO (axes / montants). */
export function currencyDisplaySymbol(code: string): string {
  const c = normalizeCurrencyCode(code);
  if (c === 'GBP') return '£';
  if (c === 'EUR') return '€';
  if (c === 'CHF') return 'CHF';
  if (c === 'USD') return '$';
  if (c === 'JPY') return '¥';
  return c;
}

/**
 * Mappe un symbole d’axe historique (£/€/CHF) vers un code ISO, sinon le code tel quel.
 */
export function axisSymbolToCurrencyCode(sym: string): string {
  const s = (sym ?? '').trim();
  if (s === '£') return 'GBP';
  if (s === '€') return 'EUR';
  if (s === 'CHF') return 'CHF';
  if (s === '$') return 'USD';
  return normalizeCurrencyCode(s) || 'GBP';
}
