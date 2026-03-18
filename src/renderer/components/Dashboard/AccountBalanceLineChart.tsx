import React, { useRef, useMemo, useCallback, useEffect, useState } from 'react';
import { Chart as ChartJS, ChartOptions, registerables } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { formatCurrency } from '../../utils/format';

ChartJS.register(...registerables);

/** Calcule la régression linéaire y = ax + b pour les points (index, value); ignore les null/NaN. */
export function linearRegression(values: (number | null)[]): { a: number; b: number } | null {
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

interface AccountBalanceLineChartProps {
  periods: string[];
  accounts: string[];
  accountCodes?: string[];
  balanceData: number[][];
  accountColors: Record<string, string>;
  granularity: 'day' | 'week' | 'month';
  /** Symbole de la devise pour l'axe Y (défaut: GBP £) */
  yAxisCurrency?: string;
  /** Type d'échelle de l'axe vertical (défaut: linéaire) */
  yAxisScale?: 'linear' | 'logarithmic';
  /** Courbes de tendance par code compte (clé = accountCode). Clé spéciale 'TOTAL' pour la tendance du solde total. */
  trendLinesEnabled?: Record<string, boolean>;
  /** Séries cachées via la légende (clé = label affiché, ex. nom du compte ou "Solde total"). true = barrée / cachée. */
  hiddenSeriesByLabel?: Record<string, boolean>;
  /** Appelé quand l'utilisateur clique sur la légende pour cacher/afficher une série. */
  onLegendVisibilityChange?: (hiddenByLabel: Record<string, boolean>) => void;
}

const AccountBalanceLineChart: React.FC<AccountBalanceLineChartProps> = ({
  periods,
  accounts,
  accountCodes = [],
  balanceData,
  accountColors,
  granularity,
  yAxisCurrency = '£',
  yAxisScale = 'linear',
  trendLinesEnabled = {},
  hiddenSeriesByLabel = {},
  onLegendVisibilityChange,
}) => {
  const chartRef = useRef<ChartJS<'line'>>(null);
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

  const calculateYAxisLimits = useCallback((datasets: any[]) => {
    if (datasets.length === 0 || !datasets[0]?.data) {
      return { min: 0, max: 1000 };
    }
    let minValue = Infinity;
    let maxValue = -Infinity;
    datasets.forEach(dataset => {
      dataset.data.forEach((value: number) => {
        if (value !== null && value !== undefined) {
          if (value < minValue) minValue = value;
          if (value > maxValue) maxValue = value;
        }
      });
    });
    if (minValue === Infinity || maxValue === -Infinity) {
      return { min: 0, max: 1000 };
    }
    const range = maxValue - minValue;
    const margin = range * 0.1 || Math.abs(maxValue) * 0.1 || 100;
    return {
      min: minValue - margin,
      max: maxValue + margin,
    };
  }, []);

  const datasets = useMemo(() =>
    accounts.map((account, index) => {
      const rawData = balanceData[index] || [];
      // Premier indice où le solde est non nul (le compte "existe")
      let firstNonZeroIndex = rawData.length;
      for (let i = 0; i < rawData.length; i++) {
        const v = rawData[i];
        if (v !== 0 && v !== null && v !== undefined && !Number.isNaN(v)) {
          firstNonZeroIndex = i;
          break;
        }
      }
      const data = rawData.map((value, i) => (i < firstNonZeroIndex ? null : value));
      const label = account;
      return {
        label,
        data,
        borderColor: accountColors[account] || '#808080',
        backgroundColor: accountColors[account] || '#808080',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBackgroundColor: accountColors[account] || '#808080',
        pointBorderColor: isDarkMode ? '#1e293b' : '#ffffff',
        pointBorderWidth: 2,
        spanGaps: false,
        hidden: hiddenSeriesByLabel[label] ?? false,
      };
    }), [accounts, balanceData, accountColors, isDarkMode, hiddenSeriesByLabel]
  );

  /** Courbe du solde total (tous comptes). Les balanceData sont déjà dans yAxisCurrency (conversion EUR→GBP etc. faite en amont). */
  const totalBalanceDataset = useMemo(() => {
    const nPeriods = periods.length;
    if (nPeriods === 0 || balanceData.length === 0) return null;
    const totalData: (number | null)[] = [];
    for (let p = 0; p < nPeriods; p++) {
      let sum = 0;
      let hasValue = false;
      for (let acc = 0; acc < balanceData.length; acc++) {
        const v = balanceData[acc]?.[p];
        if (v !== null && v !== undefined && !Number.isNaN(v)) {
          sum += v;
          hasValue = true;
        }
      }
      totalData.push(hasValue ? sum : null);
    }
    return {
      label: 'Solde total',
      data: totalData,
      borderColor: isDarkMode ? '#f59e0b' : '#b45309',
      backgroundColor: 'transparent',
      borderWidth: 3,
      fill: false,
      tension: 0.4,
      pointRadius: 4,
      pointHoverRadius: 6,
      pointBackgroundColor: isDarkMode ? '#f59e0b' : '#b45309',
      pointBorderColor: isDarkMode ? '#1e293b' : '#ffffff',
      pointBorderWidth: 2,
      spanGaps: false,
      hidden: hiddenSeriesByLabel['Solde total'] ?? false,
    };
  }, [periods.length, balanceData, isDarkMode, hiddenSeriesByLabel]);

  /** Courbe de tendance du solde total (même règle que les comptes : régression sur les points à partir du premier non nul). */
  const totalTrendDataset = useMemo(() => {
    if (!(trendLinesEnabled['TOTAL'] ?? false) || !totalBalanceDataset) return null;
    const rawData = totalBalanceDataset.data as (number | null)[];
    const firstNonZeroIndex = rawData.findIndex(
      (v) => v !== 0 && v !== null && v !== undefined && !Number.isNaN(v)
    );
    const from = firstNonZeroIndex === -1 ? rawData.length : firstNonZeroIndex;
    const slice = rawData.map((v, i) => (i < from ? null : v));
    const reg = linearRegression(slice);
    if (!reg) return null;
    const trendData = rawData.map((_, i) => reg.a * i + reg.b);
    const totalColor = isDarkMode ? '#f59e0b' : '#b45309';
    return {
      label: 'Tendance – Solde total',
      data: trendData,
      trendEquation: { a: reg.a, b: reg.b },
      borderColor: totalColor,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [6, 4],
      fill: false,
      tension: 0,
      pointRadius: 0,
      pointHoverRadius: 0,
      spanGaps: false,
      hidden: hiddenSeriesByLabel['Solde total'] ?? false,
    };
  }, [trendLinesEnabled, totalBalanceDataset, isDarkMode, hiddenSeriesByLabel]);

  const trendDatasets = useMemo(() => {
    return accountCodes.map((code, index) => {
      if (!(trendLinesEnabled[code] ?? false)) return null;
      const rawData = balanceData[index] ?? [];
      const firstNonZeroIndex = rawData.findIndex(
        (v) => v !== 0 && v !== null && v !== undefined && !Number.isNaN(v)
      );
      const from = firstNonZeroIndex === -1 ? rawData.length : firstNonZeroIndex;
      const slice = rawData.map((v, i) => (i < from ? null : v));
      const reg = linearRegression(slice);
      if (!reg) return null;
    const account = accounts[index] ?? code;
    const trendData = rawData.map((_, i) => reg.a * i + reg.b);
    return {
      label: `Tendance – ${account}`,
      data: trendData,
      trendEquation: { a: reg.a, b: reg.b },
      borderColor: accountColors[account] ?? '#808080',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [6, 4],
      fill: false,
      tension: 0,
      pointRadius: 0,
      pointHoverRadius: 0,
      spanGaps: false,
      hidden: hiddenSeriesByLabel[account] ?? false,
    };
  });
  }, [accountCodes, accounts, balanceData, accountColors, trendLinesEnabled, hiddenSeriesByLabel]);

  const allDatasets = useMemo(() => {
    const mainAndTrend = datasets.flatMap((ds, i) =>
      trendDatasets[i] ? [ds, trendDatasets[i]!] : [ds]
    );
    const withTotal = totalBalanceDataset
      ? [...mainAndTrend, totalBalanceDataset, ...(totalTrendDataset ? [totalTrendDataset] : [])]
      : mainAndTrend;
    return withTotal;
  }, [datasets, trendDatasets, totalBalanceDataset, totalTrendDataset]);

  /** Indices dans allDatasets des séries "solde" (pour recalcul des limites Y), y compris le solde total */
  const mainDatasetIndices = useMemo(() => {
    const indices: number[] = [];
    let j = 0;
    for (let i = 0; i < datasets.length; i++) {
      indices.push(j);
      j += trendDatasets[i] ? 2 : 1;
    }
    if (totalBalanceDataset) indices.push(j);
    return indices;
  }, [datasets.length, trendDatasets, totalBalanceDataset]);

  const initialLimits = useMemo(() =>
    calculateYAxisLimits(
      totalBalanceDataset
        ? [...datasets, totalBalanceDataset]
        : datasets
    ),
    [datasets, totalBalanceDataset, calculateYAxisLimits]
  );

  const options: ChartOptions<'line'> = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    scales: {
      x: {
        grid: {
          display: true,
          color: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
        },
        ticks: {
          color: isDarkMode ? '#cbd5e1' : '#1e293b',
          maxRotation: granularity === 'day' ? 45 : granularity === 'week' ? 0 : 0,
          minRotation: granularity === 'day' ? 45 : 0,
          font: { size: 11 },
        },
      },
      y: {
        type: yAxisScale === 'logarithmic' ? 'logarithmic' : 'linear',
        title: {
          display: true,
          text: `Solde (${yAxisCurrency})`,
          font: { size: 14, weight: 'bold' },
          color: isDarkMode ? '#cbd5e1' : '#1e293b',
        },
        ...(yAxisScale === 'linear'
          ? { min: initialLimits.min, max: initialLimits.max }
          : { min: undefined, max: undefined }),
        grid: {
          color: isDarkMode
            ? (context: any) => (context.tick.value === 0 ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)')
            : (context: any) => (context.tick.value === 0 ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.05)'),
          lineWidth: (context: any) => (context.tick.value === 0 ? 2 : 1),
        },
        ticks: {
          color: isDarkMode ? '#cbd5e1' : '#1e293b',
          callback: function (value, index, values) {
            // Ne pas afficher les valeurs extrêmes (premier et dernier tick)
            if (index === 0 || index === values.length - 1) return '';
            return formatCurrency(value as number, yAxisCurrency);
          },
        },
      },
    },
    plugins: {
      legend: {
        position: 'bottom' as const,
        onClick: function (e, legendItem, legend) {
          ChartJS.defaults.plugins.legend.onClick.call(this, e, legendItem, legend);
          const chart = legend.chart;
          if (!chart) return;
          if (yAxisScale === 'linear') {
            const visibleDatasets = mainDatasetIndices
              .filter((index) => !chart.getDatasetMeta(index).hidden)
              .map((index) => chart.data.datasets[index]);
            const newLimits = calculateYAxisLimits(visibleDatasets);
            if (chart.options.scales && chart.options.scales.y) {
              chart.options.scales.y.min = newLimits.min;
              chart.options.scales.y.max = newLimits.max;
            }
          }
          chart.update();
          if (onLegendVisibilityChange && chart.data.datasets) {
            const hiddenByLabel: Record<string, boolean> = {};
            chart.data.datasets.forEach((ds: any, index) => {
              if (ds.trendEquation) return;
              const label = ds.label;
              if (label != null) {
                hiddenByLabel[label] = chart.getDatasetMeta(index).hidden;
              }
            });
            onLegendVisibilityChange(hiddenByLabel);
          }
        },
        labels: {
          padding: 15,
          usePointStyle: true,
          pointStyle: 'circle',
          font: { size: 11 },
          color: isDarkMode ? '#cbd5e1' : '#1e293b',
          filter: (legendItem: any, ctx: any) => {
            const datasets = ctx.datasets ?? ctx.data?.datasets;
            const dataset = datasets?.[legendItem.datasetIndex];
            return !dataset?.trendEquation;
          },
        },
      },
      tooltip: {
        backgroundColor: isDarkMode ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.95)',
        titleColor: isDarkMode ? '#e2e8f0' : '#333',
        bodyColor: isDarkMode ? '#cbd5e1' : '#666',
        borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
        borderWidth: 1,
        padding: 10,
        filter: (tooltipItem: any) => !(tooltipItem.dataset?.trendEquation),
        callbacks: {
          label: function (context: any) {
            const label = context.dataset.label || '';
            const valueLine =
              context.parsed.y !== null
                ? `${label}: ${formatCurrency(context.parsed.y, yAxisCurrency)}`
                : label;
            return valueLine;
          },
        },
      },
    },
  }), [initialLimits, calculateYAxisLimits, isDarkMode, granularity, yAxisCurrency, yAxisScale, mainDatasetIndices, onLegendVisibilityChange]);

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Line
        ref={chartRef}
        data={{
          labels: periods,
          datasets: allDatasets,
        }}
        options={options}
      />
    </div>
  );
};

export default AccountBalanceLineChart;
