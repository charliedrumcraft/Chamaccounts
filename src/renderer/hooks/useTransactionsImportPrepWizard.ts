import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
import {
  buildAutoCategorisationModel,
  labeledTitlesFromSourceRows,
  type AutoCategorisationModel,
  type FixedAutoCatRule,
} from '@/shared/autoCategorisation';
import {
  loadFixedAutoCatRules,
} from '../services/autoCategorisationRulesStorage';
import { SourceDataCSVService } from '../services/SourceDataCSVService';
import type { AutoCatReviewRow } from '../components/AutoCategorisationReviewModal';
import { reviewRowFromSuggestion } from '../components/AutoCategorisationReviewModal';
import { transactionsImportFile } from '@/shared/dataPaths';
import { removeImportedRowsFromImportFolder } from '../services/importWizardRemoveFromDiskService';
import { translateImportPrepMessage } from '../i18n/translateImportPrepMessage';
import { formatAnomalyReasons } from '../i18n/formatAnomalyReason';
import type { AnomalyReason } from '@/shared/anomalyReasons';

export type { ImportWizardResultField, PrepTableColDef };

export function useTransactionsImportPrepWizard(options: {
  existingTransactionSignatures: Set<string>;
  accountAliasLookup?: ReadonlyMap<string, string>;
  onAfterSuccessfulAppend?: () => void;
  /** Incrémenter depuis la page (ex. après vidage du dossier Import) pour forcer un rechargement du wizard. */
  folderReloadToken?: number;
}) {
  const { t, i18n } = useTranslation();
  const { existingTransactionSignatures, accountAliasLookup, onAfterSuccessfulAppend, folderReloadToken = 0 } = options;

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
  /** Après import réussi : retirer les lignes importées des CSV du dossier Import. */
  const [removeImportedFromImportFolder, setRemoveImportedFromImportFolder] = useState(false);
  /** Modèle d’auto-catégorisation TYPE (TITLE→TYPE depuis la DB). */
  const [autoCategorisationModel, setAutoCategorisationModel] =
    useState<AutoCategorisationModel | null>(null);
  const [fixedAutoCatRules, setFixedAutoCatRules] = useState<FixedAutoCatRule[]>(() =>
    loadFixedAutoCatRules()
  );
  const [autoCatReviewOpen, setAutoCatReviewOpen] = useState(false);
  const [knownOutputTypes, setKnownOutputTypes] = useState<string[]>([]);

  useEffect(() => {
    if (!mappingWizardActive) return;
    let cancelled = false;
    setFixedAutoCatRules(loadFixedAutoCatRules());
    void SourceDataCSVService.load().then((data) => {
      if (cancelled) return;
      if (!data?.rows?.length) {
        setAutoCategorisationModel(null);
        setKnownOutputTypes([]);
        return;
      }
      setAutoCategorisationModel(buildAutoCategorisationModel(labeledTitlesFromSourceRows(data.rows)));
      const types = new Set<string>();
      for (const row of data.rows) {
        const ty = (row.TYPE ?? '').trim();
        if (ty) types.add(ty);
      }
      try {
        const stored = JSON.parse(
          localStorage.getItem('settings-recognised-output-types') ?? '[]'
        ) as unknown;
        if (Array.isArray(stored)) {
          for (const x of stored) {
            const s = String(x ?? '').trim();
            if (s) types.add(s);
          }
        }
      } catch {
        /* ignore */
      }
      setKnownOutputTypes([...types].sort((a, b) => a.localeCompare(b)));
    });
    return () => {
      cancelled = true;
    };
  }, [mappingWizardActive, folderReloadToken, importWizardReloadKey]);

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
            accountAliasLookup,
            importWizardCellOverrides,
            importWizardManualCellValues,
            importMappedOutputOverrides,
            autoCategorisationModel,
            fixedAutoCatRules,
          })
        : null,
    [
      importWizardModel,
      mappingWizardActive,
      importColumnMapping,
      existingTransactionSignatures,
      accountAliasLookup,
      importWizardCellOverrides,
      importWizardManualCellValues,
      importMappedOutputOverrides,
      autoCategorisationModel,
      fixedAutoCatRules,
    ]
  );

  const autoCatReviewRows = useMemo((): AutoCatReviewRow[] => {
    if (!importWizardPreview?.list.length) return [];
    const out: AutoCatReviewRow[] = [];
    for (const p of importWizardPreview.list) {
      const title =
        ('valid' in p.processed ? p.processed.valid.TITLE : p.valueMap.TITLE) ?? '';
      const date =
        ('valid' in p.processed ? p.processed.valid.DATE : p.valueMap.DATE) ?? '';
      const row = reviewRowFromSuggestion(p.row.id, title, date, p.typeSuggestion);
      if (row) out.push(row);
    }
    return out;
  }, [importWizardPreview]);

  const applyAutoCatReviewSelection = useCallback((selected: AutoCatReviewRow[]) => {
    setImportWizardManualCellValues((prev) => {
      const next = { ...prev };
      for (const s of selected) {
        if (!s.suggestedType.trim()) continue;
        next[s.rowId] = { ...(next[s.rowId] ?? {}), TYPE: s.suggestedType.trim() };
      }
      return next;
    });
    setAutoCatReviewOpen(false);
  }, []);

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
      importColumnMapping,
      { defaultCurrency: importWizardModel.defaultCurrency }
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
    const anomalyReasonsByRowId = new Map<string, AnomalyReason[]>();
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
    const dupMsg = t('transactions.importPrep.duplicateRow');
    for (const p of list) {
      const aside: string[] = [];
      if ('anomaly' in p.processed) {
        aside.push(
          ...p.processed.anomaly.reason.split(' ; ').map((part) => translateImportPrepMessage(part.trim(), t))
        );
      }
      const ar = anomalyReasonsByRowId.get(p.row.id);
      if (ar?.length) aside.push(formatAnomalyReasons(ar, t));
      const dateMsgs = dateCoherenceByRowId.get(p.row.id);
      if (dateMsgs?.length) aside.push(...dateMsgs);
      if (p.duplicateExisting) aside.push(dupMsg);
      const missingManual = uncoveredRecommendedManual.filter((f) => !(p.valueMap[f] ?? '').trim());
      const pendingManualRecommended = missingManual.length > 0;
      const manualLine = pendingManualRecommended
        ? t('transactions.importPrep.manualRecommended', { fields: missingManual.join(', ') })
        : null;
      const messages = manualLine ? [manualLine, ...aside] : aside;
      map.set(p.row.id, {
        messages,
        pendingManualRecommended,
        hasAmberAside: aside.length > 0,
      });
    }
    return map;
  }, [importWizardPreview, importWizardModel, importColumnMapping, t, i18n.language]);

  const anomalousRowIds = useMemo(() => {
    if (!mappingWizardActive || !importWizardPreview?.list.length) return [] as string[];
    const ids: string[] = [];
    for (const p of importWizardPreview.list) {
      if (importPreviewRowStatusByRowId.get(p.row.id)?.hasAmberAside) ids.push(p.row.id);
    }
    return ids;
  }, [mappingWizardActive, importWizardPreview, importPreviewRowStatusByRowId]);

  const duplicateRowIds = useMemo(() => {
    if (!mappingWizardActive || !importWizardPreview?.list.length) return [] as string[];
    const ids: string[] = [];
    for (const p of importWizardPreview.list) {
      if (p.duplicateExisting) ids.push(p.row.id);
    }
    return ids;
  }, [mappingWizardActive, importWizardPreview]);

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
    const total = ids.length;
    if (total === 0) {
      return { allSkipped: false, someSkipped: false, total: 0, skipped: 0, active: 0 };
    }
    let skipped = 0;
    for (const id of ids) {
      if (importRowSkip.has(id)) skipped += 1;
    }
    return {
      allSkipped: skipped === total,
      someSkipped: skipped > 0,
      total,
      skipped,
      active: total - skipped,
    };
  }, [importWizardRowIds, importRowSkip]);

  const importPrepAnomalySkipHeader = useMemo(() => {
    const count = anomalousRowIds.length;
    if (count === 0) return { allSkipped: false, someSkipped: false, count: 0 };
    let skipped = 0;
    for (const id of anomalousRowIds) {
      if (importRowSkip.has(id)) skipped += 1;
    }
    return {
      allSkipped: skipped === count,
      someSkipped: skipped > 0,
      count,
    };
  }, [anomalousRowIds, importRowSkip]);

  const importPrepDuplicateSkipHeader = useMemo(() => {
    const count = duplicateRowIds.length;
    if (count === 0) return { allSkipped: false, someSkipped: false, count: 0 };
    let skipped = 0;
    for (const id of duplicateRowIds) {
      if (importRowSkip.has(id)) skipped += 1;
    }
    return {
      allSkipped: skipped === count,
      someSkipped: skipped > 0,
      count,
    };
  }, [duplicateRowIds, importRowSkip]);

  const prepTableColDefs = useMemo(
    () =>
      mappingWizardActive
        ? buildPrepTableColDefs({
            columns: importWizardModel?.columns,
            importColumnMapping,
            defaultCurrency: importWizardModel?.defaultCurrency,
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
  const prepAnomalyIgnHeaderCheckboxRef = useRef<HTMLInputElement>(null);
  const prepDuplicateIgnHeaderCheckboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = prepIgnHeaderCheckboxRef.current;
    if (!el) return;
    el.indeterminate =
      importPrepIgnSkipHeader.someSkipped && !importPrepIgnSkipHeader.allSkipped;
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

  const toggleSkipAllAnomalous = useCallback(() => {
    setImportRowSkip((prev) => {
      if (anomalousRowIds.length === 0) return prev;
      const all = anomalousRowIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (all) {
        for (const id of anomalousRowIds) next.delete(id);
      } else {
        for (const id of anomalousRowIds) next.add(id);
      }
      return next;
    });
  }, [anomalousRowIds]);

  const toggleSkipAllDuplicates = useCallback(() => {
    setImportRowSkip((prev) => {
      if (duplicateRowIds.length === 0) return prev;
      const all = duplicateRowIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (all) {
        for (const id of duplicateRowIds) next.delete(id);
      } else {
        for (const id of duplicateRowIds) next.add(id);
      }
      return next;
    });
  }, [duplicateRowIds]);

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
        // TYPE : garder '' pour ne pas réactiver l’auto-catégorisation.
        if (resultField === 'TYPE') {
          setImportMappedOutputOverrides((prev) => {
            const row = { ...(prev[rowId] ?? {}), TYPE: '' };
            return { ...prev, [rowId]: row };
          });
          return;
        }
        setImportMappedOutputOverrides((prev) => clearOverrideForRow(prev));
        return;
      }

      if (importWizardModel && mappingWizardActive) {
        const pipelineDisplay = getPipelineSrcMappedFieldDisplay({
          model: importWizardModel,
          importColumnMapping,
          existingTransactionSignatures,
          accountAliasLookup,
          importWizardCellOverrides,
          importWizardManualCellValues,
          importMappedOutputOverrides,
          autoCategorisationModel,
          fixedAutoCatRules,
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
      accountAliasLookup,
      importWizardCellOverrides,
      importWizardManualCellValues,
      importMappedOutputOverrides,
      autoCategorisationModel,
      fixedAutoCatRules,
    ]
  );

  const updateWizardManualCell = useCallback((rowId: string, field: ImportWizardResultField, value: string) => {
    setImportWizardManualCellValues((prev) => {
      const row = { ...(prev[rowId] ?? {}) };
      // TYPE : conserver '' (effacement volontaire) pour bloquer l’auto-catégorisation.
      if (field !== 'TYPE' && (value ?? '').trim() === '') {
        delete row[field];
      } else {
        row[field] = value;
      }
      if (Object.keys(row).length === 0) {
        const { [rowId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [rowId]: row };
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
      setImportWizardMessage(t('transactions.importPrep.enableMappingFirst'));
      return;
    }
    if (!importWizardPreview?.list.length) {
      setImportWizardMessage(t('transactions.importPrep.noRowsToImport'));
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
      setImportWizardMessage(t('transactions.importPrep.importUnavailable'));
      return;
    }
    const toAppend: ValidRow[] = [];
    const importedDiskRows: { id: string; sourceFile: string }[] = [];
    for (const p of importWizardPreview.list) {
      if (importRowSkip.has(p.row.id)) continue;
      if (!('valid' in p.processed)) continue;
      if (p.duplicateExisting) continue;
      const amt = parseAmountNumericForImport(p.valueMap.AMOUNT ?? '');
      if (amt !== null && amt !== 0) {
        const fiat = resolveImportFiatEffective(
          p.row.id,
          p.valueMap,
          {},
          undefined,
          importWizardModel?.defaultCurrency
        );
        if (fiat !== 'EUR' && fiat !== 'GBP' && fiat !== 'CHF') {
          setImportWizardMessage(t('transactions.importPrep.currencyRequired'));
          return;
        }
      }
      toAppend.push(p.processed.valid);
      importedDiskRows.push({ id: p.row.id, sourceFile: p.row.sourceFile });
    }
    if (toAppend.length === 0) {
      setImportWizardMessage(t('transactions.importPrep.noValidRows'));
      return;
    }
    setImportLinesLoading(true);
    setImportWizardMessage(null);
    try {
      const result = await api.appendForcedTransactionRows(toAppend);
      if (result.success) {
        let diskMsg = '';
        if (removeImportedFromImportFolder && importedDiskRows.length > 0) {
          const fileApi = (window as unknown as {
            electronAPI?: {
              readFile: (p: string) => Promise<{ success: boolean; data?: string; error?: string }>;
              writeFile: (p: string, c: string) => Promise<{ success: boolean; error?: string }>;
              deleteFile: (p: string) => Promise<{ success: boolean; error?: string }>;
            };
          }).electronAPI;
          if (fileApi?.readFile && fileApi?.writeFile && fileApi?.deleteFile) {
            const diskResult = await removeImportedRowsFromImportFolder({
              rows: importedDiskRows,
              importFilePath: transactionsImportFile,
              api: fileApi,
            });
            if (!diskResult.success) {
              setImportWizardMessage(
                t('transactions.importPrep.appendedWithDiskFail', {
                  count: result.appendedCount ?? toAppend.length,
                  error: diskResult.error ?? t('transactions.importPrep.unknownError'),
                })
              );
              onAfterSuccessfulAppend?.();
              setImportWizardReloadKey((k) => k + 1);
              return;
            }
            if (diskResult.removedLineCount > 0) {
              const parts: string[] = [];
              if (diskResult.updatedFiles.length) {
                parts.push(t('transactions.importPrep.filesUpdated', { count: diskResult.updatedFiles.length }));
              }
              if (diskResult.deletedFiles.length) {
                parts.push(t('transactions.importPrep.filesDeleted', { count: diskResult.deletedFiles.length }));
              }
              diskMsg = t('transactions.importPrep.diskRemoved', {
                count: diskResult.removedLineCount,
                detail: parts.length ? ` (${parts.join(', ')})` : '',
              });
            }
          }
        }
        onAfterSuccessfulAppend?.();
        setImportWizardReloadKey((k) => k + 1);
        setImportWizardMessage(
          t('transactions.importPrep.appended', {
            count: result.appendedCount ?? toAppend.length,
            disk: diskMsg,
          })
        );
      } else {
        setImportWizardMessage(result.error ?? t('transactions.importPrep.importFailed'));
      }
    } finally {
      setImportLinesLoading(false);
    }
  }, [
    mappingWizardActive,
    importWizardPreview,
    importRowSkip,
    onAfterSuccessfulAppend,
    removeImportedFromImportFolder,
    t,
  ]);

  const applyImportWizardClipboardPaste = useCallback(
    (raw: string, parseOptions?: ImportWizardParseOptions) => {
      const pasted = buildImportWizardModelFromClipboardText(raw, parseOptions);
      if (!pasted?.rows.length) {
        setImportWizardMessage(t('transactions.importPrep.pasteEmpty'));
        return;
      }
      setImportWizardModel((prev) => (prev ? mergeImportWizardModels(prev, pasted) : pasted));
      const src = pasted.rows[0]?.sourceFile ?? t('transactions.importPrep.clipboardSource');
      setImportWizardMessage(
        t('transactions.importPrep.pasteAdded', { count: pasted.rows.length, source: src })
      );
    },
    [t]
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
    removeImportedFromImportFolder,
    setRemoveImportedFromImportFolder,
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
    importPrepAnomalySkipHeader,
    importPrepDuplicateSkipHeader,
    prepTableColDefs,
    visiblePrepColDefs,
    prepStickyKey,
    prepIgnHeaderCheckboxRef,
    prepAnomalyIgnHeaderCheckboxRef,
    prepDuplicateIgnHeaderCheckboxRef,
    toggleImportPrepSkipAll,
    toggleSkipAllAnomalous,
    toggleSkipAllDuplicates,
    updateWizardManualCell,
    updateMappedOutputCell,
    updateImportPrepCell,
    importPreviewImportableRows,
    handleImportLinesToSource,
    autoCatReviewOpen,
    setAutoCatReviewOpen,
    autoCatReviewRows,
    applyAutoCatReviewSelection,
    fixedAutoCatRules,
    setFixedAutoCatRules,
    knownOutputTypes,
  };
}
