/**
 * Chemins des données applicatives, relatifs à la racine du projet (dev) ou à getAppPath() (Electron).
 * Le processus principal joint ces segments avec path.join(base, …) ; ne pas y mettre de chemins absolus.
 */

export const DATA_ROOT = 'data';

const TRANSACTIONS_ROOT = `${DATA_ROOT}/TransactionsData`;
export const TRANSACTIONS_IMPORT_DIR = `${TRANSACTIONS_ROOT}/Import`;
export const TRANSACTIONS_OLD_DIR = `${TRANSACTIONS_ROOT}/Old`;
export const TRANSACTIONS_PROCESSED_DIR = `${TRANSACTIONS_ROOT}/Processed`;

export const SOURCE_DATA_PATH = `${TRANSACTIONS_PROCESSED_DIR}/source_data.csv`;
export const MERGE_REPORT_PATH = `${TRANSACTIONS_PROCESSED_DIR}/merge_report.csv`;
export const ANOMALY_REPORT_PATH = `${TRANSACTIONS_PROCESSED_DIR}/anomaly_report.csv`;
export const MONTHLY_ANOMALY_REPORT_PATH = `${TRANSACTIONS_PROCESSED_DIR}/monthly_anomaly_report.csv`;

const ACCOUNT_BALANCE_ROOT = `${DATA_ROOT}/AccountBalanceData`;
export const ACCOUNT_BALANCE_PROCESSED_DIR = `${ACCOUNT_BALANCE_ROOT}/Processed`;

/** Fichier d'import dans le dossier Import (nom seul ou avec sous-chemin interdit — utiliser basename côté appelant). */
export function transactionsImportFile(fileName: string): string {
  return `${TRANSACTIONS_IMPORT_DIR}/${fileName}`;
}
