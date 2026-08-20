import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import AccountBalanceLineChart, {
  linearRegression,
} from '../components/Dashboard/AccountBalanceLineChart';
import AccountBalanceStockChart from '../components/Dashboard/AccountBalanceStockChart';
import DateRangeSlider from '../components/Common/DateRangeSlider';
import { ACCOUNT_BALANCE_PROCESSED_DIR } from '@/shared/dataPaths';
import { AccountBalanceCSVService } from '../services/AccountBalanceCSVService';
import { SourceDataCSVService, type SourceDataResult } from '../services/SourceDataCSVService';
import { getAccountCurrency } from '../constants/accountCurrencies';
import {
  canonicalAccountFromSource,
  accountLabelFromSource,
} from '../constants/accountSourceLabels';
import {
  convertToAxisCurrency,
  convertMovementsToDisplayCurrency,
  type CurrencySymbol,
} from '../services/EffectiveExchangeRates';
import MovementsPieChart from '../components/Dashboard/MovementsPieChart';
import MovementsMonthlyChart, {
  type MovementsMonthlyChartData,
} from '../components/Dashboard/MovementsMonthlyChart';
import MovementsBalanceHorizontalBar from '../components/Dashboard/MovementsBalanceHorizontalBar';
import YearlySummaryChart from '../components/Dashboard/YearlySummaryChart';
import { formatCurrency } from '../utils/format';
import { eachMonthOfInterval, startOfMonth, endOfMonth, startOfYear, endOfYear, format } from 'date-fns';
import { getSuggestions } from '../services/SuggestInputService';

const Y_AXIS_CURRENCIES = [
  { value: '£', label: 'GBP (£)' },
  { value: '€', label: 'EUR (€)' },
  { value: 'CHF', label: 'CHF' },
] as const;

/** Préfixe id `datalist` filtres Tableaux — suffixer par l’index de ligne. */
const TABLES_FILTER_DL_TITLE_PREFIX = 'dashboard-tables-filter-dl-title-';
const TABLES_FILTER_DL_TYPE_PREFIX = 'dashboard-tables-filter-dl-type-';
const TABLES_FILTER_DL_ACCOUNT_PREFIX = 'dashboard-tables-filter-dl-account-';

/** Recale [start,end] sur les index couvrant des années civiles complètes (données mensuelles). */
function snapRangeIndicesToFullYears(ds: Date[], range: [number, number]): [number, number] {
  if (ds.length === 0) return range;
  const lo = Math.min(range[0], range[1]);
  const hi = Math.max(range[0], range[1]);
  const startTs = startOfYear(ds[lo] ?? ds[0]).getTime();
  const endTs = endOfYear(ds[hi] ?? ds[ds.length - 1]).getTime();
  let startIdx = ds.findIndex((d) => d.getTime() >= startTs);
  if (startIdx === -1) startIdx = ds.length - 1;
  let endIdx = 0;
  for (let i = 0; i < ds.length; i++) {
    if (ds[i].getTime() <= endTs) endIdx = i;
  }
  if (startIdx > endIdx) endIdx = startIdx;
  return [startIdx, endIdx];
}

/** Une ligne de filtre = un critère (OU entre lignes via « + Ligne »). */
function tablesFilterCriteriaFromLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t) out.push(t);
  }
  return out;
}

function cellMatchesTablesFilterCriteria(cell: string, criteria: string[]): boolean {
  if (criteria.length === 0) return true;
  const h = cell.toLowerCase();
  return criteria.some((c) => h.includes(c.toLowerCase()));
}

/** Texte passé à l’autocomplete (ligne entière). */
function tablesFilterSuggestPrefix(rawLine: string): string {
  return rawLine.trim();
}

/** Remplace la ligne par la valeur suggérée (titres / types / comptes). */
function applyTablesFilterSuggestionToLine(_line: string, suggestionValue: string): string {
  return suggestionValue.trim();
}

function getMovementsColumnsFromHeaders(headers: string[] | null | undefined) {
  if (!headers?.length) return null;
  const dateCol =
    headers.find((h) => /^date$/i.test((h ?? '').trim())) ??
    headers.find((h) => /^date\b/i.test((h ?? '').trim())) ??
    headers.find((h) => /date/i.test(h)) ??
    null;
  const amountCol = headers.find((h) => /^amount\s*gbp$/i.test(h)) ?? null;
  const typeCol =
    headers.find((h) => /type|catégorie|category|cat$/i.test(h)) ??
    headers.find((h) => !/date|amount|currency|account/i.test(h)) ??
    null;
  const accountCol =
    headers.find((h) => /^account$/i.test(h) || /compte/i.test(h)) ?? null;
  const titleCol = headers.find((h) => /^title$/i.test(h)) ?? null;
  return { dateCol, amountCol, typeCol, accountCol, titleCol };
}

/** Charge une liste de filtres texte (JSON ou ancienne chaîne seule). */
function loadTablesFilterLineList(key: string): string[] {
  return loadDashboardPref(
    key,
    (s) => {
      if (s === null) return null;
      if (s === '') return [''];
      try {
        const p = JSON.parse(s);
        if (Array.isArray(p) && p.every((x) => typeof x === 'string')) {
          return p.length > 0 ? p : [''];
        }
      } catch {
        return [s];
      }
      return null;
    },
    ['']
  );
}

const DASHBOARD_STORAGE_KEYS = {
  chartHeight: 'dashboard-chart-height',
  chartFiltersOpen: 'dashboard-chart-filters-open',
  chartRange: 'dashboard-chart-range',
  movementsRange: 'dashboard-movements-range',
  chartSyncsWithMovements: 'dashboard-chart-syncs-with-movements',
  movementsSyncsWithChart: 'dashboard-movements-syncs-with-chart',
  /** Curseurs de période : sélection par années civiles complètes (1er janv. – 31 déc.). */
  dateRangeSliderFullYears: 'dashboard-date-range-slider-full-years',
  /** Devise du bloc Évolution des soldes */
  chartYAxisCurrency: 'dashboard-chart-y-axis-currency',
  /** Devise du bloc Suivi des mouvements */
  movementsYAxisCurrency: 'dashboard-movements-y-axis-currency',
  /** Devise du bloc Evolution comparée des mouvements */
  movementsCompareYAxisCurrency: 'dashboard-movements-compare-y-axis-currency',
  yAxisScale: 'dashboard-y-axis-scale',
  trendLines: 'dashboard-trend-lines',
  expandedBoxes: 'dashboard-expanded-boxes',
  /** Séries cachées via la légende (clé = label de la série, true = cachée) */
  legendHiddenSeries: 'dashboard-legend-hidden-series',
  /** Compte affiché dans le graphique boursier (code compte ou 'TOTAL') */
  selectedAccountStockChart: 'dashboard-selected-account-stock-chart',
  /** Panneau paramètres du bloc Suivi des mouvements ouvert/fermé */
  movementsFiltersOpen: 'dashboard-movements-filters-open',
  /** Hauteur (px) du graphique mensuel dans le bloc Suivi des mouvements */
  movementsMonthlyChartHeight: 'dashboard-movements-monthly-chart-height',
  /** Panneau paramètres du bloc Evolution comparée des mouvements ouvert/fermé */
  movementsCompareFiltersOpen: 'dashboard-movements-compare-filters-open',
  /** Plage dates colonne gauche du bloc Evolution comparée */
  movementsCompareRangeA: 'dashboard-movements-compare-range-a',
  /** Plage dates colonne droite du bloc Evolution comparée */
  movementsCompareRangeB: 'dashboard-movements-compare-range-b',
  /** Afficher les pourcentages comparatifs dans le bloc Evolution comparée */
  movementsCompareShowPct: 'dashboard-movements-compare-show-pct',
  /** Afficher les diagrammes circulaires dans le bloc Evolution comparée */
  movementsCompareShowPieCharts: 'dashboard-movements-compare-show-pie-charts',
  /** Afficher les tableaux entrées/sorties par Type dans le bloc Evolution comparée */
  movementsCompareShowTableByType: 'dashboard-movements-compare-show-table-by-type',
  /** Afficher les tableaux entrées/sorties par compte dans le bloc Evolution comparée */
  movementsCompareShowTableByAccount: 'dashboard-movements-compare-show-table-by-account',
  /** Hauteur max (px) des tableaux entrées/sorties par Type dans le bloc Evolution comparée */
  movementsCompareTableByTypeHeight: 'dashboard-movements-compare-table-by-type-height',
  /** Panneau paramètres du bloc Suivi annuel ouvert/fermé */
  vueGlobaleFiltersOpen: 'dashboard-vue-globale-filters-open',
  /** Devise du bloc Suivi annuel */
  vueGlobaleYAxisCurrency: 'dashboard-vue-globale-y-axis-currency',
  /** Hauteur (px) du graphique dans le bloc Suivi annuel */
  vueGlobaleChartHeight: 'dashboard-vue-globale-chart-height',
  /** Années visibles dans le bloc Suivi annuel (clé = année, false = masquée) */
  vueGlobaleVisibleYears: 'dashboard-vue-globale-visible-years',
  vueGlobaleShowTrendLine: 'dashboard-vue-globale-show-trend-line',
  vueGlobaleShowMoyenneEntrées: 'dashboard-vue-globale-show-moyenne-entrees',
  vueGlobaleShowMoyenneSorties: 'dashboard-vue-globale-show-moyenne-sorties',
  vueGlobaleShowMoyenneBalance: 'dashboard-vue-globale-show-moyenne-balance',
  /** Séries masquées dans le graphique Suivi annuel (légende) */
  vueGlobaleHiddenSeriesByLabel: 'dashboard-vue-globale-hidden-series-by-label',
  /** Groupes dépliés dans le tableau Suivi annuel (entrées / sorties) */
  vueGlobaleTableExpanded: 'dashboard-vue-globale-table-expanded',
  /** Afficher le tableau (types / années) dans Suivi annuel */
  vueGlobaleShowTable: 'dashboard-vue-globale-show-table',
  /** Afficher le graphe dans Suivi annuel */
  vueGlobaleShowChart: 'dashboard-vue-globale-show-chart',
  /** Afficher le tableau outils d'analyse (sous le graphe) dans Suivi annuel */
  vueGlobaleShowSummaryTable: 'dashboard-vue-globale-show-summary-table',
  /** Blocs principaux dépliés (clé = id bloc, true = ouvert) */
  sectionsExpanded: 'dashboard-sections-expanded',
  /** Plage dates du bloc Tableaux et filtres */
  tablesRange: 'dashboard-tables-range',
  /** Panneau paramètres du bloc Tableaux et filtres ouvert/fermé */
  tablesFiltersOpen: 'dashboard-tables-filters-open',
  tablesSyncsWithChart: 'dashboard-tables-syncs-with-chart',
  tablesSyncsWithMovements: 'dashboard-tables-syncs-with-movements',
  tablesYAxisCurrency: 'dashboard-tables-y-axis-currency',
  /** Hauteur max (px) du tableau des transactions */
  tablesTransactionsMaxHeight: 'dashboard-tables-transactions-max-height',
  /** Filtres exacts multi-lignes : JSON string[] (clés inchangées ; ancienne valeur texte brute migrée) */
  tablesTitleExactQuery: 'dashboard-tables-title-exact-query',
  tablesTypeExactQuery: 'dashboard-tables-type-exact-query',
  tablesAccountExactQuery: 'dashboard-tables-account-exact-query',
  tablesShowEntrées: 'dashboard-tables-show-entrees',
  tablesShowSorties: 'dashboard-tables-show-sorties',
} as const;

const SECTION_IDS = {
  evolutionSoldes: 'evolutionSoldes',
  suiviMouvements: 'suiviMouvements',
  evolutionComparee: 'evolutionComparee',
  tableauxFiltres: 'tableauxFiltres',
  vueGlobale: 'vueGlobale',
} as const;

type SectionId = keyof typeof SECTION_IDS;

function loadDashboardPref<T>(key: string, parse: (s: string) => T | null, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    if (s === null) return fallback;
    const parsed = parse(s);
    return parsed !== null ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveDashboardPref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/** Parse une cellule date (ISO ou JJ/MM/AAAA, JJ.MM.AAAA) en Date ou null. */
/** Timestamps (1er du mois) présents dans les transactions. */
function collectTransactionMonthTimestamps(sourceData: SourceDataResult | null): number[] {
  if (!sourceData?.rows?.length || !sourceData.headers?.length) return [];
  const headers = sourceData.headers;
  const dateCol =
    headers.find((h) => /^date$/i.test((h ?? '').trim())) ??
    headers.find((h) => /^date\b/i.test((h ?? '').trim())) ??
    headers.find((h) => /date/i.test(h)) ??
    null;
  if (!dateCol) return [];
  const out = new Set<number>();
  for (const row of sourceData.rows) {
    const d = parseDateFromCell(row[dateCol] ?? '');
    if (d) out.add(startOfMonth(d).getTime());
  }
  return Array.from(out);
}

/** Union des mois couverts par les soldes et par les transactions (pour les sliders). */
function buildDashboardMonthDates(balanceDates: Date[], sourceData: SourceDataResult | null): Date[] {
  const tsSet = new Set<number>();
  for (const d of balanceDates) {
    tsSet.add(startOfMonth(d).getTime());
  }
  for (const ts of collectTransactionMonthTimestamps(sourceData)) {
    tsSet.add(ts);
  }
  return Array.from(tsSet)
    .sort((a, b) => a - b)
    .map((ts) => new Date(ts));
}

function clampDashboardRange(range: [number, number], length: number): [number, number] {
  if (length <= 0) return [0, 0];
  const maxIdx = length - 1;
  const start = Math.max(0, Math.min(range[0], maxIdx));
  const end = Math.max(0, Math.min(range[1], maxIdx));
  return [Math.min(start, end), Math.max(start, end)];
}

function loadSavedDashboardRange(key: string, length: number): [number, number] | null {
  const saved = loadDashboardPref(
    key,
    (s) => {
      try {
        const [a, b] = JSON.parse(s);
        if (typeof a === 'number' && typeof b === 'number') return [a, b] as [number, number];
      } catch {}
      return null;
    },
    null
  );
  if (!saved) return null;
  return clampDashboardRange(saved, length);
}

function parseDateFromCell(raw: string): Date | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
  const mi = s.match(iso);
  if (mi) {
    const y = parseInt(mi[1], 10);
    const m = parseInt(mi[2], 10);
    const d = parseInt(mi[3], 10);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const md = s.match(dmy);
  if (md) {
    const d = parseInt(md[1], 10);
    const m = parseInt(md[2], 10);
    const yy =
      md[3].length === 2
        ? parseInt(md[3], 10) < 50
          ? 2000 + parseInt(md[3], 10)
          : 1900 + parseInt(md[3], 10)
        : parseInt(md[3], 10);
    const date = new Date(yy, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function parseAmountCell(raw: string): number {
  const s = (raw ?? '').trim();
  if (!s) return 0;
  const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

type DashboardTablesBlocSortDir = 'asc' | 'desc';

type DashboardTablesBlocTxSortCol = 'index' | 'date' | 'title' | 'type' | 'account' | 'amount';

type DashboardTablesBlocTypeInSortCol = 'type' | 'entrées';
type DashboardTablesBlocTypeOutSortCol = 'type' | 'sorties';
type DashboardTablesBlocAccountSortCol = 'account' | 'entrées' | 'sorties' | 'balance';

function dashboardTablesBlocCompareNum(a: number, b: number, dir: DashboardTablesBlocSortDir): number {
  const c = a - b;
  return dir === 'asc' ? c : -c;
}

function dashboardTablesBlocCompareStr(a: string, b: string, dir: DashboardTablesBlocSortDir): number {
  const c = a.localeCompare(b, undefined, { sensitivity: 'base' });
  return dir === 'asc' ? c : -c;
}

function dashboardTablesBlocAriaSort<T extends string>(
  activeCol: T,
  col: T,
  dir: DashboardTablesBlocSortDir
): 'ascending' | 'descending' | 'none' {
  return activeCol === col ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';
}

/** Agrégats Types / comptes / totaux à partir des lignes du tableau (bloc Tableaux et filtres). */
function buildTablesDashboardAggregatesFromRows(
  rows: { typeLabel: string; accountKey: string; amountGbp: number }[]
) {
  const entréesByType: Record<string, number> = {};
  const sortiesByType: Record<string, number> = {};
  const entréesByAccount: Record<string, number> = {};
  const sortiesByAccount: Record<string, number> = {};
  let totalEntrées = 0;
  let totalSorties = 0;

  for (const row of rows) {
    const v = row.amountGbp;
    const isEntrée = v > 0;
    const isSortie = v < 0;
    if (!isEntrée && !isSortie) continue;
    const abs = Math.abs(v);
    if (isEntrée) {
      entréesByType[row.typeLabel] = (entréesByType[row.typeLabel] ?? 0) + v;
      entréesByAccount[row.accountKey] = (entréesByAccount[row.accountKey] ?? 0) + v;
      totalEntrées += v;
    }
    if (isSortie) {
      sortiesByType[row.typeLabel] = (sortiesByType[row.typeLabel] ?? 0) + abs;
      sortiesByAccount[row.accountKey] = (sortiesByAccount[row.accountKey] ?? 0) + abs;
      totalSorties += abs;
    }
  }

  const typeKeysEntrées = Object.keys(entréesByType)
    .filter((t) => (entréesByType[t] ?? 0) > 0)
    .sort((a, b) => (entréesByType[b] ?? 0) - (entréesByType[a] ?? 0));
  const summaryByTypeEntrées = typeKeysEntrées.map((type) => ({
    type,
    entrées: entréesByType[type] ?? 0,
  }));

  const typeKeysSorties = Object.keys(sortiesByType)
    .filter((t) => (sortiesByType[t] ?? 0) > 0)
    .sort((a, b) => (sortiesByType[b] ?? 0) - (sortiesByType[a] ?? 0));
  const summaryByTypeSorties = typeKeysSorties.map((type) => ({
    type,
    sorties: sortiesByType[type] ?? 0,
  }));

  const accountKeysSorted = Array.from(
    new Set([...Object.keys(entréesByAccount), ...Object.keys(sortiesByAccount)])
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  const summaryByAccount = accountKeysSorted.map((accountKey) => {
    const e = entréesByAccount[accountKey] ?? 0;
    const s = sortiesByAccount[accountKey] ?? 0;
    return {
      account: accountLabelFromSource(accountKey) || accountKey,
      entrées: e,
      sorties: s,
      balance: e - s,
    };
  });

  return {
    summaryByTypeEntrées,
    summaryByTypeSorties,
    summaryByAccount,
    totalEntrées,
    totalSorties,
    balance: totalEntrées - totalSorties,
  };
}

const Dashboard: React.FC = () => {
  const location = useLocation();
  const [accountBalanceChartData, setAccountBalanceChartData] = useState<{
    periods: string[];
    dates: Date[];
    accounts: string[];
    accountCodes: string[];
    balanceData: number[][];
    accountColors: Record<string, string>;
    granularity: 'day' | 'week' | 'month';
  } | null>(null);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState<string | null>(null);

  const [chartFiltersOpen, setChartFiltersOpen] = useState(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.chartFiltersOpen,
      (s) => s === 'true' || s === 'false' ? s === 'true' : null,
      true
    )
  );
  const [movementsFiltersOpen, setMovementsFiltersOpen] = useState(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.movementsFiltersOpen,
      (s) => s === 'true' || s === 'false' ? s === 'true' : null,
      true
    )
  );
  const [movementsCompareFiltersOpen, setMovementsCompareFiltersOpen] = useState(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.movementsCompareFiltersOpen,
      (s) => s === 'true' || s === 'false' ? s === 'true' : null,
      true
    )
  );
  const [chartRange, setChartRange] = useState<[number, number]>([0, 0]);
  const [movementsRange, setMovementsRange] = useState<[number, number]>([0, 0]);
  /** Plages du bloc Evolution comparée : gauche (A) et droite (B). */
  const [movementsCompareRangeA, setMovementsCompareRangeA] = useState<[number, number]>([0, 0]);
  const [movementsCompareRangeB, setMovementsCompareRangeB] = useState<[number, number]>([0, 0]);
  const [chartSyncsWithMovements, setChartSyncsWithMovements] = useState(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.chartSyncsWithMovements,
      (s) => s === 'true' || s === 'false' ? s === 'true' : null,
      false
    )
  );
  const [movementsSyncsWithChart, setMovementsSyncsWithChart] = useState(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.movementsSyncsWithChart,
      (s) => s === 'true' || s === 'false' ? s === 'true' : null,
      false
    )
  );
  const [dateRangeSliderFullYears, setDateRangeSliderFullYears] = useState(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.dateRangeSliderFullYears,
      (s) => (s === 'true' ? true : s === 'false' ? false : null),
      false
    )
  );
  /** Devise du bloc Évolution des soldes (EffectiveExchangeRates utilisé pour la conversion). */
  const [chartYAxisCurrency, setChartYAxisCurrency] = useState<string>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.chartYAxisCurrency, (s) => s || null, '£')
  );
  /** Devise du bloc Suivi des mouvements. */
  const [movementsYAxisCurrency, setMovementsYAxisCurrency] = useState<string>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.movementsYAxisCurrency, (s) => s || null, '£')
  );
  /** Devise du bloc Evolution comparée des mouvements. */
  const [movementsCompareYAxisCurrency, setMovementsCompareYAxisCurrency] = useState<string>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareYAxisCurrency, (s) => s || null, '£')
  );
  /** Afficher les pourcentages comparatifs dans le bloc Evolution comparée. */
  const [movementsCompareShowPct, setMovementsCompareShowPct] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareShowPct, (s) => s === 'true' || s === 'false' ? s === 'true' : null, true)
  );
  /** Afficher les diagrammes circulaires dans le bloc Evolution comparée. */
  const [movementsCompareShowPieCharts, setMovementsCompareShowPieCharts] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareShowPieCharts, (s) => s === 'true' || s === 'false' ? s === 'true' : null, true)
  );
  /** Afficher les tableaux entrées/sorties par Type dans le bloc Evolution comparée. */
  const [movementsCompareShowTableByType, setMovementsCompareShowTableByType] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareShowTableByType, (s) => s === 'true' || s === 'false' ? s === 'true' : null, true)
  );
  /** Afficher les tableaux entrées/sorties par compte dans le bloc Evolution comparée. */
  const [movementsCompareShowTableByAccount, setMovementsCompareShowTableByAccount] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareShowTableByAccount, (s) => s === 'true' || s === 'false' ? s === 'true' : null, true)
  );
  /** Hauteur max (px) des tableaux entrées/sorties par Type dans le bloc Evolution comparée. */
  const [movementsCompareTableByTypeHeight, setMovementsCompareTableByTypeHeight] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareTableByTypeHeight, (s) => {
      const n = parseInt(s, 10);
      return Number.isNaN(n) || n < 300 || n > 1000 ? null : n;
    }, 300)
  );
  const [tablesRange, setTablesRange] = useState<[number, number]>([0, 0]);
  const [tablesFiltersOpen, setTablesFiltersOpen] = useState(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.tablesFiltersOpen,
      (s) => s === 'true' || s === 'false' ? s === 'true' : null,
      true
    )
  );
  const [tablesSyncsWithChart, setTablesSyncsWithChart] = useState(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.tablesSyncsWithChart,
      (s) => s === 'true' || s === 'false' ? s === 'true' : null,
      false
    )
  );
  const [tablesSyncsWithMovements, setTablesSyncsWithMovements] = useState(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.tablesSyncsWithMovements,
      (s) => s === 'true' || s === 'false' ? s === 'true' : null,
      false
    )
  );
  const [tablesYAxisCurrency, setTablesYAxisCurrency] = useState<string>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.tablesYAxisCurrency, (s) => s || null, '£')
  );
  const [tablesTransactionsMaxHeight, setTablesTransactionsMaxHeight] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.tablesTransactionsMaxHeight, (s) => {
      const n = parseInt(s, 10);
      return Number.isNaN(n) || n < 200 || n > 900 ? null : n;
    }, 360)
  );
  const [tablesTitleExactQueries, setTablesTitleExactQueries] = useState<string[]>(() =>
    loadTablesFilterLineList(DASHBOARD_STORAGE_KEYS.tablesTitleExactQuery)
  );
  const [tablesTypeExactQueries, setTablesTypeExactQueries] = useState<string[]>(() =>
    loadTablesFilterLineList(DASHBOARD_STORAGE_KEYS.tablesTypeExactQuery)
  );
  const [tablesAccountExactQueries, setTablesAccountExactQueries] = useState<string[]>(() =>
    loadTablesFilterLineList(DASHBOARD_STORAGE_KEYS.tablesAccountExactQuery)
  );
  const [tablesShowEntrées, setTablesShowEntrées] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.tablesShowEntrées, (s) => s === 'true' || s === 'false' ? s === 'true' : null, true)
  );
  const [tablesShowSorties, setTablesShowSorties] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.tablesShowSorties, (s) => s === 'true' || s === 'false' ? s === 'true' : null, true)
  );
  /** Tri colonnes du bloc Tableaux et filtres (clic en-tête). */
  const [tablesBlocTxSort, setTablesBlocTxSort] = useState<{
    col: DashboardTablesBlocTxSortCol;
    dir: DashboardTablesBlocSortDir;
  }>({ col: 'date', dir: 'desc' });
  const [tablesBlocTypeInSort, setTablesBlocTypeInSort] = useState<{
    col: DashboardTablesBlocTypeInSortCol;
    dir: DashboardTablesBlocSortDir;
  }>({ col: 'entrées', dir: 'desc' });
  const [tablesBlocTypeOutSort, setTablesBlocTypeOutSort] = useState<{
    col: DashboardTablesBlocTypeOutSortCol;
    dir: DashboardTablesBlocSortDir;
  }>({ col: 'sorties', dir: 'desc' });
  const [tablesBlocAccountSort, setTablesBlocAccountSort] = useState<{
    col: DashboardTablesBlocAccountSortCol;
    dir: DashboardTablesBlocSortDir;
  }>({ col: 'account', dir: 'asc' });
  /** Lignes cochées : si non vide, les sommes Types / comptes / totaux ne portent que sur ces lignes. */
  const [tablesBlocSelectedRowKeys, setTablesBlocSelectedRowKeys] = useState<Set<string>>(() => new Set());
  /** Panneau paramètres du bloc Suivi annuel ouvert/fermé. */
  const [vueGlobaleFiltersOpen, setVueGlobaleFiltersOpen] = useState(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.vueGlobaleFiltersOpen,
      (s) => (s === 'true' || s === 'false' ? s === 'true' : null),
      true
    )
  );
  /** Devise du bloc Suivi annuel. */
  const [vueGlobaleYAxisCurrency, setVueGlobaleYAxisCurrency] = useState<string>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleYAxisCurrency, (s) => s || null, '£')
  );
  /** Hauteur (px) du graphique dans le bloc Suivi annuel. */
  const [vueGlobaleChartHeightPx, setVueGlobaleChartHeightPx] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleChartHeight, (s) => {
      const n = parseInt(s, 10);
      return Number.isNaN(n) || n < 200 || n > 700 ? null : n;
    }, 320)
  );
  /** Années masquées dans le bloc Suivi annuel (clé = année, true = masquée). Par défaut toutes visibles. */
  const [vueGlobaleHiddenYears, setVueGlobaleHiddenYears] = useState<Record<number, boolean>>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleVisibleYears, (s) => {
      try {
        const o = JSON.parse(s);
        if (!o || typeof o !== 'object') return null;
        const out: Record<number, boolean> = {};
        Object.keys(o).forEach((k) => {
          const year = parseInt(k, 10);
          if (Number.isFinite(year) && o[k] === false) out[year] = true;
        });
        return out;
      } catch {
        return null;
      }
    }, {})
  );
  const [vueGlobaleShowTrendLine, setVueGlobaleShowTrendLine] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowTrendLine, (s) => s === 'true' || s === 'false' ? s === 'true' : null, false)
  );
  const [vueGlobaleShowMoyenneEntrées, setVueGlobaleShowMoyenneEntrées] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowMoyenneEntrées, (s) => s === 'true' || s === 'false' ? s === 'true' : null, false)
  );
  const [vueGlobaleShowMoyenneSorties, setVueGlobaleShowMoyenneSorties] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowMoyenneSorties, (s) => s === 'true' || s === 'false' ? s === 'true' : null, false)
  );
  const [vueGlobaleShowMoyenneBalance, setVueGlobaleShowMoyenneBalance] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowMoyenneBalance, (s) => s === 'true' || s === 'false' ? s === 'true' : null, false)
  );
  const [vueGlobaleHiddenSeriesByLabel, setVueGlobaleHiddenSeriesByLabel] = useState<Record<string, boolean>>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleHiddenSeriesByLabel, (s) => {
      try {
        const o = JSON.parse(s);
        return o && typeof o === 'object' ? (o as Record<string, boolean>) : null;
      } catch {
        return null;
      }
    }, {})
  );
  /** Tableau vue globale : groupes Entrées / Sorties dépliés (true = afficher les lignes par type). */
  const [vueGlobaleTableExpanded, setVueGlobaleTableExpanded] = useState<{ entrées: boolean; sorties: boolean }>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleTableExpanded, (s) => {
      try {
        const o = JSON.parse(s);
        if (!o || typeof o !== 'object') return null;
        return {
          entrées: o.entrées !== false,
          sorties: o.sorties !== false,
        };
      } catch {
        return null;
      }
    }, { entrées: true, sorties: true })
  );
  const [vueGlobaleShowTable, setVueGlobaleShowTable] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowTable, (s) => s === 'true' || s === 'false' ? s === 'true' : null, true)
  );
  const [vueGlobaleShowChart, setVueGlobaleShowChart] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowChart, (s) => s === 'true' || s === 'false' ? s === 'true' : null, true)
  );
  const [vueGlobaleShowSummaryTable, setVueGlobaleShowSummaryTable] = useState(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowSummaryTable, (s) => s === 'true' || s === 'false' ? s === 'true' : null, true)
  );
  /** Blocs principaux dépliés (true = contenu visible). Persisté dans localStorage. */
  const defaultSectionsExpanded: Record<SectionId, boolean> = {
    evolutionSoldes: true,
    suiviMouvements: true,
    evolutionComparee: true,
    tableauxFiltres: true,
    vueGlobale: true,
  };
  const [sectionsExpanded, setSectionsExpanded] = useState<Record<SectionId, boolean>>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.sectionsExpanded, (s) => {
      try {
        const o = JSON.parse(s);
        if (!o || typeof o !== 'object') return null;
        const out = { ...defaultSectionsExpanded };
        (Object.keys(SECTION_IDS) as SectionId[]).forEach((id) => {
          if (o[id] === false || o[id] === true) out[id] = o[id];
        });
        return out;
      } catch {
        return null;
      }
    }, defaultSectionsExpanded)
  );
  const setSectionExpanded = useCallback((id: SectionId, expanded: boolean) => {
    setSectionsExpanded((prev) => {
      const next = { ...prev, [id]: expanded };
      saveDashboardPref(DASHBOARD_STORAGE_KEYS.sectionsExpanded, JSON.stringify(next));
      return next;
    });
  }, []);
  const [yAxisScale, setYAxisScale] = useState<'linear' | 'logarithmic'>(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.yAxisScale,
      (s) => (s === 'linear' || s === 'logarithmic' ? s : null),
      'linear'
    )
  );
  /** Courbes de tendance par code compte (défaut: toutes désactivées) */
  const [trendLinesByAccount, setTrendLinesByAccount] = useState<Record<string, boolean>>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.trendLines, (s) => {
      try {
        const o = JSON.parse(s);
        return o && typeof o === 'object' ? o as Record<string, boolean> : null;
      } catch {
        return null;
      }
    }, {})
  );
  /** Boîtes dépliées : clé = accountCode ou 'TOTAL'. Plusieurs peuvent être ouvertes en même temps. */
  const [expandedBoxes, setExpandedBoxes] = useState<Record<string, boolean>>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.expandedBoxes, (s) => {
      try {
        const o = JSON.parse(s);
        return o && typeof o === 'object' ? o as Record<string, boolean> : null;
      } catch {
        return null;
      }
    }, {})
  );
  /** Séries cachées via la légende (cliquer sur un item de la légende). Clé = label, true = cachée. */
  const [hiddenSeriesByLabel, setHiddenSeriesByLabel] = useState<Record<string, boolean>>(() =>
    loadDashboardPref(DASHBOARD_STORAGE_KEYS.legendHiddenSeries, (s) => {
      try {
        const o = JSON.parse(s);
        return o && typeof o === 'object' ? o as Record<string, boolean> : null;
      } catch {
        return null;
      }
    }, {})
  );
  /** Séries cachées dans le graphique mensuel mouvements (légende). Clé = label. */
  const [hiddenMonthlySeriesByLabel, setHiddenMonthlySeriesByLabel] = useState<
    Record<string, boolean>
  >({});
  /** Hauteur du graphique mensuel (MovementsMonthlyChart) en pixels. */
  const [movementsMonthlyChartHeightPx, setMovementsMonthlyChartHeightPx] = useState(() => {
    try {
      const saved = localStorage.getItem(DASHBOARD_STORAGE_KEYS.movementsMonthlyChartHeight);
      if (saved != null) {
        const n = parseInt(saved, 10);
        if (Number.isFinite(n) && n >= 300 && n <= 800) return n;
      }
    } catch {}
    return 300;
  });
  /** Hauteur du graphique en pixels (réglable via le slider dans Paramètres). */
  const [chartHeightPx, setChartHeightPx] = useState(() => {
    try {
      const saved = localStorage.getItem(DASHBOARD_STORAGE_KEYS.chartHeight);
      if (saved != null) {
        const n = parseInt(saved, 10);
        if (Number.isFinite(n) && n >= 150 && n <= 600) return n;
      }
    } catch {}
    return 280;
  });
  /** Compte affiché dans le graphique boursier (code compte ou 'TOTAL'). */
  const [selectedAccountForStockChart, setSelectedAccountForStockChart] = useState<string>(() =>
    loadDashboardPref(
      DASHBOARD_STORAGE_KEYS.selectedAccountStockChart,
      (s) => (s && s.length > 0 ? s : null),
      'TOTAL'
    )
  );

  const loadChartData = useCallback(() => {
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    AccountBalanceCSVService.invalidateCache();
    AccountBalanceCSVService.getMonthlyBalancesForChart()
      .then((data) => {
        if (!cancelled) {
          setAccountBalanceChartData(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setChartError(err?.message ?? 'Erreur chargement account_balance.csv');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setChartLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return loadChartData();
  }, [loadChartData, location.pathname]);

  const [sourceData, setSourceData] = useState<SourceDataResult | null>(null);
  const [movementsDataLoading, setMovementsDataLoading] = useState(true);
  const [movementsDataError, setMovementsDataError] = useState<string | null>(null);

  const loadSourceData = useCallback(() => {
    let cancelled = false;
    setMovementsDataLoading(true);
    setMovementsDataError(null);
    SourceDataCSVService.load()
      .then((result) => {
        if (!cancelled) {
          setSourceData(result ?? null);
          if (!result) {
            setMovementsDataError('Aucune donnée dans src_transaction_data.csv.');
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setMovementsDataError(err?.message ?? 'Erreur chargement src_transaction_data.csv');
        }
      })
      .finally(() => {
        if (!cancelled) setMovementsDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return loadSourceData();
  }, [loadSourceData, location.pathname]);

  const dashboardDates = useMemo(
    () => buildDashboardMonthDates(accountBalanceChartData?.dates ?? [], sourceData),
    [accountBalanceChartData?.dates, sourceData]
  );

  useEffect(() => {
    const n = dashboardDates.length;
    if (n === 0) return;
    setChartRange((prev) => {
      if (prev[1] === 0 && prev[0] === 0) {
        return loadSavedDashboardRange(DASHBOARD_STORAGE_KEYS.chartRange, n) ?? [0, n - 1];
      }
      return clampDashboardRange(prev, n);
    });
  }, [dashboardDates.length]);

  useEffect(() => {
    const n = dashboardDates.length;
    if (n === 0) return;
    setMovementsRange((prev) => {
      if (prev[1] === 0 && prev[0] === 0) {
        return loadSavedDashboardRange(DASHBOARD_STORAGE_KEYS.movementsRange, n) ?? [0, n - 1];
      }
      return clampDashboardRange(prev, n);
    });
  }, [dashboardDates.length]);

  useEffect(() => {
    const n = dashboardDates.length;
    if (n === 0) return;
    setMovementsCompareRangeA((prev) => {
      if (prev[1] === 0 && prev[0] === 0) {
        return loadSavedDashboardRange(DASHBOARD_STORAGE_KEYS.movementsCompareRangeA, n) ?? [0, n - 1];
      }
      return clampDashboardRange(prev, n);
    });
    setMovementsCompareRangeB((prev) => {
      if (prev[1] === 0 && prev[0] === 0) {
        return loadSavedDashboardRange(DASHBOARD_STORAGE_KEYS.movementsCompareRangeB, n) ?? [0, n - 1];
      }
      return clampDashboardRange(prev, n);
    });
  }, [dashboardDates.length]);

  useEffect(() => {
    const n = dashboardDates.length;
    if (n === 0) return;
    setTablesRange((prev) => {
      if (prev[1] === 0 && prev[0] === 0) {
        return loadSavedDashboardRange(DASHBOARD_STORAGE_KEYS.tablesRange, n) ?? [0, n - 1];
      }
      return clampDashboardRange(prev, n);
    });
  }, [dashboardDates.length]);

  useEffect(() => {
    if (!tablesSyncsWithChart) return;
    if (dashboardDates.length === 0) return;
    setTablesRange(chartRange);
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesRange, JSON.stringify(chartRange));
  }, [chartRange, tablesSyncsWithChart, dashboardDates.length]);

  useEffect(() => {
    if (!tablesSyncsWithMovements) return;
    if (dashboardDates.length === 0) return;
    setTablesRange(movementsRange);
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesRange, JSON.stringify(movementsRange));
  }, [movementsRange, tablesSyncsWithMovements, dashboardDates.length]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesSyncsWithChart, String(tablesSyncsWithChart));
  }, [tablesSyncsWithChart]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesSyncsWithMovements, String(tablesSyncsWithMovements));
  }, [tablesSyncsWithMovements]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesYAxisCurrency, tablesYAxisCurrency);
  }, [tablesYAxisCurrency]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesTransactionsMaxHeight, String(tablesTransactionsMaxHeight));
  }, [tablesTransactionsMaxHeight]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesTitleExactQuery, JSON.stringify(tablesTitleExactQueries));
  }, [tablesTitleExactQueries]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesTypeExactQuery, JSON.stringify(tablesTypeExactQueries));
  }, [tablesTypeExactQueries]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesAccountExactQuery, JSON.stringify(tablesAccountExactQueries));
  }, [tablesAccountExactQueries]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesShowEntrées, String(tablesShowEntrées));
  }, [tablesShowEntrées]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesShowSorties, String(tablesShowSorties));
  }, [tablesShowSorties]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.trendLines, JSON.stringify(trendLinesByAccount));
  }, [trendLinesByAccount]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.expandedBoxes, JSON.stringify(expandedBoxes));
  }, [expandedBoxes]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.legendHiddenSeries, JSON.stringify(hiddenSeriesByLabel));
  }, [hiddenSeriesByLabel]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.selectedAccountStockChart, selectedAccountForStockChart);
  }, [selectedAccountForStockChart]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.chartSyncsWithMovements, String(chartSyncsWithMovements));
  }, [chartSyncsWithMovements]);

  useEffect(() => {
    saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsSyncsWithChart, String(movementsSyncsWithChart));
  }, [movementsSyncsWithChart]);

  const hasChartData = useMemo(
    () =>
      accountBalanceChartData &&
      accountBalanceChartData.periods.length > 0 &&
      accountBalanceChartData.balanceData.length > 0,
    [accountBalanceChartData]
  );

  const filteredChartData = useMemo(() => {
    if (!accountBalanceChartData || !hasChartData || dashboardDates.length === 0) return null;
    const { periods, dates: balanceDates, accounts, accountCodes, balanceData, accountColors, granularity } =
      accountBalanceChartData;

    const rangeStart = dashboardDates[Math.min(chartRange[0], dashboardDates.length - 1)] ?? balanceDates[0];
    const rangeEnd = dashboardDates[Math.min(chartRange[1], dashboardDates.length - 1)] ?? balanceDates[balanceDates.length - 1];
    const rangeStartTs = dateRangeSliderFullYears
      ? startOfYear(rangeStart).getTime()
      : startOfMonth(rangeStart).getTime();
    const rangeEndTs = dateRangeSliderFullYears
      ? endOfYear(rangeEnd).getTime()
      : endOfMonth(rangeEnd).getTime();

    const periodIndices = balanceDates
      .map((_, i) => i)
      .filter((i) => {
        const t = balanceDates[i]!.getTime();
        return t >= rangeStartTs && t <= rangeEndTs;
      });

    const codeToIndex = new Map(accountCodes.map((c, i) => [c, i]));
    const targetCurrency = chartYAxisCurrency as CurrencySymbol;
    const filteredAccounts = accountCodes.map((code) => accounts[accountCodes.indexOf(code)] ?? code);
    const filteredBalanceData = accountCodes.map((code) => {
      const idx = codeToIndex.get(code)!;
      const row = balanceData[idx] || [];
      const accountCurrency = getAccountCurrency(code) as CurrencySymbol;
      return periodIndices.map((i) => {
        const raw = row[i] ?? 0;
        return convertToAxisCurrency(raw, accountCurrency, targetCurrency);
      });
    });
    const filteredAccountColors: Record<string, string> = {};
    accountCodes.forEach((code) => {
      const name = accounts[accountCodes.indexOf(code)] ?? code;
      filteredAccountColors[name] = accountColors[code] ?? '#808080';
    });

    return {
      periods: periodIndices.map((i) => periods[i]),
      accounts: filteredAccounts,
      accountCodes,
      balanceData: filteredBalanceData,
      accountColors: filteredAccountColors,
      granularity,
    };
  }, [
    accountBalanceChartData,
    hasChartData,
    chartRange,
    chartYAxisCurrency,
    dashboardDates,
    dateRangeSliderFullYears,
  ]);

  /** Données pour le graphique boursier (un seul compte, plage = chartRange). */
  const stockChartData = useMemo(() => {
    if (!filteredChartData || filteredChartData.periods.length === 0) return null;
    const { periods, accountCodes, balanceData } = filteredChartData;
    if (selectedAccountForStockChart === 'TOTAL') {
      const total: (number | null)[] = [];
      for (let p = 0; p < periods.length; p++) {
        let sum = 0;
        let hasAny = false;
        balanceData.forEach((row) => {
          const v = row[p];
          if (v != null && !Number.isNaN(v)) {
            sum += v;
            hasAny = true;
          }
        });
        total.push(hasAny ? sum : null);
      }
      return { periods, balanceData: total };
    }
    const idx = accountCodes.indexOf(selectedAccountForStockChart);
    if (idx === -1) {
      const fallbackIdx = accountCodes.length > 0 ? 0 : -1;
      const code = fallbackIdx >= 0 ? accountCodes[fallbackIdx] : 'TOTAL';
      if (code === 'TOTAL') {
        const total: (number | null)[] = [];
        for (let p = 0; p < periods.length; p++) {
          let sum = 0;
          let hasAny = false;
          balanceData.forEach((row) => {
            const v = row[p];
            if (v != null && !Number.isNaN(v)) {
              sum += v;
              hasAny = true;
            }
          });
          total.push(hasAny ? sum : null);
        }
        return { periods, balanceData: total };
      }
      return { periods, balanceData: balanceData[fallbackIdx] ?? [] };
    }
    return { periods, balanceData: balanceData[idx] ?? [] };
  }, [filteredChartData, selectedAccountForStockChart]);

  /** Régressions linéaires par compte et pour le total (même règle que les courbes de tendance). */
  const boxRegressions = useMemo(() => {
    if (!filteredChartData || filteredChartData.balanceData.length === 0) return null;
    const { balanceData, accountCodes } = filteredChartData;
    const byCode: Record<string, { a: number; b: number }> = {};
    accountCodes.forEach((_code, idx) => {
      const rawData = balanceData[idx] ?? [];
      const firstNonZero = rawData.findIndex(
        (v) => v !== 0 && v !== null && v !== undefined && !Number.isNaN(v)
      );
      const from = firstNonZero === -1 ? rawData.length : firstNonZero;
      const slice = rawData.map((v, i) => (i < from ? null : v));
      const reg = linearRegression(slice);
      if (reg) byCode[accountCodes[idx]] = reg;
    });
    const totalSeries: (number | null)[] = [];
    const nPeriods = balanceData[0]?.length ?? 0;
    for (let p = 0; p < nPeriods; p++) {
      let sum = 0;
      let hasAny = false;
      balanceData.forEach((row) => {
        const v = row[p];
        if (v !== null && v !== undefined && !Number.isNaN(v)) {
          sum += v;
          hasAny = true;
        }
      });
      totalSeries.push(hasAny ? sum : null);
    }
    const firstNonZeroTotal = totalSeries.findIndex(
      (v) => v !== 0 && v !== null && v !== undefined && !Number.isNaN(v)
    );
    const fromTotal = firstNonZeroTotal === -1 ? totalSeries.length : firstNonZeroTotal;
    const sliceTotal = totalSeries.map((v, i) => (i < fromTotal ? null : v));
    const regTotal = linearRegression(sliceTotal);
    if (regTotal) byCode['TOTAL'] = regTotal;
    return byCode;
  }, [filteredChartData]);

  const dates = dashboardDates;
  const minDate = dates[0] ?? new Date();
  const maxDate = dates[dates.length - 1] ?? new Date();
  const sliderStartDate = dates[chartRange[0]] ?? minDate;
  const sliderEndDate = dates[chartRange[1]] ?? maxDate;
  const chartSliderStartForUi = dateRangeSliderFullYears ? startOfYear(sliderStartDate) : sliderStartDate;
  const chartSliderEndForUi = dateRangeSliderFullYears ? endOfYear(sliderEndDate) : sliderEndDate;
  const movementsStartDate = dateRangeSliderFullYears
    ? startOfYear(dates[movementsRange[0]] ?? minDate)
    : (dates[movementsRange[0]] ?? minDate);
  const movementsEndDate = dateRangeSliderFullYears
    ? endOfYear(dates[movementsRange[1]] ?? maxDate)
    : endOfMonth(dates[movementsRange[1]] ?? maxDate);
  const movementsCompareStartDateA = dateRangeSliderFullYears
    ? startOfYear(dates[movementsCompareRangeA[0]] ?? minDate)
    : (dates[movementsCompareRangeA[0]] ?? minDate);
  const movementsCompareEndDateA = dateRangeSliderFullYears
    ? endOfYear(dates[movementsCompareRangeA[1]] ?? maxDate)
    : endOfMonth(dates[movementsCompareRangeA[1]] ?? maxDate);
  const movementsCompareStartDateB = dateRangeSliderFullYears
    ? startOfYear(dates[movementsCompareRangeB[0]] ?? minDate)
    : (dates[movementsCompareRangeB[0]] ?? minDate);
  const movementsCompareEndDateB = dateRangeSliderFullYears
    ? endOfYear(dates[movementsCompareRangeB[1]] ?? maxDate)
    : endOfMonth(dates[movementsCompareRangeB[1]] ?? maxDate);
  const tablesStartDate = dateRangeSliderFullYears
    ? startOfYear(dates[tablesRange[0]] ?? minDate)
    : (dates[tablesRange[0]] ?? minDate);
  const tablesEndDate = dateRangeSliderFullYears
    ? endOfYear(dates[tablesRange[1]] ?? maxDate)
    : endOfMonth(dates[tablesRange[1]] ?? maxDate);
  const tablesSliderStartDate = tablesStartDate;
  const tablesSliderEndDate = tablesEndDate;

  /** Colonnes source_data utilisées pour le tableau mouvements (AMOUNT GBP : négatif = dépense, positif = revenu) */
  const movementsColumns = useMemo(
    () => getMovementsColumnsFromHeaders(sourceData?.headers),
    [sourceData?.headers]
  );

  const tablesFilterSuggestionRows = useMemo(
    () => (sourceData?.rows as Record<string, string>[]) ?? [],
    [sourceData?.rows]
  );

  const tablesTitleFilterSuggestionsList = useMemo(() => {
    const h = movementsColumns?.titleCol;
    if (!h || tablesFilterSuggestionRows.length === 0) return tablesTitleExactQueries.map(() => []);
    return tablesTitleExactQueries.map((q) =>
      getSuggestions(tablesFilterSuggestionRows, h, tablesFilterSuggestPrefix(q), 10)
    );
  }, [tablesFilterSuggestionRows, movementsColumns?.titleCol, tablesTitleExactQueries]);

  const tablesTypeFilterSuggestionsList = useMemo(() => {
    const h = movementsColumns?.typeCol;
    if (!h || tablesFilterSuggestionRows.length === 0) return tablesTypeExactQueries.map(() => []);
    return tablesTypeExactQueries.map((q) =>
      getSuggestions(tablesFilterSuggestionRows, h, tablesFilterSuggestPrefix(q), 10)
    );
  }, [tablesFilterSuggestionRows, movementsColumns?.typeCol, tablesTypeExactQueries]);

  const tablesAccountFilterSuggestionsList = useMemo(() => {
    const h = movementsColumns?.accountCol;
    if (!h || tablesFilterSuggestionRows.length === 0) return tablesAccountExactQueries.map(() => []);
    return tablesAccountExactQueries.map((q) =>
      getSuggestions(tablesFilterSuggestionRows, h, tablesFilterSuggestPrefix(q), 10)
    );
  }, [tablesFilterSuggestionRows, movementsColumns?.accountCol, tablesAccountExactQueries]);

  /** Entrées/sorties agrégées par type sur la plage du slider mouvements */
  const movementsTableData = useMemo(() => {
    if (!sourceData?.rows?.length || !movementsColumns) return null;
    const { dateCol, amountCol, typeCol } = movementsColumns;
    if (!dateCol || !amountCol) return null;
    const startTs = movementsStartDate.getTime();
    const endTs = movementsEndDate.getTime();
    const sortiesByType: Record<string, number> = {};
    const entréesByType: Record<string, number> = {};
    let totalSorties = 0;
    let totalEntrées = 0;
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) {
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
    for (const row of sourceData.rows) {
      const cellDate = parseDateFromCell(row[dateCol] ?? '');
      if (!cellDate) continue;
      const t = cellDate.getTime();
      if (!Number.isFinite(t) || t < startTs || t > endTs) continue;
      const typeLabel = (typeCol ? (row[typeCol] ?? '').trim() : '') || 'Divers';
      const v = parseAmountCell(row[amountCol] ?? '');
      if (v < 0) {
        const abs = Math.abs(v);
        sortiesByType[typeLabel] = (sortiesByType[typeLabel] ?? 0) + abs;
        totalSorties += abs;
      }
      if (v > 0) {
        entréesByType[typeLabel] = (entréesByType[typeLabel] ?? 0) + v;
        totalEntrées += v;
      }
    }
    const typesSet = new Set([...Object.keys(sortiesByType), ...Object.keys(entréesByType)]);
    const types = Array.from(typesSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    /** Types qui ont au moins une sortie, triés par montant décroissant (plus grande sortie en haut). */
    const typesWithSorties = types
      .filter((t) => (sortiesByType[t] ?? 0) > 0)
      .sort((a, b) => (sortiesByType[b] ?? 0) - (sortiesByType[a] ?? 0));
    /** Types qui ont au moins une entrée, triés par montant décroissant (plus grande entrée en haut). */
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
  }, [
    sourceData?.rows,
    movementsColumns,
    movementsStartDate,
    movementsEndDate,
  ]);

  /** Lignes du tableau transactions (bloc Tableaux et filtres), avant agrégation. */
  const tablesDashboardRowsBase = useMemo(() => {
    if (!sourceData?.rows?.length || !movementsColumns) return null;
    const { dateCol, amountCol, typeCol, accountCol, titleCol } = movementsColumns;
    if (!dateCol || !amountCol) return null;
    const startTs = tablesStartDate.getTime();
    const endTs = tablesEndDate.getTime();
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return null;
    const indexHeader = sourceData.headers.find((h) => /^index$/i.test(h)) ?? 'Index';

    type RowAcc = {
      sourceRowIndex: number;
      txIndex: number;
      cellDate: Date;
      v: number;
      title: string;
      typeLabel: string;
      accountKey: string;
      rawAccount: string;
    };

    const candidates: RowAcc[] = [];

    for (let ri = 0; ri < sourceData.rows.length; ri++) {
      const row = sourceData.rows[ri];
      const cellDate = parseDateFromCell(row[dateCol] ?? '');
      if (!cellDate) continue;
      const tt = cellDate.getTime();
      if (!Number.isFinite(tt) || tt < startTs || tt > endTs) continue;
      const v = parseAmountCell(row[amountCol] ?? '');
      if (v === 0) continue;
      const title = (titleCol ? (row[titleCol] ?? '').trim() : '') || '—';
      const typeLabel = (typeCol ? (row[typeCol] ?? '').trim() : '') || 'Divers';
      const rawAccount = (accountCol ? (row[accountCol] ?? '').trim() : '') || 'Sans compte';
      const accountKey =
        rawAccount === 'Sans compte' ? 'Sans compte' : (canonicalAccountFromSource(rawAccount) || rawAccount);
      const idxParsed = parseInt(String(row[indexHeader] ?? '').trim(), 10);
      const txIndex = Number.isFinite(idxParsed) ? idxParsed : ri + 1;
      candidates.push({ sourceRowIndex: ri, txIndex, cellDate, v, title, typeLabel, accountKey, rawAccount });
    }

    const rowsOut: {
      rowKey: string;
      sourceRowIndex: number;
      txIndex: number;
      sortTs: number;
      dateLabel: string;
      title: string;
      typeLabel: string;
      accountKey: string;
      accountLabel: string;
      amountGbp: number;
      sens: 'entrée' | 'sortie';
    }[] = [];

    const titleCriteria = tablesFilterCriteriaFromLines(tablesTitleExactQueries);
    const typeCriteria = tablesFilterCriteriaFromLines(tablesTypeExactQueries);
    const accountCriteria = tablesFilterCriteriaFromLines(tablesAccountExactQueries);

    for (const c of candidates) {
      if (!cellMatchesTablesFilterCriteria(c.title, titleCriteria)) continue;
      if (!cellMatchesTablesFilterCriteria(c.typeLabel, typeCriteria)) continue;
      if (!cellMatchesTablesFilterCriteria(c.rawAccount, accountCriteria)) continue;
      const isEntrée = c.v > 0;
      const isSortie = c.v < 0;
      if (!tablesShowEntrées && isEntrée) continue;
      if (!tablesShowSorties && isSortie) continue;

      rowsOut.push({
        rowKey: `tx-${c.sourceRowIndex}`,
        sourceRowIndex: c.sourceRowIndex,
        txIndex: c.txIndex,
        sortTs: c.cellDate.getTime(),
        dateLabel: format(c.cellDate, 'dd/MM/yyyy'),
        title: c.title,
        typeLabel: c.typeLabel,
        accountKey: c.accountKey,
        accountLabel: accountLabelFromSource(c.accountKey) || c.accountKey,
        amountGbp: c.v,
        sens: isEntrée ? 'entrée' : 'sortie',
      });
    }

    rowsOut.sort((a, b) => b.sortTs - a.sortTs);
    return { rows: rowsOut };
  }, [
    sourceData?.rows,
    sourceData?.headers,
    movementsColumns,
    tablesStartDate,
    tablesEndDate,
    tablesTitleExactQueries,
    tablesTypeExactQueries,
    tablesAccountExactQueries,
    tablesShowEntrées,
    tablesShowSorties,
  ]);

  const tablesDashboardRowsKey = useMemo(
    () => tablesDashboardRowsBase?.rows.map((r) => r.rowKey).join('\0') ?? '',
    [tablesDashboardRowsBase]
  );

  useEffect(() => {
    if (!tablesDashboardRowsBase?.rows.length) {
      setTablesBlocSelectedRowKeys((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }
    const valid = new Set(tablesDashboardRowsBase.rows.map((r) => r.rowKey));
    setTablesBlocSelectedRowKeys((prev) => {
      const next = new Set<string>();
      for (const k of prev) {
        if (valid.has(k)) next.add(k);
      }
      if (next.size === prev.size) {
        for (const k of prev) {
          if (!next.has(k)) return next;
        }
        return prev;
      }
      return next;
    });
  }, [tablesDashboardRowsKey, tablesDashboardRowsBase]);

  const tablesBlocRowsForAggregates = useMemo(() => {
    const rows = tablesDashboardRowsBase?.rows ?? [];
    if (tablesBlocSelectedRowKeys.size === 0) return rows;
    return rows.filter((r) => tablesBlocSelectedRowKeys.has(r.rowKey));
  }, [tablesDashboardRowsBase, tablesBlocSelectedRowKeys]);

  const tablesDashboardAggregates = useMemo(
    () => buildTablesDashboardAggregatesFromRows(tablesBlocRowsForAggregates),
    [tablesBlocRowsForAggregates]
  );

  /** Tableau des transactions + agrégations (bloc Tableaux et filtres) */
  const tablesDashboardData = useMemo(() => {
    if (!tablesDashboardRowsBase) return null;
    return {
      rows: tablesDashboardRowsBase.rows,
      ...tablesDashboardAggregates,
    };
  }, [tablesDashboardRowsBase, tablesDashboardAggregates]);

  const tablesBlocSortedTxRows = useMemo(() => {
    if (!tablesDashboardData) return [];
    const { col, dir } = tablesBlocTxSort;
    const rows = [...tablesDashboardData.rows];
    rows.sort((a, b) => {
      let c = 0;
      switch (col) {
        case 'index':
          c = dashboardTablesBlocCompareNum(a.txIndex, b.txIndex, dir);
          break;
        case 'date':
          c = dashboardTablesBlocCompareNum(a.sortTs, b.sortTs, dir);
          break;
        case 'title':
          c = dashboardTablesBlocCompareStr(a.title, b.title, dir);
          break;
        case 'type':
          c = dashboardTablesBlocCompareStr(a.typeLabel, b.typeLabel, dir);
          break;
        case 'account':
          c = dashboardTablesBlocCompareStr(a.accountLabel, b.accountLabel, dir);
          break;
        case 'amount':
          c = dashboardTablesBlocCompareNum(a.amountGbp, b.amountGbp, dir);
          break;
        default:
          break;
      }
      if (c !== 0) return c;
      const byTs = b.sortTs - a.sortTs;
      if (byTs !== 0) return byTs;
      return a.sourceRowIndex - b.sourceRowIndex;
    });
    return rows;
  }, [tablesDashboardData, tablesBlocTxSort]);

  const tablesBlocTxTableHeaderCheckboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = tablesBlocTxTableHeaderCheckboxRef.current;
    if (!el) return;
    const keys = tablesBlocSortedTxRows.map((r) => r.rowKey);
    const selectedAmongVisible = keys.filter((k) => tablesBlocSelectedRowKeys.has(k)).length;
    el.indeterminate = keys.length > 0 && selectedAmongVisible > 0 && selectedAmongVisible < keys.length;
  }, [tablesBlocSortedTxRows, tablesBlocSelectedRowKeys]);

  const toggleTablesBlocRowSelected = useCallback((rowKey: string) => {
    setTablesBlocSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);

  const toggleTablesBlocSelectAllVisible = useCallback(() => {
    setTablesBlocSelectedRowKeys((prev) => {
      const keys = tablesBlocSortedTxRows.map((r) => r.rowKey);
      if (keys.length === 0) return new Set();
      const allSelected = keys.every((k) => prev.has(k));
      if (allSelected) return new Set();
      return new Set(keys);
    });
  }, [tablesBlocSortedTxRows]);

  const tablesBlocSortedTypeEntrées = useMemo(() => {
    if (!tablesDashboardData) return [];
    const { col, dir } = tablesBlocTypeInSort;
    const arr = [...tablesDashboardData.summaryByTypeEntrées];
    arr.sort((a, b) => {
      const c =
        col === 'type'
          ? dashboardTablesBlocCompareStr(a.type, b.type, dir)
          : dashboardTablesBlocCompareNum(a.entrées, b.entrées, dir);
      if (c !== 0) return c;
      return a.type.localeCompare(b.type, undefined, { sensitivity: 'base' });
    });
    return arr;
  }, [tablesDashboardData, tablesBlocTypeInSort]);

  const tablesBlocSortedTypeSorties = useMemo(() => {
    if (!tablesDashboardData) return [];
    const { col, dir } = tablesBlocTypeOutSort;
    const arr = [...tablesDashboardData.summaryByTypeSorties];
    arr.sort((a, b) => {
      const c =
        col === 'type'
          ? dashboardTablesBlocCompareStr(a.type, b.type, dir)
          : dashboardTablesBlocCompareNum(a.sorties, b.sorties, dir);
      if (c !== 0) return c;
      return a.type.localeCompare(b.type, undefined, { sensitivity: 'base' });
    });
    return arr;
  }, [tablesDashboardData, tablesBlocTypeOutSort]);

  const tablesBlocSortedSummaryByAccount = useMemo(() => {
    if (!tablesDashboardData) return [];
    const { col, dir } = tablesBlocAccountSort;
    const arr = [...tablesDashboardData.summaryByAccount];
    arr.sort((a, b) => {
      let c = 0;
      switch (col) {
        case 'account':
          c = dashboardTablesBlocCompareStr(a.account, b.account, dir);
          break;
        case 'entrées':
          c = dashboardTablesBlocCompareNum(a.entrées, b.entrées, dir);
          break;
        case 'sorties':
          c = dashboardTablesBlocCompareNum(a.sorties, b.sorties, dir);
          break;
        case 'balance':
          c = dashboardTablesBlocCompareNum(a.balance, b.balance, dir);
          break;
        default:
          break;
      }
      if (c !== 0) return c;
      return a.account.localeCompare(b.account, undefined, { sensitivity: 'base' });
    });
    return arr;
  }, [tablesDashboardData, tablesBlocAccountSort]);

  /** Données tableau par type pour la colonne gauche du bloc Evolution comparée */
  const movementsCompareTableDataA = useMemo(() => {
    if (!sourceData?.rows?.length || !movementsColumns) return null;
    const { dateCol, amountCol, typeCol } = movementsColumns;
    if (!dateCol || !amountCol) return null;
    const startTs = movementsCompareStartDateA.getTime();
    const endTs = movementsCompareEndDateA.getTime();
    const sortiesByType: Record<string, number> = {};
    const entréesByType: Record<string, number> = {};
    let totalSorties = 0;
    let totalEntrées = 0;
    for (const row of sourceData.rows) {
      const cellDate = parseDateFromCell(row[dateCol] ?? '');
      if (!cellDate) continue;
      const t = cellDate.getTime();
      if (t < startTs || t > endTs) continue;
      const typeLabel = (typeCol ? (row[typeCol] ?? '').trim() : '') || 'Divers';
      const v = parseAmountCell(row[amountCol] ?? '');
      if (v < 0) {
        const abs = Math.abs(v);
        sortiesByType[typeLabel] = (sortiesByType[typeLabel] ?? 0) + abs;
        totalSorties += abs;
      }
      if (v > 0) {
        entréesByType[typeLabel] = (entréesByType[typeLabel] ?? 0) + v;
        totalEntrées += v;
      }
    }
    const typesSet = new Set([...Object.keys(sortiesByType), ...Object.keys(entréesByType)]);
    const types = Array.from(typesSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
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
  }, [sourceData?.rows, movementsColumns, movementsCompareStartDateA, movementsCompareEndDateA]);

  /** Données tableau par type pour la colonne droite du bloc Evolution comparée */
  const movementsCompareTableDataB = useMemo(() => {
    if (!sourceData?.rows?.length || !movementsColumns) return null;
    const { dateCol, amountCol, typeCol } = movementsColumns;
    if (!dateCol || !amountCol) return null;
    const startTs = movementsCompareStartDateB.getTime();
    const endTs = movementsCompareEndDateB.getTime();
    const sortiesByType: Record<string, number> = {};
    const entréesByType: Record<string, number> = {};
    let totalSorties = 0;
    let totalEntrées = 0;
    for (const row of sourceData.rows) {
      const cellDate = parseDateFromCell(row[dateCol] ?? '');
      if (!cellDate) continue;
      const t = cellDate.getTime();
      if (t < startTs || t > endTs) continue;
      const typeLabel = (typeCol ? (row[typeCol] ?? '').trim() : '') || 'Divers';
      const v = parseAmountCell(row[amountCol] ?? '');
      if (v < 0) {
        const abs = Math.abs(v);
        sortiesByType[typeLabel] = (sortiesByType[typeLabel] ?? 0) + abs;
        totalSorties += abs;
      }
      if (v > 0) {
        entréesByType[typeLabel] = (entréesByType[typeLabel] ?? 0) + v;
        totalEntrées += v;
      }
    }
    const typesSet = new Set([...Object.keys(sortiesByType), ...Object.keys(entréesByType)]);
    const types = Array.from(typesSet).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
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
  }, [sourceData?.rows, movementsColumns, movementsCompareStartDateB, movementsCompareEndDateB]);

  /** Segments pie pour la colonne A du bloc Evolution comparée */
  const movementsComparePieSegmentsA = useMemo(() => {
    if (!movementsCompareTableDataA || movementsCompareTableDataA.rowCount === 0) return [];
    const { typesWithSorties, typesWithEntrées, sortiesByType, entréesByType } = movementsCompareTableDataA;
    const segments: { label: string; value: number; isSortie: boolean }[] = [];
    for (const type of typesWithSorties) {
      segments.push({ label: type, value: sortiesByType[type], isSortie: true });
    }
    for (const type of typesWithEntrées) {
      segments.push({ label: type, value: entréesByType[type], isSortie: false });
    }
    return segments;
  }, [movementsCompareTableDataA]);

  /** Segments pie pour la colonne B du bloc Evolution comparée */
  const movementsComparePieSegmentsB = useMemo(() => {
    if (!movementsCompareTableDataB || movementsCompareTableDataB.rowCount === 0) return [];
    const { typesWithSorties, typesWithEntrées, sortiesByType, entréesByType } = movementsCompareTableDataB;
    const segments: { label: string; value: number; isSortie: boolean }[] = [];
    for (const type of typesWithSorties) {
      segments.push({ label: type, value: sortiesByType[type], isSortie: true });
    }
    for (const type of typesWithEntrées) {
      segments.push({ label: type, value: entréesByType[type], isSortie: false });
    }
    return segments;
  }, [movementsCompareTableDataB]);

  /** Suivi annuel : sommes entrées/sorties par type, année après année */
  const yearlyViewData = useMemo(() => {
    if (!sourceData?.rows?.length || !movementsColumns) return null;
    const { dateCol, amountCol, typeCol } = movementsColumns;
    if (!dateCol || !amountCol) return null;
    const yearsSet = new Set<number>();
    const totalSortiesByYear: Record<number, number> = {};
    const totalEntréesByYear: Record<number, number> = {};
    const sortiesByYearByType: Record<string, Record<number, number>> = {};
    const entréesByYearByType: Record<string, Record<number, number>> = {};
    for (const row of sourceData.rows) {
      const cellDate = parseDateFromCell(row[dateCol] ?? '');
      if (!cellDate) continue;
      const year = cellDate.getFullYear();
      yearsSet.add(year);
      const typeLabel = (typeCol ? (row[typeCol] ?? '').trim() : '') || 'Divers';
      const v = parseAmountCell(row[amountCol] ?? '');
      if (v < 0) {
        const abs = Math.abs(v);
        totalSortiesByYear[year] = (totalSortiesByYear[year] ?? 0) + abs;
        if (!sortiesByYearByType[typeLabel]) sortiesByYearByType[typeLabel] = {};
        sortiesByYearByType[typeLabel][year] = (sortiesByYearByType[typeLabel][year] ?? 0) + abs;
      }
      if (v > 0) {
        totalEntréesByYear[year] = (totalEntréesByYear[year] ?? 0) + v;
        if (!entréesByYearByType[typeLabel]) entréesByYearByType[typeLabel] = {};
        entréesByYearByType[typeLabel][year] = (entréesByYearByType[typeLabel][year] ?? 0) + v;
      }
    }
    const years = Array.from(yearsSet).sort((a, b) => a - b);
    const allTypes = Array.from(
      new Set([...Object.keys(sortiesByYearByType), ...Object.keys(entréesByYearByType)])
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return {
      years,
      types: allTypes,
      totalSortiesByYear,
      totalEntréesByYear,
      sortiesByYearByType,
      entréesByYearByType,
    };
  }, [sourceData?.rows, movementsColumns]);

  /** Données Suivi annuel filtrées selon les années visibles (tableau + graphique) */
  const yearlyViewDataFiltered = useMemo(() => {
    if (!yearlyViewData) return null;
    const years = yearlyViewData.years.filter((y) => !vueGlobaleHiddenYears[y]);
    if (years.length === 0) return { ...yearlyViewData, years: [] };
    const totalSortiesByYear: Record<number, number> = {};
    const totalEntréesByYear: Record<number, number> = {};
    const sortiesByYearByType: Record<string, Record<number, number>> = {};
    const entréesByYearByType: Record<string, Record<number, number>> = {};
    years.forEach((y) => {
      totalSortiesByYear[y] = yearlyViewData.totalSortiesByYear[y] ?? 0;
      totalEntréesByYear[y] = yearlyViewData.totalEntréesByYear[y] ?? 0;
    });
    yearlyViewData.types.forEach((type) => {
      sortiesByYearByType[type] = {};
      entréesByYearByType[type] = {};
      years.forEach((y) => {
        sortiesByYearByType[type][y] = yearlyViewData.sortiesByYearByType[type]?.[y] ?? 0;
        entréesByYearByType[type][y] = yearlyViewData.entréesByYearByType[type]?.[y] ?? 0;
      });
    });
    return {
      years,
      types: yearlyViewData.types,
      totalSortiesByYear,
      totalEntréesByYear,
      sortiesByYearByType,
      entréesByYearByType,
    };
  }, [yearlyViewData, vueGlobaleHiddenYears]);

  /** Données pour YearlySummaryChart (avec types pour barres empilées, montants en devise d'affichage) */
  const yearlyChartData = useMemo(() => {
    if (!yearlyViewDataFiltered || yearlyViewDataFiltered.years.length === 0) return null;
    const { years, totalSortiesByYear, totalEntréesByYear, sortiesByYearByType, entréesByYearByType } = yearlyViewDataFiltered;
    const toDisplay = (amount: number) =>
      convertMovementsToDisplayCurrency(amount, vueGlobaleYAxisCurrency as CurrencySymbol);
    const sortieTypes = yearlyViewDataFiltered.types
      .filter((t) => years.some((y) => (sortiesByYearByType[t]?.[y] ?? 0) > 0))
      .sort((a, b) => {
        const sumA = years.reduce((s, y) => s + (sortiesByYearByType[a]?.[y] ?? 0), 0);
        const sumB = years.reduce((s, y) => s + (sortiesByYearByType[b]?.[y] ?? 0), 0);
        return sumB - sumA;
      });
    const entréeTypes = yearlyViewDataFiltered.types
      .filter((t) => years.some((y) => (entréesByYearByType[t]?.[y] ?? 0) > 0))
      .sort((a, b) => {
        const sumA = years.reduce((s, y) => s + (entréesByYearByType[a]?.[y] ?? 0), 0);
        const sumB = years.reduce((s, y) => s + (entréesByYearByType[b]?.[y] ?? 0), 0);
        return sumB - sumA;
      });
    const sortiesByTypeByYear: Record<string, number[]> = {};
    sortieTypes.forEach((type) => {
      sortiesByTypeByYear[type] = years.map((y) => toDisplay(sortiesByYearByType[type]?.[y] ?? 0));
    });
    const entréesByTypeByYear: Record<string, number[]> = {};
    entréeTypes.forEach((type) => {
      entréesByTypeByYear[type] = years.map((y) => toDisplay(entréesByYearByType[type]?.[y] ?? 0));
    });
    return {
      years,
      totalSortiesByYear: Object.fromEntries(years.map((y) => [y, toDisplay(totalSortiesByYear[y] ?? 0)])),
      totalEntréesByYear: Object.fromEntries(years.map((y) => [y, toDisplay(totalEntréesByYear[y] ?? 0)])),
      sortieTypes: sortieTypes.length > 0 ? sortieTypes : undefined,
      entréeTypes: entréeTypes.length > 0 ? entréeTypes : undefined,
      sortiesByTypeByYear: Object.keys(sortiesByTypeByYear).length > 0 ? sortiesByTypeByYear : undefined,
      entréesByTypeByYear: Object.keys(entréesByTypeByYear).length > 0 ? entréesByTypeByYear : undefined,
    };
  }, [yearlyViewDataFiltered, vueGlobaleYAxisCurrency]);

  /** Libellés de la légende du graphe Suivi annuel (barres + courbe Balance). */
  const yearlySummarySeriesLabels = useMemo((): string[] => {
    const d = yearlyChartData;
    if (!d) return [];
    const sortieLabels = d.sortieTypes && d.sortieTypes.length > 0 ? d.sortieTypes : ['Sorties'];
    const entreeLabels = d.entréeTypes && d.entréeTypes.length > 0 ? d.entréeTypes : ['Entrées'];
    return [...sortieLabels, ...entreeLabels, 'Balance'];
  }, [yearlyChartData]);
  const areAllYearlySummarySeriesChecked = useMemo(
    () =>
      yearlySummarySeriesLabels.length > 0 &&
      yearlySummarySeriesLabels.every((label) => !(vueGlobaleHiddenSeriesByLabel[label] ?? false)),
    [yearlySummarySeriesLabels, vueGlobaleHiddenSeriesByLabel]
  );
  const yearlySummarySortieLabelSet = useMemo(() => {
    const d = yearlyChartData;
    if (!d) return new Set<string>();
    const sortieLabels = d.sortieTypes && d.sortieTypes.length > 0 ? d.sortieTypes : ['Sorties'];
    return new Set(sortieLabels);
  }, [yearlyChartData]);

  /** Balance par compte pour la colonne A du bloc Evolution comparée */
  const movementsCompareBalanceByAccountA = useMemo(() => {
    if (!sourceData?.rows?.length || !movementsColumns) return null;
    const { dateCol, amountCol, accountCol } = movementsColumns;
    if (!dateCol || !amountCol) return null;
    const startTs = movementsCompareStartDateA.getTime();
    const endTs = movementsCompareEndDateA.getTime();
    const sortiesByAccount: Record<string, number> = {};
    const entréesByAccount: Record<string, number> = {};
    for (const row of sourceData.rows) {
      const cellDate = parseDateFromCell(row[dateCol] ?? '');
      if (!cellDate) continue;
      const t = cellDate.getTime();
      if (t < startTs || t > endTs) continue;
      const rawAccount = (accountCol ? (row[accountCol] ?? '').trim() : '') || 'Sans compte';
      const accountKey =
        rawAccount === 'Sans compte' ? 'Sans compte' : (canonicalAccountFromSource(rawAccount) || rawAccount);
      const v = parseAmountCell(row[amountCol] ?? '');
      if (v < 0) sortiesByAccount[accountKey] = (sortiesByAccount[accountKey] ?? 0) + Math.abs(v);
      if (v > 0) entréesByAccount[accountKey] = (entréesByAccount[accountKey] ?? 0) + v;
    }
    const accounts = Array.from(
      new Set([...Object.keys(sortiesByAccount), ...Object.keys(entréesByAccount)])
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const rows = accounts.map((account) => {
      const sorties = sortiesByAccount[account] ?? 0;
      const entrées = entréesByAccount[account] ?? 0;
      return { account: accountLabelFromSource(account) || account, balance: entrées - sorties };
    });
    return rows.length ? rows : null;
  }, [sourceData?.rows, movementsColumns, movementsCompareStartDateA, movementsCompareEndDateA]);

  /** Balance par compte pour la colonne B du bloc Evolution comparée */
  const movementsCompareBalanceByAccountB = useMemo(() => {
    if (!sourceData?.rows?.length || !movementsColumns) return null;
    const { dateCol, amountCol, accountCol } = movementsColumns;
    if (!dateCol || !amountCol) return null;
    const startTs = movementsCompareStartDateB.getTime();
    const endTs = movementsCompareEndDateB.getTime();
    const sortiesByAccount: Record<string, number> = {};
    const entréesByAccount: Record<string, number> = {};
    for (const row of sourceData.rows) {
      const cellDate = parseDateFromCell(row[dateCol] ?? '');
      if (!cellDate) continue;
      const t = cellDate.getTime();
      if (t < startTs || t > endTs) continue;
      const rawAccount = (accountCol ? (row[accountCol] ?? '').trim() : '') || 'Sans compte';
      const accountKey =
        rawAccount === 'Sans compte' ? 'Sans compte' : (canonicalAccountFromSource(rawAccount) || rawAccount);
      const v = parseAmountCell(row[amountCol] ?? '');
      if (v < 0) sortiesByAccount[accountKey] = (sortiesByAccount[accountKey] ?? 0) + Math.abs(v);
      if (v > 0) entréesByAccount[accountKey] = (entréesByAccount[accountKey] ?? 0) + v;
    }
    const accounts = Array.from(
      new Set([...Object.keys(sortiesByAccount), ...Object.keys(entréesByAccount)])
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const rows = accounts.map((account) => {
      const sorties = sortiesByAccount[account] ?? 0;
      const entrées = entréesByAccount[account] ?? 0;
      return { account: accountLabelFromSource(account) || account, balance: entrées - sorties };
    });
    return rows.length ? rows : null;
  }, [sourceData?.rows, movementsColumns, movementsCompareStartDateB, movementsCompareEndDateB]);

  /** Données mensuelles pour le graphique mouvements (sorties / entrées / balance par mois, avec détail par type) */
  const movementsMonthlyChartData = useMemo((): MovementsMonthlyChartData | null => {
    if (!sourceData?.rows?.length || !movementsColumns) return null;
    const { dateCol, amountCol, typeCol } = movementsColumns;
    if (!dateCol || !amountCol) return null;
    const start = startOfMonth(movementsStartDate);
    const end = startOfMonth(movementsEndDate);
    if (start.getTime() > end.getTime()) return null;
    const monthDates = eachMonthOfInterval({ start, end });
    const n = monthDates.length;
    const startTs = movementsStartDate.getTime();
    const endTs = movementsEndDate.getTime();

    const sortiesByType: Record<string, number> = {};
    const entréesByType: Record<string, number> = {};
    const sortiesByTypeByMonth: Record<string, number[]> = {};
    const entréesByTypeByMonth: Record<string, number[]> = {};

    function ensureMonthArrays(typeLabel: string) {
      if (!sortiesByTypeByMonth[typeLabel]) sortiesByTypeByMonth[typeLabel] = new Array(n).fill(0);
      if (!entréesByTypeByMonth[typeLabel]) entréesByTypeByMonth[typeLabel] = new Array(n).fill(0);
    }

    for (const row of sourceData.rows) {
      const cellDate = parseDateFromCell(row[dateCol] ?? '');
      if (!cellDate) continue;
      const t = cellDate.getTime();
      if (t < startTs || t > endTs) continue;
      const typeLabel = (typeCol ? (row[typeCol] ?? '').trim() : '') || 'Divers';
      const monthStart = startOfMonth(cellDate);
      const idx = monthDates.findIndex((d) => d.getTime() === monthStart.getTime());
      if (idx < 0) continue;
      ensureMonthArrays(typeLabel);
      const v = parseAmountCell(row[amountCol] ?? '');
      if (v < 0) {
        const abs = Math.abs(v);
        sortiesByType[typeLabel] = (sortiesByType[typeLabel] ?? 0) + abs;
        sortiesByTypeByMonth[typeLabel][idx] += abs;
      }
      if (v > 0) {
        entréesByType[typeLabel] = (entréesByType[typeLabel] ?? 0) + v;
        entréesByTypeByMonth[typeLabel][idx] += v;
      }
    }

    const sortieTypes = Object.keys(sortiesByType).sort(
      (a, b) => (sortiesByType[b] ?? 0) - (sortiesByType[a] ?? 0)
    );
    const entréeTypes = Object.keys(entréesByType).sort(
      (a, b) => (entréesByType[b] ?? 0) - (entréesByType[a] ?? 0)
    );

    const sortiesByMonth = sortieTypes.length
      ? monthDates.map((_, i) => sortieTypes.reduce((s, t) => s + (sortiesByTypeByMonth[t]?.[i] ?? 0), 0))
      : new Array(n).fill(0);
    const entréesByMonth = entréeTypes.length
      ? monthDates.map((_, i) => entréeTypes.reduce((s, t) => s + (entréesByTypeByMonth[t]?.[i] ?? 0), 0))
      : new Array(n).fill(0);

    const months = monthDates.map((d) => format(d, 'MMM yyyy'));
    const balanceByMonth = entréesByMonth.map((e, i) => e - sortiesByMonth[i]);

    return {
      months,
      sortiesByMonth,
      entréesByMonth,
      balanceByMonth,
      sortieTypes,
      entréeTypes,
      sortiesByTypeByMonth,
      entréesByTypeByMonth,
    };
  }, [
    sourceData?.rows,
    movementsColumns,
    movementsStartDate,
    movementsEndDate,
  ]);

  /** Convertit les données mensuelles mouvements (GBP) vers la devise d'affichage. */
  const movementsMonthlyChartDataForMovements = useMemo((): MovementsMonthlyChartData | null => {
    if (!movementsMonthlyChartData) return null;
    const c = movementsYAxisCurrency as CurrencySymbol;
    return {
      months: movementsMonthlyChartData.months,
      sortiesByMonth: movementsMonthlyChartData.sortiesByMonth.map((v) => convertMovementsToDisplayCurrency(v, c)),
      entréesByMonth: movementsMonthlyChartData.entréesByMonth.map((v) => convertMovementsToDisplayCurrency(v, c)),
      balanceByMonth: movementsMonthlyChartData.balanceByMonth.map((v) => convertMovementsToDisplayCurrency(v, c)),
      sortieTypes: movementsMonthlyChartData.sortieTypes,
      entréeTypes: movementsMonthlyChartData.entréeTypes,
      sortiesByTypeByMonth: movementsMonthlyChartData.sortiesByTypeByMonth
        ? Object.fromEntries(
            Object.entries(movementsMonthlyChartData.sortiesByTypeByMonth).map(([k, arr]) => [
              k,
              arr.map((v) => convertMovementsToDisplayCurrency(v, c)),
            ])
          )
        : undefined,
      entréesByTypeByMonth: movementsMonthlyChartData.entréesByTypeByMonth
        ? Object.fromEntries(
            Object.entries(movementsMonthlyChartData.entréesByTypeByMonth).map(([k, arr]) => [
              k,
              arr.map((v) => convertMovementsToDisplayCurrency(v, c)),
            ])
          )
        : undefined,
    };
  }, [movementsMonthlyChartData, movementsYAxisCurrency]);

  /** Labels de séries visibles dans la légende du graphique mensuel mouvements. */
  const movementsMonthlySeriesLabels = useMemo((): string[] => {
    const d = movementsMonthlyChartDataForMovements;
    if (!d) return [];
    const sortieLabels = d.sortieTypes && d.sortieTypes.length > 0 ? d.sortieTypes : ['Sorties'];
    const entreeLabels = d.entréeTypes && d.entréeTypes.length > 0 ? d.entréeTypes : ['Entrées'];
    return [...sortieLabels, ...entreeLabels];
  }, [movementsMonthlyChartDataForMovements]);
  const areAllMonthlySeriesChecked = useMemo(
    () =>
      movementsMonthlySeriesLabels.length > 0 &&
      movementsMonthlySeriesLabels.every((label) => !(hiddenMonthlySeriesByLabel[label] ?? false)),
    [movementsMonthlySeriesLabels, hiddenMonthlySeriesByLabel]
  );
  const movementsMonthlySortieLabelSet = useMemo(() => {
    const d = movementsMonthlyChartDataForMovements;
    if (!d) return new Set<string>();
    const sortieLabels = d.sortieTypes && d.sortieTypes.length > 0 ? d.sortieTypes : ['Sorties'];
    return new Set(sortieLabels);
  }, [movementsMonthlyChartDataForMovements]);

  const handleDateRangeChange = useCallback(
    (startDate: Date, endDate: Date) => {
      if (!dashboardDates.length) return;
      const ds = dashboardDates;
      const startTs = startDate.getTime();
      const endTs = endDate.getTime();
      let startIdx = ds.findIndex((d) => d.getTime() >= startTs);
      if (startIdx === -1) startIdx = ds.length - 1;
      let endIdx = 0;
      for (let i = 0; i < ds.length; i++) {
        if (ds[i].getTime() <= endTs) endIdx = i;
      }
      if (startIdx > endIdx) endIdx = startIdx;
      const range: [number, number] = [startIdx, endIdx];
      setChartRange(range);
      saveDashboardPref(DASHBOARD_STORAGE_KEYS.chartRange, JSON.stringify(range));
      if (movementsSyncsWithChart || chartSyncsWithMovements) {
        setMovementsRange(range);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsRange, JSON.stringify(range));
      }
      if (tablesSyncsWithChart) {
        setTablesRange(range);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesRange, JSON.stringify(range));
      }
    },
    [dashboardDates, movementsSyncsWithChart, chartSyncsWithMovements, tablesSyncsWithChart]
  );

  const handleMovementsDateRangeChange = useCallback(
    (startDate: Date, endDate: Date) => {
      if (!dashboardDates.length) return;
      const ds = dashboardDates;
      const startTs = startDate.getTime();
      const endTs = endDate.getTime();
      let startIdx = ds.findIndex((d) => d.getTime() >= startTs);
      if (startIdx === -1) startIdx = ds.length - 1;
      let endIdx = 0;
      for (let i = 0; i < ds.length; i++) {
        if (ds[i].getTime() <= endTs) endIdx = i;
      }
      if (startIdx > endIdx) endIdx = startIdx;
      const range: [number, number] = [startIdx, endIdx];
      setMovementsRange(range);
      saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsRange, JSON.stringify(range));
      if (chartSyncsWithMovements || movementsSyncsWithChart) {
        setChartRange(range);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.chartRange, JSON.stringify(range));
      }
      if (tablesSyncsWithMovements) {
        setTablesRange(range);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesRange, JSON.stringify(range));
      }
    },
    [dashboardDates, chartSyncsWithMovements, movementsSyncsWithChart, tablesSyncsWithMovements]
  );

  const handleTablesDateRangeChange = useCallback(
    (startDate: Date, endDate: Date) => {
      if (!dashboardDates.length) return;
      const ds = dashboardDates;
      const startTs = startDate.getTime();
      const endTs = endDate.getTime();
      let startIdx = ds.findIndex((d) => d.getTime() >= startTs);
      if (startIdx === -1) startIdx = ds.length - 1;
      let endIdx = 0;
      for (let i = 0; i < ds.length; i++) {
        if (ds[i].getTime() <= endTs) endIdx = i;
      }
      if (startIdx > endIdx) endIdx = startIdx;
      const range: [number, number] = [startIdx, endIdx];
      setTablesRange(range);
      saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesRange, JSON.stringify(range));
      if (tablesSyncsWithChart) {
        setChartRange(range);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.chartRange, JSON.stringify(range));
        if (movementsSyncsWithChart || chartSyncsWithMovements) {
          setMovementsRange(range);
          saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsRange, JSON.stringify(range));
        }
      }
      if (tablesSyncsWithMovements) {
        setMovementsRange(range);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsRange, JSON.stringify(range));
        if (chartSyncsWithMovements || movementsSyncsWithChart) {
          setChartRange(range);
          saveDashboardPref(DASHBOARD_STORAGE_KEYS.chartRange, JSON.stringify(range));
        }
      }
    },
    [
      dashboardDates,
      tablesSyncsWithChart,
      tablesSyncsWithMovements,
      movementsSyncsWithChart,
      chartSyncsWithMovements,
    ]
  );

  const handleTablesChartSyncChange = useCallback((checked: boolean) => {
    setTablesSyncsWithChart(checked);
    if (checked) {
      setTablesSyncsWithMovements(false);
      setTablesRange(chartRange);
      saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesRange, JSON.stringify(chartRange));
    }
  }, [chartRange]);

  const handleTablesMovementsSyncChange = useCallback((checked: boolean) => {
    setTablesSyncsWithMovements(checked);
    if (checked) {
      setTablesSyncsWithChart(false);
      setTablesRange(movementsRange);
      saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesRange, JSON.stringify(movementsRange));
    }
  }, [movementsRange]);

  const handleMovementsCompareDateRangeChangeA = useCallback(
    (startDate: Date, endDate: Date) => {
      if (!dashboardDates.length) return;
      const ds = dashboardDates;
      const startTs = startDate.getTime();
      const endTs = endDate.getTime();
      let startIdx = ds.findIndex((d) => d.getTime() >= startTs);
      if (startIdx === -1) startIdx = ds.length - 1;
      let endIdx = 0;
      for (let i = 0; i < ds.length; i++) {
        if (ds[i].getTime() <= endTs) endIdx = i;
      }
      if (startIdx > endIdx) endIdx = startIdx;
      const range: [number, number] = [startIdx, endIdx];
      setMovementsCompareRangeA(range);
      saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareRangeA, JSON.stringify(range));
    },
    [dashboardDates]
  );

  const handleMovementsCompareDateRangeChangeB = useCallback(
    (startDate: Date, endDate: Date) => {
      if (!dashboardDates.length) return;
      const ds = dashboardDates;
      const startTs = startDate.getTime();
      const endTs = endDate.getTime();
      let startIdx = ds.findIndex((d) => d.getTime() >= startTs);
      if (startIdx === -1) startIdx = ds.length - 1;
      let endIdx = 0;
      for (let i = 0; i < ds.length; i++) {
        if (ds[i].getTime() <= endTs) endIdx = i;
      }
      if (startIdx > endIdx) endIdx = startIdx;
      const range: [number, number] = [startIdx, endIdx];
      setMovementsCompareRangeB(range);
      saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareRangeB, JSON.stringify(range));
    },
    [dashboardDates]
  );

  const handleChartSyncChange = useCallback(
    (checked: boolean) => {
      setChartSyncsWithMovements(checked);
      if (checked) {
        setMovementsSyncsWithChart(false);
        setChartRange(movementsRange);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.chartRange, JSON.stringify(movementsRange));
      }
    },
    [movementsRange]
  );

  const handleMovementsSyncChange = useCallback(
    (checked: boolean) => {
      setMovementsSyncsWithChart(checked);
      if (checked) {
        setChartSyncsWithMovements(false);
        setMovementsRange(chartRange);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsRange, JSON.stringify(chartRange));
      }
    },
    [chartRange]
  );

  const handleDateRangeSliderFullYearsChange = useCallback(
    (enabled: boolean) => {
      setDateRangeSliderFullYears(enabled);
      saveDashboardPref(DASHBOARD_STORAGE_KEYS.dateRangeSliderFullYears, String(enabled));
      if (!enabled || !dashboardDates.length) return;
      const ds = dashboardDates;
      const apply = (prev: [number, number]) => snapRangeIndicesToFullYears(ds, prev);
      setChartRange((prev) => {
        const n = apply(prev);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.chartRange, JSON.stringify(n));
        return n;
      });
      setMovementsRange((prev) => {
        const n = apply(prev);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsRange, JSON.stringify(n));
        return n;
      });
      setTablesRange((prev) => {
        const n = apply(prev);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesRange, JSON.stringify(n));
        return n;
      });
      setMovementsCompareRangeA((prev) => {
        const n = apply(prev);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareRangeA, JSON.stringify(n));
        return n;
      });
      setMovementsCompareRangeB((prev) => {
        const n = apply(prev);
        saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareRangeB, JSON.stringify(n));
        return n;
      });
    },
    [dashboardDates]
  );

  return (
    <main className="flex-1 flex flex-col min-w-0 p-4">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-800">Tableau de bord</h1>
        </div>

      {/* Graphique évolution des soldes (données = début de chaque mois depuis account_balance.csv) */}
      <section
        className="flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden mb-6"
        style={{ minHeight: sectionsExpanded.evolutionSoldes ? 320 : undefined }}
      >
        <header
          className={`bg-gradient-to-br from-slate-50 to-white ${
            sectionsExpanded.evolutionSoldes ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
          }`}
        >
          <div className="flex items-stretch">
            <button
              type="button"
              className="flex-1 min-w-0 px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
              onClick={() => setSectionExpanded('evolutionSoldes', !sectionsExpanded.evolutionSoldes)}
              aria-expanded={sectionsExpanded.evolutionSoldes}
            >
              <span
                className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
                  sectionsExpanded.evolutionSoldes ? 'rotate-90' : ''
                }`}
                aria-hidden
              >
                ▶
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                  Évolution des soldes
                </span>
              </span>
            </button>
            <div className="flex items-center shrink-0 pr-3 sm:pr-4">
              <button
                type="button"
                onClick={() => {
                  setChartFiltersOpen((o) => {
                    const next = !o;
                    saveDashboardPref(DASHBOARD_STORAGE_KEYS.chartFiltersOpen, String(next));
                    return next;
                  });
                }}
                title="Paramètres"
                className={`flex-shrink-0 p-2 rounded-lg border transition-colors ${
                  chartFiltersOpen
                    ? 'bg-gray-200 border-gray-300 text-gray-800'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
        </header>
        {sectionsExpanded.evolutionSoldes && (
        <div className="px-4 pb-4 pt-3">
        <>
        {chartLoading ? (
          <div className="flex items-center justify-center h-64 text-gray-500">
            Chargement…
          </div>
        ) : chartError ? (
          <div className="flex items-center justify-center h-64 text-amber-600">
            {chartError}
          </div>
        ) : hasChartData ? (
          <div className="flex gap-4 items-stretch">
            {/* Panneau paramètres : affiché uniquement quand ouvert */}
            {chartFiltersOpen && (
            <div className="flex-shrink-0 flex flex-col min-h-0 w-[200px]">
              <div className="flex-1 flex flex-col min-h-0 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                <button
                  type="button"
                  onClick={() => setChartFiltersOpen((o) => {
                    const next = !o;
                    saveDashboardPref(DASHBOARD_STORAGE_KEYS.chartFiltersOpen, String(next));
                    return next;
                  })}
                  className="flex-shrink-0 w-full px-3 py-2 text-left text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 flex items-center justify-between"
                >
                  Paramètres
                  <span className="text-gray-500">▼</span>
                </button>
                <div className="flex-1 min-h-0 flex flex-col p-3 gap-4 overflow-hidden">
                    <div className="flex-shrink-0">
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                        Devise axe vertical
                      </label>
                      <select
                        value={chartYAxisCurrency}
                        onChange={(e) => {
                          const v = e.target.value;
                          setChartYAxisCurrency(v);
                          saveDashboardPref(DASHBOARD_STORAGE_KEYS.chartYAxisCurrency, v);
                        }}
                        className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800"
                      >
                        {Y_AXIS_CURRENCIES.map(({ value, label }) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="border-t border-gray-200 my-0" aria-hidden />
                    <div className="flex-shrink-0">
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                        Axe vertical
                      </label>
                      <div className="space-y-1.5">
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={yAxisScale === 'linear'}
                            onChange={() => {
                              setYAxisScale('linear');
                              saveDashboardPref(DASHBOARD_STORAGE_KEYS.yAxisScale, 'linear');
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>Linéaire</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={yAxisScale === 'logarithmic'}
                            onChange={() => {
                              setYAxisScale('logarithmic');
                              saveDashboardPref(DASHBOARD_STORAGE_KEYS.yAxisScale, 'logarithmic');
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>Logarithme</span>
                        </label>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                        Hauteur du graphique
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={150}
                          max={600}
                          step={10}
                          value={chartHeightPx}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10);
                            if (Number.isFinite(v)) {
                              setChartHeightPx(v);
                              saveDashboardPref(DASHBOARD_STORAGE_KEYS.chartHeight, String(v));
                            }
                          }}
                          className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 accent-blue-600"
                        />
                        <span className="text-sm text-gray-700 tabular-nums w-10">
                          {chartHeightPx} px
                        </span>
                      </div>
                    </div>
                    {accountBalanceChartData && accountBalanceChartData.accountCodes.length > 0 && (
                      <div className="flex-shrink-0 flex flex-col">
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 flex-shrink-0">
                          Courbes de tendance
                        </label>
                        <div className="space-y-1.5">
                          {accountBalanceChartData.accountCodes.map((code) => {
                          const accountName =
                            accountBalanceChartData!.accounts[
                              accountBalanceChartData!.accountCodes.indexOf(code)
                            ] ?? code;
                          return (
                            <label
                              key={code}
                              className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={trendLinesByAccount[code] ?? false}
                                onChange={() =>
                                  setTrendLinesByAccount((prev) => ({
                                    ...prev,
                                    [code]: !(prev[code] ?? false),
                                  }))
                                }
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="truncate" title={accountName}>
                                {accountName}
                              </span>
                            </label>
                          );
                        })}
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={trendLinesByAccount['TOTAL'] ?? false}
                            onChange={() =>
                              setTrendLinesByAccount((prev) => ({
                                ...prev,
                                TOTAL: !(prev['TOTAL'] ?? false),
                              }))
                            }
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>Solde total</span>
                        </label>
                      </div>
                    </div>
                    )}
                    <div className="flex-shrink-0 border-t border-gray-200 pt-2" />
                    {filteredChartData && (
                      <div className="flex-shrink-0">
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                          Compte pour le graphique boursier
                        </label>
                        <select
                          value={
                            filteredChartData.accountCodes.includes(selectedAccountForStockChart)
                              ? selectedAccountForStockChart
                              : 'TOTAL'
                          }
                          onChange={(e) => {
                            const v = e.target.value;
                            setSelectedAccountForStockChart(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.selectedAccountStockChart, v);
                          }}
                          className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800"
                        >
                          <option value="TOTAL">Solde total</option>
                          {filteredChartData.accountCodes.map((code) => {
                            const name =
                              filteredChartData.accounts[
                                filteredChartData.accountCodes.indexOf(code)
                              ] ?? code;
                            return (
                              <option key={code} value={code}>
                                {name}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                    )}
                </div>
              </div>
            </div>
            )}
            <div className="flex-1 min-w-0 flex flex-col">
            {hasChartData && dates.length > 0 && (
              <div className="dashboard-date-slider-section w-full mb-6">
                <DateRangeSlider
                  minDate={minDate}
                  maxDate={maxDate}
                  startDate={chartSyncsWithMovements ? movementsStartDate : chartSliderStartForUi}
                  endDate={chartSyncsWithMovements ? movementsEndDate : chartSliderEndForUi}
                  onChange={handleDateRangeChange}
                  syncLabel="Synchroniser avec Suivi des mouvements"
                  syncChecked={chartSyncsWithMovements}
                  onSyncChange={handleChartSyncChange}
                  fullYearsMode={dateRangeSliderFullYears}
                  onFullYearsModeChange={handleDateRangeSliderFullYearsChange}
                />
              </div>
            )}
            <div className="h-5 flex-shrink-0" aria-hidden />
            <div className="min-h-0" style={{ height: chartHeightPx }}>
              {filteredChartData && filteredChartData.periods.length > 0 ? (
                <AccountBalanceLineChart
                  periods={filteredChartData.periods}
                  accounts={filteredChartData.accounts}
                  accountCodes={filteredChartData.accountCodes}
                  balanceData={filteredChartData.balanceData}
                  accountColors={filteredChartData.accountColors}
                  granularity={filteredChartData.granularity}
                  yAxisCurrency={chartYAxisCurrency}
                  yAxisScale={yAxisScale}
                  trendLinesEnabled={trendLinesByAccount}
                  hiddenSeriesByLabel={hiddenSeriesByLabel}
                  onLegendVisibilityChange={setHiddenSeriesByLabel}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                  Aucune donnée pour les filtres sélectionnés.
                </div>
              )}
            </div>
            {/* Soldes à la date de fin (poignée droite du slider) */}
            {hasChartData && filteredChartData && filteredChartData.periods.length > 0 && (
              <div className="w-full mt-3 flex flex-wrap gap-2">
                {filteredChartData.accounts.map((accountName, idx) => {
                  const code = filteredChartData.accountCodes[idx] ?? String(idx);
                  const lastPeriodIndex = filteredChartData.periods.length - 1;
                  const balanceEnd = filteredChartData.balanceData[idx]?.[lastPeriodIndex] ?? null;
                  const balanceStart = filteredChartData.balanceData[idx]?.[0] ?? null;
                  const hasEnd =
                    balanceEnd !== null && balanceEnd !== undefined && !Number.isNaN(balanceEnd);
                  const hasStart =
                    balanceStart !== null && balanceStart !== undefined && !Number.isNaN(balanceStart);
                  let variationPct: number | null = null;
                  if (hasEnd && hasStart && balanceStart !== 0) {
                    variationPct = ((balanceEnd - balanceStart) / balanceStart) * 100;
                  }
                  const balanceDiff =
                    hasEnd && hasStart ? (balanceEnd as number) - (balanceStart as number) : null;
                  const color = filteredChartData.accountColors[accountName] ?? '#808080';
                  const isExpanded = expandedBoxes[code] ?? false;
                  const reg = boxRegressions?.[code];
                  const equationStr =
                    reg != null
                      ? `y = ${reg.a.toFixed(2)}x${reg.b >= 0 ? ' + ' : ' − '}${Math.abs(reg.b).toFixed(2)}`
                      : null;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setExpandedBoxes((prev) => ({ ...prev, [code]: !(prev[code] ?? false) }))}
                      className={`flex-shrink-0 rounded-lg px-3 py-2 shadow-sm border border-black/10 text-left transition-all ${
                        isExpanded ? 'min-w-[280px]' : 'min-w-[120px]'
                      }`}
                      style={{ backgroundColor: color }}
                    >
                      <div className="text-xs font-medium text-white truncate" title={accountName}>
                        {accountName}
                      </div>
                      <div className="text-sm font-semibold text-white">
                        {hasEnd ? formatCurrency(balanceEnd, chartYAxisCurrency) : '–'}
                      </div>
                      {!isExpanded && balanceDiff !== null && (
                        <div className="mt-1.5 bg-white rounded px-1.5 py-0.5">
                          <span
                            className={`text-xs ${
                              balanceDiff >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {balanceDiff >= 0 ? '+' : ''}
                            {formatCurrency(balanceDiff, chartYAxisCurrency)}
                          </span>
                        </div>
                      )}
                      {isExpanded && (
                        <div className="mt-2 space-y-1 bg-white/95 rounded px-2 py-1.5 text-xs text-gray-800">
                          <div>
                            <span className="font-medium">Début :</span>{' '}
                            {hasStart ? formatCurrency(balanceStart, chartYAxisCurrency) : '–'}
                          </div>
                          <div>
                            <span className="font-medium">Fin :</span>{' '}
                            {hasEnd ? formatCurrency(balanceEnd, chartYAxisCurrency) : '–'}
                          </div>
                          {balanceDiff !== null && (
                            <div>
                              <span className="font-medium">Écart :</span>{' '}
                              <span className={balanceDiff >= 0 ? 'text-green-600' : 'text-red-600'}>
                                {balanceDiff >= 0 ? '+' : ''}
                                {formatCurrency(balanceDiff, chartYAxisCurrency)}
                              </span>
                            </div>
                          )}
                          {variationPct !== null && (
                            <div>
                              <span className="font-medium">Variation :</span>{' '}
                              <span className={variationPct >= 0 ? 'text-green-600' : 'text-red-600'}>
                                {variationPct >= 0 ? '+' : ''}
                                {variationPct.toFixed(1)} %
                              </span>
                            </div>
                          )}
                          {equationStr && (
                            <div className="pt-0.5 border-t border-gray-200">
                              <span className="font-medium">Tendance :</span> {equationStr}
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
                {/* Solde total à la date de fin */}
                {filteredChartData.accounts.length > 0 && (() => {
                  const lastPeriodIndex = filteredChartData.periods.length - 1;
                  let totalEnd = 0;
                  let totalStart = 0;
                  let hasAnyEnd = false;
                  let hasAnyStart = false;
                  filteredChartData.balanceData.forEach((row) => {
                    const ve = row[lastPeriodIndex];
                    const vs = row[0];
                    if (ve !== null && ve !== undefined && !Number.isNaN(ve)) {
                      totalEnd += ve;
                      hasAnyEnd = true;
                    }
                    if (vs !== null && vs !== undefined && !Number.isNaN(vs)) {
                      totalStart += vs;
                      hasAnyStart = true;
                    }
                  });
                  let variationPct: number | null = null;
                  if (hasAnyEnd && hasAnyStart && totalStart !== 0) {
                    variationPct = ((totalEnd - totalStart) / totalStart) * 100;
                  }
                  const totalDiff = hasAnyEnd && hasAnyStart ? totalEnd - totalStart : null;
                  const totalColor = '#b45309';
                  const isExpanded = expandedBoxes['TOTAL'] ?? false;
                  const reg = boxRegressions?.['TOTAL'];
                  const equationStr =
                    reg != null
                      ? `y = ${reg.a.toFixed(2)}x${reg.b >= 0 ? ' + ' : ' − '}${Math.abs(reg.b).toFixed(2)}`
                      : null;
                  return (
                    <button
                      type="button"
                      onClick={() => setExpandedBoxes((prev) => ({ ...prev, TOTAL: !(prev['TOTAL'] ?? false) }))}
                      className={`flex-shrink-0 rounded-lg px-3 py-2 shadow-sm border border-black/10 text-left transition-all ${
                        isExpanded ? 'min-w-[280px]' : 'min-w-[120px]'
                      }`}
                      style={{ backgroundColor: totalColor }}
                    >
                      <div className="text-xs font-medium text-white truncate" title="Solde total">
                        Solde total
                      </div>
                      <div className="text-sm font-semibold text-white">
                        {hasAnyEnd ? formatCurrency(totalEnd, chartYAxisCurrency) : '–'}
                      </div>
                      {!isExpanded && totalDiff !== null && (
                        <div className="mt-1.5 bg-white rounded px-1.5 py-0.5">
                          <span
                            className={`text-xs ${
                              totalDiff >= 0 ? 'text-green-600' : 'text-red-600'
                            }`}
                          >
                            {totalDiff >= 0 ? '+' : ''}
                            {formatCurrency(totalDiff, chartYAxisCurrency)}
                          </span>
                        </div>
                      )}
                      {isExpanded && (
                        <div className="mt-2 space-y-1 bg-white/95 rounded px-2 py-1.5 text-xs text-gray-800">
                          <div>
                            <span className="font-medium">Début :</span>{' '}
                            {hasAnyStart ? formatCurrency(totalStart, chartYAxisCurrency) : '–'}
                          </div>
                          <div>
                            <span className="font-medium">Fin :</span>{' '}
                            {hasAnyEnd ? formatCurrency(totalEnd, chartYAxisCurrency) : '–'}
                          </div>
                          {totalDiff !== null && (
                            <div>
                              <span className="font-medium">Écart :</span>{' '}
                              <span className={totalDiff >= 0 ? 'text-green-600' : 'text-red-600'}>
                                {totalDiff >= 0 ? '+' : ''}
                                {formatCurrency(totalDiff, chartYAxisCurrency)}
                              </span>
                            </div>
                          )}
                          {variationPct !== null && (
                            <div>
                              <span className="font-medium">Variation :</span>{' '}
                              <span className={variationPct >= 0 ? 'text-green-600' : 'text-red-600'}>
                                {variationPct >= 0 ? '+' : ''}
                                {variationPct.toFixed(1)} %
                              </span>
                            </div>
                          )}
                          {equationStr && (
                            <div className="pt-0.5 border-t border-gray-200">
                              <span className="font-medium">Tendance :</span> {equationStr}
                            </div>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })()}
              </div>
            )}
            {/* Graphique boursier : un compte, variations vert/rouge, plage = DateRangeSlider */}
            {hasChartData && stockChartData && stockChartData.periods.length > 0 && (
              <div className="w-full mt-3">
                <AccountBalanceStockChart
                  periods={stockChartData.periods}
                  balanceData={stockChartData.balanceData}
                  yAxisCurrency={chartYAxisCurrency}
                  height={220}
                />
              </div>
            )}
          </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-64 text-gray-500">
            Aucune donnée (fichier {ACCOUNT_BALANCE_PROCESSED_DIR}/src_account_balance.csv ou account_balance.csv absent ou vide)
          </div>
        )}
        </>
        </div>
        )}
      </section>

      {/* Suivi des mouvements */}
      <section className="flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden mb-6">
        <header
          className={`bg-gradient-to-br from-slate-50 to-white ${
            sectionsExpanded.suiviMouvements ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
          }`}
        >
          <div className="flex items-stretch">
            <button
              type="button"
              className="flex-1 min-w-0 px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
              onClick={() => setSectionExpanded('suiviMouvements', !sectionsExpanded.suiviMouvements)}
              aria-expanded={sectionsExpanded.suiviMouvements}
            >
              <span
                className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
                  sectionsExpanded.suiviMouvements ? 'rotate-90' : ''
                }`}
                aria-hidden
              >
                ▶
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                  Suivi des mouvements
                </span>
              </span>
            </button>
            <div className="flex items-center shrink-0 pr-3 sm:pr-4">
              <button
                type="button"
                onClick={() => {
                  setMovementsFiltersOpen((o) => {
                    const next = !o;
                    saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsFiltersOpen, String(next));
                    return next;
                  });
                }}
                title="Paramètres"
                className={`flex-shrink-0 p-2 rounded-lg border transition-colors ${
                  movementsFiltersOpen
                    ? 'bg-gray-200 border-gray-300 text-gray-800'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
        </header>
        {sectionsExpanded.suiviMouvements && (
        <div className="px-4 pb-4 pt-3">
        <>
        <div className="flex gap-4 items-stretch">
          {/* Panneau paramètres à gauche : pousse le contenu vers la droite */}
          {movementsFiltersOpen && (
            <div className="flex-shrink-0 flex flex-col min-h-0 w-[200px]">
              <div className="flex-1 flex flex-col min-h-0 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                <button
                  type="button"
                  onClick={() => setMovementsFiltersOpen((o) => {
                    const next = !o;
                    saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsFiltersOpen, String(next));
                    return next;
                  })}
                  className="flex-shrink-0 w-full px-3 py-2 text-left text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 flex items-center justify-between"
                >
                  Paramètres
                  <span className="text-gray-500">▼</span>
                </button>
                <div className="flex-1 min-h-0 flex flex-col p-3 gap-4 overflow-hidden">
                  <div className="flex-shrink-0">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Devise d&apos;affichage
                    </label>
                    <select
                      value={movementsYAxisCurrency}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMovementsYAxisCurrency(v);
                        saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsYAxisCurrency, v);
                      }}
                      className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800"
                    >
                      {Y_AXIS_CURRENCIES.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-shrink-0">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                      Hauteur du graphique mensuel
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={300}
                        max={800}
                        step={10}
                        value={movementsMonthlyChartHeightPx}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (Number.isFinite(v)) {
                            setMovementsMonthlyChartHeightPx(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsMonthlyChartHeight, String(v));
                          }
                        }}
                        className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 accent-blue-600"
                      />
                      <span className="text-sm text-gray-700 tabular-nums w-10">
                        {movementsMonthlyChartHeightPx} px
                      </span>
                    </div>
                  </div>
                  {movementsMonthlySeriesLabels.length > 0 && (
                    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                        Afficher uniquement les labels cochés
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none mb-2">
                        <input
                          type="checkbox"
                          checked={areAllMonthlySeriesChecked}
                          onChange={(e) => {
                            const isChecked = e.target.checked;
                            setHiddenMonthlySeriesByLabel((prev) => {
                              const next = { ...prev };
                              movementsMonthlySeriesLabels.forEach((label) => {
                                next[label] = !isChecked;
                              });
                              return next;
                            });
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>{areAllMonthlySeriesChecked ? 'Tout décocher' : 'Tout cocher'}</span>
                      </label>
                      <div className="flex-1 min-h-0 overflow-auto rounded border border-gray-200 bg-white p-2 space-y-1.5">
                        {movementsMonthlySeriesLabels.map((label) => {
                          const checked = !(hiddenMonthlySeriesByLabel[label] ?? false);
                          const isSortieLabel = movementsMonthlySortieLabelSet.has(label);
                          return (
                            <label
                              key={label}
                              className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const isChecked = e.target.checked;
                                  setHiddenMonthlySeriesByLabel((prev) => {
                                    const next = { ...prev };
                                    next[label] = !isChecked;
                                    return next;
                                  });
                                }}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="truncate" title={label}>
                                {label}
                              </span>
                              <span
                                className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                                  isSortieLabel ? 'bg-red-500' : 'bg-green-500'
                                }`}
                                aria-hidden
                                title={isSortieLabel ? 'Type sortie' : 'Type entrée'}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col">
        {dates.length > 0 && (
          <div className="w-full mb-4">
            <DateRangeSlider
              minDate={minDate}
              maxDate={maxDate}
              startDate={movementsSyncsWithChart ? chartSliderStartForUi : movementsStartDate}
              endDate={movementsSyncsWithChart ? chartSliderEndForUi : movementsEndDate}
              onChange={handleMovementsDateRangeChange}
              syncLabel="Synchroniser avec Évolution des soldes"
              syncChecked={movementsSyncsWithChart}
              onSyncChange={handleMovementsSyncChange}
              fullYearsMode={dateRangeSliderFullYears}
              onFullYearsModeChange={handleDateRangeSliderFullYearsChange}
            />
          </div>
        )}
        {movementsDataLoading && (
          <div className="py-6 text-center text-gray-500">Chargement…</div>
        )}
        {!movementsDataLoading && movementsDataError && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">
            {movementsDataError}
          </div>
        )}
        {!movementsDataLoading && !movementsDataError && movementsTableData && (
          <>
          <div className="flex flex-col gap-6">
          {/* Histogramme horizontal : entrées (gauche, vert) / 0 (centre) / sorties (droite, rouge) */}
          {movementsMonthlyChartDataForMovements && movementsMonthlyChartDataForMovements.months.length > 0 && (
            <div className="w-full rounded-lg border border-gray-200 bg-gray-50/50 p-3">
              <MovementsBalanceHorizontalBar
                data={movementsMonthlyChartDataForMovements}
                currency={movementsYAxisCurrency}
                hiddenSeriesByLabel={hiddenMonthlySeriesByLabel}
              />
            </div>
          )}
          {/* Graphique mensuel sorties / entrées / balance */}
          {movementsMonthlyChartDataForMovements && movementsMonthlyChartDataForMovements.months.length > 0 && (
            <div className="w-full rounded-lg border border-gray-200 bg-gray-50/50 p-3">
              <MovementsMonthlyChart
                data={movementsMonthlyChartDataForMovements}
                currency={movementsYAxisCurrency}
                height={movementsMonthlyChartHeightPx}
                hiddenSeriesByLabel={hiddenMonthlySeriesByLabel}
                onLegendVisibilityChange={setHiddenMonthlySeriesByLabel}
              />
            </div>
          )}
          </div>
          </>
        )}
        {!movementsDataLoading &&
          !movementsDataError &&
          sourceData &&
          !movementsTableData && (
            <div className="py-4 text-center text-gray-500 text-sm">
              Données source sans colonne Date ou Expense/Income, ou plage sans données.
            </div>
          )}
          </div>
        </div>
        </>
        </div>
        )}
      </section>

      {/* Evolution comparée des mouvements */}
      <section className="flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden mb-6">
        <header
          className={`bg-gradient-to-br from-slate-50 to-white ${
            sectionsExpanded.evolutionComparee ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
          }`}
        >
          <div className="flex items-stretch">
            <button
              type="button"
              className="flex-1 min-w-0 px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
              onClick={() => setSectionExpanded('evolutionComparee', !sectionsExpanded.evolutionComparee)}
              aria-expanded={sectionsExpanded.evolutionComparee}
            >
              <span
                className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
                  sectionsExpanded.evolutionComparee ? 'rotate-90' : ''
                }`}
                aria-hidden
              >
                ▶
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                  Evolution comparée des mouvements
                </span>
              </span>
            </button>
            <div className="flex items-center shrink-0 pr-3 sm:pr-4">
              <button
                type="button"
                onClick={() => {
                  setMovementsCompareFiltersOpen((o) => {
                    const next = !o;
                    saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareFiltersOpen, String(next));
                    return next;
                  });
                }}
                title="Paramètres"
                className={`flex-shrink-0 p-2 rounded-lg border transition-colors ${
                  movementsCompareFiltersOpen
                    ? 'bg-gray-200 border-gray-300 text-gray-800'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
        </header>
        {sectionsExpanded.evolutionComparee && (
        <div className="px-4 pb-4 pt-3">
        <>
        <div className="flex gap-4 items-stretch">
          {movementsCompareFiltersOpen && (
            <div className="flex-shrink-0 flex flex-col min-h-0 w-[200px]">
              <div className="flex-1 flex flex-col min-h-0 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                <button
                  type="button"
                  onClick={() => setMovementsCompareFiltersOpen((o) => {
                    const next = !o;
                    saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareFiltersOpen, String(next));
                    return next;
                  })}
                  className="flex-shrink-0 w-full px-3 py-2 text-left text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 flex items-center justify-between"
                >
                  Paramètres
                  <span className="text-gray-500">▼</span>
                </button>
                <div className="flex-1 min-h-0 flex flex-col p-3 gap-4 overflow-hidden">
                  <div className="flex-shrink-0">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Devise d&apos;affichage
                    </label>
                    <select
                      value={movementsCompareYAxisCurrency}
                      onChange={(e) => {
                        const v = e.target.value;
                        setMovementsCompareYAxisCurrency(v);
                        saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareYAxisCurrency, v);
                      }}
                      className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800"
                    >
                      {Y_AXIS_CURRENCIES.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-shrink-0">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={movementsCompareShowPct}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setMovementsCompareShowPct(v);
                          saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareShowPct, String(v));
                        }}
                        className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                      />
                      <span className="text-sm text-gray-700">Pourcentage comparatif</span>
                    </label>
                    <p className="text-xs text-gray-500 mt-0.5">Afficher les % par rapport à l&apos;autre plage</p>
                  </div>
                  <div className="flex-shrink-0">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Options d&apos;affichage
                    </p>
                    <div className="mt-2 space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={movementsCompareShowPieCharts}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setMovementsCompareShowPieCharts(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareShowPieCharts, String(v));
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                        />
                        <span className="text-sm text-gray-700">Afficher Diagrammes circulaires</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={movementsCompareShowTableByType}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setMovementsCompareShowTableByType(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareShowTableByType, String(v));
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                        />
                        <span className="text-sm text-gray-700">Afficher Tableaux entrées/sorties par Type</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={movementsCompareShowTableByAccount}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setMovementsCompareShowTableByAccount(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareShowTableByAccount, String(v));
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                        />
                        <span className="text-sm text-gray-700">Afficher Tableaux entrées/sorties par compte</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Hauteur tableaux par Type
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={300}
                        max={1000}
                        step={20}
                        value={movementsCompareTableByTypeHeight}
                        onChange={(e) => {
                          const v = Math.round(Number(e.target.value));
                          setMovementsCompareTableByTypeHeight(v);
                          saveDashboardPref(DASHBOARD_STORAGE_KEYS.movementsCompareTableByTypeHeight, String(v));
                        }}
                        className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 accent-gray-600"
                      />
                      <span className="text-sm text-gray-700 tabular-nums w-10">{movementsCompareTableByTypeHeight} px</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col">
        {movementsDataLoading && (
          <div className="py-6 text-center text-gray-500">Chargement…</div>
        )}
        {!movementsDataLoading && movementsDataError && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">
            {movementsDataError}
          </div>
        )}
        {!movementsDataLoading && !movementsDataError && (
          <>
          <div className="text-sm text-gray-700 mb-3">
            <p>Période du {format(movementsCompareStartDateA, 'dd/MM/yyyy')} au {format(movementsCompareEndDateA, 'dd/MM/yyyy')}</p>
            <p>Comparée à la période du {format(movementsCompareStartDateB, 'dd/MM/yyyy')} au {format(movementsCompareEndDateB, 'dd/MM/yyyy')}</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Colonne gauche — plage A */}
            <div className="flex flex-col min-w-0 border border-gray-200 rounded-lg p-4 bg-gray-50/50">
              {dates.length > 0 && (
                <div className="w-full mb-3">
                  <DateRangeSlider
                    minDate={minDate}
                    maxDate={maxDate}
                    startDate={movementsCompareStartDateA}
                    endDate={movementsCompareEndDateA}
                    onChange={handleMovementsCompareDateRangeChangeA}
                    fullYearsMode={dateRangeSliderFullYears}
                    onFullYearsModeChange={handleDateRangeSliderFullYearsChange}
                  />
                </div>
              )}
              {!movementsCompareTableDataA && sourceData && (
                <div className="py-4 text-center text-gray-500 text-sm">
                  Données source sans colonne Date ou Expense/Income, ou plage sans données.
                </div>
              )}
              {movementsCompareTableDataA && (
                <div className="flex flex-col gap-4">
                  {movementsCompareShowPieCharts && movementsComparePieSegmentsA.length > 0 && (
                    <div
                      className="flex flex-col items-center justify-center shrink-0"
                      style={{ maxHeight: 'min(38vh, 320px)', minWidth: '180px' }}
                    >
                      <MovementsPieChart
                        segments={movementsComparePieSegmentsA.map((s) => ({
                          ...s,
                          value: convertMovementsToDisplayCurrency(s.value, movementsCompareYAxisCurrency as CurrencySymbol),
                        }))}
                        totalSorties={convertMovementsToDisplayCurrency(
                          movementsCompareTableDataA.totalSorties,
                          movementsCompareYAxisCurrency as CurrencySymbol
                        )}
                        totalEntrées={convertMovementsToDisplayCurrency(
                          movementsCompareTableDataA.totalEntrées,
                          movementsCompareYAxisCurrency as CurrencySymbol
                        )}
                        yAxisCurrency={movementsCompareYAxisCurrency}
                      />
                    </div>
                  )}
                  {movementsCompareShowTableByType && (
                  <div className="overflow-x-auto overflow-y-auto border border-gray-200 rounded-lg flex-shrink-0 w-full bg-white" style={{ maxHeight: `${movementsCompareTableByTypeHeight}px` }}>
                    <table className={`border-collapse w-full ${movementsCompareShowPct ? 'text-[13px]' : 'text-sm'}`}>
                      <thead>
                        <tr>
                          <th className="sticky top-0 z-10 text-left font-semibold text-gray-800 px-3 py-2 border-b border-r border-gray-200 bg-red-100 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]" scope="col">Types</th>
                          <th className="sticky top-0 z-10 text-right font-semibold text-gray-800 px-3 py-2 border-b border-r border-gray-200 bg-red-100 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]" scope="col">Sorties</th>
                          <th className="sticky top-0 z-10 text-left font-semibold text-gray-800 px-3 py-2 border-b border-r border-gray-200 bg-green-100 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]" scope="col">Types</th>
                          <th className="sticky top-0 z-10 text-right font-semibold text-gray-800 px-3 py-2 border-b border-gray-200 bg-green-100 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]" scope="col">Entrées</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movementsCompareTableDataA.rowCount === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-4 text-center text-gray-500 border-b border-gray-200">Aucun mouvement sur la plage sélectionnée</td>
                          </tr>
                        ) : (
                          Array.from({ length: movementsCompareTableDataA.rowCount }, (_, i) => {
                            const typeSorties = movementsCompareTableDataA.typesWithSorties[i];
                            const typeEntrées = movementsCompareTableDataA.typesWithEntrées[i];
                            const sortiesA = typeSorties != null ? movementsCompareTableDataA.sortiesByType[typeSorties] ?? 0 : 0;
                            const entréesA = typeEntrées != null ? movementsCompareTableDataA.entréesByType[typeEntrées] ?? 0 : 0;
                            const sortiesB = typeSorties != null ? (movementsCompareTableDataB?.sortiesByType[typeSorties] ?? 0) : 0;
                            const entréesB = typeEntrées != null ? (movementsCompareTableDataB?.entréesByType[typeEntrées] ?? 0) : 0;
                            const pctSorties = sortiesB !== 0 ? ((sortiesA - sortiesB) / sortiesB) * 100 : null;
                            const pctEntrées = entréesB !== 0 ? ((entréesA - entréesB) / entréesB) * 100 : null;
                            return (
                              <tr key={typeSorties ?? typeEntrées ?? `row-a-${i}`} className="border-b border-gray-100">
                                <td className="px-3 py-2 border-r border-gray-200 bg-red-50/50">{typeSorties ?? ''}</td>
                                <td className="px-3 py-2 text-right border-r border-gray-200 bg-red-50/50 tabular-nums">
                                  {typeSorties != null ? (
                                    <>
                                      −{formatCurrency(convertMovementsToDisplayCurrency(movementsCompareTableDataA.sortiesByType[typeSorties], movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}
                                      {pctSorties != null && movementsCompareShowPct && (
                                        <span className={pctSorties >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                          {' '}({pctSorties >= 0 ? '+' : ''}{pctSorties.toFixed(1)}%)
                                        </span>
                                      )}
                                    </>
                                  ) : ''}
                                </td>
                                <td className="px-3 py-2 border-r border-gray-200 bg-green-50/50">{typeEntrées ?? ''}</td>
                                <td className="px-3 py-2 text-right border-gray-200 bg-green-50/50 tabular-nums">
                                  {typeEntrées != null ? (
                                    <>
                                      +{formatCurrency(convertMovementsToDisplayCurrency(movementsCompareTableDataA.entréesByType[typeEntrées], movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}
                                      {pctEntrées != null && movementsCompareShowPct && (
                                        <span className={pctEntrées >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                          {' '}({pctEntrées >= 0 ? '+' : ''}{pctEntrées.toFixed(1)}%)
                                        </span>
                                      )}
                                    </>
                                  ) : ''}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold bg-gray-50">
                          <td className="sticky bottom-8 z-10 px-3 py-2 border-t border-r border-gray-200 bg-red-100 shadow-[0_-1px_0_0_rgba(0,0,0,0.05)]">Total</td>
                          <td className="sticky bottom-8 z-10 px-3 py-2 text-right border-t border-r border-gray-200 bg-red-100 tabular-nums shadow-[0_-1px_0_0_rgba(0,0,0,0.05)]">
                            −{formatCurrency(convertMovementsToDisplayCurrency(movementsCompareTableDataA.totalSorties, movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}
                            {movementsCompareShowPct && movementsCompareTableDataB && movementsCompareTableDataB.totalSorties !== 0 && (
                              <span className={((movementsCompareTableDataA.totalSorties - movementsCompareTableDataB.totalSorties) / movementsCompareTableDataB.totalSorties) * 100 >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                {' '}({((movementsCompareTableDataA.totalSorties - movementsCompareTableDataB.totalSorties) / movementsCompareTableDataB.totalSorties) * 100 >= 0 ? '+' : ''}{(((movementsCompareTableDataA.totalSorties - movementsCompareTableDataB.totalSorties) / movementsCompareTableDataB.totalSorties) * 100).toFixed(1)}%)
                              </span>
                            )}
                          </td>
                          <td className="sticky bottom-8 z-10 px-3 py-2 border-t border-r border-gray-200 bg-green-100 shadow-[0_-1px_0_0_rgba(0,0,0,0.05)]">Total</td>
                          <td className="sticky bottom-8 z-10 px-3 py-2 text-right border-t border-gray-200 bg-green-100 tabular-nums shadow-[0_-1px_0_0_rgba(0,0,0,0.05)]">
                            +{formatCurrency(convertMovementsToDisplayCurrency(movementsCompareTableDataA.totalEntrées, movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}
                            {movementsCompareShowPct && movementsCompareTableDataB && movementsCompareTableDataB.totalEntrées !== 0 && (
                              <span className={((movementsCompareTableDataA.totalEntrées - movementsCompareTableDataB.totalEntrées) / movementsCompareTableDataB.totalEntrées) * 100 >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                {' '}({((movementsCompareTableDataA.totalEntrées - movementsCompareTableDataB.totalEntrées) / movementsCompareTableDataB.totalEntrées) * 100 >= 0 ? '+' : ''}{(((movementsCompareTableDataA.totalEntrées - movementsCompareTableDataB.totalEntrées) / movementsCompareTableDataB.totalEntrées) * 100).toFixed(1)}%)
                              </span>
                            )}
                          </td>
                        </tr>
                        <tr className="font-semibold bg-gray-100">
                          <td className="sticky bottom-0 z-10 px-3 py-2 border-t border-gray-200 bg-gray-100 shadow-[0_-1px_0_0_rgba(0,0,0,0.05)]" colSpan={3}>Balance</td>
                          <td className={`sticky bottom-0 z-10 px-3 py-2 text-right border-t border-gray-200 tabular-nums bg-gray-100 shadow-[0_-1px_0_0_rgba(0,0,0,0.05)] ${movementsCompareTableDataA.totalEntrées - movementsCompareTableDataA.totalSorties >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {(() => {
                              const balance = movementsCompareTableDataA.totalEntrées - movementsCompareTableDataA.totalSorties;
                              const sign = balance >= 0 ? '+' : '−';
                              const balanceB = movementsCompareTableDataB ? movementsCompareTableDataB.totalEntrées - movementsCompareTableDataB.totalSorties : 0;
                              const pctBalance = balanceB !== 0 ? ((balance - balanceB) / balanceB) * 100 : null;
                              return (
                                <>
                                  {sign}{formatCurrency(Math.abs(convertMovementsToDisplayCurrency(balance, movementsCompareYAxisCurrency as CurrencySymbol)), movementsCompareYAxisCurrency)}
                                  {pctBalance != null && movementsCompareShowPct && (
                                    <span className={pctBalance >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                      {' '}({pctBalance >= 0 ? '+' : ''}{pctBalance.toFixed(1)}%)
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  )}
                  {movementsCompareShowTableByAccount && movementsCompareBalanceByAccountA && movementsCompareBalanceByAccountA.length > 0 && (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg flex-shrink-0 w-full bg-white">
                      <table className={`border-collapse w-full ${movementsCompareShowPct ? 'text-[13px]' : 'text-sm'}`}>
                        <thead>
                          <tr>
                            <th className="text-left font-semibold text-gray-800 px-3 py-2 border-b border-r border-gray-200 bg-gray-100" scope="col">Compte</th>
                            <th className="text-right font-semibold text-gray-800 px-3 py-2 border-b border-gray-200 bg-gray-100" scope="col">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {movementsCompareBalanceByAccountA.map(({ account, balance }) => {
                            const balanceB = movementsCompareBalanceByAccountB?.find((r) => r.account === account)?.balance ?? 0;
                            const pct = balanceB !== 0 ? ((balance - balanceB) / balanceB) * 100 : (balance !== 0 ? 100 : null);
                            return (
                              <tr key={`compare-a-${account}`} className="border-b border-gray-100">
                                <td className="px-3 py-2 border-r border-gray-200 bg-gray-50/50">{account}</td>
                                <td className={`px-3 py-2 text-right border-gray-200 tabular-nums ${balance >= 0 ? 'text-green-700 bg-green-50/50' : 'text-red-700 bg-red-50/50'}`}>
                                  {balance >= 0 ? `+${formatCurrency(convertMovementsToDisplayCurrency(balance, movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}` : `−${formatCurrency(convertMovementsToDisplayCurrency(Math.abs(balance), movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}`}
                                  {pct != null && movementsCompareShowPct && (
                                    <span className={pct >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                      {' '}({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="font-semibold bg-gray-100">
                            <td className="px-3 py-2 border-t border-r border-gray-200">Balance</td>
                            <td className={`px-3 py-2 text-right border-t border-gray-200 tabular-nums ${movementsCompareTableDataA.totalEntrées - movementsCompareTableDataA.totalSorties >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                              {(() => {
                                const total = movementsCompareTableDataA.totalEntrées - movementsCompareTableDataA.totalSorties;
                                const sign = total >= 0 ? '+' : '−';
                                const totalB = movementsCompareTableDataB ? movementsCompareTableDataB.totalEntrées - movementsCompareTableDataB.totalSorties : 0;
                                const pctTotal = totalB !== 0 ? ((total - totalB) / totalB) * 100 : null;
                                return (
                                  <>
                                    {sign}{formatCurrency(Math.abs(convertMovementsToDisplayCurrency(total, movementsCompareYAxisCurrency as CurrencySymbol)), movementsCompareYAxisCurrency)}
                                    {pctTotal != null && movementsCompareShowPct && (
                                      <span className={pctTotal >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                        {' '}({pctTotal >= 0 ? '+' : ''}{pctTotal.toFixed(1)}%)
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Colonne droite — plage B */}
            <div className="flex flex-col min-w-0 border border-gray-200 rounded-lg p-4 bg-gray-50/50">
              {dates.length > 0 && (
                <div className="w-full mb-3">
                  <DateRangeSlider
                    minDate={minDate}
                    maxDate={maxDate}
                    startDate={movementsCompareStartDateB}
                    endDate={movementsCompareEndDateB}
                    onChange={handleMovementsCompareDateRangeChangeB}
                    fullYearsMode={dateRangeSliderFullYears}
                    onFullYearsModeChange={handleDateRangeSliderFullYearsChange}
                  />
                </div>
              )}
              {!movementsCompareTableDataB && sourceData && (
                <div className="py-4 text-center text-gray-500 text-sm">
                  Données source sans colonne Date ou Expense/Income, ou plage sans données.
                </div>
              )}
              {movementsCompareTableDataB && (
                <div className="flex flex-col gap-4">
                  {movementsCompareShowPieCharts && movementsComparePieSegmentsB.length > 0 && (
                    <div
                      className="flex flex-col items-center justify-center shrink-0"
                      style={{ maxHeight: 'min(38vh, 320px)', minWidth: '180px' }}
                    >
                      <MovementsPieChart
                        segments={movementsComparePieSegmentsB.map((s) => ({
                          ...s,
                          value: convertMovementsToDisplayCurrency(s.value, movementsCompareYAxisCurrency as CurrencySymbol),
                        }))}
                        totalSorties={convertMovementsToDisplayCurrency(
                          movementsCompareTableDataB.totalSorties,
                          movementsCompareYAxisCurrency as CurrencySymbol
                        )}
                        totalEntrées={convertMovementsToDisplayCurrency(
                          movementsCompareTableDataB.totalEntrées,
                          movementsCompareYAxisCurrency as CurrencySymbol
                        )}
                        yAxisCurrency={movementsCompareYAxisCurrency}
                      />
                    </div>
                  )}
                  {movementsCompareShowTableByType && (
                  <div className="overflow-x-auto overflow-y-auto border border-gray-200 rounded-lg flex-shrink-0 w-full bg-white" style={{ maxHeight: `${movementsCompareTableByTypeHeight}px` }}>
                    <table className={`border-collapse w-full ${movementsCompareShowPct ? 'text-[13px]' : 'text-sm'}`}>
                      <thead>
                        <tr>
                          <th className="sticky top-0 z-10 text-left font-semibold text-gray-800 px-3 py-2 border-b border-r border-gray-200 bg-red-100 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]" scope="col">Types</th>
                          <th className="sticky top-0 z-10 text-right font-semibold text-gray-800 px-3 py-2 border-b border-r border-gray-200 bg-red-100 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]" scope="col">Sorties</th>
                          <th className="sticky top-0 z-10 text-left font-semibold text-gray-800 px-3 py-2 border-b border-r border-gray-200 bg-green-100 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]" scope="col">Types</th>
                          <th className="sticky top-0 z-10 text-right font-semibold text-gray-800 px-3 py-2 border-b border-gray-200 bg-green-100 shadow-[0_1px_0_0_rgba(0,0,0,0.05)]" scope="col">Entrées</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movementsCompareTableDataB.rowCount === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-4 text-center text-gray-500 border-b border-gray-200">Aucun mouvement sur la plage sélectionnée</td>
                          </tr>
                        ) : (
                          Array.from({ length: movementsCompareTableDataB.rowCount }, (_, i) => {
                            const typeSorties = movementsCompareTableDataB.typesWithSorties[i];
                            const typeEntrées = movementsCompareTableDataB.typesWithEntrées[i];
                            const sortiesA = typeSorties != null ? (movementsCompareTableDataA?.sortiesByType[typeSorties] ?? 0) : 0;
                            const entréesA = typeEntrées != null ? (movementsCompareTableDataA?.entréesByType[typeEntrées] ?? 0) : 0;
                            const sortiesB = typeSorties != null ? movementsCompareTableDataB.sortiesByType[typeSorties] ?? 0 : 0;
                            const entréesB = typeEntrées != null ? movementsCompareTableDataB.entréesByType[typeEntrées] ?? 0 : 0;
                            const pctSorties = sortiesA !== 0 ? ((sortiesB - sortiesA) / sortiesA) * 100 : null;
                            const pctEntrées = entréesA !== 0 ? ((entréesB - entréesA) / entréesA) * 100 : null;
                            return (
                              <tr key={typeSorties ?? typeEntrées ?? `row-b-${i}`} className="border-b border-gray-100">
                                <td className="px-3 py-2 border-r border-gray-200 bg-red-50/50">{typeSorties ?? ''}</td>
                                <td className="px-3 py-2 text-right border-r border-gray-200 bg-red-50/50 tabular-nums">
                                  {typeSorties != null ? (
                                    <>
                                      −{formatCurrency(convertMovementsToDisplayCurrency(movementsCompareTableDataB.sortiesByType[typeSorties], movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}
                                      {pctSorties != null && movementsCompareShowPct && (
                                        <span className={pctSorties >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                          {' '}({pctSorties >= 0 ? '+' : ''}{pctSorties.toFixed(1)}%)
                                        </span>
                                      )}
                                    </>
                                  ) : ''}
                                </td>
                                <td className="px-3 py-2 border-r border-gray-200 bg-green-50/50">{typeEntrées ?? ''}</td>
                                <td className="px-3 py-2 text-right border-gray-200 bg-green-50/50 tabular-nums">
                                  {typeEntrées != null ? (
                                    <>
                                      +{formatCurrency(convertMovementsToDisplayCurrency(movementsCompareTableDataB.entréesByType[typeEntrées], movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}
                                      {pctEntrées != null && movementsCompareShowPct && (
                                        <span className={pctEntrées >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                          {' '}({pctEntrées >= 0 ? '+' : ''}{pctEntrées.toFixed(1)}%)
                                        </span>
                                      )}
                                    </>
                                  ) : ''}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="font-semibold bg-gray-50">
                          <td className="sticky bottom-8 z-10 px-3 py-2 border-t border-r border-gray-200 bg-red-100 shadow-[0_-1px_0_0_rgba(0,0,0,0.05)]">Total</td>
                          <td className="sticky bottom-8 z-10 px-3 py-2 text-right border-t border-r border-gray-200 bg-red-100 tabular-nums shadow-[0_-1px_0_0_rgba(0,0,0,0.05)]">
                            −{formatCurrency(convertMovementsToDisplayCurrency(movementsCompareTableDataB.totalSorties, movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}
                            {movementsCompareShowPct && movementsCompareTableDataA && movementsCompareTableDataA.totalSorties !== 0 && (
                              <span className={((movementsCompareTableDataB.totalSorties - movementsCompareTableDataA.totalSorties) / movementsCompareTableDataA.totalSorties) * 100 >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                {' '}({((movementsCompareTableDataB.totalSorties - movementsCompareTableDataA.totalSorties) / movementsCompareTableDataA.totalSorties) * 100 >= 0 ? '+' : ''}{(((movementsCompareTableDataB.totalSorties - movementsCompareTableDataA.totalSorties) / movementsCompareTableDataA.totalSorties) * 100).toFixed(1)}%)
                              </span>
                            )}
                          </td>
                          <td className="sticky bottom-8 z-10 px-3 py-2 border-t border-r border-gray-200 bg-green-100 shadow-[0_-1px_0_0_rgba(0,0,0,0.05)]">Total</td>
                          <td className="sticky bottom-8 z-10 px-3 py-2 text-right border-t border-gray-200 bg-green-100 tabular-nums shadow-[0_-1px_0_0_rgba(0,0,0,0.05)]">
                            +{formatCurrency(convertMovementsToDisplayCurrency(movementsCompareTableDataB.totalEntrées, movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}
                            {movementsCompareShowPct && movementsCompareTableDataA && movementsCompareTableDataA.totalEntrées !== 0 && (
                              <span className={((movementsCompareTableDataB.totalEntrées - movementsCompareTableDataA.totalEntrées) / movementsCompareTableDataA.totalEntrées) * 100 >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                {' '}({((movementsCompareTableDataB.totalEntrées - movementsCompareTableDataA.totalEntrées) / movementsCompareTableDataA.totalEntrées) * 100 >= 0 ? '+' : ''}{(((movementsCompareTableDataB.totalEntrées - movementsCompareTableDataA.totalEntrées) / movementsCompareTableDataA.totalEntrées) * 100).toFixed(1)}%)
                              </span>
                            )}
                          </td>
                        </tr>
                        <tr className="font-semibold bg-gray-100">
                          <td className="sticky bottom-0 z-10 px-3 py-2 border-t border-gray-200 bg-gray-100 shadow-[0_-1px_0_0_rgba(0,0,0,0.05)]" colSpan={3}>Balance</td>
                          <td className={`sticky bottom-0 z-10 px-3 py-2 text-right border-t border-gray-200 tabular-nums bg-gray-100 shadow-[0_-1px_0_0_rgba(0,0,0,0.05)] ${movementsCompareTableDataB.totalEntrées - movementsCompareTableDataB.totalSorties >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {(() => {
                              const balance = movementsCompareTableDataB.totalEntrées - movementsCompareTableDataB.totalSorties;
                              const sign = balance >= 0 ? '+' : '−';
                              const balanceA = movementsCompareTableDataA ? movementsCompareTableDataA.totalEntrées - movementsCompareTableDataA.totalSorties : 0;
                              const pctBalance = balanceA !== 0 ? ((balance - balanceA) / balanceA) * 100 : null;
                              return (
                                <>
                                  {sign}{formatCurrency(Math.abs(convertMovementsToDisplayCurrency(balance, movementsCompareYAxisCurrency as CurrencySymbol)), movementsCompareYAxisCurrency)}
                                  {pctBalance != null && movementsCompareShowPct && (
                                    <span className={pctBalance >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                      {' '}({pctBalance >= 0 ? '+' : ''}{pctBalance.toFixed(1)}%)
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  )}
                  {movementsCompareShowTableByAccount && movementsCompareBalanceByAccountB && movementsCompareBalanceByAccountB.length > 0 && (
                    <div className="overflow-x-auto border border-gray-200 rounded-lg flex-shrink-0 w-full bg-white">
                      <table className={`border-collapse w-full ${movementsCompareShowPct ? 'text-[13px]' : 'text-sm'}`}>
                        <thead>
                          <tr>
                            <th className="text-left font-semibold text-gray-800 px-3 py-2 border-b border-r border-gray-200 bg-gray-100" scope="col">Compte</th>
                            <th className="text-right font-semibold text-gray-800 px-3 py-2 border-b border-gray-200 bg-gray-100" scope="col">Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {movementsCompareBalanceByAccountB.map(({ account, balance }) => {
                            const balanceA = movementsCompareBalanceByAccountA?.find((r) => r.account === account)?.balance ?? 0;
                            const pct = balanceA !== 0 ? ((balance - balanceA) / balanceA) * 100 : (balance !== 0 ? 100 : null);
                            return (
                              <tr key={`compare-b-${account}`} className="border-b border-gray-100">
                                <td className="px-3 py-2 border-r border-gray-200 bg-gray-50/50">{account}</td>
                                <td className={`px-3 py-2 text-right border-gray-200 tabular-nums ${balance >= 0 ? 'text-green-700 bg-green-50/50' : 'text-red-700 bg-red-50/50'}`}>
                                  {balance >= 0 ? `+${formatCurrency(convertMovementsToDisplayCurrency(balance, movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}` : `−${formatCurrency(convertMovementsToDisplayCurrency(Math.abs(balance), movementsCompareYAxisCurrency as CurrencySymbol), movementsCompareYAxisCurrency)}`}
                                  {pct != null && movementsCompareShowPct && (
                                    <span className={pct >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                      {' '}({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr className="font-semibold bg-gray-100">
                            <td className="px-3 py-2 border-t border-r border-gray-200">Balance</td>
                            <td className={`px-3 py-2 text-right border-t border-gray-200 tabular-nums ${movementsCompareTableDataB.totalEntrées - movementsCompareTableDataB.totalSorties >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                              {(() => {
                                const total = movementsCompareTableDataB.totalEntrées - movementsCompareTableDataB.totalSorties;
                                const sign = total >= 0 ? '+' : '−';
                                const totalA = movementsCompareTableDataA ? movementsCompareTableDataA.totalEntrées - movementsCompareTableDataA.totalSorties : 0;
                                const pctTotal = totalA !== 0 ? ((total - totalA) / totalA) * 100 : null;
                                return (
                                  <>
                                    {sign}{formatCurrency(Math.abs(convertMovementsToDisplayCurrency(total, movementsCompareYAxisCurrency as CurrencySymbol)), movementsCompareYAxisCurrency)}
                                    {pctTotal != null && movementsCompareShowPct && (
                                      <span className={pctTotal >= 0 ? 'text-green-600' : 'text-red-600'} style={{ whiteSpace: 'nowrap' }}>
                                        {' '}({pctTotal >= 0 ? '+' : ''}{pctTotal.toFixed(1)}%)
                                      </span>
                                    )}
                                  </>
                                );
                              })()}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
        )}
          </div>
        </div>
        </>
        </div>
        )}
      </section>

      {/* Tableaux et filtres */}
      <section className="flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden mb-6">
        <header
          className={`bg-gradient-to-br from-slate-50 to-white ${
            sectionsExpanded.tableauxFiltres ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
          }`}
        >
          <div className="flex items-stretch">
            <button
              type="button"
              className="flex-1 min-w-0 px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
              onClick={() => setSectionExpanded('tableauxFiltres', !sectionsExpanded.tableauxFiltres)}
              aria-expanded={sectionsExpanded.tableauxFiltres}
            >
              <span
                className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
                  sectionsExpanded.tableauxFiltres ? 'rotate-90' : ''
                }`}
                aria-hidden
              >
                ▶
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                  Tableaux et filtres
                </span>
              </span>
            </button>
            <div className="flex items-center shrink-0 pr-3 sm:pr-4">
              <button
                type="button"
                onClick={() => {
                  setTablesFiltersOpen((o) => {
                    const next = !o;
                    saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesFiltersOpen, String(next));
                    return next;
                  });
                }}
                title="Paramètres"
                className={`flex-shrink-0 p-2 rounded-lg border transition-colors ${
                  tablesFiltersOpen
                    ? 'bg-gray-200 border-gray-300 text-gray-800'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
        </header>
        {sectionsExpanded.tableauxFiltres && (
          <div className="px-4 pb-4 pt-3">
          <>
            <div className="flex gap-4 items-stretch">
              {tablesFiltersOpen && (
                <div className="flex-shrink-0 flex flex-col min-h-0 w-[220px]">
                  <div className="flex-1 flex flex-col min-h-0 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                    <button
                      type="button"
                      onClick={() =>
                        setTablesFiltersOpen((o) => {
                          const next = !o;
                          saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesFiltersOpen, String(next));
                          return next;
                        })
                      }
                      className="flex-shrink-0 w-full px-3 py-2 text-left text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 flex items-center justify-between"
                    >
                      Paramètres
                      <span className="text-gray-500">▼</span>
                    </button>
                    <div className="flex-1 min-h-0 flex flex-col p-3 gap-3 overflow-y-auto">
                      <div className="flex-shrink-0">
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                          Devise d&apos;affichage
                        </label>
                        <select
                          value={tablesYAxisCurrency}
                          onChange={(e) => {
                            const v = e.target.value;
                            setTablesYAxisCurrency(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesYAxisCurrency, v);
                          }}
                          className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800"
                        >
                          {Y_AXIS_CURRENCIES.map(({ value, label }) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-shrink-0">
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                          Hauteur max. tableau transactions
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={200}
                            max={900}
                            step={10}
                            value={tablesTransactionsMaxHeight}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (Number.isFinite(v)) {
                                setTablesTransactionsMaxHeight(v);
                                saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesTransactionsMaxHeight, String(v));
                              }
                            }}
                            className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 accent-blue-600"
                          />
                          <span className="text-sm text-gray-700 tabular-nums w-10">{tablesTransactionsMaxHeight}px</span>
                        </div>
                      </div>
                      <div className="flex-shrink-0 border-t border-gray-200 pt-2 space-y-2">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Synchronisation plage</span>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tablesSyncsWithMovements}
                            onChange={(e) => handleTablesMovementsSyncChange(e.target.checked)}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>Synchroniser avec Suivi des mouvements</span>
                        </label>
                      </div>
                      <div className="flex-shrink-0 border-t border-gray-200 pt-2 space-y-2">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Mouvements</span>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tablesShowEntrées}
                            onChange={(e) => {
                              const v = e.target.checked;
                              setTablesShowEntrées(v);
                              saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesShowEntrées, String(v));
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>Entrées</span>
                        </label>
                        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={tablesShowSorties}
                            onChange={(e) => {
                              const v = e.target.checked;
                              setTablesShowSorties(v);
                              saveDashboardPref(DASHBOARD_STORAGE_KEYS.tablesShowSorties, String(v));
                            }}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>Sorties</span>
                        </label>
                      </div>
                      {tablesDashboardData && (
                        <>
                          <div className="flex-shrink-0 border-t border-gray-200 pt-2">
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Titres</label>
                              <button
                                type="button"
                                className="text-xs text-blue-600 hover:underline flex-shrink-0"
                                onClick={() => setTablesTitleExactQueries((prev) => [...prev, ''])}
                              >
                                + Ligne
                              </button>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              {tablesTitleExactQueries.map((line, i) => {
                                const sug = tablesTitleFilterSuggestionsList[i] ?? [];
                                const listId = `${TABLES_FILTER_DL_TITLE_PREFIX}${i}`;
                                return (
                                  <div key={`title-line-${i}`} className="flex gap-1 items-start">
                                    <input
                                      type="text"
                                      value={line}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        setTablesTitleExactQueries((prev) => {
                                          const n = [...prev];
                                          n[i] = v;
                                          return n;
                                        });
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key !== 'Tab' || e.shiftKey || sug.length === 0) return;
                                        const first = sug[0].value;
                                        const seg = tablesFilterSuggestPrefix(line);
                                        if (seg.toLowerCase() !== first.toLowerCase()) {
                                          e.preventDefault();
                                          setTablesTitleExactQueries((prev) => {
                                            const n = [...prev];
                                            n[i] = applyTablesFilterSuggestionToLine(line, first);
                                            return n;
                                          });
                                        }
                                      }}
                                      placeholder="Vide = ignoré · OU entre lignes (« + Ligne ») (contient)"
                                      list={movementsColumns?.titleCol && sug.length > 0 ? listId : undefined}
                                      className="min-w-0 flex-1 text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800 placeholder:text-gray-400"
                                      autoComplete="off"
                                    />
                                    {tablesTitleExactQueries.length > 1 && (
                                      <button
                                        type="button"
                                        className="flex-shrink-0 px-1.5 py-1 text-xs text-red-600 hover:bg-red-50 rounded border border-transparent hover:border-red-200"
                                        title="Retirer cette ligne"
                                        onClick={() =>
                                          setTablesTitleExactQueries((prev) => prev.filter((_, j) => j !== i))
                                        }
                                      >
                                        ×
                                      </button>
                                    )}
                                    {movementsColumns?.titleCol && sug.length > 0 && (
                                      <datalist id={listId}>
                                        {sug.map((s) => (
                                          <option key={`${listId}-${s.value}-${s.count}`} value={s.value} />
                                        ))}
                                      </datalist>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div className="flex-shrink-0 border-t border-gray-200 pt-2">
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Types</label>
                              <button
                                type="button"
                                className="text-xs text-blue-600 hover:underline flex-shrink-0"
                                onClick={() => setTablesTypeExactQueries((prev) => [...prev, ''])}
                              >
                                + Ligne
                              </button>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              {tablesTypeExactQueries.map((line, i) => {
                                const sug = tablesTypeFilterSuggestionsList[i] ?? [];
                                const listId = `${TABLES_FILTER_DL_TYPE_PREFIX}${i}`;
                                return (
                                  <div key={`type-line-${i}`} className="flex gap-1 items-start">
                                    <input
                                      type="text"
                                      value={line}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        setTablesTypeExactQueries((prev) => {
                                          const n = [...prev];
                                          n[i] = v;
                                          return n;
                                        });
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key !== 'Tab' || e.shiftKey || sug.length === 0) return;
                                        const first = sug[0].value;
                                        const seg = tablesFilterSuggestPrefix(line);
                                        if (seg.toLowerCase() !== first.toLowerCase()) {
                                          e.preventDefault();
                                          setTablesTypeExactQueries((prev) => {
                                            const n = [...prev];
                                            n[i] = applyTablesFilterSuggestionToLine(line, first);
                                            return n;
                                          });
                                        }
                                      }}
                                      placeholder="Vide = ignoré · OU entre lignes (« + Ligne ») (contient)"
                                      list={movementsColumns?.typeCol && sug.length > 0 ? listId : undefined}
                                      className="min-w-0 flex-1 text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800 placeholder:text-gray-400"
                                      autoComplete="off"
                                    />
                                    {tablesTypeExactQueries.length > 1 && (
                                      <button
                                        type="button"
                                        className="flex-shrink-0 px-1.5 py-1 text-xs text-red-600 hover:bg-red-50 rounded border border-transparent hover:border-red-200"
                                        title="Retirer cette ligne"
                                        onClick={() =>
                                          setTablesTypeExactQueries((prev) => prev.filter((_, j) => j !== i))
                                        }
                                      >
                                        ×
                                      </button>
                                    )}
                                    {movementsColumns?.typeCol && sug.length > 0 && (
                                      <datalist id={listId}>
                                        {sug.map((s) => (
                                          <option key={`${listId}-${s.value}-${s.count}`} value={s.value} />
                                        ))}
                                      </datalist>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                          <div className="flex-shrink-0 border-t border-gray-200 pt-2">
                            <div className="flex items-center justify-between gap-1 mb-1">
                              <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Comptes</label>
                              <button
                                type="button"
                                className="text-xs text-blue-600 hover:underline flex-shrink-0"
                                onClick={() => setTablesAccountExactQueries((prev) => [...prev, ''])}
                              >
                                + Ligne
                              </button>
                            </div>
                            <div className="flex flex-col gap-1.5">
                              {tablesAccountExactQueries.map((line, i) => {
                                const sug = tablesAccountFilterSuggestionsList[i] ?? [];
                                const listId = `${TABLES_FILTER_DL_ACCOUNT_PREFIX}${i}`;
                                return (
                                  <div key={`acc-line-${i}`} className="flex gap-1 items-start">
                                    <input
                                      type="text"
                                      value={line}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        setTablesAccountExactQueries((prev) => {
                                          const n = [...prev];
                                          n[i] = v;
                                          return n;
                                        });
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key !== 'Tab' || e.shiftKey || sug.length === 0) return;
                                        const first = sug[0].value;
                                        const seg = tablesFilterSuggestPrefix(line);
                                        if (seg.toLowerCase() !== first.toLowerCase()) {
                                          e.preventDefault();
                                          setTablesAccountExactQueries((prev) => {
                                            const n = [...prev];
                                            n[i] = applyTablesFilterSuggestionToLine(line, first);
                                            return n;
                                          });
                                        }
                                      }}
                                      placeholder="Vide = ignoré · OU entre lignes (« + Ligne ») (contient)"
                                      list={movementsColumns?.accountCol && sug.length > 0 ? listId : undefined}
                                      className="min-w-0 flex-1 text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800 placeholder:text-gray-400"
                                      autoComplete="off"
                                    />
                                    {tablesAccountExactQueries.length > 1 && (
                                      <button
                                        type="button"
                                        className="flex-shrink-0 px-1.5 py-1 text-xs text-red-600 hover:bg-red-50 rounded border border-transparent hover:border-red-200"
                                        title="Retirer cette ligne"
                                        onClick={() =>
                                          setTablesAccountExactQueries((prev) => prev.filter((_, j) => j !== i))
                                        }
                                      >
                                        ×
                                      </button>
                                    )}
                                    {movementsColumns?.accountCol && sug.length > 0 && (
                                      <datalist id={listId}>
                                        {sug.map((s) => (
                                          <option key={`${listId}-${s.value}-${s.count}`} value={s.value} />
                                        ))}
                                      </datalist>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <div className="flex-1 min-w-0 flex flex-col">
                {dates.length > 0 && (
                  <div className="w-full mb-4">
                    <DateRangeSlider
                      minDate={minDate}
                      maxDate={maxDate}
                      startDate={
                        tablesSyncsWithChart
                          ? chartSliderStartForUi
                          : tablesSyncsWithMovements
                            ? movementsStartDate
                            : tablesSliderStartDate
                      }
                      endDate={
                        tablesSyncsWithChart
                          ? chartSliderEndForUi
                          : tablesSyncsWithMovements
                            ? movementsEndDate
                            : tablesSliderEndDate
                      }
                      onChange={handleTablesDateRangeChange}
                      syncLabel="Synchroniser avec Évolution des soldes"
                      syncChecked={tablesSyncsWithChart}
                      onSyncChange={handleTablesChartSyncChange}
                      fullYearsMode={dateRangeSliderFullYears}
                      onFullYearsModeChange={handleDateRangeSliderFullYearsChange}
                    />
                  </div>
                )}
                {movementsDataLoading && <div className="py-6 text-center text-gray-500">Chargement…</div>}
                {!movementsDataLoading && movementsDataError && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">{movementsDataError}</div>
                )}
                {!movementsDataLoading && !movementsDataError && tablesDashboardData && (
                  <div className="flex flex-col gap-6">
                    <div
                      className="w-full rounded-lg border border-gray-200 overflow-hidden flex flex-col"
                      style={{ maxHeight: tablesTransactionsMaxHeight }}
                    >
                      <div className="flex-1 min-h-0 overflow-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-100 sticky top-0 z-10">
                            <tr className="text-left text-xs font-medium text-gray-600 uppercase tracking-wide">
                              <th
                                className="px-2 py-2 border-b border-gray-200 w-10 text-center align-middle"
                                scope="col"
                              >
                                <input
                                  ref={tablesBlocTxTableHeaderCheckboxRef}
                                  type="checkbox"
                                  checked={
                                    tablesBlocSortedTxRows.length > 0 &&
                                    tablesBlocSortedTxRows.every((r) => tablesBlocSelectedRowKeys.has(r.rowKey))
                                  }
                                  onChange={toggleTablesBlocSelectAllVisible}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  title="Tout sélectionner ou tout désélectionner"
                                  aria-label="Sélectionner ou désélectionner toutes les transactions affichées"
                                />
                              </th>
                              <th
                                className="px-3 py-2 border-b border-gray-200 w-14 tabular-nums"
                                aria-sort={dashboardTablesBlocAriaSort(tablesBlocTxSort.col, 'index', tablesBlocTxSort.dir)}
                              >
                                <button
                                  type="button"
                                  title="Trier par index"
                                  onClick={() =>
                                    setTablesBlocTxSort((prev) =>
                                      prev.col === 'index'
                                        ? { col: 'index', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                        : { col: 'index', dir: 'asc' }
                                    )
                                  }
                                  className="inline-flex w-full items-center gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-200/80 rounded border-0 bg-transparent"
                                >
                                  Index
                                  {tablesBlocTxSort.col === 'index' && (
                                    <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                      {tablesBlocTxSort.dir === 'asc' ? '↑' : '↓'}
                                    </span>
                                  )}
                                </button>
                              </th>
                              <th
                                className="px-3 py-2 border-b border-gray-200"
                                aria-sort={dashboardTablesBlocAriaSort(tablesBlocTxSort.col, 'date', tablesBlocTxSort.dir)}
                              >
                                <button
                                  type="button"
                                  title="Trier par date"
                                  onClick={() =>
                                    setTablesBlocTxSort((prev) =>
                                      prev.col === 'date'
                                        ? { col: 'date', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                        : { col: 'date', dir: 'desc' }
                                    )
                                  }
                                  className="inline-flex w-full items-center gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-200/80 rounded border-0 bg-transparent"
                                >
                                  Date
                                  {tablesBlocTxSort.col === 'date' && (
                                    <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                      {tablesBlocTxSort.dir === 'asc' ? '↑' : '↓'}
                                    </span>
                                  )}
                                </button>
                              </th>
                              <th
                                className="px-3 py-2 border-b border-gray-200"
                                aria-sort={dashboardTablesBlocAriaSort(tablesBlocTxSort.col, 'title', tablesBlocTxSort.dir)}
                              >
                                <button
                                  type="button"
                                  title="Trier par titre"
                                  onClick={() =>
                                    setTablesBlocTxSort((prev) =>
                                      prev.col === 'title'
                                        ? { col: 'title', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                        : { col: 'title', dir: 'asc' }
                                    )
                                  }
                                  className="inline-flex w-full items-center gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-200/80 rounded border-0 bg-transparent"
                                >
                                  Titre
                                  {tablesBlocTxSort.col === 'title' && (
                                    <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                      {tablesBlocTxSort.dir === 'asc' ? '↑' : '↓'}
                                    </span>
                                  )}
                                </button>
                              </th>
                              <th
                                className="px-3 py-2 border-b border-gray-200"
                                aria-sort={dashboardTablesBlocAriaSort(tablesBlocTxSort.col, 'type', tablesBlocTxSort.dir)}
                              >
                                <button
                                  type="button"
                                  title="Trier par type"
                                  onClick={() =>
                                    setTablesBlocTxSort((prev) =>
                                      prev.col === 'type'
                                        ? { col: 'type', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                        : { col: 'type', dir: 'asc' }
                                    )
                                  }
                                  className="inline-flex w-full items-center gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-200/80 rounded border-0 bg-transparent"
                                >
                                  Type
                                  {tablesBlocTxSort.col === 'type' && (
                                    <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                      {tablesBlocTxSort.dir === 'asc' ? '↑' : '↓'}
                                    </span>
                                  )}
                                </button>
                              </th>
                              <th
                                className="px-3 py-2 border-b border-gray-200"
                                aria-sort={dashboardTablesBlocAriaSort(tablesBlocTxSort.col, 'account', tablesBlocTxSort.dir)}
                              >
                                <button
                                  type="button"
                                  title="Trier par compte"
                                  onClick={() =>
                                    setTablesBlocTxSort((prev) =>
                                      prev.col === 'account'
                                        ? { col: 'account', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                        : { col: 'account', dir: 'asc' }
                                    )
                                  }
                                  className="inline-flex w-full items-center gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-200/80 rounded border-0 bg-transparent"
                                >
                                  Compte
                                  {tablesBlocTxSort.col === 'account' && (
                                    <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                      {tablesBlocTxSort.dir === 'asc' ? '↑' : '↓'}
                                    </span>
                                  )}
                                </button>
                              </th>
                              <th
                                className="px-3 py-2 border-b border-gray-200 text-right"
                                aria-sort={dashboardTablesBlocAriaSort(tablesBlocTxSort.col, 'amount', tablesBlocTxSort.dir)}
                              >
                                <button
                                  type="button"
                                  title="Trier par montant"
                                  onClick={() =>
                                    setTablesBlocTxSort((prev) =>
                                      prev.col === 'amount'
                                        ? { col: 'amount', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                        : { col: 'amount', dir: 'desc' }
                                    )
                                  }
                                  className="inline-flex w-full items-center justify-end gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-200/80 rounded border-0 bg-transparent"
                                >
                                  Montant
                                  {tablesBlocTxSort.col === 'amount' && (
                                    <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                      {tablesBlocTxSort.dir === 'asc' ? '↑' : '↓'}
                                    </span>
                                  )}
                                </button>
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {tablesBlocSortedTxRows.map((row) => {
                              const disp = convertMovementsToDisplayCurrency(row.amountGbp, tablesYAxisCurrency as CurrencySymbol);
                              const absDisp = Math.abs(disp);
                              return (
                                <tr
                                  key={row.rowKey}
                                  className="border-b border-gray-100 hover:bg-gray-50/80"
                                >
                                  <td className="px-2 py-2 text-center align-middle">
                                    <input
                                      type="checkbox"
                                      checked={tablesBlocSelectedRowKeys.has(row.rowKey)}
                                      onChange={() => toggleTablesBlocRowSelected(row.rowKey)}
                                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                      aria-label={`Inclure la transaction ${row.txIndex} dans les totaux par type et compte`}
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-gray-700 whitespace-nowrap tabular-nums w-14">
                                    {row.txIndex}
                                  </td>
                                  <td className="px-3 py-2 text-gray-800 whitespace-nowrap">{row.dateLabel}</td>
                                  <td className="px-3 py-2 text-gray-800 max-w-[140px] truncate" title={row.title}>
                                    {row.title}
                                  </td>
                                  <td className="px-3 py-2 text-gray-700 max-w-[120px] truncate" title={row.typeLabel}>
                                    {row.typeLabel}
                                  </td>
                                  <td className="px-3 py-2 text-gray-700 max-w-[120px] truncate" title={row.accountLabel}>
                                    {row.accountLabel}
                                  </td>
                                  <td
                                    className={`px-3 py-2 text-right tabular-nums font-medium ${
                                      row.sens === 'entrée' ? 'text-green-700' : 'text-red-700'
                                    }`}
                                  >
                                    {row.sens === 'entrée' ? '+' : '−'}
                                    {formatCurrency(absDisp, tablesYAxisCurrency)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div
                        className="flex-shrink-0 border-t border-gray-200 bg-gray-100 px-3 py-2 text-xs text-gray-600 tabular-nums"
                        role="status"
                        aria-live="polite"
                      >
                        {tablesBlocSortedTxRows.length === 1
                          ? '1 transaction affichée'
                          : `${tablesBlocSortedTxRows.length} transactions affichées`}
                        {tablesBlocSelectedRowKeys.size > 0 && (
                          <span className="block sm:inline sm:ml-2 mt-1 sm:mt-0 text-gray-600">
                            · Totaux type / compte : {tablesBlocSelectedRowKeys.size}{' '}
                            {tablesBlocSelectedRowKeys.size > 1 ? 'lignes sélectionnées' : 'ligne sélectionnée'}
                          </span>
                        )}
                      </div>
                    </div>
                    {tablesDashboardData.rows.length === 0 && (
                      <p className="text-sm text-gray-500 text-center py-4">Aucune transaction pour les filtres sélectionnés.</p>
                    )}
                    <div className="flex flex-col xl:flex-row gap-4 w-full items-stretch">
                      <div className="min-w-0 shrink xl:flex-[1] xl:basis-0 rounded-lg border border-gray-200 overflow-hidden flex flex-col">
                        <div className="px-2 py-2 bg-gray-50 border-b border-gray-200 text-sm font-semibold text-gray-800 flex-shrink-0">
                          Types — entrées
                        </div>
                        <div className="overflow-x-auto min-h-0">
                          <table className="w-full text-sm table-fixed">
                            <thead>
                              <tr className="text-left text-xs font-medium text-gray-600 uppercase tracking-wide border-b border-gray-200 bg-white">
                                <th
                                  className="px-2 py-1.5 w-[58%]"
                                  aria-sort={dashboardTablesBlocAriaSort(tablesBlocTypeInSort.col, 'type', tablesBlocTypeInSort.dir)}
                                >
                                  <button
                                    type="button"
                                    title="Trier par type"
                                    onClick={() =>
                                      setTablesBlocTypeInSort((prev) =>
                                        prev.col === 'type'
                                          ? { col: 'type', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                          : { col: 'type', dir: 'asc' }
                                      )
                                    }
                                    className="inline-flex w-full min-w-0 items-center gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-100 rounded border-0 bg-transparent"
                                  >
                                    <span className="truncate">Type</span>
                                    {tablesBlocTypeInSort.col === 'type' && (
                                      <span className="flex-shrink-0 font-normal tabular-nums text-gray-500" aria-hidden>
                                        {tablesBlocTypeInSort.dir === 'asc' ? '↑' : '↓'}
                                      </span>
                                    )}
                                  </button>
                                </th>
                                <th
                                  className="px-2 py-1.5 text-right"
                                  aria-sort={dashboardTablesBlocAriaSort(tablesBlocTypeInSort.col, 'entrées', tablesBlocTypeInSort.dir)}
                                >
                                  <button
                                    type="button"
                                    title="Trier par montant des entrées"
                                    onClick={() =>
                                      setTablesBlocTypeInSort((prev) =>
                                        prev.col === 'entrées'
                                          ? { col: 'entrées', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                          : { col: 'entrées', dir: 'desc' }
                                      )
                                    }
                                    className="inline-flex w-full items-center justify-end gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-100 rounded border-0 bg-transparent"
                                  >
                                    Entrées
                                    {tablesBlocTypeInSort.col === 'entrées' && (
                                      <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                        {tablesBlocTypeInSort.dir === 'asc' ? '↑' : '↓'}
                                      </span>
                                    )}
                                  </button>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {tablesBlocSortedTypeEntrées.map((r) => (
                                <tr key={`ste-${r.type}`} className="border-b border-gray-100">
                                  <td className="px-2 py-1.5 text-gray-800 truncate max-w-0" title={r.type}>
                                    {r.type}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-green-700 font-medium whitespace-nowrap">
                                    +
                                    {formatCurrency(
                                      convertMovementsToDisplayCurrency(r.entrées, tablesYAxisCurrency as CurrencySymbol),
                                      tablesYAxisCurrency
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="min-w-0 shrink xl:flex-[1] xl:basis-0 rounded-lg border border-gray-200 overflow-hidden flex flex-col">
                        <div className="px-2 py-2 bg-gray-50 border-b border-gray-200 text-sm font-semibold text-gray-800 flex-shrink-0">
                          Types — sorties
                        </div>
                        <div className="overflow-x-auto min-h-0">
                          <table className="w-full text-sm table-fixed">
                            <thead>
                              <tr className="text-left text-xs font-medium text-gray-600 uppercase tracking-wide border-b border-gray-200 bg-white">
                                <th
                                  className="px-2 py-1.5 w-[58%]"
                                  aria-sort={dashboardTablesBlocAriaSort(tablesBlocTypeOutSort.col, 'type', tablesBlocTypeOutSort.dir)}
                                >
                                  <button
                                    type="button"
                                    title="Trier par type"
                                    onClick={() =>
                                      setTablesBlocTypeOutSort((prev) =>
                                        prev.col === 'type'
                                          ? { col: 'type', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                          : { col: 'type', dir: 'asc' }
                                      )
                                    }
                                    className="inline-flex w-full min-w-0 items-center gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-100 rounded border-0 bg-transparent"
                                  >
                                    <span className="truncate">Type</span>
                                    {tablesBlocTypeOutSort.col === 'type' && (
                                      <span className="flex-shrink-0 font-normal tabular-nums text-gray-500" aria-hidden>
                                        {tablesBlocTypeOutSort.dir === 'asc' ? '↑' : '↓'}
                                      </span>
                                    )}
                                  </button>
                                </th>
                                <th
                                  className="px-2 py-1.5 text-right"
                                  aria-sort={dashboardTablesBlocAriaSort(tablesBlocTypeOutSort.col, 'sorties', tablesBlocTypeOutSort.dir)}
                                >
                                  <button
                                    type="button"
                                    title="Trier par montant des sorties"
                                    onClick={() =>
                                      setTablesBlocTypeOutSort((prev) =>
                                        prev.col === 'sorties'
                                          ? { col: 'sorties', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                          : { col: 'sorties', dir: 'desc' }
                                      )
                                    }
                                    className="inline-flex w-full items-center justify-end gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-100 rounded border-0 bg-transparent"
                                  >
                                    Sorties
                                    {tablesBlocTypeOutSort.col === 'sorties' && (
                                      <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                        {tablesBlocTypeOutSort.dir === 'asc' ? '↑' : '↓'}
                                      </span>
                                    )}
                                  </button>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {tablesBlocSortedTypeSorties.map((r) => (
                                <tr key={`sts-${r.type}`} className="border-b border-gray-100">
                                  <td className="px-2 py-1.5 text-gray-800 truncate max-w-0" title={r.type}>
                                    {r.type}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-red-700 font-medium whitespace-nowrap">
                                    −
                                    {formatCurrency(
                                      convertMovementsToDisplayCurrency(r.sorties, tablesYAxisCurrency as CurrencySymbol),
                                      tablesYAxisCurrency
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                      <div className="min-w-0 shrink xl:flex-[2.5] xl:basis-0 rounded-lg border border-gray-200 overflow-hidden flex flex-col">
                        <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-sm font-semibold text-gray-800 flex-shrink-0">
                          Synthèse par compte
                        </div>
                        <div className="overflow-x-auto min-h-0">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs font-medium text-gray-600 uppercase tracking-wide border-b border-gray-200 bg-white">
                                <th
                                  className="px-3 py-2"
                                  aria-sort={dashboardTablesBlocAriaSort(tablesBlocAccountSort.col, 'account', tablesBlocAccountSort.dir)}
                                >
                                  <button
                                    type="button"
                                    title="Trier par compte"
                                    onClick={() =>
                                      setTablesBlocAccountSort((prev) =>
                                        prev.col === 'account'
                                          ? { col: 'account', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                          : { col: 'account', dir: 'asc' }
                                      )
                                    }
                                    className="inline-flex w-full items-center gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-100 rounded border-0 bg-transparent"
                                  >
                                    Compte
                                    {tablesBlocAccountSort.col === 'account' && (
                                      <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                        {tablesBlocAccountSort.dir === 'asc' ? '↑' : '↓'}
                                      </span>
                                    )}
                                  </button>
                                </th>
                                <th
                                  className="px-3 py-2 text-right"
                                  aria-sort={dashboardTablesBlocAriaSort(tablesBlocAccountSort.col, 'entrées', tablesBlocAccountSort.dir)}
                                >
                                  <button
                                    type="button"
                                    title="Trier par entrées"
                                    onClick={() =>
                                      setTablesBlocAccountSort((prev) =>
                                        prev.col === 'entrées'
                                          ? { col: 'entrées', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                          : { col: 'entrées', dir: 'desc' }
                                      )
                                    }
                                    className="inline-flex w-full items-center justify-end gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-100 rounded border-0 bg-transparent"
                                  >
                                    Entrées
                                    {tablesBlocAccountSort.col === 'entrées' && (
                                      <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                        {tablesBlocAccountSort.dir === 'asc' ? '↑' : '↓'}
                                      </span>
                                    )}
                                  </button>
                                </th>
                                <th
                                  className="px-3 py-2 text-right"
                                  aria-sort={dashboardTablesBlocAriaSort(tablesBlocAccountSort.col, 'sorties', tablesBlocAccountSort.dir)}
                                >
                                  <button
                                    type="button"
                                    title="Trier par sorties"
                                    onClick={() =>
                                      setTablesBlocAccountSort((prev) =>
                                        prev.col === 'sorties'
                                          ? { col: 'sorties', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                          : { col: 'sorties', dir: 'desc' }
                                      )
                                    }
                                    className="inline-flex w-full items-center justify-end gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-100 rounded border-0 bg-transparent"
                                  >
                                    Sorties
                                    {tablesBlocAccountSort.col === 'sorties' && (
                                      <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                        {tablesBlocAccountSort.dir === 'asc' ? '↑' : '↓'}
                                      </span>
                                    )}
                                  </button>
                                </th>
                                <th
                                  className="px-3 py-2 text-right"
                                  aria-sort={dashboardTablesBlocAriaSort(tablesBlocAccountSort.col, 'balance', tablesBlocAccountSort.dir)}
                                >
                                  <button
                                    type="button"
                                    title="Trier par balance"
                                    onClick={() =>
                                      setTablesBlocAccountSort((prev) =>
                                        prev.col === 'balance'
                                          ? { col: 'balance', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                          : { col: 'balance', dir: 'desc' }
                                      )
                                    }
                                    className="inline-flex w-full items-center justify-end gap-1 font-inherit text-inherit uppercase tracking-wide cursor-pointer select-none hover:bg-gray-100 rounded border-0 bg-transparent"
                                  >
                                    Balance
                                    {tablesBlocAccountSort.col === 'balance' && (
                                      <span className="font-normal tabular-nums text-gray-500" aria-hidden>
                                        {tablesBlocAccountSort.dir === 'asc' ? '↑' : '↓'}
                                      </span>
                                    )}
                                  </button>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {tablesBlocSortedSummaryByAccount.map((r) => (
                                <tr key={`sa-${r.account}`} className="border-b border-gray-100">
                                  <td className="px-3 py-2 text-gray-800">{r.account}</td>
                                  <td className="px-3 py-2 text-right tabular-nums text-green-700">
                                    {r.entrées > 0
                                      ? `+${formatCurrency(convertMovementsToDisplayCurrency(r.entrées, tablesYAxisCurrency as CurrencySymbol), tablesYAxisCurrency)}`
                                      : '–'}
                                  </td>
                                  <td className="px-3 py-2 text-right tabular-nums text-red-700">
                                    {r.sorties > 0
                                      ? `−${formatCurrency(convertMovementsToDisplayCurrency(r.sorties, tablesYAxisCurrency as CurrencySymbol), tablesYAxisCurrency)}`
                                      : '–'}
                                  </td>
                                  <td
                                    className={`px-3 py-2 text-right tabular-nums font-medium ${
                                      r.balance >= 0 ? 'text-green-700' : 'text-red-700'
                                    }`}
                                  >
                                    {r.balance >= 0 ? '+' : '−'}
                                    {formatCurrency(
                                      Math.abs(convertMovementsToDisplayCurrency(r.balance, tablesYAxisCurrency as CurrencySymbol)),
                                      tablesYAxisCurrency
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                    <div className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 flex flex-col gap-2">
                      {tablesBlocSelectedRowKeys.size > 0 && (
                        <p className="text-xs text-gray-600">
                          Les montants ci-dessous ne comptent que les lignes cochées dans le tableau.
                        </p>
                      )}
                      <div className="flex flex-wrap gap-6 justify-between items-center">
                      <div className="text-sm">
                        <span className="text-gray-600">Total entrées : </span>
                        <span className="font-semibold text-green-700 tabular-nums">
                          +
                          {formatCurrency(
                            convertMovementsToDisplayCurrency(tablesDashboardData.totalEntrées, tablesYAxisCurrency as CurrencySymbol),
                            tablesYAxisCurrency
                          )}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-gray-600">Total sorties : </span>
                        <span className="font-semibold text-red-700 tabular-nums">
                          −
                          {formatCurrency(
                            convertMovementsToDisplayCurrency(tablesDashboardData.totalSorties, tablesYAxisCurrency as CurrencySymbol),
                            tablesYAxisCurrency
                          )}
                        </span>
                      </div>
                      <div className="text-sm">
                        <span className="text-gray-600">Balance : </span>
                        <span
                          className={`font-semibold tabular-nums ${
                            tablesDashboardData.balance >= 0 ? 'text-green-700' : 'text-red-700'
                          }`}
                        >
                          {tablesDashboardData.balance >= 0 ? '+' : '−'}
                          {formatCurrency(
                            Math.abs(convertMovementsToDisplayCurrency(tablesDashboardData.balance, tablesYAxisCurrency as CurrencySymbol)),
                            tablesYAxisCurrency
                          )}
                        </span>
                      </div>
                      </div>
                    </div>
                  </div>
                )}
                {!movementsDataLoading && !movementsDataError && sourceData && !tablesDashboardData && (
                  <div className="py-4 text-center text-gray-500 text-sm">
                    Données source sans colonne Date ou AMOUNT GBP, ou plage vide.
                  </div>
                )}
              </div>
            </div>
          </>
        </div>
        )}
      </section>

      {/* Suivi annuel */}
      <section className="flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden mb-6">
        <header
          className={`bg-gradient-to-br from-slate-50 to-white ${
            sectionsExpanded.vueGlobale ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
          }`}
        >
          <div className="flex items-stretch">
            <button
              type="button"
              className="flex-1 min-w-0 px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
              onClick={() => setSectionExpanded('vueGlobale', !sectionsExpanded.vueGlobale)}
              aria-expanded={sectionsExpanded.vueGlobale}
            >
              <span
                className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
                  sectionsExpanded.vueGlobale ? 'rotate-90' : ''
                }`}
                aria-hidden
              >
                ▶
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                  Suivi annuel
                </span>
              </span>
            </button>
            <div className="flex items-center shrink-0 pr-3 sm:pr-4">
              <button
                type="button"
                onClick={() => {
                  setVueGlobaleFiltersOpen((o) => {
                    const next = !o;
                    saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleFiltersOpen, String(next));
                    return next;
                  });
                }}
                title="Paramètres"
                className={`flex-shrink-0 p-2 rounded-lg border transition-colors ${
                  vueGlobaleFiltersOpen
                    ? 'bg-gray-200 border-gray-300 text-gray-800'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-gray-800'
                }`}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>
        </header>
        {sectionsExpanded.vueGlobale && (
        <div className="px-4 pb-4 pt-3">
        <>
        <div className="flex gap-4 items-stretch">
          {vueGlobaleFiltersOpen && (
            <div className="flex-shrink-0 flex flex-col min-h-0 w-[200px]">
              <div className="flex-1 flex flex-col min-h-0 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                <button
                  type="button"
                  onClick={() => setVueGlobaleFiltersOpen((o) => {
                    const next = !o;
                    saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleFiltersOpen, String(next));
                    return next;
                  })}
                  className="flex-shrink-0 w-full px-3 py-2 text-left text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 flex items-center justify-between"
                >
                  Paramètres
                  <span className="text-gray-500">▼</span>
                </button>
                <div className="flex-1 min-h-0 flex flex-col p-3 gap-4 overflow-hidden">
                  <div className="flex-shrink-0">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Devise d&apos;affichage
                    </label>
                    <select
                      value={vueGlobaleYAxisCurrency}
                      onChange={(e) => {
                        const v = e.target.value;
                        setVueGlobaleYAxisCurrency(v);
                        saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleYAxisCurrency, v);
                      }}
                      className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800"
                    >
                      {Y_AXIS_CURRENCIES.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {yearlyViewData && yearlyViewData.years.length > 0 && (
                    <div className="flex-shrink-0">
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                        Années visibles
                      </label>
                      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
                        {yearlyViewData.years.map((year) => {
                          const checked = !vueGlobaleHiddenYears[year];
                          return (
                            <label key={year} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setVueGlobaleHiddenYears((prev) => {
                                    const next = { ...prev, [year]: !prev[year] };
                                    const toSave = Object.fromEntries(
                                      Object.entries(next).filter(([, v]) => v).map(([y]) => [y, false])
                                    );
                                    saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleVisibleYears, JSON.stringify(toSave));
                                    return next;
                                  });
                                }}
                                className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                              />
                              <span className="text-sm text-gray-700">{year}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {yearlySummarySeriesLabels.length > 0 && (
                    <div className="flex-shrink-0 flex flex-col">
                      <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                        Afficher uniquement les labels cochés
                      </label>
                      <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none mb-2">
                        <input
                          type="checkbox"
                          checked={areAllYearlySummarySeriesChecked}
                          onChange={(e) => {
                            const isChecked = e.target.checked;
                            setVueGlobaleHiddenSeriesByLabel((prev) => {
                              const next = { ...prev };
                              yearlySummarySeriesLabels.forEach((label) => {
                                next[label] = !isChecked;
                              });
                              saveDashboardPref(
                                DASHBOARD_STORAGE_KEYS.vueGlobaleHiddenSeriesByLabel,
                                JSON.stringify(next)
                              );
                              return next;
                            });
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>{areAllYearlySummarySeriesChecked ? 'Tout décocher' : 'Tout cocher'}</span>
                      </label>
                      <div className="max-h-40 overflow-y-auto rounded border border-gray-200 bg-white p-2 space-y-1.5">
                        {yearlySummarySeriesLabels.map((label) => {
                          const checked = !(vueGlobaleHiddenSeriesByLabel[label] ?? false);
                          const isSortieLabel = yearlySummarySortieLabelSet.has(label);
                          const isBalance = label === 'Balance';
                          return (
                            <label
                              key={label}
                              className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const isCh = e.target.checked;
                                  setVueGlobaleHiddenSeriesByLabel((prev) => {
                                    const next = { ...prev, [label]: !isCh };
                                    saveDashboardPref(
                                      DASHBOARD_STORAGE_KEYS.vueGlobaleHiddenSeriesByLabel,
                                      JSON.stringify(next)
                                    );
                                    return next;
                                  });
                                }}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="truncate" title={label}>
                                {label}
                              </span>
                              <span
                                className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                                  isBalance ? 'bg-gray-600 dark:bg-gray-400' : isSortieLabel ? 'bg-red-500' : 'bg-green-500'
                                }`}
                                aria-hidden
                                title={
                                  isBalance ? 'Balance' : isSortieLabel ? 'Type sortie' : 'Type entrée'
                                }
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="flex-shrink-0">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                      Affichage
                    </label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vueGlobaleShowTable}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setVueGlobaleShowTable(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowTable, String(v));
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                        />
                        <span className="text-sm text-gray-700">Tableau (types par année)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vueGlobaleShowChart}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setVueGlobaleShowChart(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowChart, String(v));
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                        />
                        <span className="text-sm text-gray-700">Graphe</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vueGlobaleShowSummaryTable}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setVueGlobaleShowSummaryTable(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowSummaryTable, String(v));
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                        />
                        <span className="text-sm text-gray-700">Tableau outils d&apos;analyse</span>
                      </label>
                    </div>
                  </div>
                  <div className="flex-shrink-0 border-t border-gray-200 pt-3 mt-1">
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                      Outils d&apos;analyse
                    </label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vueGlobaleShowTrendLine}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setVueGlobaleShowTrendLine(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowTrendLine, String(v));
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                        />
                        <span className="text-sm text-gray-700">Courbe de tendance (+ équation)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vueGlobaleShowMoyenneEntrées}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setVueGlobaleShowMoyenneEntrées(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowMoyenneEntrées, String(v));
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                        />
                        <span className="text-sm text-gray-700">Moyenne entrées</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vueGlobaleShowMoyenneSorties}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setVueGlobaleShowMoyenneSorties(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowMoyenneSorties, String(v));
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                        />
                        <span className="text-sm text-gray-700">Moyenne sorties</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vueGlobaleShowMoyenneBalance}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setVueGlobaleShowMoyenneBalance(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleShowMoyenneBalance, String(v));
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-gray-700 focus:ring-gray-400"
                        />
                        <span className="text-sm text-gray-700">Moyenne balance</span>
                      </label>
                    </div>
                    <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 mt-3">
                      Hauteur du graphique
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={200}
                        max={700}
                        step={10}
                        value={vueGlobaleChartHeightPx}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (Number.isFinite(v)) {
                            setVueGlobaleChartHeightPx(v);
                            saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleChartHeight, String(v));
                          }
                        }}
                        className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 accent-blue-600"
                      />
                      <span className="text-sm text-gray-700 tabular-nums w-10">
                        {vueGlobaleChartHeightPx} px
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col gap-4">
            {movementsDataLoading && (
              <div className="py-6 text-center text-gray-500">Chargement…</div>
            )}
            {!movementsDataLoading && movementsDataError && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">
                {movementsDataError}
              </div>
            )}
            {!movementsDataLoading && !movementsDataError && yearlyViewDataFiltered && yearlyViewDataFiltered.years.length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
                Aucune année sélectionnée. Cochez au moins une année dans les paramètres.
              </div>
            )}
            {!movementsDataLoading && !movementsDataError && yearlyViewDataFiltered && yearlyViewDataFiltered.years.length > 0 && (
              <>
                {vueGlobaleShowTable && (
                <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white dark:border-gray-700 dark:bg-gray-800">
                  <table className="border-collapse w-full text-sm" style={{ tableLayout: 'fixed' }}>
                      <colgroup>
                        <col style={{ width: '15%' }} />
                        {yearlyViewDataFiltered.years.map((_, i) => (
                          <col key={i} style={{ width: `${85 / yearlyViewDataFiltered.years.length}%` }} />
                        ))}
                      </colgroup>
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 text-left font-semibold text-gray-800 px-3 py-2 border-b border-r border-gray-200 bg-gray-100 min-w-[8rem]" scope="col">
                          Type
                        </th>
                        {yearlyViewDataFiltered.years.map((year, yearIndex) => (
                          <th
                            key={year}
                            className={`text-center font-semibold text-gray-800 px-3 py-2 border-b border-gray-200 bg-gray-100 min-w-[5rem] ${yearIndex > 0 ? 'border-l-2 border-l-gray-300' : ''}`}
                            scope="col"
                          >
                            {year}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                        {yearlyViewDataFiltered.types.length === 0 ? (
                        <tr>
                          <td colSpan={1 + yearlyViewDataFiltered.years.length} className="px-3 py-4 text-center text-gray-500 border-b border-gray-200">
                            Aucune donnée par type
                          </td>
                        </tr>
                      ) : (
                        <>
                          {/* Groupe Entrées */}
                          <tr
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setVueGlobaleTableExpanded((prev) => {
                                const next = { ...prev, entrées: !prev.entrées };
                                saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleTableExpanded, JSON.stringify(next));
                                return next;
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setVueGlobaleTableExpanded((prev) => {
                                  const next = { ...prev, entrées: !prev.entrées };
                                  saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleTableExpanded, JSON.stringify(next));
                                  return next;
                                });
                              }
                            }}
                            className="cursor-pointer hover:bg-green-200/70 transition-colors"
                            aria-expanded={vueGlobaleTableExpanded.entrées}
                          >
                            <td className="sticky left-0 z-10 px-3 py-1.5 border-b border-r border-gray-200 bg-green-100 text-left font-semibold text-green-800 text-xs uppercase tracking-wide">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="inline-block transition-transform duration-200"
                                  style={{ transform: vueGlobaleTableExpanded.entrées ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                                  aria-hidden
                                >
                                  ▼
                                </span>
                                Entrées
                              </span>
                            </td>
                            {yearlyViewDataFiltered.years.map((year, yearIndex) => (
                              <td key={year} className={`px-2 py-1.5 border-b border-gray-200 bg-green-100/50 ${yearIndex > 0 ? 'border-l-2 border-l-gray-300' : ''}`} />
                            ))}
                          </tr>
                          {vueGlobaleTableExpanded.entrées && yearlyViewDataFiltered.types
                            .filter((type) => yearlyViewDataFiltered.years.some((y) => (yearlyViewDataFiltered.entréesByYearByType[type]?.[y] ?? 0) > 0))
                            .map((type) => (
                              <tr key={`entrée-${type}`} className="border-b border-gray-100">
                                <td className="sticky left-0 z-10 pl-6 pr-3 py-1.5 border-r border-gray-200 bg-white text-gray-700">
                                  {type}
                                </td>
                                {yearlyViewDataFiltered.years.map((year, yearIndex) => {
                                  const entrées = yearlyViewDataFiltered.entréesByYearByType[type]?.[year] ?? 0;
                                  const entréesD = convertMovementsToDisplayCurrency(entrées, vueGlobaleYAxisCurrency as CurrencySymbol);
                                  const yearCellClass = yearIndex > 0 ? 'border-l-2 border-l-gray-300' : '';
                                  return (
                                    <td key={year} className={`px-2 py-1.5 text-right border-gray-200 bg-green-50/30 tabular-nums text-green-800 ${yearCellClass}`}>
                                      {entrées > 0 ? `+${formatCurrency(entréesD, vueGlobaleYAxisCurrency)}` : '–'}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          <tr className="border-b border-gray-200 bg-green-50">
                            <td className="sticky left-0 z-10 pl-6 pr-3 py-1.5 border-r border-gray-200 bg-green-50 font-medium text-green-800">
                              Total entrées
                            </td>
                            {yearlyViewDataFiltered.years.map((year, yearIndex) => {
                              const entrées = yearlyViewDataFiltered.totalEntréesByYear[year] ?? 0;
                              const entréesD = convertMovementsToDisplayCurrency(entrées, vueGlobaleYAxisCurrency as CurrencySymbol);
                              return (
                                <td key={year} className={`px-2 py-1.5 text-right border-gray-200 tabular-nums font-medium text-green-800 ${yearIndex > 0 ? 'border-l-2 border-l-gray-300' : ''}`}>
                                  +{formatCurrency(entréesD, vueGlobaleYAxisCurrency)}
                                </td>
                              );
                            })}
                          </tr>
                          {/* Groupe Sorties */}
                          <tr
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setVueGlobaleTableExpanded((prev) => {
                                const next = { ...prev, sorties: !prev.sorties };
                                saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleTableExpanded, JSON.stringify(next));
                                return next;
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setVueGlobaleTableExpanded((prev) => {
                                  const next = { ...prev, sorties: !prev.sorties };
                                  saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleTableExpanded, JSON.stringify(next));
                                  return next;
                                });
                              }
                            }}
                            className="cursor-pointer hover:bg-red-200/70 transition-colors"
                            aria-expanded={vueGlobaleTableExpanded.sorties}
                          >
                            <td className="sticky left-0 z-10 px-3 py-1.5 border-b border-r border-gray-200 bg-red-100 text-left font-semibold text-red-800 text-xs uppercase tracking-wide">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="inline-block transition-transform duration-200"
                                  style={{ transform: vueGlobaleTableExpanded.sorties ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                                  aria-hidden
                                >
                                  ▼
                                </span>
                                Sorties
                              </span>
                            </td>
                            {yearlyViewDataFiltered.years.map((year, yearIndex) => (
                              <td key={year} className={`px-2 py-1.5 border-b border-gray-200 bg-red-100/50 ${yearIndex > 0 ? 'border-l-2 border-l-gray-300' : ''}`} />
                            ))}
                          </tr>
                          {vueGlobaleTableExpanded.sorties && yearlyViewDataFiltered.types
                            .filter((type) => yearlyViewDataFiltered.years.some((y) => (yearlyViewDataFiltered.sortiesByYearByType[type]?.[y] ?? 0) > 0))
                            .map((type) => (
                              <tr key={`sortie-${type}`} className="border-b border-gray-100">
                                <td className="sticky left-0 z-10 pl-6 pr-3 py-1.5 border-r border-gray-200 bg-white text-gray-700">
                                  {type}
                                </td>
                                {yearlyViewDataFiltered.years.map((year, yearIndex) => {
                                  const sorties = yearlyViewDataFiltered.sortiesByYearByType[type]?.[year] ?? 0;
                                  const sortiesD = convertMovementsToDisplayCurrency(sorties, vueGlobaleYAxisCurrency as CurrencySymbol);
                                  const yearCellClass = yearIndex > 0 ? 'border-l-2 border-l-gray-300' : '';
                                  return (
                                    <td key={year} className={`px-2 py-1.5 text-right border-gray-200 bg-red-50/30 tabular-nums text-red-800 ${yearCellClass}`}>
                                      {sorties > 0 ? `−${formatCurrency(sortiesD, vueGlobaleYAxisCurrency)}` : '–'}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))}
                          <tr className="border-b border-gray-200 bg-red-50">
                            <td className="sticky left-0 z-10 pl-6 pr-3 py-1.5 border-r border-gray-200 bg-red-50 font-medium text-red-800">
                              Total sorties
                            </td>
                            {yearlyViewDataFiltered.years.map((year, yearIndex) => {
                              const sorties = yearlyViewDataFiltered.totalSortiesByYear[year] ?? 0;
                              const sortiesD = convertMovementsToDisplayCurrency(sorties, vueGlobaleYAxisCurrency as CurrencySymbol);
                              return (
                                <td key={year} className={`px-2 py-1.5 text-right border-gray-200 tabular-nums font-medium text-red-800 ${yearIndex > 0 ? 'border-l-2 border-l-gray-300' : ''}`}>
                                  −{formatCurrency(sortiesD, vueGlobaleYAxisCurrency)}
                                </td>
                              );
                            })}
                          </tr>
                          <tr className="bg-gray-50 font-semibold">
                            <td className="sticky left-0 z-10 px-3 pr-3 py-2 border-r border-gray-200 bg-gray-100 text-gray-800">
                              Balance Annuelle
                            </td>
                            {yearlyViewDataFiltered.years.map((year, yearIndex) => {
                              const balance = (yearlyViewDataFiltered.totalEntréesByYear[year] ?? 0) - (yearlyViewDataFiltered.totalSortiesByYear[year] ?? 0);
                              const balanceD = convertMovementsToDisplayCurrency(balance, vueGlobaleYAxisCurrency as CurrencySymbol);
                              const yearCellClass = yearIndex > 0 ? 'border-l-2 border-l-gray-300' : '';
                              return (
                                <td key={year} className={`px-2 py-2 text-right border-gray-200 tabular-nums ${balance >= 0 ? 'text-green-800 bg-green-50' : 'text-red-800 bg-red-50'} ${yearCellClass}`}>
                                  {(balance >= 0 ? '+' : '') + formatCurrency(balanceD, vueGlobaleYAxisCurrency)}
                                </td>
                              );
                            })}
                          </tr>
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
                )}
                {vueGlobaleShowChart && (
                <div className={vueGlobaleShowTable ? 'mt-4' : ''}>
                  <YearlySummaryChart
                    data={yearlyChartData}
                    currency={vueGlobaleYAxisCurrency}
                    height={vueGlobaleChartHeightPx}
                    showTrendLine={vueGlobaleShowTrendLine}
                    showMoyenneEntrées={vueGlobaleShowMoyenneEntrées}
                    showMoyenneSorties={vueGlobaleShowMoyenneSorties}
                    showMoyenneBalance={vueGlobaleShowMoyenneBalance}
                    showSummaryTable={vueGlobaleShowSummaryTable}
                    hiddenSeriesByLabel={vueGlobaleHiddenSeriesByLabel}
                    onLegendVisibilityChange={(next) => {
                      setVueGlobaleHiddenSeriesByLabel(next);
                      saveDashboardPref(DASHBOARD_STORAGE_KEYS.vueGlobaleHiddenSeriesByLabel, JSON.stringify(next));
                    }}
                  />
                </div>
                )}
              </>
            )}
            {!movementsDataLoading && !movementsDataError && !yearlyViewData && sourceData && (
              <div className="py-4 text-center text-gray-500 text-sm">
                Données source sans colonne Date ou montant, ou aucune donnée.
              </div>
            )}
          </div>
        </div>
        </>
        </div>
        )}
      </section>

      <div className="flex-1 flex flex-col items-center justify-center text-gray-600">
        <p>
          Chamaccounts 2026 – Logiciel de comptabilité pour indépendants.
        </p>
      </div>
    </main>
  );
};

export default Dashboard;
