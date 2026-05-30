import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { format, startOfDay } from 'date-fns';
import {
  ACCOUNT_BALANCE_PROCESSED_DIR,
  accountBalanceImportFile,
  ACCOUNT_BALANCE_ANOMALY_REPORT_PATH,
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

const AB_ANOMALY_STATUS_KEY = 'account-balance-anomaly-status';
const AB_ANOMALY_LAST_REPORT_KEY = 'account-balance-anomaly-last-report';

/** Clé de tri pour la colonne Anomalie (mode édition). */
const ANOMALY_SORT_COLUMN_KEY = '__anomaly__';
/** Clé du filtre « rechercher dans la colonne Anomalie » (barre de recherche, mode édition). */
const ANOMALY_FILTER_COLUMN_KEY = '__anomaly_filter__';

/** Persistance replier/déplier des blocs Import wizard et détection d’anomalies. */
const AB_IMPORT_MODULE_EXPANDED_KEY = 'account-balance-import-module-expanded';
const AB_ANOMALY_MODULE_EXPANDED_KEY = 'account-balance-anomaly-module-expanded';

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

type UiMessageTone = 'success' | 'warning' | 'error' | 'info';

function getUiMessageTone(message: string): UiMessageTone {
  const m = message.toLowerCase();
  if (
    m.includes('erreur') ||
    m.includes('introuvable') ||
    m.includes('refus') ||
    m.includes('impossible')
  ) {
    return 'error';
  }
  if (
    m.includes('anomalie') ||
    m.includes('aucun fichier') ||
    m.includes('aucune ligne') ||
    m.includes('ignorée') ||
    m.includes('non fusionnée')
  ) {
    return 'warning';
  }
  if (
    m.includes('copié') ||
    m.includes('fusionnée') ||
    m.includes('intégrée') ||
    m.includes('remplacée') ||
    m.includes('mis à jour') ||
    m.includes('archivé') ||
    m.includes('corbeille') ||
    m.includes('déplacé')
  ) {
    return 'success';
  }
  return 'info';
}

function uiMessageClass(tone: UiMessageTone): string {
  if (tone === 'error') return 'border-red-200 bg-red-50 text-red-700';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (tone === 'success') return 'border-green-200 bg-green-50 text-green-700';
  return 'border-gray-200 bg-gray-50 text-gray-700';
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
        setError(err?.message ?? 'Erreur lors du chargement des données.');
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

  /** Anomalies par indice de ligne (0-based) — même logique que la détection sur fichier, appliquée aux données affichées. */
  const accountBalanceAnomalyByDataRowIndex = useMemo(() => {
    if (!rows?.length) return new Map<number, string>();
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
      map.set(a.rowIndex - 1, a.reasons.join(' ; '));
    }
    return map;
  }, [rows, tableAccountCodes, recognisedAccounts, fiatForCode]);

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
        setSaveMessage('src_account_balance.csv enregistré.');
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
          ? `Fichier copié dans Import : ${copied[0]}`
          : `${copied.length} fichiers copiés dans Import : ${copied.join(', ')}`
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
              ? `${result.movedCount} fichier(s) déplacé(s) vers la corbeille.`
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
    if (!rows) {
      setAnomalyMessageState("Chargez les données d'abord.");
      return;
    }
    const api = (
      window as unknown as {
        electronAPI?: { writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }> };
      }
    ).electronAPI;
    if (!api?.writeFile) {
      setAnomalyMessageState("Fonction d'écriture non disponible.");
      return;
    }
    setAnomalyLoading(true);
    try {
      const raw = await AccountBalanceCSVService.loadRawCsvRows();
      if (!raw) {
        setAnomalyMessageState('Chargez les données ou vérifiez src_account_balance.csv.');
        return;
      }
      const recognised = loadRecognisedAccountsFromStorage();
      const { fileLevelReasons, rowAnomalies, csvContent } = detectAccountBalanceAnomalies(
        raw.headers,
        raw.rows,
        recognised
      );
      const writeResult = await api.writeFile(ACCOUNT_BALANCE_ANOMALY_REPORT_PATH, csvContent);
      if (writeResult.success) {
        const now = new Date().toISOString();
        setAnomalyLastReportAt(now);
        try {
          localStorage.setItem(AB_ANOMALY_LAST_REPORT_KEY, now);
        } catch {}
        const total =
          fileLevelReasons.length +
          rowAnomalies.length;
        setAnomalyMessage(
          total === 0
            ? 'Aucune anomalie détectée. Rapport mis à jour dans Processed/account_balance_anomaly_report.csv.'
            : `${total} anomalie(s) → rapport écrit dans Processed/account_balance_anomaly_report.csv.`
        );
      } else {
        setAnomalyMessage(writeResult.error ?? "Erreur lors de l'écriture du rapport.");
      }
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
          <h1 className="text-2xl font-bold text-gray-800">Soldes des comptes</h1>

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
                  <h2 className="text-lg font-semibold text-gray-800">Import wizard</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {importModuleExpanded ? 'Fermer' : 'Ouvrir'} le module d&apos;importation de données
                  </p>
                </div>
              </div>
            </div>
            {importModuleExpanded && (
              <div id="account-balance-import-module" className="mt-3">
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
                          onClick={() => void handleOpenAccountBalanceImportFolder()}
                          className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Ouvrir le dossier d'importation
                        </button>
                        <button
                          type="button"
                          onClick={() => setEmptyAbImportConfirmOpen(true)}
                          disabled={archiveLoading}
                          className="rounded border border-red-600 bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {archiveLoading ? 'Vidage…' : 'Vider le dossier d\'import'}
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
                              ? 'Activez le mapping wizard pour préparer l’import vers src_account_balance.csv'
                              : abPrepWizard.importPreviewImportableRows.length === 0
                                ? 'Aucune ligne importable (dates déjà présentes, lignes ignorées ou données invalides)'
                                : undefined
                          }
                          className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {abPrepWizard.importLinesLoading ? 'Import…' : 'Importer les lignes'}
                        </button>
                        {abPrepWizard.mappingWizardActive && (
                          <label
                            className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none"
                            title="Après un import réussi, retire du dossier Import (soldes) les lignes qui viennent d’être ajoutées à src_account_balance.csv (les lignes collées depuis le presse-papiers ne sont pas concernées)."
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
                            Retirer du dossier Import les lignes importées
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
                    Détection d&apos;anomalies et mode édition
                  </h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {anomalyModuleExpanded ? 'Fermer' : 'Ouvrir'} le module d&apos;édition des données existantes
                  </p>
                </div>
              </div>
            </div>
            {anomalyModuleExpanded && (
              <div id="account-balance-anomaly-module" className="mt-3">
                <div
                  className="rounded-lg border border-gray-200 bg-gray-50/50 p-4"
                  aria-label="Zone détection d’anomalies"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleDetectAccountBalanceAnomalies()}
                        disabled={anomalyLoading || !rows}
                        className="rounded border border-orange-600 bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
                      >
                        {anomalyLoading ? 'Analyse…' : 'Détecter des anomalies'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleOpenAccountBalanceAnomalyReport()}
                        className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                      >
                        Ouvrir le rapport d'anomalies
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
                          onClick={() => void handleSaveAccountBalance()}
                          disabled={saveLoading || !rows}
                          className="rounded border border-green-600 bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          {saveLoading ? 'Enregistrement…' : 'Sauvegarder src_account_balance.csv'}
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
                            {formatReportDate(anomalyLastReportAt, "Dernier rapport d'anomalies généré")}
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

        {rows && !loading && (
          <div className="flex-1 min-h-0 flex flex-col bg-white rounded-lg shadow border border-gray-200 overflow-hidden h-[calc(100vh-6rem)] min-h-[320px]">
            <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <label htmlFor="ab-filter-col" className="text-gray-600 text-sm whitespace-nowrap">
                  Colonne
                </label>
                <select
                  id="ab-filter-col"
                  value={filterColumn}
                  onChange={(e) => setFilterColumn(e.target.value)}
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[120px]"
                >
                  <option value="__all__">Toutes</option>
                  {editMode && (
                    <option value={ANOMALY_FILTER_COLUMN_KEY}>Anomalie</option>
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
                  Rechercher
                </label>
                <input
                  id="ab-filter-text"
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
                {filteredRows.length} / {rows.length} ligne{rows.length !== 1 ? 's' : ''}
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
            </div>
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-gray-100 border-b border-gray-200 z-10">
                  <tr>
                    {editMode && (
                      <th
                        onClick={() => handleSort(ANOMALY_SORT_COLUMN_KEY)}
                        className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap bg-amber-50/80 min-w-[10rem] max-w-md align-bottom cursor-pointer select-none hover:bg-amber-100/80 transition-colors"
                      >
                        <span className="inline-flex items-center gap-1">
                          Anomalie
                          {sortColumn === ANOMALY_SORT_COLUMN_KEY && (
                            <span className="text-blue-600" aria-label={sortDirection === 'asc' ? 'Croissant' : 'Décroissant'}>
                              {sortDirection === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </span>
                      </th>
                    )}
                    {headers.map((h) => (
                      <th
                        key={h}
                        onClick={() => !editMode && handleSort(h)}
                        className={`text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap select-none transition-colors ${
                          editMode ? '' : 'cursor-pointer hover:bg-gray-200'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {columnLabel(h)}
                          {!editMode && sortColumn === h && (
                            <span className="text-blue-600" aria-label={sortDirection === 'asc' ? 'Croissant' : 'Décroissant'}>
                              {sortDirection === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </span>
                      </th>
                    ))}
                    {editMode && (
                      <th className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap bg-gray-100 w-[1%]">
                        Supprimer
                      </th>
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
                            className="px-3 py-2 align-top bg-amber-50/40 text-xs text-amber-900 max-w-md break-words whitespace-pre-wrap"
                            title={anomalyText || undefined}
                          >
                            {anomalyText || '—'}
                          </td>
                        )}
                        {headers.map((col) => (
                          <td key={col} className="px-3 py-2 text-gray-800 whitespace-nowrap align-middle">
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
                                className="w-full min-w-[4rem] rounded border border-gray-300 px-2 py-1 text-sm text-gray-800 focus:ring-2 focus:ring-red-500 focus:border-red-500"
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
                              {markedForDelete ? 'Annuler suppression' : 'Supprimer la ligne'}
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
                          <td key={col} className="px-1 py-0.5 align-middle">
                            <input
                              type="text"
                              value={draft[col] ?? ''}
                              onChange={(e) => handleNewRowDraftChange(draftIndex, col, e.target.value)}
                              placeholder="Nouvelle ligne…"
                              className="w-full min-w-[4rem] rounded border border-dashed border-gray-400 px-2 py-1 text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              aria-label={col === 'date' ? 'Nouvelle ligne — date' : `Nouvelle ligne — ${columnLabel(col)}`}
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 whitespace-nowrap bg-gray-50 align-middle">
                          {draftIndex === newRowDrafts.length - 1 ? (
                            <button
                              type="button"
                              onClick={handleAddNewDraftRow}
                              className="rounded border border-blue-600 bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                              title="Ajouter une nouvelle ligne vide en dessous"
                            >
                              Ajouter Nouvelle ligne
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 px-3 py-2 border-t border-gray-200 bg-gray-50 text-gray-500 text-xs">
              {displayRows.length} ligne{displayRows.length !== 1 ? 's' : ''}
              {editMode && editShowAnomaliesOnly
                ? ` (anomalies uniquement, ${sortedRows.length} après tri/filtre)`
                : filterText
                  ? ` (filtré sur ${rows.length} au total)`
                  : ''}
              {editMode && newRowDrafts.length > 0 && (
                <span className="ml-1">
                  — {newRowDrafts.length} ligne{newRowDrafts.length !== 1 ? 's' : ''} de saisie en bas du tableau
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
              Vider le dossier d&apos;import ?
            </h2>
            <p className="text-sm text-gray-600">
              Tous les fichiers du dossier Import (soldes des comptes) seront déplacés vers la corbeille du système. Vous pourrez les restaurer depuis la corbeille si besoin.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEmptyAbImportConfirmOpen(false)}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmEmptyAbImport()}
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
          aria-labelledby="account-balance-edit-exit-title"
          onClick={() => setEditExitConfirmOpen(false)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="account-balance-edit-exit-title" className="text-lg font-semibold text-gray-900">
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
    </>
  );
};

export default AccountBalanceTable;
