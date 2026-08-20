import { useEffect, useState } from 'react';
import {
  PERSIST_PENDING_APP_STATE_EVENT,
  syncAppStateOnProfileEnter,
  syncAppStateOnProfileLeave,
} from '../services/profileAppStateSync';

function dispatchPersistPendingAppState(): void {
  try {
    window.dispatchEvent(new Event(PERSIST_PENDING_APP_STATE_EVENT));
  } catch {
    /* ignore */
  }
}

/**
 * Au démarrage (profil configuré) : charge AppState depuis le dataRoot si la partition est vide.
 * À la fermeture de fenêtre / quitter : flush des brouillons puis export CSV du profil actif.
 * @returns true quand l’import initial est terminé (ou inutile) — ne pas monter l’UI métier avant.
 */
export function useProfileAppStateLifecycle(enabled: boolean): boolean {
  const [ready, setReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled) {
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);
    const api = window.electronAPI;

    void (async () => {
      if (api?.getDataRoot) {
        const root = await api.getDataRoot();
        if (root.success) {
          const r = await syncAppStateOnProfileEnter();
          if (!r.ok && !r.skipped) {
            console.warn('[AppState] import au démarrage:', r.error);
          }
        }
      }
      if (!cancelled) setReady(true);
    })();

    const unsubFlush = api?.onFlushAppStateBeforeQuit?.(() => {
      dispatchPersistPendingAppState();
      void syncAppStateOnProfileLeave().finally(() => {
        void api.notifyAppStateFlushComplete?.();
      });
    });

    return () => {
      cancelled = true;
      unsubFlush?.();
    };
  }, [enabled]);

  return ready;
}
