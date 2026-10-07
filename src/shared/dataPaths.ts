/**
 * Chemins des données applicatives, relatifs à getDataRoot() :
 * dossier choisi par l'utilisateur pour le profil actif (hors dépôt Git).
 */

/** Préfixe des entrées dans les archives ZIP (compatibilité export/import historique). */
export const DATA_ZIP_PREFIX = 'data';

/** Copie de secours du stockage navigateur (localStorage) pour portabilité du profil. */
export const APP_STATE_DIR = 'AppState';
export const LOCAL_STORAGE_SNAPSHOT_CSV_PATH = `${APP_STATE_DIR}/local_storage_snapshot.csv`;
/** Devises de travail du profil (primaire + secondaires). */
export const WORKING_CURRENCIES_PATH = `${APP_STATE_DIR}/working_currencies.json`;

const TRANSACTIONS_ROOT = 'TransactionsData';
export const TRANSACTIONS_IMPORT_DIR = `${TRANSACTIONS_ROOT}/Import`;
export const TRANSACTIONS_PROCESSED_DIR = `${TRANSACTIONS_ROOT}/Processed`;

export const SOURCE_DATA_PATH = `${TRANSACTIONS_PROCESSED_DIR}/src_transaction_data.csv`;

/** Base SQLite des transactions (source de vérité ; le CSV est un miroir dérivé). */
export const TRANSACTIONS_DB_PATH = `${TRANSACTIONS_PROCESSED_DIR}/transactions.db`;

/** Lignes Support saisies depuis la page Soutien (hors import / hors tableau Transactions). */
export const SUPPORT_DATA_DIR = 'SupportData';
export const SUPPORT_DATA_CSV_PATH = `${SUPPORT_DATA_DIR}/Support_data.csv`;

/** Base SQLite Support (source de vérité ; Support_data.csv est un miroir dérivé). */
export const SUPPORT_DB_PATH = `${SUPPORT_DATA_DIR}/support.db`;
export const MERGE_REPORT_PATH = `${TRANSACTIONS_PROCESSED_DIR}/merge_report.csv`;
export const ANOMALY_REPORT_PATH = `${TRANSACTIONS_PROCESSED_DIR}/anomaly_report.csv`;
export const MONTHLY_ANOMALY_REPORT_PATH = `${TRANSACTIONS_PROCESSED_DIR}/monthly_anomaly_report.csv`;

const ACCOUNT_BALANCE_ROOT = 'AccountBalanceData';
export const ACCOUNT_BALANCE_PROCESSED_DIR = `${ACCOUNT_BALANCE_ROOT}/Processed`;
export const ACCOUNT_BALANCE_IMPORT_DIR = `${ACCOUNT_BALANCE_ROOT}/Import`;
export const ACCOUNT_BALANCE_MERGE_REPORT_PATH = `${ACCOUNT_BALANCE_PROCESSED_DIR}/account_balance_merge_report.csv`;
export const ACCOUNT_BALANCE_ANOMALY_REPORT_PATH = `${ACCOUNT_BALANCE_PROCESSED_DIR}/account_balance_anomaly_report.csv`;

/** Base SQLite soldes (source de vérité ; src_account_balance.csv est un miroir dérivé). */
export const ACCOUNT_BALANCE_DB_PATH = `${ACCOUNT_BALANCE_PROCESSED_DIR}/account_balance.db`;

/** Nom du CSV miroir soldes (préféré). */
export const ACCOUNT_BALANCE_CSV_FILENAME = 'src_account_balance.csv';
export const ACCOUNT_BALANCE_CSV_PATH = `${ACCOUNT_BALANCE_PROCESSED_DIR}/${ACCOUNT_BALANCE_CSV_FILENAME}`;

/** Fichier d'import dans le dossier Import (nom seul — utiliser basename côté appelant). */
export function transactionsImportFile(fileName: string): string {
  return `${TRANSACTIONS_IMPORT_DIR}/${fileName}`;
}

/** Fichier copié dans AccountBalanceData/Import (basename uniquement côté appelant). */
export function accountBalanceImportFile(fileName: string): string {
  return `${ACCOUNT_BALANCE_IMPORT_DIR}/${fileName}`;
}
