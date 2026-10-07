import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FRANKFURTER_CURRENCY_CODES,
  amountIndicatorHeader,
  currencyDisplaySymbol,
  workingCurrencyCodes,
  type WorkingCurrenciesConfig,
} from '@/shared/workingCurrencies';
import { ExchangeRateService, type ExchangeRateResult } from '../../services/ExchangeRateService';
import {
  getCachedWorkingCurrencies,
  getPrimaryMappingRates,
  rateStorageKeys,
  setCachedWorkingCurrencies,
} from '../../services/EffectiveExchangeRates';
import {
  loadUsedCurrenciesInData,
  loadWorkingCurrencies,
  saveWorkingCurrencies,
} from '../../services/workingCurrenciesService';
import { SourceDataCSVService } from '../../services/SourceDataCSVService';

function loadString(key: string, fallback: string): string {
  try {
    const v = localStorage.getItem(key);
    return v !== null ? v : fallback;
  } catch {
    return fallback;
  }
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === 'true' ? true : v === 'false' ? false : fallback;
  } catch {
    return fallback;
  }
}

function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function saveBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

function formatFetchedAt(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === 'en' ? 'en-GB' : 'fr-FR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

type RateRowState = {
  from: string;
  manual: string;
  useLive: boolean;
  live: ExchangeRateResult | null;
  loading: boolean;
  error: string | null;
};

const WorkingCurrenciesSettingsSection: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [config, setConfig] = useState<WorkingCurrenciesConfig>(() => getCachedWorkingCurrencies());
  const [usedCurrencies, setUsedCurrencies] = useState<string[]>([]);
  const [primaryDraft, setPrimaryDraft] = useState(config.primary);
  const [sec1, setSec1] = useState(config.secondaries[0] ?? '');
  const [sec2, setSec2] = useState(config.secondaries[1] ?? '');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rateRows, setRateRows] = useState<RateRowState[]>([]);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const usedSet = useMemo(() => new Set(usedCurrencies.map((c) => c.toUpperCase())), [usedCurrencies]);

  const lockedCodes = useMemo(() => {
    return workingCurrencyCodes(config).filter((c) => usedSet.has(c));
  }, [config, usedSet]);

  const fullyLocked = lockedCodes.length >= 3;

  const reload = useCallback(async () => {
    const s = await loadWorkingCurrencies();
    setConfig(s.config);
    setPrimaryDraft(s.config.primary);
    setSec1(s.config.secondaries[0] ?? '');
    setSec2(s.config.secondaries[1] ?? '');
    setUsedCurrencies(await loadUsedCurrenciesInData());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const primary = config.primary.toUpperCase();
    const rows: RateRowState[] = (config.secondaries ?? []).map((from) => {
      const keys = rateStorageKeys(from, primary);
      const legacyManual =
        primary === 'GBP' && from.toUpperCase() === 'EUR'
          ? loadString('settings-eurgbp-manual', '0.86')
          : primary === 'GBP' && from.toUpperCase() === 'CHF'
            ? loadString('settings-chfgbp-manual', '0.95')
            : '1';
      return {
        from: from.toUpperCase(),
        manual: loadString(keys.manual, legacyManual),
        useLive: loadBool(keys.useLive, false),
        live: null,
        loading: false,
        error: null,
      };
    });
    setRateRows(rows);
  }, [config]);

  const fetchLive = useCallback(async (from: string) => {
    const primary = config.primary.toUpperCase();
    const keys = rateStorageKeys(from, primary);
    setRateRows((prev) =>
      prev.map((r) => (r.from === from ? { ...r, loading: true, error: null } : r))
    );
    try {
      const result = await ExchangeRateService.getRate(from, primary);
      saveString(keys.liveRate, String(result.rate));
      setRateRows((prev) =>
        prev.map((r) => (r.from === from ? { ...r, live: result, loading: false } : r))
      );
    } catch (err) {
      setRateRows((prev) =>
        prev.map((r) =>
          r.from === from
            ? {
                ...r,
                loading: false,
                error: err instanceof Error ? err.message : t('common.networkError'),
              }
            : r
        )
      );
    }
  }, [config.primary, t]);

  useEffect(() => {
    for (const row of rateRows) {
      if (row.useLive && !row.live && !row.loading && !row.error) {
        void fetchLive(row.from);
      }
    }
  }, [rateRows, fetchLive]);

  const handleSaveCurrencies = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      for (const locked of lockedCodes) {
        const next = [primaryDraft, sec1, sec2].map((c) => c.toUpperCase()).filter(Boolean);
        if (!next.includes(locked)) {
          setSaveMsg(t('settings.currencies.cannotRemove', { code: locked }));
          return;
        }
      }
      if (fullyLocked) {
        setSaveMsg(t('settings.currencies.allLocked'));
        return;
      }
      if (usedSet.has(config.primary.toUpperCase()) && primaryDraft.toUpperCase() !== config.primary.toUpperCase()) {
        setSaveMsg(t('settings.currencies.primaryLocked'));
        return;
      }
      const r = await saveWorkingCurrencies({
        primary: primaryDraft,
        secondaries: [sec1, sec2],
      });
      if (!r.ok) {
        setSaveMsg(r.error);
        return;
      }
      setCachedWorkingCurrencies(r.state.config);
      setConfig(r.state.config);
      setSaveMsg(t('settings.currencies.saved'));
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshLoading(true);
    setRefreshMsg(null);
    try {
      for (const row of rateRows) {
        const keys = rateStorageKeys(row.from, config.primary);
        saveString(keys.manual, row.manual);
        saveBool(keys.useLive, row.useLive);
      }
      const rates = getPrimaryMappingRates(config);
      const result = await SourceDataCSVService.refreshPrimaryRates(rates);
      if (result.success) {
        setRefreshMsg(
          t('settings.currencies.refreshResult', {
            rowCount: result.rowCount,
            updatedCount: result.updatedCount,
            amountHeader: amountIndicatorHeader(config.primary),
          })
        );
      } else {
        setRefreshMsg(result.error ?? t('common.error'));
      }
    } catch (e) {
      setRefreshMsg(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setRefreshLoading(false);
    }
  };

  const options = FRANKFURTER_CURRENCY_CODES;
  const amountHeader = amountIndicatorHeader(config.primary);
  const lockedSuffix = lockedCodes.length
    ? t('settings.currencies.lockedList', { codes: lockedCodes.join(', ') })
    : '';

  return (
    <div className="flex flex-col lg:flex-row lg:items-start lg:gap-6">
      <div className="flex-1 min-w-0 max-w-2xl space-y-6">
        <div className="bg-white rounded-lg shadow p-4 space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">{t('settings.currencies.title')}</h2>
          <p className="text-sm text-gray-600">
            {t('settings.currencies.description', {
              amountHeader,
              locked: lockedSuffix,
            })}
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="font-medium text-gray-700">{t('settings.currencies.primary')}</span>
              <select
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
                value={primaryDraft}
                disabled={fullyLocked || usedSet.has(config.primary.toUpperCase())}
                onChange={(e) => setPrimaryDraft(e.target.value)}
              >
                {options.map((c) => (
                  <option key={c} value={c}>
                    {c} ({currencyDisplaySymbol(c)})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium text-gray-700">{t('settings.currencies.secondary1')}</span>
              <select
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
                value={sec1}
                disabled={fullyLocked || (Boolean(sec1) && usedSet.has(sec1.toUpperCase()))}
                onChange={(e) => setSec1(e.target.value)}
              >
                <option value="">{t('common.none')}</option>
                {options.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium text-gray-700">{t('settings.currencies.secondary2')}</span>
              <select
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5"
                value={sec2}
                disabled={fullyLocked || (Boolean(sec2) && usedSet.has(sec2.toUpperCase()))}
                onChange={(e) => setSec2(e.target.value)}
              >
                <option value="">{t('common.none')}</option>
                {options.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={saving || fullyLocked}
            onClick={() => void handleSaveCurrencies()}
            className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? t('common.saving') : t('settings.currencies.save')}
          </button>
          {saveMsg && <p className="text-sm text-gray-700">{saveMsg}</p>}
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">{t('settings.currencies.ratesTitle')}</h2>
          {rateRows.length === 0 ? (
            <p className="text-sm text-gray-500">{t('settings.currencies.noRates')}</p>
          ) : (
            rateRows.map((row, idx) => (
              <div
                key={row.from}
                className={`flex flex-wrap items-center gap-3 ${idx < rateRows.length - 1 ? 'mb-4 pb-4 border-b border-gray-200' : ''}`}
              >
                <label className="font-medium text-gray-700 w-28">
                  {row.from}
                  {config.primary}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.manual}
                  disabled={row.useLive}
                  onChange={(e) => {
                    const v = e.target.value;
                    const keys = rateStorageKeys(row.from, config.primary);
                    saveString(keys.manual, v);
                    setRateRows((prev) =>
                      prev.map((r) => (r.from === row.from ? { ...r, manual: v } : r))
                    );
                  }}
                  className="border border-gray-300 rounded px-3 py-1.5 w-32 text-gray-800"
                />
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={row.useLive}
                    onChange={(e) => {
                      const on = e.target.checked;
                      const keys = rateStorageKeys(row.from, config.primary);
                      saveBool(keys.useLive, on);
                      setRateRows((prev) =>
                        prev.map((r) =>
                          r.from === row.from ? { ...r, useLive: on, live: null, error: null } : r
                        )
                      );
                    }}
                    className="rounded border-gray-400"
                  />
                  <span>{t('settings.currencies.useLiveRate')}</span>
                </label>
                {row.useLive && (
                  <div className="w-full text-sm">
                    {row.loading ? (
                      <span className="text-gray-500">{t('common.loading')}</span>
                    ) : row.error ? (
                      <span className="text-amber-600">{row.error}</span>
                    ) : row.live ? (
                      <span className="text-gray-700">
                        {t('settings.currencies.liveRate', {
                          rate: row.live.rate.toFixed(4),
                          fetchedAt: formatFetchedAt(row.live.fetchedAt, i18n.language),
                        })}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="w-full lg:max-w-md lg:shrink-0 bg-white rounded-lg shadow p-4 border border-gray-100 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 mb-2">{t('settings.currencies.refreshTitle')}</h2>
          <p className="text-sm text-gray-600 mb-4">
            {t('settings.currencies.refreshDescription', { amountHeader })}
          </p>
          <button
            type="button"
            onClick={() => void handleRefresh()}
            disabled={refreshLoading}
            className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {refreshLoading ? t('settings.currencies.refreshing') : t('settings.currencies.refresh')}
          </button>
          {refreshMsg && <p className="mt-4 text-sm text-gray-700">{refreshMsg}</p>}
        </div>
      </div>
    </div>
  );
};

export default WorkingCurrenciesSettingsSection;
