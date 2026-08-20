/// <reference path="../vite-env.d.ts" />
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  SourceDataCSVService,
  type SourceDataResult,
  SOURCE_DATA_PATH,
  normalizeOrderAndIndex,
  stripSourceColumnFromSourceData,
} from '../services/SourceDataCSVService';
import { SupportDataCSVService, SUPPORT_DATA_CSV_PATH } from '../services/SupportDataCSVService';
import { EXCLUDE_ANOMALY_COLUMN } from '../services/AnomalyDetectionService';
import { canonicalAccountFromSource, accountLabelFromSource } from '../constants/accountSourceLabels';
import { formatDateDDMMYYYY, formatEur, formatGbp, formatAmountGbpForCsv, formatCurrency } from '../utils/format';
import { amountToGbp, convertToAxisCurrency, type CurrencySymbol } from '../services/EffectiveExchangeRates';
import Papa from 'papaparse';
import { getUiMessageTone, uiMessageClass } from '../utils/uiMessageTone';
import {
  TRANSACTION_SOURCE_COLUMN,
  TRANSACTION_SOURCE_VALUE_FILE,
  TRANSACTION_SOURCE_VALUE_MANUAL,
  isManualTransactionSourceValue,
} from '@/shared/transactionRowSource';
import { SOUTIEN_IGNORE_COLUMN, isRowIgnoredForSoutienTotals } from '@/shared/soutienIgnoreColumn';
import { TRANSACTION_PROJET_COLUMN } from '@/shared/transactionsImportCore';
import {
  readSoutienBlocksFromStorage,
  writeSoutienBlocksToStorage,
} from '../constants/soutienBlocksStorage';
import {
  readSoutienTitleCombineFromStorage,
  writeSoutienTitleCombineToStorage,
  rebalanceTitleCombineGroups,
  type SoutienTitleCombineGroup,
  type SoutienTitleCombinePersisted,
} from '../constants/soutienTitleCombineGroupsStorage';
import {
  readSoutienProjectSubtotalFromStorage,
  writeSoutienProjectSubtotalToStorage,
  rebalanceProjectSubtotalGroups,
  type SoutienProjectSubtotalGroup,
  type SoutienProjectSubtotalPersisted,
} from '../constants/soutienProjectSubtotalGroupsStorage';
import { useProjectsFromStorage } from '../hooks/useProjectsFromStorage';
import { projetLabelForId, projetBackgroundStyle } from '../constants/projectsStorage';
import { ProjetDisplayCell, ProjetSelectCell } from '../components/ProjetColumnCells';
import {
  getSuggestions,
  getDateSuggestionsForMonth,
  completeDateForMonth,
} from '../services/SuggestInputService';
import SupportImportPrepSection from '../components/SupportImportPrepSection';
import { useSupportImportPrepWizard } from '../hooks/useSupportImportPrepWizard';
import type { SupportImportDraft } from '../services/supportImportWizardService';

type DraftFields = {
  date: string;
  title: string;
  amount: string;
  currency: string;
  projet: string;
};

const DISPLAY_CURRENCY_STORAGE_KEY = 'support-display-currency';
const SUPPORT_IMPORT_MODULE_EXPANDED_KEY = 'support-import-module-expanded';

function readSupportImportModuleExpanded(): boolean {
  try {
    const v = localStorage.getItem(SUPPORT_IMPORT_MODULE_EXPANDED_KEY);
    if (v === 'false') return false;
    if (v === 'true') return true;
  } catch {
    /* ignore */
  }
  return true;
}

const DISPLAY_CURRENCIES: { value: CurrencySymbol; label: string }[] = [
  { value: '£', label: 'GBP' },
  { value: '€', label: 'EUR' },
  { value: 'CHF', label: 'CHF' },
];

function readStoredDisplayCurrency(): CurrencySymbol {
  try {
    const saved = localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY);
    if (saved === '£' || saved === '€' || saved === 'CHF') return saved;
  } catch {}
  return '£';
}

/** Mois YYYY-MM déduit de la saisie date (sinon mois courant) pour les suggestions de date. */
function inferMonthKeyFromDateDraft(raw: string): string {
  const s = (raw ?? '').trim();
  const dmy = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/.exec(s);
  if (dmy) {
    const month = parseInt(dmy[2], 10);
    let year = dmy[3] ? parseInt(dmy[3], 10) : new Date().getFullYear();
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}`;
    }
  }
  const iso = /^(\d{4})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function mergeDateSuggestionValues(
  fromRows: ReturnType<typeof getSuggestions>,
  fromMonth: string[],
  limit: number = 10
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of fromRows) {
    if (seen.has(s.value)) continue;
    seen.add(s.value);
    out.push(s.value);
  }
  for (const d of fromMonth) {
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out.slice(0, limit);
}

function focusNextSupportDraftInput(current: HTMLInputElement) {
  setTimeout(() => {
    const form = current.closest('[data-support-add-form]');
    const inputs = form?.querySelectorAll<HTMLInputElement>('input:not([disabled])');
    if (!inputs) return;
    const idx = Array.from(inputs).indexOf(current);
    inputs[idx + 1]?.focus();
  }, 0);
}

/** Extrait l’année (AAAA) d’une cellule date (formats ISO, JJ/MM/AAAA, JJ.MM.AAAA, JJ.MM.AA). */
function parseYearFromCell(raw: string): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
  const mi = s.match(iso);
  if (mi) return parseInt(mi[1], 10);
  const md = s.match(dmy);
  if (md) {
    const yy =
      md[3].length === 2
        ? parseInt(md[3], 10) < 50
          ? 2000 + parseInt(md[3], 10)
          : 1900 + parseInt(md[3], 10)
        : parseInt(md[3], 10);
    return Number.isNaN(yy) ? null : yy;
  }
  return null;
}

function parseNumericCell(raw: string | null | undefined): number | null {
  const s = (raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

function currencyCodeToSymbol(currency: string | null | undefined): CurrencySymbol | null {
  const code = (currency ?? '').trim().toUpperCase();
  if (code === 'GBP') return '£';
  if (code === 'EUR') return '€';
  if (code === 'CHF') return 'CHF';
  return null;
}

function formatDisplayAmount(amount: number, displayCurrency: CurrencySymbol): string {
  return formatCurrency(amount, displayCurrency);
}

function getDisplayCurrencyCode(displayCurrency: CurrencySymbol): 'GBP' | 'EUR' | 'CHF' {
  return displayCurrency === '£' ? 'GBP' : displayCurrency === '€' ? 'EUR' : 'CHF';
}

function getSupportRowDisplayAmount(
  row: Record<string, string>,
  displayCurrency: CurrencySymbol,
  amountHeader: string | null,
  currencyHeader: string | null,
  amountGbpHeader: string | null
): number | null {
  const amount = amountHeader ? parseNumericCell(row[amountHeader]) : null;
  const amountGbp = amountGbpHeader ? parseNumericCell(row[amountGbpHeader]) : null;
  const nativeCurrency = currencyCodeToSymbol(currencyHeader ? row[currencyHeader] : '');

  if (nativeCurrency === displayCurrency && amount !== null) return amount;
  if (displayCurrency === '£' && amountGbp !== null) return amountGbp;
  if (nativeCurrency && amount !== null) return convertToAxisCurrency(amount, nativeCurrency, displayCurrency);
  if (amountGbp !== null) return convertToAxisCurrency(amountGbp, '£', displayCurrency);
  return null;
}

function sumDisplayAmountForRows(
  rows: Record<string, string>[],
  displayCurrency: CurrencySymbol,
  amountHeader: string | null,
  currencyHeader: string | null,
  amountGbpHeader: string | null
): number | null {
  if (!amountHeader && !amountGbpHeader) return null;
  let total = 0;
  let any = false;
  for (const row of rows) {
    const amount = getSupportRowDisplayAmount(row, displayCurrency, amountHeader, currencyHeader, amountGbpHeader);
    if (amount !== null) {
      total += amount;
      any = true;
    }
  }
  return any ? total : 0;
}

/** Sommes dans la devise d'affichage regroupées par libellé (colonne TITLE), pour les lignes données. */
function aggregateDisplayAmountByTitle(
  rows: Record<string, string>[],
  titleHeader: string,
  displayCurrency: CurrencySymbol,
  amountHeader: string | null,
  currencyHeader: string | null,
  amountGbpHeader: string | null
): { title: string; totalAmount: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const rawTitle = (row[titleHeader] ?? '').trim();
    const key = rawTitle || '(Sans titre)';
    const amount = getSupportRowDisplayAmount(row, displayCurrency, amountHeader, currencyHeader, amountGbpHeader);
    if (amount === null) continue;
    map.set(key, (map.get(key) ?? 0) + amount);
  }
  return [...map.entries()]
    .map(([title, totalAmount]) => ({ title, totalAmount }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

type SoutienTitleTotalDisplayRow = {
  rowKey: string;
  displayTitle: string;
  /** Détail sous le libellé (ex. titres d’origine pour une ligne combinée). */
  detail?: string;
  totalAmount: number;
};

/** Applique les regroupements : chaque titre n’apparaît que dans un groupe au plus ; le reste reste ligne à ligne. */
function buildTitleTotalsDisplayRows(
  base: { title: string; totalAmount: number }[],
  applyCombine: boolean,
  groups: SoutienTitleCombineGroup[]
): SoutienTitleTotalDisplayRow[] {
  if (!applyCombine || !groups.length) {
    return base.map((x) => ({
      rowKey: `raw:${x.title}`,
      displayTitle: x.title,
      totalAmount: x.totalAmount,
    }));
  }

  const amountByTitle = new Map(base.map((x) => [x.title, x.totalAmount]));
  const consumed = new Set<string>();
  const out: SoutienTitleTotalDisplayRow[] = [];

  for (const g of groups) {
    const titles = g.titles.map((t) => t.trim()).filter(Boolean);
    if (!titles.length) continue;

    let sum = 0;
    const matched: string[] = [];
    for (const t of titles) {
      if (!amountByTitle.has(t)) continue;
      sum += amountByTitle.get(t)!;
      consumed.add(t);
      matched.push(t);
    }

    if (!matched.length) continue;

    const label = (g.label ?? '').trim() || matched.join(' + ');
    out.push({
      rowKey: `combine:${g.id}`,
      displayTitle: label,
      detail: matched.join(' + '),
      totalAmount: sum,
    });
  }

  for (const x of base) {
    if (!consumed.has(x.title)) {
      out.push({
        rowKey: `raw:${x.title}`,
        displayTitle: x.title,
        totalAmount: x.totalAmount,
      });
    }
  }

  return out;
}

function newTitleCombineGroupId(): string {
  return `tcg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function newProjectSubtotalGroupId(): string {
  return `psg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type ProjectTotalRow = {
  projectKey: string;
  displayName: string;
  color: string | null;
  totalAmount: number;
};

type ProjectSubtotalDisplayRow = {
  rowKey: string;
  displayLabel: string;
  detail: string;
  totalAmount: number;
};

/**
 * Construit les lignes de sous-total à afficher après les projets et avant le total général.
 * Les lignes projets restent inchangées ; chaque sous-total additionne les projets sélectionnés.
 */
function buildProjectSubtotalDisplayRows(
  base: ProjectTotalRow[],
  applySubtotals: boolean,
  groups: SoutienProjectSubtotalGroup[]
): ProjectSubtotalDisplayRow[] {
  if (!applySubtotals || !groups.length) return [];

  const amountByKey = new Map(base.map((x) => [x.projectKey, x.totalAmount]));
  const nameByKey = new Map(base.map((x) => [x.projectKey, x.displayName]));
  const out: ProjectSubtotalDisplayRow[] = [];

  for (const g of groups) {
    const keys = g.projectKeys.map((t) => t.trim()).filter(Boolean);
    if (!keys.length) continue;

    let sum = 0;
    const matchedNames: string[] = [];
    for (const k of keys) {
      if (!amountByKey.has(k)) continue;
      sum += amountByKey.get(k)!;
      matchedNames.push(nameByKey.get(k) ?? k);
    }

    if (!matchedNames.length) continue;

    const label = (g.label ?? '').trim() || matchedNames.join(' + ');
    out.push({
      rowKey: `subtotal:${g.id}`,
      displayLabel: label,
      detail: matchedNames.join(' + '),
      totalAmount: sum,
    });
  }

  return out;
}

/** Sommes dans la devise d'affichage regroupées par PROJET (`__sans_projet__` si cellule vide). */
function aggregateDisplayAmountByProject(
  rows: Record<string, string>[],
  projetHeader: string,
  displayCurrency: CurrencySymbol,
  amountHeader: string | null,
  currencyHeader: string | null,
  amountGbpHeader: string | null
): { projectKey: string; totalAmount: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const pid = (row[projetHeader] ?? '').trim();
    const key = pid || '__sans_projet__';
    const amount = getSupportRowDisplayAmount(row, displayCurrency, amountHeader, currencyHeader, amountGbpHeader);
    if (amount === null) continue;
    map.set(key, (map.get(key) ?? 0) + amount);
  }
  return [...map.entries()].map(([projectKey, totalAmount]) => ({ projectKey, totalAmount }));
}

function soutienCellDisplay(
  header: string,
  raw: string,
  row: Record<string, string>,
  displayCurrency: CurrencySymbol,
  amountHeader: string | null,
  currencyHeader: string | null,
  amountGbpHeader: string | null
): React.ReactNode {
  const isDateColumn = /date/i.test(header);
  const isAmountColumn = /^amount$/i.test(header);
  const isCurrencyColumn = /^currency$/i.test(header);
  const isAmountGbpColumn = /^amount\s*gbp$/i.test(header);
  const isAccountColumn = /^account$/i.test(header) || /compte/i.test(header);
  const isSourceCol = /^source$/i.test(header);
  const nativeCurrency = currencyCodeToSymbol(currencyHeader ? row[currencyHeader] : '');
  const nativeAmount = amountHeader ? parseNumericCell(row[amountHeader]) : null;
  if (isDateColumn) return formatDateDDMMYYYY(raw);
  if (isAmountColumn) {
    return nativeCurrency && nativeAmount !== null ? formatDisplayAmount(nativeAmount, nativeCurrency) : formatEur(raw);
  }
  if (isCurrencyColumn) return (raw ?? '').trim().toUpperCase();
  if (isAmountGbpColumn) {
    const amount = getSupportRowDisplayAmount(row, displayCurrency, amountHeader, currencyHeader, amountGbpHeader);
    return amount === null ? formatGbp(raw) : formatDisplayAmount(amount, displayCurrency);
  }
  if (isAccountColumn) return accountLabelFromSource(raw) || raw;
  if (isSourceCol) return raw || TRANSACTION_SOURCE_VALUE_FILE;
  return raw;
}

function displaySupportHeaderLabel(header: string, displayCurrency: CurrencySymbol): string {
  if (/^amount\s*gbp$/i.test(header)) return `AMOUNT ${getDisplayCurrencyCode(displayCurrency)}`;
  return header;
}

function getCompareValue(header: string, raw: string): number | string {
  const s = (raw ?? '').trim();
  if (s === '') {
    if (/date/i.test(header) || /^amount$|^currency$|^amount\s*gbp$/i.test(header)) return Infinity;
    if (/^index$/i.test(header)) return Infinity;
    return '';
  }
  if (/^index$/i.test(header)) {
    const n = parseInt(s.replace(/\s/g, ''), 10);
    return Number.isNaN(n) ? s : n;
  }
  if (/date/i.test(header)) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/;
    const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
    let y: number, m: number, d: number;
    const mi = s.match(iso);
    if (mi) {
      y = parseInt(mi[1], 10);
      m = parseInt(mi[2], 10);
      d = parseInt(mi[3], 10);
    } else {
      const md = s.match(dmy);
      if (md) {
        d = parseInt(md[1], 10);
        m = parseInt(md[2], 10);
        const yy = md[3].length === 2 ? (parseInt(md[3], 10) < 50 ? 2000 + parseInt(md[3], 10) : 1900 + parseInt(md[3], 10)) : parseInt(md[3], 10);
        y = yy;
      } else return s;
    }
    return y * 10000 + m * 100 + d;
  }
  if (/^amount$|^currency$|^amount\s*gbp$/i.test(header)) {
    const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
    return Number.isNaN(n) ? s : n;
  }
  if (/^account$/i.test(header) || /compte/i.test(header)) {
    return canonicalAccountFromSource(s).toLowerCase() || s.toLowerCase();
  }
  return s.toLowerCase();
}

function filterSupportRowsBySearch(
  rows: Record<string, string>[],
  filterText: string,
  filterColumn: string,
  headers: string[] | undefined
): Record<string, string>[] {
  const q = filterText.trim().toLowerCase();
  if (!q) return rows;
  const cols =
    filterColumn === '__all__'
      ? (headers ?? []).filter((h) => h !== EXCLUDE_ANOMALY_COLUMN && !/^index$/i.test(h))
      : [filterColumn];
  return rows.filter((row) => cols.some((h) => (row[h] ?? '').toLowerCase().includes(q)));
}

function sortSupportRows(
  rows: Record<string, string>[],
  sortColumn: string | null,
  sortDirection: 'asc' | 'desc',
  headers: string[] | undefined
): Record<string, string>[] {
  if (!sortColumn || !headers?.includes(sortColumn)) return rows;
  return [...rows].sort((a, b) => {
    const va = getCompareValue(sortColumn, a[sortColumn] ?? '');
    const vb = getCompareValue(sortColumn, b[sortColumn] ?? '');
    const na = typeof va === 'number';
    const nb = typeof vb === 'number';
    let cmp: number;
    if (na && nb) cmp = (va as number) - (vb as number);
    else if (na) cmp = -1;
    else if (nb) cmp = 1;
    else cmp = String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
    return sortDirection === 'asc' ? cmp : -cmp;
  });
}

function ensureHeadersForWrite(headersIn: string[]): string[] {
  let headers = [...headersIn];
  if (!headers.some((h) => /^source$/i.test(h))) {
    const typeIdx = headers.findIndex((h) => /^type$/i.test(h));
    const insertAt = typeIdx >= 0 ? typeIdx + 1 : headers.length;
    headers = [...headers.slice(0, insertAt), TRANSACTION_SOURCE_COLUMN, ...headers.slice(insertAt)];
  }
  if (!headers.includes(EXCLUDE_ANOMALY_COLUMN)) {
    headers = [...headers, EXCLUDE_ANOMALY_COLUMN];
  }
  if (!headers.some((h) => /^soutien_ignorer$/i.test(h))) {
    headers = [...headers, SOUTIEN_IGNORE_COLUMN];
  }
  if (!headers.some((h) => /^projet$/i.test(h))) {
    const typeIdx = headers.findIndex((h) => /^type$/i.test(h));
    const insertAt = typeIdx >= 0 ? typeIdx + 1 : headers.length;
    headers = [...headers.slice(0, insertAt), TRANSACTION_PROJET_COLUMN, ...headers.slice(insertAt)];
  }
  return headers;
}

type YearPanelState = {
  filterText: string;
  filterColumn: string;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
};

const DEFAULT_YEAR_PANEL: YearPanelState = {
  filterText: '',
  filterColumn: '__all__',
  sortColumn: null,
  sortDirection: 'asc',
};

function splitRowsByOrigin(
  rows: Record<string, string>[],
  rowOrigins: ('src' | 'support')[]
): { srcRows: Record<string, string>[]; supportRows: Record<string, string>[] } {
  const srcRows: Record<string, string>[] = [];
  const supportRows: Record<string, string>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    if (rowOrigins[i] === 'support') supportRows.push({ ...r });
    else srcRows.push({ ...r });
  }
  return { srcRows, supportRows };
}

type YearGroupBase = {
  yearKey: string;
  year: number | null;
  sectionTitle: string;
  rows: Record<string, string>[];
};

const SUPPORT_MATCHED_SOURCE_VALUE = 'src_transactions_data.csv';

function buildSupportRowMatchKey(
  row: Record<string, string>,
  headers: {
    date: string | null;
    title: string | null;
    amount: string | null;
    amountGbp: string | null;
    account: string | null;
  }
): string | null {
  const { date, title, amount, amountGbp, account } = headers;
  if (!date || !title || !amount || !amountGbp || !account) return null;
  const value = (h: string) => (row[h] ?? '').toString().trim().toLowerCase();
  return [value(date), value(title), value(amount), value(amountGbp), value(account)].join('|');
}

const Support: React.FC = () => {
  const projects = useProjectsFromStorage();
  const [data, setData] = useState<SourceDataResult | null>(null);
  /** Pour chaque ligne de `data.rows` : fichier src_transaction_data.csv ou Support_data.csv. */
  const [rowOrigins, setRowOrigins] = useState<('src' | 'support')[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** État recherche / tri indépendant par bloc année (clé = yearKey). */
  const [yearPanelState, setYearPanelState] = useState<Record<string, YearPanelState>>({});
  /** Développé par défaut ; `false` = replié (persisté, localStorage). */
  const [yearBlockExpanded, setYearBlockExpanded] = useState<Record<string, boolean>>(() => {
    const s = readSoutienBlocksFromStorage();
    return s?.yearBlocks ?? {};
  });
  /** Recherche sur toutes les colonnes, tous les blocs ; prioritaire sur les filtres par tableau. */
  const [globalSearchText, setGlobalSearchText] = useState('');
  /** Bloc « totaux par titre » : développé par défaut (persisté, localStorage). */
  const [titleTotalsBlockExpanded, setTitleTotalsBlockExpanded] = useState(() => {
    const s = readSoutienBlocksFromStorage();
    return s?.titleTotalsExpanded ?? true;
  });
  /** Tri du tableau « totaux par titre » (clic sur chaque en-tête : croissant / décroissant). */
  const [titleTotalsTableSort, setTitleTotalsTableSort] = useState<{
    key: 'title' | 'amount';
    dir: 'asc' | 'desc';
  }>({ key: 'title', dir: 'asc' });
  /** Regroupements de libellés pour le tableau des totaux par titre (persisté, localStorage). */
  const [titleCombineState, setTitleCombineState] = useState<SoutienTitleCombinePersisted>(() => {
    return (
      readSoutienTitleCombineFromStorage() ?? {
        applyCombine: true,
        groups: [],
        regroupementPanelExpanded: true,
      }
    );
  });
  /** Sous-totaux par projet pour le tableau « sommes par projet » (persisté, localStorage). */
  const [projectSubtotalState, setProjectSubtotalState] = useState<SoutienProjectSubtotalPersisted>(() => {
    return (
      readSoutienProjectSubtotalFromStorage() ?? {
        applySubtotals: true,
        groups: [],
        panelExpanded: true,
      }
    );
  });
  /** Bloc « sommes par projet » (persisté). */
  const [projectTotalsBlockExpanded, setProjectTotalsBlockExpanded] = useState(() => {
    const s = readSoutienBlocksFromStorage();
    return s?.projectTotalsExpanded ?? true;
  });

  const [csvWriteLoading, setCsvWriteLoading] = useState(false);
  const [addMessage, setAddMessage] = useState<string | null>(null);
  const [importModuleExpanded, setImportModuleExpanded] = useState(() => readSupportImportModuleExpanded());
  const [draftDate, setDraftDate] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftAmount, setDraftAmount] = useState('');
  const [draftCurrency, setDraftCurrency] = useState('EUR');
  const [draftProjet, setDraftProjet] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [editDataRowIndex, setEditDataRowIndex] = useState<number | null>(null);
  const [editDate, setEditDate] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editCurrency, setEditCurrency] = useState('EUR');
  const [editMessage, setEditMessage] = useState<string | null>(null);
  const [displayCurrency, setDisplayCurrency] = useState<CurrencySymbol>(() => readStoredDisplayCurrency());

  const loadData = useCallback((options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setLoading(true);
    setError(null);
    Promise.all([SourceDataCSVService.load(), SupportDataCSVService.load()])
      .then(([main, support]) => {
        if (!main && (!support?.rows?.length)) {
          setData(null);
          setRowOrigins([]);
          setError(`Aucune donnée : ${SOURCE_DATA_PATH} absent ou vide et aucune ligne dans Support_data.csv.`);
          return;
        }
        let headers = main?.headers ?? support?.headers ?? [];
        if (!headers.some((h) => /^source$/i.test(h))) {
          const typeIdx = headers.findIndex((h) => /^type$/i.test(h));
          const insertAt = typeIdx >= 0 ? typeIdx + 1 : headers.length;
          headers = [...headers.slice(0, insertAt), TRANSACTION_SOURCE_COLUMN, ...headers.slice(insertAt)];
        }
        const sourceHeader = headers.find((h) => /^source$/i.test(h)) ?? TRANSACTION_SOURCE_COLUMN;
        const typeHeader = headers.find((h) => /^type$/i.test(h)) ?? null;
        const dateHeader = headers.find((h) => /date/i.test(h)) ?? null;
        const titleHeader = headers.find((h) => /^title$/i.test(h)) ?? null;
        const amountHeader = headers.find((h) => /^amount$/i.test(h)) ?? null;
        const amountGbpHeader = headers.find((h) => /^amount\s*gbp$/i.test(h)) ?? null;
        const accountHeader = headers.find((h) => /^account$/i.test(h)) ?? null;
        const srcRows = main?.rows ?? [];
        const supportRowsRaw = support?.rows ?? [];
        const keyHeaders = {
          date: dateHeader,
          title: titleHeader,
          amount: amountHeader,
          amountGbp: amountGbpHeader,
          account: accountHeader,
        };
        const srcSupportKeys = new Set(
          srcRows
            .filter((row) =>
              typeHeader ? (row[typeHeader] ?? '').trim().toLowerCase() === 'support' : true
            )
            .map((row) => buildSupportRowMatchKey(row, keyHeaders))
            .filter((k): k is string => Boolean(k))
        );
        const supportRows = supportRowsRaw.map((row) => {
          const rowType = typeHeader ? (row[typeHeader] ?? '').trim().toLowerCase() : '';
          if (typeHeader && rowType !== 'support') return { ...row };
          const key = buildSupportRowMatchKey(row, keyHeaders);
          const sourceValue =
            key && srcSupportKeys.has(key) ? SUPPORT_MATCHED_SOURCE_VALUE : TRANSACTION_SOURCE_VALUE_MANUAL;
          return { ...row, [sourceHeader]: sourceValue };
        });
        const mergedRows = [...srcRows, ...supportRows];
        const normalized = normalizeOrderAndIndex({ headers, rows: mergedRows });
        setData(normalized);
        setRowOrigins([...srcRows.map(() => 'src' as const), ...supportRows.map(() => 'support' as const)]);
      })
      .catch((err) => {
        setError(err?.message ?? 'Erreur lors du chargement des données.');
      })
      .finally(() => {
        if (!silent) setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    writeSoutienBlocksToStorage({
      titleTotalsExpanded: titleTotalsBlockExpanded,
      projectTotalsExpanded: projectTotalsBlockExpanded,
      yearBlocks: yearBlockExpanded,
    });
  }, [titleTotalsBlockExpanded, projectTotalsBlockExpanded, yearBlockExpanded]);

  useEffect(() => {
    writeSoutienTitleCombineToStorage(titleCombineState);
  }, [titleCombineState]);

  useEffect(() => {
    writeSoutienProjectSubtotalToStorage(projectSubtotalState);
  }, [projectSubtotalState]);

  const typeHeader = useMemo(() => data?.headers.find((h) => /^type$/i.test(h)) ?? null, [data?.headers]);

  const sourceHeader = useMemo(
    () => data?.headers.find((h) => /^source$/i.test(h)) ?? TRANSACTION_SOURCE_COLUMN,
    [data?.headers]
  );

  const displayHeaders = useMemo(
    () =>
      (data?.headers ?? []).filter(
        (h) =>
          h !== EXCLUDE_ANOMALY_COLUMN &&
          !/^index$/i.test(h) &&
          !/^soutien_ignorer$/i.test(h)
      ),
    [data?.headers]
  );

  const yearDisplayHeaders = useMemo(
    () => displayHeaders.filter((h) => !/^type$/i.test(h)),
    [displayHeaders]
  );

  const soutienIgnoreHeader = useMemo(
    () => data?.headers.find((h) => /^soutien_ignorer$/i.test(h)) ?? null,
    [data?.headers]
  );

  const supportRowsOnly = useMemo(() => {
    if (!data?.rows || !typeHeader) return [] as Record<string, string>[];
    return data.rows.filter((row) => (row[typeHeader] ?? '').trim().toLowerCase() === 'support');
  }, [data?.rows, typeHeader]);

  const dateColumn = useMemo(() => data?.headers.find((h) => /date/i.test(h)) ?? null, [data?.headers]);

  const amountGbpHeader = useMemo(
    () => data?.headers.find((h) => /^amount\s*gbp$/i.test(h)) ?? null,
    [data?.headers]
  );

  const titleColumnHeader = useMemo(
    () => data?.headers.find((h) => /^title$/i.test(h)) ?? null,
    [data?.headers]
  );

  const amountColumnHeader = useMemo(
    () => data?.headers.find((h) => /^amount$/i.test(h)) ?? null,
    [data?.headers]
  );

  const currencyColumnHeader = useMemo(
    () => data?.headers.find((h) => /^currency$/i.test(h)) ?? null,
    [data?.headers]
  );

  const setDisplayCurrencyPersist = useCallback((currency: CurrencySymbol) => {
    setDisplayCurrency(currency);
    try {
      localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, currency);
    } catch {}
  }, []);

  const draftDateSuggestions = useMemo(() => {
    if (!dateColumn) return [] as string[];
    const fromRows = getSuggestions(supportRowsOnly, dateColumn, draftDate, 10);
    const monthKey = inferMonthKeyFromDateDraft(draftDate);
    const fromMonth = getDateSuggestionsForMonth(monthKey, draftDate);
    return mergeDateSuggestionValues(fromRows, fromMonth, 10);
  }, [supportRowsOnly, dateColumn, draftDate]);

  const draftTitleSuggestions = useMemo(() => {
    if (!titleColumnHeader) return [] as ReturnType<typeof getSuggestions>;
    return getSuggestions(supportRowsOnly, titleColumnHeader, draftTitle, 10);
  }, [supportRowsOnly, titleColumnHeader, draftTitle]);

  const draftAmountSuggestions = useMemo(() => {
    if (!amountColumnHeader) return [] as ReturnType<typeof getSuggestions>;
    return getSuggestions(supportRowsOnly, amountColumnHeader, draftAmount, 10);
  }, [supportRowsOnly, amountColumnHeader, draftAmount]);

  const isSupportDraftEmpty = useMemo(
    () =>
      !draftDate.trim() &&
      !draftTitle.trim() &&
      !draftAmount.trim() &&
      draftCurrency === 'EUR' &&
      !draftProjet.trim(),
    [draftDate, draftTitle, draftAmount, draftCurrency, draftProjet]
  );

  const isSupportDraftComplete = useMemo(() => {
    const dateTrim = draftDate.trim();
    const titleTrim = draftTitle.trim();
    const amountTrim = draftAmount.trim().replace(',', '.');
    if (!dateTrim || !titleTrim || !amountTrim) return false;
    const amountNum = parseFloat(amountTrim);
    if (Number.isNaN(amountNum) || amountNum === 0) return false;
    const cur = (draftCurrency ?? '').trim().toUpperCase() || 'EUR';
    return ['EUR', 'GBP', 'CHF'].includes(cur);
  }, [draftDate, draftTitle, draftAmount, draftCurrency]);

  const projetColumnHeader = useMemo(
    () => data?.headers.find((h) => /^projet$/i.test(h)) ?? null,
    [data?.headers]
  );

  /** Lignes Support comptées dans les totaux (hors lignes ignorées pour Soutien). */
  const supportRowsForAggregates = useMemo(
    () =>
      supportRowsOnly.filter((row) => !isRowIgnoredForSoutienTotals(row, soutienIgnoreHeader)),
    [supportRowsOnly, soutienIgnoreHeader]
  );

  /** Lignes Support prises en compte pour le récap par titre (même filtre que la recherche globale lorsqu’elle est active). */
  const supportRowsForTitleTotals = useMemo(() => {
    const g = globalSearchText.trim();
    if (!g) return supportRowsForAggregates;
    return filterSupportRowsBySearch(supportRowsForAggregates, globalSearchText, '__all__', data?.headers);
  }, [supportRowsForAggregates, globalSearchText, data?.headers]);

  const titleTotalsByTitle = useMemo(() => {
    if (!titleColumnHeader || (!amountColumnHeader && !amountGbpHeader)) {
      return [] as { title: string; totalAmount: number }[];
    }
    return aggregateDisplayAmountByTitle(
      supportRowsForTitleTotals,
      titleColumnHeader,
      displayCurrency,
      amountColumnHeader,
      currencyColumnHeader,
      amountGbpHeader
    );
  }, [supportRowsForTitleTotals, titleColumnHeader, displayCurrency, amountColumnHeader, currencyColumnHeader, amountGbpHeader]);

  const titleTotalsGrand = useMemo(
    () => titleTotalsByTitle.reduce((s, x) => s + x.totalAmount, 0),
    [titleTotalsByTitle]
  );

  const titleTotalsDisplayRows = useMemo(
    () =>
      buildTitleTotalsDisplayRows(
        titleTotalsByTitle,
        titleCombineState.applyCombine,
        titleCombineState.groups
      ),
    [titleTotalsByTitle, titleCombineState.applyCombine, titleCombineState.groups]
  );

  const titleTotalsDisplayRowsSorted = useMemo(() => {
    const list = [...titleTotalsDisplayRows];
    const { key, dir } = titleTotalsTableSort;
    const mult = dir === 'asc' ? 1 : -1;
    if (key === 'title') {
      list.sort(
        (a, b) => mult * a.displayTitle.localeCompare(b.displayTitle, undefined, { sensitivity: 'base' })
      );
    } else {
      list.sort((a, b) => {
        const cmp = mult * (a.totalAmount - b.totalAmount);
        if (cmp !== 0) return cmp;
        return a.displayTitle.localeCompare(b.displayTitle, undefined, { sensitivity: 'base' });
      });
    }
    return list;
  }, [titleTotalsDisplayRows, titleTotalsTableSort]);

  const titleKeysInCurrentTotals = useMemo(
    () => new Set(titleTotalsByTitle.map((x) => x.title)),
    [titleTotalsByTitle]
  );

  const titleOptionsForCombineUi = useMemo(() => {
    const set = new Set<string>();
    for (const x of titleTotalsByTitle) set.add(x.title);
    for (const g of titleCombineState.groups) {
      for (const t of g.titles) {
        const u = t.trim();
        if (u) set.add(u);
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [titleTotalsByTitle, titleCombineState.groups]);

  const titleCombineActive =
    titleCombineState.applyCombine && titleCombineState.groups.some((g) => g.titles.length > 0);

  const projectTotalsList = useMemo(() => {
    if (!projetColumnHeader || (!amountColumnHeader && !amountGbpHeader)) {
      return [] as ProjectTotalRow[];
    }
    const list = aggregateDisplayAmountByProject(
      supportRowsForTitleTotals,
      projetColumnHeader,
      displayCurrency,
      amountColumnHeader,
      currencyColumnHeader,
      amountGbpHeader
    );
    return list
      .map((x) => ({
        projectKey: x.projectKey,
        totalAmount: x.totalAmount,
        displayName:
          x.projectKey === '__sans_projet__'
            ? '(Sans projet)'
            : projetLabelForId(projects, x.projectKey) || x.projectKey,
        color:
          x.projectKey === '__sans_projet__'
            ? null
            : (projects.find((p) => p.id === x.projectKey)?.color ?? null),
      }))
      .sort((a, b) => {
        if (a.projectKey === '__sans_projet__') return 1;
        if (b.projectKey === '__sans_projet__') return -1;
        return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
      });
  }, [supportRowsForTitleTotals, projetColumnHeader, displayCurrency, amountColumnHeader, currencyColumnHeader, amountGbpHeader, projects]);

  const projectSubtotalDisplayRows = useMemo(
    () =>
      buildProjectSubtotalDisplayRows(
        projectTotalsList,
        projectSubtotalState.applySubtotals,
        projectSubtotalState.groups
      ),
    [projectTotalsList, projectSubtotalState.applySubtotals, projectSubtotalState.groups]
  );

  const projectKeysInCurrentTotals = useMemo(
    () => new Set(projectTotalsList.map((x) => x.projectKey)),
    [projectTotalsList]
  );

  const projectOptionsForSubtotalUi = useMemo(() => {
    const map = new Map<string, string>();
    for (const x of projectTotalsList) map.set(x.projectKey, x.displayName);
    for (const g of projectSubtotalState.groups) {
      for (const k of g.projectKeys) {
        const key = k.trim();
        if (!key || map.has(key)) continue;
        map.set(
          key,
          key === '__sans_projet__' ? '(Sans projet)' : projetLabelForId(projects, key) || key
        );
      }
    }
    return [...map.entries()]
      .map(([projectKey, displayName]) => ({ projectKey, displayName }))
      .sort((a, b) => {
        if (a.projectKey === '__sans_projet__') return 1;
        if (b.projectKey === '__sans_projet__') return -1;
        return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' });
      });
  }, [projectTotalsList, projectSubtotalState.groups, projects]);

  const projectSubtotalActive =
    projectSubtotalState.applySubtotals &&
    projectSubtotalState.groups.some((g) => g.projectKeys.length > 0);

  const projectTotalsGrand = useMemo(
    () => projectTotalsList.reduce((s, x) => s + x.totalAmount, 0),
    [projectTotalsList]
  );

  /** Lignes Support uniquement, découpées par année (sans filtre recherche — filtré par tableau). */
  const yearGroupsBase = useMemo((): YearGroupBase[] => {
    if (!supportRowsOnly.length) return [];
    if (!dateColumn) {
      return [
        {
          yearKey: 'all',
          year: null,
          sectionTitle: 'Transactions',
          rows: supportRowsOnly,
        },
      ];
    }
    const byYear = new Map<number, Record<string, string>[]>();
    const unknown: Record<string, string>[] = [];
    for (const row of supportRowsOnly) {
      const y = parseYearFromCell(row[dateColumn] ?? '');
      if (y === null) {
        unknown.push(row);
      } else {
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y)!.push(row);
      }
    }
    const yearsDesc = [...byYear.keys()].sort((a, b) => b - a);
    const out: YearGroupBase[] = [];
    for (const y of yearsDesc) {
      out.push({
        yearKey: `y${y}`,
        year: y,
        sectionTitle: String(y),
        rows: byYear.get(y)!,
      });
    }
    if (unknown.length > 0) {
      out.push({
        yearKey: 'yunknown',
        year: null,
        sectionTitle: 'Date inconnue ou invalide',
        rows: unknown,
      });
    }
    return out;
  }, [supportRowsOnly, dateColumn]);

  const handleSortYear = useCallback((yearKey: string, header: string) => {
    setYearPanelState((prev) => {
      const cur = { ...DEFAULT_YEAR_PANEL, ...prev[yearKey] };
      if (cur.sortColumn === header) {
        return {
          ...prev,
          [yearKey]: {
            ...cur,
            sortDirection: cur.sortDirection === 'asc' ? 'desc' : 'asc',
          },
        };
      }
      return {
        ...prev,
        [yearKey]: {
          ...cur,
          sortColumn: header,
          sortDirection: 'asc',
        },
      };
    });
  }, []);

  const patchYearPanel = useCallback((yearKey: string, patch: Partial<YearPanelState>) => {
    setYearPanelState((prev) => {
      const cur = { ...DEFAULT_YEAR_PANEL, ...prev[yearKey] };
      return { ...prev, [yearKey]: { ...cur, ...patch } };
    });
  }, []);

  const isYearBlockExpanded = useCallback(
    (yearKey: string) => yearBlockExpanded[yearKey] !== false,
    [yearBlockExpanded]
  );

  const toggleYearBlock = useCallback((yearKey: string) => {
    setYearBlockExpanded((prev) => {
      const expanded = prev[yearKey] !== false;
      return { ...prev, [yearKey]: !expanded };
    });
  }, []);

  const resetDraft = useCallback(() => {
    setDraftDate('');
    setDraftTitle('');
    setDraftAmount('');
    setDraftCurrency('EUR');
    setDraftProjet('');
  }, []);

  const closeEditModal = useCallback(() => {
    setEditOpen(false);
    setEditDataRowIndex(null);
    setEditMessage(null);
    setEditDate('');
    setEditTitle('');
    setEditAmount('');
    setEditCurrency('EUR');
  }, []);

  const isManualRow = useCallback(
    (row: Record<string, string>) => isManualTransactionSourceValue(row[sourceHeader] ?? ''),
    []
  );

  const buildManualSupportRow = useCallback(
    (
      draft: DraftFields,
      base: SourceDataResult,
      typeH: string,
      originalRow: Record<string, string> | null
    ): { row: Record<string, string>; error: string | null } => {
      const dateTrim = draft.date.trim();
      const titleTrim = draft.title.trim();
      const amountTrim = draft.amount.trim().replace(',', '.');
      if (!dateTrim || !titleTrim || !amountTrim) {
        return { row: {}, error: 'Renseignez au minimum la date, le libellé et le montant.' };
      }
      const amountNum = parseFloat(amountTrim);
      if (Number.isNaN(amountNum) || amountNum === 0) {
        return { row: {}, error: 'Montant invalide.' };
      }
      const cur = (draft.currency ?? '').trim().toUpperCase() || 'EUR';
      if (!['EUR', 'GBP', 'CHF'].includes(cur)) {
        return { row: {}, error: 'Devise : EUR, GBP ou CHF.' };
      }

      const dateH = base.headers.find((h) => /date/i.test(h));
      const titleH = base.headers.find((h) => /^title$/i.test(h));
      const amountH = base.headers.find((h) => /^amount$/i.test(h));
      const currencyH = base.headers.find((h) => /^currency$/i.test(h));
      const accountH = base.headers.find((h) => /^account$/i.test(h));
      const amountGbpH = base.headers.find((h) => /^amount\s*gbp$/i.test(h));
      if (!dateH || !titleH || !amountH || !currencyH) {
        return { row: {}, error: 'Colonnes DATE, TITLE, AMOUNT ou CURRENCY manquantes dans le fichier.' };
      }

      const headers = ensureHeadersForWrite(base.headers);
      const sourceH = headers.find((h) => /^source$/i.test(h)) ?? TRANSACTION_SOURCE_COLUMN;
      const ignoreH = headers.find((h) => /^soutien_ignorer$/i.test(h)) ?? null;
      const projetH = headers.find((h) => /^projet$/i.test(h)) ?? null;

      const amountStr = String(amountNum).replace('.', ',');
      let amountGbpStr = '';
      if (amountGbpH) {
        if (cur === 'EUR' || cur === 'CHF') {
          const gbp = amountToGbp(amountNum, cur);
          if (gbp !== null) amountGbpStr = formatAmountGbpForCsv(gbp);
        } else if (cur === 'GBP') {
          amountGbpStr = formatAmountGbpForCsv(amountNum);
        }
      }

      const row: Record<string, string> = originalRow ? { ...originalRow } : {};
      headers.forEach((h) => {
        if (/^index$/i.test(h)) return;
        if (!originalRow && !(h in row)) row[h] = '';
      });
      row[dateH] = dateTrim;
      row[titleH] = titleTrim;
      row[amountH] = amountStr;
      row[currencyH] = cur;
      if (accountH) row[accountH] = '';
      if (amountGbpH) row[amountGbpH] = amountGbpStr;
      row[typeH] = 'Support';
      row[sourceH] = TRANSACTION_SOURCE_VALUE_MANUAL;
      if (!row[EXCLUDE_ANOMALY_COLUMN]) row[EXCLUDE_ANOMALY_COLUMN] = '';
      if (ignoreH) row[ignoreH] = '';
      if (projetH) row[projetH] = (draft.projet ?? '').trim();
      return { row, error: null };
    },
    []
  );

  const persistMergedFiles = useCallback(
    async (
      mergedRows: Record<string, string>[],
      headersFromData: string[],
      origins: ('src' | 'support')[]
    ): Promise<{ success: boolean; error?: string }> => {
      const api = (window as unknown as {
        electronAPI?: { writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }> };
      }).electronAPI;
      if (!api?.writeFile) {
        return { success: false, error: 'Écriture fichier non disponible.' };
      }
      const { srcRows, supportRows } = splitRowsByOrigin(mergedRows, origins);
      const headers = ensureHeadersForWrite(headersFromData);
      const withIndexHeader = headers.some((h) => /^index$/i.test(h)) ? headers : ['Index', ...headers];
      const normSrcRaw = normalizeOrderAndIndex({ headers: withIndexHeader, rows: srcRows });
      const normSrc = stripSourceColumnFromSourceData(normSrcRaw);
      const normSupport = normalizeOrderAndIndex({ headers: withIndexHeader, rows: supportRows });
      const csvSrc = Papa.unparse(normSrc.rows, { columns: normSrc.headers, delimiter: ';' });
      const csvSupport = Papa.unparse(normSupport.rows, { columns: normSupport.headers, delimiter: ';' });
      const r1 = await api.writeFile(SOURCE_DATA_PATH, csvSrc);
      if (!r1.success) return r1;
      return api.writeFile(SUPPORT_DATA_CSV_PATH, csvSupport);
    },
    []
  );

  const handleAppendSupportLine = useCallback(async () => {
    if (!data?.headers?.length || !typeHeader) {
      setAddMessage('Données non chargées ou colonne TYPE absente.');
      return;
    }
    const draft: DraftFields = {
      date: draftDate,
      title: draftTitle,
      amount: draftAmount,
      currency: draftCurrency,
      projet: draftProjet,
    };
    const built = buildManualSupportRow(draft, data, typeHeader, null);
    if (built.error || !built.row) {
      setAddMessage(built.error ?? 'Erreur.');
      return;
    }

    setCsvWriteLoading(true);
    setAddMessage(null);
    try {
      const mergedRows = [...data.rows.map((r) => ({ ...r })), built.row];
      const nextOrigins = [...rowOrigins, 'support' as const];
      const result = await persistMergedFiles(mergedRows, data.headers, nextOrigins);
      if (result.success) {
        setAddMessage(`Ligne ajoutée dans ${SUPPORT_DATA_CSV_PATH}.`);
        resetDraft();
        loadData({ silent: true });
      } else {
        setAddMessage(result.error ?? "Erreur lors de l'enregistrement.");
      }
    } finally {
      setCsvWriteLoading(false);
    }
  }, [
    data,
    typeHeader,
    draftDate,
    draftTitle,
    draftAmount,
    draftCurrency,
    draftProjet,
    buildManualSupportRow,
    persistMergedFiles,
    loadData,
    resetDraft,
    rowOrigins,
  ]);

  const handleImportSupportWizardLines = useCallback(
    async (
      drafts: SupportImportDraft[]
    ): Promise<{ success: boolean; error?: string; appendedCount?: number }> => {
      if (!data?.headers?.length || !typeHeader) {
        return { success: false, error: 'Données non chargées ou colonne TYPE absente.' };
      }
      setCsvWriteLoading(true);
      setAddMessage(null);
      try {
        const newRows: Record<string, string>[] = [];
        for (const d of drafts) {
          const built = buildManualSupportRow(
            { date: d.date, title: d.title, amount: d.amount, currency: d.currency, projet: '' },
            data,
            typeHeader,
            null
          );
          if (built.error || !built.row) {
            return { success: false, error: built.error ?? 'Erreur sur une ligne du lot.' };
          }
          if (d.account.trim()) {
            const accountH =
              ensureHeadersForWrite(data.headers).find((h) => /^account$/i.test(h)) ??
              data.headers.find((h) => /^account$/i.test(h));
            if (accountH) built.row[accountH] = d.account.trim();
          }
          newRows.push(built.row);
        }
        const mergedRows = [...data.rows.map((r) => ({ ...r })), ...newRows];
        const nextOrigins = [...rowOrigins, ...newRows.map(() => 'support' as const)];
        const result = await persistMergedFiles(mergedRows, data.headers, nextOrigins);
        if (result.success) {
          loadData({ silent: true });
          return { success: true, appendedCount: newRows.length };
        }
        return { success: false, error: result.error ?? "Erreur lors de l'enregistrement." };
      } finally {
        setCsvWriteLoading(false);
      }
    },
    [data, typeHeader, buildManualSupportRow, persistMergedFiles, loadData, rowOrigins]
  );

  const supportPrepWizard = useSupportImportPrepWizard({
    onImportLines: handleImportSupportWizardLines,
  });

  const toggleImportModuleExpanded = useCallback(() => {
    setImportModuleExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(SUPPORT_IMPORT_MODULE_EXPANDED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const openEditModal = useCallback(
    (dataRowIndex: number) => {
      if (!data?.rows[dataRowIndex] || !typeHeader) return;
      const row = data.rows[dataRowIndex];
      if (!isManualRow(row)) return;

      const dateH = data.headers.find((h) => /date/i.test(h));
      const titleH = data.headers.find((h) => /^title$/i.test(h));
      const amountH = data.headers.find((h) => /^amount$/i.test(h));
      const currencyH = data.headers.find((h) => /^currency$/i.test(h));
      if (!dateH || !titleH || !amountH || !currencyH) return;

      setEditDataRowIndex(dataRowIndex);
      setEditDate((row[dateH] ?? '').trim());
      setEditTitle((row[titleH] ?? '').trim());
      setEditAmount((row[amountH] ?? '').trim());
      setEditCurrency(((row[currencyH] ?? '').trim().toUpperCase() || 'EUR').slice(0, 3));
      setEditMessage(null);
      setEditOpen(true);
    },
    [data, typeHeader, isManualRow]
  );

  const handleSaveEdit = useCallback(async () => {
    if (!data || editDataRowIndex == null || !typeHeader) return;
    const original = data.rows[editDataRowIndex];
    if (!original || !isManualRow(original)) {
      setEditMessage('Ligne introuvable ou non modifiable.');
      return;
    }
    const projetH = data.headers.find((h) => /^projet$/i.test(h));
    const draft: DraftFields = {
      date: editDate,
      title: editTitle,
      amount: editAmount,
      currency: editCurrency,
      projet: projetH ? (original[projetH] ?? '').trim() : '',
    };
    const built = buildManualSupportRow(draft, data, typeHeader, original);
    if (built.error) {
      setEditMessage(built.error);
      return;
    }

    setCsvWriteLoading(true);
    setEditMessage(null);
    try {
      const nextRows = data.rows.map((r, i) => (i === editDataRowIndex ? built.row : { ...r }));
      const result = await persistMergedFiles(nextRows, data.headers, rowOrigins);
      if (result.success) {
        closeEditModal();
        loadData({ silent: true });
      } else {
        setEditMessage(result.error ?? "Erreur lors de l'enregistrement.");
      }
    } finally {
      setCsvWriteLoading(false);
    }
  }, [
    data,
    editDataRowIndex,
    typeHeader,
    editDate,
    editTitle,
    editAmount,
    editCurrency,
    buildManualSupportRow,
    persistMergedFiles,
    loadData,
    closeEditModal,
    isManualRow,
    rowOrigins,
  ]);

  const handleDeleteManualRow = useCallback(
    async (dataRowIndex: number) => {
      if (!data?.rows[dataRowIndex] || !typeHeader) return;
      const row = data.rows[dataRowIndex];
      if (!isManualRow(row)) return;
      if (!window.confirm('Supprimer cette ligne saisie manuellement ? Cette action est enregistrée dans le fichier.')) {
        return;
      }

      setCsvWriteLoading(true);
      setAddMessage(null);
      try {
        const nextRows = data.rows.filter((_, i) => i !== dataRowIndex);
        const nextOrigins = rowOrigins.filter((_, i) => i !== dataRowIndex);
        const result = await persistMergedFiles(nextRows, data.headers, nextOrigins);
        if (result.success) {
          setAddMessage('Ligne supprimée.');
          loadData({ silent: true });
        } else {
          setAddMessage(result.error ?? 'Erreur lors de la suppression.');
        }
      } finally {
        setCsvWriteLoading(false);
      }
    },
    [data, typeHeader, isManualRow, persistMergedFiles, loadData, rowOrigins]
  );

  const isFileImportedSupportRow = useCallback(
    (row: Record<string, string>) => !isManualRow(row),
    [isManualRow]
  );

  const handleToggleSoutienIgnoreRow = useCallback(
    async (dataRowIndex: number) => {
      if (!data?.rows[dataRowIndex] || !typeHeader) return;
      if (rowOrigins[dataRowIndex] !== 'src') return;
      const row = data.rows[dataRowIndex];
      if (!isFileImportedSupportRow(row)) return;

      const headers = ensureHeadersForWrite(data.headers);
      const ignoreH = headers.find((h) => /^soutien_ignorer$/i.test(h));
      if (!ignoreH) return;

      const currentlyIgnored = isRowIgnoredForSoutienTotals(row, ignoreH);
      const nextVal = currentlyIgnored ? '' : '1';

      setCsvWriteLoading(true);
      setAddMessage(null);
      try {
        const nextRows = data.rows.map((r, i) =>
          i === dataRowIndex ? { ...r, [ignoreH]: nextVal } : { ...r }
        );
        const result = await persistMergedFiles(nextRows, data.headers, rowOrigins);
        if (result.success) {
          setAddMessage(currentlyIgnored ? 'Ligne réactivée pour les totaux.' : 'Ligne ignorée pour les totaux.');
          loadData({ silent: true });
        } else {
          setAddMessage(result.error ?? 'Erreur lors de l’enregistrement.');
        }
      } finally {
        setCsvWriteLoading(false);
      }
    },
    [data, typeHeader, isFileImportedSupportRow, persistMergedFiles, loadData, rowOrigins]
  );

  const handleSetProjetRow = useCallback(
    async (dataRowIndex: number, projectId: string) => {
      if (!data?.rows[dataRowIndex] || !typeHeader) return;
      const headers = ensureHeadersForWrite(data.headers);
      const projetH = headers.find((h) => /^projet$/i.test(h));
      if (!projetH) return;
      setCsvWriteLoading(true);
      setAddMessage(null);
      try {
        const nextRows = data.rows.map((r, i) =>
          i === dataRowIndex ? { ...r, [projetH]: projectId } : { ...r }
        );
        const result = await persistMergedFiles(nextRows, data.headers, rowOrigins);
        if (result.success) loadData({ silent: true });
        else setAddMessage(result.error ?? 'Erreur lors de l’enregistrement.');
      } finally {
        setCsvWriteLoading(false);
      }
    },
    [data, typeHeader, persistMergedFiles, loadData, rowOrigins]
  );

  return (
    <>
      <main className="flex-1 flex flex-col min-w-0 p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3">
            <h1 className="text-2xl font-bold text-gray-800">Soutien</h1>
            <p className="text-sm text-gray-600 max-w-3xl">
              Liste des transactions de type « Support » (fusion de {SOURCE_DATA_PATH} et de{' '}
              {SUPPORT_DATA_CSV_PATH}). Les lignes importées affichent « {TRANSACTION_SOURCE_VALUE_FILE} » ; une
              saisie ajoutée ici est enregistrée dans Support_data.csv avec la source « {TRANSACTION_SOURCE_VALUE_MANUAL}
              ». Vous pouvez modifier ou supprimer uniquement ces lignes saisies depuis cette page.
            </p>
          </div>
          <div
            className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5 shadow-sm"
            role="group"
            aria-label="Devise d'affichage"
          >
            {DISPLAY_CURRENCIES.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => setDisplayCurrencyPersist(value)}
                aria-pressed={displayCurrency === value}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  displayCurrency === value
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4 bg-white rounded-lg shadow p-4 border border-gray-200">
          <div
            className="flex items-center justify-between gap-3 mb-0 cursor-pointer select-none"
            onClick={toggleImportModuleExpanded}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggleImportModuleExpanded();
              }
            }}
            aria-expanded={importModuleExpanded}
            aria-controls="support-import-module"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-block transition-transform duration-200 text-gray-500 shrink-0"
                style={{ transform: importModuleExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                aria-hidden
              >
                ▼
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-gray-800">Import wizard</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {importModuleExpanded ? 'Fermer' : 'Ouvrir'} le module d&apos;importation vers{' '}
                  Support_data.csv (collage tableur)
                </p>
              </div>
            </div>
          </div>
          {importModuleExpanded && (
            <div id="support-import-module" className="mt-3">
              <div
                className="rounded-lg border border-gray-200 bg-gray-50/50 p-4"
                aria-label="Zone Import wizard"
              >
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Préparation de l&apos;import</h3>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void supportPrepWizard.handleImportLinesToSupport()}
                        disabled={
                          csvWriteLoading ||
                          supportPrepWizard.importLinesLoading ||
                          !supportPrepWizard.mappingWizardActive ||
                          !supportPrepWizard.supportImportWizardModel?.rows.length ||
                          supportPrepWizard.importPreviewImportableRows.length === 0
                        }
                        title={
                          !supportPrepWizard.mappingWizardActive
                            ? 'Activez le mapping wizard pour préparer l’import vers Support_data.csv'
                            : supportPrepWizard.importPreviewImportableRows.length === 0
                              ? 'Aucune ligne importable (ignorées ou invalides) avec les réglages actuels'
                              : undefined
                        }
                        className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {supportPrepWizard.importLinesLoading ? 'Import…' : 'Importer les lignes'}
                      </button>
                    </div>
                  </div>
                  <SupportImportPrepSection {...supportPrepWizard} />
                </div>
              </div>
            </div>
          )}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12 text-gray-500">Chargement…</div>
        )}

        {error && !loading && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">{error}</div>
        )}

        {data && !loading && typeHeader && (
          <div className="mb-4 rounded-lg border border-gray-200 bg-white shadow-sm p-4 space-y-3">
              <h2 className="text-lg font-semibold text-gray-800">Ajouter une ligne Support</h2>
              <p className="text-sm text-gray-600">
                La ligne est ajoutée à la fin du fichier (réindexation automatique). Les autres lignes (fichier importé) ne
                sont pas modifiables ici.
              </p>
              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-4xl"
                data-support-add-form
              >
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-gray-700">Date</span>
                  <input
                    type="text"
                    value={draftDate}
                    onChange={(e) => setDraftDate(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Tab' || e.shiftKey) return;
                      const monthKey = inferMonthKeyFromDateDraft(draftDate);
                      const completed = completeDateForMonth(draftDate, monthKey);
                      if (completed && draftDate.trim() !== completed) {
                        e.preventDefault();
                        setDraftDate(completed);
                        focusNextSupportDraftInput(e.currentTarget);
                        return;
                      }
                      if (draftDateSuggestions.length > 0) {
                        const first = draftDateSuggestions[0];
                        if (draftDate.trim() !== first) {
                          e.preventDefault();
                          setDraftDate(first);
                          focusNextSupportDraftInput(e.currentTarget);
                        }
                      }
                    }}
                    list={draftDateSuggestions.length > 0 ? 'support-draft-date-suggestions' : undefined}
                    placeholder="JJ.MM.AAAA ou JJ/MM/AAAA"
                    autoComplete="off"
                    className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                    disabled={csvWriteLoading}
                  />
                  {draftDateSuggestions.length > 0 && (
                    <datalist id="support-draft-date-suggestions">
                      {draftDateSuggestions.map((value) => (
                        <option key={value} value={value} />
                      ))}
                    </datalist>
                  )}
                </label>
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span className="font-medium text-gray-700">Libellé (TITLE)</span>
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Tab' || e.shiftKey) return;
                      if (draftTitleSuggestions.length === 0) return;
                      const first = draftTitleSuggestions[0].value;
                      if (draftTitle.trim() === first) return;
                      e.preventDefault();
                      setDraftTitle(first);
                      focusNextSupportDraftInput(e.currentTarget);
                    }}
                    list={draftTitleSuggestions.length > 0 ? 'support-draft-title-suggestions' : undefined}
                    autoComplete="off"
                    className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                    disabled={csvWriteLoading}
                  />
                  {draftTitleSuggestions.length > 0 && (
                    <datalist id="support-draft-title-suggestions">
                      {draftTitleSuggestions.map((s) => (
                        <option key={`${s.value}-${s.count}`} value={s.value} />
                      ))}
                    </datalist>
                  )}
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-gray-700">Montant (AMOUNT)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={draftAmount}
                    onChange={(e) => setDraftAmount(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Tab' || e.shiftKey) return;
                      if (draftAmountSuggestions.length === 0) return;
                      const first = draftAmountSuggestions[0].value;
                      if (draftAmount.trim() === first) return;
                      e.preventDefault();
                      setDraftAmount(first);
                      focusNextSupportDraftInput(e.currentTarget);
                    }}
                    list={draftAmountSuggestions.length > 0 ? 'support-draft-amount-suggestions' : undefined}
                    autoComplete="off"
                    className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                    disabled={csvWriteLoading}
                  />
                  {draftAmountSuggestions.length > 0 && (
                    <datalist id="support-draft-amount-suggestions">
                      {draftAmountSuggestions.map((s) => (
                        <option key={`${s.value}-${s.count}`} value={s.value} />
                      ))}
                    </datalist>
                  )}
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-gray-700">Devise</span>
                  <select
                    value={draftCurrency}
                    onChange={(e) => setDraftCurrency(e.target.value)}
                    className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
                    disabled={csvWriteLoading}
                  >
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="CHF">CHF</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-gray-700">Projet</span>
                  <ProjetSelectCell
                    rawId={draftProjet}
                    projects={projects}
                    disabled={csvWriteLoading}
                    onChange={setDraftProjet}
                    className="border-gray-300"
                  />
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleAppendSupportLine()}
                  disabled={csvWriteLoading || !isSupportDraftComplete}
                  className="rounded border px-3 py-1.5 text-sm font-medium border-blue-600 bg-blue-600 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:border-blue-300 disabled:bg-blue-300 disabled:text-white/80 disabled:hover:bg-blue-300"
                >
                  {csvWriteLoading ? 'Enregistrement…' : 'Ajouter la ligne dans Support_data.csv'}
                </button>
                <button
                  type="button"
                  onClick={resetDraft}
                  disabled={csvWriteLoading || isSupportDraftEmpty}
                  className="rounded border px-3 py-1.5 text-sm font-medium border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400 disabled:hover:bg-gray-100"
                >
                  Effacer la saisie
                </button>
                {addMessage && (
                  <p className={`text-sm rounded border px-2 py-1 ${uiMessageClass(getUiMessageTone(addMessage))}`}>
                    {addMessage}
                  </p>
                )}
              </div>
          </div>
        )}

        {data && !loading && !typeHeader && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">
            Colonne TYPE introuvable dans le fichier source.
          </div>
        )}

        {data && !loading && typeHeader && (
          <div className="flex flex-col gap-6">
            <p className="text-sm text-gray-600">
              {supportRowsOnly.length} ligne{supportRowsOnly.length !== 1 ? 's' : ''} au total (type Support). Pour les
              lignes issues du fichier « {TRANSACTION_SOURCE_VALUE_FILE} », le bouton Ignorer exclut la ligne des totaux
              par titre et des sommes par année (réversible). Les récapitulatifs par libellé (TITLE) et par projet (PROJET)
              sont au-dessus des blocs par année ; chaque bloc se développe ou se replie au clic. La recherche globale filtre
              aussi ces récapitulatifs. Les années sont en ordre croissant.
            </p>
            {supportRowsOnly.length === 0 ? (
              <p className="text-sm text-gray-500 px-2 py-6 text-center rounded-lg border border-dashed border-gray-200">
                Aucune ligne Support.
              </p>
            ) : (
              <>
                <div className="rounded-xl border-2 border-blue-200/80 bg-gradient-to-br from-blue-50/90 to-white px-4 py-3 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
                    <label
                      htmlFor="soutien-global-search"
                      className="text-sm font-semibold text-gray-900 shrink-0 sm:pt-0.5"
                    >
                      Recherche globale
                    </label>
                    <div className="flex flex-1 flex-wrap items-center gap-2 min-w-0">
                      <input
                        id="soutien-global-search"
                        type="search"
                        autoComplete="off"
                        value={globalSearchText}
                        onChange={(e) => setGlobalSearchText(e.target.value)}
                        placeholder="Toutes colonnes, toutes les années…"
                        disabled={csvWriteLoading}
                        className="flex-1 min-w-[12rem] rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-inner focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        aria-describedby="soutien-global-search-hint"
                      />
                      {globalSearchText.trim() ? (
                        <button
                          type="button"
                          onClick={() => setGlobalSearchText('')}
                          disabled={csvWriteLoading}
                          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          Effacer
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <p id="soutien-global-search-hint" className="text-xs text-gray-600 mt-2">
                    S&apos;applique à chaque tableau en même temps (toutes colonnes visibles). Tant que ce champ n&apos;est
                    pas vide, les filtres par tableau ci-dessous sont ignorés.
                  </p>
                </div>
                <section
                  className="flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden"
                  aria-labelledby="soutien-bloc-titre-by-title"
                >
                  <header
                    className={`bg-gradient-to-br from-slate-50 to-white ${
                      titleTotalsBlockExpanded ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
                    }`}
                  >
                    <button
                      type="button"
                      className="w-full px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
                      aria-expanded={titleTotalsBlockExpanded}
                      aria-controls={
                        titleTotalsBlockExpanded ? 'soutien-panel-by-title-totals' : undefined
                      }
                      onClick={() => setTitleTotalsBlockExpanded((e) => !e)}
                    >
                      <span
                        className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
                          titleTotalsBlockExpanded ? 'rotate-90' : ''
                        }`}
                        aria-hidden
                      >
                        ▶
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          id="soutien-bloc-titre-by-title"
                          className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight"
                        >
                          Totaux par titre (libellé)
                        </span>
                        <span className="block text-sm text-gray-500 mt-1.5">
                          {globalSearchText.trim()
                            ? `${supportRowsForTitleTotals.length} ligne${supportRowsForTitleTotals.length !== 1 ? 's' : ''} après recherche globale (hors ignorées)`
                            : `${supportRowsForAggregates.length} ligne${supportRowsForAggregates.length !== 1 ? 's' : ''} comptée${supportRowsForAggregates.length !== 1 ? 's' : ''} dans ce récapitulatif${
                                supportRowsOnly.length > supportRowsForAggregates.length
                                  ? ` · ${supportRowsOnly.length - supportRowsForAggregates.length} ignorée${supportRowsOnly.length - supportRowsForAggregates.length !== 1 ? 's' : ''}`
                                  : ''
                              }`}
                          {titleTotalsByTitle.length > 0
                            ? ` · ${titleTotalsByTitle.length} titre${titleTotalsByTitle.length !== 1 ? 's' : ''} distinct${titleTotalsByTitle.length !== 1 ? 's' : ''}${
                                titleCombineActive &&
                                titleTotalsDisplayRows.length !== titleTotalsByTitle.length
                                  ? ` · ${titleTotalsDisplayRows.length} ligne${titleTotalsDisplayRows.length !== 1 ? 's' : ''} affichée${titleTotalsDisplayRows.length !== 1 ? 's' : ''} (regroupements)`
                                  : ''
                              }`
                            : ''}
                        </span>
                      </span>
                    </button>
                  </header>
                  {titleTotalsBlockExpanded ? (
                    <div
                      id="soutien-panel-by-title-totals"
                      className="flex flex-col min-h-0 px-4 pb-4 pt-3"
                      role="region"
                      aria-label="Sommes par libellé"
                    >
                      {!titleColumnHeader || (!amountColumnHeader && !amountGbpHeader) ? (
                        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          {!titleColumnHeader && !amountColumnHeader && !amountGbpHeader
                            ? 'Colonnes TITLE, AMOUNT et AMOUNT GBP introuvables — récapitulatif indisponible.'
                            : !titleColumnHeader
                              ? 'Colonne TITLE introuvable — récapitulatif par titre indisponible.'
                              : 'Colonnes AMOUNT et AMOUNT GBP introuvables — récapitulatif indisponible.'}
                        </p>
                      ) : titleTotalsByTitle.length === 0 ? (
                        <p className="text-sm text-gray-500 py-4 text-center border border-dashed border-gray-200 rounded-lg">
                          Aucune ligne avec montant exploitable pour construire le récapitulatif.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {(titleTotalsByTitle.length > 0 || titleCombineState.groups.length > 0) && (
                            <div className="rounded-lg border border-slate-200 bg-slate-50/90 overflow-hidden">
                              <button
                                type="button"
                                className="w-full px-3 py-2.5 flex items-start gap-2 text-left hover:bg-slate-100/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
                                aria-expanded={titleCombineState.regroupementPanelExpanded}
                                onClick={() =>
                                  setTitleCombineState((s) => ({
                                    ...s,
                                    regroupementPanelExpanded: !s.regroupementPanelExpanded,
                                  }))
                                }
                              >
                                <span
                                  className={`mt-0.5 shrink-0 text-gray-500 text-xs leading-none transition-transform duration-200 ${
                                    titleCombineState.regroupementPanelExpanded ? 'rotate-90' : ''
                                  }`}
                                  aria-hidden
                                >
                                  ▶
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-gray-900">
                                    Regroupement de libellés
                                  </span>
                                  {!titleCombineState.regroupementPanelExpanded ? (
                                    <span className="block text-xs text-gray-500 mt-0.5">
                                      {titleCombineState.groups.length === 0
                                        ? 'Aucun groupe'
                                        : `${titleCombineState.groups.length} groupe${
                                            titleCombineState.groups.length !== 1 ? 's' : ''
                                          }`}
                                      {titleCombineState.applyCombine
                                        ? ' · appliqué au tableau'
                                        : ' · non appliqué'}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                              {titleCombineState.regroupementPanelExpanded ? (
                                <div className="px-3 pb-3 pt-0 space-y-3 border-t border-slate-200/80">
                                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none shrink-0">
                                      <input
                                        type="checkbox"
                                        checked={titleCombineState.applyCombine}
                                        onChange={(e) =>
                                          setTitleCombineState((s) => ({
                                            ...s,
                                            applyCombine: e.target.checked,
                                          }))
                                        }
                                        disabled={csvWriteLoading}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                      />
                                      Appliquer au tableau
                                    </label>
                                  </div>
                                  <p className="text-xs text-gray-600 leading-relaxed">
                                    Additionnez plusieurs libellés TITLE sous un nom affiché. Les libellés proposés
                                    correspondent au récapitulatif actuel (recherche globale incluse). Un même libellé
                                    ne peut figurer que dans un seul groupe ; le choix dans un groupe le retire des
                                    autres.
                                  </p>
                                  <div className="space-y-2">
                                    {titleCombineState.groups.map((g) => (
                                      <div
                                        key={g.id}
                                        className="rounded-md border border-gray-200 bg-white p-2.5 space-y-2 shadow-sm"
                                      >
                                        <div className="flex flex-wrap items-start gap-2 justify-between">
                                          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 flex-1 min-w-[12rem]">
                                            Nom du libellé combiné
                                            <input
                                              type="text"
                                              value={g.label}
                                              onChange={(e) =>
                                                setTitleCombineState((s) => ({
                                                  ...s,
                                                  groups: s.groups.map((x) =>
                                                    x.id === g.id ? { ...x, label: e.target.value } : x
                                                  ),
                                                }))
                                              }
                                              placeholder="ex. Dons récurrents (total)"
                                              disabled={csvWriteLoading}
                                              className="rounded border border-gray-300 px-2 py-1.5 text-sm font-normal"
                                            />
                                          </label>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setTitleCombineState((s) => ({
                                                ...s,
                                                groups: s.groups.filter((x) => x.id !== g.id),
                                              }))
                                            }
                                            disabled={csvWriteLoading}
                                            className="rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 shrink-0"
                                          >
                                            Supprimer
                                          </button>
                                        </div>
                                        <div className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                                          <span>Libellés à additionner (cases à cocher)</span>
                                          <div className="rounded border border-gray-300 bg-white p-2 max-h-52 overflow-auto space-y-1.5">
                                            {titleOptionsForCombineUi.length === 0 ? (
                                              <p className="text-xs text-gray-500">Aucun libellé disponible.</p>
                                            ) : (
                                              titleOptionsForCombineUi.map((opt) => {
                                                const checked = g.titles.includes(opt);
                                                return (
                                                  <label
                                                    key={opt}
                                                    className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer"
                                                  >
                                                    <input
                                                      type="checkbox"
                                                      checked={checked}
                                                      disabled={csvWriteLoading}
                                                      onChange={(e) => {
                                                        const nextTitles = e.target.checked
                                                          ? [...g.titles, opt]
                                                          : g.titles.filter((t) => t !== opt);
                                                        setTitleCombineState((s) => ({
                                                          ...s,
                                                          groups: rebalanceTitleCombineGroups(
                                                            s.groups,
                                                            g.id,
                                                            nextTitles
                                                          ),
                                                        }));
                                                      }}
                                                      className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                    <span>
                                                      {opt}
                                                      {!titleKeysInCurrentTotals.has(opt) ? (
                                                        <span className="text-gray-500"> — hors filtre actuel</span>
                                                      ) : null}
                                                    </span>
                                                  </label>
                                                );
                                              })
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setTitleCombineState((s) => ({
                                        ...s,
                                        groups: [
                                          ...s.groups,
                                          { id: newTitleCombineGroupId(), label: '', titles: [] },
                                        ],
                                      }))
                                    }
                                    disabled={csvWriteLoading}
                                    className="rounded border border-blue-600 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                                  >
                                    Ajouter un regroupement
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          )}
                        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-inner">
                          <div className="overflow-auto max-h-[min(40vh,360px)] overscroll-contain">
                            <table className="w-full border-collapse text-sm min-w-[280px]">
                              <thead className="sticky top-0 bg-gray-100 border-b border-gray-200 z-10">
                                <tr>
                                  <th
                                    scope="col"
                                    className="text-left font-semibold text-gray-700 px-3 py-2 align-bottom"
                                    aria-sort={
                                      titleTotalsTableSort.key === 'title'
                                        ? titleTotalsTableSort.dir === 'asc'
                                          ? 'ascending'
                                          : 'descending'
                                        : 'none'
                                    }
                                  >
                                    <button
                                      type="button"
                                      className="-mx-1 -my-0.5 px-1 py-0.5 rounded text-left w-full min-w-0 font-semibold text-gray-700 hover:bg-gray-200/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                      onClick={() =>
                                        setTitleTotalsTableSort((prev) =>
                                          prev.key === 'title'
                                            ? { key: 'title', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                            : { key: 'title', dir: 'asc' }
                                        )
                                      }
                                    >
                                      <span className="inline-flex items-center gap-1.5">
                                        Titre (libellé)
                                        {titleTotalsTableSort.key === 'title' ? (
                                          <span className="tabular-nums text-xs font-normal text-gray-500" aria-hidden>
                                            {titleTotalsTableSort.dir === 'asc' ? '↑' : '↓'}
                                          </span>
                                        ) : null}
                                      </span>
                                    </button>
                                  </th>
                                  <th
                                    scope="col"
                                    className="text-right font-semibold text-gray-700 px-3 py-2 whitespace-nowrap align-bottom"
                                    aria-sort={
                                      titleTotalsTableSort.key === 'amount'
                                        ? titleTotalsTableSort.dir === 'asc'
                                          ? 'ascending'
                                          : 'descending'
                                        : 'none'
                                    }
                                  >
                                    <div className="flex justify-end">
                                      <button
                                        type="button"
                                        className="-mx-1 -my-0.5 px-1 py-0.5 rounded inline-flex items-center gap-1.5 font-semibold text-gray-700 hover:bg-gray-200/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                        onClick={() =>
                                          setTitleTotalsTableSort((prev) =>
                                            prev.key === 'amount'
                                              ? { key: 'amount', dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                                              : { key: 'amount', dir: 'asc' }
                                          )
                                        }
                                      >
                                        {`Σ ${getDisplayCurrencyCode(displayCurrency)}`}
                                        {titleTotalsTableSort.key === 'amount' ? (
                                          <span className="tabular-nums text-xs font-normal text-gray-500" aria-hidden>
                                            {titleTotalsTableSort.dir === 'asc' ? '↑' : '↓'}
                                          </span>
                                        ) : null}
                                      </button>
                                    </div>
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {titleTotalsDisplayRowsSorted.map((tot) => (
                                  <tr
                                    key={tot.rowKey}
                                    className={`border-b border-gray-100 hover:bg-gray-50/80 ${
                                      tot.rowKey.startsWith('combine:') ? 'bg-blue-50/50' : ''
                                    }`}
                                  >
                                    <td className="px-3 py-2 text-gray-800 align-top">
                                      <div className="font-medium text-gray-900">{tot.displayTitle}</div>
                                      {tot.detail ? (
                                        <div className="text-xs text-gray-500 mt-0.5 leading-snug">{tot.detail}</div>
                                      ) : null}
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900 whitespace-nowrap">
                                      {formatDisplayAmount(tot.totalAmount, displayCurrency)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="bg-slate-100/90 border-t-2 border-slate-300">
                                  <td className="px-3 py-2.5 font-semibold text-gray-900">Total général</td>
                                  <td className="px-3 py-2.5 text-right text-base sm:text-lg font-bold text-slate-900 tabular-nums whitespace-nowrap">
                                    {formatDisplayAmount(titleTotalsGrand, displayCurrency)}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>
                <section
                  className="flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden"
                  aria-labelledby="soutien-bloc-by-project"
                >
                  <header
                    className={`bg-gradient-to-br from-slate-50 to-white ${
                      projectTotalsBlockExpanded ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
                    }`}
                  >
                    <button
                      type="button"
                      className="w-full px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
                      aria-expanded={projectTotalsBlockExpanded}
                      aria-controls={projectTotalsBlockExpanded ? 'soutien-panel-by-project-totals' : undefined}
                      onClick={() => setProjectTotalsBlockExpanded((e) => !e)}
                    >
                      <span
                        className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
                          projectTotalsBlockExpanded ? 'rotate-90' : ''
                        }`}
                        aria-hidden
                      >
                        ▶
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          id="soutien-bloc-by-project"
                          className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight"
                        >
                          Sommes par projet
                        </span>
                        <span className="block text-sm text-gray-500 mt-1.5">
                          {globalSearchText.trim()
                            ? `${supportRowsForTitleTotals.length} ligne${supportRowsForTitleTotals.length !== 1 ? 's' : ''} après recherche globale (hors ignorées)`
                            : `${supportRowsForAggregates.length} ligne${supportRowsForAggregates.length !== 1 ? 's' : ''} comptée${supportRowsForAggregates.length !== 1 ? 's' : ''} dans ce récapitulatif${
                                supportRowsOnly.length > supportRowsForAggregates.length
                                  ? ` · ${supportRowsOnly.length - supportRowsForAggregates.length} ignorée${supportRowsOnly.length - supportRowsForAggregates.length !== 1 ? 's' : ''}`
                                  : ''
                              }`}
                          {projectTotalsList.length > 0
                            ? ` · ${projectTotalsList.length} projet${projectTotalsList.length !== 1 ? 's' : ''}${
                                projectSubtotalActive && projectSubtotalDisplayRows.length > 0
                                  ? ` · ${projectSubtotalDisplayRows.length} sous-total${projectSubtotalDisplayRows.length !== 1 ? 's' : ''}`
                                  : ''
                              }`
                            : ''}
                        </span>
                      </span>
                    </button>
                  </header>
                  {projectTotalsBlockExpanded ? (
                    <div
                      id="soutien-panel-by-project-totals"
                      className="flex flex-col min-h-0 px-4 pb-4 pt-3"
                      role="region"
                      aria-label="Sommes par projet"
                    >
                      {!projetColumnHeader || (!amountColumnHeader && !amountGbpHeader) ? (
                        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                          {!projetColumnHeader && !amountColumnHeader && !amountGbpHeader
                            ? 'Colonnes PROJET, AMOUNT et AMOUNT GBP introuvables — récapitulatif indisponible.'
                            : !projetColumnHeader
                              ? 'Colonne PROJET introuvable — récapitulatif par projet indisponible.'
                              : 'Colonnes AMOUNT et AMOUNT GBP introuvables — récapitulatif indisponible.'}
                        </p>
                      ) : projectTotalsList.length === 0 ? (
                        <p className="text-sm text-gray-500 py-4 text-center border border-dashed border-gray-200 rounded-lg">
                          Aucune ligne avec montant exploitable pour construire le récapitulatif par projet.
                        </p>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {(projectTotalsList.length > 0 || projectSubtotalState.groups.length > 0) && (
                            <div className="rounded-lg border border-slate-200 bg-slate-50/90 overflow-hidden">
                              <button
                                type="button"
                                className="w-full px-3 py-2.5 flex items-start gap-2 text-left hover:bg-slate-100/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
                                aria-expanded={projectSubtotalState.panelExpanded}
                                onClick={() =>
                                  setProjectSubtotalState((s) => ({
                                    ...s,
                                    panelExpanded: !s.panelExpanded,
                                  }))
                                }
                              >
                                <span
                                  className={`mt-0.5 shrink-0 text-gray-500 text-xs leading-none transition-transform duration-200 ${
                                    projectSubtotalState.panelExpanded ? 'rotate-90' : ''
                                  }`}
                                  aria-hidden
                                >
                                  ▶
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-semibold text-gray-900">
                                    Calculer un sous-total
                                  </span>
                                  {!projectSubtotalState.panelExpanded ? (
                                    <span className="block text-xs text-gray-500 mt-0.5">
                                      {projectSubtotalState.groups.length === 0
                                        ? 'Aucun sous-total'
                                        : `${projectSubtotalState.groups.length} sous-total${
                                            projectSubtotalState.groups.length !== 1 ? 's' : ''
                                          }`}
                                      {projectSubtotalState.applySubtotals
                                        ? ' · appliqué au tableau'
                                        : ' · non appliqué'}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
                              {projectSubtotalState.panelExpanded ? (
                                <div className="px-3 pb-3 pt-0 space-y-3 border-t border-slate-200/80">
                                  <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none shrink-0">
                                      <input
                                        type="checkbox"
                                        checked={projectSubtotalState.applySubtotals}
                                        onChange={(e) =>
                                          setProjectSubtotalState((s) => ({
                                            ...s,
                                            applySubtotals: e.target.checked,
                                          }))
                                        }
                                        disabled={csvWriteLoading}
                                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                      />
                                      Appliquer au tableau
                                    </label>
                                  </div>
                                  <p className="text-xs text-gray-600 leading-relaxed">
                                    Additionnez plusieurs projets sous un nom affiché pour obtenir un sous-total. Les
                                    projets proposés correspondent au récapitulatif actuel (recherche globale incluse).
                                    Un même projet ne peut figurer que dans un seul sous-total ; le choix dans un
                                    sous-total le retire des autres. Les lignes projets restent affichées ; les
                                    sous-totaux apparaissent juste avant le total général.
                                  </p>
                                  <div className="space-y-2">
                                    {projectSubtotalState.groups.map((g) => (
                                      <div
                                        key={g.id}
                                        className="rounded-md border border-gray-200 bg-white p-2.5 space-y-2 shadow-sm"
                                      >
                                        <div className="flex flex-wrap items-start gap-2 justify-between">
                                          <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 flex-1 min-w-[12rem]">
                                            Nom du sous-total
                                            <input
                                              type="text"
                                              value={g.label}
                                              onChange={(e) =>
                                                setProjectSubtotalState((s) => ({
                                                  ...s,
                                                  groups: s.groups.map((x) =>
                                                    x.id === g.id ? { ...x, label: e.target.value } : x
                                                  ),
                                                }))
                                              }
                                              placeholder="ex. Projets Europe (sous-total)"
                                              disabled={csvWriteLoading}
                                              className="rounded border border-gray-300 px-2 py-1.5 text-sm font-normal"
                                            />
                                          </label>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              setProjectSubtotalState((s) => ({
                                                ...s,
                                                groups: s.groups.filter((x) => x.id !== g.id),
                                              }))
                                            }
                                            disabled={csvWriteLoading}
                                            className="rounded border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 shrink-0"
                                          >
                                            Supprimer
                                          </button>
                                        </div>
                                        <div className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                                          <span>Projets à additionner (cases à cocher)</span>
                                          <div className="rounded border border-gray-300 bg-white p-2 max-h-52 overflow-auto space-y-1.5">
                                            {projectOptionsForSubtotalUi.length === 0 ? (
                                              <p className="text-xs text-gray-500">Aucun projet disponible.</p>
                                            ) : (
                                              projectOptionsForSubtotalUi.map((opt) => {
                                                const checked = g.projectKeys.includes(opt.projectKey);
                                                return (
                                                  <label
                                                    key={opt.projectKey}
                                                    className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer"
                                                  >
                                                    <input
                                                      type="checkbox"
                                                      checked={checked}
                                                      disabled={csvWriteLoading}
                                                      onChange={(e) => {
                                                        const nextKeys = e.target.checked
                                                          ? [...g.projectKeys, opt.projectKey]
                                                          : g.projectKeys.filter((t) => t !== opt.projectKey);
                                                        setProjectSubtotalState((s) => ({
                                                          ...s,
                                                          groups: rebalanceProjectSubtotalGroups(
                                                            s.groups,
                                                            g.id,
                                                            nextKeys
                                                          ),
                                                        }));
                                                      }}
                                                      className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    />
                                                    <span>
                                                      {opt.displayName}
                                                      {!projectKeysInCurrentTotals.has(opt.projectKey) ? (
                                                        <span className="text-gray-500"> — hors filtre actuel</span>
                                                      ) : null}
                                                    </span>
                                                  </label>
                                                );
                                              })
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setProjectSubtotalState((s) => ({
                                        ...s,
                                        groups: [
                                          ...s.groups,
                                          { id: newProjectSubtotalGroupId(), label: '', projectKeys: [] },
                                        ],
                                      }))
                                    }
                                    disabled={csvWriteLoading}
                                    className="rounded border border-blue-600 bg-white px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                                  >
                                    Ajouter un sous-total
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          )}
                          <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-inner">
                            <div className="overflow-auto max-h-[min(40vh,360px)] overscroll-contain">
                              <table className="w-full border-collapse text-sm min-w-[280px]">
                                <thead className="sticky top-0 bg-gray-100 border-b border-gray-200 z-10">
                                  <tr>
                                    <th className="text-left font-semibold text-gray-700 px-3 py-2">Projet</th>
                                    <th className="text-right font-semibold text-gray-700 px-3 py-2 whitespace-nowrap">
                                      {`Σ ${getDisplayCurrencyCode(displayCurrency)}`}
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {projectTotalsList.map((row) => (
                                    <tr
                                      key={row.projectKey}
                                      className="border-b border-gray-100 hover:bg-gray-50/80"
                                    >
                                      <td
                                        className="px-3 py-2 text-gray-800 align-top font-medium"
                                        style={row.color ? projetBackgroundStyle(row.color, 0.22) : undefined}
                                      >
                                        <span
                                          className={
                                            row.projectKey === '__sans_projet__'
                                              ? 'inline-flex rounded px-2 py-0.5 bg-gray-100 text-gray-700'
                                              : 'inline-flex rounded px-2 py-0.5'
                                          }
                                        >
                                          {row.displayName}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900 whitespace-nowrap">
                                        {formatDisplayAmount(row.totalAmount, displayCurrency)}
                                      </td>
                                    </tr>
                                  ))}
                                  {projectSubtotalDisplayRows.map((sub) => (
                                    <tr
                                      key={sub.rowKey}
                                      className="border-b border-gray-100 bg-blue-50/50 hover:bg-blue-50/80"
                                    >
                                      <td className="px-3 py-2 text-gray-800 align-top">
                                        <div className="font-medium text-gray-900">{sub.displayLabel}</div>
                                        <div className="text-xs text-gray-500 mt-0.5 leading-snug">{sub.detail}</div>
                                      </td>
                                      <td className="px-3 py-2 text-right tabular-nums font-medium text-gray-900 whitespace-nowrap">
                                        {formatDisplayAmount(sub.totalAmount, displayCurrency)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="bg-slate-100/90 border-t-2 border-slate-300">
                                    <td className="px-3 py-2.5 font-semibold text-gray-900">Total général</td>
                                    <td className="px-3 py-2.5 text-right text-base sm:text-lg font-bold text-slate-900 tabular-nums whitespace-nowrap">
                                      {formatDisplayAmount(projectTotalsGrand, displayCurrency)}
                                    </td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </section>
                <hr
                  className="h-0 border-0 border-t-2 border-gray-200/90"
                  aria-hidden
                />
                {yearGroupsBase.map((group) => {
                const panel = { ...DEFAULT_YEAR_PANEL, ...yearPanelState[group.yearKey] };
                const globalActive = globalSearchText.trim().length > 0;
                const filtered = filterSupportRowsBySearch(
                  group.rows,
                  globalActive ? globalSearchText : panel.filterText,
                  globalActive ? '__all__' : panel.filterColumn,
                  data?.headers
                );
                const sorted = sortSupportRows(filtered, panel.sortColumn, panel.sortDirection, data?.headers);
                const sortedForSum = sorted.filter(
                  (row) => !isRowIgnoredForSoutienTotals(row, soutienIgnoreHeader)
                );
                const yearTotal = sumDisplayAmountForRows(
                  sortedForSum,
                  displayCurrency,
                  amountColumnHeader,
                  currencyColumnHeader,
                  amountGbpHeader
                );
                const ignoredInSortedView = sorted.length - sortedForSum.length;
                const localFilterActive = panel.filterText.trim().length > 0;
                const filterActive = globalActive || localFilterActive;
                const expanded = isYearBlockExpanded(group.yearKey);

                return (
                  <section
                    key={group.yearKey}
                    className="flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden"
                    aria-labelledby={`soutien-bloc-titre-${group.yearKey}`}
                  >
                    <header
                      className={`bg-gradient-to-br from-slate-50 to-white ${
                        expanded ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
                      }`}
                    >
                      <button
                        type="button"
                        className="w-full px-4 py-3 sm:py-4 text-left flex items-start gap-3 hover:bg-slate-50/90 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset rounded-none"
                        aria-expanded={expanded}
                        aria-controls={expanded ? `soutien-panel-${group.yearKey}` : undefined}
                        onClick={() => toggleYearBlock(group.yearKey)}
                      >
                        <span
                          className={`mt-1.5 shrink-0 text-gray-500 text-sm leading-none transition-transform duration-200 ${
                            expanded ? 'rotate-90' : ''
                          }`}
                          aria-hidden
                        >
                          ▶
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            id={`soutien-bloc-titre-${group.yearKey}`}
                            className="block text-xl sm:text-2xl font-bold text-gray-900 tracking-tight"
                          >
                            {group.year != null ? `Année ${group.sectionTitle}` : group.sectionTitle}
                          </span>
                          <span className="block text-sm text-gray-500 mt-1.5">
                            {group.rows.length} ligne{group.rows.length !== 1 ? 's' : ''} dans ce bloc
                            {filterActive && expanded
                              ? globalActive
                                ? ' — recherche globale active (tous les tableaux)'
                                : ' — filtre de ce tableau actif ci-dessous'
                              : filterActive && !expanded
                                ? globalActive
                                  ? ' — recherche globale active (développez pour voir)'
                                  : ' — filtre de ce tableau actif (développez pour voir)'
                                : ''}
                          </span>
                        </span>
                        {!expanded && (amountColumnHeader || amountGbpHeader) && yearTotal !== null ? (
                          <div className="shrink-0 ml-auto pl-2 self-center text-right min-w-0 sm:max-w-[min(100%,28rem)]">
                            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1">
                              {`Σ ${getDisplayCurrencyCode(displayCurrency)}`}
                            </span>
                            <span className="block text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums leading-tight">
                              {formatDisplayAmount(yearTotal, displayCurrency)}
                            </span>
                          </div>
                        ) : null}
                      </button>
                    </header>
                    {expanded ? (
                      <div
                        id={`soutien-panel-${group.yearKey}`}
                        className="flex flex-col min-h-0"
                        role="region"
                        aria-label={
                          group.year != null
                            ? `Détail année ${group.sectionTitle}`
                            : `Détail : ${group.sectionTitle}`
                        }
                      >
                    <div className="shrink-0 px-4 py-2.5 border-b border-gray-100 bg-gray-50/80 flex flex-wrap items-center gap-3">
                      {globalActive ? (
                        <span className="text-xs font-medium text-amber-900 bg-amber-100/90 border border-amber-200 rounded-md px-2 py-1.5 w-full sm:w-auto">
                          Recherche globale active — filtres de ce tableau sont ignorés.
                        </span>
                      ) : null}
                      <div className="flex items-center gap-2 min-w-0">
                        <label
                          htmlFor={`soutien-col-${group.yearKey}`}
                          className={`text-sm whitespace-nowrap ${globalActive ? 'text-gray-400' : 'text-gray-600'}`}
                        >
                          Colonne
                        </label>
                        <select
                          id={`soutien-col-${group.yearKey}`}
                          value={panel.filterColumn}
                          onChange={(e) => patchYearPanel(group.yearKey, { filterColumn: e.target.value })}
                          className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[120px] disabled:opacity-60"
                          disabled={csvWriteLoading || globalActive}
                          title={globalActive ? 'Désactivé tant que la recherche globale est renseignée.' : undefined}
                        >
                          <option value="__all__">Toutes</option>
                          {yearDisplayHeaders.map((h) => (
                            <option key={h} value={h}>
                              {displaySupportHeaderLabel(h, displayCurrency)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                        <input
                          id={`soutien-search-${group.yearKey}`}
                          type="text"
                          placeholder={
                            globalActive ? 'Filtre local (inactif — recherche globale)' : 'Rechercher dans ce tableau…'
                          }
                          value={panel.filterText}
                          onChange={(e) => patchYearPanel(group.yearKey, { filterText: e.target.value })}
                          className="flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-0 disabled:opacity-60"
                          disabled={csvWriteLoading || globalActive}
                          aria-label={`Rechercher pour ${group.sectionTitle}`}
                          title={globalActive ? 'Désactivé tant que la recherche globale est renseignée.' : undefined}
                        />
                        {panel.filterText && !globalActive ? (
                          <button
                            type="button"
                            onClick={() => patchYearPanel(group.yearKey, { filterText: '' })}
                            className="text-gray-500 hover:text-gray-700 text-sm whitespace-nowrap"
                          >
                            Effacer
                          </button>
                        ) : null}
                      </div>
                      <span className="text-gray-500 text-sm">
                        {sorted.length} / {group.rows.length} affichée{sorted.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="px-4 pt-3 pb-1">
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">Tableau des transactions</p>
                      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden shadow-inner">
                        <div className="overflow-auto max-h-[min(50vh,520px)] min-h-[120px] overscroll-contain">
                      <table className="w-full border-collapse text-sm min-w-[640px]">
                        <thead className="sticky top-0 bg-gray-100 border-b border-gray-200 z-10">
                          <tr>
                            {yearDisplayHeaders.map((h) => (
                              <th
                                key={h}
                                onClick={() => handleSortYear(group.yearKey, h)}
                                className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:bg-gray-200 transition-colors"
                              >
                                <span className="inline-flex items-center gap-1">
                                  {displaySupportHeaderLabel(h, displayCurrency)}
                                  {panel.sortColumn === h && (
                                    <span
                                      className="text-blue-600"
                                      aria-label={panel.sortDirection === 'asc' ? 'Croissant' : 'Décroissant'}
                                    >
                                      {panel.sortDirection === 'asc' ? '↑' : '↓'}
                                    </span>
                                  )}
                                </span>
                              </th>
                            ))}
                            <th className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap bg-gray-100 sticky right-0 z-20 border-l border-gray-200 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.06)]">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sorted.length === 0 ? (
                            <tr>
                              <td
                                colSpan={yearDisplayHeaders.length + 1}
                                className="px-3 py-8 text-center text-sm text-gray-500"
                              >
                                {globalActive
                                  ? 'Aucune ligne ne correspond à la recherche globale pour ce bloc.'
                                  : 'Aucune ligne ne correspond au filtre de ce tableau.'}
                              </td>
                            </tr>
                          ) : (
                            sorted.map((row, i) => {
                              const dataRowIndex = data ? data.rows.findIndex((r) => r === row) : -1;
                              const manual = dataRowIndex >= 0 && isManualRow(row);
                              const fileImported = dataRowIndex >= 0 && isFileImportedSupportRow(row);
                              const ignored = isRowIgnoredForSoutienTotals(row, soutienIgnoreHeader);
                              return (
                                <tr
                                  key={`${group.yearKey}-${dataRowIndex}-${i}`}
                                  className={`border-b border-gray-100 hover:bg-gray-50 ${ignored ? 'opacity-65' : ''}`}
                                >
                                  {yearDisplayHeaders.map((header) => (
                                    <td key={header} className="px-3 py-2 text-gray-800 whitespace-nowrap">
                                      {/^projet$/i.test(header) ? (
                                        dataRowIndex >= 0 ? (
                                          <ProjetSelectCell
                                            rawId={row[header] ?? ''}
                                            projects={projects}
                                            disabled={csvWriteLoading}
                                            onChange={(id) => void handleSetProjetRow(dataRowIndex, id)}
                                          />
                                        ) : (
                                          <ProjetDisplayCell rawId={row[header] ?? ''} projects={projects} />
                                        )
                                      ) : (
                                        soutienCellDisplay(
                                          header,
                                          row[header] ?? '',
                                          row,
                                          displayCurrency,
                                          amountColumnHeader,
                                          currencyColumnHeader,
                                          amountGbpHeader
                                        )
                                      )}
                                    </td>
                                  ))}
                                  <td className="px-2 py-2 whitespace-nowrap bg-gray-50/90 sticky right-0 z-[1] border-l border-gray-100 shadow-[-4px_0_6px_-2px_rgba(0,0,0,0.06)]">
                                    {manual && dataRowIndex >= 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        <button
                                          type="button"
                                          onClick={() => openEditModal(dataRowIndex)}
                                          disabled={csvWriteLoading || editOpen}
                                          className="rounded border border-blue-600 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                                        >
                                          Modifier
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void handleDeleteManualRow(dataRowIndex)}
                                          disabled={csvWriteLoading}
                                          className="rounded border border-red-600 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                                        >
                                          Supprimer
                                        </button>
                                      </div>
                                    ) : fileImported && dataRowIndex >= 0 ? (
                                      <div className="flex flex-wrap gap-1">
                                        <button
                                          type="button"
                                          onClick={() => void handleToggleSoutienIgnoreRow(dataRowIndex)}
                                          disabled={csvWriteLoading}
                                          className={`rounded border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                                            ignored
                                              ? 'border-amber-600 bg-amber-50 text-amber-900 hover:bg-amber-100'
                                              : 'border-gray-500 bg-white text-gray-800 hover:bg-gray-100'
                                          }`}
                                        >
                                          {ignored ? 'Réactiver' : 'Ignorer'}
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-gray-400 text-xs">—</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                        </div>
                      </div>
                    </div>
                    <footer className="mt-2 mx-4 mb-4 px-4 py-4 sm:py-5 rounded-lg border-2 border-slate-300 bg-gradient-to-b from-slate-50 to-slate-100/90 shadow-sm">
                      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 text-left mb-3">
                        Total du bloc {group.year != null ? group.year : `« ${group.sectionTitle} »`}
                      </p>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
                        <p className="text-sm text-gray-600 text-left shrink-0">
                          <span className="font-medium text-gray-800">Synthèse</span>
                          <span className="text-gray-600">
                            {' '}
                            ({sortedForSum.length} ligne{sortedForSum.length !== 1 ? 's' : ''} comptée
                            {sortedForSum.length !== 1 ? 's' : ''} dans la somme
                            {ignoredInSortedView > 0
                              ? ` · ${ignoredInSortedView} ignorée${ignoredInSortedView !== 1 ? 's' : ''} exclue${ignoredInSortedView !== 1 ? 's' : ''}`
                              : ''}
                            {globalActive
                              ? ', recherche globale'
                              : localFilterActive
                                ? ', filtre du tableau appliqué'
                                : ''}
                            )
                          </span>
                        </p>
                        {(amountColumnHeader || amountGbpHeader) && yearTotal !== null && (
                          <div className="text-right min-w-0 sm:max-w-[min(100%,28rem)]">
                            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1">
                              {`Σ ${getDisplayCurrencyCode(displayCurrency)}`}
                            </span>
                            <span className="block text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums leading-tight">
                              {formatDisplayAmount(yearTotal, displayCurrency)}
                            </span>
                          </div>
                        )}
                        {!amountColumnHeader && !amountGbpHeader && (
                          <p className="text-sm text-gray-500 text-left sm:text-right sm:ml-auto">
                            Colonnes AMOUNT et AMOUNT GBP absentes — total non calculé
                          </p>
                        )}
                      </div>
                    </footer>
                      </div>
                    ) : null}
                  </section>
                );
              })}
              </>
            )}
          </div>
        )}
      </main>

      {editOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="soutien-edit-title"
          onClick={() => !csvWriteLoading && closeEditModal()}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="soutien-edit-title" className="text-lg font-semibold text-gray-900">
              Modifier la ligne (saisie manuelle)
            </h2>
            <div className="grid grid-cols-1 gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Date</span>
                <input
                  type="text"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                  disabled={csvWriteLoading}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Libellé (TITLE)</span>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                  disabled={csvWriteLoading}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Montant (AMOUNT)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                  disabled={csvWriteLoading}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-gray-700">Devise</span>
                <select
                  value={editCurrency}
                  onChange={(e) => setEditCurrency(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm bg-white"
                  disabled={csvWriteLoading}
                >
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="CHF">CHF</option>
                </select>
              </label>
            </div>
            {editMessage && (
              <p className={`text-sm rounded border px-2 py-1 ${uiMessageClass(getUiMessageTone(editMessage))}`}>
                {editMessage}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeEditModal}
                disabled={csvWriteLoading}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={csvWriteLoading}
                className="rounded border border-blue-600 bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {csvWriteLoading ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Support;
