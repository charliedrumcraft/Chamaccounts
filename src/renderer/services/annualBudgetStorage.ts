export const ANNUAL_BUDGET_SNAPSHOT_KEY = 'annual-budget-snapshot-v1';

/**
 * Ancienne clé globale (pré-structure par année).
 * Conservée en lecture seule pour migrer vers le snapshot de chaque année.
 */
export const ANNUAL_BUDGET_BILAN_STRUCTURE_KEY = 'annual-budget-bilan-structure-v1';

/** Données forecast / affectations / structure pour une année (Budget annuel). */
export type YearSnapshot = {
  budgetValues: Record<string, number>;
  lineAssignedTypes: Record<string, string[]>;
  /** Structure du bilan propre à cette année (lignes, catégories, libellés). */
  bilanStructure?: BilanStructureSnapshot;
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

export function isBilanStructureSnapshot(x: unknown): x is BilanStructureSnapshot {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as BilanStructureSnapshot;
  if (o.version !== 1) return false;
  if (!Array.isArray(o.assets) || !Array.isArray(o.liabilities)) return false;
  if (!o.assets.every(isBudgetCategory) || !o.liabilities.every(isBudgetCategory)) return false;
  if (typeof o.categoryLabels !== 'object' || o.categoryLabels === null || Array.isArray(o.categoryLabels)) return false;
  if (typeof o.lineLabels !== 'object' || o.lineLabels === null || Array.isArray(o.lineLabels)) return false;
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
  };
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

/** Années pour lesquelles un snapshot budget existe déjà, triées croissant. */
export function listBudgetYears(): number[] {
  const byYear = loadAnnualBudgetSnapshot().byYear;
  return Object.keys(byYear)
    .map((k) => parseInt(k, 10))
    .filter((y) => !Number.isNaN(y) && y >= 2000 && y <= 2100)
    .sort((a, b) => a - b);
}

function persistAnnualBudgetSnapshot(snap: AnnualBudgetSnapshotFile): void {
  localStorage.setItem(ANNUAL_BUDGET_SNAPSHOT_KEY, JSON.stringify(snap));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('annual-budget-snapshot-changed'));
  }
}

/**
 * Enregistre le snapshot d’une année.
 * Si `bilanStructure` est omis, la structure déjà stockée pour cette année est conservée.
 */
export function saveYearSnapshot(year: number, data: YearSnapshot): void {
  try {
    const snap = loadAnnualBudgetSnapshot();
    const prev = snap.byYear[String(year)];
    snap.byYear[String(year)] = {
      budgetValues: data.budgetValues,
      lineAssignedTypes: data.lineAssignedTypes,
      bilanStructure:
        data.bilanStructure !== undefined
          ? data.bilanStructure
          : prev?.bilanStructure,
    };
    persistAnnualBudgetSnapshot(snap);
  } catch {
    /* ignore */
  }
}

/** Ancienne structure globale (migration). */
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

/**
 * Une fois : si aucune année n’a encore de structure propre, copie l’ancienne
 * structure globale vers chaque année déjà présente dans `byYear`.
 */
function ensureBilanStructuresMigrated(): void {
  try {
    const snap = loadAnnualBudgetSnapshot();
    const entries = Object.entries(snap.byYear);
    if (entries.length === 0) return;
    if (entries.some(([, y]) => y.bilanStructure && isBilanStructureSnapshot(y.bilanStructure))) {
      return;
    }
    const legacy = loadBilanStructureSnapshot();
    if (!legacy) return;
    for (const [key, y] of entries) {
      snap.byYear[key] = { ...y, bilanStructure: cloneBilanStructure(legacy) };
    }
    persistAnnualBudgetSnapshot(snap);
  } catch {
    /* ignore */
  }
}

/**
 * Structure du bilan pour une année.
 * Absent → null (la page utilise le modèle par défaut).
 */
export function getYearBilanStructure(year: number): BilanStructureSnapshot | null {
  ensureBilanStructuresMigrated();
  const yearSnap = getYearSnapshot(year);
  if (yearSnap?.bilanStructure && isBilanStructureSnapshot(yearSnap.bilanStructure)) {
    return yearSnap.bilanStructure;
  }
  return null;
}

/** Enregistre la structure du bilan pour une année (crée le snapshot d’année si besoin). */
export function saveYearBilanStructure(year: number, data: BilanStructureSnapshot): void {
  try {
    const snap = loadAnnualBudgetSnapshot();
    const prev = snap.byYear[String(year)] ?? {
      budgetValues: {},
      lineAssignedTypes: {},
    };
    snap.byYear[String(year)] = {
      ...prev,
      bilanStructure: cloneBilanStructure(data),
    };
    persistAnnualBudgetSnapshot(snap);
  } catch {
    /* ignore */
  }
}

/**
 * @deprecated Préférer saveYearBilanStructure. Conservée pour lecture des anciens exports.
 */
export function saveBilanStructureSnapshot(data: BilanStructureSnapshot): void {
  try {
    localStorage.setItem(ANNUAL_BUDGET_BILAN_STRUCTURE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}
