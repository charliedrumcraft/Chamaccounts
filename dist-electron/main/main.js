"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const fs = __importStar(require("fs/promises"));
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const mergeImportTransactions_1 = require("./mergeImportTransactions");
const dataPaths_1 = require("../shared/dataPaths");
let mainWindow = null;
const createWindow = () => {
    let preloadPath;
    if (electron_1.app.isPackaged) {
        const appPath = electron_1.app.getAppPath();
        preloadPath = path.join(appPath, 'dist-electron', 'preload.js');
        if (!(0, fs_1.existsSync)(preloadPath)) {
            const altPath = path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'preload.js');
            if ((0, fs_1.existsSync)(altPath))
                preloadPath = altPath;
        }
    }
    else {
        preloadPath = path.join(__dirname, 'preload.js');
    }
    mainWindow = new electron_1.BrowserWindow({
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
    }
    else {
        if (electron_1.app.isPackaged) {
            const appPath = electron_1.app.getAppPath();
            mainWindow.loadFile(path.join(appPath, 'dist', 'index.html')).catch(console.error);
        }
        else {
            const htmlPath = path.join(__dirname, '../dist/index.html');
            if (mainWindow)
                mainWindow.loadFile(htmlPath);
        }
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
};
const getAppPath = () => {
    if (electron_1.app.isPackaged && process.platform === 'linux') {
        return electron_1.app.getPath('userData');
    }
    if (electron_1.app.isPackaged) {
        const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked');
        if ((0, fs_1.existsSync)(unpackedPath))
            return unpackedPath;
        return process.resourcesPath;
    }
    return electron_1.app.getAppPath();
};
function registerIpcHandlers() {
    if (!electron_1.ipcMain)
        return;
    electron_1.ipcMain.handle('read-file', async (_, filePath) => {
        try {
            const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
            if (!(0, fs_1.existsSync)(fullPath)) {
                return { success: false, error: `Fichier non trouvé: ${fullPath}` };
            }
            const content = await fs.readFile(fullPath, 'utf-8');
            return { success: true, data: content };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('write-file', async (_, filePath, content) => {
        try {
            const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
            const dirPath = path.dirname(fullPath);
            if (!(0, fs_1.existsSync)(dirPath)) {
                await fs.mkdir(dirPath, { recursive: true });
            }
            await fs.writeFile(fullPath, content, 'utf-8');
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('read-directory', async (_, dirPath) => {
        try {
            const fullPath = path.isAbsolute(dirPath) ? dirPath : path.join(getAppPath(), dirPath);
            if (!(0, fs_1.existsSync)(fullPath)) {
                return { success: false, error: `Dossier non trouvé: ${fullPath}` };
            }
            const files = await fs.readdir(fullPath);
            return { success: true, data: files };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('delete-file', async (_, filePath) => {
        try {
            const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
            if (!(0, fs_1.existsSync)(fullPath)) {
                return { success: false, error: `Fichier non trouvé: ${fullPath}` };
            }
            await fs.unlink(fullPath);
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('move-file', async (_, sourcePath, destPath) => {
        try {
            const fullSource = path.isAbsolute(sourcePath) ? sourcePath : path.join(getAppPath(), sourcePath);
            const fullDest = path.isAbsolute(destPath) ? destPath : path.join(getAppPath(), destPath);
            if (!(0, fs_1.existsSync)(fullSource)) {
                return { success: false, error: `Fichier non trouvé: ${fullSource}` };
            }
            const destDir = path.dirname(fullDest);
            if (!(0, fs_1.existsSync)(destDir)) {
                await fs.mkdir(destDir, { recursive: true });
            }
            try {
                await fs.rename(fullSource, fullDest);
            }
            catch {
                await fs.copyFile(fullSource, fullDest);
                await fs.unlink(fullSource);
            }
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('get-app-path', async () => getAppPath());
    electron_1.ipcMain.handle('select-folder', async () => {
        try {
            if (!mainWindow)
                return { success: false, error: 'Fenêtre non disponible' };
            const result = await electron_1.dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: 'Sélectionner un dossier' });
            if (result.canceled)
                return { success: false, canceled: true };
            return { success: true, path: result.filePaths[0] };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('select-file', async (_, options) => {
        try {
            if (!mainWindow)
                return { success: false, error: 'Fenêtre non disponible' };
            const opts = { properties: ['openFile'], title: 'Sélectionner un fichier' };
            if (options?.filters)
                opts.filters = options.filters;
            const result = await electron_1.dialog.showOpenDialog(mainWindow, opts);
            if (result.canceled)
                return { success: false, canceled: true };
            return { success: true, path: result.filePaths[0] };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('import-transaction-files', async () => {
        try {
            if (!mainWindow)
                return { success: false, error: 'Fenêtre non disponible' };
            const result = await electron_1.dialog.showOpenDialog(mainWindow, {
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
            const destDir = path.join(getAppPath(), dataPaths_1.TRANSACTIONS_IMPORT_DIR);
            if (!(0, fs_1.existsSync)(destDir)) {
                await fs.mkdir(destDir, { recursive: true });
            }
            const imported = [];
            for (const srcPath of result.filePaths) {
                const ext = path.extname(srcPath).toLowerCase();
                if (ext !== '.xlsx' && ext !== '.csv')
                    continue;
                const base = path.basename(srcPath);
                const destPath = path.join(destDir, base);
                await fs.copyFile(srcPath, destPath);
                imported.push(base);
            }
            return { success: true, imported };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('open-import-folder', async () => {
        try {
            const fullPath = path.join(getAppPath(), dataPaths_1.TRANSACTIONS_IMPORT_DIR);
            if (!(0, fs_1.existsSync)(fullPath)) {
                await fs.mkdir(fullPath, { recursive: true });
            }
            await electron_1.shell.openPath(fullPath);
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('archive-import-folder', async () => {
        try {
            const appPath = getAppPath();
            const importDir = path.join(appPath, dataPaths_1.TRANSACTIONS_IMPORT_DIR);
            const oldDir = path.join(appPath, dataPaths_1.TRANSACTIONS_OLD_DIR);
            if (!(0, fs_1.existsSync)(importDir)) {
                return { success: true, movedCount: 0, message: 'Aucun dossier Import.' };
            }
            const entries = await fs.readdir(importDir, { withFileTypes: true });
            const files = entries.filter((e) => e.isFile()).map((e) => e.name);
            if (files.length === 0) {
                return { success: true, movedCount: 0, message: 'Aucun fichier à archiver.' };
            }
            if (!(0, fs_1.existsSync)(oldDir)) {
                await fs.mkdir(oldDir, { recursive: true });
            }
            let movedCount = 0;
            for (const name of files) {
                const src = path.join(importDir, name);
                const dest = path.join(oldDir, name);
                try {
                    await fs.rename(src, dest);
                    movedCount++;
                }
                catch {
                    await fs.copyFile(src, dest);
                    await fs.unlink(src);
                    movedCount++;
                }
            }
            return { success: true, movedCount, message: `${movedCount} fichier(s) déplacé(s) vers Old.` };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message, movedCount: 0 };
        }
    });
    electron_1.ipcMain.handle('merge-import-transactions', async () => {
        try {
            const appPath = getAppPath();
            const result = await (0, mergeImportTransactions_1.mergeImportTransactions)(appPath);
            return result;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message, mergedCount: 0, anomalyCount: 0 };
        }
    });
    electron_1.ipcMain.handle('get-last-import-report-path', async () => {
        try {
            const appPath = getAppPath();
            const relativePath = await (0, mergeImportTransactions_1.getLastImportReportPath)(appPath);
            return { success: true, path: relativePath };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('open-import-report', async () => {
        try {
            const appPath = getAppPath();
            const relativePath = await (0, mergeImportTransactions_1.getLastImportReportPath)(appPath);
            if (!relativePath) {
                return { success: false, error: 'Aucun rapport de fusion trouvé.' };
            }
            const fullPath = path.join(appPath, relativePath);
            if (!(0, fs_1.existsSync)(fullPath)) {
                return { success: false, error: 'Fichier rapport introuvable.' };
            }
            // Ouvrir avec l'éditeur de texte par défaut selon l'OS
            const platform = process.platform;
            if (platform === 'darwin') {
                (0, child_process_1.spawn)('open', ['-a', 'TextEdit', fullPath], { detached: true });
            }
            else if (platform === 'win32') {
                (0, child_process_1.spawn)('notepad', [fullPath], { detached: true, shell: true });
            }
            else {
                (0, child_process_1.spawn)('xdg-open', [fullPath], { detached: true });
            }
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('open-anomaly-report', async () => {
        try {
            const appPath = getAppPath();
            const fullPath = path.join(appPath, dataPaths_1.ANOMALY_REPORT_PATH);
            if (!(0, fs_1.existsSync)(fullPath)) {
                return { success: false, error: 'Aucun rapport d\'anomalies trouvé.' };
            }
            const platform = process.platform;
            if (platform === 'darwin') {
                (0, child_process_1.spawn)('open', ['-a', 'TextEdit', fullPath], { detached: true });
            }
            else if (platform === 'win32') {
                (0, child_process_1.spawn)('notepad', [fullPath], { detached: true, shell: true });
            }
            else {
                (0, child_process_1.spawn)('xdg-open', [fullPath], { detached: true });
            }
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('open-monthly-anomaly-report', async () => {
        try {
            const appPath = getAppPath();
            const fullPath = path.join(appPath, dataPaths_1.MONTHLY_ANOMALY_REPORT_PATH);
            if (!(0, fs_1.existsSync)(fullPath)) {
                return { success: false, error: 'Aucun rapport d\'anomalies mensuel trouvé.' };
            }
            const platform = process.platform;
            if (platform === 'darwin') {
                (0, child_process_1.spawn)('open', ['-a', 'TextEdit', fullPath], { detached: true });
            }
            else if (platform === 'win32') {
                (0, child_process_1.spawn)('notepad', [fullPath], { detached: true, shell: true });
            }
            else {
                (0, child_process_1.spawn)('xdg-open', [fullPath], { detached: true });
            }
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('download-import-report', async () => {
        try {
            const appPath = getAppPath();
            const relativePath = await (0, mergeImportTransactions_1.getLastImportReportPath)(appPath);
            if (!relativePath) {
                return { success: false, error: 'Aucun rapport d\'importation trouvé.' };
            }
            const fullPath = path.join(appPath, relativePath);
            if (!(0, fs_1.existsSync)(fullPath)) {
                return { success: false, error: 'Fichier rapport introuvable.' };
            }
            if (!mainWindow)
                return { success: false, error: 'Fenêtre non disponible' };
            const defaultName = path.basename(fullPath);
            const result = await electron_1.dialog.showSaveDialog(mainWindow, {
                title: 'Télécharger le rapport d\'importation',
                defaultPath: defaultName,
                filters: [{ name: 'Fichiers texte', extensions: ['txt'] }],
            });
            if (result.canceled || !result.filePath)
                return { success: false, canceled: true };
            const content = await fs.readFile(fullPath, 'utf-8');
            await fs.writeFile(result.filePath, content, 'utf-8');
            return { success: true, path: result.filePath };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('save-file', async (_, options) => {
        try {
            if (!mainWindow)
                return { success: false, error: 'Fenêtre non disponible' };
            const opts = { title: 'Sauvegarder' };
            if (options?.defaultPath)
                opts.defaultPath = options.defaultPath;
            if (options?.filters)
                opts.filters = options.filters;
            const result = await electron_1.dialog.showSaveDialog(mainWindow, opts);
            if (result.canceled)
                return { success: false, canceled: true };
            return { success: true, path: result.filePath };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('read-external-file', async (_, filePath) => {
        try {
            if (!(0, fs_1.existsSync)(filePath))
                return { success: false, error: `Fichier non trouvé: ${filePath}` };
            const content = await fs.readFile(filePath, 'utf-8');
            return { success: true, data: content };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('write-external-file', async (_, filePath, content) => {
        try {
            const dirPath = path.dirname(filePath);
            if (!(0, fs_1.existsSync)(dirPath))
                await fs.mkdir(dirPath, { recursive: true });
            await fs.writeFile(filePath, content, 'utf-8');
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('open-path', async (_, filePath) => {
        try {
            const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
            if (!(0, fs_1.existsSync)(fullPath))
                return { success: false, error: `Fichier non trouvé: ${fullPath}` };
            await electron_1.shell.openPath(fullPath);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
    });
    electron_1.ipcMain.handle('write-binary-file', async (_, filePath, base64Content) => {
        try {
            const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
            const dirPath = path.dirname(fullPath);
            if (!(0, fs_1.existsSync)(dirPath))
                await fs.mkdir(dirPath, { recursive: true });
            const buffer = Buffer.from(base64Content, 'base64');
            await fs.writeFile(fullPath, buffer);
            return { success: true };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
    electron_1.ipcMain.handle('convert-xlsx-to-csv', async (_, filePath) => {
        try {
            const fullPath = path.isAbsolute(filePath) ? filePath : path.join(getAppPath(), filePath);
            if (!(0, fs_1.existsSync)(fullPath)) {
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
            const oldDir = path.join(getAppPath(), dataPaths_1.TRANSACTIONS_OLD_DIR);
            if (!(0, fs_1.existsSync)(oldDir)) {
                await fs.mkdir(oldDir, { recursive: true });
            }
            const oldXlsxPath = path.join(oldDir, path.basename(fullPath));
            try {
                await fs.rename(fullPath, oldXlsxPath);
            }
            catch {
                await fs.copyFile(fullPath, oldXlsxPath);
                await fs.unlink(fullPath);
            }
            return { success: true, csvName };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, error: message };
        }
    });
}
// Ne lancer l'app que dans le processus Electron (pas quand Node exécute le script via le plugin Vite)
if (process.versions.electron) {
    electron_1.app.whenReady().then(() => {
        registerIpcHandlers();
        createWindow();
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0)
                createWindow();
        });
    });
    electron_1.app.on('window-all-closed', () => {
        if (process.platform !== 'darwin')
            electron_1.app.quit();
    });
}
