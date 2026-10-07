import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { format as formatDateFns, type Locale } from 'date-fns';
import { enUS, fr as frLocale } from 'date-fns/locale';
import { createPortal } from 'react-dom';
import { Chart as ChartJS, ChartOptions, Filler, registerables } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { MONTHLY_ANOMALY_REPORT_PATH } from '@/shared/dataPaths';
import {
  SourceDataCSVService,
  type SourceDataResult,
  SOURCE_DATA_PATH,
  stripSourceColumnFromSourceData,
} from '../services/SourceDataCSVService';
import type { MonthlyTotalDto } from '@/shared/transactionQueryTypes';
import { TRANSACTION_SOURCE_HEADERS } from '@/shared/sourceDataTypes';
import { EXCLUDE_ANOMALY_COLUMN, detectAnomalies } from '../services/AnomalyDetectionService';
import { formatAnomalyReasons } from '../i18n/formatAnomalyReason';
import { getSuggestions, getDateSuggestionsForMonth, completeDateForMonth, isTextSuggestibleColumn } from '../services/SuggestInputService';
import { accountLabelFromSource } from '../constants/accountSourceLabels';
import { resolveBalanceLineIdForTransactionType } from '../constants/annualBudgetTypeMapping';
import { getYearSnapshot, type YearSnapshot } from '../services/annualBudgetStorage';
import {
  formatDateDDMMYYYY,
  formatAmountForRowCurrency,
  formatFx,
  formatCurrency,
} from '../utils/format';
import { isAmountIndicatorHeader, currencyDisplaySymbol } from '@/shared/workingCurrencies';
import {
  isAmountGbpIndicatorReadOnly,
  syncTransactionAmountCurrencyOnEdit,
} from '../utils/syncTransactionAmountCurrency';
import {
  convertMovementsToDisplayCurrency,
  getEffectiveRates,
  getCachedWorkingCurrencies,
  type CurrencySymbol,
} from '../services/EffectiveExchangeRates';
import {
  coerceDisplayCurrency,
  displayCurrencyOptionsFromWorking,
} from '../utils/displayCurrencyOptions';
import { useProjectsFromStorage } from '../hooks/useProjectsFromStorage';
import { ProjetDisplayCell, ProjetSelectCell } from '../components/ProjetColumnCells';
import { ResizableTableHeadCell } from '../components/Common/ResizableTableHeadCell';
import {
  defaultEditColumnWidth,
  useResizableTableColumns,
  type ResizableColumnDef,
} from '../hooks/useResizableTableColumns';

ChartJS.register(...registerables, Filler);

const MONTH_STORAGE_KEY = 'monthly-accounting-selected-month';
const CUMULATIVE_CHART_FILTERS_OPEN = 'monthly-accounting-cumulative-chart-filters-open';
const CUMULATIVE_CHART_Y_AXIS_CURRENCY = 'monthly-accounting-cumulative-chart-y-axis-currency';
const CUMULATIVE_CHART_HEIGHT_PX = 'monthly-accounting-cumulative-chart-height-px';
const OVERVIEW_FILTERS_OPEN = 'monthly-accounting-overview-filters-open';
const OVERVIEW_BAR_AVERAGE = 'monthly-accounting-overview-bar-average';
const OVERVIEW_BAR_BUDGET = 'monthly-accounting-overview-bar-budget';
/** @deprecated migré vers OVERVIEW_BAR_AVERAGE / OVERVIEW_BAR_BUDGET */
const OVERVIEW_BAR_MODE_LEGACY = 'monthly-accounting-overview-bar-mode';
const OVERVIEW_AVERAGE_PERIOD = 'monthly-accounting-overview-average-period';
const SECTION_MONTHLY_CHART = 'monthly-accounting-section-chart-expanded';
const SECTION_MONTHLY_OVERVIEW = 'monthly-accounting-section-overview-expanded';
const SECTION_MONTHLY_TABLE = 'monthly-accounting-section-table-expanded';
const MA_TABLE_COL_WIDTHS_KEY = 'monthly-accounting-table-col-widths';

function loadMonthlySectionExpanded(key: string, defaultOpen = true): boolean {
  try {
    const s = localStorage.getItem(key);
    if (s === 'false') return false;
    if (s === 'true') return true;
    return defaultOpen;
  } catch {
    return defaultOpen;
  }
}

function saveMonthlySectionExpanded(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

function loadOverviewBarToggles(): { average: boolean; budget: boolean } {
  try {
    const a = localStorage.getItem(OVERVIEW_BAR_AVERAGE);
    const b = localStorage.getItem(OVERVIEW_BAR_BUDGET);
    if (a !== null || b !== null) {
      return { average: a === 'true', budget: b === 'true' };
    }
    const legacy = localStorage.getItem(OVERVIEW_BAR_MODE_LEGACY);
    if (legacy === 'average') return { average: true, budget: true };
    return { average: false, budget: false };
  } catch {
    return { average: false, budget: false };
  }
}

/** Valeurs de période (libellés : `monthlyAccounting.period.options.*`). */
const AVERAGE_PERIOD_VALUES = ['1', '3', '6', '12', '24', '36', '48'];

/** Phrase complète pour l’infobulle « écart vs moyenne » (ex. « sur les 12 derniers mois »). */
function phraseMoyenneSurPeriode(periodValue: string, t: TFunction): string {
  return AVERAGE_PERIOD_VALUES.includes(periodValue)
    ? t(`monthlyAccounting.period.phrases.${periodValue}`)
    : '';
}

/**
 * Couleur du montant d’écart (colonne Écart + infobulle barres).
 * Sorties (`total-sorties`, ids `s-*`) : positif rouge, négatif vert.
 * Entrées (`e-*`, `total-entrees`) et `balance` : positif vert, négatif rouge.
 * Aligné sur `isSortiesRow` dans le bloc « Résultats et statistiques ».
 */
function overviewStatBarEcartAmountClass(diff: number, isSorties: boolean): string {
  if (diff === 0) return '';
  if (isSorties) return diff > 0 ? 'text-red-600' : 'text-green-600';
  return diff > 0 ? 'text-green-600' : 'text-red-600';
}

/** Infobulle instantanée (pas d’attribut title du navigateur) pour les barres « résultats et statistiques ». */
function OverviewStatBarTooltipBubble(props: {
  variant: 'average' | 'budget';
  diff: number;
  currency: string;
  periodPhrase?: string;
  year?: number;
  isSortiesRow: boolean;
}) {
  const { t } = useTranslation();
  const { variant, diff, currency, periodPhrase, year, isSortiesRow: isSorties } = props;
  const formatted = `${diff > 0 ? '+' : ''}${formatCurrency(diff, currency)}`;
  const isZero = diff === 0;
  const isAvg = variant === 'average';
  const amountClass = overviewStatBarEcartAmountClass(diff, isSorties);
  return (
    <div className="relative">
      <div
        className={`min-w-[220px] max-w-[min(300px,calc(100vw-1.5rem))] rounded-xl border px-3.5 py-3 shadow-2xl ring-1 ring-white/10 ${
          isAvg
            ? 'border-sky-700/50 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950'
            : 'border-violet-700/50 bg-gradient-to-br from-slate-800 via-indigo-950/80 to-slate-950'
        }`}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
              isAvg ? 'bg-sky-500/25 text-sky-200' : 'bg-violet-500/25 text-violet-200'
            }`}
            aria-hidden
          >
            {isAvg ? t('monthlyAccounting.tooltip.averageBadge') : t('monthlyAccounting.tooltip.budgetBadge')}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-300">
              {isAvg ? t('monthlyAccounting.tooltip.averageTitle') : t('monthlyAccounting.tooltip.budgetTitle')}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-slate-400">
              {isAvg && periodPhrase ? (
                <Trans
                  i18nKey="monthlyAccounting.tooltip.averageComputed"
                  values={{ period: periodPhrase }}
                  components={{ em: <span className="font-medium text-slate-300" /> }}
                />
              ) : !isAvg && year != null ? (
                <Trans
                  i18nKey="monthlyAccounting.tooltip.budgetDerived"
                  values={{ year }}
                  components={{ em: <span className="font-medium text-slate-300" /> }}
                />
              ) : (
                '\u00a0'
              )}
            </p>
          </div>
        </div>
        <div className="mt-3 border-t border-white/10 pt-3">
          {isZero ? (
            <p className="text-center text-sm font-semibold text-emerald-400/95">{t('monthlyAccounting.tooltip.zeroDiff')}</p>
          ) : (
            <p
              className={`text-center text-xl font-bold tabular-nums tracking-tight drop-shadow-sm ${amountClass || 'text-white'}`}
            >
              {formatted}
            </p>
          )}
          <p className="mt-2 text-center text-[11px] leading-relaxed text-slate-500">
            {isAvg && periodPhrase
              ? isZero
                ? t('monthlyAccounting.tooltip.averageZeroHint')
                : t('monthlyAccounting.tooltip.averageDiffHint')
              : !isAvg && year != null
                ? isZero
                  ? t('monthlyAccounting.tooltip.budgetZeroHint')
                  : t('monthlyAccounting.tooltip.budgetDiffHint')
                : null}
          </p>
        </div>
      </div>
      <div
        className={`absolute left-1/2 top-full -translate-x-1/2 border-[8px] border-transparent ${
          isAvg ? 'border-t-slate-950' : 'border-t-indigo-950'
        }`}
        aria-hidden
      />
    </div>
  );
}

/** Parse une cellule date en Date ou null (ISO ou JJ/MM/AAAA, JJ.MM.AAAA). */
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

/** Formate une Date locale en JJ.MM.AAAA (aligné sur formatDateDDMMYYYY). */
function formatDateObjDDMMYYYY(d: Date): string {
  const j = String(d.getDate()).padStart(2, '0');
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  return `${j}.${mo}.${d.getFullYear()}`;
}

/** Forecast annuel (GBP) → part mensuelle, convertie dans la devise d’affichage. null si aucune ligne budgétée. */
function monthlyForecastForTypeDisplay(
  type: string,
  snap: YearSnapshot | null,
  displayCurrency: CurrencySymbol
): number | null {
  if (!snap) return null;
  const lineId = resolveBalanceLineIdForTransactionType(type, snap.lineAssignedTypes);
  if (!lineId) return null;
  const annualGbp = snap.budgetValues[lineId] ?? 0;
  const monthlyGbp = annualGbp / 12;
  return convertMovementsToDisplayCurrency(monthlyGbp, displayCurrency);
}

/** Parse un montant depuis une cellule (virgule ou point décimal). */
function parseAmountCell(raw: string): number {
  const s = (raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return 0;
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

/** Échappe HTML pour affichage dans le tooltip. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Libellé « mois année » selon la locale de l’interface (date-fns). */
function formatMonthLabel(year: number, month: number, locale: Locale): string {
  return formatDateFns(new Date(year, month - 1, 1), 'MMMM yyyy', { locale });
}

function getCompareValue(header: string, raw: string): number | string {
  const s = (raw ?? '').trim();
  if (s === '') {
    if (/date/i.test(header) || /^amount$|^currency$|^amount\s*gbp$/i.test(header)) return Infinity;
    if (/^index$/i.test(header)) return Infinity;
    return '';
  }
  if (/^index$/i.test(header)) {
    const n = parseInt(s.replace(/\s/g, ''), 10);
    return Number.isNaN(n) ? s : n;
  }
  if (/date/i.test(header)) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/;
    const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
    let y: number, m: number, d: number;
    const mi = s.match(iso);
    if (mi) {
      y = parseInt(mi[1], 10);
      m = parseInt(mi[2], 10);
      d = parseInt(mi[3], 10);
    } else {
      const md = s.match(dmy);
      if (md) {
        d = parseInt(md[1], 10);
        m = parseInt(md[2], 10);
        const yy = md[3].length === 2 ? (parseInt(md[3], 10) < 50 ? 2000 + parseInt(md[3], 10) : 1900 + parseInt(md[3], 10)) : parseInt(md[3], 10);
        y = yy;
      } else return s;
    }
    return y * 10000 + m * 100 + d;
  }
  if (/^amount$|^currency$|^amount\s*gbp$/i.test(header)) {
    const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
    return Number.isNaN(n) ? s : n;
  }
  if (/^account$/i.test(header) || /compte/i.test(header)) {
    return (accountLabelFromSource(s) || s).toLowerCase();
  }
  return s.toLowerCase();
}

function cloneSourceDataResult(source: SourceDataResult): SourceDataResult {
  return {
    headers: [...source.headers],
    rows: source.rows.map((row) => ({ ...row })),
  };
}

function isSourceDataResultEqual(a: SourceDataResult, b: SourceDataResult): boolean {
  if (a.headers.length !== b.headers.length) return false;
  for (let i = 0; i < a.headers.length; i++) {
    if (a.headers[i] !== b.headers[i]) return false;
  }
  if (a.rows.length !== b.rows.length) return false;
  for (let i = 0; i < a.rows.length; i++) {
    const ra = a.rows[i];
    const rb = b.rows[i];
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    for (const k of keys) {
      if ((ra[k] ?? '') !== (rb[k] ?? '')) return false;
    }
  }
  return true;
}

function numberSetsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function newRowDraftsEqual(a: Record<string, string>[], b: Record<string, string>[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}

type MonthlyEditSessionSnapshot = {
  data: SourceDataResult;
  rowsToDelete: Set<number>;
  rowsExcludedFromAnomaly: Set<number>;
  newRowDrafts: Record<string, string>[];
};

function isMonthlyEditSessionDirty(
  data: SourceDataResult | null,
  rowsToDelete: Set<number>,
  rowsExcludedFromAnomaly: Set<number>,
  newRowDrafts: Record<string, string>[],
  baseline: MonthlyEditSessionSnapshot | null
): boolean {
  if (!data || !baseline) return false;
  if (!numberSetsEqual(rowsToDelete, baseline.rowsToDelete)) return true;
  if (!numberSetsEqual(rowsExcludedFromAnomaly, baseline.rowsExcludedFromAnomaly)) return true;
  if (!newRowDraftsEqual(newRowDrafts, baseline.newRowDrafts)) return true;
  return !isSourceDataResultEqual(data, baseline.data);
}

const MonthlyAccounting: React.FC = () => {
  const { t, i18n } = useTranslation();
  const dateLocale = i18n.language === 'fr' ? frLocale : enUS;
  const projects = useProjectsFromStorage();
  const [data, setData] = useState<SourceDataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(MONTH_STORAGE_KEY);
      if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
    } catch {}
    return '';
  });
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalyMessage, setAnomalyMessage] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [reorderChronoLoading, setReorderChronoLoading] = useState(false);
  const [reorderChronoMessage, setReorderChronoMessage] = useState<string | null>(null);
  const editSessionBaselineRef = useRef<MonthlyEditSessionSnapshot | null>(null);
  const [editExitConfirmOpen, setEditExitConfirmOpen] = useState(false);
  const [rowsToDelete, setRowsToDelete] = useState<Set<number>>(() => new Set());
  const [rowsExcludedFromAnomaly, setRowsExcludedFromAnomaly] = useState<Set<number>>(() => new Set());
  /** Ligne(s) vide(s) en mode édition pour ajouter de nouvelles entrées (non enregistrées tant que vides ou jusqu'au clic Sauvegarder). */
  const [newRowDrafts, setNewRowDrafts] = useState<Record<string, string>[]>(() => [{}]);
  const [editShowAnomaliesOnly, setEditShowAnomaliesOnly] = useState(false);
  const [anomalyFilterStickyIndices, setAnomalyFilterStickyIndices] = useState<Set<number>>(
    () => new Set()
  );
  const prevMonthlyAnomalyMapForFilterRef = useRef<Map<number, string>>(new Map());
  /** Panneau paramètres du graphique cumulé (ouvert/fermé). */
  const [cumulativeChartFiltersOpen, setCumulativeChartFiltersOpen] = useState(() => {
    try {
      return localStorage.getItem(CUMULATIVE_CHART_FILTERS_OPEN) !== 'false';
    } catch {
      return true;
    }
  });
  /** Devise de l'axe Y du graphique cumulé (primaire du profil par défaut). */
  const [cumulativeChartYAxisCurrency, setCumulativeChartYAxisCurrency] = useState<string>(() => {
    try {
      return coerceDisplayCurrency(localStorage.getItem(CUMULATIVE_CHART_Y_AXIS_CURRENCY));
    } catch {
      return coerceDisplayCurrency(null);
    }
  });
  const yAxisCurrencies = displayCurrencyOptionsFromWorking();
  const yAxisCurrenciesKey = yAxisCurrencies.map((o) => o.value).join('|');
  useEffect(() => {
    setCumulativeChartYAxisCurrency((prev) => {
      const next = coerceDisplayCurrency(prev);
      if (next !== prev) {
        try {
          localStorage.setItem(CUMULATIVE_CHART_Y_AXIS_CURRENCY, next);
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, [yAxisCurrenciesKey]);
  const [cumulativeChartHeightPx, setCumulativeChartHeightPx] = useState(() => {
    try {
      const v = localStorage.getItem(CUMULATIVE_CHART_HEIGHT_PX);
      const n = v != null ? parseInt(v, 10) : NaN;
      return Number.isFinite(n) && n >= 200 && n <= 800 ? n : 280;
    } catch {
      return 280;
    }
  });
  const [overviewFiltersOpen, setOverviewFiltersOpen] = useState(() => {
    try {
      return localStorage.getItem(OVERVIEW_FILTERS_OPEN) !== 'false';
    } catch {
      return true;
    }
  });
  const [overviewBarAverageEnabled, setOverviewBarAverageEnabled] = useState(
    () => loadOverviewBarToggles().average
  );
  const [overviewBarBudgetEnabled, setOverviewBarBudgetEnabled] = useState(
    () => loadOverviewBarToggles().budget
  );
  const [overviewAveragePeriod, setOverviewAveragePeriod] = useState<string>(() => {
    try {
      const v = localStorage.getItem(OVERVIEW_AVERAGE_PERIOD);
      const opts = AVERAGE_PERIOD_VALUES;
      return v && opts.includes(v) ? v : '3';
    } catch {
      return '3';
    }
  });
  const [overviewStatBarTooltip, setOverviewStatBarTooltip] = useState<{
    left: number;
    top: number;
    content: React.ReactNode;
  } | null>(null);
  const [sectionChartExpanded, setSectionChartExpanded] = useState(() =>
    loadMonthlySectionExpanded(SECTION_MONTHLY_CHART, true)
  );
  const [sectionOverviewExpanded, setSectionOverviewExpanded] = useState(() =>
    loadMonthlySectionExpanded(SECTION_MONTHLY_OVERVIEW, true)
  );
  const [sectionTableExpanded, setSectionTableExpanded] = useState(() =>
    loadMonthlySectionExpanded(SECTION_MONTHLY_TABLE, true)
  );
  const chartTooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOverviewStatBarTooltip(null);
  }, [selectedMonth, sectionOverviewExpanded]);

  useEffect(() => {
    const clear = () => setOverviewStatBarTooltip(null);
    document.addEventListener('scroll', clear, true);
    return () => document.removeEventListener('scroll', clear, true);
  }, []);

  const [availableMonthKeys, setAvailableMonthKeys] = useState<string[]>([]);
  const [monthlyTotalsRaw, setMonthlyTotalsRaw] = useState<MonthlyTotalDto[]>([]);

  /** Lecture mensuelle (pas de full load). Édition charge le jeu complet à part. */
  const loadViewData = useCallback(async (monthKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const [keys, totals, monthData] = await Promise.all([
        SourceDataCSVService.getMonthKeys(),
        SourceDataCSVService.getMonthlyTotals(),
        monthKey ? SourceDataCSVService.loadByMonth(monthKey) : Promise.resolve(null),
      ]);
      setAvailableMonthKeys(keys?.monthKeys ?? []);
      setMonthlyTotalsRaw(totals ?? []);
      if (monthData?.headers?.length) {
        setData(monthData);
      } else {
        setData({
          headers: [...TRANSACTION_SOURCE_HEADERS],
          rows: [],
        });
      }
      if (!(keys?.monthKeys?.length) && !(monthData?.rows?.length)) {
        setError(t('monthlyAccounting.errors.fileMissing', { path: SOURCE_DATA_PATH }));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('transactions.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (editMode) return;
    void loadViewData(selectedMonth);
  }, [selectedMonth, editMode, loadViewData]);

  /** Synchronise rowsExcludedFromAnomaly avec la colonne Exclure_anomalie au chargement. */
  useEffect(() => {
    if (!data?.rows) {
      setRowsExcludedFromAnomaly(new Set());
      return;
    }
    const excluded = new Set<number>();
    data.rows.forEach((row, i) => {
      const v = (row[EXCLUDE_ANOMALY_COLUMN] ?? '').trim().toLowerCase();
      if (v === '1' || v === 'oui' || v === 'true' || v === 'yes') excluded.add(i);
    });
    setRowsExcludedFromAnomaly(excluded);
  }, [data?.rows]);

  const dateColumn = useMemo(
    () => data?.headers.find((h) => /date/i.test(h)) ?? null,
    [data?.headers]
  );

  const normalizeHeaderKey = useCallback((header: string) => {
    return header
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
      .replace(/_+/g, '_');
  }, []);

  const isHiddenMonthlyColumn = useCallback(
    (header: string) => {
      const key = normalizeHeaderKey(header);
      if (key === 'soutien_ignorer') return true;
      if (key === 'projet') return editMode;
      return false;
    },
    [normalizeHeaderKey, editMode]
  );

  const displayHeaders = useMemo(
    () =>
      (data?.headers ?? []).filter(
        (h) =>
          h !== EXCLUDE_ANOMALY_COLUMN &&
          !/^source$/i.test(h) &&
          !isHiddenMonthlyColumn(h)
      ),
    [data?.headers, isHiddenMonthlyColumn]
  );

  const resizableColumnDefs = useMemo((): ResizableColumnDef[] => {
    const cols: ResizableColumnDef[] = displayHeaders.map((h) => ({
      key: h,
      defaultWidth: defaultEditColumnWidth(h),
    }));
    if (editMode) {
      cols.push(
        { key: '__duplicate__', defaultWidth: 72, resizable: false },
        { key: '__exclude_anomaly__', defaultWidth: 120, resizable: false },
        { key: '__delete__', defaultWidth: 130, resizable: false }
      );
    }
    return cols;
  }, [displayHeaders, editMode]);

  const {
    getWidth: getColWidth,
    handleResizeStart: handleColResizeStart,
    resetWidths: resetColWidths,
    hasCustomWidths: hasCustomColWidths,
  } = useResizableTableColumns(MA_TABLE_COL_WIDTHS_KEY, resizableColumnDefs, editMode);

  /** Mois présents dans les données (année-mois), du plus récent au plus ancien. */
  const availableMonths = useMemo(() => {
    if (availableMonthKeys.length > 0) {
      return [...availableMonthKeys].sort((a, b) => b.localeCompare(a));
    }
    if (!data?.rows?.length || !dateColumn) return [];
    const set = new Set<string>();
    for (const row of data.rows) {
      const d = parseDateFromCell(row[dateColumn] ?? '');
      if (d) set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [availableMonthKeys, data?.rows, dateColumn]);

  /** Mois suivant le plus récent dans les données (ou mois courant si aucune donnée). */
  const nextMonth = useMemo(() => {
    const now = new Date();
    if (availableMonths.length === 0) {
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const [y, m] = availableMonths[0].split('-').map(Number);
    const next = new Date(y, m, 1); // 1er du mois suivant
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  }, [availableMonths]);

  /** Mois sélectionnables : ceux des données + le mois suivant s'il n'y est pas. */
  const selectableMonths = useMemo(() => {
    const list = [...availableMonths];
    if (availableMonths.length === 0 || !availableMonths.includes(nextMonth)) {
      list.unshift(nextMonth);
    }
    return list.sort((a, b) => b.localeCompare(a));
  }, [availableMonths, nextMonth]);

  /** Initialiser selectedMonth au premier mois sélectionnable si vide ou invalide (après chargement des données). */
  useEffect(() => {
    // Tant que les données ne sont pas chargées, `selectableMonths` ne reflète qu’un mois par défaut (ex. mois courant) :
    // appliquer la correction ici écraserait le mois lu dans localStorage à chaque retour sur la page.
    if (loading) return;
    if (selectableMonths.length === 0) return;
    const valid = selectableMonths.includes(selectedMonth);
    if (!selectedMonth || !valid) {
      const next = selectableMonths[0];
      setSelectedMonth(next);
      try {
        localStorage.setItem(MONTH_STORAGE_KEY, next);
      } catch {}
    }
  }, [selectableMonths, selectedMonth, loading]);

  const handleMonthChange = (value: string) => {
    setSelectedMonth(value);
    try {
      localStorage.setItem(MONTH_STORAGE_KEY, value);
    } catch {}
  };

  const handleAddNextMonth = () => {
    setSelectedMonth(nextMonth);
    try {
      localStorage.setItem(MONTH_STORAGE_KEY, nextMonth);
    } catch {}
  };

  const rowsForMonth = useMemo(() => {
    if (!data?.rows?.length || !selectedMonth) return [];
    if (!editMode) return data.rows;
    if (!dateColumn) return [];
    const [y, m] = selectedMonth.split('-').map(Number);
    return data.rows.filter((row) => {
      const d = parseDateFromCell(row[dateColumn] ?? '');
      if (!d) return false;
      return d.getFullYear() === y && d.getMonth() + 1 === m;
    });
  }, [data?.rows, dateColumn, selectedMonth, editMode]);

  /** Indices 0-based dans le fichier source (Index DB), pour le rapport d'anomalies. */
  const rowsForMonthIndicesInSource = useMemo(() => {
    return rowsForMonth.map((row, i) => {
      const idx = parseInt(String(row.Index ?? row.INDEX ?? '').trim(), 10);
      return Number.isFinite(idx) && idx > 0 ? idx - 1 : i;
    });
  }, [rowsForMonth]);

  const sortedRows = useMemo(() => {
    if (!sortColumn || !displayHeaders.includes(sortColumn)) return rowsForMonth;
    return [...rowsForMonth].sort((a, b) => {
      const va = getCompareValue(sortColumn, a[sortColumn] ?? '');
      const vb = getCompareValue(sortColumn, b[sortColumn] ?? '');
      const na = typeof va === 'number';
      const nb = typeof vb === 'number';
      let cmp: number;
      if (na && nb) cmp = (va as number) - (vb as number);
      else if (na) cmp = -1;
      else if (nb) cmp = 1;
      else cmp = String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [rowsForMonth, sortColumn, sortDirection, displayHeaders]);

  /** Anomalies pour le mois courant (clé = index dans data.rows, comme le rapport CSV). */
  const monthlyAnomalyByDataRowIndex = useMemo(() => {
    if (!data?.headers?.length || rowsForMonth.length === 0) return new Map<number, string>();
    const monthData: SourceDataResult = {
      headers: data.headers,
      rows: rowsForMonth,
      rowIndicesInSource: rowsForMonthIndicesInSource,
    };
    const { anomalies } = detectAnomalies(monthData);
    const map = new Map<number, string>();
    for (const a of anomalies) {
      map.set(a.rowIndex - 1, formatAnomalyReasons(a.reasons, t));
    }
    return map;
  }, [data?.headers, rowsForMonth, rowsForMonthIndicesInSource, t, i18n.language]);

  useEffect(() => {
    if (!editMode) setEditShowAnomaliesOnly(false);
  }, [editMode]);

  useLayoutEffect(() => {
    const curr = monthlyAnomalyByDataRowIndex;
    if (!editMode) {
      setAnomalyFilterStickyIndices((s) => (s.size === 0 ? s : new Set()));
      prevMonthlyAnomalyMapForFilterRef.current = new Map(curr);
      return;
    }
    if (!editShowAnomaliesOnly) {
      prevMonthlyAnomalyMapForFilterRef.current = new Map(curr);
      return;
    }
    const prev = prevMonthlyAnomalyMapForFilterRef.current;
    setAnomalyFilterStickyIndices((sticky) => {
      const next = new Set(sticky);
      for (const idx of prev.keys()) {
        if (prev.has(idx) && !curr.has(idx)) {
          next.add(idx);
        }
      }
      return next;
    });
    prevMonthlyAnomalyMapForFilterRef.current = new Map(curr);
  }, [monthlyAnomalyByDataRowIndex, editMode, editShowAnomaliesOnly]);

  const displayRows = useMemo(() => {
    if (!editMode || !editShowAnomaliesOnly) return sortedRows;
    return sortedRows.filter((row) => {
      const dataRowIndex = data?.rows.findIndex((r) => r === row) ?? -1;
      if (dataRowIndex < 0) return false;
      return (
        monthlyAnomalyByDataRowIndex.has(dataRowIndex) ||
        anomalyFilterStickyIndices.has(dataRowIndex)
      );
    });
  }, [
    editMode,
    editShowAnomaliesOnly,
    sortedRows,
    data?.rows,
    monthlyAnomalyByDataRowIndex,
    anomalyFilterStickyIndices,
  ]);

  /** Colonne AMOUNT GBP (négatif = dépense, positif = revenu) et Title pour le graphique cumulé. */
  const amountCol = useMemo(
    () => data?.headers.find((h) => /^amount\s*gbp$/i.test(h)) ?? null,
    [data?.headers]
  );
  const titleCol = useMemo(
    () => data?.headers.find((h) => /^title$/i.test(h)) ?? null,
    [data?.headers]
  );
  const typeCol = useMemo(
    () => data?.headers.find((h) => /^type$/i.test(h)) ?? null,
    [data?.headers]
  );

  /** Résultats et statistiques du mois : totaux entrées/sorties/balance et cumuls par type. */
  const overviewData = useMemo(() => {
    if (!selectedMonth || !amountCol) return null;
    const c = cumulativeChartYAxisCurrency as CurrencySymbol;
    let totalEntrées = 0;
    let totalSorties = 0;
    const byTypeSorties: Record<string, number> = {};
    const byTypeEntrées: Record<string, number> = {};
    for (const row of rowsForMonth) {
      const amount = parseAmountCell(row[amountCol] ?? '');
      const typeLabel = (typeCol ? (row[typeCol] ?? '') : '').trim() || '—';
      if (amount < 0) {
        const amt = convertMovementsToDisplayCurrency(Math.abs(amount), c);
        totalSorties += amt;
        byTypeSorties[typeLabel] = (byTypeSorties[typeLabel] ?? 0) + amt;
      }
      if (amount > 0) {
        const amt = convertMovementsToDisplayCurrency(amount, c);
        totalEntrées += amt;
        byTypeEntrées[typeLabel] = (byTypeEntrées[typeLabel] ?? 0) + amt;
      }
    }
    return {
      totalEntrées,
      totalSorties,
      balance: totalEntrées - totalSorties,
      byTypeSorties: Object.entries(byTypeSorties).sort((a, b) => b[1] - a[1]),
      byTypeEntrées: Object.entries(byTypeEntrées).sort((a, b) => b[1] - a[1]),
    };
  }, [selectedMonth, rowsForMonth, amountCol, typeCol, cumulativeChartYAxisCurrency]);

  /** Dernière date de transaction parmi les lignes du mois (résultats et statistiques). */
  const overviewLastTransactionDate = useMemo(() => {
    if (!dateColumn || rowsForMonth.length === 0) return null;
    let max: Date | null = null;
    for (const row of rowsForMonth) {
      const d = parseDateFromCell(row[dateColumn] ?? '');
      if (!d) continue;
      if (!max || d.getTime() > max.getTime()) max = d;
    }
    return max;
  }, [dateColumn, rowsForMonth]);

  const [budgetSnapshot, setBudgetSnapshot] = useState<YearSnapshot | null>(null);
  useEffect(() => {
    const y = selectedMonth ? parseInt(selectedMonth.split('-')[0], 10) : NaN;
    if (Number.isNaN(y)) {
      setBudgetSnapshot(null);
      return;
    }
    setBudgetSnapshot(getYearSnapshot(y));
  }, [selectedMonth]);
  useEffect(() => {
    const handler = () => {
      const y = selectedMonth ? parseInt(selectedMonth.split('-')[0], 10) : NaN;
      if (!Number.isNaN(y)) setBudgetSnapshot(getYearSnapshot(y));
    };
    window.addEventListener('annual-budget-snapshot-changed', handler);
    return () => window.removeEventListener('annual-budget-snapshot-changed', handler);
  }, [selectedMonth]);

  /** Totaux par mois (et par type) pour calcul des moyennes — depuis IPC (GBP → devise affichage). */
  const monthlyTotals = useMemo(() => {
    const c = cumulativeChartYAxisCurrency as CurrencySymbol;
    const map = new Map<
      string,
      { entrées: number; sorties: number; byTypeSorties: Record<string, number>; byTypeEntrées: Record<string, number> }
    >();
    for (const tot of monthlyTotalsRaw) {
      const byTypeSorties: Record<string, number> = {};
      const byTypeEntrées: Record<string, number> = {};
      Object.entries(tot.byTypeSorties).forEach(([type, val]) => {
        byTypeSorties[type] = convertMovementsToDisplayCurrency(val, c);
      });
      Object.entries(tot.byTypeEntrées).forEach(([type, val]) => {
        byTypeEntrées[type] = convertMovementsToDisplayCurrency(val, c);
      });
      map.set(tot.monthKey, {
        entrées: convertMovementsToDisplayCurrency(tot.entrées, c),
        sorties: convertMovementsToDisplayCurrency(tot.sorties, c),
        byTypeSorties,
        byTypeEntrées,
      });
    }
    return map;
  }, [monthlyTotalsRaw, cumulativeChartYAxisCurrency]);

  /** Référence pour les barres (moyenne des N mois passés, hors mois courant), totaux et par type. */
  const overviewAverageReference = useMemo(() => {
    if (!selectedMonth || !overviewBarAverageEnabled) return null;
    const n = parseInt(overviewAveragePeriod, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    const [y, m] = selectedMonth.split('-').map(Number);
    let sumE = 0;
    let sumS = 0;
    let count = 0;
    const sumByTypeSorties: Record<string, number> = {};
    const sumByTypeEntrées: Record<string, number> = {};
    for (let i = 1; i <= n; i++) {
      let mm = m - i;
      let yy = y;
      while (mm <= 0) {
        mm += 12;
        yy -= 1;
      }
      const key = `${yy}-${String(mm).padStart(2, '0')}`;
      const tot = monthlyTotals.get(key);
      if (tot) {
        sumE += tot.entrées;
        sumS += tot.sorties;
        count += 1;
        Object.entries(tot.byTypeSorties).forEach(([type, val]) => {
          sumByTypeSorties[type] = (sumByTypeSorties[type] ?? 0) + val;
        });
        Object.entries(tot.byTypeEntrées).forEach(([type, val]) => {
          sumByTypeEntrées[type] = (sumByTypeEntrées[type] ?? 0) + val;
        });
      }
    }
    if (count === 0) return null;
    const byTypeSortiesAvg: Record<string, number> = {};
    const byTypeEntréesAvg: Record<string, number> = {};
    Object.entries(sumByTypeSorties).forEach(([type, s]) => {
      byTypeSortiesAvg[type] = s / count;
    });
    Object.entries(sumByTypeEntrées).forEach(([type, s]) => {
      byTypeEntréesAvg[type] = s / count;
    });
    return {
      entrées: sumE / count,
      sorties: sumS / count,
      balance: (sumE - sumS) / count,
      byTypeSortiesAvg,
      byTypeEntréesAvg,
    };
  }, [selectedMonth, overviewBarAverageEnabled, overviewAveragePeriod, monthlyTotals]);

  /** Référence (moyenne) pour afficher les barres « moyenne des mois passés ». */
  const overviewReference = overviewBarAverageEnabled ? overviewAverageReference : null;

  /** Données pour le graphique de suivi cumulé : par jour du mois, cumul des sorties et des entrées. */
  const cumulativeChartData = useMemo(() => {
    if (!dateColumn || !amountCol || !selectedMonth) return null;
    const [y, m] = selectedMonth.split('-').map(Number);
    const daysInMonth = new Date(y, m - 1 + 1, 0).getDate();
    const dailySorties: number[] = new Array(daysInMonth + 1).fill(0);
    const dailyEntrées: number[] = new Array(daysInMonth + 1).fill(0);
    for (const row of rowsForMonth) {
      const d = parseDateFromCell(row[dateColumn] ?? '');
      if (!d) continue;
      const day = d.getDate();
      if (day < 1 || day > daysInMonth) continue;
      const amount = parseAmountCell(row[amountCol] ?? '');
      if (amount < 0) dailySorties[day] += Math.abs(amount);
      if (amount > 0) dailyEntrées[day] += amount;
    }
    const cumSorties: number[] = [];
    const cumEntrées: number[] = [];
    let s = 0;
    let e = 0;
    for (let i = 1; i <= daysInMonth; i++) {
      s += dailySorties[i];
      e += dailyEntrées[i];
      cumSorties.push(s);
      cumEntrées.push(e);
    }
    const labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
    return { labels, cumSorties, cumEntrées, daysInMonth };
  }, [dateColumn, amountCol, selectedMonth, rowsForMonth]);

  /** Données cumulées converties dans la devise d'affichage (axe Y). */
  const cumulativeChartDataDisplay = useMemo(() => {
    if (!cumulativeChartData) return null;
    const c = cumulativeChartYAxisCurrency as CurrencySymbol;
    return {
      ...cumulativeChartData,
      cumSorties: cumulativeChartData.cumSorties.map((v) => convertMovementsToDisplayCurrency(v, c)),
      cumEntrées: cumulativeChartData.cumEntrées.map((v) => convertMovementsToDisplayCurrency(v, c)),
    };
  }, [cumulativeChartData, cumulativeChartYAxisCurrency]);

  /** Par jour du mois (index 0 = jour 1) : liste des mouvements { label, amount (devise affichage), isIncome }. */
  const movementsByDay = useMemo(() => {
    if (!dateColumn || !amountCol || !selectedMonth || !cumulativeChartData) return [];
    const daysInMonth = cumulativeChartData.daysInMonth;
    const c = cumulativeChartYAxisCurrency as CurrencySymbol;
    const byDay: { label: string; amount: number; isIncome: boolean }[][] = Array.from(
      { length: daysInMonth },
      () => []
    );
    for (const row of rowsForMonth) {
      const d = parseDateFromCell(row[dateColumn] ?? '');
      if (!d) continue;
      const day = d.getDate();
      if (day < 1 || day > daysInMonth) continue;
      const label = (titleCol ? (row[titleCol] ?? '').trim() : '') || t('monthlyAccounting.chart.noLabel');
      const amount = parseAmountCell(row[amountCol] ?? '');
      if (amount < 0) {
        byDay[day - 1].push({
          label,
          amount: convertMovementsToDisplayCurrency(Math.abs(amount), c),
          isIncome: false,
        });
      }
      if (amount > 0) {
        byDay[day - 1].push({
          label,
          amount: convertMovementsToDisplayCurrency(amount, c),
          isIncome: true,
        });
      }
    }
    return byDay;
  }, [
    dateColumn,
    amountCol,
    titleCol,
    selectedMonth,
    cumulativeChartData,
    rowsForMonth,
    cumulativeChartYAxisCurrency,
    t,
  ]);

  /** Tooltip HTML externe : affiche la date et la liste des mouvements du jour. */
  const externalTooltipHandler = useCallback(
    (context: { chart: unknown; tooltip: { opacity: number; caretX: number; caretY: number; dataPoints?: { dataIndex: number }[] } }) => {
      const el = chartTooltipRef.current;
      if (!el) return;
      const { tooltip } = context;
      if (tooltip.opacity === 0) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        return;
      }
      const dataIndex = tooltip.dataPoints?.[0]?.dataIndex ?? 0;
      const day = dataIndex + 1;
      const [y, m] = (selectedMonth ?? '').split('-').map(Number);
      const dateStr =
        y && m
          ? `${String(day).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`
          : String(day);
      const movements = movementsByDay[dataIndex] ?? [];
      const currency = cumulativeChartYAxisCurrency;
      const lines = movements.map((mov) => {
        const sign = mov.isIncome ? '+' : '−';
        const amt = formatCurrency(mov.amount, currency);
        return `${escapeHtml(mov.label)} ${sign}${amt}`;
      });
      const movementsContent =
        lines.length > 0
          ? lines.join('<br/>')
          : t('monthlyAccounting.chart.noMovementsDay');
      const cumEntrées = cumulativeChartDataDisplay?.cumEntrées[dataIndex] ?? 0;
      const cumSorties = cumulativeChartDataDisplay?.cumSorties[dataIndex] ?? 0;
      const balance = cumEntrées - cumSorties;
      const cumEntréesStr = t('monthlyAccounting.chart.tooltipCumulEntries', {
        amount: `+${formatCurrency(cumEntrées, currency)}`,
      });
      const cumSortiesStr = t('monthlyAccounting.chart.tooltipCumulExits', {
        amount: `−${formatCurrency(cumSorties, currency)}`,
      });
      const balanceStr = t('monthlyAccounting.chart.tooltipBalance', {
        amount: `${balance >= 0 ? '+' : '−'}${formatCurrency(Math.abs(balance), currency)}`,
      });
      const separator = '<div class="border-t border-gray-600 my-1.5"></div>';
      const cumulBlock = [
        `<span class="text-green-400">${cumEntréesStr}</span>`,
        `<span class="text-red-400">${cumSortiesStr}</span>`,
        `<span class="${balance >= 0 ? 'text-green-400' : 'text-red-400'}">${balanceStr}</span>`,
      ].join('<br/>');
      el.innerHTML = [
        `<div class="font-semibold border-b border-gray-600 pb-1 mb-1">${escapeHtml(dateStr)}</div>`,
        separator,
        `<div class="whitespace-normal">${cumulBlock}</div>`,
        separator,
        `<div class="whitespace-normal text-gray-300">${movementsContent}</div>`,
      ].join('');
      el.style.opacity = '1';
      el.style.pointerEvents = 'none';

      const canvas = (context.chart as { canvas?: HTMLCanvasElement }).canvas;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        let leftPx = rect.left + tooltip.caretX;
        let topPx = rect.top + tooltip.caretY;
        el.style.position = 'fixed';
        el.style.left = `${leftPx}px`;
        el.style.top = `${topPx}px`;
        el.style.transform = 'translate(-50%, -100%) translateY(-8px)';
        // Mesurer après rendu pour garder le tooltip dans la fenêtre
        const w = el.offsetWidth;
        const h = el.offsetHeight;
        const pad = 8;
        if (leftPx - w / 2 < pad) leftPx = pad + w / 2;
        if (leftPx + w / 2 > window.innerWidth - pad) leftPx = window.innerWidth - pad - w / 2;
        const topEdge = topPx - h - 8;
        const bottomSpace = window.innerHeight - (topPx + 8);
        if (topEdge < pad && bottomSpace > h + pad) {
          topPx = rect.top + tooltip.caretY + 8;
          el.style.transform = 'translate(-50%, 0) translateY(8px)';
        } else if (topEdge < pad) {
          topPx = pad + h + 8;
        } else if (topPx + 8 > window.innerHeight - pad) {
          topPx = window.innerHeight - pad - h - 8;
        }
        el.style.left = `${leftPx}px`;
        el.style.top = `${topPx}px`;
      }
    },
    [selectedMonth, movementsByDay, cumulativeChartYAxisCurrency, cumulativeChartDataDisplay, t]
  );

  const handleSort = (header: string) => {
    if (sortColumn === header) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(header);
      setSortDirection('asc');
    }
  };

  const selectedMonthLabel = useMemo(() => {
    if (!selectedMonth) return '';
    const [y, m] = selectedMonth.split('-').map(Number);
    return formatMonthLabel(y, m, dateLocale);
  }, [selectedMonth, dateLocale]);

  const handleDetectAnomalies = async () => {
    if (!data || !selectedMonth || rowsForMonth.length === 0) {
      setAnomalyMessage(t('monthlyAccounting.anomaly.selectMonth'));
      return;
    }
    const api = (window as unknown as {
      electronAPI?: { writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }> };
    }).electronAPI;
    if (!api?.writeFile) {
      setAnomalyMessage(t('monthlyAccounting.errors.writeUnavailable'));
      return;
    }
    setAnomalyLoading(true);
    setAnomalyMessage(null);
    try {
      const monthData: SourceDataResult = {
        headers: data.headers,
        rows: rowsForMonth,
        rowIndicesInSource: rowsForMonthIndicesInSource,
      };
      const { anomalies, csvContent } = detectAnomalies(monthData);
      const writeResult = await api.writeFile(MONTHLY_ANOMALY_REPORT_PATH, csvContent);
      if (writeResult.success) {
        setAnomalyMessage(
          anomalies.length === 0
            ? t('monthlyAccounting.anomaly.noneFound')
            : t('monthlyAccounting.anomaly.found', { count: anomalies.length })
        );
      } else {
        setAnomalyMessage(writeResult.error ?? t('monthlyAccounting.errors.writeReport'));
      }
    } finally {
      setAnomalyLoading(false);
    }
  };

  const handleOpenMonthlyAnomalyReport = async () => {
    const api = (window as unknown as { electronAPI?: { openMonthlyAnomalyReport: () => Promise<{ success: boolean; error?: string }> } }).electronAPI;
    if (!api?.openMonthlyAnomalyReport) return;
    const result = await api.openMonthlyAnomalyReport();
    if (!result.success && result.error) {
      setAnomalyMessage(result.error);
    }
  };

  const performExitEditMode = useCallback(() => {
    editSessionBaselineRef.current = null;
    setRowsToDelete(new Set());
    setRowsExcludedFromAnomaly(new Set());
    setNewRowDrafts([{}]);
    setEditMode(false);
    setSaveMessage(null);
    setEditExitConfirmOpen(false);
    void loadViewData(selectedMonth);
  }, [loadViewData, selectedMonth]);

  const handleToggleEditMode = () => {
    if (!editMode) {
      void (async () => {
        setLoading(true);
        setSaveMessage(null);
        try {
          if (!selectedMonth) {
            setError(t('monthlyAccounting.errors.selectMonthBeforeEdit'));
            return;
          }
          const monthData = await SourceDataCSVService.loadByMonth(selectedMonth);
          if (!monthData) {
            setError(t('monthlyAccounting.errors.fileMissing', { path: SOURCE_DATA_PATH }));
            return;
          }
          setData(monthData);
          editSessionBaselineRef.current = {
            data: cloneSourceDataResult(monthData),
            rowsToDelete: new Set(),
            rowsExcludedFromAnomaly: new Set(),
            newRowDrafts: [{}],
          };
          setRowsToDelete(new Set());
          setRowsExcludedFromAnomaly(new Set());
          setNewRowDrafts([{}]);
          setEditMode(true);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : t('transactions.edit.loadFailed'));
        } finally {
          setLoading(false);
        }
      })();
    } else {
      if (
        data &&
        editSessionBaselineRef.current &&
        isMonthlyEditSessionDirty(
          data,
          rowsToDelete,
          rowsExcludedFromAnomaly,
          newRowDrafts,
          editSessionBaselineRef.current
        )
      ) {
        setEditExitConfirmOpen(true);
        return;
      }
      performExitEditMode();
    }
  };
  const handleSaveSourceData = async () => {
    if (!data || !selectedMonth) return;
    setSaveLoading(true);
    setSaveMessage(null);
    try {
      const headers = data.headers.includes(EXCLUDE_ANOMALY_COLUMN)
        ? data.headers
        : [...data.headers, EXCLUDE_ANOMALY_COLUMN];
      const rowsWithExclusion = data.rows.map((row, i) => ({
        ...row,
        [EXCLUDE_ANOMALY_COLUMN]: rowsExcludedFromAnomaly.has(i) ? '1' : '',
      }));
      let rowsToKeep = rowsWithExclusion.filter((_, index) => !rowsToDelete.has(index));
      for (const draft of newRowDrafts) {
        const hasContent = Object.values(draft).some((v) => (v ?? '').trim() !== '');
        if (hasContent) {
          const newRow = headers.reduce<Record<string, string>>((acc, h) => {
            acc[h] = h === EXCLUDE_ANOMALY_COLUMN ? '' : (draft[h] ?? '').trim();
            return acc;
          }, {});
          rowsToKeep = [...rowsToKeep, newRow as (typeof rowsToKeep)[number]];
        }
      }
      const stripped = stripSourceColumnFromSourceData({
        headers: headers.some((h) => /^index$/i.test(h)) ? headers : ['Index', ...headers],
        rows: rowsToKeep,
      });
      const result = await SourceDataCSVService.mergeMonthEdit(selectedMonth, stripped.rows);
      if (result.success) {
        setRowsToDelete(new Set());
        setNewRowDrafts([{}]);
        setRowsExcludedFromAnomaly(new Set());
        setEditShowAnomaliesOnly(false);
        setAnomalyFilterStickyIndices(new Set());
        setEditExitConfirmOpen(false);
        const monthData = await SourceDataCSVService.loadByMonth(selectedMonth);
        if (monthData) {
          setData(monthData);
          editSessionBaselineRef.current = {
            data: cloneSourceDataResult(monthData),
            rowsToDelete: new Set(),
            rowsExcludedFromAnomaly: new Set(),
            newRowDrafts: [{}],
          };
        }
        setSaveMessage(
          t('monthlyAccounting.edit.monthSaved', { month: selectedMonth, count: result.count })
        );
      } else {
        setSaveMessage(result.error ?? t('monthlyAccounting.errors.save'));
      }
    } finally {
      setSaveLoading(false);
    }
  };

  const handleRefreshSourceDataCsv = useCallback(async () => {
    if (editMode) {
      setReorderChronoMessage(t('monthlyAccounting.refresh.exitEditWarning'));
      return;
    }
    setReorderChronoLoading(true);
    setReorderChronoMessage(null);
    try {
      const result = await SourceDataCSVService.refreshGbpRates(getEffectiveRates());
      if (result.success) {
        await loadViewData(selectedMonth);
        setReorderChronoMessage(
          t('transactions.refresh.result', {
            rowCount: result.rowCount,
            updatedCount: result.updatedCount,
          })
        );
      } else {
        setReorderChronoMessage(result.error ?? t('monthlyAccounting.errors.save'));
      }
    } catch (e) {
      setReorderChronoMessage(e instanceof Error ? e.message : t('transactions.refresh.failed'));
    } finally {
      setReorderChronoLoading(false);
    }
  }, [editMode, loadViewData, selectedMonth, t]);

  const handleCellChange = useCallback(
    (dataRowIndex: number, header: string, value: string) => {
      setData((prev) => {
        if (!prev) return prev;
        const amountHeader = prev.headers.find((h) => /^amount$/i.test(h)) ?? null;
        const currencyHeader = prev.headers.find((h) => /^currency$/i.test(h)) ?? null;
        const amountGbpHeader = prev.headers.find((h) => isAmountIndicatorHeader(h)) ?? null;
        return {
          ...prev,
          rows: prev.rows.map((row, i) => {
            if (i !== dataRowIndex) return row;
            const next = { ...row, [header]: value };
            if (amountHeader && currencyHeader && amountGbpHeader) {
              syncTransactionAmountCurrencyOnEdit(
                next,
                header,
                amountHeader,
                currencyHeader,
                amountGbpHeader
              );
            }
            return next;
          }),
        };
      });
    },
    []
  );

  const handleToggleRowDelete = useCallback((dataRowIndex: number) => {
    setRowsToDelete((prev) => {
      const next = new Set(prev);
      if (next.has(dataRowIndex)) next.delete(dataRowIndex);
      else next.add(dataRowIndex);
      return next;
    });
  }, []);

  const handleToggleExcludeAnomaly = useCallback((dataRowIndex: number) => {
    setData((prev) => {
      if (!prev) return prev;
      const row = prev.rows[dataRowIndex];
      if (!row) return prev;
      const v = (row[EXCLUDE_ANOMALY_COLUMN] ?? '').trim().toLowerCase();
      const currentlyExcluded =
        v === '1' || v === 'oui' || v === 'true' || v === 'yes';
      const nextExcluded = !currentlyExcluded;
      const headers = prev.headers.includes(EXCLUDE_ANOMALY_COLUMN)
        ? prev.headers
        : [...prev.headers, EXCLUDE_ANOMALY_COLUMN];
      return {
        ...prev,
        headers,
        rows: prev.rows.map((r, i) =>
          i === dataRowIndex
            ? { ...r, [EXCLUDE_ANOMALY_COLUMN]: nextExcluded ? '1' : '' }
            : r
        ),
      };
    });
    setRowsExcludedFromAnomaly((prev) => {
      const next = new Set(prev);
      if (next.has(dataRowIndex)) next.delete(dataRowIndex);
      else next.add(dataRowIndex);
      return next;
    });
  }, []);

  const handleNewRowDraftChange = useCallback(
    (draftIndex: number, header: string, value: string) => {
      setNewRowDrafts((prev) => {
        const amountHeader = displayHeaders.find((h) => /^amount$/i.test(h));
        const currencyHeader = displayHeaders.find((h) => /^currency$/i.test(h));
        const amountGbpHeader = displayHeaders.find((h) => isAmountIndicatorHeader(h));
        return prev.map((d, i) => {
          if (i !== draftIndex) return d;
          const next = { ...d, [header]: value };
          if (amountHeader && currencyHeader && amountGbpHeader) {
            syncTransactionAmountCurrencyOnEdit(
              next,
              header,
              amountHeader,
              currencyHeader,
              amountGbpHeader
            );
          }
          return next;
        });
      });
    },
    [displayHeaders]
  );

  const handleAddNewDraftRow = useCallback(() => {
    setNewRowDrafts((prev) => [...prev, {}]);
  }, []);

  const handleDuplicateRow = useCallback((row: Record<string, string>) => {
    const draft: Record<string, string> = {};
    displayHeaders.forEach((h) => {
      if (!/^index$/i.test(h)) draft[h] = row[h] ?? '';
    });
    setNewRowDrafts((prev) => [...prev.slice(0, -1), draft, {}]);
  }, [displayHeaders]);

  return (
    <>
      <main className="flex-1 flex flex-col min-w-0 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <h1 className="text-2xl font-bold text-gray-800">{t('nav.monthlyAccounting')}</h1>
          {data && selectableMonths.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="monthly-accounting-month" className="text-sm font-medium text-gray-700">
                {t('monthlyAccounting.month.selected')}
              </label>
              <select
                id="monthly-accounting-month"
                value={selectedMonth}
                onChange={(e) => handleMonthChange(e.target.value)}
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[180px]"
              >
                {selectableMonths.map((value) => {
                  const [y, m] = value.split('-').map(Number);
                  const isFuture = !availableMonths.includes(value);
                  return (
                    <option key={value} value={value}>
                      {formatMonthLabel(y, m, dateLocale)}{isFuture ? ` ${t('monthlyAccounting.month.noData')}` : ''}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={handleAddNextMonth}
                className="rounded border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500"
              >
                {t('monthlyAccounting.month.addNext')}
              </button>
              <span className="text-gray-500 text-sm">
                {t('monthlyAccounting.transactionCount', { count: sortedRows.length })}
              </span>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12 text-gray-500">
            {t('common.loading')}
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">
            {error}
          </div>
        )}

        {data && !loading && selectableMonths.length > 0 && selectedMonth && cumulativeChartDataDisplay && (
          <section
            className="flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden mb-6"
            style={{ minHeight: sectionChartExpanded ? Math.max(200, cumulativeChartHeightPx + 48) : undefined }}
          >
            <header
              className={`bg-gradient-to-br from-slate-50 to-white ${
                sectionChartExpanded ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
              }`}
            >
              <div className="flex items-stretch">
                <button
                  type="button"
                  className="flex-1 min-w-0 px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
                  onClick={() => {
                    setSectionChartExpanded((e) => {
                      const next = !e;
                      saveMonthlySectionExpanded(SECTION_MONTHLY_CHART, next);
                      return next;
                    });
                  }}
                  aria-expanded={sectionChartExpanded}
                >
                  <span
                    className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
                      sectionChartExpanded ? 'rotate-90' : ''
                    }`}
                    aria-hidden
                  >
                    ▶
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                      {t('monthlyAccounting.chart.title')}
                    </span>
                    <span className="block text-sm text-gray-500 mt-1.5">
                      {t('monthlyAccounting.chart.subtitle')}
                    </span>
                  </span>
                </button>
                <div className="flex items-center shrink-0 pr-3 sm:pr-4">
                  <button
                    type="button"
                    onClick={() => {
                      setCumulativeChartFiltersOpen((o) => {
                        const next = !o;
                        try {
                          localStorage.setItem(CUMULATIVE_CHART_FILTERS_OPEN, String(next));
                        } catch {}
                        return next;
                      });
                    }}
                    title={t('dashboard.settings.title')}
                    className={`flex-shrink-0 p-2 rounded-lg border transition-colors ${
                      cumulativeChartFiltersOpen
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
            {sectionChartExpanded && (
              <div className="px-4 pb-4 pt-3">
                <div className="flex gap-4 items-stretch">
                  {cumulativeChartFiltersOpen && (
                    <div className="flex-shrink-0 flex flex-col min-h-0 w-[200px]">
                      <div className="flex-1 flex flex-col min-h-0 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                        <button
                          type="button"
                          onClick={() => {
                            setCumulativeChartFiltersOpen(false);
                            try {
                              localStorage.setItem(CUMULATIVE_CHART_FILTERS_OPEN, 'false');
                            } catch {}
                          }}
                          className="flex-shrink-0 w-full px-3 py-2 text-left text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 flex items-center justify-between"
                        >
                          {t('dashboard.settings.title')}
                          <span className="text-gray-500">▼</span>
                        </button>
                        <div className="flex-1 min-h-0 flex flex-col p-3 gap-4 overflow-hidden">
                          <div className="flex-shrink-0">
                            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                              {t('monthlyAccounting.chart.axisCurrency')}
                            </label>
                            <select
                              value={cumulativeChartYAxisCurrency}
                              onChange={(e) => {
                                const v = coerceDisplayCurrency(e.target.value);
                                setCumulativeChartYAxisCurrency(v);
                                try {
                                  localStorage.setItem(CUMULATIVE_CHART_Y_AXIS_CURRENCY, v);
                                } catch {}
                              }}
                              className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800"
                            >
                              {yAxisCurrencies.map(({ value, label }) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex-shrink-0">
                            <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                              {t('dashboard.settings.chartHeight')}
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="range"
                                min={200}
                                max={800}
                                step={10}
                                value={cumulativeChartHeightPx}
                                onChange={(e) => {
                                  const v = parseInt(e.target.value, 10);
                                  if (Number.isFinite(v)) {
                                    setCumulativeChartHeightPx(v);
                                    try {
                                      localStorage.setItem(CUMULATIVE_CHART_HEIGHT_PX, String(v));
                                    } catch {}
                                  }
                                }}
                                className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-200 accent-blue-600"
                              />
                              <span className="text-sm text-gray-700 tabular-nums w-10">
                                {cumulativeChartHeightPx} px
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex-1 min-w-0 flex flex-col min-h-0">
                    <div className="relative" style={{ height: cumulativeChartHeightPx }}>
                <div
                  ref={chartTooltipRef}
                  className="absolute z-50 px-3 py-2 text-sm bg-gray-900/60 text-gray-100 rounded-lg shadow-lg border border-gray-700/80 min-w-[280px] max-w-[min(360px,90vw)] whitespace-normal backdrop-blur-sm"
                  style={{
                    opacity: 0,
                    transition: 'opacity 0.1s ease',
                    pointerEvents: 'none',
                  }}
                >
                  <div className="chart-tooltip-title font-semibold border-b border-gray-600 pb-1 mb-1" />
                  <div className="chart-tooltip-body whitespace-normal" />
                </div>
                <Line
                  data={{
                    labels: cumulativeChartDataDisplay.labels,
                    datasets: [
                      {
                        label: t('monthlyAccounting.series.cumulativeExits'),
                        data: cumulativeChartDataDisplay.cumSorties,
                        borderColor: '#dc2626',
                        backgroundColor: 'rgba(220, 38, 38, 0.25)',
                        fill: true,
                        tension: 0.2,
                        pointRadius: 2,
                        pointHoverRadius: 6,
                      },
                      {
                        label: t('monthlyAccounting.series.cumulativeEntries'),
                        data: cumulativeChartDataDisplay.cumEntrées,
                        borderColor: '#16a34a',
                        backgroundColor: 'rgba(22, 163, 74, 0.25)',
                        fill: true,
                        tension: 0.2,
                        pointRadius: 2,
                        pointHoverRadius: 6,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                      x: {
                        title: { display: true, text: t('monthlyAccounting.chart.xAxis'), font: { size: 12 }, color: '#374151' },
                        grid: { color: 'rgba(0, 0, 0, 0.06)' },
                        ticks: { maxRotation: 0, font: { size: 11 }, color: '#374151' },
                      },
                      y: {
                        title: {
                          display: true,
                          text: t('monthlyAccounting.chart.yAxis', { currency: cumulativeChartYAxisCurrency }),
                          font: { size: 12 },
                          color: '#374151',
                        },
                        grid: { color: 'rgba(0, 0, 0, 0.06)' },
                        ticks: {
                          font: { size: 11 },
                          color: '#374151',
                          callback: (value) =>
                            typeof value === 'number' ? formatCurrency(value, cumulativeChartYAxisCurrency) : value,
                        },
                        beginAtZero: true,
                      },
                    },
                    plugins: {
                      legend: {
                        position: 'top',
                        labels: { font: { size: 12 }, color: '#374151', usePointStyle: true },
                      },
                      tooltip: {
                        enabled: false,
                        external: externalTooltipHandler,
                      },
                    },
                  } as ChartOptions<'line'>}
                />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {data && !loading && selectedMonth && overviewData && (
          <section className="flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden mb-6">
            <header
              className={`bg-gradient-to-br from-slate-50 to-white ${
                sectionOverviewExpanded ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
              }`}
            >
              <div className="flex items-stretch">
                <button
                  type="button"
                  className="flex-1 min-w-0 px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
                  onClick={() => {
                    setSectionOverviewExpanded((e) => {
                      const next = !e;
                      saveMonthlySectionExpanded(SECTION_MONTHLY_OVERVIEW, next);
                      return next;
                    });
                  }}
                  aria-expanded={sectionOverviewExpanded}
                >
                  <span
                    className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
                      sectionOverviewExpanded ? 'rotate-90' : ''
                    }`}
                    aria-hidden
                  >
                    ▶
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                      {t('monthlyAccounting.overview.title')}
                    </span>
                    <span className="block text-sm text-gray-500 mt-1.5">
                      {overviewLastTransactionDate
                        ? t('monthlyAccounting.overview.resultAt', {
                            date: formatDateObjDDMMYYYY(overviewLastTransactionDate),
                          })
                        : t('monthlyAccounting.overview.resultNoTransactions')}
                    </span>
                  </span>
                </button>
                <div className="flex items-center shrink-0 pr-3 sm:pr-4">
                  <button
                    type="button"
                    onClick={() => {
                      setOverviewFiltersOpen((o) => {
                        const next = !o;
                        try {
                          localStorage.setItem(OVERVIEW_FILTERS_OPEN, String(next));
                        } catch {}
                        return next;
                      });
                    }}
                    title={t('dashboard.settings.title')}
                    className={`flex-shrink-0 p-2 rounded-lg border transition-colors ${
                      overviewFiltersOpen
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
            {sectionOverviewExpanded && (
              <div className="px-4 pb-4 pt-3">
                <div className="flex gap-4 items-stretch">
                  {overviewFiltersOpen && (
              <div className="flex-shrink-0 flex flex-col min-h-0 w-[200px]">
                <div className="flex-1 flex flex-col min-h-0 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
                  <button
                    type="button"
                    onClick={() => {
                      setOverviewFiltersOpen(false);
                      try {
                        localStorage.setItem(OVERVIEW_FILTERS_OPEN, 'false');
                      } catch {}
                    }}
                    className="flex-shrink-0 w-full px-3 py-2 text-left text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 flex items-center justify-between"
                  >
                    {t('dashboard.settings.title')}
                    <span className="text-gray-500">▼</span>
                  </button>
                  <div className="flex-1 min-h-0 flex flex-col p-3 gap-4 overflow-y-auto">
                    <div>
                      <span className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                        {t('monthlyAccounting.overview.fillBars')}
                      </span>
                      <div className="flex flex-col gap-2.5">
                        <label className="flex items-start gap-2 cursor-pointer text-sm text-gray-800">
                          <input
                            type="checkbox"
                            checked={overviewBarAverageEnabled}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setOverviewBarAverageEnabled(on);
                              try {
                                localStorage.setItem(OVERVIEW_BAR_AVERAGE, String(on));
                              } catch {}
                            }}
                            className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>{t('monthlyAccounting.overview.barAverage')}</span>
                        </label>
                        <label className="flex items-start gap-2 cursor-pointer text-sm text-gray-800">
                          <input
                            type="checkbox"
                            checked={overviewBarBudgetEnabled}
                            onChange={(e) => {
                              const on = e.target.checked;
                              setOverviewBarBudgetEnabled(on);
                              try {
                                localStorage.setItem(OVERVIEW_BAR_BUDGET, String(on));
                              } catch {}
                            }}
                            className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span>{t('monthlyAccounting.overview.barBudget')}</span>
                        </label>
                      </div>
                      <div className="border-t border-gray-200 mt-3 pt-3" aria-hidden />
                      <p className="text-xs italic text-gray-600 leading-snug">
                        {t('monthlyAccounting.overview.budgetNote')}
                      </p>
                    </div>
                    {overviewBarAverageEnabled && (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                          {t('monthlyAccounting.overview.period')}
                        </label>
                        <select
                          value={overviewAveragePeriod}
                          onChange={(e) => {
                            const v = e.target.value;
                            setOverviewAveragePeriod(v);
                            try {
                              localStorage.setItem(OVERVIEW_AVERAGE_PERIOD, v);
                            } catch {}
                          }}
                          className="w-full text-sm border border-gray-300 rounded px-2 py-1.5 bg-white text-gray-800"
                        >
                          {AVERAGE_PERIOD_VALUES.map((value) => (
                            <option key={value} value={value}>
                              {t(`monthlyAccounting.period.options.${value}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
                  <div className="flex-1 min-w-0 min-h-0 overflow-x-auto">
              <div className="px-4 py-4 flex gap-4">
                {(() => {
                  const ref = overviewReference;
                  const hasAverage = overviewBarAverageEnabled;
                  const hasBudget = overviewBarBudgetEnabled;
                  const showBarSection = hasAverage || hasBudget;
                  const refE = ref?.entrées ?? 0;
                  const refS = ref?.sorties ?? 0;
                  const refB = ref?.balance ?? 0;
                  const byTypeSortiesAvg = ref && 'byTypeSortiesAvg' in ref ? ref.byTypeSortiesAvg : undefined;
                  const byTypeEntréesAvg = ref && 'byTypeEntréesAvg' in ref ? ref.byTypeEntréesAvg : undefined;
                  const scaleMaxS = Math.max(overviewData.totalSorties, refS, 1);
                  const scaleMaxE = Math.max(overviewData.totalEntrées, refE, 1);
                  const scaleMaxB = Math.max(Math.abs(overviewData.balance), Math.abs(refB), 1);
                  const c = cumulativeChartYAxisCurrency as CurrencySymbol;
                  /** Somme signée (affichage total prévision sorties, souvent négatif). */
                  const sumMonthlyBudgetSorties = overviewData.byTypeSorties.reduce((sum, [typeName]) => {
                    const m = monthlyForecastForTypeDisplay(typeName, budgetSnapshot, c);
                    return sum + (m ?? 0);
                  }, 0);
                  const sumMonthlyBudgetEntrees = overviewData.byTypeEntrées.reduce((sum, [typeName]) => {
                    const m = monthlyForecastForTypeDisplay(typeName, budgetSnapshot, c);
                    return sum + (m ?? 0);
                  }, 0);
                  /** Magnitudes pour comparer réel vs prévision et la balance budgétée (écarts, barres). */
                  const sumMonthlyBudgetSortiesMag = overviewData.byTypeSorties.reduce((sum, [typeName]) => {
                    const m = monthlyForecastForTypeDisplay(typeName, budgetSnapshot, c);
                    return sum + (m != null ? Math.abs(m) : 0);
                  }, 0);
                  const sumMonthlyBudgetEntreesMag = overviewData.byTypeEntrées.reduce((sum, [typeName]) => {
                    const m = monthlyForecastForTypeDisplay(typeName, budgetSnapshot, c);
                    return sum + (m != null ? Math.abs(m) : 0);
                  }, 0);
                  const refNetBudget = sumMonthlyBudgetEntreesMag - sumMonthlyBudgetSortiesMag;
                  const scaleMaxBudgetS = Math.max(overviewData.totalSorties, sumMonthlyBudgetSortiesMag, 1);
                  const scaleMaxBudgetE = Math.max(overviewData.totalEntrées, sumMonthlyBudgetEntreesMag, 1);
                  const scaleMaxBudgetB = Math.max(Math.abs(overviewData.balance), Math.abs(refNetBudget), 1);
                  const viewYear = selectedMonth ? parseInt(selectedMonth.split('-')[0], 10) : NaN;
                  const periodeMoyennePhrase = phraseMoyenneSurPeriode(overviewAveragePeriod, t);
                  type Row = {
                    id: string;
                    leftLabel: string;
                    leftValue: string;
                    leftValueClass?: string;
                    isTitle?: boolean;
                    isTotal?: boolean;
                    barValue?: number;
                    barMax?: number;
                    barRefPercent?: number;
                    barOk?: boolean;
                    barColor?: 'red' | 'green' | 'amber';
                    targetValue?: number;
                    exceedsRef?: boolean;
                    /** cumul − moyenne (sorties : positif = excès de dépense vs moyenne) */
                    diff?: number;
                    budgetBarValue?: number;
                    budgetBarMax?: number;
                    budgetBarRefPercent?: number;
                    budgetExceedsRef?: boolean;
                    budgetTargetValue?: number | null;
                    budgetDiff?: number | null;
                  };
                  const rows: Row[] = [
                    { id: 'h-sorties', leftLabel: t('dashboard.series.exits'), leftValue: '', isTitle: true },
                    ...overviewData.byTypeSorties.map(([type, amount]) => {
                      const avg = byTypeSortiesAvg?.[type] ?? 0;
                      const barMax = Math.max(amount, avg, 1);
                      const barRefPercent = avg > 0 && avg <= barMax ? (avg / barMax) * 100 : undefined;
                      const barOk = amount <= avg;
                      const monthlyB = monthlyForecastForTypeDisplay(type, budgetSnapshot, c);
                      const prevSortiesMag = monthlyB != null ? Math.abs(monthlyB) : null;
                      let budgetBarValue: number | undefined;
                      let budgetBarMax: number | undefined;
                      let budgetBarRefPercent: number | undefined;
                      let budgetExceedsRef: boolean | undefined;
                      let budgetTargetValue: number | null | undefined;
                      let budgetDiff: number | null | undefined;
                      if (monthlyB != null && prevSortiesMag != null) {
                        const bm = Math.max(amount, prevSortiesMag, 1);
                        budgetBarValue = amount;
                        budgetBarMax = bm;
                        budgetBarRefPercent =
                          prevSortiesMag > 0 && prevSortiesMag <= bm ? (prevSortiesMag / bm) * 100 : undefined;
                        budgetExceedsRef = amount > prevSortiesMag;
                        budgetTargetValue = monthlyB;
                        budgetDiff = amount - prevSortiesMag;
                      }
                      return {
                        id: `s-${type}`,
                        leftLabel: type,
                        leftValue: `−${formatCurrency(amount, cumulativeChartYAxisCurrency)}`,
                        leftValueClass: 'text-red-700',
                        barValue: amount,
                        barMax,
                        barRefPercent,
                        barOk,
                        barColor: (barOk ? 'green' : 'red') as Row['barColor'],
                        targetValue: avg > 0 ? -avg : undefined,
                        exceedsRef: amount > avg,
                        diff: amount - avg,
                        budgetBarValue,
                        budgetBarMax,
                        budgetBarRefPercent,
                        budgetExceedsRef,
                        budgetTargetValue,
                        budgetDiff,
                      };
                    }),
                    {
                      id: 'total-sorties',
                      leftLabel: t('dashboard.totalExits'),
                      leftValue: `−${formatCurrency(overviewData.totalSorties, cumulativeChartYAxisCurrency)}`,
                      leftValueClass: 'text-red-700 font-medium',
                      isTotal: true,
                      barValue: overviewData.totalSorties,
                      barMax: scaleMaxS,
                      barRefPercent: refS > 0 && refS <= scaleMaxS ? (refS / scaleMaxS) * 100 : undefined,
                      barOk: overviewData.totalSorties <= refS,
                      barColor: overviewData.totalSorties <= refS ? 'green' : 'red',
                      targetValue: refS > 0 ? -refS : undefined,
                      exceedsRef: overviewData.totalSorties > refS,
                      diff: overviewData.totalSorties - refS,
                      budgetBarValue: overviewData.totalSorties,
                      budgetBarMax: scaleMaxBudgetS,
                      budgetBarRefPercent:
                        sumMonthlyBudgetSortiesMag > 0 && sumMonthlyBudgetSortiesMag <= scaleMaxBudgetS
                          ? (sumMonthlyBudgetSortiesMag / scaleMaxBudgetS) * 100
                          : undefined,
                      budgetExceedsRef: overviewData.totalSorties > sumMonthlyBudgetSortiesMag,
                      budgetTargetValue: sumMonthlyBudgetSorties,
                      budgetDiff: overviewData.totalSorties - sumMonthlyBudgetSortiesMag,
                    },
                    { id: 'h-entrees', leftLabel: t('dashboard.series.entries'), leftValue: '', isTitle: true },
                    ...overviewData.byTypeEntrées.map(([type, amount]) => {
                      const avg = byTypeEntréesAvg?.[type] ?? 0;
                      const barMax = Math.max(amount, avg, 1);
                      const barRefPercent = avg > 0 && avg <= barMax ? (avg / barMax) * 100 : undefined;
                      const barOk = amount >= avg;
                      const monthlyB = monthlyForecastForTypeDisplay(type, budgetSnapshot, c);
                      const prevEntreesMag = monthlyB != null ? Math.abs(monthlyB) : null;
                      let budgetBarValue: number | undefined;
                      let budgetBarMax: number | undefined;
                      let budgetBarRefPercent: number | undefined;
                      let budgetExceedsRef: boolean | undefined;
                      let budgetTargetValue: number | null | undefined;
                      let budgetDiff: number | null | undefined;
                      if (monthlyB != null && prevEntreesMag != null) {
                        const bm = Math.max(amount, prevEntreesMag, 1);
                        budgetBarValue = amount;
                        budgetBarMax = bm;
                        budgetBarRefPercent =
                          prevEntreesMag > 0 && prevEntreesMag <= bm ? (prevEntreesMag / bm) * 100 : undefined;
                        budgetExceedsRef = amount > prevEntreesMag;
                        budgetTargetValue = monthlyB;
                        budgetDiff = amount - prevEntreesMag;
                      }
                      return {
                        id: `e-${type}`,
                        leftLabel: type,
                        leftValue: `+${formatCurrency(amount, cumulativeChartYAxisCurrency)}`,
                        leftValueClass: 'text-green-700',
                        barValue: amount,
                        barMax,
                        barRefPercent,
                        barOk,
                        barColor: (barOk ? 'green' : 'amber') as Row['barColor'],
                        targetValue: avg > 0 ? avg : undefined,
                        exceedsRef: amount > avg,
                        diff: amount - avg,
                        budgetBarValue,
                        budgetBarMax,
                        budgetBarRefPercent,
                        budgetExceedsRef,
                        budgetTargetValue,
                        budgetDiff,
                      };
                    }),
                    {
                      id: 'total-entrees',
                      leftLabel: t('dashboard.totalEntries'),
                      leftValue: `+${formatCurrency(overviewData.totalEntrées, cumulativeChartYAxisCurrency)}`,
                      leftValueClass: 'text-green-700 font-medium',
                      isTotal: true,
                      barValue: overviewData.totalEntrées,
                      barMax: scaleMaxE,
                      barRefPercent: refE > 0 && refE <= scaleMaxE ? (refE / scaleMaxE) * 100 : undefined,
                      barOk: overviewData.totalEntrées >= refE,
                      barColor: overviewData.totalEntrées >= refE ? 'green' : 'amber',
                      targetValue: refE,
                      exceedsRef: overviewData.totalEntrées > refE,
                      diff: overviewData.totalEntrées - refE,
                      budgetBarValue: overviewData.totalEntrées,
                      budgetBarMax: scaleMaxBudgetE,
                      budgetBarRefPercent:
                        sumMonthlyBudgetEntreesMag > 0 && sumMonthlyBudgetEntreesMag <= scaleMaxBudgetE
                          ? (sumMonthlyBudgetEntreesMag / scaleMaxBudgetE) * 100
                          : undefined,
                      budgetExceedsRef: overviewData.totalEntrées > sumMonthlyBudgetEntreesMag,
                      budgetTargetValue: sumMonthlyBudgetEntrees,
                      budgetDiff: overviewData.totalEntrées - sumMonthlyBudgetEntreesMag,
                    },
                    {
                      id: 'balance',
                      leftLabel: t('dashboard.series.balance'),
                      leftValue: `${overviewData.balance >= 0 ? '+' : ''}${formatCurrency(overviewData.balance, cumulativeChartYAxisCurrency)}`,
                      leftValueClass: `font-semibold ${overviewData.balance >= 0 ? 'text-green-700' : 'text-red-700'}`,
                      isTotal: true,
                      barValue: Math.abs(overviewData.balance),
                      barMax: scaleMaxB,
                      barRefPercent: Math.abs(refB) > 0 && Math.abs(refB) <= scaleMaxB ? (Math.abs(refB) / scaleMaxB) * 100 : undefined,
                      barOk: overviewData.balance >= refB,
                      barColor: overviewData.balance >= refB ? 'green' : 'red',
                      targetValue: refB,
                      exceedsRef: overviewData.balance > refB,
                      diff: overviewData.balance - refB,
                      budgetBarValue: Math.abs(overviewData.balance),
                      budgetBarMax: scaleMaxBudgetB,
                      budgetBarRefPercent:
                        Math.abs(refNetBudget) > 0 && Math.abs(refNetBudget) <= scaleMaxBudgetB
                          ? (Math.abs(refNetBudget) / scaleMaxBudgetB) * 100
                          : undefined,
                      budgetExceedsRef: overviewData.balance > refNetBudget,
                      budgetTargetValue: refNetBudget,
                      budgetDiff: overviewData.balance - refNetBudget,
                    },
                  ];
                  const BAR_FIXED_WIDTH_PX = 180;
                  /** true uniquement pour les lignes sorties (pas entrées ni balance). */
                  const isSortiesRow = (id: string) => id === 'total-sorties' || id.startsWith('s-');
                  return (
                    <div className="flex flex-col gap-0 w-full">
                      {rows.map((r, index) => (
                        <div
                          key={r.id}
                          className={`flex gap-4 items-center min-h-[32px] py-0.5 w-full ${r.isTitle ? (index === 0 ? 'mt-0' : 'mt-3') : ''} ${r.id === 'h-sorties' || r.id === 'h-entrees' ? 'border-b border-gray-200 pb-1 mb-0.5' : ''} ${r.isTotal && !r.isTitle ? 'border-t border-gray-200 mt-1 pt-1' : ''} ${r.id === 'balance' ? 'border-t border-gray-300 mt-2 pt-2' : ''}`}
                        >
                          {/* Partie gauche : libellé + valeur cumulée/totale */}
                          <div className={`flex-shrink-0 flex justify-between gap-2 min-w-0 w-[220px] text-sm ${r.isTitle ? 'text-base font-semibold text-gray-500 uppercase tracking-wide' : ''} ${(r.id.startsWith('s-') || r.id.startsWith('e-')) ? 'pl-4' : ''} ${r.isTotal && !r.isTitle ? 'italic' : ''} ${r.id === 'balance' ? 'text-base font-semibold' : ''}`}>
                            <span className={`truncate ${r.isTitle ? '' : 'text-gray-700'}`} title={r.leftLabel}>{r.leftLabel}</span>
                            {!r.isTitle && <span className={`tabular-nums flex-shrink-0 ${r.leftValueClass ?? 'text-gray-800'}`}>{r.leftValue}</span>}
                          </div>
                          {/* Barres : moyenne (optionnel) + budget annuel (optionnel) */}
                          {showBarSection ? (
                            r.isTitle ? (
                              r.id === 'h-sorties' ? (
                                <>
                                  {hasAverage && (
                                    <>
                                      <div
                                        className="flex-shrink-0 self-center"
                                        style={{ width: BAR_FIXED_WIDTH_PX }}
                                        aria-hidden
                                      />
                                      <div className="flex items-center gap-3 flex-shrink-0 self-center text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                        <span className="whitespace-nowrap w-20 text-right">{t('monthlyAccounting.overview.average')}</span>
                                        <span className="whitespace-nowrap w-24 text-right">{t('dashboard.charts.diff')}</span>
                                      </div>
                                    </>
                                  )}
                                  {hasBudget && (
                                    <div
                                      className={`flex items-center gap-3 flex-shrink-0 self-center ${hasAverage ? 'border-l border-gray-200 pl-3 ml-1' : ''}`}
                                    >
                                      <div className="flex-shrink-0" style={{ width: BAR_FIXED_WIDTH_PX }} aria-hidden />
                                      <div className="flex items-center gap-3 flex-shrink-0 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                                        <span className="whitespace-nowrap w-20 text-right">{t('monthlyAccounting.overview.monthlyForecast')}</span>
                                        <span className="whitespace-nowrap w-24 text-right">{t('dashboard.charts.diff')}</span>
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : r.id === 'h-entrees' ? (
                                <>
                                  {hasAverage && (
                                    <>
                                      <div
                                        className="flex-shrink-0 self-center"
                                        style={{ width: BAR_FIXED_WIDTH_PX }}
                                        aria-hidden
                                      />
                                      <div
                                        className="flex items-center gap-3 flex-shrink-0 self-center text-xs font-semibold uppercase tracking-wide invisible pointer-events-none select-none"
                                        aria-hidden
                                      >
                                        <span className="whitespace-nowrap w-20 text-right">{t('monthlyAccounting.overview.average')}</span>
                                        <span className="whitespace-nowrap w-24 text-right">{t('dashboard.charts.diff')}</span>
                                      </div>
                                    </>
                                  )}
                                  {hasBudget && (
                                    <div
                                      className={`flex items-center gap-3 flex-shrink-0 self-center ${hasAverage ? 'border-l border-gray-200 pl-3 ml-1' : ''}`}
                                    >
                                      <div className="flex-shrink-0" style={{ width: BAR_FIXED_WIDTH_PX }} aria-hidden />
                                      <div
                                        className="flex items-center gap-3 flex-shrink-0 text-xs font-semibold uppercase tracking-wide invisible pointer-events-none select-none"
                                        aria-hidden
                                      >
                                        <span className="whitespace-nowrap w-20 text-right">{t('monthlyAccounting.overview.monthlyForecast')}</span>
                                        <span className="whitespace-nowrap w-24 text-right">{t('dashboard.charts.diff')}</span>
                                      </div>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <div className="flex-1 min-w-0" />
                              )
                            ) : r.barValue != null && r.barMax != null ? (
                              <>
                                {hasAverage && (
                                  <>
                                    <div
                                      className="relative flex-shrink-0 cursor-help"
                                      style={{ width: BAR_FIXED_WIDTH_PX }}
                                      onMouseEnter={(e) => {
                                        if (!hasAverage || r.diff == null || !periodeMoyennePhrase) return;
                                        const rect = e.currentTarget.getBoundingClientRect();
                                        setOverviewStatBarTooltip({
                                          left: rect.left + rect.width / 2,
                                          top: rect.top,
                                          content: (
                                            <OverviewStatBarTooltipBubble
                                              variant="average"
                                              diff={r.diff}
                                              currency={cumulativeChartYAxisCurrency}
                                              periodPhrase={periodeMoyennePhrase}
                                              isSortiesRow={isSortiesRow(r.id)}
                                            />
                                          ),
                                        });
                                      }}
                                      onMouseLeave={() => setOverviewStatBarTooltip(null)}
                                    >
                                      <div className="h-6 bg-gray-200 overflow-hidden relative">
                                        {(() => {
                                          const valuePercent = Math.min(100, (r.barValue! / r.barMax!) * 100);
                                          const refPercent = r.barRefPercent ?? 0;
                                          const isSorties = isSortiesRow(r.id);
                                          const hatchRed =
                                            'repeating-linear-gradient(135deg, rgba(185,28,28,0.45) 0px, rgba(185,28,28,0.45) 2px, transparent 2px, transparent 6px)';
                                          const hatchGreen =
                                            'repeating-linear-gradient(135deg, rgba(22,163,74,0.5) 0px, rgba(22,163,74,0.5) 2px, transparent 2px, transparent 6px)';
                                          return (
                                            <>
                                              {!r.exceedsRef ? (
                                                <>
                                                  <div className="absolute inset-y-0 left-0 bg-blue-400" style={{ width: `${valuePercent}%` }} />
                                                  {valuePercent < refPercent && (
                                                    <div
                                                      className="absolute inset-y-0 left-0"
                                                      style={{
                                                        left: `${valuePercent}%`,
                                                        width: `${refPercent - valuePercent}%`,
                                                        background: isSorties ? hatchGreen : hatchRed,
                                                      }}
                                                    />
                                                  )}
                                                </>
                                              ) : (
                                                <>
                                                  <div className="absolute inset-y-0 left-0 bg-blue-400" style={{ width: `${refPercent}%` }} />
                                                  <div
                                                    className="absolute inset-y-0 left-0"
                                                    style={{
                                                      left: `${refPercent}%`,
                                                      width: `${valuePercent - refPercent}%`,
                                                      background: isSorties ? hatchRed : hatchGreen,
                                                    }}
                                                  />
                                                </>
                                              )}
                                            </>
                                          );
                                        })()}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-3 flex-shrink-0 text-sm">
                                      <span className="inline-block text-gray-600 tabular-nums whitespace-nowrap w-20 text-right">
                                        {r.targetValue != null
                                          ? formatCurrency(r.targetValue, cumulativeChartYAxisCurrency)
                                          : '\u00a0'}
                                      </span>
                                      <span
                                        className={`inline-block tabular-nums whitespace-nowrap w-24 text-right font-medium ${
                                          r.diff != null && r.diff !== 0
                                            ? overviewStatBarEcartAmountClass(r.diff, isSortiesRow(r.id))
                                            : ''
                                        }`}
                                      >
                                        {r.diff != null && r.diff !== 0
                                          ? `${r.diff > 0 ? '+' : ''}${formatCurrency(r.diff, cumulativeChartYAxisCurrency)}`
                                          : '\u00a0'}
                                      </span>
                                    </div>
                                  </>
                                )}
                                {hasBudget && (
                                  <div
                                    className={`flex items-center gap-3 flex-shrink-0 ${hasAverage ? 'border-l border-gray-200 pl-3 ml-1' : ''}`}
                                  >
                                    {r.budgetBarValue != null && r.budgetBarMax != null ? (
                                      <>
                                        <div
                                          className="relative flex-shrink-0 cursor-help"
                                          style={{ width: BAR_FIXED_WIDTH_PX }}
                                          onMouseEnter={(e) => {
                                            if (!hasBudget || r.budgetDiff == null || Number.isNaN(viewYear)) return;
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            setOverviewStatBarTooltip({
                                              left: rect.left + rect.width / 2,
                                              top: rect.top,
                                              content: (
                                                <OverviewStatBarTooltipBubble
                                                  variant="budget"
                                                  diff={r.budgetDiff}
                                                  currency={cumulativeChartYAxisCurrency}
                                                  year={viewYear}
                                                  isSortiesRow={isSortiesRow(r.id)}
                                                />
                                              ),
                                            });
                                          }}
                                          onMouseLeave={() => setOverviewStatBarTooltip(null)}
                                        >
                                          <div className="h-6 bg-gray-200 overflow-hidden relative">
                                            {(() => {
                                              const valuePercent = Math.min(100, (r.budgetBarValue / r.budgetBarMax) * 100);
                                              const refPercent = r.budgetBarRefPercent ?? 0;
                                              const isSorties = isSortiesRow(r.id);
                                              const hatchRed =
                                                'repeating-linear-gradient(135deg, rgba(185,28,28,0.45) 0px, rgba(185,28,28,0.45) 2px, transparent 2px, transparent 6px)';
                                              const hatchGreen =
                                                'repeating-linear-gradient(135deg, rgba(22,163,74,0.5) 0px, rgba(22,163,74,0.5) 2px, transparent 2px, transparent 6px)';
                                              return (
                                                <>
                                                  {!r.budgetExceedsRef ? (
                                                    <>
                                                      <div className="absolute inset-y-0 left-0 bg-blue-400" style={{ width: `${valuePercent}%` }} />
                                                      {valuePercent < refPercent && (
                                                        <div
                                                          className="absolute inset-y-0 left-0"
                                                          style={{
                                                            left: `${valuePercent}%`,
                                                            width: `${refPercent - valuePercent}%`,
                                                            background: isSorties ? hatchGreen : hatchRed,
                                                          }}
                                                        />
                                                      )}
                                                    </>
                                                  ) : (
                                                    <>
                                                      <div className="absolute inset-y-0 left-0 bg-blue-400" style={{ width: `${refPercent}%` }} />
                                                      <div
                                                        className="absolute inset-y-0 left-0"
                                                        style={{
                                                          left: `${refPercent}%`,
                                                          width: `${valuePercent - refPercent}%`,
                                                          background: isSorties ? hatchRed : hatchGreen,
                                                        }}
                                                      />
                                                    </>
                                                  )}
                                                </>
                                              );
                                            })()}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-3 flex-shrink-0 text-sm">
                                          <span className="inline-block text-gray-600 tabular-nums whitespace-nowrap w-20 text-right">
                                            {r.budgetTargetValue != null
                                              ? formatCurrency(r.budgetTargetValue, cumulativeChartYAxisCurrency)
                                              : '\u00a0'}
                                          </span>
                                          <span
                                            className={`inline-block tabular-nums whitespace-nowrap w-24 text-right font-medium ${
                                              r.budgetDiff != null && r.budgetDiff !== 0
                                                ? overviewStatBarEcartAmountClass(r.budgetDiff, isSortiesRow(r.id))
                                                : ''
                                            }`}
                                          >
                                            {r.budgetDiff != null && r.budgetDiff !== 0
                                              ? `${r.budgetDiff > 0 ? '+' : ''}${formatCurrency(r.budgetDiff, cumulativeChartYAxisCurrency)}`
                                              : '\u00a0'}
                                          </span>
                                        </div>
                                      </>
                                    ) : (
                                      <>
                                        <div className="h-6 bg-gray-100 flex-shrink-0" style={{ width: BAR_FIXED_WIDTH_PX }} aria-hidden />
                                        <div className="flex items-center gap-3 flex-shrink-0 text-sm">
                                          <span className="inline-block w-20 text-right text-gray-400 tabular-nums">{'\u00a0'}</span>
                                          <span className="inline-block w-24 text-right tabular-nums">{'\u00a0'}</span>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="flex-1 min-w-0" />
                            )
                          ) : null}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {data && !loading && (
          <section className="flex flex-col flex-1 min-h-0 rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden mb-6">
            <header
              className={`bg-gradient-to-br from-slate-50 to-white shrink-0 ${
                sectionTableExpanded ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
              }`}
            >
              <button
                type="button"
                className="w-full px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
                onClick={() => {
                  setSectionTableExpanded((e) => {
                    const next = !e;
                    saveMonthlySectionExpanded(SECTION_MONTHLY_TABLE, next);
                    return next;
                  });
                }}
                aria-expanded={sectionTableExpanded}
              >
                <span
                  className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
                    sectionTableExpanded ? 'rotate-90' : ''
                  }`}
                  aria-hidden
                >
                  ▶
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
                    {t('transactions.title')}
                  </span>
                  <span className="block text-sm text-gray-500 mt-1.5">
                    {t('monthlyAccounting.table.subtitle')}
                  </span>
                </span>
              </button>
            </header>
            {sectionTableExpanded && (
              <div className="flex flex-col flex-1 min-h-0 overflow-hidden border-t border-gray-100">
            {selectableMonths.length === 0 ? (
              <div className="p-6 text-gray-600">
                {t('monthlyAccounting.table.noData')}
              </div>
            ) : (
              <>
                {selectableMonths.length > 0 && selectedMonth && (
                  <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-50">
                    <p className="text-sm text-gray-600 mb-2">
                      {t('monthlyAccounting.anomaly.description', {
                        count: rowsForMonth.length,
                        month: selectedMonthLabel,
                      })}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleRefreshSourceDataCsv}
                        disabled={reorderChronoLoading || !data || saveLoading}
                        title={
                          editMode
                            ? t('transactions.refresh.exitEditFirst')
                            : t('transactions.refresh.hint')
                        }
                        className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {reorderChronoLoading ? t('transactions.refresh.loading') : t('transactions.refresh.button')}
                      </button>
                      <button
                        type="button"
                        onClick={handleDetectAnomalies}
                        disabled={anomalyLoading || rowsForMonth.length === 0}
                        className="rounded border border-amber-600 bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {anomalyLoading ? t('transactions.anomaly.analyzing') : t('transactions.anomaly.detect')}
                      </button>
                      <button
                        type="button"
                        onClick={handleOpenMonthlyAnomalyReport}
                        className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {t('monthlyAccounting.anomaly.openMonthlyReport')}
                      </button>
                      <button
                        type="button"
                        onClick={handleToggleEditMode}
                        className={`rounded border px-3 py-1.5 text-sm font-medium text-white ${
                          editMode
                            ? 'border-gray-500 bg-gray-500 hover:bg-gray-600'
                            : 'border-red-600 bg-red-600 hover:bg-red-700'
                        }`}
                      >
                        {editMode ? t('transactions.edit.exit') : t('transactions.edit.enter')}
                      </button>
                      {editMode && (
                        <button
                          type="button"
                          onClick={handleSaveSourceData}
                          disabled={saveLoading || !data}
                          className="rounded border border-green-600 bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {saveLoading ? t('common.saving') : t('transactions.edit.save')}
                        </button>
                      )}
                    </div>
                    {reorderChronoMessage && (
                      <p className="mt-2 text-sm text-gray-700">{reorderChronoMessage}</p>
                    )}
                    {(editMode && saveMessage) && (
                      <p className="mt-2 text-sm text-gray-600">{saveMessage}</p>
                    )}
                    {anomalyMessage && (
                      <p className="mt-2 text-sm text-amber-700">{anomalyMessage}</p>
                    )}
                  </div>
                )}
                <div className="shrink-0 px-4 py-2 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center gap-3">
                  {editMode && (
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={editShowAnomaliesOnly}
                        onChange={(e) => setEditShowAnomaliesOnly(e.target.checked)}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      {t('transactions.anomaly.showOnly')}
                    </label>
                  )}
                  {editMode && (
                    <span className="text-red-600 text-sm font-medium">{t('transactions.edit.banner')}</span>
                  )}
                  {editMode && hasCustomColWidths && (
                    <button
                      type="button"
                      onClick={resetColWidths}
                      className="text-sm text-gray-600 hover:text-gray-900 underline"
                    >
                      {t('transactions.filters.resetWidths')}
                    </button>
                  )}
                </div>
                <div className="overflow-auto flex-1 min-h-0">
                  <table
                    className="w-full border-collapse text-sm"
                    style={editMode ? { tableLayout: 'fixed', minWidth: '100%' } : undefined}
                  >
                    {editMode && (
                      <colgroup>
                        {displayHeaders.map((h) => (
                          <col key={h} style={{ width: getColWidth(h) }} />
                        ))}
                        <col style={{ width: getColWidth('__duplicate__') }} />
                        <col style={{ width: getColWidth('__exclude_anomaly__') }} />
                        <col style={{ width: getColWidth('__delete__') }} />
                      </colgroup>
                    )}
                    <thead className="sticky top-0 bg-gray-100 border-b border-gray-200 z-10">
                      <tr>
                        {displayHeaders.map((h) =>
                          editMode ? (
                            <ResizableTableHeadCell
                              key={h}
                              columnKey={h}
                              width={getColWidth(h)}
                              enabled={editMode}
                              onResizeStart={handleColResizeStart}
                              onClick={() => handleSort(h)}
                              className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:bg-gray-200 transition-colors overflow-hidden"
                            >
                              <span className="inline-flex items-center gap-1">
                                {h}
                                {sortColumn === h && (
                                  <span className="text-blue-600" aria-label={sortDirection === 'asc' ? t('transactions.table.sortAsc') : t('transactions.table.sortDesc')}>
                                    {sortDirection === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </span>
                            </ResizableTableHeadCell>
                          ) : (
                            <th
                              key={h}
                              onClick={() => handleSort(h)}
                              className={`text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:bg-gray-200 transition-colors ${
                                /^(titres?|titles?)$/i.test(h)
                                  ? 'min-w-[18rem]'
                                  : /^(types?)$/i.test(h)
                                    ? 'min-w-[calc(8.25ch+1rem+2px)]'
                                    : /date/i.test(h)
                                      ? 'min-w-[calc(10ch+1rem+2px)]'
                                    : ''
                              }`}
                            >
                              <span className="inline-flex items-center gap-1">
                                {h}
                                {sortColumn === h && (
                                  <span className="text-blue-600" aria-label={sortDirection === 'asc' ? t('transactions.table.sortAsc') : t('transactions.table.sortDesc')}>
                                    {sortDirection === 'asc' ? '↑' : '↓'}
                                  </span>
                                )}
                              </span>
                            </th>
                          )
                        )}
                        {editMode && (
                          <ResizableTableHeadCell
                            columnKey="__duplicate__"
                            width={getColWidth('__duplicate__')}
                            resizable={false}
                            enabled={editMode}
                            onResizeStart={handleColResizeStart}
                            className="text-left font-semibold text-gray-700 px-0.5 py-2 whitespace-nowrap bg-gray-100 overflow-hidden"
                          >
                            {t('monthlyAccounting.table.duplicate')}
                          </ResizableTableHeadCell>
                        )}
                        {editMode && (
                          <ResizableTableHeadCell
                            columnKey="__exclude_anomaly__"
                            width={getColWidth('__exclude_anomaly__')}
                            resizable={false}
                            enabled={editMode}
                            onResizeStart={handleColResizeStart}
                            className="text-left font-semibold text-gray-700 px-1 py-2 whitespace-nowrap bg-gray-100 overflow-hidden"
                          >
                            {t('transactions.anomaly.excludeColumn')}
                          </ResizableTableHeadCell>
                        )}
                        {editMode && (
                          <ResizableTableHeadCell
                            columnKey="__delete__"
                            width={getColWidth('__delete__')}
                            resizable={false}
                            enabled={editMode}
                            onResizeStart={handleColResizeStart}
                            className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap bg-gray-100 overflow-hidden"
                          >
                            {t('transactions.table.deleteColumn')}
                          </ResizableTableHeadCell>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((row, i) => {
                        const dataRowIndex = data ? data.rows.findIndex((r) => r === row) : -1;
                        const isMarkedForDelete = dataRowIndex >= 0 && rowsToDelete.has(dataRowIndex);
                        const isExcludedFromAnomaly = dataRowIndex >= 0 && rowsExcludedFromAnomaly.has(dataRowIndex);
                        return (
                          <tr
                            key={i}
                            className={`border-b border-gray-100 ${
                              editMode && isMarkedForDelete
                                ? 'bg-red-100/70 hover:bg-red-100/70'
                                : editMode && isExcludedFromAnomaly
                                  ? 'bg-green-100/70 hover:bg-green-100/70'
                                  : 'hover:bg-gray-50'
                            }`}
                          >
                            {displayHeaders.map((header) => {
                              const raw = row[header] ?? '';
                              const isDateColumn = /date/i.test(header);
                              const isAmountColumn = /^amount$/i.test(header);
                              const isCurrencyColumn = /^currency$/i.test(header);
                              const isAmountGbpColumn = isAmountIndicatorHeader(header);
                              const isDateEntryColumn = /date/i.test(header);
                              const isAccountColumn = /^account$/i.test(header) || /compte/i.test(header);
                              const currencyHeaderForDisplay =
                                displayHeaders.find((h) => /^currency$/i.test(h)) ?? null;
                              const rowCurrency = currencyHeaderForDisplay
                                ? (row[currencyHeaderForDisplay] ?? '')
                                : '';
                              const primarySym = currencyDisplaySymbol(
                                getCachedWorkingCurrencies().primary || 'GBP'
                              );
                              const display = isDateColumn
                                ? formatDateDDMMYYYY(raw)
                                : isAmountColumn
                                  ? formatAmountForRowCurrency(raw, rowCurrency)
                                  : isCurrencyColumn
                                    ? formatFx(raw)
                                    : isAmountGbpColumn
                                      ? (() => {
                                          const s = (raw ?? '').trim();
                                          if (s === '') return '';
                                          const num = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
                                          if (Number.isNaN(num)) return raw;
                                          return formatCurrency(num, primarySym);
                                        })()
                                        : isAccountColumn
                                          ? accountLabelFromSource(raw) || raw
                                          : raw;
                              if (editMode && dataRowIndex >= 0 && !/^index$/i.test(header)) {
                                if (/^projet$/i.test(header)) {
                                  return (
                                    <td key={header} className="px-1 py-0.5 overflow-hidden">
                                      <ProjetSelectCell
                                        rawId={raw}
                                        projects={projects}
                                        disabled={saveLoading}
                                        onChange={(id) => handleCellChange(dataRowIndex, header, id)}
                                      />
                                    </td>
                                  );
                                }
                                const amountHeaderForRow = displayHeaders.find((h) => /^amount$/i.test(h));
                                const currencyHeaderForRow = displayHeaders.find((h) => /^currency$/i.test(h));
                                const isAmountGbpReadOnly =
                                  isAmountGbpColumn &&
                                  isAmountGbpIndicatorReadOnly(row, amountHeaderForRow, currencyHeaderForRow);
                                const useSuggestions = isTextSuggestibleColumn(header);
                                const suggestions = useSuggestions && data?.rows
                                  ? getSuggestions(data.rows, header, raw, 10)
                                  : [];
                                const dateSuggestions = isDateEntryColumn && selectedMonth
                                  ? getDateSuggestionsForMonth(selectedMonth, raw)
                                  : [];
                                const listId = `suggest-existing-${dataRowIndex}-${header.replace(/\s/g, '-')}`;
                                const dateListId = `suggest-existing-date-${dataRowIndex}-${header.replace(/\s/g, '-')}`;
                                const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
                                  if (e.key !== 'Tab' || e.shiftKey) return;
                                  const focusNext = () => {
                                    setTimeout(() => {
                                      const td = (e.target as HTMLElement).closest('td');
                                      const nextInput = td?.nextElementSibling?.querySelector('input');
                                      (nextInput as HTMLInputElement)?.focus();
                                    }, 0);
                                  };
                                  if (isDateEntryColumn && selectedMonth) {
                                    const completed = completeDateForMonth(raw, selectedMonth);
                                    if (completed) {
                                      e.preventDefault();
                                      handleCellChange(dataRowIndex, header, completed);
                                      focusNext();
                                    }
                                    return;
                                  }
                                  if (useSuggestions && suggestions.length > 0) {
                                    const first = suggestions[0].value;
                                    if (raw.trim() !== first) {
                                      e.preventDefault();
                                      handleCellChange(dataRowIndex, header, first);
                                      focusNext();
                                    }
                                  }
                                };
                                return (
                                  <td key={header} className="px-1 py-0.5 overflow-hidden">
                                    <input
                                      type="text"
                                      value={raw}
                                      readOnly={!!isAmountGbpReadOnly}
                                      onChange={(e) => handleCellChange(dataRowIndex, header, e.target.value)}
                                      onKeyDown={handleKeyDown}
                                      list={useSuggestions ? listId : isDateEntryColumn && dateSuggestions.length > 0 ? dateListId : undefined}
                                      className={`w-full rounded border px-2 py-1 text-sm text-gray-800 focus:ring-2 focus:ring-red-500 focus:border-red-500 ${isAmountGbpReadOnly ? 'border-gray-200 bg-gray-50 cursor-not-allowed' : 'border-gray-300'}`}
                                      aria-label={isAmountGbpReadOnly ? t('transactions.edit.computedCell', { header }) : t('transactions.edit.editCell', { header })}
                                      title={isAmountGbpReadOnly ? t('transactions.edit.computedTitle') : undefined}
                                    />
                                    {useSuggestions && suggestions.length > 0 && (
                                      <datalist id={listId}>
                                        {suggestions.map((s) => (
                                          <option key={`${s.value}-${s.count}`} value={s.value} />
                                        ))}
                                      </datalist>
                                    )}
                                    {isDateEntryColumn && dateSuggestions.length > 0 && (
                                      <datalist id={dateListId}>
                                        {dateSuggestions.map((dateStr) => (
                                          <option key={dateStr} value={dateStr} />
                                        ))}
                                      </datalist>
                                    )}
                                  </td>
                                );
                              }
                              if (/^projet$/i.test(header)) {
                                return (
                                  <td
                                    key={header}
                                    className={`px-3 py-2 whitespace-nowrap ${editMode && /^index$/i.test(header) ? 'bg-gray-100' : ''}`}
                                  >
                                    <ProjetDisplayCell rawId={raw} projects={projects} />
                                  </td>
                                );
                              }
                              return (
                                <td
                                  key={header}
                                  className={`px-3 py-2 text-gray-800 whitespace-nowrap ${editMode && /^index$/i.test(header) ? 'bg-gray-100' : ''}`}
                                >
                                  {display}
                                </td>
                              );
                            })}
                            {editMode && dataRowIndex >= 0 && (
                              <td className="px-0.5 py-2 whitespace-nowrap bg-gray-50">
                                <button
                                  type="button"
                                  onClick={() => handleDuplicateRow(row)}
                                  className="rounded border border-blue-600 bg-blue-600 px-1 py-1 text-xs font-medium text-white hover:bg-blue-700"
                                  title={t('monthlyAccounting.table.duplicateTitle')}
                                >
                                  {t('monthlyAccounting.table.duplicate')}
                                </button>
                              </td>
                            )}
                            {editMode && dataRowIndex >= 0 && (
                              <td className="pl-0 pr-1 py-2 whitespace-nowrap bg-gray-50">
                                <button
                                  type="button"
                                  onClick={() => handleToggleExcludeAnomaly(dataRowIndex)}
                                  className={`rounded border px-2 py-1 text-xs font-medium ${
                                    rowsExcludedFromAnomaly.has(dataRowIndex)
                                      ? 'border-green-600 bg-green-600 text-white hover:bg-green-700'
                                      : 'border-amber-600 bg-amber-600 text-white hover:bg-amber-700'
                                  }`}
                                >
                                  {rowsExcludedFromAnomaly.has(dataRowIndex)
                                    ? t('transactions.anomaly.include')
                                    : t('transactions.anomaly.exclude')}
                                </button>
                              </td>
                            )}
                            {editMode && dataRowIndex >= 0 && (
                              <td className="px-3 py-2 whitespace-nowrap bg-gray-50">
                                <button
                                  type="button"
                                  onClick={() => handleToggleRowDelete(dataRowIndex)}
                                  className="rounded border border-red-600 bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                                >
                                  {isMarkedForDelete ? t('transactions.table.undoDelete') : t('transactions.table.deleteRow')}
                                </button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {editMode && newRowDrafts.map((draft, draftIndex) => (
                        <tr key={draftIndex} className="border-b border-gray-100 bg-gray-50/80 hover:bg-gray-50">
                          {displayHeaders.map((header) => {
                            const raw = draft[header] ?? '';
                            if (/^index$/i.test(header)) {
                              return (
                                <td key={header} className="px-3 py-2 text-gray-400 whitespace-nowrap bg-gray-100" title={t('monthlyAccounting.table.newRowIndexTitle')}>
                                  —
                                </td>
                              );
                            }
                            if (/^projet$/i.test(header)) {
                              return (
                                <td key={header} className="px-1 py-0.5 overflow-hidden">
                                  <ProjetSelectCell
                                    rawId={raw}
                                    projects={projects}
                                    disabled={saveLoading}
                                    onChange={(id) => handleNewRowDraftChange(draftIndex, header, id)}
                                  />
                                </td>
                              );
                            }
                            const draftAmountHeader = displayHeaders.find((h) => /^amount$/i.test(h));
                            const draftCurrencyHeader = displayHeaders.find((h) => /^currency$/i.test(h));
                            const isAmountGbpColumnDraft = isAmountIndicatorHeader(header);
                            const isAmountGbpReadOnlyDraft =
                              isAmountGbpColumnDraft &&
                              isAmountGbpIndicatorReadOnly(draft, draftAmountHeader, draftCurrencyHeader);
                            const useSuggestions = isTextSuggestibleColumn(header);
                            const isDateColumn = /date/i.test(header);
                            const suggestions = useSuggestions && data?.rows
                              ? getSuggestions(data.rows, header, raw, 10)
                              : [];
                            const dateSuggestions = isDateColumn && selectedMonth
                              ? getDateSuggestionsForMonth(selectedMonth, raw)
                              : [];
                            const listId = `suggest-new-${draftIndex}-${header.replace(/\s/g, '-')}`;
                            const dateListId = `suggest-date-${draftIndex}-${header.replace(/\s/g, '-')}`;
                            const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
                              if (e.key !== 'Tab' || e.shiftKey) return;
                              const focusNext = () => {
                                setTimeout(() => {
                                  const td = (e.target as HTMLElement).closest('td');
                                  const nextInput = td?.nextElementSibling?.querySelector('input');
                                  (nextInput as HTMLInputElement)?.focus();
                                }, 0);
                              };
                              if (isDateColumn && selectedMonth) {
                                const completed = completeDateForMonth(raw, selectedMonth);
                                if (completed) {
                                  e.preventDefault();
                                  handleNewRowDraftChange(draftIndex, header, completed);
                                  focusNext();
                                }
                                return;
                              }
                              if (useSuggestions && suggestions.length > 0) {
                                const first = suggestions[0].value;
                                if (raw.trim() !== first) {
                                  e.preventDefault();
                                  handleNewRowDraftChange(draftIndex, header, first);
                                  focusNext();
                                }
                              }
                            };
                            return (
                              <td key={header} className="px-1 py-0.5 overflow-hidden">
                                <input
                                  type="text"
                                  value={raw}
                                  readOnly={!!isAmountGbpReadOnlyDraft}
                                  onChange={(e) => handleNewRowDraftChange(draftIndex, header, e.target.value)}
                                  onKeyDown={handleKeyDown}
                                  placeholder={t('accountBalance.newRow.placeholder')}
                                  list={useSuggestions ? listId : isDateColumn && dateSuggestions.length > 0 ? dateListId : undefined}
                                  className={`w-full rounded border px-2 py-1 text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${isAmountGbpReadOnlyDraft ? 'border-gray-200 bg-gray-50 cursor-not-allowed' : 'border-dashed border-gray-400'}`}
                                  aria-label={isAmountGbpReadOnlyDraft ? t('transactions.edit.computedCell', { header }) : t('accountBalance.newRow.ariaCol', { column: header })}
                                  title={isAmountGbpReadOnlyDraft ? t('transactions.edit.computedTitle') : undefined}
                                />
                                {useSuggestions && suggestions.length > 0 && (
                                  <datalist id={listId}>
                                    {suggestions.map((s) => (
                                      <option key={`${s.value}-${s.count}`} value={s.value} />
                                    ))}
                                  </datalist>
                                )}
                                {isDateColumn && dateSuggestions.length > 0 && (
                                  <datalist id={dateListId}>
                                    {dateSuggestions.map((dateStr) => (
                                      <option key={dateStr} value={dateStr} />
                                    ))}
                                  </datalist>
                                )}
                              </td>
                            );
                          })}
                          {editMode && (
                            <>
                              <td className="px-0.5 py-2 whitespace-nowrap bg-gray-50">
                                {draftIndex === newRowDrafts.length - 1 ? (
                                  <button
                                    type="button"
                                    onClick={handleAddNewDraftRow}
                                    className="rounded border border-blue-600 bg-blue-600 px-1.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
                                    title={t('accountBalance.newRow.addTitle')}
                                  >
                                    {t('dashboard.settings.addLine')}
                                  </button>
                                ) : null}
                              </td>
                              <td className="pl-0 pr-1 py-2 whitespace-nowrap bg-gray-50" />
                              <td className="px-3 py-2 whitespace-nowrap bg-gray-50" />
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="shrink-0 px-3 py-2 border-t border-gray-200 bg-gray-50 text-gray-500 text-xs">
                  {selectedMonthLabel && `${selectedMonthLabel} — `}
                  {t('monthlyAccounting.footer.rows', { count: displayRows.length })}
                  {editMode && editShowAnomaliesOnly
                    ? t('monthlyAccounting.footer.anomaliesOnly', { sorted: sortedRows.length })
                    : ''}
                </div>
              </>
            )}
              </div>
            )}
          </section>
        )}
      {overviewStatBarTooltip != null &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[10000]"
            style={{
              left: overviewStatBarTooltip.left,
              top: overviewStatBarTooltip.top,
              transform: 'translate(-50%, calc(-100% - 10px))',
            }}
          >
            {overviewStatBarTooltip.content}
          </div>,
          document.body
        )}
      {editExitConfirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="monthly-edit-exit-title"
          onClick={() => setEditExitConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="monthly-edit-exit-title" className="text-lg font-semibold text-gray-900">
              {t('transactions.edit.exitConfirmTitle')}
            </h2>
            <p className="text-sm text-gray-600">
              {t('transactions.edit.exitConfirmBody')}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditExitConfirmOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('transactions.edit.exitConfirmBack')}
              </button>
              <button
                type="button"
                onClick={performExitEditMode}
                className="rounded border border-red-600 bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                {t('transactions.edit.exitConfirmLeave')}
              </button>
            </div>
          </div>
        </div>
      )}
      </main>
    </>
  );
};

export default MonthlyAccounting;
