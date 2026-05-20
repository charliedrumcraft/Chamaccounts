/**
 * Service pour lire les soldes des comptes depuis account_balance.csv (ou src_account_balance.csv) dans data/AccountBalanceData/Processed.
 * On utilise uniquement les lignes au début de chaque mois (jour = 1) pour le graphique.
 */

import { ACCOUNT_BALANCE_PROCESSED_DIR } from '@/shared/dataPaths';
import { FileService } from './FileService';
import Papa from 'papaparse';
import { parse, isValid, format, startOfDay, getDate } from 'date-fns';
import { fr } from 'date-fns/locale';

/**
 * Noms des comptes actifs (Paramètres) → code interne stable.
 * Les en-têtes de src_account_balance.csv utilisent ces libellés après migration.
 */
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

/**
 * Clé des soldes pour un libellé Paramètres : code prédéfini (ex. Advanzia → ADVZ, CM → CM)
 * ou le libellé lui-même pour un compte ajouté par l’utilisateur (= en-tête de colonne dans src_account_balance.csv).
 */
export function getBalanceCodeForSettingsAccountName(name: string): string | null {
  const t = name.trim();
  if (!t) return null;
  if (t === 'LM') return 'CM';
  const mapped = SETTINGS_ACCOUNT_NAME_TO_CODE[t];
  if (mapped !== undefined) return mapped;
  return t;
}

/** En-têtes CSV → code interne (import, anomalies, fusion). */
export const COLUMN_TO_ACCOUNT_CODE: Record<string, string> = {
  ...SETTINGS_ACCOUNT_NAME_TO_CODE,
  // Anciens en-têtes CSV (rétrocompatibilité)
  'HSBC SAVINGS': 'HSBC_SAVINGS',
  /** Ancien libellé Paramètres / en-tête CSV (même code interne que CM). */
  LM: 'CM',
  'LB CM': 'CM',
  'N26 Charlie': 'N26FR',
  'N26 Maria': 'N26DE',
  'Revolut GBP': 'REV_GBP',
  'Revolut GBP Savings': 'REV_GBP',
  'Revolut EUR': 'REV_EUR',
  'Revolut CHF': 'REV_CHF',
  'Cash EUR': 'CASH',
  Advanz: 'ADVZ',
};

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

/** Symbole ou code devise par code de compte (défaut si non surchargé dans Paramètres). */
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

/** Devise d’affichage / du CSV pour un compte Paramètres (les montants ne sont pas convertis, seul le format change). */
export type AccountFiatCurrency = 'EUR' | 'GBP' | 'CHF';

/** Devise par défaut d’après le code interne (aligné sur l’existant src_account_balance.csv). */
export function defaultFiatForSettingsAccountName(name: string): AccountFiatCurrency {
  const code = getBalanceCodeForSettingsAccountName(name);
  if (!code) return 'EUR';
  const sym = ACCOUNT_CODE_TO_CURRENCY[code] ?? '€';
  if (sym === '£') return 'GBP';
  if (sym === 'CHF') return 'CHF';
  return 'EUR';
}

/** Formate un montant pour le CSV ou l’UI selon la devise choisie (pas de conversion de valeur). */
export function formatAmountForFiat(amount: number, fiat: AccountFiatCurrency): string {
  if (Math.abs(amount) < 1e-9) return '';
  const neg = amount < 0;
  const v = Math.abs(amount);
  const [intPart, dec] = v
    .toFixed(2)
    .replace('.', ',')
    .split(',');
  const intDotted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (fiat === 'GBP') {
    return `${neg ? '-' : ''}£${intDotted},${dec}`;
  }
  if (fiat === 'CHF') {
    return `${neg ? '-' : ''}${intDotted},${dec} CHF`;
  }
  return `${neg ? '-' : ''}${intDotted},${dec} €`;
}

export const ACCOUNT_BALANCE_PROCESSED_FILENAMES = [
  'src_account_balance.csv',
  'Account_balance.csv',
  'account_balance.csv',
] as const;

const ACCOUNT_BALANCE_FILES = ACCOUNT_BALANCE_PROCESSED_FILENAMES;

const DEFAULT_ACCOUNT_COLORS: Record<string, string> = {
  // HSBC = nuances de rouge
  HSBC_SAVINGS: '#dc2626',
  HSBC_AC: '#ef4444',
  // CM : bleu un peu plus clair qu’Advanzia (#2563eb)
  CM: '#3b82f6',
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

  /** Parse une cellule montant (même règles que le CSV Account-Balance). */
  static parseBalanceAmount(raw: string | undefined): number {
    return this.parseAmount(raw);
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

    const rows = this.parseBalanceCsvContent(content);
    if (rows !== null) {
      this.cache = rows;
    }
    return rows;
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
   * Lit le CSV Processed tel quel (lignes brutes) pour la détection d'anomalies.
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

  /**
   * Agrège les cellules du fichier courant pour un libellé Paramètres (même code interne, ex. deux colonnes Revolut GBP).
   */
  private static mergedCellForAccount(
    row: Record<string, string>,
    accountDisplayName: string,
    fiat: AccountFiatCurrency
  ): string {
    const code = getBalanceCodeForSettingsAccountName(accountDisplayName);
    if (!code) return '';
    let sum = 0;
    let anyRaw = false;
    for (const h of Object.keys(row)) {
      const ht = h.replace(/^\uFEFF/, '').trim();
      if (!ht || /^date$/i.test(ht)) continue;
      const mapped = this.resolveAccountHeaderToCode(h);
      if (mapped !== code) continue;
      const raw = row[h];
      if (raw !== undefined && String(raw).trim() !== '') anyRaw = true;
      sum += this.parseAmount(raw);
    }
    if (!anyRaw && Math.abs(sum) < 1e-9) return '';
    return formatAmountForFiat(sum, fiat);
  }

  /**
   * Réécrit src_account_balance.csv : colonnes après DATE = ordre des comptes Paramètres (nom + devise d’affichage).
   */
  static async rewriteCsvWithColumnOrder(
    accounts: { name: string; currency: AccountFiatCurrency }[]
  ): Promise<{ success: boolean; error?: string }> {
    this.invalidateCache();
    const dataDir = this.getDataDirectory();
    let fileNameUsed: string | null = null;
    let content: string | null = null;
    for (const fileName of ACCOUNT_BALANCE_FILES) {
      try {
        content = await FileService.readFile(`${dataDir}/${fileName}`);
        fileNameUsed = fileName;
        break;
      } catch {
        continue;
      }
    }
    if (!content || !fileNameUsed) {
      return { success: false, error: 'src_account_balance.csv introuvable.' };
    }

    const parsed = Papa.parse(content, {
      header: true,
      delimiter: ';',
      skipEmptyLines: true,
    });

    if (!parsed.data?.length) {
      return { success: false, error: 'Fichier src_account_balance.csv vide.' };
    }

    const rawFields = (parsed.meta.fields || []).map((f) => f?.replace(/^\uFEFF/, '').trim() ?? '');
    const dateKey = rawFields.find((f) => /^date$/i.test(f)) ?? 'DATE';

    const orderedEntries = accounts
      .map((a) => ({ name: a.name.trim(), currency: a.currency }))
      .filter((a) => a.name && getBalanceCodeForSettingsAccountName(a.name));

    const outRows: Record<string, string>[] = [];
    for (const row of parsed.data as Record<string, string>[]) {
      const dateVal = row[dateKey] ?? row['DATE'] ?? row['Date'] ?? '';
      if (!String(dateVal).trim()) continue;
      const date = this.parseCSVDate(String(dateVal).trim());
      if (!date) continue;
      const out: Record<string, string> = { [dateKey]: String(dateVal).trim() };
      for (const { name, currency } of orderedEntries) {
        out[name] = this.mergedCellForAccount(row, name, currency);
      }
      outRows.push(out);
    }

    if (outRows.length === 0) {
      return { success: false, error: 'Aucune ligne de données valide dans src_account_balance.csv.' };
    }

    const csvOut = Papa.unparse(
      {
        fields: [dateKey, ...orderedEntries.map((e) => e.name)],
        data: outRows,
      },
      { delimiter: ';' }
    );

    const api = (
      window as unknown as {
        electronAPI?: {
          writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
        };
      }
    ).electronAPI;
    if (!api?.writeFile) {
      return { success: false, error: 'Écriture fichier non disponible (Electron).' };
    }

    const result = await api.writeFile(`${dataDir}/${fileNameUsed}`, csvOut);
    this.invalidateCache();
    return result.success ? { success: true } : { success: false, error: result.error ?? 'Écriture refusée.' };
  }

  /**
   * Enregistre les lignes de soldes dans Processed (même nom de fichier qu’à l’ouverture, sinon src_account_balance.csv).
   */
  static async saveBalanceRowsToProcessed(
    rows: BalanceRow[],
    accounts: { name: string; currency: AccountFiatCurrency }[]
  ): Promise<{ success: boolean; error?: string }> {
    this.invalidateCache();
    const dataDir = this.getDataDirectory();
    let fileNameUsed: string | null = null;
    for (const fileName of ACCOUNT_BALANCE_FILES) {
      try {
        await FileService.readFile(`${dataDir}/${fileName}`);
        fileNameUsed = fileName;
        break;
      } catch {
        continue;
      }
    }
    const target = fileNameUsed ?? 'src_account_balance.csv';
    const sorted = [...rows].sort((a, b) => a.date.getTime() - b.date.getTime());
    const csvOut = this.balanceRowsToCsv(sorted, accounts);

    const api = (
      window as unknown as {
        electronAPI?: {
          writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
        };
      }
    ).electronAPI;
    if (!api?.writeFile) {
      return { success: false, error: 'Écriture fichier non disponible (Electron).' };
    }

    const result = await api.writeFile(`${dataDir}/${target}`, csvOut);
    this.invalidateCache();
    return result.success ? { success: true } : { success: false, error: result.error ?? 'Écriture refusée.' };
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
