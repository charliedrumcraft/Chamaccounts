/**
 * Forme commune des transactions chargées (SQLite / CSV Support).
 * Alignée sur l’historique SourceDataCSVService (Index + colonnes métier).
 */

import { amountIndicatorHeader } from './workingCurrencies';

export interface SourceDataResult {
  headers: string[];
  rows: Record<string, string>[];
  /**
   * Optionnel : pour chaque ligne rows[i], index de cette ligne dans le data_source complet.
   * Utilisé par les rapports d'anomalies (ex. monthly) pour afficher l'index dans le fichier source.
   */
  rowIndicesInSource?: number[];
}

/** En-têtes UI / miroir CSV pour les transactions (Index affiché, pas INDEX brut). */
export function transactionSourceHeaders(primaryCurrency = 'GBP'): string[] {
  return [
    'Index',
    'DATE',
    'TITLE',
    'AMOUNT',
    'CURRENCY',
    'ACCOUNT',
    amountIndicatorHeader(primaryCurrency),
    'TYPE',
    'PROJET',
    'Exclure_anomalie',
    'Soutien_ignorer',
  ];
}

/** @deprecated Préférer transactionSourceHeaders(primary) — défaut GBP pour compat. */
export const TRANSACTION_SOURCE_HEADERS = transactionSourceHeaders('GBP');

/** En-têtes Support_data.csv (avec Source, sans Account). */
export function supportSourceHeaders(primaryCurrency = 'GBP'): string[] {
  return [
    'Index',
    'DATE',
    'TITLE',
    'AMOUNT',
    'CURRENCY',
    amountIndicatorHeader(primaryCurrency),
    'TYPE',
    'Source',
    'PROJET',
    'Exclure_anomalie',
    'Soutien_ignorer',
  ];
}

/** @deprecated Préférer supportSourceHeaders(primary). */
export const SUPPORT_SOURCE_HEADERS = supportSourceHeaders('GBP');
