export const APP_UI_LOCALE_STORAGE_KEY = 'chamaccounts-ui-locale';

export const APP_LOCALES = ['fr', 'en'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_APP_LOCALE: AppLocale = 'fr';

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return value === 'fr' || value === 'en';
}

export function readAppLocaleFromStorage(): AppLocale {
  try {
    const stored = localStorage.getItem(APP_UI_LOCALE_STORAGE_KEY);
    if (isAppLocale(stored)) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_APP_LOCALE;
}

export function writeAppLocaleToStorage(locale: AppLocale): void {
  try {
    localStorage.setItem(APP_UI_LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export function applyDocumentLang(locale: AppLocale): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
}
