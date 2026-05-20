/** Clé unique pour l’état replié/déplié de la barre latérale (toutes les pages). */
export const APP_SIDEBAR_COLLAPSED_STORAGE_KEY = 'chamaccounts-sidebar-collapsed';

const LEGACY_SIDEBAR_COLLAPSED_KEYS = [
  'dashboard-sidebar-collapsed',
  'transactions-sidebar-collapsed',
  'account-balance-sidebar-collapsed',
  'monthly-accounting-sidebar-collapsed',
  'annual-budget-sidebar-collapsed',
] as const;

export function readAppSidebarCollapsedFromStorage(): boolean {
  try {
    const v = localStorage.getItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
    for (const k of LEGACY_SIDEBAR_COLLAPSED_KEYS) {
      const lv = localStorage.getItem(k);
      if (lv === 'true' || lv === 'false') {
        const collapsed = lv === 'true';
        localStorage.setItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
        return collapsed;
      }
    }
  } catch {}
  return false;
}

export function writeAppSidebarCollapsedToStorage(collapsed: boolean): void {
  try {
    localStorage.setItem(APP_SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {}
}
