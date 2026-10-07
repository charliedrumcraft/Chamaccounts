/**
 * Mapping libellés Paramètres / en-têtes CSV → codes internes (partagé main + renderer).
 */

export type AccountFiatCurrency = string;

export const SETTINGS_ACCOUNT_NAME_TO_CODE: Record<string, string> = {
  CM: 'CM',
  'REV EUR': 'REV_EUR',
  'REV GBP': 'REV_GBP',
  'REV CHF': 'REV_CHF',
  N26FR: 'N26FR',
  N26DE: 'N26DE',
  'HSBC A/C': 'HSBC_AC',
  'HSBC OBS': 'HSBC_SAVINGS',
  Advanzia: 'ADVZ',
  Cash: 'CASH',
};

export const COLUMN_TO_ACCOUNT_CODE: Record<string, string> = {
  ...SETTINGS_ACCOUNT_NAME_TO_CODE,
  'HSBC SAVINGS': 'HSBC_SAVINGS',
  LM: 'CM',
  'LB CM': 'CM',
  'Revolut GBP': 'REV_GBP',
  'Revolut GBP Savings': 'REV_GBP',
  'Revolut EUR': 'REV_EUR',
  'Revolut CHF': 'REV_CHF',
  'Cash EUR': 'CASH',
  Advanz: 'ADVZ',
};

export const ACCOUNT_CODE_TO_CURRENCY: Record<string, string> = {
  REV_GBP: '£',
  REV_CHF: 'CHF',
  HSBC_SAVINGS: '£',
  HSBC_AC: '£',
  CM: '€',
  N26FR: '€',
  N26DE: '€',
  REV_EUR: '€',
  ADVZ: '€',
  CASH: '€',
};

export function getBalanceCodeForSettingsAccountName(name: string): string | null {
  const t = name.trim();
  if (!t) return null;
  if (t === 'LM') return 'CM';
  const mapped = SETTINGS_ACCOUNT_NAME_TO_CODE[t];
  if (mapped !== undefined) return mapped;
  return t;
}

export function resolveAccountHeaderToCode(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const normalizedHeader = header.replace(/^\uFEFF/, '').trim().replace(/\s+/g, ' ');
  if (!normalizedHeader || /^date$/i.test(normalizedHeader)) return undefined;
  let code =
    COLUMN_TO_ACCOUNT_CODE[header] ??
    COLUMN_TO_ACCOUNT_CODE[normalizedHeader] ??
    COLUMN_TO_ACCOUNT_CODE[header.trim()];
  if (!code) {
    for (const [csvHeader, accountCode] of Object.entries(COLUMN_TO_ACCOUNT_CODE)) {
      if (normalizedHeader.includes(csvHeader) || csvHeader.includes(normalizedHeader)) {
        code = accountCode;
        break;
      }
    }
  }
  if (code) return code;
  return normalizedHeader;
}

export function defaultFiatForSettingsAccountName(name: string): AccountFiatCurrency {
  const code = getBalanceCodeForSettingsAccountName(name);
  if (!code) return 'EUR';
  const sym = ACCOUNT_CODE_TO_CURRENCY[code] ?? '€';
  if (sym === '£') return 'GBP';
  if (sym === 'CHF') return 'CHF';
  return 'EUR';
}

export function formatAmountForFiat(amount: number, fiat: AccountFiatCurrency): string {
  if (Math.abs(amount) < 1e-9) return '';
  const neg = amount < 0;
  const v = Math.abs(amount);
  const [intPart, dec] = v.toFixed(2).replace('.', ',').split(',');
  const intDotted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (fiat === 'GBP') {
    return `${neg ? '-' : ''}£${intDotted},${dec}`;
  }
  if (fiat === 'CHF') {
    return `${neg ? '-' : ''}${intDotted},${dec} CHF`;
  }
  return `${neg ? '-' : ''}${intDotted},${dec} €`;
}

/** DTO IPC (Date non sérialisable). */
export interface BalanceRowDto {
  dateMs: number;
  balances: Record<string, number>;
}

export interface BalanceAccountColumn {
  name: string;
  currency: AccountFiatCurrency;
}
