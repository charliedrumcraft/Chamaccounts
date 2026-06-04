import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_COL_WIDTH = 48;

export type ResizableColumnDef = {
  key: string;
  defaultWidth: number;
  resizable?: boolean;
};

function loadWidths(storageKey: string): Record<string, number> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= MIN_COL_WIDTH) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Largeurs par défaut raisonnables pour les colonnes en mode édition. */
export function defaultEditColumnWidth(header: string): number {
  if (/^(titres?|titles?)$/i.test(header)) return 288;
  if (/^(types?)$/i.test(header)) return 120;
  if (/date/i.test(header)) return 140;
  if (/^projet$/i.test(header)) return 160;
  if (/^(amount|currency|amount\s*gbp)$/i.test(header)) return 100;
  if (/^index$/i.test(header)) return 64;
  if (/^account$/i.test(header) || /compte/i.test(header)) return 140;
  return 96;
}

export function useResizableTableColumns(
  storageKey: string,
  columns: ResizableColumnDef[],
  enabled: boolean
) {
  const [widths, setWidths] = useState<Record<string, number>>(() => loadWidths(storageKey));
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch {
      /* ignore */
    }
  }, [widths, storageKey]);

  const getWidth = useCallback(
    (key: string, fallback = 96) => {
      const def = columns.find((c) => c.key === key)?.defaultWidth;
      return widths[key] ?? def ?? fallback;
    },
    [columns, widths]
  );

  const handleResizeStart = useCallback(
    (key: string, e: React.MouseEvent, thElement: HTMLElement, defaultWidth: number) => {
      e.preventDefault();
      e.stopPropagation();
      const startWidth = widths[key] ?? thElement.offsetWidth ?? defaultWidth;
      resizingRef.current = { key, startX: e.clientX, startWidth };

      const onMove = (ev: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = ev.clientX - resizingRef.current.startX;
        const newWidth = Math.max(MIN_COL_WIDTH, resizingRef.current.startWidth + delta);
        setWidths((prev) => ({ ...prev, [key]: newWidth }));
      };

      const onUp = () => {
        resizingRef.current = null;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [widths]
  );

  const resetWidths = useCallback(() => {
    setWidths({});
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  return {
    enabled,
    getWidth,
    handleResizeStart,
    resetWidths,
    hasCustomWidths: Object.keys(widths).length > 0,
    columns,
  };
}
