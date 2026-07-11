import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { GITHUB_REPO_NAME } from '@/shared/githubApp';
import { useSidebarAppInfo } from '../../hooks/useSidebarAppInfo';
import { useGuidedTour } from '../../guidedTour/GuidedTourContext';

export interface SidebarProps {
  collapsed: boolean;
  /** Uniquement le clic sur la flèche en tête de barre : le parent y met l’affichage et la persistance (ex. localStorage). */
  onCollapsedPreferenceToggle: () => void;
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function TableIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function BankIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M3 10h18M5 6l7-4 7 4M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3" />
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

function BudgetIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function HeartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
      />
    </svg>
  );
}

const navItems = [
  { to: '/', label: 'Tableau de bord', icon: ChartIcon },
  { to: '/transactions', label: 'Tableau des transactions', icon: TableIcon },
  { to: '/account-balance', label: 'Soldes des comptes', icon: BankIcon },
  { to: '/monthly-accounting', label: 'Comptabilité mensuelle', icon: CalendarIcon },
  { to: '/annual-budget', label: 'Budget annuel', icon: BudgetIcon },
  { to: '/soutien', label: 'Soutien', icon: HeartIcon },
  { to: '/settings', label: 'Réglages', icon: SettingsIcon },
];

function ChevronIcon({ left }: { left: boolean }) {
  return (
    <svg
      className={`w-5 h-5 transition-transform ${left ? 'rotate-0' : 'rotate-180'}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function TourIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 20l-5.447-2.724A2 2 0 013 15.382V6.618a2 2 0 011.553-1.894L9 2m0 18l6-3m-6 3V2m6 15l5.447 2.724A2 2 0 0021 17.382V8.618a2 2 0 00-1.553-1.894L15 4m0 13V4m0 0L9 2"
      />
    </svg>
  );
}

function SidebarFooter({
  collapsed,
  appVersion,
  activeProfileName,
  onStartTour,
  tourActive,
}: {
  collapsed: boolean;
  appVersion: string | null;
  activeProfileName: string | null;
  onStartTour: () => void;
  tourActive: boolean;
}) {
  const versionLabel = appVersion ? `v${appVersion}` : null;
  const profileLabel = activeProfileName ?? 'Profil non configuré';
  const tooltip = [profileLabel, versionLabel].filter(Boolean).join(' · ');

  if (collapsed) {
    return (
      <div className="shrink-0 border-t border-gray-100 py-2 flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={onStartTour}
          disabled={tourActive}
          className="flex h-8 w-8 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 disabled:opacity-50"
          title="Visite guidée"
          aria-label="Visite guidée"
        >
          <TourIcon className="w-4 h-4" />
        </button>
        <span
          className="flex h-8 w-8 items-center justify-center rounded-md text-gray-400"
          title={tooltip || undefined}
          aria-label={tooltip || 'Informations application'}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </span>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-gray-100 px-3 py-3 space-y-2">
      <button
        type="button"
        onClick={onStartTour}
        disabled={tourActive}
        className="w-full flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2 py-2 text-xs font-medium text-blue-800 hover:bg-blue-100 disabled:opacity-50 transition-colors"
      >
        <TourIcon className="w-4 h-4 shrink-0" />
        Visite guidée
      </button>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-gray-400">Profil actif</p>
        <p className="text-xs font-medium text-gray-700 truncate" title={profileLabel}>
          {profileLabel}
        </p>
      </div>
      {versionLabel && (
        <p className="text-[11px] text-gray-400 tabular-nums" title={`Version ${versionLabel}`}>
          {versionLabel}
        </p>
      )}
    </div>
  );
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onCollapsedPreferenceToggle }) => {
  const location = useLocation();
  const { appVersion, activeProfileName } = useSidebarAppInfo();
  const { startTour, active: tourActive } = useGuidedTour();

  return (
    <aside
      className={`
        flex flex-col bg-white border-r border-gray-200 shadow-sm
        transition-[width] duration-200 ease-in-out shrink-0
        ${collapsed ? 'w-14' : 'w-56'}
      `}
    >
      {/* En-tête avec bouton réduire */}
      <div className={`flex items-center h-12 border-b border-gray-100 shrink-0 ${collapsed ? 'justify-center px-0' : 'justify-between px-3'}`}>
        {!collapsed && (
          <span className="text-sm font-semibold text-gray-700 truncate">{GITHUB_REPO_NAME}</span>
        )}
        <button
          type="button"
          onClick={onCollapsedPreferenceToggle}
          className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          title={collapsed ? 'Ouvrir le menu' : 'Réduire le menu'}
          aria-label={collapsed ? 'Ouvrir le menu' : 'Réduire le menu'}
        >
          <ChevronIcon left={collapsed} />
        </button>
      </div>

      {/* Liens de navigation */}
      <nav className="flex-1 py-2 overflow-y-auto" data-tour="sidebar-nav">
        <ul className={`space-y-0.5 ${collapsed ? 'flex flex-col items-center px-0' : 'px-2'}`}>
          {navItems.map(({ to, label, icon: Icon }) => {
            const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
            return (
              <li key={to} className={collapsed ? 'w-full flex justify-center' : ''}>
                <Link
                  to={to}
                  data-tour={`nav-${to}`}
                  className={`
                    flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors
                    ${collapsed ? 'justify-center px-0 w-10' : 'px-3'}
                    ${isActive
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'}
                  `}
                  title={collapsed ? label : undefined}
                >
                  <Icon className="w-5 h-5 shrink-0 text-gray-500" />
                  {!collapsed && <span className="truncate">{label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <SidebarFooter
        collapsed={collapsed}
        appVersion={appVersion}
        activeProfileName={activeProfileName}
        onStartTour={startTour}
        tourActive={tourActive}
      />
    </aside>
  );
};

export default Sidebar;
