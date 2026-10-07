/**
 * Options de devise d’affichage (axes / menus Paramètres) dérivées des devises de travail du profil.
 */

import {
  currencyDisplaySymbol,
  workingCurrencyCodes,
  type WorkingCurrenciesConfig,
} from '@/shared/workingCurrencies';
import { getCachedWorkingCurrencies } from '../services/EffectiveExchangeRates';

export type DisplayCurrencyOption = { value: string; label: string };

export function displayCurrencyOptionsFromWorking(
  config?: WorkingCurrenciesConfig
): DisplayCurrencyOption[] {
  const cfg = config ?? getCachedWorkingCurrencies();
  return workingCurrencyCodes(cfg).map((code) => {
    const sym = currencyDisplaySymbol(code);
    const label = sym === code || code === 'CHF' ? code : `${code} (${sym})`;
    return { value: sym, label };
  });
}

export function defaultDisplayCurrencySymbol(config?: WorkingCurrenciesConfig): string {
  const cfg = config ?? getCachedWorkingCurrencies();
  return currencyDisplaySymbol(cfg.primary || 'GBP');
}

/** Si la préférence sauvegardée n’est plus dans le trio, revient à la primaire. */
export function coerceDisplayCurrency(
  saved: string | null | undefined,
  config?: WorkingCurrenciesConfig
): string {
  const options = displayCurrencyOptionsFromWorking(config);
  const allowed = new Set(options.map((o) => o.value));
  const raw = (saved ?? '').trim();
  if (raw && allowed.has(raw)) return raw;
  if (raw) {
    const asSym = currencyDisplaySymbol(raw);
    if (allowed.has(asSym)) return asSym;
  }
  return defaultDisplayCurrencySymbol(config);
}
