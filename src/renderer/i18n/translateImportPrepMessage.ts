import type { TFunction } from 'i18next';
import { MERGE_REPORT_SUCCESS_REASON } from '@/shared/mergeReportConstants';

/** Raisons d’import / validation encore émises en français côté shared — traduites à l’affichage. */
const IMPORT_REASON_FR_TO_KEY: Record<string, string> = {
  'Date manquante': 'transactions.importPrep.reasonMissingDate',
  'Date invalide': 'transactions.importPrep.reasonInvalidDate',
  'Libellé (TITLE) manquant': 'transactions.importPrep.reasonMissingTitle',
  'Montant (AMOUNT GBP) non numérique': 'transactions.importPrep.reasonAmountGbpNaN',
  'Dépense (EXPENSE) non numérique': 'transactions.importPrep.reasonExpenseNaN',
  'Revenu (INCOME) non numérique': 'transactions.importPrep.reasonIncomeNaN',
  'AMOUNT non numérique': 'transactions.importPrep.reasonAmountNaN',
  'CURRENCY non numérique': 'transactions.importPrep.reasonCurrencyNaN',
  'Ligne vide': 'transactions.importPrep.reasonEmptyRow',
  // Raisons de validateSupportImportDisplay (Support) — « Date manquante », « Date invalide » et « Libellé (TITLE) manquant » sont partagées ci-dessus.
  'Montant manquant': 'support.importPrep.reasonMissingAmount',
  'Montant non numérique': 'support.importPrep.reasonAmountNaN',
  'Montant invalide (nul ou non numérique)': 'support.importPrep.reasonAmountInvalid',
  'Devise manquante (EUR, GBP ou CHF)': 'support.importPrep.reasonCurrencyMissing',
  'Devise : EUR, GBP ou CHF': 'support.importPrep.reasonCurrencyInvalid',
  'Date antérieure au mois passé par rapport au lot (avant le 1er jour du mois le plus récent dans l’import).':
    'transactions.importPrep.dateBeforeRefMonth',
  'Date non chronologique : antérieure à la ligne valide précédente dans le fichier.':
    'transactions.importPrep.dateNotChronological',
  'Doublon (ligne déjà présente dans src_transaction_data.csv)':
    'transactions.importPrep.duplicateRow',
  // Raisons de fusion des soldes (AccountBalanceMergeService, écrites en FR dans le CSV rapport).
  'Aucune colonne date détectable dans le fichier.': 'mergeReport.reasons.noDateColumn',
  'Date non reconnue (ligne ignorée).': 'mergeReport.reasons.dateNotRecognised',
  'Aucun compte reconnu ou montant exploitable (ligne ignorée).':
    'mergeReport.reasons.noAccountOrAmount',
  'Date déjà présente dans src_account_balance.csv': 'mergeReport.reasons.dateAlreadyPresent',
  'Date manquante ou colonne date non détectée.': 'accountBalance.importPrep.warnMissingDate',
  'Aucun solde de compte reconnu sur cette ligne.': 'accountBalance.importPrep.warnNoBalance',
};

const IMPORTED_WITHOUT_HEADER_RE =
  /^(\d+) ligne\(s\) importée\(s\) via détection automatique de la colonne date \(sans en-tête DATE\)\.$/;

export function translateImportPrepMessage(message: string, t: TFunction): string {
  const key = IMPORT_REASON_FR_TO_KEY[message];
  if (key) return t(key);
  if (message.includes(' ; ')) {
    return message
      .split(' ; ')
      .map((part) => translateImportPrepMessage(part.trim(), t))
      .join(' ; ');
  }
  return message;
}

/**
 * Filet de sécurité : traduit les messages FR connus encore émis par le code partagé / les services
 * (raisons d’import, rapports de fusion). Les messages inconnus sont renvoyés tels quels.
 */
export function translateKnownFrMessage(message: string, t: TFunction): string {
  const trimmed = message.trim();
  if (trimmed === MERGE_REPORT_SUCCESS_REASON) return t('mergeReport.successReason');
  const withoutHeader = IMPORTED_WITHOUT_HEADER_RE.exec(trimmed);
  if (withoutHeader) {
    return t('mergeReport.reasons.importedWithoutHeader', { count: Number(withoutHeader[1]) });
  }
  return translateImportPrepMessage(message, t);
}
