/// <reference types="vite/client" />

import type { DataSetupStatus, Profile } from '@/shared/profiles';

interface ElectronAPI {
  readFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  readDirectory?: (dirPath: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  getAppPath: () => Promise<string>;
  getDataRoot?: () => Promise<{ success: boolean; path?: string }>;
  getDataSetupStatus?: () => Promise<DataSetupStatus>;
  registerDataProfile?: (payload: {
    name: string;
    dataRoot: string;
    initialize?: boolean;
    setActive?: boolean;
  }) => Promise<{ success: boolean; profile?: Profile; error?: string }>;
  setActiveProfile?: (profileId: string) => Promise<{ ok: boolean; error?: string }>;
  reloadWindowForActiveProfile?: () => Promise<{ success: boolean; error?: string }>;
  notifyAppStateFlushComplete?: () => Promise<{ success: boolean }>;
  onFlushAppStateBeforeQuit?: (callback: () => void) => () => void;
  renameDataProfile?: (payload: { profileId: string; name: string }) => Promise<{ ok: boolean; error?: string }>;
  removeDataProfile?: (profileId: string) => Promise<{ ok: boolean; error?: string }>;
  initializeDataFolder?: (dataRoot: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  selectFolder?: () => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
  importTransactionFiles?: () => Promise<{
    success: boolean;
    canceled?: boolean;
    imported?: string[];
    error?: string;
  }>;
  mergeImportTransactions?: () => Promise<{
    success: boolean;
    error?: string;
    mergedCount: number;
    anomalyCount: number;
    totalImportDataRows: number;
    notMergedCount: number;
    reportPath?: string;
  }>;
  appendForcedTransactionRows?: (
    rows: Array<{
      DATE: string;
      TITLE: string;
      AMOUNT: string;
      CURRENCY: string;
      ACCOUNT: string;
      'AMOUNT GBP': string;
      TYPE: string;
    }>
  ) => Promise<{ success: boolean; error?: string; appendedCount: number }>;
  transactionsGetAll?: () => Promise<{
    success: boolean;
    data?: { headers: string[]; rows: Record<string, string>[] } | null;
    error?: string;
  }>;
  transactionsReplaceAll?: (
    rows: Record<string, string>[]
  ) => Promise<{ success: boolean; error?: string; count: number }>;
  transactionsGetMonthKeys?: () => Promise<{
    success: boolean;
    data?: { monthKeys: string[]; monthStartsMs: number[] } | null;
    error?: string;
  }>;
  transactionsAggregateRange?: (payload: {
    startMs: number;
    endMs: number;
  }) => Promise<{ success: boolean; data?: import('../shared/transactionQueryTypes').TransactionsRangeAggregate | null; error?: string }>;
  transactionsAggregateYearly?: () => Promise<{
    success: boolean;
    data?: import('../shared/transactionQueryTypes').TransactionsYearlyAggregate | null;
    error?: string;
  }>;
  transactionsGetByMonth?: (
    monthKey: string
  ) => Promise<{ success: boolean; data?: { headers: string[]; rows: Record<string, string>[] } | null; error?: string }>;
  transactionsGetMonthlyTotals?: () => Promise<{
    success: boolean;
    data?: import('../shared/transactionQueryTypes').MonthlyTotalDto[] | null;
    error?: string;
  }>;
  transactionsQueryTableRows?: (
    query: import('../shared/transactionQueryTypes').TransactionsTableRowsQuery
  ) => Promise<{
    success: boolean;
    data?: import('../shared/transactionQueryTypes').DashboardTableRowDto[] | null;
    error?: string;
  }>;
  transactionsGetSuggestValues?: () => Promise<{
    success: boolean;
    data?: { titles: string[]; types: string[]; accounts: string[] } | null;
    error?: string;
  }>;
  transactionsAggregateAnnualBudgetYear?: (
    year: number
  ) => Promise<{
    success: boolean;
    data?: import('../shared/transactionQueryTypes').TransactionsAnnualBudgetYearDto | null;
    error?: string;
  }>;
  transactionsRefreshGbpRates?: (rates: {
    eurToGbp: number;
    chfToGbp: number;
  }) => Promise<{
    success: boolean;
    error?: string;
    rowCount: number;
    updatedCount: number;
  }>;
  transactionsRefreshPrimaryRates?: (rates: {
    primary: string;
    ratesToPrimary: Record<string, number>;
  }) => Promise<{
    success: boolean;
    error?: string;
    rowCount: number;
    updatedCount: number;
  }>;
  workingCurrenciesGet?: () => Promise<{
    success: boolean;
    data?: {
      config: import('../shared/workingCurrencies').WorkingCurrenciesConfig;
      configured: boolean;
      codes: string[];
      transactionCount: number;
    } | null;
    error?: string;
  }>;
  workingCurrenciesSave?: (payload: {
    primary: string;
    secondaries?: Array<string | '' | null | undefined>;
  }) => Promise<{
    success: boolean;
    data?: {
      config: import('../shared/workingCurrencies').WorkingCurrenciesConfig;
      configured: boolean;
      codes: string[];
    } | null;
    error?: string;
  }>;
  workingCurrenciesUsedInData?: () => Promise<{
    success: boolean;
    data?: string[];
    error?: string;
  }>;
  transactionsMergeMonthEdit?: (payload: {
    monthKey: string;
    rows: Record<string, string>[];
  }) => Promise<{ success: boolean; error?: string; count: number }>;
  transactionsGetRowSignatures?: (payload?: {
    accountEntries?: Array<{ name: string; aliases?: string[] }>;
  }) => Promise<{ success: boolean; data?: string[] | null; error?: string }>;
  transactionsGetAnomalyExceptions?: () => Promise<{
    success: boolean;
    data?: import('../shared/sourceDataTypes').SourceDataResult | null;
    error?: string;
  }>;
  transactionsClearAnomalyException?: (
    idx: number
  ) => Promise<{ success: boolean; error?: string }>;
  transactionsDetectAnomalies?: (payload: {
    recognisedAccountLabels: string[];
    recognisedEntryTypes: string[];
    recognisedOutputTypes: string[];
    writeReport?: boolean;
  }) => Promise<{
    success: boolean;
    data?: import('../shared/transactionQueryTypes').DetectAnomaliesResultDto | null;
    error?: string;
  }>;
  supportGetAll?: () => Promise<{
    success: boolean;
    data?: { headers: string[]; rows: Record<string, string>[] } | null;
    error?: string;
  }>;
  supportReplaceAll?: (
    rows: Record<string, string>[]
  ) => Promise<{ success: boolean; error?: string; count: number }>;
  accountBalanceGetAll?: () => Promise<{
    success: boolean;
    data?: Array<{ dateMs: number; balances: Record<string, number> }> | null;
    error?: string;
  }>;
  accountBalanceGetMonthlyChart?: () => Promise<{
    success: boolean;
    data?: import('../shared/transactionQueryTypes').AccountBalanceMonthlyChartDto | null;
    error?: string;
  }>;
  accountBalanceNearestRow?: (
    targetMs: number
  ) => Promise<{
    success: boolean;
    data?: import('../shared/transactionQueryTypes').AccountBalanceNearestRowDto | null;
    error?: string;
  }>;
  accountBalanceGetMirrorHeaders?: () => Promise<{
    success: boolean;
    data?: string[] | null;
    error?: string;
  }>;
  accountBalanceDetectAnomalies?: (payload: {
    activeAccounts: Array<{ name: string; currency: 'EUR' | 'GBP' | 'CHF' }>;
    writeReport?: boolean;
  }) => Promise<{
    success: boolean;
    data?: (import('../shared/transactionQueryTypes').DetectAnomaliesResultDto & {
      fileLevelReasons?: import('../shared/anomalyReasons').AnomalyReason[];
    }) | null;
    error?: string;
  }>;
  accountBalanceReplaceAll?: (payload: {
    rows: Array<{ dateMs: number; balances: Record<string, number> }>;
    accounts: Array<{ name: string; currency: 'EUR' | 'GBP' | 'CHF' }>;
  }) => Promise<{ success: boolean; error?: string; count: number }>;
  accountBalanceRewriteColumns?: (
    accounts: Array<{ name: string; currency: 'EUR' | 'GBP' | 'CHF' }>
  ) => Promise<{ success: boolean; error?: string }>;
  getLastImportReportPath?: () => Promise<{ success: boolean; path?: string | null; error?: string }>;
  openImportReport?: () => Promise<{ success: boolean; error?: string }>;
  openImportFolder?: () => Promise<{ success: boolean; error?: string }>;
  trashTransactionsImportFiles?: () => Promise<{ success: boolean; error?: string; movedCount?: number; message?: string }>;
  trashAccountBalanceImportFiles?: () => Promise<{ success: boolean; error?: string; movedCount?: number; message?: string }>;
  downloadImportReport?: () => Promise<{ success: boolean; error?: string; canceled?: boolean; path?: string }>;
  selectFile?: (options?: {
    filters?: { name: string; extensions: string[] }[];
    allowMultiple?: boolean;
  }) => Promise<{ success: boolean; path?: string; paths?: string[]; canceled?: boolean; error?: string }>;
  readExternalFile?: (path: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  exportDataFolderZip?: () => Promise<{
    success: boolean;
    canceled?: boolean;
    path?: string;
    error?: string;
  }>;
  importDataFolderZip?: () => Promise<{
    success: boolean;
    canceled?: boolean;
    error?: string;
    extractedFileCount?: number;
    appStateSnapshotFound?: boolean;
  }>;
  getAppVersion?: () => Promise<string>;
  setUiLocale?: (locale: 'fr' | 'en') => Promise<{ success: boolean; locale?: 'fr' | 'en'; error?: string }>;
  getUiLocale?: () => Promise<{ success: boolean; locale?: 'fr' | 'en' }>;
  checkForAppUpdate?: () => Promise<{
    success: boolean;
    currentVersion: string;
    status: 'dev' | 'up-to-date' | 'update-available' | 'error';
    latestVersion?: string;
    releaseNotes?: string;
    releaseUrl?: string;
    error?: string;
  }>;
  downloadAppUpdate?: () => Promise<{ success: boolean; error?: string }>;
  openGithubReleases?: () => Promise<{ success: boolean }>;
  onAppUpdateDownloadProgress?: (callback: (percent: number) => void) => () => void;
  onAppUpdateAvailable?: (
    callback: (payload: {
      currentVersion: string;
      latestVersion: string;
      releaseNotes?: string;
      releaseUrl: string;
    }) => void
  ) => () => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
