import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SourceDataCSVService,
  type SourceDataResult,
} from '../services/SourceDataCSVService';
import { EXCLUDE_ANOMALY_COLUMN } from '../services/AnomalyDetectionService';
import { formatDateDDMMYYYY, formatGbp } from '../utils/format';
import { accountLabelFromSource } from '../constants/accountSourceLabels';

export interface AnomalyExceptionsModalProps {
  open: boolean;
  onClose: () => void;
  /** Après écriture réussie (rafraîchir anomalies slim / vue parent). */
  onAfterSave?: () => void;
}

export const AnomalyExceptionsModal: React.FC<AnomalyExceptionsModalProps> = ({
  open,
  onClose,
  onAfterSave,
}) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SourceDataResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const reloadExceptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await SourceDataCSVService.getAnomalyExceptions();
      setData(r);
      if (!r) setError(t('anomalyExceptions.loadFailed'));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('anomalyExceptions.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) {
      setData(null);
      setError(null);
      setSaveMessage(null);
      return;
    }
    void reloadExceptions();
  }, [open, reloadExceptions]);

  const exceptionRows = useMemo(() => {
    if (!data?.rows) return [] as Array<{ row: Record<string, string>; idx: number }>;
    return data.rows.map((row, i) => {
      const fromIndex = parseInt(String(row.Index ?? row.INDEX ?? '').trim(), 10);
      const fromSource =
        data.rowIndicesInSource != null ? data.rowIndicesInSource[i] + 1 : NaN;
      const idx =
        Number.isFinite(fromIndex) && fromIndex > 0
          ? fromIndex
          : Number.isFinite(fromSource) && fromSource > 0
            ? fromSource
            : i + 1;
      return { row, idx };
    });
  }, [data]);

  const handleRemoveException = useCallback(
    async (idx: number) => {
      setSaving(true);
      setSaveMessage(null);
      try {
        const result = await SourceDataCSVService.clearAnomalyException(idx);
        if (result.success) {
          await reloadExceptions();
          onAfterSave?.();
        } else {
          setSaveMessage(result.error ?? t('anomalyExceptions.saveError'));
        }
      } finally {
        setSaving(false);
      }
    },
    [onAfterSave, reloadExceptions, t]
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
            {t('anomalyExceptions.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 hover:bg-gray-50"
          >
            {t('anomalyExceptions.close')}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {loading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
          {error && !loading && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              {error}
            </p>
          )}
          {saveMessage && (
            <p className="mb-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              {saveMessage}
            </p>
          )}
          {!loading && !error && exceptionRows.length === 0 && (
            <p className="text-sm text-gray-600">{t('anomalyExceptions.empty')}</p>
          )}
          {!loading && exceptionRows.length > 0 && (
            <table className="min-w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600">
                  <th className="py-2 pr-3 font-medium">Index</th>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Title</th>
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 pr-3 font-medium">AMOUNT GBP</th>
                  <th className="py-2 font-medium">{EXCLUDE_ANOMALY_COLUMN}</th>
                  <th className="py-2 pl-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {exceptionRows.map(({ row, idx }) => (
                  <tr key={idx} className="border-b border-gray-100">
                    <td className="py-2 pr-3 tabular-nums text-gray-700">{idx}</td>
                    <td className="py-2 pr-3 text-gray-800">
                      {dateCol ? formatDateDDMMYYYY(row[dateCol] ?? '') : '—'}
                    </td>
                    <td className="py-2 pr-3 text-gray-800">{titleCol ? row[titleCol] ?? '' : '—'}</td>
                    <td className="py-2 pr-3 text-gray-800">
                      {accountCol
                        ? accountLabelFromSource(row[accountCol] ?? '') || row[accountCol] || '—'
                        : '—'}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-gray-800">
                      {amountGbpCol ? formatGbp(row[amountGbpCol] ?? '') : '—'}
                    </td>
                    <td className="py-2 text-gray-800">
                      {row[EXCLUDE_ANOMALY_COLUMN] ?? ''}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleRemoveException(idx)}
                        className="rounded border border-red-600 bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {t('anomalyExceptions.removeException')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
