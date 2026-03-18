/**
 * Service pour lire les soldes des comptes depuis account_balance.csv (ou Account-Balance.csv) dans data/AccountBalanceData/Processed.
 * On utilise uniquement les lignes au début de chaque mois (jour = 1) pour le graphique.
 */

import { FileService } from './FileService';
import Papa from 'papaparse';
import { parse, isValid, format, startOfDay, getDate } from 'date-fns';
import { fr } from 'date-fns/locale';

const COLUMN_TO_ACCOUNT_CODE: Record<string, string> = {
  'HSBC SAVINGS': 'HSBC_SAVINGS',
  'HSBC A/C': 'HSBC_AC',
  'LB CM': 'CM',
  'N26 Charlie': 'N26FR',
  'N26 Maria': 'N26DE',
  'Revolut GBP': 'REV_GBP',
  'Revolut GBP Savings': 'REV_GBP',
  'Revolut EUR': 'REV_EUR',
  'Revolut CHF': 'REV_CHF',
  'Advanzia': 'ADVZ',
  'Advanz': 'ADVZ',
  'Cash EUR': 'CASH',
};

/** Libellés d’affichage par code de compte (pour la légende du graphique). */
export const ACCOUNT_CODE_TO_LABEL: Record<string, string> = {
  HSBC_SAVINGS: 'HSBC OBS',
  HSBC_AC: 'HSBC A/C',
  CM: 'LB CM',
  N26FR: 'N26 Charlie',
  N26DE: 'N26 Maria',
  REV_GBP: 'Revolut GBP',
  REV_EUR: 'Revolut EUR',
  REV_CHF: 'Revolut CHF',
  ADVZ: 'Advanzia',
  CASH: 'Cash EUR',
};

/** Tous les libellés/codes de compte reconnus par l'app (pour la détection d'anomalies). */
export const KNOWN_ACCOUNT_NAMES = new Set<string>([
  ...Object.keys(COLUMN_TO_ACCOUNT_CODE),
  ...Object.values(ACCOUNT_CODE_TO_LABEL),
  ...Object.keys(ACCOUNT_CODE_TO_LABEL),
  'HSBC', // libellé court utilisé dans source_data
]);

/** Symbole ou code devise par code de compte (pour l'affichage des soldes). */
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

const ACCOUNT_BALANCE_FILES = ['Account-Balance.csv', 'Account_balance.csv', 'account_balance.csv'];

const DEFAULT_ACCOUNT_COLORS: Record<string, string> = {
  // HSBC = nuances de rouge
  HSBC_SAVINGS: '#dc2626',
  HSBC_AC: '#ef4444',
  // LB CM (non spécifié : teal pour rester distinct)
  CM: '#0d9488',
  // N26 = nuances de vert
  N26FR: '#059669',
  N26DE: '#10b981',
  // Revolut = nuances de violet
  REV_GBP: '#7c3aed',
  REV_EUR: '#8b5cf6',
  REV_CHF: '#a78bfa',
  // Advanzia = bleu
  ADVZ: '#2563eb',
  // Cash = gris
  CASH: '#64748b',
};

export interface BalanceRow {
  date: Date;
  balances: Record<string, number>;
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

  private static parseCSVDate(dateStr: string): Date | null {
    if (!dateStr || !String(dateStr).trim()) return null;
    const s = String(dateStr).trim();
    const ref = new Date();
    // Accepter DD.MM.YYYY et DD/MM/YYYY (même traitement)
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

  private static getDataDirectory(): string {
    return 'data/AccountBalanceData/Processed';
  }

  /**
   * Charge et parse le CSV (toutes les lignes). Utilisé en interne et pour le tableau.
   */
  private static async loadAllRows(): Promise<BalanceRow[] | null> {
    if (this.cache) return this.cache;

    const dataDir = this.getDataDirectory();
    let content: string | null = null;
    for (const fileName of ACCOUNT_BALANCE_FILES) {
      try {
        content = await FileService.readFile(`${dataDir}/${fileName}`);
        break;
      } catch {
        continue;
      }
    }
    if (!content) return null;

    return new Promise((resolve) => {
      Papa.parse(content!, {
        header: true,
        delimiter: ';',
        skipEmptyLines: true,
        complete: (results) => {
          if (!results.data?.length) {
            resolve(null);
            return;
          }
          const dateCol = 'DATE';
          const headers = results.meta.fields || [];
          const rows: BalanceRow[] = [];

          for (const row of results.data as Record<string, string>[]) {
            const dateVal = row[dateCol] ?? row['Date'] ?? '';
            const date = this.parseCSVDate(dateVal);
            if (!date) continue;

            const balances: Record<string, number> = {};
            for (const header of headers) {
              if (header === dateCol || header === 'Date') continue;
              const normalizedHeader = header?.trim().replace(/\s+/g, ' ');
              let code =
                COLUMN_TO_ACCOUNT_CODE[header] ??
                COLUMN_TO_ACCOUNT_CODE[normalizedHeader] ??
                COLUMN_TO_ACCOUNT_CODE[header?.trim()];
              if (!code) {
                for (const [csvHeader, accountCode] of Object.entries(COLUMN_TO_ACCOUNT_CODE)) {
                  if (normalizedHeader.includes(csvHeader) || csvHeader.includes(normalizedHeader)) {
                    code = accountCode;
                    break;
                  }
                }
              }
              if (!code) continue;
              const value = this.parseAmount(row[header]);
              if (value !== 0 || row[header] !== undefined) {
                balances[code] = (balances[code] ?? 0) + value;
              }
            }
            if (Object.keys(balances).length > 0) {
              rows.push({ date: startOfDay(date), balances });
            }
          }
          rows.sort((a, b) => a.date.getTime() - b.date.getTime());
          this.cache = rows;
          resolve(rows);
        },
      });
    });
  }

  /**
   * Charge toutes les lignes du CSV Account-balance (pour affichage tableau).
   */
  static async loadAllBalanceRows(): Promise<BalanceRow[] | null> {
    return this.loadAllRows();
  }

  /**
   * Charge et parse le CSV. Ne conserve que les lignes au 1er du mois.
   */
  static async loadMonthlyBalanceRows(): Promise<BalanceRow[] | null> {
    const allRows = await this.loadAllRows();
    if (!allRows) return null;
    return allRows.filter((r) => getDate(r.date) === 1);
  }

  static invalidateCache(): void {
    this.cache = null;
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

    const accountLabels = accountList.map(
      (code) => ACCOUNT_CODE_TO_LABEL[code] ?? code
    );

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
