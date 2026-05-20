/**
 * Devise par code de compte (cohérent avec src_account_balance.csv : £ GBP, € EUR, CHF).
 */
export const ACCOUNT_CURRENCY: Record<string, string> = {
  HSBC_SAVINGS: '£',
  HSBC_AC: '£',
  CM: '€',
  N26FR: '€',
  N26DE: '€',
  REV_GBP: '£',
  REV_EUR: '€',
  REV_CHF: 'CHF',
  ADVZ: '€',
  CASH: '€',
};

export function getAccountCurrency(accountCode: string): string {
  return ACCOUNT_CURRENCY[accountCode] ?? '€';
}
