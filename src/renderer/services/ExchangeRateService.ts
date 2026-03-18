/**
 * Récupère les taux de change via l'API Frankfurter (gratuite, sans clé).
 * https://www.frankfurter.dev/
 */

const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';

export type ExchangeRateResult = {
  rate: number;
  date: string;
  fetchedAt: string; // ISO date-time de la requête
};

async function fetchRate(from: string, to: string): Promise<ExchangeRateResult> {
  const fetchedAt = new Date().toISOString();
  const url = `${FRANKFURTER_BASE}/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Taux de change: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const rate = data?.rates?.[to];
  if (typeof rate !== 'number') {
    throw new Error('Réponse API invalide');
  }
  return { rate, date: data?.date ?? '', fetchedAt };
}

export const ExchangeRateService = {
  /** 1 EUR = X GBP */
  async getEurGbp(): Promise<ExchangeRateResult> {
    return fetchRate('EUR', 'GBP');
  },

  /** 1 CHF = X GBP */
  async getChfGbp(): Promise<ExchangeRateResult> {
    return fetchRate('CHF', 'GBP');
  },
};
