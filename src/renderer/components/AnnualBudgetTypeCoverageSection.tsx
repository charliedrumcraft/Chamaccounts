import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getDefaultLineAssignedTypes } from '../constants/annualBudgetTypeMapping';
import type { BudgetCategory } from '../services/annualBudgetStorage';

/** Clé de type produite par l’agrégation quand le type est vide : identifiant de donnée, non traduit. */
const NO_TYPE_KEY = 'Sans type';

type CoverageLineRef = {
  lineId: string;
  lineLabel: string;
  categoryId: string;
  categoryLabel: string;
  side: 'assets' | 'liabilities';
};

type CoverageTypeRow = {
  type: string;
  amount: number;
  kind: 'income' | 'expense';
  assignedLines: CoverageLineRef[];
};

type LineGroup = {
  line: CoverageLineRef;
  types: CoverageTypeRow[];
};

type CategoryGroup = {
  categoryId: string;
  categoryLabel: string;
  lines: LineGroup[];
};

function assignedTypesForLine(
  lineId: string,
  lineAssignedTypes: Record<string, string[]>,
  defaultMap: Record<string, string[]>
): string[] {
  return lineAssignedTypes[lineId] !== undefined
    ? lineAssignedTypes[lineId]
    : (defaultMap[lineId] ?? []);
}

function collectLineRefs(
  assets: BudgetCategory[],
  liabilities: BudgetCategory[],
  categoryLabels: Record<string, string>,
  lineLabels: Record<string, string>
): CoverageLineRef[] {
  const refs: CoverageLineRef[] = [];
  const pushSide = (cats: BudgetCategory[], side: 'assets' | 'liabilities') => {
    for (const cat of cats) {
      const categoryLabel = categoryLabels[cat.id] ?? cat.label;
      for (const line of cat.lines ?? []) {
        if (!line?.id) continue;
        refs.push({
          lineId: line.id,
          lineLabel: lineLabels[line.id] ?? line.label,
          categoryId: cat.id,
          categoryLabel,
          side,
        });
      }
    }
  };
  pushSide(assets, 'assets');
  pushSide(liabilities, 'liabilities');
  return refs;
}

function groupByCategory(groups: LineGroup[]): CategoryGroup[] {
  const out: CategoryGroup[] = [];
  for (const group of groups) {
    const last = out[out.length - 1];
    if (last && last.categoryId === group.line.categoryId) {
      last.lines.push(group);
    } else {
      out.push({
        categoryId: group.line.categoryId,
        categoryLabel: group.line.categoryLabel,
        lines: [group],
      });
    }
  }
  return out;
}

export type AnnualBudgetTypeCoverageSectionProps = {
  selectedYear: number;
  byType: Record<string, number>;
  lineAssignedTypes: Record<string, string[]>;
  budgetedAssets: BudgetCategory[];
  budgetedLiabilities: BudgetCategory[];
  categoryLabels: Record<string, string>;
  lineLabels: Record<string, string>;
  fmtMoney: (gbpAmount: number) => string;
  expanded: boolean;
  onToggleExpanded: () => void;
};

const AnnualBudgetTypeCoverageSection: React.FC<AnnualBudgetTypeCoverageSectionProps> = ({
  selectedYear,
  byType,
  lineAssignedTypes,
  budgetedAssets,
  budgetedLiabilities,
  categoryLabels,
  lineLabels,
  fmtMoney,
  expanded,
  onToggleExpanded,
}) => {
  const { t } = useTranslation();
  const displayTypeName = (type: string): string =>
    type === NO_TYPE_KEY ? t('annualBudget.noType') : type;
  const coverage = useMemo(() => {
    const defaultMap = getDefaultLineAssignedTypes();
    const lineRefs = collectLineRefs(
      Array.isArray(budgetedAssets) ? budgetedAssets : [],
      Array.isArray(budgetedLiabilities) ? budgetedLiabilities : [],
      categoryLabels,
      lineLabels
    );
    const typeToLines = new Map<string, CoverageLineRef[]>();
    for (const ref of lineRefs) {
      const seen = new Set<string>();
      for (const typeName of assignedTypesForLine(ref.lineId, lineAssignedTypes, defaultMap)) {
        if (seen.has(typeName)) continue;
        seen.add(typeName);
        const list = typeToLines.get(typeName) ?? [];
        list.push(ref);
        typeToLines.set(typeName, list);
      }
    }

    const rows: CoverageTypeRow[] = Object.entries(byType)
      .filter(([type, amount]) => type.trim() !== '' && amount !== 0)
      .map(([type, amount]) => ({
        type,
        amount,
        kind: amount > 0 ? ('income' as const) : ('expense' as const),
        assignedLines: typeToLines.get(type) ?? [],
      }))
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    const unassigned = rows.filter((r) => r.assignedLines.length === 0);
    const assigned = rows.filter((r) => r.assignedLines.length > 0);
    const typesByLineId = new Map<string, CoverageTypeRow[]>();
    for (const row of assigned) {
      for (const line of row.assignedLines) {
        const list = typesByLineId.get(line.lineId) ?? [];
        list.push(row);
        typesByLineId.set(line.lineId, list);
      }
    }

    const lineGroups: LineGroup[] = lineRefs
      .map((line) => ({
        line,
        types: typesByLineId.get(line.lineId) ?? [],
      }))
      .filter((g) => g.types.length > 0);

    return {
      unassignedIncome: unassigned.filter((r) => r.kind === 'income'),
      unassignedExpense: unassigned.filter((r) => r.kind === 'expense'),
      assetCategories: groupByCategory(lineGroups.filter((g) => g.line.side === 'assets')),
      liabilityCategories: groupByCategory(lineGroups.filter((g) => g.line.side === 'liabilities')),
      totalWithAmount: rows.length,
      assignedCount: assigned.length,
      unassignedCount: unassigned.length,
    };
  }, [
    byType,
    lineAssignedTypes,
    budgetedAssets,
    budgetedLiabilities,
    categoryLabels,
    lineLabels,
  ]);

  const statusLabel =
    coverage.totalWithAmount === 0
      ? t('annualBudget.coverage.status.none')
      : coverage.unassignedCount === 0
        ? t('annualBudget.coverage.status.allAssigned')
        : t('annualBudget.coverage.status.unassigned', { count: coverage.unassignedCount });

  return (
    <section
      className="mb-8 flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden"
      aria-labelledby="annual-budget-bloc-coverage-title"
    >
      <header
        className={`bg-gradient-to-br from-slate-50 to-white ${
          expanded ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-stretch">
          <button
            type="button"
            className="flex flex-1 items-start gap-3 px-4 py-3 sm:py-4 text-left transition-colors hover:bg-slate-50/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
            aria-expanded={expanded}
            aria-controls={expanded ? 'annual-budget-panel-coverage' : undefined}
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
                id="annual-budget-bloc-coverage-title"
                className="block text-xl font-bold tracking-tight text-gray-900 sm:text-2xl"
              >
                {t('annualBudget.coverage.title')}
              </span>
              <span className="mt-1.5 block text-sm text-gray-500">
                <strong className="font-semibold text-gray-600">
                  {t('annualBudget.yearLabel', { year: selectedYear })}
                </strong>
                {' — '}
                {t('annualBudget.coverage.subtitle')}
              </span>
            </span>
          </button>
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 bg-slate-50/60 px-4 py-2.5 sm:border-t-0 sm:border-l sm:border-gray-200 sm:bg-transparent sm:px-4 sm:py-3">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                coverage.totalWithAmount === 0
                  ? 'bg-gray-100 text-gray-600'
                  : coverage.unassignedCount === 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-900'
              }`}
            >
              {statusLabel}
            </span>
            {coverage.totalWithAmount > 0 ? (
              <span className="text-xs tabular-nums text-gray-500">
                {coverage.assignedCount}/{coverage.totalWithAmount}
              </span>
            ) : null}
          </div>
        </div>
      </header>
      {expanded ? (
        <div
          id="annual-budget-panel-coverage"
          className="flex min-h-0 flex-col gap-4 px-4 pb-4 pt-3"
          role="region"
          aria-label={t('annualBudget.coverage.title')}
        >
          {coverage.totalWithAmount === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-slate-50 px-4 py-3 text-sm text-gray-600">
              {t('annualBudget.coverage.empty', { year: selectedYear })}
            </p>
          ) : (
            <>
              {coverage.unassignedCount > 0 ? (
                <div
                  className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3"
                  role="alert"
                >
                  <p className="text-sm font-semibold text-amber-950">
                    {t('annualBudget.coverage.alert', { count: coverage.unassignedCount })}
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    {t('annualBudget.coverage.alertHint')}
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <UnassignedList
                      title={t('annualBudget.coverage.unassignedIncome')}
                      emptyLabel={t('annualBudget.coverage.unassignedIncomeEmpty')}
                      rows={coverage.unassignedIncome}
                      fmtMoney={fmtMoney}
                      displayTypeName={displayTypeName}
                      tone="income"
                    />
                    <UnassignedList
                      title={t('annualBudget.coverage.unassignedExpense')}
                      emptyLabel={t('annualBudget.coverage.unassignedExpenseEmpty')}
                      rows={coverage.unassignedExpense}
                      fmtMoney={fmtMoney}
                      displayTypeName={displayTypeName}
                      tone="expense"
                    />
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                  {t('annualBudget.coverage.allAssignedMessage')}
                </p>
              )}

              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-inner">
                <div className="grid grid-cols-1 md:grid-cols-2 border-b border-gray-200">
                  <div className="bg-emerald-100 py-1.5 px-4 text-sm font-semibold text-emerald-900">
                    {t('annualBudget.coverage.assetsHeader')}
                  </div>
                  <div className="bg-red-100 py-1.5 px-4 text-sm font-semibold text-red-900 md:border-l border-gray-200">
                    {t('annualBudget.coverage.liabilitiesHeader')}
                  </div>
                </div>
                <div className="flex flex-col md:flex-row">
                  <CoverageSideColumn
                    categories={coverage.assetCategories}
                    emptyLabel={t('annualBudget.coverage.assetsEmpty')}
                    fmtMoney={fmtMoney}
                    displayTypeName={displayTypeName}
                    tone="assets"
                  />
                  <CoverageSideColumn
                    categories={coverage.liabilityCategories}
                    emptyLabel={t('annualBudget.coverage.liabilitiesEmpty')}
                    fmtMoney={fmtMoney}
                    displayTypeName={displayTypeName}
                    tone="liabilities"
                  />
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
};

function UnassignedList({
  title,
  emptyLabel,
  rows,
  fmtMoney,
  displayTypeName,
  tone,
}: {
  title: string;
  emptyLabel: string;
  rows: CoverageTypeRow[];
  fmtMoney: (n: number) => string;
  displayTypeName: (type: string) => string;
  tone: 'income' | 'expense';
}) {
  const amountClass = tone === 'income' ? 'text-emerald-800' : 'text-red-800';
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-1 text-xs text-amber-700">{emptyLabel}</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {rows.map((row) => (
            <li
              key={row.type}
              className="flex items-baseline justify-between gap-3 rounded border border-amber-200 bg-white px-2 py-1 text-sm"
            >
              <span className="min-w-0 truncate font-medium text-gray-800">{displayTypeName(row.type)}</span>
              <span className={`shrink-0 tabular-nums ${amountClass}`}>{fmtMoney(row.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CoverageSideColumn({
  categories,
  emptyLabel,
  fmtMoney,
  displayTypeName,
  tone,
}: {
  categories: CategoryGroup[];
  emptyLabel: string;
  fmtMoney: (n: number) => string;
  displayTypeName: (type: string) => string;
  tone: 'assets' | 'liabilities';
}) {
  const catBg = tone === 'assets' ? 'bg-emerald-50' : 'bg-red-50';
  const border = tone === 'assets' ? 'border-emerald-100' : 'border-red-100';
  const mdBorder = tone === 'liabilities' ? 'border-t md:border-t-0 md:border-l border-gray-200' : '';

  return (
    <div className={`flex-1 min-w-0 ${mdBorder}`}>
      {categories.length === 0 ? (
        <p className="px-4 py-3 text-sm text-gray-500">{emptyLabel}</p>
      ) : (
        <div className="divide-y divide-gray-100">
          {categories.map((cat) => (
            <div key={cat.categoryId}>
              <div className={`${catBg} px-4 py-1.5 text-sm font-semibold text-gray-800`}>
                {cat.categoryLabel}
              </div>
              {cat.lines.map((group) => (
                <div
                  key={group.line.lineId}
                  className={`border-l-2 ${border} bg-white px-4 py-2 pl-8`}
                >
                  <p className="text-sm font-medium text-gray-800">{group.line.lineLabel}</p>
                  <ul className="mt-1 space-y-0.5">
                    {group.types.map((row) => (
                      <li
                        key={`${group.line.lineId}-${row.type}`}
                        className="flex items-baseline justify-between gap-3 text-sm"
                      >
                        <span className="min-w-0 truncate text-gray-700">{displayTypeName(row.type)}</span>
                        <span
                          className={`shrink-0 tabular-nums ${
                            row.amount >= 0 ? 'text-emerald-800' : 'text-red-800'
                          }`}
                        >
                          {fmtMoney(row.amount)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AnnualBudgetTypeCoverageSection;
