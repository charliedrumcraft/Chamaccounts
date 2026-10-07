import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  applyDocumentLang,
  DEFAULT_APP_LOCALE,
  readAppLocaleFromStorage,
  writeAppLocaleToStorage,
  type AppLocale,
} from './localeStorage';
import en from './locales/en.json';
import fr from './locales/fr.json';

const initialLocale = readAppLocaleFromStorage();

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: initialLocale,
  fallbackLng: DEFAULT_APP_LOCALE,
  interpolation: {
    escapeValue: false,
  },
});

applyDocumentLang(initialLocale);

i18n.on('languageChanged', (lng) => {
  if (lng === 'fr' || lng === 'en') {
    applyDocumentLang(lng);
  }
});

export async function changeAppLocale(locale: AppLocale): Promise<void> {
  writeAppLocaleToStorage(locale);
  await i18n.changeLanguage(locale);
  try {
    await window.electronAPI?.setUiLocale?.(locale);
  } catch {
    /* hors Electron */
  }
}

/** Synchronise la locale renderer → main (dialogs / erreurs IPC). */
export function syncUiLocaleToMain(): void {
  const locale = readAppLocaleFromStorage();
  void window.electronAPI?.setUiLocale?.(locale).catch(() => {});
}

export default i18n;
