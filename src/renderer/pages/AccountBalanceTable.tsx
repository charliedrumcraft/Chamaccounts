import { useTranslation } from 'react-i18next';
import { formatAnomalyReasons } from '../i18n/formatAnomalyReason';
import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { format, startOfDay } from 'date-fns';
import {
  ACCOUNT_BALANCE_PROCESSED_DIR,
  accountBalanceImportFile,
} from '@/shared/dataPaths';
import {
  AccountBalanceCSVService,
  getBalanceCodeForSettingsAccountName,
  getDisplayNameForAccountCode,
  ACCOUNT_CODE_TO_CURRENCY,
  formatAmountForFiat,
  type AccountFiatCurrency,
  type BalanceRow,
} from '../services/AccountBalanceCSVService';
import AccountBalanceImportPrepSection from '../components/AccountBalanceImportPrepSection';
import { useAccountBalanceImportPrepWizard } from '../hooks/useAccountBalanceImportPrepWizard';
import { detectAccountBalanceAnomalies } from '../services/AnomalyDetectionService';
import { loadRecognisedAccountsFromStorage } from '../constants/recognisedAccountsStorage';
import { formatBalanceAmountForUi } from '../utils/format';
import { ResizableTableHeadCell } from '../components/Common/ResizableTableHeadCell';
import {
  defaultEditColumnWidth,
  useResizableTableColumns,
  type ResizableColumnDef,
} from '../hooks/useResizableTableColumns';
import { getUiMessageTone, uiMessageClass } from '../utils/uiMessageTone';

const AB_ANOMALY_STATUS_KEY = 'account-balance-anomaly-status';
const AB_ANOMALY_LAST_REPORT_KEY = 'account-balance-anomaly-last-report';

/** Clé de tri pour la colonne Anomalie (mode édition). */
const ANOMALY_SORT_COLUMN_KEY = '__anomaly__';
/** Clé du filtre « rechercher dans la colonne Anomalie » (barre de recherche, mode édition). */
const ANOMALY_FILTER_COLUMN_KEY = '__anomaly_filter__';

/** Persistance replier/déplier des blocs Import wizard et détection d’anomalies. */
const AB_IMPORT_MODULE_EXPANDED_KEY = 'account-balance-import-module-expanded';
const AB_ANOMALY_MODULE_EXPANDED_KEY = 'account-balance-anomaly-module-expanded';
const AB_TABLE_COL_WIDTHS_KEY = 'account-balance-table-col-widths';

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

/** Formate une date ISO en parties date/heure. */
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

function cloneBalanceRow(row: BalanceRow): BalanceRow {
  return {
    date: new Date(row.date.getTime()),
    balances: { ...row.balances },
  };
}

function cloneBalanceRows(rows: BalanceRow[]): BalanceRow[] {
  return rows.map(cloneBalanceRow);
}

/** État du mode édition à restaurer si l’utilisateur quitte sans enregistrer. */
type AccountBalanceEditSessionSnapshot = {
  rows: BalanceRow[];
  rowsToDelete: Set<number>;
  cellDrafts: Record<string, string>;
  newRowDrafts: Record<string, string>[];
};

function takeAccountBalanceEditSnapshot(
  rows: BalanceRow[],
  rowsToDelete: Set<number>,
  cellDrafts: Record<string, string>,
  newRowDrafts: Record<string, string>[]
): AccountBalanceEditSessionSnapshot {
  return {
    rows: cloneBalanceRows(rows),
    rowsToDelete: new Set(rowsToDelete),
    cellDrafts: { ...cellDrafts },
    newRowDrafts: newRowDrafts.map((d) => ({ ...d })),
  };
}

function restoreAccountBalanceEditSnapshot(
  s: AccountBalanceEditSessionSnapshot
): Pick<
  AccountBalanceEditSessionSnapshot,
  'rows' | 'rowsToDelete' | 'cellDrafts' | 'newRowDrafts'
> {
  return {
    rows: cloneBalanceRows(s.rows),
    rowsToDelete: new Set(s.rowsToDelete),
    cellDrafts: { ...s.cellDrafts },
    newRowDrafts: s.newRowDrafts.map((d) => ({ ...d })),
  };
}

function isAccountBalanceEditSessionDirty(
  rows: BalanceRow[],
  rowsToDelete: Set<number>,
  cellDrafts: Record<string, string>,
  newRowDrafts: Record<string, string>[],
  baseline: AccountBalanceEditSessionSnapshot
): boolean {
  const cur = takeAccountBalanceEditSnapshot(rows, rowsToDelete, cellDrafts, newRowDrafts);
  if (cur.rows.length !== baseline.rows.length) return true;
  for (let i = 0; i < cur.rows.length; i++) {
    if (cur.rows[i].date.getTime() !== baseline.rows[i].date.getTime()) return true;
    const A = cur.rows[i].balances;
    const B = baseline.rows[i].balances;
    const keys = new Set([...Object.keys(A), ...Object.keys(B)]);
    for (const k of keys) {
      const na = A[k] === undefined ? 0 : A[k];
      const nb = B[k] === undefined ? 0 : B[k];
      if (Math.abs(na - nb) > 1e-9) return true;
    }
  }
  if (cur.rowsToDelete.size !== baseline.rowsToDelete.size) return true;
  for (const x of cur.rowsToDelete) {
    if (!baseline.rowsToDelete.has(x)) return true;
  }
  for (const x of baseline.rowsToDelete) {
    if (!cur.rowsToDelete.has(x)) return true;
  }
  if (JSON.stringify(cur.cellDrafts) !== JSON.stringify(baseline.cellDrafts)) return true;
  if (cur.newRowDrafts.length !== baseline.newRowDrafts.length) return true;
  for (let i = 0; i < cur.newRowDrafts.length; i++) {
    if (JSON.stringify(cur.newRowDrafts[i]) !== JSON.stringify(baseline.newRowDrafts[i])) return true;
  }
  return false;
}

const AccountBalanceTable: React.FC = () => {
  const { t, i18n } = useTranslation();
  const location = useLocation();

  const [rows, setRows] = useState<BalanceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [filterColumn, setFilterColumn] = useState<string>('__all__');
  const [sortColumn, setSortColumn] = useState<string | null>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [importFileLoading, setImportFileLoading] = useState(false);
  const [importFileMessage, setImportFileMessage] = useState<string | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
  const [emptyAbImportConfirmOpen, setEmptyAbImportConfirmOpen] = useState(false);
  /** Incrémenté après copie de fichiers vers Import ou vidage du dossier (rechargement du rapport / état aligné sur TransactionsTable). */
  const [importFolderReloadToken, setImportFolderReloadToken] = useState(0);
  /** Affiche ou masque préparation d’import + wizard (sous le titre). */
  const [importModuleExpanded, setImportModuleExpanded] = useState(() =>
    readModuleExpandedFromStorage(AB_IMPORT_MODULE_EXPANDED_KEY)
  );
  /** Affiche ou masque le bloc détection d’anomalies + édition. */
  const [anomalyModuleExpanded, setAnomalyModuleExpanded] = useState(() =>
    readModuleExpandedFromStorage(AB_ANOMALY_MODULE_EXPANDED_KEY)
  );
  const [anomalyLoading, setAnomalyLoading] = useState(false);
  const [anomalyMessage, setAnomalyMessageState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(AB_ANOMALY_STATUS_KEY);
    } catch {
      return null;
    }
  });
  const [anomalyLastReportAt, setAnomalyLastReportAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(AB_ANOMALY_LAST_REPORT_KEY);
    } catch {
      return null;
    }
  });
  const [editMode, setEditMode] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  /** État à restaurer en quittant le mode édition sans sauvegarder (mis à jour après chaque enregistrement réussi). */
  const editSessionBaselineRef = useRef<AccountBalanceEditSessionSnapshot | null>(null);
  const [editExitConfirmOpen, setEditExitConfirmOpen] = useState(false);
  const [rowsToDelete, setRowsToDelete] = useState<Set<number>>(() => new Set());
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({});
  /** Lignes vides en mode édition pour de nouvelles entrées (fusionnées à l’enregistrement si remplies). */
  const [newRowDrafts, setNewRowDrafts] = useState<Record<string, string>[]>(() => [{}]);

  const setAnomalyMessage = useCallback((msg: string | null) => {
    setAnomalyMessageState(msg);
    try {
      if (msg != null) localStorage.setItem(AB_ANOMALY_STATUS_KEY, msg);
      else localStorage.removeItem(AB_ANOMALY_STATUS_KEY);
    } catch {}
  }, []);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    AccountBalanceCSVService.loadAllBalanceRows()
      .then((data) => {
        setRows(data ?? null);
        if (!data) {
          setError(`Fichier ${ACCOUNT_BALANCE_PROCESSED_DIR}/src_account_balance.csv absent ou vide.`);
        }
      })
      .catch((err) => {
        setError(err?.message ?? t('accountBalance.loadFailed'));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const existingBalanceDateKeysForWizard = useMemo(() => {
    const s = new Set<string>();
    if (!rows?.length) return s;
    for (const r of rows) {
      s.add(format(startOfDay(r.date), 'yyyy-MM-dd'));
    }
    return s;
  }, [rows]);

  const abPrepWizard = useAccountBalanceImportPrepWizard({
    existingBalanceDateKeys: existingBalanceDateKeysForWizard,
    onAfterSuccessfulAppend: loadData,
    folderReloadToken: importFolderReloadToken,
    recognisedAccountsReloadKey: location.pathname,
  });

  const recognisedAccounts = useMemo(
    () => loadRecognisedAccountsFromStorage(),
    [location.pathname]
  );

  /** Carte anomalies slim (IPC) — colonne Anomalie hors édition. */
  const [slimAnomalyByRowIndex, setSlimAnomalyByRowIndex] = useState<Map<number, string>>(
    () => new Map()
  );

  const refreshSlimAnomalies = useCallback(
    async (writeReport = false) => {
      const activeAccounts = recognisedAccounts
        .map((a) => ({ name: a.name.trim(), currency: a.currency }))
        .filter((a) => a.name && getBalanceCodeForSettingsAccountName(a.name));
      const result = await AccountBalanceCSVService.detectAnomalies({
        activeAccounts,
        writeReport,
      });
      const map = new Map<number, string>();
      if (result?.anomalies) {
        for (const a of result.anomalies) {
          if (a.rowIndex > 0) {
            map.set(a.rowIndex - 1, formatAnomalyReasons(a.reasons, t));
          }
        }
      }
      setSlimAnomalyByRowIndex(map);
      return result;
    },
    [recognisedAccounts, t]
  );

  useEffect(() => {
    void refreshSlimAnomalies(false);
  }, [refreshSlimAnomalies, rows?.length]);

  const accountNamesInOrder = useMemo(
    () => recognisedAccounts.map((e) => e.name),
    [recognisedAccounts]
  );

  const fiatByAccountCode = useMemo(() => {
    const m = new Map<string, AccountFiatCurrency>();
    for (const e of recognisedAccounts) {
      const code = getBalanceCodeForSettingsAccountName(e.name);
      if (code) m.set(code, e.currency);
    }
    return m;
  }, [recognisedAccounts]);

  const orderedAccountCodes = useMemo(
    () =>
      recognisedAccounts
        .map((e) => getBalanceCodeForSettingsAccountName(e.name))
        .filter((c): c is string => Boolean(c)),
    [recognisedAccounts]
  );

  const displayAccountCodes = useMemo(() => {
    if (!rows?.length) return [];
    const inData = new Set<string>();
    rows.forEach((r) => Object.keys(r.balances).forEach((c) => inData.add(c)));
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const entry of recognisedAccounts) {
      const code = getBalanceCodeForSettingsAccountName(entry.name);
      if (!code || !inData.has(code) || seen.has(code)) continue;
      ordered.push(code);
      seen.add(code);
    }
    return ordered;
  }, [rows, recognisedAccounts]);

  const tableAccountCodes = useMemo(() => {
    if (!editMode) return displayAccountCodes;
    const seen = new Set(orderedAccountCodes);
    const extra: string[] = [];
    rows?.forEach((r) => {
      Object.keys(r.balances).forEach((c) => {
        if (!seen.has(c)) {
          seen.add(c);
          extra.push(c);
        }
      });
    });
    extra.sort();
    return [...orderedAccountCodes, ...extra];
  }, [editMode, displayAccountCodes, orderedAccountCodes, rows]);

  const headers = useMemo(() => ['date', ...tableAccountCodes], [tableAccountCodes]);

  const resizableColumnDefs = useMemo((): ResizableColumnDef[] => {
    const cols: ResizableColumnDef[] = [];
    if (editMode) {
      cols.push({ key: ANOMALY_SORT_COLUMN_KEY, defaultWidth: 160 });
    }
    for (const h of headers) {
      cols.push({ key: h, defaultWidth: defaultEditColumnWidth(h) });
    }
    if (editMode) {
      cols.push({ key: '__delete__', defaultWidth: 130, resizable: false });
    }
    return cols;
  }, [headers, editMode]);

  const {
    getWidth: getColWidth,
    handleResizeStart: handleColResizeStart,
    resetWidths: resetColWidths,
    hasCustomWidths: hasCustomColWidths,
  } = useResizableTableColumns(AB_TABLE_COL_WIDTHS_KEY, resizableColumnDefs, editMode);

  const fiatForCode = useCallback(
    (code: string): AccountFiatCurrency => {
      const f = fiatByAccountCode.get(code);
      if (f) return f;
      const sym = ACCOUNT_CODE_TO_CURRENCY[code] ?? '€';
      if (sym === '£') return 'GBP';
      if (sym === 'CHF') return 'CHF';
      return 'EUR';
    },
    [fiatByAccountCode]
  );

  const getCellDisplay = (row: BalanceRow, col: string): string => {
    if (col === 'date') {
      return format(row.date, 'dd.MM.yyyy');
    }
    const value = row.balances[col];
    if (value === undefined) return '';
    const fiat = fiatByAccountCode.get(col);
    if (fiat) return formatBalanceAmountForUi(value, fiat);
    const sym = ACCOUNT_CODE_TO_CURRENCY[col] ?? '€';
    if (sym === 'CHF') return formatBalanceAmountForUi(value, 'CHF');
    return formatBalanceAmountForUi(value, sym === '£' ? 'GBP' : 'EUR');
  };

  const getCompareValue = (col: string, row: BalanceRow): number | string => {
    if (col === 'date') return row.date.getTime();
    const v = row.balances[col];
    return v !== undefined ? v : '';
  };

  /**
   * Colonne Anomalie : payload slim IPC hors édition ;
   * en édition, détection locale sur le brouillon affiché.
   */
  const accountBalanceAnomalyByDataRowIndex = useMemo(() => {
    if (editMode && rows?.length) {
      const activeAccounts = recognisedAccounts
        .map((a) => ({ name: a.name.trim(), currency: a.currency }))
        .filter((a) => a.name && getBalanceCodeForSettingsAccountName(a.name));
      const dateKey = 'DATE';
      const csvHeaders = [
        dateKey,
        ...tableAccountCodes.map((code) => {
          const e = recognisedAccounts.find(
            (x) => getBalanceCodeForSettingsAccountName(x.name) === code
          );
          return e?.name ?? code;
        }),
      ];
      const stringRows: Record<string, string>[] = rows.map((row) => {
        const o: Record<string, string> = { [dateKey]: format(row.date, 'dd.MM.yy') };
        for (const code of tableAccountCodes) {
          const e = recognisedAccounts.find(
            (x) => getBalanceCodeForSettingsAccountName(x.name) === code
          );
          const colName = e?.name ?? code;
          const v = row.balances[code];
          const fiat = fiatForCode(code);
          o[colName] =
            v !== undefined && Math.abs(v) >= 1e-9 ? formatAmountForFiat(v, fiat) : '';
        }
        return o;
      });
      const { rowAnomalies } = detectAccountBalanceAnomalies(csvHeaders, stringRows, activeAccounts);
      const map = new Map<number, string>();
      for (const a of rowAnomalies) {
        map.set(a.rowIndex - 1, formatAnomalyReasons(a.reasons, t));
      }
      return map;
    }
    return slimAnomalyByRowIndex;
  }, [
    editMode,
    rows,
    tableAccountCodes,
    recognisedAccounts,
    fiatForCode,
    slimAnomalyByRowIndex,
    t,
    i18n.language,
  ]);

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = filterText.trim().toLowerCase();
    if (!q) return rows;
    const colSel =
      !editMode && filterColumn === ANOMALY_FILTER_COLUMN_KEY ? '__all__' : filterColumn;
    if (editMode && colSel === ANOMALY_FILTER_COLUMN_KEY) {
      return rows.filter((row) => {
        const idx = rows.findIndex((r) => r === row);
        const text = idx >= 0 ? (accountBalanceAnomalyByDataRowIndex.get(idx) ?? '') : '';
        return text.toLowerCase().includes(q);
      });
    }
    const cols = colSel === '__all__' ? headers : [colSel];
    return rows.filter((row) =>
      cols.some((col) => {
        const display = getCellDisplay(row, col);
        return display.toLowerCase().includes(q);
      })
    );
  }, [
    rows,
    filterText,
    filterColumn,
    headers,
    fiatByAccountCode,
    editMode,
    accountBalanceAnomalyByDataRowIndex,
  ]);

  const sortedRows = useMemo(() => {
    if (sortColumn === ANOMALY_SORT_COLUMN_KEY) {
      if (!editMode || !rows) return filteredRows;
      return [...filteredRows].sort((a, b) => {
        const ia = rows.findIndex((r) => r === a);
        const ib = rows.findIndex((r) => r === b);
        const ta = ia >= 0 ? (accountBalanceAnomalyByDataRowIndex.get(ia) ?? '') : '';
        const tb = ib >= 0 ? (accountBalanceAnomalyByDataRowIndex.get(ib) ?? '') : '';
        const cmp = ta.localeCompare(tb, undefined, { sensitivity: 'base' });
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }
    if (!sortColumn || !headers.includes(sortColumn)) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const va = getCompareValue(sortColumn, a);
      const vb = getCompareValue(sortColumn, b);
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
    headers,
    editMode,
    rows,
    accountBalanceAnomalyByDataRowIndex,
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
      setSortColumn('date');
    }
  }, [editMode, sortColumn]);

  useEffect(() => {
    if (!editMode && filterColumn === ANOMALY_FILTER_COLUMN_KEY) {
      setFilterColumn('__all__');
    }
  }, [editMode, filterColumn]);

  useLayoutEffect(() => {
    const curr = accountBalanceAnomalyByDataRowIndex;
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
  }, [accountBalanceAnomalyByDataRowIndex, editMode, editShowAnomaliesOnly]);

  const displayRows = useMemo(() => {
    if (!editMode || !editShowAnomaliesOnly) return sortedRows;
    return sortedRows.filter((row) => {
      const dataRowIndex = rows?.findIndex((r) => r === row) ?? -1;
      if (dataRowIndex < 0) return false;
      return (
        accountBalanceAnomalyByDataRowIndex.has(dataRowIndex) ||
        anomalyFilterStickyIndices.has(dataRowIndex)
      );
    });
  }, [
    editMode,
    editShowAnomaliesOnly,
    sortedRows,
    rows,
    accountBalanceAnomalyByDataRowIndex,
    anomalyFilterStickyIndices,
  ]);

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const draftKey = (rowIndex: number, col: string) => `${rowIndex}:${col}`;

  const canonicalCellString = useCallback(
    (row: BalanceRow, col: string): string => {
      if (col === 'date') return format(row.date, 'dd.MM.yyyy');
      const v = row.balances[col];
      if (v === undefined) return '';
      return formatAmountForFiat(v, fiatForCode(col));
    },
    [fiatForCode]
  );

  const performExitEditMode = useCallback(() => {
    if (editSessionBaselineRef.current) {
      const r = restoreAccountBalanceEditSnapshot(editSessionBaselineRef.current);
      setRows(r.rows);
      setRowsToDelete(r.rowsToDelete);
      setCellDrafts(r.cellDrafts);
      setNewRowDrafts(r.newRowDrafts);
      editSessionBaselineRef.current = null;
    } else {
      setRowsToDelete(new Set());
      setNewRowDrafts([{}]);
      setCellDrafts({});
    }
    setEditMode(false);
    setSaveMessage(null);
    setEditExitConfirmOpen(false);
  }, []);

  const handleToggleEditMode = () => {
    if (!editMode) {
      if (rows) {
        editSessionBaselineRef.current = takeAccountBalanceEditSnapshot(
          rows,
          rowsToDelete,
          cellDrafts,
          newRowDrafts
        );
      }
      setEditMode(true);
      setSaveMessage(null);
    } else {
      if (
        rows &&
        editSessionBaselineRef.current &&
        isAccountBalanceEditSessionDirty(
          rows,
          rowsToDelete,
          cellDrafts,
          newRowDrafts,
          editSessionBaselineRef.current
        )
      ) {
        setEditExitConfirmOpen(true);
        return;
      }
      performExitEditMode();
    }
  };

  const handleNewRowDraftChange = useCallback((draftIndex: number, col: string, value: string) => {
    setNewRowDrafts((prev) =>
      prev.map((d, i) => (i === draftIndex ? { ...d, [col]: value } : d))
    );
  }, []);

  const handleAddNewDraftRow = useCallback(() => {
    setNewRowDrafts((prev) => [...prev, {}]);
  }, []);

  const handleToggleRowDelete = useCallback((dataRowIndex: number) => {
    setRowsToDelete((prev) => {
      const next = new Set(prev);
      if (next.has(dataRowIndex)) next.delete(dataRowIndex);
      else next.add(dataRowIndex);
      return next;
    });
  }, []);

  const handleSaveAccountBalance = async () => {
    if (!rows) return;
    setSaveLoading(true);
    setSaveMessage(null);
    try {
      const accounts = loadRecognisedAccountsFromStorage();
      const kept = rows.filter((_, i) => !rowsToDelete.has(i));
      const accountCols = headers.filter((h) => h !== 'date');
      const fromDrafts: BalanceRow[] = [];
      for (const draft of newRowDrafts) {
        const hasContent = Object.values(draft).some((v) => (v ?? '').trim() !== '');
        if (!hasContent) continue;
        const dateRaw = (draft['date'] ?? '').trim();
        const d = AccountBalanceCSVService.parseBalanceDateInput(dateRaw);
        if (!d) continue;
        const balances: Record<string, number> = {};
        for (const code of accountCols) {
          const raw = draft[code] ?? '';
          const n = AccountBalanceCSVService.parseBalanceAmount(raw);
          if (raw.trim() !== '' && Math.abs(n) >= 1e-9) balances[code] = n;
        }
        fromDrafts.push({ date: startOfDay(d), balances });
      }
      const merged = [...kept, ...fromDrafts].sort((a, b) => a.date.getTime() - b.date.getTime());
      const result = await AccountBalanceCSVService.saveBalanceRowsToProcessed(merged, accounts);
      if (result.success) {
        setRows(merged);
        setRowsToDelete(new Set());
        setCellDrafts({});
        setNewRowDrafts([{}]);
        editSessionBaselineRef.current = takeAccountBalanceEditSnapshot(merged, new Set(), {}, [{}]);
        setEditShowAnomaliesOnly(false);
        setAnomalyFilterStickyIndices(new Set());
        setEditExitConfirmOpen(false);
        setSaveMessage(t('accountBalance.edit.saved'));
      } else {
        setSaveMessage(result.error ?? "Erreur lors de l'enregistrement.");
      }
    } finally {
      setSaveLoading(false);
    }
  };

  const applyBlurValue = useCallback(
    (dataRowIndex: number, col: string, raw: string) => {
      setRows((prev) => {
        if (!prev) return prev;
        const row = prev[dataRowIndex];
        if (!row) return prev;
        if (col === 'date') {
          const d = AccountBalanceCSVService.parseBalanceDateInput(raw);
          if (!d) return prev;
          const next = [...prev];
          next[dataRowIndex] = { ...row, date: startOfDay(d) };
          return next;
        }
        const n = AccountBalanceCSVService.parseBalanceAmount(raw);
        const nextB = { ...row.balances };
        if (raw.trim() === '' || Math.abs(n) < 1e-9) delete nextB[col];
        else nextB[col] = n;
        const next = [...prev];
        next[dataRowIndex] = { ...row, balances: nextB };
        return next;
      });
    },
    []
  );

  const handleImportCsvFile = async () => {
    const api = (
      window as unknown as {
        electronAPI?: {
          selectFile: (opts?: {
            filters?: { name: string; extensions: string[] }[];
            allowMultiple?: boolean;
          }) => Promise<{
            success: boolean;
            path?: string;
            paths?: string[];
            canceled?: boolean;
            error?: string;
          }>;
          readExternalFile: (path: string) => Promise<{ success: boolean; data?: string; error?: string }>;
          writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
        };
      }
    ).electronAPI;
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
        const destPath = accountBalanceImportFile(fileName);
        const writeResult = await api.writeFile(destPath, readResult.data);
        if (!writeResult.success) {
          setImportFileMessage(writeResult.error ?? 'Erreur lors de la copie.');
          return;
        }
        copied.push(fileName);
      }
      setImportFileMessage(
        copied.length === 1
          ? t('accountBalance.importWizard.fileCopied', { name: copied[0] })
          : t('accountBalance.importWizard.filesCopied', { count: copied.length, names: copied.join(', ') })
      );
      bumpImportFolderReload();
    } finally {
      setImportFileLoading(false);
    }
  };

  const handleOpenAccountBalanceImportFolder = async () => {
    const api = (
      window as unknown as {
        electronAPI?: { openAccountBalanceImportFolder: () => Promise<{ success: boolean; error?: string }> };
      }
    ).electronAPI;
    if (!api?.openAccountBalanceImportFolder) return;
    const result = await api.openAccountBalanceImportFolder();
    if (!result.success && result.error) {
      abPrepWizard.setImportWizardMessage(result.error);
    }
  };

  const bumpImportFolderReload = useCallback(() => {
    setImportFolderReloadToken((k) => k + 1);
  }, []);

  const handleConfirmEmptyAbImport = async () => {
    setEmptyAbImportConfirmOpen(false);
    const api = (
      window as unknown as {
        electronAPI?: {
          trashAccountBalanceImportFiles: () => Promise<{
            success: boolean;
            error?: string;
            movedCount?: number;
            message?: string;
          }>;
        };
      }
    ).electronAPI;
    if (!api?.trashAccountBalanceImportFiles) return;
    setArchiveMessage(null);
    setArchiveLoading(true);
    try {
      const result = await api.trashAccountBalanceImportFiles();
      if (result.success) {
        setArchiveMessage(
          result.message ??
            (result.movedCount
              ? t('accountBalance.importWizard.filesMoved', { count: result.movedCount })
              : 'Aucun fichier dans le dossier Import.')
        );
        bumpImportFolderReload();
      } else {
        setArchiveMessage(result.error ?? 'Impossible de vider le dossier.');
      }
    } finally {
      setArchiveLoading(false);
    }
  };

  const handleDetectAccountBalanceAnomalies = async () => {
    setAnomalyLoading(true);
    try {
      const result = await refreshSlimAnomalies(true);
      if (!result) {
        setAnomalyMessage(t('accountBalance.anomaly.unavailable'));
        return;
      }
      const now = new Date().toISOString();
      setAnomalyLastReportAt(now);
      try {
        localStorage.setItem(AB_ANOMALY_LAST_REPORT_KEY, now);
      } catch {}
      const fileLevel = result.fileLevelReasons?.length ?? 0;
      const rowCount = (result.anomalies ?? []).filter((a) => a.rowIndex > 0).length;
      const total = fileLevel + rowCount;
      setAnomalyMessage(
        total === 0
          ? t('accountBalance.anomaly.noneFound')
          : t('accountBalance.anomaly.found', { count: total })
      );
    } finally {
      setAnomalyLoading(false);
    }
  };

  const handleOpenAccountBalanceAnomalyReport = async () => {
    const api = (
      window as unknown as {
        electronAPI?: { openAccountBalanceAnomalyReport: () => Promise<{ success: boolean; error?: string }> };
      }
    ).electronAPI;
    if (!api?.openAccountBalanceAnomalyReport) return;
    const result = await api.openAccountBalanceAnomalyReport();
    if (!result.success && result.error) {
      setAnomalyMessageState(result.error);
    }
  };

  const columnLabel = (col: string) =>
    col === 'date' ? 'Date' : getDisplayNameForAccountCode(col, accountNamesInOrder);

  const toggleImportModuleExpanded = useCallback(() => {
    setImportModuleExpanded((v) => {
      const next = !v;
      try {
        localStorage.setItem(AB_IMPORT_MODULE_EXPANDED_KEY, String(next));
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
        localStorage.setItem(AB_ANOMALY_MODULE_EXPANDED_KEY, String(next));
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
          <h1 className="text-2xl font-bold text-gray-800">{t('accountBalance.title')}</h1>

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
              aria-controls="account-balance-import-module"
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
                  <h2 className="text-lg font-semibold text-gray-800">{t('accountBalance.importWizard.title')}</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {importModuleExpanded
                      ? t('accountBalance.importWizard.closeModule')
                      : t('accountBalance.importWizard.openModule')}
                  </p>
                </div>
              </div>
            </div>
            {importModuleExpanded && (
              <div id="account-balance-import-module" className="mt-3">
                <div
                  className="rounded-lg border border-gray-200 bg-gray-50/50 p-4"
                  aria-label={t('accountBalance.importWizard.zoneLabel')}
                >
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">{t('accountBalance.importWizard.prepTitle')}</h3>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={handleImportCsvFile}
                          disabled={importFileLoading}
                          className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {importFileLoading ? t('accountBalance.importWizard.importing') : t('accountBalance.importWizard.importFiles')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleOpenAccountBalanceImportFolder()}
                          className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          {t('accountBalance.importWizard.openImportFolder')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEmptyAbImportConfirmOpen(true)}
                          disabled={archiveLoading}
                          className="rounded border border-red-600 bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {archiveLoading ? t('accountBalance.importWizard.emptying') : t('accountBalance.importWizard.emptyImport')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void abPrepWizard.handleImportLinesToSource()}
                          disabled={
                            abPrepWizard.importLinesLoading ||
                            abPrepWizard.abImportWizardLoading ||
                            !abPrepWizard.mappingWizardActive ||
                            abPrepWizard.importPreviewImportableRows.length === 0
                          }
                          title={
                            !abPrepWizard.mappingWizardActive
                              ? t('accountBalance.importWizard.needMapping')
                              : abPrepWizard.importPreviewImportableRows.length === 0
                                ? t('accountBalance.importWizard.noImportableRows')
                                : undefined
                          }
                          className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {abPrepWizard.importLinesLoading ? t('accountBalance.importWizard.importLinesShort') : t('accountBalance.importWizard.importLines')}
                        </button>
                        {abPrepWizard.mappingWizardActive && (
                          <label
                            className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none"
                            title={t('accountBalance.importWizard.removeImportedTitle')}
                          >
                            <input
                              type="checkbox"
                              className="shrink-0"
                              checked={abPrepWizard.removeImportedFromImportFolder}
                              onChange={(e) =>
                                abPrepWizard.setRemoveImportedFromImportFolder(e.target.checked)
                              }
                              disabled={abPrepWizard.importLinesLoading}
                            />
                            {t('accountBalance.importWizard.removeImported')}
                          </label>
                        )}
                      </div>
                    </div>

                    <hr className="border-gray-200" />

                    <AccountBalanceImportPrepSection {...abPrepWizard} />

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
              aria-controls="account-balance-anomaly-module"
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
              <div id="account-balance-anomaly-module" className="mt-3">
                <div
                  className="rounded-lg border border-gray-200 bg-gray-50/50 p-4"
                  aria-label={t('transactions.anomaly.zoneLabel')}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDetectAccountBalanceAnomalies()}
                        disabled={anomalyLoading || !rows}
                        className="rounded border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                      >
                        {anomalyLoading ? t('transactions.anomaly.analyzing') : t('transactions.anomaly.detect')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleOpenAccountBalanceAnomalyReport()}
                        className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        {t('transactions.anomaly.openReport')}
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
                          onClick={() => void handleSaveAccountBalance()}
                          disabled={saveLoading || !rows}
                          className="rounded border border-green-600 bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {saveLoading ? t('common.saving') : t('accountBalance.edit.save')}
                        </button>
                      )}
                    </div>
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
                                ? t('accountBalance.anomaly.lastReport', parts)
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

        {rows && !loading && (
          <div className="flex-1 min-h-0 flex flex-col bg-white rounded-lg shadow border border-gray-200 overflow-hidden h-[calc(100vh-6rem)] min-h-[320px]">
            <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <label htmlFor="ab-filter-col" className="text-gray-600 text-sm whitespace-nowrap">
                  {t('transactions.filters.column')}
                </label>
                <select
                  id="ab-filter-col"
                  value={filterColumn}
                  onChange={(e) => setFilterColumn(e.target.value)}
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[120px]"
                >
                  <option value="__all__">{t('transactions.filters.allColumns')}</option>
                  {editMode && (
                    <option value={ANOMALY_FILTER_COLUMN_KEY}>{t('transactions.anomaly.column')}</option>
                  )}
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {columnLabel(h)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <label htmlFor="ab-filter-text" className="text-gray-600 text-sm whitespace-nowrap sr-only">
                  {t('transactions.filters.search')}
                </label>
                <input
                  id="ab-filter-text"
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
                {t('transactions.filters.rowCount', { filtered: filteredRows.length, total: rows.length })}
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
            <div className="overflow-auto flex-1 min-h-0">
              <table
                className="w-full border-collapse text-sm"
                style={editMode ? { tableLayout: 'fixed', minWidth: '100%' } : undefined}
              >
                {editMode && (
                  <colgroup>
                    <col style={{ width: getColWidth(ANOMALY_SORT_COLUMN_KEY) }} />
                    {headers.map((h) => (
                      <col key={h} style={{ width: getColWidth(h) }} />
                    ))}
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
                    {headers.map((h) =>
                      editMode ? (
                        <ResizableTableHeadCell
                          key={h}
                          columnKey={h}
                          width={getColWidth(h)}
                          enabled={editMode}
                          onResizeStart={handleColResizeStart}
                          className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap select-none transition-colors overflow-hidden"
                        >
                          <span className="inline-flex items-center gap-1">{columnLabel(h)}</span>
                        </ResizableTableHeadCell>
                      ) : (
                        <th
                          key={h}
                          onClick={() => handleSort(h)}
                          className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:bg-gray-200 transition-colors"
                        >
                          <span className="inline-flex items-center gap-1">
                            {columnLabel(h)}
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
                  {displayRows.map((row, i) => {
                    const dataRowIndex = rows.findIndex((r) => r === row);
                    const markedForDelete = dataRowIndex >= 0 && rowsToDelete.has(dataRowIndex);
                    const anomalyText =
                      dataRowIndex >= 0 ? accountBalanceAnomalyByDataRowIndex.get(dataRowIndex) ?? '' : '';
                    return (
                      <tr
                        key={`${dataRowIndex}-${row.date.getTime()}-${i}`}
                        className={`border-b border-gray-100 ${
                          editMode && markedForDelete ? 'bg-red-100/70 hover:bg-red-100/70' : 'hover:bg-gray-50'
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
                        {headers.map((col) => (
                          <td key={col} className="px-3 py-2 text-gray-800 whitespace-nowrap align-middle overflow-hidden">
                            {editMode && dataRowIndex >= 0 ? (
                              <input
                                type="text"
                                value={
                                  cellDrafts[draftKey(dataRowIndex, col)] ?? canonicalCellString(row, col)
                                }
                                onChange={(e) =>
                                  setCellDrafts((prev) => ({
                                    ...prev,
                                    [draftKey(dataRowIndex, col)]: e.target.value,
                                  }))
                                }
                                onBlur={(e) => {
                                  const k = draftKey(dataRowIndex, col);
                                  setCellDrafts((prev) => {
                                    if (!(k in prev)) return prev;
                                    const next = { ...prev };
                                    delete next[k];
                                    return next;
                                  });
                                  applyBlurValue(dataRowIndex, col, e.target.value);
                                }}
                                className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                                aria-label={col === 'date' ? 'Date' : columnLabel(col)}
                              />
                            ) : (
                              getCellDisplay(row, col)
                            )}
                          </td>
                        ))}
                        {editMode && dataRowIndex >= 0 && (
                          <td className="px-3 py-2 whitespace-nowrap bg-gray-50 align-middle">
                            <button
                              type="button"
                              onClick={() => handleToggleRowDelete(dataRowIndex)}
                              className="rounded border border-red-600 bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                            >
                              {markedForDelete ? t('transactions.table.undoDelete') : t('transactions.table.deleteRow')}
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {editMode &&
                    newRowDrafts.map((draft, draftIndex) => (
                      <tr
                        key={`new-draft-${draftIndex}`}
                        className="border-b border-gray-100 bg-gray-50/80 hover:bg-gray-50"
                      >
                        <td className="px-3 py-2 align-middle bg-amber-50/40 text-xs text-gray-400">—</td>
                        {headers.map((col) => (
                          <td key={col} className="px-1 py-0.5 align-middle overflow-hidden">
                            <input
                              type="text"
                              value={draft[col] ?? ''}
                              onChange={(e) => handleNewRowDraftChange(draftIndex, col, e.target.value)}
                              placeholder={t('accountBalance.newRow.placeholder')}
                              className="w-full rounded border border-dashed border-gray-400 px-2 py-1 text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              aria-label={col === 'date' ? t('accountBalance.newRow.ariaDate') : t('accountBalance.newRow.ariaCol', { column: columnLabel(col) })}
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 whitespace-nowrap bg-gray-50 align-middle">
                          {draftIndex === newRowDrafts.length - 1 ? (
                            <button
                              type="button"
                              onClick={handleAddNewDraftRow}
                              className="rounded border border-blue-600 bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                              title={t('accountBalance.newRow.addTitle')}
                            >
                              {t('accountBalance.newRow.add')}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 px-3 py-2 border-t border-gray-200 bg-gray-50 text-gray-500 text-xs">
              {t('transactions.table.footerRows', { count: displayRows.length })}
              {editMode && editShowAnomaliesOnly
                ? t('transactions.table.footerAnomaliesOnly', { sorted: sortedRows.length })
                : filterText
                  ? t('transactions.table.footerFiltered', { total: rows.length })
                  : ''}
              {editMode && newRowDrafts.length > 0 && (
                <span className="ml-1">
                  {t('accountBalance.newRow.draftCount', { count: newRowDrafts.length })}
                </span>
              )}
            </div>
          </div>
        )}
      </main>
      {emptyAbImportConfirmOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-balance-empty-import-title"
          onClick={() => setEmptyAbImportConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="account-balance-empty-import-title" className="text-lg font-semibold text-gray-900">
              {t('accountBalance.importWizard.emptyConfirmTitle')}
            </h2>
            <p className="text-sm text-gray-600">
              {t('accountBalance.importWizard.emptyConfirmBody')}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEmptyAbImportConfirmOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('transactions.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmEmptyAbImport()}
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
          aria-labelledby="account-balance-edit-exit-title"
          onClick={() => setEditExitConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="account-balance-edit-exit-title" className="text-lg font-semibold text-gray-900">
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
    </>
  );
};

export default AccountBalanceTable;
