import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Chart as ChartJS, ChartOptions, registerables } from 'chart.js';
import { Bar } from 'react-chartjs-2';
import { formatCurrency } from '../../utils/format';

type MixedDataset = {
  label: string;
  data: number[];
  backgroundColor?: string | string[];
  borderColor?: string | string[];
  borderWidth?: number;
  type?: 'bar' | 'line';
  order?: number;
  stack?: string;
  fill?: boolean;
  tension?: number;
  pointRadius?: number | number[];
  pointHoverRadius?: number;
  pointBackgroundColor?: string | string[];
  pointBorderColor?: string | string[];
  hidden?: boolean;
  /** Totaux mensuels pour le tooltip Balance (custom) */
  sortiesByMonth?: number[];
  entréesByMonth?: number[];
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

export interface MovementsMonthlyChartData {
  months: string[];
  /** Sorties par mois (totaux) */
  sortiesByMonth: number[];
  /** Entrées par mois (totaux) */
  entréesByMonth: number[];
  /** Balance par mois = entrées - sorties */
  balanceByMonth: number[];
  /** Types de sorties (ordre = même que pie, par total décroissant) */
  sortieTypes?: string[];
  /** Types d'entrées (ordre = même que pie) */
  entréeTypes?: string[];
  /** Par type de sortie : tableau de montants par mois */
  sortiesByTypeByMonth?: Record<string, number[]>;
  /** Par type d'entrée : tableau de montants par mois */
  entréesByTypeByMonth?: Record<string, number[]>;
}

interface MovementsMonthlyChartProps {
  data: MovementsMonthlyChartData | null;
  currency?: string;
  /** Hauteur du conteneur du graphique en pixels (défaut 280). */
  height?: number;
  hiddenSeriesByLabel?: Record<string, boolean>;
  onLegendVisibilityChange?: (hiddenByLabel: Record<string, boolean>) => void;
}

const MovementsMonthlyChart: React.FC<MovementsMonthlyChartProps> = ({
  data,
  currency = '£',
  height = 280,
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

  const { datasets, initialLimits } = useMemo(() => {
    if (!data || data.months.length === 0) {
      return { datasets: [] as MixedDataset[], initialLimits: { min: -100, max: 100 } };
    }

    const {
      sortiesByMonth,
      entréesByMonth,
      sortieTypes = [],
      entréeTypes = [],
      sortiesByTypeByMonth = {},
      entréesByTypeByMonth = {},
    } = data;

    const barDatasets: MixedDataset[] = [];
    const nMonths = data.months.length;

    if (sortieTypes.length > 0 && sortiesByTypeByMonth) {
      sortieTypes.forEach((typeLabel, index) => {
        const monthly = sortiesByTypeByMonth[typeLabel];
        if (!monthly) return;
        const asNegative = monthly.map((v) => -v);
        const color = getPieColorForSegment(index, true);
        barDatasets.push({
          label: typeLabel,
          data: asNegative,
          backgroundColor: color,
          borderColor: color,
          borderWidth: 1,
          type: 'bar',
          order: 2,
          stack: 'month',
          hidden: hiddenSeriesByLabel[typeLabel] ?? false,
        });
      });
    } else {
      barDatasets.push({
        label: 'Sorties',
        data: sortiesByMonth.map((v) => -v),
        backgroundColor: 'rgba(239, 68, 68, 0.8)',
        borderColor: 'rgba(185, 28, 28, 0.9)',
        borderWidth: 1,
        type: 'bar',
        order: 2,
        stack: 'month',
        hidden: hiddenSeriesByLabel['Sorties'] ?? false,
      });
    }

    if (entréeTypes.length > 0 && entréesByTypeByMonth) {
      entréeTypes.forEach((typeLabel, index) => {
        const monthly = entréesByTypeByMonth[typeLabel];
        if (!monthly) return;
        const color = getPieColorForSegment(index, false);
        barDatasets.push({
          label: typeLabel,
          data: monthly,
          backgroundColor: color,
          borderColor: color,
          borderWidth: 1,
          type: 'bar',
          order: 2,
          stack: 'month',
          hidden: hiddenSeriesByLabel[typeLabel] ?? false,
        });
      });
    } else {
      barDatasets.push({
        label: 'Entrées',
        data: entréesByMonth,
        backgroundColor: 'rgba(34, 197, 94, 0.8)',
        borderColor: 'rgba(22, 163, 74, 0.9)',
        borderWidth: 1,
        type: 'bar',
        order: 2,
        stack: 'month',
        hidden: hiddenSeriesByLabel['Entrées'] ?? false,
      });
    }

    // Balance = somme des barres visibles (entrées positives, sorties déjà négatives)
    const visibleBalanceByMonth: number[] = [];
    const visibleSortiesByMonth: number[] = [];
    const visibleEntréesByMonth: number[] = [];
    for (let i = 0; i < nMonths; i++) {
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
      visibleBalanceByMonth.push(balance);
      visibleSortiesByMonth.push(sorties);
      visibleEntréesByMonth.push(entrées);
    }

    const lineBalance: MixedDataset = {
      label: 'Balance',
      data: visibleBalanceByMonth,
      type: 'line',
      borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.6)',
      borderWidth: 2,
      fill: false,
      tension: 0.3,
      pointRadius: visibleBalanceByMonth.map((v) => (v !== null && v !== undefined ? 6 : 0)),
      pointHoverRadius: 8,
      pointBackgroundColor: visibleBalanceByMonth.map((v) =>
        v >= 0 ? 'rgb(34, 197, 94)' : 'rgb(239, 68, 68)'
      ),
      pointBorderColor: visibleBalanceByMonth.map((v) =>
        v >= 0 ? 'rgb(22, 163, 74)' : 'rgb(185, 28, 28)'
      ),
      order: 1,
      sortiesByMonth: visibleSortiesByMonth,
      entréesByMonth: visibleEntréesByMonth,
    };

    const allBarValues = [
      ...visibleBalanceByMonth,
      ...barDatasets.filter((d) => !d.hidden).flatMap((d) => d.data as number[]),
    ];
    const min = Math.min(...allBarValues);
    const max = Math.max(...allBarValues);
    const range = max - min || 1;
    const margin = Math.max(range * 0.2, Math.max(Math.abs(min), Math.abs(max)) * 0.1, 50);
    const initialLimits = { min: min - margin, max: max + margin };

    return {
      datasets: [...barDatasets, lineBalance],
      initialLimits,
    };
  }, [data, isDarkMode, hiddenSeriesByLabel]);

  const options: ChartOptions<'bar'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 12,
            usePointStyle: true,
            color: isDarkMode ? '#cbd5e1' : '#1e293b',
            font: { size: 11 },
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

            if (dataset.sortiesByMonth && dataset.entréesByMonth) {
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
              el.innerHTML = [
                `<div style="font-weight:600;margin-bottom:6px;color:${isDarkMode ? '#e2e8f0' : '#333'}">${title}</div>`,
                ...lines,
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
      },
    }),
    [initialLimits, isDarkMode, currency, hiddenSeriesByLabel, onLegendVisibilityChange]
  );

  if (!data || data.months.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500 text-sm">
        Aucune donnée mensuelle à afficher
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ height }}>
      <Bar
        ref={chartRef}
        data={{
          labels: data.months,
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
  );
};

export default MovementsMonthlyChart;
