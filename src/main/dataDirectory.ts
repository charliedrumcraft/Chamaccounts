import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import AdmZip from 'adm-zip';
import { DATA_ZIP_PREFIX } from '../shared/dataPaths';
import { getActiveDataRoot, requireActiveDataRoot } from './appConfig';
import type { LegacyDataLocation } from '../shared/profiles';

/** Racine d’installation (asar / projet) — ressources app, pas les données utilisateur. */
export function getInstallPath(): string {
  return app.getAppPath();
}

/** Répertoire de configuration Electron (profiles.json uniquement). */
export function getConfigDir(): string {
  return app.getPath('userData');
}

/** @deprecated Utiliser getDataRoot() pour les fichiers métier. */
export function getAppPath(): string {
  const root = getActiveDataRoot();
  if (root) return root;
  if (app.isPackaged) return getConfigDir();
  return getInstallPath();
}

/** Chemin absolu du dossier de données du profil actif. */
export function getDataRoot(): string {
  return requireActiveDataRoot();
}

/** Emplacement du modèle CSV vierge (dev ou resources en prod). */
export function getDataTemplatePath(): string {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'data-template'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'data-template'),
        path.join(getInstallPath(), 'data-template'),
      ]
    : [path.join(getInstallPath(), 'data-template')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return path.join(getInstallPath(), 'data-template');
}

const KEY_DATA_FILES = [
  'TransactionsData/Processed/src_transaction_data.csv',
  'AccountBalanceData/Processed/src_account_balance.csv',
  'SupportData/Support_data.csv',
] as const;

async function csvHasDataRows(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
    return lines.length > 1;
  } catch {
    return false;
  }
}

async function dataTreeHasUserContent(dataDir: string): Promise<boolean> {
  for (const rel of KEY_DATA_FILES) {
    if (await csvHasDataRows(path.join(dataDir, rel))) return true;
  }
  return false;
}

/** Dossiers legacy à proposer lors de la configuration initiale. */
export function detectLegacyDataLocations(): LegacyDataLocation[] {
  const found: LegacyDataLocation[] = [];

  if (!app.isPackaged) {
    const repoData = path.join(getInstallPath(), 'data');
    if (existsSync(repoData)) {
      found.push({
        path: repoData,
        label: 'Dossier data/ du dépôt de développement',
        suggestedName: 'Développement',
      });
    }
  }

  const userDataData = path.join(getConfigDir(), 'data');
  if (existsSync(userDataData)) {
    const already = found.some((f) => path.resolve(f.path) === path.resolve(userDataData));
    if (!already) {
      found.push({
        path: userDataData,
        label: 'Données dans le dossier application (ancienne version)',
        suggestedName: 'Principal',
      });
    }
  }

  if (app.isPackaged) {
    for (const candidate of [
      path.join(process.resourcesPath, 'app.asar.unpacked', 'data'),
      path.join(process.resourcesPath, 'data'),
    ]) {
      if (!existsSync(candidate)) continue;
      const already = found.some((f) => path.resolve(f.path) === path.resolve(candidate));
      if (!already) {
        found.push({
          path: candidate,
          label: 'Données embarquées (migration)',
          suggestedName: 'Principal',
        });
      }
    }
  }

  return found;
}

/**
 * Anciennes versions : data/ dans app.asar.unpacked ou userData/data.
 * Copie une seule fois vers userData/data si ce dossier legacy a du contenu et userData/data est vide.
 */
export async function migrateLegacyPackagedDataIfNeeded(): Promise<void> {
  if (!app.isPackaged) return;

  const targetData = path.join(getConfigDir(), 'data');
  const legacyCandidates = [
    path.join(process.resourcesPath, 'app.asar.unpacked', 'data'),
    path.join(process.resourcesPath, 'data'),
  ];

  let legacyData: string | null = null;
  for (const candidate of legacyCandidates) {
    if (existsSync(candidate)) {
      legacyData = candidate;
      break;
    }
  }

  if (!existsSync(targetData)) {
    if (legacyData) {
      await fs.cp(legacyData, targetData, { recursive: true });
    }
    return;
  }

  if (!legacyData || legacyData === targetData) return;

  const [targetHasContent, legacyHasContent] = await Promise.all([
    dataTreeHasUserContent(targetData),
    dataTreeHasUserContent(legacyData),
  ]);

  if (legacyHasContent && !targetHasContent) {
    await fs.cp(legacyData, targetData, { recursive: true, force: true });
  }
}

/** Crée l’arborescence minimale à partir de data-template/ (ou dossiers vides). */
export async function ensureDataTree(dataRoot: string): Promise<void> {
  const templatePath = getDataTemplatePath();
  if (existsSync(templatePath)) {
    await fs.cp(templatePath, dataRoot, { recursive: true, force: false });
  }

  const dirs = [
    'TransactionsData/Import',
    'TransactionsData/Processed',
    'AccountBalanceData/Import',
    'AccountBalanceData/Processed',
    'SupportData',
    'AppState',
  ];
  for (const rel of dirs) {
    await fs.mkdir(path.join(dataRoot, rel), { recursive: true });
  }
}

async function addDirectoryToZip(zip: AdmZip, absoluteDir: string, zipPrefix: string): Promise<void> {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;
    const fullPath = path.join(absoluteDir, entry.name);
    const entryZipPath = `${zipPrefix}/${entry.name}`.replace(/\\/g, '/');
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, fullPath, entryZipPath);
    } else if (entry.isFile()) {
      const content = await fs.readFile(fullPath);
      zip.addFile(entryZipPath, content);
    }
  }
}

/** Archive le dossier de données du profil avec le préfixe ZIP historique `data/`. */
export async function writeDataFolderZip(dataDir: string, zipFilePath: string): Promise<void> {
  const zip = new AdmZip();
  if (existsSync(dataDir)) {
    await addDirectoryToZip(zip, dataDir, DATA_ZIP_PREFIX);
  }
  zip.writeZip(zipFilePath);
}
