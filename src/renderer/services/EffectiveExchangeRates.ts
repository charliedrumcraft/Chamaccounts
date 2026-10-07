/**
 * Lit les taux de change effectifs depuis les réglages (localStorage).
 * Pivot = devise primaire du profil (défaut GBP).
 */

import {
  DEFAULT_WORKING_CURRENCIES,
  axisSymbolToCurrencyCode,
  currencyDisplaySymbol,
  type WorkingCurrenciesConfig,
} from '@/shared/workingCurrencies';
import type { PrimaryMappingRates } from '@/shared/transactionsImportMappingPolicy';

const LEGACY_KEYS = {
  eurGbpManual: 'settings-eurgbp-manual',
  chfGbpManual: 'settings-chfgbp-manual',
  eurGbpUseLive: 'settings-eurgbp-use-live',
  chfGbpUseLive: 'settings-chfgbp-use-live',
  eurGbpLiveRate: 'settings-eurgbp-live-rate',
  chfGbpLiveRate: 'settings-chfgbp-live-rate',
} as const;

const DEFAULT_EUR_GBP = 0.86;
const DEFAULT_CHF_GBP = 0.95;

/** Cache mémoire de la config devises (rempli par le hook / wizard). */
let cachedWorkingCurrencies: WorkingCurrenciesConfig = { ...DEFAULT_WORKING_CURRENCIES };

export function setCachedWorkingCurrencies(config: WorkingCurrenciesConfig): void {
  cachedWorkingCurrencies = {
    version: 1,
    primary: (config.primary || 'GBP').toUpperCase(),
    secondaries: (config.secondaries ?? []).map((s) => s.toUpperCase()),
    configuredAt: config.configuredAt,
  };
}

export function getCachedWorkingCurrencies(): WorkingCurrenciesConfig {
  return cachedWorkingCurrencies;
}

export function rateStorageKeys(from: string, to: string) {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  const pair = `${f}${t}`.toLowerCase();
  return {
    manual: `settings-rate-${pair}-manual`,
    useLive: `settings-rate-${pair}-use-live`,
    liveRate: `settings-rate-${pair}-live-rate`,
  };
}

function parseRate(raw: string | null, defaultVal: number): number {
  if (raw === null || raw === undefined) return defaultVal;
  const n = parseFloat(String(raw).trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

function legacyDefault(from: string, to: string): number {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (t === 'GBP' && f === 'EUR') return DEFAULT_EUR_GBP;
  if (t === 'GBP' && f === 'CHF') return DEFAULT_CHF_GBP;
  return 1;
}

function readLegacyRate(from: string, to: string): number | null {
  if (to.toUpperCase() !== 'GBP') return null;
  try {
    if (from.toUpperCase() === 'EUR') {
      const useLive = localStorage.getItem(LEGACY_KEYS.eurGbpUseLive) === 'true';
      if (useLive) return parseRate(localStorage.getItem(LEGACY_KEYS.eurGbpLiveRate), DEFAULT_EUR_GBP);
      return parseRate(localStorage.getItem(LEGACY_KEYS.eurGbpManual), DEFAULT_EUR_GBP);
    }
    if (from.toUpperCase() === 'CHF') {
      const useLive = localStorage.getItem(LEGACY_KEYS.chfGbpUseLive) === 'true';
      if (useLive) return parseRate(localStorage.getItem(LEGACY_KEYS.chfGbpLiveRate), DEFAULT_CHF_GBP);
      return parseRate(localStorage.getItem(LEGACY_KEYS.chfGbpManual), DEFAULT_CHF_GBP);
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** 1 FROM = X TO (TO = primaire en pratique). */
export function getRateToPrimary(from: string, primary?: string): number {
  const p = (primary || cachedWorkingCurrencies.primary || 'GBP').toUpperCase();
  const f = (from || '').trim().toUpperCase();
  if (!f || f === p) return 1;
  const keys = rateStorageKeys(f, p);
  try {
    const useLive = localStorage.getItem(keys.useLive) === 'true';
    if (useLive) {
      const live = parseRate(localStorage.getItem(keys.liveRate), 0);
      if (live > 0) return live;
    }
    const manual = localStorage.getItem(keys.manual);
    if (manual != null && manual.trim() !== '') {
      return parseRate(manual, legacyDefault(f, p));
    }
  } catch {
    /* ignore */
  }
  const legacy = readLegacyRate(f, p);
  if (legacy != null) return legacy;
  return legacyDefault(f, p);
}

export function getPrimaryMappingRates(config?: WorkingCurrenciesConfig): PrimaryMappingRates {
  const cfg = config ?? cachedWorkingCurrencies;
  const primary = (cfg.primary || 'GBP').toUpperCase();
  const ratesToPrimary: Record<string, number> = {};
  for (const sec of cfg.secondaries ?? []) {
    const s = sec.toUpperCase();
    if (s && s !== primary) ratesToPrimary[s] = getRateToPrimary(s, primary);
  }
  return { primary, ratesToPrimary };
}

/** @deprecated Compat — retourne eurToGbp / chfToGbp si primary=GBP. */
export function getEffectiveRates(): { eurToGbp: number; chfToGbp: number } {
  const primary = cachedWorkingCurrencies.primary || 'GBP';
  return {
    eurToGbp: getRateToPrimary('EUR', primary),
    chfToGbp: getRateToPrimary('CHF', primary),
  };
}

export type CurrencySymbol = string;

export function convertBetweenCurrencyCodes(
  amount: number,
  fromCode: string,
  toCode: string,
  config?: WorkingCurrenciesConfig
): number {
  const from = axisSymbolToCurrencyCode(fromCode);
  const to = axisSymbolToCurrencyCode(toCode);
  if (from === to) return amount;
  const rates = getPrimaryMappingRates(config);
  const primary = rates.primary;

  const toPrimary = (value: number, cur: string): number => {
    if (cur === primary) return value;
    const r = rates.ratesToPrimary[cur] ?? getRateToPrimary(cur, primary);
    return value * r;
  };
  const fromPrimary = (value: number, cur: string): number => {
    if (cur === primary) return value;
    const r = rates.ratesToPrimary[cur] ?? getRateToPrimary(cur, primary);
    return r > 0 ? value / r : value;
  };

  return fromPrimary(toPrimary(amount, from), to);
}

/**
 * Convertit un montant d'une devise vers une autre (symboles historiques £/€/CHF ou codes).
 */
export function convertToAxisCurrency(
  amount: number,
  fromCurrency: CurrencySymbol,
  toCurrency: CurrencySymbol
): number {
  return convertBetweenCurrencyCodes(amount, fromCurrency, toCurrency);
}

export function convertMovementsToDisplayCurrency(
  amount: number,
  displayCurrency: CurrencySymbol
): number {
  const primary = cachedWorkingCurrencies.primary || 'GBP';
  return convertBetweenCurrencyCodes(amount, primary, displayCurrency);
}

/**
 * Convertit AMOUNT → indicateur primaire. null si devise inconnue / sans taux.
 */
export function amountToPrimary(amount: number, currency: string): number | null {
  const c = (currency ?? '').trim().toUpperCase();
  const primary = (cachedWorkingCurrencies.primary || 'GBP').toUpperCase();
  if (!c) return null;
  if (c === primary) return amount;
  const rate = getRateToPrimary(c, primary);
  if (!rate || rate <= 0) return null;
  return amount * rate;
}

/** @deprecated Utiliser amountToPrimary. */
export function amountToGbp(amount: number, currency: string): number | null {
  return amountToPrimary(amount, currency);
}

export const DEFAULT_EUR_GBP_RATE = 0.86;

export function formatSymbolForCode(code: string): string {
  return currencyDisplaySymbol(code);
}
