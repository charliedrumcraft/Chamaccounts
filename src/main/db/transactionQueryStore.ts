/**
 * Lectures filtrées / agrégées sur transactions.db (Phase 3).
 */

import type { Database } from 'sql.js';
import {
  accountLabelFromSource,
  canonicalAccountFromSource,
} from '../../shared/accountSourceLabels';
import type { SourceDataResult } from '../../shared/sourceDataTypes';
import { EXCLUDE_ANOMALY_COLUMN } from '../../shared/excludeAnomalyColumn';
import { SOUTIEN_IGNORE_COLUMN } from '../../shared/soutienIgnoreColumn';
import {
  TRANSACTION_PROJET_COLUMN,
  emptyRow,
  type ValidRow,
} from '../../shared/transactionsImportCore';
import type {
  DashboardTableRowDto,
  MonthlyTotalDto,
  MovementsMonthlyChartPayload,
  RangeAggregateByAccount,
  RangeAggregateByType,
  TransactionsAnnualBudgetYearDto,
  TransactionsMonthKeysResult,
  TransactionsRangeAggregate,
  TransactionsTableRowsQuery,
  TransactionsYearlyAggregate,
} from '../../shared/transactionQueryTypes';
import { ensureTransactionStore, validRowsToSourceData } from './transactionStore';
import { openTransactionDb, queryAll } from './transactionDb';

function parseAmountGbp(raw: string | undefined): number {
  const s = (raw ?? '').trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

function typeLabelOf(raw: string | undefined): string {
  return (raw ?? '').trim() || 'Divers';
}

function monthKeyFromMs(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function startOfMonthMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

function rowFromDb(r: Record<string, unknown>): ValidRow & { idx: number; id: number; date_ms: number } {
  const v = emptyRow();
  v.DATE = String(r.date ?? '');
  v.TITLE = String(r.title ?? '');
  v.AMOUNT = String(r.amount ?? '');
  v.CURRENCY = String(r.currency ?? '');
  v.ACCOUNT = String(r.account ?? '');
  v['AMOUNT GBP'] = String(r.amount_gbp ?? '');
  v.TYPE = String(r.type ?? '');
  v[TRANSACTION_PROJET_COLUMN] = String(r.projet ?? '');
  v[EXCLUDE_ANOMALY_COLUMN] = String(r.exclure_anomalie ?? '');
  v[SOUTIEN_IGNORE_COLUMN] = String(r.soutien_ignorer ?? '');
  return {
    ...v,
    idx: Number(r.idx ?? 0),
    id: Number(r.id ?? 0),
    date_ms: Number(r.date_ms ?? 0),
  };
}

function selectRangeRows(
  database: Database,
  startMs: number,
  endMs: number
): Array<ValidRow & { idx: number; id: number; date_ms: number }> {
  const rows = queryAll(
    database,
    `SELECT id, idx, date, date_ms, title, amount, currency, account, amount_gbp, type, projet,
            exclure_anomalie, soutien_ignorer
     FROM transactions
     WHERE date_ms >= ? AND date_ms <= ? AND date_ms > 0
     ORDER BY date_ms ASC, idx ASC`,
    [startMs, endMs]
  );
  return rows.map(rowFromDb);
}

function selectAllDatedRows(
  database: Database
): Array<ValidRow & { idx: number; id: number; date_ms: number }> {
  const rows = queryAll(
    database,
    `SELECT id, idx, date, date_ms, title, amount, currency, account, amount_gbp, type, projet,
            exclure_anomalie, soutien_ignorer
     FROM transactions
     WHERE date_ms > 0
     ORDER BY date_ms ASC, idx ASC`
  );
  return rows.map(rowFromDb);
}

function emptyByType(): RangeAggregateByType {
  return {
    sortiesByType: {},
    entréesByType: {},
    totalSorties: 0,
    totalEntrées: 0,
    types: [],
    typesWithSorties: [],
    typesWithEntrées: [],
    rowCount: 0,
  };
}

function finalizeByType(
  sortiesByType: Record<string, number>,
  entréesByType: Record<string, number>,
  totalSorties: number,
  totalEntrées: number
): RangeAggregateByType {
  const typesSet = new Set([...Object.keys(sortiesByType), ...Object.keys(entréesByType)]);
  const types = Array.from(typesSet).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
  const typesWithSorties = types
    .filter((t) => (sortiesByType[t] ?? 0) > 0)
    .sort((a, b) => (sortiesByType[b] ?? 0) - (sortiesByType[a] ?? 0));
  const typesWithEntrées = types
    .filter((t) => (entréesByType[t] ?? 0) > 0)
    .sort((a, b) => (entréesByType[b] ?? 0) - (entréesByType[a] ?? 0));
  const rowCount =
    typesWithSorties.length === 0 && typesWithEntrées.length === 0
      ? 0
      : Math.max(typesWithSorties.length, typesWithEntrées.length);
  return {
    sortiesByType,
    entréesByType,
    totalSorties,
    totalEntrées,
    types,
    typesWithSorties,
    typesWithEntrées,
    rowCount,
  };
}

function aggregateRows(
  rows: Array<ValidRow & { date_ms: number }>,
  startMs: number,
  endMs: number
): TransactionsRangeAggregate {
  const sortiesByType: Record<string, number> = {};
  const entréesByType: Record<string, number> = {};
  let totalSorties = 0;
  let totalEntrées = 0;
  const entréesByAccount: Record<string, number> = {};
  const sortiesByAccount: Record<string, number> = {};

  const startMonth = startOfMonthMs(startMs);
  const endMonth = startOfMonthMs(endMs);
  const monthStarts: number[] = [];
  if (startMonth <= endMonth) {
    let cur = startMonth;
    while (cur <= endMonth) {
      monthStarts.push(cur);
      const d = new Date(cur);
      cur = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    }
  }
  const n = monthStarts.length;
  const monthIndex = new Map(monthStarts.map((ms, i) => [ms, i]));
  const sortiesByTypeByMonth: Record<string, number[]> = {};
  const entréesByTypeByMonth: Record<string, number[]> = {};
  const sortiesTotByType: Record<string, number> = {};
  const entréesTotByType: Record<string, number> = {};

  function ensureMonthArrays(typeLabel: string) {
    if (!sortiesByTypeByMonth[typeLabel]) sortiesByTypeByMonth[typeLabel] = new Array(n).fill(0);
    if (!entréesByTypeByMonth[typeLabel]) entréesByTypeByMonth[typeLabel] = new Array(n).fill(0);
  }

  for (const row of rows) {
    const t = row.date_ms;
    if (t < startMs || t > endMs) continue;
    const type = typeLabelOf(row.TYPE);
    const v = parseAmountGbp(row['AMOUNT GBP']);
    const rawAccount = (row.ACCOUNT ?? '').trim() || 'Sans compte';
    const accountKey =
      rawAccount === 'Sans compte' ? 'Sans compte' : canonicalAccountFromSource(rawAccount) || rawAccount;

    if (v < 0) {
      const abs = Math.abs(v);
      sortiesByType[type] = (sortiesByType[type] ?? 0) + abs;
      totalSorties += abs;
      sortiesByAccount[accountKey] = (sortiesByAccount[accountKey] ?? 0) + abs;
    }
    if (v > 0) {
      entréesByType[type] = (entréesByType[type] ?? 0) + v;
      totalEntrées += v;
      entréesByAccount[accountKey] = (entréesByAccount[accountKey] ?? 0) + v;
    }

    if (n > 0) {
      const idx = monthIndex.get(startOfMonthMs(t));
      if (idx === undefined) continue;
      ensureMonthArrays(type);
      if (v < 0) {
        const abs = Math.abs(v);
        sortiesByTypeByMonth[type][idx] += abs;
        sortiesTotByType[type] = (sortiesTotByType[type] ?? 0) + abs;
      }
      if (v > 0) {
        entréesByTypeByMonth[type][idx] += v;
        entréesTotByType[type] = (entréesTotByType[type] ?? 0) + v;
      }
    }
  }

  const byAccount: RangeAggregateByAccount[] = Array.from(
    new Set([...Object.keys(entréesByAccount), ...Object.keys(sortiesByAccount)])
  )
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((accountKey) => {
      const e = entréesByAccount[accountKey] ?? 0;
      const s = sortiesByAccount[accountKey] ?? 0;
      return {
        accountKey,
        accountLabel: accountLabelFromSource(accountKey) || accountKey,
        entrées: e,
        sorties: s,
        balance: e - s,
      };
    });

  let monthly: MovementsMonthlyChartPayload | null = null;
  if (n > 0) {
    const sortieTypes = Object.keys(sortiesTotByType).sort(
      (a, b) => (sortiesTotByType[b] ?? 0) - (sortiesTotByType[a] ?? 0)
    );
    const entréeTypes = Object.keys(entréesTotByType).sort(
      (a, b) => (entréesTotByType[b] ?? 0) - (entréesTotByType[a] ?? 0)
    );
    const sortiesByMonth = sortieTypes.length
      ? monthStarts.map((_, i) => sortieTypes.reduce((s, t) => s + (sortiesByTypeByMonth[t]?.[i] ?? 0), 0))
      : new Array(n).fill(0);
    const entréesByMonth = entréeTypes.length
      ? monthStarts.map((_, i) => entréeTypes.reduce((s, t) => s + (entréesByTypeByMonth[t]?.[i] ?? 0), 0))
      : new Array(n).fill(0);
    const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric' });
    monthly = {
      months: monthStarts.map((ms) => monthFmt.format(new Date(ms))),
      monthStartsMs: monthStarts,
      sortiesByMonth,
      entréesByMonth,
      balanceByMonth: entréesByMonth.map((e, i) => e - sortiesByMonth[i]),
      sortieTypes,
      entréeTypes,
      sortiesByTypeByMonth,
      entréesByTypeByMonth,
    };
  }

  return {
    byType: finalizeByType(sortiesByType, entréesByType, totalSorties, totalEntrées),
    byAccount,
    monthly,
  };
}

function cellMatchesAny(value: string, criteria: string[] | undefined): boolean {
  if (!criteria?.length) return true;
  const hay = value.toLowerCase();
  return criteria.some((c) => {
    const needle = c.trim().toLowerCase();
    if (!needle) return true;
    return hay.includes(needle);
  });
}

export async function getTransactionMonthKeys(dataRoot: string): Promise<TransactionsMonthKeysResult> {
  await ensureTransactionStore(dataRoot);
  const database = await openTransactionDb(dataRoot);
  const rows = queryAll(
    database,
    `SELECT DISTINCT date_ms FROM transactions WHERE date_ms > 0 ORDER BY date_ms ASC`
  );
  const monthStartSet = new Set<number>();
  for (const r of rows) {
    const ms = Number(r.date_ms ?? 0);
    if (ms > 0) monthStartSet.add(startOfMonthMs(ms));
  }
  const monthStartsMs = Array.from(monthStartSet).sort((a, b) => a - b);
  const monthKeys = monthStartsMs.map(monthKeyFromMs);
  return { monthKeys, monthStartsMs };
}

export async function aggregateTransactionsRange(
  dataRoot: string,
  startMs: number,
  endMs: number
): Promise<TransactionsRangeAggregate> {
  await ensureTransactionStore(dataRoot);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs > endMs) {
    return { byType: emptyByType(), byAccount: [], monthly: null };
  }
  const database = await openTransactionDb(dataRoot);
  const rows = selectRangeRows(database, startMs, endMs);
  return aggregateRows(rows, startMs, endMs);
}

export async function aggregateTransactionsYearly(
  dataRoot: string
): Promise<TransactionsYearlyAggregate> {
  await ensureTransactionStore(dataRoot);
  const database = await openTransactionDb(dataRoot);
  const rows = selectAllDatedRows(database);
  const yearsSet = new Set<number>();
  const typesSet = new Set<string>();
  const totalSortiesByYear: Record<number, number> = {};
  const totalEntréesByYear: Record<number, number> = {};
  const sortiesByYearByType: Record<string, Record<number, number>> = {};
  const entréesByYearByType: Record<string, Record<number, number>> = {};

  for (const row of rows) {
    const year = new Date(row.date_ms).getFullYear();
    yearsSet.add(year);
    const type = typeLabelOf(row.TYPE);
    typesSet.add(type);
    const v = parseAmountGbp(row['AMOUNT GBP']);
    if (v < 0) {
      const abs = Math.abs(v);
      totalSortiesByYear[year] = (totalSortiesByYear[year] ?? 0) + abs;
      if (!sortiesByYearByType[type]) sortiesByYearByType[type] = {};
      sortiesByYearByType[type][year] = (sortiesByYearByType[type][year] ?? 0) + abs;
    }
    if (v > 0) {
      totalEntréesByYear[year] = (totalEntréesByYear[year] ?? 0) + v;
      if (!entréesByYearByType[type]) entréesByYearByType[type] = {};
      entréesByYearByType[type][year] = (entréesByYearByType[type][year] ?? 0) + v;
    }
  }

  const years = Array.from(yearsSet).sort((a, b) => a - b);
  const types = Array.from(typesSet).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
  return {
    years,
    types,
    totalSortiesByYear,
    totalEntréesByYear,
    sortiesByYearByType,
    entréesByYearByType,
  };
}

export async function getTransactionsByMonth(
  dataRoot: string,
  monthKey: string
): Promise<SourceDataResult> {
  await ensureTransactionStore(dataRoot);
  const m = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!m) return validRowsToSourceData([]);
  const y = Number(m[1]);
  const month = Number(m[2]);
  const startMs = new Date(y, month - 1, 1).getTime();
  const endMs = new Date(y, month, 0, 23, 59, 59, 999).getTime();
  const database = await openTransactionDb(dataRoot);
  const rows = selectRangeRows(database, startMs, endMs);
  // Preserve idx from DB for anomaly reports when in view mode
  const valid = rows.map((r) => {
    const v = emptyRow();
    Object.assign(v, {
      DATE: r.DATE,
      TITLE: r.TITLE,
      AMOUNT: r.AMOUNT,
      CURRENCY: r.CURRENCY,
      ACCOUNT: r.ACCOUNT,
      'AMOUNT GBP': r['AMOUNT GBP'],
      TYPE: r.TYPE,
      [TRANSACTION_PROJET_COLUMN]: r[TRANSACTION_PROJET_COLUMN],
      [EXCLUDE_ANOMALY_COLUMN]: r[EXCLUDE_ANOMALY_COLUMN],
      [SOUTIEN_IGNORE_COLUMN]: r[SOUTIEN_IGNORE_COLUMN],
    });
    return v;
  });
  const data = validRowsToSourceData(valid);
  // Re-apply DB idx into Index column for anomaly line numbers
  data.rows = data.rows.map((row, i) => ({
    ...row,
    Index: String(rows[i]?.idx ?? i + 1),
  }));
  data.rowIndicesInSource = rows.map((r, i) => {
    const idx = r.idx ?? i + 1;
    return idx > 0 ? idx - 1 : i;
  });
  return data;
}

export async function getMonthlyTotals(dataRoot: string): Promise<MonthlyTotalDto[]> {
  await ensureTransactionStore(dataRoot);
  const database = await openTransactionDb(dataRoot);
  const rows = selectAllDatedRows(database);
  const map = new Map<string, MonthlyTotalDto>();
  for (const row of rows) {
    const key = monthKeyFromMs(row.date_ms);
    const cur = map.get(key) ?? {
      monthKey: key,
      entrées: 0,
      sorties: 0,
      byTypeSorties: {},
      byTypeEntrées: {},
    };
    // Type default for Mensuel averages uses '—' (not Divers)
    const typeLabel = (row.TYPE ?? '').trim() || '—';
    const amount = parseAmountGbp(row['AMOUNT GBP']);
    if (amount < 0) {
      const amt = Math.abs(amount);
      cur.sorties += amt;
      cur.byTypeSorties[typeLabel] = (cur.byTypeSorties[typeLabel] ?? 0) + amt;
    }
    if (amount > 0) {
      cur.entrées += amount;
      cur.byTypeEntrées[typeLabel] = (cur.byTypeEntrées[typeLabel] ?? 0) + amount;
    }
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

export async function queryDashboardTableRows(
  dataRoot: string,
  query: TransactionsTableRowsQuery
): Promise<DashboardTableRowDto[]> {
  await ensureTransactionStore(dataRoot);
  const { startMs, endMs } = query;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  const database = await openTransactionDb(dataRoot);
  const rows = selectRangeRows(database, startMs, endMs);
  const showEntrées = query.showEntrées !== false;
  const showSorties = query.showSorties !== false;
  const out: DashboardTableRowDto[] = [];

  for (const row of rows) {
    const v = parseAmountGbp(row['AMOUNT GBP']);
    if (v === 0) continue;
    const isEntrée = v > 0;
    const isSortie = v < 0;
    if (!showEntrées && isEntrée) continue;
    if (!showSorties && isSortie) continue;
    const title = (row.TITLE ?? '').trim() || '—';
    const typeLabel = typeLabelOf(row.TYPE);
    const rawAccount = (row.ACCOUNT ?? '').trim() || 'Sans compte';
    const accountKey =
      rawAccount === 'Sans compte' ? 'Sans compte' : canonicalAccountFromSource(rawAccount) || rawAccount;
    if (!cellMatchesAny(title, query.titleContains)) continue;
    if (!cellMatchesAny(typeLabel, query.typeContains)) continue;
    if (!cellMatchesAny(rawAccount, query.accountContains)) continue;
    const d = new Date(row.date_ms);
    const dateLabel = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    out.push({
      rowKey: `tx-${row.idx}`,
      sourceRowIndex: row.idx,
      txIndex: row.idx,
      sortTs: row.date_ms,
      dateLabel,
      title,
      typeLabel,
      accountKey,
      accountLabel: accountLabelFromSource(accountKey) || accountKey,
      amountGbp: v,
      sens: isEntrée ? 'entrée' : 'sortie',
    });
  }
  out.sort((a, b) => b.sortTs - a.sortTs);
  return out;
}

export async function getSuggestColumnValues(
  dataRoot: string
): Promise<{ titles: string[]; types: string[]; accounts: string[] }> {
  await ensureTransactionStore(dataRoot);
  const database = await openTransactionDb(dataRoot);
  const rows = queryAll(
    database,
    `SELECT title, type, account FROM transactions`
  );
  const titles = new Set<string>();
  const types = new Set<string>();
  const accounts = new Set<string>();
  for (const r of rows) {
    const t = String(r.title ?? '').trim();
    const ty = String(r.type ?? '').trim();
    const a = String(r.account ?? '').trim();
    if (t) titles.add(t);
    if (ty) types.add(ty);
    if (a) accounts.add(a);
  }
  return {
    titles: Array.from(titles),
    types: Array.from(types),
    accounts: Array.from(accounts),
  };
}

/**
 * Agrégat Budget annuel pour une année civile (règles AnnualBudget.aggregateByYear).
 */
export async function aggregateAnnualBudgetYear(
  dataRoot: string,
  year: number
): Promise<TransactionsAnnualBudgetYearDto> {
  await ensureTransactionStore(dataRoot);
  const database = await openTransactionDb(dataRoot);
  const rows = selectAllDatedRows(database);

  const byTypeAndMonth: Record<string, Record<number, number>> = {};
  const byType: Record<string, number> = {};
  const yearSet = new Set<number>();

  for (const row of rows) {
    const d = new Date(row.date_ms);
    const y = d.getFullYear();
    const month = d.getMonth() + 1;
    yearSet.add(y);
    if (y !== year) continue;
    const amount = parseAmountGbp(row['AMOUNT GBP']);
    if (amount === 0) continue;
    const type = (row.TYPE ?? '').trim() || 'Sans type';
    if (!byTypeAndMonth[type]) byTypeAndMonth[type] = {};
    byTypeAndMonth[type][month] = (byTypeAndMonth[type][month] ?? 0) + amount;
    byType[type] = (byType[type] ?? 0) + amount;
  }

  const types = Object.keys(byType).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' })
  );
  const byTypeAndMonthFlat: number[] = [];
  for (const type of types) {
    for (let m = 1; m <= 12; m++) {
      byTypeAndMonthFlat.push(byTypeAndMonth[type]?.[m] ?? 0);
    }
  }

  let totalIncome = 0;
  let totalExpenses = 0;
  Object.values(byType).forEach((v) => {
    if (v > 0) totalIncome += v;
    else totalExpenses += v;
  });

  return {
    yearsAvailable: Array.from(yearSet).sort((a, b) => a - b),
    year,
    types,
    byTypeAndMonthFlat,
    totalIncome,
    totalExpenses,
    total: totalIncome + totalExpenses,
  };
}
