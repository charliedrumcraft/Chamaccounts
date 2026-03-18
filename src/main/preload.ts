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
  selectFile: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('select-file', options),
  importTransactionFiles: () =>
    ipcRenderer.invoke('import-transaction-files'),
  mergeImportTransactions: () =>
    ipcRenderer.invoke('merge-import-transactions'),
  getLastImportReportPath: () =>
    ipcRenderer.invoke('get-last-import-report-path'),
  openImportReport: () =>
    ipcRenderer.invoke('open-import-report'),
  openAnomalyReport: () =>
    ipcRenderer.invoke('open-anomaly-report'),
  openMonthlyAnomalyReport: () =>
    ipcRenderer.invoke('open-monthly-anomaly-report'),
  openImportFolder: () => ipcRenderer.invoke('open-import-folder'),
  archiveImportFolder: () => ipcRenderer.invoke('archive-import-folder'),
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
  selectFile: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
    Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>;
  importTransactionFiles: () =>
    Promise<{ success: boolean; canceled?: boolean; imported?: string[]; error?: string }>;
  mergeImportTransactions: () =>
    Promise<{ success: boolean; error?: string; mergedCount: number; anomalyCount: number; reportPath?: string }>;
  getLastImportReportPath: () =>
    Promise<{ success: boolean; path?: string | null; error?: string }>;
  openImportReport: () =>
    Promise<{ success: boolean; error?: string }>;
  openAnomalyReport: () =>
    Promise<{ success: boolean; error?: string }>;
  openMonthlyAnomalyReport: () =>
    Promise<{ success: boolean; error?: string }>;
  openImportFolder: () => Promise<{ success: boolean; error?: string }>;
  archiveImportFolder: () =>
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
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
