import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trans, useTranslation } from 'react-i18next';
import { useSupportImportPrepWizard } from '../hooks/useSupportImportPrepWizard';
import {
  supportWizardColumnSamplePreview,
  WIZARD_STANDARD_KEYS,
  type WizardStandardKey,
} from '../services/supportImportWizardService';
import { TRANSACTION_PROJET_COLUMN } from '@/shared/transactionsImportCore';
import { ProjetSelectCell } from './ProjetColumnCells';
import { getSuggestions } from '../services/SuggestInputService';
import { getUiMessageTone, uiMessageClass } from '../utils/uiMessageTone';

export type SupportImportPrepWizardProps = ReturnType<typeof useSupportImportPrepWizard>;

export type SupportImportPrepSectionProps = SupportImportPrepWizardProps & {
  /** Lignes Support existantes pour suggestions TITLE. */
  sourceRowsForSuggestions?: Record<string, string>[];
  /** En-tête colonne TITLE dans Support_data. */
  titleHeaderForSuggestions?: string | null;
};

const MAPPING_SELECT_KEYS = WIZARD_STANDARD_KEYS.filter(
  (k) =>
    k === '' ||
    k === 'DATE' ||
    k === 'TITLE' ||
    k === 'AMOUNT' ||
    k === 'CURRENCY' ||
    k === TRANSACTION_PROJET_COLUMN
);

const CURRENCY_OPTIONS = ['EUR', 'GBP', 'CHF'] as const;

const SupportImportPrepSection: React.FC<SupportImportPrepSectionProps> = (props) => {
  const { t } = useTranslation();
  const {
    supportImportWizardModel,
    importWizardLoading,
    mappingWizardActive,
    setMappingWizardActive,
    diskImportFirstLineAsData,
    setDiskImportFirstLineAsData,
    importColumnMapping,
    updateImportColumnMappingUser,
    rawCellOverrides,
    importRowSkip,
    setImportRowSkip,
    importWizardMessage,
    outputHeaderKeys,
    mappedPreviewByRowId,
    rowStatusByRowId,
    updateRawCell,
    updateMappedCell,
    importPrepIgnSkipHeader,
    importPrepAnomalySkipHeader,
    importPrepDuplicateSkipHeader,
    toggleImportPrepSkipAll,
    toggleSkipAllAnomalous,
    toggleSkipAllDuplicates,
    saveLearnedMappingProfile,
    batchProjet,
    batchCurrency,
    forceBatchCurrencyOnAllRows,
    forceBatchProjetOnAllRows,
    skipAllAlertRows,
    createProjectAndAssignBatch,
    keepBatchAfterImport,
    setKeepBatchAfterImport,
    requireProjet,
    setRequireProjet,
    projects,
    sourceRowsForSuggestions = [],
    titleHeaderForSuggestions = null,
  } = props;

  const prepIgnHeaderCheckboxRef = useRef<HTMLInputElement>(null);
  const prepAnomalyIgnHeaderCheckboxRef = useRef<HTMLInputElement>(null);
  const prepDuplicateIgnHeaderCheckboxRef = useRef<HTMLInputElement>(null);

  const columnSamplePreviewByKey = useMemo(() => {
    const map = new Map<string, string>();
    if (!supportImportWizardModel) return map;
    for (const col of supportImportWizardModel.columns) {
      map.set(col.key, supportWizardColumnSamplePreview(supportImportWizardModel, col));
    }
    return map;
  }, [supportImportWizardModel]);

  useEffect(() => {
    const el = prepIgnHeaderCheckboxRef.current;
    if (!el) return;
    el.indeterminate = importPrepIgnSkipHeader.someSkipped && !importPrepIgnSkipHeader.allSkipped;
  }, [importPrepIgnSkipHeader]);

  useEffect(() => {
    const el = prepAnomalyIgnHeaderCheckboxRef.current;
    if (!el) return;
    el.indeterminate =
      importPrepAnomalySkipHeader.someSkipped && !importPrepAnomalySkipHeader.allSkipped;
  }, [importPrepAnomalySkipHeader]);

  useEffect(() => {
    const el = prepDuplicateIgnHeaderCheckboxRef.current;
    if (!el) return;
    el.indeterminate =
      importPrepDuplicateSkipHeader.someSkipped && !importPrepDuplicateSkipHeader.allSkipped;
  }, [importPrepDuplicateSkipHeader]);

  const sourceFileNames = React.useMemo(() => {
    if (!supportImportWizardModel?.rows.length) return [] as string[];
    return [...new Set(supportImportWizardModel.rows.map((r) => r.sourceFile))];
  }, [supportImportWizardModel]);

  const alertRowCount = useMemo(() => {
    if (!mappingWizardActive || !supportImportWizardModel?.rows.length) return 0;
    let n = 0;
    for (const row of supportImportWizardModel.rows) {
      if (rowStatusByRowId.get(row.id)?.showDanger) n += 1;
    }
    return n;
  }, [mappingWizardActive, supportImportWizardModel?.rows, rowStatusByRowId]);

  const [alertTooltip, setAlertTooltip] = useState<{
    text: string;
    anchorCenterX: number;
    top: number;
  } | null>(null);
  const alertTooltipElRef = useRef<HTMLDivElement>(null);
  const [alertTooltipClampedLeft, setAlertTooltipClampedLeft] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!alertTooltip) {
      setAlertTooltipClampedLeft(null);
      return;
    }
    const el = alertTooltipElRef.current;
    const w = el?.offsetWidth ?? 0;
    if (!w) return;
    const margin = 8;
    const half = w / 2;
    const cx = alertTooltip.anchorCenterX;
    setAlertTooltipClampedLeft(
      Math.min(window.innerWidth - margin - half, Math.max(margin + half, cx))
    );
  }, [alertTooltip]);

  const showAlertTooltip = useCallback((e: React.MouseEvent<HTMLElement>, messages: string[]) => {
    if (messages.length === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    setAlertTooltip({
      text: messages.join('\n\n'),
      anchorCenterX: r.left + r.width / 2,
      top: r.top - 6,
    });
  }, []);

  const hideAlertTooltip = useCallback(() => setAlertTooltip(null), []);

  const renderAlertCell = (messages: string[], showDanger: boolean) => (
    <td
      className={`px-1 py-0.5 align-middle text-center min-w-[2rem] ${messages.length ? 'cursor-help' : ''}`}
      onMouseEnter={messages.length ? (e) => showAlertTooltip(e, messages) : undefined}
      onMouseLeave={messages.length ? hideAlertTooltip : undefined}
    >
      {showDanger ? (
        <span
          className="inline-flex items-center justify-center text-lg leading-none text-red-600"
          role="img"
          aria-label={messages.join(' · ')}
        >
          ⚠️
        </span>
      ) : (
        <span className="text-gray-400">—</span>
      )}
    </td>
  );

  const getRawCellDisplay = (rowId: string, colKey: string, colIndex: number, values: string[]) => {
    const ov = rawCellOverrides[rowId]?.[colKey];
    if (ov !== undefined) return ov;
    return values[colIndex] ?? '';
  };

  const titleSuggestionsFor = useCallback(
    (raw: string) => {
      if (!titleHeaderForSuggestions || sourceRowsForSuggestions.length === 0) return [];
      return getSuggestions(sourceRowsForSuggestions, titleHeaderForSuggestions, raw, 10);
    },
    [sourceRowsForSuggestions, titleHeaderForSuggestions]
  );

  const handleCreateProjet = useCallback(() => {
    const name = window.prompt(t('support.importPrep.createProjetPrompt'));
    if (name == null) return;
    createProjectAndAssignBatch(name);
  }, [createProjectAndAssignBatch, t]);

  return (
    <>
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('transactions.importPrep.title')}</h2>
        <p className="text-xs text-gray-600 mb-2 max-w-3xl">
          <Trans
            i18nKey="support.importPrep.description"
            components={{
              mw: <strong className="font-semibold text-gray-800" />,
              code: <code className="text-gray-800" />,
            }}
          />
        </p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            type="button"
            role="switch"
            aria-checked={mappingWizardActive}
            onClick={() => setMappingWizardActive((v) => !v)}
            disabled={importWizardLoading || !supportImportWizardModel?.rows.length}
            title={
              mappingWizardActive
                ? t('support.importPrep.mappingOnTitle')
                : t('support.importPrep.mappingOffTitle')
            }
            className={`relative overflow-hidden rounded-xl border px-4 py-2 text-sm font-semibold shadow-md disabled:cursor-not-allowed disabled:opacity-45 ${
              mappingWizardActive
                ? 'border-white/25 bg-gradient-to-b from-slate-700/90 to-slate-950 shadow-[0_4px_20px_rgba(15,23,42,0.4),inset_0_1px_0_rgba(255,255,255,0.12)]'
                : 'border-gray-300 bg-gray-100 text-gray-800 hover:bg-gray-200'
            }`}
          >
            {mappingWizardActive && (
              <span
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 via-transparent to-transparent"
                aria-hidden
              />
            )}
            <span
              className={
                mappingWizardActive
                  ? 'relative bg-gradient-to-r from-teal-300 via-sky-400 to-violet-400 bg-clip-text text-transparent'
                  : 'relative'
              }
            >
              Mapping wizard
            </span>
            <span className={`relative ml-2 text-xs font-normal ${mappingWizardActive ? 'text-slate-300' : 'text-gray-600'}`}>
              {mappingWizardActive ? t('transactions.importPrep.mappingOn') : t('transactions.importPrep.mappingOff')}
            </span>
          </button>
          <label
            className="inline-flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer select-none"
            title={t('support.importPrep.keepBatchHint')}
          >
            <input
              type="checkbox"
              checked={keepBatchAfterImport}
              onChange={(e) => setKeepBatchAfterImport(e.target.checked)}
              className="rounded border-gray-400"
            />
            {t('support.importPrep.keepBatch')}
          </label>
          <label
            className="inline-flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer select-none"
            title={t('support.importPrep.requireProjetHint')}
          >
            <input
              type="checkbox"
              checked={requireProjet}
              onChange={(e) => setRequireProjet(e.target.checked)}
              className="rounded border-gray-400"
            />
            {t('support.importPrep.requireProjet')}
          </label>
          <button
            type="button"
            onClick={handleCreateProjet}
            className="rounded border border-teal-300 bg-teal-50 px-2 py-1 text-[11px] font-medium text-teal-900 hover:bg-teal-100"
            title={t('support.importPrep.createProjetHint')}
          >
            {t('support.importPrep.createProjet')}
          </button>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={diskImportFirstLineAsData}
              onChange={(e) => setDiskImportFirstLineAsData(e.target.checked)}
              disabled={importWizardLoading}
              className="rounded border-gray-400"
            />
            {t('transactions.importPrep.diskFirstLine')}
          </label>
        </div>
        {importWizardMessage && (
          <p className={`text-sm rounded border px-2 py-1 mb-2 ${uiMessageClass(getUiMessageTone(importWizardMessage))}`}>
            {importWizardMessage}
          </p>
        )}
        {!supportImportWizardModel?.rows.length && (
          <p className="text-sm text-amber-800 rounded border border-amber-200 bg-amber-50 px-2 py-1">
            {t('support.importPrep.emptyState')}
          </p>
        )}
        {supportImportWizardModel && supportImportWizardModel.rows.length > 0 && (
          <div className="rounded border border-gray-200 bg-white overflow-hidden">
            <div className="px-2 py-1.5 bg-gray-100 text-xs font-medium text-gray-700">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  {t('transactions.importPrep.prepHeader')}{' '}
                  <span className="font-semibold text-gray-900" title={sourceFileNames.join(', ')}>
                    {sourceFileNames.join(', ')}
                  </span>{' '}
                  (
                  {mappingWizardActive
                    ? t('support.importPrep.statsMapped', {
                        total: importPrepIgnSkipHeader.total,
                        count: importPrepIgnSkipHeader.active,
                      })
                    : t('transactions.importPrep.statsRaw', { count: supportImportWizardModel.rows.length })}
                  )
                  {mappingWizardActive
                    ? t('support.importPrep.modeMapped')
                    : t('transactions.importPrep.modeRaw')}
                </span>
                {mappingWizardActive && (
                  <label
                    className="inline-flex items-center gap-1 font-normal text-gray-700 cursor-pointer select-none"
                    title={
                      importPrepAnomalySkipHeader.count === 0
                        ? t('transactions.importPrep.skipAnomaliesNone')
                        : t('transactions.importPrep.skipAnomaliesHint')
                    }
                  >
                    <input
                      ref={prepAnomalyIgnHeaderCheckboxRef}
                      type="checkbox"
                      className="shrink-0"
                      checked={importPrepAnomalySkipHeader.allSkipped}
                      disabled={importPrepAnomalySkipHeader.count === 0}
                      onChange={toggleSkipAllAnomalous}
                      aria-label={t('transactions.importPrep.skipAnomaliesAria')}
                    />
                    {t('transactions.importPrep.skipAnomalies')}
                    {importPrepAnomalySkipHeader.count > 0 && (
                      <span className="text-gray-500">({importPrepAnomalySkipHeader.count})</span>
                    )}
                  </label>
                )}
                {mappingWizardActive && (
                  <label
                    className="inline-flex items-center gap-1 font-normal text-gray-700 cursor-pointer select-none"
                    title={
                      importPrepDuplicateSkipHeader.count === 0
                        ? t('support.importPrep.skipDuplicatesNone')
                        : t('support.importPrep.skipDuplicatesHint')
                    }
                  >
                    <input
                      ref={prepDuplicateIgnHeaderCheckboxRef}
                      type="checkbox"
                      className="shrink-0"
                      checked={importPrepDuplicateSkipHeader.allSkipped}
                      disabled={importPrepDuplicateSkipHeader.count === 0}
                      onChange={toggleSkipAllDuplicates}
                      aria-label={t('transactions.importPrep.skipDuplicatesAria')}
                    />
                    {t('transactions.importPrep.skipDuplicates')}
                    {importPrepDuplicateSkipHeader.count > 0 && (
                      <span className="text-gray-500">({importPrepDuplicateSkipHeader.count})</span>
                    )}
                  </label>
                )}
              </div>
            </div>
            {mappingWizardActive && (
              <div className="px-2 py-1.5 border-b border-gray-200 bg-white flex flex-wrap items-center gap-2 text-[11px]">
                <span className="font-semibold text-gray-700 shrink-0">
                  {t('support.importPrep.bulkActionsLabel')}
                </span>
                <button
                  type="button"
                  onClick={forceBatchCurrencyOnAllRows}
                  disabled={!batchCurrency.trim()}
                  title={t('support.importPrep.forceCurrencyHint')}
                  className="rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {t('support.importPrep.forceCurrency')}
                </button>
                <button
                  type="button"
                  onClick={forceBatchProjetOnAllRows}
                  disabled={!batchProjet.trim()}
                  title={t('support.importPrep.forceProjetHint')}
                  className="rounded border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {t('support.importPrep.forceProjet')}
                </button>
                <button
                  type="button"
                  onClick={skipAllAlertRows}
                  disabled={alertRowCount === 0}
                  title={t('support.importPrep.skipAllAlertsHint')}
                  className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {t('support.importPrep.skipAllAlerts')}
                  {alertRowCount > 0 ? ` (${alertRowCount})` : ''}
                </button>
              </div>
            )}
            {mappingWizardActive && supportImportWizardModel.columns.length > 0 && (
              <div className="px-2 py-2 border-b border-indigo-100 bg-indigo-50/50 text-xs text-gray-800">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-0.5">
                  <p className="font-semibold text-gray-900">
                    {t('transactions.importPrep.columnMappingTitle')}
                  </p>
                  <button
                    type="button"
                    onClick={() => void saveLearnedMappingProfile()}
                    className="rounded border border-indigo-400 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-800 hover:bg-indigo-50"
                  >
                    {t('transactions.importPrep.saveMappingProfile')}
                  </button>
                </div>
                <p className="text-[11px] text-gray-600 mb-2">
                  {t('support.importPrep.columnMappingHint')}
                </p>
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {supportImportWizardModel.columns.map((col) => {
                    const sample = columnSamplePreviewByKey.get(col.key) ?? '—';
                    const colNo = col.colIndex + 1;
                    const selectVal = (importColumnMapping[col.key] ?? '') as string;
                    return (
                      <div
                        key={col.key}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1"
                        title={t('support.importPrep.sourceFile', { name: col.fileName })}
                      >
                        <span className="w-10 shrink-0 font-mono text-[11px] font-semibold text-gray-700">
                          {colNo}
                        </span>
                        <select
                          className="min-w-[10rem] shrink-0 rounded border border-gray-300 bg-white px-1 py-0.5 text-[11px]"
                          value={selectVal}
                          onChange={(e) =>
                            updateImportColumnMappingUser(col.key, e.target.value as WizardStandardKey)
                          }
                          aria-label={t('support.importPrep.targetColumnAria', { n: colNo })}
                        >
                          {MAPPING_SELECT_KEYS.map((k) => (
                            <option key={k || '__ignore__'} value={k}>
                              {k === '' ? t('transactions.importPrep.ignoreOption') : k}
                            </option>
                          ))}
                        </select>
                        <span className="text-[11px] text-gray-500 shrink-0">
                          ({col.label || `Col${colNo}`})
                        </span>
                        <span className="min-w-0 flex-1 text-[11px] leading-snug text-gray-600 break-words">
                          {sample}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="overflow-x-auto max-h-[min(420px,50vh)] overflow-y-auto">
              <table className="min-w-0 w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-600">
                    {mappingWizardActive ? (
                      <>
                        <th className="w-8 px-1 py-1 align-top">
                          <input
                            ref={prepIgnHeaderCheckboxRef}
                            id="support-prep-ign-header"
                            type="checkbox"
                            checked={importPrepIgnSkipHeader.allSkipped}
                            disabled={supportImportWizardModel.rows.length === 0}
                            onChange={toggleImportPrepSkipAll}
                            aria-label={t('transactions.importPrep.skipAllAria')}
                          />
                          <label htmlFor="support-prep-ign-header" className="cursor-pointer select-none ml-0.5">
                            {t('transactions.importPrep.skipCol')}
                          </label>
                        </th>
                        <th className="w-8 px-1 py-1 align-top">#</th>
                        <th className="w-8 px-1 py-1 align-top text-center" aria-label={t('support.importPrep.alertsAria')}>
                          !
                        </th>
                        {outputHeaderKeys.map((h) => (
                          <th key={h} className="px-1 py-1 align-top min-w-[6rem] max-w-[10rem] font-mono text-[11px]">
                            {h}
                          </th>
                        ))}
                      </>
                    ) : (
                      <>
                        <th className="w-8 px-1 py-1 align-top">#</th>
                        <th className="w-8 px-1 py-1 align-top text-center" aria-label={t('support.importPrep.alertsAria')}>
                          !
                        </th>
                        {supportImportWizardModel.columns.map((col) => (
                          <th
                            key={col.key}
                            className="px-1 py-1 align-top min-w-[6rem] max-w-[10rem] truncate"
                            title={`${col.fileName} — ${col.label}`}
                          >
                            <div className="text-[10px] text-gray-500 truncate">{col.fileName}</div>
                            <div className="font-medium text-gray-800 truncate">{col.label}</div>
                          </th>
                        ))}
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {mappingWizardActive
                    ? supportImportWizardModel.rows.map((row) => {
                        const skipped = importRowSkip.has(row.id);
                        const status = rowStatusByRowId.get(row.id);
                        const messages = status?.messages ?? [];
                        const showDanger = status?.showDanger ?? false;
                        const display = mappedPreviewByRowId.get(row.id)?.display ?? {};
                        const titleVal = display.TITLE ?? '';
                        const titleSuggestions = titleSuggestionsFor(titleVal);
                        const titleListId = `support-wizard-title-${row.id}`;
                        const currencyVal = (display.CURRENCY ?? '').trim().toUpperCase();
                        return (
                          <tr key={row.id} className={`border-b border-gray-100 ${skipped ? 'opacity-50' : ''}`}>
                            <td className="px-1 py-0.5 align-middle">
                              <input
                                type="checkbox"
                                checked={skipped}
                                onChange={() => {
                                  setImportRowSkip((prev) => {
                                    const n = new Set(prev);
                                    if (n.has(row.id)) n.delete(row.id);
                                    else n.add(row.id);
                                    return n;
                                  });
                                }}
                                aria-label={t('transactions.importPrep.skipRowAria')}
                              />
                            </td>
                            <td className="px-1 py-0.5 text-right text-gray-600 tabular-nums">{row.lineNumber}</td>
                            {renderAlertCell(messages, showDanger)}
                            {outputHeaderKeys.map((h) => {
                              if (h === TRANSACTION_PROJET_COLUMN) {
                                return (
                                  <td key={h} className="px-0.5 py-0.5 align-top min-w-[8rem]">
                                    <ProjetSelectCell
                                      rawId={display[h] ?? ''}
                                      projects={projects}
                                      disabled={skipped}
                                      onChange={(projectId) => updateMappedCell(row.id, h, projectId)}
                                      className="border-gray-200"
                                    />
                                  </td>
                                );
                              }
                              if (h === 'CURRENCY') {
                                const known = (CURRENCY_OPTIONS as readonly string[]).includes(currencyVal);
                                return (
                                  <td key={h} className="px-0.5 py-0.5 align-top min-w-[5rem]">
                                    <select
                                      value={known ? currencyVal : currencyVal ? '__other__' : ''}
                                      disabled={skipped}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        if (v === '__other__') return;
                                        updateMappedCell(row.id, h, v);
                                      }}
                                      className="w-full min-w-0 rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-400/40 disabled:opacity-50"
                                      aria-label={h}
                                    >
                                      <option value="">—</option>
                                      {CURRENCY_OPTIONS.map((c) => (
                                        <option key={c} value={c}>
                                          {c}
                                        </option>
                                      ))}
                                      {!known && currencyVal ? (
                                        <option value="__other__">{currencyVal}</option>
                                      ) : null}
                                    </select>
                                  </td>
                                );
                              }
                              if (h === 'TITLE') {
                                return (
                                  <td key={h} className="px-0.5 py-0.5 align-top">
                                    <input
                                      type="text"
                                      value={titleVal}
                                      list={titleSuggestions.length > 0 ? titleListId : undefined}
                                      onChange={(e) => updateMappedCell(row.id, h, e.target.value)}
                                      disabled={skipped}
                                      className="w-full min-w-0 rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-400/40 disabled:opacity-50"
                                      aria-label={h}
                                      autoComplete="off"
                                    />
                                    {titleSuggestions.length > 0 && (
                                      <datalist id={titleListId}>
                                        {titleSuggestions.map((s) => (
                                          <option key={`${s.value}-${s.count}`} value={s.value} />
                                        ))}
                                      </datalist>
                                    )}
                                  </td>
                                );
                              }
                              return (
                                <td key={h} className="px-0.5 py-0.5 align-top">
                                  <input
                                    type="text"
                                    value={display[h] ?? ''}
                                    onChange={(e) => updateMappedCell(row.id, h, e.target.value)}
                                    disabled={skipped}
                                    className="w-full min-w-0 rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-400/40 disabled:opacity-50"
                                    aria-label={h}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })
                    : supportImportWizardModel.rows.map((row) => {
                        const status = rowStatusByRowId.get(row.id);
                        const messages = status?.messages ?? [];
                        const showDanger = status?.showDanger ?? false;
                        return (
                          <tr key={row.id} className="border-b border-gray-100">
                            <td className="px-1 py-0.5 text-right text-gray-600 tabular-nums">{row.lineNumber}</td>
                            {renderAlertCell(messages, showDanger)}
                            {supportImportWizardModel.columns.map((col) => {
                              if (col.fileName !== row.sourceFile) {
                                return <td key={col.key} className="px-0.5 py-0.5 bg-gray-50" />;
                              }
                              return (
                                <td key={col.key} className="px-0.5 py-0.5 align-top">
                                  <input
                                    type="text"
                                    value={getRawCellDisplay(row.id, col.key, col.colIndex, row.values)}
                                    onChange={(e) => updateRawCell(row.id, col.key, e.target.value)}
                                    className="w-full min-w-0 rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-400/40"
                                    aria-label={col.label}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {alertTooltip &&
        createPortal(
          <div
            ref={alertTooltipElRef}
            role="tooltip"
            className="pointer-events-none fixed z-[9999] max-w-xs -translate-x-1/2 -translate-y-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-left text-[11px] leading-snug text-gray-800 shadow-lg whitespace-pre-wrap"
            style={{
              left: alertTooltipClampedLeft ?? alertTooltip.anchorCenterX,
              top: alertTooltip.top,
            }}
          >
            {alertTooltip.text}
          </div>,
          document.body
        )}
    </>
  );
};

export default SupportImportPrepSection;
