/**
 * Détecte les lignes anormales dans source_data selon des règles métier :
 * - Colonne habituellement vide non vide / habituellement non vide vide
 * - Account ou Type inconnu (valeur rare dans le jeu)
 * - Date incohérente (défaillance de la chronologie)
 * - Doublon (ligne identique à une autre dans source_data)
 */

import type { SourceDataResult } from './SourceDataCSVService';
import { KNOWN_ACCOUNT_NAMES } from './AccountBalanceCSVService';

/** Clés localStorage utilisées par la page Réglages pour les listes "données reconnues". Doivent rester alignées avec Settings.tsx. */
const STORAGE_KEYS = {
  recognisedAccounts: 'settings-recognised-accounts',
  recognisedEntryTypes: 'settings-recognised-entry-types',
  recognisedOutputTypes: 'settings-recognised-output-types',
} as const;

function loadRecognisedStringArray(key: string): string[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Nom de la colonne CSV indiquant qu'une ligne est exclue de la détection d'anomalies. */
export const EXCLUDE_ANOMALY_COLUMN = 'Exclure_anomalie';

function isExcludedFromAnomalyDetection(row: Record<string, string>): boolean {
  const v = (row[EXCLUDE_ANOMALY_COLUMN] ?? '').trim().toLowerCase();
  return v === '1' || v === 'oui' || v === 'true' || v === 'yes';
}
const USUALLY_EMPTY_THRESHOLD = 0.9;
/** Seuil : en-dessous de ce taux de lignes vides, la colonne est "habituellement non vide". */
const USUALLY_FILLED_THRESHOLD = 0.1;
/** Nombre minimal d’occurrences pour qu’une valeur Account/Type soit considérée comme connue. */
const MIN_OCCURRENCES_KNOWN = 2;

/** Types reconnus comme dépenses : ne sont jamais considérés comme "Type inconnu". */
const KNOWN_EXPENSE_TYPES = new Set([
  'Rent', 'Council', 'Comm', 'Electricity', 'Water', 'SLCdebit', 'Transport', 'Fuel', 'Car',
  'Food', 'Restaurant', 'Shopping', 'Leisure', 'Holiday', 'LST', 'Misc', 'Health', 'Donation',
]);

/** Types reconnus comme revenus : ne sont jamais considérés comme "Type inconnu". */
const KNOWN_INCOME_TYPES = new Set([
  'Lampton', 'LMB', 'LTL', 'Other Inc', 'Support', 'Refund', 'Benefit', 'SLCcredit',
]);

/** Retourne true si la valeur de cellule (montant) est non nulle (non vide et différent de 0). */
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
  const h = headers.find((x) => pattern.test(x));
  return h ?? null;
}

/** Signature d'une ligne pour la détection de doublons (même logique que mergeImportTransactions). */
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

export interface AnomalyRow {
  row: Record<string, string>;
  rowIndex: number;
  reasons: string[];
}

export interface AnomalyResult {
  anomalies: AnomalyRow[];
  csvContent: string;
}

export interface DetectAnomaliesOptions {
  /** Réservé pour options futures. */
  referenceDate?: Date;
}

/**
 * Détecte les lignes anormales et produit un rapport CSV (délimiteur ;) avec une colonne "Raison".
 */
export function detectAnomalies(data: SourceDataResult, _options?: DetectAnomaliesOptions): AnomalyResult {
  const { headers, rows, rowIndicesInSource } = data;
  const anomalies: AnomalyRow[] = [];
  /** Lignes prises en compte pour la détection (exclut celles marquées Exclure_anomalie). */
  const rowsToAnalyze: Record<string, string>[] = [];
  /** Pour chaque index i dans rowsToAnalyze, index 0-based dans le data_source. */
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

  // 1) Colonnes habituellement vides vs non vides (calcul sur les lignes analysées)
  const emptyRateByCol = new Map<string, number>();
  for (const h of headers) {
    const empty = rowsToAnalyze.filter((r) => (r[h] ?? '').trim() === '').length;
    emptyRateByCol.set(h, empty / rowsToAnalyze.length);
  }
  const usuallyEmptyCols = headers.filter((h) => (emptyRateByCol.get(h) ?? 0) >= USUALLY_EMPTY_THRESHOLD);
  const usuallyFilledCols = headers.filter((h) => (emptyRateByCol.get(h) ?? 0) <= USUALLY_FILLED_THRESHOLD);

  // 2) Valeurs connues pour Account (fréquence) et Type (listes uniquement, pas de fréquence)
  const accountHeader = findColumn(headers, /^account$/i);
  const typeHeader = findColumn(headers, /^type$/i);
  const countByAccount = new Map<string, number>();
  for (const r of rowsToAnalyze) {
    if (accountHeader) {
      const v = (r[accountHeader] ?? '').trim();
      if (v) countByAccount.set(v, (countByAccount.get(v) ?? 0) + 1);
    }
  }
  const knownAccountsFromData = new Set<string>([...countByAccount.entries()].filter(([, n]) => n >= MIN_OCCURRENCES_KNOWN).map(([v]) => v));
  const recognisedAccountsFromSettings = loadRecognisedStringArray(STORAGE_KEYS.recognisedAccounts);
  const knownAccounts = new Set<string>([...knownAccountsFromData, ...KNOWN_ACCOUNT_NAMES, ...recognisedAccountsFromSettings]);
  /** Types considérés comme connus : listes métier + types/entrées/sorties reconnus dans Réglages uniquement (pas de critère de fréquence). */
  const recognisedOutputTypes = loadRecognisedStringArray(STORAGE_KEYS.recognisedOutputTypes);
  const recognisedEntryTypes = loadRecognisedStringArray(STORAGE_KEYS.recognisedEntryTypes);
  const recognisedOutputTypesSet = new Set(recognisedOutputTypes);
  const recognisedEntryTypesSet = new Set(recognisedEntryTypes);
  const allKnownTypes = new Set<string>([
    ...KNOWN_EXPENSE_TYPES,
    ...KNOWN_INCOME_TYPES,
    ...recognisedOutputTypes,
    ...recognisedEntryTypes,
  ]);

  // 3) Colonne date pour la chronologie
  const dateHeader = findColumn(headers, /^date$/i);
  const dateTimes = dateHeader ? rowsToAnalyze.map((r) => parseDateToTime(r[dateHeader] ?? '')) : [];

  // 4) En-têtes pour la signature doublon (même clé que mergeImportTransactions)
  const titleHeader = findColumn(headers, /^title$/i);
  const amountHeader = findColumn(headers, /^amount$/i);
  const amountGbpHeader = findColumn(headers, /^amount\s*gbp$/i);
  const seenSignatures = new Set<string>();

  /** Parse le montant AMOUNT GBP (négatif = dépense, positif = revenu). */
  const parseAmount = (value: string): number => {
    const s = (value ?? '').trim().replace(',', '.');
    if (s === '') return 0;
    const n = parseFloat(s);
    return Number.isNaN(n) ? 0 : n;
  };

  for (let i = 0; i < rowsToAnalyze.length; i++) {
    const row = rowsToAnalyze[i];
    const reasons: string[] = [];

    // Colonne habituellement vide n'est pas vide
    for (const h of usuallyEmptyCols) {
      const val = (row[h] ?? '').trim();
      if (val !== '') reasons.push(`Colonne "${h}" habituellement vide contient une valeur`);
    }

    // Colonne habituellement non vide est vide
    for (const h of usuallyFilledCols) {
      const val = (row[h] ?? '').trim();
      if (val === '') reasons.push(`Colonne "${h}" habituellement remplie est vide`);
    }

    // Account inconnu (non vide et pas dans les valeurs connues)
    if (accountHeader) {
      const val = (row[accountHeader] ?? '').trim();
      if (val !== '' && !knownAccounts.has(val)) reasons.push('Account inconnu');
    }

    // Type inconnu (les types de la liste reconnue ne sont jamais considérés inconnus)
    if (typeHeader && amountGbpHeader) {
      const val = (row[typeHeader] ?? '').trim();
      const amount = parseAmount(row[amountGbpHeader] ?? '');
      if (val !== '' && !allKnownTypes.has(val)) reasons.push('Type inconnu');
      // Type sortie/dépense avec montant positif (revenu) → anomalie (listes métier + types sorties reconnus)
      if (val !== '' && amount > 0) {
        if (KNOWN_EXPENSE_TYPES.has(val) || recognisedOutputTypesSet.has(val)) {
          reasons.push('Type sortie utilisé avec montant positif (revenu)');
        }
      }
      // Type entrée/revenu avec montant négatif (dépense) → anomalie (listes métier + types entrées reconnus)
      if (val !== '' && amount < 0) {
        if (KNOWN_INCOME_TYPES.has(val) || recognisedEntryTypesSet.has(val)) {
          reasons.push('Type entrée utilisé avec montant négatif (dépense)');
        }
      }
    }

    // Montant nul → anomalie
    if (amountGbpHeader && !isAmountNonZero(row[amountGbpHeader] ?? '')) {
      reasons.push('Montant nul');
    }

    // Date possiblement fausse (défaillance chronologie : ordre non croissant)
    if (dateHeader && i > 0 && dateTimes[i] > 0 && dateTimes[i - 1] > 0 && dateTimes[i] < dateTimes[i - 1]) {
      reasons.push('Date possiblement fausse (défaillance de la chronologie)');
    }

    // Doublon (ligne identique à une autre déjà vue dans source_data)
    const sig = rowSignature(row, dateHeader, titleHeader, amountHeader, amountGbpHeader, accountHeader);
    if (seenSignatures.has(sig)) reasons.push('Doublon (ligne déjà présente dans source_data)');
    else seenSignatures.add(sig);

    if (reasons.length > 0) {
      /** Index 1-based dans data_source.csv (première ligne de données = 1). */
      const sourceIndex1Based = originalRowIndexInSource[i] + 1;
      anomalies.push({ row, rowIndex: sourceIndex1Based, reasons });
    }
  }

  /** Index 1-based dans data_source pour que les lignes du rapport correspondent au source. */
  const reportHeaders = ['Index', ...headers, 'Raison'];
  const escapeCsv = (s: string) => {
    const t = (s ?? '').replace(/"/g, '""');
    return t.includes(';') || t.includes('"') || t.includes('\n') ? `"${t}"` : t;
  };
  const csvLines = [
    reportHeaders.map(escapeCsv).join(';'),
    ...anomalies.map((a) =>
      reportHeaders
        .map((h) => {
          if (h === 'Index') return String(a.rowIndex);
          if (h === 'Raison') return a.reasons.join(' ; ');
          return a.row[h] ?? '';
        })
        .map(escapeCsv)
        .join(';')
    ),
  ];
  const csvContent = csvLines.join('\n');

  return { anomalies, csvContent };
}
