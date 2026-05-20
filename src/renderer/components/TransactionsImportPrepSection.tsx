import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTransactionsImportPrepWizard } from '../hooks/useTransactionsImportPrepWizard';
import {
  buildDefaultColumnMapping,
  getPrepSourceCellDisplayValue,
  getSrcMappedFieldInputValue,
  isImportWizardSrcMappedFieldDirectRawMatch,
  outputFieldKeyForMappedSource,
  srcTransactionDataColumnTitle,
  WIZARD_STANDARD_KEYS,
  type ImportWizardColumn,
  type ImportWizardModel,
} from '../services/mappingWizardService';
import { getSuggestions } from '../services/SuggestInputService';
import { getUiMessageTone, uiMessageClass } from '../utils/uiMessageTone';

export type TransactionsImportPrepWizardProps = ReturnType<typeof useTransactionsImportPrepWizard>;

export type TransactionsImportPrepSectionProps = TransactionsImportPrepWizardProps & {
  /** Lignes de `src_transaction_data.csv` (suggestions fréquentielles pour la colonne TYPE). */
  sourceRowsForSuggestions?: Record<string, string>[];
  /** En-têtes du fichier traité (clé de colonne TYPE). */
  sourceHeadersForSuggestions?: string[];
};

/** Bordure continue gris → violet → vert → noir (tous les côtés) pour les colonnes src_transaction_data */
const SRC_MAPPED_BORDER_STYLE: React.CSSProperties = {
  borderWidth: 2,
  borderStyle: 'solid',
  borderImage: 'linear-gradient(135deg, #52525b, #7c3aed, #059669, #171717) 1',
};

function focusNextImportPrepCell(
  scrollRoot: HTMLElement | null,
  colKey: string,
  rowIndex: number,
  rowCount: number
) {
  if (!scrollRoot || rowIndex >= rowCount - 1) return;
  const next = scrollRoot.querySelector<HTMLElement>(
    `[data-import-prep-cell][data-prep-col="${CSS.escape(colKey)}"][data-prep-row="${rowIndex + 1}"]`
  );
  if (!next) return;
  next.focus();
  if (next instanceof HTMLInputElement && next.type === 'text') {
    requestAnimationFrame(() => next.select());
  }
}

function focusNextPrepInputInRow(target: HTMLElement) {
  setTimeout(() => {
    const td = target.closest('td');
    const nextControl = td?.nextElementSibling?.querySelector<HTMLInputElement | HTMLSelectElement>(
      'input, select'
    );
    nextControl?.focus();
  }, 0);
}

function findHeaderKeyForSuggestions(headers: string[], canonical: string): string | null {
  const c = canonical.trim();
  if (!c) return null;
  return headers.find((h) => h.toLowerCase() === c.toLowerCase()) ?? null;
}

/** En-têtes canoniques alignées sur `valueMap` d’aperçu (suggestions quand le mapping wizard est actif). */
const PREP_WIZARD_SUGGESTION_HEADERS = [
  'DATE',
  'TITLE',
  'AMOUNT',
  'CURRENCY',
  'ACCOUNT',
  'AMOUNT GBP',
  'TYPE',
  'EXPENSE',
  'INCOME',
] as const;

/** Suggestions fréquentielles : aperçu wizard si dispo, sinon fichier traité. */
function applyTabSuggestionFromRows(
  e: React.KeyboardEvent<HTMLInputElement>,
  raw: string,
  headerKey: string | null,
  sourceRows: Record<string, string>[],
  apply: (v: string) => void
): boolean {
  if (e.key !== 'Tab' || e.shiftKey) return false;
  if (!headerKey || sourceRows.length === 0) return false;
  const sugg = getSuggestions(sourceRows, headerKey, raw, 10);
  if (sugg.length === 0) return false;
  const first = sugg[0].value;
  if (raw.trim() === first) return false;
  e.preventDefault();
  apply(first);
  focusNextPrepInputInRow(e.currentTarget);
  return true;
}

/** Premières valeurs non vides d’une colonne (aperçu à côté du menu de mapping). */
function wizardColumnSamplePreview(
  model: ImportWizardModel,
  col: ImportWizardColumn,
  options?: { maxValues?: number; maxCellChars?: number; maxTotalChars?: number }
): string {
  const maxValues = options?.maxValues ?? 4;
  const maxCellChars = options?.maxCellChars ?? 20;
  const maxTotalChars = options?.maxTotalChars ?? 90;
  const parts: string[] = [];
  let extraNonEmpty = 0;
  for (const row of model.rows) {
    if (row.sourceFile !== col.fileName) continue;
    const raw = (row.values[col.colIndex] ?? '').trim();
    if (!raw) continue;
    if (parts.length < maxValues) {
      parts.push(raw.length > maxCellChars ? `${raw.slice(0, maxCellChars)}…` : raw);
    } else {
      extraNonEmpty += 1;
    }
  }
  if (parts.length === 0) return '—';
  let out = parts.join(' · ');
  if (extraNonEmpty > 0) out = `${out} …`;
  if (out.length > maxTotalChars) out = `${out.slice(0, maxTotalChars)}…`;
  return out;
}

/**
 * Tableau d’édition avant import (mapping colonnes, saisie). L’état est fourni par useTransactionsImportPrepWizard.
 */
const TransactionsImportPrepSection: React.FC<TransactionsImportPrepSectionProps> = (props) => {
  const {
    sourceRowsForSuggestions = [],
    sourceHeadersForSuggestions = [],
    importWizardModel,
    importWizardLoading,
    applyImportWizardClipboardPaste,
    diskImportFirstLineAsData,
    setDiskImportFirstLineAsData,
    mappingWizardActive,
    setMappingWizardActive,
    importColumnMapping,
    importColumnMappingUser,
    updateImportColumnMappingUser,
    importWizardCellOverrides,
    importMappedOutputOverrides,
    importRowSkip,
    setImportRowSkip,
    importWizardMessage,
    importWizardPreview,
    importWizardSuggestionRows,
    importPreviewRowStatusByRowId,
    importWizardSourceFileNames,
    importWizardRowIds,
    importPrepIgnSkipHeader,
    visiblePrepColDefs,
    prepStickyKey,
    prepIgnHeaderCheckboxRef,
    toggleImportPrepSkipAll,
    updateWizardManualCell,
    updateMappedOutputCell,
    updateImportPrepCell,
    importWizardManualCellValues,
  } = props;

  const prepTableScrollRef = useRef<HTMLDivElement>(null);
  const [clipboardDraft, setClipboardDraft] = useState('');
  const [pasteFirstLineAsData, setPasteFirstLineAsData] = useState(false);

  const defaultColumnMapping = useMemo(
    () => (importWizardModel ? buildDefaultColumnMapping(importWizardModel.columns) : {}),
    [importWizardModel]
  );

  const columnSamplePreviewByKey = useMemo(() => {
    const map = new Map<string, string>();
    if (!importWizardModel) return map;
    for (const col of importWizardModel.columns) {
      map.set(col.key, wizardColumnSamplePreview(importWizardModel, col));
    }
    return map;
  }, [importWizardModel]);

  const prepSuggestions = useCallback(
    (canonicalField: string, raw: string) => {
      const rows =
        mappingWizardActive && importWizardSuggestionRows.length > 0
          ? importWizardSuggestionRows
          : sourceRowsForSuggestions;
      const headers = mappingWizardActive
        ? (PREP_WIZARD_SUGGESTION_HEADERS as readonly string[])
        : sourceHeadersForSuggestions;
      const hk = findHeaderKeyForSuggestions([...headers], canonicalField);
      if (!hk || rows.length === 0) return [] as ReturnType<typeof getSuggestions>;
      return getSuggestions(rows, hk, raw, 10);
    },
    [
      mappingWizardActive,
      importWizardSuggestionRows,
      sourceRowsForSuggestions,
      sourceHeadersForSuggestions,
    ]
  );

  const handleImportPrepEnterNav = useCallback(
    (e: React.KeyboardEvent, colKey: string, rowIndex: number, rowCount: number) => {
      if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
      e.preventDefault();
      focusNextImportPrepCell(prepTableScrollRef.current, colKey, rowIndex, rowCount);
    },
    []
  );

  const prepNavDataProps = (colKey: string, rowIndex: number) =>
    ({
      'data-import-prep-cell': '',
      'data-prep-col': colKey,
      'data-prep-row': String(rowIndex),
    }) as const;

  const [dupStatusTooltip, setDupStatusTooltip] = useState<{
    text: string;
    anchorCenterX: number;
    top: number;
  } | null>(null);
  const dupTooltipElRef = useRef<HTMLDivElement>(null);
  const [dupTooltipClampedLeft, setDupTooltipClampedLeft] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!dupStatusTooltip) {
      setDupTooltipClampedLeft(null);
      return;
    }
    const el = dupTooltipElRef.current;
    const w = el?.offsetWidth ?? 0;
    if (!w) return;
    const margin = 8;
    const half = w / 2;
    const cx = dupStatusTooltip.anchorCenterX;
    setDupTooltipClampedLeft(
      Math.min(window.innerWidth - margin - half, Math.max(margin + half, cx))
    );
  }, [dupStatusTooltip]);

  const showDupStatusTooltip = useCallback((e: React.MouseEvent<HTMLElement>, messages: string[]) => {
    if (messages.length === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    setDupStatusTooltip({
      text: messages.join('\n\n'),
      anchorCenterX: r.left + r.width / 2,
      top: r.top - 6,
    });
  }, []);

  const hideDupStatusTooltip = useCallback(() => setDupStatusTooltip(null), []);

  return (
    <>
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Édition des données avant import</h2>
        <p className="text-xs text-gray-600 mb-2 max-w-3xl">
          Par défaut, seules les <strong className="font-semibold text-gray-800">données brutes</strong> des CSV du
          dossier Import sont affichées (aucun mapping). Activez le <strong className="font-semibold text-gray-800">mapping wizard</strong>{' '}
          pour appliquer les règles automatiques de colonnes et préparer l’import vers{' '}
          <code className="text-gray-800">src_transaction_data.csv</code>. Tous les champs de ce fichier sont alors
          visibles : ceux déduits du CSV apparaissent en colonnes éditables, les autres en saisie manuelle. La détection
          d’anomalies (règles métier + doublons + dates hors mois de référence du lot ou ordre non chronologique) → ⚠️ ambre ; champs manuels encore vides → panneau rouge « saisie recommandée » (import possible sans). Survolez la cellule de statut pour le détail (affichage immédiat).
        </p>
        <div className="mb-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2 max-w-3xl">
          <p className="text-xs font-medium text-gray-700 mb-1">Coller depuis un tableur</p>
          <p className="text-[11px] text-gray-500 mb-2">
            Copiez des cellules dans Excel, Numbers ou Google Sheets (séparateur tabulation), ou du texte CSV, puis
            collez ici. Les lignes sont ajoutées au lot en cours (en plus des fichiers du dossier Import).
          </p>
          <textarea
            value={clipboardDraft}
            onChange={(e) => setClipboardDraft(e.target.value)}
            spellCheck={false}
            rows={4}
            placeholder="Collez ici (Ctrl+V / Cmd+V)…"
            disabled={importWizardLoading}
            className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-xs font-mono text-gray-900 placeholder:text-gray-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
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
              disabled={importWizardLoading || !clipboardDraft.trim()}
              onClick={() => {
                applyImportWizardClipboardPaste(clipboardDraft, {
                  firstLineAsData: pasteFirstLineAsData,
                });
                setClipboardDraft('');
              }}
              className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-45"
            >
              Ajouter au tableau
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            type="button"
            role="switch"
            aria-checked={mappingWizardActive}
            onClick={() => setMappingWizardActive((v) => !v)}
            disabled={importWizardLoading || !importWizardModel?.rows.length}
            title={
              mappingWizardActive
                ? 'Désactiver : revenir à l’affichage des données brutes du dossier Import'
                : 'Activer : appliquer le mapping automatique et préparer l’import'
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
          <label className="inline-flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none max-w-xs">
            <input
              type="checkbox"
              checked={diskImportFirstLineAsData}
              onChange={(e) => setDiskImportFirstLineAsData(e.target.checked)}
              disabled={importWizardLoading}
              className="rounded border-gray-400"
            />
            CSV dossier Import : 1re ligne = donnée (relecture auto)
          </label>
        </div>
        {importWizardMessage && (
          <p
            className={`text-sm rounded border px-2 py-1 mb-2 ${uiMessageClass(
              getUiMessageTone(importWizardMessage)
            )}`}
          >
            {importWizardMessage}
          </p>
        )}
        {importWizardLoading && (
          <p className="text-sm text-gray-500 mb-2">Lecture des fichiers CSV dans Import…</p>
        )}
        {!importWizardLoading && !importWizardModel?.rows.length && (
          <p className="text-sm text-amber-800 rounded border border-amber-200 bg-amber-50 px-2 py-1">
            Aucune ligne à afficher : ajoutez des fichiers CSV dans le dossier Import, ou utilisez la zone « Coller
            depuis un tableur » ci-dessus.
          </p>
        )}
        {importWizardModel && importWizardModel.rows.length > 0 && (
          <div className="rounded border border-gray-200 bg-white overflow-hidden">
            <div className="px-2 py-1.5 bg-gray-100 text-xs font-medium text-gray-700">
              Préparation —{' '}
              <span className="font-semibold text-gray-900" title={importWizardSourceFileNames.join(', ')}>
                {importWizardSourceFileNames.join(', ')}
              </span>{' '}
              ({importWizardModel.rows.length} lignes)
              {mappingWizardActive
                ? ' — édition avec mapping (colonnes CSV brutes masquées) ; résultat final dans les colonnes src_transaction_data'
                : ' — données brutes (mapping wizard désactivé)'}
            </div>
            {mappingWizardActive && importWizardModel.columns.length > 0 && (
              <div className="px-2 py-2 border-b border-indigo-100 bg-indigo-50/50 text-xs text-gray-800">
                <p className="font-semibold text-gray-900 mb-0.5">Attribution des colonnes sources</p>
                <p className="text-[11px] text-gray-600 mb-2">
                  « Auto » = inférence à partir des données. Numéro = position de colonne dans le fichier ; à droite,
                  premières valeurs non vides (aperçu).
                </p>
                <div className="max-h-40 overflow-y-auto space-y-1.5 pr-1">
                  {importWizardModel.columns.map((col) => {
                    const inferred = defaultColumnMapping[col.key] ?? '';
                    const userRaw = importColumnMappingUser[col.key];
                    const selectVal = userRaw === undefined ? '__AUTO__' : userRaw === '' ? '' : userRaw;
                    const sample = columnSamplePreviewByKey.get(col.key) ?? '—';
                    const colNo = col.colIndex + 1;
                    return (
                      <div
                        key={col.key}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1"
                        title={`Fichier source : ${col.fileName}`}
                      >
                        <span className="w-10 shrink-0 font-mono text-[11px] font-semibold text-gray-700">
                          {colNo}
                        </span>
                        <select
                          className="min-w-[10rem] shrink-0 rounded border border-gray-300 bg-white px-1 py-0.5 text-[11px]"
                          value={selectVal}
                          onChange={(e) => updateImportColumnMappingUser(col.key, e.target.value)}
                          aria-label={`Mapping colonne ${colNo}`}
                        >
                          <option value="__AUTO__">Auto ({inferred || '—'})</option>
                          <option value="">Ignorer</option>
                          {WIZARD_STANDARD_KEYS.filter((k) => k !== '').map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        <span className="min-w-0 flex-1 text-[11px] leading-snug text-gray-600 break-words">
                          {sample}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            <div
              ref={prepTableScrollRef}
              className="overflow-x-auto max-h-[min(420px,50vh)] overflow-y-auto"
            >
                <table className="min-w-0 w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-left text-gray-600">
                      {visiblePrepColDefs.map((def) => {
                        const sourceMapped =
                          def.kind === 'source' && !!(importColumnMapping[def.col.key] ?? '');
                        const isSticky = def.key === prepStickyKey;
                        let stickyTh = '';
                        if (def.kind === 'wizard') {
                          stickyTh = isSticky
                            ? 'sticky left-0 z-[2] bg-indigo-100 shadow-[2px_0_0_0_rgb(165,180,252)]'
                            : 'bg-indigo-100';
                        } else if (def.kind === 'source') {
                          stickyTh = isSticky
                            ? sourceMapped
                              ? 'sticky left-0 z-[2] bg-slate-100 shadow-[2px_0_0_0_rgb(226,232,240)]'
                              : 'sticky left-0 z-[2] bg-slate-50 shadow-[2px_0_0_0_rgb(229,231,235)]'
                            : sourceMapped
                              ? 'bg-slate-100'
                              : 'bg-slate-50';
                        } else if (def.kind === 'srcMappedField') {
                          stickyTh = isSticky
                            ? 'sticky left-0 z-[2] bg-slate-50 shadow-[2px_0_0_0_rgb(229,231,235)]'
                            : 'bg-slate-50';
                        } else if (isSticky) {
                          stickyTh = 'sticky left-0 z-[2] bg-gray-50 shadow-[2px_0_0_0_rgb(229,231,235)]';
                        }
                        const thBase =
                          def.kind === 'source'
                            ? `px-0.5 py-1 align-top border-l min-w-[7.5rem] max-w-[10rem] ${sourceMapped ? 'border-slate-300' : 'border-gray-200'} ${stickyTh}`
                            : def.kind === 'wizard'
                              ? `px-0.5 py-1 align-top border-l border-indigo-200 min-w-[7.5rem] max-w-[10rem] ${stickyTh}`
                              : def.kind === 'srcMappedField'
                                ? `px-0.5 py-1 align-top min-w-[6.5rem] max-w-[9rem] ${stickyTh}`
                                : def.kind === 'line'
                                  ? `w-8 min-w-[1.75rem] max-w-[2.5rem] px-0 py-1 align-top ${stickyTh}`
                                  : def.kind === 'dup'
                                    ? `w-8 min-w-[2rem] max-w-[2.5rem] px-0 py-1 align-top text-center ${stickyTh}`
                                    : `px-1 py-1 ${stickyTh}`;
                        const thAria =
                          def.kind === 'line'
                            ? 'Ligne dans le fichier source'
                            : def.kind === 'dup'
                              ? 'Alertes et statut de la ligne'
                              : undefined;
                        return (
                          <th
                            key={def.key}
                            className={thBase}
                            aria-label={thAria}
                            style={def.kind === 'srcMappedField' ? SRC_MAPPED_BORDER_STYLE : undefined}
                          >
                            {def.kind === 'line' || def.kind === 'dup' ? null : (
                              <div className="min-w-0">
                                {def.kind === 'ign' && (
                                  <div className="flex items-center gap-1">
                                    <input
                                      ref={prepIgnHeaderCheckboxRef}
                                      id="prep-ign-header-cb"
                                      type="checkbox"
                                      checked={importPrepIgnSkipHeader.allSkipped}
                                      disabled={importWizardRowIds.length === 0}
                                      onChange={toggleImportPrepSkipAll}
                                      aria-label="Tout ignorer ou tout rétablir les lignes"
                                    />
                                    <label htmlFor="prep-ign-header-cb" className="cursor-pointer select-none text-gray-800">
                                      Ign.
                                    </label>
                                  </div>
                                )}
                                {def.kind === 'wizard' && (
                                  <>
                                    <span className="font-mono text-[11px] font-semibold text-indigo-950">
                                      {def.field}
                                    </span>
                                    <div className="mt-0.5 text-[10px] leading-tight text-indigo-600">
                                      Mapping wizard
                                      <br />
                                      <span className="text-indigo-900">Saisie manuelle</span>
                                    </div>
                                  </>
                                )}
                                {def.kind === 'srcMappedField' && (
                                  <div className="font-mono text-[11px] font-semibold bg-gradient-to-r from-violet-600 via-fuchsia-600 to-emerald-600 bg-clip-text text-transparent">
                                    {srcTransactionDataColumnTitle(def.mappedAs)}
                                  </div>
                                )}
                                {def.kind === 'source' && (
                                  <div
                                    className={`text-[10px] leading-tight truncate font-medium ${
                                      mappingWizardActive ? 'text-slate-700' : 'text-gray-800'
                                    }`}
                                    title={def.col.label}
                                  >
                                    {def.col.label}
                                  </div>
                                )}
                              </div>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {mappingWizardActive && importWizardPreview
                      ? importWizardPreview.list.map((p, rowIndex) => {
                          const skipped = importRowSkip.has(p.row.id);
                          const rowCount = importWizardPreview.list.length;
                          const prepSugRows =
                            importWizardSuggestionRows.length > 0
                              ? importWizardSuggestionRows
                              : sourceRowsForSuggestions;
                          const prepSugHeaders =
                            importWizardSuggestionRows.length > 0
                              ? [...PREP_WIZARD_SUGGESTION_HEADERS]
                              : sourceHeadersForSuggestions;
                          const rowStatus = importPreviewRowStatusByRowId.get(p.row.id);
                          const statusMessages = rowStatus?.messages ?? [];
                          const pendingManualRecommended = rowStatus?.pendingManualRecommended ?? false;
                          const hasAmberAside = rowStatus?.hasAmberAside ?? false;
                          return (
                            <tr
                              key={p.row.id}
                              className={`border-b border-gray-100 ${skipped ? 'opacity-50' : ''}`}
                            >
                              {visiblePrepColDefs.map((def) => {
                                const sourceMapped =
                                  def.kind === 'source' && !!(importColumnMapping[def.col.key] ?? '');
                                const isSticky = def.key === prepStickyKey;
                                let stickyTd = '';
                                if (def.kind === 'wizard') {
                                  stickyTd = isSticky
                                    ? 'sticky left-0 z-[1] bg-indigo-50/95 shadow-[2px_0_0_0_rgb(199,210,254)]'
                                    : 'bg-indigo-50/80';
                                } else if (def.kind === 'source') {
                                  stickyTd = isSticky
                                    ? sourceMapped
                                      ? 'sticky left-0 z-[1] bg-slate-50/95 shadow-[2px_0_0_0_rgb(226,232,240)]'
                                      : 'sticky left-0 z-[1] bg-slate-50/40 shadow-[2px_0_0_0_rgb(243,244,246)]'
                                    : sourceMapped
                                      ? 'bg-slate-50/90'
                                      : 'bg-slate-50/40';
                                } else if (def.kind === 'srcMappedField') {
                                  stickyTd = isSticky
                                    ? 'sticky left-0 z-[1] bg-slate-50/95 shadow-[2px_0_0_0_rgb(229,231,235)]'
                                    : 'bg-slate-50/90';
                                } else if (isSticky) {
                                  stickyTd = 'sticky left-0 z-[1] bg-white shadow-[2px_0_0_0_rgb(243,244,246)]';
                                }
                                const tdBase =
                                  def.kind === 'source'
                                    ? `px-0.5 py-0.5 align-top border-l text-[11px] max-w-[10rem] break-words ${sourceMapped ? 'border-slate-200/90 text-slate-900' : 'border-gray-100 text-gray-700'} ${stickyTd}`
                                    : def.kind === 'wizard'
                                      ? `px-0.5 py-0.5 align-top border-l border-indigo-100/90 text-[11px] max-w-[10rem] break-words text-indigo-950 ${stickyTd}`
                                      : def.kind === 'srcMappedField'
                                        ? `px-0.5 py-0.5 align-top text-[11px] max-w-[9rem] break-words text-slate-700 ${stickyTd}`
                                        : def.kind === 'line'
                                          ? `px-0.5 py-0.5 align-top w-8 min-w-[1.75rem] max-w-[2.5rem] text-right tabular-nums text-[11px] text-gray-600 ${stickyTd}`
                                          : def.kind === 'dup'
                                            ? `px-0.5 py-0.5 align-top min-w-[7rem] max-w-[9rem] text-center ${stickyTd}`
                                            : `px-1 py-0.5 ${stickyTd}`;
                                return (
                                  <td
                                    key={def.key}
                                    className={`${tdBase}${
                                      def.kind === 'dup' && statusMessages.length > 0 ? ' cursor-help' : ''
                                    }`}
                                    style={def.kind === 'srcMappedField' ? SRC_MAPPED_BORDER_STYLE : undefined}
                                    onMouseEnter={
                                      def.kind === 'dup' && statusMessages.length > 0
                                        ? (e) => showDupStatusTooltip(e, statusMessages)
                                        : undefined
                                    }
                                    onMouseLeave={
                                      def.kind === 'dup' ? hideDupStatusTooltip : undefined
                                    }
                                  >
                                    {def.kind === 'ign' && (
                                      <input
                                        type="checkbox"
                                        checked={skipped}
                                        {...prepNavDataProps(def.key, rowIndex)}
                                        onKeyDown={(e) =>
                                          handleImportPrepEnterNav(e, def.key, rowIndex, rowCount)
                                        }
                                        onChange={() => {
                                          setImportRowSkip((prev) => {
                                            const n = new Set(prev);
                                            if (n.has(p.row.id)) n.delete(p.row.id);
                                            else n.add(p.row.id);
                                            return n;
                                          });
                                        }}
                                        aria-label="Ignorer cette ligne"
                                      />
                                    )}
                                    {def.kind === 'line' && (
                                      <span className="text-gray-600">{p.row.lineNumber}</span>
                                    )}
                                    {def.kind === 'dup' && (
                                      <div className="flex flex-col items-stretch gap-1">
                                        {pendingManualRecommended && (
                                          <div
                                            className="rounded-md border-2 border-red-600 bg-red-100 px-1.5 py-1 text-center shadow-sm"
                                            role="status"
                                            aria-label="Saisie manuelle recommandée (import possible sans)"
                                          >
                                            <span className="block text-[9px] font-bold uppercase tracking-wide text-red-950">
                                              Saisie manuelle
                                            </span>
                                            <span className="mt-0.5 block text-[8px] font-semibold leading-tight text-red-900">
                                              recommandée
                                            </span>
                                            <span className="mt-0.5 block text-[7px] leading-tight text-red-800/95">
                                              import possible
                                            </span>
                                          </div>
                                        )}
                                        {hasAmberAside && (
                                          <span
                                            className="inline-flex items-center justify-center text-lg leading-none text-amber-500"
                                            role="img"
                                            aria-label={statusMessages.join(' · ')}
                                          >
                                            ⚠️
                                          </span>
                                        )}
                                        {!pendingManualRecommended && !hasAmberAside && (
                                          <span className="text-gray-400">—</span>
                                        )}
                                      </div>
                                    )}
                                    {def.kind === 'wizard' &&
                                      (def.field === 'CURRENCY' ? (
                                        <select
                                          value={importWizardManualCellValues[p.row.id]?.CURRENCY ?? ''}
                                          {...prepNavDataProps(def.key, rowIndex)}
                                          onKeyDown={(e) =>
                                            handleImportPrepEnterNav(e, def.key, rowIndex, rowCount)
                                          }
                                          onChange={(e) =>
                                            updateWizardManualCell(p.row.id, 'CURRENCY', e.target.value)
                                          }
                                          className="w-full min-w-0 max-w-full rounded border border-indigo-200/90 bg-indigo-50/90 px-0.5 py-0.5 text-[11px] text-indigo-950"
                                          aria-label="CURRENCY (Mapping wizard)"
                                        >
                                          <option value="">— Auto (€/£/CHF dans AMOUNT)</option>
                                          <option value="EUR">EUR</option>
                                          <option value="GBP">GBP</option>
                                          <option value="CHF">CHF</option>
                                        </select>
                                      ) : def.field === 'TYPE' ? (() => {
                                        const raw =
                                          importWizardManualCellValues[p.row.id]?.[def.field] ?? '';
                                        const typeSuggestions = prepSuggestions('TYPE', raw);
                                        const typeHeaderKey = findHeaderKeyForSuggestions(
                                          prepSugHeaders,
                                          'TYPE'
                                        );
                                        const typeListId = `prep-wiz-type-${p.row.id}`;
                                        return (
                                          <>
                                            <input
                                              type="text"
                                              value={raw}
                                              {...prepNavDataProps(def.key, rowIndex)}
                                              list={
                                                typeSuggestions.length > 0 ? typeListId : undefined
                                              }
                                              onKeyDown={(e) => {
                                                if (
                                                  applyTabSuggestionFromRows(
                                                    e,
                                                    raw,
                                                    typeHeaderKey,
                                                    prepSugRows,
                                                    (v) =>
                                                      updateWizardManualCell(p.row.id, def.field, v)
                                                  )
                                                )
                                                  return;
                                                handleImportPrepEnterNav(
                                                  e,
                                                  def.key,
                                                  rowIndex,
                                                  rowCount
                                                );
                                              }}
                                              onChange={(e) =>
                                                updateWizardManualCell(
                                                  p.row.id,
                                                  def.field,
                                                  e.target.value
                                                )
                                              }
                                              className="w-full min-w-0 max-w-full rounded border border-indigo-200/90 bg-indigo-50/90 px-0.5 py-0.5 text-[11px] text-indigo-950 shadow-none outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400/45"
                                              aria-label={`${def.field} (Mapping wizard)`}
                                            />
                                            {typeSuggestions.length > 0 && (
                                              <datalist id={typeListId}>
                                                {typeSuggestions.map((s) => (
                                                  <option key={`${s.value}-${s.count}`} value={s.value} />
                                                ))}
                                              </datalist>
                                            )}
                                          </>
                                        );
                                      })() : ['DATE', 'TITLE', 'AMOUNT', 'ACCOUNT'].includes(def.field) ? (() => {
                                        const raw =
                                          importWizardManualCellValues[p.row.id]?.[def.field] ?? '';
                                        const suggestions = prepSuggestions(def.field, raw);
                                        const hk = findHeaderKeyForSuggestions(prepSugHeaders, def.field);
                                        const listId = `prep-wiz-${def.field}-${p.row.id}`;
                                        return (
                                          <>
                                            <input
                                              type="text"
                                              value={raw}
                                              {...prepNavDataProps(def.key, rowIndex)}
                                              list={suggestions.length > 0 ? listId : undefined}
                                              onKeyDown={(e) => {
                                                if (
                                                  applyTabSuggestionFromRows(
                                                    e,
                                                    raw,
                                                    hk,
                                                    prepSugRows,
                                                    (v) =>
                                                      updateWizardManualCell(p.row.id, def.field, v)
                                                  )
                                                )
                                                  return;
                                                handleImportPrepEnterNav(
                                                  e,
                                                  def.key,
                                                  rowIndex,
                                                  rowCount
                                                );
                                              }}
                                              onChange={(e) =>
                                                updateWizardManualCell(
                                                  p.row.id,
                                                  def.field,
                                                  e.target.value
                                                )
                                              }
                                              className="w-full min-w-0 max-w-full rounded border border-indigo-200/90 bg-indigo-50/90 px-0.5 py-0.5 text-[11px] text-indigo-950 shadow-none outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400/45"
                                              aria-label={`${def.field} (Mapping wizard)`}
                                            />
                                            {suggestions.length > 0 && (
                                              <datalist id={listId}>
                                                {suggestions.map((s) => (
                                                  <option key={`${s.value}-${s.count}`} value={s.value} />
                                                ))}
                                              </datalist>
                                            )}
                                          </>
                                        );
                                      })() : (
                                        <input
                                          type="text"
                                          value={importWizardManualCellValues[p.row.id]?.[def.field] ?? ''}
                                          {...prepNavDataProps(def.key, rowIndex)}
                                          onKeyDown={(e) =>
                                            handleImportPrepEnterNav(e, def.key, rowIndex, rowCount)
                                          }
                                          onChange={(e) =>
                                            updateWizardManualCell(p.row.id, def.field, e.target.value)
                                          }
                                          className="w-full min-w-0 max-w-full rounded border border-indigo-200/90 bg-indigo-50/90 px-0.5 py-0.5 text-[11px] text-indigo-950 shadow-none outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400/45"
                                          aria-label={`${def.field} (Mapping wizard)`}
                                        />
                                      )
                                    )}
                                    {def.kind === 'srcMappedField' && (() => {
                                      const outKey = outputFieldKeyForMappedSource(def.mappedAs);
                                      const rawMapped = getSrcMappedFieldInputValue(
                                        p.row.id,
                                        def.mappedAs,
                                        p,
                                        importMappedOutputOverrides
                                      );
                                      const directRaw =
                                        importWizardModel?.columns &&
                                        isImportWizardSrcMappedFieldDirectRawMatch(
                                          p,
                                          def,
                                          importWizardModel.columns,
                                          importColumnMapping,
                                          rawMapped.trim()
                                        );
                                      const suggestCanonical =
                                        outKey &&
                                        ['DATE', 'TITLE', 'TYPE', 'ACCOUNT', 'AMOUNT', 'CURRENCY'].includes(
                                          outKey
                                        )
                                          ? outKey
                                          : null;
                                      const mappedHeaderKey = suggestCanonical
                                        ? findHeaderKeyForSuggestions(prepSugHeaders, suggestCanonical) ??
                                          suggestCanonical
                                        : null;
                                      const mappedSuggestions =
                                        mappedHeaderKey && prepSugRows.length > 0
                                          ? getSuggestions(prepSugRows, mappedHeaderKey, rawMapped, 10)
                                          : [];
                                      const mappedListId = `prep-map-${outKey ?? 'x'}-${p.row.id}-${def.key}`;
                                      return (
                                        <div className="flex items-center gap-0.5 min-w-0 w-full">
                                          <input
                                            type="text"
                                            value={rawMapped}
                                            {...prepNavDataProps(def.key, rowIndex)}
                                            list={
                                              mappedSuggestions.length > 0 ? mappedListId : undefined
                                            }
                                            onKeyDown={(e) => {
                                              if (
                                                mappedHeaderKey &&
                                                applyTabSuggestionFromRows(
                                                  e,
                                                  rawMapped,
                                                  mappedHeaderKey,
                                                  prepSugRows,
                                                  (v) =>
                                                    updateMappedOutputCell(p.row.id, def.mappedAs, v)
                                                )
                                              )
                                                return;
                                              handleImportPrepEnterNav(
                                                e,
                                                def.key,
                                                rowIndex,
                                                rowCount
                                              );
                                            }}
                                            onChange={(e) =>
                                              updateMappedOutputCell(p.row.id, def.mappedAs, e.target.value)
                                            }
                                            className="min-w-0 flex-1 max-w-full rounded border border-slate-300/80 bg-white/95 px-0.5 py-0.5 text-[11px] text-slate-800 shadow-none outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-400/40"
                                            title={rawMapped}
                                            aria-label={srcTransactionDataColumnTitle(def.mappedAs)}
                                          />
                                          {mappedSuggestions.length > 0 && (
                                            <datalist id={mappedListId}>
                                              {mappedSuggestions.map((s) => (
                                                <option key={`${s.value}-${s.count}`} value={s.value} />
                                              ))}
                                            </datalist>
                                          )}
                                          {directRaw ? (
                                            <span
                                              className="shrink-0 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-gray-200 px-1 text-[9px] font-bold leading-none text-gray-600"
                                              title="Valeur identique à la cellule du fichier brut (sans interprétation)"
                                              aria-hidden
                                            >
                                              =
                                            </span>
                                          ) : null}
                                        </div>
                                      );
                                    })()}
                                    {def.kind === 'source' &&
                                      (def.col.fileName === p.row.sourceFile ? (
                                        <span
                                          className={
                                            sourceMapped
                                              ? 'block w-full min-w-0 max-w-full rounded border border-slate-300/90 bg-slate-100/70 px-0.5 py-0.5 text-[11px] text-slate-900'
                                              : 'block w-full min-w-0 max-w-full rounded border border-transparent bg-slate-50/80 px-0.5 py-0.5 text-[11px] text-gray-700'
                                          }
                                          title={def.col.label}
                                        >
                                          {p.row.values[def.col.colIndex] ?? ''}
                                        </span>
                                      ) : (
                                        <span className="text-gray-300"> </span>
                                      ))}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })
                      : importWizardModel.rows.map((row, rowIndex) => {
                          const rawRowCount = importWizardModel.rows.length;
                          return (
                          <tr key={row.id} className="border-b border-gray-100">
                            {visiblePrepColDefs.map((def) => {
                              const isSticky = def.key === prepStickyKey;
                              const stickyTd =
                                def.kind === 'source'
                                  ? isSticky
                                    ? 'sticky left-0 z-[1] bg-slate-50/40 shadow-[2px_0_0_0_rgb(243,244,246)]'
                                    : 'bg-slate-50/40'
                                  : '';
                              const tdBase =
                                def.kind === 'source'
                                  ? `px-0.5 py-0.5 align-top border-l text-[11px] max-w-[10rem] break-words border-gray-100 text-gray-700 ${stickyTd}`
                                  : `px-1 py-0.5 ${stickyTd}`;
                              return (
                                <td key={def.key} className={tdBase}>
                                  {def.kind === 'source' &&
                                    (def.col.fileName === row.sourceFile ? (
                                      <input
                                        type="text"
                                        value={getPrepSourceCellDisplayValue(
                                          row,
                                          def.col,
                                          importWizardCellOverrides
                                        )}
                                        {...prepNavDataProps(def.key, rowIndex)}
                                        onKeyDown={(e) =>
                                          handleImportPrepEnterNav(e, def.key, rowIndex, rawRowCount)
                                        }
                                        onChange={(e) =>
                                          updateImportPrepCell(row.id, def.col.key, e.target.value)
                                        }
                                        className="w-full min-w-0 max-w-full rounded border border-transparent bg-white/90 px-0.5 py-0.5 text-[11px] text-gray-800 shadow-none outline-none hover:border-gray-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-400/40"
                                        title={def.col.label}
                                        aria-label={def.col.label}
                                      />
                                    ) : (
                                      <span className="text-gray-300"> </span>
                                    ))}
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
      {dupStatusTooltip &&
        createPortal(
          <div
            ref={dupTooltipElRef}
            role="tooltip"
            className="pointer-events-none fixed z-[9999] max-w-md rounded-md border border-slate-600 bg-slate-900 px-2.5 py-2 text-left text-[11px] leading-snug text-slate-50 shadow-xl whitespace-pre-wrap"
            style={{
              left: dupTooltipClampedLeft ?? dupStatusTooltip.anchorCenterX,
              top: dupStatusTooltip.top,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {dupStatusTooltip.text}
          </div>,
          document.body
        )}
    </>
  );
};

export default TransactionsImportPrepSection;
