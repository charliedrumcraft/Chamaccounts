/**
 * Service soldes de comptes : SQLite account_balance.db via IPC + miroir CSV.
 * On utilise uniquement les lignes au début de chaque mois (jour = 1) pour le graphique.
 */

import { ACCOUNT_BALANCE_PROCESSED_DIR } from '@/shared/dataPaths';
import { FileService } from './FileService';
import Papa from 'papaparse';
import { parse, isValid, format, startOfDay, getDate } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  SETTINGS_ACCOUNT_NAME_TO_CODE,
  COLUMN_TO_ACCOUNT_CODE,
  ACCOUNT_CODE_TO_CURRENCY,
  getBalanceCodeForSettingsAccountName,
  resolveAccountHeaderToCode as resolveAccountHeaderToCodeShared,
  defaultFiatForSettingsAccountName as defaultFiatShared,
  formatAmountForFiat as formatAmountForFiatShared,
  type AccountFiatCurrency,
  type BalanceAccountColumn,
  type BalanceRowDto,
} from '@/shared/accountBalanceCodes';
import i18n from '../i18n';

export {
  SETTINGS_ACCOUNT_NAME_TO_CODE,
  COLUMN_TO_ACCOUNT_CODE,
  getBalanceCodeForSettingsAccountName,
};
export type { AccountFiatCurrency };

/** Libellés d’affichage par code de compte (légende graphique, repli si pas dans Paramètres). */
export const ACCOUNT_CODE_TO_LABEL: Record<string, string> = {
  HSBC_SAVINGS: 'HSBC OBS',
  HSBC_AC: 'HSBC A/C',
  CM: 'CM',
  N26FR: 'N26FR',
  N26DE: 'N26DE',
  REV_GBP: 'REV GBP',
  REV_EUR: 'REV EUR',
  REV_CHF: 'REV CHF',
  ADVZ: 'Advanzia',
  CASH: 'Cash',
};

/** Libellé affiché : nom Paramètres si le code correspond à un compte actif, sinon libellé par défaut. */
export function getDisplayNameForAccountCode(
  code: string,
  recognisedAccountNames: string[]
): string {
  for (const name of recognisedAccountNames) {
    if (getBalanceCodeForSettingsAccountName(name) === code) return name;
  }
  return ACCOUNT_CODE_TO_LABEL[code] ?? code;
}

/** Tous les libellés/codes de compte reconnus par l'app (pour la détection d'anomalies). */
export const KNOWN_ACCOUNT_NAMES = new Set<string>([
  ...Object.keys(COLUMN_TO_ACCOUNT_CODE),
  ...Object.keys(SETTINGS_ACCOUNT_NAME_TO_CODE),
  ...Object.values(ACCOUNT_CODE_TO_LABEL),
  ...Object.keys(ACCOUNT_CODE_TO_LABEL),
  'HSBC', // libellé court utilisé dans source_data
]);

export { ACCOUNT_CODE_TO_CURRENCY };

/** Devise par défaut d’après le code interne (aligné sur l’existant src_account_balance.csv). */
export function defaultFiatForSettingsAccountName(name: string): AccountFiatCurrency {
  return defaultFiatShared(name);
}

/** Formate un montant pour le CSV ou l’UI selon la devise choisie (pas de conversion de valeur). */
export function formatAmountForFiat(amount: number, fiat: AccountFiatCurrency): string {
  return formatAmountForFiatShared(amount, fiat);
}

export const ACCOUNT_BALANCE_PROCESSED_FILENAMES = [
  'src_account_balance.csv',
  'Account_balance.csv',
  'account_balance.csv',
] as const;

const ACCOUNT_BALANCE_FILES = ACCOUNT_BALANCE_PROCESSED_FILENAMES;

const DEFAULT_ACCOUNT_COLORS: Record<string, string> = {
  HSBC_SAVINGS: '#dc2626',
  HSBC_AC: '#ef4444',
  CM: '#3b82f6',
  N26FR: '#059669',
  N26DE: '#10b981',
  REV_GBP: '#7c3aed',
  REV_EUR: '#8b5cf6',
  REV_CHF: '#a78bfa',
  ADVZ: '#2563eb',
  CASH: '#64748b',
};

export interface BalanceRow {
  date: Date;
  balances: Record<string, number>;
}

type ElectronBalanceApi = {
  accountBalanceGetAll?: () => Promise<{
    success: boolean;
    data?: BalanceRowDto[] | null;
    error?: string;
  }>;
  accountBalanceGetMonthlyChart?: () => Promise<{
    success: boolean;
    data?: {
      periods: string[];
      dateMsList: number[];
      accounts: string[];
      accountCodes: string[];
      balanceData: number[][];
      accountColors: Record<string, string>;
      granularity: 'month';
    } | null;
    error?: string;
  }>;
  accountBalanceNearestRow?: (
    targetMs: number
  ) => Promise<{ success: boolean; data?: BalanceRowDto | null; error?: string }>;
  accountBalanceGetMirrorHeaders?: () => Promise<{
    success: boolean;
    data?: string[] | null;
    error?: string;
  }>;
  accountBalanceDetectAnomalies?: (payload: {
    activeAccounts: Array<{ name: string; currency: AccountFiatCurrency }>;
    writeReport?: boolean;
  }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  accountBalanceReplaceAll?: (payload: {
    rows: BalanceRowDto[];
    accounts: BalanceAccountColumn[];
  }) => Promise<{ success: boolean; error?: string; count: number }>;
  accountBalanceRewriteColumns?: (
    accounts: BalanceAccountColumn[]
  ) => Promise<{ success: boolean; error?: string }>;
};

function getBalanceApi(): ElectronBalanceApi | undefined {
  return (window as unknown as { electronAPI?: ElectronBalanceApi }).electronAPI;
}

function dtoToBalanceRow(dto: BalanceRowDto): BalanceRow {
  return {
    date: startOfDay(new Date(dto.dateMs)),
    balances: { ...dto.balances },
  };
}

function balanceRowToDto(row: BalanceRow): BalanceRowDto {
  return {
    dateMs: startOfDay(row.date).getTime(),
    balances: { ...row.balances },
  };
}

export class AccountBalanceCSVService {
  private static cache: BalanceRow[] | null = null;

  private static parseAmount(raw: string | undefined): number {
    if (raw === undefined || raw === null) return 0;
    const s = String(raw).trim();
    if (s === '' || s === '-' || /^-?\s*(€|£|CHF)?\s*$/i.test(s)) return 0;
    const cleaned = s.replace(/[\s£€CHF]/gi, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }

  /** Parse une cellule montant (même règles que le CSV Account-Balance). */
  static parseBalanceAmount(raw: string | undefined): number {
    return this.parseAmount(raw);
  }

  private static parseCSVDate(dateStr: string): Date | null {
    if (!dateStr || !String(dateStr).trim()) return null;
    const s = String(dateStr).trim();
    const ref = new Date();
    const formats = ['dd.MM.yy', 'dd.MM.yyyy', 'dd/MM/yy', 'dd/MM/yyyy'] as const;
    for (const fmt of formats) {
      const d = parse(s, fmt, ref);
      if (isValid(d)) {
        const year = d.getFullYear();
        if (year >= 2000 && year <= 2099) return d;
        if (year < 100 && (fmt === 'dd.MM.yy' || fmt === 'dd/MM/yy')) {
          d.setFullYear(year + 100);
          return d;
        }
        if (year >= 1900 && year < 2100) return d;
      }
    }
    return null;
  }

  /** Parse une saisie date (JJ.MM.AAAA, JJ/MM/AAAA, yy). */
  static parseBalanceDateInput(raw: string): Date | null {
    return this.parseCSVDate(String(raw ?? '').trim());
  }

  private static getDataDirectory(): string {
    return ACCOUNT_BALANCE_PROCESSED_DIR;
  }

  /**
   * Parse le contenu CSV des soldes (même format que src_account_balance.csv).
   */
  static parseBalanceCsvContent(content: string): BalanceRow[] | null {
    const results = Papa.parse(content, {
      header: true,
      delimiter: ';',
      skipEmptyLines: true,
    });
    if (!results.data?.length) {
      return null;
    }
    const headers = (results.meta.fields || []).map((f) => f?.replace(/^\uFEFF/, '').trim() ?? '');
    const rows = this.rowsFromParsedRecords(headers, results.data as Record<string, string>[]);
    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    return rows;
  }

  private static rowsFromParsedRecords(
    headers: string[],
    data: Record<string, string>[]
  ): BalanceRow[] {
    const dateCol = headers.find((h) => /^date$/i.test(h)) ?? 'DATE';
    const rows: BalanceRow[] = [];

    for (const row of data) {
      const dateVal = row[dateCol] ?? row['DATE'] ?? row['Date'] ?? '';
      const date = this.parseCSVDate(String(dateVal).trim());
      if (!date) continue;

      const balances: Record<string, number> = {};
      for (const header of headers) {
        if (!header || /^date$/i.test(header)) continue;
        const code = this.resolveAccountHeaderToCode(header);
        if (!code) continue;
        const value = this.parseAmount(row[header]);
        const rawCell = row[header];
        if (value !== 0 || String(rawCell ?? '').trim() !== '') {
          balances[code] = (balances[code] ?? 0) + value;
        }
      }
      if (Object.keys(balances).length > 0) {
        rows.push({ date: startOfDay(date), balances });
      }
    }
    return rows;
  }

  /**
   * Sérialise les lignes de soldes pour src_account_balance.csv (ordre des colonnes = Paramètres).
   */
  static balanceRowsToCsv(
    rows: BalanceRow[],
    accounts: { name: string; currency: AccountFiatCurrency }[],
    dateKey = 'DATE'
  ): string {
    const orderedEntries = accounts
      .map((a) => ({ name: a.name.trim(), currency: a.currency }))
      .filter((a) => a.name && getBalanceCodeForSettingsAccountName(a.name));
    const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
    const outRows: Record<string, string>[] = sorted.map((row) => {
      const o: Record<string, string> = { [dateKey]: format(row.date, 'dd.MM.yy') };
      for (const { name, currency } of orderedEntries) {
        const code = getBalanceCodeForSettingsAccountName(name);
        const v = code ? row.balances[code] : undefined;
        o[name] =
          v !== undefined && Math.abs(v) >= 1e-9 ? formatAmountForFiat(v, currency) : '';
      }
      return o;
    });
    return Papa.unparse(
      {
        fields: [dateKey, ...orderedEntries.map((e) => e.name)],
        data: outRows,
      },
      { delimiter: ';' }
    );
  }

  /**
   * Charge toutes les lignes depuis SQLite (IPC). Utilisé en interne et pour le tableau.
   */
  private static async loadAllRows(): Promise<BalanceRow[] | null> {
    if (this.cache) return this.cache;

    const api = getBalanceApi();
    if (!api?.accountBalanceGetAll) return null;
    try {
      const result = await api.accountBalanceGetAll();
      if (!result.success || !result.data) return null;
      const rows = result.data.map(dtoToBalanceRow);
      rows.sort((a, b) => a.date.getTime() - b.date.getTime());
      this.cache = rows;
      return rows;
    } catch {
      return null;
    }
  }

  /**
   * Charge toutes les lignes Account-balance (pour affichage tableau).
   */
  static async loadAllBalanceRows(): Promise<BalanceRow[] | null> {
    return this.loadAllRows();
  }

  /**
   * Charge et ne conserve que les lignes au 1er du mois.
   */
  static async loadMonthlyBalanceRows(): Promise<BalanceRow[] | null> {
    const allRows = await this.loadAllRows();
    if (!allRows) return null;
    return allRows.filter((r) => getDate(r.date) === 1);
  }

  static invalidateCache(): void {
    this.cache = null;
  }

  static async loadNearestBalanceRow(targetMs: number): Promise<BalanceRow | null> {
    const api = getBalanceApi();
    if (!api?.accountBalanceNearestRow) return null;
    try {
      const result = await api.accountBalanceNearestRow(targetMs);
      if (!result.success || !result.data) return null;
      return {
        date: startOfDay(new Date(result.data.dateMs)),
        balances: { ...result.data.balances },
      };
    } catch {
      return null;
    }
  }

  static async loadMirrorHeaders(): Promise<string[] | null> {
    const api = getBalanceApi();
    if (!api?.accountBalanceGetMirrorHeaders) return null;
    try {
      const result = await api.accountBalanceGetMirrorHeaders();
      if (!result.success || !result.data) return null;
      return result.data;
    } catch {
      return null;
    }
  }

  static async detectAnomalies(payload: {
    activeAccounts: Array<{ name: string; currency: AccountFiatCurrency }>;
    writeReport?: boolean;
  }): Promise<
    | (import('@/shared/transactionQueryTypes').DetectAnomaliesResultDto & {
        fileLevelReasons?: import('@/shared/anomalyReasons').AnomalyReason[];
      })
    | null
  > {
    const api = getBalanceApi();
    if (!api?.accountBalanceDetectAnomalies) return null;
    try {
      const result = await api.accountBalanceDetectAnomalies(payload);
      if (!result.success || !result.data) return null;
      return result.data as import('@/shared/transactionQueryTypes').DetectAnomaliesResultDto & {
        fileLevelReasons?: import('@/shared/anomalyReasons').AnomalyReason[];
      };
    } catch {
      return null;
    }
  }

  /**
   * Lit le CSV miroir Processed tel quel (lignes brutes) pour la détection d'anomalies.
   */
  static async loadRawCsvRows(): Promise<{
    headers: string[];
    rows: Record<string, string>[];
  } | null> {
    const dataDir = this.getDataDirectory();
    for (const fileName of ACCOUNT_BALANCE_FILES) {
      try {
        const content = await FileService.readFile(`${dataDir}/${fileName}`);
        const parsed = Papa.parse(content, {
          header: true,
          delimiter: ';',
          skipEmptyLines: true,
        });
        if (!parsed.data?.length) return null;
        return {
          headers: (parsed.meta.fields || []).map((f) => f?.replace(/^\uFEFF/, '').trim() ?? ''),
          rows: parsed.data as Record<string, string>[],
        };
      } catch {
        continue;
      }
    }
    return null;
  }

  static resolveAccountHeaderToCode(header: string | undefined): string | undefined {
    return resolveAccountHeaderToCodeShared(header);
  }

  /**
   * Réécrit colonnes soldes (DB + miroir CSV) selon l’ordre des comptes Paramètres.
   */
  static async rewriteCsvWithColumnOrder(
    accounts: { name: string; currency: AccountFiatCurrency }[]
  ): Promise<{ success: boolean; error?: string }> {
    this.invalidateCache();
    const api = getBalanceApi();
    if (!api?.accountBalanceRewriteColumns) {
      return { success: false, error: i18n.t('system.apiUnavailable', { name: 'accountBalanceRewriteColumns' }) };
    }
    try {
      const result = await api.accountBalanceRewriteColumns(accounts);
      this.invalidateCache();
      return result.success ? { success: true } : { success: false, error: result.error };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Enregistre les lignes de soldes dans SQLite (+ miroir CSV).
   */
  static async saveBalanceRowsToProcessed(
    rows: BalanceRow[],
    accounts: { name: string; currency: AccountFiatCurrency }[]
  ): Promise<{ success: boolean; error?: string }> {
    this.invalidateCache();
    const api = getBalanceApi();
    if (!api?.accountBalanceReplaceAll) {
      return { success: false, error: i18n.t('system.apiUnavailable', { name: 'accountBalanceReplaceAll' }) };
    }
    try {
      const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
      const result = await api.accountBalanceReplaceAll({
        rows: sorted.map(balanceRowToDto),
        accounts,
      });
      this.invalidateCache();
      return result.success ? { success: true } : { success: false, error: result.error };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }

  /**
   * Retourne les données pour le graphique : solde de chaque compte au début de chaque mois.
   */
  static async getMonthlyBalancesForChart(): Promise<{
    periods: string[];
    dates: Date[];
    accounts: string[];
    accountCodes: string[];
    balanceData: number[][];
    accountColors: Record<string, string>;
    granularity: 'day' | 'week' | 'month';
  } | null> {
    const api = getBalanceApi();
    if (api?.accountBalanceGetMonthlyChart) {
      try {
        const result = await api.accountBalanceGetMonthlyChart();
        if (result.success && result.data) {
          return {
            periods: result.data.periods,
            dates: result.data.dateMsList.map((ms) => new Date(ms)),
            accounts: result.data.accounts,
            accountCodes: result.data.accountCodes,
            balanceData: result.data.balanceData,
            accountColors: result.data.accountColors,
            granularity: 'month',
          };
        }
      } catch {
        /* fallback below */
      }
    }

    const rows = await this.loadMonthlyBalanceRows();
    if (!rows || rows.length === 0) return null;

    const allCodes = new Set<string>();
    rows.forEach((r) => Object.keys(r.balances).forEach((c) => allCodes.add(c)));
    const accountList = Array.from(allCodes).sort();

    const periods = rows.map((r) => format(r.date, 'MMM yyyy', { locale: fr }));
    const dates = rows.map((r) => r.date);
    const accountColors: Record<string, string> = {};
    accountList.forEach((code) => {
      accountColors[code] = DEFAULT_ACCOUNT_COLORS[code] ?? '#808080';
    });

    const balanceData: number[][] = accountList.map((accountCode) => {
      return rows.map((row) => {
        const v = row.balances[accountCode];
        return v !== undefined ? v : 0;
      });
    });

    const accountLabels = accountList.map((code) => ACCOUNT_CODE_TO_LABEL[code] ?? code);

    return {
      periods,
      dates,
      accounts: accountLabels,
      accountCodes: accountList,
      balanceData,
      accountColors,
      granularity: 'month',
    };
  }
}
