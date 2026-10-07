import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SourceDataCSVService } from '../services/SourceDataCSVService';
import {
  AccountBalanceCSVService,
  ACCOUNT_CODE_TO_CURRENCY,
  getBalanceCodeForSettingsAccountName,
  type AccountFiatCurrency,
  type BalanceRow,
} from '../services/AccountBalanceCSVService';
import { loadRecognisedAccountsFromStorage } from '../constants/recognisedAccountsStorage';
import { convertToAxisCurrency, convertMovementsToDisplayCurrency, getCachedWorkingCurrencies, type CurrencySymbol } from '../services/EffectiveExchangeRates';
import { formatCurrency } from '../utils/format';
import {
  coerceDisplayCurrency,
  displayCurrencyOptionsFromWorking,
} from '../utils/displayCurrencyOptions';
import { currencyDisplaySymbol } from '@/shared/workingCurrencies';
import { getDefaultLineAssignedTypes } from '../constants/annualBudgetTypeMapping';
import {
  type BilanSpecialRowOptions,
  type BilanStructureSnapshot,
  type BudgetCategory,
  type BudgetLine,
  DEFAULT_BILAN_SPECIAL_ROW_OPTIONS,
  cloneBilanStructure,
  getYearBilanStructure,
  getYearSnapshot,
  listBudgetYears,
  normalizeBilanSpecialRowOptions,
  saveYearSnapshot,
} from '../services/annualBudgetStorage';
import { PERSIST_PENDING_APP_STATE_EVENT } from '../services/profileAppStateSync';
import AnnualBudgetTypeCoverageSection from '../components/AnnualBudgetTypeCoverageSection';
import type { TransactionsAnnualBudgetYearDto } from '@/shared/transactionQueryTypes';

const YEAR_STORAGE_KEY = 'annual-budget-selected-year';
const DISPLAY_CURRENCY_STORAGE_KEY = 'annual-budget-display-currency';

/** Clé de type produite par l’agrégation (main) quand le type est vide : identifiant de donnée, non traduit. */
const NO_TYPE_KEY = 'Sans type';

function readStoredDisplayCurrency(): CurrencySymbol {
  try {
    return coerceDisplayCurrency(localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY));
  } catch {
    return coerceDisplayCurrency(null);
  }
}

/** Police du tableau « Mouvements par type et par mois » (rem de base, défaut ~ text-sm). */
const TYPES_MONTH_TABLE_FONT_STORAGE_KEY = 'annual-budget-types-month-table-font-rem';
const TYPES_MONTH_FONT_REM_DEFAULT = 0.875;
const TYPES_MONTH_FONT_REM_MIN = 0.6875;
const TYPES_MONTH_FONT_REM_MAX = 1.125;
const TYPES_MONTH_FONT_REM_STEP = 0.0625;

function loadTypesMonthTableFontRem(): number {
  try {
    const raw =
      typeof localStorage !== 'undefined' ? localStorage.getItem(TYPES_MONTH_TABLE_FONT_STORAGE_KEY) : null;
    if (raw) {
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n >= TYPES_MONTH_FONT_REM_MIN && n <= TYPES_MONTH_FONT_REM_MAX) {
        const steps = Math.round((n - TYPES_MONTH_FONT_REM_MIN) / TYPES_MONTH_FONT_REM_STEP);
        return TYPES_MONTH_FONT_REM_MIN + steps * TYPES_MONTH_FONT_REM_STEP;
      }
    }
  } catch {}
  return TYPES_MONTH_FONT_REM_DEFAULT;
}

/** Clés localStorage des types reconnus (Réglages / Données reconnues). Alignées avec Settings.tsx. */
const RECOGNISED_ENTRY_TYPES_KEY = 'settings-recognised-entry-types';
const RECOGNISED_OUTPUT_TYPES_KEY = 'settings-recognised-output-types';

/** Fallback si Réglages n’a pas encore de listes : vides (les types viennent du profil / des données). */
const DEFAULT_RECOGNISED_ENTRY_TYPES: string[] = [];
const DEFAULT_RECOGNISED_OUTPUT_TYPES: string[] = [];

function loadRecognisedTypesFromSettings(): { entryTypes: string[]; outputTypes: string[] } {
  try {
    const rawEntry = typeof localStorage !== 'undefined' ? localStorage.getItem(RECOGNISED_ENTRY_TYPES_KEY) : null;
    const rawOutput = typeof localStorage !== 'undefined' ? localStorage.getItem(RECOGNISED_OUTPUT_TYPES_KEY) : null;
    const parse = (raw: string | null, fallback: string[]): string[] => {
      if (!raw) return fallback;
      try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : fallback;
      } catch {
        return fallback;
      }
    };
    return {
      entryTypes: parse(rawEntry, DEFAULT_RECOGNISED_ENTRY_TYPES),
      outputTypes: parse(rawOutput, DEFAULT_RECOGNISED_OUTPUT_TYPES),
    };
  } catch {
    return {
      entryTypes: DEFAULT_RECOGNISED_ENTRY_TYPES,
      outputTypes: DEFAULT_RECOGNISED_OUTPUT_TYPES,
    };
  }
}

/** Ligne spéciale : le Réel est le total des comptes au 1er janvier de l’année (soldes). */
const ASSETS_BF_CATEGORY_ID = 'assets-bf';
const ASSETS_BANK_LINE_ID = 'assets-bank';

/**
 * Structure par défaut d’une feuille neuve : uniquement Assets brought forward.
 * Le reste se construit dans le profil (mode édition). Aucune ligne métier préremplie.
 */
const BUDGETED_ASSETS: BudgetCategory[] = [
  {
    id: ASSETS_BF_CATEGORY_ID,
    label: 'Assets B/F',
    lines: [{ id: ASSETS_BANK_LINE_ID, label: 'Bank' }],
  },
];

const BUDGETED_LIABILITIES: BudgetCategory[] = [];

/**
 * Expression après le « = » : chiffres, + - * / % ( ).
 * Sans eval/new Function (compatible Content-Security-Policy sans unsafe-eval).
 */
function evaluateBilanFormulaExpression(expr: string): number {
  const s = expr.replace(/\s/g, '');
  if (s === '') return NaN;
  if (!/^[-+*/%.0-9()]+$/.test(s)) return NaN;
  let i = 0;

  const parseExpr = (): number => {
    let left = parseTerm();
    while (i < s.length && (s[i] === '+' || s[i] === '-')) {
      const op = s[i++];
      const right = parseTerm();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): number => {
    let left = parseFactor();
    while (i < s.length && (s[i] === '*' || s[i] === '/' || s[i] === '%')) {
      const op = s[i++];
      const right = parseFactor();
      if (op === '*') left *= right;
      else if (op === '/') left = right === 0 ? NaN : left / right;
      else left %= right;
    }
    return left;
  };

  const parseFactor = (): number => {
    if (i < s.length && s[i] === '+') {
      i++;
      return parseFactor();
    }
    if (i < s.length && s[i] === '-') {
      i++;
      return -parseFactor();
    }
    if (i < s.length && s[i] === '(') {
      i++;
      const v = parseExpr();
      if (i >= s.length || s[i] !== ')') return NaN;
      i++;
      return v;
    }
    return parseNumber();
  };

  const parseNumber = (): number => {
    const start = i;
    while (i < s.length && ((s[i] >= '0' && s[i] <= '9') || s[i] === '.')) i++;
    if (start === i) return NaN;
    const n = parseFloat(s.slice(start, i));
    return Number.isNaN(n) ? NaN : n;
  };

  const result = parseExpr();
  if (i !== s.length) return NaN;
  return Number.isFinite(result) ? result : NaN;
}

function parseBilanAmountInputToGbp(raw: string, displayCurrency: CurrencySymbol): number {
  const trimmed = raw.trim().replace(/,/g, '.');
  let n: number;
  if (trimmed === '') {
    n = 0;
  } else if (trimmed.startsWith('=')) {
    n = evaluateBilanFormulaExpression(trimmed.slice(1).trim());
  } else {
    n = parseFloat(trimmed);
  }
  const inDisplay = Number.isNaN(n) ? 0 : n;
  const primarySym = currencyDisplaySymbol(getCachedWorkingCurrencies().primary || 'GBP');
  return convertToAxisCurrency(inDisplay, displayCurrency, primarySym);
}

function gbpToDraftDisplayString(gbp: number | undefined, displayCurrency: CurrencySymbol): string {
  if (gbp == null || gbp === 0) return '';
  return String(Number(convertMovementsToDisplayCurrency(gbp, displayCurrency).toFixed(2)));
}

function BilanSpecialRowControls({
  options,
  onChange,
  autoHint,
  seedManualGbp,
}: {
  options: BilanSpecialRowOptions;
  onChange: (next: BilanSpecialRowOptions) => void;
  autoHint: string;
  seedManualGbp: number;
}) {
  const { t } = useTranslation();
  const apply = (patch: Partial<BilanSpecialRowOptions>) => {
    const next: BilanSpecialRowOptions = { ...options, ...patch };
    if (patch.actualMode === 'manual' && next.manualActualGbp == null) {
      next.manualActualGbp = seedManualGbp;
    }
    onChange(next);
  };
  const autoActive = options.actualMode === 'auto';
  const manualActive = options.actualMode === 'manual';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
        <input
          type="checkbox"
          checked={options.enabled}
          onChange={(e) => apply({ enabled: e.target.checked })}
          className="h-3.5 w-3.5 rounded border-gray-400 text-emerald-600 focus:ring-emerald-500"
        />
        {t('common.active')}
      </label>
      <div
        className="inline-flex rounded-md border border-gray-300 bg-white p-0.5"
        role="group"
        aria-label={t('annualBudget.sheet.actualModeLabel')}
      >
        <button
          type="button"
          disabled={!options.enabled}
          onClick={() => apply({ actualMode: 'auto' })}
          className={`rounded px-2 py-0.5 text-xs font-medium disabled:opacity-40 ${
            autoActive ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
          title={autoHint}
        >
          {t('annualBudget.sheet.modeAuto')}
        </button>
        <button
          type="button"
          disabled={!options.enabled}
          onClick={() => apply({ actualMode: 'manual' })}
          className={`rounded px-2 py-0.5 text-xs font-medium disabled:opacity-40 ${
            manualActive ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          {t('annualBudget.sheet.modeManual')}
        </button>
      </div>
      <span className="text-[11px] text-gray-500">
        {options.actualMode === 'auto' ? autoHint : t('annualBudget.sheet.actualManual')}
      </span>
    </div>
  );
}

interface Aggregation {
  /** Par type puis par mois (1-12): montant GBP */
  byTypeAndMonth: Record<string, Record<number, number>>;
  /** Par mois: total */
  byMonth: Record<number, number>;
  /** Par type: total annuel */
  byType: Record<string, number>;
  totalIncome: number;
  totalExpenses: number;
  total: number;
  yearsAvailable: number[];
}

function emptyAggregation(): Aggregation {
  const byMonth: Record<number, number> = {};
  for (let m = 1; m <= 12; m++) byMonth[m] = 0;
  return {
    byTypeAndMonth: {},
    byMonth,
    byType: {},
    totalIncome: 0,
    totalExpenses: 0,
    total: 0,
    yearsAvailable: [],
  };
}

function aggregationFromDto(dto: TransactionsAnnualBudgetYearDto): Aggregation {
  const byTypeAndMonth: Record<string, Record<number, number>> = {};
  const byMonth: Record<number, number> = {};
  const byType: Record<string, number> = {};
  for (let m = 1; m <= 12; m++) byMonth[m] = 0;

  dto.types.forEach((type, typeIndex) => {
    const months: Record<number, number> = {};
    let typeTotal = 0;
    for (let m = 1; m <= 12; m++) {
      const amount = dto.byTypeAndMonthFlat[typeIndex * 12 + (m - 1)] ?? 0;
      months[m] = amount;
      byMonth[m] += amount;
      typeTotal += amount;
    }
    byTypeAndMonth[type] = months;
    byType[type] = typeTotal;
  });

  return {
    byTypeAndMonth,
    byMonth,
    byType,
    totalIncome: dto.totalIncome,
    totalExpenses: dto.totalExpenses,
    total: dto.total,
    yearsAvailable: dto.yearsAvailable ?? [],
  };
}

function getLineIdsFromStructure(
  assets: BudgetCategory[],
  liabilities: BudgetCategory[]
): string[] {
  const ids: string[] = [];
  for (const cat of assets) {
    for (const line of cat.lines) ids.push(line.id);
  }
  for (const cat of liabilities) {
    for (const line of cat.lines) ids.push(line.id);
  }
  return ids;
}

function getLabelsFromStructure(
  assets: BudgetCategory[],
  liabilities: BudgetCategory[]
): { categoryLabels: Record<string, string>; lineLabels: Record<string, string> } {
  const categoryLabels: Record<string, string> = {};
  const lineLabels: Record<string, string> = {};
  for (const cat of assets) {
    categoryLabels[cat.id] = cat.label;
    for (const line of cat.lines) lineLabels[line.id] = line.label;
  }
  for (const cat of liabilities) {
    categoryLabels[cat.id] = cat.label;
    for (const line of cat.lines) lineLabels[line.id] = line.label;
  }
  return { categoryLabels, lineLabels };
}

function deepCloneCategories(cats: BudgetCategory[]): BudgetCategory[] {
  return cats.map((cat) => ({
    id: cat.id,
    label: cat.label,
    lines: cat.lines.map((l) => ({ id: l.id, label: l.label })),
  }));
}

function buildDefaultBilanStructure(): BilanStructureSnapshot {
  const assets = deepCloneCategories(BUDGETED_ASSETS);
  const liabilities = deepCloneCategories(BUDGETED_LIABILITIES);
  const derived = getLabelsFromStructure(assets, liabilities);
  return {
    version: 1,
    assets,
    liabilities,
    categoryLabels: derived.categoryLabels,
    lineLabels: derived.lineLabels,
    bankLineOptions: { ...DEFAULT_BILAN_SPECIAL_ROW_OPTIONS },
  };
}

function bilanStateFromLoaded(
  loaded: BilanStructureSnapshot | null
): {
  assets: BudgetCategory[];
  liabilities: BudgetCategory[];
  categoryLabels: Record<string, string>;
  lineLabels: Record<string, string>;
  bankLineOptions: BilanSpecialRowOptions;
} {
  const assets = loaded?.assets?.length
    ? deepCloneCategories(loaded.assets)
    : deepCloneCategories(BUDGETED_ASSETS);
  const liabilities = loaded?.liabilities?.length
    ? deepCloneCategories(loaded.liabilities)
    : deepCloneCategories(BUDGETED_LIABILITIES);
  const derived = getLabelsFromStructure(assets, liabilities);
  return {
    assets,
    liabilities,
    categoryLabels: loaded ? { ...derived.categoryLabels, ...loaded.categoryLabels } : derived.categoryLabels,
    lineLabels: loaded ? { ...derived.lineLabels, ...loaded.lineLabels } : derived.lineLabels,
    bankLineOptions: normalizeBilanSpecialRowOptions(loaded?.bankLineOptions),
  };
}

function readBilanStateForYear(year: number): {
  assets: BudgetCategory[];
  liabilities: BudgetCategory[];
  categoryLabels: Record<string, string>;
  lineLabels: Record<string, string>;
  bankLineOptions: BilanSpecialRowOptions;
} {
  return bilanStateFromLoaded(getYearBilanStructure(year));
}

function structureFromBilanState(
  assets: BudgetCategory[],
  liabilities: BudgetCategory[],
  categoryLabels: Record<string, string>,
  lineLabels: Record<string, string>,
  bankLineOptions: BilanSpecialRowOptions
): BilanStructureSnapshot {
  return {
    version: 1,
    assets: deepCloneCategories(assets),
    liabilities: deepCloneCategories(liabilities),
    categoryLabels: { ...categoryLabels },
    lineLabels: { ...lineLabels },
    bankLineOptions: normalizeBilanSpecialRowOptions(bankLineOptions),
  };
}

function collectLiabilityLineIds(liabilities: BudgetCategory[]): Set<string> {
  const s = new Set<string>();
  for (const cat of liabilities) {
    for (const line of cat.lines) s.add(line.id);
  }
  return s;
}

/** Forecast passifs : toujours ≤ 0 (entrée ramenée à −|x|, y compris si l’utilisateur tape un positif). */
function normalizeLiabilityForecastValue(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0;
  return -Math.abs(value);
}

function normalizeBudgetValuesLiabilitiesForecast(
  values: Record<string, number>,
  liabilityIds: Set<string>
): Record<string, number> {
  const out = { ...values };
  for (const id of liabilityIds) {
    if (Object.prototype.hasOwnProperty.call(out, id)) {
      out[id] = normalizeLiabilityForecastValue(out[id]);
    }
  }
  return out;
}

function readStoredYear(): number {
  try {
    const saved = localStorage.getItem(YEAR_STORAGE_KEY);
    if (saved) {
      const y = parseInt(saved, 10);
      if (!Number.isNaN(y) && y >= 2000 && y <= 2100) return y;
    }
  } catch {}
  return new Date().getFullYear();
}

const AnnualBudget: React.FC = () => {
  const location = useLocation();
  const { t } = useTranslation();
  const monthLabels = useMemo(
    () => Array.from({ length: 12 }, (_, i) => t(`annualBudget.months.${i + 1}`)),
    [t]
  );
  const displayTypeName = (type: string): string =>
    type === NO_TYPE_KEY ? t('annualBudget.noType') : type;
  const [aggregation, setAggregation] = useState<Aggregation>(() => emptyAggregation());
  const [jan1BalanceRow, setJan1BalanceRow] = useState<BalanceRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(() => readStoredYear());
  const [displayCurrency, setDisplayCurrency] = useState<CurrencySymbol>(() => readStoredDisplayCurrency());
  const displayCurrencies = displayCurrencyOptionsFromWorking();
  const displayCurrenciesKey = displayCurrencies.map((o) => o.value).join('|');

  useEffect(() => {
    setDisplayCurrency((prev) => {
      const next = coerceDisplayCurrency(prev);
      if (next !== prev) {
        try {
          localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, next);
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }, [displayCurrenciesKey]);

  const fmtMoney = useCallback(
    (gbpAmount: number) =>
      formatCurrency(convertMovementsToDisplayCurrency(gbpAmount, displayCurrency), displayCurrency),
    [displayCurrency]
  );

  const setDisplayCurrencyPersist = useCallback((c: CurrencySymbol) => {
    const next = coerceDisplayCurrency(c);
    setDisplayCurrency(next);
    try {
      localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, next);
    } catch {}
  }, []);

  /** Structure éditable du bilan : propre à l’année sélectionnée. */
  const initialBilan = useMemo(() => readBilanStateForYear(readStoredYear()), []);
  const [budgetedAssets, setBudgetedAssets] = useState<BudgetCategory[]>(() =>
    deepCloneCategories(initialBilan.assets)
  );
  const [budgetedLiabilities, setBudgetedLiabilities] = useState<BudgetCategory[]>(() =>
    deepCloneCategories(initialBilan.liabilities)
  );

  const allBudgetLineIds = useMemo(
    () => getLineIdsFromStructure(
      Array.isArray(budgetedAssets) ? budgetedAssets : [],
      Array.isArray(budgetedLiabilities) ? budgetedLiabilities : []
    ),
    [budgetedAssets, budgetedLiabilities]
  );

  const [budgetValues, setBudgetValues] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    getLineIdsFromStructure(initialBilan.assets, initialBilan.liabilities).forEach((id) => {
      initial[id] = 0;
    });
    const snap = getYearSnapshot(readStoredYear());
    const merged = snap ? { ...initial, ...snap.budgetValues } : initial;
    const liabIds = collectLiabilityLineIds(initialBilan.liabilities);
    return normalizeBudgetValuesLiabilitiesForecast(merged, liabIds);
  });

  const [bilanEditMode, setBilanEditMode] = useState(false);
  const [bilanCategoryLabels, setBilanCategoryLabels] = useState<Record<string, string>>(
    () => initialBilan.categoryLabels
  );
  const [bilanLineLabels, setBilanLineLabels] = useState<Record<string, string>>(
    () => initialBilan.lineLabels
  );
  const [bankLineOptions, setBankLineOptions] = useState<BilanSpecialRowOptions>(
    () => initialBilan.bankLineOptions
  );
  /** Pour chaque ligne, types de transactions affectés (pour la colonne Réel). */
  const [lineAssignedTypes, setLineAssignedTypes] = useState<Record<string, string[]>>(() => {
    const snap = getYearSnapshot(readStoredYear());
    return snap?.lineAssignedTypes ? { ...snap.lineAssignedTypes } : {};
  });
  /** Id de la ligne dont le menu "Affecter" est ouvert, ou null. */
  const [affecterOpenLineId, setAffecterOpenLineId] = useState<string | null>(null);

  const [bilanBlockExpanded, setBilanBlockExpanded] = useState(true);
  const [typeCoverageBlockExpanded, setTypeCoverageBlockExpanded] = useState(true);
  const [typesByMonthBlockExpanded, setTypesByMonthBlockExpanded] = useState(true);
  const [typesMonthTableFontRem, setTypesMonthTableFontRem] = useState(loadTypesMonthTableFontRem);

  const [budgetYearsVersion, setBudgetYearsVersion] = useState(0);
  const [addYearModalOpen, setAddYearModalOpen] = useState(false);
  const [newYearInput, setNewYearInput] = useState(() => String(new Date().getFullYear() + 1));
  const [newYearMode, setNewYearMode] = useState<'empty' | 'copy'>('empty');
  const [copySourceYear, setCopySourceYear] = useState<number | null>(null);
  const [addYearError, setAddYearError] = useState<string | null>(null);

  const storedBudgetYears = useMemo(() => listBudgetYears(), [budgetYearsVersion]);

  useEffect(() => {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(TYPES_MONTH_TABLE_FONT_STORAGE_KEY, String(typesMonthTableFontRem));
      }
    } catch {}
  }, [typesMonthTableFontRem]);

  const yearChangeSkipRef = useRef(true);
  useEffect(() => {
    if (yearChangeSkipRef.current) {
      yearChangeSkipRef.current = false;
      return;
    }
    const bilan = readBilanStateForYear(selectedYear);
    setBudgetedAssets(bilan.assets);
    setBudgetedLiabilities(bilan.liabilities);
    setBilanCategoryLabels(bilan.categoryLabels);
    setBilanLineLabels(bilan.lineLabels);
    setBankLineOptions(bilan.bankLineOptions);

    const initial: Record<string, number> = {};
    getLineIdsFromStructure(bilan.assets, bilan.liabilities).forEach((id) => {
      initial[id] = 0;
    });
    const snap = getYearSnapshot(selectedYear);
    const liabIds = collectLiabilityLineIds(bilan.liabilities);
    if (snap) {
      const merged = { ...initial, ...snap.budgetValues };
      setBudgetValues(normalizeBudgetValuesLiabilitiesForecast(merged, liabIds));
      setLineAssignedTypes({ ...snap.lineAssignedTypes });
    } else {
      setBudgetValues(initial);
      setLineAssignedTypes({});
    }
  }, [selectedYear]);

  const selectedYearRef = useRef(selectedYear);
  selectedYearRef.current = selectedYear;

  const bilanPersistRef = useRef({
    budgetValues,
    lineAssignedTypes,
    budgetedAssets,
    budgetedLiabilities,
    bilanCategoryLabels,
    bilanLineLabels,
    bankLineOptions,
  });
  bilanPersistRef.current = {
    budgetValues,
    lineAssignedTypes,
    budgetedAssets,
    budgetedLiabilities,
    bilanCategoryLabels,
    bilanLineLabels,
    bankLineOptions,
  };

  const persistBilanToStorage = useCallback((year: number) => {
    const s = bilanPersistRef.current;
    saveYearSnapshot(year, {
      budgetValues: s.budgetValues,
      lineAssignedTypes: s.lineAssignedTypes,
      bilanStructure: structureFromBilanState(
        s.budgetedAssets,
        s.budgetedLiabilities,
        s.bilanCategoryLabels,
        s.bilanLineLabels,
        s.bankLineOptions
      ),
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      persistBilanToStorage(selectedYearRef.current);
    }, 400);
    return () => clearTimeout(timer);
  }, [
    budgetValues,
    lineAssignedTypes,
    budgetedAssets,
    budgetedLiabilities,
    bilanCategoryLabels,
    bilanLineLabels,
    bankLineOptions,
    persistBilanToStorage,
  ]);

  useEffect(() => {
    const persistPending = () => persistBilanToStorage(selectedYearRef.current);
    window.addEventListener(PERSIST_PENDING_APP_STATE_EVENT, persistPending);
    return () => {
      window.removeEventListener(PERSIST_PENDING_APP_STATE_EVENT, persistPending);
      persistPending();
    };
  }, [persistBilanToStorage]);

  const liabilityLineIds = useMemo(
    () => collectLiabilityLineIds(Array.isArray(budgetedLiabilities) ? budgetedLiabilities : []),
    [budgetedLiabilities]
  );

  const setBudgetAmount = useCallback((lineId: string, value: number) => {
    const raw = Number.isFinite(value) ? value : 0;
    const stored = liabilityLineIds.has(lineId) ? normalizeLiabilityForecastValue(raw) : raw;
    setBudgetValues((prev) => ({ ...prev, [lineId]: stored }));
  }, [liabilityLineIds]);

  /** Brouillon des champs Forecast en mode édition (permet `=100*12` avant validation). */
  const [bilanForecastDrafts, setBilanForecastDrafts] = useState<Record<string, string>>({});
  /** Brouillon des champs Réel en saisie manuelle (Bank / Assets B/F). */
  const [bilanActualDrafts, setBilanActualDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    setBilanForecastDrafts({});
    setBilanActualDrafts({});
  }, [displayCurrency]);

  const commitBilanForecast = useCallback(
    (lineId: string, raw: string) => {
      setBudgetAmount(lineId, parseBilanAmountInputToGbp(raw, displayCurrency));
    },
    [setBudgetAmount, displayCurrency]
  );

  const commitBilanManualActual = useCallback(
    (targetId: string, raw: string) => {
      const gbp = parseBilanAmountInputToGbp(raw, displayCurrency);
      if (targetId === ASSETS_BANK_LINE_ID) {
        setBankLineOptions((prev) => ({ ...prev, manualActualGbp: gbp }));
      }
    },
    [displayCurrency]
  );

  const actualInputDisplayString = useCallback(
    (targetId: string, storedGbp: number | undefined): string => {
      if (bilanActualDrafts[targetId] !== undefined) return bilanActualDrafts[targetId];
      return gbpToDraftDisplayString(storedGbp, displayCurrency);
    },
    [bilanActualDrafts, displayCurrency]
  );

  const startActualDraft = useCallback(
    (targetId: string, storedGbp: number | undefined) => {
      setBilanActualDrafts((prev) => ({
        ...prev,
        [targetId]: gbpToDraftDisplayString(storedGbp, displayCurrency),
      }));
    },
    [displayCurrency]
  );

  /** Valeur forecast affichée / éditée dans la devise courante (stockage interne toujours en GBP). */
  const forecastInputDisplayString = useCallback(
    (lineId: string): string => {
      if (bilanForecastDrafts[lineId] !== undefined) return bilanForecastDrafts[lineId];
      const v = budgetValues[lineId];
      if (v === 0 || v == null) return '';
      const displayed = convertMovementsToDisplayCurrency(v, displayCurrency);
      return String(Number(displayed.toFixed(2)));
    },
    [bilanForecastDrafts, budgetValues, displayCurrency]
  );

  const startForecastDraft = useCallback(
    (lineId: string) => {
      const v = budgetValues[lineId];
      setBilanForecastDrafts((prev) => ({
        ...prev,
        [lineId]:
          v === 0 || v == null
            ? ''
            : String(Number(convertMovementsToDisplayCurrency(v, displayCurrency).toFixed(2))),
      }));
    },
    [budgetValues, displayCurrency]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const jan1Ms = new Date(selectedYear, 0, 1).setHours(0, 0, 0, 0);
    Promise.all([
      SourceDataCSVService.aggregateAnnualBudgetYear(selectedYear),
      AccountBalanceCSVService.loadNearestBalanceRow(jan1Ms),
    ])
      .then(([aggDto, nearest]) => {
        if (cancelled) return;
        if (!aggDto) {
          setAggregation(emptyAggregation());
          setError(t('annualBudget.errors.noSourceData'));
        } else {
          setAggregation(aggregationFromDto(aggDto));
        }
        setJan1BalanceRow(nearest);
      })
      .catch((err) => {
        if (!cancelled) {
          setAggregation(emptyAggregation());
          setJan1BalanceRow(null);
          setError(err?.message ?? t('annualBudget.errors.loadFailed'));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedYear, location.pathname]);

  /** Solde total de tous les comptes au 1er janvier de l'année sélectionnée, converti en GBP (pour la ligne Bank). */
  const bankBalanceJan1Gbp = useMemo((): number | null => {
    try {
      if (!jan1BalanceRow?.balances) return null;
      const entries = loadRecognisedAccountsFromStorage();
      const fiatByCode = new Map<string, AccountFiatCurrency>();
      for (const e of entries) {
        const c = getBalanceCodeForSettingsAccountName(e.name);
        if (c) fiatByCode.set(c, e.currency);
      }
      let totalGbp = 0;
      for (const [accountCode, amount] of Object.entries(jan1BalanceRow.balances)) {
        const fiat = fiatByCode.get(accountCode);
        const currencyStr = fiat
          ? fiat === 'GBP'
            ? '£'
            : fiat === 'CHF'
              ? 'CHF'
              : '€'
          : ACCOUNT_CODE_TO_CURRENCY[accountCode] ?? '£';
        const currency: CurrencySymbol =
          currencyStr === '€' ? '€' : currencyStr === 'CHF' ? 'CHF' : '£';
        totalGbp += convertToAxisCurrency(Number(amount), currency, '£');
      }
      return Number.isFinite(totalGbp) ? totalGbp : null;
    } catch {
      return null;
    }
  }, [jan1BalanceRow]);

  const getActualValue = (lineId: string): number => {
    if (lineId === ASSETS_BANK_LINE_ID) {
      if (bankLineOptions.actualMode === 'manual') return bankLineOptions.manualActualGbp ?? 0;
      return bankBalanceJan1Gbp ?? 0;
    }
    return actualValues[lineId] ?? 0;
  };

  const sumCategoryLineForecast = (cat: BudgetCategory): number => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return lines.reduce((s, line) => {
      const id = line?.id ?? '';
      if (id === ASSETS_BANK_LINE_ID && !bankLineOptions.enabled) return s;
      return s + (budgetValues[id] ?? 0);
    }, 0);
  };

  const sumCategoryLineActual = (cat: BudgetCategory): number => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return lines.reduce((s, line) => {
      const id = line?.id ?? '';
      if (id === ASSETS_BANK_LINE_ID && !bankLineOptions.enabled) return s;
      return s + getActualValue(id);
    }, 0);
  };

  const totalAssets = (Array.isArray(budgetedAssets) ? budgetedAssets : []).reduce(
    (sum, cat) => sum + sumCategoryLineForecast(cat),
    0
  );
  const totalLiabilities = (Array.isArray(budgetedLiabilities) ? budgetedLiabilities : []).reduce((sum, cat) => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return sum + lines.reduce((s, line) => s + (budgetValues[line?.id ?? ''] ?? 0), 0);
  }, 0);
  /** Passifs forecast stockés en négatif : totalLiabilities ≤ 0, donc TF = actifs + passifs (somme algébrique). */
  const totalFundCF = totalAssets + totalLiabilities;

  /** Montants réels par ligne de bilan (types affectés à chaque ligne). */
  const actualValues = useMemo(() => {
    const out: Record<string, number> = {};
    const defaultMap = getDefaultLineAssignedTypes();
    allBudgetLineIds.forEach((id) => { out[id] = 0; });
    for (const [type, amount] of Object.entries(aggregation.byType)) {
      const trimmed = type.trim();
      for (const lineId of allBudgetLineIds) {
        const assigned =
          lineAssignedTypes[lineId] !== undefined
            ? lineAssignedTypes[lineId]
            : (defaultMap[lineId] ?? []);
        if (assigned.includes(trimmed)) out[lineId] += amount;
      }
    }
    return out;
  }, [aggregation.byType, lineAssignedTypes, allBudgetLineIds]);

  const totalAssetsActual = (Array.isArray(budgetedAssets) ? budgetedAssets : []).reduce(
    (sum, cat) => sum + sumCategoryLineActual(cat),
    0
  );
  const totalLiabilitiesActual = (Array.isArray(budgetedLiabilities) ? budgetedLiabilities : []).reduce((sum, cat) => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return sum + lines.reduce((s, line) => s + getActualValue(line?.id ?? ''), 0);
  }, 0);
  // Les montants "liabilities" sont déjà signés (dépenses négatives). Pour la balance, on additionne donc directement.
  const totalFundCFActual = totalAssetsActual + totalLiabilitiesActual;

  const assetsBfCategory =
    (Array.isArray(budgetedAssets) ? budgetedAssets : []).find((c) => c.id === ASSETS_BF_CATEGORY_ID) ??
    (Array.isArray(budgetedAssets) ? budgetedAssets[0] : undefined);
  const assetsBfForecast = assetsBfCategory ? sumCategoryLineForecast(assetsBfCategory) : 0;
  const assetsBfActual = assetsBfCategory ? sumCategoryLineActual(assetsBfCategory) : 0;
  /** Écart Total Fund C/F vs totaux de la catégorie Assets B/F (même colonne). */
  const fundCfDeltaVsAssetsBfForecast = totalFundCF - assetsBfForecast;
  const fundCfDeltaVsAssetsBfActual = totalFundCFActual - assetsBfActual;

  const typesOrder = useMemo(() => {
    const types = Object.keys(aggregation.byType).filter((ty) => ty !== NO_TYPE_KEY);
    types.sort((a, b) => {
      const aVal = aggregation.byType[a] ?? 0;
      const bVal = aggregation.byType[b] ?? 0;
      return aVal - bVal;
    });
    if (aggregation.byType[NO_TYPE_KEY]) types.push(NO_TYPE_KEY);
    return types;
  }, [aggregation.byType]);

  /** Dernier type de sortie (montant < 0) dans l’ordre d’affichage — hors « Sans type », toujours en bas. */
  const lastExpenseType = useMemo(() => {
    let last: string | null = null;
    for (const type of typesOrder) {
      if (type === NO_TYPE_KEY) continue;
      if ((aggregation.byType[type] ?? 0) < 0) last = type;
    }
    return last;
  }, [typesOrder, aggregation.byType]);

  /** Dernier type d’entrée (montant > 0) dans l’ordre d’affichage — hors « Sans type ». */
  const lastIncomeType = useMemo(() => {
    let last: string | null = null;
    for (const type of typesOrder) {
      if (type === NO_TYPE_KEY) continue;
      if ((aggregation.byType[type] ?? 0) > 0) last = type;
    }
    return last;
  }, [typesOrder, aggregation.byType]);

  /** Types entrées pour le menu Affecter (ASSETS) : types reconnus dans Réglages + types présents dans l'année (montant >= 0). */
  const incomeTypes = useMemo(() => {
    const { entryTypes } = loadRecognisedTypesFromSettings();
    const fromYear = Object.entries(aggregation.byType)
      .filter(([, amt]) => amt >= 0)
      .map(([typeName]) => typeName);
    return Array.from(new Set([...entryTypes, ...fromYear])).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }, [aggregation.byType]);

  /** Types sorties pour le menu Affecter (LIABILITIES) : types reconnus dans Réglages + types présents dans l'année (montant < 0). */
  const expenseTypes = useMemo(() => {
    const { outputTypes } = loadRecognisedTypesFromSettings();
    const fromYear = Object.entries(aggregation.byType)
      .filter(([, amt]) => amt < 0)
      .map(([typeName]) => typeName);
    return Array.from(new Set([...outputTypes, ...fromYear])).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }, [aggregation.byType]);

  const toggleLineAssignedType = (lineId: string, typeName: string) => {
    setLineAssignedTypes((prev) => {
      const defaultMap = getDefaultLineAssignedTypes();
      const current = prev[lineId] ?? defaultMap[lineId] ?? [];
      const has = current.includes(typeName);
      const next = has ? current.filter((x) => x !== typeName) : [...current, typeName];
      return { ...prev, [lineId]: next };
    });
  };

  const affecterDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (affecterOpenLineId == null) return;
    const handleClick = (e: MouseEvent) => {
      if (affecterDropdownRef.current && !affecterDropdownRef.current.contains(e.target as Node)) {
        setAffecterOpenLineId(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [affecterOpenLineId]);

  type BilanSide = 'assets' | 'liabilities';

  const addLine = (catId: string, side: BilanSide) => {
    const lineId = `line-${Date.now()}`;
    const newLineLabel = t('annualBudget.sheet.newLine');
    const updater = (prev: BudgetCategory[]) =>
      prev.map((cat) =>
        cat.id === catId
          ? { ...cat, lines: [...cat.lines, { id: lineId, label: newLineLabel }] }
          : cat
      );
    if (side === 'assets') setBudgetedAssets(updater);
    else setBudgetedLiabilities(updater);
    setBilanLineLabels((p) => ({ ...p, [lineId]: newLineLabel }));
  };

  const addCategory = (side: BilanSide) => {
    const catId = `cat-${Date.now()}`;
    const newCategoryLabel = t('annualBudget.sheet.newCategory');
    const newCat: BudgetCategory = { id: catId, label: newCategoryLabel, lines: [] };
    if (side === 'assets') setBudgetedAssets((p) => [...p, newCat]);
    else setBudgetedLiabilities((p) => [...p, newCat]);
    setBilanCategoryLabels((p) => ({ ...p, [catId]: newCategoryLabel }));
  };

  const promoteLineToCategory = (
    catIndex: number,
    lineIndex: number,
    side: BilanSide,
    currentLineLabel: string
  ) => {
    const getCats = side === 'assets' ? () => budgetedAssets : () => budgetedLiabilities;
    const setCats = side === 'assets' ? setBudgetedAssets : setBudgetedLiabilities;
    const cats = getCats();
    const cat = cats[catIndex];
    const line = cat.lines[lineIndex];
    const newCatId = `cat-${Date.now()}`;
    const newCat: BudgetCategory = {
      id: newCatId,
      label: currentLineLabel,
      lines: [{ id: line.id, label: line.label }],
    };
    const newLines = cat.lines.filter((_, i) => i !== lineIndex);
    const newCats = [...cats];
    newCats[catIndex] = { ...cat, lines: newLines };
    newCats.splice(catIndex + 1, 0, newCat);
    setCats(newCats);
    setBilanCategoryLabels((p) => ({ ...p, [newCatId]: currentLineLabel }));
  };

  const demoteCategoryToLine = (catIndex: number, side: BilanSide, currentCategoryLabel: string) => {
    if (catIndex === 0) return;
    const getCats = side === 'assets' ? () => budgetedAssets : () => budgetedLiabilities;
    const setCats = side === 'assets' ? setBudgetedAssets : setBudgetedLiabilities;
    const cats = getCats();
    const cat = cats[catIndex];
    const prevCat = cats[catIndex - 1];
    const newLineId = `line-${Date.now()}`;
    const label = currentCategoryLabel || cat.label;
    const newLine: BudgetLine = { id: newLineId, label };
    const prevLines = [...prevCat.lines, newLine, ...cat.lines];
    const newCats = cats.filter((_, i) => i !== catIndex);
    newCats[catIndex - 1] = { ...prevCat, lines: prevLines };
    setCats(newCats);
    setBilanLineLabels((p) => ({ ...p, [newLineId]: label }));
  };

  const moveLine = (catId: string, lineIndex: number, direction: 'up' | 'down', side: BilanSide) => {
    const getCats = side === 'assets' ? () => budgetedAssets : () => budgetedLiabilities;
    const setCats = side === 'assets' ? setBudgetedAssets : setBudgetedLiabilities;
    const cats = getCats();
    const cat = cats.find((c) => c.id === catId);
    if (!cat || cat.lines.length < 2) return;
    const newIndex = direction === 'up' ? lineIndex - 1 : lineIndex + 1;
    if (newIndex < 0 || newIndex >= cat.lines.length) return;
    const newLines = [...cat.lines];
    [newLines[lineIndex], newLines[newIndex]] = [newLines[newIndex], newLines[lineIndex]];
    setCats(
      cats.map((c) => (c.id === catId ? { ...c, lines: newLines } : c))
    );
  };

  const moveCategory = (catIndex: number, direction: 'up' | 'down', side: BilanSide) => {
    const setCats = side === 'assets' ? setBudgetedAssets : setBudgetedLiabilities;
    const getCats = side === 'assets' ? () => budgetedAssets : () => budgetedLiabilities;
    const cats = getCats();
    const newIndex = direction === 'up' ? catIndex - 1 : catIndex + 1;
    if (newIndex < 0 || newIndex >= cats.length) return;
    const newCats = [...cats];
    [newCats[catIndex], newCats[newIndex]] = [newCats[newIndex], newCats[catIndex]];
    setCats(newCats);
  };

  const deleteLine = (catId: string, lineIndex: number, side: BilanSide) => {
    const getCats = side === 'assets' ? () => budgetedAssets : () => budgetedLiabilities;
    const setCats = side === 'assets' ? setBudgetedAssets : setBudgetedLiabilities;
    const cats = getCats();
    const cat = cats.find((c) => c.id === catId);
    if (!cat || lineIndex < 0 || lineIndex >= cat.lines.length) return;
    const lineId = cat.lines[lineIndex]?.id;
    if (lineId === ASSETS_BANK_LINE_ID) return;
    const newLines = cat.lines.filter((_, i) => i !== lineIndex);
    setCats(
      cats.map((c) => (c.id === catId ? { ...c, lines: newLines } : c))
    );
    if (affecterOpenLineId === cat.lines[lineIndex].id) setAffecterOpenLineId(null);
  };

  /** Par mois : total des sorties (types à montant négatif). */
  const totalSortiesByMonth = useMemo(() => {
    const out: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) out[m] = 0;
    for (const type of typesOrder) {
      const total = aggregation.byType[type] ?? 0;
      if (total >= 0) continue;
      for (let m = 1; m <= 12; m++) {
        out[m] += aggregation.byTypeAndMonth[type]?.[m] ?? 0;
      }
    }
    return out;
  }, [aggregation.byTypeAndMonth, aggregation.byType, typesOrder]);

  /** Par mois : total des entrées (types à montant positif). */
  const totalEntreesByMonth = useMemo(() => {
    const out: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) out[m] = 0;
    for (const type of typesOrder) {
      const total = aggregation.byType[type] ?? 0;
      if (total <= 0) continue;
      for (let m = 1; m <= 12; m++) {
        out[m] += aggregation.byTypeAndMonth[type]?.[m] ?? 0;
      }
    }
    return out;
  }, [aggregation.byTypeAndMonth, aggregation.byType, typesOrder]);

  /** Moyennes mensuelles du tableau « types × mois » : total ÷ nb de mois avec mouvement ≠ 0. */
  const typesByMonthTableAvg = useMemo(() => {
    const countNonZeroMonths = (getVal: (m: number) => number): number => {
      let n = 0;
      for (let m = 1; m <= 12; m++) {
        if (getVal(m) !== 0) n++;
      }
      return n;
    };
    const sortiesN = countNonZeroMonths((m) => totalSortiesByMonth[m] ?? 0);
    const entreesN = countNonZeroMonths((m) => totalEntreesByMonth[m] ?? 0);
    const balanceN = countNonZeroMonths((m) => aggregation.byMonth[m] ?? 0);
    return {
      sortiesAvg: sortiesN === 0 ? null : aggregation.totalExpenses / sortiesN,
      entreesAvg: entreesN === 0 ? null : aggregation.totalIncome / entreesN,
      balanceAvg: balanceN === 0 ? null : aggregation.total / balanceN,
    };
  }, [
    totalSortiesByMonth,
    totalEntreesByMonth,
    aggregation.byMonth,
    aggregation.total,
    aggregation.totalExpenses,
    aggregation.totalIncome,
  ]);

  const handleYearChange = (y: number) => {
    if (y !== selectedYear) {
      saveYearSnapshot(selectedYear, {
        budgetValues,
        lineAssignedTypes,
        bilanStructure: structureFromBilanState(
          budgetedAssets,
          budgetedLiabilities,
          bilanCategoryLabels,
          bilanLineLabels,
          bankLineOptions
        ),
      });
    }
    setSelectedYear(y);
    try {
      localStorage.setItem(YEAR_STORAGE_KEY, String(y));
    } catch {}
  };

  const yearSelectOptions = useMemo(() => {
    const set = new Set<number>();
    for (const y of aggregation.yearsAvailable) set.add(y);
    for (const y of storedBudgetYears) set.add(y);
    set.add(selectedYear);
    if (set.size === 0) {
      return [selectedYear - 2, selectedYear - 1, selectedYear, selectedYear + 1];
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [aggregation.yearsAvailable, storedBudgetYears, selectedYear]);

  const openAddYearModal = () => {
    setNewYearInput(String(selectedYear + 1));
    setNewYearMode('empty');
    setCopySourceYear(
      storedBudgetYears.includes(selectedYear)
        ? selectedYear
        : storedBudgetYears[storedBudgetYears.length - 1] ?? null
    );
    setAddYearError(null);
    setAddYearModalOpen(true);
  };

  const closeAddYearModal = () => {
    setAddYearModalOpen(false);
    setAddYearError(null);
  };

  const handleCreateYear = () => {
    const y = parseInt(newYearInput.trim(), 10);
    if (Number.isNaN(y) || y < 2000 || y > 2100) {
      setAddYearError(t('annualBudget.yearErrors.invalidYear'));
      return;
    }
    if (y === selectedYear) {
      setAddYearError(t('annualBudget.yearErrors.alreadyOpen'));
      return;
    }
    if (storedBudgetYears.includes(y) || getYearSnapshot(y) !== null) {
      setAddYearError(t('annualBudget.yearErrors.alreadyExists', { year: y }));
      return;
    }
    if (newYearMode === 'copy') {
      if (copySourceYear === null) {
        setAddYearError(t('annualBudget.yearErrors.chooseSource'));
        return;
      }
      const sourceExists =
        copySourceYear === selectedYear || getYearSnapshot(copySourceYear) !== null;
      if (!sourceExists) {
        setAddYearError(t('annualBudget.yearErrors.chooseSource'));
        return;
      }
    }

    saveYearSnapshot(selectedYear, {
      budgetValues,
      lineAssignedTypes,
      bilanStructure: structureFromBilanState(
        budgetedAssets,
        budgetedLiabilities,
        bilanCategoryLabels,
        bilanLineLabels,
        bankLineOptions
      ),
    });

    if (newYearMode === 'copy' && copySourceYear !== null) {
      let copiedValues: Record<string, number>;
      let copiedTypes: Record<string, string[]>;
      let copiedStructure: BilanStructureSnapshot;

      if (copySourceYear === selectedYear) {
        copiedValues = { ...budgetValues };
        copiedTypes = Object.fromEntries(
          Object.entries(lineAssignedTypes).map(([k, v]) => [k, [...v]])
        );
        copiedStructure = structureFromBilanState(
          budgetedAssets,
          budgetedLiabilities,
          bilanCategoryLabels,
          bilanLineLabels,
          bankLineOptions
        );
      } else {
        const sourceSnap = getYearSnapshot(copySourceYear);
        if (!sourceSnap) {
          setAddYearError(t('annualBudget.yearErrors.cannotReadSource'));
          return;
        }
        copiedValues = { ...sourceSnap.budgetValues };
        copiedTypes = Object.fromEntries(
          Object.entries(sourceSnap.lineAssignedTypes).map(([k, v]) => [k, [...v]])
        );
        copiedStructure = cloneBilanStructure(
          getYearBilanStructure(copySourceYear) ?? buildDefaultBilanStructure()
        );
      }

      saveYearSnapshot(y, {
        budgetValues: copiedValues,
        lineAssignedTypes: copiedTypes,
        bilanStructure: cloneBilanStructure(copiedStructure),
      });
    } else {
      saveYearSnapshot(y, {
        budgetValues: {},
        lineAssignedTypes: {},
        bilanStructure: buildDefaultBilanStructure(),
      });
    }

    setBudgetYearsVersion((v) => v + 1);
    setSelectedYear(y);
    try {
      localStorage.setItem(YEAR_STORAGE_KEY, String(y));
    } catch {}
    closeAddYearModal();
  };

  const renderManualActualInput = (
    targetId: string,
    storedGbp: number | undefined,
    focusClass: string
  ) => (
    <input
      type="text"
      inputMode="decimal"
      className={`w-28 text-right text-sm border border-gray-300 rounded px-2 py-1 tabular-nums ${focusClass}`}
      placeholder="—"
      title={t('annualBudget.sheet.formulaHint')}
      value={actualInputDisplayString(targetId, storedGbp)}
      onFocus={() => startActualDraft(targetId, storedGbp)}
      onChange={(e) => {
        setBilanActualDrafts((prev) => ({ ...prev, [targetId]: e.target.value }));
      }}
      onBlur={(e) => {
        commitBilanManualActual(targetId, e.currentTarget.value);
        setBilanActualDrafts((prev) => {
          const next = { ...prev };
          delete next[targetId];
          return next;
        });
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          e.currentTarget.blur();
        }
      }}
    />
  );

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <p className="text-gray-500">{t('common.loading')}</p>
      </main>
    );
  }

  return (
    <>
    <main className="flex-1 overflow-auto p-6">
        <div className="max-w-8xl mx-auto">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <h1 className="text-2xl font-bold text-gray-800">{t('nav.annualBudget')}</h1>
            <div
              className="inline-flex rounded-lg border border-gray-300 bg-white p-0.5 shadow-sm"
              role="group"
              aria-label={t('dashboard.settings.displayCurrency')}
            >
              {displayCurrencies.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDisplayCurrencyPersist(value)}
                  aria-pressed={displayCurrency === value}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    displayCurrency === value
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {/* Sélecteur d'année */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <label htmlFor="annual-budget-year" className="text-sm font-medium text-gray-700">
              {t('annualBudget.year')}
            </label>
            <select
              id="annual-budget-year"
              value={selectedYear}
              onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
            >
              {yearSelectOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={openAddYearModal}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
            >
              {t('annualBudget.addYear')}
            </button>
          </div>

          {/* Résumé annuel */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">{t('annualBudget.summary.income')}</p>
              <p className="text-xl font-semibold text-green-700">
                {fmtMoney(aggregation.totalIncome)}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">{t('annualBudget.summary.expenses')}</p>
              <p className="text-xl font-semibold text-red-700">
                {fmtMoney(aggregation.totalExpenses)}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">{t('annualBudget.summary.balance')}</p>
              <p className={`text-xl font-semibold ${aggregation.total >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {fmtMoney(aggregation.total)}
              </p>
            </div>
          </div>

          <section
            className="mb-8 flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden"
            aria-labelledby="annual-budget-bloc-bilan-title"
          >
            <header
              className={`bg-gradient-to-br from-slate-50 to-white ${
                bilanBlockExpanded ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-stretch">
                <button
                  type="button"
                  className="flex flex-1 items-start gap-3 px-4 py-3 sm:py-4 text-left transition-colors hover:bg-slate-50/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
                  aria-expanded={bilanBlockExpanded}
                  aria-controls={bilanBlockExpanded ? 'annual-budget-panel-bilan' : undefined}
                  onClick={() => setBilanBlockExpanded((e) => !e)}
                >
                  <span
                    className={`mt-1.5 shrink-0 text-sm leading-none text-gray-500 transition-transform duration-200 ${
                      bilanBlockExpanded ? 'rotate-90' : ''
                    }`}
                    aria-hidden
                  >
                    ▶
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      id="annual-budget-bloc-bilan-title"
                      className="block text-xl font-bold tracking-tight text-gray-900 sm:text-2xl"
                    >
                      {t('annualBudget.sheet.title')}
                    </span>
                    <span className="mt-1.5 block text-sm text-gray-500">
                      <strong className="font-semibold text-gray-600">{t('annualBudget.yearLabel', { year: selectedYear })}</strong>
                      {' — '}
                      {t('annualBudget.sheet.subtitle')}
                    </span>
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 bg-slate-50/60 px-4 py-2.5 sm:border-t-0 sm:border-l sm:border-gray-200 sm:bg-transparent sm:px-4 sm:py-3">
                  <button
                    type="button"
                    onClick={() => setBilanEditMode((v) => !v)}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium text-white ${
                      bilanEditMode
                        ? 'border-gray-500 bg-gray-500 hover:bg-gray-600'
                        : 'border-red-600 bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    {bilanEditMode ? t('transactions.edit.exit') : t('transactions.edit.enter')}
                  </button>
                  {bilanEditMode ? (
                    <span className="text-xs font-medium text-red-600 sm:text-sm">{t('transactions.edit.banner')}</span>
                  ) : null}
                </div>
              </div>
            </header>
            {bilanBlockExpanded ? (
              <div
                id="annual-budget-panel-bilan"
                className="flex min-h-0 flex-col px-4 pb-4 pt-3"
                role="region"
                aria-label={t('annualBudget.sheet.title')}
              >
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-inner">
            <div className="grid grid-cols-1 md:grid-cols-2 border-b border-gray-200">
              <div className="bg-gray-100 py-1.5 px-4 flex items-center gap-4 text-sm font-semibold text-gray-600">
                <span className="flex-1" />
                <span className="w-28 text-right">{t('annualBudget.sheet.forecast')}</span>
                <span className="w-28 text-right">{t('annualBudget.sheet.actual')}</span>
              </div>
              <div className="bg-gray-100 py-1.5 px-4 flex items-center gap-4 text-sm font-semibold text-gray-600 md:border-l border-gray-200">
                <span className="flex-1" />
                <span className="w-28 text-right">{t('annualBudget.sheet.forecast')}</span>
                <span className="w-28 text-right">{t('annualBudget.sheet.actual')}</span>
              </div>
            </div>
            <div className="flex flex-col md:flex-row">
              <div className="flex-1 min-w-0">
                <div className="divide-y divide-emerald-100">
                  {budgetedAssets.map((cat, catIndex) => {
                    const catLines = Array.isArray(cat.lines) ? cat.lines : [];
                    const catForecast = sumCategoryLineForecast(cat);
                    const catActual = sumCategoryLineActual(cat);
                    return (
                      <div key={cat.id}>
                        <div className="bg-emerald-100 font-semibold text-gray-800 py-1.5 px-4 text-sm flex items-center gap-4">
                          {bilanEditMode && (
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => moveCategory(catIndex, 'up', 'assets')}
                                disabled={catIndex === 0}
                                className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                title={t('annualBudget.sheet.moveCategoryUp')}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => moveCategory(catIndex, 'down', 'assets')}
                                disabled={catIndex === budgetedAssets.length - 1}
                                className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                title={t('annualBudget.sheet.moveCategoryDown')}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => demoteCategoryToLine(catIndex, 'assets', bilanCategoryLabels[cat.id] ?? cat.label)}
                                disabled={catIndex === 0}
                                className="rounded border border-gray-500 bg-white px-1.5 py-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                title={t('annualBudget.sheet.levelDownTitle')}
                              >
                                {t('annualBudget.sheet.levelDown')}
                              </button>
                            </div>
                          )}
                          {bilanEditMode ? (
                            <input
                              type="text"
                              value={bilanCategoryLabels[cat.id] ?? cat.label}
                              onChange={(e) => setBilanCategoryLabels((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                              className="flex-1 min-w-0 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                            />
                          ) : (
                            <span className="flex-1">{bilanCategoryLabels[cat.id] ?? cat.label}</span>
                          )}
                          {catLines.length > 0 && (
                            <>
                              <span className="tabular-nums w-28 text-right text-gray-600">
                                {fmtMoney(catForecast)}
                              </span>
                              <span className="tabular-nums w-28 text-right text-gray-600">
                                {fmtMoney(catActual)}
                              </span>
                            </>
                          )}
                        </div>
                        {catLines.map((line, lineIndex) => {
                          const assigned = lineAssignedTypes[line?.id ?? ''] ?? getDefaultLineAssignedTypes()[line?.id ?? ''] ?? [];
                          const isOpen = affecterOpenLineId === line?.id;
                          const isBankLine = line?.id === ASSETS_BANK_LINE_ID;
                          const bankInactive = isBankLine && !bankLineOptions.enabled;
                          if (bankInactive && !bilanEditMode) return null;
                          const bankManualActual = isBankLine && bankLineOptions.actualMode === 'manual';
                          return (
                            <React.Fragment key={line?.id ?? lineIndex}>
                            <div
                              className={`flex items-center gap-4 py-1 px-4 pl-8 bg-white border-l-2 border-emerald-100 ${bankInactive ? 'opacity-60' : ''}`}
                            >
                              {bilanEditMode && (
                                <div className="flex shrink-0 items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => moveLine(cat.id, lineIndex, 'up', 'assets')}
                                    disabled={lineIndex === 0}
                                    className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                    title={t('annualBudget.sheet.moveUp')}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveLine(cat.id, lineIndex, 'down', 'assets')}
                                    disabled={lineIndex === catLines.length - 1}
                                    className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                    title={t('annualBudget.sheet.moveDown')}
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => promoteLineToCategory(catIndex, lineIndex, 'assets', bilanLineLabels[line?.id ?? ''] ?? line?.label ?? '')}
                                    disabled={isBankLine}
                                    className="rounded border border-gray-500 bg-white px-1.5 py-1 text-xs hover:bg-gray-100 disabled:opacity-40"
                                    title={isBankLine ? t('annualBudget.sheet.bankSpecialTitle') : t('annualBudget.sheet.levelUpTitle')}
                                  >
                                    {t('annualBudget.sheet.levelUp')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteLine(cat.id, lineIndex, 'assets')}
                                    disabled={isBankLine}
                                    className="rounded border border-red-300 bg-white p-1 text-red-600 hover:bg-red-50 disabled:opacity-40"
                                    title={isBankLine ? t('annualBudget.sheet.bankKeptTitle') : t('transactions.table.deleteRow')}
                                  >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              )}
                              {bilanEditMode ? (
                                <input
                                  type="text"
                                  value={bilanLineLabels[line.id] ?? line.label}
                                  onChange={(e) => setBilanLineLabels((prev) => ({ ...prev, [line.id]: e.target.value }))}
                                  className="flex-1 min-w-0 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                />
                              ) : (
                                <span className="flex-1 text-sm text-gray-700">
                                  {bilanLineLabels[line.id] ?? line.label}
                                  {bankInactive ? (
                                    <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                                      {t('annualBudget.sheet.inactive')}
                                    </span>
                                  ) : null}
                                </span>
                              )}
                              {bilanEditMode && bankInactive ? (
                                <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                                  {t('annualBudget.sheet.inactive')}
                                </span>
                              ) : null}
                              {bilanEditMode ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="w-28 text-right text-sm border border-gray-300 rounded px-2 py-1 tabular-nums focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                  placeholder="—"
                                  title={t('annualBudget.sheet.formulaHint')}
                                  value={forecastInputDisplayString(line.id)}
                                  onFocus={() => startForecastDraft(line.id)}
                                  onChange={(e) => {
                                    setBilanForecastDrafts((prev) => ({ ...prev, [line.id]: e.target.value }));
                                  }}
                                  onBlur={(e) => {
                                    commitBilanForecast(line.id, e.currentTarget.value);
                                    setBilanForecastDrafts((prev) => {
                                      const next = { ...prev };
                                      delete next[line.id];
                                      return next;
                                    });
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      e.currentTarget.blur();
                                    }
                                  }}
                                />
                              ) : (
                                <span className="w-28 text-right text-sm tabular-nums text-gray-700">
                                  {budgetValues[line.id] === 0 || budgetValues[line.id] == null
                                    ? '—'
                                    : fmtMoney(budgetValues[line.id] ?? 0)}
                                </span>
                              )}
                              {bilanEditMode && bankManualActual ? (
                                renderManualActualInput(
                                  ASSETS_BANK_LINE_ID,
                                  bankLineOptions.manualActualGbp,
                                  'focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500'
                                )
                              ) : (
                                <span
                                  className="w-28 text-right text-sm tabular-nums text-gray-700"
                                  title={
                                    isBankLine
                                      ? bankManualActual
                                        ? t('annualBudget.sheet.actualManual')
                                        : t('annualBudget.sheet.actualBankTitle')
                                      : undefined
                                  }
                                >
                                  {fmtMoney(getActualValue(line.id) ?? 0)}
                                </span>
                              )}
                              {bilanEditMode && !isBankLine && (
                                <div
                                  className="relative shrink-0"
                                  ref={isOpen ? affecterDropdownRef : undefined}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setAffecterOpenLineId((prev) => (prev === line.id ? null : line.id))}
                                    className="rounded border border-emerald-600 bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                                  >
                                    {t('annualBudget.sheet.assign')}
                                  </button>
                                  {isOpen && (
                                    <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-56 overflow-auto rounded border border-gray-200 bg-white py-1 shadow-lg">
                                      <div className="px-2 py-1 text-xs font-semibold text-gray-500">{t('annualBudget.sheet.incomeTypes')}</div>
                                      {incomeTypes.length === 0 ? (
                                        <div className="px-2 py-1 text-xs text-gray-400">{t('annualBudget.sheet.noTypesForYear')}</div>
                                      ) : (
                                        incomeTypes.map((typeName) => {
                                          const checked = assigned.includes(typeName);
                                          return (
                                            <button
                                              key={typeName}
                                              type="button"
                                              onClick={() => toggleLineAssignedType(line.id, typeName)}
                                              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-emerald-50"
                                            >
                                              <span className={`flex h-4 w-4 items-center justify-center rounded border text-xs ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-gray-300'}`}>
                                                {checked ? '✓' : ''}
                                              </span>
                                              <span className="min-w-0 truncate">{displayTypeName(typeName)}</span>
                                              <span className="ml-auto tabular-nums text-gray-500">
                                                {fmtMoney(aggregation.byType[typeName] ?? 0)}
                                              </span>
                                            </button>
                                          );
                                        })
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {bilanEditMode && isBankLine ? (
                              <div className="flex items-center py-1.5 px-4 pl-8 bg-emerald-50/90 border-l-2 border-emerald-100">
                                <BilanSpecialRowControls
                                  options={bankLineOptions}
                                  onChange={setBankLineOptions}
                                  autoHint={t('annualBudget.sheet.bankAutoHint')}
                                  seedManualGbp={bankBalanceJan1Gbp ?? 0}
                                />
                              </div>
                            ) : null}
                            </React.Fragment>
                          );
                        })}
                        {catLines.length === 0 && (
                          <div className="py-1 px-4 pl-8 bg-white border-l-2 border-emerald-100 text-sm text-gray-500 flex gap-4">
                            <span className="flex-1">—</span>
                            <span className="w-28" />
                            <span className="w-28" />
                          </div>
                        )}
                        {bilanEditMode && (
                          <div className="py-1 px-4 pl-8 bg-emerald-50/50 border-l-2 border-emerald-100">
                            <button
                              type="button"
                              onClick={() => addLine(cat.id, 'assets')}
                              className="text-xs text-emerald-700 hover:underline"
                            >
                              {t('annualBudget.sheet.addLine')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {bilanEditMode && (
                    <div className="py-2 px-4 bg-emerald-50 border-t border-emerald-200">
                      <button
                        type="button"
                        onClick={() => addCategory('assets')}
                        className="text-sm font-medium text-emerald-700 hover:underline"
                      >
                        {t('annualBudget.sheet.addCategory')}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0 border-t md:border-t-0 md:border-l border-gray-200">
                <div className="divide-y divide-red-100">
                  {budgetedLiabilities.length === 0 && !bilanEditMode ? (
                    <div className="px-4 py-6 text-sm text-gray-500">
                      {t('annualBudget.sheet.noLiabilities')}
                    </div>
                  ) : null}
                  {budgetedLiabilities.map((cat, catIndex) => {
                    const catLinesLiab = Array.isArray(cat.lines) ? cat.lines : [];
                    const catForecast = catLinesLiab.reduce((s, l) => s + (budgetValues[l?.id ?? ''] ?? 0), 0);
                    const catActual = catLinesLiab.reduce((s, l) => s + getActualValue(l?.id ?? ''), 0);
                    return (
                      <div key={cat.id}>
                        <div className="bg-red-100 font-semibold text-gray-800 py-1.5 px-4 text-sm flex items-center gap-4">
                          {bilanEditMode && (
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => moveCategory(catIndex, 'up', 'liabilities')}
                                disabled={catIndex === 0}
                                className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                title={t('annualBudget.sheet.moveCategoryUp')}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => moveCategory(catIndex, 'down', 'liabilities')}
                                disabled={catIndex === budgetedLiabilities.length - 1}
                                className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                title={t('annualBudget.sheet.moveCategoryDown')}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => demoteCategoryToLine(catIndex, 'liabilities', bilanCategoryLabels[cat.id] ?? cat.label)}
                                disabled={catIndex === 0}
                                className="rounded border border-gray-500 bg-white px-1.5 py-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                title={t('annualBudget.sheet.levelDownTitle')}
                              >
                                {t('annualBudget.sheet.levelDown')}
                              </button>
                            </div>
                          )}
                          {bilanEditMode ? (
                            <input
                              type="text"
                              value={bilanCategoryLabels[cat.id] ?? cat.label}
                              onChange={(e) => setBilanCategoryLabels((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                              className="flex-1 min-w-0 rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
                            />
                          ) : (
                            <span className="flex-1">{bilanCategoryLabels[cat.id] ?? cat.label}</span>
                          )}
                          {catLinesLiab.length > 0 && (
                            <>
                              <span className="tabular-nums w-28 text-right text-gray-600">
                                {fmtMoney(catForecast)}
                              </span>
                              <span className="tabular-nums w-28 text-right text-gray-600">
                                {fmtMoney(catActual)}
                              </span>
                            </>
                          )}
                        </div>
                        {catLinesLiab.map((line, lineIndex) => {
                          const assigned = lineAssignedTypes[line?.id ?? ''] ?? getDefaultLineAssignedTypes()[line?.id ?? ''] ?? [];
                          const isOpen = affecterOpenLineId === line?.id;
                          return (
                            <div
                              key={line?.id ?? lineIndex}
                              className="flex items-center gap-4 py-1 px-4 pl-8 bg-white border-l-2 border-red-100"
                            >
                              {bilanEditMode && (
                                <div className="flex shrink-0 items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => moveLine(cat.id, lineIndex, 'up', 'liabilities')}
                                    disabled={lineIndex === 0}
                                    className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                    title={t('annualBudget.sheet.moveUp')}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveLine(cat.id, lineIndex, 'down', 'liabilities')}
                                    disabled={lineIndex === catLinesLiab.length - 1}
                                    className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                    title={t('annualBudget.sheet.moveDown')}
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => promoteLineToCategory(catIndex, lineIndex, 'liabilities', bilanLineLabels[line.id] ?? line.label)}
                                    className="rounded border border-gray-500 bg-white px-1.5 py-1 text-xs hover:bg-gray-100"
                                    title={t('annualBudget.sheet.levelUpTitle')}
                                  >
                                    {t('annualBudget.sheet.levelUp')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteLine(cat.id, lineIndex, 'liabilities')}
                                    className="rounded border border-red-300 bg-white p-1 text-red-600 hover:bg-red-50"
                                    title={t('transactions.table.deleteRow')}
                                  >
                                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                              )}
                              {bilanEditMode ? (
                                <input
                                  type="text"
                                  value={bilanLineLabels[line.id] ?? line.label}
                                  onChange={(e) => setBilanLineLabels((prev) => ({ ...prev, [line.id]: e.target.value }))}
                                  className="flex-1 min-w-0 rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 focus:ring-2 focus:ring-red-500 focus:border-red-500"
                                />
                              ) : (
                                <span className="flex-1 text-sm text-gray-700">{bilanLineLabels[line.id] ?? line.label}</span>
                              )}
                              {bilanEditMode ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="w-28 text-right text-sm border border-gray-300 rounded px-2 py-1 tabular-nums focus:ring-2 focus:ring-red-500 focus:border-red-500"
                                  placeholder="—"
                                  title={t('annualBudget.sheet.formulaHint')}
                                  value={forecastInputDisplayString(line.id)}
                                  onFocus={() => startForecastDraft(line.id)}
                                  onChange={(e) => {
                                    setBilanForecastDrafts((prev) => ({ ...prev, [line.id]: e.target.value }));
                                  }}
                                  onBlur={(e) => {
                                    commitBilanForecast(line.id, e.currentTarget.value);
                                    setBilanForecastDrafts((prev) => {
                                      const next = { ...prev };
                                      delete next[line.id];
                                      return next;
                                    });
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      e.currentTarget.blur();
                                    }
                                  }}
                                />
                              ) : (
                                <span className="w-28 text-right text-sm tabular-nums text-gray-700">
                                  {budgetValues[line.id] === 0 || budgetValues[line.id] == null
                                    ? '—'
                                    : fmtMoney(budgetValues[line.id] ?? 0)}
                                </span>
                              )}
                              <span className="w-28 text-right text-sm tabular-nums text-gray-700">
                                {fmtMoney(getActualValue(line.id))}
                              </span>
                              {bilanEditMode && (
                                <div
                                  className="relative shrink-0"
                                  ref={isOpen ? affecterDropdownRef : undefined}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setAffecterOpenLineId((prev) => (prev === line.id ? null : line.id))}
                                    className="rounded border border-red-600 bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700"
                                  >
                                    {t('annualBudget.sheet.assign')}
                                  </button>
                                  {isOpen && (
                                    <div className="absolute right-0 top-full z-20 mt-1 max-h-48 w-56 overflow-auto rounded border border-gray-200 bg-white py-1 shadow-lg">
                                      <div className="px-2 py-1 text-xs font-semibold text-gray-500">{t('annualBudget.sheet.expenseTypes')}</div>
                                      {expenseTypes.length === 0 ? (
                                        <div className="px-2 py-1 text-xs text-gray-400">{t('annualBudget.sheet.noTypesForYear')}</div>
                                      ) : (
                                        expenseTypes.map((typeName) => {
                                          const checked = assigned.includes(typeName);
                                          return (
                                            <button
                                              key={typeName}
                                              type="button"
                                              onClick={() => toggleLineAssignedType(line.id, typeName)}
                                              className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-red-50"
                                            >
                                              <span className={`flex h-4 w-4 items-center justify-center rounded border text-xs ${checked ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300'}`}>
                                                {checked ? '✓' : ''}
                                              </span>
                                              <span className="min-w-0 truncate">{displayTypeName(typeName)}</span>
                                              <span className="ml-auto tabular-nums text-gray-500">
                                                {fmtMoney(aggregation.byType[typeName] ?? 0)}
                                              </span>
                                            </button>
                                          );
                                        })
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {catLinesLiab.length === 0 && (
                          <div className="py-1 px-4 pl-8 bg-white border-l-2 border-red-100 text-sm text-gray-500 flex gap-4">
                            <span className="flex-1">—</span>
                            <span className="w-28" />
                            <span className="w-28" />
                          </div>
                        )}
                        {bilanEditMode && (
                          <div className="py-1 px-4 pl-8 bg-red-50/50 border-l-2 border-red-100">
                            <button
                              type="button"
                              onClick={() => addLine(cat.id, 'liabilities')}
                              className="text-xs text-red-700 hover:underline"
                            >
                              {t('annualBudget.sheet.addLine')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {bilanEditMode && (
                    <div className="py-2 px-4 bg-red-50 border-t border-red-200">
                      <button
                        type="button"
                        onClick={() => addCategory('liabilities')}
                        className="text-sm font-medium text-red-700 hover:underline"
                      >
                        {t('annualBudget.sheet.addCategory')}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
                <div className="border-t border-gray-200">
                  <div className="flex flex-col md:flex-row md:items-stretch">
                    <div className="flex flex-1 flex-wrap items-center gap-3 border-b-4 border-b-red-800 border-l-4 border-l-emerald-600 bg-emerald-50 px-4 py-3 sm:gap-4 md:border-b-0">
                      <span className="min-w-0 flex-1 text-sm font-bold text-emerald-900 sm:text-base">{t('annualBudget.sheet.totalAssets')}</span>
                      <div className="flex flex-wrap items-end justify-end gap-6 tabular-nums">
                        <div className="text-right">
                          <div className="text-base font-bold text-emerald-950">{fmtMoney(totalAssets)}</div>
                          <div className="text-xs font-medium text-emerald-700">{t('annualBudget.sheet.forecast')}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-base font-bold text-emerald-950">{fmtMoney(totalAssetsActual)}</div>
                          <div className="text-xs font-medium text-emerald-700">{t('annualBudget.sheet.actual')}</div>
                        </div>
                      </div>
                    </div>
                    <div
                      className="hidden w-1 shrink-0 self-stretch bg-red-800 md:block"
                      aria-hidden
                    />
                    <div className="flex flex-1 flex-wrap items-center gap-3 bg-red-50 px-4 py-3 sm:gap-4">
                      <span className="min-w-0 flex-1 text-sm font-bold text-red-900 sm:text-base">{t('annualBudget.sheet.totalLiabilities')}</span>
                      <div className="flex flex-wrap items-end justify-end gap-6 tabular-nums">
                        <div className="text-right">
                          <div className="text-base font-bold text-red-950">{fmtMoney(totalLiabilities)}</div>
                          <div className="text-xs font-medium text-red-700">{t('annualBudget.sheet.forecast')}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-base font-bold text-red-950">{fmtMoney(totalLiabilitiesActual)}</div>
                          <div className="text-xs font-medium text-red-700">{t('annualBudget.sheet.actual')}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="border-t-2 border-slate-200 bg-gradient-to-br from-slate-50/95 to-white px-4 py-4 sm:px-6">
                    <div className="flex flex-col items-center gap-5 md:flex-row md:items-center md:justify-between md:gap-10">
                      <span className="shrink-0 text-center text-sm font-bold text-gray-900 sm:text-base md:text-left">
                        {t('annualBudget.sheet.totalFundCF')}
                      </span>
                      <div className="flex w-full max-w-2xl flex-1 flex-wrap justify-center gap-12 sm:gap-16 md:max-w-none md:gap-20">
                        <div className="flex min-w-0 flex-col items-center gap-3 text-center">
                          <div className="w-full shrink-0 border-b border-slate-200/80 pb-2">
                            <span className="block text-xs font-normal italic text-gray-600">{t('annualBudget.sheet.forecast')}</span>
                          </div>
                          <div className="flex w-full min-w-0 flex-nowrap items-center justify-between gap-3 overflow-x-auto">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
                              <div className="flex items-baseline gap-1.5 tabular-nums">
                                <span className="text-[10px] font-normal italic text-gray-500 whitespace-nowrap">
                                  {t('annualBudget.sheet.assetsBf')}
                                </span>
                                <span className="text-[11px] font-medium leading-none text-gray-600">
                                  {fmtMoney(assetsBfForecast)}
                                </span>
                              </div>
                              <span className="tabular-nums text-xl font-bold leading-none text-gray-900">
                                {fmtMoney(totalFundCF)}
                              </span>
                            </div>
                            <span
                              className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums ${
                                fundCfDeltaVsAssetsBfForecast > 0.005
                                  ? 'text-green-700'
                                  : fundCfDeltaVsAssetsBfForecast < -0.005
                                    ? 'text-red-700'
                                    : 'text-gray-500'
                              }`}
                              title={t('annualBudget.sheet.deltaForecastTitle')}
                            >
                              {fundCfDeltaVsAssetsBfForecast > 0.005 ? (
                                <>
                                  <span aria-hidden>↑</span>
                                  {fmtMoney(fundCfDeltaVsAssetsBfForecast)}
                                </>
                              ) : fundCfDeltaVsAssetsBfForecast < -0.005 ? (
                                <>
                                  <span aria-hidden>↓</span>
                                  {fmtMoney(Math.abs(fundCfDeltaVsAssetsBfForecast))}
                                </>
                              ) : (
                                <span className="font-normal">—</span>
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="flex min-w-0 flex-col items-center gap-3 text-center">
                          <div className="w-full shrink-0 border-b border-slate-200/80 pb-2">
                            <span className="block text-xs font-normal italic text-gray-600">{t('annualBudget.sheet.actual')}</span>
                          </div>
                          <div className="flex w-full min-w-0 flex-nowrap items-center justify-between gap-3 overflow-x-auto">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
                              <div className="flex items-baseline gap-1.5 tabular-nums">
                                <span className="text-[10px] font-normal italic text-gray-500 whitespace-nowrap">
                                  {t('annualBudget.sheet.assetsBf')}
                                </span>
                                <span className="text-[11px] font-medium leading-none text-gray-600">
                                  {fmtMoney(assetsBfActual)}
                                </span>
                              </div>
                              <span className="tabular-nums text-xl font-bold leading-none text-gray-900">
                                {fmtMoney(totalFundCFActual)}
                              </span>
                            </div>
                            <span
                              className={`inline-flex shrink-0 items-center gap-1 text-xs font-semibold tabular-nums ${
                                fundCfDeltaVsAssetsBfActual > 0.005
                                  ? 'text-green-700'
                                  : fundCfDeltaVsAssetsBfActual < -0.005
                                    ? 'text-red-700'
                                    : 'text-gray-500'
                              }`}
                              title={t('annualBudget.sheet.deltaActualTitle')}
                            >
                              {fundCfDeltaVsAssetsBfActual > 0.005 ? (
                                <>
                                  <span aria-hidden>↑</span>
                                  {fmtMoney(fundCfDeltaVsAssetsBfActual)}
                                </>
                              ) : fundCfDeltaVsAssetsBfActual < -0.005 ? (
                                <>
                                  <span aria-hidden>↓</span>
                                  {fmtMoney(Math.abs(fundCfDeltaVsAssetsBfActual))}
                                </>
                              ) : (
                                <span className="font-normal">—</span>
                              )}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            ) : null}
          </section>

          <AnnualBudgetTypeCoverageSection
            selectedYear={selectedYear}
            byType={aggregation.byType}
            lineAssignedTypes={lineAssignedTypes}
            budgetedAssets={budgetedAssets}
            budgetedLiabilities={budgetedLiabilities}
            categoryLabels={bilanCategoryLabels}
            lineLabels={bilanLineLabels}
            fmtMoney={fmtMoney}
            expanded={typeCoverageBlockExpanded}
            onToggleExpanded={() => setTypeCoverageBlockExpanded((e) => !e)}
          />

          <section
            className="mb-8 flex flex-col rounded-xl border-2 border-gray-200/90 bg-white shadow-md overflow-hidden"
            aria-labelledby="annual-budget-bloc-types-title"
          >
            <header
              className={`flex flex-col sm:flex-row sm:items-stretch bg-gradient-to-br from-slate-50 to-white ${
                typesByMonthBlockExpanded ? 'border-b-2 border-gray-200' : 'rounded-b-xl border-b-0'
              }`}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset sm:py-4"
                aria-expanded={typesByMonthBlockExpanded}
                aria-controls={typesByMonthBlockExpanded ? 'annual-budget-panel-types-month' : undefined}
                onClick={() => setTypesByMonthBlockExpanded((e) => !e)}
              >
                <span
                  className={`mt-1.5 shrink-0 text-sm leading-none text-gray-500 transition-transform duration-200 ${
                    typesByMonthBlockExpanded ? 'rotate-90' : ''
                  }`}
                  aria-hidden
                >
                  ▶
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    id="annual-budget-bloc-types-title"
                    className="block text-xl font-bold tracking-tight text-gray-900 sm:text-2xl"
                  >
                    {t('annualBudget.types.title')}
                  </span>
                  <span className="mt-1.5 block text-sm text-gray-500">
                    {t('annualBudget.year')} <strong className="font-semibold text-gray-600">{selectedYear}</strong>
                    {' — '}{t('annualBudget.types.subtitle')}
                  </span>
                </span>
              </button>
              <div
                className="flex shrink-0 items-center justify-end gap-1 border-t border-gray-200/80 px-3 py-2 sm:border-t-0 sm:border-l sm:py-0"
                role="group"
                aria-label={t('annualBudget.types.fontGroup')}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTypesMonthTableFontRem((prev) =>
                      Math.max(TYPES_MONTH_FONT_REM_MIN, prev - TYPES_MONTH_FONT_REM_STEP)
                    );
                  }}
                  disabled={typesMonthTableFontRem <= TYPES_MONTH_FONT_REM_MIN + 1e-6}
                  title={t('annualBudget.types.fontDecrease')}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-lg font-semibold leading-none text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  −
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setTypesMonthTableFontRem((prev) =>
                      Math.min(TYPES_MONTH_FONT_REM_MAX, prev + TYPES_MONTH_FONT_REM_STEP)
                    );
                  }}
                  disabled={typesMonthTableFontRem >= TYPES_MONTH_FONT_REM_MAX - 1e-6}
                  title={t('annualBudget.types.fontIncrease')}
                  className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-300 bg-white text-lg font-semibold leading-none text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  +
                </button>
              </div>
            </header>
            {typesByMonthBlockExpanded ? (
              <div
                id="annual-budget-panel-types-month"
                className="flex min-h-0 flex-col px-4 pb-4 pt-3"
                role="region"
                aria-label={t('annualBudget.types.title')}
              >
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-inner">
            <div
              className="overflow-x-auto"
              style={{ fontSize: `${typesMonthTableFontRem}rem` }}
            >
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-100 border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">{t('annualBudget.types.columnType')}</th>
                    {monthLabels.map((label, i) => (
                      <th key={i} className="text-right py-3 px-2 font-semibold text-gray-700 w-24">
                        {label}
                      </th>
                    ))}
                    <th
                      className="text-right py-3 px-3 font-semibold text-gray-700 w-28"
                      title={t('annualBudget.types.avgMonthlyTitle')}
                    >
                      {t('annualBudget.types.avgMonthly')}
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-slate-700 w-28 border-l border-slate-300 bg-slate-200/90">
                      {t('annualBudget.types.total')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {typesOrder.map((type) => {
                    const rowTotal = aggregation.byType[type] ?? 0;
                    let monthsWithMovement = 0;
                    for (let m = 1; m <= 12; m++) {
                      if ((aggregation.byTypeAndMonth[type]?.[m] ?? 0) !== 0) monthsWithMovement++;
                    }
                    const rowMonthlyAvg =
                      monthsWithMovement === 0 ? null : rowTotal / monthsWithMovement;
                    return (
                      <React.Fragment key={type}>
                        <tr className="group border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 px-4 font-medium text-gray-800">{displayTypeName(type)}</td>
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                            const val = aggregation.byTypeAndMonth[type]?.[m] ?? 0;
                            return (
                              <td
                                key={m}
                                className={`text-right py-2 px-2 tabular-nums ${val >= 0 ? 'text-green-700' : 'text-red-700'}`}
                              >
                                {val === 0 ? '—' : fmtMoney(val)}
                              </td>
                            );
                          })}
                          <td
                            className={`text-right py-2 px-3 font-medium tabular-nums ${rowMonthlyAvg === null ? 'text-gray-400' : rowMonthlyAvg >= 0 ? 'text-green-700' : 'text-red-700'}`}
                          >
                            {rowMonthlyAvg === null ? '—' : fmtMoney(rowMonthlyAvg)}
                          </td>
                          <td
                            className={`border-l border-slate-200/90 bg-slate-100/80 text-right py-2 px-4 font-medium tabular-nums group-hover:bg-slate-100 ${rowTotal >= 0 ? 'text-green-700' : 'text-red-700'}`}
                          >
                            {fmtMoney(rowTotal)}
                          </td>
                        </tr>
                        {type === lastExpenseType && (
                          <tr key="total-sorties" className="border-b border-gray-200 bg-red-50 font-semibold">
                            <td className="py-2 px-4 text-gray-800">{t('annualBudget.types.totalExits')}</td>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                              const val = totalSortiesByMonth[m] ?? 0;
                              return (
                                <td key={m} className="text-right py-2 px-2 tabular-nums text-red-700">
                                  {val === 0 ? '—' : fmtMoney(val)}
                                </td>
                              );
                            })}
                            <td className="text-right py-2 px-3 tabular-nums text-red-700">
                              {typesByMonthTableAvg.sortiesAvg === null
                                ? '—'
                                : fmtMoney(typesByMonthTableAvg.sortiesAvg)}
                            </td>
                            <td className="border-l border-red-200/80 bg-slate-200/50 text-right py-2 px-4 tabular-nums text-red-800">
                              {fmtMoney(aggregation.totalExpenses)}
                            </td>
                          </tr>
                        )}
                        {type === lastIncomeType && (
                          <tr key="total-entrees" className="border-b border-gray-200 bg-green-50 font-semibold">
                            <td className="py-2 px-4 text-gray-800">{t('annualBudget.types.totalEntries')}</td>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                              const val = totalEntreesByMonth[m] ?? 0;
                              return (
                                <td key={m} className="text-right py-2 px-2 tabular-nums text-green-700">
                                  {val === 0 ? '—' : fmtMoney(val)}
                                </td>
                              );
                            })}
                            <td className="text-right py-2 px-3 tabular-nums text-green-700">
                              {typesByMonthTableAvg.entreesAvg === null
                                ? '—'
                                : fmtMoney(typesByMonthTableAvg.entreesAvg)}
                            </td>
                            <td className="border-l border-emerald-200/80 bg-slate-200/50 text-right py-2 px-4 tabular-nums text-green-800">
                              {fmtMoney(aggregation.totalIncome)}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                    <td className="py-3 px-4 text-gray-800">{t('annualBudget.types.balance')}</td>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                      const val = aggregation.byMonth[m] ?? 0;
                      return (
                        <td
                          key={m}
                          className={`text-right py-3 px-2 tabular-nums ${val >= 0 ? 'text-green-700' : 'text-red-700'}`}
                        >
                          {val === 0 ? '—' : fmtMoney(val)}
                        </td>
                      );
                    })}
                    <td
                      className={`text-right py-3 px-3 tabular-nums ${
                        typesByMonthTableAvg.balanceAvg === null
                          ? 'text-gray-500'
                          : typesByMonthTableAvg.balanceAvg >= 0
                            ? 'text-green-700'
                            : 'text-red-700'
                      }`}
                    >
                      {typesByMonthTableAvg.balanceAvg === null
                        ? '—'
                        : fmtMoney(typesByMonthTableAvg.balanceAvg)}
                    </td>
                    <td
                      className={`border-l border-slate-300 bg-slate-200/70 text-right py-3 px-4 tabular-nums ${aggregation.total >= 0 ? 'text-green-800' : 'text-red-800'}`}
                    >
                      {fmtMoney(aggregation.total)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
    </main>
      {addYearModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="annual-budget-add-year-title"
          onClick={closeAddYearModal}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="annual-budget-add-year-title" className="text-lg font-semibold text-gray-900">
              {t('annualBudget.addYearModal.title')}
            </h2>
            <div className="space-y-1">
              <label htmlFor="annual-budget-new-year" className="block text-sm font-medium text-gray-700">
                {t('annualBudget.year')}
              </label>
              <input
                id="annual-budget-new-year"
                type="number"
                min={2000}
                max={2100}
                value={newYearInput}
                onChange={(e) => {
                  setNewYearInput(e.target.value);
                  setAddYearError(null);
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
              />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-gray-700">{t('annualBudget.addYearModal.content')}</legend>
              <label className="flex items-center gap-2 text-sm text-gray-800">
                <input
                  type="radio"
                  name="annual-budget-new-year-mode"
                  checked={newYearMode === 'empty'}
                  onChange={() => {
                    setNewYearMode('empty');
                    setAddYearError(null);
                  }}
                />
                {t('annualBudget.addYearModal.empty')}
              </label>
              <label
                className={`flex items-center gap-2 text-sm ${
                  storedBudgetYears.length === 0 ? 'text-gray-400' : 'text-gray-800'
                }`}
              >
                <input
                  type="radio"
                  name="annual-budget-new-year-mode"
                  checked={newYearMode === 'copy'}
                  disabled={storedBudgetYears.length === 0}
                  onChange={() => {
                    setNewYearMode('copy');
                    setAddYearError(null);
                    if (copySourceYear === null && storedBudgetYears.length > 0) {
                      setCopySourceYear(
                        storedBudgetYears.includes(selectedYear)
                          ? selectedYear
                          : storedBudgetYears[storedBudgetYears.length - 1]
                      );
                    }
                  }}
                />
                {t('annualBudget.addYearModal.copy')}
              </label>
              {storedBudgetYears.length === 0 && (
                <p className="text-xs text-gray-500 pl-6">
                  {t('annualBudget.addYearModal.noYearsToCopy')}
                </p>
              )}
              {newYearMode === 'copy' && storedBudgetYears.length > 0 && (
                <div className="pl-6 space-y-1">
                  <label htmlFor="annual-budget-copy-source" className="block text-sm text-gray-600">
                    {t('annualBudget.addYearModal.sourceYear')}
                  </label>
                  <select
                    id="annual-budget-copy-source"
                    value={copySourceYear ?? ''}
                    onChange={(e) => {
                      setCopySourceYear(parseInt(e.target.value, 10));
                      setAddYearError(null);
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                  >
                    {storedBudgetYears.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </fieldset>
            {addYearError && (
              <p className="text-sm text-red-600" role="alert">
                {addYearError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={closeAddYearModal}
                className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {t('annualBudget.addYearModal.cancel')}
              </button>
              <button
                type="button"
                onClick={handleCreateYear}
                className="rounded border border-gray-800 bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900"
              >
                {t('annualBudget.addYearModal.create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AnnualBudget;
