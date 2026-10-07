/**
 * Store SQLite soldes (EAV) + migration CSV + miroir CSV.
 */

import type { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  ACCOUNT_BALANCE_CSV_PATH,
  ACCOUNT_BALANCE_PROCESSED_DIR,
} from '../../shared/dataPaths';
import {
  getBalanceCodeForSettingsAccountName,
  resolveAccountHeaderToCode,
  type BalanceAccountColumn,
  type BalanceRowDto,
} from '../../shared/accountBalanceCodes';
import { writeAccountBalanceCsvMirror } from './accountBalanceCsvMirror';
import {
  csvMirrorNeedsResyncFromCsv,
  rememberCsvMirrorHash,
} from './csvMirrorSync';
import {
  closeAccountBalanceDb,
  openAccountBalanceDb,
  persistAccountBalanceDb,
} from './accountBalanceDb';
import { queryAll, queryOne } from './sqlJsRuntime';
import { tm } from '../uiI18n';

function accountBalanceCsvPath(dataRoot: string): string {
  return path.join(dataRoot, ACCOUNT_BALANCE_CSV_PATH);
}

function writeBalanceMirror(
  dataRoot: string,
  rows: BalanceRowDto[],
  accounts: BalanceAccountColumn[],
  database: Database
): void {
  writeAccountBalanceCsvMirror(dataRoot, rows, accounts);
  rememberCsvMirrorHash(database, accountBalanceCsvPath(dataRoot), persistAccountBalanceDb);
}

const CSV_CANDIDATES = [
  'src_account_balance.csv',
  'Account_balance.csv',
  'account_balance.csv',
] as const;

function dateKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function msFromDateKey(key: string): number {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

function parseAmount(raw: string | undefined): number {
  if (raw === undefined || raw === null) return 0;
  const s = String(raw).trim();
  if (s === '' || s === '-' || /^-?\s*(€|£|CHF)?\s*$/i.test(s)) return 0;
  const cleaned = s.replace(/[\s£€CHF]/gi, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

function parseCsvDate(dateStr: string): Date | null {
  if (!dateStr?.trim()) return null;
  const s = String(dateStr).trim();
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/;
  const md = s.match(dmy);
  if (!md) return null;
  const day = parseInt(md[1], 10);
  const month = parseInt(md[2], 10);
  let year = parseInt(md[3], 10);
  if (md[3].length === 2) year = year < 50 ? 2000 + year : 1900 + year;
  if (year < 1900 || year > 2100) return null;
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ';') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function readCsvAsBalanceDtos(dataRoot: string): BalanceRowDto[] {
  const dir = path.join(dataRoot, ACCOUNT_BALANCE_PROCESSED_DIR);
  let content: string | null = null;
  for (const name of CSV_CANDIDATES) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      content = fs.readFileSync(p, 'utf-8');
      break;
    }
  }
  if (!content?.trim()) return [];

  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length <= 1) return [];
  const headers = parseCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').trim());
  const dateColIdx = headers.findIndex((h) => /^date$/i.test(h));
  if (dateColIdx < 0) return [];

  const byDate = new Map<string, BalanceRowDto>();
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const date = parseCsvDate(values[dateColIdx] ?? '');
    if (!date) continue;
    const dateMs = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const key = dateKeyFromMs(dateMs);
    let row = byDate.get(key);
    if (!row) {
      row = { dateMs, balances: {} };
      byDate.set(key, row);
    }
    headers.forEach((header, c) => {
      if (c === dateColIdx || !header || /^date$/i.test(header)) return;
      const code = resolveAccountHeaderToCode(header);
      if (!code) return;
      const value = parseAmount(values[c]);
      const raw = values[c] ?? '';
      if (value !== 0 || String(raw).trim() !== '') {
        row!.balances[code] = (row!.balances[code] ?? 0) + value;
      }
    });
  }
  return Array.from(byDate.values())
    .filter((r) => Object.keys(r.balances).length > 0)
    .sort((a, b) => a.dateMs - b.dateMs);
}

function countSnapshots(database: Database): number {
  const row = queryOne(database, 'SELECT COUNT(*) AS n FROM balance_snapshots');
  return Number(row?.n ?? 0);
}

function insertBalanceRows(database: Database, rows: BalanceRowDto[], replace: boolean): void {
  database.run('BEGIN');
  try {
    if (replace) {
      database.run('DELETE FROM balance_amounts');
      database.run('DELETE FROM balance_snapshots');
    }
    for (const row of rows) {
      const key = dateKeyFromMs(row.dateMs);
      database.run('INSERT OR REPLACE INTO balance_snapshots (date_key) VALUES (?)', [key]);
      database.run('DELETE FROM balance_amounts WHERE date_key = ?', [key]);
      for (const [code, amount] of Object.entries(row.balances)) {
        if (!code) continue;
        database.run(
          'INSERT INTO balance_amounts (date_key, account_code, amount) VALUES (?, ?, ?)',
          [key, code, amount]
        );
      }
    }
    database.run('COMMIT');
  } catch (err) {
    try {
      database.run('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  }
  persistAccountBalanceDb();
}

function selectAllBalanceDtos(database: Database): BalanceRowDto[] {
  const snaps = queryAll(database, 'SELECT date_key FROM balance_snapshots ORDER BY date_key ASC');
  const amounts = queryAll(
    database,
    'SELECT date_key, account_code, amount FROM balance_amounts'
  );
  const byKey = new Map<string, BalanceRowDto>();
  for (const s of snaps) {
    const key = String(s.date_key ?? '');
    const ms = msFromDateKey(key);
    if (!Number.isFinite(ms)) continue;
    byKey.set(key, { dateMs: ms, balances: {} });
  }
  for (const a of amounts) {
    const key = String(a.date_key ?? '');
    const row = byKey.get(key);
    if (!row) continue;
    const code = String(a.account_code ?? '');
    if (!code) continue;
    row.balances[code] = Number(a.amount ?? 0);
  }
  return Array.from(byKey.values()).sort((a, b) => a.dateMs - b.dateMs);
}

function defaultAccountsFromRows(rows: BalanceRowDto[]): BalanceAccountColumn[] {
  const codes = new Set<string>();
  rows.forEach((r) => Object.keys(r.balances).forEach((c) => codes.add(c)));
  return Array.from(codes)
    .sort()
    .map((code) => ({ name: code, currency: 'EUR' as const }));
}

function importBalancesFromCsv(
  database: Database,
  dataRoot: string,
  accountsForMirror?: BalanceAccountColumn[]
): void {
  const fromCsv = readCsvAsBalanceDtos(dataRoot);
  insertBalanceRows(database, fromCsv, true);
  const accounts =
    accountsForMirror?.length ? accountsForMirror : defaultAccountsFromRows(fromCsv);
  writeBalanceMirror(dataRoot, fromCsv, accounts, database);
}

export async function ensureAccountBalanceStore(
  dataRoot: string,
  accountsForMirror?: BalanceAccountColumn[]
): Promise<void> {
  const database = await openAccountBalanceDb(dataRoot);
  const csvPath = accountBalanceCsvPath(dataRoot);

  if (countSnapshots(database) === 0) {
    importBalancesFromCsv(database, dataRoot, accountsForMirror);
  } else if (!fs.existsSync(csvPath)) {
    const rows = selectAllBalanceDtos(database);
    const accounts =
      accountsForMirror?.length ? accountsForMirror : defaultAccountsFromRows(rows);
    writeBalanceMirror(dataRoot, rows, accounts, database);
  } else if (csvMirrorNeedsResyncFromCsv(database, csvPath)) {
    console.info(
      '[accountBalance] CSV miroir modifié hors SQLite — réimport depuis',
      csvPath
    );
    importBalancesFromCsv(database, dataRoot, accountsForMirror);
  }

  if (countSnapshots(database) > 0) {
    rememberCsvMirrorHash(database, csvPath, persistAccountBalanceDb);
  }
}

export async function getAllBalanceRows(dataRoot: string): Promise<BalanceRowDto[]> {
  await ensureAccountBalanceStore(dataRoot);
  const database = await openAccountBalanceDb(dataRoot);
  return selectAllBalanceDtos(database);
}

/**
 * Ligne de soldes la plus proche de targetMs : préférer on-or-after, sinon on-or-before
 * (même règle que AnnualBudget bankBalanceJan1).
 */
export async function getNearestBalanceRow(
  dataRoot: string,
  targetMs: number
): Promise<BalanceRowDto | null> {
  const rows = await getAllBalanceRows(dataRoot);
  if (!rows.length || !Number.isFinite(targetMs)) return null;
  const onOrAfter = rows
    .filter((r) => r.dateMs >= targetMs)
    .sort((a, b) => a.dateMs - b.dateMs)[0];
  const onOrBefore = rows
    .filter((r) => r.dateMs <= targetMs)
    .sort((a, b) => b.dateMs - a.dateMs)[0];
  return onOrAfter ?? onOrBefore ?? null;
}

/** En-têtes du miroir CSV Processed (DATE + colonnes comptes), pour alignement Settings. */
export async function getAccountBalanceMirrorHeaders(dataRoot: string): Promise<string[]> {
  await ensureAccountBalanceStore(dataRoot);
  const fullPath = path.join(dataRoot, ACCOUNT_BALANCE_CSV_PATH);
  if (!fs.existsSync(fullPath)) {
    // Fallback : codes présents en DB
    const rows = await getAllBalanceRows(dataRoot);
    const codes = new Set<string>();
    rows.forEach((r) => Object.keys(r.balances).forEach((c) => codes.add(c)));
    return ['DATE', ...Array.from(codes).sort()];
  }
  const first = fs.readFileSync(fullPath, 'utf-8').split(/\r?\n/).find((l) => l.trim()) ?? '';
  return first
    .split(';')
    .map((h) => h.replace(/^\uFEFF/, '').trim())
    .filter(Boolean);
}

export async function replaceAllBalanceRows(
  dataRoot: string,
  rows: BalanceRowDto[],
  accounts: BalanceAccountColumn[]
): Promise<{ success: boolean; error?: string; count: number }> {
  try {
    await ensureAccountBalanceStore(dataRoot, accounts);
    const database = await openAccountBalanceDb(dataRoot);
    const valid = rows
      .filter((r) => Number.isFinite(r.dateMs) && r.balances && typeof r.balances === 'object')
      .map((r) => ({
        dateMs: new Date(r.dateMs).setHours(0, 0, 0, 0),
        balances: { ...r.balances },
      }));
    insertBalanceRows(database, valid, true);
    writeBalanceMirror(dataRoot, valid, accounts, database);
    return { success: true, count: valid.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, count: 0 };
  }
}

/**
 * Réécrit le miroir (et conserve les montants EAV) selon l’ordre/noms des comptes Paramètres.
 * Fusionne les montants déjà stockés par code (pas de relecture CSV brute).
 */
export async function rewriteBalanceColumns(
  dataRoot: string,
  accounts: BalanceAccountColumn[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const rows = await getAllBalanceRows(dataRoot);
    if (!rows.length) {
      // Peut encore migrer depuis CSV
      await ensureAccountBalanceStore(dataRoot, accounts);
      const after = await getAllBalanceRows(dataRoot);
      if (!after.length) {
        return { success: false, error: tm('error.balanceCsvMissing') };
      }
      const database = await openAccountBalanceDb(dataRoot);
      writeBalanceMirror(dataRoot, after, accounts, database);
      return { success: true };
    }
    // Ne garde que les codes présents dans la liste Paramètres (merge par code)
    const allowed = new Set(
      accounts
        .map((a) => getBalanceCodeForSettingsAccountName(a.name))
        .filter((c): c is string => !!c)
    );
    const trimmed = rows.map((r) => {
      const balances: Record<string, number> = {};
      for (const [code, amount] of Object.entries(r.balances)) {
        if (allowed.has(code)) balances[code] = amount;
      }
      return { dateMs: r.dateMs, balances };
    });
    return await replaceAllBalanceRows(dataRoot, trimmed, accounts);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

export async function syncAccountBalanceCsvMirror(
  dataRoot: string,
  accounts: BalanceAccountColumn[]
): Promise<void> {
  const rows = await getAllBalanceRows(dataRoot);
  const database = await openAccountBalanceDb(dataRoot);
  writeBalanceMirror(
    dataRoot,
    rows,
    accounts.length ? accounts : defaultAccountsFromRows(rows),
    database
  );
}

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

const ACCOUNT_CODE_TO_LABEL: Record<string, string> = {
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

/** Matrice mensuelle (1er du mois) pour le graphique Dashboard — sans renvoyer tout l’EAV. */
export async function getMonthlyBalanceChart(
  dataRoot: string
): Promise<import('../../shared/transactionQueryTypes').AccountBalanceMonthlyChartDto | null> {
  const all = await getAllBalanceRows(dataRoot);
  const monthly = all.filter((r) => {
    const d = new Date(r.dateMs);
    return d.getDate() === 1;
  });
  if (!monthly.length) return null;
  monthly.sort((a, b) => a.dateMs - b.dateMs);
  const allCodes = new Set<string>();
  monthly.forEach((r) => Object.keys(r.balances).forEach((c) => allCodes.add(c)));
  const accountList = Array.from(allCodes).sort();
  const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' });
  const periods = monthly.map((r) => monthFmt.format(new Date(r.dateMs)));
  const dateMsList = monthly.map((r) => r.dateMs);
  const accountColors: Record<string, string> = {};
  accountList.forEach((code) => {
    accountColors[code] = DEFAULT_ACCOUNT_COLORS[code] ?? '#808080';
  });
  const balanceData = accountList.map((code) =>
    monthly.map((row) => {
      const v = row.balances[code];
      return v !== undefined ? v : 0;
    })
  );
  return {
    periods,
    dateMsList,
    accounts: accountList.map((code) => ACCOUNT_CODE_TO_LABEL[code] ?? code),
    accountCodes: accountList,
    balanceData,
    accountColors,
    granularity: 'month',
  };
}

export { closeAccountBalanceDb };

/** Expose path helper for tests. */
export function accountBalanceCsvAbsolute(dataRoot: string): string {
  return path.join(dataRoot, ACCOUNT_BALANCE_CSV_PATH);
}
