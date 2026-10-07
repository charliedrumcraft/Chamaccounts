import type { TFunction } from 'i18next';
import {
  formatAnomalyReasonFr,
  type AnomalyReason,
  type AnomalyReasonCode,
} from '@/shared/anomalyReasons';

const I18N_KEYS: Record<AnomalyReasonCode, string> = {
  COLUMN_USUALLY_EMPTY: 'anomalies.columnUsuallyEmpty',
  COLUMN_USUALLY_FILLED_EMPTY: 'anomalies.columnUsuallyFilledEmpty',
  UNKNOWN_ACCOUNT: 'anomalies.unknownAccount',
  UNKNOWN_TYPE: 'anomalies.unknownType',
  EXPENSE_TYPE_WITH_INCOME: 'anomalies.expenseTypeWithIncome',
  INCOME_TYPE_WITH_EXPENSE: 'anomalies.incomeTypeWithExpense',
  ZERO_AMOUNT: 'anomalies.zeroAmount',
  DATE_CHRONOLOGY: 'anomalies.dateChronology',
  DUPLICATE_ROW: 'anomalies.duplicateRow',
  BALANCE_COLUMN_COUNT_MISMATCH: 'anomalies.balanceColumnCountMismatch',
  BALANCE_UNKNOWN_ACCOUNT_COLUMN: 'anomalies.balanceUnknownAccountColumn',
  BALANCE_INACTIVE_ACCOUNT_COLUMN: 'anomalies.balanceInactiveAccountColumn',
  BALANCE_MISSING_DATE: 'anomalies.balanceMissingDate',
  BALANCE_INVALID_DATE: 'anomalies.balanceInvalidDate',
  BALANCE_DATE_NOT_FIRST_OF_MONTH: 'anomalies.balanceDateNotFirstOfMonth',
  BALANCE_DUPLICATE_DATE: 'anomalies.balanceDuplicateDate',
  BALANCE_WRONG_CURRENCY: 'anomalies.balanceWrongCurrency',
  BALANCE_FILE_MISSING: 'anomalies.balanceFileMissing',
};

export function formatAnomalyReason(reason: AnomalyReason, t: TFunction): string {
  const key = I18N_KEYS[reason.code];
  if (!key) return formatAnomalyReasonFr(reason);
  return t(key, reason.params ?? {});
}

export function formatAnomalyReasons(reasons: AnomalyReason[], t: TFunction): string {
  return reasons.map((r) => formatAnomalyReason(r, t)).join(' ; ');
}
