/// <reference path="../vite-env.d.ts" />
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Sidebar from '../components/Layout/Sidebar';
import { SourceDataCSVService, type SourceDataResult, SOURCE_DATA_PATH } from '../services/SourceDataCSVService';
import { detectAnomalies, EXCLUDE_ANOMALY_COLUMN } from '../services/AnomalyDetectionService';
import { canonicalAccountFromSource, accountLabelFromSource } from '../constants/accountSourceLabels';
import { formatDateDDMMYYYY, formatEur, formatFx, formatGbp, formatAmountGbpForCsv } from '../utils/format';
import { amountToGbp } from '../services/EffectiveExchangeRates';
import Papa from 'papaparse';

const STORAGE_KEY = 'transactions-sidebar-collapsed';
const MERGE_STATUS_STORAGE_KEY = 'transactions-merge-status';
const MERGE_LAST_REPORT_STORAGE_KEY = 'transactions-merge-last-report';
const ANOMALY_STATUS_STORAGE_KEY = 'transactions-anomaly-status';
const ANOMALY_LAST_REPORT_STORAGE_KEY = 'transactions-anomaly-last-report';

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

/** Tri canonique : Date (ancienne → récente), puis Account, Type, Title (alphabétique). Réattribue Index 1, 2, 3, ... */
function normalizeOrderAndIndex(source: SourceDataResult): SourceDataResult {
  const headers = source.headers;
  const dateCol = headers.find((h) => /date/i.test(h)) ?? null;
  const accountCol = headers.find((h) => /^account$/i.test(h) || /compte/i.test(h)) ?? null;
  const typeCol = headers.find((h) => /^type$/i.test(h)) ?? null;
  const titleCol = headers.find((h) => /^title$/i.test(h)) ?? null;
  const indexCol = headers.find((h) => /^index$/i.test(h)) ?? 'Index';

  const sorted = [...source.rows].sort((a, b) => {
    const dA = dateCol ? parseDateFromCell(a[dateCol] ?? '') : null;
    const dB = dateCol ? parseDateFromCell(b[dateCol] ?? '') : null;
    const tA = dA ? dA.getTime() : Infinity;
    const tB = dB ? dB.getTime() : Infinity;
    if (tA !== tB) return tA - tB;
    const accA = (accountCol ? (a[accountCol] ?? '') : '').trim().toLowerCase();
    const accB = (accountCol ? (b[accountCol] ?? '') : '').trim().toLowerCase();
    const cmpAcc = accA.localeCompare(accB, undefined, { sensitivity: 'base' });
    if (cmpAcc !== 0) return cmpAcc;
    const typeA = (typeCol ? (a[typeCol] ?? '') : '').trim().toLowerCase();
    const typeB = (typeCol ? (b[typeCol] ?? '') : '').trim().toLowerCase();
    const cmpType = typeA.localeCompare(typeB, undefined, { sensitivity: 'base' });
    if (cmpType !== 0) return cmpType;
    const titleA = (titleCol ? (a[titleCol] ?? '') : '').trim().toLowerCase();
    const titleB = (titleCol ? (b[titleCol] ?? '') : '').trim().toLowerCase();
    return titleA.localeCompare(titleB, undefined, { sensitivity: 'base' });
  });

  // Première ligne de donnée = index 1 (pas de header dans source.rows)
  const firstDataRowIndex = 1;
  const rows = sorted.map((row, i) => ({ ...row, [indexCol]: String(firstDataRowIndex + i) }));
  return { ...source, rows };
}

const TransactionsTable: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [data, setData] = useState<SourceDataResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [filterColumn, setFilterColumn] = useState<string>('__all__');
  const [sortColumn, setSortColumn] = useState<string | null>('Index');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [mergeStatus, setMergeStatusState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(MERGE_STATUS_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const [mergeLastReportAt, setMergeLastReportAt] = useState<string | null>(() => {
    try {
      return localStorage.getItem(MERGE_LAST_REPORT_STORAGE_KEY);
    } catch {
      return null;
    }
  });
  const setMergeStatus = useCallback((msg: string | null) => {
    setMergeStatusState(msg);
    try {
      if (msg != null) localStorage.setItem(MERGE_STATUS_STORAGE_KEY, msg);
      else localStorage.removeItem(MERGE_STATUS_STORAGE_KEY);
    } catch {}
  }, []);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [importFileLoading, setImportFileLoading] = useState(false);
  const [importFileMessage, setImportFileMessage] = useState<string | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveMessage, setArchiveMessage] = useState<string | null>(null);
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
  /** Indices des lignes (dans data.rows) marquées pour suppression à la sauvegarde. */
  const [rowsToDelete, setRowsToDelete] = useState<Set<number>>(() => new Set());
  /** Indices des lignes exclues de la détection d'anomalies (persistées au sauvegarder). */
  const [rowsExcludedFromAnomaly, setRowsExcludedFromAnomaly] = useState<Set<number>>(() => new Set());

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    SourceDataCSVService.load()
      .then((result) => {
        setData(result);
        if (!result) {
          setError('Fichier data/TransactionsData/Processed/source_data.csv absent ou vide.');
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

  /** Synchronise rowsExcludedFromAnomaly avec la colonne Exclure_anomalie au chargement. */
  useEffect(() => {
    if (!data?.rows) {
      setRowsExcludedFromAnomaly(new Set());
      return;
    }
    const excluded = new Set<number>();
    data.rows.forEach((row, i) => {
      const v = (row[EXCLUDE_ANOMALY_COLUMN] ?? '').trim().toLowerCase();
      if (v === '1' || v === 'oui' || v === 'true' || v === 'yes') excluded.add(i);
    });
    setRowsExcludedFromAnomaly(excluded);
  }, [data?.rows]);

  const dateColumn = useMemo(() => {
    return data?.headers.find((h) => /date/i.test(h)) ?? null;
  }, [data?.headers]);

  /** En-têtes affichés dans le tableau (sans la colonne technique Exclure_anomalie). */
  const displayHeaders = useMemo(
    () => (data?.headers ?? []).filter((h) => h !== EXCLUDE_ANOMALY_COLUMN),
    [data?.headers]
  );

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

  const handleToggleSidebar = () => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const filteredRows =
    data?.rows.filter((row) => {
      const q = filterText.trim().toLowerCase();
      if (q) {
        const cols = filterColumn === '__all__' ? (data?.headers ?? []).filter((h) => h !== EXCLUDE_ANOMALY_COLUMN) : [filterColumn];
        if (!cols.some((h) => (row[h] ?? '').toLowerCase().includes(q))) return false;
      }
      if (dateColumn && minDate != null && maxDate != null) {
        const cellDate = parseDateFromCell(row[dateColumn] ?? '');
        if (!cellDate) return false;
        const t = cellDate.getTime();
        if (t < minDate.getTime() || t > maxDate.getTime()) return false;
      }
      return true;
    }) ?? [];

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

  const sortedRows = (() => {
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
  })();

  const handleSort = (header: string) => {
    if (sortColumn === header) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(header);
      setSortDirection('asc');
    }
  };

  const handleMergeImports = async () => {
    const api = (window as unknown as { electronAPI?: { mergeImportTransactions: () => Promise<{ success: boolean; error?: string; mergedCount: number; anomalyCount: number; reportPath?: string }>; openImportReport: () => Promise<{ success: boolean; error?: string }>; writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }> } }).electronAPI;
    if (!api?.mergeImportTransactions) return;
    setMergeLoading(true);
    try {
      const result = await api.mergeImportTransactions();
      if (result.success) {
        loadData();
        const now = new Date().toISOString();
        setMergeLastReportAt(now);
        try {
          localStorage.setItem(MERGE_LAST_REPORT_STORAGE_KEY, now);
        } catch {}
        if (result.mergedCount > 0 || result.anomalyCount > 0) {
          setMergeStatus(
            `${result.mergedCount} ligne(s) fusionnée(s). ${result.anomalyCount > 0 ? `${result.anomalyCount} anomalie(s) → ` : ''}Rapport dans Processed/merge_report.csv.`
          );
        } else {
          setMergeStatus('Aucun fichier CSV dans le dossier Import.');
        }
      } else {
        setMergeStatus(result.error ?? 'Erreur lors de la fusion.');
      }
    } finally {
      setMergeLoading(false);
    }
  };

  const handleOpenImportFolder = async () => {
    const api = (window as unknown as { electronAPI?: { openImportFolder: () => Promise<{ success: boolean; error?: string }> } }).electronAPI;
    if (!api?.openImportFolder) return;
    const result = await api.openImportFolder();
    if (!result.success && result.error) {
      setMergeStatusState(result.error);
    }
  };

  const handleOpenMergeReport = async () => {
    const api = (window as unknown as { electronAPI?: { openImportReport: () => Promise<{ success: boolean; error?: string }> } }).electronAPI;
    if (!api?.openImportReport) return;
    const result = await api.openImportReport();
    if (!result.success && result.error) {
      setMergeStatusState(result.error);
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

  const handleArchiveImportFolder = async () => {
    const api = (window as unknown as {
      electronAPI?: { archiveImportFolder: () => Promise<{ success: boolean; error?: string; movedCount?: number; message?: string }> };
    }).electronAPI;
    if (!api?.archiveImportFolder) return;
    setArchiveMessage(null);
    setArchiveLoading(true);
    try {
      const result = await api.archiveImportFolder();
      if (result.success) {
        setArchiveMessage(result.message ?? (result.movedCount ? `${result.movedCount} fichier(s) archivé(s).` : 'Aucun fichier à archiver.'));
      } else {
        setArchiveMessage(result.error ?? 'Erreur lors de l\'archivage.');
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
      const reportPath = 'data/TransactionsData/Processed/anomaly_report.csv';
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
        selectFile: (opts?: { filters?: { name: string; extensions: string[] }[] }) => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
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
      });
      if (selectResult.canceled || !selectResult.path) {
        setImportFileMessage(null);
        return;
      }
      const sourcePath = selectResult.path;
      const readResult = await api.readExternalFile(sourcePath);
      if (!readResult.success || readResult.data === undefined) {
        setImportFileMessage(readResult.error ?? 'Impossible de lire le fichier.');
        return;
      }
      const fileName = sourcePath.replace(/^.*[/\\]/, '');
      const destPath = `data/TransactionsData/Import/${fileName}`;
      const writeResult = await api.writeFile(destPath, readResult.data);
      if (writeResult.success) {
        setImportFileMessage(`Fichier copié dans Import : ${fileName}`);
      } else {
        setImportFileMessage(writeResult.error ?? 'Erreur lors de la copie.');
      }
    } finally {
      setImportFileLoading(false);
    }
  };

  const handleToggleEditMode = () => {
    setEditMode((prev) => !prev);
    setSaveMessage(null);
    if (editMode) setRowsToDelete(new Set());
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
      const normalized = normalizeOrderAndIndex({
        headers: withIndexHeader,
        rows: rowsToKeep,
      });
      const csvContent = Papa.unparse(normalized.rows, {
        columns: normalized.headers,
        delimiter: ';',
      });
      const result = await api.writeFile(SOURCE_DATA_PATH, csvContent);
      if (result.success) {
        setData(normalized);
        setRowsToDelete(new Set());
        setSaveMessage('Fichier source_data.csv enregistré.');
      } else {
        setSaveMessage(result.error ?? 'Erreur lors de l\'enregistrement.');
      }
    } finally {
      setSaveLoading(false);
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
    setRowsExcludedFromAnomaly((prev) => {
      const next = new Set(prev);
      if (next.has(dataRowIndex)) next.delete(dataRowIndex);
      else next.add(dataRowIndex);
      return next;
    });
  }, []);

  return (
    <div className="min-h-screen flex bg-gray-50">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={handleToggleSidebar}
      />
      <main className="flex-1 flex flex-col min-w-0 p-4">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-800">Tableau des transactions</h1>
          <div className="mt-2 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Importation de données</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleImportCsvFile}
                  disabled={importFileLoading}
                  className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {importFileLoading ? 'Import en cours…' : 'Importer des nouvelles lignes'}
                </button>
                <button
                  type="button"
                  onClick={handleOpenImportFolder}
                  className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Ouvrir le dossier d'importation
                </button>
                <button
                  type="button"
                  onClick={handleArchiveImportFolder}
                  disabled={archiveLoading}
                  className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {archiveLoading ? 'Archivage…' : 'Archiver les données importées'}
                </button>
              </div>
            </div>

            <hr className="border-gray-200" />

            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Fusion des données importées</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleMergeImports}
                  disabled={mergeLoading}
                  className="rounded border border-blue-600 bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {mergeLoading ? 'Fusion en cours…' : 'Fusionner les imports'}
                </button>
                <button
                  type="button"
                  onClick={handleOpenMergeReport}
                  className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Ouvrir le rapport de fusion
                </button>
              </div>
              {(mergeStatus || mergeLastReportAt) && (
                <div className="mt-2 space-y-0.5">
                  {mergeStatus && (
                    <p className="text-sm text-gray-600">{mergeStatus}</p>
                  )}
                  {mergeLastReportAt && (
                    <p className="text-sm text-gray-500">{formatReportDate(mergeLastReportAt, 'Dernier rapport généré')}</p>
                  )}
                </div>
              )}
            </div>

            <hr className="border-gray-200" />

            <div>
              <h2 className="text-sm font-semibold text-gray-700 mb-2">Détection d'anomalies</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDetectAnomalies}
                  disabled={anomalyLoading || !data}
                  className="rounded border border-amber-600 bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {anomalyLoading ? 'Analyse…' : 'Detecter des anomalies'}
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
                    {saveLoading ? 'Enregistrement…' : 'Sauvegarder source_data.csv'}
                  </button>
                )}
              </div>
              {editMode && saveMessage && (
                <p className="mt-2 text-sm text-gray-600">{saveMessage}</p>
              )}
              {(anomalyMessage || anomalyLastReportAt) && (
                <div className="mt-2 space-y-0.5">
                  {anomalyMessage && (
                    <p className="text-sm text-amber-700">{anomalyMessage}</p>
                  )}
                  {anomalyLastReportAt && (
                    <p className="text-sm text-amber-600/80">{formatReportDate(anomalyLastReportAt, 'Dernier rapport d\'anomalies généré')}</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {archiveMessage && (
                <span className="text-sm text-gray-600">{archiveMessage}</span>
              )}
              {importFileMessage && (
                <span className={`text-sm ${importFileMessage.startsWith('Fichier copié') ? 'text-green-600' : 'text-red-600'}`}>
                  {importFileMessage}
                </span>
              )}
            </div>
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
                <span className="text-red-600 text-sm font-medium">Mode édition — les cellules sont modifiables</span>
              )}
            </div>
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-gray-100 border-b border-gray-200 z-10">
                  <tr>
                    {displayHeaders.map((h) => (
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
                    ))}
                    {editMode && (
                      <th className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap bg-gray-100 w-[1%]">
                        Exclure Anomalie
                      </th>
                    )}
                    {editMode && (
                      <th className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap bg-gray-100 w-[1%]">
                        Supprimer
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => {
                    const dataRowIndex = data ? data.rows.findIndex((r) => r === row) : -1;
                    const isMarkedForDelete = dataRowIndex >= 0 && rowsToDelete.has(dataRowIndex);
                    const isExcludedFromAnomaly = dataRowIndex >= 0 && rowsExcludedFromAnomaly.has(dataRowIndex);
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
                              <td key={header} className="px-1 py-0.5">
                                <input
                                  type="text"
                                  value={raw}
                                  readOnly={!!isAmountGbpReadOnly}
                                  onChange={(e) => handleCellChange(dataRowIndex, header, e.target.value)}
                                  className={`w-full min-w-[4rem] rounded border px-2 py-1 text-sm text-gray-800 focus:ring-2 focus:ring-red-500 focus:border-red-500 ${isAmountGbpReadOnly ? 'border-gray-200 bg-gray-50 cursor-not-allowed' : 'border-gray-300'}`}
                                  aria-label={isAmountGbpReadOnly ? `${header} (calculé)` : `Éditer ${header}`}
                                  title={isAmountGbpReadOnly ? 'Calculé à partir de AMOUNT et CURRENCY (taux Settings)' : undefined}
                                />
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
              {sortedRows.length} ligne{sortedRows.length !== 1 ? 's' : ''}
              {filterText ? ` (filtré sur ${data.rows.length} au total)` : ''}
            </div>
          </div>
        )}

      </main>
    </div>
  );
};

export default TransactionsTable;
