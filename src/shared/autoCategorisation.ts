/**
 * Auto-catégorisation TYPE (inspiré Comptal2) :
 * 0) règles fixes manuelles (prioritaires)
 * 1) similarité de libellés vs historique TITLE→TYPE
 * 2) stats par mots p(catégorie|mot) en secours
 */

export interface WordStats {
  totalCount: number;
  length: number;
  isNumeric: boolean;
  catCounts: Record<string, number>;
}

export type WordStatsMap = Record<string, WordStats>;

export type AutoCatSource = 'rule' | 'similarity' | 'words' | null;

/** Règle fixe TITLE → TYPE (éditée à la main). */
export type FixedAutoCatMatch = 'contains' | 'equals' | 'startsWith';

export interface FixedAutoCatRule {
  id: string;
  /** Motif comparé au TITLE (insensible à la casse). */
  pattern: string;
  match: FixedAutoCatMatch;
  type: string;
  enabled: boolean;
}

export interface CategorySuggestion {
  category: string | null;
  scores: Record<string, number>;
  confidence: number;
  source: AutoCatSource;
  /** Id de la règle fixe si source === 'rule'. */
  ruleId?: string;
}

export interface LabeledTitle {
  title: string;
  type: string;
}

export interface TitleExample {
  normalized: string;
  tokens: string[];
  type: string;
  /** Occurrences de ce couple normalisé→type (pour départager). */
  count: number;
}

export interface AutoCategorisationModel {
  wordStats: WordStatsMap;
  /** Exemples dédupliqués (une entrée par libellé normalisé, type majoritaire). */
  examples: TitleExample[];
  exactTypeByNormalized: Map<string, string>;
}

const MIN_WORD_LENGTH = 2;
const SHORT_WORD_FACTOR = 0.95;
const SHORT_WORD_THRESHOLD = 4;
const MIN_WORD_STATS_SCORE = 0.25;
/** Ignorer les hapax (un seul exemple) — évite UNKNOWN → Other Inc sur un libellé inconnu. */
const MIN_WORD_OCCURRENCES = 2;
/** Au moins N tokens du libellé doivent contribuer aux stats mots (1 OK si score fort). */
const MIN_WORD_HITS = 2;
/** Score mini pour accepter un seul token très discriminant (ex. AMAZON, LIDL). */
const MIN_SINGLE_WORD_SCORE = 0.55;
/** Jaccard tokens (hors numériques) pour accepter une similarité de libellé. */
const MIN_JACCARD_SIMILARITY = 0.72;
/** Si la chaîne normalisée est très proche (distance relative). */
const MAX_EDIT_RELATIVE = 0.18;

export function isNumericWord(word: string): boolean {
  return /^\d+$/.test(word);
}

/** Tokenise un libellé (majuscules, séparateurs espace / - / _). */
export function tokenizeLabel(label: string): string[] {
  if (!label || typeof label !== 'string') return [];
  const normalized = label.trim().toUpperCase();
  return normalized.split(/[\s\-_]+/).filter((token) => token.length >= MIN_WORD_LENGTH);
}

/** Libellé normalisé pour similarité (sans tokens 100 % numériques). */
export function normalizeTitleForSimilarity(label: string): string {
  return tokenizeLabel(label)
    .filter((t) => !isNumericWord(t))
    .join(' ');
}

function tokensForSimilarity(label: string): string[] {
  return tokenizeLabel(label).filter((t) => !isNumericWord(t));
}

function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter++;
  }
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Score si le plus petit ensemble de tokens est entièrement contenu dans l’autre (ex. AMAZON ⊂ AMAZON EU SARL). */
function containmentSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  const [smaller, larger] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  for (const t of smaller) {
    if (!larger.has(t)) return 0;
  }
  return 0.75 + 0.25 * (smaller.size / larger.size);
}

/** Distance de Levenshtein (bornée pour libellés courts). */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

export function updateStatsForLabel(
  label: string,
  category: string,
  stats: WordStatsMap
): WordStatsMap {
  if (!label || !category || category.trim() === '') return stats;
  const tokens = tokenizeLabel(label);
  const updatedStats = { ...stats };

  for (const token of tokens) {
    const word = token.toUpperCase().trim();
    if (word.length < MIN_WORD_LENGTH) continue;
    if (!updatedStats[word]) {
      updatedStats[word] = {
        totalCount: 0,
        length: word.length,
        isNumeric: isNumericWord(word),
        catCounts: {},
      };
    }
    const entry = { ...updatedStats[word], catCounts: { ...updatedStats[word].catCounts } };
    entry.totalCount += 1;
    entry.catCounts[category] = (entry.catCounts[category] ?? 0) + 1;
    updatedStats[word] = entry;
  }
  return updatedStats;
}

export function batchUpdateStats(
  labels: LabeledTitle[],
  stats: WordStatsMap = {}
): WordStatsMap {
  let updated = stats;
  for (const { title, type } of labels) {
    if (title && type?.trim()) {
      updated = updateStatsForLabel(title, type.trim(), updated);
    }
  }
  return updated;
}

export function scoreCategoriesForLabel(
  label: string,
  stats: WordStatsMap
): { scores: Record<string, number>; hitTokens: number } {
  const tokens = tokenizeLabel(label);
  const categoryScores: Record<string, number> = {};
  let hitTokens = 0;

  for (const token of tokens) {
    const word = token.toUpperCase().trim();
    if (isNumericWord(word)) continue;
    const wordStats = stats[word];
    if (!wordStats || wordStats.totalCount < MIN_WORD_OCCURRENCES) continue;

    hitTokens += 1;
    let wordWeight = 1.0;
    if (wordStats.length < SHORT_WORD_THRESHOLD) wordWeight = SHORT_WORD_FACTOR;

    for (const [category, count] of Object.entries(wordStats.catCounts)) {
      const probability = count / wordStats.totalCount;
      const contribution = wordWeight * probability;
      categoryScores[category] = (categoryScores[category] ?? 0) + contribution;
    }
  }
  return { scores: categoryScores, hitTokens };
}

function suggestFromWordStats(label: string, stats: WordStatsMap): CategorySuggestion {
  const { scores, hitTokens } = scoreCategoriesForLabel(label, stats);
  let bestCategory: string | null = null;
  let bestScore = 0;
  for (const [category, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }
  if (bestScore < MIN_WORD_STATS_SCORE) {
    return { category: null, scores, confidence: 0, source: null };
  }
  const enoughHits =
    hitTokens >= MIN_WORD_HITS || (hitTokens === 1 && bestScore >= MIN_SINGLE_WORD_SCORE);
  if (!enoughHits) {
    return { category: null, scores, confidence: 0, source: null };
  }
  return { category: bestCategory, scores, confidence: bestScore, source: 'words' };
}

/**
 * Similarité vs historique : match exact normalisé, sinon meilleur Jaccard / edit distance.
 */
export function suggestFromSimilarity(
  label: string,
  model: AutoCategorisationModel
): CategorySuggestion {
  const normalized = normalizeTitleForSimilarity(label);
  const tokens = tokensForSimilarity(label);
  const scores: Record<string, number> = {};

  if (!normalized && tokens.length === 0) {
    return { category: null, scores, confidence: 0, source: null };
  }

  const exact = model.exactTypeByNormalized.get(normalized);
  if (exact) {
    scores[exact] = 1;
    return { category: exact, scores, confidence: 1, source: 'similarity' };
  }

  let bestType: string | null = null;
  let bestScore = 0;

  for (const ex of model.examples) {
    if (ex.tokens.length === 0 && tokens.length === 0) continue;
    let score = Math.max(
      jaccardSimilarity(tokens, ex.tokens),
      containmentSimilarity(tokens, ex.tokens)
    );

    // Renforce si chaînes normalisées très proches (typos / variantes courtes).
    if (normalized && ex.normalized) {
      const maxLen = Math.max(normalized.length, ex.normalized.length);
      if (maxLen > 0 && maxLen <= 64) {
        const dist = levenshtein(normalized, ex.normalized);
        const rel = dist / maxLen;
        if (rel <= MAX_EDIT_RELATIVE) {
          score = Math.max(score, 1 - rel);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestType = ex.type;
    }
    if (score > 0) {
      scores[ex.type] = Math.max(scores[ex.type] ?? 0, score);
    }
  }

  if (bestType && bestScore >= MIN_JACCARD_SIMILARITY) {
    return { category: bestType, scores, confidence: bestScore, source: 'similarity' };
  }
  return { category: null, scores, confidence: 0, source: null };
}

/** Construit le modèle d’apprentissage depuis les lignes historiques (TITLE + TYPE). */
export function buildAutoCategorisationModel(rows: LabeledTitle[]): AutoCategorisationModel {
  const labeled = rows.filter((r) => (r.title ?? '').trim() && (r.type ?? '').trim());
  const wordStats = batchUpdateStats(labeled, {});

  /** normalized → Map<type, count> */
  const byNorm = new Map<string, Map<string, number>>();
  for (const { title, type } of labeled) {
    const t = type.trim();
    const normalized = normalizeTitleForSimilarity(title);
    if (!normalized) continue;
    let typeCounts = byNorm.get(normalized);
    if (!typeCounts) {
      typeCounts = new Map();
      byNorm.set(normalized, typeCounts);
    }
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }

  const examples: TitleExample[] = [];
  const exactTypeByNormalized = new Map<string, string>();

  for (const [normalized, typeCounts] of byNorm) {
    let bestType = '';
    let bestCount = 0;
    for (const [type, count] of typeCounts) {
      if (count > bestCount) {
        bestCount = count;
        bestType = type;
      }
    }
    if (!bestType) continue;
    exactTypeByNormalized.set(normalized, bestType);
    examples.push({
      normalized,
      tokens: normalized.split(' ').filter(Boolean),
      type: bestType,
      count: bestCount,
    });
  }

  // Limite soft : garder les exemples les plus fréquents si très nombreux (perf Jaccard).
  const MAX_EXAMPLES = 8000;
  if (examples.length > MAX_EXAMPLES) {
    examples.sort((a, b) => b.count - a.count);
    examples.length = MAX_EXAMPLES;
  }

  return { wordStats, examples, exactTypeByNormalized };
}

/** Applique la première règle fixe activée qui matche (ordre de la liste). */
export function matchFixedAutoCatRule(
  title: string,
  rules: FixedAutoCatRule[] | null | undefined
): CategorySuggestion | null {
  const raw = (title ?? '').trim();
  if (!raw || !rules?.length) return null;
  const upper = raw.toUpperCase();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const pattern = (rule.pattern ?? '').trim();
    const type = (rule.type ?? '').trim();
    if (!pattern || !type) continue;
    const p = pattern.toUpperCase();
    let ok = false;
    if (rule.match === 'equals') ok = upper === p;
    else if (rule.match === 'startsWith') ok = upper.startsWith(p);
    else ok = upper.includes(p); // contains
    if (ok) {
      return {
        category: type,
        scores: { [type]: 1 },
        confidence: 1,
        source: 'rule',
        ruleId: rule.id,
      };
    }
  }
  return null;
}

/**
 * Suggestion finale : règle fixe → similarité de libellé → stats par mots.
 */
export function suggestTypeForTitle(
  title: string,
  model: AutoCategorisationModel | null | undefined,
  fixedRules?: FixedAutoCatRule[] | null
): CategorySuggestion {
  if (!(title ?? '').trim()) {
    return { category: null, scores: {}, confidence: 0, source: null };
  }

  const fromRule = matchFixedAutoCatRule(title, fixedRules);
  if (fromRule?.category) return fromRule;

  if (!model) {
    return { category: null, scores: {}, confidence: 0, source: null };
  }

  const fromSim = suggestFromSimilarity(title, model);
  if (fromSim.category) return fromSim;

  return suggestFromWordStats(title, model.wordStats);
}

/** Confiance affichable 0–100 (borne les scores mots parfois > 1). */
export function confidenceToPercent(confidence: number): number {
  if (!Number.isFinite(confidence) || confidence <= 0) return 0;
  return Math.round(Math.min(1, confidence) * 100);
}

/** Extrait TITLE/TYPE depuis des lignes source (DB / CSV miroir). */
export function labeledTitlesFromSourceRows(
  rows: Array<Record<string, string>>
): LabeledTitle[] {
  const out: LabeledTitle[] = [];
  for (const row of rows) {
    const title = (row.TITLE ?? row.Title ?? row.title ?? '').trim();
    const type = (row.TYPE ?? row.Type ?? row.type ?? '').trim();
    if (title && type) out.push({ title, type });
  }
  return out;
}
