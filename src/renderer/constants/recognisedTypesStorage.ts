/**
 * Types d’entrées / sorties reconnus (Paramètres) — localStorage.
 */

export const RECOGNISED_ENTRY_TYPES_STORAGE_KEY = 'settings-recognised-entry-types';
export const RECOGNISED_OUTPUT_TYPES_STORAGE_KEY = 'settings-recognised-output-types';

function loadRecognisedStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => String(v ?? '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Types d’entrées (revenus) définis dans Paramètres. */
export function loadRecognisedEntryTypesFromStorage(): string[] {
  return loadRecognisedStringArray(RECOGNISED_ENTRY_TYPES_STORAGE_KEY);
}

/** Types de sorties (dépenses) définis dans Paramètres. */
export function loadRecognisedOutputTypesFromStorage(): string[] {
  return loadRecognisedStringArray(RECOGNISED_OUTPUT_TYPES_STORAGE_KEY);
}

/**
 * Union dédupliquée (casse préservée : première occurrence gagne)
 * des types entrées + sorties pour suggestions de saisie TYPE.
 */
export function loadAllRecognisedTypesFromStorage(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [
    ...loadRecognisedEntryTypesFromStorage(),
    ...loadRecognisedOutputTypesFromStorage(),
  ]) {
    const lo = t.toLowerCase();
    if (seen.has(lo)) continue;
    seen.add(lo);
    out.push(t);
  }
  return out;
}
