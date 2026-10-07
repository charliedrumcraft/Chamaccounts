import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/Layout/AppShell';
import DataSetup from './pages/DataSetup';
import WorkingCurrenciesWizard from './pages/WorkingCurrenciesWizard';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import TransactionsTable from './pages/TransactionsTable';
import AccountBalanceTable from './pages/AccountBalanceTable';
import MonthlyAccounting from './pages/MonthlyAccounting';
import AnnualBudget from './pages/AnnualBudget';
import Support from './pages/Support';
import { useProfileAppStateLifecycle } from './hooks/useProfileAppStateLifecycle';
import { useWorkingCurrenciesGate } from './hooks/useWorkingCurrenciesGate';
import { restoreRecognisedListsFromAppStateIfEmpty } from './services/localStorageSnapshotService';

const App: React.FC = () => {
  const { t } = useTranslation();
  const [setupChecked, setSetupChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  const checkSetup = useCallback(async () => {
    const api = window.electronAPI;
    if (!api?.getDataSetupStatus) {
      setNeedsSetup(false);
      setSetupChecked(true);
      return;
    }
    const status = await api.getDataSetupStatus();
    setNeedsSetup(status.needsSetup);
    setSetupChecked(true);
  }, []);

  useEffect(() => {
    void checkSetup();
  }, [checkSetup]);

  const profileReady = setupChecked && !needsSetup;
  const appStateReady = useProfileAppStateLifecycle(profileReady);
  const {
    ready: currenciesReady,
    needsWizard,
    markConfigured,
  } = useWorkingCurrenciesGate(profileReady && appStateReady);

  useEffect(() => {
    if (!appStateReady || !profileReady) return;
    let cancelled = false;
    void (async () => {
      const r = await restoreRecognisedListsFromAppStateIfEmpty();
      if (cancelled || !r.ok || !(r.restoredKeys?.length)) return;
      console.info('[AppState] listes reconnues restaurées:', r.restoredKeys.join(', '));
    })();
    return () => {
      cancelled = true;
    };
  }, [appStateReady, profileReady]);

  const handleSetupComplete = useCallback(async () => {
    await checkSetup();
    const api = window.electronAPI;
    if (api?.reloadWindowForActiveProfile) {
      await api.reloadWindowForActiveProfile();
    }
  }, [checkSetup]);

  if (
    !setupChecked ||
    (profileReady && !appStateReady) ||
    (profileReady && appStateReady && !currenciesReady)
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-600">
        {t('common.loading')}
      </div>
    );
  }

  if (needsSetup) {
    return <DataSetup onComplete={() => void handleSetupComplete()} />;
  }

  if (needsWizard) {
    return <WorkingCurrenciesWizard onConfigured={markConfigured} />;
  }

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="/transactions" element={<TransactionsTable />} />
          <Route path="/account-balance" element={<AccountBalanceTable />} />
          <Route path="/monthly-accounting" element={<MonthlyAccounting />} />
          <Route path="/annual-budget" element={<AnnualBudget />} />
          <Route path="/soutien" element={<Support />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </Router>
  );
};

export default App;
