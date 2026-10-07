/**
 * Régénère src_account_balance.csv depuis les soldes EAV + liste comptes Paramètres.
 */

import * as fs from 'fs';
import * as path from 'path';
import { ACCOUNT_BALANCE_CSV_PATH } from '../../shared/dataPaths';
import {
  formatAmountForFiat,
  getBalanceCodeForSettingsAccountName,
  type BalanceAccountColumn,
  type BalanceRowDto,
} from '../../shared/accountBalanceCodes';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateDDMMYY(ms: number): string {
  const d = new Date(ms);
  const yy = String(d.getFullYear()).slice(-2);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${yy}`;
}

function csvEscape(cell: string): string {
  const s = cell ?? '';
  if (s.includes(';') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function writeAccountBalanceCsvMirror(
  dataRoot: string,
  rows: BalanceRowDto[],
  accounts: BalanceAccountColumn[]
): void {
  const fullPath = path.join(dataRoot, ACCOUNT_BALANCE_CSV_PATH);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });

  const ordered = accounts
    .map((a) => ({ name: a.name.trim(), currency: a.currency }))
    .filter((a) => a.name && getBalanceCodeForSettingsAccountName(a.name));

  const sorted = [...rows].sort((a, b) => a.dateMs - b.dateMs);
  const headers = ['DATE', ...ordered.map((o) => o.name)];
  const lines = [headers.join(';')];

  for (const row of sorted) {
    const cells = [formatDateDDMMYY(row.dateMs)];
    for (const { name, currency } of ordered) {
      const code = getBalanceCodeForSettingsAccountName(name);
      const v = code ? row.balances[code] : undefined;
      const cell =
        v !== undefined && Math.abs(v) >= 1e-9 ? formatAmountForFiat(v, currency) : '';
      cells.push(csvEscape(cell));
    }
    lines.push(cells.join(';'));
  }

  fs.writeFileSync(fullPath, lines.join('\n'), 'utf-8');
}
