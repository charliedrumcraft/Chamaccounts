/**
 * Retire des fichiers CSV du dossier Import les lignes déjà importées via le mapping wizard.
 * Les identifiants de ligne suivent parseFileForWizard : `${fileName}:${indexLigneFiltrée1Based}:${compteur}`.
 */

export interface ImportWizardRemovableRow {
  id: string;
  sourceFile: string;
}

export function isVirtualImportWizardSource(sourceFile: string): boolean {
  return sourceFile.startsWith('Presse-papiers_');
}

/** Extrait fileName et l’index 1-based dans le tableau de lignes non vides (comme parseFileForWizard). */
export function parseImportWizardRowId(
  id: string
): { fileName: string; filteredLine1Based: number } | null {
  const lastColon = id.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const secondLastColon = id.lastIndexOf(':', lastColon - 1);
  if (secondLastColon <= 0) return null;
  const fileName = id.slice(0, secondLastColon);
  const filteredLine1Based = parseInt(id.slice(secondLastColon + 1, lastColon), 10);
  if (!Number.isFinite(filteredLine1Based) || filteredLine1Based < 1) return null;
  return { fileName, filteredLine1Based };
}

/** Index dans le fichier original (0-based) pour chaque ligne non vide, dans l’ordre. */
export function filteredNonemptyLineToOriginalIndex(content: string): number[] {
  const original = content.split(/\r?\n/);
  const mapping: number[] = [];
  for (let i = 0; i < original.length; i++) {
    if (original[i].trim() !== '') mapping.push(i);
  }
  return mapping;
}

export function removeOriginalLineIndicesFromContent(
  content: string,
  originalIndicesToRemove: Set<number>
): string {
  if (originalIndicesToRemove.size === 0) return content;
  const lines = content.split(/\r?\n/);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  return lines.filter((_, i) => !originalIndicesToRemove.has(i)).join(newline);
}

export function importFileContentIsBlank(content: string): boolean {
  return content.split(/\r?\n/).every((l) => !l.trim());
}

/** Regroupe les indices de lignes filtrées (1-based) à retirer, par nom de fichier. */
export function groupFilteredLineIndicesByFile(
  rows: ImportWizardRemovableRow[]
): Map<string, Set<number>> {
  const byFile = new Map<string, Set<number>>();
  for (const row of rows) {
    if (isVirtualImportWizardSource(row.sourceFile)) continue;
    const parsed = parseImportWizardRowId(row.id);
    if (!parsed || parsed.fileName !== row.sourceFile) continue;
    let set = byFile.get(row.sourceFile);
    if (!set) {
      set = new Set();
      byFile.set(row.sourceFile, set);
    }
    set.add(parsed.filteredLine1Based);
  }
  return byFile;
}

export function originalIndicesToRemoveFromFiltered(
  content: string,
  filteredLineIndices1Based: Set<number>
): Set<number> {
  const mapping = filteredNonemptyLineToOriginalIndex(content);
  const out = new Set<number>();
  for (const oneBased of filteredLineIndices1Based) {
    const orig = mapping[oneBased - 1];
    if (orig !== undefined) out.add(orig);
  }
  return out;
}
