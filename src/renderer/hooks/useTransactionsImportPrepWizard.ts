import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  loadImportWizardModel,
  buildImportWizardModelFromClipboardText,
  mergeImportWizardModels,
  buildDefaultColumnMapping,
  computeTransactionsImportWizardPreview,
  computeImportWizardDateCoherenceWarnings,
  getUncoveredManualFieldsRecommendedToFill,
  buildPrepTableColDefs,
  buildPrepTableColDefsRaw,
  filterImportPreviewImportableRows,
  parseAmountNumericForImport,
  resolveImportFiatEffective,
  outputFieldKeyForMappedSource,
  getPipelineSrcMappedFieldDisplay,
  type ImportWizardParseOptions,
  type WizardStandardKey,
  type ImportWizardModel,
  type ImportWizardResultField,
  type PrepTableColDef,
} from '../services/mappingWizardService';
import { detectAnomalies, EXCLUDE_ANOMALY_COLUMN } from '../services/AnomalyDetectionService';
import type { ValidRow } from '@/shared/transactionsImportCore';

export type { ImportWizardResultField, PrepTableColDef };

export function useTransactionsImportPrepWizard(options: {
  existingTransactionSignatures: Set<string>;
  onAfterSuccessfulAppend?: () => void;
  /** Incrémenter depuis la page (ex. après vidage du dossier Import) pour forcer un rechargement du wizard. */
  folderReloadToken?: number;
}) {
  const { existingTransactionSignatures, onAfterSuccessfulAppend, folderReloadToken = 0 } = options;

  const [importWizardModel, setImportWizardModel] = useState<ImportWizardModel | null>(null);
  const [importWizardLoading, setImportWizardLoading] = useState(false);
  const [importWizardReloadKey, setImportWizardReloadKey] = useState(0);
  const [importRowSkip, setImportRowSkip] = useState<Set<string>>(() => new Set());
  const [importWizardCellOverrides, setImportWizardCellOverrides] = useState<
    Record<string, Record<string, string>>
  >({});
  const [importLinesLoading, setImportLinesLoading] = useState(false);
  const [importWizardMessage, setImportWizardMessage] = useState<string | null>(null);
  const [importWizardManualCellValues, setImportWizardManualCellValues] = useState<
    Record<string, Partial<Record<ImportWizardResultField, string>>>
  >({});
  const [importMappedOutputOverrides, setImportMappedOutputOverrides] = useState<
    Record<string, Partial<Record<ImportWizardResultField, string>>>
  >({});
  /** Surcharges du mapping colonne → champ standard (clé colonne wizard). Absence de clé = auto (inféré). */
  const [importColumnMappingUser, setImportColumnMappingUser] = useState<
    Record<string, WizardStandardKey>
  >({});
  /** Fichiers CSV dossier Import : traiter la 1re ligne comme donnée (pas en-tête). */
  const [diskImportFirstLineAsData, setDiskImportFirstLineAsData] = useState(false);
  /** Désactivé par défaut : affichage des données brutes sans mapping automatique. */
  const [mappingWizardActive, setMappingWizardActive] = useState(false);

  const loadImportWizard = useCallback(async () => {
    const api = (
      window as unknown as {
        electronAPI?: {
          readDirectory: (p: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;
          readFile: (p: string) => Promise<{ success: boolean; data?: string; error?: string }>;
        };
      }
    ).electronAPI;
    if (!api?.readDirectory || !api?.readFile) {
      setImportWizardModel(null);
      setImportColumnMappingUser({});
      return;
    }
    setImportWizardLoading(true);
    try {
      const parseOpts: ImportWizardParseOptions | undefined = diskImportFirstLineAsData
        ? { firstLineAsData: true }
        : undefined;
      const model = await loadImportWizardModel(api, parseOpts);
      setImportWizardModel(model);
      if (model) {
        setImportRowSkip(new Set());
        setImportWizardCellOverrides({});
        setImportWizardManualCellValues({});
        setImportMappedOutputOverrides({});
        setImportColumnMappingUser({});
      } else {
        setImportColumnMappingUser({});
      }
    } finally {
      setImportWizardLoading(false);
    }
  }, [diskImportFirstLineAsData]);

  useEffect(() => {
    void loadImportWizard();
  }, [loadImportWizard, importWizardReloadKey, folderReloadToken, diskImportFirstLineAsData]);

  const importColumnMapping = useMemo((): Record<string, WizardStandardKey> => {
    if (!importWizardModel || !mappingWizardActive) return {};
    const defaults = buildDefaultColumnMapping(importWizardModel.columns);
    const out: Record<string, WizardStandardKey> = { ...defaults };
    for (const [k, v] of Object.entries(importColumnMappingUser)) {
      if (v === ('' as WizardStandardKey)) delete out[k];
      else out[k] = v;
    }
    return out;
  }, [importWizardModel, mappingWizardActive, importColumnMappingUser]);

  const importWizardPreview = useMemo(
    () =>
      importWizardModel && mappingWizardActive
        ? computeTransactionsImportWizardPreview({
            model: importWizardModel,
            importColumnMapping,
            existingTransactionSignatures,
            importWizardCellOverrides,
            importWizardManualCellValues,
            importMappedOutputOverrides,
          })
        : null,
    [
      importWizardModel,
      mappingWizardActive,
      importColumnMapping,
      existingTransactionSignatures,
      importWizardCellOverrides,
      importWizardManualCellValues,
      importMappedOutputOverrides,
    ]
  );

  /** Messages de statut par ligne (validation, anomalies détectées, doublon vs fichier traité). */
  const importPreviewRowStatusByRowId = useMemo(() => {
    const empty = new Map<
      string,
      { messages: string[]; pendingManualRecommended: boolean; hasAmberAside: boolean }
    >();
    if (!importWizardPreview?.list.length || !importWizardModel) return empty;
    const list = importWizardPreview.list;
    const uncoveredRecommendedManual = getUncoveredManualFieldsRecommendedToFill(
      importWizardModel.columns,
      importColumnMapping
    );
    const validRows: Record<string, string>[] = [];
    const rowIdAtValidIndex: string[] = [];
    for (const p of list) {
      if ('valid' in p.processed) {
        const vr = p.processed.valid;
        validRows.push({
          DATE: vr.DATE ?? '',
          TITLE: vr.TITLE ?? '',
          AMOUNT: vr.AMOUNT ?? '',
          CURRENCY: vr.CURRENCY ?? '',
          ACCOUNT: vr.ACCOUNT ?? '',
          'AMOUNT GBP': vr['AMOUNT GBP'] ?? '',
          TYPE: vr.TYPE ?? '',
          [EXCLUDE_ANOMALY_COLUMN]: '',
        });
        rowIdAtValidIndex.push(p.row.id);
      }
    }
    const anomalyReasonsByRowId = new Map<string, string[]>();
    if (validRows.length > 0) {
      const headers = [
        'DATE',
        'TITLE',
        'AMOUNT',
        'CURRENCY',
        'ACCOUNT',
        'AMOUNT GBP',
        'TYPE',
        EXCLUDE_ANOMALY_COLUMN,
      ];
      const { anomalies } = detectAnomalies({ headers, rows: validRows });
      for (const a of anomalies) {
        const idx = a.rowIndex - 1;
        const id = rowIdAtValidIndex[idx];
        if (id) anomalyReasonsByRowId.set(id, [...a.reasons]);
      }
    }
    const dateCoherenceByRowId = computeImportWizardDateCoherenceWarnings(list);
    const map = new Map<
      string,
      { messages: string[]; pendingManualRecommended: boolean; hasAmberAside: boolean }
    >();
    const dupMsg = 'Doublon (ligne déjà présente dans src_transaction_data.csv)';
    for (const p of list) {
      const aside: string[] = [];
      if ('anomaly' in p.processed) {
        aside.push(p.processed.anomaly.reason);
      }
      const ar = anomalyReasonsByRowId.get(p.row.id);
      if (ar?.length) aside.push(...ar);
      const dateMsgs = dateCoherenceByRowId.get(p.row.id);
      if (dateMsgs?.length) aside.push(...dateMsgs);
      if (p.duplicateExisting) aside.push(dupMsg);
      const missingManual = uncoveredRecommendedManual.filter((f) => !(p.valueMap[f] ?? '').trim());
      const pendingManualRecommended = missingManual.length > 0;
      const manualLine = pendingManualRecommended
        ? `Saisie manuelle recommandée : ${missingManual.join(', ')}. Vous pouvez importer quand même et compléter plus tard dans src_transaction_data.csv.`
        : null;
      const messages = manualLine ? [manualLine, ...aside] : aside;
      map.set(p.row.id, {
        messages,
        pendingManualRecommended,
        hasAmberAside: aside.length > 0,
      });
    }
    return map;
  },     [importWizardPreview, importWizardModel, importColumnMapping]);

  /** Lignes dérivées de l’aperçu mapping (suggestions fréquentielles pendant le wizard). */
  const importWizardSuggestionRows = useMemo((): Record<string, string>[] => {
    if (!mappingWizardActive || !importWizardPreview?.list.length) return [];
    return importWizardPreview.list.map((p) => ({ ...p.valueMap }));
  }, [mappingWizardActive, importWizardPreview]);

  const importWizardSourceFileNames = useMemo(() => {
    if (!importWizardModel?.rows.length) return [] as string[];
    return [...new Set(importWizardModel.rows.map((r) => r.sourceFile))];
  }, [importWizardModel]);

  const importWizardRowIds = useMemo(
    () => importWizardModel?.rows.map((r) => r.id) ?? [],
    [importWizardModel]
  );

  const importPrepIgnSkipHeader = useMemo(() => {
    const ids = importWizardRowIds;
    if (ids.length === 0) return { allSkipped: false, someSkipped: false };
    let skipped = 0;
    for (const id of ids) {
      if (importRowSkip.has(id)) skipped += 1;
    }
    return { allSkipped: skipped === ids.length, someSkipped: skipped > 0 };
  }, [importWizardRowIds, importRowSkip]);

  const prepTableColDefs = useMemo(
    () =>
      mappingWizardActive
        ? buildPrepTableColDefs({
            columns: importWizardModel?.columns,
            importColumnMapping,
          })
        : buildPrepTableColDefsRaw({ columns: importWizardModel?.columns }),
    [mappingWizardActive, importWizardModel, importColumnMapping]
  );

  /** En mode mapping wizard, les colonnes CSV brutes ne sont pas affichées (Ign., ligne, alertes, champs manuels, colonnes mappées vers src). */
  const visiblePrepColDefs = useMemo(() => {
    if (!mappingWizardActive) return prepTableColDefs;
    return prepTableColDefs.filter((d) => d.kind !== 'source');
  }, [prepTableColDefs, mappingWizardActive]);
  const prepStickyKey = visiblePrepColDefs[0]?.key;

  const prepIgnHeaderCheckboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = prepIgnHeaderCheckboxRef.current;
    if (!el) return;
    el.indeterminate =
      importPrepIgnSkipHeader.someSkipped && !importPrepIgnSkipHeader.allSkipped;
  }, [importPrepIgnSkipHeader]);

  const toggleImportPrepSkipAll = useCallback(() => {
    setImportRowSkip((prev) => {
      const ids = importWizardModel?.rows.map((r) => r.id) ?? [];
      if (ids.length === 0) return prev;
      const all = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (all) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }, [importWizardModel?.rows]);

  const updateImportColumnMappingUser = useCallback((colKey: string, value: string) => {
    setImportColumnMappingUser((prev) => {
      const next = { ...prev };
      if (value === '__AUTO__') {
        delete next[colKey];
      } else {
        next[colKey] = value as WizardStandardKey;
      }
      return Object.keys(next).length === 0 ? {} : next;
    });
  }, []);

  const updateMappedOutputCell = useCallback(
    (rowId: string, mappedAs: WizardStandardKey, value: string) => {
      const field = outputFieldKeyForMappedSource(mappedAs);
      if (!field) return;
      const resultField = field as ImportWizardResultField;
      const trimmed = value.trim();

      const clearOverrideForRow = (prev: Record<string, Partial<Record<ImportWizardResultField, string>>>) => {
        const row = { ...(prev[rowId] ?? {}) };
        delete row[resultField];
        const next = { ...prev, [rowId]: row };
        if (Object.keys(row).length === 0) {
          const { [rowId]: _, ...rest } = next;
          return rest;
        }
        return next;
      };

      if (trimmed === '') {
        setImportMappedOutputOverrides((prev) => clearOverrideForRow(prev));
        return;
      }

      if (importWizardModel && mappingWizardActive) {
        const pipelineDisplay = getPipelineSrcMappedFieldDisplay({
          model: importWizardModel,
          importColumnMapping,
          existingTransactionSignatures,
          importWizardCellOverrides,
          importWizardManualCellValues,
          importMappedOutputOverrides,
          rowId,
          mappedAs,
          omitMappedOutputForField: resultField,
        });
        if (trimmed === pipelineDisplay.trim()) {
          setImportMappedOutputOverrides((prev) => clearOverrideForRow(prev));
          return;
        }
      }

      setImportMappedOutputOverrides((prev) => {
        const row = { ...(prev[rowId] ?? {}) };
        row[resultField] = value;
        const next = { ...prev, [rowId]: row };
        return next;
      });
    },
    [
      importWizardModel,
      mappingWizardActive,
      importColumnMapping,
      existingTransactionSignatures,
      importWizardCellOverrides,
      importWizardManualCellValues,
      importMappedOutputOverrides,
    ]
  );

  const updateWizardManualCell = useCallback((rowId: string, field: ImportWizardResultField, value: string) => {
    setImportWizardManualCellValues((prev) => {
      const row = { ...(prev[rowId] ?? {}) };
      row[field] = value;
      const next = { ...prev, [rowId]: row };
      const empty = Object.values(row).every((x) => (x ?? '').trim() === '');
      if (empty) {
        const { [rowId]: _, ...rest } = next;
        return rest;
      }
      return next;
    });
  }, []);

  const updateImportPrepCell = useCallback((rowId: string, colKey: string, value: string) => {
    setImportWizardCellOverrides((prev) => {
      const row = importWizardModel?.rows.find((r) => r.id === rowId);
      const col = importWizardModel?.columns.find((c) => c.key === colKey);
      if (!row || !col || col.fileName !== row.sourceFile) return prev;
      const original = row.values[col.colIndex] ?? '';
      const nextRow = { ...(prev[rowId] ?? {}) };
      if (value === original) {
        delete nextRow[colKey];
      } else {
        nextRow[colKey] = value;
      }
      const next = { ...prev };
      if (Object.keys(nextRow).length === 0) delete next[rowId];
      else next[rowId] = nextRow;
      return next;
    });
  }, [importWizardModel]);

  const importPreviewImportableRows = useMemo(
    () =>
      mappingWizardActive
        ? filterImportPreviewImportableRows({
            previewList: importWizardPreview?.list ?? [],
            importRowSkip,
          })
        : [],
    [mappingWizardActive, importWizardPreview, importRowSkip]
  );

  const handleImportLinesToSource = useCallback(async () => {
    if (!mappingWizardActive) {
      setImportWizardMessage('Activez le mapping wizard pour préparer et importer les lignes vers src_transaction_data.csv.');
      return;
    }
    if (!importWizardPreview?.list.length) {
      setImportWizardMessage('Aucune ligne à importer.');
      return;
    }
    const api = (window as unknown as {
      electronAPI?: {
        appendForcedTransactionRows: (rows: ValidRow[]) => Promise<{
          success: boolean;
          error?: string;
          appendedCount?: number;
        }>;
      };
    }).electronAPI;
    if (!api?.appendForcedTransactionRows) {
      setImportWizardMessage('Fonction d’import non disponible.');
      return;
    }
    const toAppend: ValidRow[] = [];
    for (const p of importWizardPreview.list) {
      if (importRowSkip.has(p.row.id)) continue;
      if (!('valid' in p.processed)) continue;
      if (p.duplicateExisting) continue;
      const amt = parseAmountNumericForImport(p.valueMap.AMOUNT ?? '');
      if (amt !== null && amt !== 0) {
        const fiat = resolveImportFiatEffective(p.row.id, p.valueMap, {});
        if (fiat !== 'EUR' && fiat !== 'GBP' && fiat !== 'CHF') {
          setImportWizardMessage(
            'Montant non nul sans devise reconnue : indiquez €, £ ou CHF dans le montant, ou complétez la devise (mapping wizard / colonne CURRENCY).'
          );
          return;
        }
      }
      toAppend.push(p.processed.valid);
    }
    if (toAppend.length === 0) {
      setImportWizardMessage(
        'Aucune ligne valide à ajouter (vérifiez les doublons ou les lignes ignorées).'
      );
      return;
    }
    setImportLinesLoading(true);
    setImportWizardMessage(null);
    try {
      const result = await api.appendForcedTransactionRows(toAppend);
      if (result.success) {
        onAfterSuccessfulAppend?.();
        setImportWizardReloadKey((k) => k + 1);
        setImportWizardMessage(
          `${result.appendedCount ?? toAppend.length} ligne(s) ajoutée(s) à src_transaction_data.csv.`
        );
      } else {
        setImportWizardMessage(result.error ?? 'Erreur lors de l’import.');
      }
    } finally {
      setImportLinesLoading(false);
    }
  }, [mappingWizardActive, importWizardPreview, importRowSkip, onAfterSuccessfulAppend]);

  const applyImportWizardClipboardPaste = useCallback(
    (raw: string, parseOptions?: ImportWizardParseOptions) => {
      const pasted = buildImportWizardModelFromClipboardText(raw, parseOptions);
      if (!pasted?.rows.length) {
        setImportWizardMessage('Collage vide ou aucune ligne de données exploitable.');
        return;
      }
      setImportWizardModel((prev) => (prev ? mergeImportWizardModels(prev, pasted) : pasted));
      const src = pasted.rows[0]?.sourceFile ?? 'presse-papiers';
      setImportWizardMessage(`${pasted.rows.length} ligne(s) ajoutée(s) depuis le presse-papiers (${src}).`);
    },
    []
  );

  const handleOpenImportFolder = useCallback(async () => {
    const api = (window as unknown as {
      electronAPI?: { openImportFolder: () => Promise<{ success: boolean; error?: string }> };
    }).electronAPI;
    if (!api?.openImportFolder) return;
    const result = await api.openImportFolder();
    if (!result.success && result.error) {
      setImportWizardMessage(result.error);
    }
  }, []);

  return {
    importWizardModel,
    importWizardLoading,
    applyImportWizardClipboardPaste,
    handleOpenImportFolder,
    diskImportFirstLineAsData,
    setDiskImportFirstLineAsData,
    mappingWizardActive,
    setMappingWizardActive,
    importColumnMapping,
    importColumnMappingUser,
    updateImportColumnMappingUser,
    importRowSkip,
    setImportRowSkip,
    importWizardCellOverrides,
    importMappedOutputOverrides,
    importLinesLoading,
    importWizardMessage,
    setImportWizardMessage,
    importWizardManualCellValues,
    importWizardPreview,
    importWizardSuggestionRows,
    importPreviewRowStatusByRowId,
    importWizardSourceFileNames,
    importWizardRowIds,
    importPrepIgnSkipHeader,
    prepTableColDefs,
    visiblePrepColDefs,
    prepStickyKey,
    prepIgnHeaderCheckboxRef,
    toggleImportPrepSkipAll,
    updateWizardManualCell,
    updateMappedOutputCell,
    updateImportPrepCell,
    importPreviewImportableRows,
    handleImportLinesToSource,
  };
}
