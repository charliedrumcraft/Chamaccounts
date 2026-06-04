import React, { useRef } from 'react';

type ResizableTableHeadCellProps = {
  columnKey: string;
  width: number;
  resizable?: boolean;
  enabled: boolean;
  onResizeStart: (key: string, e: React.MouseEvent, el: HTMLElement, defaultWidth: number) => void;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
};

export const ResizableTableHeadCell: React.FC<ResizableTableHeadCellProps> = ({
  columnKey,
  width,
  resizable = true,
  enabled,
  onResizeStart,
  onClick,
  className = '',
  children,
}) => {
  const thRef = useRef<HTMLTableCellElement>(null);

  return (
    <th
      ref={thRef}
      onClick={onClick}
      style={
        enabled
          ? {
              width,
              minWidth: width,
              maxWidth: width,
            }
          : undefined
      }
      className={`relative ${className}`}
    >
      {children}
      {enabled && resizable && (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionner la colonne"
          title="Glisser pour redimensionner la colonne"
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400/60 active:bg-blue-500/70 z-20 touch-none"
          onMouseDown={(e) => {
            if (thRef.current) {
              onResizeStart(columnKey, e, thRef.current, width);
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </th>
  );
};
