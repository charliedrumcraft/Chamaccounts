import React from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import TransactionsTable from './pages/TransactionsTable';
import AccountBalanceTable from './pages/AccountBalanceTable';
import MonthlyAccounting from './pages/MonthlyAccounting';
import AnnualBudget from './pages/AnnualBudget';

const App: React.FC = () => {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/transactions" element={<TransactionsTable />} />
        <Route path="/account-balance" element={<AccountBalanceTable />} />
        <Route path="/monthly-accounting" element={<MonthlyAccounting />} />
        <Route path="/annual-budget" element={<AnnualBudget />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Router>
  );
};

export default App;
