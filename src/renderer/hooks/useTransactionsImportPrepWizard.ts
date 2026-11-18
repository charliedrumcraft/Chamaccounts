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
import { rowSignature, type ValidRow } from '@/shared/transactionsImportCore';
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
import type { MappingWizardProfile } from '@/shared/mappingWizardProfiles';
import {
  listMappingWizardProfiles,
  upsertMappingWizardProfile,
} from '../services/mappingWizardProfilesService';
import { findMatchingMappingProfile } from '@/shared/mappingWizardProfiles';
import {
  TX_MAPPING_PREFER_ACTIVE_KEY,
  readMappingPreferActive,
  writeMappingPreferActive,
} from '../constants/mappingWizardPreferActiveStorage';

export type { ImportWizardResultField, PrepTableColDef };

export function useTransactionsImportPrepWizard(options: {
  existingTransactionSignatures: Set<string>;
  accountAliasLookup?: ReadonlyMap<string, string>;
  onAfterSuccessfulAppend?: (info?: { count: number; signatures?: string[] }) => void;
  /** Incrémenter depuis la page (ex. après vidage du dossier Import) pour forcer un rechargement du wizard. */
  folderReloadToken?: number;
  /**
   * Premier usage / focus import : activer le mapping dès qu’il passe à true
   * (l’utilisateur peut toujours le désactiver ensuite).
   */
  preferMappingActive?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const {
    existingTransactionSignatures,
    accountAliasLookup,
    onAfterSuccessfulAppend,
    folderReloadToken = 0,
    preferMappingActive = false,
  } = options;

  const [learnedMappingProfiles, setLearnedMappingProfiles] = useState<MappingWizardProfile[]>([]);
  const [importWizardModel, setImportWizardModel] = useState<ImportWizardModel | null>(null);
  const [importWizardLoading, setImportWizardLoading] = useState(false);
  const [importWizardReloadKey, setImportWizardReloadKey] = useState(0);
  const [importRowSkip, setImportRowSkip] = useState<Set<string>>(() => new Set());
  /** Exceptions : autoriser l’import malgré une détection de doublon (même signature). */
  const [importDuplicateForceAllow, setImportDuplicateForceAllow] = useState<Set<string>>(
    () => new Set()
  );
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
  const [storedMappingPrefer, setStoredMappingPrefer] = useState(() =>
    readMappingPreferActive(TX_MAPPING_PREFER_ACTIVE_KEY)
  );
  /** Activé si préférence stockée, ou forcé par premier usage / deep-link. */
  const [mappingWizardActive, setMappingWizardActive] = useState(
    () => preferMappingActive || readMappingPreferActive(TX_MAPPING_PREFER_ACTIVE_KEY)
  );
  const mappingPreferAppliedRef = useRef(preferMappingActive);

  useEffect(() => {
    if (preferMappingActive && !mappingPreferAppliedRef.current) {
      mappingPreferAppliedRef.current = true;
      setMappingWizardActive(true);
    }
  }, [preferMappingActive]);
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
    let cancelled = false;
    void listMappingWizardProfiles().then((profiles) => {
      if (!cancelled) setLearnedMappingProfiles(profiles);
    });
    return () => {
      cancelled = true;
    };
  }, [folderReloadToken, importWizardReloadKey]);

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
        setImportDuplicateForceAllow(new Set());
        setImportWizardCellOverrides({});
        setImportWizardManualCellValues({});
        setImportMappedOutputOverrides({});
        setImportColumnMappingUser({});
        if (readMappingPreferActive(TX_MAPPING_PREFER_ACTIVE_KEY) || preferMappingActive) {
          setMappingWizardActive(true);
        }
      } else {
        setImportColumnMappingUser({});
      }
    } finally {
      setImportWizardLoading(false);
    }
  }, [diskImportFirstLineAsData, preferMappingActive]);

  useEffect(() => {
    void loadImportWizard();
  }, [loadImportWizard, importWizardReloadKey, folderReloadToken, diskImportFirstLineAsData]);

  const defaultColumnMapping = useMemo((): Record<string, WizardStandardKey> => {
    if (!importWizardModel) return {};
    return buildDefaultColumnMapping(importWizardModel.columns, learnedMappingProfiles);
  }, [importWizardModel, learnedMappingProfiles]);

  const importColumnMapping = useMemo((): Record<string, WizardStandardKey> => {
    if (!importWizardModel || !mappingWizardActive) return {};
    const out: Record<string, WizardStandardKey> = { ...defaultColumnMapping };
    for (const [k, v] of Object.entries(importColumnMappingUser)) {
      if (v === ('' as WizardStandardKey)) delete out[k];
      else out[k] = v;
    }
    return out;
  }, [importWizardModel, mappingWizardActive, importColumnMappingUser, defaultColumnMapping]);

  /** Devise implicite : détection fichier, sinon profil de mapping matché. */
  const effectiveDefaultCurrency = useMemo(() => {
    const fromModel = (importWizardModel?.defaultCurrency ?? '').trim();
    if (fromModel) return fromModel;
    if (!importWizardModel?.columns.length) return undefined;
    const matched = findMatchingMappingProfile(
      learnedMappingProfiles,
      importWizardModel.columns.map((c) => c.label)
    );
    return (matched?.defaultCurrency ?? '').trim() || undefined;
  }, [importWizardModel, learnedMappingProfiles]);

  const importWizardPreview = useMemo(
    () =>
      importWizardModel && mappingWizardActive
        ? computeTransactionsImportWizardPreview({
            model: {
              ...importWizardModel,
              defaultCurrency: effectiveDefaultCurrency,
            },
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
      effectiveDefaultCurrency,
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
      { defaultCurrency: effectiveDefaultCurrency }
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
    const dupAllowedMsg = t('transactions.importPrep.duplicateRowAllowed');
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
      if (p.duplicateExisting) {
        aside.push(importDuplicateForceAllow.has(p.row.id) ? dupAllowedMsg : dupMsg);
      }
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
  }, [
    importWizardPreview,
    importWizardModel,
    importColumnMapping,
    effectiveDefaultCurrency,
    importDuplicateForceAllow,
    t,
    i18n.language,
  ]);

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

  const importPrepDuplicateForceAllowHeader = useMemo(() => {
    const count = duplicateRowIds.length;
    if (count === 0) return { allAllowed: false, someAllowed: false, count: 0 };
    let allowed = 0;
    for (const id of duplicateRowIds) {
      if (importDuplicateForceAllow.has(id)) allowed += 1;
    }
    return {
      allAllowed: allowed === count,
      someAllowed: allowed > 0,
      count,
    };
  }, [duplicateRowIds, importDuplicateForceAllow]);

  const prepTableColDefs = useMemo(
    () =>
      mappingWizardActive
        ? buildPrepTableColDefs({
            columns: importWizardModel?.columns,
            importColumnMapping,
            defaultCurrency: effectiveDefaultCurrency,
          })
        : buildPrepTableColDefsRaw({ columns: importWizardModel?.columns }),
    [mappingWizardActive, importWizardModel, importColumnMapping, effectiveDefaultCurrency]
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
  const prepDuplicateForceAllowHeaderCheckboxRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const el = prepDuplicateForceAllowHeaderCheckboxRef.current;
    if (!el) return;
    el.indeterminate =
      importPrepDuplicateForceAllowHeader.someAllowed &&
      !importPrepDuplicateForceAllowHeader.allAllowed;
  }, [importPrepDuplicateForceAllowHeader]);

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
        setImportDuplicateForceAllow((allowPrev) => {
          const allowNext = new Set(allowPrev);
          for (const id of duplicateRowIds) allowNext.delete(id);
          return allowNext;
        });
      }
      return next;
    });
  }, [duplicateRowIds]);

  const toggleForceAllowAllDuplicates = useCallback(() => {
    if (duplicateRowIds.length === 0) return;
    setImportDuplicateForceAllow((prev) => {
      const all = duplicateRowIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (all) {
        for (const id of duplicateRowIds) next.delete(id);
      } else {
        for (const id of duplicateRowIds) next.add(id);
        setImportRowSkip((skipPrev) => {
          const skipNext = new Set(skipPrev);
          for (const id of duplicateRowIds) skipNext.delete(id);
          return skipNext;
        });
      }
      return next;
    });
  }, [duplicateRowIds]);

  const toggleDuplicateForceAllowRow = useCallback((rowId: string) => {
    setImportDuplicateForceAllow((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
        setImportRowSkip((skipPrev) => {
          if (!skipPrev.has(rowId)) return skipPrev;
          const skipNext = new Set(skipPrev);
          skipNext.delete(rowId);
          return skipNext;
        });
      }
      return next;
    });
  }, []);

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
            duplicateForceAllow: importDuplicateForceAllow,
          })
        : [],
    [mappingWizardActive, importWizardPreview, importRowSkip, importDuplicateForceAllow]
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
      if (p.duplicateExisting && !importDuplicateForceAllow.has(p.row.id)) continue;
      const amt = parseAmountNumericForImport(p.valueMap.AMOUNT ?? '');
      if (amt !== null && amt !== 0) {
        const fiat = resolveImportFiatEffective(
          p.row.id,
          p.valueMap,
          {},
          undefined,
          effectiveDefaultCurrency
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
              const appended = result.appendedCount ?? toAppend.length;
              const signatures = toAppend.map((r) =>
                rowSignature(r, { accountAliasLookup })
              );
              onAfterSuccessfulAppend?.({ count: appended, signatures });
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
        {
          const appended = result.appendedCount ?? toAppend.length;
          const signatures = toAppend.map((r) =>
            rowSignature(r, { accountAliasLookup })
          );
          onAfterSuccessfulAppend?.({ count: appended, signatures });
          setImportWizardReloadKey((k) => k + 1);
          setImportWizardMessage(
            t('transactions.importPrep.appended', {
              count: appended,
              disk: diskMsg,
            })
          );
        }
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
    importDuplicateForceAllow,
    onAfterSuccessfulAppend,
    removeImportedFromImportFolder,
    effectiveDefaultCurrency,
    accountAliasLookup,
    t,
  ]);

  const setMappingWizardActiveFromUser = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setMappingWizardActive((prev) => {
        const next = typeof v === 'function' ? v(prev) : v;
        if (next !== prev) {
          setStoredMappingPrefer(next);
          writeMappingPreferActive(TX_MAPPING_PREFER_ACTIVE_KEY, next);
        }
        return next;
      });
    },
    []
  );

  const applyImportWizardClipboardPaste = useCallback(
    (raw: string, parseOptions?: ImportWizardParseOptions) => {
      const pasted = buildImportWizardModelFromClipboardText(raw, parseOptions);
      if (!pasted?.rows.length) {
        setImportWizardMessage(t('transactions.importPrep.pasteEmpty'));
        return;
      }
      setImportWizardModel((prev) => (prev ? mergeImportWizardModels(prev, pasted) : pasted));
      const prefer = readMappingPreferActive(TX_MAPPING_PREFER_ACTIVE_KEY);
      setStoredMappingPrefer(prefer);
      if (prefer) setMappingWizardActive(true);
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

  /** Enregistre le mapping effectif du premier fichier du wizard comme profil appris. */
  const saveLearnedMappingProfile = useCallback(async () => {
    if (!importWizardModel?.columns.length) {
      setImportWizardMessage(t('transactions.importPrep.saveMappingProfileNoColumns'));
      return;
    }
    const fileNames = [...new Set(importWizardModel.columns.map((c) => c.fileName))];
    const fileName = fileNames[0]!;
    if (fileNames.length > 1) {
      setImportWizardMessage(
        t('transactions.importPrep.saveMappingProfileMultiFile', { file: fileName })
      );
    }
    const name = window.prompt(t('transactions.importPrep.saveMappingProfilePrompt'));
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setImportWizardMessage(t('transactions.importPrep.saveMappingProfileNameRequired'));
      return;
    }
    const fileCols = importWizardModel.columns.filter((c) => c.fileName === fileName);
    const headerLabels = fileCols.map((c) => c.label);
    const effective = { ...defaultColumnMapping };
    for (const [k, v] of Object.entries(importColumnMappingUser)) {
      if (v === ('' as WizardStandardKey)) effective[k] = '';
      else effective[k] = v;
    }
    const columnMap: Record<string, string> = {};
    for (const col of fileCols) {
      columnMap[col.label] = effective[col.key] ?? '';
    }
    const r = await upsertMappingWizardProfile({
      name: trimmed,
      headerLabels,
      columnMap,
      firstLineAsData: diskImportFirstLineAsData || undefined,
      defaultCurrency: effectiveDefaultCurrency,
    });
    if (!r.ok) {
      setImportWizardMessage(r.error);
      return;
    }
    setLearnedMappingProfiles(r.profiles);
    setImportWizardMessage(t('transactions.importPrep.saveMappingProfileDone', { name: r.profile.name }));
  }, [
    importWizardModel,
    defaultColumnMapping,
    importColumnMappingUser,
    diskImportFirstLineAsData,
    effectiveDefaultCurrency,
    t,
  ]);

  return {
    importWizardModel,
    importWizardLoading,
    applyImportWizardClipboardPaste,
    handleOpenImportFolder,
    diskImportFirstLineAsData,
    setDiskImportFirstLineAsData,
    mappingWizardActive,
    setMappingWizardActive: setMappingWizardActiveFromUser,
    preferMappingActiveStored: storedMappingPrefer,
    removeImportedFromImportFolder,
    setRemoveImportedFromImportFolder,
    defaultColumnMapping,
    importColumnMapping,
    importColumnMappingUser,
    updateImportColumnMappingUser,
    saveLearnedMappingProfile,
    importRowSkip,
    setImportRowSkip,
    importDuplicateForceAllow,
    toggleDuplicateForceAllowRow,
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
    importPrepDuplicateForceAllowHeader,
    prepTableColDefs,
    visiblePrepColDefs,
    prepStickyKey,
    prepIgnHeaderCheckboxRef,
    prepAnomalyIgnHeaderCheckboxRef,
    prepDuplicateIgnHeaderCheckboxRef,
    prepDuplicateForceAllowHeaderCheckboxRef,
    toggleImportPrepSkipAll,
    toggleSkipAllAnomalous,
    toggleSkipAllDuplicates,
    toggleForceAllowAllDuplicates,
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
