/// <reference path="../vite-env.d.ts" />
import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { ANOMALY_REPORT_PATH, transactionsImportFile } from '@/shared/dataPaths';
import {
  SourceDataCSVService,
  type SourceDataResult,
  SOURCE_DATA_PATH,
  normalizeOrderAndIndex,
  stripSourceColumnFromSourceData,
  sortSourceDataByDateChronology,
} from '../services/SourceDataCSVService';
import { detectAnomalies, EXCLUDE_ANOMALY_COLUMN } from '../services/AnomalyDetectionService';
import { canonicalAccountFromSource, accountLabelFromSource } from '../constants/accountSourceLabels';
import { formatDateDDMMYYYY, formatEur, formatFx, formatGbp, formatAmountGbpForCsv } from '../utils/format';
import { amountToGbp } from '../services/EffectiveExchangeRates';
import Papa from 'papaparse';
import { AnomalyExceptionsModal } from '../components/AnomalyExceptionsModal';
import TransactionsImportPrepSection from '../components/TransactionsImportPrepSection';
import { useTransactionsImportPrepWizard } from '../hooks/useTransactionsImportPrepWizard';
import { getUiMessageTone, uiMessageClass } from '../utils/uiMessageTone';
import { formatDateDDMMYY, rowSignature, buildAccountAliasLookup, type ValidRow } from '@/shared/transactionsImportCore';
import { loadRecognisedAccountsFromStorage } from '../constants/recognisedAccountsStorage';
import { useProjectsFromStorage } from '../hooks/useProjectsFromStorage';
import { ProjetDisplayCell, ProjetSelectCell } from '../components/ProjetColumnCells';
import { ResizableTableHeadCell } from '../components/Common/ResizableTableHeadCell';
import {
  defaultEditColumnWidth,
  useResizableTableColumns,
  type ResizableColumnDef,
} from '../hooks/useResizableTableColumns';

const ANOMALY_STATUS_STORAGE_KEY = 'transactions-anomaly-status';
const ANOMALY_LAST_REPORT_STORAGE_KEY = 'transactions-anomaly-last-report';

/** Clé de tri pour la colonne Anomalie (mode édition). */
const ANOMALY_SORT_COLUMN_KEY = '__anomaly__';
/** Clé du filtre « rechercher dans la colonne Anomalie » (barre de recherche, mode édition). */
const ANOMALY_FILTER_COLUMN_KEY = '__anomaly_filter__';

/** Persistance replier/déplier des blocs Import wizard et détection d’anomalies. */
const TX_IMPORT_MODULE_EXPANDED_KEY = 'transactions-import-module-expanded';
const TX_ANOMALY_MODULE_EXPANDED_KEY = 'transactions-anomaly-module-expanded';
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

/** Formate une date ISO en "DD/MM/YYYY à HH:mm". */
function formatReportDate(iso: string, prefix: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${prefix} le ${day}/${month}/${year} à ${h}:${min}`;
  } catch {
    return iso;
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
  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    SourceDataCSVService.load()
      .then((result) => {
        setData(result);
        if (!result) {
          setError(`Fichier ${SOURCE_DATA_PATH} absent ou vide.`);
        }
      })
      .catch((err) => {
        setError(err?.message ?? 'Erreur lors du chargement des données.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /** Alias compte (Paramètres + défauts) pour signatures doublons à l’import. */
  const accountAliasLookup = useMemo(
    () => buildAccountAliasLookup(loadRecognisedAccountsFromStorage()),
    [data]
  );

  /** Signatures des lignes déjà enregistrées (détection de doublons à l’import). */
  const existingTransactionSignatures = useMemo(() => {
    if (!data?.rows?.length) return new Set<string>();
    const headers = data.headers;
    const cell = (row: Record<string, string>, re: RegExp) => {
      const h = headers.find((x) => re.test(x));
      return h ? (row[h] ?? '').trim() : '';
    };
    const sigs = new Set<string>();
    for (const row of data.rows) {
      // Même normalisation DATE que processImportRow / prévisualisation wizard (JJ.MM.AA),
      // alors que SourceDataCSVService affiche souvent JJ.MM.AAAA — sinon les signatures ne coïncident pas.
      const vr: ValidRow = {
        DATE: formatDateDDMMYY(cell(row, /^date$/i)),
        TITLE: cell(row, /^title$/i),
        AMOUNT: cell(row, /^amount$/i),
        CURRENCY: cell(row, /^currency$/i),
        ACCOUNT: cell(row, /^account$/i),
        'AMOUNT GBP': cell(row, /^amount\s*gbp$/i),
        TYPE: cell(row, /^type$/i),
      };
      sigs.add(rowSignature(vr, { accountAliasLookup }));
    }
    return sigs;
  }, [data, accountAliasLookup]);

  const prepWizard = useTransactionsImportPrepWizard({
    existingTransactionSignatures,
    accountAliasLookup,
    onAfterSuccessfulAppend: loadData,
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

  /** Aligné sur le rapport d’anomalies (index de ligne = même que dans le CSV). */
  const transactionAnomalyByDataRowIndex = useMemo(() => {
    if (!data?.rows) return new Map<number, string>();
    const { anomalies } = detectAnomalies(data);
    const map = new Map<number, string>();
    for (const a of anomalies) {
      map.set(a.rowIndex - 1, a.reasons.join(' ; '));
    }
    return map;
  }, [data]);

  /** Valeurs figées pour le filtre recherche en mode édition (pas de re-filtrage à chaque frappe). */
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
      anomalyMap.set(a.rowIndex - 1, a.reasons.join(' ; '));
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
  }, []);

  useEffect(() => {
    if (!editMode) {
      setEditFilterRowSnapshot(null);
      setEditFilterAnomalySnapshot(null);
      setEditFilterDateBounds(null);
      return;
    }
    applyEditFilterSnapshot();
  }, [editMode, filterText, filterColumn, applyEditFilterSnapshot]);

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
    if (sortColumn === ANOMALY_SORT_COLUMN_KEY) {
      if (!editMode || !data?.rows) return filteredRows;
      return [...filteredRows].sort((a, b) => {
        const ia = data.rows.findIndex((r) => r === a);
        const ib = data.rows.findIndex((r) => r === b);
        const ta = ia >= 0 ? (transactionAnomalyByDataRowIndex.get(ia) ?? '') : '';
        const tb = ib >= 0 ? (transactionAnomalyByDataRowIndex.get(ib) ?? '') : '';
        const cmp = ta.localeCompare(tb, undefined, { sensitivity: 'base' });
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }
    if (!sortColumn || !data?.headers.includes(sortColumn)) return filteredRows;
    return [...filteredRows].sort((a, b) => {
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
  }, [
    filteredRows,
    sortColumn,
    sortDirection,
    data?.headers,
    data?.rows,
    editMode,
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

  const displayRows = useMemo(() => {
    if (!editMode || !editShowAnomaliesOnly) return sortedRows;
    return sortedRows.filter((row) => {
      const dataRowIndex = data?.rows.findIndex((r) => r === row) ?? -1;
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
    data?.rows,
    transactionAnomalyByDataRowIndex,
    anomalyFilterStickyIndices,
  ]);

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
              ? `${result.movedCount} fichier(s) déplacé(s) vers la corbeille.`
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
    if (!data) {
      setAnomalyMessageState('Chargez les données d\'abord.');
      return;
    }
    const api = (window as unknown as {
      electronAPI?: { writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }> };
    }).electronAPI;
    if (!api?.writeFile) {
      setAnomalyMessageState('Fonction d\'écriture non disponible.');
      return;
    }
    setAnomalyLoading(true);
    try {
      const { anomalies, csvContent } = detectAnomalies(data);
      const reportPath = ANOMALY_REPORT_PATH;
      const writeResult = await api.writeFile(reportPath, csvContent);
      if (writeResult.success) {
        const now = new Date().toISOString();
        setAnomalyLastReportAt(now);
        try {
          localStorage.setItem(ANOMALY_LAST_REPORT_STORAGE_KEY, now);
        } catch {}
        setAnomalyMessage(
          anomalies.length === 0
            ? 'Aucune anomalie détectée. Rapport mis à jour dans Processed/anomaly_report.csv.'
            : `${anomalies.length} anomalie(s) → rapport écrit dans Processed/anomaly_report.csv.`
        );
      } else {
        setAnomalyMessage(writeResult.error ?? 'Erreur lors de l\'écriture du rapport.');
      }
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
          ? `Fichier copié dans Import : ${copied[0]}`
          : `${copied.length} fichiers copiés dans Import : ${copied.join(', ')}`
      );
      setImportFolderReloadToken((k) => k + 1);
    } finally {
      setImportFileLoading(false);
    }
  };

  const performExitEditMode = useCallback(() => {
    if (editSessionBaselineRef.current) {
      setData(cloneSourceDataResult(editSessionBaselineRef.current));
      editSessionBaselineRef.current = null;
    }
    setRowsToDelete(new Set());
    setEditMode(false);
    setSaveMessage(null);
    setEditExitConfirmOpen(false);
  }, []);

  const handleToggleEditMode = () => {
    if (!editMode) {
      if (data) editSessionBaselineRef.current = cloneSourceDataResult(data);
      setEditMode(true);
      setSaveMessage(null);
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
    const api = (window as unknown as {
      electronAPI?: { writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }> };
    }).electronAPI;
    if (!api?.writeFile) {
      setSaveMessage('Fonction d\'écriture non disponible.');
      return;
    }
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
      const csvContent = Papa.unparse(normalized.rows, {
        columns: normalized.headers,
        delimiter: ';',
      });
      const result = await api.writeFile(SOURCE_DATA_PATH, csvContent);
      if (result.success) {
        setData(normalized);
        dataForFilterSnapshotRef.current = normalized;
        editSessionBaselineRef.current = cloneSourceDataResult(normalized);
        setRowsToDelete(new Set());
        /* Comme à la sortie du mode édition : repartir d’un affichage aligné sur les données enregistrées
         * (filtre « anomalies seulement » + lignes collantes après correction d’anomalie). */
        setEditShowAnomaliesOnly(false);
        setAnomalyFilterStickyIndices(new Set());
        applyEditFilterSnapshot();
        setEditExitConfirmOpen(false);
        setSaveMessage('Fichier src_transaction_data.csv enregistré.');
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
        'Quittez le mode édition pour rafraîchir le fichier (les modifications non enregistrées ne sont pas prises en compte).'
      );
      return;
    }
    setReorderChronoLoading(true);
    setReorderChronoMessage(null);
    try {
      const fresh = await SourceDataCSVService.load();
      if (!fresh?.headers?.length || !fresh?.rows?.length) {
        setReorderChronoMessage(`Fichier ${SOURCE_DATA_PATH} absent ou vide.`);
        return;
      }
      const headers = fresh.headers.includes(EXCLUDE_ANOMALY_COLUMN)
        ? fresh.headers
        : [...fresh.headers, EXCLUDE_ANOMALY_COLUMN];
      const rows = fresh.headers.includes(EXCLUDE_ANOMALY_COLUMN)
        ? fresh.rows.map((r) => ({ ...r }))
        : fresh.rows.map((r) => ({ ...r, [EXCLUDE_ANOMALY_COLUMN]: '' }));
      const stripped = stripSourceColumnFromSourceData({ headers, rows });
      const sorted = sortSourceDataByDateChronology(stripped);
      const amountHeader = sorted.headers.find((h) => /^amount$/i.test(h)) ?? null;
      const currencyHeader = sorted.headers.find((h) => /^currency$/i.test(h)) ?? null;
      const amountGbpHeader = sorted.headers.find((h) => /^amount\s*gbp$/i.test(h)) ?? null;
      if (!amountHeader || !currencyHeader || !amountGbpHeader) {
        setReorderChronoMessage('Colonnes AMOUNT / CURRENCY / AMOUNT GBP introuvables.');
        return;
      }
      let updated = 0;
      const rowsOut = sorted.rows.map((row) => {
        const next = { ...row };
        const amountStr = (next[amountHeader] ?? '').trim().replace(',', '.');
        const amount = parseFloat(amountStr);
        const currency = (next[currencyHeader] ?? '').trim().toUpperCase();
        if (!Number.isNaN(amount) && amount !== 0 && (currency === 'EUR' || currency === 'CHF')) {
          const gbp = amountToGbp(amount, currency);
          if (gbp !== null) {
            next[amountGbpHeader] = formatAmountGbpForCsv(gbp);
            updated++;
          }
        }
        return next;
      });
      const refreshed: SourceDataResult = { headers: sorted.headers, rows: rowsOut };
      const api = (window as unknown as {
        electronAPI?: { writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }> };
      }).electronAPI;
      if (!api?.writeFile) {
        setReorderChronoMessage("Fonction d'écriture non disponible.");
        return;
      }
      const csvContent = Papa.unparse(refreshed.rows, { columns: refreshed.headers, delimiter: ';' });
      const result = await api.writeFile(SOURCE_DATA_PATH, csvContent);
      if (result.success) {
        setData(refreshed);
        editSessionBaselineRef.current = cloneSourceDataResult(refreshed);
        setReorderChronoMessage(
          `${refreshed.rows.length} ligne(s) triées par date (index 1…${refreshed.rows.length}) ; ${updated} montant(s) GBP recalculé(s).`
        );
      } else {
        setReorderChronoMessage(result.error ?? "Erreur lors de l'enregistrement.");
      }
    } catch (e) {
      setReorderChronoMessage(e instanceof Error ? e.message : 'Erreur lors du rafraîchissement.');
    } finally {
      setReorderChronoLoading(false);
    }
  };

  const handleCellChange = useCallback(
    (dataRowIndex: number, header: string, value: string) => {
      setData((prev) => {
        if (!prev) return prev;
        const amountHeader = prev.headers.find((h) => /^amount$/i.test(h)) ?? null;
        const currencyHeader = prev.headers.find((h) => /^currency$/i.test(h)) ?? null;
        const amountGbpHeader = prev.headers.find((h) => /^amount\s*gbp$/i.test(h)) ?? null;
        return {
          ...prev,
          rows: prev.rows.map((row, i) => {
            if (i !== dataRowIndex) return row;
            const next = { ...row, [header]: value };
            if ((header === amountHeader || header === currencyHeader) && amountHeader && currencyHeader && amountGbpHeader) {
              const amountRaw = (next[amountHeader] ?? '').trim().replace(',', '.');
              const amount = parseFloat(amountRaw);
              if (!Number.isNaN(amount) && amount !== 0) {
                if (!(next[currencyHeader] ?? '').trim()) next[currencyHeader] = 'EUR';
                const effectiveCurrency = (next[currencyHeader] ?? '').trim().toUpperCase() || 'EUR';
                if (effectiveCurrency === 'EUR' || effectiveCurrency === 'CHF') {
                  const gbp = amountToGbp(amount, effectiveCurrency);
                  if (gbp !== null) next[amountGbpHeader] = formatAmountGbpForCsv(gbp);
                }
              }
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
          <h1 className="text-2xl font-bold text-gray-800">Tableau des transactions</h1>

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
                  <h2 className="text-lg font-semibold text-gray-800">Import wizard</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {importModuleExpanded ? 'Fermer' : 'Ouvrir'} le module d&apos;importation de données
                  </p>
                </div>
              </div>
            </div>
          {importModuleExpanded && (
            <div id="transactions-import-module" className="mt-3">
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
                          onClick={handleImportCsvFile}
                          disabled={importFileLoading}
                          className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {importFileLoading ? 'Import en cours…' : 'Importer des fichiers (CSV)'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void prepWizard.handleOpenImportFolder()}
                          className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Ouvrir le dossier d'importation
                        </button>
                        <button
                          type="button"
                          onClick={() => setEmptyImportConfirmOpen(true)}
                          disabled={archiveLoading}
                          className="rounded border border-red-600 bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {archiveLoading ? 'Vidage…' : 'Vider le dossier d\'import'}
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
                              ? 'Activez le mapping wizard pour préparer l’import vers src_transaction_data.csv'
                              : prepWizard.importPreviewImportableRows.length === 0
                                ? 'Aucune ligne importable (ignorées, invalides ou doublons) avec les réglages actuels'
                                : undefined
                          }
                          className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {prepWizard.importLinesLoading ? 'Import…' : 'Importer les lignes'}
                        </button>
                        {prepWizard.mappingWizardActive && (
                          <label
                            className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none"
                            title="Après un import réussi, retire du dossier Import les lignes qui viennent d’être ajoutées à src_transaction_data.csv (les lignes collées depuis le presse-papiers ne sont pas concernées)."
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
                            Retirer du dossier Import les lignes importées
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
                    Détection d&apos;anomalies et mode édition
                  </h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {anomalyModuleExpanded ? 'Fermer' : 'Ouvrir'} le module d&apos;édition des données existantes
                  </p>
                </div>
              </div>
            </div>
            {anomalyModuleExpanded && (
              <div id="transactions-anomaly-module" className="mt-3">
                <div
                  className="rounded-lg border border-gray-200 bg-gray-50/50 p-4"
                  aria-label="Zone détection d’anomalies"
                >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleRefreshSourceDataCsv}
                          disabled={reorderChronoLoading || !data || saveLoading}
                          title={
                            editMode
                              ? 'Quittez le mode édition pour rafraîchir src_transaction_data.csv.'
                              : 'Trie le fichier par date, réattribue les index et recalcule AMOUNT GBP.'
                          }
                          className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {reorderChronoLoading ? 'Rafraîchissement…' : 'Rafraîchir src_transaction_data.csv'}
                        </button>
                        <button
                          type="button"
                          onClick={handleDetectAnomalies}
                          disabled={anomalyLoading || !data}
                          className="rounded border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                        >
                          {anomalyLoading ? 'Analyse…' : 'Détecter des anomalies'}
                        </button>
                        <button
                          type="button"
                          onClick={handleOpenAnomalyReport}
                          className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Ouvrir le rapport d'anomalies
                        </button>
                        <button
                          type="button"
                          onClick={() => setAnomalyExceptionsModalOpen(true)}
                          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Liste des exceptions
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
                          {editMode ? 'Quitter le mode édition' : 'Mode édition'}
                        </button>
                        {editMode && (
                          <button
                            type="button"
                            onClick={handleSaveSourceData}
                            disabled={saveLoading || !data}
                            className="rounded border border-green-600 bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {saveLoading ? 'Enregistrement…' : 'Sauvegarder src_transaction_data.csv'}
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
                              {formatReportDate(anomalyLastReportAt, 'Dernier rapport d\'anomalies généré')}
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
            Chargement…
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
              <div className="flex items-center gap-2 min-w-0">
                <label htmlFor="tx-filter-col" className="text-gray-600 text-sm whitespace-nowrap">
                  Colonne
                </label>
                <select
                  id="tx-filter-col"
                  value={filterColumn}
                  onChange={(e) => setFilterColumn(e.target.value)}
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[120px]"
                >
                  <option value="__all__">Toutes</option>
                  {editMode && (
                    <option value={ANOMALY_FILTER_COLUMN_KEY}>Anomalie</option>
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
                  Rechercher
                </label>
                <input
                  id="tx-filter-text"
                  type="text"
                  placeholder="Rechercher…"
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
                    Effacer
                  </button>
                )}
              </div>
              <span className="text-gray-500 text-sm">
                {filteredRows.length} / {data.rows.length} ligne{data.rows.length !== 1 ? 's' : ''}
              </span>
              {editMode && (
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editShowAnomaliesOnly}
                    onChange={(e) => setEditShowAnomaliesOnly(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Uniquement les lignes avec anomalies
                </label>
              )}
              {editMode && (
                <span className="text-red-600 text-sm font-medium">Mode édition — les cellules sont modifiables</span>
              )}
              {editMode && hasCustomColWidths && (
                <button
                  type="button"
                  onClick={resetColWidths}
                  className="text-sm text-gray-600 hover:text-gray-900 underline"
                >
                  Réinitialiser les largeurs de colonnes
                </button>
              )}
            </div>
            <div className="overflow-auto flex-1 min-h-0">
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
                          Anomalie
                          {sortColumn === ANOMALY_SORT_COLUMN_KEY && (
                            <span className="text-blue-600" aria-label={sortDirection === 'asc' ? 'Croissant' : 'Décroissant'}>
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
                              <span className="text-blue-600" aria-label={sortDirection === 'asc' ? 'Croissant' : 'Décroissant'}>
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
                              <span className="text-blue-600" aria-label={sortDirection === 'asc' ? 'Croissant' : 'Décroissant'}>
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
                        Exclure Anomalie
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
                        Supprimer
                      </ResizableTableHeadCell>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, i) => {
                    const dataRowIndex = data ? data.rows.findIndex((r) => r === row) : -1;
                    const isMarkedForDelete = dataRowIndex >= 0 && rowsToDelete.has(dataRowIndex);
                    const isExcludedFromAnomaly = dataRowIndex >= 0 && rowsExcludedFromAnomaly.has(dataRowIndex);
                    const anomalyText =
                      dataRowIndex >= 0 ? transactionAnomalyByDataRowIndex.get(dataRowIndex) ?? '' : '';
                    return (
                      <tr
                        key={i}
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
                          const isAmountGbpColumn = /^amount\s*gbp$/i.test(header);
                          const isAccountColumn = /^account$/i.test(header) || /compte/i.test(header);
                          const display = isDateColumn
                            ? formatDateDDMMYYYY(raw)
                            : isAmountColumn
                              ? formatEur(raw)
                              : isCurrencyColumn
                                ? formatFx(raw)
                                : isAmountGbpColumn
                                  ? formatGbp(raw)
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
                            const effectiveCurrency = currencyHeaderForRow ? ((row[currencyHeaderForRow] ?? '').trim().toUpperCase() || 'EUR') : 'EUR';
                            const isAmountGbpReadOnly =
                              isAmountGbpColumn &&
                              amountHeaderForRow &&
                              currencyHeaderForRow &&
                              (() => {
                                const a = parseFloat((row[amountHeaderForRow] ?? '').toString().replace(',', '.'));
                                return !Number.isNaN(a) && a !== 0 && (effectiveCurrency === 'EUR' || effectiveCurrency === 'CHF');
                              })();
                            return (
                              <td key={header} className="px-1 py-0.5 overflow-hidden">
                                <input
                                  type="text"
                                  value={raw}
                                  readOnly={!!isAmountGbpReadOnly}
                                  onChange={(e) => handleCellChange(dataRowIndex, header, e.target.value)}
                                  className={`w-full rounded border px-2 py-1 text-sm text-gray-800 focus:ring-2 focus:ring-red-500 focus:border-red-500 ${isAmountGbpReadOnly ? 'border-gray-200 bg-gray-50 cursor-not-allowed' : 'border-gray-300'}`}
                                  aria-label={isAmountGbpReadOnly ? `${header} (calculé)` : `Éditer ${header}`}
                                  title={isAmountGbpReadOnly ? 'Calculé à partir de AMOUNT et CURRENCY (taux Settings)' : undefined}
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
                                ? 'Inclure anomalie'
                                : 'Exclure anomalie'}
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
                              {isMarkedForDelete ? 'Annuler suppression' : 'Supprimer la ligne'}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 px-3 py-2 border-t border-gray-200 bg-gray-50 text-gray-500 text-xs">
              {displayRows.length} ligne{displayRows.length !== 1 ? 's' : ''}
              {editMode && editShowAnomaliesOnly
                ? ` (anomalies uniquement, ${sortedRows.length} après tri/filtre)`
                : filterText
                  ? ` (filtré sur ${data.rows.length} au total)`
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
              Vider le dossier d&apos;import ?
            </h2>
            <p className="text-sm text-gray-600">
              Tous les fichiers du dossier Import (transactions) seront déplacés vers la corbeille du système. Vous pourrez les restaurer depuis la corbeille si besoin.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEmptyImportConfirmOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmEmptyTransactionsImport()}
                className="rounded border border-red-600 bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Confirmer
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
              Quitter sans sauvegarder ?
            </h2>
            <p className="text-sm text-gray-600">
              Les modifications non enregistrées seront perdues.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditExitConfirmOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Retour
              </button>
              <button
                type="button"
                onClick={performExitEditMode}
                className="rounded border border-red-600 bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Quitter
              </button>
            </div>
          </div>
        </div>
      )}
      <AnomalyExceptionsModal
        open={anomalyExceptionsModalOpen}
        onClose={() => setAnomalyExceptionsModalOpen(false)}
        onAfterSave={loadData}
      />
    </>
  );
};

export default TransactionsTable;
