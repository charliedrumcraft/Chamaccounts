/**
 * Correspondance Type → id de ligne du bilan.
 * Vide par défaut : les affectations vivent dans le profil (snapshot budget annuel).
 */
export const TYPE_TO_BALANCE_LINE_ID: Record<string, string> = {};

/** Pour chaque ligne de bilan, types affectés par défaut (inverse de TYPE_TO_BALANCE_LINE_ID). */
export function getDefaultLineAssignedTypes(): Record<string, string[]> {
  const lineToTypes: Record<string, string[]> = {};
  for (const [type, lineId] of Object.entries(TYPE_TO_BALANCE_LINE_ID)) {
    if (!lineToTypes[lineId]) lineToTypes[lineId] = [];
    lineToTypes[lineId].push(type);
  }
  return lineToTypes;
}

/**
 * Résout l'id de ligne du bilan pour un type de transaction (mapping direct ou types affectés à la ligne).
 */
export function resolveBalanceLineIdForTransactionType(
  type: string,
  lineAssignedTypes: Record<string, string[]>
): string | null {
  const t = type.trim();
  if (!t || t === '—') return null;
  const direct = TYPE_TO_BALANCE_LINE_ID[t];
  if (direct) return direct;
  const defaults = getDefaultLineAssignedTypes();
  const lineIds = new Set([...Object.keys(defaults), ...Object.keys(lineAssignedTypes)]);
  for (const lineId of lineIds) {
    const assigned = lineAssignedTypes[lineId] ?? defaults[lineId] ?? [];
    if (assigned.includes(t)) return lineId;
  }
  return null;
}
