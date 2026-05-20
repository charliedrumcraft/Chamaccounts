/** Colonne CSV : origine de la ligne (fichier traité ou saisie manuelle). */
export const TRANSACTION_SOURCE_COLUMN = 'Source';

export const TRANSACTION_SOURCE_VALUE_FILE = 'src_transaction_data.csv';

export const TRANSACTION_SOURCE_VALUE_MANUAL = 'saisi manuelle';

/** Libellé libre après ce préfixe dans la colonne Source (ex. « saisi manuelle — Don perso »). */
const MANUAL_SOURCE_SUFFIX_SEP = ' — ';

/** Ligne considérée comme saisie manuelle : valeur exacte ou « saisi manuelle — … ». */
export function isManualTransactionSourceValue(raw: string): boolean {
  const t = (raw ?? '').trim();
  if (t === TRANSACTION_SOURCE_VALUE_MANUAL) return true;
  return t.startsWith(TRANSACTION_SOURCE_VALUE_MANUAL + MANUAL_SOURCE_SUFFIX_SEP);
}

/** Partie libellé après « saisi manuelle — » ; chaîne vide si aucune. */
export function manualSourceOptionalLabel(raw: string): string {
  const t = (raw ?? '').trim();
  const sep = TRANSACTION_SOURCE_VALUE_MANUAL + MANUAL_SOURCE_SUFFIX_SEP;
  if (t.startsWith(sep)) return t.slice(sep.length).trimEnd();
  return '';
}

/** Valeur CSV pour une saisie manuelle avec libellé source optionnel. */
export function formatManualTransactionSource(optionalLabel: string): string {
  const label = (optionalLabel ?? '').trim();
  if (!label) return TRANSACTION_SOURCE_VALUE_MANUAL;
  return TRANSACTION_SOURCE_VALUE_MANUAL + MANUAL_SOURCE_SUFFIX_SEP + label;
}

/** Valeur affichée / stockée pour la colonne Source (hors « saisi manuelle » = fichier traité). */
export function normalizedTransactionSourceForSelect(raw: string): string {
  const t = (raw ?? '').trim();
  if (isManualTransactionSourceValue(t)) return TRANSACTION_SOURCE_VALUE_MANUAL;
  return TRANSACTION_SOURCE_VALUE_FILE;
}
