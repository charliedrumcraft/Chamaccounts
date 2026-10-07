/**
 * Détection d’anomalies côté main (SQLite / miroir) → payload slim + rapport optionnel.
 */

import * as fs from 'fs';
import * as path from 'path';
import Papa from 'papaparse';
import {
  ACCOUNT_BALANCE_ANOMALY_REPORT_PATH,
  ACCOUNT_BALANCE_CSV_PATH,
  ANOMALY_REPORT_PATH,
} from '../../shared/dataPaths';
import {
  formatAmountForFiat,
  getBalanceCodeForSettingsAccountName,
  type AccountFiatCurrency,
} from '../../shared/accountBalanceCodes';
import {
  detectAccountBalanceAnomalies,
  detectAnomalies,
  type TransactionAnomalyContext,
} from '../../shared/anomalyDetectionCore';
import { ANOMALY_REASON_CODES, anomalyReason } from '../../shared/anomalyReasons';
import type { DetectAnomaliesResultDto } from '../../shared/transactionQueryTypes';
import { getAllAsSourceData } from './transactionStore';
import { getAllBalanceRows } from './accountBalanceStore';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateDDMMYY(ms: number): string {
  const d = new Date(ms);
  const yy = String(d.getFullYear()).slice(-2);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${yy}`;
}

function writeAnomalyReportFile(dataRoot: string, relativePath: string, content: string): void {
  const fullPath = path.join(dataRoot, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content ?? '', 'utf-8');
}

function readAccountBalanceRawCsv(
  dataRoot: string
): { headers: string[]; rows: Record<string, string>[] } | null {
  const fullPath = path.join(dataRoot, ACCOUNT_BALANCE_CSV_PATH);
  if (!fs.existsSync(fullPath)) return null;
  const content = fs.readFileSync(fullPath, 'utf-8');
  const parsed = Papa.parse(content, {
    header: true,
    delimiter: ';',
    skipEmptyLines: true,
  });
  if (!parsed.data?.length) return null;
  return {
    headers: (parsed.meta.fields || []).map((f) => f?.replace(/^\uFEFF/, '').trim() ?? ''),
    rows: parsed.data as Record<string, string>[],
  };
}

async function reconstructBalanceCsvFromEav(
  dataRoot: string,
  activeAccounts: Array<{ name: string; currency: AccountFiatCurrency }>
): Promise<{ headers: string[]; rows: Record<string, string>[] } | null> {
  const balanceRows = await getAllBalanceRows(dataRoot);
  if (!balanceRows.length) return null;
  const ordered = activeAccounts
    .map((a) => ({ name: a.name.trim(), currency: a.currency }))
    .filter((a) => a.name && getBalanceCodeForSettingsAccountName(a.name));
  const headers = ['DATE', ...ordered.map((o) => o.name)];
  const rows = [...balanceRows]
    .sort((a, b) => a.dateMs - b.dateMs)
    .map((row) => {
      const o: Record<string, string> = { DATE: formatDateDDMMYY(row.dateMs) };
      for (const { name, currency } of ordered) {
        const code = getBalanceCodeForSettingsAccountName(name);
        const v = code ? row.balances[code] : undefined;
        o[name] =
          v !== undefined && Math.abs(v) >= 1e-9 ? formatAmountForFiat(v, currency) : '';
      }
      return o;
    });
  return { headers, rows };
}

export async function detectTransactionAnomaliesMain(
  dataRoot: string,
  context: TransactionAnomalyContext,
  writeReportFile = false
): Promise<DetectAnomaliesResultDto> {
  const data = await getAllAsSourceData(dataRoot);
  const { anomalies, csvContent } = detectAnomalies(data, context);
  if (writeReportFile) {
    writeAnomalyReportFile(dataRoot, ANOMALY_REPORT_PATH, csvContent);
  }
  return {
    anomalies: anomalies.map((a) => ({ rowIndex: a.rowIndex, reasons: a.reasons })),
    reportCsv: writeReportFile ? csvContent : undefined,
  };
}

export async function detectAccountBalanceAnomaliesMain(
  dataRoot: string,
  activeAccounts: Array<{ name: string; currency: AccountFiatCurrency }>,
  writeReportFile = false
): Promise<DetectAnomaliesResultDto & { fileLevelReasons: import('../../shared/anomalyReasons').AnomalyReason[] }> {
  let raw = readAccountBalanceRawCsv(dataRoot);
  if (!raw) {
    raw = await reconstructBalanceCsvFromEav(dataRoot, activeAccounts);
  }
  if (!raw) {
    const missing = anomalyReason(ANOMALY_REASON_CODES.BALANCE_FILE_MISSING);
    return { anomalies: [], fileLevelReasons: [missing] };
  }
  const { fileLevelReasons, rowAnomalies, csvContent } = detectAccountBalanceAnomalies(
    raw.headers,
    raw.rows,
    activeAccounts
  );
  if (writeReportFile) {
    writeAnomalyReportFile(dataRoot, ACCOUNT_BALANCE_ANOMALY_REPORT_PATH, csvContent);
  }
  const fileHits = fileLevelReasons.map((reason, i) => ({
    rowIndex: -(i + 1),
    reasons: [reason],
  }));
  return {
    anomalies: [
      ...fileHits,
      ...rowAnomalies.map((a) => ({ rowIndex: a.rowIndex, reasons: a.reasons })),
    ],
    fileLevelReasons,
    reportCsv: writeReportFile ? csvContent : undefined,
  };
}
