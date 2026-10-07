import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import {
  DATA_TEMPLATE_PROFILE_DIRNAME,
  DATA_TEMPLATE_PROFILE_NAME,
} from '../shared/dataTemplateProfile';
import {
  ACCOUNT_BALANCE_CSV_PATH,
  ACCOUNT_BALANCE_DB_PATH,
  LOCAL_STORAGE_SNAPSHOT_CSV_PATH,
  SOURCE_DATA_PATH,
  SUPPORT_DATA_CSV_PATH,
  SUPPORT_DB_PATH,
  TRANSACTIONS_DB_PATH,
} from '../shared/dataPaths';
import type { Profile } from '../shared/profiles';
import { addProfile, ensureConfigLoaded, saveConfig } from './appConfig';
import { ensureDataTree, getConfigDir } from './dataDirectory';
import { tm } from './uiI18n';

/** Clés Settings / démo à reseeder depuis le bundle si absentes ou vides dans le profil runtime. */
const TEMPLATE_SEED_KEYS = [
  'settings-recognised-accounts',
  'settings-recognised-entry-types',
  'settings-recognised-output-types',
  'chamaccounts-projects-v1',
  'annual-budget-snapshot-v1',
] as const;

/** CSV démo à aligner sur le bundle (hors AppState / préférences UI). */
const TEMPLATE_DEMO_CSV_PATHS = [
  SOURCE_DATA_PATH,
  ACCOUNT_BALANCE_CSV_PATH,
  SUPPORT_DATA_CSV_PATH,
] as const;

const TEMPLATE_DEMO_DB_PATHS = [
  TRANSACTIONS_DB_PATH,
  ACCOUNT_BALANCE_DB_PATH,
  SUPPORT_DB_PATH,
] as const;

/** Chemin du bundle versionné (données fictives + AppState). */
export function getDataTemplateProfileBundlePath(): string {
  const installPath = app.getAppPath();
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'data-template-profile'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'data-template-profile'),
        path.join(installPath, 'data-template-profile'),
      ]
    : [path.join(installPath, 'data-template-profile')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return path.join(installPath, 'data-template-profile');
}

export function getDataTemplateProfileDataRoot(): string {
  return path.join(getConfigDir(), 'profiles', DATA_TEMPLATE_PROFILE_DIRNAME);
}

async function syncBundleToDataRoot(dataRoot: string): Promise<void> {
  const bundle = getDataTemplateProfileBundlePath();
  if (!existsSync(bundle)) {
    throw new Error(tm('error.bundleTemplateMissing', { path: bundle }));
  }
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.cp(bundle, dataRoot, { recursive: true, force: true });
  await ensureDataTree(dataRoot);
}

async function deleteDbAndSidecars(dataRoot: string, relativeDbPath: string): Promise<void> {
  const dbFull = path.join(dataRoot, relativeDbPath);
  for (const suffix of ['', '-wal', '-shm'] as const) {
    const p = `${dbFull}${suffix}`;
    if (existsSync(p)) {
      try {
        await fs.unlink(p);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Si les CSV démo runtime divergent du bundle (ex. ancienne copie + SQLite),
 * réécrit les CSV et supprime les bases pour forcer le réimport.
 */
async function syncDemoDataFromBundleIfStale(dataRoot: string): Promise<boolean> {
  const bundle = getDataTemplateProfileBundlePath();
  if (!existsSync(bundle)) return false;

  let stale = false;
  for (const rel of TEMPLATE_DEMO_CSV_PATHS) {
    const bundleFile = path.join(bundle, rel);
    const runtimeFile = path.join(dataRoot, rel);
    if (!existsSync(bundleFile)) continue;
    if (!existsSync(runtimeFile)) {
      stale = true;
      break;
    }
    const bundleText = readFileSync(bundleFile, 'utf8');
    const runtimeText = readFileSync(runtimeFile, 'utf8');
    if (bundleText !== runtimeText) {
      stale = true;
      break;
    }
  }
  if (!stale) return false;

  for (const rel of TEMPLATE_DEMO_CSV_PATHS) {
    const bundleFile = path.join(bundle, rel);
    if (!existsSync(bundleFile)) continue;
    const runtimeFile = path.join(dataRoot, rel);
    await fs.mkdir(path.dirname(runtimeFile), { recursive: true });
    await fs.copyFile(bundleFile, runtimeFile);
  }
  for (const dbRel of TEMPLATE_DEMO_DB_PATHS) {
    await deleteDbAndSidecars(dataRoot, dbRel);
  }
  await ensureDataTree(dataRoot);
  return true;
}

/** Parse minimal du snapshot AppState (clé;valeur, guillemets CSV optionnels). */
function parseAppStateSnapshot(csvText: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of csvText.split(/\r?\n/)) {
    if (!line || /^"?key"?\s*;/i.test(line)) continue;
    const m = line.match(/^"?([^";]+)"?\s*;\s*"(.*)"\s*$/);
    if (!m) continue;
    out.set(m[1], m[2].replace(/""/g, '"'));
  }
  return out;
}

function isEmptyJsonArrayValue(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === '') return true;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return true;
  }
}

function escapeCsvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function serializeAppStateSnapshot(entries: Map<string, string>): string {
  const keys = [...entries.keys()].sort((a, b) => a.localeCompare(b));
  const lines = ['"key";"value"'];
  for (const key of keys) {
    lines.push(`${escapeCsvField(key)};${escapeCsvField(entries.get(key) ?? '')}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Si le snapshot runtime a des listes Settings vides, les remplace par celles du bundle
 * (évite un profil Data Template « vidé » après un flush localStorage).
 */
function seedEmptyTemplateSettingsFromBundle(dataRoot: string): void {
  const bundleSnap = path.join(getDataTemplateProfileBundlePath(), LOCAL_STORAGE_SNAPSHOT_CSV_PATH);
  const rootSnap = path.join(dataRoot, LOCAL_STORAGE_SNAPSHOT_CSV_PATH);
  if (!existsSync(bundleSnap)) return;

  const fromBundle = parseAppStateSnapshot(readFileSync(bundleSnap, 'utf8'));
  const current = existsSync(rootSnap)
    ? parseAppStateSnapshot(readFileSync(rootSnap, 'utf8'))
    : new Map<string, string>();

  let changed = false;
  for (const key of TEMPLATE_SEED_KEYS) {
    const bundleValue = fromBundle.get(key);
    if (bundleValue === undefined || isEmptyJsonArrayValue(bundleValue)) continue;
    if (!isEmptyJsonArrayValue(current.get(key))) continue;
    current.set(key, bundleValue);
    changed = true;
  }
  if (!changed) return;

  writeFileSync(rootSnap, serializeAppStateSnapshot(current), 'utf8');
}

/**
 * Crée ou met à jour le profil « Data Template » (données fictives).
 * Si aucun profil n’existe encore, ce profil devient le profil actif.
 */
export async function ensureDataTemplateProfile(): Promise<Profile> {
  const dataRoot = path.resolve(getDataTemplateProfileDataRoot());
  const config = await ensureConfigLoaded();
  const existing = config?.profiles.find((p) => p.name === DATA_TEMPLATE_PROFILE_NAME);

  if (!existsSync(dataRoot)) {
    await syncBundleToDataRoot(dataRoot);
  } else {
    await syncDemoDataFromBundleIfStale(dataRoot);
    seedEmptyTemplateSettingsFromBundle(dataRoot);
  }

  if (existing) {
    const resolved = path.resolve(existing.dataRoot);
    if (resolved !== dataRoot) {
      existing.dataRoot = dataRoot;
      if (config) await saveConfig(config);
    }
    return existing;
  }

  const setActive = !config || config.profiles.length === 0;
  return addProfile(DATA_TEMPLATE_PROFILE_NAME, dataRoot, setActive);
}
