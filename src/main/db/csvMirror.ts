/**
 * Régénère src_transaction_data.csv depuis les lignes ValidRow (miroir dérivé de SQLite).
 */

import * as fs from 'fs';
import * as path from 'path';
import { SOURCE_DATA_PATH } from '../../shared/dataPaths';
import { EXCLUDE_ANOMALY_COLUMN } from '../../shared/excludeAnomalyColumn';
import { SOUTIEN_IGNORE_COLUMN } from '../../shared/soutienIgnoreColumn';
import { amountIndicatorHeader } from '../../shared/workingCurrencies';
import {
  TRANSACTION_PROJET_COLUMN,
  type ValidRow,
} from '../../shared/transactionsImportCore';
import { getWorkingCurrenciesOrDefault } from './workingCurrenciesStore';

function outputHeaders(primary: string): string[] {
  return [
    'INDEX',
    'DATE',
    'TITLE',
    'AMOUNT',
    'CURRENCY',
    'ACCOUNT',
    amountIndicatorHeader(primary),
    'TYPE',
    TRANSACTION_PROJET_COLUMN,
    EXCLUDE_ANOMALY_COLUMN,
    SOUTIEN_IGNORE_COLUMN,
  ];
}

function rowToCsvLine(row: ValidRow, index: number): string {
  const values = [
    index,
    row.DATE,
    row.TITLE,
    row.AMOUNT,
    row.CURRENCY,
    row.ACCOUNT,
    row['AMOUNT GBP'] ?? '',
    row.TYPE,
    row[TRANSACTION_PROJET_COLUMN] ?? '',
    row[EXCLUDE_ANOMALY_COLUMN] ?? '',
    row[SOUTIEN_IGNORE_COLUMN] ?? '',
  ];
  return values
    .map((v) => {
      const s = String(v ?? '');
      if (s.includes(';') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(';');
}

/** Écrit le CSV miroir (INDEX 1…n) sous dataRoot. */
export function writeTransactionsCsvMirror(dataRoot: string, rows: ValidRow[]): void {
  const fullPath = path.join(dataRoot, SOURCE_DATA_PATH);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const primary = getWorkingCurrenciesOrDefault(dataRoot).primary || 'GBP';
  const lines = [outputHeaders(primary).join(';')];
  rows.forEach((row, i) => {
    lines.push(rowToCsvLine(row, i + 1));
  });
  fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8');
}
