/**
 * Service de suggestions pour champs de saisie (autocomplete).
 * Calcule les entrées les plus probables à partir des lignes existantes,
 * par préfixe et fréquence (règle statistique).
 * Utilisable pour Date, Title, Type, Comptes (Account) ou toute colonne textuelle.
 */

export interface SuggestionItem {
  value: string;
  count: number;
}

/**
 * Indique si une colonne doit avoir des suggestions texte (Title, Type, Comptes/Account).
 * Utilisé pour activer getSuggestions et la validation TAB sur la première suggestion.
 */
export function isTextSuggestibleColumn(header: string): boolean {
  return (
    /^title$/i.test(header) ||
    /^type$/i.test(header) ||
    /^account$/i.test(header) ||
    /compte/i.test(header)
  );
}

/**
 * Construit la map valeur → nombre d'occurrences pour une colonne.
 * Les valeurs vides sont ignorées.
 */
export function buildFrequencyMap(
  rows: Record<string, string>[],
  header: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const v = (row[header] ?? '').trim();
    if (v === '') continue;
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return map;
}

/**
 * Retourne les suggestions pour une colonne et un préfixe saisi.
 * Filtre les valeurs qui commencent par le préfixe (insensible à la casse),
 * triées par fréquence décroissante (entrée la plus probable en premier).
 *
 * @param rows - Lignes source (ex. data.rows ou rowsForMonth)
 * @param header - Nom de la colonne (ex. "Title", "Type", "Date")
 * @param prefix - Texte déjà saisi (ex. "a" pour suggérer "Aldi")
 * @param limit - Nombre max de suggestions (défaut 10)
 */
export function getSuggestions(
  rows: Record<string, string>[],
  header: string,
  prefix: string,
  limit: number = 10
): SuggestionItem[] {
  const normalizedPrefix = prefix.trim().toLowerCase();
  const freq = buildFrequencyMap(rows, header);
  const items: SuggestionItem[] = [];
  for (const [value, count] of freq) {
    if (value.trim().toLowerCase().startsWith(normalizedPrefix)) {
      items.push({ value, count });
    }
  }
  items.sort((a, b) => b.count - a.count);
  return items.slice(0, limit);
}

/**
 * Nombre de jours dans un mois (1-12), année pour février bissextile.
 */
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Suggestions de dates pour le mois sélectionné (colonne Date).
 * selectedMonth au format "YYYY-MM". Retourne les dates JJ.MM.AAAA du mois
 * dont le jour (ou la chaîne) commence par le préfixe saisi (ex. "13" → ["13.02.2026"]).
 */
export function getDateSuggestionsForMonth(
  selectedMonth: string,
  prefix: string
): string[] {
  const p = (prefix ?? '').trim();
  if (!selectedMonth || !/^\d{4}-\d{2}$/.test(selectedMonth)) return [];
  const [year, month] = selectedMonth.split('-').map(Number);
  const daysInMonth = getDaysInMonth(year, month);
  const suggestions: string[] = [];
  const mm = String(month).padStart(2, '0');
  const yyyy = String(year);
  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, '0');
    const dateStr = `${dd}.${mm}.${yyyy}`;
    if (p === '' || dateStr.startsWith(p) || dd.startsWith(p) || String(d).startsWith(p)) {
      suggestions.push(dateStr);
    }
  }
  return suggestions;
}

/**
 * Complète une saisie partielle en date JJ.MM.AAAA du mois sélectionné.
 * Ex. "13" + "2026-02" → "13.02.2026". Utilisé au TAB pour valider le champ Date.
 * Retourne null si la saisie ne peut pas être complétée ou est déjà complète.
 */
export function completeDateForMonth(raw: string, selectedMonth: string): string | null {
  const s = (raw ?? '').trim();
  if (!s || !selectedMonth || !/^\d{4}-\d{2}$/.test(selectedMonth)) return null;
  const [year, month] = selectedMonth.split('-').map(Number);
  const daysInMonth = getDaysInMonth(year, month);
  const mm = String(month).padStart(2, '0');
  const yyyy = String(year);

  const onlyDigits = /^\d+$/.test(s);
  if (onlyDigits) {
    const n = parseInt(s, 10);
    if (n >= 1 && n <= daysInMonth) {
      return `${String(n).padStart(2, '0')}.${mm}.${yyyy}`;
    }
    return null;
  }
  const dmyDot = /^(\d{1,2})\.(\d{0,2})\.?(\d{0,4})?$/.exec(s);
  if (dmyDot) {
    const d = parseInt(dmyDot[1], 10);
    if (d >= 1 && d <= daysInMonth) {
      return `${String(d).padStart(2, '0')}.${mm}.${yyyy}`;
    }
  }
  return null;
}
