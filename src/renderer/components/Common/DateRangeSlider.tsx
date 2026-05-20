import React, { useEffect, useMemo, useRef, useState } from 'react';
import noUiSlider from 'nouislider';
import type { API } from 'nouislider';
import 'nouislider/dist/nouislider.css';
import {
  format,
  isValid,
  startOfMonth,
  endOfMonth,
  addMonths,
  isBefore,
  startOfYear,
  endOfYear,
  addYears,
} from 'date-fns';
import { fr } from 'date-fns/locale';

const safeFormat = (ts: number, fmt: string): string => {
  const d = new Date(ts);
  if (!isValid(d)) return '';
  return format(d, fmt, { locale: fr });
};

interface DateRangeSliderProps {
  minDate: Date;
  maxDate: Date;
  onChange: (startDate: Date, endDate: Date) => void;
  startDate?: Date;
  endDate?: Date;
  /** Case à cocher : si cochée, ce slider se synchronise avec l'autre (affiché dans le slider). */
  syncLabel?: string;
  syncChecked?: boolean;
  onSyncChange?: (checked: boolean) => void;
  /** Mode années civiles : pas mensuels mais du 1er janv. au 31 déc. */
  fullYearsMode?: boolean;
  /** Si fourni, affiche la case « année complète » et appelle au changement. */
  onFullYearsModeChange?: (enabled: boolean) => void;
  /** Libellé optionnel pour la case années complètes. */
  fullYearsLabel?: string;
}

/** Liste des timestamps des 1ers du mois entre minDate et maxDate (inclus). */
function getMonthlyTimestamps(minDate: Date, maxDate: Date): number[] {
  const minTs = startOfMonth(minDate).getTime();
  const maxTs = startOfMonth(maxDate).getTime();
  if (minTs > maxTs) return [];
  const out: number[] = [];
  let d = new Date(minTs);
  const end = new Date(maxTs);
  while (!isBefore(end, d)) {
    out.push(d.getTime());
    d = addMonths(d, 1);
  }
  return out;
}

/** Liste des timestamps des 1er janvier pour chaque année couverte par [minDate, maxDate]. */
function getYearlyTimestamps(minDate: Date, maxDate: Date): number[] {
  const minTs = startOfYear(minDate).getTime();
  const maxTs = startOfYear(maxDate).getTime();
  if (minTs > maxTs) return [];
  const out: number[] = [];
  let t = minTs;
  while (t <= maxTs) {
    out.push(t);
    t = addYears(new Date(t), 1).getTime();
  }
  return out;
}

/** Index du mois contenant date (ou 0 / length-1 si en dehors). */
function dateToMonthIndex(date: Date, monthlyTimestamps: number[]): number {
  if (monthlyTimestamps.length === 0) return 0;
  const ts = startOfMonth(date).getTime();
  const idx = monthlyTimestamps.findIndex((t) => t > ts);
  if (idx === -1) return monthlyTimestamps.length - 1;
  if (idx === 0) return 0;
  return idx - 1;
}

/** Index de l’année civile contenant date (ticks = 1er janvier). */
function dateToYearIndex(date: Date, yearlyTimestamps: number[]): number {
  if (yearlyTimestamps.length === 0) return 0;
  const ts = startOfYear(date).getTime();
  const idx = yearlyTimestamps.findIndex((t) => t > ts);
  if (idx === -1) return yearlyTimestamps.length - 1;
  if (idx === 0) return 0;
  return idx - 1;
}

const DateRangeSlider: React.FC<DateRangeSliderProps> = ({
  minDate,
  maxDate,
  onChange,
  startDate: controlledStartDate,
  endDate: controlledEndDate,
  syncLabel,
  syncChecked = false,
  onSyncChange,
  fullYearsMode = false,
  onFullYearsModeChange,
  fullYearsLabel = 'Années complètes (1er janv. – 31 déc.)',
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [slider, setSlider] = useState<API | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [cursorLabel, setCursorLabel] = useState<{ which: 'start' | 'end'; text: string } | null>(null);

  const controlledStartTs =
    controlledStartDate && isValid(controlledStartDate) ? controlledStartDate.getTime() : undefined;
  const controlledEndTs =
    controlledEndDate && isValid(controlledEndDate) ? controlledEndDate.getTime() : undefined;

  const monthlyTimestamps = useMemo(
    () => getMonthlyTimestamps(minDate, maxDate),
    [minDate, maxDate]
  );

  const yearlyTimestamps = useMemo(
    () => getYearlyTimestamps(minDate, maxDate),
    [minDate, maxDate]
  );

  const tickTimestamps = fullYearsMode ? yearlyTimestamps : monthlyTimestamps;

  const dateToTickIndex = (date: Date): number =>
    fullYearsMode ? dateToYearIndex(date, yearlyTimestamps) : dateToMonthIndex(date, monthlyTimestamps);

  const shiftFullYearRange = (deltaYears: -1 | 1) => {
    if (!fullYearsMode || yearlyTimestamps.length === 0) return;
    const maxIdx = yearlyTimestamps.length - 1;
    const startIdx = dateToYearIndex(controlledStartDate ?? minDate, yearlyTimestamps);
    const endIdx = dateToYearIndex(controlledEndDate ?? maxDate, yearlyTimestamps);
    const newStartIdx = startIdx + deltaYears;
    const newEndIdx = endIdx + deltaYears;
    if (newStartIdx < 0 || newEndIdx > maxIdx || newStartIdx > newEndIdx) return;
    const t0 = yearlyTimestamps[newStartIdx];
    const t1 = yearlyTimestamps[newEndIdx];
    onChangeRef.current(new Date(t0), endOfYear(new Date(t1)));
  };

  const fullYearStartIdx =
    fullYearsMode && yearlyTimestamps.length > 0
      ? dateToYearIndex(controlledStartDate ?? minDate, yearlyTimestamps)
      : 0;
  const fullYearEndIdx =
    fullYearsMode && yearlyTimestamps.length > 0
      ? dateToYearIndex(controlledEndDate ?? maxDate, yearlyTimestamps)
      : 0;
  const maxYearIdx = yearlyTimestamps.length > 0 ? yearlyTimestamps.length - 1 : 0;
  const canShiftFullYearBack = fullYearsMode && fullYearStartIdx > 0;
  const canShiftFullYearForward = fullYearsMode && fullYearEndIdx < maxYearIdx;

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const styleId = 'daterange-slider-custom-styles';
    let style = document.getElementById(styleId) as HTMLStyleElement;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = `
      .noUi-target {
        background: ${isDarkMode ? '#374151' : '#e5e7eb'};
        border: none;
        border-radius: 8px;
        box-shadow: ${isDarkMode ? 'inset 0 2px 4px rgba(0,0,0,0.3)' : 'inset 0 2px 4px rgba(0,0,0,0.1)'};
        transition: all 0.3s ease;
      }
      .noUi-connect {
        background: linear-gradient(135deg, #3a80d2 0%, #4a90e2 100%);
        border-radius: 8px;
        box-shadow: 0 2px 6px rgba(58, 128, 210, 0.4);
        transition: all 0.3s ease;
      }
      .noUi-connect.noUi-draggable {
        cursor: grab;
      }
      .noUi-target.noUi-state-drag .noUi-connect.noUi-draggable {
        cursor: grabbing;
      }
      .noUi-handle {
        width: 20px !important;
        height: 20px !important;
        right: -10px !important;
        top: -5px !important;
        border: 3px solid ${isDarkMode ? '#1f2937' : '#ffffff'};
        border-radius: 50%;
        background: linear-gradient(135deg, #3a80d2 0%, #4a90e2 100%);
        box-shadow: 0 2px 8px rgba(58, 128, 210, 0.5), 0 0 0 4px ${isDarkMode ? 'rgba(58, 128, 210, 0.2)' : 'rgba(58, 128, 210, 0.1)'};
        cursor: grab;
        transition: all 0.2s ease;
      }
      .noUi-handle:active {
        cursor: grabbing;
        transform: scale(1.15);
        box-shadow: 0 4px 12px rgba(58, 128, 210, 0.6), 0 0 0 6px ${isDarkMode ? 'rgba(58, 128, 210, 0.3)' : 'rgba(58, 128, 210, 0.2)'};
      }
      .noUi-handle:hover {
        transform: scale(1.1);
        box-shadow: 0 3px 10px rgba(58, 128, 210, 0.6), 0 0 0 5px ${isDarkMode ? 'rgba(58, 128, 210, 0.25)' : 'rgba(58, 128, 210, 0.15)'};
      }
      .noUi-handle::before,
      .noUi-handle::after {
        display: none;
      }
    `;
  }, [isDarkMode]);

  useEffect(() => {
    const el = sliderRef.current;
    if (!el || tickTimestamps.length === 0) return;
    const existing = (el as unknown as { noUiSlider?: API }).noUiSlider;
    if (existing) {
      try {
        existing.destroy();
      } catch {
        // déjà détruit
      }
    }

    const maxIdx = tickTimestamps.length - 1;
    const startIdx = Math.min(dateToTickIndex(controlledStartDate ?? minDate), maxIdx);
    const endIdx = Math.min(Math.max(startIdx, dateToTickIndex(controlledEndDate ?? maxDate)), maxIdx);

    const sliderInstance = noUiSlider.create(el, {
      start: [startIdx, endIdx],
      connect: true,
      range: { min: 0, max: maxIdx },
      step: 1,
      tooltips: false,
      /** `drag` : glisser la barre entre les poignées déplace toute la plage (écart conservé). `tap` : clic sur la piste. */
      behaviour: 'drag-tap',
    });

    sliderInstance.on('start', (_values: (number | string)[], handleNumber: number) => {
      const values = sliderInstance.get() as (number | string)[];
      const idx = Number(values[handleNumber]);
      const ts = tickTimestamps[idx] ?? tickTimestamps[0];
      const which = handleNumber === 0 ? ('start' as const) : ('end' as const);
      const dateForLabel =
        handleNumber === 0
          ? new Date(ts)
          : fullYearsMode
            ? endOfYear(new Date(ts))
            : endOfMonth(new Date(ts));
      const text = safeFormat(dateForLabel.getTime(), 'd MMM yyyy');
      if (text) setCursorLabel({ which, text });
    });

    sliderInstance.on('update', (_values: (number | string)[], handleNumber: number) => {
      const values = sliderInstance.get() as (number | string)[];
      const idx = Number(values[handleNumber]);
      const ts = tickTimestamps[idx] ?? tickTimestamps[0];
      const which = handleNumber === 0 ? ('start' as const) : ('end' as const);
      const dateForLabel =
        handleNumber === 0
          ? new Date(ts)
          : fullYearsMode
            ? endOfYear(new Date(ts))
            : endOfMonth(new Date(ts));
      const text = safeFormat(dateForLabel.getTime(), 'd MMM yyyy');
      if (!text) return;
      setCursorLabel((prev) => {
        if (prev?.which === which && prev?.text === text) return prev;
        return { which, text };
      });
    });

    sliderInstance.on('end', () => {
      setCursorLabel(null);
    });

    sliderInstance.on('change', (values) => {
      const i0 = Number(values[0]);
      const i1 = Number(values[1]);
      const t0 = tickTimestamps[i0] ?? tickTimestamps[0];
      const t1 = tickTimestamps[i1] ?? tickTimestamps[maxIdx];
      const start = new Date(t0);
      const end = fullYearsMode ? endOfYear(new Date(t1)) : endOfMonth(new Date(t1));
      onChangeRef.current(start, end);
    });
    setSlider(sliderInstance);

    return () => {
      if (sliderRef.current && (sliderRef.current as unknown as { noUiSlider?: API }).noUiSlider) {
        try {
          (sliderRef.current as unknown as { noUiSlider: API }).noUiSlider.destroy();
        } catch {
          // déjà détruit
        }
      }
      setSlider(null);
    };
  }, [tickTimestamps, fullYearsMode]);

  useEffect(() => {
    if (
      !slider ||
      tickTimestamps.length === 0 ||
      controlledStartTs === undefined ||
      controlledEndTs === undefined
    ) {
      return;
    }
    const startIdx = dateToTickIndex(new Date(controlledStartTs));
    const endIdx = dateToTickIndex(new Date(controlledEndTs));
    const maxIdx = tickTimestamps.length - 1;
    const safeStart = Math.min(Math.max(0, startIdx), maxIdx);
    const safeEnd = Math.min(Math.max(safeStart, endIdx), maxIdx);
    const raw = slider.get() as (number | string)[];
    const cur0 = Number(raw[0]);
    const cur1 = Number(raw[1]);
    if (cur0 !== safeStart || cur1 !== safeEnd) {
      slider.set([safeStart, safeEnd], false);
    }
  }, [slider, tickTimestamps, fullYearsMode, controlledStartTs, controlledEndTs]);

  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md w-full overflow-hidden">
      <div className="px-2">
        {(onFullYearsModeChange != null || syncLabel != null) && (
          <div
            className={`mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 ${
              syncLabel != null && onFullYearsModeChange == null ? 'justify-end' : 'justify-between'
            }`}
          >
            {onFullYearsModeChange != null && (
              <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={fullYearsMode}
                    onChange={(e) => onFullYearsModeChange(e.target.checked)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                  />
                  <span className="min-w-0">{fullYearsLabel}</span>
                </label>
                {fullYearsMode && (
                  <div
                    className="flex shrink-0 items-center gap-0.5"
                    role="group"
                    aria-label="Décaler la plage d’une année"
                  >
                    <button
                      type="button"
                      onClick={() => shiftFullYearRange(-1)}
                      disabled={!canShiftFullYearBack}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 bg-gray-50 text-base font-semibold leading-none text-gray-700 shadow-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                      aria-label="Année précédente"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftFullYearRange(1)}
                      disabled={!canShiftFullYearForward}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-300 bg-gray-50 text-base font-semibold leading-none text-gray-700 shadow-sm hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                      aria-label="Année suivante"
                    >
                      +
                    </button>
                  </div>
                )}
              </div>
            )}
            {syncLabel != null && (
              <label className="flex min-w-0 max-w-full items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none shrink-0">
                <input
                  type="checkbox"
                  checked={syncChecked}
                  onChange={(e) => onSyncChange?.(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                />
                <span className="min-w-0">{syncLabel}</span>
              </label>
            )}
          </div>
        )}
        <div
          ref={sliderRef}
          className="slider-container w-full"
          style={{ height: '12px', marginTop: '10px', marginBottom: '8px' }}
        />
        <div className="flex justify-between items-center mt-1 min-h-[1.5rem]">
          <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">
            {cursorLabel?.which === 'start'
              ? cursorLabel.text
              : safeFormat((controlledStartDate ?? minDate).getTime(), 'd MMM yyyy')}
          </span>
          <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">
            {cursorLabel?.which === 'end'
              ? cursorLabel.text
              : controlledEndDate
                ? safeFormat(controlledEndDate.getTime(), 'd MMM yyyy')
                : safeFormat(maxDate.getTime(), 'd MMM yyyy')}
          </span>
        </div>
      </div>
    </div>
  );
};

export default DateRangeSlider;
