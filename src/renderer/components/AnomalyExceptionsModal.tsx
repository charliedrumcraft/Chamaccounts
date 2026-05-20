import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import {
  SourceDataCSVService,
  type SourceDataResult,
  SOURCE_DATA_PATH,
  normalizeOrderAndIndex,
} from '../services/SourceDataCSVService';
import { EXCLUDE_ANOMALY_COLUMN } from '../services/AnomalyDetectionService';
import { formatDateDDMMYYYY, formatGbp } from '../utils/format';
import { accountLabelFromSource } from '../constants/accountSourceLabels';

function isRowExcludedFromAnomaly(row: Record<string, string>): boolean {
  const v = (row[EXCLUDE_ANOMALY_COLUMN] ?? '').trim().toLowerCase();
  return v === '1' || v === 'oui' || v === 'true' || v === 'yes';
}

export interface AnomalyExceptionsModalProps {
  open: boolean;
  onClose: () => void;
  /** Après écriture réussie du CSV (recharger le tableau parent). */
  onAfterSave?: () => void;
}

export const AnomalyExceptionsModal: React.FC<AnomalyExceptionsModalProps> = ({
  open,
  onClose,
  onAfterSave,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SourceDataResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
      setSaveMessage(null);
      return;
    }
    setLoading(true);
    setError(null);
    SourceDataCSVService.load()
      .then((r) => {
        setData(r);
        if (!r) setError('Fichier src_transaction_data.csv absent ou vide.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, [open]);

  const exceptionRowIndices = useMemo(() => {
    if (!data?.rows) return [] as number[];
    const out: number[] = [];
    data.rows.forEach((row, i) => {
      if (isRowExcludedFromAnomaly(row)) out.push(i);
    });
    return out;
  }, [data]);

  const persistRows = useCallback(
    async (nextRows: Record<string, string>[]) => {
      if (!data) return;
      const api = (
        window as unknown as {
          electronAPI?: { writeFile: (p: string, c: string) => Promise<{ success: boolean; error?: string }> };
        }
      ).electronAPI;
      if (!api?.writeFile) {
        setSaveMessage('Écriture fichier non disponible.');
        return;
      }
      setSaving(true);
      setSaveMessage(null);
      try {
        const headers = data.headers.includes(EXCLUDE_ANOMALY_COLUMN)
          ? data.headers
          : [...data.headers, EXCLUDE_ANOMALY_COLUMN];
        const withIndexHeader = headers.some((h) => /^index$/i.test(h)) ? headers : ['Index', ...headers];
        const normalized = normalizeOrderAndIndex({
          headers: withIndexHeader,
          rows: nextRows,
        });
        const csvContent = Papa.unparse(normalized.rows, {
          columns: normalized.headers,
          delimiter: ';',
        });
        const result = await api.writeFile(SOURCE_DATA_PATH, csvContent);
        if (result.success) {
          setData(normalized);
          onAfterSave?.();
        } else {
          setSaveMessage(result.error ?? 'Erreur lors de l’enregistrement.');
        }
      } finally {
        setSaving(false);
      }
    },
    [data, onAfterSave]
  );

  const handleRemoveException = useCallback(
    async (dataRowIndex: number) => {
      if (!data?.rows[dataRowIndex]) return;
      const nextRows = data.rows.map((row, i) =>
        i === dataRowIndex ? { ...row, [EXCLUDE_ANOMALY_COLUMN]: '' } : row
      );
      await persistRows(nextRows);
    },
    [data, persistRows]
  );

  if (!open) return null;

  const dateCol = data?.headers.find((h) => /date/i.test(h)) ?? null;
  const titleCol = data?.headers.find((h) => /^title$/i.test(h)) ?? null;
  const accountCol = data?.headers.find((h) => /^account$/i.test(h)) ?? null;
  const amountGbpCol = data?.headers.find((h) => /^amount\s*gbp$/i.test(h)) ?? null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="anomaly-exceptions-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-xl border border-gray-200">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
          <h2 id="anomaly-exceptions-title" className="text-lg font-semibold text-gray-900">
            Exceptions à la détection d&apos;anomalies
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

        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          <p className="text-sm text-gray-600 mb-3">
            Lignes marquées « ignorer l&apos;anomalie » dans le fichier{' '}
            <code className="text-xs bg-gray-100 px-1 rounded">src_transaction_data.csv</code>. Retirer une
            ligne réactive la détection sur celle-ci.
          </p>
          {loading && <p className="text-sm text-gray-500">Chargement…</p>}
          {error && (
            <p className="text-sm text-red-600 rounded border border-red-200 bg-red-50 px-2 py-1">{error}</p>
          )}
          {saveMessage && (
            <p className="text-sm text-amber-800 rounded border border-amber-200 bg-amber-50 px-2 py-1 mb-2">
              {saveMessage}
            </p>
          )}
          {!loading && !error && data && exceptionRowIndices.length === 0 && (
            <p className="text-sm text-gray-600">Aucune exception enregistrée.</p>
          )}
          {!loading && !error && data && exceptionRowIndices.length > 0 && (
            <div className="overflow-x-auto rounded border border-gray-200">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-gray-100">
                  <tr>
                    <th className="border-b border-gray-200 px-2 py-2 font-semibold text-gray-700">Index</th>
                    {dateCol && (
                      <th className="border-b border-gray-200 px-2 py-2 font-semibold text-gray-700">Date</th>
                    )}
                    {titleCol && (
                      <th className="border-b border-gray-200 px-2 py-2 font-semibold text-gray-700">Libellé</th>
                    )}
                    {accountCol && (
                      <th className="border-b border-gray-200 px-2 py-2 font-semibold text-gray-700">Compte</th>
                    )}
                    {amountGbpCol && (
                      <th className="border-b border-gray-200 px-2 py-2 font-semibold text-gray-700">Montant GBP</th>
                    )}
                    <th className="border-b border-gray-200 px-2 py-2 font-semibold text-gray-700 w-[1%]">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {exceptionRowIndices.map((idx) => {
                    const row = data.rows[idx];
                    if (!row) return null;
                    const rawDate = dateCol ? (row[dateCol] ?? '') : '';
                    const rawTitle = titleCol ? (row[titleCol] ?? '') : '';
                    const rawAcc = accountCol ? (row[accountCol] ?? '') : '';
                    const rawGbp = amountGbpCol ? (row[amountGbpCol] ?? '') : '';
                    return (
                      <tr key={idx} className="border-t border-gray-100 bg-amber-50/40">
                        <td className="px-2 py-1.5 text-gray-800 whitespace-nowrap">
                          {(row.Index ?? row.index ?? String(idx + 1)).toString()}
                        </td>
                        {dateCol && (
                          <td className="px-2 py-1.5 text-gray-800 whitespace-nowrap">
                            {formatDateDDMMYYYY(rawDate)}
                          </td>
                        )}
                        {titleCol && (
                          <td className="px-2 py-1.5 text-gray-800 max-w-xs truncate" title={rawTitle}>
                            {rawTitle}
                          </td>
                        )}
                        {accountCol && (
                          <td className="px-2 py-1.5 text-gray-800 whitespace-nowrap">
                            {accountLabelFromSource(rawAcc) || rawAcc}
                          </td>
                        )}
                        {amountGbpCol && (
                          <td className="px-2 py-1.5 text-gray-800 whitespace-nowrap">{formatGbp(rawGbp)}</td>
                        )}
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void handleRemoveException(idx)}
                            className="rounded border border-red-600 bg-white px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Retirer l&apos;exception
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-400 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
