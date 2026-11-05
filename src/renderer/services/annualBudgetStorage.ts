import {
  cloneBilanStructure,
  isBilanStructureSnapshot,
  normalizeBilanSpecialRowOptions,
  parseAnnualBudgetSnapshot,
  type AnnualBudgetSnapshotFile,
  type BilanActualMode,
  type BilanSpecialRowOptions,
  type BilanStructureSnapshot,
  type BudgetCategory,
  type BudgetLine,
  type YearSnapshot,
  DEFAULT_BILAN_SPECIAL_ROW_OPTIONS,
} from '@/shared/annualBudget';
import {
  loadAnnualBudgetFromProfile,
  saveAnnualBudgetToProfile,
} from './annualBudgetProfileService';

export const ANNUAL_BUDGET_SNAPSHOT_KEY = 'annual-budget-snapshot-v1';

/**
 * Ancienne clé globale (pré-structure par année).
 * Conservée en lecture seule pour migrer vers le snapshot de chaque année.
 */
export const ANNUAL_BUDGET_BILAN_STRUCTURE_KEY = 'annual-budget-bilan-structure-v1';

export type {
  AnnualBudgetSnapshotFile,
  BilanActualMode,
  BilanSpecialRowOptions,
  BilanStructureSnapshot,
  BudgetCategory,
  BudgetLine,
  YearSnapshot,
};

export {
  cloneBilanStructure,
  DEFAULT_BILAN_SPECIAL_ROW_OPTIONS,
  isBilanStructureSnapshot,
  normalizeBilanSpecialRowOptions,
};

export function loadAnnualBudgetSnapshot(): AnnualBudgetSnapshotFile {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(ANNUAL_BUDGET_SNAPSHOT_KEY) : null;
    if (!raw) return { version: 1, byYear: {} };
    return parseAnnualBudgetSnapshot(JSON.parse(raw) as unknown);
  } catch {
    return { version: 1, byYear: {} };
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
  const cleaned = parseAnnualBudgetSnapshot(snap);
  try {
    localStorage.setItem(ANNUAL_BUDGET_SNAPSHOT_KEY, JSON.stringify({ byYear: cleaned.byYear }));
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('annual-budget-snapshot-changed'));
  }
  void saveAnnualBudgetToProfile(cleaned);
}

/**
 * Charge AppState/annual_budget.json → cache localStorage.
 * @returns true si le cache a changé.
 */
export async function hydrateAnnualBudgetFromProfileFile(): Promise<boolean> {
  const before = localStorage.getItem(ANNUAL_BUDGET_SNAPSHOT_KEY) ?? '';
  const fromProfile = await loadAnnualBudgetFromProfile();
  const afterPayload = JSON.stringify({ byYear: fromProfile.byYear });
  try {
    localStorage.setItem(ANNUAL_BUDGET_SNAPSHOT_KEY, afterPayload);
  } catch {
    return false;
  }
  if (before === afterPayload) return false;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('annual-budget-snapshot-changed'));
  }
  return true;
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
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(ANNUAL_BUDGET_BILAN_STRUCTURE_KEY)
        : null;
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
