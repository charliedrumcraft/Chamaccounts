/**
 * Liste par défaut et persistance localStorage des comptes actifs (Paramètres).
 * Format : { name, currency, aliases? } par ligne ; la devise fixe uniquement le format d’affichage / du CSV (pas de conversion).
 * Les alias sont des libellés alternatifs reconnus pour le même compte (détection d’anomalies, etc.), sans colonne CSV dédiée.
 */

import {
  defaultFiatForSettingsAccountName,
  type AccountFiatCurrency,
} from '../services/AccountBalanceCSVService';

export const RECOGNISED_ACCOUNTS_STORAGE_KEY = 'settings-recognised-accounts';

/** Liste vide par défaut : l’utilisateur configure ses comptes dans Paramètres. */
export const DEFAULT_RECOGNISED_ACCOUNTS: string[] = [];

export type RecognisedAccountEntry = {
  name: string;
  currency: AccountFiatCurrency;
  /** Libellés alternatifs reconnus pour ce compte (ex. « Advanz » pour « Advanzia »). */
  aliases?: string[];
};

function defaultEntries(): RecognisedAccountEntry[] {
  return DEFAULT_RECOGNISED_ACCOUNTS.map((name) => {
    const entry: RecognisedAccountEntry = {
      name,
      currency: defaultFiatForSettingsAccountName(name),
    };
    if (name === 'Advanzia') entry.aliases = ['Advanz'];
    return entry;
  });
}

function normalizeEntry(e: RecognisedAccountEntry): RecognisedAccountEntry {
  const name = String(e.name ?? '').trim();
  const c = e.currency;
  const currency: AccountFiatCurrency =
    c === 'GBP' || c === 'CHF' || c === 'EUR' ? c : defaultFiatForSettingsAccountName(name);
  const rawAliases = Array.isArray(e.aliases) ? e.aliases : [];
  const aliases = [
    ...new Set(
      rawAliases.map((a) => String(a ?? '').trim()).filter(Boolean)
    ),
  ].filter((a) => a !== name);
  const base: RecognisedAccountEntry = { name, currency };
  if (aliases.length > 0) base.aliases = aliases;
  return base;
}

/** Tous les libellés reconnus (nom principal + alias) pour contrôles métier (ex. colonne Account). */
export function collectRecognisedAccountLabelsSet(entries: RecognisedAccountEntry[]): Set<string> {
  const s = new Set<string>();
  for (const e of entries) {
    const n = e.name.trim();
    if (n) s.add(n);
    for (const a of e.aliases ?? []) {
      if (a) s.add(a);
    }
  }
  return s;
}

/**
 * Indique si `rawLabel` peut être utilisé comme alias du compte à `accountIndex`
 * (pas de conflit avec un autre compte ni doublon dans le même compte).
 */
export function isAccountAliasLabelAvailable(
  entries: RecognisedAccountEntry[],
  accountIndex: number,
  rawLabel: string,
  options?: { replaceAliasIndex?: number }
): boolean {
  const t = rawLabel.trim();
  if (!t) return false;
  const self = entries[accountIndex];
  if (!self) return false;
  const lo = t.toLowerCase();
  if (self.name.trim().toLowerCase() === lo) return false;
  const aliases = self.aliases ?? [];
  for (let j = 0; j < aliases.length; j++) {
    if (j === options?.replaceAliasIndex) continue;
    if (aliases[j].trim().toLowerCase() === lo) return false;
  }
  for (let i = 0; i < entries.length; i++) {
    if (i === accountIndex) continue;
    const e = entries[i];
    if (e.name.trim().toLowerCase() === lo) return false;
    if ((e.aliases ?? []).some((a) => a.trim().toLowerCase() === lo)) return false;
  }
  return true;
}

/** Nouveau nom de compte principal : interdit s’il existe déjà (nom ou alias, insensible à la casse). */
export function isRecognisedPrimaryNameTaken(
  entries: RecognisedAccountEntry[],
  rawName: string,
  options?: { replaceIndex?: number }
): boolean {
  const t = rawName.trim();
  if (!t) return true;
  const lo = t.toLowerCase();
  for (let i = 0; i < entries.length; i++) {
    if (i === options?.replaceIndex) continue;
    if (entries[i].name.trim().toLowerCase() === lo) return true;
    if ((entries[i].aliases ?? []).some((a) => a.trim().toLowerCase() === lo)) return true;
  }
  return false;
}

/** Remplace l’ancien libellé unique « Revolut » par les trois comptes devise. */
export function migrateRecognisedAccountsIfNeeded(accounts: string[]): string[] {
  const renamed = accounts.map((a) => (a === 'LM' ? 'CM' : a));
  const i = renamed.indexOf('Revolut');
  if (i === -1) return Array.from(new Set(renamed));
  const next = [...renamed];
  next.splice(i, 1, 'REV EUR', 'REV GBP', 'REV CHF');
  return Array.from(new Set(next));
}

function dedupeByName(entries: RecognisedAccountEntry[]): RecognisedAccountEntry[] {
  const seen = new Set<string>();
  const out: RecognisedAccountEntry[] = [];
  for (const e of entries) {
    const name = e.name.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(normalizeEntry(e));
  }
  return out;
}

/** Un alias ne peut être présent que sur un seul compte ; les noms principaux priment (casse unifiée pour l’unicité). */
function dedupeAliasesAcrossEntries(entries: RecognisedAccountEntry[]): RecognisedAccountEntry[] {
  const reservedLo = new Set<string>();
  for (const e of entries) {
    const n = e.name.trim();
    if (n) reservedLo.add(n.toLowerCase());
  }
  return entries.map((e) => {
    const list = e.aliases ?? [];
    const next: string[] = [];
    for (const a of list) {
      const t = a.trim();
      if (!t) continue;
      const lo = t.toLowerCase();
      if (reservedLo.has(lo)) continue;
      reservedLo.add(lo);
      next.push(t);
    }
    return normalizeEntry({ ...e, aliases: next });
  });
}

export function migrateRecognisedAccountEntriesIfNeeded(
  entries: RecognisedAccountEntry[]
): RecognisedAccountEntry[] {
  const lmRenamed = entries.map((e) =>
    e.name.trim() === 'LM'
      ? normalizeEntry({
          ...e,
          name: 'CM',
          currency: e.currency ?? defaultFiatForSettingsAccountName('CM'),
        })
      : normalizeEntry(e)
  );
  const deduped = dedupeByName(lmRenamed);
  const i = deduped.findIndex((e) => e.name === 'Revolut');
  if (i === -1) return dedupeAliasesAcrossEntries(deduped);
  const next = [...deduped];
  next.splice(
    i,
    1,
    { name: 'REV EUR', currency: defaultFiatForSettingsAccountName('REV EUR') },
    { name: 'REV GBP', currency: defaultFiatForSettingsAccountName('REV GBP') },
    { name: 'REV CHF', currency: defaultFiatForSettingsAccountName('REV CHF') }
  );
  return dedupeAliasesAcrossEntries(dedupeByName(next));
}

export function saveRecognisedAccountsToStorage(entries: RecognisedAccountEntry[]): void {
  try {
    localStorage.setItem(RECOGNISED_ACCOUNTS_STORAGE_KEY, JSON.stringify(entries));
  } catch {}
}

export function loadRecognisedAccountsFromStorage(): RecognisedAccountEntry[] {
  try {
    const raw = localStorage.getItem(RECOGNISED_ACCOUNTS_STORAGE_KEY);
    if (!raw) {
      return migrateRecognisedAccountEntriesIfNeeded(defaultEntries());
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return migrateRecognisedAccountEntriesIfNeeded(defaultEntries());
    }

    if (
      parsed.length > 0 &&
      typeof parsed[0] === 'object' &&
      parsed[0] !== null &&
      'name' in (parsed[0] as object)
    ) {
      const entries = (parsed as RecognisedAccountEntry[]).map(normalizeEntry);
      return migrateRecognisedAccountEntriesIfNeeded(entries);
    }

    const strings = parsed.filter((v): v is string => typeof v === 'string');
    const names = migrateRecognisedAccountsIfNeeded(strings);
    const migrated = migrateRecognisedAccountEntriesIfNeeded(
      names.map((name) => ({
        name,
        currency: defaultFiatForSettingsAccountName(name),
      }))
    );
    saveRecognisedAccountsToStorage(migrated);
    return migrated;
  } catch {
    return migrateRecognisedAccountEntriesIfNeeded(defaultEntries());
  }
}

