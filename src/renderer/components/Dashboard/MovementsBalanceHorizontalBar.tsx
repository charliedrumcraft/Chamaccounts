import React, { useMemo, useState } from 'react';
import { formatCurrency } from '../../utils/format';
import type { MovementsMonthlyChartData } from './MovementsMonthlyChart';

/** Palettes alignées sur MovementsPieChart. */
const PIE_RED_SHADES = [
  '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d',
];
const PIE_GREEN_SHADES = [
  '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d',
];
function getColor(index: number, isSortie: boolean): string {
  const palette = isSortie ? PIE_RED_SHADES : PIE_GREEN_SHADES;
  return palette[index % palette.length];
}

interface MovementsBalanceHorizontalBarProps {
  /** Données mensuelles (période = slider) ; on agrège par type sur toute la période. */
  data: MovementsMonthlyChartData | null;
  currency?: string;
  /** Séries cachées via la légende du graphique mensuel. */
  hiddenSeriesByLabel?: Record<string, boolean>;
}

const BAR_HEIGHT = 40;
const CENTER_LINE_WIDTH = 4;
/** Durée de transition au changement de période (aligné sur le ressenti du graphique mensuel). */
const TRANSITION_MS = 320;
const MovementsBalanceHorizontalBar: React.FC<MovementsBalanceHorizontalBarProps> = ({
  data,
  currency = '£',
  hiddenSeriesByLabel = {},
}) => {
  const [hoverBalance, setHoverBalance] = useState<boolean>(false);
  const [hoverSegment, setHoverSegment] = useState<{ label: string; value: number; isSortie: boolean } | null>(null);

  const aggregated = useMemo(() => {
    if (!data || !data.months?.length) return null;
    const {
      entréeTypes = [],
      sortieTypes = [],
      entréesByTypeByMonth = {},
      sortiesByTypeByMonth = {},
      entréesByMonth = [],
      sortiesByMonth = [],
    } = data;

    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const entréesByType: Record<string, number> = {};
    entréeTypes.forEach((type) => {
      if (hiddenSeriesByLabel[type]) return;
      const monthly = entréesByTypeByMonth[type];
      entréesByType[type] = monthly ? sum(monthly) : 0;
    });
    const sortiesByType: Record<string, number> = {};
    sortieTypes.forEach((type) => {
      if (hiddenSeriesByLabel[type]) return;
      const monthly = sortiesByTypeByMonth[type];
      sortiesByType[type] = monthly ? sum(monthly) : 0;
    });

    let totalEntrées = Object.values(entréesByType).reduce((a, b) => a + b, 0);
    let totalSorties = Object.values(sortiesByType).reduce((a, b) => a + b, 0);
    if (totalEntrées === 0 && entréesByMonth.length > 0 && entréeTypes.length === 0 && !hiddenSeriesByLabel['Entrées']) {
      totalEntrées = sum(entréesByMonth);
    }
    if (totalSorties === 0 && sortiesByMonth.length > 0 && sortieTypes.length === 0 && !hiddenSeriesByLabel['Sorties']) {
      totalSorties = sum(sortiesByMonth);
    }

    const balance = totalEntrées - totalSorties;

    const leftSegments = entréeTypes
      .filter((t) => !hiddenSeriesByLabel[t])
      .filter((t) => (entréesByType[t] ?? 0) > 0)
      .map((type, i) => ({
        label: type,
        value: entréesByType[type] ?? 0,
        isSortie: false,
        color: getColor(i, false),
      }));
    const rightSegments = sortieTypes
      .filter((t) => !hiddenSeriesByLabel[t])
      .filter((t) => (sortiesByType[t] ?? 0) > 0)
      .map((type, i) => ({
        label: type,
        value: sortiesByType[type] ?? 0,
        isSortie: true,
        color: getColor(i, true),
      }));
    const leftFinal = leftSegments.length > 0 ? leftSegments : totalEntrées > 0 ? [{ label: 'Entrées', value: totalEntrées, isSortie: false as const, color: getColor(0, false) }] : [];
    const rightFinal = rightSegments.length > 0 ? rightSegments : totalSorties > 0 ? [{ label: 'Sorties', value: totalSorties, isSortie: true as const, color: getColor(0, true) }] : [];

    return {
      totalEntrées,
      totalSorties,
      balance,
      leftSegments: leftFinal,
      rightSegments: rightFinal,
    };
  }, [data, hiddenSeriesByLabel]);

  if (!aggregated) return null;
  const { totalEntrées, totalSorties, balance, leftSegments, rightSegments } = aggregated;

  /** Les deux empilements se touchent toujours : largeurs proportionnelles au total. */
  const total = totalEntrées + totalSorties || 1;
  const leftBarWidthPercent = (totalEntrées / total) * 100;
  const rightBarWidthPercent = (totalSorties / total) * 100;

  const tooltipContent = hoverSegment
    ? `${hoverSegment.label}: ${formatCurrency(hoverSegment.isSortie ? -hoverSegment.value : hoverSegment.value, currency)}`
    : hoverBalance
      ? `Balance: ${formatCurrency(balance, currency)}`
      : null;

  return (
    <div className="w-full flex flex-col items-stretch">
      {/* Balance au-dessus de l'histogramme */}
      <div
        className="flex justify-center items-center flex-shrink-0 text-xs font-medium text-gray-700 dark:text-gray-300 mb-1 w-full transition-opacity duration-200"
        style={{ height: 20 }}
      >
        {balance > 0 && `+${formatCurrency(balance, currency)}`}
        {balance < 0 && formatCurrency(balance, currency)}
        {balance === 0 && formatCurrency(0, currency)}
      </div>

      {/* Empilements qui se touchent ; le trait 0 est en overlay (squelette fixe). */}
      <div
        className="relative flex items-stretch w-full"
        style={{ height: BAR_HEIGHT }}
      >
        {/* Entrées : depuis la marge gauche, peut dépasser le 0 si balance > 0 */}
        <div
          className="flex justify-start flex-shrink-0 overflow-hidden"
          style={{
            width: `${leftBarWidthPercent}%`,
            minWidth: 0,
            transition: `width ${TRANSITION_MS}ms ease-out`,
          }}
        >
          {leftSegments.map((seg) => {
            const wPercent = totalEntrées > 0 ? (seg.value / totalEntrées) * 100 : 0;
            return (
              <div
                key={seg.label}
                style={{
                  width: `${wPercent}%`,
                  minWidth: wPercent > 0 ? 2 : 0,
                  backgroundColor: seg.color,
                  transition: `width ${TRANSITION_MS}ms ease-out`,
                }}
                title={`${seg.label}: ${formatCurrency(seg.value, currency)}`}
                onMouseEnter={() => setHoverSegment({ label: seg.label, value: seg.value, isSortie: false })}
                onMouseLeave={() => setHoverSegment(null)}
              />
            );
          })}
        </div>

        {/* Sorties : touche toujours les entrées (depuis la frontière) */}
        <div
          className="flex flex-row-reverse justify-start flex-shrink-0 overflow-hidden"
          style={{
            width: `${rightBarWidthPercent}%`,
            minWidth: 0,
            transition: `width ${TRANSITION_MS}ms ease-out`,
          }}
        >
          {rightSegments.map((seg) => {
            const wPercent = totalSorties > 0 ? (seg.value / totalSorties) * 100 : 0;
            return (
              <div
                key={seg.label}
                style={{
                  width: `${wPercent}%`,
                  minWidth: wPercent > 0 ? 2 : 0,
                  backgroundColor: seg.color,
                  transition: `width ${TRANSITION_MS}ms ease-out`,
                }}
                title={`${seg.label}: ${formatCurrency(-seg.value, currency)}`}
                onMouseEnter={() => setHoverSegment({ label: seg.label, value: seg.value, isSortie: true })}
                onMouseLeave={() => setHoverSegment(null)}
              />
            );
          })}
        </div>

        {/* Trait 0 : squelette fixe au centre (overlay) */}
        <div
          className="absolute top-0 bottom-0 cursor-default border-dashed box-border pointer-events-auto border-gray-800 dark:border-gray-200"
          style={{
            left: '50%',
            width: CENTER_LINE_WIDTH,
            marginLeft: -CENTER_LINE_WIDTH / 2,
            borderLeftWidth: CENTER_LINE_WIDTH,
            borderLeftStyle: 'dashed',
          }}
          title={`Balance: ${formatCurrency(balance, currency)}`}
          onMouseEnter={() => setHoverBalance(true)}
          onMouseLeave={() => setHoverBalance(false)}
        />
      </div>

      {/* "0" sous le graphe, aligné sur le trait 0 (fixe au centre) */}
      <div className="relative text-xs font-medium text-gray-800 dark:text-gray-200 mt-0.5 w-full" style={{ height: 16 }}>
        <span className="absolute -translate-x-1/2" style={{ left: '50%' }}>
          0
        </span>
      </div>

      {tooltipContent && (
        <div
          className="mt-2 px-2 py-1 text-sm bg-gray-800 dark:bg-gray-700 text-white rounded shadow-lg"
          role="tooltip"
        >
          {tooltipContent}
        </div>
      )}
    </div>
  );
};

export default MovementsBalanceHorizontalBar;
