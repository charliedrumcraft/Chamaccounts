/**
 * Détection d’anomalies pour l’import Soutien (wizard).
 * Signature de doublon : DATE|TITLE|AMOUNT|CURRENCY (projet exclu, comme TYPE côté transactions).
 */

import {
  formatDateDDMMYY,
  normalizeAmount,
  parseDateToTime,
  TRANSACTION_PROJET_COLUMN,
} from './transactionsImportCore';
import { parseAmountNumericForImport } from './transactionsImportMappingPolicy';
import {
  ANOMALY_REASON_CODES,
  anomalyReason,
  formatAnomalyReasonFr,
  formatAnomalyReasonsList,
  type AnomalyReason,
  type AnomalyReasonFormatter,
} from './anomalyReasons';

export type SupportAnomalyRow = {
  row: Record<string, string>;
  rowIndex: number;
  reasons: AnomalyReason[];
};

export type SupportAnomalyResult = {
  rowAnomalies: SupportAnomalyRow[];
  csvContent: string;
};

export type SupportAnomalyContext = {
  /** Signatures DATE|TITLE|AMOUNT|CURRENCY déjà présentes dans Support_data. */
  existingSignatures?: Set<string>;
  /**
   * Clés projet reconnues (id + libellés, déjà normalisées en trim).
   * Si omis, le projet n’est pas contrôlé.
   */
  knownProjectKeys?: Set<string>;
};

export type DetectSupportAnomaliesFormatOptions = {
  formatReason?: AnomalyReasonFormatter;
};

const USUALLY_EMPTY_THRESHOLD = 0.9;
const USUALLY_FILLED_THRESHOLD = 0.1;

const FREQUENCY_COLUMNS = ['DATE', 'TITLE', 'AMOUNT', 'CURRENCY', TRANSACTION_PROJET_COLUMN] as const;

export function normalizeSupportImportCurrency(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (upper === 'EUR' || upper === 'EURO' || upper === '€' || /€/.test(s) || /\bEUR\b/.test(upper)) {
    return 'EUR';
  }
  if (upper === 'GBP' || upper === '£' || /£/.test(s) || /\bGBP\b/.test(upper)) {
    return 'GBP';
  }
  if (upper === 'CHF' || /\bCHF\b/.test(upper)) {
    return 'CHF';
  }
  return null;
}

export function stripCurrencyDecoratorsFromAmount(amountRaw: string): string {
  return amountRaw
    .replace(/€|£|\bEUR\b|\bGBP\b|\bCHF\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Signature de doublon Soutien : DATE|TITLE|AMOUNT|CURRENCY.
 * Devise vide normalisée en EUR (alignée sur le brouillon d’import).
 */
export function supportImportRowSignature(fields: {
  date: string;
  title: string;
  amount: string;
  currency: string;
}): string {
  const dateRaw = (fields.date ?? '').trim();
  const d = formatDateDDMMYY(dateRaw) || dateRaw;
  const t = (fields.title ?? '').trim();
  const amtClean = stripCurrencyDecoratorsFromAmount(fields.amount ?? '');
  const amtNorm = normalizeAmount(amtClean);
  const amt = amtNorm !== null ? amtNorm : amtClean.trim();
  const cur =
    normalizeSupportImportCurrency(fields.currency ?? '') ??
    ((fields.currency ?? '').trim().toUpperCase() || 'EUR');
  return `${d}|${t}|${amt}|${cur}`;
}

/** Construit l’ensemble des signatures déjà présentes dans Support_data / lignes Support. */
export function buildSupportExistingSignatures(
  rows: Record<string, string>[],
  headers: {
    date: string | null | undefined;
    title: string | null | undefined;
    amount: string | null | undefined;
    currency?: string | null | undefined;
  }
): Set<string> {
  const set = new Set<string>();
  const dateH = headers.date ?? null;
  const titleH = headers.title ?? null;
  const amountH = headers.amount ?? null;
  const currencyH = headers.currency ?? null;
  if (!dateH || !titleH || !amountH) return set;
  for (const row of rows) {
    const date = row[dateH] ?? '';
    const title = row[titleH] ?? '';
    const amount = row[amountH] ?? '';
    const currency = currencyH ? (row[currencyH] ?? '') : '';
    if (!date.trim() && !title.trim() && !amount.trim()) continue;
    set.add(supportImportRowSignature({ date, title, amount, currency }));
  }
  return set;
}

function cell(row: Record<string, string>, key: string): string {
  return (row[key] ?? '').trim();
}

function isAmountNonZero(value: string): boolean {
  const clean = stripCurrencyDecoratorsFromAmount(value);
  const n = parseAmountNumericForImport(clean);
  return n !== null && n !== 0;
}

/**
 * Détecte les anomalies d’un lot d’import Soutien (lignes déjà mappées DATE/TITLE/…).
 */
export function detectSupportAnomalies(
  headers: string[],
  rows: Record<string, string>[],
  context: SupportAnomalyContext = {},
  formatOptions?: DetectSupportAnomaliesFormatOptions
): SupportAnomalyResult {
  const formatReason = formatOptions?.formatReason ?? formatAnomalyReasonFr;
  const existingSignatures = context.existingSignatures ?? new Set<string>();
  const knownProjectKeys = context.knownProjectKeys;

  const normHeaders = headers.map((h) => h?.replace(/^\uFEFF/, '').trim() ?? '').filter(Boolean);
  const analysisHeaders = FREQUENCY_COLUMNS.filter((h) =>
    normHeaders.some((x) => x.toUpperCase() === h.toUpperCase())
  );

  const emptyRateByCol = new Map<string, number>();
  for (const h of analysisHeaders) {
    if (rows.length === 0) {
      emptyRateByCol.set(h, 1);
      continue;
    }
    const empty = rows.filter((r) => cell(r, h) === '').length;
    emptyRateByCol.set(h, empty / rows.length);
  }
  const usuallyEmptyCols = analysisHeaders.filter(
    (h) => (emptyRateByCol.get(h) ?? 0) >= USUALLY_EMPTY_THRESHOLD
  );
  const usuallyFilledCols = analysisHeaders.filter(
    (h) => (emptyRateByCol.get(h) ?? 0) <= USUALLY_FILLED_THRESHOLD
  );

  const dateTimes = rows.map((r) => parseDateToTime(cell(r, 'DATE')));
  const seenInBatch = new Set<string>();
  const rowAnomalies: SupportAnomalyRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const reasons: AnomalyReason[] = [];

    for (const h of usuallyEmptyCols) {
      if (cell(row, h) !== '') {
        reasons.push(anomalyReason(ANOMALY_REASON_CODES.COLUMN_USUALLY_EMPTY, { column: h }));
      }
    }
    for (const h of usuallyFilledCols) {
      if (cell(row, h) === '') {
        reasons.push(anomalyReason(ANOMALY_REASON_CODES.COLUMN_USUALLY_FILLED_EMPTY, { column: h }));
      }
    }

    const amountRaw = cell(row, 'AMOUNT');
    if (amountRaw !== '' && !isAmountNonZero(amountRaw)) {
      reasons.push(anomalyReason(ANOMALY_REASON_CODES.ZERO_AMOUNT));
    }

    if (i > 0 && dateTimes[i] > 0 && dateTimes[i - 1] > 0 && dateTimes[i] < dateTimes[i - 1]) {
      reasons.push(anomalyReason(ANOMALY_REASON_CODES.DATE_CHRONOLOGY));
    }

    const sig = supportImportRowSignature({
      date: cell(row, 'DATE'),
      title: cell(row, 'TITLE'),
      amount: cell(row, 'AMOUNT'),
      currency: cell(row, 'CURRENCY'),
    });
    const hasIdentity = cell(row, 'DATE') !== '' || cell(row, 'TITLE') !== '' || amountRaw !== '';
    if (hasIdentity) {
      if (seenInBatch.has(sig)) {
        reasons.push(anomalyReason(ANOMALY_REASON_CODES.SUPPORT_DUPLICATE_IN_BATCH));
      } else {
        seenInBatch.add(sig);
      }
      if (existingSignatures.has(sig)) {
        reasons.push(anomalyReason(ANOMALY_REASON_CODES.SUPPORT_DUPLICATE_EXISTING));
      }
    }

    const projet = cell(row, TRANSACTION_PROJET_COLUMN);
    if (projet && knownProjectKeys && knownProjectKeys.size > 0 && !knownProjectKeys.has(projet)) {
      reasons.push(anomalyReason(ANOMALY_REASON_CODES.SUPPORT_UNKNOWN_PROJECT, { projet }));
    }

    if (reasons.length > 0) {
      rowAnomalies.push({ row, rowIndex: i + 1, reasons });
    }
  }

  const reportHeaders = normHeaders.some((h) => /^index$/i.test(h))
    ? [...normHeaders, 'Raison']
    : ['Index', ...normHeaders, 'Raison'];
  const escapeCsv = (s: string) => {
    const t = (s ?? '').replace(/"/g, '""');
    return t.includes(';') || t.includes('"') || t.includes('\n') ? `"${t}"` : t;
  };
  const csvContent = [
    reportHeaders.map(escapeCsv).join(';'),
    ...rowAnomalies.map((a) =>
      reportHeaders
        .map((h) => {
          if (/^index$/i.test(h)) return String(a.rowIndex);
          if (h === 'Raison') return formatAnomalyReasonsList(a.reasons, formatReason);
          return a.row[h] ?? '';
        })
        .map(escapeCsv)
        .join(';')
    ),
  ].join('\n');

  return { rowAnomalies, csvContent };
}
