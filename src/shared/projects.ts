/**
 * Catalogue des projets du profil (AppState/projects.json).
 * Identifiants stables stockés dans la colonne PROJET des CSV / SQLite.
 */

export type ProjectEntry = {
  id: string;
  name: string;
  /** Couleur (#rrggbb). */
  color: string;
};

export type ProjectsFilePayload = {
  version: 1;
  projects: ProjectEntry[];
};

/** UUID v4 (RFC) — comparaison insensible à la casse. */
export const PROJECT_ID_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const DEFAULT_PROJECT_COLORS = [
  '#6366f1',
  '#0ea5e9',
  '#14b8a6',
  '#eab308',
  '#f97316',
  '#ec4899',
  '#8b5cf6',
];

export function normalizeProjectIdForLookup(raw: string | undefined): string {
  const id = (raw ?? '').replace(/^\uFEFF/, '').trim();
  if (!id) return '';
  return PROJECT_ID_UUID_RE.test(id) ? id.toLowerCase() : id;
}

export function normalizeHexColor(s: string): string | null {
  const t = s.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(t)) return null;
  return `#${t.toLowerCase()}`;
}

export function parseProjectEntries(parsed: unknown): ProjectEntry[] {
  if (!Array.isArray(parsed)) return [];
  const out: ProjectEntry[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const idRaw = typeof o.id === 'string' ? o.id.trim() : '';
    const id = normalizeProjectIdForLookup(idRaw) || idRaw;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const colorRaw = typeof o.color === 'string' ? o.color.trim() : '';
    const color = normalizeHexColor(colorRaw);
    if (!id || !name || !color) continue;
    const key = normalizeProjectIdForLookup(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, name, color });
  }
  return out;
}

export function parseProjectsFilePayload(raw: string): ProjectEntry[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as ProjectsFilePayload).projects)) {
      return parseProjectEntries((parsed as ProjectsFilePayload).projects);
    }
    return parseProjectEntries(parsed);
  } catch {
    return [];
  }
}

export function serializeProjectsFile(projects: ProjectEntry[]): string {
  const payload: ProjectsFilePayload = { version: 1, projects };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function nextDefaultProjectColor(existing: ProjectEntry[]): string {
  const used = new Set(existing.map((p) => p.color.toLowerCase()));
  for (const c of DEFAULT_PROJECT_COLORS) {
    if (!used.has(c.toLowerCase())) return c;
  }
  return DEFAULT_PROJECT_COLORS[existing.length % DEFAULT_PROJECT_COLORS.length]!;
}

export type ProjectOrphanInfo = {
  projectId: string;
  count: number;
  supportCount: number;
  transactionsCount: number;
  samples: string[];
};
