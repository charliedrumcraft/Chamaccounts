/** Lecture de fichiers via l'API Electron */
export class FileService {
  static async readFile(filePath: string): Promise<string> {
    if (!window.electronAPI?.readFile) {
      throw new Error('electronAPI.readFile non disponible');
    }
    const result = await window.electronAPI.readFile(filePath);
    if (!result.success) {
      throw new Error(result.error || 'Erreur lecture fichier');
    }
    return result.data ?? '';
  }

  static async getAppPath(): Promise<string> {
    if (!window.electronAPI?.getAppPath) {
      throw new Error('electronAPI.getAppPath non disponible');
    }
    return window.electronAPI.getAppPath();
  }
}
