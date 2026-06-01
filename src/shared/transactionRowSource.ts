/** Colonne CSV : origine de la ligne (fichier traité ou saisie manuelle). */
export const TRANSACTION_SOURCE_COLUMN = 'Source';

export const TRANSACTION_SOURCE_VALUE_FILE = 'src_transaction_data.csv';

export const TRANSACTION_SOURCE_VALUE_MANUAL = 'saisie manuelle';

/** Ancienne valeur (typo) encore reconnue pour les fichiers existants. */
const LEGACY_MANUAL_SOURCE_VALUE = 'saisi manuelle';

/** Libellé libre après ce préfixe dans la colonne Source (ex. « saisie manuelle — Don perso »). */
const MANUAL_SOURCE_SUFFIX_SEP = ' — ';

function manualSourcePrefixes(): string[] {
  return [TRANSACTION_SOURCE_VALUE_MANUAL, LEGACY_MANUAL_SOURCE_VALUE];
}

/** Ligne considérée comme saisie manuelle : valeur exacte ou « saisie manuelle — … ». */
export function isManualTransactionSourceValue(raw: string): boolean {
  const t = (raw ?? '').trim();
  return manualSourcePrefixes().some(
    (prefix) => t === prefix || t.startsWith(prefix + MANUAL_SOURCE_SUFFIX_SEP)
  );
}

/** Partie libellé après « saisie manuelle — » ; chaîne vide si aucune. */
export function manualSourceOptionalLabel(raw: string): string {
  const t = (raw ?? '').trim();
  for (const prefix of manualSourcePrefixes()) {
    const sep = prefix + MANUAL_SOURCE_SUFFIX_SEP;
    if (t.startsWith(sep)) return t.slice(sep.length).trimEnd();
  }
  return '';
}

/** Valeur CSV pour une saisie manuelle avec libellé source optionnel. */
export function formatManualTransactionSource(optionalLabel: string): string {
  const label = (optionalLabel ?? '').trim();
  if (!label) return TRANSACTION_SOURCE_VALUE_MANUAL;
  return TRANSACTION_SOURCE_VALUE_MANUAL + MANUAL_SOURCE_SUFFIX_SEP + label;
}

/** Valeur affichée / stockée pour la colonne Source (hors « saisie manuelle » = fichier traité). */
export function normalizedTransactionSourceForSelect(raw: string): string {
  const t = (raw ?? '').trim();
  if (isManualTransactionSourceValue(t)) return TRANSACTION_SOURCE_VALUE_MANUAL;
  return TRANSACTION_SOURCE_VALUE_FILE;
}
