import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import { GITHUB_RELEASES_PAGE_URL } from '../shared/githubApp';
import { installMacUpdateFromZip } from './macUnsignedUpdate';

export type AppUpdateStatus = 'dev' | 'up-to-date' | 'update-available' | 'error';

export type AppUpdateCheckResult = {
  success: boolean;
  currentVersion: string;
  status: AppUpdateStatus;
  latestVersion?: string;
  releaseNotes?: string;
  releaseUrl?: string;
  error?: string;
};

export type AppUpdateAvailablePayload = {
  currentVersion: string;
  latestVersion: string;
  releaseNotes?: string;
  releaseUrl: string;
};

export type AppUpdateDownloadResult = {
  success: boolean;
  error?: string;
};

const STARTUP_CHECK_DELAY_MS = 12_000;

let mainWindow: BrowserWindow | null = null;
let downloadInProgress = false;
let startupCheckScheduled = false;

export function setAppUpdaterMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

function formatReleaseNotes(info: UpdateInfo): string | undefined {
  if (typeof info.releaseNotes === 'string') return info.releaseNotes;
  if (Array.isArray(info.releaseNotes)) {
    return info.releaseNotes.map((n) => n.note ?? '').filter(Boolean).join('\n');
  }
  return undefined;
}

function notifyRendererUpdateAvailable(info: UpdateInfo): void {
  const payload: AppUpdateAvailablePayload = {
    currentVersion: app.getVersion(),
    latestVersion: info.version,
    releaseNotes: formatReleaseNotes(info),
    releaseUrl: GITHUB_RELEASES_PAGE_URL,
  };
  mainWindow?.webContents.send('app-update-available', payload);
}

function sendDownloadProgress(percent: number): void {
  mainWindow?.webContents.send('app-update-download-progress', percent);
}

function formatDownloadError(raw: string): string {
  if (/ZIP file not provided/i.test(raw)) {
    return 'Impossible d’installer automatiquement : le paquet macOS .zip est absent de la release GitHub. Ouverture de la page des releases pour installer le .dmg.';
  }
  if (/code signature for running application/i.test(raw)) {
    return 'Impossible d’installer automatiquement depuis cette version. Installez une fois le .dmg depuis GitHub (glisser dans Applications) : les mises à jour suivantes se feront dans l’app, sans certificat Apple.';
  }
  return raw;
}

function checkForUpdatesOnce(options?: { silent?: boolean }): Promise<AppUpdateCheckResult> {
  const currentVersion = app.getVersion();
  const silent = options?.silent ?? false;

  return new Promise((resolve) => {
    const timeoutMs = 90_000;
    let settled = false;

    const finish = (result: AppUpdateCheckResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('error', onError);
      resolve(result);
    };

    const onAvailable = (info: UpdateInfo) => {
      if (silent) {
        notifyRendererUpdateAvailable(info);
      }
      finish({
        success: true,
        currentVersion,
        status: 'update-available',
        latestVersion: info.version,
        releaseNotes: formatReleaseNotes(info),
        releaseUrl: GITHUB_RELEASES_PAGE_URL,
      });
    };

    const onNotAvailable = () => {
      finish({
        success: true,
        currentVersion,
        status: 'up-to-date',
        releaseUrl: GITHUB_RELEASES_PAGE_URL,
      });
    };

    const onError = (err: Error) => {
      if (!silent) {
        finish({
          success: false,
          currentVersion,
          status: 'error',
          error: err.message,
          releaseUrl: GITHUB_RELEASES_PAGE_URL,
        });
        return;
      }
      // Au démarrage : pas de bruit si le réseau ou la première release manque.
      finish({
        success: false,
        currentVersion,
        status: 'error',
        error: err.message,
        releaseUrl: GITHUB_RELEASES_PAGE_URL,
      });
    };

    const timeout = setTimeout(() => {
      finish({
        success: false,
        currentVersion,
        status: 'error',
        error: 'Délai dépassé lors de la vérification des mises à jour.',
        releaseUrl: GITHUB_RELEASES_PAGE_URL,
      });
    }, timeoutMs);

    autoUpdater.once('update-available', onAvailable);
    autoUpdater.once('update-not-available', onNotAvailable);
    autoUpdater.once('error', onError);

    autoUpdater.checkForUpdates().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      onError(new Error(message));
    });
  });
}

function downloadAndInstallUpdate(): Promise<AppUpdateDownloadResult> {
  if (downloadInProgress) {
    return Promise.resolve({ success: false, error: 'Un téléchargement est déjà en cours.' });
  }

  return new Promise((resolve) => {
    downloadInProgress = true;
    const timeoutMs = 30 * 60_000;

    const cleanup = () => {
      downloadInProgress = false;
      clearTimeout(timeout);
      autoUpdater.removeListener('update-downloaded', onDownloaded);
      autoUpdater.removeListener('error', onError);
      autoUpdater.removeListener('download-progress', onProgress);
    };

    const onProgress = (progress: { percent?: number }) => {
      if (typeof progress.percent === 'number') {
        sendDownloadProgress(Math.round(progress.percent));
      }
    };

    const onDownloaded = async (event: UpdateDownloadedEvent) => {
      cleanup();
      sendDownloadProgress(100);
      const replaceMacApp = process.platform === 'darwin';
      const dialogOptions = {
        type: 'info' as const,
        title: 'Mise à jour prête',
        message: 'La nouvelle version a été téléchargée.',
        detail: replaceMacApp
          ? 'Redémarrer maintenant pour remplacer Chamaccounts et relancer l’application ?'
          : 'Redémarrer maintenant pour installer la mise à jour ?',
        buttons: ['Redémarrer', 'Plus tard'],
        defaultId: 0,
        cancelId: 1,
      };
      const { response } = mainWindow
        ? await dialog.showMessageBox(mainWindow, dialogOptions)
        : await dialog.showMessageBox(dialogOptions);
      if (response === 0) {
        if (replaceMacApp) {
          try {
            await installMacUpdateFromZip(event.downloadedFile);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            void shell.openExternal(GITHUB_RELEASES_PAGE_URL);
            resolve({ success: false, error: message });
            return;
          }
        } else {
          autoUpdater.quitAndInstall(false, true);
        }
      }
      resolve({ success: true });
    };

    const onError = (err: Error) => {
      cleanup();
      const raw = err.message;
      const message = formatDownloadError(raw);
      if (/ZIP file not provided|code signature for running application/i.test(raw)) {
        void shell.openExternal(GITHUB_RELEASES_PAGE_URL);
      }
      resolve({ success: false, error: message });
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ success: false, error: 'Délai dépassé lors du téléchargement.' });
    }, timeoutMs);

    autoUpdater.on('download-progress', onProgress);
    autoUpdater.once('update-downloaded', onDownloaded);
    autoUpdater.once('error', onError);

    autoUpdater.downloadUpdate().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      onError(new Error(message));
    });
  });
}

/** Vérification discrète ~12 s après le lancement (app packagée uniquement). */
export function scheduleStartupUpdateCheck(): void {
  if (!app.isPackaged || startupCheckScheduled) return;
  startupCheckScheduled = true;

  setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    void checkForUpdatesOnce({ silent: true });
  }, STARTUP_CHECK_DELAY_MS);
}

export function registerAppUpdaterIpc(): void {
  autoUpdater.autoDownload = false;
  // macOS : pas de Squirrel (exige un certificat Apple). Windows/Linux : install native.
  autoUpdater.autoInstallOnAppQuit = process.platform !== 'darwin';

  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('open-github-releases', async () => {
    await shell.openExternal(GITHUB_RELEASES_PAGE_URL);
    return { success: true as const };
  });

  ipcMain.handle('check-for-app-update', async (): Promise<AppUpdateCheckResult> => {
    const currentVersion = app.getVersion();
    if (!app.isPackaged) {
      return {
        success: true,
        currentVersion,
        status: 'dev',
        releaseUrl: GITHUB_RELEASES_PAGE_URL,
        error:
          'Les mises à jour automatiques ne fonctionnent que dans l’application installée (build packagé).',
      };
    }
    return checkForUpdatesOnce({ silent: false });
  });

  ipcMain.handle('download-app-update', async (): Promise<AppUpdateDownloadResult> => {
    if (!app.isPackaged) {
      return {
        success: false,
        error: 'Téléchargement indisponible en mode développement.',
      };
    }
    return downloadAndInstallUpdate();
  });
}
