import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BilanSpecialRowOptions, BudgetCategory } from '../services/annualBudgetStorage';
import {
  ASSETS_BF_CATEGORY_ID,
  ASSETS_BANK_LINE_ID,
  budgetConsumptionRatio,
  buildAnnualBudgetTrackingSummary,
  yearElapsedFraction,
} from '../services/annualBudgetTracking';

const SHOW_BREAKDOWN_KEY = 'annual-budget-tracking-show-breakdown';

function loadShowBreakdown(): boolean {
  try {
    const s = localStorage.getItem(SHOW_BREAKDOWN_KEY);
    if (s === 'true' || s === 'false') return s === 'true';
  } catch {
    /* ignore */
  }
  return true;
}

function pctLabel(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${Math.round(ratio * 100)} %`;
}

function deltaClass(delta: number): string {
  if (delta > 0.005) return 'text-emerald-700';
  if (delta < -0.005) return 'text-red-700';
  return 'text-gray-500';
}

type Props = {
  selectedYear: number;
  byType: Record<string, number>;
  bankBalanceJan1Gbp: number | null;
  budgetValues: Record<string, number>;
  lineAssignedTypes: Record<string, string[]>;
  budgetedAssets: BudgetCategory[];
  budgetedLiabilities: BudgetCategory[];
  categoryLabels: Record<string, string>;
  lineLabels: Record<string, string>;
  bankLineOptions: BilanSpecialRowOptions;
  fmtMoney: (gbpAmount: number) => string;
  loading?: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
};

const AnnualBudgetTrackingSection: React.FC<Props> = ({
  selectedYear,
  byType,
  bankBalanceJan1Gbp,
  budgetValues,
  lineAssignedTypes,
  budgetedAssets,
  budgetedLiabilities,
  categoryLabels,
  lineLabels,
  bankLineOptions,
  fmtMoney,
  loading = false,
  expanded,
  onToggleExpanded,
}) => {
  const { t } = useTranslation();
  const [showBreakdown, setShowBreakdown] = useState(loadShowBreakdown);

  const summary = useMemo(
    () =>
      buildAnnualBudgetTrackingSummary({
        year: selectedYear,
        byType,
        bankBalanceJan1Gbp,
        live: {
          budgetValues,
          lineAssignedTypes,
          assets: budgetedAssets,
          liabilities: budgetedLiabilities,
          categoryLabels,
          lineLabels,
          bankLineOptions,
        },
      }),
    [
      selectedYear,
      byType,
      bankBalanceJan1Gbp,
      budgetValues,
      lineAssignedTypes,
      budgetedAssets,
      budgetedLiabilities,
      categoryLabels,
      lineLabels,
      bankLineOptions,
    ]
  );

  const elapsed = yearElapsedFraction(selectedYear);
  const incomeRatio = budgetConsumptionRatio(summary.incomeActualGbp, summary.incomeForecastGbp);
  const expenseRatio = budgetConsumptionRatio(summary.expenseActualGbp, summary.expenseForecastGbp);
  const incomeDelta = summary.incomeActualGbp - summary.incomeForecastGbp;
  const expenseDeltaAbs = Math.abs(summary.expenseActualGbp) - Math.abs(summary.expenseForecastGbp);

  return (
    <section
      className="mb-8 flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden"
      aria-labelledby="annual-budget-bloc-tracking-title"
    >
      <header
        className={`flex flex-col sm:flex-row sm:items-stretch bg-gradient-to-br from-slate-50 to-white ${
          expanded ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
        }`}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset sm:py-4"
          aria-expanded={expanded}
          aria-controls={expanded ? 'annual-budget-panel-tracking' : undefined}
          onClick={onToggleExpanded}
        >
          <span
            className={`mt-1.5 shrink-0 text-sm leading-none text-gray-500 transition-transform duration-200 ${
              expanded ? 'rotate-90' : ''
            }`}
            aria-hidden
          >
            ▶
          </span>
          <span className="min-w-0 flex-1">
            <span
              id="annual-budget-bloc-tracking-title"
              className="block text-xl font-bold tracking-tight text-gray-900 sm:text-2xl"
            >
              {t('annualBudget.tracking.title')}
            </span>
            <span className="mt-0.5 block text-sm text-gray-500">
              {t('annualBudget.tracking.subtitle', { year: selectedYear })}
            </span>
          </span>
        </button>
        {expanded && (
          <div className="flex items-center gap-3 border-t border-gray-100 px-4 py-2 sm:border-t-0 sm:border-l sm:py-0">
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={showBreakdown}
                onChange={(e) => {
                  const next = e.target.checked;
                  setShowBreakdown(next);
                  try {
                    localStorage.setItem(SHOW_BREAKDOWN_KEY, String(next));
                  } catch {
                    /* ignore */
                  }
                }}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{t('annualBudget.tracking.showBreakdown')}</span>
            </label>
          </div>
        )}
      </header>

      {expanded ? (
        <div id="annual-budget-panel-tracking" className="space-y-4 px-4 pb-4 pt-3">
          {loading && (
            <div className="py-6 text-center text-sm text-gray-500">
              {t('annualBudget.tracking.loading')}
            </div>
          )}

          {!loading && (
            <>
              <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    {t('annualBudget.tracking.yearProgress')}
                  </span>
                  <span className="text-sm tabular-nums text-slate-700">{pctLabel(elapsed)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full rounded-full bg-slate-500 transition-[width] duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, elapsed * 100))}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
                  {t('annualBudget.tracking.yearProgressHint')}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <TrackingKpiCard
                  title={t('annualBudget.tracking.income')}
                  tone="income"
                  forecast={summary.incomeForecastGbp}
                  actual={summary.incomeActualGbp}
                  ratio={incomeRatio}
                  elapsed={elapsed}
                  delta={incomeDelta}
                  invertDeltaGood={false}
                  fmt={fmtMoney}
                  forecastLabel={t('annualBudget.sheet.forecast')}
                  actualLabel={t('annualBudget.sheet.actual')}
                  vsBudgetLabel={t('annualBudget.tracking.vsBudget')}
                  paceLabel={t('annualBudget.tracking.vsPace')}
                />
                <TrackingKpiCard
                  title={t('annualBudget.tracking.expenses')}
                  tone="expense"
                  forecast={summary.expenseForecastGbp}
                  actual={summary.expenseActualGbp}
                  ratio={expenseRatio}
                  elapsed={elapsed}
                  delta={expenseDeltaAbs}
                  invertDeltaGood
                  fmt={fmtMoney}
                  forecastLabel={t('annualBudget.sheet.forecast')}
                  actualLabel={t('annualBudget.sheet.actual')}
                  vsBudgetLabel={t('annualBudget.tracking.vsBudget')}
                  paceLabel={t('annualBudget.tracking.vsPace')}
                  useAbsolute
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-sm font-bold text-gray-900">
                    {t('annualBudget.sheet.totalFundCF')}
                  </span>
                  <div className="flex flex-wrap gap-8 tabular-nums">
                    <div className="text-right">
                      <div className="text-base font-bold text-gray-900">
                        {fmtMoney(summary.totalFundCfForecastGbp)}
                      </div>
                      <div className="text-xs text-gray-500">{t('annualBudget.sheet.forecast')}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-bold text-gray-900">
                        {fmtMoney(summary.totalFundCfActualGbp)}
                      </div>
                      <div className="text-xs text-gray-500">{t('annualBudget.sheet.actual')}</div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`text-base font-bold ${deltaClass(
                          summary.totalFundCfActualGbp - summary.totalFundCfForecastGbp
                        )}`}
                      >
                        {fmtMoney(summary.totalFundCfActualGbp - summary.totalFundCfForecastGbp)}
                      </div>
                      <div className="text-xs text-gray-500">{t('annualBudget.tracking.delta')}</div>
                    </div>
                  </div>
                </div>
              </div>

              {showBreakdown && (
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t('annualBudget.tracking.line')}</th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('annualBudget.sheet.forecast')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('annualBudget.sheet.actual')}
                        </th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t('annualBudget.tracking.delta')}
                        </th>
                        <th className="w-36 px-3 py-2 text-right font-medium">
                          {t('annualBudget.tracking.consumed')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.categories.map((cat) => {
                        const isBf = cat.id === ASSETS_BF_CATEGORY_ID;
                        const catRatio = budgetConsumptionRatio(cat.actualGbp, cat.forecastGbp);
                        const catDelta = cat.actualGbp - cat.forecastGbp;
                        return (
                          <React.Fragment key={cat.id}>
                            <tr className={cat.side === 'assets' ? 'bg-emerald-50/60' : 'bg-red-50/60'}>
                              <td className="px-3 py-2 font-semibold text-gray-900">
                                {cat.label}
                                {isBf && (
                                  <span className="ml-2 text-[10px] font-normal italic text-gray-500">
                                    {t('annualBudget.tracking.broughtForward')}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                                {fmtMoney(cat.forecastGbp)}
                              </td>
                              <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                                {fmtMoney(cat.actualGbp)}
                              </td>
                              <td
                                className={`px-3 py-2 text-right font-semibold tabular-nums ${deltaClass(catDelta)}`}
                              >
                                {fmtMoney(catDelta)}
                              </td>
                              <td className="px-3 py-2">
                                <ConsumptionBar
                                  ratio={catRatio}
                                  elapsed={elapsed}
                                  tone={cat.side === 'assets' ? 'income' : 'expense'}
                                />
                              </td>
                            </tr>
                            {cat.lines.map((line) => {
                              const lineRatio = budgetConsumptionRatio(
                                line.actualGbp,
                                line.forecastGbp
                              );
                              const lineDelta = line.actualGbp - line.forecastGbp;
                              return (
                                <tr
                                  key={line.id}
                                  className="border-t border-gray-100 hover:bg-gray-50/80"
                                >
                                  <td className="px-3 py-1.5 pl-6 text-gray-700">
                                    {line.label}
                                    {line.id === ASSETS_BANK_LINE_ID && (
                                      <span className="ml-1.5 text-[10px] text-gray-400">1 Jan</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-800">
                                    {fmtMoney(line.forecastGbp)}
                                  </td>
                                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-800">
                                    {fmtMoney(line.actualGbp)}
                                  </td>
                                  <td
                                    className={`px-3 py-1.5 text-right tabular-nums ${deltaClass(lineDelta)}`}
                                  >
                                    {fmtMoney(lineDelta)}
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <ConsumptionBar
                                      ratio={lineRatio}
                                      elapsed={elapsed}
                                      tone={line.side === 'assets' ? 'income' : 'expense'}
                                      compact
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
};

function ConsumptionBar({
  ratio,
  elapsed,
  tone,
  compact = false,
}: {
  ratio: number | null;
  elapsed: number;
  tone: 'income' | 'expense';
  compact?: boolean;
}) {
  if (ratio == null) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  const pct = Math.min(ratio * 100, 140);
  const over = ratio > 1.005;
  const aheadOfPace = elapsed > 0.02 && ratio > elapsed * 1.15;
  const barColor =
    tone === 'income'
      ? over || aheadOfPace
        ? 'bg-emerald-600'
        : 'bg-emerald-400'
      : over || aheadOfPace
        ? 'bg-red-600'
        : 'bg-red-400';

  return (
    <div className="flex items-center gap-2">
      <div className={`flex-1 overflow-hidden rounded-full bg-gray-200 ${compact ? 'h-1.5' : 'h-2'}`}>
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${barColor}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span
        className={`shrink-0 tabular-nums text-xs ${
          over
            ? tone === 'expense'
              ? 'font-semibold text-red-700'
              : 'font-semibold text-emerald-700'
            : 'text-gray-600'
        }`}
      >
        {pctLabel(ratio)}
      </span>
    </div>
  );
}

function TrackingKpiCard({
  title,
  tone,
  forecast,
  actual,
  ratio,
  elapsed,
  delta,
  invertDeltaGood,
  fmt,
  forecastLabel,
  actualLabel,
  vsBudgetLabel,
  paceLabel,
  useAbsolute = false,
}: {
  title: string;
  tone: 'income' | 'expense';
  forecast: number;
  actual: number;
  ratio: number | null;
  elapsed: number;
  delta: number;
  invertDeltaGood: boolean;
  fmt: (n: number) => string;
  forecastLabel: string;
  actualLabel: string;
  vsBudgetLabel: string;
  paceLabel: string;
  useAbsolute?: boolean;
}) {
  const displayForecast = useAbsolute ? Math.abs(forecast) : forecast;
  const displayActual = useAbsolute ? Math.abs(actual) : actual;
  const signedForColor = invertDeltaGood ? -delta : delta;
  const paceDelta = ratio != null && elapsed > 0.01 ? ratio - elapsed : null;
  const bg = tone === 'income' ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50';
  const titleColor = tone === 'income' ? 'text-emerald-900' : 'text-red-900';

  return (
    <div className={`rounded-lg border px-4 py-3 ${bg}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className={`text-sm font-bold ${titleColor}`}>{title}</h3>
        <span className={`text-sm font-semibold tabular-nums ${deltaClass(signedForColor)}`}>
          {vsBudgetLabel}: {pctLabel(ratio)}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-6 tabular-nums">
        <div>
          <div className="text-lg font-bold text-gray-900">{fmt(displayActual)}</div>
          <div className="text-xs text-gray-600">{actualLabel}</div>
        </div>
        <div>
          <div className="text-lg font-bold text-gray-700">{fmt(displayForecast)}</div>
          <div className="text-xs text-gray-600">{forecastLabel}</div>
        </div>
        <div>
          <div className={`text-lg font-bold ${deltaClass(signedForColor)}`}>
            {fmt(useAbsolute ? delta : actual - forecast)}
          </div>
          <div className="text-xs text-gray-600">Δ</div>
        </div>
      </div>
      <ConsumptionBar ratio={ratio} elapsed={elapsed} tone={tone} />
      {paceDelta != null && (
        <p className="mt-2 text-xs text-gray-600">
          {paceLabel}:{' '}
          <span
            className={
              tone === 'expense'
                ? paceDelta > 0.05
                  ? 'font-medium text-red-700'
                  : paceDelta < -0.05
                    ? 'font-medium text-emerald-700'
                    : 'text-gray-700'
                : paceDelta > 0.05
                  ? 'font-medium text-emerald-700'
                  : paceDelta < -0.05
                    ? 'font-medium text-amber-700'
                    : 'text-gray-700'
            }
          >
            {paceDelta > 0 ? '+' : ''}
            {Math.round(paceDelta * 100)} pt
          </span>
        </p>
      )}
    </div>
  );
}

export default AnnualBudgetTrackingSection;
