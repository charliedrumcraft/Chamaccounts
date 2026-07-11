import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import {
  DATA_TEMPLATE_PROFILE_DIRNAME,
  DATA_TEMPLATE_PROFILE_NAME,
} from '../shared/dataTemplateProfile';
import type { Profile } from '../shared/profiles';
import { addProfile, ensureConfigLoaded, saveConfig } from './appConfig';
import { ensureDataTree, getConfigDir } from './dataDirectory';

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
    throw new Error(`Bundle profil template introuvable : ${bundle}`);
  }
  await fs.mkdir(dataRoot, { recursive: true });
  await fs.cp(bundle, dataRoot, { recursive: true, force: true });
  await ensureDataTree(dataRoot);
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
