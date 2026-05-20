import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { ACCOUNT_BALANCE_MERGE_REPORT_PATH, MERGE_REPORT_PATH } from '@/shared/dataPaths';
import { MERGE_REPORT_SUCCESS_REASON } from '@/shared/mergeReportConstants';
import { mergeAccountBalanceImports, type AccountBalanceMergeResult } from '../services/AccountBalanceMergeService';
import { loadRecognisedAccountsFromStorage } from '../constants/recognisedAccountsStorage';

export interface ValidRowShape {
  DATE: string;
  TITLE: string;
  AMOUNT: string;
  CURRENCY: string;
  ACCOUNT: string;
  'AMOUNT GBP': string;
  TYPE: string;
}

function recordToValidRow(rec: Record<string, string>): ValidRowShape {
  return {
    DATE: (rec.DATE ?? '').trim(),
    TITLE: (rec.TITLE ?? '').trim(),
    AMOUNT: (rec.AMOUNT ?? '').trim(),
    CURRENCY: (rec.CURRENCY ?? '').trim(),
    ACCOUNT: (rec.ACCOUNT ?? '').trim(),
    'AMOUNT GBP': (rec['AMOUNT GBP'] ?? '').trim(),
    TYPE: (rec.TYPE ?? '').trim(),
  };
}

function isSuccessReason(raison: string): boolean {
  return raison.trim() === MERGE_REPORT_SUCCESS_REASON;
}

/** Identifiant stable par ligne chargée (ordre du fichier). */
type RowWithId = { id: string; rec: Record<string, string> };

type SortDir = 'asc' | 'desc';

export type ForceMergeMode = 'transactionsAppend' | 'accountBalanceReplace';

export interface MergeReportViewerProps {
  /** Modale plein écran ou bloc intégré dans la page. */
  variant: 'modal' | 'inline';
  /** Modale uniquement : visibilité. */
  open?: boolean;
  onClose?: () => void;
  /** Incrémenter pour recharger le fichier rapport (ex. après préparation). */
  reloadKey?: number;
  /** Fichier rapport à afficher (défaut : merge_report des transactions). */
  reportPath?: string;
  /** Titre dans l’en-tête (modale) ou sous-titre du bloc (inline). */
  modalTitle?: string;
  /** Mode du bouton « Forcer la fusion ». */
  forceMergeMode?: ForceMergeMode;
  /** Après ajout réussi des lignes forcées (transactions). */
  onAfterForceMerge?: () => void;
  /** Après fusion avec remplacement des dates (soldes). */
  onAccountBalanceMergeComplete?: (result: AccountBalanceMergeResult) => void;
}

export const MergeReportViewer: React.FC<MergeReportViewerProps> = ({
  variant,
  open = true,
  onClose = () => {},
  reloadKey = 0,
  reportPath = MERGE_REPORT_PATH,
  modalTitle = 'Rapport merge_report.csv',
  forceMergeMode = 'transactionsAppend',
  onAfterForceMerge,
  onAccountBalanceMergeComplete,
}) => {
  const [rowsWithIds, setRowsWithIds] = useState<RowWithId[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(() => new Set());
  const [forceLoading, setForceLoading] = useState(false);
  const [forceMessage, setForceMessage] = useState<string | null>(null);

  const shouldLoad = variant === 'inline' ? true : !!open;

  useEffect(() => {
    if (!shouldLoad) {
      setIgnoredIds(new Set());
      setForceMessage(null);
      setSortColumn(null);
      return;
    }

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const api = (
          window as unknown as {
            electronAPI?: { readFile: (p: string) => Promise<{ success: boolean; data?: string; error?: string }> };
          }
        ).electronAPI;
        if (!api?.readFile) {
          setLoadError('Lecture fichier non disponible.');
          setRowsWithIds([]);
          setHeaders([]);
          return;
        }
        const result = await api.readFile(reportPath);
        if (!result.success || result.data === undefined) {
          const fallback =
            reportPath === ACCOUNT_BALANCE_MERGE_REPORT_PATH
              ? 'Impossible de lire account_balance_merge_report.csv.'
              : 'Impossible de lire merge_report.csv.';
          setLoadError(result.error ?? fallback);
          setRowsWithIds([]);
          setHeaders([]);
          return;
        }
        const parsed = Papa.parse(result.data, {
          header: true,
          delimiter: ';',
          skipEmptyLines: true,
        });
        const fields = (parsed.meta.fields || []).map((f) => String(f ?? '').replace(/^\uFEFF/, '').trim());
        const data = (parsed.data || []) as Record<string, string>[];
        setHeaders(fields.filter(Boolean));
        setRowsWithIds(data.map((rec, i) => ({ id: `merge-row-${i}`, rec })));
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [shouldLoad, reportPath, reloadKey]);

  const displayHeaders = useMemo(() => {
    const base = headers.length > 0 ? headers : [];
    const withIgnore = base.includes('__ignorer') ? base : [...base, '__ignorer'];
    return withIgnore;
  }, [headers]);

  const sortedRows = useMemo(() => {
    if (!sortColumn || sortColumn === '__ignorer') return rowsWithIds;
    const col = sortColumn;
    const dir = sortDir === 'asc' ? 1 : -1;
    const copy = [...rowsWithIds];
    copy.sort((a, b) => {
      const va = String(a.rec[col] ?? '').trim();
      const vb = String(b.rec[col] ?? '').trim();
      const na = parseFloat(va.replace(',', '.'));
      const nb = parseFloat(vb.replace(',', '.'));
      if (!Number.isNaN(na) && !Number.isNaN(nb) && va.match(/^-?\d/) && vb.match(/^-?\d/)) {
        return (na - nb) * dir;
      }
      return va.localeCompare(vb, undefined, { sensitivity: 'base' }) * dir;
    });
    return copy;
  }, [rowsWithIds, sortColumn, sortDir]);

  const handleHeaderClick = useCallback(
    (h: string) => {
      if (h === '__ignorer') return;
      if (sortColumn === h) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortColumn(h);
        setSortDir('asc');
      }
    },
    [sortColumn]
  );

  const toggleIgnore = useCallback((id: string) => {
    setIgnoredIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const ignorableRowIds = useMemo(
    () =>
      rowsWithIds
        .filter(({ rec }) => {
          const raison = String(rec.raison ?? rec['raison'] ?? '').trim();
          return !isSuccessReason(raison);
        })
        .map(({ id }) => id),
    [rowsWithIds]
  );

  const allIgnorableIgnored =
    ignorableRowIds.length > 0 && ignorableRowIds.every((id) => ignoredIds.has(id));
  const someIgnorableIgnored = ignorableRowIds.some((id) => ignoredIds.has(id));

  const ignoreAllCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ignoreAllCheckboxRef.current;
    if (el) {
      el.indeterminate = someIgnorableIgnored && !allIgnorableIgnored;
    }
  }, [someIgnorableIgnored, allIgnorableIgnored]);

  const toggleIgnoreAll = useCallback(() => {
    if (ignorableRowIds.length === 0) return;
    setIgnoredIds((prev) => {
      const next = new Set(prev);
      const allSelected = ignorableRowIds.every((id) => next.has(id));
      if (allSelected) {
        ignorableRowIds.forEach((id) => next.delete(id));
      } else {
        ignorableRowIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [ignorableRowIds]);

  const finishSuccess = useCallback(() => {
    if (variant === 'modal') {
      onClose();
    }
  }, [variant, onClose]);

  const handleForceMerge = useCallback(async () => {
    if (forceMergeMode === 'accountBalanceReplace') {
      if (ignoredIds.size === 0) {
        setForceMessage('Cochez « Ignorer l’anomalie » sur au moins une ligne pour activer la fusion forcée.');
        return;
      }
      setForceLoading(true);
      setForceMessage(null);
      try {
        const recognised = loadRecognisedAccountsFromStorage();
        const result = await mergeAccountBalanceImports(recognised, { replaceDuplicateDates: true });
        if (result.success) {
          onAccountBalanceMergeComplete?.(result);
          finishSuccess();
        } else {
          setForceMessage(result.error ?? 'Échec de la fusion avec remplacement des dates.');
        }
      } finally {
        setForceLoading(false);
      }
      return;
    }

    const toAppend: ValidRowShape[] = [];
    const ids = Array.from(ignoredIds);
    for (const id of ids) {
      const item = rowsWithIds.find((r) => r.id === id);
      if (!item) continue;
      const rec = item.rec;
      const raison = String(rec.raison ?? rec['raison'] ?? '').trim();
      if (isSuccessReason(raison)) continue;
      const row = recordToValidRow(rec);
      if (!row.DATE) continue;
      toAppend.push(row);
    }
    if (toAppend.length === 0) {
      setForceMessage('Aucune ligne ignorée valide pour la fusion forcée.');
      return;
    }
    setForceLoading(true);
    setForceMessage(null);
    try {
      const api = (
        window as unknown as {
          electronAPI?: {
            appendForcedTransactionRows: (
              rows: ValidRowShape[]
            ) => Promise<{ success: boolean; error?: string; appendedCount: number }>;
          };
        }
      ).electronAPI;
      if (!api?.appendForcedTransactionRows) {
        setForceMessage('Fonction de fusion forcée non disponible.');
        return;
      }
      const result = await api.appendForcedTransactionRows(toAppend);
      if (result.success) {
        onAfterForceMerge?.();
        finishSuccess();
      } else {
        setForceMessage(result.error ?? 'Échec de la fusion forcée.');
      }
    } finally {
      setForceLoading(false);
    }
  }, [
    forceMergeMode,
    ignoredIds,
    rowsWithIds,
    onAfterForceMerge,
    onAccountBalanceMergeComplete,
    finishSuccess,
  ]);

  if (variant === 'modal' && !open) return null;

  const showIgnoreColumn = true;
  const canForce = ignoredIds.size > 0;

  const forceButtonTitle =
    forceMergeMode === 'accountBalanceReplace'
      ? canForce
        ? 'Relancer la fusion en remplaçant les dates déjà présentes par les imports.'
        : 'Cochez « Ignorer l’anomalie » sur au moins une ligne pour activer.'
      : canForce
        ? 'Ajouter au fichier traité les lignes cochées (ex. doublons forcés).'
        : 'Cochez « Ignorer l’anomalie » sur au moins une ligne pour activer.';

  const bodyScrollClass =
    variant === 'inline' ? 'min-h-0 max-h-[min(70vh,520px)] flex-1 overflow-auto px-3 py-3' : 'min-h-0 flex-1 overflow-auto px-4 py-3';

  const card = (
    <div
      className={
        variant === 'inline'
          ? 'mt-3 flex flex-col rounded-lg border border-gray-200 bg-white shadow-sm'
          : 'flex max-h-[90vh] w-full max-w-6xl flex-col rounded-lg bg-white shadow-xl border border-gray-200'
      }
    >
      {variant === 'modal' ? (
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 id="merge-report-modal-title" className="text-lg font-semibold text-gray-900">
            {modalTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            aria-label="Fermer"
          >
            ×
          </button>
        </div>
      ) : (
        <div className="shrink-0 border-b border-gray-200 px-3 py-2">
          <p className="text-xs font-medium text-gray-800">{modalTitle}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            Une ligne par entrée issue des fichiers CSV du dossier Import (généré à la préparation).
          </p>
        </div>
      )}

      <div className={bodyScrollClass}>
        {loading && <p className="text-sm text-gray-500">Chargement…</p>}
        {loadError && (
          <p className="text-sm text-red-600 rounded border border-red-200 bg-red-50 px-2 py-1">{loadError}</p>
        )}
        {!loading && !loadError && rowsWithIds.length === 0 && (
          <p className="text-sm text-gray-600">
            {variant === 'inline'
              ? 'Aucun rapport encore — lancez « Préparer l’import » pour analyser les lignes du dossier Import.'
              : 'Aucune ligne dans le rapport (ou fichier vide).'}
          </p>
        )}
        {!loading && !loadError && rowsWithIds.length > 0 && (
          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-gray-100">
                <tr>
                  {displayHeaders.map((h) => (
                    <th key={h} className="border-b border-gray-200 px-2 py-2 font-semibold text-gray-700">
                      {h === '__ignorer' ? (
                        <label className="inline-flex cursor-pointer items-center gap-2 font-semibold">
                          <input
                            ref={ignoreAllCheckboxRef}
                            type="checkbox"
                            checked={allIgnorableIgnored}
                            disabled={ignorableRowIds.length === 0}
                            onChange={toggleIgnoreAll}
                            className="rounded border-gray-400"
                            aria-label="Tout ignorer : cocher ou décocher toutes les lignes ignorables"
                          />
                          <span className="text-gray-800">Tout ignorer</span>
                        </label>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleHeaderClick(h)}
                          className="flex w-full items-center gap-1 text-left hover:text-blue-700"
                        >
                          {h}
                          {sortColumn === h && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                        </button>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(({ id, rec }) => {
                  const raison = String(rec.raison ?? rec['raison'] ?? '').trim();
                  const success = isSuccessReason(raison);
                  const ignored = ignoredIds.has(id);
                  return (
                    <tr
                      key={id}
                      className={
                        success
                          ? 'bg-emerald-50/80 text-gray-800 border-l-4 border-emerald-500'
                          : 'bg-gray-50/90 border-l-4 border-amber-300'
                      }
                    >
                      {headers.map((col) => {
                        const cell = String(rec[col] ?? '').trim();
                        if (col === 'raison') {
                          return (
                            <td key={col} className="border-t border-gray-100 px-2 py-1.5 align-top">
                              {success ? (
                                <span className="inline-block rounded border border-emerald-600 bg-emerald-100 px-2 py-0.5 font-medium text-emerald-900">
                                  {MERGE_REPORT_SUCCESS_REASON}
                                </span>
                              ) : (
                                <span className="text-gray-800">{cell}</span>
                              )}
                            </td>
                          );
                        }
                        return (
                          <td key={col} className="border-t border-gray-100 px-2 py-1.5 align-top text-gray-800">
                            {cell}
                          </td>
                        );
                      })}
                      {showIgnoreColumn && (
                        <td className="border-t border-gray-100 px-2 py-1.5 align-top">
                          {!success ? (
                            <label className="inline-flex cursor-pointer items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={ignored}
                                onChange={() => toggleIgnore(id)}
                                className="rounded border-gray-400"
                              />
                              <span className="text-gray-700">Ignorer l&apos;anomalie</span>
                            </label>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {forceMessage && (
          <p className="mt-2 text-sm text-amber-800 rounded border border-amber-200 bg-amber-50 px-2 py-1">
            {forceMessage}
          </p>
        )}
      </div>

      <div
        className={`flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-200 ${
          variant === 'inline' ? 'px-3 py-2' : 'px-4 py-3'
        }`}
      >
        {variant === 'modal' && (
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Fermer
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleForceMerge()}
          disabled={!canForce || forceLoading}
          title={forceButtonTitle}
          className="rounded border border-amber-700 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {forceLoading ? 'Traitement…' : 'Forcer la fusion'}
        </button>
      </div>
    </div>
  );

  if (variant === 'modal') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-report-modal-title"
      >
        {card}
      </div>
    );
  }

  return card;
};

export interface MergeReportViewerModalProps extends Omit<MergeReportViewerProps, 'variant'> {
  open: boolean;
}

export const MergeReportViewerModal: React.FC<MergeReportViewerModalProps> = ({ open, ...rest }) => (
  <MergeReportViewer variant="modal" open={open} {...rest} />
);
