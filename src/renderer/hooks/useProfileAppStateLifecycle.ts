import { useEffect } from 'react';
import {
  syncAppStateOnProfileEnter,
  syncAppStateOnProfileLeave,
} from '../services/profileAppStateSync';

/**
 * Au démarrage (profil configuré) : charge AppState depuis le dataRoot.
 * À la fermeture : flush vers le CSV du profil actif.
 */
export function useProfileAppStateLifecycle(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const api = window.electronAPI;
    if (!api?.getDataRoot) return;

    void (async () => {
      const root = await api.getDataRoot!();
      if (!root.success) return;
      const r = await syncAppStateOnProfileEnter();
      if (!r.ok && !r.skipped) {
        console.warn('[AppState] import au démarrage:', r.error);
      }
    })();

    const unsubFlush = api.onFlushAppStateBeforeQuit?.(() => {
      void syncAppStateOnProfileLeave().then(() => {
        void api.notifyAppStateFlushComplete?.();
      });
    });

    return () => {
      unsubFlush?.();
    };
  }, [enabled]);
}
