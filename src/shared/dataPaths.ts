/**
 * Chemins des données applicatives, relatifs à la racine du projet (dev) ou à getAppPath() (Electron).
 * Le processus principal joint ces segments avec path.join(base, …) ; ne pas y mettre de chemins absolus.
 */

export const DATA_ROOT = 'data';

/** Copie de secours du stockage navigateur (localStorage) pour portabilité du dossier data/. */
export const APP_STATE_DIR = `${DATA_ROOT}/AppState`;
export const LOCAL_STORAGE_SNAPSHOT_CSV_PATH = `${APP_STATE_DIR}/local_storage_snapshot.csv`;

const TRANSACTIONS_ROOT = `${DATA_ROOT}/TransactionsData`;
export const TRANSACTIONS_IMPORT_DIR = `${TRANSACTIONS_ROOT}/Import`;
export const TRANSACTIONS_PROCESSED_DIR = `${TRANSACTIONS_ROOT}/Processed`;

export const SOURCE_DATA_PATH = `${TRANSACTIONS_PROCESSED_DIR}/src_transaction_data.csv`;

/** Lignes Support saisies depuis la page Soutien (hors import / hors tableau Transactions). */
export const SUPPORT_DATA_DIR = `${DATA_ROOT}/SupportData`;
export const SUPPORT_DATA_CSV_PATH = `${SUPPORT_DATA_DIR}/Support_data.csv`;
export const MERGE_REPORT_PATH = `${TRANSACTIONS_PROCESSED_DIR}/merge_report.csv`;
export const ANOMALY_REPORT_PATH = `${TRANSACTIONS_PROCESSED_DIR}/anomaly_report.csv`;
export const MONTHLY_ANOMALY_REPORT_PATH = `${TRANSACTIONS_PROCESSED_DIR}/monthly_anomaly_report.csv`;

const ACCOUNT_BALANCE_ROOT = `${DATA_ROOT}/AccountBalanceData`;
export const ACCOUNT_BALANCE_PROCESSED_DIR = `${ACCOUNT_BALANCE_ROOT}/Processed`;
export const ACCOUNT_BALANCE_IMPORT_DIR = `${ACCOUNT_BALANCE_ROOT}/Import`;
export const ACCOUNT_BALANCE_MERGE_REPORT_PATH = `${ACCOUNT_BALANCE_PROCESSED_DIR}/account_balance_merge_report.csv`;
export const ACCOUNT_BALANCE_ANOMALY_REPORT_PATH = `${ACCOUNT_BALANCE_PROCESSED_DIR}/account_balance_anomaly_report.csv`;

/** Fichier d'import dans le dossier Import (nom seul ou avec sous-chemin interdit — utiliser basename côté appelant). */
export function transactionsImportFile(fileName: string): string {
  return `${TRANSACTIONS_IMPORT_DIR}/${fileName}`;
}

/** Fichier copié dans data/AccountBalanceData/Import (basename uniquement côté appelant). */
export function accountBalanceImportFile(fileName: string): string {
  return `${ACCOUNT_BALANCE_IMPORT_DIR}/${fileName}`;
}
