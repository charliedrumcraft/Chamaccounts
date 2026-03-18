import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import Sidebar from '../components/Layout/Sidebar';

const Home: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed((c) => !c)} />
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-800">Chamaccounts</h1>
          <div className="mt-4 flex flex-col sm:flex-row gap-3 justify-center flex-wrap">
          <Link
            to="/dashboard"
            className="inline-block px-6 py-3 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Ouvrir le tableau de bord
          </Link>
          <Link
            to="/transactions"
            className="inline-block px-6 py-3 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Ouvrir le tableau des transactions
          </Link>
          <Link
            to="/account-balance"
            className="inline-block px-6 py-3 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Ouvrir les soldes des comptes
          </Link>
          <Link
            to="/monthly-accounting"
            className="inline-block px-6 py-3 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Comptabilité mensuelle
          </Link>
          <Link
            to="/annual-budget"
            className="inline-block px-6 py-3 bg-gray-800 text-white font-medium rounded-lg hover:bg-gray-700 transition-colors"
          >
            Budget annuel
          </Link>
          <Link
            to="/settings"
            className="inline-block px-6 py-3 bg-gray-200 text-gray-800 font-medium rounded-lg hover:bg-gray-300 transition-colors"
          >
            Réglages
          </Link>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Home;
