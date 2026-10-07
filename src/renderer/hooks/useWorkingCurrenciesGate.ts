import { useCallback, useEffect, useState } from 'react';
import {
  loadWorkingCurrencies,
  type WorkingCurrenciesState,
} from '../services/workingCurrenciesService';

/**
 * Charge les devises de travail ; indique si le wizard est requis
 * (profil non configuré + aucune transaction).
 */
export function useWorkingCurrenciesGate(enabled: boolean): {
  ready: boolean;
  needsWizard: boolean;
  state: WorkingCurrenciesState | null;
  refresh: () => Promise<void>;
  markConfigured: () => void;
} {
  const [ready, setReady] = useState(false);
  const [needsWizard, setNeedsWizard] = useState(false);
  const [state, setState] = useState<WorkingCurrenciesState | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setReady(false);
      return;
    }
    const s = await loadWorkingCurrencies();
    setState(s);
    setNeedsWizard(!s.configured && s.transactionCount === 0);
    setReady(true);
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markConfigured = useCallback(() => {
    setNeedsWizard(false);
    void refresh();
  }, [refresh]);

  return { ready, needsWizard, state, refresh, markConfigured };
}
