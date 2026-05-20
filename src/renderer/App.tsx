import React from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import AppShell from './components/Layout/AppShell';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import TransactionsTable from './pages/TransactionsTable';
import AccountBalanceTable from './pages/AccountBalanceTable';
import MonthlyAccounting from './pages/MonthlyAccounting';
import AnnualBudget from './pages/AnnualBudget';
import Support from './pages/Support';

const App: React.FC = () => {
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
