/**
 * Régénère Support_data.csv depuis les lignes Support (miroir dérivé de support.db).
 */

import * as fs from 'fs';
import * as path from 'path';
import { SUPPORT_DATA_CSV_PATH } from '../../shared/dataPaths';
import { supportSourceHeaders } from '../../shared/sourceDataTypes';
import { getWorkingCurrenciesOrDefault } from './workingCurrenciesStore';

function csvEscape(cell: string): string {
  const s = cell ?? '';
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function writeSupportCsvMirror(dataRoot: string, rows: Record<string, string>[]): void {
  const fullPath = path.join(dataRoot, SUPPORT_DATA_CSV_PATH);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const primary = getWorkingCurrenciesOrDefault(dataRoot).primary || 'GBP';
  const headers = supportSourceHeaders(primary);
  const lines = [headers.join(';')];
  rows.forEach((row, i) => {
    const indexed: Record<string, string> = { ...row, Index: String(i + 1) };
    lines.push(headers.map((h) => csvEscape(String(indexed[h] ?? ''))).join(';'));
  });
  fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8');
}
