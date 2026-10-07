/**
 * Fusionne les CSV du dossier Import dans les transactions (SQLite + miroir CSV).
 * Même politique d’import que le mapping wizard : @/shared/transactionsImportMappingPolicy + parseImportCsv.
 */

import * as path from 'path';
import { tm } from './uiI18n';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { TRANSACTIONS_IMPORT_DIR as IMPORT_DIR } from '../shared/dataPaths';
import {
  type ValidRow,
  type AnomalyRow,
  parseImportCsv,
  rowSignature,
  buildAccountAliasLookup,
} from '../shared/transactionsImportCore';
import { DEFAULT_IMPORT_MAPPING_RATES } from '../shared/transactionsImportMappingPolicy';
import {
  appendValidRows,
  getAllAsValidRows,
  replaceAllValidRows,
} from './db/transactionStore';

export type { ValidRow, AnomalyRow };
export { MERGE_REPORT_SUCCESS_REASON } from '../shared/mergeReportConstants';

export interface MergeResult {
  success: boolean;
  error?: string;
  mergedCount: number;
  anomalyCount: number;
  totalImportDataRows: number;
  notMergedCount: number;
  reportPath?: string;
}

/**
 * Ajoute des lignes valides (ex. depuis l’assistant d’import).
 */
export async function appendForcedTransactionRows(
  appPath: string,
  rows: ValidRow[]
): Promise<{ success: boolean; error?: string; appendedCount: number }> {
  if (!rows.length) return { success: true, appendedCount: 0 };
  return await appendValidRows(appPath, rows);
}

/**
 * Fusion automatique (sans assistant). Ne génère plus merge_report.csv.
 */
export async function mergeImportTransactions(appPath: string): Promise<MergeResult> {
  const importDir = path.join(appPath, IMPORT_DIR);

  if (!existsSync(importDir)) {
    return { success: true, mergedCount: 0, anomalyCount: 0, totalImportDataRows: 0, notMergedCount: 0 };
  }

  const files = await fs.readdir(importDir);
  const csvFiles = files.filter((f) => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().startsWith('import_report'));
  if (csvFiles.length === 0) {
    return { success: true, mergedCount: 0, anomalyCount: 0, totalImportDataRows: 0, notMergedCount: 0 };
  }

  const existingRows = await getAllAsValidRows(appPath);
  const allValid: ValidRow[] = [...existingRows];
  const allAnomalies: AnomalyRow[] = [];
  const accountAliasLookup = buildAccountAliasLookup([]);
  const existingSignatures = new Set(
    existingRows.map((row) => rowSignature(row, { accountAliasLookup }))
  );

  let totalImportDataRows = 0;
  for (const file of csvFiles) {
    const filePath = path.join(importDir, file);
    const content = await fs.readFile(filePath, 'utf-8');
    const { valid, anomalies } = parseImportCsv(content, file, ';', {
      importMappingRates: DEFAULT_IMPORT_MAPPING_RATES,
    });
    totalImportDataRows += valid.length + anomalies.length;
    allAnomalies.push(...anomalies);
    for (const item of valid) {
      const sig = rowSignature(item.row, { accountAliasLookup });
      if (existingSignatures.has(sig)) {
        allAnomalies.push({
          sourceFile: item.sourceFile,
          lineNumber: item.lineNumber,
          // Jeton FR stable (traduit à l'affichage côté renderer via translateImportPrepMessage).
          reason: 'Doublon (ligne déjà présente dans src_transaction_data.csv)',
          row: { ...item.row },
          rawLine: item.rawLine,
        });
      } else {
        existingSignatures.add(sig);
        allValid.push(item.row);
      }
    }
  }

  const write = await replaceAllValidRows(appPath, allValid, { sortByDate: true });
  if (!write.success) {
    return {
      success: false,
      error: write.error ?? tm('error.sqliteWriteFailed'),
      mergedCount: 0,
      anomalyCount: allAnomalies.length,
      totalImportDataRows,
      notMergedCount: totalImportDataRows,
    };
  }

  const mergedCount = allValid.length - existingRows.length;
  const notMergedCount = Math.max(0, totalImportDataRows - mergedCount);
  return {
    success: true,
    mergedCount,
    anomalyCount: allAnomalies.length,
    totalImportDataRows,
    notMergedCount,
  };
}

/** @deprecated Plus de merge_report.csv ; retourne null. */
export async function getLastImportReportPath(_appPath: string): Promise<string | null> {
  return null;
}
