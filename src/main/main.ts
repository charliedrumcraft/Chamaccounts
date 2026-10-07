import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import type { OpenDialogOptions, SaveDialogOptions } from 'electron';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import {
  mergeImportTransactions,
  getLastImportReportPath,
  appendForcedTransactionRows,
  type ValidRow,
} from './mergeImportTransactions';
import AdmZip from 'adm-zip';
import {
  getInstallPath,
  getDataRoot,
  migrateLegacyPackagedDataIfNeeded,
  writeDataFolderZip,
  ensureDataTree,
  detectLegacyDataLocations,
} from './dataDirectory';
import {
  addProfile,
  ensureConfigLoaded,
  getActiveDataRoot,
  getActiveProfileId,
  getDataSetupStatus,
  removeProfile,
  renameProfile,
  setActiveProfile,
} from './appConfig';
import { ensureDataTemplateProfile } from './dataTemplateProfile';
import { getProfileSessionPartition } from '../shared/profileSession';
import {
  registerAppUpdaterIpc,
  scheduleStartupUpdateCheck,
  setAppUpdaterMainWindow,
} from './appUpdater';
import { getUiLocale, initUiLocaleFromDisk, isAppLocale, setUiLocale, tm } from './uiI18n';
import {
  LOCAL_STORAGE_SNAPSHOT_CSV_PATH,
  TRANSACTIONS_IMPORT_DIR,
  TRANSACTIONS_DB_PATH,
  SUPPORT_DB_PATH,
  ACCOUNT_BALANCE_DB_PATH,
  ANOMALY_REPORT_PATH,
  MONTHLY_ANOMALY_REPORT_PATH,
  ACCOUNT_BALANCE_IMPORT_DIR,
  ACCOUNT_BALANCE_ANOMALY_REPORT_PATH,
} from '../shared/dataPaths';
import type { BalanceAccountColumn, BalanceRowDto } from '../shared/accountBalanceCodes';
import {
  clearAnomalyException,
  closeTransactionDb,
  ensureTransactionStore,
  getAllAsSourceData,
  getAnomalyExceptions,
  getRowSignatures,
  getTransactionCount,
  mergeMonthEdit,
  refreshGbpRates,
  refreshPrimaryRates,
  replaceAllTransactions,
  syncCsvMirror,
} from './db/transactionStore';
import {
  ensureWorkingCurrencies,
  saveWorkingCurrenciesFromInput,
} from './db/workingCurrenciesStore';
import { workingCurrencyCodes, isWorkingCurrencyConfigured } from '../shared/workingCurrencies';
import type { PrimaryMappingRates } from '../shared/transactionsImportMappingPolicy';
import type { AccountAliasEntry } from '../shared/accountAliasForDuplicates';
import {
  closeSupportDb,
  ensureSupportStore,
  getAllSupportAsSourceData,
  replaceAllSupportRows,
  syncSupportCsvMirror,
} from './db/supportStore';
import {
  closeAccountBalanceDb,
  ensureAccountBalanceStore,
  getAccountBalanceMirrorHeaders,
  getAllBalanceRows,
  getMonthlyBalanceChart,
  getNearestBalanceRow,
  replaceAllBalanceRows,
  rewriteBalanceColumns,
  syncAccountBalanceCsvMirror,
} from './db/accountBalanceStore';
import {
  aggregateAnnualBudgetYear,
  aggregateTransactionsRange,
  aggregateTransactionsYearly,
  getMonthlyTotals,
  getSuggestColumnValues,
  getTransactionMonthKeys,
  getTransactionsByMonth,
  queryDashboardTableRows,
} from './db/transactionQueryStore';
import {
  detectAccountBalanceAnomaliesMain,
  detectTransactionAnomaliesMain,
} from './db/anomalyDetectStore';
import type { TransactionsTableRowsQuery } from '../shared/transactionQueryTypes';
import type { TransactionAnomalyContext } from '../shared/anomalyDetectionCore';

async function openAllStoresForRoot(dataRoot: string): Promise<void> {
  await ensureTransactionStore(dataRoot);
  await ensureSupportStore(dataRoot);
  await ensureAccountBalanceStore(dataRoot);
  const txCount = await getTransactionCount(dataRoot);
  await ensureWorkingCurrencies(dataRoot, { transactionCount: txCount });
}

function closeAllStores(): void {
  closeTransactionDb();
  closeSupportDb();
  closeAccountBalanceDb();
}

async function deleteDbAndSidecars(dataRoot: string, relativeDbPath: string): Promise<void> {
  const dbFull = path.join(dataRoot, relativeDbPath);
  for (const suffix of ['', '-wal', '-shm']) {
    const p = `${dbFull}${suffix}`;
    if (existsSync(p)) {
      try {
        await fs.unlink(p);
      } catch {
        /* ignore */
      }
    }
  }
}

let mainWindow: BrowserWindow | null = null;
let quitAfterAppStateFlush = false;
let allowWindowCloseAfterFlush = false;
let pendingAppStateFlushAction: 'quit' | 'close' | null = null;
let appStateFlushQuitTimer: ReturnType<typeof setTimeout> | null = null;

function getActiveProfilePartition(): string | undefined {
  const profileId = getActiveProfileId();
  if (!profileId) return undefined;
  return getProfileSessionPartition(profileId);
}

function resolveDataPath(filePath: string): string {
  if (path.isAbsolute(filePath)) return filePath;
  return path.join(getDataRoot(), filePath);
}

function resolveWindowIcon(): string | undefined {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'build', 'icon.png'),
        path.join(app.getAppPath(), 'build', 'icon.png'),
      ]
    : [path.join(__dirname, '../../build/icon.png')];
  return candidates.find((candidate) => existsSync(candidate));
}

const createWindow = (savedBounds?: Electron.Rectangle) => {
  let preloadPath: string;
  if (app.isPackaged) {
    const appPath = getInstallPath();
    preloadPath = path.join(appPath, 'dist-electron', 'preload.js');
    if (!existsSync(preloadPath)) {
      const altPath = path.join(process.resourcesPath, 'app.asar', 'dist-electron', 'preload.js');
      if (existsSync(altPath)) preloadPath = altPath;
    }
  } else {
    preloadPath = path.join(__dirname, 'preload.js');
  }

  const partition = getActiveProfilePartition();
  const webPreferences: Electron.WebPreferences = {
    preload: preloadPath,
    nodeIntegration: false,
    contextIsolation: true,
  };
  if (partition) {
    webPreferences.partition = partition;
  }

  mainWindow = new BrowserWindow({
    width: savedBounds?.width ?? 1200,
    height: savedBounds?.height ?? 800,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 800,
    minHeight: 600,
    icon: resolveWindowIcon(),
    webPreferences,
    title: 'Chamaccounts',
    frame: true,
    autoHideMenuBar: true,
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    if (app.isPackaged) {
      const appPath = getInstallPath();
      mainWindow.loadFile(path.join(appPath, 'dist', 'index.html')).catch(console.error);
    } else {
      const htmlPath = path.join(__dirname, '../dist/index.html');
      if (mainWindow) mainWindow.loadFile(htmlPath);
    }
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Laisser React / AppState sync démarrer, puis réinjecter si besoin.
    const win = mainWindow;
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      void restoreRecognisedListsInRendererIfNeeded(win);
    }, 1500);
  });

  mainWindow.on('close', (event) => {
    if (allowWindowCloseAfterFlush || quitAfterAppStateFlush) {
      allowWindowCloseAfterFlush = false;
      return;
    }
    event.preventDefault();
    requestAppStateFlush('close');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    setAppUpdaterMainWindow(null);
  });

  setAppUpdaterMainWindow(mainWindow);
  scheduleStartupUpdateCheck();
};

function finishPendingAppStateFlush(): void {
  if (appStateFlushQuitTimer) {
    clearTimeout(appStateFlushQuitTimer);
    appStateFlushQuitTimer = null;
  }
  const action = pendingAppStateFlushAction;
  if (action === null) return;
  pendingAppStateFlushAction = null;
  if (action === 'close') {
    allowWindowCloseAfterFlush = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
    return;
  }
  quitAfterAppStateFlush = true;
  app.quit();
}

function requestAppStateFlush(action: 'quit' | 'close'): void {
  if (pendingAppStateFlushAction) {
    if (action === 'quit') pendingAppStateFlushAction = 'quit';
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (action === 'quit') {
      quitAfterAppStateFlush = true;
      app.quit();
    }
    return;
  }
  pendingAppStateFlushAction = action;
  if (mainWindow.webContents.isLoadingMainFrame() || !getActiveDataRoot()) {
    finishPendingAppStateFlush();
    return;
  }
  mainWindow.webContents.send('flush-app-state-before-quit');
  if (appStateFlushQuitTimer) clearTimeout(appStateFlushQuitTimer);
  appStateFlushQuitTimer = setTimeout(() => {
    finishPendingAppStateFlush();
  }, 8000);
}

function reloadWindowForActiveProfile(): void {
  const bounds = mainWindow?.getBounds();
  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }
  createWindow(bounds);
}

const RECOGNISED_LIST_KEYS = [
  'settings-recognised-accounts',
  'settings-recognised-entry-types',
  'settings-recognised-output-types',
] as const;

/** Parse minimal du snapshot AppState (clé;valeur, guillemets CSV optionnels). */
function readRecognisedListsFromAppStateCsv(csvPath: string): Record<string, string> {
  if (!existsSync(csvPath)) return {};
  const text = readFileSync(csvPath, 'utf8');
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^"?key"?\s*;/i.test(line)) continue;
    const m = line.match(/^"?([^";]+)"?\s*;\s*"(.*)"\s*$/);
    if (!m) continue;
    const key = m[1];
    if (!(RECOGNISED_LIST_KEYS as readonly string[]).includes(key)) continue;
    // CSV escape: "" → "
    out[key] = m[2].replace(/""/g, '"');
  }
  return out;
}

function isEmptyRecognisedJson(raw: string | null): boolean {
  if (raw === null || raw.trim() === '') return true;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.length === 0;
  } catch {
    return false;
  }
}

/**
 * Si le renderer a perdu les listes reconnues mais que AppState/ les a encore,
 * les réinjecte dans localStorage (partition active).
 */
async function restoreRecognisedListsInRendererIfNeeded(
  win: BrowserWindow
): Promise<void> {
  const root = getActiveDataRoot();
  if (!root) return;
  const csvPath = path.join(root, LOCAL_STORAGE_SNAPSHOT_CSV_PATH);
  const fromCsv = readRecognisedListsFromAppStateCsv(csvPath);
  if (Object.keys(fromCsv).length === 0) return;

  const payload = JSON.stringify(fromCsv);
  try {
    const restored = (await win.webContents.executeJavaScript(
      `(() => {
        const fromCsv = ${payload};
        const keys = ${JSON.stringify(RECOGNISED_LIST_KEYS)};
        const isEmpty = (raw) => {
          if (raw === null || String(raw).trim() === '') return true;
          try {
            const p = JSON.parse(raw);
            return Array.isArray(p) && p.length === 0;
          } catch { return false; }
        };
        const restored = [];
        for (const key of keys) {
          const value = fromCsv[key];
          if (value === undefined || isEmpty(value)) continue;
          if (!isEmpty(localStorage.getItem(key))) continue;
          localStorage.setItem(key, value);
          restored.push(key);
        }
        return restored;
      })()`,
      true
    )) as string[];
    if (Array.isArray(restored) && restored.length > 0) {
      console.info('[AppState] listes reconnues réinjectées:', restored.join(', '));
      win.reload();
    }
  } catch (e) {
    console.warn('[AppState] restore recognised lists in renderer failed:', e);
  }
}

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
  ipcMain.handle('set-ui-locale', async (_, locale: unknown) => {
    if (!isAppLocale(locale)) return { success: false, error: 'Invalid locale' };
    setUiLocale(locale);
    return { success: true, locale };
  });
  ipcMain.handle('get-ui-locale', async () => ({ success: true, locale: getUiLocale() }));
  ipcMain.handle('read-file', async (_, filePath: string) => {
    try {
    const fullPath = resolveDataPath(filePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: tm('error.fileNotFound', { path: fullPath }) };
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
    const fullPath = resolveDataPath(filePath);
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
    const fullPath = path.isAbsolute(dirPath) ? dirPath : resolveDataPath(dirPath);
    if (!existsSync(fullPath)) {
      return { success: false, error: tm('error.folderNotFound', { path: fullPath }) };
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
    const fullPath = resolveDataPath(filePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: tm('error.fileNotFound', { path: fullPath }) };
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
    const fullSource = path.isAbsolute(sourcePath) ? sourcePath : resolveDataPath(sourcePath);
    const fullDest = path.isAbsolute(destPath) ? destPath : resolveDataPath(destPath);
    if (!existsSync(fullSource)) {
      return { success: false, error: tm('error.fileNotFound', { path: fullSource }) };
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

ipcMain.handle('get-app-path', async () => {
  const root = getActiveDataRoot();
  if (root) return root;
  throw new Error(tm('error.noActiveProfile'));
});

ipcMain.handle('get-data-root', async () => {
  const root = getActiveDataRoot();
  return { success: !!root, path: root ?? undefined };
});

ipcMain.handle('get-data-setup-status', async () => {
  return getDataSetupStatus(detectLegacyDataLocations);
});

ipcMain.handle(
  'register-data-profile',
  async (
    _,
    payload: { name: string; dataRoot: string; initialize?: boolean; setActive?: boolean }
  ) => {
    try {
      const dataRoot = path.resolve(payload.dataRoot);
      if (payload.initialize) {
        await fs.mkdir(dataRoot, { recursive: true });
      }
      if (!existsSync(dataRoot)) {
        return { success: false, error: tm('error.folderNotFoundShort') };
      }
      await ensureDataTree(dataRoot);
      const setActive = payload.setActive !== false;
      const profile = await addProfile(payload.name, dataRoot, setActive);
      if (setActive) {
        closeAllStores();
        await openAllStoresForRoot(dataRoot);
      }
      return { success: true, profile };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
);

ipcMain.handle('set-active-profile', async (_, profileId: string) => {
  const result = await setActiveProfile(profileId);
  if (result.ok) {
    // Fermer les stores avant un éventuel reset CSV/DB du profil Data Template.
    closeAllStores();
    await ensureDataTemplateProfile();
    const root = getActiveDataRoot();
    if (root) await openAllStoresForRoot(root);
  }
  return result;
});

ipcMain.handle('transactions-get-all', async () => {
  try {
    const root = getDataRoot();
    await ensureTransactionStore(root);
    return { success: true, data: await getAllAsSourceData(root) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle('transactions-replace-all', async (_, rows: Record<string, string>[]) => {
  try {
    const root = getDataRoot();
    return await replaceAllTransactions(root, Array.isArray(rows) ? rows : []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, count: 0 };
  }
});

ipcMain.handle('transactions-get-month-keys', async () => {
  try {
    const root = getDataRoot();
    return { success: true, data: await getTransactionMonthKeys(root) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle(
  'transactions-aggregate-range',
  async (_, payload: { startMs: number; endMs: number }) => {
    try {
      const root = getDataRoot();
      return {
        success: true,
        data: await aggregateTransactionsRange(
          root,
          Number(payload?.startMs),
          Number(payload?.endMs)
        ),
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, data: null };
    }
  }
);

ipcMain.handle('transactions-aggregate-yearly', async () => {
  try {
    const root = getDataRoot();
    return { success: true, data: await aggregateTransactionsYearly(root) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle('transactions-get-by-month', async (_, monthKey: string) => {
  try {
    const root = getDataRoot();
    return { success: true, data: await getTransactionsByMonth(root, String(monthKey ?? '')) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle('transactions-get-monthly-totals', async () => {
  try {
    const root = getDataRoot();
    return { success: true, data: await getMonthlyTotals(root) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle(
  'transactions-query-table-rows',
  async (_, query: TransactionsTableRowsQuery) => {
    try {
      const root = getDataRoot();
      return { success: true, data: await queryDashboardTableRows(root, query ?? { startMs: 0, endMs: 0 }) };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, data: null };
    }
  }
);

ipcMain.handle('transactions-get-suggest-values', async () => {
  try {
    const root = getDataRoot();
    return { success: true, data: await getSuggestColumnValues(root) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle('transactions-aggregate-annual-budget-year', async (_, year: number) => {
  try {
    const root = getDataRoot();
    return { success: true, data: await aggregateAnnualBudgetYear(root, Number(year)) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle(
  'transactions-refresh-gbp-rates',
  async (_, rates: { eurToGbp: number; chfToGbp: number } | PrimaryMappingRates) => {
    try {
      const root = getDataRoot();
      return await refreshGbpRates(root, rates as PrimaryMappingRates);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, rowCount: 0, updatedCount: 0 };
    }
  }
);

ipcMain.handle(
  'transactions-refresh-primary-rates',
  async (_, rates: PrimaryMappingRates) => {
    try {
      const root = getDataRoot();
      return await refreshPrimaryRates(root, {
        primary: String(rates?.primary || 'GBP').toUpperCase(),
        ratesToPrimary: rates?.ratesToPrimary ?? {},
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, rowCount: 0, updatedCount: 0 };
    }
  }
);

ipcMain.handle('working-currencies-get', async () => {
  try {
    const root = getDataRoot();
    const txCount = await getTransactionCount(root);
    const config = await ensureWorkingCurrencies(root, { transactionCount: txCount });
    return {
      success: true,
      data: {
        config,
        configured: isWorkingCurrencyConfigured(config),
        codes: workingCurrencyCodes(config),
        transactionCount: txCount,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle(
  'working-currencies-save',
  async (
    _,
    payload: { primary: string; secondaries?: Array<string | '' | null | undefined> }
  ) => {
    try {
      const root = getDataRoot();
      const result = saveWorkingCurrenciesFromInput(root, {
        primary: payload?.primary ?? '',
        secondaries: payload?.secondaries,
      });
      if (!result.ok) return { success: false, error: result.error, data: null };
      // Réécrire les miroirs CSV avec le nouvel en-tête indicateur.
      await syncCsvMirror(root);
      await syncSupportCsvMirror(root);
      return {
        success: true,
        data: {
          config: result.config,
          configured: true,
          codes: workingCurrencyCodes(result.config),
        },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, data: null };
    }
  }
);

ipcMain.handle('working-currencies-used-in-data', async () => {
  try {
    const root = getDataRoot();
    const tx = await getAllAsSourceData(root);
    const used = new Set<string>();
    for (const row of tx.rows) {
      const curHeader = tx.headers.find((h) => /^currency$/i.test(h));
      const c = curHeader ? String(row[curHeader] ?? '').trim().toUpperCase() : '';
      if (c) used.add(c);
    }
    const support = await getAllSupportAsSourceData(root);
    for (const row of support.rows) {
      const curHeader = support.headers.find((h) => /^currency$/i.test(h));
      const c = curHeader ? String(row[curHeader] ?? '').trim().toUpperCase() : '';
      if (c) used.add(c);
    }
    return { success: true, data: Array.from(used).sort() };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: [] as string[] };
  }
});

ipcMain.handle(
  'transactions-merge-month-edit',
  async (_, payload: { monthKey: string; rows: Record<string, string>[] }) => {
    try {
      const root = getDataRoot();
      return await mergeMonthEdit(
        root,
        String(payload?.monthKey ?? ''),
        Array.isArray(payload?.rows) ? payload.rows : []
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, count: 0 };
    }
  }
);

ipcMain.handle(
  'transactions-get-row-signatures',
  async (_, payload?: { accountEntries?: AccountAliasEntry[] }) => {
    try {
      const root = getDataRoot();
      const data = await getRowSignatures(
        root,
        Array.isArray(payload?.accountEntries) ? payload.accountEntries : []
      );
      return { success: true, data };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, data: null };
    }
  }
);

ipcMain.handle('transactions-get-anomaly-exceptions', async () => {
  try {
    const root = getDataRoot();
    return { success: true, data: await getAnomalyExceptions(root) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle('transactions-clear-anomaly-exception', async (_, idx: number) => {
  try {
    const root = getDataRoot();
    return await clearAnomalyException(root, Number(idx));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle(
  'transactions-detect-anomalies',
  async (
    _,
    payload: TransactionAnomalyContext & { writeReport?: boolean }
  ) => {
    try {
      const root = getDataRoot();
      const data = await detectTransactionAnomaliesMain(
        root,
        {
          recognisedAccountLabels: Array.isArray(payload?.recognisedAccountLabels)
            ? payload.recognisedAccountLabels
            : [],
          recognisedEntryTypes: Array.isArray(payload?.recognisedEntryTypes)
            ? payload.recognisedEntryTypes
            : [],
          recognisedOutputTypes: Array.isArray(payload?.recognisedOutputTypes)
            ? payload.recognisedOutputTypes
            : [],
        },
        Boolean(payload?.writeReport)
      );
      return { success: true, data };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, data: null };
    }
  }
);

ipcMain.handle('support-get-all', async () => {
  try {
    const root = getDataRoot();
    await ensureSupportStore(root);
    return { success: true, data: await getAllSupportAsSourceData(root) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle('support-replace-all', async (_, rows: Record<string, string>[]) => {
  try {
    const root = getDataRoot();
    return await replaceAllSupportRows(root, Array.isArray(rows) ? rows : []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, count: 0 };
  }
});

ipcMain.handle('account-balance-get-all', async () => {
  try {
    const root = getDataRoot();
    await ensureAccountBalanceStore(root);
    return { success: true, data: await getAllBalanceRows(root) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle('account-balance-get-monthly-chart', async () => {
  try {
    const root = getDataRoot();
    return { success: true, data: await getMonthlyBalanceChart(root) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle('account-balance-nearest-row', async (_, targetMs: number) => {
  try {
    const root = getDataRoot();
    return { success: true, data: await getNearestBalanceRow(root, Number(targetMs)) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle('account-balance-get-mirror-headers', async () => {
  try {
    const root = getDataRoot();
    return { success: true, data: await getAccountBalanceMirrorHeaders(root) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, data: null };
  }
});

ipcMain.handle(
  'account-balance-detect-anomalies',
  async (
    _,
    payload: {
      activeAccounts: BalanceAccountColumn[];
      writeReport?: boolean;
    }
  ) => {
    try {
      const root = getDataRoot();
      const data = await detectAccountBalanceAnomaliesMain(
        root,
        Array.isArray(payload?.activeAccounts) ? payload.activeAccounts : [],
        Boolean(payload?.writeReport)
      );
      return { success: true, data };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, data: null };
    }
  }
);

ipcMain.handle(
  'account-balance-replace-all',
  async (
    _,
    payload: { rows: BalanceRowDto[]; accounts: BalanceAccountColumn[] }
  ) => {
    try {
      const root = getDataRoot();
      return await replaceAllBalanceRows(
        root,
        Array.isArray(payload?.rows) ? payload.rows : [],
        Array.isArray(payload?.accounts) ? payload.accounts : []
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message, count: 0 };
    }
  }
);

ipcMain.handle(
  'account-balance-rewrite-columns',
  async (_, accounts: BalanceAccountColumn[]) => {
    try {
      const root = getDataRoot();
      return await rewriteBalanceColumns(root, Array.isArray(accounts) ? accounts : []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, error: message };
    }
  }
);

ipcMain.handle('reload-window-for-active-profile', async () => {
  try {
    reloadWindowForActiveProfile();
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('app-state-flush-complete', () => {
  finishPendingAppStateFlush();
  return { success: true };
});

ipcMain.handle('rename-data-profile', async (_, payload: { profileId: string; name: string }) => {
  return renameProfile(payload.profileId, payload.name);
});

ipcMain.handle('remove-data-profile', async (_, profileId: string) => {
  return removeProfile(profileId);
});

ipcMain.handle('initialize-data-folder', async (_, dataRoot: string) => {
  try {
    const resolved = path.resolve(dataRoot);
    await fs.mkdir(resolved, { recursive: true });
    await ensureDataTree(resolved);
    return { success: true, path: resolved };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('select-folder', async () => {
  try {
    if (!mainWindow) return { success: false, error: tm('error.windowUnavailable') };
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'], title: tm('dialog.selectFolder') });
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
      if (!mainWindow) return { success: false, error: tm('error.windowUnavailable') };
      const multi = options?.allowMultiple === true;
      const opts: OpenDialogOptions = {
        properties: multi ? ['openFile', 'multiSelections'] : ['openFile'],
        title: multi ? tm('dialog.selectFiles') : tm('dialog.selectFile'),
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
    if (!mainWindow) return { success: false, error: tm('error.windowUnavailable') };
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      title: tm('dialog.importFiles'),
      filters: [
        { name: tm('dialog.filterTransactions'), extensions: ['xlsx', 'csv'] },
        { name: tm('dialog.filterAll'), extensions: ['*'] },
      ],
    });
    if (result.canceled || !result.filePaths?.length) {
      return { success: true, canceled: true, imported: [] };
    }
    const destDir = resolveDataPath(TRANSACTIONS_IMPORT_DIR);
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
    const fullPath = resolveDataPath(TRANSACTIONS_IMPORT_DIR);
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
    const importDir = resolveDataPath(TRANSACTIONS_IMPORT_DIR);
    if (!existsSync(importDir)) {
      return { success: true, movedCount: 0, message: tm('error.noImportFolder') };
    }
    const entries = await fs.readdir(importDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (files.length === 0) {
      return { success: true, movedCount: 0, message: tm('error.noImportFiles') };
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
      message: tm('error.filesMovedTrash', { count: movedCount }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, movedCount: 0 };
  }
});

ipcMain.handle('open-account-balance-import-folder', async () => {
  try {
    const fullPath = resolveDataPath(ACCOUNT_BALANCE_IMPORT_DIR);
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
    const importDir = resolveDataPath(ACCOUNT_BALANCE_IMPORT_DIR);
    if (!existsSync(importDir)) {
      return { success: true, movedCount: 0, message: tm('error.noImportFolder') };
    }
    const entries = await fs.readdir(importDir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    if (files.length === 0) {
      return { success: true, movedCount: 0, message: tm('error.noImportFiles') };
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
      message: tm('error.filesMovedTrash', { count: movedCount }),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, movedCount: 0 };
  }
});

ipcMain.handle('merge-import-transactions', async () => {
  try {
    const result = await mergeImportTransactions(getDataRoot());
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
    return await appendForcedTransactionRows(getDataRoot(), Array.isArray(rows) ? rows : []);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message, appendedCount: 0 };
  }
});

ipcMain.handle('get-last-import-report-path', async () => {
  try {
    const relativePath = await getLastImportReportPath(getDataRoot());
    return { success: true, path: relativePath };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('open-import-report', async () => {
  try {
    const dataRoot = getDataRoot();
    const relativePath = await getLastImportReportPath(dataRoot);
    if (!relativePath) {
      return { success: false, error: tm('error.noMergeReport') };
    }
    const fullPath = path.join(dataRoot, relativePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: tm('error.reportFileNotFound') };
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
    const fullPath = resolveDataPath(ANOMALY_REPORT_PATH);
    if (!existsSync(fullPath)) {
      return { success: false, error: tm('error.noAnomalyReport') };
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
    const fullPath = resolveDataPath(MONTHLY_ANOMALY_REPORT_PATH);
    if (!existsSync(fullPath)) {
      return { success: false, error: tm('error.noMonthlyAnomalyReport') };
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
    const fullPath = resolveDataPath(ACCOUNT_BALANCE_ANOMALY_REPORT_PATH);
    if (!existsSync(fullPath)) {
      return { success: false, error: tm('error.noBalanceAnomalyReport') };
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
    const dataRoot = getDataRoot();
    const relativePath = await getLastImportReportPath(dataRoot);
    if (!relativePath) {
      return { success: false, error: tm('error.noImportReport') };
    }
    const fullPath = path.join(dataRoot, relativePath);
    if (!existsSync(fullPath)) {
      return { success: false, error: tm('error.reportFileNotFound') };
    }
    if (!mainWindow) return { success: false, error: tm('error.windowUnavailable') };
    const defaultName = path.basename(fullPath);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: tm('dialog.downloadImportReport'),
      defaultPath: defaultName,
      filters: [{ name: tm('dialog.filterText'), extensions: ['txt'] }],
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
    if (!mainWindow) return { success: false, error: tm('error.windowUnavailable') };
    const opts: SaveDialogOptions = { title: tm('dialog.saveFile') };
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
    if (!mainWindow) return { success: false, error: tm('error.windowUnavailable') };
    await migrateLegacyPackagedDataIfNeeded();
    const dataDir = getDataRoot();
    if (!existsSync(dataDir)) {
      await fs.mkdir(dataDir, { recursive: true });
    }
    try {
      await syncCsvMirror(dataDir);
      await syncSupportCsvMirror(dataDir);
      await syncAccountBalanceCsvMirror(dataDir, []);
    } catch {
      /* miroir best-effort */
    }
    const defaultName = `chamaccounts-data-${new Date().toISOString().slice(0, 10)}.zip`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: tm('dialog.exportZip'),
      defaultPath: defaultName,
      filters: [{ name: tm('dialog.filterZip'), extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    await writeDataFolderZip(dataDir, result.filePath);
    return { success: true, path: result.filePath };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

function safeZipExtractTarget(dataRoot: string, entryName: string): string | null {
  const norm = entryName.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = norm.split('/').filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  let relParts: string[];
  if (parts[0].toLowerCase() === 'data') {
    relParts = parts.slice(1);
  } else {
    relParts = parts;
  }
  if (relParts.length === 0 || relParts.some((p) => p === '..')) return null;
  return path.join(dataRoot, ...relParts);
}

/** Importe une archive produite par « Exporter le projet » : uniquement les entrées sous data/. */
ipcMain.handle('import-data-folder-zip', async () => {
  try {
    if (!mainWindow) return { success: false, error: tm('error.windowUnavailable') };
    await migrateLegacyPackagedDataIfNeeded();
    const pick = await dialog.showOpenDialog(mainWindow, {
      title: tm('dialog.importZip'),
      filters: [{ name: tm('dialog.filterZip'), extensions: ['zip'] }],
      properties: ['openFile'],
    });
    if (pick.canceled || !pick.filePaths?.[0]) {
      return { success: false, canceled: true };
    }
    const zipPath = pick.filePaths[0];
    const dataRoot = getDataRoot();
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    let extractedFileCount = 0;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const dest = safeZipExtractTarget(dataRoot, entry.entryName);
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
        error: tm('error.zipNoFiles'),
      };
    }
    const snapshotFull = path.join(dataRoot, LOCAL_STORAGE_SNAPSHOT_CSV_PATH);
    const appStateSnapshotFound = existsSync(snapshotFull);
    // Rehydrate SQLite depuis les CSV miroirs importés (archives legacy ou export).
    closeAllStores();
    await deleteDbAndSidecars(dataRoot, TRANSACTIONS_DB_PATH);
    await deleteDbAndSidecars(dataRoot, SUPPORT_DB_PATH);
    await deleteDbAndSidecars(dataRoot, ACCOUNT_BALANCE_DB_PATH);
    await openAllStoresForRoot(dataRoot);
    return { success: true, extractedFileCount, appStateSnapshotFound };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
});

ipcMain.handle('read-external-file', async (_, filePath: string) => {
  try {
    if (!existsSync(filePath)) return { success: false, error: tm('error.fileNotFound', { path: filePath }) };
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
    const fullPath = resolveDataPath(filePath);
    if (!existsSync(fullPath)) return { success: false, error: tm('error.fileNotFound', { path: fullPath }) };
    await shell.openPath(fullPath);
    return { success: true };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('write-binary-file', async (_, filePath: string, base64Content: string) => {
  try {
    const fullPath = resolveDataPath(filePath);
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
      const fullPath = resolveDataPath(filePath);
      if (!existsSync(fullPath)) {
        return { success: false, error: tm('error.fileNotFoundShort') };
      }
      const ext = path.extname(fullPath).toLowerCase();
      if (ext !== '.xlsx') {
        return { success: false, error: tm('error.xlsxRequired') };
      }
      const XLSX = require('xlsx');
      const workbook = XLSX.readFile(fullPath);
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return { success: false, error: tm('error.xlsxNoSheets') };
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
  app.whenReady().then(async () => {
    initUiLocaleFromDisk();
    await migrateLegacyPackagedDataIfNeeded();
    await ensureConfigLoaded();
    await ensureDataTemplateProfile();
    const activeRoot = getActiveDataRoot();
    if (activeRoot) {
      try {
        await openAllStoresForRoot(activeRoot);
      } catch (err) {
        console.error('Ouverture bases SQLite impossible:', err);
      }
    }
    registerAppUpdaterIpc();
    registerIpcHandlers();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('will-quit', () => {
    closeAllStores();
  });

  app.on('before-quit', (event) => {
    if (quitAfterAppStateFlush) return;
    event.preventDefault();
    requestAppStateFlush('quit');
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
