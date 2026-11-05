/**
 * Accès renderer au catalogue projets du profil (AppState/projects.json via IPC).
 */

import type { ProjectEntry, ProjectOrphanInfo } from '@/shared/projects';
import { parseProjectEntries } from '@/shared/projects';
import i18n from '../i18n';

/** Aligné sur projectsStorage.PROJECTS_STORAGE_KEY (évite import circulaire). */
const PROJECTS_STORAGE_KEY = 'chamaccounts-projects-v1';

function notifyProjectsChanged(): void {
  try {
    window.dispatchEvent(new Event('chamaccounts-projects-changed'));
  } catch {
    /* ignore */
  }
}

function syncLocalStorageCache(projects: ProjectEntry[]): void {
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  } catch {
    /* ignore */
  }
  notifyProjectsChanged();
}

export async function loadProjectsFromProfile(): Promise<ProjectEntry[]> {
  const api = window.electronAPI;
  if (!api?.projectsGet) {
    try {
      const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
      if (!raw) return [];
      return parseProjectEntries(JSON.parse(raw) as unknown);
    } catch {
      return [];
    }
  }
  const r = await api.projectsGet();
  if (!r.success || !r.data?.projects) {
    return [];
  }
  syncLocalStorageCache(r.data.projects);
  return r.data.projects;
}

export async function saveProjectsToProfile(
  projects: ProjectEntry[]
): Promise<{ ok: true; projects: ProjectEntry[] } | { ok: false; error: string }> {
  const cleaned = parseProjectEntries(projects);
  const api = window.electronAPI;
  syncLocalStorageCache(cleaned);
  if (!api?.projectsSave) {
    return { ok: true, projects: cleaned };
  }
  const r = await api.projectsSave({ projects: cleaned });
  if (!r.success || !r.data?.projects) {
    return { ok: false, error: r.error ?? i18n.t('system.saveFailed') };
  }
  syncLocalStorageCache(r.data.projects);
  return { ok: true, projects: r.data.projects };
}

export async function loadProjectOrphans(): Promise<ProjectOrphanInfo[]> {
  const api = window.electronAPI;
  if (!api?.projectsOrphans) return [];
  const r = await api.projectsOrphans();
  if (!r.success || !r.data?.orphans) return [];
  return r.data.orphans;
}
