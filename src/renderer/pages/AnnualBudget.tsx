import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { SourceDataCSVService, type SourceDataResult } from '../services/SourceDataCSVService';
import {
  AccountBalanceCSVService,
  ACCOUNT_CODE_TO_CURRENCY,
  getBalanceCodeForSettingsAccountName,
  type AccountFiatCurrency,
  type BalanceRow,
} from '../services/AccountBalanceCSVService';
import { loadRecognisedAccountsFromStorage } from '../constants/recognisedAccountsStorage';
import { convertToAxisCurrency, type CurrencySymbol } from '../services/EffectiveExchangeRates';
import { formatCurrency } from '../utils/format';
import { getDefaultLineAssignedTypes } from '../constants/annualBudgetTypeMapping';
import {
  type BudgetCategory,
  type BudgetLine,
  loadBilanStructureSnapshot,
  saveBilanStructureSnapshot,
  getYearSnapshot,
  saveYearSnapshot,
} from '../services/annualBudgetStorage';

const YEAR_STORAGE_KEY = 'annual-budget-selected-year';

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

/** Valeurs par défaut lorsque le localStorage n'a pas encore été rempli par la page Réglages. Alignées avec Settings.tsx (KNOWN_ENTRY_TYPES / KNOWN_OUTPUT_TYPES). */
const DEFAULT_RECOGNISED_ENTRY_TYPES: string[] = [
  'Lampton', 'LMB', 'LTL', 'MPC', 'LGV', 'Other Inc', 'Support', 'Refund', 'Benefit', 'SLCcredit',
];
const DEFAULT_RECOGNISED_OUTPUT_TYPES: string[] = [
  'Rent', 'Council', 'Comm', 'Electricity', 'Water', 'Service', 'SLCdebit', 'Transport', 'Fuel', 'Car',
  'Food', 'Restaurant', 'Shopping', 'Leisure', 'Holiday', 'LST', 'School', 'Misc', 'Health', 'Donation',
];

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

/** Structure de la feuille de bilan budgétisé (Budgeted Balance Sheet) */
const BUDGETED_ASSETS: BudgetCategory[] = [
  {
    id: 'assets-bf',
    label: 'Assets B/F',
    lines: [{ id: 'assets-bank', label: 'Bank' }],
  },
  {
    id: 'net-income',
    label: 'Net income',
    lines: [
      { id: 'ni-lampton', label: 'Lampton School' },
      { id: 'ni-lmb', label: 'LMB' },
      { id: 'ni-ltl', label: 'LTL (Linear Tools LTD)' },
      { id: 'ni-mpc', label: 'MPC' },
      { id: 'ni-lgv', label: 'LGV' },
    ],
  },
  {
    id: 'financial-support-personal',
    label: 'Financial support (Personnal)',
    lines: [
      { id: 'fsp-papa-maman', label: 'Papa/Maman' },
      { id: 'fsp-theo-vogt', label: 'Theo Vogt' },
      { id: 'fsp-candlefish', label: 'Candlefish' },
      { id: 'fsp-andre', label: 'André' },
      { id: 'fsp-elsa-vogt', label: 'Elsa Vogt' },
      { id: 'fsp-other', label: 'Other' },
    ],
  },
  {
    id: 'financial-support-perspectives',
    label: 'Financial support (Perspectives)',
    lines: [
      { id: 'fspers-perspectives', label: 'Perspectives' },
      { id: 'fspers-freddy-riess', label: 'Freddy Riess' },
      { id: 'fspers-leopaul-vogt', label: 'Leopaul Vogt' },
      { id: 'fspers-andre-vogt', label: 'Andre Vogt' },
      { id: 'fspers-elsa-vogt', label: 'Elsa Vogt' },
    ],
  },
  {
    id: 'other-inc',
    label: 'Other Inc',
    lines: [
      { id: 'oi-refund', label: 'Refund' },
      { id: 'oi-other', label: 'Other Inc' },
      { id: 'oi-benefit', label: 'Benefit' },
    ],
  },
  {
    id: 'student-loan',
    label: 'Student Loan (SLC)',
    lines: [{ id: 'slc-credit', label: 'SLC credit' }],
  },
];

const BUDGETED_LIABILITIES: BudgetCategory[] = [
  {
    id: 'housing-costs',
    label: 'Housing costs',
    lines: [
      { id: 'hc-rent', label: 'Rent' },
      { id: 'hc-comm', label: 'Comm' },
      { id: 'hc-electricity', label: 'Electricity' },
      { id: 'hc-water', label: 'Water' },
      { id: 'hc-service-charge', label: 'Service Charge' },
    ],
  },
  {
    id: 'mobility',
    label: 'Mobility',
    lines: [
      { id: 'mob-transport', label: 'Transport' },
      { id: 'mob-fuel', label: 'Fuel' },
      { id: 'mob-car', label: 'Car' },
    ],
  },
  {
    id: 'living-costs',
    label: 'Living costs',
    lines: [
      { id: 'lc-food', label: 'Food' },
      { id: 'lc-restaurant', label: 'Restaurant' },
      { id: 'lc-shopping', label: 'Shopping' },
      { id: 'lc-leisure', label: 'Leisure' },
      { id: 'lc-holiday', label: 'Holiday' },
      { id: 'lc-health', label: 'Health' },
    ],
  },
  {
    id: 'misc',
    label: 'Misc',
    lines: [{ id: 'misc-total', label: 'Misc' }],
  },
  {
    id: 'donation',
    label: 'Donation',
    lines: [{ id: 'donation-total', label: 'Donation' }],
  },
  {
    id: 'training',
    label: 'Training',
    lines: [
      { id: 'tr-lst-fees', label: 'LST Fees' },
      { id: 'tr-school', label: 'School' },
    ],
  },
  {
    id: 'slc-debit',
    label: 'SLC debit',
    lines: [
      { id: 'slc-maria', label: 'SLC Maria' },
      { id: 'slc-charlie', label: 'SLC Charlie' },
    ],
  },
  {
    id: 'state-liab',
    label: 'State Liab.',
    lines: [
      { id: 'slc-other-taxes', label: 'Other taxes' },
      { id: 'slc-council-tax', label: 'Council tax' },
    ],
  },
];

const MONTH_NAMES = [
  'Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin',
  'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc',
];

function parseDateFromCell(raw: string): { year: number; month: number } | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})/;
  const mi = s.match(iso);
  if (mi) {
    const y = parseInt(mi[1], 10);
    const m = parseInt(mi[2], 10);
    if (m < 1 || m > 12) return null;
    return { year: y, month: m };
  }
  const md = s.match(dmy);
  if (md) {
    const m = parseInt(md[2], 10);
    const yy =
      md[3].length === 2
        ? parseInt(md[3], 10) < 50
          ? 2000 + parseInt(md[3], 10)
          : 1900 + parseInt(md[3], 10)
        : parseInt(md[3], 10);
    if (m < 1 || m > 12) return null;
    return { year: yy, month: m };
  }
  return null;
}

function parseAmountGbp(raw: string): number {
  const s = (raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return 0;
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

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

function aggregateByYear(data: SourceDataResult | null, year: number): Aggregation {
  const byTypeAndMonth: Record<string, Record<number, number>> = {};
  const byMonth: Record<number, number> = {};
  const byType: Record<string, number> = {};

  if (!data?.rows?.length) {
    for (let m = 1; m <= 12; m++) byMonth[m] = 0;
    return {
      byTypeAndMonth,
      byMonth: { ...byMonth },
      byType,
      totalIncome: 0,
      totalExpenses: 0,
      total: 0,
      yearsAvailable: [],
    };
  }

  const dateCol = data.headers.find((h) => /date/i.test(h)) ?? null;
  const amountGbpCol = data.headers.find((h) => /^amount\s*gbp$/i.test(h)) ?? null;
  const typeCol = data.headers.find((h) => /^type$/i.test(h)) ?? null;

  const ensureMonth = (m: number) => {
    if (!(m in byMonth)) byMonth[m] = 0;
  };
  for (let m = 1; m <= 12; m++) ensureMonth(m);

  const add = (type: string, month: number, amount: number) => {
    if (!byTypeAndMonth[type]) byTypeAndMonth[type] = {};
    if (!(month in byTypeAndMonth[type])) byTypeAndMonth[type][month] = 0;
    byTypeAndMonth[type][month] += amount;
    byMonth[month] += amount;
    if (!(type in byType)) byType[type] = 0;
    byType[type] += amount;
  };

  const yearSet = new Set<number>();

  for (const row of data.rows) {
    const parsed = dateCol ? parseDateFromCell(row[dateCol] ?? '') : null;
    if (!parsed) continue;
    yearSet.add(parsed.year);
    if (parsed.year !== year) continue;

    const amount = amountGbpCol ? parseAmountGbp(row[amountGbpCol] ?? '') : 0;
    if (amount === 0) continue;

    const type = (typeCol ? (row[typeCol] ?? '').trim() : '') || 'Sans type';
    add(type, parsed.month, amount);
  }

  let totalIncome = 0;
  let totalExpenses = 0;
  Object.values(byType).forEach((v) => {
    if (v > 0) totalIncome += v;
    else totalExpenses += v;
  });

  return {
    byTypeAndMonth,
    byMonth: { ...byMonth },
    byType,
    totalIncome,
    totalExpenses,
    total: totalIncome + totalExpenses,
    yearsAvailable: Array.from(yearSet).sort((a, b) => a - b),
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

function readInitialBilanState(): {
  assets: BudgetCategory[];
  liabilities: BudgetCategory[];
  categoryLabels: Record<string, string>;
  lineLabels: Record<string, string>;
} {
  const loaded = loadBilanStructureSnapshot();
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
  };
}

function deepCloneCategories(cats: BudgetCategory[]): BudgetCategory[] {
  return cats.map((cat) => ({
    id: cat.id,
    label: cat.label,
    lines: cat.lines.map((l) => ({ id: l.id, label: l.label })),
  }));
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
  const [data, setData] = useState<SourceDataResult | null>(null);
  const [accountBalanceRows, setAccountBalanceRows] = useState<BalanceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(() => readStoredYear());

  /** Structure éditable du bilan : chargée depuis le stockage si présent (export AppState / ZIP). */
  const initialBilan = useMemo(() => readInitialBilanState(), []);
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
  /** Pour chaque ligne, types de transactions affectés (pour la colonne Réel). */
  const [lineAssignedTypes, setLineAssignedTypes] = useState<Record<string, string[]>>(() => {
    const base = getDefaultLineAssignedTypes();
    const snap = getYearSnapshot(readStoredYear());
    if (!snap) return base;
    return { ...base, ...snap.lineAssignedTypes };
  });
  /** Id de la ligne dont le menu "Affecter" est ouvert, ou null. */
  const [affecterOpenLineId, setAffecterOpenLineId] = useState<string | null>(null);

  const [bilanBlockExpanded, setBilanBlockExpanded] = useState(true);
  const [typesByMonthBlockExpanded, setTypesByMonthBlockExpanded] = useState(true);
  const [typesMonthTableFontRem, setTypesMonthTableFontRem] = useState(loadTypesMonthTableFontRem);

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
    const initial: Record<string, number> = {};
    getLineIdsFromStructure(
      Array.isArray(budgetedAssets) ? budgetedAssets : [],
      Array.isArray(budgetedLiabilities) ? budgetedLiabilities : []
    ).forEach((id) => {
      initial[id] = 0;
    });
    const snap = getYearSnapshot(selectedYear);
    const baseTypes = getDefaultLineAssignedTypes();
    const liabIds = collectLiabilityLineIds(
      Array.isArray(budgetedLiabilities) ? budgetedLiabilities : []
    );
    if (snap) {
      const merged = { ...initial, ...snap.budgetValues };
      setBudgetValues(normalizeBudgetValuesLiabilitiesForecast(merged, liabIds));
      setLineAssignedTypes({ ...baseTypes, ...snap.lineAssignedTypes });
    } else {
      setBudgetValues(initial);
      setLineAssignedTypes(baseTypes);
    }
  }, [selectedYear]);

  const selectedYearRef = useRef(selectedYear);
  selectedYearRef.current = selectedYear;
  useEffect(() => {
    const t = setTimeout(() => {
      saveYearSnapshot(selectedYearRef.current, { budgetValues, lineAssignedTypes });
    }, 400);
    return () => clearTimeout(t);
  }, [budgetValues, lineAssignedTypes]);

  useEffect(() => {
    const t = setTimeout(() => {
      saveBilanStructureSnapshot({
        version: 1,
        assets: budgetedAssets,
        liabilities: budgetedLiabilities,
        categoryLabels: bilanCategoryLabels,
        lineLabels: bilanLineLabels,
      });
    }, 400);
    return () => clearTimeout(t);
  }, [budgetedAssets, budgetedLiabilities, bilanCategoryLabels, bilanLineLabels]);

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

  const commitBilanForecast = useCallback(
    (lineId: string, raw: string) => {
      const trimmed = raw.trim().replace(/,/g, '.');
      let n: number;
      if (trimmed === '') {
        n = 0;
      } else if (trimmed.startsWith('=')) {
        n = evaluateBilanFormulaExpression(trimmed.slice(1).trim());
      } else {
        n = parseFloat(trimmed);
      }
      setBudgetAmount(lineId, Number.isNaN(n) ? 0 : n);
    },
    [setBudgetAmount]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    SourceDataCSVService.loadMergedWithSupport()
      .then((sourceResult) => {
        if (!cancelled) {
          setData(sourceResult ?? null);
          if (!sourceResult) setError('Aucune donnée source (transactions + soutien).');
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'Erreur au chargement.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    AccountBalanceCSVService.loadAllBalanceRows()
      .then((balanceRows) => {
        if (!cancelled) setAccountBalanceRows(balanceRows ?? null);
      })
      .catch(() => {
        if (!cancelled) setAccountBalanceRows(null);
      });
    return () => { cancelled = true; };
  }, []);

  /** Solde total de tous les comptes au 1er janvier de l'année sélectionnée, converti en GBP (pour la ligne Bank). */
  const bankBalanceJan1Gbp = useMemo((): number | null => {
    try {
      if (!accountBalanceRows?.length) return null;
      const jan1 = new Date(selectedYear, 0, 1);
      const jan1Time = jan1.getTime();
      const rowOnOrBeforeJan1 = accountBalanceRows
        .filter((r) => r.date.getTime() <= jan1Time)
        .sort((a, b) => b.date.getTime() - a.date.getTime())[0];
      const rowOnOrAfterJan1 = accountBalanceRows
        .filter((r) => r.date.getTime() >= jan1Time)
        .sort((a, b) => a.date.getTime() - b.date.getTime())[0];
      const row = rowOnOrAfterJan1 ?? rowOnOrBeforeJan1;
      if (!row || !row.balances) return null;
      const entries = loadRecognisedAccountsFromStorage();
      const fiatByCode = new Map<string, AccountFiatCurrency>();
      for (const e of entries) {
        const c = getBalanceCodeForSettingsAccountName(e.name);
        if (c) fiatByCode.set(c, e.currency);
      }
      let totalGbp = 0;
      for (const [accountCode, amount] of Object.entries(row.balances)) {
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
  }, [accountBalanceRows, selectedYear, location.pathname]);

  const totalAssets = (Array.isArray(budgetedAssets) ? budgetedAssets : []).reduce((sum, cat) => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return sum + lines.reduce((s, line) => {
      const id = line?.id ?? '';
      return s + (budgetValues[id] ?? 0);
    }, 0);
  }, 0);
  const totalLiabilities = (Array.isArray(budgetedLiabilities) ? budgetedLiabilities : []).reduce((sum, cat) => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return sum + lines.reduce((s, line) => s + (budgetValues[line?.id ?? ''] ?? 0), 0);
  }, 0);
  /** Passifs forecast stockés en négatif : totalLiabilities ≤ 0, donc TF = actifs + passifs (somme algébrique). */
  const totalFundCF = totalAssets + totalLiabilities;

  const aggregation = useMemo(
    () => aggregateByYear(data, selectedYear),
    [data, selectedYear]
  );

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

  const getActualValue = (lineId: string): number =>
    lineId === 'assets-bank'
      ? (bankBalanceJan1Gbp ?? 0)
      : (actualValues[lineId] ?? 0);

  const totalAssetsActual = (Array.isArray(budgetedAssets) ? budgetedAssets : []).reduce((sum, cat) => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return sum + lines.reduce((s, line) => s + getActualValue(line?.id ?? ''), 0);
  }, 0);
  const totalLiabilitiesActual = (Array.isArray(budgetedLiabilities) ? budgetedLiabilities : []).reduce((sum, cat) => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return sum + lines.reduce((s, line) => s + getActualValue(line?.id ?? ''), 0);
  }, 0);
  // Les montants "liabilities" sont déjà signés (dépenses négatives). Pour la balance, on additionne donc directement.
  const totalFundCFActual = totalAssetsActual + totalLiabilitiesActual;

  const assetsBfCategory =
    (Array.isArray(budgetedAssets) ? budgetedAssets : []).find((c) => c.id === 'assets-bf') ??
    (Array.isArray(budgetedAssets) ? budgetedAssets[0] : undefined);
  const assetsBfLines = assetsBfCategory && Array.isArray(assetsBfCategory.lines) ? assetsBfCategory.lines : [];
  const assetsBfForecast = assetsBfLines.reduce((s, line) => s + (budgetValues[line?.id ?? ''] ?? 0), 0);
  const assetsBfActual = assetsBfLines.reduce((s, line) => s + getActualValue(line?.id ?? ''), 0);
  /** Écart Total Fund C/F vs totaux de la catégorie Assets B/F (même colonne). */
  const fundCfDeltaVsAssetsBfForecast = totalFundCF - assetsBfForecast;
  const fundCfDeltaVsAssetsBfActual = totalFundCFActual - assetsBfActual;

  const typesOrder = useMemo(() => {
    const types = Object.keys(aggregation.byType).filter((t) => t !== 'Sans type');
    types.sort((a, b) => {
      const aVal = aggregation.byType[a] ?? 0;
      const bVal = aggregation.byType[b] ?? 0;
      return aVal - bVal;
    });
    if (aggregation.byType['Sans type']) types.push('Sans type');
    return types;
  }, [aggregation.byType]);

  /** Types entrées pour le menu Affecter (ASSETS) : types reconnus dans Réglages + types présents dans l'année (montant >= 0). */
  const incomeTypes = useMemo(() => {
    const { entryTypes } = loadRecognisedTypesFromSettings();
    const fromYear = Object.entries(aggregation.byType)
      .filter(([, amt]) => amt >= 0)
      .map(([t]) => t);
    return Array.from(new Set([...entryTypes, ...fromYear])).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }, [aggregation.byType]);

  /** Types sorties pour le menu Affecter (LIABILITIES) : types reconnus dans Réglages + types présents dans l'année (montant < 0). */
  const expenseTypes = useMemo(() => {
    const { outputTypes } = loadRecognisedTypesFromSettings();
    const fromYear = Object.entries(aggregation.byType)
      .filter(([, amt]) => amt < 0)
      .map(([t]) => t);
    return Array.from(new Set([...outputTypes, ...fromYear])).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
  }, [aggregation.byType]);

  const toggleLineAssignedType = (lineId: string, typeName: string) => {
    setLineAssignedTypes((prev) => {
      const defaultMap = getDefaultLineAssignedTypes();
      const current = prev[lineId] ?? defaultMap[lineId] ?? [];
      const has = current.includes(typeName);
      const next = has ? current.filter((t) => t !== typeName) : [...current, typeName];
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
    const updater = (prev: BudgetCategory[]) =>
      prev.map((cat) =>
        cat.id === catId
          ? { ...cat, lines: [...cat.lines, { id: lineId, label: 'Nouvelle ligne' }] }
          : cat
      );
    if (side === 'assets') setBudgetedAssets(updater);
    else setBudgetedLiabilities(updater);
    setBilanLineLabels((p) => ({ ...p, [lineId]: 'Nouvelle ligne' }));
  };

  const addCategory = (side: BilanSide) => {
    const catId = `cat-${Date.now()}`;
    const newCat: BudgetCategory = { id: catId, label: 'Nouvelle catégorie', lines: [] };
    if (side === 'assets') setBudgetedAssets((p) => [...p, newCat]);
    else setBudgetedLiabilities((p) => [...p, newCat]);
    setBilanCategoryLabels((p) => ({ ...p, [catId]: 'Nouvelle catégorie' }));
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
      saveYearSnapshot(selectedYear, { budgetValues, lineAssignedTypes });
    }
    setSelectedYear(y);
    try {
      localStorage.setItem(YEAR_STORAGE_KEY, String(y));
    } catch {}
  };

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <p className="text-gray-500">Chargement…</p>
      </main>
    );
  }

  return (
    <main className="flex-1 overflow-auto p-6">
        <div className="max-w-8xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-800 mb-6">Budget annuel</h1>

          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
              {error}
            </div>
          )}

          {/* Sélecteur d'année */}
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <label htmlFor="annual-budget-year" className="text-sm font-medium text-gray-700">
              Année
            </label>
            <select
              id="annual-budget-year"
              value={selectedYear}
              onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
            >
              {(aggregation.yearsAvailable.length
                ? aggregation.yearsAvailable
                : [selectedYear - 2, selectedYear - 1, selectedYear, selectedYear + 1]
              ).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {/* Résumé annuel */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Revenus</p>
              <p className="text-xl font-semibold text-green-700">
                {formatCurrency(aggregation.totalIncome, '£')}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Dépenses</p>
              <p className="text-xl font-semibold text-red-700">
                {formatCurrency(aggregation.totalExpenses, '£')}
              </p>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <p className="text-sm font-medium text-gray-500">Solde annuel</p>
              <p className={`text-xl font-semibold ${aggregation.total >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {formatCurrency(aggregation.total, '£')}
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
                      Feuille de bilan
                    </span>
                    <span className="mt-1.5 block text-sm text-gray-500">
                      <strong className="font-semibold text-gray-600">Année {selectedYear}</strong>
                      {' — '}
                      Forecast (saisie) et Réel (d’après le tableau des transactions et les types associés)
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
                    {bilanEditMode ? 'Quitter le mode édition' : 'Mode édition'}
                  </button>
                  {bilanEditMode ? (
                    <span className="text-xs font-medium text-red-600 sm:text-sm">Mode édition — les cellules sont modifiables</span>
                  ) : null}
                </div>
              </div>
            </header>
            {bilanBlockExpanded ? (
              <div
                id="annual-budget-panel-bilan"
                className="flex min-h-0 flex-col px-4 pb-4 pt-3"
                role="region"
                aria-label="Feuille de bilan"
              >
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-inner">
            <div className="grid grid-cols-1 md:grid-cols-2 border-b border-gray-200">
              <div className="bg-gray-100 py-1.5 px-4 flex items-center gap-4 text-sm font-semibold text-gray-600">
                <span className="flex-1" />
                <span className="w-28 text-right">Forecast</span>
                <span className="w-28 text-right">Réel</span>
              </div>
              <div className="bg-gray-100 py-1.5 px-4 flex items-center gap-4 text-sm font-semibold text-gray-600 md:border-l border-gray-200">
                <span className="flex-1" />
                <span className="w-28 text-right">Forecast</span>
                <span className="w-28 text-right">Réel</span>
              </div>
            </div>
            <div className="flex flex-col md:flex-row">
              <div className="flex-1 min-w-0">
                <div className="divide-y divide-emerald-100">
                  {budgetedAssets.map((cat, catIndex) => {
                    const catLines = Array.isArray(cat.lines) ? cat.lines : [];
                    const catForecast = catLines.reduce((s, l) => s + (budgetValues[l?.id ?? ''] ?? 0), 0);
                    const catActual = catLines.reduce((s, l) => s + getActualValue(l?.id ?? ''), 0);
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
                                title="Remonter la catégorie"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => moveCategory(catIndex, 'down', 'assets')}
                                disabled={catIndex === budgetedAssets.length - 1}
                                className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                title="Descendre la catégorie"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => demoteCategoryToLine(catIndex, 'assets', bilanCategoryLabels[cat.id] ?? cat.label)}
                                disabled={catIndex === 0}
                                className="rounded border border-gray-500 bg-white px-1.5 py-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                title="Réduire le niveau (devenir une ligne)"
                              >
                                Niveau −
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
                                {formatCurrency(catForecast, '£')}
                              </span>
                              <span className="tabular-nums w-28 text-right text-gray-600">
                                {formatCurrency(catActual, '£')}
                              </span>
                            </>
                          )}
                        </div>
                        {catLines.map((line, lineIndex) => {
                          const assigned = lineAssignedTypes[line?.id ?? ''] ?? getDefaultLineAssignedTypes()[line?.id ?? ''] ?? [];
                          const isOpen = affecterOpenLineId === line?.id;
                          return (
                            <div
                              key={line?.id ?? lineIndex}
                              className="flex items-center gap-4 py-1 px-4 pl-8 bg-white border-l-2 border-emerald-100"
                            >
                              {bilanEditMode && (
                                <div className="flex shrink-0 items-center gap-0.5">
                                  <button
                                    type="button"
                                    onClick={() => moveLine(cat.id, lineIndex, 'up', 'assets')}
                                    disabled={lineIndex === 0}
                                    className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                    title="Remonter"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveLine(cat.id, lineIndex, 'down', 'assets')}
                                    disabled={lineIndex === catLines.length - 1}
                                    className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                    title="Descendre"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => promoteLineToCategory(catIndex, lineIndex, 'assets', bilanLineLabels[line?.id ?? ''] ?? line?.label ?? '')}
                                    className="rounded border border-gray-500 bg-white px-1.5 py-1 text-xs hover:bg-gray-100"
                                    title="Augmenter le niveau (devenir une catégorie)"
                                  >
                                    Niveau +
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteLine(cat.id, lineIndex, 'assets')}
                                    className="rounded border border-red-300 bg-white p-1 text-red-600 hover:bg-red-50"
                                    title="Supprimer la ligne"
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
                                <span className="flex-1 text-sm text-gray-700">{bilanLineLabels[line.id] ?? line.label}</span>
                              )}
                              {bilanEditMode ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="w-28 text-right text-sm border border-gray-300 rounded px-2 py-1 tabular-nums focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                  placeholder="—"
                                  title="Saisie directe ou formule : =100*12 puis Entrée"
                                  value={
                                    bilanForecastDrafts[line.id] !== undefined
                                      ? bilanForecastDrafts[line.id]
                                      : budgetValues[line.id] === 0 || budgetValues[line.id] == null
                                        ? ''
                                        : String(budgetValues[line.id])
                                  }
                                  onFocus={() => {
                                    const v = budgetValues[line.id];
                                    setBilanForecastDrafts((prev) => ({
                                      ...prev,
                                      [line.id]: v === 0 || v == null ? '' : String(v),
                                    }));
                                  }}
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
                                    : formatCurrency(budgetValues[line.id] ?? 0, '£')}
                                </span>
                              )}
                              <span className="w-28 text-right text-sm tabular-nums text-gray-700">
                                {formatCurrency(getActualValue(line.id) ?? 0, '£')}
                              </span>
                              {bilanEditMode && (
                                <div
                                  className="relative shrink-0"
                                  ref={isOpen ? affecterDropdownRef : undefined}
                                >
                                  <button
                                    type="button"
                                    onClick={() => setAffecterOpenLineId((prev) => (prev === line.id ? null : line.id))}
                                    className="rounded border border-emerald-600 bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                                  >
                                    Affecter
                                  </button>
                                  {isOpen && (
                                    <div className="absolute left-0 top-full z-20 mt-1 max-h-48 w-56 overflow-auto rounded border border-gray-200 bg-white py-1 shadow-lg">
                                      <div className="px-2 py-1 text-xs font-semibold text-gray-500">Types entrées</div>
                                      {incomeTypes.length === 0 ? (
                                        <div className="px-2 py-1 text-xs text-gray-400">Aucun type pour cette année</div>
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
                                              <span className="min-w-0 truncate">{typeName}</span>
                                              <span className="ml-auto tabular-nums text-gray-500">
                                                {formatCurrency(aggregation.byType[typeName] ?? 0, '£')}
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
                              + Ajouter une ligne
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
                        + Ajouter une catégorie
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-0 border-t md:border-t-0 md:border-l border-gray-200">
                <div className="divide-y divide-red-100">
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
                                title="Remonter la catégorie"
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                onClick={() => moveCategory(catIndex, 'down', 'liabilities')}
                                disabled={catIndex === budgetedLiabilities.length - 1}
                                className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                title="Descendre la catégorie"
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() => demoteCategoryToLine(catIndex, 'liabilities', bilanCategoryLabels[cat.id] ?? cat.label)}
                                disabled={catIndex === 0}
                                className="rounded border border-gray-500 bg-white px-1.5 py-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                title="Réduire le niveau (devenir une ligne)"
                              >
                                Niveau −
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
                                {formatCurrency(catForecast, '£')}
                              </span>
                              <span className="tabular-nums w-28 text-right text-gray-600">
                                {formatCurrency(catActual, '£')}
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
                                    title="Remonter"
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveLine(cat.id, lineIndex, 'down', 'liabilities')}
                                    disabled={lineIndex === catLinesLiab.length - 1}
                                    className="rounded border border-gray-400 bg-white p-1 text-xs disabled:opacity-40 hover:bg-gray-100"
                                    title="Descendre"
                                  >
                                    ↓
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => promoteLineToCategory(catIndex, lineIndex, 'liabilities', bilanLineLabels[line.id] ?? line.label)}
                                    className="rounded border border-gray-500 bg-white px-1.5 py-1 text-xs hover:bg-gray-100"
                                    title="Augmenter le niveau (devenir une catégorie)"
                                  >
                                    Niveau +
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteLine(cat.id, lineIndex, 'liabilities')}
                                    className="rounded border border-red-300 bg-white p-1 text-red-600 hover:bg-red-50"
                                    title="Supprimer la ligne"
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
                                  title="Saisie directe ou formule : =100*12 puis Entrée"
                                  value={
                                    bilanForecastDrafts[line.id] !== undefined
                                      ? bilanForecastDrafts[line.id]
                                      : budgetValues[line.id] === 0 || budgetValues[line.id] == null
                                        ? ''
                                        : String(budgetValues[line.id])
                                  }
                                  onFocus={() => {
                                    const v = budgetValues[line.id];
                                    setBilanForecastDrafts((prev) => ({
                                      ...prev,
                                      [line.id]: v === 0 || v == null ? '' : String(v),
                                    }));
                                  }}
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
                                    : formatCurrency(budgetValues[line.id] ?? 0, '£')}
                                </span>
                              )}
                              <span className="w-28 text-right text-sm tabular-nums text-gray-700">
                                {formatCurrency(getActualValue(line.id), '£')}
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
                                    Affecter
                                  </button>
                                  {isOpen && (
                                    <div className="absolute right-0 top-full z-20 mt-1 max-h-48 w-56 overflow-auto rounded border border-gray-200 bg-white py-1 shadow-lg">
                                      <div className="px-2 py-1 text-xs font-semibold text-gray-500">Types sorties</div>
                                      {expenseTypes.length === 0 ? (
                                        <div className="px-2 py-1 text-xs text-gray-400">Aucun type pour cette année</div>
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
                                              <span className="min-w-0 truncate">{typeName}</span>
                                              <span className="ml-auto tabular-nums text-gray-500">
                                                {formatCurrency(aggregation.byType[typeName] ?? 0, '£')}
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
                              + Ajouter une ligne
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
                        + Ajouter une catégorie
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
                <div className="border-t border-gray-200">
                  <div className="flex flex-col md:flex-row md:items-stretch">
                    <div className="flex flex-1 flex-wrap items-center gap-3 border-b-4 border-b-red-800 border-l-4 border-l-emerald-600 bg-emerald-50 px-4 py-3 sm:gap-4 md:border-b-0">
                      <span className="min-w-0 flex-1 text-sm font-bold text-emerald-900 sm:text-base">TOTAL ASSETS</span>
                      <div className="flex flex-wrap items-end justify-end gap-6 tabular-nums">
                        <div className="text-right">
                          <div className="text-base font-bold text-emerald-950">{formatCurrency(totalAssets, '£')}</div>
                          <div className="text-xs font-medium text-emerald-700">Forecast</div>
                        </div>
                        <div className="text-right">
                          <div className="text-base font-bold text-emerald-950">{formatCurrency(totalAssetsActual, '£')}</div>
                          <div className="text-xs font-medium text-emerald-700">Réel</div>
                        </div>
                      </div>
                    </div>
                    <div
                      className="hidden w-1 shrink-0 self-stretch bg-red-800 md:block"
                      aria-hidden
                    />
                    <div className="flex flex-1 flex-wrap items-center gap-3 bg-red-50 px-4 py-3 sm:gap-4">
                      <span className="min-w-0 flex-1 text-sm font-bold text-red-900 sm:text-base">TOTAL LIABILITIES</span>
                      <div className="flex flex-wrap items-end justify-end gap-6 tabular-nums">
                        <div className="text-right">
                          <div className="text-base font-bold text-red-950">{formatCurrency(totalLiabilities, '£')}</div>
                          <div className="text-xs font-medium text-red-700">Forecast</div>
                        </div>
                        <div className="text-right">
                          <div className="text-base font-bold text-red-950">{formatCurrency(totalLiabilitiesActual, '£')}</div>
                          <div className="text-xs font-medium text-red-700">Réel</div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="border-t-2 border-slate-200 bg-gradient-to-br from-slate-50/95 to-white px-4 py-4 sm:px-6">
                    <div className="flex flex-col items-center gap-5 md:flex-row md:items-center md:justify-between md:gap-10">
                      <span className="shrink-0 text-center text-sm font-bold text-gray-900 sm:text-base md:text-left">
                        Total Fund C/F
                      </span>
                      <div className="flex w-full max-w-2xl flex-1 flex-wrap justify-center gap-12 sm:gap-16 md:max-w-none md:gap-20">
                        <div className="flex min-w-0 flex-col items-center gap-3 text-center">
                          <div className="w-full shrink-0 border-b border-slate-200/80 pb-2">
                            <span className="block text-xs font-normal italic text-gray-600">Forecast</span>
                          </div>
                          <div className="flex w-full min-w-0 flex-nowrap items-center justify-between gap-3 overflow-x-auto">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
                              <div className="flex items-baseline gap-1.5 tabular-nums">
                                <span className="text-[10px] font-normal italic text-gray-500 whitespace-nowrap">
                                  Assets B/F
                                </span>
                                <span className="text-[11px] font-medium leading-none text-gray-600">
                                  {formatCurrency(assetsBfForecast, '£')}
                                </span>
                              </div>
                              <span className="tabular-nums text-xl font-bold leading-none text-gray-900">
                                {formatCurrency(totalFundCF, '£')}
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
                              title="Écart : Total Fund C/F (forecast) − total Assets B/F (forecast)"
                            >
                              {fundCfDeltaVsAssetsBfForecast > 0.005 ? (
                                <>
                                  <span aria-hidden>↑</span>
                                  {formatCurrency(fundCfDeltaVsAssetsBfForecast, '£')}
                                </>
                              ) : fundCfDeltaVsAssetsBfForecast < -0.005 ? (
                                <>
                                  <span aria-hidden>↓</span>
                                  {formatCurrency(Math.abs(fundCfDeltaVsAssetsBfForecast), '£')}
                                </>
                              ) : (
                                <span className="font-normal">—</span>
                              )}
                            </span>
                          </div>
                        </div>
                        <div className="flex min-w-0 flex-col items-center gap-3 text-center">
                          <div className="w-full shrink-0 border-b border-slate-200/80 pb-2">
                            <span className="block text-xs font-normal italic text-gray-600">Réel</span>
                          </div>
                          <div className="flex w-full min-w-0 flex-nowrap items-center justify-between gap-3 overflow-x-auto">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1">
                              <div className="flex items-baseline gap-1.5 tabular-nums">
                                <span className="text-[10px] font-normal italic text-gray-500 whitespace-nowrap">
                                  Assets B/F
                                </span>
                                <span className="text-[11px] font-medium leading-none text-gray-600">
                                  {formatCurrency(assetsBfActual, '£')}
                                </span>
                              </div>
                              <span className="tabular-nums text-xl font-bold leading-none text-gray-900">
                                {formatCurrency(totalFundCFActual, '£')}
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
                              title="Écart : Total Fund C/F (réel) − total Assets B/F (réel)"
                            >
                              {fundCfDeltaVsAssetsBfActual > 0.005 ? (
                                <>
                                  <span aria-hidden>↑</span>
                                  {formatCurrency(fundCfDeltaVsAssetsBfActual, '£')}
                                </>
                              ) : fundCfDeltaVsAssetsBfActual < -0.005 ? (
                                <>
                                  <span aria-hidden>↓</span>
                                  {formatCurrency(Math.abs(fundCfDeltaVsAssetsBfActual), '£')}
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
                    Mouvements par type et par mois
                  </span>
                  <span className="mt-1.5 block text-sm text-gray-500">
                    Année <strong className="font-semibold text-gray-600">{selectedYear}</strong>
                    {' — '}sommes par type sur les 12 mois et ligne de balance
                  </span>
                </span>
              </button>
              <div
                className="flex shrink-0 items-center justify-end gap-1 border-t border-gray-200/80 px-3 py-2 sm:border-t-0 sm:border-l sm:py-0"
                role="group"
                aria-label="Taille du texte du tableau"
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
                  title="Réduire la taille du texte du tableau"
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
                  title="Augmenter la taille du texte du tableau"
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
                aria-label="Mouvements par type et par mois"
              >
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-inner">
            <div
              className="overflow-x-auto"
              style={{ fontSize: `${typesMonthTableFontRem}rem` }}
            >
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-100 border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Type</th>
                    {MONTH_NAMES.map((label, i) => (
                      <th key={i} className="text-right py-3 px-2 font-semibold text-gray-700 w-24">
                        {label}
                      </th>
                    ))}
                    <th
                      className="text-right py-3 px-3 font-semibold text-gray-700 w-28"
                      title="Moyenne sur les mois où il y a un mouvement (non nul)"
                    >
                      Moy. mens.
                    </th>
                    <th className="text-right py-3 px-4 font-semibold text-slate-700 w-28 border-l border-slate-300 bg-slate-200/90">
                      Total
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
                          <td className="py-2 px-4 font-medium text-gray-800">{type}</td>
                          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                            const val = aggregation.byTypeAndMonth[type]?.[m] ?? 0;
                            return (
                              <td
                                key={m}
                                className={`text-right py-2 px-2 tabular-nums ${val >= 0 ? 'text-green-700' : 'text-red-700'}`}
                              >
                                {val === 0 ? '—' : formatCurrency(val, '£')}
                              </td>
                            );
                          })}
                          <td
                            className={`text-right py-2 px-3 font-medium tabular-nums ${rowMonthlyAvg === null ? 'text-gray-400' : rowMonthlyAvg >= 0 ? 'text-green-700' : 'text-red-700'}`}
                          >
                            {rowMonthlyAvg === null ? '—' : formatCurrency(rowMonthlyAvg, '£')}
                          </td>
                          <td
                            className={`border-l border-slate-200/90 bg-slate-100/80 text-right py-2 px-4 font-medium tabular-nums group-hover:bg-slate-100 ${rowTotal >= 0 ? 'text-green-700' : 'text-red-700'}`}
                          >
                            {formatCurrency(rowTotal, '£')}
                          </td>
                        </tr>
                        {type === 'Transport' && (
                          <tr key="total-sorties" className="border-b border-gray-200 bg-red-50 font-semibold">
                            <td className="py-2 px-4 text-gray-800">TOTAL SORTIES</td>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                              const val = totalSortiesByMonth[m] ?? 0;
                              return (
                                <td key={m} className="text-right py-2 px-2 tabular-nums text-red-700">
                                  {val === 0 ? '—' : formatCurrency(val, '£')}
                                </td>
                              );
                            })}
                            <td className="text-right py-2 px-3 tabular-nums text-red-700">
                              {typesByMonthTableAvg.sortiesAvg === null
                                ? '—'
                                : formatCurrency(typesByMonthTableAvg.sortiesAvg, '£')}
                            </td>
                            <td className="border-l border-red-200/80 bg-slate-200/50 text-right py-2 px-4 tabular-nums text-red-800">
                              {formatCurrency(aggregation.totalExpenses, '£')}
                            </td>
                          </tr>
                        )}
                        {type === 'LGV' && (
                          <tr key="total-entrees" className="border-b border-gray-200 bg-green-50 font-semibold">
                            <td className="py-2 px-4 text-gray-800">TOTAL ENTRÉES</td>
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                              const val = totalEntreesByMonth[m] ?? 0;
                              return (
                                <td key={m} className="text-right py-2 px-2 tabular-nums text-green-700">
                                  {val === 0 ? '—' : formatCurrency(val, '£')}
                                </td>
                              );
                            })}
                            <td className="text-right py-2 px-3 tabular-nums text-green-700">
                              {typesByMonthTableAvg.entreesAvg === null
                                ? '—'
                                : formatCurrency(typesByMonthTableAvg.entreesAvg, '£')}
                            </td>
                            <td className="border-l border-emerald-200/80 bg-slate-200/50 text-right py-2 px-4 tabular-nums text-green-800">
                              {formatCurrency(aggregation.totalIncome, '£')}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-semibold">
                    <td className="py-3 px-4 text-gray-800">BALANCE</td>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => {
                      const val = aggregation.byMonth[m] ?? 0;
                      return (
                        <td
                          key={m}
                          className={`text-right py-3 px-2 tabular-nums ${val >= 0 ? 'text-green-700' : 'text-red-700'}`}
                        >
                          {val === 0 ? '—' : formatCurrency(val, '£')}
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
                        : formatCurrency(typesByMonthTableAvg.balanceAvg, '£')}
                    </td>
                    <td
                      className={`border-l border-slate-300 bg-slate-200/70 text-right py-3 px-4 tabular-nums ${aggregation.total >= 0 ? 'text-green-800' : 'text-red-800'}`}
                    >
                      {formatCurrency(aggregation.total, '£')}
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
  );
};

export default AnnualBudget;
