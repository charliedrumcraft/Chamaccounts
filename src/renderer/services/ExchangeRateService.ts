/**
 * Récupère les taux de change via l'API Frankfurter (gratuite, sans clé).
 * https://www.frankfurter.dev/
 */

import i18n from '../i18n';

const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';

export type ExchangeRateResult = {
  rate: number;
  date: string;
  fetchedAt: string;
};

export async function fetchExchangeRate(from: string, to: string): Promise<ExchangeRateResult> {
  const fetchedAt = new Date().toISOString();
  const url = `${FRANKFURTER_BASE}/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(i18n.t('system.exchangeRateHttp', { status: res.status, statusText: res.statusText }));
  }
  const data = await res.json();
  const rate = data?.rates?.[to];
  if (typeof rate !== 'number') {
    throw new Error(i18n.t('system.invalidApiResponse'));
  }
  return { rate, date: data?.date ?? '', fetchedAt };
}

export const ExchangeRateService = {
  async getRate(from: string, to: string): Promise<ExchangeRateResult> {
    return fetchExchangeRate(from.toUpperCase(), to.toUpperCase());
  },

  /** 1 EUR = X GBP */
  async getEurGbp(): Promise<ExchangeRateResult> {
    return fetchExchangeRate('EUR', 'GBP');
  },

  /** 1 CHF = X GBP */
  async getChfGbp(): Promise<ExchangeRateResult> {
    return fetchExchangeRate('CHF', 'GBP');
  },
};
