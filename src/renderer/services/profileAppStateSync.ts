import {
  exportLocalStorageSnapshotToDataFile,
  importLocalStorageSnapshotFromDataFile,
} from './localStorageSnapshotService';

export type ProfileAppStateSyncResult =
  | { ok: true; keyCount?: number; skipped?: boolean }
  | { ok: false; error: string };

/** Les pages écoutent cet événement pour flusher les brouillons vers localStorage avant l’export CSV. */
export const PERSIST_PENDING_APP_STATE_EVENT = 'chamaccounts-persist-pending-app-state';

function localStorageHasEntries(): boolean {
  return typeof localStorage !== 'undefined' && localStorage.length > 0;
}

/** Écrit le localStorage courant dans AppState/ du dataRoot actif (fin de session ou changement de profil). */
export async function syncAppStateOnProfileLeave(): Promise<ProfileAppStateSyncResult> {
  const r = await exportLocalStorageSnapshotToDataFile();
  if (!r.ok) return { ok: false, error: r.error ?? 'Export AppState impossible' };
  return { ok: true, keyCount: r.keyCount };
}

/**
 * Restaure AppState depuis le CSV uniquement si la partition Chromium est vide
 * (nouveau profil, autre machine, userData vidé).
 * Sinon on conserve le localStorage déjà persisté : un replace écraserait des
 * modifications plus récentes par un snapshot CSV éventuellement périmé.
 */
export async function syncAppStateOnProfileEnter(): Promise<ProfileAppStateSyncResult> {
  if (localStorageHasEntries()) {
    return { ok: true, skipped: true };
  }
  const r = await importLocalStorageSnapshotFromDataFile('replace');
  if (!r.ok) {
    const err = r.error ?? '';
    if (err.includes('introuvable') || err.includes('illisible')) {
      return { ok: true, skipped: true };
    }
    return { ok: false, error: err };
  }
  return { ok: true, keyCount: r.keyCount };
}
