import { useMemo } from 'react';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { formatCurrency } from '../../utils/format';

ChartJS.register(ArcElement, Tooltip, Legend);

/** Nuances de rouge pour les sorties dans le diagramme circulaire. */
const PIE_RED_SHADES = [
  '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
];
/** Nuances de vert pour les entrées dans le diagramme circulaire. */
const PIE_GREEN_SHADES = [
  '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d',
];

function getPieColorForSegment(index: number, isSortie: boolean): string {
  const palette = isSortie ? PIE_RED_SHADES : PIE_GREEN_SHADES;
  return palette[index % palette.length];
}

export type MovementsPieSegment = {
  label: string;
  value: number;
  isSortie: boolean;
};

export type MovementsPieChartProps = {
  segments: MovementsPieSegment[];
  totalSorties: number;
  totalEntrées: number;
  yAxisCurrency: string;
};

const MovementsPieChart: React.FC<MovementsPieChartProps> = ({
  segments,
  totalSorties,
  totalEntrées,
  yAxisCurrency,
}) => {
  const total = totalSorties + totalEntrées;

  const { chartLabels, chartData, chartColors } = useMemo(() => {
    if (segments.length === 0) {
      return { chartLabels: [] as string[], chartData: [] as number[], chartColors: [] as string[] };
    }
    let redIdx = 0;
    let greenIdx = 0;
    return {
      chartLabels: segments.map((s) => s.label),
      chartData: segments.map((s) => s.value),
      chartColors: segments.map((s) =>
        getPieColorForSegment(s.isSortie ? redIdx++ : greenIdx++, s.isSortie)
      ),
    };
  }, [segments]);

  return (
    <div className="w-full h-full min-h-0 flex flex-col items-center justify-center">
      <div className="w-[70%] max-w-full max-h-full aspect-square min-w-0 min-h-0">
        <Pie
          data={{
            labels: chartLabels,
            datasets: [
              {
                data: chartData,
                backgroundColor: chartColors,
                borderColor: '#fff',
                borderWidth: 1,
              },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            rotation: 0,
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const seg = segments[ctx.dataIndex];
                    const v = ctx.parsed as number;
                    const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0';
                    const kind = seg?.isSortie ? 'Sortie' : 'Entrée';
                    return `${ctx.label} (${kind}): ${formatCurrency(v, yAxisCurrency)} (${pct} %)`;
                  },
                },
              },
            },
          }}
        />
      </div>
    </div>
  );
};

export default MovementsPieChart;
