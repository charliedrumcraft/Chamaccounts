/**
 * Fusionne les CSV du dossier Import dans Processed/src_transaction_data.csv (API héritée).
 * Même politique d’import que le mapping wizard : @/shared/transactionsImportMappingPolicy + parseImportCsv.
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import {
  TRANSACTIONS_IMPORT_DIR as IMPORT_DIR,
  SOURCE_DATA_PATH as PROCESSED_PATH,
} from '../shared/dataPaths';
import {
  OUTPUT_HEADERS,
  type ValidRow,
  type AnomalyRow,
  parseCsvLine,
  normalizeHeader,
  mapToStandardHeader,
  formatDateDDMMYY,
  emptyRow,
  parseImportCsv,
  rowSignature,
  rowToCsvLine,
  sortByDate,
} from '../shared/transactionsImportCore';
import { DEFAULT_IMPORT_MAPPING_RATES } from '../shared/transactionsImportMappingPolicy';

export type { ValidRow, AnomalyRow };
export { MERGE_REPORT_SUCCESS_REASON } from '../shared/mergeReportConstants';

async function readExistingProcessed(appPath: string): Promise<{ headerLine: string; rows: ValidRow[] }> {
  const fullPath = path.join(appPath, PROCESSED_PATH);
  if (!existsSync(fullPath)) {
    return { headerLine: OUTPUT_HEADERS.join(';'), rows: [] };
  }
  const content = await fs.readFile(fullPath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) {
    return { headerLine: OUTPUT_HEADERS.join(';'), rows: [] };
  }
  const headerLine = lines[0];
  const headerNames = parseCsvLine(headerLine, ';').map(normalizeHeader);
  const dataHeaderMap = new Map<string, number>();
  const headerList = [...OUTPUT_HEADERS] as string[];
  headerNames.forEach((norm) => {
    if (/^index$/i.test(norm)) return;
    const std = mapToStandardHeader(norm) ?? (headerList.includes(norm) ? norm : null);
    if (std) {
      const idx = headerList.indexOf(std);
      if (idx >= 0) dataHeaderMap.set(norm, idx);
    }
  });

  const rows: ValidRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const values = parseCsvLine(line, ';');
    const row = emptyRow();
    for (let c = 0; c < headerNames.length; c++) {
      const stdKey = dataHeaderMap.get(headerNames[c]);
      if (stdKey === undefined || stdKey === 0) continue;
      const val = (values[c] ?? '').trim();
      const key = OUTPUT_HEADERS[stdKey];
      (row as unknown as Record<string, string>)[key] = key === 'DATE' ? (formatDateDDMMYY(val) || val) : val;
    }
    row.DATE = formatDateDDMMYY(row.DATE) || row.DATE;
    rows.push(row);
  }
  return { headerLine: OUTPUT_HEADERS.join(';'), rows };
}

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
 * Ajoute des lignes valides au fichier traité (ex. depuis l’assistant d’import).
 */
export async function appendForcedTransactionRows(
  appPath: string,
  rows: ValidRow[]
): Promise<{ success: boolean; error?: string; appendedCount: number }> {
  if (!rows.length) return { success: true, appendedCount: 0 };
  try {
    const processedFull = path.join(appPath, PROCESSED_PATH);
    const { rows: existingRows } = await readExistingProcessed(appPath);
    const allValid: ValidRow[] = [...existingRows, ...rows];
    sortByDate(allValid);
    const csvLines = [OUTPUT_HEADERS.join(';')];
    allValid.forEach((row, i) => {
      csvLines.push(rowToCsvLine(row, i + 1));
    });
    const processedDir = path.dirname(processedFull);
    if (!existsSync(processedDir)) await fs.mkdir(processedDir, { recursive: true });
    await fs.writeFile(processedFull, csvLines.join('\n'), 'utf-8');
    return { success: true, appendedCount: rows.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, appendedCount: 0 };
  }
}

/**
 * Fusion automatique (sans assistant). Ne génère plus merge_report.csv.
 */
export async function mergeImportTransactions(appPath: string): Promise<MergeResult> {
  const importDir = path.join(appPath, IMPORT_DIR);
  const processedFull = path.join(appPath, PROCESSED_PATH);

  if (!existsSync(importDir)) {
    return { success: true, mergedCount: 0, anomalyCount: 0, totalImportDataRows: 0, notMergedCount: 0 };
  }

  const files = await fs.readdir(importDir);
  const csvFiles = files.filter((f) => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().startsWith('import_report'));
  if (csvFiles.length === 0) {
    return { success: true, mergedCount: 0, anomalyCount: 0, totalImportDataRows: 0, notMergedCount: 0 };
  }

  const { rows: existingRows } = await readExistingProcessed(appPath);
  const allValid: ValidRow[] = [...existingRows];
  const allAnomalies: AnomalyRow[] = [];
  const existingSignatures = new Set(existingRows.map(rowSignature));

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
      const sig = rowSignature(item.row);
      if (existingSignatures.has(sig)) {
        allAnomalies.push({
          sourceFile: item.sourceFile,
          lineNumber: item.lineNumber,
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

  sortByDate(allValid);

  const processedDir = path.dirname(processedFull);
  if (!existsSync(processedDir)) {
    await fs.mkdir(processedDir, { recursive: true });
  }

    const csvLines = [OUTPUT_HEADERS.join(';')];
    allValid.forEach((row, i) => {
      csvLines.push(rowToCsvLine(row, i + 1));
    });
    await fs.writeFile(processedFull, csvLines.join('\n'), 'utf-8');

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
