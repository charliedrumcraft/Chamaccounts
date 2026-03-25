"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    readFile: (filePath) => electron_1.ipcRenderer.invoke('read-file', filePath),
    writeFile: (filePath, content) => electron_1.ipcRenderer.invoke('write-file', filePath, content),
    readDirectory: (dirPath) => electron_1.ipcRenderer.invoke('read-directory', dirPath),
    deleteFile: (filePath) => electron_1.ipcRenderer.invoke('delete-file', filePath),
    moveFile: (sourcePath, destPath) => electron_1.ipcRenderer.invoke('move-file', sourcePath, destPath),
    getAppPath: () => electron_1.ipcRenderer.invoke('get-app-path'),
    selectFolder: () => electron_1.ipcRenderer.invoke('select-folder'),
    selectFile: (options) => electron_1.ipcRenderer.invoke('select-file', options),
    importTransactionFiles: () => electron_1.ipcRenderer.invoke('import-transaction-files'),
    mergeImportTransactions: () => electron_1.ipcRenderer.invoke('merge-import-transactions'),
    getLastImportReportPath: () => electron_1.ipcRenderer.invoke('get-last-import-report-path'),
    openImportReport: () => electron_1.ipcRenderer.invoke('open-import-report'),
    openAnomalyReport: () => electron_1.ipcRenderer.invoke('open-anomaly-report'),
    openMonthlyAnomalyReport: () => electron_1.ipcRenderer.invoke('open-monthly-anomaly-report'),
    openImportFolder: () => electron_1.ipcRenderer.invoke('open-import-folder'),
    archiveImportFolder: () => electron_1.ipcRenderer.invoke('archive-import-folder'),
    downloadImportReport: () => electron_1.ipcRenderer.invoke('download-import-report'),
    saveFile: (options) => electron_1.ipcRenderer.invoke('save-file', options),
    readExternalFile: (filePath) => electron_1.ipcRenderer.invoke('read-external-file', filePath),
    writeExternalFile: (filePath, content) => electron_1.ipcRenderer.invoke('write-external-file', filePath, content),
    writeBinaryFile: (filePath, base64Content) => electron_1.ipcRenderer.invoke('write-binary-file', filePath, base64Content),
    openPath: (filePath) => electron_1.ipcRenderer.invoke('open-path', filePath),
    convertXlsxToCsv: (filePath) => electron_1.ipcRenderer.invoke('convert-xlsx-to-csv', filePath),
});
