import type { DataSetupStatus } from '@/shared/profiles';
import { DATA_TEMPLATE_PROFILE_NAME } from '@/shared/dataTemplateProfile';
import { syncAppStateOnProfileLeave } from '../services/profileAppStateSync';

const RESUME_KEY = 'chamaccounts-guided-tour-resume';
const RESTORE_PROFILE_KEY = 'chamaccounts-guided-tour-restore-profile';

export type GuidedTourResumeSession = {
  stepIndex: number;
};

export function findDataTemplateProfileId(status: DataSetupStatus): string | null {
  return status.profiles.find((p) => p.name === DATA_TEMPLATE_PROFILE_NAME)?.id ?? null;
}

export function readGuidedTourResumeSession(): GuidedTourResumeSession | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuidedTourResumeSession;
    if (typeof parsed.stepIndex !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearGuidedTourResumeSession(): void {
  sessionStorage.removeItem(RESUME_KEY);
}

export function readGuidedTourRestoreProfileId(): string | null {
  return sessionStorage.getItem(RESTORE_PROFILE_KEY);
}

export function clearGuidedTourRestoreProfileId(): void {
  sessionStorage.removeItem(RESTORE_PROFILE_KEY);
}

/** Active le profil Data Template et recharge la fenêtre ; la visite reprend via sessionStorage. */
export async function switchToDataTemplateProfileForTour(stepIndex: number): Promise<boolean> {
  const api = window.electronAPI;
  if (!api?.getDataSetupStatus || !api.setActiveProfile || !api.reloadWindowForActiveProfile) {
    return false;
  }
  const status = await api.getDataSetupStatus();
  const templateId = findDataTemplateProfileId(status);
  if (!templateId) return false;
  if (status.activeProfileId === templateId) return false;

  sessionStorage.setItem(RESUME_KEY, JSON.stringify({ stepIndex } satisfies GuidedTourResumeSession));
  if (status.activeProfileId) {
    sessionStorage.setItem(RESTORE_PROFILE_KEY, status.activeProfileId);
  }

  const left = await syncAppStateOnProfileLeave();
  if (!left.ok) {
    clearGuidedTourResumeSession();
    clearGuidedTourRestoreProfileId();
    return false;
  }

  const r = await api.setActiveProfile(templateId);
  if (!r.ok) {
    clearGuidedTourResumeSession();
    clearGuidedTourRestoreProfileId();
    return false;
  }

  await api.reloadWindowForActiveProfile();
  return true;
}

/** Rétablit le profil utilisé avant la visite guidée. */
export async function restoreProfileAfterGuidedTour(): Promise<void> {
  const restoreId = readGuidedTourRestoreProfileId();
  clearGuidedTourRestoreProfileId();
  if (!restoreId) return;

  const api = window.electronAPI;
  if (!api?.getDataSetupStatus || !api.setActiveProfile || !api.reloadWindowForActiveProfile) {
    return;
  }

  const status = await api.getDataSetupStatus();
  if (status.activeProfileId === restoreId) return;
  if (!status.profiles.some((p) => p.id === restoreId)) return;

  const left = await syncAppStateOnProfileLeave();
  if (!left.ok) return;

  const r = await api.setActiveProfile(restoreId);
  if (!r.ok) return;

  await api.reloadWindowForActiveProfile();
}
