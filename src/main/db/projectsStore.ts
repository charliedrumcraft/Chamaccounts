/**
 * Lecture / écriture de AppState/projects.json (catalogue projets du profil).
 * Migration depuis local_storage_snapshot.csv si le fichier est absent.
 */

import * as fs from 'fs';
import * as path from 'path';
import { LOCAL_STORAGE_SNAPSHOT_CSV_PATH, PROJECTS_JSON_PATH } from '../../shared/dataPaths';
import {
  PROJECT_ID_UUID_RE,
  normalizeProjectIdForLookup,
  parseProjectEntries,
  parseProjectsFilePayload,
  serializeProjectsFile,
  type ProjectEntry,
  type ProjectOrphanInfo,
} from '../../shared/projects';
import { TRANSACTION_PROJET_COLUMN } from '../../shared/transactionsImportCore';
import { getAllAsSourceData } from './transactionStore';
import { getAllSupportAsSourceData } from './supportStore';

function projectsFullPath(dataRoot: string): string {
  return path.join(dataRoot, PROJECTS_JSON_PATH);
}

function snapshotFullPath(dataRoot: string): string {
  return path.join(dataRoot, LOCAL_STORAGE_SNAPSHOT_CSV_PATH);
}

/** Parse minimal CSV key;value du snapshot AppState. */
function readProjectsFromSnapshotCsv(csvPath: string): ProjectEntry[] {
  if (!fs.existsSync(csvPath)) return [];
  let text: string;
  try {
    text = fs.readFileSync(csvPath, 'utf-8');
  } catch {
    return [];
  }
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.includes('chamaccounts-projects-v1')) continue;
    // "key";"value" ou key;value
    const m = line.match(/^"?chamaccounts-projects-v1"?\s*;\s*(.*)$/i);
    if (!m) continue;
    let value = m[1] ?? '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/""/g, '"');
    }
    try {
      return parseProjectEntries(JSON.parse(value) as unknown);
    } catch {
      return [];
    }
  }
  return [];
}

export function readProjects(dataRoot: string): ProjectEntry[] | null {
  const p = projectsFullPath(dataRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return parseProjectsFilePayload(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeProjects(dataRoot: string, projects: ProjectEntry[]): void {
  const p = projectsFullPath(dataRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, serializeProjectsFile(projects), 'utf-8');
}

/**
 * Garantit projects.json : lit le fichier, sinon migre depuis le snapshot AppState,
 * sinon tableau vide (écrit le fichier).
 */
export function ensureProjects(dataRoot: string): ProjectEntry[] {
  const existing = readProjects(dataRoot);
  if (existing) return existing;

  const fromSnap = readProjectsFromSnapshotCsv(snapshotFullPath(dataRoot));
  writeProjects(dataRoot, fromSnap);
  return fromSnap;
}

export function saveProjectsList(dataRoot: string, projects: ProjectEntry[]): ProjectEntry[] {
  const cleaned = parseProjectEntries(projects);
  writeProjects(dataRoot, cleaned);
  return cleaned;
}

function projetCell(row: Record<string, string>): string {
  const direct = row[TRANSACTION_PROJET_COLUMN] ?? row.PROJET ?? row.Projet ?? '';
  if (String(direct).trim()) return String(direct).trim();
  for (const [k, v] of Object.entries(row)) {
    if (/^projet$/i.test(k) && String(v ?? '').trim()) return String(v).trim();
  }
  return '';
}

function titleCell(row: Record<string, string>): string {
  for (const [k, v] of Object.entries(row)) {
    if (/^title$/i.test(k)) return String(v ?? '').trim();
  }
  return '';
}

/**
 * UUIDs présents en colonne PROJET (Support + transactions) absents du catalogue.
 */
export async function findOrphanProjectIds(dataRoot: string): Promise<ProjectOrphanInfo[]> {
  const catalogue = ensureProjects(dataRoot);
  const known = new Set(catalogue.map((p) => normalizeProjectIdForLookup(p.id)));

  type Acc = {
    count: number;
    supportCount: number;
    transactionsCount: number;
    samples: string[];
  };
  const map = new Map<string, Acc>();

  const bump = (rawId: string, source: 'support' | 'transactions', title: string) => {
    const id = normalizeProjectIdForLookup(rawId);
    if (!id || !PROJECT_ID_UUID_RE.test(id)) return;
    if (known.has(id)) return;
    let acc = map.get(id);
    if (!acc) {
      acc = { count: 0, supportCount: 0, transactionsCount: 0, samples: [] };
      map.set(id, acc);
    }
    acc.count += 1;
    if (source === 'support') acc.supportCount += 1;
    else acc.transactionsCount += 1;
    if (title && acc.samples.length < 5 && !acc.samples.includes(title)) {
      acc.samples.push(title);
    }
  };

  const support = await getAllSupportAsSourceData(dataRoot);
  for (const row of support.rows) {
    const pid = projetCell(row);
    if (pid) bump(pid, 'support', titleCell(row));
  }

  const tx = await getAllAsSourceData(dataRoot);
  for (const row of tx.rows) {
    const pid = projetCell(row);
    if (pid) bump(pid, 'transactions', titleCell(row));
  }

  return [...map.entries()]
    .map(([projectId, acc]) => ({
      projectId,
      count: acc.count,
      supportCount: acc.supportCount,
      transactionsCount: acc.transactionsCount,
      samples: acc.samples,
    }))
    .sort((a, b) => b.count - a.count || a.projectId.localeCompare(b.projectId));
}
