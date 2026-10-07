/**
 * Détection d’anomalies transactions / soldes — logique partagée main + renderer.
 * Les listes « reconnues » sont injectées (pas de localStorage ici).
 * Les raisons sont des codes stables ; le texte localisé est produit via un formateur.
 */

import { format, getDate, startOfDay } from 'date-fns';
import { EXCLUDE_ANOMALY_COLUMN } from './excludeAnomalyColumn';
import {
  getBalanceCodeForSettingsAccountName,
  resolveAccountHeaderToCode,
  type AccountFiatCurrency,
} from './accountBalanceCodes';
import {
  ANOMALY_REASON_CODES,
  anomalyReason,
  formatAnomalyReasonFr,
  formatAnomalyReasonsList,
  type AnomalyReason,
  type AnomalyReasonFormatter,
} from './anomalyReasons';

export type { AnomalyReason } from './anomalyReasons';

export interface SourceDataLike {
  headers: string[];
  rows: Record<string, string>[];
  /** Index 0-based dans le fichier source complet (si sous-ensemble). */
  rowIndicesInSource?: number[];
}

export interface TransactionAnomalyContext {
  recognisedAccountLabels: string[];
  recognisedEntryTypes: string[];
  recognisedOutputTypes: string[];
}

export interface AnomalyRow {
  row: Record<string, string>;
  rowIndex: number;
  reasons: AnomalyReason[];
}

export interface AnomalyResult {
  anomalies: AnomalyRow[];
  csvContent: string;
}

export interface AccountBalanceActiveAccount {
  name: string;
  currency: AccountFiatCurrency;
}

export interface AccountBalanceAnomalyRow {
  row: Record<string, string>;
  rowIndex: number;
  reasons: AnomalyReason[];
}

export interface AccountBalanceAnomalyResult {
  fileLevelReasons: AnomalyReason[];
  rowAnomalies: AccountBalanceAnomalyRow[];
  csvContent: string;
}

export type DetectAnomaliesFormatOptions = {
  formatReason?: AnomalyReasonFormatter;
};

const USUALLY_EMPTY_THRESHOLD = 0.9;
const USUALLY_FILLED_THRESHOLD = 0.1;

const KNOWN_EXPENSE_TYPES = new Set([
  'Rent', 'Council', 'Comm', 'Electricity', 'Water', 'SLCdebit', 'Transport', 'Fuel', 'Car',
  'Food', 'Restaurant', 'Shopping', 'Leisure', 'Holiday', 'LST', 'Misc', 'Health', 'Donation',
]);

const KNOWN_INCOME_TYPES = new Set([
  'Other Inc', 'Support', 'Refund', 'Benefit', 'SLCcredit',
]);

function isExcludedFromAnomalyDetection(row: Record<string, string>): boolean {
  const v = (row[EXCLUDE_ANOMALY_COLUMN] ?? '').trim().toLowerCase();
  return v === '1' || v === 'oui' || v === 'true' || v === 'yes';
}

function isAmountNonZero(value: string): boolean {
  const s = (value ?? '').trim().replace(',', '.');
  if (s === '') return false;
  const n = parseFloat(s);
  return !Number.isNaN(n) && n !== 0;
}

function parseDateToTime(s: string): number {
  const raw = (s ?? '').trim();
  if (!raw) return 0;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
  const mi = raw.match(iso);
  if (mi) {
    const y = parseInt(mi[1], 10);
    const m = parseInt(mi[2], 10);
    const d = parseInt(mi[3], 10);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  const md = raw.match(dmy);
  if (md) {
    const d = parseInt(md[1], 10);
    const m = parseInt(md[2], 10);
    const yy =
      md[3].length === 2
        ? parseInt(md[3], 10) < 50
          ? 2000 + parseInt(md[3], 10)
          : 1900 + parseInt(md[3], 10)
        : parseInt(md[3], 10);
    const date = new Date(yy, m - 1, d);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }
  return 0;
}

function findColumn(headers: string[], pattern: RegExp): string | null {
  return headers.find((x) => pattern.test(x)) ?? null;
}

function rowSignature(
  row: Record<string, string>,
  dateHeader: string | null,
  titleHeader: string | null,
  amountHeader: string | null,
  amountGbpHeader: string | null,
  accountHeader: string | null
): string {
  const d = (dateHeader ? (row[dateHeader] ?? '') : '').trim();
  const t = (titleHeader ? (row[titleHeader] ?? '') : '').trim();
  const amt = (amountHeader ? (row[amountHeader] ?? '') : '').trim();
  const amtGbp = (amountGbpHeader ? (row[amountGbpHeader] ?? '') : '').trim();
  const acc = (accountHeader ? (row[accountHeader] ?? '') : '').trim();
  return `${d}|${t}|${amt}|${amtGbp}|${acc}`;
}

/** Parse date soldes (JJ.MM.AA / JJ/MM/AAAA). */
export function parseBalanceDateInput(raw: string): Date | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (m[3].length === 2) year += year < 50 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  if (year < 1900 || year >= 2100) return null;
  return date;
}

/**
 * Détecte les lignes anormales et produit un rapport CSV (délimiteur ;) avec une colonne "Raison".
 */
export function detectAnomalies(
  data: SourceDataLike,
  context: TransactionAnomalyContext,
  formatOptions?: DetectAnomaliesFormatOptions
): AnomalyResult {
  const formatReason = formatOptions?.formatReason ?? formatAnomalyReasonFr;
  const { headers, rows, rowIndicesInSource } = data;
  const anomalies: AnomalyRow[] = [];
  const rowsToAnalyze: Record<string, string>[] = [];
  const originalRowIndexInSource: number[] = [];
  for (let idx = 0; idx < rows.length; idx++) {
    if (!isExcludedFromAnomalyDetection(rows[idx])) {
      rowsToAnalyze.push(rows[idx]);
      originalRowIndexInSource.push(rowIndicesInSource != null ? rowIndicesInSource[idx] : idx);
    }
  }
  if (rowsToAnalyze.length === 0) {
    return { anomalies: [], csvContent: '' };
  }

  const accountHeader = findColumn(headers, /^account$/i);
  const typeHeader = findColumn(headers, /^type$/i);
  const projetHeader = findColumn(headers, /^projet$/i);
  const soutienIgnoreHeader = findColumn(headers, /^soutien_ignorer$/i);
  const isExcludedFromEmptyFilledFrequency = (h: string): boolean =>
    (accountHeader !== null && h === accountHeader) ||
    (typeHeader !== null && h === typeHeader) ||
    (projetHeader !== null && h === projetHeader) ||
    (soutienIgnoreHeader !== null && h === soutienIgnoreHeader);

  const emptyRateByCol = new Map<string, number>();
  for (const h of headers) {
    const empty = rowsToAnalyze.filter((r) => (r[h] ?? '').trim() === '').length;
    emptyRateByCol.set(h, empty / rowsToAnalyze.length);
  }
  const usuallyEmptyCols = headers.filter(
    (h) =>
      !isExcludedFromEmptyFilledFrequency(h) && (emptyRateByCol.get(h) ?? 0) >= USUALLY_EMPTY_THRESHOLD
  );
  const usuallyFilledCols = headers.filter(
    (h) =>
      !isExcludedFromEmptyFilledFrequency(h) && (emptyRateByCol.get(h) ?? 0) <= USUALLY_FILLED_THRESHOLD
  );

  const knownAccounts = new Set(
    context.recognisedAccountLabels.map((l) => l.trim()).filter(Boolean)
  );
  const recognisedOutputTypes = context.recognisedOutputTypes ?? [];
  const recognisedEntryTypes = context.recognisedEntryTypes ?? [];
  const recognisedOutputTypesSet = new Set(recognisedOutputTypes);
  const recognisedEntryTypesSet = new Set(recognisedEntryTypes);
  const allKnownTypes = new Set<string>([
    ...KNOWN_EXPENSE_TYPES,
    ...KNOWN_INCOME_TYPES,
    ...recognisedOutputTypes,
    ...recognisedEntryTypes,
  ]);

  const dateHeader = findColumn(headers, /^date$/i);
  const dateTimes = dateHeader ? rowsToAnalyze.map((r) => parseDateToTime(r[dateHeader] ?? '')) : [];
  const titleHeader = findColumn(headers, /^title$/i);
  const amountHeader = findColumn(headers, /^amount$/i);
  const amountGbpHeader = findColumn(headers, /^amount\s*gbp$/i);
  const seenSignatures = new Set<string>();

  const parseAmount = (value: string): number => {
    const s = (value ?? '').trim().replace(',', '.');
    if (s === '') return 0;
    const n = parseFloat(s);
    return Number.isNaN(n) ? 0 : n;
  };

  for (let i = 0; i < rowsToAnalyze.length; i++) {
    const row = rowsToAnalyze[i];
    const reasons: AnomalyReason[] = [];

    for (const h of usuallyEmptyCols) {
      const val = (row[h] ?? '').trim();
      if (val !== '') {
        reasons.push(anomalyReason(ANOMALY_REASON_CODES.COLUMN_USUALLY_EMPTY, { column: h }));
      }
    }
    for (const h of usuallyFilledCols) {
      const val = (row[h] ?? '').trim();
      if (val === '') {
        reasons.push(anomalyReason(ANOMALY_REASON_CODES.COLUMN_USUALLY_FILLED_EMPTY, { column: h }));
      }
    }

    if (accountHeader) {
      const val = (row[accountHeader] ?? '').trim();
      if (val !== '' && !knownAccounts.has(val)) {
        reasons.push(anomalyReason(ANOMALY_REASON_CODES.UNKNOWN_ACCOUNT));
      }
    }

    if (typeHeader && amountGbpHeader) {
      const val = (row[typeHeader] ?? '').trim();
      const amount = parseAmount(row[amountGbpHeader] ?? '');
      if (val !== '' && !allKnownTypes.has(val)) {
        reasons.push(anomalyReason(ANOMALY_REASON_CODES.UNKNOWN_TYPE));
      }
      if (val !== '' && amount > 0) {
        if (KNOWN_EXPENSE_TYPES.has(val) || recognisedOutputTypesSet.has(val)) {
          reasons.push(anomalyReason(ANOMALY_REASON_CODES.EXPENSE_TYPE_WITH_INCOME));
        }
      }
      if (val !== '' && amount < 0) {
        if (KNOWN_INCOME_TYPES.has(val) || recognisedEntryTypesSet.has(val)) {
          reasons.push(anomalyReason(ANOMALY_REASON_CODES.INCOME_TYPE_WITH_EXPENSE));
        }
      }
    }

    if (amountGbpHeader && !isAmountNonZero(row[amountGbpHeader] ?? '')) {
      reasons.push(anomalyReason(ANOMALY_REASON_CODES.ZERO_AMOUNT));
    }

    if (dateHeader && i > 0 && dateTimes[i] > 0 && dateTimes[i - 1] > 0 && dateTimes[i] < dateTimes[i - 1]) {
      reasons.push(anomalyReason(ANOMALY_REASON_CODES.DATE_CHRONOLOGY));
    }

    const sig = rowSignature(row, dateHeader, titleHeader, amountHeader, amountGbpHeader, accountHeader);
    if (seenSignatures.has(sig)) {
      reasons.push(anomalyReason(ANOMALY_REASON_CODES.DUPLICATE_ROW));
    } else {
      seenSignatures.add(sig);
    }

    if (reasons.length > 0) {
      const sourceIndex1Based = originalRowIndexInSource[i] + 1;
      anomalies.push({ row, rowIndex: sourceIndex1Based, reasons });
    }
  }

  const headersAlreadyHaveIndex = headers.some((h) => /^index$/i.test(h));
  const reportHeaders = headersAlreadyHaveIndex ? [...headers, 'Raison'] : ['Index', ...headers, 'Raison'];
  const escapeCsv = (s: string) => {
    const t = (s ?? '').replace(/"/g, '""');
    return t.includes(';') || t.includes('"') || t.includes('\n') ? `"${t}"` : t;
  };
  const csvLines = [
    reportHeaders.map(escapeCsv).join(';'),
    ...anomalies.map((a) =>
      reportHeaders
        .map((h) => {
          if (/^index$/i.test(h)) return String(a.rowIndex);
          if (h === 'Raison') return formatAnomalyReasonsList(a.reasons, formatReason);
          return a.row[h] ?? '';
        })
        .map(escapeCsv)
        .join(';')
    ),
  ];

  return { anomalies, csvContent: csvLines.join('\n') };
}

function cellFiatMismatch(raw: string, expected: AccountFiatCurrency): boolean {
  const s = (raw ?? '').trim();
  if (s === '' || s === '-') return false;
  const hasEur = /€|EUR/i.test(s);
  const hasGbp = /£|GBP/i.test(s);
  const hasChf = /\bCHF\b/i.test(s);
  if (expected === 'EUR') return hasGbp || hasChf;
  if (expected === 'GBP') return hasEur || hasChf;
  if (expected === 'CHF') return hasEur || hasGbp;
  return false;
}

function activeNameForAccountCode(
  code: string,
  active: AccountBalanceActiveAccount[]
): { name: string; currency: AccountFiatCurrency } | undefined {
  for (const e of active) {
    if (getBalanceCodeForSettingsAccountName(e.name) === code) return e;
  }
  return undefined;
}

function getAccountBalanceDateCell(row: Record<string, string>, dateHeader: string): string {
  return (row[dateHeader] ?? row['DATE'] ?? row['Date'] ?? '').trim();
}

export function detectAccountBalanceAnomalies(
  headers: string[],
  rows: Record<string, string>[],
  activeAccounts: AccountBalanceActiveAccount[],
  formatOptions?: DetectAnomaliesFormatOptions
): AccountBalanceAnomalyResult {
  const formatReason = formatOptions?.formatReason ?? formatAnomalyReasonFr;
  const fileLevelReasons: AnomalyReason[] = [];
  const normHeaders = headers.map((h) => h?.replace(/^\uFEFF/, '').trim() ?? '');
  const dateHeader = normHeaders.find((h) => /^date$/i.test(h)) ?? 'DATE';

  const activeWithCode = activeAccounts.filter(
    (e) => e.name.trim() && getBalanceCodeForSettingsAccountName(e.name)
  );
  const expectedColCount = activeWithCode.length;
  const nonDateHeaders = normHeaders.filter((h) => h && !/^date$/i.test(h));

  if (nonDateHeaders.length !== expectedColCount) {
    fileLevelReasons.push(
      anomalyReason(ANOMALY_REASON_CODES.BALANCE_COLUMN_COUNT_MISMATCH, {
        actual: nonDateHeaders.length,
        expected: expectedColCount,
      })
    );
  }

  const activeCodes = new Set(
    activeWithCode
      .map((e) => getBalanceCodeForSettingsAccountName(e.name))
      .filter(Boolean) as string[]
  );

  for (const h of nonDateHeaders) {
    const code = resolveAccountHeaderToCode(h);
    if (!code) {
      fileLevelReasons.push(
        anomalyReason(ANOMALY_REASON_CODES.BALANCE_UNKNOWN_ACCOUNT_COLUMN, { column: h })
      );
      continue;
    }
    if (!activeCodes.has(code)) {
      fileLevelReasons.push(
        anomalyReason(ANOMALY_REASON_CODES.BALANCE_INACTIVE_ACCOUNT_COLUMN, { column: h })
      );
    }
  }

  const indicesByDateKey = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const raw = getAccountBalanceDateCell(rows[i], dateHeader);
    if (!raw) continue;
    const parsed = parseBalanceDateInput(raw);
    if (!parsed) continue;
    const k = format(startOfDay(parsed), 'yyyy-MM-dd');
    const list = indicesByDateKey.get(k) ?? [];
    list.push(i + 1);
    indicesByDateKey.set(k, list);
  }

  const rowIndicesWithDuplicateDate = new Set<number>();
  for (const indices of indicesByDateKey.values()) {
    if (indices.length > 1) {
      for (const idx of indices) rowIndicesWithDuplicateDate.add(idx);
    }
  }

  const rowAnomalies: AccountBalanceAnomalyRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const reasons: AnomalyReason[] = [];
    const rowIndex1 = i + 1;
    const dateRaw = getAccountBalanceDateCell(row, dateHeader);

    if (!dateRaw) {
      reasons.push(anomalyReason(ANOMALY_REASON_CODES.BALANCE_MISSING_DATE));
    } else {
      const parsed = parseBalanceDateInput(dateRaw);
      if (!parsed) {
        reasons.push(anomalyReason(ANOMALY_REASON_CODES.BALANCE_INVALID_DATE));
      } else {
        const day = getDate(startOfDay(parsed));
        if (day !== 1) {
          reasons.push(anomalyReason(ANOMALY_REASON_CODES.BALANCE_DATE_NOT_FIRST_OF_MONTH));
        }
      }
    }

    if (rowIndicesWithDuplicateDate.has(rowIndex1)) {
      reasons.push(anomalyReason(ANOMALY_REASON_CODES.BALANCE_DUPLICATE_DATE));
    }

    for (const h of nonDateHeaders) {
      const code = resolveAccountHeaderToCode(h);
      if (!code || !activeCodes.has(code)) continue;
      const entry = activeNameForAccountCode(code, activeWithCode);
      if (!entry) continue;
      const raw = row[h] ?? '';
      if (cellFiatMismatch(raw, entry.currency)) {
        reasons.push(
          anomalyReason(ANOMALY_REASON_CODES.BALANCE_WRONG_CURRENCY, {
            column: h,
            currency: entry.currency,
          })
        );
      }
    }

    if (reasons.length > 0) {
      rowAnomalies.push({ row, rowIndex: rowIndex1, reasons });
    }
  }

  const normHeadersAlreadyHaveIndex = normHeaders.some((h) => /^index$/i.test(h));
  const reportHeaders = normHeadersAlreadyHaveIndex
    ? [...normHeaders, 'Raison']
    : ['Index', ...normHeaders, 'Raison'];
  const escapeCsv = (s: string) => {
    const t = (s ?? '').replace(/"/g, '""');
    return t.includes(';') || t.includes('"') || t.includes('\n') ? `"${t}"` : t;
  };

  const fileBlock =
    fileLevelReasons.length > 0
      ? fileLevelReasons.map((r) =>
          reportHeaders
            .map((col) => {
              if (/^index$/i.test(col)) return '—';
              if (col === 'Raison') return formatReason(r);
              return '';
            })
            .map(escapeCsv)
            .join(';')
        )
      : [];

  const rowLines = rowAnomalies.map((a) =>
    reportHeaders
      .map((h) => {
        if (/^index$/i.test(h)) return String(a.rowIndex);
        if (h === 'Raison') return formatAnomalyReasonsList(a.reasons, formatReason);
        return a.row[h] ?? '';
      })
      .map(escapeCsv)
      .join(';')
  );

  const csvContent = [reportHeaders.map(escapeCsv).join(';'), ...fileBlock, ...rowLines].join('\n');

  return { fileLevelReasons, rowAnomalies, csvContent };
}
