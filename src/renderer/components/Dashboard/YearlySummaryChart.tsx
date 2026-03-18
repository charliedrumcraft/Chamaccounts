import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Chart as ChartJS, ChartOptions, registerables } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { formatCurrency } from '../../utils/format';

/** Régression linéaire y = ax + b sur (index, value). */
function linearRegression(values: number[]): { a: number; b: number } | null {
  const points: { x: number; y: number }[] = [];
  values.forEach((y, x) => {
    if (y !== null && y !== undefined && !Number.isNaN(y)) points.push({ x, y });
  });
  if (points.length < 2) return null;
  const n = points.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  points.forEach(({ x, y }) => {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  });
  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-10) return null;
  const a = (n * sumXY - sumX * sumY) / denom;
  const b = (sumY - a * sumX) / n;
  return { a, b };
}

type MixedDataset = {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number;
  borderDash?: number[];
  type?: 'bar' | 'line';
  order?: number;
  stack?: string;
  fill?: boolean;
  tension?: number;
  pointRadius?: number | number[];
  pointHoverRadius?: number;
  pointHitRadius?: number | number[];
  pointBackgroundColor?: string | string[];
  pointBorderColor?: string | string[];
  hidden?: boolean;
  /** Totaux par année pour le tooltip Balance (custom) */
  sortiesByMonth?: number[];
  entréesByMonth?: number[];
  /** Totaux par année pour le tooltip barres (somme de toutes entrées/sorties de l'année) */
  totalEntréesByIndex?: number[];
  totalSortiesByIndex?: number[];
  /** Affiché uniquement au survol (courbe de tendance) */
  trendEquation?: string;
  /** Affiché uniquement au survol (lignes moyenne) */
  moyenneValue?: string;
  /** Axe Y à utiliser (pour éviter que les lignes s'empilent avec les barres) */
  yAxisID?: string;
};

ChartJS.register(...registerables);

/** Palettes alignées sur MovementsPieChart (rouges sorties, verts entrées). */
const PIE_RED_SHADES = [
  '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
];
const PIE_GREEN_SHADES = [
  '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d',
];
function getPieColorForSegment(index: number, isSortie: boolean): string {
  const palette = isSortie ? PIE_RED_SHADES : PIE_GREEN_SHADES;
  return palette[index % palette.length];
}

export interface YearlySummaryChartData {
  years: number[];
  totalSortiesByYear: Record<number, number>;
  totalEntréesByYear: Record<number, number>;
  /** Types de sorties (ordre par total décroissant) */
  sortieTypes?: string[];
  /** Types d'entrées (ordre par total décroissant) */
  entréeTypes?: string[];
  /** Par type de sortie : tableau de montants par année (même ordre que years) */
  sortiesByTypeByYear?: Record<string, number[]>;
  /** Par type d'entrée : tableau de montants par année */
  entréesByTypeByYear?: Record<string, number[]>;
}

interface YearlySummaryChartProps {
  data: YearlySummaryChartData | null;
  currency?: string;
  height?: number;
  showTrendLine?: boolean;
  showMoyenneEntrées?: boolean;
  showMoyenneSorties?: boolean;
  showMoyenneBalance?: boolean;
  /** Afficher le tableau récapitulatif (balance moyenne, tendance, etc.) sous le graphe */
  showSummaryTable?: boolean;
  hiddenSeriesByLabel?: Record<string, boolean>;
  onLegendVisibilityChange?: (hiddenByLabel: Record<string, boolean>) => void;
}

const YearlySummaryChart: React.FC<YearlySummaryChartProps> = ({
  data,
  currency = '£',
  height = 320,
  showTrendLine = false,
  showMoyenneEntrées = false,
  showMoyenneSorties = false,
  showMoyenneBalance = false,
  showSummaryTable = true,
  hiddenSeriesByLabel = {},
  onLegendVisibilityChange,
}) => {
  const chartRef = useRef<ChartJS<'bar'>>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  const { datasets, initialLimits, tooltipExtraByLabel, summaryStats } = useMemo(() => {
    const emptySummary = {
      balanceMoyenne: 0,
      entréesMoyennes: 0,
      sortiesMoyennes: 0,
      tendancePct: null as number | null,
      trendEquation: null as string | null,
    };
    if (!data || data.years.length === 0) {
      return {
        datasets: [] as MixedDataset[],
        initialLimits: { min: -100, max: 100 },
        tooltipExtraByLabel: {} as Record<string, { trendEquation?: string; moyenneValue?: string }>,
        summaryStats: emptySummary,
      };
    }
    const {
      years,
      totalSortiesByYear,
      totalEntréesByYear,
      sortieTypes = [],
      entréeTypes = [],
      sortiesByTypeByYear = {},
      entréesByTypeByYear = {},
    } = data;

    const barDatasets: MixedDataset[] = [];
    const nYears = years.length;

    const totalEntréesByIndex = years.map((y) => totalEntréesByYear[y] ?? 0);
    const totalSortiesByIndex = years.map((y) => totalSortiesByYear[y] ?? 0);
    const totalsForTooltip = { totalEntréesByIndex, totalSortiesByIndex };

    if (sortieTypes.length > 0 && sortiesByTypeByYear) {
      sortieTypes.forEach((typeLabel, index) => {
        const byYear = sortiesByTypeByYear[typeLabel];
        if (!byYear || byYear.length !== nYears) return;
        const asNegative = byYear.map((v) => -v);
        const color = getPieColorForSegment(index, true);
        barDatasets.push({
          label: typeLabel,
          data: asNegative,
          backgroundColor: color,
          borderColor: color,
          borderWidth: 1,
          type: 'bar',
          order: 2,
          stack: 'year',
          hidden: hiddenSeriesByLabel[typeLabel] ?? false,
          ...totalsForTooltip,
        });
      });
    } else {
      barDatasets.push({
        label: 'Sorties',
        data: years.map((y) => -(totalSortiesByYear[y] ?? 0)),
        backgroundColor: 'rgba(239, 68, 68, 0.8)',
        borderColor: 'rgba(185, 28, 28, 0.9)',
        borderWidth: 1,
        type: 'bar',
        order: 2,
        stack: 'year',
        hidden: hiddenSeriesByLabel['Sorties'] ?? false,
        ...totalsForTooltip,
      });
    }

    if (entréeTypes.length > 0 && entréesByTypeByYear) {
      entréeTypes.forEach((typeLabel, index) => {
        const byYear = entréesByTypeByYear[typeLabel];
        if (!byYear || byYear.length !== nYears) return;
        const color = getPieColorForSegment(index, false);
        barDatasets.push({
          label: typeLabel,
          data: byYear,
          backgroundColor: color,
          borderColor: color,
          borderWidth: 1,
          type: 'bar',
          order: 2,
          stack: 'year',
          hidden: hiddenSeriesByLabel[typeLabel] ?? false,
          ...totalsForTooltip,
        });
      });
    } else {
      barDatasets.push({
        label: 'Entrées',
        data: years.map((y) => totalEntréesByYear[y] ?? 0),
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: 'rgba(22, 163, 74, 0.9)',
        borderWidth: 1,
        type: 'bar',
        order: 2,
        stack: 'year',
        hidden: hiddenSeriesByLabel['Entrées'] ?? false,
        ...totalsForTooltip,
      });
    }

    // Balance = somme des barres visibles (entrées positives, sorties déjà négatives)
    const visibleBalanceByYear: number[] = [];
    const visibleSortiesByYear: number[] = [];
    const visibleEntréesByYear: number[] = [];
    for (let i = 0; i < nYears; i++) {
      let balance = 0;
      let sorties = 0;
      let entrées = 0;
      for (const ds of barDatasets) {
        if (ds.hidden) continue;
        const v = (ds.data as number[])?.[i];
        if (typeof v !== 'number') continue;
        balance += v;
        if (v < 0) sorties += -v;
        else entrées += v;
      }
      visibleBalanceByYear.push(balance);
      visibleSortiesByYear.push(sorties);
      visibleEntréesByYear.push(entrées);
    }

    const lineBalance: MixedDataset = {
      label: 'Balance',
      data: visibleBalanceByYear,
      type: 'line',
      yAxisID: 'yLines',
      borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointRadius: visibleBalanceByYear.map((v) => (v !== null && v !== undefined ? 6 : 0)),
      pointHoverRadius: 8,
      pointBackgroundColor: visibleBalanceByYear.map((v) =>
        v >= 0 ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)'
      ),
      pointBorderColor: visibleBalanceByYear.map((v) =>
        v >= 0 ? 'rgb(22, 163, 74)' : 'rgb(185, 28, 28)'
      ),
      order: 1,
      sortiesByMonth: visibleSortiesByYear,
      entréesByMonth: visibleEntréesByYear,
    };

    const maxEntrées = Math.max(0, ...years.map((y) => totalEntréesByYear[y] ?? 0));
    const maxSorties = Math.max(0, ...years.map((y) => totalSortiesByYear[y] ?? 0));
    const marginHaut = Math.max(maxEntrées * 0.15, 50);
    const marginBas = Math.max(maxSorties * 0.15, 50);
    const initialLimits = {
      min: -maxSorties - marginBas,
      max: maxEntrées + marginHaut,
    };

    const extraLines: MixedDataset[] = [];
    const n = visibleBalanceByYear.length;
    const reg = n >= 2 ? linearRegression(visibleBalanceByYear) : null;
    const trendEquationStr =
      reg != null
        ? `y = ${reg.a >= 0 ? '' : '−'}${Math.abs(reg.a).toFixed(2)}x ${reg.b >= 0 ? '+' : '−'}${formatCurrency(Math.abs(reg.b), currency)}`
        : null;

    if (showTrendLine && reg) {
      const { a, b } = reg;
      const trendData = visibleBalanceByYear.map((_, i) => a * i + b);
      extraLines.push({
        label: 'Tendance',
        data: trendData,
        type: 'line',
        yAxisID: 'yLines',
        borderColor: 'rgba(99, 102, 241, 0.9)',
        borderWidth: 2,
        borderDash: [6, 4],
        fill: false,
        tension: 0,
        pointRadius: 0,
        pointHitRadius: 10,
        order: 0,
        trendEquation: trendEquationStr ?? undefined,
      });
    }

    const moyEntrées = n > 0 ? visibleEntréesByYear.reduce((s, v) => s + v, 0) / n : 0;
    const moySorties = n > 0 ? visibleSortiesByYear.reduce((s, v) => s + v, 0) / n : 0;
    const moyBalance = n > 0 ? visibleBalanceByYear.reduce((s, v) => s + v, 0) / n : 0;

    if (showMoyenneEntrées && n > 0) {
      extraLines.push({
        label: 'Moyenne entrées',
        data: new Array(n).fill(moyEntrées),
        type: 'line',
        yAxisID: 'yLines',
        borderColor: 'rgba(34, 197, 94, 0.8)',
        borderWidth: 1.5,
        borderDash: [4, 4],
        fill: false,
        tension: 0,
        pointRadius: 0,
        order: 0,
        moyenneValue: `+${formatCurrency(moyEntrées, currency)}`,
      });
    }
    if (showMoyenneSorties && n > 0) {
      extraLines.push({
        label: 'Moyenne sorties',
        data: new Array(n).fill(-moySorties),
        type: 'line',
        yAxisID: 'yLines',
        borderColor: 'rgba(239, 68, 68, 0.8)',
        borderWidth: 1.5,
        borderDash: [4, 4],
        fill: false,
        tension: 0,
        pointRadius: 0,
        order: 0,
        moyenneValue: `−${formatCurrency(moySorties, currency)}`,
      });
    }
    if (showMoyenneBalance && n > 0) {
      extraLines.push({
        label: 'Moyenne balance',
        data: new Array(n).fill(moyBalance),
        type: 'line',
        yAxisID: 'yLines',
        borderColor: isDarkMode ? 'rgba(234, 179, 8, 0.9)' : 'rgba(161, 98, 7, 0.9)',
        borderWidth: 1.5,
        borderDash: [4, 4],
        fill: false,
        tension: 0,
        pointRadius: 0,
        order: 0,
        moyenneValue: (moyBalance >= 0 ? '+' : '') + formatCurrency(moyBalance, currency),
      });
    }

    const tooltipExtraByLabel: Record<string, { trendEquation?: string; moyenneValue?: string }> = {};
    extraLines.forEach((ds) => {
      if (ds.trendEquation) tooltipExtraByLabel[ds.label] = { ...tooltipExtraByLabel[ds.label], trendEquation: ds.trendEquation };
      if (ds.moyenneValue) tooltipExtraByLabel[ds.label] = { ...tooltipExtraByLabel[ds.label], moyenneValue: ds.moyenneValue };
    });

    // Indicateurs pour le tableau récapitulatif sous le graphe
    let tendancePct: number | null = null;
    if (n >= 2) {
      const first = visibleBalanceByYear[0];
      const last = visibleBalanceByYear[n - 1];
      if (typeof first === 'number' && typeof last === 'number' && Math.abs(first) > 1e-9) {
        tendancePct = ((last - first) / Math.abs(first)) * 100;
      }
    }

    const summaryStats = {
      balanceMoyenne: moyBalance,
      entréesMoyennes: moyEntrées,
      sortiesMoyennes: moySorties,
      tendancePct,
      trendEquation: trendEquationStr,
    };

    return {
      datasets: [...extraLines, ...barDatasets, lineBalance],
      initialLimits,
      tooltipExtraByLabel,
      summaryStats,
    };
  }, [data, isDarkMode, showTrendLine, showMoyenneEntrées, showMoyenneSorties, showMoyenneBalance, hiddenSeriesByLabel, currency]);

  const options: ChartOptions<'bar'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          top: 8,
          right: 8,
          bottom: 8,
          left: 0,
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 12,
            usePointStyle: true,
            color: isDarkMode ? '#cbd5e1' : '#1e293b',
            font: { size: 11 },
            filter(legendItem: { text?: string }) {
              const label = legendItem.text;
              if (label === 'Tendance' || label === 'Moyenne entrées' || label === 'Moyenne sorties' || label === 'Moyenne balance') return false;
              return true;
            },
          },
          onClick:
            onLegendVisibilityChange
              ? (_e: unknown, legendItem: { text?: string }, _legend: unknown) => {
                  const label = legendItem.text;
                  if (label == null) return;
                  const next: Record<string, boolean> = { ...hiddenSeriesByLabel };
                  next[label] = !(hiddenSeriesByLabel[label] ?? false);
                  onLegendVisibilityChange(next);
                }
              : undefined,
        },
        tooltip: {
          enabled: false,
          external: (context: unknown) => {
            const { tooltip } = context as {
              tooltip: {
                opacity: number;
                dataPoints: Array<{ dataset: MixedDataset; dataIndex: number; parsed: { y: number } }>;
                title?: string[];
                x: number;
                y: number;
              };
            };
            const el = tooltipRef.current;
            if (!el) return;
            if (tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
              el.style.opacity = '0';
              el.style.pointerEvents = 'none';
              return;
            }
            const dp = tooltip.dataPoints[0];
            const dataset = dp.dataset as MixedDataset;
            const idx = dp.dataIndex;
            const title = (tooltip.title && tooltip.title[0]) ?? '';
            const label = (dataset as { label?: string }).label ?? '';
            const extra = tooltipExtraByLabel[label];

            if (extra?.trendEquation) {
              el.innerHTML = [
                `<div style="font-weight:600;margin-bottom:6px;color:${isDarkMode ? '#e2e8f0' : '#333'}">${title}</div>`,
                `<div style="color:rgba(99, 102, 241, 0.95)">${label}: ${extra.trendEquation}</div>`,
              ].join('');
            } else if (extra?.moyenneValue) {
              const bg =
                typeof dataset.borderColor === 'string' ? dataset.borderColor : '#999';
              el.innerHTML = [
                `<div style="font-weight:600;margin-bottom:6px;color:${isDarkMode ? '#e2e8f0' : '#333'}">${title}</div>`,
                `<div><span style="color:${bg}">■</span> ${label}: ${extra.moyenneValue}</div>`,
              ].join('');
            } else if (dataset.sortiesByMonth && dataset.entréesByMonth) {
              const balance = dp.parsed.y;
              const sorties = dataset.sortiesByMonth[idx] ?? 0;
              const entrées = dataset.entréesByMonth[idx] ?? 0;
              const balanceStr =
                balance >= 0
                  ? `+${formatCurrency(balance, currency)}`
                  : formatCurrency(balance, currency);
              const balanceColor = balance >= 0 ? '#16a34a' : '#dc2626';
              el.innerHTML = [
                `<div style="font-weight:600;margin-bottom:6px;color:${isDarkMode ? '#e2e8f0' : '#333'}">${title}</div>`,
                `<div style="color:#16a34a">Entrées: +${formatCurrency(entrées, currency)}</div>`,
                `<div style="color:#dc2626">Sorties: −${formatCurrency(sorties, currency)}</div>`,
                `<div style="border-top:1px solid ${isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)'};margin:6px 0"></div>`,
                `<div style="color:${balanceColor}">Balance: ${balanceStr}</div>`,
              ].join('');
            } else {
              const lines = tooltip.dataPoints.map((p) => {
                const ds = p.dataset as MixedDataset;
                const raw = ds.data?.[p.dataIndex];
                const valWithSign =
                  typeof raw === 'number' ? raw : (p.parsed.y as number);
                const displayVal =
                  valWithSign >= 0
                    ? `+${formatCurrency(valWithSign, currency)}`
                    : formatCurrency(valWithSign, currency);
                const bg =
                  typeof ds.backgroundColor === 'string' ? ds.backgroundColor : '#999';
                return `<div><span style="color:${bg}">■</span> ${ds.label}: ${displayVal}</div>`;
              });
              const hasEntrée = tooltip.dataPoints.some((p) => (p.parsed.y as number) > 0);
              const hasSortie = tooltip.dataPoints.some((p) => (p.parsed.y as number) < 0);
              const dsWithTotals = tooltip.dataPoints[0]?.dataset as MixedDataset & { totalEntréesByIndex?: number[]; totalSortiesByIndex?: number[] };
              const totalEntréesAnnée = dsWithTotals.totalEntréesByIndex?.[idx] ?? 0;
              const totalSortiesAnnée = dsWithTotals.totalSortiesByIndex?.[idx] ?? 0;
              const totalLines: string[] = [];
              if (hasEntrée || hasSortie) {
                totalLines.push(`<div style="border-top:1px solid ${isDarkMode ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.12)'};margin:6px 0"></div>`);
                if (hasEntrée) {
                  totalLines.push(`<div style="color:#16a34a">Total entrées: +${formatCurrency(totalEntréesAnnée, currency)}</div>`);
                }
                if (hasSortie) {
                  totalLines.push(`<div style="color:#dc2626">Total sorties: −${formatCurrency(totalSortiesAnnée, currency)}</div>`);
                }
              }
              el.innerHTML = [
                `<div style="font-weight:600;margin-bottom:6px;color:${isDarkMode ? '#e2e8f0' : '#333'}">${title}</div>`,
                ...lines,
                ...totalLines,
              ].join('');
            }

            el.style.background = isDarkMode
              ? 'rgba(30, 41, 59, 0.95)'
              : 'rgba(255, 255, 255, 0.95)';
            el.style.border = `1px solid ${isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`;
            el.style.borderRadius = '6px';
            el.style.padding = '10px';
            el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
            el.style.color = isDarkMode ? '#cbd5e1' : '#666';
            el.style.opacity = '1';
            el.style.pointerEvents = 'none';

            const { x, y } = tooltip;
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
            el.style.transform = 'translate(-50%, calc(-100% - 10px))';
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: {
            color: isDarkMode ? '#cbd5e1' : '#1e293b',
            maxRotation: 45,
            minRotation: 45,
            font: { size: 11 },
          },
        },
        y: {
          stacked: true,
          min: initialLimits.min,
          max: initialLimits.max,
          grid: {
            color: isDarkMode
              ? (ctx: { tick: { value: number } }) =>
                  ctx.tick.value === 0 ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)'
              : (ctx: { tick: { value: number } }) =>
                  ctx.tick.value === 0 ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.05)',
            lineWidth: (ctx: { tick: { value: number } }) => (ctx.tick.value === 0 ? 2 : 1),
          },
          ticks: {
            color: isDarkMode ? '#cbd5e1' : '#1e293b',
            callback: (value) => formatCurrency(value as number, currency),
          },
        },
        yLines: {
          display: false,
          stacked: false,
          min: initialLimits.min,
          max: initialLimits.max,
          position: 'left',
          grid: { display: false },
          ticks: { display: false },
        },
      },
    }),
    [initialLimits, isDarkMode, currency, hiddenSeriesByLabel, onLegendVisibilityChange, tooltipExtraByLabel]
  );

  if (!data || data.years.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        Aucune donnée annuelle à afficher
      </div>
    );
  }

  const {
    balanceMoyenne,
    entréesMoyennes,
    sortiesMoyennes,
    tendancePct,
    trendEquation,
  } = summaryStats;

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="w-full border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700 overflow-hidden">
        <div className="relative w-full" style={{ height }}>
          <Bar
            ref={chartRef}
            data={{
              labels: data.years.map(String),
              datasets: datasets as any,
            }}
            options={options}
          />
          <div
            ref={tooltipRef}
            className="absolute z-[9999] transition-opacity duration-150"
            style={{
              opacity: 0,
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
      {showSummaryTable && (
      <div className="w-full overflow-x-auto border border-gray-200 rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700 shadow-sm">
        <table className="w-full text-sm border-collapse min-w-0">
          <tbody>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300 w-1/2">Balance moyenne</td>
              <td className="px-3 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">
                {(balanceMoyenne >= 0 ? '+' : '') + formatCurrency(balanceMoyenne, currency)}
              </td>
            </tr>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Total entrées moyen</td>
              <td className="px-3 py-2 text-right tabular-nums text-green-700 dark:text-green-400">
                +{formatCurrency(entréesMoyennes, currency)}
              </td>
            </tr>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Total sorties moyen</td>
              <td className="px-3 py-2 text-right tabular-nums text-red-700 dark:text-red-400">
                −{formatCurrency(sortiesMoyennes, currency)}
              </td>
            </tr>
            <tr className="border-b border-gray-200 dark:border-gray-700">
              <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Tendance hausse/baisse</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {tendancePct != null ? (
                  <span className={tendancePct >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}>
                    {tendancePct >= 0 ? '+' : ''}{tendancePct.toFixed(1)} %
                  </span>
                ) : (
                  <span className="text-gray-500 dark:text-gray-400">—</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">Courbe de tendance</td>
              <td className="px-3 py-2 text-right tabular-nums text-indigo-600 dark:text-indigo-400">
                {trendEquation ?? '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
};

export default YearlySummaryChart;
