/**
 * Listes reconnues du profil (AppState/recognised_data.json) :
 * comptes, types d’entrées, types de sorties.
 */

export type RecognisedAccountFiat = 'GBP' | 'CHF' | 'EUR' | string;

export type RecognisedAccountEntry = {
  name: string;
  currency: RecognisedAccountFiat;
  aliases?: string[];
};

export type RecognisedDataFile = {
  version: 1;
  accounts: RecognisedAccountEntry[];
  entryTypes: string[];
  outputTypes: string[];
};

export const RECOGNISED_ACCOUNTS_LS_KEY = 'settings-recognised-accounts';
export const RECOGNISED_ENTRY_TYPES_LS_KEY = 'settings-recognised-entry-types';
export const RECOGNISED_OUTPUT_TYPES_LS_KEY = 'settings-recognised-output-types';

function normalizeFiat(c: unknown, name: string): RecognisedAccountFiat {
  if (c === 'GBP' || c === 'CHF' || c === 'EUR') return c;
  const n = name.toUpperCase();
  if (n.includes('EUR')) return 'EUR';
  if (n.includes('CHF')) return 'CHF';
  if (n.includes('GBP') || n.includes('£')) return 'GBP';
  return 'GBP';
}

export function normalizeRecognisedAccountEntry(raw: unknown): RecognisedAccountEntry | null {
  if (typeof raw === 'string') {
    const name = raw.trim();
    if (!name) return null;
    return { name, currency: normalizeFiat(undefined, name) };
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) return null;
  const rawAliases = Array.isArray(o.aliases) ? o.aliases : [];
  const aliases = [
    ...new Set(rawAliases.map((a) => String(a ?? '').trim()).filter(Boolean)),
  ].filter((a) => a !== name);
  const base: RecognisedAccountEntry = {
    name,
    currency: normalizeFiat(o.currency, name),
  };
  if (aliases.length > 0) base.aliases = aliases;
  return base;
}

export function parseRecognisedStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const t = String(v ?? '').trim();
    if (!t) continue;
    const lo = t.toLowerCase();
    if (seen.has(lo)) continue;
    seen.add(lo);
    out.push(t);
  }
  return out;
}

export function parseRecognisedAccounts(raw: unknown): RecognisedAccountEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: RecognisedAccountEntry[] = [];
  for (const item of raw) {
    const e = normalizeRecognisedAccountEntry(item);
    if (!e) continue;
    const lo = e.name.toLowerCase();
    if (seen.has(lo)) continue;
    seen.add(lo);
    out.push(e);
  }
  return out;
}

export function emptyRecognisedData(): RecognisedDataFile {
  return { version: 1, accounts: [], entryTypes: [], outputTypes: [] };
}

export function parseRecognisedDataFile(raw: unknown): RecognisedDataFile {
  if (typeof raw !== 'object' || raw === null) return emptyRecognisedData();
  const o = raw as Record<string, unknown>;
  return {
    version: 1,
    accounts: parseRecognisedAccounts(o.accounts),
    entryTypes: parseRecognisedStringList(o.entryTypes),
    outputTypes: parseRecognisedStringList(o.outputTypes),
  };
}

export function parseRecognisedDataFilePayload(text: string): RecognisedDataFile {
  try {
    return parseRecognisedDataFile(JSON.parse(text) as unknown);
  } catch {
    return emptyRecognisedData();
  }
}

export function serializeRecognisedDataFile(data: RecognisedDataFile): string {
  const payload: RecognisedDataFile = {
    version: 1,
    accounts: parseRecognisedAccounts(data.accounts),
    entryTypes: parseRecognisedStringList(data.entryTypes),
    outputTypes: parseRecognisedStringList(data.outputTypes),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** true si aucune liste n’a d’éléments. */
export function isRecognisedDataEmpty(data: RecognisedDataFile): boolean {
  return (
    data.accounts.length === 0 &&
    data.entryTypes.length === 0 &&
    data.outputTypes.length === 0
  );
}

/**
 * Fusion : pour chaque liste, si `primary` est vide et `fallback` non vide → fallback.
 * Sinon primary gagne.
 */
export function mergeRecognisedData(
  primary: RecognisedDataFile,
  fallback: RecognisedDataFile
): RecognisedDataFile {
  return {
    version: 1,
    accounts:
      primary.accounts.length > 0 ? primary.accounts : fallback.accounts,
    entryTypes:
      primary.entryTypes.length > 0 ? primary.entryTypes : fallback.entryTypes,
    outputTypes:
      primary.outputTypes.length > 0 ? primary.outputTypes : fallback.outputTypes,
  };
}
