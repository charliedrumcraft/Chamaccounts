/**
 * Import wizard Soutien : collage tableur → mapping DATE/TITLE/AMOUNT/CURRENCY/PROJET → Support_data.csv.
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
import {
  normalizeAmount,
  parseDateToTime,
  formatDateDDMMYY,
  TRANSACTION_PROJET_COLUMN,
} from '@/shared/transactionsImportCore';
import { parseAmountNumericForImport } from '@/shared/transactionsImportMappingPolicy';
import {
  normalizeSupportImportCurrency,
  stripCurrencyDecoratorsFromAmount,
  supportImportRowSignature,
  buildSupportExistingSignatures,
} from '@/shared/supportAnomalyDetection';
import {
  resolveProjectIdFromRaw,
  type ProjectEntry,
} from '../constants/projectsStorage';
import { SUPPORT_IMPORT_DIR, supportImportFile } from '@/shared/dataPaths';

export {
  normalizeSupportImportCurrency,
  supportImportRowSignature,
  buildSupportExistingSignatures,
};

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
export const SUPPORT_IMPORT_OUTPUT_FIELDS = [
  'DATE',
  'TITLE',
  'AMOUNT',
  'CURRENCY',
  TRANSACTION_PROJET_COLUMN,
] as const;
export type SupportImportOutputField = (typeof SUPPORT_IMPORT_OUTPUT_FIELDS)[number];

export type SupportImportDraft = {
  date: string;
  title: string;
  amount: string;
  currency: string;
  projet: string;
};

export type BuildSupportMappedDisplayOptions = {
  /** Projet par défaut du lot (appliqué si la cellule PROJET est vide après mapping / override). */
  defaultProjet?: string;
  /** Devise par défaut du lot (appliquée si CURRENCY vide après mapping / hint montant). */
  defaultCurrency?: string;
  /** Liste des projets pour résoudre un nom collé vers un id CSV. */
  projects?: ProjectEntry[];
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

/** Extrait une devise éventuelle collée dans le montant (ex. « 120 € »). */
function currencyHintFromAmount(amountRaw: string): string | null {
  return normalizeSupportImportCurrency(amountRaw);
}

/** Charge le modèle wizard depuis les CSV de SupportData/Import. */
export async function loadSupportImportWizardModel(
  api: {
    readDirectory: (p: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;
    readFile: (p: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  },
  parseOptions?: ImportWizardParseOptions
): Promise<ImportWizardModel | null> {
  const dirResult = await api.readDirectory(SUPPORT_IMPORT_DIR);
  if (!dirResult.success || !dirResult.data?.length) return null;

  const csvFiles = dirResult.data
    .filter((f) => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().startsWith('import_report'))
    .sort();
  if (csvFiles.length === 0) return null;

  let merged: ImportWizardModel | null = null;
  for (const file of csvFiles) {
    const read = await api.readFile(supportImportFile(file));
    if (!read.success || read.data === undefined) continue;
    const part = buildImportWizardModelFromFileContent(read.data, file, parseOptions);
    if (!part?.rows.length) continue;
    merged = merged ? mergeImportWizardModels(merged, part) : part;
  }
  return merged;
}

/** Construit un modèle wizard depuis un fichier (nom de source = nom de fichier). */
export function buildImportWizardModelFromFileContent(
  content: string,
  fileName: string,
  parseOptions?: ImportWizardParseOptions
): ImportWizardModel | null {
  const text = content.replace(/^\uFEFF/, '').trim();
  if (!text) return null;
  const safeName = (fileName || 'import.csv').replace(/[/\\]/g, '_').trim() || 'import.csv';
  // Réutilise le parseur collage, puis renomme la source virtuelle.
  const pasted = buildImportWizardModelFromClipboardText(text, parseOptions);
  if (!pasted?.rows.length) return null;
  const oldName = pasted.rows[0]?.sourceFile ?? '';
  return {
    ...pasted,
    defaultCurrency: pasted.defaultCurrency,
    columns: pasted.columns.map((c) =>
      c.fileName === oldName
        ? { ...c, fileName: safeName, key: `${safeName}#${c.colIndex}` }
        : c
    ),
    rows: pasted.rows.map((r) =>
      r.sourceFile === oldName ? { ...r, sourceFile: safeName, id: `${safeName}:${r.lineNumber}` } : r
    ),
  };
}

/** Retire un fichier / collage source du lot (colonnes + lignes). */
export function removeSourceFromImportWizardModel(
  model: ImportWizardModel,
  sourceFile: string
): ImportWizardModel | null {
  const columns = model.columns.filter((c) => c.fileName !== sourceFile);
  const rows = model.rows.filter((r) => r.sourceFile !== sourceFile);
  if (rows.length === 0) return null;
  return { columns, rows, defaultCurrency: model.defaultCurrency };
}

export function buildSupportMappedDisplay(
  row: ImportWizardRawRow,
  columns: ImportWizardColumn[],
  mapping: Record<string, WizardStandardKey>,
  rawOverrides: Record<string, string> | undefined,
  mappedOverrides: Record<string, string> | undefined,
  options?: BuildSupportMappedDisplayOptions
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
  }
  if (!display.CURRENCY.trim()) {
    const batchCur = normalizeSupportImportCurrency(options?.defaultCurrency ?? '');
    if (batchCur) display.CURRENCY = batchCur;
  } else {
    const norm = normalizeSupportImportCurrency(display.CURRENCY);
    if (norm) display.CURRENCY = norm;
  }

  // Normalise le montant affiché (espaces, milliers, parenthèses négatives, symbole devise).
  const amountClean = stripCurrencyDecoratorsFromAmount(display.AMOUNT ?? '');
  const amountNorm = normalizeAmount(amountClean);
  if (amountNorm !== null && amountNorm !== '') {
    display.AMOUNT = amountNorm;
  }

  const projetRaw = (display[TRANSACTION_PROJET_COLUMN] ?? '').trim();
  const defaultProjet = (options?.defaultProjet ?? '').trim();
  const projects = options?.projects ?? [];
  let projetId = '';
  if (projetRaw) {
    projetId = resolveProjectIdFromRaw(projects, projetRaw) || projetRaw;
  } else if (defaultProjet) {
    projetId = resolveProjectIdFromRaw(projects, defaultProjet) || defaultProjet;
  }
  display[TRANSACTION_PROJET_COLUMN] = projetId;

  return display;
}

export type ValidateSupportImportOptions = {
  projects?: ProjectEntry[];
  /** Si false, l’absence de projet n’est qu’un avertissement non bloquant (pas dans les erreurs). */
  requireProjet?: boolean;
};

export function validateSupportImportDisplay(
  display: Record<string, string>,
  projectsOrOptions?: ProjectEntry[] | ValidateSupportImportOptions
): string[] {
  const options: ValidateSupportImportOptions = Array.isArray(projectsOrOptions)
    ? { projects: projectsOrOptions, requireProjet: true }
    : { requireProjet: true, ...(projectsOrOptions ?? {}) };
  const projects = options.projects;
  const requireProjet = options.requireProjet !== false;

  const msgs: string[] = [];
  const date = (display.DATE ?? '').trim();
  const title = (display.TITLE ?? '').trim();
  const amountRaw = stripCurrencyDecoratorsFromAmount(display.AMOUNT ?? '');
  const currencyRaw = (display.CURRENCY ?? '').trim();
  const projetRaw = (display[TRANSACTION_PROJET_COLUMN] ?? '').trim();

  if (!date) msgs.push('Date manquante');
  else if (parseDateToTime(date) === 0) msgs.push('Date invalide');

  if (!title) msgs.push('Libellé (TITLE) manquant');

  if (!amountRaw) msgs.push('Montant manquant');
  else {
    const n = parseAmountNumericForImport(amountRaw);
    if (n === null) msgs.push('Montant non numérique');
    else if (n === 0) msgs.push('Montant invalide (nul ou non numérique)');
  }

  const cur = normalizeSupportImportCurrency(currencyRaw);
  if (!currencyRaw) msgs.push('Devise manquante (EUR, GBP ou CHF)');
  else if (!cur) msgs.push('Devise : EUR, GBP ou CHF');

  if (requireProjet) {
    if (!projetRaw) msgs.push('Projet manquant');
    else if (projects && projects.length > 0 && !resolveProjectIdFromRaw(projects, projetRaw)) {
      msgs.push('Projet inconnu — réassigner');
    }
  } else if (
    projetRaw &&
    projects &&
    projects.length > 0 &&
    !resolveProjectIdFromRaw(projects, projetRaw)
  ) {
    msgs.push('Projet inconnu — réassigner');
  }

  return msgs;
}

/**
 * Transforme l’aperçu mappé en brouillon prêt pour buildManualSupportRow / écriture CSV.
 * Retourne null si la ligne n’est pas importable.
 */
export function displayToSupportImportDraft(
  display: Record<string, string>,
  projectsOrOptions?: ProjectEntry[] | ValidateSupportImportOptions
): SupportImportDraft | null {
  const options: ValidateSupportImportOptions = Array.isArray(projectsOrOptions)
    ? { projects: projectsOrOptions, requireProjet: true }
    : { requireProjet: true, ...(projectsOrOptions ?? {}) };
  const projects = options.projects;

  if (validateSupportImportDisplay(display, options).length > 0) return null;

  const dateRaw = (display.DATE ?? '').trim();
  const dateNorm = formatDateDDMMYY(dateRaw);
  const title = (display.TITLE ?? '').trim();
  const amountClean = stripCurrencyDecoratorsFromAmount(display.AMOUNT ?? '');
  const amountNorm = normalizeAmount(amountClean);
  if (!amountNorm) return null;
  const amountNum = parseAmountNumericForImport(amountNorm);
  if (amountNum === null || amountNum === 0) return null;

  const currency = normalizeSupportImportCurrency(display.CURRENCY ?? '') ?? 'EUR';
  const projetRaw = (display[TRANSACTION_PROJET_COLUMN] ?? '').trim();
  const projet =
    (projects && projects.length > 0 ? resolveProjectIdFromRaw(projects, projetRaw) : '') || projetRaw;

  return {
    date: dateNorm || dateRaw,
    title,
    amount: String(amountNum).replace('.', ','),
    currency,
    projet,
  };
}
