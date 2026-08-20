import { useState, useMemo, useCallback, type SetStateAction } from 'react';
import {
  buildImportWizardModelFromClipboardText,
  mergeImportWizardModels,
  buildDefaultColumnMapping,
  buildSupportMappedDisplay,
  validateSupportImportDisplay,
  displayToSupportImportDraft,
  SUPPORT_IMPORT_OUTPUT_FIELDS,
  type ImportWizardModel,
  type ImportWizardParseOptions,
  type ImportWizardRawRow,
  type WizardStandardKey,
  type SupportImportDraft,
  type SupportImportOutputField,
} from '../services/supportImportWizardService';

export function useSupportImportPrepWizard(options: {
  /** Après import réussi vers Support_data.csv. */
  onImportLines: (drafts: SupportImportDraft[]) => Promise<{ success: boolean; error?: string; appendedCount?: number }>;
}) {
  const { onImportLines } = options;

  const [model, setModel] = useState<ImportWizardModel | null>(null);
  const [mappingWizardActive, setMappingWizardActive] = useState(false);
  const [rawCellOverrides, setRawCellOverrides] = useState<Record<string, Record<string, string>>>({});
  const [mappedCellOverrides, setMappedCellOverrides] = useState<Record<string, Record<string, string>>>({});
  const [importRowSkip, setImportRowSkip] = useState<Set<string>>(() => new Set());
  const [importColumnMappingUser, setImportColumnMappingUser] = useState<Record<string, WizardStandardKey>>({});
  const [importLinesLoading, setImportLinesLoading] = useState(false);
  const [importWizardMessage, setImportWizardMessage] = useState<string | null>(null);

  const importColumnMapping = useMemo(() => {
    if (!model) return {} as Record<string, WizardStandardKey>;
    const auto = buildDefaultColumnMapping(model.columns);
    return { ...auto, ...importColumnMappingUser };
  }, [model, importColumnMappingUser]);

  const outputHeaderKeys = SUPPORT_IMPORT_OUTPUT_FIELDS as unknown as SupportImportOutputField[];

  const mappedPreviewByRowId = useMemo(() => {
    const map = new Map<string, { display: Record<string, string>; draft: SupportImportDraft | null }>();
    if (!model?.rows.length) return map;
    for (const row of model.rows) {
      const display = buildSupportMappedDisplay(
        row,
        model.columns,
        importColumnMapping,
        rawCellOverrides[row.id],
        mappedCellOverrides[row.id]
      );
      map.set(row.id, { display, draft: displayToSupportImportDraft(display) });
    }
    return map;
  }, [model, importColumnMapping, rawCellOverrides, mappedCellOverrides]);

  const rowStatusByRowId = useMemo(() => {
    const map = new Map<string, { messages: string[]; showDanger: boolean }>();
    if (!model?.rows.length) return map;

    if (!mappingWizardActive) {
      for (const row of model.rows) {
        map.set(row.id, { messages: [], showDanger: false });
      }
      return map;
    }

    for (const row of model.rows) {
      const display = mappedPreviewByRowId.get(row.id)?.display ?? {};
      const msgs = validateSupportImportDisplay(display);
      map.set(row.id, { messages: msgs, showDanger: msgs.length > 0 });
    }
    return map;
  }, [model, mappingWizardActive, mappedPreviewByRowId]);

  const anomalousRowIds = useMemo(() => {
    if (!mappingWizardActive || !model?.rows.length) return [] as string[];
    const ids: string[] = [];
    for (const row of model.rows) {
      if (rowStatusByRowId.get(row.id)?.showDanger) ids.push(row.id);
    }
    return ids;
  }, [mappingWizardActive, model?.rows, rowStatusByRowId]);

  const importPreviewImportableRows = useMemo(() => {
    if (!mappingWizardActive || !model?.rows.length) return [] as ImportWizardRawRow[];
    const list: ImportWizardRawRow[] = [];
    for (const row of model.rows) {
      if (importRowSkip.has(row.id)) continue;
      const draft = mappedPreviewByRowId.get(row.id)?.draft;
      if (!draft) continue;
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

  const setMappingWizardActiveWrapped = useCallback((v: SetStateAction<boolean>) => {
    setMappingWizardActive((prev) => {
      const next = typeof v === 'function' ? (v as (b: boolean) => boolean)(prev) : v;
      if (next !== prev) setMappedCellOverrides({});
      return next;
    });
  }, []);

  const applySupportWizardClipboardPaste = useCallback(
    (raw: string, parseOptions?: ImportWizardParseOptions) => {
      const pasted = buildImportWizardModelFromClipboardText(raw, parseOptions);
      if (!pasted?.rows.length) {
        setImportWizardMessage('Collage vide ou aucune ligne de données exploitable.');
        return;
      }
      setModel((prev) => (prev ? mergeImportWizardModels(prev, pasted) : pasted));
      setImportColumnMappingUser({});
      setRawCellOverrides({});
      setMappedCellOverrides({});
      setImportRowSkip(new Set());
      const src = pasted.rows[0]?.sourceFile ?? 'presse-papiers';
      setImportWizardMessage(`${pasted.rows.length} ligne(s) ajoutée(s) depuis le presse-papiers (${src}).`);
    },
    []
  );

  const clearWizardBatch = useCallback(() => {
    setModel(null);
    setImportColumnMappingUser({});
    setRawCellOverrides({});
    setMappedCellOverrides({});
    setImportRowSkip(new Set());
    setMappingWizardActive(false);
    setImportWizardMessage('Lot d’import vidé.');
  }, []);

  const handleImportLinesToSupport = useCallback(async () => {
    if (!mappingWizardActive) {
      setImportWizardMessage(
        'Activez le mapping wizard pour préparer et importer les lignes vers Support_data.csv.'
      );
      return;
    }
    if (!model?.rows.length) {
      setImportWizardMessage('Aucune ligne à importer.');
      return;
    }

    const drafts: SupportImportDraft[] = [];
    for (const row of model.rows) {
      if (importRowSkip.has(row.id)) continue;
      const draft = mappedPreviewByRowId.get(row.id)?.draft;
      if (!draft) continue;
      drafts.push(draft);
    }

    if (drafts.length === 0) {
      setImportWizardMessage(
        'Aucune ligne valide à ajouter (vérifiez les alertes ou les lignes ignorées).'
      );
      return;
    }

    setImportLinesLoading(true);
    setImportWizardMessage(null);
    try {
      const result = await onImportLines(drafts);
      if (result.success) {
        setModel(null);
        setImportColumnMappingUser({});
        setRawCellOverrides({});
        setMappedCellOverrides({});
        setImportRowSkip(new Set());
        setMappingWizardActive(false);
        setImportWizardMessage(
          `${result.appendedCount ?? drafts.length} ligne(s) ajoutée(s) à Support_data.csv.`
        );
      } else {
        setImportWizardMessage(result.error ?? 'Erreur lors de l’import.');
      }
    } finally {
      setImportLinesLoading(false);
    }
  }, [mappingWizardActive, model, importRowSkip, mappedPreviewByRowId, onImportLines]);

  return {
    supportImportWizardModel: model,
    applySupportWizardClipboardPaste,
    clearWizardBatch,
    mappingWizardActive,
    setMappingWizardActive: setMappingWizardActiveWrapped,
    importColumnMapping,
    importColumnMappingUser,
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
    toggleImportPrepSkipAll,
    toggleSkipAllAnomalous,
    handleImportLinesToSupport,
  };
}
