/**
 * Lit les taux de change effectifs depuis les réglages (localStorage).
 * Utilisé par le graphique pour convertir les soldes dans la devise de l'axe vertical.
 */

const STORAGE_KEYS = {
  eurGbpManual: 'settings-eurgbp-manual',
  chfGbpManual: 'settings-chfgbp-manual',
  eurGbpUseLive: 'settings-eurgbp-use-live',
  chfGbpUseLive: 'settings-chfgbp-use-live',
  eurGbpLiveRate: 'settings-eurgbp-live-rate',
  chfGbpLiveRate: 'settings-chfgbp-live-rate',
} as const;

const DEFAULT_EUR_GBP = 0.86;
const DEFAULT_CHF_GBP = 0.95;

function parseRate(raw: string | null, defaultVal: number): number {
  if (raw === null || raw === undefined) return defaultVal;
  const n = parseFloat(String(raw).trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : defaultVal;
}

function getEurGbp(): number {
  try {
    const useLive = localStorage.getItem(STORAGE_KEYS.eurGbpUseLive) === 'true';
    if (useLive) {
      return parseRate(localStorage.getItem(STORAGE_KEYS.eurGbpLiveRate), DEFAULT_EUR_GBP);
    }
    return parseRate(localStorage.getItem(STORAGE_KEYS.eurGbpManual), DEFAULT_EUR_GBP);
  } catch {
    return DEFAULT_EUR_GBP;
  }
}

function getChfGbp(): number {
  try {
    const useLive = localStorage.getItem(STORAGE_KEYS.chfGbpUseLive) === 'true';
    if (useLive) {
      return parseRate(localStorage.getItem(STORAGE_KEYS.chfGbpLiveRate), DEFAULT_CHF_GBP);
    }
    return parseRate(localStorage.getItem(STORAGE_KEYS.chfGbpManual), DEFAULT_CHF_GBP);
  } catch {
    return DEFAULT_CHF_GBP;
  }
}

export type CurrencySymbol = '£' | '€' | 'CHF';

/**
 * Convertit un montant d'une devise vers une autre en utilisant les taux des réglages.
 * Pivot : GBP (1 EUR = eurGbp GBP, 1 CHF = chfGbp GBP).
 */
export function convertToAxisCurrency(
  amount: number,
  fromCurrency: CurrencySymbol,
  toCurrency: CurrencySymbol
): number {
  if (fromCurrency === toCurrency) return amount;

  const eurToGbp = getEurGbp();
  const chfToGbp = getChfGbp();

  const toGbp = (value: number, cur: CurrencySymbol): number => {
    if (cur === '£') return value;
    if (cur === '€') return value * eurToGbp;
    return value * chfToGbp; // CHF
  };

  const fromGbp = (valueGbp: number, cur: CurrencySymbol): number => {
    if (cur === '£') return valueGbp;
    if (cur === '€') return valueGbp / eurToGbp;
    return valueGbp / chfToGbp; // CHF
  };

  const inGbp = toGbp(amount, fromCurrency);
  return fromGbp(inGbp, toCurrency);
}

/**
 * Convertit un montant des mouvements (source_data : colonne AMOUNT GBP, négatif = dépense / positif = revenu)
 * vers la devise d'affichage. Utilise les taux de la page Settings (EUR/GBP, CHF/GBP).
 * À utiliser pour les blocs "Suivi des mouvements" et "Evolution comparée des mouvements".
 */
export function convertMovementsToDisplayCurrency(
  amount: number,
  displayCurrency: CurrencySymbol
): number {
  return convertToAxisCurrency(amount, '£', displayCurrency);
}

/**
 * Retourne les taux effectifs (pour affichage ou debug).
 */
export function getEffectiveRates(): { eurToGbp: number; chfToGbp: number } {
  return { eurToGbp: getEurGbp(), chfToGbp: getChfGbp() };
}

/**
 * Convertit un montant (colonne AMOUNT) en GBP à partir de la devise (colonne CURRENCY).
 * Utilise les taux de la page Settings. Retourne null si la devise n'est pas EUR ou CHF.
 */
export function amountToGbp(amount: number, currency: string): number | null {
  const c = (currency ?? '').trim().toUpperCase();
  if (c === 'EUR') return amount * getEurGbp();
  if (c === 'CHF') return amount * getChfGbp();
  return null;
}

/** Taux EUR/GBP par défaut (pour migration CSV hors contexte navigateur). */
export const DEFAULT_EUR_GBP_RATE = 0.86;
