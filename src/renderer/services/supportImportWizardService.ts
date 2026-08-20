/**
 * Import wizard Soutien : collage tableur → mapping DATE/TITLE/AMOUNT/CURRENCY → Support_data.csv.
 * Réutilise le parseur presse-papiers du mapping wizard transactions.
 */

import {
  buildImportWizardModelFromClipboardText,
  mergeImportWizardModels,
  buildDefaultColumnMapping,
  buildValueByStandardName,
  type ImportWizardModel,
  type ImportWizardColumn,
  type ImportWizardRawRow,
  type ImportWizardParseOptions,
  type WizardStandardKey,
  WIZARD_STANDARD_KEYS,
} from './mappingWizardService';
import { normalizeAmount, parseDateToTime, formatDateDDMMYY } from '@/shared/transactionsImportCore';

export {
  buildImportWizardModelFromClipboardText,
  mergeImportWizardModels,
  buildDefaultColumnMapping,
  WIZARD_STANDARD_KEYS,
};
export type {
  ImportWizardModel,
  ImportWizardColumn,
  ImportWizardRawRow,
  ImportWizardParseOptions,
  WizardStandardKey,
};

/** Colonnes éditables / mappables vers Support_data (TYPE et Source sont forcés à l’écriture). */
export const SUPPORT_IMPORT_OUTPUT_FIELDS = ['DATE', 'TITLE', 'AMOUNT', 'CURRENCY', 'ACCOUNT'] as const;
export type SupportImportOutputField = (typeof SUPPORT_IMPORT_OUTPUT_FIELDS)[number];

export type SupportImportDraft = {
  date: string;
  title: string;
  amount: string;
  currency: string;
  account: string;
};

/** Premières valeurs non vides d’une colonne (aperçu à côté du menu de mapping). */
export function supportWizardColumnSamplePreview(
  model: ImportWizardModel,
  col: ImportWizardColumn,
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

/** Extrait une devise éventuelle collée dans le montant (ex. « 120 € »). */
function currencyHintFromAmount(amountRaw: string): string | null {
  return normalizeSupportImportCurrency(amountRaw);
}

function stripCurrencyDecoratorsFromAmount(amountRaw: string): string {
  return amountRaw
    .replace(/€|£|\bEUR\b|\bGBP\b|\bCHF\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildSupportMappedDisplay(
  row: ImportWizardRawRow,
  columns: ImportWizardColumn[],
  mapping: Record<string, WizardStandardKey>,
  rawOverrides: Record<string, string> | undefined,
  mappedOverrides: Record<string, string> | undefined
): Record<string, string> {
  const values = row.values.slice();
  for (const col of columns) {
    if (col.fileName !== row.sourceFile) continue;
    const ov = rawOverrides?.[col.key];
    if (ov !== undefined) values[col.colIndex] = ov;
  }
  const effectiveRow: ImportWizardRawRow = { ...row, values };
  const byStd = buildValueByStandardName(effectiveRow, columns, mapping);

  const display: Record<string, string> = {};
  for (const field of SUPPORT_IMPORT_OUTPUT_FIELDS) {
    display[field] = (byStd[field] ?? '').trim();
  }

  if (mappedOverrides) {
    for (const field of SUPPORT_IMPORT_OUTPUT_FIELDS) {
      if (mappedOverrides[field] !== undefined) {
        display[field] = mappedOverrides[field]!;
      }
    }
  }

  if (!display.CURRENCY.trim()) {
    const hint = currencyHintFromAmount(display.AMOUNT);
    if (hint) display.CURRENCY = hint;
  } else {
    const norm = normalizeSupportImportCurrency(display.CURRENCY);
    if (norm) display.CURRENCY = norm;
  }

  return display;
}

export function validateSupportImportDisplay(display: Record<string, string>): string[] {
  const msgs: string[] = [];
  const date = (display.DATE ?? '').trim();
  const title = (display.TITLE ?? '').trim();
  const amountRaw = stripCurrencyDecoratorsFromAmount(display.AMOUNT ?? '');
  const currencyRaw = (display.CURRENCY ?? '').trim();

  if (!date) msgs.push('Date manquante');
  else if (parseDateToTime(date) === 0) msgs.push('Date invalide');

  if (!title) msgs.push('Libellé (TITLE) manquant');

  if (!amountRaw) msgs.push('Montant manquant');
  else if (normalizeAmount(amountRaw) === null) msgs.push('Montant non numérique');
  else {
    const n = parseFloat(amountRaw.replace(/\s/g, '').replace(',', '.'));
    if (Number.isNaN(n) || n === 0) msgs.push('Montant invalide (nul ou non numérique)');
  }

  const cur = normalizeSupportImportCurrency(currencyRaw);
  if (!currencyRaw) msgs.push('Devise manquante (EUR, GBP ou CHF)');
  else if (!cur) msgs.push('Devise : EUR, GBP ou CHF');

  return msgs;
}

/**
 * Transforme l’aperçu mappé en brouillon prêt pour buildManualSupportRow / écriture CSV.
 * Retourne null si la ligne n’est pas importable.
 */
export function displayToSupportImportDraft(display: Record<string, string>): SupportImportDraft | null {
  if (validateSupportImportDisplay(display).length > 0) return null;

  const dateRaw = (display.DATE ?? '').trim();
  const dateNorm = formatDateDDMMYY(dateRaw);
  const title = (display.TITLE ?? '').trim();
  const amountClean = stripCurrencyDecoratorsFromAmount(display.AMOUNT ?? '');
  const amountNorm = normalizeAmount(amountClean);
  if (!amountNorm) return null;
  const amountNum = parseFloat(amountNorm.replace(',', '.'));
  if (Number.isNaN(amountNum) || amountNum === 0) return null;

  const currency = normalizeSupportImportCurrency(display.CURRENCY ?? '') ?? 'EUR';
  const account = (display.ACCOUNT ?? '').trim();

  return {
    date: dateNorm || dateRaw,
    title,
    amount: String(amountNum).replace('.', ','),
    currency,
    account,
  };
}
