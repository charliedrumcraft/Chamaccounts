/** Style des bandeaux de message (succès / avertissement / erreur) selon le texte. */

export type UiMessageTone = 'success' | 'warning' | 'error' | 'info';

export function getUiMessageTone(message: string): UiMessageTone {
  const m = message.toLowerCase();
  if (
    m.includes('erreur') ||
    m.includes('error') ||
    m.includes('failed') ||
    m.includes('introuvable') ||
    m.includes('refus') ||
    m.includes('impossible') ||
    m.includes('could not') ||
    m.includes('not found') ||
    m.includes('unavailable')
  ) {
    return 'error';
  }
  if (
    m.includes('anomalie') ||
    m.includes('anomal') ||
    m.includes('aucun fichier') ||
    m.includes('aucune ligne') ||
    m.includes('ignorée') ||
    m.includes('ignored') ||
    m.includes('non fusionnée') ||
    m.includes('no file') ||
    m.includes('no row')
  ) {
    return 'warning';
  }
  if (
    m.includes('copié') ||
    m.includes('fusionnée') ||
    m.includes('intégrée') ||
    m.includes('remplacée') ||
    m.includes('mis à jour') ||
    m.includes('archivé') ||
    m.includes('corbeille') ||
    m.includes('déplacé') ||
    m.includes('latest') ||
    m.includes('saved') ||
    m.includes('enregistr') ||
    m.includes('complete') ||
    m.includes('terminé')
  ) {
    return 'success';
  }
  return 'info';
}

export function uiMessageClass(tone: UiMessageTone): string {
  if (tone === 'error') return 'border-red-200 bg-red-50 text-red-700';
  if (tone === 'warning') return 'border-amber-200 bg-amber-50 text-amber-800';
  if (tone === 'success') return 'border-green-200 bg-green-50 text-green-700';
  return 'border-gray-200 bg-gray-50 text-gray-700';
}
