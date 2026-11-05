import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectOrphanInfo } from '@/shared/projects';
import {
  loadProjectsFromStorage,
  nextDefaultProjectColor,
  projetBackgroundStyle,
  restoreProjectWithId,
  saveProjectsToStorage,
  type ProjectEntry,
} from '../../constants/projectsStorage';
import { loadProjectOrphans, loadProjectsFromProfile } from '../../services/projectsService';

const ProjectsSection: React.FC = () => {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<ProjectEntry[]>(() => loadProjectsFromStorage());
  const [orphans, setOrphans] = useState<ProjectOrphanInfo[]>([]);
  const [orphansLoading, setOrphansLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const refreshOrphans = useCallback(async () => {
    setOrphansLoading(true);
    try {
      setOrphans(await loadProjectOrphans());
    } finally {
      setOrphansLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fromProfile = await loadProjectsFromProfile();
      if (!cancelled) setProjects(fromProfile);
      await refreshOrphans();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshOrphans]);

  const persistProjects = useCallback(
    (next: ProjectEntry[]) => {
      setProjects(next);
      setSaveError(null);
      saveProjectsToStorage(next);
      void refreshOrphans();
    },
    [refreshOrphans]
  );

  const handleAddProject = useCallback(() => {
    persistProjects([
      ...projects,
      {
        id: crypto.randomUUID(),
        name: t('settings.projects.defaultName'),
        color: nextDefaultProjectColor(projects),
      },
    ]);
  }, [projects, persistProjects, t]);

  const handleUpdateProject = useCallback(
    (index: number, patch: Partial<Pick<ProjectEntry, 'name' | 'color'>>) => {
      persistProjects(projects.map((p, i) => (i === index ? { ...p, ...patch } : p)));
    },
    [projects, persistProjects]
  );

  const handleRemoveProject = useCallback(
    (index: number) => {
      const target = projects[index];
      if (!target) return;
      const orphan = orphans.find((o) => o.projectId === target.id);
      const linked = orphan?.count ?? 0;
      const ok = window.confirm(
        linked > 0
          ? t('settings.projects.confirmDeleteWithLinks', { name: target.name, count: linked })
          : t('settings.projects.confirmDelete', { name: target.name })
      );
      if (!ok) return;
      persistProjects(projects.filter((_, i) => i !== index));
    },
    [projects, orphans, persistProjects, t]
  );

  const handleRestoreOrphan = useCallback(
    (orphan: ProjectOrphanInfo) => {
      const short = orphan.projectId.slice(0, 8);
      const entry = restoreProjectWithId(
        orphan.projectId,
        t('settings.projects.restoredName', { short }),
        nextDefaultProjectColor(projects)
      );
      if (!entry) {
        setSaveError(t('settings.projects.restoreFailed'));
        return;
      }
      setProjects(loadProjectsFromStorage());
      void refreshOrphans();
    },
    [projects, refreshOrphans, t]
  );

  return (
    <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5" data-tour="settings-projects">
      <h2 className="text-lg font-semibold text-gray-800 mb-1">{t('settings.projects.title')}</h2>
      <p className="text-sm text-gray-600 mb-4 max-w-3xl">{t('settings.projects.description')}</p>
      {saveError ? <p className="text-sm text-red-700 mb-3">{saveError}</p> : null}

      {orphans.length > 0 ? (
        <div
          className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
          role="status"
        >
          <p className="font-medium mb-1">{t('settings.projects.orphansTitle')}</p>
          <p className="text-amber-900/90 mb-2">{t('settings.projects.orphansHint')}</p>
          <ul className="space-y-2">
            {orphans.map((o) => (
              <li
                key={o.projectId}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded border border-amber-200 bg-white/70 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-mono text-xs break-all">{o.projectId}</p>
                  <p className="text-xs text-amber-900/80 mt-0.5">
                    {t('settings.projects.orphansCount', {
                      count: o.count,
                      support: o.supportCount,
                      transactions: o.transactionsCount,
                    })}
                    {o.samples.length > 0
                      ? ` — ${o.samples.slice(0, 3).join(', ')}${o.samples.length > 3 ? '…' : ''}`
                      : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRestoreOrphan(o)}
                  className="shrink-0 rounded border border-amber-700 bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800"
                >
                  {t('settings.projects.restoreOrphan')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : orphansLoading ? (
        <p className="text-xs text-gray-500 mb-3">{t('settings.projects.orphansChecking')}</p>
      ) : null}

      {projects.length === 0 ? (
        <p className="text-sm text-gray-500 mb-3">{t('settings.projects.empty')}</p>
      ) : (
        <ul className="space-y-3 mb-4">
          {projects.map((p, i) => (
            <li
              key={p.id}
              className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 sm:gap-3 rounded-lg border border-gray-200 bg-slate-50/50 p-3"
              style={projetBackgroundStyle(p.color, 0.12)}
            >
              <label className="flex flex-1 min-w-[10rem] flex-col gap-0.5 text-sm">
                <span className="text-gray-600">{t('settings.projects.name')}</span>
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => handleUpdateProject(i, { name: e.target.value })}
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
                  autoComplete="off"
                />
              </label>
              <div className="flex items-end gap-2">
                <label className="flex flex-col gap-0.5 text-sm">
                  <span className="text-gray-600">{t('settings.projects.color')}</span>
                  <input
                    type="color"
                    value={p.color}
                    onChange={(e) => handleUpdateProject(i, { color: e.target.value })}
                    className="h-9 w-14 cursor-pointer rounded border border-gray-300 bg-white p-0.5"
                    title={t('settings.projects.colorTitle')}
                  />
                </label>
                <span className="pb-2 text-xs font-mono text-gray-600">{p.color}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveProject(i)}
                  className="rounded border border-red-300 bg-white px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  {t('settings.projects.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={handleAddProject}
        className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
      >
        {t('settings.projects.add')}
      </button>
    </div>
  );
};

export default ProjectsSection;
