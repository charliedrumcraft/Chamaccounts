import { useState, useEffect } from 'react';
import { loadProjectsFromStorage, type ProjectEntry } from '../constants/projectsStorage';

export function useProjectsFromStorage(): ProjectEntry[] {
  const [projects, setProjects] = useState<ProjectEntry[]>(() => loadProjectsFromStorage());

  useEffect(() => {
    const refresh = () => setProjects(loadProjectsFromStorage());
    setProjects(loadProjectsFromStorage());
    window.addEventListener('focus', refresh);
    window.addEventListener('chamaccounts-projects-changed', refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('chamaccounts-projects-changed', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return projects;
}
