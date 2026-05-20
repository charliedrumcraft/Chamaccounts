/**
 * Chargement et transformation des CSV du dossier AccountBalanceData/Import
 * pour le mapping wizard (aperçu aligné sur src_account_balance.csv).
 */

import { ACCOUNT_BALANCE_IMPORT_DIR, accountBalanceImportFile } from '@/shared/dataPaths';
import { detectDelimiterForWizardFirstLine, normalizeHeader, parseCsvLine } from '@/shared/transactionsImportCore';
import { format, startOfDay } from 'date-fns';
import {
  AccountBalanceCSVService,
  getBalanceCodeForSettingsAccountName,
  formatAmountForFiat,
  type AccountFiatCurrency,
  type BalanceRow,
} from './AccountBalanceCSVService';
import type { RecognisedAccountEntry } from '../constants/recognisedAccountsStorage';

export interface AbImportWizardColumn {
  key: string;
  fileName: string;
  colIndex: number;
  label: string;
}

export interface AbImportWizardRawRow {
  id: string;
  sourceFile: string;
  lineNumber: number;
  rawLine: string;
  values: string[];
}

export interface AbImportWizardModel {
  columns: AbImportWizardColumn[];
  rows: AbImportWizardRawRow[];
}

export type AbImportWizardParseOptions = {
  /** Première ligne = donnée (pas d’en-tête) : libellés Col1…, toutes les lignes importées. */
  firstLineAsData?: boolean;
};

/**
 * Aperçu des premières valeurs non vides d’une colonne (UI attribution).
 */
export function abWizardColumnSamplePreview(
  model: AbImportWizardModel,
  col: AbImportWizardColumn,
  options?: { maxValues?: number; maxCellChars?: number; maxTotalChars?: number }
): string {
  const maxValues = options?.maxValues ?? 4;
  const maxCellChars = options?.maxCellChars ?? 20;
  const maxTotalChars = options?.maxTotalChars ?? 90;
  const parts: string[] = [];
  let extraNonEmpty = 0;
  for (const row of model.rows) {
    if (row.sourceFile !== col.fileName) continue;
    const raw = (row.values[col.colIndex] ?? '').trim();
    if (!raw) continue;
    if (parts.length < maxValues) {
      parts.push(raw.length > maxCellChars ? `${raw.slice(0, maxCellChars)}…` : raw);
    } else {
      extraNonEmpty += 1;
    }
  }
  if (parts.length === 0) return '—';
  let out = parts.join(' · ');
  if (extraNonEmpty > 0) out = `${out} …`;
  if (out.length > maxTotalChars) out = `${out.slice(0, maxTotalChars)}…`;
  return out;
}

/**
 * Indique si la première ligne est une ligne d’en-tête (soldes : DATE / noms de comptes reconnus).
 * Ne pas utiliser `firstLineLooksLikeHeader` (transactions) : il ignore les en-têtes CM, REV EUR, etc.
 */
export function firstLineLooksLikeAccountBalanceHeader(
  firstLineValues: string[],
  secondLineValues: string[] | null
): boolean {
  const cells = firstLineValues.map((v) => normalizeHeader(v));
  if (cells.length === 0 || cells.every((c) => c === '')) return false;

  const cellIsDateHeader = (c: string): boolean => {
    if (!c) return false;
    if (/^date$/i.test(c)) return true;
    if (/^date[\s_/(-]/i.test(c)) return true;
    return false;
  };

  const hasDateHeader = cells.some(cellIsDateHeader);
  const accountHeaderCount = cells.filter(
    (c) => c && AccountBalanceCSVService.resolveAccountHeaderToCode(c)
  ).length;

  const firstCell = cells[0] ?? '';
  const firstParsesAsBalanceDate =
    firstCell !== '' && AccountBalanceCSVService.parseBalanceDateInput(firstCell) !== null;

  if (hasDateHeader) return true;
  if (accountHeaderCount >= 2) return true;
  if (accountHeaderCount >= 1 && !firstParsesAsBalanceDate) return true;

  if (secondLineValues?.length) {
    const s0 = normalizeHeader(secondLineValues[0] ?? '');
    const secondFirstParses =
      s0 !== '' && AccountBalanceCSVService.parseBalanceDateInput(s0) !== null;
    if (!firstParsesAsBalanceDate && secondFirstParses && accountHeaderCount >= 1) {
      return true;
    }
  }

  return false;
}

function normalizeHeaderLocal(h: string | undefined): string {
  return String(h ?? '').replace(/^\uFEFF/, '').trim();
}

function detectDateColumn(
  headers: string[],
  records: Record<string, string>[]
): { key: string | null; inferredWithoutHeader: boolean } {
  const explicitDate = headers.find((h) => /^date$/i.test(normalizeHeaderLocal(h)));
  if (explicitDate) return { key: explicitDate, inferredWithoutHeader: false };

  let bestKey: string | null = null;
  let bestScore = 0;
  for (const h of headers) {
    const key = h;
    let score = 0;
    for (const row of records) {
      const raw = String(row[key] ?? '').trim();
      if (!raw) continue;
      if (AccountBalanceCSVService.parseBalanceDateInput(raw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  }
  if (!bestKey || bestScore === 0) return { key: null, inferredWithoutHeader: false };
  return { key: bestKey, inferredWithoutHeader: true };
}

function parseFileForWizard(
  content: string,
  fileName: string,
  delimiter: string,
  parseOptions?: AbImportWizardParseOptions
): AbImportWizardModel {
  const columns: AbImportWizardColumn[] = [];
  const rows: AbImportWizardRawRow[] = [];
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { columns, rows };

  const firstLineValues = parseCsvLine(lines[0], delimiter);
  const secondLineValues = lines.length >= 2 ? parseCsvLine(lines[1], delimiter) : null;
  let useFirstLineAsHeader: boolean;
  let dataStartIndex: number;
  if (parseOptions?.firstLineAsData) {
    useFirstLineAsHeader = false;
    dataStartIndex = 0;
  } else {
    useFirstLineAsHeader = firstLineLooksLikeAccountBalanceHeader(firstLineValues, secondLineValues);
    dataStartIndex = useFirstLineAsHeader ? 1 : 0;
  }

  let headerLabels: string[];
  if (useFirstLineAsHeader) {
    headerLabels = firstLineValues.map((h, i) => normalizeHeader(h) || `Col${i + 1}`);
  } else {
    const dataLines = lines.map((line) => parseCsvLine(line, delimiter));
    const colCount = Math.max(0, ...dataLines.map((r) => r.length));
    headerLabels = Array.from({ length: colCount }, (_, i) => `Col${i + 1}`);
  }

  for (let c = 0; c < headerLabels.length; c++) {
    columns.push({
      key: `${fileName}#${c}`,
      fileName,
      colIndex: c,
      label: headerLabels[c],
    });
  }

  let rowCounter = 0;
  for (let i = dataStartIndex; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;
    const values = parseCsvLine(rawLine, delimiter);
    const dataLineNumber = i - dataStartIndex + 1;
    rows.push({
      id: `${fileName}:${i + 1}:${rowCounter++}`,
      sourceFile: fileName,
      lineNumber: dataLineNumber,
      rawLine,
      values,
    });
  }

  return { columns, rows };
}

export function mergeAbImportWizardModels(a: AbImportWizardModel, b: AbImportWizardModel): AbImportWizardModel {
  return {
    columns: [...a.columns, ...b.columns],
    rows: [...a.rows, ...b.rows],
  };
}

/**
 * Modèle wizard soldes à partir d’un collage (TSV ou CSV), même logique que les fichiers du dossier Import.
 */
export function buildAbImportWizardModelFromClipboardText(
  raw: string,
  parseOptions?: AbImportWizardParseOptions
): AbImportWizardModel | null {
  const content = raw.replace(/^\uFEFF/, '').trim();
  if (!content) return null;
  const firstLine = content.split(/\r?\n/)[0] ?? '';
  const delim = detectDelimiterForWizardFirstLine(firstLine);
  const virtualName = `Presse-papiers_${Date.now()}.txt`;
  const model = parseFileForWizard(content, virtualName, delim, parseOptions);
  return model.rows.length > 0 ? model : null;
}

export async function loadAccountBalanceImportWizardModel(
  api: {
    readDirectory: (p: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;
    readFile: (p: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  },
  parseOptions?: AbImportWizardParseOptions
): Promise<AbImportWizardModel | null> {
  const dirResult = await api.readDirectory(ACCOUNT_BALANCE_IMPORT_DIR);
  if (!dirResult.success || !dirResult.data?.length) return null;

  const csvFiles = dirResult.data
    .filter((f) => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().startsWith('import_report'))
    .sort();

  if (csvFiles.length === 0) return null;

  const allColumns: AbImportWizardColumn[] = [];
  const allRows: AbImportWizardRawRow[] = [];

  for (const file of csvFiles) {
    const relPath = accountBalanceImportFile(file);
    const read = await api.readFile(relPath);
    if (!read.success || read.data === undefined) continue;
    const firstLine = read.data.split(/\r?\n/)[0] ?? '';
    const delim = detectDelimiterForWizardFirstLine(firstLine);
    const { columns, rows } = parseFileForWizard(read.data, file, delim, parseOptions);
    allColumns.push(...columns);
    allRows.push(...rows);
  }

  if (allRows.length === 0) return null;

  return { columns: allColumns, rows: allRows };
}

export function buildImportRecordFromRawRow(
  row: AbImportWizardRawRow,
  columns: AbImportWizardColumn[],
  rawCellOverrides: Record<string, Record<string, string>>,
  /** Cible d’en-tête (DATE, nom de compte Paramètres…) par clé de colonne ; '' = ignorer la colonne. */
  columnTargetByColKey?: Record<string, string>
): Record<string, string> {
  const rec: Record<string, string> = {};
  const fileCols = columns.filter((c) => c.fileName === row.sourceFile).sort((a, b) => a.colIndex - b.colIndex);
  for (const col of fileCols) {
    const mapped = columnTargetByColKey?.[col.key];
    if (mapped === '') continue;
    const headerKey = mapped !== undefined && mapped !== '' ? mapped : col.label;
    const raw = row.values[col.colIndex] ?? '';
    const ov = rawCellOverrides[row.id]?.[col.key];
    const val = ov !== undefined ? ov : raw;
    const prev = rec[headerKey];
    rec[headerKey] =
      prev !== undefined && String(prev).trim() !== '' ? `${String(prev).trim()} ${val}`.trim() : val;
  }
  return rec;
}

export function balanceRowFromImportRecord(record: Record<string, string>): BalanceRow | null {
  const headers = Object.keys(record);
  if (headers.length === 0) return null;
  const { key: dateKey } = detectDateColumn(headers, [record]);
  if (!dateKey) return null;
  const rawDate = String(record[dateKey] ?? '').trim();
  const parsedDate = AccountBalanceCSVService.parseBalanceDateInput(rawDate);
  if (!parsedDate) return null;

  const balances: Record<string, number> = {};
  for (const header of headers) {
    if (!header || header === dateKey) continue;
    const code = AccountBalanceCSVService.resolveAccountHeaderToCode(header);
    if (!code) continue;
    const rawValue = record[header];
    const amount = AccountBalanceCSVService.parseBalanceAmount(rawValue);
    if (amount !== 0 || String(rawValue ?? '').trim() !== '') {
      balances[code] = (balances[code] ?? 0) + amount;
    }
  }
  if (Object.keys(balances).length === 0) return null;
  return { date: startOfDay(parsedDate), balances };
}

export function orderedAccountEntries(accounts: RecognisedAccountEntry[]): {
  name: string;
  currency: AccountFiatCurrency;
}[] {
  return accounts
    .map((a) => ({ name: a.name.trim(), currency: a.currency }))
    .filter((a) => a.name && getBalanceCodeForSettingsAccountName(a.name));
}

export function formatBalanceRowForWizardDisplay(
  br: BalanceRow,
  accounts: RecognisedAccountEntry[]
): Record<string, string> {
  const ordered = orderedAccountEntries(accounts);
  const o: Record<string, string> = { DATE: format(br.date, 'dd.MM.yy') };
  for (const { name, currency } of ordered) {
    const code = getBalanceCodeForSettingsAccountName(name);
    const v = code ? br.balances[code] : undefined;
    o[name] = v !== undefined && Math.abs(v) >= 1e-9 ? formatAmountForFiat(v, currency) : '';
  }
  return o;
}

export function balanceRowFromMappedDisplayRecord(
  rec: Record<string, string>,
  accounts: RecognisedAccountEntry[]
): BalanceRow | null {
  const d = AccountBalanceCSVService.parseBalanceDateInput((rec.DATE ?? '').trim());
  if (!d) return null;
  const balances: Record<string, number> = {};
  for (const e of orderedAccountEntries(accounts)) {
    const code = getBalanceCodeForSettingsAccountName(e.name);
    if (!code) continue;
    const raw = rec[e.name] ?? '';
    const n = AccountBalanceCSVService.parseBalanceAmount(raw);
    if (String(raw).trim() !== '' && Math.abs(n) >= 1e-9) balances[code] = n;
  }
  if (Object.keys(balances).length === 0) return null;
  return { date: startOfDay(d), balances };
}

export function rawRowQuickWarnings(record: Record<string, string>): string[] {
  const msgs: string[] = [];
  const headers = Object.keys(record);
  const { key: dateKey } = detectDateColumn(headers, [record]);
  if (!dateKey || !String(record[dateKey] ?? '').trim()) {
    msgs.push('Date manquante ou colonne date non détectée.');
  } else if (!AccountBalanceCSVService.parseBalanceDateInput(String(record[dateKey]))) {
    msgs.push('Date invalide ou illisible.');
  }
  const br = balanceRowFromImportRecord(record);
  if (!br && msgs.length === 0) msgs.push('Aucun solde de compte reconnu sur cette ligne.');
  return msgs;
}
