"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  readFile: (filePath) => electron.ipcRenderer.invoke("read-file", filePath),
  writeFile: (filePath, content) => electron.ipcRenderer.invoke("write-file", filePath, content),
  readDirectory: (dirPath) => electron.ipcRenderer.invoke("read-directory", dirPath),
  deleteFile: (filePath) => electron.ipcRenderer.invoke("delete-file", filePath),
  moveFile: (sourcePath, destPath) => electron.ipcRenderer.invoke("move-file", sourcePath, destPath),
  getAppPath: () => electron.ipcRenderer.invoke("get-app-path"),
  selectFolder: () => electron.ipcRenderer.invoke("select-folder"),
  selectFile: (options) => electron.ipcRenderer.invoke("select-file", options),
  importTransactionFiles: () => electron.ipcRenderer.invoke("import-transaction-files"),
  mergeImportTransactions: () => electron.ipcRenderer.invoke("merge-import-transactions"),
  getLastImportReportPath: () => electron.ipcRenderer.invoke("get-last-import-report-path"),
  openImportReport: () => electron.ipcRenderer.invoke("open-import-report"),
  openAnomalyReport: () => electron.ipcRenderer.invoke("open-anomaly-report"),
  openMonthlyAnomalyReport: () => electron.ipcRenderer.invoke("open-monthly-anomaly-report"),
  openImportFolder: () => electron.ipcRenderer.invoke("open-import-folder"),
  archiveImportFolder: () => electron.ipcRenderer.invoke("archive-import-folder"),
  downloadImportReport: () => electron.ipcRenderer.invoke("download-import-report"),
  saveFile: (options) => electron.ipcRenderer.invoke("save-file", options),
  readExternalFile: (filePath) => electron.ipcRenderer.invoke("read-external-file", filePath),
  writeExternalFile: (filePath, content) => electron.ipcRenderer.invoke("write-external-file", filePath, content),
  writeBinaryFile: (filePath, base64Content) => electron.ipcRenderer.invoke("write-binary-file", filePath, base64Content),
  openPath: (filePath) => electron.ipcRenderer.invoke("open-path", filePath),
  convertXlsxToCsv: (filePath) => electron.ipcRenderer.invoke("convert-xlsx-to-csv", filePath)
});
