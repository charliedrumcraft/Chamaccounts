import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { mergeImportTransactions, getLastImportReportPath } from './mergeImportTransactions';

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  let preloadPath: string;
  if (app.isPackaged) {
    const appPath = app.getAppPath();
    preloadPath = path.join(appPath, 'dist-electron', 'preload.js');
    if (!existsSync(preloadPath)) {
      const altPath = path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'preload.js');
      if (existsSync(altPath)) preloadPath = altPath;
    }
  } else {
    preloadPath = path.join(__dirname, 'preload.js');
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
    title: 'Chamaccounts',
    frame: true,
    autoHideMenuBar: true,
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    if (app.isPackaged) {
      const appPath = app.getAppPath();
      mainWindow.loadFile(path.join(appPath, 'dist', 'index.html')).catch(console.error);
    } else {
      const htmlPath = path.join(__dirname, '../dist/index.html');
      if (mainWindow) mainWindow.loadFile(htmlPath);
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

const getAppPath = (): string => {
  if (app.isPackaged && process.platform === 'linux') {
    return app.getPath('userData');
  }
  if (app.isPackaged) {
    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked');
    if (existsSync(unpackedPath)) return unpackedPath;
    return process.resourcesPath;
  }
  return app.getAppPath();
};

function registerIpcHandlers(): void {
  if (!ipcMain) return;
  ipcMain.handle('read-file', async (_, filePath: string) => {
    try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: `Fichier non trouvé: ${fullPath}` };
    }
    const content = await fs.readFile(fullPath, 'utf-8');
    return { success: true, data: content };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
  });

  ipcMain.handle('write-file', async (_, filePath: string, content: string) => {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
    const dirPath = path.dirname(fullPath);
    if (!existsSync(dirPath)) {
      await fs.mkdir(dirPath, { recursive: true });
    }
    await fs.writeFile(fullPath, content, 'utf-8');
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('read-directory', async (_, dirPath: string) => {
  try {
    const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(getAppPath(), dirPath);
    if (!existsSync(fullPath)) {
      return { success: false, error: `Dossier non trouvé: ${fullPath}` };
    }
    const files = await fs.readdir(fullPath);
    return { success: true, data: files };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('delete-file', async (_, filePath: string) => {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: `Fichier non trouvé: ${fullPath}` };
    }
    await fs.unlink(fullPath);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('move-file', async (_, sourcePath: string, destPath: string) => {
  try {
    const fullSource = path.isAbsolute(sourcePath) ? sourcePath : path.join(getAppPath(), sourcePath);
    const fullDest = path.isAbsolute(destPath) ? destPath : path.join(getAppPath(), destPath);
    if (!existsSync(fullSource)) {
      return { success: false, error: `Fichier non trouvé: ${fullSource}` };
    }
    const destDir = path.dirname(fullDest);
    if (!existsSync(destDir)) {
      await fs.mkdir(destDir, { recursive: true });
    }
    try {
      await fs.rename(fullSource, fullDest);
    } catch {
      await fs.copyFile(fullSource, fullDest);
      await fs.unlink(fullSource);
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('get-app-path', async () => getAppPath());

ipcMain.handle('select-folder', async () => {
  try {
    if (!mainWindow) return { success: false, error: 'Fenêtre non disponible' };
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Sélectionner un dossier' });
    if (result.canceled) return { success: false, canceled: true };
    return { success: true, path: result.filePaths[0] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('select-file', async (_, options?: { filters?: { name: string; extensions: string[] }[] }) => {
  try {
    if (!mainWindow) return { success: false, error: 'Fenêtre non disponible' };
    const opts: OpenDialogOptions = { properties: ['openFile'], title: 'Sélectionner un fichier' };
    if (options?.filters) opts.filters = options.filters;
    const result = await dialog.showOpenDialog(mainWindow, opts);
    if (result.canceled) return { success: false, canceled: true };
    return { success: true, path: result.filePaths[0] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

const TRANSACTIONS_IMPORT_DIR = 'data/TransactionsData/Import';

ipcMain.handle('import-transaction-files', async () => {
  try {
    if (!mainWindow) return { success: false, error: 'Fenêtre non disponible' };
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: 'Importer des fichiers (XLSX ou CSV)',
      filters: [
        { name: 'Fichiers transactions', extensions: ['xlsx', 'csv'] },
        { name: 'Tous les fichiers', extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths?.length) {
      return { success: true, canceled: true, imported: [] };
    }
    const destDir = path.join(getAppPath(), TRANSACTIONS_IMPORT_DIR);
    if (!existsSync(destDir)) {
      await fs.mkdir(destDir, { recursive: true });
    }
    const imported: string[] = [];
    for (const srcPath of result.filePaths) {
      const ext = path.extname(srcPath).toLowerCase();
      if (ext !== '.xlsx' && ext !== '.csv') continue;
      const base = path.basename(srcPath);
      const destPath = path.join(destDir, base);
      await fs.copyFile(srcPath, destPath);
      imported.push(base);
    }
    return { success: true, imported };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('open-import-folder', async () => {
  try {
    const fullPath = path.join(getAppPath(), TRANSACTIONS_IMPORT_DIR);
    if (!existsSync(fullPath)) {
      await fs.mkdir(fullPath, { recursive: true });
    }
    await shell.openPath(fullPath);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

const TRANSACTIONS_OLD_DIR = 'data/TransactionsData/Old';

ipcMain.handle('archive-import-folder', async () => {
  try {
    const appPath = getAppPath();
    const importDir = path.join(appPath, TRANSACTIONS_IMPORT_DIR);
    const oldDir = path.join(appPath, TRANSACTIONS_OLD_DIR);
    if (!existsSync(importDir)) {
      return { success: true, movedCount: 0, message: 'Aucun dossier Import.' };
    }
    const entries = await fs.readdir(importDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (files.length === 0) {
      return { success: true, movedCount: 0, message: 'Aucun fichier à archiver.' };
    }
    if (!existsSync(oldDir)) {
      await fs.mkdir(oldDir, { recursive: true });
    }
    let movedCount = 0;
    for (const name of files) {
      const src = path.join(importDir, name);
      const dest = path.join(oldDir, name);
      try {
        await fs.rename(src, dest);
        movedCount++;
      } catch {
        await fs.copyFile(src, dest);
        await fs.unlink(src);
        movedCount++;
      }
    }
    return { success: true, movedCount, message: `${movedCount} fichier(s) déplacé(s) vers Old.` };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, movedCount: 0 };
  }
});

ipcMain.handle('merge-import-transactions', async () => {
  try {
    const appPath = getAppPath();
    const result = await mergeImportTransactions(appPath);
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, mergedCount: 0, anomalyCount: 0 };
  }
});

ipcMain.handle('get-last-import-report-path', async () => {
  try {
    const appPath = getAppPath();
    const relativePath = await getLastImportReportPath(appPath);
    return { success: true, path: relativePath };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('open-import-report', async () => {
  try {
    const appPath = getAppPath();
    const relativePath = await getLastImportReportPath(appPath);
    if (!relativePath) {
      return { success: false, error: 'Aucun rapport de fusion trouvé.' };
    }
    const fullPath = path.join(appPath, relativePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: 'Fichier rapport introuvable.' };
    }
    // Ouvrir avec l'éditeur de texte par défaut selon l'OS
    const platform = process.platform;
    if (platform === 'darwin') {
      spawn('open', ['-a', 'TextEdit', fullPath], { detached: true });
    } else if (platform === 'win32') {
      spawn('notepad', [fullPath], { detached: true, shell: true });
    } else {
      spawn('xdg-open', [fullPath], { detached: true });
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

const ANOMALY_REPORT_PATH = 'data/TransactionsData/Processed/anomaly_report.csv';
const MONTHLY_ANOMALY_REPORT_PATH = 'data/TransactionsData/Processed/monthly_anomaly_report.csv';

ipcMain.handle('open-anomaly-report', async () => {
  try {
    const appPath = getAppPath();
    const fullPath = path.join(appPath, ANOMALY_REPORT_PATH);
    if (!existsSync(fullPath)) {
      return { success: false, error: 'Aucun rapport d\'anomalies trouvé.' };
    }
    const platform = process.platform;
    if (platform === 'darwin') {
      spawn('open', ['-a', 'TextEdit', fullPath], { detached: true });
    } else if (platform === 'win32') {
      spawn('notepad', [fullPath], { detached: true, shell: true });
    } else {
      spawn('xdg-open', [fullPath], { detached: true });
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('open-monthly-anomaly-report', async () => {
  try {
    const appPath = getAppPath();
    const fullPath = path.join(appPath, MONTHLY_ANOMALY_REPORT_PATH);
    if (!existsSync(fullPath)) {
      return { success: false, error: 'Aucun rapport d\'anomalies mensuel trouvé.' };
    }
    const platform = process.platform;
    if (platform === 'darwin') {
      spawn('open', ['-a', 'TextEdit', fullPath], { detached: true });
    } else if (platform === 'win32') {
      spawn('notepad', [fullPath], { detached: true, shell: true });
    } else {
      spawn('xdg-open', [fullPath], { detached: true });
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('download-import-report', async () => {
  try {
    const appPath = getAppPath();
    const relativePath = await getLastImportReportPath(appPath);
    if (!relativePath) {
      return { success: false, error: 'Aucun rapport d\'importation trouvé.' };
    }
    const fullPath = path.join(appPath, relativePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: 'Fichier rapport introuvable.' };
    }
    if (!mainWindow) return { success: false, error: 'Fenêtre non disponible' };
    const defaultName = path.basename(fullPath);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Télécharger le rapport d\'importation',
      defaultPath: defaultName,
      filters: [{ name: 'Fichiers texte', extensions: ['txt'] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    const content = await fs.readFile(fullPath, 'utf-8');
    await fs.writeFile(result.filePath, content, 'utf-8');
    return { success: true, path: result.filePath };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('save-file', async (_, options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
  try {
    if (!mainWindow) return { success: false, error: 'Fenêtre non disponible' };
    const opts: SaveDialogOptions = { title: 'Sauvegarder' };
    if (options?.defaultPath) opts.defaultPath = options.defaultPath;
    if (options?.filters) opts.filters = options.filters;
    const result = await dialog.showSaveDialog(mainWindow, opts);
    if (result.canceled) return { success: false, canceled: true };
    return { success: true, path: result.filePath };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('read-external-file', async (_, filePath: string) => {
  try {
    if (!existsSync(filePath)) return { success: false, error: `Fichier non trouvé: ${filePath}` };
    const content = await fs.readFile(filePath, 'utf-8');
    return { success: true, data: content };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('write-external-file', async (_, filePath: string, content: string) => {
  try {
    const dirPath = path.dirname(filePath);
    if (!existsSync(dirPath)) await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('open-path', async (_, filePath: string) => {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
    if (!existsSync(fullPath)) return { success: false, error: `Fichier non trouvé: ${fullPath}` };
    await shell.openPath(fullPath);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('write-binary-file', async (_, filePath: string, base64Content: string) => {
  try {
    const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
    const dirPath = path.dirname(fullPath);
    if (!existsSync(dirPath)) await fs.mkdir(dirPath, { recursive: true });
    const buffer = Buffer.from(base64Content, 'base64');
    await fs.writeFile(fullPath, buffer);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

  ipcMain.handle('convert-xlsx-to-csv', async (_, filePath: string) => {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
      if (!existsSync(fullPath)) {
        return { success: false, error: 'Fichier non trouvé' };
      }
      const ext = path.extname(fullPath).toLowerCase();
      if (ext !== '.xlsx') {
        return { success: false, error: 'Le fichier doit être au format .xlsx' };
      }
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(fullPath);
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return { success: false, error: 'Aucune feuille dans le classeur' };
      }
      const sheet = workbook.Sheets[firstSheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, {
        FS: ';',
        RS: '\n',
        dateNF: 'dd.mm.yyyy',
        cellDates: true,
      });
      const csvPath = fullPath.replace(/\.xlsx$/i, '.csv');
      await fs.writeFile(csvPath, csv, 'utf-8');
      const csvName = path.basename(csvPath);
      const oldDir = path.join(getAppPath(), 'data', 'TransactionsData', 'Old');
      if (!existsSync(oldDir)) {
        await fs.mkdir(oldDir, { recursive: true });
      }
      const oldXlsxPath = path.join(oldDir, path.basename(fullPath));
      try {
        await fs.rename(fullPath, oldXlsxPath);
      } catch {
        await fs.copyFile(fullPath, oldXlsxPath);
        await fs.unlink(fullPath);
      }
      return { success: true, csvName };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  });
}

// Ne lancer l'app que dans le processus Electron (pas quand Node exécute le script via le plugin Vite)
if (process.versions.electron) {
  app.whenReady().then(() => {
    registerIpcHandlers();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
