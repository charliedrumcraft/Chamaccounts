import {
  groupFilteredLineIndicesByFile,
  importFileContentIsBlank,
  originalIndicesToRemoveFromFiltered,
  removeOriginalLineIndicesFromContent,
  type ImportWizardRemovableRow,
} from '@/shared/importWizardRemoveImportedLines';

type FileApi = {
  readFile: (path: string) => Promise<{ success: boolean; data?: string; error?: string }>;
  writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
  deleteFile: (path: string) => Promise<{ success: boolean; error?: string }>;
};

function safeImportBasename(fileName: string): string | null {
  const base = fileName.trim();
  if (!base || base.includes('/') || base.includes('\\') || base.includes('..')) return null;
  return base;
}

/**
 * Retire du dossier Import les lignes correspondant aux lignes wizard importées avec succès.
 */
export async function removeImportedRowsFromImportFolder(params: {
  rows: ImportWizardRemovableRow[];
  importFilePath: (fileName: string) => string;
  api: FileApi;
}): Promise<{
  success: boolean;
  error?: string;
  removedLineCount: number;
  updatedFiles: string[];
  deletedFiles: string[];
}> {
  const { rows, importFilePath, api } = params;
  if (rows.length === 0) {
    return { success: true, removedLineCount: 0, updatedFiles: [], deletedFiles: [] };
  }

  const byFile = groupFilteredLineIndicesByFile(rows);
  if (byFile.size === 0) {
    return { success: true, removedLineCount: 0, updatedFiles: [], deletedFiles: [] };
  }

  let removedLineCount = 0;
  const updatedFiles: string[] = [];
  const deletedFiles: string[] = [];

  for (const [fileName, filteredIndices] of byFile) {
    const safeName = safeImportBasename(fileName);
    if (!safeName) continue;

    const relPath = importFilePath(safeName);
    const read = await api.readFile(relPath);
    if (!read.success || read.data === undefined) {
      return {
        success: false,
        error: read.error ?? `Impossible de lire ${safeName} dans le dossier Import.`,
        removedLineCount,
        updatedFiles,
        deletedFiles,
      };
    }

    const originalToRemove = originalIndicesToRemoveFromFiltered(read.data, filteredIndices);
    if (originalToRemove.size === 0) continue;

    removedLineCount += originalToRemove.size;
    const newContent = removeOriginalLineIndicesFromContent(read.data, originalToRemove);

    if (importFileContentIsBlank(newContent)) {
      const del = await api.deleteFile(relPath);
      if (!del.success) {
        return {
          success: false,
          error: del.error ?? `Impossible de supprimer ${safeName}.`,
          removedLineCount,
          updatedFiles,
          deletedFiles,
        };
      }
      deletedFiles.push(safeName);
    } else {
      const write = await api.writeFile(relPath, newContent);
      if (!write.success) {
        return {
          success: false,
          error: write.error ?? `Impossible de mettre à jour ${safeName}.`,
          removedLineCount,
          updatedFiles,
          deletedFiles,
        };
      }
      updatedFiles.push(safeName);
    }
  }

  return { success: true, removedLineCount, updatedFiles, deletedFiles };
}
