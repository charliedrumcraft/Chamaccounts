/**
 * Politique d'import « mapping wizard » : point d'entrée unique côté renderer pour la fusion
 * des données importées avec le schéma src_transaction_data.csv
 * (chargement CSV, mapping colonnes, validation, prévisualisation, doublons).
 *
 * Les primitives partagées avec le processus principal (parse, signatures, en-têtes) sont dans
 * @/shared/transactionsImportCore ; l'écriture du fichier traité passe par le bridge Electron.
 */

import { TRANSACTIONS_IMPORT_DIR, transactionsImportFile } from '@/shared/dataPaths';
import {
  detectDelimiterForWizardFirstLine,
  firstLineLooksLikeHeader,
  inferColumnMappingFromDataLines,
  normalizeHeader,
  parseCsvLine,
  parseDateToTime,
  type WizardStandardKey,
  WIZARD_STANDARD_KEYS,
  processImportRow,
  rowSignature,
  type ValidRow,
} from '@/shared/transactionsImportCore';
import { getEffectiveRates } from './EffectiveExchangeRates';
import {
  applyGbpFromAmountAndFiatWithRates,
  applyImportFiatResolutionToValueMap,
  applyValidRowPostProcessMappingPolicy,
  parseAmountNumericForImport as parseAmountNumericForImportShared,
  resolveImportFiatEffective as resolveImportFiatEffectiveShared,
  type ImportMappingRates,
} from '@/shared/transactionsImportMappingPolicy';

export { WIZARD_STANDARD_KEYS };
export type { WizardStandardKey };
export type { ImportFiatCurrency } from '@/shared/transactionsImportMappingPolicy';

// --- Modèle : colonnes sources et lignes brutes ---

export interface ImportWizardColumn {
  /** Identifiant stable : `${fileName}#${colIndex}` */
  key: string;
  fileName: string;
  colIndex: number;
  label: string;
  suggestedStandard: WizardStandardKey;
}

export interface ImportWizardRawRow {
  id: string;
  sourceFile: string;
  lineNumber: number;
  rawLine: string;
  values: string[];
}

export interface ImportWizardModel {
  columns: ImportWizardColumn[];
  rows: ImportWizardRawRow[];
}

/** Options de lecture CSV / collage (première ligne). */
export type ImportWizardParseOptions = {
  /**
   * Si vrai : aucune ligne n’est traitée comme en-tête ; la première ligne est une donnée.
   * Les libellés de colonnes deviennent Col1… et le mapping standard est inféré sur toutes les lignes.
   */
  firstLineAsData?: boolean;
};

function parseFileForWizard(
  content: string,
  fileName: string,
  delimiter: string,
  parseOptions?: ImportWizardParseOptions
): ImportWizardModel {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== '');
  const columns: ImportWizardColumn[] = [];
  const rows: ImportWizardRawRow[] = [];

  if (lines.length === 0) return { columns, rows };

  const firstLineValues = parseCsvLine(lines[0], delimiter);
  let useFirstLineAsHeader: boolean;
  let dataStartIndex: number;
  if (parseOptions?.firstLineAsData) {
    useFirstLineAsHeader = false;
    dataStartIndex = 0;
  } else {
    const autoHeader = firstLineLooksLikeHeader(firstLineValues);
    dataStartIndex = autoHeader && lines.length >= 2 ? 1 : 0;
    useFirstLineAsHeader = autoHeader && lines.length >= 2;
  }

  let headerLabels: string[];
  if (useFirstLineAsHeader) {
    headerLabels = firstLineValues.map((h, i) => normalizeHeader(h) || `Col${i + 1}`);
  } else {
    const dataLines = lines.map((line) => parseCsvLine(line, delimiter));
    const colCount = Math.max(0, ...dataLines.map((r) => r.length));
    headerLabels = Array.from({ length: colCount }, (_, i) => `Col${i + 1}`);
  }

  const colToStandardName = inferColumnMappingFromDataLines(lines, delimiter, dataStartIndex);

  for (let c = 0; c < headerLabels.length; c++) {
    columns.push({
      key: `${fileName}#${c}`,
      fileName,
      colIndex: c,
      label: headerLabels[c],
      suggestedStandard: (colToStandardName.get(c) ?? '') as WizardStandardKey,
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

/** Fusionne deux modèles (ex. CSV dossier Import + collage presse-papiers). */
export function mergeImportWizardModels(a: ImportWizardModel, b: ImportWizardModel): ImportWizardModel {
  return {
    columns: [...a.columns, ...b.columns],
    rows: [...a.rows, ...b.rows],
  };
}

/**
 * Construit un modèle wizard à partir d’un texte collé (TSV tableur, ou CSV virgule / point-virgule).
 * Le nom de fichier virtuel est unique pour éviter les collisions de clés de colonnes.
 */
export function buildImportWizardModelFromClipboardText(
  raw: string,
  parseOptions?: ImportWizardParseOptions
): ImportWizardModel | null {
  const content = raw.replace(/^\uFEFF/, '').trim();
  if (!content) return null;
  const firstLine = content.split(/\r?\n/)[0] ?? '';
  const delim = detectDelimiterForWizardFirstLine(firstLine);
  const virtualName = `Presse-papiers_${Date.now()}.txt`;
  const model = parseFileForWizard(content, virtualName, delim, parseOptions);
  return model.rows.length > 0 ? model : null;
}

export function buildDefaultColumnMapping(columns: ImportWizardColumn[]): Record<string, WizardStandardKey> {
  const m: Record<string, WizardStandardKey> = {};
  for (const c of columns) {
    m[c.key] = c.suggestedStandard;
  }
  return m;
}

export function buildValueByStandardName(
  row: ImportWizardRawRow,
  columns: ImportWizardColumn[],
  mapping: Record<string, WizardStandardKey>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const col of columns) {
    if (col.fileName !== row.sourceFile) continue;
    const std = mapping[col.key];
    if (!std) continue;
    const val = (row.values[col.colIndex] ?? '').trim();
    const prev = out[std];
    out[std] = prev ? `${prev} ${val}`.trim() : val;
  }
  return out;
}

export async function loadImportWizardModel(
  api: {
    readDirectory: (p: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;
    readFile: (p: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  },
  parseOptions?: ImportWizardParseOptions
): Promise<ImportWizardModel | null> {
  const dirResult = await api.readDirectory(TRANSACTIONS_IMPORT_DIR);
  if (!dirResult.success || !dirResult.data?.length) return null;

  const csvFiles = dirResult.data
    .filter((f) => f.toLowerCase().endsWith('.csv') && !f.toLowerCase().startsWith('import_report'))
    .sort();

  if (csvFiles.length === 0) return null;

  const allColumns: ImportWizardColumn[] = [];
  const allRows: ImportWizardRawRow[] = [];

  for (const file of csvFiles) {
    const relPath = transactionsImportFile(file);
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

// --- Prévisualisation, table de préparation, filtres d’import ---

/** Champs normalisés affichés dans la prévisualisation (alignés sur src_transaction_data.csv, hors INDEX / anomalie). */
export const IMPORT_WIZARD_RESULT_FIELDS = [
  'DATE',
  'TITLE',
  'AMOUNT',
  'CURRENCY',
  'ACCOUNT',
  'AMOUNT GBP',
  'TYPE',
] as const;

export type ImportWizardResultField = (typeof IMPORT_WIZARD_RESULT_FIELDS)[number];

export const PREP_COL_IGN = '__prep_ign__' as const;
export const PREP_COL_LINE = '__prep_line__' as const;
export const PREP_COL_DUP = '__prep_dup__' as const;

export const PREP_WIZARD_COL_KEY = (field: ImportWizardResultField) => `__wizard_col__${field}`;

/** Suffixe clé colonne « sortie src_transaction_data » jumelée à une colonne source. */
export const PREP_SRC_MAPPED_FIELD_SUFFIX = '__out';

/**
 * Clé synthétique pour une seule colonne éditable « AMOUNT GBP » quand plusieurs colonnes
 * brutes sont mappées en INCOME / EXPENSE (même champ côté src_transaction_data).
 */
export const PREP_AMT_GBP_COMBINED_SRC_KEY = '__prep_amt_gbp_income_expense__';
export const PREP_AMT_GBP_COMBINED_FIELD_KEY =
  `${PREP_AMT_GBP_COMBINED_SRC_KEY}${PREP_SRC_MAPPED_FIELD_SUFFIX}`;

export type PrepTableColDef =
  | { kind: 'ign'; key: typeof PREP_COL_IGN }
  | { kind: 'line'; key: typeof PREP_COL_LINE }
  | { kind: 'dup'; key: typeof PREP_COL_DUP }
  | { kind: 'wizard'; key: string; field: ImportWizardResultField }
  | { kind: 'source'; key: string; col: ImportWizardColumn }
  | {
      kind: 'srcMappedField';
      key: string;
      sourceColKey: string;
      mappedAs: WizardStandardKey;
    };

/** Nom de colonne dans src_transaction_data.csv pour une clé de mapping source. */
export function srcTransactionDataColumnTitle(mappedAs: WizardStandardKey): string {
  if (mappedAs === 'EXPENSE' || mappedAs === 'INCOME') return 'AMOUNT GBP';
  return mappedAs || '';
}

/** Clé ValidRow / src_transaction_data pour une colonne source mappée. */
export function outputFieldKeyForMappedSource(mappedAs: WizardStandardKey): keyof ValidRow | null {
  const m = mappedAs as string;
  if (!m) return null;
  if (mappedAs === 'EXPENSE' || mappedAs === 'INCOME') return 'AMOUNT GBP';
  const allowed: (keyof ValidRow)[] = [
    'DATE',
    'TITLE',
    'AMOUNT',
    'CURRENCY',
    'ACCOUNT',
    'AMOUNT GBP',
    'TYPE',
  ];
  if (allowed.includes(mappedAs as keyof ValidRow)) return mappedAs as keyof ValidRow;
  return null;
}

/** Valeur affichée dans la colonne jumelle « src_transaction_data » (ligne de prévisualisation). */
export function getSrcMappedFieldDisplayValue(
  p: ImportWizardPreviewItem,
  mappedAs: WizardStandardKey
): string {
  const field = outputFieldKeyForMappedSource(mappedAs);
  if (!field) return '';
  if ('valid' in p.processed) {
    return String((p.processed.valid as unknown as Record<string, string>)[field] ?? '');
  }
  const vm = p.valueMap;
  if (field === 'AMOUNT GBP') {
    return (vm['AMOUNT GBP'] ?? vm.EXPENSE ?? vm.INCOME ?? '').trim();
  }
  return String(vm[field as string] ?? '').trim();
}

/**
 * Valeur du champ éditable « colonne src » : priorité à la saisie utilisateur (override) pour ne pas
 * remplacer par la version normalisée du pipeline tant qu’un override existe.
 */
export function getSrcMappedFieldInputValue(
  rowId: string,
  mappedAs: WizardStandardKey,
  p: ImportWizardPreviewItem,
  importMappedOutputOverrides: Record<string, Partial<Record<ImportWizardResultField, string>>>
): string {
  const field = outputFieldKeyForMappedSource(mappedAs);
  if (!field) return '';
  const resultField = field as ImportWizardResultField;
  const ov = importMappedOutputOverrides[rowId]?.[resultField];
  if (ov !== undefined) return ov;
  return getSrcMappedFieldDisplayValue(p, mappedAs);
}

/**
 * Indique si la valeur affichée dans la colonne jumelle « src » est identique (après trim) à la cellule
 * brute correspondante du CSV. Une saisie dans la jumelle qui recopie la même chaîne que le brut est
 * donc marquée aussi. Les cas avec normalisation pipeline (date, montants, devise, Revolut, etc.)
 * ne coïncident pas avec le brut et ne sont pas marqués.
 */
export function isImportWizardSrcMappedFieldDirectRawMatch(
  p: ImportWizardPreviewItem,
  def: Extract<PrepTableColDef, { kind: 'srcMappedField' }>,
  columns: ImportWizardColumn[],
  importColumnMapping: Record<string, WizardStandardKey>,
  /** Si fourni (ex. saisie utilisateur prioritaire), utilisé à la place de la valeur pipeline affichée. */
  inputDisplayTrimmed?: string
): boolean {
  const display = (inputDisplayTrimmed ?? getSrcMappedFieldDisplayValue(p, def.mappedAs)).trim();

  if (def.sourceColKey === PREP_AMT_GBP_COMBINED_SRC_KEY) {
    let expenseRaw = '';
    let incomeRaw = '';
    for (const col of columns) {
      if (col.fileName !== p.row.sourceFile) continue;
      const m = importColumnMapping[col.key];
      if (m === 'EXPENSE') expenseRaw = (p.row.values[col.colIndex] ?? '').trim();
      if (m === 'INCOME') incomeRaw = (p.row.values[col.colIndex] ?? '').trim();
    }
    if (display === '') return false;
    return display === expenseRaw || display === incomeRaw;
  }

  const col = columns.find((c) => c.key === def.sourceColKey);
  if (!col || col.fileName !== p.row.sourceFile) return false;
  const raw = (p.row.values[col.colIndex] ?? '').trim();
  if (raw === '') return false;
  return display === raw;
}

export function prepTableColLabel(def: PrepTableColDef): string {
  switch (def.kind) {
    case 'ign':
      return 'Ign.';
    case 'line':
      return 'L.';
    case 'dup':
      return 'Status';
    case 'wizard':
      return `${def.field} (Mapping wizard)`;
    case 'source':
      return def.col.label;
    case 'srcMappedField':
      return srcTransactionDataColumnTitle(def.mappedAs);
  }
}

export const parseAmountNumericForImport = parseAmountNumericForImportShared;

/** Recalcule AMOUNT GBP à partir d’AMOUNT et de la devise (taux Paramètres — même politique que le merge principal). */
export function applyGbpFromAmountAndFiat(amountStr: string, fiat: string): string {
  return applyGbpFromAmountAndFiatWithRates(amountStr, fiat, getEffectiveRates());
}

/** Devise effective pour une ligne (choix utilisateur, sinon détection, sinon colonne CURRENCY mappée). */
export const resolveImportFiatEffective = resolveImportFiatEffectiveShared;

export type ImportWizardPreviewItem = {
  row: ImportWizardRawRow;
  valueMap: Record<string, string>;
  processed: ReturnType<typeof processImportRow>;
  duplicateExisting: boolean;
};

export type ImportWizardPreviewResult = {
  list: ImportWizardPreviewItem[];
  validCount: number;
};

export type ImportWizardPreviewComputeParams = {
  model: ImportWizardModel;
  importColumnMapping: Record<string, WizardStandardKey>;
  existingTransactionSignatures: Set<string>;
  importWizardCellOverrides: Record<string, Record<string, string>>;
  importWizardManualCellValues: Record<string, Partial<Record<ImportWizardResultField, string>>>;
  /** Saisie directe des champs src_transaction_data (colonnes jumelles éditables). */
  importMappedOutputOverrides?: Record<string, Partial<Record<ImportWizardResultField, string>>>;
};

function computeSingleImportWizardPreviewItem(
  row: ImportWizardRawRow,
  params: ImportWizardPreviewComputeParams,
  rates: ImportMappingRates
): ImportWizardPreviewItem {
  const {
    model,
    importColumnMapping,
    existingTransactionSignatures,
    importWizardCellOverrides,
    importWizardManualCellValues,
    importMappedOutputOverrides = {},
  } = params;
  const { columns } = model;
  const values = row.values.slice();
  for (const col of columns) {
    if (col.fileName !== row.sourceFile) continue;
    const ov = importWizardCellOverrides[row.id]?.[col.key];
    if (ov !== undefined) values[col.colIndex] = ov;
  }
  const effectiveRow: ImportWizardRawRow = { ...row, values };
  const base = buildValueByStandardName(effectiveRow, columns, importColumnMapping);
  const valueMap: Record<string, string> = { ...base };
  const manualRow = importWizardManualCellValues[row.id];
  if (manualRow) {
    for (const field of IMPORT_WIZARD_RESULT_FIELDS) {
      const v = manualRow[field];
      if (v !== undefined) valueMap[field] = v;
    }
  }
  const mappedOut = importMappedOutputOverrides[row.id];
  if (mappedOut) {
    for (const [k, v] of Object.entries(mappedOut)) {
      if (v !== undefined) valueMap[k as ImportWizardResultField] = v;
    }
  }

  const fiatEffective = applyImportFiatResolutionToValueMap(valueMap, row.id, {});

  let processed = processImportRow(
    effectiveRow.sourceFile,
    effectiveRow.lineNumber,
    effectiveRow.values,
    valueMap,
    effectiveRow.rawLine
  );
  if ('valid' in processed) {
    processed = {
      valid: applyValidRowPostProcessMappingPolicy(processed.valid, fiatEffective, rates, {
        expenseRaw: valueMap.EXPENSE ?? '',
        incomeRaw: valueMap.INCOME ?? '',
      }),
    };
  }
  const dup =
    'valid' in processed && existingTransactionSignatures.has(rowSignature(processed.valid));
  return { row: effectiveRow, valueMap, processed, duplicateExisting: dup };
}

export function computeTransactionsImportWizardPreview(
  params: ImportWizardPreviewComputeParams
): ImportWizardPreviewResult {
  const { model } = params;
  const { rows } = model;
  const list: ImportWizardPreviewItem[] = [];
  let validOrdinal = 0;
  const rates = getEffectiveRates();

  for (const row of rows) {
    const item = computeSingleImportWizardPreviewItem(row, params, rates);
    if ('valid' in item.processed) validOrdinal += 1;
    list.push(item);
  }

  return { list, validCount: validOrdinal };
}

/**
 * Valeur affichée pour une colonne jumelle telle que la calculerait le pipeline sans override utilisateur
 * sur `omitMappedOutputForField` (les autres overrides de la ligne restent appliqués).
 */
export function getPipelineSrcMappedFieldDisplay(
  params: ImportWizardPreviewComputeParams & {
    rowId: string;
    mappedAs: WizardStandardKey;
    omitMappedOutputForField: ImportWizardResultField;
  }
): string {
  const { rowId, mappedAs, omitMappedOutputForField, importMappedOutputOverrides = {}, ...rest } = params;
  const row = rest.model.rows.find((r) => r.id === rowId);
  if (!row) return '';

  const rowOv = { ...(importMappedOutputOverrides[rowId] ?? {}) };
  delete rowOv[omitMappedOutputForField];
  let nextOverrides: Record<string, Partial<Record<ImportWizardResultField, string>>> = {
    ...importMappedOutputOverrides,
  };
  if (Object.keys(rowOv).length === 0) {
    const { [rowId]: _, ...restOv } = nextOverrides;
    nextOverrides = restOv;
  } else {
    nextOverrides[rowId] = rowOv;
  }

  const rates = getEffectiveRates();
  const item = computeSingleImportWizardPreviewItem(row, { ...rest, importMappedOutputOverrides: nextOverrides }, rates);
  return getSrcMappedFieldDisplayValue(item, mappedAs);
}

/** Premier instant du mois civil local contenant `t` (date à minuit). */
function startOfLocalMonthTime(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/**
 * Avertissements cohérence des dates (ambre dans la colonne Statut) :
 * - « Mois de référence » : mois du max des dates parmi les lignes valides ; toute date strictement avant
 *   le 1er jour de ce mois est signalée (ex. 28.02 avec une autre ligne en 03.2026).
 * - Ordre fichier : une date qui recule par rapport à la ligne valide précédente.
 */
export function computeImportWizardDateCoherenceWarnings(
  list: ImportWizardPreviewItem[]
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let maxT = 0;
  for (const p of list) {
    if (!('valid' in p.processed)) continue;
    const t = parseDateToTime(p.processed.valid.DATE ?? '');
    if (t > maxT) maxT = t;
  }
  if (maxT <= 0) return out;

  const refMonthStart = startOfLocalMonthTime(maxT);
  let prevValidTime: number | null = null;

  for (const p of list) {
    if (!('valid' in p.processed)) continue;
    const t = parseDateToTime(p.processed.valid.DATE ?? '');
    if (t <= 0) continue;

    const msgs: string[] = [];
    if (t < refMonthStart) {
      msgs.push(
        'Date antérieure au mois passé par rapport au lot (avant le 1er jour du mois le plus récent dans l’import).'
      );
    }
    if (prevValidTime !== null && t < prevValidTime) {
      msgs.push('Date non chronologique : antérieure à la ligne valide précédente dans le fichier.');
    }
    prevValidTime = t;
    if (msgs.length > 0) out.set(p.row.id, msgs);
  }
  return out;
}

/** Champs src_transaction_data déjà alimentés par au moins une colonne source mappée. */
export function getResultFieldsCoveredByImportColumnMapping(
  columns: ImportWizardColumn[] | undefined,
  importColumnMapping: Record<string, WizardStandardKey>
): Set<ImportWizardResultField> {
  const covered = new Set<ImportWizardResultField>();
  for (const col of columns ?? []) {
    const m = importColumnMapping[col.key];
    if (!m) continue;
    if (m === 'EXPENSE' || m === 'INCOME') {
      covered.add('AMOUNT GBP');
    } else if ((IMPORT_WIZARD_RESULT_FIELDS as readonly string[]).includes(m)) {
      covered.add(m as ImportWizardResultField);
    }
  }
  return covered;
}

/** Champs en saisie manuelle (non couverts par le mapping) : vides → rappel « recommandé » dans Status (import toujours possible). TYPE et CURRENCY exclus (TYPE optionnel ; CURRENCY vide = auto). */
const WIZARD_MANUAL_OPTIONAL_FOR_STATUS: ReadonlySet<ImportWizardResultField> = new Set(['TYPE', 'CURRENCY']);

export function getUncoveredManualFieldsRecommendedToFill(
  columns: ImportWizardColumn[] | undefined,
  importColumnMapping: Record<string, WizardStandardKey>
): ImportWizardResultField[] {
  const covered = getResultFieldsCoveredByImportColumnMapping(columns, importColumnMapping);
  return IMPORT_WIZARD_RESULT_FIELDS.filter(
    (f) => !covered.has(f) && !WIZARD_MANUAL_OPTIONAL_FOR_STATUS.has(f)
  );
}

/** @deprecated Utiliser `getUncoveredManualFieldsRecommendedToFill`. */
export const getUncoveredManualFieldsRequiringInput = getUncoveredManualFieldsRecommendedToFill;

export function buildPrepTableColDefs(params: {
  columns: ImportWizardColumn[] | undefined;
  importColumnMapping: Record<string, WizardStandardKey>;
}): PrepTableColDef[] {
  const { columns, importColumnMapping } = params;
  const covered = getResultFieldsCoveredByImportColumnMapping(columns, importColumnMapping);
  const base: PrepTableColDef[] = [
    { kind: 'line', key: PREP_COL_LINE },
    { kind: 'dup', key: PREP_COL_DUP },
  ];
  for (const field of IMPORT_WIZARD_RESULT_FIELDS) {
    if (!covered.has(field)) {
      base.push({ kind: 'wizard', key: PREP_WIZARD_COL_KEY(field), field });
    }
  }
  let addedCombinedIncomeExpenseGbp = false;
  for (const col of columns ?? []) {
    base.push({ kind: 'source', key: col.key, col });
    const m = importColumnMapping[col.key];
    if (!m) continue;
    if (m === 'EXPENSE' || m === 'INCOME') {
      if (!addedCombinedIncomeExpenseGbp) {
        base.push({
          kind: 'srcMappedField',
          key: PREP_AMT_GBP_COMBINED_FIELD_KEY,
          sourceColKey: PREP_AMT_GBP_COMBINED_SRC_KEY,
          mappedAs: 'EXPENSE',
        });
        addedCombinedIncomeExpenseGbp = true;
      }
    } else {
      base.push({
        kind: 'srcMappedField',
        key: `${col.key}${PREP_SRC_MAPPED_FIELD_SUFFIX}`,
        sourceColKey: col.key,
        mappedAs: m,
      });
    }
  }
  base.push({ kind: 'ign', key: PREP_COL_IGN });
  return base;
}

/** Préparation sans mapping : uniquement les colonnes sources (valeurs du CSV). */
export function buildPrepTableColDefsRaw(params: { columns: ImportWizardColumn[] | undefined }): PrepTableColDef[] {
  const base: PrepTableColDef[] = [];
  for (const col of params.columns ?? []) {
    base.push({ kind: 'source', key: col.key, col });
  }
  return base;
}

export function getPrepSourceCellDisplayValue(
  row: ImportWizardRawRow,
  col: ImportWizardColumn,
  cellOverrides: Record<string, Record<string, string>>
): string {
  const ov = cellOverrides[row.id]?.[col.key];
  if (ov !== undefined) return ov;
  return row.values[col.colIndex] ?? '';
}

export function computeImportPreviewMappedOutputFields(params: {
  columns: ImportWizardColumn[] | undefined;
  importColumnMapping: Record<string, WizardStandardKey>;
}): ImportWizardResultField[] {
  const { columns, importColumnMapping } = params;
  if (!columns?.length) return [];
  const want = new Set<string>();
  for (const col of columns) {
    const m = importColumnMapping[col.key];
    if (!m) continue;
    if (m === 'EXPENSE' || m === 'INCOME') want.add('AMOUNT GBP');
    else if ((IMPORT_WIZARD_RESULT_FIELDS as readonly string[]).includes(m)) want.add(m);
  }
  return IMPORT_WIZARD_RESULT_FIELDS.filter((f) => want.has(f));
}

/** En mode mapping wizard, tous les champs src_transaction_data sont toujours éditables (mapping et/ou colonnes manuelles). */
export function computeImportPreviewActiveOutputFields(_params?: {
  importPreviewMappedOutputFields?: ImportWizardResultField[];
  importWizardManualColumns?: Set<ImportWizardResultField>;
}): ImportWizardResultField[] {
  return [...IMPORT_WIZARD_RESULT_FIELDS];
}

/** Insère CURRENCY après AMOUNT si AMOUNT est présent mais pas CURRENCY (sélection devise). */
export function computeImportPreviewDisplayFields(
  importPreviewActiveOutputFields: ImportWizardResultField[]
): ImportWizardResultField[] {
  const f = [...importPreviewActiveOutputFields];
  const hasAm = f.includes('AMOUNT');
  const hasCur = f.includes('CURRENCY');
  if (hasAm && !hasCur) {
    const i = f.indexOf('AMOUNT');
    f.splice(i + 1, 0, 'CURRENCY');
  }
  return f;
}

/** @deprecated Les champs manquants sont toujours proposés automatiquement ; plus de liste « à ajouter ». */
export function computeMappingWizardAvailableFields(_params?: {
  importPreviewMappedOutputFields?: ImportWizardResultField[];
  importWizardManualColumns?: Set<ImportWizardResultField>;
}): ImportWizardResultField[] {
  return [];
}

export function filterImportPreviewImportableRows(params: {
  previewList: ImportWizardPreviewItem[];
  importRowSkip: Set<string>;
}): ImportWizardPreviewItem[] {
  if (!params.previewList.length) return [];
  return params.previewList.filter(
    (p) => !params.importRowSkip.has(p.row.id) && 'valid' in p.processed && !p.duplicateExisting
  );
}
