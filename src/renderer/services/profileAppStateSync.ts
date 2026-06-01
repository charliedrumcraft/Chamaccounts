import {
  exportLocalStorageSnapshotToDataFile,
  importLocalStorageSnapshotFromDataFile,
} from './localStorageSnapshotService';

export type ProfileAppStateSyncResult =
  | { ok: true; keyCount?: number; skipped?: boolean }
  | { ok: false; error: string };

/** Écrit le localStorage courant dans AppState/ du dataRoot actif (fin de session ou changement de profil). */
export async function syncAppStateOnProfileLeave(): Promise<ProfileAppStateSyncResult> {
  const r = await exportLocalStorageSnapshotToDataFile();
  if (!r.ok) return { ok: false, error: r.error ?? 'Export AppState impossible' };
  return { ok: true, keyCount: r.keyCount };
}

/** Charge AppState/local_storage_snapshot.csv dans le localStorage de la partition active. */
export async function syncAppStateOnProfileEnter(): Promise<ProfileAppStateSyncResult> {
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
