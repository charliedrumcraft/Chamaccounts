import React, { useMemo, useState, useEffect } from 'react';
import { Chart as ChartJS, ChartOptions, Filler, registerables } from 'chart.js';
import { Line } from 'react-chartjs-2';
import { formatCurrency } from '../../utils/format';

ChartJS.register(...registerables, Filler);

const SEGMENT_UP = '#16a34a';
const SEGMENT_DOWN = '#dc2626';

interface AccountBalanceStockChartProps {
  periods: string[];
  balanceData: (number | null)[];
  yAxisCurrency: string;
  height?: number;
}

/**
 * Graphique style boursier : un seul compte, segments verts (variation positive)
 * ou rouges (variation négative) d'un mois à l'autre.
 * La plage temporelle (periods / balanceData) est déjà filtrée par le DateRangeSlider.
 */
const AccountBalanceStockChart: React.FC<AccountBalanceStockChartProps> = ({
  periods,
  balanceData,
  yAxisCurrency,
  height = 220,
}) => {
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

  const segmentColor = (ctx: any): string => {
    const chart = ctx.chart;
    const data = chart?.data?.datasets?.[ctx.datasetIndex]?.data as (number | null)[];
    if (!data || data.length < 2) return SEGMENT_UP;
    const i0 = ctx.p0DataIndex;
    const i1 = ctx.p1DataIndex;
    const v0 = data[i0];
    const v1 = data[i1];
    if (v0 == null || v1 == null || Number.isNaN(v0) || Number.isNaN(v1)) return SEGMENT_UP;
    return v1 >= v0 ? SEGMENT_UP : SEGMENT_DOWN;
  };

  const pointColor = (ctx: any): string => {
    const data = ctx.dataset?.data as (number | null)[];
    if (!data || data.length < 2) return SEGMENT_UP;
    const i = ctx.dataIndex;
    if (i === 0) return SEGMENT_UP;
    const v0 = data[i - 1];
    const v1 = data[i];
    if (v0 == null || v1 == null || Number.isNaN(v0) || Number.isNaN(v1)) return SEGMENT_UP;
    return v1 >= v0 ? SEGMENT_UP : SEGMENT_DOWN;
  };

  const dataset = useMemo(() => {
    const data = balanceData.map((v) => (v != null && !Number.isNaN(v) ? v : null));
    return {
      label: 'Solde',
      data,
      borderColor: SEGMENT_UP,
      backgroundColor: 'transparent',
      borderWidth: 2,
      fill: true,
      tension: 0.1,
      pointRadius: 3,
      pointHoverRadius: 6,
      pointBackgroundColor: (ctx: any) => pointColor(ctx),
      pointBorderColor: isDarkMode ? '#1e293b' : '#ffffff',
      pointBorderWidth: 2,
      segment: {
        borderColor: (ctx: any) => segmentColor(ctx),
        backgroundColor: (ctx: any) => {
          const c = segmentColor(ctx);
          return c === SEGMENT_UP ? 'rgba(22, 163, 74, 0.15)' : 'rgba(220, 38, 38, 0.15)';
        },
      },
      spanGaps: false,
    };
  }, [balanceData, isDarkMode]);

  const options: ChartOptions<'line'> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
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
            maxRotation: 45,
            minRotation: 0,
            font: { size: 11 },
          },
        },
        y: {
          title: {
            display: true,
            text: `Solde (${yAxisCurrency})`,
            font: { size: 12, weight: 'bold' },
            color: isDarkMode ? '#cbd5e1' : '#1e293b',
          },
          grid: {
            color: isDarkMode
              ? (ctx: any) =>
                  ctx.tick.value === 0 ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)'
              : (ctx: any) =>
                  ctx.tick.value === 0 ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.05)',
            lineWidth: (ctx: any) => (ctx.tick.value === 0 ? 2 : 1),
          },
          ticks: {
            color: isDarkMode ? '#cbd5e1' : '#1e293b',
            callback: function (value, index, values) {
              if (index === 0 || index === values.length - 1) return '';
              return formatCurrency(value as number, yAxisCurrency);
            },
          },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: isDarkMode ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.95)',
          titleColor: isDarkMode ? '#e2e8f0' : '#333',
          bodyColor: isDarkMode ? '#cbd5e1' : '#666',
          borderColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (context: any) => {
              const data = context.dataset?.data as (number | null)[];
              const i = context.dataIndex;
              const v = context.parsed.y;
              if (v == null) return '';
              const lines: string[] = [`Solde: ${formatCurrency(v, yAxisCurrency)}`];
              if (i > 0 && data?.length) {
                const vPrev = data[i - 1];
                if (vPrev != null && !Number.isNaN(vPrev)) {
                  const balanceDiff = v - vPrev;
                  lines.push(
                    `Écart: ${balanceDiff >= 0 ? '+' : ''}${formatCurrency(balanceDiff, yAxisCurrency)}`
                  );
                  if (vPrev !== 0) {
                    const balancePct = ((v - vPrev) / vPrev) * 100;
                    lines.push(`Variation: ${balancePct >= 0 ? '+' : ''}${balancePct.toFixed(1)} %`);
                  }
                }
              }
              return lines;
            },
          },
        },
      },
    }),
    [isDarkMode, yAxisCurrency]
  );

  if (!periods.length || balanceData.every((v) => v == null || Number.isNaN(v))) {
    return (
      <div
        className="flex items-center justify-center text-gray-500 text-sm border border-dashed border-gray-200 rounded-lg"
        style={{ height }}
      >
        Aucune donnée pour ce compte sur la période.
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height }}>
      <Line
        data={{
          labels: periods,
          datasets: [dataset],
        }}
        options={options}
      />
    </div>
  );
};

export default AccountBalanceStockChart;
