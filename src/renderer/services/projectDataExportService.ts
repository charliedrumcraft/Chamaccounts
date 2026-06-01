import {
  SOURCE_DATA_PATH,
  SUPPORT_DATA_CSV_PATH,
  ACCOUNT_BALANCE_PROCESSED_DIR,
} from '@/shared/dataPaths';

const ACCOUNT_BALANCE_CSV = `${ACCOUNT_BALANCE_PROCESSED_DIR}/src_account_balance.csv`;

function countCsvDataRows(content: string | undefined): number {
  if (!content?.trim()) return 0;
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  return Math.max(0, lines.length - 1);
}

/** Vérifie que les CSV métier contiennent au moins une ligne de données avant export ZIP. */
export async function describeProjectCsvDataForExport(): Promise<{
  transactionRows: number;
  balanceRows: number;
  supportRows: number;
  emptyLabels: string[];
}> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.readFile) {
    return { transactionRows: 0, balanceRows: 0, supportRows: 0, emptyLabels: [] };
  }

  const [tx, balance, support] = await Promise.all([
    api.readFile(SOURCE_DATA_PATH),
    api.readFile(ACCOUNT_BALANCE_CSV),
    api.readFile(SUPPORT_DATA_CSV_PATH),
  ]);

  const transactionRows = tx.success ? countCsvDataRows(tx.data) : 0;
  const balanceRows = balance.success ? countCsvDataRows(balance.data) : 0;
  const supportRows = support.success ? countCsvDataRows(support.data) : 0;

  const emptyLabels: string[] = [];
  if (transactionRows === 0) emptyLabels.push('transactions (src_transaction_data.csv)');
  if (balanceRows === 0) emptyLabels.push('soldes (src_account_balance.csv)');
  if (supportRows === 0) emptyLabels.push('soutien (Support_data.csv)');

  return { transactionRows, balanceRows, supportRows, emptyLabels };
}
