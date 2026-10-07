/**
 * Accès renderer aux devises de travail du profil.
 */

import type { WorkingCurrenciesConfig } from '@/shared/workingCurrencies';
import { DEFAULT_WORKING_CURRENCIES, workingCurrencyCodes } from '@/shared/workingCurrencies';
import { setCachedWorkingCurrencies } from './EffectiveExchangeRates';
import i18n from '../i18n';

export type WorkingCurrenciesState = {
  config: WorkingCurrenciesConfig;
  configured: boolean;
  codes: string[];
  transactionCount: number;
};

export async function loadWorkingCurrencies(): Promise<WorkingCurrenciesState> {
  const api = window.electronAPI;
  if (!api?.workingCurrenciesGet) {
    const config = { ...DEFAULT_WORKING_CURRENCIES, configuredAt: new Date().toISOString() };
    setCachedWorkingCurrencies(config);
    return { config, configured: true, codes: workingCurrencyCodes(config), transactionCount: 0 };
  }
  const r = await api.workingCurrenciesGet();
  if (!r.success || !r.data) {
    const config = { ...DEFAULT_WORKING_CURRENCIES };
    setCachedWorkingCurrencies(config);
    return { config, configured: false, codes: workingCurrencyCodes(config), transactionCount: 0 };
  }
  setCachedWorkingCurrencies(r.data.config);
  return r.data;
}

export async function saveWorkingCurrencies(input: {
  primary: string;
  secondaries?: Array<string | '' | null | undefined>;
}): Promise<{ ok: true; state: WorkingCurrenciesState } | { ok: false; error: string }> {
  const api = window.electronAPI;
  if (!api?.workingCurrenciesSave) {
    return { ok: false, error: i18n.t('system.apiUnavailableShort') };
  }
  const r = await api.workingCurrenciesSave(input);
  if (!r.success || !r.data) {
    return { ok: false, error: r.error ?? i18n.t('system.saveFailed') };
  }
  setCachedWorkingCurrencies(r.data.config);
  return {
    ok: true,
    state: {
      config: r.data.config,
      configured: r.data.configured,
      codes: r.data.codes,
      transactionCount: 0,
    },
  };
}

export async function loadUsedCurrenciesInData(): Promise<string[]> {
  const api = window.electronAPI;
  if (!api?.workingCurrenciesUsedInData) return [];
  const r = await api.workingCurrenciesUsedInData();
  return r.success && Array.isArray(r.data) ? r.data : [];
}
