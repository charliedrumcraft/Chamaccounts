export const ANNUAL_BUDGET_SNAPSHOT_KEY = 'annual-budget-snapshot-v1';

/** Clé séparée : structure des feuilles de bilan (catégories, lignes, libellés édités). Incluse dans l’export AppState. */
export const ANNUAL_BUDGET_BILAN_STRUCTURE_KEY = 'annual-budget-bilan-structure-v1';

/** Données forecast / affectations pour une année (Budget annuel). */
export type YearSnapshot = {
  budgetValues: Record<string, number>;
  lineAssignedTypes: Record<string, string[]>;
};

export type AnnualBudgetSnapshotFile = {
  byYear: Record<string, YearSnapshot>;
};

/** Ligne / catégorie du bilan budgétisé (Budget annuel). */
export type BudgetLine = { id: string; label: string };
export type BudgetCategory = { id: string; label: string; lines: BudgetLine[] };

/** Snapshot persistant de la structure éditable du bilan (actif / passif + libellés affichés). */
export type BilanStructureSnapshot = {
  version: 1;
  assets: BudgetCategory[];
  liabilities: BudgetCategory[];
  categoryLabels: Record<string, string>;
  lineLabels: Record<string, string>;
};

function isBudgetLine(x: unknown): x is BudgetLine {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as BudgetLine).id === 'string' &&
    typeof (x as BudgetLine).label === 'string'
  );
}

function isBudgetCategory(x: unknown): x is BudgetCategory {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as BudgetCategory;
  if (typeof o.id !== 'string' || typeof o.label !== 'string') return false;
  if (!Array.isArray(o.lines)) return false;
  return o.lines.every(isBudgetLine);
}

function isBilanStructureSnapshot(x: unknown): x is BilanStructureSnapshot {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as BilanStructureSnapshot;
  if (o.version !== 1) return false;
  if (!Array.isArray(o.assets) || !Array.isArray(o.liabilities)) return false;
  if (!o.assets.every(isBudgetCategory) || !o.liabilities.every(isBudgetCategory)) return false;
  if (typeof o.categoryLabels !== 'object' || o.categoryLabels === null || Array.isArray(o.categoryLabels)) return false;
  if (typeof o.lineLabels !== 'object' || o.lineLabels === null || Array.isArray(o.lineLabels)) return false;
  return true;
}

export function loadAnnualBudgetSnapshot(): AnnualBudgetSnapshotFile {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(ANNUAL_BUDGET_SNAPSHOT_KEY) : null;
    if (!raw) return { byYear: {} };
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== 'object' || !('byYear' in (p as object))) return { byYear: {} };
    return p as AnnualBudgetSnapshotFile;
  } catch {
    return { byYear: {} };
  }
}

export function getYearSnapshot(year: number): YearSnapshot | null {
  const s = loadAnnualBudgetSnapshot().byYear[String(year)];
  return s ?? null;
}

export function saveYearSnapshot(year: number, data: YearSnapshot): void {
  try {
    const snap = loadAnnualBudgetSnapshot();
    snap.byYear[String(year)] = data;
    localStorage.setItem(ANNUAL_BUDGET_SNAPSHOT_KEY, JSON.stringify(snap));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('annual-budget-snapshot-changed'));
    }
  } catch {
    /* ignore */
  }
}

export function loadBilanStructureSnapshot(): BilanStructureSnapshot | null {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(ANNUAL_BUDGET_BILAN_STRUCTURE_KEY) : null;
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (!isBilanStructureSnapshot(p)) return null;
    return p;
  } catch {
    return null;
  }
}

export function saveBilanStructureSnapshot(data: BilanStructureSnapshot): void {
  try {
    localStorage.setItem(ANNUAL_BUDGET_BILAN_STRUCTURE_KEY, JSON.stringify(data));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('annual-budget-snapshot-changed'));
    }
  } catch {
    /* ignore */
  }
}
