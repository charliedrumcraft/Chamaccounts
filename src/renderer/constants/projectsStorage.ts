import type { CSSProperties } from 'react';
import {
  PROJECT_ID_UUID_RE,
  nextDefaultProjectColor as sharedNextDefaultColor,
  normalizeProjectIdForLookup,
  parseProjectEntries,
  type ProjectEntry,
} from '@/shared/projects';
import { loadProjectsFromProfile, saveProjectsToProfile } from '../services/projectsService';

export type { ProjectEntry } from '@/shared/projects';
export { normalizeProjectIdForLookup, PROJECT_ID_UUID_RE } from '@/shared/projects';

export const PROJECTS_STORAGE_KEY = 'chamaccounts-projects-v1';

export function loadProjectsFromStorage(): ProjectEntry[] {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    return parseProjectEntries(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function notifyProjectsChanged(): void {
  try {
    window.dispatchEvent(new Event('chamaccounts-projects-changed'));
  } catch {
    /* ignore */
  }
}

/**
 * Persiste le catalogue : cache localStorage immédiat + AppState/projects.json (IPC).
 */
export function saveProjectsToStorage(projects: ProjectEntry[]): void {
  const cleaned = parseProjectEntries(projects);
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(cleaned));
  } catch {
    /* ignore */
  }
  void saveProjectsToProfile(cleaned);
}

/**
 * Charge AppState/projects.json (migration auto côté main si besoin) → cache LS.
 * @returns true si le cache local a changé.
 */
export async function hydrateProjectsFromProfileFile(): Promise<boolean> {
  const before = JSON.stringify(loadProjectsFromStorage());
  const fromProfile = await loadProjectsFromProfile();
  const after = JSON.stringify(fromProfile);
  if (before === after) return false;
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(fromProfile));
  } catch {
    return false;
  }
  notifyProjectsChanged();
  return true;
}

/**
 * Crée un projet par nom (ou renvoie l’existant si même nom, insensible à la casse).
 */
export function addProjectByName(name: string): ProjectEntry | null {
  const trimmed = (name ?? '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) return null;
  const existing = loadProjectsFromStorage();
  const lower = trimmed.toLowerCase();
  const found = existing.find((p) => p.name.trim().toLowerCase() === lower);
  if (found) return found;
  const entry: ProjectEntry = {
    id: crypto.randomUUID(),
    name: trimmed,
    color: nextDefaultProjectColor(existing),
  };
  saveProjectsToStorage([...existing, entry]);
  notifyProjectsChanged();
  return entry;
}

/**
 * Restaure un projet avec un id donné (ex. orphelin détecté dans les données).
 * Si l’id existe déjà, renvoie l’entrée existante.
 */
export function restoreProjectWithId(
  id: string,
  name: string,
  color?: string
): ProjectEntry | null {
  const normalizedId = normalizeProjectIdForLookup(id);
  if (!normalizedId || !PROJECT_ID_UUID_RE.test(normalizedId)) return null;
  const existing = loadProjectsFromStorage();
  const found = existing.find((p) => normalizeProjectIdForLookup(p.id) === normalizedId);
  if (found) return found;
  const trimmedName = (name ?? '').trim() || 'Projet restauré';
  const entry: ProjectEntry = {
    id: normalizedId,
    name: trimmedName,
    color: color ?? nextDefaultProjectColor(existing),
  };
  saveProjectsToStorage([...existing, entry]);
  notifyProjectsChanged();
  return entry;
}

export function nextDefaultProjectColor(existing: ProjectEntry[]): string {
  return sharedNextDefaultColor(existing);
}

/** Fond rgba léger pour cellule / badge (hex #rrggbb). */
export function projetBackgroundStyle(
  hex: string | undefined | null,
  alpha = 0.2
): CSSProperties | undefined {
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

/** Résout un id UUID ou un nom de projet (insensible à la casse) vers l’id stocké en CSV. */
export function resolveProjectIdFromRaw(
  projects: ProjectEntry[],
  raw: string | undefined
): string {
  const trimmed = (raw ?? '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) return '';
  const byId = findProjectById(projects, trimmed);
  if (byId) return byId.id;
  const lower = trimmed.toLowerCase();
  const byName = projects.find((p) => p.name.trim().toLowerCase() === lower);
  return byName?.id ?? '';
}

export function projetLabelForId(projects: ProjectEntry[], rawId: string | undefined): string {
  const id = normalizeProjectIdForLookup(rawId);
  if (!id) return '';
  const p = findProjectById(projects, rawId);
  if (p) return p.name;
  if (PROJECT_ID_UUID_RE.test(id)) return 'Projet inconnu';
  return id;
}
