import { useState, useMemo, useCallback, useEffect, useRef, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { translateImportPrepMessage } from '../i18n/translateImportPrepMessage';
import { formatAnomalyReasons } from '../i18n/formatAnomalyReason';
import { detectSupportAnomalies } from '../services/AnomalyDetectionService';
import {
  buildImportWizardModelFromClipboardText,
  buildImportWizardModelFromFileContent,
  loadSupportImportWizardModel,
  mergeImportWizardModels,
  removeSourceFromImportWizardModel,
  buildDefaultColumnMapping,
  buildSupportMappedDisplay,
  validateSupportImportDisplay,
  displayToSupportImportDraft,
  supportImportRowSignature,
  SUPPORT_IMPORT_OUTPUT_FIELDS,
  type ImportWizardModel,
  type ImportWizardParseOptions,
  type ImportWizardRawRow,
  type WizardStandardKey,
  type SupportImportDraft,
  type SupportImportOutputField,
} from '../services/supportImportWizardService';
import {
  addProjectByName,
  projetLabelForId,
  type ProjectEntry,
} from '../constants/projectsStorage';
import type { MappingWizardProfile } from '@/shared/mappingWizardProfiles';
import { findMatchingMappingProfile } from '@/shared/mappingWizardProfiles';
import {
  listMappingWizardProfiles,
  upsertMappingWizardProfile,
} from '../services/mappingWizardProfilesService';
import {
  SUPPORT_MAPPING_PREFER_ACTIVE_KEY,
  readMappingPreferActive,
  writeMappingPreferActive,
} from '../constants/mappingWizardPreferActiveStorage';
import { TRANSACTION_PROJET_COLUMN } from '@/shared/transactionsImportCore';
import { ANOMALY_REASON_CODES, type AnomalyReason } from '@/shared/anomalyReasons';
import { supportImportFile } from '@/shared/dataPaths';
import { removeImportedRowsFromImportFolder } from '../services/importWizardRemoveFromDiskService';

const SUPPORT_KEEP_BATCH_KEY = 'support-import-keep-batch-after-import';
const SUPPORT_REQUIRE_PROJET_KEY = 'support-import-require-projet';

function readBoolStorage(key: string, defaultValue: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === 'false') return false;
    if (v === 'true') return true;
  } catch {
    /* ignore */
  }
  return defaultValue;
}

function writeBoolStorage(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* ignore */
  }
}

export function useSupportImportPrepWizard(options: {
  /** Après import réussi vers Support_data.csv. */
  onImportLines: (drafts: SupportImportDraft[]) => Promise<{ success: boolean; error?: string; appendedCount?: number }>;
  /** Projets connus (résolution id / nom + validation). */
  projects: ProjectEntry[];
  /** Signatures DATE|TITLE|AMOUNT|CURRENCY déjà présentes (doublons). */
  existingSignatures?: Set<string>;
  /** Incrémenté après copie / vidage du dossier SupportData/Import. */
  folderReloadToken?: number;
}) {
  const { onImportLines, projects, existingSignatures = new Set(), folderReloadToken = 0 } = options;
  const { t, i18n } = useTranslation();

  const [model, setModel] = useState<ImportWizardModel | null>(null);
  const [importWizardLoading, setImportWizardLoading] = useState(false);
  const [importWizardReloadKey, setImportWizardReloadKey] = useState(0);
  const [preferMappingActive, setPreferMappingActive] = useState(() =>
    readMappingPreferActive(SUPPORT_MAPPING_PREFER_ACTIVE_KEY)
  );
  const [mappingWizardActive, setMappingWizardActive] = useState(false);
  const [rawCellOverrides, setRawCellOverrides] = useState<Record<string, Record<string, string>>>({});
  const [mappedCellOverrides, setMappedCellOverrides] = useState<Record<string, Record<string, string>>>({});
  const [importRowSkip, setImportRowSkip] = useState<Set<string>>(() => new Set());
  const [importColumnMappingUser, setImportColumnMappingUser] = useState<Record<string, WizardStandardKey>>({});
  const [importLinesLoading, setImportLinesLoading] = useState(false);
  const [importWizardMessage, setImportWizardMessage] = useState<string | null>(null);
  /** Projet appliqué à toutes les lignes sans PROJET mappé / surchargé. */
  const [batchProjet, setBatchProjet] = useState('');
  /** Devise appliquée aux lignes sans CURRENCY mappée / hint montant. */
  const [batchCurrency, setBatchCurrency] = useState('');
  const [learnedMappingProfiles, setLearnedMappingProfiles] = useState<MappingWizardProfile[]>([]);
  const pasteFirstLineAsDataRef = useRef(false);
  const [diskImportFirstLineAsData, setDiskImportFirstLineAsData] = useState(false);
  /** Après import réussi : retirer les lignes importées des CSV du dossier Import. */
  const [removeImportedFromImportFolder, setRemoveImportedFromImportFolder] = useState(false);
  /** Après import réussi : conserver le lot (sinon vide / relecture disque). */
  const [keepBatchAfterImport, setKeepBatchAfterImportState] = useState(() =>
    readBoolStorage(SUPPORT_KEEP_BATCH_KEY, false)
  );
  /** Exiger un projet pour importer (sinon projet vide autorisé). */
  const [requireProjet, setRequireProjetState] = useState(() =>
    readBoolStorage(SUPPORT_REQUIRE_PROJET_KEY, true)
  );

  const setKeepBatchAfterImport = useCallback((v: boolean) => {
    setKeepBatchAfterImportState(v);
    writeBoolStorage(SUPPORT_KEEP_BATCH_KEY, v);
  }, []);

  const setRequireProjet = useCallback((v: boolean) => {
    setRequireProjetState(v);
    writeBoolStorage(SUPPORT_REQUIRE_PROJET_KEY, v);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listMappingWizardProfiles().then((profiles) => {
      if (!cancelled) setLearnedMappingProfiles(profiles);
    });
    return () => {
      cancelled = true;
    };
  }, [folderReloadToken, importWizardReloadKey]);

  const defaultColumnMapping = useMemo(() => {
    if (!model) return {} as Record<string, WizardStandardKey>;
    return buildDefaultColumnMapping(model.columns, learnedMappingProfiles);
  }, [model, learnedMappingProfiles]);

  const importColumnMapping = useMemo(() => {
    if (!model) return {} as Record<string, WizardStandardKey>;
    return { ...defaultColumnMapping, ...importColumnMappingUser };
  }, [model, defaultColumnMapping, importColumnMappingUser]);

  const outputHeaderKeys = SUPPORT_IMPORT_OUTPUT_FIELDS as unknown as SupportImportOutputField[];

  const knownProjectKeys = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      const id = (p.id ?? '').trim();
      const name = (p.name ?? '').trim();
      if (id) set.add(id);
      if (name) set.add(name);
    }
    return set;
  }, [projects]);

  const mappedPreviewByRowId = useMemo(() => {
    const map = new Map<
      string,
      { display: Record<string, string>; draft: SupportImportDraft | null; duplicateExisting: boolean }
    >();
    if (!model?.rows.length) return map;
    for (const row of model.rows) {
      const display = buildSupportMappedDisplay(
        row,
        model.columns,
        importColumnMapping,
        rawCellOverrides[row.id],
        mappedCellOverrides[row.id],
        { defaultProjet: batchProjet, defaultCurrency: batchCurrency, projects }
      );
      const draft = displayToSupportImportDraft(display, { projects, requireProjet });
      let duplicateExisting = false;
      if (draft) {
        const sig = supportImportRowSignature({
          date: draft.date,
          title: draft.title,
          amount: draft.amount,
          currency: draft.currency,
        });
        duplicateExisting = existingSignatures.has(sig);
      } else if ((display.DATE ?? '').trim() && (display.TITLE ?? '').trim()) {
        const sig = supportImportRowSignature({
          date: display.DATE ?? '',
          title: display.TITLE ?? '',
          amount: display.AMOUNT ?? '',
          currency: display.CURRENCY ?? '',
        });
        duplicateExisting = existingSignatures.has(sig);
      }
      map.set(row.id, { display, draft, duplicateExisting });
    }
    return map;
  }, [
    model,
    importColumnMapping,
    rawCellOverrides,
    mappedCellOverrides,
    batchProjet,
    batchCurrency,
    projects,
    existingSignatures,
    requireProjet,
  ]);

  /** Anomalies structurées (doublon existant / lot, chronologie, montant nul, fréquences, projet). */
  const anomalyReasonsByRowId = useMemo(() => {
    const map = new Map<string, AnomalyReason[]>();
    if (!mappingWizardActive || !model?.rows.length) return map;
    const stringRows: Record<string, string>[] = [];
    const rowIdAtIndex: string[] = [];
    for (const row of model.rows) {
      const display = mappedPreviewByRowId.get(row.id)?.display ?? {};
      const rec: Record<string, string> = {};
      for (const k of outputHeaderKeys) {
        rec[k] = display[k] ?? '';
      }
      stringRows.push(rec);
      rowIdAtIndex.push(row.id);
    }
    const { rowAnomalies } = detectSupportAnomalies(outputHeaderKeys as unknown as string[], stringRows, {
      existingSignatures,
      knownProjectKeys,
    });
    for (const a of rowAnomalies) {
      const id = rowIdAtIndex[a.rowIndex - 1];
      if (id) map.set(id, [...a.reasons]);
    }
    return map;
  }, [
    mappingWizardActive,
    model,
    mappedPreviewByRowId,
    outputHeaderKeys,
    existingSignatures,
    knownProjectKeys,
  ]);

  const rowStatusByRowId = useMemo(() => {
    const map = new Map<string, { messages: string[]; showDanger: boolean; isDuplicate: boolean }>();
    if (!model?.rows.length) return map;

    if (!mappingWizardActive) {
      for (const row of model.rows) {
        map.set(row.id, { messages: [], showDanger: false, isDuplicate: false });
      }
      return map;
    }

    for (const row of model.rows) {
      const preview = mappedPreviewByRowId.get(row.id);
      const display = preview?.display ?? {};
      const validationRaw = validateSupportImportDisplay(display, { projects, requireProjet });
      const msgs = validationRaw.map((m) => translateImportPrepMessage(m, t));
      const reasons = anomalyReasonsByRowId.get(row.id) ?? [];
      const filteredReasons = reasons.filter((r) => {
        if (
          r.code === ANOMALY_REASON_CODES.ZERO_AMOUNT &&
          validationRaw.some((m) => /montant/i.test(m))
        ) {
          return false;
        }
        if (
          r.code === ANOMALY_REASON_CODES.SUPPORT_UNKNOWN_PROJECT &&
          validationRaw.some((m) => /projet/i.test(m))
        ) {
          return false;
        }
        return true;
      });
      if (filteredReasons.length > 0) {
        msgs.push(formatAnomalyReasons(filteredReasons, t));
      }
      const isDuplicate =
        (preview?.duplicateExisting ?? false) ||
        reasons.some(
          (r) =>
            r.code === ANOMALY_REASON_CODES.SUPPORT_DUPLICATE_EXISTING ||
            r.code === ANOMALY_REASON_CODES.SUPPORT_DUPLICATE_IN_BATCH
        );
      map.set(row.id, {
        messages: msgs,
        showDanger: msgs.length > 0,
        isDuplicate,
      });
    }
    return map;
  }, [
    model,
    mappingWizardActive,
    mappedPreviewByRowId,
    anomalyReasonsByRowId,
    projects,
    requireProjet,
    t,
    i18n.language,
  ]);

  /**
   * Mode complet : toute alerte (validation, anomalie structurée, doublon existant ou dans le lot)
   * compte pour « Ignorer les anomalies ».
   */
  const anomalousRowIds = useMemo(() => {
    if (!mappingWizardActive || !model?.rows.length) return [] as string[];
    const out: string[] = [];
    for (const row of model.rows) {
      if (rowStatusByRowId.get(row.id)?.showDanger) out.push(row.id);
    }
    return out;
  }, [mappingWizardActive, model?.rows, rowStatusByRowId]);

  const duplicateRowIds = useMemo(() => {
    if (!mappingWizardActive || !model?.rows.length) return [] as string[];
    const ids: string[] = [];
    for (const row of model.rows) {
      if (mappedPreviewByRowId.get(row.id)?.duplicateExisting) ids.push(row.id);
    }
    return ids;
  }, [mappingWizardActive, model?.rows, mappedPreviewByRowId]);

  const importPreviewImportableRows = useMemo(() => {
    if (!mappingWizardActive || !model?.rows.length) return [] as ImportWizardRawRow[];
    const list: ImportWizardRawRow[] = [];
    for (const row of model.rows) {
      if (importRowSkip.has(row.id)) continue;
      const preview = mappedPreviewByRowId.get(row.id);
      if (!preview?.draft || preview.duplicateExisting) continue;
      list.push(row);
    }
    return list;
  }, [mappingWizardActive, model, importRowSkip, mappedPreviewByRowId]);

  const updateRawCell = useCallback(
    (rowId: string, colKey: string, value: string) => {
      const row = model?.rows.find((r) => r.id === rowId);
      const col = model?.columns.find((c) => c.key === colKey);
      if (!row || !col || col.fileName !== row.sourceFile) return;
      const original = row.values[col.colIndex] ?? '';
      setRawCellOverrides((prev) => {
        const nextRow = { ...(prev[rowId] ?? {}) };
        if (value === original) delete nextRow[colKey];
        else nextRow[colKey] = value;
        const next = { ...prev };
        if (Object.keys(nextRow).length === 0) delete next[rowId];
        else next[rowId] = nextRow;
        return next;
      });
    },
    [model]
  );

  const updateMappedCell = useCallback((rowId: string, headerKey: string, value: string) => {
    setMappedCellOverrides((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] ?? {}), [headerKey]: value },
    }));
  }, []);

  const updateImportColumnMappingUser = useCallback((colKey: string, value: WizardStandardKey) => {
    setImportColumnMappingUser((prev) => {
      const next = { ...prev };
      if (value === undefined) {
        delete next[colKey];
      } else {
        next[colKey] = value;
      }
      return next;
    });
  }, []);

  const toggleImportPrepSkipAll = useCallback(() => {
    setImportRowSkip((prev) => {
      const ids = model?.rows.map((r) => r.id) ?? [];
      if (ids.length === 0) return prev;
      const all = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (all) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  }, [model?.rows]);

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

  const importPrepIgnSkipHeader = useMemo(() => {
    const ids = model?.rows.map((r) => r.id) ?? [];
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
  }, [model?.rows, importRowSkip]);

  const importPrepAnomalySkipHeader = useMemo(() => {
    const count = anomalousRowIds.length;
    if (count === 0) {
      return { count: 0, allSkipped: false, someSkipped: false };
    }
    let skipped = 0;
    for (const id of anomalousRowIds) {
      if (importRowSkip.has(id)) skipped += 1;
    }
    return {
      count,
      allSkipped: skipped === count,
      someSkipped: skipped > 0,
    };
  }, [anomalousRowIds, importRowSkip]);

  const importPrepDuplicateSkipHeader = useMemo(() => {
    const count = duplicateRowIds.length;
    if (count === 0) {
      return { count: 0, allSkipped: false, someSkipped: false };
    }
    let skipped = 0;
    for (const id of duplicateRowIds) {
      if (importRowSkip.has(id)) skipped += 1;
    }
    return {
      count,
      allSkipped: skipped === count,
      someSkipped: skipped > 0,
    };
  }, [duplicateRowIds, importRowSkip]);

  /** Bascule utilisateur : mémorise la préférence (auto-activation au prochain collage). */
  const setMappingWizardActiveFromUser = useCallback((v: SetStateAction<boolean>) => {
    setMappingWizardActive((prev) => {
      const next = typeof v === 'function' ? (v as (b: boolean) => boolean)(prev) : v;
      if (next !== prev) {
        setMappedCellOverrides({});
        setPreferMappingActive(next);
        writeMappingPreferActive(SUPPORT_MAPPING_PREFER_ACTIVE_KEY, next);
      }
      return next;
    });
  }, []);

  const seedCurrencyFromModel = useCallback(
    (m: ImportWizardModel) => {
      const matched = findMatchingMappingProfile(
        learnedMappingProfiles,
        m.columns.map((c) => c.label)
      );
      const currencyGuess =
        (m.defaultCurrency ?? '').trim() || (matched?.defaultCurrency ?? '').trim();
      setBatchCurrency((prev) => prev.trim() || currencyGuess || '');
    },
    [learnedMappingProfiles]
  );

  const activateMappingIfPreferred = useCallback(() => {
    const prefer = readMappingPreferActive(SUPPORT_MAPPING_PREFER_ACTIVE_KEY);
    setPreferMappingActive(prefer);
    if (prefer) setMappingWizardActive(true);
  }, []);

  const loadSupportWizard = useCallback(async () => {
    const api = (
      window as unknown as {
        electronAPI?: {
          readDirectory: (p: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;
          readFile: (p: string) => Promise<{ success: boolean; data?: string; error?: string }>;
        };
      }
    ).electronAPI;
    if (!api?.readDirectory || !api?.readFile) {
      setModel(null);
      setImportColumnMappingUser({});
      return;
    }
    setImportWizardLoading(true);
    try {
      const parseOpts: ImportWizardParseOptions | undefined = diskImportFirstLineAsData
        ? { firstLineAsData: true }
        : undefined;
      const next = await loadSupportImportWizardModel(api, parseOpts);
      setModel(next);
      setImportColumnMappingUser({});
      setRawCellOverrides({});
      setMappedCellOverrides({});
      setImportRowSkip(new Set());
      if (next) {
        const matched = findMatchingMappingProfile(
          learnedMappingProfiles,
          next.columns.map((c) => c.label)
        );
        const currencyGuess =
          (next.defaultCurrency ?? '').trim() || (matched?.defaultCurrency ?? '').trim();
        setBatchCurrency((prev) => prev.trim() || currencyGuess || '');
        if (readMappingPreferActive(SUPPORT_MAPPING_PREFER_ACTIVE_KEY)) {
          setPreferMappingActive(true);
          setMappingWizardActive(true);
        }
      } else {
        setMappingWizardActive(false);
      }
    } finally {
      setImportWizardLoading(false);
    }
    // learnedMappingProfiles volontairement hors deps : éviter d’écraser un collage
    // lorsque les profils arrivent après le premier chargement disque.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- profiles used as snapshot at load time
  }, [diskImportFirstLineAsData]);

  useEffect(() => {
    void loadSupportWizard();
  }, [loadSupportWizard, importWizardReloadKey, folderReloadToken]);

  const applySupportWizardClipboardPaste = useCallback(
    (raw: string, parseOptions?: ImportWizardParseOptions) => {
      const pasted = buildImportWizardModelFromClipboardText(raw, parseOptions);
      if (!pasted?.rows.length) {
        setImportWizardMessage(t('transactions.importPrep.pasteEmpty'));
        return;
      }
      pasteFirstLineAsDataRef.current = !!parseOptions?.firstLineAsData;
      setModel((prev) => (prev ? mergeImportWizardModels(prev, pasted) : pasted));
      setImportColumnMappingUser({});
      setRawCellOverrides({});
      setMappedCellOverrides({});
      setImportRowSkip(new Set());
      seedCurrencyFromModel(pasted);
      activateMappingIfPreferred();

      const src = pasted.rows[0]?.sourceFile ?? t('transactions.importPrep.clipboardSource');
      setImportWizardMessage(
        t('transactions.importPrep.pasteAdded', { count: pasted.rows.length, source: src })
      );
    },
    [t, seedCurrencyFromModel, activateMappingIfPreferred]
  );

  const applySupportWizardFiles = useCallback(
    (
      files: { name: string; content: string }[],
      parseOptions?: ImportWizardParseOptions
    ) => {
      if (!files.length) {
        setImportWizardMessage(t('support.importPrep.fileEmpty'));
        return;
      }
      pasteFirstLineAsDataRef.current = !!parseOptions?.firstLineAsData;
      let merged: ImportWizardModel | null = null;
      let added = 0;
      const names: string[] = [];
      for (const f of files) {
        const part = buildImportWizardModelFromFileContent(f.content, f.name, parseOptions);
        if (!part?.rows.length) continue;
        merged = merged ? mergeImportWizardModels(merged, part) : part;
        added += part.rows.length;
        names.push(f.name);
      }
      if (!merged || added === 0) {
        setImportWizardMessage(t('support.importPrep.fileEmpty'));
        return;
      }
      setModel((prev) => (prev ? mergeImportWizardModels(prev, merged!) : merged));
      setImportColumnMappingUser({});
      setRawCellOverrides({});
      setMappedCellOverrides({});
      setImportRowSkip(new Set());
      seedCurrencyFromModel(merged);
      activateMappingIfPreferred();
      setImportWizardMessage(
        t('support.importPrep.fileAdded', {
          count: added,
          source: names.join(', '),
        })
      );
    },
    [t, seedCurrencyFromModel, activateMappingIfPreferred]
  );

  const removeSourceFromBatch = useCallback(
    (sourceFile: string) => {
      setModel((prev) => {
        if (!prev) return prev;
        const next = removeSourceFromImportWizardModel(prev, sourceFile);
        if (!next) {
          setImportColumnMappingUser({});
          setRawCellOverrides({});
          setMappedCellOverrides({});
          setImportRowSkip(new Set());
          setMappingWizardActive(false);
          setImportWizardMessage(t('support.importPrep.sourceRemovedEmpty', { name: sourceFile }));
          return null;
        }
        setImportRowSkip((skip) => {
          const keep = new Set<string>();
          for (const id of skip) {
            if (next.rows.some((r) => r.id === id)) keep.add(id);
          }
          return keep;
        });
        setImportWizardMessage(t('support.importPrep.sourceRemoved', { name: sourceFile }));
        return next;
      });
    },
    [t]
  );

  const createProjectAndAssignBatch = useCallback(
    (name: string) => {
      const created = addProjectByName(name);
      if (!created) {
        setImportWizardMessage(t('support.importPrep.createProjetFailed'));
        return;
      }
      setBatchProjet(created.id);
      setImportWizardMessage(t('support.importPrep.createProjetDone', { name: created.name }));
    },
    [t]
  );

  const clearWizardBatch = useCallback(() => {
    setBatchProjet('');
    setBatchCurrency('');
    setImportWizardMessage(t('support.importPrep.batchCleared'));
    setImportWizardReloadKey((k) => k + 1);
  }, [t]);

  const handleOpenImportFolder = useCallback(async () => {
    const api = (window as unknown as {
      electronAPI?: { openSupportImportFolder: () => Promise<{ success: boolean; error?: string }> };
    }).electronAPI;
    if (!api?.openSupportImportFolder) return;
    const result = await api.openSupportImportFolder();
    if (!result.success && result.error) {
      setImportWizardMessage(result.error);
    }
  }, []);

  const saveLearnedMappingProfile = useCallback(async () => {
    if (!model?.columns.length) {
      setImportWizardMessage(t('transactions.importPrep.saveMappingProfileNoColumns'));
      return;
    }
    const fileNames = [...new Set(model.columns.map((c) => c.fileName))];
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
    const fileCols = model.columns.filter((c) => c.fileName === fileName);
    const headerLabels = fileCols.map((c) => c.label);
    const effective = { ...defaultColumnMapping, ...importColumnMappingUser };
    const columnMap: Record<string, string> = {};
    for (const col of fileCols) {
      columnMap[col.label] = effective[col.key] ?? '';
    }
    const r = await upsertMappingWizardProfile({
      name: trimmed,
      headerLabels,
      columnMap,
      firstLineAsData: pasteFirstLineAsDataRef.current || undefined,
      defaultCurrency: batchCurrency.trim() || model.defaultCurrency,
    });
    if (!r.ok) {
      setImportWizardMessage(r.error);
      return;
    }
    setLearnedMappingProfiles(r.profiles);
    setImportWizardMessage(t('transactions.importPrep.saveMappingProfileDone', { name: r.profile.name }));
  }, [model, defaultColumnMapping, importColumnMappingUser, batchCurrency, t]);

  /** Force la devise du lot sur toutes les lignes (override cellule CURRENCY). */
  const forceBatchCurrencyOnAllRows = useCallback(() => {
    const cur = batchCurrency.trim().toUpperCase();
    if (!cur || !model?.rows.length) {
      setImportWizardMessage(t('support.importPrep.forceCurrencyNeedBatch'));
      return;
    }
    setMappedCellOverrides((prev) => {
      const next = { ...prev };
      for (const row of model.rows) {
        next[row.id] = { ...(next[row.id] ?? {}), CURRENCY: cur };
      }
      return next;
    });
    setImportWizardMessage(t('support.importPrep.forceCurrencyDone', { currency: cur, count: model.rows.length }));
  }, [batchCurrency, model, t]);

  /** Force le projet du lot sur toutes les lignes (override cellule PROJET). */
  const forceBatchProjetOnAllRows = useCallback(() => {
    const pid = batchProjet.trim();
    if (!pid || !model?.rows.length) {
      setImportWizardMessage(t('support.importPrep.forceProjetNeedBatch'));
      return;
    }
    setMappedCellOverrides((prev) => {
      const next = { ...prev };
      for (const row of model.rows) {
        next[row.id] = { ...(next[row.id] ?? {}), [TRANSACTION_PROJET_COLUMN]: pid };
      }
      return next;
    });
    const label = projetLabelForId(projects, pid) || pid;
    setImportWizardMessage(
      t('support.importPrep.forceProjetDone', { projet: label, count: model.rows.length })
    );
  }, [batchProjet, model, projects, t]);

  /** Ignore (ou rétablit) toutes les lignes avec alerte (anomalie et/ou doublon). */
  const skipAllAlertRows = useCallback(() => {
    if (!model?.rows.length) return;
    const alertIds = model.rows
      .filter((row) => rowStatusByRowId.get(row.id)?.showDanger)
      .map((row) => row.id);
    if (alertIds.length === 0) return;
    setImportRowSkip((prev) => {
      const allSkipped = alertIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSkipped) {
        for (const id of alertIds) next.delete(id);
      } else {
        for (const id of alertIds) next.add(id);
      }
      return next;
    });
  }, [model, rowStatusByRowId]);

  const importSummary = useMemo(() => {
    const total = model?.rows.length ?? 0;
    if (!mappingWizardActive || total === 0) {
      return {
        total,
        skipped: 0,
        importable: 0,
        duplicates: 0,
        alerts: 0,
        currencyParts: [] as { currency: string; count: number }[],
        projetLabel: null as string | null,
        projetMixed: false,
      };
    }
    let skipped = 0;
    let importable = 0;
    let duplicates = 0;
    let alerts = 0;
    const currencyCounts = new Map<string, number>();
    const projetIds = new Set<string>();
    for (const row of model!.rows) {
      const preview = mappedPreviewByRowId.get(row.id);
      const st = rowStatusByRowId.get(row.id);
      if (importRowSkip.has(row.id)) skipped += 1;
      if (preview?.duplicateExisting) duplicates += 1;
      if (st?.showDanger) alerts += 1;
      if (!importRowSkip.has(row.id) && preview?.draft && !preview.duplicateExisting) {
        importable += 1;
        const cur = preview.draft.currency || '?';
        currencyCounts.set(cur, (currencyCounts.get(cur) ?? 0) + 1);
        if (preview.draft.projet) projetIds.add(preview.draft.projet);
      }
    }
    const currencyParts = [...currencyCounts.entries()]
      .map(([currency, count]) => ({ currency, count }))
      .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));
    let projetLabel: string | null = null;
    let projetMixed = false;
    if (projetIds.size === 1) {
      const id = [...projetIds][0]!;
      projetLabel = projetLabelForId(projects, id) || id;
    } else if (projetIds.size > 1) {
      projetMixed = true;
    }
    return {
      total,
      skipped,
      importable,
      duplicates,
      alerts,
      currencyParts,
      projetLabel,
      projetMixed,
    };
  }, [
    model,
    mappingWizardActive,
    mappedPreviewByRowId,
    rowStatusByRowId,
    importRowSkip,
    projects,
  ]);

  const handleImportLinesToSupport = useCallback(async () => {
    if (!mappingWizardActive) {
      setImportWizardMessage(t('support.importPrep.enableMappingFirst'));
      return;
    }
    if (!model?.rows.length) {
      setImportWizardMessage(t('transactions.importPrep.noRowsToImport'));
      return;
    }

    const drafts: SupportImportDraft[] = [];
    const importedDiskRows: { id: string; sourceFile: string }[] = [];
    for (const row of model.rows) {
      if (importRowSkip.has(row.id)) continue;
      const preview = mappedPreviewByRowId.get(row.id);
      if (!preview?.draft || preview.duplicateExisting) continue;
      drafts.push(preview.draft);
      if (/\.csv$/i.test(row.sourceFile) && !/^Presse-papiers_/i.test(row.sourceFile)) {
        importedDiskRows.push({ id: row.id, sourceFile: row.sourceFile });
      }
    }

    if (drafts.length === 0) {
      setImportWizardMessage(t('support.importPrep.noValidRows'));
      return;
    }

    setImportLinesLoading(true);
    setImportWizardMessage(null);
    try {
      const result = await onImportLines(drafts);
      if (result.success) {
        const count = result.appendedCount ?? drafts.length;
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
              importFilePath: supportImportFile,
              api: fileApi,
            });
            if (!diskResult.success) {
              setImportWizardMessage(
                t('transactions.importPrep.appendedWithDiskFail', {
                  count,
                  error: diskResult.error ?? t('transactions.importPrep.unknownError'),
                })
              );
              setImportWizardReloadKey((k) => k + 1);
              return;
            }
            if (diskResult.removedLineCount > 0) {
              const parts: string[] = [];
              if (diskResult.updatedFiles.length) {
                parts.push(
                  t('transactions.importPrep.filesUpdated', { count: diskResult.updatedFiles.length })
                );
              }
              if (diskResult.deletedFiles.length) {
                parts.push(
                  t('transactions.importPrep.filesDeleted', { count: diskResult.deletedFiles.length })
                );
              }
              diskMsg = t('transactions.importPrep.diskRemoved', {
                count: diskResult.removedLineCount,
                detail: parts.length ? ` (${parts.join(', ')})` : '',
              });
            }
          }
        }
        if (keepBatchAfterImport) {
          setImportWizardMessage(
            diskMsg
              ? `${t('support.importPrep.appendedKeepBatch', { count })} ${diskMsg}`
              : t('support.importPrep.appendedKeepBatch', { count })
          );
          if (removeImportedFromImportFolder && importedDiskRows.length > 0) {
            setImportWizardReloadKey((k) => k + 1);
          }
        } else {
          setBatchProjet('');
          setBatchCurrency('');
          setImportWizardMessage(
            diskMsg
              ? `${t('support.importPrep.appended', { count })} ${diskMsg}`
              : t('support.importPrep.appended', { count })
          );
          setImportWizardReloadKey((k) => k + 1);
        }
      } else {
        setImportWizardMessage(result.error ?? t('transactions.importPrep.importFailed'));
      }
    } finally {
      setImportLinesLoading(false);
    }
  }, [
    mappingWizardActive,
    model,
    importRowSkip,
    mappedPreviewByRowId,
    onImportLines,
    keepBatchAfterImport,
    removeImportedFromImportFolder,
    t,
  ]);

  return {
    supportImportWizardModel: model,
    importWizardLoading,
    applySupportWizardClipboardPaste,
    clearWizardBatch,
    handleOpenImportFolder,
    mappingWizardActive,
    setMappingWizardActive: setMappingWizardActiveFromUser,
    preferMappingActive,
    diskImportFirstLineAsData,
    setDiskImportFirstLineAsData,
    removeImportedFromImportFolder,
    setRemoveImportedFromImportFolder,
    importColumnMapping,
    importColumnMappingUser,
    defaultColumnMapping,
    updateImportColumnMappingUser,
    rawCellOverrides,
    mappedCellOverrides,
    importRowSkip,
    setImportRowSkip,
    importLinesLoading,
    importWizardMessage,
    setImportWizardMessage,
    outputHeaderKeys,
    mappedPreviewByRowId,
    rowStatusByRowId,
    updateRawCell,
    updateMappedCell,
    importPreviewImportableRows,
    importPrepIgnSkipHeader,
    importPrepAnomalySkipHeader,
    importPrepDuplicateSkipHeader,
    toggleImportPrepSkipAll,
    toggleSkipAllAnomalous,
    toggleSkipAllDuplicates,
    handleImportLinesToSupport,
    saveLearnedMappingProfile,
    batchProjet,
    setBatchProjet,
    batchCurrency,
    setBatchCurrency,
    forceBatchCurrencyOnAllRows,
    forceBatchProjetOnAllRows,
    skipAllAlertRows,
    importSummary,
    applySupportWizardFiles,
    removeSourceFromBatch,
    createProjectAndAssignBatch,
    keepBatchAfterImport,
    setKeepBatchAfterImport,
    requireProjet,
    setRequireProjet,
    projects,
  };
}
