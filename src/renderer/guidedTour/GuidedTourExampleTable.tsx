import React from 'react';

export type GuidedTourExampleTableProps = {
  fileName: string;
  caption?: string;
  headers: string[];
  rows: string[][];
};

const GuidedTourExampleTable: React.FC<GuidedTourExampleTableProps> = ({
  fileName,
  caption,
  headers,
  rows,
}) => (
  <div className="mt-2">
    <p className="text-[11px] font-medium text-gray-700">
      <code className="rounded bg-slate-100 px-1 py-0.5 text-[10px]">{fileName}</code>
      {caption ? <span className="font-normal text-gray-500"> — {caption}</span> : null}
    </p>
    <div className="mt-1.5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50/80">
      <table className="min-w-full border-collapse text-[10px] leading-tight">
        <thead>
          <tr className="bg-slate-200/90">
            {headers.map((h) => (
              <th
                key={h}
                scope="col"
                className="border-b border-slate-300 px-2 py-1.5 text-left font-bold text-slate-800 whitespace-nowrap"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
              {cells.map((cell, ci) => (
                <td
                  key={`${ri}-${ci}`}
                  className="border-b border-slate-100 px-2 py-1 text-slate-700 whitespace-nowrap tabular-nums"
                >
                  {cell || '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default GuidedTourExampleTable;
