/** Regroupements de libellés TITLE pour le tableau « totaux par titre » (page Soutien). */
export const SOUTIEN_TITLE_COMBINE_STORAGE_KEY = 'chamaccounts-soutien-title-combine';

export type SoutienTitleCombineGroup = {
  id: string;
  /** Nom affiché pour la ligne combinée dans le tableau. */
  label: string;
  /** Libellés TITLE exacts (comme dans les données) à additionner. */
  titles: string[];
};

export type SoutienTitleCombinePersisted = {
  /** Si false, le tableau affiche chaque titre séparément (agrégation brute). */
  applyCombine: boolean;
  groups: SoutienTitleCombineGroup[];
  /** Panneau d’édition des regroupements : développé (true) ou replié pour gagner de la place. */
  regroupementPanelExpanded: boolean;
};

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

function isTitleCombineGroup(x: unknown): x is SoutienTitleCombineGroup {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (!isNonEmptyString(o.id)) return false;
  if (typeof o.label !== 'string') return false;
  if (!Array.isArray(o.titles)) return false;
  if (!o.titles.every((t) => typeof t === 'string')) return false;
  return true;
}

export function readSoutienTitleCombineFromStorage(): SoutienTitleCombinePersisted | null {
  try {
    const raw = localStorage.getItem(SOUTIEN_TITLE_COMBINE_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== 'object' || p === null) return null;
    const obj = p as Record<string, unknown>;
    const applyCombine = typeof obj.applyCombine === 'boolean' ? obj.applyCombine : true;
    const regroupementPanelExpanded =
      typeof obj.regroupementPanelExpanded === 'boolean' ? obj.regroupementPanelExpanded : true;
    const rawGroups = obj.groups;
    const groups: SoutienTitleCombineGroup[] = [];
    if (Array.isArray(rawGroups)) {
      for (const g of rawGroups) {
        if (isTitleCombineGroup(g)) {
          groups.push({
            id: g.id.trim(),
            label: g.label,
            titles: [...new Set(g.titles.map((t) => t.trim()).filter((t) => t.length > 0))],
          });
        }
      }
    }
    return { applyCombine, groups, regroupementPanelExpanded };
  } catch {
    return null;
  }
}

export function writeSoutienTitleCombineToStorage(state: SoutienTitleCombinePersisted): void {
  try {
    localStorage.setItem(SOUTIEN_TITLE_COMBINE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Retire les titres choisis dans un groupe des autres groupes (un titre → un seul groupe). */
export function rebalanceTitleCombineGroups(
  groups: SoutienTitleCombineGroup[],
  changedGroupId: string,
  nextTitlesForChanged: string[]
): SoutienTitleCombineGroup[] {
  const reserved = new Set(nextTitlesForChanged.map((t) => t.trim()).filter(Boolean));
  return groups.map((g) => {
    if (g.id === changedGroupId) {
      return { ...g, titles: [...reserved] };
    }
    return { ...g, titles: g.titles.filter((t) => !reserved.has(t.trim())) };
  });
}
