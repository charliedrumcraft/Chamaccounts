import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { randomUUID } from 'crypto';
import type { AppConfig, DataSetupStatus, LegacyDataLocation, Profile } from '../shared/profiles';

const CONFIG_FILENAME = 'profiles.json';

let cachedConfig: AppConfig | null = null;

export function getConfigFilePath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILENAME);
}

export async function loadConfig(): Promise<AppConfig | null> {
  const configPath = getConfigFilePath();
  if (!existsSync(configPath)) {
    cachedConfig = null;
    return null;
  }
  try {
    const raw = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as AppConfig;
    if (parsed?.version !== 1 || !Array.isArray(parsed.profiles)) {
      cachedConfig = null;
      return null;
    }
    cachedConfig = parsed;
    return parsed;
  } catch {
    cachedConfig = null;
    return null;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  const configPath = getConfigFilePath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  cachedConfig = config;
}

export async function ensureConfigLoaded(): Promise<AppConfig | null> {
  if (cachedConfig) return cachedConfig;
  return loadConfig();
}

export function getCachedConfig(): AppConfig | null {
  return cachedConfig;
}

function findActiveProfile(config: AppConfig): Profile | null {
  return config.profiles.find((p) => p.id === config.activeProfileId) ?? null;
}

export function getActiveProfileId(): string | null {
  const config = cachedConfig;
  if (!config?.activeProfileId) return null;
  const profile = findActiveProfile(config);
  if (!profile?.dataRoot || !existsSync(profile.dataRoot)) return null;
  return config.activeProfileId;
}

export function getActiveDataRoot(): string | null {
  const config = cachedConfig;
  if (!config) return null;
  const profile = findActiveProfile(config);
  if (!profile?.dataRoot) return null;
  if (!existsSync(profile.dataRoot)) return null;
  return profile.dataRoot;
}

export function requireActiveDataRoot(): string {
  const root = getActiveDataRoot();
  if (!root) {
    throw new Error('Aucun profil de données actif ou dossier introuvable.');
  }
  return root;
}

export function profileDataRootExists(profile: Profile): boolean {
  return existsSync(profile.dataRoot);
}

export async function addProfile(name: string, dataRoot: string, setActive = true): Promise<Profile> {
  const config = (await ensureConfigLoaded()) ?? {
    version: 1 as const,
    activeProfileId: '',
    profiles: [],
  };
  const profile: Profile = {
    id: randomUUID(),
    name: name.trim() || path.basename(dataRoot),
    dataRoot: path.resolve(dataRoot),
  };
  config.profiles.push(profile);
  if (setActive || config.profiles.length === 1) {
    config.activeProfileId = profile.id;
  }
  await saveConfig(config);
  return profile;
}

export async function setActiveProfile(profileId: string): Promise<{ ok: boolean; error?: string }> {
  const config = await ensureConfigLoaded();
  if (!config) return { ok: false, error: 'Configuration absente.' };
  const profile = config.profiles.find((p) => p.id === profileId);
  if (!profile) return { ok: false, error: 'Profil introuvable.' };
  if (!existsSync(profile.dataRoot)) {
    return { ok: false, error: `Dossier introuvable : ${profile.dataRoot}` };
  }
  config.activeProfileId = profileId;
  await saveConfig(config);
  return { ok: true };
}

export async function renameProfile(profileId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const config = await ensureConfigLoaded();
  if (!config) return { ok: false, error: 'Configuration absente.' };
  const profile = config.profiles.find((p) => p.id === profileId);
  if (!profile) return { ok: false, error: 'Profil introuvable.' };
  profile.name = name.trim() || profile.name;
  await saveConfig(config);
  return { ok: true };
}

export async function removeProfile(profileId: string): Promise<{ ok: boolean; error?: string }> {
  const config = await ensureConfigLoaded();
  if (!config) return { ok: false, error: 'Configuration absente.' };
  if (config.profiles.length <= 1) {
    return { ok: false, error: 'Impossible de supprimer le dernier profil.' };
  }
  const idx = config.profiles.findIndex((p) => p.id === profileId);
  if (idx < 0) return { ok: false, error: 'Profil introuvable.' };
  config.profiles.splice(idx, 1);
  if (config.activeProfileId === profileId) {
    config.activeProfileId = config.profiles[0]!.id;
  }
  await saveConfig(config);
  return { ok: true };
}

export async function getDataSetupStatus(
  detectLegacy: () => LegacyDataLocation[]
): Promise<DataSetupStatus> {
  const config = await ensureConfigLoaded();
  const legacyLocations = detectLegacy();

  if (!config || config.profiles.length === 0) {
    return {
      needsSetup: true,
      profiles: [],
      activeProfileId: null,
      activeDataRoot: null,
      legacyLocations,
    };
  }

  const active = findActiveProfile(config);
  const activeDataRoot =
    active && existsSync(active.dataRoot) ? active.dataRoot : null;

  const needsSetup =
    !activeDataRoot ||
    config.profiles.some((p) => p.id === config.activeProfileId && !existsSync(p.dataRoot));

  return {
    needsSetup,
    profiles: config.profiles,
    activeProfileId: config.activeProfileId,
    activeDataRoot,
    legacyLocations,
  };
}
