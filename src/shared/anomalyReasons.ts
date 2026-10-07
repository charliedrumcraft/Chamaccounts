/**
 * Codes stables pour les raisons d’anomalies (transactions + soldes).
 * Le texte localisé est produit à l’affichage / dans les rapports CSV.
 */

export const ANOMALY_REASON_CODES = {
  COLUMN_USUALLY_EMPTY: 'COLUMN_USUALLY_EMPTY',
  COLUMN_USUALLY_FILLED_EMPTY: 'COLUMN_USUALLY_FILLED_EMPTY',
  UNKNOWN_ACCOUNT: 'UNKNOWN_ACCOUNT',
  UNKNOWN_TYPE: 'UNKNOWN_TYPE',
  EXPENSE_TYPE_WITH_INCOME: 'EXPENSE_TYPE_WITH_INCOME',
  INCOME_TYPE_WITH_EXPENSE: 'INCOME_TYPE_WITH_EXPENSE',
  ZERO_AMOUNT: 'ZERO_AMOUNT',
  DATE_CHRONOLOGY: 'DATE_CHRONOLOGY',
  DUPLICATE_ROW: 'DUPLICATE_ROW',
  BALANCE_COLUMN_COUNT_MISMATCH: 'BALANCE_COLUMN_COUNT_MISMATCH',
  BALANCE_UNKNOWN_ACCOUNT_COLUMN: 'BALANCE_UNKNOWN_ACCOUNT_COLUMN',
  BALANCE_INACTIVE_ACCOUNT_COLUMN: 'BALANCE_INACTIVE_ACCOUNT_COLUMN',
  BALANCE_MISSING_DATE: 'BALANCE_MISSING_DATE',
  BALANCE_INVALID_DATE: 'BALANCE_INVALID_DATE',
  BALANCE_DATE_NOT_FIRST_OF_MONTH: 'BALANCE_DATE_NOT_FIRST_OF_MONTH',
  BALANCE_DUPLICATE_DATE: 'BALANCE_DUPLICATE_DATE',
  BALANCE_WRONG_CURRENCY: 'BALANCE_WRONG_CURRENCY',
  BALANCE_FILE_MISSING: 'BALANCE_FILE_MISSING',
} as const;

export type AnomalyReasonCode = (typeof ANOMALY_REASON_CODES)[keyof typeof ANOMALY_REASON_CODES];

export type AnomalyReason = {
  code: AnomalyReasonCode;
  params?: Record<string, string | number>;
};

export type AnomalyReasonFormatter = (reason: AnomalyReason) => string;

/** Libellés français (rapports main / défaut sans i18n). */
const FR_TEMPLATES: Record<AnomalyReasonCode, string> = {
  COLUMN_USUALLY_EMPTY: 'Colonne "{{column}}" habituellement vide contient une valeur',
  COLUMN_USUALLY_FILLED_EMPTY: 'Colonne "{{column}}" habituellement remplie est vide',
  UNKNOWN_ACCOUNT: 'Account inconnu',
  UNKNOWN_TYPE: 'Type inconnu',
  EXPENSE_TYPE_WITH_INCOME: 'Type sortie utilisé avec montant positif (revenu)',
  INCOME_TYPE_WITH_EXPENSE: 'Type entrée utilisé avec montant négatif (dépense)',
  ZERO_AMOUNT: 'Montant nul',
  DATE_CHRONOLOGY: 'Date possiblement fausse (défaillance de la chronologie)',
  DUPLICATE_ROW: 'Doublon (ligne déjà présente dans source_data)',
  BALANCE_COLUMN_COUNT_MISMATCH:
    'Nombre de colonnes de solde ({{actual}}) ne correspond pas au nombre de comptes actifs ({{expected}}).',
  BALANCE_UNKNOWN_ACCOUNT_COLUMN: 'Compte non reconnu (colonne « {{column}} »).',
  BALANCE_INACTIVE_ACCOUNT_COLUMN: 'Compte non reconnu ou inactif (colonne « {{column}} »).',
  BALANCE_MISSING_DATE: 'Date manquante.',
  BALANCE_INVALID_DATE: 'Date invalide ou illisible.',
  BALANCE_DATE_NOT_FIRST_OF_MONTH:
    'La date doit être le 1er jour du mois (ex. 01.01.2022), pas un autre jour du mois.',
  BALANCE_DUPLICATE_DATE: 'Doublon de date (plusieurs lignes pour le même jour).',
  BALANCE_WRONG_CURRENCY: 'Devise incorrecte (colonne « {{column}} », attendu {{currency}}).',
  BALANCE_FILE_MISSING: 'src_account_balance.csv introuvable ou vide.',
};

function applyTemplate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    params[key] !== undefined && params[key] !== null ? String(params[key]) : ''
  );
}

export function formatAnomalyReasonFr(reason: AnomalyReason): string {
  const template = FR_TEMPLATES[reason.code] ?? reason.code;
  return applyTemplate(template, reason.params);
}

export function formatAnomalyReasonsList(
  reasons: AnomalyReason[],
  format: AnomalyReasonFormatter = formatAnomalyReasonFr
): string {
  return reasons.map(format).join(' ; ');
}

export function anomalyReason(
  code: AnomalyReasonCode,
  params?: Record<string, string | number>
): AnomalyReason {
  return params ? { code, params } : { code };
}
