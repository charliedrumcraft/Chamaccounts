/** Préférences mises à jour (stockage navigateur / Electron userData côté UI). */

export const APP_UPDATE_CHECK_ON_STARTUP_KEY = 'chamaccounts-update-check-on-startup';
export const APP_UPDATE_DISMISSED_VERSION_KEY = 'chamaccounts-update-dismissed-version';

export function readUpdateCheckOnStartup(): boolean {
  try {
    const v = localStorage.getItem(APP_UPDATE_CHECK_ON_STARTUP_KEY);
    return v === null ? true : v === 'true';
  } catch {
    return true;
  }
}

export function writeUpdateCheckOnStartup(enabled: boolean): void {
  try {
    localStorage.setItem(APP_UPDATE_CHECK_ON_STARTUP_KEY, String(enabled));
  } catch {}
}

export function readDismissedUpdateVersion(): string | null {
  try {
    return localStorage.getItem(APP_UPDATE_DISMISSED_VERSION_KEY);
  } catch {
    return null;
  }
}

export function writeDismissedUpdateVersion(version: string): void {
  try {
    localStorage.setItem(APP_UPDATE_DISMISSED_VERSION_KEY, version);
  } catch {}
}

export function clearDismissedUpdateVersion(): void {
  try {
    localStorage.removeItem(APP_UPDATE_DISMISSED_VERSION_KEY);
  } catch {}
}
