import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  loadRecognisedAccountsFromStorage,
  RECOGNISED_ACCOUNTS_STORAGE_KEY,
} from '../constants/recognisedAccountsStorage';
import {
  loadRecognisedEntryTypesFromStorage,
  loadRecognisedOutputTypesFromStorage,
  RECOGNISED_ENTRY_TYPES_STORAGE_KEY,
  RECOGNISED_OUTPUT_TYPES_STORAGE_KEY,
} from '../constants/recognisedTypesStorage';
import {
  GETTING_STARTED_CHANGED_EVENT,
  readGettingStartedDismissed,
  readGettingStartedForceShow,
  restoreGettingStartedChecklist,
  writeGettingStartedDismissed,
  writeGettingStartedForceShow,
} from '../constants/gettingStartedStorage';
import { loadWorkingCurrencies } from '../services/workingCurrenciesService';
import { AccountBalanceCSVService } from '../services/AccountBalanceCSVService';

export type GettingStartedStepId =
  | 'currencies'
  | 'accounts'
  | 'types'
  | 'importTransactions'
  | 'importBalances';

export type GettingStartedStep = {
  id: GettingStartedStepId;
  done: boolean;
  /** Chemin HashRouter (+ query optionnelle). */
  to: string;
};

export type GettingStartedProgress = {
  loading: boolean;
  dismissed: boolean;
  steps: GettingStartedStep[];
  doneCount: number;
  totalCount: number;
  allDone: boolean;
  /** Afficher la checklist (pas dismissée / pas tout fait, ou relancée manuellement). */
  visible: boolean;
  dismiss: () => void;
  /** Réaffiche la checklist même si elle avait été masquée ou terminée. */
  restore: () => void;
  refresh: () => void;
};

function readLocalListProgress(): {
  hasAccounts: boolean;
  hasTypes: boolean;
} {
  const accounts = loadRecognisedAccountsFromStorage();
  const entry = loadRecognisedEntryTypesFromStorage();
  const output = loadRecognisedOutputTypesFromStorage();
  return {
    hasAccounts: accounts.some((a) => a.name.trim()),
    hasTypes: entry.length > 0 || output.length > 0,
  };
}

/**
 * Progression du parcours premier usage (dérivée des données profil + listes locales).
 * La checklist se masque quand tout est fait ou après dismiss explicite.
 */
export function useGettingStartedProgress(): GettingStartedProgress {
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(readGettingStartedDismissed);
  const [forceShow, setForceShow] = useState(readGettingStartedForceShow);
  const [currenciesConfigured, setCurrenciesConfigured] = useState(false);
  const [transactionCount, setTransactionCount] = useState(0);
  const [hasBalanceData, setHasBalanceData] = useState(false);
  const [hasAccounts, setHasAccounts] = useState(false);
  const [hasTypes, setHasTypes] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const refresh = useCallback(() => {
    const lists = readLocalListProgress();
    setHasAccounts(lists.hasAccounts);
    setHasTypes(lists.hasTypes);
    setDismissed(readGettingStartedDismissed());
    setForceShow(readGettingStartedForceShow());
    setReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const lists = readLocalListProgress();
    setHasAccounts(lists.hasAccounts);
    setHasTypes(lists.hasTypes);

    void (async () => {
      try {
        const [wc, balanceChart] = await Promise.all([
          loadWorkingCurrencies(),
          AccountBalanceCSVService.getMonthlyBalancesForChart().catch(() => null),
        ]);
        if (cancelled) return;
        setCurrenciesConfigured(Boolean(wc.configured));
        setTransactionCount(wc.transactionCount ?? 0);
        setHasBalanceData(
          Boolean(
            balanceChart &&
              balanceChart.periods.length > 0 &&
              balanceChart.balanceData.length > 0
          )
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Recharger aussi à chaque navigation (ex. retour Dashboard après Profile / Import).
  }, [reloadToken, location.pathname, location.search]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === null ||
        e.key === RECOGNISED_ACCOUNTS_STORAGE_KEY ||
        e.key === RECOGNISED_ENTRY_TYPES_STORAGE_KEY ||
        e.key === RECOGNISED_OUTPUT_TYPES_STORAGE_KEY
      ) {
        refresh();
      }
    };
    const onGettingStartedChanged = () => refresh();
    window.addEventListener('storage', onStorage);
    window.addEventListener(GETTING_STARTED_CHANGED_EVENT, onGettingStartedChanged);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(GETTING_STARTED_CHANGED_EVENT, onGettingStartedChanged);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const steps = useMemo<GettingStartedStep[]>(
    () => [
      {
        id: 'currencies',
        done: currenciesConfigured,
        to: '/settings',
      },
      {
        id: 'accounts',
        done: hasAccounts,
        to: '/profile',
      },
      {
        id: 'types',
        done: hasTypes,
        to: '/profile',
      },
      {
        id: 'importTransactions',
        done: transactionCount > 0,
        to: '/transactions?focus=import',
      },
      {
        id: 'importBalances',
        done: hasBalanceData,
        to: '/account-balance?focus=import',
      },
    ],
    [currenciesConfigured, hasAccounts, hasTypes, transactionCount, hasBalanceData]
  );

  const requiredSteps = steps.filter((s) => s.id !== 'importBalances');
  const doneCount = requiredSteps.filter((s) => s.done).length;
  const totalCount = requiredSteps.length;
  /** Les soldes restent optionnels : la checklist se masque dès que devises + comptes + types + transactions sont faits. */
  const allDone = requiredSteps.every((s) => s.done);
  const visible = forceShow || (!dismissed && !allDone);

  const dismiss = useCallback(() => {
    writeGettingStartedDismissed(true);
    writeGettingStartedForceShow(false);
    setDismissed(true);
    setForceShow(false);
  }, []);

  const restore = useCallback(() => {
    restoreGettingStartedChecklist();
    setDismissed(false);
    setForceShow(true);
  }, []);

  return {
    loading,
    dismissed,
    steps,
    doneCount,
    totalCount,
    allDone,
    visible,
    dismiss,
    restore,
    refresh,
  };
}
