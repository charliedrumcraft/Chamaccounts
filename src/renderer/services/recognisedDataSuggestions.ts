/**
 * Suggestions d’ajout aux listes reconnues à partir des valeurs présentes
 * dans les transactions (types / comptes pas encore dans Paramètres).
 */

import type { RecognisedAccountEntry } from '../constants/recognisedAccountsStorage';
import { collectRecognisedAccountLabelsSet } from '../constants/recognisedAccountsStorage';

export type TransactionSuggestSnapshot = {
  types: string[];
  accounts: string[];
  typeNetAmounts?: Record<string, number>;
};

export type RecognisedListSuggestions = {
  accounts: string[];
  entryTypes: string[];
  outputTypes: string[];
};

function toLowerSet(values: Iterable<string>): Set<string> {
  const s = new Set<string>();
  for (const v of values) {
    const t = v.trim();
    if (t) s.add(t.toLowerCase());
  }
  return s;
}

/**
 * Types et comptes présents dans les transactions mais absents des listes reconnues.
 * Classification entrée/sortie d’après le solde net du type (AMOUNT GBP) :
 * ≥ 0 → entrée, < 0 → sortie.
 */
export function computeRecognisedListSuggestions(
  snapshot: TransactionSuggestSnapshot | null | undefined,
  accounts: RecognisedAccountEntry[],
  entryTypes: string[],
  outputTypes: string[]
): RecognisedListSuggestions {
  if (!snapshot) {
    return { accounts: [], entryTypes: [], outputTypes: [] };
  }

  const knownAccountLabels = toLowerSet(collectRecognisedAccountLabelsSet(accounts));
  const knownTypes = toLowerSet([...entryTypes, ...outputTypes]);
  const netByType = snapshot.typeNetAmounts ?? {};

  const suggestedAccounts = Array.from(
    new Set(
      (snapshot.accounts ?? [])
        .map((a) => a.trim())
        .filter((a) => a && !knownAccountLabels.has(a.toLowerCase()))
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  const suggestedEntry: string[] = [];
  const suggestedOutput: string[] = [];
  const seenTypeLo = new Set<string>();

  for (const raw of snapshot.types ?? []) {
    const ty = raw.trim();
    if (!ty) continue;
    const lo = ty.toLowerCase();
    if (knownTypes.has(lo) || seenTypeLo.has(lo)) continue;
    seenTypeLo.add(lo);
    const net = netByType[ty] ?? netByType[raw] ?? 0;
    if (net < 0) suggestedOutput.push(ty);
    else suggestedEntry.push(ty);
  }

  suggestedEntry.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  suggestedOutput.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

  return {
    accounts: suggestedAccounts,
    entryTypes: suggestedEntry,
    outputTypes: suggestedOutput,
  };
}
