/** Style des bandeaux de message (succès / avertissement / erreur) selon le texte. */

export type UiMessageTone = 'success' | 'warning' | 'error' | 'info';

export function getUiMessageTone(message: string): UiMessageTone {
  const m = message.toLowerCase();
  if (
    m.includes('erreur') ||
    m.includes('introuvable') ||
    m.includes('refus') ||
    m.includes('impossible')
  ) {
    return 'error';
  }
  if (
    m.includes('anomalie') ||
    m.includes('aucun fichier') ||
    m.includes('aucune ligne') ||
    m.includes('ignorée') ||
    m.includes('non fusionnée')
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
    m.includes('déplacé')
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
