/**
 * Édition UI : AMOUNT + CURRENCY = source ; indicateur (AMOUNT {PRIMARY}) = calculé.
 */

import { amountToPrimary, getCachedWorkingCurrencies } from '../services/EffectiveExchangeRates';
import { formatAmountGbpForCsv } from './format';

/** Si seul l’indicateur est rempli, le promote en montant d’origine (devise primaire). */
export function promoteAmountGbpToSourceIfNeeded(
  row: Record<string, string>,
  amountHeader: string,
  currencyHeader: string,
  amountGbpHeader: string
): void {
  const amount = (row[amountHeader] ?? '').trim();
  const amountGbp = (row[amountGbpHeader] ?? '').trim();
  if (amount || !amountGbp) return;
  const currency = (row[currencyHeader] ?? '').trim().toUpperCase();
  const primary = (getCachedWorkingCurrencies().primary || 'GBP').toUpperCase();
  const secondaries = (getCachedWorkingCurrencies().secondaries ?? []).map((c) => c.toUpperCase());
  if (currency && secondaries.includes(currency)) return;
  row[amountHeader] = amountGbp;
  row[currencyHeader] = primary;
}

/**
 * Après édition de AMOUNT / CURRENCY / indicateur : assure AMOUNT+CURRENCY,
 * recalcule l’indicateur pour les secondaires, aligne pour la primaire.
 */
export function syncTransactionAmountCurrencyOnEdit(
  row: Record<string, string>,
  editedHeader: string,
  amountHeader: string,
  currencyHeader: string,
  amountGbpHeader: string
): void {
  if (
    editedHeader === amountGbpHeader &&
    !(row[amountHeader] ?? '').trim() &&
    (row[amountGbpHeader] ?? '').trim()
  ) {
    promoteAmountGbpToSourceIfNeeded(row, amountHeader, currencyHeader, amountGbpHeader);
    return;
  }

  if (editedHeader !== amountHeader && editedHeader !== currencyHeader) return;

  promoteAmountGbpToSourceIfNeeded(row, amountHeader, currencyHeader, amountGbpHeader);

  const amountRaw = (row[amountHeader] ?? '').trim().replace(',', '.');
  const amount = parseFloat(amountRaw);
  if (Number.isNaN(amount) || amount === 0) return;

  const primary = (getCachedWorkingCurrencies().primary || 'GBP').toUpperCase();
  const secondaries = new Set(
    (getCachedWorkingCurrencies().secondaries ?? []).map((c) => c.toUpperCase())
  );

  if (!(row[currencyHeader] ?? '').trim()) {
    row[currencyHeader] = secondaries.has('EUR') ? 'EUR' : primary;
  }
  const effectiveCurrency = (row[currencyHeader] ?? '').trim().toUpperCase() || primary;
  if (effectiveCurrency === primary) {
    row[amountGbpHeader] = formatAmountGbpForCsv(amount);
    return;
  }
  if (secondaries.has(effectiveCurrency) || effectiveCurrency === 'EUR' || effectiveCurrency === 'CHF') {
    const converted = amountToPrimary(amount, effectiveCurrency);
    if (converted !== null) row[amountGbpHeader] = formatAmountGbpForCsv(converted);
  }
}

/** Indicateur en lecture seule dès que AMOUNT + devise de travail sont cohérents. */
export function isAmountGbpIndicatorReadOnly(
  row: Record<string, string>,
  amountHeader: string | undefined,
  currencyHeader: string | undefined
): boolean {
  if (!amountHeader || !currencyHeader) return false;
  const a = parseFloat((row[amountHeader] ?? '').toString().replace(',', '.'));
  if (Number.isNaN(a) || a === 0) return false;
  const c = (row[currencyHeader] ?? '').trim().toUpperCase();
  const primary = (getCachedWorkingCurrencies().primary || 'GBP').toUpperCase();
  const codes = new Set([
    primary,
    ...(getCachedWorkingCurrencies().secondaries ?? []).map((x) => x.toUpperCase()),
  ]);
  return codes.has(c);
}
