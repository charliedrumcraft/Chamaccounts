import type { CSSProperties } from 'react';

/** Identifiant stocké dans la colonne CSV PROJET (référence stable même si le nom change dans les réglages). */
export type ProjectEntry = {
  id: string;
  name: string;
  /** Couleur (#rrggbb), utilisée comme fond léger dans les tableaux. */
  color: string;
};

export const PROJECTS_STORAGE_KEY = 'chamaccounts-projects-v1';

/** UUID v4 (RFC) — comparaison insensible à la casse pour la colonne PROJET du CSV. */
const PROJECT_ID_UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const DEFAULT_PROJECT_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#eab308', '#f97316', '#ec4899', '#8b5cf6'];

/** Trim, retire le BOM, canonise les UUID en minuscules pour les comparaisons. */
export function normalizeProjectIdForLookup(raw: string | undefined): string {
  const id = (raw ?? '').replace(/^\uFEFF/, '').trim();
  if (!id) return '';
  return PROJECT_ID_UUID_RE.test(id) ? id.toLowerCase() : id;
}

function normalizeHexColor(s: string): string | null {
  const t = s.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(t)) return null;
  return `#${t.toLowerCase()}`;
}

export function loadProjectsFromStorage(): ProjectEntry[] {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: ProjectEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const idRaw = typeof o.id === 'string' ? o.id.trim() : '';
      const id = normalizeProjectIdForLookup(idRaw) || idRaw;
      const name = typeof o.name === 'string' ? o.name.trim() : '';
      const colorRaw = typeof o.color === 'string' ? o.color.trim() : '';
      const color = normalizeHexColor(colorRaw);
      if (!id || !name || !color) continue;
      out.push({ id, name, color });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveProjectsToStorage(projects: ProjectEntry[]): void {
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  } catch {}
}

export function nextDefaultProjectColor(existing: ProjectEntry[]): string {
  const used = new Set(existing.map((p) => p.color.toLowerCase()));
  for (const c of DEFAULT_PROJECT_COLORS) {
    if (!used.has(c.toLowerCase())) return c;
  }
  return DEFAULT_PROJECT_COLORS[existing.length % DEFAULT_PROJECT_COLORS.length]!;
}

/** Fond rgba léger pour cellule / badge (hex #rrggbb). */
export function projetBackgroundStyle(hex: string | undefined | null, alpha = 0.2): CSSProperties | undefined {
  const h = (hex ?? '').trim();
  const m = /^#?([0-9a-fA-F]{6})$/.exec(h.startsWith('#') ? h.slice(1) : h);
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return { backgroundColor: `rgba(${r},${g},${b},${alpha})` };
}

export function findProjectById(
  projects: ProjectEntry[],
  rawId: string | undefined
): ProjectEntry | undefined {
  const id = normalizeProjectIdForLookup(rawId);
  if (!id) return undefined;
  return projects.find((p) => normalizeProjectIdForLookup(p.id) === id);
}

export function projetLabelForId(projects: ProjectEntry[], rawId: string | undefined): string {
  const id = normalizeProjectIdForLookup(rawId);
  if (!id) return '';
  const p = findProjectById(projects, rawId);
  if (p) return p.name;
  if (PROJECT_ID_UUID_RE.test(id)) return 'Projet inconnu';
  return id;
}
