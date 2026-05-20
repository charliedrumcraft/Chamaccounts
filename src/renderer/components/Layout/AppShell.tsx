import React, { useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import UpdateAvailableBanner from './UpdateAvailableBanner';
import {
  readAppSidebarCollapsedFromStorage,
  writeAppSidebarCollapsedToStorage,
} from '../../constants/appSidebarCollapsedStorage';

const AppShell: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readAppSidebarCollapsedFromStorage);

  const handleSidebarCollapsedPreferenceToggle = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      writeAppSidebarCollapsedToStorage(next);
      return next;
    });
  }, []);

  return (
    <div className="h-screen flex overflow-hidden bg-gray-50">
      <Sidebar
        collapsed={sidebarCollapsed}
        onCollapsedPreferenceToggle={handleSidebarCollapsedPreferenceToggle}
      />
      <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
        <UpdateAvailableBanner />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default AppShell;
