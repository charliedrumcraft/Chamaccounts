import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { changeAppLocale } from '../../i18n';
import {
  APP_LOCALES,
  isAppLocale,
  type AppLocale,
} from '../../i18n/localeStorage';

const LanguageSection: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [saving, setSaving] = useState(false);

  const current: AppLocale = isAppLocale(i18n.language)
    ? i18n.language
    : i18n.language.startsWith('en')
      ? 'en'
      : 'fr';

  const handleChange = useCallback(async (locale: AppLocale) => {
    if (locale === current) return;
    setSaving(true);
    try {
      await changeAppLocale(locale);
    } finally {
      setSaving(false);
    }
  }, [current]);

  return (
    <div className="w-full bg-white rounded-lg shadow border border-gray-200 p-5">
      <h2 className="text-lg font-semibold text-gray-800 mb-1">
        {t('settings.language.title')}
      </h2>
      <p className="text-sm text-gray-600 mb-4 max-w-3xl">
        {t('settings.language.description')}
      </p>
      <div
        className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 gap-1"
        role="group"
        aria-label={t('common.language')}
      >
        {APP_LOCALES.map((locale) => {
          const selected = locale === current;
          const label = locale === 'fr' ? t('common.french') : t('common.english');
          return (
            <button
              key={locale}
              type="button"
              disabled={saving}
              aria-pressed={selected}
              onClick={() => void handleChange(locale)}
              className={`
                min-w-[7.5rem] rounded-md px-3 py-2 text-sm font-medium transition-colors
                disabled:opacity-50
                ${selected
                  ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                  : 'text-gray-600 hover:bg-white/70 hover:text-gray-800 border border-transparent'}
              `}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default LanguageSection;
