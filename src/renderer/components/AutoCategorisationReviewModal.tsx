import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  confidenceToPercent,
  type AutoCatSource,
  type CategorySuggestion,
  type FixedAutoCatMatch,
  type FixedAutoCatRule,
} from '@/shared/autoCategorisation';
import {
  createFixedAutoCatRule,
  findDuplicateFixedAutoCatRule,
  loadFixedAutoCatRules,
  saveFixedAutoCatRules,
} from '../services/autoCategorisationRulesStorage';

export type AutoCatReviewRow = {
  rowId: string;
  title: string;
  date: string;
  suggestedType: string;
  confidence: number;
  source: AutoCatSource;
  selected: boolean;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  rows: AutoCatReviewRow[];
  /** Types reconnus (suggestions pour le champ TYPE des règles). */
  knownTypes?: string[];
  onApplySelected: (selected: AutoCatReviewRow[]) => void;
  onRulesChanged: (rules: FixedAutoCatRule[]) => void;
};

function sourceLabel(
  source: AutoCatSource,
  t: (k: string) => string
): string {
  if (source === 'rule') return t('transactions.importPrep.autoCatSourceRule');
  if (source === 'similarity') return t('transactions.importPrep.autoCatSourceSimilarity');
  if (source === 'words') return t('transactions.importPrep.autoCatSourceWords');
  return '—';
}

function confidenceTone(pct: number): string {
  if (pct >= 70) return 'bg-emerald-100 text-emerald-800';
  if (pct >= 40) return 'bg-amber-100 text-amber-900';
  return 'bg-rose-100 text-rose-800';
}

const MATCH_OPTIONS: FixedAutoCatMatch[] = ['contains', 'equals', 'startsWith'];

export default function AutoCategorisationReviewModal({
  isOpen,
  onClose,
  rows,
  knownTypes = [],
  onApplySelected,
  onRulesChanged,
}: Props) {
  const { t } = useTranslation();
  const [localRows, setLocalRows] = useState<AutoCatReviewRow[]>(rows);
  const [rules, setRules] = useState<FixedAutoCatRule[]>(() => loadFixedAutoCatRules());
  const [draftPattern, setDraftPattern] = useState('');
  const [draftType, setDraftType] = useState('');
  const [draftMatch, setDraftMatch] = useState<FixedAutoCatMatch>('contains');
  const [rulesMessage, setRulesMessage] = useState<string | null>(null);

  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  useEffect(() => {
    if (isOpen) {
      setRules(loadFixedAutoCatRules());
      setRulesMessage(null);
    }
  }, [isOpen]);

  const selectedCount = useMemo(
    () => localRows.filter((r) => r.selected).length,
    [localRows]
  );

  const avgPct = useMemo(() => {
    const sel = localRows.filter((r) => r.selected);
    if (!sel.length) return 0;
    const sum = sel.reduce((a, r) => a + confidenceToPercent(r.confidence), 0);
    return Math.round(sum / sel.length);
  }, [localRows]);

  if (!isOpen) return null;

  const persistRules = (next: FixedAutoCatRule[]) => {
    setRules(next);
    saveFixedAutoCatRules(next);
    onRulesChanged(next);
  };

  const tryAddRule = (partial: Pick<FixedAutoCatRule, 'pattern' | 'type'> & Partial<FixedAutoCatRule>) => {
    const rule = createFixedAutoCatRule(partial);
    if (!rule.pattern || !rule.type) return false;
    if (findDuplicateFixedAutoCatRule(rules, rule)) {
      setRulesMessage(t('transactions.importPrep.autoCatDuplicateRule'));
      return false;
    }
    persistRules([...rules, rule]);
    setRulesMessage(null);
    return true;
  };

  const updateRule = (ruleId: string, patch: Partial<FixedAutoCatRule>) => {
    const current = rules.find((r) => r.id === ruleId);
    if (!current) return;
    const next = { ...current, ...patch };
    if (
      (patch.pattern !== undefined || patch.match !== undefined || patch.type !== undefined) &&
      findDuplicateFixedAutoCatRule(rules, next, ruleId)
    ) {
      setRulesMessage(t('transactions.importPrep.autoCatDuplicateRule'));
      return;
    }
    setRulesMessage(null);
    persistRules(rules.map((r) => (r.id === ruleId ? next : r)));
  };

  const addRule = () => {
    if (
      !tryAddRule({
        pattern: draftPattern,
        type: draftType,
        match: draftMatch,
      })
    ) {
      return;
    }
    setDraftPattern('');
    setDraftType('');
    setDraftMatch('contains');
  };

  const addRuleFromRow = (row: AutoCatReviewRow) => {
    if (!row.title.trim() || !row.suggestedType.trim()) return;
    // Motif = premier token non numérique du TITLE (ex. DM, LIDL)
    const token =
      row.title
        .trim()
        .toUpperCase()
        .split(/[\s\-_*,]+/)
        .find((w) => w.length >= 2 && !/^\d+$/.test(w)) ?? row.title.trim();
    tryAddRule({
      pattern: token,
      type: row.suggestedType.trim(),
      match: 'contains',
    });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-3">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h2 className="text-lg font-semibold text-zinc-900">
            {t('transactions.importPrep.autoCatReviewTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100"
          >
            {t('transactions.importPrep.autoCatClose')}
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 bg-zinc-50 px-5 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-zinc-600">
              {t('transactions.importPrep.autoCatSelected', {
                selected: selectedCount,
                total: localRows.length,
              })}
            </span>
            {selectedCount > 0 && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceTone(avgPct)}`}>
                {t('transactions.importPrep.autoCatAvgConfidence', { pct: avgPct })}
              </span>
            )}
          </div>
          <button
            type="button"
            className="text-indigo-700 hover:underline"
            onClick={() => {
              const all = localRows.every((r) => r.selected);
              setLocalRows(localRows.map((r) => ({ ...r, selected: !all })));
            }}
          >
            {localRows.every((r) => r.selected)
              ? t('transactions.importPrep.autoCatDeselectAll')
              : t('transactions.importPrep.autoCatSelectAll')}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs uppercase text-zinc-500">
                <th className="py-2 pr-2"> </th>
                <th className="py-2 pr-2">{t('transactions.importPrep.autoCatColTitle')}</th>
                <th className="py-2 pr-2">{t('transactions.importPrep.autoCatColType')}</th>
                <th className="py-2 pr-2">{t('transactions.importPrep.autoCatColConfidence')}</th>
                <th className="py-2 pr-2">{t('transactions.importPrep.autoCatColSource')}</th>
                <th className="py-2">{t('transactions.importPrep.autoCatColActions')}</th>
              </tr>
            </thead>
            <tbody>
              {localRows.map((row, index) => {
                const pct = confidenceToPercent(row.confidence);
                return (
                  <tr
                    key={row.rowId}
                    className={`border-b border-zinc-100 ${row.selected ? '' : 'opacity-50'}`}
                  >
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={row.selected}
                        onChange={() => {
                          const next = [...localRows];
                          next[index] = { ...row, selected: !row.selected };
                          setLocalRows(next);
                        }}
                      />
                    </td>
                    <td className="max-w-[14rem] truncate py-2 pr-2 text-zinc-900" title={row.title}>
                      {row.title}
                    </td>
                    <td className="py-2 pr-2 font-medium text-zinc-900">{row.suggestedType || '—'}</td>
                    <td className="py-2 pr-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceTone(pct)}`}>
                        {pct}%
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-zinc-600">{sourceLabel(row.source, t)}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        className="text-xs text-indigo-700 hover:underline"
                        onClick={() => addRuleFromRow(row)}
                        title={t('transactions.importPrep.autoCatAddRuleHint')}
                      >
                        {t('transactions.importPrep.autoCatAddRule')}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {localRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-zinc-500">
                    {t('transactions.importPrep.autoCatNoSuggestions')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50/80 p-4">
            <h3 className="mb-2 text-sm font-semibold text-zinc-900">
              {t('transactions.importPrep.autoCatRulesTitle')}
            </h3>
            <p className="mb-3 text-xs text-zinc-600">{t('transactions.importPrep.autoCatRulesHelp')}</p>

            <ul className="mb-3 space-y-2">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="flex flex-wrap items-center gap-2 rounded border border-zinc-200 bg-white px-2 py-1.5 text-xs"
                >
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={() => {
                        persistRules(
                          rules.map((r) =>
                            r.id === rule.id ? { ...r, enabled: !r.enabled } : r
                          )
                        );
                      }}
                    />
                    <span className="text-zinc-500">{t('transactions.importPrep.autoCatRuleEnabled')}</span>
                  </label>
                  <select
                    value={rule.match}
                    onChange={(e) =>
                      updateRule(rule.id, { match: e.target.value as FixedAutoCatMatch })
                    }
                    className="rounded border border-zinc-300 px-1 py-0.5"
                  >
                    {MATCH_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {t(`transactions.importPrep.autoCatMatch.${m}`)}
                      </option>
                    ))}
                  </select>
                  <input
                    value={rule.pattern}
                    onChange={(e) => updateRule(rule.id, { pattern: e.target.value })}
                    className="min-w-[6rem] flex-1 rounded border border-zinc-300 px-1.5 py-0.5"
                    placeholder="DM"
                  />
                  <span className="text-zinc-400">→</span>
                  <input
                    value={rule.type}
                    list="auto-cat-known-types"
                    onChange={(e) => updateRule(rule.id, { type: e.target.value })}
                    className="min-w-[6rem] flex-1 rounded border border-zinc-300 px-1.5 py-0.5"
                    placeholder="Shopping"
                  />
                  <button
                    type="button"
                    className="text-rose-700 hover:underline"
                    onClick={() => persistRules(rules.filter((r) => r.id !== rule.id))}
                  >
                    {t('transactions.importPrep.autoCatDelete')}
                  </button>
                </li>
              ))}
              {rules.length === 0 && (
                <li className="text-xs text-zinc-500">{t('transactions.importPrep.autoCatNoRules')}</li>
              )}
            </ul>

            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-zinc-600">
                {t('transactions.importPrep.autoCatMatchLabel')}
                <select
                  value={draftMatch}
                  onChange={(e) => setDraftMatch(e.target.value as FixedAutoCatMatch)}
                  className="mt-0.5 block rounded border border-zinc-300 px-1.5 py-1"
                >
                  {MATCH_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {t(`transactions.importPrep.autoCatMatch.${m}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-zinc-600">
                TITLE
                <input
                  value={draftPattern}
                  onChange={(e) => setDraftPattern(e.target.value)}
                  className="mt-0.5 block min-w-[8rem] rounded border border-zinc-300 px-1.5 py-1"
                  placeholder="DM"
                />
              </label>
              <label className="text-xs text-zinc-600">
                TYPE
                <input
                  value={draftType}
                  list="auto-cat-known-types"
                  onChange={(e) => setDraftType(e.target.value)}
                  className="mt-0.5 block min-w-[8rem] rounded border border-zinc-300 px-1.5 py-1"
                  placeholder="Shopping"
                />
              </label>
              <button
                type="button"
                onClick={addRule}
                className="rounded bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700"
              >
                {t('transactions.importPrep.autoCatAddRuleBtn')}
              </button>
            </div>
            {rulesMessage && (
              <p className="mt-2 text-xs text-amber-800" role="status">
                {rulesMessage}
              </p>
            )}
            <datalist id="auto-cat-known-types">
              {knownTypes.map((type) => (
                <option key={type} value={type} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            {t('transactions.importPrep.autoCatCancel')}
          </button>
          <button
            type="button"
            disabled={selectedCount === 0}
            onClick={() => onApplySelected(localRows.filter((r) => r.selected))}
            className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('transactions.importPrep.autoCatApply', { count: selectedCount })}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Helper pour construire une ligne de revue depuis une suggestion pipeline. */
export function reviewRowFromSuggestion(
  rowId: string,
  title: string,
  date: string,
  suggestion: CategorySuggestion | null | undefined
): AutoCatReviewRow | null {
  if (!suggestion?.category) return null;
  return {
    rowId,
    title,
    date,
    suggestedType: suggestion.category,
    confidence: suggestion.confidence,
    source: suggestion.source,
    selected: suggestion.confidence >= 0.4 || suggestion.source === 'rule',
  };
}
