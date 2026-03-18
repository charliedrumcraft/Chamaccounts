/// <reference types="vite/client" />

interface ElectronAPI {
  readFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
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
    reportPath?: string;
  }>;
  getLastImportReportPath?: () => Promise<{ success: boolean; path?: string | null; error?: string }>;
  openImportReport?: () => Promise<{ success: boolean; error?: string }>;
  openImportFolder?: () => Promise<{ success: boolean; error?: string }>;
  archiveImportFolder?: () => Promise<{ success: boolean; error?: string; movedCount?: number; message?: string }>;
  downloadImportReport?: () => Promise<{ success: boolean; error?: string; canceled?: boolean; path?: string }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
