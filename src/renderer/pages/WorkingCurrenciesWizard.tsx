import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FRANKFURTER_CURRENCY_CODES,
  currencyDisplaySymbol,
} from '@/shared/workingCurrencies';
import { saveWorkingCurrencies } from '../services/workingCurrenciesService';

type Props = {
  onConfigured: () => void;
};

const WorkingCurrenciesWizard: React.FC<Props> = ({ onConfigured }) => {
  const { t } = useTranslation();
  const [primary, setPrimary] = useState('GBP');
  const [secondary1, setSecondary1] = useState('EUR');
  const [secondary2, setSecondary2] = useState('CHF');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => [...FRANKFURTER_CURRENCY_CODES], []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const r = await saveWorkingCurrencies({
        primary,
        secondaries: [secondary1, secondary2],
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onConfigured();
    } finally {
      setSaving(false);
    }
  };

  const renderSelect = (
    id: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    allowNone: boolean
  ) => (
    <label className="flex flex-col gap-1 text-sm text-gray-700">
      <span className="font-medium">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-gray-300 bg-white px-3 py-2 text-gray-900"
      >
        {allowNone && <option value="">{t('common.none')}</option>}
        {options.map((code) => (
          <option key={code} value={code} disabled={code === primary && allowNone}>
            {code} ({currencyDisplaySymbol(code)})
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm space-y-5"
      >
        <div>
          <h1 className="text-xl font-semibold text-slate-900">{t('currenciesWizard.title')}</h1>
          <p className="mt-2 text-sm text-slate-600">{t('currenciesWizard.description')}</p>
        </div>

        {renderSelect('wc-primary', t('currenciesWizard.primary'), primary, setPrimary, false)}
        {renderSelect('wc-sec1', t('currenciesWizard.secondary1'), secondary1, setSecondary1, true)}
        {renderSelect('wc-sec2', t('currenciesWizard.secondary2'), secondary2, setSecondary2, true)}

        {error && <p className="text-sm text-amber-700">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? t('common.saving') : t('common.continue')}
        </button>
      </form>
    </div>
  );
};

export default WorkingCurrenciesWizard;
