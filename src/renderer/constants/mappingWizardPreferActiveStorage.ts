/**
 * Préférence « mapping wizard actif » par page d’import (localStorage).
 * Utilisée pour réactiver automatiquement le mapping au collage / rechargement du lot.
 */

export const TX_MAPPING_PREFER_ACTIVE_KEY = 'transactions-import-mapping-prefer-active';
export const AB_MAPPING_PREFER_ACTIVE_KEY = 'account-balance-import-mapping-prefer-active';
export const SUPPORT_MAPPING_PREFER_ACTIVE_KEY = 'support-import-mapping-prefer-active';

/** Par défaut : true (activer le mapping dès qu’il y a des lignes). */
export function readMappingPreferActive(storageKey: string, defaultValue = true): boolean {
  try {
    const v = localStorage.getItem(storageKey);
    if (v === 'false') return false;
    if (v === 'true') return true;
  } catch {
    /* ignore */
  }
  return defaultValue;
}

export function writeMappingPreferActive(storageKey: string, active: boolean): void {
  try {
    localStorage.setItem(storageKey, String(active));
  } catch {
    /* ignore */
  }
}
