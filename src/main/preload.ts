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
