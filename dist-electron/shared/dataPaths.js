"use strict";
/**
 * Chemins des données applicatives, relatifs à la racine du projet (dev) ou à getAppPath() (Electron).
 * Le processus principal joint ces segments avec path.join(base, …) ; ne pas y mettre de chemins absolus.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_BALANCE_PROCESSED_DIR = exports.MONTHLY_ANOMALY_REPORT_PATH = exports.ANOMALY_REPORT_PATH = exports.MERGE_REPORT_PATH = exports.SOURCE_DATA_PATH = exports.TRANSACTIONS_PROCESSED_DIR = exports.TRANSACTIONS_OLD_DIR = exports.TRANSACTIONS_IMPORT_DIR = exports.DATA_ROOT = void 0;
exports.transactionsImportFile = transactionsImportFile;
exports.DATA_ROOT = 'data';
const TRANSACTIONS_ROOT = `${exports.DATA_ROOT}/TransactionsData`;
exports.TRANSACTIONS_IMPORT_DIR = `${TRANSACTIONS_ROOT}/Import`;
exports.TRANSACTIONS_OLD_DIR = `${TRANSACTIONS_ROOT}/Old`;
exports.TRANSACTIONS_PROCESSED_DIR = `${TRANSACTIONS_ROOT}/Processed`;
exports.SOURCE_DATA_PATH = `${exports.TRANSACTIONS_PROCESSED_DIR}/source_data.csv`;
exports.MERGE_REPORT_PATH = `${exports.TRANSACTIONS_PROCESSED_DIR}/merge_report.csv`;
exports.ANOMALY_REPORT_PATH = `${exports.TRANSACTIONS_PROCESSED_DIR}/anomaly_report.csv`;
exports.MONTHLY_ANOMALY_REPORT_PATH = `${exports.TRANSACTIONS_PROCESSED_DIR}/monthly_anomaly_report.csv`;
const ACCOUNT_BALANCE_ROOT = `${exports.DATA_ROOT}/AccountBalanceData`;
exports.ACCOUNT_BALANCE_PROCESSED_DIR = `${ACCOUNT_BALANCE_ROOT}/Processed`;
/** Fichier d'import dans le dossier Import (nom seul ou avec sous-chemin interdit — utiliser basename côté appelant). */
function transactionsImportFile(fileName) {
    return `${exports.TRANSACTIONS_IMPORT_DIR}/${fileName}`;
}
