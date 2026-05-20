/** État ouvert/fermé des blocs de la page Soutien (survit à la navigation et au redémarrage). */
export const SOUTIEN_BLOCKS_STORAGE_KEY = 'chamaccounts-soutien-blocks';

export type SoutienBlocksPersisted = {
  titleTotalsExpanded: boolean;
  /** Bloc « sommes par projet » (développé par défaut si absent du stockage). */
  projectTotalsExpanded?: boolean;
  /** Clés = yearKey (`y2024`, `yunknown`, `all`, …) ; true = développé, false = replié. */
  yearBlocks: Record<string, boolean>;
};

export function readSoutienBlocksFromStorage(): SoutienBlocksPersisted | null {
  try {
    const raw = localStorage.getItem(SOUTIEN_BLOCKS_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== 'object' || p === null) return null;
    const obj = p as Record<string, unknown>;
    const titleTotalsExpanded =
      typeof obj.titleTotalsExpanded === 'boolean' ? obj.titleTotalsExpanded : true;
    const projectTotalsExpanded =
      typeof obj.projectTotalsExpanded === 'boolean' ? obj.projectTotalsExpanded : true;
    const rawYears = obj.yearBlocks;
    const yearBlocks: Record<string, boolean> = {};
    if (rawYears && typeof rawYears === 'object' && !Array.isArray(rawYears)) {
      for (const [k, v] of Object.entries(rawYears)) {
        if (typeof v === 'boolean') yearBlocks[k] = v;
      }
    }
    return { titleTotalsExpanded, projectTotalsExpanded, yearBlocks };
  } catch {
    return null;
  }
}

export function writeSoutienBlocksToStorage(state: SoutienBlocksPersisted): void {
  try {
    localStorage.setItem(SOUTIEN_BLOCKS_STORAGE_KEY, JSON.stringify(state));
  } catch {}
}
