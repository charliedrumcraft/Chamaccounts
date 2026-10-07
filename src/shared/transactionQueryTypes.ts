/** Types IPC pour lectures agrégées / par mois (Phase 3). */

export interface TransactionsMonthKeysResult {
  monthKeys: string[];
  /** Timestamps 1er du mois (local), triés croissant — pour sliders Dashboard. */
  monthStartsMs: number[];
}

export interface RangeAggregateByType {
  sortiesByType: Record<string, number>;
  entréesByType: Record<string, number>;
  totalSorties: number;
  totalEntrées: number;
  types: string[];
  typesWithSorties: string[];
  typesWithEntrées: string[];
  rowCount: number;
}

export interface RangeAggregateByAccount {
  accountKey: string;
  accountLabel: string;
  entrées: number;
  sorties: number;
  balance: number;
}

export interface MovementsMonthlyChartPayload {
  months: string[];
  monthStartsMs: number[];
  sortiesByMonth: number[];
  entréesByMonth: number[];
  balanceByMonth: number[];
  sortieTypes: string[];
  entréeTypes: string[];
  sortiesByTypeByMonth: Record<string, number[]>;
  entréesByTypeByMonth: Record<string, number[]>;
}

export interface TransactionsRangeAggregate {
  byType: RangeAggregateByType;
  byAccount: RangeAggregateByAccount[];
  monthly: MovementsMonthlyChartPayload | null;
}

export interface TransactionsYearlyAggregate {
  years: number[];
  types: string[];
  totalSortiesByYear: Record<number, number>;
  totalEntréesByYear: Record<number, number>;
  sortiesByYearByType: Record<string, Record<number, number>>;
  entréesByYearByType: Record<string, Record<number, number>>;
}

export interface DashboardTableRowDto {
  rowKey: string;
  sourceRowIndex: number;
  txIndex: number;
  sortTs: number;
  dateLabel: string;
  title: string;
  typeLabel: string;
  accountKey: string;
  accountLabel: string;
  amountGbp: number;
  sens: 'entrée' | 'sortie';
}

export interface TransactionsTableRowsQuery {
  startMs: number;
  endMs: number;
  showEntrées?: boolean;
  showSorties?: boolean;
  titleContains?: string[];
  typeContains?: string[];
  accountContains?: string[];
}

export interface MonthlyTotalDto {
  monthKey: string;
  entrées: number;
  sorties: number;
  byTypeSorties: Record<string, number>;
  byTypeEntrées: Record<string, number>;
}

export interface AccountBalanceMonthlyChartDto {
  periods: string[];
  dateMsList: number[];
  accounts: string[];
  accountCodes: string[];
  balanceData: number[][];
  accountColors: Record<string, string>;
  granularity: 'month';
}

/** Agrégat Budget annuel (montants signés GBP ; type vide → « Sans type »). */
export interface TransactionsAnnualBudgetYearDto {
  yearsAvailable: number[];
  year: number;
  types: string[];
  /** Signed GBP ; length === types.length * 12 ; index = typeIndex * 12 + (month - 1). */
  byTypeAndMonthFlat: number[];
  totalIncome: number;
  totalExpenses: number;
  total: number;
}

export interface AccountBalanceNearestRowDto {
  dateMs: number;
  balances: Record<string, number>;
}

export interface AnomalyHitDto {
  rowIndex: number;
  reasons: import('./anomalyReasons').AnomalyReason[];
}

export interface DetectAnomaliesResultDto {
  anomalies: AnomalyHitDto[];
  reportCsv?: string;
}

export interface RefreshGbpRatesResult {
  success: boolean;
  error?: string;
  rowCount: number;
  updatedCount: number;
}
