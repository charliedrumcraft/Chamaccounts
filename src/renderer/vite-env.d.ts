/// <reference types="vite/client" />

interface ElectronAPI {
  readFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  readDirectory?: (dirPath: string) => Promise<{ success: boolean; data?: string[]; error?: string }>;
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>;
  getAppPath: () => Promise<string>;
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
