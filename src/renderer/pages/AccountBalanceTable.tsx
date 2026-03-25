import React, { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import Sidebar from '../components/Layout/Sidebar';
import { ACCOUNT_BALANCE_PROCESSED_DIR } from '@/shared/dataPaths';
import {
  AccountBalanceCSVService,
  ACCOUNT_CODE_TO_LABEL,
  ACCOUNT_CODE_TO_CURRENCY,
  type BalanceRow,
} from '../services/AccountBalanceCSVService';
import { formatCurrency } from '../utils/format';

const STORAGE_KEY = 'account-balance-sidebar-collapsed';

const AccountBalanceTable: React.FC = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const [rows, setRows] = useState<BalanceRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');
  const [filterColumn, setFilterColumn] = useState<string>('__all__');
  const [sortColumn, setSortColumn] = useState<string | null>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    AccountBalanceCSVService.loadAllBalanceRows()
      .then((data) => {
        if (!cancelled) {
          setRows(data ?? null);
          if (!data) {
            setError(`Fichier ${ACCOUNT_BALANCE_PROCESSED_DIR}/Account-Balance.csv absent ou vide.`);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message ?? 'Erreur lors du chargement des données.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const accountCodes = useMemo(() => {
    if (!rows?.length) return [];
    const codes = new Set<string>();
    rows.forEach((r) => Object.keys(r.balances).forEach((c) => codes.add(c)));
    return Array.from(codes).sort();
  }, [rows]);

  const headers = useMemo(() => ['date', ...accountCodes], [accountCodes]);

  const handleToggleSidebar = () => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const getCellDisplay = (row: BalanceRow, col: string): string => {
    if (col === 'date') {
      return format(row.date, 'dd.MM.yyyy');
    }
    const value = row.balances[col];
    const currency = ACCOUNT_CODE_TO_CURRENCY[col] ?? '€';
    return value !== undefined ? formatCurrency(value, currency) : '';
  };

  const getCompareValue = (col: string, row: BalanceRow): number | string => {
    if (col === 'date') return row.date.getTime();
    const v = row.balances[col];
    return v !== undefined ? v : '';
  };

  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = filterText.trim().toLowerCase();
    if (!q) return rows;
    const cols = filterColumn === '__all__' ? headers : [filterColumn];
    return rows.filter((row) =>
      cols.some((col) => {
        const display = getCellDisplay(row, col);
        return display.toLowerCase().includes(q);
      })
    );
  }, [rows, filterText, filterColumn, headers]);

  const sortedRows = useMemo(() => {
    if (!sortColumn || !headers.includes(sortColumn)) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const va = getCompareValue(sortColumn, a);
      const vb = getCompareValue(sortColumn, b);
      const na = typeof va === 'number';
      const nb = typeof vb === 'number';
      let cmp: number;
      if (na && nb) cmp = (va as number) - (vb as number);
      else if (na) cmp = -1;
      else if (nb) cmp = 1;
      else cmp = String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' });
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  }, [filteredRows, sortColumn, sortDirection, headers]);

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(col);
      setSortDirection('asc');
    }
  };

  const columnLabel = (col: string) => (col === 'date' ? 'Date' : ACCOUNT_CODE_TO_LABEL[col] ?? col);

  return (
    <div className="min-h-screen flex bg-gray-50">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={handleToggleSidebar}
      />
      <main className="flex-1 flex flex-col min-w-0 p-4">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-800">Soldes des comptes</h1>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-12 text-gray-500">
            Chargement…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3">
            {error}
          </div>
        )}

        {rows && !loading && (
          <div className="flex-1 min-h-0 flex flex-col bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
            <div className="shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-50 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <label htmlFor="ab-filter-col" className="text-gray-600 text-sm whitespace-nowrap">
                  Colonne
                </label>
                <select
                  id="ab-filter-col"
                  value={filterColumn}
                  onChange={(e) => setFilterColumn(e.target.value)}
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[120px]"
                >
                  <option value="__all__">Toutes</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {columnLabel(h)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <label htmlFor="ab-filter-text" className="text-gray-600 text-sm whitespace-nowrap sr-only">
                  Rechercher
                </label>
                <input
                  id="ab-filter-text"
                  type="text"
                  placeholder="Rechercher…"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="flex-1 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-0"
                />
                {filterText && (
                  <button
                    type="button"
                    onClick={() => setFilterText('')}
                    className="text-gray-500 hover:text-gray-700 text-sm whitespace-nowrap"
                  >
                    Effacer
                  </button>
                )}
              </div>
              <span className="text-gray-500 text-sm">
                {filteredRows.length} / {rows.length} ligne{rows.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="overflow-auto flex-1 min-h-0">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-gray-100 border-b border-gray-200 z-10">
                  <tr>
                    {headers.map((h) => (
                      <th
                        key={h}
                        onClick={() => handleSort(h)}
                        className="text-left font-semibold text-gray-700 px-3 py-2 whitespace-nowrap cursor-pointer select-none hover:bg-gray-200 transition-colors"
                      >
                        <span className="inline-flex items-center gap-1">
                          {columnLabel(h)}
                          {sortColumn === h && (
                            <span className="text-blue-600" aria-label={sortDirection === 'asc' ? 'Croissant' : 'Décroissant'}>
                              {sortDirection === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                      {headers.map((col) => (
                        <td key={col} className="px-3 py-2 text-gray-800 whitespace-nowrap">
                          {getCellDisplay(row, col)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="shrink-0 px-3 py-2 border-t border-gray-200 bg-gray-50 text-gray-500 text-xs">
              {sortedRows.length} ligne{sortedRows.length !== 1 ? 's' : ''}
              {filterText ? ` (filtré sur ${rows.length} au total)` : ''}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default AccountBalanceTable;
