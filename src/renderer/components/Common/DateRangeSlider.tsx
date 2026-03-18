import React, { useEffect, useMemo, useRef, useState } from 'react';
import noUiSlider from 'nouislider';
import type { API } from 'nouislider';
import 'nouislider/dist/nouislider.css';
import { format, isValid, startOfMonth, endOfMonth, addMonths, isBefore } from 'date-fns';
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

/** Index du mois contenant date (ou 0 / length-1 si en dehors). */
function dateToMonthIndex(date: Date, monthlyTimestamps: number[]): number {
  if (monthlyTimestamps.length === 0) return 0;
  const ts = startOfMonth(date).getTime();
  const idx = monthlyTimestamps.findIndex((t) => t > ts);
  if (idx === -1) return monthlyTimestamps.length - 1;
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
}) => {
  const sliderRef = useRef<HTMLDivElement>(null);
  const [slider, setSlider] = useState<API | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [cursorLabel, setCursorLabel] = useState<{ which: 'start' | 'end'; text: string } | null>(null);

  const monthlyTimestamps = useMemo(
    () => getMonthlyTimestamps(minDate, maxDate),
    [minDate, maxDate]
  );

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
    if (!sliderRef.current || monthlyTimestamps.length === 0) return;
    if ((sliderRef.current as unknown as { noUiSlider?: API }).noUiSlider) {
      setSlider((sliderRef.current as unknown as { noUiSlider: API }).noUiSlider);
      return;
    }
    const maxIdx = monthlyTimestamps.length - 1;
    const startIdx = Math.min(
      dateToMonthIndex(controlledStartDate ?? minDate, monthlyTimestamps),
      maxIdx
    );
    const endIdx = Math.min(
      Math.max(startIdx, dateToMonthIndex(controlledEndDate ?? maxDate, monthlyTimestamps)),
      maxIdx
    );

    const sliderInstance = noUiSlider.create(sliderRef.current, {
      start: [startIdx, endIdx],
      connect: true,
      range: { min: 0, max: maxIdx },
      step: 1,
      tooltips: false,
    });

    sliderInstance.on('start', (_values: (number | string)[], handleNumber: number) => {
      const values = sliderInstance.get() as (number | string)[];
      const idx = Number(values[handleNumber]);
      const ts = monthlyTimestamps[idx] ?? monthlyTimestamps[0];
      const which = handleNumber === 0 ? 'start' as const : 'end' as const;
      const dateForLabel = handleNumber === 0 ? new Date(ts) : endOfMonth(new Date(ts));
      const text = safeFormat(dateForLabel.getTime(), 'd MMM yyyy');
      if (text) setCursorLabel({ which, text });
    });

    sliderInstance.on('update', (_values: (number | string)[], handleNumber: number) => {
      const values = sliderInstance.get() as (number | string)[];
      const idx = Number(values[handleNumber]);
      const ts = monthlyTimestamps[idx] ?? monthlyTimestamps[0];
      const which = handleNumber === 0 ? 'start' as const : 'end' as const;
      const dateForLabel = handleNumber === 0 ? new Date(ts) : endOfMonth(new Date(ts));
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
      const start = new Date(monthlyTimestamps[i0] ?? monthlyTimestamps[0]);
      const end = endOfMonth(new Date(monthlyTimestamps[i1] ?? monthlyTimestamps[maxIdx]));
      onChange(start, end);
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
  }, [monthlyTimestamps]);

  useEffect(() => {
    if (!slider || monthlyTimestamps.length === 0 || !controlledStartDate || !controlledEndDate) return;
    const startIdx = dateToMonthIndex(controlledStartDate, monthlyTimestamps);
    const endIdx = dateToMonthIndex(controlledEndDate, monthlyTimestamps);
    const maxIdx = monthlyTimestamps.length - 1;
    const safeStart = Math.min(Math.max(0, startIdx), maxIdx);
    const safeEnd = Math.min(Math.max(safeStart, endIdx), maxIdx);
    const current = slider.get() as number[];
    if (current[0] !== safeStart || current[1] !== safeEnd) {
      slider.set([safeStart, safeEnd], false);
    }
  }, [slider, monthlyTimestamps, controlledStartDate, controlledEndDate]);

  return (
    <div className="p-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-md w-full overflow-hidden">
      <div className="px-2">
        {syncLabel != null && (
          <div className="flex items-center justify-end mb-2">
            <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={syncChecked}
                onChange={(e) => onSyncChange?.(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span>{syncLabel}</span>
            </label>
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
