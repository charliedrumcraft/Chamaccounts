/**
 * Lecture / écriture de AppState/working_currencies.json pour le profil actif.
 */

import * as fs from 'fs';
import * as path from 'path';
import { WORKING_CURRENCIES_PATH } from '../../shared/dataPaths';
import {
  DEFAULT_WORKING_CURRENCIES,
  isWorkingCurrencyConfigured,
  sanitizeWorkingCurrenciesInput,
  type WorkingCurrenciesConfig,
} from '../../shared/workingCurrencies';
import { tm } from '../uiI18n';

function fullPath(dataRoot: string): string {
  return path.join(dataRoot, WORKING_CURRENCIES_PATH);
}

function parseConfig(raw: string): WorkingCurrenciesConfig | null {
  try {
    const parsed = JSON.parse(raw) as WorkingCurrenciesConfig;
    if (parsed?.version !== 1 || typeof parsed.primary !== 'string') return null;
    if (!Array.isArray(parsed.secondaries)) return null;
    return {
      version: 1,
      primary: String(parsed.primary).trim().toUpperCase() || 'GBP',
      secondaries: parsed.secondaries
        .map((s) => String(s ?? '').trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 2),
      configuredAt:
        typeof parsed.configuredAt === 'string' && parsed.configuredAt.trim()
          ? parsed.configuredAt
          : undefined,
    };
  } catch {
    return null;
  }
}

export function readWorkingCurrencies(dataRoot: string): WorkingCurrenciesConfig | null {
  const p = fullPath(dataRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return parseConfig(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeWorkingCurrencies(dataRoot: string, config: WorkingCurrenciesConfig): void {
  const p = fullPath(dataRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const payload: WorkingCurrenciesConfig = {
    version: 1,
    primary: config.primary.trim().toUpperCase(),
    secondaries: (config.secondaries ?? []).map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 2),
    configuredAt: config.configuredAt,
  };
  fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf-8');
}

/**
 * Garantit un fichier de config. Profils existants sans fichier → défaut GBP/EUR/CHF
 * avec configuredAt (pas de wizard). Profil vide sans fichier → défaut sans configuredAt
 * (wizard requis).
 */
export async function ensureWorkingCurrencies(
  dataRoot: string,
  options: { transactionCount: number }
): Promise<WorkingCurrenciesConfig> {
  const existing = readWorkingCurrencies(dataRoot);
  if (existing) {
    if (!isWorkingCurrencyConfigured(existing) && options.transactionCount > 0) {
      const seeded: WorkingCurrenciesConfig = {
        ...existing,
        configuredAt: existing.configuredAt ?? new Date().toISOString(),
      };
      writeWorkingCurrencies(dataRoot, seeded);
      return seeded;
    }
    return existing;
  }

  if (options.transactionCount > 0) {
    const seeded: WorkingCurrenciesConfig = {
      ...DEFAULT_WORKING_CURRENCIES,
      configuredAt: new Date().toISOString(),
    };
    writeWorkingCurrencies(dataRoot, seeded);
    return seeded;
  }

  const unconfigured: WorkingCurrenciesConfig = {
    ...DEFAULT_WORKING_CURRENCIES,
  };
  writeWorkingCurrencies(dataRoot, unconfigured);
  return unconfigured;
}

export function saveWorkingCurrenciesFromInput(
  dataRoot: string,
  input: { primary: string; secondaries?: Array<string | '' | null | undefined> }
): { ok: true; config: WorkingCurrenciesConfig } | { ok: false; error: string } {
  const result = sanitizeWorkingCurrenciesInput(input);
  if ('error' in result) return { ok: false, error: tm(result.errorKey, result.errorVars) };
  writeWorkingCurrencies(dataRoot, result);
  return { ok: true, config: result };
}

export function getWorkingCurrenciesOrDefault(dataRoot: string): WorkingCurrenciesConfig {
  return readWorkingCurrencies(dataRoot) ?? { ...DEFAULT_WORKING_CURRENCIES };
}
