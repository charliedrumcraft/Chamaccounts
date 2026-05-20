import {
  ACCOUNT_BALANCE_PROCESSED_DIR,
  ACCOUNT_BALANCE_IMPORT_DIR,
  ACCOUNT_BALANCE_MERGE_REPORT_PATH,
} from '@/shared/dataPaths';
import {
  AccountBalanceCSVService,
  ACCOUNT_BALANCE_PROCESSED_FILENAMES,
  type BalanceRow,
} from './AccountBalanceCSVService';
import type { RecognisedAccountEntry } from '../constants/recognisedAccountsStorage';
import Papa from 'papaparse';
import { format, startOfDay } from 'date-fns';
import { MERGE_REPORT_SUCCESS_REASON } from '@/shared/mergeReportConstants';

/** Ligne signalée dans le rapport de fusion (non importée ou anomalie). */
export interface AccountBalanceNotImportedRow {
  sourceFile: string;
  lineNumber: number;
  reason: string;
  rawLine: string;
}

export interface AccountBalanceMergeResult {
  success: boolean;
  mergedCount: number;
  anomalyCount: number;
  importFileCount: number;
  importedWithoutDateHeaderCount: number;
  /** Lignes ignorées car la date existait déjà (fusion normale uniquement). */
  duplicateDateCount: number;
  /** Lignes remplacées (fusion avec remplacement des dates en conflit). */
  replacedCount: number;
  /** Lignes de données dans les CSV d'import (hors en-tête), tous fichiers confondus. */
  totalImportDataRows: number;
  /** Lignes d'import non intégrées (ignorées ou en doublon non remplacé). */
  notMergedCount: number;
  /** Détail des lignes en anomalie ou non fusionnées (même contenu que le CSV de rapport). */
  notImportedRows: AccountBalanceNotImportedRow[];
  error?: string;
}

export interface AccountBalanceMergeOptions {
  /** Si true, une date déjà dans src_account_balance est remplacée par la ligne importée. */
  replaceDuplicateDates?: boolean;
}

function mapAnomaliesToNotImportedRows(
  list: { sourceFile: string; lineNumber: number; reason: string; rawLine: string }[]
): AccountBalanceNotImportedRow[] {
  return list.map((a) => ({
    sourceFile: a.sourceFile,
    lineNumber: a.lineNumber,
    reason: a.reason,
    rawLine: a.rawLine,
  }));
}

function escapeReportCell(s: string): string {
  return (s ?? '').replace(/;/g, ',').replace(/\r?\n/g, ' ');
}

function normalizeHeader(h: string | undefined): string {
  return String(h ?? '').replace(/^\uFEFF/, '').trim();
}

function detectDateColumn(
  headers: string[],
  records: Record<string, string>[]
): { key: string | null; inferredWithoutHeader: boolean } {
  const explicitDate = headers.find((h) => /^date$/i.test(normalizeHeader(h)));
  if (explicitDate) return { key: explicitDate, inferredWithoutHeader: false };

  let bestKey: string | null = null;
  let bestScore = 0;
  for (const h of headers) {
    const key = h;
    let score = 0;
    for (const row of records) {
      const raw = String(row[key] ?? '').trim();
      if (!raw) continue;
      if (AccountBalanceCSVService.parseBalanceDateInput(raw)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  if (!bestKey || bestScore === 0) return { key: null, inferredWithoutHeader: false };
  return { key: bestKey, inferredWithoutHeader: true };
}

function detectDateColumnFromRawLines(lines: string[]): boolean {
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length < 2) return false;
  const sampleDataLines = nonEmpty.slice(1, 4);
  let ok = 0;
  for (const line of sampleDataLines) {
    const firstCell = (line.split(';')[0] ?? '').replace(/^\uFEFF/, '').trim();
    if (AccountBalanceCSVService.parseBalanceDateInput(firstCell)) ok++;
  }
  return ok > 0;
}

/**
 * Fusionne les CSV du dossier AccountBalanceData/Import dans Processed/src_account_balance.csv.
 * Les dates déjà présentes dans le fichier courant (ou ajoutées par un import précédent dans la même fusion) sont signalées en anomalie,
 * sauf si `replaceDuplicateDates` est activé (remplacement par l’import).
 */
export async function mergeAccountBalanceImports(
  accounts: RecognisedAccountEntry[],
  options?: AccountBalanceMergeOptions
): Promise<AccountBalanceMergeResult> {
  const replaceDuplicateDates = options?.replaceDuplicateDates === true;
  const api = (
    window as unknown as {
      electronAPI?: {
        readDirectory: (path: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;
        readFile: (path: string) => Promise<{ success: boolean; data?: string; error?: string }>;
        writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
      };
    }
  ).electronAPI;
  if (!api?.readDirectory || !api?.readFile || !api?.writeFile) {
    return {
      success: false,
      mergedCount: 0,
      anomalyCount: 0,
      importFileCount: 0,
      importedWithoutDateHeaderCount: 0,
      duplicateDateCount: 0,
      replacedCount: 0,
      totalImportDataRows: 0,
      notMergedCount: 0,
      notImportedRows: [],
      error: 'API Electron indisponible.',
    };
  }

  let importNames: string[] = [];
  try {
    const dirResult = await api.readDirectory(ACCOUNT_BALANCE_IMPORT_DIR);
    if (dirResult.success && dirResult.data) {
      importNames = dirResult.data.filter(
        (f) => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().startsWith('import_report')
      );
    }
  } catch {
    importNames = [];
  }

  const dataDir = ACCOUNT_BALANCE_PROCESSED_DIR;
  let processedFileName: string | null = null;
  let existingContent: string | null = null;
  for (const fileName of ACCOUNT_BALANCE_PROCESSED_FILENAMES) {
    const read = await api.readFile(`${dataDir}/${fileName}`);
    if (read.success && read.data !== undefined) {
      processedFileName = fileName;
      existingContent = read.data;
      break;
    }
  }

  if (!processedFileName || existingContent === null) {
    return {
      success: false,
      mergedCount: 0,
      anomalyCount: 0,
      importFileCount: importNames.length,
      importedWithoutDateHeaderCount: 0,
      duplicateDateCount: 0,
      replacedCount: 0,
      totalImportDataRows: 0,
      notMergedCount: 0,
      notImportedRows: [],
      error: 'src_account_balance.csv introuvable dans Processed.',
    };
  }

  const existingRows = AccountBalanceCSVService.parseBalanceCsvContent(existingContent) ?? [];
  const byTime = new Map<number, BalanceRow>();
  for (const r of existingRows) {
    byTime.set(r.date.getTime(), r);
  }
  const initialSize = byTime.size;

  const anomalies: { sourceFile: string; lineNumber: number; reason: string; rawLine: string }[] = [];
  const successItems: { sourceFile: string; lineNumber: number; reason: string; dateStr: string; rawLine: string }[] =
    [];
  let duplicateDateCount = 0;
  let replacedCount = 0;
  let totalImportDataRows = 0;

  if (importNames.length === 0) {
    const reportHeader = 'fichier_source;ligne;raison;date;ligne_brute';
    await api.writeFile(ACCOUNT_BALANCE_MERGE_REPORT_PATH, `${reportHeader}\n`);
    return {
      success: true,
      mergedCount: 0,
      anomalyCount: 0,
      importFileCount: 0,
      importedWithoutDateHeaderCount: 0,
      duplicateDateCount: 0,
      replacedCount: 0,
      totalImportDataRows: 0,
      notMergedCount: 0,
      notImportedRows: [],
    };
  }

  importNames.sort();
  let importedWithoutDateHeaderCount = 0;

  for (const file of importNames) {
    const filePath = `${ACCOUNT_BALANCE_IMPORT_DIR}/${file}`;
    const read = await api.readFile(filePath);
    if (!read.success || read.data === undefined) continue;

    const lines = read.data.split(/\r?\n/);
    const headerRow = lines.findIndex((l) => l.trim() !== '');
    const dataStart = headerRow >= 0 ? headerRow + 1 : 0;
    const parsed = Papa.parse(read.data, {
      header: true,
      delimiter: ';',
      skipEmptyLines: true,
    });
    const headers = (parsed.meta.fields || []).map((h) => h ?? '');
    const records = (parsed.data || []) as Record<string, string>[];
    if (records.length === 0) continue;
    totalImportDataRows += records.length;
    let { key: dateKey, inferredWithoutHeader } = detectDateColumn(headers, records);
    if (dateKey === null && headers.length > 0 && detectDateColumnFromRawLines(lines)) {
      dateKey = headers[0] ?? null;
      inferredWithoutHeader = true;
    }
    if (dateKey === null) {
      anomalies.push({
        sourceFile: file,
        lineNumber: 0,
        reason: 'Aucune colonne date détectable dans le fichier.',
        rawLine: '',
      });
      continue;
    }

    let importedWithoutHeaderCount = 0;
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const rawLine = dataStart + i < lines.length ? lines[dataStart + i] : '';
      const lineNumber = dataStart + i + 1;
      const rawDate = String(row[dateKey] ?? '').trim();
      const parsedDate = AccountBalanceCSVService.parseBalanceDateInput(rawDate);
      if (!parsedDate) {
        anomalies.push({
          sourceFile: file,
          lineNumber,
          reason: 'Date non reconnue (ligne ignorée).',
          rawLine,
        });
        continue;
      }
      const balances: Record<string, number> = {};
      for (const header of headers) {
        if (!header || header === dateKey) continue;
        const code = AccountBalanceCSVService.resolveAccountHeaderToCode(header);
        if (!code) continue;
        const rawValue = row[header];
        const amount = AccountBalanceCSVService.parseBalanceAmount(rawValue);
        if (amount !== 0 || String(rawValue ?? '').trim() !== '') {
          balances[code] = (balances[code] ?? 0) + amount;
        }
      }
      if (Object.keys(balances).length === 0) {
        anomalies.push({
          sourceFile: file,
          lineNumber,
          reason: 'Aucun compte reconnu ou montant exploitable (ligne ignorée).',
          rawLine,
        });
        continue;
      }
      const br: BalanceRow = { date: startOfDay(parsedDate), balances };
      const t = br.date.getTime();

      if (byTime.has(t)) {
        if (replaceDuplicateDates) {
          byTime.set(t, br);
          replacedCount++;
          if (inferredWithoutHeader) importedWithoutHeaderCount++;
          successItems.push({
            sourceFile: file,
            lineNumber,
            reason: MERGE_REPORT_SUCCESS_REASON,
            dateStr: format(br.date, 'dd/MM/yyyy'),
            rawLine,
          });
        } else {
          duplicateDateCount++;
          anomalies.push({
            sourceFile: file,
            lineNumber,
            reason: 'Date déjà présente dans src_account_balance.csv',
            rawLine,
          });
        }
        continue;
      }
      byTime.set(t, br);
      if (inferredWithoutHeader) importedWithoutHeaderCount++;
      successItems.push({
        sourceFile: file,
        lineNumber,
        reason: MERGE_REPORT_SUCCESS_REASON,
        dateStr: format(br.date, 'dd/MM/yyyy'),
        rawLine,
      });
    }
    if (inferredWithoutHeader && importedWithoutHeaderCount > 0) {
      importedWithoutDateHeaderCount += importedWithoutHeaderCount;
      anomalies.push({
        sourceFile: file,
        lineNumber: 0,
        reason: `${importedWithoutHeaderCount} ligne(s) importée(s) via détection automatique de la colonne date (sans en-tête DATE).`,
        rawLine: '',
      });
    }
  }

  const mergedRows = [...byTime.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  const csvOut = AccountBalanceCSVService.balanceRowsToCsv(mergedRows, accounts);
  const writeResult = await api.writeFile(`${dataDir}/${processedFileName}`, csvOut);
  const mergedNewCount = byTime.size - initialSize;
  if (!writeResult.success) {
    const integrated = mergedNewCount + (replaceDuplicateDates ? replacedCount : 0);
    return {
      success: false,
      mergedCount: mergedNewCount,
      anomalyCount: anomalies.length,
      importFileCount: importNames.length,
      importedWithoutDateHeaderCount,
      duplicateDateCount,
      replacedCount,
      totalImportDataRows,
      notMergedCount: Math.max(0, totalImportDataRows - integrated),
      notImportedRows: mapAnomaliesToNotImportedRows(anomalies),
      error: writeResult.error ?? 'Écriture src_account_balance.csv refusée.',
    };
  }

  AccountBalanceCSVService.invalidateCache();

  const reportHeader = 'fichier_source;ligne;raison;date;ligne_brute';
  const reportLines = [
    reportHeader,
    ...successItems.map(
      (s) =>
        `${escapeReportCell(s.sourceFile)};${s.lineNumber};${escapeReportCell(s.reason)};${escapeReportCell(s.dateStr)};${escapeReportCell(s.rawLine)}`
    ),
    ...anomalies.map(
      (a) =>
        `${escapeReportCell(a.sourceFile)};${a.lineNumber};${escapeReportCell(a.reason)};;${escapeReportCell(a.rawLine)}`
    ),
  ];
  await api.writeFile(ACCOUNT_BALANCE_MERGE_REPORT_PATH, reportLines.join('\n'));

  const mergedCount = mergedNewCount;
  const integratedCount = mergedCount + (replaceDuplicateDates ? replacedCount : 0);
  const notMergedCount = Math.max(0, totalImportDataRows - integratedCount);
  return {
    success: true,
    mergedCount,
    anomalyCount: anomalies.length,
    importFileCount: importNames.length,
    importedWithoutDateHeaderCount,
    duplicateDateCount: replaceDuplicateDates ? 0 : duplicateDateCount,
    replacedCount: replaceDuplicateDates ? replacedCount : 0,
    totalImportDataRows,
    notMergedCount,
    notImportedRows: mapAnomaliesToNotImportedRows(anomalies),
  };
}
