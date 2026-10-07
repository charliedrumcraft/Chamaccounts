/** Lecture de fichiers via l'API Electron */

import i18n from '../i18n';
export class FileService {
  static async readFile(filePath: string): Promise<string> {
    if (!window.electronAPI?.readFile) {
      throw new Error(i18n.t('system.electronMethodUnavailable', { name: 'readFile' }));
    }
    const result = await window.electronAPI.readFile(filePath);
    if (!result.success) {
      throw new Error(result.error || i18n.t('system.fileReadError'));
    }
    return result.data ?? '';
  }

  static async getAppPath(): Promise<string> {
    const api = window.electronAPI;
    if (api?.getDataRoot) {
      const r = await api.getDataRoot();
      if (r.success && r.path) return r.path;
    }
    if (!api?.getAppPath) {
      throw new Error(i18n.t('system.electronMethodUnavailable', { name: 'getAppPath' }));
    }
    return api.getAppPath();
  }
}
