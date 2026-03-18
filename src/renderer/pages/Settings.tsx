import React, { useState, useCallback } from 'react';
import Sidebar from '../components/Layout/Sidebar';
import { ExchangeRateService, type ExchangeRateResult } from '../services/ExchangeRateService';
import { SourceDataCSVService, SOURCE_DATA_PATH } from '../services/SourceDataCSVService';
import { amountToGbp } from '../services/EffectiveExchangeRates';
import { formatAmountGbpForCsv } from '../utils/format';
import Papa from 'papaparse';

const STORAGE_KEYS = {
  eurGbpManual: 'settings-eurgbp-manual',
  chfGbpManual: 'settings-chfgbp-manual',
  eurGbpUseLive: 'settings-eurgbp-use-live',
  chfGbpUseLive: 'settings-chfgbp-use-live',
  eurGbpLiveRate: 'settings-eurgbp-live-rate',
  chfGbpLiveRate: 'settings-chfgbp-live-rate',
  recognisedAccounts: 'settings-recognised-accounts',
  recognisedEntryTypes: 'settings-recognised-entry-types',
  recognisedOutputTypes: 'settings-recognised-output-types',
} as const;

const KNOWN_ACCOUNTS: string[] = [
  'LM',
  'Revolut',
  'N26FR',
  'N26DE',
  'HSBC A/C',
  'HSBC OBS',
  'Advanzia',
  'Cash',
];

const KNOWN_ENTRY_TYPES: string[] = [
  'Lampton',
  'LMB',
  'LTL',
  'MPC',
  'LGV',
  'Other Inc',
  'Support',
  'Refund',
  'Benefit',
  'SLCcredit',
];

const KNOWN_OUTPUT_TYPES: string[] = [
  'Rent',
  'Council',
  'Comm',
  'Electricity',
  'Water',
  'Service',
  'SLCdebit',
  'Transport',
  'Fuel',
  'Car',
  'Food',
  'Restaurant',
  'Shopping',
  'Leisure',
  'Holiday',
  'LST',
  'School',
  'Misc',
  'Health',
  'Donation',
];

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
  } catch {}
}

function saveBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

function loadStringArray(key: string, fallback: string[] = []): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : fallback;
  } catch {
    return fallback;
  }
}

function saveStringArray(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function formatFetchedAt(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

const Settings: React.FC = () => {
  const [eurGbpManual, setEurGbpManual] = useState(() =>
    loadString(STORAGE_KEYS.eurGbpManual, '0.86')
  );
  const [chfGbpManual, setChfGbpManual] = useState(() =>
    loadString(STORAGE_KEYS.chfGbpManual, '0.95')
  );
  const [eurGbpUseLive, setEurGbpUseLive] = useState(() =>
    loadBool(STORAGE_KEYS.eurGbpUseLive, false)
  );
  const [chfGbpUseLive, setChfGbpUseLive] = useState(() =>
    loadBool(STORAGE_KEYS.chfGbpUseLive, false)
  );
  const [eurGbpLive, setEurGbpLive] = useState<ExchangeRateResult | null>(null);
  const [chfGbpLive, setChfGbpLive] = useState<ExchangeRateResult | null>(null);
  const [eurGbpLoading, setEurGbpLoading] = useState(false);
  const [chfGbpLoading, setChfGbpLoading] = useState(false);
  const [eurGbpError, setEurGbpError] = useState<string | null>(null);
  const [chfGbpError, setChfGbpError] = useState<string | null>(null);
  const [refreshCsvLoading, setRefreshCsvLoading] = useState(false);
  const [refreshCsvMessage, setRefreshCsvMessage] = useState<string | null>(null);

  const [recognisedAccounts, setRecognisedAccounts] = useState<string[]>(() =>
    loadStringArray(STORAGE_KEYS.recognisedAccounts, KNOWN_ACCOUNTS)
  );
  const [recognisedEntryTypes, setRecognisedEntryTypes] = useState<string[]>(() =>
    loadStringArray(STORAGE_KEYS.recognisedEntryTypes, KNOWN_ENTRY_TYPES)
  );
  const [recognisedOutputTypes, setRecognisedOutputTypes] = useState<string[]>(() =>
    loadStringArray(STORAGE_KEYS.recognisedOutputTypes, KNOWN_OUTPUT_TYPES)
  );

  const [newAccountValue, setNewAccountValue] = useState('');
  const [newEntryTypeValue, setNewEntryTypeValue] = useState('');
  const [newOutputTypeValue, setNewOutputTypeValue] = useState('');

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('dashboard-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleSidebar = () => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('dashboard-sidebar-collapsed', String(next));
      } catch {}
      return next;
    });
  };

  /** Recalcule AMOUNT GBP pour toutes les lignes en EUR/CHF avec les taux actuels et sauvegarde le CSV. */
  const handleRefreshSourceDataRates = useCallback(async () => {
    setRefreshCsvMessage(null);
    setRefreshCsvLoading(true);
    try {
      saveString(STORAGE_KEYS.eurGbpManual, eurGbpManual);
      saveString(STORAGE_KEYS.chfGbpManual, chfGbpManual);
      const data = await SourceDataCSVService.load();
      if (!data?.headers?.length || !data?.rows?.length) {
        setRefreshCsvMessage('Fichier source_data.csv absent ou vide.');
        return;
      }
      const amountHeader = data.headers.find((h) => /^amount$/i.test(h)) ?? null;
      const currencyHeader = data.headers.find((h) => /^currency$/i.test(h)) ?? null;
      const amountGbpHeader = data.headers.find((h) => /^amount\s*gbp$/i.test(h)) ?? null;
      if (!amountHeader || !currencyHeader || !amountGbpHeader) {
        setRefreshCsvMessage('Colonnes AMOUNT / CURRENCY / AMOUNT GBP introuvables.');
        return;
      }
      let updated = 0;
      const rows = data.rows.map((row) => {
        const next = { ...row };
        const amountStr = (next[amountHeader] ?? '').trim().replace(',', '.');
        const amount = parseFloat(amountStr);
        const currency = (next[currencyHeader] ?? '').trim().toUpperCase();
        if (!Number.isNaN(amount) && amount !== 0 && (currency === 'EUR' || currency === 'CHF')) {
          const gbp = amountToGbp(amount, currency);
          if (gbp !== null) {
            next[amountGbpHeader] = formatAmountGbpForCsv(gbp);
            updated++;
          }
        }
        return next;
      });
      const api = (window as unknown as { electronAPI?: { writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }> } }).electronAPI;
      if (!api?.writeFile) {
        setRefreshCsvMessage('Écriture fichier non disponible.');
        return;
      }
      const csvContent = Papa.unparse(rows, { columns: data.headers, delimiter: ';' });
      const result = await api.writeFile(SOURCE_DATA_PATH, csvContent);
      if (result.success) {
        setRefreshCsvMessage(`${updated} montant(s) GBP recalculé(s). Rechargez le tableau des transactions pour voir les changements.`);
      } else {
        setRefreshCsvMessage(result.error ?? 'Erreur lors de l\'enregistrement.');
      }
    } catch (e) {
      setRefreshCsvMessage(e instanceof Error ? e.message : 'Erreur lors du recalcul.');
    } finally {
      setRefreshCsvLoading(false);
    }
  }, [eurGbpManual, chfGbpManual]);

  const fetchEurGbp = useCallback(async () => {
    setEurGbpLoading(true);
    setEurGbpError(null);
    try {
      const result = await ExchangeRateService.getEurGbp();
      setEurGbpLive(result);
      saveString(STORAGE_KEYS.eurGbpLiveRate, String(result.rate));
    } catch (err) {
      setEurGbpError(err instanceof Error ? err.message : 'Erreur réseau');
    } finally {
      setEurGbpLoading(false);
    }
  }, []);

  const fetchChfGbp = useCallback(async () => {
    setChfGbpLoading(true);
    setChfGbpError(null);
    try {
      const result = await ExchangeRateService.getChfGbp();
      setChfGbpLive(result);
      saveString(STORAGE_KEYS.chfGbpLiveRate, String(result.rate));
    } catch (err) {
      setChfGbpError(err instanceof Error ? err.message : 'Erreur réseau');
    } finally {
      setChfGbpLoading(false);
    }
  }, []);

  const handleEurGbpManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setEurGbpManual(v);
    saveString(STORAGE_KEYS.eurGbpManual, v);
  };

  const handleChfGbpManualChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setChfGbpManual(v);
    saveString(STORAGE_KEYS.chfGbpManual, v);
  };

  const handleEurGbpUseLiveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setEurGbpUseLive(checked);
    saveBool(STORAGE_KEYS.eurGbpUseLive, checked);
    if (checked) fetchEurGbp();
    else {
      setEurGbpLive(null);
      try {
        localStorage.removeItem(STORAGE_KEYS.eurGbpLiveRate);
      } catch {}
    }
  };

  const handleChfGbpUseLiveChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setChfGbpUseLive(checked);
    saveBool(STORAGE_KEYS.chfGbpUseLive, checked);
    if (checked) fetchChfGbp();
    else {
      setChfGbpLive(null);
      try {
        localStorage.removeItem(STORAGE_KEYS.chfGbpLiveRate);
      } catch {}
    }
  };

  const handleAddToList = (
    list: 'accounts' | 'entryTypes' | 'outputTypes'
  ) => {
    const value =
      list === 'accounts'
        ? newAccountValue.trim()
        : list === 'entryTypes'
        ? newEntryTypeValue.trim()
        : newOutputTypeValue.trim();
    if (!value) return;

    if (list === 'accounts') {
      const next = Array.from(new Set([...recognisedAccounts, value]));
      setRecognisedAccounts(next);
      saveStringArray(STORAGE_KEYS.recognisedAccounts, next);
      setNewAccountValue('');
    } else if (list === 'entryTypes') {
      const next = Array.from(new Set([...recognisedEntryTypes, value]));
      setRecognisedEntryTypes(next);
      saveStringArray(STORAGE_KEYS.recognisedEntryTypes, next);
      setNewEntryTypeValue('');
    } else {
      const next = Array.from(new Set([...recognisedOutputTypes, value]));
      setRecognisedOutputTypes(next);
      saveStringArray(STORAGE_KEYS.recognisedOutputTypes, next);
      setNewOutputTypeValue('');
    }
  };

  const handleRemoveFromList = (
    list: 'accounts' | 'entryTypes' | 'outputTypes',
    index: number
  ) => {
    if (list === 'accounts') {
      const next = recognisedAccounts.filter((_, i) => i !== index);
      setRecognisedAccounts(next);
      saveStringArray(STORAGE_KEYS.recognisedAccounts, next);
    } else if (list === 'entryTypes') {
      const next = recognisedEntryTypes.filter((_, i) => i !== index);
      setRecognisedEntryTypes(next);
      saveStringArray(STORAGE_KEYS.recognisedEntryTypes, next);
    } else {
      const next = recognisedOutputTypes.filter((_, i) => i !== index);
      setRecognisedOutputTypes(next);
      saveStringArray(STORAGE_KEYS.recognisedOutputTypes, next);
    }
  };

  const handleEditListItem = (
    list: 'accounts' | 'entryTypes' | 'outputTypes',
    index: number,
    value: string
  ) => {
    const trimmed = value.trimStart();
    if (list === 'accounts') {
      const next = [...recognisedAccounts];
      next[index] = trimmed;
      setRecognisedAccounts(next);
      saveStringArray(STORAGE_KEYS.recognisedAccounts, next);
    } else if (list === 'entryTypes') {
      const next = [...recognisedEntryTypes];
      next[index] = trimmed;
      setRecognisedEntryTypes(next);
      saveStringArray(STORAGE_KEYS.recognisedEntryTypes, next);
    } else {
      const next = [...recognisedOutputTypes];
      next[index] = trimmed;
      setRecognisedOutputTypes(next);
      saveStringArray(STORAGE_KEYS.recognisedOutputTypes, next);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={handleToggleSidebar}
      />
      <main className="flex-1 flex flex-col min-w-0 p-4">
        <h1 className="text-2xl font-bold text-gray-800">Réglages</h1>

        <div className="mt-6 flex flex-col lg:flex-row lg:items-start lg:gap-6">
          <div className="flex-1 max-w-2xl space-y-6">
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Taux de change</h2>

              {/* EUR / GBP */}
              <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-gray-200">
                <label className="font-medium text-gray-700 w-20">EURGBP</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 0.8714"
                  value={eurGbpManual}
                  onChange={handleEurGbpManualChange}
                  className="border border-gray-300 rounded px-3 py-1.5 w-32 text-gray-800"
                  disabled={eurGbpUseLive}
                />
                <span className="text-gray-500">=</span>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={eurGbpUseLive}
                    onChange={handleEurGbpUseLiveChange}
                    className="rounded border-gray-400"
                  />
                  <span>Utiliser le taux en ligne</span>
                </label>
                {eurGbpUseLive && (
                  <div className="w-full mt-2 ml-0 pl-0 text-sm">
                    {eurGbpLoading ? (
                      <span className="text-gray-500">Chargement…</span>
                    ) : eurGbpError ? (
                      <span className="text-amber-600">{eurGbpError}</span>
                    ) : eurGbpLive ? (
                      <span className="text-gray-700">
                        Taux réel : <strong>{eurGbpLive.rate.toFixed(4)}</strong>
                        {' — '}
                        Requête : {formatFetchedAt(eurGbpLive.fetchedAt)}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>

              {/* CHF / GBP */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="font-medium text-gray-700 w-20">CHFGBP</label>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="ex: 0.89"
                  value={chfGbpManual}
                  onChange={handleChfGbpManualChange}
                  className="border border-gray-300 rounded px-3 py-1.5 w-32 text-gray-800"
                  disabled={chfGbpUseLive}
                />
                <span className="text-gray-500">=</span>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chfGbpUseLive}
                    onChange={handleChfGbpUseLiveChange}
                    className="rounded border-gray-400"
                  />
                  <span>Utiliser le taux en ligne</span>
                </label>
                {chfGbpUseLive && (
                  <div className="w-full mt-2 ml-0 pl-0 text-sm">
                    {chfGbpLoading ? (
                      <span className="text-gray-500">Chargement…</span>
                    ) : chfGbpError ? (
                      <span className="text-amber-600">{chfGbpError}</span>
                    ) : chfGbpLive ? (
                      <span className="text-gray-700">
                        Taux réel : <strong>{chfGbpLive.rate.toFixed(4)}</strong>
                        {' — '}
                        Requête : {formatFetchedAt(chfGbpLive.fetchedAt)}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-lg shadow p-4 lg:ml-0 lg:flex-1 lg:max-w-2xl lg:mt-0 mt-6">
              <h2 className="text-lg font-semibold text-gray-800 mb-4">Données reconnues</h2>

              <div className="space-y-4">
                <section>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Liste des comptes actifs</h3>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Ajouter un compte…"
                      value={newAccountValue}
                      onChange={(e) => setNewAccountValue(e.target.value)}
                      className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddToList('accounts')}
                      className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                      disabled={!newAccountValue.trim()}
                    >
                      Ajouter
                    </button>
                  </div>
                  {recognisedAccounts.length === 0 ? (
                    <p className="text-xs text-gray-500">Aucun compte défini pour le moment.</p>
                  ) : (
                    <ul className="space-y-1">
                      {recognisedAccounts.map((value, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={value}
                            onChange={(e) =>
                              handleEditListItem('accounts', index, e.target.value)
                            }
                            className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs text-gray-800"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveFromList('accounts', index)}
                            className="px-2 py-1 rounded border border-red-500 text-red-600 text-xs hover:bg-red-50"
                          >
                            Supprimer
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Liste des types d&apos;entrées</h3>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Ajouter un type d'entrée…"
                      value={newEntryTypeValue}
                      onChange={(e) => setNewEntryTypeValue(e.target.value)}
                      className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddToList('entryTypes')}
                      className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                      disabled={!newEntryTypeValue.trim()}
                    >
                      Ajouter
                    </button>
                  </div>
                  {recognisedEntryTypes.length === 0 ? (
                    <p className="text-xs text-gray-500">Aucun type d&apos;entrée défini pour le moment.</p>
                  ) : (
                    <ul className="space-y-1">
                      {recognisedEntryTypes.map((value, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={value}
                            onChange={(e) =>
                              handleEditListItem('entryTypes', index, e.target.value)
                            }
                            className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs text-gray-800"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveFromList('entryTypes', index)}
                            className="px-2 py-1 rounded border border-red-500 text-red-600 text-xs hover:bg-red-50"
                          >
                            Supprimer
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-gray-700 mb-2">Liste des types de sorties</h3>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="Ajouter un type de sortie…"
                      value={newOutputTypeValue}
                      onChange={(e) => setNewOutputTypeValue(e.target.value)}
                      className="flex-1 border border-gray-300 rounded px-3 py-1.5 text-sm text-gray-800"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddToList('outputTypes')}
                      className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                      disabled={!newOutputTypeValue.trim()}
                    >
                      Ajouter
                    </button>
                  </div>
                  {recognisedOutputTypes.length === 0 ? (
                    <p className="text-xs text-gray-500">Aucun type de sortie défini pour le moment.</p>
                  ) : (
                    <ul className="space-y-1">
                      {recognisedOutputTypes.map((value, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={value}
                            onChange={(e) =>
                              handleEditListItem('outputTypes', index, e.target.value)
                            }
                            className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs text-gray-800"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveFromList('outputTypes', index)}
                            className="px-2 py-1 rounded border border-red-500 text-red-600 text-xs hover:bg-red-50"
                          >
                            Supprimer
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4 mt-6 lg:mt-0 lg:w-full lg:max-w-md">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Rafraîchir le fichier source</h2>
            <p className="text-sm text-gray-600 mb-4">
              Recalcule source_data.csv avec les taux de change actuels et met à jour les données utilisées par la détection d&apos;anomalies (taux et listes de comptes/types). Rechargez le tableau des transactions pour voir les changements.
            </p>
            <button
              type="button"
              onClick={handleRefreshSourceDataRates}
              disabled={refreshCsvLoading}
              className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {refreshCsvLoading ? 'Rafraîchissement…' : 'Rafraîchir source_data.csv'}
            </button>

            {refreshCsvMessage && (
              <p
                className={`mt-4 text-sm ${
                  refreshCsvMessage.startsWith('Erreur') ||
                  refreshCsvMessage.includes('introuvable') ||
                  refreshCsvMessage.includes('absent')
                    ? 'text-amber-600'
                    : 'text-gray-700'
                }`}
              >
                {refreshCsvMessage}
              </p>
            )}
          </div>

        </div>
      </main>
    </div>
  );
};

export default Settings;
