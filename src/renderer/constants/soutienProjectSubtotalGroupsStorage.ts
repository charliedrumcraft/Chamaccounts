/** Sous-totaux par projet pour le tableau « sommes par projet » (page Soutien). */
export const SOUTIEN_PROJECT_SUBTOTAL_STORAGE_KEY = 'chamaccounts-soutien-project-subtotals';

export type SoutienProjectSubtotalGroup = {
  id: string;
  /** Nom affiché pour la ligne de sous-total dans le tableau. */
  label: string;
  /** Clés projet exactes (`id` ou `__sans_projet__`) à additionner. */
  projectKeys: string[];
};

export type SoutienProjectSubtotalPersisted = {
  /** Si false, le tableau n’affiche pas les lignes de sous-total. */
  applySubtotals: boolean;
  groups: SoutienProjectSubtotalGroup[];
  /** Panneau d’édition des sous-totaux : développé (true) ou replié. */
  panelExpanded: boolean;
};

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

function isProjectSubtotalGroup(x: unknown): x is SoutienProjectSubtotalGroup {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (!isNonEmptyString(o.id)) return false;
  if (typeof o.label !== 'string') return false;
  if (!Array.isArray(o.projectKeys)) return false;
  if (!o.projectKeys.every((t) => typeof t === 'string')) return false;
  return true;
}

export function readSoutienProjectSubtotalFromStorage(): SoutienProjectSubtotalPersisted | null {
  try {
    const raw = localStorage.getItem(SOUTIEN_PROJECT_SUBTOTAL_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== 'object' || p === null) return null;
    const obj = p as Record<string, unknown>;
    const applySubtotals = typeof obj.applySubtotals === 'boolean' ? obj.applySubtotals : true;
    const panelExpanded = typeof obj.panelExpanded === 'boolean' ? obj.panelExpanded : true;
    const rawGroups = obj.groups;
    const groups: SoutienProjectSubtotalGroup[] = [];
    if (Array.isArray(rawGroups)) {
      for (const g of rawGroups) {
        if (isProjectSubtotalGroup(g)) {
          groups.push({
            id: g.id.trim(),
            label: g.label,
            projectKeys: [...new Set(g.projectKeys.map((t) => t.trim()).filter((t) => t.length > 0))],
          });
        }
      }
    }
    return { applySubtotals, groups, panelExpanded };
  } catch {
    return null;
  }
}

export function writeSoutienProjectSubtotalToStorage(state: SoutienProjectSubtotalPersisted): void {
  try {
    localStorage.setItem(SOUTIEN_PROJECT_SUBTOTAL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/** Retire les projets choisis dans un groupe des autres groupes (un projet → un seul sous-total). */
export function rebalanceProjectSubtotalGroups(
  groups: SoutienProjectSubtotalGroup[],
  changedGroupId: string,
  nextKeysForChanged: string[]
): SoutienProjectSubtotalGroup[] {
  const reserved = new Set(nextKeysForChanged.map((t) => t.trim()).filter(Boolean));
  return groups.map((g) => {
    if (g.id === changedGroupId) {
      return { ...g, projectKeys: [...reserved] };
    }
    return { ...g, projectKeys: g.projectKeys.filter((t) => !reserved.has(t.trim())) };
  });
}
