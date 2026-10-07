import {
  exportLocalStorageSnapshotToDataFile,
  importLocalStorageSnapshotFromDataFile,
  restoreRecognisedListsFromAppStateIfEmpty,
} from './localStorageSnapshotService';
import i18n from '../i18n';

export type ProfileAppStateSyncResult =
  | { ok: true; keyCount?: number; skipped?: boolean; restoredKeys?: string[] }
  | { ok: false; error: string }

/** Les pages écoutent cet événement pour flusher les brouillons vers localStorage avant l’export CSV. */
export const PERSIST_PENDING_APP_STATE_EVENT = 'chamaccounts-persist-pending-app-state';

/** Fichier snapshot absent / illisible (message FR ou EN selon la locale du main process). */
function isMissingSnapshotError(message: string): boolean {
  return /introuvable|illisible|non trouvé|not found|unreadable/i.test(message);
}

function localStorageHasEntries(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.length > 0;
}

/** Écrit le localStorage courant dans AppState/ du dataRoot actif (fin de session ou changement de profil). */
export async function syncAppStateOnProfileLeave(): Promise<ProfileAppStateSyncResult> {
  const r = await exportLocalStorageSnapshotToDataFile();
  if (!r.ok) return { ok: false, error: r.error ?? i18n.t('system.appStateExportFailed') };
  return { ok: true, keyCount: r.keyCount };
}

/**
 * Restaure AppState depuis le CSV uniquement si la partition Chromium est vide
 * (nouveau profil, autre machine, userData vidé).
 * Sinon on conserve le localStorage déjà persisté : un replace écraserait des
 * modifications plus récentes par un snapshot CSV éventuellement périmé.
 * Si les listes reconnues sont vides alors que le CSV en a, on les fusionne.
 */
export async function syncAppStateOnProfileEnter(): Promise<ProfileAppStateSyncResult> {
  if (!localStorageHasEntries()) {
    const r = await importLocalStorageSnapshotFromDataFile('replace');
    if (!r.ok) {
      const err = r.error ?? '';
      if (isMissingSnapshotError(err)) {
        return { ok: true, skipped: true };
      }
      return { ok: false, error: err };
    }
    return { ok: true, keyCount: r.keyCount };
  }

  const restored = await restoreRecognisedListsFromAppStateIfEmpty();
  if (!restored.ok) {
    console.warn('[AppState] restauration listes reconnues:', restored.error);
    return { ok: true, skipped: true };
  }
  if ((restored.restoredKeys?.length ?? 0) > 0) {
    return {
      ok: true,
      keyCount: restored.keyCount,
      restoredKeys: restored.restoredKeys,
    };
  }
  return { ok: true, skipped: true };
}
