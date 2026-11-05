import { getDefaultLineAssignedTypes } from '../constants/annualBudgetTypeMapping';
import {
  type BilanSpecialRowOptions,
  type BudgetCategory,
  DEFAULT_BILAN_SPECIAL_ROW_OPTIONS,
  getYearBilanStructure,
  getYearSnapshot,
  normalizeBilanSpecialRowOptions,
} from './annualBudgetStorage';

/** Ligne spéciale Bank (soldes au 1er janvier) — alignée sur AnnualBudget.tsx. */
export const ASSETS_BF_CATEGORY_ID = 'assets-bf';
export const ASSETS_BANK_LINE_ID = 'assets-bank';

export type BudgetTrackingLine = {
  id: string;
  label: string;
  categoryId: string;
  categoryLabel: string;
  side: 'assets' | 'liabilities';
  isBankLine: boolean;
  forecastGbp: number;
  actualGbp: number;
};

export type BudgetTrackingCategory = {
  id: string;
  label: string;
  side: 'assets' | 'liabilities';
  lines: BudgetTrackingLine[];
  forecastGbp: number;
  actualGbp: number;
};

export type AnnualBudgetTrackingSummary = {
  year: number;
  hasBudgetSheet: boolean;
  categories: BudgetTrackingCategory[];
  /** Recettes budgétisées (actifs hors Assets B/F / Bank). */
  incomeForecastGbp: number;
  incomeActualGbp: number;
  /** Dépenses budgétisées (passifs, montants signés ≤ 0). */
  expenseForecastGbp: number;
  expenseActualGbp: number;
  totalAssetsForecastGbp: number;
  totalAssetsActualGbp: number;
  totalLiabilitiesForecastGbp: number;
  totalLiabilitiesActualGbp: number;
  totalFundCfForecastGbp: number;
  totalFundCfActualGbp: number;
};

const DEFAULT_ASSETS: BudgetCategory[] = [
  {
    id: ASSETS_BF_CATEGORY_ID,
    label: 'Assets B/F',
    lines: [{ id: ASSETS_BANK_LINE_ID, label: 'Bank' }],
  },
];

function deepCloneCategories(cats: BudgetCategory[]): BudgetCategory[] {
  return cats.map((cat) => ({
    id: cat.id,
    label: cat.label,
    lines: cat.lines.map((l) => ({ id: l.id, label: l.label })),
  }));
}

function normalizeLiabilityForecastValue(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  return -Math.abs(value);
}

function collectLiabilityLineIds(liabilities: BudgetCategory[]): Set<string> {
  const s = new Set<string>();
  for (const cat of liabilities) {
    for (const line of cat.lines) s.add(line.id);
  }
  return s;
}

function isBroughtForwardLine(lineId: string, categoryId: string): boolean {
  return lineId === ASSETS_BANK_LINE_ID || categoryId === ASSETS_BF_CATEGORY_ID;
}

/**
 * Fraction de l’année civile écoulée (0–1).
 * Années passées → 1 ; années futures → 0.
 */
export function yearElapsedFraction(year: number, now: Date = new Date()): number {
  if (year < now.getFullYear()) return 1;
  if (year > now.getFullYear()) return 0;
  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year + 1, 0, 1).getTime();
  const t = now.getTime();
  if (t <= start) return 0;
  if (t >= end) return 1;
  return (t - start) / (end - start);
}

/** Ratio réel / budget (valeurs absolues). null si budget ≈ 0. */
export function budgetConsumptionRatio(actual: number, forecast: number): number | null {
  const f = Math.abs(forecast);
  if (f < 0.005) return null;
  return Math.abs(actual) / f;
}

/** Données bilan en mémoire (page Budget annuel) pour un suivi live sans attendre le persist. */
export type AnnualBudgetTrackingLiveSheet = {
  budgetValues: Record<string, number>;
  lineAssignedTypes: Record<string, string[]>;
  assets: BudgetCategory[];
  liabilities: BudgetCategory[];
  categoryLabels: Record<string, string>;
  lineLabels: Record<string, string>;
  bankLineOptions: BilanSpecialRowOptions;
};

/**
 * Construit le suivi budget vs réel pour une année à partir du snapshot local
 * (ou d’une feuille live) et des totaux par type + solde Bank au 1er janvier.
 */
export function buildAnnualBudgetTrackingSummary(params: {
  year: number;
  byType: Record<string, number>;
  bankBalanceJan1Gbp: number | null;
  live?: AnnualBudgetTrackingLiveSheet;
}): AnnualBudgetTrackingSummary {
  const { year, byType, bankBalanceJan1Gbp, live } = params;
  const snap = live ? null : getYearSnapshot(year);
  const structure = live ? null : getYearBilanStructure(year);

  const assets = live?.assets?.length
    ? deepCloneCategories(live.assets)
    : structure?.assets?.length
      ? deepCloneCategories(structure.assets)
      : deepCloneCategories(DEFAULT_ASSETS);
  const liabilities = live?.liabilities
    ? deepCloneCategories(live.liabilities)
    : structure?.liabilities?.length
      ? deepCloneCategories(structure.liabilities)
      : [];

  const categoryLabels = {
    ...(live?.categoryLabels ?? structure?.categoryLabels ?? {}),
  };
  const lineLabels = { ...(live?.lineLabels ?? structure?.lineLabels ?? {}) };
  for (const cat of [...assets, ...liabilities]) {
    if (!categoryLabels[cat.id]) categoryLabels[cat.id] = cat.label;
    for (const line of cat.lines) {
      if (!lineLabels[line.id]) lineLabels[line.id] = line.label;
    }
  }

  const bankLineOptions: BilanSpecialRowOptions = normalizeBilanSpecialRowOptions(
    live?.bankLineOptions ?? structure?.bankLineOptions ?? DEFAULT_BILAN_SPECIAL_ROW_OPTIONS
  );

  const liabilityIds = collectLiabilityLineIds(liabilities);
  const budgetValues: Record<string, number> = {
    ...(live?.budgetValues ?? snap?.budgetValues ?? {}),
  };
  for (const id of liabilityIds) {
    if (Object.prototype.hasOwnProperty.call(budgetValues, id)) {
      budgetValues[id] = normalizeLiabilityForecastValue(budgetValues[id]);
    }
  }

  const lineAssignedTypes = live?.lineAssignedTypes
    ? { ...live.lineAssignedTypes }
    : snap?.lineAssignedTypes
      ? { ...snap.lineAssignedTypes }
      : {};
  const defaultMap = getDefaultLineAssignedTypes();

  const allLineIds: string[] = [];
  for (const cat of assets) for (const line of cat.lines) allLineIds.push(line.id);
  for (const cat of liabilities) for (const line of cat.lines) allLineIds.push(line.id);

  const actualFromTypes: Record<string, number> = {};
  for (const id of allLineIds) actualFromTypes[id] = 0;
  for (const [type, amount] of Object.entries(byType)) {
    const trimmed = type.trim();
    for (const lineId of allLineIds) {
      const assigned =
        lineAssignedTypes[lineId] !== undefined
          ? lineAssignedTypes[lineId]
          : (defaultMap[lineId] ?? []);
      if (assigned.includes(trimmed)) actualFromTypes[lineId] += amount;
    }
  }

  const getActual = (lineId: string): number => {
    if (lineId === ASSETS_BANK_LINE_ID) {
      if (bankLineOptions.actualMode === 'manual') return bankLineOptions.manualActualGbp ?? 0;
      return bankBalanceJan1Gbp ?? 0;
    }
    return actualFromTypes[lineId] ?? 0;
  };

  const getForecast = (lineId: string): number => budgetValues[lineId] ?? 0;

  const categories: BudgetTrackingCategory[] = [];
  let incomeForecastGbp = 0;
  let incomeActualGbp = 0;
  let expenseForecastGbp = 0;
  let expenseActualGbp = 0;
  let totalAssetsForecastGbp = 0;
  let totalAssetsActualGbp = 0;
  let totalLiabilitiesForecastGbp = 0;
  let totalLiabilitiesActualGbp = 0;

  const pushSide = (side: 'assets' | 'liabilities', cats: BudgetCategory[]) => {
    for (const cat of cats) {
      const lines: BudgetTrackingLine[] = [];
      let catForecast = 0;
      let catActual = 0;
      for (const line of cat.lines) {
        if (line.id === ASSETS_BANK_LINE_ID && !bankLineOptions.enabled) continue;
        const forecastGbp = getForecast(line.id);
        const actualGbp = getActual(line.id);
        lines.push({
          id: line.id,
          label: lineLabels[line.id] ?? line.label,
          categoryId: cat.id,
          categoryLabel: categoryLabels[cat.id] ?? cat.label,
          side,
          isBankLine: line.id === ASSETS_BANK_LINE_ID,
          forecastGbp,
          actualGbp,
        });
        catForecast += forecastGbp;
        catActual += actualGbp;

        if (side === 'assets') {
          totalAssetsForecastGbp += forecastGbp;
          totalAssetsActualGbp += actualGbp;
          if (!isBroughtForwardLine(line.id, cat.id)) {
            incomeForecastGbp += forecastGbp;
            incomeActualGbp += actualGbp;
          }
        } else {
          totalLiabilitiesForecastGbp += forecastGbp;
          totalLiabilitiesActualGbp += actualGbp;
          expenseForecastGbp += forecastGbp;
          expenseActualGbp += actualGbp;
        }
      }
      if (lines.length === 0 && side === 'assets' && cat.id === ASSETS_BF_CATEGORY_ID && !bankLineOptions.enabled) {
        continue;
      }
      categories.push({
        id: cat.id,
        label: categoryLabels[cat.id] ?? cat.label,
        side,
        lines,
        forecastGbp: catForecast,
        actualGbp: catActual,
      });
    }
  };

  pushSide('assets', assets);
  pushSide('liabilities', liabilities);

  return {
    year,
    hasBudgetSheet: live != null || snap != null || structure != null,
    categories,
    incomeForecastGbp,
    incomeActualGbp,
    expenseForecastGbp,
    expenseActualGbp,
    totalAssetsForecastGbp,
    totalAssetsActualGbp,
    totalLiabilitiesForecastGbp,
    totalLiabilitiesActualGbp,
    totalFundCfForecastGbp: totalAssetsForecastGbp + totalLiabilitiesForecastGbp,
    totalFundCfActualGbp: totalAssetsActualGbp + totalLiabilitiesActualGbp,
  };
}
