/**
 * Lecture / écriture de AppState/mapping_wizard_profiles.json pour le profil actif.
 */

import * as fs from 'fs';
import * as path from 'path';
import { MAPPING_WIZARD_PROFILES_PATH } from '../../shared/dataPaths';
import {
  parseMappingWizardProfilesFile,
  sanitizeMappingWizardProfileInput,
  type MappingWizardProfile,
  type MappingWizardProfileInput,
  type MappingWizardProfilesFile,
} from '../../shared/mappingWizardProfiles';
import { tm } from '../uiI18n';

function fullPath(dataRoot: string): string {
  return path.join(dataRoot, MAPPING_WIZARD_PROFILES_PATH);
}

export function readMappingWizardProfiles(dataRoot: string): MappingWizardProfilesFile {
  const p = fullPath(dataRoot);
  if (!fs.existsSync(p)) return { version: 1, profiles: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as unknown;
    return parseMappingWizardProfilesFile(raw);
  } catch {
    return { version: 1, profiles: [] };
  }
}

export function writeMappingWizardProfiles(
  dataRoot: string,
  file: MappingWizardProfilesFile
): void {
  const p = fullPath(dataRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload: MappingWizardProfilesFile = {
    version: 1,
    profiles: file.profiles,
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf-8');
}

export function listMappingWizardProfiles(dataRoot: string): MappingWizardProfile[] {
  return readMappingWizardProfiles(dataRoot).profiles;
}

export function upsertMappingWizardProfile(
  dataRoot: string,
  input: MappingWizardProfileInput
): { ok: true; profile: MappingWizardProfile; profiles: MappingWizardProfile[] } | { ok: false; error: string } {
  const sanitized = sanitizeMappingWizardProfileInput(input);
  if (!sanitized.ok) {
    return { ok: false, error: tm(sanitized.errorKey) };
  }
  const file = readMappingWizardProfiles(dataRoot);
  const idx = file.profiles.findIndex((p) => p.id === sanitized.profile.id);
  // Empêcher deux profils avec la même signature (sauf soi-même).
  const conflict = file.profiles.find(
    (p) =>
      p.id !== sanitized.profile.id &&
      p.headerSignature.length === sanitized.profile.headerSignature.length &&
      p.headerSignature.every((h, i) => h === sanitized.profile.headerSignature[i])
  );
  if (conflict) {
    return {
      ok: false,
      error: tm('mappingProfiles.errors.duplicateSignature', { name: conflict.name }),
    };
  }
  if (idx >= 0) file.profiles[idx] = sanitized.profile;
  else file.profiles.push(sanitized.profile);
  writeMappingWizardProfiles(dataRoot, file);
  return { ok: true, profile: sanitized.profile, profiles: file.profiles };
}

export function removeMappingWizardProfile(
  dataRoot: string,
  profileId: string
): { ok: true; profiles: MappingWizardProfile[] } | { ok: false; error: string } {
  const id = String(profileId ?? '').trim();
  if (!id) return { ok: false, error: tm('mappingProfiles.errors.notFound') };
  const file = readMappingWizardProfiles(dataRoot);
  const next = file.profiles.filter((p) => p.id !== id);
  if (next.length === file.profiles.length) {
    return { ok: false, error: tm('mappingProfiles.errors.notFound') };
  }
  writeMappingWizardProfiles(dataRoot, { version: 1, profiles: next });
  return { ok: true, profiles: next };
}
