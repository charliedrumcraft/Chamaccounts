/**
 * Accès renderer aux profils de mapping wizard (AppState du profil actif).
 */

import type {
  MappingWizardProfile,
  MappingWizardProfileInput,
} from '@/shared/mappingWizardProfiles';
import i18n from '../i18n';

export async function listMappingWizardProfiles(): Promise<MappingWizardProfile[]> {
  const api = window.electronAPI;
  if (!api?.mappingWizardProfilesList) return [];
  const r = await api.mappingWizardProfilesList();
  return r.success && Array.isArray(r.data) ? r.data : [];
}

export async function upsertMappingWizardProfile(
  input: MappingWizardProfileInput
): Promise<
  | { ok: true; profile: MappingWizardProfile; profiles: MappingWizardProfile[] }
  | { ok: false; error: string }
> {
  const api = window.electronAPI;
  if (!api?.mappingWizardProfilesUpsert) {
    return { ok: false, error: i18n.t('system.apiUnavailableShort') };
  }
  const r = await api.mappingWizardProfilesUpsert(input);
  if (!r.success || !r.data) {
    return { ok: false, error: r.error ?? i18n.t('system.saveFailed') };
  }
  return { ok: true, profile: r.data.profile, profiles: r.data.profiles };
}

export async function removeMappingWizardProfile(
  profileId: string
): Promise<{ ok: true; profiles: MappingWizardProfile[] } | { ok: false; error: string }> {
  const api = window.electronAPI;
  if (!api?.mappingWizardProfilesRemove) {
    return { ok: false, error: i18n.t('system.apiUnavailableShort') };
  }
  const r = await api.mappingWizardProfilesRemove(profileId);
  if (!r.success || !r.data) {
    return { ok: false, error: r.error ?? i18n.t('system.saveFailed') };
  }
  return { ok: true, profiles: r.data.profiles };
}
