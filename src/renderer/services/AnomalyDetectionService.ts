/**
 * Façade renderer : détection d’anomalies (logique dans shared/anomalyDetectionCore).
 * Charge les listes reconnues depuis localStorage pour l’usage local (ex. Mensuel).
 */

import type { SourceDataResult } from './SourceDataCSVService';
import { EXCLUDE_ANOMALY_COLUMN } from '@/shared/excludeAnomalyColumn';
import {
  detectAnomalies as detectAnomaliesCore,
  detectAccountBalanceAnomalies as detectAccountBalanceAnomaliesCore,
  type AccountBalanceActiveAccount,
  type AccountBalanceAnomalyResult,
  type AnomalyResult,
  type TransactionAnomalyContext,
} from '@/shared/anomalyDetectionCore';
import type { AnomalyReason } from '@/shared/anomalyReasons';
import {
  collectRecognisedAccountLabelsSet,
  loadRecognisedAccountsFromStorage,
} from '../constants/recognisedAccountsStorage';
import {
  loadRecognisedEntryTypesFromStorage,
  loadRecognisedOutputTypesFromStorage,
} from '../constants/recognisedTypesStorage';
import i18n from '../i18n';
import { formatAnomalyReason } from '../i18n/formatAnomalyReason';

export { EXCLUDE_ANOMALY_COLUMN };
export type {
  AnomalyRow,
  AnomalyResult,
  AccountBalanceActiveAccount,
  AccountBalanceAnomalyRow,
  AccountBalanceAnomalyResult,
} from '@/shared/anomalyDetectionCore';

export function buildTransactionAnomalyContextFromStorage(): TransactionAnomalyContext {
  const labels = Array.from(collectRecognisedAccountLabelsSet(loadRecognisedAccountsFromStorage()));
  return {
    recognisedAccountLabels: labels,
    recognisedEntryTypes: loadRecognisedEntryTypesFromStorage(),
    recognisedOutputTypes: loadRecognisedOutputTypesFromStorage(),
  };
}

export interface DetectAnomaliesOptions {
  referenceDate?: Date;
  context?: TransactionAnomalyContext;
}

function localizedFormatOptions() {
  return {
    formatReason: (reason: AnomalyReason) => formatAnomalyReason(reason, i18n.t.bind(i18n)),
  };
}

export function detectAnomalies(data: SourceDataResult, options?: DetectAnomaliesOptions): AnomalyResult {
  const context = options?.context ?? buildTransactionAnomalyContextFromStorage();
  return detectAnomaliesCore(data, context, localizedFormatOptions());
}

export function detectAccountBalanceAnomalies(
  headers: string[],
  rows: Record<string, string>[],
  activeAccounts: AccountBalanceActiveAccount[]
): AccountBalanceAnomalyResult {
  return detectAccountBalanceAnomaliesCore(headers, rows, activeAccounts, localizedFormatOptions());
}
