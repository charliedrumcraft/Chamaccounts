import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import {
  mergeImportTransactions,
  getLastImportReportPath,
  appendForcedTransactionRows,
  type ValidRow,
} from './mergeImportTransactions';
import AdmZip from 'adm-zip';
import {
  registerAppUpdaterIpc,
  scheduleStartupUpdateCheck,
  setAppUpdaterMainWindow,
} from './appUpdater';
import {
  DATA_ROOT,
  LOCAL_STORAGE_SNAPSHOT_CSV_PATH,
  TRANSACTIONS_IMPORT_DIR,
  ANOMALY_REPORT_PATH,
  MONTHLY_ANOMALY_REPORT_PATH,
  ACCOUNT_BALANCE_IMPORT_DIR,
  ACCOUNT_BALANCE_ANOMALY_REPORT_PATH,
} from '../shared/dataPaths';

let mainWindow: BrowserWindow | null = null;

function resolveWindowIcon(): string | undefined {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'build', 'icon.png'),
        path.join(app.getAppPath(), 'build', 'icon.png'),
      ]
    : [path.join(__dirname, '../../build/icon.png')];
  return candidates.find((candidate) => existsSync(candidate));
}

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
    icon: resolveWindowIcon(),
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
    setAppUpdaterMainWindow(null);
  });

  setAppUpdaterMainWindow(mainWindow);
  scheduleStartupUpdateCheck();
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

/** Ouvre un fichier dans l’éditeur de texte par défaut (évite l’association CSV → tableur). */
function openFileInTextEditor(fullPath: string): void {
  const platform = process.platform;
  if (platform === 'darwin') {
    spawn('open', ['-a', 'TextEdit', fullPath], { detached: true });
  } else if (platform === 'win32') {
    spawn('notepad', [fullPath], { detached: true, shell: true });
  } else {
    spawn('xdg-open', [fullPath], { detached: true });
  }
}

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

ipcMain.handle(
  'select-file',
  async (_, options?: { filters?: { name: string; extensions: string[] }[]; allowMultiple?: boolean }) => {
    try {
      if (!mainWindow) return { success: false, error: 'Fenêtre non disponible' };
      const multi = options?.allowMultiple === true;
      const opts: OpenDialogOptions = {
        properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
        title: multi ? 'Sélectionner un ou plusieurs fichiers' : 'Sélectionner un fichier',
      };
      if (options?.filters) opts.filters = options.filters;
      const result = await dialog.showOpenDialog(mainWindow, opts);
      if (result.canceled) return { success: false, canceled: true };
      const paths = result.filePaths ?? [];
      return { success: true, path: paths[0], paths };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
);

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

ipcMain.handle('trash-transactions-import-files', async () => {
  try {
    const appPath = getAppPath();
    const importDir = path.join(appPath, TRANSACTIONS_IMPORT_DIR);
    if (!existsSync(importDir)) {
      return { success: true, movedCount: 0, message: 'Aucun dossier Import.' };
    }
    const entries = await fs.readdir(importDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (files.length === 0) {
      return { success: true, movedCount: 0, message: 'Aucun fichier dans le dossier Import.' };
    }
    let movedCount = 0;
    for (const name of files) {
      const src = path.join(importDir, name);
      await shell.trashItem(src);
      movedCount++;
    }
    return {
      success: true,
      movedCount,
      message:
        movedCount === 1
          ? '1 fichier déplacé vers la corbeille.'
          : `${movedCount} fichiers déplacés vers la corbeille.`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, movedCount: 0 };
  }
});

ipcMain.handle('open-account-balance-import-folder', async () => {
  try {
    const fullPath = path.join(getAppPath(), ACCOUNT_BALANCE_IMPORT_DIR);
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

ipcMain.handle('trash-account-balance-import-files', async () => {
  try {
    const appPath = getAppPath();
    const importDir = path.join(appPath, ACCOUNT_BALANCE_IMPORT_DIR);
    if (!existsSync(importDir)) {
      return { success: true, movedCount: 0, message: 'Aucun dossier Import.' };
    }
    const entries = await fs.readdir(importDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (files.length === 0) {
      return { success: true, movedCount: 0, message: 'Aucun fichier dans le dossier Import.' };
    }
    let movedCount = 0;
    for (const name of files) {
      const src = path.join(importDir, name);
      await shell.trashItem(src);
      movedCount++;
    }
    return {
      success: true,
      movedCount,
      message:
        movedCount === 1
          ? '1 fichier déplacé vers la corbeille.'
          : `${movedCount} fichiers déplacés vers la corbeille.`,
    };
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
    return {
      success: false,
      error: message,
      mergedCount: 0,
      anomalyCount: 0,
      totalImportDataRows: 0,
      notMergedCount: 0,
    };
  }
});

ipcMain.handle('append-forced-transaction-rows', async (_, rows: ValidRow[]) => {
  try {
    const appPath = getAppPath();
    return await appendForcedTransactionRows(appPath, Array.isArray(rows) ? rows : []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, appendedCount: 0 };
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
    openFileInTextEditor(fullPath);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('open-anomaly-report', async () => {
  try {
    const appPath = getAppPath();
    const fullPath = path.join(appPath, ANOMALY_REPORT_PATH);
    if (!existsSync(fullPath)) {
      return { success: false, error: 'Aucun rapport d\'anomalies trouvé.' };
    }
    openFileInTextEditor(fullPath);
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
    openFileInTextEditor(fullPath);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('open-account-balance-anomaly-report', async () => {
  try {
    const appPath = getAppPath();
    const fullPath = path.join(appPath, ACCOUNT_BALANCE_ANOMALY_REPORT_PATH);
    if (!existsSync(fullPath)) {
      return { success: false, error: 'Aucun rapport d\'anomalies (soldes) trouvé.' };
    }
    openFileInTextEditor(fullPath);
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

/** Archive tout le dossier data/ (transactions, soldes, AppState, etc.) vers un fichier .zip choisi par l’utilisateur. */
ipcMain.handle('export-data-folder-zip', async () => {
  try {
    if (!mainWindow) return { success: false, error: 'Fenêtre non disponible' };
    const dataDir = path.join(getAppPath(), DATA_ROOT);
    if (!existsSync(dataDir)) {
      await fs.mkdir(dataDir, { recursive: true });
    }
    const defaultName = `chamaccounts-data-${new Date().toISOString().slice(0, 10)}.zip`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exporter le dossier data',
      defaultPath: defaultName,
      filters: [{ name: 'Archive ZIP', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    const zip = new AdmZip();
    zip.addLocalFolder(dataDir, DATA_ROOT);
    zip.writeZip(result.filePath);
    return { success: true, path: result.filePath };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

function safeZipExtractTarget(appBase: string, entryName: string): string | null {
  const norm = entryName.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = norm.split('/').filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  if (parts[0].toLowerCase() !== 'data') return null;
  if (parts.some((p) => p === '..')) return null;
  return path.join(appBase, ...parts);
}

/** Importe une archive produite par « Exporter le projet » : uniquement les entrées sous data/. */
ipcMain.handle('import-data-folder-zip', async () => {
  try {
    if (!mainWindow) return { success: false, error: 'Fenêtre non disponible' };
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: 'Importer une archive du projet',
      filters: [{ name: 'Archives ZIP', extensions: ['zip'] }],
      properties: ['openFile'],
    });
    if (pick.canceled || !pick.filePaths?.[0]) {
      return { success: false, canceled: true };
    }
    const zipPath = pick.filePaths[0];
    const appBase = getAppPath();
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    let extractedFileCount = 0;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const dest = safeZipExtractTarget(appBase, entry.entryName);
      if (!dest) continue;
      const buf = entry.getData();
      if (buf == null) continue;
      const dir = path.dirname(dest);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(dest, buf);
      extractedFileCount++;
    }
    if (extractedFileCount === 0) {
      return {
        success: false,
        error:
          'Aucun fichier importé. Utilisez une archive créée avec « Exporter le projet (ZIP) » (racine data/).',
      };
    }
    const snapshotFull = path.join(appBase, LOCAL_STORAGE_SNAPSHOT_CSV_PATH);
    const appStateSnapshotFound = existsSync(snapshotFull);
    return { success: true, extractedFileCount, appStateSnapshotFound };
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
      await shell.trashItem(fullPath);
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
    registerAppUpdaterIpc();
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
