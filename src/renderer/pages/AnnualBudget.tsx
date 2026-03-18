import React, { useState, useEffect, useMemo, useRef } from 'react';
import Sidebar from '../components/Layout/Sidebar';
import { SourceDataCSVService, type SourceDataResult } from '../services/SourceDataCSVService';
import { AccountBalanceCSVService, ACCOUNT_CODE_TO_CURRENCY, type BalanceRow } from '../services/AccountBalanceCSVService';
import { convertToAxisCurrency, type CurrencySymbol } from '../services/EffectiveExchangeRates';
import { formatCurrency } from '../utils/format';

const STORAGE_KEY = 'annual-budget-sidebar-collapsed';
const YEAR_STORAGE_KEY = 'annual-budget-selected-year';

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
interface BudgetLine {
  id: string;
  label: string;
}
interface BudgetCategory {
  id: string;
  label: string;
  lines: BudgetLine[];
}

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

/**
 * Correspondance Type (colonne du tableau des transactions) → id de ligne de la feuille de bilan.
 * Les montants réels par type (aggregation.byType) sont ventilés sur ces lignes pour afficher le "réel".
 */
const TYPE_TO_BALANCE_LINE_ID: Record<string, string> = {
  // Assets / revenus
  'Lampton': 'ni-lampton',
  'Lampton School': 'ni-lampton',
  'LMB': 'ni-lmb',
  'LTL': 'ni-ltl',
  'MPC': 'ni-mpc',
  'LGV': 'ni-lgv',
  'Papa/Maman': 'fsp-papa-maman',
  'Theo Vogt': 'fsp-theo-vogt',
  'Candlefish': 'fsp-candlefish',
  'André': 'fsp-andre',
  'Elsa Vogt': 'fsp-elsa-vogt',
  'Support': 'fsp-other',
  'Perspectives': 'fspers-perspectives',
  'Freddy Riess': 'fspers-freddy-riess',
  'Leopaul Vogt': 'fspers-leopaul-vogt',
  'Andre Vogt': 'fspers-andre-vogt',
  'Refund': 'oi-refund',
  'Other Inc': 'oi-other',
  'Benefit': 'oi-benefit',
  'SLC credit': 'slc-credit',
  'SLCcredit': 'slc-credit',
  // Passifs / dépenses
  'Rent': 'hc-rent',
  'Comm': 'hc-comm',
  'Electricity': 'hc-electricity',
  'Water': 'hc-water',
  'Service Charge': 'hc-service-charge',
  'Transport': 'mob-transport',
  'Fuel': 'mob-fuel',
  'Car': 'mob-car',
  'Food': 'lc-food',
  'Restaurant': 'lc-restaurant',
  'Shopping': 'lc-shopping',
  'Leisure': 'lc-leisure',
  'Holiday': 'lc-holiday',
  'Health': 'lc-health',
  'Misc': 'misc-total',
  'Donation': 'donation-total',
  'LST': 'tr-lst-fees',
  'LST Fees': 'tr-lst-fees',
  'School': 'tr-school',
  'SLC Maria': 'slc-maria',
  'SLC Charlie': 'slc-charlie',
  'SLCdebit': 'slc-maria',
  'Council': 'slc-council-tax',
  'Council tax': 'slc-council-tax',
  'Other taxes': 'slc-other-taxes',
};

/** Pour chaque ligne de bilan, types affectés par défaut (inverse de TYPE_TO_BALANCE_LINE_ID). */
function getDefaultLineAssignedTypes(): Record<string, string[]> {
  const lineToTypes: Record<string, string[]> = {};
  for (const [type, lineId] of Object.entries(TYPE_TO_BALANCE_LINE_ID)) {
    if (!lineToTypes[lineId]) lineToTypes[lineId] = [];
    lineToTypes[lineId].push(type);
  }
  return lineToTypes;
}

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
  const yearsAvailable: number[] = [];

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

function getAllBudgetLineIds(): string[] {
  return getLineIdsFromStructure(BUDGETED_ASSETS, BUDGETED_LIABILITIES);
}

function getInitialBilanLabels(): { categoryLabels: Record<string, string>; lineLabels: Record<string, string> } {
  const categoryLabels: Record<string, string> = {};
  const lineLabels: Record<string, string> = {};
  for (const cat of BUDGETED_ASSETS) {
    categoryLabels[cat.id] = cat.label;
    for (const line of cat.lines) lineLabels[line.id] = line.label;
  }
  for (const cat of BUDGETED_LIABILITIES) {
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

const AnnualBudget: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [data, setData] = useState<SourceDataResult | null>(null);
  const [accountBalanceRows, setAccountBalanceRows] = useState<BalanceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(YEAR_STORAGE_KEY);
      if (saved) {
        const y = parseInt(saved, 10);
        if (!Number.isNaN(y) && y >= 2000 && y <= 2100) return y;
      }
    } catch {}
    return new Date().getFullYear();
  });

  /** Structure éditable du bilan (mode édition). */
  const [budgetedAssets, setBudgetedAssets] = useState<BudgetCategory[]>(() => deepCloneCategories(BUDGETED_ASSETS));
  const [budgetedLiabilities, setBudgetedLiabilities] = useState<BudgetCategory[]>(() =>
    deepCloneCategories(BUDGETED_LIABILITIES)
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
    getAllBudgetLineIds().forEach((id) => { initial[id] = 0; });
    return initial;
  });

  const [bilanEditMode, setBilanEditMode] = useState(false);
  const [bilanCategoryLabels, setBilanCategoryLabels] = useState<Record<string, string>>(
    () => getInitialBilanLabels().categoryLabels
  );
  const [bilanLineLabels, setBilanLineLabels] = useState<Record<string, string>>(
    () => getInitialBilanLabels().lineLabels
  );
  /** Pour chaque ligne, types de transactions affectés (pour la colonne Réel). */
  const [lineAssignedTypes, setLineAssignedTypes] = useState<Record<string, string[]>>(
    () => getDefaultLineAssignedTypes()
  );
  /** Id de la ligne dont le menu "Affecter" est ouvert, ou null. */
  const [affecterOpenLineId, setAffecterOpenLineId] = useState<string | null>(null);

  const setBudgetAmount = (lineId: string, value: number) => {
    setBudgetValues((prev) => ({ ...prev, [lineId]: value }));
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    SourceDataCSVService.load()
      .then((sourceResult) => {
        if (!cancelled) {
          setData(sourceResult ?? null);
          if (!sourceResult) setError('Aucune donnée source (source_data.csv).');
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
      let totalGbp = 0;
      for (const [accountCode, amount] of Object.entries(row.balances)) {
        const currencyStr = ACCOUNT_CODE_TO_CURRENCY[accountCode] ?? '£';
        const currency: CurrencySymbol = currencyStr === '€' ? '€' : currencyStr === 'CHF' ? 'CHF' : '£';
        totalGbp += convertToAxisCurrency(Number(amount), currency, '£');
      }
      return Number.isFinite(totalGbp) ? totalGbp : null;
    } catch {
      return null;
    }
  }, [accountBalanceRows, selectedYear]);

  /** Valeur forecast pour une ligne : Bank = solde total au 1er jan (GBP), sinon valeur saisie. */
  const getForecastValue = (lineId: string): number =>
    lineId === 'assets-bank'
      ? (bankBalanceJan1Gbp ?? budgetValues[lineId] ?? 0)
      : (budgetValues[lineId] ?? 0);

  const totalAssets = (Array.isArray(budgetedAssets) ? budgetedAssets : []).reduce((sum, cat) => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return sum + lines.reduce((s, line) => s + getForecastValue(line?.id ?? ''), 0);
  }, 0);
  const totalLiabilities = (Array.isArray(budgetedLiabilities) ? budgetedLiabilities : []).reduce((sum, cat) => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return sum + lines.reduce((s, line) => s + (budgetValues[line?.id ?? ''] ?? 0), 0);
  }, 0);
  const totalFundCF = totalAssets - totalLiabilities;

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

  const totalAssetsActual = (Array.isArray(budgetedAssets) ? budgetedAssets : []).reduce((sum, cat) => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return sum + lines.reduce((s, line) => s + (actualValues[line?.id ?? ''] ?? 0), 0);
  }, 0);
  const totalLiabilitiesActual = (Array.isArray(budgetedLiabilities) ? budgetedLiabilities : []).reduce((sum, cat) => {
    const lines = Array.isArray(cat?.lines) ? cat.lines : [];
    return sum + lines.reduce((s, line) => s + (actualValues[line?.id ?? ''] ?? 0), 0);
  }, 0);
  const totalFundCFActual = totalAssetsActual - totalLiabilitiesActual;

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

  const handleYearChange = (y: number) => {
    setSelectedYear(y);
    try {
      localStorage.setItem(YEAR_STORAGE_KEY, String(y));
    } catch {}
  };

  if (loading) {
    return (
      <div className="flex min-h-screen bg-gray-50">
        <Sidebar collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <main className="flex-1 flex items-center justify-center p-6">
          <p className="text-gray-500">Chargement…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar collapsed={sidebarCollapsed} onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)} />
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

          {/* Feuille de bilan : Forecast | Réel */}
          <section className="mb-8 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-gray-800 uppercase tracking-wide">
                    Feuille de bilan
                  </h2>
                  <div className="mt-2 text-sm text-gray-600">
                    <strong>Année:</strong> {selectedYear} — Forecast (saisie) et Réel (d’après le tableau des transactions et les types associés)
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setBilanEditMode((v) => !v)}
                    className={`rounded border px-3 py-1.5 text-sm font-medium text-white ${
                      bilanEditMode
                        ? 'border-gray-500 bg-gray-500 hover:bg-gray-600'
                        : 'border-red-600 bg-red-600 hover:bg-red-700'
                    }`}
                  >
                    {bilanEditMode ? 'Quitter le mode édition' : 'Mode édition'}
                  </button>
                  {bilanEditMode && (
                    <span className="text-red-600 text-sm font-medium">Mode édition — les cellules sont modifiables</span>
                  )}
                </div>
              </div>
            </div>

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
                    const catForecast = catLines.reduce((s, l) => s + getForecastValue(l?.id ?? ''), 0);
                    const catActual = catLines.reduce((s, l) => s + (actualValues[l?.id ?? ''] ?? 0), 0);
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
                              {line.id === 'assets-bank' && bankBalanceJan1Gbp != null ? (
                                <span
                                  className="w-28 text-right text-sm tabular-nums text-gray-700"
                                  title="Solde total des comptes au 1er janvier (converti en GBP)"
                                >
                                  {formatCurrency(bankBalanceJan1Gbp, '£')}
                                </span>
                              ) : bilanEditMode ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="w-28 text-right text-sm border border-gray-300 rounded px-2 py-1 tabular-nums focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                  placeholder="—"
                                  value={
                                    getForecastValue(line.id) === 0 || getForecastValue(line.id) == null
                                      ? ''
                                      : String(getForecastValue(line.id))
                                  }
                                  onChange={(e) => {
                                    const raw = e.target.value.trim().replace(',', '.');
                                    const n = raw === '' ? 0 : parseFloat(raw);
                                    setBudgetAmount(line.id, Number.isNaN(n) ? 0 : n);
                                  }}
                                />
                              ) : (
                                <span className="w-28 text-right text-sm tabular-nums text-gray-700">
                                  {getForecastValue(line.id) === 0 || getForecastValue(line.id) == null
                                    ? '—'
                                    : formatCurrency(getForecastValue(line.id), '£')}
                                </span>
                              )}
                              <span className="w-28 text-right text-sm tabular-nums text-gray-700">
                                {formatCurrency(actualValues[line.id] ?? 0, '£')}
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
                    const catActual = catLinesLiab.reduce((s, l) => s + (actualValues[l?.id ?? ''] ?? 0), 0);
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
                                  value={
                                    budgetValues[line.id] === 0 || budgetValues[line.id] == null
                                      ? ''
                                      : String(budgetValues[line.id])
                                  }
                                  onChange={(e) => {
                                    const raw = e.target.value.trim().replace(',', '.');
                                    const n = raw === '' ? 0 : parseFloat(raw);
                                    setBudgetAmount(line.id, Number.isNaN(n) ? 0 : n);
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
                                {formatCurrency(actualValues[line.id] ?? 0, '£')}
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

            {/* TOTAL ASSETS / TOTAL LIABILITIES en bas du tableau */}
            <div className="flex flex-col md:flex-row border-t-2 border-gray-200">
              <div className="flex-1 min-w-0">
                <div className="bg-emerald-800 text-white font-bold py-2 px-4 flex items-center gap-4">
                  <span className="flex-1">TOTAL ASSETS</span>
                  <span className="tabular-nums w-28 text-right">{formatCurrency(totalAssets, '£')}</span>
                  <span className="tabular-nums w-28 text-right">{formatCurrency(totalAssetsActual, '£')}</span>
                </div>
              </div>
              <div className="flex-1 min-w-0 border-t md:border-t-0 md:border-l border-gray-200">
                <div className="bg-red-800 text-white font-bold py-2 px-4 flex items-center gap-4">
                  <span className="flex-1">TOTAL LIABILITIES</span>
                  <span className="tabular-nums w-28 text-right" title="Forecast">{formatCurrency(totalLiabilities, '£')}</span>
                  <span className="tabular-nums w-28 text-right" title="Réel">{formatCurrency(totalLiabilitiesActual, '£')}</span>
                </div>
              </div>
            </div>

            {/* Total Fund C/F */}
            <div className="bg-amber-600 text-white font-bold py-3 px-4 flex items-center gap-4 border-t-2 border-amber-700">
              <span className="flex-1">Total Fund C/F</span>
              <span className="tabular-nums w-28 text-right">{formatCurrency(totalFundCF, '£')}</span>
              <span className="tabular-nums w-28 text-right">{formatCurrency(totalFundCFActual, '£')}</span>
            </div>
          </section>

          {/* Tableau par type et par mois */}
          <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 border-b border-gray-200">
                    <th className="text-left py-3 px-4 font-semibold text-gray-700">Type</th>
                    {MONTH_NAMES.map((label, i) => (
                      <th key={i} className="text-right py-3 px-2 font-semibold text-gray-700 w-24">
                        {label}
                      </th>
                    ))}
                    <th className="text-right py-3 px-4 font-semibold text-gray-700 w-28">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {typesOrder.map((type) => {
                    const rowTotal = aggregation.byType[type] ?? 0;
                    return (
                      <React.Fragment key={type}>
                        <tr className="border-b border-gray-100 hover:bg-gray-50">
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
                            className={`text-right py-2 px-4 font-medium tabular-nums ${rowTotal >= 0 ? 'text-green-700' : 'text-red-700'}`}
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
                            <td className="text-right py-2 px-4 tabular-nums text-red-700">
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
                            <td className="text-right py-2 px-4 tabular-nums text-green-700">
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
                      className={`text-right py-3 px-4 tabular-nums ${aggregation.total >= 0 ? 'text-green-700' : 'text-red-700'}`}
                    >
                      {formatCurrency(aggregation.total, '£')}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AnnualBudget;
