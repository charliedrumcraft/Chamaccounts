/** Colonne optionnelle dans les transactions : exclure la ligne des totaux Soutien ( Σ par titre, totaux par année ). */
export const SOUTIEN_IGNORE_COLUMN = 'Soutien_ignorer';

/** Vrai si la ligne doit être exclue des sommes sur la page Soutien (valeurs type 1 / oui / true). */
export function isRowIgnoredForSoutienTotals(
  row: Record<string, string>,
  ignoreHeader: string | null | undefined
): boolean {
  if (!ignoreHeader) return false;
  const v = (row[ignoreHeader] ?? '').trim().toLowerCase();
  return v === '1' || v === 'oui' || v === 'o' || v === 'true' || v === 'yes' || v === 'ignoré' || v === 'ignore';
}
