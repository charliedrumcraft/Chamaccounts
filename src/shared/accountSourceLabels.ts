/**
 * Normalisation compte source_data : Advanz / Advanzia = un seul compte.
 */

/** Compte canonique utilisé dans les données (groupement, filtres). */
export function canonicalAccountFromSource(raw: string): string {
  const s = (raw ?? '').trim();
  if (/^Advanzia$/i.test(s)) return 'Advanz';
  return s || '';
}

/** Libellé à afficher pour l'utilisateur (Advanz → Advanzia). */
export function accountLabelFromSource(raw: string): string {
  const s = (raw ?? '').trim();
  if (/^Advanz(ia)?$/i.test(s)) return 'Advanzia';
  return s || '';
}
