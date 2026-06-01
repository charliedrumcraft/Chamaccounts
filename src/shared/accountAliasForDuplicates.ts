/**
 * Résolution des alias de compte pour la détection de doublons (import / mapping wizard / merge).
 * Les alias Paramètres priment sur les alias d’import par défaut.
 */

export type AccountAliasEntry = {
  name: string;
  aliases?: readonly string[];
};

/** Alias d’import CSV (clé insensible à la casse) → nom canonique src_transaction_data. */
export const DEFAULT_ACCOUNT_ALIASES_FOR_DUPLICATES: Readonly<Record<string, string>> = {
  hsbc: 'HSBC OBS',
  advanz: 'Advanzia',
};

export function buildAccountAliasLookup(
  entries: readonly AccountAliasEntry[] = [],
  extra?: Readonly<Record<string, string>>
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const reserve = (alias: string, canonical: string) => {
    const a = alias.trim();
    const c = canonical.trim();
    if (!a || !c) return;
    const lo = a.toLowerCase();
    if (!map.has(lo)) map.set(lo, c);
  };
  for (const entry of entries) {
    const canonical = entry.name.trim();
    if (!canonical) continue;
    reserve(canonical, canonical);
    for (const a of entry.aliases ?? []) reserve(a, canonical);
  }
  const merged = { ...DEFAULT_ACCOUNT_ALIASES_FOR_DUPLICATES, ...extra };
  for (const [alias, canonical] of Object.entries(merged)) {
    reserve(alias, canonical);
  }
  return map;
}

/** Libellé compte normalisé pour signature doublon (alias → nom principal). */
export function resolveAccountForDuplicateSignature(
  account: string,
  lookup?: ReadonlyMap<string, string>
): string {
  const trimmed = (account ?? '').trim();
  if (!trimmed || !lookup?.size) return trimmed;
  return lookup.get(trimmed.toLowerCase()) ?? trimmed;
}
