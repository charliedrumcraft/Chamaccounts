import { useState, useEffect, useMemo, useCallback, type SetStateAction } from 'react';
import {
  loadAccountBalanceImportWizardModel,
  buildAbImportWizardModelFromClipboardText,
  mergeAbImportWizardModels,
  buildImportRecordFromRawRow,
  balanceRowFromImportRecord,
  formatBalanceRowForWizardDisplay,
  balanceRowFromMappedDisplayRecord,
  orderedAccountEntries,
  rawRowQuickWarnings,
  type AbImportWizardParseOptions,
  type AbImportWizardModel,
  type AbImportWizardRawRow,
} from '../services/accountBalanceImportWizardService';
import { detectAccountBalanceAnomalies, type AccountBalanceActiveAccount } from '../services/AnomalyDetectionService';
import { loadRecognisedAccountsFromStorage } from '../constants/recognisedAccountsStorage';
import { AccountBalanceCSVService } from '../services/AccountBalanceCSVService';
import { format, startOfDay } from 'date-fns';

function dateKeyForExistingRow(d: Date): string {
  return format(startOfDay(d), 'yyyy-MM-dd');
}

export function useAccountBalanceImportPrepWizard(options: {
  recognisedAccountsReloadKey?: string;
  /** Dates déjà présentes dans src_account_balance.csv (clé yyyy-MM-dd). */
  existingBalanceDateKeys: Set<string>;
  onAfterSuccessfulAppend?: () => void;
  folderReloadToken?: number;
}) {
  const {
    recognisedAccountsReloadKey = '',
    existingBalanceDateKeys,
    onAfterSuccessfulAppend,
    folderReloadToken = 0,
  } = options;

  const [model, setModel] = useState<AbImportWizardModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [mappingWizardActive, setMappingWizardActive] = useState(false);
  const [rawCellOverrides, setRawCellOverrides] = useState<Record<string, Record<string, string>>>({});
  const [mappedCellOverrides, setMappedCellOverrides] = useState<Record<string, Record<string, string>>>({});
  const [importRowSkip, setImportRowSkip] = useState<Set<string>>(() => new Set());
  const [importLinesLoading, setImportLinesLoading] = useState(false);
  const [importWizardMessage, setImportWizardMessage] = useState<string | null>(null);
  const [diskImportFirstLineAsData, setDiskImportFirstLineAsData] = useState(false);
  /** Cible d’en-tête par colonne : absent = auto (libellé brut), '' = ignorer, sinon DATE ou nom de compte. */
  const [abColumnTargetUser, setAbColumnTargetUser] = useState<Record<string, string>>({});

  const loadWizard = useCallback(async () => {
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
      setAbColumnTargetUser({});
      return;
    }
    setLoading(true);
    try {
      const parseOpts: AbImportWizardParseOptions | undefined = diskImportFirstLineAsData
        ? { firstLineAsData: true }
        : undefined;
      const m = await loadAccountBalanceImportWizardModel(api, parseOpts);
      setModel(m);
      if (m) {
        setRawCellOverrides({});
        setMappedCellOverrides({});
        setImportRowSkip(new Set());
        setAbColumnTargetUser({});
      } else {
        setAbColumnTargetUser({});
      }
    } finally {
      setLoading(false);
    }
  }, [diskImportFirstLineAsData]);

  useEffect(() => {
    void loadWizard();
  }, [loadWizard, reloadKey, folderReloadToken, recognisedAccountsReloadKey]);

  const recognised = useMemo(() => loadRecognisedAccountsFromStorage(), [recognisedAccountsReloadKey]);

  const activeAccounts: AccountBalanceActiveAccount[] = useMemo(
    () =>
      recognised
        .map((a) => ({ name: a.name.trim(), currency: a.currency }))
        .filter((a) => a.name),
    [recognised]
  );

  const outputHeaderKeys = useMemo(() => {
    const ordered = orderedAccountEntries(recognised);
    return ['DATE', ...ordered.map((e) => e.name)] as string[];
  }, [recognised]);

  const mappedPreviewByRowId = useMemo(() => {
    const map = new Map<
      string,
      { display: Record<string, string>; balanceRow: ReturnType<typeof balanceRowFromImportRecord> }
    >();
    if (!model?.rows.length) return map;
    for (const row of model.rows) {
      const rec = buildImportRecordFromRawRow(row, model.columns, rawCellOverrides, abColumnTargetUser);
      const br = balanceRowFromImportRecord(rec);
      const base = br ? formatBalanceRowForWizardDisplay(br, recognised) : {};
      const ov = mappedCellOverrides[row.id] ?? {};
      const display: Record<string, string> = {};
      for (const k of outputHeaderKeys) {
        const baseVal = base[k] ?? '';
        display[k] = ov[k] !== undefined ? ov[k]! : baseVal;
      }
      map.set(row.id, { display, balanceRow: br });
    }
    return map;
  }, [model, rawCellOverrides, mappedCellOverrides, recognised, outputHeaderKeys, abColumnTargetUser]);

  const anomalyResultMapped = useMemo(() => {
    if (!mappingWizardActive || !model?.rows.length) {
      return { fileLevelReasons: [] as string[], rowReasonsByRowId: new Map<string, string[]>() };
    }
    const stringRows: Record<string, string>[] = [];
    const rowIdAtIndex: string[] = [];
    for (const row of model.rows) {
      const prev = mappedPreviewByRowId.get(row.id);
      const display = prev?.display ?? {};
      const rec: Record<string, string> = {};
      for (const k of outputHeaderKeys) {
        rec[k] = display[k] ?? '';
      }
      stringRows.push(rec);
      rowIdAtIndex.push(row.id);
    }
    const { fileLevelReasons, rowAnomalies } = detectAccountBalanceAnomalies(
      outputHeaderKeys,
      stringRows,
      activeAccounts
    );
    const rowReasonsByRowId = new Map<string, string[]>();
    for (const a of rowAnomalies) {
      const id = rowIdAtIndex[a.rowIndex - 1];
      if (id) rowReasonsByRowId.set(id, [...a.reasons]);
    }
    return { fileLevelReasons, rowReasonsByRowId };
  }, [mappingWizardActive, model, mappedPreviewByRowId, outputHeaderKeys, activeAccounts]);

  const rowStatusByRowId = useMemo(() => {
    const map = new Map<string, { messages: string[]; showDanger: boolean }>();
    if (!model?.rows.length) return map;

    if (!mappingWizardActive) {
      for (const row of model.rows) {
        const rec = buildImportRecordFromRawRow(row, model.columns, rawCellOverrides, abColumnTargetUser);
        const msgs = rawRowQuickWarnings(rec);
        map.set(row.id, { messages: msgs, showDanger: msgs.length > 0 });
      }
      return map;
    }

    const { rowReasonsByRowId } = anomalyResultMapped;
    const dupMsg = 'Date déjà présente dans src_account_balance.csv';
    for (const row of model.rows) {
      const aside: string[] = [...(rowReasonsByRowId.get(row.id) ?? [])];
      const prev = mappedPreviewByRowId.get(row.id);
      const br = prev ? balanceRowFromMappedDisplayRecord(prev.display, recognised) : null;
      if (br) {
        const k = dateKeyForExistingRow(br.date);
        if (existingBalanceDateKeys.has(k)) aside.push(dupMsg);
      } else {
        aside.push('Ligne incomplète : date ou au moins un solde reconnu requis pour l’import.');
      }
      map.set(row.id, { messages: aside, showDanger: aside.length > 0 });
    }
    return map;
  }, [
    model,
    mappingWizardActive,
    rawCellOverrides,
    anomalyResultMapped,
    mappedPreviewByRowId,
    mappedCellOverrides,
    recognised,
    existingBalanceDateKeys,
    abColumnTargetUser,
  ]);

  const importPreviewImportableRows = useMemo(() => {
    if (!mappingWizardActive || !model?.rows.length) return [] as AbImportWizardRawRow[];
    const list: AbImportWizardRawRow[] = [];
    for (const row of model.rows) {
      if (importRowSkip.has(row.id)) continue;
      const prev = mappedPreviewByRowId.get(row.id);
      const br = prev ? balanceRowFromMappedDisplayRecord(prev.display, recognised) : null;
      if (!br) continue;
      if (existingBalanceDateKeys.has(dateKeyForExistingRow(br.date))) continue;
      list.push(row);
    }
    return list;
  }, [
    mappingWizardActive,
    model,
    importRowSkip,
    mappedPreviewByRowId,
    recognised,
    existingBalanceDateKeys,
  ]);

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

  const importPrepIgnSkipHeader = useMemo(() => {
    const ids = model?.rows.map((r) => r.id) ?? [];
    if (ids.length === 0) return { allSkipped: false, someSkipped: false };
    let skipped = 0;
    for (const id of ids) {
      if (importRowSkip.has(id)) skipped += 1;
    }
    return { allSkipped: skipped === ids.length, someSkipped: skipped > 0 };
  }, [model?.rows, importRowSkip]);

  const handleImportLinesToSource = useCallback(async () => {
    if (!mappingWizardActive) {
      setImportWizardMessage(
        'Activez le mapping wizard pour préparer et importer les lignes vers src_account_balance.csv.'
      );
      return;
    }
    if (importPreviewImportableRows.length === 0) {
      setImportWizardMessage(
        'Aucune ligne importable (vérifiez les anomalies, doublons de date ou lignes ignorées).'
      );
      return;
    }
    const existing = await AccountBalanceCSVService.loadAllBalanceRows();
    if (!existing) {
      setImportWizardMessage('Impossible de lire src_account_balance.csv.');
      return;
    }
    const byTime = new Map<number, (typeof existing)[0]>();
    for (const r of existing) {
      byTime.set(r.date.getTime(), r);
    }
    let added = 0;
    for (const row of importPreviewImportableRows) {
      const prev = mappedPreviewByRowId.get(row.id);
      const br = prev ? balanceRowFromMappedDisplayRecord(prev.display, recognised) : null;
      if (!br) continue;
      const t = br.date.getTime();
      if (byTime.has(t)) continue;
      byTime.set(t, br);
      added++;
    }
    if (added === 0) {
      setImportWizardMessage('Aucune ligne nouvelle à fusionner (dates déjà présentes ou données invalides).');
      return;
    }
    const merged = [...byTime.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
    setImportLinesLoading(true);
    setImportWizardMessage(null);
    try {
      const result = await AccountBalanceCSVService.saveBalanceRowsToProcessed(merged, recognised);
      if (result.success) {
        onAfterSuccessfulAppend?.();
        setReloadKey((k) => k + 1);
        setImportWizardMessage(`${added} ligne(s) ajoutée(s) à src_account_balance.csv.`);
      } else {
        setImportWizardMessage(result.error ?? 'Erreur lors de l’enregistrement.');
      }
    } finally {
      setImportLinesLoading(false);
    }
  }, [
    mappingWizardActive,
    importPreviewImportableRows,
    mappedPreviewByRowId,
    recognised,
    onAfterSuccessfulAppend,
  ]);

  const setMappingWizardActiveWrapped = useCallback((v: SetStateAction<boolean>) => {
    setMappingWizardActive((prev) => {
      const next = typeof v === 'function' ? (v as (b: boolean) => boolean)(prev) : v;
      if (next !== prev) setMappedCellOverrides({});
      return next;
    });
  }, []);

  const updateAbColumnTargetUser = useCallback((colKey: string, value: string) => {
    setAbColumnTargetUser((prev) => {
      const next = { ...prev };
      if (value === '__AUTO__') {
        delete next[colKey];
      } else {
        next[colKey] = value;
      }
      return Object.keys(next).length === 0 ? {} : next;
    });
  }, []);

  const applyAccountBalanceWizardClipboardPaste = useCallback(
    (raw: string, parseOptions?: AbImportWizardParseOptions) => {
      const pasted = buildAbImportWizardModelFromClipboardText(raw, parseOptions);
      if (!pasted?.rows.length) {
        setImportWizardMessage('Collage vide ou aucune ligne de données exploitable.');
        return;
      }
      setModel((prev) => (prev ? mergeAbImportWizardModels(prev, pasted) : pasted));
      const src = pasted.rows[0]?.sourceFile ?? 'presse-papiers';
      setImportWizardMessage(`${pasted.rows.length} ligne(s) ajoutée(s) depuis le presse-papiers (${src}).`);
    },
    []
  );

  return {
    abImportWizardModel: model,
    abImportWizardLoading: loading,
    applyAccountBalanceWizardClipboardPaste,
    diskImportFirstLineAsData,
    setDiskImportFirstLineAsData,
    abColumnTargetUser,
    updateAbColumnTargetUser,
    mappingWizardActive,
    setMappingWizardActive: setMappingWizardActiveWrapped,
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
    fileLevelAnomalyReasons: anomalyResultMapped.fileLevelReasons,
    updateRawCell,
    updateMappedCell,
    importPreviewImportableRows,
    importPrepIgnSkipHeader,
    toggleImportPrepSkipAll,
    handleImportLinesToSource,
    recognised,
  };
}
