import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('write-file', filePath, content),
  readDirectory: (dirPath: string) => ipcRenderer.invoke('read-directory', dirPath),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  moveFile: (sourcePath: string, destPath: string) =>
    ipcRenderer.invoke('move-file', sourcePath, destPath),
  getAppPath: () => ipcRenderer.invoke('get-app-path'),
  getDataRoot: () => ipcRenderer.invoke('get-data-root'),
  getDataSetupStatus: () => ipcRenderer.invoke('get-data-setup-status'),
  registerDataProfile: (payload: {
    name: string;
    dataRoot: string;
    initialize?: boolean;
    setActive?: boolean;
  }) => ipcRenderer.invoke('register-data-profile', payload),
  setActiveProfile: (profileId: string) => ipcRenderer.invoke('set-active-profile', profileId),
  reloadWindowForActiveProfile: () => ipcRenderer.invoke('reload-window-for-active-profile'),
  notifyAppStateFlushComplete: () => ipcRenderer.invoke('app-state-flush-complete'),
  onFlushAppStateBeforeQuit: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('flush-app-state-before-quit', listener);
    return () => ipcRenderer.removeListener('flush-app-state-before-quit', listener);
  },
  renameDataProfile: (payload: { profileId: string; name: string }) =>
    ipcRenderer.invoke('rename-data-profile', payload),
  removeDataProfile: (profileId: string) => ipcRenderer.invoke('remove-data-profile', profileId),
  initializeDataFolder: (dataRoot: string) => ipcRenderer.invoke('initialize-data-folder', dataRoot),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFile: (options?: { filters?: { name: string; extensions: string[] }[]; allowMultiple?: boolean }) =>
    ipcRenderer.invoke('select-file', options),
  importTransactionFiles: () =>
    ipcRenderer.invoke('import-transaction-files'),
  mergeImportTransactions: () =>
    ipcRenderer.invoke('merge-import-transactions'),
  appendForcedTransactionRows: (
    rows: Array<{
      DATE: string;
      TITLE: string;
      AMOUNT: string;
      CURRENCY: string;
      ACCOUNT: string;
      'AMOUNT GBP': string;
      TYPE: string;
    }>
  ) => ipcRenderer.invoke('append-forced-transaction-rows', rows),
  transactionsGetAll: () => ipcRenderer.invoke('transactions-get-all'),
  transactionsReplaceAll: (rows: Record<string, string>[]) =>
    ipcRenderer.invoke('transactions-replace-all', rows),
  transactionsGetMonthKeys: () => ipcRenderer.invoke('transactions-get-month-keys'),
  transactionsAggregateRange: (payload: { startMs: number; endMs: number }) =>
    ipcRenderer.invoke('transactions-aggregate-range', payload),
  transactionsAggregateYearly: () => ipcRenderer.invoke('transactions-aggregate-yearly'),
  transactionsGetByMonth: (monthKey: string) =>
    ipcRenderer.invoke('transactions-get-by-month', monthKey),
  transactionsGetMonthlyTotals: () => ipcRenderer.invoke('transactions-get-monthly-totals'),
  transactionsQueryTableRows: (query: {
    startMs: number;
    endMs: number;
    showEntrées?: boolean;
    showSorties?: boolean;
    titleContains?: string[];
    typeContains?: string[];
    accountContains?: string[];
  }) => ipcRenderer.invoke('transactions-query-table-rows', query),
  transactionsGetSuggestValues: () => ipcRenderer.invoke('transactions-get-suggest-values'),
  transactionsAggregateAnnualBudgetYear: (year: number) =>
    ipcRenderer.invoke('transactions-aggregate-annual-budget-year', year),
  transactionsRefreshGbpRates: (rates: { eurToGbp: number; chfToGbp: number }) =>
    ipcRenderer.invoke('transactions-refresh-gbp-rates', rates),
  transactionsRefreshPrimaryRates: (rates: {
    primary: string;
    ratesToPrimary: Record<string, number>;
  }) => ipcRenderer.invoke('transactions-refresh-primary-rates', rates),
  workingCurrenciesGet: () => ipcRenderer.invoke('working-currencies-get'),
  workingCurrenciesSave: (payload: {
    primary: string;
    secondaries?: Array<string | '' | null | undefined>;
  }) => ipcRenderer.invoke('working-currencies-save', payload),
  workingCurrenciesUsedInData: () => ipcRenderer.invoke('working-currencies-used-in-data'),
  transactionsMergeMonthEdit: (payload: {
    monthKey: string;
    rows: Record<string, string>[];
  }) => ipcRenderer.invoke('transactions-merge-month-edit', payload),
  transactionsGetRowSignatures: (payload?: {
    accountEntries?: Array<{ name: string; aliases?: string[] }>;
  }) => ipcRenderer.invoke('transactions-get-row-signatures', payload),
  transactionsGetAnomalyExceptions: () =>
    ipcRenderer.invoke('transactions-get-anomaly-exceptions'),
  transactionsClearAnomalyException: (idx: number) =>
    ipcRenderer.invoke('transactions-clear-anomaly-exception', idx),
  transactionsDetectAnomalies: (payload: {
    recognisedAccountLabels: string[];
    recognisedEntryTypes: string[];
    recognisedOutputTypes: string[];
    writeReport?: boolean;
  }) => ipcRenderer.invoke('transactions-detect-anomalies', payload),
  supportGetAll: () => ipcRenderer.invoke('support-get-all'),
  supportReplaceAll: (rows: Record<string, string>[]) =>
    ipcRenderer.invoke('support-replace-all', rows),
  accountBalanceGetAll: () => ipcRenderer.invoke('account-balance-get-all'),
  accountBalanceGetMonthlyChart: () => ipcRenderer.invoke('account-balance-get-monthly-chart'),
  accountBalanceNearestRow: (targetMs: number) =>
    ipcRenderer.invoke('account-balance-nearest-row', targetMs),
  accountBalanceGetMirrorHeaders: () => ipcRenderer.invoke('account-balance-get-mirror-headers'),
  accountBalanceDetectAnomalies: (payload: {
    activeAccounts: Array<{ name: string; currency: 'EUR' | 'GBP' | 'CHF' }>;
    writeReport?: boolean;
  }) => ipcRenderer.invoke('account-balance-detect-anomalies', payload),
  accountBalanceReplaceAll: (payload: {
    rows: Array<{ dateMs: number; balances: Record<string, number> }>;
    accounts: Array<{ name: string; currency: 'EUR' | 'GBP' | 'CHF' }>;
  }) => ipcRenderer.invoke('account-balance-replace-all', payload),
  accountBalanceRewriteColumns: (
    accounts: Array<{ name: string; currency: 'EUR' | 'GBP' | 'CHF' }>
  ) => ipcRenderer.invoke('account-balance-rewrite-columns', accounts),
  getLastImportReportPath: () =>
    ipcRenderer.invoke('get-last-import-report-path'),
  openImportReport: () =>
    ipcRenderer.invoke('open-import-report'),
  openAnomalyReport: () =>
    ipcRenderer.invoke('open-anomaly-report'),
  openAccountBalanceAnomalyReport: () =>
    ipcRenderer.invoke('open-account-balance-anomaly-report'),
  openMonthlyAnomalyReport: () =>
    ipcRenderer.invoke('open-monthly-anomaly-report'),
  openImportFolder: () => ipcRenderer.invoke('open-import-folder'),
  openAccountBalanceImportFolder: () =>
    ipcRenderer.invoke('open-account-balance-import-folder'),
  trashTransactionsImportFiles: () => ipcRenderer.invoke('trash-transactions-import-files'),
  trashAccountBalanceImportFiles: () =>
    ipcRenderer.invoke('trash-account-balance-import-files'),
  downloadImportReport: () =>
    ipcRenderer.invoke('download-import-report'),
  saveFile: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('save-file', options),
  readExternalFile: (filePath: string) => ipcRenderer.invoke('read-external-file', filePath),
  writeExternalFile: (filePath: string, content: string) =>
    ipcRenderer.invoke('write-external-file', filePath, content),
  writeBinaryFile: (filePath: string, base64Content: string) =>
    ipcRenderer.invoke('write-binary-file', filePath, base64Content),
  openPath: (filePath: string) => ipcRenderer.invoke('open-path', filePath),
  convertXlsxToCsv: (filePath: string) =>
    ipcRenderer.invoke('convert-xlsx-to-csv', filePath),
  exportDataFolderZip: () => ipcRenderer.invoke('export-data-folder-zip'),
  importDataFolderZip: () => ipcRenderer.invoke('import-data-folder-zip'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  setUiLocale: (locale: 'fr' | 'en') => ipcRenderer.invoke('set-ui-locale', locale),
  getUiLocale: () => ipcRenderer.invoke('get-ui-locale'),
  checkForAppUpdate: () => ipcRenderer.invoke('check-for-app-update'),
  downloadAppUpdate: () => ipcRenderer.invoke('download-app-update'),
  openGithubReleases: () => ipcRenderer.invoke('open-github-releases'),
  onAppUpdateDownloadProgress: (callback: (percent: number) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, percent: number) => callback(percent);
    ipcRenderer.on('app-update-download-progress', listener);
    return () => ipcRenderer.removeListener('app-update-download-progress', listener);
  },
  onAppUpdateAvailable: (
    callback: (payload: {
      currentVersion: string;
      latestVersion: string;
      releaseNotes?: string;
      releaseUrl: string;
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: {
        currentVersion: string;
        latestVersion: string;
        releaseNotes?: string;
        releaseUrl: string;
      }
    ) => callback(payload);
    ipcRenderer.on('app-update-available', listener);
    return () => ipcRenderer.removeListener('app-update-available', listener);
  },
});

export interface ElectronAPI {
  readFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  readDirectory: (dirPath: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;
  deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  moveFile: (sourcePath: string, destPath: string) =>
    Promise<{ success: boolean; error?: string }>;
  getAppPath: () => Promise<string>;
  getDataRoot: () => Promise<{ success: boolean; path?: string }>;
  getDataSetupStatus: () => Promise<import('../shared/profiles').DataSetupStatus>;
  registerDataProfile: (payload: {
    name: string;
    dataRoot: string;
    initialize?: boolean;
    setActive?: boolean;
  }) => Promise<{
    success: boolean;
    profile?: import('../shared/profiles').Profile;
    error?: string;
  }>;
  setActiveProfile: (profileId: string) => Promise<{ ok: boolean; error?: string }>;
  reloadWindowForActiveProfile: () => Promise<{ success: boolean; error?: string }>;
  notifyAppStateFlushComplete: () => Promise<{ success: boolean }>;
  onFlushAppStateBeforeQuit: (callback: () => void) => () => void;
  renameDataProfile: (payload: { profileId: string; name: string }) => Promise<{ ok: boolean; error?: string }>;
  removeDataProfile: (profileId: string) => Promise<{ ok: boolean; error?: string }>;
  initializeDataFolder: (dataRoot: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  selectFolder: () => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
  selectFile: (options?: { filters?: { name: string; extensions: string[] }[]; allowMultiple?: boolean }) =>
    Promise<{ success: boolean; path?: string; paths?: string[]; canceled?: boolean; error?: string }>;
  importTransactionFiles: () =>
    Promise<{ success: boolean; canceled?: boolean; imported?: string[]; error?: string }>;
  mergeImportTransactions: () =>
    Promise<{
      success: boolean;
      error?: string;
      mergedCount: number;
      anomalyCount: number;
      totalImportDataRows: number;
      notMergedCount: number;
      reportPath?: string;
    }>;
  appendForcedTransactionRows: (
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
  transactionsGetAll: () => Promise<{
    success: boolean;
    data?: { headers: string[]; rows: Record<string, string>[] } | null;
    error?: string;
  }>;
  transactionsReplaceAll: (
    rows: Record<string, string>[]
  ) => Promise<{ success: boolean; error?: string; count: number }>;
  transactionsGetMonthKeys: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  transactionsAggregateRange: (payload: {
    startMs: number;
    endMs: number;
  }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  transactionsAggregateYearly: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  transactionsGetByMonth: (
    monthKey: string
  ) => Promise<{ success: boolean; data?: { headers: string[]; rows: Record<string, string>[] } | null; error?: string }>;
  transactionsGetMonthlyTotals: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  transactionsQueryTableRows: (query: {
    startMs: number;
    endMs: number;
    showEntrées?: boolean;
    showSorties?: boolean;
    titleContains?: string[];
    typeContains?: string[];
    accountContains?: string[];
  }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  transactionsGetSuggestValues: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  transactionsAggregateAnnualBudgetYear: (
    year: number
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  transactionsRefreshGbpRates: (rates: {
    eurToGbp: number;
    chfToGbp: number;
  }) => Promise<{ success: boolean; error?: string; rowCount: number; updatedCount: number }>;
  transactionsRefreshPrimaryRates: (rates: {
    primary: string;
    ratesToPrimary: Record<string, number>;
  }) => Promise<{ success: boolean; error?: string; rowCount: number; updatedCount: number }>;
  workingCurrenciesGet: () => Promise<{
    success: boolean;
    data?: {
      config: import('../shared/workingCurrencies').WorkingCurrenciesConfig;
      configured: boolean;
      codes: string[];
      transactionCount: number;
    } | null;
    error?: string;
  }>;
  workingCurrenciesSave: (payload: {
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
  workingCurrenciesUsedInData: () => Promise<{
    success: boolean;
    data?: string[];
    error?: string;
  }>;
  transactionsMergeMonthEdit: (payload: {
    monthKey: string;
    rows: Record<string, string>[];
  }) => Promise<{ success: boolean; error?: string; count: number }>;
  transactionsGetRowSignatures: (payload?: {
    accountEntries?: Array<{ name: string; aliases?: string[] }>;
  }) => Promise<{ success: boolean; data?: string[] | null; error?: string }>;
  transactionsGetAnomalyExceptions: () => Promise<{
    success: boolean;
    data?: { headers: string[]; rows: Record<string, string>[]; rowIndicesInSource?: number[] } | null;
    error?: string;
  }>;
  transactionsClearAnomalyException: (
    idx: number
  ) => Promise<{ success: boolean; error?: string }>;
  transactionsDetectAnomalies: (payload: {
    recognisedAccountLabels: string[];
    recognisedEntryTypes: string[];
    recognisedOutputTypes: string[];
    writeReport?: boolean;
  }) => Promise<{ success: boolean; data?: unknown; error?: string }>;  supportGetAll: () => Promise<{
    success: boolean;
    data?: { headers: string[]; rows: Record<string, string>[] } | null;
    error?: string;
  }>;
  supportReplaceAll: (
    rows: Record<string, string>[]
  ) => Promise<{ success: boolean; error?: string; count: number }>;
  accountBalanceGetAll: () => Promise<{
    success: boolean;
    data?: Array<{ dateMs: number; balances: Record<string, number> }> | null;
    error?: string;
  }>;
  accountBalanceGetMonthlyChart: () => Promise<{ success: boolean; data?: unknown; error?: string }>;
  accountBalanceNearestRow: (
    targetMs: number
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  accountBalanceGetMirrorHeaders: () => Promise<{
    success: boolean;
    data?: string[] | null;
    error?: string;
  }>;
  accountBalanceDetectAnomalies: (payload: {
    activeAccounts: Array<{ name: string; currency: 'EUR' | 'GBP' | 'CHF' }>;
    writeReport?: boolean;
  }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  accountBalanceReplaceAll: (payload: {
    rows: Array<{ dateMs: number; balances: Record<string, number> }>;
    accounts: Array<{ name: string; currency: 'EUR' | 'GBP' | 'CHF' }>;
  }) => Promise<{ success: boolean; error?: string; count: number }>;
  accountBalanceRewriteColumns: (
    accounts: Array<{ name: string; currency: 'EUR' | 'GBP' | 'CHF' }>
  ) => Promise<{ success: boolean; error?: string }>;
  getLastImportReportPath: () =>
    Promise<{ success: boolean; path?: string | null; error?: string }>;
  openImportReport: () =>
    Promise<{ success: boolean; error?: string }>;
  openAnomalyReport: () =>
    Promise<{ success: boolean; error?: string }>;
  openAccountBalanceAnomalyReport: () => Promise<{ success: boolean; error?: string }>;
  openMonthlyAnomalyReport: () =>
    Promise<{ success: boolean; error?: string }>;
  openImportFolder: () => Promise<{ success: boolean; error?: string }>;
  openAccountBalanceImportFolder: () => Promise<{ success: boolean; error?: string }>;
  trashTransactionsImportFiles: () =>
    Promise<{ success: boolean; error?: string; movedCount?: number; message?: string }>;
  trashAccountBalanceImportFiles: () =>
    Promise<{ success: boolean; error?: string; movedCount?: number; message?: string }>;
  downloadImportReport: () =>
    Promise<{ success: boolean; error?: string; canceled?: boolean; path?: string }>;
  saveFile: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
  readExternalFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  writeExternalFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  writeBinaryFile: (filePath: string, base64Content: string) => Promise<{ success: boolean; error?: string }>;
  openPath: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  convertXlsxToCsv: (filePath: string) =>
    Promise<{ success: boolean; error?: string; csvName?: string }>;
  exportDataFolderZip: () => Promise<{
    success: boolean;
    canceled?: boolean;
    path?: string;
    error?: string;
  }>;
  importDataFolderZip: () => Promise<{
    success: boolean;
    canceled?: boolean;
    error?: string;
    extractedFileCount?: number;
    appStateSnapshotFound?: boolean;
  }>;
  getAppVersion: () => Promise<string>;
  setUiLocale: (locale: 'fr' | 'en') => Promise<{ success: boolean; locale?: 'fr' | 'en'; error?: string }>;
  getUiLocale: () => Promise<{ success: boolean; locale?: 'fr' | 'en' }>;
  checkForAppUpdate: () => Promise<{
    success: boolean;
    currentVersion: string;
    status: 'dev' | 'up-to-date' | 'update-available' | 'error';
    latestVersion?: string;
    releaseNotes?: string;
    releaseUrl?: string;
    error?: string;
  }>;
  downloadAppUpdate: () => Promise<{ success: boolean; error?: string }>;
  openGithubReleases: () => Promise<{ success: boolean }>;
  onAppUpdateDownloadProgress: (callback: (percent: number) => void) => () => void;
  onAppUpdateAvailable: (
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
    electronAPI: ElectronAPI;
  }
}
