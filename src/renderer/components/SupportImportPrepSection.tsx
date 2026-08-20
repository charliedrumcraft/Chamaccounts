import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSupportImportPrepWizard } from '../hooks/useSupportImportPrepWizard';
import {
  supportWizardColumnSamplePreview,
  WIZARD_STANDARD_KEYS,
  type WizardStandardKey,
} from '../services/supportImportWizardService';
import { getUiMessageTone, uiMessageClass } from '../utils/uiMessageTone';

export type SupportImportPrepWizardProps = ReturnType<typeof useSupportImportPrepWizard>;

export type SupportImportPrepSectionProps = SupportImportPrepWizardProps;

const MAPPING_SELECT_KEYS = WIZARD_STANDARD_KEYS.filter(
  (k) => k === '' || k === 'DATE' || k === 'TITLE' || k === 'AMOUNT' || k === 'CURRENCY' || k === 'ACCOUNT'
);

const SupportImportPrepSection: React.FC<SupportImportPrepSectionProps> = (props) => {
  const {
    supportImportWizardModel,
    applySupportWizardClipboardPaste,
    clearWizardBatch,
    mappingWizardActive,
    setMappingWizardActive,
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
    toggleImportPrepSkipAll,
    toggleSkipAllAnomalous,
  } = props;

  const prepIgnHeaderCheckboxRef = useRef<HTMLInputElement>(null);
  const prepAnomalyIgnHeaderCheckboxRef = useRef<HTMLInputElement>(null);
  const [clipboardDraft, setClipboardDraft] = useState('');
  const [pasteFirstLineAsData, setPasteFirstLineAsData] = useState(false);

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

  const sourceFileNames = React.useMemo(() => {
    if (!supportImportWizardModel?.rows.length) return [] as string[];
    return [...new Set(supportImportWizardModel.rows.map((r) => r.sourceFile))];
  }, [supportImportWizardModel]);

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

  return (
    <>
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Édition des données avant import</h2>
        <p className="text-xs text-gray-600 mb-2 max-w-3xl">
          Collez des lignes depuis un tableur, activez le{' '}
          <strong className="font-semibold text-gray-800">mapping wizard</strong> pour aligner les colonnes sur{' '}
          <code className="text-gray-800">Support_data.csv</code> (DATE, TITLE, AMOUNT, CURRENCY), puis importez.
          Le type « Support » et la source manuelle sont appliqués automatiquement. La colonne d’alerte (⚠️) résume
          les problèmes : survolez pour le détail.
        </p>
        <div className="mb-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 max-w-3xl">
          <p className="text-xs font-medium text-gray-700 mb-1">Coller depuis un tableur</p>
          <p className="text-[11px] text-gray-500 mb-2">
            Copiez des cellules dans Excel, Numbers ou Google Sheets (séparateur tabulation), ou du texte CSV, puis
            collez ici. Les lignes s’ajoutent au lot en cours.
          </p>
          <textarea
            value={clipboardDraft}
            onChange={(e) => setClipboardDraft(e.target.value)}
            spellCheck={false}
            rows={4}
            placeholder="Collez ici (Ctrl+V / Cmd+V)…"
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs font-mono text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-[11px] text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={pasteFirstLineAsData}
                onChange={(e) => setPasteFirstLineAsData(e.target.checked)}
                className="rounded border-gray-400"
              />
              Pas d’en-tête (1re ligne = donnée)
            </label>
            <button
              type="button"
              disabled={!clipboardDraft.trim()}
              onClick={() => {
                applySupportWizardClipboardPaste(clipboardDraft, {
                  firstLineAsData: pasteFirstLineAsData,
                });
                setClipboardDraft('');
              }}
              className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Ajouter au tableau
            </button>
            {supportImportWizardModel?.rows.length ? (
              <button
                type="button"
                onClick={() => clearWizardBatch()}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
              >
                Vider le lot
              </button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            type="button"
            role="switch"
            aria-checked={mappingWizardActive}
            onClick={() => setMappingWizardActive((v) => !v)}
            disabled={!supportImportWizardModel?.rows.length}
            title={
              mappingWizardActive
                ? 'Désactiver : revenir aux données brutes'
                : 'Activer : tableau aligné sur Support_data.csv'
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
              {mappingWizardActive ? 'activé' : 'désactivé — données brutes'}
            </span>
          </button>
        </div>
        {importWizardMessage && (
          <p className={`text-sm rounded border px-2 py-1 mb-2 ${uiMessageClass(getUiMessageTone(importWizardMessage))}`}>
            {importWizardMessage}
          </p>
        )}
        {!supportImportWizardModel?.rows.length && (
          <p className="text-sm text-amber-800 rounded border border-amber-200 bg-amber-50 px-2 py-1">
            Aucune ligne à afficher : utilisez la zone « Coller depuis un tableur » ci-dessus.
          </p>
        )}
        {supportImportWizardModel && supportImportWizardModel.rows.length > 0 && (
          <div className="rounded border border-gray-200 bg-white overflow-hidden">
            <div className="px-2 py-1.5 bg-gray-100 text-xs font-medium text-gray-700">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>
                  Préparation —{' '}
                  <span className="font-semibold text-gray-900" title={sourceFileNames.join(', ')}>
                    {sourceFileNames.join(', ')}
                  </span>{' '}
                  (
                  {mappingWizardActive
                    ? `${importPrepIgnSkipHeader.total} lignes au total · ${importPrepIgnSkipHeader.active} non ignorée${importPrepIgnSkipHeader.active !== 1 ? 's' : ''}`
                    : `${supportImportWizardModel.rows.length} lignes`}
                  )
                  {mappingWizardActive
                    ? ' — aperçu aligné sur Support_data.csv'
                    : ' — données brutes (mapping wizard désactivé)'}
                </span>
                {mappingWizardActive && (
                  <label
                    className="inline-flex items-center gap-1 font-normal text-gray-700 cursor-pointer select-none"
                    title={
                      importPrepAnomalySkipHeader.count === 0
                        ? 'Aucune ligne en anomalie (⚠️)'
                        : 'Cocher pour ignorer toutes les lignes affichant une alerte ⚠️ ; décocher pour les rétablir'
                    }
                  >
                    <input
                      ref={prepAnomalyIgnHeaderCheckboxRef}
                      type="checkbox"
                      className="shrink-0"
                      checked={importPrepAnomalySkipHeader.allSkipped}
                      disabled={importPrepAnomalySkipHeader.count === 0}
                      onChange={toggleSkipAllAnomalous}
                      aria-label="Ignorer toutes les lignes en anomalie"
                    />
                    Ignorer les lignes en anomalie
                    {importPrepAnomalySkipHeader.count > 0 && (
                      <span className="text-gray-500">({importPrepAnomalySkipHeader.count})</span>
                    )}
                  </label>
                )}
              </div>
            </div>
            {mappingWizardActive && supportImportWizardModel.columns.length > 0 && (
              <div className="px-2 py-2 border-b border-indigo-100 bg-indigo-50/50 text-xs text-gray-800">
                <p className="font-semibold text-gray-900 mb-0.5">Attribution des colonnes sources</p>
                <p className="text-[11px] text-gray-600 mb-2">
                  Numéro = position dans le collage. « Auto » utilise l’inférence d’en-tête. À droite : aperçu des
                  premières valeurs.
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
                        title={`Source : ${col.fileName}`}
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
                          aria-label={`Cible colonne ${colNo}`}
                        >
                          {MAPPING_SELECT_KEYS.map((k) => (
                            <option key={k || '__ignore__'} value={k}>
                              {k === '' ? 'Ignorer' : k}
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
                            aria-label="Tout ignorer ou tout rétablir les lignes"
                          />
                          <label htmlFor="support-prep-ign-header" className="cursor-pointer select-none ml-0.5">
                            Ign.
                          </label>
                        </th>
                        <th className="w-8 px-1 py-1 align-top">#</th>
                        <th className="w-8 px-1 py-1 align-top text-center" aria-label="Alertes">
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
                        <th className="w-8 px-1 py-1 align-top text-center" aria-label="Alertes">
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
                                aria-label="Ignorer cette ligne"
                              />
                            </td>
                            <td className="px-1 py-0.5 text-right text-gray-600 tabular-nums">{row.lineNumber}</td>
                            {renderAlertCell(messages, showDanger)}
                            {outputHeaderKeys.map((h) => (
                              <td key={h} className="px-0.5 py-0.5 align-top">
                                <input
                                  type="text"
                                  value={display[h] ?? ''}
                                  onChange={(e) => updateMappedCell(row.id, h, e.target.value)}
                                  className="w-full min-w-0 rounded border border-gray-200 bg-white px-1 py-0.5 text-[11px] text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-400/40"
                                  aria-label={h}
                                />
                              </td>
                            ))}
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
