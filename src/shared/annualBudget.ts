/**
 * Snapshot budget annuel du profil (AppState/annual_budget.json).
 * Contient montants, affectations de types et structure du bilan par année.
 */

export type BudgetLine = { id: string; label: string };
export type BudgetCategory = { id: string; label: string; lines: BudgetLine[] };

export type BilanActualMode = 'auto' | 'manual';

export type BilanSpecialRowOptions = {
  enabled: boolean;
  actualMode: BilanActualMode;
  manualActualGbp?: number;
};

export const DEFAULT_BILAN_SPECIAL_ROW_OPTIONS: BilanSpecialRowOptions = {
  enabled: true,
  actualMode: 'auto',
};

export type BilanStructureSnapshot = {
  version: 1;
  assets: BudgetCategory[];
  liabilities: BudgetCategory[];
  categoryLabels: Record<string, string>;
  lineLabels: Record<string, string>;
  bankLineOptions?: BilanSpecialRowOptions;
};

export type YearSnapshot = {
  budgetValues: Record<string, number>;
  lineAssignedTypes: Record<string, string[]>;
  bilanStructure?: BilanStructureSnapshot;
};

export type AnnualBudgetSnapshotFile = {
  version: 1;
  byYear: Record<string, YearSnapshot>;
};

export function normalizeBilanSpecialRowOptions(raw: unknown): BilanSpecialRowOptions {
  if (typeof raw !== 'object' || raw === null) {
    return { ...DEFAULT_BILAN_SPECIAL_ROW_OPTIONS };
  }
  const o = raw as Record<string, unknown>;
  const enabled = o.enabled !== false;
  const actualMode: BilanActualMode = o.actualMode === 'manual' ? 'manual' : 'auto';
  const manual =
    typeof o.manualActualGbp === 'number' && Number.isFinite(o.manualActualGbp)
      ? o.manualActualGbp
      : undefined;
  return {
    enabled,
    actualMode,
    ...(manual !== undefined ? { manualActualGbp: manual } : {}),
  };
}

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

export function isBilanStructureSnapshot(x: unknown): x is BilanStructureSnapshot {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as BilanStructureSnapshot;
  if (o.version !== 1) return false;
  if (!Array.isArray(o.assets) || !Array.isArray(o.liabilities)) return false;
  if (!o.assets.every(isBudgetCategory) || !o.liabilities.every(isBudgetCategory)) return false;
  if (typeof o.categoryLabels !== 'object' || o.categoryLabels === null || Array.isArray(o.categoryLabels)) {
    return false;
  }
  if (typeof o.lineLabels !== 'object' || o.lineLabels === null || Array.isArray(o.lineLabels)) {
    return false;
  }
  return true;
}

export function cloneBilanStructure(data: BilanStructureSnapshot): BilanStructureSnapshot {
  return {
    version: 1,
    assets: data.assets.map((cat) => ({
      id: cat.id,
      label: cat.label,
      lines: cat.lines.map((l) => ({ id: l.id, label: l.label })),
    })),
    liabilities: data.liabilities.map((cat) => ({
      id: cat.id,
      label: cat.label,
      lines: cat.lines.map((l) => ({ id: l.id, label: l.label })),
    })),
    categoryLabels: { ...data.categoryLabels },
    lineLabels: { ...data.lineLabels },
    bankLineOptions: data.bankLineOptions
      ? normalizeBilanSpecialRowOptions(data.bankLineOptions)
      : undefined,
  };
}

function parseBudgetValues(raw: unknown): Record<string, number> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function parseLineAssignedTypes(raw: unknown): Record<string, string[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(v)) continue;
    out[k] = v.map((t) => String(t ?? '').trim()).filter(Boolean);
  }
  return out;
}

export function parseYearSnapshot(raw: unknown): YearSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const year: YearSnapshot = {
    budgetValues: parseBudgetValues(o.budgetValues),
    lineAssignedTypes: parseLineAssignedTypes(o.lineAssignedTypes),
  };
  if (o.bilanStructure !== undefined && isBilanStructureSnapshot(o.bilanStructure)) {
    year.bilanStructure = cloneBilanStructure(o.bilanStructure);
  }
  return year;
}

export function parseAnnualBudgetSnapshot(raw: unknown): AnnualBudgetSnapshotFile {
  const empty: AnnualBudgetSnapshotFile = { version: 1, byYear: {} };
  if (typeof raw !== 'object' || raw === null) return empty;
  const o = raw as Record<string, unknown>;
  const byYearRaw = o.byYear;
  if (typeof byYearRaw !== 'object' || byYearRaw === null || Array.isArray(byYearRaw)) return empty;
  const byYear: Record<string, YearSnapshot> = {};
  for (const [yearKey, yearVal] of Object.entries(byYearRaw as Record<string, unknown>)) {
    const y = parseInt(yearKey, 10);
    if (Number.isNaN(y) || y < 2000 || y > 2100) continue;
    const parsed = parseYearSnapshot(yearVal);
    if (parsed) byYear[String(y)] = parsed;
  }
  return { version: 1, byYear };
}

export function parseAnnualBudgetFilePayload(text: string): AnnualBudgetSnapshotFile {
  try {
    return parseAnnualBudgetSnapshot(JSON.parse(text) as unknown);
  } catch {
    return { version: 1, byYear: {} };
  }
}

export function serializeAnnualBudgetFile(snap: AnnualBudgetSnapshotFile): string {
  const payload: AnnualBudgetSnapshotFile = {
    version: 1,
    byYear: snap.byYear ?? {},
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** Fusionne deux snapshots : les années du `primary` gagnent ; années absentes viennent de `fallback`. */
export function mergeAnnualBudgetSnapshots(
  primary: AnnualBudgetSnapshotFile,
  fallback: AnnualBudgetSnapshotFile
): AnnualBudgetSnapshotFile {
  const byYear: Record<string, YearSnapshot> = { ...fallback.byYear };
  for (const [k, v] of Object.entries(primary.byYear)) {
    byYear[k] = v;
  }
  return { version: 1, byYear };
}
