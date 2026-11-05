import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '../utils/format';
import type { CurrencySymbol } from '../services/EffectiveExchangeRates';

export type BudgetProgressRow = {
  type: string;
  /** Réalisé du mois (magnitude, devise d’affichage). */
  actual: number;
  /** Objectif mensuel dérivé du budget annuel (magnitude, devise d’affichage). */
  budget: number;
};

export type MonthlyBudgetProgressSectionProps = {
  year: number;
  currency: CurrencySymbol;
  expenses: BudgetProgressRow[];
  income: BudgetProgressRow[];
  expanded: boolean;
  onToggleExpanded: () => void;
  /** true si un snapshot budget existe pour l’année (même sans lignes mappées). */
  hasBudgetSnapshot: boolean;
};

function ProgressBarRow({
  row,
  kind,
  currency,
}: {
  row: BudgetProgressRow;
  kind: 'expense' | 'income';
  currency: CurrencySymbol;
}) {
  const { t } = useTranslation();
  const budgetMag = Math.abs(row.budget);
  const actualMag = Math.abs(row.actual);
  const exceeded = budgetMag > 0 ? actualMag > budgetMag : actualMag > 0;
  const ratio = budgetMag > 0 ? actualMag / budgetMag : actualMag > 0 ? 1 : 0;
  /** Remplissage borné à 100 % de la piste (objectif = bord droit) ; le dépassement se lit en couleur + %. */
  const fillPercent = Math.min(100, ratio * 100);
  const pctLabel =
    budgetMag > 0
      ? t('monthlyAccounting.budgetProgress.percent', {
          value: Math.round(ratio * 100),
        })
      : actualMag > 0
        ? t('monthlyAccounting.budgetProgress.noBudgetTarget')
        : t('monthlyAccounting.budgetProgress.percent', { value: 0 });

  const trackClass = exceeded
    ? kind === 'expense'
      ? 'bg-red-100 ring-1 ring-inset ring-red-300'
      : 'bg-green-100 ring-1 ring-inset ring-green-300'
    : 'bg-gray-200';
  const fillClass = exceeded
    ? kind === 'expense'
      ? 'bg-red-500'
      : 'bg-green-500'
    : kind === 'expense'
      ? 'bg-slate-500'
      : 'bg-sky-600';
  const pctClass = exceeded
    ? kind === 'expense'
      ? 'text-red-700 font-semibold'
      : 'text-green-700 font-semibold'
    : 'text-gray-600';

  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-[minmax(0,11rem)_1fr_auto] gap-x-3 gap-y-1 items-center py-1.5 px-1 rounded-md ${
        exceeded ? (kind === 'expense' ? 'bg-red-50/80' : 'bg-green-50/80') : ''
      }`}
    >
      <div className="min-w-0 flex justify-between gap-2 sm:block">
        <span className="text-sm text-gray-800 truncate" title={row.type}>
          {row.type}
        </span>
        <span
          className={`sm:hidden text-xs tabular-nums flex-shrink-0 ${pctClass}`}
          title={pctLabel}
        >
          {pctLabel}
        </span>
      </div>
      <div className="min-w-0 w-full">
        <div
          className={`h-3.5 w-full overflow-hidden rounded-sm ${trackClass}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fillPercent)}
          aria-label={`${row.type}: ${pctLabel}`}
        >
          <div
            className={`h-full transition-[width,background-color] duration-300 ease-out ${fillClass}`}
            style={{ width: `${fillPercent}%` }}
          />
        </div>
        <div className="mt-0.5 flex justify-between gap-2 text-[11px] tabular-nums text-gray-500">
          <span>{formatCurrency(0, currency)}</span>
          <span className="truncate text-right">
            {t('monthlyAccounting.budgetProgress.actualVsBudget', {
              actual: formatCurrency(actualMag, currency),
              budget: formatCurrency(budgetMag, currency),
            })}
          </span>
        </div>
      </div>
      <span
        className={`hidden sm:inline-block text-sm tabular-nums w-14 text-right flex-shrink-0 ${pctClass}`}
        title={pctLabel}
      >
        {pctLabel}
      </span>
    </div>
  );
}

function Group({
  title,
  rows,
  kind,
  currency,
  emptyLabel,
}: {
  title: string;
  rows: BudgetProgressRow[];
  kind: 'expense' | 'income';
  currency: CurrencySymbol;
  emptyLabel: string;
}) {
  return (
    <div className="min-w-0 flex-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200 pb-1 mb-2">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 italic py-2">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map((row) => (
            <ProgressBarRow key={`${kind}-${row.type}`} row={row} kind={kind} currency={currency} />
          ))}
        </div>
      )}
    </div>
  );
}

const MonthlyBudgetProgressSection: React.FC<MonthlyBudgetProgressSectionProps> = ({
  year,
  currency,
  expenses,
  income,
  expanded,
  onToggleExpanded,
  hasBudgetSnapshot,
}) => {
  const { t } = useTranslation();
  const hasRows = expenses.length > 0 || income.length > 0;

  return (
    <section className="flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden mb-6">
      <header
        className={`bg-gradient-to-br from-slate-50 to-white ${
          expanded ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
        }`}
      >
        <button
          type="button"
          className="w-full px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
        >
          <span
            className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
              expanded ? 'rotate-90' : ''
            }`}
            aria-hidden
          >
            ▶
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">
              {t('monthlyAccounting.budgetProgress.title')}
            </span>
            <span className="block text-sm text-gray-500 mt-1.5">
              {t('monthlyAccounting.budgetProgress.subtitle', { year })}
            </span>
          </span>
        </button>
      </header>
      {expanded && (
        <div className="px-4 py-4">
          {!hasBudgetSnapshot ? (
            <p className="text-sm text-gray-600">{t('monthlyAccounting.budgetProgress.noSnapshot')}</p>
          ) : !hasRows ? (
            <p className="text-sm text-gray-600">{t('monthlyAccounting.budgetProgress.noMappedTypes')}</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-4 leading-snug">
                {t('monthlyAccounting.budgetProgress.legend')}
              </p>
              <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
                <Group
                  title={t('dashboard.series.exits')}
                  rows={expenses}
                  kind="expense"
                  currency={currency}
                  emptyLabel={t('monthlyAccounting.budgetProgress.emptyExpenses')}
                />
                <Group
                  title={t('dashboard.series.entries')}
                  rows={income}
                  kind="income"
                  currency={currency}
                  emptyLabel={t('monthlyAccounting.budgetProgress.emptyIncome')}
                />
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
};

export default MonthlyBudgetProgressSection;
