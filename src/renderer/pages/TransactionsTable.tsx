/// <reference path="../vite-env.d.ts" />
import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { transactionsImportFile } from '@/shared/dataPaths';
import {
  SourceDataCSVService,
  type SourceDataResult,
  SOURCE_DATA_PATH,
  normalizeOrderAndIndex,
  stripSourceColumnFromSourceData,
} from '../services/SourceDataCSVService';
import { TRANSACTION_SOURCE_HEADERS as TRANSACTION_SOURCE_HEADERS_FALLBACK } from '@/shared/sourceDataTypes';
import {
  buildTransactionAnomalyContextFromStorage,
  detectAnomalies,
  EXCLUDE_ANOMALY_COLUMN,
} from '../services/AnomalyDetectionService';
import { canonicalAccountFromSource, accountLabelFromSource } from '../constants/accountSourceLabels';
import { formatDateDDMMYYYY, formatAmountForRowCurrency, formatFx, formatCurrency } from '../utils/format';
import { getEffectiveRates, getCachedWorkingCurrencies } from '../services/EffectiveExchangeRates';
import {
  isAmountGbpIndicatorReadOnly,
  syncTransactionAmountCurrencyOnEdit,
} from '../utils/syncTransactionAmountCurrency';
import { isAmountIndicatorHeader, currencyDisplaySymbol } from '@/shared/workingCurrencies';

import { AnomalyExceptionsModal } from '../components/AnomalyExceptionsModal';
import TransactionsImportPrepSection from '../components/TransactionsImportPrepSection';
import { useTransactionsImportPrepWizard } from '../hooks/useTransactionsImportPrepWizard';
import { getUiMessageTone, uiMessageClass } from '../utils/uiMessageTone';
import { buildAccountAliasLookup } from '@/shared/transactionsImportCore';
import { loadRecognisedAccountsFromStorage } from '../constants/recognisedAccountsStorage';
import { useProjectsFromStorage } from '../hooks/useProjectsFromStorage';
import { ProjetDisplayCell, ProjetSelectCell } from '../components/ProjetColumnCells';
import { ResizableTableHeadCell } from '../components/Common/ResizableTableHeadCell';
import {
  defaultEditColumnWidth,
  useResizableTableColumns,
  type ResizableColumnDef,
} from '../hooks/useResizableTableColumns';
import { formatAnomalyReasons } from '../i18n/formatAnomalyReason';

const ANOMALY_STATUS_STORAGE_KEY = 'transactions-anomaly-status';
const ANOMALY_LAST_REPORT_STORAGE_KEY = 'transactions-anomaly-last-report';

/** Clé de tri pour la colonne Anomalie (mode édition). */
const ANOMALY_SORT_COLUMN_KEY = '__anomaly__';
/** Clé du filtre « rechercher dans la colonne Anomalie » (barre de recherche, mode édition). */
const ANOMALY_FILTER_COLUMN_KEY = '__anomaly_filter__';

/** Persistance replier/déplier des blocs Import wizard et détection d’anomalies. */
const TX_IMPORT_MODULE_EXPANDED_KEY = 'transactions-import-module-expanded';
const TX_ANOMALY_MODULE_EXPANDED_KEY = 'transactions-anomaly-module-expanded';

/** Valeur du sélecteur de période : tout le tableau (getAll). */
const TX_VIEW_ALL_KEY = '__all__';
/** Persistance de la période affichée (mois `YYYY-MM` ou {@link TX_VIEW_ALL_KEY}). */
const TX_VIEW_PERIOD_STORAGE_KEY = 'transactions-table-view-period';
const TX_TABLE_COL_WIDTHS_KEY = 'transactions-table-col-widths';

function readModuleExpandedFromStorage(key: string): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === 'false') return false;
    if (v === 'true') return true;
  } catch {
    /* ignore */
  }
  return true;
}

function readViewPeriodFromStorage(): string {
  try {
    const saved = localStorage.getItem(TX_VIEW_PERIOD_STORAGE_KEY);
    if (saved === TX_VIEW_ALL_KEY) return TX_VIEW_ALL_KEY;
    if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
  } catch {
    /* ignore */
  }
  return '';
}

function persistViewPeriod(key: string): void {
  try {
    if (key) localStorage.setItem(TX_VIEW_PERIOD_STORAGE_KEY, key);
  } catch {
    /* ignore */
  }
}

/** Formate une date ISO en "DD/MM/YYYY HH:mm" (sans préfixe). */
function formatReportDateParts(iso: string): { date: string; time: string } | null {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return { date: `${day}/${month}/${year}`, time: `${h}:${min}` };
  } catch {
    return null;
  }
}

/** Parse une cellule date en Date ou null (ISO ou JJ/MM/AAAA, JJ.MM.AAAA). */
function parseDateFromCell(raw: string): Date | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
  const mi = s.match(iso);
  if (mi) {
    const y = parseInt(mi[1], 10);
    const m = parseInt(mi[2], 10);
    const d = parseInt(mi[3], 10);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const md = s.match(dmy);
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
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** Copie profonde pour annuler le mode édition sans écraser le fichier. */
function cloneSourceDataResult(source: SourceDataResult): SourceDataResult {
  return {
    headers: [...source.headers],
    rows: source.rows.map((row) => ({ ...row })),
  };
}

function isSourceDataResultEqual(a: SourceDataResult, b: SourceDataResult): boolean {
  if (a.headers.length !== b.headers.length) return false;
  for (let i = 0; i < a.headers.length; i++) {
    if (a.headers[i] !== b.headers[i]) return false;
  }
  if (a.rows.length !== b.rows.length) return false;
  for (let i = 0; i < a.rows.length; i++) {
    const ra = a.rows[i];
    const rb = b.rows[i];
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    for (const k of keys) {
      if ((ra[k] ?? '') !== (rb[k] ?? '')) return false;
    }
  }
  return true;
}

function isTransactionsEditSessionDirty(
  data: SourceDataResult | null,
  baseline: SourceDataResult | null,
  rowsToDelete: Set<number>
): boolean {
  if (!data || !baseline) return false;
  if (rowsToDelete.size > 0) return true;
  return !isSourceDataResultEqual(data, baseline);
}

const TransactionsTable: React.FC = () => {
  const { t, i18n } = useTranslation();
  const projects = useProjectsFromStorage();
  const [data, setData] = useState<SourceDataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [filterColumn, setFilterColumn] = useState<string>('__all__');
  const [sortColumn, setSortColumn] = useState<string | null>('Index');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  /** Incrémenté après copie de fichiers vers Import ou vidage du dossier pour recharger le wizard. */
  const [importFolderReloadToken, setImportFolderReloadToken] = useState(0);
  const [anomalyExceptionsModalOpen, setAnomalyExceptionsModalOpen] = useState(false);
  const [importFileLoading, setImportFileLoading] = useState(false);
  const [importFileMessage, setImportFileMessage] = useState<string | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [emptyImportConfirmOpen, setEmptyImportConfirmOpen] = useState(false);
  /** Affiche ou masque préparation d’import + wizard (sous le titre). */
  const [importModuleExpanded, setImportModuleExpanded] = useState(() =>
    readModuleExpandedFromStorage(TX_IMPORT_MODULE_EXPANDED_KEY)
  );
  /** Affiche ou masque le bloc détection d’anomalies + édition. */
  const [anomalyModuleExpanded, setAnomalyModuleExpanded] = useState(() =>
    readModuleExpandedFromStorage(TX_ANOMALY_MODULE_EXPANDED_KEY)
  );
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalyMessage, setAnomalyMessageState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ANOMALY_STATUS_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [anomalyLastReportAt, setAnomalyLastReportAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ANOMALY_LAST_REPORT_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const setAnomalyMessage = useCallback((msg: string | null) => {
    setAnomalyMessageState(msg);
    try {
      if (msg != null) localStorage.setItem(ANOMALY_STATUS_STORAGE_KEY, msg);
      else localStorage.removeItem(ANOMALY_STATUS_STORAGE_KEY);
    } catch {}
  }, []);

  const [editMode, setEditMode] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [reorderChronoLoading, setReorderChronoLoading] = useState(false);
  const [reorderChronoMessage, setReorderChronoMessage] = useState<string | null>(null);
  /** État à restaurer en quittant le mode édition sans sauvegarder (mis à jour après chaque enregistrement réussi). */
  const editSessionBaselineRef = useRef<SourceDataResult | null>(null);
  const [editExitConfirmOpen, setEditExitConfirmOpen] = useState(false);
  /** Indices des lignes (dans data.rows) marquées pour suppression à la sauvegarde. */
  const [rowsToDelete, setRowsToDelete] = useState<Set<number>>(() => new Set());
  /** Vue période (hors édition) : mois `YYYY-MM` ou {@link TX_VIEW_ALL_KEY}. */
  const [availableMonthKeys, setAvailableMonthKeys] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(() => readViewPeriodFromStorage());
  /** true = data contient le jeu complet (vue « Tout » ou mode édition). */
  const [hasFullDataset, setHasFullDataset] = useState(false);
  /** Carte anomalies slim (IPC) — clé = index 0-based global source. */
  const [slimAnomalyByRowIndex, setSlimAnomalyByRowIndex] = useState<Map<number, string>>(
    () => new Map()
  );
  const [existingTransactionSignatures, setExistingTransactionSignatures] = useState<Set<string>>(
    () => new Set()
  );

  const refreshSlimAnomalies = useCallback(async (writeReport = false) => {
    const ctx = buildTransactionAnomalyContextFromStorage();
    const result = await SourceDataCSVService.detectAnomalies({ ...ctx, writeReport });
    const map = new Map<number, string>();
    if (result?.anomalies) {
      for (const a of result.anomalies) {
        map.set(a.rowIndex - 1, formatAnomalyReasons(a.reasons, t));
      }
    }
    setSlimAnomalyByRowIndex(map);
    return result;
  }, [t]);

  const refreshRowSignatures = useCallback(async () => {
    const entries = loadRecognisedAccountsFromStorage();
    const sigs = await SourceDataCSVService.getRowSignatures(entries);
    setExistingTransactionSignatures(new Set(sigs ?? []));
  }, []);

  const loadViewScope = useCallback(async (periodKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const keys = await SourceDataCSVService.getMonthKeys();
      const monthKeys = keys?.monthKeys ?? [];
      setAvailableMonthKeys(monthKeys);

      let key = periodKey;
      if (key !== TX_VIEW_ALL_KEY && (!key || !monthKeys.includes(key))) {
        // Défaut : dernier mois ; si aucun mois, vue complète.
        key = monthKeys.length ? monthKeys[monthKeys.length - 1] : TX_VIEW_ALL_KEY;
      }
      setSelectedMonth(key);
      persistViewPeriod(key);

      if (key === TX_VIEW_ALL_KEY) {
        const full = await SourceDataCSVService.load();
        setData(
          full ?? {
            headers: [...TRANSACTION_SOURCE_HEADERS_FALLBACK],
            rows: [],
          }
        );
        setHasFullDataset(true);
        if (!full?.rows?.length) {
          setError(`Fichier ${SOURCE_DATA_PATH} absent ou vide.`);
        }
        return;
      }

      const monthData = await SourceDataCSVService.loadByMonth(key);
      setData(
        monthData ?? {
          headers: [...TRANSACTION_SOURCE_HEADERS_FALLBACK],
          rows: [],
        }
      );
      setHasFullDataset(false);
      if (!monthData?.rows?.length && !monthKeys.length) {
        setError(`Fichier ${SOURCE_DATA_PATH} absent ou vide.`);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('transactions.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadViewScope(selectedMonth);
    // Mount / reload vue uniquement — période changée via sélecteur appelle loadViewScope directement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadViewScope]);

  useEffect(() => {
    void refreshSlimAnomalies(false);
  }, [refreshSlimAnomalies]);

  useEffect(() => {
    void refreshRowSignatures();
  }, [refreshRowSignatures]);

  /** Alias compte (Paramètres + défauts) pour signatures doublons à l’import. */
  const accountAliasLookup = useMemo(
    () => buildAccountAliasLookup(loadRecognisedAccountsFromStorage()),
    [availableMonthKeys]
  );

  const reloadAfterImport = useCallback(() => {
    void loadViewScope(selectedMonth);
    void refreshSlimAnomalies(false);
    void refreshRowSignatures();
  }, [loadViewScope, selectedMonth, refreshSlimAnomalies, refreshRowSignatures]);

  const prepWizard = useTransactionsImportPrepWizard({
    existingTransactionSignatures,
    accountAliasLookup,
    onAfterSuccessfulAppend: reloadAfterImport,
    folderReloadToken: importFolderReloadToken,
  });
  /** Dérivé des lignes : seule source de vérité (évite toute perte au moindre setData sur une autre cellule). */
  const rowsExcludedFromAnomaly = useMemo(() => {
    if (!data?.rows) return new Set<number>();
    const excluded = new Set<number>();
    data.rows.forEach((row, i) => {
      const v = (row[EXCLUDE_ANOMALY_COLUMN] ?? '').trim().toLowerCase();
      if (v === '1' || v === 'oui' || v === 'true' || v === 'yes') excluded.add(i);
    });
    return excluded;
  }, [data?.rows]);

  const dateColumn = useMemo(() => {
    return data?.headers.find((h) => /date/i.test(h)) ?? null;
  }, [data?.headers]);

  /** En-têtes affichés dans le tableau (sans colonnes techniques : Exclure_anomalie, Soutien_ignorer, Source). */
  const displayHeaders = useMemo(
    () =>
      (data?.headers ?? []).filter(
        (h) =>
          h !== EXCLUDE_ANOMALY_COLUMN &&
          !/^soutien_ignorer$/i.test(h) &&
          !/^source$/i.test(h)
      ),
    [data?.headers]
  );

  const resizableColumnDefs = useMemo((): ResizableColumnDef[] => {
    const cols: ResizableColumnDef[] = [];
    if (editMode) {
      cols.push({ key: ANOMALY_SORT_COLUMN_KEY, defaultWidth: 160 });
    }
    for (const h of displayHeaders) {
      cols.push({ key: h, defaultWidth: defaultEditColumnWidth(h) });
    }
    if (editMode) {
      cols.push(
        { key: '__exclude_anomaly__', defaultWidth: 120, resizable: false },
        { key: '__delete__', defaultWidth: 130, resizable: false }
      );
    }
    return cols;
  }, [displayHeaders, editMode]);

  const {
    getWidth: getColWidth,
    handleResizeStart: handleColResizeStart,
    resetWidths: resetColWidths,
    hasCustomWidths: hasCustomColWidths,
  } = useResizableTableColumns(TX_TABLE_COL_WIDTHS_KEY, resizableColumnDefs, editMode);

  const { minDate, maxDate } = useMemo(() => {
    if (!data?.rows?.length || !dateColumn) {
      return { minDate: null as Date | null, maxDate: null as Date | null };
    }
    const dates: Date[] = [];
    for (const row of data.rows) {
      const d = parseDateFromCell(row[dateColumn] ?? '');
      if (d) dates.push(d);
    }
    if (dates.length === 0) {
      return { minDate: null, maxDate: null };
    }
    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
    return {
      minDate: sorted[0] ?? null,
      maxDate: sorted[sorted.length - 1] ?? null,
    };
  }, [data?.rows, dateColumn]);

  /**
   * Colonne Anomalie : payload slim IPC hors édition (remap Index global → index local) ;
   * en édition, détection locale sur le brouillon plein.
   */
  const transactionAnomalyByDataRowIndex = useMemo(() => {
    if (editMode && data?.rows) {
      const { anomalies } = detectAnomalies(data);
      const map = new Map<number, string>();
      for (const a of anomalies) {
        map.set(a.rowIndex - 1, formatAnomalyReasons(a.reasons, t));
      }
      return map;
    }
    if (!data?.rows?.length) return new Map<number, string>();
    const map = new Map<number, string>();
    data.rows.forEach((row, i) => {
      const idx = parseInt(String(row.Index ?? ''), 10);
      const global0 =
        Number.isFinite(idx) && idx > 0
          ? idx - 1
          : data.rowIndicesInSource != null
            ? data.rowIndicesInSource[i]
            : i;
      const text = slimAnomalyByRowIndex.get(global0);
      if (text) map.set(i, text);
    });
    return map;
  }, [editMode, data, slimAnomalyByRowIndex, t, i18n.language]);

  /** Valeurs figées pour filtre et tri en mode édition (pas de re-classement à chaque frappe). */
  const [editFilterRowSnapshot, setEditFilterRowSnapshot] = useState<Record<string, string>[] | null>(
    null
  );
  const [editFilterAnomalySnapshot, setEditFilterAnomalySnapshot] = useState<Map<number, string> | null>(
    null
  );
  const [editFilterDateBounds, setEditFilterDateBounds] = useState<{
    minDate: Date;
    maxDate: Date;
  } | null>(null);
  const dataForFilterSnapshotRef = useRef(data);
  dataForFilterSnapshotRef.current = data;

  const applyEditFilterSnapshot = useCallback(() => {
    const d = dataForFilterSnapshotRef.current;
    if (!d?.rows?.length) {
      setEditFilterRowSnapshot(null);
      setEditFilterAnomalySnapshot(null);
      setEditFilterDateBounds(null);
      return;
    }
    setEditFilterRowSnapshot(d.rows.map((row) => ({ ...row })));
    const { anomalies } = detectAnomalies(d);
    const anomalyMap = new Map<number, string>();
    for (const a of anomalies) {
      anomalyMap.set(a.rowIndex - 1, formatAnomalyReasons(a.reasons, t));
    }
    setEditFilterAnomalySnapshot(anomalyMap);
    const dc = d.headers.find((h) => /date/i.test(h)) ?? null;
    if (dc) {
      const dates: Date[] = [];
      for (const row of d.rows) {
        const parsed = parseDateFromCell(row[dc] ?? '');
        if (parsed) dates.push(parsed);
      }
      if (dates.length > 0) {
        const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
        setEditFilterDateBounds({
          minDate: sorted[0]!,
          maxDate: sorted[sorted.length - 1]!,
        });
      } else {
        setEditFilterDateBounds(null);
      }
    } else {
      setEditFilterDateBounds(null);
    }
  }, [t]);

  useEffect(() => {
    if (!editMode) {
      setEditFilterRowSnapshot(null);
      setEditFilterAnomalySnapshot(null);
      setEditFilterDateBounds(null);
      return;
    }
    applyEditFilterSnapshot();
  }, [editMode, filterText, filterColumn, sortColumn, sortDirection, applyEditFilterSnapshot]);

  const filteredRows = useMemo(() => {
    if (!data?.rows) return [];
    const stableFilter = editMode && editFilterRowSnapshot !== null;
    const filterMinDate =
      stableFilter && editFilterDateBounds ? editFilterDateBounds.minDate : minDate;
    const filterMaxDate =
      stableFilter && editFilterDateBounds ? editFilterDateBounds.maxDate : maxDate;
    const anomalyMapForFilter =
      stableFilter && editFilterAnomalySnapshot
        ? editFilterAnomalySnapshot
        : transactionAnomalyByDataRowIndex;

    return data.rows.filter((row, index) => {
      const rowForFilter = stableFilter ? (editFilterRowSnapshot[index] ?? row) : row;
      const q = filterText.trim().toLowerCase();
      const colSel =
        !editMode && filterColumn === ANOMALY_FILTER_COLUMN_KEY ? '__all__' : filterColumn;
      if (q) {
        if (editMode && colSel === ANOMALY_FILTER_COLUMN_KEY) {
          const text = anomalyMapForFilter.get(index) ?? '';
          if (!text.toLowerCase().includes(q)) return false;
        } else {
          const cols =
            colSel === '__all__'
              ? (data.headers ?? []).filter(
                  (h) =>
                    h !== EXCLUDE_ANOMALY_COLUMN &&
                    !/^soutien_ignorer$/i.test(h) &&
                    !/^source$/i.test(h)
                )
              : [colSel];
          if (!cols.some((h) => (rowForFilter[h] ?? '').toLowerCase().includes(q))) return false;
        }
      }
      if (dateColumn && filterMinDate != null && filterMaxDate != null) {
        const cellDate = parseDateFromCell(rowForFilter[dateColumn] ?? '');
        if (!cellDate) return false;
        const t = cellDate.getTime();
        if (t < filterMinDate.getTime() || t > filterMaxDate.getTime()) return false;
      }
      return true;
    });
  }, [
    data,
    filterText,
    filterColumn,
    editMode,
    editFilterRowSnapshot,
    editFilterAnomalySnapshot,
    editFilterDateBounds,
    transactionAnomalyByDataRowIndex,
    dateColumn,
    minDate,
    maxDate,
  ]);

  const getCompareValue = (header: string, raw: string): number | string => {
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
  };

  const sortedRows = useMemo(() => {
    const stableSort = editMode && editFilterRowSnapshot !== null;
    const snapshotRow = (row: Record<string, string>): Record<string, string> => {
      if (!stableSort || !data?.rows) return row;
      const idx = data.rows.findIndex((r) => r === row);
      return idx >= 0 ? (editFilterRowSnapshot[idx] ?? row) : row;
    };
    const anomalyMapForSort =
      stableSort && editFilterAnomalySnapshot
        ? editFilterAnomalySnapshot
        : transactionAnomalyByDataRowIndex;

    if (sortColumn === ANOMALY_SORT_COLUMN_KEY) {
      if (!editMode || !data?.rows) return filteredRows;
      return [...filteredRows].sort((a, b) => {
        const ia = data.rows.findIndex((r) => r === a);
        const ib = data.rows.findIndex((r) => r === b);
        const ta = ia >= 0 ? (anomalyMapForSort.get(ia) ?? '') : '';
        const tb = ib >= 0 ? (anomalyMapForSort.get(ib) ?? '') : '';
        const cmp = ta.localeCompare(tb, undefined, { sensitivity: 'base' });
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }
    if (!sortColumn || !data?.headers.includes(sortColumn)) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const va = getCompareValue(sortColumn, snapshotRow(a)[sortColumn] ?? '');
      const vb = getCompareValue(sortColumn, snapshotRow(b)[sortColumn] ?? '');
      const na = typeof va === 'number';
      const nb = typeof vb === 'number';
      let cmp: number;
      if (na && nb) cmp = (va as number) - (vb as number);
      else if (na) cmp = -1;
      else if (nb) cmp = 1;
      else cmp = String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [
    filteredRows,
    sortColumn,
    sortDirection,
    data?.headers,
    data?.rows,
    editMode,
    editFilterRowSnapshot,
    editFilterAnomalySnapshot,
    transactionAnomalyByDataRowIndex,
  ]);

  const [editShowAnomaliesOnly, setEditShowAnomaliesOnly] = useState(false);
  /** Lignes à garder visibles avec le filtre « anomalies seulement » après correction ; réinitialisé uniquement à la sortie du mode édition. */
  const [anomalyFilterStickyIndices, setAnomalyFilterStickyIndices] = useState<Set<number>>(
    () => new Set()
  );
  const prevAnomalyMapForFilterRef = useRef<Map<number, string>>(new Map());

  useEffect(() => {
    if (!editMode) setEditShowAnomaliesOnly(false);
  }, [editMode]);

  useEffect(() => {
    if (!editMode && sortColumn === ANOMALY_SORT_COLUMN_KEY) {
      setSortColumn('Index');
    }
  }, [editMode, sortColumn]);

  useEffect(() => {
    if (!editMode && filterColumn === ANOMALY_FILTER_COLUMN_KEY) {
      setFilterColumn('__all__');
    }
  }, [editMode, filterColumn]);

  useLayoutEffect(() => {
    const curr = transactionAnomalyByDataRowIndex;
    if (!editMode) {
      setAnomalyFilterStickyIndices((s) => (s.size === 0 ? s : new Set()));
      prevAnomalyMapForFilterRef.current = new Map(curr);
      return;
    }
    if (!editShowAnomaliesOnly) {
      prevAnomalyMapForFilterRef.current = new Map(curr);
      return;
    }
    const prev = prevAnomalyMapForFilterRef.current;
    setAnomalyFilterStickyIndices((sticky) => {
      const next = new Set(sticky);
      for (const idx of prev.keys()) {
        if (prev.has(idx) && !curr.has(idx)) {
          next.add(idx);
        }
      }
      return next;
    });
    prevAnomalyMapForFilterRef.current = new Map(curr);
  }, [transactionAnomalyByDataRowIndex, editMode, editShowAnomaliesOnly]);

  const dataRowIndexByRef = useMemo(() => {
    const map = new Map<Record<string, string>, number>();
    data?.rows.forEach((r, i) => map.set(r, i));
    return map;
  }, [data?.rows]);

  const displayRows = useMemo(() => {
    if (!editMode || !editShowAnomaliesOnly) return sortedRows;
    return sortedRows.filter((row) => {
      const dataRowIndex = dataRowIndexByRef.get(row) ?? -1;
      if (dataRowIndex < 0) return false;
      return (
        transactionAnomalyByDataRowIndex.has(dataRowIndex) ||
        anomalyFilterStickyIndices.has(dataRowIndex)
      );
    });
  }, [
    editMode,
    editShowAnomaliesOnly,
    sortedRows,
    dataRowIndexByRef,
    transactionAnomalyByDataRowIndex,
    anomalyFilterStickyIndices,
  ]);

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: displayRows.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize: () => (editMode ? 44 : 36),
    overscan: 16,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;

  const handleSort = (header: string) => {
    if (sortColumn === header) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(header);
      setSortDirection('asc');
    }
  };

  const handleOpenAnomalyReport = async () => {
    const api = (window as unknown as { electronAPI?: { openAnomalyReport: () => Promise<{ success: boolean; error?: string }> } }).electronAPI;
    if (!api?.openAnomalyReport) return;
    const result = await api.openAnomalyReport();
    if (!result.success && result.error) {
      setAnomalyMessageState(result.error);
    }
  };

  const handleConfirmEmptyTransactionsImport = async () => {
    setEmptyImportConfirmOpen(false);
    const api = (window as unknown as {
      electronAPI?: {
        trashTransactionsImportFiles: () => Promise<{ success: boolean; error?: string; movedCount?: number; message?: string }>;
      };
    }).electronAPI;
    if (!api?.trashTransactionsImportFiles) return;
    setArchiveMessage(null);
    setArchiveLoading(true);
    try {
      const result = await api.trashTransactionsImportFiles();
      if (result.success) {
        setArchiveMessage(
          result.message ??
            (result.movedCount
              ? t('transactions.importWizard.filesMoved', { count: result.movedCount })
              : 'Aucun fichier dans le dossier Import.')
        );
        setImportFolderReloadToken((k) => k + 1);
      } else {
        setArchiveMessage(result.error ?? 'Impossible de vider le dossier.');
      }
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleDetectAnomalies = async () => {
    setAnomalyLoading(true);
    try {
      const result = await refreshSlimAnomalies(true);
      if (!result) {
        setAnomalyMessage(t('transactions.anomaly.unavailable'));
        return;
      }
      const now = new Date().toISOString();
      setAnomalyLastReportAt(now);
      try {
        localStorage.setItem(ANOMALY_LAST_REPORT_STORAGE_KEY, now);
      } catch {}
      const count = result.anomalies?.length ?? 0;
      setAnomalyMessage(
        count === 0
          ? t('transactions.anomaly.noneFound')
          : t('transactions.anomaly.found', { count })
      );
    } finally {
      setAnomalyLoading(false);
    }
  };

  const handleImportCsvFile = async () => {
    const api = (window as unknown as {
      electronAPI?: {
        selectFile: (opts?: {
          filters?: { name: string; extensions: string[] }[];
          allowMultiple?: boolean;
        }) => Promise<{ success: boolean; path?: string; paths?: string[]; canceled?: boolean; error?: string }>;
        readExternalFile: (path: string) => Promise<{ success: boolean; data?: string; error?: string }>;
        writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
      };
    }).electronAPI;
    if (!api?.selectFile || !api?.readExternalFile || !api?.writeFile) return;
    setImportFileLoading(true);
    setImportFileMessage(null);
    try {
      const selectResult = await api.selectFile({
        filters: [{ name: 'Fichiers CSV', extensions: ['csv'] }],
        allowMultiple: true,
      });
      if (selectResult.canceled) {
        setImportFileMessage(null);
        return;
      }
      const paths =
        selectResult.paths?.length ? selectResult.paths : selectResult.path ? [selectResult.path] : [];
      if (paths.length === 0) {
        setImportFileMessage(null);
        return;
      }
      const copied: string[] = [];
      for (const sourcePath of paths) {
        const readResult = await api.readExternalFile(sourcePath);
        if (!readResult.success || readResult.data === undefined) {
          setImportFileMessage(readResult.error ?? 'Impossible de lire un fichier.');
          return;
        }
        const fileName = sourcePath.replace(/^.*[/\\]/, '');
        const destPath = transactionsImportFile(fileName);
        const writeResult = await api.writeFile(destPath, readResult.data);
        if (!writeResult.success) {
          setImportFileMessage(writeResult.error ?? 'Erreur lors de la copie.');
          return;
        }
        copied.push(fileName);
      }
      setImportFileMessage(
        copied.length === 1
          ? t('transactions.importWizard.fileCopied', { name: copied[0] })
          : t('transactions.importWizard.filesCopied', { count: copied.length, names: copied.join(', ') })
      );
      setImportFolderReloadToken((k) => k + 1);
    } finally {
      setImportFileLoading(false);
    }
  };

  const performExitEditMode = useCallback(() => {
    editSessionBaselineRef.current = null;
    setRowsToDelete(new Set());
    setEditMode(false);
    setSaveMessage(null);
    setEditExitConfirmOpen(false);
    void loadViewScope(selectedMonth);
  }, [loadViewScope, selectedMonth]);

  const handleToggleEditMode = () => {
    if (!editMode) {
      void (async () => {
        setLoading(true);
        setSaveMessage(null);
        try {
          let full = data;
          if (!hasFullDataset) {
            full = await SourceDataCSVService.load();
            if (!full?.rows?.length) {
              setError(`Fichier ${SOURCE_DATA_PATH} absent ou vide.`);
              return;
            }
            setData(full);
            setHasFullDataset(true);
          }
          if (full) editSessionBaselineRef.current = cloneSourceDataResult(full);
          setEditMode(true);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : t('transactions.edit.loadFailed'));
        } finally {
          setLoading(false);
        }
      })();
    } else {
      if (
        data &&
        editSessionBaselineRef.current &&
        isTransactionsEditSessionDirty(data, editSessionBaselineRef.current, rowsToDelete)
      ) {
        setEditExitConfirmOpen(true);
        return;
      }
      performExitEditMode();
    }
  };

  const handleSaveSourceData = async () => {
    if (!data) return;
    setSaveLoading(true);
    setSaveMessage(null);
    try {
      const headers = data.headers.includes(EXCLUDE_ANOMALY_COLUMN)
        ? data.headers
        : [...data.headers, EXCLUDE_ANOMALY_COLUMN];
      const rowsWithExclusion = data.rows.map((row, i) => ({
        ...row,
        [EXCLUDE_ANOMALY_COLUMN]: rowsExcludedFromAnomaly.has(i) ? '1' : '',
      }));
      const rowsToKeep = rowsWithExclusion.filter((_, index) => !rowsToDelete.has(index));
      const withIndexHeader =
        headers.some((h) => /^index$/i.test(h)) ? headers : ['Index', ...headers];
      const normalized = normalizeOrderAndIndex(
        stripSourceColumnFromSourceData({
          headers: withIndexHeader,
          rows: rowsToKeep,
        })
      );
      const result = await SourceDataCSVService.replaceAll(normalized.rows);
      if (result.success) {
        setData(normalized);
        setHasFullDataset(true);
        dataForFilterSnapshotRef.current = normalized;
        editSessionBaselineRef.current = cloneSourceDataResult(normalized);
        setRowsToDelete(new Set());
        /* Comme à la sortie du mode édition : repartir d’un affichage aligné sur les données enregistrées
         * (filtre « anomalies seulement » + lignes collantes après correction d’anomalie). */
        setEditShowAnomaliesOnly(false);
        setAnomalyFilterStickyIndices(new Set());
        applyEditFilterSnapshot();
        setEditExitConfirmOpen(false);
        setSaveMessage(t('transactions.edit.saved'));
        void refreshSlimAnomalies(false);
        void refreshRowSignatures();
      } else {
        setSaveMessage(result.error ?? 'Erreur lors de l\'enregistrement.');
      }
    } finally {
      setSaveLoading(false);
    }
  };

  const handleRefreshSourceDataCsv = async () => {
    if (editMode) {
      setReorderChronoMessage(
        t('transactions.refresh.exitEditWarning')
      );
      return;
    }
    setReorderChronoLoading(true);
    setReorderChronoMessage(null);
    try {
      const result = await SourceDataCSVService.refreshGbpRates(getEffectiveRates());
      if (result.success) {
        await loadViewScope(selectedMonth);
        void refreshSlimAnomalies(false);
        void refreshRowSignatures();
        setReorderChronoMessage(
          t('transactions.refresh.result', { rowCount: result.rowCount, updatedCount: result.updatedCount })
        );
      } else {
        setReorderChronoMessage(result.error ?? "Erreur lors de l'enregistrement.");
      }
    } catch (e) {
      setReorderChronoMessage(e instanceof Error ? e.message : t('transactions.refresh.failed'));
    } finally {
      setReorderChronoLoading(false);
    }
  };

  const handleViewPeriodChange = (periodKey: string) => {
    if (editMode) return;
    setSelectedMonth(periodKey);
    persistViewPeriod(periodKey);
    void loadViewScope(periodKey);
  };

  const handleCellChange = useCallback(
    (dataRowIndex: number, header: string, value: string) => {
      setData((prev) => {
        if (!prev) return prev;
        const amountHeader = prev.headers.find((h) => /^amount$/i.test(h)) ?? null;
        const currencyHeader = prev.headers.find((h) => /^currency$/i.test(h)) ?? null;
        const amountGbpHeader = prev.headers.find((h) => isAmountIndicatorHeader(h)) ?? null;
        return {
          ...prev,
          rows: prev.rows.map((row, i) => {
            if (i !== dataRowIndex) return row;
            const next = { ...row, [header]: value };
            if (amountHeader && currencyHeader && amountGbpHeader) {
              syncTransactionAmountCurrencyOnEdit(
                next,
                header,
                amountHeader,
                currencyHeader,
                amountGbpHeader
              );
            }
            return next;
          }),
        };
      });
    },
    []
  );

  const handleToggleRowDelete = useCallback((dataRowIndex: number) => {
    setRowsToDelete((prev) => {
      const next = new Set(prev);
      if (next.has(dataRowIndex)) next.delete(dataRowIndex);
      else next.add(dataRowIndex);
      return next;
    });
  }, []);

  const handleToggleExcludeAnomaly = useCallback((dataRowIndex: number) => {
    setData((prev) => {
      if (!prev) return prev;
      const row = prev.rows[dataRowIndex];
      if (!row) return prev;
      const v = (row[EXCLUDE_ANOMALY_COLUMN] ?? '').trim().toLowerCase();
      const currentlyExcluded =
        v === '1' || v === 'oui' || v === 'true' || v === 'yes';
      const nextExcluded = !currentlyExcluded;
      const headers = prev.headers.includes(EXCLUDE_ANOMALY_COLUMN)
        ? prev.headers
        : [...prev.headers, EXCLUDE_ANOMALY_COLUMN];
      return {
        ...prev,
        headers,
        rows: prev.rows.map((r, i) =>
          i === dataRowIndex
            ? { ...r, [EXCLUDE_ANOMALY_COLUMN]: nextExcluded ? '1' : '' }
            : r
        ),
      };
    });
  }, []);

  const toggleImportModuleExpanded = useCallback(() => {
    setImportModuleExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(TX_IMPORT_MODULE_EXPANDED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleAnomalyModuleExpanded = useCallback(() => {
    setAnomalyModuleExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(TX_ANOMALY_MODULE_EXPANDED_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <>
      <main className="flex-1 flex flex-col min-w-0 p-4">
        <div className="mb-4 space-y-4">
          <h1 className="text-2xl font-bold text-gray-800">{t('transactions.title')}</h1>

          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
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
              aria-controls="transactions-import-module"
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
                  <h2 className="text-lg font-semibold text-gray-800">{t('transactions.importWizard.title')}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {importModuleExpanded
                      ? t('transactions.importWizard.closeModule')
                      : t('transactions.importWizard.openModule')}
                  </p>
                </div>
              </div>
            </div>
          {importModuleExpanded && (
            <div id="transactions-import-module" className="mt-3">
              <div
                className="rounded-lg border border-gray-200 bg-gray-50/50 p-4"
                aria-label={t('transactions.importWizard.zoneLabel')}
              >
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('transactions.importWizard.prepTitle')}</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleImportCsvFile}
                          disabled={importFileLoading}
                          className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {importFileLoading ? t('transactions.importWizard.importing') : t('transactions.importWizard.importFiles')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void prepWizard.handleOpenImportFolder()}
                          className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {t('transactions.importWizard.openImportFolder')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEmptyImportConfirmOpen(true)}
                          disabled={archiveLoading}
                          className="rounded border border-red-600 bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {archiveLoading ? t('transactions.importWizard.emptying') : t('transactions.importWizard.emptyImport')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void prepWizard.handleImportLinesToSource()}
                          disabled={
                            prepWizard.importLinesLoading ||
                            prepWizard.importWizardLoading ||
                            !prepWizard.mappingWizardActive ||
                            !prepWizard.importWizardPreview?.list.length ||
                            prepWizard.importPreviewImportableRows.length === 0
                          }
                          title={
                            !prepWizard.mappingWizardActive
                              ? t('transactions.importWizard.needMapping')
                              : prepWizard.importPreviewImportableRows.length === 0
                                ? t('transactions.importWizard.noImportableRows')
                                : undefined
                          }
                          className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {prepWizard.importLinesLoading ? t('transactions.importWizard.importLinesShort') : t('transactions.importWizard.importLines')}
                        </button>
                        {prepWizard.mappingWizardActive && (
                          <label
                            className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none"
                            title={t('transactions.importWizard.removeImportedTitle')}
                          >
                            <input
                              type="checkbox"
                              className="shrink-0"
                              checked={prepWizard.removeImportedFromImportFolder}
                              onChange={(e) =>
                                prepWizard.setRemoveImportedFromImportFolder(e.target.checked)
                              }
                              disabled={prepWizard.importLinesLoading}
                            />
                            {t('transactions.importWizard.removeImported')}
                          </label>
                        )}
                      </div>
                    </div>

                    <hr className="border-gray-200" />

                    <TransactionsImportPrepSection
                      {...prepWizard}
                      sourceRowsForSuggestions={data?.rows ?? []}
                      sourceHeadersForSuggestions={data?.headers ?? []}
                    />
                    <hr className="border-gray-200" />
                  </div>
                </div>
              </div>
          )}
          </div>

          <div className="bg-white rounded-lg shadow p-4 border border-gray-200">
            <div
              className="flex items-center justify-between gap-3 mb-0 cursor-pointer select-none"
              onClick={toggleAnomalyModuleExpanded}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleAnomalyModuleExpanded();
                }
              }}
              aria-expanded={anomalyModuleExpanded}
              aria-controls="transactions-anomaly-module"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="inline-block transition-transform duration-200 text-gray-500 shrink-0"
                  style={{ transform: anomalyModuleExpanded ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                  aria-hidden
                >
                  ▼
                </span>
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-800">
                    {t('transactions.anomaly.title')}
                  </h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {anomalyModuleExpanded
                      ? t('transactions.anomaly.closeModule')
                      : t('transactions.anomaly.openModule')}
                  </p>
                </div>
              </div>
            </div>
            {anomalyModuleExpanded && (
              <div id="transactions-anomaly-module" className="mt-3">
                <div
                  className="rounded-lg border border-gray-200 bg-gray-50/50 p-4"
                  aria-label={t('transactions.anomaly.zoneLabel')}
                >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleRefreshSourceDataCsv}
                          disabled={reorderChronoLoading || !data || saveLoading}
                          title={
                            editMode
                              ? t('transactions.refresh.exitEditFirst')
                              : t('transactions.refresh.hint')
                          }
                          className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {reorderChronoLoading ? t('transactions.refresh.loading') : t('transactions.refresh.button')}
                        </button>
                        <button
                          type="button"
                          onClick={handleDetectAnomalies}
                          disabled={anomalyLoading || !data}
                          className="rounded border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                        >
                          {anomalyLoading ? t('transactions.anomaly.analyzing') : t('transactions.anomaly.detect')}
                        </button>
                        <button
                          type="button"
                          onClick={handleOpenAnomalyReport}
                          className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {t('transactions.anomaly.openReport')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAnomalyExceptionsModalOpen(true)}
                          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {t('transactions.anomaly.exceptions')}
                        </button>
                        <button
                          type="button"
                          onClick={handleToggleEditMode}
                          className={`rounded border px-3 py-1.5 text-sm font-medium text-white ${
                            editMode
                              ? 'border-gray-500 bg-gray-500 hover:bg-gray-600'
                              : 'border-red-600 bg-red-600 hover:bg-red-700'
                          }`}
                        >
                          {editMode ? t('transactions.edit.exit') : t('transactions.edit.enter')}
                        </button>
                        {editMode && (
                          <button
                            type="button"
                            onClick={handleSaveSourceData}
                            disabled={saveLoading || !data}
                            className="rounded border border-green-600 bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {saveLoading ? t('common.saving') : t('transactions.edit.save')}
                          </button>
                        )}
                      </div>
                      {reorderChronoMessage && (
                        <p
                          className={`mt-2 text-sm rounded border px-2 py-1 ${uiMessageClass(
                            getUiMessageTone(reorderChronoMessage)
                          )}`}
                        >
                          {reorderChronoMessage}
                        </p>
                      )}
                      {editMode && saveMessage && (
                        <p
                          className={`mt-2 text-sm rounded border px-2 py-1 ${uiMessageClass(
                            getUiMessageTone(saveMessage)
                          )}`}
                        >
                          {saveMessage}
                        </p>
                      )}
                      {(anomalyMessage || anomalyLastReportAt) && (
                        <div className="mt-2 space-y-0.5">
                          {anomalyMessage && (
                            <p
                              className={`text-sm rounded border px-2 py-1 ${uiMessageClass(
                                getUiMessageTone(anomalyMessage)
                              )}`}
                            >
                              {anomalyMessage}
                            </p>
                          )}
                          {anomalyLastReportAt && (
                            <p className="text-sm text-gray-600">
                              {(() => {
                                const parts = formatReportDateParts(anomalyLastReportAt);
                                return parts
                                  ? t('transactions.anomaly.lastReport', parts)
                                  : anomalyLastReportAt;
                              })()}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
            )}
          </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {archiveMessage && (
                <span
                  className={`text-sm rounded border px-2 py-1 ${uiMessageClass(
                    getUiMessageTone(archiveMessage)
                  )}`}
                >
                  {archiveMessage}
                </span>
              )}
              {importFileMessage && (
                <span
                  className={`text-sm rounded border px-2 py-1 ${uiMessageClass(
                    getUiMessageTone(importFileMessage)
                  )}`}
                >
                  {importFileMessage}
                </span>
              )}
            </div>
          </div>

        {loading && (
          <div className="flex items-center justify-center py-12 text-gray-500">
            {t('common.loading')}
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">
            {error}
          </div>
        )}

        {data && !loading && (
          <div className="flex flex-col bg-white rounded-lg shadow border border-gray-200 overflow-hidden h-[calc(100vh-6rem)] min-h-[320px]">
            <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center gap-3">
              {!editMode && (availableMonthKeys.length > 0 || selectedMonth === TX_VIEW_ALL_KEY) && (
                <div className="flex items-center gap-2">
                  <label htmlFor="tx-view-period" className="text-gray-600 text-sm whitespace-nowrap">
                    {t('transactions.filters.show')}
                  </label>
                  <select
                    id="tx-view-period"
                    value={selectedMonth || TX_VIEW_ALL_KEY}
                    onChange={(e) => handleViewPeriodChange(e.target.value)}
                    className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800"
                  >
                    <option value={TX_VIEW_ALL_KEY}>{t('transactions.filters.allTable')}</option>
                    {availableMonthKeys.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {editMode && (
                <span className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  {t('transactions.edit.fullDataset')}
                </span>
              )}
              <div className="flex items-center gap-2 min-w-0">
                <label htmlFor="tx-filter-col" className="text-gray-600 text-sm whitespace-nowrap">
                  {t('transactions.filters.column')}
                </label>
                <select
                  id="tx-filter-col"
                  value={filterColumn}
                  onChange={(e) => setFilterColumn(e.target.value)}
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[120px]"
                >
                  <option value="__all__">{t('transactions.filters.allColumns')}</option>
                  {editMode && (
                    <option value={ANOMALY_FILTER_COLUMN_KEY}>{t('transactions.anomaly.column')}</option>
                  )}
                  {displayHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <label htmlFor="tx-filter-text" className="text-gray-600 text-sm whitespace-nowrap sr-only">
                  {t('transactions.filters.search')}
                </label>
                <input
                  id="tx-filter-text"
                  type="text"
                  placeholder={t('transactions.filters.searchPlaceholder')}
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-0"
                />
                {filterText && (
                  <button
                    type="button"
                    onClick={() => setFilterText('')}
                    className="text-gray-500 hover:text-gray-700 text-sm whitespace-nowrap"
                  >
                    {t('transactions.filters.clear')}
                  </button>
                )}
              </div>
              <span className="text-gray-500 text-sm">
                {t('transactions.filters.rowCount', { filtered: filteredRows.length, total: data.rows.length })}
              </span>
              {editMode && (
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editShowAnomaliesOnly}
                    onChange={(e) => setEditShowAnomaliesOnly(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  {t('transactions.anomaly.showOnly')}
                </label>
              )}
              {editMode && (
                <span className="text-red-600 text-sm font-medium">{t('transactions.edit.banner')}</span>
              )}
              {editMode && hasCustomColWidths && (
                <button
                  type="button"
                  onClick={resetColWidths}
                  className="text-sm text-gray-600 hover:text-gray-900 underline"
                >
                  {t('transactions.filters.resetWidths')}
                </button>
              )}
            </div>
            <div ref={tableScrollRef} className="overflow-auto flex-1 min-h-0">
              <table
                className="w-full border-collapse text-sm"
                style={editMode ? { tableLayout: 'fixed', minWidth: '100%' } : undefined}
              >
                {editMode && (
                  <colgroup>
                    <col style={{ width: getColWidth(ANOMALY_SORT_COLUMN_KEY) }} />
                    {displayHeaders.map((h) => (
                      <col key={h} style={{ width: getColWidth(h) }} />
                    ))}
                    <col style={{ width: getColWidth('__exclude_anomaly__') }} />
                    <col style={{ width: getColWidth('__delete__') }} />
                  </colgroup>
                )}
                <thead className="sticky top-0 bg-gray-100 border-b border-gray-200 z-10">
                  <tr>
                    {editMode && (
                      <ResizableTableHeadCell
                        columnKey={ANOMALY_SORT_COLUMN_KEY}
                        width={getColWidth(ANOMALY_SORT_COLUMN_KEY)}
                        enabled={editMode}
                        onResizeStart={handleColResizeStart}
                        onClick={() => handleSort(ANOMALY_SORT_COLUMN_KEY)}
                        className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap bg-amber-50/80 align-bottom cursor-pointer select-none hover:bg-amber-100/80 transition-colors overflow-hidden"
                      >
                        <span className="inline-flex items-center gap-1">
                          {t('transactions.anomaly.column')}
                          {sortColumn === ANOMALY_SORT_COLUMN_KEY && (
                            <span className="text-blue-600" aria-label={sortDirection === 'asc' ? t('transactions.table.sortAsc') : t('transactions.table.sortDesc')}>
                              {sortDirection === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </span>
                      </ResizableTableHeadCell>
                    )}
                    {displayHeaders.map((h) =>
                      editMode ? (
                        <ResizableTableHeadCell
                          key={h}
                          columnKey={h}
                          width={getColWidth(h)}
                          enabled={editMode}
                          onResizeStart={handleColResizeStart}
                          onClick={() => handleSort(h)}
                          className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:bg-gray-200 transition-colors overflow-hidden"
                        >
                          <span className="inline-flex items-center gap-1">
                            {h}
                            {sortColumn === h && (
                              <span className="text-blue-600" aria-label={sortDirection === 'asc' ? t('transactions.table.sortAsc') : t('transactions.table.sortDesc')}>
                                {sortDirection === 'asc' ? '↑' : '↓'}
                              </span>
                            )}
                          </span>
                        </ResizableTableHeadCell>
                      ) : (
                        <th
                          key={h}
                          onClick={() => handleSort(h)}
                          className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:bg-gray-200 transition-colors"
                        >
                          <span className="inline-flex items-center gap-1">
                            {h}
                            {sortColumn === h && (
                              <span className="text-blue-600" aria-label={sortDirection === 'asc' ? t('transactions.table.sortAsc') : t('transactions.table.sortDesc')}>
                                {sortDirection === 'asc' ? '↑' : '↓'}
                              </span>
                            )}
                          </span>
                        </th>
                      )
                    )}
                    {editMode && (
                      <ResizableTableHeadCell
                        columnKey="__exclude_anomaly__"
                        width={getColWidth('__exclude_anomaly__')}
                        resizable={false}
                        enabled={editMode}
                        onResizeStart={handleColResizeStart}
                        className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap bg-gray-100 overflow-hidden"
                      >
                        {t('transactions.anomaly.excludeColumn')}
                      </ResizableTableHeadCell>
                    )}
                    {editMode && (
                      <ResizableTableHeadCell
                        columnKey="__delete__"
                        width={getColWidth('__delete__')}
                        resizable={false}
                        enabled={editMode}
                        onResizeStart={handleColResizeStart}
                        className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap bg-gray-100 overflow-hidden"
                      >
                        {t('transactions.table.deleteColumn')}
                      </ResizableTableHeadCell>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {paddingTop > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={displayHeaders.length + (editMode ? 3 : 0)}
                        style={{ height: paddingTop, padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                  {virtualRows.map((vRow) => {
                    const row = displayRows[vRow.index];
                    const i = vRow.index;
                    const dataRowIndex = dataRowIndexByRef.get(row) ?? -1;
                    const isMarkedForDelete = dataRowIndex >= 0 && rowsToDelete.has(dataRowIndex);
                    const isExcludedFromAnomaly = dataRowIndex >= 0 && rowsExcludedFromAnomaly.has(dataRowIndex);
                    const anomalyText =
                      dataRowIndex >= 0 ? transactionAnomalyByDataRowIndex.get(dataRowIndex) ?? '' : '';
                    return (
                      <tr
                        key={i}
                        data-index={vRow.index}
                        ref={rowVirtualizer.measureElement}
                        className={`border-b border-gray-100 ${
                          editMode && isMarkedForDelete
                            ? 'bg-red-100/70 hover:bg-red-100/70'
                            : editMode && isExcludedFromAnomaly
                              ? 'bg-green-100/70 hover:bg-green-100/70'
                              : 'hover:bg-gray-50'
                        }`}
                      >
                        {editMode && (
                          <td
                            className="px-3 py-2 align-top bg-amber-50/40 text-xs text-amber-900 break-words whitespace-pre-wrap overflow-hidden"
                            title={anomalyText || undefined}
                          >
                            {anomalyText || '—'}
                          </td>
                        )}
                        {displayHeaders.map((header) => {
                          const raw = row[header] ?? '';
                          const isDateColumn = /date/i.test(header);
                          const isAmountColumn = /^amount$/i.test(header);
                          const isCurrencyColumn = /^currency$/i.test(header);
                          const isAmountGbpColumn = isAmountIndicatorHeader(header);
                          const isAccountColumn = /^account$/i.test(header) || /compte/i.test(header);
                          const currencyHeaderForDisplay =
                            displayHeaders.find((h) => /^currency$/i.test(h)) ?? null;
                          const rowCurrency = currencyHeaderForDisplay
                            ? (row[currencyHeaderForDisplay] ?? '')
                            : '';
                          const primarySym = currencyDisplaySymbol(
                            getCachedWorkingCurrencies().primary || 'GBP'
                          );
                          const display = isDateColumn
                            ? formatDateDDMMYYYY(raw)
                            : isAmountColumn
                              ? formatAmountForRowCurrency(raw, rowCurrency)
                              : isCurrencyColumn
                                ? formatFx(raw)
                                : isAmountGbpColumn
                                  ? (() => {
                                      const s = (raw ?? '').trim();
                                      if (s === '') return '';
                                      const num = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
                                      if (Number.isNaN(num)) return raw;
                                      return formatCurrency(num, primarySym);
                                    })()
                                  : isAccountColumn
                                      ? accountLabelFromSource(raw) || raw
                                      : raw;
                          if (editMode && dataRowIndex >= 0 && !/^index$/i.test(header)) {
                            if (/^projet$/i.test(header)) {
                              return (
                                <td key={header} className="px-1 py-0.5 overflow-hidden">
                                  <ProjetSelectCell
                                    rawId={raw}
                                    projects={projects}
                                    disabled={false}
                                    onChange={(id) => handleCellChange(dataRowIndex, header, id)}
                                  />
                                </td>
                              );
                            }
                            const amountHeaderForRow = displayHeaders.find((h) => /^amount$/i.test(h));
                            const currencyHeaderForRow = displayHeaders.find((h) => /^currency$/i.test(h));
                            const isAmountGbpReadOnly =
                              isAmountGbpColumn &&
                              isAmountGbpIndicatorReadOnly(row, amountHeaderForRow, currencyHeaderForRow);
                            return (
                              <td key={header} className="px-1 py-0.5 overflow-hidden">
                                <input
                                  type="text"
                                  value={raw}
                                  readOnly={!!isAmountGbpReadOnly}
                                  onChange={(e) => handleCellChange(dataRowIndex, header, e.target.value)}
                                  className={`w-full rounded border px-2 py-1 text-sm text-gray-800 focus:ring-2 focus:ring-red-500 focus:border-red-500 ${isAmountGbpReadOnly ? 'border-gray-200 bg-gray-50 cursor-not-allowed' : 'border-gray-300'}`}
                                  aria-label={isAmountGbpReadOnly ? t('transactions.edit.computedCell', { header }) : t('transactions.edit.editCell', { header })}
                                  title={isAmountGbpReadOnly ? t('transactions.edit.computedTitle') : undefined}
                                />
                              </td>
                            );
                          }
                          if (/^projet$/i.test(header)) {
                            return (
                              <td
                                key={header}
                                className={`px-3 py-2 whitespace-nowrap ${editMode && /^index$/i.test(header) ? 'bg-gray-100' : ''}`}
                              >
                                <ProjetDisplayCell rawId={raw} projects={projects} />
                              </td>
                            );
                          }
                          return (
                            <td
                              key={header}
                              className={`px-3 py-2 text-gray-800 whitespace-nowrap ${editMode && /^index$/i.test(header) ? 'bg-gray-100' : ''}`}
                            >
                              {display}
                            </td>
                          );
                        })}
                        {editMode && dataRowIndex >= 0 && (
                          <td className="px-3 py-2 whitespace-nowrap bg-gray-50">
                            <button
                              type="button"
                              onClick={() => handleToggleExcludeAnomaly(dataRowIndex)}
                              className={`rounded border px-2 py-1 text-xs font-medium ${
                                rowsExcludedFromAnomaly.has(dataRowIndex)
                                  ? 'border-green-600 bg-green-600 text-white hover:bg-green-700'
                                  : 'border-amber-600 bg-amber-600 text-white hover:bg-amber-700'
                              }`}
                            >
                              {rowsExcludedFromAnomaly.has(dataRowIndex)
                                ? t('transactions.anomaly.include')
                                : t('transactions.anomaly.exclude')}
                            </button>
                          </td>
                        )}
                        {editMode && dataRowIndex >= 0 && (
                          <td className="px-3 py-2 whitespace-nowrap bg-gray-50">
                            <button
                              type="button"
                              onClick={() => handleToggleRowDelete(dataRowIndex)}
                              className="rounded border border-red-600 bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                            >
                              {isMarkedForDelete ? t('transactions.table.undoDelete') : t('transactions.table.deleteRow')}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr aria-hidden="true">
                      <td
                        colSpan={displayHeaders.length + (editMode ? 3 : 0)}
                        style={{ height: paddingBottom, padding: 0, border: 0 }}
                      />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 px-3 py-2 border-t border-gray-200 bg-gray-50 text-gray-500 text-xs">
              {t('transactions.table.footerRows', { count: displayRows.length })}
              {editMode && editShowAnomaliesOnly
                ? t('transactions.table.footerAnomaliesOnly', { sorted: sortedRows.length })
                : filterText
                  ? t('transactions.table.footerFiltered', { total: data.rows.length })
                  : ''}
            </div>
          </div>
        )}

      </main>
      {emptyImportConfirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transactions-empty-import-title"
          onClick={() => setEmptyImportConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="transactions-empty-import-title" className="text-lg font-semibold text-gray-900">
              {t('transactions.importWizard.emptyConfirmTitle')}
            </h2>
            <p className="text-sm text-gray-600">
              {t('transactions.importWizard.emptyConfirmBody')}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEmptyImportConfirmOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('transactions.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmEmptyTransactionsImport()}
                className="rounded border border-red-600 bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                {t('transactions.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
      {editExitConfirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transactions-edit-exit-title"
          onClick={() => setEditExitConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="transactions-edit-exit-title" className="text-lg font-semibold text-gray-900">
              {t('transactions.edit.exitConfirmTitle')}
            </h2>
            <p className="text-sm text-gray-600">
              {t('transactions.edit.exitConfirmBody')}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditExitConfirmOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('transactions.edit.exitConfirmBack')}
              </button>
              <button
                type="button"
                onClick={performExitEditMode}
                className="rounded border border-red-600 bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                {t('transactions.edit.exitConfirmLeave')}
              </button>
            </div>
          </div>
        </div>
      )}
      <AnomalyExceptionsModal
        open={anomalyExceptionsModalOpen}
        onClose={() => setAnomalyExceptionsModalOpen(false)}
        onAfterSave={() => {
          void refreshSlimAnomalies(false);
          if (!editMode) void loadViewScope(selectedMonth);
        }}
      />
    </>
  );
};

export default TransactionsTable;
