import React from 'react';
import type { ProjectEntry } from '../constants/projectsStorage';
import {
  findProjectById,
  normalizeProjectIdForLookup,
  projetBackgroundStyle,
  projetLabelForId,
} from '../constants/projectsStorage';

type ProjetDisplayCellProps = {
  rawId: string;
  projects: ProjectEntry[];
  className?: string;
};

export const ProjetDisplayCell: React.FC<ProjetDisplayCellProps> = ({ rawId, projects, className = '' }) => {
  const raw = (rawId ?? '').replace(/^\uFEFF/, '').trim();
  const p = findProjectById(projects, rawId);
  const label = projetLabelForId(projects, rawId) || '—';
  const title = p ? p.name : raw || undefined;
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-sm font-medium max-w-[min(100%,14rem)] truncate ${className}`}
      style={projetBackgroundStyle(p?.color)}
      title={title}
    >
      {label}
    </span>
  );
};

type ProjetSelectCellProps = {
  rawId: string;
  projects: ProjectEntry[];
  disabled: boolean;
  onChange: (projectId: string) => void;
  className?: string;
};

export const ProjetSelectCell: React.FC<ProjetSelectCellProps> = ({
  rawId,
  projects,
  disabled,
  onChange,
  className = '',
}) => {
  const id = normalizeProjectIdForLookup(rawId);
  const p = findProjectById(projects, rawId);
  return (
    <div
      className={`rounded border border-gray-200 ${className}`}
      style={projetBackgroundStyle(p?.color, 0.18)}
    >
      <select
        value={id}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full min-w-[10rem] max-w-xs rounded bg-transparent px-2 py-1 text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-0"
        aria-label="Projet"
      >
        <option value="">— Aucun —</option>
        {id && !findProjectById(projects, rawId) ? (
          <option value={id}>Projet inconnu — réassigner</option>
        ) : null}
        {projects.map((proj) => (
          <option key={proj.id} value={proj.id}>
            {proj.name}
          </option>
        ))}
      </select>
    </div>
  );
};
